import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSceneCompositionGroupsDraft, prepareSceneCompositionGroupsApply } from '../../engine/scene-composition-groups.mjs';
import { expandSceneComposition } from '../../engine/scene-composition.mjs';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { scene2DModelToPlan } from '../../engine/build-plan.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';

const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v1.json', import.meta.url), 'utf8'));
const example = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
const { ids } = golden;
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const hash = content => createHash('sha256').update(content).digest('hex');
const revision = content => `sha256:${hash(content)}`;
const parse = content => JSON.parse(content.replace(/^\uFEFF/, ''));
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const invalid = error => error?.errorCode === 'scene_composition_groups_invalid';
const conflict = error => error?.errorCode === 'scene_composition_groups_conflict';
function recipe() {
  const value = structuredClone(example);
  value.scene.title = 'Shared structure / 共有 / 🦊';
  value.fragments[0].actors[0] = { key: 'leader', objectId: ids.first, groupKey: 'party', position: [120.125, 180.25], useProjectionDefaults: true };
  value.fragments[0].actors[1] = { key: 'companion', objectId: ids.second, groupKey: 'companions', position: [200.5, 180.75],
    useProjectionDefaults: true, size: [48, 48], speed: 17, color: '#112233', controls: 'arrows', imageResourceId: null };
  value.fragments.push({ fragmentId: 'unused', actors: [{ key: 'dormant', objectId: ids.first, position: [0, 0], useProjectionDefaults: true }], groups: [] });
  value.placements[0].overrides = [{ actorKey: 'leader', values: { speed: 2 } }, { actorKey: 'companion', values: { color: '#123456' } }];
  return value;
}
async function fixture(value = recipe(), { dirty = false } = {}) {
  const observed = structuredClone(golden.observed);
  observed.source.workspace.version = 3;
  observed.source.definition = { documentTypes: [{ id: 'document', label: 'Document' }] };
  const document = observed.source.documents.find(item => item.record.id === ids.scene);
  document.record.relations = []; document.record.assetBindings = [];
  document.content = typeof value === 'string' ? value : serialize(value); document.sourceRevision = revision(document.content);
  for (const item of observed.source.documents) item.descriptor = { ...item.record };
  observed.projection = await createWorldProjection(observed.source, { digest: hash });
  const result = await resolveSceneCompositionPreview(observed, ids.scene, { digest: hash });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const plan = scene2DModelToPlan(result.model);
  const model = { ok: true, format: 'viento-scene-preview', schemaVersion: 2, scene: plan.scene, actors: plan.actors,
    sourceLocations: result.model.sourceLocations, composition: result.composition, sceneStructure: createSceneStructure(result.model) };
  const source = { sourcePath: document.sourcePath, baseSourceRevision: dirty ? revision('saved baseline') : document.sourceRevision, content: document.content };
  if (dirty) model.draft = { baseSourceRevision: source.baseSourceRevision, sourceRevision: document.sourceRevision };
  return { model, source };
}
async function open(f=null) { f ||= await fixture();return {...f,draft:await createSceneCompositionGroupsDraft(f.model,f.source,{digest:hash})}; }
const prepare=(source,p,digest=hash)=>prepareSceneCompositionGroupsApply(source,p,{digest});
const add=(value=recipe(),fragmentId='party')=>({action:'add',fragmentId,group:{key:'extra',name:'Extra / 组 / 組🦊',...(fragmentId==='party'?{parentKey:'companions'}:{})},instances:value.placements.filter(p=>p.fragmentId===fragmentId).map((p,i)=>({placementId:p.placementId,groupId:id(900+i)}))});
const edit=(groupKey='companions',name='Renamed / 組🦊',parentKey=null,fragmentId='party')=>({action:'edit',fragmentId,groupKey,name,parentKey});
const assign=(actorKey='leader',groupKey='companions',fragmentId='party')=>({action:'assign',fragmentId,actorKey,groupKey});
const remove=(groupKey='extra',fragmentId='party')=>({action:'remove',fragmentId,groupKey});
function withLeaf(){const value=recipe();value.fragments[0].groups.push({key:'extra',name:'Empty leaf',parentKey:'party'});value.placements.forEach((p,i)=>{p.groupIds.extra=id(800+i);});return value;}
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}

test('raw frozen directory contains complete shared actors groups placements and unused fragments in saved and dirty modes',async()=>{
  for(const dirty of [false,true]){const f=await open(await fixture(recipe(),{dirty})),value=parse(f.source.content);assert.deepEqual(Object.keys(f.draft).sort(),['fragments','propose']);assert.deepEqual(f.draft.fragments,value.fragments.map(fragment=>({...fragment,placements:value.placements.filter(p=>p.fragmentId===fragment.fragmentId)})));assert.equal(Object.hasOwn(f.draft.fragments[0].placements[0],'offset'),false);assert.equal(f.draft.fragments[1].placements.length,0);assert.throws(()=>f.draft.fragments[0].groups.pop(),TypeError);assert.throws(()=>{f.draft.fragments[0].placements[0].groupIds.party=id(99);},TypeError);}
});
test('ADD supplies stable fresh group identity to every placement and returns complete AFTER organization without geometry changes',async()=>{
  const f=await open(),input=add(),p=f.draft.propose(input),expected=recipe();expected.fragments[0].groups.push(input.group);expected.placements.forEach((placement,i)=>{placement.groupIds.extra=input.instances[i].groupId;});assert.deepEqual(parse(p.afterContent),expected);assert.deepEqual(p.changedPaths,['/fragments/0/groups/2','/placements/0/groupIds/extra','/placements/1/groupIds/extra']);
  assert.deepEqual(p.targets,expected.placements.map(placement=>({placementId:placement.placementId,fragmentId:'party',groups:expected.fragments[0].groups.map(g=>({groupKey:g.key,groupId:placement.groupIds[g.key],name:g.name,parentGroupId:g.parentKey?placement.groupIds[g.parentKey]:null})),actors:expected.fragments[0].actors.map(a=>({actorKey:a.key,instanceId:placement.actorIds[a.key],objectId:a.objectId,groupId:placement.groupIds[a.groupKey]}))})));assert.deepEqual(expandSceneComposition(p.afterContent).scene.actors,expandSceneComposition(f.source.content).scene.actors);await prepare(f.source,p);await fixture(p.afterContent);
});
test('EDIT atomically renames and reparents preserving keys IDs offsets overrides and memberships',async()=>{
  const f=await open(),p=f.draft.propose(edit()),expected=recipe();expected.fragments[0].groups[1].name='Renamed / 組🦊';delete expected.fragments[0].groups[1].parentKey;assert.deepEqual(parse(p.afterContent),expected);assert.deepEqual(p.changedPaths,['/fragments/0/groups/1/name','/fragments/0/groups/1/parentKey']);assert.deepEqual(p.targets.map(t=>t.groups[1].parentGroupId),[null,null]);assert.deepEqual(p.targets.map(t=>t.groups[1].name),['Renamed / 組🦊','Renamed / 組🦊']);await prepare(f.source,p);const rebuilt=await fixture(p.afterContent);assert.deepEqual(expandSceneComposition(p.afterContent).scene.actors,expandSceneComposition(f.source.content).scene.actors);assert.deepEqual(rebuilt.model.actors.map(a=>a.position),f.model.actors.map(a=>a.position));
  const root=await open(await fixture(p.afterContent)),nested=root.draft.propose(edit('party','Party new','companions'));assert.deepEqual(nested.targets.map(t=>t.groups[0].parentGroupId),recipe().placements.map(p=>p.groupIds.companions));await prepare(root.source,nested);
});
test('ASSIGN changes one template actor membership across all instances while root reset removes only its declaration',async()=>{
  const f=await open(),p=f.draft.propose(assign()),expected=recipe();expected.fragments[0].actors[0].groupKey='companions';assert.deepEqual(parse(p.afterContent),expected);assert.deepEqual(p.changedPaths,['/fragments/0/actors/0/groupKey']);assert.deepEqual(p.targets.map(t=>t.actors[0].groupId),recipe().placements.map(p=>p.groupIds.companions));await prepare(f.source,p);
  const reset=f.draft.propose(assign('leader',null));assert.equal(Object.hasOwn(parse(reset.afterContent).fragments[0].actors[0],'groupKey'),false);assert.deepEqual(reset.targets.map(t=>t.actors[0].groupId),[null,null]);await prepare(f.source,reset);assert.deepEqual(expandSceneComposition(reset.afterContent).scene.actors.map(a=>a.position),expandSceneComposition(f.source.content).scene.actors.map(a=>a.position));
});
test('REMOVE is restricted to a raw empty leaf preserves other declarations and can remove the last group',async()=>{
  const f=await open(await fixture(withLeaf())),p=f.draft.propose(remove());assert.deepEqual(parse(p.afterContent),recipe());assert.deepEqual(p.changedPaths,['/fragments/0/groups/2','/placements/0/groupIds/extra','/placements/1/groupIds/extra']);assert.deepEqual(p.targets.map(t=>t.groups.length),[2,2]);await prepare(f.source,p);
  const value=recipe();for(const a of value.fragments[0].actors)delete a.groupKey;value.fragments[0].groups.pop();value.placements.forEach(p=>{delete p.groupIds.companions;});const last=await open(await fixture(value)),removed=last.draft.propose(remove('party'));assert.deepEqual(removed.targets.map(t=>t.groups),[[],[]]);assert.ok(removed.targets.every(t=>t.actors.every(a=>a.groupId===null)));assert.ok(parse(removed.afterContent).placements.every(p=>Object.keys(p.groupIds).length===0));await prepare(last.source,removed);await fixture(removed.afterContent);
});
test('unused fragments support add edit assign reset and remove with zero targets and no effective output identity inventions',async()=>{
  let f=await open(),p=f.draft.propose(add(recipe(),'unused'));assert.deepEqual(p.targets,[]);assert.deepEqual(p.changedPaths,['/fragments/1/groups/0']);await prepare(f.source,p);assert.deepEqual(expandSceneComposition(p.afterContent).scene,expandSceneComposition(f.source.content).scene);
  f=await open(await fixture(p.afterContent));p=f.draft.propose(edit('extra','Unused renamed',null,'unused'));assert.deepEqual(p.targets,[]);await prepare(f.source,p);
  f=await open(await fixture(p.afterContent));p=f.draft.propose(assign('dormant','extra','unused'));assert.deepEqual(p.targets,[]);await prepare(f.source,p);const used=await open(await fixture(p.afterContent));assert.throws(()=>used.draft.propose(remove('extra','unused')),invalid);
  p=used.draft.propose(assign('dormant',null,'unused'));await prepare(used.source,p);f=await open(await fixture(p.afterContent));p=f.draft.propose(remove('extra','unused'));assert.deepEqual(p.targets,[]);assert.deepEqual(parse(p.afterContent).fragments[1].groups,[]);await prepare(f.source,p);
});
test('group mapping is exact complete source order with globally fresh generated IDs and definition reuse allowed',async()=>{
  const f=await open(),good=add();for(const mutate of [e=>e.instances.pop(),e=>e.instances.push({placementId:id(999),groupId:id(998)}),e=>e.instances.reverse(),e=>{e.instances[0].extra=true;},e=>{e.instances[0].placementId=id(999);},e=>{e.instances[1].groupId=e.instances[0].groupId;},...[f.model.scene.objectId,recipe().placements[0].placementId,recipe().placements[0].actorIds.leader,recipe().placements[1].groupIds.party,'BAD'].map(c=>e=>{e.instances[0].groupId=c;})]){const input=structuredClone(good);mutate(input);assert.throws(()=>f.draft.propose(input),invalid);}
  const reusable=add();reusable.instances[0].groupId=ids.first;assert.equal(f.draft.propose(reusable).targets[0].groups[2].groupId,ids.first);
});
test('exact input shapes native name rules reference constraints and raw leaf guard reject invalid organizational intentions',async()=>{
  const f=await open();for(const input of [{...add(),action:['add']},{...add(),extra:true},{...edit(),instances:[]},{...assign(),parentKey:null},{...remove(),name:'x'},edit('missing'),assign('missing'),assign('leader','missing'),edit('companions','x','missing'),edit('party','x','companions'),edit('party','x','party'),remove('party'),remove('companions'),edit('party',' '),edit('party','x\n'),edit('party','x\u007f'),edit('party','🦊'.repeat(81)),{...add(),group:{key:'extra',name:'x',parentKey:null}},{...add(),group:{key:'extra',name:'x',parentKey:'extra'}},{...add(),group:{key:'party',name:'duplicate'}},{...add(),group:{key:'extra',name:'x',position:[1,2]}}])assert.throws(()=>f.draft.propose(input),invalid);assert.ok(f.draft.propose(edit('party','🦊'.repeat(80))).afterContent);
});
test('semantic name parent and group assignment noops reject helper changes while retaining escaped raw source bytes',async()=>{
  const value=recipe();delete value.fragments[0].actors[0].groupKey;const raw=serialize(value).replace('"Party / 队伍 / 隊"','"\\u0050arty / 队伍 / 隊"').replace('360,','3.60e2,'),f=await open(await fixture(raw));
  for(const input of [edit('party',value.fragments[0].groups[0].name,null),edit('companions',value.fragments[0].groups[1].name,'party'),assign('leader',null),assign('companion','companions')])assert.throws(()=>f.draft.propose(input),{errorCode:'scene_composition_groups_unchanged'});assert.ok(f.source.content.includes('3.60e2'));assert.equal(f.source.content,raw);
});
test('parent and actor membership removal preserve BOM CRLF escaped decoded keys and unrelated fractional lexemes',async()=>{
  const value=recipe(),raw=serialize(value).replace('"parentKey"','"\\u0070arentKey"').replace('"groupKey"','"\\u0067roupKey"').replace('360,','3.60e2,').replace('180.25','1.8025e2'),f=await open(await fixture(raw));for(const input of [edit('companions','Changed name',null),assign('leader',null)]){const p=f.draft.propose(input);assert.ok(p.afterContent.startsWith('\uFEFF'));assert.ok(p.afterContent.endsWith('\r\n \t'));assert.ok(p.afterContent.includes('3.60e2'));assert.ok(p.afterContent.includes('1.8025e2'));assert.deepEqual(parse(p.afterContent).placements,value.placements);await prepare(f.source,p);}
});
test('all original actor/group provenance counts and structure must match including unrelated instances',async()=>{
  const original=await fixture();for(const mutate of [m=>m.sourceLocations.actors.reverse(),m=>m.sourceLocations.groups.pop(),m=>{m.sourceLocations.groups[3].composition.localKey='party';},m=>{m.sourceLocations.groups[3].declaration.sourceRevision=revision('old');},m=>{m.sourceLocations.actors[3].objectId=ids.first;},m=>{m.sceneStructure.groups[3].name='wrong';},m=>{m.sceneStructure.groups[3].parentGroupId=null;},m=>{delete m.sceneStructure.groups[3].parentGroupId;},m=>m.sceneStructure.memberships.reverse(),m=>m.sceneStructure.memberships.pop(),m=>{m.sceneStructure.memberships[3].groupId=id(999);},m=>{m.actors[3].groupId=id(999);},m=>{m.actors[3].position[0]++;},m=>{m.composition.placementCount=1;}]){const f=structuredClone(original);mutate(f.model);await assert.rejects(createSceneCompositionGroupsDraft(f.model,f.source,{digest:hash}),invalid);}for(const model of [null,1,[],{},'bad'])await assert.rejects(createSceneCompositionGroupsDraft(model,original.source,{digest:hash}),invalid);
});
test('saved and dirty source path base revision and preview hash prevent stale sessions',async()=>{
  const original=await fixture(recipe(),{dirty:true});for(const mutate of [f=>{f.source.sourcePath='other.json';},f=>{f.source.baseSourceRevision=revision('different');},f=>{f.model.composition.sourceRevision=revision('different');}]){const f=structuredClone(original);mutate(f);await assert.rejects(createSceneCompositionGroupsDraft(f.model,f.source,{digest:hash}),conflict);}await open(original);await assert.rejects(createSceneCompositionGroupsDraft(original.model,original.source,{digest:()=> 'bad'}),invalid);
});
test('factory snapshots complete source/model before await and proposal targets never mutate private authority',async()=>{
  const f=await fixture(),input=structuredClone(f),gate=deferred(),opening=createSceneCompositionGroupsDraft(input.model,input.source,{digest:()=>gate.promise});input.source.content='{}';input.model.actors[0].position[0]++;input.model.sourceLocations.groups=[];gate.resolve(hash(f.source.content));const d=await opening,p=d.propose(add()),expected=structuredClone(p);p.edit.instances.reverse();p.targets.pop();p.changedPaths=[];assert.deepEqual(d.propose(add()),expected);await prepare(f.source,expected);
});
test('host apply snapshots all action targets candidate and paths before hashing',async()=>{
  const f=await open(),p=f.draft.propose(edit()),expected=structuredClone(p),source=structuredClone(f.source),gate=deferred(),applying=prepare(source,p,()=>gate.promise);source.content='{}';p.edit.name='forged';p.targets[0].groups[0].name='forged';p.targets[1].actors.reverse();p.changedPaths=[];p.afterContent='{}';gate.resolve(hash(f.source.content));assert.deepEqual(await applying,{afterContent:expected.afterContent,changedPaths:expected.changedPaths});
});
test('all four action receipts require exact complete AFTER names parents memberships ordered identities and source bytes',async()=>{
  for(const input of [add(),edit(),assign(),remove()]){const f=await open(input.action==='remove'?await fixture(withLeaf()):null),good=f.draft.propose(input);for(const mutate of [p=>{p.targets.pop();},p=>{p.targets.reverse();},p=>{p.targets[0].groups.reverse();},p=>{p.targets[0].groups[0].name='forged';},p=>{p.targets[0].groups[0].parentGroupId=id(999);},p=>{delete p.targets[0].groups[0].parentGroupId;},p=>{p.targets[0].groups[0].groupId=id(999);},p=>{p.targets[0].actors.reverse();},p=>{p.targets[0].actors[0].groupId=id(999);},p=>{delete p.targets[0].actors[0].groupId;},p=>{p.targets[0].actors[0].objectId=id(999);},p=>{p.targets[0].extra=true;},p=>{p.changedPaths=[];},p=>{p.changedPaths.push(p.changedPaths[0]);},p=>{p.afterContent+=' ';},p=>{p.edit.extra=true;},p=>{p.extra=true;}]){const p=structuredClone(good);mutate(p);await assert.rejects(prepare(f.source,p),invalid);}for(const mutate of [s=>{s.sourcePath='other.json';},s=>{s.baseSourceRevision=revision('old');},s=>{s.content+=' ';}]){const source=structuredClone(f.source);mutate(source);await assert.rejects(prepare(source,good),conflict);}await prepare(f.source,good);}
});
test('strict snapshots reject accessors serializers symbols sparse input undefined nonfinite and excessive depth without code execution',async()=>{
  const f=await open();let calls=0;const getter=add();Object.defineProperty(getter,'instances',{enumerable:true,get(){calls++;return [];}});assert.throws(()=>f.draft.propose(getter),invalid);const serializer={...add(),toJSON(){calls++;return add();}};assert.throws(()=>f.draft.propose(serializer),invalid);const hidden=add();hidden[Symbol('x')]=true;assert.throws(()=>f.draft.propose(hidden),invalid);for(const input of [{...add(),instances:new Array(2)},{...edit(),parentKey:undefined},{...edit(),name:NaN}])assert.throws(()=>f.draft.propose(input),invalid);const deep=add();deep.extra={};let cursor=deep.extra;for(let i=0;i<70;i++){cursor.next={};cursor=cursor.next;}assert.throws(()=>f.draft.propose(deep),invalid);const p=f.draft.propose(assign());Object.defineProperty(p.targets[0].groups[0],'name',{enumerable:true,get(){calls++;return 'x';}});await assert.rejects(prepare(f.source,p),invalid);assert.equal(calls,0);
});
test('depth16 cycle and declared or expanded 128-group budgets are enforced for complete candidates including unused fragments',async()=>{
  const value=recipe();value.fragments[1].groups=Array.from({length:16},(_,i)=>({key:`g${i}`,name:`G${i}`,...(i?{parentKey:`g${i-1}`}:{})}));const f=await open(await fixture(value)),input=add(value,'unused');input.group.parentKey='g15';assert.throws(()=>f.draft.propose(input),invalid);input.group.parentKey='g14';const at=f.draft.propose(input);await prepare(f.source,at);
  value.fragments[1].groups=Array.from({length:126},(_,i)=>({key:`g${i}`,name:`G${i}`}));const declared=await open(await fixture(value));assert.throws(()=>declared.draft.propose(add(value,'unused')),{errorCode:'scene_composition_groups_content_limit'});
  const many=recipe();many.fragments.pop();many.placements=Array.from({length:64},(_,i)=>({placementId:id(1000+i*5),fragmentId:'party',actorIds:{leader:id(1001+i*5),companion:id(1002+i*5)},groupIds:{party:id(1003+i*5),companions:id(1004+i*5)}}));const expanded=await open(await fixture(many));assert.throws(()=>expanded.draft.propose(add(many)),{errorCode:'scene_composition_groups_content_limit'});
});
test('final 128KiB source budget permits shrinking rename and delete while preserving no-op spelling',async()=>{
  let raw=serialize(withLeaf());raw+=' '.repeat(131072-Buffer.byteLength(raw));const f=await open(await fixture(raw));const growth=add(withLeaf());growth.group.key='growth';assert.throws(()=>f.draft.propose(growth),{errorCode:'scene_composition_groups_content_limit'});const p=f.draft.propose(remove());assert.ok(Buffer.byteLength(p.afterContent)<131072);await prepare(f.source,p);const shorter=f.draft.propose(edit('party','P',null));assert.ok(Buffer.byteLength(shorter.afterContent)<131072);await prepare(f.source,shorter);
});
