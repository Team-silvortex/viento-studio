// Real Chrome: ordinary planar intent TXT, explicit reference, two typed character bindings and three-language narrow layout.
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
import { scenePhysics2DPlatformControlAuthor } from './helpers/scene-physics2d-platform-control-author-fixture.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import '../adapters/node-studio-core.mjs';
const appRoot=fileURLToPath(new URL('../../',import.meta.url)),tool=process.env.VIENTO_GODOT_BIN;
if(!tool||!path.isAbsolute(tool))throw Error('Set VIENTO_GODOT_BIN to an absolute executable.');
const evidenceRoot=path.join(appRoot,'docs/test-results/scene-physics2d-planar-intent');
const output=path.resolve(process.env.VIENTO_PLANAR_INTENT_UI_OUTPUT||path.join(evidenceRoot,'browser-authoring'));
if(!output.startsWith(evidenceRoot+path.sep))throw Error('Use a fresh directory inside the planar intent evidence topic.');
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Use a new empty evidence directory.');
const report={startedAt:new Date().toISOString(),steps:[],screenshots:[],jobs:[],errors:[],dialogs:[],layout:{},limitations:[
  'Real Chrome with HTTP editor and disposable author files. This smoke verifies authoring only; native planar movement is not verified by this browser test.',
  'No installed Tauri, Android, Bevy, automatic physics-body creation, automatic binding, live parameter discovery or native execution is claimed.'
]};
const sources=['engine/godot-planar-intent-script.mjs','engine/script-authoring.mjs','web/modules/app-script-create.js','web/modules/app-scene-behavior-links.js','web/modules/app-scene-behaviors.js','web/script-create.css','web/scene-behaviors.css','web/i18n/en.js','web/i18n/ja.js','scripts/tests/planar-intent-authoring-smoke.mjs'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,buildHash(await fs.readFile(path.join(appRoot,name)))])));
report.node={version:process.version,sha256:buildHash(await fs.readFile(process.execPath))};report.tool={sha256:buildHash(await fs.readFile(tool))};
const cleanups=[],fixture={after:callback=>cleanups.push(callback)};
const wait=async(check,label,budget=45000)=>{for(const deadline=Date.now()+budget;Date.now()<deadline;){if(await check())return;await delay(100);}throw Error('Timed out: '+label);};
async function authorTree(root){const hashes={};for(const entry of await fs.readdir(root,{recursive:true,withFileTypes:true})){if(!entry.isFile())continue;const file=path.join(entry.parentPath||entry.path,entry.name),name=path.relative(root,file);if(name==='workspace.json'||/^(documents|metadata|templates|assets)\//.test(name))hashes[name]=buildHash(await fs.readFile(file));}return hashes;}
let socket,captureFailure;
try{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-physics-planar-intent-author-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
  const f=await scenePhysics2DPlatformControlAuthor(fixture,{consumers:false});
  await f.edit('documents/scenes/demo.json',scene=>{for(const actor of scene.actors)if([f.instanceId,f.otherInstanceId].includes(actor.instanceId))actor.controls='none';});
  await f.edit(f.physicsPath,physics=>{for(const body of physics.bodies)if([f.instanceId,f.otherInstanceId].includes(body.instanceId))delete body.characterMotion;});
  const manifestPath=f.manifestPath,manifestFile=path.join(f.author,manifestPath);
  const original=await fs.readFile(manifestFile,'utf8');let beforeBindings=JSON.parse(original).bindings;
  const physics=await f.read(f.physicsPath),firstBody=physics.bodies.find(body=>body.instanceId===f.instanceId),secondBody=physics.bodies.find(body=>body.instanceId===f.otherInstanceId);
  assert.equal(firstBody.kind,'character');assert.equal(secondBody.kind,'character');assert.notEqual(f.instanceId,f.otherInstanceId);assert.ok(!firstBody.characterMotion&&!secondBody.characterMotion);
  const firstParameters={left_action:'ui_left',right_action:'ui_right',up_action:'ui_up',down_action:'ui_down'};
  const secondParameters={left_action:'ui_right',right_action:'ui_left',up_action:'ui_up',down_action:'ui_down'};
  const env={...process.env,VIENTO_APP_ROOT:appRoot,VIENTO_WORKSPACE_ROOT:f.author,VIENTO_GODOT_BIN:tool,VIENTO_EXECUTION_BACKEND:'org.viento.godot4',XDG_CACHE_HOME:path.join(temporary,'cache'),XDG_CONFIG_HOME:path.join(temporary,'config')};delete env.VIENTO_SESSION_TOKEN;delete env.VIENTO_PREFERENCES_PATH;
  const rebuilt=await runCommand(process.execPath,[path.join(appRoot,'scripts/ops/rebuild.mjs')],{cwd:appRoot,env});assert.equal(rebuilt.code,0,JSON.stringify(rebuilt));
  const initial=await authorTree(f.author),base=await serve(fixture,appRoot,env);report.fixture={physicsPath:f.physicsPath,firstInstanceId:f.instanceId,secondInstanceId:f.otherInstanceId,firstBodyId:firstBody.id,secondBodyId:secondBody.id,manifestPath,firstParameters,secondParameters};
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

  captureFailure=async()=>{await screenshot('failure.png');report.pageFailure=await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value})`);report.serviceFailure=await state();};
  const perform=async(selector,kind)=>{const previous=(await state()).job?.id;await enabled(selector);await click(selector);let job;await wait(async()=>{job=(await state()).job;return job?.kind===kind&&job.id!==previous&&job.status!=='running';},kind+' completion',90000);report.jobs.push(job);assert.equal(job.status,'succeeded',JSON.stringify(job));return job;};
  await call('Runtime.enable');await call('Page.enable');report.browser=(await call('Browser.getVersion')).product;await call('Page.navigate',{url:`${base}/web/?mode=edit`});
  await wait(()=>evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable&&document.querySelector('#projectBuildBtn')?.hidden===false`),'editor startup');
  await wait(()=>evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.includes('scenes/demo'))`),'saved scene');
  const chooseScene=()=>evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scenes/demo')).click()`);
  await chooseScene();
  const value=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).value`),text=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  const scriptPath='documents/scripts/planar-intent-authored.txt',scriptFile=path.join(f.author,scriptPath),starter=listScriptStarters().find(item=>item.id==='godot-planar-intent'),audioStarter=listScriptStarters().find(item=>item.id==='godot-project-event-audio');
  assert.ok(starter&&audioStarter);for(const name of ['left_action','right_action','up_action','down_action'])assert.ok(starter.content.includes(name));assert.ok(starter.content.includes('viento_planar_intent'));
  const openScript=async()=>{await enabled('#scriptCreateBtn');await click('#scriptCreateBtn');await enabled('#scriptCreateApply');await fill('#scriptCreateStarter',starter.id);await fill('#scriptCreateType','character');await fill('#scriptCreatePath',scriptPath,'input');await enabled('#scriptCreateApply');};
  await openScript();assert.equal(await text('#scriptCreateSource'),starter.content);assert.deepEqual(await authorTree(f.author),initial);await screenshot('planar-intent-starter-desktop.png');
  for(const language of ['zh-CN','en','ja']){
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await evaluate(`(window.__starter=document.querySelector('#scriptCreateStarter'),window.__starter.focus())`);await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate(`document.querySelector('#scriptCreateStarter')===window.__starter&&document.activeElement===window.__starter`),true);assert.equal(await value('#scriptCreateStarter'),starter.id);assert.equal(await text('#scriptCreateSource'),starter.content);assert.equal(await value('#scriptCreatePath'),scriptPath);
    await evaluate(`document.querySelector('.script-create-body').scrollTop=0`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#scriptCreateDialog'),inside=id=>{const r=document.querySelector(id).getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};return{noOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,close:inside('#scriptCreateClose'),create:inside('#scriptCreateApply'),cancel:inside('#scriptCreateCancel'),label:document.querySelector('#scriptCreateStarter').selectedOptions[0].textContent};})()`);
    for(const key of ['noOverflow','close','create','cancel'])assert.equal(layout[key],true,JSON.stringify(layout));
    const description=await text('#scriptCreateDescription');assert.ok(description);if(language!=='zh-CN'){assert.notEqual(layout.label,starter.label);assert.notEqual(description,starter.description);} report.layout['script-'+language]={...layout,description};await screenshot(`planar-intent-starter-${language}-390.png`);
    await evaluate(`document.querySelector('.script-create-body').scrollTop=document.querySelector('.script-create-body').scrollHeight`);assert.equal(await evaluate(`(()=>{const p=document.querySelector('#scriptCreateSource'),b=document.querySelector('.script-create-body');return p.getBoundingClientRect().bottom<=b.getBoundingClientRect().bottom&&p.scrollWidth<=p.clientWidth;})()`),true);
    await fill('#scriptCreateStarter',audioStarter.id);assert.equal(await text('#scriptCreateSource'),audioStarter.content);assert.equal(await value('#scriptCreatePath'),scriptPath);await fill('#scriptCreateStarter',starter.id);
  }
  await click('#scriptCreateCancel');await wait(()=>evaluate(`!document.querySelector('#scriptCreateDialog').open`),'cancel script');assert.deepEqual(await authorTree(f.author),initial);
  report.steps.push('The planar intent and existing event-audio starter options show exact ordinary GDScript source in Chinese, English and Japanese at 390px. Mode, path, focus, source and reachable Create/Cancel controls persist; cancelling writes nothing.');
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);await openScript();await click('#scriptCreateApply');await wait(()=>evaluate(`(await import('/web/modules/app-state.js')).appState.isCreating`),'ordinary TXT draft');assert.equal(await value('#docSourceEditor'),starter.content);assert.deepEqual(await authorTree(f.author),initial);
  await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>{try{return await fs.readFile(scriptFile,'utf8')===starter.content;}catch{return false;}},'ordinary TXT Save');
  await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.isSaving&&!(await import('/web/modules/app-state.js')).appState.isRebuilding&&!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`),'TXT index refresh');
  const script=(await readRegistry(f.author)).documents.find(record=>record.sourcePath===scriptPath);assert.ok(script);const afterScript=await authorTree(f.author);
  assert.deepEqual(Object.keys(afterScript).filter(key=>afterScript[key]!==initial[key]).sort(),[scriptPath,`metadata/documents/${script.id}.json`].sort());for(const[key,hash]of Object.entries(initial))assert.equal(afterScript[key],hash);
  report.script={objectId:script.id,starterId:starter.id,sha256:buildHash(Buffer.from(starter.content))};report.steps.push('Create opens an ordinary unsaved TXT draft; Save adds exactly its source and registration while preserving all existing author files.');
  const registryBeforeLink=await readRegistry(f.author);
  await chooseScene();await enabled('#projectBuildBtn');await click('#projectBuildBtn');await enabled('#projectBuildScene');await fill('#projectBuildScene',f.sceneIds[0]);await enabled('#projectBuildManageBehavior');
  const openLinks=async()=>{await click('#projectBuildManageBehavior');await enabled('#sceneBehaviorLinksOpen');await fill('#sceneBehaviorLinksSource',script.id);await enabled('#sceneBehaviorLinksCheck');await click('#sceneBehaviorLinksCheck');await enabled('#sceneBehaviorLinksSave');};
  await openLinks();assert.deepEqual(await authorTree(f.author),afterScript);await click('#sceneBehaviorLinksCancel');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorLinksDialog').open`),'cancel link');assert.deepEqual(await authorTree(f.author),afterScript);
  await openLinks();await click('#sceneBehaviorLinksSave');await enabled('#sceneBehaviorLinksOpen');
  const afterLink=await authorTree(f.author),linkChanges=Object.keys(afterLink).filter(key=>afterLink[key]!==afterScript[key]);assert.equal(linkChanges.length,1);assert.match(linkChanges[0],/^metadata\/documents\/.*\.json$/);assert.equal(await fs.readFile(manifestFile,'utf8'),original);
  const registration=JSON.parse(await fs.readFile(path.join(f.author,linkChanges[0]),'utf8'));
  const previousRegistration=registryBeforeLink.documents.find(record=>record.id===registration.id);assert.ok(previousRegistration);
  const {relations:actualRelations,...actualRegistration}=registration,{relations:previousRelations,...oldRegistration}=previousRegistration;
  assert.deepEqual(actualRegistration,oldRegistration);assert.equal(actualRelations.length,previousRelations.length+1);
  for(const relation of previousRelations)assert.ok(actualRelations.some(item=>JSON.stringify(item)===JSON.stringify(relation)));
  assert.ok(actualRelations.some(relation=>relation.kind==='references'&&relation.targetId===script.id));
  await click('#sceneBehaviorLinksOpen');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorLinksDialog').open&&!document.querySelector('#projectBuildDialog').open`),'open behavior source');await enabled('#sceneBehaviorsBtn');
  const createBindingReview=async(instanceId,parameters)=>{
    await click('#sceneBehaviorsBtn');await enabled('#sceneBehaviorsAddBinding');await click('#sceneBehaviorsAddBinding');const bindingId=await value('#sceneBehaviorsBinding');assert.ok(!beforeBindings.some(binding=>binding.bindingId===bindingId));
    await fill('#sceneBehaviorsSource',script.id);await fill('#sceneBehaviorsInstance',instanceId);
    for(const[index,[name,parameter]]of Object.entries(parameters).entries()){
      await click('#sceneBehaviorsAddParameter');await fill(`#sceneBehaviorsParam${index}Name`,name,'input');await fill(`#sceneBehaviorsParam${index}Value`,parameter,'input');
    }
    await click('#sceneBehaviorsCheck');await enabled('#sceneBehaviorsApply');const candidate=await text('#sceneBehaviorsAfter'),parsed=JSON.parse(candidate),binding=parsed.bindings.find(row=>row.bindingId===bindingId);
    assert.deepEqual(parsed.bindings.slice(0,-1),beforeBindings);assert.equal(binding.instanceId,instanceId);assert.equal(binding.implementation.sourceObjectId,script.id);assert.deepEqual(binding.parameters,parameters);assert.deepEqual(binding.events,[]);
    return {bindingId,candidate,binding,bindings:parsed.bindings};
  };
  const cancelled=await createBindingReview(f.instanceId,firstParameters);await click('#sceneBehaviorsCancel');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`),'cancel planar binding');
  assert.equal(await value('#docSourceEditor'),original);assert.deepEqual(await authorTree(f.author),afterLink);
  const first=await createBindingReview(f.instanceId,firstParameters);assert.notEqual(first.bindingId,cancelled.bindingId);assert.deepEqual(await authorTree(f.author),afterLink);
  for(const language of ['zh-CN','en','ja']){
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await evaluate(`(window.__parameter=document.querySelector('#sceneBehaviorsParam0Value'),window.__parameter.focus(),window.__parameter.setSelectionRange(1,6))`);await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsParam0Value')===window.__parameter&&document.activeElement===window.__parameter&&window.__parameter.selectionStart===1&&window.__parameter.selectionEnd===6`),true);assert.equal(await text('#sceneBehaviorsAfter'),first.candidate);await evaluate(`document.querySelector('#sceneBehaviorsParam0Value').scrollIntoView({block:'center'})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneBehaviorsDialog'),inside=id=>{const r=document.querySelector(id).getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};return{noOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,parameter:inside('#sceneBehaviorsParam0Value'),apply:inside('#sceneBehaviorsApply'),cancel:inside('#sceneBehaviorsCancel')};})()`);for(const result of Object.values(layout))assert.equal(result,true,JSON.stringify(layout));report.layout['binding-'+language]=layout;await screenshot(`planar-intent-binding-${language}-390.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  const saveBinding=async(review,expectedTree)=>{
    await click('#sceneBehaviorsApply');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`),'binding applied to draft');assert.equal(await value('#docSourceEditor'),review.candidate);assert.deepEqual(await authorTree(f.author),expectedTree);
    await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await fs.readFile(manifestFile,'utf8')===review.candidate,'ordinary behavior Save');await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges&&!document.querySelector('#sceneBehaviorsBtn').disabled`),'behavior saved');
    const saved=await authorTree(f.author);assert.deepEqual(saved,{...expectedTree,[manifestPath]:buildHash(Buffer.from(review.candidate))});return saved;
  };
  const afterFirst=await saveBinding(first,afterLink);beforeBindings=first.bindings;
  const second=await createBindingReview(f.otherInstanceId,secondParameters);assert.deepEqual(await authorTree(f.author),afterFirst);const saved=await saveBinding(second,afterFirst);
  report.bindings=[{bindingId:first.bindingId,sourceId:script.id,instanceId:f.instanceId,parameters:firstParameters},{bindingId:second.bindingId,sourceId:script.id,instanceId:f.otherInstanceId,parameters:secondParameters}];
  for(const row of report.bindings){
    await click('#sceneBehaviorsBtn');await enabled('#sceneBehaviorsBinding');await fill('#sceneBehaviorsBinding',row.bindingId);
    assert.equal(await value('#sceneBehaviorsInstance'),row.instanceId);assert.equal(await value('#sceneBehaviorsSource'),script.id);
    for(const [index,[name,parameter]] of Object.entries(row.parameters).entries()){assert.equal(await value(`#sceneBehaviorsParam${index}Name`),name);assert.equal(await value(`#sceneBehaviorsParam${index}Type`),'string');assert.equal(await value(`#sceneBehaviorsParam${index}Value`),parameter);}
    await click('#sceneBehaviorsCheck');await wait(()=>evaluate(`document.querySelector('#sceneBehaviorsDialog').getAttribute('aria-busy')==='false'`),'unchanged binding check');assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsApply').disabled`),true);
    await click('#sceneBehaviorsClose');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`),'close reopened binding');assert.deepEqual(await authorTree(f.author),saved);
  }
  report.steps.push('The same saved ordinary TXT is explicitly referenced and bound to two independent character instances with four literal action parameters each. Cancel writes nothing; review and Apply change a draft; ordinary Save persists each binding; reopening restores both identities and all parameter values.');
  assert.deepEqual(await authorTree(f.author),saved);report.authorSnapshot={beforeCount:Object.keys(initial).length,afterCount:Object.keys(saved).length,
    unchangedExisting:Object.keys(initial).filter(key=>saved[key]===initial[key]).length,changedExisting:Object.keys(initial).filter(key=>saved[key]!==initial[key]).length,addedCount:Object.keys(saved).filter(key=>!Object.hasOwn(initial,key)).length};
  assert.deepEqual(report.errors,[]);for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,'Source changed during smoke: '+file);report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=String(error.stack).replaceAll(appRoot,'<repository>').replaceAll(os.homedir(),'<home>').replaceAll(os.tmpdir(),'<tmp>');console.error(report.failure);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2).replaceAll(appRoot,'<repository>').replaceAll(os.homedir(),'<home>').replaceAll(os.tmpdir(),'<tmp>')+'\n');console.log(JSON.stringify({ok:report.ok,output:'<evidence>/'+path.basename(output),steps:report.steps,failure:report.failure},null,2));}
