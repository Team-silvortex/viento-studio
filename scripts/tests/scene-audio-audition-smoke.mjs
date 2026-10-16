// Explicit verified WAV audition with actual Chrome WebAudio and source isolation.
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
const evidenceRoot=path.join(appRoot,'docs/test-results/scene-audio-audition');
const output=path.resolve(process.env.VIENTO_SCENE_AUDIO_AUDITION_OUTPUT||path.join(evidenceRoot,`browser-${Date.now()}`));
if(!output.startsWith(evidenceRoot+path.sep))throw Error('Choose a fresh output beneath the scene-audio-audition evidence directory.');
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('The evidence directory must be empty.');
const report={startedAt:new Date().toISOString(),steps:[],screenshots:[],errors:[],dialogs:[],layout:{},limitations:[
 'Actual Chrome WebAudio on a disposable author workspace. This tests decoded sample data and playback lifecycle, not physical speakers or installed Tauri/Android.',
 'Audition is a single selected track at form volume/loop; no scene cue timeline, Godot/Bevy runtime, or source/metadata save is executed.',
 'The separately saved author binding/catalog is read-only; successful audition verifies only the read WAV snapshot. Builds independently validate their own resources.'
]};
const sources=['engine/studio-core.mjs','engine/studio-core.wasm','engine/audio-wav.mjs','engine/scene-audio-audition.mjs','engine/scene-audio-resources.mjs','engine/scene-audio-creation-contract.mjs','engine/scene-audio-edit.mjs','scripts/lib/audio-wav.mjs','scripts/lib/doc-server.mjs','scripts/lib/doc-server-static-routes.mjs','scripts/lib/scene-audio-creation-service.mjs','web/modules/app-scene-audio-source.js','web/modules/app-scene-audio-media.js','web/modules/scene-audio-audition.js','web/modules/app-scene-audio.js','web/modules/app-runtime.js','web/i18n/en.js','web/i18n/ja.js','web/scene-audio.css','scripts/tests/scene-audio-audition-smoke.mjs'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,buildHash(await fs.readFile(path.join(appRoot,name)))])));
report.node={version:process.version,sha256:buildHash(await fs.readFile(process.execPath))};
const cleanups=[],fixture={after:callback=>cleanups.push(callback)};
const wait=async(check,label,budget=45000)=>{for(let elapsed=0;elapsed<budget;elapsed+=100){if(await check())return;await delay(100);}throw Error('Timed out: '+label);};
async function authorTree(root){const hashes={};for(const entry of await fs.readdir(root,{recursive:true,withFileTypes:true})){if(!entry.isFile())continue;const file=path.join(entry.parentPath||entry.path,entry.name),name=path.relative(root,file);if(name==='workspace.json'||/^(documents|templates|metadata|assets)\//.test(name))hashes[name]=buildHash(await fs.readFile(file));}return hashes;}
let socket,captureFailure;
try{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-audio-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
 const root=path.join(temporary,'author'),download=path.join(temporary,'downloads');await fs.cp(path.join(appRoot,'examples/scene-audio'),root,{recursive:true});await fs.mkdir(download);
 const manifestPath='documents/audio/demo.json',manifestFile=path.join(root,manifestPath),sceneId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 const env={...process.env,VIENTO_APP_ROOT:appRoot,VIENTO_WORKSPACE_ROOT:root,XDG_CACHE_HOME:path.join(temporary,'cache'),XDG_CONFIG_HOME:path.join(temporary,'config')};
 delete env.VIENTO_SESSION_TOKEN;delete env.VIENTO_PREFERENCES_PATH;
 const rebuilt=await runCommand(process.execPath,[path.join(appRoot,'scripts/ops/rebuild.mjs')],{cwd:appRoot,env});assert.equal(rebuilt.code,0,JSON.stringify(rebuilt));
 const initial=await authorTree(root),base=await serve(fixture,appRoot,env),readSource=()=>fs.readFile(manifestFile,'utf8');
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
 captureFailure=async()=>{await screenshot('failure.png');report.pageFailure=await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,system:(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()})`);};
 await call('Runtime.enable');await call('Page.enable');report.browser=(await call('Browser.getVersion')).product;
 await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:download,eventsEnabled:true});
 await call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
  window.__auditionNodes=[];window.__auditionContexts=[];const Native=window.AudioContext;
  window.AudioContext=class extends Native{constructor(...args){super(...args);window.__auditionContexts.push(this);}
   createBufferSource(){const node=super.createBufferSource(),connect=node.connect.bind(node),start=node.start.bind(node),stop=node.stop.bind(node);
    node.connect=(destination,...args)=>{node.__target=destination;return connect(destination,...args);};
    node.start=(...args)=>{const result=start(...args);window.__auditionNodes.push({node,context:this,stops:0});return result;};
    node.stop=(...args)=>{const record=window.__auditionNodes.find(record=>record.node===node);if(record)record.stops++;return stop(...args);};return node;}
  };
 })()`});
 await call('Page.navigate',{url:`${base}/web/?mode=edit`});
 await wait(()=>evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`),'editor startup');
 await wait(()=>evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.includes('audio/demo'))`),'saved audio in sidebar');
 await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('audio/demo')).click()`);
 await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`),'ordinary audio edit');
 await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');await enabled('#sceneAudioBtn');
 const original=await readSource();assert.equal(await value('#docSourceEditor'),visible(original));
 const open=async()=>{await enabled('#sceneAudioBtn');await click('#sceneAudioBtn');await enabled('#sceneAudioTrack0Volume');};
 const ready=async()=>{await open();await enabled('#sceneAudioLoadResources');await click('#sceneAudioLoadResources');await enabled('#sceneAudioTrack0Preview');};
 const previewState=()=>evaluate(`(()=>{const e=document.querySelector('#sceneAudioPreviewStatus');return{status:e.dataset.status,trackId:e.dataset.trackId,text:e.textContent};})()`);
 const playbackCount=()=>evaluate('window.__auditionNodes.length');
 const start=async index=>{const before=await playbackCount();await enabled(`#sceneAudioTrack${index}Preview`);await click(`#sceneAudioTrack${index}Preview`);await wait(async()=>await playbackCount()===before+1,'actual AudioBufferSourceNode started');return before;};
 const stop=async()=>{await enabled('#sceneAudioStopPreview');await click('#sceneAudioStopPreview');await wait(async()=>(await previewState()).status==='idle','preview stopped');};
 const unchanged=async()=>{assert.deepEqual(await authorTree(root),initial);assert.equal(await value('#docSourceEditor'),visible(original));};
 await ready();await start(0);assert.equal((await previewState()).status,'playing');await unchanged();await screenshot('audition-playing-desktop.png');
 const rendered=await evaluate(`(async()=>{const {node}=window.__auditionNodes.at(-1),buffer=node.buffer,gain=node.__target.gain.value;
  const frames=buffer.length+128,offline=new OfflineAudioContext(buffer.numberOfChannels,frames,buffer.sampleRate),source=offline.createBufferSource(),volume=offline.createGain();source.buffer=buffer;source.loop=node.loop;volume.gain.value=gain;source.connect(volume).connect(offline.destination);source.start();const result=await offline.startRendering();let peak=0,error=0;
  for(let channel=0;channel<buffer.numberOfChannels;channel++){const input=buffer.getChannelData(channel),output=result.getChannelData(channel);for(let n=0;n<frames;n++){peak=Math.max(peak,Math.abs(output[n]));error=Math.max(error,Math.abs(output[n]-input[n%input.length]*gain));}}
  return{channels:buffer.numberOfChannels,frames:buffer.length,sampleRate:buffer.sampleRate,gain,loop:node.loop,peak,error};})()`);
 assert.equal(rendered.loop,true);assert.ok(Math.abs(rendered.gain-.12)<1e-7);assert.ok(rendered.peak>0);assert.ok(rendered.error<1e-6,JSON.stringify(rendered));report.rendered=rendered;
 await stop();assert.equal(await evaluate('window.__auditionNodes.at(-1).stops>0'),true);await unchanged();
 report.steps.push('Explicit Play loads the bound WAV through the existing GET route and starts a real WebAudio source. Offline rendering of the actual decoded buffer/gain verifies nonzero PCM, declared volume and looping beyond the first source duration; Stop cleans up. No source or metadata write.');
 // A reviewed ordinary edit stays reviewed across audition and language changes.
 await fill('#sceneAudioTrack0Volume','0.25');await enabled('#sceneAudioCheck');await click('#sceneAudioCheck');await enabled('#sceneAudioApply');const reviewed=await evaluate(`document.querySelector('#sceneAudioAfter').textContent`);await start(0);
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 for(const language of ['zh-CN','en','ja']){
  await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
  assert.equal((await previewState()).status,'playing');assert.equal(await value('#sceneAudioTrack0Volume'),'0.25');assert.equal(await evaluate(`document.querySelector('#sceneAudioApply').disabled`),false);assert.equal(await evaluate(`document.querySelector('#sceneAudioAfter').textContent`),reviewed);
  const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneAudioDialog'),r=document.querySelector('#sceneAudioStopPreview').getBoundingClientRect();return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,stopVisible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,status:document.querySelector('#sceneAudioPreviewStatus').textContent};})()`);
  assert.equal(layout.noHorizontalOverflow,true);assert.equal(layout.stopVisible,true,JSON.stringify(layout));report.layout[language]=layout;await screenshot(`audition-${language}-390.png`);
 }
 await stop();assert.equal(await evaluate(`document.querySelector('#sceneAudioApply').disabled`),false);await unchanged();await click('#sceneAudioCancel');await wait(()=>evaluate(`!document.querySelector('#sceneAudioDialog').open`),'cancel');await unchanged();
 report.steps.push('At 390px in Chinese, English and Japanese, Stop remains visible, audition and current volume survive translation, and playback never changes the reviewed source proposal. Cancel discards the form without changing the ordinary draft or author files.');
 await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);await ready();
 await start(0);await fill('#sceneAudioTrack0Volume','0.2');await wait(async()=>(await previewState()).status==='idle','editing stops preview');await start(0);await click('#sceneAudioLoadResources');await enabled('#sceneAudioTrack0Preview');assert.equal((await previewState()).status,'idle');
 await start(1);await wait(async()=>(await previewState()).status==='idle','non-looping preview naturally ends');await start(0);await click('#sceneAudioCancel');await wait(()=>evaluate(`!document.querySelector('#sceneAudioDialog').open`),'cancel while playing');await wait(()=>evaluate(`window.__auditionContexts.every(context=>context.state==='closed')`),'all contexts closed');await unchanged();
 report.steps.push('Changing a form field and reloading the catalog stop active playback. Non-looping audio ends naturally. Closing during looped playback stops the source and closes AudioContext; no source changes occur.');
 await ready();
 await evaluate(`(()=>{window.__originalAuditionFetch=window.fetch;window.__releaseAuditionFetch=null;window.fetch=async(input,init)=>{const response=await window.__originalAuditionFetch(input,init);if(String(input).startsWith('/asset-files/'))await new Promise(resolve=>window.__releaseAuditionFetch=resolve);return response;};})()`);
 const beforeLate=await playbackCount();await click('#sceneAudioTrack0Preview');await wait(()=>evaluate(`typeof window.__releaseAuditionFetch==='function'`),'asset read held');await enabled('#sceneAudioStopPreview');await screenshot('audition-loading-stop.png');await stop();await evaluate(`(()=>{window.__releaseAuditionFetch();window.fetch=window.__originalAuditionFetch;})()`);await delay(150);assert.equal(await playbackCount(),beforeLate);assert.equal((await previewState()).status,'idle');await unchanged();
 report.steps.push('Stop remains available after the real GET response headers arrive but before that response is delivered to the reader. Releasing the late response after cancellation cannot decode or start another source.');
 const wavPath=path.join(root,'assets/tone.wav'),originalWav=await fs.readFile(wavPath),changed=Buffer.from(originalWav);changed[50]^=1;await fs.writeFile(wavPath,changed);
 const beforeTamper=await playbackCount();await click('#sceneAudioTrack0Preview');await wait(async()=>(await previewState()).status==='error','changed bytes rejected');assert.equal(await playbackCount(),beforeTamper);await screenshot('audition-changed-resource.png');await fs.writeFile(wavPath,originalWav);await unchanged();await start(0);await stop();await click('#sceneAudioCancel');await unchanged();
 report.steps.push('Changing a WAV byte without updating its registration is rejected before AudioBufferSourceNode.start. Restoring the original bytes allows a new explicit audition; the catalog remains a registration snapshot, not a persistent verification badge.');
 await ready();await fill('#sceneAudioTrack0Volume','0.25');await click('#sceneAudioCheck');await enabled('#sceneAudioApply');const appliedDraft=await evaluate(`document.querySelector('#sceneAudioAfter').textContent`);await start(0);await click('#sceneAudioApply');await wait(()=>evaluate(`!document.querySelector('#sceneAudioDialog').open`),'apply closes audition');assert.equal(await value('#docSourceEditor'),visible(appliedDraft));assert.deepEqual(await authorTree(root),initial);await wait(()=>evaluate(`window.__auditionContexts.every(context=>context.state==='closed')`),'apply closes player');
 await ready();await start(0);assert.ok(Math.abs(await evaluate('window.__auditionNodes.at(-1).node.__target.gain.value')-.25)<1e-7);await stop();await click('#sceneAudioCancel');assert.equal(await value('#docSourceEditor'),visible(appliedDraft));assert.deepEqual(await authorTree(root),initial);report.unsavedDraft={sourceChangedOnlyByExplicitApply:true,savedSourceUnchanged:true,gain:.25};
 report.steps.push('Explicit Apply stops current audition and changes only the ordinary draft. Reopening that unsaved draft can audition with its new volume against the unchanged saved resource catalog. Subsequent Cancel retains the already applied draft; no Save or metadata write occurs.');
 report.playback=await evaluate(`window.__auditionNodes.map(({node,context,stops})=>({loop:node.loop,gain:node.__target.gain.value,sampleRate:node.buffer?.sampleRate,stops,contextState:context.state}))`);
 assert.deepEqual(report.errors,[]);assert.ok(report.playback.every(row=>row.contextState==='closed'));assert.deepEqual(await authorTree(root),initial);report.authorFilesPreserved=Object.keys(initial).length;
 for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));}
