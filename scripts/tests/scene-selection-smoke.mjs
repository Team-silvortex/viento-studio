// Real browser Scene2D multi-selection and alignment through the real HTTP editor and Chrome pointer/keyboard input.
// Run: VIENTO_SCENE_SELECTION_OUTPUT=/empty/evidence/path node scripts/tests/scene-selection-smoke.mjs [chromium]
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
const output = path.resolve(process.env.VIENTO_SCENE_SELECTION_OUTPUT || path.join(os.tmpdir(), `viento-scene-selection-evidence-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_SCENE_SELECTION_OUTPUT directory; prior evidence is immutable.');
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], errors: [], svgRequests: [], limitations: [
  'HTTP editor and real Chrome canvas only; packaged Tauri IPC and Android were not exercised.',
  'Multi-selection edits exercise static positions only. No Godot tool, runtime movement, audio, or gameplay was used.',
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-selection-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'workspace'), template = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank');
  const write = async (relative, content) => { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); };
  for (const name of ['documents', 'templates', 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(root, name), { recursive: true });
  await write('workspace.json', json({ format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Scene selection smoke', createdAt: 0,
    ...WORKSPACE_LAYOUT, documentTypes: template.documentTypes }));
  for (const [name, content] of Object.entries(template.templates)) await write(`templates/${name}`, content);
  await registerWorkspace(root);
  const execute = createWorldCommandService(root);
  const create = async (command, sourcePath, content) => {
    const view = await readWorldProjection(root), request = { command, mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
      actorRef: { kind: 'tool', id: 'scene-selection-smoke' }, objectId: randomUUID(), documentType: 'document', sourcePath, content };
    await execute(request); return request;
  };
  const core = await create('object.create', 'documents/core.md', '\uFEFF# Traveler / 旅人\r\n\r\n故事属于原 OC。  \r\n');
  const images = [];
  for (const color of ['#44aaee', '#ee6644']) {
    const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><script>fetch('http://127.0.0.1:9/viento-preview-script');top.__sceneSvgExecuted=true;</script><image href="http://127.0.0.1:9/viento-preview-external.png" width="1" height="1"/><rect width="32" height="32" fill="${color}"/></svg>`);
    const imported = await importMediaAsset(root, Readable.from([bytes]), `${color.slice(1)}.svg`); images.push(imported.asset);
  }
  const variants = [];
  for (const [index, suffix] of ['rpg-player', 'rpg-npc', 'rpg-npc'].entries()) {
    const selected = getProjectionTemplates().find(item => item.id.endsWith(`.${suffix}`));
    const declaration = { format: 'viento-object-projection', schemaVersion: 1, title: ['Traveler · Player', 'Traveler · Guard', 'Traveler · Companion'][index], sourceObjectId: core.objectId,
      template: await lockProjectionTemplate(selected, { digest: buildHash }),
      configuration: { ...Object.fromEntries(selected.fields.map(field => [field.id, field.default])), image: images[0].id, speed: index ? 0 : 180 } };
    variants.push(await create('projection.create', `documents/projections/${suffix}-${index}.json`, json(declaration)));
  }
  const declaration = { format: 'viento-scene2d', schemaVersion: 1, title: 'Selection · inherited and overridden', viewport: [640, 480], background: '#101827', actors: [
    { objectId: variants[0].objectId, position: [120, 120], useProjectionDefaults: true },
    { objectId: variants[1].objectId, position: [360, 200], useProjectionDefaults: true, size: [120, 60], imageResourceId: images[1].id },
    { objectId: variants[2].objectId, position: [220, 360], useProjectionDefaults: true, size: [40, 96], imageResourceId: null, color: '#44ee99' },
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
    return response;
  }; })()`);

  const latest = () => evaluate('window.__sceneCaptures.at(-1)');
  const ids = variants.map(item => item.objectId), originalPositions = declaration.actors.map(item => item.position), sizes = [[80, 80], [120, 60], [40, 96]];
  const colors = [[68, 170, 238], [238, 102, 68], [68, 238, 153]];
  const selectedIds = () => evaluate(`[...document.querySelectorAll('#sceneLayoutObjects input[type="checkbox"]:checked')].map(input => input.dataset.objectId)`);
  const assertSelected = async expected => assert.deepEqual((await selectedIds()).sort(), expected.slice().sort());
  const positionsInSource = source => JSON.parse(source.replace(/^\uFEFF/, '')).actors.map(actor => actor.position);
  const beforeUnload = () => evaluate(`(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })()`);
  const colorBounds = (selector, color) => evaluate(`(() => { const canvas = document.querySelector(${JSON.stringify(selector)}); if (!canvas?.width || !canvas.height) return null;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, rgb = ${JSON.stringify(color)}, result = { x: canvas.width, y: canvas.height, right: -1, bottom: -1, count: 0 };
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) { const i = (y * canvas.width + x) * 4;
      if (data[i + 3] > 250 && rgb.every((v, j) => Math.abs(v - data[i + j]) < 2)) { result.x = Math.min(result.x, x); result.y = Math.min(result.y, y); result.right = Math.max(result.right, x); result.bottom = Math.max(result.bottom, y); result.count++; }
    } return result.count ? { ...result, width: result.right - result.x + 1, height: result.bottom - result.y + 1 } : null; })()`);
  const waitScene = async () => { await wait(async () => (await latest())?.scene?.objectId === scene.objectId && (await latest())?.ok, 'saved Scene2D capture'); await enabled('#scenePreviewLayoutEdit'); };
  const openLayout = async () => { await enabled('#scenePreviewLayoutEdit'); await click('#scenePreviewLayoutEdit');
    await wait(() => evaluate(`document.querySelector('#sceneLayoutDialog')?.open && document.querySelector('#sceneLayoutDialog').getAttribute('aria-busy') !== 'true'`), 'layout editor open');
    await wait(async () => (await Promise.all(colors.map(color => colorBounds('#sceneLayoutCanvas', color)))).every(Boolean), 'three layout actors ready');
  };
  const pointOfActor = async index => {
    await evaluate(`document.querySelector('#sceneLayoutCanvas').scrollIntoView({ block: 'center' })`);
    const bounds = await colorBounds('#sceneLayoutCanvas', colors[index]); assert.ok(bounds, `actor ${index} is visible`);
    return evaluate(`(() => { const c = document.querySelector('#sceneLayoutCanvas'), b = c.getBoundingClientRect(); return { x: b.left + ${(bounds.x + bounds.right) / 2} / c.width * b.width, y: b.top + ${(bounds.y + bounds.bottom) / 2} / c.height * b.height }; })()`);
  };
  const tapActor = async (index, modifiers = 0) => {
    const point = await pointOfActor(index);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, modifiers, ...point });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, modifiers, ...point });
  };
  const dragActor = async (index, dx, dy) => {
    const point = await pointOfActor(index);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...point });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: point.x + dx / 2, y: point.y + dy / 2 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: point.x + dx, y: point.y + dy });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, x: point.x + dx, y: point.y + dy });
  };
  const checkedSource = async () => { await enabled('#sceneLayoutCheck'); await click('#sceneLayoutCheck'); await enabled('#sceneLayoutSave'); return evaluate(`document.querySelector('#sceneLayoutSource').textContent`); };
  const assertBaseline = async () => {
    assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').dataset.dirty`), 'false');
    assert.equal(await evaluate(`document.querySelector('#sceneLayoutUndo').disabled`), true, 'one Undo returns the entire group to its saved state');
    assert.equal(await beforeUnload(), false);
  };
  await click('#projectBuildBtn'); await enabled('#projectBuildScene'); await fill('#projectBuildScene', scene.objectId, 'change');
  await enabled('#projectBuildPlan'); await click('#projectBuildPlan');
  await wait(async () => { const value = await state(); return value.job?.kind === 'plan' && value.job?.status === 'succeeded'; }, 'initial build plan');
  await wait(() => evaluate(`!document.querySelector('#projectBuildPlanSummary').hidden`), 'initial plan displayed'); report.initialPlan = (await state()).job;
  await click('#projectBuildTabPreview'); await waitScene(); await openLayout();
  assert.deepEqual((await latest()).actors.map(actor => actor.size), sizes);
  assert.equal((await latest()).actors[2].imageResourceId, undefined, 'explicit null still removes the inherited image');

  await click('#sceneLayoutClearSelection'); await assertSelected([]);
  await tapActor(0); await assertSelected([ids[0]]);
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutCoordinates').hidden`), false, 'single selection shows its position controls');
  await tapActor(1, 8); await assertSelected(ids.slice(0, 2)); // CDP Shift modifier.
  await tapActor(2, 2); await assertSelected(ids); // CDP Control modifier.
  await tapActor(2, 2); await assertSelected(ids.slice(0, 2));
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutX').disabled && document.querySelector('#sceneLayoutY').disabled && document.querySelector('#sceneLayoutX').value === '' && document.querySelector('#sceneLayoutY').value === ''`), true);
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutCoordinates').hidden`), true, 'multi-selection makes room for group alignment actions');
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutSelection').textContent.includes('2')`), true);
  await click(`#sceneLayoutObjects input[type="checkbox"][data-object-id="${ids[2]}"]`); await assertSelected(ids);
  await click('#sceneLayoutClearSelection'); await assertSelected([]);
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutCoordinates').hidden`), true, 'empty selection hides unused position controls');
  await click('#sceneLayoutSelectAll'); await assertSelected(ids);
  await click(`#sceneLayoutObjects button[data-object-id="${ids[0]}"]`); await assertSelected([ids[0]]);
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutCoordinates').hidden`), false, 'returning to one actor restores position controls');
  await click(`#sceneLayoutObjects input[type="checkbox"][data-object-id="${ids[1]}"]`); await assertSelected(ids.slice(0, 2));
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').dataset.dirty`), 'false'); assert.equal(await beforeUnload(), false);
  assert.deepEqual(await sourceTree(root), initial);
  await screenshot('selection-controls-zh.png');
  report.steps.push('Real Shift/Control canvas clicks, explicit list checkboxes, Select all and Clear maintain the same selection. Two-object selection clears/disables single-position fields, announces its count, and never creates a dirty draft or writes source.');

  await click('#sceneLayoutSnap'); await dragActor(0, 51, 37); await assertSelected(ids.slice(0, 2));
  const movedSource = await checkedSource(), movedPositions = positionsInSource(movedSource);
  const delta = movedPositions[0].map((value, axis) => value - originalPositions[0][axis]);
  assert.ok(delta.every(value => value > 0)); assert.ok(movedPositions[0].every(value => Number.isInteger(value / 32)), 'grabbed actor center snaps to 32-unit grid');
  assert.deepEqual(movedPositions[1].map((value, axis) => value - originalPositions[1][axis]), delta, 'all selected actors share one movement delta');
  assert.deepEqual(movedPositions[2], originalPositions[2], 'unselected actor stays put');
  assert.deepEqual(movedPositions[1].map((value, axis) => value - movedPositions[0][axis]), [240, 80], 'group spacing is preserved');
  assert.equal(await beforeUnload(), true); await screenshot('selection-group-drag-snap-zh.png');
  await click('#sceneLayoutUndo'); await assertBaseline(); await assertSelected(ids.slice(0, 2));
  await click('#sceneLayoutRedo'); assert.deepEqual(positionsInSource(await checkedSource()), movedPositions);
  await click('#sceneLayoutUndo'); await assertBaseline(); assert.deepEqual(await sourceTree(root), initial);
  await dragActor(1, 19, 22); const secondAnchorPositions = positionsInSource(await checkedSource());
  assert.ok(secondAnchorPositions[1].every(value => Number.isInteger(value / 32)), 'the actually grabbed second actor is the snap anchor');
  assert.deepEqual(secondAnchorPositions[1].map((value, axis) => value - originalPositions[1][axis]), secondAnchorPositions[0].map((value, axis) => value - originalPositions[0][axis]));
  assert.notEqual(secondAnchorPositions[0][0] % 32, 0, 'the first selected actor need not lie on the grid when another actor anchors the group');
  assert.deepEqual(secondAnchorPositions[2], originalPositions[2]); await click('#sceneLayoutUndo'); await assertBaseline();
  report.groupMovement = { positions: movedPositions, delta, secondAnchorPositions };
  report.steps.push('Dragging a selected actor moves the selected pair as one group. The grabbed center snaps to the 32-unit grid while exact spacing is preserved and the unselected actor remains fixed. One Undo restores both actors; one Redo repeats the move.');

  await click('#sceneLayoutSelectAll'); await assertSelected(ids);
  const edges = { left: Math.min(...originalPositions.map((point, i) => point[0] - sizes[i][0] / 2)), right: Math.max(...originalPositions.map((point, i) => point[0] + sizes[i][0] / 2)),
    top: Math.min(...originalPositions.map((point, i) => point[1] - sizes[i][1] / 2)), bottom: Math.max(...originalPositions.map((point, i) => point[1] + sizes[i][1] / 2)) };
  const alignmentCases = [
    ['Left', point => edges.left, 0, 1], ['Center', point => (edges.left + edges.right) / 2, 0, 0], ['Right', point => edges.right, 0, -1],
    ['Top', point => edges.top, 1, 1], ['Middle', point => (edges.top + edges.bottom) / 2, 1, 0], ['Bottom', point => edges.bottom, 1, -1],
  ];
  report.alignments = {};
  for (const [name, edge, axis, sign] of alignmentCases) {
    await enabled(`#sceneLayoutAlign${name}`); await click(`#sceneLayoutAlign${name}`);
    const source = await checkedSource(), positions = positionsInSource(source), expected = originalPositions.map((point, i) => point.map((value, a) => a === axis ? edge(point) + sign * sizes[i][axis] / 2 : value));
    assert.deepEqual(positions, expected, `${name} uses full resolved dimensions and the selected union bounds`);
    assert.deepEqual(JSON.parse(source.replace(/^\uFEFF/, '')), { ...declaration, actors: declaration.actors.map((actor, i) => ({ ...actor, position: expected[i] })) });
    report.alignments[name] = positions;
    if (name === 'Top') await screenshot('selection-align-top-zh.png');
    await click('#sceneLayoutUndo'); await assertBaseline(); await assertSelected(ids);
  }
  assert.deepEqual(await sourceTree(root), initial);
  report.steps.push('All six alignment actions use the selected union bounds and each actor’s resolved width/height: left, horizontal center, right, top, vertical center, bottom. Each action is one Undo step and preserves every non-position declaration, including inherited defaults and explicit image:null.');

  await dragActor(0, 32, 28); await assertSelected(ids);
  const batchText = await checkedSource(), batchPositions = positionsInSource(batchText), batchDelta = batchPositions[0].map((value, axis) => value - originalPositions[0][axis]);
  assert.ok(batchDelta.some(Boolean));
  for (let i = 1; i < 3; i++) assert.deepEqual(batchPositions[i].map((value, axis) => value - originalPositions[i][axis]), batchDelta);
  assert.deepEqual(await sourceTree(root), initial, 'checking the entire group remains read-only');
  for (const language of ['en', 'ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    if (language === 'ja') await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.querySelector('#sceneLayoutDialog').scrollTop = 0`); await screenshot(`selection-${language === 'ja' ? 'narrow-' : ''}${language}.png`);
    assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').scrollWidth <= document.querySelector('#sceneLayoutDialog').clientWidth`), true, `${language} selection controls fit`);
    await assertSelected(ids); assert.equal(await evaluate(`document.querySelector('#sceneLayoutSave').disabled`), false);
    const labels = await evaluate(`['SelectAll', 'ClearSelection', 'AlignLeft', 'AlignCenter', 'AlignRight', 'AlignTop', 'AlignMiddle', 'AlignBottom'].map(name => document.getElementById('sceneLayout' + name).textContent.trim())`);
    assert.ok(labels.every(label => label.length && (language !== 'en' || !/[\u4e00-\u9fff]/u.test(label))), `${language} selection controls are translated`); report[`${language}Labels`] = labels;
    if (language === 'ja') { await evaluate(`document.querySelector('#sceneLayoutObjects').scrollIntoView({ block: 'center' })`); await screenshot('selection-list-narrow-ja.png');
      await evaluate(`document.querySelector('#sceneLayoutAlignTop').scrollIntoView({ block: 'center' })`); await screenshot('selection-alignment-narrow-ja.png'); }
  }
  report.steps.push('English and Japanese preserve all three selected objects and the checked batch draft. At 390px, multi-select checkboxes and alignment actions remain available without horizontal overflow.');

  await click('#sceneLayoutSave'); await wait(async () => (await fs.readFile(path.join(root, scene.sourcePath), 'utf8')) === batchText, 'save reviewed group positions');
  await wait(() => evaluate(`document.querySelector('#sceneLayoutDialog').dataset.dirty === 'false' && document.querySelector('#sceneLayoutClose').disabled === false`), 'batch saved state');
  const savedText = await fs.readFile(path.join(root, scene.sourcePath), 'utf8'); assert.equal(savedText[0], '\uFEFF'); assert.ok(savedText.includes('\r\n')); assert.equal(savedText.replaceAll('\r\n', '').includes('\n'), false);
  const savedTree = await sourceTree(root); assert.deepEqual(Object.keys(savedTree).filter(file => savedTree[file] !== initial[file]).sort(), [scene.sourcePath]);
  const savedWorld = await readWorldProjection(root); assert.ok(savedWorld.objects.some(value => value.id === scene.objectId && value.documentRefs?.some(ref => ref.sourcePath === scene.sourcePath)));
  await click('#sceneLayoutClose'); await wait(async () => JSON.stringify((await latest())?.actors?.map(actor => actor.position)) === JSON.stringify(batchPositions), 'saved preview refreshes every moved actor');
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await click('#projectBuildTabBuild'); assert.equal(await evaluate(`document.querySelector('#projectBuildPlanSummary').hidden`), true); assert.equal((await state()).job.id, report.initialPlan.id);
  await click('#projectBuildTabPreview'); await waitScene(); await screenshot('selection-saved-preview-zh.png');
  report.steps.push('Apply publishes only the three reviewed position changes and refreshes the saved preview. Scene UUID, BOM/CRLF, all OC/projection declarations, metadata and resource bytes remain unchanged; the old build plan is invalidated without starting a new job.');

  await openLayout(); await click('#sceneLayoutSelectAll'); await click('#sceneLayoutAlignTop'); const conflictDraft = await checkedSource();
  assert.notEqual(conflictDraft, savedText); const externalText = savedText.replace('Selection · inherited and overridden', 'Selection · externally changed'); await write(scene.sourcePath, externalText);
  await click('#sceneLayoutSave'); await wait(() => evaluate(`document.querySelector('#sceneLayoutSave').disabled && document.querySelector('#sceneLayoutDialog').getAttribute('aria-busy') !== 'true'`), 'refuse stale batch update');
  assert.equal(await fs.readFile(path.join(root, scene.sourcePath), 'utf8'), externalText); await assertSelected(ids);
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').dataset.dirty`), 'true');
  report.conflictMessage = await evaluate(`document.querySelector('#sceneLayoutMessage').textContent`); await screenshot('selection-conflict-preserved-zh.png');
  const confirmationCount = report.confirmations?.length || 0; confirmAccept = false; await click('#sceneLayoutReload');
  await wait(() => (report.confirmations?.length || 0) > confirmationCount, 'reload confirms dropping multi-object draft');
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').open`), true); await assertSelected(ids);
  confirmAccept = true; await click('#sceneLayoutReload'); await wait(() => evaluate(`!document.querySelector('#sceneLayoutDialog').open`), 'discard rejected group edit');
  await wait(async () => (await latest())?.scene?.title === 'Selection · externally changed', 'refresh external scene');
  assert.deepEqual((await latest()).actors.map(actor => actor.position), batchPositions); assert.equal(await fs.readFile(path.join(root, scene.sourcePath), 'utf8'), externalText);
  const finalTree = await sourceTree(root); assert.deepEqual(Object.keys(finalTree).filter(file => finalTree[file] !== initial[file]).sort(), [scene.sourcePath]);
  report.steps.push('An external edit between Check and Apply rejects the entire batch. All three selections and the local draft remain, no external content is overwritten, and Reload asks before discarding the draft and showing the current saved scene.');
  const lifecycleFiles = await sourceTree(root);
  for (let cycle = 0; cycle < 40; cycle++) {
    await openLayout();
    assert.equal(await evaluate(`document.querySelector('#sceneLayoutUndo').disabled && document.querySelector('#sceneLayoutRedo').disabled`), true, `fresh history cycle ${cycle}`);
    const currentX = await evaluate(`Number(document.querySelector('#sceneLayoutX').value)`);
    await fill('#sceneLayoutX', String(currentX + 1), 'change');
    assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').dataset.dirty`), 'true');
    await click('#sceneLayoutUndo');
    assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').dataset.dirty`), 'false');
    assert.equal(await evaluate(`document.querySelector('#sceneLayoutRedo').disabled`), false);
    await click('#sceneLayoutClose');
    await wait(() => evaluate(`!document.querySelector('#sceneLayoutDialog').open`), `release layout draft ${cycle}`);
  }
  assert.deepEqual(await sourceTree(root), lifecycleFiles);
  report.steps.push('Forty consecutive real dialog open/edit/undo/close cycles release Rust draft handles beyond the 32-slot limit. Each reopen starts with empty history and no draft is written to author files.');
  report.created = { coreId: core.objectId, projectionIds: ids, imageIds: images.map(value => value.id), sceneId: scene.objectId };
  report.authorFiles = await sourceTree(root); report.savedPositions = batchPositions; report.captures = await evaluate('window.__sceneCaptures');
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
