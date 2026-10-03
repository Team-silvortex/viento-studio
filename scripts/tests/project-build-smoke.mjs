// Chromium + real HTTP build service + real Godot, with disposable author data.
// Run: VIENTO_GODOT_BIN=/absolute/Godot node scripts/tests/project-build-smoke.mjs [chromium]
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
const output = path.resolve(process.env.VIENTO_BUILD_TEST_OUTPUT || path.join(appRoot, 'docs/test-results/build-workbench'));
await fs.mkdir(output, { recursive: true });
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], jobs: [], errors: [], limitations: [
  'Source editor served over real HTTP; packaged Tauri IPC and Android were not exercised.',
  'Headless checks validate runtime logic only. Window preview evidence is recorded separately.',
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-build-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'workspace');
  await fs.cp(path.join(appRoot, 'examples/scene2d'), root, { recursive: true });
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
    XDG_CACHE_HOME: path.join(temporary, 'cache'), VIENTO_GODOT_BIN: godot };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
  const before = await sourceTree(root);
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
  assert.equal(await evaluate(`document.querySelector('#projectBuildScene').options.length`), 1);
  await click('#projectBuildPlan');
  const planned = await complete('plan'); assert.equal(planned.status, 'succeeded', JSON.stringify(planned));
  await enabled('#projectBuildGenerate'); await screenshot('plan-zh.png');
  await click('#projectBuildGenerate');
  const built = await complete('build', planned.id); assert.equal(built.status, 'succeeded', JSON.stringify(built));
  await enabled('#projectBuildHeadless'); await click('#projectBuildHeadless');
  const ran = await complete('run', built.id); assert.equal(ran.status, 'succeeded', JSON.stringify(ran));
  assert.deepEqual(ran.events.map(event => event.event), ['ready', 'state', 'state', 'finished']);
  report.steps.push('Real browser plan → Godot build → headless runtime: ready, moving, idle, finished.');

  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    await enabled('#projectBuildWindow'); await click('#projectBuildWindow');
    let running;
    await wait(async () => { running = (await state()).job; if (running?.kind === 'run' && running.id !== ran.id && running.status !== 'running') throw new Error(`Window exited early: ${JSON.stringify(running)}`); return running?.id !== ran.id && running?.events.some(event => event.event === 'ready'); }, 'real window ready', 90000);
    await click('#projectBuildClose');
    assert.equal(await evaluate(`document.querySelector('#projectBuildDialog').open`), false);
    await delay(1200);
    assert.equal((await state()).job.id, running.id); assert.equal((await state()).job.status, 'running');
    await click('#projectBuildBtn'); await enabled('#projectBuildCancel');
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('en')`);
    await wait(() => evaluate(`document.querySelector('#projectBuildStatus').textContent.includes('Running') || document.querySelector('#projectBuildLogs').textContent.includes('"ready"')`), 'reopened active task');
    await screenshot('running-en.png');
    await click('#projectBuildCancel');
    const cancelled = await complete('run', ran.id); assert.equal(cancelled.id, running.id); assert.equal(cancelled.status, 'cancelled');
    report.window = { ok: true, jobId: running.id, renderer: running.logs.match(/(?:OpenGL|Vulkan).*|Using Device:.*|Compatibility - Using Device:.*/g) || [] };
    report.steps.push('Real graphical preview reaches ready; close/reopen panel retains the active task; Cancel stops the owned runtime.');
  } else report.limitations.push('No DISPLAY/WAYLAND_DISPLAY; graphical preview and cancellation after ready were not exercised.');

  await enabled('#projectBuildPlan');
  const sceneFile = path.join(root, 'documents/scenes/demo.json'), original = await fs.readFile(sceneFile, 'utf8');
  const invalid = JSON.parse(original); invalid.actors[0].speed = 'invalid speed'; await fs.writeFile(sceneFile, JSON.stringify(invalid, null, 2) + '\n');
  const lastId = (await state()).job.id;
  await click('#projectBuildPlan'); const rejected = await complete('plan', lastId);
  assert.equal(rejected.status, 'failed'); assert.ok(rejected.diagnostics.some(item => item.code === 'build_actor_value' && item.propertyPath === '/actors/0/speed'));
  await wait(() => evaluate(`document.querySelector('#projectBuildDiagnostics button') !== null`), 'diagnostic source link');
  await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('ja')`);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await screenshot('diagnostic-narrow-ja.png');
  assert.equal(await evaluate(`document.querySelector('#projectBuildDialog').scrollWidth <= document.querySelector('#projectBuildDialog').clientWidth`), true);
  report.labels = await evaluate(`({ title: document.querySelector('#projectBuildTitle').textContent, close: document.querySelector('#projectBuildClose').textContent, diagnostic: document.querySelector('#projectBuildDiagnostics').textContent })`);
  assert.ok(!report.labels.title.includes('构建'), 'Japanese title must be translated');
  await click('#projectBuildDiagnostics button');
  await wait(() => evaluate(`!document.querySelector('#projectBuildDialog').open && (await import('/web/modules/app-state.js')).appState.activePath.includes('scenes/demo')`), 'diagnostic opens scene document');
  await fs.writeFile(sceneFile, original);
  report.steps.push('Invalid actor speed reports source JSON pointer; Japanese 390px dialog fits; diagnostic opens scene source document.');

  await click('#docEditBtn');
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing && !document.querySelector('#docSourceEditor').readOnly`), 'source editing');
  await click('#docEditSourceModeBtn');
  const draft = original + '\n未保存 / unsaved / 下書き\n';
  await evaluate(`(() => { const input = document.querySelector('#docSourceEditor'); input.value = ${JSON.stringify(draft)}; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); input.setSelectionRange(7, 7); })()`);
  const beforeDraftJob = (await state()).job.id;
  await click('#projectBuildBtn');
  await wait(() => evaluate(`document.querySelector('#projectBuildDialog').open && !document.querySelector('#projectBuildDraft').hidden && document.querySelector('#projectBuildRefresh').disabled === false`), 'draft guard');
  for (const selector of ['#projectBuildPlan', '#projectBuildGenerate', '#projectBuildHeadless', '#projectBuildWindow']) assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).disabled`), true);
  await screenshot('draft-guard-narrow-ja.png');
  await click('#projectBuildGenerate'); await delay(200); assert.equal((await state()).job.id, beforeDraftJob);
  await click('#projectBuildClose');
  assert.deepEqual(await evaluate(`({value:document.querySelector('#docSourceEditor').value,caret:document.querySelector('#docSourceEditor').selectionStart,dirty:(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges})`), { value: draft, caret: 7, dirty: true });
  assert.deepEqual(await sourceTree(root), before);
  report.steps.push('Unsaved draft blocks planning/build/runs; returning preserves every character and caret; all authoring files remain unchanged.');
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
