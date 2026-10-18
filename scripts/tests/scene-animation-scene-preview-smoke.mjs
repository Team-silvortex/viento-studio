// Real saved Scene2D animation preview; disposable source copy and append-only evidence.
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

import {Readable} from 'node:stream';
import {importMediaAsset} from '../lib/media-assets.mjs';

const appRoot=fileURLToPath(new URL('../../',import.meta.url));
const evidenceRoot=path.join(appRoot,'docs/test-results/scene-animation-scene-preview');
const output=path.resolve(process.env.VIENTO_ANIMATION_SCENE_PREVIEW_OUTPUT||path.join(evidenceRoot,`browser-${Date.now()}`));
if(!output.startsWith(evidenceRoot+path.sep))throw Error('Use a new scene-animation-scene-preview evidence directory.');
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Evidence must be new.');
const report={startedAt:new Date().toISOString(),steps:[],screenshots:[],errors:[],layout:{},limitations:[
 'Real Chrome local HTTP authoring preview in a disposable copied example; no packaged Tauri/Android or engine runtime claim.',
 'Only saved Scene2D visual animation is played; behavior, physics, audio, frame animation and composition playback are excluded.',
 'Background pause is exercised by dispatching the browser visibility event with an explicitly overridden hidden state, not OS tab scheduling.'
]};
const sources=['engine/studio-core.wasm','engine/scene-animation-preview.mjs','engine/scene-animation-visual-frame.mjs','scripts/lib/scene-preview-service.mjs','scripts/adapters/node-build-snapshot.mjs','scripts/lib/doc-api-service.mjs','web/modules/app-scene-preview-animation.js','web/modules/app-scene-preview.js','web/modules/app-scene-preview-canvas.js','web/modules/scene-animation-player.js','web/modules/app-project-build.js','web/modules/app-studio-system.js','web/i18n/en.js','web/i18n/ja.js','web/scene-preview.css','scripts/tests/scene-animation-scene-preview-smoke.mjs'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,buildHash(await fs.readFile(path.join(appRoot,name)))])));
report.node={version:process.version,sha256:buildHash(await fs.readFile(process.execPath))};
const cleanups=[],fixture={after:callback=>cleanups.push(callback)};
const wait=async(check,label,budget=45000)=>{for(let elapsed=0;elapsed<budget;elapsed+=100){if(await check())return;await delay(100);}throw Error('Timed out: '+label);};
async function authorTree(root){const hashes={};for(const entry of await fs.readdir(root,{recursive:true,withFileTypes:true})){if(!entry.isFile())continue;const file=path.join(entry.parentPath||entry.path,entry.name),name=path.relative(root,file);if(name==='workspace.json'||/^(documents|templates|metadata|assets)\//.test(name))hashes[name]=buildHash(await fs.readFile(file));}return hashes;}
let socket,captureFailure;
try{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-animation-scene-preview-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
 const root=path.join(temporary,'author');await fs.cp(path.join(appRoot,'examples/scene-animation'),root,{recursive:true});
 await fs.mkdir(path.join(root,'assets'),{recursive:true});
 const sceneId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',instanceId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
 const scenePath=path.join(root,'documents/scenes/demo.json'),manifestPath=path.join(root,'documents/animations/demo.json');
 const imageBytes=await fs.readFile(path.join(appRoot,'examples/scene2d/assets/traveler.svg'));
 const imported=await importMediaAsset(root,Readable.from([imageBytes]),'traveler.svg');
 const sceneRegistrationPath=path.join(root,'metadata/documents/'+sceneId+'.json'),sceneRegistration=JSON.parse(await fs.readFile(sceneRegistrationPath,'utf8'));sceneRegistration.assetBindings.push({assetId:imported.asset.id,role:'sprite'});await fs.writeFile(sceneRegistrationPath,JSON.stringify(sceneRegistration,null,2)+'\n');
 const scene=JSON.parse(await fs.readFile(scenePath,'utf8'));scene.actors[0].imageResourceId=imported.asset.id;scene.actors[0].color='#ffffff';scene.actors[0].size=[80,60];
 await fs.writeFile(scenePath,JSON.stringify(scene,null,2)+'\n');
 const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
 for(const track of manifest.tracks){track.instanceId=instanceId;const values={offset2d:[[0,0],[120,-50],[0,0]],rotation2d:[0,90,0],scale2d:[[1,1],[2,.5],[1,1]],opacity:[1,.5,1]}[track.property];track.interpolation='linear';track.keyframes=values.map((value,index)=>({atSeconds:index,value}));}
 await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
 const env={...process.env,VIENTO_APP_ROOT:appRoot,VIENTO_WORKSPACE_ROOT:root,XDG_CACHE_HOME:path.join(temporary,'cache'),XDG_CONFIG_HOME:path.join(temporary,'config')};delete env.VIENTO_GODOT_BIN;delete env.VIENTO_SESSION_TOKEN;delete env.VIENTO_PREFERENCES_PATH;
 const rebuilt=await runCommand(process.execPath,[path.join(appRoot,'scripts/ops/rebuild.mjs')],{cwd:appRoot,env});assert.equal(rebuilt.code,0,JSON.stringify(rebuilt));
 const initial=await authorTree(root),base=await serve(fixture,appRoot,env);
 const state=async()=>{const response=await fetch(`${base}/api/project-build`).then(value=>value.json());return response.data||response;};
 const profile=path.join(temporary,'chrome');await fs.mkdir(profile);
 const chrome=spawn(process.argv[2]||'/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--remote-debugging-port=0','--window-size=1440,1100','about:blank'],{stdio:'ignore'});
 cleanups.push(async()=>{if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}});
 let port;await wait(async()=>{try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];return Boolean(port);}catch{return false;}},'Chrome startup');
 const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(value=>value.json());socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);await once(socket,'open');
 const pending=new Map();let sequence=0;const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 socket.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id){const request=pending.get(value.id);pending.delete(value.id);value.error?request?.reject(Error(value.error.message)):request?.resolve(value.result);}else if(value.method==='Runtime.exceptionThrown')report.errors.push(value.params.exceptionDetails);else if(value.method==='Page.javascriptDialogOpening'){(report.dialogs ||= []).push({type:value.params.type,message:value.params.message});void call('Page.handleJavaScriptDialog',{accept:true});}});
 const evaluate=async expression=>{const value=await call('Runtime.evaluate',{expression:`(async()=>(${expression}))()`,awaitPromise:true,returnByValue:true,userGesture:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
 const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const fill=(selector,value,event='input')=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
 const value=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
 const enabled=selector=>wait(()=>evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled===false&&!document.querySelector(${JSON.stringify(selector)}).hidden`),selector+' enabled');
 const screenshot=async name=>{const image=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,name),Buffer.from(image.data,'base64'));report.screenshots.push(name);};

 captureFailure=async()=>{await screenshot('failure.png');report.pageFailure=await evaluate(`({text:document.body.innerText,system:(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot(),captures:window.__sceneCaptures,requests:window.__sceneRequests})`);report.serviceFailure=await state();};
 await call('Runtime.enable');await call('Page.enable');report.browser=(await call('Browser.getVersion')).product;
 await call('Page.navigate',{url:`${base}/web/?mode=edit`});
 await wait(()=>evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`),'editor startup');
 await evaluate(`(()=>{const original=window.fetch.bind(window);window.__sceneCaptures=[];window.__sceneRequests=[];window.__authorWrites=[];window.fetch=async(input,init)=>{const url=String(input);if(init?.method&&['PUT','PATCH'].includes(init.method)||url.includes('/api/world/commands')&&init?.method==='POST')window.__authorWrites.push({url,body:init.body});const response=await original(input,init);if(url.includes('/api/scene-preview')&&init?.method==='POST'){const body=await response.clone().json();window.__sceneRequests.push(JSON.parse(init.body));window.__sceneCaptures.push(body.data||body);if(window.__holdNextPreview){window.__holdNextPreview=false;window.__heldPreview=true;await new Promise(resolve=>window.__releasePreview=resolve);}if(window.__badNextAnimation){window.__badNextAnimation=false;const payload=body.data||body;payload.animationPreview.snapshotId='sha256:'+'0'.repeat(64);return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});}}return response;};})()`);
 await enabled('#projectBuildBtn');await click('#projectBuildBtn');await enabled('#projectBuildScene');await fill('#projectBuildScene',sceneId,'change');await click('#projectBuildTabPreview');
 await enabled('#scenePreviewAnimationPlay');await enabled('#scenePreviewRefresh');
 const latest=()=>evaluate('window.__sceneCaptures.at(-1)');
 const captured=await latest();assert.equal(captured.animationPreview.status,'ready');assert.equal(captured.resources.length,1);assert.equal(captured.actors[0].objectId,captured.actors[1].objectId);assert.notEqual(captured.actors[0].instanceId,captured.actors[1].instanceId);assert.ok(captured.animationPreview.document.tracks.every(track=>track.instanceId===instanceId));
 assert.equal(await evaluate("document.querySelector('#scenePreviewAnimationStop').disabled"),true);assert.equal(await evaluate("document.querySelector('#scenePreviewLayoutEdit').disabled"),false);
 // Observe actual Canvas draw calls and pixels without modifying the product player.
 await evaluate(`(()=>{const canvas=document.querySelector('#scenePreviewCanvas'),ctx=canvas.getContext('2d'),draw=ctx.drawImage.bind(ctx);window.__imageFrames=[];ctx.drawImage=(...args)=>{const m=ctx.getTransform();window.__imageFrames.push({a:m.a,b:m.b,c:m.c,d:m.d,e:m.e,f:m.f,alpha:ctx.globalAlpha,args:args.slice(1)});if(window.__imageFrames.length>30)window.__imageFrames.shift();return draw(...args);};})()`);
 const pixels=()=>evaluate(`(()=>{const c=document.querySelector('#scenePreviewCanvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let hash=2166136261;for(const v of d)hash=Math.imul(hash^v,16777619);return {width:c.width,height:c.height,hash:hash>>>0};})()`);
 const colorBounds=color=>evaluate(`(()=>{const c=document.querySelector('#scenePreviewCanvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,rgb=${JSON.stringify(color)},r={x:c.width,y:c.height,right:-1,bottom:-1,count:0};for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;if(d[i+3]>250&&rgb.every((v,j)=>Math.abs(v-d[i+j])<2)){r.x=Math.min(r.x,x);r.y=Math.min(r.y,y);r.right=Math.max(r.right,x);r.bottom=Math.max(r.bottom,y);r.count++;}}return r;})()`);
 await evaluate(`document.querySelector('#scenePreviewCanvas').scrollIntoView({block:'center'})`);await delay(150);const originalPixels=await pixels(),secondBefore=await colorBounds([175,148,232]);assert.ok(secondBefore.count>100);
 await fill('#scenePreviewAnimationPosition','1');const frame=await evaluate('window.__imageFrames.at(-1)');assert.ok(Math.abs(frame.a)<1e-10&&Math.abs(frame.d)<1e-10);assert.ok(frame.b>0&&frame.c<0);assert.ok(Math.abs(frame.c/frame.b+.25)<1e-10);assert.equal(frame.alpha,.5);assert.deepEqual(await colorBounds([175,148,232]),secondBefore);assert.notDeepEqual(await pixels(),originalPixels);
 assert.equal(await evaluate("document.querySelector('#scenePreviewLayoutEdit').disabled"),true);assert.ok((await evaluate("document.querySelector('#scenePreviewHelp').textContent")).includes('从对象列表'));assert.ok((await evaluate("document.querySelector('#scenePreviewSelection').textContent")).includes('从对象列表'));await screenshot('scene-animation-sampled-desktop.png');
 const samplePixels=await pixels();await click('#scenePreviewAnimationStop');assert.deepEqual(await pixels(),originalPixels);assert.equal(await evaluate("document.querySelector('#scenePreviewLayoutEdit').disabled"),false);assert.ok((await evaluate("document.querySelector('#scenePreviewHelp').textContent")).includes('点击角色'));
 report.frames={capturedAnimation:captured.animationPreview,atOneSecond:frame,staticPixels:originalPixels,animatedPixels:samplePixels,unaffectedSecondInstance:secondBefore};
 report.steps.push('Saved animation remains initially static after frozen SVG decoding. Scrubbing one second draws the existing image at its offset, 90-degree rotation, 2×/0.5× scale and 0.5 opacity. The second instance of the same projection keeps identical pixels. Stop restores exact static canvas pixels; layout is enabled again.');
 await fill('#scenePreviewAnimationPosition','1');const zoomBefore=await evaluate("document.querySelector('#scenePreviewZoom').textContent");await click('#scenePreviewZoomIn');assert.notEqual(await evaluate("document.querySelector('#scenePreviewZoom').textContent"),zoomBefore);
 await evaluate(`document.querySelector('#scenePreviewCanvas').scrollIntoView({block:'center'})`);const box=await evaluate(`document.querySelector('#scenePreviewCanvas').getBoundingClientRect().toJSON()`),beforePan=await evaluate('window.__imageFrames.at(-1)');
 const point={x:box.left+box.width/2,y:box.top+box.height/2};await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'middle',clickCount:1,...point});await call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'middle',buttons:4,x:point.x+25,y:point.y+15});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'middle',clickCount:1,x:point.x+25,y:point.y+15});
 const afterPan=await evaluate('window.__imageFrames.at(-1)');assert.notEqual(afterPan.e,beforePan.e);assert.notEqual(afterPan.f,beforePan.f);assert.equal(afterPan.alpha,.5);await click('#scenePreviewAnimationStop');const stoppedPan=await evaluate('window.__imageFrames.at(-1)');assert.ok(stoppedPan.a>0&&stoppedPan.d>0);assert.equal(stoppedPan.alpha,1);await click('#scenePreviewFit');
 report.steps.push('Zoom and a real middle-button drag remain usable on a sampled frame. Stop changes only the visual layer, retaining the panned view; Fit remains explicit.');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 for(const language of ['zh-CN','en','ja']){await fill('#scenePreviewAnimationPosition','.5');await evaluate("(window.__timeInput=document.querySelector('#scenePreviewAnimationPosition'),window.__timeInput.focus())");await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
  assert.equal(await value('#scenePreviewAnimationPosition'),'0.5');assert.equal(await evaluate('document.activeElement===window.__timeInput&&document.querySelector("#scenePreviewAnimationPosition")===window.__timeInput'),true);
  await evaluate(`document.querySelector('#scenePreviewAnimation').scrollIntoView({block:'center'})`);
  const layout=await evaluate(`(()=>{const ids=['scenePreviewAnimation','scenePreviewAnimationPlay','scenePreviewAnimationPause','scenePreviewAnimationStop','scenePreviewAnimationPosition'],rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom};};return{overflow:document.querySelector('#projectBuildDialog').scrollWidth>document.querySelector('#projectBuildDialog').clientWidth||document.documentElement.scrollWidth>innerWidth,rects:Object.fromEntries(ids.map(id=>[id,rect(id)])),heading:document.querySelector('#scenePreviewAnimation h3').textContent};})()`);
  assert.equal(layout.overflow,false,JSON.stringify(layout));for(const r of Object.values(layout.rects))assert.ok(r.left>=0&&r.right<=390,JSON.stringify(layout));report.layout[language]=layout;await screenshot(`scene-animation-${language}-390.png`);
 }
 await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);await click('#scenePreviewAnimationPlay');await delay(150);
 assert.equal(await evaluate("document.querySelector('#scenePreviewAnimationPause').disabled"),false);await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('ja')`);assert.equal(await evaluate("document.querySelector('#scenePreviewAnimationPause').disabled"),false);
 await evaluate(`(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));})()`);const pausedTime=await value('#scenePreviewAnimationPosition');await delay(180);assert.equal(await value('#scenePreviewAnimationPosition'),pausedTime);assert.equal(await evaluate("document.querySelector('#scenePreviewAnimationPlay').disabled"),false);await evaluate(`delete document.hidden`);
 report.steps.push('Chinese, English and Japanese fit a 390px viewport and retain the same focused timeline and exact paused time. Changing language during playback retains playing state. The browser visibility handler pauses without advancing the frozen sample.');
 await click('#projectBuildTabBuild');assert.equal(await evaluate("document.querySelector('#scenePreviewAnimation').hidden"),true);await click('#projectBuildTabPreview');await enabled('#scenePreviewAnimationPlay');assert.equal(await value('#scenePreviewAnimationPosition'),'0');assert.equal(await evaluate("document.querySelector('#scenePreviewAnimationStop').disabled"),true);
 await fill('#scenePreviewAnimationPosition','1');await click('#scenePreviewRefresh');assert.equal(await evaluate("document.querySelector('#scenePreviewAnimation').hidden"),true);await enabled('#scenePreviewAnimationPlay');assert.equal(await value('#scenePreviewAnimationPosition'),'0');
 await evaluate('(window.__holdNextPreview=true,window.__heldPreview=false)');await click('#scenePreviewRefresh');await wait(()=>evaluate('window.__heldPreview'),'held snapshot response');await click('#projectBuildClose');await evaluate('window.__releasePreview()');await delay(200);assert.equal(await evaluate("document.querySelector('#scenePreviewAnimation').hidden"),true);assert.equal(await evaluate("document.querySelector('#projectBuildDialog').open"),false);
 await click('#projectBuildBtn');await click('#projectBuildTabPreview');await enabled('#scenePreviewAnimationPlay');assert.equal(await value('#scenePreviewAnimationPosition'),'0');
 report.steps.push('Leaving the preview tab, refreshing and closing with a real response pending cancel the visual layer and timeline. The late response cannot reopen or animate the hidden preview; reopening captures a fresh static scene.');
 await evaluate('window.__badNextAnimation=true');await click('#scenePreviewRefresh');await enabled('#scenePreviewRefresh');assert.equal(await evaluate("document.querySelector('#scenePreviewCanvas').hidden"),false);assert.equal(await evaluate("document.querySelector('#scenePreviewAnimationControls').hidden"),true);assert.ok((await evaluate("document.querySelector('#scenePreviewAnimationDiagnostic').textContent")).includes('scene_animation_preview_invalid'));
 await screenshot('scene-animation-invalid-static.png');await click('#scenePreviewRefresh');await enabled('#scenePreviewAnimationPlay');
 assert.deepEqual(await authorTree(root),initial);assert.deepEqual(await evaluate('window.__authorWrites'),[]);assert.equal((await state()).job,null);assert.deepEqual(report.errors,[]);assert.ok((await evaluate('window.__sceneRequests')).every(request=>request.includeAnimation===true&&!request.draft));
 report.steps.push('A deliberately mismatched animation snapshot disables only playback and leaves the static scene available. Refresh repairs the attachment. All author paths and bytes remain unchanged, no write request or build job is issued.');
 report.authorFilesUnchanged=true;report.authorFileCount=Object.keys(initial).length;report.requests=await evaluate('window.__sceneRequests');for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));}
