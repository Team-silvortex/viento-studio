import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { observationId as id, physicsObservationSample as sample, observationRevision as revision } from './helpers/project-physics2d-observation-fixture.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const assemblyId=id(1), sceneId=id(2), actor=id(20), body=id(40), backendId='org.viento.godot4', snapshotId=`sha256:${'b'.repeat(64)}`;
function state() { return {supported:true,available:true,platform:'linux',backend:{format:'viento-execution-backend',schemaVersion:1,id:backendId,version:'0.37.0',label:'Godot',platforms:['linux'],plans:[{kind:'project',schemaVersion:1,runtimeProtocolVersion:11},{kind:'scene2d',schemaVersion:1,runtimeProtocolVersion:1}],capabilities:['scene2d','physics.observe2d'],execution:{build:true,headlessLogic:true,windowPreview:true,windowCapture:false,offscreenRender:false,embeddedViewport:false,gpuCompute:false},extensions:[]},scenes:[{id:assemblyId,kind:'project',title:'Project',sourcePath:'documents/project.json'}],latestBuild:{id:'build-1',backendId,sceneId:assemblyId,targetId:assemblyId,targetKind:'project',sceneCount:1,entrySceneId:sceneId,physicsReplayAvailable:true,snapshotId,scenes:[{sceneId,title:'Entry',sourcePath:'documents/scene.json',sourceRevision:revision,planSchemaVersion:1,runtimeProtocolVersion:1}]},job:null}; }
function observation() { return {format:'viento-physics2d-observation',schemaVersion:1,assemblyId,phase:'finished',limit:256,limited:false,samples:Array.from({length:30},(_,i)=>({...sample(i+1,{step:i+1}),timeSeconds:(i+1)/60,deltaSeconds:1/60}))}; }
async function harness({ observer = false } = {}) {
  let payload=state(),dictionary={};
  const calls=[],opened=[],langs=[],context={editable:true,dirty:false,creating:false,busy:false,path:'documents/project.json',sceneDraftToken:'author:1'};
  const t=(key,...values)=>(dictionary[key]||key).replace(/\{(\d+)\}/g,(_,i)=>values[i]??'');
  const h=await dialogHarness('app-project-build',{PROJECT_BUILD_API_PATH:'/api/project-build',t,onLanguageChange:cb=>langs.push(cb),translatePage:root=>{for(const n of root.querySelectorAll('[data-i18n]'))n.textContent=t(n.dataset.i18n);},fetchJsonApiRequest:async(url,request)=>{calls.push(request.body?JSON.parse(request.body):null);return {payload};}});
  if (observer) {
    const module=(await fs.readFile(new URL('../../web/modules/app-project-physics-observation.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'').replaceAll('export ','');
    vm.runInContext(module,h.runtime);
  }
  const controller=h.runtime.setupProjectBuild({getContext:()=>context,openSource:(...args)=>{opened.push(args);return false;}});
  controller.setAvailable(true);h.element('projectBuildBtn').click();await flushDialogs();
  return {...h,context,calls,opened,controller,language(d){dictionary=d;langs.forEach(f=>f());},async refresh(s){payload=s;h.element('projectBuildRefresh').click();await flushDialogs();},input(id,text){const e=h.element(id);e.value=text;e.dispatch('input');return e;}};
}
const read=h=>JSON.parse(h.element('projectBuildPhysicsCaseProgram').value);
function job(program) { return {id:'run-1',kind:'run',status:'succeeded',phase:'completed',backendId,sceneId:assemblyId,targetId:assemblyId,targetKind:'project',buildId:'build-1',snapshotId,diagnostics:[],events:[],logs:'',physicsControl:{program,complete:true,sha256:`sha256:${'a'.repeat(64)}`},physics:observation()}; }
test('acceptance form builds an independent case and validates checks before submission',async()=>{const h=await harness();h.element('projectBuildPhysicsCaseInput').click();h.element('projectBuildPhysicsCaseInstance').value=actor;h.element('projectBuildPhysicsCaseStep').value='7';h.element('projectBuildPhysicsCasePosition').checked=true;h.element('projectBuildPhysicsCaseX').value='12';h.element('projectBuildPhysicsCaseY').value='24';h.element('projectBuildPhysicsCaseContact').value='yes';h.element('projectBuildPhysicsCaseBody').value=body;h.element('projectBuildPhysicsCaseAdd').click();const c=read(h);assert.deepEqual(c.checks,[{instanceId:actor,stepIndex:7,positionAfter:{value:[12,24],tolerance:[0.01,0.01]},contact:{exists:true,bodyId:body}}]);h.element('projectBuildPhysicsCaseRun').click();await flushDialogs();assert.deepEqual(h.calls.at(-1),{action:'run',buildId:'build-1',mode:'headless',physicsReplayCase:c});const count=h.calls.length;h.element('projectBuildPhysicsCaseToleranceX').value='-1';h.element('projectBuildPhysicsCaseAdd').click();assert.deepEqual(read(h),c);assert.equal(h.element('projectBuildPhysicsCaseError').hidden,false);h.input('projectBuildPhysicsCaseProgram','{bad');h.element('projectBuildPhysicsCaseRun').click();await flushDialogs();assert.equal(h.calls.length,count);});
test('sample generation requires a complete owned matching input and never overwrites a rejected draft',async()=>{const h=await harness(),program=JSON.parse(h.element('projectBuildPhysicsReplayProgram').value),s=state();s.job=job(program);await h.refresh(s);assert.equal(h.element('projectBuildPhysicsCaseSample').disabled,false);h.element('projectBuildPhysicsCaseSample').click();assert.deepEqual(read(h).checks,[{instanceId:actor,stepIndex:30,positionAfter:{value:[12,24],tolerance:[0.01,0.01]}}]);h.input('projectBuildPhysicsCaseProgram','unfinished');let confirmations=0;h.runtime.window.confirm=()=>{confirmations++;return true;};h.element('projectBuildPhysicsCaseSample').click();assert.equal(confirmations,1);h.input('projectBuildPhysicsCaseProgram','unfinished');h.runtime.window.confirm=()=>false;h.element('projectBuildPhysicsCaseSample').click();assert.equal(h.element('projectBuildPhysicsCaseProgram').value,'unfinished');for(const mutate of [j=>j.physicsControl.complete=false,j=>j.status='cancelled',j=>j.snapshotId=`sha256:${'c'.repeat(64)}`,j=>j.physics.assemblyId=id(9),j=>j.physics.phase='incomplete']){const x=state();x.job=job(program);mutate(x.job);await h.refresh(x);assert.equal(h.element('projectBuildPhysicsCaseSample').disabled,true);} });
test('results distinguish acceptance from execution and reject forged, stale or edited evidence',async()=>{const h=await harness(),program=JSON.parse(h.element('projectBuildPhysicsReplayProgram').value),s=state();s.job=job(program);await h.refresh(s);h.element('projectBuildPhysicsCaseSample').click();const definition=read(h),check={instanceId:actor,stepIndex:30,passed:true,positionAfter:{expected:[12,24],tolerance:[0.01,0.01],actual:[12,24],passed:true}};s.job.physicsVerification={definition,sha256:`sha256:${'c'.repeat(64)}`,evaluation:{status:'passed',checks:[check]}};await h.refresh(s);assert.equal(h.element('projectBuildPhysicsCaseResult').hidden,false);assert.match(h.element('projectBuildPhysicsCaseSummary').textContent,/通过/);const bad=structuredClone(s);bad.job.physicsVerification.evaluation.checks[0].positionAfter.actual=[50,24];await h.refresh(bad);assert.equal(h.element('projectBuildPhysicsCaseResult').hidden,true);const mismatch=structuredClone(s);mismatch.job.physicsControl.program.steps[0].left=true;await h.refresh(mismatch);assert.equal(h.element('projectBuildPhysicsCaseResult').hidden,true);const cancelled=structuredClone(s);cancelled.job.status='cancelled';cancelled.job.physicsControl.complete=false;cancelled.job.physicsVerification.evaluation={status:'incomplete',checks:[]};await h.refresh(cancelled);assert.equal(h.element('projectBuildPhysicsCaseResult').hidden,false);assert.match(h.element('projectBuildPhysicsCaseSummary').textContent,/未完成/);await h.refresh(s);h.input('projectBuildPhysicsCaseProgram','{unfinished');assert.equal(h.element('projectBuildPhysicsCaseResult').hidden,true);});
test('acceptance and replay input are copied only by explicit action and respect draft confirmation',async()=>{const h=await harness();h.element('projectBuildPhysicsCaseInput').click();h.element('projectBuildPhysicsCaseInstance').value=actor;h.element('projectBuildPhysicsCasePosition').checked=true;h.element('projectBuildPhysicsCaseAdd').click();const before=h.element('projectBuildPhysicsReplayProgram').value;const c=read(h);c.program.steps[0].left=true;h.input('projectBuildPhysicsCaseProgram',JSON.stringify(c));h.element('projectBuildPhysicsCaseRun').click();await flushDialogs();assert.equal(h.element('projectBuildPhysicsReplayProgram').value,before);assert.equal(h.element('projectBuildPhysicsCaseError').hidden,false);h.runtime.window.confirm=()=>false;const dirty=JSON.stringify(JSON.parse(before));h.input('projectBuildPhysicsReplayProgram',dirty);h.element('projectBuildPhysicsCaseUseInput').click();assert.equal(h.element('projectBuildPhysicsReplayProgram').value,dirty);h.runtime.window.confirm=()=>true;h.element('projectBuildPhysicsCaseUseInput').click();assert.equal(JSON.parse(h.element('projectBuildPhysicsReplayProgram').value).steps[0].left,true);});
test('visible acceptance controls and statuses translate in English and Japanese',async()=>{const h=await harness();for(const d of [en,ja]){h.language(d);for(const key of ['运行物理验收','编辑物理验收','将当前输入复制到验收','将验收输入载入回放','从完整物理回放生成预期','检查位置','扫掠碰撞','物理验收通过','物理验收未通过','物理验收未完成'])assert.ok(d[key],key);assert.equal(h.element('projectBuildPhysicsCaseRun').textContent,d['运行物理验收']);}});

const selectionButtons = h => h.element('projectBuildPhysicsCaseChecks').querySelectorAll('.build-physics-case-sample');
const physicsSelection = h => ['Instance','Step','Sample'].map(key => h.element('projectPhysicsObservation'+key).value);
async function verifiedCase(h) {
  const program=JSON.parse(h.element('projectBuildPhysicsReplayProgram').value), value=state();
  const definition={format:'viento-physics2d-replay-case',schemaVersion:1,program,checks:[
    {instanceId:actor,stepIndex:7,positionAfter:{value:[12,24],tolerance:[0,0]}},
    {instanceId:actor,stepIndex:21,positionAfter:{value:[13,24],tolerance:[0,0]}}]};
  h.input('projectBuildPhysicsCaseProgram',JSON.stringify(definition));
  value.job=job(program);value.job.physicsVerification={definition,sha256:`sha256:${'c'.repeat(64)}`,evaluation:{status:'failed',checks:[
    {instanceId:actor,stepIndex:7,passed:true,positionAfter:{expected:[12,24],tolerance:[0,0],actual:[12,24],passed:true}},
    {instanceId:actor,stepIndex:21,passed:false,positionAfter:{expected:[13,24],tolerance:[0,0],actual:[12,24],passed:false}}]}};
  await h.refresh(value);return value;
}

test('verified passing and failing checks select their exact native sample without commands, source opens or draft changes',async()=>{
  const h=await harness({observer:true});await verifiedCase(h);
  const buttons=selectionButtons(h),before=[h.element('projectBuildPhysicsCaseProgram').value,h.element('projectBuildPhysicsReplayProgram').value],requests=h.calls.length;
  assert.equal(buttons.length,2);assert.equal(buttons[0].parentElement.dataset.passed,'true');assert.equal(buttons[1].parentElement.dataset.passed,'false');
  buttons[1].click();assert.deepEqual(physicsSelection(h),[actor,`1:${sceneId}:21`,'21']);
  assert.equal(h.element('projectPhysicsObservationDetail').dataset.sequence,'21');assert.equal(h.document.activeElement,h.element('projectPhysicsObservationSample'));
  buttons[0].click();assert.deepEqual(physicsSelection(h),[actor,`1:${sceneId}:7`,'7']);
  assert.deepEqual([h.element('projectBuildPhysicsCaseProgram').value,h.element('projectBuildPhysicsReplayProgram').value],before);
  assert.equal(h.calls.length,requests);assert.equal(h.opened.length,0);assert.equal(h.element('projectBuildDialog').open,true);
  h.element('projectPhysicsObservationOpen').click();await flushDialogs();assert.equal(h.opened.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.opened[0][1])),observation().samples[6].source);
});

test('identical polling and language changes retain result buttons, focus and valid selection tickets',async()=>{
  const h=await harness({observer:true}),value=await verifiedCase(h),button=selectionButtons(h)[1];button.focus();
  await h.refresh(structuredClone(value));assert.equal(selectionButtons(h)[1],button);assert.equal(h.document.activeElement,button);
  for(const dictionary of [en,ja]){h.language(dictionary);assert.equal(selectionButtons(h)[1],button);assert.equal(h.document.activeElement,button);assert.equal(button.textContent,dictionary['查看本步物理样本']);}
  const requests=h.calls.length;button.click();assert.equal(h.element('projectPhysicsObservationSample').value,'21');assert.equal(h.calls.length,requests);
});

test('edited case or replay bytes and their undo revoke old buttons without replacing the previous observation selection',async()=>{
  for(const editor of ['projectBuildPhysicsCaseProgram','projectBuildPhysicsReplayProgram']){
    const h=await harness({observer:true});await verifiedCase(h);let buttons=selectionButtons(h);buttons[1].click();const previous=physicsSelection(h),old=buttons[0],text=h.element(editor).value;
    h.input(editor,text+' ');assert.notEqual(selectionButtons(h)[0],old);old.dispatch('click');assert.deepEqual(physicsSelection(h),previous);
    h.input(editor,text);assert.notEqual(selectionButtons(h)[0],old);old.dispatch('click');assert.deepEqual(physicsSelection(h),previous);
    selectionButtons(h)[0].click();assert.equal(h.element('projectPhysicsObservationSample').value,'7');
  }
});

test('old task build snapshot context and detached button identities never revive after an ABA return',async()=>{
  for(const change of ['job','build','snapshot','dirty','creating','busy','path','token','close']){
    const h=await harness({observer:true}),value=await verifiedCase(h),old=selectionButtons(h)[0];selectionButtons(h)[1].click();
    if(['dirty','creating','busy'].includes(change)){h.context[change]=true;h.controller.setAvailable(true);h.context[change]=false;h.controller.setAvailable(true);}
    else if(change==='path'||change==='token'){const key=change==='path'?'path':'sceneDraftToken',saved=h.context[key];h.context[key]='changed';h.controller.setAvailable(true);h.context[key]=saved;h.controller.setAvailable(true);}
    else if(change==='close'){h.element('projectBuildClose').click();await flushDialogs();h.element('projectBuildBtn').click();await flushDialogs();}
    else{const next=structuredClone(value);if(change==='job')next.job.id='run-2';if(change==='build'){next.latestBuild.id='build-2';next.job.buildId='build-2';}if(change==='snapshot'){next.latestBuild.snapshotId=`sha256:${'d'.repeat(64)}`;next.job.snapshotId=next.latestBuild.snapshotId;}await h.refresh(next);await h.refresh(value);}
    const before=physicsSelection(h),requests=h.calls.length;old.dispatch('click');assert.deepEqual(physicsSelection(h),before,change);assert.equal(h.calls.length,requests,change);assert.equal(h.opened.length,0,change);
    const current=selectionButtons(h)[0];assert.ok(current);assert.notEqual(current,old);current.click();assert.equal(h.element('projectPhysicsObservationSample').value,'7',change);
  }
});

test('changed native sample payload or source invalidates an unrefreshed old button without selecting another row',async()=>{
  for(const change of ['payload','source']){
    const h=await harness({observer:true}),value=await verifiedCase(h),old=selectionButtons(h)[0];selectionButtons(h)[1].click();const before=physicsSelection(h);
    const row=value.job.physics.samples[6];if(change==='payload')row.requestedMotion[0]+=1;else row.source.sourceRevision=`sha256:${'d'.repeat(64)}`;
    old.dispatch('click');assert.deepEqual(physicsSelection(h),before);assert.equal(h.element('projectBuildPhysicsCaseSelectionStatus').hidden,false);assert.match(h.element('projectBuildPhysicsCaseSelectionStatus').textContent,/已变化/);
    await h.refresh(value);const current=selectionButtons(h)[0];assert.ok(current);assert.notEqual(current,old);current.click();assert.equal(h.element('projectPhysicsObservationSample').value,'7');assert.equal(h.opened.length,0);
  }
});

test('incomplete missing or ambiguous native evidence never offers a selection button or a false acceptance conclusion',async()=>{
  for(const change of ['incomplete','missing','ambiguous','bad-source-members']){
    const h=await harness({observer:true}),value=await verifiedCase(h);
    if(change==='incomplete'){value.job.status='cancelled';value.job.physicsControl.complete=false;value.job.physicsVerification.evaluation={status:'incomplete',checks:[]};}
    else if(change==='missing')value.job.physics.samples[6].stepIndex=8;
    else if(change==='ambiguous')value.job.physics.samples.push({...structuredClone(value.job.physics.samples[6]),sequence:31});
    else value.latestBuild.scenes[0].sourcePath='../not-owned.json';
    await h.refresh(value);assert.equal(selectionButtons(h).length,0,change);assert.equal(h.element('projectBuildPhysicsCaseSelectionStatus').hidden,false,change);assert.match(h.element('projectBuildPhysicsCaseSelectionStatus').textContent,/不可定位/,change);
    if(change==='missing'||change==='ambiguous')assert.equal(h.element('projectBuildPhysicsCaseResult').hidden,true,change);
  }
});


test('even unchanged-byte input dispatch revokes old acceptance selection tickets',async()=>{
  for(const editor of ['projectBuildPhysicsCaseProgram','projectBuildPhysicsReplayProgram']){
    const h=await harness({observer:true});await verifiedCase(h);const old=selectionButtons(h)[0];selectionButtons(h)[1].click();const before=physicsSelection(h);
    h.element(editor).dispatch('input');assert.notEqual(selectionButtons(h)[0],old);old.dispatch('click');assert.deepEqual(physicsSelection(h),before);
    selectionButtons(h)[0].click();assert.equal(h.element('projectPhysicsObservationSample').value,'7');
  }
});
