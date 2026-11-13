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
import { GODOT_PROJECT_MENU_SCRIPT } from '../../engine/godot-project-menu-script.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const source = path.resolve(process.env.VIENTO_MENU_TARGETS_SAMPLE_SOURCE || path.join(appRoot, 'examples/topdown-collect'));
const output = path.resolve(process.env.VIENTO_MENU_TARGETS_OUTPUT || '/tmp/viento-menu-targets-browser');
if (!output.startsWith('/tmp/')) throw Error('This browser smoke writes evidence only beneath /tmp.');
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceNames = ['engine/project-menu-item-edit.mjs','engine/project-menu.mjs','engine/godot-project-menu-script.mjs','engine/godot-project-menu-parameters.mjs','engine/script-authoring.mjs','engine/script-parameter-interface.mjs','engine/script-parameter-discovery.mjs','engine/scene-behaviors.mjs','engine/scene-behaviors-edit.mjs','engine/json-source.mjs','web/modules/app-scene-behavior-menu-targets.js','web/modules/app-scene-behaviors.js','web/modules/app-scene-behavior-parameters.js','web/modules/app-scene-behavior-references.js','web/modules/app-script-create.js','web/modules/app-scene-behavior-create.js','web/modules/app-project-build.js','web/modules/app-project-assembly.js','web/modules/app-scene-create.js','web/modules/app-runtime.js','web/modules/app-state.js','web/modules/app-doc-service.js','scripts/lib/scene-behavior-reference-directory-service.mjs','scripts/lib/doc-api-service.mjs','scripts/lib/doc-server-routes.mjs','web/scene-behaviors.css','web/scene-behavior-menu-targets.css','web/i18n/en.js','web/i18n/ja.js'];
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
  'Every definition, three scenes, ordinary official menu and signal TXT sources, behavior bindings and assembly are created through actual Studio controls; no prepared scene/gameplay metadata is injected.',
  'Default rows and named choices remain ordinary scalar parameters. Reading and selecting do not save; Add missing and Insert are explicit, followed by ordinary Check/Apply/Save.',
  'This three-scene authoring slice is not a complete game-from-blank, installed-app or device claim; actual mouse/keyboard and offline ZIP are separately verified against the retained author-final bytes.'
] };
const wait = async (check, label, budget = 45000) => { for (const end = Date.now() + budget; Date.now() < end;) { if (await check()) return; await delay(80); } throw Error('Timed out: ' + label); };
let socket, captureFailure, confirmAccept = true;
try {
  report.sourcesBefore = await sourceHashes(); report.driverSha256 = hash(await fs.readFile(fileURLToPath(import.meta.url)));
  report.sampleBefore = await authorTree(source); report.node = { version: process.version, sha256: hash(await fs.readFile(process.execPath)) };
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-menu-targets-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const author = path.join(temporary, 'author'); await fs.mkdir(author);
  const blank = PROJECT_TEMPLATE_CATALOG.templates.find(row => row.packageId === 'org.viento.blank'); assert.ok(blank);
  const workspace = { format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Menu target authoring trial', createdAt: 0,
    ...structuredClone(WORKSPACE_LAYOUT), documentTypes: structuredClone(blank.documentTypes) };
  await fs.writeFile(path.join(author, 'workspace.json'), JSON.stringify(workspace, null, 2) + '\n');
  for (const folder of ['documents', 'assets', 'templates', 'metadata/documents', 'metadata/assets']) await fs.mkdir(path.join(author, folder), { recursive: true });
  for (const [name, text] of Object.entries(blank.templates)) await fs.writeFile(path.join(author, 'templates', name), text);
  await registerWorkspace(author);
  const emptyRegistry = await readRegistry(author); assert.deepEqual(emptyRegistry.documents, []); assert.deepEqual(emptyRegistry.assets, []);
  report.initialization = { kind: 'harness-initialized-official-blank-template', templateId: blank.packageId, templateVersion: blank.version,
    authoredDocuments: 0, registeredDocuments: 0, assets: 0, documentTypes: workspace.documentTypes.map(row => row.id) };
  let definition, startScene, gameScene, resultScene, scriptRecord, auxiliaryRecord, assembly;
  const behaviors = {};
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

  function bindingBytes(content) {
    const parsed=parseJsonSource(content);assert.equal(parsed.ok,true);
    return Object.fromEntries(parsed.value.bindings.map((binding,index)=>{const loc=locateJsonSource(parsed,'/bindings/'+index);assert.equal(loc.exact,true);return[binding.bindingId,content.slice(loc.start,loc.end)];}));
  }
  await wait(()=>evaluate("window.__referenceState.workspace?.name === 'Menu target authoring trial'"),'correct empty workspace loaded');
  await enabled('#docCreateBtn');await click('#docCreateBtn');await wait(()=>evaluate("window.__referenceState.isCreating&&!window.__referenceState.isLoadingTemplate"),'first ordinary definition');
  await fill('#docCreatePathInput','documents/definition.md');await fill('#docSourceEditor','# Menu actor\n\nA single generic definition, authored from blank.\n');await saveOrdinary('documents/definition.md');definition=await record('documents/definition.md');await stage('ordinary definition saved');
  await openBuild();
  async function createScene(title,sourcePath,background) {
    await enabled('#projectBuildCreateScene');await click('#projectBuildCreateScene');await enabled('#sceneCreateCheck');
    await fill('#sceneCreateName',title);await fill('#sceneCreatePath',sourcePath);await fill('#sceneCreateType','document','change');await fill('#sceneCreateBackground',background);
    await fill('#sceneActor0Object',definition.id,'change');await fill('#sceneActor0Controls','none','change');await fill('#sceneActor0Speed','0');
    const before=await authorTree(author);await click('#sceneCreateCheck');await enabled('#sceneCreateSave');assert.deepEqual(await authorTree(author),before);
    await click('#sceneCreateSave');await wait(async()=>{try{return(await fs.readFile(path.join(author,sourcePath),'utf8')).includes(title);}catch{return false;}},'saved scene '+title);
    await enabled('#sceneCreateClose');await click('#sceneCreateClose');await wait(()=>evaluate("!document.querySelector('#sceneCreateDialog').open"),'scene creator closed');
    const saved=await record(sourcePath);await stage('scene '+title+' saved');return saved;
  }
  startScene=await createScene('Start · 开始 · 開始','documents/scenes/start.json','#173047');
  gameScene=await createScene('Game · 关卡 · ゲーム','documents/scenes/game.json','#173e28');
  resultScene=await createScene('Result · 结果 · 結果','documents/scenes/result.json','#472d17');await closeBuild();
  async function createScript(starter,sourcePath,expected) {
    const before=await authorTree(author);await enabled('#scriptCreateBtn');await click('#scriptCreateBtn');await enabled('#scriptCreateApply');
    await fill('#scriptCreateStarter',starter,'change');await fill('#scriptCreateType','document','change');await fill('#scriptCreatePath',sourcePath);await enabled('#scriptCreateApply');
    assert.equal(await evaluate("document.querySelector('#scriptCreateSource').textContent"),expected);
    await click('#scriptCreateApply');await wait(()=>evaluate("!document.querySelector('#scriptCreateDialog').open&&window.__referenceState.isCreating"),'ordinary script draft');
    assert.deepEqual(await authorTree(author),before);await saveOrdinary(sourcePath);assert.equal(await fs.readFile(path.join(author,sourcePath),'utf8'),expected);
    await stage('ordinary '+starter+' script saved');return record(sourcePath);
  }
  scriptRecord=await createScript('godot-project-menu','documents/scripts/menu.txt',GODOT_PROJECT_MENU_SCRIPT);
  auxiliaryRecord=await createScript('godot-signal','documents/scripts/sentinel.txt',listScriptStarters().find(row=>row.id==='godot-signal').content);
  await openBuild(startScene.id);await enabled('#projectBuildAssembly');await click('#projectBuildAssembly');await enabled('#projectAssemblyNew');await click('#projectAssemblyNew');await enabled('#projectAssemblyCheck');
  await fill('#projectAssemblyName','Menu targets trial');await fill('#projectAssemblyPath','documents/projects/trial.json');await fill('#projectAssemblyType','document','change');
  for(const member of[startScene,gameScene,resultScene]){await fill('#projectAssemblyCandidate',member.id,'change');await click('#projectAssemblyAdd');}
  await fill('#projectAssemblyEntry',startScene.id,'change');const beforeAssembly=await authorTree(author);await click('#projectAssemblyCheck');await enabled('#projectAssemblySave');assert.deepEqual(await authorTree(author),beforeAssembly);
  await click('#projectAssemblySave');await wait(async()=>{try{return(await readRegistry(author)).documents.some(row=>row.sourcePath==='documents/projects/trial.json');}catch{return false;}},'assembly saved');
  assembly=await record('documents/projects/trial.json');await enabled('#projectAssemblyCancel');await click('#projectAssemblyCancel');await wait(()=>evaluate("!document.querySelector('#projectAssemblyDialog').open"),'assembly creator closed');await stage('three-member assembly saved');
  async function createBehavior(name,scene,sentinel=false) {
    await openBuild(scene.id);await enabled('#projectBuildCreateBehavior');await click('#projectBuildCreateBehavior');await enabled('#sceneBehaviorCreateCheck');
    const sourcePath='documents/behaviors/'+name+'.json';await fill('#sceneBehaviorCreateType','document','change');await fill('#sceneBehaviorCreatePath',sourcePath);await fill('#sceneBehaviorCreateSource',scriptRecord.id,'change');
    if(sentinel){await click('#sceneBehaviorCreateAddBinding');await fill('#sceneBehaviorCreateSource',auxiliaryRecord.id,'change');}
    const before=await authorTree(author);await click('#sceneBehaviorCreateCheck');await enabled('#sceneBehaviorCreateSave');assert.deepEqual(await authorTree(author),before);
    await click('#sceneBehaviorCreateSave');await enabled('#sceneBehaviorCreateOpen');const saved=await record(sourcePath);
    await click('#sceneBehaviorCreateOpen');await wait(()=>evaluate("!document.querySelector('#sceneBehaviorCreateDialog').open"),'behavior source navigation');
    if(await evaluate("document.querySelector('#projectBuildDialog').open"))await closeBuild();
    await openDocument(saved);const content=await fs.readFile(path.join(author,sourcePath),'utf8'),model=JSON.parse(content),binding=model.bindings.find(row=>row.implementation.sourceObjectId===scriptRecord.id);
    assert.deepEqual(binding.parameters,{});await stage('empty-parameter behavior '+name+' saved');return {record:saved,content,model,bindingId:binding.bindingId};
  }
  behaviors.start=await createBehavior('start',startScene,true);behaviors.game=await createBehavior('game',gameScene);behaviors.result=await createBehavior('result',resultScene);
  const menuPrefix='#sceneBehaviorsMenuTargets',menuControl=suffix=>menuPrefix+suffix;
  const parameters=()=>evaluate("Object.fromEntries(Array.from(document.querySelectorAll('#sceneBehaviorsParameters input[id$=\"Name\"]')).map((row,index)=>[row.value,document.querySelector('#sceneBehaviorsParam'+index+'Value').value]))");
  async function menuLoad() {
    await enabled(menuControl('Load'));await click(menuControl('Load'));await enabled(menuControl('Assembly'));
    assert.equal(await value(menuControl('Assembly')),'','assembly requires explicit selection');
    await fill(menuControl('Assembly'),assembly.id,'change');await enabled(menuControl('Target'));
  }
  async function append(id,label,command,target) {
    if(await value(menuControl('Assembly'))!==assembly.id)await menuLoad();
    await fill(menuControl('NewId'),id);await fill(menuControl('NewLabel'),label);await fill(menuControl('Command'),command,'change');await fill(menuControl('Target'),target,'change');await enabled(menuControl('Append'));await click(menuControl('Append'));
    await wait(async()=>JSON.parse((await parameters()).items_json).some(row=>row.id===id),'menu item appended '+id);
    return (await parameters()).items_json;
  }
  async function begin(name) {
    await openDocument(behaviors[name].record);await open();await fill('#sceneBehaviorsBinding',behaviors[name].bindingId,'change');
    await enabled('#sceneBehaviorsAddMissingParameters');await click('#sceneBehaviorsAddMissingParameters');
    assert.deepEqual(await parameters(),{title:'Menu',items_json:'[{"id":"finish","label":"Exit","command":"finish"}]',display_mode:'scene'});
    await menuLoad();
  }
  async function saveMenu(name) {
    const saved=behaviors[name],before=await authorTree(author);await check();const candidate=await evaluate("document.querySelector('#sceneBehaviorsAfter').textContent");
    const bytes=bindingBytes(candidate),original=bindingBytes(saved.content);
    for(const[id,raw]of Object.entries(original))if(id!==saved.bindingId)assert.equal(bytes[id],raw,'unrelated binding exact source '+id);
    await click('#sceneBehaviorsApply');await wait(()=>evaluate("!document.querySelector('#sceneBehaviorsDialog').open"),'menu applied to ordinary draft');
    assert.deepEqual(await authorTree(author),before);await saveOrdinary(saved.record.sourcePath);assert.equal(await fs.readFile(path.join(author,saved.record.sourcePath),'utf8'),candidate);
    assert.deepEqual(await authorTree(author),{...before,[saved.record.sourcePath]:hash(candidate)});
    saved.finalContent=candidate;saved.parameters=JSON.parse(candidate).bindings.find(row=>row.bindingId===saved.bindingId).parameters;await stage('ordinary '+name+' menu save');return saved.parameters;
  }
  for(const name of['game','result']){await begin(name);await append('back','Back · 返回 · 戻る','scene',startScene.id);await saveMenu(name);}
  const beforeCancel=await authorTree(author);await begin('start');await append('cancelled','Cancelled local button','scene',gameScene.id);await close();assert.deepEqual(await authorTree(author),beforeCancel);
  await begin('start');await append('go','See result · 查看结果 · 結果へ','scene',gameScene.id);
  const beforeRetarget=(await parameters()).items_json,parsed=parseJsonSource(beforeRetarget),loc=locateJsonSource(parsed,'/1/targetSceneId');assert.equal(loc.exact,true);
  await menuLoad();await fill(menuControl('Item'),'go','change');await fill(menuControl('Target'),resultScene.id,'change');await enabled(menuControl('Use'));await click(menuControl('Use'));
  await wait(async()=>JSON.parse((await parameters()).items_json).find(row=>row.id==='go')?.targetSceneId===resultScene.id,'existing button retargeted');
  const retargeted=(await parameters()).items_json;assert.equal(retargeted,beforeRetarget.slice(0,loc.start)+JSON.stringify(resultScene.id)+beforeRetarget.slice(loc.end));
  const finalItems=await append('retry','Retry game · 重试关卡 · ゲーム再試行','retry',gameScene.id);assert.deepEqual(JSON.parse(finalItems),[{id:'finish',label:'Exit',command:'finish'},{id:'go',label:'See result · 查看结果 · 結果へ',command:'scene',targetSceneId:resultScene.id},{id:'retry',label:'Retry game · 重试关卡 · ゲーム再試行',command:'retry',targetSceneId:gameScene.id,values:{}}]);
  await menuLoad();
  for(const language of['zh-CN','en','ja']){
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await evaluate("(await import('/web/i18n/index.js')).applyLanguage("+JSON.stringify(language)+")");
    await evaluate("document.querySelector('#sceneBehaviorsMenuTargetsTools').scrollIntoView({block:'center'})");
    const layout=await evaluate("(()=>{const d=document.querySelector('#sceneBehaviorsDialog');return{noOverflow:d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1,assembly:document.querySelector('#sceneBehaviorsMenuTargetsAssembly').value,target:document.querySelector('#sceneBehaviorsMenuTargetsTarget').value,buttons:Array.from(document.querySelector('#sceneBehaviorsMenuTargetsItem').options,row=>row.textContent)};})()");
    assert.equal(layout.noOverflow,true);assert.equal(layout.assembly,assembly.id);assert.equal((await parameters()).items_json,finalItems);report.layout[language]=layout;await screenshot('menu-targets-'+language+'-390.png');
  }
  await call('Emulation.clearDeviceMetricsOverride');await saveMenu('start');
  const finalSaved=await authorTree(author);await call('Page.navigate',{url:base+'/web/?mode=edit&menu-reopened=1'});await wait(()=>evaluate("location.search.includes('menu-reopened=1')&&document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.workspace?.name==='Menu target authoring trial'"),'saved workspace reopened');
  await evaluate("window.__referenceState=(await import('/web/modules/app-state.js')).appState");
  for(const name of['start','game','result']){
    await openDocument(behaviors[name].record);await open();await fill('#sceneBehaviorsBinding',behaviors[name].bindingId,'change');assert.deepEqual(await parameters(),behaviors[name].parameters);await close();
    assert.equal(await fs.readFile(path.join(author,behaviors[name].record.sourcePath),'utf8'),behaviors[name].finalContent);
  }
  assert.deepEqual(await authorTree(author),finalSaved);assert.equal(await fs.readFile(path.join(author,scriptRecord.sourcePath),'utf8'),GODOT_PROJECT_MENU_SCRIPT);
  const captured=await captureBuildSnapshot(author,assembly.id);assert.equal(captured.ok,true,JSON.stringify(captured.diagnostics));assert.equal(captured.plan.scenes.length,3);
  const finalDirectory=path.join(output,'author-final');await fs.mkdir(finalDirectory);
  for(const name of Object.keys(finalSaved)){const target=path.join(finalDirectory,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(author,name),target);}
  assert.deepEqual(await authorTree(finalDirectory),finalSaved);
  report.identities={definition:definition.id,startScene:startScene.id,gameScene:gameScene.id,resultScene:resultScene.id,menuScript:scriptRecord.id,sentinelScript:auxiliaryRecord.id,assembly:assembly.id};
  report.plan={ok:true,snapshotId:captured.snapshotId,assemblyId:assembly.id,title:'Menu targets trial',sceneCount:3};
  report.menu={itemsJson:finalItems,beforeRetarget,retargeted,parameters:behaviors.start.parameters,sentinelBindingPreserved:true,cancelPreserved:true,reopened:true};
  report.authorFinal={path:finalDirectory,hashes:finalSaved,registeredDocuments:(await readRegistry(author)).documents.length,registeredAssets:0};
  report.steps.push('Blank author structure → generic definition, Start/Game/Result, official menu and sentinel TXT, first behaviors and assembly through Studio controls. Explicit assembly/member selection adds scene/retry menu items and replaces only the existing target token; retry values:{}.');
  report.steps.push('Cancel and preview/apply do not write files. Ordinary saves affect only selected behavior text. Unrelated binding bytes, official source and other author data remain exact. Three-language 390px controls and reload preserve exact items_json.');
  report.sampleAfter=await authorTree(source);assert.deepEqual(report.sampleAfter,report.sampleBefore);report.sourcesAfter=await sourceHashes();assert.deepEqual(report.sourcesAfter,report.sourcesBefore);assert.equal(hash(await fs.readFile(fileURLToPath(import.meta.url))),report.driverSha256);assert.deepEqual(report.errors,[]);report.ok=true;
} catch(error) {report.ok=false;report.failure=error.stack;process.exitCode=1;console.error(error);try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally {
  socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}
  report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,screenshots:report.screenshots.length,failure:report.failure},null,2));
}
