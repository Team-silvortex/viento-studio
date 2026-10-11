// Synthetic valid effective previews isolate author-source placement edits.
// Projection/resource dependency resolution and persistence need real host tests.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export const sha = value => createHash('sha256').update(value).digest('hex');
export const copy = value => JSON.parse(JSON.stringify(value));
export const parse = text => JSON.parse(text.replace(/^\uFEFF/, ''));
export const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
export const revision = text => `sha256:${sha(text)}`;
const same = (a,b) => assert.deepEqual(copy(a),copy(b));
const unchanged = error => error?.errorCode === 'scene_composition_override_unchanged';
export function fixture(api,seed,dirty=false) {
 const content=typeof seed==='string'?seed:serialize(seed), value=parse(content), expanded=copy(api.expandSceneComposition(content)), sourceRevision=revision(content);
 const sceneId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',source={sourcePath:'documents/placement-offset.json',baseSourceRevision:dirty?revision('saved baseline'):sourceRevision,content};
 const declaration={objectId:sceneId,sourcePath:source.sourcePath,sourceRevision};
 const actors=expanded.scene.actors.map(actor=>({size:[32,48],color:'#ffffff',speed:150,controls:'arrows',...actor,name:actor.instanceId}));
 const model={ok:true,format:'viento-scene-preview',schemaVersion:2,
  scene:{objectId:sceneId,sourcePath:source.sourcePath,sourceRevision,viewport:expanded.scene.viewport,background:expanded.scene.background},actors,
  composition:{format:'viento-scene-composition-preview',schemaVersion:1,recipeObjectId:sceneId,sourcePath:source.sourcePath,sourceRevision,fragmentCount:value.fragments.length,placementCount:value.placements.length},
  sourceLocations:{actors:expanded.sourceMap.actors.map((entry,index)=>({instanceId:entry.instanceId,objectId:actors[index].objectId,
   composition:{fragmentId:entry.fragmentId,placementId:entry.placementId,localKey:entry.localKey},declaration:copy(declaration)})),
   groups:expanded.sourceMap.groups.map(entry=>({groupId:entry.groupId,composition:{fragmentId:entry.fragmentId,placementId:entry.placementId,localKey:entry.localKey},declaration:copy(declaration)}))},
  sceneStructure:copy(api.createSceneStructure(expanded.scene)),...(dirty?{draft:{baseSourceRevision:source.baseSourceRevision,sourceRevision}}:{})};
 return {source,model,ids:actors.map(actor=>actor.instanceId)};
}
const open=(api,f,index=2,digest=sha)=>api.createSceneCompositionPlacementDraft(f.model,f.source,f.ids[index],{digest});
const prepare=(api,f,p,digest=sha)=>api.prepareSceneCompositionPlacementApply(f.source,p,{digest});
export const request=(content,placementId,offset,extra={})=>({protocolVersion:1,operation:'sceneComposition.editPlacementOffset',content,placementId,offset,...extra});
const edit=(api,f,index,offset)=>api.dispatchStudioCoreCompositionPlacement(request(f.source.content,parse(f.source.content).placements[index].placementId,offset));
function expected(value,index,offset) { const out=copy(value); if(offset===null)delete out.placements[index].offset; else out.placements[index].offset=copy(offset); return out; }
export async function runPlacementCases(api,example) {
 assert.equal(api.supportsStudioCoreCompositionPlacement(),true);const checks=[];
 for(const dirty of [false,true]) {
  const f=fixture(api,example,dirty),before=copy(f),draft=await open(api,f),offset=[375.5,-80.25],p=draft.propose(offset);
  same(p.targets,[{instanceId:f.ids[2],actorKey:'leader'},{instanceId:f.ids[3],actorKey:'companion'}]);
  same(p.groups,example.fragments[0].groups.map(group=>({groupId:example.placements[1].groupIds[group.key],groupKey:group.key})));
  same(p.offset,offset);same(p.changedPaths,['/placements/1/offset']);same(parse(p.afterContent),expected(example,1,offset));
  same(await prepare(api,f,p),{afterContent:p.afterContent,changedPaths:p.changedPaths});same(f,before);
  const expanded=api.expandSceneComposition(p.afterContent);same(expanded.scene.actors[2].position,[475.5,59.75]);same(expanded.scene.actors[3].position,[575.5,99.75]);
  same(expanded.scene.groups,api.expandSceneComposition(f.source.content).scene.groups);
  const pairText=f.source.content.match(/"offset":\s*(\[[^\]]*\])/)[1];
  assert.equal(p.afterContent,f.source.content.replace(pairText,pairText.replace('360','375.5').replace('80','-80.25')));
 }
 checks.push({id:'saved-dirty-whole-placement-fractional-offset-local-masks-and-byte-replacement',ok:true,sourceModes:2});
 {const f=fixture(api,example),draft=await open(api,f,0);assert.equal(draft.offset,null);const p=draft.propose([0,0]);
  same(parse(p.afterContent),expected(example,0,[0,0]));same(api.expandSceneComposition(p.afterContent).scene,api.expandSceneComposition(f.source.content).scene);await prepare(api,f,p);
  const added=fixture(api,p.afterContent),reset=(await open(api,added,0)).propose(null);same(parse(reset.afterContent),example);await prepare(api,added,reset);
  assert.throws(()=>draft.propose(null),unchanged);same(edit(api,f,0,null),{afterContent:f.source.content,changedPaths:[]});}
 checks.push({id:'missing-versus-explicit-zero-author-intent-and-noop-delete',ok:true});
 {const f=fixture(api,example),draft=await open(api,f),p=draft.propose(null),after=api.expandSceneComposition(p.afterContent);
  same(parse(p.afterContent),expected(example,1,null));same(after.scene.actors[2].position,[100,140]);same(after.scene.actors[3].position,[200,180]);
  same(parse(p.afterContent).placements[1].overrides,example.placements[1].overrides);await prepare(api,f,p);}
 checks.push({id:'reset-restores-zero-after-local-override-without-group-transform',ok:true});
 {const content=serialize(example).replace('360,','36e1,').replace('80\r\n\t\t]','8e1\r\n\t\t]'),f=fixture(api,content),draft=await open(api,f);
  assert.throws(()=>draft.propose([360,80]),unchanged);same(edit(api,f,1,[360,80]),{afterContent:content,changedPaths:[]});}
 checks.push({id:'semantic-pair-noop-preserves-original-numeric-spelling-and-all-bytes',ok:true});
 {const f=fixture(api,example),draft=await open(api,f),invalid=[undefined,{},'0,0',[],[0],[0,0,0],[null,0],['0',0],[NaN,0],[Infinity,0],[-Infinity,0],[100001,0],[0,-100001],new Array(2)];
  for(const offset of invalid)assert.throws(()=>draft.propose(offset));
  const input=request(f.source.content,example.placements[1].placementId,[1,2]);Object.defineProperty(input,'offset',{get(){throw new Error('getter executed');},enumerable:true});
  assert.throws(()=>api.dispatchStudioCoreCompositionPlacement(input),e=>e?.errorCode==='studio_core_request_invalid');
  assert.equal(api.getStudioCoreMetadata().ready,true);}
 checks.push({id:'finite-whole-pair-exact-intent-and-accessor-rejection-before-dispatch',ok:true,rejectedOperations:15});
 {const variants=[];const invalid=copy(example);invalid.fragments[0].actors[1].position=[100001,0];variants.push(serialize(invalid));
  const unselected=copy(example);unselected.placements[0].offset=[100000,0];variants.push(serialize(unselected));
  const unused=copy(example);unused.fragments.push({...copy(example.fragments[0]),fragmentId:'unused'});unused.fragments[1].actors[0].size=[0,1];variants.push(serialize(unused));
  variants.push(serialize(example).replace('"schemaVersion": 1','"schemaVersion": 1, "schemaVersion": 1'));
  for(const content of variants)assert.throws(()=>api.dispatchStudioCoreCompositionPlacement(request(content,example.placements[1].placementId,null)));
  assert.equal(api.getStudioCoreMetadata().ready,true);}
 checks.push({id:'invalid-original-and-unused-declaration-cannot-be-repaired-by-offset',ok:true,rejectedOperations:4});
 {const value=copy(example);for(const actor of value.fragments[0].actors)actor.position=[0,0];value.fragments[0].actors[1].position=[99990,0];value.placements[1].overrides[0].values.position=[0,0];value.placements[1].offset=[0,0];
  const f=fixture(api,value),draft=await open(api,f),before=copy(draft.offset);assert.throws(()=>draft.propose([11,0]));same(draft.offset,before);
  const p=draft.propose([10,0]);await prepare(api,f,p);same(api.expandSceneComposition(p.afterContent).scene.actors[3].position,[100000,0]);
  assert.throws(()=>draft.propose([-100000,100001]));assert.equal(api.getStudioCoreMetadata().ready,true);}
 checks.push({id:'every-final-target-world-bounds-including-unselected-actor-atomic',ok:true,rejectedOperations:2});
 {const value=copy(example);value.placements.reverse();value.fragments[0].actors.reverse();value.fragments[0].groups.reverse();const f=fixture(api,value),id=example.placements[1].actorIds.leader;
  const d=await api.createSceneCompositionPlacementDraft(f.model,f.source,id,{digest:sha}),p=d.propose([-12.5,20]);
  same(p.targets,value.fragments[0].actors.map(actor=>({instanceId:value.placements[0].actorIds[actor.key],actorKey:actor.key})));
  same(p.groups,value.fragments[0].groups.map(group=>({groupId:value.placements[0].groupIds[group.key],groupKey:group.key})));
  same(p.changedPaths,['/placements/0/offset']);await prepare(api,f,p);}
 checks.push({id:'stable-selection-and-declaration-order-after-source-reorder',ok:true});
 {const f=fixture(api,example),d=await open(api,f),p=d.propose([12,34]),variants=[p=>p.offset[0]++,p=>p.targets.pop(),p=>p.targets.reverse(),p=>p.targets[0].actorKey='forged',
  p=>p.targets[0].instanceId=f.model.actors[2].objectId,p=>p.groups.pop(),p=>p.groups.reverse(),p=>p.groups[0].groupKey='forged',p=>p.groups[0].groupId=example.placements[0].groupIds.party,
  p=>p.placementId=example.placements[0].placementId,p=>p.fragmentId='forged',p=>p.afterContent+=' ',p=>p.changedPaths.push('/fragments'),p=>p.extra=true];
  for(const alter of variants){const q=copy(p);alter(q);await assert.rejects(prepare(api,f,q));}
  await assert.rejects(prepare(api,{...f,source:{...f.source,content:f.source.content+' '}},p));
  await assert.rejects(prepare(api,{...f,source:{...f.source,baseSourceRevision:revision('other')}},p));
  await assert.rejects(prepare(api,{...f,source:{...f.source,sourcePath:'documents/other.json'}},p));
  same(await prepare(api,f,p),{afterContent:p.afterContent,changedPaths:p.changedPaths});}
 checks.push({id:'exact-proposal-all-targets-groups-path-and-source-recomputed',ok:true,rejectedOperations:17});
 {const f=fixture(api,example),variants=[m=>m.sourceLocations.actors.pop(),m=>m.sourceLocations.actors.push(copy(m.sourceLocations.actors[0])),m=>m.sourceLocations.actors[0].objectId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  m=>m.sourceLocations.actors[0].composition.localKey='forged',m=>m.sourceLocations.groups.pop(),m=>m.sourceLocations.groups.push(copy(m.sourceLocations.groups[0])),
  m=>m.sourceLocations.groups[0].composition.fragmentId='forged',m=>m.sourceLocations.groups[0].declaration.sourceRevision=revision('other'),
  m=>m.sceneStructure.memberships[0].groupId=example.placements[1].groupIds.party,m=>m.actors[0].position[0]++];
  for(const alter of variants){const model=copy(f.model);alter(model);await assert.rejects(api.createSceneCompositionPlacementDraft(model,f.source,f.ids[2],{digest:sha}));}
  const noGroups=copy(example);noGroups.fragments[0].groups=[];for(const actor of noGroups.fragments[0].actors)delete actor.groupKey;for(const placement of noGroups.placements)placement.groupIds={};
  const g=fixture(api,noGroups),p=(await open(api,g)).propose([1,2]);same(p.groups,[]);await prepare(api,g,p);}
 checks.push({id:'whole-preview-actor-group-provenance-and-structure-not-selected-only',ok:true,rejectedOperations:10});
 {const f=fixture(api,example,true),before=copy(f);let resolve,text;const gate=new Promise(done=>resolve=done),opening=open(api,f,2,content=>{text=content;return gate;});
  f.source.content='{}';f.model.sourceLocations.groups[0].composition.localKey='forged';f.model.actors[2].position[0]=999;resolve(sha(text));
  const d=await opening,p=d.propose([12.5,-20.5]);await prepare(api,before,p);d.offset[0]=999;d.targets.reverse();d.groups[0].groupKey='forged';same(d.propose([12.5,-20.5]),p);
  let finish,captured;const wait=new Promise(done=>finish=done),source=copy(before.source),proposal=copy(p),applying=api.prepareSceneCompositionPlacementApply(source,proposal,{digest:content=>{captured=content;return wait;}});
  source.content='{}';proposal.offset[0]=999;proposal.targets.reverse();proposal.groups.pop();finish(sha(captured));same(await applying,{afterContent:p.afterContent,changedPaths:p.changedPaths});}
 checks.push({id:'source-model-offset-target-and-group-snapshots-before-asynchronous-digest',ok:true});
 {const value=copy(example);value.placements=[value.placements[0]];const actor=copy(value.fragments[0].actors[0]);value.fragments[0].actors=[];value.fragments[0].groups=[];value.placements[0].actorIds={};value.placements[0].groupIds={};
  const id=n=>`00000000-0000-0000-0000-${n.toString(16).padStart(12,'0')}`;
  for(let n=0;n<128;n++){const key=`a${n}`,groupKey=`g${n}`;value.fragments[0].groups.push({key:groupKey,name:groupKey});value.fragments[0].actors.push({...copy(actor),key,groupKey,position:[0,0]});value.placements[0].actorIds[key]=id(n+1);value.placements[0].groupIds[groupKey]=id(n+256);}
  const f=fixture(api,value),d=await open(api,f,0),p=d.propose([0.25,-0.5]);assert.equal(p.targets.length,128);assert.equal(p.groups.length,128);await prepare(api,f,p);same(parse(p.afterContent),expected(value,0,[0.25,-0.5]));}
 checks.push({id:'full-128-actor-and-128-organizational-group-target-budget',ok:true});
 {let variants=0;for(const order of ['first','middle','tail'])for(const mode of ['compact','pretty','escaped']) {
  const value=copy(example),placement=value.placements[1],entries=Object.entries(placement).filter(([key])=>key!=='offset'),index=order==='first'?0:order==='tail'?entries.length:Math.floor(entries.length/2);
  entries.splice(index,0,['offset',placement.offset]);value.placements[1]=Object.fromEntries(entries);
  let content=mode==='compact'?JSON.stringify(value):serialize(value);if(mode==='escaped')content=content.replace('"offset"','"\\u006fffset"');
  const f=fixture(api,content),p=(await open(api,f)).propose(null);same(parse(p.afterContent),expected(value,1,null));await prepare(api,f,p);
  const boundary=content.indexOf('"placements"');assert.equal(p.afterContent.slice(0,boundary),content.slice(0,boundary));
  if(mode!=='compact')assert.ok(p.afterContent.startsWith('\uFEFF')&&p.afterContent.endsWith('\r\n \t'));variants++;
 }assert.equal(variants,9);}
 checks.push({id:'offset-member-removal-first-middle-tail-and-escaped-decoded-key',ok:true,variants:9});
 {const f=fixture(api,example),input=request(f.source.content,example.placements[1].placementId,[1,2]);
  for(const dispatch of [api.dispatchStudioCoreCompositionFragment,api.dispatchStudioCoreCompositionFragmentEdit,api.dispatchStudioCoreCompositionPatch,api.dispatchStudioCoreCompositionPositions,api.dispatchStudioCoreComposition])
   assert.throws(()=>dispatch(input),e=>e?.errorCode==='studio_core_request_invalid');
  const absent=copy(example),prefix=serialize(absent),padded=prefix+' '.repeat(131072-new TextEncoder().encode(prefix).length),at=fixture(api,padded),d=await open(api,at,0);
  assert.throws(()=>d.propose([1,2]));const reset=(await open(api,at)).propose(null);assert.ok(new TextEncoder().encode(reset.afterContent).length<131072);await prepare(api,at,reset);
  assert.equal(api.getStudioCoreMetadata().ready,true);}
 checks.push({id:'independent-operation-domain-and-final-byte-budget',ok:true,rejectedOperations:6});
 return checks;
}
