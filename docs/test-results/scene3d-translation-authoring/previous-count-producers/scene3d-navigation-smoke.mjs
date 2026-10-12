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
const output=path.resolve(process.env.VIENTO_SCENE3D_OUTPUT||path.join(os.tmpdir(),`viento-scene3d-navigation-browser-${Date.now()}`));
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
const sources=['scripts/tests/scene3d-navigation-smoke.mjs','engine/scene3d-navigation.mjs','engine/scene3d-authoring.mjs','engine/scene3d-transform.mjs','web/modules/app-scene3d-transforms.js','web/scene3d-transforms.css','engine/scene3d.mjs','engine/studio-core.mjs','engine/studio-modules.mjs','web/modules/app-scene3d-preview.js','web/modules/scene3d-renderer.js','web/modules/scene3d-math.js','web/modules/app-studio-system.js','web/modules/app-runtime.js','web/scene3d.css','web/i18n/en.js','web/i18n/ja.js'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));
let socket,captureFailure;
const wait=async(fn,label)=>{for(let n=0;n<450;n++){if(await fn())return;await delay(100);}throw Error(`Timed out: ${label}`);};
try {
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-scene3d-navigation-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
 const root=path.join(temporary,'workspace'),template=PROJECT_TEMPLATE_CATALOG.templates.find(item=>item.packageId==='org.viento.oc-game');assert.ok(template);
 const write=async(name,content)=>{const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);};
 for(const name of ['documents','templates','metadata/documents','metadata/assets','assets'])await fs.mkdir(path.join(root,name),{recursive:true});
 await write('workspace.json',json({format:'viento-workspace',version:3,id:randomUUID(),name:'3D preview source owner',createdAt:0,...WORKSPACE_LAYOUT,documentTypes:template.documentTypes,projectTemplate:{packageId:template.packageId,version:template.version},studioProfile:{format:'viento-studio-profile',schemaVersion:1,required:[{capability:'scene.preview.scene3d',apiVersion:1},{capability:'scene.authoring.transforms3d',apiVersion:1},{capability:'scene.authoring.objects3d',apiVersion:1},{capability:'scene.authoring.environment3d',apiVersion:1},{capability:'scene.authoring.properties3d',apiVersion:1}],optional:[]}}));
 for(const[name,content]of Object.entries(template.templates))await write(`templates/${name}`,content);
 await registerWorkspace(root);const execute=createWorldCommandService(root),world=await readWorldProjection(root),objectId=randomUUID(),sourcePath='documents/scenes/three-boxes.json';
 const scene={format:'viento-scene3d',schemaVersion:1,name:'128 searchable boxes',viewport:[960,540],background:'#142538',camera:{position:[5,4,8],target:[0,0,0],fovDegrees:50,near:.1,far:1000},light:{direction:[1,-2,-1],color:'#ffffff',energy:1},objects:Array.from({length:128},(_,i)=>({instanceId:randomUUID(),name:`Box ${i+1} 雪😀`,primitive:'box',position:[(i%16-8)*.65,(Math.floor(i/16)-4)*.65,0],rotationDegrees:[23,-41,67],size:[.4,.4,.4],color:i%2?'#85d7bb':'#eb9869'}))};
 scene.objects[0].name=' First\r\nbox\r 雪😀 ';
 scene.objects[127]={...scene.objects[127],name:'雪 Élite target 128😀 <b>literal</b>',position:[35,4,5],size:[1.7,1.3,1]};
 const serialize=value=>'\ufeff'+json(value).replaceAll('\n','\r\n').replace('"objects":','"obj\\u0065cts":');
 const original=serialize(scene);
 await execute({command:'object.create',mode:'apply',worldId:world.world.id,baseRevision:world.world.revision,actorRef:{kind:'tool',id:'scene3d-navigation-smoke'},objectId,documentType:'level',sourcePath,content:original});
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
 assert.ok(system.initializedModules.includes('org.viento.scene3d'));assert.equal(system.initializedModules.length,12);assert.equal(system.plan.capabilities.length,28);
 assert.ok(system.plan.requests.every(item=>item.status==='supported'));const sourceBefore=await sourceValue();assert.equal(sourceBefore,visible(original));
 const search=async value=>evaluate(`(()=>{const e=document.querySelector('#scene3dSearch');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const ids=()=>evaluate("Array.from(document.querySelectorAll('#scene3dObjects button'),e=>e.dataset.instanceId)");
 const selected=()=>evaluate("document.querySelector('#scene3dInspector').textContent");
 const select=async id=>{await click(`#scene3dObjects button[data-instance-id="${id}"]`);assert.ok((await selected()).includes(id));};
 const assertSource=async expected=>{assert.equal(await sourceValue(),visible(expected));assert.equal(await readSource(),original);};
 const mappedSelection=async(expected,id)=>{const location=await evaluate(`(await import('/engine/scene3d.mjs')).parseScene3DSource(${JSON.stringify(expected)}).sourceLocations.objects.find(e=>e.instanceId===${JSON.stringify(id)})`);
  const expectedRange={start:visible(expected.slice(0,location.sourceRange.start)).length,end:visible(expected.slice(0,location.sourceRange.end)).length};
  const actual=await evaluate("(()=>{const e=document.querySelector('#docSourceEditor');return{start:e.selectionStart,end:e.selectionEnd,selected:e.value.slice(e.selectionStart,e.selectionEnd),focused:document.activeElement===e};})()");
  assert.equal(actual.start,expectedRange.start);assert.equal(actual.end,expectedRange.end);assert.equal(actual.focused,true);assert.deepEqual(JSON.parse(actual.selected),decode(expected).objects.find(o=>o.instanceId===id));
  (report.sourceSelections||=[]).push({instanceId:id,propertyPath:location.propertyPath,rawRange:location.sourceRange,displayRange:expectedRange,focused:actual.focused});};
 const locate=async(expected,id)=>{await enabled('#scene3dLocate');await click('#scene3dLocate');await wait(()=>evaluate("!document.querySelector('#scene3dDialog').open"),'readonly exact source navigation closes modal');await mappedSelection(expected,id);await assertSource(expected);};
 const last=scene.objects[127].instanceId;await open();assert.equal((await ids()).length,128);assert.match(await evaluate("document.querySelector('#scene3dMatches').textContent"),/128 \/ 128/);
 const first=await pixels();assert.ok(first.nonBackground>1000);report.gpu=first;assert.equal(await evaluate("document.querySelector('#scene3dNoResults').hidden"),true);assert.equal(await evaluate("document.querySelector('#scene3dSelectionHidden').hidden"),true);await assertSource(original);
 report.steps.push('Actual twelve-module/twenty-eight-capability runtime loads 128 native-admitted boxes with stable UUID rows, matching/total counts and UTF-16 declaration pointers. BOM/CRLF source includes escaped object keys and preceding astral Unicode. Real WebGL2 readPixels records explicit renderer identity.');

 await search('  ÉLITE  ');assert.deepEqual(await ids(),[last]);assert.equal(await evaluate("document.querySelector('#scene3dSearch').value"),'  ÉLITE  ');await select(last);
 assert.equal(await evaluate("document.activeElement?.dataset.instanceId"),last);await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});assert.equal(await evaluate("document.activeElement?.dataset.instanceId"),last);
 assert.equal(await evaluate("document.querySelector('#scene3dObjects b')"),null);await search(last.toUpperCase());assert.deepEqual(await ids(),[last]);await search('no-matching-object');assert.deepEqual(await ids(),[]);assert.equal(await evaluate("document.querySelector('#scene3dNoResults').hidden"),false);assert.equal(await evaluate("document.querySelector('#scene3dSelectionHidden').hidden"),false);assert.ok((await selected()).includes(last));
 const selectedAuthor=await pixels();report.selectedAuthorGpu=selectedAuthor;
 await enabled('#scene3dFocus');await click('#scene3dFocus');await settleFrames();const focused=await pixels();assert.ok(focused.nonBackground>1000);assert.notEqual(focused.hash,selectedAuthor.hash);report.focusedGpu=focused;await assertSource(original);
 await click('#scene3dReset');await settleFrames();const reset=await pixels();assert.deepEqual(reset,selectedAuthor);report.resetGpu=reset;await assertSource(original);
 const resetStatus=await evaluate("(async()=>{const {t}=await import('/web/i18n/index.js');return{actual:document.querySelector('#scene3dStatus').textContent,expected:t('视角已重置为作者相机；原文保持不变。')};})()");assert.equal(resetStatus.actual,resetStatus.expected);report.resetStatus=resetStatus;
 await click('#scene3dClearSearch');assert.equal((await ids()).length,128);assert.equal(await evaluate(`document.querySelector('#scene3dObjects button[data-instance-id="${last}"]').getAttribute('aria-pressed')`),'true');assert.equal(await evaluate("document.activeElement.id"),'scene3dSearch');
 report.steps.push('Trimmed Unicode lowercase name and UUID matching selects the same stable UUID, renders authored HTML as text and preserves keyboard/button focus across list rebuilds. Empty results preserve the hidden selection and inspector. Focus frames that selected box even outside results using a temporary camera; Reset restores identical authored-camera pixels with that same selected UUID. Search, focus and reset leave draft/disk bytes unchanged.');

 await search('  ÉLITE  ');await screenshot('navigation-desktop.png');await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 for(const language of ['zh-CN','en','ja']){await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);await delay(100);await settleFrames();
  assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth||document.querySelector('#scene3dDialog').scrollWidth>document.querySelector('#scene3dDialog').clientWidth"),false);assert.equal(await evaluate("document.querySelector('#scene3dSearch').value"),'  ÉLITE  ');assert.deepEqual(await ids(),[last]);assert.ok((await selected()).includes(last));
  const labels=await evaluate("(async()=>{const {t}=await import('/web/i18n/index.js');return{actual:document.querySelector('#scene3dLocate').textContent,expected:t('定位对象原文')};})()");assert.equal(labels.actual,labels.expected);
  const status=await evaluate("(async()=>{const {t}=await import('/web/i18n/index.js');return{actual:document.querySelector('#scene3dStatus').textContent,expected:t('视角已重置为作者相机；原文保持不变。')};})()");assert.equal(status.actual,status.expected);(report.localizedResetStatus||=[]).push({language,...status});
  await evaluate("(()=>{const d=document.querySelector('#scene3dDialog'),e=document.querySelector('.scene3d-sidebar');d.scrollTop+=e.getBoundingClientRect().top-d.getBoundingClientRect().top-20;})()");await screenshot(`navigation-${language}-390.png`);
  const footer=await evaluate("['scene3dFocus','scene3dLocate','scene3dReset','scene3dRefresh'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return{id,top:r.top,bottom:r.bottom};})");for(const item of footer)assert.ok(item.top>=0&&item.bottom<=844);(report.narrowFooterChecks||=[]).push({language,controls:footer});
 }
 await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");await settleFrames();await assertSource(original);
 report.steps.push('Chinese, English and Japanese at 390 px retain the exact filter and selected UUID with readable scrollable results and inspector. All four navigation/view controls remain inside the visible viewport, with no horizontal overflow or inline-style CSP violations.');

 await locate(original,last);assert.equal(await state('appState.editHasUnsavedChanges'),false);await enabled('#scene3dPreviewBtn');
 report.steps.push('Real source navigation accepts only the current complete snapshot and stable UUID, reparses native source and maps exact UTF-16 ranges into the CRLF-normalized textarea. The modal closes before source focus; the selected original declaration matches the object exactly despite BOM, escaped keys and preceding astral Unicode. Draft, owner and saved bytes remain unchanged.');

 await open();await search('Élite');await select(last);const reordered={...scene,objects:[...scene.objects].reverse()},reorderedSource=serialize(reordered);await input(reorderedSource);await delay(100);
 assert.equal(await evaluate("document.querySelector('#scene3dLocate').disabled"),true);await click('#scene3dLocate');await assertSource(reorderedSource);assert.equal(await evaluate("document.querySelector('#scene3dDialog').open"),true);
 await refresh();assert.ok((await selected()).includes(last));assert.deepEqual(await ids(),[last]);assert.equal(await evaluate("document.querySelector('#scene3dSearch').value"),'Élite');await locate(reorderedSource,last);
 await open();await search('Élite');const removed={...reordered,objects:reordered.objects.filter(o=>o.instanceId!==last)},removedSource=serialize(removed);await input(removedSource);await refresh();assert.ok((await selected()).includes(removed.objects[0].instanceId));assert.deepEqual(await ids(),[]);assert.equal(await evaluate("document.querySelector('#scene3dSelectionHidden').hidden"),false);await click('#scene3dClearSearch');assert.equal((await ids()).length,127);await assertSource(removedSource);await close();
 report.steps.push('Explicit fixture source edits demonstrate ownership: an old preview cannot locate after a draft change. Valid refresh/reorder keeps the selected UUID and filter and rederives its new source index. Removing that selected declaration via ordinary source editing falls back to the first surviving UUID while retaining the unmatched filter; clearing reveals 127 rows. Navigation itself never creates a source proposal or saves these fixture edits.');

 await open();const silentSource=removedSource+' ';await input(silentSource,false);await click('#scene3dLocate');await delay(100);assert.equal(await evaluate("document.querySelector('#scene3dDialog').open"),true);assert.equal(await evaluate("document.querySelector('#scene3dLocate').disabled"),true);assert.match(await evaluate("document.querySelector('#scene3dStatus').textContent"),/未确认.*刷新/);await assertSource(silentSource);await refresh();
 await input('{"invalid":');await refresh();assert.match(await evaluate("document.querySelector('#scene3dStatus').textContent"),/保留上一次有效/);assert.equal(await evaluate("document.querySelector('#scene3dLocate').disabled"),true);assert.equal((await ids()).length,127);assert.equal(await readSource(),original);await close();await input(original);
 report.steps.push('A silent raw textarea change without an input event invalidates source navigation and produces a refresh explanation. Invalid newer source retains the last valid display/index and blocks stale location; Cancel returns without writing or implicitly saving. Deferred close/query/owner/receipt failures are separately covered by the actual-controller unit harness.');

 const injection=await call('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const old=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl2'?null:old.call(this,kind,...args);};})()"});
 await call('Page.navigate',{url:`${base}/web/?mode=edit&no-webgl=1`});await wait(()=>state('appState.editBackendAvailable'),'renderer-independent editor');await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>state('appState.isEditing'),'renderer-independent edit');await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');
 await open();assert.equal(await evaluate("document.querySelector('#scene3dFallback').hidden"),false);assert.equal(await evaluate("document.querySelector('#scene3dFocus').disabled"),true);await search('Élite');await select(last);await screenshot('navigation-without-webgl.png');await locate(original,last);await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier});
 report.steps.push('With WebGL2 alone explicitly injected unavailable, the preview truthfully reports no draw and disables temporary Focus, while the same native name/UUID search and exact source navigation remain usable. No renderer capability is required to select the author declaration.');

 await assertSource(original);assert.equal(await state('appState.editHasUnsavedChanges'),false);assert.deepEqual(report.errors,[]);assert.deepEqual(report.svgRequests,[]);assert.deepEqual(report.cspViolations,[]);report.modules=[...new Set(report.modules)].sort();assert.ok(report.modules.includes('/web/modules/app-scene3d-preview.js'));
 report.steps.push('All navigation/view actions use the existing read-only preview assembly, without authoring, World, execution or Save callbacks. Saved bytes are still the original fixture. No installation, Android, physical-device or hardware-GPU assertion is made.');
 report.sourcesFinal=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));report.sourceStableDuringProof=JSON.stringify(report.sourcesFinal)===JSON.stringify(report.sources);assert.equal(report.sourceStableDuringProof,true);report.ok=true;report.status='passed';
} catch(error){await captureFailure?.().catch(()=>{});report.status='failed';report.failure=String(error.stack||error);process.exitCode=1;}
finally{socket?.close();for(const cleanup of cleanups.reverse())await cleanup();report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),json(report));console.log(json(report));}
