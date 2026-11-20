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
import { listScriptStarters } from '../../engine/script-authoring.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const source = path.resolve(process.env.VIENTO_CREATE_AUDIO_SAMPLE_SOURCE || path.join(appRoot, 'examples/topdown-collect'));
const output = path.resolve(process.env.VIENTO_CREATE_AUDIO_OUTPUT || `/tmp/viento-create-audio-browser-${Date.now()}`);
if (!output.startsWith('/tmp/')) throw Error('This browser smoke writes evidence only beneath /tmp.');
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceNames = ['engine/scene-behavior-create-audio.mjs', 'web/modules/app-scene-behavior-create-audio.js', 'engine/scene-audio-directory.mjs', 'scripts/lib/scene-audio-directory-service.mjs', 'web/modules/app-scene-audio-create.js', 'web/modules/app-media-editor.js', 'engine/godot-project-event-audio-script.mjs', 'engine/script-authoring.mjs', 'engine/scene-behavior-create-references.mjs', 'web/modules/app-scene-behavior-create-references.js', 'web/modules/app-project-build.js', 'engine/scene-behavior-create-parameters.mjs', 'engine/scene-behavior-create-plan.mjs', 'engine/world-behavior-create.mjs', 'web/modules/app-scene-behavior-create.js', 'web/modules/app-scene-behavior-create-parameters.js', 'scripts/lib/scene-behavior-creation-service.mjs', 'web/scene-behavior-create.css', 'engine/scene-behavior-reference-directory.mjs', 'scripts/lib/scene-behavior-reference-directory-service.mjs',
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
  'Seven documents (definition, one scene, two official TXT scripts, audio, assembly and first behavior) and one synthesized PCM16 WAV are created or imported through actual Studio controls; no prepared game source, scene UUID or author registration is injected.',
  'First-creation audio choices come only from the real saved scene audio directory. Load/selection never changes JSON; explicit Use fresh-checks and inserts one existing String token. The selected track is the second declaration, not the resource UUID. No playback is performed by this helper.',
  'The retained author-final workspace and frozen plan enable a separate actual Godot checkpoint/audio-command check. This browser report does not claim native playback, audible output or independent distribution.'
] };
const wait = async (check, label, budget = 45000) => { for (const end = Date.now() + budget; Date.now() < end;) { if (await check()) return; await delay(80); } throw Error('Timed out: ' + label); };
let socket, captureFailure, confirmAccept = true;
try {
  report.sourcesBefore = await sourceHashes(); report.driverSha256 = hash(await fs.readFile(fileURLToPath(import.meta.url)));
  report.sampleBefore = await authorTree(source); report.node = { version: process.version, sha256: hash(await fs.readFile(process.execPath)) };
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-create-audio-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const author = path.join(temporary, 'author'); await fs.mkdir(author);
  const blank = PROJECT_TEMPLATE_CATALOG.templates.find(row => row.packageId === 'org.viento.blank'); assert.ok(blank);
  const workspace = { format: 'viento-workspace', version: 3, id: randomUUID(), name: 'First creation audio reference UI trial', createdAt: 0,
    ...structuredClone(WORKSPACE_LAYOUT), documentTypes: structuredClone(blank.documentTypes) };
  await fs.writeFile(path.join(author, 'workspace.json'), JSON.stringify(workspace, null, 2) + '\n');
  for (const folder of ['documents', 'assets', 'templates', 'metadata/documents', 'metadata/assets']) await fs.mkdir(path.join(author, folder), { recursive: true });
  for (const [name, text] of Object.entries(blank.templates)) await fs.writeFile(path.join(author, 'templates', name), text);
  await registerWorkspace(author);
  const emptyRegistry = await readRegistry(author); assert.deepEqual(emptyRegistry.documents, []); assert.deepEqual(emptyRegistry.assets, []);
  report.initialization = { kind: 'harness-initialized-official-blank-template', templateId: blank.packageId, templateVersion: blank.version,
    authoredDocuments: 0, registeredDocuments: 0, assets: 0, documentTypes: workspace.documentTypes.map(row => row.id) };
  let definition, scene, eventAudioScript, publisherScript, audioRecord, behaviorRecord, assembly, resource;
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
  const requests = new Map(); let sequence = 0, holdNextAudioRequest = false, heldAudioRequest = null;
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; requests.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.id) { const request = requests.get(value.id); requests.delete(value.id); value.error ? request?.reject(Error(value.error.message)) : request?.resolve(value.result); }
    else if (value.method === 'Fetch.requestPaused') {
      if (holdNextAudioRequest && value.params.request.url.includes('/api/scene-audio-directory')) { holdNextAudioRequest = false; heldAudioRequest = { requestId: value.params.requestId, url: value.params.request.url, method: value.params.request.method, body: JSON.parse(value.params.request.postData) }; }
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
    await enabled('#docEditSourceModeBtn'); await click('#docEditSourceModeBtn');
  };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,state:window.__referenceState,creationStatus:document.querySelector('#sceneBehaviorCreateStatus')?.textContent,parameterError:document.querySelector('#sceneBehaviorCreateParameterError')?.textContent,requests:window.__creationAudioRequests})`); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.addScriptToEvaluateOnNewDocument', { source: "(()=>{window.__creationAudioRequests=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=String(input),response=await original(input,init);if(url.includes('/api/scene-behavior-creation')||url.includes('/api/world/commands')||url.includes('/api/scene-audio-directory')){let body=null,result=null;try{body=JSON.parse(init?.body||'null')}catch{}try{result=await response.clone().json()}catch{}window.__creationAudioRequests.push({url,method:init?.method||'GET',body,status:response.status,result});}return response;};})()" });
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
  // The only initialized author data is the official blank workspace/template.
  await enabled('#docCreateBtn'); await click('#docCreateBtn'); await wait(() => evaluate(`window.__referenceState.isCreating&&!window.__referenceState.isLoadingTemplate`), 'blank ordinary document draft');
  await fill('#docCreatePathInput', 'documents/definition.md'); await fill('#docSourceEditor', '# Event audio display object\n\nOne authored object with two independent behavior bindings.\n');
  assert.deepEqual(await authorTree(author), initial); await saveOrdinary('documents/definition.md'); definition = await record('documents/definition.md'); await stage('UI ordinary definition Save');
  // The file chooser receives an actual local file; the app performs its usual
  // upload, registration, draft insertion and ordinary Save without API seeding.
  const wavPath = path.join(temporary, 'checkpoint-tone.wav'), samples = 8000, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / 8000) * 7000), 44 + i * 2);
  await fs.writeFile(wavPath, wav); await openDocument(definition); await enabled('#docMediaInsertBtn'); await click('#docMediaInsertBtn');
  await wait(() => evaluate(`document.querySelector('#docMediaDialog').open`), 'visible media import window');
  const dom = await call('DOM.getDocument'), fileInput = await call('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#docMediaFileInput' });
  await call('DOM.setFileInputFiles', { nodeId: fileInput.nodeId, files: [wavPath] });
  await wait(async () => (await readRegistry(author)).assets.length === 1 && await evaluate(`!document.querySelector('#docMediaDialog').open&&window.__referenceState.editHasUnsavedChanges`), 'real WAV imported and inserted into ordinary draft');
  resource = (await readRegistry(author)).assets[0]; assert.equal(resource.kind, 'audio'); assert.deepEqual(await fs.readFile(path.join(author, 'assets', resource.location.path)), wav);
  await saveOrdinary('documents/definition.md'); await stage('UI WAV import and ordinary definition Save');
  report.importedWav = { name: 'checkpoint-tone.wav', bytes: wav.length, sha256: hash(wav), resourceId: resource.id, sourcePath: 'assets/' + resource.location.path, sampleRate: 8000, frames: samples, channels: 1, bits: 16 };
  report.steps.push('Start with an official blank workspace and no documents, assets or registrations. Create a definition, import one real synthesized PCM16 WAV through the visible media window, and ordinarily save its inserted reference.');

  await openBuild(); await enabled('#projectBuildCreateScene'); await click('#projectBuildCreateScene'); await enabled('#sceneCreateCheck');
  await fill('#sceneCreateName', 'Checkpoint sound scene'); await fill('#sceneCreatePath', 'documents/scenes/checkpoint.json'); await fill('#sceneCreateType', 'document', 'change');
  await fill('#sceneCreateBackground', '#152f2a'); await fill('#sceneActor0Object', definition.id, 'change'); await fill('#sceneActor0Controls', 'none', 'change'); await fill('#sceneActor0Speed', '0');
  const beforeScene = await authorTree(author); await click('#sceneCreateCheck'); await enabled('#sceneCreateSave'); assert.deepEqual(await authorTree(author), beforeScene);
  const sceneDeclaration = JSON.parse(await evaluate(`document.querySelector('#sceneCreateSource').textContent`)); assert.equal(sceneDeclaration.actors.length, 1);
  await click('#sceneCreateSave'); await wait(async () => (await readRegistry(author)).documents.some(row => row.sourcePath === 'documents/scenes/checkpoint.json'), 'scene saved');
  await enabled('#sceneCreateClose'); await click('#sceneCreateClose'); await wait(() => evaluate(`!document.querySelector('#sceneCreateDialog').open`), 'scene create closed'); scene = await record('documents/scenes/checkpoint.json'); await closeBuild(); await stage('UI single Scene2D creation');
  const createScript = async (starterId, sourcePath) => {
    const starter = listScriptStarters().find(row => row.id === starterId); assert.ok(starter);
    await enabled('#scriptCreateBtn'); await click('#scriptCreateBtn'); await enabled('#scriptCreateApply'); await fill('#scriptCreateStarter', starterId, 'change'); await fill('#scriptCreateType', 'document', 'change'); await fill('#scriptCreatePath', sourcePath);
    assert.equal(await evaluate(`document.querySelector('#scriptCreateSource').textContent`), starter.content); const before = await authorTree(author);
    await click('#scriptCreateApply'); await wait(() => evaluate(`!document.querySelector('#scriptCreateDialog').open&&window.__referenceState.isCreating`), 'official script ordinary draft'); assert.deepEqual(await authorTree(author), before);
    await saveOrdinary(sourcePath); assert.equal(await fs.readFile(path.join(author, sourcePath), 'utf8'), starter.content); await stage('UI official TXT ' + starterId); return record(sourcePath);
  };
  eventAudioScript = await createScript('godot-project-event-audio', 'documents/scripts/event-audio.txt');
  publisherScript = await createScript('godot-project-events', 'documents/scripts/checkpoint.txt');

  await openBuild(scene.id); await enabled('#projectBuildSceneAudio'); await click('#projectBuildSceneAudio'); await enabled('#sceneAudioCreateVolume');
  await fill('#sceneAudioCreateType', 'document', 'change'); await fill('#sceneAudioCreatePath', 'documents/audio/checkpoint.json'); await fill('#sceneAudioCreateResource', resource.id, 'change');
  await fill('#sceneAudioCreateRole', 'effect', 'change'); await fill('#sceneAudioCreateVolume', '0.25'); await fill('#sceneAudioCreateLoop', 'false', 'change'); await fill('#sceneAudioCreateStartMode', 'behavior', 'change');
  await click('#sceneAudioCreateAddTrack'); await fill('#sceneAudioCreateResource', resource.id, 'change'); await fill('#sceneAudioCreateRole', 'music', 'change'); await fill('#sceneAudioCreateVolume', '0.15'); await fill('#sceneAudioCreateLoop', 'true', 'change'); await fill('#sceneAudioCreateStartMode', 'behavior', 'change');
  const beforeAudio = await authorTree(author); await click('#sceneAudioCreateCheck'); await enabled('#sceneAudioCreateSave'); assert.deepEqual(await authorTree(author), beforeAudio);
  const audioText = await evaluate(`document.querySelector('#sceneAudioCreateSourceText').textContent`), audio = JSON.parse(audioText);
  assert.deepEqual(audio.tracks.map(row => [row.resourceId, row.role, row.volume, row.loop]), [[resource.id, 'effect', .25, false], [resource.id, 'music', .15, true]]); assert.deepEqual(audio.cues, []);
  await click('#sceneAudioCreateSave'); await enabled('#sceneAudioCreateOpen'); audioRecord = await record('documents/audio/checkpoint.json'); assert.equal(await fs.readFile(path.join(author, audioRecord.sourcePath), 'utf8'), audioText);
  await screenshot('two-declared-behavior-tracks-desktop.png'); await click('#sceneAudioCreateClose'); await wait(() => evaluate(`!document.querySelector('#sceneAudioCreateDialog').open`), 'audio creation closed'); await stage('UI two behavior-triggered tracks sharing one WAV');
  await enabled('#projectBuildAssembly'); await click('#projectBuildAssembly'); await enabled('#projectAssemblyNew'); await click('#projectAssemblyNew'); await enabled('#projectAssemblyCheck');
  await fill('#projectAssemblyName', 'Checkpoint audio trial'); await fill('#projectAssemblyPath', 'documents/projects/checkpoint.json'); await fill('#projectAssemblyType', 'document', 'change'); await fill('#projectAssemblyCandidate', scene.id, 'change'); await click('#projectAssemblyAdd'); await fill('#projectAssemblyEntry', scene.id, 'change');
  const beforeAssembly = await authorTree(author); await click('#projectAssemblyCheck'); await enabled('#projectAssemblySave'); assert.deepEqual(await authorTree(author), beforeAssembly); await click('#projectAssemblySave'); await wait(async () => (await readRegistry(author)).documents.some(row => row.sourcePath === 'documents/projects/checkpoint.json'), 'single member assembly saved'); assembly = await record('documents/projects/checkpoint.json');
  await enabled('#projectAssemblyCancel'); await click('#projectAssemblyCancel'); await wait(() => evaluate(`!document.querySelector('#projectAssemblyDialog').open`), 'assembly closed'); await closeBuild(); await stage('UI one-member assembly creation');
  report.steps.push('Create one Scene2D, unchanged official checkpoint publisher and event-audio TXT scripts, two independent behavior-triggered tracks sharing the imported WAV, and a one-member project assembly entirely through ordinary controls.');

  const behaviorPath = 'documents/behaviors/checkpoint.json', aud = suffix => '#sceneBehaviorCreateAudio' + suffix;
  const params = () => value('#sceneBehaviorCreateParameters'), currentBinding = () => value('#sceneBehaviorCreateBindingList');
  const chooseBinding = async id => { await fill('#sceneBehaviorCreateBindingList', id, 'change'); await enabled('#sceneBehaviorCreateParameters'); };
  const creatorIdle = () => wait(() => evaluate(`document.querySelector('#sceneBehaviorCreateDialog').getAttribute('aria-busy')==='false'`), 'creation request complete');
  const reviewCreation = async () => { await enabled('#sceneBehaviorCreateCheck'); await click('#sceneBehaviorCreateCheck'); await enabled('#sceneBehaviorCreateSave'); await creatorIdle(); };
  const reviewState = () => evaluate(`({hidden:document.querySelector('#sceneBehaviorCreateReview').hidden,content:document.querySelector('#sceneBehaviorCreateSourceText').textContent,saveDisabled:document.querySelector('#sceneBehaviorCreateSave').disabled})`);
  const assertRevoked = async () => { const state = await reviewState(); assert.equal(state.hidden, true); assert.equal(state.saveDisabled, true); };
  const openCreator = async () => { await openBuild(scene.id); await enabled('#projectBuildCreateBehavior'); await click('#projectBuildCreateBehavior'); await enabled('#sceneBehaviorCreateParameters'); await fill('#sceneBehaviorCreateType', 'document', 'change'); await fill('#sceneBehaviorCreatePath', behaviorPath); await fill('#sceneBehaviorCreateSource', eventAudioScript.id, 'change'); };
  const audioIdle = () => wait(() => evaluate(`document.querySelector('#sceneBehaviorCreateAudio')?.getAttribute('aria-busy')==='false'`), 'audio directory request complete');
  const audioRequestCount = () => evaluate(`window.__creationAudioRequests.filter(row=>row.url.includes('/api/scene-audio-directory')).length`);
  const loadAudio = async () => { const before = await params(), reviewed = await reviewState(), requests = await audioRequestCount(); await enabled(aud('Load')); await click(aud('Load')); await wait(async () => await audioRequestCount() > requests, 'actual scene audio directory response'); await audioIdle(); assert.equal(await evaluate(`document.querySelector(${JSON.stringify(aud('Status'))}).dataset.status`), 'ready'); assert.equal(await params(), before); assert.deepEqual(await reviewState(), reviewed); assert.equal(await value(aud('Track')), ''); return evaluate(`Array.from(document.querySelector(${JSON.stringify(aud('Track'))}).options,row=>({value:row.value,label:row.textContent}))`); };
  const chooseTrack = async (index = 1, parameter = 'track_id') => { const before = await params(), reviewed = await reviewState(), options = await evaluate(`Array.from(document.querySelector(${JSON.stringify(aud('Track'))}).options,row=>({value:row.value,label:row.textContent})).filter(row=>row.value)`); assert.equal(options.length, 2); assert.deepEqual(options.map(row => row.value), audio.tracks.map(row => row.id)); const selected = options[index]; await fill(aud('Track'), selected.value, 'change'); await fill(aud('Parameter'), parameter, 'change'); assert.equal(await params(), before); assert.deepEqual(await reviewState(), reviewed); await enabled(aud('Use')); return selected; };
  const useAudio = async () => { const before = await params(), reviewed = await reviewState(), requests = await audioRequestCount(); await enabled(aud('Use')); await click(aud('Use')); await wait(async () => await audioRequestCount() > requests, 'actual fresh audio directory response'); await audioIdle(); return { before, after: await params(), beforeReview: reviewed, afterReview: await reviewState() }; };
  const expectNoop = async () => { const before = await params(), reviewed = await reviewState(), used = await useAudio(); assert.equal(used.after, before); assert.deepEqual(await reviewState(), reviewed); assert.equal(reviewed.saveDisabled, false); return { content: before, review: reviewed, status: await evaluate(`document.querySelector(${JSON.stringify(aud('Status'))}).textContent`) }; };
  const holdFreshUse = async label => { assert.equal(heldAudioRequest, null); holdNextAudioRequest = true; await enabled(aud('Use')); await click(aud('Use')); await wait(() => heldAudioRequest !== null, 'CDP holds actual audio directory request ' + label); return heldAudioRequest; };
  const releaseFresh = async held => { assert.equal(heldAudioRequest, held); const requests = await audioRequestCount(); heldAudioRequest = null; await call('Fetch.continueRequest', { requestId: held.requestId }); await wait(async () => await audioRequestCount() > requests, 'held audio request receives actual HTTP result'); await audioIdle(); };
  await call('Fetch.enable', { patterns: [{ urlPattern: '*/api/scene-audio-directory', requestStage: 'Request' }] });
  const beforeBehavior = await authorTree(author); await openCreator(); assert.equal(await params(), '{}'); assert.equal(await evaluate(`document.querySelector('.scene-behavior-create-parameters').dataset.status`), 'unavailable');
  const pasted = '{\r\n "event_name":"checkpoint",\r\n "track_id":"",\r\n "instance_id":"",\r\n "probe":1e2,\r\n "negative_zero":-0\r\n}', firstRaw = pasted.replaceAll('\r\n', '\n'); await fill('#sceneBehaviorCreateParameters', pasted); assert.equal(await params(), firstRaw);
  const firstId = await currentBinding(); await reviewCreation(); const initialReview = await reviewState(); assert.ok(initialReview.content.includes(firstRaw));
  const offeredTracks = await loadAudio(); assert.equal(await value(aud('Parameter')), ''); assert.deepEqual(offeredTracks.filter(row => row.value).map(row => row.value), audio.tracks.map(row => row.id));
  const musicChoice = await chooseTrack(); const inserted = await useAudio(); assert.notEqual(inserted.after, inserted.before); assert.equal(JSON.parse(inserted.after).track_id, audio.tracks[1].id); assert.notEqual(JSON.parse(inserted.after).track_id, resource.id); assert.ok(inserted.after.includes('"probe":1e2')); assert.ok(inserted.after.includes('"negative_zero":-0')); await assertRevoked(); await reviewCreation(); const noOp = await expectNoop();
  const heldEdit = await holdFreshUse('parameter edit'), edited = await params() + ' '; await fill('#sceneBehaviorCreateParameters', edited); await releaseFresh(heldEdit); assert.equal(await params(), edited); await assertRevoked();
  await click('#sceneBehaviorCreateAddBinding'); const secondId = await currentBinding(); assert.notEqual(secondId, firstId); await fill('#sceneBehaviorCreateSource', publisherScript.id, 'change'); const secondRaw = '{ "caption":"publisher remains exact" }'; await fill('#sceneBehaviorCreateParameters', secondRaw);
  await chooseBinding(firstId); assert.equal(await params(), edited); await loadAudio(); await chooseTrack(0); const heldSwitch = await holdFreshUse('binding switch'); await chooseBinding(secondId); assert.equal(await params(), secondRaw); await releaseFresh(heldSwitch); assert.equal(await params(), secondRaw); await chooseBinding(firstId); assert.equal(await params(), edited);
  for (const unfinished of ['{"unfinished":1e-', '{"caption":"a","caption":"b"}']) { await fill('#sceneBehaviorCreateParameters', unfinished); await loadAudio(); assert.equal(await params(), unfinished); assert.equal(await evaluate(`document.querySelector(${JSON.stringify(aud('Use'))}).disabled`), true); await click('#sceneBehaviorCreateCheck'); await creatorIdle(); assert.equal(await params(), unfinished); await assertRevoked(); assert.deepEqual(await authorTree(author), beforeBehavior); }
  await screenshot('unfinished-first-audio-parameter-json-desktop.png'); await fill('#sceneBehaviorCreateParameters', edited); await reviewCreation(); await loadAudio(); await chooseTrack();
  for (const language of ['zh-CN', 'en', 'ja']) {
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`); await evaluate(`document.querySelector(${JSON.stringify(aud('Use'))}).scrollIntoView({block:'center'})`);
    const layout = await evaluate(`(()=>{const d=document.querySelector('#sceneBehaviorCreateDialog'),b=document.querySelector(${JSON.stringify(aud('Use'))}),r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {noOverflow:d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1,title:document.querySelector(${JSON.stringify(aud('Title'))}).textContent,note:document.querySelector(${JSON.stringify(aud('Note'))}).textContent,status:document.querySelector(${JSON.stringify(aud('Status'))}).textContent,actionVisible:r.top>=0&&r.bottom<=844&&r.left>=0&&r.right<=390,actionHit:hit===b||b.contains(hit),raw:document.querySelector('#sceneBehaviorCreateParameters').value,binding:document.querySelector('#sceneBehaviorCreateBindingList').value,track:document.querySelector(${JSON.stringify(aud('Track'))}).value,parameter:document.querySelector(${JSON.stringify(aud('Parameter'))}).value,review:document.querySelector('#sceneBehaviorCreateSourceText').textContent,saveDisabled:document.querySelector('#sceneBehaviorCreateSave').disabled};})()`);
    assert.equal(layout.noOverflow, true, JSON.stringify(layout)); assert.equal(layout.actionVisible, true); assert.equal(layout.actionHit, true); assert.equal(layout.raw, edited); assert.equal(layout.binding, firstId); assert.equal(layout.track, audio.tracks[1].id); assert.equal(layout.parameter, 'track_id'); assert.equal(layout.saveDisabled, false); report.layout[language] = layout; await screenshot('first-create-audio-' + language + '-390.png');
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`); assert.deepEqual(await authorTree(author), beforeBehavior);
  report.cancelledCreation = { bindingIds: [firstId, secondId], pastedOuterCRLF: pasted, actualTextareaRaw: firstRaw, initialReview, offeredTracks, musicChoice, sameValueNoop: noOp, delayedResponses: [{ kind: 'parameter-edit', request: heldEdit, edited }, { kind: 'binding-switch', request: heldSwitch, otherBindingRaw: secondRaw }], authorWrites: 0 };
  await click('#sceneBehaviorCreateCancel'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorCreateDialog').open`), 'unsaved multi-binding audio creation cancelled'); assert.deepEqual(await authorTree(author), beforeBehavior);
  report.steps.push('Before first Save, reading and choosing saved audio declarations preserve raw JSON and approved review. Explicit Use writes the second music track identity into the chosen existing String parameter and revokes review; equal-value Use preserves it. Two held real HTTP requests cannot overwrite later input or another binding. Invalid JSON, three language layouts and Cancel preserve all author bytes.');

  await openCreator(); assert.equal(await params(), '{}'); await fill('#sceneBehaviorCreateParameters', '{ "event_name":"checkpoint", "track_id":"", "instance_id":"" }');
  const savedAudioBinding = await currentBinding(); assert.equal(JSON.parse(await params()).track_id, ''); await loadAudio(); const finalMusicChoice = await chooseTrack(); const finalInsert = await useAudio(); assert.equal(JSON.parse(finalInsert.after).track_id, audio.tracks[1].id); const finalAudioRaw = await params();
  await click('#sceneBehaviorCreateAddBinding'); const savedPublisherBinding = await currentBinding(); await fill('#sceneBehaviorCreateSource', publisherScript.id, 'change'); assert.equal(await params(), '{}'); await reviewCreation();
  const candidate = await evaluate(`document.querySelector('#sceneBehaviorCreateSourceText').textContent`), planned = JSON.parse(candidate); assert.equal(planned.bindings.length, 2); assert.deepEqual(planned.bindings.map(row => row.bindingId), [savedAudioBinding, savedPublisherBinding]);
  assert.deepEqual(planned.bindings[0].parameters, { event_name: 'checkpoint', track_id: audio.tracks[1].id, instance_id: '' }); assert.deepEqual(planned.bindings[1].parameters, {}); assert.ok(candidate.includes(finalAudioRaw));
  await chooseBinding(savedAudioBinding); await loadAudio(); await chooseTrack(); const finalNoop = await expectNoop(); assert.equal(await evaluate(`document.querySelector('#sceneBehaviorCreateSourceText').textContent`), candidate); assert.deepEqual(await authorTree(author), beforeBehavior); await screenshot('first-audio-linked-behavior-reviewed-desktop.png');
  await click('#sceneBehaviorCreateSave'); await enabled('#sceneBehaviorCreateOpen'); await creatorIdle(); behaviorRecord = await record(behaviorPath); assert.equal(await fs.readFile(path.join(author, behaviorPath), 'utf8'), candidate);
  const saved = await authorTree(author), changes = [...new Set([...Object.keys(beforeBehavior), ...Object.keys(saved)])].filter(name => beforeBehavior[name] !== saved[name]).sort(); assert.deepEqual(changes, [behaviorPath, `metadata/documents/${behaviorRecord.id}.json`, `metadata/documents/${scene.id}.json`].sort());
  report.firstSave = { bindingIds: [savedAudioBinding, savedPublisherBinding], parametersRaw: [finalAudioRaw, '{}'], musicChoice: finalMusicChoice, sameValueNoop: finalNoop, reviewedContent: candidate, sourceSha256: hash(candidate), changedPaths: changes, trackWrittenOnlyByExplicitAudioUse: true }; await stage('UI first behavior transaction includes second declared music track and publisher');
  await click('#sceneBehaviorCreateOpen'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorCreateDialog').open&&!document.querySelector('#projectBuildDialog').open`), 'new behavior source opened'); assert.equal(await value('#docSourceEditor'), candidate.replaceAll('\r\n', '\n').replaceAll('\r', '\n'));
  await call('Fetch.disable'); const requestsBeforeReload = await evaluate('window.__creationAudioRequests'); await call('Page.reload'); await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'Studio reopen'); await evaluate(`window.__referenceState=(await import('/web/modules/app-state.js')).appState`);
  await openDocument(behaviorRecord); assert.equal(await value('#docSourceEditor'), candidate.replaceAll('\r\n', '\n').replaceAll('\r', '\n')); await screenshot('audio-linked-first-save-reopened-desktop.png'); assert.deepEqual(await authorTree(author), saved);
  const observedRequests = [...requestsBeforeReload, ...await evaluate('window.__creationAudioRequests')]; report.requests = observedRequests; const applied = observedRequests.filter(row => row.url.includes('/api/world/commands') && row.body?.command === 'behavior.create' && row.body.mode === 'apply'); assert.equal(applied.length, 1); assert.equal(applied[0].body.content, candidate); assert.equal(applied[0].status, 200);
  const reads = observedRequests.filter(row => row.url.includes('/api/scene-audio-directory')); assert.ok(reads.length >= 12); assert.ok(reads.every(row => row.method === 'POST' && row.status === 200 && Object.keys(row.body).join(',') === 'sceneObjectId')); report.audioDirectoryReads = reads.length;
  const finalRegistry = await readRegistry(author); assert.equal(finalRegistry.documents.length, 7); assert.equal(finalRegistry.assets.length, 1);
  const captured = await captureBuildSnapshot(author, assembly.id); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics)); assert.equal(captured.plan.scenes.length, 1); assert.equal(captured.plan.entrySceneId, scene.id); const plannedScene = captured.plan.scenes[0]; assert.equal(plannedScene.behaviors.bindings.length, 2); assert.deepEqual(plannedScene.behaviors.bindings.map(row => row.parameters), planned.bindings.map(row => row.parameters));
  const finalDirectory = path.join(output, 'author-final'); await fs.mkdir(finalDirectory); for (const name of Object.keys(saved)) { if (name !== 'workspace.json' && !/^(documents|templates|metadata|assets)\//.test(name)) continue; const file = path.join(finalDirectory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.copyFile(path.join(author, name), file); } assert.deepEqual(await authorTree(finalDirectory), saved);
  report.authorFinal = { path: finalDirectory, hashes: saved, registryDocumentCount: finalRegistry.documents.length, registryAssetCount: finalRegistry.assets.length };
  report.identities = { definition: definition.id, scene: scene.id, actorInstance: sceneDeclaration.actors[0].instanceId, assembly: assembly.id, audio: audioRecord.id, eventAudioScript: eventAudioScript.id, publisherScript: publisherScript.id, behavior: behaviorRecord.id, resource: resource.id, tracks: audio.tracks.map(row => row.id), audioBinding: savedAudioBinding, publisherBinding: savedPublisherBinding };
  report.plan = { ok: captured.ok, snapshotId: captured.snapshotId, entrySceneId: captured.plan.entrySceneId, sceneIds: captured.plan.scenes.map(row => row.scene.objectId), parameters: plannedScene.behaviors.bindings.map(row => row.parameters) }; await fs.writeFile(path.join(output, 'plan.json'), JSON.stringify(captured, null, 2) + '\n');
  report.steps.push('Exactly one behavior.create apply saves both bindings with the selected second declared music track. Reload preserves the exact reviewed source. Retain seven documents, one actual WAV and a valid one-member project plan for independent native event/audio verification.');
  report.sampleAfter = await authorTree(source); assert.deepEqual(report.sampleAfter, report.sampleBefore); report.sourcesAfter = await sourceHashes(); assert.deepEqual(report.sourcesAfter, report.sourcesBefore); assert.equal(hash(await fs.readFile(fileURLToPath(import.meta.url))), report.driverSha256); assert.deepEqual(report.errors, []); report.ok = true;
} catch (error) { report.ok = false; report.failure = error.stack; process.exitCode = 1; console.error(error); try { await captureFailure?.(); } catch (failure) { report.captureFailure = failure.message; } }
finally {
  socket?.close(); for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ ok: report.ok, output, screenshots: report.screenshots.length, steps: report.steps, failure: report.failure }, null, 2));
}
