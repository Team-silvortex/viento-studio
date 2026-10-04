import { createSceneStructure, sceneStructureActors } from './scene-structure.mjs';
import { validateSceneGroups } from './scene-groups.mjs';
import { sceneActorIdentity } from './scene-identity.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { dispatchStudioCore, dispatchStudioCoreDraft, dispatchStudioCoreSave, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const finitePair = value => Array.isArray(value) && value.length === 2
  && Array.from(value).every(item => typeof item === 'number' && Number.isFinite(item));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const position = value => finitePair(value) && value.every(item => Math.abs(item) <= 100000);
const samePosition = (a, b) => a[0] === b[0] && a[1] === b[1];
const parse = content => JSON.parse(content.replace(/^\uFEFF/, ''));
const invalid = () => { throw Object.assign(new Error('A scene actor requires two finite coordinates from -100000 to 100000.'), { errorCode: 'scene_layout_position_invalid' }); };

// Only geometry crosses the Rust boundary. Source text, inheritance and
// authoring metadata remain under the existing scene.update contract.
function geometryActors(actors, batch = false, ids = []) {
  if (!Array.isArray(actors)) return actors;
  // Selection helpers require every identity, but only selected geometry.
  // Inspect data properties without evaluating caller-provided accessors;
  // the unchanged ids value still undergoes strict JSON/Rust validation.
  const selected = new Set(Array.isArray(ids) ? Object.values(Object.getOwnPropertyDescriptors(ids))
    .filter(property => typeof property.value === 'string').map(property => property.value) : []);
  return actors.map(actor => {
    if (!plain(actor)) return actor;
    const result = {};
    // Rust's protocol objectId is an opaque layout key. Author objectId stays
    // the definition reference; only this boundary maps a v2 instance to it.
    const identity = Object.getOwnPropertyDescriptor(actor, Object.hasOwn(actor, 'instanceId') ? 'instanceId' : 'objectId');
    const fields = batch ? ['position'] : selected.has(identity?.value) ? ['position', 'size'] : [];
    if (identity) Object.defineProperty(result, 'objectId', identity);
    for (const key of fields) {
      const property = Object.getOwnPropertyDescriptor(actor, key);
      if (property) Object.defineProperty(result, key, property);
    }
    return result;
  });
}
function geometryRequest(request) {
  try { return dispatchStudioCore({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, ...request }); }
  catch (error) { if (error.errorCode === 'studio_core_request_invalid') invalid(); throw error; }
}
export function moveSceneSelection(actors, ids, delta, snap = 0) {
  return geometryRequest({ operation: 'move', actors: geometryActors(actors, false, ids), ids, delta, snap });
}
export function alignSceneSelection(actors, ids, alignment) {
  return geometryRequest({ operation: 'align', actors: geometryActors(actors, false, ids), ids, alignment });
}

// Shared geometry session for saved layouts and source-only layouts. The helper
// has no persistence command or authoring revision; each caller owns its own
// source validation and commit boundary. Only opaque identities cross into Rust.
export function createSceneGeometryDraft(originalActors, resolvedActors, { onMutation = () => {} } = {}) {
  const original = clone(originalActors), resolved = clone(resolvedActors);
  let snapshot = dispatchStudioCoreDraft({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'layoutDraft.create', actors: geometryActors(original, true) });
  const draftId = snapshot.draftId;
  let disposed = false;
  const alive = () => {
    if (disposed) throw Object.assign(new Error('This scene layout draft has been closed.'), { errorCode: 'scene_layout_draft_invalid' });
  };
  const positions = () => new Map(snapshot.positions.map(actor => [actor.objectId, actor.position]));
  const actors = () => {
    alive(); const current = positions();
    return resolved.map(actor => ({ ...clone(actor), position: current.get(sceneActorIdentity(actor)).slice() }));
  };
  function mutate(operation, fields = {}) {
    alive();
    let next;
    try { next = dispatchStudioCoreDraft({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: `layoutDraft.${operation}`, draftId, ...fields }); }
    catch (error) { if (operation === 'setPositions' && error.errorCode === 'studio_core_request_invalid') invalid(); throw error; }
    if (next.positions.length !== original.length || next.positions.some((actor, index) => actor.objectId !== sceneActorIdentity(original[index]))) {
      throw Object.assign(new Error('The Rust core returned a different scene actor set.'), { errorCode: 'studio_core_unavailable' });
    }
    snapshot = next; onMutation(); return snapshot.changed;
  }
  const setPositions = changes => mutate('setPositions', { changes });
  return {
    get draftId() { alive(); return draftId; },
    assertAlive: alive,
    actors,
    currentPosition(id) { alive(); return positions().get(id)?.slice() || null; },
    state() { alive(); return { ...snapshot.state }; },
    setPositions,
    setPosition(id, value) { return setPositions([{ objectId: id, position: value }]); },
    move(ids, delta, snap = 0) { return setPositions(moveSceneSelection(actors(), ids, delta, snap)); },
    align(ids, alignment) { return setPositions(alignSceneSelection(actors(), ids, alignment)); },
    undo() { return mutate('undo'); },
    redo() { return mutate('redo'); },
    reset() { mutate('reset'); },
    dispose() {
      if (disposed) return;
      try { dispatchStudioCoreDraft({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'layoutDraft.close', draftId }); }
      finally { disposed = true; }
    },
  };
}

// Rust owns draft positions, dirty state and bounded undo/redo. The caller must
// dispose the session when its editor closes. Saved declaration fields are never
// reconstructed from resolved actors: doing so would erase inheritance and null
// image suppression. Exact source formatting is retained by scene.update.
export function createSceneLayoutDraft(payload) {
  const context = payload?.sceneEditing, scene = payload?.scene;
  if (!plain(context) || !uuid(scene?.objectId) || typeof scene.sourcePath !== 'string'
    || typeof context.worldId !== 'string' || !context.worldId || context.worldId.length > 200
    || !['baseRevision', 'objectRevision', 'sourceRevision'].every(key => revision(context[key]))
    || context.sourceRevision !== scene.sourceRevision || typeof context.content !== 'string'
    || context.content.length > 262144 || !Array.isArray(payload.actors)) return null;
  let declaration;
  try { declaration = parse(context.content); } catch { return null; }
  if (!plain(declaration) || declaration.format !== 'viento-scene2d' || ![1, 2, 3].includes(declaration.schemaVersion)
    || !Array.isArray(declaration.actors) || !declaration.actors.length || declaration.actors.length > 128
    || declaration.actors.length !== payload.actors.length) return null;
  if (declaration.schemaVersion === 3) {
    try {
      if (!validateSceneGroups(declaration).ok) return null;
      const structure = createSceneStructure(declaration);
      if (payload.sceneStructure !== undefined) {
        sceneStructureActors(payload.sceneStructure, payload.actors);
        if (canonicalJson(payload.sceneStructure) !== canonicalJson(structure)) return null;
      }
    } catch { return null; }
  } else if (payload.sceneStructure !== undefined) return null;
  const identities = new Set();
  for (const [index, actor] of declaration.actors.entries()) {
    const resolved = payload.actors[index];
    const key = declaration.schemaVersion >= 2 ? actor?.instanceId : actor?.objectId;
    if (!plain(actor) || !uuid(actor.objectId) || !uuid(key) || identities.has(key) || !position(actor.position)
      || declaration.schemaVersion === 1 && (Object.hasOwn(actor, 'instanceId') || Object.hasOwn(resolved || {}, 'instanceId'))
      || declaration.schemaVersion >= 2 && resolved?.instanceId !== key
      || resolved?.objectId !== actor.objectId || !position(resolved.position) || !samePosition(actor.position, resolved.position)) return null;
    identities.add(key);
  }
  const original = clone(declaration), savedActors = clone(payload.actors);
  const sourceContent = context.content, sourcePath = scene.sourcePath;
  const base = { worldId: context.worldId, baseRevision: context.baseRevision, objectId: scene.objectId,
    objectRevision: context.objectRevision, sourceRevision: context.sourceRevision };
  const geometry = createSceneGeometryDraft(original.actors, savedActors, { onMutation: () => saveRequest('read') });
  const draftId = geometry.draftId, alive = geometry.assertAlive;
  let saveSnapshot;
  try { saveSnapshot = dispatchStudioCoreSave({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'layoutSave.read', draftId }); }
  catch (error) {
    // Older cores may support drafts but not the save workflow. Do not consume
    // their finite session slots when the editor cannot finish opening.
    try { geometry.dispose(); } catch {}
    throw error;
  }
  const candidate = () => {
    alive();
    return { ...clone(original), actors: original.actors.map(actor => ({ ...clone(actor), position: geometry.currentPosition(sceneActorIdentity(actor)) })) };
  };
  function saveRequest(operation, fields = {}) {
    alive();
    saveSnapshot = dispatchStudioCoreSave({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: `layoutSave.${operation}`, draftId, ...fields });
    return { ...saveSnapshot.state };
  }
  return {
    get base() { alive(); const { objectId, ...versions } = base; return { ...versions, content: sourceContent, sceneId: objectId, sourcePath }; },
    currentPosition: geometry.currentPosition,
    actors: geometry.actors,
    state: geometry.state,
    saveState() { alive(); return { ...saveSnapshot.state }; },
    beginSave(action, { editable = true, inputPending = false } = {}) { return saveRequest('begin', { action, editable, inputPending }); },
    resolveSave(requestId, outcome, errorCode = null) { return saveRequest('resolve', { requestId, outcome, errorCode }); },
    finishSaveRefresh(requestId) { return saveRequest('refreshed', { requestId }); },
    invalidateSave() { return saveRequest('invalidate'); },
    setPositions: geometry.setPositions,
    setPosition: geometry.setPosition,
    move: geometry.move,
    align: geometry.align,
    undo: geometry.undo,
    redo: geometry.redo,
    reset: geometry.reset,
    dispose: geometry.dispose,
    command(mode = 'preview') {
      alive();
      if (!['preview', 'apply'].includes(mode)) throw new TypeError('Scene layout commands support preview or apply.');
      const content = geometry.state().dirty ? JSON.stringify(candidate()) : sourceContent;
      if (content.length > 262144) throw Object.assign(new Error('Scene layout exceeds the command source limit.'), { errorCode: 'scene_layout_content_limit' });
      return { command: 'scene.update', mode, ...base, actorRef: { kind: 'user', id: 'local-ui' }, content };
    },
    matches(content) {
      alive();
      try { return typeof content === 'string' && canonicalJson(parse(content)) === canonicalJson(candidate()); } catch { return false; }
    },
  };
}
