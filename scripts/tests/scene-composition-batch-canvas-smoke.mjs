// Real browser atomic multi-instance canvas layout → guarded source draft → ordinary save in a disposable recipe.
// Run: VIENTO_COMPOSITION_BATCH_OUTPUT=/empty/evidence/path node scripts/tests/scene-composition-canvas-smoke.mjs [chromium]
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
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.env.VIENTO_COMPOSITION_BATCH_OUTPUT || path.join(os.tmpdir(), `viento-composition-batch-evidence-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_COMPOSITION_BATCH_OUTPUT directory; prior evidence is immutable.');
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], errors: [], svgRequests: [], limitations: [
  'Real HTTP editor and Chrome only; no installed Tauri window or Android device acceptance.',
  'Multi-instance position-only canvas layout in one existing recipe source session. No shared template editing, placement-offset change, executable recipe build or cross-file transaction.',
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-composition-batch-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'workspace'), template = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank');
  const write = async (relative, content) => { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); };
  for (const name of ['documents', 'templates', 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(root, name), { recursive: true });
  await write('workspace.json', json({ format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Composition preview smoke', createdAt: 0,
    ...WORKSPACE_LAYOUT, documentTypes: template.documentTypes }));
  for (const [name, content] of Object.entries(template.templates)) await write(`templates/${name}`, content);
  await registerWorkspace(root);
  const execute = createWorldCommandService(root);
  const create = async (command, sourcePath, content) => {
    const view = await readWorldProjection(root), request = { command, mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
      actorRef: { kind: 'tool', id: 'composition-preview-smoke' }, objectId: randomUUID(), documentType: 'document', sourcePath, content };
    await execute(request); return request;
  };
  const core = await create('object.create', 'documents/core.md', '\uFEFF# Traveler / 旅人\r\n\r\n故事属于原 OC。  \r\n');
  const images = [];
  for (const color of ['#44aaee', '#ee6644']) {
    const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><script>fetch('http://127.0.0.1:9/viento-preview-script');top.__sceneSvgExecuted=true;</script><image href="http://127.0.0.1:9/viento-preview-external.png" width="1" height="1"/><rect width="32" height="32" fill="${color}"/></svg>`);
    const imported = await importMediaAsset(root, Readable.from([bytes]), `${color.slice(1)}.svg`); images.push(imported.asset);
  }
  const declaration = JSON.parse(await fs.readFile(path.join(appRoot, 'examples/scene-composition/recipe.json')));
  for (const [index, actor] of declaration.fragments[0].actors.entries()) { actor.objectId = core.objectId; actor.imageResourceId = images[index].id; }
  declaration.placements[1].overrides.push({ actorKey: 'companion', values: { speed: 0 } });
  const groupIds = declaration.placements.flatMap(item => Object.values(item.groupIds)), instanceIds = declaration.placements.flatMap(item => Object.values(item.actorIds));
  const serialize = value => '\uFEFF' + json(value).replaceAll('\n', '\r\n');
  const originalSource = serialize(declaration);
  const scene = await create('object.create', 'documents/scenes/recipe.json', originalSource);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root, XDG_CACHE_HOME: path.join(temporary, 'cache') };
  delete env.VIENTO_GODOT_BIN; delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
  const initial = await sourceTree(root), rejectedBuild = await captureBuildSnapshot(root, scene.objectId), base = await serve(t, appRoot, env);
  assert.equal(rejectedBuild.ok, false); assert.ok(rejectedBuild.diagnostics.some(item => item.code === 'build_scene_format'));
  const buildState = async () => { const response = await fetch(`${base}/api/project-build`); assert.equal(response.status, 200); const body = await response.json(); return body.data || body; };
  const catalog = await buildState(); assert.equal(catalog.available, false); assert.equal(catalog.job, null);
  assert.equal(catalog.scenes.length, 0); assert.equal(catalog.previewDocuments.find(item => item.id === scene.objectId)?.kind, 'composition');
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
    else if (value.method === 'Page.javascriptDialogOpening') { report.confirmations ||= []; report.confirmations.push(value.params.message); void call('Page.handleJavaScriptDialog', { accept: true }); }
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
      if (window.__holdNextPreview) { window.__holdNextPreview = false; window.__heldPreview = true; await new Promise(resolve => { window.__releasePreview = resolve; }); }
    } return response;
  }; })()`);
  const latest = () => evaluate('window.__sceneCaptures.at(-1)');
  const captureCount = () => evaluate('window.__sceneCaptures.length');
  const editorText = () => evaluate("document.querySelector('#docSourceEditor').value");
  const modalBusy = () => evaluate("document.querySelector('#projectBuildPreviewPanel').getAttribute('aria-busy') === 'true'");
  const waitCapture = async count => { await wait(async () => await captureCount() > count && !(await modalBusy()), 'preview response and images complete'); return latest(); };
  const refreshDraft = async () => { await enabled('#scenePreviewDraftRefresh'); const count = await captureCount(); await click('#scenePreviewDraftRefresh'); return waitCapture(count); };
  const refreshSaved = async () => { await enabled('#scenePreviewRefresh'); const count = await captureCount(); await click('#scenePreviewRefresh'); return waitCapture(count); };
  const openPreview = async (waitReady = true) => { await click('#projectBuildBtn'); await enabled('#projectBuildTabPreview'); await click('#projectBuildTabPreview'); await enabled('#projectBuildScene'); await fill('#projectBuildScene', scene.objectId, 'change');
    await wait(() => evaluate("document.querySelector('#projectBuildDialog').open && !document.querySelector('#projectBuildPreviewPanel').hidden"), 'preview panel'); if (waitReady) await enabled('#scenePreviewRefresh'); };
  const closePreview = async () => { await click('#projectBuildClose'); await wait(() => evaluate("!document.querySelector('#projectBuildDialog').open"), 'return editor'); };
  const canvasSignature = async () => {
    const result = await evaluate(`(async () => {
      const canvas = document.querySelector('#scenePreviewCanvas'), bounds = canvas.getBoundingClientRect();
      const { fitSceneView, sceneToCanvas } = await import('/web/modules/app-scene-preview-canvas.js');
      const view = fitSceneView([800, 480], bounds.width, bounds.height), context = canvas.getContext('2d');
      // Sample actor interiors and background in world coordinates, avoiding label
      // rasterization and subpixel borders after the modal is resized or reopened.
      const samples = [[120,180],[200,180],[480,260],[560,260],[510,310],[48,48]].map(point => {
        const [x,y] = sceneToCanvas(view,...point);
        return [...context.getImageData(Math.floor(x*canvas.width/bounds.width),Math.floor(y*canvas.height/bounds.height),1,1).data];
      });
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canvas.toDataURL()));
      return {samples,width:canvas.width,height:canvas.height,cssWidth:bounds.width,cssHeight:bounds.height,
        pngSha256:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')};
    })()`);
    (report.canvasSamples ||= []).push(result); return JSON.stringify(result.samples);
  };
  const readOnlyButtons = async () => {
    for (const id of ['scenePreviewEdit','scenePreviewLayoutEdit','scenePreviewDraftLayoutEdit']) {
      assert.equal(await evaluate(`document.querySelector('#${id}').hidden && document.querySelector('#${id}').disabled`), true, `${id} must stay read-only`);
      await click(`#${id}`);
    }
    assert.equal(await evaluate(`Boolean(document.querySelector('#sceneLayoutDialog')?.open || document.querySelector('#sceneCreateDialog')?.open)`), false);
    assert.equal((await buildState()).job, null);
  };
  const assertDraftInput = async value => assert.equal(await editorText(), value.replace(/\r\n|\r/g, '\n'), 'draft input retained including Unicode and BOM');
  const selectActor = () => click(`#scenePreviewObjects button[data-actor-id="${instanceIds[3]}"]`);
  const selection = () => evaluate(`(() => { const e=document.querySelector('#docSourceEditor'); return {text:e.value.slice(e.selectionStart,e.selectionEnd),status:document.querySelector('#docEditStatus').textContent}; })()`);
  const waitSelection = expected => wait(async () => { try { return JSON.stringify(JSON.parse((await selection()).text)) === JSON.stringify(expected); } catch { return false; } }, 'exact source token after dialog focus restoration');

  await openPreview(); await wait(async () => (await latest())?.payload?.ok && !(await modalBusy()), 'saved recipe');
  const saved = (await latest()).payload;
  assert.equal(saved.actors.length, 4); assert.equal(saved.sceneEditing, undefined); await readOnlyButtons();
  assert.equal(await evaluate("document.querySelector('#scenePreviewCompositionBatchLayout').disabled"), true);
  await click('#scenePreviewSource'); await wait(() => evaluate("document.activeElement.id === 'docSourceEditor' && !document.querySelector('#projectBuildDialog').open"), 'clean recipe source');
  const readScene = () => fs.readFile(path.join(root, scene.sourcePath), 'utf8');
  await evaluate("window.__appState=(await import('/web/modules/app-state.js')).appState");
  const state = () => evaluate('({dirty:window.__appState.editHasUnsavedChanges,base:window.__appState.activeEditSourceVersion})');
  const cleanState = await state(); assert.equal(cleanState.dirty, false);
  const el = suffix => '#sceneCompositionBatchLayout' + suffix;
  const batchOpen = async () => { await enabled('#scenePreviewCompositionBatchLayout'); await click('#scenePreviewCompositionBatchLayout');
    await wait(() => evaluate("document.querySelector('#sceneCompositionBatchLayoutDialog')?.open && !document.querySelector('#sceneCompositionBatchLayoutSelectAll').disabled"), 'batch canvas'); };
  const group = async index => { await click(`${el('Objects')} button[data-group-id="${groupIds[index]}"]`); };
  const check = async () => { await enabled(el('Check')); const count = await captureCount(); await click(el('Check')); await enabled(el('Apply'));
    assert.ok(await captureCount() > count); return evaluate("document.querySelector('#sceneCompositionBatchLayoutSource').textContent"); };
  const cancel = async () => { await enabled(el('Cancel')); await click(el('Cancel')); await wait(() => evaluate("!document.querySelector('#sceneCompositionBatchLayoutDialog').open"), 'cancel batch'); };
  const apply = async () => { await enabled(el('Apply')); await click(el('Apply')); await wait(() => evaluate("!document.querySelector('#sceneCompositionBatchLayoutDialog').open && !document.querySelector('#projectBuildDialog').open && document.activeElement.id==='docSourceEditor'"), 'batch applied to source'); };
  const key = async (name, code, virtual, shift = false) => {
    await evaluate("document.querySelector('#sceneCompositionBatchLayoutCanvas').focus()");
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: virtual, modifiers: shift ? 8 : 0 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: virtual });
  };
  const drag = async (position, delta) => {
    await click(el('Fit'));
    const point = await evaluate(`(async()=>{const c=document.querySelector('#sceneCompositionBatchLayoutCanvas');c.scrollIntoView({block:'center'});const b=c.getBoundingClientRect(),m=await import('/web/modules/app-scene-preview-canvas.js'),v=m.fitSceneView([800,480],b.width,b.height);const f=m.sceneToCanvas(v,...${JSON.stringify(position)}),t=m.sceneToCanvas(v,...${JSON.stringify(position.map((x,i)=>x+delta[i]))});return {from:[b.left+f[0],b.top+f[1]],to:[b.left+t[0],b.top+t[1]]};})()`);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.from[0], y: point.from[1], button: 'left', buttons: 1, clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.to[0], y: point.to[1], button: 'left', buttons: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.to[0], y: point.to[1], button: 'left', buttons: 0, clickCount: 1 });
  };
  const unchanged = async () => { assert.deepEqual(await sourceTree(root), initial); assert.equal(await readScene(), originalSource); };
  await openPreview(); await refreshSaved(); await batchOpen(); await group(0);
  assert.equal(await evaluate("document.querySelector('#sceneCompositionBatchLayoutCoordinates').hidden"), true);
  await click(el('AlignLeft')); let candidate = await check();
  assert.deepEqual((await latest()).payload.actors.map(a => a.position), [[120,180],[112,180],[460,220],[560,260]]);
  await click(el('Undo')); assert.equal(await evaluate("document.querySelector('#sceneCompositionBatchLayoutCheck').disabled"), true);
  await click(el('Redo')); await check(); assert.deepEqual((await latest()).payload.actors[1].position, [112,180]);
  await click(el('Undo')); await drag([120,180], [40,30]); await check();
  const moved = (await latest()).payload.actors.map(a => a.position);
  assert.ok(Math.abs(moved[0][0] - 160) < 1e-6 && Math.abs(moved[0][1] - 210) < 1e-6);
  assert.ok(Math.abs(moved[1][0] - moved[0][0] - 80) < 1e-6 && Math.abs(moved[1][1] - moved[0][1]) < 1e-6);
  assert.deepEqual(moved.slice(2), saved.actors.slice(2).map(a => a.position));
  await click(el('Undo')); assert.equal(await evaluate("document.querySelector('#sceneCompositionBatchLayoutCheck').disabled"), true);
  await click(el('Redo')); await check(); assert.deepEqual((await latest()).payload.actors.map(a => a.position), moved);
  await cancel(); await closePreview(); await assertDraftInput(originalSource); assert.deepEqual(await state(), cleanState); await unchanged();
  report.steps.push('Group descendant selection drives actual canvas batch dragging and size-aware left alignment. Each action undoes/redoes as one Rust history step; sibling placement positions and author bytes remain unchanged when cancelled.');

  await openPreview(); await refreshSaved(); await batchOpen();
  // Search changes only the visible outline; explicit select-all still owns all four instances.
  await fill(el('Search'), 'companion'); await click(el('SelectAll'));
  await key('ArrowRight','ArrowRight',39,true); await check();
  assert.deepEqual((await latest()).payload.actors.map(a=>a.position), saved.actors.map(a=>[a.position[0]+10,a.position[1]]));
  await click(el('Undo')); assert.equal(await evaluate("document.querySelector('#sceneCompositionBatchLayoutCheck').disabled"),true);
  await fill(el('Search'), ''); await group(0); await key('ArrowRight','ArrowRight',39,true);
  await group(2); await key('ArrowDown','ArrowDown',40,true); candidate = await check();
  const expectedPositions = [[130,180],[210,180],[460,230],[560,270]], reviewed = JSON.parse(candidate.replace(/^\ufeff/,''));
  assert.deepEqual((await latest()).payload.actors.map(a=>a.position),expectedPositions);
  assert.deepEqual(reviewed.fragments,declaration.fragments);
  assert.deepEqual(reviewed.placements[0].overrides,[{actorKey:'leader',values:{position:[130,180]}},{actorKey:'companion',values:{position:[210,180]}}]);
  assert.deepEqual(reviewed.placements[1].overrides[0].values,{...declaration.placements[1].overrides[0].values,position:[100,150]});
  assert.deepEqual(reviewed.placements[1].overrides[1],{actorKey:'companion',values:{speed:0,position:[200,190]}});
  assert.deepEqual(reviewed.placements.map(p=>p.actorIds),declaration.placements.map(p=>p.actorIds));
  assert.deepEqual(reviewed.placements.map(p=>p.groupIds),declaration.placements.map(p=>p.groupIds));
  assert.deepEqual(reviewed.placements.map(p=>p.offset),declaration.placements.map(p=>p.offset));
  assert.ok(candidate.startsWith('\ufeff') && candidate.includes('\r\n')); await unchanged();
  assert.equal(await evaluate("document.querySelector('#sceneCompositionBatchLayoutTargets').children.length"),4);
  for (const locale of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(locale)})`);
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await delay(100); await evaluate("document.querySelector('#sceneCompositionBatchLayoutCheck').scrollIntoView({block:'end'})");
    const bounds=await evaluate("(()=>{const d=document.querySelector('#sceneCompositionBatchLayoutDialog'),b=d.getBoundingClientRect();return {left:b.left,right:b.right,scrollWidth:d.scrollWidth,width:d.clientWidth,apply:document.querySelector('#sceneCompositionBatchLayoutApply').disabled};})()");
    assert.ok(bounds.left>=0 && bounds.right<=391 && bounds.scrollWidth<=bounds.width+1); assert.equal(bounds.apply,false);
    assert.equal(await evaluate("document.querySelector('#sceneCompositionBatchLayoutSource').textContent"),candidate);
    await screenshot('batch-narrow-'+locale+'.png');
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");
  await evaluate("document.querySelector('#sceneCompositionBatchLayoutReview').open=true"); await screenshot('batch-source-review.png');
  await apply(); await assertDraftInput(candidate); assert.equal((await state()).dirty,true); assert.equal((await state()).base,cleanState.base); await unchanged();
  report.steps.push('Search/select-all and real Shift+arrow keys create four atomic local position changes across two placements. The complete reviewed candidate and three390px locale layouts preserve IDs, offsets, shared fragments, other override fields and exact source bytes. Apply changes only editor memory.');
  await enabled('#docSaveBtn'); await click('#docSaveBtn'); await wait(async()=>!(await state()).dirty,'normal Save');
  assert.equal(await readScene(),candidate); const savedTree=await sourceTree(root); assert.deepEqual(Object.keys(savedTree).filter(k=>savedTree[k]!==initial[k]),[scene.sourcePath]);
  await openPreview(); const reopened=(await refreshSaved()).payload;
  assert.deepEqual(reopened.actors.map(a=>a.position),expectedPositions); assert.deepEqual(reopened.actors.map(a=>a.instanceId),instanceIds);
  assert.deepEqual(reopened.sceneStructure,saved.sceneStructure); await readOnlyButtons();
  report.steps.push('Normal Save persists only the original recipe file; reopened preview retains all four stable instances and groups, author metadata and images. No executable job or reverse editing of a generated scene is introduced.');

  await batchOpen(); await click(`${el('Objects')} button[data-actor-id="${instanceIds[3]}"]`); await fill(el('X'),'580','change'); await check();
  await evaluate("document.querySelector('#sceneCompositionBatchLayoutX').value='590'"); await click(el('Apply'));
  assert.equal(await evaluate("document.querySelector('#sceneCompositionBatchLayoutApply').disabled"),true);
  await click(el('SelectAll')); assert.equal(await evaluate("document.querySelector('#sceneCompositionBatchLayoutCoordinates').hidden"),false);
  await cancel(); await closePreview(); await assertDraftInput(candidate); assert.equal(await readScene(),candidate);
  report.steps.push('A single coordinate changed without an input event cannot reuse batch review approval or escape validation through changing selection; cancelling retains the saved recipe.');

  await openPreview(); await refreshSaved(); await batchOpen(); await click(el('SelectAll')); await key('ArrowRight','ArrowRight',39); await check();
  const external=candidate.replace('Two parties','External batch / 外部'); await write(scene.sourcePath,external);
  await apply(); const unsaved=await editorText(); await enabled('#docSaveBtn'); await click('#docSaveBtn');
  await wait(()=>evaluate("!document.querySelector('#docSaveConflictDialog').classList.contains('is-hidden')"),'external normal-save conflict');
  assert.equal(await readScene(),external); assert.equal(await editorText(),unsaved); await screenshot('batch-save-conflict.png');
  await click('#docSaveConflictCancelBtn'); assert.equal(await readScene(),external); assert.equal(await editorText(),unsaved); assert.equal((await state()).dirty,true);
  await write(scene.sourcePath,candidate); assert.deepEqual(await sourceTree(root),savedTree);
  report.steps.push('An external write after batch review is protected by ordinary Save baseline conflict handling. Cancelling retains both external author bytes and the complete local layout draft without forcing a write.');
  assert.deepEqual(report.errors,[]); assert.deepEqual(report.svgRequests,[]); assert.equal((await buildState()).job,null);
  report.created={recipeId:scene.objectId,instanceIds,groupIds}; report.authorFiles=await sourceTree(root); report.captures=await evaluate('window.__sceneCaptures');
  report.normalSave={sourceSha256:buildHash(candidate),onlyChangedFile:scene.sourcePath};
  report.layout={physicalBatchDrag:true,sizeAwareAlignment:true,rustBatchUndoRedo:true,searchAndSelectAll:true,worldToLocalPerPlacement:true,fourTargetAtomicApply:true,ordinarySave:true,stableIds:true}; report.ok=true;
} catch (error) { report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1; try { await captureFailure?.(); } catch (e) { report.captureFailure = e.message; } }
finally { socket?.close(); for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), json(report)); console.log(JSON.stringify({ ok: report.ok, steps: report.steps, limitations: report.limitations, failure: report.failure, output }, null, 2)); }
