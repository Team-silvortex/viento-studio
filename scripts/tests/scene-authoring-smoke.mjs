// Empty blank project → browser object + scene authoring → real Godot.
// Uses only a disposable workspace; existing evidence directories are never reused.
// Run: VIENTO_GODOT_BIN=/absolute/Godot node scripts/tests/scene-authoring-smoke.mjs [chromium]
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { randomUUID } from 'node:crypto';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';
import { canonicalJson } from '../../engine/world-projection.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const godot = process.env.VIENTO_GODOT_BIN;
if (!godot || !path.isAbsolute(godot)) throw new Error('Set VIENTO_GODOT_BIN to an absolute Godot executable.');
const output = path.resolve(process.env.VIENTO_SCENE_TEST_OUTPUT || path.join(os.tmpdir(), `viento-scene-evidence-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_SCENE_TEST_OUTPUT directory; prior evidence is immutable.');
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], jobs: [], errors: [], limitations: [
  'Source editor served over real HTTP; packaged Tauri IPC and Android were not exercised.',
  'Headless checks validate runtime logic only; this authoring smoke does not repeat graphical runtime preview.',
] };
let socket, captureFailure;
const wait = async (check, label, milliseconds = 45000) => {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) { if (await check()) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
};
async function sourceTree(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name), relative = path.relative(root, file);
    if (relative.startsWith('.viento/')) continue;
    result[relative] = buildHash(await fs.readFile(file));
  }
  return result;
}
try {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'workspace');
  const template = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank');
  for (const name of ['documents', 'templates', 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(root, name), { recursive: true });
  const manifest = { format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Scene authoring smoke', createdAt: 0,
    ...WORKSPACE_LAYOUT, documentTypes: template.documentTypes,
    projectTemplate: { packageId: template.packageId, version: template.version, digest: buildHash(canonicalJson(template)) } };
  await fs.writeFile(path.join(root, 'workspace.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const [name, content] of Object.entries(template.templates)) await fs.writeFile(path.join(root, 'templates', name), content);
  report.fixture = 'Empty workspace assembled from org.viento.blank catalogue; native library creation not exercised.';
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
    XDG_CACHE_HOME: path.join(temporary, 'cache'), VIENTO_GODOT_BIN: godot };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
  const initial = await sourceTree(root);
  const base = await serve(t, appRoot, env);
  const state = async () => { const response = await fetch(`${base}/api/project-build`); assert.equal(response.status, 200); const body = await response.json(); return body.data || body; };
  const complete = async (kind, previousId) => {
    let value;
    await wait(async () => { value = (await state()).job; return value?.kind === kind && value.id !== previousId && value.status !== 'running'; }, `${kind} completion`, 90000);
    report.jobs.push(value); return value;
  };
  const profile = path.join(temporary, 'chrome'); await fs.mkdir(profile);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; } });
  let port;
  await wait(async () => { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return !!port; } catch { return false; } }, 'Chrome');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const pending = new Map(); let sequence = 0;
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.id) { const request = pending.get(value.id); pending.delete(value.id); value.error ? request?.reject(new Error(value.error.message)) : request?.resolve(value.result); }
    else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value, event = 'input') => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === false`), `${selector} enabled`);
  const screenshot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(image.data, 'base64')); };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({ text: document.body.innerText, source: document.querySelector('#docSourceEditor')?.value })`); report.serviceFailure = await state(); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable && document.querySelector('#projectBuildBtn')?.hidden === false`), 'build-capable editor');
  const world = async () => { const response = await fetch(`${base}/api/world`); assert.equal(response.status, 200); const payload = await response.json(); return payload.data || payload; };
  assert.equal((await world()).objects.length, 0);
  await click('#worldBrowserBtn'); await enabled('#worldCreate'); await click('#worldCreate');
  const actorPath = 'documents/actors/traveler.md', actorContent = '# Traveler / 旅人 / 旅人\n\n背景：来自全新空白工程。\n';
  await fill('#worldCreatePath', actorPath); await fill('#worldCreateContent', actorContent);
  await click('#worldCreatePreview'); await enabled('#worldCreateApply'); await click('#worldCreateApply');
  await wait(async () => (await world()).objects.length === 1, 'actor registration');
  await enabled('#worldClose'); await click('#worldClose');
  const actor = (await world()).objects[0];
  assert.equal(actor.provenance.documentType, 'document');
  const imported = await fetch(`${base}/api/assets?name=traveler.svg`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await fs.readFile(path.join(appRoot, 'examples/scene2d/assets/traveler.svg')) });
  assert.equal(imported.status, 200, await imported.clone().text());
  const importedBody = await imported.json(), imageId = (importedBody.data || importedBody).asset.id;
  const beforeScene = await sourceTree(root);
  report.steps.push('Blank catalogue starts with no documents; browser creates and registers a generic document actor; HTTP imports its image.');

  await click('#projectBuildBtn'); await enabled('#projectBuildCreateScene'); await click('#projectBuildCreateScene');
  await enabled('#sceneCreateCheck');
  const scenePath = 'documents/scenes/first-scene.json';
  await fill('#sceneCreateName', 'First scene / 初始场景'); await fill('#sceneCreatePath', scenePath);
  await fill('#sceneActor0Object', actor.id, 'change'); await fill('#sceneActor0Image', imageId, 'change');
  await fill('#sceneActor0position0', '200'); await fill('#sceneActor0position1', '220');
  await fill('#sceneActor0size0', '80'); await fill('#sceneActor0size1', '80'); await fill('#sceneActor0Speed', '160');
  await fill('#sceneActor0Controls', 'arrows', 'change');
  await screenshot('scene-form-zh.png');
  await click('#sceneCreateCheck'); await enabled('#sceneCreateSave');
  assert.deepEqual(await sourceTree(root), beforeScene, 'Preview writes no author data.');
  await evaluate(`document.querySelector('#sceneCreatePreview').scrollIntoView({ block: 'center' })`);
  await screenshot('scene-preview-zh.png');

  await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('en')`);
  assert.equal(await evaluate(`document.querySelector('#sceneCreateName').value`), 'First scene / 初始场景');
  assert.match(await evaluate(`document.querySelector('#sceneCreateTitle').textContent`), /scene/i);
  await screenshot('scene-preview-en.png');
  await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('ja')`);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate(`document.querySelector('#sceneCreateDialog').scrollWidth <= document.querySelector('#sceneCreateDialog').clientWidth`), true);
  assert.match(await evaluate(`document.querySelector('#sceneCreateTitle').textContent`), /シーン/);
  await evaluate(`document.querySelector('#sceneCreatePreview').scrollIntoView({ block: 'center' })`);
  await screenshot('scene-preview-narrow-ja.png');
  report.steps.push('Scene form and actual JSON preview retain inputs across Chinese, English and Japanese; 390px dialog fits.');

  await fs.appendFile(path.join(root, actorPath), '\n外部修改：保持正文。\n');
  await click('#sceneCreateSave');
  await wait(() => evaluate(`document.querySelector('#sceneCreateDialog').getAttribute('aria-busy') !== 'true' && document.querySelector('#sceneCreateSave').disabled`), 'stale preview refusal');
  assert.equal(await evaluate(`document.querySelector('#sceneCreateName').value`), 'First scene / 初始场景');
  await assert.rejects(fs.access(path.join(root, scenePath)), { code: 'ENOENT' });
  await screenshot('scene-conflict-narrow-ja.png');
  await click('#sceneCreateRefresh'); await enabled('#sceneCreateCheck');
  await click('#sceneCreateCheck'); await enabled('#sceneCreateSave');
  const expectedContent = await evaluate(`document.querySelector('#sceneCreateSource').textContent`);
  await click('#sceneCreateSave');
  await wait(async () => (await world()).objects.length === 2, 'scene publication');
  await enabled('#sceneCreateClose'); await click('#sceneCreateClose');
  const projection = await world(), created = projection.objects.find(item => item.documentRefs[0].sourcePath === scenePath);
  assert.ok(created); assert.equal(created.provenance.documentType, 'document');
  const sceneText = await fs.readFile(path.join(root, scenePath), 'utf8');
  assert.deepEqual(JSON.parse(sceneText), JSON.parse(expectedContent));
  assert.ok(projection.relations.some(item => item.sourceObjectId === created.id && item.targetObjectId === actor.id));
  assert.ok(projection.resourceBindings.some(item => item.objectId === created.id && item.resourceId === imageId));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'workspace.json'), 'utf8')), manifest);
  await enabled('#projectBuildPlan');
  assert.equal(await evaluate(`document.querySelector('#projectBuildScene').value`), created.id);
  report.steps.push('Stale World revision refuses publication and preserves the form; refresh + preview creates JSON and dependency registration together, then selects the new scene.');

  await click('#projectBuildPlan');
  const planned = await complete('plan'); assert.equal(planned.status, 'succeeded', JSON.stringify(planned));
  await enabled('#projectBuildGenerate'); await click('#projectBuildGenerate');
  const built = await complete('build', planned.id); assert.equal(built.status, 'succeeded', JSON.stringify(built));
  await enabled('#projectBuildHeadless'); await click('#projectBuildHeadless');
  const ran = await complete('run', built.id); assert.equal(ran.status, 'succeeded', JSON.stringify(ran));
  assert.deepEqual(ran.events.map(event => event.event), ['ready', 'state', 'state', 'finished']);
  await screenshot('created-scene-runtime-ja.png');
  const afterRun = await sourceTree(root);
  for (const [file, hash] of Object.entries(beforeScene)) if (file !== actorPath) assert.equal(afterRun[file], hash, file);
  for (const [file, hash] of Object.entries(initial)) assert.equal(afterRun[file], hash, file);
  report.steps.push('Browser-created scene passes real Godot plan → build → headless runtime (ready, moving, idle, finished); existing metadata, image and project definition remain unchanged.');

  await call('Page.reload');
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor reopen');
  await click('#projectBuildBtn'); await enabled('#projectBuildPlan');
  assert.equal(await evaluate(`document.querySelector('#projectBuildScene').value`), created.id);
  assert.deepEqual(await sourceTree(root), afterRun);
  report.created = { objectId: created.id, actorId: actor.id, imageId, sourcePath: scenePath, sourceHash: buildHash(sceneText) };
  report.authorFiles = afterRun;
  report.steps.push('Reloading the editor discovers the same saved scene UUID and leaves all authoring bytes unchanged.');
  assert.deepEqual(report.errors, []); report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  try { await captureFailure?.(); } catch (captureError) { report.captureFailure = captureError.message; }
} finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, steps: report.steps, limitations: report.limitations, failure: report.failure, output }, null, 2));
}
