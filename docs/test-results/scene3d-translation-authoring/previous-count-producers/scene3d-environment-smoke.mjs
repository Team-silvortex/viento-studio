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
const output=path.resolve(process.env.VIENTO_SCENE3D_OUTPUT||path.join(os.tmpdir(),`viento-scene3d-environment-browser-${Date.now()}`));
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Choose a new empty VIENTO_SCENE3D_OUTPUT.');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),json=value=>JSON.stringify(value,null,2)+'\n';
const cleanups=[],t={after:fn=>cleanups.push(fn)};
const report={startedAt:new Date().toISOString(),steps:[],errors:[],screenshots:[],modules:[],dialogs:[],svgRequests:[],cspViolations:[],limitations:[
 'Real HTTP editor, native/WASM source semantics and WebGL2 draws/readPixels; no installed desktop, Android or hardware-GPU claim.',
 'Browser renderer/vendor are recorded explicitly; headless Chrome may use a software GPU implementation.',
 'Unsupported-renderer phase injects getContext(webgl2)=null only; all source semantics and editor Save remain real.',
 'Independent background, author camera and light changes apply only to the source draft. Native source operations do not grant renderer, backend or implicit Save authority.'
]};
report.node={version:process.version,sha256:hash(await fs.readFile(process.execPath))};
const sources=['scripts/tests/scene3d-environment-smoke.mjs','engine/scene3d-environment.mjs','engine/scene3d-authoring.mjs','web/modules/app-scene3d-environment.js','web/scene3d-environment.css','engine/scene3d-transform.mjs','web/modules/app-scene3d-transforms.js','web/scene3d-transforms.css','engine/scene3d.mjs','engine/studio-core.mjs','engine/studio-modules.mjs','web/modules/app-scene3d-preview.js','web/modules/scene3d-renderer.js','web/modules/scene3d-math.js','web/modules/app-studio-system.js','web/modules/app-runtime.js','web/scene3d.css','web/i18n/en.js','web/i18n/ja.js'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));
let socket,captureFailure;
const wait=async(fn,label)=>{for(let n=0;n<450;n++){if(await fn())return;await delay(100);}throw Error(`Timed out: ${label}`);};
try {
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-scene3d-environment-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
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
 const chrome=spawn(process.argv[2]||'/usr/bin/google-chrome',['--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--no-first-run','--no-default-browser-check',`--user-data-dir=${chromeRoot}`,'--remote-debugging-port=0','--window-size=1440,1080','about:blank'],{stdio:'ignore'});
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
 assert.ok(system.initializedModules.includes('org.viento.scene3d-environment'));assert.equal(system.initializedModules.length,12);assert.equal(system.plan.capabilities.length,28);
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
 const mixed=async()=>{for(const id of ['Background','CameraPosition','CameraTarget','Fov','Clip','LightDirection','LightColor','LightEnergy'])await click('#scene3dEnvironment'+id+'Selected');
  for(const[id,value]of Object.entries({Background:'#203040',CameraPositionX:8,CameraPositionY:5,CameraPositionZ:10,CameraTargetX:0,CameraTargetY:.3,CameraTargetZ:0,Fov:65,Near:.25,Far:1500,LightDirectionX:-2,LightDirectionY:-3,LightDirectionZ:1,LightColor:'#ffEeCc',LightEnergy:2}))await formSet(id,value);};
 await open();const first=await pixels();assert.ok(first.nonBackground>1000);report.gpu=first;
 const orbit=await evaluate("(()=>{const r=document.querySelector('#scene3dCanvas').getBoundingClientRect();return{x:r.left+r.width*.55,y:r.top+r.height*.4};})()");
 await call('Input.dispatchMouseEvent',{type:'mousePressed',...orbit,button:'left',buttons:1,clickCount:1});
 await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:orbit.x+65,y:orbit.y+25,button:'left',buttons:1});
 await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:orbit.x+65,y:orbit.y+25,button:'left',buttons:0,clickCount:1});await settleFrames();
 const orbited=await pixels();assert.notEqual(orbited.hash,first.hash);report.orbitGpu=orbited;assert.equal(await sourceValue(),sourceBefore);assert.equal(await readSource(),original);await close();
 await environmentOpen();assert.deepEqual(await evaluate("['CameraPositionX','CameraPositionY','CameraPositionZ'].map(s=>Number(document.querySelector('#scene3dEnvironment'+s).value))"),scene.camera.position);
 assert.equal(await evaluate("document.querySelector('#scene3dEnvironmentApply').disabled"),true);assert.equal(await evaluate("getComputedStyle(document.querySelector('#scene3dEnvironmentReview')).display"),'none');
 await click('#scene3dEnvironmentBackgroundSelected');await check();assert.equal(await evaluate("document.querySelector('#scene3dEnvironmentApply').disabled"),true);await environmentClose();
 report.steps.push('Actual eleven-module, twenty-seven-capability runtime mounts the independent environment form. WebGL2 software/hardware identity is recorded. A real temporary orbit changes GPU pixels but does not populate the author-camera form or alter source. Unchanged explicit background cannot authorize Apply.');

 await environmentOpen();await click('#scene3dEnvironmentClipSelected');await formSet('Near',2000);await formSet('Far',3000);await check();await enabled('#scene3dEnvironmentApply');
 const atomicClip=decode(await reviewedSource());assert.equal(atomicClip.camera.near,2000);assert.equal(atomicClip.camera.far,3000);assert.deepEqual(atomicClip.objects,scene.objects);await environmentClose();
 assert.equal(await sourceValue(),sourceBefore);assert.equal(await readSource(),original);
 report.steps.push('Near 2000 and far 3000 are reviewed atomically even though the original far plane was 1000. The candidate is valid without an intermediate invalid clip pair; Cancel preserves original draft and disk. No claim is made that this distant clipping candidate renders visible objects.');

 await environmentOpen();await mixed();await check();await enabled('#scene3dEnvironmentApply');const cancelledCandidate=await reviewedSource(),candidate=decode(cancelledCandidate);
 assert.equal(candidate.background,'#203040');assert.deepEqual(candidate.camera,{position:[8,5,10],target:[0,.3,0],fovDegrees:65,near:.25,far:1500});
 assert.deepEqual(candidate.light,{direction:[-2,-3,1],color:'#ffEeCc',energy:2});assert.deepEqual(candidate.objects,scene.objects);assert.deepEqual(candidate.viewport,scene.viewport);assert.equal(candidate.name,scene.name);
 assert.ok(cancelledCandidate.startsWith('\ufeff'));assert.ok(cancelledCandidate.includes('\r\n'));assert.equal(await sourceValue(),sourceBefore);assert.equal(await readSource(),original);
 assert.deepEqual(Object.keys(await evaluate("JSON.parse(document.querySelector('#scene3dEnvironmentBefore').textContent)")),['background','camera','light']);
 assert.deepEqual(await evaluate("Array.from(document.querySelector('#scene3dEnvironmentChangedPaths').children,x=>x.textContent)"),['/background','/camera/position/0','/camera/position/1','/camera/position/2','/camera/target/1','/camera/fovDegrees','/camera/near','/camera/far','/light/direction/0','/light/direction/1','/light/direction/2','/light/color','/light/energy']);
 await screenshot('environment-desktop-review.png');await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 for(const language of ['zh-CN','en','ja']){await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);await delay(100);await settleFrames();
  assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth||document.querySelector('#scene3dEnvironmentDialog').scrollWidth>document.querySelector('#scene3dEnvironmentDialog').clientWidth"),false);
  assert.equal(await evaluate("document.querySelector('#scene3dEnvironmentNear').value"),'0.25');assert.equal(await evaluate("document.querySelector('#scene3dEnvironmentLightColor').value"),'#ffEeCc');
  assert.equal(await reviewedSource(),cancelledCandidate);assert.equal(await evaluate("document.querySelector('#scene3dEnvironmentApply').disabled"),false);await columns();
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#scene3dEnvironmentReview')).display"),'block');
  await evaluate("document.querySelector('#scene3dEnvironmentDialog').scrollTop=0");await screenshot(`environment-${language}-390.png`);
  await evaluate("document.querySelector('#scene3dEnvironmentDialog').scrollTop=document.querySelector('#scene3dEnvironmentDialog').scrollHeight");
  const footer=await evaluate("(()=>{const r=document.querySelector('#scene3dEnvironmentApply').getBoundingClientRect();return{top:r.top,bottom:r.bottom};})()");assert.ok(footer.top>=0&&footer.bottom<=844);(report.narrowFooterChecks||=[]).push({language,...footer});
 }
 await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");await environmentClose();assert.equal(await sourceValue(),sourceBefore);assert.equal(await readSource(),original);
 report.steps.push('Eight explicit groups review mixed background, camera position/target/FOV/atomic clipping and light direction/color/energy. Complete native BOM/CRLF source preserves objects and other declarations. Chinese/English/Japanese at 390 px retain raw fields and approval, with reachable footer and no horizontal overflow. Cancel writes neither draft nor disk.');

 await environmentOpen();await mixed();await check();const appliedSource=await reviewedSource();assert.equal(appliedSource,cancelledCandidate);await applyEnvironment(appliedSource);assert.equal(await readSource(),original);
 await open();const updated=await pixels(candidate.background);assert.ok(updated.nonBackground>1000);assert.notEqual(updated.hash,first.hash);assert.equal(updated.width,first.width);assert.equal(updated.height,first.height);report.appliedAuthorGpu=updated;await close();
 await saveExact(appliedSource);assert.equal(await readSource(),appliedSource);await environmentOpen();assert.equal(await evaluate("document.querySelector('#scene3dEnvironmentCameraPositionX').value"),'8');assert.equal(await evaluate("document.querySelector('#scene3dEnvironmentFar').value"),'1500');await environmentClose();
 report.steps.push('Exact current-token Apply changes only the unsaved editor memory. A fresh readonly WebGL2 preview renders the authored environment with different pixels. Ordinary Save writes the complete reviewed BOM/CRLF source; reopening reads the saved camera and clip declarations.');

 for(const invalid of ['coincident-camera','invalid-clip','zero-direction']){await environmentOpen();
  if(invalid==='coincident-camera'){await click('#scene3dEnvironmentCameraTargetSelected');for(const[axis,value]of Object.entries({X:8,Y:5,Z:10}))await formSet('CameraTarget'+axis,value);}
  if(invalid==='invalid-clip'){await click('#scene3dEnvironmentClipSelected');await formSet('Near',40);await formSet('Far',10);}
  if(invalid==='zero-direction'){await click('#scene3dEnvironmentLightDirectionSelected');for(const axis of ['X','Y','Z'])await formSet('LightDirection'+axis,0);}
  await check();assert.equal(await evaluate("document.querySelector('#scene3dEnvironmentApply').disabled"),true);assert.equal(await readSource(),appliedSource);assert.equal(await sourceValue(),visible(appliedSource));await environmentClose();}
 await environmentOpen();await click('#scene3dEnvironmentLightEnergySelected');await formSet('LightEnergy',0);await check();await enabled('#scene3dEnvironmentApply');const zero=decode(await reviewedSource());assert.equal(zero.light.energy,0);assert.deepEqual(zero.camera,candidate.camera);await environmentClose();
 report.steps.push('Real native semantic review rejects coincident camera/target, reversed clipping and zero light direction while retaining drafts. Zero light energy is valid and reviewable independently; cancellation leaves source and disk unchanged.');

 await environmentOpen();await click('#scene3dEnvironmentBackgroundSelected');await formSet('Background','#332211');await check();await enabled('#scene3dEnvironmentApply');await input(appliedSource+' ');await delay(100);await click('#scene3dEnvironmentApply');await delay(100);
 assert.equal(await sourceValue(),visible(appliedSource+' '));assert.equal(await readSource(),appliedSource);await environmentClose();await input(appliedSource);
 for(const silent of ['checkbox','number','color']){await environmentOpen();await click('#scene3dEnvironmentBackgroundSelected');await formSet('Background','#332211');await check();await enabled('#scene3dEnvironmentApply');
  if(silent==='checkbox')await evaluate("document.querySelector('#scene3dEnvironmentLightEnergySelected').checked=true");
  if(silent==='number')await formSet('Near',.75,false);if(silent==='color')await formSet('Background','#abcdef',false);
  await click('#scene3dEnvironmentApply');await delay(100);assert.equal(await evaluate("document.querySelector('#scene3dEnvironmentApply').disabled"),true);assert.equal(await sourceValue(),visible(appliedSource));assert.equal(await readSource(),appliedSource);await environmentClose();}
 report.steps.push('Actual raw-source edits after approval revoke source ownership. Silent checkbox, numeric and color mutations each revoke the form signature and cannot reuse approval or overwrite newer author bytes.');

 await environmentOpen();await click('#scene3dEnvironmentLightEnergySelected');await formSet('LightEnergy',.5);await check();const conflictCandidate=await reviewedSource();await applyEnvironment(conflictCandidate);
 const external=appliedSource+'\r\n ';await fs.writeFile(path.join(root,sourcePath),external);await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(()=>evaluate("!document.querySelector('#docSaveConflictDialog').classList.contains('is-hidden')"),'ordinary Save conflict');await screenshot('environment-save-conflict.png');await click('#docSaveConflictCancelBtn');
 await wait(()=>state('!appState.isSaving'),'ordinary conflict cancelled');assert.equal(await readSource(),external);assert.equal(await sourceValue(),visible(conflictCandidate));assert.equal(await state('appState.editHasUnsavedChanges'),true);
 report.steps.push('Environment Apply retains the ordinary Save precondition. A real external saved-file change triggers the existing conflict dialog; Cancel preserves both external disk bytes and the reviewed unsaved environment draft.');

 const injection=await call('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const old=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl2'?null:old.call(this,kind,...args);};})()"});
 await call('Page.navigate',{url:`${base}/web/?mode=edit&no-webgl=1`});await wait(()=>state('appState.editBackendAvailable'),'renderer-independent editor');await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>state('appState.isEditing'),'renderer-independent edit');await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');
 await open();assert.equal(await evaluate("document.querySelector('#scene3dFallback').hidden"),false);await close();await environmentOpen();await click('#scene3dEnvironmentBackgroundSelected');await formSet('Background','#445566');await check();await enabled('#scene3dEnvironmentApply');await screenshot('environment-without-webgl.png');await environmentClose();assert.equal(await readSource(),external);await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier});
 report.steps.push('With WebGL2 alone explicitly injected unavailable, the readonly preview reports that no image was drawn while real native environment review remains available. The form has no renderer, backend, World or Save authority.');

 assert.deepEqual(report.errors,[]);assert.deepEqual(report.svgRequests,[]);assert.deepEqual(report.cspViolations,[]);report.modules=[...new Set(report.modules)].sort();assert.ok(report.modules.includes('/web/modules/app-scene3d-environment.js'));
 report.sourcesFinal=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));report.sourceStableDuringProof=JSON.stringify(report.sourcesFinal)===JSON.stringify(report.sources);assert.equal(report.sourceStableDuringProof,true);report.ok=true;report.status='passed';
} catch(error){await captureFailure?.().catch(()=>{});report.status='failed';report.failure=String(error.stack||error);process.exitCode=1;}
finally{socket?.close();for(const cleanup of cleanups.reverse())await cleanup();report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),json(report));console.log(json(report));}
