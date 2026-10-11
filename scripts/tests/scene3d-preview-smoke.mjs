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
const output=path.resolve(process.env.VIENTO_SCENE3D_OUTPUT||path.join(os.tmpdir(),`viento-scene3d-browser-${Date.now()}`));
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Choose a new empty VIENTO_SCENE3D_OUTPUT.');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),json=value=>JSON.stringify(value,null,2)+'\n';
const cleanups=[],t={after:fn=>cleanups.push(fn)};
const report={startedAt:new Date().toISOString(),steps:[],errors:[],screenshots:[],modules:[],limitations:[
 'Real HTTP editor, native/WASM source semantics and WebGL2 draws/readPixels; no installed desktop, Android or hardware-GPU claim.',
 'Browser renderer/vendor are recorded explicitly; headless Chrome may use a software GPU implementation.',
 'Unsupported-renderer phase injects getContext(webgl2)=null only; all source semantics and editor Save remain real.',
 'Readonly orbit/zoom/reset cannot author a scene. No textures, hierarchy, physics or asset-format support is implied.'
]};
report.node={version:process.version,sha256:hash(await fs.readFile(process.execPath))};
const sources=['scripts/tests/scene3d-preview-smoke.mjs','engine/scene3d.mjs','engine/studio-core.mjs','engine/studio-modules.mjs','web/modules/app-scene3d-preview.js','web/modules/scene3d-renderer.js','web/modules/scene3d-math.js','web/modules/app-studio-system.js','web/modules/app-runtime.js','web/scene3d.css','web/i18n/en.js','web/i18n/ja.js'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));
let socket,captureFailure;
const wait=async(fn,label)=>{for(let n=0;n<450;n++){if(await fn())return;await delay(100);}throw Error(`Timed out: ${label}`);};
try {
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-scene3d-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
 const root=path.join(temporary,'workspace'),template=PROJECT_TEMPLATE_CATALOG.templates.find(item=>item.packageId==='org.viento.oc-game');assert.ok(template);
 const write=async(name,content)=>{const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);};
 for(const name of ['documents','templates','metadata/documents','metadata/assets','assets'])await fs.mkdir(path.join(root,name),{recursive:true});
 await write('workspace.json',json({format:'viento-workspace',version:3,id:randomUUID(),name:'3D preview source owner',createdAt:0,...WORKSPACE_LAYOUT,documentTypes:template.documentTypes,projectTemplate:{packageId:template.packageId,version:template.version},studioProfile:{format:'viento-studio-profile',schemaVersion:1,required:[{capability:'scene.preview.scene3d',apiVersion:1}],optional:[]}}));
 for(const[name,content]of Object.entries(template.templates))await write(`templates/${name}`,content);
 await registerWorkspace(root);const execute=createWorldCommandService(root),world=await readWorldProjection(root),objectId=randomUUID(),sourcePath='documents/scenes/three-boxes.json';
 const scene={format:'viento-scene3d',schemaVersion:1,name:'Three shaded boxes',viewport:[800,600],background:'#142538',camera:{position:[5,4,8],target:[0,0,0],fovDegrees:50,near:.1,far:100},light:{direction:[1,-2,-1],color:'#ffffff',energy:1},objects:[
  {instanceId:randomUUID(),name:'Copper box',primitive:'box',position:[-1.3,0,0],rotationDegrees:[23,-41,67],size:[1.7,1.3,1],color:'#eb9869'},
  {instanceId:randomUUID(),name:'Mint box',primitive:'box',position:[1.2,0,0],rotationDegrees:[0,20,0],size:[1.1,2,1.1],color:'#85d7bb'},
  {instanceId:randomUUID(),name:'Blue box',primitive:'box',position:[0,-1.4,0],rotationDegrees:[0,0,0],size:[5,.3,3],color:'#5599dd'}]};
 const original='\ufeff'+json(scene).replaceAll('\n','\r\n');
 await execute({command:'object.create',mode:'apply',worldId:world.world.id,baseRevision:world.world.revision,actorRef:{kind:'tool',id:'scene3d-preview-smoke'},objectId,documentType:'level',sourcePath,content:original});
 const env={...process.env,VIENTO_APP_ROOT:appRoot,VIENTO_WORKSPACE_ROOT:root,XDG_CACHE_HOME:path.join(temporary,'cache')};
 for(const key of ['VIENTO_GODOT_BIN','VIENTO_BEVY_BIN','VIENTO_EXECUTION_BACKEND','VIENTO_SESSION_TOKEN','VIENTO_PREFERENCES_PATH'])delete env[key];
 await runCommand(process.execPath,[path.join(appRoot,'scripts/ops/rebuild.mjs')],{cwd:appRoot,env});const base=await serve(t,appRoot,env),readSource=()=>fs.readFile(path.join(root,sourcePath),'utf8');
 const chromeRoot=path.join(temporary,'chrome');await fs.mkdir(chromeRoot);
 const chrome=spawn(process.argv[2]||'/usr/bin/google-chrome',['--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--no-first-run','--no-default-browser-check',`--user-data-dir=${chromeRoot}`,'--remote-debugging-port=0','--window-size=1440,1080','about:blank'],{stdio:'ignore'});
 cleanups.push(async()=>{if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}});
 let port;await wait(async()=>{try{port=(await fs.readFile(path.join(chromeRoot,'DevToolsActivePort'),'utf8')).split('\n')[0];return!!port;}catch{return false;}},'Chrome startup');
 const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await once(socket,'open');
 let sequence=0;const pending=new Map();const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const item=pending.get(data.id);pending.delete(data.id);data.error?item?.reject(Error(data.error.message)):item?.resolve(data.result);}else if(data.method==='Runtime.exceptionThrown')report.errors.push(data.params.exceptionDetails);else if(data.method==='Network.requestWillBeSent'&&data.params.request.url.includes('/web/modules/'))report.modules.push(new URL(data.params.request.url).pathname);});
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
 await call('Page.navigate',{url:`${base}/web/?mode=edit`});await wait(()=>state(`appState.editBackendAvailable&&appState.docs.some(d=>d.id===${JSON.stringify(objectId)})`),'real JSON editor');
 // The registered scene is the only author document in this fixture.
 await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>state('appState.isEditing'),'ordinary editing');await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');await enabled('#scene3dPreviewBtn');
 const system=await evaluate("(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()");report.system=system;assert.ok(system.initializedModules.includes('org.viento.scene3d'));assert.equal(system.plan.requests[0].status,'supported');assert.equal(system.hostCapabilities.projectBuild,true);
 const sourceBefore=await sourceValue();await open();const first=await pixels();assert.ok(first&&first.nonBackground>1000);assert.equal(first.error,0);assert.match(first.version,/WebGL 2/);report.gpu=first;
 assert.equal(await sourceValue(),sourceBefore);assert.equal(await readSource(),original);assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#scene3dObjects button'),x=>x.dataset.instanceId)"),scene.objects.map(x=>x.instanceId));
 assert.match(await evaluate("document.querySelector('#scene3dInspector').innerText"),/\/objects\/0/);await screenshot('scene3d-desktop.png');report.steps.push('Actual HTTP runtime mounts the independent eighth module and renders three shaded boxes through WebGL2; authored identities and exact source locations remain inspectable.');
 const center=await evaluate("(()=>{const r=document.querySelector('#scene3dCanvas').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()");
 await call('Input.dispatchMouseEvent',{type:'mousePressed',...center,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:center.x+70,y:center.y+25,button:'left',buttons:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:center.x+70,y:center.y+25,button:'left',buttons:0,clickCount:1});
 const orbited=await pixels();assert.notEqual(orbited.hash,first.hash);await click('#scene3dReset');assert.equal((await pixels()).hash,first.hash);assert.equal(await sourceValue(),sourceBefore);assert.equal(await readSource(),original);
 report.steps.push('Real pointer orbit changes rendered pixels; reset restores the authored camera exactly without source, metadata or Save writes.');
 await close();const edited=structuredClone(scene);edited.objects[0].rotationDegrees=[-10,70,5];let draft='\ufeff'+json(edited);await input(draft);assert.equal(await state('appState.editHasUnsavedChanges'),true);await open();const rotated=await pixels();assert.notEqual(rotated.hash,first.hash);assert.equal(await readSource(),original);
 report.steps.push('Unsaved source rotation changes the actual GPU image while author files retain their original saved bytes.');
 // Change only the visible raw editor while the preview is open; this avoids
 // invoking private view/controller APIs and exercises the real source port.
 await input('{"format":"viento-scene3d","schemaVersion":1}');await refresh();assert.equal((await pixels()).hash,rotated.hash);assert.match(await evaluate("document.querySelector('#scene3dStatus').textContent"),/保留上一次有效/);assert.ok(await evaluate("document.querySelector('#scene3dDiagnostics').textContent.length>0"));assert.equal(await readSource(),original);await screenshot('scene3d-invalid-retained.png');
 await input(draft);await refresh();assert.equal((await pixels()).hash,rotated.hash);report.steps.push('Invalid raw source reports native diagnostics and retains the previous valid GPU model; correcting and refreshing recovers without an implicit Save.');
 edited.viewport=[1280,720];draft='\ufeff'+json(edited);await input(draft);await refresh();assert.equal(await evaluate("document.querySelector('#scene3dSurface').style.aspectRatio"),'1280 / 720');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 for(const language of ['zh-CN','en','ja']){await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);await delay(120);await evaluate("document.querySelector('#scene3dDialog').scrollTop=0");await delay(80);
  assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth||document.querySelector('#scene3dDialog').scrollWidth>document.querySelector('#scene3dDialog').clientWidth"),false);
  const current=await pixels();assert.ok(current.nonBackground>100);assert.ok(current.width<first.width);report.resize=current;await screenshot(`scene3d-${language}-390.png`);
  await click('#scene3dReset');assert.ok(await evaluate("(()=>{const r=document.querySelector('#scene3dReset').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()"));
 }
 report.steps.push('Actual ResizeObserver redraws bounded buffers at 390 px; Chinese, English and Japanese controls/inspector remain scrollable without horizontal overflow.');
 await evaluate("window.__closed3dCanvas=document.querySelector('#scene3dCanvas')");await close();await wait(()=>evaluate("window.__closed3dCanvas.getContext('webgl2').isContextLost()"),'released WebGL context');
 assert.equal(await readSource(),original);await call('Emulation.clearDeviceMetricsOverride');await settleFrames();await enabled('#docSaveBtn');await evaluate("(()=>{window.__saveEvents=[];document.querySelector('#docSaveBtn').addEventListener('click',e=>window.__saveEvents.push({type:e.type,trusted:e.isTrusted,disabled:e.currentTarget.disabled}));})()");await click('#docSaveBtn');report.saveHit=await evaluate("(()=>{const e=document.querySelector('#docSaveBtn'),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML,disabled:e.disabled};})()");await wait(async()=>{const raw=await readSource();return JSON.parse(raw.replace(/^\ufeff/,'' )).objects[0].rotationDegrees[1]===70;},'ordinary source Save');
 const saved=await readSource();assert.ok(saved.startsWith('\ufeff'));assert.ok(saved.includes('\r\n'));assert.equal(await state('appState.editHasUnsavedChanges'),false);await open();assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#scene3dObjects button'),x=>x.dataset.instanceId)"),scene.objects.map(x=>x.instanceId));assert.ok((await pixels()).nonBackground>100);await close();
 report.steps.push('Closing loses the owned WebGL context. Ordinary editor Save preserves BOM/CRLF and stable object IDs, and reopening renders the persisted scene.');
 // Native 3D capability failure must not disable the separately mounted 2D/build view.
 const injection=await call('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const old=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl2'?null:old.call(this,kind,...args);};})()"});
 await call('Page.navigate',{url:`${base}/web/?mode=edit&no-webgl=1`});await wait(()=>state('appState.editBackendAvailable'),'fallback editor');await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>state('appState.isEditing'),'fallback edit');await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');await open();
 assert.equal(await evaluate("document.querySelector('#scene3dFallback').hidden"),false);assert.equal(await evaluate("document.querySelector('#scene3dReset').disabled"),true);assert.equal(await evaluate("document.querySelectorAll('#scene3dObjects button').length"),3);assert.ok(!(await evaluate("document.querySelector('#projectBuildBtn').hidden")));assert.equal(await readSource(),saved);await screenshot('scene3d-webgl-unavailable.png');await close();await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier});
 report.steps.push('An explicitly injected unavailable-WebGL2 device shows verified declarations and a clear no-render fallback; the existing project/2D build entry stays mounted and saved author data is unchanged.');
 assert.deepEqual(report.errors,[]);report.modules=[...new Set(report.modules)].sort();assert.ok(report.modules.includes('/web/modules/app-scene3d-preview.js'));assert.ok(report.modules.includes('/web/modules/scene3d-renderer.js'));report.sourcesFinal=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));report.sourceStableDuringProof=JSON.stringify(report.sourcesFinal)===JSON.stringify(report.sources);assert.equal(report.sourceStableDuringProof,true);report.ok=true;report.status='passed';
} catch(error){await captureFailure?.().catch(()=>{});report.status='failed';report.failure=String(error.stack||error);process.exitCode=1;}
finally{socket?.close();for(const cleanup of cleanups.reverse())await cleanup();report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),json(report));console.log(json(report));}
