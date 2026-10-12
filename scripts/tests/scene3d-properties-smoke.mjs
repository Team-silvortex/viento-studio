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
const output=path.resolve(process.env.VIENTO_SCENE3D_OUTPUT||path.join(os.tmpdir(),`viento-scene3d-property-browser-${Date.now()}`));
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Choose a new empty VIENTO_SCENE3D_OUTPUT.');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),json=value=>JSON.stringify(value,null,2)+'\n';
const cleanups=[],t={after:fn=>cleanups.push(fn)};
const report={startedAt:new Date().toISOString(),steps:[],errors:[],screenshots:[],modules:[],dialogs:[],svgRequests:[],cspViolations:[],limitations:[
 'Real HTTP editor, native/WASM source semantics and WebGL2 draws/readPixels; no installed desktop, Android or hardware-GPU claim.',
 'Browser renderer/vendor are recorded explicitly; headless Chrome may use a software GPU implementation.',
 'Unsupported-renderer phase injects getContext(webgl2)=null only; all source semantics and editor Save remain real.',
 'Independent stable-object name and color changes apply only to the source draft. Native source operations do not grant renderer, backend or implicit Save authority.'
]};
report.node={version:process.version,sha256:hash(await fs.readFile(process.execPath))};
const sources=['scripts/tests/scene3d-properties-smoke.mjs','engine/scene3d-properties.mjs','engine/scene3d-authoring.mjs','web/modules/app-scene3d-properties.js','web/scene3d-properties.css','engine/scene3d-transform.mjs','web/modules/app-scene3d-transforms.js','web/scene3d-transforms.css','engine/scene3d.mjs','engine/studio-core.mjs','engine/studio-modules.mjs','web/modules/app-scene3d-preview.js','web/modules/scene3d-renderer.js','web/modules/scene3d-math.js','web/modules/app-studio-system.js','web/modules/app-runtime.js','web/scene3d.css','web/i18n/en.js','web/i18n/ja.js'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));
let socket,captureFailure;
const wait=async(fn,label)=>{for(let n=0;n<450;n++){if(await fn())return;await delay(100);}throw Error(`Timed out: ${label}`);};
try {
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-scene3d-property-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
 const root=path.join(temporary,'workspace'),template=PROJECT_TEMPLATE_CATALOG.templates.find(item=>item.packageId==='org.viento.oc-game');assert.ok(template);
 const write=async(name,content)=>{const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);};
 for(const name of ['documents','templates','metadata/documents','metadata/assets','assets'])await fs.mkdir(path.join(root,name),{recursive:true});
 await write('workspace.json',json({format:'viento-workspace',version:3,id:randomUUID(),name:'3D preview source owner',createdAt:0,...WORKSPACE_LAYOUT,documentTypes:template.documentTypes,projectTemplate:{packageId:template.packageId,version:template.version},studioProfile:{format:'viento-studio-profile',schemaVersion:1,required:[{capability:'scene.preview.scene3d',apiVersion:1},{capability:'scene.authoring.transforms3d',apiVersion:1},{capability:'scene.authoring.objects3d',apiVersion:1},{capability:'scene.authoring.environment3d',apiVersion:1},{capability:'scene.authoring.properties3d',apiVersion:1}],optional:[]}}));
 for(const[name,content]of Object.entries(template.templates))await write(`templates/${name}`,content);
 await registerWorkspace(root);const execute=createWorldCommandService(root),world=await readWorldProjection(root),objectId=randomUUID(),sourcePath='documents/scenes/three-boxes.json';
 const scene={format:'viento-scene3d',schemaVersion:1,name:'Three shaded boxes',viewport:[800,600],background:'#142538',camera:{position:[5,4,8],target:[0,0,0],fovDegrees:50,near:.1,far:1000},light:{direction:[1,-2,-1],color:'#ffffff',energy:1},objects:[
  {instanceId:randomUUID(),name:' Copper\r\nbox\rline\n 雪😀 ',primitive:'box',position:[-1.3,0,0],rotationDegrees:[23,-41,67],size:[1.7,1.3,1],color:'#eb9869'},
  {instanceId:randomUUID(),name:'Mint box',primitive:'box',position:[1.2,0,0],rotationDegrees:[0,20,0],size:[1.1,2,1.1],color:'#85d7bb'},
  {instanceId:randomUUID(),name:'Blue box',primitive:'box',position:[0,-1.4,0],rotationDegrees:[0,0,0],size:[5,.3,3],color:'#5599dd'}]};
 const original='\ufeff'+json(scene).replaceAll('\n','\r\n');
 await execute({command:'object.create',mode:'apply',worldId:world.world.id,baseRevision:world.world.revision,actorRef:{kind:'tool',id:'scene3d-property-smoke'},objectId,documentType:'level',sourcePath,content:original});
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
 await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>state('appState.isEditing'),'ordinary property authoring');await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');await enabled('#scene3dPreviewBtn');

 const decode=content=>JSON.parse(content.replace(/^\ufeff/,'')),visible=content=>content.replace(/\r\n?/g,'\n');
 const system=await evaluate("(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()");report.system=system;
 assert.ok(system.initializedModules.includes('org.viento.scene3d-properties'));assert.equal(system.initializedModules.length,17);assert.equal(system.plan.capabilities.length,33);
 assert.ok(system.plan.requests.every(item=>item.status==='supported'));const sourceBefore=await sourceValue();assert.equal(sourceBefore,visible(original));
 const columns=async()=>{const actual=await evaluate("(()=>{const e=document.querySelector('.scene3d-properties-inputs');return{columns:getComputedStyle(e).gridTemplateColumns.split(/\\s+/).length,width:innerWidth};})()");assert.equal(actual.columns,actual.width<=700?1:2);(report.columnChecks||=[]).push(actual);};
 const propertiesOpen=async()=>{await enabled('#scene3dPropertiesBtn');await click('#scene3dPropertiesBtn');await wait(()=>evaluate("document.querySelector('#scene3dPropertiesDialog').open&&!document.querySelector('#scene3dPropertiesNameSelected').disabled"),'properties form source loaded');await columns();};
 const propertiesClose=async()=>{await click('#scene3dPropertiesCancel');await wait(()=>evaluate("!document.querySelector('#scene3dPropertiesDialog').open"),'properties form cancelled');};
 const formSet=async(suffix,value,event=true)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify('#scene3dProperties'+suffix)});e.value=${JSON.stringify(String(value))};${event?"e.dispatchEvent(new Event('input',{bubbles:true}));":''}})()`);
 const target=async id=>evaluate(`(()=>{const e=document.querySelector('#scene3dPropertiesInstance');e.value=${JSON.stringify(id)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 const check=async()=>{await enabled('#scene3dPropertiesCheck');await click('#scene3dPropertiesCheck');await wait(()=>evaluate("!document.querySelector('#scene3dPropertiesCheck').disabled"),'properties check returns');};
 const reviewedSource=()=>evaluate("document.querySelector('#scene3dPropertiesSource').textContent");
 const applyProperties=async expected=>{await enabled('#scene3dPropertiesApply');await click('#scene3dPropertiesApply');await wait(()=>evaluate("!document.querySelector('#scene3dPropertiesDialog').open"),'properties exact receipt accepted');assert.equal(await sourceValue(),visible(expected));assert.equal(await state('appState.editHasUnsavedChanges'),true);};
 const saveExact=async expected=>{await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(()=>readSource().then(value=>value===expected),'ordinary Save exact properties candidate');await wait(()=>state('!appState.isSaving&&!appState.editHasUnsavedChanges'),'ordinary Save returns clean');};
 const untouchedColor=async()=>{await click('#scene3dPropertiesNameSelected');await click('#scene3dPropertiesColorSelected');await formSet('Color','#C06090');};
 await open();const first=await pixels();assert.ok(first.nonBackground>1000);report.gpu=first;await close();
 await propertiesOpen();assert.equal(await evaluate("document.querySelector('#scene3dPropertiesName').tagName"),'TEXTAREA');assert.equal(await evaluate("document.querySelector('#scene3dPropertiesName').maxLength"),-1);
 assert.equal(await evaluate("document.querySelector('#scene3dPropertiesName').value"),visible(scene.objects[0].name));assert.equal(await evaluate("document.querySelector('#scene3dPropertiesNameSelected').checked||document.querySelector('#scene3dPropertiesColorSelected').checked"),false);
 assert.equal(await evaluate("document.querySelector('#scene3dPropertiesApply').disabled"),true);assert.equal(await evaluate("getComputedStyle(document.querySelector('#scene3dPropertiesReview')).display"),'none');
 await click('#scene3dPropertiesNameSelected');await check();assert.equal(await evaluate("document.querySelector('#scene3dPropertiesApply').disabled"),true);await propertiesClose();
 report.steps.push('Actual twelve-module, twenty-eight-capability editor mounts independent properties authoring with stable UUID targets. Real WebGL2 pixels and software/hardware renderer identity are recorded. Fields start unselected and unchanged decoded Name review cannot authorize Apply. Name is a textarea without a UTF-16 maxlength.');

 await propertiesOpen();await untouchedColor();await check();await enabled('#scene3dPropertiesApply');const cancelledCandidate=await reviewedSource(),candidate=decode(cancelledCandidate);
 assert.equal(candidate.objects[0].name,scene.objects[0].name);assert.equal(candidate.objects[0].color,'#C06090');assert.deepEqual(candidate.objects.slice(1),scene.objects.slice(1));
 assert.deepEqual(candidate.objects[0].position,scene.objects[0].position);assert.deepEqual(candidate.objects[0].rotationDegrees,scene.objects[0].rotationDegrees);assert.deepEqual(candidate.objects[0].size,scene.objects[0].size);
 for(const key of ['viewport','background','camera','light'])assert.deepEqual(candidate[key],scene[key]);assert.equal(candidate.name,scene.name);
 assert.ok(cancelledCandidate.startsWith('\ufeff'));assert.ok(cancelledCandidate.includes('\r\n'));assert.equal(await sourceValue(),sourceBefore);assert.equal(await readSource(),original);
 assert.deepEqual(await evaluate("Array.from(document.querySelector('#scene3dPropertiesChangedPaths').children,x=>x.textContent)"),['/objects/0/color']);
 assert.deepEqual(await evaluate("JSON.parse(document.querySelector('#scene3dPropertiesBefore').textContent)"),scene.objects[0]);assert.deepEqual(await evaluate("JSON.parse(document.querySelector('#scene3dPropertiesAfter').textContent)"),candidate.objects[0]);
 await screenshot('properties-desktop-review.png');await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 for(const language of ['zh-CN','en','ja']){await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);await delay(100);await settleFrames();
  assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth||document.querySelector('#scene3dPropertiesDialog').scrollWidth>document.querySelector('#scene3dPropertiesDialog').clientWidth"),false);
  assert.equal(await evaluate("document.querySelector('#scene3dPropertiesName').value"),visible(scene.objects[0].name));assert.equal(await evaluate("document.querySelector('#scene3dPropertiesColor').value"),'#C06090');
  assert.equal(await evaluate("document.querySelector('#scene3dPropertiesInstance').value"),scene.objects[0].instanceId);assert.equal(await reviewedSource(),cancelledCandidate);assert.equal(await evaluate("document.querySelector('#scene3dPropertiesApply').disabled"),false);await columns();
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#scene3dPropertiesReview')).display"),'block');
  const labels=await evaluate("(async()=>{const {t}=await import('/web/i18n/index.js');return{actual:document.querySelector('#scene3dPropertiesTitle').textContent,expected:t('编辑3D属性')};})()");assert.equal(labels.actual,labels.expected);
  await evaluate("document.querySelector('#scene3dPropertiesDialog').scrollTop=0");await screenshot(`properties-${language}-390.png`);
  await evaluate("document.querySelector('#scene3dPropertiesDialog').scrollTop=document.querySelector('#scene3dPropertiesDialog').scrollHeight");
  const footer=await evaluate("(()=>{const r=document.querySelector('#scene3dPropertiesApply').getBoundingClientRect();return{top:r.top,bottom:r.bottom};})()");assert.ok(footer.top>=0&&footer.bottom<=844);(report.narrowFooterChecks||=[]).push({language,...footer});
 }
 await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");await propertiesClose();assert.equal(await sourceValue(),sourceBefore);assert.equal(await readSource(),original);
 report.steps.push('With Name explicitly selected but its textarea display untouched, native review preserves original decoded CRLF and CR characters while changing only Color. Complete before/after object and BOM/CRLF source keep UUIDs, transforms, camera, light and other objects. Chinese, English and Japanese at 390 px retain selections, raw values and approval with one responsive column, reachable footer and no horizontal overflow. Cancel writes neither draft nor disk.');

 await propertiesOpen();await untouchedColor();await check();const appliedSource=await reviewedSource();assert.equal(appliedSource,cancelledCandidate);await applyProperties(appliedSource);assert.equal(await readSource(),original);
 await open();const updated=await pixels();assert.ok(updated.nonBackground>1000);assert.notEqual(updated.hash,first.hash);assert.equal(updated.width,first.width);assert.equal(updated.height,first.height);report.appliedColorGpu=updated;await close();
 await saveExact(appliedSource);await propertiesOpen();assert.equal(await evaluate("document.querySelector('#scene3dPropertiesName').value"),visible(scene.objects[0].name));assert.equal(await evaluate("document.querySelector('#scene3dPropertiesColor').value"),'#C06090');await propertiesClose();
 report.steps.push('Apply accepts the exact current-token receipt and changes only the unsaved source memory. Fresh readonly preview shows changed shaded pixels for the authored color. Ordinary Save writes the exact reviewed BOM/CRLF candidate, and reopen retains the original CRLF/CR decoded Name and mixed-case Color.');

 for(const value of [' line\nwith space ','   ','control\u0001 name','😀'.repeat(256)]){await propertiesOpen();await click('#scene3dPropertiesNameSelected');await formSet('Name',value);await check();await enabled('#scene3dPropertiesApply');const approved=decode(await reviewedSource());assert.equal(approved.objects[0].name,value);assert.equal(approved.objects[0].color,'#C06090');await propertiesClose();}
 for(const value of ['','😀'.repeat(257)]){await propertiesOpen();await click('#scene3dPropertiesNameSelected');await formSet('Name',value);await check();assert.equal(await evaluate("document.querySelector('#scene3dPropertiesApply').disabled"),true);assert.equal(await evaluate("document.querySelector('#scene3dPropertiesName').value"),value);await propertiesClose();}
 await propertiesOpen();await click('#scene3dPropertiesColorSelected');await formSet('Color','red');await check();assert.equal(await evaluate("document.querySelector('#scene3dPropertiesApply').disabled"),true);await propertiesClose();assert.equal(await readSource(),appliedSource);assert.equal(await sourceValue(),visible(appliedSource));
 report.steps.push('Native property review accepts literal LF, blank-space and control-character names, and exactly 256 astral Unicode codepoints without trimming or a UTF-16 limit. It rejects 257 codepoints, empty Name and invalid Color, retaining the local raw input and leaving source untouched. These name-boundary candidates are cancelled.');

 await propertiesOpen();await target(scene.objects[1].instanceId);assert.equal(await evaluate("document.querySelector('#scene3dPropertiesName').value"),scene.objects[1].name);await click('#scene3dPropertiesNameSelected');await click('#scene3dPropertiesColorSelected');
 const authoredName='  雪😀\n<b>literal title</b>  ';await formSet('Name',authoredName);await formSet('Color','#aBcD12');await check();const mixedSource=await reviewedSource(),mixedScene=decode(mixedSource);
 assert.equal(mixedScene.objects[1].name,authoredName);assert.equal(mixedScene.objects[1].color,'#aBcD12');assert.equal(mixedScene.objects[1].instanceId,scene.objects[1].instanceId);assert.deepEqual(mixedScene.objects[0],candidate.objects[0]);assert.deepEqual(mixedScene.objects[2],scene.objects[2]);
 assert.deepEqual(await evaluate("Array.from(document.querySelector('#scene3dPropertiesChangedPaths').children,x=>x.textContent)"),['/objects/1/name','/objects/1/color']);await applyProperties(mixedSource);assert.equal(await readSource(),appliedSource);await saveExact(mixedSource);
 await propertiesOpen();await target(scene.objects[1].instanceId);assert.equal(await evaluate("document.querySelector('#scene3dPropertiesName').value"),authoredName);assert.equal(await evaluate("document.querySelector('#scene3dPropertiesInstance').querySelector('b')"),null);await propertiesClose();
 report.steps.push('A selected second stable UUID receives only explicit raw Name and Color fields, preserving whitespace, LF, Unicode, literal HTML text and hex case. All other objects and transforms remain unchanged. Save/reopen keeps the exact declaration, and author text does not become HTML in target options.');

 await propertiesOpen();await click('#scene3dPropertiesColorSelected');await formSet('Color','#123456');await formSet('Instance',scene.objects[1].instanceId,false);await check();assert.equal(await evaluate("document.querySelector('#scene3dPropertiesApply').disabled"),true);assert.equal(await evaluate("document.querySelector('#scene3dPropertiesInstance').value"),scene.objects[0].instanceId);await propertiesClose();
 for(const silent of ['checkbox','name','color','target']){await propertiesOpen();await click('#scene3dPropertiesColorSelected');await formSet('Color','#123456');await check();await enabled('#scene3dPropertiesApply');
  if(silent==='checkbox')await evaluate("document.querySelector('#scene3dPropertiesNameSelected').checked=true");if(silent==='name')await formSet('Name','new unselected silent name',false);if(silent==='color')await formSet('Color','#abcdef',false);if(silent==='target')await formSet('Instance',scene.objects[1].instanceId,false);
  await click('#scene3dPropertiesApply');await delay(100);assert.equal(await evaluate("document.querySelector('#scene3dPropertiesApply').disabled"),true);assert.equal(await sourceValue(),visible(mixedSource));assert.equal(await readSource(),mixedSource);await propertiesClose();}
 await propertiesOpen();await click('#scene3dPropertiesColorSelected');await formSet('Color','#123456');await check();await enabled('#scene3dPropertiesApply');await input(mixedSource+' ');await delay(100);await click('#scene3dPropertiesApply');await delay(100);assert.equal(await sourceValue(),visible(mixedSource+' '));assert.equal(await readSource(),mixedSource);await propertiesClose();await input(mixedSource);
 report.steps.push('A silent legal target change before Check cannot review the old closure: the displayed target is restored and approval denied. After review, silent checkbox, Name, Color and UUID mutations revoke approval. A newer real source edit also revokes ownership and cannot be overwritten by a previous candidate.');

 await propertiesOpen();await click('#scene3dPropertiesColorSelected');await formSet('Color','#332211');await check();const conflictCandidate=await reviewedSource();await applyProperties(conflictCandidate);
 const external=mixedSource+'\r\n ';await fs.writeFile(path.join(root,sourcePath),external);await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(()=>evaluate("!document.querySelector('#docSaveConflictDialog').classList.contains('is-hidden')"),'ordinary Save conflict');await screenshot('properties-save-conflict.png');await click('#docSaveConflictCancelBtn');await wait(()=>state('!appState.isSaving'),'ordinary conflict cancelled');assert.equal(await readSource(),external);assert.equal(await sourceValue(),visible(conflictCandidate));assert.equal(await state('appState.editHasUnsavedChanges'),true);
 report.steps.push('A legitimate property draft still uses ordinary Save preconditions. A real external disk change triggers the existing conflict dialog; Cancel retains external bytes and the unsaved property draft independently. No implicit Save occurs in properties authoring.');

 const injection=await call('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const old=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl2'?null:old.call(this,kind,...args);};})()"});
 await call('Page.navigate',{url:`${base}/web/?mode=edit&no-webgl=1`});await wait(()=>state('appState.editBackendAvailable'),'renderer-independent editor');await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>state('appState.isEditing'),'renderer-independent edit');await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');
 await open();assert.equal(await evaluate("document.querySelector('#scene3dFallback').hidden"),false);await close();await propertiesOpen();await click('#scene3dPropertiesColorSelected');await formSet('Color','#445566');await check();await enabled('#scene3dPropertiesApply');await screenshot('properties-without-webgl.png');await propertiesClose();assert.equal(await readSource(),external);await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier});
 report.steps.push('With WebGL2 explicitly injected unavailable, readonly preview truthfully reports no draw while actual native property review remains enabled. The independent form has no renderer, World, execution or Save dependency.');

 assert.deepEqual(report.errors,[]);assert.deepEqual(report.svgRequests,[]);assert.deepEqual(report.cspViolations,[]);report.modules=[...new Set(report.modules)].sort();assert.ok(report.modules.includes('/web/modules/app-scene3d-properties.js'));
 report.sourcesFinal=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));report.sourceStableDuringProof=JSON.stringify(report.sourcesFinal)===JSON.stringify(report.sources);assert.equal(report.sourceStableDuringProof,true);report.ok=true;report.status='passed';
} catch(error){await captureFailure?.().catch(()=>{});report.status='failed';report.failure=String(error.stack||error);process.exitCode=1;}
finally{socket?.close();for(const cleanup of cleanups.reverse())await cleanup();report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),json(report));console.log(json(report));}
