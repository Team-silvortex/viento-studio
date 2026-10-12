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
const output=path.resolve(process.env.VIENTO_SCENE3D_OUTPUT||path.join(os.tmpdir(),`viento-scene3d-picking-browser-${Date.now()}`));
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Choose a new empty VIENTO_SCENE3D_OUTPUT.');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),json=value=>JSON.stringify(value,null,2)+'\n';
const cleanups=[],t={after:fn=>cleanups.push(fn)};
const report={startedAt:new Date().toISOString(),steps:[],errors:[],screenshots:[],modules:[],dialogs:[],svgRequests:[],cspViolations:[],limitations:[
 'Real HTTP editor, native/WASM source semantics and WebGL2 draws/readPixels; no installed desktop, Android or hardware-GPU claim.',
 'Browser renderer/vendor are recorded explicitly; headless Chrome may use a software GPU implementation.',
 'Unsupported-renderer phase injects getContext(webgl2)=null only; all source semantics and editor Save remain real.',
 'Name/UUID filtering, stable selection, temporary focus and exact source navigation are read-only. No author field, source bytes, World or Save authority is granted.'
]};
report.node={version:process.version,sha256:hash(await fs.readFile(process.execPath))};
const sources=['scripts/tests/scene3d-picking-smoke.mjs','engine/scene3d-navigation.mjs','engine/scene3d-authoring.mjs','engine/scene3d-transform.mjs','web/modules/app-scene3d-transforms.js','web/scene3d-transforms.css','engine/scene3d.mjs','engine/studio-core.mjs','engine/studio-modules.mjs','web/modules/app-scene3d-preview.js','web/modules/scene3d-renderer.js','web/modules/scene3d-picking.js','web/modules/scene3d-math.js','web/modules/app-studio-system.js','web/modules/app-runtime.js','web/scene3d.css','web/i18n/en.js','web/i18n/ja.js'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));
let socket,captureFailure;
const wait=async(fn,label)=>{for(let n=0;n<450;n++){if(await fn())return;await delay(100);}throw Error(`Timed out: ${label}`);};
try {
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-scene3d-picking-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
 const root=path.join(temporary,'workspace'),template=PROJECT_TEMPLATE_CATALOG.templates.find(item=>item.packageId==='org.viento.oc-game');assert.ok(template);
 const write=async(name,content)=>{const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);};
 for(const name of ['documents','templates','metadata/documents','metadata/assets','assets'])await fs.mkdir(path.join(root,name),{recursive:true});
 await write('workspace.json',json({format:'viento-workspace',version:3,id:randomUUID(),name:'3D preview source owner',createdAt:0,...WORKSPACE_LAYOUT,documentTypes:template.documentTypes,projectTemplate:{packageId:template.packageId,version:template.version},studioProfile:{format:'viento-studio-profile',schemaVersion:1,required:[{capability:'scene.preview.scene3d',apiVersion:1},{capability:'scene.authoring.transforms3d',apiVersion:1},{capability:'scene.authoring.objects3d',apiVersion:1},{capability:'scene.authoring.environment3d',apiVersion:1},{capability:'scene.authoring.properties3d',apiVersion:1}],optional:[]}}));
 for(const[name,content]of Object.entries(template.templates))await write(`templates/${name}`,content);
 await registerWorkspace(root);const execute=createWorldCommandService(root),world=await readWorldProjection(root),objectId=randomUUID(),sourcePath='documents/scenes/three-boxes.json';
 const makeBox=(name,position,rotationDegrees,size,color)=>({instanceId:randomUUID(),name,primitive:'box',position,rotationDegrees,size,color});
 const scene={format:'viento-scene3d',schemaVersion:1,name:'Clickable boxes',viewport:[960,540],background:'#142538',camera:{position:[0,0,12],target:[0,0,0],fovDegrees:50,near:.1,far:1000},light:{direction:[1,-2,-1],color:'#ffffff',energy:1},objects:[
  makeBox('Copper\r\nbox 雪😀',[-2.4,0,0],[23,-41,67],[1.5,1,.8],'#eb9869'),
  makeBox('Mint nonuniform box',[2.4,0,0],[15,35,-20],[1,2,.8],'#85d7bb'),
  makeBox('Occluded rear box',[0,0,-1],[0,0,0],[1.8,1.8,1],'#6699ff'),
  makeBox('Visible front box',[0,0,1],[0,0,20],[1.6,1.6,1],'#e9c85e'),
  makeBox('Coincident earlier box',[0,2.5,0],[0,0,0],[1,1,1],'#ff3333'),
  makeBox('Coincident last <b>literal</b>',[0,2.5,0],[0,0,0],[1,1,1],'#3366ff'),
 ]};
 const serialize=value=>'\ufeff'+json(value).replaceAll('\n','\r\n').replace('"objects":','"obj\\u0065cts":');
 const original=serialize(scene);
 await execute({command:'object.create',mode:'apply',worldId:world.world.id,baseRevision:world.world.revision,actorRef:{kind:'tool',id:'scene3d-picking-smoke'},objectId,documentType:'level',sourcePath,content:original});
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
 const input=async(content,emit=true)=>evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');e.value=${JSON.stringify(content)};${emit?"e.dispatchEvent(new Event('input',{bubbles:true}));":''}})()`);
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
 await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>state('appState.isEditing'),'ordinary read-only navigation');await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');await enabled('#scene3dPreviewBtn');

 const decode=content=>JSON.parse(content.replace(/^\ufeff/,'')),visible=content=>content.replace(/\r\n?/g,'\n');
 const system=await evaluate("(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()");report.system=system;
 assert.ok(system.initializedModules.includes('org.viento.scene3d'));assert.equal(system.initializedModules.length,13);assert.equal(system.plan.capabilities.length,29);
 const sourceBefore=await sourceValue();assert.equal(sourceBefore,visible(original));
 const search=async value=>evaluate(`(()=>{const e=document.querySelector('#scene3dSearch');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const ids=()=>evaluate("Array.from(document.querySelectorAll('#scene3dObjects button'),e=>e.dataset.instanceId)");
 const inspector=()=>evaluate("document.querySelector('#scene3dInspector').textContent");
 const assertSelected=async id=>assert.ok((await inspector()).includes(id));
 const assertSource=async expected=>{assert.equal(await sourceValue(),visible(expected));assert.equal(await readSource(),original);};
 const selectFromList=async id=>{const query=await evaluate("document.querySelector('#scene3dSearch').value");await search('');await click(`#scene3dObjects button[data-instance-id="${id}"]`);await assertSelected(id);await search(query);await settleFrames();};
 const pickPoint=async point=>{await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});for(const [type,buttons] of [['mousePressed',1],['mouseReleased',0]])await call('Input.dispatchMouseEvent',{type,...point,button:'left',buttons,clickCount:1});await settleFrames();};
 const doublePoint=async point=>{await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});for(const clickCount of [1,2]){for(const[type,buttons]of[['mousePressed',1],['mouseReleased',0]])await call('Input.dispatchMouseEvent',{type,...point,button:'left',buttons,clickCount});await delay(70);}await settleFrames();};
 const bounds=()=>evaluate("(()=>{const c=document.querySelector('#scene3dCanvas'),r=c.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height,bufferWidth:c.width,bufferHeight:c.height};})()");
 // Independent analytical camera projection; this does not import renderer,
 // picking math, hitTest, source index or any private preview instance.
 const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);};
 const project=async object=>{const r=await bounds(),c=scene.camera,z=unit(c.position.map((v,i)=>v-c.target[i])),x=unit(cross([0,1,0],z)),y=cross(z,x),delta=object.position.map((v,i)=>v-c.position[i]);
  const depth=-dot(z,delta),f=1/Math.tan(c.fovDegrees*Math.PI/360),nx=f*dot(x,delta)/depth/(r.bufferWidth/r.bufferHeight),ny=f*dot(y,delta)/depth;
  assert.ok(depth>c.near&&depth<c.far);return{x:r.left+(nx+1)*r.width/2,y:r.top+(1-ny)*r.height/2};};
 const pixelAt=async point=>evaluate(`(()=>{const c=document.querySelector('#scene3dCanvas'),r=c.getBoundingClientRect(),g=c.getContext('webgl2'),p=new Uint8Array(4);g.readPixels(Math.floor((${point.x}-r.left)*c.width/r.width),c.height-1-Math.floor((${point.y}-r.top)*c.height/r.height),1,1,g.RGBA,g.UNSIGNED_BYTE,p);return Array.from(p);})()`);
 const reset=async()=>{await click('#scene3dReset');await settleFrames();};
 const mappedSelection=async(expected,id)=>{const location=await evaluate(`(await import('/engine/scene3d.mjs')).parseScene3DSource(${JSON.stringify(expected)}).sourceLocations.objects.find(e=>e.instanceId===${JSON.stringify(id)})`);
  const expectedRange={start:visible(expected.slice(0,location.sourceRange.start)).length,end:visible(expected.slice(0,location.sourceRange.end)).length};
  const actual=await evaluate("(()=>{const e=document.querySelector('#docSourceEditor');return{start:e.selectionStart,end:e.selectionEnd,selected:e.value.slice(e.selectionStart,e.selectionEnd),focused:document.activeElement===e};})()");
  assert.equal(actual.start,expectedRange.start);assert.equal(actual.end,expectedRange.end);assert.equal(actual.focused,true);assert.deepEqual(JSON.parse(actual.selected),decode(expected).objects.find(o=>o.instanceId===id));
  (report.sourceSelections||=[]).push({instanceId:id,propertyPath:location.propertyPath,rawRange:location.sourceRange,displayRange:expectedRange,focused:true});};
 const locate=async(expected,id)=>{await enabled('#scene3dLocate');await click('#scene3dLocate');await wait(()=>evaluate("!document.querySelector('#scene3dDialog').open"),'canvas-selected source navigation');await mappedSelection(expected,id);await assertSource(expected);};
 const [copper,mint,rear,front,coincidentFirst,coincidentLast]=scene.objects;
 await open();assert.deepEqual(await ids(),scene.objects.map(o=>o.instanceId));const native=await evaluate(`(await import('/engine/scene3d.mjs')).parseScene3DSource(${JSON.stringify(original)}).model.objects`);assert.deepEqual(native,scene.objects);
 const initial=await pixels();assert.ok(initial.nonBackground>1000);report.gpu=initial;assert.equal(initial.error,0);await assertSource(original);
 report.steps.push('Actual twelve-module/twenty-eight-capability HTTP runtime renders six native-admitted boxes. Fixture covers mixed-axis rotated nonuniform boxes, front/rear occlusion and fully coincident boxes; native UUIDs are verified against source independently of the UI list. Real WebGL2 readPixels records its software renderer.');

 await search('Copper');await pickPoint(await project(mint));await assertSelected(mint.instanceId);assert.deepEqual(await ids(),[copper.instanceId]);assert.equal(await evaluate("document.querySelector('#scene3dSelectionHidden').hidden"),false);assert.equal(await evaluate("document.querySelector('#scene3dSearch').value"),'Copper');
 const blankBounds=await bounds();await pickPoint({x:blankBounds.left+8,y:blankBounds.top+8});await assertSelected(mint.instanceId);
 const copperPoint=await project(copper);for(const[type,buttons]of[['mousePressed',2],['mouseReleased',0]])await call('Input.dispatchMouseEvent',{type,...copperPoint,button:'right',buttons,clickCount:1});await assertSelected(mint.instanceId);
 await call('Input.dispatchMouseEvent',{type:'mousePressed',...copperPoint,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:copperPoint.x+2,y:copperPoint.y+1,buttons:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:copperPoint.x+2,y:copperPoint.y+1,button:'left',buttons:0,clickCount:1});await settleFrames();await assertSelected(copper.instanceId);assert.deepEqual(await pixels(),initial);await assertSource(original);
 report.steps.push('Real primary pointer release selects the rotated nonuniform box by stable UUID even outside the name filter, preserving the query and hidden-selection explanation. Empty space and right clicks retain selection. Subthreshold two-pixel pointer jitter selects without orbiting or changing the authored source.');

 await click('#scene3dClearSearch');await pickPoint(await project(rear));await assertSelected(front.instanceId);await pickPoint(await project(coincidentFirst));await assertSelected(coincidentLast.instanceId);
 const tiePixel=await pixelAt(await project(coincidentLast));assert.ok(tiePixel[2]>tiePixel[0]);report.coincidentPixel=tiePixel;assert.equal(await evaluate("document.querySelector('#scene3dObjects b')"),null);await screenshot('picking-desktop.png');await assertSource(original);
 report.steps.push('Independent camera-center projection plus real GPU pixels confirm that the nearer front box is selected instead of the occluded rear box. Fully coincident surfaces select the last drawn UUID under the existing LEQUAL depth policy; the actual blue pixel agrees. Author HTML names remain text. This is mathematical box picking, not a pixel-perfect ID buffer claim.');

 const selectedAuthor=await pixels();report.selectedAuthorGpu=selectedAuthor;
 const dragPoint=await project(copper);await call('Input.dispatchMouseEvent',{type:'mousePressed',...dragPoint,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:dragPoint.x+65,y:dragPoint.y+20,buttons:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:dragPoint.x+65,y:dragPoint.y+20,button:'left',buttons:0,clickCount:1});await settleFrames();await assertSelected(coincidentLast.instanceId);const orbited=await pixels();assert.notEqual(orbited.hash,selectedAuthor.hash);report.orbitedGpu=orbited;await reset();assert.deepEqual(await pixels(),selectedAuthor);
 const wheelPoint=await project(mint);await call('Input.dispatchMouseEvent',{type:'mouseWheel',...wheelPoint,deltaY:80,deltaX:0});await settleFrames();await assertSelected(coincidentLast.instanceId);assert.notEqual((await pixels()).hash,selectedAuthor.hash);await reset();assert.deepEqual(await pixels(),selectedAuthor);
 await doublePoint(await project(copper));await assertSelected(copper.instanceId);const focused=await pixels();assert.ok(focused.nonBackground>1000);assert.notEqual(focused.hash,initial.hash);report.focusedGpu=focused;assert.match(await evaluate("document.querySelector('#scene3dStatus').textContent"),/已聚焦/);await reset();assert.deepEqual(await pixels(),initial);await assertSource(original);
 report.steps.push('Actual drag beyond the movement threshold orbits without changing selection; real wheel zoom likewise never selects. A qualified real double-click selects and invokes only the existing temporary Focus. GPU hashes change for orbit/focus and Reset restores identical authored-camera pixels with the same selected UUID and the accurate reset status. Source and disk stay unchanged.');

 await search('Copper');await pickPoint(await project(mint));await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await settleFrames();
 await evaluate("document.querySelector('#scene3dDialog').scrollTop=0");await settleFrames();const beforeScroll=await bounds(),narrowAuthor=await pixels();
 const scrolled=await evaluate("(()=>{const d=document.querySelector('#scene3dDialog');d.scrollTop=70;return{scrollTop:d.scrollTop,maxScroll:d.scrollHeight-d.clientHeight};})()");assert.ok(scrolled.scrollTop>=50);await settleFrames();const afterScroll=await bounds();
 assert.equal(afterScroll.width,beforeScroll.width);assert.equal(afterScroll.height,beforeScroll.height);assert.ok(beforeScroll.top-afterScroll.top>=50);report.positionOnlyScroll={before:beforeScroll,after:afterScroll,...scrolled};
 await pickPoint(await project(front));await assertSelected(front.instanceId);await selectFromList(copper.instanceId);const narrowCopperAuthor=await pixels();await doublePoint(await project(copper));await assertSelected(copper.instanceId);assert.match(await evaluate("document.querySelector('#scene3dStatus').textContent"),/已聚焦/);assert.notEqual((await pixels()).hash,narrowCopperAuthor.hash);await selectFromList(mint.instanceId);await reset();assert.deepEqual(await pixels(),narrowAuthor);
 for(const language of ['zh-CN','en','ja']){await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);await delay(100);await evaluate("document.querySelector('#scene3dDialog').scrollTop=0");await settleFrames();
  assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth||document.querySelector('#scene3dDialog').scrollWidth>document.querySelector('#scene3dDialog').clientWidth"),false);
  await pickPoint(await project(front));await assertSelected(front.instanceId);assert.deepEqual(await ids(),[copper.instanceId]);assert.equal(await evaluate("document.querySelector('#scene3dSearch').value"),'Copper');assert.equal(await evaluate("document.querySelector('#scene3dSelectionHidden').hidden"),false);
  const help=await evaluate("(async()=>{const {t}=await import('/web/i18n/index.js');return{actual:document.querySelector('#scene3dGestures').textContent,expected:t('单击方块选择，双击聚焦；拖动旋转视角，滚轮缩放。Y轴向上，右手坐标系，欧拉旋转XYZ。')};})()");assert.equal(help.actual,help.expected);(report.gestureTranslations||=[]).push({language,...help});await screenshot(`picking-${language}-390.png`);
 }
 await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");await settleFrames();await assertSource(original);
 report.steps.push('Chinese, English and Japanese at 390 px preserve the same filter and stable canvas-selected UUID outside results. A normal modal scroll changes only canvas position, not dimensions; real taps and native double-click still select and focus, including native pointer-capture release/lost-capture order. Public list selection restores the reference UUID before Reset, which restores identical narrow author-camera pixels in that same selection state. True taps also work after responsive redraws; gesture help is translated and the layout has no horizontal overflow.');

 await locate(original,front.instanceId);assert.equal(await state('appState.editHasUnsavedChanges'),false);await open();const reordered={...scene,objects:[...scene.objects].reverse()},reorderedSource=serialize(reordered);await input(reorderedSource);await delay(100);assert.equal(await evaluate("document.querySelector('#scene3dLocate').disabled"),true);
 await pickPoint(await project(copper));await assertSelected(copper.instanceId);await assertSource(reorderedSource);assert.equal(await evaluate("document.querySelector('#scene3dLocate').disabled"),true);await refresh();await assertSelected(copper.instanceId);
 await pickPoint(await project(coincidentLast));await assertSelected(coincidentFirst.instanceId);await locate(reorderedSource,coincidentFirst.instanceId);
 report.steps.push('A canvas-selected UUID uses the existing read-only locator, with native UTF-16 ranges correctly mapped through BOM, CRLF, escaped object keys and preceding astral text. An actual source input immediately blocks old-token location while last-valid visual picking remains usable. Refresh preserves the selected UUID; reversed coincident draw order updates the picked stable identity, and refreshed source navigation resolves its current index.');

 await open();const removed={...reordered,objects:reordered.objects.filter(o=>o.instanceId!==coincidentFirst.instanceId)},removedSource=serialize(removed);await pickPoint(await project(coincidentFirst));await assertSelected(coincidentFirst.instanceId);await input(removedSource);await refresh();await assertSelected(removed.objects[0].instanceId);
 const beforeInvalid=await pixels();await input('{"invalid":');await refresh();assert.match(await evaluate("document.querySelector('#scene3dStatus').textContent"),/保留上一次有效/);await pickPoint(await project(mint));await assertSelected(mint.instanceId);assert.equal(await evaluate("document.querySelector('#scene3dLocate').disabled"),true);await selectFromList(removed.objects[0].instanceId);assert.deepEqual(await pixels(),beforeInvalid);await close();await input(original);await assertSource(original);
 report.steps.push('Explicit ordinary-source fixture deletion removes a model identity and refresh falls back to the first survivor. Invalid newer source retains the last valid rendered model and permits visual picking, with source location still blocked. Closing returns to the editor without implicit Save. Unit tests separately cover pending locator/load and released old-canvas callbacks.');

 const injection=await call('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const old=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl2'?null:old.call(this,kind,...args);};})()"});
 await call('Page.navigate',{url:`${base}/web/?mode=edit&no-webgl=1`});await wait(()=>state('appState.editBackendAvailable'),'renderer-independent editor');await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>state('appState.isEditing'),'renderer-independent edit');await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');await open();
 assert.equal(await evaluate("document.querySelector('#scene3dFallback').hidden"),false);assert.equal(await evaluate("document.querySelector('#scene3dFocus').disabled"),true);await click(`#scene3dObjects button[data-instance-id="${mint.instanceId}"]`);await assertSelected(mint.instanceId);await screenshot('picking-without-webgl.png');await locate(original,mint.instanceId);await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier});
 await assertSource(original);assert.equal(await state('appState.editHasUnsavedChanges'),false);assert.deepEqual(report.errors,[]);assert.deepEqual(report.svgRequests,[]);assert.deepEqual(report.cspViolations,[]);report.modules=[...new Set(report.modules)].sort();
 report.steps.push('Explicit WebGL2-unavailable injection disables GPU interaction truthfully while native list selection and exact source location remain available. All preview actions are read-only; saved bytes remain the original fixture, no author/World/execution/Save port is granted, and no installation/device/hardware-GPU claim is made.');
 report.sourcesFinal=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));report.sourceStableDuringProof=JSON.stringify(report.sourcesFinal)===JSON.stringify(report.sources);assert.equal(report.sourceStableDuringProof,true);report.ok=true;report.status='passed';
} catch(error){await captureFailure?.().catch(()=>{});report.status='failed';report.failure=String(error.stack||error);process.exitCode=1;}
finally{socket?.close();for(const cleanup of cleanups.reverse())await cleanup();report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),json(report));console.log(json(report));}
