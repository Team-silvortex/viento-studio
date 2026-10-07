// Chromium + real HTTP build service + real Godot, with disposable author data.
// Run: VIENTO_GODOT_BIN=/absolute/Godot node scripts/tests/scene-behavior-smoke.mjs [chromium]
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const godot = process.env.VIENTO_GODOT_BIN;
if (!godot || !path.isAbsolute(godot)) throw new Error('Set VIENTO_GODOT_BIN to an absolute Godot executable.');
const output = path.resolve(process.env.VIENTO_BEHAVIOR_TEST_OUTPUT || path.join(os.tmpdir(), `viento-scene-behavior-evidence-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_BEHAVIOR_TEST_OUTPUT directory; prior evidence is immutable.');
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], jobs: [], errors: [], limitations: [
  'Source editor served over real HTTP; packaged Tauri IPC and Android were not exercised.',
  'Headless checks validate behavior/runtime logic only. This test does not verify rendered frames.',
] };
let socket, captureFailure;
const wait = async (check, label, milliseconds = 45000) => {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) { if (await check()) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
};
async function sourceTree(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name), relative = path.relative(root, file);
    if (relative.startsWith('.viento/')) continue;
    result[relative] = buildHash(await fs.readFile(file));
  }
  return result;
}
try {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-behavior-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'workspace');
  await fs.cp(path.join(appRoot, 'examples/scene-behaviors'), root, { recursive: true });
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
    XDG_CACHE_HOME: path.join(temporary, 'cache'), VIENTO_GODOT_BIN: godot };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
  const before = await sourceTree(root);
  const manifestFile = path.join(root, 'documents/behaviors/demo.json'), scriptFile = path.join(root, 'documents/scripts/checkpoint.txt');
  const originalManifest = await fs.readFile(manifestFile, 'utf8'), originalScript = await fs.readFile(scriptFile, 'utf8');
  const base = await serve(t, appRoot, env);
  const state = async () => { const response = await fetch(`${base}/api/project-build`); assert.equal(response.status, 200); const body = await response.json(); return body.data || body; };
  const complete = async (kind, previousId) => {
    let value;
    await wait(async () => { value = (await state()).job; return value?.kind === kind && value.id !== previousId && value.status !== 'running'; }, `${kind} completion`, 90000);
    report.jobs.push(value); return value;
  };
  const profile = path.join(temporary, 'chrome'); await fs.mkdir(profile);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; } });
  let port;
  await wait(async () => { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return !!port; } catch { return false; } }, 'Chrome');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const pending = new Map(); let sequence = 0;
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.id) { const request = pending.get(value.id); pending.delete(value.id); value.error ? request?.reject(new Error(value.error.message)) : request?.resolve(value.result); }
    else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === false`), `${selector} enabled`);
  const screenshot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(image.data, 'base64')); };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({ text: document.body.innerText, source: document.querySelector('#docSourceEditor')?.value })`); report.serviceFailure = await state(); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable && document.querySelector('#projectBuildBtn')?.hidden === false`), 'build-capable editor');
  await click('#projectBuildBtn'); await enabled('#projectBuildPlan');
  const advertised = await state();
  assert.equal(advertised.backend.format, 'viento-execution-backend');
  assert.ok(advertised.backend.plans.some(plan => plan.schemaVersion === 3));
  assert.equal(advertised.scenes.length, 1);
  const bindingIds = ['99999999-9999-4999-8999-999999999991', '99999999-9999-4999-8999-999999999992'];
  const instanceIds = ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'];
  async function perform(button, kind) {
    const previous = (await state()).job?.id;
    await enabled(button); await click(button); return complete(kind, previous);
  }
  const planned = await perform('#projectBuildPlan', 'plan');
  assert.equal(planned.status, 'succeeded', JSON.stringify(planned));
  assert.equal(planned.plan.behaviorBindingCount, 2); assert.equal(planned.plan.behaviorSourceCount, 1);
  await wait(() => evaluate(`document.querySelector('#projectBuildBehaviorCounts').textContent.includes('2') && !document.querySelector('#projectBuildBehaviorCounts').hidden`), 'behavior plan counts');
  await screenshot('plan-zh.png');
  const built = await perform('#projectBuildGenerate', 'build'); assert.equal(built.status, 'succeeded', JSON.stringify(built));
  const ran = await perform('#projectBuildHeadless', 'run'); assert.equal(ran.status, 'succeeded', JSON.stringify(ran));
  const events = ran.events.filter(event => event.event === 'behavior'); assert.equal(events.length, 2);
  for (const index of [0, 1]) {
    const event = events.find(event => event.bindingId === bindingIds[index]); assert.ok(event);
    assert.equal(event.instanceId, instanceIds[index]); assert.equal(event.objectId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.equal(event.name, 'checkpoint'); assert.deepEqual(event.arguments, index ? ['west', 20] : ['east', 40]);
  }
  await wait(() => evaluate(`document.querySelector('#projectBuildBehaviorEventList').children.length === 2`), 'readable independent behavior events');
  report.behaviorEvents = events;
  report.steps.push('Real browser plan → Godot build → headless run: two instances of one GDScript emit independent east/40 and west/20 scalar events.');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  report.labels = {};
  for (const [language, name] of [['zh-CN', 'zh'], ['en', 'en'], ['ja', 'ja']]) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('#projectBuildBehaviorEvents').scrollIntoView({block:'center'})`);
    await screenshot(`events-390-${name}.png`);
    const result = await evaluate(`({title:document.querySelector('#projectBuildBehaviorEventsTitle').textContent, events:document.querySelector('#projectBuildBehaviorEventList').textContent, overflow:document.querySelector('#projectBuildDialog').scrollWidth>document.querySelector('#projectBuildDialog').clientWidth})`);
    assert.equal(result.overflow, false, name); assert.ok(result.events.includes('east') && result.events.includes('west'));
    if (name === 'en') assert.ok(result.title.includes('Behavior')); if (name === 'ja') assert.ok(result.title.includes('動作'));
    report.labels[name] = result;
  }
  report.steps.push('Chinese, English and Japanese behavior events fit the 390px workbench without horizontal overflow.');

  const invalidManifest = JSON.parse(originalManifest); invalidManifest.bindings[0].parameters.amount = 'invalid float';
  await fs.writeFile(manifestFile, JSON.stringify(invalidManifest, null, 2) + '\n');
  const parameterPlan = await perform('#projectBuildPlan', 'plan');
  assert.equal(parameterPlan.status, 'succeeded', 'Portable plan accepts scalar data; Godot validates exported property types.');
  const parameterBuild = await perform('#projectBuildGenerate', 'build');
  assert.equal(parameterBuild.status, 'succeeded', 'Godot compiles the script before runtime parameter reflection.');
  const parameterRun = await perform('#projectBuildHeadless', 'run');
  assert.equal(parameterRun.status, 'failed', JSON.stringify(parameterRun));
  const parameterDiagnostic = parameterRun.diagnostics.find(item => item.bindingId === bindingIds[0]
    && item.sourcePath === 'documents/behaviors/demo.json' && item.propertyPath === '/bindings/0/parameters/amount');
  assert.ok(parameterDiagnostic, JSON.stringify(parameterRun.diagnostics));
  assert.ok(parameterDiagnostic.code.startsWith('runtime_behavior_'));
  assert.equal(parameterDiagnostic.code, 'runtime_behavior_parameter');
  assert.equal(parameterDiagnostic.objectId, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  assert.equal(parameterDiagnostic.sourceRevision, `sha256:${buildHash(await fs.readFile(manifestFile))}`);
  await wait(() => evaluate(`Array.from(document.querySelectorAll('#projectBuildDiagnostics button')).some(button=>button.textContent.includes('/bindings/0/parameters/amount'))`), 'manifest parameter diagnostic link');
  await evaluate(`document.querySelector('#projectBuildDiagnostics').scrollIntoView({block:'center'})`);
  await screenshot('parameter-diagnostic-390-ja.png');
  await evaluate(`Array.from(document.querySelectorAll('#projectBuildDiagnostics button')).find(button=>button.textContent.includes('/bindings/0/parameters/amount')).click()`);
  await wait(() => evaluate(`!document.querySelector('#projectBuildDialog').open && (await import('/web/modules/app-state.js')).appState.activePath.includes('behaviors/demo')`), 'manifest diagnostic source');
  report.parameterNavigation = await evaluate(`({path:(await import('/web/modules/app-state.js')).appState.activePath,selected:document.querySelector('#docSourceEditor').value.slice(document.querySelector('#docSourceEditor').selectionStart,document.querySelector('#docSourceEditor').selectionEnd)})`);
  assert.ok(report.parameterNavigation.selected.includes('invalid float'));
  await fs.writeFile(manifestFile, originalManifest);
  if (await evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`)) await click('#docEditBtn');
  report.steps.push('Godot export type mismatch reports the exact manifest binding parameter and source navigation selects its original invalid value.');

  const invalidScript = 'extends Node\n\nfunc _ready( -> void:\n\tpass\n';
  await fs.writeFile(scriptFile, invalidScript);
  await click('#projectBuildBtn');
  const scriptPlan = await perform('#projectBuildPlan', 'plan'); assert.equal(scriptPlan.status, 'succeeded', JSON.stringify(scriptPlan));
  const scriptBuild = await perform('#projectBuildGenerate', 'build'); assert.equal(scriptBuild.status, 'failed', JSON.stringify(scriptBuild));
  const scriptDiagnostic = scriptBuild.diagnostics.find(item => item.sourcePath === 'documents/scripts/checkpoint.txt');
  assert.ok(scriptDiagnostic, JSON.stringify(scriptBuild.diagnostics));
  assert.equal(scriptDiagnostic.code, 'godot_error');
  assert.equal(scriptDiagnostic.objectId, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
  assert.equal(scriptDiagnostic.sourceRevision, `sha256:${buildHash(invalidScript)}`);
  assert.equal(scriptDiagnostic.sourceLine, 3);
  assert.equal(scriptDiagnostic.sourceRange?.exact, true);
  await wait(() => evaluate(`Array.from(document.querySelectorAll('#projectBuildDiagnostics button')).some(button=>button.textContent.includes('scripts/checkpoint.txt'))`), 'script source diagnostic link');
  await evaluate(`document.querySelector('#projectBuildDiagnostics').scrollIntoView({block:'center'})`);
  await screenshot('script-diagnostic-390-ja.png');
  await evaluate(`Array.from(document.querySelectorAll('#projectBuildDiagnostics button')).find(button=>button.textContent.includes('scripts/checkpoint.txt')).click()`);
  await wait(() => evaluate(`!document.querySelector('#projectBuildDialog').open && (await import('/web/modules/app-state.js')).appState.activePath.includes('scripts/checkpoint')`), 'TXT compile diagnostic source');
  report.scriptNavigation = await evaluate(`({path:(await import('/web/modules/app-state.js')).appState.activePath,source:document.querySelector('#docSourceEditor').value,selected:document.querySelector('#docSourceEditor').value.slice(document.querySelector('#docSourceEditor').selectionStart,document.querySelector('#docSourceEditor').selectionEnd)})`);
  assert.equal(report.scriptNavigation.source, invalidScript);
  assert.ok(report.scriptNavigation.selected.includes('func _ready('));
  assert.ok(report.scriptNavigation.selected.length < invalidScript.length);
  await fs.writeFile(scriptFile, originalScript);
  report.steps.push('A real GDScript parser failure navigates to its registered TXT author source, retaining the raw compiler diagnostics.');

  if (!await evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`)) await click('#docEditBtn');
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing && !document.querySelector('#docSourceEditor').readOnly`), 'script source editor');
  await click('#docEditSourceModeBtn');
  const draft = originalScript + '\n# unsaved / 未保存 / 下書き\n';
  await evaluate(`(() => {const input=document.querySelector('#docSourceEditor');input.value=${JSON.stringify(draft)};input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(9,9);})()`);
  const beforeDraftJob = (await state()).job.id;
  await click('#projectBuildBtn');
  await wait(() => evaluate(`document.querySelector('#projectBuildDialog').open && !document.querySelector('#projectBuildDraft').hidden && !document.querySelector('#projectBuildRefresh').disabled`), 'dirty script guard');
  for (const selector of ['#projectBuildPlan', '#projectBuildGenerate', '#projectBuildHeadless', '#projectBuildWindow']) assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).disabled`), true);
  await evaluate(`document.querySelector('#projectBuildDraft').scrollIntoView({block:'center'})`);
  await screenshot('script-draft-guard-390-ja.png');
  await click('#projectBuildHeadless'); await delay(200); assert.equal((await state()).job.id, beforeDraftJob);
  await click('#projectBuildClose');
  assert.deepEqual(await evaluate(`({value:document.querySelector('#docSourceEditor').value,caret:document.querySelector('#docSourceEditor').selectionStart,dirty:(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges})`), { value: draft, caret: 9, dirty: true });
  assert.deepEqual(await sourceTree(root), before);
  report.steps.push('An unsaved script draft blocks plan/build/all run modes and survives closing the workbench with its text and caret intact; restored author files are byte identical.');
  assert.deepEqual(report.errors, []); report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  try { await captureFailure?.(); } catch (captureError) { report.captureFailure = captureError.message; }
} finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, steps: report.steps, limitations: report.limitations, failure: report.failure, output }, null, 2));
}
