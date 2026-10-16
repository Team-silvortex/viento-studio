// Bound track resource replacement, ordinary save and real Godot engineering delivery.
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
import { sampleSceneAudio } from '../../engine/scene-audio-core.mjs';
import { verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';

const appRoot=fileURLToPath(new URL('../../',import.meta.url));
const evidenceRoot=path.join(appRoot,'docs/test-results/scene-audio-resource-selection');
const output=path.resolve(process.env.VIENTO_SCENE_AUDIO_RESOURCE_OUTPUT||path.join(evidenceRoot,`browser-${Date.now()}`));
if(!output.startsWith(evidenceRoot+path.sep))throw Error('Choose a fresh output beneath the scene-audio-resource-selection evidence directory.');
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('The evidence directory must be empty.');
const tool=process.env.VIENTO_GODOT_BIN;if(!tool||!path.isAbsolute(tool))throw Error('Set VIENTO_GODOT_BIN to a trusted absolute Godot executable.');
const report={startedAt:new Date().toISOString(),steps:[],screenshots:[],jobs:[],errors:[],dialogs:[],layout:{},limitations:[
 'Actual Chrome using the local HTTP editor and trusted native Godot. No installed Tauri window, native file picker, Android or other desktop OS claim.',
 'The bundled scene-audio example is copied into a disposable workspace. An additional generated WAV is registered in the disposable fixture; existing World UI binds it, then both tracks select it through the audio editor. Track and cue identities remain intact. Catalog metadata does not verify audio bytes; build does.',
 'Godot runs bounded headless logic with three audio commands. This browser workflow makes no speaker or audible-output claim; native PCM mixer capture is verified separately.',
 'Generated project ZIP is downloaded by Chrome, independently verified, extracted and run at a new path. It is source-engineering delivery, not a standalone game executable.'
]};
const sources=['crates/viento-studio-core/src/scene_audio.rs','crates/viento-studio-core/src/lib.rs','engine/studio-core.mjs','engine/studio-core.wasm','engine/scene-audio-core.mjs','engine/scene-audio.mjs','engine/scene-audio-edit.mjs','engine/scene-audio-resources.mjs','engine/scene-audio-creation-contract.mjs','scripts/lib/scene-audio-creation-service.mjs','engine/scene-audio-events.mjs','engine/backend-capabilities.mjs','engine/project-build-contract.mjs','engine/studio-modules.mjs','scripts/adapters/node-build-snapshot.mjs','scripts/adapters/node-project-build.mjs','scripts/backends/godot4-audio.mjs','scripts/backends/godot4/audio-runtime.gd','scripts/backends/godot4-adapter.mjs','web/modules/app-scene-audio.js','web/scene-audio.css','web/modules/app-scene-audio-source.js','web/modules/app-studio-system.js','web/modules/app-runtime.js','web/modules/app-project-build.js','web/i18n/en.js','web/i18n/ja.js','scripts/tests/scene-audio-resource-smoke.mjs'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,buildHash(await fs.readFile(path.join(appRoot,name)))])));
report.node={version:process.version,sha256:buildHash(await fs.readFile(process.execPath))};report.tool={sha256:buildHash(await fs.readFile(tool))};
const cleanups=[],fixture={after:callback=>cleanups.push(callback)};
const wait=async(check,label,budget=45000)=>{for(let elapsed=0;elapsed<budget;elapsed+=100){if(await check())return;await delay(100);}throw Error('Timed out: '+label);};
async function authorTree(root){const hashes={};for(const entry of await fs.readdir(root,{recursive:true,withFileTypes:true})){if(!entry.isFile())continue;const file=path.join(entry.parentPath||entry.path,entry.name),name=path.relative(root,file);if(name==='workspace.json'||/^(documents|templates|metadata|assets)\//.test(name))hashes[name]=buildHash(await fs.readFile(file));}return hashes;}
let socket,captureFailure;
try{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-audio-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
 const root=path.join(temporary,'author'),download=path.join(temporary,'downloads');await fs.cp(path.join(appRoot,'examples/scene-audio'),root,{recursive:true});await fs.mkdir(download);
 const manifestPath='documents/audio/demo.json',manifestFile=path.join(root,manifestPath),sceneId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 const newResource='12345678-1111-4111-8111-000000000001',audioId='88888888-8888-4888-8888-888888888888';
 const wav=await fs.readFile(path.join(root,'assets/tone.wav'));for(let i=44;i<wav.length;i+=2)wav.writeInt16LE(-wav.readInt16LE(i),i);
 await fs.writeFile(path.join(root,'assets/replacement.wav'),wav);
 const asset=JSON.parse(await fs.readFile(path.join(root,'metadata/assets/99999999-9999-4999-8999-999999999999.json')));
 await fs.writeFile(path.join(root,`metadata/assets/${newResource}.json`),JSON.stringify({...asset,id:newResource,name:'Replacement tone',location:{store:'main',path:'replacement.wav'},content:{size:wav.length,sha256:buildHash(wav)},legacyPaths:['assets/replacement.wav']},null,2)+'\n');
 const beforeBinding=await authorTree(root);
 const env={...process.env,VIENTO_APP_ROOT:appRoot,VIENTO_WORKSPACE_ROOT:root,VIENTO_GODOT_BIN:tool,VIENTO_EXECUTION_BACKEND:'org.viento.godot4',XDG_CACHE_HOME:path.join(temporary,'cache'),XDG_CONFIG_HOME:path.join(temporary,'config')};
 delete env.VIENTO_SESSION_TOKEN;delete env.VIENTO_PREFERENCES_PATH;
 const rebuilt=await runCommand(process.execPath,[path.join(appRoot,'scripts/ops/rebuild.mjs')],{cwd:appRoot,env});assert.equal(rebuilt.code,0,JSON.stringify(rebuilt));
 let initial=await authorTree(root);const base=await serve(fixture,appRoot,env),readSource=()=>fs.readFile(manifestFile,'utf8');
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
 await wait(()=>evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.includes('audio/demo'))`),'saved audio in sidebar');
 await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('audio/demo')).click()`);
 // Bind through the existing metadata workflow before opening the audio source.
 await enabled('#worldBrowserBtn');await click('#worldBrowserBtn');await enabled('#worldClose');
 const objectButton=`Array.from(document.querySelectorAll('#worldObjects button')).find(button=>button.textContent.includes('documents/audio/demo.json'))`;
 await wait(()=>evaluate(`(${objectButton})?.disabled===false`),'audio World object');await evaluate(`(${objectButton}).click()`);
 await enabled('#worldResourceAdd');await click('#worldResourceAdd');await fill('#worldResourceTarget',newResource,'change');await fill('#worldResourceSlot','audio');
 await enabled('#worldResourcePreview');await click('#worldResourcePreview');await enabled('#worldResourceApply');await screenshot('audio-binding-preview.png');
 assert.deepEqual(await authorTree(root),initial);await click('#worldResourceApply');
 await wait(()=>evaluate(`!document.querySelector('#worldResourceApply')&&document.querySelector('#worldResourceAdd')?.disabled===false`),'binding saved');
 await click('#worldClose');
 const boundPath=`metadata/documents/${audioId}.json`,bound=JSON.parse(await fs.readFile(path.join(root,boundPath)));
 assert.deepEqual(bound.assetBindings.map(row=>row.assetId),[asset.id,newResource]);
 initial=await authorTree(root);assert.deepEqual(initial,{...beforeBinding,[boundPath]:initial[boundPath]});report.binding={path:boundPath,before:beforeBinding[boundPath],after:initial[boundPath],assetId:newResource};
 report.steps.push('Existing World resource binding previews without writes, then saves exactly one audio metadata file. Source and both WAV files stay unchanged; this saved binding is separate from subsequent source editing.');
 await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('audio/demo')).click()`);
 await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`),'ordinary audio edit');
 await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');await enabled('#sceneAudioBtn');
 const original=await readSource();assert.equal(await value('#docSourceEditor'),visible(original));
 const open=async()=>{await enabled('#sceneAudioBtn');await click('#sceneAudioBtn');await enabled('#sceneAudioTrack0Volume');};
 const originalModel=JSON.parse(original),trackIds=originalModel.tracks.map(row=>row.id),cueIds=originalModel.cues.map(row=>row.id);
 const edit=async()=>{
  await enabled('#sceneAudioLoadResources');await click('#sceneAudioLoadResources');await enabled('#sceneAudioTrack0Resource');
  assert.deepEqual(new Set(await evaluate(`Array.from(document.querySelector('#sceneAudioTrack0Resource').options,o=>o.value)`)),new Set([asset.id,newResource]));
  await fill('#sceneAudioTrack0Resource',newResource,'change');await fill('#sceneAudioTrack1Resource',newResource,'change');
  await fill('#sceneAudioTrack0Volume','0.2');await fill('#sceneAudioTrack1Volume','0.15');
 };
 const review=async()=>{await enabled('#sceneAudioCheck');await click('#sceneAudioCheck');await enabled('#sceneAudioApply');return evaluate(`document.querySelector('#sceneAudioAfter').textContent`);};
 await open();await edit();const first=await review();
 assert.equal(await evaluate(`document.querySelector('#sceneAudioBefore').textContent`),original);assert.deepEqual(await authorTree(root),initial);assert.equal(await value('#docSourceEditor'),visible(original));
 await screenshot('audio-review-desktop.png');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 for(const language of ['zh-CN','en','ja']){
  await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);await evaluate(`document.querySelector('.scene-audio-body').scrollTop=0`);
  const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneAudioDialog'),rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right};};return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,close:rect('#sceneAudioClose'),check:rect('#sceneAudioCheck'),apply:rect('#sceneAudioApply'),cancel:rect('#sceneAudioCancel'),title:document.querySelector('#sceneAudioTitle').textContent,bodyScrollable:document.querySelector('.scene-audio-body').scrollHeight>document.querySelector('.scene-audio-body').clientHeight};})()`);
  assert.equal(layout.noHorizontalOverflow,true);assert.equal(layout.bodyScrollable,true);for(const action of ['close','check','apply','cancel'])assert.ok(layout[action].top>=0&&layout[action].bottom<=844&&layout[action].left>=0&&layout[action].right<=390,JSON.stringify(layout));
  assert.equal(await value('#sceneAudioTrack0Volume'),'0.2');assert.equal(await value('#sceneAudioTrack1Volume'),'0.15');assert.equal(await value('#sceneAudioTrack0Resource'),newResource);assert.equal(await value('#sceneAudioTrack1Resource'),newResource);
  assert.equal(await evaluate(`document.querySelector('#sceneAudioApply').disabled`),false);assert.equal(await evaluate(`document.querySelector('#sceneAudioAfter').textContent`),first);
  report.layout[language]=layout;await screenshot(`audio-${language}-390.png`);
  await evaluate(`document.querySelector('#sceneAudioTrack1Resource').scrollIntoView({block:'center'})`);
  const field=await evaluate(`(()=>{const r=document.querySelector('#sceneAudioTrack1Resource').getBoundingClientRect(),b=document.querySelector('.scene-audio-body').getBoundingClientRect();return{visible:r.top>=b.top&&r.bottom<=b.bottom,withinWidth:r.left>=0&&r.right<=390};})()`);assert.deepEqual(field,{visible:true,withinWidth:true});report.layout[language].lastTrack=field;await screenshot(`audio-${language}-390-resources.png`);
 }
 await click('#sceneAudioCancel');await wait(()=>evaluate(`!document.querySelector('#sceneAudioDialog').open`),'audio form cancelled');assert.deepEqual(await authorTree(root),initial);assert.equal(await value('#docSourceEditor'),visible(original));
 report.steps.push('Both tracks choose the bound replacement WAV while retaining identities/cues. Chinese, English and Japanese at 390px retain selection and volume; Cancel leaves the source draft and author tree unchanged, including the separately saved metadata binding.');
 await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
 await open();await edit();const candidate=await review();assert.equal(candidate,first);await click('#sceneAudioApply');await wait(()=>evaluate(`!document.querySelector('#sceneAudioDialog').open`),'audio changes applied to draft');
 assert.equal(await value('#docSourceEditor'),visible(candidate));assert.deepEqual(await authorTree(root),initial);assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`),true);await screenshot('audio-unsaved-draft.png');
 await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readSource()===candidate,'ordinary save writes exact reviewed audio source');
 await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.isSaving&&!(await import('/web/modules/app-state.js')).appState.isRebuilding&&!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`),'ordinary save complete');
 const after=await authorTree(root);assert.deepEqual(after,{...initial,[manifestPath]:buildHash(Buffer.from(candidate))});
 const authored=JSON.parse(candidate.replace(/^\ufeff/,''));assert.deepEqual(authored.tracks.map(t=>[t.id,t.resourceId,t.role,t.volume,t.loop]),[[trackIds[0],newResource,'music',.2,true],[trackIds[1],newResource,'effect',.15,false]]);
 assert.deepEqual(authored.cues,originalModel.cues);assert.deepEqual(authored.tracks.map(t=>t.id),trackIds);
 const sample=sampleSceneAudio(authored,.5);assert.deepEqual(sample.commands.map(c=>[c.trackId,c.action]),authored.cues.map(c=>[c.trackId,c.action]));report.sample=sample;
 report.saved={beforeSha256:buildHash(Buffer.from(original)),afterSha256:buildHash(Buffer.from(candidate)),onlyChangedAuthorPath:manifestPath,tracks:authored.tracks,cues:authored.cues};
 report.steps.push('Apply changes only the ordinary unsaved source draft. Ordinary Save updates exactly the reviewed audio JSON; metadata, scene, referenced WAV and other author files remain byte-identical.');
 await open();assert.equal(await evaluate(`document.querySelectorAll('.scene-audio-track').length`),2);assert.equal(await value('#sceneAudioTrack1Volume'),'0.15');await enabled('#sceneAudioLoadResources');await click('#sceneAudioLoadResources');await enabled('#sceneAudioTrack0Resource');assert.equal(await value('#sceneAudioTrack0Resource'),newResource);assert.equal(await value('#sceneAudioTrack1Resource'),newResource);assert.equal(await evaluate(`document.querySelector('#sceneAudioCheck').disabled`),true);await screenshot('audio-resources-reopened.png');await click('#sceneAudioCancel');assert.deepEqual(await authorTree(root),after);
 report.steps.push('Saved audio reopens with both original track identities and cue bindings, the selected replacement resource and independent volumes. The old WAV remains in author assets and metadata.');
 await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scenes/demo')).click()`);
 await enabled('#projectBuildBtn');await click('#projectBuildBtn');await enabled('#projectBuildPlan');assert.equal(await value('#projectBuildScene'),sceneId);
 async function perform(selector,kind){const previous=(await state()).job?.id;await enabled(selector);await click(selector);let job;await wait(async()=>{job=(await state()).job;return job?.kind===kind&&job.id!==previous&&job.status!=='running';},kind,90000);report.jobs.push(job);assert.equal(job.status,'succeeded',JSON.stringify(job));return job;}
 const planned=await perform('#projectBuildPlan','plan'),built=await perform('#projectBuildGenerate','build'),ran=await perform('#projectBuildHeadless','run');
 const audioEvents=ran.events.filter(event=>event.event==='audio'),commands=audioEvents.filter(event=>event.audioEvent==='command');
 assert.equal(commands.length,3);assert.deepEqual(commands.map(frame=>[frame.cueId,frame.trackId,frame.atSeconds,frame.action]),authored.cues.map(cue=>[cue.id,cue.trackId,cue.atSeconds,cue.action]));
 assert.equal(audioEvents[0].audioEvent,'ready');assert.deepEqual(audioEvents[0].trackIds,authored.tracks.map(t=>t.id));assert.equal(audioEvents.at(-1).audioEvent,'finished');assert.equal(audioEvents.at(-1).timeSeconds,.5);assert.equal(ran.events.at(-1).event,'finished');assert.deepEqual(ran.diagnostics||[],[]);
 report.audioEvents=audioEvents;report.plan=planned.plan;await screenshot('audio-godot-run.png');
 report.steps.push('The same scene plans, builds and runs through real Godot. The host validates both original tracks and three original cue commands with the replacement resource: music play, effect play and music stop, with independent actor/audio completion.');
 await evaluate(`(()=>{window.__audioDeliveries=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const response=await original(input,init);let body;try{body=JSON.parse(init?.body||'null')}catch{};if(body?.kind==='backend-project'){const result=await response.clone().json();window.__audioDeliveries.push(result.data||result);}return response;};})()`);
 await enabled('#backendProjectInspect');await click('#backendProjectInspect');await enabled('#backendProjectDeliver');await click('#backendProjectDeliver');await enabled('#backendDeliveryPrepare');await click('#backendDeliveryPrepare');await enabled('#backendDeliveryDownload');
 const receipt=await evaluate(`window.__audioDeliveries.at(-1)`);assert.equal(receipt.delivery.project.buildId,built.buildId);await screenshot('audio-engineering-delivery.png');
 await click('#backendDeliveryDownload');await wait(()=>evaluate(`!document.querySelector('#backendDeliveryDownload').disabled`),'download starts');await click('#backendDeliveryClose');
 const archive=path.join(download,receipt.fileName);await wait(async()=>{try{return(await fs.stat(archive)).size===receipt.bytes;}catch{return false;}},'browser ZIP completes');
 const verified=await verifyBackendProjectDelivery(archive),extraction=path.join(temporary,'delivered');await fs.mkdir(extraction);const unzip=await runCommand('unzip',['-q',archive,'-d',extraction],{cwd:temporary});assert.equal(unzip.code,0,JSON.stringify(unzip));
 const project=path.join(extraction,'project'),deliveredAudio=JSON.parse(await fs.readFile(path.join(project,'audio.json'),'utf8'));assert.deepEqual(deliveredAudio.tracks.map(t=>[t.id,t.resourceId,t.volume,t.loop]),authored.tracks.map(t=>[t.id,t.resourceId,t.volume,t.loop]));
 assert.equal(verified.assetCount,1);assert.deepEqual(await fs.readFile(path.join(project,deliveredAudio.tracks[0].file)),await fs.readFile(path.join(root,'assets/replacement.wav')));
 const imported=await runCommand(tool,['--headless','--editor','--path',project,'--import','--quit'],{cwd:temporary,env});assert.equal(imported.code,0,JSON.stringify(imported));assert.doesNotMatch(imported.stdout+imported.stderr,/SCRIPT ERROR|Parse Error/);
 const relocated=await runCommand(tool,['--headless','--path',project,'--','--viento-smoke'],{cwd:temporary,env});assert.equal(relocated.code,0,JSON.stringify(relocated));assert.doesNotMatch(relocated.stdout+relocated.stderr,/SCRIPT ERROR|Parse Error/);
 const relocatedFrames=relocated.stdout.split('\n').filter(line=>line.startsWith('VIENTO_AUDIO:')).map(line=>JSON.parse(line.slice('VIENTO_AUDIO:'.length)));
 assert.deepEqual(relocatedFrames.map(frame=>({...frame,protocol:ran.events[0].protocol,event:'audio',audioEvent:frame.event})),audioEvents);
 report.delivery={fileName:receipt.fileName,bytes:receipt.bytes,sha256:buildHash(await fs.readFile(archive)),fileCount:verified.fileCount,assetCount:verified.assetCount,buildId:receipt.delivery.project.buildId,projectKind:receipt.delivery.project.project.kind,importCode:imported.code,runCode:relocated.code,audioFrames:relocatedFrames};
 assert.deepEqual(await authorTree(root),after);assert.deepEqual(report.errors,[]);
 report.steps.push('Chrome downloads the generated engine project ZIP. Independent verification confirms one deduplicated WAV resource, extraction preserves its exact bytes and settings, and fresh Godot import/run at another path produces identical audio events.');
 for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));}
