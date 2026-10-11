// Real browser single-instance canvas layout → guarded source draft → ordinary save in a disposable recipe.
// Run: VIENTO_COMPOSITION_CANVAS_OUTPUT=/empty/evidence/path node scripts/tests/scene-composition-canvas-smoke.mjs [chromium]
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
const output = path.resolve(process.env.VIENTO_COMPOSITION_CANVAS_OUTPUT || path.join(os.tmpdir(), `viento-composition-canvas-evidence-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_COMPOSITION_CANVAS_OUTPUT directory; prior evidence is immutable.');
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], errors: [], svgRequests: [], limitations: [
  'Real HTTP editor and Chrome only; no installed Tauri window or Android device acceptance.',
  'Single-instance position-only canvas layout in one existing recipe source session. No multi-selection, shared template editing, placement-offset change, executable recipe build or cross-file transaction.',
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-composition-canvas-browser-'));
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

  await openPreview(); await wait(async () => (await latest())?.payload?.ok && !(await modalBusy()), 'initial recipe saved capture');
  const saved = (await latest()).payload;
  assert.equal(saved.composition.recipeObjectId, scene.objectId); assert.equal(saved.composition.fragmentCount, 1); assert.equal(saved.composition.placementCount, 2);
  assert.equal(saved.actors.length, 4); assert.equal(saved.sceneStructure.groups.length, 4); assert.equal(saved.sceneEditing, undefined);
  assert.equal(await evaluate(`document.querySelector('#scenePreviewComposition').hidden`), false);
  await selectActor(); await readOnlyButtons(); await screenshot('recipe-saved-zh.png');
  const picker = await evaluate(`Array.from(document.querySelector('#projectBuildScene').options, option => option.value)`); assert.ok(picker.includes(scene.objectId));
  await click('#projectBuildTabBuild');
  assert.equal(await evaluate(`Array.from(document.querySelector('#projectBuildScene').options, option => option.value).includes('${scene.objectId}')`), false);
  assert.equal(await evaluate(`document.querySelector('#projectBuildPlan').disabled && document.querySelector('#projectBuildGenerate').disabled`), true);
  await click('#projectBuildPlan'); assert.equal((await buildState()).job, null);
  await click('#projectBuildTabPreview'); await wait(async () => (await latest())?.payload?.ok && !(await modalBusy()), 'recipe restored after tab switch');
  assert.deepEqual(await sourceTree(root), initial);
  report.steps.push('A recipe-only project lists its ordinary JSON document in the preview picker, renders four generated instances/groups and frozen images, and exposes fragment/placement identities. Scene editing is blocked and the build tab contains no recipe or executable job.');



  const readScene = () => fs.readFile(path.join(root,scene.sourcePath),'utf8');
  const state = () => evaluate(`(() => {const s=window.__appState;return {dirty:s.editHasUnsavedChanges,base:s.activeEditSourceVersion};})()`);
  await evaluate(`(window.__appState=(await import('/web/modules/app-state.js')).appState)`);
  const layoutOpen = async () => {
    await selectActor(); await enabled('#scenePreviewCompositionLayout'); await click('#scenePreviewCompositionLayout');
    await wait(()=>evaluate(`document.querySelector('#sceneCompositionLayoutDialog')?.open && !document.querySelector('#sceneCompositionLayoutX').disabled`),'single instance canvas layout');
  };
  const coordinates = () => evaluate(`['X','Y'].map(s=>Number(document.querySelector('#sceneCompositionLayout'+s).value))`);
  const check = async () => {
    await enabled('#sceneCompositionLayoutCheck'); const before=await captureCount(); await click('#sceneCompositionLayoutCheck');
    await enabled('#sceneCompositionLayoutApply'); assert.ok(await captureCount()>before,'actual dependency preview requested');
    return evaluate(`document.querySelector('#sceneCompositionLayoutSource').textContent`);
  };
  const apply = async () => {
    await enabled('#sceneCompositionLayoutApply'); await click('#sceneCompositionLayoutApply');
    await wait(()=>evaluate(`!document.querySelector('#sceneCompositionLayoutDialog').open && !document.querySelector('#projectBuildDialog').open && document.activeElement.id==='docSourceEditor'`),'layout applied only to current source and source focus restored');
  };
  const cancel = async () => { await enabled('#sceneCompositionLayoutCancel'); await click('#sceneCompositionLayoutCancel'); await wait(()=>evaluate(`!document.querySelector('#sceneCompositionLayoutDialog').open`),'cancel layout'); };
  const drag = async (position, delta) => {
    await click('#sceneCompositionLayoutFit');
    const point=await evaluate(`(async()=>{const canvas=document.querySelector('#sceneCompositionLayoutCanvas');canvas.scrollIntoView({block:'center'});const b=canvas.getBoundingClientRect();const m=await import('/web/modules/app-scene-preview-canvas.js');const view=m.fitSceneView([800,480],b.width,b.height);const from=m.sceneToCanvas(view,...${JSON.stringify(position)}),to=m.sceneToCanvas(view,...${JSON.stringify(position.map((v,i)=>v+delta[i]))});return {from:[b.left+from[0],b.top+from[1]],to:[b.left+to[0],b.top+to[1]]};})()`);
    await call('Input.dispatchMouseEvent',{type:'mousePressed',x:point.from[0],y:point.from[1],button:'left',buttons:1,clickCount:1});
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.to[0],y:point.to[1],button:'left',buttons:1});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.to[0],y:point.to[1],button:'left',buttons:0,clickCount:1});
  };
  const key = async (name, code, vkey) => {
    await evaluate(`document.querySelector('#sceneCompositionLayoutCanvas').focus()`);
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:name,code,windowsVirtualKeyCode:vkey});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:name,code,windowsVirtualKeyCode:vkey});
  };
  const unchanged = async baseline => { assert.deepEqual(await sourceTree(root),baseline); assert.equal(await readScene(),originalSource); };
  await click('#scenePreviewSource'); await wait(()=>evaluate(`document.activeElement.id==='docSourceEditor' && !document.querySelector('#projectBuildDialog').open`),'clean recipe source');
  const cleanState=await state(); assert.equal(cleanState.dirty,false);
  await openPreview(); await refreshSaved(); await layoutOpen();
  assert.deepEqual(await coordinates(),saved.actors[3].position); assert.match(await evaluate(`document.querySelector('#sceneCompositionLayoutOffset').textContent`),/360.*80/);
  assert.equal(await evaluate(`document.querySelector('#sceneCompositionLayoutCheck').disabled`),true);
  await drag(saved.actors[2].position,[40,20]); assert.deepEqual(await coordinates(),saved.actors[3].position);
  assert.equal(await evaluate(`document.querySelector('#sceneCompositionLayoutUndo').disabled`),true);
  await drag(saved.actors[3].position,[60,30]);
  const moved=await coordinates(); assert.ok(Math.abs(moved[0]-620)<1e-6 && Math.abs(moved[1]-290)<1e-6,'physical target drag changes position');
  await enabled('#sceneCompositionLayoutUndo'); await click('#sceneCompositionLayoutUndo'); assert.deepEqual(await coordinates(),saved.actors[3].position);
  await click('#sceneCompositionLayoutRedo'); assert.deepEqual(await coordinates(),moved);
  await fill('#sceneCompositionLayoutX','560','change'); await fill('#sceneCompositionLayoutY','260','change');
  assert.equal(await evaluate(`document.querySelector('#sceneCompositionLayoutCheck').disabled`),true,'back at original world position creates no override');
  await cancel(); await assertDraftInput(originalSource); assert.deepEqual(await state(),cleanState); await unchanged(initial);
  report.steps.push('Actual pointer input cannot move a sibling UUID. Target drag commits one Rust history step, undo/redo works, returning to original position proposes nothing, and cancel preserves exact source baseline and author bytes.');

  await layoutOpen(); await fill('#sceneCompositionLayoutX','-100000','change');
  assert.equal(await evaluate(`document.querySelector('#sceneCompositionLayoutCheck').disabled`),true);
  await enabled('#sceneCompositionLayoutUndo'); await click('#sceneCompositionLayoutUndo');
  assert.deepEqual(await coordinates(),saved.actors[3].position);
  assert.equal(await evaluate(`document.querySelector('#sceneCompositionLayoutCheck').disabled`),true);
  await cancel(); await unchanged(initial);
  report.steps.push('A valid world coordinate whose local coordinate exceeds the offset-adjusted bound is rejected before Rust history changes. Undo abandons only the unfinished numeric input.');

  await layoutOpen(); await drag(saved.actors[3].position,[60,30]);
  // Numeric input fixes physical CSS subpixel coordinates for an exact source assertion.
  await fill('#sceneCompositionLayoutX','620','change'); await fill('#sceneCompositionLayoutY','290','change');
  await key('ArrowRight','ArrowRight',39); assert.deepEqual(await coordinates(),[621,290]);
  let candidate=await check(); const checked=JSON.parse(candidate.replace(/^\ufeff/,''));
  assert.deepEqual(checked.fragments,declaration.fragments); assert.deepEqual(checked.placements[0],declaration.placements[0]);
  assert.deepEqual(checked.placements[1].actorIds,declaration.placements[1].actorIds);
  assert.deepEqual(checked.placements[1].groupIds,declaration.placements[1].groupIds);
  assert.deepEqual(checked.placements[1].offset,declaration.placements[1].offset);
  assert.deepEqual(checked.placements[1].overrides[0],declaration.placements[1].overrides[0]);
  assert.deepEqual(checked.placements[1].overrides[1],{actorKey:'companion',values:{speed:0,position:[261,210]}});
  assert.equal(candidate.startsWith('\ufeff'),true); assert.equal(candidate.includes('\r\n'),true);
  assert.deepEqual((await latest()).payload.actors.map(a=>a.instanceId),instanceIds);
  assert.deepEqual((await latest()).payload.actors[3].position,[621,290]); await unchanged(initial);
  await click('#sceneCompositionLayoutUndo'); assert.equal(await evaluate(`document.querySelector('#sceneCompositionLayoutApply').disabled`),true);
  await click('#sceneCompositionLayoutRedo'); candidate=await check();
  for(const locale of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(locale)})`);
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await delay(100); await evaluate(`document.querySelector('#sceneCompositionLayoutCheck').scrollIntoView({block:'end'})`);
    const bounds=await evaluate(`(()=>{const d=document.querySelector('#sceneCompositionLayoutDialog'),b=d.getBoundingClientRect();return {left:b.left,right:b.right,scrollWidth:d.scrollWidth,width:d.clientWidth,apply:document.querySelector('#sceneCompositionLayoutApply').disabled};})()`);
    assert.ok(bounds.left>=0 && bounds.right<=391 && bounds.scrollWidth<=bounds.width+1); assert.equal(bounds.apply,false);
    assert.equal(await evaluate(`document.querySelector('#sceneCompositionLayoutSource').textContent`),candidate);
    await screenshot('canvas-narrow-'+locale+'.png');
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await screenshot('canvas-source-review.png'); await apply();
  await assertDraftInput(candidate); assert.equal((await state()).dirty,true); assert.equal((await state()).base,cleanState.base); await unchanged(initial);
  report.steps.push('Pointer drag, numeric world coordinates and a real ArrowRight event produce one position-only local override. Full dependency preview, review invalidation by undo/redo and three390px locales preserve the exact approved candidate; applying changes only editor memory.');
  await enabled('#docSaveBtn'); await click('#docSaveBtn'); await wait(async()=>!(await state()).dirty,'ordinary Save completes');
  assert.equal(await readScene(),candidate); const savedTree=await sourceTree(root);
  assert.deepEqual(Object.keys(savedTree).filter(k=>savedTree[k]!==initial[k]),[scene.sourcePath]);
  await openPreview(); const reopened=(await refreshSaved()).payload;
  assert.deepEqual(reopened.actors[3].position,[621,290]); assert.deepEqual(reopened.actors.map(a=>a.instanceId),instanceIds);
  assert.deepEqual(reopened.sceneStructure,saved.sceneStructure); await readOnlyButtons();
  report.steps.push('Ordinary Save persists only recipe bytes, and reopened preview preserves local/world positions, UUIDs, groups, metadata and image bytes. Recipes remain outside executable build and direct-scene layout.');

  await layoutOpen(); await fill('#sceneCompositionLayoutX','631','change'); await check();
  await evaluate(`(()=>{const e=document.querySelector('#sceneCompositionLayoutX');e.value='641';})()`);
  await click('#sceneCompositionLayoutApply'); assert.equal(await evaluate(`document.querySelector('#sceneCompositionLayoutApply').disabled`),true);
  await cancel(); await closePreview(); await assertDraftInput(candidate); assert.equal(await readScene(),candidate);
  report.steps.push('A numeric field changed without an input event cannot reuse review approval or overwrite the source. Cancel keeps the saved recipe intact.');

  await openPreview(); await refreshSaved(); await layoutOpen(); await fill('#sceneCompositionLayoutX','631','change'); await check();
  const external=candidate.replace('Two parties','External canvas / 外部'); await write(scene.sourcePath,external);
  await apply(); const unsaved=await editorText(); await enabled('#docSaveBtn'); await click('#docSaveBtn');
  await wait(()=>evaluate(`!document.querySelector('#docSaveConflictDialog').classList.contains('is-hidden')`),'normal save external conflict');
  assert.equal(await readScene(),external); assert.equal(await editorText(),unsaved);
  await screenshot('canvas-save-conflict.png'); await click('#docSaveConflictCancelBtn');
  await wait(()=>evaluate(`document.querySelector('#docSaveConflictDialog').classList.contains('is-hidden')`),'cancel save conflict');
  assert.equal(await readScene(),external); assert.equal(await editorText(),unsaved); assert.equal((await state()).dirty,true);
  await write(scene.sourcePath,candidate); assert.deepEqual(await sourceTree(root),savedTree);
  report.steps.push('An external edit after layout review is preserved; ordinary Save reports the original-baseline conflict, and cancellation retains the local layout draft without a force write.');
  assert.deepEqual(report.errors,[]); assert.deepEqual(report.svgRequests,[]); assert.equal((await buildState()).job,null);
  report.created={recipeId:scene.objectId,instanceIds,groupIds}; report.authorFiles=await sourceTree(root); report.captures=await evaluate('window.__sceneCaptures');
  report.normalSave={sourceSha256:buildHash(candidate),onlyChangedFile:scene.sourcePath};
  report.layout={physicalDrag:true,siblingCannotMove:true,rustUndoRedo:true,backToOriginNoop:true,localRangeChecked:true,keyboardNudge:true,worldToLocal:true,ordinarySave:true,stableIds:true}; report.ok=true;
} catch (error) { report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1; try { await captureFailure?.(); } catch (e) { report.captureFailure = e.message; } }
finally { socket?.close(); for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), json(report)); console.log(JSON.stringify({ ok: report.ok, steps: report.steps, limitations: report.limitations, failure: report.failure, output }, null, 2)); }
