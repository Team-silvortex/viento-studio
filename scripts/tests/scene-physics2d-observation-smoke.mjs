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
import { scenePhysics2DAuthor } from './helpers/scene-physics2d-author-fixture.mjs';
import { validateProjectPhysics2DObservation } from '../../engine/project-physics2d-trace.mjs';
import '../adapters/node-studio-core.mjs';
const appRoot=fileURLToPath(new URL('../../',import.meta.url)),tool=process.env.VIENTO_GODOT_BIN;
if(!tool||!path.isAbsolute(tool))throw Error('Set VIENTO_GODOT_BIN to an absolute executable.');
const evidenceRoot=path.join(appRoot,'docs/test-results/scene-physics2d-observation');
const output=path.resolve(process.env.VIENTO_PHYSICS_OBSERVATION_UI_OUTPUT||path.join(evidenceRoot,`browser-${Date.now()}`));
if(!output.startsWith(evidenceRoot+path.sep))throw Error('Use a fresh directory inside the physics-observation evidence topic.');
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Use a new empty evidence directory.');
const report={startedAt:new Date().toISOString(),steps:[],screenshots:[],jobs:[],errors:[],dialogs:[],layout:{},limitations:[
  'Real HTTP editor and native Godot headless test; installed Tauri, Android and Bevy were not tested.',
  'Observation covers built-in finite character sweeps only. It does not claim persistent contact, sensor, grounded-state or general script-controlled body observation.',
  'No source authoring action is saved. A disposable unsaved draft tests navigation protection.'
]};
const sources=['engine/project-physics2d-trace.mjs','engine/project-runtime-events.mjs','engine/scene-physics2d.mjs','scripts/adapters/node-project-build.mjs','scripts/lib/project-build-service.mjs',
  'scripts/backends/godot4-adapter.mjs','scripts/backends/godot4-physics-observation.mjs','scripts/backends/godot4/physics-observation-runtime.gd','scripts/backends/godot4/project-physics-observation-runtime.gd',
  'web/modules/app-project-build.js','web/modules/app-project-physics-observation.js','web/project-physics-observation.css','web/index.html','web/i18n/en.js','web/i18n/ja.js','scripts/tests/helpers/scene-physics2d-author-fixture.mjs','scripts/tests/scene-physics2d-observation-smoke.mjs'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,buildHash(await fs.readFile(path.join(appRoot,name)))])));
report.node={version:process.version,sha256:buildHash(await fs.readFile(process.execPath))};report.tool={sha256:buildHash(await fs.readFile(tool))};
const cleanups=[],fixture={after:callback=>cleanups.push(callback)};
const wait=async(check,label,budget=45000)=>{for(const deadline=Date.now()+budget;Date.now()<deadline;){if(await check())return;await delay(100);}throw Error('Timed out: '+label);};
async function authorTree(root){const hashes={};for(const entry of await fs.readdir(root,{recursive:true,withFileTypes:true})){if(!entry.isFile())continue;const file=path.join(entry.parentPath||entry.path,entry.name),name=path.relative(root,file);if(name==='workspace.json'||/^(documents|metadata|templates|assets)\//.test(name))hashes[name]=buildHash(await fs.readFile(file));}return hashes;}
let socket,captureFailure;
try{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-physics-observation-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
  const f=await scenePhysics2DAuthor(fixture,{animation:false});
  await f.edit(f.physicsPath,document=>{document.schemaVersion=2;document.bodies[0].collisionResponse='slide';document.bodies.push({...structuredClone(document.bodies[0]),id:'73737373-7373-4373-8373-000000000001',instanceId:'73737373-7373-4373-8373-000000000002'});});
  await f.edit('documents/scenes/demo.json',scene=>scene.actors.push({...structuredClone(scene.actors[0]),instanceId:'73737373-7373-4373-8373-000000000002',position:[100,340],speed:120}));
  await f.script('checkpoint','extends Node\nfunc _ready() -> void:\n\tInput.action_press("ui_down")\nfunc _exit_tree() -> void:\n\tInput.action_release("ui_down")\n');
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
  captureFailure=async()=>{await screenshot('failure.png');report.pageFailure=await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value})`);report.serviceFailure=await state();};
  const perform=async(selector,kind)=>{const previous=(await state()).job?.id;await enabled(selector);await click(selector);let job;await wait(async()=>{job=(await state()).job;return job?.kind===kind&&job.id!==previous&&job.status!=='running';},kind+' completion',90000);report.jobs.push(job);assert.equal(job.status,'succeeded',JSON.stringify(job));return job;};
  await call('Runtime.enable');await call('Page.enable');report.browser=(await call('Browser.getVersion')).product;await call('Page.navigate',{url:`${base}/web/?mode=edit`});
  await wait(()=>evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable&&document.querySelector('#projectBuildBtn')?.hidden===false`),'editor startup');
  await click('#projectBuildBtn');await enabled('#projectBuildScene');await fill('#projectBuildScene',f.assemblyId);await perform('#projectBuildPlan','plan');await perform('#projectBuildGenerate','build');const ran=await perform('#projectBuildHeadless','run');
  const observed=validateProjectPhysics2DObservation(ran.physics);assert.equal(observed.phase,'finished');assert.equal(observed.limited,false);assert.equal(observed.samples.length,60);
  const collision=observed.samples.find(sample=>sample.instanceId===f.instanceId&&sample.contacts.some(contact=>contact.collider));assert.ok(collision);assert.equal(collision.response,'slide');assert.ok(collision.displacement[0]<collision.requestedMotion[0]);assert.ok(collision.displacement[1]>0);
  await panelVisible();await fill('#projectPhysicsObservationInstance',f.instanceId);await fill('#projectPhysicsObservationSample',String(collision.sequence));
  assert.equal(await evaluate(`document.querySelector('#projectPhysicsObservationDetail').dataset.sequence`),String(collision.sequence));
  const shown=await evaluate(`Array.from(document.querySelectorAll('#projectPhysicsObservationMotion dd'),e=>({text:e.textContent,exact:e.title}))`);assert.equal(shown[3].exact,`[${collision.requestedMotion.join(', ')}]`);assert.equal(shown[4].exact,`[${collision.displacement.join(', ')}]`);
  assert.match(await evaluate(`document.querySelector('#projectPhysicsObservationContacts').textContent`),new RegExp(collision.contacts[0].collider.bodyId));
  await evaluate(`document.querySelector('#projectPhysicsObservationDetail').scrollIntoView({block:'center'})`);await screenshot('physics-observation-desktop.png');
  report.sample=collision;report.steps.push('Real browser plan → Godot 0.23.0 build → finite headless run exposes 60 independently validated samples; a native wall sweep displays requested and actual displacement, contact identity, point and normal.');
  await fill('#projectPhysicsObservationStep',`${collision.visitIndex}:${collision.sceneId}:${collision.stepIndex}`);assert.equal(await evaluate(`document.querySelector('#projectPhysicsObservationSample').options.length`),1);await fill('#projectPhysicsObservationStep','');
  await click('#projectPhysicsObservationNext');assert.notEqual(await evaluate(`document.querySelector('#projectPhysicsObservationSample').value`),String(collision.sequence));await click('#projectPhysicsObservationPrevious');assert.equal(await evaluate(`document.querySelector('#projectPhysicsObservationSample').value`),String(collision.sequence));
  report.steps.push('Instance filtering, visit/step filtering and previous/next selection operate on the same admitted records without running commands or changing actor positions.');
  for(const language of ['zh-CN','en','ja']){
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await evaluate(`(window.__physicsSample=document.querySelector('#projectPhysicsObservationSample'),window.__physicsSample.focus())`);await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate(`document.querySelector('#projectPhysicsObservationSample')===window.__physicsSample&&document.activeElement===window.__physicsSample`),true);assert.equal(await evaluate(`window.__physicsSample.value`),String(collision.sequence));
    await evaluate(`document.querySelector('#projectPhysicsObservationInstance').scrollIntoView({block:'start'})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#projectBuildDialog'),p=document.querySelector('#projectPhysicsObservationPanel'),s=document.querySelector('#projectPhysicsObservationSample'),r=s.getBoundingClientRect(),c=getComputedStyle(s);return{noOverflow:d.scrollWidth<=d.clientWidth&&p.scrollWidth<=p.clientWidth&&document.documentElement.scrollWidth<=innerWidth,selectInside:r.left>=0&&r.right<=innerWidth,color:c.color,background:c.backgroundColor,title:document.querySelector('#projectPhysicsObservationTitle').textContent};})()`);
    assert.equal(layout.noOverflow,true,JSON.stringify(layout));assert.equal(layout.selectInside,true);assert.notEqual(layout.color,layout.background);report.layout[language]=layout;await screenshot(`physics-observation-${language}-390.png`);
    await evaluate(`document.querySelector('#projectPhysicsObservationContacts').scrollIntoView({block:'start'})`);assert.equal(await evaluate(`(()=>{const e=document.querySelector('.project-physics-collider-source');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`),true);await screenshot(`physics-contact-${language}-390.png`);
  }
  report.steps.push('Chinese, English and Japanese at 390px retain focused selection, readable controls and reachable contact-source actions without horizontal overflow.');
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await click('.project-physics-collider-source');await wait(()=>evaluate(`!document.querySelector('#projectBuildDialog').open&&(await import('/web/modules/app-state.js')).appState.activePath.endsWith(${JSON.stringify(f.physicsPath)})`),'collider source navigation');
  const selection=await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return{start:e.selectionStart,end:e.selectionEnd,text:e.value.slice(e.selectionStart,e.selectionEnd)};})()`);assert.match(selection.text,new RegExp(collision.contacts[0].collider.bodyId));report.sourceSelection={collider:selection};
  await click('#projectBuildBtn');await panelVisible();await fill('#projectPhysicsObservationSample',String(collision.sequence));await click('#projectPhysicsObservationOpen');await wait(()=>evaluate(`!document.querySelector('#projectBuildDialog').open`),'character source navigation');
  const characterSelection=await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return{start:e.selectionStart,end:e.selectionEnd,text:e.value.slice(e.selectionStart,e.selectionEnd)};})()`);assert.match(characterSelection.text,new RegExp(collision.bodyId));report.sourceSelection.character=characterSelection;
  report.steps.push('Collider and character actions independently navigate to their exact /bodies/N source ranges in the same saved physics document.');
  if(!await evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`)){await enabled('#docEditBtn');await click('#docEditBtn');}await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');
  const original=await fs.readFile(path.join(f.author,f.physicsPath),'utf8'),draft=original+'\n未保存 / draft / 下書き\n';await fill('#docSourceEditor',draft,'input');await evaluate(`document.querySelector('#docSourceEditor').setSelectionRange(7,7)`);await click('#projectBuildBtn');await panelVisible();
  assert.equal(await evaluate(`document.querySelector('#projectPhysicsObservationOpen').disabled`),true);assert.equal(await evaluate(`document.querySelector('.project-physics-collider-source').disabled`),true);
  await click('#projectPhysicsObservationOpen');await click('.project-physics-collider-source');assert.equal(await evaluate(`document.querySelector('#projectBuildDialog').open`),true);await click('#projectBuildClose');
  assert.deepEqual(await evaluate(`({value:document.querySelector('#docSourceEditor').value,caret:document.querySelector('#docSourceEditor').selectionStart,dirty:(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges})`),{value:draft,caret:7,dirty:true});
  const final=await state();assert.equal(final.job.id,ran.id);assert.deepEqual(final.job.physics,ran.physics);assert.deepEqual(final.job.runtime,ran.runtime);assert.deepEqual(await authorTree(f.author),initial);
  report.authorSnapshot={before:initial,after:await authorTree(f.author)};report.steps.push('An unsaved editor draft disables both navigation actions; returning preserves every character and caret. The owned job, legacy runtime snapshot, physics samples and all author files remain unchanged.');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.dialogs,[]);for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,'Source changed during smoke: '+file);report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));}
