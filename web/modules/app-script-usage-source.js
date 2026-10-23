import { captureScriptUsage, scriptUsageMatchSource, scriptUsageSource,
  isScriptUsageOpenSourceRequest, scriptUsageOpenSourceMatchSource } from '../../engine/script-usage.mjs';

// Saved-reference reads and a narrow navigation handoff only. This host never
// receives Save or draft-write authority; its optional capability needs no WASM.
export function createScriptUsageSourceHost({ getState, digest, inspectUsage, navigateSource }) {
  let previous, generation = 0, availability, capabilityGeneration = 0;
  const issued = new WeakMap(), keys = ['sourcePath', 'token', 'content', 'baseSourceRevision', 'sourceRevision'];
  const conflict = () => { throw Object.assign(new Error('The saved script usage source or selection has changed.'), { errorCode: 'script_usage_conflict' }); };
  const digestHex = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
  function capture() {
    const state = getState();
    const observed = ['document', 'token', 'sourcePath', 'content', 'baseline', 'version', 'editable', 'creating', 'busy', 'sourceTXT'];
    if (!previous || observed.some(key => previous[key] !== state[key])) { previous = { ...state }; generation++; }
    const available = state.available === true && typeof inspectUsage === 'function' && typeof navigateSource === 'function';
    if (available !== availability) { availability = available; capabilityGeneration++; }
    return { ...state, available, sourceToken: `${String(state.token)}:${generation}:${capabilityGeneration}`, capabilityGeneration };
  }
  const eligible = value => value.editable === true && value.available === true && !value.creating && !value.busy && value.sourceTXT === true
    && Boolean(value.document) && typeof value.content === 'string' && typeof value.baseline === 'string';
  const current = (owner, guard = () => true) => {
    if (guard() !== true) return false;
    const now = capture();
    return eligible(now) && now.document === owner.document && now.sourceToken === owner.sourceToken
      && now.content === owner.content && now.baseline === owner.baseline && now.version === owner.version;
  };
  function getContext() {
    const state = capture();
    return { editable: state.editable, creating: state.creating, busy: state.busy, available: state.available, sourceTXT: state.sourceTXT,
      sourcePath: state.sourcePath, sourceToken: state.sourceToken, dirty: state.content !== state.baseline };
  }
  function requestedSource(input) {
    if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) conflict();
    const properties = Object.getOwnPropertyDescriptors(input), names = Reflect.ownKeys(properties);
    if (names.length !== keys.length || names.some(key => !keys.includes(key))
      || keys.some(key => !properties[key]?.enumerable || !Object.hasOwn(properties[key], 'value') || typeof properties[key].value !== 'string')) conflict();
    return Object.freeze(Object.fromEntries(keys.map(key => [key, properties[key].value])));
  }
  async function snapshot(owner, guard) {
    if (!current(owner, guard)) return null;
    const base = await digest(owner.baseline);
    if (!current(owner, guard) || !digestHex(base) || typeof owner.version !== 'string') return null;
    const baseSourceRevision = `sha256:${base}`;
    if (owner.version.startsWith('sha256:') && owner.version !== baseSourceRevision) return null;
    const hash = await digest(owner.content);
    if (!current(owner, guard) || !digestHex(hash)) return null;
    return Object.freeze({ sourcePath: owner.sourcePath, token: owner.sourceToken, content: owner.content,
      baseSourceRevision, sourceRevision: `sha256:${hash}` });
  }
  async function getSource() { return snapshot(capture()); }
  async function getUsage(input) {
    const requested = requestedSource(input), owner = capture(), source = await snapshot(owner);
    if (!source || !keys.every(key => requested[key] === source[key])) conflict();
    const raw = await inspectUsage({ sourcePath: source.sourcePath });
    if (!current(owner)) conflict();
    const catalog = captureScriptUsage(source, raw);
    if (!scriptUsageMatchSource(catalog, requested) || !current(owner)) conflict();
    issued.set(catalog, { source, capabilityGeneration: owner.capabilityGeneration }); return catalog;
  }
  async function openSource(request, { isCurrent = () => true } = {}) {
    if (!isScriptUsageOpenSourceRequest(request) || typeof isCurrent !== 'function') conflict();
    const issuedSource = issued.get(request.catalog), owner = capture();
    if (!issuedSource || issuedSource.capabilityGeneration !== owner.capabilityGeneration) conflict();
    const source = await snapshot(owner, isCurrent);
    if (!source || !scriptUsageOpenSourceMatchSource(request, source) || !scriptUsageMatchSource(request.catalog, issuedSource.source)) conflict();
    // Re-read before leaving the editor. A stale target cannot discard a dirty
    // source merely because its previously captured reference was valid.
    const raw = await inspectUsage({ sourcePath: source.sourcePath });
    if (!current(owner, isCurrent)) conflict();
    const fresh = captureScriptUsage(source, raw), target = request.source;
    if (fresh.worldId !== request.catalog.worldId || fresh.script.objectId !== request.catalog.script.objectId) conflict();
    const reference = fresh.references.find(item => item.objectId === target.objectId);
    const match = target.propertyPath ? reference?.bindings.find(item => item.propertyPath === target.propertyPath) : null;
    if (!reference || target.propertyPath && !match) conflict();
    const checked = scriptUsageSource(fresh, reference, match);
    if (checked.sourcePath !== target.sourcePath || checked.sourceRevision !== target.sourceRevision || checked.content !== target.content
      || checked.propertyPath !== target.propertyPath || JSON.stringify(checked.sourceRange) !== JSON.stringify(target.sourceRange)) conflict();
    const hash = await digest(checked.content);
    if (!current(owner, isCurrent) || !digestHex(hash) || `sha256:${hash}` !== checked.sourceRevision) conflict();
    // Normal navigation changes document/token/busy. From this point runtime
    // owns that transition, while the caller still owns the dialog selection.
    const navigationCurrent = () => {
      if (isCurrent() !== true) return false;
      const now = capture();
      return now.available && now.capabilityGeneration === owner.capabilityGeneration;
    };
    if (!current(owner, isCurrent)) conflict();
    return navigateSource(checked, { isCurrent: navigationCurrent });
  }
  return Object.freeze({ getContext, getSource, getUsage, openSource });
}
