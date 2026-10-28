import { projectFramesFromStdout } from './helpers/project-execution-frames-fixture.mjs';
// Actual Chrome shared state -> cross-scene observation -> relocated engineering ZIP.
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
import { projectSharedStateAuthor } from './helpers/project-shared-state-author-fixture.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';
import { verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
const app = fileURLToPath(new URL('../../', import.meta.url)), tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted Godot executable.');
const output = path.resolve(process.env.VIENTO_SHARED_STATE_OUTPUT || path.join(app, 'docs/test-results/project-shared-state', `browser-${Date.now()}`));
if (!output.startsWith(path.join(app, 'docs/test-results/project-shared-state') + path.sep)) throw Error('Use a new project-shared-state evidence directory.');
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw Error('Evidence must be fresh.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome with local HTTP editor and native Godot; installed Tauri, Android and other desktop systems were not exercised.',
  'Two registered saved scenes are prepared in a disposable copy; scene creation and upstream OC projection are outside this workflow.',
  'Exercises A to B to A with registered GDScript bindings; persistent save files, event subscriptions, hot reload and standalone executable export are outside this increment.'
] }, cleanups = [], t = { after: fn => cleanups.push(fn) };
let first, second, assemblyId;
const changed = [...new Set(execFileSync('git', ['ls-files', '--modified', '--others', '--exclude-standard'], { cwd: app, encoding: 'utf8' }).trim().split('\n'))]
  .filter(name => /^(engine|scripts|web)\//.test(name) && /\.(mjs|js|css|gd|html)$/.test(name));
report.sources = Object.fromEntries(await Promise.all(changed.map(async name => [name, buildHash(await fs.readFile(path.join(app, name)))])));
report.node = { version: process.version, sha256: buildHash(await fs.readFile(process.execPath)) };
report.tool = { sha256: buildHash(await fs.readFile(tool)) };

const json = value => JSON.stringify(value, null, 2) + '\n';
const wait = async (fn, label, timeout = 60000) => { for (let elapsed = 0; elapsed < timeout; elapsed += 100) { if (await fn()) return; await delay(100); } throw Error('Timed out: ' + label); };
async function authorHashes(root) { const entries = {}; for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) { const file = path.join(entry.parentPath, entry.name), name = path.relative(root, file); if (!name.startsWith('.viento/')) entries[name] = buildHash(await fs.readFile(file)); } return entries; }
let socket, failureCapture;
try {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-project-assembly-browser-')); cleanups.push(() => fs.rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const fixture = await projectSharedStateAuthor(t);
  const root = fixture.author, downloads = path.join(temp, 'downloads'); await fs.mkdir(downloads);
  [first, second] = fixture.sceneIds; assemblyId = fixture.assemblyId;
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
  await enabled('#scriptCreateBtn'); await click('#scriptCreateBtn'); await enabled('#scriptCreateStarter');
  await fill('#scriptCreateStarter', 'godot-project-state', 'change');
  assert.equal(await evaluate(`document.querySelector('#scriptCreateSource').textContent`), listScriptStarters().find(item => item.id === 'godot-project-state').content);
  await screenshot('shared-state-script-starter.png'); await click('#scriptCreateCancel'); assert.deepEqual(await authorHashes(root), initial);
  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildScene');
  await fill('#projectBuildScene', assemblyId, 'change'); await enabled('#projectBuildPlan');
  const saved = initial; report.author = { assemblyId, sceneIds: [first, second], unchanged: true };
  report.steps.push('The built-in shared-state starter is available, reviewed and cancelled without any author writes.');
  for (const selector of ['#projectBuildSceneAudio', '#projectBuildCreateBehavior', '#projectBuildControl', '#projectBuildCaseRun']) assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).hidden`), true, selector);
  await click('#projectBuildPlan'); const plan = await complete('plan'); assert.equal(plan.plan.sceneCount, 2); assert.equal(plan.plan.resourceCount, 2);
  await enabled('#projectBuildGenerate'); await click('#projectBuildGenerate'); const built = await complete('build', plan.id);
  await enabled('#projectBuildHeadless'); await click('#projectBuildHeadless'); const ran = await complete('run', built.id); assert.equal(ran.runtime.sceneObjectId, first); assert.deepEqual(ran.runtime.project.visits.map(row => row.sceneId), [first, second, first]); assert.deepEqual(ran.runtime.project.visits.map(row => row.index), [1, 2, 3]);
  const shared = ran.runtime.project.sharedState;
  assert.equal(ran.runtime.project.protocolVersion, 4); assert.equal(shared.revision, fixture.expectedRevision);
  assert.deepEqual(shared.entries.map(({key,value})=>({key,value})), fixture.expectedEntries);
  assert.equal(shared.lastChange.operation, 'delete'); assert.equal(shared.lastChange.key, 'key_found');
  assert.deepEqual(ran.events.filter(frame=>frame.event==='state').map(frame=>frame.revision), [1,2,3,4,5,6]);
  assert.equal(ran.events[0].stateRevision, 0);
  const inspectRequest = { action: 'inspect', jobId: ran.id, instanceId: ran.runtime.actors[0].instanceId };
  const queryPayload = await evaluate(`(await (await import('/web/modules/app-services.js')).fetchJsonApiRequest('/api/project-build', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(inspectRequest)})},15000,'Inspect current project instance')).payload`);
  const inspected = queryPayload.data || queryPayload;
  assert.equal(inspected.jobId, ran.id); assert.equal(inspected.sceneObjectId, first);
  assert.deepEqual(inspected.project, ran.runtime.project); assert.deepEqual(inspected.actors, [ran.runtime.actors[0]]);
  report.runtimeQuery = { jobId: inspected.jobId, sceneObjectId: inspected.sceneObjectId, visits: inspected.project.visits, selectedInstanceId: inspected.actors[0].instanceId };
  await wait(() => evaluate(`!document.querySelector('#projectBuildRuntimeObjects').hidden&&document.querySelectorAll('#projectBuildRuntimeObjectList li').length===2&&document.querySelectorAll('#projectBuildRuntimeVisits li').length===3`), 'current scene and three visits');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#projectBuildRuntimeVisits li')).map(row=>row.dataset.sceneId)`), [first,second,first]);
  await wait(() => evaluate(`document.querySelector('#projectBuildStatus').textContent.includes('已完成')`), 'completed runtime panel');
  await evaluate(`document.querySelector('#projectBuildRuntimeObjects').scrollIntoView({block:'center'})`);
  await wait(() => evaluate(`!document.querySelector('#projectSharedStatePanel').hidden&&document.querySelector('#projectSharedStateRevision').dataset.revision==='6'`), 'shared-state observation');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#projectSharedStateEntries > li')).map(row=>({key:row.dataset.key,value:JSON.parse(row.querySelector('.project-state-value').textContent)}))`), fixture.expectedEntries);
  assert.equal(await evaluate(`document.querySelector('#projectSharedStateLastChangeBody .project-state-record').dataset.key`), 'key_found');
  await evaluate(`document.querySelector('#projectSharedStatePanel').scrollIntoView({block:'start'})`);
  await screenshot('shared-state-objects-desktop.png');
  await fill('#projectSharedStateSearch', 'note');
  assert.equal(await evaluate(`document.querySelectorAll('#projectSharedStateEntries > li:not([hidden])').length`), 1);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  for (const language of ['zh-CN', 'en', 'ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('#projectSharedStatePanel').scrollIntoView({block:'start'})`);
    const view = await evaluate(`(()=>{const d=document.querySelector('#projectBuildDialog');return{overflow:d.scrollWidth>d.clientWidth||document.documentElement.scrollWidth>innerWidth,current:document.querySelector('#projectBuildRuntimeCurrentScene').textContent,visits:Array.from(document.querySelectorAll('#projectBuildRuntimeVisits li')).map(row=>({index:row.dataset.visitIndex,id:row.dataset.sceneId,text:row.textContent}))};})()`);
    assert.equal(view.overflow, false, JSON.stringify(view)); assert.deepEqual(view.visits.map(row=>row.id),[first,second,first]);
    report.layout[language] = view; await screenshot(`shared-state-${language}-390.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  report.steps.push('A-B-A shares a visit counter, key flag and Chinese/Japanese/emoji string; deletion remains traceable, and read-only filtering and state cards work in three languages at 390px.');
  await enabled('#projectBuildHeadless'); await click('#projectBuildHeadless');
  const repeated = await complete('run', ran.id); assert.deepEqual(repeated.runtime.project.sharedState, shared);
  assert.equal(repeated.events[0].stateRevision, 0);
  await wait(() => evaluate(`document.querySelector('#projectSharedStateRevision').dataset.revision==='6'&&document.querySelector('#projectSharedStateSearch').value===''`), 'new run resets state filter');
  report.sharedState = { final: shared, restarted: repeated.runtime.project.sharedState, restartsFromRevisionZero: true };
  report.steps.push('A second owned run starts from empty revision 0, clears the previous filter and reaches the same six mutations; no session state is restored from disk.');
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    await enabled('#projectBuildWindow'); await click('#projectBuildWindow'); let running;
    await wait(async () => { running = (await state()).job; if (running?.kind === 'run' && running.id !== repeated.id && running.status !== 'running') throw Error('Window exited: ' + JSON.stringify(running)); return running?.id !== repeated.id && running?.runtime?.project?.visits.length === 3 && running.runtime.project.visits.at(-1).phase === 'ready'; }, 'project window startup');
    assert.equal(running.runtime.sceneObjectId, first); await click('#projectBuildClose'); await delay(300);
    assert.equal((await state()).job.id, running.id); assert.equal((await state()).job.status, 'running');
    await click('#projectBuildBtn'); await enabled('#projectBuildCancel'); await screenshot('shared-state-window-session.png'); await click('#projectBuildCancel');
    await wait(async () => (await state()).job.status !== 'running', 'owned window cancellation'); const cancelled = (await state()).job; assert.equal(cancelled.id, running.id); assert.equal(cancelled.status, 'cancelled');
    report.window = { status: cancelled.status, sceneObjectId: running.runtime.sceneObjectId, events: running.events, project: running.runtime.project,
      renderer: running.logs.match(/(?:OpenGL|Vulkan).*|Using Device:.*|Compatibility - Using Device:.*/g) || [] };
    report.steps.push('The same A-B-A transition sequence also reaches ready in a native Godot window; the task survives panel close/reopen and explicit cancellation stops the owned session.');
  } else report.limitations.push('No graphical display was available: window preview/cancellation was not exercised.');

  await evaluate(`(()=>{window.__deliveries=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const response=await original(input,init);let body;try{body=JSON.parse(init?.body||'null')}catch{}if(body?.kind==='backend-project'){const value=await response.clone().json();window.__deliveries.push(value.data||value);}return response;};})()`);
  await enabled('#backendProjectInspect'); await click('#backendProjectInspect'); await enabled('#backendProjectDeliver'); await evaluate(`document.querySelector('#backendProjectSources').parentElement.scrollIntoView({block:'start'})`); await screenshot('shared-state-project-inspection.png');
  await click('#backendProjectDeliver'); await enabled('#backendDeliveryPrepare'); await click('#backendDeliveryPrepare'); await enabled('#backendDeliveryDownload');
  const receipt = await evaluate('window.__deliveries.at(-1)'); assert.equal(receipt.delivery.project.source.assemblyId, assemblyId); await screenshot('shared-state-delivery.png');
  await click('#backendDeliveryDownload'); const archive = path.join(downloads, receipt.fileName); await wait(async () => { try { return (await fs.stat(archive)).size === receipt.bytes; } catch { return false; } }, 'ZIP download');
  const verified = await verifyBackendProjectDelivery(archive), relocated = path.join(temp, 'relocated'); await fs.mkdir(relocated);
  const unzip = await runCommand('unzip', ['-q', archive, '-d', relocated], { cwd: temp }); assert.equal(unzip.code, 0);
  const project = path.join(relocated, 'project'), imported = await runCommand(tool, ['--headless', '--editor', '--path', project, '--import', '--quit'], { cwd: temp, env }); assert.equal(imported.code, 0); assert.doesNotMatch(imported.stdout + imported.stderr, /SCRIPT ERROR|Parse Error/);
  const run = await runCommand(tool, ['--headless', '--path', project, '--', '--viento-smoke'], { cwd: temp, env }); assert.equal(run.code, 0); assert.doesNotMatch(run.stdout + run.stderr, /SCRIPT ERROR|Parse Error/);
  const frames = projectFramesFromStdout(run.stdout); assert.deepEqual(frames.filter(frame=>frame.event==='scene-enter').map(frame=>frame.sceneId), [first, second, first]); assert.equal(frames.at(-1).event, 'finished');
  assert.equal(frames.at(-1).stateRevision, fixture.expectedRevision);
  assert.deepEqual(frames.filter(frame=>frame.event==='state'), ran.events.filter(frame=>frame.event==='state'));
  report.delivery = { bytes: receipt.bytes, sha256: buildHash(await fs.readFile(archive)), fileCount: verified.fileCount, assetCount: verified.assetCount, frames };
  assert.equal(verified.assetCount, 2); assert.deepEqual(await authorHashes(root), saved); assert.deepEqual(report.errors, []);
  report.steps.push('The visible multi-scene project is reviewed, downloaded, independently verified, extracted elsewhere and started by real Godot with the identical A-B-A visit sequence and identical shared-state mutations and audio shutdown between scenes.');
  await enabled('#backendDeliveryClose'); await click('#backendDeliveryClose');
  const navigationSource = (await state()).job.runtime.project.sharedState.lastChange.origin.source;
  const navigationText = await fs.readFile(path.join(root, navigationSource.sourcePath), 'utf8');
  await enabled('#projectSharedStateLastChangeBody .project-state-source');
  await click('#projectSharedStateLastChangeBody .project-state-source');
  await wait(() => evaluate(`!document.querySelector('#projectBuildDialog').open&&!(await import('/web/modules/app-state.js')).appState.isLoadingSource&&document.querySelector('#docSourceEditor').value===${JSON.stringify(navigationText)}`), 'shared-state last-change source navigation');
  const navigation = await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return {start:e.selectionStart,end:e.selectionEnd,selected:e.value.slice(e.selectionStart,e.selectionEnd),active:document.activeElement===e};})()`);
  if (navigationSource.sourceRange) {
    assert.equal(navigation.start, navigationSource.sourceRange.start); assert.equal(navigation.end, navigationSource.sourceRange.end);
    assert.ok(navigation.selected.length > 0);
  }
  assert.deepEqual(await authorHashes(root), saved);
  report.navigation = { source: navigationSource, ...navigation, authorUnchanged: true, exactRangeAvailable: Boolean(navigationSource.sourceRange) };
  await screenshot('shared-state-binding-source.png');
  report.steps.push('Clicking the last shared-state mutation opens the frozen behavior declaration without changing author files; text-range positioning is asserted only when the frozen source supplies a range.');
  for (const [name, expected] of Object.entries(report.sources)) assert.equal(buildHash(await fs.readFile(path.join(app, name))), expected, 'Source changed during smoke: ' + name);
  report.sourceSnapshotUnchanged = true; report.ok = true;
} catch (error) { report.ok = false; report.failure = error.stack; process.exitCode = 1; try { await failureCapture?.(); } catch (failure) { report.captureFailure = failure.message; } }
finally { socket?.close(); for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; } report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), json(report)); console.log(JSON.stringify({ ok: report.ok, output, failure: report.failure, steps: report.steps }, null, 2)); }
