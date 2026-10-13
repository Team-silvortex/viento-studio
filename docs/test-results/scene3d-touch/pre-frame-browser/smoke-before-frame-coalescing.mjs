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
const output=path.resolve(process.env.VIENTO_SCENE3D_OUTPUT||path.join(os.tmpdir(),`viento-scene3d-touch-browser-${Date.now()}`));
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Choose a new empty VIENTO_SCENE3D_OUTPUT.');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),json=value=>JSON.stringify(value,null,2)+'\n';
const cleanups=[],t={after:fn=>cleanups.push(fn)};
const report={startedAt:new Date().toISOString(),steps:[],errors:[],screenshots:[],modules:[],limitations:[
 'Real HTTP editor, native/WASM source semantics and WebGL2 draws/readPixels; no installed desktop, Android or hardware-GPU claim.',
 'Chrome flags and renderer/vendor are recorded explicitly. This run pins ANGLE/SwiftShader; the automatic headless fallback exhibited compositor corruption in a separate retained comparison. No hardware-GPU claim.',
 'Unsupported-renderer phase injects getContext(webgl2)=null only; all source semantics and editor Save remain real.',
 'Two-finger input is exercised through real Chrome touch events. Instrumentation records actual uploaded matrices and forwards WebGL calls unchanged; target-plane anchors are checked independently.'
]};
report.node={version:process.version,sha256:hash(await fs.readFile(process.execPath))};
const sources=['scripts/tests/scene3d-touch-smoke.mjs','engine/scene3d.mjs','engine/studio-core.mjs','engine/studio-modules.mjs','web/modules/app-scene3d-preview.js','web/modules/scene3d-renderer.js','web/modules/scene3d-math.js','web/modules/scene3d-orientation.js','web/modules/app-studio-system.js','web/modules/app-runtime.js','web/scene3d.css','web/i18n/en.js','web/i18n/ja.js'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));
let socket,captureFailure;
const wait=async(fn,label)=>{for(let n=0;n<450;n++){if(await fn())return;await delay(100);}throw Error(`Timed out: ${label}`);};
try {
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-scene3d-touch-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
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
 await execute({command:'object.create',mode:'apply',worldId:world.world.id,baseRevision:world.world.revision,actorRef:{kind:'tool',id:'scene3d-touch-smoke'},objectId,documentType:'level',sourcePath,content:original});
 const env={...process.env,VIENTO_APP_ROOT:appRoot,VIENTO_WORKSPACE_ROOT:root,XDG_CACHE_HOME:path.join(temporary,'cache')};
 for(const key of ['VIENTO_GODOT_BIN','VIENTO_BEVY_BIN','VIENTO_EXECUTION_BACKEND','VIENTO_SESSION_TOKEN','VIENTO_PREFERENCES_PATH'])delete env[key];
 await runCommand(process.execPath,[path.join(appRoot,'scripts/ops/rebuild.mjs')],{cwd:appRoot,env});const base=await serve(t,appRoot,env),readSource=()=>fs.readFile(path.join(root,sourcePath),'utf8');
 report.servedSources={};
 for(const name of sources.filter(name=>name.startsWith('web/')||name.startsWith('engine/'))){const response=await fetch(base+'/'+name);assert.equal(response.status,200);report.servedSources[name]=hash(Buffer.from(await response.arrayBuffer()));assert.equal(report.servedSources[name],report.sources[name],'HTTP source identity: '+name);}
 const chromeRoot=path.join(temporary,'chrome');await fs.mkdir(chromeRoot);
 // Pin both drawing and compositing to the tested software path. Chrome's automatic
 // fallback can report the same renderer string while corrupting scrolled tall canvases.
 const chromeArguments=['--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--no-first-run','--no-default-browser-check',`--user-data-dir=${chromeRoot}`,'--remote-debugging-port=0','--window-size=1440,1080','about:blank'];
 report.chromeArguments=chromeArguments;
 const chrome=spawn(process.argv[2]||'/usr/bin/google-chrome',chromeArguments,{stdio:'ignore'});
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
 const screenshot=async (name,options={})=>{const data=await call('Page.captureScreenshot',{format:'png',...options});await fs.writeFile(path.join(output,name),Buffer.from(data.data,'base64'));report.screenshots.push(name);return data.data;};
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

 const directions={front:{back:[0,0,1],up:[0,1,0],right:[1,0,0]},back:{back:[0,0,-1],up:[0,1,0],right:[-1,0,0]},left:{back:[-1,0,0],up:[0,1,0],right:[0,0,1]},right:{back:[1,0,0],up:[0,1,0],right:[0,0,-1]},top:{back:[0,1,0],up:[0,0,-1],right:[1,0,0]},bottom:{back:[0,-1,0],up:[0,0,1],right:[1,0,0]}};
 const unit=v=>{const length=Math.hypot(...v);return v.map(n=>n/length);};
 async function assertIndicator(label){
  const [frame]=await draws(),m=frame.projection,right=unit([m[0],m[4],m[8]]),up=unit([m[1],m[5],m[9]]),back=unit(m[15]===1?[-m[2],-m[6],-m[10]]:[-m[3],-m[7],-m[11]]);
  const badge=await evaluate(`(()=>{const e=document.querySelector('#scene3dOrientation'),svg=e.querySelector('svg');return{hidden:e.hidden,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),events:getComputedStyle(e).pointerEvents,live:e.getAttribute('aria-live'),groups:[...e.querySelectorAll('[data-axis]')].map(g=>{const line=g.querySelector('line'),dot=g.querySelector('circle');return{axis:g.dataset.axis,depth:Number(g.dataset.depth),x:(Number(line.getAttribute('x2'))-48)/28,y:(Number(line.getAttribute('y2'))-48)/28,facing:dot.dataset.facing};}),labels:[...e.querySelectorAll('[data-axis-label]')].map(n=>{const b=n.getBBox();return{text:n.textContent,x:b.x,y:b.y,width:b.width,height:b.height};}),bounds:(()=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()};})()`);
  assert.equal(badge.hidden,false);assert.equal(badge.role,'img');assert.equal(badge.events,'none');assert.equal(badge.live,null);assert.equal(badge.groups.length,3);
  for(const [index,axis]of ['X','Y','Z'].entries()){const actual=badge.groups.find(g=>g.axis===axis);for(const [field,expected]of [['x',right[index]],['y',-up[index]],['depth',back[index]]])assert.ok(Math.abs(actual[field]-expected)<1e-6,JSON.stringify({label,axis,field,expected,actual}));assert.ok(badge.labels.some(item=>item.text==='+'+axis));}
  for(const box of badge.labels)assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=96&&box.y+box.height<=96,JSON.stringify({label,box}));
  const translated=await evaluate("(await import('/web/i18n/index.js')).t('坐标方向')");assert.ok(badge.label.includes(translated));
  (report.orientationChecks||=[]).push({label,...badge});return badge;
 }

 async function assertDirection(direction,label=direction){const [frame]=await draws(),m=frame.projection,expected=directions[direction],actual={right:unit([m[0],m[4],m[8]]),up:unit([m[1],m[5],m[9]]),back:unit(m[15]===1?[-m[2],-m[6],-m[10]]:[-m[3],-m[7],-m[11]])};for(const key of ['right','up','back'])actual[key].forEach((n,i)=>assert.ok(Math.abs(n-expected[key][i])<1e-7,`${label} ${key} ${i}: ${n}`));(report.directionChecks||=[]).push({label,actual});}
 async function setDirection(direction){await enabled('#scene3dSetDirection');await evaluate(`(()=>{const e=document.querySelector('#scene3dDirection');e.value=${JSON.stringify(direction)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await click('#scene3dSetDirection');await settleFrames();await assertIndicator('direction-'+direction);}
 const canvasCenter=async()=>{await evaluate("document.querySelector('#scene3dCanvas').scrollIntoView({block:'center',behavior:'instant'})");await settleFrames();return evaluate("(()=>{const r=document.querySelector('#scene3dCanvas').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()");};
 const projection=()=>evaluate("document.querySelector('#scene3dProjectionMode').value");
 const setProjection=async value=>{await enabled('#scene3dProjectionMode');await evaluate(`(()=>{const e=document.querySelector('#scene3dProjectionMode');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settleFrames();assert.equal(await projection(),value);await assertIndicator('projection-'+value);};
 const mode=()=>evaluate("document.querySelector('#scene3dDragMode').value");
 const setMode=async value=>{await enabled('#scene3dDragMode');await evaluate(`(()=>{const e=document.querySelector('#scene3dDragMode');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);assert.equal(await mode(),value);};
 const rect=()=>evaluate("(()=>{const r=document.querySelector('#scene3dCanvas').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()");
 const projected=(frame,r)=>{const clip=multiply(frame.projection,multiply(frame.model,[0,0,0,1]));return{x:r.x+(clip[0]/clip[3]+1)*r.width/2,y:r.y+(1-clip[1]/clip[3])*r.height/2,depth:clip[3]};};
 async function checkPan(label,{dx=28,dy=18,button='left',modifiers=0,touch=false}={}){
  const center=await canvasCenter(),before=await draws(),r=await rect(),selectedBefore=await selected(),chosen=await mode(),chosenProjection=await projection();
  if(touch){await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...center,id:0}]});await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:center.x+dx,y:center.y+dy,id:0}]});await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else{const buttons=button==='middle'?4:1;await call('Input.dispatchMouseEvent',{type:'mousePressed',...center,button,buttons,modifiers,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:center.x+dx,y:center.y+dy,button,buttons,modifiers});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:center.x+dx,y:center.y+dy,button,buttons:0,modifiers,clickCount:1});}
  await settleFrames();const after=await draws(),checks=[];
  for(let i=0;i<3;i++){const old=projected(before[i],r),next=projected(after[i],r),distance=before[i].projection[15];const expected=chosenProjection==='orthographic'?{x:dx,y:dy}:{x:dx*distance/old.depth,y:dy*distance/old.depth};assert.ok(Math.abs((next.x-old.x)-expected.x)<.03,JSON.stringify({label,old,next,expected}));assert.ok(Math.abs((next.y-old.y)-expected.y)<.03,JSON.stringify({label,old,next,expected}));assert.ok(Math.abs(next.depth-old.depth)<.0001);checks.push({object:i,actual:[next.x-old.x,next.y-old.y],expected:[expected.x,expected.y]});}
  assert.equal(await selected(),selectedBefore);assert.equal(await mode(),chosen);assert.equal((await pixels()).error,0);assert.equal(await readSource(),original);(report.panChecks||=[]).push({label,projection:chosenProjection,dx,dy,button,modifiers,touch,checks});await assertIndicator('pan-'+label);
 }

 async function checkTouch(label,{spread=1.5,dx=14,dy=9,endFirst=1}={}){
  const center=await canvasCenter(),r=await rect(),before=await draws(),selection=await selected(),chosen=await mode(),pMode=await projection(),m=before[0].projection;
  const mid={x:center.x+22,y:center.y-18},nextMid={x:mid.x+dx,y:mid.y+dy};
  const start=[{x:mid.x-38,y:mid.y,id:1},{x:mid.x+38,y:mid.y,id:2}],end=[{x:nextMid.x-38*spread,y:nextMid.y,id:1},{x:nextMid.x+38*spread,y:nextMid.y,id:2}];
  for(const p of [...start,...end])assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`),'scene3dCanvas',`${label} touch begins on canvas`);
  const right=unit([m[0],m[4],m[8]]),up=unit([m[1],m[5],m[9]]),back=unit(m[15]===1?[-m[2],-m[6],-m[10]]:[-m[3],-m[7],-m[11]]),w=m[15],sx=Math.hypot(m[0],m[4],m[8]),sy=Math.hypot(m[1],m[5],m[9]);
  const ax=((mid.x-r.x)/r.width*2-1)*w/sx,ay=(1-(mid.y-r.y)/r.height*2)*w/sy,anchor=right.map((v,i)=>v*ax+up[i]*ay);
  await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:3});
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start[0]]});
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:start});
  await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:end});await settleFrames();
  const after=await draws(),n=after[0].projection;
  assert.notDeepEqual(after,before,label+' actually redraws');
  const relative=anchor.map((v,i)=>v+after[0].model[12+i]-before[0].model[12+i]),clip=multiply(n,[...relative,1]),point={x:r.x+(clip[0]/clip[3]+1)*r.width/2,y:r.y+(1-clip[1]/clip[3])*r.height/2};
  assert.ok(Math.abs(point.x-nextMid.x)<.03&&Math.abs(point.y-nextMid.y)<.03,JSON.stringify({label,point,nextMid}));
  const newRight=unit([n[0],n[4],n[8]]),newUp=unit([n[1],n[5],n[9]]),newBack=unit(n[15]===1?[-n[2],-n[6],-n[10]]:[-n[3],-n[7],-n[11]]);
  for(const [a,b]of [[right,newRight],[up,newUp],[back,newBack]])for(let i=0;i<3;i++)assert.ok(Math.abs(a[i]-b[i])<1e-6,label+' keeps heading');
  const actualScale=(Math.hypot(n[0],n[4],n[8])/n[15])/(sx/w);assert.ok(Math.abs(actualScale-spread)<.0001,`${label} scale ${actualScale} expected ${spread}`);
  // The surviving finger is inert until lifted. Test both release orders.
  const remaining=end.filter(p=>p.id!==endFirst);
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:remaining});
  await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:remaining.map(p=>({...p,x:p.x+20,y:p.y+8}))});await settleFrames();assert.deepEqual(await draws(),after,label+' remaining finger cannot drag');
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settleFrames();
  assert.equal(await selected(),selection);assert.equal(await mode(),chosen);assert.equal(await projection(),pMode);assert.equal(await readSource(),original);assert.equal((await pixels()).error,0);await assertIndicator('two-finger-'+label);
  await call('Emulation.setTouchEmulationEnabled',{enabled:false});
  (report.touchChecks||=[]).push({label,projection:pMode,mode:chosen,spread,actualScale,anchor:point,expected:nextMid,endFirst});
 }
 async function cancelThirdTouch(){
  const c=await canvasCenter(),before=await draws(),selection=await selected();
  const points=[{x:c.x-40,y:c.y,id:1},{x:c.x+40,y:c.y,id:2},{x:c.x,y:c.y+40,id:3}];
  await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:3});
  for(let count=1;count<=3;count++)await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points.slice(0,count)});
  await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points.map(p=>({...p,x:p.x+12,y:p.y+8}))});
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settleFrames();assert.deepEqual(await draws(),before);assert.equal(await selected(),selection);
  await call('Emulation.setTouchEmulationEnabled',{enabled:false});report.steps.push('A real third touch cancels the entire gesture without drawing or selection.');
 }
 await assertIndicator('initial');
 assert.equal(await projection(),'perspective');
 // The plane through the view target keeps its scale on projection changes.
 const perspectiveFrames=await draws(),vp=perspectiveFrames[0].projection;
 const axis=unit([vp[0],vp[4],vp[8]]),planePoints=[[0,0,0,1],[...axis.map(n=>n*2),1]],ndc=(m,p)=>{const v=multiply(m,p);return v.slice(0,2).map(n=>n/v[3]);};
 await setProjection('orthographic');const orthoFrames=await draws();assert.equal(orthoFrames[0].projection[15],1);assert.equal(orthoFrames[0].projection[11],0);
 for(const point of planePoints){const a=ndc(vp,point),b=ndc(orthoFrames[0].projection,point);a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<1e-6));}
 assert.deepEqual(orthoFrames.map(f=>f.model),perspectiveFrames.map(f=>f.model));assert.equal(await sourceValue(),sourceBefore);
 await setProjection('perspective');assert.deepEqual(await draws(),perspectiveFrames);await setProjection('orthographic');
 report.steps.push('Perspective/orthographic switches preserve target-plane scale and model matrices; switching back restores exact perspective uploads without source writes.');

 await setProjection('perspective');await frameAll();await setMode('orbit');await checkTouch('free-perspective',{spread:1.3});
 for(const projectionMode of ['perspective','orthographic']){
  await setProjection(projectionMode);
  for(const direction of Object.keys(directions)){
   await setDirection(direction);await checkTouch(projectionMode+'-'+direction,{spread:direction==='back'?.8:1.5,endFirst:direction==='top'?2:1});await assertDirection(direction);
  }
 }
 await cancelThirdTouch();await setMode('pan');await frameAll();await checkTouch('pan-mode',{spread:1,dx:22,dy:-13,endFirst:2});
 await setMode('orbit');await frameAll();
 report.steps.push('Real dual-touch events pan and pinch around the target-plane centroid in both projections and six exact directions; the uploaded GPU matrices independently confirm heading, anchor and scale. Either release order prevents residual dragging or selection.');
 assert.equal(await mode(),'orbit');await setMode('pan');await frameAll();await checkPan('touch-free-heading');
 for(const direction of Object.keys(directions)){await setDirection(direction);await assertDirection(direction);await allCornersFit(direction);await checkPan(direction);await assertDirection(direction,direction+'-after-pan');assert.equal(await sourceValue(),sourceBefore);if(['top','bottom'].includes(direction))await screenshot('touch-'+direction+'-desktop.png');}
 await setDirection('front');const equalSizeFrame=(await draws())[0];
 const widths=[-20,0,15].map(z=>Math.abs(ndc(equalSizeFrame.projection,[2,0,z,1])[0]-ndc(equalSizeFrame.projection,[-2,0,z,1])[0]));assert.ok(widths.every(n=>Math.abs(n-widths[0])<1e-10));report.equalScaleAcrossDepth={depths:[-20,0,15],widths};
 await click('#scene3dObjects li:nth-child(2) button');await click('#scene3dFocus');assert.equal(await projection(),'orthographic');await assertIndicator('focus-selected');
 await frameAll();await allCornersFit('touch-focus-all');const beforeZoom=(await draws())[0].projection;const wheelCenter=await canvasCenter();await call('Input.dispatchMouseEvent',{type:'mouseWheel',...wheelCenter,deltaX:0,deltaY:40});await settleFrames();const afterZoom=(await draws())[0].projection;assert.equal(afterZoom[15],1);assert.ok(afterZoom[0]<beforeZoom[0]);await assertIndicator('wheel');await assertDirection('front','touch-wheel');await frameAll();
 report.steps.push('Actual orthographic GPU projection keeps equal-size segments identical at three depths. Selected/all focus and wheel zoom preserve orthographic mode and heading.');
 await setMode('pan');await canvasCenter();
 {const badge=await assertIndicator('pointer-through-badge'),r=badge.bounds,start={x:r.x+r.width/2,y:r.y+r.height/2};
  assert.equal(await evaluate(`document.elementFromPoint(${start.x},${start.y})?.id`),'scene3dCanvas');
  const before=await draws(),box=await rect();await call('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x-20,y:start.y+12,button:'left',buttons:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:start.x-20,y:start.y+12,button:'left',buttons:0,clickCount:1});await settleFrames();const after=await draws();for(let i=0;i<3;i++){const a=projected(before[i],box),b=projected(after[i],box);assert.ok(Math.abs(b.x-a.x+20)<.03&&Math.abs(b.y-a.y-12)<.03);}await assertIndicator('after-pointer-through-badge');}
 report.steps.push('Orientation axes and front/back depth signs are independently checked against actual uploaded GPU camera bases. Fixed X/Y/Z labels remain inside the SVG, localized accessibility stays passive, and a real drag begun through the badge reaches the canvas.');
 report.steps.push('Real pointer panning in free heading and all six directions preserves orientation/depth; independent reprojection checks actual uploaded GPU matrices against CSS drag at every depth for all three objects. Panning does not select or write source.');
 await setMode('orbit');await checkPan('shift-left',{dx:-24,dy:12,modifiers:8});await checkPan('middle',{dx:15,dy:-13,button:'middle'});
 // An ordinary orbit drag still rotates after temporary modifier-based panning.
 {const center=await canvasCenter(),before=await draws();await call('Input.dispatchMouseEvent',{type:'mousePressed',...center,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:center.x+32,y:center.y+17,button:'left',buttons:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:center.x+32,y:center.y+17,button:'left',buttons:0,clickCount:1});await settleFrames();assert.notDeepEqual((await draws())[0].projection,before[0].projection);await assertIndicator('free-orbit');}
 await setDirection('front');await setMode('pan');await checkPan('pre-picking');await canvasCenter();
 const hit=projected((await draws())[1],await rect()),point={x:hit.x,y:hit.y};const selectionBefore=await selected(),beforeTap=await draws();
 for(const clickCount of [1,2]){await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount});}
 await settleFrames();assert.equal(await selected(),selectionBefore);assert.deepEqual(await draws(),beforeTap);
 await click('#scene3dObjects li:nth-child(1) button');await canvasCenter();await setMode('orbit');await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});await settleFrames();assert.equal(await selected(),scene.objects[1].instanceId);
 report.steps.push('Shift-left and middle mouse pan temporarily while the dropdown stays orbit. Ordinary orbit dragging still rotates; pan double-taps never select/focus; switching to orbit selects the intended box at its new projected location.');
 await setMode('pan');await click('#scene3dReset');await assertIndicator('reset');assert.equal(await projection(),'orthographic');assert.deepEqual(await draws(),orthoFrames);await setProjection('perspective');assert.deepEqual(await draws(),initialDraws);await setProjection('orthographic');assert.equal(await mode(),'pan');assert.equal(await sourceValue(),sourceBefore);assert.equal(await readSource(),original);
 report.steps.push('Reset retains both projection and drag mode while restoring the authored camera; choosing perspective restores exact original GPU matrices.');
 // Legal authored cameras outside the default wheel interval retain a proportional touch range.
 for(const scale of ['far','near']){
  const extreme=structuredClone(scene);
  if(scale==='far'){extreme.camera={position:[-100000,0,-100000],target:[100000,0,100000],fovDegrees:50,near:.1,far:100000};extreme.objects.forEach((object,i)=>{object.position=[-80000+i*1000,0,-80000];object.size=[1000,1000,1000];});}
  else {extreme.camera={position:[0,0,.02],target:[0,0,0],fovDegrees:50,near:.001,far:100};extreme.objects.forEach((object,i)=>{object.position=[(i-1)*.001,0,-.01];object.size=[.001,.001,.001];});}
  await input(json(extreme));await refresh();assert.equal(await evaluate("document.querySelector('#scene3dDiagnostics').textContent"),'');
  for(const projectionMode of ['perspective','orthographic']){
   await setProjection(projectionMode);await checkTouch(scale+'-author-pan-'+projectionMode,{spread:1,dx:12,dy:8});
   await checkTouch(scale+'-author-pinch-'+projectionMode,{spread:1.1,dx:8,dy:6,endFirst:2});
  }
  assert.equal(await readSource(),original);
 }
 await input(sourceBefore);await refresh();await setProjection('orthographic');
 report.steps.push('Real native/WASM-valid distant and near-minimum authored cameras retain their distance during dual-touch pan and respond proportionally to pinching, in both projections. The author files remain unchanged.');
 await input('{"format":"viento-scene3d","schemaVersion":1}');await refresh();assert.match(await evaluate("document.querySelector('#scene3dStatus').textContent"),/保留上一次有效/);await setDirection('bottom');await assertDirection('bottom','invalid-draft-last-valid');await allCornersFit('invalid-draft-last-valid');await setProjection('perspective');await setProjection('orthographic');await checkPan('invalid-draft-last-valid');await frameAll();await checkTouch('invalid-draft-last-valid',{spread:1.2});assert.ok(await evaluate("document.querySelector('#scene3dDiagnostics').textContent.length>0"));assert.equal(await evaluate("document.querySelector('#scene3dLocate').disabled"),true);assert.equal(await readSource(),original);
 report.steps.push('An invalid edited source keeps native diagnostics and disables exact source location; panning continues on the last valid model without saving or clearing that diagnostic.');
 const edited=structuredClone(scene);edited.viewport=[400,800];edited.objects[0].position=[-30,1,4];const draft='\ufeff'+json(edited);await input(draft);await refresh();await frameAll();await allCornersFit('changed-unsaved-model');assert.equal(await readSource(),original);const unsaved=await sourceValue();await assertIndicator('refreshed-draft');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 for(const language of ['zh-CN','en','ja']){await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);await settleFrames();await setDirection(language==='en'?'bottom':'top');await assertDirection(language==='en'?'bottom':'top',language+'-390');await assertIndicator(language+'-390');await allCornersFit(language+'-390');await checkPan(language+'-390',{dx:12,dy:8});await checkTouch(language+'-390',{spread:1.15,dx:8,dy:6,endFirst:language==='en'?2:1});assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth||document.querySelector('#scene3dDialog').scrollWidth>document.querySelector('#scene3dDialog').clientWidth"),false);const labels=await evaluate("(async()=>{const {t}=await import('/web/i18n/index.js');return{actual:document.querySelector('#scene3dProjectionMode').selectedOptions[0].textContent,expected:t('正交')};})()");assert.equal(labels.actual,labels.expected);await evaluate("document.querySelector('#scene3dDragMode').scrollIntoView({block:'center',behavior:'instant'})");await settleFrames();assert.ok(await evaluate("(()=>{const r=document.querySelector('#scene3dDragMode').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()"));await evaluate("document.querySelector('#scene3dDialog').scrollTop=0");await settleFrames();await new Promise(resolve=>setTimeout(resolve,500));
 const probes=await evaluate(`(()=>{const c=document.querySelector('#scene3dCanvas'),g=c.getContext('webgl2'),r=c.getBoundingClientRect(),footer=document.querySelector('.scene3d-footer').getBoundingClientRect(),badge=document.querySelector('#scene3dOrientation').getBoundingClientRect(),bottom=Math.min(r.bottom-10,footer.top-10,innerHeight-10),samples=[];for(let y=Math.ceil(Math.max(r.top+10,10));y<bottom;y+=23)for(let x=Math.ceil(r.left+10);x<r.right-10;x+=23){if(x>=badge.left-2&&x<=badge.right+2&&y>=badge.top-2&&y<=badge.bottom+2)continue;const p=new Uint8Array(4),cx=Math.floor((x+0.5-r.left)*c.width/r.width),cy=c.height-1-Math.floor((y+0.5-r.top)*c.height/r.height);g.readPixels(cx,cy,1,1,g.RGBA,g.UNSIGNED_BYTE,p);samples.push({x,y,rgba:Array.from(p)});}return{rect:{x:r.x,y:r.y,width:r.width,height:r.height},width:c.width,height:c.height,error:g.getError(),samples};})()`);
 assert.ok(probes.samples.length>30);assert.equal(probes.error,0);(report.compositingProbes||=[]).push({file:'touch-'+language+'-390.png',...probes});const screenshotBase64=await screenshot('touch-'+language+'-390.png');
 const composited=await evaluate(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(screenshotBase64)}),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'})),surface=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=surface.getContext('2d');ctx.drawImage(bitmap,0,0);const samples=${JSON.stringify(probes.samples)},values=samples.map(({x,y})=>Array.from(ctx.getImageData(x,y,1,1).data));bitmap.close();return values;})()`);
 const mismatches=probes.samples.filter((sample,index)=>sample.rgba.some((value,channel)=>Math.abs(value-composited[index][channel])>3));
 (report.compositingChecks||=[]).push({file:'touch-'+language+'-390.png',samples:probes.samples.length,tolerance:3,mismatches:mismatches.length});assert.deepEqual(mismatches,[],'Screenshot must match the actual GPU pixels after scrolling');assert.equal(await sourceValue(),unsaved);}
 await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await checkPan('touch-pan-390',{dx:16,dy:12,touch:true});await call('Emulation.setTouchEmulationEnabled',{enabled:false});assert.equal(await sourceValue(),unsaved);
 report.steps.push('A new unsaved model uses its complete new bounds. Chinese, English and Japanese at 390px preserve drag-mode controls; real single-finger panning works, source text and scrollable controls; all 24 corners fit each actual resized GPU viewport.');
 await close();assert.equal(await evaluate("document.querySelector('#scene3dOrientation').hidden"),true);await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");await open();assert.equal(await mode(),'orbit');assert.equal(await projection(),'perspective');await frameAll();await allCornersFit('reopen-unsaved');await assertIndicator('reopened');assert.equal(await sourceValue(),unsaved);assert.equal(await readSource(),original);await close();
 report.steps.push('Closing disposes the view. Reopening reads the current unsaved draft and frames it; author files retain their original bytes throughout.');
 // Finish this disposable unsaved-draft test explicitly before a fresh-device navigation.
 await input(original);await wait(()=>state('!appState.editHasUnsavedChanges'),'fixture draft reset before navigation');assert.equal(await readSource(),original);
 const injection=await call('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const old=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl2'?null:old.call(this,kind,...args);};})()"});
 await call('Page.navigate',{url:`${base}/web/?mode=edit&no-webgl=1`});await wait(()=>state('appState.editBackendAvailable'),'fallback editor');await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>state('appState.isEditing'),'fallback edit');await enabled('#docEditSourceModeBtn');await click('#docEditSourceModeBtn');await open();assert.equal(await evaluate("document.querySelector('#scene3dSetDirection').disabled&&document.querySelector('#scene3dDirection').disabled&&document.querySelector('#scene3dDragMode').disabled&&document.querySelector('#scene3dProjectionMode').disabled"),true);assert.equal(await evaluate("document.querySelector('#scene3dFallback').hidden"),false);assert.equal(await evaluate("document.querySelector('#scene3dOrientation').hidden"),true);assert.equal(await evaluate("document.querySelectorAll('#scene3dObjects button').length"),3);assert.equal(await readSource(),original);await screenshot('touch-no-webgl.png');await close();await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier});
 report.steps.push('Injected WebGL unavailability disables only view controls, keeps verified declarations and does not change author files.');
 assert.deepEqual(report.errors,[]);assert.equal(system.initializedModules.length,17);assert.equal(system.plan.capabilities.length,33);report.modules=[...new Set(report.modules)].sort();report.sourcesFinal=Object.fromEntries(await Promise.all(sources.map(async name=>[name,hash(await fs.readFile(path.join(appRoot,name)))])));report.sourceStableDuringProof=JSON.stringify(report.sourcesFinal)===JSON.stringify(report.sources);assert.equal(report.sourceStableDuringProof,true);report.ok=true;report.status='passed';
} catch(error){await captureFailure?.().catch(()=>{});report.status='failed';report.failure=String(error.stack||error);process.exitCode=1;}
finally{socket?.close();for(const cleanup of cleanups.reverse())await cleanup();report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),json(report));console.log(json(report));}
