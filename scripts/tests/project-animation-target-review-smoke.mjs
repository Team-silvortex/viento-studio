// Actual Chrome target-group review of independent instance animation receipts.
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

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/project-animation-target-review');
const output = path.resolve(process.env.VIENTO_ANIMATION_TARGET_REVIEW_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/project-animation-target-review.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome HTTP editor and trusted Godot headless execution; no installed Tauri, Android, native visual rendering or Bevy animation claim.',
  'The fixture is a disposable copy with two instance targets and three behavior bindings. The review groups frozen execution receipts by scene visit and target; it does not render a current playhead or infer script trigger causality.'
] };
const sources = ['engine/project-animation-target-review.mjs','engine/project-animation-targets.mjs','engine/project-animation-commands.mjs','engine/project-animation-completions.mjs',
  'engine/project-runtime-events.mjs','engine/project-runtime-query.mjs','engine/studio-core.wasm',
  'scripts/backends/godot4-project.mjs','scripts/backends/godot4/project-animation-target-runtime.gd','scripts/backends/godot4/project-animation-targets.gd','scripts/backends/godot4/project-animation-target-completions.gd','scripts/backends/godot4-adapter.mjs',
  'web/modules/app-project-build.js','web/modules/app-project-animation-observation.js','web/modules/app-project-animation-completion-observation.js',
  'web/modules/app-project-animation-target-review.js','web/project-animation-target-review.css','web/index.html','web/i18n/index.js','web/i18n/en.js','web/i18n/ja.js','scripts/tests/project-animation-target-review-smoke.mjs'];
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-target-review-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const authorFixture = await projectEventAnimationAuthor(fixture);
  const root = authorFixture.author, download = path.join(temporary, 'downloads'); await fs.mkdir(download);
  const sceneId = authorFixture.sceneIds[0], assemblyId = authorFixture.assemblyId;
  const instanceA = authorFixture.instanceId, instanceB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const [clipA, clipB] = authorFixture.clipIds[0];
  await authorFixture.edit('documents/animations/scene-0.json', document => {
    document.schemaVersion = 4; document.playbackScope = 'instance';
    document.clips[0] = { ...document.clips[0], name: '待机 / Idle / 待機', startSeconds: .25, endSeconds: .5, loop: false };
    document.clips[1] = { ...document.clips[1], name: '攻击 / Attack / 攻撃', startSeconds: .5, endSeconds: .75, loop: false };
    document.tracks.push(...document.tracks.map((track, index) => ({ ...structuredClone(track), id: `62626262-6262-4262-8262-${String(index + 100).padStart(12, '0')}`, instanceId: instanceB })));
  });
  const player = `extends Node\n@export var clip_id: String = ""\nfunc _ready() -> void:\n\tvar p = get_meta("viento_project")\n\tp.subscribe_animation_completed(_done)\n\tp.select_animation_clip(clip_id)\n\tp.play_animation()\nfunc _done(_clip) -> bool:\n\treturn true\n`;
  await authorFixture.script('checkpoint', player);
  await authorFixture.script('publisher', player);
  await authorFixture.script('second', player);
  await authorFixture.configure({clip_id:clipA});
  await authorFixture.edit('documents/behaviors/demo.json', manifest => {
    manifest.bindings[1].parameters = {clip_id:clipB};
    manifest.bindings.push({ ...structuredClone(manifest.bindings[0]), bindingId: authorFixture.secondBindingId, instanceId: instanceB,
      implementation: { ...manifest.bindings[0].implementation, sourceObjectId: authorFixture.secondScriptId } });
  });
  await authorFixture.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', metadata => {
    metadata.relations.push({ kind: 'reference', targetId: authorFixture.secondScriptId, slot: 'implementation' });
  });
  report.fixture = { sceneId, assemblyId, instanceA, instanceB, clipA, clipB,
    bindingA:authorFixture.receiverBindingId, secondBindingA:authorFixture.publisherBindingId, bindingB:authorFixture.secondBindingId,
    schemaVersion:4, playbackScope:'instance', playerSourceSha256:buildHash(player) };
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
    await wait(async()=>{job=(await state()).job;return job?.kind===kind&&job.id!==previous&&!['queued','running'].includes(job.status);},kind,90000);
    report.jobs.push(job);assert.equal(job.status,'succeeded',JSON.stringify(job.diagnostics));return job;
  }
  await perform('#projectBuildPlan','plan'); await perform('#projectBuildGenerate','build');
  const ran = await perform('#projectBuildHeadless','run'), project = ran.runtime.project;
  const history = project.animationCommands, completed = project.animationCompletions;
  assert.equal(project.protocolVersion,11); assert.equal(history.sequence,6); assert.equal(completed.sequence,2);
  assert.deepEqual(history.entries.map(row=>row.command.action),['select','play','select','play','select','play']);
  assert.deepEqual(history.entries.map(row=>row.target.instanceId),[instanceA,instanceA,instanceA,instanceA,instanceB,instanceB]);
  assert.deepEqual(history.entries.map(row=>row.state.clipId),[clipA,clipA,clipB,clipB,clipA,clipA]);
  assert.deepEqual(history.entries.map(row=>row.origin.bindingId),[
    authorFixture.receiverBindingId,authorFixture.receiverBindingId,authorFixture.publisherBindingId,authorFixture.publisherBindingId,authorFixture.secondBindingId,authorFixture.secondBindingId]);
  assert.deepEqual(completed.entries.map(row=>[row.target.instanceId,row.targetCommandSequence,row.commandSequence]),[[instanceA,4,6],[instanceB,6,6]]);
  assert.deepEqual(completed.entries.map(row=>row.deliveries.length),[2,1]);
  assert.ok(completed.entries.every(row=>row.state.phase==='finished'&&row.deliveries.every(delivery=>delivery.status==='handled')));
  assert.equal(completed.entries[0].state.clipId,clipB); assert.equal(completed.entries[1].state.clipId,clipA);
  report.runtime = {jobId:ran.id,protocolVersion:project.protocolVersion,history,completed,actualReceipts:true};
  await wait(()=>evaluate(`document.querySelector('#projectAnimationCommandsSequence')?.dataset.sequence==='6'&&document.querySelector('#projectAnimationCompletionsSequence')?.dataset.sequence==='2'`),'actual p11 command and completion panels');
  const panel = '#projectAnimationTargetReviewPanel', picker = '#projectAnimationTargetReviewSelection';
  const commandRow = sequence => `${panel} .project-animation-target-review-command[data-sequence="${sequence}"]`;
  const completionRow = sequence => `${panel} .project-animation-target-review-completion[data-sequence="${sequence}"]`;
  const commandOpen = sequence => `.project-animation-command[data-sequence="${sequence}"] .project-animation-target-review-open`;
  const completionOpen = sequence => `.project-animation-completion[data-sequence="${sequence}"] .project-animation-completion-target-review-open`;
  const inspect = () => evaluate(`(()=>{const p=document.querySelector('${panel}'),visible=s=>Array.from(p.querySelectorAll(s)).filter(row=>!row.hidden);return {
    hidden:p.hidden,dataset:{...p.dataset},selected:document.querySelector('${picker}').value,
    options:Array.from(document.querySelector('${picker}').options,o=>({value:o.value,text:o.textContent})),
    commands:visible('.project-animation-target-review-command').map(row=>({sequence:Number(row.dataset.sequence),selected:row.dataset.selected,ariaCurrent:row.getAttribute('aria-current'),text:row.innerText})),
    completions:visible('.project-animation-target-review-completion').map(row=>({sequence:Number(row.dataset.sequence),targetCommandSequence:Number(row.dataset.targetCommandSequence),commandSequence:Number(row.dataset.commandSequence),selected:row.dataset.selected,text:row.innerText})),text:p.innerText};})()`);
  async function assertGroup(instanceId, commands, completions) {
    const review = await inspect(); assert.equal(review.hidden,false); assert.equal(review.dataset.targetKind,'instance');
    assert.equal(review.dataset.targetInstanceId,instanceId); assert.equal(review.dataset.visitIndex,'1');
    assert.deepEqual(review.commands.map(row=>row.sequence),commands); assert.deepEqual(review.completions.map(row=>row.sequence),completions);
    return review;
  }
  await enabled(commandOpen(1)); await click(commandOpen(1));
  await wait(()=>evaluate(`!document.querySelector('${panel}').hidden&&document.querySelector('${panel}').dataset.targetInstanceId===${JSON.stringify(instanceA)}`),'review from first command');
  const groupA = await assertGroup(instanceA,[1,2,3,4],[1]);
  assert.equal(groupA.options.filter(option=>option.value).length,2);
  assert.equal(groupA.dataset.selectedKind,'command'); assert.equal(groupA.dataset.selectedSequence,'1');
  assert.equal(groupA.commands.find(row=>row.sequence===1).selected,'true');
  assert.equal(groupA.commands.find(row=>row.sequence===1).ariaCurrent,'true');
  assert.deepEqual(groupA.completions.map(row=>[row.targetCommandSequence,row.commandSequence]),[[4,6]]);
  await evaluate(`document.querySelector('${panel}').scrollIntoView({block:'start'})`); await screenshot('target-review-a-desktop.png');
  await fill('#projectAnimationCommandsSearch',instanceB);
  await assertGroup(instanceA,[1,2,3,4],[1]);
  await fill('#projectAnimationCommandsSearch','');
  const optionB = groupA.options.find(option=>(option.value+' '+option.text).includes(instanceB)); assert.ok(optionB);
  await evaluate(`window.__staleTargetSource=document.querySelector('${commandRow(1)} .project-animation-target-review-command-source')`);
  const beforeSwitch = await evaluate(`(async()=>{const {appState:s}=await import('/web/modules/app-state.js');return {activePath:s.activePath,source:document.querySelector('#docSourceEditor').value};})()`);
  await fill(picker,optionB.value,'change'); await assertGroup(instanceB,[5,6],[2]);
  await evaluate(`window.__staleTargetSource.click()`); await delay(200);
  assert.equal(await evaluate(`document.querySelector('#projectBuildDialog').open`),true);
  assert.deepEqual(await evaluate(`(async()=>{const {appState:s}=await import('/web/modules/app-state.js');return {activePath:s.activePath,source:document.querySelector('#docSourceEditor').value};})()`),beforeSwitch);
  await enabled(commandOpen(3)); await click(commandOpen(3));
  const secondBindingGroup = await assertGroup(instanceA,[1,2,3,4],[1]);
  assert.equal(secondBindingGroup.selected,groupA.selected); assert.equal(secondBindingGroup.dataset.selectedSequence,'3');
  report.groups = {a:groupA,b:await (async()=>{await click(commandOpen(5));return assertGroup(instanceB,[5,6],[2]);})()};
  report.steps.push('Chrome GUI plan/build/run executes protocol 11 through real Godot. Three bindings on two targets issue six real commands and two natural completions. The two bindings on A share one review group; B has a separate group. A retains target anchor 4 while the global cutoff is 6. A source button captured before switching to B cannot navigate after the switch.');
  report.anchors = [];
  for (const completion of completed.entries) {
    await enabled(completionOpen(completion.sequence)); await click(completionOpen(completion.sequence));
    const commands = completion.target.instanceId===instanceA ? [1,2,3,4] : [5,6];
    const review = await assertGroup(completion.target.instanceId,commands,[completion.sequence]);
    assert.equal(review.dataset.selectedKind,'completion'); assert.equal(review.dataset.selectedSequence,String(completion.sequence));
    assert.equal(review.completions[0].selected,'true');
    const anchorSelector = completionRow(completion.sequence)+' .project-animation-target-review-anchor-jump';
    assert.equal(await evaluate(`Number(document.querySelector(${JSON.stringify(anchorSelector)}).dataset.commandSequence)`),completion.targetCommandSequence);
    await enabled(anchorSelector); await click(anchorSelector);
    const anchor = await assertGroup(completion.target.instanceId,commands,[completion.sequence]);
    assert.equal(anchor.dataset.selectedKind,'command'); assert.equal(anchor.dataset.selectedSequence,String(completion.targetCommandSequence));
    assert.equal(anchor.commands.find(row=>row.sequence===completion.targetCommandSequence).selected,'true');
    assert.equal(anchor.commands.find(row=>row.sequence===completion.targetCommandSequence).ariaCurrent,'true');
    report.anchors.push({completionSequence:completion.sequence,target:completion.target,commandSequence:completion.commandSequence,targetCommandSequence:completion.targetCommandSequence,selectedSequence:anchor.dataset.selectedSequence});
  }
  await click('#projectAnimationTargetReviewClose');
  assert.equal(await evaluate(`document.querySelector('${panel}').hidden`),true);
  assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(completionOpen(2))})`),true);
  report.closeRestoresCompletionOpener = true;
  await click(completionOpen(1));
  await evaluate(`(()=>{window.__targetReviewPicker=document.querySelector('${picker}');window.__targetReviewPicker.focus();})()`);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('${panel}').scrollIntoView({block:'start'})`);
    const layout = await evaluate(`(()=>{const d=document.querySelector('#projectBuildDialog'),p=document.querySelector('${panel}'),s=document.querySelector('${picker}');return {noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth&&p.scrollWidth<=p.clientWidth,title:document.querySelector('#projectAnimationTargetReviewTitle').textContent,same:s===window.__targetReviewPicker,focused:document.activeElement===s,selection:s.value,dataset:{...p.dataset},text:p.innerText};})()`);
    assert.equal(layout.noHorizontalOverflow,true,JSON.stringify(layout)); assert.equal(layout.same,true); assert.equal(layout.focused,true);
    assert.equal(layout.selection,groupA.selected); assert.equal(layout.dataset.targetInstanceId,instanceA);
    assert.equal(layout.dataset.selectedKind,'completion'); assert.equal(layout.dataset.selectedSequence,'1');
    report.layout[language]=layout; await screenshot(`target-review-${language}-390.png`);
    await evaluate(`document.querySelector('${completionRow(1)}').scrollIntoView({block:'start'})`);
    await screenshot(`target-review-completion-${language}-390.png`);
  }
  assert.equal(new Set(Object.values(report.layout).map(row=>row.title)).size,3);
  report.steps.push('Both existing command and completion rows open their exact target group and selected record. Natural-completion anchor controls select A command 4 and B command 6, retaining the separate global cutoff. Chinese, English and Japanese preserve the same focused picker, selected group and completion at 390px without horizontal overflow.');
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  report.navigation = [];
  const navigationCases = [
    {kind:'a-first-binding',open:()=>click(commandOpen(1)),selector:commandRow(1)+' .project-animation-target-review-command-source',source:history.entries[0].origin.source},
    {kind:'a-second-binding',open:()=>click(commandOpen(3)),selector:commandRow(3)+' .project-animation-target-review-command-source',source:history.entries[2].origin.source},
    {kind:'b-binding',open:()=>click(commandOpen(5)),selector:commandRow(5)+' .project-animation-target-review-command-source',source:history.entries[4].origin.source},
    {kind:'animation',open:()=>click(completionOpen(1)),selector:completionRow(1)+' .project-animation-target-review-animation-source',source:completed.entries[0].animation.source},
    {kind:'a-clip',open:()=>click(completionOpen(1)),selector:completionRow(1)+' .project-animation-target-review-clip-source',source:completed.entries[0].clip.source},
    {kind:'b-clip',open:()=>click(completionOpen(2)),selector:completionRow(2)+' .project-animation-target-review-clip-source',source:completed.entries[1].clip.source},
    {kind:'b-subscriber',open:()=>click(completionOpen(2)),selector:completionRow(2)+' .project-animation-target-review-subscriber-source',source:completed.entries[1].deliveries[0].origin.source},
  ];
  for(const testCase of navigationCases) {
    if (!await evaluate(`document.querySelector('#projectBuildDialog').open`)) { await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); }
    await testCase.open(); await enabled(testCase.selector); await click(testCase.selector);
    const expectedText = visible(await fs.readFile(path.join(root,testCase.source.sourcePath),'utf8'));
    await wait(()=>evaluate(`!document.querySelector('#projectBuildDialog').open&&!(await import('/web/modules/app-state.js')).appState.isLoadingSource&&document.querySelector('#docSourceEditor').value===${JSON.stringify(expectedText)}`),testCase.kind+' source navigation');
    const location = await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return {start:e.selectionStart,end:e.selectionEnd};})()`);
    if(testCase.source.sourceRange) { assert.equal(location.start,testCase.source.sourceRange.start); assert.equal(location.end,testCase.source.sourceRange.end); }
    report.navigation.push({kind:testCase.kind,source:testCase.source,location});
    if (['a-second-binding','b-binding','b-clip'].includes(testCase.kind)) await screenshot(`target-review-${testCase.kind}-source.png`);
  }
  assert.deepEqual(await authorTree(root),initial); assert.deepEqual(report.errors,[]);
  report.authorSnapshot = {before:initial,after:await authorTree(root),unchanged:true};
  report.steps.push('Frozen source actions open A first binding, A second binding, B binding, animation, each target’s selected clip and B completion subscriber at their exact UTF-16 source ranges. Builds, runs, target selection, anchor jumps, language changes and source navigation leave every author file byte-for-byte unchanged.');
  for(const[file,expected]of Object.entries(report.sources)) assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);
  report.sourceSnapshotUnchanged=true; report.ok=true;
} catch(error){
  report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;
  try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}
} finally{
  socket?.close();
  for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}
  report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));
}
