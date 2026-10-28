import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { validateProjectEventPositions } from '../../engine/project-event-positions-query.mjs';
import { createProjectEventPositionsReader } from '../../engine/project-event-positions.mjs';
import { createProjectExecutionFramesReader, PROJECT_EXECUTION_FRAME_PREFIX } from '../../engine/project-execution-frames.mjs';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { eventProject, eventReturnTrip } from './helpers/project-event-bus-fixture.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { observationId as id, observationRevision as revision } from './helpers/project-physics2d-observation-fixture.mjs';

const assemblyId=id(1), first=id(2), second=id(3), backendId='org.viento.godot4', snapshotId='sha256:'+'b'.repeat(64);
function state() {
  return { supported:true, available:true, platform:'linux', backend:{ format:'viento-execution-backend',schemaVersion:1,id:backendId,version:'0.36.0',label:'Godot',platforms:['linux'],
    plans:[{kind:'project',schemaVersion:1,runtimeProtocolVersion:11},{kind:'scene2d',schemaVersion:1,runtimeProtocolVersion:1}],
    capabilities:['scene2d','project.events','runtime.execution-frames'],
    execution:{build:true,headlessLogic:true,windowPreview:true,windowCapture:true,offscreenRender:false,embeddedViewport:false,gpuCompute:false},extensions:[]},
    scenes:[{id:assemblyId,kind:'project',title:'Project',sourcePath:'documents/game.json',entrySceneId:first,sceneCount:2}],
    latestBuild:{id:'build-1',backendId,sceneId:assemblyId,targetKind:'project',targetId:assemblyId,snapshotId,entrySceneId:first,sceneCount:2,
      scenes:[first,second].map((sceneId,index)=>({sceneId,title:`Scene ${index}`,sourcePath:`documents/scenes/${index}.json`,sourceRevision:revision,planSchemaVersion:1,runtimeProtocolVersion:1}))},
    job:{id:'run-1',kind:'run',status:'succeeded',phase:'completed',backendId,sceneId:assemblyId,targetKind:'project',targetId:assemblyId,buildId:'build-1',snapshotId,diagnostics:[],events:[],logs:'',runtime:null,
      eventPositions:{items:[{sequence:1,origin:{sceneId:first},deliveries:[{origin:{sceneId:first}}]}]}},
  };
}
async function fixture(initial=state()) {
  let payload=initial, ports, current=null;const calls=[], delivered=[];
  const context={editable:true,dirty:false,creating:false,busy:false,path:'documents/game.json'};
  const h=await dialogHarness('app-project-build',{PROJECT_BUILD_API_PATH:'/api/project-build',
    validateProjectEventPositions:value=>{if(value.invalid)throw Error('bad snapshot');return structuredClone(value);},
    setupProjectEventPositionsObservation:input=>{ports=input;return {setSnapshot(value){current=value;delivered.push(value);},refresh(){}};},
    fetchJsonApiRequest:async(url,request)=>{calls.push(request.body?JSON.parse(request.body):null);return {payload};}});
  const controller=h.runtime.setupProjectBuild({getContext:()=>context});controller.setAvailable(true);h.element('projectBuildBtn').click();await flushDialogs();
  return {...h,controller,context,calls,delivered,get snapshot(){return current;},get ports(){return ports;},async refresh(next){payload=next;h.element('projectBuildRefresh').click();await flushDialogs();}};
}
const json = value => JSON.parse(JSON.stringify(value));

test('owned positions reach an independent panel even when legacy runtime is absent, including cancelled partial runs',async()=>{
  const h=await fixture();assert.deepEqual(json(h.snapshot),state().job.eventPositions);assert.equal(h.ports.getContext().available,true);assert.equal(h.ports.getContext().visible,true);
  assert.equal(h.element('projectBuildRuntimeObjects').hidden,true);assert.ok(h.calls.every(call=>call===null));
  const next=state();next.job.status='cancelled';next.job.eventPositions.phase='incomplete';await h.refresh(next);
  assert.equal(h.snapshot.phase,'incomplete');assert.equal(h.ports.getContext().available,true);
});

test('unavailable capabilities, old data and other job types do not activate positions',async()=>{
  for(const mode of ['absent','null','invalid','event-capability','frame-capability','not-run','bevy']){
    const value=state();if(mode==='absent')delete value.job.eventPositions;else if(mode==='null')value.job.eventPositions=null;
    else if(mode==='invalid')value.job.eventPositions.invalid=true;else if(mode==='event-capability')value.backend.capabilities=['runtime.execution-frames'];
    else if(mode==='frame-capability')value.backend.capabilities=['project.events'];else if(mode==='not-run')value.job.kind='build';
    else {value.backend.id='org.viento.bevy';value.latestBuild.backendId=value.backend.id;value.job.backendId=value.backend.id;value.backend.capabilities=['scene2d'];}
    const h=await fixture(value);assert.equal(h.snapshot,null,mode);assert.equal(h.ports.getContext().available,false,mode);
  }
});

test('wrong job, target, backend, snapshot and scene membership cannot inherit event positions',async()=>{
  for(const mutate of [s=>s.job.id='',s=>s.job.sceneId=second,s=>s.job.targetId=second,s=>s.latestBuild.targetId=second,
    s=>s.job.buildId='build-2',s=>s.job.backendId='other',s=>s.latestBuild.backendId='other',s=>s.job.snapshotId='sha256:'+'c'.repeat(64),
    s=>s.job.snapshotId='bad',s=>s.job.targetKind='scene2d',s=>s.latestBuild.targetKind='scene2d',s=>s.job.eventPositions.items[0].origin.sceneId=id(99),
    s=>s.job.eventPositions.items[0].deliveries[0].origin.sceneId=id(99),s=>s.latestBuild.sceneCount=3,s=>s.latestBuild.scenes[0].sourcePath='../escape.json']){
    const value=state();mutate(value);const h=await fixture(value);assert.equal(h.snapshot,null);
  }
});

test('changing run, switching target and closing dialog invalidate position ownership',async()=>{
  const h=await fixture(), previous=h.ports.getContext();const next=state();next.job.id='run-2';await h.refresh(next);
  const current=h.ports.getContext();assert.notEqual(current.sessionOwner,previous.sessionOwner);assert.notEqual(current.navigationOwner,previous.navigationOwner);
  const replacement=state();replacement.job.id='run-3';delete replacement.job.eventPositions;await h.refresh(replacement);assert.equal(h.snapshot,null);assert.equal(h.ports.getContext().available,false);
  await h.refresh(next);h.element('projectBuildClose').click();await flushDialogs();assert.equal(h.ports.getContext().visible,false);
});

test('returning to a previously invalidated backend does not revive its old job',async()=>{
  const h=await fixture();const other=state();other.backend.version='0.37.0';await h.refresh(other);await h.refresh(state());
  assert.equal(h.snapshot,null);assert.equal(h.ports.getContext().available,false);
});

test('real reader, validator and panel join a frozen run without a runtime snapshot',async()=>{
  const plan=eventProject(), base=createProjectRuntimeEventReader(plan,{protocolVersion:3});
  const reader=createProjectEventPositionsReader({runtimeReader:createProjectExecutionFramesReader({runtimeReader:base})});
  for(const [index,frame] of eventReturnTrip(plan).entries()) reader.push(PROJECT_EXECUTION_FRAME_PREFIX+JSON.stringify({protocol:1,index:index+1,clock:{idleFrame:index,physicsFrame:index},frame})+'\n');
  reader.finish();assert.equal(reader.eventPositions.phase,'finished');
  const value=state(), sceneIds=plan.scenes.map(scene=>scene.scene.objectId);
  value.latestBuild.entrySceneId=sceneIds[0];value.latestBuild.scenes=value.latestBuild.scenes.map((scene,index)=>({...scene,sceneId:sceneIds[index]}));
  value.job.eventPositions=reader.eventPositions;
  let payload=value;
  const h=await dialogHarness('app-project-build',{PROJECT_BUILD_API_PATH:'/api/project-build',validateProjectEventPositions,
    fetchJsonApiRequest:async()=>({payload})});
  const module=(await fs.readFile(new URL('../../web/modules/app-project-event-positions-observation.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'').replaceAll('export ','');
  vm.runInContext(module,h.runtime);
  const controller=h.runtime.setupProjectBuild({getContext:()=>({editable:true,dirty:false,creating:false,busy:false,path:'documents/game.json'})});
  controller.setAvailable(true);h.element('projectBuildBtn').click();await flushDialogs();
  assert.equal(h.element('projectEventPositionsPanel').hidden,false);assert.equal(h.element('projectBuildRuntimeObjects').hidden,true);
  assert.equal(h.element('projectEventPositionsEntries').children.length,4);assert.match(h.element('projectEventPositionsEntries').textContent,/door.open/);
  assert.equal(h.element('projectEventPositionsPhase').dataset.phase,'finished');
  payload=structuredClone(value);payload.job.eventPositions.items[0].published.clock.idleFrame=-1;
  h.element('projectBuildRefresh').click();await flushDialogs();assert.equal(h.element('projectEventPositionsPanel').hidden,true);
});
