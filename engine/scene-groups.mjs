// Logical scene organization only. Groups never change actor coordinates,
// visibility, paint order or backend runtime structure.
import { sceneActorIdentity } from './scene-identity.mjs';
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const pointer = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
export const SCENE_GROUP_LIMIT = 128;
export const SCENE_GROUP_DEPTH_LIMIT = 16;

export function validateSceneGroups(scene) {
  const diagnostics = [], issue = (code, message, propertyPath) => diagnostics.push({ code, message, propertyPath });
  if (scene?.schemaVersion !== 3) {
    if (Object.hasOwn(scene || {}, 'groups')) issue('build_feature_unsupported', 'Scene groups require schemaVersion 3.', '/groups');
    for (const [index, actor] of (Array.isArray(scene?.actors) ? scene.actors : []).entries()) {
      if (plain(actor) && Object.hasOwn(actor, 'groupId')) issue('build_feature_unsupported', 'Scene groups require schemaVersion 3.', `/actors/${index}/groupId`);
    }
    return { ok: diagnostics.length === 0, diagnostics };
  }
  if (!Array.isArray(scene.groups) || scene.groups.length > SCENE_GROUP_LIMIT) {
    issue('build_group_value', 'Provide an array of 0–128 scene groups.', '/groups');
    return { ok: false, diagnostics };
  }
  const groups = new Map(), instances = new Set((Array.isArray(scene.actors) ? scene.actors : []).map(actor => actor?.instanceId));
  for (const [index, group] of scene.groups.entries()) {
    const at = `/groups/${index}`;
    if (!plain(group)) { issue('build_group_value', 'Expected a scene group declaration.', at); continue; }
    for (const key of Object.keys(group)) if (!['groupId', 'name', 'parentGroupId'].includes(key)) issue('build_feature_unsupported', `Unsupported scene group field: ${key}`, `${at}/${pointer(key)}`);
    if (!uuid(group.groupId)) issue('build_group_missing', 'Every scene group requires a lowercase UUID.', `${at}/groupId`);
    else if (groups.has(group.groupId) || instances.has(group.groupId)) issue('build_group_duplicate', 'Scene group identities must be unique and distinct from instance identities.', `${at}/groupId`);
    else groups.set(group.groupId, { group, index });
    if (typeof group.name !== 'string' || !group.name.trim() || group.name.length > 160 || /[\x00-\x1f\x7f]/.test(group.name)) issue('build_group_value', 'Provide a group name of 1–160 characters.', `${at}/name`);
    if (Object.hasOwn(group, 'parentGroupId') && !uuid(group.parentGroupId)) issue('build_group_parent', 'A parent group must be a lowercase UUID; omit it for the scene root.', `${at}/parentGroupId`);
  }
  for (const { group, index } of groups.values()) {
    if (Object.hasOwn(group, 'parentGroupId') && uuid(group.parentGroupId) && !groups.has(group.parentGroupId)) {
      issue('build_group_parent', 'The parent group does not exist in this scene.', `/groups/${index}/parentGroupId`); continue;
    }
    const seen = new Set(); let cursor = group;
    while (cursor) {
      if (seen.has(cursor.groupId)) { issue('build_group_cycle', 'Scene groups cannot contain themselves or form a cycle.', `/groups/${index}/parentGroupId`); break; }
      seen.add(cursor.groupId);
      if (seen.size > SCENE_GROUP_DEPTH_LIMIT) { issue('build_group_depth', 'Scene groups support at most 16 levels.', `/groups/${index}/parentGroupId`); break; }
      cursor = groups.get(cursor.parentGroupId)?.group;
    }
  }
  for (const [index, actor] of (Array.isArray(scene.actors) ? scene.actors : []).entries()) {
    if (!plain(actor) || !Object.hasOwn(actor, 'groupId')) continue;
    if (!uuid(actor.groupId) || !groups.has(actor.groupId)) issue('build_actor_group', 'An instance group must reference an existing scene group; omit it for the scene root.', `/actors/${index}/groupId`);
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

// The outline is a view over source ordering. Sibling groups precede direct
// actors; descendant selection always uses original actor order, even filtered.
export function buildSceneOutline({ groups = [], actors = [], memberships } = {}, query = '') {
  if (!Array.isArray(actors) || actors.length > 128 || !Array.isArray(groups)) throw new TypeError('Expected bounded scene groups and actors.');
  const assignments = memberships === undefined ? null : new Map();
  const actorIds = new Set(actors.map(sceneActorIdentity));
  if (actorIds.size !== actors.length || actors.some(actor => !plain(actor) || !uuid(sceneActorIdentity(actor)) || !uuid(actor.objectId))) throw new TypeError('Expected distinct scene actor identities.');
  if (assignments) {
    if (!Array.isArray(memberships) || memberships.length > actors.length) throw new TypeError('Expected scene memberships.');
    for (const member of memberships) {
      if (!plain(member) || !actorIds.has(member.instanceId) || assignments.has(member.instanceId)
        || Object.keys(member).some(key => !['instanceId', 'groupId'].includes(key))) throw new TypeError('Expected unambiguous scene memberships.');
      assignments.set(member.instanceId, member);
    }
  }
  const declared = actors.map(actor => {
    const value = { instanceId: sceneActorIdentity(actor) }, owner = assignments ? assignments.get(value.instanceId) : actor;
    if (owner && Object.hasOwn(owner, 'groupId')) value.groupId = owner.groupId;
    return value;
  });
  const checked = validateSceneGroups({ schemaVersion: 3, groups, actors: declared });
  if (!checked.ok) throw new TypeError(checked.diagnostics[0].message);
  const nodes = new Map(groups.map(group => [group.groupId, { kind: 'group', groupId: group.groupId, name: group.name, instanceIds: [], children: [] }]));
  const parents = new Map(groups.map(group => [group.groupId, group.parentGroupId])), roots = [];
  for (const group of groups) (nodes.get(group.parentGroupId)?.children || roots).push(nodes.get(group.groupId));
  for (const [index, actor] of actors.entries()) {
    const instanceId = sceneActorIdentity(actor), groupId = declared[index].groupId;
    (nodes.get(groupId)?.children || roots).push({ kind: 'actor', instanceId, objectId: actor.objectId, name: actor.name || actor.objectId });
    for (let parent = groupId; parent !== undefined; parent = parents.get(parent)) nodes.get(parent).instanceIds.push(instanceId);
  }
  const search = String(query).trim().toLowerCase();
  if (!search) return roots;
  const matches = node => [node.name, node.groupId, node.instanceId, node.objectId].some(value => String(value || '').toLowerCase().includes(search));
  const filter = node => {
    if (matches(node)) return node;
    if (node.kind === 'actor') return null;
    const children = node.children.map(filter).filter(Boolean);
    return children.length ? { ...node, children } : null;
  };
  return roots.map(filter).filter(Boolean);
}
