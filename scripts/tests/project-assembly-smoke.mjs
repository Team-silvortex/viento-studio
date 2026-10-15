// Actual Chrome authoring -> multi-scene Godot project -> relocated engineering ZIP.
// Every author mutation is confined to a disposable copy of the Scene2D example.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
const app = fileURLToPath(new URL('../../', import.meta.url)), tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted Godot executable.');
const output = path.resolve(process.env.VIENTO_ASSEMBLY_OUTPUT || path.join(app, 'docs/test-results/project-assembly', `browser-${Date.now()}`));
if (!output.startsWith(path.join(app, 'docs/test-results/project-assembly') + path.sep)) throw Error('Use a new project-assembly evidence directory.');
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw Error('Evidence must be fresh.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome with local HTTP editor and native Godot; installed Tauri, Android and other desktop systems were not exercised.',
  'Two registered saved scenes are prepared in a disposable copy; scene creation and upstream OC projection are outside this workflow.',
  'Runs only the chosen startup scene. Scene switching and standalone executable export are not implemented by this increment.'
] }, cleanups = [], t = { after: fn => cleanups.push(fn) };
const first = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', second = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const changed = [...new Set(execFileSync('git', ['ls-files', '--modified', '--others', '--exclude-standard'], { cwd: app, encoding: 'utf8' }).trim().split('\n'))]
  .filter(name => /^(engine|scripts|web)\//.test(name) && /\.(mjs|js|css|gd)$/.test(name));
report.sources = Object.fromEntries(await Promise.all(changed.map(async name => [name, buildHash(await fs.readFile(path.join(app, name)))])));
report.node = { version: process.version, sha256: buildHash(await fs.readFile(process.execPath)) };
report.tool = { sha256: buildHash(await fs.readFile(tool)) };

const json = value => JSON.stringify(value, null, 2) + '\n';
const wait = async (fn, label, timeout = 60000) => { for (let elapsed = 0; elapsed < timeout; elapsed += 100) { if (await fn()) return; await delay(100); } throw Error('Timed out: ' + label); };
async function authorHashes(root) { const entries = {}; for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) { const file = path.join(entry.parentPath, entry.name), name = path.relative(root, file); if (!name.startsWith('.viento/')) entries[name] = buildHash(await fs.readFile(file)); } return entries; }
let socket, failureCapture;
try {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-project-assembly-browser-')); cleanups.push(() => fs.rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temp, 'author'), downloads = path.join(temp, 'downloads'); await fs.mkdir(downloads);
  await fs.cp(path.join(app, 'examples/scene2d'), root, { recursive: true });
  const scene = JSON.parse(await fs.readFile(path.join(root, 'documents/scenes/demo.json')));
  scene.schemaVersion = 2; scene.title = 'Second room'; scene.background = '#334455'; scene.actors[0].position = [111, 222]; scene.actors[0].instanceId = '12121212-1212-4212-8212-121212121212';
  await fs.writeFile(path.join(root, 'documents/scenes/second.json'), json(scene));
  const record = JSON.parse(await fs.readFile(path.join(root, `metadata/documents/${first}.json`))); record.id = second; record.sourcePath = 'documents/scenes/second.json';
  await fs.writeFile(path.join(root, `metadata/documents/${second}.json`), json(record));
  const env = { ...process.env, VIENTO_APP_ROOT: app, VIENTO_WORKSPACE_ROOT: root, VIENTO_GODOT_BIN: tool, VIENTO_EXECUTION_BACKEND: 'org.viento.godot4', XDG_CACHE_HOME: path.join(temp, 'cache'), XDG_CONFIG_HOME: path.join(temp, 'config') };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  const rebuilt = await runCommand(process.execPath, [path.join(app, 'scripts/ops/rebuild.mjs')], { cwd: app, env }); assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
  const initial = await authorHashes(root), base = await serve(t, app, env);
  const state = async () => { const value = await fetch(base + '/api/project-build').then(r => r.json()); return value.data || value; };
  const complete = async (kind, previous) => { let job; await wait(async () => { job = (await state()).job; return job?.kind === kind && job.id !== previous && job.status !== 'running'; }, kind + ' completion'); report.jobs.push(job); assert.equal(job.status, 'succeeded', JSON.stringify(job.diagnostics)); return job; };
  const profile = path.join(temp, 'chrome'); await fs.mkdir(profile);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--window-size=1440,1100', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; } });
  let port; await wait(async () => { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return !!port; } catch { return false; } }, 'Chrome');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()); socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const pending = new Map(); let sequence = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.id) { const request = pending.get(value.id); pending.delete(value.id); value.error ? request?.reject(Error(value.error.message)) : request?.resolve(value.result); } else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails); else if (value.method === 'Page.javascriptDialogOpening') { report.dialogs.push(value.params.message); void call('Page.handleJavaScriptDialog', { accept: true }); } });
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression: `(async()=>(${expression}))()`, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value, event = 'input') => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.matches(':disabled')===false&&!document.querySelector(${JSON.stringify(selector)}).hidden`), selector);
  const screenshot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(image.data, 'base64')); report.screenshots.push(name); };
  failureCapture = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate('document.body.innerText'); report.serviceFailure = await state(); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await call('Page.navigate', { url: base + '/web/?mode=edit' });
  await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor');
  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildAssembly'); await click('#projectBuildAssembly'); await enabled('#projectAssemblyName');
  const draft = async () => { await fill('#projectAssemblyName', 'Two-room work'); await fill('#projectAssemblyPath', 'documents/game.json'); for (const id of [first, second]) { await fill('#projectAssemblyCandidate', id, 'change'); await click('#projectAssemblyAdd'); } await fill('#projectAssemblyEntry', second, 'change'); await click('#projectAssemblyCheck'); await enabled('#projectAssemblySave'); };
  await draft(); assert.deepEqual(await authorHashes(root), initial); await screenshot('assembly-review-desktop.png');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  for (const language of ['zh-CN', 'en', 'ja']) { await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`); const view = await evaluate(`(()=>{const d=document.querySelector('#projectAssemblyDialog');return{title:document.querySelector('#projectAssemblyTitle').textContent,overflow:d.scrollWidth>d.clientWidth||document.documentElement.scrollWidth>innerWidth,buttons:['Close','Cancel','Save','Check'].map(name=>{const r=document.querySelector('#projectAssembly'+name).getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right};})};})()`); assert.equal(view.overflow, false); for (const button of view.buttons) assert.ok(button.top >= 0 && button.bottom <= 844 && button.left >= 0 && button.right <= 390, JSON.stringify(view)); report.layout[language] = view; await screenshot(`assembly-${language}-390.png`); }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await click('#projectAssemblyCancel'); assert.equal(await evaluate(`document.querySelector('#projectAssemblyDialog').open`), false); assert.deepEqual(await authorHashes(root), initial);
  report.steps.push('Three-language review at desktop and 390px, explicit cancellation, and review-only paths leave all author bytes unchanged.');
  await click('#projectBuildAssembly'); await enabled('#projectAssemblyName'); await draft(); await click('#projectAssemblySave');
  await wait(() => evaluate(`document.querySelector('#projectAssemblyStatus').textContent.includes('组装已保存')&&!document.querySelector('#projectAssemblyClose').disabled`), 'assembly save');
  const saved = await authorHashes(root), newFiles = Object.keys(saved).filter(name => !Object.hasOwn(initial, name)); assert.equal(newFiles.length, 2); for (const [name, hash] of Object.entries(initial)) assert.equal(saved[name], hash);
  const assemblyId = newFiles.find(name => name.startsWith('metadata/documents/')).split('/').at(-1).slice(0, -5);
  report.author = { assemblyId, added: newFiles, content: JSON.parse(await fs.readFile(path.join(root, 'documents/game.json'))) };
  assert.deepEqual(report.author.content.sceneIds, [first, second]); assert.equal(report.author.content.entrySceneId, second);
  await click('#projectAssemblyClose'); await enabled('#projectBuildPlan'); assert.equal(await evaluate(`document.querySelector('#projectBuildScene').value`), assemblyId);
  for (const selector of ['#projectBuildSceneAudio', '#projectBuildCreateBehavior', '#projectBuildControl', '#projectBuildCaseRun']) assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).hidden`), true, selector);
  await click('#projectBuildPlan'); const plan = await complete('plan'); assert.equal(plan.plan.sceneCount, 2); assert.equal(plan.plan.resourceCount, 1);
  await enabled('#projectBuildGenerate'); await click('#projectBuildGenerate'); const built = await complete('build', plan.id);
  await enabled('#projectBuildHeadless'); await click('#projectBuildHeadless'); const ran = await complete('run', built.id); assert.equal(ran.runtime.sceneObjectId, second);
  await wait(() => evaluate(`!document.querySelector('#projectBuildRuntimeObjects').hidden&&document.querySelectorAll('#projectBuildRuntimeObjectList li').length===1`), 'startup scene object view');
  assert.equal(await evaluate(`document.querySelector('#projectBuildRuntimeObjectList li').dataset.instanceId`), '12121212-1212-4212-8212-121212121212');
  await wait(() => evaluate(`document.querySelector('#projectBuildStatus').textContent.includes('已完成')`), 'completed runtime panel');
  await evaluate(`document.querySelector('#projectBuildRuntimeObjects').scrollIntoView({block:'center'})`);
  await screenshot('assembly-entry-run.png');
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    await enabled('#projectBuildWindow'); await click('#projectBuildWindow'); let running;
    await wait(async () => { running = (await state()).job; if (running?.kind === 'run' && running.id !== ran.id && running.status !== 'running') throw Error('Window exited: ' + JSON.stringify(running)); return running?.id !== ran.id && running?.events.some(frame => frame.event === 'ready'); }, 'project window startup');
    assert.equal(running.runtime.sceneObjectId, second); await click('#projectBuildClose'); await delay(300);
    assert.equal((await state()).job.id, running.id); assert.equal((await state()).job.status, 'running');
    await click('#projectBuildBtn'); await enabled('#projectBuildCancel'); await screenshot('assembly-window-session.png'); await click('#projectBuildCancel');
    await wait(async () => (await state()).job.status !== 'running', 'owned window cancellation'); const cancelled = (await state()).job; assert.equal(cancelled.id, running.id); assert.equal(cancelled.status, 'cancelled');
    report.window = { status: cancelled.status, sceneObjectId: running.runtime.sceneObjectId, events: running.events,
      renderer: running.logs.match(/(?:OpenGL|Vulkan).*|Using Device:.*|Compatibility - Using Device:.*/g) || [] };
    report.steps.push('The chosen entry also reaches ready in a native Godot window; the task survives panel close/reopen and explicit cancellation stops the owned session.');
  } else report.limitations.push('No graphical display was available: window preview/cancellation was not exercised.');
  report.steps.push('The built-in editor saves exactly a declaration and registration; two scene versions produce one Godot project with one shared image and execute the chosen second scene.');
  await evaluate(`(()=>{window.__deliveries=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const response=await original(input,init);let body;try{body=JSON.parse(init?.body||'null')}catch{}if(body?.kind==='backend-project'){const value=await response.clone().json();window.__deliveries.push(value.data||value);}return response;};})()`);
  await enabled('#backendProjectInspect'); await click('#backendProjectInspect'); await enabled('#backendProjectDeliver'); await evaluate(`document.querySelector('#backendProjectSources').parentElement.scrollIntoView({block:'start'})`); await screenshot('assembly-project-inspection.png');
  await click('#backendProjectDeliver'); await enabled('#backendDeliveryPrepare'); await click('#backendDeliveryPrepare'); await enabled('#backendDeliveryDownload');
  const receipt = await evaluate('window.__deliveries.at(-1)'); assert.equal(receipt.delivery.project.source.assemblyId, assemblyId); await screenshot('assembly-delivery.png');
  await click('#backendDeliveryDownload'); const archive = path.join(downloads, receipt.fileName); await wait(async () => { try { return (await fs.stat(archive)).size === receipt.bytes; } catch { return false; } }, 'ZIP download');
  const verified = await verifyBackendProjectDelivery(archive), relocated = path.join(temp, 'relocated'); await fs.mkdir(relocated);
  const unzip = await runCommand('unzip', ['-q', archive, '-d', relocated], { cwd: temp }); assert.equal(unzip.code, 0);
  const project = path.join(relocated, 'project'), imported = await runCommand(tool, ['--headless', '--editor', '--path', project, '--import', '--quit'], { cwd: temp, env }); assert.equal(imported.code, 0); assert.doesNotMatch(imported.stdout + imported.stderr, /SCRIPT ERROR|Parse Error/);
  const run = await runCommand(tool, ['--headless', '--path', project, '--', '--viento-smoke'], { cwd: temp, env }); assert.equal(run.code, 0); assert.doesNotMatch(run.stdout + run.stderr, /SCRIPT ERROR|Parse Error/);
  const frames = run.stdout.split('\n').filter(line => line.startsWith('VIENTO_PROJECT:')).map(line => JSON.parse(line.slice('VIENTO_PROJECT:'.length))); assert.equal(frames.find(frame => frame.event === 'ready').entrySceneId, second); assert.deepEqual(frames.filter(frame => frame.event === 'scene-enter').map(frame => frame.sceneId), [second]);
  report.delivery = { bytes: receipt.bytes, sha256: buildHash(await fs.readFile(archive)), fileCount: verified.fileCount, assetCount: verified.assetCount, frames };
  assert.equal(verified.assetCount, 1); assert.deepEqual(await authorHashes(root), saved); assert.deepEqual(report.errors, []);
  report.steps.push('The visible multi-scene project is reviewed, downloaded, independently verified, extracted elsewhere and started by real Godot with the same entry scene.');
  for (const [name, expected] of Object.entries(report.sources)) assert.equal(buildHash(await fs.readFile(path.join(app, name))), expected, 'Source changed during smoke: ' + name);
  report.sourceSnapshotUnchanged = true; report.ok = true;
} catch (error) { report.ok = false; report.failure = error.stack; process.exitCode = 1; try { await failureCapture?.(); } catch (failure) { report.captureFailure = failure.message; } }
finally { socket?.close(); for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; } report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), json(report)); console.log(JSON.stringify({ ok: report.ok, output, failure: report.failure, steps: report.steps }, null, 2)); }
