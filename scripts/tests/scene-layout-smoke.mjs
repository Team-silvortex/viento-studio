// Real browser Scene2D layout editing through the real HTTP editor and Chrome pointer/keyboard input.
// Run: VIENTO_SCENE_LAYOUT_OUTPUT=/empty/evidence/path node scripts/tests/scene-layout-smoke.mjs [chromium]
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
const output = path.resolve(process.env.VIENTO_SCENE_LAYOUT_OUTPUT || path.join(os.tmpdir(), `viento-scene-layout-evidence-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_SCENE_LAYOUT_OUTPUT directory; prior evidence is immutable.');
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-layout-browser-'));
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
  const key = async (name, code = name) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, ...(name === 'Escape' ? { windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 } : {}) });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, ...(name === 'Escape' ? { windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 } : {}) });
  };
  const beforeUnload = () => evaluate(`(() => { const event = new Event('beforeunload', { cancelable: true }); const allowed = window.dispatchEvent(event); return { allowed, prevented: event.defaultPrevented }; })()`);
  const readPositions = () => evaluate(`['sceneLayoutX', 'sceneLayoutY'].map(id => Number(document.getElementById(id).value))`);
  const colorBounds = (selector, color) => evaluate(`(() => { const canvas = document.querySelector(${JSON.stringify(selector)}); if (!canvas?.width || !canvas.height) return null;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, rgb = ${JSON.stringify(color)}, result = { x: canvas.width, y: canvas.height, right: -1, bottom: -1, count: 0 };
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) { const i = (y * canvas.width + x) * 4;
      if (data[i + 3] > 250 && rgb.every((v, j) => Math.abs(v - data[i + j]) < 2)) { result.x = Math.min(result.x, x); result.y = Math.min(result.y, y); result.right = Math.max(result.right, x); result.bottom = Math.max(result.bottom, y); result.count++; }
    } return result.count ? { ...result, width: result.right - result.x + 1, height: result.bottom - result.y + 1 } : null; })()`);
  const blue = [68, 170, 238], orange = [238, 102, 68];
  const layoutColors = () => Promise.all([colorBounds('#sceneLayoutCanvas', blue), colorBounds('#sceneLayoutCanvas', orange)]);
  const waitScene = async () => { await wait(async () => (await latest())?.scene?.objectId === scene.objectId && (await latest())?.ok, 'saved Scene2D capture'); await enabled('#scenePreviewLayoutEdit'); };
  const openLayout = async () => { await enabled('#scenePreviewLayoutEdit'); await click('#scenePreviewLayoutEdit');
    await wait(() => evaluate(`document.querySelector('#sceneLayoutDialog')?.open && document.querySelector('#sceneLayoutDialog').getAttribute('aria-busy') !== 'true'`), 'layout editor open');
    await wait(async () => (await layoutColors()).every(Boolean), 'layout images ready');
  };
  const selectPlayer = async () => { await click(`#sceneLayoutObjects button[data-object-id="${variants[0].objectId}"]`); await enabled('#sceneLayoutX'); };
  const dragPlayer = async (dx, dy, cancel = false) => {
    await evaluate(`document.querySelector('#sceneLayoutCanvas').scrollIntoView({ block: 'center' })`);
    const bounds = await colorBounds('#sceneLayoutCanvas', blue); assert.ok(bounds, 'player pixels exist before drag');
    const point = await evaluate(`(() => { const c = document.querySelector('#sceneLayoutCanvas'), b = c.getBoundingClientRect(); return { x: b.left + ${(bounds.x + bounds.right) / 2} / c.width * b.width, y: b.top + ${(bounds.y + bounds.bottom) / 2} / c.height * b.height }; })()`);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...point });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: point.x + dx / 2, y: point.y + dy / 2 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: point.x + dx, y: point.y + dy });
    if (cancel) await key('Escape');
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, x: point.x + dx, y: point.y + dy });
    return { from: point, dx, dy, positions: await readPositions() };
  };
  await click('#projectBuildBtn'); await enabled('#projectBuildScene'); await fill('#projectBuildScene', scene.objectId, 'change');
  await enabled('#projectBuildPlan'); await click('#projectBuildPlan');
  await wait(async () => { const value = await state(); return value.job?.kind === 'plan' && value.job?.status === 'succeeded'; }, 'initial build plan');
  await wait(() => evaluate(`!document.querySelector('#projectBuildPlanSummary').hidden`), 'initial plan displayed');
  report.initialPlan = (await state()).job;
  await click('#projectBuildTabPreview'); await waitScene();
  await wait(async () => Boolean(await colorBounds('#scenePreviewCanvas', blue)), 'read-only scene preview');
  assert.deepEqual((await latest()).actors[0].position, [160, 200]);
  await openLayout();
  assert.deepEqual(await beforeUnload(), { allowed: true, prevented: false }, 'an unchanged layout does not block leaving');
  const move = await dragPlayer(54, 36); report.drag = move;
  assert.ok(move.positions[0] > 175 && move.positions[1] > 210, 'a real object drag moves the scene position');
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').dataset.dirty`), 'true');
  assert.deepEqual(await beforeUnload(), { allowed: false, prevented: true }, 'a layout draft blocks accidental page unload');
  assert.deepEqual(await sourceTree(root), initial, 'drag cannot write author files');
  const dragged = await readPositions();
  await enabled('#sceneLayoutUndo'); await click('#sceneLayoutUndo'); assert.deepEqual(await readPositions(), [160, 200]);
  assert.deepEqual(await beforeUnload(), { allowed: true, prevented: false }, 'undoing back to the saved layout clears unload protection');
  await enabled('#sceneLayoutRedo'); await click('#sceneLayoutRedo'); assert.deepEqual(await readPositions(), dragged);
  await dragPlayer(31, 21, true); assert.deepEqual(await readPositions(), dragged, 'Escape during drag rolls back only the temporary move');
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').open`), true);
  await click('#sceneLayoutPan'); const panBefore = await colorBounds('#sceneLayoutCanvas', blue); await dragPlayer(20, 10);
  const panAfter = await colorBounds('#sceneLayoutCanvas', blue); assert.deepEqual(await readPositions(), dragged, 'pan mode never moves an actor');
  assert.ok(Math.abs(panAfter.x - panBefore.x - 20) <= 2); assert.ok(Math.abs(panAfter.y - panBefore.y - 10) <= 2);
  await click('#sceneLayoutFit'); await click('#sceneLayoutMove');
  await fill('#sceneLayoutX', '241', 'change'); await fill('#sceneLayoutY', '177', 'change'); assert.deepEqual(await readPositions(), [241, 177]);
  await click('#sceneLayoutSnap'); report.snappedDrag = await dragPlayer(23, 19);
  const snapped = await readPositions(); assert.ok(snapped.every(value => Math.abs(value / 32 - Math.round(value / 32)) < 1e-6), 'drag positions snap to 32 world units');
  await click('#sceneLayoutUndo'); assert.deepEqual(await readPositions(), [241, 177]);
  await click('#sceneLayoutRedo'); assert.deepEqual(await readPositions(), snapped);
  await screenshot('layout-drag-snap-zh.png');
  assert.deepEqual(await sourceTree(root), initial);
  report.steps.push('A real pointer drag changes the selected actor center, while coordinate fields and 32-unit snapping share Undo/Redo history. Escape cancels an in-progress drag and Pan moves only the camera. Every action remains a local draft; all author files are byte-identical.');

  const confirmsBefore = () => report.confirmations?.length || 0;
  confirmAccept = false; let confirmations = confirmsBefore(); await click('#sceneLayoutCancel');
  await wait(() => confirmsBefore() > confirmations, 'cancel confirmation');
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').open`), true); assert.deepEqual(await readPositions(), snapped);
  confirmations = confirmsBefore(); await key('Escape'); await wait(() => confirmsBefore() > confirmations, 'Escape confirmation');
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').open`), true); assert.deepEqual(await readPositions(), snapped);
  confirmations = confirmsBefore(); await click('#sceneLayoutClose'); await wait(() => confirmsBefore() > confirmations, 'return confirmation');
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').open`), true);
  confirmAccept = true; await click('#sceneLayoutCancel'); await wait(() => evaluate(`!document.querySelector('#sceneLayoutDialog').open`), 'discard layout draft');
  assert.deepEqual(await sourceTree(root), initial); assert.deepEqual((await latest()).actors[0].position, [160, 200]);
  report.steps.push('Cancel, Escape, and Return each require a decision before discarding a changed layout. Rejecting keeps the same draft; accepting closes it without writing any source or changing the saved preview.');

  await openLayout(); await selectPlayer(); await fill('#sceneLayoutX', '232', 'change'); await fill('#sceneLayoutY', '224', 'change');
  await enabled('#sceneLayoutCheck'); await click('#sceneLayoutCheck'); await enabled('#sceneLayoutSave');
  const expectedText = await evaluate(`document.querySelector('#sceneLayoutSource').textContent`);
  assert.deepEqual(JSON.parse(expectedText.replace(/^\uFEFF/, '')), { ...declaration, actors: declaration.actors.map((actor, index) => index ? actor : { ...actor, position: [232, 224] }) });
  assert.deepEqual(await sourceTree(root), initial, 'checking proposed source is read-only');
  await screenshot('layout-check-zh.png');
  for (const language of ['en', 'ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    if (language === 'ja') await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.querySelector('#sceneLayoutDialog').scrollTop = 0`);
    await screenshot(`layout-${language === 'ja' ? 'narrow-' : ''}${language}.png`);
    assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').scrollWidth <= document.querySelector('#sceneLayoutDialog').clientWidth`), true, `${language} layout fits viewport`);
    assert.deepEqual(await readPositions(), [232, 224]);
    const labels = await evaluate(`['sceneLayoutClose', 'sceneLayoutCheck', 'sceneLayoutSave'].map(id => document.getElementById(id).textContent.trim())`);
    assert.ok(labels.every(label => label.length && !/[\u4e00-\u9fff]/u.test(language === 'en' ? label : '')), 'English UI labels are translated');
    assert.equal(await evaluate(`document.querySelector('#sceneLayoutSave').disabled`), false);
    report[`${language}Labels`] = labels;
    if (language === 'ja') { await evaluate(`document.querySelector('#sceneLayoutCanvas').scrollIntoView({ block: 'center' })`); await screenshot('layout-canvas-narrow-ja.png'); }
  }
  report.steps.push('The proposed source changes only one actor position. English and Japanese labels preserve the checked draft, and the Japanese layout fits a real 390px viewport without horizontal overflow.');
  await evaluate('window.__holdNextLayoutBuildRefresh = true');
  await click('#sceneLayoutSave');
  await wait(() => evaluate('window.__layoutBuildRefreshHeld === true'), 'saved layout awaits build state refresh');
  // The source is already saved, but its completion refresh is still in flight.
  // Switching camera mode updates the real dialog status without changing the draft.
  await click('#sceneLayoutPan');
  report.busyUnloadState = await evaluate(`({ dirty: document.querySelector('#sceneLayoutDialog').dataset.dirty, busy: document.querySelector('#sceneLayoutDialog').getAttribute('aria-busy') })`);
  assert.deepEqual(report.busyUnloadState, { dirty: 'false', busy: 'true' });
  assert.deepEqual(await beforeUnload(), { allowed: false, prevented: true }, 'pending completion alone blocks leaving even after dirty clears');
  await evaluate('window.__releaseLayoutBuildRefresh()');
  await wait(async () => (await fs.readFile(path.join(root, scene.sourcePath), 'utf8')) === expectedText, 'saved layout source');
  await wait(() => evaluate(`document.querySelector('#sceneLayoutDialog').dataset.dirty === 'false' && document.querySelector('#sceneLayoutClose').disabled === false`), 'layout saved state');
  assert.deepEqual(await beforeUnload(), { allowed: true, prevented: false }, 'a saved idle layout does not block leaving');
  const savedText = await fs.readFile(path.join(root, scene.sourcePath), 'utf8'); assert.equal(savedText[0], '\uFEFF'); assert.ok(savedText.includes('\r\n')); assert.equal(savedText.replaceAll('\r\n', '').includes('\n'), false);
  const savedTree = await sourceTree(root); assert.deepEqual(Object.keys(savedTree).filter(file => savedTree[file] !== initial[file]).sort(), [scene.sourcePath]);
  const savedWorld = await readWorldProjection(root); assert.ok(savedWorld.objects.some(value => value.id === scene.objectId && value.documentRefs?.some(ref => ref.sourcePath === scene.sourcePath)));
  await screenshot('layout-saved-narrow-ja.png');
  await click('#sceneLayoutClose'); await wait(() => evaluate(`!document.querySelector('#sceneLayoutDialog').open`), 'return after save');
  await wait(async () => (await latest())?.actors?.[0]?.position?.[0] === 232 && (await latest())?.actors?.[0]?.position?.[1] === 224, 'saved preview automatically refreshed');
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await wait(async () => Boolean(await colorBounds('#scenePreviewCanvas', blue)), 'saved preview pixels');
  await screenshot('layout-saved-preview-zh.png');
  await click('#projectBuildTabBuild');
  assert.equal(await evaluate(`document.querySelector('#projectBuildPlanSummary').hidden`), true, 'old plan removed after layout save');
  assert.equal((await state()).job.id, report.initialPlan.id, 'layout does not silently create a new build job');
  report.steps.push('Apply saves the exact checked source, preserves Scene UUID, BOM/CRLF, OC/projection documents, inherited fields, and resource bytes, then refreshes the saved preview. The prior build plan is invalidated without launching a build.');

  await click('#projectBuildTabPreview'); await waitScene(); await openLayout(); await selectPlayer();
  await fill('#sceneLayoutX', '280', 'change'); await fill('#sceneLayoutY', '256', 'change');
  await click('#sceneLayoutCheck'); await enabled('#sceneLayoutSave');
  const externalText = savedText.replace('A · inherited and overridden', 'A · externally changed');
  assert.notEqual(externalText, savedText); await write(scene.sourcePath, externalText);
  await click('#sceneLayoutSave');
  await wait(() => evaluate(`document.querySelector('#sceneLayoutSave').disabled && document.querySelector('#sceneLayoutDialog').getAttribute('aria-busy') !== 'true'`), 'stale layout refuses save');
  assert.equal(await fs.readFile(path.join(root, scene.sourcePath), 'utf8'), externalText); assert.deepEqual(await readPositions(), [280, 256]);
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').dataset.dirty`), 'true');
  report.conflictMessage = await evaluate(`document.querySelector('#sceneLayoutMessage').textContent`);
  await screenshot('layout-conflict-draft-zh.png');
  confirmAccept = false; confirmations = confirmsBefore(); await enabled('#sceneLayoutReload'); await click('#sceneLayoutReload');
  await wait(() => confirmsBefore() > confirmations, 'reload confirms discard'); assert.deepEqual(await readPositions(), [280, 256]);
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').open`), true);
  confirmAccept = true; await click('#sceneLayoutReload'); await wait(() => evaluate(`!document.querySelector('#sceneLayoutDialog').open`), 'reload discards only local draft');
  await wait(async () => (await latest())?.scene?.title === 'A · externally changed', 'external content appears in refreshed preview');
  assert.deepEqual((await latest()).actors[0].position, [232, 224]); assert.equal(await fs.readFile(path.join(root, scene.sourcePath), 'utf8'), externalText);
  const finalTree = await sourceTree(root); assert.deepEqual(Object.keys(finalTree).filter(file => finalTree[file] !== initial[file]).sort(), [scene.sourcePath]);
  report.steps.push('An external scene edit between Check and Apply causes a conflict. The file is never overwritten, the local layout draft stays available, and Reload asks before discarding it and returning to the newer saved scene.');
  await waitScene(); await openLayout(); await selectPlayer();
  await fill('#sceneLayoutX', '260', 'change'); await fill('#sceneLayoutY', '240', 'change'); await click('#sceneLayoutCheck'); await enabled('#sceneLayoutSave');
  const recoveryText = await evaluate(`document.querySelector('#sceneLayoutSource').textContent`);
  await evaluate(`(() => { const previous = window.fetch.bind(window); window.__layoutApplyResponsesDropped = 0; window.fetch = async (input, init) => {
    const response = await previous(input, init), url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/world/commands') && init?.method === 'POST' && JSON.parse(init.body).command === 'scene.update' && JSON.parse(init.body).mode === 'apply' && window.__layoutApplyResponsesDropped === 0) {
      await response.clone().text(); window.__layoutApplyResponsesDropped++; throw new TypeError('Injected lost scene layout apply response');
    } return response;
  }; })()`);
  await click('#sceneLayoutSave'); await enabled('#sceneLayoutVerify');
  assert.equal(await fs.readFile(path.join(root, scene.sourcePath), 'utf8'), recoveryText);
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutSave').disabled`), true); assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').dataset.dirty`), 'true');
  assert.deepEqual(await readPositions(), [260, 240]); const beforeVerify = await sourceTree(root);
  await screenshot('layout-unknown-save-zh.png'); await click('#sceneLayoutVerify');
  await wait(() => evaluate(`document.querySelector('#sceneLayoutDialog').dataset.dirty === 'false' && document.querySelector('#sceneLayoutClose').disabled === false`), 'saved source verification');
  assert.deepEqual(await sourceTree(root), beforeVerify, 'Verify never writes or resubmits the saved command');
  assert.equal(await evaluate('window.__layoutApplyResponsesDropped'), 1);
  await click('#sceneLayoutClose'); await wait(async () => (await latest())?.actors?.[0]?.position?.[0] === 260 && (await latest())?.actors?.[0]?.position?.[1] === 240, 'verified save refreshes preview');
  report.steps.push('When the server saves successfully but the browser loses the Apply response, the draft remains and repeat Save is blocked. Verify reads the current source, recognizes the exact checked result without any further write, and refreshes the saved preview.');
  assert.deepEqual(await beforeUnload(), { allowed: true, prevented: false }, 'closing a verified saved layout clears unload protection');
  report.steps.push('Cancelable beforeunload events are prevented while the layout is dirty and independently while its saved completion refresh is busy. An unchanged layout, undo to baseline, and completed or closed saves allow leaving. No page navigation is performed.');
  // Keep two real preview responses in flight across dialog disposal. A late
  // response from the first session must not approve or unlock the second one.
  const beforeLateReview = await sourceTree(root);
  await evaluate(`(() => { const previous = window.fetch.bind(window); window.__heldLayoutReviews = []; window.fetch = async (input, init) => {
    const response = await previous(input, init), url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/world/commands') && init?.method === 'POST') {
      const body = JSON.parse(init.body);
      if (body.command === 'scene.update' && body.mode === 'preview') {
        await response.clone().text();
        await new Promise(resolve => window.__heldLayoutReviews.push(resolve));
      }
    }
    return response;
  }; })()`);
  await openLayout(); await selectPlayer(); await fill('#sceneLayoutX', '281', 'change'); await click('#sceneLayoutCheck');
  await wait(() => evaluate('window.__heldLayoutReviews.length === 1'), 'first held review');
  await evaluate(`document.querySelector('#sceneLayoutDialog').close()`);
  await wait(() => evaluate(`!document.querySelector('#sceneLayoutDialog').open && document.querySelector('#sceneLayoutDialog').getAttribute('aria-busy') === 'false'`), 'closed review releases its session');
  await openLayout(); await selectPlayer(); await fill('#sceneLayoutX', '282', 'change'); await click('#sceneLayoutCheck');
  await wait(() => evaluate('window.__heldLayoutReviews.length === 2'), 'second held review');
  await evaluate('window.__heldLayoutReviews[0]()');
  await evaluate('new Promise(resolve => setTimeout(resolve, 100))');
  assert.deepEqual(await readPositions(), [282, 240], 'old response cannot change the new session');
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').getAttribute('aria-busy')`), 'true', 'old finally cannot unlock the new request');
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutSave').disabled`), true, 'old response cannot approve the new draft');
  assert.deepEqual(await beforeUnload(), { allowed: false, prevented: true });
  await evaluate('window.__heldLayoutReviews[1]()'); await enabled('#sceneLayoutSave');
  const newReviewed = JSON.parse((await evaluate(`document.querySelector('#sceneLayoutSource').textContent`)).replace(/^\uFEFF/, ''));
  assert.deepEqual(newReviewed.actors[0].position, [282, 240]);
  await screenshot('layout-late-review-isolated-zh.png');
  confirmAccept = true; await click('#sceneLayoutCancel');
  await wait(() => evaluate(`!document.querySelector('#sceneLayoutDialog').open`), 'discard second review');
  assert.deepEqual(await sourceTree(root), beforeLateReview, 'neither held review writes author files');
  report.steps.push('Two real preview responses are held across programmatic close and reopen. Releasing the old response cannot approve, change or unlock the new draft; only its own response enables Save, and both checks leave author files unchanged.');
  report.created = { coreId: core.objectId, projectionIds: variants.map(value => value.objectId), imageIds: images.map(value => value.id), sceneId: scene.objectId };
  report.authorFiles = await sourceTree(root); report.captures = await evaluate('window.__sceneCaptures');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.svgRequests, []); report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  try { await captureFailure?.(); } catch (captureError) { report.captureFailure = captureError.message; }
} finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), json(report));
  console.log(JSON.stringify({ ok: report.ok, steps: report.steps, limitations: report.limitations, failure: report.failure, output }, null, 2));
}
