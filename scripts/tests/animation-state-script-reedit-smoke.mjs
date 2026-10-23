// Actual browser script starter authoring and real Godot animation command receipts.
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
import { readRegistry } from '../lib/workspace.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';
import { generateEditableGodotAnimationStateScript as generateGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';

const table = {initialState:'idle',states:[{key:'idle'},{key:'attack'},{key:'walk'}],transitions:[
  {from:'idle',to:'attack',trigger:{kind:'event',name:'action'}},
  {from:'attack',to:'idle',trigger:{kind:'completed'}},
  {from:'idle',to:'walk',trigger:{kind:'event',name:'move'}},
  {from:'walk',to:'idle',trigger:{kind:'event',name:'stop'}},
  {from:'walk',to:'attack',trigger:{kind:'event',name:'action'}},
]};

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/animation-state-reedit');
const output = path.resolve(process.env.VIENTO_ANIMATION_STATE_REEDIT_OUTPUT || path.join(evidenceRoot, `browser-authoring-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/animation-state-reedit.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: { script: {}, behavior: {} }, limitations: [
  'Actual Chrome with local HTTP editor and a trusted Godot binary. No installed Tauri window, native picker, Android or other desktop OS claim.',
  'A disposable fixture prepares scenes, clips and a bound state-table controller. Actual GUI changes its event transitions, applies a draft, saves the same TXT and runs that newly saved source. OC creation and initial binding are fixture setup, not GUI coverage.',
  'Native Godot headless logic and browser receipt display are tested. No installed Tauri, Android, native window rendering or delivered game execution claim.'
] };
const sources = ['engine/script-authoring.mjs', 'engine/project-animation-commands.mjs', 'web/modules/app-project-animation-observation.js', 'web/modules/app-script-create.js', 'web/script-create.css', 'web/project-animation-observation.css', 'web/modules/app-project-animation-completion-observation.js', 'web/project-animation-completion-observation.css', 'engine/project-animation-completions.mjs', 'engine/project-runtime-events.mjs', 'engine/project-runtime-query.mjs', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/animation-state-script-reedit-smoke.mjs', 'engine/godot-animation-state-script.mjs', 'engine/animation-state-table-core.mjs', 'engine/studio-core.mjs', 'engine/studio-core.wasm', 'web/modules/app-animation-state-script.js', 'web/animation-state-script.css','engine/animation-state-script-source.mjs','engine/animation-state-script-edit.mjs','web/modules/app-animation-state-script-source.js','web/modules/app-animation-state-script-edit.js','web/animation-state-script-edit.css','web/modules/app-studio-system.js','web/modules/app-runtime.js'];
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
  const attackId = authorFixture.clipIds[0][1], idleId = authorFixture.clipIds[0][0];
  await authorFixture.edit('documents/animations/scene-0.json', document => { document.clips[1].endSeconds = .75; });
  const generated = generateGodotAnimationStateScript(table);
  const originalTable={...table,transitions:table.transitions.map(edge=>edge.trigger.name==='action'?{...edge,trigger:{kind:'event',name:'before-edit'}}:edge)};
  const original=generateGodotAnimationStateScript(originalTable).content;
  await authorFixture.script('checkpoint', original);
  await authorFixture.configure({clip_idle:idleId,clip_attack:attackId,clip_walk:idleId});
  await authorFixture.script('publisher', `extends Node\nfunc _ready() -> void:\n\tcall_deferred("publish")\nfunc publish() -> void:\n\tget_meta("viento_project").publish_event("action", true)\n`);
  let scriptId;
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
  const visible = content => content.replace(/\r\n?/g, '\n');
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,system:(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()})`); report.serviceFailure = await state(); report.editorFailure = await evaluate(`(()=>import('/web/modules/app-state.js').then(({appState:s})=>({isSaving:s.isSaving,isRebuilding:s.isRebuilding,isMutatingWorld:s.isMutatingWorld,dirty:s.editHasUnsavedChanges,creating:s.isCreating,planDisabled:document.querySelector('#projectBuildPlan')?.disabled,behaviorDisabled:document.querySelector('#sceneBehaviorsBtn')?.disabled})))()`); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: download, eventsEnabled: true });
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor startup');
  await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.includes('scenes/demo'))`), 'saved scene in sidebar');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scenes/demo')).click()`);
  await evaluate(`(() => {window.__behaviorCreates=[];window.__scriptSaves=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const response=await original(input,init);let body;try{body=JSON.parse(init?.body||'null')}catch{};if(body?.command==='behavior.create'){const result=await response.clone().json();window.__behaviorCreates.push({request:body,result:result.data||result});}if(body?.create===true&&new URL(typeof input==='string'?input:input.url,location.href).pathname==='/api/doc'){const result=await response.clone().json();window.__scriptSaves.push({request:body,result:result.data||result,status:response.status});}return response;};})()`);
  const scriptPath = 'documents/scripts/checkpoint.txt', scriptFile=path.join(root,scriptPath);
  const scriptRecord=(await readRegistry(root)).documents.find(row=>row.sourcePath===scriptPath);assert.ok(scriptRecord);
  // Both forms live at once; their independent tables must not duplicate IDs.
  await enabled('#scriptCreateBtn'); await click('#scriptCreateBtn'); await enabled('#scriptCreateApply');
  await fill('#scriptCreateStarter','godot-project-animation-state-table','change'); await enabled('#scriptCreateApply');
  assert.match(await evaluate(`document.querySelector('#scriptCreateSource').textContent`),/^# Viento animation state script\n#@viento-animation-state-script /);
  await click('#scriptCreateCancel');await wait(()=>evaluate(`!document.querySelector('#scriptCreateDialog').open`),'cancel creation');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scripts/checkpoint')).click()`);
  await wait(()=>evaluate(`document.querySelector('#docSourceEditor').value===${JSON.stringify(original)}`),'saved controller');
  await enabled('#docEditBtn'); await click('#docEditBtn');
  await wait(()=>evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`),'enter existing source editing');
  await enabled('#animationStateScriptEditBtn');
  assert.equal(await evaluate(`(()=>{const ids=Array.from(document.querySelectorAll('[id]'),e=>e.id);return ids.length===new Set(ids).size;})()`),true);
  const beforeEditor=await value('#docSourceEditor');
  assert.equal(await evaluate(`document.querySelector('#docTitle')?.textContent||''`),'Viento animation state script');
  const openEdit=async()=>{
    await enabled('#animationStateScriptEditBtn');await click('#animationStateScriptEditBtn');
    await enabled('#animationStateScriptEditCheck');
    assert.equal(await value('#animationStateScriptEditTableTransition1Event'),'before-edit');
    await fill('#animationStateScriptEditTableTransition1Event','action');
    await fill('#animationStateScriptEditTableTransition5Event','action');
    await click('#animationStateScriptEditCheck');await enabled('#animationStateScriptEditApply');
    assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditBefore').textContent`),original);
    assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditAfter').textContent`),generated.content);
  };
  await openEdit();await screenshot('reedit-review-desktop.png');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  report.layout.editor={};
  for(const language of ['zh-CN','en','ja']){
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#animationStateScriptEditDialog'),rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};return {fits:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,close:rect('#animationStateScriptEditClose'),apply:rect('#animationStateScriptEditApply'),cancel:rect('#animationStateScriptEditCancel')};})()`);
    assert.equal(layout.fits,true);for(const name of ['close','apply','cancel'])assert.ok(layout[name].left>=0&&layout[name].right<=390&&layout[name].top>=0&&layout[name].bottom<=844,JSON.stringify(layout));
    assert.equal(await value('#animationStateScriptEditTableTransition1Event'),'action');
    assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditAfter').textContent`),generated.content);
    await evaluate(`document.querySelector('#animationStateScriptEditTableTransitions').scrollIntoView({block:'start'})`);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('#animationStateScriptEditTablePanel input,#animationStateScriptEditTablePanel select')).every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})`),true);
    await screenshot(`reedit-table-${language}-390.png`);
    await evaluate(`document.querySelector('#animationStateScriptEditAfter').scrollIntoView({block:'end'})`);
    await screenshot(`reedit-source-${language}-390.png`);report.layout.editor[language]=layout;
  }
  await click('#animationStateScriptEditCancel');await wait(()=>evaluate(`!document.querySelector('#animationStateScriptEditDialog').open`),'cancel edit');
  assert.equal(await value('#docSourceEditor'),beforeEditor);assert.deepEqual(await authorTree(root),initial);
  report.steps.push('New scripts carry a versioned table declaration; creation and re-edit forms have unique IDs. A saved bound TXT reopens into the table, edits two event edges, previews exact before/after source in three languages at390px, and cancellation leaves editor and author files unchanged.');
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  // Handwritten code invalidates structured editing, even with a plausible header.
  const customSource=original+'\n# custom code must survive\n';await fill('#docSourceEditor',customSource);
  await enabled('#animationStateScriptEditBtn');await click('#animationStateScriptEditBtn');
  await wait(()=>evaluate(`!document.querySelector('#animationStateScriptEditDialog').getAttribute('aria-busy')||document.querySelector('#animationStateScriptEditDialog').getAttribute('aria-busy')==='false'`),'modified source read');
  assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),true);
  await screenshot('reedit-handwritten-preserved.png');await click('#animationStateScriptEditCancel');
  await wait(()=>evaluate(`!document.querySelector('#animationStateScriptEditDialog').open`),'close unsupported source');
  assert.equal(await value('#docSourceEditor'),customSource);assert.deepEqual(await authorTree(root),initial);
  await fill('#docSourceEditor',original);await openEdit();await click('#animationStateScriptEditApply');
  await wait(()=>evaluate(`!document.querySelector('#animationStateScriptEditDialog').open&&document.querySelector('#docSourceEditor').value===${JSON.stringify(generated.content)}`),'apply revised source draft');
  assert.deepEqual(await authorTree(root),initial);assert.equal(await fs.readFile(scriptFile,'utf8'),original);
  assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`),true);
  await screenshot('reedit-unsaved-source.png');
  await enabled('#animationStateScriptEditBtn');await click('#animationStateScriptEditBtn');await enabled('#animationStateScriptEditCheck');
  assert.equal(await value('#animationStateScriptEditTableTransition1Event'),'action','reopen reads current dirty draft, not disk');
  await click('#animationStateScriptEditCheck');
  await wait(()=>evaluate(`document.querySelector('#animationStateScriptEditCheck').disabled===false`),'no-op check');
  assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),true);
  await click('#animationStateScriptEditCancel');await wait(()=>evaluate(`!document.querySelector('#animationStateScriptEditDialog').open`),'close no-op');
  await enabled('#docSaveBtn');await click('#docSaveBtn');
  await wait(async()=>await fs.readFile(scriptFile,'utf8')===generated.content,'ordinary re-edit Save');
  await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.isSaving&&!(await import('/web/modules/app-state.js')).appState.isRebuilding&&!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`),'saved baseline');
  const afterScript=await authorTree(root);
  assert.deepEqual(Object.keys(afterScript).filter(name=>afterScript[name]!==initial[name]),[scriptPath]);
  assert.deepEqual((await readRegistry(root)).documents.find(row=>row.id===scriptRecord.id),scriptRecord);
  assert.equal(await evaluate(`window.__scriptSaves.length`),0,'same-file update never becomes a create request');
  report.script={sourcePath:scriptPath,objectId:scriptRecord.id,changedAuthorPaths:[scriptPath],sourceSha256:buildHash(Buffer.from(generated.content))};
  await screenshot('reedit-saved-source.png');
  report.steps.push('Modified handwritten source is preserved and cannot be overwritten by the table. Apply changes only the current source draft; reopening uses that unsaved draft and no-op cannot write. Ordinary Save changes only the existing TXT, preserving object identity, registration and behavior bindings.');
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
  assert.equal(ran.runtime.project.protocolVersion, 9); assert.equal(history.sequence, 6); assert.equal(completed.sequence, 1);
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
  report.runtime={jobId:ran.id,history,completed,protocolVersion:9,actualReceipts:true};
  report.steps.push('Real GUI planning, build and Godot run execute initial idle → event attack → one natural completion → looped idle through the exact controller source just edited and saved in the GUI. Separate completion and command panels display actual frozen histories; three languages at390px retain search and have no horizontal overflow.');
  report.navigation=[];
  // Source buttons are obtained by their declared source kind, never text labels.
  for(const kind of ['animation','clip','subscriber']) {
    if(kind!=='animation'){await enabled('#projectBuildBtn');await click('#projectBuildBtn');}
    const selector='.project-animation-completion-'+kind+'-source';await enabled(selector);await click(selector);
    const expected=kind==='subscriber'?completed.entries[0].deliveries[0].origin.source:completed.entries[0][kind].source;
    const expectedText=visible(await fs.readFile(path.join(root,expected.sourcePath),'utf8'));
    await wait(()=>evaluate(`!document.querySelector('#projectBuildDialog').open&&!(await import('/web/modules/app-state.js')).appState.isLoadingSource&&document.querySelector('#docSourceEditor').value===${JSON.stringify(expectedText)}`),kind+' source navigation');
    const location=await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return {start:e.selectionStart,end:e.selectionEnd};})()`);
    if(expected.sourceRange){assert.equal(location.start,expected.sourceRange.start);assert.equal(location.end,expected.sourceRange.end);}
    report.navigation.push({kind,source:expected,location});await screenshot(`completion-${kind}-source.png`);
  }
  assert.deepEqual(await authorTree(root), afterScript); assert.deepEqual(report.errors, []);
  report.steps.push('Separate read-only controls open the frozen animation, clip and subscribing behavior declarations at their exact registered source locations. Runtime execution and source navigation leave all author files unchanged after the deliberate same-file TXT save.');
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
