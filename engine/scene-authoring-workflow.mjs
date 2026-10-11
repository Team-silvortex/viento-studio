import { canonicalJson } from './canonical-json.mjs';
import { validateSceneAuthoringCandidate } from './scene-authoring-candidate.mjs';

const CAPABILITIES = Object.freeze({
  instance: ['canEditCompositionOverride', 'canEditCompositionLayout'],
  positions: ['canEditCompositionBatchLayout'], fragment: ['canEditCompositionFragment'],
  placement: ['canEditCompositionPlacement'], structure: ['canEditCompositionStructure'],
  placements: ['canEditCompositionPlacements'],
  groups: ['canEditCompositionGroups'],
  definitions: ['canEditCompositionDefinitions'],
});
const CONTEXT_FIELDS = ['editable', 'creating', 'busy', 'compositionSourceWritable', 'sceneDraftPath', 'sceneDraftToken'];
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const invalid = () => { throw Object.assign(new TypeError('The scene authoring transaction is invalid.'), { errorCode: 'scene_composition_override_invalid' }); };
const conflict = () => { throw Object.assign(new Error('The scene authoring source owner changed.'), { errorCode: 'scene_composition_override_conflict' }); };

// The workflow receives JSON proposals, never mutable view/session objects.
// Snapshot without invoking getters or serializers, including before awaits.
function snapshot(value, seen = new Set(), depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 150000 || depth > 64) invalid();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) invalid();
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if ((!array && prototype !== Object.prototype && prototype !== null) || Object.hasOwn(descriptors, 'toJSON')) invalid();
  const keys = Reflect.ownKeys(descriptors), result = array ? [] : {};
  if (array && keys.length !== value.length + 1) invalid();
  seen.add(value);
  for (const name of array ? Array.from({ length: value.length }, (_, index) => String(index)) : keys) {
    const descriptor = descriptors[name];
    if (typeof name !== 'string' || !descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    Object.defineProperty(result, name, { value: snapshot(descriptor.value, seen, depth + 1, budget), enumerable: true, configurable: true, writable: true });
  }
  seen.delete(value); return result;
}
const fingerprint = value => canonicalJson(snapshot(value));

/**
 * A single domain's authoring lifecycle. Ports own host I/O; the workflow has
 * no DOM, HTTP, execution backend, shared view state or ordinary Save authority.
 * State: {open,session,selected,sourcePath,previewSupported,previewActive,
 * requestBusy,running,context}. reviewCandidate returns the preview payload;
 * digest returns bare SHA-256 hex. onApplied is a neutral host notification.
 */
export function createSceneAuthoringWorkflow({ kind, capabilityKey, isSupported = () => false, getState = () => ({}),
  getSource = async () => null, loadCatalog = async () => ({}), reviewCandidate = async () => null,
  releasePreview = () => {}, digest = async () => '', applyDraft = async () => ({ applied: false }), onApplied = () => {} } = {}) {
  if (typeof kind !== 'string' || !Object.hasOwn(CAPABILITIES, kind) || !CAPABILITIES[kind].includes(capabilityKey)) invalid();
  let generation = 0, reviewEpoch = 0, applyEpoch = 0, pendingReceipt = null;
  const state = () => { try { return getState() || {}; } catch { return {}; } };
  function allowed(value) {
    const context = value.context || {};
    try { return Boolean(value.open && value.session !== undefined && value.session !== null && uuid(value.selected)
      && typeof value.sourcePath === 'string' && value.sourcePath && value.previewSupported && value.previewActive
      && !value.requestBusy && !value.running && isSupported()
      && context.editable === true && !context.creating && !context.busy && context.compositionSourceWritable === true
      && context.sceneDraftPath === value.sourcePath && context.sceneDraftToken !== undefined && context.sceneDraftToken !== null); }
    catch { return false; }
  }
  const canEdit = () => allowed(state());
  function getContext() {
    const value = state(), context = value.context || {};
    return Object.fromEntries([...CONTEXT_FIELDS.map(field => [field, context[field]]), [capabilityKey, allowed(value)]]);
  }
  function capture(proposal = null) {
    const value = state();
    if (!allowed(value) || proposal && (proposal.sceneId !== value.selected || proposal.sourcePath !== value.sourcePath)) conflict();
    return { generation, session: value.session, sceneId: value.selected, sourcePath: value.sourcePath, token: value.context.sceneDraftToken };
  }
  function owns(owner, { token = true } = {}) {
    const value = state();
    return generation === owner.generation && allowed(value) && value.session === owner.session
      && value.selected === owner.sceneId && value.sourcePath === owner.sourcePath
      && (!token || value.context.sceneDraftToken === owner.token);
  }
  const externalCurrent = guard => { try { return guard() === true; } catch { return false; } };
  const unchanged = (original, before) => { try { return fingerprint(original) === before; } catch { return false; } };
  const detach = proposal => { const value = snapshot(proposal); return { value, signature: canonicalJson(value) }; };
  function reset() { generation++; reviewEpoch++; applyEpoch++; pendingReceipt = null; }
  async function open(editor, input) {
    if (!editor || typeof editor.open !== 'function' || !input || !canEdit()) return false;
    const value = state(), model = input.model, parentCurrent = typeof input.isCurrent === 'function' ? input.isCurrent : () => false;
    if (!model?.composition || model.scene?.objectId !== value.selected || model.scene.sourcePath !== value.sourcePath || !externalCurrent(parentCurrent)) return false;
    const openingInput = { ...input, model: snapshot(model) };
    reset();
    const owner = capture(), current = () => owns(owner) && externalCurrent(parentCurrent);
    try {
      const source = await getSource(owner.sourcePath);
      if (!source || !current()) return false;
      const sourceCopy = snapshot(source);
      if (sourceCopy.sourcePath !== owner.sourcePath) return false;
      const catalog = await loadCatalog({ sceneId: owner.sceneId, sourcePath: owner.sourcePath, isCurrent: current });
      if (!catalog || !current()) return false;
      const opened = await editor.open({ ...openingInput, ...snapshot(catalog), source: sourceCopy, isCurrent: current });
      return current() ? opened : false;
    } catch (error) { if (!current()) return false; throw error; }
  }
  async function validateDraft(proposal, { isCurrent = () => true } = {}) {
    const before = detach(proposal), owner = capture(before.value), epoch = ++reviewEpoch;
    const current = () => epoch === reviewEpoch && owns(owner) && externalCurrent(isCurrent) && unchanged(proposal, before.signature);
    if (!current()) conflict();
    let previewId;
    try {
      const response = await reviewCandidate(snapshot(before.value), { isCurrent: current });
      // Even a malformed/stale result can own a temporary preview to release.
      const id = response && Object.getOwnPropertyDescriptor(response, 'previewId');
      if (id && Object.hasOwn(id, 'value') && uuid(id.value)) previewId = id.value;
      if (!current()) conflict();
      const payload = snapshot(response), hashed = await digest(before.value.afterContent);
      if (!current()) conflict();
      if (typeof hashed !== 'string' || !/^[a-f0-9]{64}$/.test(hashed)) invalid();
      validateSceneAuthoringCandidate(kind, before.value, payload, { sourceRevision: `sha256:${hashed}` });
      if (!current()) conflict();
      return { ok: true };
    } finally {
      // Release is deliberately best effort and does not hold the view open.
      if (previewId) try { Promise.resolve(releasePreview(previewId)).catch(() => {}); } catch {}
    }
  }
  async function applySourceDraft(proposal, { isCurrent = () => true } = {}) {
    const before = detach(proposal), owner = capture(before.value), epoch = ++applyEpoch;
    const submitted = snapshot(before.value), submittedSignature = fingerprint(submitted);
    const current = () => epoch === applyEpoch && owns(owner) && externalCurrent(isCurrent) && unchanged(proposal, before.signature) && unchanged(submitted, submittedSignature);
    if (!current()) conflict();
    pendingReceipt = null;
    const result = await applyDraft(submitted, { isCurrent: current });
    // A successful in-memory write advances its source token. The exact host
    // receipt belongs to the original dialog/source, not that expired token.
    if (epoch !== applyEpoch || !owns(owner, { token: false }) || !unchanged(proposal, before.signature)) conflict();
    if (!unchanged(submitted, submittedSignature) || result?.applied !== true) invalid();
    pendingReceipt = { owner, epoch, result, proposal: before.value, signature: before.signature };
    return result;
  }
  function sourceApplied(result, proposal) {
    const pending = pendingReceipt;
    if (!pending || pending.epoch !== applyEpoch || result !== pending.result || !owns(pending.owner, { token: false }) || !unchanged(proposal, pending.signature)) return false;
    pendingReceipt = null;
    onApplied(result, snapshot(pending.proposal), { session: pending.owner.session, sceneId: pending.owner.sceneId, sourcePath: pending.owner.sourcePath });
    return true;
  }
  return Object.freeze({ canEdit, getContext, open, validateDraft, applySourceDraft, sourceApplied, reset });
}
