// Real browser Scene2D v2 independent instances through the real HTTP editor and Chrome pointer/keyboard input.
// Run: VIENTO_SCENE_INSTANCES_OUTPUT=/empty/evidence/path node scripts/tests/scene-instances-smoke.mjs [chromium]
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { registerWorkspace } from '../lib/workspace.mjs';
import { importMediaAsset } from '../lib/media-assets.mjs';
import { getProjectionTemplates, lockProjectionTemplate } from '../../engine/object-projection.mjs';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.env.VIENTO_SCENE_INSTANCES_OUTPUT || path.join(os.tmpdir(), `viento-scene-instances-evidence-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_SCENE_INSTANCES_OUTPUT directory; prior evidence is immutable.');
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], errors: [], svgRequests: [], limitations: [
  'HTTP editor and real Chrome canvas only; packaged Tauri IPC and Android were not exercised.',
  'Layout edits exercise static positions only. No Godot tool, runtime movement, audio, or gameplay was used.',
] };
let socket, captureFailure;
const wait = async (check, label, milliseconds = 45000) => {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) { if (await check()) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
};
const json = value => JSON.stringify(value, null, 2) + '\n';
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-instances-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'workspace'), template = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank');
  const write = async (relative, content) => { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); };
  for (const name of ['documents', 'templates', 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(root, name), { recursive: true });
  await write('workspace.json', json({ format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Scene layout smoke', createdAt: 0,
    ...WORKSPACE_LAYOUT, documentTypes: template.documentTypes }));
  for (const [name, content] of Object.entries(template.templates)) await write(`templates/${name}`, content);
  await registerWorkspace(root);
  const execute = createWorldCommandService(root);
  const create = async (command, sourcePath, content) => {
    const view = await readWorldProjection(root), request = { command, mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
      actorRef: { kind: 'tool', id: 'scene-layout-smoke' }, objectId: randomUUID(), documentType: 'document', sourcePath, content };
    await execute(request); return request;
  };
  const core = await create('object.create', 'documents/core.md', '\uFEFF# Traveler / 旅人\r\n\r\n故事属于原 OC。  \r\n');
  const images = [];
  for (const color of ['#44aaee', '#ee6644']) {
    const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><script>fetch('http://127.0.0.1:9/viento-preview-script');top.__sceneSvgExecuted=true;</script><image href="http://127.0.0.1:9/viento-preview-external.png" width="1" height="1"/><rect width="32" height="32" fill="${color}"/></svg>`);
    const imported = await importMediaAsset(root, Readable.from([bytes]), `${color.slice(1)}.svg`); images.push(imported.asset);
  }
  const variants = [];
  for (const [index, suffix] of ['rpg-player', 'rpg-npc'].entries()) {
    const selected = getProjectionTemplates().find(item => item.id.endsWith(`.${suffix}`));
    const declaration = { format: 'viento-object-projection', schemaVersion: 1, title: index ? 'Traveler · NPC' : 'Traveler · Player', sourceObjectId: core.objectId,
      template: await lockProjectionTemplate(selected, { digest: buildHash }),
      configuration: { ...Object.fromEntries(selected.fields.map(field => [field.id, field.default])), image: images[0].id, speed: index ? 0 : 180 } };
    variants.push(await create('projection.create', `documents/projections/${suffix}.json`, json(declaration)));
  }
  const declaration = { format: 'viento-scene2d', schemaVersion: 1, title: 'A · inherited and overridden', viewport: [640, 480], background: '#101827', actors: [
    { objectId: variants[0].objectId, position: [160, 200], useProjectionDefaults: true },
    { objectId: variants[1].objectId, position: [380, 200], useProjectionDefaults: true, size: [120, 60], imageResourceId: images[1].id },
  ] };
  const scene = await create('scene.create', 'documents/scenes/a.json', '\uFEFF' + json(declaration).replaceAll('\n', '\r\n'));
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root, XDG_CACHE_HOME: path.join(temporary, 'cache') };
  delete env.VIENTO_GODOT_BIN; delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
  const initial = await sourceTree(root), base = await serve(t, appRoot, env);
  const state = async () => { const response = await fetch(`${base}/api/project-build`); assert.equal(response.status, 200); const body = await response.json(); return body.data || body; };
  assert.equal((await state()).available, false); assert.equal((await state()).job, null);
  const profile = path.join(temporary, 'chrome'); await fs.mkdir(profile);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; } });
  let port;
  await wait(async () => { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return !!port; } catch { return false; } }, 'Chrome');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const pending = new Map(); let sequence = 0, confirmAccept = false;
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.id) {
    const request = pending.get(value.id); pending.delete(value.id); value.error ? request?.reject(new Error(value.error.message)) : request?.resolve(value.result);
  } else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
    else if (value.method === 'Page.javascriptDialogOpening') { report.confirmations ||= []; report.confirmations.push(value.params.message); void call('Page.handleJavaScriptDialog', { accept: confirmAccept }); }
    else if (value.method === 'Network.requestWillBeSent' && value.params.request.url.includes('127.0.0.1:9/viento-preview-')) report.svgRequests.push(value.params.request.url); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value, event = 'input') => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === false && !document.querySelector(${JSON.stringify(selector)}).hidden`), `${selector} enabled`);
  const screenshot = async name => { const value = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(value.data, 'base64')); };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({ text: document.body.innerText, captures: window.__sceneCaptures, html: document.querySelector('#sceneLayoutDialog')?.innerHTML })`); report.serviceFailure = await state(); };
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable && document.querySelector('#projectBuildBtn')?.hidden === false`), 'preview-capable editor');
  // Capture public snapshots to verify the saved preview changes only after Apply.
  await evaluate(`(() => { const original = window.fetch.bind(window); window.__sceneCaptures = []; window.fetch = async (input, init) => {
    const response = await original(input, init); const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/scene-preview') && init?.method === 'POST') {
      const body = await response.clone().json(); window.__sceneCaptures.push(body.data || body);
    }
    if (url.includes('/api/project-build') && !init?.method && window.__holdNextLayoutBuildRefresh) {
      window.__holdNextLayoutBuildRefresh = false; window.__layoutBuildRefreshHeld = true; await new Promise(resolve => { window.__releaseLayoutBuildRefresh = resolve; });
    } return response;
  }; })()`);

  const latest = () => evaluate('window.__sceneCaptures.at(-1)');
  const readScene = async () => JSON.parse((await fs.readFile(path.join(root, scene.sourcePath), 'utf8')).replace(/^\uFEFF/, ''));
  const readPositions = () => evaluate(`['sceneLayoutX', 'sceneLayoutY'].map(id => Number(document.getElementById(id).value))`);
  const instanceIds = () => evaluate(`Array.from(document.querySelectorAll('[id^="sceneActor"][id$="Instance"]'), input => input.value)`);
  const waitScene = async () => { await wait(async () => (await latest())?.scene?.objectId === scene.objectId && (await latest())?.ok, 'saved scene capture'); await enabled('#scenePreviewLayoutEdit'); };
  const openLayout = async () => { await enabled('#scenePreviewLayoutEdit'); await click('#scenePreviewLayoutEdit');
    await wait(() => evaluate(`document.querySelector('#sceneLayoutDialog')?.open && document.querySelector('#sceneLayoutDialog').getAttribute('aria-busy') !== 'true'`), 'layout editor open'); };
  const selectInstance = async id => { await click(`#sceneLayoutObjects button[data-actor-id="${id}"]`); await enabled('#sceneLayoutX'); };
  const pointer = async (selector, position, delta = [0, 0]) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`);
    const point = await evaluate(`(async () => { const canvas = document.querySelector(${JSON.stringify(selector)}), b = canvas.getBoundingClientRect();
      const { fitSceneView, sceneToCanvas } = await import('/web/modules/app-scene-preview-canvas.js');
      const [x, y] = sceneToCanvas(fitSceneView([640, 480], b.width, b.height), ...${JSON.stringify(position)}); return { x: b.left + x, y: b.top + y }; })()`);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...point });
    if (delta.some(Boolean)) {
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: point.x + delta[0] / 2, y: point.y + delta[1] / 2 });
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: point.x + delta[0], y: point.y + delta[1] });
    }
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, x: point.x + delta[0], y: point.y + delta[1] });
  };
  await click('#projectBuildBtn'); await enabled('#projectBuildScene'); await fill('#projectBuildScene', scene.objectId, 'change');
  await click('#projectBuildTabPreview'); await waitScene(); assert.equal((await latest()).schemaVersion, 1);
  await enabled('#scenePreviewEdit'); await click('#scenePreviewEdit'); await enabled('#sceneCreateCheck');
  assert.deepEqual(await readScene(), declaration); assert.deepEqual(await instanceIds(), []);
  await enabled('#sceneCreateEnableInstances'); await click('#sceneCreateEnableInstances');
  assert.deepEqual(await instanceIds(), variants.map(value => value.objectId));
  await click('#sceneActor0Duplicate');
  const ids = await instanceIds(), cloneId = ids[1];
  assert.equal(ids.length, 3); assert.equal(new Set(ids).size, 3); assert.notEqual(cloneId, variants[0].objectId);
  await fill('#sceneActor1position0', '320'); await fill('#sceneActor1position1', '320'); await click('#sceneActor1Up');
  assert.deepEqual(await instanceIds(), [cloneId, variants[0].objectId, variants[1].objectId]);
  assert.equal(await evaluate(`document.querySelector('#sceneActor0Object').value`), variants[0].objectId);
  await click('#sceneCreateCheck'); await enabled('#sceneCreateSave');
  const checked = await evaluate(`document.querySelector('#sceneCreateSource').textContent`);
  const checkedScene = JSON.parse(checked.replace(/^\uFEFF/, ''));
  assert.equal(checkedScene.schemaVersion, 2); assert.equal(checkedScene.actors.length, 3);
  assert.deepEqual(checkedScene.actors.map(actor => actor.instanceId), await instanceIds());
  assert.deepEqual(await sourceTree(root), initial, 'upgrade/duplicate/reorder/check do not write before save');
  await screenshot('instances-upgrade-check-zh.png');
  for (const language of ['en', 'ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    if (language === 'ja') await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    assert.deepEqual(await instanceIds(), checkedScene.actors.map(actor => actor.instanceId));
    assert.equal(await evaluate(`document.querySelector('#sceneCreateDialog').scrollWidth <= document.querySelector('#sceneCreateDialog').clientWidth`), true);
    await evaluate(`document.querySelector('#sceneActor0Instance').scrollIntoView({ block: 'center' })`);
    await screenshot(`instances-${language}.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await click('#sceneCreateSave'); await wait(async () => JSON.stringify(await readScene()) === JSON.stringify(checkedScene), 'upgraded scene saved');
  await enabled('#sceneCreateClose'); await click('#sceneCreateClose'); await wait(() => evaluate(`!document.querySelector('#sceneCreateDialog').open`), 'return after save');
  await wait(async () => (await latest())?.schemaVersion === 2 && (await latest())?.actors?.length === 3, 'v2 preview refresh');
  assert.equal(checked[0], '\uFEFF'); assert.ok(checked.includes('\r\n')); assert.ok(!checked.replaceAll('\r\n', '').includes('\n'));
  const upgradedTree = await sourceTree(root);
  assert.deepEqual(Object.keys(upgradedTree).filter(file => initial[file] !== upgradedTree[file]), [scene.sourcePath]);
  report.steps.push('Existing v1 opens without conversion. Explicit upgrade seeds stable IDs, Duplicate creates a new ID for the same definition, and reorder retains all IDs. Preview is read-only; Save preserves BOM/CRLF and changes only the scene source.');
  report.steps.push('English/Japanese language switches retain the checked instance IDs and draft; the Japanese form fits a real 390px viewport.');

  await pointer('#scenePreviewCanvas', [320, 320]);
  await wait(() => evaluate(`document.querySelector('#scenePreviewObjects button[data-actor-id="${cloneId}"]')?.getAttribute('aria-pressed') === 'true'`), 'pointer selects cloned instance');
  await screenshot('instances-preview-selected-zh.png');
  await click('#scenePreviewProperties button[aria-label="查看 位置（中心） 的来源"]');
  await wait(() => evaluate(`document.activeElement.id === 'docSourceEditor' && document.querySelector('#docEditStatus').textContent.includes('已定位来源字段')`), 'exact instance source focus');
  const selected = await evaluate(`(() => { const e = document.querySelector('#docSourceEditor'); return { start: e.selectionStart, end: e.selectionEnd, text: e.value.slice(e.selectionStart, e.selectionEnd), status: document.querySelector('#docEditStatus').textContent }; })()`);
  assert.deepEqual(JSON.parse(selected.text), [320, 320]); assert.ok(selected.status.includes('/actors/0/position'));
  report.sourceSelection = selected; await screenshot('instances-source-position-zh.png');
  assert.deepEqual(await sourceTree(root), upgradedTree);
  report.steps.push('A real canvas click selects the cloned instance, and its position source link focuses the actual editor and selects /actors/0/position after reorder, with BOM/CRLF preserved on disk.');

  await click('#projectBuildBtn'); await waitScene(); await openLayout(); await selectInstance(cloneId);
  assert.deepEqual(await readPositions(), [320, 320]);
  await pointer('#sceneLayoutCanvas', [320, 320], [36, 24]); const moved = await readPositions();
  assert.ok(moved[0] > 320 && moved[1] > 320); assert.deepEqual(await sourceTree(root), upgradedTree);
  await enabled('#sceneLayoutUndo'); await click('#sceneLayoutUndo'); assert.deepEqual(await readPositions(), [320, 320]);
  await enabled('#sceneLayoutRedo'); await click('#sceneLayoutRedo'); assert.deepEqual(await readPositions(), moved);
  await selectInstance(variants[0].objectId); assert.deepEqual(await readPositions(), [160, 200]);
  await selectInstance(cloneId); assert.deepEqual(await readPositions(), moved);
  await fill('#sceneLayoutX', '350', 'change'); await fill('#sceneLayoutY', '300', 'change');
  await click('#sceneLayoutCheck'); await enabled('#sceneLayoutSave');
  const layoutChecked = await evaluate(`document.querySelector('#sceneLayoutSource').textContent`), layoutScene = JSON.parse(layoutChecked.replace(/^\uFEFF/, ''));
  assert.deepEqual(layoutScene.actors.map(actor => actor.instanceId), checkedScene.actors.map(actor => actor.instanceId));
  assert.deepEqual(layoutScene.actors[0].position, [350, 300]); assert.deepEqual(layoutScene.actors[1], checkedScene.actors[1]);
  await click('#sceneLayoutSave'); await wait(async () => (await fs.readFile(path.join(root, scene.sourcePath), 'utf8')) === layoutChecked, 'instance layout saved');
  await enabled('#sceneLayoutClose'); await click('#sceneLayoutClose');
  await wait(async () => (await latest())?.actors?.find(actor => actor.instanceId === cloneId)?.position?.[0] === 350, 'saved instance preview');
  await screenshot('instances-layout-saved-zh.png');
  await openLayout(); await selectInstance(cloneId); assert.deepEqual(await readPositions(), [350, 300]);
  await selectInstance(variants[0].objectId); assert.deepEqual(await readPositions(), [160, 200]);
  report.steps.push('Real pointer dragging, Undo/Redo, coordinate edits and save operate on the selected instance only. The other instance of the same definition remains at [160,200]; reopening preserves both independent positions and IDs.');

  await selectInstance(cloneId); await fill('#sceneLayoutX', '375', 'change'); await click('#sceneLayoutCheck'); await enabled('#sceneLayoutSave');
  const external = layoutChecked.replace('A · inherited and overridden', 'A · external revision'); await write(scene.sourcePath, external);
  await click('#sceneLayoutSave'); await wait(() => evaluate(`document.querySelector('#sceneLayoutSave').disabled && document.querySelector('#sceneLayoutDialog').getAttribute('aria-busy') !== 'true'`), 'conflict refused');
  assert.equal(await fs.readFile(path.join(root, scene.sourcePath), 'utf8'), external); assert.deepEqual(await readPositions(), [375, 300]);
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').dataset.dirty`), 'true');
  report.conflict = await evaluate(`document.querySelector('#sceneLayoutMessage').textContent`);
  await screenshot('instances-conflict-keeps-draft-zh.png');
  confirmAccept = true; await click('#sceneLayoutCancel'); await wait(() => evaluate(`!document.querySelector('#sceneLayoutDialog').open`), 'discard conflict draft');
  await write(scene.sourcePath, layoutChecked);
  assert.equal((await state()).job, null); assert.deepEqual(report.errors, []); assert.deepEqual(report.svgRequests, []);
  report.steps.push('An external revision between Check and Apply refuses the stale save without overwriting disk, and keeps the selected instance draft for recovery. The entire UI workflow never launches a build job.');
  report.created = { coreId: core.objectId, projectionIds: variants.map(value => value.objectId), imageIds: images.map(value => value.id), sceneId: scene.objectId, instanceIds: checkedScene.actors.map(actor => actor.instanceId) };
  report.authorFiles = await sourceTree(root); report.captures = await evaluate('window.__sceneCaptures'); report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  try { await captureFailure?.(); } catch (captureError) { report.captureFailure = captureError.message; }
} finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), json(report));
  console.log(JSON.stringify({ ok: report.ok, steps: report.steps, limitations: report.limitations, failure: report.failure, output }, null, 2));
}
