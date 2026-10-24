// Actual Chrome entry-trigger review over real Godot callback observations.
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
import '../adapters/node-studio-core.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/animation-entry-triggers');
const output = path.resolve(process.env.VIENTO_ANIMATION_ENTRY_TRIGGERS_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/animation-entry-triggers.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome HTTP editor and Godot headless execution; no installed Tauri, Android, native visual rendering or Bevy animation claim.',
  'Review groups only the same visit, scene and binding; following command receipts are later evidence, not proof that the selected entry caused those commands. Callback scope is recorded directly; no selected-branch or condition-evaluation trace is claimed. The disposable publisher fixture manually steps the Godot scene clock to exercise natural completion and invokes one direct controller entry.'
] };
const sources = ['engine/project-animation-state-entry-triggers.mjs','engine/project-animation-state-review.mjs','engine/project-animation-state-entries.mjs','engine/project-animation-states.mjs', 'engine/project-runtime-events.mjs', 'engine/project-runtime-query.mjs',
  'scripts/backends/godot4/project-animation-state-trigger-runtime.gd','scripts/backends/godot4/project-animation-state-trigger-wrapper.gd','scripts/backends/godot4-project.mjs','scripts/backends/godot4/project-animation-state-runtime.gd','scripts/backends/godot4/project-animation-state-entry-runtime.gd','scripts/backends/godot4/project-animation-state-entry-wrapper.gd','scripts/backends/godot4-adapter.mjs',
  'web/modules/app-project-build.js','web/modules/app-project-animation-state-entry-observation.js','web/project-animation-state-entry-observation.css',
  'web/modules/app-project-animation-state-trigger.js','web/modules/app-project-animation-state-review.js','web/project-animation-state-review.css',
  'web/index.html','web/i18n/en.js','web/i18n/ja.js','scripts/tests/animation-entry-triggers-smoke.mjs'];
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
  const sceneId = authorFixture.sceneIds[0], assemblyId = authorFixture.assemblyId;
  const clipId = authorFixture.clipIds[0][0], actionClipId = authorFixture.clipIds[0][1];
  const table = { initialState: 'idle', states: [{ key: 'idle' }, { key: 'action' }], transitions: [
    { from: 'idle', to: 'action', trigger: { kind: 'event', name: 'action', condition: { combine: 'all', conditions: [
      { type: 'boolean', operator: 'eq', value: true, selector: { kind: 'projectState', key: 'combat.enabled' } },
      { type: 'number', operator: 'gte', value: 3 },
    ] } } }, { from: 'action', to: 'idle', trigger: { kind: 'completed' } },
  ] };
  const controller = generateEditableGodotAnimationStateScript(table).content;
  await authorFixture.script('checkpoint', controller);
  await authorFixture.configure({ clip_idle: clipId, clip_action: actionClipId });
  await authorFixture.script('publisher', `extends Node
func _ready() -> void:
\tcall_deferred("_probe")
func _probe() -> void:
\tvar host = get_tree().root.get_node("VientoProject")
\thost.set_process(false)
\thost.flush_requests()
\tvar receiver = get_parent().get_node("behavior_${authorFixture.receiverBindingId.replaceAll('-', '_')}")
\tvar project = get_meta("viento_project")
\tproject.write_state("combat.enabled", true)
\tproject.publish_event("action", 2)
\thost.flush_requests()
\tproject.publish_event("action", 3)
\thost.flush_requests()
\thost.elapsed_seconds += 0.5
\thost.total_seconds += 0.5
\thost.current.project_step(0.5)
\thost.flush_requests()
\treceiver._enter_state(0)
\thost.flush_requests()
\thost.finish_project()
`);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root, VIENTO_GODOT_BIN: tool,
    VIENTO_EXECUTION_BACKEND: 'org.viento.godot4', XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  const rebuilt = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env }); assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
  const initial = await authorTree(root), base = await serve(fixture, appRoot, env);
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
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,system:(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()})`); report.serviceFailure = await state(); report.editorFailure = await evaluate(`(()=>import('/web/modules/app-state.js').then(({appState:s})=>({isSaving:s.isSaving,isRebuilding:s.isRebuilding,isMutatingWorld:s.isMutatingWorld,dirty:s.editHasUnsavedChanges,creating:s.isCreating,planDisabled:document.querySelector('#projectBuildPlan')?.disabled,behaviorDisabled:document.querySelector('#sceneBehaviorsBtn')?.disabled})))()`); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: download, eventsEnabled: true });
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor startup');
  await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.includes('scenes/demo'))`), 'saved scene in sidebar');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scenes/demo')).click()`);
  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildScene');
  await fill('#projectBuildScene', assemblyId, 'change'); await enabled('#projectBuildPlan');
  async function perform(selector, kind) {
    const previous=(await state()).job?.id;await enabled(selector);await click(selector);let job;
    await wait(async()=>{job=(await state()).job;return job?.kind===kind&&job.id!==previous&&job.status!=='running';},kind,90000);
    report.jobs.push(job);assert.equal(job.status,'succeeded',JSON.stringify(job.diagnostics));return job;
  }
  await perform('#projectBuildPlan','plan'); await perform('#projectBuildGenerate','build');
  const ran=await perform('#projectBuildHeadless','run'),project=ran.runtime.project;
  assert.equal(project.protocolVersion,10); assert.equal(project.animationStates.sequence,1); assert.equal(project.animationStateEntries.sequence,4);
  const entries=project.animationStateEntries.entries;
  assert.deepEqual(entries.map(row=>row.stateKey),['idle','action','idle','idle']);
  assert.deepEqual(entries.map(row=>row.clipId),[clipId,actionClipId,clipId,clipId]);
  assert.deepEqual(entries.map(row=>row.trigger.kind),['initial','event','completed','direct']);
  assert.deepEqual(entries.map(row=>row.commandSequence),[0,2,4,6]);
  assert.deepEqual(entries.map(row=>row.timeSeconds),[0,0,.5,.5]);
  assert.equal(entries[1].trigger.eventSequence,2); assert.equal(entries[2].trigger.completionSequence,1);
  assert.equal(project.events.sequence,2); assert.deepEqual(project.events.entries.map(row=>row.value),[2,3]);
  assert.equal(project.animationCompletions.sequence,1); assert.equal(project.animationCompletions.entries[0].clip.id,actionClipId);
  assert.equal(project.animationCommands.sequence,8); assert.equal(project.animationStates.entries[0].commandSequence,8);
  await wait(()=>evaluate(`document.querySelector('#projectAnimationStateEntriesSequence')?.dataset.sequence==='4'&&!document.querySelector('#projectAnimationStateEntriesPanel').hidden`),'state entry panel');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.project-animation-state-entry-trigger'),row=>row.dataset.kind)`),['initial','event','completed','direct']);
  for(const id of ['projectSharedStatePanel','projectEventTracePanel','projectAudioCommandsPanel','projectAnimationCommandsPanel','projectAnimationCompletionsPanel','projectAnimationStatesPanel'])
    assert.equal(await evaluate(`document.querySelector('#${id}').hidden`),false,id);
  const inspectReview = () => evaluate(`(() => {
    const panel=document.querySelector('#projectAnimationStateReviewPanel'), selection=document.querySelector('#projectAnimationStateReviewSelection');
    return {visible:!panel.hidden,sequence:panel.dataset.sequence,bindingId:panel.dataset.bindingId,visitIndex:panel.dataset.visitIndex,
      selected:selection.value,options:Array.from(selection.options,option=>option.value),entrySequence:document.querySelector('#projectAnimationStateReviewEntry').dataset.sequence,
      entryText:document.querySelector('#projectAnimationStateReviewEntry').innerText,commandCount:Number(document.querySelector('#projectAnimationStateReviewCommands').dataset.count),
      commands:Array.from(document.querySelectorAll('.project-animation-state-review-command'),row=>Number(row.dataset.sequence)),
      trigger:document.querySelector('#projectAnimationStateReviewTrigger').textContent,kind:document.querySelector('#projectAnimationStateReviewTrigger').dataset.kind,
      triggerDetail:document.querySelector('#projectAnimationStateReviewTriggerDetail').textContent,triggerPayload:document.querySelector('#projectAnimationStateReviewTriggerPayload').textContent,
      deliveryStatus:document.querySelector('#projectAnimationStateReviewTriggerDelivery').dataset.status,
      previousDisabled:document.querySelector('#projectAnimationStateReviewPrevious').disabled,nextDisabled:document.querySelector('#projectAnimationStateReviewNext').disabled};
  })()`);
  const selectReview = async sequence => {
    const selector='.project-animation-state-entry-review[data-sequence="'+sequence+'"]';await enabled(selector);await click(selector);
    await wait(async()=>{const value=await inspectReview();return value.visible&&value.sequence===String(sequence);},'review entry '+sequence);
    return inspectReview();
  };
  report.review={};
  let review=await selectReview(1); assert.equal(review.kind,'initial'); assert.match(review.trigger,/初始化回调/);
  assert.deepEqual(review.options,['1','2','3','4']);assert.deepEqual(review.commands,[1,2,3,4,5,6,7,8]);
  assert.equal(await evaluate(`document.activeElement.id`),'projectAnimationStateReviewSelection'); report.review.initial=review;
  await click('#projectAnimationStateReviewNext');review=await inspectReview();assert.equal(review.selected,'2');assert.equal(review.kind,'event');
  assert.match(review.trigger,/事件 #2/); assert.equal(review.triggerDetail,'关联事件：action'); assert.equal(review.triggerPayload,'事件值：3');
  assert.equal(review.deliveryStatus,'handled'); assert.deepEqual(review.commands,[3,4,5,6,7,8]); report.review.event=review;
  await evaluate(`document.querySelector('#projectAnimationStateReviewPanel').scrollIntoView({block:'start'})`);await screenshot('event-desktop.png');
  await click('#projectAnimationStateReviewNext');review=await inspectReview();assert.equal(review.selected,'3');assert.equal(review.kind,'completed');
  assert.match(review.trigger,/自然完成 #1/);assert.match(review.triggerDetail,new RegExp(actionClipId));assert.match(review.triggerDetail,/攻撃/);
  assert.equal(review.triggerPayload,'');assert.equal(review.deliveryStatus,'handled');assert.deepEqual(review.commands,[5,6,7,8]); report.review.completed=review;
  await evaluate(`document.querySelector('#projectAnimationStateReviewPanel').scrollIntoView({block:'start'})`);await screenshot('completion-desktop.png');
  await click('#projectAnimationStateReviewNext');review=await inspectReview();assert.equal(review.selected,'4');assert.equal(review.kind,'direct');
  assert.match(review.trigger,/直接进入/);assert.equal(review.triggerDetail,'');assert.equal(review.triggerPayload,'');assert.deepEqual(review.commands,[7,8]);report.review.direct=review;
  await evaluate(`document.querySelector('#projectAnimationStateReviewPanel').scrollIntoView({block:'start'})`);await screenshot('direct-desktop.png');
  await click('#projectAnimationStateReviewPrevious');assert.equal((await inspectReview()).selected,'3');
  await fill('#projectAnimationStateReviewSelection','2','change');assert.equal((await inspectReview()).selected,'2');
  await evaluate(`document.querySelector('#projectAnimationStateReviewPrevious').focus()`);await click('#projectAnimationStateReviewPrevious');
  assert.equal((await inspectReview()).selected,'1');assert.equal(await evaluate(`document.activeElement.id`),'projectAnimationStateReviewSelection');
  await fill('#projectAnimationStateReviewSelection','3','change');await fill('#projectAnimationStateEntriesSearch','no-such-state');
  assert.equal(await evaluate(`document.querySelector('#projectAnimationStateEntriesEmpty').hidden`),false);assert.equal((await inspectReview()).selected,'3');
  report.steps.push('Actual GUI plan/build/run yields protocol 10 initial, event #2, completion #1 and direct entries. Event #1 fails the v5 combined guard without an entry. The review displays payload 3 and the completed Strike clip, distinct from the newly selected Idle clip; later command receipts remain separate.');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('#projectAnimationStateReviewSelection').focus()`);
  for(const language of ['zh-CN','en','ja']){
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('#projectAnimationStateReviewPanel').scrollIntoView({block:'start'})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#projectBuildDialog');return {noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,title:document.querySelector('#projectAnimationStateReviewTitle').textContent,search:document.querySelector('#projectAnimationStateEntriesSearch').value,flatCount:document.querySelectorAll('.project-animation-state-entry:not([hidden])').length,text:document.querySelector('#projectAnimationStateReviewPanel').innerText,focused:document.activeElement.id};})()`);
    review=await inspectReview();assert.equal(layout.title,{'zh-CN':'控制器状态回看',en:'Controller state review',ja:'コントローラー状態の確認'}[language]);
    assert.match(review.trigger,{'zh-CN':/自然完成 #1/,en:/natural completion #1/,ja:/自然終了 #1/}[language]);
    assert.match(layout.text,{'zh-CN':/不包含分支命中或条件求值过程/,en:/does not trace selected branches or condition evaluation/,ja:/条件評価の過程は含みません/}[language]);
    assert.equal(layout.noHorizontalOverflow,true,JSON.stringify(layout));assert.equal(layout.flatCount,0);assert.equal(layout.search,'no-such-state');
    assert.equal(review.selected,'3');assert.equal(layout.focused,'projectAnimationStateReviewSelection');assert.deepEqual(review.options,['1','2','3','4']);
    report.layout[language]={...layout,review};await screenshot(`completion-${language}-390.png`);
  }
  report.steps.push('Keyboard previous/next/select preserve entry identity. A selected completion remains reviewable when the flat list filter hides every row. Chinese, English and Japanese retain its source, selection and focused control at 390px without horizontal overflow.');
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await click('#projectAnimationStateReviewClose');assert.equal((await inspectReview()).visible,false);
  assert.equal(await evaluate(`document.activeElement.id`),'projectAnimationStateEntriesSearch');
  await fill('#projectAnimationStateEntriesSearch','');await selectReview(3);
  report.navigation=[];const selectedEntry=entries[2];
  for(const kind of ['binding','script']){
    if(kind!=='binding'){await enabled('#projectBuildBtn');await click('#projectBuildBtn');await fill('#projectAnimationStateEntriesSearch','');await selectReview(3);}
    const selector='.project-animation-state-review-'+kind+'-source';await enabled(selector);await click(selector);
    const expected=kind==='binding'?selectedEntry.origin.source:selectedEntry.scriptSource;
    const expectedText=visible(await fs.readFile(path.join(root,expected.sourcePath),'utf8'));
    await wait(()=>evaluate(`!document.querySelector('#projectBuildDialog').open&&!(await import('/web/modules/app-state.js')).appState.isLoadingSource&&document.querySelector('#docSourceEditor').value===${JSON.stringify(expectedText)}`),kind+' review source navigation');
    const location=await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return {start:e.selectionStart,end:e.selectionEnd};})()`);
    if(expected.sourceRange){assert.equal(location.start,expected.sourceRange.start);assert.equal(location.end,expected.sourceRange.end);}
    report.navigation.push({kind,entrySequence:3,source:expected,location});await screenshot(`review-${kind}-source.png`);
  }
  assert.deepEqual(await authorTree(root),initial);assert.deepEqual(report.errors,[]);
  report.runtime={jobId:ran.id,protocolVersion:10,entries:project.animationStateEntries,events:project.events,completions:project.animationCompletions,states:project.animationStates,commands:project.animationCommands};
  report.steps.push('Closing a review does not alter the recorded run. Reopening the selected controller and both review source buttons navigate to frozen binding and author-script locations through the guarded editor. Build/run, pinned review, filtering, language changes and source navigation leave every author file unchanged.');
  for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);
  report.sourceSnapshotUnchanged=true;report.ok=true;
} catch(error){
  report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;
  try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}
} finally{
  socket?.close();
  for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}
  report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));
}
