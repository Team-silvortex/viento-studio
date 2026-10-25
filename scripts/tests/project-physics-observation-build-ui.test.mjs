import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { validateProjectPhysics2DObservation } from '../../engine/project-physics2d-trace.mjs';
import { queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import { observationId as id, observationRevision as revision, physicsObservationSample as sample, physicsObservationSnapshot as snapshot, physicsObservationSource as source } from './helpers/project-physics2d-observation-fixture.mjs';
const assemblyId=id(1), first=id(2), second=id(3), backendId='org.viento.godot4', snapshotId='sha256:'+'b'.repeat(64);
function state() {
  return { supported:true, available:true, platform:'linux', backend:{ format:'viento-execution-backend',schemaVersion:1,id:backendId,version:'0.23.0',label:'Godot',platforms:['linux'],
    plans:[{kind:'project',schemaVersion:1,runtimeProtocolVersion:11},{kind:'scene2d',schemaVersion:1,runtimeProtocolVersion:1}],capabilities:['scene2d','physics.observe2d'],
    execution:{build:true,headlessLogic:true,windowPreview:true,windowCapture:true,offscreenRender:false,embeddedViewport:false,gpuCompute:false},extensions:[]},
    scenes:[{id:assemblyId,kind:'project',title:'Project',sourcePath:'documents/game.json',entrySceneId:first,sceneCount:2}],
    latestBuild:{id:'build-1',backendId,sceneId:assemblyId,targetKind:'project',targetId:assemblyId,snapshotId,entrySceneId:first,sceneCount:2,
      scenes:[first,second].map((sceneId,index)=>({sceneId,title:`Scene ${index}`,sourcePath:`documents/scenes/${index}.json`,sourceRevision:revision,planSchemaVersion:1,runtimeProtocolVersion:1}))},
    job:{id:'run-1',kind:'run',status:'succeeded',phase:'completed',backendId,sceneId:assemblyId,targetKind:'project',targetId:assemblyId,buildId:'build-1',snapshotId,diagnostics:[],events:[],logs:'',runtime:null,physics:snapshot()},
  };
}
async function fixture(initial=state(),options={}) {
  let payload=initial;const calls=[],opened=[],context={editable:true,dirty:false,creating:false,busy:false,path:'documents/game.json'};
  const h=await dialogHarness('app-project-build',{PROJECT_BUILD_API_PATH:'/api/project-build',queryProjectRuntimeObservation,querySceneRuntimeObservation,validateProjectPhysics2DObservation,
    fetchJsonApiRequest:async(url,request)=>{calls.push(request.body?JSON.parse(request.body):null);return {payload};}});
  const module=(await fs.readFile(new URL('../../web/modules/app-project-physics-observation.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'').replaceAll('export ','');vm.runInContext(module,h.runtime);
  const controller=h.runtime.setupProjectBuild({getContext:()=>context,openSource:(...args)=>{opened.push(args);return options.openSource?options.openSource(...args):true;}});
  controller.setAvailable(true);h.element('projectBuildBtn').click();await flushDialogs();
  return {...h,controller,context,calls,opened,el:suffix=>h.element('projectPhysicsObservation'+suffix),async refresh(next){payload=next;h.element('projectBuildRefresh').click();await flushDialogs();}};
}

test('owned physics samples render independently of missing legacy runtime snapshots and never write commands',async()=>{
  const h=await fixture();assert.equal(h.el('Panel').hidden,false);assert.match(h.el('Motion').textContent,/实际位移\[2, 4\]/);assert.equal(h.element('projectBuildRuntimeObjects').hidden,true);assert.ok(h.calls.every(call=>call===null));
  const next=state();next.job.physics.phase='incomplete';next.job.status='cancelled';await h.refresh(next);assert.equal(h.el('Panel').hidden,false);assert.match(h.el('Status').textContent,/记录未完成/);
});

test('old nonphysical and ordinary window jobs with no physics field leave the new panel absent',async()=>{
  for(const mode of ['absent','null','unsupported','not-run']){
    const value=state();if(mode==='absent')delete value.job.physics;else if(mode==='null')value.job.physics=null;else if(mode==='unsupported')value.backend.capabilities=['scene2d'];else value.job.kind='build';
    const h=await fixture(value);assert.equal(h.el('Panel').hidden,true,mode);
  }
});

test('wrong task build backend snapshot assembly and frozen-member ownership reject observations',async()=>{
  for(const mutate of [s=>s.job.sceneId=second,s=>s.job.buildId='build-2',s=>s.job.backendId='other',s=>s.job.snapshotId='sha256:'+'c'.repeat(64),s=>s.job.targetKind='scene2d',s=>s.latestBuild.targetKind='scene2d',s=>s.job.physics.assemblyId=id(99),s=>s.job.physics.samples[0].sceneId=id(98),s=>s.latestBuild.sceneCount=3,s=>s.latestBuild.scenes[0].sourcePath='../escape.json']){
    const value=state();mutate(value);const h=await fixture(value);assert.equal(h.el('Panel').hidden,true);
  }
});

test('character and collider source navigation carries exact separate source paths and range with own-loading',async()=>{
  for(const kind of ['character','collider']){
    const gate=deferred(),writes=[];let h;h=await fixture(state(),{openSource:async(path,location,context)=>{h.context.busy=true;h.controller.setAvailable(true);try{await gate.promise;if(!context.isCurrent())return false;writes.push(path);return true;}finally{h.context.busy=false;}}});
    (kind==='character'?h.el('Open'):h.el('Contacts').querySelector('.project-physics-collider-source')).click();await flushDialogs();const expected=source(kind==='character'?0:2);
    assert.equal(h.opened.length,1);assert.equal(h.opened[0][0],expected.sourcePath);assert.deepEqual(JSON.parse(JSON.stringify(h.opened[0][1])),expected);assert.equal(h.opened[0][2].isCurrent(),true);
    const next=state();next.job.physics.samples.push(sample(2,{step:2}));await h.refresh(next);assert.equal(h.opened[0][2].isCurrent(),true);gate.resolve();await flushDialogs();await flushDialogs();assert.deepEqual(writes,[expected.sourcePath]);assert.equal(h.element('projectBuildDialog').open,false);
  }
});

test('busy, dirty and creating drafts block initial physics-source navigation without hiding observations',async()=>{
  const h=await fixture();for(const flag of ['busy','dirty','creating']){h.context[flag]=true;h.controller.setAvailable(true);h.el('Open').dispatch('click');await flushDialogs();assert.equal(h.opened.length,0,flag);assert.equal(h.el('Panel').hidden,false);h.context[flag]=false;}
});

test('late dirty creation task build close and lost observation revoke asynchronous source reads',async()=>{
  for(const change of ['dirty','creating','task','build','close','observation']){
    const gate=deferred(),writes=[];let h;h=await fixture(state(),{openSource:async(path,location,context)=>{h.context.busy=true;try{await gate.promise;if(!context.isCurrent())return false;writes.push(path);return true;}finally{h.context.busy=false;}}});
    h.el('Open').click();await flushDialogs();if(change==='dirty'||change==='creating')h.context[change]=true;else if(change==='close'){h.element('projectBuildClose').click();await flushDialogs();}else{const next=state();if(change==='task')next.job.id='run-2';else if(change==='build'){next.latestBuild.id='build-2';next.job.buildId='build-2';}else next.job.physics=null;await h.refresh(next);}
    assert.equal(h.opened[0][2].isCurrent(),false,change);gate.resolve();await flushDialogs();assert.deepEqual(writes,[],change);
  }
});

test('same-job polling preserves historical sample selection while a new run resets it',async()=>{
  const value=state();value.job.physics.samples.push(sample(2,{step:2}));const h=await fixture(value);h.el('Sample').value='2';h.el('Sample').dispatch('change');
  await h.refresh(structuredClone(value));assert.equal(h.el('Sample').value,'2');const next=structuredClone(value);next.job.id='run-2';await h.refresh(next);assert.equal(h.el('Sample').value,'1');assert.ok(h.calls.every(call=>call===null));
});

test('returning to an earlier backend identity cannot revive invalidated run observations',async()=>{
  const h=await fixture();const other=state();other.backend.version='0.24.0';await h.refresh(other);await h.refresh(state());assert.equal(h.el('Panel').hidden,true);
});
