// Single-track pause/resume/seek through actual Chrome WebAudio; author data stays isolated.
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
const evidenceRoot=path.join(appRoot,'docs/test-results/scene-audio-audition-transport');
const output=path.resolve(process.env.VIENTO_SCENE_AUDIO_TRANSPORT_OUTPUT||path.join(evidenceRoot,`browser-${Date.now()}`));
if(!output.startsWith(evidenceRoot+path.sep))throw Error('Choose a fresh output beneath the scene-audio-audition-transport evidence directory.');
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('The evidence directory must be empty.');
const report={startedAt:new Date().toISOString(),steps:[],screenshots:[],errors:[],dialogs:[],layout:{},limitations:[
 'Actual Chrome WebAudio on a disposable author workspace. This tests decoded sample data and playback lifecycle, not physical speakers or installed Tauri/Android.',
 'Audition is a single selected track at form volume/loop; no scene cue timeline, Godot/Bevy runtime, or source/metadata save is executed.',
 'The separately saved author binding/catalog is read-only; successful audition verifies only the read WAV snapshot. Builds independently validate their own resources.'
]};
const sources=['engine/studio-core.mjs','engine/studio-core.wasm','engine/audio-wav.mjs','engine/scene-audio-audition.mjs','engine/scene-audio-resources.mjs','engine/scene-audio-creation-contract.mjs','engine/scene-audio-edit.mjs','scripts/lib/audio-wav.mjs','scripts/lib/doc-server.mjs','scripts/lib/doc-server-static-routes.mjs','scripts/lib/scene-audio-creation-service.mjs','web/modules/app-scene-audio-source.js','web/modules/app-scene-audio-media.js','web/modules/scene-audio-audition.js','web/modules/app-scene-audio.js','web/modules/app-runtime.js','web/i18n/en.js','web/i18n/ja.js','web/scene-audio.css','scripts/tests/scene-audio-audition-transport-smoke.mjs'];
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
 // A longer generated tone makes actual offset and loop boundaries observable.
 const sampleRate=8000,frames=sampleRate*10,wav=Buffer.alloc(44+frames*2);
 wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++)wav.writeInt16LE(Math.round(Math.sin(i/sampleRate*440*Math.PI*2)*(1000+Math.floor(i/sampleRate)*100)),44+i*2);
 await fs.writeFile(path.join(root,'assets/tone.wav'),wav);
 const registration=path.join(root,'metadata/assets/99999999-9999-4999-8999-999999999999.json'),asset=JSON.parse(await fs.readFile(registration,'utf8'));asset.content={size:wav.length,sha256:buildHash(wav)};await fs.writeFile(registration,JSON.stringify(asset,null,2)+'\n');
 // A fractional-duration second WAV exercises the native slider's exact End.
 const shortFrames=9875,shortWav=Buffer.from(wav.subarray(0,44+shortFrames*2));shortWav.writeUInt32LE(shortWav.length-8,4);shortWav.writeUInt32LE(shortFrames*2,40);await fs.writeFile(path.join(root,'assets/fraction.wav'),shortWav);
 const fractionalId='99999999-9999-4999-8999-999999999998',fractionAsset={...asset,id:fractionalId,name:'Fractional duration',location:{store:'main',path:'fraction.wav'},legacyPaths:[],content:{size:shortWav.length,sha256:buildHash(shortWav)}};
 await fs.writeFile(path.join(root,'metadata/assets',fractionalId+'.json'),JSON.stringify(fractionAsset,null,2)+'\n');
 const audio=JSON.parse(await fs.readFile(manifestFile,'utf8'));audio.tracks.push({id:'77777777-7777-4777-8777-000000000003',resourceId:fractionalId,role:'effect',volume:.3,loop:false});await fs.writeFile(manifestFile,JSON.stringify(audio,null,2)+'\n');
 const audioMetaPath=path.join(root,'metadata/documents/88888888-8888-4888-8888-888888888888.json'),audioMeta=JSON.parse(await fs.readFile(audioMetaPath,'utf8'));audioMeta.assetBindings.push({assetId:fractionalId,role:'audio'});await fs.writeFile(audioMetaPath,JSON.stringify(audioMeta,null,2)+'\n');
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
  window.__auditionNodes=[];window.__auditionContexts=[];window.__auditionReads=0;window.__auditionDecodes=0;const Native=window.AudioContext,originalFetch=window.fetch;window.fetch=(input,init)=>{if(String(input).startsWith('/asset-files/'))window.__auditionReads++;return originalFetch(input,init);};
  window.AudioContext=class extends Native{constructor(...args){super(...args);window.__auditionContexts.push(this);}
   resume(){const resumed=super.resume();if(window.__holdNextAuditionResume){window.__holdNextAuditionResume=false;return resumed.then(()=>new Promise(resolve=>window.__releaseAuditionResume=resolve));}return resumed;}
   decodeAudioData(...args){window.__auditionDecodes++;return super.decodeAudioData(...args);}
   createBufferSource(){const node=super.createBufferSource(),connect=node.connect.bind(node),start=node.start.bind(node),stop=node.stop.bind(node);
    node.connect=(destination,...args)=>{node.__target=destination;return connect(destination,...args);};
    node.start=(...args)=>{const result=start(...args);window.__auditionNodes.push({node,context:this,stops:0,startArgs:args,ended:node.onended});return result;};
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

 const status=async expected=>wait(async()=>(await previewState()).status===expected,`preview ${expected}`);
 const rangeValue=async()=>Number(await value('#sceneAudioPreviewPosition'));
 const pause=async()=>{await enabled('#sceneAudioPausePreview');await click('#sceneAudioPausePreview');await status('paused');};
 const resume=async()=>{await enabled('#sceneAudioResumePreview');await click('#sceneAudioResumePreview');await status('playing');};
 const seek=async seconds=>{await enabled('#sceneAudioPreviewPosition');await fill('#sceneAudioPreviewPosition',String(seconds));await fill('#sceneAudioPreviewPosition',String(seconds),'change');};
 const counts=()=>evaluate('({reads:window.__auditionReads,decodes:window.__auditionDecodes,nodes:window.__auditionNodes.length})');
 const offset=()=>evaluate('window.__auditionNodes.at(-1).startArgs[1]||0');
 const keyboard=async key=>{await evaluate("document.querySelector('#sceneAudioPreviewPosition').focus()");const code={ArrowRight:39,Home:36,End:35}[key];await call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code});};
 await ready();await start(0);await delay(400);assert.ok(await rangeValue()>0);assert.equal(Number(await evaluate("document.querySelector('#sceneAudioPreviewPosition').max")),10);
 await evaluate("document.querySelector('#sceneAudioPausePreview').focus()");await pause();assert.equal(await evaluate('document.activeElement.id'),'sceneAudioResumePreview');const frozen=await rangeValue(),firstCounts=await counts();assert.ok(frozen>0);await delay(350);assert.equal(await rangeValue(),frozen);await resume();assert.equal(await evaluate('document.activeElement.id'),'sceneAudioPausePreview');report.keyboardFocus={pauseToResume:true,resumeToPause:true};assert.ok(Math.abs(await offset()-frozen)<.02);
 await seek(3.25);assert.equal(await offset(),3.25);assert.equal((await previewState()).status,'playing');
 const afterTransport=await counts();assert.equal(afterTransport.reads,firstCounts.reads);assert.equal(afterTransport.decodes,firstCounts.decodes);
 const rendered=await evaluate(`(async()=>{const {node,startArgs}=window.__auditionNodes.at(-1),buffer=node.buffer,gain=node.__target.gain.value,startFrame=Math.round(startArgs[1]*buffer.sampleRate),frames=1024;
  const offline=new OfflineAudioContext(buffer.numberOfChannels,frames,buffer.sampleRate),source=offline.createBufferSource(),volume=offline.createGain();source.buffer=buffer;source.loop=node.loop;volume.gain.value=gain;source.connect(volume).connect(offline.destination);source.start(0,startArgs[1]);const result=await offline.startRendering();let peak=0,error=0;
  for(let channel=0;channel<buffer.numberOfChannels;channel++){const input=buffer.getChannelData(channel),output=result.getChannelData(channel);for(let n=0;n<frames;n++){peak=Math.max(peak,Math.abs(output[n]));error=Math.max(error,Math.abs(output[n]-input[(startFrame+n)%input.length]*gain));}}
  return{sampleRate:buffer.sampleRate,frames,offset:startArgs[1],gain,peak,error};})()`);
 assert.ok(rendered.peak>0);assert.ok(rendered.error<1e-6,JSON.stringify(rendered));report.rendered=rendered;await screenshot('transport-playing-desktop.png');await stop();await unchanged();
 report.steps.push('Actual audio-clock progress advances, Pause freezes the position, Continue starts at that offset, and playing seek starts at 3.25s. The same verified buffer is reused without another resource read/decode. Offline rendering checks nonzero samples at the actual seek offset and gain.');
 await fill('#sceneAudioTrack0Volume','0.25');await click('#sceneAudioCheck');await enabled('#sceneAudioApply');const reviewed=await evaluate("document.querySelector('#sceneAudioAfter').textContent");await start(0);await pause();const beforePausedSeek=await counts();await seek(6.5);assert.equal((await previewState()).status,'paused');assert.deepEqual(await counts(),beforePausedSeek);assert.equal(await rangeValue(),6.5);
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 for(const language of ['zh-CN','en','ja']){
  await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);assert.equal((await previewState()).status,'paused');assert.equal(await rangeValue(),6.5);assert.equal(await value('#sceneAudioTrack0Volume'),'0.25');assert.equal(await evaluate("document.querySelector('#sceneAudioApply').disabled"),false);assert.equal(await evaluate("document.querySelector('#sceneAudioAfter').textContent"),reviewed);
  const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneAudioDialog'),visible=id=>{const e=document.querySelector(id),r=e.getBoundingClientRect();return!e.hidden&&!e.disabled&&r.width>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth};return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,stopVisible:visible('#sceneAudioStopPreview'),resumeVisible:visible('#sceneAudioResumePreview'),rangeVisible:visible('#sceneAudioPreviewPosition'),time:document.querySelector('#sceneAudioPreviewTime').textContent};})()`);
  assert.ok(layout.noHorizontalOverflow&&layout.stopVisible&&layout.resumeVisible&&layout.rangeVisible,JSON.stringify(layout));report.layout[language]=layout;await screenshot(`transport-${language}-390.png`);
 }
 await keyboard('Home');assert.equal(await rangeValue(),0);await keyboard('ArrowRight');assert.ok(await rangeValue()>0);assert.equal(await evaluate('document.activeElement.id'),'sceneAudioPreviewPosition');report.keyboardFocus.rangeRetained=true;assert.equal((await previewState()).status,'paused');await unchanged();await click('#sceneAudioCancel');await wait(()=>evaluate("!document.querySelector('#sceneAudioDialog').open"),'cancel paused');await unchanged();
 report.steps.push('Paused seeking creates no node or read. At 390px, Chinese/English/Japanese retain paused offset, form and approved proposal while Stop/Continue/range remain visible. Real keyboard Home and ArrowRight move only the temporary position; Cancel preserves the ordinary draft.');
 await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");await ready();await start(0);await seek(9.8);await delay(600);assert.ok(await rangeValue()<2);
 const lastBeforeSeek=await playbackCount();await seek(10);assert.equal(await offset(),0);await evaluate(`window.__auditionNodes[${lastBeforeSeek-1}].ended?.()`);assert.equal((await previewState()).status,'playing');await stop();
 await start(1);await pause();await keyboard('End');assert.equal(await rangeValue(),10);assert.equal((await previewState()).status,'paused');await resume();assert.equal(await offset(),0);await seek(9.85);await status('idle');await unchanged();
 await start(2);await pause();await keyboard('End');assert.equal(await rangeValue(),shortFrames/sampleRate);assert.equal((await previewState()).status,'paused');await resume();assert.equal(await offset(),0);await stop();report.fractionalDuration=shortFrames/sampleRate;
 report.steps.push('Looping crosses the end modulo duration; seeking its exact end returns to zero and a retired node ended callback cannot close the replacement. Non-looping End stays paused at duration, Continue restarts from zero, and natural completion returns idle. Native End also reaches the exact 1.234375s fractional duration.');
 await start(0);const beforeDrag=await counts();await fill('#sceneAudioPreviewPosition','4.5');await delay(650);assert.equal(await rangeValue(),4.5);assert.deepEqual(await counts(),beforeDrag);await fill('#sceneAudioPreviewPosition','4.5','change');assert.equal(await offset(),4.5);await pause();await fill('#sceneAudioTrack0Volume','0.2');await status('idle');await start(0);await pause();await click('#sceneAudioLoadResources');await enabled('#sceneAudioTrack0Preview');await status('idle');await unchanged();
 report.steps.push('A pending range input keeps the user target across progress ticks and does not create nodes until change. Editing the author form or refreshing the resource catalog releases paused playback without changing the ordinary draft or files.');
 await start(0);await pause();await evaluate('window.__holdNextAuditionResume=true');const beforeLate=await playbackCount();await click('#sceneAudioResumePreview');await status('resuming');await wait(()=>evaluate("typeof window.__releaseAuditionResume==='function'"),'resume held');await enabled('#sceneAudioStopPreview');await screenshot('transport-resuming-stop.png');await stop();await start(0);const afterNew=await playbackCount();assert.equal(afterNew,beforeLate+1);await evaluate('window.__releaseAuditionResume()');await delay(150);assert.equal(await playbackCount(),afterNew);assert.equal((await previewState()).status,'playing');await stop();await click('#sceneAudioCancel');await unchanged();
 report.steps.push('Stop remains available during a held completion of real AudioContext.resume. Stopping and starting a new audition before releasing the old completion cannot start an extra source or disturb the new owner.');
 await ready();await start(0);await pause();const wavPath=path.join(root,'assets/tone.wav'),originalWav=await fs.readFile(wavPath),changed=Buffer.from(originalWav);changed[50]^=1;await fs.writeFile(wavPath,changed);const beforeSnapshot=await counts();await resume();assert.equal((await counts()).reads,beforeSnapshot.reads);assert.equal((await counts()).decodes,beforeSnapshot.decodes);await stop();const startsBeforeRecheck=await playbackCount();await click('#sceneAudioTrack0Preview');await status('error');assert.equal(await playbackCount(),startsBeforeRecheck);await fs.writeFile(wavPath,originalWav);await unchanged();await click('#sceneAudioCancel');
 report.steps.push('Continue uses only the previously verified snapshot, even if isolated disk bytes change while paused. A new explicit audition rereads and rejects changed bytes before starting; restoration leaves all author fingerprints intact.');
 await ready();await fill('#sceneAudioTrack0Volume','0.25');await click('#sceneAudioCheck');await enabled('#sceneAudioApply');const appliedDraft=await evaluate("document.querySelector('#sceneAudioAfter').textContent");await start(0);await pause();await seek(2.5);await click('#sceneAudioApply');await wait(()=>evaluate("!document.querySelector('#sceneAudioDialog').open"),'apply paused');assert.equal(await value('#docSourceEditor'),visible(appliedDraft));assert.deepEqual(await authorTree(root),initial);
 await ready();await start(0);await pause();await seek(1.5);await resume();assert.equal(await offset(),1.5);assert.ok(Math.abs(await evaluate('window.__auditionNodes.at(-1).node.__target.gain.value')-.25)<1e-7);await click('#sceneAudioCancel');await wait(()=>evaluate('window.__auditionContexts.every(context=>context.state===\'closed\')'),'contexts closed');assert.equal(await value('#docSourceEditor'),visible(appliedDraft));assert.deepEqual(await authorTree(root),initial);report.unsavedDraft={onlyExplicitApply:true,volume:.25,resumedOffset:1.5};
 report.steps.push('Apply releases paused playback and updates only the ordinary draft. The reopened unsaved draft can pause/seek/continue with the new gain, and later Cancel keeps the already applied draft; no Save is performed.');
 report.counts=await counts();report.playback=await evaluate('window.__auditionNodes.map(({node,context,stops,startArgs})=>({loop:node.loop,gain:node.__target.gain.value,offset:startArgs[1]||0,stops,contextState:context.state}))');
 assert.deepEqual(report.errors,[]);assert.ok(report.playback.every(row=>row.contextState==='closed'));assert.deepEqual(await authorTree(root),initial);report.authorFilesPreserved=Object.keys(initial).length;
 for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));}
