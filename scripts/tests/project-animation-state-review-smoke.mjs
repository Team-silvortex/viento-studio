// Actual Chrome controller state history review over frozen Godot observations.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/project-animation-state-review');
const output = path.resolve(process.env.VIENTO_ANIMATION_STATE_REVIEW_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/project-animation-state-review.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome HTTP editor and Godot headless execution; no installed Tauri, Android, native visual rendering or Bevy animation claim.',
  'Review groups only the same visit, scene and binding; following command receipts are later evidence, not proof that the selected entry caused those commands. No runtime controls, inferred causes or state mutation are introduced.'
] };
const sources = ['engine/project-animation-state-review.mjs','engine/project-animation-state-entries.mjs','engine/project-animation-states.mjs', 'engine/project-runtime-events.mjs', 'engine/project-runtime-query.mjs',
  'scripts/backends/godot4-project.mjs','scripts/backends/godot4/project-animation-state-runtime.gd','scripts/backends/godot4/project-animation-state-entry-runtime.gd','scripts/backends/godot4/project-animation-state-entry-wrapper.gd','scripts/backends/godot4-adapter.mjs',
  'web/modules/app-project-build.js','web/modules/app-project-animation-state-entry-observation.js','web/project-animation-state-entry-observation.css',
  'web/modules/app-project-animation-state-review.js','web/project-animation-state-review.css',
  'web/index.html','web/i18n/en.js','web/i18n/ja.js','scripts/tests/project-animation-state-review-smoke.mjs'];
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
  const clipId = authorFixture.clipIds[0][0];
  const table = {initialState:'idle',states:[{key:'idle'},{key:'action'}],transitions:[{from:'idle',to:'action',trigger:{kind:'event',name:'advance'}},{from:'action',to:'idle',trigger:{kind:'event',name:'advance'}},{from:'idle',to:'idle',trigger:{kind:'event',name:'restart'}}]};
  const controller = generateEditableGodotAnimationStateScript(table).content;
  await authorFixture.script('checkpoint', controller);
  await authorFixture.configure({clip_idle:clipId,clip_action:clipId});
  await authorFixture.edit('documents/behaviors/demo.json',manifest=>manifest.bindings.push({
    ...structuredClone(manifest.bindings[0]),bindingId:authorFixture.secondBindingId
  }));
  await authorFixture.script('publisher', 'extends Node\nfunc _ready() -> void:\n\tget_meta("viento_project").publish_event("advance",true)\n\tget_meta("viento_project").publish_event("advance",true)\n\tget_meta("viento_project").publish_event("restart",true)\n');
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
  assert.equal(project.protocolVersion,9);assert.equal(project.animationStates.sequence,1);assert.equal(project.animationStateEntries.sequence,5);
  const entries=project.animationStateEntries.entries,entry=entries[0];
  assert.deepEqual(entries.map(row=>row.stateKey),['idle','idle','action','idle','idle']);
  assert.deepEqual(entries.map(row=>row.clipId),Array(5).fill(clipId));
  assert.deepEqual(entries.map(row=>row.commandSequence),Array(5).fill(0));
  assert.deepEqual(entries.map(row=>row.timeSeconds),Array(5).fill(0));
  assert.equal(new Set(entries.map(row=>row.origin.bindingId)).size,2);
  assert.equal(new Set(entries.map(row=>row.scriptSource.objectId)).size,1);
  assert.equal(project.animationCommands.sequence,10);assert.equal(project.animationStates.entries[0].commandSequence,10);
  assert.deepEqual(project.animationStates.entries[0].controllers.map(row=>row.stateKey),['idle','idle']);
  await wait(()=>evaluate(`document.querySelector('#projectAnimationStateEntriesSequence')?.dataset.sequence==='5'&&!document.querySelector('#projectAnimationStateEntriesPanel').hidden`),'state entry panel');
  assert.equal(await evaluate(`document.querySelectorAll('.project-animation-state-entry').length`),5);
  for(const id of ['projectSharedStatePanel','projectEventTracePanel','projectAudioCommandsPanel','projectAnimationCommandsPanel','projectAnimationCompletionsPanel','projectAnimationStatesPanel'])
    assert.equal(await evaluate(`document.querySelector('#${id}').hidden`),false,id);
  const inspectReview = () => evaluate(`(() => {
    const panel=document.querySelector('#projectAnimationStateReviewPanel'), selection=document.querySelector('#projectAnimationStateReviewSelection');
    return {visible:!panel.hidden,sequence:panel.dataset.sequence,bindingId:panel.dataset.bindingId,visitIndex:panel.dataset.visitIndex,
      selected:selection.value,options:Array.from(selection.options,option=>option.value),entrySequence:document.querySelector('#projectAnimationStateReviewEntry').dataset.sequence,
      entryText:document.querySelector('#projectAnimationStateReviewEntry').innerText,commandCount:Number(document.querySelector('#projectAnimationStateReviewCommands').dataset.count),
      commands:Array.from(document.querySelectorAll('.project-animation-state-review-command'),row=>Number(row.dataset.sequence)),
      terminalStatus:document.querySelector('#projectAnimationStateReviewTerminal').dataset.status,terminalVisible:!document.querySelector('#projectAnimationStateReviewTerminal').hidden,
      previousDisabled:document.querySelector('#projectAnimationStateReviewPrevious').disabled,nextDisabled:document.querySelector('#projectAnimationStateReviewNext').disabled};
  })()`);
  const selectReview = async sequence => {
    const selector='.project-animation-state-entry-review[data-sequence="'+sequence+'"]';await enabled(selector);await click(selector);
    await wait(async()=>{const value=await inspectReview();return value.visible&&value.sequence===String(sequence);},'review entry '+sequence);
    return inspectReview();
  };
  const firstBinding=entries[0].origin.bindingId,secondBinding=entries[1].origin.bindingId;
  const firstCommands=project.animationCommands.entries.filter(row=>row.origin.bindingId===firstBinding).map(row=>row.sequence);
  const secondCommands=project.animationCommands.entries.filter(row=>row.origin.bindingId===secondBinding).map(row=>row.sequence);
  assert.equal(firstCommands.length,8);assert.equal(secondCommands.length,2);
  let review=await selectReview(1);
  assert.deepEqual(review.options,['1','3','4','5']);assert.deepEqual(review.commands,firstCommands);assert.equal(review.commandCount,8);
  assert.equal(review.previousDisabled,true);assert.equal(review.nextDisabled,false);assert.equal(review.terminalStatus,'active');assert.equal(review.terminalVisible,true);
  assert.equal(review.bindingId,firstBinding);assert.equal(review.visitIndex,'1');
  assert.equal(await evaluate(`document.activeElement.id`),'projectAnimationStateReviewSelection');
  await evaluate(`document.querySelector('#projectAnimationStateReviewPanel').scrollIntoView({block:'start'})`);await screenshot('review-desktop.png');
  report.review={first:review};
  await click('#projectAnimationStateReviewNext');review=await inspectReview();assert.equal(review.selected,'3');assert.match(review.entryText,/action/);
  await click('#projectAnimationStateReviewNext');review=await inspectReview();assert.equal(review.selected,'4');assert.match(review.entryText,/idle/);
  await click('#projectAnimationStateReviewNext');review=await inspectReview();assert.equal(review.selected,'5');assert.equal(review.entrySequence,'5');assert.match(review.entryText,/idle/);assert.equal(review.nextDisabled,true);
  assert.deepEqual(review.commands,firstCommands);report.review.repeatedIdle=review;
  await click('#projectAnimationStateReviewPrevious');assert.equal((await inspectReview()).selected,'4');
  await fill('#projectAnimationStateReviewSelection','3','change');assert.equal((await inspectReview()).selected,'3');
  await fill('#projectAnimationStateEntriesSearch','no-such-state');assert.equal(await evaluate(`document.querySelector('#projectAnimationStateEntriesEmpty').hidden`),false);
  assert.equal((await inspectReview()).selected,'3');assert.deepEqual((await inspectReview()).commands,firstCommands);
  await fill('#projectAnimationStateEntriesSearch','');review=await selectReview(2);
  assert.deepEqual(review.options,['2']);assert.deepEqual(review.commands,secondCommands);assert.equal(review.commandCount,2);
  assert.equal(review.previousDisabled,true);assert.equal(review.nextDisabled,true);assert.equal(review.bindingId,secondBinding);report.review.second=review;
  await fill('#projectAnimationStateEntriesSearch',firstBinding);assert.equal((await inspectReview()).selected,'2');
  await fill('#projectAnimationStateEntriesSearch','');await selectReview(5);
  await fill('#projectAnimationStateEntriesSearch',secondBinding);assert.equal((await inspectReview()).selected,'5');
  report.steps.push('Actual GUI planning, build and Godot execution produce five accepted entries and ten executed commands. The review groups the first binding as entries 1/3/4/5 with eight later same-binding receipts and the second binding as entry 2 with two; all initial cutoffs are zero. Next/previous/select preserve two distinct final idle entries without attributing the command receipts to a selected entry.');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']){
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('#projectAnimationStateReviewPanel').scrollIntoView({block:'start'})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#projectBuildDialog');return {noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,title:document.querySelector('#projectAnimationStateReviewTitle').textContent,search:document.querySelector('#projectAnimationStateEntriesSearch').value,flatCount:document.querySelectorAll('.project-animation-state-entry:not([hidden])').length,text:document.querySelector('#projectAnimationStateReviewPanel').innerText};})()`);
    review=await inspectReview();assert.equal(layout.title,{'zh-CN':'控制器状态回看',en:'Controller state review',ja:'コントローラー状態の確認'}[language]);
    assert.match(layout.text,{'zh-CN':/不一定由所选进入触发/,en:/did not necessarily trigger/,ja:/引き起こしたとは限りません/}[language]);
    assert.equal(layout.noHorizontalOverflow,true,JSON.stringify(layout));assert.equal(layout.flatCount,1);assert.equal(layout.search,secondBinding);
    assert.equal(review.selected,'5');assert.deepEqual(review.options,['1','3','4','5']);assert.deepEqual(review.commands,firstCommands);
    report.layout[language]={...layout,review};await screenshot(`review-${language}-390.png`);
  }
  report.steps.push('A pinned controller review stays selected while the flat-entry filter hides that controller. Chinese, English and Japanese retain the selected repeated idle entry, source buttons and eight receipt rows at 390px with no horizontal overflow.');
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await click('#projectAnimationStateReviewClose');assert.equal((await inspectReview()).visible,false);
  assert.equal(await evaluate(`document.activeElement.id`),'projectAnimationStateEntriesSearch');
  await fill('#projectAnimationStateEntriesSearch','');await selectReview(5);
  report.navigation=[];
  const selectedEntry=entries[4];
  for(const kind of ['binding','script']){
    if(kind!=='binding'){await enabled('#projectBuildBtn');await click('#projectBuildBtn');await fill('#projectAnimationStateEntriesSearch','');await selectReview(5);}
    const selector='.project-animation-state-review-'+kind+'-source';await enabled(selector);await click(selector);
    const expected=kind==='binding'?selectedEntry.origin.source:selectedEntry.scriptSource;
    const expectedText=visible(await fs.readFile(path.join(root,expected.sourcePath),'utf8'));
    await wait(()=>evaluate(`!document.querySelector('#projectBuildDialog').open&&!(await import('/web/modules/app-state.js')).appState.isLoadingSource&&document.querySelector('#docSourceEditor').value===${JSON.stringify(expectedText)}`),kind+' review source navigation');
    const location=await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return {start:e.selectionStart,end:e.selectionEnd};})()`);
    if(expected.sourceRange){assert.equal(location.start,expected.sourceRange.start);assert.equal(location.end,expected.sourceRange.end);}
    report.navigation.push({kind,entrySequence:5,source:expected,location});await screenshot(`review-${kind}-source.png`);
  }
  assert.deepEqual(await authorTree(root),initial);assert.deepEqual(report.errors,[]);
  report.runtime={jobId:ran.id,protocolVersion:9,entries:project.animationStateEntries,states:project.animationStates,commands:project.animationCommands};
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
