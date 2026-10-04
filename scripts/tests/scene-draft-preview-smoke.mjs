// Real browser Scene2D text draft preview through the real HTTP editor and Chrome; no author writes.
// Run: VIENTO_SCENE_DRAFT_PREVIEW_OUTPUT=/empty/evidence/path node scripts/tests/scene-draft-preview-smoke.mjs [chromium]
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
import { buildHash, captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { registerWorkspace } from '../lib/workspace.mjs';
import { importMediaAsset } from '../lib/media-assets.mjs';
import { getProjectionTemplates, lockProjectionTemplate } from '../../engine/object-projection.mjs';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.env.VIENTO_SCENE_DRAFT_PREVIEW_OUTPUT || path.join(os.tmpdir(), `viento-scene-draft-preview-evidence-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_SCENE_DRAFT_PREVIEW_OUTPUT directory; prior evidence is immutable.');
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], errors: [], svgRequests: [], limitations: [
  'HTTP editor and real Chrome canvas only; packaged Tauri IPC and Android were not exercised.',
  'Only saved dependencies and the current registered scene text draft are previewed. No layout writeback, engine process, or native device acceptance is claimed.',
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-draft-preview-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'workspace'), template = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank');
  const write = async (relative, content) => { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); };
  for (const name of ['documents', 'templates', 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(root, name), { recursive: true });
  await write('workspace.json', json({ format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Scene draft preview smoke', createdAt: 0,
    ...WORKSPACE_LAYOUT, documentTypes: template.documentTypes }));
  for (const [name, content] of Object.entries(template.templates)) await write(`templates/${name}`, content);
  await registerWorkspace(root);
  const execute = createWorldCommandService(root);
  const create = async (command, sourcePath, content) => {
    const view = await readWorldProjection(root), request = { command, mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
      actorRef: { kind: 'tool', id: 'scene-draft-preview-smoke' }, objectId: randomUUID(), documentType: 'document', sourcePath, content };
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
    const projectionDeclaration = { format: 'viento-object-projection', schemaVersion: 1, title: index ? 'Traveler · NPC' : 'Traveler · Player', sourceObjectId: core.objectId,
      template: await lockProjectionTemplate(selected, { digest: buildHash }),
      configuration: { ...Object.fromEntries(selected.fields.map(field => [field.id, field.default])), image: images[0].id, speed: index ? 0 : 180 } };
    variants.push(await create('projection.create', `documents/projections/${suffix}.json`, json(projectionDeclaration)));
  }
  const groupIds = [randomUUID(), randomUUID()], instanceIds = [randomUUID(), randomUUID()];
  const declaration = { format: 'viento-scene2d', schemaVersion: 3, title: 'A · text draft preview', viewport: [640, 480], background: '#101827',
    groups: [{ groupId: groupIds[0], name: '原文 Town😀' }, { groupId: groupIds[1], name: '居民 Residents', parentGroupId: groupIds[0] }], actors: [
      { instanceId: instanceIds[0], objectId: variants[0].objectId, groupId: groupIds[0], position: [160, 200], useProjectionDefaults: true },
      { instanceId: instanceIds[1], objectId: variants[1].objectId, groupId: groupIds[1], position: [380, 200], useProjectionDefaults: true, size: [120, 60], imageResourceId: images[1].id },
    ] };
  const serialize = value => '\uFEFF' + json(value).replaceAll('\n', '\r\n');
  const originalSource = serialize(declaration);
  const scene = await create('scene.create', 'documents/scenes/a.json', originalSource);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root, XDG_CACHE_HOME: path.join(temporary, 'cache') };
  delete env.VIENTO_GODOT_BIN; delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
  const initial = await sourceTree(root), savedBuild = await captureBuildSnapshot(root, scene.objectId), base = await serve(t, appRoot, env);
  const buildState = async () => { const response = await fetch(`${base}/api/project-build`); assert.equal(response.status, 200); const body = await response.json(); return body.data || body; };
  assert.equal((await buildState()).available, false); assert.equal((await buildState()).job, null);
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
    else if (value.method === 'Page.javascriptDialogOpening') { report.confirmations ||= []; report.confirmations.push(value.params.message); void call('Page.handleJavaScriptDialog', { accept: false }); }
    else if (value.method === 'Network.requestWillBeSent' && value.params.request.url.includes('127.0.0.1:9/viento-preview-')) report.svgRequests.push(value.params.request.url); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value, event = 'input') => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (input.id === 'docSourceEditor') { if (document.querySelector('#projectBuildDialog').open || input.disabled || !input.checkVisibility()) throw new Error('Source editor must be visible and interactive'); input.focus(); } input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === false && !document.querySelector(${JSON.stringify(selector)}).hidden`), `${selector} enabled`);
  const screenshot = async name => { const value = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(value.data, 'base64')); };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({ text: document.body.innerText, captures: window.__sceneCaptures, editor: document.querySelector('#docSourceEditor')?.value, state: (await import('/web/modules/app-state.js')).appState })`); report.serviceFailure = await buildState(); };
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable && document.querySelector('#projectBuildBtn')?.hidden === false`), 'preview-capable editor');
  await evaluate(`(() => { const original = window.fetch.bind(window); window.__sceneCaptures = []; window.fetch = async (input, init) => {
    const response = await original(input, init); const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/scene-preview') && init?.method === 'POST') {
      const body = await response.clone().json(); window.__sceneCaptures.push({ request: JSON.parse(init.body), status: response.status, payload: body.data || body });
    } return response;
  }; })()`);
  const latest = () => evaluate('window.__sceneCaptures.at(-1)');
  const captureCount = () => evaluate('window.__sceneCaptures.length');
  const editorText = () => evaluate("document.querySelector('#docSourceEditor').value");
  const modalBusy = () => evaluate("document.querySelector('#projectBuildPreviewPanel').getAttribute('aria-busy') === 'true'");
  const waitCapture = async count => { await wait(async () => await captureCount() > count && !(await modalBusy()), 'preview response and images complete'); return latest(); };
  const refreshDraft = async () => { await enabled('#scenePreviewDraftRefresh'); const count = await captureCount(); await click('#scenePreviewDraftRefresh'); return waitCapture(count); };
  const refreshSaved = async () => { await enabled('#scenePreviewRefresh'); const count = await captureCount(); await click('#scenePreviewRefresh'); return waitCapture(count); };
  const openPreview = async () => { await click('#projectBuildBtn'); await enabled('#projectBuildScene'); await fill('#projectBuildScene', scene.objectId, 'change'); await click('#projectBuildTabPreview');
    await wait(() => evaluate("document.querySelector('#projectBuildDialog').open && !document.querySelector('#projectBuildPreviewPanel').hidden"), 'preview panel'); await enabled('#scenePreviewRefresh'); };
  const closePreview = async () => { await click('#projectBuildClose'); await wait(() => evaluate("!document.querySelector('#projectBuildDialog').open"), 'return editor'); };
  const canvasSignature = async () => {
    const result = await evaluate(`(async () => {
      const canvas = document.querySelector('#scenePreviewCanvas'), bounds = canvas.getBoundingClientRect();
      const { fitSceneView, sceneToCanvas } = await import('/web/modules/app-scene-preview-canvas.js');
      const view = fitSceneView([640, 480], bounds.width, bounds.height), context = canvas.getContext('2d');
      // Sample actor interiors and background in world coordinates, avoiding label
      // rasterization and subpixel borders after the modal is resized or reopened.
      const samples = [[160,200],[240,280],[232,272],[248,288],[380,200],[360,180],[400,220],[48,48]].map(point => {
        const [x,y] = sceneToCanvas(view,...point);
        return [...context.getImageData(Math.floor(x*canvas.width/bounds.width),Math.floor(y*canvas.height/bounds.height),1,1).data];
      });
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canvas.toDataURL()));
      return {samples,width:canvas.width,height:canvas.height,cssWidth:bounds.width,cssHeight:bounds.height,
        pngSha256:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')};
    })()`);
    (report.canvasSamples ||= []).push(result); return JSON.stringify(result.samples);
  };
  const readOnlyButtons = async () => assert.equal(await evaluate("document.querySelector('#scenePreviewLayoutEdit').disabled && document.querySelector('#scenePreviewEdit').disabled"), true, 'draft preview cannot enter either save editor');
  const assertDraftInput = async value => assert.equal(await editorText(), value.replace(/\r\n|\r/g, '\n'), 'draft input retained including Unicode and BOM');

  await openPreview(); await wait(async () => (await latest())?.payload?.ok && !(await modalBusy()), 'initial saved capture');
  assert.deepEqual((await latest()).payload.actors.map(actor => actor.position), declaration.actors.map(actor => actor.position));
  await click('#scenePreviewSource');
  await wait(() => evaluate("document.activeElement.id === 'docSourceEditor' && !document.querySelector('#projectBuildDialog').open"), 'source editor open');
  const draft = structuredClone(declaration); draft.title = 'Draft · same text / 草稿'; draft.groups[0].name = '草稿の町 Draft town😀'; draft.actors[0].position = [240, 280];
  const draftSource = serialize(draft); await fill('#docSourceEditor', draftSource);
  await wait(() => evaluate("(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges"), 'main source draft dirty');
  await openPreview(); const savedOnOpen = await refreshSaved();
  assert.equal(savedOnOpen.request.draft, undefined); assert.deepEqual(savedOnOpen.payload.actors[0].position, [160, 200]);
  const valid = await refreshDraft(); assert.equal(valid.status, 200); assert.equal(valid.payload.ok, true);
  assert.equal(valid.request.draft.content, draftSource, 'request preserves exact BOM/CRLF draft bytes');
  assert.equal(valid.request.draft.baseSourceRevision, `sha256:${buildHash(originalSource)}`);
  assert.deepEqual(valid.payload.actors[0].position, [240, 280]);
  assert.equal(valid.payload.sceneStructure.groups[0].name, draft.groups[0].name);
  assert.equal(valid.payload.scene.sourceRevision, `sha256:${buildHash(draftSource)}`);
  assert.equal(valid.payload.sceneEditing, undefined, 'draft does not expose saved layout baseline');
  assert.equal(await evaluate(`document.querySelector('#scenePreviewObjects').textContent.includes(${JSON.stringify(draft.groups[0].name)})`), true);
  await readOnlyButtons(); await assertDraftInput(draftSource); assert.deepEqual(await sourceTree(root), initial);
  await screenshot('draft-valid-zh.png');
  await click(`#scenePreviewObjects button[data-group-source="${groupIds[0]}"]`);
  await wait(() => evaluate("document.activeElement.id === 'docSourceEditor' && !document.querySelector('#projectBuildDialog').open && document.querySelector('#docSourceEditor').selectionEnd > document.querySelector('#docSourceEditor').selectionStart"), 'draft group source focus');
  const selected = await evaluate("(() => {const e=document.querySelector('#docSourceEditor');return {text:e.value.slice(e.selectionStart,e.selectionEnd),status:document.querySelector('#docEditStatus').textContent};})()");
  assert.equal(JSON.parse(selected.text), draft.groups[0].name); await assertDraftInput(draftSource);
  assert.equal(await evaluate("(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges"), true);
  report.sourceSelection = selected; await screenshot('draft-exact-source-zh.png');
  report.steps.push('Explicit draft preview consumes the same unsaved source editor text, with BOM/CRLF preserved. A v3 instance position and Unicode group name update the real canvas/outline; group source navigation selects the exact current draft token and retains dirty state. No author file changes.');

  await openPreview(); await refreshDraft();
  for (const language of ['zh-CN', 'en', 'ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('${language}')`);
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await evaluate("document.querySelector('#scenePreviewDraftRefresh').scrollIntoView({block:'center'})");
    assert.equal(await evaluate("document.querySelector('#projectBuildDialog').scrollWidth <= document.querySelector('#projectBuildDialog').clientWidth"), true, 'preview modal fits390px');
    await readOnlyButtons(); await assertDraftInput(draftSource); await screenshot(`draft-narrow-${language}.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");
  report.steps.push('Chinese, English and Japanese draft preview controls fit a390px viewport while preserving the same source draft and read-only scene controls.');

  // Follow the user workflow: close the modal, edit the visible textarea, reopen.
  await delay(200); const lastValidCanvas = await canvasSignature();
  const invalidSource = draftSource.slice(0, -4); await closePreview(); await fill('#docSourceEditor', invalidSource); await openPreview(); const invalid = await latest();
  assert.ok(invalid.request.draft, 'reopening the same scene resumes its draft preview mode');
  assert.equal(invalid.payload.ok, false); assert.ok(invalid.payload.diagnostics.some(item => item.code === 'build_scene_json'));
  assert.equal(await evaluate("document.querySelector('#scenePreviewCanvas').hidden"), false);
  assert.equal(await canvasSignature(), lastValidCanvas, 'invalid JSON keeps decoded last valid image pixels');
  await assertDraftInput(invalidSource); await readOnlyButtons(); assert.deepEqual(await sourceTree(root), initial);
  await screenshot('draft-invalid-keeps-preview-zh.png');
  const invalidSelection = await evaluate("(() => {const e=document.querySelector('#docSourceEditor');return [e.selectionStart,e.selectionEnd];})()");
  await click(`#scenePreviewObjects button[data-group-source="${groupIds[0]}"]`);
  await wait(() => evaluate("!document.querySelector('#projectBuildDialog').open"), 'stale last-valid source navigation');
  await assertDraftInput(invalidSource);
  assert.equal(await evaluate("document.querySelector('#docEditStatus').textContent.includes('草稿已变化')"), true);
  assert.deepEqual(await evaluate("(() => {const e=document.querySelector('#docSourceEditor');return [e.selectionStart,e.selectionEnd];})()"), invalidSelection, 'old valid preview must not select a range in newer invalid text');
  const cyclic = structuredClone(draft); cyclic.groups[0].parentGroupId = groupIds[1]; const cyclicSource = serialize(cyclic);
  await fill('#docSourceEditor', cyclicSource); await openPreview(); const cycle = await latest();
  assert.equal(cycle.payload.ok, false); assert.ok(cycle.payload.diagnostics.some(item => item.code === 'build_group_cycle'));
  assert.equal(await canvasSignature(), lastValidCanvas); await assertDraftInput(cyclicSource);
  const cycleDiagnostic = cycle.payload.diagnostics.find(item => item.code === 'build_group_cycle');
  assert.equal(cycleDiagnostic.sourceRevision, `sha256:${buildHash(cyclicSource)}`);
  await click('#scenePreviewDiagnostics button');
  await wait(() => evaluate("document.activeElement.id === 'docSourceEditor' && !document.querySelector('#projectBuildDialog').open"), 'invalid draft diagnostic source focus');
  assert.equal(await evaluate("document.querySelector('#docEditStatus').textContent.includes('已定位草稿字段')"), true);
  await assertDraftInput(cyclicSource);
  report.steps.push('Returning to the visible source editor, writing unfinished JSON or a nested-group cycle, and reopening the same scene preserves the last valid actor/background pixel samples and frozen images. Old valid-preview source links preserve the newer text and cursor; current invalid-draft diagnostics can select their own exact field. No author write is enabled.');

  await fill('#docSourceEditor', draftSource); await openPreview(); await refreshDraft(); const draftPixels = await canvasSignature();
  const saved = await refreshSaved(); assert.equal(saved.request.draft, undefined); assert.deepEqual(saved.payload.actors[0].position, [160, 200]);
  assert.notEqual(await canvasSignature(), draftPixels, 'explicit saved refresh switches the rendered content');
  await assertDraftInput(draftSource); await readOnlyButtons();
  assert.deepEqual(await sourceTree(root), initial);
  const afterBuild = await captureBuildSnapshot(root, scene.objectId); assert.equal(afterBuild.snapshotId, savedBuild.snapshotId);
  assert.deepEqual(afterBuild.plan, savedBuild.plan); assert.equal((await buildState()).job, null);
  report.savedSnapshotId = savedBuild.snapshotId;
  report.steps.push('Explicit saved refresh restores saved positions without discarding the source draft. Saved build snapshot and plan remain byte-identical and no build job is started.');

  await refreshDraft(); const beforeConflictCanvas = await canvasSignature();
  const externalSource = originalSource.replace('原文 Town😀', '外部 External😀'); await write(scene.sourcePath, externalSource);
  const conflict = await refreshDraft(); assert.equal(conflict.status, 409); await assertDraftInput(draftSource); await readOnlyButtons();
  assert.equal(await fs.readFile(path.join(root, scene.sourcePath), 'utf8'), externalSource);
  assert.equal(await canvasSignature(), beforeConflictCanvas); await screenshot('draft-conflict-preserves-input-zh.png');
  report.conflict = conflict.payload;
  await write(scene.sourcePath, originalSource); assert.deepEqual(await sourceTree(root), initial);
  report.steps.push('An external saved-source change makes the draft baseline stale. HTTP409 preserves the current source draft and last valid image, and never overwrites the external file; the isolated fixture is restored afterwards.');

  await closePreview(); await assertDraftInput(draftSource);
  assert.equal((await buildState()).job, null); assert.deepEqual(report.errors, []); assert.deepEqual(report.svgRequests, []);
  report.created = { sceneId: scene.objectId, instanceIds, groupIds }; report.authorFiles = await sourceTree(root);
  report.captures = await evaluate('window.__sceneCaptures'); report.ok = true;
} catch (error) { report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1; try { await captureFailure?.(); } catch (e) { report.captureFailure = e.message; } }
finally { socket?.close(); for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), json(report)); console.log(JSON.stringify({ ok: report.ok, steps: report.steps, limitations: report.limitations, failure: report.failure, output }, null, 2)); }
