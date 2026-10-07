// Prepare one instance's local override as an in-memory source replacement.
// Callers own the editor session and must recheck it after every asynchronous
// step. This module has no writer, World command or registration side effect.
import { dispatchStudioCoreCompositionPatch, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
import { expandSceneComposition, MAX_SCENE_COMPOSITION_BYTES } from './scene-composition.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { createSceneStructure, sceneStructureActors } from './scene-structure.mjs';

const FIELDS = ['position', 'size', 'color', 'speed', 'controls', 'imageResourceId'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const pair = (value, min, max) => Array.isArray(value) && value.length === 2 && Array.from(value).every(item => number(item, min, max));
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const fail = (code = 'scene_composition_override_invalid', message = 'The local override does not match a valid recipe preview.') => {
  throw Object.assign(new TypeError(message), { errorCode: code });
};
const conflict = () => fail('scene_composition_override_conflict', 'The recipe source or saved baseline changed. Preview the current source again.');
function clone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { fail(); }
}
function checkContent(content) {
  if (typeof content !== 'string') fail();
  if (content.length > MAX_SCENE_COMPOSITION_BYTES) fail('scene_composition_override_content_limit', 'The recipe source exceeds 128 KiB.');
  for (const character of content) {
    const point = character.codePointAt(0);
    if (point >= 0xd800 && point <= 0xdfff) fail();
  }
  if (new TextEncoder().encode(content).length > MAX_SCENE_COMPOSITION_BYTES) fail('scene_composition_override_content_limit', 'The recipe source exceeds 128 KiB.');
}
function sourceSnapshot(source) {
  if (!exact(source, ['sourcePath', 'baseSourceRevision', 'content']) || typeof source.sourcePath !== 'string'
    || !source.sourcePath.length || source.sourcePath.length > 4096 || !source.sourcePath.toLowerCase().endsWith('.json')
    || !revision(source.baseSourceRevision)) fail();
  const result = { sourcePath: source.sourcePath, baseSourceRevision: source.baseSourceRevision, content: source.content };
  checkContent(result.content); return result;
}
async function hash(content, digest) {
  if (typeof digest !== 'function') fail();
  const value = await digest(content);
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail();
  return `sha256:${value}`;
}
function valuesSnapshot(values, { all = false } = {}) {
  if (!plain(values) || Object.keys(values).some(field => !FIELDS.includes(field))
    || all && !FIELDS.every(field => Object.hasOwn(values, field))) fail();
  const result = {};
  for (const field of FIELDS) if (Object.hasOwn(values, field)) {
    const value = values[field];
    const valid = field === 'position' ? pair(value, -100000, 100000)
      : field === 'size' ? pair(value, 1, 2048)
        : field === 'color' ? typeof value === 'string' && /^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(value)
          : field === 'speed' ? number(value, 0, 2000)
            : field === 'controls' ? ['arrows', 'none'].includes(value) : value === null || uuid(value);
    if (!valid) fail(); result[field] = Array.isArray(value) ? [...value] : value;
  }
  return result;
}
function decoded(content) {
  checkContent(content);
  const expanded = expandSceneComposition(content);
  return { value: JSON.parse(content.replace(/^\uFEFF/, '')), expanded };
}
function targetFor(parsed, instanceId, placementId, actorKey) {
  if (!uuid(instanceId)) fail();
  const entry = parsed.expanded.sourceMap.actors.find(item => item.instanceId === instanceId);
  if (!entry || placementId !== undefined && entry.placementId !== placementId || actorKey !== undefined && entry.localKey !== actorKey) fail();
  const placementIndex = parsed.value.placements.findIndex(item => item.placementId === entry.placementId);
  const placement = parsed.value.placements[placementIndex], fragment = parsed.value.fragments.find(item => item.fragmentId === entry.fragmentId);
  const template = fragment.actors.find(item => item.key === entry.localKey);
  const overrideIndex = (placement.overrides || []).findIndex(item => item.actorKey === entry.localKey);
  const overrides = overrideIndex < 0 ? {} : placement.overrides[overrideIndex].values;
  return { entry, placement, placementIndex, template, overrideIndex, overrides };
}
function patch(content, parsed, target, values) {
  const result = dispatchStudioCoreCompositionPatch({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION, operation: 'sceneComposition.patchOverrides',
    content, placementId: target.entry.placementId, actorKey: target.entry.localKey, values });
  if (!exact(result, ['afterContent', 'changedPaths']) || !Array.isArray(result.changedPaths)) fail();
  const after = decoded(result.afterContent), expected = clone(parsed.value), placement = expected.placements[target.placementIndex];
  let index = target.overrideIndex;
  if (index < 0) { placement.overrides ||= []; index = placement.overrides.length; placement.overrides.push({ actorKey: target.entry.localKey, values: {} }); }
  Object.assign(placement.overrides[index].values, values);
  const changedPaths = FIELDS.filter(field => Object.hasOwn(values, field) && !same(target.overrides[field], values[field]))
    .map(field => `/placements/${target.placementIndex}/overrides/${index}/values/${field}`);
  if (!same(after.value, expected) || !same(result.changedPaths, changedPaths)) fail();
  return { afterContent: result.afterContent, changedPaths: [...result.changedPaths] };
}

/** Bind a saved/current-draft preview to one exact recipe source session. */
export async function createSceneCompositionOverrideDraft(model, source, actorId, { digest } = {}) {
  const before = sourceSnapshot(source), parsed = decoded(before.content), preview = clone(model);
  if (!plain(preview) || preview.ok !== true || preview.format !== 'viento-scene-preview' || preview.schemaVersion !== 2
    || Object.hasOwn(preview, 'sceneEditing') || !uuid(preview.scene?.objectId)
    || !exact(preview.composition, ['format', 'schemaVersion', 'recipeObjectId', 'sourcePath', 'sourceRevision', 'fragmentCount', 'placementCount'])
    || preview.composition.format !== 'viento-scene-composition-preview' || preview.composition.schemaVersion !== 1
    || preview.composition.recipeObjectId !== preview.scene.objectId || !revision(preview.composition.sourceRevision)
    || preview.composition.fragmentCount !== parsed.value.fragments.length || preview.composition.placementCount !== parsed.value.placements.length
    || !Array.isArray(preview.actors) || preview.actors.length !== parsed.expanded.scene.actors.length) fail();
  const sceneId = preview.scene.objectId, expectedRevision = preview.composition.sourceRevision;
  if (preview.scene.sourcePath !== before.sourcePath || preview.composition.sourcePath !== before.sourcePath
    || preview.scene.sourceRevision !== expectedRevision) conflict();
  if (Object.hasOwn(preview, 'draft')) {
    if (!exact(preview.draft, ['baseSourceRevision', 'sourceRevision']) || !revision(preview.draft.baseSourceRevision)
      || !revision(preview.draft.sourceRevision)) fail();
    if (preview.draft.baseSourceRevision !== before.baseSourceRevision || preview.draft.sourceRevision !== expectedRevision) conflict();
  } else if (before.baseSourceRevision !== expectedRevision) conflict();
  try {
    sceneStructureActors(preview.sceneStructure, preview.actors);
    if (!same(preview.sceneStructure, createSceneStructure(parsed.expanded.scene))) fail();
  } catch { fail(); }
  for (const [index, declaration] of parsed.expanded.scene.actors.entries()) {
    const actor = preview.actors[index];
    if (!plain(actor) || actor.instanceId !== declaration.instanceId || actor.objectId !== declaration.objectId || !same(actor.position, declaration.position)) fail();
    for (const field of FIELDS) if (Object.hasOwn(declaration, field)) {
      const effective = field === 'imageResourceId' ? actor[field] ?? null : actor[field];
      if (!same(effective, declaration[field])) fail();
    }
  }
  const target = targetFor(parsed, actorId), actor = preview.actors.find(item => item.instanceId === actorId);
  const provenance = preview.sourceLocations?.actors?.find(item => item.instanceId === actorId);
  if (!actor || !provenance || provenance.objectId !== actor.objectId
    || !exact(provenance.composition, ['fragmentId', 'placementId', 'localKey'])
    || provenance.composition.fragmentId !== target.entry.fragmentId || provenance.composition.placementId !== target.entry.placementId
    || provenance.composition.localKey !== target.entry.localKey || provenance.declaration?.objectId !== sceneId
    || provenance.declaration?.sourcePath !== before.sourcePath || provenance.declaration?.sourceRevision !== expectedRevision) fail();
  const effectiveValues = valuesSnapshot(Object.fromEntries(FIELDS.map(field => [field, field === 'imageResourceId' ? actor[field] ?? null : actor[field]])), { all: true });
  const values = { ...effectiveValues, position: [...(target.overrides.position || target.template.position)] };
  const offset = [...(target.placement.offset || [0, 0])];
  // All source, model, identity and default values are detached before hashing.
  const sourceRevision = await hash(before.content, digest);
  if (sourceRevision !== expectedRevision) conflict();
  return {
    actorId, objectId: actor.objectId, placementId: target.entry.placementId, actorKey: target.entry.localKey,
    fragmentId: target.entry.fragmentId, canClearImage: target.template.useProjectionDefaults === true,
    offset: [...offset], values: clone(values), effectiveValues: clone(effectiveValues), overrides: clone(target.overrides),
    propose(input) {
      const proposed = valuesSnapshot(input), changed = Object.fromEntries(FIELDS.filter(field => Object.hasOwn(proposed, field) && !same(proposed[field], values[field]))
        .map(field => [field, proposed[field]]));
      if (!Object.keys(changed).length) fail('scene_composition_override_unchanged', 'No local override values changed.');
      const prepared = patch(before.content, parsed, target, changed);
      return { sceneId, sourcePath: before.sourcePath, baseSourceRevision: before.baseSourceRevision, sourceRevision,
        instanceId: actorId, placementId: target.entry.placementId, actorKey: target.entry.localKey, values: clone(changed), ...prepared };
    },
  };
}

/** Recompute the exact replacement; the host must still recheck its session. */
export async function prepareSceneCompositionOverrideApply(current, proposal, { digest } = {}) {
  const source = sourceSnapshot(current);
  if (!exact(proposal, ['sceneId', 'sourcePath', 'baseSourceRevision', 'sourceRevision', 'instanceId', 'placementId', 'actorKey', 'values', 'afterContent', 'changedPaths'])
    || !uuid(proposal.sceneId) || !uuid(proposal.instanceId) || !uuid(proposal.placementId)
    || typeof proposal.actorKey !== 'string' || !revision(proposal.sourceRevision) || !revision(proposal.baseSourceRevision)
    || typeof proposal.sourcePath !== 'string' || typeof proposal.afterContent !== 'string' || !Array.isArray(proposal.changedPaths)) fail();
  const expected = clone(proposal), values = valuesSnapshot(expected.values);
  if (!Object.keys(values).length) fail('scene_composition_override_unchanged', 'No local override values changed.');
  if (source.sourcePath !== expected.sourcePath || source.baseSourceRevision !== expected.baseSourceRevision) conflict();
  if (await hash(source.content, digest) !== expected.sourceRevision) conflict();
  const parsed = decoded(source.content), target = targetFor(parsed, expected.instanceId, expected.placementId, expected.actorKey);
  const prepared = patch(source.content, parsed, target, values);
  if (!prepared.changedPaths.length || prepared.afterContent !== expected.afterContent || !same(prepared.changedPaths, expected.changedPaths)) fail();
  return prepared;
}
