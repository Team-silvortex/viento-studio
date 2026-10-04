import { validateSceneGroups } from './scene-groups.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => { throw Object.assign(new TypeError('Invalid scene editor structure.'), { errorCode: 'scene_structure_invalid' }); };

// Grouping is author/editor metadata. It is carried beside a frozen runtime plan
// and never changes the flat actor order consumed by canvas and backend adapters.
export function createSceneStructure(model) {
  if (model?.schemaVersion !== 3) return undefined;
  if (!Array.isArray(model.groups) || !Array.isArray(model.actors)) invalid();
  const structure = { format: 'viento-scene-structure', schemaVersion: 1, sourceSchemaVersion: 3,
    groups: clone(model.groups), memberships: model.actors.filter(actor => Object.hasOwn(actor, 'groupId'))
      .map(actor => ({ instanceId: actor.instanceId, groupId: actor.groupId })) };
  sceneStructureActors(structure, model.actors);
  return structure;
}

export function sceneStructureActors(structure, actors) {
  if (!Array.isArray(actors)) invalid();
  if (structure === undefined) return clone(actors);
  if (!exact(structure, ['format', 'schemaVersion', 'sourceSchemaVersion', 'groups', 'memberships'])
    || structure.format !== 'viento-scene-structure' || structure.schemaVersion !== 1 || structure.sourceSchemaVersion !== 3
    || !Array.isArray(structure.groups) || !Array.isArray(structure.memberships) || structure.memberships.length > 128
    || actors.length < 1 || actors.length > 128) invalid();
  const ids = new Set(), memberships = new Map();
  for (const actor of actors) {
    if (!plain(actor) || !uuid(actor.instanceId) || !uuid(actor.objectId) || ids.has(actor.instanceId)) invalid();
    ids.add(actor.instanceId);
  }
  for (const membership of structure.memberships) {
    if (!exact(membership, ['instanceId', 'groupId']) || !uuid(membership.instanceId) || !uuid(membership.groupId)
      || !ids.has(membership.instanceId) || memberships.has(membership.instanceId)) invalid();
    memberships.set(membership.instanceId, membership.groupId);
  }
  const enriched = actors.map(actor => {
    if (Object.hasOwn(actor, 'groupId') && actor.groupId !== memberships.get(actor.instanceId)) invalid();
    const result = clone(actor); delete result.groupId;
    if (memberships.has(actor.instanceId)) result.groupId = memberships.get(actor.instanceId);
    return result;
  });
  const checked = validateSceneGroups({ schemaVersion: 3, groups: structure.groups, actors: enriched });
  if (!checked.ok) invalid();
  return enriched;
}
