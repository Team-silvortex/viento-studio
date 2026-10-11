// Synthetic valid effective previews isolate source-level shared inheritance.
// Live projection/resource dependencies and persistence belong to the browser.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const copy=v=>JSON.parse(JSON.stringify(v)),same=(a,b)=>assert.deepEqual(copy(a),copy(b));
const revision=text=>`sha256:${sha(text)}`,parse=text=>JSON.parse(text.replace(/^\uFEFF/,''));
const serialize=v=>'\uFEFF'+JSON.stringify(v,null,'\t').replaceAll('\n','\r\n')+'\r\n \t';
const fields=['position','size','color','speed','controls','imageResourceId'],optional=fields.slice(1);
const noChange=e=>e?.errorCode==='scene_composition_override_unchanged';
function fixture(api,seed,dirty=false){const content=typeof seed==='string'?seed:serialize(seed),value=parse(content),expanded=copy(api.expandSceneComposition(content)),sourceRevision=revision(content);
 const sceneId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',source={sourcePath:'documents/shared-fragment-inheritance.json',baseSourceRevision:dirty?revision('saved baseline'):sourceRevision,content};
 const actors=expanded.scene.actors.map(actor=>({size:[32,48],color:'#ffffff',speed:150,controls:'arrows',...actor,name:actor.instanceId}));
 const model={ok:true,format:'viento-scene-preview',schemaVersion:2,
  scene:{objectId:sceneId,sourcePath:source.sourcePath,sourceRevision,viewport:expanded.scene.viewport,background:expanded.scene.background},actors,
  composition:{format:'viento-scene-composition-preview',schemaVersion:1,recipeObjectId:sceneId,sourcePath:source.sourcePath,sourceRevision,fragmentCount:value.fragments.length,placementCount:value.placements.length},
  sourceLocations:{actors:expanded.sourceMap.actors.map((entry,index)=>({instanceId:entry.instanceId,objectId:actors[index].objectId,
   composition:{fragmentId:entry.fragmentId,placementId:entry.placementId,localKey:entry.localKey},declaration:{objectId:sceneId,sourcePath:source.sourcePath,sourceRevision}}))},
  sceneStructure:copy(api.createSceneStructure(expanded.scene)),...(dirty?{draft:{baseSourceRevision:source.baseSourceRevision,sourceRevision}}:{})};return{source,model,ids:actors.map(actor=>actor.instanceId)};}
const inherited=example=>{const v=copy(example);v.fragments[0].actors[0].useProjectionDefaults=true;return v;};
const open=(api,f,index=0,digest=sha)=>api.createSceneCompositionFragmentDraft(f.model,f.source,f.ids[index],{digest});
const prepare=(api,f,p,digest=sha)=>api.prepareSceneCompositionFragmentApply(f.source,p,{digest});
const edit=(api,content,values,reset,actorKey='leader',fragmentId='party',extra={})=>api.dispatchStudioCoreCompositionFragmentEdit({protocolVersion:1,
 operation:'sceneComposition.editFragmentActor',content,fragmentId,actorKey,values,reset,...extra});
export async function runInheritanceCases(api,example){assert.equal(api.supportsStudioCoreCompositionFragmentEdit(),true);const checks=[];
 for(const dirty of[false,true]){const value=inherited(example),unused=copy(value.fragments[0]);unused.fragmentId='unused';value.fragments.push(unused);
  const f=fixture(api,value,dirty),before=copy(f),draft=await open(api,f,2),p=draft.proposeEdit({values:{position:[130,190],speed:170},reset:['imageResourceId','size','color']});
  same(p.reset,['size','color','imageResourceId']);same(p.values,{position:[130,190],speed:170});same(p.changedPaths,['position','size','color','speed','imageResourceId'].map(field=>`/fragments/0/actors/0/${field}`));
  const after=parse(p.afterContent),expected=copy(value);Object.assign(expected.fragments[0].actors[0],p.values);for(const field of p.reset)delete expected.fragments[0].actors[0][field];
  same(after,expected);same(await prepare(api,f,p),{afterContent:p.afterContent,changedPaths:p.changedPaths});same(f,before);
  same(p.targets,[{instanceId:f.ids[0],placementId:value.placements[0].placementId,overrides:[]},
   {instanceId:f.ids[2],placementId:value.placements[1].placementId,overrides:['position','color','speed','controls']}]);
  assert.ok(p.afterContent.startsWith('\uFEFF')&&p.afterContent.endsWith('\r\n \t'));}
 checks.push({id:'saved-and-dirty-atomic-mixed-intent-all-targets',ok:true,sourceModes:2});
 {const value=inherited(example),f=fixture(api,value),draft=await open(api,f),p=draft.proposeEdit({values:{},reset:[...optional].reverse()});
  same(p.reset,optional);same(p.values,{});const actor=parse(p.afterContent).fragments[0].actors[0];
  same(actor,Object.fromEntries(Object.entries(value.fragments[0].actors[0]).filter(([key])=>!optional.includes(key))));assert.equal(actor.useProjectionDefaults,true);same(actor.position,[120,180]);
  same(parse(p.afterContent).placements,value.placements);await prepare(api,f,p);}
 checks.push({id:'five-optional-declarations-reset-whole-size-and-flag-stable',ok:true});
 {for(const flag of[undefined,false,true]){const value=copy(example);if(flag!==undefined)value.fragments[0].actors[0].useProjectionDefaults=flag;
   const f=fixture(api,value),draft=await open(api,f),p=draft.proposeEdit({values:{},reset:['imageResourceId']});
   assert.equal(Object.hasOwn(parse(p.afterContent).fragments[0].actors[0],'imageResourceId'),false);same(parse(p.afterContent).placements,value.placements);await prepare(api,f,p);}
  const value=inherited(example);value.fragments[0].actors[0].imageResourceId=null;const f=fixture(api,value),draft=await open(api,f),p=draft.proposeEdit({values:{},reset:['imageResourceId']});
  assert.equal(Object.hasOwn(parse(p.afterContent).fragments[0].actors[0],'imageResourceId'),false);same(p.changedPaths,['/fragments/0/actors/0/imageResourceId']);await prepare(api,f,p);
  const blocked=await open(api,fixture(api,example));for(const field of optional.slice(0,-1))assert.throws(()=>blocked.proposeEdit({values:{},reset:[field]}));}
 checks.push({id:'image-absence-without-inheritance-and-null-resumes-projection',ok:true,rejectedOperations:4,
  scope:'Tests source absence/flag preservation only, not live projected effective image resolution.'});
 {const value=inherited(example);for(const placement of value.placements){placement.overrides||=[];let entry=placement.overrides.find(entry=>entry.actorKey==='leader');
   if(!entry){entry={actorKey:'leader',values:{}};placement.overrides.push(entry);}Object.assign(entry.values,Object.fromEntries(optional.map(field=>[field,value.fragments[0].actors[0][field]])));}
  const f=fixture(api,value),before=copy(api.expandSceneComposition(f.source.content).scene),draft=await open(api,f),p=draft.proposeEdit({values:{},reset:optional});
  same(api.expandSceneComposition(p.afterContent).scene,before);assert.ok(p.targets.every(target=>optional.every(field=>target.overrides.includes(field))));await prepare(api,f,p);assert.notEqual(p.afterContent,f.source.content);}
 checks.push({id:'all-placement-masks-still-permit-source-reset',ok:true});
 {const value=inherited(example);delete value.fragments[0].actors[0].imageResourceId;delete value.fragments[0].actors[0].size;
  const f=fixture(api,value),draft=await open(api,f),p=draft.proposeEdit({values:{speed:170},reset:['size','imageResourceId']});same(p.reset,[]);same(p.values,{speed:170});await prepare(api,f,p);
  assert.throws(()=>draft.proposeEdit({values:{},reset:['size','imageResourceId']}),noChange);
  same(edit(api,f.source.content,{},['size','imageResourceId']),{afterContent:f.source.content,changedPaths:[]});
  const inheritedDraft=await open(api,fixture(api,inherited(example))),inputs=[{values:{},reset:['position']},{values:{},reset:['size','size']},{values:{},reset:['size/0']},
   {values:{},reset:['useProjectionDefaults']},{values:{speed:170},reset:['speed']},{values:{},reset:new Array(1)},{values:{},reset:[]},
   {values:{size:[0,1]},reset:['color']},{values:{speed:NaN},reset:['color']}];
  for(const input of inputs)assert.throws(()=>inheritedDraft.proposeEdit(input));assert.equal(api.getStudioCoreMetadata().ready,true);}
 checks.push({id:'net-absent-resets-new-shape-and-strict-intent-before-noop',ok:true,rejectedOperations:10});
 {const cases=[];for(const mode of['compact','pretty','escaped'])for(let mask=1;mask<32;mask++){
   const value=inherited(example),actor=value.fragments[0].actors[0],reset=optional.filter((_,i)=>mask>>i&1),v={};
   // Put removable declarations before required members or at the tail. Append
   // one previously absent optional field in the same token transaction.
   const add=optional.find(field=>!reset.includes(field));if(add){v[add]=actor[add];delete actor[add];}
   value.fragments[0].actors[0]=mode==='compact'?{...Object.fromEntries(reset.map(field=>[field,actor[field]])),...actor}:actor;
   let content=mode==='compact'?JSON.stringify(value):serialize(value);if(mode==='escaped')content=content.replace('"size"','"si\\u007ae"');
   const receipt=edit(api,content,v,reset),expected=parse(content);Object.assign(expected.fragments[0].actors[0],v);for(const field of reset)delete expected.fragments[0].actors[0][field];
   same(parse(receipt.afterContent),expected);same(receipt.changedPaths,fields.filter(field=>reset.includes(field)||Object.hasOwn(v,field)).map(field=>`/fragments/0/actors/0/${field}`));cases.push(mode+mask);}
  assert.equal(cases.length,93);}
 checks.push({id:'token-removal-subsets-head-middle-tail-and-append',ok:true,variants:93});
 {const value=inherited(example);value.fragments[0].actors[0].position=[9999,9999];delete value.fragments[0].actors[0].speed;
  const prefix=serialize(value),content=prefix+' '.repeat(131072-new TextEncoder().encode(prefix).length),f=fixture(api,content),draft=await open(api,f);
  assert.throws(()=>draft.proposeEdit({values:{speed:1999},reset:[]}),e=>e?.errorCode==='scene_composition_limit');
  const p=draft.proposeEdit({values:{speed:1999},reset:['imageResourceId']});assert.ok(new TextEncoder().encode(p.afterContent).length<=131072);await prepare(api,f,p);
  const bounds=inherited(example);for(const actor of bounds.fragments[0].actors)actor.position=[0,0];bounds.placements[1].offset=[99900,0];bounds.placements[1].overrides[0].values.position=[0,0];
  const b=fixture(api,bounds),blocked=await open(api,b,1),before=copy(blocked.values);assert.throws(()=>blocked.proposeEdit({values:{position:[101,0]},reset:['imageResourceId']}));same(blocked.values,before);assert.equal(api.getStudioCoreMetadata().ready,true);}
 checks.push({id:'final-source-budget-and-all-offset-bounds-atomic',ok:true,rejectedOperations:2});
 {const value=inherited(example),f=fixture(api,value),draft=await open(api,f),p=draft.proposeEdit({values:{speed:175},reset:['size','imageResourceId']});
  const variants=[p=>p.reset.reverse(),p=>p.reset.push('color'),p=>delete p.reset,p=>p.resetFields=['size'],p=>p.values.speed++,p=>p.afterContent+=' ',
   p=>p.targets.pop(),p=>p.targets.reverse(),p=>p.targets[0].overrides.push('size'),p=>p.changedPaths.reverse(),p=>p.fragmentId='forged',p=>p.actorKey='companion',
   p=>p.targets[0].instanceId=f.model.actors[0].objectId];
  for(const alter of variants){const wrong=copy(p);alter(wrong);await assert.rejects(prepare(api,f,wrong));}
  await assert.rejects(api.prepareSceneCompositionFragmentApply({...f.source,content:f.source.content+' '},p,{digest:sha}));
  const invalid=copy(f.model);invalid.sourceLocations.actors[3].composition.fragmentId='forged';await assert.rejects(api.createSceneCompositionFragmentDraft(invalid,f.source,f.ids[0],{digest:sha}));
  same(await prepare(api,f,p),{afterContent:p.afterContent,changedPaths:p.changedPaths});}
 checks.push({id:'exact-new-shape-target-mask-order-and-receipt-recomputed',ok:true,rejectedOperations:15});
 {const value=inherited(example),f=fixture(api,value,true),before=copy(f);let resolve,captured;const gate=new Promise(done=>resolve=done);
  const opening=open(api,f,0,text=>{captured=text;return gate;});f.source.content='{}';f.model.sourceLocations.actors[2].composition.localKey='forged';resolve(sha(captured));
  const draft=await opening,p=draft.proposeEdit({values:{speed:175},reset:['size','imageResourceId']});await prepare(api,before,p);
  const source=copy(before.source),proposal=copy(p);let finish,hashed;const wait=new Promise(done=>finish=done);
  const applying=api.prepareSceneCompositionFragmentApply(source,proposal,{digest:text=>{hashed=text;return wait;}});source.content='{}';proposal.reset.push('color');proposal.values.speed=999;proposal.targets.reverse();finish(sha(hashed));
  same(await applying,{afterContent:p.afterContent,changedPaths:p.changedPaths});draft.values.position[0]=999;draft.targets[0].overrides.push('color');same(draft.proposeEdit({values:{speed:175},reset:['size','imageResourceId']}),p);}
 checks.push({id:'detached-model-source-reset-and-targets-before-async-digest',ok:true});
 {const value=inherited(example),unused=copy(value.fragments[0]);unused.fragmentId='unused';value.fragments.push(unused);const f=fixture(api,value),before=api.expandSceneComposition(f.source.content),receipt=edit(api,f.source.content,{},['size','imageResourceId'],'leader','unused');
  same(api.expandSceneComposition(receipt.afterContent).scene,before.scene);same(receipt.changedPaths,['/fragments/1/actors/0/size','/fragments/1/actors/0/imageResourceId']);
  assert.throws(()=>edit(api,f.source.content,{},['position'],'leader','unused'));assert.throws(()=>edit(api,f.source.content,{},['size/0'],'leader','unused'));
  const newRequest={protocolVersion:1,operation:'sceneComposition.editFragmentActor',content:f.source.content,fragmentId:'party',actorKey:'leader',values:{speed:170},reset:['size']};
  for(const dispatch of[api.dispatchStudioCoreCompositionFragment,api.dispatchStudioCoreComposition,api.dispatchStudioCoreCompositionPatch,api.dispatchStudioCoreCompositionPositions])assert.throws(()=>dispatch(newRequest),e=>e?.errorCode==='studio_core_request_invalid');
  const draft=await open(api,f),old=draft.propose({speed:170});assert.equal(Object.hasOwn(old,'reset'),false);assert.equal(Object.hasOwn(old,'resetFields'),false);await prepare(api,f,old);
  assert.equal(api.supportsStudioCoreCompositionFragment(),true);assert.equal(api.getStudioCoreMetadata().ready,true);}
 checks.push({id:'unused-fragment-and-old-set-domain-shape-actually-preserved',ok:true,rejectedOperations:6});
 return checks;}
