// In-memory correlation only. Source navigation and ordinary writes belong to
// injected editor ports; this adapter neither persists nor executes author data.
import { getCreatePathError } from '../../engine/document-contract.mjs';

const full = (expression, value) => typeof value === 'string' && expression.exec(value)?.[0] === value;
const uuid = value => full(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, value);
const revision = value => full(/^sha256:[a-f0-9]{64}$/, value);
const invalid = () => { throw Object.assign(new TypeError('Invalid transient scene/script return input.'), { errorCode: 'scene_script_return_host_invalid' }); };
function record(input, keys, optional = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), names = Reflect.ownKeys(descriptors);
  if (names.some(key => typeof key !== 'string' || ![...keys, ...optional].includes(key)) || keys.some(key => !Object.hasOwn(descriptors, key))) invalid();
  const result = {};
  for (const key of names) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}
const path = value => typeof value === 'string' && value.length > 0 && value.length <= 1024
  && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value) && getCreatePathError(value) === '';
function origin(input) {
  const value = record(input, ['worldId', 'documentRoot', 'scene', 'backendId', 'language']);
  const scene = record(value.scene, ['objectId', 'objectRevision', 'sourcePath', 'sourceRevision']);
  if (!full(/^world:[a-f0-9]{64}$/, value.worldId) || !path(value.documentRoot) || !path(value.documentRoot + '/probe.txt')
    || !uuid(scene.objectId) || !revision(scene.objectRevision) || !revision(scene.sourceRevision)
    || !path(scene.sourcePath) || !scene.sourcePath.startsWith(value.documentRoot + '/') || !/\.json$/i.test(scene.sourcePath)
    || !full(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/, value.backendId) || value.backendId.length > 128
    || !full(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/, value.language) || value.language.length > 64) invalid();
  return Object.freeze({ ...value, scene: Object.freeze({ ...scene }) });
}
const opaque = () => Object.freeze(Object.create(null));

export function createSceneScriptReturnHost(input) {
  const ports = record(input, ['getContext', 'openSource']);
  if (typeof ports.getContext !== 'function' || typeof ports.openSource !== 'function') invalid();
  let active = null;
  const saves = new WeakMap();
  function context() {
    try {
      const value = record(ports.getContext(), ['editable', 'busy', 'dirty', 'creating', 'workspaceId', 'editorSession', 'sourcePath', 'content']);
      if (['editable', 'busy', 'dirty', 'creating'].some(key => typeof value[key] !== 'boolean') || !uuid(value.workspaceId)
        || typeof value.editorSession !== 'string' || !value.editorSession || value.editorSession.length > 256
        || typeof value.sourcePath !== 'string' || typeof value.content !== 'string') return null;
      return value;
    } catch { return null; }
  }
  const current = token => active && active.token === token ? active : null;
  const idle = (entry, value) => Boolean(entry && value && value.editable && !value.busy && !value.dirty && !value.creating && value.workspaceId === entry.workspaceId);
  const scriptPath = (entry, value) => path(value) && value.startsWith(entry.origin.documentRoot + '/') && /\.txt$/i.test(value);
  function begin(inputOrigin) {
    if (active) return null;
    const selected = origin(inputOrigin), value = context();
    if (!value || !value.editable || value.busy || value.dirty || value.creating) return null;
    const token = opaque();
    active = { token, origin: selected, workspaceId: value.workspaceId, stage: 'chooser', marker: null,
      draftSession: '', savedScript: null, saveSequence: 0, returning: false };
    return token;
  }
  function draftCreated(token, receipt) {
    const entry = current(token), value = context();
    if (!entry || entry.stage !== 'chooser' || entry.returning || !value || !value.editable || !value.creating || value.workspaceId !== entry.workspaceId) return false;
    let accepted;
    try { accepted = record(receipt, ['applied', 'sourcePath', 'content'], ['focus']); } catch { return false; }
    if (accepted.applied !== true || !scriptPath(entry, accepted.sourcePath) || typeof accepted.content !== 'string'
      || accepted.sourcePath !== value.sourcePath || accepted.content !== value.content
      || Object.hasOwn(accepted, 'focus') && typeof accepted.focus !== 'function') return false;
    entry.marker = opaque(); entry.draftSession = value.editorSession; entry.stage = 'draft'; return true;
  }
  function captureSave() {
    const entry = active, value = context();
    // Ordinary Save has already set its busy flag. Correlate its exact editor
    // owner and submitted bytes rather than requiring a second idle window.
    if (!entry || entry.returning || !value || !value.editable || value.workspaceId !== entry.workspaceId || !scriptPath(entry, value.sourcePath)) return null;
    const creating = entry.stage === 'draft' && entry.marker && value.creating && value.editorSession === entry.draftSession;
    const updating = entry.stage === 'saved' && !value.creating && value.sourcePath === entry.savedScript.sourcePath;
    if (!creating && !updating) return null;
    const ticket = opaque();
    saves.set(ticket, { entry, marker: entry.marker, sequence: ++entry.saveSequence, workspaceId: value.workspaceId,
      editorSession: value.editorSession, sourcePath: value.sourcePath, content: value.content, creating: value.creating, used: false });
    return ticket;
  }
  function saved(ticket, receipt) {
    const captured = ticket && typeof ticket === 'object' ? saves.get(ticket) : null, entry = active, value = context();
    if (!captured || captured.used || captured.entry !== entry || !entry || entry.returning || captured.marker !== entry.marker || captured.sequence !== entry.saveSequence
      || !value || !value.editable || value.workspaceId !== captured.workspaceId || value.editorSession !== captured.editorSession
      || value.sourcePath !== captured.sourcePath || value.content !== captured.content || value.creating !== captured.creating) return false;
    let written;
    try { written = record(receipt, ['sourcePath', 'sourceRevision']); } catch { return false; }
    if (written.sourcePath !== captured.sourcePath || !revision(written.sourceRevision)) return false;
    captured.used = true; entry.savedScript = Object.freeze({ ...written }); entry.stage = 'saved'; return true;
  }
  function get(token) {
    const entry = current(token); if (!entry) return null;
    const value = context();
    return Object.freeze({ origin: entry.origin, savedScript: entry.savedScript, stage: entry.stage,
      canReturn: !entry.returning && idle(entry, value), editorSession: value?.editorSession || '', sourcePath: value?.sourcePath || '' });
  }
  async function returnSource(token, inputOptions) {
    const entry = current(token), before = context();
    if (!entry || entry.returning || !idle(entry, before)) return false;
    let options;
    try { options = record(inputOptions, ['isCurrent']); } catch { return false; }
    if (typeof options.isCurrent !== 'function') return false;
    const guard = () => {
      try {
        if (current(token) !== entry || options.isCurrent() !== true) return false;
        // The injected guard may synchronously change the editor or ticket.
        const value = context();
        return current(token) === entry && Boolean(value && value.editable && !value.dirty && !value.creating && value.workspaceId === entry.workspaceId);
      } catch { return false; }
    };
    if (!guard()) return false;
    // Pin the idle owner before dispatch. Once openSource starts, its own load
    // token protects navigation; its expected busy/session changes are legal.
    const dispatch = context();
    if (!idle(entry, dispatch) || dispatch.editorSession !== before.editorSession || dispatch.sourcePath !== before.sourcePath) return false;
    entry.returning = true;
    try {
      const opened = await ports.openSource(entry.origin.scene.sourcePath, { sourceRevision: entry.origin.scene.sourceRevision, isCurrent: guard });
      return guard() ? opened : false;
    } catch { return false; }
    finally { if (current(token) === entry) entry.returning = false; }
  }
  function clear(token) {
    const entry = current(token); if (!entry) return false;
    entry.saveSequence++; active = null; return true;
  }
  return Object.freeze({ begin, draftCreated, captureSave, saved, get, returnSource, clear });
}
