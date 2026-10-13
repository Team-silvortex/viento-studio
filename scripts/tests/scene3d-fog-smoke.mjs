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
const output=path.resolve(process.env.VIENTO_SCENE3D_OUTPUT||path.join(os.tmpdir(),`viento-scene3d-fog-browser-${Date.now()}`));
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Choose a new empty VIENTO_SCENE3D_OUTPUT.');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),json=value=>JSON.stringify(value,null,2)+'\n';
const cleanups=[],t={after:fn=>cleanups.push(fn)};
const report={startedAt:new Date().toISOString(),steps:[],errors:[],screenshots:[],modules:[],dialogs:[],svgRequests:[],cspViolations:[],limitations:[
 'Real HTTP editor, native/WASM source semantics and WebGL2 draws/readPixels; no installed desktop, Android or hardware-GPU claim.',
 'Browser renderer/vendor are recorded explicitly; headless Chrome may use a software GPU implementation.',
 'Godot probe evidence is separate; this does not claim cross-engine pixel equality.',
 'Independent background, author camera and light changes apply only to the source draft. Native source operations do not grant renderer, backend or implicit Save authority.'
]};
report.node={version:process.version,sha256:hash(await fs.readFile(process.execPath))};
const sources=['scripts/tests/scene3d-fog-smoke.mjs','engine/scene3d-environment.mjs','engine/scene3d-authoring.mjs','web/modules/app-scene3d-environment.js','web/scene3d-environment.css','engine/scene3d-transform.mjs','web/modules/app-scene3d-transforms.js','web/scene3d-transforms.css','engine/scene3d.mjs','engine/studio-core.mjs','engine/studio-modules.mjs','web/modules/app-scene3d-preview.js','web/modules/scene3d-renderer.js','web/modules/scene3d-math.js','web/modules/app-studio-system.js','web/modules/app-runtime.js','web/scene3d.css','web/i18n/en.js','web/i18n/ja.js'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));
let socket,captureFailure;
const wait=async(fn,label)=>{for(let n=0;n<450;n++){if(await fn())return;await delay(100);}throw Error(`Timed out: ${label}`);};
try {
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-scene3d-fog-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
 const root=path.join(temporary,'workspace'),template=PROJECT_TEMPLATE_CATALOG.templates.find(item=>item.packageId==='org.viento.oc-game');assert.ok(template);
 const write=async(name,content)=>{const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);};
 for(const name of ['documents','templates','metadata/documents','metadata/assets','assets'])await fs.mkdir(path.join(root,name),{recursive:true});
 await write('workspace.json',json({format:'viento-workspace',version:3,id:randomUUID(),name:'3D preview source owner',createdAt:0,...WORKSPACE_LAYOUT,documentTypes:template.documentTypes,projectTemplate:{packageId:template.packageId,version:template.version},studioProfile:{format:'viento-studio-profile',schemaVersion:1,required:[{capability:'scene.preview.scene3d',apiVersion:1},{capability:'scene.authoring.transforms3d',apiVersion:1},{capability:'scene.authoring.objects3d',apiVersion:1},{capability:'scene.authoring.environment3d',apiVersion:1}],optional:[]}}));
 for(const[name,content]of Object.entries(template.templates))await write(`templates/${name}`,content);
 await registerWorkspace(root);const execute=createWorldCommandService(root),world=await readWorldProjection(root),objectId=randomUUID(),sourcePath='documents/scenes/three-boxes.json';
 const scene={format:'viento-scene3d',schemaVersion:1,name:'Three shaded boxes',viewport:[800,600],background:'#142538',camera:{position:[5,4,8],target:[0,0,0],fovDegrees:50,near:.1,far:1000},light:{direction:[1,-2,-1],color:'#ffffff',energy:1},objects:[
  {instanceId:randomUUID(),name:'Copper box',primitive:'box',position:[-1.3,0,0],rotationDegrees:[23,-41,67],size:[1.7,1.3,1],color:'#eb9869'},
  {instanceId:randomUUID(),name:'Mint box',primitive:'box',position:[1.2,0,0],rotationDegrees:[0,20,0],size:[1.1,2,1.1],color:'#85d7bb'},
  {instanceId:randomUUID(),name:'Blue box',primitive:'box',position:[0,-1.4,0],rotationDegrees:[0,0,0],size:[5,.3,3],color:'#5599dd'}]};
 const original='\ufeff'+json(scene).replaceAll('\n','\r\n');
 await execute({command:'object.create',mode:'apply',worldId:world.world.id,baseRevision:world.world.revision,actorRef:{kind:'tool',id:'scene3d-environment-smoke'},objectId,documentType:'level',sourcePath,content:original});
 const env={...process.env,VIENTO_APP_ROOT:appRoot,VIENTO_WORKSPACE_ROOT:root,XDG_CACHE_HOME:path.join(temporary,'cache')};
 for(const key of ['VIENTO_GODOT_BIN','VIENTO_BEVY_BIN','VIENTO_EXECUTION_BACKEND','VIENTO_SESSION_TOKEN','VIENTO_PREFERENCES_PATH'])delete env[key];
 await runCommand(process.execPath,[path.join(appRoot,'scripts/ops/rebuild.mjs')],{cwd:appRoot,env});const base=await serve(t,appRoot,env),readSource=()=>fs.readFile(path.join(root,sourcePath),'utf8');
 const chromeRoot=path.join(temporary,'chrome');await fs.mkdir(chromeRoot);
 const chrome=spawn(process.argv[2]||'/usr/bin/google-chrome',['--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--no-first-run','--no-default-browser-check',`--user-data-dir=${chromeRoot}`,'--remote-debugging-port=0','--window-size=1440,1080','about:blank'],{stdio:'ignore'});
 cleanups.push(async()=>{if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}});
 let port;await wait(async()=>{try{port=(await fs.readFile(path.join(chromeRoot,'DevToolsActivePort'),'utf8')).split('\n')[0];return!!port;}catch{return false;}},'Chrome startup');
 const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await once(socket,'open');
 let sequence=0;const pending=new Map();const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const item=pending.get(data.id);pending.delete(data.id);data.error?item?.reject(Error(data.error.message)):item?.resolve(data.result);}else if(data.method==='Page.javascriptDialogOpening'){report.dialogs.push({type:data.params.type,message:data.params.message});call('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});}else if(data.method==='Runtime.exceptionThrown')report.errors.push(data.params.exceptionDetails);else if(data.method==='Log.entryAdded'&&/Content Security Policy|style-src|violat.*policy/i.test(data.params.entry.text))report.cspViolations.push(data.params.entry);else if(data.method==='Network.requestWillBeSent'){if(data.params.request.url.includes('/web/modules/'))report.modules.push(new URL(data.params.request.url).pathname);if(/\.svg(?:$|\?)/.test(data.params.request.url))report.svgRequests.push(data.params.request.url);}});
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
 const pixels=(background=scene.background)=>{const rgb=[1,3,5].map(index=>parseInt(background.slice(index,index+2),16));return evaluate(`(()=>{const c=document.querySelector('#scene3dCanvas'),g=c?.getContext('webgl2');if(!g)return null;const p=new Uint8Array(c.width*c.height*4);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,p);let hash=2166136261,nonBackground=0;for(let i=0;i<p.length;i+=4){if(p[i]!==${rgb[0]}||p[i+1]!==${rgb[1]}||p[i+2]!==${rgb[2]})nonBackground++;for(let n=0;n<3;n++)hash=Math.imul(hash^p[i+n],16777619)>>>0;}const ext=g.getExtension('WEBGL_debug_renderer_info');return{hash,nonBackground,width:c.width,height:c.height,version:g.getParameter(g.VERSION),renderer:ext?g.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,vendor:ext?g.getParameter(ext.UNMASKED_VENDOR_WEBGL):null,error:g.getError(),background:${JSON.stringify(background)}};})()`);};
 captureFailure=async()=>{await screenshot('failure.png');report.savedBytes=await readSource();report.saveEvents=await evaluate("window.__saveEvents||[]");report.failureState=await evaluate("({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,system:(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()})");};
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Log.enable');report.browser=(await call('Browser.getVersion')).product;
 await call('Page.navigate',{url:`${base}/web/?mode=edit`});await wait(()=>state(`appState.editBackendAvailable&&appState.docs.some(d=>d.id===${JSON.stringify(objectId)})`),'real JSON editor');
 // The registered scene is the only author document in this fixture.
 await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>state('appState.isEditing'),'ordinary editing');await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');await enabled('#scene3dPreviewBtn');

 const decode=content=>JSON.parse(content.replace(/^\ufeff/,'')),visible=content=>content.replace(/\r\n?/g,'\n');
 const system=await evaluate("(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()");report.system=system;
 assert.ok(system.initializedModules.includes('org.viento.scene3d-environment'));assert.equal(system.initializedModules.length,17);assert.equal(system.plan.capabilities.length,33);
 assert.ok(system.plan.requests.every(item=>item.status==='supported'));const sourceBefore=await sourceValue();assert.equal(sourceBefore,visible(original));
 const columns=async()=>{const actual=await evaluate("Object.fromEntries(['CameraPositionX','CameraTargetX','LightDirectionX','Near','Background','Fov','LightColor','LightEnergy'].map(s=>{const e=document.querySelector('#scene3dEnvironment'+s).closest('fieldset').querySelector('.scene3d-environment-inputs');return[s,getComputedStyle(e).gridTemplateColumns.split(/\\s+/).length];}))");
  assert.deepEqual(actual,{CameraPositionX:3,CameraTargetX:3,LightDirectionX:3,Near:2,Background:1,Fov:1,LightColor:1,LightEnergy:1});(report.columnChecks||=[]).push({viewport:await evaluate('innerWidth'),columns:actual});};
 const environmentOpen=async()=>{await enabled('#scene3dEnvironmentBtn');await click('#scene3dEnvironmentBtn');await wait(()=>evaluate("document.querySelector('#scene3dEnvironmentDialog').open&&!document.querySelector('#scene3dEnvironmentBackgroundSelected').disabled"),'environment form source loaded');await columns();};
 const environmentClose=async()=>{await click('#scene3dEnvironmentCancel');await wait(()=>evaluate("!document.querySelector('#scene3dEnvironmentDialog').open"),'environment form cancelled');};
 const formSet=async(suffix,value,event=true)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify('#scene3dEnvironment'+suffix)});e.value=${JSON.stringify(String(value))};${event?"e.dispatchEvent(new Event('input',{bubbles:true}));":''}})()`);
 const check=async()=>{await enabled('#scene3dEnvironmentCheck');await click('#scene3dEnvironmentCheck');await wait(()=>evaluate("!document.querySelector('#scene3dEnvironmentCheck').disabled"),'environment check returns');};
 const reviewedSource=()=>evaluate("document.querySelector('#scene3dEnvironmentSource').textContent");
 const applyEnvironment=async expected=>{await enabled('#scene3dEnvironmentApply');await click('#scene3dEnvironmentApply');await wait(()=>evaluate("!document.querySelector('#scene3dEnvironmentDialog').open"),'environment exact receipt accepted');assert.equal(await sourceValue(),visible(expected));assert.equal(await state('appState.editHasUnsavedChanges'),true);};
 const saveExact=async expected=>{await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(()=>readSource().then(value=>value===expected),'ordinary Save exact environment candidate');await wait(()=>state('!appState.isSaving&&!appState.editHasUnsavedChanges'),'ordinary Save returns clean');};

 await open(); const clearPixels=await pixels(); assert.ok(clearPixels.nonBackground>1000); report.clearPixels=clearPixels; await close();
 await environmentOpen(); assert.equal(await evaluate("document.querySelector('#scene3dEnvironmentFogSelected').checked"),false);
 await click('#scene3dEnvironmentFogSelected'); await formSet('FogColor','#aabbcc'); await formSet('FogDensity',.15); await check();
 const fogCandidate=await reviewedSource(); assert.deepEqual(decode(fogCandidate).fog,{color:'#aabbcc',density:.15});
 assert.deepEqual(decode(fogCandidate).objects,scene.objects); assert.equal(await readSource(),original); assert.equal(await sourceValue(),sourceBefore);
 await environmentClose(); assert.equal(await readSource(),original); report.steps.push('Native fog review and Cancel preserve both draft and saved source.');
 for(const language of ['zh-CN','en','ja']) {
   await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
   await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
   await environmentOpen(); await click('#scene3dEnvironmentFogSelected'); await formSet('FogDensity',.15); await check();
   assert.deepEqual(decode(await reviewedSource()).fog,{color:'#aabbcc',density:.15});
   await evaluate("document.querySelector('#scene3dEnvironmentFogSelected').scrollIntoView({block:'center'})");
   const layout=await evaluate("(()=>{const d=document.querySelector('#scene3dEnvironmentDialog'),e=document.querySelector('#scene3dEnvironmentFogDensity');return {width:d.clientWidth,scrollWidth:d.scrollWidth,density:e.value,label:e.getAttribute('aria-label')};})()");
   assert.ok(layout.scrollWidth<=layout.width+1); assert.equal(layout.density,'0.15'); (report.languages||=[]).push({language,...layout});
   await screenshot(`fog-${language}-390.png`); await environmentClose();
 }
 await call('Emulation.clearDeviceMetricsOverride'); await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");
 await environmentOpen(); await click('#scene3dEnvironmentFogSelected'); await formSet('FogDensity',.15); await check();
 const applied=await reviewedSource(); await applyEnvironment(applied); assert.equal(await readSource(),original);
 await open(); report.fogPixels=await pixels(); assert.notEqual(report.fogPixels.hash,clearPixels.hash); assert.equal(report.fogPixels.error,0); await screenshot('fog-preview.png'); await close();
 await saveExact(applied); await environmentOpen(); assert.equal(await evaluate("document.querySelector('#scene3dEnvironmentFogDensity').value"),'0.15');
 assert.equal(await evaluate("document.querySelector('#scene3dEnvironmentFogColor').value"),'#aabbcc');
 await click('#scene3dEnvironmentFogSelected'); await formSet('FogDensity',0); await check(); const off=await reviewedSource();
 assert.deepEqual(decode(off).fog,{color:'#aabbcc',density:0}); await applyEnvironment(off); await open(); report.offPixels=await pixels(); assert.equal(report.offPixels.hash,clearPixels.hash); await close();
 await saveExact(off); report.steps.push('Fog applies to the unsaved draft, ordinary Save persists it, and reopening restores the values. Density zero restores the exact no-fog preview pixels.');

 // Independent GPU samples verify the stated exponential distance law, not only that pixels changed.
 report.gpuFormula=await evaluate(`(async()=>{
   const {createScene3DRenderer}=await import('/web/modules/scene3d-renderer.js');
   const c=document.createElement('canvas');c.width=300;c.height=200;document.body.append(c);
   const renderer=createScene3DRenderer(c,{pixelRatio:()=>1,observe:()=>null});if(!renderer)throw Error('WebGL2 unavailable');
   const base={background:'#123456',camera:{position:[0,0,8],target:[0,0,0],fovDegrees:50,near:.1,far:100},light:{direction:[1,-2,-1],color:'#ffffff',energy:0},objects:[{instanceId:'00000000-0000-4000-8000-000000000001',position:[0,0,0],rotationDegrees:[0,0,0],size:[4,4,4],color:'#ff0000'}]};
   const g=c.getContext('webgl2'),cases=[];
   const pixel=(x,y)=>{const a=new Uint8Array(4);g.readPixels(x,y,1,1,g.RGBA,g.UNSIGNED_BYTE,a);return [...a];};
   try{for(const projection of ['perspective','orthographic'])for(const z of [8,12])for(const density of [0,.1,.5])for(const shift of [0,90000]){
     const m=structuredClone(base);m.camera.position[2]=z;m.fog={color:'#ffffff',density};
     for(const v of [m.camera.position,m.camera.target,m.objects[0].position])for(let i=0;i<3;i++)v[i]+=shift;
     renderer.setModel(m);renderer.setProjectionMode(projection);const got=pixel(Math.floor(c.width/2),Math.floor(c.height/2)),amount=1-Math.exp(-density*(z-2));
     const expected=[.2*(1-amount)+amount,amount,amount].map(v=>Math.round(v*255));
     const background=pixel(0,0);cases.push({projection,z,density,shift,got,expected,background,error:g.getError(),hit:renderer.hitTest(c.getBoundingClientRect().left+c.getBoundingClientRect().width/2,c.getBoundingClientRect().top+c.getBoundingClientRect().height/2)});
   }}finally{renderer.dispose();c.remove();}return cases;
 })()`);
 for(const entry of report.gpuFormula){assert.ok(entry.got.slice(0,3).every((v,i)=>Math.abs(v-entry.expected[i])<=2),JSON.stringify(entry));assert.deepEqual(entry.background,[18,52,86,255]);assert.equal(entry.error,0);assert.equal(entry.hit,'00000000-0000-4000-8000-000000000001');}
 report.steps.push('24 real GPU samples cover both projection modes, two camera distances, zero and positive densities, and a 90000-unit translated origin. Pixel channels match the exponential radial-distance formula within 2/255; background and picking stay independent.');
 report.savedSourceSha256=hash(await readSource()); report.coreWasmSha256=hash(await fs.readFile(path.join(appRoot,'engine/studio-core.wasm')));
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.svgRequests,[]);assert.deepEqual(report.cspViolations,[]);report.modules=[...new Set(report.modules)].sort();assert.ok(report.modules.includes('/web/modules/app-scene3d-environment.js'));
 report.sourcesFinal=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));report.sourceStableDuringProof=JSON.stringify(report.sourcesFinal)===JSON.stringify(report.sources);assert.equal(report.sourceStableDuringProof,true);report.ok=true;report.status='passed';
} catch(error){await captureFailure?.().catch(()=>{});report.status='failed';report.failure=String(error.stack||error);process.exitCode=1;}
finally{socket?.close();for(const cleanup of cleanups.reverse())await cleanup();report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),json(report));console.log(json(report));}
