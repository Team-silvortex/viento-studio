// Real Chrome → HTTP workbench → frozen Godot build → native physics observation.
// Writes disposable author workspaces and a fresh evidence directory only.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { scenePhysics2DCharacterMotionAuthor } from './helpers/scene-physics2d-character-motion-author-fixture.mjs';
import { validateProjectPhysics2DObservation } from '../../engine/project-physics2d-trace.mjs';
import '../adapters/node-studio-core.mjs';
const appRoot=fileURLToPath(new URL('../../',import.meta.url)),tool=process.env.VIENTO_GODOT_BIN;
if(!tool||!path.isAbsolute(tool))throw Error('Set VIENTO_GODOT_BIN to an absolute executable.');
const evidenceRoot=path.join(appRoot,'docs/test-results/physics-case-inspection');
const output=path.resolve(process.env.VIENTO_PHYSICS_CASE_INSPECTION_OUTPUT||path.join(evidenceRoot,`browser-${Date.now()}`));
if(!output.startsWith(evidenceRoot+path.sep))throw Error('Use a fresh directory inside the physics-observation evidence topic.');
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Use a new empty evidence directory.');
const report={startedAt:new Date().toISOString(),steps:[],screenshots:[],jobs:[],errors:[],dialogs:[],layout:{},limitations:[
  'Real isolated Chrome/HTTP editor and native headless Godot; installed Tauri, Android and Bevy were not tested.',
  'Only finite character sweeps are observed; source edits remain an unsaved disposable draft.'
]};
const sources=['engine/project-physics2d-trace.mjs','engine/project-physics2d-replay-case.mjs','engine/project-physics2d-observation-selection.mjs','engine/project-physics2d-input-replay.mjs','engine/project-physics2d-replay-contract.mjs',
  'web/modules/app-project-build.js','web/modules/app-project-physics-observation.js','web/project-build.css','web/i18n/en.js','web/i18n/ja.js',
  'scripts/tests/helpers/scene-physics2d-character-motion-author-fixture.mjs','scripts/tests/physics-case-inspection-smoke.mjs'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,buildHash(await fs.readFile(path.join(appRoot,name)))])));
report.node={version:process.version,sha256:buildHash(await fs.readFile(process.execPath))};report.tool={sha256:buildHash(await fs.readFile(tool))};
const cleanups=[],fixture={after:callback=>cleanups.push(callback)};
const wait=async(check,label,budget=45000)=>{for(const deadline=Date.now()+budget;Date.now()<deadline;){if(await check())return;await delay(100);}throw Error('Timed out: '+label);};
async function authorTree(root){const hashes={};for(const entry of await fs.readdir(root,{recursive:true,withFileTypes:true})){if(!entry.isFile())continue;const file=path.join(entry.parentPath||entry.path,entry.name),name=path.relative(root,file);if(name==='workspace.json'||/^(documents|metadata|templates|assets)\//.test(name))hashes[name]=buildHash(await fs.readFile(file));}return hashes;}
let socket,captureFailure;
try{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-physics-observation-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
  const f=await scenePhysics2DCharacterMotionAuthor(fixture,{obstacle:'wall'});
  await f.edit('documents/projects/demo.json',value=>{value.sceneIds=[f.sceneIds[0]];});
  await f.edit(`metadata/documents/${f.assemblyId}.json`,value=>{value.relations=value.relations.filter(row=>row.targetId===f.sceneIds[0]);});
  await f.edit(`metadata/documents/${f.sceneIds[0]}.json`,value=>{value.relations=value.relations.filter(row=>!['behavior','audio','animation'].includes(row.kind));});
  const env={...process.env,VIENTO_APP_ROOT:appRoot,VIENTO_WORKSPACE_ROOT:f.author,VIENTO_GODOT_BIN:tool,VIENTO_EXECUTION_BACKEND:'org.viento.godot4',XDG_CACHE_HOME:path.join(temporary,'cache'),XDG_CONFIG_HOME:path.join(temporary,'config')};delete env.VIENTO_SESSION_TOKEN;delete env.VIENTO_PREFERENCES_PATH;
  const rebuilt=await runCommand(process.execPath,[path.join(appRoot,'scripts/ops/rebuild.mjs')],{cwd:appRoot,env});assert.equal(rebuilt.code,0,JSON.stringify(rebuilt));
  const initial=await authorTree(f.author),base=await serve(fixture,appRoot,env);report.fixture={assemblyId:f.assemblyId,physicsPath:f.physicsPath,instanceId:f.instanceId};
  const state=async()=>{const response=await fetch(`${base}/api/project-build`).then(value=>value.json());return response.data||response;};
  const profile=path.join(temporary,'chrome');await fs.mkdir(profile);
  const chrome=spawn(process.argv[2]||'/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--remote-debugging-port=0','--window-size=1440,1100','about:blank'],{stdio:'ignore'});
  cleanups.push(async()=>{if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}});
  let port;await wait(async()=>{try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];return Boolean(port);}catch{return false;}},'Chrome startup');
  const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(value=>value.json());socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);await once(socket,'open');
  const pending=new Map();let sequence=0;
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  socket.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id){const request=pending.get(value.id);pending.delete(value.id);value.error?request?.reject(Error(value.error.message)):request?.resolve(value.result);}else if(value.method==='Runtime.exceptionThrown')report.errors.push(value.params.exceptionDetails);else if(value.method==='Page.javascriptDialogOpening'){report.dialogs.push(value.params.message);void call('Page.handleJavaScriptDialog',{accept:false});}});
  const evaluate=async expression=>{const value=await call('Runtime.evaluate',{expression:`(async()=>(${expression}))()`,awaitPromise:true,returnByValue:true,userGesture:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`),fill=(selector,value,event='change')=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  const enabled=selector=>wait(()=>evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled===false`),selector+' enabled');
  const screenshot=async name=>{const image=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,name),Buffer.from(image.data,'base64'));report.screenshots.push(name);};
  const panelVisible=()=>wait(()=>evaluate(`document.querySelector('#projectPhysicsObservationPanel')?.hidden===false`),'physics observation panel');
  captureFailure=async()=>{await screenshot('failure.png');report.pageFailure=await evaluate(`({text:document.body.innerText,requests:window.__physicsNavigationRequests||[]})`);};
  const perform=async(selector,kind)=>{const previous=(await state()).job?.id;await enabled(selector);await click(selector);let job;await wait(async()=>{job=(await state()).job;return job?.kind===kind&&job.id!==previous&&job.status!=='running';},kind+' completion',90000);report.jobs.push({kind:job.kind,id:job.id,status:job.status,buildId:job.buildId,snapshotId:job.snapshotId});assert.equal(job.status,'succeeded',JSON.stringify(job));return job;};
  await call('Runtime.enable');await call('Page.enable');report.browser=(await call('Browser.getVersion')).product;await call('Page.navigate',{url:`${base}/web/?mode=edit`});
  await wait(()=>evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable&&document.querySelector('#projectBuildBtn')?.hidden===false`),'editor startup');
  await click('#projectBuildBtn');await enabled('#projectBuildScene');await fill('#projectBuildScene',f.assemblyId);
  await perform('#projectBuildPlan','plan');await perform('#projectBuildGenerate','build');
  const program={format:'viento-physics2d-input-replay',schemaVersion:1,fixedDelta:1/60,
    steps:Array.from({length:30},(_,index)=>({left:false,right:index<15,up:false,down:false,jump:index===6}))};
  await fill('#projectBuildPhysicsReplayProgram',JSON.stringify(program,null,2),'input');
  const replay=await perform('#projectBuildPhysicsReplay','run');
  const replayObserved=validateProjectPhysics2DObservation(replay.physics);
  assert.equal(replayObserved.phase,'finished');assert.equal(replayObserved.limited,false);
  const collision=replayObserved.samples.find(row=>row.instanceId===f.instanceId&&row.contacts.some(contact=>contact.collider));assert.ok(collision,'Native replay must include a mapped collision');
  const other=replayObserved.samples.find(row=>row.instanceId===f.instanceId&&row.stepIndex!==collision.stepIndex);assert.ok(other);
  const definition={format:'viento-physics2d-replay-case',schemaVersion:1,program,checks:[
    {instanceId:f.instanceId,stepIndex:collision.stepIndex,positionAfter:{value:collision.positionAfter,tolerance:[0.01,0.01]},contact:{exists:true,bodyId:collision.contacts.find(contact=>contact.collider).collider.bodyId}},
    {instanceId:f.instanceId,stepIndex:other.stepIndex,positionAfter:{value:[9999,9999],tolerance:[0,0]},contact:{exists:other.contacts.length>0}}
  ]};
  await fill('#projectBuildPhysicsCaseProgram',JSON.stringify(definition,null,2),'input');
  const ran=await perform('#projectBuildPhysicsCaseRun','run');assert.equal(ran.physicsVerification.evaluation.status,'failed');
  assert.deepEqual(ran.physicsVerification.evaluation.checks.map(check=>check.passed),[true,false]);
  const observed=validateProjectPhysics2DObservation(ran.physics);assert.equal(observed.phase,'finished');assert.equal(observed.limited,false);
  const samples=definition.checks.map(check=>observed.samples.find(row=>row.instanceId===check.instanceId&&row.stepIndex===check.stepIndex));assert.ok(samples.every(Boolean));
  await panelVisible();await wait(()=>evaluate(`document.querySelectorAll('.build-physics-case-sample').length===2`),'two case sample actions');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#projectBuildPhysicsCaseChecks > li'),item=>({instanceId:item.dataset.instanceId,stepIndex:Number(item.dataset.stepIndex),passed:item.dataset.passed}))`),definition.checks.map((check,i)=>({instanceId:check.instanceId,stepIndex:check.stepIndex,passed:String(i===0)})));
  // Navigation must not issue HTTP mutations; monitor fetch calls across the selected action.
  await evaluate(`(()=>{window.__physicsNavigationRequests=[];const original=window.fetch.bind(window);window.fetch=(input,init={})=>{const url=new URL(typeof input==='string'?input:input.url,location.href);let action='';try{action=JSON.parse(init.body||'{}').action||''}catch{}window.__physicsNavigationRequests.push({path:url.pathname,method:(init.method||input.method||'GET').toUpperCase(),action,phase:window.__physicsClickPhase||'',stack:new Error().stack});return original(input,init);};})()`);
  const select=async(index,sample)=>{
    const before=await evaluate(`window.__physicsNavigationRequests.filter(request=>request.method!=='GET').length`);
    const activePath=await evaluate(`(await import('/web/modules/app-state.js')).appState.activePath`);
    await click(`#projectBuildPhysicsCaseChecks li:nth-child(${index+1}) .build-physics-case-sample`);
    await wait(()=>evaluate(`document.querySelector('#projectPhysicsObservationDetail').dataset.sequence===${JSON.stringify(String(sample.sequence))}`),'selected sample');
    assert.equal(await evaluate(`window.__physicsNavigationRequests.filter(request=>request.method!=='GET').length`),before,'Selecting must not issue mutating HTTP requests');
    assert.equal(await evaluate(`document.activeElement===document.querySelector('#projectPhysicsObservationSample')`),true,'Selection focuses the sample selector');
    assert.equal(await evaluate(`document.querySelector('#projectBuildDialog').open`),true,'Selection does not open the source');
    assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.activePath`),activePath);
    assert.equal(await evaluate(`(()=>{const r=document.querySelector('#projectPhysicsObservationSample').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})()`),true,'Selected sample selector remains visible');
    assert.deepEqual(await evaluate(`({instance:document.querySelector('#projectPhysicsObservationInstance').value,step:document.querySelector('#projectPhysicsObservationStep').value,sample:document.querySelector('#projectPhysicsObservationSample').value})`),
      {instance:sample.instanceId,step:`${sample.visitIndex}:${sample.sceneId}:${sample.stepIndex}`,sample:String(sample.sequence)});
    const identity=await evaluate(`document.querySelector('#projectPhysicsObservationIdentity').textContent`);for(const value of [sample.sceneId,sample.instanceId,sample.bodyId])assert.ok(identity.includes(value),value);
    const motion=await evaluate(`Array.from(document.querySelectorAll('#projectPhysicsObservationMotion dd'),element=>element.title)`);
    assert.equal(motion[6],`[${sample.positionAfter.join(', ')}]`);
    const contacts=await evaluate(`Array.from(document.querySelectorAll('#projectPhysicsObservationContacts > li'),item=>({text:item.textContent,values:Array.from(item.querySelectorAll('dd'),entry=>entry.title)}))`);
    assert.equal(contacts.length,sample.contacts.length);
    sample.contacts.forEach((contact,i)=>{if(contact.collider)assert.ok(contacts[i].text.includes(contact.collider.bodyId));assert.deepEqual(contacts[i].values,[contact.position,contact.normal,contact.travel,contact.remainder].map(value=>`[${value.join(', ')}]`));});
    report.steps.push(`Native case check ${index+1} selected sequence ${sample.sequence}, visit ${sample.visitIndex}, step ${sample.stepIndex}, exact position and mapped contacts without mutating HTTP requests.`);
  };
  await select(0,samples[0]);await select(1,samples[1]);await select(0,samples[0]);
  report.case={jobId:ran.id,buildId:ran.buildId,snapshotId:ran.snapshotId,evaluation:ran.physicsVerification.evaluation,samples};
  await evaluate(`document.querySelector('#projectBuildPhysicsCaseResult').scrollIntoView({block:'center'})`);await screenshot('case-desktop.png');
  for(const language of ['zh-CN','en','ja']){
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await wait(()=>evaluate(`document.querySelectorAll('.build-physics-case-sample').length===2`),'translated sample actions');
    await evaluate(`document.querySelector('.build-physics-case-sample').scrollIntoView({block:'center'})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#projectBuildDialog'),e=document.querySelector('.build-physics-case-sample'),r=e.getBoundingClientRect();return {text:e.textContent,inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,noOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,dialog:{client:d.clientWidth,scroll:d.scrollWidth},document:{client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth},overflow:Array.from(d.querySelectorAll('*')).filter(x=>x.scrollWidth>x.clientWidth+1&&x.clientWidth>0).map(x=>({tag:x.tagName,id:x.id,className:typeof x.className==='string'?x.className:'',client:x.clientWidth,scroll:x.scrollWidth})).slice(0,20)};})()`);
    report.layout[language]=layout;assert.equal(layout.text,{'zh-CN':'查看本步物理样本',en:"View this step's physics sample",ja:'このステップの物理サンプルを表示'}[language]);assert.equal(layout.inside,true,JSON.stringify(layout));assert.equal(layout.noOverflow,true,JSON.stringify(layout));report.layout[language]=layout;await screenshot(`case-${language}-390.png`);
    await select(0,samples[0]);await screenshot(`sample-${language}-390.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);await select(0,samples[0]);
  await click('#projectPhysicsObservationOpen');await wait(()=>evaluate(`!document.querySelector('#projectBuildDialog').open&&(await import('/web/modules/app-state.js')).appState.activePath.endsWith(${JSON.stringify(f.physicsPath)})`),'physics source navigation');
  const selection=await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return {start:e.selectionStart,end:e.selectionEnd,text:e.value.slice(e.selectionStart,e.selectionEnd)};})()`);assert.ok(selection.text.includes(samples[0].bodyId));report.sourceSelection=selection;
  report.steps.push('The existing source action opens the exact selected native body source range.');
  // Stored detached buttons must not act after a close/reopen or author-input edit.
  const clickOld=async()=>{let last=-1,stableSince=Date.now();for(const end=Date.now()+5000;Date.now()<end;){const count=await evaluate(`window.__physicsNavigationRequests.length`);if(count!==last){last=count;stableSince=Date.now();}if(Date.now()-stableSince>=500)break;await delay(100);}const before=await evaluate(`window.__physicsNavigationRequests.length`);await evaluate(`(()=>{window.__physicsClickPhase='stale';window.__oldCaseButton.click()})()`);await delay(250);const requests=await evaluate(`(()=>{window.__physicsClickPhase='';return window.__physicsNavigationRequests.slice(${before}).filter(request=>request.method!=='GET')})()`);(report.staleClicks||=[]).push(requests);assert.deepEqual(requests,[],'Stale button must not issue HTTP writes');};
  await click('#projectBuildBtn');await panelVisible();await wait(()=>evaluate(`document.querySelectorAll('.build-physics-case-sample').length===2`),'case after reopen');
  await evaluate(`(window.__oldCaseButton=document.querySelectorAll('.build-physics-case-sample')[1])`);
  await click('#projectBuildClose');await click('#projectBuildBtn');await panelVisible();
  const beforeClose=await evaluate(`document.querySelector('#projectPhysicsObservationSample').value`);
  await clickOld();assert.equal(await evaluate(`document.querySelector('#projectPhysicsObservationSample').value`),beforeClose);
  await wait(()=>evaluate(`document.querySelectorAll('.build-physics-case-sample').length===2`),'case after second reopen');
  await evaluate(`(window.__oldCaseButton=document.querySelectorAll('.build-physics-case-sample')[1])`);
  await fill('#projectBuildPhysicsCaseProgram',JSON.stringify({...definition,checks:[definition.checks[0]]},null,2),'input');
  assert.equal(await evaluate(`document.querySelector('#projectBuildPhysicsCaseResult').hidden`),true);await clickOld();
  assert.equal(await evaluate(`document.querySelector('#projectPhysicsObservationSample').value`),beforeClose);
  // Start a different real job; stale callbacks must not redirect its selection.
  await fill('#projectBuildPhysicsCaseProgram',JSON.stringify(definition,null,2),'input');
  await wait(()=>evaluate(`document.querySelectorAll('.build-physics-case-sample').length===2`),'case after restoring input');
  await clickOld();assert.equal(await evaluate(`document.querySelector('#projectPhysicsObservationSample').value`),beforeClose,'Restoring identical JSON does not revive a stale button');
  await evaluate(`(window.__oldCaseButton=document.querySelectorAll('.build-physics-case-sample')[1])`);
  await evaluate(`document.querySelector('#projectBuildPhysicsCaseProgram').dispatchEvent(new Event('input',{bubbles:true}))`);
  await wait(()=>evaluate(`document.querySelectorAll('.build-physics-case-sample').length===2`),'case after same-byte edit');
  const sameByteSelection=await evaluate(`document.querySelector('#projectPhysicsObservationSample').value`);await clickOld();
  assert.equal(await evaluate(`document.querySelector('#projectPhysicsObservationSample').value`),sameByteSelection,'Even an identical-byte input revokes the old button');
  await evaluate(`(window.__oldCaseButton=document.querySelectorAll('.build-physics-case-sample')[1])`);
  const rerun=await perform('#projectBuildPhysicsCaseRun','run');assert.notEqual(rerun.id,ran.id);
  await wait(()=>evaluate(`document.querySelectorAll('.build-physics-case-sample').length===2`),'new case job');
  const beforeOld=await evaluate(`document.querySelector('#projectPhysicsObservationSample').value`);await clickOld();
  assert.equal(await evaluate(`document.querySelector('#projectPhysicsObservationSample').value`),beforeOld);
  report.steps.push('Detached case buttons do not redirect a selection after close/reopen, editing/restoring JSON, same-byte input or starting another real job.');
  await select(0,validateProjectPhysics2DObservation(rerun.physics).samples.find(row=>row.instanceId===f.instanceId&&row.stepIndex===definition.checks[0].stepIndex));
  await click('#projectPhysicsObservationOpen');await wait(()=>evaluate(`!document.querySelector('#projectBuildDialog').open`),'return to source');
  if(!await evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`)){await enabled('#docEditBtn');await click('#docEditBtn');}
  await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');
  const original=await fs.readFile(path.join(f.author,f.physicsPath),'utf8'),draft=original+'\n未保存 / draft / 下書き\n';await fill('#docSourceEditor',draft,'input');await evaluate(`document.querySelector('#docSourceEditor').setSelectionRange(7,7)`);
  await click('#projectBuildBtn');await panelVisible();assert.equal(await evaluate(`document.querySelector('#projectPhysicsObservationOpen').disabled`),true);await click('#projectPhysicsObservationOpen');await click('#projectBuildClose');
  assert.deepEqual(await evaluate(`({value:document.querySelector('#docSourceEditor').value,caret:document.querySelector('#docSourceEditor').selectionStart,dirty:(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges})`),{value:draft,caret:7,dirty:true});
  assert.deepEqual(await authorTree(f.author),initial);report.authorSnapshot={before:initial,after:await authorTree(f.author)};
  assert.equal((await state()).job.id,rerun.id);report.steps.push('Unsaved source draft remains unchanged and protected; all author files retain identical hashes.');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.dialogs,[]);for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,'Source changed during smoke: '+file);report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=String(error.stack).replaceAll(appRoot,'<repository>').replaceAll(os.homedir(),'<home>').replaceAll(os.tmpdir(),'<tmp>');console.error(report.failure);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2).replaceAll(appRoot,'<repository>').replaceAll(os.homedir(),'<home>').replaceAll(os.tmpdir(),'<tmp>')+'\n');console.log(JSON.stringify({ok:report.ok,output:'<evidence>/'+path.basename(output),steps:report.steps,failure:report.failure},null,2));}
