// Actual Chrome character response → checked review → ordinary Save → reopening and three-language UI.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-physics2d-response');
const output = path.resolve(process.env.VIENTO_PHYSICS2D_RESPONSE_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/scene-physics2d-response.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome HTTP editor and ordinary author Save. Runtime collision comparisons have separate Godot evidence; no installed Tauri, Android or Bevy claim.',
  'Only a character collision-response author change is saved; no scene, visual-offset, relation or other-author-file writes.'
] };
const sources = ['engine/studio-core.mjs','engine/studio-core.wasm','engine/scene-physics2d-core.mjs','engine/scene-physics2d-edit.mjs','engine/scene-physics2d-create-plan.mjs','engine/scene-physics2d-space.mjs','engine/scene-physics2d-space-edit.mjs','engine/scene-physics2d-space-resize.mjs','web/modules/app-scene-physics2d.js','web/modules/app-scene-physics2d-create.js','web/modules/app-scene-physics2d-source.js','web/scene-physics2d.css','web/scene-physics2d-create.css','web/i18n/en.js','web/i18n/ja.js','scripts/tests/helpers/scene-physics2d-author-fixture.mjs','scripts/tests/scene-physics2d-response-smoke.mjs'];
report.sources = Object.fromEntries(await Promise.all(sources.map(async name => [name, buildHash(await fs.readFile(path.join(appRoot, name)))])));
report.node = { version: process.version, sha256: buildHash(await fs.readFile(process.execPath)) };
if (tool) report.tool = { sha256: buildHash(await fs.readFile(tool)) };
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
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value})`); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: download, eventsEnabled: true });
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
  const open = async () => { await enabled('#scenePhysics2DBtn'); await click('#scenePhysics2DBtn'); await enabled('#scenePhysics2DResponse'); };
  const review = async () => { await enabled('#scenePhysics2DCheck'); await click('#scenePhysics2DCheck'); await enabled('#scenePhysics2DApply'); return text('#scenePhysics2DAfter'); };
  const close = async () => { await click('#scenePhysics2DCancel'); await wait(() => evaluate(`!document.querySelector('#scenePhysics2DDialog').open`), 'physics form cancelled'); };
  await open(); assert.equal(await value('#scenePhysics2DResponse'), 'stop'); await enabled('#scenePhysics2DCheck'); await click('#scenePhysics2DCheck'); await settled();
  assert.equal(await evaluate(`document.querySelector('#scenePhysics2DApply').disabled`), true); assert.deepEqual(await authorTree(root), initial);
  report.steps.push('Legacy schema1 appears as stop. A no-change Check leaves every author byte intact and creates no application ticket.');
  await fill('#scenePhysics2DResponse', 'slide', 'change'); assert.equal(await evaluate(`document.querySelector('#scenePhysics2DApply').disabled`), true);
  const candidate = await review(), planned = JSON.parse(candidate.replace(/^\uFEFF/, ''));
  assert.equal(planned.schemaVersion, 2); assert.equal(planned.bodies[0].collisionResponse, 'slide');
  assert.equal(Object.hasOwn(planned.bodies[1], 'collisionResponse'), false); assert.equal(Object.hasOwn(planned.bodies[2], 'collisionResponse'), false);
  assert.deepEqual(planned.bodies.map(({collisionResponse,...body})=>body), authorFixture.physics.bodies);
  assert.deepEqual(await authorTree(root), initial); assert.equal(await value('#docSourceEditor'), visible(original));
  await evaluate(`document.querySelector('#scenePhysics2DResponse').scrollIntoView({block:'center'})`); await screenshot('response-review-desktop.png');
  report.steps.push('Explicit slide yields a complete schema2 source review. Character identity, shape, offset, mask, static and sensor declarations stay unchanged; author files and the editor source remain untouched.');
  await fill('#scenePhysics2DKind', 'static', 'change'); assert.equal(await evaluate(`document.querySelector('#scenePhysics2DResponseField').hidden && document.querySelector('#scenePhysics2DResponse').disabled`), true);
  await fill('#scenePhysics2DKind', 'character', 'change'); assert.equal(await value('#scenePhysics2DResponse'), 'slide'); assert.equal(await review(), candidate);
  for (const language of ['zh-CN', 'en', 'ja']) {
    await call('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:false});
    await evaluate(`(window.__responseSelect=document.querySelector('#scenePhysics2DResponse'),window.__responseSelect.focus())`);
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate(`document.querySelector('#scenePhysics2DResponse')===window.__responseSelect && document.activeElement===window.__responseSelect`), true);
    assert.equal(await value('#scenePhysics2DResponse'), 'slide'); assert.equal(await text('#scenePhysics2DAfter'), candidate);
    await evaluate(`document.querySelector('#scenePhysics2DResponse').scrollIntoView({block:'center'})`);
    const layout = await evaluate(`(()=>{const d=document.querySelector('#scenePhysics2DDialog'),visible=id=>{const r=document.querySelector(id).getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};return{noOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,selectVisible:visible('#scenePhysics2DResponse'),checkVisible:visible('#scenePhysics2DCheck'),applyVisible:visible('#scenePhysics2DApply'),cancelVisible:visible('#scenePhysics2DCancel'),label:document.querySelector('#scenePhysics2DResponseField').innerText};})()`);
    assert.equal(layout.noOverflow,true,JSON.stringify(layout)); assert.equal(layout.selectVisible,true); assert.equal(layout.checkVisible,true); assert.equal(layout.applyVisible,true); assert.equal(layout.cancelVisible,true);
    report.layout[language]=layout; await screenshot(`response-${language}-390.png`);
  }
  report.steps.push('Chinese, English and Japanese at 390px preserve the response select, focus and exact review; response and Check/Apply/Cancel stay reachable without horizontal overflow.');
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await enabled('#scenePhysics2DApply'); await click('#scenePhysics2DApply'); await wait(()=>evaluate(`!document.querySelector('#scenePhysics2DDialog').open`),'review applied to editor draft');
  assert.equal(await value('#docSourceEditor'),visible(candidate)); assert.deepEqual(await authorTree(root),initial);
  await enabled('#docSaveBtn'); await click('#docSaveBtn'); await wait(async()=>await fs.readFile(authorFile,'utf8')===candidate,'ordinary response Save');
  const saved=await authorTree(root); assert.deepEqual(Object.keys(saved).filter(key=>saved[key]!==initial[key]),[authorFixture.physicsPath]);
  await open(); assert.equal(await value('#scenePhysics2DResponse'),'slide'); assert.equal(await value('#scenePhysics2DX'),'2'); await close();
  report.steps.push('Apply updates only the unsaved editor source; ordinary Save writes only the reviewed physics JSON. Reopening shows slide and the original collider offset.');
  await open(); await fill('#scenePhysics2DResponse','stop','change'); const stopped = await review(), stoppedModel=JSON.parse(stopped.replace(/^\uFEFF/,''));
  assert.equal(stoppedModel.schemaVersion,2); assert.equal(stoppedModel.bodies[0].collisionResponse,'stop'); await close(); assert.equal(await fs.readFile(authorFile,'utf8'),candidate);
  report.steps.push('Changing a saved schema2 slide declaration back to stop retains schema2 in review; cancelling preserves the saved slide declaration.');
  report.authorSnapshot={before:initial,afterSave:saved,after:await authorTree(root)};assert.deepEqual(report.authorSnapshot.after,saved);
  assert.deepEqual(report.errors,[]); assert.ok(report.dialogs.every(dialog=>dialog.type==='confirm'));
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
