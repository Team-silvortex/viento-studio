// Raw fragment definitions are source-owned. Adding/copying never places an
// instance or allocates UUIDs; callers own candidate review and ordinary Save.
import { createSceneCompositionOverrideDraft } from './scene-composition-overrides.mjs';
import { expandSceneComposition, MAX_SCENE_COMPOSITION_BYTES } from './scene-composition.mjs';
import { dispatchStudioCoreCompositionDefinitions, dispatchStudioCoreCompositionDefinitionRename, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { createSceneStructure } from './scene-structure.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const key = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = (code = 'scene_composition_definitions_invalid') => { throw Object.assign(new TypeError('The fragment definition edit does not match the recipe source.'), { errorCode: code }); };
const conflict = () => fail('scene_composition_definitions_conflict');
function clone(value, seen = new Set(), depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 150000 || depth > 64) fail();
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) fail();
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if ((!array && ![Object.prototype, null].includes(prototype)) || Object.hasOwn(descriptors, 'toJSON')) fail();
  const keys = Reflect.ownKeys(descriptors), result = array ? [] : {};
  if (array && keys.length !== value.length + 1) fail();
  seen.add(value);
  for (const name of array ? Array.from({ length: value.length }, (_, index) => String(index)) : keys) {
    const item = descriptors[name];
    if (typeof name !== 'string' || !item || !Object.hasOwn(item, 'value') || !item.enumerable) fail();
    Object.defineProperty(result, name, { value: clone(item.value, seen, depth + 1, budget), enumerable: true, writable: true, configurable: true });
  }
  seen.delete(value); return result;
}
function freeze(value) { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
function sourceSnapshot(input) {
  const source = clone(input);
  if (!exact(source, ['sourcePath', 'baseSourceRevision', 'content']) || typeof source.sourcePath !== 'string' || !source.sourcePath.length
    || source.sourcePath.length > 4096 || !source.sourcePath.toLowerCase().endsWith('.json') || !revision(source.baseSourceRevision) || typeof source.content !== 'string') fail();
  if (new TextEncoder().encode(source.content).length > MAX_SCENE_COMPOSITION_BYTES) fail('scene_composition_definitions_content_limit');
  return source;
}
async function hash(content, digest) {
  if (typeof digest !== 'function') fail();
  const result = await digest(content); if (typeof result !== 'string' || !/^[a-f0-9]{64}$/.test(result)) fail(); return `sha256:${result}`;
}
function decoded(content) {
  try { return { expanded: expandSceneComposition(content), value: JSON.parse(content.replace(/^\uFEFF/, '')) }; }
  catch (error) { if (error.errorCode === 'scene_composition_limit') fail('scene_composition_definitions_content_limit'); if (error.errorCode === 'scene_composition_invalid') fail(); throw error; }
}
function checkProvenance(preview, parsed, source) {
  if (!same(preview.sceneStructure, createSceneStructure(parsed.expanded.scene))) fail();
  for (const [kind, identity] of [['actors', 'instanceId'], ['groups', 'groupId']]) {
    const expected = parsed.expanded.sourceMap[kind], actual = preview.sourceLocations?.[kind];
    if (!Array.isArray(actual) || actual.length !== expected.length) fail();
    for (const [index, entry] of expected.entries()) {
      const location = actual[index];
      if (!plain(location) || location[identity] !== entry[identity] || !exact(location.composition, ['fragmentId', 'placementId', 'localKey'])
        || location.composition.fragmentId !== entry.fragmentId || location.composition.placementId !== entry.placementId || location.composition.localKey !== entry.localKey
        || location.declaration?.objectId !== preview.scene.objectId || location.declaration?.sourcePath !== source.sourcePath
        || location.declaration?.sourceRevision !== preview.composition.sourceRevision
        || kind === 'actors' && location.objectId !== parsed.expanded.scene.actors[index].objectId) fail();
    }
  }
}
function canonicalEdit(input, parsed) {
  const edit = clone(input), fields = { add: ['fragment'], copy: ['sourceFragmentId', 'fragmentId'], remove: ['fragmentId'], rename: ['fragmentId', 'newFragmentId'] };
  if (!plain(edit) || typeof edit.action !== 'string' || !Object.hasOwn(fields, edit.action) || !exact(edit, ['action', ...fields[edit.action]])) fail();
  const id = edit.action === 'add' ? edit.fragment?.fragmentId : edit.fragmentId;
  if (!key(id)) fail();
  if (edit.action === 'rename') {
    if (!key(edit.newFragmentId) || !parsed.value.fragments.some(fragment => fragment.fragmentId === id)
      || edit.newFragmentId !== id && parsed.value.fragments.some(fragment => fragment.fragmentId === edit.newFragmentId)) fail();
    return { action: 'rename', fragmentId: id, newFragmentId: edit.newFragmentId };
  }
  if (edit.action === 'remove') {
    if (parsed.value.fragments.length < 2 || !parsed.value.fragments.some(fragment => fragment.fragmentId === id)
      || parsed.value.placements.some(placement => placement.fragmentId === id)) fail();
    return { action: 'remove', fragmentId: id };
  }
  if (parsed.value.fragments.some(fragment => fragment.fragmentId === id)) fail();
  if (edit.action === 'copy') {
    if (!key(edit.sourceFragmentId) || !parsed.value.fragments.some(fragment => fragment.fragmentId === edit.sourceFragmentId)) fail();
    return { action: 'copy', sourceFragmentId: edit.sourceFragmentId, fragmentId: id };
  }
  if (!exact(edit.fragment, ['fragmentId', 'actors', 'groups']) || !Array.isArray(edit.fragment.actors) || !edit.fragment.actors.length || !Array.isArray(edit.fragment.groups)) fail();
  return { action: 'add', fragment: clone(edit.fragment) };
}
function patch(content, edit) {
  const { action, ...request } = edit;
  try { if (action === 'rename') return dispatchStudioCoreCompositionDefinitionRename({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.renameFragmentDefinition', content, ...request });
    return dispatchStudioCoreCompositionDefinitions({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: { add: 'sceneComposition.addFragmentDefinition', copy: 'sceneComposition.copyFragmentDefinition', remove: 'sceneComposition.removeFragmentDefinition' }[action], content, ...request }); }
  catch (error) { if (error.errorCode === 'scene_composition_limit') fail('scene_composition_definitions_content_limit'); if (error.errorCode === 'scene_composition_invalid' || error.errorCode === 'studio_core_request_invalid') fail(); throw error; }
}
/** Bind the complete preview/source, while enumerating unused raw definitions too. */
export async function createSceneCompositionDefinitionsDraft(model, source, { digest } = {}) {
  const before = sourceSnapshot(source), preview = clone(model), parsed = decoded(before.content);
  if (!plain(preview) || !uuid(preview.actors?.[0]?.instanceId)) fail();
  try { await createSceneCompositionOverrideDraft(preview, before, preview.actors[0].instanceId, { digest }); }
  catch (error) { if (error.errorCode === 'scene_composition_override_conflict') conflict(); if (error.errorCode?.startsWith('scene_composition_override_')) fail(); throw error; }
  checkProvenance(preview, parsed, before);
  const fragments = freeze(parsed.value.fragments.map(fragment => ({ ...clone(fragment), placements: clone(parsed.value.placements.filter(placement => placement.fragmentId === fragment.fragmentId)) })));
  return Object.freeze({ fragments, propose(input) {
    const edit = canonicalEdit(input, parsed), prepared = patch(before.content, edit);
    if (!prepared.changedPaths.length) fail(edit.action === 'rename' ? 'scene_composition_definitions_unchanged' : 'scene_composition_definitions_invalid');
    return { sceneId: preview.scene.objectId, sourcePath: before.sourcePath, baseSourceRevision: before.baseSourceRevision, sourceRevision: preview.composition.sourceRevision,
      edit: clone(edit), targets: [], afterContent: prepared.afterContent, changedPaths: [...prepared.changedPaths] };
  } });
}
/** Reconstruct the exact raw definition edit and source receipt before apply. */
export async function prepareSceneCompositionDefinitionsApply(current, proposal, { digest } = {}) {
  const source = sourceSnapshot(current), expected = clone(proposal);
  if (!exact(expected, ['sceneId', 'sourcePath', 'baseSourceRevision', 'sourceRevision', 'edit', 'targets', 'afterContent', 'changedPaths']) || !uuid(expected.sceneId)
    || !revision(expected.baseSourceRevision) || !revision(expected.sourceRevision) || typeof expected.sourcePath !== 'string' || typeof expected.afterContent !== 'string'
    || !Array.isArray(expected.changedPaths) || !Array.isArray(expected.targets) || expected.targets.length) fail();
  if (source.sourcePath !== expected.sourcePath || source.baseSourceRevision !== expected.baseSourceRevision) conflict();
  if (await hash(source.content, digest) !== expected.sourceRevision) conflict();
  const parsed = decoded(source.content), edit = canonicalEdit(expected.edit, parsed);
  if (!same(edit, expected.edit)) fail();
  const prepared = patch(source.content, edit);
  if (!prepared.changedPaths.length && edit.action === 'rename') fail('scene_composition_definitions_unchanged');
  if (!prepared.changedPaths.length || prepared.afterContent !== expected.afterContent || !same(prepared.changedPaths, expected.changedPaths)) fail();
  return { afterContent: prepared.afterContent, changedPaths: [...prepared.changedPaths] };
}
