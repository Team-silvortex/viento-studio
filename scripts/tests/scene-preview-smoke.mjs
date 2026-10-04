// Real browser Scene2D authoring preview: no runtime tool and no persistent preview output.
// Run: VIENTO_SCENE_PREVIEW_OUTPUT=/empty/evidence/path node scripts/tests/scene-preview-smoke.mjs [chromium]
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
const output = path.resolve(process.env.VIENTO_SCENE_PREVIEW_OUTPUT || path.join(os.tmpdir(), `viento-scene-preview-evidence-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_SCENE_PREVIEW_OUTPUT directory; prior evidence is immutable.');
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], errors: [], svgRequests: [], limitations: [
  'HTTP editor and real Chrome canvas only; packaged Tauri IPC and Android were not exercised.',
  'This is a static authoring preview. No Godot tool, runtime movement, audio, or gameplay was used.',
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-preview-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'workspace'), template = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank');
  const write = async (relative, content) => { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); };
  for (const name of ['documents', 'templates', 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(root, name), { recursive: true });
  await write('workspace.json', json({ format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Scene preview smoke', createdAt: 0,
    ...WORKSPACE_LAYOUT, documentTypes: template.documentTypes }));
  for (const [name, content] of Object.entries(template.templates)) await write(`templates/${name}`, content);
  await registerWorkspace(root);
  const execute = createWorldCommandService(root);
  const create = async (command, sourcePath, content) => {
    const view = await readWorldProjection(root), request = { command, mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
      actorRef: { kind: 'tool', id: 'scene-preview-smoke' }, objectId: randomUUID(), documentType: 'document', sourcePath, content };
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
  const declaration = { format: 'viento-scene2d', schemaVersion: 1, title: 'A · 旅人😀 inherited and overridden', viewport: [640, 480], background: '#101827', actors: [
    { objectId: variants[0].objectId, position: [160, 200], useProjectionDefaults: true },
    { objectId: variants[1].objectId, position: [380, 200], useProjectionDefaults: true, size: [120, 60], imageResourceId: images[1].id },
  ] };
  const scene = await create('scene.create', 'documents/scenes/a.json', '\uFEFF' + json(declaration).replaceAll('\n', '\r\n'));
  const alternate = await create('scene.create', 'documents/scenes/b.json', json({ ...declaration, title: 'B · plain inherited shape',
    actors: [{ objectId: variants[0].objectId, position: [300, 200], useProjectionDefaults: true, imageResourceId: null, color: '#44ee99' }] }));
  const overlap = await create('scene.create', 'documents/scenes/overlap.json', json({ ...declaration, title: 'D · tint and draw order', actors: [
    { objectId: variants[0].objectId, position: [300, 200], useProjectionDefaults: true, color: '#808080' },
    { objectId: variants[1].objectId, position: [300, 200], useProjectionDefaults: true, size: [40, 40], imageResourceId: images[1].id },
  ] }));
  const invalid = await create('scene.create', 'documents/scenes/invalid.json', json({ ...declaration, title: 'C · invalid scene' }));
  await write(invalid.sourcePath, json({ ...declaration, title: 'C · invalid scene', viewport: [0, 480] }));
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
  const pending = new Map(); let sequence = 0;
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.id) {
    const request = pending.get(value.id); pending.delete(value.id); value.error ? request?.reject(new Error(value.error.message)) : request?.resolve(value.result);
  } else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
    else if (value.method === 'Network.requestWillBeSent' && value.params.request.url.includes('127.0.0.1:9/viento-preview-')) report.svgRequests.push(value.params.request.url); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value, event = 'input') => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === false && !document.querySelector(${JSON.stringify(selector)}).hidden`), `${selector} enabled`);
  const screenshot = async name => { const value = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(value.data, 'base64')); };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({ text: document.body.innerText, captures: window.__sceneCaptures, html: document.querySelector('#projectBuildPreviewPanel')?.innerHTML })`); report.serviceFailure = await state(); };
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable && document.querySelector('#projectBuildBtn')?.hidden === false`), 'preview-capable editor');
  // Observe actual public API responses, with an opt-in delayed delivery for the race check.
  await evaluate(`(() => { const original = window.fetch.bind(window); window.__sceneCaptures = []; window.fetch = async (input, init) => {
    const response = await original(input, init); const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/scene-preview') && init?.method === 'POST') {
      const body = await response.clone().json(); window.__sceneCaptures.push(body.data || body);
      if (window.__holdNextPreview) { window.__holdNextPreview = false; window.__heldPreview = true; await new Promise(resolve => { window.__releasePreview = resolve; }); }
    } return response;
  }; })()`);
  const latest = () => evaluate('window.__sceneCaptures.at(-1)');
  const select = async id => { await enabled('#projectBuildScene'); await fill('#projectBuildScene', id, 'change'); };
  const colorBounds = color => evaluate(`(() => { const canvas = document.querySelector('#scenePreviewCanvas'); if (!canvas?.width || !canvas.height) return null;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, rgb = ${JSON.stringify(color)}, result = { x: canvas.width, y: canvas.height, right: -1, bottom: -1, count: 0 };
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) { const i = (y * canvas.width + x) * 4;
      if (data[i + 3] > 250 && rgb.every((v, j) => Math.abs(v - data[i + j]) < 2)) { result.x = Math.min(result.x, x); result.y = Math.min(result.y, y); result.right = Math.max(result.right, x); result.bottom = Math.max(result.bottom, y); result.count++; }
    } return result.count ? { ...result, width: result.right - result.x + 1, height: result.bottom - result.y + 1 } : null; })()`);
  const colors = { blue: [68, 170, 238], orange: [238, 102, 68], green: [68, 238, 153] };
  const waitScene = async id => { await wait(async () => (await latest())?.scene?.objectId === id && (await latest())?.ok, `capture ${id}`); await enabled('#scenePreviewRefresh'); };
  await click('#projectBuildBtn'); await enabled('#projectBuildScene'); await select(scene.objectId);
  await click('#projectBuildTabPreview'); await waitScene(scene.objectId);
  await wait(async () => Boolean(await colorBounds(colors.blue)) && Boolean(await colorBounds(colors.orange)), 'decoded SVG images');
  assert.equal(await evaluate(`window.__sceneSvgExecuted === undefined`), true); assert.deepEqual(report.svgRequests, []);
  const first = await latest(); assert.deepEqual(first.scene.viewport, [640, 480]); assert.equal(first.actors.length, 2);
  assert.deepEqual(first.actors[0].size, [80, 80]); assert.equal(first.actors[0].speed, 180); assert.equal(first.actors[0].imageResourceId, images[0].id);
  assert.deepEqual(first.actors[1].size, [120, 60]); assert.equal(first.actors[1].imageResourceId, images[1].id);
  const before = await colorBounds(colors.blue), other = await colorBounds(colors.orange);
  assert.ok(Math.abs(other.width / before.width - 1.5) < .05); assert.ok(Math.abs(other.height / before.height - .75) < .05);
  assert.ok(Math.abs((other.x + other.right - before.x - before.right) / 2 / before.width - 220 / 80) < .1);
  assert.equal(await evaluate(`document.querySelector('#projectBuildTabPreview').getAttribute('aria-selected')`), 'true');
  assert.equal(await evaluate(`document.querySelector('#projectBuildTaskPanel').hidden`), true);
  await evaluate(`document.querySelector('#scenePreviewCanvas').scrollIntoView({ block: 'center' })`);
  await screenshot('preview-inherited-zh.png');
  report.steps.push('No Godot is configured: the Preview tab renders both frozen SVG images at inherited/overridden sizes and center positions, with source-aware resolved projection fields. No build job runs.');

  const canvasPoint = async (x, y) => evaluate(`(() => { const c = document.querySelector('#scenePreviewCanvas'), b = c.getBoundingClientRect(); return { x: b.left + ${x} / c.width * b.width, y: b.top + ${y} / c.height * b.height }; })()`);
  const tap = async point => {
    const location = () => evaluate(`(() => { const c = document.querySelector('#scenePreviewCanvas'), target = document.elementFromPoint(${point.x}, ${point.y}); return { bounds: c.getBoundingClientRect().toJSON(), target: target?.id || target?.tagName, scroll: document.querySelector('#projectBuildDialog').scrollTop, selected: document.querySelector('#scenePreviewSelection').textContent }; })()`);
    const sample = { point, before: await location() }; (report.pointerSamples ||= []).push(sample);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }); sample.pressed = await location();
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }); sample.after = await location();
  };
  await tap(await canvasPoint((before.x + before.right) / 2, (before.y + before.bottom) / 2));
  await wait(() => evaluate(`document.querySelector('#scenePreviewInspector').textContent.includes('Traveler · Player')`), 'canvas hit selection');
  assert.equal(await evaluate(`document.querySelector('#scenePreviewInspector').textContent.includes('180')`), true);
  await click('#scenePreviewZoomIn');
  const zoomed = await colorBounds(colors.blue); assert.ok(zoomed.width > before.width * 1.15, 'zoom visibly enlarges the image');
  await click('#scenePreviewZoomOut'); await click('#scenePreviewFit');
  const gridBefore = await evaluate(`document.querySelector('#scenePreviewCanvas').toDataURL()`);
  await click('#scenePreviewGrid');
  assert.notEqual(await evaluate(`document.querySelector('#scenePreviewCanvas').toDataURL()`), gridBefore, 'grid changes rendered pixels');
  const panBefore = await colorBounds(colors.blue), origin = await evaluate(`(() => { const b = document.querySelector('#scenePreviewCanvas').getBoundingClientRect(); return { x: b.left + 20, y: b.top + 20 }; })()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...origin });
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: origin.x + 40, y: origin.y + 30 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: origin.x + 40, y: origin.y + 30 });
  const panned = await colorBounds(colors.blue); assert.ok(Math.abs(panned.x - panBefore.x - 40) <= 2); assert.ok(Math.abs(panned.y - panBefore.y - 30) <= 2);
  await click('#scenePreviewFit'); await click('#scenePreviewGrid');
  report.steps.push('Real pointer selection opens the correct actor inspector. Zoom, grid, pointer pan and Fit visibly affect only the camera and overlay.');

  await select(overlap.objectId); await waitScene(overlap.objectId);
  const tintedColor = [34, 85, 119];
  await wait(async () => Boolean(await colorBounds(tintedColor)) && Boolean(await colorBounds(colors.orange)), 'tint and draw-order images');
  const tint = await colorBounds(tintedColor), top = await colorBounds(colors.orange);
  assert.ok(Math.abs(tint.width / top.width - 2) < .12);
  await tap(await canvasPoint((top.x + top.right) / 2, (top.y + top.bottom) / 2));
  await wait(() => evaluate(`document.querySelector('#scenePreviewInspector').textContent.includes('Traveler · NPC')`), 'topmost actor hit');
  await screenshot('preview-tint-order-zh.png');
  report.steps.push('A second layout multiplies the inherited image by its RGBA tint and draws the later actor on top; a real center click selects that top actor.');

  await select(alternate.objectId); await waitScene(alternate.objectId);
  await wait(async () => Boolean(await colorBounds(colors.green)), 'explicit null image shows plain color');
  assert.equal(await colorBounds(colors.blue), null); assert.equal(await colorBounds(colors.orange), null);
  assert.equal(Object.hasOwn((await latest()).actors[0], 'imageResourceId'), false);
  await evaluate(`document.querySelector('#projectBuildTabPreview').focus()`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' });
  assert.equal(await evaluate(`document.querySelector('#projectBuildTabBuild').getAttribute('aria-selected')`), 'true');
  assert.equal(await evaluate(`document.querySelector('#projectBuildPreviewPanel').hidden`), true);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft' });
  assert.equal(await evaluate(`document.querySelector('#projectBuildTabPreview').getAttribute('aria-selected')`), 'true');
  assert.equal(await evaluate(`document.activeElement.id`), 'projectBuildTabPreview');
  await wait(async () => Boolean(await colorBounds(colors.green)), 'preview returns after keyboard tab');
  for (const language of ['en', 'ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    if (language === 'ja') await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.querySelector('#scenePreviewCanvas').scrollIntoView({ block: 'center' })`);
    await screenshot(`preview-${language === 'ja' ? 'narrow-' : ''}${language}.png`);
    assert.equal(await evaluate(`document.querySelector('#projectBuildDialog').scrollWidth <= document.querySelector('#projectBuildDialog').clientWidth`), true, `${language} dialog fits`);
    assert.equal(await evaluate(`document.querySelector('#projectBuildPreviewPanel').scrollWidth <= document.querySelector('#projectBuildPreviewPanel').clientWidth`), true, `${language} preview fits`);
    assert.equal(await evaluate(`document.querySelector('#projectBuildTabPreview').textContent.trim()`), language === 'en' ? 'Scene preview' : 'シーンプレビュー');
  }
  await call('Emulation.clearDeviceMetricsOverride');
  await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  report.steps.push('Explicit imageResourceId:null removes inherited imagery. Arrow-key tab navigation maintains ARIA/focus, while English/Japanese and a 390px viewport retain the same scene without horizontal overflow.');

  // A response for A arrives after B is already visible; A must not replace B.
  await evaluate('window.__holdNextPreview = true'); await select(scene.objectId);
  await wait(() => evaluate('window.__heldPreview === true'), 'delayed A response');
  await select(alternate.objectId); await waitScene(alternate.objectId);
  await wait(async () => Boolean(await colorBounds(colors.green)), 'B wins race');
  await evaluate('window.__releasePreview()'); await delay(300);
  assert.equal(await evaluate(`document.querySelector('#projectBuildScene').value`), alternate.objectId);
  assert.ok(await colorBounds(colors.green)); assert.equal(await colorBounds(colors.blue), null);
  assert.equal(await colorBounds(colors.orange), null);
  await screenshot('preview-request-race-zh.png');
  report.steps.push('A delayed old-scene response cannot replace a newer scene or restore its old images after rapid selection.');

  await select(invalid.objectId);
  await wait(async () => (await latest())?.ok === false, 'invalid scene diagnosis');
  await enabled('#scenePreviewRefresh');
  assert.equal(await colorBounds(colors.green), null); assert.equal(await colorBounds(colors.blue), null);
  assert.ok((await latest()).diagnostics.some(value => value.code === 'build_scene_value' && value.propertyPath === '/viewport'));
  assert.equal(await evaluate(`document.querySelector('#projectBuildPreviewPanel').textContent.includes('viewport')`), true);
  await evaluate(`document.querySelector('#scenePreviewDiagnostics').scrollIntoView({ block: 'center' })`);
  await screenshot('preview-invalid-scene-zh.png');
  assert.deepEqual(await sourceTree(root), initial); assert.equal((await state()).job, null);
  report.steps.push('Invalid scene dimensions clear old pixels and show a source-located diagnostic. All previews, tab switches and gestures leave authoring files byte-identical and never create a build job.');

  await select(scene.objectId); await waitScene(scene.objectId);
  await wait(async () => Boolean(await colorBounds(colors.blue)), 'restore scene A');
  await enabled('#scenePreviewEdit'); await click('#scenePreviewEdit'); await enabled('#sceneCreateCheck');
  await fill('#sceneCreateName', 'A · 旅人😀 preview follows save'); await fill('#sceneActor0position0', '210');
  await click('#sceneCreateCheck'); await enabled('#sceneCreateSave'); await click('#sceneCreateSave');
  await enabled('#sceneCreateClose'); await click('#sceneCreateClose');
  await wait(async () => (await latest())?.scene?.title === 'A · 旅人😀 preview follows save', 'saved scene refresh');
  await wait(async () => Boolean(await colorBounds(colors.blue)), 'saved scene pixels');
  assert.deepEqual((await latest()).actors[0].position, [210, 200]);
  const savedText = await fs.readFile(path.join(root, scene.sourcePath), 'utf8'); assert.equal(savedText[0], '\uFEFF'); assert.ok(savedText.includes('\r\n'));
  const saved = await sourceTree(root), changed = Object.keys(saved).filter(file => saved[file] !== initial[file]).sort();
  assert.deepEqual(changed, [scene.sourcePath]);
  await screenshot('preview-after-scene-edit-zh.png');
  report.steps.push('Edit scene opens from the preview. Saving updates the title and actor position in a fresh preview while preserving scene UUID, BOM/CRLF and every other authored file.');

  const previousCapture = (await latest()).previewId;
  await click('#scenePreviewRefresh'); await wait(async () => (await latest())?.previewId !== previousCapture && (await latest())?.scene?.objectId === scene.objectId, 'explicit preview refresh');
  await wait(async () => Boolean(await colorBounds(colors.blue)), 'refreshed pixels');
  assert.deepEqual(await sourceTree(root), saved); assert.equal((await state()).job, null);
  await evaluate(`document.querySelector('#projectBuildDialog').scrollTop = 0`);
  await screenshot('preview-tab-overview-zh.png');
  await evaluate(`document.querySelector('#scenePreviewObjects button[data-object-id="${variants[0].objectId}"]').click()`);
  await enabled('#scenePreviewActorSource'); await click('#scenePreviewActorSource');
  await wait(() => evaluate(`!document.querySelector('#projectBuildDialog').open && (await import('/web/modules/app-state.js')).appState.activePath.endsWith(${JSON.stringify(variants[0].sourcePath)})`), 'projection source navigation');
  await click('#projectBuildBtn'); await waitScene(scene.objectId); await wait(async () => Boolean(await colorBounds(colors.blue)), 'preview reopen');
  await evaluate(`document.querySelector('#scenePreviewObjects button[data-object-id="${variants[0].objectId}"]').click()`);
  await enabled('#scenePreviewOriginSource'); await click('#scenePreviewOriginSource');
  await wait(() => evaluate(`!document.querySelector('#projectBuildDialog').open && (await import('/web/modules/app-state.js')).appState.activePath.endsWith(${JSON.stringify(core.sourcePath)})`), 'original OC navigation');
  assert.deepEqual(await sourceTree(root), saved); assert.equal((await state()).job, null);
  report.steps.push('Actor and original-OC source links return to the corresponding document; reopening Preview retains the selected scene and reads a fresh snapshot. Navigation is read-only.');
  const selectActor = async () => {
    await click('#projectBuildBtn'); await waitScene(scene.objectId);
    await wait(() => evaluate(`Boolean(document.querySelector('#scenePreviewObjects button[data-object-id="${variants[0].objectId}"]'))`), 'source actor available');
    await evaluate(`document.querySelector('#scenePreviewObjects button[data-object-id="${variants[0].objectId}"]').click()`);
  };
  const selection = () => evaluate(`(() => { const input = document.querySelector('#docSourceEditor'); return {
    value: input.value, start: input.selectionStart, end: input.selectionEnd,
    text: input.value.slice(input.selectionStart, input.selectionEnd), status: document.querySelector('#docEditStatus').textContent }; })()`);
  await selectActor();
  await click('#scenePreviewProperties button[aria-label="查看 位置（中心） 的来源"]');
  await wait(async () => (await selection()).status.includes('已定位来源字段'), 'exact scene source range');
  await wait(() => evaluate(`document.activeElement.id === 'docSourceEditor'`), 'source editor focus after modal close');
  const selectedPosition = await selection();
  assert.deepEqual(JSON.parse(selectedPosition.text), [210, 200]);
  assert.equal(selectedPosition.value[0], '\uFEFF'); assert.ok(selectedPosition.value.includes('旅人😀'));
  assert.ok(!selectedPosition.value.includes('\r')); assert.ok(savedText.includes('\r\n'));
  await screenshot('source-position-zh.png');
  await selectActor();
  await click('#scenePreviewProperties button[aria-label="查看 速度 的来源"]');
  await wait(async () => (await selection()).status.includes('/configuration/speed'), 'inherited speed range');
  await wait(() => evaluate(`document.activeElement.id === 'docSourceEditor'`), 'inherited source editor focus');
  assert.equal((await selection()).text, '180');
  await screenshot('source-inherited-speed-zh.png');
  await selectActor();
  await click('#scenePreviewProperties button[aria-label="查看 尺寸 的来源"]');
  await wait(async () => (await selection()).status.includes('未选择近似范围'), 'composite field fallback');
  assert.equal((await selection()).start, (await selection()).end);
  report.steps.push('Field links select the exact JSON value in the actual source textarea: the saved scene position survives BOM, CRLF, Chinese and emoji offset conversion, and inherited speed selects the projection configuration. Composite size opens its document without selecting an approximate range.');
  await selectActor();
  const externalText = savedText.replace('旅人😀 preview follows save', '外部修改😀 preview follows save');
  await write(scene.sourcePath, externalText);
  await click('#scenePreviewProperties button[aria-label="查看 位置（中心） 的来源"]');
  await wait(async () => (await selection()).status.includes('原文已变化'), 'stale source range rejected');
  await wait(() => evaluate(`document.activeElement.id === 'docSourceEditor'`), 'stale source editor focus');
  const stale = await selection(); assert.equal(stale.start, stale.end); assert.ok(stale.value.includes('外部修改😀'));
  assert.equal(await fs.readFile(path.join(root, scene.sourcePath), 'utf8'), externalText);
  await screenshot('source-stale-zh.png');
  await write(scene.sourcePath, savedText);
  assert.deepEqual(await sourceTree(root), saved);
  report.steps.push('Changing the scene on disk after preview capture opens the current source and reports a stale location with no selection or write. Restoring the test fixture restores every author-file hash.');
  report.created = { coreId: core.objectId, projectionIds: variants.map(value => value.objectId), imageIds: images.map(value => value.id), sceneIds: [scene.objectId, alternate.objectId, overlap.objectId, invalid.objectId] };
  report.authorFiles = await sourceTree(root); report.captures = await evaluate('window.__sceneCaptures');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.svgRequests, []); report.steps.push('SVG images render as image content: embedded script and external-image URLs never execute or request network access.'); report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  try { await captureFailure?.(); } catch (captureError) { report.captureFailure = captureError.message; }
} finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), json(report));
  console.log(JSON.stringify({ ok: report.ok, steps: report.steps, limitations: report.limitations, failure: report.failure, output }, null, 2));
}
