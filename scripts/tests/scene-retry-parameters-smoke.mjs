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
const source = path.resolve(process.env.VIENTO_RETRY_PARAMETERS_SAMPLE_SOURCE || path.join(appRoot, 'examples/topdown-collect'));
const output = path.resolve(process.env.VIENTO_RETRY_PARAMETERS_OUTPUT || `/tmp/viento-retry-parameters-browser-${Date.now()}`);
if (!output.startsWith('/tmp/')) throw Error('This browser smoke writes evidence only beneath /tmp.');
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceNames = ['engine/scene-behavior-reference-directory.mjs', 'scripts/lib/scene-behavior-reference-directory-service.mjs',
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
  'Every definition, two scenes, official retry TXT, empty-parameter behavior, input map, assembly and HUD is subsequently created through actual Studio controls; no prepared game source, scene UUID or behavior metadata is injected.',
  'Default rows and named choices remain ordinary scalar parameters. Reading and selecting do not save; Add missing and Insert are explicit, followed by ordinary Check/Apply/Save.',
  'The retained author-final workspace and frozen plan enable a separate actual Godot keyboard/HUD check. This browser report does not claim native gameplay, same-scene restart or independent distribution.'
] };
const wait = async (check, label, budget = 45000) => { for (const end = Date.now() + budget; Date.now() < end;) { if (await check()) return; await delay(80); } throw Error('Timed out: ' + label); };
let socket, captureFailure, confirmAccept = true;
try {
  report.sourcesBefore = await sourceHashes(); report.driverSha256 = hash(await fs.readFile(fileURLToPath(import.meta.url)));
  report.sampleBefore = await authorTree(source); report.node = { version: process.version, sha256: hash(await fs.readFile(process.execPath)) };
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-behavior-reference-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const author = path.join(temporary, 'author'); await fs.mkdir(author);
  const blank = PROJECT_TEMPLATE_CATALOG.templates.find(row => row.packageId === 'org.viento.blank'); assert.ok(blank);
  const workspace = { format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Retry parameter UI trial', createdAt: 0,
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
  const prefix = '#sceneBehaviorsReferences', control = suffix => prefix + suffix;
  const refReady = () => enabled(control('Choice'));
  const load = async () => { await enabled(control('Load')); await click(control('Load')); await refReady(); };
  const chooseAssembly = async () => { await enabled(control('Assembly')); await fill(control('Assembly'), assembly.id, 'change'); await refReady(); };
  const choose = async (kind, selected, parameter) => {
    await fill(control('Kind'), kind, 'change'); await enabled(control('Choice')); await fill(control('Choice'), selected, 'change');
    const key = await evaluate(`(()=>{const options=Array.from(document.querySelector('${control('Parameter')}').options);const item=options.find(row=>row.textContent.includes(${JSON.stringify(parameter)}));if(!item)throw Error('Missing string parameter target');return item.value;})()`);
    await fill(control('Parameter'), key, 'change');
  };
  const rowValueSelector = async name => {
    const index = await evaluate(`Array.from(document.querySelectorAll('#sceneBehaviorsParameters input[id$="Name"]')).findIndex(row=>row.value===${JSON.stringify(name)})`);
    assert.ok(index >= 0, 'parameter row ' + name); return '#sceneBehaviorsParam' + index + 'Value';
  };
  const use = async (name, expected) => { await enabled(control('Use')); await click(control('Use')); const selector = await rowValueSelector(name); await wait(async () => await value(selector) === expected, 'explicit reference insertion ' + name); };
  const open = async () => { await enabled('#sceneBehaviorsBtn'); await click('#sceneBehaviorsBtn'); await wait(() => evaluate(`document.querySelector('#sceneBehaviorsDialog').open&&!document.querySelector('#sceneBehaviorsFields').hidden&&!document.querySelector('#sceneBehaviorsInstance').disabled`), 'behavior form ready'); };
  const close = async () => { await click('#sceneBehaviorsCancel'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`), 'behavior form closed'); };
  const check = async () => { await enabled('#sceneBehaviorsCheck'); await click('#sceneBehaviorsCheck'); await enabled('#sceneBehaviorsApply'); };
  const openDocument = async record => {
    await wait(() => evaluate(`(()=>{const s=window.__referenceState;return !s.isSaving&&!s.isRebuilding&&!s.isLoadingSource&&s.docs.some(row=>row.id===${JSON.stringify(record.id)})})()`), 'registered document ready');
    const indexPath = await evaluate(`window.__referenceState.docs.find(row=>row.id===${JSON.stringify(record.id)}).path`);
    await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(row=>row.dataset.path===${JSON.stringify(indexPath)})`), 'sidebar document ready');
    await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(row=>row.dataset.path===${JSON.stringify(indexPath)}).click()`);
    await wait(() => evaluate(`window.__referenceState.activePath===${JSON.stringify(indexPath)}&&!window.__referenceState.isLoadingSource`), 'document selected');
    await wait(async () => { const s = await evaluate(`({editing:window.__referenceState.isEditing,source:window.__referenceState.activeEditSource,canEdit:document.querySelector('#docEditBtn')?.disabled===false})`); if (s.editing && (s.source === record.sourcePath || s.source.endsWith('/' + record.sourcePath))) return true; if (!s.editing && s.canEdit) await click('#docEditBtn'); return false; }, 'source edit ready');
    await enabled('#docEditSourceModeBtn'); await click('#docEditSourceModeBtn'); await enabled('#sceneBehaviorsBtn');
  };
  const narrow = async (kind, selected, parameter) => {
    for (const language of ['zh-CN', 'en', 'ja']) {
      await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
      await evaluate(`document.querySelector('${control('Use')}').scrollIntoView({block:'center'})`);
      const layout = await evaluate(`(()=>{const d=document.querySelector('#sceneBehaviorsDialog'),p=document.querySelector('#sceneBehaviorsReferencesTools');return {noOverflow:d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1,panelVisible:!p.hidden,kind:document.querySelector('${control('Kind')}').value,choice:document.querySelector('${control('Choice')}').value,parameter:document.querySelector('${control('Parameter')}').selectedOptions[0]?.textContent,useEnabled:!document.querySelector('${control('Use')}').disabled};})()`);
      assert.ok(layout.noOverflow && layout.panelVisible && layout.useEnabled, JSON.stringify(layout)); assert.equal(layout.kind, kind); assert.equal(layout.choice, selected); assert.ok(layout.parameter.includes(parameter));
      report.layout[kind + '-' + language] = layout; await screenshot(kind + '-' + language + '-390.png');
    }
    await call('Emulation.clearDeviceMetricsOverride');
  };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,state:window.__referenceState,referenceStatus:document.querySelector('${control('Status')}')?.textContent})`); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const original=window.fetch;window.__referenceReads=0;window.fetch=async(input,init)=>{if(String(input)==='/api/scene-behavior-reference-directory'){window.__referenceReads++;const response=await original(input,init);if(window.__holdReference){window.__holdReference=false;await new Promise(resolve=>window.__releaseReference=resolve);}return response;}return original(input,init);};})()` });
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
  const narrowForm = async (name, selector, verify) => {
    for (const language of ['zh-CN', 'en', 'ja']) {
      await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      const layout = await evaluate(`(()=>{const d=document.querySelector('#sceneBehaviorsDialog');return {noOverflow:d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1,title:d.querySelector('h2').textContent,parameterNames:Array.from(document.querySelectorAll('#sceneBehaviorsParameters input[id$="Name"]'),row=>row.value)};})()`);
      assert.equal(layout.noOverflow, true, JSON.stringify(layout)); await verify?.(); report.layout[name + '-' + language] = layout; await screenshot(name + '-' + language + '-390.png');
    }
    await call('Emulation.clearDeviceMetricsOverride');
  };

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

  await openBuild(retryScene.id); await enabled('#projectBuildCreateBehavior'); await click('#projectBuildCreateBehavior'); await enabled('#sceneBehaviorCreateCheck');
  await fill('#sceneBehaviorCreateType', 'document', 'change'); await fill('#sceneBehaviorCreatePath', 'documents/behaviors/retry.json'); await fill('#sceneBehaviorCreateSource', scriptRecord.id, 'change');
  const beforeBehavior = await authorTree(author); await click('#sceneBehaviorCreateCheck'); await enabled('#sceneBehaviorCreateSave'); assert.deepEqual(await authorTree(author), beforeBehavior);
  const createdPreview = JSON.parse(await evaluate(`document.querySelector('#sceneBehaviorCreateSourceText').textContent`)); assert.deepEqual(createdPreview.bindings[0].parameters, {});
  await click('#sceneBehaviorCreateSave'); await enabled('#sceneBehaviorCreateOpen'); behaviorRecord = await record('documents/behaviors/retry.json');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(author, behaviorRecord.sourcePath), 'utf8')).bindings[0].parameters, {}); await stage('UI first behavior creation with empty parameters');
  await click('#sceneBehaviorCreateOpen'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorCreateDialog').open`), 'new behavior source opened');
  if (await evaluate(`document.querySelector('#projectBuildDialog').open`)) await closeBuild(); await openDocument(behaviorRecord); await open();
  await enabled('#sceneBehaviorsAddMissingParameters'); assert.equal(await evaluate(`document.querySelectorAll('#sceneBehaviorsParameters input[id$="Name"]').length`), 0);
  const beforeHints = await authorTree(author); await narrowForm('missing-parameters', '#sceneBehaviorsAddMissingParameters'); await click('#sceneBehaviorsAddMissingParameters');
  const expectedDefaults = { action_name: 'ui_accept', target_scene_id: '', state_values_json: '{"score":0,"health":100}' };
  const parameters = async () => evaluate(`Object.fromEntries(Array.from(document.querySelectorAll('#sceneBehaviorsParameters input[id$="Name"]')).map((row,index)=>[row.value,document.querySelector('#sceneBehaviorsParam'+index+'Value').value]))`);
  assert.deepEqual(await parameters(), expectedDefaults); assert.deepEqual(await authorTree(author), beforeHints); await close(); assert.deepEqual(await authorTree(author), beforeHints);
  await open(); assert.equal(await evaluate(`document.querySelectorAll('#sceneBehaviorsParameters input[id$="Name"]').length`), 0); await close();
  report.steps.push('Create the exact official retry TXT and first behavior through Studio. Its saved parameters start empty. Explicit Add missing supplies exactly three String defaults; preview and Cancel leave every saved author byte unchanged.');

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

  await openDocument(behaviorRecord); await open(); await enabled('#sceneBehaviorsAddMissingParameters'); await click('#sceneBehaviorsAddMissingParameters'); assert.deepEqual(await parameters(), expectedDefaults);
  await narrowForm('default-parameters', '#sceneBehaviorsParameters', async () => assert.deepEqual(await parameters(), expectedDefaults));
  await load(); assert.equal(await value(control('Assembly')), ''); await chooseAssembly(); await choose('scene', levelScene.id, 'target_scene_id');
  await narrow('scene', levelScene.id, 'target_scene_id'); assert.equal(await value(await rowValueSelector('target_scene_id')), ''); await use('target_scene_id', levelScene.id);
  await choose('action', 'start_retry', 'action_name'); await use('action_name', 'start_retry'); await fill(await rowValueSelector('state_values_json'), '{"score":0,"health":3}');
  assert.deepEqual(await parameters(), { action_name: 'start_retry', target_scene_id: levelScene.id, state_values_json: '{"score":0,"health":3}' });
  const beforeFinalSave = await authorTree(author); await check(); const candidate = await evaluate(`document.querySelector('#sceneBehaviorsAfter').textContent`); await screenshot('retry-parameters-reviewed-desktop.png');
  await click('#sceneBehaviorsApply'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`), 'parameter draft applied'); assert.deepEqual(await authorTree(author), beforeFinalSave);
  await saveOrdinary(behaviorRecord.sourcePath); assert.equal(await fs.readFile(path.join(author, behaviorRecord.sourcePath), 'utf8'), candidate);
  const saved = await authorTree(author); assert.deepEqual(saved, { ...beforeFinalSave, [behaviorRecord.sourcePath]: hash(candidate) }); await stage('UI parameter review apply and ordinary Save');
  await call('Page.reload'); await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'Studio reopen'); await evaluate(`window.__referenceState=(await import('/web/modules/app-state.js')).appState`);
  await openDocument(behaviorRecord); await open(); assert.deepEqual(await parameters(), { action_name: 'start_retry', target_scene_id: levelScene.id, state_values_json: '{"score":0,"health":3}' }); assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsAddMissingParameters').disabled`), true); await screenshot('saved-parameters-reopened-desktop.png'); await close();
  assert.deepEqual(await authorTree(author), saved); assert.equal(await fs.readFile(path.join(author, scriptPath), 'utf8'), GODOT_ACTION_SCENE_RETRY_SCRIPT);
  const finalRegistry = await readRegistry(author); assert.equal(finalRegistry.documents.length, 8); assert.equal(finalRegistry.assets.length, 0);
  const captured = await captureBuildSnapshot(author, assembly.id); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics)); assert.equal(captured.plan.scenes.length, 2); assert.equal(captured.plan.entrySceneId, retryScene.id);
  const plannedRetry = captured.plan.scenes.find(row => row.scene.objectId === retryScene.id); assert.deepEqual(plannedRetry.behaviors.bindings[0].parameters, { action_name: 'start_retry', target_scene_id: levelScene.id, state_values_json: '{"score":0,"health":3}' });
  const finalDirectory = path.join(output, 'author-final'); await fs.mkdir(finalDirectory);
  for (const name of Object.keys(saved)) { if (name !== 'workspace.json' && !/^(documents|templates|metadata|assets)\//.test(name)) continue; const file = path.join(finalDirectory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.copyFile(path.join(author, name), file); }
  assert.deepEqual(await authorTree(finalDirectory), saved, 'retained final author workspace must match saved UI bytes');
  report.authorFinal = { path: finalDirectory, hashes: saved, registryDocumentCount: finalRegistry.documents.length, registryAssetCount: finalRegistry.assets.length };
  report.identities = { definition: definition.id, retryScene: retryScene.id, levelScene: levelScene.id, script: scriptRecord.id, behavior: behaviorRecord.id, inputMap: mapRecord.id, assembly: assembly.id, hud: hudRecord.id };
  report.plan = { ok: captured.ok, snapshotId: captured.snapshotId, entrySceneId: captured.plan.entrySceneId, sceneIds: captured.plan.scenes.map(row => row.scene.objectId), retryParameters: plannedRetry.behaviors.bindings[0].parameters };
  report.steps.push('Explicitly Add missing again, select saved Level and start_retry by name, manually change the initializer to health3, then Check/Apply/ordinary Save/reopen. Only the behavior source changes in this final phase; the official TXT stays exact. The retained eight-document author workspace captures a valid two-scene plan for independent native verification.');
  report.sampleAfter = await authorTree(source); assert.deepEqual(report.sampleAfter, report.sampleBefore); report.sourcesAfter = await sourceHashes(); assert.deepEqual(report.sourcesAfter, report.sourcesBefore); assert.equal(hash(await fs.readFile(fileURLToPath(import.meta.url))), report.driverSha256); assert.deepEqual(report.errors, []); report.ok = true;
} catch (error) { report.ok = false; report.failure = error.stack; process.exitCode = 1; console.error(error); try { await captureFailure?.(); } catch (failure) { report.captureFailure = failure.message; } }
finally {
  socket?.close(); for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ ok: report.ok, output, screenshots: report.screenshots.length, steps: report.steps, failure: report.failure }, null, 2));
}
