import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSceneCompositionPlacementsDraft, prepareSceneCompositionPlacementsApply } from '../../engine/scene-composition-placements.mjs';
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
const invalid = error => error?.errorCode === 'scene_composition_placements_invalid';
const conflict = error => error?.errorCode === 'scene_composition_placements_conflict';
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
async function open(f = null) { f ||= await fixture(); return { ...f,draft:await createSceneCompositionPlacementsDraft(f.model,f.source,{digest:hash}) }; }
const prepare = (source,proposal,digest=hash) => prepareSceneCompositionPlacementsApply(source,proposal,{digest});
const add = (fragmentId='party') => ({action:'add',fragmentId,placementId:id(900),actorIds:fragmentId==='unused'?{dormant:id(901)}:{leader:id(901),companion:id(902)},groupIds:fragmentId==='unused'?{}:{party:id(903),companions:id(904)}});
const copy = (value=recipe(),index=1) => ({action:'copy',sourcePlacementId:value.placements[index].placementId,placementId:id(900),actorIds:{leader:id(901),companion:id(902)},groupIds:{party:id(903),companions:id(904)}});
const remove = (value=recipe(),index=0) => ({action:'remove',placementId:value.placements[index].placementId});
function deferred() { let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve}; }

test('raw frozen fragment and placement declarations include unused templates and preserve missing versus explicit zero',async()=>{
  const value=recipe();value.placements[1].offset=[0,0];value.placements[1].overrides=[];
  for(const dirty of [false,true]) {const f=await open(await fixture(value,{dirty}));assert.deepEqual(Object.keys(f.draft).sort(),['fragments','placements','propose']);assert.deepEqual(f.draft.fragments,value.fragments);assert.deepEqual(f.draft.placements,value.placements);assert.equal(Object.hasOwn(f.draft.placements[0],'offset'),false);assert.deepEqual(f.draft.placements[1].offset,[0,0]);assert.throws(()=>f.draft.placements[0].actorIds.leader=id(9),TypeError);assert.throws(()=>f.draft.fragments[0].actors.pop(),TypeError);}
});
test('ADD appends a complete placement with stable actors nested groups and explicit optional offset',async()=>{
  const f=await open(),edit={...add(),offset:[-5.125,20.25]},p=f.draft.propose(edit),value=parse(f.source.content);value.placements.push({...edit});delete value.placements.at(-1).action;
  assert.deepEqual(parse(p.afterContent),value);assert.deepEqual(p.changedPaths,['/placements/2']);assert.deepEqual(p.targets,{placementId:id(900),fragmentId:'party',actors:[{actorKey:'leader',instanceId:id(901),objectId:ids.first},{actorKey:'companion',instanceId:id(902),objectId:ids.second}],groups:[{groupKey:'party',groupId:id(903)},{groupKey:'companions',groupId:id(904)}],overrides:[]});
  assert.deepEqual(await prepare(f.source,p),{afterContent:p.afterContent,changedPaths:p.changedPaths});const rebuilt=await fixture(p.afterContent);assert.equal(rebuilt.model.actors[4].instanceId,id(901));assert.deepEqual(rebuilt.model.actors[4].position,[115,200.5]);
});
test('unused fragment gains its first placement without requiring an existing effective actor',async()=>{
  const f=await open(),p=f.draft.propose(add('unused'));assert.equal(p.targets.actors.length,1);assert.deepEqual(p.targets.groups,[]);assert.deepEqual(p.targets.overrides,[]);assert.equal(Object.hasOwn(parse(p.afterContent).placements.at(-1),'offset'),false);assert.equal((await fixture(p.afterContent)).model.actors.at(-1).instanceId,id(901));await prepare(f.source,p);
});
test('COPY preserves all six override declarations raw null numeric lexemes and original token key order',async()=>{
  const value=recipe();value.placements[1].overrides=[{actorKey:'companion',values:{imageResourceId:null,controls:'none',speed:4.125,color:'#abcdef',size:[32,48],position:[1.25,2.5]}},{actorKey:'leader',values:{speed:0}}];
  const content=serialize(value).replace('4.125','4.125e0').replace('360,','3.60e2,').replace('80\r','8.0e1\r'),f=await open(await fixture(content)),p=f.draft.propose(copy(value));
  const expected=structuredClone(value.placements[1]);Object.assign(expected,{placementId:id(900),actorIds:add().actorIds,groupIds:add().groupIds});assert.deepEqual(parse(p.afterContent).placements[2],expected);
  assert.ok(p.afterContent.includes('4.125e0'));assert.equal((p.afterContent.match(/4\.125e0/g)||[]).length,2);assert.ok(p.afterContent.endsWith('\r\n \t'));assert.ok(p.afterContent.startsWith('\uFEFF'));
  assert.deepEqual(p.targets.overrides,[{actorKey:'companion',fields:['position','size','color','speed','controls','imageResourceId']},{actorKey:'leader',fields:['speed']}]);assert.equal(p.edit.sourcePlacementId,value.placements[1].placementId);assert.equal(Object.hasOwn(p.edit,'offset'),false);await prepare(f.source,p);assert.equal((await fixture(p.afterContent)).model.actors[5].instanceId,id(902));
});
test('COPY retains missing, explicit zero and empty overrides author intent',async()=>{
  for(const declared of [false,true]) {const value=recipe();delete value.placements[0].overrides;if(declared){value.placements[0].offset=[0,0];value.placements[0].overrides=[];}const f=await open(await fixture(value)),p=f.draft.propose(copy(value,0)),after=parse(p.afterContent).placements[2];assert.equal(Object.hasOwn(after,'offset'),declared);assert.equal(Object.hasOwn(after,'overrides'),declared);await prepare(f.source,p);}
});
test('REMOVE affects exactly one placement including all actor group and override identities and permits removed opener',async()=>{
  for(const index of [0,1]) {const f=await open(),value=parse(f.source.content),p=f.draft.propose(remove(value,index)),target=value.placements[index];assert.equal(p.targets.placementId,target.placementId);assert.deepEqual(p.targets.actors.map(a=>a.instanceId),value.fragments[0].actors.map(a=>target.actorIds[a.key]));value.placements.splice(index,1);assert.deepEqual(parse(p.afterContent),value);assert.deepEqual(p.changedPaths,[`/placements/${index}`]);await prepare(f.source,p);assert.equal((await fixture(p.afterContent)).model.actors.length,2);}
});
test('exact action schemas fresh identity domains and complete maps reject malformed intentions without allocating IDs',async()=>{
  const f=await open(),good=add(),collisions=[f.model.scene.objectId,recipe().placements[0].placementId,recipe().placements[0].actorIds.leader,recipe().placements[0].groupIds.party,id(900)];
  for(const mutate of [e=>{e.action='offset';},e=>{e.extra=true;},e=>{e.fragmentId='absent';},e=>{delete e.actorIds.companion;},e=>{e.groupIds.extra=id(99);},e=>{e.actorIds.companion=e.actorIds.leader;},e=>{e.groupIds.party=e.actorIds.leader;},e=>{e.placementId=f.model.scene.objectId;},e=>{e.offset=null;},e=>{e.offset=[100001,0];},e=>{e.overrides=[];},...collisions.map(id=>e=>{e.actorIds.leader=id;})]) {const edit=structuredClone(good);mutate(edit);assert.throws(()=>f.draft.propose(edit),invalid);}
  for(const edit of [{...copy(),offset:[0,0]},{...copy(),overrides:[]},{...copy(),sourcePlacementId:id(2)},{...remove(),actorIds:{}},{...remove(),placementId:id(999)}])assert.throws(()=>f.draft.propose(edit),invalid);
  // Object definition IDs are reusable audit references, outside the generated identity domain.
  const reusable=add();reusable.actorIds.leader=ids.first;assert.equal(f.draft.propose(reusable).targets.actors[0].instanceId,ids.first);
});
test('last placement cannot be removed and local/offset final world overflow is rejected atomically',async()=>{
  const value=recipe();value.placements.pop();const f=await open(await fixture(value));assert.throws(()=>f.draft.propose(remove(value)),invalid);assert.throws(()=>f.draft.propose({...add(),offset:[100000,0]}),invalid);assert.ok(f.draft.propose({...add(),offset:[0,0]}).afterContent);
});
test('original complete actor group provenance preview geometry and declaration counts remain binding',async()=>{
  const original=await fixture();for(const mutate of [m=>m.sourceLocations.groups.pop(),m=>m.sourceLocations.actors.reverse(),m=>{m.sourceLocations.groups[3].composition.localKey='party';},m=>{m.sourceLocations.actors[3].objectId=ids.first;},m=>{m.sourceLocations.groups[3].declaration.sourceRevision=revision('old');},m=>{m.sceneStructure.groups[3].name='wrong';},m=>{m.actors[3].position[0]++;},m=>{m.composition.placementCount=1;}]) {const f=structuredClone(original);mutate(f.model);await assert.rejects(createSceneCompositionPlacementsDraft(f.model,f.source,{digest:hash}),invalid);}
});
test('source base path and preview hashes reject stale sessions but support dirty source bases',async()=>{
  const original=await fixture(recipe(),{dirty:true});for(const model of [null,[],1,'bad',{}])await assert.rejects(createSceneCompositionPlacementsDraft(model,original.source,{digest:hash}),invalid);for(const mutate of [f=>{f.source.baseSourceRevision=revision('other');},f=>{f.source.sourcePath='other.json';},f=>{f.model.composition.sourceRevision=revision('other');}]) {const f=structuredClone(original);mutate(f);await assert.rejects(createSceneCompositionPlacementsDraft(f.model,f.source,{digest:hash}),conflict);}await open(original);
});
test('factory and apply detach complete model source edit target receipts before asynchronous digest',async()=>{
  const f=await fixture(),input=structuredClone(f),wait=deferred(),pending=createSceneCompositionPlacementsDraft(input.model,input.source,{digest:()=>wait.promise});input.model.actors[0].position[0]++;input.model.sourceLocations.groups.length=0;input.source.content='{}';wait.resolve(hash(f.source.content));const draft=await pending,p=draft.propose(copy()),expected=structuredClone(p),source=structuredClone(f.source),gate=deferred(),applying=prepare(source,p,()=>gate.promise);source.content='{}';p.targets.actors.pop();p.edit.actorIds.leader=id(1);p.changedPaths=[];p.afterContent='{}';gate.resolve(hash(f.source.content));assert.deepEqual(await applying,{afterContent:expected.afterContent,changedPaths:expected.changedPaths});const again=draft.propose(copy());assert.deepEqual(again,expected);
});
test('apply rejects every forged action target provenance candidate and changed path receipt',async()=>{
  const f=await open();for(const edit of [add(),copy(),remove()]) {const good=f.draft.propose(edit);for(const mutate of [p=>{p.extra=true;},p=>{p.targets.extra=true;},p=>{p.targets.actors.pop();},p=>{p.targets.actors.reverse();},p=>{p.targets.actors[0].objectId=id(999);},p=>{p.targets.actors[0].instanceId=id(999);},p=>{p.targets.groups.reverse();},p=>{p.targets.groups[0].groupId=id(999);},p=>{p.targets.fragmentId='unused';},p=>{p.targets.placementId=id(999);},p=>{p.changedPaths=[];},p=>{p.changedPaths.push(p.changedPaths[0]);},p=>{p.afterContent+=' ';},p=>{p.edit.placementId=id(99);},p=>{p.edit.extra=true;}]) {const p=structuredClone(good);mutate(p);await assert.rejects(prepare(f.source,p),invalid);}if(good.targets.overrides.length){const p=structuredClone(good);p.targets.overrides[0].fields=[];await assert.rejects(prepare(f.source,p),invalid);}for(const mutate of [s=>{s.content+=' ';},s=>{s.sourcePath='other.json';},s=>{s.baseSourceRevision=revision('old');}]){const source=structuredClone(f.source);mutate(source);await assert.rejects(prepare(source,good),conflict);}}
});
test('snapshots reject accessors custom serializers symbols holes and non JSON values without invoking them',async()=>{
  const f=await open();let calls=0;const accessor=add();Object.defineProperty(accessor,'actorIds',{enumerable:true,get(){calls++;return add().actorIds;}});assert.throws(()=>f.draft.propose(accessor),invalid);assert.equal(calls,0);
  for(const edit of [{...add(),toJSON(){throw new Error('do not invoke');}},{...add(),offset:[,0]},{...add(),offset:[NaN,0]},{...add(),offset:[undefined,0]}])assert.throws(()=>f.draft.propose(edit),invalid);
  const p=f.draft.propose(copy());Object.defineProperty(p.targets,'groups',{enumerable:true,get(){calls++;return [];}});await assert.rejects(prepare(f.source,p),invalid);assert.equal(calls,0);
});
test('final source budget accepts shrinking removal and rejects growing copies even with same recipe semantics',async()=>{
  let content=serialize(recipe());content+=' '.repeat(128*1024-Buffer.byteLength(content));const f=await open(await fixture(content));assert.throws(()=>f.draft.propose(copy()),{errorCode:'scene_composition_placements_content_limit'});const p=f.draft.propose(remove());assert.ok(Buffer.byteLength(p.afterContent)<128*1024);await prepare(f.source,p);
});
