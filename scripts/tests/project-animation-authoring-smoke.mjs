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
import { projectAnimationControlAuthor } from './helpers/project-animation-control-author-fixture.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/project-animation-controls');
const output = path.resolve(process.env.VIENTO_PROJECT_ANIMATION_AUTHORING_OUTPUT || path.join(evidenceRoot, `browser-authoring-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/project-animation-controls.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: { script: {}, behavior: {} }, limitations: [
  'Actual Chrome with local HTTP editor and a trusted Godot binary. No installed Tauri window, native picker, Android or other desktop OS claim.',
  'The animation-control fixture prepares two saved scenes and a four-command behavior before the author-file baseline. The newly saved built-in starter is verified as ordinary source, while a separate predeclared behavior supplies the actual runtime receipts.',
  'Native Godot headless logic and browser receipt display are tested. No installed Tauri, Android, native window rendering or delivered game execution claim.'
] };
const sources = ['engine/script-authoring.mjs', 'engine/project-animation-commands.mjs', 'web/modules/app-project-animation-observation.js', 'web/modules/app-script-create.js', 'web/script-create.css', 'web/project-animation-observation.css', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/project-animation-authoring-smoke.mjs'];
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
  const authorFixture = await projectAnimationControlAuthor(fixture);
  const root = authorFixture.author, download = path.join(temporary, 'downloads'); await fs.mkdir(download);
  const sceneId = authorFixture.sceneIds[0], assemblyId = authorFixture.assemblyId;
  await authorFixture.script('checkpoint', 'extends Node\nfunc _ready() -> void:\n\tvar p = get_meta("viento_project")\n\tp.pause_animation()\n\tp.seek_animation(0.5)\n\tp.play_animation()\n\tp.stop_animation()\n');
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
  const scriptPath = 'documents/scripts/authored-in-studio.txt', scriptFile = path.join(root, scriptPath);
  const starter = listScriptStarters().find(item => item.id === 'godot-project-animation');
  const openScript = async () => {
    await enabled('#scriptCreateBtn'); await click('#scriptCreateBtn'); await enabled('#scriptCreateApply');
    await fill('#scriptCreateStarter', 'godot-project-animation', 'change'); await fill('#scriptCreateType', 'character', 'change');
    await fill('#scriptCreatePath', scriptPath); await enabled('#scriptCreateApply');
  };
  await enabled('#scriptCreateBtn');
  const beforeEditor = await evaluate(`(async()=>{const {appState:s}=await import('/web/modules/app-state.js');return {activePath:s.activePath,creating:s.isCreating,editing:s.isEditing,source:document.querySelector('#docSourceEditor').value};})()`);
  await openScript();
  assert.equal(await evaluate(`document.querySelectorAll('#scriptCreateStarter option').length`), listScriptStarters().length);
  assert.equal(await evaluate(`document.querySelector('#scriptCreateSource').textContent`), starter.content);
  assert.deepEqual(await authorTree(root), initial);
  await screenshot('script-create-review-desktop.png');
  await call('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:false});
  for (const language of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('.script-create-body').scrollTop=0`);
    const layout = await evaluate(`(()=>{const d=document.querySelector('#scriptCreateDialog'),rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};return {noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,close:rect('#scriptCreateClose'),apply:rect('#scriptCreateApply'),cancel:rect('#scriptCreateCancel'),title:document.querySelector('#scriptCreateTitle').textContent,bodyScrollable:document.querySelector('.script-create-body').scrollHeight>document.querySelector('.script-create-body').clientHeight};})()`);
    assert.equal(layout.noHorizontalOverflow, true); assert.equal(layout.bodyScrollable, true);
    for (const action of ['close','apply','cancel']) assert.ok(layout[action].top>=0&&layout[action].bottom<=844&&layout[action].left>=0&&layout[action].right<=390,JSON.stringify(layout));
    assert.equal(await value('#scriptCreatePath'), scriptPath);
    assert.equal(await value('#scriptCreateStarter'), 'godot-project-animation');
    assert.equal(await value('#scriptCreateType'), 'character');
    assert.equal(await evaluate(`document.querySelector('#scriptCreateSource').textContent`), starter.content);
    assert.equal(await evaluate(`document.querySelector('#scriptCreateApply').disabled`), false);
    report.layout.script[language] = layout; await screenshot(`script-create-${language}-390.png`);
    await evaluate(`document.querySelector('.script-create-body').scrollTop=document.querySelector('.script-create-body').scrollHeight`);
    layout.fullSourceVisible = await evaluate(`(()=>{const p=document.querySelector('#scriptCreateSource'),b=document.querySelector('.script-create-body'),r=p.getBoundingClientRect(),s=b.getBoundingClientRect();return r.bottom<=s.bottom&&p.scrollWidth<=p.clientWidth;})()`);
    assert.equal(layout.fullSourceVisible, true, 'the final source line remains reachable by scrolling the modal body');
    await screenshot(`script-create-${language}-390-source.png`);
  }
  await click('#scriptCreateCancel'); await wait(()=>evaluate(`!document.querySelector('#scriptCreateDialog').open`),'script creation cancelled');
  assert.deepEqual(await authorTree(root), initial);
  assert.deepEqual(await evaluate(`(async()=>{const {appState:s}=await import('/web/modules/app-state.js');return {activePath:s.activePath,creating:s.isCreating,editing:s.isEditing,source:document.querySelector('#docSourceEditor').value};})()`), beforeEditor);
  assert.equal(await evaluate(`window.__scriptSaves.length`), 0);
  report.steps.push('The project animation starter previews every exact script byte. Its command and time parameters, selected path and existing character document type persist in Chinese, English and Japanese at 390px; the final source line is reachable by scrolling. Return/Create/Cancel remain visible. Cancel changes no editor state or author files.');
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await openScript(); await click('#scriptCreateApply');
  await wait(()=>evaluate(`!document.querySelector('#scriptCreateDialog').open&&(await import('/web/modules/app-state.js')).appState.isCreating`),'ordinary new TXT draft');
  await wait(()=>evaluate(`document.activeElement===document.querySelector('#docSourceEditor')`),'new script source focus');
  assert.equal(await value('#docSourceEditor'), starter.content);
  assert.equal(await value('#docCreatePathInput'), scriptPath);
  assert.equal(await value('#docCreateTypeSelect'), 'character');
  assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.editInputMode`), 'source');
  assert.equal(await evaluate(`window.__scriptSaves.length`), 0);
  assert.deepEqual(await authorTree(root), initial, 'creating the draft must not publish a file or registration');
  await screenshot('script-create-unsaved-source-draft.png');
  await enabled('#docSaveBtn'); await click('#docSaveBtn');
  await wait(async()=>{try{return await fs.readFile(scriptFile,'utf8')===starter.content;}catch{return false;}},'ordinary TXT save');
  await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.isCreating&&!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges&&!(await import('/web/modules/app-state.js')).appState.isSaving&&!(await import('/web/modules/app-state.js')).appState.isRebuilding`),'script save and index refresh');
  const scriptSave = await evaluate(`window.__scriptSaves.at(-1)`);
  assert.equal(scriptSave.status, 200); assert.equal(scriptSave.request.content, starter.content); assert.equal(scriptSave.request.documentType, 'character');
  const scriptRecord = (await readRegistry(root)).documents.find(item=>item.sourcePath===scriptPath);
  assert.ok(scriptRecord); scriptId=scriptRecord.id; assert.equal(scriptRecord.documentType,'character'); assert.deepEqual(scriptRecord.relations,[]);
  const afterScript = await authorTree(root);
  assert.deepEqual(Object.keys(afterScript).filter(name=>afterScript[name]!==initial[name]).sort(),[scriptPath,`metadata/documents/${scriptId}.json`].sort());
  for(const [name,hash] of Object.entries(initial)) assert.equal(afterScript[name],hash,`Script save changed old author file: ${name}`);
  const catalogResponse = await fetch(`${base}/api/scene-behavior-directory`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sceneObjectId:sceneId})});
  assert.equal(catalogResponse.status,200); const catalogBody=await catalogResponse.json(),catalog=catalogBody.data||catalogBody;
  assert.ok(catalog.sources.some(item => item.objectId === scriptId && item.sourcePath === scriptPath));
  report.script={starterId:starter.id,sourcePath:scriptPath,objectId:scriptId,documentType:scriptRecord.documentType,sourceSha256:buildHash(Buffer.from(starter.content)),changedAuthorPaths:[scriptPath,`metadata/documents/${scriptId}.json`],sourceFocused:true,ordinarySaveCount:await evaluate(`window.__scriptSaves.length`)};
  await screenshot('script-create-ordinary-save.png');
  report.steps.push('Create script opens the normal TXT source draft and focuses its editor without any file or registration write. Ordinary Save stores the reviewed GDScript bytes under the existing character type, adds only source plus registration, and immediately makes that source visible to the existing behavior source directory.');
  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildScene');
  await fill('#projectBuildScene', assemblyId, 'change'); await enabled('#projectBuildPlan');
  async function perform(selector, kind) {
    const previous = (await state()).job?.id; await enabled(selector); await click(selector); let job;
    await wait(async () => { job = (await state()).job; return job?.kind === kind && job.id !== previous && job.status !== 'running'; }, kind, 90000);
    report.jobs.push(job); assert.equal(job.status, 'succeeded', JSON.stringify(job.diagnostics)); return job;
  }
  await perform('#projectBuildPlan', 'plan'); await perform('#projectBuildGenerate', 'build');
  const ran = await perform('#projectBuildHeadless', 'run'), history = ran.runtime.project.animationCommands;
  assert.equal(ran.runtime.project.protocolVersion, 5); assert.equal(history.sequence, 4);
  assert.deepEqual(history.entries.map(row => [row.command.action,row.state.phase,row.state.positionSeconds,row.state.timeSeconds]), [
    ['pause','paused',0,0], ['seek','paused',.5,0], ['play','playing',.5,0], ['stop','stopped',0,0],
  ]);
  await wait(() => evaluate(`document.querySelector('#projectAnimationCommandsSequence')?.dataset.sequence==='4'&&!document.querySelector('#projectAnimationCommandsPanel').hidden`), 'actual animation command receipts');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#projectAnimationCommandsEntries > li')).map(row=>row.dataset.action)`), ['pause','seek','play','stop']);
  assert.equal(await evaluate(`document.querySelector('#projectSharedStatePanel').hidden`), false);
  assert.equal(await evaluate(`document.querySelector('#projectEventTracePanel').hidden`), false);
  assert.equal(await evaluate(`document.querySelector('#projectAudioCommandsPanel').hidden`), false);
  await evaluate(`document.querySelector('#projectAnimationCommandsPanel').scrollIntoView({block:'start'})`);
  await screenshot('project-animation-commands-desktop.png');
  await fill('#projectAnimationCommandsSearch', history.entries[0].animation.objectId);
  await call('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:false});
  report.layout.observation = {};
  for (const language of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('#projectAnimationCommandsPanel').scrollIntoView({block:'start'})`);
    const layout = await evaluate(`(()=>{const d=document.querySelector('#projectBuildDialog'),panel=document.querySelector('#projectAnimationCommandsPanel');return {noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,title:document.querySelector('#projectAnimationCommandsTitle').textContent,search:document.querySelector('#projectAnimationCommandsSearch').value,count:document.querySelectorAll('#projectAnimationCommandsEntries>li:not([hidden])').length,states:Array.from(panel.querySelectorAll('.project-animation-state')).map(e=>e.textContent)};})()`);
    assert.equal(layout.noHorizontalOverflow, true, JSON.stringify(layout)); assert.equal(layout.count, 4); assert.equal(layout.search, history.entries[0].animation.objectId);
    assert.ok(layout.states[1].includes('0.5')); report.layout.observation[language] = layout;
    await screenshot(`project-animation-commands-${language}-390.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  report.runtime = { jobId: ran.id, history, protocolVersion: 5, actualReceipts: true };
  report.steps.push('The real Build panel plans, generates and runs an assembled project in Godot. Four executed pause/seek/play/stop receipts expose execution phase and separate scene/playhead times. The independent view retains state/event/audio histories and displays the real ledger in Chinese, English and Japanese at 390px without horizontal overflow.');
  report.navigation = [];
  for (const kind of ['behavior', 'animation']) {
    if (kind === 'animation') { await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); }
    const selector = '.project-animation-' + kind + '-source'; await enabled(selector); await click(selector);
    const expected = kind === 'behavior' ? history.entries[0].origin.source : history.entries[0].animation.source;
    const expectedText = visible(await fs.readFile(path.join(root, expected.sourcePath), 'utf8'));
    await wait(() => evaluate(`!document.querySelector('#projectBuildDialog').open&&!(await import('/web/modules/app-state.js')).appState.isLoadingSource&&document.querySelector('#docSourceEditor').value===${JSON.stringify(expectedText)}`), kind + ' source navigation');
    const location = await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return {start:e.selectionStart,end:e.selectionEnd,selected:e.value.slice(e.selectionStart,e.selectionEnd)};})()`);
    if (expected.sourceRange) { assert.equal(location.start, expected.sourceRange.start); assert.equal(location.end, expected.sourceRange.end); }
    report.navigation.push({ kind, source: expected, location }); await screenshot(`project-animation-${kind}-source.png`);
  }
  assert.deepEqual(await authorTree(root), afterScript); assert.deepEqual(report.errors, []);
  report.steps.push('Separate read-only controls open the frozen behavior declaration and animation declaration at their own registered source paths. Runtime execution and source navigation leave all author files unchanged after the single deliberate TXT save.');
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
