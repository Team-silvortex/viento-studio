// Actual Chrome collider shape resizing → checked fields → ordinary Save → real Godot collision/events/animation.
// Only disposable author workspaces and a new evidence directory are written.
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
import { scenePhysics2DAuthor } from './helpers/scene-physics2d-author-fixture.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
import '../adapters/node-studio-core.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-physics2d-space-resize');
const output = path.resolve(process.env.VIENTO_PHYSICS2D_SPACE_RESIZE_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/scene-physics2d-space-resize.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome HTTP editor and Godot headless execution; no installed Tauri, Android, visual rendering or Bevy physics claim.',
  'Saved logical geometry with local collider-size proposals only. No scene position writes, source writes before ordinary Save, images, solver, native installed-app claim or protocol upgrade.'
] };
const sources = ['engine/scene-physics2d-space-resize.mjs','engine/scene-physics2d-space-edit.mjs','engine/scene-physics2d-space.mjs','scripts/lib/scene-physics2d-space-service.mjs','scripts/lib/doc-api-service.mjs','scripts/lib/doc-server-routes.mjs','scripts/adapters/node-world-projection.mjs','web/modules/app-doc-service.js','web/modules/app-services.js','engine/studio-core.wasm','engine/scene-physics2d-edit.mjs','engine/scene-physics2d.mjs','engine/scene-physics2d-core.mjs',
  'web/modules/app-scene-physics2d.js','web/modules/app-scene-physics2d-space.js','web/modules/app-scene-physics2d-source.js','web/scene-physics2d.css',
  'engine/scene-physics2d-targets.mjs','scripts/lib/scene-physics2d-targets-service.mjs',
  'web/modules/app-runtime.js','web/modules/app-studio-system.js','engine/studio-modules.mjs','web/i18n/en.js','web/i18n/ja.js',
  'scripts/backends/godot4-physics.mjs','scripts/backends/godot4/physics-runtime.gd','scripts/backends/godot4/project-physics-runtime.gd',
  'scripts/tests/helpers/scene-physics2d-author-fixture.mjs','scripts/tests/scene-physics2d-space-resize-smoke.mjs'];
report.sources = Object.fromEntries(await Promise.all(sources.map(async name => [name, buildHash(await fs.readFile(path.join(appRoot, name)))])));
report.node = { version: process.version, sha256: buildHash(await fs.readFile(process.execPath)) };
report.tool = { sha256: buildHash(await fs.readFile(tool)) };
const cleanups = [], fixture = { after: callback => cleanups.push(callback) };
const wait = async (check, label, budget = 45000) => { for (const deadline = Date.now() + budget; Date.now() < deadline;) { if (await check()) return; await delay(100); } throw Error('Timed out: ' + label); };
async function authorTree(root) {
  const hashes = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name), name = path.relative(root, file);
    if (name === 'workspace.json' || /^(documents|design-data|templates|data-template|metadata|assets)\//.test(name)) hashes[name] = buildHash(await fs.readFile(file));
  }
  return hashes;
}
let socket, captureFailure;
try {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-physics2d-space-resize-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const authorFixture = await scenePhysics2DAuthor(fixture);
  const authorFile = path.join(authorFixture.author, authorFixture.physicsPath);
  authorFixture.physics.bodies[0].offset[0] = 2;
  let authored = JSON.stringify(authorFixture.physics, null, 2) + '\n';
  const offsetRange = locateJsonSource(parseJsonSource(authored), '/bodies/0/offset/0');
  authored = authored.slice(0, offsetRange.start) + '2e0' + authored.slice(offsetRange.end);
  const original = '\ufeff' + authored.replace('"bodies"', '"bodi\\u0065s"')
    .replace('"layer": 1', '"layer": 1e0').replace(/\n/g, '\r\n');
  await fs.writeFile(authorFile, original);
  const root = authorFixture.author, download = path.join(temporary, 'downloads'); await fs.mkdir(download);
  const sceneId = authorFixture.sceneIds[0], assemblyId = authorFixture.assemblyId;
  report.fixture = { sceneId, assemblyId, physicsPath: authorFixture.physicsPath,
    instanceId: authorFixture.instanceId, sensorBindingId: authorFixture.sensorBindingId, sensorInstanceId: authorFixture.sensorInstanceId };
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root, VIENTO_GODOT_BIN: tool,
    VIENTO_EXECUTION_BACKEND: 'org.viento.godot4', XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  const rebuilt = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env }); assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
  const initial = await authorTree(root), base = await serve(fixture, appRoot, env);
  const state = async () => { const response = await fetch(`${base}/api/project-build`).then(value => value.json()); return response.data || response; };
  const profile = path.join(temporary, 'chrome'); await fs.mkdir(profile);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; } });
  let port;
  await wait(async () => { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return Boolean(port); } catch { return false; } }, 'Chrome startup');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(value => value.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const pending = new Map(); let sequence = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.id) { const request = pending.get(value.id); pending.delete(value.id); value.error ? request?.reject(Error(value.error.message)) : request?.resolve(value.result); }
    else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
    else if (value.method === 'Page.javascriptDialogOpening') { report.dialogs.push({ type: value.params.type, message: value.params.message }); void call('Page.handleJavaScriptDialog', { accept: true }); }
  });
  const evaluate = async expression => {
    const value = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true, userGesture: true });
    if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value;
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value, event = 'input') => evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event(${JSON.stringify(event)}, {bubbles:true})); })()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === false && !document.querySelector(${JSON.stringify(selector)}).hidden`), selector + ' enabled');
  const screenshot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(image.data, 'base64')); report.screenshots.push(name); };
  const value = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
  const visible = content => content.replace(/\r\n?/g, '\n');
  captureFailure = async () => { await screenshot('failure.png'); report.resizeFailure = await evaluate(`(()=>{const p=window.__resizeAim?.start;return{aim:window.__resizeAim,trace:window.__resizeTrace,active:document.activeElement?.outerHTML.slice(0,400),hit:p?document.elementsFromPoint(p.x,p.y).map(e=>e.outerHTML.slice(0,300)):[],handles:[...document.querySelectorAll('[data-space-resize-handle] circle')].map(e=>{const s=getComputedStyle(e),b=e.getBoundingClientRect();return{html:e.outerHTML,stroke:s.stroke,strokeWidth:s.strokeWidth,pointerEvents:s.pointerEvents,rect:[b.x,b.y,b.width,b.height],ctm:[e.getScreenCTM().a,e.getScreenCTM().d]}})}})()`); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,system:(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()})`); report.serviceFailure = await state(); report.editorFailure = await evaluate(`(()=>import('/web/modules/app-state.js').then(({appState:s})=>({isSaving:s.isSaving,isRebuilding:s.isRebuilding,isMutatingWorld:s.isMutatingWorld,dirty:s.editHasUnsavedChanges,creating:s.isCreating,planDisabled:document.querySelector('#projectBuildPlan')?.disabled,behaviorDisabled:document.querySelector('#sceneBehaviorsBtn')?.disabled})))()`); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: download, eventsEnabled: true });
  await call('Page.addScriptToEvaluateOnNewDocument', {source: `(()=>{window.__assetReads=0;window.__spaceCalls=0;window.__spaceMode='normal';window.__spaceHeld=[];const original=window.fetch;window.fetch=async(input,init)=>{const url=String(input);if(url.startsWith('/asset-files/'))window.__assetReads++;if(!url.includes('/api/scene-physics2d-space'))return original(input,init);window.__spaceCalls++;const mode=window.__spaceMode;const reply=await original(input,init);if(mode==='hold')await new Promise(resolve=>window.__spaceHeld.push(resolve));if(mode==='fail')return new Response(JSON.stringify({error:'Injected geometry failure',errorCode:'scene_physics2d_space_unavailable'}),{status:503,headers:{'Content-Type':'application/json'}});return reply;};})()`});
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor startup');

  await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.endsWith(${JSON.stringify(authorFixture.physicsPath)}))`), 'physics source in sidebar');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.endsWith(${JSON.stringify(authorFixture.physicsPath)})).click()`);
  await enabled('#docEditBtn'); await click('#docEditBtn');
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`), 'ordinary physics edit');
  await enabled('#docEditSourceModeBtn'); await click('#docEditSourceModeBtn');
  assert.equal(await value('#docSourceEditor'), visible(original));
  const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  const settled = () => wait(() => evaluate(`document.querySelector('#scenePhysics2DDialog').getAttribute('aria-busy')==='false'`), 'physics panel settled');
  const open = async () => { await enabled('#scenePhysics2DBtn'); await click('#scenePhysics2DBtn'); await enabled('#scenePhysics2DInstance'); };
  const review = async () => { await enabled('#scenePhysics2DCheck'); await click('#scenePhysics2DCheck'); await enabled('#scenePhysics2DApply'); return text('#scenePhysics2DAfter'); };
  const check = async () => { await enabled('#scenePhysics2DCheck'); await click('#scenePhysics2DCheck'); await settled(); await spaceReady(); };
  const unchanged = async () => { assert.deepEqual(await authorTree(root), initial); assert.equal(await value('#docSourceEditor'), visible(original)); };
  const directoryReady = () => enabled('#scenePhysics2DTarget');
  const spaceReady = () => wait(() => evaluate(`!document.querySelector('#scenePhysics2DSpaceView').hidden&&document.querySelectorAll('[data-space-body]').length===3`), 'scene-space shapes');
  const close = async () => { await click('#scenePhysics2DCancel'); await wait(() => evaluate(`!document.querySelector('#scenePhysics2DDialog').open`), 'physics form cancelled'); };
  const bodySelector = index => `[data-space-body="${authorFixture.physics.bodies[index].id}"]`;
  const choiceSelector = index => `[data-space-choice="${authorFixture.physics.bodies[index].id}"]`;
  const action = name => `[data-space-action="${name}"]`, stageSelector = '[data-space-stage]';
  const handle = name => `[data-space-resize-handle="${name}"][data-body-id="${authorFixture.physics.bodies[0].id}"]`;
  const shapeData = index => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(bodySelector(index))});return e?{tag:e.tagName,x:e.getAttribute('x'),y:e.getAttribute('y'),width:e.getAttribute('width'),height:e.getAttribute('height'),cx:e.getAttribute('cx'),cy:e.getAttribute('cy'),r:e.getAttribute('r'),selected:e.dataset.selected}:null})()`);
  const fields = () => evaluate(`Object.fromEntries(['Width','Height','Radius','X','Y','Instance','Kind','Layer','Mask'].map(key=>[key,document.querySelector('#scenePhysics2D'+key).value]))`);
  const ghost = () => evaluate(`!!document.querySelector('[data-space-ghost]')`);
  const mode = () => evaluate(`document.querySelector(${JSON.stringify(stageSelector)}).dataset.mode`);
  const resize = async () => { if(await mode()!=='resize'){await enabled('#scenePhysics2DSpaceResize');await click('#scenePhysics2DSpaceResize');}assert.equal(await mode(),'resize'); };
  const key = async (key, code, virtual, modifiers=0) => {await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual,modifiers});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual,modifiers});};
  const mouse = (type, point, modifiers=0) => call('Input.dispatchMouseEvent',{type,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1,x:point.x,y:point.y,modifiers});
  const realClick = async (selector, modifiers=0) => {await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);const p=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await mouse('mousePressed',p,modifiers);await mouse('mouseReleased',p,modifiers);};
  const aim = async (name, delta=[0,0]) => {
    await evaluate(`document.querySelector(${JSON.stringify(stageSelector)}).scrollIntoView({block:'center'})`);
    return evaluate(`(()=>{const s=document.querySelector('#scenePhysics2DSpaceView svg'),h=document.querySelector(${JSON.stringify(handle(name))}).querySelector('circle'),m=s.getScreenCTM(),p=new DOMPoint(Number(h.getAttribute('cx')),Number(h.getAttribute('cy'))).matrixTransform(m),r=s.getBoundingClientRect(),v=s.viewBox.baseVal;return{start:{x:p.x+1,y:p.y+1},end:{x:p.x+1+m.a*${delta[0]}+m.c*${delta[1]},y:p.y+1+m.b*${delta[0]}+m.d*${delta[1]}},matrix:['a','b','c','d','e','f'].map(k=>m[k]),box:[v.x,v.y,v.width,v.height],rect:[r.x,r.y,r.width,r.height],letterbox:Math.abs(r.width-m.a*v.width)}})()`);
  };
  const verifyHit = async label => {
    const p=await aim('e');const found=await evaluate(`(()=>{const x=${p.start.x}+9,y=${p.start.y}-1,e=document.elementFromPoint(x,y),h=e?.closest('[data-space-resize-handle]'),k=document.querySelector(${JSON.stringify(handle('e'))}).querySelector('.scene-physics2d-space-resize-knob'),r=k.getBoundingClientRect();return{label:${JSON.stringify(label)},point:[x,y],handle:h?.dataset.spaceResizeHandle,bodyId:h?.dataset.bodyId,knob:[r.width,r.height],ctm:${JSON.stringify(p.matrix)}}})()`);
    assert.equal(found.handle,'e',JSON.stringify(found));assert.equal(found.bodyId,authorFixture.physics.bodies[0].id);(report.handleHits??=[]).push(found);
  };
  const begin = async (name,delta) => {const p=await aim(name,delta);await evaluate(`window.__resizeAim=${JSON.stringify(p)}`);await mouse('mousePressed',p.start);await mouse('mouseMoved',p.end);return p;};
  const actualDelta = p => evaluate(`(()=>{const trace=window.__resizeTrace,a=trace.find(e=>e.type==='pointerdown'),b=trace.findLast(e=>e.type==='pointerup'),m=new DOMMatrix(${JSON.stringify(p.matrix)}).inverse(),x=new DOMPoint(a.x,a.y).matrixTransform(m),y=new DOMPoint(b.x,b.y).matrixTransform(m);return{trace,delta:[y.x-x.x,y.y-x.y]}})()`);
  const center = geometry => geometry.tag==='circle'?[Number(geometry.cx),Number(geometry.cy)]:[Number(geometry.x)+Number(geometry.width)/2,Number(geometry.y)+Number(geometry.height)/2];
  const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9,JSON.stringify({actual:a,expected:b}));
  const untouched = (before,after,keys) => {for(const key of Object.keys(before))if(!keys.includes(key))assert.equal(after[key],before[key],key+' input must remain exact');};
  const sceneFile=path.join(root,'documents/scenes/demo.json'),sceneOriginal=await fs.readFile(sceneFile,'utf8'),sceneModel=JSON.parse(sceneOriginal);
  await open();await directoryReady();await spaceReady();assert.equal(await mode(),'view');assert.equal(await evaluate(`document.querySelectorAll('[data-space-resize-handle]').length`),0);
  await resize();assert.equal(await evaluate(`document.querySelectorAll('[data-space-resize-handle]').length`),3);
  await click('#scenePhysics2DSpaceEdit');assert.equal(await mode(),'offset');assert.equal(await evaluate(`document.querySelectorAll('[data-space-resize-handle]').length`),0);await resize();
  await evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(stageSelector)});window.__resizeTrace=[];for(const type of ['pointerdown','pointermove','pointerup'])s.addEventListener(type,e=>window.__resizeTrace.push({type,x:e.clientX,y:e.clientY,trusted:e.isTrusted,pointerId:e.pointerId,target:e.target.outerHTML.slice(0,400)}),true)})()`);
  let p=await aim('e');await mouse('mousePressed',p.start);await mouse('mouseReleased',p.start);assert.equal(await ghost(),false);assert.equal(await evaluate(`document.querySelector('#scenePhysics2DDialog').dataset.dirty`),'false');await unchanged();
  report.steps.push('View, offset and resize modes are mutually exclusive. Box resize mode exposes only east, south and southeast handles. Switching mode and a zero-distance handle gesture do not dirty fields or sources. The disposable original already has offset X=2 spelled 2e0.');

  await fill('#scenePhysics2DHeight','2.000e1');await fill('#scenePhysics2DX','2e0');await fill('#scenePhysics2DY','-0.00');await check();await resize();
  await click(action('focus'));await verifyHit('focused-before-zoom');await click(action('zoom-out'));await verifyHit('focused-after-zoom');let before=await fields();await evaluate('window.__resizeTrace=[]');p=await begin('e',[5,3]);
  assert.ok(p.letterbox>20,JSON.stringify(p));assert.equal(await ghost(),true);assert.deepEqual(await fields(),before);assert.deepEqual(center(await shapeData(0)),[102,180]);await unchanged();
  const ghostGeometry=await evaluate(`(()=>{const e=document.querySelector('[data-space-ghost]');return{tag:e.tagName,x:e.getAttribute('x'),y:e.getAttribute('y'),width:e.getAttribute('width'),height:e.getAttribute('height')}})()`);assert.deepEqual(center(ghostGeometry),[102,180]);
  await screenshot('physics-space-resize-box-ghost.png');await mouse('mouseReleased',p.end);let actual=await actualDelta(p);assert.ok(actual.trace.every(e=>e.trusted));
  let after=await fields();near(Number(after.Width),Number(before.Width)+2*actual.delta[0]);untouched(before,after,['Width']);assert.equal(await evaluate(`document.querySelector('#scenePhysics2DSpaceView').hidden`),true);assert.equal(await evaluate(`document.querySelector('#scenePhysics2DApply').disabled`),true);await unchanged();
  await review();await spaceReady();assert.equal(await text('#scenePhysics2DChangedPaths'),'/bodies/0/shape/size/0');assert.deepEqual(center(await shapeData(0)),[102,180]);
  report.geometry={east:{coordinates:p,actual,fields:after}};
  for(const [name,delta,keys]of [['s',[3,4],['Height']],['se',[2,3],['Width','Height']]]){
    await click(action('focus'));before=await fields();await evaluate('window.__resizeTrace=[]');p=await begin(name,delta);assert.equal(await ghost(),true);assert.deepEqual(await fields(),before);await mouse('mouseReleased',p.end);actual=await actualDelta(p);after=await fields();
    for(const key of keys){const axis=key==='Width'?0:1;near(Number(after[key]),Number(before[key])+2*actual.delta[axis]);}untouched(before,after,keys);await check();assert.deepEqual(center(await shapeData(0)),[102,180]);report.geometry[name]={coordinates:p,actual,fields:after};
  }
  report.steps.push('Actual noncentral handle grabs use the inverse SVG CTM under zoom and horizontal letterboxing. East changes width by twice horizontal displacement, south changes height by twice vertical displacement, and southeast changes both. Ghosts leave form values/source bytes untouched until pointer release; centers stay at (102,180). Untouched raw input spelling, including 2e0 and -0.00 offsets, remains exact. Each commit hides the unchecked view and revokes Apply until Check.');

  before=await fields();p=await begin('se',[5,5]);assert.equal(await ghost(),true);await key('Escape','Escape',27);await mouse('mouseReleased',p.end);assert.equal(await ghost(),false);assert.deepEqual(await fields(),before);assert.equal(await evaluate(`document.querySelector('#scenePhysics2DDialog').open`),true);
  p=await begin('e',[5,0]);await click('#scenePhysics2DSpaceEdit');await mouse('mouseReleased',p.end);assert.deepEqual(await fields(),before);await resize();
  p=await begin('s',[0,5]);await click('#scenePhysics2DSpaceRefresh');await spaceReady();await mouse('mouseReleased',p.end);assert.deepEqual(await fields(),before);await unchanged();
  await evaluate("window.__spaceMode='hold'");await click('#scenePhysics2DSpaceRefresh');await wait(()=>evaluate('window.__spaceHeld.length===1'),'held geometry');await close();await unchanged();
  await evaluate("window.__spaceMode='normal'");await open();await directoryReady();await spaceReady();await fill('#scenePhysics2DWidth','1e-');await evaluate('window.__spaceHeld.shift()()');await delay(150);assert.equal(await value('#scenePhysics2DWidth'),'1e-');assert.equal(await evaluate(`document.querySelector('#scenePhysics2DSpaceView').hidden`),true);
  await fill('#scenePhysics2DWidth','20');await check();await resize();
  report.steps.push('Escape, switching to offset mode and saved-position refresh cancel active resize ghosts without changing fields. Cancelling the reviewed form keeps the original source. A held geometry result from that closed form cannot replace unfinished input after reopening.');

  const rejected = async (name,delta) => {const preserved=await fields(),reviewed=await text('#scenePhysics2DAfter');await click(action('focus'));const points=await begin(name,delta);assert.equal(await ghost(),false);await mouse('mouseReleased',points.end);assert.deepEqual(await fields(),preserved);assert.equal(await text('#scenePhysics2DAfter'),reviewed);assert.match(await text('.scene-physics2d-space-interaction'),/无法调整/);await unchanged();};
  await fill('#scenePhysics2DWidth','8.192e3');await fill('#scenePhysics2DHeight','1e0');await check();await rejected('e',[512,0]);await rejected('s',[0,-512]);
  await fill('#scenePhysics2DWidth','1e0');await fill('#scenePhysics2DHeight','8.192e3');await check();await rejected('e',[-512,0]);await rejected('s',[0,512]);
  await fill('#scenePhysics2DShape','circle','change');await fill('#scenePhysics2DRadius','4.096e3');await check();assert.equal(await evaluate(`document.querySelectorAll('[data-space-resize-handle]').length`),1);await rejected('e',[512,0]);
  await fill('#scenePhysics2DRadius','5e-1');await check();await rejected('e',[-2,0]);await screenshot('physics-space-resize-rejected.png');
  report.steps.push('All actual handle gestures across box width/height bounds 1..8192 and circle radius bounds 0.5..4096 are rejected without clamping. Both axes, original numeric spellings, center/offset and previous checked review remain exact; the rejection remains visible after release. Circle mode exposes only its east radius handle.');

  await fill('#scenePhysics2DRadius','10');await check();await click(action('focus'));await click(action('zoom-out'));before=await fields();await evaluate('window.__resizeTrace=[]');p=await begin('e',[2.5,4]);assert.equal(await ghost(),true);assert.deepEqual(await fields(),before);await screenshot('physics-space-resize-circle-ghost.png');await mouse('mouseReleased',p.end);actual=await actualDelta(p);after=await fields();near(Number(after.Radius),10+actual.delta[0]);untouched(before,after,['Radius']);await check();assert.deepEqual(center(await shapeData(0)),[102,180]);report.geometry.circle={coordinates:p,actual,fields:after};
  await fill('#scenePhysics2DRadius','10');await check();await realClick(action('radius-more'),8);assert.equal(await value('#scenePhysics2DRadius'),'20');await check();
  await evaluate(`document.querySelector(${JSON.stringify(stageSelector)}).focus()`);await key('ArrowLeft','ArrowLeft',37,8);assert.equal(await value('#scenePhysics2DRadius'),'10');await check();
  await realClick(action('radius-more'));assert.equal(await value('#scenePhysics2DRadius'),'11');await check();await evaluate(`document.querySelector(${JSON.stringify(stageSelector)}).focus()`);await key('ArrowRight','ArrowRight',39);assert.equal(await value('#scenePhysics2DRadius'),'12');
  const candidate=await review();await spaceReady();await evaluate(`document.querySelector('#scenePhysics2DRadius').focus()`);await key('ArrowRight','ArrowRight',39);assert.equal(await value('#scenePhysics2DRadius'),'12');
  assert.deepEqual(center(await shapeData(0)),[102,180]);assert.equal((await shapeData(0)).r,'12');assert.deepEqual([await value('#scenePhysics2DX'),await value('#scenePhysics2DY')],['2','0']);
  assert.equal(candidate.charCodeAt(0),0xFEFF);assert.ok(candidate.includes('"bodi\\u0065s"'));assert.ok(candidate.includes('"layer": 1e0'));assert.ok(candidate.includes('2e0'));
  const beforeTree=parseJsonSource(original),afterTree=parseJsonSource(candidate);
  const oldOffset=locateJsonSource(beforeTree,'/bodies/0/offset'),newOffset=locateJsonSource(afterTree,'/bodies/0/offset');assert.equal(candidate.slice(newOffset.start,newOffset.end),original.slice(oldOffset.start,oldOffset.end));
  for(const index of [1,2]){const a=locateJsonSource(beforeTree,`/bodies/${index}`),b=locateJsonSource(afterTree,`/bodies/${index}`);assert.equal(candidate.slice(b.start,b.end),original.slice(a.start,a.end));}
  const expectedPhysics=structuredClone(authorFixture.physics);expectedPhysics.bodies[0].shape={kind:'circle',radius:12};assert.deepEqual(afterTree.value,expectedPhysics);await unchanged();
  report.steps.push('Circle drag changes radius by horizontal scene displacement only, ignoring vertical motion and preserving center/offset. Actual Shift-click and Shift-arrow adjust by 10; ordinary controls adjust by 1. The final radius 12 is produced through the new resize controls. Arrow keys inside the numeric input do not resize. The reviewed source changes only the first body shape and preserves offset 2e0, BOM/CRLF, escaped keys and other bodies verbatim.');

  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']){
    await evaluate(`(window.__sizeButton=document.querySelector(${JSON.stringify(action('radius-more'))}),window.__radius=document.querySelector('#scenePhysics2DRadius'),window.__sizeButton.focus())`);await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(action('radius-more'))})===window.__sizeButton&&document.activeElement===window.__sizeButton&&document.querySelector('#scenePhysics2DRadius')===window.__radius`),true);assert.equal(await text('#scenePhysics2DAfter'),candidate);
    await evaluate(`document.querySelector('#scenePhysics2DSpaceView').scrollIntoView({block:'start'})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#scenePhysics2DDialog'),r=id=>{const b=document.querySelector(id).getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth;},c=document.querySelector(${JSON.stringify(bodySelector(0))}).getBoundingClientRect();return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,noDialogScroll:d.scrollHeight<=d.clientHeight&&getComputedStyle(d).overflowY==='hidden',equalCircleScale:Math.abs(c.width-c.height)<.1,closeVisible:r('#scenePhysics2DClose'),cancelVisible:r('#scenePhysics2DCancel'),checkVisible:r('#scenePhysics2DCheck'),applyVisible:r('#scenePhysics2DApply'),resizeButtonsVisible:['radius-less','radius-more'].every(action=>{const e=document.querySelector('[data-space-action="'+action+'"]'),b=e.getBoundingClientRect();return b.width>0&&b.left>=0&&b.right<=innerWidth})};})()`);
    assert.ok(Object.values(layout).every(Boolean),JSON.stringify(layout));report.layout[language]=layout;await screenshot(`physics-space-resize-${language}-390.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  report.steps.push('Chinese, English and Japanese at 390px retain focused resize controls, exact input nodes and the reviewed source. Radius controls fit horizontally, circles retain proportions and the dialog keeps Check/Apply/Cancel visible.');

  await evaluate("window.__spaceMode='fail'");await click('#scenePhysics2DSpaceRefresh');await wait(async()=>/无法显示/.test(await text('#scenePhysics2DSpaceStatus')),'failed geometry');assert.equal(await text('#scenePhysics2DAfter'),candidate);assert.equal(await evaluate(`document.querySelector('#scenePhysics2DApply').disabled`),false);await unchanged();
  await evaluate("window.__spaceMode='normal'");await click('#scenePhysics2DSpaceRefresh');await spaceReady();
  const missing=structuredClone(sceneModel);missing.actors=missing.actors.filter(actor=>actor.instanceId!==authorFixture.sensorInstanceId);await fs.writeFile(sceneFile,JSON.stringify(missing,null,2)+'\n');await click('#scenePhysics2DSpaceRefresh');await wait(()=>evaluate(`document.querySelector(${JSON.stringify(choiceSelector(1))})?.dataset.missing==='true'`),'missing target');await click(choiceSelector(1));assert.equal(await evaluate(`document.querySelectorAll('[data-space-resize-handle]').length`),0);assert.equal(await text('#scenePhysics2DAfter'),candidate);
  await fs.writeFile(sceneFile,sceneOriginal);await click('#scenePhysics2DSpaceRefresh');await spaceReady();await click(choiceSelector(0));await unchanged();
  report.steps.push('Transport failure leaves the checked source review and ordinary Apply path intact. A missing instance retains its declaration but exposes no resize handles; restoring saved scene geometry restores the correct controls without altering the reviewed candidate.');
  await click('#scenePhysics2DApply'); await wait(() => evaluate(`!document.querySelector('#scenePhysics2DDialog').open`), 'physics changes applied to draft');
  assert.equal(await value('#docSourceEditor'), visible(candidate)); assert.deepEqual(await authorTree(root), initial);
  assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`), true); await screenshot('physics-space-resize-unsaved-draft.png');
  await open(); await directoryReady(); await spaceReady(); assert.equal((await shapeData(0)).cx, '102'); assert.equal(await value('#scenePhysics2DRadius'), '12'); await close();
  assert.equal(await value('#docSourceEditor'), visible(candidate)); assert.deepEqual(await authorTree(root), initial);
  await enabled('#docSaveBtn'); await click('#docSaveBtn'); await wait(async () => await fs.readFile(authorFile, 'utf8') === candidate, 'ordinary Save writes exact reviewed physics source');
  await wait(() => evaluate(`!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges&&!(await import('/web/modules/app-state.js')).appState.isSaving`), 'ordinary Save finished');
  const repaired = await authorTree(root); assert.deepEqual(Object.keys(repaired).filter(name => initial[name] !== repaired[name]), [authorFixture.physicsPath]); assert.deepEqual(Object.keys(repaired), Object.keys(initial));
  const saved = JSON.parse(candidate.replace(/^\uFEFF/, '')), expected = structuredClone(authorFixture.physics); expected.bodies[0].shape = { kind: 'circle', radius: 12 }; assert.deepEqual(saved, expected);
  report.spaceReads = await evaluate('window.__spaceCalls'); report.assetReads = await evaluate('window.__assetReads'); assert.equal(report.assetReads, 0);
  report.saved = { onlyChangedAuthorPath: authorFixture.physicsPath, beforeSha256: buildHash(Buffer.from(original)), afterSha256: buildHash(Buffer.from(candidate)), bomCrlfPreserved: true };
  assert.equal(candidate.replaceAll('\r\n', '').includes('\n'), false);
  report.steps.push('Apply changes only the ordinary source draft; reopening displays its checked collision geometry over saved actor positions. Cancel keeps that draft. Ordinary Save changes only the exact reviewed physics source, preserving BOM, CRLF, escaped key and untouched body text. No resource bytes are fetched.');
  await enabled('#projectBuildBtn');await click('#projectBuildBtn');await enabled('#projectBuildScene');await fill('#projectBuildScene',assemblyId,'change');
  async function perform(selector,kind){const previous=(await state()).job?.id;await enabled(selector);await click(selector);let job;await wait(async()=>{job=(await state()).job;return job?.kind===kind&&job.id!==previous&&job.status!=='running';},kind,90000);report.jobs.push(job);assert.equal(job.status,'succeeded',JSON.stringify(job.diagnostics));return job;}
  await perform('#projectBuildPlan','plan');await perform('#projectBuildGenerate','build');const ran=await perform('#projectBuildHeadless','run');
  const project=ran.runtime.project;assert.equal(project.protocolVersion,10);
  assert.equal(project.events.sequence,2);assert.deepEqual(project.events.entries.map(row=>row.name),['physics.entered','physics.exited']);
  assert.ok(project.events.entries.every(row=>row.value===authorFixture.instanceId&&row.origin.bindingId===authorFixture.sensorBindingId&&row.origin.instanceId===authorFixture.sensorInstanceId));
  assert.deepEqual(project.animationStateEntries.entries.map(row=>row.stateKey),['idle','action','idle']);assert.deepEqual(project.animationStateEntries.entries.map(row=>row.trigger.kind),['initial','event','completed']);
  assert.equal(project.animationCommands.sequence,6);assert.equal(project.animationCompletions.sequence,1);
  const actor=ran.runtime.actors.find(row=>row.instanceId===authorFixture.instanceId);assert.ok(actor);
  assert.ok(actor.position[0]>130.8&&actor.position[0]<=131.01,JSON.stringify(actor));
  await wait(()=>evaluate(`document.querySelector('#projectAnimationStateEntriesSequence')?.dataset.sequence==='3'&&!document.querySelector('#projectAnimationStateEntriesPanel').hidden`),'rendered final animation entries');
  await evaluate(`document.querySelector('#projectAnimationStateEntriesPanel').scrollIntoView({block:'start'})`);await screenshot('physics-space-resize-run.png');report.runtime=ran.runtime;
  report.steps.push('GUI Plan, Build and real Godot headless Run consume the saved circle radius 12 and local offset X 2. Character stops at x≈131; actual sensor enter/exit publishes the other instance UUID from its sensor binding. Animation completes idle/action/idle under unchanged project protocol 10.');
  report.authorSnapshot={before:initial,afterSave:repaired,after:await authorTree(root)};assert.deepEqual(report.authorSnapshot.after,repaired);
  assert.deepEqual(report.errors, []); assert.ok(report.dialogs.length >= 1); assert.ok(report.dialogs.every(dialog => dialog.type === 'confirm'));
  for(const [file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,'Source changed during smoke: '+file);
  report.sourceSnapshotUnchanged=true;report.ok=true;
} catch(error){
  report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;
  try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}
} finally{
  socket?.close();
  for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}
  report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));
}
