// Registered composition -> independent Scene2D -> authored script/behavior -> Godot -> delivered project.
// All author files, caches and browser state are temporary; old evidence is never overwritten.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { registerWorkspace, readRegistry } from '../lib/workspace.mjs';
import { importMediaAsset } from '../lib/media-assets.mjs';
import { verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/two-dimensional-workflow');
const output = path.resolve(process.env.VIENTO_SCENE_MATERIALIZE_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/two-dimensional-workflow.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Choose a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to a trusted absolute Godot executable.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome, local HTTP editor and trusted Godot; installed Tauri, native picker, Android and other operating systems are not exercised.',
  'Fixture preparation registers a generic OC, imports a repository image and registers the example composition in a temporary blank project through production services. Upstream OC/projection/recipe authoring is not claimed.',
  'The GUI creates the independent scene, TXT GDScript, behavior and delivery in one project. Godot headless logic and relocated project import are verified; rendered gameplay and standalone game executables are not claimed.',
] };
const cleanups = [], fixture = { after: cleanup => cleanups.push(cleanup) };
const json = value => JSON.stringify(value, null, 2) + '\n';
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
const sources = ['engine/scene-composition-materialize.mjs', 'web/modules/app-scene-materialize.js', 'web/scene-materialize.css',
  'web/modules/app-project-build.js', 'web/modules/app-scene-preview.js', 'web/modules/app-runtime.js', 'web/modules/app-script-create.js',
  'web/modules/app-scene-behavior-create.js', 'web/modules/app-scene-behaviors.js', 'engine/script-authoring.mjs',
  'engine/scene-composition.mjs', 'scripts/adapters/node-world-commands.mjs', 'scripts/adapters/node-backend-project-delivery.mjs',
  'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/scene-materialize-smoke.mjs'];
let socket, captureFailure;
try {
  report.sources = Object.fromEntries(await Promise.all(sources.map(async name => [name, buildHash(await fs.readFile(path.join(appRoot, name)))])));
  report.node = { version: process.version, sha256: buildHash(await fs.readFile(process.execPath)) };
  const version = await runCommand(tool, ['--version'], { cwd: appRoot }); assert.equal(version.code, 0);
  report.tool = { version: version.stdout.trim(), sha256: buildHash(await fs.readFile(tool)) };
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-materialize-browser-'));
  report.temporaryRoot = temporary;
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'author'), download = path.join(temporary, 'downloads');
  const template = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank');
  for (const name of ['documents', 'templates', 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(root, name), { recursive: true });
  await fs.mkdir(download);
  await fs.writeFile(path.join(root, 'workspace.json'), json({ format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Composition to delivery 配方交付 構成から配布', createdAt: 0, ...WORKSPACE_LAYOUT, documentTypes: template.documentTypes }));
  for (const [name, content] of Object.entries(template.templates)) await fs.writeFile(path.join(root, 'templates', name), content);
  await registerWorkspace(root);
  const execute = createWorldCommandService(root);
  const create = async (sourcePath, content) => {
    const view = await readWorldProjection(root), request = { command: 'object.create', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
      actorRef: { kind: 'tool', id: 'scene-materialize-smoke-fixture' }, objectId: randomUUID(), documentType: 'document', sourcePath, content };
    const receipt = await execute(request); assert.equal(receipt.status, 'applied'); return request;
  };
  const oc = await create('documents/traveler.md', '\uFEFF# Traveler / 旅人\r\n\r\n背景故事属于这份 OC。\r\n');
  const asset = (await importMediaAsset(root, Readable.from([await fs.readFile(path.join(appRoot, 'examples/scene2d/assets/traveler.svg'))]), 'traveler.svg')).asset;
  const recipe = JSON.parse(await fs.readFile(path.join(appRoot, 'examples/scene-composition/recipe.json'), 'utf8'));
  for (const actor of recipe.fragments[0].actors) { actor.objectId = oc.objectId; actor.imageResourceId = asset.id; }
  const recipeSource = '\uFEFF' + json(recipe).replaceAll('\n', '\r\n');
  const origin = await create('documents/scenes/recipe.json', recipeSource);
  const instanceIds = recipe.placements.flatMap(item => Object.values(item.actorIds));
  const groupIds = recipe.placements.flatMap(item => Object.values(item.groupIds));
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root, VIENTO_GODOT_BIN: tool,
    VIENTO_EXECUTION_BACKEND: 'org.viento.godot4', XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  const rebuilt = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env }); assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
  const initial = await authorTree(root), base = await serve(fixture, appRoot, env);
  const state = async () => { const response = await fetch(`${base}/api/project-build`); assert.equal(response.status, 200); const body = await response.json(); return body.data || body; };
  report.fixture = { recipeObjectId: origin.objectId, recipePath: origin.sourcePath, recipeSourceSha256: buildHash(recipeSource), ocObjectId: oc.objectId, imageId: asset.id, initialAuthorFiles: initial };
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
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,receipts:window.__materializeReceipts,previews:window.__materializePreviews})`); report.serviceFailure = await state(); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: download, eventsEnabled: true });
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor startup');
  await evaluate(`(()=>{window.__materializeReceipts=[];window.__materializePreviews=[];window.__deliveries=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const response=await original(input,init);let body;try{body=JSON.parse(init?.body||'null')}catch{};const url=new URL(typeof input==='string'?input:input.url,location.href);if(body?.command==='scene.create'||body?.command==='behavior.create'){const result=await response.clone().json();window.__materializeReceipts.push({request:body,result:result.data||result,status:response.status})}if(url.pathname==='/api/scene-preview'&&init?.method==='POST'){const result=await response.clone().json();window.__materializePreviews.push(result.data||result)}if(body?.kind==='backend-project'){const result=await response.clone().json();window.__deliveries.push(result.data||result)}return response;};})()`);
  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildTabPreview'); await click('#projectBuildTabPreview');
  await fill('#projectBuildScene', origin.objectId, 'change');
  await wait(() => evaluate(`window.__materializePreviews.some(p=>p.ok&&p.composition?.recipeObjectId===${JSON.stringify(origin.objectId)})&&document.querySelector('#projectBuildPreviewPanel').getAttribute('aria-busy')!=='true'`), 'saved composition preview');
  const preview = await evaluate(`window.__materializePreviews.find(p=>p.ok&&p.composition?.recipeObjectId===${JSON.stringify(origin.objectId)})`);
  assert.equal(preview.actors.length, 4); assert.equal(preview.sceneStructure.groups.length, 4);
  assert.deepEqual(await authorTree(root), initial); await screenshot('composition-preview.png');
  const destination = 'documents/scenes/playable-scene.json', sceneTitle = 'Playable parties / 队伍场景 / 遊べる隊';
  const openMaterialize = async () => { await enabled('#projectBuildMaterialize'); await click('#projectBuildMaterialize'); await enabled('#sceneMaterializeCheck'); await fill('#sceneMaterializeName', sceneTitle); await fill('#sceneMaterializeType', 'document', 'change'); await fill('#sceneMaterializePath', destination); await click('#sceneMaterializeCheck'); await enabled('#sceneMaterializeSave'); };
  await openMaterialize();
  const reviewed = await evaluate(`document.querySelector('#sceneMaterializeSource').textContent`), expanded = JSON.parse(reviewed);
  assert.equal(expanded.format, 'viento-scene2d'); assert.equal(expanded.schemaVersion, 3); assert.equal(expanded.title, sceneTitle);
  assert.deepEqual(new Set(expanded.actors.map(actor => actor.instanceId)), new Set(instanceIds)); assert.deepEqual(new Set(expanded.groups.map(group => group.groupId)), new Set(groupIds));
  assert.deepEqual(expanded.actors.map(actor => ({ instanceId: actor.instanceId, objectId: actor.objectId, groupId: actor.groupId, position: actor.position, imageResourceId: actor.imageResourceId })), [
    { instanceId: instanceIds[0], objectId: oc.objectId, groupId: groupIds[0], position: [120, 180], imageResourceId: asset.id },
    { instanceId: instanceIds[1], objectId: oc.objectId, groupId: groupIds[1], position: [200, 180], imageResourceId: asset.id },
    { instanceId: instanceIds[2], objectId: oc.objectId, groupId: groupIds[2], position: [460, 220], imageResourceId: asset.id },
    { instanceId: instanceIds[3], objectId: oc.objectId, groupId: groupIds[3], position: [560, 260], imageResourceId: asset.id },
  ]);
  for (const index of [0, 2]) {
    assert.equal(expanded.groups.find(group => group.groupId === groupIds[index]).parentGroupId, undefined);
    assert.equal(expanded.groups.find(group => group.groupId === groupIds[index + 1]).parentGroupId, groupIds[index]);
  }
  assert.deepEqual(await authorTree(root), initial); await screenshot('materialize-review-desktop.png');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  for (const language of ['zh-CN', 'en', 'ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    const layout = await evaluate(`(()=>{const d=document.querySelector('#sceneMaterializeDialog');const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}};return {title:document.querySelector('#sceneMaterializeTitle').textContent,noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,close:rect('#sceneMaterializeClose'),check:rect('#sceneMaterializeCheck'),save:rect('#sceneMaterializeSave'),cancel:rect('#sceneMaterializeCancel')};})()`);
    assert.equal(layout.noHorizontalOverflow, true, JSON.stringify(layout));
    for (const id of ['close', 'check', 'save', 'cancel']) assert.ok(layout[id].top >= 0 && layout[id].bottom <= 844 && layout[id].left >= 0 && layout[id].right <= 390, JSON.stringify(layout));
    assert.equal(await value('#sceneMaterializePath'), destination); assert.equal(await value('#sceneMaterializeName'), sceneTitle);
    assert.equal(await evaluate(`document.querySelector('#sceneMaterializeSource').textContent`), reviewed); assert.equal(await evaluate(`document.querySelector('#sceneMaterializeSave').disabled`), false);
    report.layout[language] = layout; await screenshot(`materialize-${language}-390.png`);
  }
  await click('#sceneMaterializeCancel'); await wait(() => evaluate(`!document.querySelector('#sceneMaterializeDialog').open`), 'cancel materialization');
  assert.deepEqual(await authorTree(root), initial); assert.equal((await state()).job, null);
  report.steps.push('The registered composition previews four actors and four groups. Materialization reviews a separate schema-3 Scene2D with identical instance/group IDs. Chinese, English and Japanese at 390px retain fields and review with visible actions. Cancel writes no author files and starts no build.');
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await openMaterialize(); const finalReview = await evaluate(`document.querySelector('#sceneMaterializeSource').textContent`);
  await click('#sceneMaterializeSave');
  await wait(async () => { try { return (await fs.readFile(path.join(root, destination), 'utf8')) === finalReview; } catch { return false; } }, 'saved independent scene');
  await enabled('#sceneMaterializeClose'); await click('#sceneMaterializeClose');
  const scene = (await readRegistry(root)).documents.find(item => item.sourcePath === destination); assert.ok(scene);
  await wait(async () => await value('#projectBuildScene') === scene.id, 'new scene selected in build panel');
  const afterScene = await authorTree(root); assert.deepEqual(Object.keys(afterScene).filter(name => afterScene[name] !== initial[name]).sort(), [destination, `metadata/documents/${scene.id}.json`].sort());
  for (const [name, hash] of Object.entries(initial)) assert.equal(afterScene[name], hash, name);
  const savedScene = JSON.parse(finalReview); assert.deepEqual(savedScene, expanded);
  report.materialized = { objectId: scene.id, sourcePath: destination, sourceSha256: buildHash(finalReview), instanceIds, groupIds, receipt: await evaluate(`window.__materializeReceipts.filter(r=>r.request.command==='scene.create'&&r.request.mode==='apply').at(-1)`) };
  assert.equal(report.materialized.receipt.result.status, 'applied'); await screenshot('materialized-scene-selected.png');
  await click('#projectBuildClose'); await wait(() => evaluate(`!document.querySelector('#projectBuildDialog').open`), 'return to editor');
  const scriptPath = 'documents/scripts/materialized-checkpoint.txt', starter = listScriptStarters().find(item => item.id === 'godot-signal');
  await enabled('#scriptCreateBtn'); await click('#scriptCreateBtn'); await enabled('#scriptCreateApply');
  await fill('#scriptCreateStarter', starter.id, 'change'); await fill('#scriptCreateType', 'document', 'change'); await fill('#scriptCreatePath', scriptPath); await click('#scriptCreateApply');
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.isCreating&&document.activeElement.id==='docSourceEditor'`), 'new ordinary script draft');
  assert.equal(await value('#docSourceEditor'), starter.content); assert.deepEqual(await authorTree(root), afterScene);
  await enabled('#docSaveBtn'); await click('#docSaveBtn'); await stableEditor();
  assert.equal(await fs.readFile(path.join(root, scriptPath), 'utf8'), starter.content);
  const script = (await readRegistry(root)).documents.find(item => item.sourcePath === scriptPath); assert.ok(script);
  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildTabBuild'); await click('#projectBuildTabBuild');
  await fill('#projectBuildScene', scene.id, 'change'); await enabled('#projectBuildCreateBehavior'); await click('#projectBuildCreateBehavior'); await enabled('#sceneBehaviorCreateCheck');
  const behaviorPath = 'documents/behaviors/materialized-checkpoint.json';
  await fill('#sceneBehaviorCreateSource', script.id, 'change'); await fill('#sceneBehaviorCreateType', 'document', 'change'); await fill('#sceneBehaviorCreatePath', behaviorPath);
  await click('#sceneBehaviorCreateCheck'); await enabled('#sceneBehaviorCreateSave'); await click('#sceneBehaviorCreateSave'); await enabled('#sceneBehaviorCreateOpen'); await click('#sceneBehaviorCreateOpen');
  await wait(() => evaluate(`!document.querySelector('#sceneBehaviorCreateDialog').open&&!document.querySelector('#projectBuildDialog').open&&document.activeElement.id==='docSourceEditor'`), 'behavior source navigation');
  await enabled('#sceneBehaviorsBtn'); await click('#sceneBehaviorsBtn'); await enabled('#sceneBehaviorsAddParameter');
  await click('#sceneBehaviorsAddParameter'); await fill('#sceneBehaviorsParam0Name', 'checkpoint'); await fill('#sceneBehaviorsParam0Value', 'materialized_scene');
  await click('#sceneBehaviorsAddParameter'); await fill('#sceneBehaviorsParam1Name', 'amount'); await fill('#sceneBehaviorsParam1Type', 'number', 'change'); await fill('#sceneBehaviorsParam1Value', '73');
  await click('#sceneBehaviorsAddEvent'); await fill('#sceneBehaviorsEvent0Signal', 'arrived'); await fill('#sceneBehaviorsEvent0Name', 'materialized_checkpoint');
  await click('#sceneBehaviorsCheck'); await enabled('#sceneBehaviorsApply'); const behaviorContent = await evaluate(`document.querySelector('#sceneBehaviorsAfter').textContent`); const behavior = JSON.parse(behaviorContent);
  await click('#sceneBehaviorsApply');
  await wait(() => evaluate(`!document.querySelector('#sceneBehaviorsDialog').open&&(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`), 'behavior changes applied to source draft');
  assert.equal(await value('#docSourceEditor'), behaviorContent.replace(/\r\n?/g, '\n'));
  await enabled('#docSaveBtn'); await click('#docSaveBtn');
  await wait(async () => await fs.readFile(path.join(root, behaviorPath), 'utf8') === behaviorContent, 'ordinary behavior save'); await stableEditor();
  const beforeRun = await authorTree(root); for (const [name, hash] of Object.entries(initial)) assert.equal(beforeRun[name], hash, name);
  assert.equal(await fs.readFile(path.join(root, destination), 'utf8'), finalReview);
  report.behavior = { scriptPath, scriptId: script.id, sourcePath: behaviorPath, binding: behavior.bindings[0] };
  report.steps.push('Save creates only the independent scene source and registration, retaining recipe, recipe metadata and all dependencies byte-for-byte. A GUI-created TXT GDScript is ordinarily saved and attached through first-behavior creation; parameter and signal mapping are reviewed and ordinarily saved without editing recipe or scene bytes.');
  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildTabBuild'); await click('#projectBuildTabBuild'); await fill('#projectBuildScene', scene.id, 'change');
  async function perform(selector, kind) { const previous = (await state()).job?.id; await enabled(selector); await click(selector); let job; await wait(async () => { job = (await state()).job; return job?.kind === kind && job.id !== previous && job.status !== 'running'; }, kind, 90000); report.jobs.push(job); assert.equal(job.status, 'succeeded', JSON.stringify(job)); return job; }
  const planned = await perform('#projectBuildPlan', 'plan'); assert.equal(planned.plan.behaviorBindingCount, 1); assert.equal(planned.plan.behaviorSourceCount, 1);
  const built = await perform('#projectBuildGenerate', 'build'), ran = await perform('#projectBuildHeadless', 'run');
  const events = ran.events.filter(event => event.event === 'behavior'); assert.equal(events.length, 1); assert.equal(events[0].name, 'materialized_checkpoint'); assert.deepEqual(events[0].arguments, ['materialized_scene', 73]); assert.equal(events[0].bindingId, behavior.bindings[0].bindingId); assert.equal(events[0].instanceId, behavior.bindings[0].instanceId);
  const finalActors = ran.events.find(event => event.event === 'finished').actors; assert.deepEqual(new Set(finalActors.map(actor => actor.instanceId)), new Set(instanceIds));
  assert.deepEqual(finalActors.find(actor => actor.instanceId === instanceIds[0]).position, [160, 180]);
  for (const original of savedScene.actors.slice(1)) assert.deepEqual(finalActors.find(actor => actor.instanceId === original.instanceId).position, original.position);
  await wait(() => evaluate(`document.querySelector('#projectBuildBehaviorEventList').textContent.includes('materialized_checkpoint')`), 'real runtime event in editor');
  await evaluate(`document.querySelector('#projectBuildBehaviorEventList').scrollIntoView({block:'center'})`); await screenshot('materialized-godot-event.png');
  assert.deepEqual(await authorTree(root), beforeRun); report.runtime = { behaviorEvents: events, finalActors };
  report.steps.push('Real Godot plan/build/headless execution runs the newly materialized scene: preserved instance IDs, leader moves 40px, other actors remain still, and the authored behavior emits materialized_checkpoint(materialized_scene, 73). No author files change during execution.');
  await enabled('#backendProjectInspect'); await click('#backendProjectInspect'); await enabled('#backendProjectDeliver'); await click('#backendProjectDeliver');
  await enabled('#backendDeliveryPrepare'); await click('#backendDeliveryPrepare'); await enabled('#backendDeliveryDownload');
  const receipt = await evaluate(`window.__deliveries.at(-1)`); assert.equal(receipt.delivery.project.buildId, built.buildId); await screenshot('materialized-delivery-review.png');
  await click('#backendDeliveryDownload'); await wait(() => evaluate(`!document.querySelector('#backendDeliveryDownload').disabled`), 'download started'); await click('#backendDeliveryClose');
  const archive = path.join(download, receipt.fileName); await wait(async () => { try { return (await fs.stat(archive)).size === receipt.bytes; } catch { return false; } }, 'browser ZIP saved');
  const verified = await verifyBackendProjectDelivery(archive), extraction = path.join(temporary, 'relocated'); await fs.mkdir(extraction);
  const unzip = await runCommand('unzip', ['-q', archive, '-d', extraction], { cwd: temporary }); assert.equal(unzip.code, 0, JSON.stringify(unzip));
  assert.equal(await fs.readFile(path.join(extraction, 'project', 'behaviors', `${script.id}.gd`), 'utf8'), starter.content);
  const imported = await runCommand(tool, ['--headless', '--editor', '--path', path.join(extraction, 'project'), '--import', '--quit'], { cwd: temporary, env });
  assert.equal(imported.code, 0, JSON.stringify(imported)); assert.doesNotMatch(imported.stdout + imported.stderr, /SCRIPT ERROR|Parse Error/);
  assert.ok(verified.assetCount > 0); assert.deepEqual(await authorTree(root), beforeRun);
  report.delivery = { fileName: receipt.fileName, bytes: receipt.bytes, sha256: buildHash(await fs.readFile(archive)), fileCount: verified.fileCount, assetCount: verified.assetCount, buildId: built.buildId, relocatedImport: imported };
  report.steps.push('The actual browser downloads the inspected generated project ZIP. Independent verification, new-directory extraction, exact script-copy comparison and actual Godot import pass with image resources included. Author files remain unchanged.');
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
