// Real HTTP editor / WebGL2 source preview in a disposable author workspace.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { registerWorkspace } from '../lib/workspace.mjs';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';

const appRoot=fileURLToPath(new URL('../../',import.meta.url));
const output=path.resolve(process.env.VIENTO_SCENE3D_OUTPUT||path.join(os.tmpdir(),`viento-scene3d-framing-browser-${Date.now()}`));
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Choose a new empty VIENTO_SCENE3D_OUTPUT.');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),json=value=>JSON.stringify(value,null,2)+'\n';
const cleanups=[],t={after:fn=>cleanups.push(fn)};
const report={startedAt:new Date().toISOString(),steps:[],errors:[],screenshots:[],modules:[],limitations:[
 'Real HTTP editor, native/WASM source semantics and WebGL2 draws/readPixels; no installed desktop, Android or hardware-GPU claim.',
 'Browser renderer/vendor are recorded explicitly; headless Chrome may use a software GPU implementation.',
 'Unsupported-renderer phase injects getContext(webgl2)=null only; all source semantics and editor Save remain real.',
 'Whole-scene framing only navigates the last valid preview; no author camera or source writes. Instrumentation records actual uploaded matrices and forwards WebGL calls unchanged.'
]};
report.node={version:process.version,sha256:hash(await fs.readFile(process.execPath))};
const sources=['scripts/tests/scene3d-framing-smoke.mjs','engine/scene3d.mjs','engine/studio-core.mjs','engine/studio-modules.mjs','web/modules/app-scene3d-preview.js','web/modules/scene3d-renderer.js','web/modules/scene3d-math.js','web/modules/app-studio-system.js','web/modules/app-runtime.js','web/scene3d.css','web/i18n/en.js','web/i18n/ja.js'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));
let socket,captureFailure;
const wait=async(fn,label)=>{for(let n=0;n<450;n++){if(await fn())return;await delay(100);}throw Error(`Timed out: ${label}`);};
try {
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-scene3d-framing-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
 const root=path.join(temporary,'workspace'),template=PROJECT_TEMPLATE_CATALOG.templates.find(item=>item.packageId==='org.viento.oc-game');assert.ok(template);
 const write=async(name,content)=>{const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);};
 for(const name of ['documents','templates','metadata/documents','metadata/assets','assets'])await fs.mkdir(path.join(root,name),{recursive:true});
 await write('workspace.json',json({format:'viento-workspace',version:3,id:randomUUID(),name:'3D preview source owner',createdAt:0,...WORKSPACE_LAYOUT,documentTypes:template.documentTypes,projectTemplate:{packageId:template.packageId,version:template.version},studioProfile:{format:'viento-studio-profile',schemaVersion:1,required:[{capability:'scene.preview.scene3d',apiVersion:1}],optional:[]}}));
 for(const[name,content]of Object.entries(template.templates))await write(`templates/${name}`,content);
 await registerWorkspace(root);const execute=createWorldCommandService(root),world=await readWorldProjection(root),objectId=randomUUID(),sourcePath='documents/scenes/three-boxes.json';
 const scene={format:'viento-scene3d',schemaVersion:1,name:'Three shaded boxes',viewport:[800,600],background:'#142538',camera:{position:[5,4,8],target:[0,0,0],fovDegrees:50,near:.1,far:100},light:{direction:[1,-2,-1],color:'#ffffff',energy:1},objects:[
  {instanceId:randomUUID(),name:'Copper box',primitive:'box',position:[-18,0,0],rotationDegrees:[23,-41,67],size:[4,7,3],color:'#eb9869'},
  {instanceId:randomUUID(),name:'Mint box',primitive:'box',position:[20,2,-3],rotationDegrees:[0,20,0],size:[5,6,4],color:'#85d7bb'},
  {instanceId:randomUUID(),name:'Blue box',primitive:'box',position:[0,4,-20],rotationDegrees:[0,0,0],size:[9,3,6],color:'#5599dd'}]};
 const original='\ufeff'+json(scene).replaceAll('\n','\r\n');
 await execute({command:'object.create',mode:'apply',worldId:world.world.id,baseRevision:world.world.revision,actorRef:{kind:'tool',id:'scene3d-framing-smoke'},objectId,documentType:'level',sourcePath,content:original});
 const env={...process.env,VIENTO_APP_ROOT:appRoot,VIENTO_WORKSPACE_ROOT:root,XDG_CACHE_HOME:path.join(temporary,'cache')};
 for(const key of ['VIENTO_GODOT_BIN','VIENTO_BEVY_BIN','VIENTO_EXECUTION_BACKEND','VIENTO_SESSION_TOKEN','VIENTO_PREFERENCES_PATH'])delete env[key];
 await runCommand(process.execPath,[path.join(appRoot,'scripts/ops/rebuild.mjs')],{cwd:appRoot,env});const base=await serve(t,appRoot,env),readSource=()=>fs.readFile(path.join(root,sourcePath),'utf8');
 const chromeRoot=path.join(temporary,'chrome');await fs.mkdir(chromeRoot);
 const chrome=spawn(process.argv[2]||'/usr/bin/google-chrome',['--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--no-first-run','--no-default-browser-check',`--user-data-dir=${chromeRoot}`,'--remote-debugging-port=0','--window-size=1440,1080','about:blank'],{stdio:'ignore'});
 cleanups.push(async()=>{if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}});
 let port;await wait(async()=>{try{port=(await fs.readFile(path.join(chromeRoot,'DevToolsActivePort'),'utf8')).split('\n')[0];return!!port;}catch{return false;}},'Chrome startup');
 const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await once(socket,'open');
 let sequence=0;const pending=new Map();const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timeout=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},10000);pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});socket.send(JSON.stringify({id,method,params}));});
 socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const item=pending.get(data.id);pending.delete(data.id);data.error?item?.reject(Error(data.error.message)):item?.resolve(data.result);}else if(data.method==='Page.javascriptDialogOpening'){(report.dialogs||=[]).push(data.params);call('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});}else if(data.method==='Runtime.exceptionThrown')report.errors.push(data.params.exceptionDetails);else if(data.method==='Network.requestWillBeSent'&&data.params.request.url.includes('/web/modules/'))report.modules.push(new URL(data.params.request.url).pathname);});
 const evaluate=async expression=>{const data=await call('Runtime.evaluate',{expression:`(async()=>(${expression}))()`,awaitPromise:true,returnByValue:true,userGesture:true});if(data.exceptionDetails)throw Error(JSON.stringify(data.exceptionDetails));return data.result.value;};
 const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);await new Promise(resolve=>setTimeout(resolve,40));const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});for(const[type,buttons]of[['mousePressed',1],['mouseReleased',0]])await call('Input.dispatchMouseEvent',{type,...point,button:'left',buttons,clickCount:1});};
 const enabled=selector=>wait(()=>evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled===false&&document.querySelector(${JSON.stringify(selector)})?.hidden===false`),`${selector} enabled`);
 const input=async content=>evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');e.value=${JSON.stringify(content)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const state=expression=>evaluate(`(()=>import('/web/modules/app-state.js').then(({appState})=>(${expression})))()`);
 const screenshot=async name=>{const data=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,name),Buffer.from(data.data,'base64'));report.screenshots.push(name);};
 const sourceValue=()=>evaluate("document.querySelector('#docSourceEditor').value");
 const settleFrames=()=>evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
 const close=async()=>{await click('#scene3dClose');await wait(()=>evaluate("!document.querySelector('#scene3dDialog').open"),'3D close');};
 const open=async()=>{await enabled('#scene3dPreviewBtn');await click('#scene3dPreviewBtn');await wait(()=>evaluate("document.querySelector('#scene3dDialog').open&&document.querySelector('#scene3dObjects button')"),'3D parsed objects');await settleFrames();};
 const refresh=async()=>{await enabled('#scene3dRefresh');await click('#scene3dRefresh');await wait(()=>evaluate("document.querySelector('#scene3dRefresh').disabled===false"),'3D refresh complete');await settleFrames();};
 const pixels=()=>evaluate(`(()=>{const c=document.querySelector('#scene3dCanvas'),g=c?.getContext('webgl2');if(!g)return null;const p=new Uint8Array(c.width*c.height*4);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,p);let hash=2166136261,nonBackground=0;for(let i=0;i<p.length;i+=4){if(p[i]!==20||p[i+1]!==37||p[i+2]!==56)nonBackground++;for(let n=0;n<3;n++)hash=Math.imul(hash^p[i+n],16777619)>>>0;}const ext=g.getExtension('WEBGL_debug_renderer_info');return{hash,nonBackground,width:c.width,height:c.height,version:g.getParameter(g.VERSION),renderer:ext?g.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,vendor:ext?g.getParameter(ext.UNMASKED_VENDOR_WEBGL):null,error:g.getError()};})()`);
 captureFailure=async()=>{await screenshot('failure.png');report.savedBytes=await readSource();report.saveEvents=await evaluate("window.__saveEvents||[]");report.failureState=await evaluate("({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,system:(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()})");};
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');report.browser=(await call('Browser.getVersion')).product;
 // Observe the real WebGL calls; never replace their inputs, results or drawing.
 await call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
   const proto=WebGL2RenderingContext.prototype, names=new WeakMap(), states=new WeakMap();window.__frameDraws=[];
   const get=proto.getUniformLocation;proto.getUniformLocation=function(...args){const location=get.apply(this,args);if(location)names.set(location,args[1]);return location;};
   const uniform=proto.uniformMatrix4fv;proto.uniformMatrix4fv=function(location,transpose,value,...rest){const state=states.get(this)||{};state[names.get(location)]=Array.from(value);states.set(this,state);return uniform.call(this,location,transpose,value,...rest);};
   const draw=proto.drawArrays;proto.drawArrays=function(...args){if(this.canvas.id==='scene3dCanvas'){const state=states.get(this)||{};window.__frameDraws.push({projection:state.viewProjection?.slice(),model:state.model?.slice(),width:this.canvas.width,height:this.canvas.height});if(window.__frameDraws.length>2048)window.__frameDraws.splice(0,1024);}return draw.apply(this,args);};
 })()`});
 await call('Page.navigate',{url:`${base}/web/?mode=edit`});await wait(()=>state(`appState.editBackendAvailable&&appState.docs.some(d=>d.id===${JSON.stringify(objectId)})`),'real JSON editor');
 // The registered scene is the only author document in this fixture.
 await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>state('appState.isEditing'),'ordinary editing');await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');await enabled('#scene3dPreviewBtn');
 const system=await evaluate("(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()");report.system=system;assert.ok(system.initializedModules.includes('org.viento.scene3d'));assert.equal(system.plan.requests[0].status,'supported');assert.equal(system.hostCapabilities.projectBuild,true);
 const sourceBefore=await sourceValue();await open();const initial=await pixels();assert.equal(initial.error,0);assert.match(initial.version,/WebGL 2/);report.gpu=initial;
 const selected=()=>evaluate("document.querySelector('#scene3dObjects button[aria-pressed=true]')?.dataset.instanceId||null");
 const draws=()=>evaluate('window.__frameDraws.slice(-3)');const initialDraws=await draws();
 const multiply=(matrix,point)=>[0,1,2,3].map(row=>point.reduce((sum,v,col)=>sum+matrix[col*4+row]*v,0));
 async function allCornersFit(label){const frames=await draws();assert.equal(frames.length,3);let corners=0;for(const frame of frames){assert.ok(frame.projection.every(Number.isFinite)&&frame.model.every(Number.isFinite));for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){const clip=multiply(frame.projection,multiply(frame.model,[x,y,z,1]));assert.ok(clip.every(Number.isFinite)&&clip[3]>0);assert.ok(clip.slice(0,3).every(v=>Math.abs(v/clip[3])<=1.00001),JSON.stringify({label,clip}));corners++;}}(report.geometryChecks||=[]).push({label,corners,width:frames[0].width,height:frames[0].height});}
 async function frameAll(){await enabled('#scene3dFocusAll');await click('#scene3dFocusAll');await settleFrames();}
 await frameAll();await allCornersFit('desktop');const first=await pixels();assert.ok(first.nonBackground>1000);assert.notEqual(first.hash,initial.hash);assert.equal(first.error,0);assert.equal(await sourceValue(),sourceBefore);assert.equal(await readSource(),original);await screenshot('framing-desktop.png');
 report.steps.push('Actual mouse click frames all three dispersed rotated boxes; every real Float32 uploaded box corner fits the clip volume. Source draft and saved bytes are unchanged.');
 await click('#scene3dObjects li:nth-child(2) button');assert.equal(await selected(),scene.objects[1].instanceId);await frameAll();const selectedFrame=await pixels();
 await evaluate("(()=>{const e=document.querySelector('#scene3dSearch');e.value='Copper';e.dispatchEvent(new Event('input',{bubbles:true}));})()");assert.equal(await evaluate("document.querySelector('#scene3dSelectionHidden').hidden"),false);await frameAll();await allCornersFit('hidden-selected-filter');assert.equal((await pixels()).hash,selectedFrame.hash);assert.equal(await evaluate("document.querySelector('#scene3dSearch').value"),'Copper');assert.match(await evaluate("document.querySelector('#scene3dInspector').textContent"),new RegExp(scene.objects[1].instanceId));
 await evaluate("(()=>{const e=document.querySelector('#scene3dSearch');e.value='no match';e.dispatchEvent(new Event('input',{bubbles:true}));})()");assert.equal(await evaluate("document.querySelectorAll('#scene3dObjects button').length"),0);await frameAll();assert.equal((await pixels()).hash,selectedFrame.hash);
 report.steps.push('Hidden selected objects and a zero-result filter still frame the complete loaded model. Filtering, selected UUID, inspector and highlighting remain unchanged.');
 await click('#scene3dFocus');assert.notEqual((await pixels()).hash,selectedFrame.hash);await frameAll();assert.equal((await pixels()).hash,selectedFrame.hash);await click('#scene3dReset');assert.deepEqual(await draws(),initialDraws);await frameAll();
 const center=await evaluate("(()=>{const r=document.querySelector('#scene3dCanvas').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()");await call('Input.dispatchMouseEvent',{type:'mousePressed',...center,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:center.x+70,y:center.y+25,button:'left',buttons:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:center.x+70,y:center.y+25,button:'left',buttons:0,clickCount:1});await frameAll();await allCornersFit('after-orbit');assert.equal(await sourceValue(),sourceBefore);assert.equal(await readSource(),original);
 report.steps.push('Object focus, whole-scene focus, pointer orbit and author-camera reset cooperate. Reset restores the exact original GPU matrices; all-scene framing preserves the current heading.');
 await input('{"format":"viento-scene3d","schemaVersion":1}');await refresh();assert.match(await evaluate("document.querySelector('#scene3dStatus').textContent"),/保留上一次有效/);await frameAll();await allCornersFit('invalid-draft-last-valid');assert.ok(await evaluate("document.querySelector('#scene3dDiagnostics').textContent.length>0"));assert.equal(await evaluate("document.querySelector('#scene3dLocate').disabled"),true);assert.equal(await readSource(),original);
 report.steps.push('An invalid edited source keeps native diagnostics and disables exact source location; whole-scene framing continues on the last valid model without saving or clearing that diagnostic.');
 const edited=structuredClone(scene);edited.viewport=[400,800];edited.objects[0].position=[-30,1,4];const draft='\ufeff'+json(edited);await input(draft);await refresh();await frameAll();await allCornersFit('changed-unsaved-model');assert.equal(await readSource(),original);const unsaved=await sourceValue();
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 for(const language of ['zh-CN','en','ja']){await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);await settleFrames();await frameAll();await allCornersFit(language+'-390');assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth||document.querySelector('#scene3dDialog').scrollWidth>document.querySelector('#scene3dDialog').clientWidth"),false);const labels=await evaluate("(async()=>{const {t}=await import('/web/i18n/index.js');return{actual:document.querySelector('#scene3dFocusAll').textContent,expected:t('聚焦全部对象')};})()");assert.equal(labels.actual,labels.expected);assert.ok(await evaluate("(()=>{const r=document.querySelector('#scene3dFocusAll').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()"));await evaluate("document.querySelector('#scene3dDialog').scrollTop=0");await screenshot('framing-'+language+'-390.png');assert.equal(await sourceValue(),unsaved);}
 report.steps.push('A new unsaved model uses its complete new bounds. Chinese, English and Japanese at 390px preserve the entire framing action, source text and scrollable controls; all 24 corners fit each actual resized GPU viewport.');
 await close();await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");await open();await frameAll();await allCornersFit('reopen-unsaved');assert.equal(await sourceValue(),unsaved);assert.equal(await readSource(),original);await close();
 report.steps.push('Closing disposes the view. Reopening reads the current unsaved draft and frames it; author files retain their original bytes throughout.');
 // Finish this disposable unsaved-draft test explicitly before a fresh-device navigation.
 await input(original);await wait(()=>state('!appState.editHasUnsavedChanges'),'fixture draft reset before navigation');assert.equal(await readSource(),original);
 const injection=await call('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const old=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl2'?null:old.call(this,kind,...args);};})()"});
 await call('Page.navigate',{url:`${base}/web/?mode=edit&no-webgl=1`});await wait(()=>state('appState.editBackendAvailable'),'fallback editor');await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>state('appState.isEditing'),'fallback edit');await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');await open();assert.equal(await evaluate("document.querySelector('#scene3dFocusAll').disabled"),true);assert.equal(await evaluate("document.querySelector('#scene3dFallback').hidden"),false);assert.equal(await evaluate("document.querySelectorAll('#scene3dObjects button').length"),3);assert.equal(await readSource(),original);await screenshot('framing-no-webgl.png');await close();await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier});
 report.steps.push('Injected WebGL unavailability disables only view controls, keeps verified declarations and does not change author files.');
 assert.deepEqual(report.errors,[]);assert.equal(system.initializedModules.length,17);assert.equal(system.plan.capabilities.length,33);report.modules=[...new Set(report.modules)].sort();report.sourcesFinal=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));report.sourceStableDuringProof=JSON.stringify(report.sourcesFinal)===JSON.stringify(report.sources);assert.equal(report.sourceStableDuringProof,true);report.ok=true;report.status='passed';
} catch(error){await captureFailure?.().catch(()=>{});report.status='failed';report.failure=String(error.stack||error);process.exitCode=1;}
finally{socket?.close();for(const cleanup of cleanups.reverse())await cleanup();report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),json(report));console.log(json(report));}
