// Finite runtime control replay: Chromium + real HTTP + actual Bevy/Godot tools.
// Uses a disposable example copy and never writes installed preferences.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { serve, request } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const bevy = process.env.VIENTO_BEVY_BIN;
if (!bevy || !path.isAbsolute(bevy)) throw new Error('Set VIENTO_BEVY_BIN to the pinned absolute runtime executable.');
const output = path.resolve(process.env.VIENTO_CONTROL_TEST_OUTPUT || path.join(os.tmpdir(), `viento-control-replay-evidence-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_CONTROL_TEST_OUTPUT directory; prior evidence is immutable.');
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], jobs: [], errors: [], limitations: [
  'The browser uses a real local HTTP service. Packaged Tauri IPC and Android UI are not exercised.',
  'The Bevy runtime exercises real App/ECS logic with controlled smoke input. Rendering, hardware keyboard input and GPU execution are not tested or advertised.',
  'No author Rust behavior source is compiled or executed in this backend.',
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-control-replay-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'workspace');
  await fs.cp(path.join(appRoot, 'examples/bevy-headless'), root, { recursive: true });
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
    VIENTO_EXECUTION_BACKEND: 'org.viento.bevy', VIENTO_BEVY_BIN: bevy, XDG_CACHE_HOME: path.join(temporary, 'cache') };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
  const before = await sourceTree(root), originalScene = await fs.readFile(path.join(root, 'documents/scenes/demo.json'), 'utf8');
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
    if (value.id) { const pendingCall = pending.get(value.id); pending.delete(value.id); value.error ? pendingCall?.reject(new Error(value.error.message)) : pendingCall?.resolve(value.result); }
    else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === false`), `${selector} enabled`);
  const screenshot = async name => { const capture = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(capture.data, 'base64')); };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value})`); report.serviceFailure = await state(); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable && document.querySelector('#projectBuildBtn')?.hidden === false`), 'build-capable editor');
  await click('#projectBuildBtn'); await enabled('#projectBuildPlan');
  const advertised = await state();
  assert.equal(advertised.backend.id, 'org.viento.bevy'); assert.equal(advertised.backend.version, '0.3.0');
  assert.deepEqual(advertised.backend.capabilities, ['scene2d', 'input.arrows', 'state.movement', 'runtime.control-replay', 'runtime.control-replay.instances']);
  assert.deepEqual(advertised.backend.execution, { build: true, headlessLogic: true, windowPreview: false, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false });
  assert.equal(advertised.scenes.length, 1); assert.equal(advertised.available, true);
  report.backend = advertised.backend;
  async function perform(button, kind) {
    const previous = (await state()).job?.id; await enabled(button); await click(button); return complete(kind, previous);
  }
  const planned = await perform('#projectBuildPlan', 'plan');
  assert.equal(planned.status, 'succeeded', JSON.stringify(planned)); assert.equal(planned.plan.actorCount, 2); assert.equal(planned.plan.resourceCount, 0);
  await wait(() => evaluate(`!document.querySelector('#projectBuildPlanSummary').hidden && document.querySelector('#projectBuildPlanCounts').textContent.includes('2')`), 'two-instance plan summary');
  await screenshot('plan-zh.png');
  const built = await perform('#projectBuildGenerate', 'build'); assert.equal(built.status, 'succeeded', JSON.stringify(built));
  let ran = await perform('#projectBuildHeadless', 'run'); assert.equal(ran.status, 'succeeded', JSON.stringify(ran));
  assert.deepEqual(ran.events.map(item => item.event), ['ready', 'state', 'state', 'finished']);
  const finished = ran.events.at(-1); assert.equal(finished.fixedDelta, 0.25);
  assert.deepEqual(finished.actors.map(actor => ({instanceId:actor.instanceId,objectId:actor.objectId,position:actor.position,state:actor.state})), [
    {instanceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',objectId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',position:[240,220],state:'idle'},
    {instanceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',objectId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',position:[500,220],state:'idle'},
  ]);
  await wait(() => evaluate(`!document.querySelector('#projectBuildEvents').hidden && document.querySelector('#projectBuildEvents').textContent.includes('4')`), 'runtime event summary');
  assert.equal(ran.runtime.phase, 'finished');
  assert.equal(ran.runtime.protocolVersion, 2);
  assert.deepEqual(ran.runtime.actors.map(actor=>actor.position), [[240,220],[500,220]]);
  assert.ok(ran.runtime.actors.every(actor=>actor.positionCurrent && actor.positionSample==='finished'));
  await wait(() => evaluate(`!document.querySelector('#projectBuildRuntimeObjects').hidden && document.querySelectorAll('#projectBuildRuntimeObjectList .build-runtime-object').length === 2`), 'two observed runtime objects');
  const inspect = await request(base, '/api/project-build', {action:'inspect', jobId:ran.id, instanceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'});
  assert.equal(inspect.status,200); assert.equal(inspect.data.actors.length,1);
  assert.equal(inspect.data.jobId,ran.id); assert.equal(inspect.data.buildId,ran.buildId);
  assert.deepEqual(inspect.data.actors[0].position,[240,220]);
  let definition = await request(base, '/api/project-build', {action:'inspect',jobId:ran.id,objectId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
  assert.equal(definition.status,200);assert.equal(definition.data.actors.length,2);
  const unchangedJob=JSON.stringify((await state()).job);
  for(const extra of [{entityId:42},{sourcePath:'/tmp/forged'},{tool:bevy},{backendId:'org.viento.godot4'}]) {
    const rejected=await request(base,'/api/project-build',{action:'inspect',jobId:ran.id,...extra});
    assert.equal(rejected.status,400);assert.equal(rejected.payload.errorCode,'build_request_invalid');
  }
  assert.equal(JSON.stringify((await state()).job),unchangedJob);
  const foreign=await request(base,'/api/project-build',{action:'inspect',jobId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'});
  assert.equal(foreign.status,404);
  report.inspection={instance:inspect.data,definition:definition.data,rejectedOverrides:true,foreignJobStatus:foreign.status};
  await evaluate(`(() => {const input=document.querySelector('#projectBuildRuntimeSearch');input.value='bbbbbbbbbb1';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(4,4)})()`);
  await wait(() => evaluate(`document.querySelectorAll('#projectBuildRuntimeObjectList .build-runtime-object').length===1`), 'instance filter');
  assert.equal(await evaluate(`document.querySelector('#projectBuildRuntimeObjectList .build-runtime-object').dataset.instanceId`),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
  await click('#projectBuildRefresh');
  await wait(() => evaluate(`!document.querySelector('#projectBuildRefresh').disabled`),'refreshed inspected job');
  assert.equal(await evaluate(`document.querySelector('#projectBuildRuntimeSearch').value`),'bbbbbbbbbb1');
  await evaluate(`(() => {const input=document.querySelector('#projectBuildRuntimeSearch');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  report.steps.push('The runtime object panel shows two independent instances from real Bevy ECS. Stable instance and definition queries are read-only; unknown host/path/Entity fields and foreign jobs are rejected, and polling preserves the local filter.');
  const release={left:false,right:false,up:false,down:false};
  const controlProgram={format:'viento-runtime-control',schemaVersion:1,fixedDelta:0.125,steps:[{...release,right:true},release,{...release,left:true},release]};
  const controlText=JSON.stringify(controlProgram,null,2);
  const setControlText=async value=>evaluate(`(() => {const input=document.querySelector('#projectBuildControlProgram');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(23,23);})()`);
  await evaluate(`document.querySelector('#projectBuildControlEditor').open=true`);
  const beforeBadControl=(await state()).job.id;
  await setControlText('{invalid JSON'); await click('#projectBuildControl');
  await wait(()=>evaluate(`!document.querySelector('#projectBuildControlError').hidden`),'local malformed program feedback');
  assert.equal((await state()).job.id,beforeBadControl);
  await setControlText(controlText);
  await click('#projectBuildRefresh');
  await wait(()=>evaluate(`!document.querySelector('#projectBuildRefresh').disabled`),'control editor refresh');
  assert.deepEqual(await evaluate(`({value:document.querySelector('#projectBuildControlProgram').value,caret:document.querySelector('#projectBuildControlProgram').selectionStart})`),{value:controlText,caret:23});
  const controlled=await perform('#projectBuildControl','run');
  assert.equal(controlled.status,'succeeded',JSON.stringify(controlled));
  assert.deepEqual(controlled.control.program,controlProgram);
  assert.equal(controlled.control.samples.length,4);
  assert.deepEqual(controlled.control.samples.map(sample=>sample.stepIndex),[0,1,2,3]);
  assert.deepEqual(controlled.control.samples.map(sample=>sample.actors[0].position),[[220,220],[220,220],[200,220],[200,220]]);
  assert.deepEqual(controlled.control.samples.map(sample=>sample.actors[0].state),['moving','idle','moving','idle']);
  assert.ok(controlled.control.samples.every(sample=>sample.actors[1].position[0]===500&&sample.actors[1].state==='idle'));
  assert.deepEqual(controlled.runtime.control,{stepCount:4,completedSteps:4,fixedDelta:0.125});
  const beforeHTTPBad=(await state()).job.id;
  for(const payload of [{controlProgram:{...controlProgram,tool:bevy}},{controlProgram,mode:'window'}]) {
    const rejected=await request(base,'/api/project-build',{action:'run',buildId:controlled.buildId,mode:'headless',...payload});
    assert.ok([400,422].includes(rejected.status));assert.equal((await state()).job.id,beforeHTTPBad);
  }
  ran=controlled;
  definition=await request(base,'/api/project-build',{action:'inspect',jobId:ran.id,objectId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
  assert.equal(definition.status,200);assert.deepEqual(definition.data.control,ran.runtime.control);
  report.control={program:controlProgram,sha256:controlled.control.sha256,samples:controlled.control.samples,inspection:definition.data,localMalformedJSONStartsNoJob:true,httpInvalidOrWindowStartsNoJob:true};
  await wait(()=>evaluate(`document.querySelector('#projectBuildRuntimePhase').textContent.includes('4 / 4') || document.querySelector('#projectBuildRuntimePhase').textContent.includes('4/4')`),'completed control steps');
  report.steps.push('The separate control action replays four real engine steps. Positions/states are sampled after each step; malformed local JSON and invalid/window HTTP controls start no job. Program text and caret survive refresh.');
  report.events = ran.events;
  report.steps.push('The real browser checks the saved plan, builds a data-only Bevy artifact, and runs a real App/ECS smoke step. Control replay retains distinct identities and returns the controlled instance to [200,220], while the other stays at [500,220].');
  assert.equal(await evaluate(`document.querySelector('#projectBuildWindow').disabled`), true);
  const previousJob = (await state()).job.id;
  await click('#projectBuildWindow'); await delay(200); assert.equal((await state()).job.id, previousJob);
  const latestBuild = (await state()).latestBuild;
  const denied = await request(base, '/api/project-build', { action: 'run', buildId: latestBuild.id, mode: 'window' });
  assert.equal(denied.status, 422); assert.equal(denied.payload.errorCode, 'build_execution_unsupported'); assert.equal((await state()).job.id, previousJob);
  report.windowRejection = denied;
  report.steps.push('The unsupported window action stays disabled. A manually submitted HTTP window request is independently rejected with 422 before starting a job.');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  report.labels = {};
  for (const [language, name] of [['zh-CN', 'zh'], ['en', 'en'], ['ja', 'ja']]) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.deepEqual(await evaluate(`({value:document.querySelector('#projectBuildControlProgram').value,caret:document.querySelector('#projectBuildControlProgram').selectionStart})`),{value:controlText,caret:23});
    await evaluate(`document.querySelector('#projectBuildControlEditor').scrollIntoView({block:'start'})`);
    await screenshot(`control-editor-390-${name}.png`);
    await evaluate(`document.querySelector('#projectBuildRuntimeObjects').scrollIntoView({block:'start'})`);
    await screenshot(`control-runtime-390-${name}.png`);
    const value = await evaluate(`({backend:document.querySelector('#projectBuildBackend').textContent,capabilities:document.querySelector('#projectBuildCapabilities').textContent,
      objects:document.querySelector('#projectBuildRuntimeObjects').innerText,rows:document.querySelectorAll('#projectBuildRuntimeObjectList .build-runtime-object').length,events:document.querySelector('#projectBuildEvents').textContent,windowDisabled:document.querySelector('#projectBuildWindow').disabled,
      overflow:document.querySelector('#projectBuildDialog').scrollWidth>document.querySelector('#projectBuildDialog').clientWidth})`);
    assert.equal(value.rows,2);assert.ok(value.objects.includes('200') && value.objects.includes('500'));assert.equal(value.overflow, false, name); assert.equal(value.windowDisabled, true); assert.ok(value.backend.includes('Bevy'));
    if (name === 'en') assert.ok(value.capabilities.includes('Headless')); if (name === 'ja') assert.ok(value.capabilities.includes('ヘッドレス'));
    report.labels[name] = value;
  }
  report.steps.push('Chinese, English and Japanese show both runtime instances, translated states and explicit final-position sample labels at 390px without horizontal overflow. Window preview remains disabled.');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await click('#projectBuildRuntimeObjectList .build-runtime-source');
  await wait(() => evaluate(`!document.querySelector('#projectBuildDialog').open && (await import('/web/modules/app-state.js')).appState.activePath.includes('scenes/demo')`),'frozen instance declaration navigation');
  await click('#projectBuildBtn');
  await wait(() => evaluate(`!document.querySelector('#projectBuildRuntimeObjects').hidden && document.querySelectorAll('#projectBuildRuntimeObjectList .build-runtime-object').length===2`),'observed job preserved on reopen');
  report.steps.push('An observed instance source link opens its frozen scene declaration; reopening the workbench retains the same owned run and both instances.');
  await click('#projectBuildClose');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.includes('scenes/demo'))`), 'scene sidebar source');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scenes/demo')).click()`);
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.activePath.includes('scenes/demo')`), 'selected scene source');
  if (!await evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`)) await click('#docEditBtn');
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing && !document.querySelector('#docSourceEditor').readOnly`), 'scene source editing');
  await click('#docEditSourceModeBtn');
  const draft = originalScene + '\n\n';
  await evaluate(`(() => {const input=document.querySelector('#docSourceEditor');input.value=${JSON.stringify(draft)};input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(17,17);})()`);
  const beforeDraftJob = (await state()).job.id; await click('#projectBuildBtn');
  await wait(() => evaluate(`document.querySelector('#projectBuildDialog').open && !document.querySelector('#projectBuildDraft').hidden && !document.querySelector('#projectBuildRefresh').disabled`), 'dirty scene guard');
  assert.equal(await evaluate(`document.querySelector('#projectBuildRuntimeObjectList .build-runtime-source').disabled`),true);
  for (const selector of ['#projectBuildPlan', '#projectBuildGenerate', '#projectBuildHeadless', '#projectBuildWindow', '#projectBuildControl']) assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).disabled`), true);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('#projectBuildDraft').scrollIntoView({block:'center'})`); await screenshot('scene-draft-guard-390-ja.png');
  await click('#projectBuildHeadless'); await delay(200); assert.equal((await state()).job.id, beforeDraftJob);
  await click('#projectBuildClose');
  assert.deepEqual(await evaluate(`({value:document.querySelector('#docSourceEditor').value,caret:document.querySelector('#docSourceEditor').selectionStart,
    dirty:(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges})`), { value: draft, caret: 17, dirty: true });
  const after = await sourceTree(root); assert.deepEqual(after, before); report.sourceProof = { before, after, unchanged: true };
  report.steps.push('An unsaved scene-source draft blocks checks, builds and runs. Closing the workbench preserves draft text and caret, and every author file remains byte identical.');
  const defaultRoot = path.join(temporary, 'default-workspace'); await fs.cp(path.join(appRoot, 'examples/bevy-headless'), defaultRoot, { recursive: true });
  const defaultEnv = { ...env, VIENTO_WORKSPACE_ROOT: defaultRoot, VIENTO_EXECUTION_BACKEND: undefined, VIENTO_BEVY_BIN: undefined };
  await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env: defaultEnv });
  const defaultBase = await serve(t, appRoot, defaultEnv), defaultState = await request(defaultBase, '/api/project-build');
  assert.equal(defaultState.status, 200); assert.equal(defaultState.data.backend.id, 'org.viento.godot4');
  const submitted = await request(defaultBase, '/api/project-build', { action: 'plan', sceneId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
  assert.equal(submitted.status, 200);
  let defaultFinal;
  await wait(async () => { defaultFinal = (await request(defaultBase, '/api/project-build')).data; return defaultFinal.job?.status !== 'running'; }, 'unconfigured default Godot plan');
  assert.equal(defaultFinal.job.status, 'succeeded'); assert.equal(defaultFinal.job.plan.actorCount, 2);
  const defaultPlanned=defaultFinal.job;
  const defaultBuildRequest=await request(defaultBase,'/api/project-build',{action:'build',sceneId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',expectedSnapshotId:defaultPlanned.plan.snapshotId});
  assert.equal(defaultBuildRequest.status,200);
  await wait(async()=>{defaultFinal=(await request(defaultBase,'/api/project-build')).data;return defaultFinal.job?.kind==='build' && defaultFinal.job.status!=='running'},'default Godot build',90000);
  assert.equal(defaultFinal.job.status,'succeeded',JSON.stringify(defaultFinal.job));
  const defaultBuild=defaultFinal.latestBuild;
  await request(defaultBase,'/api/project-build',{action:'run',buildId:defaultBuild.id,mode:'headless'});
  await wait(async()=>{defaultFinal=(await request(defaultBase,'/api/project-build')).data;return defaultFinal.job?.kind==='run' && defaultFinal.job.status!=='running'},'default Godot run',90000);
  assert.equal(defaultFinal.job.status,'succeeded',JSON.stringify(defaultFinal.job));
  assert.equal(defaultFinal.job.runtime.actors[0].position[0],240);
  await request(defaultBase,'/api/project-build',{action:'run',buildId:defaultBuild.id,mode:'headless',controlProgram});
  const previousDefaultJob=defaultFinal.job.id;
  await wait(async()=>{defaultFinal=(await request(defaultBase,'/api/project-build')).data;return defaultFinal.job?.id!==previousDefaultJob&&defaultFinal.job?.kind==='run'&&defaultFinal.job.status!=='running'},'default Godot control replay',90000);
  assert.equal(defaultFinal.job.status,'succeeded',JSON.stringify(defaultFinal.job));
  assert.deepEqual(defaultFinal.job.control,ran.control);
  assert.deepEqual(defaultFinal.job.runtime,ran.runtime);
  const godotQuery=await request(defaultBase,'/api/project-build',{action:'inspect',jobId:defaultFinal.job.id,objectId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
  assert.equal(godotQuery.status,200);assert.deepEqual(godotQuery.data.actors,definition.data.actors);
  report.defaultHost = { backend: defaultFinal.backend, plan:defaultPlanned,build:defaultBuild,job:defaultFinal.job,inspection:godotQuery.data };
  report.steps.push('A separate default Godot HTTP host builds and runs the same source, then replays the same control program, then returns the same runtime object view and definition query as the Bevy host.');
  assert.deepEqual(report.errors, []); report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  try { await captureFailure?.(); } catch (captureError) { report.captureFailure = captureError.message; }
} finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({cleanup:error.message}); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ok:report.ok,steps:report.steps,limitations:report.limitations,failure:report.failure,output}, null, 2));
}
