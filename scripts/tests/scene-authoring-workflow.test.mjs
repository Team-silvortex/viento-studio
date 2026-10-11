import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSceneAuthoringWorkflow } from '../../engine/scene-authoring-workflow.mjs';
import { expandSceneComposition } from '../../engine/scene-composition.mjs';

const recipe = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
const copy = value => JSON.parse(JSON.stringify(value));
const hex = value => createHash('sha256').update(value).digest('hex'), revision = value => `sha256:${hex(value)}`;
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', previewId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const sourcePath = 'documents/scenes/recipe.json', content = JSON.stringify(recipe), base = revision(content);
const domains = [
 ['override','instance','canEditCompositionOverride'],['layout','instance','canEditCompositionLayout'],
 ['batch','positions','canEditCompositionBatchLayout'],['fragment','fragment','canEditCompositionFragment'],
 ['placement','placement','canEditCompositionPlacement'],['structure','structure','canEditCompositionStructure'],
];
const invalid = { errorCode: 'scene_composition_override_invalid' }, conflict = { errorCode: 'scene_composition_override_conflict' };
function deferred() { let resolve, reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no;}); return { promise,resolve,reject }; }
function proposal(kind) {
 const value = { sceneId,sourcePath,baseSourceRevision:base,sourceRevision:base,afterContent:content,changedPaths:['/fragments/0/actors/0/position'] };
 const first=recipe.placements[0],second=recipe.placements[1],instanceId=first.actorIds.leader;
 if(kind==='instance')Object.assign(value,{instanceId,placementId:first.placementId,actorKey:'leader',values:{position:[120,180]}});
 if(kind==='positions')value.changes=[{instanceId,placementId:first.placementId,actorKey:'leader',position:[120,180]}];
 if(kind==='fragment')Object.assign(value,{instanceId,fragmentId:'party',actorKey:'leader',values:{speed:17},targets:[first,second].map(p=>({instanceId:p.actorIds.leader,placementId:p.placementId,overrides:[]}))});
 if(kind==='placement')Object.assign(value,{instanceId,fragmentId:'party',placementId:first.placementId,offset:[0,0],
  targets:Object.entries(first.actorIds).map(([actorKey,instanceId])=>({instanceId,actorKey})),groups:Object.entries(first.groupIds).map(([groupKey,groupId])=>({groupId,groupKey}))});
 if(kind==='structure')Object.assign(value,{edit:{action:'remove',fragmentId:'unused',actorKey:'a'},targets:[]});
 return value;
}
function payload(value) {
 const expanded=expandSceneComposition(value.afterContent),raw=JSON.parse(value.afterContent),rev=revision(value.afterContent);
 return {ok:true,format:'viento-scene-preview',schemaVersion:2,previewId,scene:{objectId:sceneId,sourcePath,sourceRevision:rev},
 actors:expanded.scene.actors,sceneStructure:{groups:expanded.scene.groups},
 composition:{format:'viento-scene-composition-preview',schemaVersion:1,recipeObjectId:sceneId,sourcePath,sourceRevision:rev,fragmentCount:raw.fragments.length,placementCount:raw.placements.length},
 draft:{baseSourceRevision:base,sourceRevision:rev},
 sourceLocations:Object.fromEntries(['actors','groups'].map(kind=>[kind,expanded.sourceMap[kind].map((loc,index)=>({
  [kind==='actors'?'instanceId':'groupId']:loc[kind==='actors'?'instanceId':'groupId'],...(kind==='actors'?{objectId:expanded.scene.actors[index].objectId}:{}),
  composition:{fragmentId:loc.fragmentId,placementId:loc.placementId,localKey:loc.localKey},declaration:{objectId:sceneId,sourcePath,sourceRevision:rev}}))]))};
}
function fixture(domain=domains[0], overrides={}) {
 const[name,kind,capabilityKey]=domain,state={open:true,session:1,selected:sceneId,sourcePath,previewSupported:true,previewActive:true,requestBusy:false,running:false,
  context:{editable:true,creating:false,busy:false,compositionSourceWritable:true,sceneDraftPath:sourcePath,sceneDraftToken:'source:1',dirty:true,path:'private-author-path',canEditCompositionStructure:false}};
 const source={sourcePath,baseSourceRevision:base,content},catalog={images:[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'Portrait',path:'portrait.svg'}]},calls={source:[],catalog:[],review:[],released:[],apply:[],applied:[],opened:[]};
 const receipt={applied:true,focus(){}};
 const ports={kind,capabilityKey,isSupported:()=>true,getState:()=>state,
  getSource:async path=>{calls.source.push(path);return source;},loadCatalog:async owner=>{calls.catalog.push(owner);return catalog;},
  reviewCandidate:async(value,guard)=>{calls.review.push({value,guard});return payload(value);},releasePreview:id=>{calls.released.push(id);},digest:async value=>hex(value),
  applyDraft:async(value,guard)=>{calls.apply.push({value,guard});if(!guard.isCurrent())throw Object.assign(Error('stale'),conflict);state.context.sceneDraftToken='source:2';return receipt;},
  onApplied:(result,value,owner)=>{calls.applied.push({result,value,owner});},...overrides};
 const workflow=createSceneAuthoringWorkflow(ports),input={model:{composition:{},scene:{objectId:sceneId,sourcePath}},actorId:recipe.placements[0].actorIds.leader,isCurrent:()=>true};
 const editor={open:async value=>{calls.opened.push(value);return true;}};
 return{name,kind,capabilityKey,state,source,catalog,calls,receipt,ports,workflow,input,editor,proposal:proposal(kind)};
}

for(const domain of domains)test(`${domain[0]} workflow independently opens, checks and applies through narrow ports`,async()=>{
 const f=fixture(domain);assert.equal(f.workflow.canEdit(),true);assert.deepEqual(Object.keys(f.workflow.getContext()).sort(),['editable','creating','busy','compositionSourceWritable','sceneDraftPath','sceneDraftToken',f.capabilityKey].sort());
 assert.equal(f.workflow.getContext()[f.capabilityKey],true);assert.equal(await f.workflow.open(f.editor,f.input),true);
 assert.equal(f.calls.opened[0].isCurrent(),true);assert.notEqual(f.calls.opened[0].source,f.source);assert.notEqual(f.calls.opened[0].images,f.catalog.images);
 assert.deepEqual(await f.workflow.validateDraft(f.proposal),{ok:true});assert.deepEqual(f.calls.released,[previewId]);assert.equal(f.calls.apply.length,0);
 const result=await f.workflow.applySourceDraft(f.proposal);assert.equal(result,f.receipt);assert.equal(f.workflow.sourceApplied(result,f.proposal),true);
 assert.equal(f.calls.applied.length,1);assert.notEqual(f.calls.applied[0].value,f.proposal);assert.deepEqual(f.calls.applied[0].owner,{session:1,sceneId,sourcePath});
 assert.equal(f.workflow.sourceApplied(result,f.proposal),false);
});

test('invalid kind/capability pair is rejected rather than granting a sibling editing capability',()=>{
 for(const[kind,capabilityKey]of [['instance','canEditCompositionStructure'],['unknown','canEditCompositionOverride'],['constructor','canEditCompositionOverride'],['toString','canEditCompositionOverride'],['__proto__','canEditCompositionOverride'],['positions','__proto__']])assert.throws(()=>createSceneAuthoringWorkflow({kind,capabilityKey}),invalid);
});

test('editing gates require preview/source authority but never an installed execution backend',async()=>{
 const f=fixture();f.state.backend={available:false};assert.equal(f.workflow.canEdit(),true);
 for(const[stateChanges,contextChanges]of [[{open:false},{}],[{previewSupported:false},{}],[{previewActive:false},{}],[{requestBusy:true},{}],[{running:true},{}],
  [{selected:'invalid'},{}],[{sourcePath:'elsewhere'},{}],[{}, {editable:false}],[{}, {creating:true}],[{}, {busy:true}],[{}, {compositionSourceWritable:false}],[{}, {sceneDraftPath:'other'}],[{}, {sceneDraftToken:undefined}]]){
  const old={...f.state},ctx={...f.state.context};Object.assign(f.state,stateChanges);Object.assign(f.state.context,contextChanges);assert.equal(f.workflow.canEdit(),false);
  assert.equal(await f.workflow.open(f.editor,f.input),false);Object.assign(f.state,old);f.state.context=ctx;
 }assert.equal(f.calls.source.length,0);
 const unsupported=fixture(domains[0],{isSupported:()=>false});assert.equal(unsupported.workflow.canEdit(),false);
});

test('open binds the full recipe owner without binding a particular canvas actor selection',async()=>{
 const f=fixture();f.input.actorId=null;assert.equal(await f.workflow.open(f.editor,f.input),true);assert.equal(f.calls.opened[0].actorId,null);
 f.state.context.canEditCompositionStructure=true;f.state.context.path='another view preference';assert.equal(f.calls.opened[0].isCurrent(),true);
 const forged=fixture();forged.input.model.scene.objectId=recipe.placements[0].actorIds.leader;assert.equal(await forged.workflow.open(forged.editor,forged.input),false);assert.equal(forged.calls.source.length,0);
});

test('source acquisition snapshots raw source before catalog await and source/catalog DTOs remain detached',async()=>{
 const wait=deferred(),f=fixture(domains[0],{loadCatalog:()=>wait.promise});const opening=f.workflow.open(f.editor,f.input);await Promise.resolve();f.source.content='mutated port source';
 wait.resolve(f.catalog);assert.equal(await opening,true);assert.equal(f.calls.opened[0].source.content,content);f.catalog.images[0].name='mutated';assert.equal(f.calls.opened[0].images[0].name,'Portrait');
});

test('source, catalog and editor completion reject late owners and suppress stale port failures',async()=>{
 for(const stage of ['source','catalog','editor'])for(const reject of [false,true]){
  const wait=deferred(),overrides=stage==='source'?{getSource:()=>wait.promise}:stage==='catalog'?{loadCatalog:()=>wait.promise}:{},f=fixture(domains[0],overrides);
  if(stage==='editor')f.editor.open=()=>wait.promise;
  const opening=f.workflow.open(f.editor,f.input);await Promise.resolve();await Promise.resolve();f.state.context.sceneDraftToken='source:new';
  if(reject)wait.reject(Error('late secret'));else wait.resolve(stage==='source'?f.source:stage==='catalog'?f.catalog:true);
  assert.equal(await opening,false);
 }
});

test('current source/catalog failures remain observable and missing/mismatched source cannot open',async()=>{
 const f=fixture(domains[0],{getSource:()=>{throw Error('current failure');}});await assert.rejects(f.workflow.open(f.editor,f.input),/current failure/);
 for(const getSource of [()=>null,()=>({sourcePath:'other',baseSourceRevision:base,content})]){const h=fixture(domains[0],{getSource});assert.equal(await h.workflow.open(h.editor,h.input),false);assert.equal(h.calls.opened.length,0);}
});

test('reviewed proposals are detached and original changes across review await cannot approve',async()=>{
 const wait=deferred(),f=fixture(domains[0],{reviewCandidate:async(value,guard)=>{f.calls.review.push({value,guard});return wait.promise;}});
 const checking=f.workflow.validateDraft(f.proposal);assert.notEqual(f.calls.review[0].value,f.proposal);f.proposal.afterContent+=' ';assert.equal(f.calls.review[0].guard.isCurrent(),false);
 wait.resolve(payload(f.calls.review[0].value));await assert.rejects(checking,conflict);assert.deepEqual(f.calls.released,[previewId]);assert.equal(f.calls.apply.length,0);
});

test('review ownership covers close, selection, source path, token, session, capability, reset and external guard',async()=>{
 for(const change of [f=>{f.state.open=false;},f=>{f.state.selected=recipe.placements[0].actorIds.leader;},f=>{f.state.sourcePath='other';},f=>{f.state.context.sceneDraftToken='next';},
  f=>{f.state.session++;},f=>{f.state.context.compositionSourceWritable=false;},f=>f.workflow.reset(),f=>{f.live=false;}]){
  const wait=deferred(),f=fixture(domains[0],{reviewCandidate:()=>wait.promise});f.live=true;const checking=f.workflow.validateDraft(f.proposal,{isCurrent:()=>f.live});change(f);
  wait.resolve(payload(f.proposal));await assert.rejects(checking,conflict);assert.deepEqual(f.calls.released,[previewId]);
 }
});

test('proposal and owner are rechecked after digest while unrelated language/rendering state is ignored',async()=>{
 const wait=deferred(),f=fixture(domains[0],{digest:()=>wait.promise});const checking=f.workflow.validateDraft(f.proposal);await Promise.resolve();await Promise.resolve();f.proposal.instanceId=recipe.placements[0].actorIds.companion;
 wait.resolve(hex(content));await assert.rejects(checking,conflict);assert.deepEqual(f.calls.released,[previewId]);
 const h=fixture(domains[0],{digest:async()=>{h.state.language='ja';h.state.context={...h.state.context,language:'ja'};return hex(content);}});assert.deepEqual(await h.workflow.validateDraft(h.proposal),{ok:true});
});

test('candidate rejection and invalid digest release a valid preview ID without granting application',async()=>{
 for(const overrides of [{reviewCandidate:async value=>({...payload(value),ok:false})},{digest:()=> 'sha256:'+hex(content)},{digest:()=> 'bad'},
  {reviewCandidate:async value=>({...payload(value),sceneEditing:{}})}]){
  const f=fixture(domains[0],overrides);await assert.rejects(f.workflow.validateDraft(f.proposal),invalid);assert.deepEqual(f.calls.released,[previewId]);assert.equal(f.calls.apply.length,0);
 }
});

test('temporary preview release is best effort for synchronous errors and rejected promises and never waits for cleanup',async()=>{
 for(const releasePreview of [()=>{throw Error('release failure');},()=>Promise.reject(Error('release failure')),()=>new Promise(()=>{})]){
  const f=fixture(domains[0],{releasePreview});assert.deepEqual(await f.workflow.validateDraft(f.proposal),{ok:true});await Promise.resolve();
 }
});

test('missing or invalid preview IDs cannot be sent to the release port',async()=>{
 for(const id of [undefined,'../arbitrary','BAD']){const f=fixture(domains[0],{reviewCandidate:async value=>{const result=payload(value);if(id===undefined)delete result.previewId;else result.previewId=id;return result;}});
  await assert.rejects(f.workflow.validateDraft(f.proposal),invalid);assert.deepEqual(f.calls.released,[]);
 }
});

test('apply detaches before await and mutable caller proposals cannot acquire a success receipt',async()=>{
 const wait=deferred(),f=fixture(domains[0],{applyDraft:async(value,guard)=>{f.calls.apply.push({value,guard});return wait.promise;}});
 const applying=f.workflow.applySourceDraft(f.proposal);assert.notEqual(f.calls.apply[0].value,f.proposal);f.proposal.afterContent+=' ';
 assert.equal(f.calls.apply[0].guard.isCurrent(),false);wait.resolve(f.receipt);await assert.rejects(applying,conflict);assert.equal(f.workflow.sourceApplied(f.receipt,f.proposal),false);
});

test('mutating the submitted DTO invalidates both the host isCurrent guard and its completed receipt',async()=>{
 const wait=deferred(),f=fixture(domains[0],{applyDraft:async(value,guard)=>{f.calls.apply.push({value,guard});return wait.promise;}});
 const applying=f.workflow.applySourceDraft(f.proposal);f.calls.apply[0].value.afterContent+=' ';assert.equal(f.calls.apply[0].guard.isCurrent(),false);
 wait.resolve(f.receipt);await assert.rejects(applying,invalid);assert.equal(f.workflow.sourceApplied(f.receipt,f.proposal),false);
});

test('valid committed completion may advance source token but closed/replaced owners cannot retain the receipt',async()=>{
 for(const change of [f=>{f.state.open=false;},f=>{f.state.session++;},f=>{f.state.selected=recipe.placements[0].actorIds.leader;},f=>{f.state.sourcePath='other';},f=>f.workflow.reset()]){
  const wait=deferred(),f=fixture(domains[0],{applyDraft:()=>wait.promise});const applying=f.workflow.applySourceDraft(f.proposal);change(f);wait.resolve(f.receipt);
  await assert.rejects(applying,conflict);assert.equal(f.workflow.sourceApplied(f.receipt,f.proposal),false);
 }
 const f=fixture();const receipt=await f.workflow.applySourceDraft(f.proposal);assert.equal(f.state.context.sceneDraftToken,'source:2');assert.equal(f.workflow.sourceApplied(receipt,f.proposal),true);
});

test('invalid or rejected apply results do not create a reusable source completion receipt',async()=>{
 for(const result of [null,{}, {applied:false},{applied:'true'}]){const f=fixture(domains[0],{applyDraft:async()=>result});await assert.rejects(f.workflow.applySourceDraft(f.proposal),invalid);assert.equal(f.workflow.sourceApplied(result,f.proposal),false);}
 const f=fixture(domains[0],{applyDraft:async()=>{throw Error('host conflict');}});await assert.rejects(f.workflow.applySourceDraft(f.proposal),/host conflict/);assert.equal(f.workflow.sourceApplied(f.receipt,f.proposal),false);
});

test('completion requires the identical result, full canonical proposal and original owner and is single-use',async()=>{
 const f=fixture();const result=await f.workflow.applySourceDraft(f.proposal),forged=copy(f.proposal);forged.changedPaths=[];
 assert.equal(f.workflow.sourceApplied({...result},f.proposal),false);assert.equal(f.workflow.sourceApplied(result,forged),false);assert.equal(f.calls.applied.length,0);
 assert.equal(f.workflow.sourceApplied(result,copy(f.proposal)),true);assert.equal(f.workflow.sourceApplied(result,f.proposal),false);
});

test('six sibling workflows cannot reuse another domain completion or be reset by a sibling lifecycle',async()=>{
 const all=domains.map(domain=>fixture(domain)),origin=all[0],receipt=await origin.workflow.applySourceDraft(origin.proposal);
 for(const other of all.slice(1)){assert.equal(other.workflow.sourceApplied(receipt,origin.proposal),false);other.workflow.reset();assert.equal(origin.workflow.canEdit(),true);}
 assert.equal(origin.workflow.sourceApplied(receipt,origin.proposal),true);
});

test('new source sessions cannot replay an old receipt even when source path and selected recipe repeat',async()=>{
 const f=fixture(),receipt=await f.workflow.applySourceDraft(f.proposal);f.state.open=false;f.workflow.reset();f.state.open=true;f.state.session++;
 assert.equal(f.workflow.sourceApplied(receipt,f.proposal),false);assert.equal(f.calls.applied.length,0);
});

test('snapshot validation rejects getters, serializers, cycles, sparse arrays and non-JSON data without executing code',async()=>{
 let reads=0;
 for(const alter of [p=>Object.defineProperty(p,'afterContent',{enumerable:true,get(){reads++;return content;}}),p=>{p.toJSON=()=>{reads++;return {};};},p=>{p.values=new Date();},p=>{p.values=new Array(2);},p=>{p.values=p;}]){
  const f=fixture();alter(f.proposal);await assert.rejects(f.workflow.validateDraft(f.proposal),invalid);await assert.rejects(f.workflow.applySourceDraft(f.proposal),invalid);assert.equal(f.calls.review.length,0);assert.equal(f.calls.apply.length,0);
 }assert.equal(reads,0);
});

test('workflow module imports only pure authoring contracts and has no GUI, HTTP, backend or save dependency',async()=>{
 const source=await fs.readFile(new URL('../../engine/scene-authoring-workflow.mjs',import.meta.url),'utf8');
 const imports=[...source.matchAll(/import .* from '([^']+)'/g)].map(match=>match[1]);assert.deepEqual(imports,['./canonical-json.mjs','./scene-authoring-candidate.mjs']);
 assert.doesNotMatch(source,/\b(?:document|window|fetch|localStorage|requestWorldCommand|writeDoc)\s*[.(]/);
});


test('open snapshots the model and chosen actor before awaits instead of consuming later mutable input',async()=>{
 const wait=deferred(),f=fixture(domains[0],{getSource:()=>wait.promise}),oldActor=f.input.actorId;
 const opening=f.workflow.open(f.editor,f.input);f.input.model.scene.objectId='wrong';f.input.actorId=null;wait.resolve(f.source);
 assert.equal(await opening,true);assert.equal(f.calls.opened[0].model.scene.objectId,sceneId);assert.equal(f.calls.opened[0].actorId,oldActor);
});

test('overlapping open attempts and reopening expire old form owners without sharing UI state',async()=>{
 const wait=deferred();let count=0;const f=fixture(domains[0],{getSource:()=>++count===1?wait.promise:Promise.resolve(f.source)});
 const first=f.workflow.open(f.editor,f.input),second=f.workflow.open(f.editor,f.input);assert.equal(await second,true);const priorOwner=f.calls.opened[0].isCurrent;
 wait.resolve(f.source);assert.equal(await first,false);assert.equal(priorOwner(),true);assert.equal(await f.workflow.open(f.editor,f.input),true);assert.equal(priorOwner(),false);
});

test('overlapping reviews use the latest request while every returned preview is still released',async()=>{
 const first=deferred(),second=deferred();let count=0;const f=fixture(domains[0],{reviewCandidate:()=>++count===1?first.promise:second.promise});
 const older=f.workflow.validateDraft(f.proposal),newer=f.workflow.validateDraft(f.proposal);second.resolve(payload(f.proposal));assert.deepEqual(await newer,{ok:true});
 first.resolve(payload(f.proposal));await assert.rejects(older,conflict);assert.deepEqual(f.calls.released,[previewId,previewId]);
});

test('an older overlapping apply cannot overwrite a newer pending receipt or retain host write authority',async()=>{
 const first=deferred(),second=deferred();let count=0;const f=fixture(domains[0],{applyDraft:(value,guard)=>{f.calls.apply.push({value,guard});return ++count===1?first.promise:second.promise;}});
 const older=f.workflow.applySourceDraft(f.proposal),newer=f.workflow.applySourceDraft(f.proposal),oldReceipt={applied:true},newReceipt={applied:true};
 assert.equal(f.calls.apply[0].guard.isCurrent(),false);assert.equal(f.calls.apply[1].guard.isCurrent(),true);
 second.resolve(newReceipt);assert.equal(await newer,newReceipt);first.resolve(oldReceipt);await assert.rejects(older,conflict);
 assert.equal(f.workflow.sourceApplied(oldReceipt,f.proposal),false);assert.equal(f.workflow.sourceApplied(newReceipt,f.proposal),true);assert.equal(f.calls.applied.length,1);
});
