// Synthetic valid effective previews isolate the new helper/core declaration contract.
// This proof does not resolve live World dependencies; actual dependency/Save
// acceptance belongs to the separate browser workflow.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const revision = text => `sha256:${sha(text)}`;
const serialize = value => '\uFEFF' + JSON.stringify(value,null,'\t').replaceAll('\n','\r\n') + '\r\n \t';
const parse = text => JSON.parse(text.replace(/^\uFEFF/,''));
const same = (a,b) => assert.deepEqual(copy(a),copy(b));
const noChange = error => error?.errorCode === 'scene_composition_override_unchanged';
function fixture(api, seed, dirty=false) {
  const content=typeof seed==='string'?seed:serialize(seed), value=parse(content), expanded=copy(api.expandSceneComposition(content));
  const sourceRevision=revision(content),sceneId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const source={sourcePath:'documents/shared-fragment-recipe.json',baseSourceRevision:dirty?revision('saved baseline'):sourceRevision,content};
  const actors=expanded.scene.actors.map(actor=>({size:[32,48],color:'#ffffff',speed:150,controls:'arrows',...actor,name:actor.instanceId}));
  const model={ok:true,format:'viento-scene-preview',schemaVersion:2,
    scene:{objectId:sceneId,sourcePath:source.sourcePath,sourceRevision,viewport:expanded.scene.viewport,background:expanded.scene.background},actors,
    composition:{format:'viento-scene-composition-preview',schemaVersion:1,recipeObjectId:sceneId,sourcePath:source.sourcePath,sourceRevision,
      fragmentCount:value.fragments.length,placementCount:value.placements.length},
    sourceLocations:{actors:expanded.sourceMap.actors.map((entry,index)=>({instanceId:entry.instanceId,objectId:actors[index].objectId,
      composition:{fragmentId:entry.fragmentId,placementId:entry.placementId,localKey:entry.localKey},
      declaration:{objectId:sceneId,sourcePath:source.sourcePath,sourceRevision}}))},sceneStructure:copy(api.createSceneStructure(expanded.scene)),
    ...(dirty?{draft:{baseSourceRevision:source.baseSourceRevision,sourceRevision}}:{})};
  return {source,model,ids:actors.map(actor=>actor.instanceId)};
}
const open=(api,f,index=0,digest=sha)=>api.createSceneCompositionFragmentDraft(f.model,f.source,f.ids[index],{digest});
const prepare=(api,f,p,digest=sha)=>api.prepareSceneCompositionFragmentApply(f.source,p,{digest});
const rawPatch=(api,content,values,actorKey='leader',fragmentId='party',extra={})=>api.dispatchStudioCoreCompositionFragment({protocolVersion:1,
  operation:'sceneComposition.patchFragmentActor',content,fragmentId,actorKey,values,...extra});
export async function runFragmentCases(api,example) {
  assert.equal(api.supportsStudioCoreCompositionFragment(),true);const checks=[];
  for (const dirty of [false,true]) {
    const value=copy(example),unused=copy(value.fragments[0]);unused.fragmentId='unused';value.fragments.push(unused);
    const f=fixture(api,value,dirty),before=copy(f),draft=await open(api,f,2);
    same(draft.values,value.fragments[0].actors[0] && Object.fromEntries(['position','size','color','speed','controls','imageResourceId'].map(field=>[field,value.fragments[0].actors[0][field]])));
    assert.notEqual(draft.values.color,f.model.actors[2].color);same(draft.values.position,[120,180]);
    const p=draft.propose({color:'#aabbcc'});same(p.changedPaths,['/fragments/0/actors/0/color']);
    assert.equal(p.afterContent,f.source.content.replace('"color": "#ffffff"','"color": "#aabbcc"'));
    same(await prepare(api,f,p),{afterContent:p.afterContent,changedPaths:p.changedPaths});
    same(parse(p.afterContent).placements,value.placements);same(parse(p.afterContent).fragments[1],unused);same(f,before);
    same(p.targets,[{instanceId:f.ids[0],placementId:value.placements[0].placementId,overrides:[]},
      {instanceId:f.ids[2],placementId:value.placements[1].placementId,overrides:['position','color','speed','controls']}]);
    assert.ok(p.afterContent.startsWith('\uFEFF')&&p.afterContent.endsWith('\r\n \t'));
  }
  checks.push({id:'raw-declaration-saved-dirty-and-exact-source',ok:true,sourceModes:2,unrelatedFragmentAndPlacementBytesPreserved:true});
  {
    const value=copy(example);value.fragments[0].actors[0]={key:'leader',objectId:value.fragments[0].actors[0].objectId,groupKey:'party',position:[120,180],useProjectionDefaults:true};
    const f=fixture(api,value),draft=await open(api,f,2);same(draft.values,{position:[120,180]});
    const p=draft.propose({speed:f.model.actors[2].speed,color:f.model.actors[2].color});
    same(p.values,{color:'#f1c46e',speed:0});same(p.changedPaths,['/fragments/0/actors/0/color','/fragments/0/actors/0/speed']);
    assert.equal(parse(p.afterContent).fragments[0].actors[0].size,undefined);same(parse(p.afterContent).placements,value.placements);
    await prepare(api,f,p);
  }
  checks.push({id:'missing-declaration-equal-selected-effective-is-a-source-change',ok:true});
  {
    const value=copy(example);value.fragments[0].actors[0].speed=100;
    for(const placement of value.placements) {placement.overrides ||= [];let entry=placement.overrides.find(entry=>entry.actorKey==='leader');
      if(!entry) {entry={actorKey:'leader',values:{}};placement.overrides.push(entry);}entry.values.speed=180;}
    const f=fixture(api,value),draft=await open(api,f),p=draft.propose({speed:120});
    same(api.expandSceneComposition(p.afterContent).scene.actors.map(actor=>actor.speed),api.expandSceneComposition(f.source.content).scene.actors.map(actor=>actor.speed));
    assert.notEqual(p.afterContent,f.source.content);assert.ok(p.targets.every(target=>target.overrides.includes('speed')));await prepare(api,f,p);
  }
  checks.push({id:'all-placement-masking-keeps-the-shared-source-edit',ok:true});
  {
    const value=copy(example);value.fragments[0].actors[0].useProjectionDefaults=true;
    const f=fixture(api,value),draft=await open(api,f),values={position:[130,190],size:[80,64],color:'#aBcDeF88',speed:0,controls:'none',imageResourceId:null};
    const p=draft.propose(values);same(p.values,values);same(p.changedPaths,['position','size','color','speed','controls','imageResourceId'].map(field=>`/fragments/0/actors/0/${field}`));
    same(parse(p.afterContent).placements,value.placements);await prepare(api,f,p);
    const plain=fixture(api,example),plainDraft=await open(api,plain);assert.throws(()=>plainDraft.propose({imageResourceId:null}),error=>error?.errorCode==='scene_composition_invalid');
    assert.equal(api.getStudioCoreMetadata().ready,true);
  }
  checks.push({id:'six-fields-null-inheritance-and-canonical-paths',ok:true,rejectedOperations:1});
  {
    const value=copy(example);for(const actor of value.fragments[0].actors)actor.position=[0,0];
    value.placements[1].offset=[99900,0];value.placements[1].overrides[0].values.position=[0,0];
    const f=fixture(api,value),blocked=await open(api,f,1),original=copy(blocked.values);
    assert.throws(()=>blocked.propose({position:[101,0],color:'#112233'}),error=>error?.errorCode==='scene_composition_invalid');same(blocked.values,original);
    const covered=await open(api,f,0),p=covered.propose({position:[101,0]});await prepare(api,f,p);
    same(api.expandSceneComposition(p.afterContent).scene.actors[2].position,[99900,0]);same(parse(p.afterContent).placements,value.placements);
    assert.equal(api.getStudioCoreMetadata().ready,true);
  }
  checks.push({id:'all-offset-world-bounds-atomic-and-local-mask-preserved',ok:true,rejectedOperations:1});
  {
    const f=fixture(api,example),raw=f.source.content.replace('"position": [\r\n\t\t\t\t\t\t120,','"posit\\u0069on": [\r\n\t\t\t\t\t\t1.200e2,');
    assert.notEqual(raw,f.source.content);const rf=fixture(api,raw),draft=await open(api,rf);
    assert.throws(()=>draft.propose({position:[120,180],speed:160}),noChange);
    same(rawPatch(api,raw,{position:[120,180],speed:160}),{afterContent:raw,changedPaths:[]});
    const p=draft.propose({position:[121,180]});assert.equal(p.afterContent,raw.replace('1.200e2','121'));await prepare(api,rf,p);
    const value=copy(example);value.fragments[0].actors[0].position=[9999,9999];value.fragments[0].actors[0].speed=1;
    const prefix=serialize(value),content=prefix+' '.repeat(131072-new TextEncoder().encode(prefix).length),bf=fixture(api,content),bd=await open(api,bf);
    assert.throws(()=>bd.propose({speed:1999}),error=>error?.errorCode==='scene_composition_limit');
    const combined=bd.propose({position:[1,1],speed:1999});assert.ok(new TextEncoder().encode(combined.afterContent).length<=131072);await prepare(api,bf,combined);
  }
  checks.push({id:'literal-number-keys-noop-and-final-source-budget',ok:true,rejectedOperations:1});
  {
    const f=fixture(api,example),draft=await open(api,f),p=draft.propose({speed:170,color:'#223344'});
    const alterations=[p=>p.values.speed++,p=>p.afterContent+=' ',p=>p.targets.reverse(),p=>p.targets.pop(),p=>p.targets[0].overrides.push('size'),
      p=>p.targets[0].instanceId=f.model.actors[0].objectId,p=>p.targets[1].placementId=p.targets[0].placementId,p=>p.changedPaths.reverse(),p=>p.fragmentId='unused',p=>p.actorKey='companion',p=>p.resetFields=[]];
    for(const alter of alterations){const wrong=copy(p);alter(wrong);await assert.rejects(prepare(api,f,wrong));}
    await assert.rejects(api.prepareSceneCompositionFragmentApply({...f.source,content:f.source.content+' '},p,{digest:sha}));
    const invalid=copy(f.model);invalid.sourceLocations.actors[3].composition.fragmentId='forged';await assert.rejects(api.createSceneCompositionFragmentDraft(invalid,f.source,f.ids[0],{digest:sha}));
    same(await prepare(api,f,p),{afterContent:p.afterContent,changedPaths:p.changedPaths});
  }
  checks.push({id:'all-targets-masks-proposals-source-and-provenance-recomputed',ok:true,rejectedOperations:13});
  {
    const f=fixture(api,example,true),before=copy(f);let resolve,captured;const gate=new Promise(done=>{resolve=done;});
    const pending=open(api,f,0,text=>{captured=text;return gate;});f.source.content='{}';f.source.baseSourceRevision=revision('wrong');
    f.model.actors[2].position[0]=999;f.model.sourceLocations.actors[2].composition.localKey='forged';resolve(sha(captured));
    const draft=await pending,p=draft.propose({speed:175});await prepare(api,before,p);
    const source=copy(before.source),proposal=copy(p);let finish,hashed;const wait=new Promise(done=>{finish=done;});
    const applying=api.prepareSceneCompositionFragmentApply(source,proposal,{digest:text=>{hashed=text;return wait;}});
    source.content='{}';proposal.values.speed=999;proposal.targets[0].overrides.push('size');proposal.afterContent='{}';finish(sha(hashed));
    same(await applying,{afterContent:p.afterContent,changedPaths:p.changedPaths});
    draft.values.position[0]=999;draft.targets[0].overrides.push('size');same(draft.propose({speed:175}),p);
  }
  checks.push({id:'factory-and-apply-snapshot-nested-inputs-before-digest',ok:true});
  {
    const value=copy(example),unused=copy(value.fragments[0]);unused.fragmentId='unused';value.fragments.push(unused);const f=fixture(api,value);
    const before=api.expandSceneComposition(f.source.content),receipt=rawPatch(api,f.source.content,{speed:170},'leader','unused');
    same(api.expandSceneComposition(receipt.afterContent).scene,before.scene);same(receipt.changedPaths,['/fragments/1/actors/0/speed']);
    assert.throws(()=>rawPatch(api,f.source.content,{size:[0,1]},'leader','unused'));assert.throws(()=>rawPatch(api,f.source.content,{speed:170},'leader','party',{resetFields:[]}));
    assert.throws(()=>rawPatch(api,f.source.content,{useProjectionDefaults:true}));assert.throws(()=>rawPatch(api,f.source.content,{objectId:f.ids[0]}));
    const request={protocolVersion:1,operation:'sceneComposition.patchFragmentActor',content:f.source.content,fragmentId:'party',actorKey:'leader',values:{speed:170}};
    for(const dispatch of [api.dispatchStudioCoreComposition,api.dispatchStudioCoreCompositionPatch,api.dispatchStudioCoreCompositionPositions])assert.throws(()=>dispatch(request),error=>error?.errorCode==='studio_core_request_invalid');
    assert.equal(api.supportsStudioCoreCompositionPatch(),true);assert.equal(api.supportsStudioCoreCompositionEdit(),true);assert.equal(api.supportsStudioCoreCompositionPositions(),true);assert.equal(api.getStudioCoreMetadata().ready,true);
  }
  checks.push({id:'unused-fragments-set-only-shape-and-old-domain-guards',ok:true,rejectedOperations:7});
  return checks;
}
