// A placement offset is an author declaration; actor-local positions and
// fragment defaults remain owned by their existing edit domains.
import { createSceneCompositionOverrideDraft } from './scene-composition-overrides.mjs';
import { expandSceneComposition, MAX_SCENE_COMPOSITION_BYTES } from './scene-composition.mjs';
import { dispatchStudioCoreCompositionPlacement, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
import { canonicalJson } from './canonical-json.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const key = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const fail = (code = 'scene_composition_override_invalid') => {
  throw Object.assign(new TypeError('The placement offset edit does not match the current recipe source.'), { errorCode: code });
};
const conflict = () => fail('scene_composition_override_conflict');
const unchanged = () => fail('scene_composition_override_unchanged');
function clone(value) { try { return JSON.parse(JSON.stringify(value)); } catch { fail(); } }
function sourceSnapshot(source) {
  if (!exact(source, ['sourcePath', 'baseSourceRevision', 'content']) || typeof source.sourcePath !== 'string'
    || !source.sourcePath.length || source.sourcePath.length > 4096 || !source.sourcePath.toLowerCase().endsWith('.json')
    || !revision(source.baseSourceRevision) || typeof source.content !== 'string') fail();
  if (source.content.length > MAX_SCENE_COMPOSITION_BYTES || new TextEncoder().encode(source.content).length > MAX_SCENE_COMPOSITION_BYTES) fail('scene_composition_override_content_limit');
  for (const character of source.content) if (character.codePointAt(0) >= 0xd800 && character.codePointAt(0) <= 0xdfff) fail();
  return { ...source };
}
function offsetSnapshot(offset) {
  if (offset === null) return null;
  if (!Array.isArray(offset) || offset.length !== 2 || Reflect.ownKeys(offset).length !== 3) fail();
  const result = [];
  for (let index = 0; index < 2; index++) {
    const property = Object.getOwnPropertyDescriptor(offset, String(index));
    if (!property || !Object.hasOwn(property, 'value') || !property.enumerable || typeof property.value !== 'number'
      || !Number.isFinite(property.value) || Math.abs(property.value) > 100000) fail();
    result.push(property.value);
  }
  return result;
}
async function hash(content, digest) {
  if (typeof digest !== 'function') fail();
  const value = await digest(content);
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail();
  return `sha256:${value}`;
}
function decoded(content) {
  const expanded = expandSceneComposition(content);
  return { value: JSON.parse(content.replace(/^\uFEFF/, '')), expanded };
}
function targetFor(parsed, instanceId, placementId, fragmentId) {
  if (!uuid(instanceId)) fail();
  const entry = parsed.expanded.sourceMap.actors.find(item => item.instanceId === instanceId);
  if (!entry || placementId !== undefined && placementId !== entry.placementId || fragmentId !== undefined && fragmentId !== entry.fragmentId) fail();
  const placement = parsed.value.placements.find(item => item.placementId === entry.placementId);
  const fragment = parsed.value.fragments.find(item => item.fragmentId === entry.fragmentId);
  return { entry, offset: Object.hasOwn(placement, 'offset') ? offsetSnapshot(placement.offset) : null,
    targets: fragment.actors.map(actor => ({ instanceId: placement.actorIds[actor.key], actorKey: actor.key })),
    groups: fragment.groups.map(group => ({ groupId: placement.groupIds[group.key], groupKey: group.key })) };
}
function checkProvenance(preview, parsed, source) {
  for (const [kind, identity] of [['actors', 'instanceId'], ['groups', 'groupId']]) {
    const expected = parsed.expanded.sourceMap[kind], actual = preview.sourceLocations?.[kind];
    if (!Array.isArray(actual) || actual.length !== expected.length) fail();
    for (const [index, entry] of expected.entries()) {
      const location = actual[index];
      if (!plain(location) || location[identity] !== entry[identity]
        || !exact(location.composition, ['fragmentId', 'placementId', 'localKey'])
        || location.composition.fragmentId !== entry.fragmentId || location.composition.placementId !== entry.placementId
        || location.composition.localKey !== entry.localKey || location.declaration?.objectId !== preview.scene.objectId
        || location.declaration?.sourcePath !== source.sourcePath || location.declaration?.sourceRevision !== preview.composition.sourceRevision
        || kind === 'actors' && location.objectId !== parsed.expanded.scene.actors[index].objectId) fail();
    }
  }
}
function patch(content, target, offset) {
  return dispatchStudioCoreCompositionPlacement({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'sceneComposition.editPlacementOffset', content, placementId: target.entry.placementId, offset });
}
function netOffset(target, input) {
  const offset = offsetSnapshot(input);
  if (same(offset, target.offset)) unchanged();
  return offset;
}

/** Bind an entire saved/current-draft recipe and its actor/group provenance. */
export async function createSceneCompositionPlacementDraft(model, source, actorId, { digest } = {}) {
  const before = sourceSnapshot(source), preview = clone(model), parsed = decoded(before.content), target = targetFor(parsed, actorId);
  // The established binding validates the whole scene structure and effective
  // actor model once. All caller state above is copied before its first await.
  await createSceneCompositionOverrideDraft(preview, before, actorId, { digest });
  checkProvenance(preview, parsed, before);
  const sceneId = preview.scene.objectId, sourceRevision = preview.composition.sourceRevision;
  return { instanceId: actorId, placementId: target.entry.placementId, fragmentId: target.entry.fragmentId,
    offset: clone(target.offset), targets: clone(target.targets), groups: clone(target.groups),
    propose(input) {
      const offset = netOffset(target, input), prepared = patch(before.content, target, offset);
      if (!prepared.changedPaths.length) unchanged();
      return { sceneId, sourcePath: before.sourcePath, baseSourceRevision: before.baseSourceRevision, sourceRevision,
        instanceId: actorId, placementId: target.entry.placementId, fragmentId: target.entry.fragmentId,
        offset: clone(offset), targets: clone(target.targets), groups: clone(target.groups),
        afterContent: prepared.afterContent, changedPaths: [...prepared.changedPaths] };
    } };
}

/** Recompute source identity, related IDs and the exact Rust patch before save. */
export async function prepareSceneCompositionPlacementApply(current, proposal, { digest } = {}) {
  const source = sourceSnapshot(current);
  if (!exact(proposal, ['sceneId', 'sourcePath', 'baseSourceRevision', 'sourceRevision', 'instanceId', 'placementId', 'fragmentId', 'offset', 'targets', 'groups', 'afterContent', 'changedPaths'])
    || !uuid(proposal.sceneId) || !uuid(proposal.instanceId) || !uuid(proposal.placementId) || !key(proposal.fragmentId)
    || !revision(proposal.sourceRevision) || !revision(proposal.baseSourceRevision) || typeof proposal.sourcePath !== 'string'
    || typeof proposal.afterContent !== 'string' || !Array.isArray(proposal.changedPaths)
    || !Array.isArray(proposal.targets) || !Array.isArray(proposal.groups)) fail();
  // Validate and detach offset itself before generic cloning, so accessors,
  // sparse arrays and extra properties cannot masquerade as a valid pair.
  const offset = offsetSnapshot(proposal.offset), expected = clone(proposal);
  if (expected.targets.some(target => !exact(target, ['instanceId', 'actorKey']) || !uuid(target.instanceId) || !key(target.actorKey))
    || expected.groups.some(group => !exact(group, ['groupId', 'groupKey']) || !uuid(group.groupId) || !key(group.groupKey))) fail();
  if (source.sourcePath !== expected.sourcePath || source.baseSourceRevision !== expected.baseSourceRevision) conflict();
  if (await hash(source.content, digest) !== expected.sourceRevision) conflict();
  const parsed = decoded(source.content), target = targetFor(parsed, expected.instanceId, expected.placementId, expected.fragmentId);
  if (!same(target.targets, expected.targets) || !same(target.groups, expected.groups)) fail();
  const prepared = patch(source.content, target, netOffset(target, offset));
  if (!prepared.changedPaths.length || prepared.afterContent !== expected.afterContent || !same(prepared.changedPaths, expected.changedPaths)) fail();
  return { afterContent: prepared.afterContent, changedPaths: [...prepared.changedPaths] };
}
