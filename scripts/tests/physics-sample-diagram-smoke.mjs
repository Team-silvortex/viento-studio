// Real Chrome → HTTP workbench → frozen Godot build → native physics observation.
// Writes disposable author workspaces and a fresh evidence directory only.
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
import { scenePhysics2DCharacterMotionAuthor } from './helpers/scene-physics2d-character-motion-author-fixture.mjs';
import { validateProjectPhysics2DObservation } from '../../engine/project-physics2d-trace.mjs';
import '../adapters/node-studio-core.mjs';
const appRoot=fileURLToPath(new URL('../../',import.meta.url)),tool=process.env.VIENTO_GODOT_BIN;
if(!tool||!path.isAbsolute(tool))throw Error('Set VIENTO_GODOT_BIN to an absolute executable.');
const evidenceRoot=path.join(appRoot,'docs/test-results/physics-sample-diagram');
const output=path.resolve(process.env.VIENTO_PHYSICS_SAMPLE_DIAGRAM_OUTPUT||path.join(evidenceRoot,`browser-${Date.now()}`));
if(!output.startsWith(evidenceRoot+path.sep))throw Error('Use a fresh directory inside the physics-sample-diagram evidence topic.');
await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('Use a new empty evidence directory.');
const report={startedAt:new Date().toISOString(),steps:[],screenshots:[],jobs:[],errors:[],dialogs:[],layout:{},limitations:[
  'Real isolated Chrome/HTTP editor and native headless Godot; installed Tauri, Android and Bevy were not tested.',
  'Only finite character sweeps are observed; source edits remain an unsaved disposable draft.'
]};
const sources=['engine/project-physics2d-trace.mjs','engine/project-physics2d-replay-case.mjs','engine/project-physics2d-observation-selection.mjs','engine/project-physics2d-sample-diagram.mjs','engine/project-physics2d-input-replay.mjs','engine/project-physics2d-replay-contract.mjs',
  'web/modules/app-project-build.js','web/modules/app-project-physics-observation.js','web/modules/app-project-physics-diagram.js','web/project-build.css','web/project-physics-observation.css','web/i18n/en.js','web/i18n/ja.js',
  'scripts/tests/helpers/scene-physics2d-character-motion-author-fixture.mjs','scripts/tests/physics-sample-diagram-smoke.mjs'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,buildHash(await fs.readFile(path.join(appRoot,name)))])));
report.node={version:process.version,sha256:buildHash(await fs.readFile(process.execPath))};report.tool={sha256:buildHash(await fs.readFile(tool))};
const cleanups=[],fixture={after:callback=>cleanups.push(callback)};
const wait=async(check,label,budget=45000)=>{for(const deadline=Date.now()+budget;Date.now()<deadline;){if(await check())return;await delay(100);}throw Error('Timed out: '+label);};
async function authorTree(root){const hashes={};for(const entry of await fs.readdir(root,{recursive:true,withFileTypes:true})){if(!entry.isFile())continue;const file=path.join(entry.parentPath||entry.path,entry.name),name=path.relative(root,file);if(name==='workspace.json'||/^(documents|metadata|templates|assets)\//.test(name))hashes[name]=buildHash(await fs.readFile(file));}return hashes;}
let socket,captureFailure;
try{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'viento-physics-diagram-browser-'));cleanups.push(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
  const f=await scenePhysics2DCharacterMotionAuthor(fixture,{obstacle:'wall'});
  await f.edit('documents/scenes/demo.json',scene=>{scene.actors[2].position=[300,700];scene.actors.at(-1).position=[140,180];scene.actors.at(-1).size=[10,300];});
  await f.edit(f.physicsPath,document=>{document.schemaVersion=2;delete document.bodies[0].characterMotion;document.bodies[0].collisionResponse='slide';document.bodies.at(-1).shape.size=[10,300];});
  await f.edit('documents/projects/demo.json',value=>{value.sceneIds=[f.sceneIds[0]];});
  await f.edit(`metadata/documents/${f.assemblyId}.json`,value=>{value.relations=value.relations.filter(row=>row.targetId===f.sceneIds[0]);});
  await f.edit(`metadata/documents/${f.sceneIds[0]}.json`,value=>{value.relations=value.relations.filter(row=>!['behavior','audio','animation'].includes(row.kind));});
  const env={...process.env,VIENTO_APP_ROOT:appRoot,VIENTO_WORKSPACE_ROOT:f.author,VIENTO_GODOT_BIN:tool,VIENTO_EXECUTION_BACKEND:'org.viento.godot4',XDG_CACHE_HOME:path.join(temporary,'cache'),XDG_CONFIG_HOME:path.join(temporary,'config')};delete env.VIENTO_SESSION_TOKEN;delete env.VIENTO_PREFERENCES_PATH;
  const rebuilt=await runCommand(process.execPath,[path.join(appRoot,'scripts/ops/rebuild.mjs')],{cwd:appRoot,env});assert.equal(rebuilt.code,0,JSON.stringify(rebuilt));
  const initial=await authorTree(f.author),base=await serve(fixture,appRoot,env);report.fixture={assemblyId:f.assemblyId,physicsPath:f.physicsPath,instanceId:f.instanceId};
  const state=async()=>{const response=await fetch(`${base}/api/project-build`).then(value=>value.json());return response.data||response;};
  const profile=path.join(temporary,'chrome');await fs.mkdir(profile);
  const chrome=spawn(process.argv[2]||'/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--remote-debugging-port=0','--window-size=1440,1100','about:blank'],{stdio:'ignore'});
  cleanups.push(async()=>{if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}});
  let port;await wait(async()=>{try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];return Boolean(port);}catch{return false;}},'Chrome startup');
  const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(value=>value.json());socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);await once(socket,'open');
  const pending=new Map();let sequence=0;
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  socket.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id){const request=pending.get(value.id);pending.delete(value.id);value.error?request?.reject(Error(value.error.message)):request?.resolve(value.result);}else if(value.method==='Runtime.exceptionThrown')report.errors.push(value.params.exceptionDetails);else if(value.method==='Page.javascriptDialogOpening'){report.dialogs.push(value.params.message);void call('Page.handleJavaScriptDialog',{accept:false});}});
  const evaluate=async expression=>{const value=await call('Runtime.evaluate',{expression:`(async()=>(${expression}))()`,awaitPromise:true,returnByValue:true,userGesture:true});if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));return value.result.value;};
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`),fill=(selector,value,event='change')=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  const enabled=selector=>wait(()=>evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled===false`),selector+' enabled');
  const screenshot=async name=>{const image=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,name),Buffer.from(image.data,'base64'));report.screenshots.push(name);};
  const panelVisible=()=>wait(()=>evaluate(`document.querySelector('#projectPhysicsObservationPanel')?.hidden===false`),'physics observation panel');
  captureFailure=async()=>{await screenshot('failure.png');report.pageFailure=await evaluate(`({text:document.body.innerText,requests:window.__physicsNavigationRequests||[]})`);};
  const perform=async(selector,kind)=>{const previous=(await state()).job?.id;await enabled(selector);await click(selector);let job;await wait(async()=>{job=(await state()).job;return job?.kind===kind&&job.id!==previous&&job.status!=='running';},kind+' completion',90000);report.jobs.push({kind:job.kind,id:job.id,status:job.status,buildId:job.buildId,snapshotId:job.snapshotId});assert.equal(job.status,'succeeded',JSON.stringify(job));return job;};
  await call('Runtime.enable');await call('Page.enable');report.browser=(await call('Browser.getVersion')).product;await call('Page.navigate',{url:`${base}/web/?mode=edit`});
  await wait(()=>evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable&&document.querySelector('#projectBuildBtn')?.hidden===false`),'editor startup');
  await click('#projectBuildBtn');await enabled('#projectBuildScene');await fill('#projectBuildScene',f.assemblyId);
  await perform('#projectBuildPlan','plan');await perform('#projectBuildGenerate','build');
  const program={format:'viento-physics2d-input-replay',schemaVersion:1,fixedDelta:1/60,
    steps:Array.from({length:30},(_,index)=>({left:false,right:index<15,up:false,down:index<15,jump:false}))};
  await fill('#projectBuildPhysicsReplayProgram',JSON.stringify(program,null,2),'input');
  const replay=await perform('#projectBuildPhysicsReplay','run');
  const replayObserved=validateProjectPhysics2DObservation(replay.physics);
  assert.equal(replayObserved.phase,'finished');assert.equal(replayObserved.limited,false);
  const collision=replayObserved.samples.find(row=>row.instanceId===f.instanceId&&row.contacts.some(contact=>contact.collider));assert.ok(collision,'Native replay must include a mapped collision');
  const other=replayObserved.samples.find(row=>row.instanceId===f.instanceId&&row.stepIndex!==collision.stepIndex&&row.requestedMotion.every(value=>value===0)&&row.contacts.length===0);assert.ok(other);
  const definition={format:'viento-physics2d-replay-case',schemaVersion:1,program,checks:[
    {instanceId:f.instanceId,stepIndex:collision.stepIndex,positionAfter:{value:collision.positionAfter,tolerance:[0.01,0.01]},contact:{exists:true,bodyId:collision.contacts.find(contact=>contact.collider).collider.bodyId}},
    {instanceId:f.instanceId,stepIndex:other.stepIndex,positionAfter:{value:[9999,9999],tolerance:[0,0]},contact:{exists:other.contacts.length>0}}
  ]};
  await fill('#projectBuildPhysicsCaseProgram',JSON.stringify(definition,null,2),'input');
  const ran=await perform('#projectBuildPhysicsCaseRun','run');assert.equal(ran.physicsVerification.evaluation.status,'failed');
  assert.deepEqual(ran.physicsVerification.evaluation.checks.map(check=>check.passed),[true,false]);
  const observed=validateProjectPhysics2DObservation(ran.physics);assert.equal(observed.phase,'finished');assert.equal(observed.limited,false);
  const samples=definition.checks.map(check=>observed.samples.find(row=>row.instanceId===check.instanceId&&row.stepIndex===check.stepIndex));assert.ok(samples.every(Boolean));
  await panelVisible();await wait(()=>evaluate(`document.querySelectorAll('.build-physics-case-sample').length===2`),'two case sample actions');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#projectBuildPhysicsCaseChecks > li'),item=>({instanceId:item.dataset.instanceId,stepIndex:Number(item.dataset.stepIndex),passed:item.dataset.passed}))`),definition.checks.map((check,i)=>({instanceId:check.instanceId,stepIndex:check.stepIndex,passed:String(i===0)})));
  // Navigation must not issue HTTP mutations; monitor fetch calls across the selected action.
  await evaluate(`(()=>{window.__physicsNavigationRequests=[];const original=window.fetch.bind(window);window.fetch=(input,init={})=>{const url=new URL(typeof input==='string'?input:input.url,location.href);let action='';try{action=JSON.parse(init.body||'{}').action||''}catch{}const row={path:url.pathname,method:(init.method||input.method||'GET').toUpperCase(),action,phase:window.__physicsClickPhase||'',stack:new Error().stack,settled:false};window.__physicsNavigationRequests.push(row);return original(input,init).finally(()=>{row.settled=true});};})()`);
  const select=async(index,sample)=>{
    const before=await evaluate(`window.__physicsNavigationRequests.filter(request=>request.method!=='GET').length`);
    const activePath=await evaluate(`(await import('/web/modules/app-state.js')).appState.activePath`);
    await click(`#projectBuildPhysicsCaseChecks li:nth-child(${index+1}) .build-physics-case-sample`);
    await wait(()=>evaluate(`document.querySelector('#projectPhysicsObservationDetail').dataset.sequence===${JSON.stringify(String(sample.sequence))}`),'selected sample');
    assert.equal(await evaluate(`window.__physicsNavigationRequests.filter(request=>request.method!=='GET').length`),before,'Selecting must not issue mutating HTTP requests');
    assert.equal(await evaluate(`document.activeElement===document.querySelector('#projectPhysicsObservationSample')`),true,'Selection focuses the sample selector');
    assert.equal(await evaluate(`document.querySelector('#projectBuildDialog').open`),true,'Selection does not open the source');
    assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.activePath`),activePath);
    assert.equal(await evaluate(`(()=>{const r=document.querySelector('#projectPhysicsObservationSample').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})()`),true,'Selected sample selector remains visible');
    assert.deepEqual(await evaluate(`({instance:document.querySelector('#projectPhysicsObservationInstance').value,step:document.querySelector('#projectPhysicsObservationStep').value,sample:document.querySelector('#projectPhysicsObservationSample').value})`),
      {instance:sample.instanceId,step:`${sample.visitIndex}:${sample.sceneId}:${sample.stepIndex}`,sample:String(sample.sequence)});
    const identity=await evaluate(`document.querySelector('#projectPhysicsObservationIdentity').textContent`);for(const value of [sample.sceneId,sample.instanceId,sample.bodyId])assert.ok(identity.includes(value),value);
    const motion=await evaluate(`Array.from(document.querySelectorAll('#projectPhysicsObservationMotion dd'),element=>element.title)`);
    assert.equal(motion[6],`[${sample.positionAfter.join(', ')}]`);
    const contacts=await evaluate(`Array.from(document.querySelectorAll('#projectPhysicsObservationContacts > li'),item=>({text:item.textContent,values:Array.from(item.querySelectorAll('dd'),entry=>entry.title)}))`);
    assert.equal(contacts.length,sample.contacts.length);
    sample.contacts.forEach((contact,i)=>{if(contact.collider)assert.ok(contacts[i].text.includes(contact.collider.bodyId));assert.deepEqual(contacts[i].values,[contact.position,contact.normal,contact.travel,contact.remainder].map(value=>`[${value.join(', ')}]`));});
    report.steps.push(`Native case check ${index+1} selected sequence ${sample.sequence}, visit ${sample.visitIndex}, step ${sample.stepIndex}, exact position and mapped contacts without mutating HTTP requests.`);
  };
  const near=(actual,expected,label)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=1e-8*Math.max(1,Math.abs(expected)),`${label}: ${actual} != ${expected}`);
  const diagram=async(sample)=>{
    const raw=[...sample.requestedMotion,...sample.displacement,...sample.contacts.flatMap(c=>c.position.map((value,axis)=>value-sample.positionBefore[axis]))];
    const max=Math.max(0,...raw.map(Math.abs));let exponent=max?Math.ceil(Math.log2(max)):0;if(max/2**exponent>1)exponent++;
    const projected=value=>160+112*value/2**exponent;
    const actual=await evaluate(`(()=>{const svg=document.querySelector('#projectPhysicsObservationDiagram svg');if(!svg)return null;const get=(role,index)=>{const e=svg.querySelector('[data-role="'+role+'"]'+(index?'[data-contact-index="'+index+'"]':''));if(!e)return null;return {x1:e.getAttribute('x1'),y1:e.getAttribute('y1'),x2:e.getAttribute('x2'),y2:e.getAttribute('y2'),x:e.getAttribute('x'),y:e.getAttribute('y'),cx:e.getAttribute('cx'),cy:e.getAttribute('cy'),width:e.getAttribute('width'),height:e.getAttribute('height'),zero:e.getAttribute('data-zero'),marker:e.getAttribute('marker-end'),points:e.getAttribute('points'),title:e.querySelector('title')?.textContent};};const r=svg.getBoundingClientRect();return {assemblyId:svg.dataset.assemblyId,sequence:svg.dataset.sequence,sceneId:svg.dataset.sceneId,instanceId:svg.dataset.instanceId,bodyId:svg.dataset.bodyId,viewBox:svg.getAttribute('viewBox'),aspect:svg.getAttribute('preserveAspectRatio'),role:svg.getAttribute('role'),before:{x:svg.querySelector('[data-role="before"]')?.dataset.x,y:svg.querySelector('[data-role="before"]')?.dataset.y},request:get('requested'),requestEnd:get('requested-end'),motion:get('actual'),motionEnd:get('actual-end'),contacts:Array.from(svg.querySelectorAll('[data-role="contact"]'),e=>Number(e.dataset.contactIndex)).map(i=>({point:get('contact',i),normal:get('normal',i),head:get('normal-head',i)})),rect:{width:r.width,height:r.height}}})()`);
    assert.ok(actual,'A validated selected native sample renders a diagram');assert.deepEqual([actual.assemblyId,actual.sequence,actual.sceneId,actual.instanceId,actual.bodyId],[observed.assemblyId,String(sample.sequence),sample.sceneId,sample.instanceId,sample.bodyId]);
    assert.equal(actual.viewBox,'0 0 320 320');assert.equal(actual.aspect,'xMidYMid meet');assert.equal(actual.role,'img');near(actual.rect.width,actual.rect.height,'square rendered viewBox');near(Number(actual.before.x),160,'before x');near(Number(actual.before.y),160,'before y');
    const line=(element,vector,label)=>{assert.ok(element);near(Number(element.x1),160,label+' start x');near(Number(element.y1),160,label+' start y');near(Number(element.x2),projected(vector[0]),label+' x');near(Number(element.y2),projected(vector[1]),label+' y');assert.equal(element.zero,String(vector.every(v=>v===0)));assert.equal(element.marker,null,'Motion line must not have a fixed arrowhead');};
    line(actual.request,sample.requestedMotion,'request');line(actual.motion,sample.displacement,'actual');
    near(Number(actual.requestEnd.x)+Number(actual.requestEnd.width)/2,projected(sample.requestedMotion[0]),'request square x');near(Number(actual.requestEnd.y)+Number(actual.requestEnd.height)/2,projected(sample.requestedMotion[1]),'request square y');
    near(Number(actual.motionEnd.cx),projected(sample.displacement[0]),'actual circle x');near(Number(actual.motionEnd.cy),projected(sample.displacement[1]),'actual circle y');
    const format=v=>`[${v.join(', ')}]`;for(const text of [format(sample.positionBefore),format(sample.requestedMotion)])assert.ok(actual.request.title.includes(text),text);for(const text of [format(sample.positionBefore),format(sample.positionAfter),format(sample.displacement)])assert.ok(actual.motion.title.includes(text),text);
    assert.equal(actual.contacts.length,sample.contacts.length);
    sample.contacts.forEach((contact,index)=>{const found=actual.contacts[index],dx=contact.position[0]-sample.positionBefore[0],dy=contact.position[1]-sample.positionBefore[1],x=projected(dx),y=projected(dy),length=Math.hypot(...contact.normal),nx=contact.normal[0]/length,ny=contact.normal[1]/length;
      near(Number(found.point.cx),x,'contact x');near(Number(found.point.cy),y,'contact y');near(Number(found.normal.x1),x,'normal start x');near(Number(found.normal.y1),y,'normal start y');near(Number(found.normal.x2),x+20*nx,'normal end x');near(Number(found.normal.y2),y+20*ny,'normal end y');
      near(Math.hypot(Number(found.normal.x2)-x,Number(found.normal.y2)-y),20,'normal display length');const head=found.head.points.trim().split(/\s+/).map(pair=>pair.split(',').map(Number));assert.equal(head.length,3);near(head[1][0],x+20*nx,'arrow tip x');near(head[1][1],y+20*ny,'arrow tip y');for(const arm of [head[0],head[2]])assert.ok((arm[0]-head[1][0])*nx+(arm[1]-head[1][1])*ny<0,'Arrow arms lie behind the direction tip');
      for(const text of [format(contact.position),format(contact.normal),format(contact.travel),format(contact.remainder)])assert.ok(found.point.title.includes(text),text);
    });
    return {sequence:sample.sequence,scaleExponent:exponent,requested:sample.requestedMotion,displacement:sample.displacement,contacts:sample.contacts.length,viewBox:actual.viewBox};
  };
  report.nativeSamples={collision:samples[0],zero:samples[1]};await select(0,samples[0]);assert.ok(samples[0].contacts.length);report.collision=await diagram(samples[0]);
  await evaluate(`document.querySelector('#projectPhysicsObservationDiagram svg').scrollIntoView({block:'center'})`);await screenshot('diagram-desktop.png');
  await evaluate(`(()=>{window.__diagramSvg=document.querySelector('#projectPhysicsObservationDiagram svg');window.__diagramLine=window.__diagramSvg.querySelector('[data-role="requested"]');window.__diagramPicker=document.querySelector('#projectPhysicsObservationSample');window.__diagramPicker.focus()})()`);
  // Refresh is the same poll path used by the workbench; it must preserve the
  // selected element, graphical nodes and keyboard focus for identical data.
  const pollStart=await evaluate(`window.__physicsNavigationRequests.length`);await click('#projectBuildRefresh');await wait(()=>evaluate(`window.__physicsNavigationRequests.slice(${pollStart}).some(item=>item.path==='/api/project-build'&&item.method==='GET'&&item.settled)`),'completed project status refresh');await delay(100);
  assert.equal(await evaluate(`document.querySelector('#projectPhysicsObservationDiagram svg')===window.__diagramSvg&&window.__diagramSvg.querySelector('[data-role="requested"]')===window.__diagramLine&&document.activeElement===window.__diagramPicker`),true,'Refresh retains graphic nodes and focus');await diagram(samples[0]);
  for(const language of ['zh-CN','en','ja']){
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate(`document.querySelector('#projectPhysicsObservationDiagram svg')===window.__diagramSvg&&window.__diagramSvg.querySelector('[data-role="requested"]')===window.__diagramLine&&document.activeElement===window.__diagramPicker`),true,'Language change retains graphic nodes and focus');
    await evaluate(`document.querySelector('#projectPhysicsObservationDiagram svg').scrollIntoView({block:'center'})`);const layout=await evaluate(`(()=>{const d=document.querySelector('#projectBuildDialog'),s=document.querySelector('#projectPhysicsObservationDiagram svg'),r=s.getBoundingClientRect();return{title:s.getAttribute('aria-label'),visible:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,noOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,width:r.width,height:r.height};})()`);
    assert.ok(layout.title.startsWith({'zh-CN':'位移与碰撞示意',en:'Displacement and collision diagram',ja:'変位と衝突の概略図'}[language]),layout.title);assert.equal(layout.visible,true,JSON.stringify(layout));assert.equal(layout.noOverflow,true,JSON.stringify(layout));near(layout.width,layout.height,'narrow square viewBox');report.layout[language]=layout;await diagram(samples[0]);await screenshot(`diagram-${language}-390.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await evaluate(`window.__oldContact=document.querySelector('#projectPhysicsObservationDiagram [data-role="contact"]')`);await select(1,samples[1]);assert.ok(samples[1].requestedMotion.every(value=>value===0)&&samples[1].displacement.every(value=>value===0)&&samples[1].contacts.length===0);
  assert.equal(await evaluate(`!window.__diagramSvg.isConnected&&!window.__oldContact.isConnected`),true,'Changing sample removes old graphical elements');report.zero=await diagram(samples[1]);await evaluate(`document.querySelector('#projectPhysicsObservationDiagram svg').scrollIntoView({block:'center'})`);await screenshot('diagram-zero.png');
  assert.equal(await evaluate(`document.querySelectorAll('#projectPhysicsObservationDiagram [data-role="normal-head"]').length`),0,'Zero motion without contacts has no arrows');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await evaluate(`document.querySelector('#projectPhysicsObservationDiagram svg').scrollIntoView({block:'center'})`);await screenshot('diagram-zero-390.png');await diagram(samples[1]);await call('Emulation.clearDeviceMetricsOverride');
  report.steps.push('A real collision sample and a naturally stationary native sample use exact independently computed uniform SVG geometry, full-precision titles and correctly directed fixed-size normal arrows; stationary motion has no arrowheads.');
  await select(0,samples[0]);await diagram(samples[0]);await click('#projectPhysicsObservationOpen');await wait(()=>evaluate(`!document.querySelector('#projectBuildDialog').open&&(await import('/web/modules/app-state.js')).appState.activePath.endsWith(${JSON.stringify(f.physicsPath)})`),'physics source navigation');
  const selection=await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return {start:e.selectionStart,end:e.selectionEnd,text:e.value.slice(e.selectionStart,e.selectionEnd)};})()`);assert.ok(selection.text.includes(samples[0].bodyId));report.sourceSelection=selection;
  await click('#projectBuildBtn');await panelVisible();await wait(()=>evaluate(`document.querySelectorAll('.build-physics-case-sample').length===2`),'case after source navigation');await select(0,samples[0]);
  await evaluate(`window.__closedDiagram=document.querySelector('#projectPhysicsObservationDiagram svg')`);await click('#projectBuildClose');await wait(()=>evaluate(`!window.__closedDiagram.isConnected&&!document.querySelector('#projectPhysicsObservationDiagram svg')`),'closed diagram cleared');
  await click('#projectBuildBtn');await panelVisible();await wait(()=>evaluate(`document.querySelectorAll('.build-physics-case-sample').length===2`),'case after reopen');await select(0,samples[0]);await diagram(samples[0]);
  await evaluate(`window.__oldJobDiagram=document.querySelector('#projectPhysicsObservationDiagram svg')`);
  const reversed={...program,steps:program.steps.map((step,index)=>({...step,right:false,down:false,left:index<15}))};await fill('#projectBuildPhysicsReplayProgram',JSON.stringify(reversed,null,2),'input');
  const next=await perform('#projectBuildPhysicsReplay','run');assert.notEqual(next.id,ran.id);const fresh=validateProjectPhysics2DObservation(next.physics);assert.equal(await evaluate(`!window.__oldJobDiagram.isConnected`),true,'New job must remove old SVG');
  await panelVisible();await wait(()=>evaluate(`Boolean(document.querySelector('#projectPhysicsObservationDiagram svg'))`),'new job diagram');const nextSequence=Number(await evaluate(`document.querySelector('#projectPhysicsObservationDiagram svg').dataset.sequence`));const nextSample=fresh.samples.find(sample=>sample.sequence===nextSequence);assert.ok(nextSample);report.newJob=await diagram(nextSample);
  assert.notDeepEqual(nextSample.requestedMotion,samples[0].requestedMotion);assert.equal((await state()).job.id,next.id);assert.deepEqual(await authorTree(f.author),initial);report.authorSnapshot={before:initial,after:await authorTree(f.author)};
  report.steps.push('Source navigation opens the exact existing body range only after an explicit action. Closing removes the SVG; reopening and a different real job rebuild it from their own selected sample. Author files remain byte-identical.');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.dialogs,[]);for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,'Source changed during smoke: '+file);report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=String(error.stack).replaceAll(appRoot,'<repository>').replaceAll(os.homedir(),'<home>').replaceAll(os.tmpdir(),'<tmp>');console.error(report.failure);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2).replaceAll(appRoot,'<repository>').replaceAll(os.homedir(),'<home>').replaceAll(os.tmpdir(),'<tmp>')+'\n');console.log(JSON.stringify({ok:report.ok,output:'<evidence>/'+path.basename(output),steps:report.steps,failure:report.failure},null,2));}
