// Placement structure remains source-owned. IDs are supplied explicitly by
// the host/UI once; this pure layer neither allocates identities nor saves.
import { createSceneCompositionOverrideDraft } from './scene-composition-overrides.mjs';
import { expandSceneComposition, MAX_SCENE_COMPOSITION_BYTES } from './scene-composition.mjs';
import { dispatchStudioCoreCompositionPlacements, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
import { canonicalJson } from './canonical-json.mjs';

const FIELDS = ['position', 'size', 'color', 'speed', 'controls', 'imageResourceId'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const key = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = (code = 'scene_composition_placements_invalid') => { throw Object.assign(new TypeError('The shared structure edit does not match the recipe source.'), { errorCode: code }); };
const conflict = () => fail('scene_composition_placements_conflict');

// Snapshots never execute accessors/serializers or erase non-JSON intentions.
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
  if (new TextEncoder().encode(source.content).length > MAX_SCENE_COMPOSITION_BYTES) fail('scene_composition_placements_content_limit');
  return source;
}
async function hash(content, digest) {
  if (typeof digest !== 'function') fail();
  const result = await digest(content); if (typeof result !== 'string' || !/^[a-f0-9]{64}$/.test(result)) fail(); return `sha256:${result}`;
}
function decoded(content) { return { expanded: expandSceneComposition(content), value: JSON.parse(content.replace(/^\uFEFF/, '')) }; }
function checkProvenance(preview, parsed, source) {
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
function canonicalEdit(input, parsed, sceneId) {
  const edit = clone(input), adding = edit?.action === 'add', copying = edit?.action === 'copy', removing = edit?.action === 'remove';
  const required = ['action','placementId',...(adding ? ['fragmentId','actorIds','groupIds'] : copying ? ['sourcePlacementId','actorIds','groupIds'] : [])];
  if ((!adding && !copying && !removing) || !plain(edit) || required.some(name => !Object.hasOwn(edit,name))
    || Object.keys(edit).some(name => !required.includes(name) && !(adding && name === 'offset')) || !uuid(edit.placementId)) fail();
  if (removing) {
    if (parsed.value.placements.length < 2 || !parsed.value.placements.some(placement => placement.placementId === edit.placementId)) fail();
    return { action:'remove',placementId:edit.placementId };
  }
  const original = copying ? parsed.value.placements.find(placement => placement.placementId === edit.sourcePlacementId) : null;
  if (copying && (!uuid(edit.sourcePlacementId) || !original)) fail();
  const fragmentId = copying ? original.fragmentId : edit.fragmentId;
  if (!key(fragmentId)) fail();
  const fragment = parsed.value.fragments.find(fragment => fragment.fragmentId === fragmentId); if (!fragment) fail();
  const identities = new Set([sceneId,...parsed.value.placements.flatMap(placement => [placement.placementId,...Object.values(placement.actorIds),...Object.values(placement.groupIds)])]);
  if (identities.has(edit.placementId)) fail(); identities.add(edit.placementId);
  const maps = {};
  for (const [name,declarations] of [['actorIds',fragment.actors],['groupIds',fragment.groups]]) {
    if (!plain(edit[name]) || Object.keys(edit[name]).length !== declarations.length) fail();
    maps[name] = Object.fromEntries(declarations.map(declaration => {
      const id = edit[name][declaration.key]; if (!uuid(id) || identities.has(id)) fail(); identities.add(id); return [declaration.key,id];
    }));
  }
  if (adding && Object.hasOwn(edit,'offset') && (!Array.isArray(edit.offset) || edit.offset.length !== 2 || edit.offset.some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 100000))) fail();
  return { action:edit.action,...(adding ? {fragmentId} : {sourcePlacementId:edit.sourcePlacementId}),placementId:edit.placementId,...maps,
    ...(adding && Object.hasOwn(edit,'offset') ? {offset:clone(edit.offset)} : {}) };
}
function targets(parsed,edit) {
  const placement = edit.action === 'remove' ? parsed.value.placements.find(item => item.placementId === edit.placementId)
    : edit.action === 'copy' ? { ...parsed.value.placements.find(item => item.placementId === edit.sourcePlacementId),placementId:edit.placementId,actorIds:edit.actorIds,groupIds:edit.groupIds }
    : {placementId:edit.placementId,fragmentId:edit.fragmentId,actorIds:edit.actorIds,groupIds:edit.groupIds};
  const fragment = parsed.value.fragments.find(item => item.fragmentId === placement.fragmentId);
  return {placementId:placement.placementId,fragmentId:placement.fragmentId,
    actors:fragment.actors.map(actor => ({actorKey:actor.key,instanceId:placement.actorIds[actor.key],objectId:actor.objectId})),
    groups:fragment.groups.map(group => ({groupKey:group.key,groupId:placement.groupIds[group.key]})),
    overrides:(placement.overrides || []).map(item => ({actorKey:item.actorKey,fields:FIELDS.filter(field => Object.hasOwn(item.values,field))}))};
}
function patch(content,edit) {
  const {action,...request} = edit;
  try { return dispatchStudioCoreCompositionPlacements({protocolVersion:STUDIO_CORE_PROTOCOL_VERSION,
    operation:{add:'sceneComposition.addPlacement',copy:'sceneComposition.copyPlacement',remove:'sceneComposition.removePlacement'}[action],content,...request}); }
  catch(error) {
    if (error.errorCode === 'scene_composition_limit') fail('scene_composition_placements_content_limit');
    if (error.errorCode === 'scene_composition_invalid' || error.errorCode === 'studio_core_request_invalid') fail(); throw error;
  }
}
/** Bind every actor and group once; placement declarations remain source-owned. */
export async function createSceneCompositionPlacementsDraft(model, source, { digest } = {}) {
  const before = sourceSnapshot(source), preview = clone(model), parsed = decoded(before.content);
  if (!plain(preview) || !uuid(preview.actors?.[0]?.instanceId)) fail();
  try { await createSceneCompositionOverrideDraft(preview,before,preview.actors[0].instanceId,{digest}); }
  catch(error) { if (error.errorCode === 'scene_composition_override_conflict') conflict(); if (error.errorCode?.startsWith('scene_composition_override_')) fail(); throw error; }
  checkProvenance(preview,parsed,before);
  const sceneId = preview.scene.objectId, sourceRevision = preview.composition.sourceRevision;
  return Object.freeze({fragments:freeze(clone(parsed.value.fragments)),placements:freeze(clone(parsed.value.placements)),propose(input) {
    const edit = canonicalEdit(input,parsed,sceneId), prepared = patch(before.content,edit);
    return {sceneId,sourcePath:before.sourcePath,baseSourceRevision:before.baseSourceRevision,sourceRevision,edit:clone(edit),targets:targets(parsed,edit),
      afterContent:prepared.afterContent,changedPaths:[...prepared.changedPaths]};
  }});
}
/** Host recomputes the complete edit, target identities and exact token receipt. */
export async function prepareSceneCompositionPlacementsApply(current, proposal, { digest } = {}) {
  const source = sourceSnapshot(current), expected = clone(proposal);
  if (!exact(expected,['sceneId','sourcePath','baseSourceRevision','sourceRevision','edit','targets','afterContent','changedPaths'])
    || !uuid(expected.sceneId) || !revision(expected.baseSourceRevision) || !revision(expected.sourceRevision)
    || typeof expected.sourcePath !== 'string' || typeof expected.afterContent !== 'string' || !Array.isArray(expected.changedPaths) || !plain(expected.targets)) fail();
  if (source.sourcePath !== expected.sourcePath || source.baseSourceRevision !== expected.baseSourceRevision) conflict();
  if (await hash(source.content,digest) !== expected.sourceRevision) conflict();
  const parsed = decoded(source.content),edit = canonicalEdit(expected.edit,parsed,expected.sceneId),related = targets(parsed,edit);
  if (!same(edit,expected.edit) || !same(related,expected.targets)) fail();
  const prepared = patch(source.content,edit);
  if (!prepared.changedPaths.length || prepared.afterContent !== expected.afterContent || !same(prepared.changedPaths,expected.changedPaths)) fail();
  return {afterContent:prepared.afterContent,changedPaths:[...prepared.changedPaths]};
}
