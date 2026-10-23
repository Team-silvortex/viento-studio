// Actual browser parameter-interface repair and real Godot receipts, in a disposable workspace.
// Only disposable author workspaces and a new evidence directory are written.
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
import { projectEventAnimationAuthor } from './helpers/project-event-animation-author-fixture.mjs';
import { generateEditableGodotAnimationStateScript as generateGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';

const table = {initialState:'idle',states:[{key:'idle'},{key:'strike'},{key:'walk'}],transitions:[
  {from:'idle',to:'strike',trigger:{kind:'event',name:'action'}},
  {from:'strike',to:'idle',trigger:{kind:'completed'}},
  {from:'idle',to:'walk',trigger:{kind:'event',name:'move'}},
  {from:'walk',to:'idle',trigger:{kind:'event',name:'stop'}},
  {from:'walk',to:'strike',trigger:{kind:'event',name:'action'}},
]};

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/animation-parameter-bindings');
const output = path.resolve(process.env.VIENTO_ANIMATION_PARAMETER_OUTPUT || path.join(evidenceRoot, `browser-authoring-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/animation-parameter-bindings.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: { behavior: {} }, limitations: [
  'Actual Chrome with local HTTP editor and a trusted Godot binary. No installed Tauri window, native picker, Android or other desktop OS claim.',
  'A disposable fixture prepares scenes, clips and a controller whose saved state table has already renamed attack to strike. GUI coverage starts at repair of its old behavior parameters, not initial scene/script creation.',
  'Real Chrome/HTTP and native Godot headless receipts are tested; no installed Tauri window, Android, native rendering or delivered game execution claim.'
] };
const sources = ['engine/script-parameter-interface.mjs', 'engine/script-parameter-discovery.mjs', 'engine/animation-state-script-source.mjs', 'engine/godot-animation-state-script.mjs', 'engine/scene-behaviors-edit.mjs', 'scripts/lib/scene-behavior-authoring-service.mjs', 'web/modules/app-scene-behavior-parameters.js', 'web/modules/app-scene-behaviors.js', 'web/modules/app-behavior-source.js', 'web/scene-behaviors.css', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/scene-behavior-parameters-smoke.mjs', 'engine/studio-core.wasm'];
report.sources = Object.fromEntries(await Promise.all(sources.map(async name => [name, buildHash(await fs.readFile(path.join(appRoot, name)))])));
report.node = { version: process.version, sha256: buildHash(await fs.readFile(process.execPath)) };
report.tool = { sha256: buildHash(await fs.readFile(tool)) };
const cleanups = [], fixture = { after: callback => cleanups.push(callback) };
const wait = async (check, label, budget = 45000) => { for (const deadline = Date.now() + budget; Date.now() < deadline;) { if (await check()) return; await delay(100); } throw Error('Timed out: ' + label); };
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-script-authoring-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const authorFixture = await projectEventAnimationAuthor(fixture);
  const root = authorFixture.author, download = path.join(temporary, 'downloads'); await fs.mkdir(download);
  const assemblyId = authorFixture.assemblyId;
  const attackId = authorFixture.clipIds[0][1], idleId = authorFixture.clipIds[0][0];
  await authorFixture.edit('documents/animations/scene-0.json', document => { document.clips[1].endSeconds = .75; });
  const generated = generateGodotAnimationStateScript(table);
  await authorFixture.script('checkpoint', generated.content);
  await authorFixture.configure({clip_idle:idleId,clip_attack:attackId});
  await authorFixture.script('publisher', `extends Node\nfunc _ready() -> void:\n\tcall_deferred("publish")\nfunc publish() -> void:\n\tget_meta("viento_project").publish_event("action", true)\n`);
  const manifestPath = 'documents/behaviors/demo.json', manifestFile = path.join(root, manifestPath);
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
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,system:(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()})`); report.serviceFailure = await state(); report.editorFailure = await evaluate(`(()=>import('/web/modules/app-state.js').then(({appState:s})=>({isSaving:s.isSaving,isRebuilding:s.isRebuilding,isMutatingWorld:s.isMutatingWorld,dirty:s.editHasUnsavedChanges,creating:s.isCreating,planDisabled:document.querySelector('#projectBuildPlan')?.disabled,behaviorDisabled:document.querySelector('#sceneBehaviorsBtn')?.disabled})))()`); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: download, eventsEnabled: true });
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor startup');
  await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.includes('scenes/demo'))`), 'saved scene in sidebar');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scenes/demo')).click()`);
  const beforeManifest=await readSource();
  const originalModel=JSON.parse(beforeManifest), controller=originalModel.bindings.find(row=>Object.hasOwn(row.parameters,'clip_attack'));
  assert.ok(controller); const bindingId=controller.bindingId;
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.endsWith('/'+${JSON.stringify(manifestPath)})).click()`);
  await wait(()=>evaluate(`document.querySelector('#docSourceEditor').value===${JSON.stringify(beforeManifest)}`),'saved behavior source');
  await enabled('#docEditBtn');await click('#docEditBtn');await enabled('#sceneBehaviorsBtn');
  const openBehavior=async()=>{await click('#sceneBehaviorsBtn');await enabled('#sceneBehaviorsAddParameter');await fill('#sceneBehaviorsBinding',bindingId,'change');};
  await openBehavior();
  await wait(()=>evaluate(`document.querySelector('#sceneBehaviorsParameterInterface').dataset.status==='ready'`),'ready saved script interface');
  const rows=()=>evaluate(`Array.from(document.querySelectorAll('#sceneBehaviorsParameters>.scene-behaviors-parameter')).map(e=>({name:e.querySelector('input').value,type:e.querySelector('select').value,value:e.querySelector('textarea')?.value}))`);
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsCheck').disabled`),true);
  assert.match(await evaluate(`document.querySelector('#sceneBehaviorsParameterIssues').textContent`),/clip_strike/);
  assert.match(await evaluate(`document.querySelector('#sceneBehaviorsParameterIssues').textContent`),/clip_attack/);
  await screenshot('parameters-initial-desktop.png');
  // Filling defaults is an explicit local edit. Cancel must retain all saved data.
  await enabled('#sceneBehaviorsAddMissingParameters');await click('#sceneBehaviorsAddMissingParameters');
  assert.deepEqual((await rows()).map(row=>row.name),['clip_idle','clip_attack','clip_strike','clip_walk']);
  assert.equal((await rows())[2].value,'');assert.equal((await rows())[3].value,'');
  await click('#sceneBehaviorsCancel');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`),'cancel defaults');
  assert.equal(await value('#docSourceEditor'),beforeManifest);assert.deepEqual(await authorTree(root),initial);
  report.steps.push('Saved renamed state-table interface identifies missing and undeclared parameters. Explicit default filling preserves old values; cancelling leaves both editor and author tree untouched.');
  await openBehavior();await enabled('#sceneBehaviorsParam1ContractTarget');
  await fill('#sceneBehaviorsParam1ContractTarget','clip_strike','change');
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsCheck').disabled`),true,'target choice alone is not an edit');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']){
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('#sceneBehaviorsParameterInterface').scrollIntoView({block:'start'})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneBehaviorsDialog'),rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};return {fits:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,close:rect('#sceneBehaviorsClose'),check:rect('#sceneBehaviorsCheck'),cancel:rect('#sceneBehaviorsCancel')};})()`);
    assert.equal(layout.fits,true);for(const name of ['close','check','cancel'])assert.ok(layout[name].left>=0&&layout[name].right<=390&&layout[name].top>=0&&layout[name].bottom<=844,JSON.stringify(layout));
    assert.equal(await value('#sceneBehaviorsParam1ContractTarget'),'clip_strike');
    await screenshot(`parameters-interface-${language}-390.png`);
    await evaluate(`document.querySelector('#sceneBehaviorsParam1RenameParameter').scrollIntoView({block:'center'})`);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('#sceneBehaviorsParameters input,#sceneBehaviorsParameters select,#sceneBehaviorsParameters textarea')).every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})`),true);
    await screenshot(`parameters-rename-${language}-390.png`);report.layout.behavior[language]=layout;
  }
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await enabled('#sceneBehaviorsParam1RenameParameter');await click('#sceneBehaviorsParam1RenameParameter');
  assert.deepEqual(await rows(),[{name:'clip_idle',type:'string',value:idleId},{name:'clip_strike',type:'string',value:attackId}]);
  await enabled('#sceneBehaviorsAddMissingParameters');await click('#sceneBehaviorsAddMissingParameters');
  assert.deepEqual((await rows()).map(row=>row.name),['clip_idle','clip_strike','clip_walk']);
  assert.equal((await rows())[2].value,'');
  await enabled('#sceneBehaviorsLoadAnimationClips');await click('#sceneBehaviorsLoadAnimationClips');
  await enabled('#sceneBehaviorsParam2AnimationClip');await fill('#sceneBehaviorsParam2AnimationClip',idleId,'change');
  await enabled('#sceneBehaviorsParam2UseAnimationClip');await click('#sceneBehaviorsParam2UseAnimationClip');
  assert.equal((await rows())[2].value,idleId);
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsParameterIssues').children.length`),0);
  await enabled('#sceneBehaviorsCheck');await click('#sceneBehaviorsCheck');await enabled('#sceneBehaviorsApply');
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsBefore').textContent`),beforeManifest);
  const afterReview=await evaluate(`document.querySelector('#sceneBehaviorsAfter').textContent`);
  const reviewedModel=JSON.parse(afterReview);assert.equal(reviewedModel.bindings.find(row=>row.bindingId===bindingId).parameters.clip_strike,attackId);
  assert.deepEqual(reviewedModel.bindings.filter(row=>row.bindingId!==bindingId),originalModel.bindings.filter(row=>row.bindingId!==bindingId));
  await evaluate(`document.querySelector('#sceneBehaviorsReview').scrollIntoView({block:'start'})`);await screenshot('parameters-review-desktop.png');
  assert.deepEqual(await authorTree(root),initial);
  await click('#sceneBehaviorsApply');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorsDialog').open&&document.querySelector('#docSourceEditor').value===${JSON.stringify(afterReview)}`),'apply parameter draft');
  report.steps.push('Three-language 390px interface and rename controls preserve the selected target. Explicit rename retains the old clip UUID; missing-slot fill and the existing clip picker compose in one binding, followed by full-source review and an unsaved draft.');
  assert.deepEqual(await authorTree(root), initial);
  const changedModel=JSON.parse(await value('#docSourceEditor'));
  const changedBinding=changedModel.bindings.find(row=>row.bindingId===bindingId);
  assert.equal(changedBinding.parameters.clip_strike,attackId);assert.equal(changedBinding.parameters.clip_idle,idleId);
  assert.equal(Object.hasOwn(changedBinding.parameters,'clip_attack'),false);
  const expectedModel=structuredClone(originalModel);expectedModel.bindings.find(row=>row.bindingId===bindingId).parameters=changedBinding.parameters;
  assert.deepEqual(changedModel,expectedModel);
  await enabled('#docSaveBtn');await click('#docSaveBtn');
  await wait(async()=>JSON.parse(await readSource()).bindings.find(row=>row.bindingId===bindingId).parameters.clip_strike===attackId,'ordinary Save');
  await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.isSaving&&!(await import('/web/modules/app-state.js')).appState.isRebuilding&&!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`),'saved baseline');
  const afterScript=await authorTree(root);
  assert.deepEqual(Object.keys(afterScript).filter(name=>afterScript[name]!==initial[name]),[manifestPath]);
  report.authorChange={sourcePath:manifestPath,bindingId,changedAuthorPaths:[manifestPath],parameters:changedBinding.parameters};
  await screenshot('parameters-saved-source.png');
  report.steps.push('Explicit repair applies only to the current behavior draft. Ordinary Save changes only that manifest, preserving script source, other bindings, identities and registrations.');
  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildScene');
  await fill('#projectBuildScene', assemblyId, 'change'); await enabled('#projectBuildPlan');
  async function perform(selector, kind) {
    const previous = (await state()).job?.id; await enabled(selector); await click(selector); let job;
    await wait(async () => { job = (await state()).job; return job?.kind === kind && job.id !== previous && job.status !== 'running'; }, kind, 90000);
    report.jobs.push(job); assert.equal(job.status, 'succeeded', JSON.stringify(job.diagnostics)); return job;
  }
  await perform('#projectBuildPlan', 'plan'); await perform('#projectBuildGenerate', 'build');
  const ran = await perform('#projectBuildHeadless', 'run');
  const history = ran.runtime.project.animationCommands, completed = ran.runtime.project.animationCompletions;
  assert.equal(ran.runtime.project.protocolVersion, 7); assert.equal(history.sequence, 6); assert.equal(completed.sequence, 1);
  assert.deepEqual(history.entries.map(row => row.command.action), ['select', 'play', 'select', 'play', 'select', 'play']);
  assert.deepEqual(history.entries.map(row => row.state.clipId), [idleId, idleId, attackId, attackId, idleId, idleId]);
  assert.equal(completed.entries[0].state.clipId, attackId); assert.equal(completed.entries[0].state.phase, 'finished');
  assert.equal(completed.entries[0].commandSequence, 4); assert.equal(completed.entries[0].deliveries[0].status, 'handled');
  await wait(() => evaluate(`document.querySelector('#projectAnimationCompletionsSequence')?.dataset.sequence==='1'&&!document.querySelector('#projectAnimationCompletionsPanel').hidden`), 'actual animation completion');
  assert.equal(await evaluate(`document.querySelectorAll('#projectAnimationCompletionsEntries>li').length`), 1);
  assert.equal(await evaluate(`document.querySelectorAll('#projectAnimationCommandsEntries>li').length`), 6);
  for(const name of ['projectSharedStatePanel','projectEventTracePanel','projectAudioCommandsPanel']) assert.equal(await evaluate(`document.querySelector('#${name}').hidden`),false);
  await evaluate(`document.querySelector('#projectAnimationCompletionsPanel').scrollIntoView({block:'start'})`); await screenshot('completion-desktop.png');
  await fill('#projectAnimationCompletionsSearch', attackId);
  await call('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:false});
  report.layout.observation = {};
  for(const language of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('#projectAnimationCompletionsPanel').scrollIntoView({block:'start'})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#projectBuildDialog');return {noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,title:document.querySelector('#projectAnimationCompletionsTitle').textContent,search:document.querySelector('#projectAnimationCompletionsSearch').value,count:document.querySelectorAll('#projectAnimationCompletionsEntries>li:not([hidden])').length,text:document.querySelector('#projectAnimationCompletionsPanel').textContent};})()`);
    assert.equal(layout.noHorizontalOverflow,true,JSON.stringify(layout));assert.equal(layout.count,1);assert.equal(layout.search,attackId);
    report.layout.observation[language]=layout;await screenshot(`completion-${language}-390.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  report.runtime={jobId:ran.id,history,completed,protocolVersion:7,actualReceipts:true};
  report.steps.push('Real GUI planning, build and Godot run execute initial idle → event strike → one natural completion → looped idle using the exact behavior parameters repaired and saved in the GUI. Separate completion and command panels display actual frozen histories; three languages at390px retain search and have no horizontal overflow.');
  assert.deepEqual(await authorTree(root), afterScript); assert.deepEqual(report.errors, []);
  report.steps.push('Runtime execution and observation leave all author files unchanged after the deliberate behavior manifest save.');
  for (const [file, expected] of Object.entries(report.sources)) assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))), expected, `Source changed during smoke: ${file}`);
  report.sourceSnapshotUnchanged = true; report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  try { await captureFailure?.(); } catch (failure) { report.captureFailure = failure.message; }
} finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({cleanup:error.message}); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report,null,2) + '\n');
  console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));
}
