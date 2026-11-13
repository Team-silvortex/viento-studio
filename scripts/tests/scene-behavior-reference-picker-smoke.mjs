// Actual Studio reference selection over a disposable copy of the saved sample.
// No generated runtime, canonical sample or existing evidence is edited.
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
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const source = path.resolve(process.env.VIENTO_BEHAVIOR_REFERENCE_SOURCE || path.join(appRoot, 'examples/topdown-collect'));
const output = path.resolve(process.env.VIENTO_BEHAVIOR_REFERENCE_OUTPUT || `/tmp/viento-behavior-reference-browser-${Date.now()}`);
if (!output.startsWith('/tmp/')) throw Error('This browser smoke writes evidence only beneath /tmp.');
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceNames = ['engine/scene-behavior-reference-directory.mjs', 'scripts/lib/scene-behavior-reference-directory-service.mjs',
  'web/modules/app-scene-behavior-references.js', 'web/modules/app-scene-behaviors.js', 'web/modules/app-behavior-source.js',
  'web/modules/app-runtime.js', 'web/modules/app-state.js', 'web/modules/app-doc-service.js', 'web/scene-behaviors.css',
  'scripts/lib/doc-api-service.mjs', 'scripts/lib/doc-server-routes.mjs', 'scripts/lib/scene-behavior-authoring-service.mjs',
  'engine/scene-behaviors.mjs', 'engine/scene-behaviors-edit.mjs', 'web/i18n/en.js', 'web/i18n/ja.js'];
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
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome and Studio HTTP editor over a disposable copy of the existing reference-game workspace. Not from-blank UI creation, installed Tauri or Android acceptance.',
  'Two copied manifests are prepared with unresolved ordinary strings, and the start source has BOM/CRLF. The browser repairs those fields by explicit choices, review and ordinary Save; canonical author bytes remain untouched.',
  'Member IDs, local instance IDs and saved custom action names remain ordinary strings. No automatic parameter meaning, runtime references, new actions or built-in keyboard mapping is claimed.',
  'Real HTTP replies are delayed to test stale session/binding protection. No catalog response is fabricated. The final saved assembly plan is checked; native gameplay and independent distribution are outside this browser check.'
] };
const wait = async (check, label, budget = 45000) => { for (const end = Date.now() + budget; Date.now() < end;) { if (await check()) return; await delay(80); } throw Error('Timed out: ' + label); };
let socket, captureFailure, confirmAccept = true;
try {
  report.sourcesBefore = await sourceHashes(); report.driverSha256 = hash(await fs.readFile(fileURLToPath(import.meta.url)));
  report.sampleBefore = await authorTree(source); report.node = { version: process.version, sha256: hash(await fs.readFile(process.execPath)) };
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-behavior-reference-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const author = path.join(temporary, 'author'); await fs.cp(source, author, { recursive: true, filter: name => !path.basename(name).startsWith('.') });
  const registry = await readRegistry(author), byPath = value => registry.documents.find(row => row.sourcePath === value);
  const startPath = 'documents/behaviors/start.json', levelPath = 'documents/behaviors/level.json';
  const startRecord = byPath(startPath), levelRecord = byPath(levelPath), assembly = byPath('documents/projects/game.json'), levelScene = byPath('documents/scenes/level.json');
  assert.ok(startRecord && levelRecord && assembly && levelScene, 'registered sample behavior and assembly documents exist');
  const startFile = path.join(author, startPath), levelFile = path.join(author, levelPath);
  const canonicalStart = JSON.parse(await fs.readFile(startFile, 'utf8')), canonicalLevel = JSON.parse(await fs.readFile(levelFile, 'utf8'));
  const start = structuredClone(canonicalStart), level = structuredClone(canonicalLevel), zone = level.bindings.find(row => row.parameters.kind === 'collect');
  start.bindings[0].parameters.action_name = 'manual_pending'; start.bindings[0].parameters.target_scene_id = '';
  zone.parameters.player_instance_id = 'manual_pending';
  const startText = '\ufeff' + (JSON.stringify(start, null, 2) + '\n').replaceAll('\n', '\r\n');
  await fs.writeFile(startFile, startText); await fs.writeFile(levelFile, JSON.stringify(level, null, 2) + '\n');
  const playerId = canonicalLevel.bindings[0].instanceId, zoneId = zone.bindingId;
  report.prepared = { paths: [startPath, levelPath], startBomCrlf: true, unresolvedFields: ['start.action_name', 'start.target_scene_id', 'level.collect.player_instance_id'] };
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: author,
    XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config'), XDG_DATA_HOME: path.join(temporary, 'data') };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  const initial = await authorTree(author);
  const rebuilt = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env }); assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
  assert.deepEqual(await authorTree(author), initial, 'index rebuild preserves prepared author bytes');
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

  await openDocument(startRecord); await open();
  await evaluate('window.__holdReference=true'); await click(control('Load'));
  await wait(() => evaluate(`typeof window.__releaseReference==='function'`), 'real directory reply delayed'); await close(); await open();
  await evaluate('(()=>{window.__releaseReference();delete window.__releaseReference;})()'); await delay(150);
  assert.equal(await evaluate(`document.querySelector('${control('Choice')}').options.length`), 1, 'late closed-session read cannot populate fresh controls');
  assert.deepEqual(await authorTree(author), initial); report.steps.push('A real saved-directory reply arriving after close/reopen cannot populate or edit the new session.');
  await load(); assert.equal(await value(control('Assembly')), ''); assert.equal(await value(control('Kind')), 'instance');
  assert.equal(await evaluate(`Array.from(document.querySelector('${control('Assembly')}').options).filter(row=>row.value).length`), 1);
  assert.equal(await value(await rowValueSelector('target_scene_id')), ''); assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsDialog').dataset.dirty`), 'false');
  await chooseAssembly(); await choose('scene', levelScene.id, 'target_scene_id');
  const members = await evaluate(`Array.from(document.querySelector('${control('Choice')}').options).map(row=>row.value).filter(Boolean)`); assert.equal(members.length, 4); assert.ok(members.includes(levelScene.id));
  await narrow('scene', levelScene.id, 'target_scene_id');
  assert.equal(await value(await rowValueSelector('target_scene_id')), ''); await close(); assert.deepEqual(await authorTree(author), initial);
  assert.equal(await value('#docSourceEditor'), startText.replace(/\r\n?/g, '\n')); report.steps.push('Saved member choices do not auto-select an assembly or change text; three-language selection and Cancel preserve all prepared author bytes.');

  await open(); await fill(await rowValueSelector('state_values_json'), start.bindings[0].parameters.state_values_json + ' '); await check();
  const approved = await evaluate(`document.querySelector('#sceneBehaviorsAfter').textContent`);
  await load(); await chooseAssembly(); await choose('scene', levelScene.id, 'target_scene_id');
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsApply').disabled`), false); assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsAfter').textContent`), approved);
  await use('target_scene_id', levelScene.id); assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsApply').disabled`), true);
  await choose('action', 'start_retry', 'action_name');
  const actions = await evaluate(`Array.from(document.querySelector('${control('Choice')}').options).map(row=>row.value).filter(Boolean)`); assert.deepEqual(actions, ['start_retry']);
  await narrow('action', 'start_retry', 'action_name'); assert.equal(await value(await rowValueSelector('action_name')), 'manual_pending'); await use('action_name', 'start_retry');
  await check(); const startCandidate = await evaluate(`document.querySelector('#sceneBehaviorsAfter').textContent`); await click('#sceneBehaviorsApply');
  await wait(() => evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`), 'start draft applied'); assert.deepEqual(await authorTree(author), initial);
  assert.ok(startCandidate.startsWith('\ufeff')); assert.equal(startCandidate.replaceAll('\r\n', '').includes('\n'), false);
  await enabled('#docSaveBtn'); await click('#docSaveBtn'); await wait(async () => await fs.readFile(startFile, 'utf8') === startCandidate, 'ordinary start Save');
  const afterStart = await authorTree(author); assert.deepEqual(afterStart, { ...initial, [startPath]: hash(startCandidate) }); await screenshot('member-action-saved-desktop.png');
  report.steps.push('Reading and choosing preserve an approved ordinary review. Explicit member/action insertion revokes review; Check and Apply change only the draft, ordinary Save retains exact BOM/CRLF in the one intended behavior file.');

  await openDocument(levelRecord); await open(); await fill('#sceneBehaviorsBinding', zoneId, 'change'); await load();
  const instanceIds = await evaluate(`Array.from(document.querySelector('${control('Choice')}').options).map(row=>row.value).filter(Boolean)`);
  assert.equal(instanceIds.length, 11); assert.equal(new Set(instanceIds).size, 11);
  const sceneDocument = JSON.parse(await fs.readFile(path.join(author, levelScene.sourcePath), 'utf8'));
  const crystals = sceneDocument.actors.filter(row => row.objectId === sceneDocument.actors.find(item => item.instanceId === zone.instanceId).objectId);
  assert.equal(crystals.length, 3); assert.ok(crystals.every(row => instanceIds.includes(row.instanceId)));
  await choose('instance', playerId, 'player_instance_id'); await narrow('instance', playerId, 'player_instance_id');
  await evaluate('window.__holdReference=true'); await click(control('Use')); await wait(() => evaluate(`typeof window.__releaseReference==='function'`), 'real insertion recheck delayed');
  await fill('#sceneBehaviorsBinding', canonicalLevel.bindings[2].bindingId, 'change'); await evaluate('(()=>{window.__releaseReference();delete window.__releaseReference;})()'); await delay(150);
  assert.equal(await value(await rowValueSelector('player_instance_id')), playerId);
  await fill('#sceneBehaviorsBinding', zoneId, 'change'); assert.equal(await value(await rowValueSelector('player_instance_id')), 'manual_pending');
  assert.deepEqual(await authorTree(author), afterStart); report.steps.push('Eleven local instance identities include three independent instances of one shared crystal definition. A real insertion recheck arriving after a binding switch cannot fill either binding.');
  await load(); await choose('instance', playerId, 'player_instance_id'); await use('player_instance_id', playerId); await check();
  const levelCandidate = await evaluate(`document.querySelector('#sceneBehaviorsAfter').textContent`); await click('#sceneBehaviorsApply'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`), 'level draft applied'); assert.deepEqual(await authorTree(author), afterStart);
  await enabled('#docSaveBtn'); await click('#docSaveBtn'); await wait(async () => await fs.readFile(levelFile, 'utf8') === levelCandidate, 'ordinary level Save');
  await screenshot('instance-saved-desktop.png'); const saved = await authorTree(author);
  assert.deepEqual(saved, { ...initial, [startPath]: hash(startCandidate), [levelPath]: hash(levelCandidate) });
  report.referenceReadsBeforeReload = await evaluate('window.__referenceReads'); assert.ok(report.referenceReadsBeforeReload >= 8);
  await call('Page.reload'); await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'Studio reload'); await evaluate(`window.__referenceState=(await import('/web/modules/app-state.js')).appState`);
  await openDocument(startRecord); await open(); assert.equal(await value(await rowValueSelector('target_scene_id')), levelScene.id); assert.equal(await value(await rowValueSelector('action_name')), 'start_retry'); await close();
  await openDocument(levelRecord); await open(); await fill('#sceneBehaviorsBinding', zoneId, 'change'); assert.equal(await value(await rowValueSelector('player_instance_id')), playerId); await close();
  const captured = await captureBuildSnapshot(author, assembly.id); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const planned = captured.plan.scenes;
  report.plan = { ok: captured.ok, snapshotId: captured.snapshotId, targetId: assembly.id, sceneCount: planned?.length ?? 4 };
  report.saved = { changedPaths: [startPath, levelPath], startBomCrlf: true, reopened: true, member: levelScene.id, action: 'start_retry', instance: playerId };
  report.steps.push('Ordinary Save changes exactly the two prepared behavior manifests; page reload/reopen retains all three selected string values, and the saved assembly still captures a valid build plan.');
  report.authorBefore = initial; report.authorAfter = await authorTree(author); assert.deepEqual(report.authorAfter, saved);
  report.sampleAfter = await authorTree(source); assert.deepEqual(report.sampleAfter, report.sampleBefore, 'canonical sample changed during browser run');
  report.sourcesAfter = await sourceHashes(); assert.deepEqual(report.sourcesAfter, report.sourcesBefore); assert.equal(hash(await fs.readFile(fileURLToPath(import.meta.url))), report.driverSha256);
  report.referenceReadsAfterReload = await evaluate('window.__referenceReads'); assert.deepEqual(report.errors, []); report.ok = true;
} catch (error) { report.ok = false; report.failure = error.stack; process.exitCode = 1; console.error(error); try { await captureFailure?.(); } catch (failure) { report.captureFailure = failure.message; } }
finally {
  socket?.close(); for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ ok: report.ok, output, screenshots: report.screenshots.length, steps: report.steps, failure: report.failure }, null, 2));
}
