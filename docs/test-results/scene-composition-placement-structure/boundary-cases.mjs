// Host-owned synthetic recipe proofs. The supplied API may belong to a standard
// VM with no Node, DOM or network globals. Persistence/projections use host tests.
import assert from 'node:assert/strict';
import { fixture, sha, copy, parse, serialize, revision } from '../scene-composition-placement-offset/boundary-cases.mjs';
const id = n => `${n.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
const same = (a,b) => assert.deepEqual(copy(a),copy(b));
const invalid = e => e?.errorCode === 'scene_composition_placements_invalid';
const conflict = e => e?.errorCode === 'scene_composition_placements_conflict';
export function recipe() {
 return {format:'viento-scene-composition',schemaVersion:1,scene:{title:'Placement structure / 放置 / 配置🦊',viewport:[800,480],background:'#0d1829'},
  fragments:[{fragmentId:'pair',actors:[{key:'leader',objectId:id(1),groupKey:'root',position:[10.125,20.25],useProjectionDefaults:true},
   {key:'companion',objectId:id(1),groupKey:'sub',position:[30.5,40.75],useProjectionDefaults:true}],
   groups:[{key:'root',name:'Root'},{key:'sub',name:'Sub',parentKey:'root'}]},
   {fragmentId:'unused',actors:[{key:'dormant',objectId:id(1),position:[0,0],useProjectionDefaults:true}],groups:[]}],
  placements:[{placementId:id(10),fragmentId:'pair',actorIds:{leader:id(11),companion:id(12)},groupIds:{root:id(13),sub:id(14)}},
   {placementId:id(20),fragmentId:'pair',actorIds:{leader:id(21),companion:id(22)},groupIds:{root:id(23),sub:id(24)},offset:[300,80],
    overrides:[{actorKey:'companion',values:{imageResourceId:null,controls:'none',speed:18.25,color:'#abcdef',size:[32,48],position:[111,222]}},{actorKey:'leader',values:{speed:0}}]}]};
}
const add = fragmentId => ({action:'add',fragmentId:fragmentId||'pair',placementId:id(900),actorIds:fragmentId==='unused'?{dormant:id(901)}:{leader:id(901),companion:id(902)},groupIds:fragmentId==='unused'?{}:{root:id(903),sub:id(904)}});
const duplicate = (value=recipe(),index=1) => ({action:'copy',sourcePlacementId:value.placements[index].placementId,placementId:id(900),actorIds:{leader:id(901),companion:id(902)},groupIds:{root:id(903),sub:id(904)}});
const remove = (value=recipe(),index=0) => ({action:'remove',placementId:value.placements[index].placementId});
const open = (api,f,digest=sha) => api.createSceneCompositionPlacementsDraft(f.model,f.source,{digest});
const prepare = (api,f,p,digest=sha) => api.prepareSceneCompositionPlacementsApply(f.source,p,{digest});
const deferred = () => {let resolve;const promise=new Promise(done=>resolve=done);return {resolve,promise};};
export async function runPlacementsCases(api) {
 assert.equal(api.supportsStudioCoreCompositionPlacements(),true);const checks=[];
 for(const dirty of [false,true]) {const f=fixture(api,recipe(),dirty),before=copy(f),d=await open(api,f);
  same(d.fragments,recipe().fragments);same(d.placements,recipe().placements);
  for(const edit of [{...add(),offset:[-5.125,20.25]},duplicate(),remove()]) {const p=d.propose(edit),value=recipe(),expected=copy(value);
   if(edit.action==='remove')expected.placements.splice(0,1);
   else {const placement=edit.action==='copy'?copy(value.placements[1]):{fragmentId:'pair',offset:edit.offset};Object.assign(placement,{placementId:edit.placementId,actorIds:edit.actorIds,groupIds:edit.groupIds});expected.placements.push(placement);}
   same(parse(p.afterContent),expected);same(p.edit,edit);same(p.changedPaths,[`/placements/${edit.action==='remove'?0:2}`]);
   same(await prepare(api,f,p),{afterContent:p.afterContent,changedPaths:p.changedPaths});
   same(p.targets.actors.map(actor=>actor.objectId),[id(1),id(1)]);assert.equal(p.targets.groups.length,2);
   assert.equal(api.expandSceneComposition(p.afterContent).scene.actors.length,edit.action==='remove'?2:6);
  }same(f,before);
 }
 checks.push({id:'saved-dirty-add-copy-remove-whole-placement-and-source-retained',ok:true,sourceModes:2,actions:3});
 {for(const declared of [false,true]){const value=recipe();if(declared){value.placements[0].offset=[0,0];value.placements[0].overrides=[];}const f=fixture(api,value),d=await open(api,f),p=d.propose(duplicate(value,0)),after=parse(p.afterContent).placements[2];assert.equal(Object.hasOwn(after,'offset'),declared);assert.equal(Object.hasOwn(after,'overrides'),declared);if(declared){same(after.offset,[0,0]);same(after.overrides,[]);}await prepare(api,f,p);}
  const f=fixture(api,recipe()),d=await open(api,f),p=d.propose(duplicate());same(p.targets.overrides,[{actorKey:'companion',fields:['position','size','color','speed','controls','imageResourceId']},{actorKey:'leader',fields:['speed']}]);assert.equal(parse(p.afterContent).placements[2].overrides[0].values.imageResourceId,null);
 }
 checks.push({id:'copy-declaration-absence-explicit-zero-empty-overrides-and-six-null-field-masks',ok:true});
 {const value=recipe(),raw=serialize(value).replace('300,','3.00e2,').replace('18.25','1.825e1'),f=fixture(api,raw),p=(await open(api,f)).propose(duplicate(value));
  assert.equal((p.afterContent.match(/3\.00e2/g)||[]).length,2);assert.equal((p.afterContent.match(/1\.825e1/g)||[]).length,2);
  assert.ok(p.afterContent.startsWith('\uFEFF'));assert.ok(p.afterContent.endsWith('\r\n \t'));
  const itemEnd=raw.lastIndexOf('\r\n\t]\r\n}');assert.ok(itemEnd>0);assert.equal(p.afterContent.slice(0,itemEnd),raw.slice(0,itemEnd));
  const sourceGroupOrder=raw.indexOf('"sub":',raw.lastIndexOf('"groupIds"'));assert.ok(sourceGroupOrder>0);same(parse(p.afterContent).placements[2].overrides,value.placements[1].overrides);await prepare(api,f,p);
 }
 checks.push({id:'copy-original-span-numeric-lexemes-key-order-BOM-CRLF-and-old-token-prefix',ok:true});
 {const f=fixture(api,recipe()),d=await open(api,f),p=d.propose(add('unused'));same(p.targets,{placementId:id(900),fragmentId:'unused',actors:[{actorKey:'dormant',instanceId:id(901),objectId:id(1)}],groups:[],overrides:[]});assert.equal(Object.hasOwn(parse(p.afterContent).placements[2],'offset'),false);assert.equal(api.expandSceneComposition(p.afterContent).scene.actors.length,5);await prepare(api,f,p);}
 checks.push({id:'unused-fragment-first-placement-is-a-source-declaration-with-empty-groups',ok:true});
 {const f=fixture(api,recipe()),d=await open(api,f),identities=[f.model.scene.objectId,id(10),id(11),id(24),id(900)];
  for(const collision of identities){const edit=add();edit.actorIds.leader=collision;assert.throws(()=>d.propose(edit),invalid);}
  for(const alter of [e=>{delete e.actorIds.companion;},e=>{e.groupIds.extra=id(998);},e=>{e.actorIds.companion=e.actorIds.leader;},e=>{e.groupIds.root=e.actorIds.leader;},e=>{e.placementId=f.model.scene.objectId;},e=>{e.overrides=[];},e=>{e.offset=null;}]){const edit=add();alter(edit);assert.throws(()=>d.propose(edit),invalid);}
  for(const edit of [{...duplicate(),offset:[0,0]},{...duplicate(),sourcePlacementId:id(99)},{...remove(),actorIds:{}}])assert.throws(()=>d.propose(edit),invalid);
  const reusable=add();reusable.actorIds.leader=id(1);assert.equal(d.propose(reusable).targets.actors[0].instanceId,id(1));assert.equal(api.getStudioCoreMetadata().ready,true);
 }
 checks.push({id:'exact-intents-complete-fresh-identity-domains-scene-collision-and-definition-reuse',ok:true,rejectedOperations:15});
 {const value=recipe();value.placements.pop();const f=fixture(api,value),d=await open(api,f);assert.throws(()=>d.propose(remove(value)),invalid);assert.throws(()=>d.propose({...add(),offset:[100000,0]}),invalid);
  const all=fixture(api,recipe()),p=(await open(api,all)).propose(remove());const after=api.expandSceneComposition(p.afterContent);assert.equal(after.scene.actors.some(actor=>actor.instanceId===all.model.actors[0].instanceId),false);assert.equal(after.scene.groups.some(group=>group.groupId===id(13)),false);same(parse(p.afterContent).fragments,recipe().fragments);await prepare(api,all,p);
 }
 checks.push({id:'last-placement-forbidden-whole-removal-opener-absent-and-final-world-bounds',ok:true});
 {const f=fixture(api,recipe()),d=await open(api,f),p=d.propose(duplicate()),variants=[q=>{q.targets.actors.pop();},q=>{q.targets.actors.reverse();},q=>{q.targets.actors[0].objectId=id(99);},q=>{q.targets.actors[0].instanceId=id(99);},q=>{q.targets.groups.reverse();},q=>{q.targets.groups[0].groupId=id(99);},q=>{q.targets.overrides[0].fields=[];},q=>{q.targets.fragmentId='unused';},q=>{q.targets.placementId=id(99);},q=>{q.targets.extra=true;},q=>{q.edit.placementId=id(99);},q=>{q.edit.extra=true;},q=>{q.afterContent+=' ';},q=>{q.changedPaths=[];},q=>{q.changedPaths.push(q.changedPaths[0]);},q=>{q.extra=true;}];
  for(const alter of variants){const proposal=copy(p);alter(proposal);await assert.rejects(prepare(api,f,proposal),invalid);}
  for(const alter of [s=>{s.sourcePath='other.json';},s=>{s.baseSourceRevision=revision('old');},s=>{s.content+=' ';}]){const changed=copy(f);alter(changed.source);await assert.rejects(prepare(api,changed,p),conflict);}await prepare(api,f,p);
 }
 checks.push({id:'host-recomputes-all-action-target-order-provenance-source-path-candidate-and-receipt',ok:true,rejectedOperations:19});
 {const f=fixture(api,recipe()),variants=[m=>m.sourceLocations.actors.reverse(),m=>m.sourceLocations.groups.pop(),m=>{m.sourceLocations.actors[2].objectId=id(99);},m=>{m.sourceLocations.groups[2].composition.localKey='sub';},m=>{m.sourceLocations.groups[3].declaration.sourceRevision=revision('other');},m=>{m.sceneStructure.groups[3].name='forged';},m=>{m.actors[3].position[0]++;},m=>{m.composition.placementCount=1;}];
  for(const alter of variants){const model=copy(f.model);alter(model);await assert.rejects(api.createSceneCompositionPlacementsDraft(model,f.source,{digest:sha}),invalid);}for(const model of [null,[],1,'wrong',{}])await assert.rejects(api.createSceneCompositionPlacementsDraft(model,f.source,{digest:sha}),invalid);
 }
 checks.push({id:'all-original-preview-actors-organizational-groups-and-malformed-models-bind-source',ok:true,rejectedOperations:13});
 {const f=fixture(api,recipe(),true),before=copy(f),gate=deferred(),pending=open(api,f,()=>gate.promise);f.source.content='{}';f.model.actors[0].position[0]++;f.model.sourceLocations.groups=[];gate.resolve(sha(before.source.content));const d=await pending,p=d.propose(duplicate()),expected=copy(p),source=copy(before.source),wait=deferred(),applying=api.prepareSceneCompositionPlacementsApply(source,p,{digest:()=>wait.promise});source.content='{}';p.targets.groups.reverse();p.targets.actors.pop();p.edit.actorIds.leader=id(99);p.afterContent='{}';p.changedPaths=[];wait.resolve(sha(before.source.content));same(await applying,{afterContent:expected.afterContent,changedPaths:expected.changedPaths});same(d.propose(duplicate()),expected);}
 checks.push({id:'whole-model-source-and-proposal-detached-before-asynchronous-digest',ok:true});
 {let raw=serialize(recipe());raw+=' '.repeat(131072-new TextEncoder().encode(raw).length);const f=fixture(api,raw),d=await open(api,f);assert.throws(()=>d.propose(duplicate()),e=>e?.errorCode==='scene_composition_placements_content_limit');const p=d.propose(remove());assert.ok(new TextEncoder().encode(p.afterContent).length<131072);await prepare(api,f,p);
  const value=recipe();value.fragments.pop();value.placements=Array.from({length:64},(_,i)=>({placementId:id(1000+i*5),fragmentId:'pair',actorIds:{leader:id(1001+i*5),companion:id(1002+i*5)},groupIds:{root:id(1003+i*5),sub:id(1004+i*5)}}));const full=fixture(api,value),draft=await open(api,full);assert.throws(()=>draft.propose(add()),e=>e?.errorCode==='scene_composition_placements_content_limit');await prepare(api,full,draft.propose(remove(value)));
 }
 checks.push({id:'complete-expanded-128-actor-group-and-final-source-byte-budgets-shrinking-remove',ok:true});
 {const f=fixture(api,recipe()),request={protocolVersion:1,operation:'sceneComposition.addPlacement',content:f.source.content,fragmentId:'pair',placementId:id(900),actorIds:add().actorIds,groupIds:add().groupIds};for(const dispatch of [api.dispatchStudioCoreComposition,api.dispatchStudioCoreCompositionPatch,api.dispatchStudioCoreCompositionFragment,api.dispatchStudioCoreCompositionFragmentEdit,api.dispatchStudioCoreCompositionPlacement,api.dispatchStudioCoreCompositionPositions,api.dispatchStudioCoreCompositionStructure])assert.throws(()=>dispatch(request),e=>e?.errorCode==='studio_core_request_invalid');assert.equal(api.getStudioCoreMetadata().ready,true);}
 checks.push({id:'new-placement-structure-operation-is-independent-of-all-seven-existing-interfaces',ok:true,rejectedOperations:7});
 return checks;
}
