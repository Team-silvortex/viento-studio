// Shared organizational groups remains source-owned. IDs are supplied explicitly by
// the host/UI once; this pure layer neither allocates identities nor saves.
import { createSceneCompositionOverrideDraft } from './scene-composition-overrides.mjs';
import { expandSceneComposition, MAX_SCENE_COMPOSITION_BYTES } from './scene-composition.mjs';
import { dispatchStudioCoreCompositionGroups, STUDIO_CORE_PROTOCOL_VERSION } from './studio-core.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { createSceneStructure } from './scene-structure.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const key = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = (code = 'scene_composition_groups_invalid') => { throw Object.assign(new TypeError('The shared structure edit does not match the recipe source.'), { errorCode: code }); };
const conflict = () => fail('scene_composition_groups_conflict');

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
  if (new TextEncoder().encode(source.content).length > MAX_SCENE_COMPOSITION_BYTES) fail('scene_composition_groups_content_limit');
  return source;
}
async function hash(content, digest) {
  if (typeof digest !== 'function') fail();
  const result = await digest(content); if (typeof result !== 'string' || !/^[a-f0-9]{64}$/.test(result)) fail(); return `sha256:${result}`;
}
function decoded(content) { try { return { expanded: expandSceneComposition(content), value: JSON.parse(content.replace(/^\uFEFF/, '')) }; } catch(error) { if(error.errorCode==='scene_composition_limit')fail('scene_composition_groups_content_limit');if(error.errorCode==='scene_composition_invalid')fail();throw error; } }
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
function groupName(value) { return typeof value==='string' && value.length<=160 && value.trim().length>0 && !/[\u0000-\u001f\u007f]/.test(value); }
function canonicalEdit(input,parsed,sceneId) {
  const edit=clone(input),fields={add:['group','instances'],edit:['groupKey','name','parentKey'],assign:['actorKey','groupKey'],remove:['groupKey']};
  if(!plain(edit)||typeof edit.action!=='string'||!Object.hasOwn(fields,edit.action)||!exact(edit,['action','fragmentId',...fields[edit.action]])||!key(edit.fragmentId))fail();
  const fragment=parsed.value.fragments.find(item=>item.fragmentId===edit.fragmentId);if(!fragment)fail();
  if(edit.action==='add') {
    const group=edit.group;
    if(!plain(group)||!Object.hasOwn(group,'key')||!Object.hasOwn(group,'name')||Object.keys(group).some(field=>!['key','name','parentKey'].includes(field))
      ||!key(group.key)||!groupName(group.name)||fragment.groups.some(item=>item.key===group.key)
      ||Object.hasOwn(group,'parentKey')&&(!key(group.parentKey)||!fragment.groups.some(item=>item.key===group.parentKey)))fail();
    const placements=parsed.value.placements.filter(item=>item.fragmentId===edit.fragmentId);
    if(!Array.isArray(edit.instances)||edit.instances.length!==placements.length)fail();
    const identities=new Set([sceneId,...parsed.value.placements.flatMap(item=>[item.placementId,...Object.values(item.actorIds),...Object.values(item.groupIds)])]);
    const instances=edit.instances.map((instance,index)=>{if(!exact(instance,['placementId','groupId'])||instance.placementId!==placements[index].placementId||!uuid(instance.groupId)||identities.has(instance.groupId))fail();identities.add(instance.groupId);return {placementId:instance.placementId,groupId:instance.groupId};});
    return {action:'add',fragmentId:edit.fragmentId,group:{key:group.key,name:group.name,...(Object.hasOwn(group,'parentKey')?{parentKey:group.parentKey}:{})},instances};
  }
  if(edit.action==='assign') {
    if(!key(edit.actorKey)||!fragment.actors.some(actor=>actor.key===edit.actorKey)||!(edit.groupKey===null||key(edit.groupKey)&&fragment.groups.some(group=>group.key===edit.groupKey)))fail();
    return {action:'assign',fragmentId:edit.fragmentId,actorKey:edit.actorKey,groupKey:edit.groupKey};
  }
  if(!key(edit.groupKey)||!fragment.groups.some(group=>group.key===edit.groupKey))fail();
  if(edit.action==='edit') {
    if(!groupName(edit.name)||!(edit.parentKey===null||key(edit.parentKey)&&fragment.groups.some(group=>group.key===edit.parentKey)))fail();
    return {action:'edit',fragmentId:edit.fragmentId,groupKey:edit.groupKey,name:edit.name,parentKey:edit.parentKey};
  }
  if(fragment.actors.some(actor=>actor.groupKey===edit.groupKey)||fragment.groups.some(group=>group.parentKey===edit.groupKey))fail();
  return {action:'remove',fragmentId:edit.fragmentId,groupKey:edit.groupKey};
}
function targets(after,fragmentId) {
  const fragment=after.fragments.find(item=>item.fragmentId===fragmentId);
  return after.placements.filter(item=>item.fragmentId===fragmentId).map(placement=>({placementId:placement.placementId,fragmentId,
    groups:fragment.groups.map(group=>({groupKey:group.key,groupId:placement.groupIds[group.key],name:group.name,parentGroupId:Object.hasOwn(group,'parentKey')?placement.groupIds[group.parentKey]:null})),
    actors:fragment.actors.map(actor=>({actorKey:actor.key,instanceId:placement.actorIds[actor.key],objectId:actor.objectId,groupId:Object.hasOwn(actor,'groupKey')?placement.groupIds[actor.groupKey]:null}))}));
}
function patch(content,edit) {
  const {action,...request}=edit;
  try{return dispatchStudioCoreCompositionGroups({protocolVersion:STUDIO_CORE_PROTOCOL_VERSION,
    operation:{add:'sceneComposition.addFragmentGroup',edit:'sceneComposition.editFragmentGroup',assign:'sceneComposition.assignFragmentActorGroup',remove:'sceneComposition.removeFragmentGroup'}[action],content,...request});}
  catch(error){if(error.errorCode==='scene_composition_limit')fail('scene_composition_groups_content_limit');if(error.errorCode==='scene_composition_invalid'||error.errorCode==='studio_core_request_invalid')fail();throw error;}
}
/** A source-owned directory for shared groups, including unused fragments. */
export async function createSceneCompositionGroupsDraft(model,source,{digest}={}) {
  const before=sourceSnapshot(source),preview=clone(model),parsed=decoded(before.content);
  if(!plain(preview)||!uuid(preview.actors?.[0]?.instanceId))fail();
  try{await createSceneCompositionOverrideDraft(preview,before,preview.actors[0].instanceId,{digest});}
  catch(error){if(error.errorCode==='scene_composition_override_conflict')conflict();if(error.errorCode?.startsWith('scene_composition_override_'))fail();throw error;}
  checkProvenance(preview,parsed,before);
  const sceneId=preview.scene.objectId,sourceRevision=preview.composition.sourceRevision;
  const fragments=freeze(parsed.value.fragments.map(fragment=>({...clone(fragment),placements:clone(parsed.value.placements.filter(placement=>placement.fragmentId===fragment.fragmentId))})));
  return Object.freeze({fragments,propose(input) {
    const edit=canonicalEdit(input,parsed,sceneId),prepared=patch(before.content,edit);
    if(!prepared.changedPaths.length)fail('scene_composition_groups_unchanged');
    return {sceneId,sourcePath:before.sourcePath,baseSourceRevision:before.baseSourceRevision,sourceRevision,edit:clone(edit),
      targets:targets(JSON.parse(prepared.afterContent.replace(/^\uFEFF/,'')),edit.fragmentId),afterContent:prepared.afterContent,changedPaths:[...prepared.changedPaths]};
  }});
}
/** Recompute every organizational target and exact source receipt before apply. */
export async function prepareSceneCompositionGroupsApply(current,proposal,{digest}={}) {
  const source=sourceSnapshot(current),expected=clone(proposal);
  if(!exact(expected,['sceneId','sourcePath','baseSourceRevision','sourceRevision','edit','targets','afterContent','changedPaths'])||!uuid(expected.sceneId)
    ||!revision(expected.baseSourceRevision)||!revision(expected.sourceRevision)||typeof expected.sourcePath!=='string'||typeof expected.afterContent!=='string'
    ||!Array.isArray(expected.changedPaths)||!Array.isArray(expected.targets))fail();
  if(source.sourcePath!==expected.sourcePath||source.baseSourceRevision!==expected.baseSourceRevision)conflict();
  if(await hash(source.content,digest)!==expected.sourceRevision)conflict();
  const parsed=decoded(source.content),edit=canonicalEdit(expected.edit,parsed,expected.sceneId);
  if(!same(edit,expected.edit))fail();
  const prepared=patch(source.content,edit);
  if(!prepared.changedPaths.length||prepared.afterContent!==expected.afterContent||!same(prepared.changedPaths,expected.changedPaths)
    ||!same(targets(JSON.parse(prepared.afterContent.replace(/^\uFEFF/,'')),edit.fragmentId),expected.targets))fail();
  return {afterContent:prepared.afterContent,changedPaths:[...prepared.changedPaths]};
}
