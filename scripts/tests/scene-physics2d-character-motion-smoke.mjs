// Real Chrome → gravity/jump review → ordinary Save → Godot build → motion observation.
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
const evidenceRoot=path.join(appRoot,'docs/test-results/scene-physics2d-character-motion');
const output=path.resolve(process.env.VIENTO_PHYSICS_MOTION_UI_OUTPUT||path.join(evidenceRoot,`browser-${Date.now()}`));
if(!output.startsWith(evidenceRoot+path.sep))throw Error('Use a fresh directory inside the character-motion evidence topic.');
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Use a new empty evidence directory.');
const report={startedAt:new Date().toISOString(),steps:[],screenshots:[],jobs:[],errors:[],dialogs:[],layout:{},limitations:[
  'Real HTTP editor and native Godot headless test; installed Tauri, Android and Bevy were not tested.',
  'Observation covers built-in finite character sweeps only. It does not claim persistent contact, sensor, grounded-state or general script-controlled body observation.',
  'Only the reviewed character motion and required response/schema fields are saved in one disposable physics document; all other author files remain unchanged.'
]};
const sources=['engine/studio-core.mjs','engine/studio-core.wasm','engine/scene-physics2d-core.mjs','engine/scene-physics2d-edit.mjs','engine/project-physics2d-trace.mjs','engine/project-runtime-events.mjs','engine/scene-physics2d.mjs','engine/backend-capabilities.mjs','scripts/adapters/node-project-build.mjs','scripts/lib/project-build-service.mjs',
  'scripts/backends/godot4-adapter.mjs','scripts/backends/godot4-physics-character-motion.mjs','scripts/backends/godot4/physics-character-motion-runtime.gd','scripts/backends/godot4-physics-observation.mjs','scripts/backends/godot4/physics-observation-runtime.gd','scripts/backends/godot4/project-physics-observation-runtime.gd',
  'web/modules/app-scene-physics2d.js','web/modules/app-scene-physics2d-source.js','web/scene-physics2d.css','web/modules/app-project-build.js','web/modules/app-project-physics-observation.js','web/project-physics-observation.css','web/index.html','web/i18n/en.js','web/i18n/ja.js','scripts/tests/helpers/scene-physics2d-author-fixture.mjs','scripts/tests/helpers/scene-physics2d-character-motion-author-fixture.mjs','scripts/tests/scene-physics2d-character-motion-smoke.mjs'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,buildHash(await fs.readFile(path.join(appRoot,name)))])));
report.node={version:process.version,sha256:buildHash(await fs.readFile(process.execPath))};report.tool={sha256:buildHash(await fs.readFile(tool))};
const cleanups=[],fixture={after:callback=>cleanups.push(callback)};
const wait=async(check,label,budget=45000)=>{for(const deadline=Date.now()+budget;Date.now()<deadline;){if(await check())return;await delay(100);}throw Error('Timed out: '+label);};
async function authorTree(root){const hashes={};for(const entry of await fs.readdir(root,{recursive:true,withFileTypes:true})){if(!entry.isFile())continue;const file=path.join(entry.parentPath||entry.path,entry.name),name=path.relative(root,file);if(name==='workspace.json'||/^(documents|metadata|templates|assets)\//.test(name))hashes[name]=buildHash(await fs.readFile(file));}return hashes;}
let socket,captureFailure;
try{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-physics-motion-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
  const f=await scenePhysics2DCharacterMotionAuthor(fixture,{animation:false,jump:true});
  await f.edit(f.physicsPath,document=>{document.schemaVersion=1;delete document.bodies[0].collisionResponse;delete document.bodies[0].characterMotion;});
  const authorFile=path.join(f.author,f.physicsPath),beforeModel=JSON.parse(await fs.readFile(authorFile,'utf8'));
  const original='\ufeff'+JSON.stringify(beforeModel,null,2).replace('"bodies"','"bodi\\u0065s"').replace('"layer": 1','"layer": 1e0').replace(/\n/g,'\r\n')+'\r\n';await fs.writeFile(authorFile,original);
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
  socket.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id){const request=pending.get(value.id);pending.delete(value.id);value.error?request?.reject(Error(value.error.message)):request?.resolve(value.result);}else if(value.method==='Runtime.exceptionThrown')report.errors.push(value.params.exceptionDetails);else if(value.method==='Page.javascriptDialogOpening'){report.dialogs.push(value.params.message);void call('Page.handleJavaScriptDialog',{accept:true});}});
  const evaluate=async expression=>{const value=await call('Runtime.evaluate',{expression:`(async()=>(${expression}))()`,awaitPromise:true,returnByValue:true,userGesture:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`),fill=(selector,value,event='change')=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  const enabled=selector=>wait(()=>evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled===false`),selector+' enabled');
  const screenshot=async name=>{const image=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,name),Buffer.from(image.data,'base64'));report.screenshots.push(name);};
  const panelVisible=()=>wait(()=>evaluate(`document.querySelector('#projectPhysicsObservationPanel')?.hidden===false`),'physics observation panel');
  captureFailure=async()=>{await screenshot('failure.png');report.pageFailure=await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value})`);report.serviceFailure=await state();};
  const perform=async(selector,kind)=>{const previous=(await state()).job?.id;await enabled(selector);await click(selector);let job;await wait(async()=>{job=(await state()).job;return job?.kind===kind&&job.id!==previous&&job.status!=='running';},kind+' completion',90000);report.jobs.push(job);assert.equal(job.status,'succeeded',JSON.stringify(job));return job;};
  await call('Runtime.enable');await call('Page.enable');report.browser=(await call('Browser.getVersion')).product;await call('Page.navigate',{url:`${base}/web/?mode=edit`});
  await wait(()=>evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable&&document.querySelector('#projectBuildBtn')?.hidden===false`),'editor startup');
  await wait(()=>evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.endsWith(${JSON.stringify(f.physicsPath)}))`),'physics source in sidebar');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.endsWith(${JSON.stringify(f.physicsPath)})).click()`);
  await enabled('#docEditBtn');await click('#docEditBtn');await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');
  const visible=content=>content.replace(/\r\n?/g,'\n'),value=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).value`),text=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  assert.equal(await value('#docSourceEditor'),visible(original));
  const open=async()=>{await enabled('#scenePhysics2DBtn');await click('#scenePhysics2DBtn');await enabled('#scenePhysics2DMotion');};
  const review=async()=>{await enabled('#scenePhysics2DCheck');await click('#scenePhysics2DCheck');await enabled('#scenePhysics2DApply');return text('#scenePhysics2DAfter');};
  await open();assert.equal(await value('#scenePhysics2DMotion'),'free');assert.equal(await value('#scenePhysics2DResponse'),'stop');
  await click('#scenePhysics2DCheck');await wait(()=>evaluate(`document.querySelector('#scenePhysics2DDialog').getAttribute('aria-busy')==='false'`),'unchanged Check');assert.equal(await evaluate(`document.querySelector('#scenePhysics2DApply').disabled`),true);assert.deepEqual(await authorTree(f.author),initial);
  report.steps.push('A schema1 document opens in free planar mode. No-change Check preserves every author byte and creates no Apply ticket.');
  await fill('#scenePhysics2DMotion','platformer');await fill('#scenePhysics2DJumpSpeed','120','input');assert.equal(await value('#scenePhysics2DResponse'),'slide');assert.equal(await evaluate(`document.querySelector('#scenePhysics2DResponse').disabled`),true);
  const candidate=await review(),planned=JSON.parse(candidate.replace(/^\ufeff/,''));assert.equal(planned.schemaVersion,3);assert.deepEqual(planned.bodies[0].characterMotion,{kind:'platformer',gravity:980,jumpSpeed:120,maxFallSpeed:1200});assert.equal(planned.bodies[0].collisionResponse,'slide');
  assert.deepEqual(planned.bodies.map(({collisionResponse,characterMotion,...body})=>body),beforeModel.bodies);assert.ok(candidate.startsWith('\ufeff'));assert.ok(candidate.includes('\r\n'));assert.ok(candidate.includes('"bodi\\u0065s"'));assert.ok(candidate.includes('"layer": 1e0'));assert.deepEqual(await authorTree(f.author),initial);assert.equal(await value('#docSourceEditor'),visible(original));
  await evaluate(`document.querySelector('#scenePhysics2DMotionSection').scrollIntoView({block:'start'})`);await screenshot('motion-review-desktop.png');
  report.steps.push('Explicit gravity/jump mode selects and locks slide, reviews schema3 and the three motion values, and preserves shape, offset, IDs, layer spelling, BOM, escaped key and line endings without writing.');
  for(const language of ['zh-CN','en','ja']){
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await evaluate(`(window.__motionSelect=document.querySelector('#scenePhysics2DMotion'),window.__motionSelect.focus())`);await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate(`document.querySelector('#scenePhysics2DMotion')===window.__motionSelect&&document.activeElement===window.__motionSelect`),true);assert.equal(await text('#scenePhysics2DAfter'),candidate);await evaluate(`document.querySelector('#scenePhysics2DMotion').scrollIntoView({block:'start'})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#scenePhysics2DDialog'),visible=id=>{const r=document.querySelector(id).getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};return{noOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,modeVisible:visible('#scenePhysics2DMotion'),checkVisible:visible('#scenePhysics2DCheck'),applyVisible:visible('#scenePhysics2DApply'),cancelVisible:visible('#scenePhysics2DCancel')};})()`);for(const check of Object.values(layout))assert.equal(check,true,JSON.stringify(layout));report.layout[language]=layout;await screenshot(`motion-${language}-390.png`);
    await evaluate(`document.querySelector('#scenePhysics2DGravity').scrollIntoView({block:'start'})`);assert.equal(await evaluate(`(()=>{const r=document.querySelector('#scenePhysics2DJumpSpeed').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`),true);await screenshot(`motion-values-${language}-390.png`);
  }
  report.steps.push('Chinese, English and Japanese at 390px preserve focused mode and exact review, with reachable numeric controls and Check/Apply/Cancel and no horizontal overflow.');
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await click('#scenePhysics2DApply');await wait(()=>evaluate(`!document.querySelector('#scenePhysics2DDialog').open`),'motion applied to draft');assert.equal(await value('#docSourceEditor'),visible(candidate));assert.deepEqual(await authorTree(f.author),initial);
  await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await fs.readFile(authorFile,'utf8')===candidate,'ordinary Save');const saved=await authorTree(f.author);assert.deepEqual(Object.keys(saved).filter(key=>saved[key]!==initial[key]),[f.physicsPath]);
  await open();assert.equal(await value('#scenePhysics2DMotion'),'platformer');assert.equal(await value('#scenePhysics2DJumpSpeed'),'120');await fill('#scenePhysics2DMotion','free');const disabled=JSON.parse((await review()).replace(/^\ufeff/,''));assert.equal(disabled.schemaVersion,3);assert.equal(disabled.bodies[0].collisionResponse,'slide');assert.equal(Object.hasOwn(disabled.bodies[0],'characterMotion'),false);
  // Confirm only discards this unsaved form review; it must not change saved author data.
  await click('#scenePhysics2DCancel');await wait(()=>evaluate(`!document.querySelector('#scenePhysics2DDialog').open`),'cancel motion-off review');assert.equal(await fs.readFile(authorFile,'utf8'),candidate);
  report.steps.push('Apply updates only the ordinary source draft. Save writes only the reviewed physics document. Reopen retains motion; disabling reviews removal without lowering schema or changing slide, and Cancel preserves the saved file.');
  await click('#projectBuildBtn');await enabled('#projectBuildScene');await fill('#projectBuildScene',f.assemblyId);await perform('#projectBuildPlan','plan');await perform('#projectBuildGenerate','build');const ran=await perform('#projectBuildHeadless','run');
  const observed=validateProjectPhysics2DObservation(ran.physics);assert.equal(observed.phase,'finished');assert.equal(observed.limited,false);assert.equal(observed.samples.length,30);
  const samples=observed.samples.filter(sample=>sample.instanceId===f.instanceId),jump=samples.find(sample=>sample.requestedMotion[1]<0),collision=samples.find(sample=>jump&&sample.sequence>jump.sequence&&sample.contacts.some(contact=>contact.normal[1]<-.99&&contact.collider));
  assert.ok(jump,'a grounded jump must request upward motion');assert.ok(jump.displacement[1]<0);assert.ok(collision,'the character must return to the floor');assert.equal(collision.response,'slide');assert.ok(collision.requestedMotion[1]>0);assert.ok(collision.displacement[1]<collision.requestedMotion[1]);const groundTravel=samples.find(sample=>sample.sequence<jump.sequence&&sample.displacement[0]>0&&sample.contacts.some(contact=>contact.normal[1]<-.99));assert.ok(groundTravel,'horizontal input must move along the floor before the jump');report.jump=jump;report.groundTravel=groundTravel;
  await panelVisible();await fill('#projectPhysicsObservationInstance',f.instanceId);await fill('#projectPhysicsObservationSample',String(collision.sequence));
  assert.equal(await evaluate(`document.querySelector('#projectPhysicsObservationDetail').dataset.sequence`),String(collision.sequence));
  const shown=await evaluate(`Array.from(document.querySelectorAll('#projectPhysicsObservationMotion dd'),e=>({text:e.textContent,exact:e.title}))`);assert.equal(shown[3].exact,`[${collision.requestedMotion.join(', ')}]`);assert.equal(shown[4].exact,`[${collision.displacement.join(', ')}]`);
  assert.match(await evaluate(`document.querySelector('#projectPhysicsObservationContacts').textContent`),new RegExp(collision.contacts[0].collider.bodyId));
  await evaluate(`document.querySelector('#projectPhysicsObservationDetail').scrollIntoView({block:'center'})`);await screenshot('physics-observation-desktop.png');
  report.sample=collision;report.steps.push('Real browser plan → Godot 0.24.0 build → finite headless run exposes 30 validated motion samples. A native grounded jump rises then lands; the floor sweep shows requested/actual displacement, collider, point and upward normal.');
  await fill('#projectPhysicsObservationStep',`${collision.visitIndex}:${collision.sceneId}:${collision.stepIndex}`);assert.equal(await evaluate(`document.querySelector('#projectPhysicsObservationSample').options.length`),1);await fill('#projectPhysicsObservationStep','');
  await click('#projectPhysicsObservationNext');assert.notEqual(await evaluate(`document.querySelector('#projectPhysicsObservationSample').value`),String(collision.sequence));await click('#projectPhysicsObservationPrevious');assert.equal(await evaluate(`document.querySelector('#projectPhysicsObservationSample').value`),String(collision.sequence));
  report.steps.push('Instance filtering, visit/step filtering and previous/next selection operate on the same admitted records without running commands or changing actor positions.');
  await click('.project-physics-collider-source');await wait(()=>evaluate(`!document.querySelector('#projectBuildDialog').open&&(await import('/web/modules/app-state.js')).appState.activePath.endsWith(${JSON.stringify(f.physicsPath)})`),'collider source navigation');
  const selection=await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return{start:e.selectionStart,end:e.selectionEnd,text:e.value.slice(e.selectionStart,e.selectionEnd)};})()`);assert.match(selection.text,new RegExp(collision.contacts[0].collider.bodyId));report.sourceSelection={collider:selection};
  await click('#projectBuildBtn');await panelVisible();await fill('#projectPhysicsObservationSample',String(collision.sequence));await click('#projectPhysicsObservationOpen');await wait(()=>evaluate(`!document.querySelector('#projectBuildDialog').open`),'character source navigation');
  const characterSelection=await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return{start:e.selectionStart,end:e.selectionEnd,text:e.value.slice(e.selectionStart,e.selectionEnd)};})()`);assert.match(characterSelection.text,new RegExp(collision.bodyId));report.sourceSelection.character=characterSelection;
  report.steps.push('Collider and character actions independently navigate to their exact /bodies/N source ranges in the same saved physics document.');
  const final=await state();assert.equal(final.job.id,ran.id);assert.deepEqual(final.job.physics,ran.physics);assert.deepEqual(final.job.runtime,ran.runtime);assert.deepEqual(await authorTree(f.author),saved);
  report.authorSnapshot={before:initial,afterSave:saved,after:await authorTree(f.author)};report.steps.push('Source navigation and observation filtering preserve the completed job, runtime snapshot and all author bytes after the one explicit physics Save.');
  assert.deepEqual(report.errors,[]);assert.ok(report.dialogs.every(message=>message.includes('丢弃本次物理表单修改')));for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,'Source changed during smoke: '+file);report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));}
