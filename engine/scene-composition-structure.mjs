// Shared recipe structure remains source-owned. IDs are supplied explicitly by
// the host/UI once; this pure layer neither allocates identities nor saves.
import { createSceneCompositionOverrideDraft } from './scene-composition-overrides.mjs';
import { expandSceneComposition, MAX_SCENE_COMPOSITION_BYTES } from './scene-composition.mjs';
import { dispatchStudioCoreCompositionStructure, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
import { canonicalJson } from './canonical-json.mjs';

const FIELDS = ['position', 'size', 'color', 'speed', 'controls', 'imageResourceId'];
const ACTOR_FIELDS = ['key', 'objectId', 'position', 'groupKey', 'useProjectionDefaults', ...FIELDS.filter(field => field !== 'position')];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const key = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = (code = 'scene_composition_structure_invalid') => { throw Object.assign(new TypeError('The shared structure edit does not match the recipe source.'), { errorCode: code }); };
const conflict = () => fail('scene_composition_structure_conflict');

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
  if (new TextEncoder().encode(source.content).length > MAX_SCENE_COMPOSITION_BYTES) fail('scene_composition_structure_content_limit');
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
  const edit = clone(input), adding = edit?.action === 'add';
  if (!exact(edit, adding ? ['action', 'fragmentId', 'actor', 'instances'] : ['action', 'fragmentId', 'actorKey'])
    || !['add', 'remove'].includes(edit.action) || !key(edit.fragmentId)) fail();
  const fragment = parsed.value.fragments.find(fragment => fragment.fragmentId === edit.fragmentId); if (!fragment) fail();
  const placements = parsed.value.placements.filter(placement => placement.fragmentId === edit.fragmentId);
  if (adding) {
    const actor = edit.actor;
    if (!plain(actor) || Object.keys(actor).some(field => !ACTOR_FIELDS.includes(field)) || !['key', 'objectId', 'position'].every(field => Object.hasOwn(actor, field))
      || !key(actor.key) || !uuid(actor.objectId) || fragment.actors.some(item => item.key === actor.key)
      || !Array.isArray(edit.instances) || edit.instances.length !== placements.length) fail();
    const identities = new Set([sceneId, ...parsed.value.placements.flatMap(placement => [placement.placementId, ...Object.values(placement.actorIds), ...Object.values(placement.groupIds)])]);
    const instances = edit.instances.map((instance, index) => {
      if (!exact(instance, ['placementId', 'instanceId']) || instance.placementId !== placements[index].placementId || !uuid(instance.instanceId) || identities.has(instance.instanceId)) fail();
      identities.add(instance.instanceId); return { placementId: instance.placementId, instanceId: instance.instanceId };
    });
    return { action: 'add', fragmentId: edit.fragmentId, actor: Object.fromEntries(ACTOR_FIELDS.filter(field => Object.hasOwn(actor, field)).map(field => [field, actor[field]])), instances };
  }
  if (!key(edit.actorKey) || fragment.actors.length < 2 || !fragment.actors.some(actor => actor.key === edit.actorKey)) fail();
  return { action: 'remove', fragmentId: edit.fragmentId, actorKey: edit.actorKey };
}
function targets(parsed, edit) {
  return parsed.value.placements.filter(placement => placement.fragmentId === edit.fragmentId).map((placement, index) => {
    const actorKey = edit.action === 'add' ? edit.actor.key : edit.actorKey;
    const values = placement.overrides?.find(item => item.actorKey === actorKey)?.values || {};
    return { placementId: placement.placementId, instanceId: edit.action === 'add' ? edit.instances[index].instanceId : placement.actorIds[actorKey],
      actorKey, overrides: edit.action === 'add' ? [] : FIELDS.filter(field => Object.hasOwn(values, field)) };
  });
}
function patch(content, edit) {
  try {
    return dispatchStudioCoreCompositionStructure({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
      operation: edit.action === 'add' ? 'sceneComposition.addFragmentActor' : 'sceneComposition.removeFragmentActor', content, fragmentId: edit.fragmentId,
      ...(edit.action === 'add' ? { actor: edit.actor, instances: edit.instances } : { actorKey: edit.actorKey }) });
  } catch (error) {
    if (error.errorCode === 'scene_composition_limit') fail('scene_composition_structure_content_limit');
    if (error.errorCode === 'scene_composition_invalid' || error.errorCode === 'studio_core_request_invalid') fail();
    throw error;
  }
}

/** Bind the whole preview once; unused fragments are source declarations too. */
export async function createSceneCompositionStructureDraft(model, source, { digest } = {}) {
  const before = sourceSnapshot(source), preview = clone(model), parsed = decoded(before.content);
  if (!uuid(preview.actors?.[0]?.instanceId)) fail();
  try { await createSceneCompositionOverrideDraft(preview, before, preview.actors[0].instanceId, { digest }); }
  catch (error) { if (error.errorCode === 'scene_composition_override_conflict') conflict(); if (error.errorCode?.startsWith('scene_composition_override_')) fail(); throw error; }
  checkProvenance(preview, parsed, before);
  const sceneId = preview.scene.objectId, sourceRevision = preview.composition.sourceRevision;
  const fragments = freeze(parsed.value.fragments.map(fragment => ({ fragmentId: fragment.fragmentId, actors: clone(fragment.actors), groups: clone(fragment.groups),
    placements: parsed.value.placements.filter(placement => placement.fragmentId === fragment.fragmentId).map(placement => ({ placementId: placement.placementId,
      offset: Object.hasOwn(placement, 'offset') ? clone(placement.offset) : null, actorIds: clone(placement.actorIds), groupIds: clone(placement.groupIds),
      overrides: Object.hasOwn(placement, 'overrides') ? clone(placement.overrides) : null })) })));
  return Object.freeze({ fragments, propose(input) {
    const edit = canonicalEdit(input, parsed, sceneId), prepared = patch(before.content, edit);
    return { sceneId, sourcePath: before.sourcePath, baseSourceRevision: before.baseSourceRevision, sourceRevision,
      edit: clone(edit), targets: targets(parsed, edit), afterContent: prepared.afterContent, changedPaths: [...prepared.changedPaths] };
  } });
}

/** Host apply binds the complete edit, affected stable IDs and exact receipt. */
export async function prepareSceneCompositionStructureApply(current, proposal, { digest } = {}) {
  const source = sourceSnapshot(current), expected = clone(proposal);
  if (!exact(expected, ['sceneId', 'sourcePath', 'baseSourceRevision', 'sourceRevision', 'edit', 'targets', 'afterContent', 'changedPaths'])
    || !uuid(expected.sceneId) || !revision(expected.baseSourceRevision) || !revision(expected.sourceRevision)
    || typeof expected.sourcePath !== 'string' || typeof expected.afterContent !== 'string' || !Array.isArray(expected.changedPaths) || !Array.isArray(expected.targets)) fail();
  if (source.sourcePath !== expected.sourcePath || source.baseSourceRevision !== expected.baseSourceRevision) conflict();
  if (await hash(source.content, digest) !== expected.sourceRevision) conflict();
  const parsed = decoded(source.content), edit = canonicalEdit(expected.edit, parsed, expected.sceneId), related = targets(parsed, edit);
  if (!same(edit, expected.edit) || !same(related, expected.targets)) fail();
  const prepared = patch(source.content, edit);
  if (!prepared.changedPaths.length || prepared.afterContent !== expected.afterContent || !same(prepared.changedPaths, expected.changedPaths)) fail();
  return { afterContent: prepared.afterContent, changedPaths: [...prepared.changedPaths] };
}
