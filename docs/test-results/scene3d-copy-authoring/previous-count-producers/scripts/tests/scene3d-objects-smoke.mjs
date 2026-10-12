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
const output=path.resolve(process.env.VIENTO_SCENE3D_OUTPUT||path.join(os.tmpdir(),`viento-scene3d-objects-browser-${Date.now()}`));
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Choose a new empty VIENTO_SCENE3D_OUTPUT.');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),json=value=>JSON.stringify(value,null,2)+'\n';
const cleanups=[],t={after:fn=>cleanups.push(fn)};
const report={startedAt:new Date().toISOString(),steps:[],errors:[],screenshots:[],modules:[],dialogs:[],svgRequests:[],limitations:[
 'Real HTTP editor, native/WASM source semantics and WebGL2 draws/readPixels; no installed desktop, Android or hardware-GPU claim.',
 'Browser renderer/vendor are recorded explicitly; headless Chrome may use a software GPU implementation.',
 'Unsupported-renderer phase injects getContext(webgl2)=null only; all source semantics and editor Save remain real.',
 'Independent object authoring and transform forms apply only to the source draft. Native source operations do not grant renderer, backend or implicit Save authority.'
]};
report.node={version:process.version,sha256:hash(await fs.readFile(process.execPath))};
const sources=['scripts/tests/scene3d-objects-smoke.mjs','engine/scene3d-objects.mjs','engine/scene3d-authoring.mjs','web/modules/app-scene3d-objects.js','web/scene3d-objects.css','engine/scene3d-transform.mjs','web/modules/app-scene3d-transforms.js','web/scene3d-transforms.css','engine/scene3d.mjs','engine/studio-core.mjs','engine/studio-modules.mjs','web/modules/app-scene3d-preview.js','web/modules/scene3d-renderer.js','web/modules/scene3d-math.js','web/modules/app-studio-system.js','web/modules/app-runtime.js','web/scene3d.css','web/i18n/en.js','web/i18n/ja.js'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));
let socket,captureFailure;
const wait=async(fn,label)=>{for(let n=0;n<450;n++){if(await fn())return;await delay(100);}throw Error(`Timed out: ${label}`);};
try {
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-scene3d-objects-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
 const root=path.join(temporary,'workspace'),template=PROJECT_TEMPLATE_CATALOG.templates.find(item=>item.packageId==='org.viento.oc-game');assert.ok(template);
 const write=async(name,content)=>{const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);};
 for(const name of ['documents','templates','metadata/documents','metadata/assets','assets'])await fs.mkdir(path.join(root,name),{recursive:true});
 await write('workspace.json',json({format:'viento-workspace',version:3,id:randomUUID(),name:'3D preview source owner',createdAt:0,...WORKSPACE_LAYOUT,documentTypes:template.documentTypes,projectTemplate:{packageId:template.packageId,version:template.version},studioProfile:{format:'viento-studio-profile',schemaVersion:1,required:[{capability:'scene.preview.scene3d',apiVersion:1},{capability:'scene.authoring.transforms3d',apiVersion:1},{capability:'scene.authoring.objects3d',apiVersion:1}],optional:[]}}));
 for(const[name,content]of Object.entries(template.templates))await write(`templates/${name}`,content);
 await registerWorkspace(root);const execute=createWorldCommandService(root),world=await readWorldProjection(root),objectId=randomUUID(),sourcePath='documents/scenes/three-boxes.json';
 const scene={format:'viento-scene3d',schemaVersion:1,name:'Three shaded boxes',viewport:[800,600],background:'#142538',camera:{position:[5,4,8],target:[0,0,0],fovDegrees:50,near:.1,far:100},light:{direction:[1,-2,-1],color:'#ffffff',energy:1},objects:[
  {instanceId:randomUUID(),name:'Copper box',primitive:'box',position:[-1.3,0,0],rotationDegrees:[23,-41,67],size:[1.7,1.3,1],color:'#eb9869'},
  {instanceId:randomUUID(),name:'Mint box',primitive:'box',position:[1.2,0,0],rotationDegrees:[0,20,0],size:[1.1,2,1.1],color:'#85d7bb'},
  {instanceId:randomUUID(),name:'Blue box',primitive:'box',position:[0,-1.4,0],rotationDegrees:[0,0,0],size:[5,.3,3],color:'#5599dd'}]};
 const original='\ufeff'+json(scene).replaceAll('\n','\r\n');
 await execute({command:'object.create',mode:'apply',worldId:world.world.id,baseRevision:world.world.revision,actorRef:{kind:'tool',id:'scene3d-objects-smoke'},objectId,documentType:'level',sourcePath,content:original});
 const env={...process.env,VIENTO_APP_ROOT:appRoot,VIENTO_WORKSPACE_ROOT:root,XDG_CACHE_HOME:path.join(temporary,'cache')};
 for(const key of ['VIENTO_GODOT_BIN','VIENTO_BEVY_BIN','VIENTO_EXECUTION_BACKEND','VIENTO_SESSION_TOKEN','VIENTO_PREFERENCES_PATH'])delete env[key];
 await runCommand(process.execPath,[path.join(appRoot,'scripts/ops/rebuild.mjs')],{cwd:appRoot,env});const base=await serve(t,appRoot,env),readSource=()=>fs.readFile(path.join(root,sourcePath),'utf8');
 const chromeRoot=path.join(temporary,'chrome');await fs.mkdir(chromeRoot);
 const chrome=spawn(process.argv[2]||'/usr/bin/google-chrome',['--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--no-first-run','--no-default-browser-check',`--user-data-dir=${chromeRoot}`,'--remote-debugging-port=0','--window-size=1440,1080','about:blank'],{stdio:'ignore'});
 cleanups.push(async()=>{if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}});
 let port;await wait(async()=>{try{port=(await fs.readFile(path.join(chromeRoot,'DevToolsActivePort'),'utf8')).split('\n')[0];return!!port;}catch{return false;}},'Chrome startup');
 const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await once(socket,'open');
 let sequence=0;const pending=new Map();const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const item=pending.get(data.id);pending.delete(data.id);data.error?item?.reject(Error(data.error.message)):item?.resolve(data.result);}else if(data.method==='Page.javascriptDialogOpening'){report.dialogs.push({type:data.params.type,message:data.params.message});call('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});}else if(data.method==='Runtime.exceptionThrown')report.errors.push(data.params.exceptionDetails);else if(data.method==='Network.requestWillBeSent'){if(data.params.request.url.includes('/web/modules/'))report.modules.push(new URL(data.params.request.url).pathname);if(/\.svg(?:$|\?)/.test(data.params.request.url))report.svgRequests.push(data.params.request.url);}});
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

 const decode=content=>JSON.parse(content.replace(/^\ufeff/,''));
 // HTML textarea.value has LF-normalized line endings; reviewed native source
 // and author disk bytes retain their original BOM/CRLF separately.
 const visible=content=>content.replace(/\r\n?/g,'\n');
 const system=await evaluate("(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()");report.system=system;
 assert.ok(system.initializedModules.includes('org.viento.scene3d-objects'));assert.ok(system.initializedModules.includes('org.viento.scene3d-transforms'));
 assert.equal(system.initializedModules.length,15);assert.equal(system.plan.capabilities.length,31);assert.ok(system.plan.requests.every(item=>item.status==='supported'));
 const sourceBefore=await sourceValue();assert.equal(sourceBefore,visible(original));await open();const first=await pixels();assert.ok(first.nonBackground>1000);report.gpu=first;
 assert.equal(await evaluate("document.querySelectorAll('#scene3dObjects button').length"),3);await close();
 report.steps.push('Real HTTP source editor mounts eleven modules and twenty-seven declared capabilities, including the required independent object authoring capability. Existing WebGL2 preview draws three authored UUIDs; the actual GPU implementation is recorded.');
 const objectsOpen=async()=>{await enabled('#scene3dObjectsBtn');await click('#scene3dObjectsBtn');await wait(()=>evaluate("document.querySelector('#scene3dObjectsDialog').open&&!document.querySelector('#scene3dObjectsAction').disabled"),'object form source loaded');await modeFields('add');};
 const objectsClose=async()=>{await click('#scene3dObjectsCancel');await wait(()=>evaluate("!document.querySelector('#scene3dObjectsDialog').open"),'object form cancelled');};
 const formSet=async(prefix,suffix,value,event='input')=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify('#'+prefix+suffix)});e.value=${JSON.stringify(String(value))};${event?`e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));`:''}})()`);
 const mode=async value=>{await formSet('scene3dObjects','Action',value,'change');await modeFields(value);},target=value=>formSet('scene3dObjects','Object',value,'change');
 const modeFields=async action=>{const fields=await evaluate("Object.fromEntries(['ObjectField','NameField','ColorField','NewIdentityField'].map(suffix=>{const e=document.querySelector('#scene3dObjects'+suffix);return[suffix,{hidden:e.hidden,display:getComputedStyle(e).display}];}))");
  const hiddenByAction={add:['ObjectField'],copy:['ColorField'],remove:['NameField','ColorField','NewIdentityField']};
  for(const [field,value]of Object.entries(fields)){const hidden=hiddenByAction[action].includes(field);assert.equal(value.hidden,hidden,`${action} ${field} hidden`);assert.equal(value.display,hidden?'none':'grid',`${action} ${field} computed display`);}
  (report.modeFieldChecks||=[]).push({action,fields});};
 const objectCheck=async()=>{await enabled('#scene3dObjectsCheck');await click('#scene3dObjectsCheck');await wait(()=>evaluate("!document.querySelector('#scene3dObjectsCheck').disabled"),'object check completes');};
 const reviewedSource=()=>evaluate("document.querySelector('#scene3dObjectsSource').textContent");
 const applyObjects=async expected=>{await enabled('#scene3dObjectsApply');await click('#scene3dObjectsApply');await wait(()=>evaluate("!document.querySelector('#scene3dObjectsDialog').open"),'object applied with exact current receipt');assert.equal(await sourceValue(),visible(expected));assert.equal(await state('appState.editHasUnsavedChanges'),true);};
 const saveExact=async expected=>{await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(()=>readSource().then(value=>value===expected),'ordinary Save exact reviewed source');await wait(()=>state('!appState.isSaving&&!appState.editHasUnsavedChanges'),'ordinary Save returns clean');};
 await objectsOpen();const cancelledId=await evaluate("document.querySelector('#scene3dObjectsNewIdentity').value");await formSet('scene3dObjects','Name','Cancelled authored box');await objectCheck();await enabled('#scene3dObjectsApply');
 const cancelledCandidate=await reviewedSource(),cancelledModel=decode(cancelledCandidate);assert.equal(cancelledModel.objects.length,4);assert.deepEqual(cancelledModel.objects.slice(0,3),scene.objects);
 assert.deepEqual(cancelledModel.camera,scene.camera);assert.deepEqual(cancelledModel.light,scene.light);assert.ok(cancelledCandidate.startsWith('\ufeff'));assert.ok(cancelledCandidate.includes('\r\n'));
 assert.equal(cancelledCandidate.slice(0,cancelledCandidate.indexOf('"objects"')),original.slice(0,original.indexOf('"objects"')));
 assert.equal(await sourceValue(),visible(original));assert.equal(await readSource(),original);await screenshot('objects-desktop-review.png');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 for(const language of ['zh-CN','en','ja']){await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);await delay(100);await settleFrames();
  assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth||document.querySelector('#scene3dObjectsDialog').scrollWidth>document.querySelector('#scene3dObjectsDialog').clientWidth"),false);
  assert.equal(await evaluate("document.querySelector('#scene3dObjectsNewIdentity').value"),cancelledId);assert.equal(await evaluate("document.querySelector('#scene3dObjectsName').value"),'Cancelled authored box');
  assert.equal(await reviewedSource(),cancelledCandidate);assert.equal(await evaluate("document.querySelector('#scene3dObjectsApply').disabled"),false);
  await evaluate("document.querySelector('#scene3dObjectsDialog').scrollTop=0");await screenshot(`objects-${language}-390.png`);
 }
 await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");await objectsClose();assert.equal(await sourceValue(),visible(original));assert.equal(await readSource(),original);
 report.steps.push('Adding a standard box reviews four objects and a fresh stable UUID. BOM, CRLF, original objects, camera and light are preserved. Chinese/English/Japanese at 390 px retain the same approval, name and UUID without horizontal overflow; Cancel writes neither source draft nor disk.');
 await objectsOpen();const addedId=await evaluate("document.querySelector('#scene3dObjectsNewIdentity').value");assert.notEqual(addedId,cancelledId);await formSet('scene3dObjects','Name','Added author box');await formSet('scene3dObjects','Color','#eec34b');await objectCheck();
 const addedSource=await reviewedSource(),added=decode(addedSource);assert.deepEqual(added.objects.at(-1),{instanceId:addedId,name:'Added author box',primitive:'box',position:[0,0,0],rotationDegrees:[0,0,0],size:[1,1,1],color:'#eec34b'});
 await applyObjects(addedSource);assert.equal(await readSource(),original);await saveExact(addedSource);assert.equal(await readSource(),addedSource);
 report.steps.push('Reopening allocates a different add identity. Apply writes exactly the reviewed four-object candidate to memory only; ordinary Save persists its exact BOM/CRLF bytes and clears the editor dirty state.');
 await objectsOpen();await mode('copy');await target(scene.objects[1].instanceId);const copyId=await evaluate("document.querySelector('#scene3dObjectsNewIdentity').value");assert.notEqual(copyId,scene.objects[1].instanceId);assert.notEqual(copyId,addedId);
 assert.equal(await evaluate("document.querySelector('#scene3dObjectsName').value"),scene.objects[1].name);await formSet('scene3dObjects','Name','Mint copy explicit');await objectCheck();
 const copySource=await reviewedSource(),copied=decode(copySource);assert.equal(copied.objects.length,5);assert.deepEqual(copied.objects.slice(0,4),added.objects);assert.deepEqual(copied.objects.at(-1),{...scene.objects[1],instanceId:copyId,name:'Mint copy explicit'});
 await applyObjects(copySource);assert.equal(await readSource(),addedSource);await saveExact(copySource);
 const transformOpen=async()=>{await enabled('#scene3dTransformsBtn');await click('#scene3dTransformsBtn');await wait(()=>evaluate("document.querySelector('#scene3dTransformsDialog').open&&!document.querySelector('#scene3dTransformsObject').disabled"),'independent transform source loaded');};
 await transformOpen();await formSet('scene3dTransforms','Object',copyId,'change');await click('#scene3dTransformsPositionSelected');await formSet('scene3dTransforms','PositionX',3.5);await formSet('scene3dTransforms','PositionY',1.25);await formSet('scene3dTransforms','PositionZ',-2);
 await enabled('#scene3dTransformsCheck');await click('#scene3dTransformsCheck');await enabled('#scene3dTransformsApply');const transformedSource=await evaluate("document.querySelector('#scene3dTransformsSource').textContent"),transformed=decode(transformedSource);
 assert.deepEqual(transformed.objects.at(-1).position,[3.5,1.25,-2]);assert.deepEqual(transformed.objects[1],scene.objects[1]);assert.deepEqual(transformed.objects.slice(0,4),copied.objects.slice(0,4));await screenshot('objects-copy-transform.png');
 await click('#scene3dTransformsApply');await wait(()=>evaluate("!document.querySelector('#scene3dTransformsDialog').open"),'copy transform applied');assert.equal(await readSource(),copySource);await saveExact(transformedSource);
 report.steps.push('Copy appends a fifth object with a fresh UUID and explicit same-source default name, preserving transforms and color. The separate transform form then changes only the copy’s position; ordinary Save leaves the original source object unchanged.');
 await objectsOpen();await mode('remove');await target(scene.objects[0].instanceId);await objectCheck();const removedSource=await reviewedSource(),removed=decode(removedSource);
 assert.equal(await evaluate("document.querySelector('#scene3dObjectsAfter').textContent"),'null');assert.equal(removed.objects.length,4);assert.deepEqual(removed.objects,transformed.objects.slice(1));
 await applyObjects(removedSource);assert.equal(await readSource(),transformedSource);await saveExact(removedSource);await open();assert.equal(await evaluate("document.querySelectorAll('#scene3dObjects button').length"),4);const remainingPixels=await pixels();assert.ok(remainingPixels.nonBackground>1000);report.afterRemovalGpu=remainingPixels;await close();
 report.steps.push('Removing the first stable UUID reviews a nullable after declaration and four survivors in unchanged source order. Ordinary Save and the existing readonly GPU preview reopen the resulting four-object scene.');
 await objectsOpen();await objectCheck();await enabled('#scene3dObjectsApply');await input(removedSource+' ');await delay(100);await click('#scene3dObjectsApply');await delay(100);
 assert.equal(await sourceValue(),visible(removedSource+' '));assert.equal(await readSource(),removedSource);await objectsClose();await input(removedSource);
 await objectsOpen();await objectCheck();await enabled('#scene3dObjectsApply');await formSet('scene3dObjects','Name','Silent later intent',null);await click('#scene3dObjectsApply');await delay(100);
 assert.equal(await evaluate("document.querySelector('#scene3dObjectsApply').disabled"),true);assert.equal(await sourceValue(),visible(removedSource));assert.equal(await readSource(),removedSource);await objectsClose();
 report.steps.push('Changing the actual raw source after approval and changing form intent without an input event each revoke Apply. Newer source bytes and the saved author file survive; no silent structural operation is authorized.');
 const single={...decode(removedSource),objects:[decode(removedSource).objects[0]]},singleSource='\ufeff'+json(single).replaceAll('\n','\r\n');await input(singleSource);await objectsOpen();await mode('remove');
 assert.equal(await evaluate("document.querySelector('#scene3dObjectsCheck').disabled"),true);assert.match(await evaluate("document.querySelector('#scene3dObjectsBlocked').textContent"),/最后/);await objectsClose();assert.equal(await sourceValue(),visible(singleSource));assert.equal(await readSource(),removedSource);await input(removedSource);
 report.steps.push('A real unsaved one-object author draft explicitly blocks removal of its last box. Cancel preserves that draft and the separate saved four-object source.');
 await objectsOpen();await formSet('scene3dObjects','Name','Unsaved conflict box');await objectCheck();const conflictCandidate=await reviewedSource();await applyObjects(conflictCandidate);
 const external=removedSource+'\r\n ';await fs.writeFile(path.join(root,sourcePath),external);await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(()=>evaluate("!document.querySelector('#docSaveConflictDialog').classList.contains('is-hidden')"),'ordinary object Save conflict');await screenshot('objects-save-conflict.png');await click('#docSaveConflictCancelBtn');
 await wait(()=>state('!appState.isSaving'),'ordinary conflict cancelled');assert.equal(await readSource(),external);assert.equal(await sourceValue(),visible(conflictCandidate));assert.equal(await state('appState.editHasUnsavedChanges'),true);
 report.steps.push('A legitimate object Apply does not bypass the ordinary disk Save precondition. External disk changes trigger the actual Save conflict dialog; Cancel preserves both the external file and the unsaved reviewed candidate.');
 const injection=await call('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const old=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl2'?null:old.call(this,kind,...args);};})()"});
 await call('Page.navigate',{url:`${base}/web/?mode=edit&no-webgl=1`});await wait(()=>state('appState.editBackendAvailable'),'renderer-independent editor');await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>state('appState.isEditing'),'renderer-independent edit');await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');
 await open();assert.equal(await evaluate("document.querySelector('#scene3dFallback').hidden"),false);await close();await objectsOpen();await formSet('scene3dObjects','Name','GPU-independent author');await objectCheck();await enabled('#scene3dObjectsApply');await screenshot('objects-without-webgl.png');await objectsClose();assert.equal(await readSource(),external);await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier});
 report.steps.push('With only WebGL2 explicitly injected as unavailable, the old readonly preview reports its renderer limit while native object review remains usable. Cancellation leaves author disk bytes intact. No rendering or backend authority enters the objects form.');
 report.identities={initial:scene.objects.map(item=>item.instanceId),cancelled:cancelledId,added:addedId,copied:copyId,removed:scene.objects[0].instanceId,survivors:removed.objects.map(item=>item.instanceId)};
 assert.deepEqual(report.errors,[]);report.modules=[...new Set(report.modules)].sort();assert.ok(report.modules.includes('/web/modules/app-scene3d-objects.js'));assert.ok(report.modules.includes('/web/modules/app-scene3d-transforms.js'));
 report.sourcesFinal=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));report.sourceStableDuringProof=JSON.stringify(report.sourcesFinal)===JSON.stringify(report.sources);assert.equal(report.sourceStableDuringProof,true);report.ok=true;report.status='passed';
} catch(error){await captureFailure?.().catch(()=>{});report.status='failed';report.failure=String(error.stack||error);process.exitCode=1;}
finally{socket?.close();for(const cleanup of cleanups.reverse())await cleanup();report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),json(report));console.log(json(report));}
