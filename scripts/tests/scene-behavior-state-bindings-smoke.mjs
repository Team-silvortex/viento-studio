// Actual named state-to-clip binding in Chrome, ordinary Save, and real Godot completion receipts.
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

import '../adapters/node-studio-core.mjs';

const table = {initialState:'idle',states:[{key:'idle'},{key:'attack'}],transitions:[
  {from:'idle',to:'attack',trigger:{kind:'event',name:'action',condition:{combine:'all',conditions:[
    {type:'boolean',operator:'eq',value:true,selector:{kind:'projectState',key:'combat.enabled'}},
    {type:'number',operator:'gte',value:3}
  ]}}},
  {from:'attack',to:'idle',trigger:{kind:'completed'}},
]};

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/animation-state-bindings');
const output = path.resolve(process.env.VIENTO_ANIMATION_STATE_BINDINGS_OUTPUT || path.join(evidenceRoot, `browser-authoring-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/animation-state-bindings.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: { behavior: {} }, limitations: [
  'Actual Chrome with local HTTP editor and a trusted Godot binary. No installed Tauri window, native picker, Android or other desktop OS claim.',
  'A disposable fixture prepares scenes, two named clips, a saved strict v5 controller and its publisher. GUI coverage starts at state-to-clip selection; upstream scene, clip and script creation are not tested here.',
  'The UI writes only current binding parameters after explicit application, then ordinary review/draft/Save. Actual Godot entries/completion are independent runtime evidence; this is not a native visual gameplay or packaged-app test.'
] };
const sources = ['engine/animation-state-bindings.mjs','engine/scene-animation-directory.mjs','engine/animation-state-script-source.mjs','engine/godot-animation-state-script.mjs','engine/godot-animation-combinations-script.mjs',
  'engine/scene-behaviors-edit.mjs','scripts/lib/scene-behavior-authoring-service.mjs','web/modules/app-scene-behavior-state-bindings.js','web/modules/app-scene-behaviors.js','web/modules/app-behavior-source.js',
  'web/scene-behaviors.css','web/i18n/en.js','web/i18n/ja.js','scripts/backends/godot4-adapter.mjs','scripts/backends/godot4-project.mjs','engine/studio-core.wasm','scripts/tests/scene-behavior-state-bindings-smoke.mjs'];
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-state-bindings-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const authorFixture = await projectEventAnimationAuthor(fixture);
  const root = authorFixture.author, download = path.join(temporary, 'downloads'); await fs.mkdir(download);
  const assemblyId = authorFixture.assemblyId;
  const attackId = authorFixture.clipIds[0][1], idleId = authorFixture.clipIds[0][0];
  await authorFixture.edit('documents/animations/scene-0.json', document => { document.clips[0].name='待机 / Idle / 待機';document.clips[1].name='攻击 / Attack / 攻撃';document.clips[1].endSeconds=.75; });
  const generated = generateGodotAnimationStateScript(table);
  await authorFixture.script('checkpoint', generated.content);
  await authorFixture.configure({clip_idle:'',clip_attack:''});
  await authorFixture.script('publisher', `extends Node\nfunc _ready() -> void:\n\tcall_deferred("publish")\nfunc publish() -> void:\n\tvar project = get_meta("viento_project")\n\tproject.write_state("combat.enabled", true)\n\tproject.publish_event("action", 3)\n`);
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
  const originalModel=JSON.parse(beforeManifest), bindingId=authorFixture.receiverBindingId;
  const controller=originalModel.bindings.find(row=>row.bindingId===bindingId);
  assert.deepEqual(controller.parameters,{clip_idle:'',clip_attack:''});
  report.fixture={assemblyId,bindingId,scriptId:authorFixture.scriptId,idleId,attackId,table,generatedScriptSha256:buildHash(generated.content)};
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.endsWith('/'+${JSON.stringify(manifestPath)})).click()`);
  await wait(()=>evaluate(`document.querySelector('#docSourceEditor').value===${JSON.stringify(beforeManifest)}`),'saved behavior source');
  await enabled('#docEditBtn');await click('#docEditBtn');await enabled('#sceneBehaviorsBtn');
  const tools='#sceneBehaviorsStateBindingsTools',load='#sceneBehaviorsStateBindingsLoad',applyBindings='#sceneBehaviorsStateBindingsApply',resetBindings='#sceneBehaviorsStateBindingsReset';
  const picker=stateKey=>'#sceneBehaviorsStateBinding_'+stateKey;
  const rows=()=>evaluate(`Array.from(document.querySelectorAll('#sceneBehaviorsParameters>.scene-behaviors-parameter')).map(e=>({name:e.querySelector('input').value,type:e.querySelector('select').value,value:e.querySelector('textarea')?.value}))`);
  const parameterRows=[{name:'clip_idle',type:'string',value:''},{name:'clip_attack',type:'string',value:''}];
  const openBehavior=async()=>{await enabled('#sceneBehaviorsBtn');await click('#sceneBehaviorsBtn');await enabled('#sceneBehaviorsAddParameter');await fill('#sceneBehaviorsBinding',bindingId,'change');await enabled(load);};
  const loadBindings=async()=>{await enabled(load);await click(load);await wait(()=>evaluate(`document.querySelector('#sceneBehaviorsStateBindingsStatus').dataset.status==='ready'`),'ready state-to-clip catalog');await enabled(picker('idle'));await enabled(picker('attack'));};
  const selectBindings=async()=>{await fill(picker('idle'),idleId,'change');await fill(picker('attack'),attackId,'change');};
  await openBehavior();await loadBindings();
  const choices=await evaluate(`Object.fromEntries(['idle','attack'].map(key=>[key,Array.from(document.querySelector('#sceneBehaviorsStateBinding_'+key).options,o=>({value:o.value,text:o.textContent}))]))`);
  for(const choicesForState of Object.values(choices)){
    assert.ok(choicesForState.some(option=>option.value===idleId&&option.text.includes('Idle')));
    assert.ok(choicesForState.some(option=>option.value===attackId&&option.text.includes('Attack')));
    assert.ok(choicesForState.some(option=>option.value===''));
  }
  report.catalogOptions=choices;
  await selectBindings();
  assert.deepEqual(await rows(),parameterRows);assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsCheck').disabled`),true);
  await enabled(resetBindings);await click(resetBindings);
  assert.equal(await value(picker('idle')),'');assert.equal(await value(picker('attack')),'');
  assert.deepEqual(await rows(),parameterRows);
  await selectBindings();
  await evaluate(`document.querySelector('${tools}').scrollIntoView({block:'start'})`);await screenshot('state-bindings-selection-desktop.png');
  await click('#sceneBehaviorsCancel');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`),'cancel uncommitted clip selections');
  assert.equal(await value('#docSourceEditor'),beforeManifest);assert.deepEqual(await authorTree(root),initial);
  report.steps.push('The saved strict v5 state table exposes idle/attack clip slots. Named clip choices and Reset remain local; selecting and cancelling never changes parameter rows, source draft or any author file.');

  await openBehavior();await loadBindings();
  assert.equal(await value(picker('idle')),'');assert.equal(await value(picker('attack')),'');await selectBindings();
  await evaluate(`(()=>{window.__stateBindingSelect=document.querySelector('${picker('attack')}');window.__stateBindingSelect.focus();})()`);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']){
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('${tools}').scrollIntoView({block:'start'})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneBehaviorsDialog'),select=document.querySelector('${picker('attack')}'),rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};return {fits:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,same:select===window.__stateBindingSelect,focused:document.activeElement===select,value:select.value,title:document.querySelector('#sceneBehaviorsStateBindingsTitle').textContent,close:rect('#sceneBehaviorsClose'),check:rect('#sceneBehaviorsCheck'),cancel:rect('#sceneBehaviorsCancel')};})()`);
    assert.equal(layout.fits,true,JSON.stringify(layout));assert.equal(layout.same,true);assert.equal(layout.focused,true);assert.equal(layout.value,attackId);
    for(const name of ['close','check','cancel'])assert.ok(layout[name].left>=0&&layout[name].right<=390&&layout[name].top>=0&&layout[name].bottom<=844,JSON.stringify(layout));
    assert.equal(await value(picker('idle')),idleId);assert.deepEqual(await rows(),parameterRows);
    report.layout.behavior[language]=layout;await screenshot(`state-bindings-${language}-390.png`);
    await evaluate(`document.querySelector('${applyBindings}').scrollIntoView({block:'center'})`);
    const action=await evaluate(`(()=>{const b=document.querySelector('${applyBindings}'),r=b.getBoundingClientRect();return{reachable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b,text:b.textContent};})()`);
    assert.equal(action.reachable,true);report.layout.behavior[language].apply=action;
    await screenshot(`state-bindings-apply-${language}-390.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await enabled(applyBindings);await click(applyBindings);
  const expectedRows=[{name:'clip_idle',type:'string',value:idleId},{name:'clip_attack',type:'string',value:attackId}];
  await wait(async()=>JSON.stringify(await rows())===JSON.stringify(expectedRows),'explicit state binding parameter application');
  await enabled('#sceneBehaviorsCheck');
  assert.equal(await value('#docSourceEditor'),beforeManifest);assert.deepEqual(await authorTree(root),initial);
  // Even after the helper changes parameter rows, normal behavior Cancel owns
  // the draft and must leave saved data untouched.
  await click('#sceneBehaviorsCancel');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`),'cancel locally applied parameters');
  assert.equal(await value('#docSourceEditor'),beforeManifest);assert.deepEqual(await authorTree(root),initial);
  await openBehavior();await loadBindings();assert.deepEqual(await rows(),parameterRows);await selectBindings();
  await enabled(applyBindings);await click(applyBindings);await wait(async()=>JSON.stringify(await rows())===JSON.stringify(expectedRows),'reapply state binding parameters');
  report.steps.push('Chinese/English/Japanese at390px preserve selection identity, focus and values while fitting controls. Explicit helper Apply changes only the selected binding parameter table; cancelling that edited table still preserves all saved author bytes.');

  await enabled('#sceneBehaviorsCheck');await click('#sceneBehaviorsCheck');await enabled('#sceneBehaviorsApply');
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorsBefore').textContent`),beforeManifest);
  const afterReview=await evaluate(`document.querySelector('#sceneBehaviorsAfter').textContent`),reviewedModel=JSON.parse(afterReview);
  const expectedModel=structuredClone(originalModel);expectedModel.bindings.find(row=>row.bindingId===bindingId).parameters={clip_idle:idleId,clip_attack:attackId};
  assert.deepEqual(reviewedModel,expectedModel);assert.deepEqual(await authorTree(root),initial);
  await evaluate(`document.querySelector('#sceneBehaviorsReview').scrollIntoView({block:'start'})`);await screenshot('state-bindings-review-desktop.png');
  await click('#sceneBehaviorsApply');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorsDialog').open&&document.querySelector('#docSourceEditor').value===${JSON.stringify(afterReview)}`),'ordinary reviewed draft application');
  assert.deepEqual(await authorTree(root),initial);assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`),true);
  await enabled('#docSaveBtn');await click('#docSaveBtn');
  await wait(async()=>await readSource()===afterReview,'ordinary Save of only behavior manifest');
  await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.isSaving&&!(await import('/web/modules/app-state.js')).appState.isRebuilding&&!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`),'saved source baseline');
  const afterSave=await authorTree(root),changedPaths=[...new Set([...Object.keys(initial),...Object.keys(afterSave)])].filter(name=>initial[name]!==afterSave[name]);
  assert.deepEqual(changedPaths,[manifestPath]);
  report.authorChange={sourcePath:manifestPath,bindingId,changedAuthorPaths:changedPaths,parameters:expectedModel.bindings.find(row=>row.bindingId===bindingId).parameters};
  report.steps.push('The existing full-source Check/Apply stage creates an unsaved draft; ordinary Save writes only the current behavior manifest. Script bytes, other bindings, clips, scene, metadata and identities remain exact.');
  await screenshot('state-bindings-saved-source.png');

  await enabled('#projectBuildBtn');await click('#projectBuildBtn');await enabled('#projectBuildScene');await fill('#projectBuildScene',assemblyId,'change');
  async function perform(selector,kind){const previous=(await state()).job?.id;await enabled(selector);await click(selector);let job;await wait(async()=>{job=(await state()).job;return job?.kind===kind&&job.id!==previous&&!['queued','running'].includes(job.status);},kind,90000);report.jobs.push(job);assert.equal(job.status,'succeeded',JSON.stringify(job.diagnostics));return job;}
  await perform('#projectBuildPlan','plan');await perform('#projectBuildGenerate','build');const ran=await perform('#projectBuildHeadless','run');
  const project=ran.runtime.project,history=project.animationCommands,completed=project.animationCompletions,entries=project.animationStateEntries;
  assert.equal(project.protocolVersion,10);assert.equal(history.sequence,6);assert.equal(completed.sequence,1);
  assert.deepEqual(history.entries.map(row=>row.command.action),['select','play','select','play','select','play']);
  assert.deepEqual(history.entries.map(row=>row.state.clipId),[idleId,idleId,attackId,attackId,idleId,idleId]);
  assert.deepEqual(entries.entries.map(row=>row.stateKey),['idle','attack','idle']);assert.deepEqual(entries.entries.map(row=>row.trigger.kind),['initial','event','completed']);
  assert.equal(completed.entries[0].state.clipId,attackId);assert.equal(completed.entries[0].state.phase,'finished');assert.equal(completed.entries[0].commandSequence,4);assert.equal(completed.entries[0].deliveries[0].status,'handled');
  assert.equal(entries.entries[1].trigger.eventSequence,project.events.entries.find(row=>row.name==='action').sequence);
  assert.equal(entries.entries[2].trigger.completionSequence,completed.entries[0].sequence);
  await wait(()=>evaluate(`document.querySelector('#projectAnimationStateEntriesSequence')?.dataset.sequence==='3'&&!document.querySelector('#projectAnimationStateEntriesPanel').hidden`),'actual state-entry observation');
  await evaluate(`document.querySelector('#projectAnimationStateEntriesPanel').scrollIntoView({block:'start'})`);await screenshot('state-bindings-runtime-entries.png');
  await wait(()=>evaluate(`document.querySelector('#projectAnimationCompletionsSequence')?.dataset.sequence==='1'&&!document.querySelector('#projectAnimationCompletionsPanel').hidden`),'actual named-clip completion');
  await evaluate(`document.querySelector('#projectAnimationCompletionsPanel').scrollIntoView({block:'start'})`);await screenshot('state-bindings-runtime-completion.png');
  report.runtime={jobId:ran.id,protocolVersion:project.protocolVersion,entries,history,completed,events:project.events,actualReceipts:true};
  assert.deepEqual(await authorTree(root),afterSave);report.authorSnapshot={before:initial,after:afterSave,allowedChangedPaths:[manifestPath]};
  report.steps.push('The GUI-saved mapping is planned, built and run by real Godot: actual initial idle → event3 with shared enabled → attack → one non-looping clip completion → idle. Strict p10 entries retain their event/completion links; runtime execution leaves saved author files unchanged.');
  assert.deepEqual(report.errors,[]);
  for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);
  report.sourceSnapshotUnchanged=true;report.ok=true;
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  try { await captureFailure?.(); } catch (failure) { report.captureFailure = failure.message; }
} finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({cleanup:error.message}); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report,null,2) + '\n');
  console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));
}
