// Actual Studio authoring from an initialized official blank workspace.
// Project-library/native picker creation is explicitly outside this browser case.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import '../adapters/node-studio-core.mjs';
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { readRegistry, registerWorkspace } from '../lib/workspace.mjs';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT } from '../../engine/godot-scene-retry-script.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const source = path.resolve(process.env.VIENTO_CREATE_PARAMETERS_SAMPLE_SOURCE || path.join(appRoot, 'examples/topdown-collect'));
const output = path.resolve(process.env.VIENTO_CREATE_PARAMETERS_OUTPUT || `/tmp/viento-create-parameters-browser-${Date.now()}`);
if (!output.startsWith('/tmp/')) throw Error('This browser smoke writes evidence only beneath /tmp.');
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceNames = ['engine/scene-behavior-create-parameters.mjs', 'engine/scene-behavior-create-plan.mjs', 'engine/world-behavior-create.mjs', 'web/modules/app-scene-behavior-create.js', 'web/modules/app-scene-behavior-create-parameters.js', 'scripts/lib/scene-behavior-creation-service.mjs', 'web/scene-behavior-create.css', 'engine/scene-behavior-reference-directory.mjs', 'scripts/lib/scene-behavior-reference-directory-service.mjs',
  'web/modules/app-scene-behavior-references.js', 'web/modules/app-scene-behaviors.js', 'web/modules/app-behavior-source.js',
  'web/modules/app-runtime.js', 'web/modules/app-state.js', 'web/modules/app-doc-service.js', 'web/scene-behaviors.css',
  'scripts/lib/doc-api-service.mjs', 'scripts/lib/doc-server-routes.mjs', 'scripts/lib/scene-behavior-authoring-service.mjs',
  'engine/scene-behaviors.mjs', 'engine/scene-behaviors-edit.mjs', 'web/i18n/en.js', 'web/i18n/ja.js', 'engine/godot-scene-retry-parameters.mjs', 'engine/script-parameter-discovery.mjs', 'engine/script-parameter-interface.mjs', 'web/modules/app-scene-behavior-parameters.js', 'web/modules/app-script-create.js', 'web/modules/app-scene-create.js', 'web/modules/app-project-assembly.js', 'web/modules/app-input-map.js', 'web/modules/app-scene-hud2d.js', 'engine/godot-scene-retry-script.mjs'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, hash(await fs.readFile(path.join(appRoot, name)))])));
async function authorTree(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name), name = path.relative(root, file);
    if (name.split(path.sep).some(part => part.startsWith('.'))) continue;
    result[name] = hash(await fs.readFile(file));
  }
  return Object.fromEntries(Object.entries(result).sort());
}
const cleanups = [], fixture = { after: callback => cleanups.push(callback) };
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, stages: [], limitations: [
  'The harness initializes the official blank template layout with one generic document type and zero authored documents/assets/registrations. It does not automate desktop-library project creation, native folder pickers, installed Tauri or Android.',
  'Every definition, two scenes, official retry TXT, input map, assembly, HUD and first behavior with parameters is subsequently created through actual Studio controls; no prepared game source, scene UUID or behavior metadata is injected.',
  'Each first-creation binding retains ordinary raw parameter JSON. Source selection does not fill defaults; Add missing is explicit, followed by first-creation review and one behavior.create Save transaction.',
  'The retained author-final workspace and frozen plan enable a separate actual Godot keyboard/HUD check. This browser report does not claim native gameplay, same-scene restart or independent distribution.'
] };
const wait = async (check, label, budget = 45000) => { for (const end = Date.now() + budget; Date.now() < end;) { if (await check()) return; await delay(80); } throw Error('Timed out: ' + label); };
let socket, captureFailure, confirmAccept = true;
try {
  report.sourcesBefore = await sourceHashes(); report.driverSha256 = hash(await fs.readFile(fileURLToPath(import.meta.url)));
  report.sampleBefore = await authorTree(source); report.node = { version: process.version, sha256: hash(await fs.readFile(process.execPath)) };
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-create-parameters-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const author = path.join(temporary, 'author'); await fs.mkdir(author);
  const blank = PROJECT_TEMPLATE_CATALOG.templates.find(row => row.packageId === 'org.viento.blank'); assert.ok(blank);
  const workspace = { format: 'viento-workspace', version: 3, id: randomUUID(), name: 'First creation parameter UI trial', createdAt: 0,
    ...structuredClone(WORKSPACE_LAYOUT), documentTypes: structuredClone(blank.documentTypes) };
  await fs.writeFile(path.join(author, 'workspace.json'), JSON.stringify(workspace, null, 2) + '\n');
  for (const folder of ['documents', 'assets', 'templates', 'metadata/documents', 'metadata/assets']) await fs.mkdir(path.join(author, folder), { recursive: true });
  for (const [name, text] of Object.entries(blank.templates)) await fs.writeFile(path.join(author, 'templates', name), text);
  await registerWorkspace(author);
  const emptyRegistry = await readRegistry(author); assert.deepEqual(emptyRegistry.documents, []); assert.deepEqual(emptyRegistry.assets, []);
  report.initialization = { kind: 'harness-initialized-official-blank-template', templateId: blank.packageId, templateVersion: blank.version,
    authoredDocuments: 0, registeredDocuments: 0, assets: 0, documentTypes: workspace.documentTypes.map(row => row.id) };
  let definition, retryScene, levelScene, scriptRecord, behaviorRecord, mapRecord, assembly, hudRecord;
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: author,
    ...(process.env.VIENTO_GODOT_BIN ? { VIENTO_GODOT_BIN: process.env.VIENTO_GODOT_BIN } : {}), XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config'), XDG_DATA_HOME: path.join(temporary, 'data') };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  const initial = await authorTree(author); report.emptyAuthorBefore = initial;
  const rebuilt = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env }); assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
  assert.deepEqual(await authorTree(author), initial, 'index rebuild preserves empty-template author bytes');
  const base = await serve(fixture, appRoot, env), profile = path.join(temporary, 'chrome'); await fs.mkdir(profile);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const ended = once(chrome, 'exit'); chrome.kill(); await ended; } });
  let port; await wait(async () => { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return Boolean(port); } catch { return false; } }, 'Chrome startup');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(value => value.json()); socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const requests = new Map(); let sequence = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; requests.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.id) { const request = requests.get(value.id); requests.delete(value.id); value.error ? request?.reject(Error(value.error.message)) : request?.resolve(value.result); }
    else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
    else if (value.method === 'Page.javascriptDialogOpening') { report.dialogs.push({ type: value.params.type, message: value.params.message, accepted: confirmAccept }); void call('Page.handleJavaScriptDialog', { accept: confirmAccept }); }
  });
  const evaluate = async expression => { const value = await call('Runtime.evaluate', { expression: `(async()=>(${expression}))()`, awaitPromise: true, returnByValue: true, userGesture: true }); if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value; };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value, event = 'input') => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  const value = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled===false&&!document.querySelector(${JSON.stringify(selector)}).hidden`), selector + ' enabled');
  const screenshot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }), bytes = Buffer.from(image.data, 'base64'); await fs.writeFile(path.join(output, name), bytes); report.screenshots.push({ name, bytes: bytes.length, sha256: hash(bytes) }); };
  const openDocument = async record => {
    await wait(() => evaluate(`(()=>{const s=window.__referenceState;return !s.isSaving&&!s.isRebuilding&&!s.isLoadingSource&&s.docs.some(row=>row.id===${JSON.stringify(record.id)})})()`), 'registered document ready');
    const indexPath = await evaluate(`window.__referenceState.docs.find(row=>row.id===${JSON.stringify(record.id)}).path`);
    await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(row=>row.dataset.path===${JSON.stringify(indexPath)})`), 'sidebar document ready');
    await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(row=>row.dataset.path===${JSON.stringify(indexPath)}).click()`);
    await wait(() => evaluate(`window.__referenceState.activePath===${JSON.stringify(indexPath)}&&!window.__referenceState.isLoadingSource`), 'document selected');
    await wait(async () => { const s = await evaluate(`({editing:window.__referenceState.isEditing,source:window.__referenceState.activeEditSource,canEdit:document.querySelector('#docEditBtn')?.disabled===false})`); if (s.editing && (s.source === record.sourcePath || s.source.endsWith('/' + record.sourcePath))) return true; if (!s.editing && s.canEdit) await click('#docEditBtn'); return false; }, 'source edit ready');
    await enabled('#docEditSourceModeBtn'); await click('#docEditSourceModeBtn'); await enabled('#sceneBehaviorsBtn');
  };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,state:window.__referenceState,creationStatus:document.querySelector('#sceneBehaviorCreateStatus')?.textContent,parameterError:document.querySelector('#sceneBehaviorCreateParameterError')?.textContent,requests:window.__creationParameterRequests})`); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.addScriptToEvaluateOnNewDocument', { source: "(()=>{window.__creationParameterRequests=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=String(input),response=await original(input,init);if(url.includes('/api/scene-behavior-creation')||url.includes('/api/world/commands')){let body=null,result=null;try{body=JSON.parse(init?.body||'null')}catch{}try{result=await response.clone().json()}catch{}window.__creationParameterRequests.push({url,method:init?.method||'GET',body,status:response.status,result});}return response;};})()" });
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'Studio startup');
  await evaluate(`window.__referenceState=(await import('/web/modules/app-state.js')).appState`);

  const record = async sourcePath => { const rows = (await readRegistry(author)).documents; const found = rows.find(row => row.sourcePath === sourcePath); assert.ok(found, 'saved registration ' + sourcePath); return found; };
  const savedIdle = () => wait(() => evaluate(`!window.__referenceState.isSaving&&!window.__referenceState.isRebuilding&&!window.__referenceState.isLoadingSource&&!window.__referenceState.editHasUnsavedChanges`), 'ordinary save idle');
  const saveOrdinary = async file => { await enabled('#docSaveBtn'); await click('#docSaveBtn'); await wait(async () => { try { return (await readRegistry(author)).documents.some(row => row.sourcePath === file); } catch { return false; } }, 'ordinary registered Save ' + file); await savedIdle(); };
  const closeBuild = async () => { await click('#projectBuildClose'); await wait(() => evaluate(`!document.querySelector('#projectBuildDialog').open`), 'build closed'); };
  const openBuild = async target => { if (!await evaluate(`document.querySelector('#projectBuildDialog').open`)) { await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); } if (target) { await enabled('#projectBuildScene'); await fill('#projectBuildScene', target, 'change'); } };
  let previous = initial;
  const stage = async name => { const after = await authorTree(author), changedPaths = [...new Set([...Object.keys(previous), ...Object.keys(after)])].filter(p => previous[p] !== after[p]).sort(); report.stages.push({ name, changedPaths, hashes: Object.fromEntries(changedPaths.map(p => [p, after[p] || null])) }); previous = after; return after; };
  // The only initialized fixture data is the official blank workspace/template.
  await enabled('#docCreateBtn'); await click('#docCreateBtn'); await wait(() => evaluate(`window.__referenceState.isCreating&&!window.__referenceState.isLoadingTemplate`), 'blank ordinary document draft');
  assert.equal(await value('#docCreateTypeSelect'), 'document'); await fill('#docCreatePathInput', 'documents/definition.md'); await fill('#docSourceEditor', '# Retry display object\n\nA simple authored object for two scenes.\n');
  assert.deepEqual(await authorTree(author), initial); await saveOrdinary('documents/definition.md'); definition = await record('documents/definition.md'); await stage('UI ordinary definition Save');
  report.steps.push('From the initialized official blank template with zero documents/assets/registrations, create and ordinarily save the first definition through Studio.');

  await openBuild();
  const createScene = async (title, sourcePath, background) => {
    await enabled('#projectBuildCreateScene'); await click('#projectBuildCreateScene'); await enabled('#sceneCreateCheck');
    await fill('#sceneCreateName', title); await fill('#sceneCreatePath', sourcePath); await fill('#sceneCreateType', 'document', 'change');
    await fill('#sceneCreateBackground', background); await fill('#sceneActor0Object', definition.id, 'change'); await fill('#sceneActor0Controls', 'none', 'change'); await fill('#sceneActor0Speed', '0');
    const before = await authorTree(author); await click('#sceneCreateCheck'); await enabled('#sceneCreateSave'); assert.deepEqual(await authorTree(author), before);
    const declaration = JSON.parse(await evaluate(`document.querySelector('#sceneCreateSource').textContent`)); assert.equal(declaration.schemaVersion, 2); assert.equal(declaration.actors.length, 1);
    await click('#sceneCreateSave'); await wait(async () => { try { return (await fs.readFile(path.join(author, sourcePath), 'utf8')).includes(title); } catch { return false; } }, 'new scene saved');
    await enabled('#sceneCreateClose'); await click('#sceneCreateClose'); await wait(() => evaluate(`!document.querySelector('#sceneCreateDialog').open`), 'scene create closed');
    const result = await record(sourcePath); await stage('UI scene creation ' + title); return result;
  };
  retryScene = await createScene('Retry page', 'documents/scenes/retry.json', '#30182c');
  levelScene = await createScene('Level', 'documents/scenes/level.json', '#122b22');
  assert.notEqual(retryScene.id, levelScene.id); await screenshot('two-scenes-created-desktop.png'); await closeBuild();

  const scriptPath = 'documents/scripts/retry.txt';
  const scriptOpen = async () => { await enabled('#scriptCreateBtn'); await click('#scriptCreateBtn'); await enabled('#scriptCreateApply'); await fill('#scriptCreateStarter', 'godot-action-scene-retry', 'change'); await fill('#scriptCreateType', 'document', 'change'); await fill('#scriptCreatePath', scriptPath); await enabled('#scriptCreateApply'); assert.equal(await evaluate(`document.querySelector('#scriptCreateSource').textContent`), GODOT_ACTION_SCENE_RETRY_SCRIPT); };
  const beforeScript = await authorTree(author); await scriptOpen(); await click('#scriptCreateCancel'); await wait(() => evaluate(`!document.querySelector('#scriptCreateDialog').open`), 'script creation canceled'); assert.deepEqual(await authorTree(author), beforeScript);
  await scriptOpen(); await click('#scriptCreateApply'); await wait(() => evaluate(`!document.querySelector('#scriptCreateDialog').open&&window.__referenceState.isCreating`), 'official retry script draft'); assert.deepEqual(await authorTree(author), beforeScript);
  await saveOrdinary(scriptPath); scriptRecord = await record(scriptPath); assert.equal(await fs.readFile(path.join(author, scriptPath), 'utf8'), GODOT_ACTION_SCENE_RETRY_SCRIPT); await stage('UI official retry script Save');

  // Input mapping is an independent reviewed ordinary author document.
  await enabled('#inputMapBtn'); await click('#inputMapBtn'); await enabled('#inputMapCheck'); await fill('#inputMapPath', 'documents/input/retry.json'); await fill('#inputMapType', 'document', 'change'); await fill('#inputMapName', 'start_retry');
  await fill('#inputMapKeyChoice', 'Enter', 'change'); await click('#inputMapAddKey'); await fill('#inputMapKeys', 'KeyA', 'change'); await click('#inputMapRemoveKey');
  const beforeMap = await authorTree(author); await click('#inputMapCheck'); await enabled('#inputMapApply'); await click('#inputMapApply'); await wait(() => evaluate(`!document.querySelector('#inputMapDialog').open&&window.__referenceState.isCreating`), 'input map source draft'); assert.deepEqual(await authorTree(author), beforeMap);
  await saveOrdinary('documents/input/retry.json'); mapRecord = await record('documents/input/retry.json'); assert.deepEqual(JSON.parse(await fs.readFile(path.join(author, mapRecord.sourcePath), 'utf8')).actions, [{ name: 'start_retry', keys: ['Enter'] }]); await stage('UI saved custom Enter action');

  await openBuild(retryScene.id); await enabled('#projectBuildAssembly'); await click('#projectBuildAssembly'); await enabled('#projectAssemblyNew'); await click('#projectAssemblyNew'); await enabled('#projectAssemblyCheck');
  await fill('#projectAssemblyName', 'Retry parameter trial'); await fill('#projectAssemblyPath', 'documents/projects/trial.json'); await fill('#projectAssemblyType', 'document', 'change');
  for (const member of [retryScene, levelScene]) { await fill('#projectAssemblyCandidate', member.id, 'change'); await click('#projectAssemblyAdd'); }
  await fill('#projectAssemblyEntry', retryScene.id, 'change'); await fill('#projectAssemblyInputMap', mapRecord.id, 'change');
  const beforeAssembly = await authorTree(author); await click('#projectAssemblyCheck'); await enabled('#projectAssemblySave'); assert.deepEqual(await authorTree(author), beforeAssembly); await click('#projectAssemblySave');
  await wait(async () => { try { return (await readRegistry(author)).documents.some(row => row.sourcePath === 'documents/projects/trial.json'); } catch { return false; } }, 'assembly saved'); assembly = await record('documents/projects/trial.json');
  await enabled('#projectAssemblyCancel'); await click('#projectAssemblyCancel'); await wait(() => evaluate(`!document.querySelector('#projectAssemblyDialog').open`), 'assembly closed'); await stage('UI two-scene assembly creation');

  // A small visible HUD makes the independent native Enter→Level proof observable.
  await fill('#projectBuildScene', levelScene.id, 'change'); await enabled('#projectBuildSceneHUD2D'); await click('#projectBuildSceneHUD2D');
  await wait(() => evaluate(`document.querySelector('#sceneHUD2DDialog').open&&document.querySelector('#sceneHUD2DDialog').getAttribute('aria-busy')==='false'&&!document.querySelector('#sceneHUD2DFields').disabled`), 'HUD creation ready');
  await fill('#sceneHUD2DPath', 'documents/hud/level.json'); await fill('#sceneHUD2DType', 'document', 'change');
  for (const [key, prefix, y] of [['score', 'Score: ', '48'], ['health', 'Health: ', '104']]) {
    await click('#sceneHUD2DAddLabel'); await fill('#sceneHUD2DContentKind', 'state', 'change'); await fill('#sceneHUD2DKey', key); await fill('#sceneHUD2DPrefix', prefix); await fill('#sceneHUD2DMissing', 'not initialized');
    await fill('#sceneHUD2DX', '40'); await fill('#sceneHUD2DY', y); await fill('#sceneHUD2DWidth', '400'); await fill('#sceneHUD2DHeight', '48'); await fill('#sceneHUD2DFontSize', '32');
  }
  const beforeHud = await authorTree(author); await enabled('#sceneHUD2DCheck'); await click('#sceneHUD2DCheck'); await enabled('#sceneHUD2DSave'); assert.deepEqual(await authorTree(author), beforeHud);
  const hudText = await evaluate(`document.querySelector('#sceneHUD2DReviewText').textContent`); assert.equal(JSON.parse(hudText).elements.length, 2); await click('#sceneHUD2DSave');
  await wait(async () => { try { return await fs.readFile(path.join(author, 'documents/hud/level.json'), 'utf8') === hudText; } catch { return false; } }, 'HUD saved');
  await wait(() => evaluate(`document.querySelector('#sceneHUD2DDialog').getAttribute('aria-busy')==='false'`), 'HUD save confirmed'); hudRecord = await record('documents/hud/level.json'); await screenshot('level-hud-created-desktop.png');
  await click('#sceneHUD2DCancel'); await wait(() => evaluate(`!document.querySelector('#sceneHUD2DDialog').open`), 'HUD closed'); await closeBuild(); await stage('UI level HUD state labels');
  report.steps.push('Create a saved custom Enter action, two-member assembly and Level HUD through their ordinary UI forms. No input map, member relationship or HUD is seeded by the harness.');

  // The first behavior is deliberately created last, so its initial reviewed
  // transaction already contains usable project parameters for its one retry binding.
  const behaviorPath = 'documents/behaviors/retry.json';
  const openCreator = async () => { await openBuild(retryScene.id); await enabled('#projectBuildCreateBehavior'); await click('#projectBuildCreateBehavior'); await enabled('#sceneBehaviorCreateParameters'); await fill('#sceneBehaviorCreateType', 'document', 'change'); await fill('#sceneBehaviorCreatePath', behaviorPath); await fill('#sceneBehaviorCreateSource', scriptRecord.id, 'change'); };
  const bindingIds = () => evaluate(`Array.from(document.querySelector('#sceneBehaviorCreateBindingList').options,row=>row.value)`);
  const currentBinding = () => value('#sceneBehaviorCreateBindingList');
  const chooseBinding = async id => { await fill('#sceneBehaviorCreateBindingList', id, 'change'); await enabled('#sceneBehaviorCreateParameters'); };
  const params = () => value('#sceneBehaviorCreateParameters');
  const creatorIdle = () => wait(() => evaluate(`document.querySelector('#sceneBehaviorCreateDialog').getAttribute('aria-busy')==='false'`), 'creation request complete');
  const reviewCreation = async () => { await enabled('#sceneBehaviorCreateCheck'); await click('#sceneBehaviorCreateCheck'); await enabled('#sceneBehaviorCreateSave'); await creatorIdle(); };
  const addMissing = async () => { await enabled('#sceneBehaviorCreateAddMissingParameters'); await click('#sceneBehaviorCreateAddMissingParameters'); };
  const beforeBehavior = await authorTree(author);
  await openCreator(); assert.equal(await params(), '{}');
  await fill('#sceneBehaviorCreateSource', '', 'change'); assert.equal(await params(), '{}'); await fill('#sceneBehaviorCreateSource', scriptRecord.id, 'change'); assert.equal(await params(), '{}');
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorCreateParameterInterface').dataset.status`), 'ready');
  for (const unfinished of ['{"incomplete":1e-', '{"duplicate":1,"duplicate":2}']) {
    await fill('#sceneBehaviorCreateParameters', unfinished); assert.equal(await params(), unfinished); assert.equal(await evaluate(`document.querySelector('#sceneBehaviorCreateAddMissingParameters').disabled`), true);
    await click('#sceneBehaviorCreateCheck'); await creatorIdle(); assert.equal(await params(), unfinished); assert.equal(await evaluate(`document.querySelector('#sceneBehaviorCreateSave').disabled`), true); assert.deepEqual(await authorTree(author), beforeBehavior);
  }
  await screenshot('unfinished-parameter-json-desktop.png');
  const pasted = '{\r\n  "probe":1e2,\r\n  "negative_zero":-0,\r\n  "note":"first\\r\\nnext"\r\n}';
  await fill('#sceneBehaviorCreateParameters', pasted); const firstRaw = await params(); assert.equal(firstRaw, pasted.replaceAll('\r\n', '\n'));
  const firstId = await currentBinding(); await click('#sceneBehaviorCreateAddBinding'); const secondId = await currentBinding(); assert.notEqual(secondId, firstId); assert.equal(await params(), '{}');
  const secondRaw = '{ "action_name":"start_retry", "target_scene_id":' + JSON.stringify(levelScene.id) + ', "state_values_json":"{}" }';
  await fill('#sceneBehaviorCreateParameters', secondRaw); await chooseBinding(firstId); assert.equal(await params(), firstRaw);
  const narrowCreation = async name => {
    for (const language of ['zh-CN', 'en', 'ja']) {
      await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
      await evaluate(`document.querySelector('#sceneBehaviorCreateAddMissingParameters').scrollIntoView({block:'center'})`);
      const layout = await evaluate(`(()=>{const d=document.querySelector('#sceneBehaviorCreateDialog'),b=document.querySelector('#sceneBehaviorCreateAddMissingParameters'),r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {noOverflow:d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1,title:document.querySelector('#sceneBehaviorCreateTitle').textContent,helperTitle:document.querySelector('#sceneBehaviorCreateParameterTitle').textContent,helperStatus:document.querySelector('#sceneBehaviorCreateParameterStatus').textContent,actionVisible:r.top>=0&&r.bottom<=844&&r.left>=0&&r.right<=390,actionHit:hit===b||b.contains(hit),helperReady:document.querySelector('#sceneBehaviorCreateParameterInterface').dataset.status,raw:document.querySelector('#sceneBehaviorCreateParameters').value,binding:document.querySelector('#sceneBehaviorCreateBindingList').value};})()`);
      assert.equal(layout.noOverflow, true, JSON.stringify(layout)); assert.equal(layout.actionVisible, true); assert.equal(layout.actionHit, true); assert.equal(layout.helperReady, 'ready'); assert.equal(layout.raw, firstRaw); assert.equal(layout.binding, firstId);
      await chooseBinding(secondId); assert.equal(await params(), secondRaw); await chooseBinding(firstId); assert.equal(await params(), firstRaw); assert.deepEqual(await bindingIds(), [firstId, secondId]);
      report.layout[name + '-' + language] = layout; await screenshot(name + '-' + language + '-390.png');
    }
    await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  };
  await narrowCreation('first-create-parameter-interface');
  await reviewCreation(); const lexicalPreview = await evaluate(`document.querySelector('#sceneBehaviorCreateSourceText').textContent`), lexical = JSON.parse(lexicalPreview);
  assert.ok(lexicalPreview.includes(firstRaw), 'review uses the original complete parameter JSON fragment'); assert.equal(lexical.bindings[0].parameters.probe, 100); assert.ok(Object.is(lexical.bindings[0].parameters.negative_zero, -0)); assert.equal(lexical.bindings[0].parameters.note, 'first\r\nnext'); assert.deepEqual(lexical.bindings.map(row => row.bindingId), [firstId, secondId]);
  const beforeAdd = await params(); await addMissing(); const afterAdd = await params(); assert.notEqual(afterAdd, beforeAdd); assert.ok(afterAdd.includes('"probe":1e2')); assert.ok(afterAdd.includes('"negative_zero":-0')); assert.equal(JSON.parse(afterAdd).note, 'first\r\nnext');
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorCreateReview').hidden`), true); assert.equal(await evaluate(`document.querySelector('#sceneBehaviorCreateSave').disabled`), true);
  await chooseBinding(secondId); assert.equal(await params(), secondRaw); await chooseBinding(firstId); assert.equal(await params(), afterAdd); assert.deepEqual(await authorTree(author), beforeBehavior);
  report.cancelledCreation = { bindingIds: [firstId, secondId], pastedOuterCRLF: pasted, actualTextareaRaw: firstRaw, lexicalPreview, addedRaw: afterAdd, otherBindingRaw: secondRaw, authorWrites: 0 };
  await click('#sceneBehaviorCreateCancel'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorCreateDialog').open`), 'unsaved parameter creation cancelled'); assert.deepEqual(await authorTree(author), beforeBehavior);
  report.steps.push('Before the first behavior Save, actual JSON controls retain unfinished/duplicate input; switching bindings and three languages retain complete raw fragments. Review preserves 1e2, -0 and escaped CRLF; explicit Add missing revokes review, changes only that binding and Cancel writes nothing. Outer textarea CRLF normalization is recorded, not treated as lossless paste.');

  await openCreator(); assert.equal(await params(), '{}');
  const initialValues = ['{"score":0,"health":3}'];
  const rawRows = [], savedIds = [];
  for (let index = 0; index < 1; index++) {
    savedIds.push(await currentBinding());
    const partial = '{\n  "action_name":"start_retry",\n  "state_values_json":' + JSON.stringify(initialValues[index]) + '\n}';
    await fill('#sceneBehaviorCreateParameters', partial); await addMissing(); const added = JSON.parse(await params()); assert.equal(added.action_name, 'start_retry'); assert.equal(added.state_values_json, initialValues[index]); assert.equal(added.target_scene_id, '');
    const finalRaw = (await params()).replace(/("target_scene_id"\s*:\s*)""/, '$1' + JSON.stringify(levelScene.id)); assert.notEqual(finalRaw, await params()); await fill('#sceneBehaviorCreateParameters', finalRaw); rawRows.push(await params());
    assert.equal(await evaluate(`document.querySelector('#sceneBehaviorCreateAddMissingParameters').disabled`), true);
  }
  await chooseBinding(savedIds[0]); assert.equal(await params(), rawRows[0]);
  await reviewCreation(); const candidate = await evaluate(`document.querySelector('#sceneBehaviorCreateSourceText').textContent`), planned = JSON.parse(candidate);
  assert.equal(planned.bindings.length, 1); assert.deepEqual(planned.bindings.map(row => row.bindingId), savedIds); assert.ok(rawRows.every(raw => candidate.includes(raw)));
  for (let index = 0; index < 1; index++) { assert.deepEqual(planned.bindings[index].parameters, { action_name: 'start_retry', target_scene_id: levelScene.id, state_values_json: initialValues[index] }); }
  assert.deepEqual(await authorTree(author), beforeBehavior); await screenshot('first-parameterized-behavior-reviewed-desktop.png');
  await click('#sceneBehaviorCreateSave'); await enabled('#sceneBehaviorCreateOpen'); await creatorIdle(); behaviorRecord = await record(behaviorPath);
  assert.equal(await fs.readFile(path.join(author, behaviorPath), 'utf8'), candidate); const saved = await authorTree(author), changes = [...new Set([...Object.keys(beforeBehavior), ...Object.keys(saved)])].filter(name => beforeBehavior[name] !== saved[name]).sort();
  assert.deepEqual(changes, [behaviorPath, `metadata/documents/${behaviorRecord.id}.json`, `metadata/documents/${retryScene.id}.json`].sort());
  report.firstSave = { bindingIds: savedIds, parametersRaw: rawRows, initializerTexts: initialValues, reviewedContent: candidate, sourceSha256: hash(candidate), changedPaths: changes, parametersPresentOnInitialSave: true };
  await stage('UI first behavior transaction already includes its retry parameter JSON');
  await click('#sceneBehaviorCreateOpen'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorCreateDialog').open&&!document.querySelector('#projectBuildDialog').open`), 'new behavior source opened');
  assert.equal(await value('#docSourceEditor'), candidate.replace(/\r\n|\r/g, '\n'));
  const requestsBeforeReload = await evaluate('window.__creationParameterRequests');
  await call('Page.reload'); await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'Studio reopen'); await evaluate(`window.__referenceState=(await import('/web/modules/app-state.js')).appState`);
  await openDocument(behaviorRecord); assert.equal(await value('#docSourceEditor'), candidate.replace(/\r\n|\r/g, '\n')); assert.equal(await fs.readFile(path.join(author, behaviorPath), 'utf8'), candidate); await screenshot('parameterized-first-save-reopened-desktop.png'); assert.deepEqual(await authorTree(author), saved);
  const observedRequests = [...requestsBeforeReload, ...await evaluate('window.__creationParameterRequests')]; report.requests = observedRequests;
  const applied = observedRequests.filter(row => row.url.includes('/api/world/commands') && row.body?.command === 'behavior.create' && row.body.mode === 'apply');
  assert.equal(applied.length, 1); assert.equal(applied[0].body.content, candidate); assert.equal(applied[0].status, 200);
  report.steps.push('The final first behavior transaction contains one configured retry binding at creation time. Only manifest source, its registration and the scene behavior relation change; the reviewed raw fragment is saved exactly, ordinary reload retains them, and exactly one behavior.create apply is observed. No empty-parameter manifest is saved and later patched.');
  const finalRegistry = await readRegistry(author); assert.equal(finalRegistry.documents.length, 8); assert.equal(finalRegistry.assets.length, 0);
  const captured = await captureBuildSnapshot(author, assembly.id); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics)); assert.equal(captured.plan.scenes.length, 2); assert.equal(captured.plan.entrySceneId, retryScene.id);
  const plannedRetry = captured.plan.scenes.find(row => row.scene.objectId === retryScene.id); assert.equal(plannedRetry.behaviors.bindings.length, 1); assert.deepEqual(plannedRetry.behaviors.bindings.map(row => row.parameters), planned.bindings.map(row => row.parameters));
  const finalDirectory = path.join(output, 'author-final'); await fs.mkdir(finalDirectory);
  for (const name of Object.keys(saved)) { if (name !== 'workspace.json' && !/^(documents|templates|metadata|assets)\//.test(name)) continue; const file = path.join(finalDirectory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.copyFile(path.join(author, name), file); }
  assert.deepEqual(await authorTree(finalDirectory), saved, 'retained final author workspace must match saved UI bytes');
  report.authorFinal = { path: finalDirectory, hashes: saved, registryDocumentCount: finalRegistry.documents.length, registryAssetCount: finalRegistry.assets.length };
  report.identities = { definition: definition.id, retryScene: retryScene.id, levelScene: levelScene.id, script: scriptRecord.id, behavior: behaviorRecord.id, inputMap: mapRecord.id, assembly: assembly.id, hud: hudRecord.id };
  report.plan = { ok: captured.ok, snapshotId: captured.snapshotId, entrySceneId: captured.plan.entrySceneId, sceneIds: captured.plan.scenes.map(row => row.scene.objectId), retryParameters: plannedRetry.behaviors.bindings.map(row => row.parameters) };
  report.steps.push('Retain the eight-document author workspace and capture its valid two-scene project plan; actual Godot keyboard input remains a separate verification task.');
  report.sampleAfter = await authorTree(source); assert.deepEqual(report.sampleAfter, report.sampleBefore); report.sourcesAfter = await sourceHashes(); assert.deepEqual(report.sourcesAfter, report.sourcesBefore); assert.equal(hash(await fs.readFile(fileURLToPath(import.meta.url))), report.driverSha256); assert.deepEqual(report.errors, []); report.ok = true;
} catch (error) { report.ok = false; report.failure = error.stack; process.exitCode = 1; console.error(error); try { await captureFailure?.(); } catch (failure) { report.captureFailure = failure.message; } }
finally {
  socket?.close(); for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ ok: report.ok, output, screenshots: report.screenshots.length, steps: report.steps, failure: report.failure }, null, 2));
}
