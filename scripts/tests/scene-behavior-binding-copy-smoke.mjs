// Actual Studio binding-copy author task on a disposable reference-game copy.
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

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const source = path.resolve(process.env.VIENTO_BEHAVIOR_COPY_SOURCE || path.join(appRoot, 'examples/topdown-collect'));
const output = path.resolve(process.env.VIENTO_BEHAVIOR_COPY_OUTPUT || `/tmp/viento-behavior-copy-browser-${Date.now()}`);
if (!output.startsWith('/tmp/')) throw Error('This browser smoke writes evidence only beneath /tmp.');
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceNames = ['engine/scene-behavior-binding-copy.mjs', 'engine/scene-behaviors.mjs', 'engine/scene-behaviors-edit.mjs',
  'engine/json-source.mjs', 'engine/scene-behavior-reference-directory.mjs', 'web/modules/app-scene-behaviors.js',
  'web/modules/app-scene-behavior-references.js', 'web/modules/app-behavior-source.js', 'web/modules/app-runtime.js',
  'web/modules/app-state.js', 'web/modules/app-doc-service.js', 'web/scene-behaviors.css', 'web/i18n/en.js', 'web/i18n/ja.js',
  'scripts/lib/doc-api-service.mjs', 'scripts/lib/doc-server-routes.mjs', 'scripts/lib/scene-behavior-authoring-service.mjs',
  'scripts/lib/scene-behavior-reference-directory-service.mjs', 'scripts/adapters/node-build-snapshot.mjs'];
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
  'Actual Chrome and Studio HTTP editor on a disposable reference-game author copy; this is not from-blank creation, installed Tauri or Android acceptance.',
  'The fixture removes two existing collection bindings and gives the remaining manifest BOM/CRLF and equivalent JSON spellings. The UI recreates those bindings with fresh identities and explicit instance choices; no runtime or script source is patched.',
  'Scratch numeric input and a signal mapping are used only in the canceled form. They are not saved, do not claim script export discovery and are absent from the final runnable author workspace.',
  'A detached old reference control is dispatched after copying to another binding. No catalog result is fabricated. This check records browser authoring and a valid saved assembly plan; native gameplay is verified separately.'
] };
const wait = async (check, label, budget = 45000) => { for (const end = Date.now() + budget; Date.now() < end;) { if (await check()) return; await delay(80); } throw Error('Timed out: ' + label); };
let socket, captureFailure, confirmAccept = true;
try {
  report.sourcesBefore = await sourceHashes(); report.driverSha256 = hash(await fs.readFile(fileURLToPath(import.meta.url)));
  report.sampleBefore = await authorTree(source); report.node = { version: process.version, sha256: hash(await fs.readFile(process.execPath)) };
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-behavior-copy-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const author = path.join(temporary, 'author'); await fs.cp(source, author, { recursive: true, filter: name => !path.basename(name).startsWith('.') });
  const registry = await readRegistry(author), byPath = value => registry.documents.find(row => row.sourcePath === value);
  const levelPath = 'documents/behaviors/level.json', levelRecord = byPath(levelPath), assembly = byPath('documents/projects/game.json');
  const levelScene = byPath('documents/scenes/level.json'); assert.ok(levelRecord && assembly && levelScene);
  const levelFile = path.join(author, levelPath), canonicalLevel = JSON.parse(await fs.readFile(levelFile, 'utf8'));
  const collections = canonicalLevel.bindings.filter(row => row.parameters.kind === 'collect'); assert.equal(collections.length, 3);
  const first = collections[0], removed = collections.slice(1), level = structuredClone(canonicalLevel);
  level.bindings = level.bindings.filter(row => !removed.some(other => other.bindingId === row.bindingId)); assert.equal(level.bindings.length, 9);
  const initialText = '\ufeff' + (JSON.stringify(level, null, 2) + '\n').replace('"score_goal": 3', '"score_goal": 3.000')
    .replace('"kind": "collect"', '"kind": "\\u0063ollect"').replaceAll('\n', '\r\n');
  assert.deepEqual(JSON.parse(initialText.slice(1)), level); await fs.writeFile(levelFile, initialText);
  const initialBindingBytes = bindingBytes(initialText), playerId = first.parameters.player_instance_id;
  report.prepared = { sourcePath: levelPath, bindingCount: level.bindings.length, retainedBindingId: first.bindingId,
    omitted: removed.map(row => ({ bindingId: row.bindingId, instanceId: row.instanceId })), bomCrlf: true,
    equivalentJsonSpellings: ['score_goal:3.000', 'kind:\\u0063ollect'] };
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
  const rowValueSelector = async name => {
    const index = await evaluate(`Array.from(document.querySelectorAll('#sceneBehaviorsParameters input[id$="Name"]')).findIndex(row=>row.value===${JSON.stringify(name)})`);
    assert.ok(index >= 0, 'parameter row ' + name); return '#sceneBehaviorsParam' + index + 'Value';
  };
  const bindingCount = () => evaluate(`document.querySelector('#sceneBehaviorsBinding').options.length`);
  const open = async () => { await enabled('#sceneBehaviorsBtn'); await click('#sceneBehaviorsBtn'); await wait(() => evaluate(`document.querySelector('#sceneBehaviorsDialog').open&&!document.querySelector('#sceneBehaviorsFields').hidden&&!document.querySelector('#sceneBehaviorsInstance').disabled`), 'behavior form ready'); };
  const close = async () => { await click('#sceneBehaviorsCancel'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`), 'behavior form closed'); };
  const check = async () => { await enabled('#sceneBehaviorsCheck'); await click('#sceneBehaviorsCheck'); await enabled('#sceneBehaviorsApply'); };
  const selectFirst = async () => { await fill('#sceneBehaviorsBinding', first.bindingId, 'change'); assert.equal(await value('#sceneBehaviorsInstance'), first.instanceId); };
  const openDocument = async record => {
    await wait(() => evaluate(`(()=>{const s=window.__copyState;return !s.isSaving&&!s.isRebuilding&&!s.isLoadingSource&&s.docs.some(row=>row.id===${JSON.stringify(record.id)})})()`), 'registered document ready');
    const indexPath = await evaluate(`window.__copyState.docs.find(row=>row.id===${JSON.stringify(record.id)}).path`);
    await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(row=>row.dataset.path===${JSON.stringify(indexPath)})`), 'sidebar document ready');
    await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(row=>row.dataset.path===${JSON.stringify(indexPath)}).click()`);
    await wait(() => evaluate(`window.__copyState.activePath===${JSON.stringify(indexPath)}&&!window.__copyState.isLoadingSource`), 'document selected');
    await wait(async () => { const state = await evaluate(`({editing:window.__copyState.isEditing,source:window.__copyState.activeEditSource,canEdit:document.querySelector('#docEditBtn')?.disabled===false})`); if (state.editing && (state.source === record.sourcePath || state.source.endsWith('/' + record.sourcePath))) return true; if (!state.editing && state.canEdit) await click('#docEditBtn'); return false; }, 'source edit ready');
    await enabled('#docEditSourceModeBtn'); await click('#docEditSourceModeBtn'); await enabled('#sceneBehaviorsBtn');
  };
  const narrow = async (stage, expected) => {
    for (const language of ['zh-CN', 'en', 'ja']) {
      await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
      await evaluate(`document.querySelector('#sceneBehaviorsCopyTools').scrollIntoView({block:'center'})`);
      const layout = await evaluate(`(()=>{const d=document.querySelector('#sceneBehaviorsDialog'),p=document.querySelector('#sceneBehaviorsCopyTools'),c=document.querySelector('#sceneBehaviorsCopyBinding'),target=document.querySelector('#sceneBehaviorsCopyTarget'),r=c.getBoundingClientRect(),tr=target.getBoundingClientRect();return {noOverflow:d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1,panelVisible:!p.hidden,target:target.value,copyEnabled:!c.disabled,bindingCount:document.querySelector('#sceneBehaviorsBinding').options.length,buttonText:c.textContent,buttonVisible:r.left>=0&&r.right<=390&&r.top>=0&&r.bottom<=844,targetWithinWidth:tr.left>=0&&tr.right<=390};})()`);
      assert.ok(layout.noOverflow && layout.panelVisible && layout.buttonVisible && layout.targetWithinWidth, JSON.stringify(layout));
      assert.equal(layout.target, expected.target); assert.equal(layout.copyEnabled, expected.copyEnabled); assert.equal(layout.bindingCount, expected.bindingCount);
      report.layout[stage + '-' + language] = layout; await screenshot(stage + '-' + language + '-390.png');
    }
    await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,state:window.__copyState,copyTarget:document.querySelector('#sceneBehaviorsCopyTarget')?.value})`); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'Studio startup');
  await evaluate(`window.__copyState=(await import('/web/modules/app-state.js')).appState`);
  await openDocument(levelRecord); await open(); await selectFirst(); assert.equal(await bindingCount(), 9);
  assert.equal(await value('#sceneBehaviorsCopyTarget'), ''); assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsCopyBinding').disabled`), true);
  await narrow('copy-idle', { target: '', copyEnabled: false, bindingCount: 9 });
  await fill('#sceneBehaviorsCopyTarget', removed[0].instanceId, 'change');
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsDialog').dataset.dirty`), 'false');
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsCheck').disabled`), true); assert.deepEqual(await authorTree(author), initial);
  await narrow('copy-target', { target: removed[0].instanceId, copyEnabled: true, bindingCount: 9 });
  report.steps.push('Open the prepared nine-binding source. No copy target is selected automatically. Selecting a named crystal changes neither the form nor any author byte; three-language 390px views preserve the choice.');

  // An unfinished numeric field and an unvalidated signal stay local, including
  // through duplication. They are discarded before authoring the real game.
  await click('#sceneBehaviorsAddParameter'); await fill('#sceneBehaviorsParam2Name', 'scratch_number'); await fill('#sceneBehaviorsParam2Type', 'number', 'change'); await fill('#sceneBehaviorsParam2Value', '1e-');
  await click('#sceneBehaviorsAddEvent'); await fill('#sceneBehaviorsEvent0Signal', 'copy_probe'); await fill('#sceneBehaviorsEvent0Name', 'copy.probe');
  await enabled('#sceneBehaviorsCopyBinding'); await click('#sceneBehaviorsCopyBinding');
  const canceledId = await value('#sceneBehaviorsBinding'); assert.ok(!canonicalLevel.bindings.some(row => row.bindingId === canceledId));
  assert.equal(await bindingCount(), 10); assert.equal(await value('#sceneBehaviorsInstance'), removed[0].instanceId); assert.equal(await value('#sceneBehaviorsCopyTarget'), '');
  assert.equal(await value('#sceneBehaviorsParam2Value'), '1e-'); assert.equal(await value('#sceneBehaviorsEvent0Signal'), 'copy_probe');
  assert.equal(await value('#sceneBehaviorsEvent0Name'), 'copy.probe'); assert.equal(await value(await rowValueSelector('player_instance_id')), playerId);
  await narrow('copy-local-draft', { target: '', copyEnabled: false, bindingCount: 10 });
  await click('#sceneBehaviorsCheck'); await wait(() => evaluate(`document.querySelector('#sceneBehaviorsDialog').getAttribute('aria-busy')==='false'`), 'invalid numeric review finished');
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsApply').disabled`), true); assert.equal(await value('#sceneBehaviorsParam2Value'), '1e-');
  assert.deepEqual(await authorTree(author), initial); await close(); assert.deepEqual(await authorTree(author), initial);
  await open(); await selectFirst(); assert.equal(await bindingCount(), 9); assert.equal(await evaluate(`document.querySelectorAll('#sceneBehaviorsParameters input[id$="Name"]').length`), 2);
  assert.equal(await evaluate(`document.querySelectorAll('#sceneBehaviorsEvents .scene-behaviors-event').length`), 0); assert.equal(await value('#sceneBehaviorsCopyTarget'), '');
  report.steps.push('Explicitly copy the current unfinished numeric row and signal mapping. The new binding has its own identity and selected target, keeps the incomplete input and resets target selection. Review refuses the number without losing input; Cancel and reopen restore all original author bytes and nine bindings.');

  // Save an old reference control. It must not gain authority over copied rows.
  await enabled('#sceneBehaviorsReferencesLoad'); await click('#sceneBehaviorsReferencesLoad'); await enabled('#sceneBehaviorsReferencesChoice');
  await fill('#sceneBehaviorsReferencesKind', 'instance', 'change'); await fill('#sceneBehaviorsReferencesChoice', playerId, 'change');
  const referenceParameter = await evaluate(`Array.from(document.querySelector('#sceneBehaviorsReferencesParameter').options).find(row=>row.textContent.includes('player_instance_id'))?.value`); assert.ok(referenceParameter);
  await fill('#sceneBehaviorsReferencesParameter', referenceParameter, 'change'); await enabled('#sceneBehaviorsReferencesUse');
  await evaluate(`window.__oldCopyReference=document.querySelector('#sceneBehaviorsReferencesUse')`);
  const newIds = [];
  for (const [index, original] of removed.entries()) {
    if (index) await selectFirst();
    const count = await bindingCount(); await fill('#sceneBehaviorsCopyTarget', original.instanceId, 'change');
    if (index) assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsApply').disabled`), false, 'target selection alone must preserve review');
    await enabled('#sceneBehaviorsCopyBinding'); await click('#sceneBehaviorsCopyBinding');
    const added = await value('#sceneBehaviorsBinding'); newIds.push(added); assert.match(added, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    assert.ok(!canonicalLevel.bindings.some(row => row.bindingId === added)); assert.notEqual(added, canceledId); assert.equal(await bindingCount(), count + 1);
    assert.equal(await value('#sceneBehaviorsCopyTarget'), ''); assert.equal(await value('#sceneBehaviorsInstance'), original.instanceId);
    assert.equal(await value('#sceneBehaviorsSource'), first.implementation.sourceObjectId); assert.equal(await value(await rowValueSelector('kind')), 'collect');
    assert.equal(await value(await rowValueSelector('player_instance_id')), playerId); assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsApply').disabled`), true);
    await evaluate(`document.querySelector('#sceneBehaviorsCopyBinding').dispatchEvent(new MouseEvent('click',{bubbles:true}))`); assert.equal(await bindingCount(), count + 1, 'cleared target prevents a second synthetic copy');
    if (!index) {
      await fill(await rowValueSelector('player_instance_id'), 'pending_copy_target');
      await evaluate(`window.__oldCopyReference.dispatchEvent(new MouseEvent('click',{bubbles:true}))`); await delay(120);
      assert.equal(await value(await rowValueSelector('player_instance_id')), 'pending_copy_target', 'old control cannot fill the copied binding');
      await fill(await rowValueSelector('player_instance_id'), playerId);
    }
    await check(); assert.deepEqual(await authorTree(author), initial);
  }
  assert.equal(new Set(newIds).size, 2); assert.equal(await bindingCount(), 11);
  const candidate = await evaluate(`document.querySelector('#sceneBehaviorsAfter').textContent`), candidateModel = JSON.parse(candidate.replace(/^\ufeff/, ''));
  assert.ok(candidate.startsWith('\ufeff')); assert.equal(candidate.replaceAll('\r\n', '').includes('\n'), false);
  const afterBindingBytes = bindingBytes(candidate);
  for (const binding of level.bindings) {
    assert.deepEqual(candidateModel.bindings.find(row => row.bindingId === binding.bindingId), binding);
    assert.equal(afterBindingBytes[binding.bindingId], initialBindingBytes[binding.bindingId], 'existing binding raw bytes ' + binding.bindingId);
  }
  const actualCollections = candidateModel.bindings.filter(row => row.parameters.kind === 'collect'); assert.equal(actualCollections.length, 3);
  assert.deepEqual(new Set(actualCollections.map(row => row.instanceId)), new Set(collections.map(row => row.instanceId)));
  for (const binding of actualCollections) { assert.deepEqual(binding.parameters, first.parameters); assert.deepEqual(binding.events, first.events); }
  await screenshot('copy-reviewed-desktop.png'); await click('#sceneBehaviorsApply'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`), 'binding copies applied only to draft');
  assert.deepEqual(await authorTree(author), initial); await enabled('#docSaveBtn'); await click('#docSaveBtn');
  await wait(async () => await fs.readFile(levelFile, 'utf8') === candidate, 'ordinary behavior Save');
  await wait(() => evaluate(`!window.__copyState.isSaving&&!window.__copyState.isRebuilding&&!window.__copyState.editHasUnsavedChanges`), 'ordinary Save idle');
  const saved = await authorTree(author); assert.deepEqual(saved, { ...initial, [levelPath]: hash(candidate) });
  report.steps.push('Recreate the missing second and third crystal bindings by explicit target choices and two fresh identities. Copy revokes review; target selection alone preserves it. Cleared targets prevent duplicate clicks, an old reference control cannot fill a copied row, and review/apply write no author file. Ordinary Save changes only the behavior source while preserving all nine original binding byte ranges and BOM/CRLF.');

  await call('Page.reload'); await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'Studio reload');
  await evaluate(`window.__copyState=(await import('/web/modules/app-state.js')).appState`); await openDocument(levelRecord); await open(); assert.equal(await bindingCount(), 11);
  for (const [index, added] of newIds.entries()) { await fill('#sceneBehaviorsBinding', added, 'change'); assert.equal(await value('#sceneBehaviorsInstance'), removed[index].instanceId); assert.equal(await value(await rowValueSelector('player_instance_id')), playerId); assert.equal(await value(await rowValueSelector('kind')), 'collect'); }
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsDialog').dataset.dirty`), 'false'); await screenshot('copy-saved-reopened-desktop.png'); await close();
  assert.deepEqual(await authorTree(author), saved);
  const captured = await captureBuildSnapshot(author, assembly.id); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const plannedLevel = captured.plan.scenes.find(row => row.scene.objectId === levelScene.id); assert.ok(plannedLevel);
  assert.equal(plannedLevel.behaviors.bindings.length, 11);
  for (const added of newIds) assert.ok(plannedLevel.behaviors.bindings.some(row => row.bindingId === added && row.parameters.kind === 'collect'));
  const finalDirectory = path.join(output, 'author-final'); await fs.mkdir(finalDirectory);
  for (const name of Object.keys(saved)) { const file = path.join(finalDirectory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.copyFile(path.join(author, name), file); }
  assert.deepEqual(await authorTree(finalDirectory), saved, 'retained author workspace must match the saved UI bytes');
  report.plan = { ok: captured.ok, snapshotId: captured.snapshotId, targetId: assembly.id, sceneCount: captured.plan.scenes.length, bindingCount: plannedLevel.behaviors.bindings.length };
  report.saved = { sourcePath: levelPath, originalBindingIds: level.bindings.map(row => row.bindingId), newBindingIds: newIds,
    targetInstanceIds: removed.map(row => row.instanceId), preservedBindingBytes: Object.fromEntries(Object.entries(initialBindingBytes).map(([id, text]) => [id, hash(text)])), bomCrlf: true, reopened: true };
  report.authorFinal = { path: finalDirectory, hashes: saved, registeredDocuments: registry.documents.length, registeredAssets: registry.assets.length };
  report.steps.push('Reload and reopen the saved manifest: both new identities and explicit crystal targets survive, the four-scene assembly has a valid eleven-binding level, and the retained author-final copy exactly matches all saved author files for independent native gameplay verification.');
  report.authorBefore = initial; report.authorAfter = await authorTree(author); assert.deepEqual(report.authorAfter, saved);
  report.sampleAfter = await authorTree(source); assert.deepEqual(report.sampleAfter, report.sampleBefore, 'canonical sample changed during browser run');
  report.sourcesAfter = await sourceHashes(); assert.deepEqual(report.sourcesAfter, report.sourcesBefore); assert.equal(hash(await fs.readFile(fileURLToPath(import.meta.url))), report.driverSha256);
  assert.equal(Object.keys(report.layout).length, 9); assert.deepEqual(report.errors, []); report.ok = true;
} catch (error) { report.ok = false; report.failure = error.stack; process.exitCode = 1; console.error(error); try { await captureFailure?.(); } catch (failure) { report.captureFailure = failure.message; } }
finally {
  socket?.close(); for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ ok: report.ok, output, screenshots: report.screenshots.length, steps: report.steps, failure: report.failure }, null, 2));
}
