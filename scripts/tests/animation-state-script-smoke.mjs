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
const evidenceRoot = path.join(appRoot, 'docs/test-results/animation-state-table');
const output = path.resolve(process.env.VIENTO_ANIMATION_STATE_TABLE_OUTPUT || path.join(evidenceRoot, `browser-authoring-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/animation-state-table.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: { script: {}, behavior: {} }, limitations: [
  'Actual Chrome with local HTTP editor and a trusted Godot binary. No installed Tauri window, native picker, Android or other desktop OS claim.',
  'The disposable fixture prepares two scenes, attack/idle clips and exactly the custom controller source generated in the UI below before the baseline. GUI ordinary-save and this prepared runtime are separate; HTTP tests connect newly saved generated scripts to actual native execution.',
  'Native Godot headless logic and browser receipt display are tested. No installed Tauri, Android, native window rendering or delivered game execution claim.'
] };
const sources = ['engine/script-authoring.mjs', 'engine/project-animation-commands.mjs', 'web/modules/app-project-animation-observation.js', 'web/modules/app-script-create.js', 'web/script-create.css', 'web/project-animation-observation.css', 'web/modules/app-project-animation-completion-observation.js', 'web/project-animation-completion-observation.css', 'engine/project-animation-completions.mjs', 'engine/project-runtime-events.mjs', 'engine/project-runtime-query.mjs', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/animation-state-script-smoke.mjs', 'engine/godot-animation-state-script.mjs', 'engine/animation-state-table-core.mjs', 'engine/studio-core.mjs', 'engine/studio-core.wasm', 'web/modules/app-animation-state-script.js', 'web/animation-state-script.css'];
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
  await authorFixture.script('checkpoint', generated.content);
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
  const scriptPath = 'documents/scripts/authored-in-studio.txt', scriptFile = path.join(root, scriptPath);
  const starter = {...listScriptStarters().find(item => item.id === 'godot-project-animation-state-table'), content:generated.content};
  const chooseState = (selector,key) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),o=Array.from(e.options).find(x=>x.dataset.stateKey===${JSON.stringify(key)});if(!o)throw Error('missing state '+${JSON.stringify(key)});e.value=o.value;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const openScript = async () => {
    await enabled('#scriptCreateBtn'); await click('#scriptCreateBtn'); await enabled('#scriptCreateApply');
    await fill('#scriptCreateStarter', 'godot-project-animation-state-table', 'change'); await fill('#scriptCreateType', 'character', 'change');
    await fill('#scriptCreatePath', scriptPath);
    await fill('#animationStateScriptState2Key','attack');
    await click('#animationStateScriptAddState'); await fill('#animationStateScriptState3Key','walk');
    for (const [offset,edge] of table.transitions.slice(2).entries()) {
      await click('#animationStateScriptAddTransition'); const n=offset+3;
      await chooseState(`#animationStateScriptTransition${n}From`,edge.from);
      await chooseState(`#animationStateScriptTransition${n}To`,edge.to);
      await fill(`#animationStateScriptTransition${n}Kind`,'event','change');
      await fill(`#animationStateScriptTransition${n}Event`,edge.trigger.name);
    }
    await enabled('#scriptCreateApply');
  };
  await enabled('#scriptCreateBtn');
  const beforeEditor = await evaluate(`(async()=>{const {appState:s}=await import('/web/modules/app-state.js');return {activePath:s.activePath,creating:s.isCreating,editing:s.isEditing,source:document.querySelector('#docSourceEditor').value};})()`);
  await openScript();
  assert.equal(await evaluate(`document.querySelectorAll('#scriptCreateStarter option').length`), listScriptStarters().length);
  assert.equal(await evaluate(`document.querySelector('#scriptCreateSource').textContent`), starter.content);
  assert.deepEqual(await authorTree(root), initial);
  assert.notEqual(starter.content,listScriptStarters().find(row=>row.id===starter.id).content);
  await screenshot('script-create-review-desktop.png');
  await click('#animationStateScriptState3Remove');
  assert.equal(await evaluate(`document.querySelector('#scriptCreateApply').disabled`),true);
  assert.equal(await evaluate(`document.querySelector('#scriptCreateSource').textContent`),'');
  await screenshot('state-table-missing-reference.png');
  await click('#animationStateScriptAddState'); await fill('#animationStateScriptState4Key','walk');
  assert.equal(await evaluate(`document.querySelector('#scriptCreateApply').disabled`),true,'recreating a spelling must not silently rebind removed state references');
  await chooseState('#animationStateScriptTransition3To','walk');
  await chooseState('#animationStateScriptTransition4From','walk');
  await chooseState('#animationStateScriptTransition5From','walk');
  await enabled('#scriptCreateApply');
  assert.equal(await evaluate(`document.querySelector('#scriptCreateSource').textContent`),starter.content);
  report.steps.push('Deleting a referenced state blocks generation and clears the obsolete source preview. Recreating the same spelling does not silently rebind old rows; explicit selection restores a valid table and the exact expected source.');

  await call('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:false});
  for (const language of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('.script-create-body').scrollTop=0`);
    const layout = await evaluate(`(()=>{const d=document.querySelector('#scriptCreateDialog'),rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};return {noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,close:rect('#scriptCreateClose'),apply:rect('#scriptCreateApply'),cancel:rect('#scriptCreateCancel'),title:document.querySelector('#scriptCreateTitle').textContent,bodyScrollable:document.querySelector('.script-create-body').scrollHeight>document.querySelector('.script-create-body').clientHeight};})()`);
    assert.equal(layout.noHorizontalOverflow, true); assert.equal(layout.bodyScrollable, true);
    for (const action of ['close','apply','cancel']) assert.ok(layout[action].top>=0&&layout[action].bottom<=844&&layout[action].left>=0&&layout[action].right<=390,JSON.stringify(layout));
    assert.equal(await value('#scriptCreatePath'), scriptPath);
    assert.equal(await value('#scriptCreateStarter'), 'godot-project-animation-state-table');
    assert.equal(await value('#scriptCreateType'), 'character');
    assert.equal(await evaluate(`document.querySelector('#scriptCreateSource').textContent`), starter.content);
    assert.equal(await evaluate(`document.querySelector('#scriptCreateApply').disabled`), false);
    report.layout.script[language] = layout; await screenshot(`script-create-${language}-390.png`);
    await evaluate(`document.querySelector('#animationStateScriptTransitions').scrollIntoView({block:'start'})`);
    layout.tableFitsWidth = await evaluate(`(()=>{const nodes=Array.from(document.querySelectorAll('#animationStateScriptPanel input,#animationStateScriptPanel select'));return nodes.every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;});})()`);
    assert.equal(layout.tableFitsWidth,true,'state and transition controls fit the narrow viewport');
    await screenshot(`state-table-${language}-390.png`);
    await evaluate(`document.querySelector('.script-create-body').scrollTop=document.querySelector('.script-create-body').scrollHeight`);
    layout.fullSourceVisible = await evaluate(`(()=>{const p=document.querySelector('#scriptCreateSource'),b=document.querySelector('.script-create-body'),r=p.getBoundingClientRect(),s=b.getBoundingClientRect();return r.bottom<=s.bottom&&p.scrollWidth<=p.clientWidth;})()`);
    assert.equal(layout.fullSourceVisible, true, 'the final source line remains reachable by scrolling the modal body');
    await screenshot(`script-create-${language}-390-source.png`);
  }
  await click('#scriptCreateCancel'); await wait(()=>evaluate(`!document.querySelector('#scriptCreateDialog').open`),'script creation cancelled');
  assert.deepEqual(await authorTree(root), initial);
  assert.deepEqual(await evaluate(`(async()=>{const {appState:s}=await import('/web/modules/app-state.js');return {activePath:s.activePath,creating:s.isCreating,editing:s.isEditing,source:document.querySelector('#docSourceEditor').value};})()`), beforeEditor);
  assert.equal(await evaluate(`window.__scriptSaves.length`), 0);
  report.steps.push('The state-table generator previews every exact custom script byte. Its renamed attack state, added walk state, five transition rows, selected path and existing character document type persist in Chinese, English and Japanese at 390px; the final source line is reachable by scrolling. Return/Create/Cancel remain visible. Cancel changes no editor state or author files.');
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
  report.steps.push('Real GUI planning, build and Godot run execute initial idle → event attack → one natural completion → looped idle through the same generated state-table source. Separate completion and command panels display actual frozen histories; three languages at390px retain search and have no horizontal overflow.');
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
  report.steps.push('Separate read-only controls open the frozen animation, clip and subscribing behavior declarations at their exact registered source locations. Runtime execution and source navigation leave all author files unchanged after the single deliberate TXT save.');
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
