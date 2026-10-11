// Candidate preview verification is independent of GUI state, transport and
// execution backends. It grants no save authority: the source owner and each
// domain's exact prepare/apply contract still guard the author draft.
import { expandSceneComposition } from './scene-composition.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { dispatchStudioCoreCompositionDefinitionLocations, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';

const KINDS = new Set(['instance', 'positions', 'fragment', 'placement', 'structure', 'placements', 'groups', 'definitions']);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const records = value => Array.isArray(value) && value.every(record);
const unique = (items, property) => new Set(items.map(item => item[property])).size === items.length;
function invalid(payload) {
  return Object.assign(new Error('Composition validation did not match the reviewed source.'), {
    errorCode: 'scene_composition_override_invalid', payload,
  });
}

function fragmentTargetsMatch(payload, proposal) {
  if (!records(proposal.targets) || !proposal.targets.length || proposal.targets.length > 128
    || !unique(proposal.targets, 'instanceId') || !proposal.targets.some(target => target.instanceId === proposal.instanceId)
    || !records(payload.sourceLocations?.actors)) return false;
  const related = payload.sourceLocations.actors.filter(location => location.composition?.fragmentId === proposal.fragmentId
    && location.composition.localKey === proposal.actorKey);
  return related.length === proposal.targets.length && proposal.targets.every((target, index) =>
    related[index].instanceId === target.instanceId && related[index].composition.placementId === target.placementId
    && payload.actors.some(actor => actor.instanceId === target.instanceId));
}
function placementTargetsMatch(payload, proposal) {
  if (!records(proposal.targets) || !proposal.targets.length || proposal.targets.length > 128
    || !records(proposal.groups) || proposal.groups.length > 128
    || !unique(proposal.targets, 'instanceId') || !unique(proposal.groups, 'groupId')
    || !proposal.targets.some(target => target.instanceId === proposal.instanceId)
    || !records(payload.sourceLocations?.actors) || !records(payload.sourceLocations?.groups)
    || !records(payload.sceneStructure?.groups)) return false;
  const related = payload.sourceLocations.actors.filter(location => location.composition?.placementId === proposal.placementId);
  const groups = payload.sourceLocations.groups.filter(location => location.composition?.placementId === proposal.placementId);
  return related.length === proposal.targets.length && proposal.targets.every((target, index) =>
    related[index].instanceId === target.instanceId && related[index].composition.fragmentId === proposal.fragmentId
    && related[index].composition.localKey === target.actorKey
    && payload.actors.filter(actor => actor.instanceId === target.instanceId).length === 1)
    && groups.length === proposal.groups.length && proposal.groups.every((group, index) =>
      groups[index].groupId === group.groupId && groups[index].composition.fragmentId === proposal.fragmentId
      && groups[index].composition.localKey === group.groupKey
      && payload.sceneStructure.groups.filter(item => item.groupId === group.groupId).length === 1);
}
function structureTargetsMatch(payload, proposal) {
  // Actor and placement structure both change the complete identity set. The
  // removed opener may be absent, and unused declarations have no targets.
  // Verify the complete source-ordered identity/provenance of the candidate.
  const expanded = expandSceneComposition(proposal.afterContent), recipe = JSON.parse(proposal.afterContent.replace(/^\uFEFF/, ''));
  if (payload.composition.fragmentCount !== recipe.fragments.length || payload.composition.placementCount !== recipe.placements.length) return false;
  for (const [kind, identity] of [['actors', 'instanceId'], ['groups', 'groupId']]) {
    const expected = expanded.sourceMap[kind], locations = payload.sourceLocations?.[kind];
    const actual = kind === 'actors' ? payload.actors : payload.sceneStructure?.groups;
    if (!records(locations) || !records(actual) || locations.length !== expected.length || actual.length !== expected.length) return false;
    for (const [index, entry] of expected.entries()) {
      const location = locations[index];
      if (location[identity] !== entry[identity] || actual.filter(item => item[identity] === entry[identity]).length !== 1
        || location.composition?.fragmentId !== entry.fragmentId || location.composition.placementId !== entry.placementId
        || location.composition.localKey !== entry.localKey
        || location.declaration?.objectId !== proposal.sceneId || location.declaration.sourcePath !== proposal.sourcePath
        || location.declaration.sourceRevision !== payload.scene.sourceRevision
        || kind === 'actors' && (location.objectId !== expanded.scene.actors[index].objectId
          || actual.find(item => item.instanceId === entry.instanceId)?.objectId !== expanded.scene.actors[index].objectId)) return false;
    }
  }
  return true;
}
function positionsMatch(payload, proposal) {
  return records(proposal.changes) && proposal.changes.length >= 1 && proposal.changes.length <= 128
    && unique(proposal.changes, 'instanceId') && records(payload.sourceLocations?.actors)
    && proposal.changes.every(change => payload.actors.some(actor => actor.instanceId === change.instanceId)
      && payload.sourceLocations.actors.some(location => location.instanceId === change.instanceId
        && location.composition?.placementId === change.placementId && location.composition.localKey === change.actorKey));
}
function groupTargetsMatch(payload, proposal) {
  if (!structureTargetsMatch(payload, proposal)) return false;
  // Stable identities alone cannot approve an organization edit. Match the
  // complete source-ordered group names, parents and actor memberships too.
  // This stricter domain leaves previous candidate contracts unchanged.
  const expanded = expandSceneComposition(proposal.afterContent);
  const expected = { format: 'viento-scene-structure', schemaVersion: 1, sourceSchemaVersion: 3,
    groups: expanded.scene.groups,
    memberships: expanded.scene.actors.filter(actor => Object.hasOwn(actor, 'groupId'))
      .map(actor => ({ instanceId: actor.instanceId, groupId: actor.groupId })) };
  if (canonicalJson(payload.sceneStructure) !== canonicalJson(expected)) return false;
  return payload.actors.every(actor => !Object.hasOwn(actor, 'groupId')
    || uuid(actor.groupId) && actor.groupId === expanded.scene.actors.find(item => item.instanceId === actor.instanceId)?.groupId);
}
function definitionTargetsMatch(payload, proposal) {
  // Definition management does not create or remove a placed instance. A
  // removed unused fragment can move source ranges, so recompute the complete
  // provenance rather than retaining old JSON Pointers from the opener.
  if (!Array.isArray(proposal.targets) || proposal.targets.length || !groupTargetsMatch(payload, proposal)) return false;
  const expanded = expandSceneComposition(proposal.afterContent), expected = expanded.scene.actors;
  const contributionPaths = entry => [...new Set([entry.templatePath, entry.identityPath,
    ...Object.values(entry.fields).flat().filter(path => !path.startsWith(`${entry.templatePath}/`))])];
  const queries = [...new Set(['actors', 'groups'].flatMap(kind => expanded.sourceMap[kind].flatMap(contributionPaths)))];
  // Source locations come from the same Rust CST as source edits. Importing
  // the host YAML indexer here would pull private Node dependencies into GUI
  // startup. This interface is read-only and retains the static host boundary.
  const { locations } = dispatchStudioCoreCompositionDefinitionLocations({ protocolVersion: STUDIO_CORE_PROTOCOL_VERSION,
    operation: 'sceneComposition.inspectDefinitionLocations', content: proposal.afterContent, paths: queries });
  const ranges = new Map(queries.map((path, index) => [path, locations[index]]));
  for (const kind of ['actors', 'groups']) {
    for (const [index, entry] of expanded.sourceMap[kind].entries()) {
      const declaration = payload.sourceLocations[kind][index].declaration;
      if (declaration.propertyPath !== entry.templatePath) return false;
      const paths = contributionPaths(entry);
      const sourceLocation = (path, exact = true) => {
        const range = ranges.get(path);
        return { objectId: proposal.sceneId, sourcePath: proposal.sourcePath,
          sourceRevision: payload.scene.sourceRevision, propertyPath: path,
          ...(range ? { sourceRange: { ...range, exact: range.exact && exact } } : {}) };
      };
      if (Object.hasOwn(declaration, 'sourceRange')
        && canonicalJson(declaration.sourceRange) !== canonicalJson(sourceLocation(entry.templatePath, paths.length === 1).sourceRange)) return false;
      if (Object.hasOwn(declaration, 'contributors')) {
        const contributors = paths.map(path => ({ ...sourceLocation(path), role:
          path === entry.templatePath || path.startsWith(`${entry.templatePath}/`) ? 'template'
          : path === `${entry.placementPath}/offset` || path.startsWith(`${entry.placementPath}/offset/`) ? 'offset'
          : path.startsWith(`${entry.placementPath}/overrides/`) ? 'override' : 'identity' }));
        if (canonicalJson(declaration.contributors) !== canonicalJson(contributors)) return false;
      }
    }
  }
  return expected.every((actor, index) => {
    const actual = payload.actors[index];
    if (actual.instanceId !== actor.instanceId) return false;
    for (const field of ['position', 'size', 'color', 'speed', 'controls', 'useProjectionDefaults', 'imageResourceId']) {
      if (!Object.hasOwn(actor, field)) continue;
      if (field === 'imageResourceId' && actor.useProjectionDefaults === true && actor[field] === null) {
        if (Object.hasOwn(actual, field)) return false;
      } else if (!Object.hasOwn(actual, field) || canonicalJson(actual[field]) !== canonicalJson(actor[field])) return false;
    }
    return true;
  });
}
const MATCHERS = Object.freeze({
  instance: (payload, proposal) => payload.actors.some(actor => actor.instanceId === proposal.instanceId),
  positions: positionsMatch, fragment: fragmentTargetsMatch, placement: placementTargetsMatch,
  structure: structureTargetsMatch, placements: structureTargetsMatch, groups: groupTargetsMatch, definitions: definitionTargetsMatch,
});

/**
 * Synchronous verification of one detached candidate preview. sourceRevision is
 * computed by the host from its captured afterContent. The host retains preview
 * release, owner checks around asynchronous work, and ordinary save semantics.
 */
export function validateSceneAuthoringCandidate(kind, proposal, payload, options = {}) {
  try {
    const sourceRevision = options?.sourceRevision;
    if (!KINDS.has(kind) || !record(proposal) || !uuid(proposal.sceneId) || typeof proposal.sourcePath !== 'string' || !proposal.sourcePath.length
      || !revision(proposal.baseSourceRevision) || !revision(sourceRevision) || typeof proposal.afterContent !== 'string'
      || new TextEncoder().encode(proposal.afterContent).length > 128 * 1024
      || !record(payload) || payload.ok !== true || payload.format !== 'viento-scene-preview' || payload.schemaVersion !== 2 || !uuid(payload.previewId)
      || Object.hasOwn(payload, 'sceneEditing') || Object.hasOwn(payload, 'snapshot')
      || payload.scene?.objectId !== proposal.sceneId || payload.scene.sourcePath !== proposal.sourcePath || payload.scene.sourceRevision !== sourceRevision
      || payload.composition?.format !== 'viento-scene-composition-preview' || payload.composition.schemaVersion !== 1
      || payload.composition.recipeObjectId !== proposal.sceneId || payload.composition.sourcePath !== proposal.sourcePath || payload.composition.sourceRevision !== sourceRevision
      || !Number.isInteger(payload.composition.fragmentCount) || payload.composition.fragmentCount < 1 || payload.composition.fragmentCount > 32
      || !Number.isInteger(payload.composition.placementCount) || payload.composition.placementCount < 1 || payload.composition.placementCount > 128
      || payload.draft?.baseSourceRevision !== proposal.baseSourceRevision || payload.draft.sourceRevision !== sourceRevision
      || !records(payload.actors) || !MATCHERS[kind](payload, proposal)) throw invalid(payload);
    return Object.freeze({ kind, previewId: payload.previewId, sceneId: proposal.sceneId, sourcePath: proposal.sourcePath,
      baseSourceRevision: proposal.baseSourceRevision, sourceRevision });
  } catch (error) {
    if (error?.errorCode === 'scene_composition_override_invalid' && error.payload === payload) throw error;
    throw invalid(payload);
  }
}
