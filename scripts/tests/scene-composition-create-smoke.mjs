// Blank project -> GUI OC -> GUI game projection -> new recipe draft -> ordinary save -> Scene2D -> Godot.
// This acceptance owns only a disposable workspace and a fresh evidence directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { readRegistry, registerWorkspace } from '../lib/workspace.mjs';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-composition-create');
const output = path.resolve(process.env.VIENTO_COMPOSITION_CREATE_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/scene-composition-create.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Choose a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to a trusted absolute Godot executable.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome with the local HTTP editor and trusted Godot. This acceptance does not install Tauri or exercise Android, native pickers, or other operating systems.',
  'Only an empty org.viento.blank workspace is assembled before launch; the OC, compatible game projection, recipe and independent Scene2D are created through their actual GUI. Library project creation is not exercised.',
  'Godot verifies built project and headless actor logic. Media import, authored behaviors, ZIP delivery, rendered gameplay and standalone executables retain their separate acceptance evidence.',
] };
const sources = ['engine/scene-composition-create.mjs', 'engine/scene-composition.mjs', 'engine/scene-composition-materialize.mjs',
  'web/modules/app-scene-composition-create.js', 'web/scene-composition-create.css', 'web/modules/app-runtime.js', 'web/modules/app-project-build.js',
  'web/modules/app-studio-system.js', 'engine/studio-modules.mjs', 'web/modules/app-object-projection.js', 'web/modules/app-world-browser.js',
  'scripts/lib/scene-composition-create-service.mjs', 'scripts/lib/doc-api-service.mjs', 'scripts/lib/doc-server-routes.mjs',
  'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/scene-composition-create-smoke.mjs'];
const cleanups = [], fixture = { after: cleanup => cleanups.push(cleanup) }, json = value => JSON.stringify(value, null, 2) + '\n';
const wait = async (check, label, budget = 45000) => { for (let elapsed = 0; elapsed < budget; elapsed += 100) { if (await check()) return; await delay(100); } throw Error('Timed out: ' + label); };
async function authorTree(root) {
  const hashes = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name), name = path.relative(root, file);
    if (name === 'workspace.json' || /^(documents|templates|metadata|assets)\//.test(name)) hashes[name] = buildHash(await fs.readFile(file));
  }
  return hashes;
}
function assertRetained(before, after) { for (const [name, hash] of Object.entries(before)) assert.equal(after[name], hash, `Existing author file changed: ${name}`); }
let socket, captureFailure;
try {
  report.sources = Object.fromEntries(await Promise.all(sources.map(async name => [name, buildHash(await fs.readFile(path.join(appRoot, name)))])));
  report.node = { version: process.version, sha256: buildHash(await fs.readFile(process.execPath)) };
  const version = await runCommand(tool, ['--version'], { cwd: appRoot }); assert.equal(version.code, 0);
  report.tool = { version: version.stdout.trim(), sha256: buildHash(await fs.readFile(tool)) };
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-composition-create-browser-')); report.temporaryRoot = temporary;
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'author'), template = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank');
  for (const name of ['documents', 'templates', 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(root, name), { recursive: true });
  await fs.writeFile(path.join(root, 'workspace.json'), json({ format: 'viento-workspace', version: 3, id: randomUUID(), name: 'OC to composition · OC 到配方 · OC から構成', createdAt: 0, ...WORKSPACE_LAYOUT, documentTypes: template.documentTypes }));
  for (const [name, content] of Object.entries(template.templates)) await fs.writeFile(path.join(root, 'templates', name), content);
  await registerWorkspace(root);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root, VIENTO_GODOT_BIN: tool,
    VIENTO_EXECUTION_BACKEND: 'org.viento.godot4', XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  const rebuilt = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env }); assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
  const initial = await authorTree(root), base = await serve(fixture, appRoot, env);
  const state = async () => { const response = await fetch(`${base}/api/project-build`); assert.equal(response.status, 200); const body = await response.json(); return body.data || body; };
  const world = async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const response = await fetch(`${base}/api/world`), payload = await response.json();
      if (response.status === 409 && ['world_read_conflict', 'world_recovery_required'].includes(payload.errorCode || payload.data?.errorCode)) { await delay(100); continue; }
      assert.equal(response.status, 200, JSON.stringify(payload)); return payload.data || payload;
    }
    throw Error('World remained fenced after publication');
  };
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
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.id) { const request = pending.get(value.id); pending.delete(value.id); value.error ? request?.reject(Error(value.error.message)) : request?.resolve(value.result); }
    else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
    else if (value.method === 'Page.javascriptDialogOpening') { report.dialogs.push({ type: value.params.type, message: value.params.message }); void call('Page.handleJavaScriptDialog', { accept: true }); } });
  const evaluate = async expression => { const value = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true, userGesture: true }); if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value; };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value, event = 'input') => evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled===false&&!document.querySelector(${JSON.stringify(selector)}).hidden`), selector + ' enabled');
  const value = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
  const screenshot = async name => { const result = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(result.data, 'base64')); report.screenshots.push(name); };
  const stableEditor = () => wait(() => evaluate(`(async()=>{const {appState:s}=await import('/web/modules/app-state.js');return !s.isCreating&&!s.editHasUnsavedChanges&&!s.isSaving&&!s.isRebuilding&&!s.isMutatingWorld;})()`), 'ordinary save/index refresh');
  const editorState = () => evaluate(`(async()=>{const {appState:s}=await import('/web/modules/app-state.js');return {activePath:s.activePath,creating:s.isCreating,editing:s.isEditing,source:document.querySelector('#docSourceEditor').value};})()`);
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,saves:window.__recipeSaves,previews:window.__recipePreviews,receipts:window.__worldReceipts})`); report.serviceFailure = await state(); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor startup');
  await evaluate(`(()=>{window.__recipeSaves=[];window.__recipePreviews=[];window.__worldReceipts=[];window.__holdCreateCatalog=false;const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.pathname==='/api/scene-composition-create'&&window.__holdCreateCatalog){window.__catalogHeld=true;await new Promise(resolve=>window.__releaseCatalog=resolve);window.__holdCreateCatalog=false;}const response=await original(input,init);let body;try{body=JSON.parse(init?.body||'null')}catch{};if(url.pathname==='/api/doc'&&body?.create===true){const result=await response.clone().json();window.__recipeSaves.push({request:body,result:result.data||result,status:response.status});}if(url.pathname==='/api/scene-preview'&&init?.method==='POST'){const result=await response.clone().json();window.__recipePreviews.push(result.data||result);}if(body?.command){const result=await response.clone().json();window.__worldReceipts.push({request:body,result:result.data||result,status:response.status});}return response;};})()`);

  assert.equal((await world()).objects.length, 0);
  await enabled('#sceneCompositionCreateBtn'); await click('#sceneCompositionCreateBtn');
  await wait(() => evaluate(`document.querySelector('#sceneCompositionCreateDialog')?.open&&document.querySelector('#sceneCompositionCreateDialog').getAttribute('aria-busy')==='false'`), 'empty composition catalog');
  assert.equal(await evaluate(`document.querySelector('#sceneCompositionCreateApply').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('#sceneCompositionCreateObject').options.length`), 0);
  assert.deepEqual(await authorTree(root), initial); await screenshot('empty-workspace-guidance.png');
  await click('#sceneCompositionCreateCancel');
  report.steps.push('In an empty project the new recipe entry opens guidance, offers no invented actor, disables Create, and writes no author data.');

  await enabled('#worldBrowserBtn'); await click('#worldBrowserBtn'); await enabled('#worldCreate'); await click('#worldCreate');
  const actorPath = 'documents/actors/traveler.md', actorContent = '# Traveler / 旅人 / 旅人\n\n背景故事属于这份 OC。\n';
  await fill('#worldCreatePath', actorPath); await fill('#worldCreateContent', actorContent);
  await click('#worldCreatePreview'); await enabled('#worldCreateApply'); await click('#worldCreateApply');
  await wait(async () => (await world()).objects.length === 1, 'GUI-created OC');
  await enabled('#worldProjectionCreate'); await click('#worldProjectionCreate'); await enabled('#objectProjectionCheck');
  const actor = (await world()).objects[0], projectionPath = 'documents/projections/traveler-player.json';
  await fill('#objectProjectionTemplate', 'builtin:org.viento.projection.rpg-player', 'change');
  await fill('#objectProjectionName', 'Traveler · Player / 旅人 · 玩家'); await fill('#objectProjectionPath', projectionPath);
  await fill('#objectProjectionField-width', '72'); await fill('#objectProjectionField-height', '88');
  await fill('#objectProjectionField-speed', '180'); await fill('#objectProjectionField-color', '#42a8db');
  await click('#objectProjectionCheck'); await enabled('#objectProjectionSave'); await click('#objectProjectionSave');
  await wait(async () => (await world()).objects.length === 2, 'GUI-created game projection');
  await enabled('#objectProjectionClose'); await click('#objectProjectionClose'); await enabled('#worldClose'); await click('#worldClose');
  const projection = (await world()).objects.find(item => item.documentRefs[0].sourcePath === projectionPath);
  assert.equal(projection.provenance.authoredProjection.sourceObjectId, actor.id);
  const beforeRecipe = await authorTree(root); assertRetained(initial, beforeRecipe); assert.equal(await fs.readFile(path.join(root, actorPath), 'utf8'), actorContent);
  report.upstream = { actorObjectId: actor.id, actorPath, projectionObjectId: projection.id, projectionPath, preservedAuthorFiles: beforeRecipe };
  report.steps.push('The ordinary World GUI creates an OC and then a compatible RPG player projection with size 72×88, speed 180 and blue color. Its source relationship points to that OC; no fixture author objects are injected.');

  const recipePath = 'documents/scenes/authored-recipe.json', recipeTitle = 'Journey / 旅程 / 旅';
  await evaluate(`window.__holdCreateCatalog=true`); await enabled('#sceneCompositionCreateBtn'); await click('#sceneCompositionCreateBtn');
  await wait(() => evaluate(`window.__catalogHeld===true`), 'held actual catalog request');
  const busy = await evaluate(`({busy:document.querySelector('#sceneCompositionCreateDialog').getAttribute('aria-busy'),apply:document.querySelector('#sceneCompositionCreateApply').disabled,close:document.querySelector('#sceneCompositionCreateClose').disabled,cancel:document.querySelector('#sceneCompositionCreateCancel').disabled})`);
  assert.equal(busy.busy, 'true'); assert.equal(busy.apply, true); assert.equal(busy.close, false); assert.equal(busy.cancel, false); report.busy = busy;
  assert.deepEqual(await authorTree(root), beforeRecipe); await screenshot('catalog-loading-lock.png');
  await click('#sceneCompositionCreateCancel'); await evaluate(`window.__releaseCatalog()`); await delay(200);
  assert.equal(await evaluate(`document.querySelector('#sceneCompositionCreateDialog').open`), false);
  assert.deepEqual(await authorTree(root), beforeRecipe);
  await enabled('#sceneCompositionCreateBtn'); await click('#sceneCompositionCreateBtn');
  const configureRecipe = async () => {
    await enabled('#sceneCompositionCreateObject'); await fill('#sceneCompositionCreateObject', projection.id, 'change');
    await fill('#sceneCompositionCreateName', recipeTitle); await fill('#sceneCompositionCreateType', 'document', 'change'); await fill('#sceneCompositionCreatePath', recipePath);
    await fill('#sceneCompositionCreateX', '140'); await fill('#sceneCompositionCreateY', '180');
    assert.equal(await evaluate(`document.querySelector('#sceneCompositionCreateApply').disabled`), true);
    await enabled('#sceneCompositionCreateReview'); await click('#sceneCompositionCreateReview'); await enabled('#sceneCompositionCreateApply');
  };
  await configureRecipe();
  const beforeEditor = await editorState(), reviewed = await evaluate(`document.querySelector('#sceneCompositionCreateSource').textContent`), recipe = JSON.parse(reviewed);
  assert.equal(recipe.format, 'viento-scene-composition'); assert.equal(recipe.schemaVersion, 1); assert.equal(recipe.scene.title, recipeTitle);
  assert.equal(recipe.fragments.length, 1); assert.equal(recipe.placements.length, 1);
  const fragmentActor = recipe.fragments[0].actors[0], placement = recipe.placements[0], instanceId = placement.actorIds[fragmentActor.key];
  assert.deepEqual(fragmentActor, { key: fragmentActor.key, objectId: projection.id, position: [140, 180], useProjectionDefaults: true });
  assert.match(instanceId, /^[a-f0-9-]{36}$/); assert.notEqual(instanceId, placement.placementId);
  assert.deepEqual(await authorTree(root), beforeRecipe); await screenshot('recipe-full-review-desktop.png');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  for (const language of ['zh-CN', 'en', 'ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('.scene-composition-create-body').scrollTop=0`);
    const layout = await evaluate(`(()=>{const d=document.querySelector('#sceneCompositionCreateDialog'),body=document.querySelector('.scene-composition-create-body'),rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}};return {title:document.querySelector('#sceneCompositionCreateTitle').textContent,noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,bodyScrollable:body.scrollHeight>body.clientHeight,close:rect('#sceneCompositionCreateClose'),review:rect('#sceneCompositionCreateReview'),apply:rect('#sceneCompositionCreateApply'),cancel:rect('#sceneCompositionCreateCancel')};})()`);
    assert.equal(layout.noHorizontalOverflow, true); assert.equal(layout.bodyScrollable, true);
    for (const action of ['close', 'review', 'apply', 'cancel']) assert.ok(layout[action].top >= 0 && layout[action].bottom <= 844 && layout[action].left >= 0 && layout[action].right <= 390, JSON.stringify(layout));
    assert.equal(await value('#sceneCompositionCreateName'), recipeTitle); assert.equal(await value('#sceneCompositionCreatePath'), recipePath);
    assert.equal(await evaluate(`document.querySelector('#sceneCompositionCreateSource').textContent`), reviewed);
    assert.equal(await evaluate(`document.querySelector('#sceneCompositionCreateApply').disabled`), false);
    report.layout[language] = layout; await screenshot(`recipe-${language}-390.png`);
    await evaluate(`(()=>{const b=document.querySelector('.scene-composition-create-body');b.scrollTop=b.scrollHeight;})()`);
    assert.equal(await evaluate(`document.querySelector('#sceneCompositionCreateSource').scrollWidth<=document.querySelector('#sceneCompositionCreateSource').clientWidth`), true);
    await screenshot(`recipe-${language}-390-source.png`);
  }
  await click('#sceneCompositionCreateCancel'); await wait(() => evaluate(`!document.querySelector('#sceneCompositionCreateDialog').open`), 'cancel recipe creation');
  assert.deepEqual(await authorTree(root), beforeRecipe); assert.deepEqual(await editorState(), beforeEditor); assert.equal(await evaluate(`window.__recipeSaves.length`), 0);
  report.steps.push('A delayed real catalog read disables creation while leaving Cancel available; cancellation plus late reply never reopens it or writes data. Full JSON review retains symbolic game-projection inheritance instead of flattening size/color/speed/controls. Chinese, English and Japanese at 390px retain fields/review, keep header and footer actions reachable, and allow source scrolling. Cancel changes neither author files nor editor state.');
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await enabled('#sceneCompositionCreateBtn'); await click('#sceneCompositionCreateBtn'); await configureRecipe();
  const finalReview = await evaluate(`document.querySelector('#sceneCompositionCreateSource').textContent`), finalRecipe = JSON.parse(finalReview);
  const finalActor = finalRecipe.fragments[0].actors[0], finalInstance = finalRecipe.placements[0].actorIds[finalActor.key];
  await evaluate(`(()=>{window.__catalogHeld=false;window.__holdCreateCatalog=true;})()`); await click('#sceneCompositionCreateApply');
  await wait(() => evaluate(`window.__catalogHeld===true`), 'held creation revalidation');
  assert.equal(await evaluate(`document.querySelector('#sceneCompositionCreateClose').disabled&&document.querySelector('#sceneCompositionCreateCancel').disabled&&document.querySelector('#sceneCompositionCreateApply').disabled`), true);
  assert.deepEqual(await authorTree(root), beforeRecipe); await evaluate(`window.__releaseCatalog()`);
  await wait(() => evaluate(`!document.querySelector('#sceneCompositionCreateDialog').open&&(await import('/web/modules/app-state.js')).appState.isCreating&&document.activeElement.id==='docSourceEditor'`), 'new recipe ordinary source draft');
  assert.equal(await value('#docSourceEditor'), finalReview); assert.equal(await value('#docCreatePathInput'), recipePath);
  assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`), true);
  assert.equal(await evaluate(`document.querySelector('#sceneCompositionCreateBtn').disabled`), true);
  assert.deepEqual(await authorTree(root), beforeRecipe); await screenshot('recipe-unsaved-source-draft.png');
  const sentinel = '{"external":"occupied after review"}\n'; await fs.mkdir(path.dirname(path.join(root, recipePath)), { recursive: true }); await fs.writeFile(path.join(root, recipePath), sentinel, { flag: 'wx' });
  await enabled('#docSaveBtn'); await click('#docSaveBtn');
  await wait(() => evaluate(`window.__recipeSaves.length===1&&!(await import('/web/modules/app-state.js')).appState.isSaving`), 'ordinary save conflict');
  const rejected = await evaluate(`window.__recipeSaves.at(-1)`); assert.notEqual(rejected.status, 200);
  assert.equal(await fs.readFile(path.join(root, recipePath), 'utf8'), sentinel); assert.equal(await value('#docSourceEditor'), finalReview);
  assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.isCreating`), true); assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`), true);
  assert.equal((await readRegistry(root)).documents.some(item => item.sourcePath === recipePath), false);
  await screenshot('occupied-path-draft-preserved.png'); await fs.unlink(path.join(root, recipePath));
  await enabled('#docSaveBtn'); await click('#docSaveBtn'); await stableEditor();
  assert.equal(await fs.readFile(path.join(root, recipePath), 'utf8'), finalReview);
  const savedRecipe = (await readRegistry(root)).documents.find(item => item.sourcePath === recipePath); assert.ok(savedRecipe);
  const afterRecipe = await authorTree(root); assertRetained(beforeRecipe, afterRecipe);
  assert.deepEqual(Object.keys(afterRecipe).filter(name => afterRecipe[name] !== beforeRecipe[name]).sort(), [recipePath, `metadata/documents/${savedRecipe.id}.json`].sort());
  report.recipe = { objectId: savedRecipe.id, sourcePath: recipePath, sourceSha256: buildHash(finalReview), instanceId: finalInstance, declaration: finalRecipe, conflictReceipt: rejected, saveReceipts: await evaluate(`window.__recipeSaves`) };
  report.steps.push('Create transfers the reviewed JSON to a focused ordinary unsaved source draft without file writes. An external file occupying its path makes ordinary Save fail without overwrite, metadata registration, or draft loss; after removing only that owned test file, retry saves exactly the reviewed source and one registration. Earlier OC/projection bytes remain unchanged.');

  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildTabPreview'); await click('#projectBuildTabPreview');
  await fill('#projectBuildScene', savedRecipe.id, 'change');
  await wait(() => evaluate(`window.__recipePreviews.some(p=>p.ok&&p.composition?.recipeObjectId===${JSON.stringify(savedRecipe.id)})&&document.querySelector('#projectBuildPreviewPanel').getAttribute('aria-busy')!=='true'`), 'new recipe saved preview');
  const preview = await evaluate(`window.__recipePreviews.find(p=>p.ok&&p.composition?.recipeObjectId===${JSON.stringify(savedRecipe.id)})`);
  assert.equal(preview.actors.length, 1); assert.equal(preview.actors[0].instanceId, finalInstance);
  assert.deepEqual(preview.actors[0].size, [72, 88]); assert.equal(preview.actors[0].speed, 180); assert.equal(preview.actors[0].color, '#42a8db'); assert.equal(preview.actors[0].controls, 'arrows');
  assert.deepEqual(await authorTree(root), afterRecipe); await screenshot('new-recipe-projection-preview.png');
  const scenePath = 'documents/scenes/playable-journey.json';
  await enabled('#projectBuildMaterialize'); await click('#projectBuildMaterialize'); await enabled('#sceneMaterializeCheck');
  await fill('#sceneMaterializeName', 'Playable Journey'); await fill('#sceneMaterializeType', 'document', 'change'); await fill('#sceneMaterializePath', scenePath); await click('#sceneMaterializeCheck'); await enabled('#sceneMaterializeSave');
  const sceneSource = await evaluate(`document.querySelector('#sceneMaterializeSource').textContent`), declaration = JSON.parse(sceneSource);
  assert.equal(declaration.format, 'viento-scene2d'); assert.equal(declaration.actors.length, 1);
  assert.deepEqual(declaration.actors[0], { instanceId: finalInstance, objectId: projection.id, position: [140, 180], useProjectionDefaults: true });
  assert.deepEqual(await authorTree(root), afterRecipe); await screenshot('materialized-inheritance-review.png'); await click('#sceneMaterializeSave');
  await wait(async () => { try { return await fs.readFile(path.join(root, scenePath), 'utf8') === sceneSource; } catch { return false; } }, 'saved separate Scene2D');
  await enabled('#sceneMaterializeClose'); await click('#sceneMaterializeClose');
  const scene = (await readRegistry(root)).documents.find(item => item.sourcePath === scenePath); assert.ok(scene);
  const beforeRun = await authorTree(root); assertRetained(afterRecipe, beforeRun);
  assert.deepEqual(Object.keys(beforeRun).filter(name => beforeRun[name] !== afterRecipe[name]).sort(), [scenePath, `metadata/documents/${scene.id}.json`].sort());
  report.materialized = { objectId: scene.id, sourcePath: scenePath, sourceSha256: buildHash(sceneSource), declaration };
  report.steps.push('The saved recipe immediately appears in scene preview with inherited 72×88 geometry, blue color and speed 180. Existing materialization creates a separate Scene2D preserving the same instance ID and useProjectionDefaults, with no serialized effective overrides and no modification of recipe or projection.');
  await enabled('#projectBuildTabBuild'); await click('#projectBuildTabBuild'); await fill('#projectBuildScene', scene.id, 'change');
  async function perform(selector, kind) { const previous = (await state()).job?.id; await enabled(selector); await click(selector); let job; await wait(async () => { job = (await state()).job; return job?.kind === kind && job.id !== previous && job.status !== 'running'; }, kind, 90000); report.jobs.push(job); assert.equal(job.status, 'succeeded', JSON.stringify(job)); return job; }
  await perform('#projectBuildPlan', 'plan'); await perform('#projectBuildGenerate', 'build'); const ran = await perform('#projectBuildHeadless', 'run');
  const finalActors = ran.events.find(event => event.event === 'finished').actors;
  assert.equal(finalActors.length, 1); assert.equal(finalActors[0].instanceId, finalInstance); assert.equal(finalActors[0].objectId, projection.id);
  assert.deepEqual(finalActors[0].position, [185, 180]);
  assert.deepEqual(await authorTree(root), beforeRun); report.runtime = { finalActors };
  await wait(() => evaluate(`document.querySelector('#projectBuildStatus').textContent.includes('已完成')&&!document.querySelector('#projectBuildHeadless').disabled`), 'completed runtime result in editor');
  await evaluate(`document.querySelector('#projectBuildStatus').scrollIntoView({block:'center'})`); await screenshot('godot-inherited-player-result.png');
  report.steps.push('Real Godot plan, build and headless run succeed for the GUI-authored chain. The inherited player moves 45px at speed 180 while preserving its scene instance identity. Plan/build/run change no author bytes.');
  for (const [name, hash] of Object.entries(report.sources)) assert.equal(buildHash(await fs.readFile(path.join(appRoot, name))), hash, `Source changed during smoke: ${name}`);
  report.sourceSnapshotUnchanged = true; assert.deepEqual(report.errors, []); report.ok = true;
} catch (error) { report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1; try { await captureFailure?.(); } catch (failure) { report.captureFailure = failure.message; }
} finally {
  socket?.close(); for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.cleanedUp = report.temporaryRoot ? await fs.stat(report.temporaryRoot).then(() => false, error => error.code === 'ENOENT') : true;
  if (!report.cleanedUp) { report.ok = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), json(report));
  console.log(json({ ok: report.ok, output, steps: report.steps, failure: report.failure, cleanedUp: report.cleanedUp }));
}
