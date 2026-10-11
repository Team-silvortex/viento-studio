// One shared actor declaration is an explicit author edit. Effective instance
// values never become implicit template defaults, and this module cannot save.
import { createSceneCompositionOverrideDraft } from './scene-composition-overrides.mjs';
import { expandSceneComposition, MAX_SCENE_COMPOSITION_BYTES } from './scene-composition.mjs';
import { dispatchStudioCoreCompositionFragment, dispatchStudioCoreCompositionFragmentEdit, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
import { canonicalJson } from './canonical-json.mjs';

const FIELDS = ['position', 'size', 'color', 'speed', 'controls', 'imageResourceId'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const key = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const fail = (code = 'scene_composition_override_invalid') => {
  throw Object.assign(new TypeError('The shared fragment edit does not match the current recipe source.'), { errorCode: code });
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
async function hash(content, digest) {
  if (typeof digest !== 'function') fail();
  const value = await digest(content);
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail();
  return `sha256:${value}`;
}
function valuesSnapshot(values) {
  if (!plain(values) || Object.keys(values).some(field => !FIELDS.includes(field))) fail();
  const result = {}, number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  const pair = (value, min, max) => Array.isArray(value) && value.length === 2 && Array.from(value).every(item => number(item, min, max));
  for (const field of FIELDS) if (Object.hasOwn(values, field)) {
    const value = values[field], valid = field === 'position' ? pair(value, -100000, 100000)
      : field === 'size' ? pair(value, 1, 2048) : field === 'color' ? typeof value === 'string' && /^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(value)
        : field === 'speed' ? number(value, 0, 2000) : field === 'controls' ? ['arrows', 'none'].includes(value) : value === null || uuid(value);
    if (!valid) fail(); result[field] = Array.isArray(value) ? [...value] : value;
  }
  return result;
}
function decoded(content) {
  const expanded = expandSceneComposition(content);
  return { value: JSON.parse(content.replace(/^\uFEFF/, '')), expanded };
}
function targetFor(parsed, instanceId, fragmentId, actorKey) {
  if (!uuid(instanceId)) fail();
  const entry = parsed.expanded.sourceMap.actors.find(item => item.instanceId === instanceId);
  if (!entry || fragmentId !== undefined && entry.fragmentId !== fragmentId || actorKey !== undefined && entry.localKey !== actorKey) fail();
  const fragment = parsed.value.fragments.find(item => item.fragmentId === entry.fragmentId);
  const template = fragment.actors.find(item => item.key === entry.localKey);
  const targets = parsed.value.placements.filter(placement => placement.fragmentId === entry.fragmentId).map(placement => {
    const overrides = placement.overrides?.find(override => override.actorKey === entry.localKey)?.values || {};
    return { instanceId: placement.actorIds[entry.localKey], placementId: placement.placementId,
      overrides: FIELDS.filter(field => Object.hasOwn(overrides, field)) };
  });
  return { entry, template, targets };
}
function patch(content, target, values) {
  return dispatchStudioCoreCompositionFragment({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'sceneComposition.patchFragmentActor', content, fragmentId: target.entry.fragmentId, actorKey: target.entry.localKey, values });
}
function changedValues(template, input) {
  const values = valuesSnapshot(input);
  return Object.fromEntries(FIELDS.filter(field => Object.hasOwn(values, field)
    && (!Object.hasOwn(template, field) || !same(template[field], values[field]))).map(field => [field, values[field]]));
}
function changedEdit(template, input) {
  if (!exact(input, ['values', 'reset'])) fail();
  const values = valuesSnapshot(input.values), reset = input.reset;
  if (!Array.isArray(reset) || reset.length > FIELDS.length - 1 || new Set(reset).size !== reset.length
    || Array.from(reset).some(field => field === 'position' || !FIELDS.includes(field) || Object.hasOwn(values, field))
    || template.useProjectionDefaults !== true && reset.some(field => field !== 'imageResourceId')) fail();
  return { values: changedValues(template, values), reset: FIELDS.filter(field => reset.includes(field) && Object.hasOwn(template, field)) };
}
function patchEdit(content, target, values, reset) {
  return dispatchStudioCoreCompositionFragmentEdit({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'sceneComposition.editFragmentActor', content, fragmentId: target.entry.fragmentId, actorKey: target.entry.localKey, values, reset: [...reset] });
}

/** Bind one source template plus its full related placement set before hashing. */
export async function createSceneCompositionFragmentDraft(model, source, actorId, { digest } = {}) {
  const before = sourceSnapshot(source), preview = clone(model), parsed = decoded(before.content);
  const target = targetFor(parsed, actorId), values = valuesSnapshot(Object.fromEntries(FIELDS.filter(field => Object.hasOwn(target.template, field)).map(field => [field, target.template[field]])));
  // Reuse the established whole-preview/structure/current-source binding once.
  const binding = await createSceneCompositionOverrideDraft(preview, before, actorId, { digest });
  if (!Array.isArray(preview.sourceLocations?.actors) || preview.sourceLocations.actors.length !== parsed.expanded.sourceMap.actors.length) fail();
  for (const entry of parsed.expanded.sourceMap.actors) {
    const actor = preview.actors.find(actor => actor.instanceId === entry.instanceId);
    const locations = preview.sourceLocations.actors.filter(actor => actor.instanceId === entry.instanceId);
    const provenance = locations[0];
    if (locations.length !== 1 || !actor || !provenance || provenance.objectId !== actor.objectId
      || !exact(provenance.composition, ['fragmentId', 'placementId', 'localKey'])
      || provenance.composition.fragmentId !== entry.fragmentId || provenance.composition.placementId !== entry.placementId
      || provenance.composition.localKey !== entry.localKey || provenance.declaration?.objectId !== preview.scene.objectId
      || provenance.declaration?.sourcePath !== before.sourcePath || provenance.declaration?.sourceRevision !== preview.composition.sourceRevision) fail();
  }
  const sceneId = preview.scene.objectId, sourceRevision = preview.composition.sourceRevision;
  return {
    instanceId: actorId, objectId: binding.objectId, fragmentId: target.entry.fragmentId, actorKey: target.entry.localKey,
    useProjectionDefaults: target.template.useProjectionDefaults === true, values: clone(values), targets: clone(target.targets),
    propose(inputValues) {
      const changed = changedValues(target.template, inputValues);
      if (!Object.keys(changed).length) unchanged();
      const prepared = patch(before.content, target, changed);
      if (!prepared.changedPaths.length) unchanged();
      return { sceneId, sourcePath: before.sourcePath, baseSourceRevision: before.baseSourceRevision, sourceRevision,
        instanceId: actorId, fragmentId: target.entry.fragmentId, actorKey: target.entry.localKey,
        values: clone(changed), targets: clone(target.targets), afterContent: prepared.afterContent, changedPaths: [...prepared.changedPaths] };
    },
    proposeEdit(input) {
      const edit = changedEdit(target.template, input);
      if (!Object.keys(edit.values).length && !edit.reset.length) unchanged();
      const prepared = patchEdit(before.content, target, edit.values, edit.reset);
      if (!prepared.changedPaths.length) unchanged();
      return { sceneId, sourcePath: before.sourcePath, baseSourceRevision: before.baseSourceRevision, sourceRevision,
        instanceId: actorId, fragmentId: target.entry.fragmentId, actorKey: target.entry.localKey,
        values: clone(edit.values), reset: [...edit.reset], targets: clone(target.targets), afterContent: prepared.afterContent, changedPaths: [...prepared.changedPaths] };
    },
  };
}

/** Recompute the declaration, exact targets and source patch; the host owns save. */
export async function prepareSceneCompositionFragmentApply(current, proposal, { digest } = {}) {
  const source = sourceSnapshot(current);
  const editing = Object.hasOwn(proposal || {}, 'reset');
  if (!exact(proposal, ['sceneId', 'sourcePath', 'baseSourceRevision', 'sourceRevision', 'instanceId', 'fragmentId', 'actorKey', 'values', ...(editing ? ['reset'] : []), 'targets', 'afterContent', 'changedPaths'])
    || !uuid(proposal.sceneId) || !uuid(proposal.instanceId) || !key(proposal.fragmentId) || !key(proposal.actorKey)
    || !revision(proposal.sourceRevision) || !revision(proposal.baseSourceRevision) || typeof proposal.sourcePath !== 'string'
    || typeof proposal.afterContent !== 'string' || !Array.isArray(proposal.changedPaths) || !Array.isArray(proposal.targets)) fail();
  // Every caller-owned nested value is detached before the asynchronous digest.
  const expected = clone(proposal), values = valuesSnapshot(expected.values);
  if (!editing && !Object.keys(values).length) unchanged();
  if (source.sourcePath !== expected.sourcePath || source.baseSourceRevision !== expected.baseSourceRevision) conflict();
  if (await hash(source.content, digest) !== expected.sourceRevision) conflict();
  const parsed = decoded(source.content), target = targetFor(parsed, expected.instanceId, expected.fragmentId, expected.actorKey);
  const changed = editing ? changedEdit(target.template, { values, reset: expected.reset }) : { values: changedValues(target.template, values) };
  if (!same(changed.values, values) || editing && !same(changed.reset, expected.reset) || !same(target.targets, expected.targets)) fail();
  if (editing && !Object.keys(values).length && !changed.reset.length) unchanged();
  const prepared = editing ? patchEdit(source.content, target, changed.values, changed.reset) : patch(source.content, target, changed.values);
  if (!prepared.changedPaths.length || prepared.afterContent !== expected.afterContent || !same(prepared.changedPaths, expected.changedPaths)) fail();
  return { afterContent: prepared.afterContent, changedPaths: [...prepared.changedPaths] };
}
