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
const source = path.resolve(process.env.VIENTO_CREATE_REFERENCES_SAMPLE_SOURCE || path.join(appRoot, 'examples/topdown-collect'));
const output = path.resolve(process.env.VIENTO_CREATE_REFERENCES_OUTPUT || `/tmp/viento-create-references-browser-${Date.now()}`);
if (!output.startsWith('/tmp/')) throw Error('This browser smoke writes evidence only beneath /tmp.');
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceNames = ['engine/scene-behavior-create-references.mjs', 'web/modules/app-scene-behavior-create-references.js', 'web/modules/app-project-build.js', 'engine/scene-behavior-create-parameters.mjs', 'engine/scene-behavior-create-plan.mjs', 'engine/world-behavior-create.mjs', 'web/modules/app-scene-behavior-create.js', 'web/modules/app-scene-behavior-create-parameters.js', 'scripts/lib/scene-behavior-creation-service.mjs', 'web/scene-behavior-create.css', 'engine/scene-behavior-reference-directory.mjs', 'scripts/lib/scene-behavior-reference-directory-service.mjs',
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
  'First-creation reference names come only from the real existing readonly directory port. Load/selection never changes JSON; explicit Use fresh-checks and inserts one existing String token. No author schema, transaction, source-host brand or runtime API is changed.',
  'The retained author-final workspace and frozen plan enable a separate actual Godot keyboard/HUD check. This browser report does not claim native gameplay, same-scene restart or independent distribution.'
] };
const wait = async (check, label, budget = 45000) => { for (const end = Date.now() + budget; Date.now() < end;) { if (await check()) return; await delay(80); } throw Error('Timed out: ' + label); };
let socket, captureFailure, confirmAccept = true;
try {
  report.sourcesBefore = await sourceHashes(); report.driverSha256 = hash(await fs.readFile(fileURLToPath(import.meta.url)));
  report.sampleBefore = await authorTree(source); report.node = { version: process.version, sha256: hash(await fs.readFile(process.execPath)) };
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-create-references-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const author = path.join(temporary, 'author'); await fs.mkdir(author);
  const blank = PROJECT_TEMPLATE_CATALOG.templates.find(row => row.packageId === 'org.viento.blank'); assert.ok(blank);
  const workspace = { format: 'viento-workspace', version: 3, id: randomUUID(), name: 'First creation named reference UI trial', createdAt: 0,
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
  const requests = new Map(); let sequence = 0, holdNextReferenceRequest = false, heldReferenceRequest = null;
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; requests.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.id) { const request = requests.get(value.id); requests.delete(value.id); value.error ? request?.reject(Error(value.error.message)) : request?.resolve(value.result); }
    else if (value.method === 'Fetch.requestPaused') {
      if (holdNextReferenceRequest && value.params.request.url.includes('/api/scene-behavior-reference-directory')) { holdNextReferenceRequest = false; heldReferenceRequest = { requestId: value.params.requestId, url: value.params.request.url, method: value.params.request.method, body: JSON.parse(value.params.request.postData) }; }
      else void call('Fetch.continueRequest', { requestId: value.params.requestId });
    }
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
  await call('Page.addScriptToEvaluateOnNewDocument', { source: "(()=>{window.__creationParameterRequests=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=String(input),response=await original(input,init);if(url.includes('/api/scene-behavior-creation')||url.includes('/api/world/commands')||url.includes('/api/scene-behavior-reference-directory')){let body=null,result=null;try{body=JSON.parse(init?.body||'null')}catch{}try{result=await response.clone().json()}catch{}window.__creationParameterRequests.push({url,method:init?.method||'GET',body,status:response.status,result});}return response;};})()" });
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
    if (title === 'Retry page') { await click('#sceneCreateAdd'); await fill('#sceneActor1Object', definition.id, 'change'); await fill('#sceneActor1Controls', 'none', 'change'); await fill('#sceneActor1Speed', '0'); }
    const before = await authorTree(author); await click('#sceneCreateCheck'); await enabled('#sceneCreateSave'); assert.deepEqual(await authorTree(author), before);
    const declaration = JSON.parse(await evaluate(`document.querySelector('#sceneCreateSource').textContent`)); assert.equal(declaration.schemaVersion, 2); assert.equal(declaration.actors.length, title === 'Retry page' ? 2 : 1);
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

  // The first behavior is created after the saved input/assembly/HUD, so every
  // reference offered below comes from an actual saved readonly directory.
  const behaviorPath = 'documents/behaviors/retry.json';
  const openCreator = async () => { await openBuild(retryScene.id); await enabled('#projectBuildCreateBehavior'); await click('#projectBuildCreateBehavior'); await enabled('#sceneBehaviorCreateParameters'); await fill('#sceneBehaviorCreateType', 'document', 'change'); await fill('#sceneBehaviorCreatePath', behaviorPath); await fill('#sceneBehaviorCreateSource', scriptRecord.id, 'change'); };
  const params = () => value('#sceneBehaviorCreateParameters');
  const currentBinding = () => value('#sceneBehaviorCreateBindingList');
  const bindingIds = () => evaluate(`Array.from(document.querySelector('#sceneBehaviorCreateBindingList').options,row=>row.value)`);
  const chooseBinding = async id => { await fill('#sceneBehaviorCreateBindingList', id, 'change'); await enabled('#sceneBehaviorCreateParameters'); };
  const creatorIdle = () => wait(() => evaluate(`document.querySelector('#sceneBehaviorCreateDialog').getAttribute('aria-busy')==='false'`), 'creation request complete');
  const reviewCreation = async () => { await enabled('#sceneBehaviorCreateCheck'); await click('#sceneBehaviorCreateCheck'); await enabled('#sceneBehaviorCreateSave'); await creatorIdle(); };
  const reviewState = () => evaluate(`({hidden:document.querySelector('#sceneBehaviorCreateReview').hidden,content:document.querySelector('#sceneBehaviorCreateSourceText').textContent,saveDisabled:document.querySelector('#sceneBehaviorCreateSave').disabled})`);
  const addMissing = async () => { await enabled('#sceneBehaviorCreateAddMissingParameters'); await click('#sceneBehaviorCreateAddMissingParameters'); };
  const ref = suffix => '#sceneBehaviorCreateReferences' + suffix;
  const refsIdle = () => wait(() => evaluate(`document.querySelector('#sceneBehaviorCreateReferences')?.getAttribute('aria-busy')==='false'`), 'reference request complete');
  const referenceRequestCount = () => evaluate(`window.__creationParameterRequests.filter(row=>row.url.includes('/api/scene-behavior-reference-directory')).length`);
  const loadReferences = async () => { const before = await params(), review = await reviewState(), requests = await referenceRequestCount(); await enabled(ref('Load')); await click(ref('Load')); await wait(async () => await referenceRequestCount() > requests, 'actual reference directory response'); await refsIdle(); assert.equal(await evaluate(`document.querySelector(${JSON.stringify(ref('Status'))}).dataset.status`), 'ready'); assert.equal(await params(), before); assert.deepEqual(await reviewState(), review); assert.equal(await value(ref('Assembly')), ''); return evaluate(`Array.from(document.querySelector(${JSON.stringify(ref('Assembly'))}).options,row=>({value:row.value,label:row.textContent}))`); };
  const selectName = async (selector, name) => { const choices = await evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).options,row=>({value:row.value,label:row.textContent}))`), found = choices.filter(row => row.value && row.label.toLowerCase().includes(name.toLowerCase())); assert.equal(found.length, 1, JSON.stringify({ selector, name, choices })); await fill(selector, found[0].value, 'change'); return found[0]; };
  const selectAssembly = async () => { const before = await params(), review = await reviewState(), requests = await referenceRequestCount(); const selected = await selectName(ref('Assembly'), 'Retry parameter trial'); assert.equal(selected.value, assembly.id); await wait(async () => await referenceRequestCount() > requests, 'explicit selected assembly response'); await refsIdle(); assert.equal(await params(), before); assert.deepEqual(await reviewState(), review); };
  const selectReference = async (kind, name, parameter) => { const before = await params(), review = await reviewState(); await enabled(ref('Kind')); await fill(ref('Kind'), kind, 'change'); const selected = await selectName(ref('Choice'), name); await fill(ref('Parameter'), parameter, 'change'); assert.equal(await params(), before); assert.deepEqual(await reviewState(), review); await enabled(ref('Use')); return selected; };
  const useReference = async () => { const before = await params(), review = await reviewState(), requests = await referenceRequestCount(); await enabled(ref('Use')); await click(ref('Use')); await wait(async () => await referenceRequestCount() > requests, 'actual fresh directory response before insertion'); await refsIdle(); return { before, after: await params(), beforeReview: review, afterReview: await reviewState() }; };
  const assertRevoked = async () => { const state = await reviewState(); assert.equal(state.hidden, true); assert.equal(state.saveDisabled, true); };
  const expectNoop = async () => { const before = await params(), review = await reviewState(), result = await useReference(); assert.equal(result.after, before); assert.deepEqual(await reviewState(), review); assert.equal(review.saveDisabled, false); return { content: before, review, status: await evaluate(`document.querySelector(${JSON.stringify(ref('Status'))}).textContent`) }; };
  const holdFreshUse = async label => { assert.equal(heldReferenceRequest, null); holdNextReferenceRequest = true; await enabled(ref('Use')); await click(ref('Use')); await wait(() => heldReferenceRequest !== null, 'CDP holds real fresh directory request ' + label); return heldReferenceRequest; };
  const releaseFresh = async held => { assert.equal(heldReferenceRequest, held); const requests = await referenceRequestCount(); heldReferenceRequest = null; await call('Fetch.continueRequest', { requestId: held.requestId }); await wait(async () => await referenceRequestCount() > requests, 'held request receives real HTTP result'); await refsIdle(); };
  await call('Fetch.enable', { patterns: [{ urlPattern: '*/api/scene-behavior-reference-directory', requestStage: 'Request' }] });
  const beforeBehavior = await authorTree(author);
  await openCreator(); assert.equal(await params(), '{}'); await fill('#sceneBehaviorCreateSource', '', 'change'); await fill('#sceneBehaviorCreateSource', scriptRecord.id, 'change'); assert.equal(await params(), '{}');
  await addMissing(); const defaultsRaw = await params(); assert.deepEqual(JSON.parse(defaultsRaw), { action_name: 'ui_accept', target_scene_id: '', state_values_json: '{"score":0,"health":100}' });
  const crlf = String.fromCharCode(13, 10), lf = String.fromCharCode(10);
  const pasted = ['{', ' "action_name":"ui_accept",', ' "target_scene_id":"",', ' "state_values_json":"{}",', ' "instance_probe":"",', ' "probe":1e2,', ' "negative_zero":-0,', ' "note":' + JSON.stringify('first' + crlf + 'next'), '}'].join(crlf);
  await fill('#sceneBehaviorCreateParameters', pasted); const firstRaw = await params(); assert.equal(firstRaw, pasted.replaceAll(crlf, lf));
  const firstId = await currentBinding(); await reviewCreation(); const initialReview = await reviewState(); assert.ok(initialReview.content.includes(firstRaw));
  const assemblies = await loadReferences(); assert.ok(assemblies.some(row => row.value === assembly.id)); assert.equal(await value(ref('Kind')), ''); assert.equal(await value(ref('Choice')), ''); assert.equal(await value(ref('Parameter')), '');
  await fill(ref('Kind'), 'instance', 'change'); const instances = await evaluate(`Array.from(document.querySelector(${JSON.stringify(ref('Choice'))}).options,row=>({value:row.value,label:row.textContent})).filter(row=>row.value)`);
  const sceneActors = JSON.parse(await fs.readFile(path.join(author, retryScene.sourcePath), 'utf8')).actors; assert.equal(sceneActors.length, 2); assert.equal(instances.length, 2); assert.equal(new Set(instances.map(row => row.value)).size, 2); assert.deepEqual(instances.map(row => row.value).sort(), sceneActors.map(row => row.instanceId).sort()); assert.equal(new Set(sceneActors.map(row => row.objectId)).size, 1);
  for (const item of instances) { const before = await params(), review = await reviewState(); await fill(ref('Choice'), item.value, 'change'); await fill(ref('Parameter'), 'instance_probe', 'change'); assert.equal(await params(), before); assert.deepEqual(await reviewState(), review); const change = await useReference(); assert.notEqual(change.after, before); assert.equal(JSON.parse(change.after).instance_probe, item.value); assert.ok(change.after.includes('"probe":1e2')); assert.ok(change.after.includes('"negative_zero":-0')); assert.equal(JSON.parse(change.after).note, 'first\r\nnext'); await assertRevoked(); await reviewCreation(); }
  await selectAssembly(); const sceneChoice = await selectReference('scene', 'Level', 'target_scene_id'); assert.equal(sceneChoice.value, levelScene.id); const sceneWrite = await useReference(); assert.notEqual(sceneWrite.after, sceneWrite.before); assert.equal(JSON.parse(sceneWrite.after).target_scene_id, levelScene.id); await assertRevoked(); await reviewCreation();
  const noOp = await expectNoop();
  const actionChoice = await selectReference('action', 'start_retry', 'action_name'); assert.equal(actionChoice.value, 'start_retry'); const actionWrite = await useReference(); assert.notEqual(actionWrite.after, actionWrite.before); assert.equal(JSON.parse(actionWrite.after).action_name, 'start_retry'); await assertRevoked(); await reviewCreation();
  const heldEdit = await holdFreshUse('parameter edit'), beforeEdit = await params(), edited = beforeEdit + ' ';
  await fill('#sceneBehaviorCreateParameters', edited); assert.equal(await params(), edited); await releaseFresh(heldEdit); assert.equal(await params(), edited); await assertRevoked();
  await loadReferences(); await fill(ref('Kind'), 'instance', 'change'); await fill(ref('Choice'), instances[0].value, 'change'); await fill(ref('Parameter'), 'instance_probe', 'change');
  await click('#sceneBehaviorCreateAddBinding'); const secondId = await currentBinding(); assert.notEqual(secondId, firstId); const secondRaw = '{ "caption":"second binding remains exact" }'; await fill('#sceneBehaviorCreateParameters', secondRaw); await chooseBinding(firstId); assert.equal(await params(), edited);
  await loadReferences(); await fill(ref('Kind'), 'instance', 'change'); await fill(ref('Choice'), instances[0].value, 'change'); await fill(ref('Parameter'), 'instance_probe', 'change');
  const heldSwitch = await holdFreshUse('binding switch'); await chooseBinding(secondId); assert.equal(await params(), secondRaw); await releaseFresh(heldSwitch); assert.equal(await params(), secondRaw); await chooseBinding(firstId); assert.equal(await params(), edited); assert.deepEqual(await bindingIds(), [firstId, secondId]);
  for (const unfinished of ['{"unfinished":1e-', '{"caption":"a","caption":"b"}']) { await fill('#sceneBehaviorCreateParameters', unfinished); assert.equal(await params(), unfinished); await loadReferences(); assert.equal(await evaluate(`document.querySelector(${JSON.stringify(ref('Use'))}).disabled`), true); await click('#sceneBehaviorCreateCheck'); await creatorIdle(); assert.equal(await params(), unfinished); await assertRevoked(); assert.deepEqual(await authorTree(author), beforeBehavior); }
  await screenshot('unfinished-reference-parameter-json-desktop.png'); await fill('#sceneBehaviorCreateParameters', edited); await loadReferences(); await selectAssembly(); await selectReference('scene', 'Level', 'target_scene_id');
  for (const language of ['zh-CN', 'en', 'ja']) {
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`); await evaluate(`document.querySelector(${JSON.stringify(ref('Use'))}).scrollIntoView({block:'center'})`);
    const layout = await evaluate(`(()=>{const d=document.querySelector('#sceneBehaviorCreateDialog'),b=document.querySelector(${JSON.stringify(ref('Use'))}),r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {noOverflow:d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1,title:document.querySelector(${JSON.stringify(ref('Title'))}).textContent,note:document.querySelector(${JSON.stringify(ref('Note'))}).textContent,status:document.querySelector(${JSON.stringify(ref('Status'))}).textContent,actionVisible:r.top>=0&&r.bottom<=844&&r.left>=0&&r.right<=390,actionHit:hit===b||b.contains(hit),raw:document.querySelector('#sceneBehaviorCreateParameters').value,binding:document.querySelector('#sceneBehaviorCreateBindingList').value,assembly:document.querySelector(${JSON.stringify(ref('Assembly'))}).value,kind:document.querySelector(${JSON.stringify(ref('Kind'))}).value,choice:document.querySelector(${JSON.stringify(ref('Choice'))}).value,parameter:document.querySelector(${JSON.stringify(ref('Parameter'))}).value};})()`);
    assert.equal(layout.noOverflow, true, JSON.stringify(layout)); assert.equal(layout.actionVisible, true); assert.equal(layout.actionHit, true); assert.equal(layout.raw, edited); assert.equal(layout.binding, firstId); assert.equal(layout.assembly, assembly.id); assert.equal(layout.kind, 'scene'); assert.equal(layout.choice, levelScene.id); assert.equal(layout.parameter, 'target_scene_id'); report.layout[language] = layout; await screenshot('first-create-references-' + language + '-390.png');
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  assert.deepEqual(await authorTree(author), beforeBehavior);
  report.cancelledCreation = { bindingIds: [firstId, secondId], pastedOuterCRLF: pasted, actualTextareaRaw: firstRaw, initialReview, instances, instanceActors: sceneActors.map(row => ({ instanceId: row.instanceId, objectId: row.objectId })), sceneChoice, actionChoice, sameValueNoop: noOp, delayedResponses: [{ kind: 'parameter-edit', request: heldEdit, edited, final: await params() }, { kind: 'binding-switch', request: heldSwitch, otherBindingRaw: secondRaw }], authorWrites: 0 };
  await click('#sceneBehaviorCreateCancel'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorCreateDialog').open`), 'unsaved reference creation cancelled'); assert.deepEqual(await authorTree(author), beforeBehavior);
  report.steps.push('Before the first behavior Save, explicit completion and readonly reference choices preserve raw input and review. Real Use inserts independent instance UUIDs, member-scene UUID and saved action name; same-value Use preserves exact raw/review. Two held real HTTP requests cannot overwrite later JSON or another binding. Invalid input, three language layouts and Cancel retain author bytes.');

  // Successful first creation uses only the three canonical retry exports.
  // Only state_values_json is typed; action and target come from visible names.
  await openCreator(); assert.equal(await params(), '{}'); await addMissing();
  const initialValues = ['{"score":0,"health":3}'], savedIds = [await currentBinding()];
  const completed = await params(), oldInitializerToken = JSON.stringify(JSON.parse(completed).state_values_json), initialized = completed.replace(oldInitializerToken, JSON.stringify(initialValues[0]));
  assert.notEqual(initialized, completed); await fill('#sceneBehaviorCreateParameters', initialized); const beforeNames = await params(); assert.equal(JSON.parse(beforeNames).action_name, 'ui_accept'); assert.equal(JSON.parse(beforeNames).target_scene_id, '');
  await loadReferences(); await selectAssembly(); const finalTarget = await selectReference('scene', 'Level', 'target_scene_id'); const targetFill = await useReference(); assert.equal(JSON.parse(targetFill.after).target_scene_id, levelScene.id);
  const finalAction = await selectReference('action', 'start_retry', 'action_name'); const actionFill = await useReference(); assert.equal(JSON.parse(actionFill.after).action_name, 'start_retry');
  const rawRows = [await params()]; await reviewCreation(); const candidate = await evaluate(`document.querySelector('#sceneBehaviorCreateSourceText').textContent`), planned = JSON.parse(candidate);
  assert.equal(planned.bindings.length, 1); assert.deepEqual(planned.bindings.map(row => row.bindingId), savedIds); assert.ok(candidate.includes(rawRows[0])); assert.deepEqual(planned.bindings[0].parameters, { action_name: 'start_retry', target_scene_id: levelScene.id, state_values_json: initialValues[0] });
  const finalNoop = await expectNoop(); assert.deepEqual(await authorTree(author), beforeBehavior); await screenshot('first-name-linked-behavior-reviewed-desktop.png');
  await click('#sceneBehaviorCreateSave'); await enabled('#sceneBehaviorCreateOpen'); await creatorIdle(); behaviorRecord = await record(behaviorPath);
  assert.equal(await fs.readFile(path.join(author, behaviorPath), 'utf8'), candidate); const saved = await authorTree(author), changes = [...new Set([...Object.keys(beforeBehavior), ...Object.keys(saved)])].filter(name => beforeBehavior[name] !== saved[name]).sort();
  assert.deepEqual(changes, [behaviorPath, `metadata/documents/${behaviorRecord.id}.json`, `metadata/documents/${retryScene.id}.json`].sort());
  report.firstSave = { bindingIds: savedIds, parametersRaw: rawRows, initializerTexts: initialValues, beforeNames, targetChoice: finalTarget, actionChoice: finalAction, sameValueNoop: finalNoop, reviewedContent: candidate, sourceSha256: hash(candidate), changedPaths: changes, parametersPresentOnInitialSave: true, targetAndActionWrittenOnlyByReferenceUse: true };
  await stage('UI first behavior transaction already includes retry parameters linked by saved reference names');
  await click('#sceneBehaviorCreateOpen'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorCreateDialog').open&&!document.querySelector('#projectBuildDialog').open`), 'new behavior source opened'); assert.equal(await value('#docSourceEditor'), candidate.replaceAll(crlf, lf).replaceAll(String.fromCharCode(13), lf));
  await call('Fetch.disable'); const requestsBeforeReload = await evaluate('window.__creationParameterRequests');
  await call('Page.reload'); await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'Studio reopen'); await evaluate(`window.__referenceState=(await import('/web/modules/app-state.js')).appState`);
  await openDocument(behaviorRecord); assert.equal(await value('#docSourceEditor'), candidate.replaceAll(crlf, lf).replaceAll(String.fromCharCode(13), lf)); assert.equal(await fs.readFile(path.join(author, behaviorPath), 'utf8'), candidate); await screenshot('name-linked-first-save-reopened-desktop.png'); assert.deepEqual(await authorTree(author), saved);
  const observedRequests = [...requestsBeforeReload, ...await evaluate('window.__creationParameterRequests')]; report.requests = observedRequests;
  const applied = observedRequests.filter(row => row.url.includes('/api/world/commands') && row.body?.command === 'behavior.create' && row.body.mode === 'apply'); assert.equal(applied.length, 1); assert.equal(applied[0].body.content, candidate); assert.equal(applied[0].status, 200);
  const directoryReads = observedRequests.filter(row => row.url.includes('/api/scene-behavior-reference-directory')); assert.ok(directoryReads.length >= 15); assert.ok(directoryReads.every(row => row.method === 'POST' && row.status === 200 && Object.keys(row.body).sort().join(',') === 'assemblyObjectId,sceneObjectId'));
  report.referenceReads = directoryReads.length; report.steps.push('The final first behavior transaction contains one retry whose target scene and action name were filled only by explicit named references. Only the three ordinary creation paths change; one apply is observed, and reload preserves the reviewed raw fragment.');
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
