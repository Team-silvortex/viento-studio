// Actual Chrome event delivery review over real Godot callback observations.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/project-event-review');
const output = path.resolve(process.env.VIENTO_PROJECT_EVENT_REVIEW_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/project-event-review.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome HTTP editor and Godot headless execution; no installed Tauri, Android, native visual rendering or Bevy animation claim.',
  'Event review links only explicit event-sequence and subscription identities. No entry is not a condition-evaluation result, and handled does not prove animation playback. The disposable publisher adds two subscriptions, withdraws one queued recipient, manually steps the Godot scene clock and directly re-enters the controller to exercise excluded provenance kinds.'
] };
const sources = ['engine/project-event-review.mjs','engine/project-event-bus.mjs','engine/project-animation-state-entry-triggers.mjs',
  'engine/project-animation-state-review.mjs','engine/project-animation-state-entries.mjs','engine/project-animation-states.mjs','engine/project-runtime-events.mjs','engine/project-runtime-query.mjs',
  'scripts/backends/godot4/project-animation-state-trigger-runtime.gd','scripts/backends/godot4/project-animation-state-trigger-wrapper.gd','scripts/backends/godot4-project.mjs',
  'scripts/backends/godot4/project-events.gd','scripts/backends/godot4/project-animation-completions.gd','scripts/backends/godot4-adapter.mjs',
  'web/modules/app-project-build.js','web/modules/app-project-event-observation.js','web/modules/app-project-event-review.js','web/project-event-observation.css','web/project-event-review.css',
  'web/modules/app-project-animation-state-entry-observation.js','web/modules/app-project-animation-state-review.js','web/project-animation-state-review.css',
  'web/index.html','web/i18n/en.js','web/i18n/ja.js','scripts/tests/project-event-review-smoke.mjs','scripts/tests/animation-entry-triggers-smoke.mjs'];
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-event-review-browser-'));
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
func _observe(_value) -> bool:
\treturn true
func _cancelled(_value) -> bool:
\treturn true
func _probe() -> void:
\tvar host = get_tree().root.get_node("VientoProject")
\thost.set_process(false)
\thost.flush_requests()
\tvar receiver = get_parent().get_node("behavior_${authorFixture.receiverBindingId.replaceAll('-', '_')}")
\tvar project = get_meta("viento_project")
\tproject.subscribe_event("action", _observe)
\tvar cancelled = project.subscribe_event("action", _cancelled)
\tproject.write_state("combat.enabled", true)
\tproject.publish_event("action", 2)
\tproject.unsubscribe_event(cancelled)
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
  assert.equal(project.protocolVersion,10); assert.equal(project.animationStateEntries.sequence,4);
  const entries=project.animationStateEntries.entries;
  assert.deepEqual(entries.map(row=>row.trigger.kind),['initial','event','completed','direct']);
  assert.deepEqual(entries.map(row=>row.stateKey),['idle','action','idle','idle']);
  assert.equal(entries[1].trigger.eventSequence,2); assert.equal(entries[1].trigger.subscriptionId,1);
  assert.equal(project.events.sequence,2); assert.deepEqual(project.events.entries.map(row=>row.name),['action','action']);
  assert.deepEqual(project.events.entries.map(row=>row.value),[2,3]);
  assert.deepEqual(project.events.entries.map(row=>row.deliveries.map(item=>[item.subscriptionId,item.status])),[
    [[1,'handled'],[2,'handled'],[3,'skipped']],[[1,'handled'],[2,'handled']],
  ]);
  assert.equal(project.events.entries[1].deliveries[0].origin.bindingId,authorFixture.receiverBindingId);
  assert.equal(project.events.entries[1].deliveries[1].origin.bindingId,authorFixture.publisherBindingId);
  await wait(()=>evaluate(`document.querySelector('#projectEventTraceSequence')?.dataset.sequence==='2'&&!document.querySelector('#projectEventTracePanel').hidden`),'event history');
  await wait(()=>evaluate(`document.querySelector('#projectAnimationStateEntriesSequence')?.dataset.sequence==='4'`),'entry history');
  assert.equal(await evaluate(`document.querySelector('#projectEventReviewPanel').hidden`),true);
  const inspectReview=()=>evaluate(`(()=>{const p=document.querySelector('#projectEventReviewPanel'),s=document.querySelector('#projectEventReviewSelection');return {
    visible:!p.hidden,sequence:p.dataset.sequence,visitIndex:p.dataset.visitIndex,selected:s.value,options:Array.from(s.options,o=>o.value),
    title:document.querySelector('#projectEventReviewTitle').textContent,name:document.querySelector('#projectEventReviewName').textContent,
    value:document.querySelector('#projectEventReviewValue').textContent,note:document.querySelector('#projectEventReviewAssociationNote').textContent,
    recipients:Array.from(document.querySelectorAll('.project-event-review-recipient'),r=>({subscriptionId:Number(r.dataset.subscriptionId),status:r.dataset.status,
      animationStatus:r.dataset.animationStatus,entrySequence:r.querySelector('.project-event-review-animation-entry').dataset.entrySequence??null,
      entryVisible:!r.querySelector('.project-event-review-animation-entry').hidden,text:r.innerText}))};})()`);
  const selectEvent=async sequence=>{
    const selector='.project-event-review-open[data-sequence="'+sequence+'"]';await enabled(selector);await click(selector);
    await wait(async()=>{const value=await inspectReview();return value.visible&&value.sequence===String(sequence);},'event review '+sequence);
    return inspectReview();
  };
  report.review={};
  let review=await selectEvent(1);
  assert.equal(await evaluate(`document.activeElement.id`),'projectEventReviewSelection');
  assert.deepEqual(review.options,['1','2']);assert.equal(review.name,'action');assert.equal(review.value,'2');
  assert.deepEqual(review.recipients.map(row=>row.status),['handled','handled','skipped']);
  assert.deepEqual(review.recipients.map(row=>row.animationStatus),Array(3).fill('not-recorded'));
  assert.ok(review.recipients.every(row=>!row.entryVisible&&row.entrySequence===null));
  assert.match(review.note,/不能说明条件失败/);report.review.first=review;
  await evaluate(`document.querySelector('#projectEventReviewPanel').scrollIntoView({block:'start'})`);await screenshot('event-no-entry-desktop.png');
  await fill('#projectEventReviewSelection','2','change');review=await inspectReview();
  assert.equal(review.selected,'2');assert.equal(review.value,'3');assert.deepEqual(review.recipients.map(row=>row.status),['handled','handled']);
  assert.deepEqual(review.recipients.map(row=>row.animationStatus),['recorded','not-recorded']);
  assert.equal(review.recipients[0].entrySequence,'2');assert.equal(review.recipients[0].entryVisible,true);assert.equal(review.recipients[1].entryVisible,false);
  report.review.second=review;await screenshot('event-recorded-desktop.png');
  await fill('#projectEventTraceSearch','no-such-event');await fill('#projectAnimationStateEntriesSearch','no-such-state');
  assert.equal(await evaluate(`document.querySelectorAll('.project-event-record:not([hidden])').length`),0);
  assert.equal(await evaluate(`document.querySelectorAll('.project-animation-state-entry:not([hidden])').length`),0);
  assert.equal((await inspectReview()).selected,'2');
  const associated='.project-event-review-animation-entry[data-entry-sequence="2"]';await enabled(associated);await click(associated);
  await wait(()=>evaluate(`!document.querySelector('#projectAnimationStateReviewPanel').hidden&&document.querySelector('#projectAnimationStateReviewPanel').dataset.sequence==='2'`),'linked controller review');
  assert.equal(await evaluate(`document.querySelector('#projectAnimationStateReviewTrigger').dataset.kind`),'event');
  assert.equal(await evaluate(`document.querySelector('#projectAnimationStateReviewTriggerPayload').textContent`),'事件值：3');
  assert.equal(await evaluate(`document.querySelector('#projectAnimationStateReviewSelection').value`),'2');
  assert.equal((await inspectReview()).selected,'2');
  await evaluate(`document.querySelector('#projectAnimationStateReviewPanel').scrollIntoView({block:'start'})`);await screenshot('linked-controller-review.png');
  report.steps.push('Real GUI plan/build/run captures two same-name events. The first has handled/handled/skipped recipients and no recorded animation entry. The second links only the controller subscription to entry #2; its ordinary observer remains not-recorded. Initial, completion and direct entries are excluded.');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('#projectEventReviewSelection').focus()`);
  for(const language of ['zh-CN','en','ja']){
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('#projectEventReviewPanel').scrollIntoView({block:'start'})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#projectBuildDialog');return {
      noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,
      eventSearch:document.querySelector('#projectEventTraceSearch').value,entrySearch:document.querySelector('#projectAnimationStateEntriesSearch').value,
      eventCount:document.querySelectorAll('.project-event-record:not([hidden])').length,entryCount:document.querySelectorAll('.project-animation-state-entry:not([hidden])').length,
      focused:document.activeElement.id,text:document.querySelector('#projectEventReviewPanel').innerText,
      controllerSelection:document.querySelector('#projectAnimationStateReviewSelection').value};})()`);
    review=await inspectReview();assert.equal(review.title,{'zh-CN':'事件投递回看',en:'Event delivery review',ja:'イベント配信の確認'}[language]);
    assert.match(review.note,{'zh-CN':/不能说明条件失败/,en:/do not establish a failed condition/,ja:/条件の不成立/}[language]);
    assert.equal(review.selected,'2');assert.deepEqual(review.options,['1','2']);assert.equal(layout.controllerSelection,'2');
    assert.equal(layout.noHorizontalOverflow,true,JSON.stringify(layout));assert.equal(layout.eventCount,0);assert.equal(layout.entryCount,0);
    assert.equal(layout.eventSearch,'no-such-event');assert.equal(layout.entrySearch,'no-such-state');assert.equal(layout.focused,'projectEventReviewSelection');
    assert.deepEqual(review.recipients.map(row=>row.animationStatus),['recorded','not-recorded']);
    report.layout[language]={...layout,review};await screenshot(`event-review-${language}-390.png`);
  }
  report.steps.push('Event and controller reviews remain selected while both flat lists hide all rows. The explicit entry link opens the existing controller review. Chinese, English and Japanese retain selection, focus, delivery status and no-inference text at 390px without horizontal overflow.');
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await click('#projectEventReviewClose');assert.equal((await inspectReview()).visible,false);
  assert.equal(await evaluate(`document.activeElement.id`),'projectEventTraceSearch');
  await fill('#projectEventTraceSearch','');await selectEvent(2);
  report.navigation=[];
  for(const kind of ['publisher','subscriber']){
    if(kind!=='publisher'){await enabled('#projectBuildBtn');await click('#projectBuildBtn');await fill('#projectEventTraceSearch','');await selectEvent(2);}
    const selector=kind==='publisher'?'#projectEventReviewPublisherSource':'.project-event-review-recipient[data-subscription-id="1"] .project-event-review-recipient-source';
    const expected=kind==='publisher'?project.events.entries[1].origin.source:project.events.entries[1].deliveries[0].origin.source;
    const expectedText=visible(await fs.readFile(path.join(root,expected.sourcePath),'utf8'));
    await enabled(selector);await click(selector);
    await wait(()=>evaluate(`!document.querySelector('#projectBuildDialog').open&&!(await import('/web/modules/app-state.js')).appState.isLoadingSource&&document.querySelector('#docSourceEditor').value===${JSON.stringify(expectedText)}`),kind+' event review source navigation');
    const location=await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return {start:e.selectionStart,end:e.selectionEnd};})()`);
    if(expected.sourceRange){assert.equal(location.start,expected.sourceRange.start);assert.equal(location.end,expected.sourceRange.end);}
    report.navigation.push({kind,eventSequence:2,source:expected,location});await screenshot(`event-review-${kind}-source.png`);
  }
  await enabled('#projectBuildBtn');await click('#projectBuildBtn');await fill('#projectEventTraceSearch','');await selectEvent(2);
  await fill('#projectAnimationStateEntriesSearch','');await enabled(associated);await click(associated);
  assert.equal(await evaluate(`document.querySelector('#projectAnimationStateReviewPanel').hidden`),false);
  const repeated=await perform('#projectBuildHeadless','run');assert.notEqual(repeated.id,ran.id);
  assert.equal(repeated.runtime.project.protocolVersion,10);
  await wait(()=>evaluate(`document.querySelector('#projectEventReviewPanel').hidden&&document.querySelector('#projectAnimationStateReviewPanel').hidden`),'new run clears both selections');
  await wait(()=>evaluate(`document.querySelector('#projectEventTraceSequence').dataset.sequence==='2'&&document.querySelector('#projectAnimationStateEntriesSequence').dataset.sequence==='4'`),'new run history');
  report.rerun={jobId:repeated.id,eventReviewHidden:await evaluate(`document.querySelector('#projectEventReviewPanel').hidden`),controllerReviewHidden:await evaluate(`document.querySelector('#projectAnimationStateReviewPanel').hidden`)};
  await screenshot('new-run-cleared-reviews.png');
  const after=await authorTree(root);assert.deepEqual(after,initial);assert.deepEqual(report.errors,[]);
  report.authorSnapshot={before:initial,after,unchanged:true};
  report.runtime={jobId:ran.id,protocolVersion:10,entries:project.animationStateEntries,events:project.events,completions:project.animationCompletions,states:project.animationStates,commands:project.animationCommands};
  report.steps.push('Publisher and subscriber navigation opens frozen original binding ranges. A new real run clears both event and controller selections. Plan/build/run, filtering, language changes, review navigation and repeated execution preserve every author byte.');
  report.sourcesAfter=Object.fromEntries(await Promise.all(sources.map(async name=>[name,buildHash(await fs.readFile(path.join(appRoot,name)))])));
  assert.deepEqual(report.sourcesAfter,report.sources,'Source changed during smoke');
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
