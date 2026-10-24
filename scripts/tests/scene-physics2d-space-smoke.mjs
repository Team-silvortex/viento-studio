// Actual Chrome scene-space collision view → checked fields → ordinary Save → real Godot collision/events/animation.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-physics2d-space');
const output = path.resolve(process.env.VIENTO_PHYSICS2D_SPACE_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/scene-physics2d-space.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome HTTP editor and Godot headless execution; no installed Tauri, Android, visual rendering or Bevy physics claim.',
  'Read-only saved logical geometry and checked collision declarations. No scene draft projection, images, solver, drag handles, native installed-app claim or protocol upgrade.'
] };
const sources = ['engine/scene-physics2d-space.mjs','scripts/lib/scene-physics2d-space-service.mjs','scripts/lib/doc-api-service.mjs','scripts/lib/doc-server-routes.mjs','scripts/adapters/node-world-projection.mjs','web/modules/app-doc-service.js','web/modules/app-services.js','engine/studio-core.wasm','engine/scene-physics2d-edit.mjs','engine/scene-physics2d.mjs','engine/scene-physics2d-core.mjs',
  'web/modules/app-scene-physics2d.js','web/modules/app-scene-physics2d-space.js','web/modules/app-scene-physics2d-source.js','web/scene-physics2d.css',
  'engine/scene-physics2d-targets.mjs','scripts/lib/scene-physics2d-targets-service.mjs',
  'web/modules/app-runtime.js','web/modules/app-studio-system.js','engine/studio-modules.mjs','web/i18n/en.js','web/i18n/ja.js',
  'scripts/backends/godot4-physics.mjs','scripts/backends/godot4/physics-runtime.gd','scripts/backends/godot4/project-physics-runtime.gd',
  'scripts/tests/helpers/scene-physics2d-author-fixture.mjs','scripts/tests/scene-physics2d-space-smoke.mjs'];
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-physics2d-space-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const authorFixture = await scenePhysics2DAuthor(fixture);
  const authorFile = path.join(authorFixture.author, authorFixture.physicsPath);
  const original = '\ufeff' + (await fs.readFile(authorFile, 'utf8')).replace('"bodies"', '"bodi\\u0065s"')
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
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,system:(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()})`); report.serviceFailure = await state(); report.editorFailure = await evaluate(`(()=>import('/web/modules/app-state.js').then(({appState:s})=>({isSaving:s.isSaving,isRebuilding:s.isRebuilding,isMutatingWorld:s.isMutatingWorld,dirty:s.editHasUnsavedChanges,creating:s.isCreating,planDisabled:document.querySelector('#projectBuildPlan')?.disabled,behaviorDisabled:document.querySelector('#sceneBehaviorsBtn')?.disabled})))()`); };
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
  const edit = async () => { await fill('#scenePhysics2DShape', 'circle', 'change'); await fill('#scenePhysics2DRadius', '12'); await fill('#scenePhysics2DX', '2'); };
  const review = async () => { await enabled('#scenePhysics2DCheck'); await click('#scenePhysics2DCheck'); await enabled('#scenePhysics2DApply'); return text('#scenePhysics2DAfter'); };
  const unchanged = async () => { assert.deepEqual(await authorTree(root),initial); assert.equal(await value('#docSourceEditor'),visible(original)); };
  const directoryReady = () => enabled('#scenePhysics2DTarget');
  const spaceReady = () => wait(() => evaluate(`!document.querySelector('#scenePhysics2DSpaceView').hidden&&document.querySelectorAll('[data-space-body]').length===3`), 'scene-space shapes');
  const close = async () => { await click('#scenePhysics2DCancel'); await wait(() => evaluate(`!document.querySelector('#scenePhysics2DDialog').open`), 'physics form cancelled'); };
  const bodySelector = index => `[data-space-body="${authorFixture.physics.bodies[index].id}"]`;
  const choiceSelector = index => `[data-space-choice="${authorFixture.physics.bodies[index].id}"]`;
  const shapeData = index => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(bodySelector(index))});return e?{tag:e.tagName,x:e.getAttribute('x'),y:e.getAttribute('y'),width:e.getAttribute('width'),height:e.getAttribute('height'),cx:e.getAttribute('cx'),cy:e.getAttribute('cy'),r:e.getAttribute('r'),selected:e.dataset.selected}:null})()`);
  const sceneFile = path.join(root, 'documents/scenes/demo.json'), sceneOriginal = await fs.readFile(sceneFile, 'utf8'), sceneModel = JSON.parse(sceneOriginal);
  await evaluate("window.__spaceMode='hold'"); await open(); await directoryReady();
  await wait(() => evaluate('window.__spaceHeld.length===1'), 'held initial geometry');
  await fill('#scenePhysics2DWidth', '1e-');
  await evaluate(`(window.__width=document.querySelector('#scenePhysics2DWidth'),window.__width.focus(),window.__width.setSelectionRange(1,2))`);
  await evaluate("(window.__spaceMode='normal',window.__spaceHeld.shift()())");
  await wait(async () => /未检查/.test(await text('#scenePhysics2DSpaceStatus')), 'geometry retains unchecked input');
  assert.equal(await value('#scenePhysics2DWidth'), '1e-');
  assert.equal(await evaluate(`document.querySelector('#scenePhysics2DWidth')===window.__width&&document.activeElement===window.__width&&window.__width.selectionStart===1&&window.__width.selectionEnd===2`), true);
  assert.equal(await evaluate(`document.querySelector('#scenePhysics2DSpaceView').hidden`), true);
  await fill('#scenePhysics2DWidth', '20'); await click('#scenePhysics2DCheck'); await settled(); await spaceReady();
  const stage = await evaluate(`(()=>{const s=document.querySelector('#scenePhysics2DSpaceView svg'),v=s.querySelector('[data-space-viewport]');return{preserveAspectRatio:s.getAttribute('preserveAspectRatio'),viewBox:s.getAttribute('viewBox').split(' ').map(Number),viewport:[Number(v.getAttribute('width')),Number(v.getAttribute('height'))],actors:s.querySelectorAll('[data-space-actor]').length,shapes:s.querySelectorAll('[data-space-body]').length};})()`);
  assert.equal(stage.preserveAspectRatio, 'xMidYMid meet'); assert.deepEqual(stage.viewport, sceneModel.viewport); assert.equal(stage.actors, 3); assert.equal(stage.shapes, 3);
  assert.equal((await shapeData(0)).x, '90'); assert.equal((await shapeData(0)).y, '170');
  report.geometry = { initial: stage, bodies: await Promise.all([0, 1, 2].map(shapeData)) };
  await evaluate(`document.querySelector('#scenePhysics2DSpaceView').scrollIntoView({block:'center'})`);
  const sensorPoint = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(bodySelector(1))}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...sensorPoint });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...sensorPoint });
  assert.equal(await value('#scenePhysics2DBody'), authorFixture.physics.bodies[1].id); assert.equal(await value('#scenePhysics2DKind'), 'sensor');
  await evaluate(`document.querySelector(${JSON.stringify(choiceSelector(2))}).focus()`);
  assert.equal(await evaluate(`document.activeElement?.dataset.spaceChoice`), authorFixture.physics.bodies[2].id);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.equal(await value('#scenePhysics2DBody'), authorFixture.physics.bodies[2].id); assert.equal(await value('#scenePhysics2DKind'), 'static');
  assert.equal(await evaluate(`document.querySelector('#scenePhysics2DDialog').dataset.dirty`), 'false'); await unchanged();
  report.steps.push('A held actual geometry response preserves focused unfinished input and never renders an unchecked shape. Checked initial geometry renders saved viewport and all three logical actors. A real CDP mouse click selects the sensor; Enter on the accessible body button selects the wall. Neither operation changes draft or author bytes.');

  await click(choiceSelector(0)); await edit();
  assert.equal(await evaluate(`document.querySelector('#scenePhysics2DSpaceView').hidden`), true);
  const first = await review(); await spaceReady();
  assert.equal(await text('#scenePhysics2DBefore'), original); const checkedShape = await shapeData(0);
  assert.equal(checkedShape.tag, 'circle'); assert.equal(checkedShape.cx, '102'); assert.equal(checkedShape.cy, '180'); assert.equal(checkedShape.r, '12');
  assert.equal(first.charCodeAt(0), 0xFEFF); assert.ok(first.includes('"bodi\\u0065s"')); assert.ok(first.includes('"layer": 1e0'));
  const sourceTree = parseJsonSource(original), resultTree = parseJsonSource(first);
  for (const index of [1, 2]) { const before = locateJsonSource(sourceTree, `/bodies/${index}`), after = locateJsonSource(resultTree, `/bodies/${index}`);
    assert.equal(first.slice(after.start, after.end), original.slice(before.start, before.end)); }
  await click(choiceSelector(1)); assert.equal(await text('#scenePhysics2DAfter'), first); assert.equal(await evaluate(`document.querySelector('#scenePhysics2DApply').disabled`), false);
  await click(choiceSelector(0)); await unchanged();
  await evaluate(`document.querySelector('#scenePhysics2DSpaceView').scrollIntoView({block:'center'})`); await screenshot('physics-space-desktop.png');
  report.steps.push('Changing shape to circle, radius to 12 and offset X to 2 clears the scene view until Check succeeds. The checked view places the circle at saved actor (100,180) plus offset (2,0). Selecting another body preserves the reviewed candidate and Apply authority. BOM, CRLF, escaped key, numeric spelling and untouched body slices remain exact.');

  const moved = structuredClone(sceneModel); moved.actors[0].position = [-150, 220]; await fs.writeFile(sceneFile, JSON.stringify(moved, null, 2) + '\n');
  await evaluate(`(window.__radius=document.querySelector('#scenePhysics2DRadius'),window.__radius.focus(),window.__radius.setSelectionRange(0,1))`);
  await click('#scenePhysics2DSpaceRefresh'); await spaceReady(); assert.equal((await shapeData(0)).cx, '-148'); assert.equal((await shapeData(0)).cy, '220');
  assert.equal(await value('#scenePhysics2DRadius'), '12'); assert.equal(await text('#scenePhysics2DAfter'), first); assert.equal(await evaluate(`document.querySelector('#scenePhysics2DApply').disabled`), false);
  assert.equal(await evaluate(`document.querySelector('#scenePhysics2DRadius')===window.__radius&&document.activeElement===window.__radius&&window.__radius.selectionStart===0&&window.__radius.selectionEnd===1`), true);
  const offscreen = await evaluate(`document.querySelector('#scenePhysics2DSpaceView svg').getAttribute('viewBox').split(' ').map(Number)`); assert.ok(offscreen[0] < -160);
  report.geometry.offscreenViewBox = offscreen; await evaluate(`document.querySelector('#scenePhysics2DSpaceView').scrollIntoView({block:'center'})`); await screenshot('physics-space-offscreen.png');
  await fs.writeFile(sceneFile, sceneOriginal); await click('#scenePhysics2DSpaceRefresh'); await spaceReady(); await unchanged();
  report.steps.push('An external edit in the disposable saved scene moves the character beyond the viewport. Refresh updates only its observed world position, fits the offscreen bounds and preserves exact numeric input node, focus, selection and checked review. Restoring the scene and refreshing restores the geometry without changing the physics candidate.');

  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  for (const language of ['zh-CN', 'en', 'ja']) {
    await evaluate(`(window.__choice=document.querySelector(${JSON.stringify(choiceSelector(0))}),window.__radius=document.querySelector('#scenePhysics2DRadius'),window.__choice.focus())`);
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(choiceSelector(0))})===window.__choice&&document.activeElement===window.__choice&&document.querySelector('#scenePhysics2DRadius')===window.__radius`), true);
    assert.equal(await text('#scenePhysics2DAfter'), first); assert.equal(await evaluate(`document.querySelector('#scenePhysics2DApply').disabled`), false);
    await evaluate(`document.querySelector('#scenePhysics2DSpaceView').scrollIntoView({block:'start'})`);
    const layout = await evaluate(`(()=>{const d=document.querySelector('#scenePhysics2DDialog'),r=id=>{const b=document.querySelector(id).getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth;},s=document.querySelector('#scenePhysics2DSpaceView svg'),c=s.querySelector('circle').getBoundingClientRect();return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,noDialogScroll:d.scrollHeight<=d.clientHeight&&getComputedStyle(d).overflowY==='hidden',equalCircleScale:Math.abs(c.width-c.height)<.1,closeVisible:r('#scenePhysics2DClose'),cancelVisible:r('#scenePhysics2DCancel'),checkVisible:r('#scenePhysics2DCheck'),applyVisible:r('#scenePhysics2DApply')};})()`);
    assert.ok(Object.values(layout).every(Boolean), JSON.stringify(layout)); report.layout[language] = layout; await screenshot(`physics-space-${language}-390.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  report.steps.push('At 390px, Chinese, English and Japanese preserve the focused body button, existing field nodes, checked review and Apply authority. SVG keeps circle proportions; dialog and page avoid horizontal overflow and all footer actions remain visible.');

  await evaluate("window.__spaceMode='fail'"); await click('#scenePhysics2DSpaceRefresh');
  await wait(async () => /无法显示/.test(await text('#scenePhysics2DSpaceStatus')), 'failed geometry');
  assert.equal(await text('#scenePhysics2DAfter'), first); assert.equal(await evaluate(`document.querySelector('#scenePhysics2DApply').disabled`), false);
  assert.equal(await value('#scenePhysics2DRadius'), '12'); assert.equal(await evaluate(`document.querySelector('#scenePhysics2DInstance').disabled`), false);
  await evaluate(`document.querySelector('#scenePhysics2DSpace').scrollIntoView({block:'center'})`); await screenshot('physics-space-fallback.png'); await unchanged();
  await evaluate("window.__spaceMode='normal'"); await click('#scenePhysics2DSpaceRefresh'); await spaceReady();
  assert.equal(await text('#scenePhysics2DAfter'), first); assert.equal(await evaluate(`document.querySelector('#scenePhysics2DApply').disabled`), false);
  report.steps.push('A real transport failure clears only the optional scene view, exposes a retry message, and preserves fields, checked candidate and Apply authority. Retry restores the geometry without creating or cancelling an edit.');

  const removed = structuredClone(sceneModel); removed.actors = removed.actors.filter(actor => actor.instanceId !== authorFixture.sensorInstanceId); await fs.writeFile(sceneFile, JSON.stringify(removed, null, 2) + '\n');
  await click('#scenePhysics2DSpaceRefresh'); await wait(() => evaluate(`document.querySelector(${JSON.stringify(choiceSelector(1))})?.dataset.missing==='true'`), 'missing geometry target');
  assert.equal(await shapeData(1), null); await click(choiceSelector(1)); assert.equal(await value('#scenePhysics2DInstance'), authorFixture.sensorInstanceId);
  assert.equal(await text('#scenePhysics2DAfter'), first); assert.equal(await evaluate(`document.querySelector('#scenePhysics2DApply').disabled`), false);
  await evaluate(`document.querySelector('#scenePhysics2DSpaceView').scrollIntoView({block:'center'})`); await screenshot('physics-space-missing.png');
  await fs.writeFile(sceneFile, sceneOriginal); await click('#scenePhysics2DSpaceRefresh'); await spaceReady(); await click(choiceSelector(0)); await unchanged();
  report.steps.push('Removing the sensor from the disposable saved scene produces an explicit missing-target body button and no invented shape position. Selecting it opens its preserved instance ID for repair. The readonly observation does not alter review authority; the existing target directory still owns Apply membership checks. Restoring the scene restores its sensor geometry.');

  await evaluate("window.__spaceMode='hold'"); await click('#scenePhysics2DSpaceRefresh'); await wait(() => evaluate('window.__spaceHeld.length===1'), 'held refresh');
  await close(); await unchanged(); await evaluate("window.__spaceMode='normal'"); await open(); await directoryReady(); await spaceReady();
  await edit(); const candidate = await review(); assert.equal(candidate, first); await evaluate('window.__spaceHeld.shift()()'); await delay(150); await spaceReady();
  assert.equal(await value('#scenePhysics2DRadius'), '12'); assert.equal((await shapeData(0)).cx, '102'); assert.equal(await text('#scenePhysics2DAfter'), candidate);
  report.steps.push('Closing with an HTTP geometry response held discards only the temporary form. Reopening starts a new source observation; releasing the old response cannot replace the reopened checked shape or fields.');

  await click('#scenePhysics2DApply'); await wait(() => evaluate(`!document.querySelector('#scenePhysics2DDialog').open`), 'physics changes applied to draft');
  assert.equal(await value('#docSourceEditor'), visible(candidate)); assert.deepEqual(await authorTree(root), initial);
  assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`), true); await screenshot('physics-space-unsaved-draft.png');
  await open(); await directoryReady(); await spaceReady(); assert.equal((await shapeData(0)).cx, '102'); assert.equal(await value('#scenePhysics2DRadius'), '12'); await close();
  assert.equal(await value('#docSourceEditor'), visible(candidate)); assert.deepEqual(await authorTree(root), initial);
  await enabled('#docSaveBtn'); await click('#docSaveBtn'); await wait(async () => await fs.readFile(authorFile, 'utf8') === candidate, 'ordinary Save writes exact reviewed physics source');
  await wait(() => evaluate(`!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges&&!(await import('/web/modules/app-state.js')).appState.isSaving`), 'ordinary Save finished');
  const repaired = await authorTree(root); assert.deepEqual(Object.keys(repaired).filter(name => initial[name] !== repaired[name]), [authorFixture.physicsPath]); assert.deepEqual(Object.keys(repaired), Object.keys(initial));
  const saved = JSON.parse(candidate.replace(/^\uFEFF/, '')), expected = structuredClone(authorFixture.physics); expected.bodies[0].shape = { kind: 'circle', radius: 12 }; expected.bodies[0].offset[0] = 2; assert.deepEqual(saved, expected);
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
  await evaluate(`document.querySelector('#projectAnimationStateEntriesPanel').scrollIntoView({block:'start'})`);await screenshot('physics-editor-run.png');report.runtime=ran.runtime;
  report.steps.push('GUI Plan, Build and real Godot headless Run consume the saved circle radius 12 and local offset X 2. Character stops at x≈131; actual sensor enter/exit publishes the other instance UUID from its sensor binding. Animation completes idle/action/idle under unchanged project protocol 10.');
  report.authorSnapshot={before:initial,afterSave:repaired,after:await authorTree(root)};assert.deepEqual(report.authorSnapshot.after,repaired);
  assert.deepEqual(report.errors, []); assert.equal(report.dialogs.length, 1); assert.ok(report.dialogs.every(dialog => dialog.type === 'confirm'));
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
