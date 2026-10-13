// Real browser authoring, ordinary save, Godot execution and generated-project delivery.
// Only temporary copied author files and a new evidence directory are written.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.env.VIENTO_BEHAVIOR_AUTHORING_OUTPUT || path.join(os.tmpdir(), `viento-behavior-authoring-browser-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome with local HTTP editor and a trusted Godot binary. No installed Tauri window, native picker, Android or other desktop OS claim.',
  'Existing registered behavior example is copied. This test does not create upstream OC/projection/scene dependencies through their editors.',
  'Godot executes headless logic. No rendering, Bevy author behavior, hot reload, LSP or standalone game export is claimed.'
] };
const sources = ['web/modules/app-scene-behaviors.js', 'web/scene-behaviors.css', 'web/modules/app-behavior-source.js', 'web/modules/app-runtime.js',
  'web/modules/app-studio-system.js', 'engine/scene-behaviors.mjs', 'engine/json-source.mjs', 'engine/scene-behaviors-edit.mjs', 'engine/scene-behavior-authoring-contract.mjs',
  'scripts/lib/scene-behavior-authoring-service.mjs', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/scene-behavior-authoring-smoke.mjs'];
report.sources = Object.fromEntries(await Promise.all(sources.map(async name => [name, buildHash(await fs.readFile(path.join(appRoot, name)))])));
report.node = { version: process.version, sha256: buildHash(await fs.readFile(process.execPath)) };
report.tool = { sha256: buildHash(await fs.readFile(tool)) };
const cleanups = [], fixture = { after: callback => cleanups.push(callback) };
const wait = async (check, label, budget = 45000) => { for (let elapsed = 0; elapsed < budget; elapsed += 100) { if (await check()) return; await delay(100); } throw Error('Timed out: ' + label); };
async function authorTree(root) {
  const hashes = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name), name = path.relative(root, file);
    if (name === 'workspace.json' || /^(documents|templates|metadata|assets)\//.test(name)) hashes[name] = buildHash(await fs.readFile(file));
  }
  return hashes;
}
let socket, captureFailure;
try {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-behavior-authoring-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'author'), download = path.join(temporary, 'downloads');
  await fs.cp(path.join(appRoot, 'examples/scene-behaviors'), root, { recursive: true }); await fs.mkdir(download);
  const manifestPath = 'documents/behaviors/demo.json', manifestFile = path.join(root, manifestPath);
  const original = '\ufeff' + (await fs.readFile(manifestFile, 'utf8')).replaceAll('\n', '\r\n');
  await fs.writeFile(manifestFile, original);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root, VIENTO_GODOT_BIN: tool,
    VIENTO_EXECUTION_BACKEND: 'org.viento.godot4', XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  const rebuilt = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env }); assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
  const initial = await authorTree(root), base = await serve(fixture, appRoot, env), readSource = () => fs.readFile(manifestFile, 'utf8');
  const state = async () => { const response = await fetch(`${base}/api/project-build`).then(value => value.json()); return response.data || response; };
  const profile = path.join(temporary, 'chrome'); await fs.mkdir(profile);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; } });
  let port;
  await wait(async () => { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return Boolean(port); } catch { return false; } }, 'Chrome startup');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(value => value.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const pending = new Map(); let sequence = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.id) { const request = pending.get(value.id); pending.delete(value.id); value.error ? request?.reject(Error(value.error.message)) : request?.resolve(value.result); }
    else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
    else if (value.method === 'Page.javascriptDialogOpening') { report.dialogs.push({ type: value.params.type, message: value.params.message }); void call('Page.handleJavaScriptDialog', { accept: true }); }
  });
  const evaluate = async expression => {
    const value = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true, userGesture: true });
    if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value;
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value, event = 'input') => evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event(${JSON.stringify(event)}, {bubbles:true})); })()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === false && !document.querySelector(${JSON.stringify(selector)}).hidden`), selector + ' enabled');
  const screenshot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(image.data, 'base64')); report.screenshots.push(name); };
  const value = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
  const visible = content => content.replace(/\r\n?/g, '\n');
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,system:(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()})`); report.serviceFailure = await state(); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: download, eventsEnabled: true });
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor startup');
  await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.includes('behaviors/demo'))`), 'behavior source in sidebar');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('behaviors/demo')).click()`);
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.activePath.includes('behaviors/demo')`), 'selected behavior source');
  await enabled('#docEditBtn'); await click('#docEditBtn'); await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`), 'source edit');
  await enabled('#docEditSourceModeBtn'); await click('#docEditSourceModeBtn'); await enabled('#sceneBehaviorsBtn');
  assert.equal(await value('#docSourceEditor'), visible(original));
  report.system = await evaluate(`(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()`);
  assert.ok(report.system.initializedModules.includes('org.viento.scene-behaviors'));
  const open = async () => { await enabled('#sceneBehaviorsBtn'); await click('#sceneBehaviorsBtn'); await wait(() => evaluate(`document.querySelector('#sceneBehaviorsDialog').open && !document.querySelector('#sceneBehaviorsFields').hidden && !document.querySelector('#sceneBehaviorsInstance').disabled`), 'behavior form'); };
  const check = async () => { await enabled('#sceneBehaviorsCheck'); await click('#sceneBehaviorsCheck'); await enabled('#sceneBehaviorsApply'); };
  const close = async () => { await click('#sceneBehaviorsCancel'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`), 'form closed'); };
  const edit = async () => { await fill('#sceneBehaviorsParam1Value', '65'); await fill('#sceneBehaviorsEvent0Name', 'authoring_checkpoint'); };
  await open(); await edit(); await check();
  const candidate = await evaluate(`document.querySelector('#sceneBehaviorsAfter').textContent`), parsed = JSON.parse(candidate.replace(/^\ufeff/, ''));
  assert.equal(parsed.bindings[0].parameters.amount, 65); assert.equal(parsed.bindings[0].events[0].event, 'authoring_checkpoint');
  assert.equal(parsed.bindings[1].parameters.amount, 20); assert.equal(parsed.bindings[1].events[0].event, 'checkpoint');
  assert.equal(candidate, original.replace('"amount": 40', '"amount": 65').replace('"event": "checkpoint"', '"event": "authoring_checkpoint"'));
  assert.equal(await readSource(), original); assert.equal(await value('#docSourceEditor'), visible(original));
  await screenshot('behavior-review-desktop.png');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  for (const language of ['zh-CN', 'en', 'ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('.scene-behaviors-body').scrollTop=0`);
    const layout = await evaluate(`(() => { const d=document.querySelector('#sceneBehaviorsDialog'),rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};return {noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,close:rect('#sceneBehaviorsClose'),check:rect('#sceneBehaviorsCheck'),apply:rect('#sceneBehaviorsApply'),title:document.querySelector('#sceneBehaviorsTitle').textContent,bodyScrollable:document.querySelector('.scene-behaviors-body').scrollHeight>document.querySelector('.scene-behaviors-body').clientHeight};})()`);
    assert.equal(layout.noHorizontalOverflow, true); assert.equal(layout.bodyScrollable, true);
    for (const action of ['close', 'check', 'apply']) assert.ok(layout[action].top >= 0 && layout[action].bottom <= 844 && layout[action].left >= 0 && layout[action].right <= 390, JSON.stringify(layout));
    assert.equal(await value('#sceneBehaviorsParam1Value'), '65'); assert.equal(await value('#sceneBehaviorsEvent0Name'), 'authoring_checkpoint');
    assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsAfter').textContent`), candidate); assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsApply').disabled`), false);
    report.layout[language] = layout; await screenshot(`behavior-review-${language}-390.png`);
  }
  await close(); assert.equal(await readSource(), original); assert.equal(await value('#docSourceEditor'), visible(original));
  report.steps.push('Registered behavior JSON opens the independent editor; typed amount and signal alias are reviewed with exact BOM/CRLF source, then Cancel changes neither draft nor disk. Three languages at 390px retain approval, have no horizontal overflow, and keep Return/Check/Apply visible while the body scrolls.');
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await open(); await fill('#sceneBehaviorsParam1Value', '1e-');
  await fill('#sceneBehaviorsBinding', parsed.bindings[1].bindingId, 'change'); await fill('#sceneBehaviorsBinding', parsed.bindings[0].bindingId, 'change');
  assert.equal(await value('#sceneBehaviorsParam1Value'), '1e-'); await click('#sceneBehaviorsCheck');
  await wait(() => evaluate(`!document.querySelector('#sceneBehaviorsCheck').disabled`), 'invalid number retained'); assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsApply').disabled`), true);
  await close(); assert.equal(await readSource(), original);
  report.steps.push('An unfinished numeric parameter survives switching bindings and a failed check in the actual browser. Cancel still leaves author bytes untouched.');
  await open(); await edit(); await check(); await click('#sceneBehaviorsApply');
  await wait(() => evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`), 'review applied to source draft');
  assert.equal(await value('#docSourceEditor'), visible(candidate)); assert.equal(await readSource(), original);
  assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`), true);
  await enabled('#docSaveBtn'); await click('#docSaveBtn'); await wait(async () => await readSource() === candidate, 'ordinary save');
  await wait(() => evaluate(`!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges && !document.querySelector('#sceneBehaviorsBtn').disabled`), 'ordinary save refresh');
  const after = await authorTree(root); assert.deepEqual(after, { ...initial, [manifestPath]: buildHash(Buffer.from(candidate)) });
  report.saved = { beforeSha256: buildHash(Buffer.from(original)), afterSha256: buildHash(Buffer.from(candidate)), onlyChangedAuthorPath: manifestPath };
  await open(); assert.equal(await value('#sceneBehaviorsParam1Value'), '65'); await close();
  report.steps.push('Apply changes only the current unsaved draft; ordinary editor Save writes the exact reviewed bytes. Reopening reads 65. Every other author document, registration, template and asset remains byte-identical.');
  await click('#projectBuildBtn'); await enabled('#projectBuildPlan');
  async function perform(selector, kind) {
    const previous = (await state()).job?.id; await enabled(selector); await click(selector); let job;
    await wait(async () => { job = (await state()).job; return job?.kind === kind && job.id !== previous && job.status !== 'running'; }, kind, 90000);
    report.jobs.push(job); assert.equal(job.status, 'succeeded', JSON.stringify(job)); return job;
  }
  const planned = await perform('#projectBuildPlan', 'plan'); assert.equal(planned.plan.behaviorBindingCount, 2); assert.equal(planned.plan.behaviorSourceCount, 1);
  const built = await perform('#projectBuildGenerate', 'build'), ran = await perform('#projectBuildHeadless', 'run');
  const events = ran.events.filter(event => event.event === 'behavior'); assert.equal(events.length, 2);
  const first = events.find(event => event.bindingId === parsed.bindings[0].bindingId), second = events.find(event => event.bindingId === parsed.bindings[1].bindingId);
  assert.equal(first.name, 'authoring_checkpoint'); assert.deepEqual(first.arguments, ['east', 65]); assert.equal(first.instanceId, parsed.bindings[0].instanceId);
  assert.equal(second.name, 'checkpoint'); assert.deepEqual(second.arguments, ['west', 20]); assert.equal(second.instanceId, parsed.bindings[1].instanceId);
  report.behaviorEvents = events; await screenshot('behavior-godot-events.png');
  report.steps.push('The saved authoring change drives a real Godot plan → build → headless run: first binding emits authoring_checkpoint with east/65, while the second still emits checkpoint with west/20.');
  await evaluate(`(() => { window.__deliveryReceipts=[]; const original=window.fetch.bind(window); window.fetch=async(input,init)=>{const response=await original(input,init);let body;try{body=JSON.parse(init?.body||'null')}catch{};if(body?.kind==='backend-project'){const result=await response.clone().json();window.__deliveryReceipts.push(result.data||result)}return response;}; })()`);
  await enabled('#backendProjectInspect'); await click('#backendProjectInspect'); await enabled('#backendProjectDeliver'); await click('#backendProjectDeliver');
  await enabled('#backendDeliveryPrepare'); await click('#backendDeliveryPrepare'); await enabled('#backendDeliveryDownload');
  const receipt = await evaluate(`window.__deliveryReceipts.at(-1)`); assert.equal(receipt.delivery.project.buildId, built.buildId);
  await click('#backendDeliveryDownload'); await wait(() => evaluate(`!document.querySelector('#backendDeliveryDownload').disabled`), 'download started'); await click('#backendDeliveryClose');
  const archive = path.join(download, receipt.fileName); await wait(async () => { try { return (await fs.stat(archive)).size === receipt.bytes; } catch { return false; } }, 'browser ZIP saved');
  const verified = await verifyBackendProjectDelivery(archive), extraction = path.join(temporary, 'delivered'); await fs.mkdir(extraction);
  const unzip = await runCommand('unzip', ['-q', archive, '-d', extraction], { cwd: temporary }); assert.equal(unzip.code, 0, JSON.stringify(unzip));
  const p = receipt.delivery.project;
  assert.ok(p.files.some(file => file.path.endsWith('.gd'))); assert.ok(p.resources.length > 0);
  const imported = await runCommand(tool, ['--headless', '--editor', '--path', path.join(extraction, 'project'), '--import', '--quit'], { cwd: temporary, env });
  assert.equal(imported.code, 0, JSON.stringify(imported)); assert.doesNotMatch(imported.stdout + imported.stderr, /SCRIPT ERROR|Parse Error/);
  report.delivery = { fileName: receipt.fileName, bytes: receipt.bytes, sha256: buildHash(await fs.readFile(archive)), fileCount: verified.fileCount,
    assetCount: verified.assetCount, buildId: p.buildId, projectKind: p.project.kind, godotImport: { code: imported.code, stdout: imported.stdout, stderr: imported.stderr } };
  assert.deepEqual(await authorTree(root), after); assert.deepEqual(report.errors, []);
  report.steps.push('The resulting generated project is inspected, delivered through a real browser download, independently verified and extracted, then imported by real Godot at a new location. Scripts and image resources are present; no further author writes occur.');
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  try { await captureFailure?.(); } catch (failure) { report.captureFailure = failure.message; }
} finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, output, steps: report.steps, failure: report.failure }, null, 2));
}
