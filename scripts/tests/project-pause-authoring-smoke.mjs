// Actual Studio pause author task on a disposable unchanged reference-game copy.
// The canonical sample, generated runtime and prior evidence stay unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import '../adapters/node-studio-core.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT_ACTION_PROJECT_PAUSE_SCRIPT } from '../../engine/godot-project-pause-script.mjs';
import { godotProjectPauseAuthor } from './helpers/project-pause-author-fixture.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(appRoot, 'examples/topdown-collect');
if (process.env.VIENTO_PROJECT_PAUSE_AUTHOR) throw Error('Clear VIENTO_PROJECT_PAUSE_AUTHOR before preparing the ordinary browser author fixture.');
const output = path.resolve(process.env.VIENTO_PROJECT_PAUSE_BROWSER_OUTPUT || `/tmp/viento-project-pause-browser-${Date.now()}`);
if (!output.startsWith('/tmp/')) throw Error('This browser smoke writes evidence only beneath /tmp.');
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceNames = ['engine/godot-project-pause-script.mjs', 'engine/godot-project-pause-parameters.mjs',
  'engine/project-pause-diagnostics.mjs', 'engine/script-authoring.mjs', 'engine/script-parameter-discovery.mjs',
  'engine/script-parameter-interface.mjs', 'engine/project-input-action-diagnostics.mjs', 'engine/project-assembly-plan.mjs',
  'engine/scene-behaviors.mjs', 'engine/scene-behaviors-edit.mjs', 'engine/scene-behavior-directory.mjs',
  'scripts/lib/scene-behavior-authoring-service.mjs', 'scripts/lib/doc-api-service.mjs', 'scripts/lib/doc-server-routes.mjs',
  'scripts/adapters/node-build-snapshot.mjs', 'web/modules/app-script-create.js', 'web/modules/app-scene-behavior-links.js',
  'web/modules/app-scene-behaviors.js', 'web/modules/app-scene-behavior-parameters.js', 'web/modules/app-project-build.js',
  'web/modules/app-runtime.js', 'web/modules/app-state.js', 'web/modules/app-doc-service.js', 'web/scene-behaviors.css',
  'web/i18n/en.js', 'web/i18n/ja.js'];
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
function bindingBytes(content) {
  const parsed = parseJsonSource(content); assert.equal(parsed.ok, true);
  return Object.fromEntries(parsed.value.bindings.map((binding, index) => {
    const range = locateJsonSource(parsed, `/bindings/${index}`); assert.equal(range.exact, true);
    return [binding.bindingId, content.slice(range.start, range.end)];
  }));
}
const cleanups = [], fixture = { after: callback => cleanups.push(callback) };
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome and Studio HTTP editor on a disposable reference-game fixture. This is not from-blank project creation, installed Tauri or Android acceptance.',
  'The pause TXT, registration, relation, binding and three parameter rows are absent at the recorded start; each is created through ordinary Studio controls. Original sample files remain untouched.',
  'The fixture alone maps pause to P and Space, loops collection audio and adds an ordinary tick-counter TXT/binding for later independent native freeze observations. Browser evidence claims no native gameplay.',
  'Exact-source parameter hints remain advisory. Explicit Add missing, local editing, Check, Apply and ordinary Save are distinct operations; Cancel never writes.'

] };
const wait = async (check, label, budget = 45000) => { for (const end = Date.now() + budget; Date.now() < end;) { if (await check()) return; await delay(80); } throw Error('Timed out: ' + label); };
let socket, captureFailure, confirmAccept = true;
try {
  report.sourcesBefore = await sourceHashes(); report.driverSha256 = hash(await fs.readFile(fileURLToPath(import.meta.url)));
  report.sampleBefore = await authorTree(source); report.node = { version: process.version, sha256: hash(await fs.readFile(process.execPath)) };
  const prepared = await godotProjectPauseAuthor(fixture), { temporary, author } = prepared;
  const behaviorPath = 'documents/behaviors/level.json';
  const levelBefore = await prepared.read(behaviorPath); levelBefore.bindings = levelBefore.bindings.filter(row => row.bindingId !== prepared.bindingId); await prepared.write(behaviorPath, levelBefore);
  const metadataPath = `metadata/documents/${'c011ec70-2026-4113-8113-000000000041'}.json`;
  const recordBefore = await prepared.read(metadataPath); recordBefore.relations = recordBefore.relations.filter(row => row.targetId !== prepared.scriptId); await prepared.write(metadataPath, recordBefore);
  await fs.rm(path.join(author, 'documents/scripts/pause.txt')); await fs.rm(path.join(author, `metadata/documents/${prepared.scriptId}.json`));
  const registry = await readRegistry(author), byPath = name => registry.documents.find(row => row.sourcePath === name);
  const levelPath = 'documents/behaviors/level.json', levelRecord = byPath(levelPath), assembly = byPath('documents/projects/game.json');
  const levelScene = byPath('documents/scenes/level.json'); assert.ok(levelRecord && assembly && levelScene);
  const levelFile = path.join(author, levelPath), originalLevelText = await fs.readFile(levelFile, 'utf8'), originalLevel = JSON.parse(originalLevelText);
  const originalBindingBytes = bindingBytes(originalLevelText), playerId = originalLevel.bindings[0].instanceId;
  const recordPath = `metadata/documents/${levelRecord.id}.json`, originalRecord = JSON.parse(await fs.readFile(path.join(author, recordPath), 'utf8'));
  const scriptPath = 'documents/scripts/pause-authored.txt'; let scriptRecord, canceledBindingId, finalBindingId;
  assert.equal(registry.documents.some(row => row.sourcePath === scriptPath), false);
  report.prepared = { kind: 'official-reference-game-copy-with-pause-test-fixture', inputAction: { name: 'pause', keys: ['KeyP', 'Space'] }, collectionAudioLoop: true,
    ordinaryTickSourcePath: 'documents/scripts/pause-test-ticks.txt', authoredBefore: registry.documents.length, assetsBefore: registry.assets.length,
    bindingCount: originalLevel.bindings.length, pauseScriptPrepared: false, pauseBindingPrepared: false };

  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: author,
    XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config'), XDG_DATA_HOME: path.join(temporary, 'data') };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  const initial = await authorTree(author);
  const rebuilt = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env }); assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
  assert.deepEqual(await authorTree(author), initial, 'index rebuild must preserve prepared author bytes');
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
    await wait(() => evaluate(`(()=>{const s=window.__pauseState;return !s.isSaving&&!s.isRebuilding&&!s.isLoadingSource&&s.docs.some(row=>row.id===${JSON.stringify(record.id)})})()`), 'registered document ready');
    const indexPath = await evaluate(`window.__pauseState.docs.find(row=>row.id===${JSON.stringify(record.id)}).path`);
    await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(row=>row.dataset.path===${JSON.stringify(indexPath)})`), 'sidebar document ready');
    await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(row=>row.dataset.path===${JSON.stringify(indexPath)}).click()`);
    await wait(() => evaluate(`window.__pauseState.activePath===${JSON.stringify(indexPath)}&&!window.__pauseState.isLoadingSource`), 'document selected');
    await wait(async () => { const state = await evaluate(`({editing:window.__pauseState.isEditing,source:window.__pauseState.activeEditSource,canEdit:document.querySelector('#docEditBtn')?.disabled===false})`); if (state.editing && (state.source === record.sourcePath || state.source.endsWith('/' + record.sourcePath))) return true; if (!state.editing && state.canEdit) await click('#docEditBtn'); return false; }, 'source edit ready');
    await enabled('#docEditSourceModeBtn'); await click('#docEditSourceModeBtn');
  };
  const parameters = () => evaluate(`Object.fromEntries(Array.from(document.querySelectorAll('#sceneBehaviorsParameters input[id$="Name"]')).map((row,index)=>[row.value,document.querySelector('#sceneBehaviorsParam'+index+'Value').value]))`);
  const rowValueSelector = async name => {
    const index = await evaluate(`Array.from(document.querySelectorAll('#sceneBehaviorsParameters input[id$="Name"]')).findIndex(row=>row.value===${JSON.stringify(name)})`);
    assert.ok(index >= 0, 'parameter row ' + name); return '#sceneBehaviorsParam' + index + 'Value';
  };
  const openBehavior = async () => { await enabled('#sceneBehaviorsBtn'); await click('#sceneBehaviorsBtn'); await enabled('#sceneBehaviorsAddBinding'); };
  const closeBehavior = async () => { await click('#sceneBehaviorsCancel'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`), 'behavior closed'); };
  const saveOrdinary = async name => {
    await enabled('#docSaveBtn'); await click('#docSaveBtn');
    await wait(async () => (await readRegistry(author)).documents.some(row => row.sourcePath === name), 'registered ordinary Save');
    await wait(() => evaluate(`!window.__pauseState.isSaving&&!window.__pauseState.isRebuilding&&!window.__pauseState.isLoadingSource&&!window.__pauseState.editHasUnsavedChanges`), 'ordinary Save idle');
  };
  const narrow = async (stage, dialogId, focusId, expectedParameters) => {
    for (const language of ['zh-CN', 'en', 'ja']) {
      await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
      await evaluate(`document.querySelector(${JSON.stringify(focusId)}).scrollIntoView({block:'center'})`);
      const layout = await evaluate(`(()=>{const d=document.querySelector(${JSON.stringify(dialogId)}),f=document.querySelector(${JSON.stringify(focusId)}),r=f.getBoundingClientRect();return {noOverflow:d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1,focusWithinWidth:r.left>=0&&r.right<=390,title:d.querySelector('h2').textContent,description:document.querySelector('#scriptCreateDialog')?.open?document.querySelector('#scriptCreateDescription').textContent:'',parameterNames:Array.from(document.querySelectorAll('#sceneBehaviorsParameters input[id$="Name"]'),row=>row.value)};})()`);
      assert.equal(layout.noOverflow, true, JSON.stringify(layout)); assert.equal(layout.focusWithinWidth, true, JSON.stringify(layout));
      if (dialogId === '#scriptCreateDialog') { assert.equal(await evaluate(`document.querySelector('#scriptCreateSource').textContent`), GODOT_ACTION_PROJECT_PAUSE_SCRIPT); assert.equal(await value('#scriptCreateStarter'), 'godot-project-pause'); }
      else { assert.deepEqual(await parameters(), expectedParameters); assert.equal(layout.parameterNames.includes('target_scene_id'), false); }
      report.layout[stage + '-' + language] = layout; await screenshot(stage + '-' + language + '-390.png');
    }
    await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,state:window.__pauseState})`); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'Studio startup');
  await evaluate(`window.__pauseState=(await import('/web/modules/app-state.js')).appState`);
  await openDocument(levelRecord);

  const openScript = async () => {
    await enabled('#scriptCreateBtn'); await click('#scriptCreateBtn'); await enabled('#scriptCreateApply');
    await fill('#scriptCreateStarter', 'godot-project-pause', 'change'); await fill('#scriptCreateType', 'script', 'change'); await fill('#scriptCreatePath', scriptPath);
    await enabled('#scriptCreateApply'); assert.equal(await evaluate(`document.querySelector('#scriptCreateSource').textContent`), GODOT_ACTION_PROJECT_PAUSE_SCRIPT);
    assert.equal(GODOT_ACTION_PROJECT_PAUSE_SCRIPT.includes('target_scene_id'), false);
  };
  await openScript(); await narrow('pause-script', '#scriptCreateDialog', '#scriptCreateApply');
  await click('#scriptCreateCancel'); await wait(() => evaluate(`!document.querySelector('#scriptCreateDialog').open`), 'script draft canceled');
  assert.deepEqual(await authorTree(author), initial);
  await openScript(); await click('#scriptCreateApply'); await wait(() => evaluate(`!document.querySelector('#scriptCreateDialog').open&&window.__pauseState.isCreating`), 'pause TXT draft created');
  assert.deepEqual(await authorTree(author), initial); await saveOrdinary(scriptPath);
  scriptRecord = (await readRegistry(author)).documents.find(row => row.sourcePath === scriptPath); assert.ok(scriptRecord);
  assert.equal(await fs.readFile(path.join(author, scriptPath), 'utf8'), GODOT_ACTION_PROJECT_PAUSE_SCRIPT);
  const afterScript = await authorTree(author), newScriptPaths = Object.keys(afterScript).filter(name => afterScript[name] !== initial[name]);
  assert.deepEqual(newScriptPaths.sort(), [scriptPath, `metadata/documents/${scriptRecord.id}.json`].sort());
  report.steps.push('Open the new pause starter in real Studio, inspect exact TXT in Chinese/English/Japanese at 390px, cancel without writes, then explicitly create and ordinarily save the new script and registration. No target_scene_id export exists.');

  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildScene'); await fill('#projectBuildScene', levelScene.id, 'change');
  const openLinks = async () => { await enabled('#projectBuildManageBehavior'); await click('#projectBuildManageBehavior'); await enabled('#sceneBehaviorLinksOpen'); };
  const reviewLink = async () => { await fill('#sceneBehaviorLinksSource', scriptRecord.id, 'change'); await enabled('#sceneBehaviorLinksCheck'); await click('#sceneBehaviorLinksCheck'); await enabled('#sceneBehaviorLinksSave'); };
  await openLinks(); await reviewLink(); assert.deepEqual(await authorTree(author), afterScript);
  await click('#sceneBehaviorLinksCancel'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorLinksDialog').open`), 'script link canceled'); assert.deepEqual(await authorTree(author), afterScript);
  await openLinks(); await reviewLink(); await click('#sceneBehaviorLinksSave');
  await wait(async () => JSON.parse(await fs.readFile(path.join(author, recordPath), 'utf8')).relations.some(row => row.targetId === scriptRecord.id), 'script relation saved'); await enabled('#sceneBehaviorLinksOpen');
  const afterLink = await authorTree(author), linkedRecord = JSON.parse(await fs.readFile(path.join(author, recordPath), 'utf8'));
  assert.deepEqual(linkedRecord, { ...originalRecord, relations: [...originalRecord.relations, { kind: 'references', targetId: scriptRecord.id, slot: '' }] });
  assert.deepEqual(Object.keys(afterLink).filter(name => afterLink[name] !== afterScript[name]), [recordPath]);
  assert.equal(await fs.readFile(levelFile, 'utf8'), originalLevelText);
  await click('#sceneBehaviorLinksOpen'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorLinksDialog').open&&!document.querySelector('#projectBuildDialog').open`), 'linked behavior opened');
  await enabled('#sceneBehaviorsBtn');
  report.steps.push('Manage the existing level behavior through Studio: preview/cancel leaves all bytes untouched; explicit Save adds exactly one reviewed script reference to the behavior registration without changing its source.');

  const addPauseBinding = async () => {
    await enabled('#sceneBehaviorsAddBinding'); await click('#sceneBehaviorsAddBinding'); const id = await value('#sceneBehaviorsBinding');
    await fill('#sceneBehaviorsInstance', playerId, 'change'); await fill('#sceneBehaviorsSource', scriptRecord.id, 'change');
    await enabled('#sceneBehaviorsAddMissingParameters'); assert.deepEqual(await parameters(), {}); return id;
  };
  const defaults = { action_name: 'pause', paused_text: 'Paused', resume_text: 'Release controls to resume' };
  await openBehavior(); canceledBindingId = await addPauseBinding(); await click('#sceneBehaviorsAddMissingParameters'); assert.deepEqual(await parameters(), defaults);
  await narrow('pause-defaults', '#sceneBehaviorsDialog', '#sceneBehaviorsParameters', defaults);
  assert.deepEqual(await authorTree(author), afterLink); await closeBehavior(); assert.deepEqual(await authorTree(author), afterLink);
  await openBehavior(); assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsBinding').options.length`), originalLevel.bindings.length);
  finalBindingId = await addPauseBinding(); assert.notEqual(finalBindingId, canceledBindingId); await click('#sceneBehaviorsAddMissingParameters'); assert.deepEqual(await parameters(), defaults);
  await fill(await rowValueSelector('action_name'), 'pause');
  await fill(await rowValueSelector('paused_text'), 'Paused · 暂停中 · 一時停止'); await fill(await rowValueSelector('resume_text'), 'Release controls to resume · 松开按键 · キーを離す');
  const desired = { action_name: 'pause', paused_text: 'Paused · 暂停中 · 一時停止', resume_text: 'Release controls to resume · 松开按键 · キーを離す' };
  await narrow('pause-authored', '#sceneBehaviorsDialog', '#sceneBehaviorsParameters', desired);
  assert.deepEqual(await authorTree(author), afterLink); await enabled('#sceneBehaviorsCheck'); await click('#sceneBehaviorsCheck'); await enabled('#sceneBehaviorsApply');
  const candidate = await evaluate(`document.querySelector('#sceneBehaviorsAfter').textContent`), candidateModel = JSON.parse(candidate);
  assert.deepEqual(candidateModel.bindings.slice(0, originalLevel.bindings.length), originalLevel.bindings); assert.equal(candidateModel.bindings.length, originalLevel.bindings.length + 1);
  const added = candidateModel.bindings.at(-1); assert.equal(added.bindingId, finalBindingId); assert.equal(added.instanceId, playerId); assert.equal(added.implementation.sourceObjectId, scriptRecord.id);
  assert.deepEqual(added.parameters, desired); assert.deepEqual(added.events, []); assert.equal(Object.hasOwn(added.parameters, 'target_scene_id'), false);
  const candidateBytes = bindingBytes(candidate); for (const [id, text] of Object.entries(originalBindingBytes)) assert.equal(candidateBytes[id], text, 'unchanged existing binding bytes ' + id);
  assert.deepEqual(await authorTree(author), afterLink); await screenshot('pause-reviewed-desktop.png');
  await click('#sceneBehaviorsApply'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`), 'pause applied only to ordinary source draft'); assert.deepEqual(await authorTree(author), afterLink);
  await saveOrdinary(levelPath); assert.equal(await fs.readFile(levelFile, 'utf8'), candidate);
  const saved = await authorTree(author); assert.deepEqual(saved, { ...afterLink, [levelPath]: hash(candidate) });
  report.steps.push('Add a fresh binding to the player and select the newly linked script. Explicit Add missing supplies exactly action_name, paused_text and resume_text. Three-language 390px views show all three defaults with no target parameter. Cancel discards the new binding and every local row without author writes.');
  report.steps.push('Add a different fresh binding, explicitly Add missing, edit pause action and multilingual display text, inspect three-language narrow layouts, Check and Apply. Every existing binding byte range remains exact. Apply writes no author file; ordinary Save changes only the level behavior source.');

  await call('Page.reload'); await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'Studio reload');
  await evaluate(`window.__pauseState=(await import('/web/modules/app-state.js')).appState`); await openDocument(levelRecord); await openBehavior(); await fill('#sceneBehaviorsBinding', finalBindingId, 'change');
  assert.deepEqual(await parameters(), desired); assert.equal(await value('#sceneBehaviorsSource'), scriptRecord.id); assert.equal(await value('#sceneBehaviorsInstance'), playerId);
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsAddMissingParameters').disabled`), true); assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsDialog').dataset.dirty`), 'false');
  await screenshot('pause-saved-reopened-desktop.png'); await closeBehavior(); assert.deepEqual(await authorTree(author), saved);
  const finalRegistry = await readRegistry(author); assert.equal(finalRegistry.documents.length, registry.documents.length + 1); assert.equal(finalRegistry.assets.length, registry.assets.length);
  const captured = await captureBuildSnapshot(author, assembly.id); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const plannedLevel = captured.plan.scenes.find(row => row.scene.objectId === levelScene.id), plannedBinding = plannedLevel.behaviors.bindings.find(row => row.bindingId === finalBindingId);
  assert.deepEqual(plannedBinding.parameters, desired); assert.equal(plannedBinding.implementation.sourceObjectId, scriptRecord.id); assert.equal(captured.plan.scenes.length, 4);
  const finalDirectory = path.join(output, 'author-final'); await fs.mkdir(finalDirectory);
  for (const name of Object.keys(saved)) { const file = path.join(finalDirectory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.copyFile(path.join(author, name), file); }
  assert.deepEqual(await authorTree(finalDirectory), saved);
  report.saved = { scriptPath, scriptObjectId: scriptRecord.id, behaviorPath: levelPath, recordPath, bindingId: finalBindingId, canceledBindingId,
    instanceId: playerId, parameters: desired, targetParameterPresent: false, preservedExistingBindings: originalLevel.bindings.length, reopened: true };
  report.plan = { ok: captured.ok, snapshotId: captured.snapshotId, assemblyId: assembly.id, sceneCount: captured.plan.scenes.length, levelBindingCount: plannedLevel.behaviors.bindings.length };
  report.authorFinal = { path: finalDirectory, hashes: saved, registeredDocuments: finalRegistry.documents.length, registeredAssets: finalRegistry.assets.length };
  report.authorBefore = initial; report.authorAfter = await authorTree(author); assert.deepEqual(report.authorAfter, saved);
  report.sampleAfter = await authorTree(source); assert.deepEqual(report.sampleAfter, report.sampleBefore);
  report.sourcesAfter = await sourceHashes(); assert.deepEqual(report.sourcesAfter, report.sourcesBefore); assert.equal(hash(await fs.readFile(fileURLToPath(import.meta.url))), report.driverSha256);
  assert.equal(Object.keys(report.layout).length, 9); assert.deepEqual(report.errors, []); report.ok = true;
  report.steps.push('Reload and reopen retain the explicit source, instance, three explicit parameters and fresh identity. The ordinary four-scene build snapshot is valid, the script remains exact, and the retained author-final workspace matches saved UI bytes. Official sample and all guarded production source hashes stay unchanged.');
} catch (error) { report.ok = false; report.failure = error.stack; process.exitCode = 1; console.error(error); try { await captureFailure?.(); } catch (failure) { report.captureFailure = failure.message; } }
finally {
  socket?.close(); for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ ok: report.ok, output, screenshots: report.screenshots.length, steps: report.steps, failure: report.failure }, null, 2));
}
