import { captureSceneAnimationUsage, sceneAnimationUsageMatchSource } from '../../engine/scene-animation-usage.mjs';
import { captureSceneAnimationTargetSource, captureSceneAnimationTargets, sceneAnimationTargetsMatchSource, sceneAnimationTargetsEqual, validateSceneAnimationTargets } from '../../engine/scene-animation-targets.mjs';
import { parseJsonSource } from '../../engine/json-source.mjs';
import { isSceneAnimationProposal, prepareSceneAnimationApply } from '../../engine/scene-animation-edit.mjs';

// Source ownership and an in-memory draft write only. This port has no file,
// renderer, ordinary Save or backend access. The optional identity reader is
// separate from source ownership and rechecked before a catalog-backed draft.
export function createSceneAnimationSourceHost({ getState, digest, writeDraft, inspectTargets, inspectUsage, focus = () => {} }) {
  let previous, generation = 0, previousTargets, targetsGeneration = 0, recognitionContent, recognitionJSON, recognized = false;
  let usageAvailability, usageGeneration = 0;
  const issuedTargets = new WeakMap();
  const targetsConflict = () => { throw Object.assign(new Error('Scene animation targets changed; refresh the target list.'), { errorCode: 'scene_animation_targets_conflict' }); };
  const conflict = () => { throw Object.assign(new Error('Animation editing no longer owns this source.'), { errorCode: 'scene_animation_authoring_conflict' }); };
  function capture() {
    const s = getState(), keys = ['document', 'token', 'sourcePath', 'content', 'baseline', 'version', 'editable', 'creating', 'busy', 'available', 'sourceJSON'];
    if (!previous || keys.some(key => previous[key] !== s[key])) { previous = { ...s }; generation++; }
    const targetsAvailable = s.targetsAvailable === true && typeof inspectTargets === 'function';
    if (previousTargets !== targetsAvailable) { previousTargets = targetsAvailable; targetsGeneration++; }
    const usageAvailable = s.usageAvailable === true && typeof inspectUsage === 'function';
    if (usageAvailability !== usageAvailable) { usageAvailability = usageAvailable; usageGeneration++; }
    if (recognitionContent !== s.content || recognitionJSON !== s.sourceJSON) {
      recognitionContent = s.content; recognitionJSON = s.sourceJSON;
      const checked = s.sourceJSON && typeof s.content === 'string' && s.content.length <= 131072 ? parseJsonSource(s.content) : null;
      recognized = checked?.ok === true && checked.value?.format === 'viento-scene-animation';
    }
    return { ...s, sourceToken: `${String(s.token)}:${generation}`, animationSource: recognized, targetsAvailable, targetsToken: String(targetsGeneration), usageAvailable, usageToken: String(usageGeneration) };
  }
  const eligible = s => s.editable === true && s.available === true && !s.creating && !s.busy && s.sourceJSON === true && s.animationSource && Boolean(s.document);
  const current = (owner, guard = () => true) => {
    const s = capture();
    return eligible(s) && s.document === owner.document && s.sourceToken === owner.sourceToken
      && s.content === owner.content && s.baseline === owner.baseline && s.version === owner.version && guard() === true;
  };
  function getContext() {
    const s = capture();
    return { editable: s.editable, creating: s.creating, busy: s.busy, available: s.available, sourceJSON: s.sourceJSON,
      sourcePath: s.sourcePath, sourceToken: s.sourceToken, animationSource: s.animationSource, targetsAvailable: s.targetsAvailable, targetsToken: s.targetsToken,
      usageAvailable: s.usageAvailable, usageToken: s.usageToken };
  }
  async function snapshot(owner, guard) {
    if (!eligible(owner) || !current(owner, guard)) return null;
    const baseSourceRevision = `sha256:${await digest(owner.baseline)}`;
    if (!current(owner, guard) || typeof owner.version !== 'string' || owner.version.startsWith('sha256:') && owner.version !== baseSourceRevision) return null;
    const sourceRevision = `sha256:${await digest(owner.content)}`;
    if (!current(owner, guard)) return null;
    return Object.freeze({ sourcePath: owner.sourcePath, token: owner.sourceToken, content: owner.content, baseSourceRevision, sourceRevision });
  }
  async function getSource() { return snapshot(capture()); }
  async function getTargets(requestedSource) {
    const requested = captureSceneAnimationTargetSource(requestedSource), owner = capture();
    if (!owner.targetsAvailable) throw Object.assign(new Error('Scene animation target selection is unavailable.'), { errorCode: 'scene_animation_targets_unavailable' });
    const valid = () => { const now = capture(); return now.targetsAvailable && now.targetsToken === owner.targetsToken && current(owner); };
    const source = await snapshot(owner, valid);
    if (!source || !Object.keys(source).every(key => source[key] === requested[key])) targetsConflict();
    const raw = await inspectTargets({ sceneObjectId: parseJsonSource(source.content).value.sceneObjectId });
    if (!valid()) targetsConflict();
    const catalog = captureSceneAnimationTargets(source, raw);
    const savedRevision = `sha256:${await digest(catalog.savedContent)}`;
    if (!valid() || savedRevision !== source.baseSourceRevision) targetsConflict();
    issuedTargets.set(catalog, owner.targetsToken); return catalog;
  }
  async function getUsage(requestedSource) {
    // Capture exact data descriptors before any await. Optional read capability
    // changes revoke pending reads without changing ordinary editing ownership.
    const keys = ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content'];
    let requested;
    try {
      if (!requestedSource || ![Object.prototype, null].includes(Object.getPrototypeOf(requestedSource))) conflict();
      const own = Reflect.ownKeys(requestedSource);
      if (own.length !== keys.length || own.some(key => !keys.includes(key))) conflict();
      requested = Object.fromEntries(keys.map(key => {
        const property = Object.getOwnPropertyDescriptor(requestedSource, key);
        if (!property?.enumerable || !Object.hasOwn(property, 'value') || typeof property.value !== 'string') conflict();
        return [key, property.value];
      }));
    } catch { conflict(); }
    const owner = capture();
    const guard = () => { const now = capture(); return now.usageAvailable === true && now.usageToken === owner.usageToken; };
    if (!guard()) conflict();
    const source = await snapshot(owner, guard);
    if (!source || !keys.every(key => requested[key] === source[key])) conflict();
    const parsed = parseJsonSource(source.content);
    if (!parsed.ok) conflict();
    const raw = await inspectUsage({ sceneObjectId: parsed.value.sceneObjectId });
    if (!current(owner, guard)) conflict();
    const usage = captureSceneAnimationUsage(source, raw);
    if (`sha256:${await digest(usage.savedContent)}` !== source.baseSourceRevision || !current(owner, guard)
      || !sceneAnimationUsageMatchSource(usage, requested)) conflict();
    return usage;
  }
  async function applyDraft(proposal, { isCurrent = () => true, targets } = {}) {
    if (!isSceneAnimationProposal(proposal)) conflict();
    const owner = capture(), source = await snapshot(owner, isCurrent);
    if (!source) conflict();
    if (targets !== undefined) {
      if (!owner.targetsAvailable || issuedTargets.get(targets) !== owner.targetsToken || !sceneAnimationTargetsMatchSource(targets, source)) targetsConflict();
      const fresh = await getTargets(source);
      if (!current(owner, isCurrent) || !sceneAnimationTargetsEqual(targets, fresh)) targetsConflict();
      validateSceneAnimationTargets(fresh, parseJsonSource(proposal.afterContent).value);
    }
    const prepared = await prepareSceneAnimationApply(source, proposal, { digest });
    if (!current(owner, isCurrent)) conflict();
    if (targets !== undefined) {
      const now = capture();
      if (!now.targetsAvailable || now.targetsToken !== owner.targetsToken) targetsConflict();
    }
    writeDraft(prepared.afterContent);
    const after = capture();
    return { applied: true, sourcePath: after.sourcePath, sourceToken: after.sourceToken, content: prepared.afterContent,
      focus() { if (current(after) && after.content === prepared.afterContent) focus(); } };
  }
  return Object.freeze({ getContext, getSource, getTargets, getUsage, applyDraft });
}
