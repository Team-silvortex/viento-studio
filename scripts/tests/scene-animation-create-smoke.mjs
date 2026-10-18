// Real first-time animation creation, three-file commit/reconciliation and ordinary field editing.
// Only copied example author files and a fresh evidence directory are written.
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

const appRoot=fileURLToPath(new URL('../../',import.meta.url));
const evidenceRoot=path.join(appRoot,'docs/test-results/scene-animation-creation');
const output=path.resolve(process.env.VIENTO_ANIMATION_CREATION_OUTPUT||path.join(evidenceRoot,`browser-${Date.now()}`));
if(!output.startsWith(evidenceRoot+path.sep))throw Error('Choose a fresh output beneath the scene-animation-creation evidence directory.');
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('The evidence directory must be empty.');
const report={startedAt:new Date().toISOString(),steps:[],screenshots:[],errors:[],dialogs:[],layout:{},limitations:[
 'Actual Chrome using the local HTTP editor in a disposable copied animation workspace. No installed Tauri, Android or native window claim.',
 'Initial scene creation and backend runtime/delivery have separate evidence. This run checks first animation creation, exact three-file closure, reviewed source editing and ordinary saving.',
 'A real committed HTTP response is deliberately hidden from the UI once to verify read-only reconciliation without repeating the create command.'
]};
const sources=['engine/studio-core.wasm','engine/studio-modules.mjs','engine/scene-animation-create-plan.mjs','engine/scene-animation-creation-contract.mjs','engine/world-animation-create.mjs','engine/world-command-contract.mjs','scripts/lib/scene-animation-creation-service.mjs','scripts/lib/world-animation-create-transaction.mjs','scripts/lib/world-transactions.mjs','scripts/adapters/node-world-commands.mjs','scripts/lib/doc-api-service.mjs','scripts/lib/doc-server-routes.mjs','web/modules/app-scene-animation-create.js','web/scene-animation-create.css','web/modules/app-project-build.js','web/modules/app-doc-service.js','web/modules/app-scene-animation.js','web/modules/app-scene-animation-source.js','web/modules/app-runtime.js','web/i18n/en.js','web/i18n/ja.js','scripts/tests/scene-animation-create-smoke.mjs'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,buildHash(await fs.readFile(path.join(appRoot,name)))])));
report.node={version:process.version,sha256:buildHash(await fs.readFile(process.execPath))};
const cleanups=[],fixture={after:callback=>cleanups.push(callback)};
const wait=async(check,label,budget=45000)=>{for(let elapsed=0;elapsed<budget;elapsed+=100){if(await check())return;await delay(100);}throw Error('Timed out: '+label);};
async function authorTree(root){const hashes={};for(const entry of await fs.readdir(root,{recursive:true,withFileTypes:true})){if(!entry.isFile())continue;const file=path.join(entry.parentPath||entry.path,entry.name),name=path.relative(root,file);if(name==='workspace.json'||/^(documents|templates|metadata|assets)\//.test(name))hashes[name]=buildHash(await fs.readFile(file));}return hashes;}
let socket,captureFailure;
try{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-animation-create-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
 const root=path.join(temporary,'author'),download=path.join(temporary,'downloads');await fs.cp(path.join(appRoot,'examples/scene-animation'),root,{recursive:true});await fs.mkdir(download);
 const manifestPath='documents/animations/created-in-studio.json',manifestFile=path.join(root,manifestPath),sceneId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 const sceneMetadataPath=`metadata/documents/${sceneId}.json`;
 await fs.rm(path.join(root,'documents/animations/demo.json'));await fs.rm(path.join(root,'metadata/documents/88888888-8888-4888-8888-888888888887.json'));
 const sceneMetadata=JSON.parse(await fs.readFile(path.join(root,sceneMetadataPath),'utf8'));sceneMetadata.relations=sceneMetadata.relations.filter(relation=>relation.kind!=='animation');
 await fs.writeFile(path.join(root,sceneMetadataPath),(JSON.stringify(sceneMetadata,null,2)+'\n').replaceAll('\n','\r\n'));
 const env={...process.env,VIENTO_APP_ROOT:appRoot,VIENTO_WORKSPACE_ROOT:root,VIENTO_EXECUTION_BACKEND:'org.viento.godot4',XDG_CACHE_HOME:path.join(temporary,'cache'),XDG_CONFIG_HOME:path.join(temporary,'config')};
 delete env.VIENTO_SESSION_TOKEN;delete env.VIENTO_PREFERENCES_PATH;
 const rebuilt=await runCommand(process.execPath,[path.join(appRoot,'scripts/ops/rebuild.mjs')],{cwd:appRoot,env});assert.equal(rebuilt.code,0,JSON.stringify(rebuilt));
 const initial=await authorTree(root),base=await serve(fixture,appRoot,env),readSource=()=>fs.readFile(manifestFile,'utf8');
 const state=async()=>{const response=await fetch(`${base}/api/project-build`).then(value=>value.json());return response.data||response;};
 const profile=path.join(temporary,'chrome');await fs.mkdir(profile);
 const chrome=spawn(process.argv[2]||'/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--remote-debugging-port=0','--window-size=1440,1100','about:blank'],{stdio:'ignore'});
 cleanups.push(async()=>{if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}});
 let port;await wait(async()=>{try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];return Boolean(port);}catch{return false;}},'Chrome startup');
 const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(value=>value.json());socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);await once(socket,'open');
 const pending=new Map();let sequence=0;const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 socket.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id){const request=pending.get(value.id);pending.delete(value.id);value.error?request?.reject(Error(value.error.message)):request?.resolve(value.result);}else if(value.method==='Runtime.exceptionThrown')report.errors.push(value.params.exceptionDetails);else if(value.method==='Page.javascriptDialogOpening'){report.dialogs.push({type:value.params.type,message:value.params.message});void call('Page.handleJavaScriptDialog',{accept:true});}});
 const evaluate=async expression=>{const value=await call('Runtime.evaluate',{expression:`(async()=>(${expression}))()`,awaitPromise:true,returnByValue:true,userGesture:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
 const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const fill=(selector,value,event='input')=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
 const value=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
 const enabled=selector=>wait(()=>evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled===false&&!document.querySelector(${JSON.stringify(selector)}).hidden`),selector+' enabled');
 const screenshot=async name=>{const image=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,name),Buffer.from(image.data,'base64'));report.screenshots.push(name);};
 const visible=content=>content.replace(/\r\n?/g,'\n');
 captureFailure=async()=>{await screenshot('failure.png');report.pageFailure=await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,system:(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()})`);report.serviceFailure=await state();};
 await call('Runtime.enable');await call('Page.enable');report.browser=(await call('Browser.getVersion')).product;
 await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:download,eventsEnabled:true});
 await call('Page.navigate',{url:`${base}/web/?mode=edit`});
 await wait(()=>evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`),'editor startup');
 await wait(()=>evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.includes('scenes/demo'))`),'saved scene in sidebar');
 await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scenes/demo')).click()`);
 await evaluate(`(()=>{window.__animationCreates=[];window.__dropAnimationApply=false;window.__holdAnimationRead=false;window.__animationReads=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const hold=window.__holdAnimationRead&&String(input).includes('/api/scene-animation-creation');const response=await original(input,init);let body;try{body=JSON.parse(init?.body||'null')}catch{};if(hold)await new Promise(resolve=>window.__animationReads.push(resolve));if(body?.command==='animation.create'){const result=await response.clone().json();window.__animationCreates.push({request:body,result:result.data||result});if(body.mode==='apply'&&window.__dropAnimationApply){window.__dropAnimationApply=false;throw Error('Injected lost committed response');}}return response;};})()`);
 await enabled('#projectBuildBtn');await click('#projectBuildBtn');await enabled('#projectBuildSceneAnimation');
 const open=async()=>{await enabled('#projectBuildSceneAnimation');await click('#projectBuildSceneAnimation');await enabled('#sceneAnimationCreateDuration');};
 const edit=async()=>{assert.equal(await value('#sceneAnimationCreateType'),'animation');await fill('#sceneAnimationCreatePath',manifestPath);await fill('#sceneAnimationCreateInstance','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','change');await fill('#sceneAnimationCreateProperty','scale2d','change');assert.equal(await value('#sceneAnimationCreateEndX'),'2');await fill('#sceneAnimationCreateProperty','rotation2d','change');assert.equal(await value('#sceneAnimationCreateEndX'),'90');await fill('#sceneAnimationCreateProperty','opacity','change');assert.equal(await value('#sceneAnimationCreateEndX'),'0');await fill('#sceneAnimationCreateProperty','offset2d','change');await fill('#sceneAnimationCreateEndX','120');await fill('#sceneAnimationCreateEndY','40');await fill('#sceneAnimationCreateDuration','3');await fill('#sceneAnimationCreateLoop','true','change');};
 const review=async()=>{await enabled('#sceneAnimationCreateCheck');await click('#sceneAnimationCreateCheck');await enabled('#sceneAnimationCreateSave');return evaluate(`document.querySelector('#sceneAnimationCreateSourceText').textContent`);};
 await evaluate('window.__holdAnimationRead=true');await click('#projectBuildSceneAnimation');await wait(()=>evaluate('window.__animationReads.length===1'),'held real catalog');await click('#sceneAnimationCreateCancel');
 await evaluate('(window.__holdAnimationRead=false,window.__animationReads.shift()())');await delay(100);assert.equal(await evaluate("document.querySelector('#sceneAnimationCreateDialog').open"),false);assert.deepEqual(await authorTree(root),initial);
 report.steps.push('Cancel remains available while the real directory request is pending. Releasing its late response cannot reopen the creator or write author files.');
 await open();await edit();const first=await review(),firstRequest=await evaluate(`window.__animationCreates.at(-1).request`);
 const firstModel=JSON.parse(first);assert.equal(firstModel.tracks.length,1);assert.equal(firstModel.tracks[0].instanceId,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');assert.deepEqual(firstModel.tracks[0].keyframes,[{atSeconds:0,value:[0,0]},{atSeconds:3,value:[120,40]}]);assert.deepEqual(await authorTree(root),initial);await screenshot('animation-create-review-desktop.png');
 const targetOptions=await evaluate("Array.from(document.querySelector('#sceneAnimationCreateInstance').options).map(option=>({value:option.value,label:option.textContent}))");assert.equal(targetOptions.length,2);assert.ok(targetOptions.every(option=>option.label.includes(option.value)));report.targetOptions=targetOptions;
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 for(const language of ['zh-CN','en','ja']){
  await evaluate("(window.__animationDuration=document.querySelector('#sceneAnimationCreateDuration'),window.__animationDuration.focus(),window.__animationDuration.setSelectionRange(0,1))");
  await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
  assert.equal(await evaluate("document.querySelector('#sceneAnimationCreateDuration')===window.__animationDuration&&document.activeElement===window.__animationDuration&&window.__animationDuration.selectionStart===0&&window.__animationDuration.selectionEnd===1"),true);
  await evaluate(`document.querySelector('.scene-animation-create-body').scrollTop=0`);
  const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneAnimationCreateDialog'),rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right};};return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,close:rect('#sceneAnimationCreateClose'),check:rect('#sceneAnimationCreateCheck'),save:rect('#sceneAnimationCreateSave'),cancel:rect('#sceneAnimationCreateCancel'),title:document.querySelector('#sceneAnimationCreateTitle').textContent,bodyScrollable:document.querySelector('.scene-animation-create-body').scrollHeight>document.querySelector('.scene-animation-create-body').clientHeight};})()`);
  assert.equal(layout.noHorizontalOverflow,true);assert.equal(layout.bodyScrollable,true);for(const action of ['close','check','save','cancel'])assert.ok(layout[action].top>=0&&layout[action].bottom<=844&&layout[action].left>=0&&layout[action].right<=390,JSON.stringify(layout));
  assert.equal(await value('#sceneAnimationCreateDuration'),'3');assert.equal(await value('#sceneAnimationCreateLoop'),'true');assert.equal(await value('#sceneAnimationCreateEndX'),'120');assert.equal(await value('#sceneAnimationCreateEndY'),'40');
  assert.equal(await evaluate(`document.querySelector('#sceneAnimationCreateSave').disabled`),false);assert.equal(await evaluate(`document.querySelector('#sceneAnimationCreateSourceText').textContent`),first);
  report.layout[language]=layout;await screenshot(`animation-create-${language}-390.png`);
  await evaluate(`document.querySelector('#sceneAnimationCreateDuration').scrollIntoView({block:'center'})`);await screenshot(`animation-create-${language}-390-fields.png`);
 }
 await fill('#sceneAnimationCreateDuration','1e-');await evaluate("(window.__animationDuration.focus(),window.__animationDuration.setSelectionRange(1,2))");await evaluate("(await import('/web/i18n/index.js')).applyLanguage('en')");assert.equal(await value('#sceneAnimationCreateDuration'),'1e-');assert.equal(await evaluate('document.activeElement===window.__animationDuration&&window.__animationDuration.selectionStart===1&&window.__animationDuration.selectionEnd===2'),true);
 await click('#sceneAnimationCreateCancel');await wait(()=>evaluate(`!document.querySelector('#sceneAnimationCreateDialog').open`),'creation cancelled');assert.deepEqual(await authorTree(root),initial);
 report.steps.push('Four channel presets set valid endpoint defaults. One stable instance and one track with identity/end keys are reviewed alongside both relations. Chinese, English and Japanese at 390px preserve focus, selection, unfinished inputs and approved source. Cancelling writes no author files.');
 await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
 await open();await edit();const createdSource=await review(),createdRequest=await evaluate(`window.__animationCreates.at(-1).request`);
 assert.notEqual(createdRequest.objectId,firstRequest.objectId);await evaluate('window.__dropAnimationApply=true');await click('#sceneAnimationCreateSave');await wait(()=>evaluate("document.querySelector('#sceneAnimationCreateDialog').getAttribute('aria-busy')==='false'&&document.querySelector('#sceneAnimationCreateStatus').textContent.includes('尚未确认')"),'uncertain committed response');
 assert.equal(await readSource(),createdSource);const created=await authorTree(root),manifestMetadataPath=`metadata/documents/${createdRequest.objectId}.json`;
 assert.deepEqual(Object.keys(created).filter(name=>created[name]!==initial[name]).sort(),[manifestPath,manifestMetadataPath,sceneMetadataPath].sort());
 for(const [name,hash]of Object.entries(initial))if(name!==sceneMetadataPath)assert.equal(created[name],hash,name);
 const registration=JSON.parse(await fs.readFile(path.join(root,manifestMetadataPath),'utf8')),sceneRegistration=JSON.parse(await fs.readFile(path.join(root,sceneMetadataPath),'utf8'));
 assert.deepEqual(registration.assetBindings,[]);assert.deepEqual(registration.relations,[{kind:'references',targetId:sceneId,slot:''}]);assert.equal(sceneRegistration.relations.filter(item=>item.kind==='animation').length,1);assert.equal(sceneRegistration.relations.find(item=>item.kind==='animation').targetId,createdRequest.objectId);
 assert.equal(await evaluate("document.querySelector('#sceneAnimationCreateSave').disabled&&document.querySelector('#sceneAnimationCreateOpen').disabled"),true);const commandCount=await evaluate('window.__animationCreates.length');
 await click('#sceneAnimationCreateRefresh');await enabled('#sceneAnimationCreateOpen');assert.equal(await evaluate('window.__animationCreates.length'),commandCount);assert.equal(await evaluate("document.querySelector('#sceneAnimationCreateDialog').dataset.dirty"),'false');
 report.creation={objectId:createdRequest.objectId,changedAuthorPaths:[manifestPath,manifestMetadataPath,sceneMetadataPath],request:createdRequest,receipt:await evaluate(`window.__animationCreates.at(-1).result`),reconciledWithoutResend:true};
 await screenshot('animation-create-committed.png');
 report.steps.push('One Save creates exactly the reviewed animation source, its registration and the scene relation; all scene source and other author bytes remain unchanged. A deliberately lost committed response leaves Save disabled; rereading confirms the exact identity/source/relations without another create command.');
 await click('#sceneAnimationCreateOpen');await wait(()=>evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`),'open newly saved animation source');await enabled('#sceneAnimationBtn');assert.equal(await value('#docSourceEditor'),visible(createdSource));
 await click('#sceneAnimationBtn');await enabled('#sceneAnimationTrack0Key1X');await enabled('#sceneAnimationTrack0Target');await fill('#sceneAnimationTrack0Key1X','160');await click('#sceneAnimationCheck');await enabled('#sceneAnimationApply');const candidate=await evaluate(`document.querySelector('#sceneAnimationAfter').textContent`);
 await click('#sceneAnimationApply');await wait(()=>evaluate(`!document.querySelector('#sceneAnimationDialog').open`),'field edit applied');assert.deepEqual(await authorTree(root),created);assert.equal(await value('#docSourceEditor'),visible(candidate));
 await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readSource()===candidate,'ordinary animation save');
 await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.isSaving&&!(await import('/web/modules/app-state.js')).appState.isRebuilding&&!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`),'ordinary save complete');
 const after=await authorTree(root);assert.deepEqual(after,{...created,[manifestPath]:buildHash(Buffer.from(candidate))});
 const authored=JSON.parse(candidate);assert.deepEqual(authored.tracks[0].keyframes,[{atSeconds:0,value:[0,0]},{atSeconds:3,value:[160,40]}]);assert.equal(authored.tracks[0].id,JSON.parse(createdSource).tracks[0].id);
 report.saved={sourceSha256:buildHash(Buffer.from(candidate)),onlyChangedAuthorPath:manifestPath,tracks:authored.tracks};await screenshot('animation-created-field-edit.png');
 report.steps.push('Opening the newly created source enters the existing editor. Independent keyframe Check and Apply update only the unsaved draft; ordinary Save changes exactly that animation JSON and preserves the track identity.');
 await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scenes/demo')).click()`);
 await enabled('#projectBuildBtn');await click('#projectBuildBtn');await enabled('#projectBuildSceneAnimation');await click('#projectBuildSceneAnimation');await enabled('#sceneAnimationCreateOpen');
 assert.equal(await evaluate(`document.querySelector('#sceneAnimationCreateFields').hidden`),true);assert.equal(await evaluate('window.__animationCreates.length'),commandCount);assert.deepEqual(await authorTree(root),after);await screenshot('animation-existing-entry.png');await click('#sceneAnimationCreateClose');assert.equal(await value('#projectBuildScene'),sceneId);
 report.steps.push('Reopening scene animation resolves the existing document, offers source editing and keeps the selected scene without allocating or creating another manifest.');
 assert.deepEqual(report.errors,[]);for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));}
