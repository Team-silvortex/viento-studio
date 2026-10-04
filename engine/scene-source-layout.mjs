// Local source edits only. This module has no World command, document writer or
// saved-scene precondition. Its caller owns the editor session and must recheck
// that session after asynchronous preparation before replacing text in memory.
import { dispatchStudioCoreSource, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { sceneActorIdentity } from './scene-identity.mjs';
import { createSceneStructure, sceneStructureActors } from './scene-structure.mjs';
import { createSceneGeometryDraft } from './scene-layout.mjs';
import { MAX_SCENE_DRAFT_BYTES } from './scene-preview-contract.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const position = value => Array.isArray(value) && value.length === 2 && Array.from(value).every(item => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 100000);
const samePosition = (left, right) => left[0] === right[0] && left[1] === right[1];
const fail = (code = 'scene_source_layout_invalid', message = 'The source layout does not match a valid scene draft.') => {
  throw Object.assign(new TypeError(message), { errorCode: code });
};
const conflict = () => fail('scene_source_layout_conflict', 'The scene source or its saved baseline changed. Reopen the current draft layout.');

function checkContent(content) {
  if (typeof content !== 'string') fail();
  if (content.length > MAX_SCENE_DRAFT_BYTES) fail('scene_source_layout_content_limit', 'The scene source exceeds 128 KiB.');
  for (const character of content) {
    const code = character.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) fail();
  }
  if (new TextEncoder().encode(content).length > MAX_SCENE_DRAFT_BYTES) fail('scene_source_layout_content_limit', 'The scene source exceeds 128 KiB.');
}
function sourceSnapshot(source) {
  if (!exact(source, ['sourcePath', 'baseSourceRevision', 'content']) || typeof source.sourcePath !== 'string'
    || !source.sourcePath.length || source.sourcePath.length > 4096 || !source.sourcePath.toLowerCase().endsWith('.json')
    || !revision(source.baseSourceRevision)) fail();
  checkContent(source.content);
  return { sourcePath: source.sourcePath, baseSourceRevision: source.baseSourceRevision, content: source.content };
}
async function hashSource(content, digest) {
  if (typeof digest !== 'function') fail();
  const hash = await digest(content);
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) fail();
  return `sha256:${hash}`;
}
function sourceRequest(operation, content, fields = {}) {
  checkContent(content);
  try { return dispatchStudioCoreSource({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: `sceneSource.${operation}`, content, ...fields }); }
  catch (error) {
    if (['studio_core_request_invalid', 'studio_core_input_limit'].includes(error.errorCode)) fail();
    throw error;
  }
}
function parseSceneSource(content) {
  // Rust owns syntax, decoded duplicate keys, identities, groups and geometry.
  // JSON.parse only decodes the already-checked source for provenance matching;
  // its value is never used to reserialize or replace the author's whole file.
  sourceRequest('inspect', content);
  return { value: JSON.parse(content.replace(/^\uFEFF/, '')) };
}

/** Rust replaces only changed coordinate tokens; other source bytes survive. */
export function patchSceneSourcePositions(content, changes) {
  return sourceRequest('patch', content, { changes });
}

/** Bind Rust positions/history to one exact, already-previewed editor source. */
export async function createSceneSourceLayoutDraft(model, source, { digest } = {}) {
  const before = sourceSnapshot(source), parsed = parseSceneSource(before.content), declaration = parsed.value;
  if (!plain(model) || model.ok !== true || model.format !== 'viento-scene-preview'
    || model.schemaVersion !== (declaration.schemaVersion === 1 ? 1 : 2) || Object.hasOwn(model, 'sceneEditing')
    || !uuid(model.scene?.objectId) || !exact(model.draft, ['baseSourceRevision', 'sourceRevision'])
    || !revision(model.draft.sourceRevision) || !revision(model.draft.baseSourceRevision)
    || !Array.isArray(model.actors) || model.actors.length !== declaration.actors.length) fail();
  if (model.scene.sourcePath !== before.sourcePath || model.draft.baseSourceRevision !== before.baseSourceRevision
    || model.scene.sourceRevision !== model.draft.sourceRevision) conflict();
  if (declaration.schemaVersion === 3) {
    try {
      sceneStructureActors(model.sceneStructure, model.actors);
      if (canonicalJson(model.sceneStructure) !== canonicalJson(createSceneStructure(declaration))) fail();
    } catch { fail(); }
  } else if (model.sceneStructure !== undefined) fail();
  for (const [index, actor] of declaration.actors.entries()) {
    const resolved = model.actors[index];
    if (!plain(resolved) || resolved.objectId !== actor.objectId || !position(resolved.position)
      || !samePosition(resolved.position, actor.position)
      || declaration.schemaVersion === 1 && Object.hasOwn(resolved, 'instanceId')
      || declaration.schemaVersion >= 2 && resolved.instanceId !== actor.instanceId) fail();
  }
  // Detach before awaiting the digest. A mutable caller cannot switch the scene
  // or geometry while an asynchronous hash is pending.
  const sceneId = model.scene.objectId, expectedRevision = model.draft.sourceRevision, resolvedActors = clone(model.actors);
  const sourceRevision = await hashSource(before.content, digest);
  if (sourceRevision !== expectedRevision) conflict();
  const geometry = createSceneGeometryDraft(declaration.actors, resolvedActors);
  return {
    actors: geometry.actors,
    state: geometry.state,
    currentPosition: geometry.currentPosition,
    setPositions: geometry.setPositions,
    setPosition: geometry.setPosition,
    move: geometry.move,
    align: geometry.align,
    undo: geometry.undo,
    redo: geometry.redo,
    reset: geometry.reset,
    dispose: geometry.dispose,
    propose() {
      geometry.assertAlive();
      const changes = declaration.actors.flatMap(actor => {
        const objectId = sceneActorIdentity(actor), current = geometry.currentPosition(objectId);
        return samePosition(actor.position, current) ? [] : [{ objectId, position: current }];
      });
      const { afterContent } = patchSceneSourcePositions(before.content, changes);
      return { sceneId, sourcePath: before.sourcePath, baseSourceRevision: before.baseSourceRevision, sourceRevision, changes, afterContent };
    },
  };
}

/** Prepare a local text replacement; the caller must still recheck its owner. */
export async function prepareSceneSourceLayoutApply(current, proposal, { digest } = {}) {
  const source = sourceSnapshot(current);
  if (!exact(proposal, ['sceneId', 'sourcePath', 'baseSourceRevision', 'sourceRevision', 'changes', 'afterContent'])
    || !uuid(proposal.sceneId) || !revision(proposal.sourceRevision) || !revision(proposal.baseSourceRevision)
    || typeof proposal.sourcePath !== 'string' || typeof proposal.afterContent !== 'string') fail();
  if (source.sourcePath !== proposal.sourcePath || source.baseSourceRevision !== proposal.baseSourceRevision) conflict();
  const prepared = patchSceneSourcePositions(source.content, proposal.changes);
  const expectedRevision = proposal.sourceRevision, expectedContent = proposal.afterContent;
  if (await hashSource(source.content, digest) !== expectedRevision) conflict();
  if (prepared.afterContent !== expectedContent) fail();
  return prepared;
}
