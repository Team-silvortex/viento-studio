// Actual Chrome tests manual event samples independently of author drafts, then runs the existing frozen Godot project.
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
import { generateEditableGodotAnimationStateScript as generateGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';

import '../adapters/node-studio-core.mjs';

const table = { eventSelection: 'firstMatch', initialState:'idle', states:[{key:'idle'},{key:'attack'}], transitions:[
  {from:'idle',to:'attack',trigger:{kind:'event',name:'action',condition:{combine:'all',conditions:[
    {type:'boolean',operator:'eq',value:true,selector:{kind:'projectState',key:'combat.enabled'}},
    {type:'number',operator:'gte',value:3}
  ]}}},
  {from:'idle',to:'idle',trigger:{kind:'event',name:'action',condition:{combine:'any',conditions:[
    {type:'number',operator:'gt',value:0},
    {type:'boolean',operator:'eq',value:true,selector:{kind:'projectState',key:'combat.fallback'}}
  ]}}},
  {from:'idle',to:'idle',trigger:{kind:'event',name:'action'}},
  {from:'attack',to:'idle',trigger:{kind:'completed'}}
] };

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/animation-state-trial-case-editor');
const output = path.resolve(process.env.VIENTO_ANIMATION_TRIAL_CASE_EDITOR_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/animation-state-trial-case-editor.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome HTTP editor and Godot headless execution in a disposable workspace; no installed Tauri, Android, Bevy or native visual rendering claim.',
  'Manual preview assumes a current active controller and fixed shared-state sample. It predicts table selection, not playback success, event delivery history or script side effects.',
  'Fixture creates and binds the saved v5 table. Chrome checks new-script and re-edit preview, exact source preservation, samples, field location, languages, and actual GUI project plan/build/run.'
] };
const sources = ['web/modules/app-animation-state-trial-case-editor.js','web/animation-state-trial-case-editor.css','engine/animation-state-trial-case.mjs','engine/animation-state-trial-sequence.mjs','web/modules/app-animation-state-trial-case.js','web/animation-state-trial-case.css','engine/animation-state-event-preview.mjs','engine/animation-state-conditions-core.mjs','engine/studio-core.mjs','engine/studio-core.wasm',
  'engine/godot-animation-state-script.mjs','engine/godot-animation-state-conditions-script.mjs','engine/godot-animation-branches-script.mjs','engine/godot-animation-selectors-script.mjs','engine/godot-animation-combinations-script.mjs',
  'web/modules/app-animation-state-event-preview.js','web/animation-state-event-preview.css','web/modules/app-animation-state-script.js',
  'web/modules/app-script-create.js','web/modules/app-animation-state-script-edit.js','web/i18n/en.js','web/i18n/ja.js',
  'scripts/backends/godot4-project.mjs','scripts/backends/godot4-adapter.mjs','scripts/tests/animation-state-trial-case-editor-smoke.mjs'];
report.sources = Object.fromEntries(await Promise.all(sources.map(async name => [name, buildHash(await fs.readFile(path.join(appRoot, name)))])));
report.node = { version: process.version, sha256: buildHash(await fs.readFile(process.execPath)) };
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to an absolute Godot executable.');
report.tool = {sha256:buildHash(await fs.readFile(tool))};
report.jobs = [];
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
  const original=generateGodotAnimationStateScript(table).content;
  await authorFixture.script('checkpoint',original);
  await authorFixture.configure({clip_idle:idleId,clip_attack:attackId});
  await authorFixture.script('publisher','extends Node\nfunc _ready() -> void:\n\tvar project = get_meta("viento_project")\n\tproject.write_state("combat.enabled", true)\n\tproject.publish_event("action", 3)\n');
  const manifestPath = 'documents/behaviors/demo.json', manifestFile = path.join(root, manifestPath);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
    VIENTO_GODOT_BIN:tool, VIENTO_EXECUTION_BACKEND: 'org.viento.godot4', XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
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
  const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  const createPrefix='animationStateScript', editPrefix='animationStateScriptEditTable';
  const preview = prefix => '#' + prefix + 'EventPreview';
  const inspect = p => evaluate(`(()=>({hidden:document.querySelector('${p}Result').hidden,summary:document.querySelector('${p}Summary').textContent,
    candidates:Array.from(document.querySelectorAll('${p}Candidates > li'),row=>({status:row.dataset.status,leaves:Array.from(row.querySelectorAll('.animation-state-event-preview-leaf'),leaf=>({status:leaf.dataset.status,text:leaf.innerText}))}))}))()`);
  const runSample = async (p, number) => { await fill(p+'PayloadType','number','change');await fill(p+'PayloadNumber',String(number));await enabled(p+'Run');await click(p+'Run');assert.equal((await inspect(p)).hidden,false);return inspect(p); };
  const shared = async (p, key, value) => {
    const row = `${p}SharedStates .animation-state-event-preview-shared-row[data-key="${key}"]`;
    await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(row)}),t=r.querySelector('select[id$="Type"]'),v=r.querySelector('select[id$="Boolean"]');t.value='boolean';t.dispatchEvent(new Event('change',{bubbles:true}));v.value=${JSON.stringify(String(value))};v.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  };
  await enabled('#scriptCreateBtn');await click('#scriptCreateBtn');await enabled('#scriptCreateApply');
  await fill('#scriptCreateStarter','godot-project-animation-state-table','change');await enabled('#scriptCreateApply');
  const createSource=await text('#scriptCreateSource'), cp=preview(createPrefix);await click(cp+'Toggle');
  await runSample(cp,3);await click(cp+'Adopt');assert.equal(await evaluate(`document.querySelector('${cp}HistoryList').children.length`),1);await click(cp+'Undo');assert.equal(await evaluate(`document.querySelector('${cp}HistoryList').children.length`),0);assert.equal(await text('#scriptCreateSource'),createSource);
  assert.equal(await evaluate(`document.querySelector('#scriptCreateApply').disabled`),false);
  await evaluate(`document.querySelector('${cp}Body').scrollIntoView({block:'start'})`);await screenshot('preview-create-desktop.png');
  await click('#scriptCreateCancel');await wait(()=>evaluate(`!document.querySelector('#scriptCreateDialog').open`),'cancel creation');
  assert.deepEqual(await authorTree(root),initial);
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scripts/checkpoint')).click()`);
  await wait(()=>evaluate(`document.querySelector('#docSourceEditor').value===${JSON.stringify(original)}`),'saved v5 source');
  await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`),'source editing');
  const openEdit=async()=>{await enabled('#animationStateScriptEditBtn');await click('#animationStateScriptEditBtn');await enabled('#animationStateScriptEditCheck');};
  await openEdit();
  // A no-op table intentionally has no applicable proposal. Add one unused state
  // locally to obtain a real review; the transition rules remain identical.
  await click('#'+editPrefix+'AddState');await fill('#'+editPrefix+'State3Key','unused');
  await click('#animationStateScriptEditCheck');await enabled('#animationStateScriptEditApply');
  const reviewed=await text('#animationStateScriptEditAfter');assert.notEqual(reviewed,original);
  assert.equal(reviewed,generateGodotAnimationStateScript({...table,states:[...table.states,{key:'unused'}]}).content);
  report.reviewFixture='One unused state is added only to the local draft to obtain a non-no-op source review; event transitions stay identical. The complete draft is cancelled before the saved project runs.';
  const p=preview(editPrefix);await click(p+'Toggle');
  let result=await runSample(p,3);assert.deepEqual(result.candidates.map(row=>row.status),['rejected','selected','not-evaluated']);
  assert.match(result.candidates[0].leaves[0].text,/缺失/);assert.equal(result.candidates[0].leaves[1].status,'not-evaluated');
  assert.equal(result.candidates[1].leaves[1].status,'not-evaluated');report.missing=result;
  await shared(p,'combat.enabled',true);await enabled(p+'Run');await click(p+'Run');result=await inspect(p);
  assert.deepEqual(result.candidates.map(row=>row.status),['selected','not-evaluated','not-evaluated']);report.selected=result;
  await evaluate(`document.querySelector('${p}Result').scrollIntoView({block:'start'})`);await screenshot('preview-first-match.png');
  result=await runSample(p,0);assert.deepEqual(result.candidates.map(row=>row.status),['rejected','rejected','selected']);report.fallback=result;
  await click(p+'Transition3Locate');assert.equal(await evaluate('document.activeElement.id'),editPrefix+'Transition3From');
  result=await runSample(p,2);assert.deepEqual(result.candidates.map(row=>row.status),['rejected','selected','not-evaluated']);report.shortCircuit=result;
  assert.equal(result.candidates[1].leaves[1].status,'not-evaluated');
  assert.equal(await text('#animationStateScriptEditAfter'),reviewed);assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),false);
  await fill(p+'PayloadNumber','1e-');assert.equal(await evaluate(`document.querySelector('${p}Run').disabled`),true);assert.equal((await inspect(p)).hidden,true);
  await runSample(p,2);await fill(p+'EventName','unknown.event');await click(p+'Run');assert.equal((await inspect(p)).candidates.length,0);
  await fill(p+'EventName','action');await runSample(p,3);
  assert.equal(await text('#animationStateScriptEditAfter'),reviewed);assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),false);
  report.steps.push('New-script and re-edit samples leave generated source, draft and author bytes unchanged. Missing shared keys, all/any short circuit, first-match selection, fallback, unknown events and invalid numeric input are explicit; field location selects the corresponding author row.');
  const stepCount=()=>evaluate(`document.querySelector('${p}HistoryList').children.length`);
  await click(p+'Adopt');assert.equal(await value(p+'CurrentState'),'attack');assert.equal(await stepCount(),1);assert.equal((await inspect(p)).hidden,true);
  await fill(p+'TriggerKind','completed','change');await enabled(p+'Run');await click(p+'Run');
  assert.equal((await inspect(p)).candidates[0].status,'selected');assert.equal(await value(p+'CurrentState'),'attack');
  await click(p+'Adopt');assert.equal(await value(p+'CurrentState'),'idle');assert.equal(await stepCount(),2);
  await fill(p+'PayloadNumber','1e-');await enabled(p+'Run');await click(p+'Run');assert.equal((await inspect(p)).candidates.length,0);
  await click(p+'Undo');assert.equal(await value(p+'CurrentState'),'attack');assert.equal(await value(p+'TriggerKind'),'completed');assert.equal(await stepCount(),1);assert.equal((await inspect(p)).hidden,true);
  await enabled(p+'Run');await click(p+'Run');await click(p+'Adopt');assert.equal(await value(p+'CurrentState'),'idle');assert.equal(await stepCount(),2);
  await fill(p+'TriggerKind','event','change');await fill(p+'EventName','unconfigured');await runSample(p,3);await click(p+'Adopt');assert.equal(await stepCount(),3);assert.equal(await value(p+'CurrentState'),'idle');
  await click(p+'Undo');assert.equal(await stepCount(),2);assert.equal(await value(p+'EventName'),'unconfigured');
  await fill(p+'EventName','action');await runSample(p,3);assert.equal((await inspect(p)).candidates[0].status,'selected');
  assert.equal(await text('#animationStateScriptEditAfter'),reviewed);assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),false);
  await evaluate(`(()=>{const d=document.querySelector('${p}HistoryList details');d.open=true;d.dispatchEvent(new Event('toggle'));document.querySelector('${p}History').scrollIntoView({block:'start'});})()`);await screenshot('sequence-history-desktop.png');
  report.steps.push('Explicit adoption advances idle to attack; assumed matching completion advances attack to idle. Undo restores the previous complete sample; unknown event records a no-change step. Hidden invalid event numeric input does not block completion. History and adopted state do not modify source approval.');
  const c=p+'Case',e=c+'Editor';
  await enabled(c+'Create');await click(c+'Create');assert.equal(await evaluate(`document.querySelector('${e}Panel').hidden`),false);
  assert.equal(JSON.parse(await value(e+'Text')).steps.length,2);assert.equal(await evaluate(`document.querySelector('${c}Loaded').hidden`),true);
  await click(e+'Check');await enabled(e+'Apply');await click(e+'Apply');assert.equal(await evaluate(`document.querySelector('${c}Loaded').hidden`),false);assert.equal(await evaluate(`document.querySelector('${c}Result').hidden`),true);
  await enabled(c+'Run');await click(c+'Run');assert.equal(await evaluate(`document.querySelector('${c}Result').dataset.status`),'passed');await click(c+'Clear');

  await enabled(c+'Export');await click(c+'Export');
  let exported;
  await wait(async()=>{const names=(await fs.readdir(download)).filter(name=>name.endsWith('.json'));if(names.length){exported=path.join(download,names[0]);return true;}return false;},'downloaded manual case');
  const exportedText=await fs.readFile(exported,'utf8'), exportedCase=JSON.parse(exportedText);
  assert.equal(exportedCase.format,'viento.animation-state-trial-case');assert.equal(exportedCase.steps.length,2);
  assert.deepEqual(exportedCase.steps.map(step=>step.expected),[{stateKey:'attack',transition:true},{stateKey:'idle',transition:true}]);
  await call('Page.setInterceptFileChooserDialog',{enabled:true});
  async function importCase(file){
    await enabled(c+'Import');await click(c+'Import');
    const {root:dom}=await call('DOM.getDocument');const {nodeId}=await call('DOM.querySelector',{nodeId:dom.nodeId,selector:c+'File'});
    await call('DOM.setFileInputFiles',{nodeId,files:[file]});
  }
  const caseSteps=()=>evaluate(`Array.from(document.querySelectorAll('${c}Steps > li'),n=>({status:n.dataset.status,text:n.textContent}))`);
  await importCase(exported);await wait(()=>evaluate(`!document.querySelector('${c}Loaded').hidden`),'case loaded');
  assert.equal(await evaluate(`document.querySelector('${c}Result').hidden`),true);assert.equal(await stepCount(),2);
  assert.equal((await inspect(p)).candidates[0].status,'selected');
  await enabled(c+'Run');await click(c+'Run');assert.deepEqual((await caseSteps()).map(step=>step.status),['passed','passed']);
  assert.equal(await stepCount(),2);assert.equal(await value(p+'CurrentState'),'idle');assert.equal(await text('#animationStateScriptEditAfter'),reviewed);
  assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),false);
  const invalidCase=path.join(temporary,'invalid-case.json');await fs.writeFile(invalidCase,'{"format":"unknown"}');await importCase(invalidCase);
  await wait(()=>evaluate(`!document.querySelector('${c}Error').hidden`),'invalid case rejected');assert.deepEqual((await caseSteps()).map(step=>step.status),['passed','passed']);
  await evaluate(`(()=>{const d=document.querySelector('${c}Steps details');if(d){d.open=true;d.dispatchEvent(new Event('toggle'));}document.querySelector('${c}Title').scrollIntoView({block:'start'});})()`);await screenshot('case-replay-desktop.png');
  report.manualCase={exported:exportedCase,passed:await caseSteps(),authorReviewRetained:true,importFailurePreserved:true};
  report.steps.push('An explicitly adopted event/completion path downloads as a bounded JSON case. Real file input loads without executing or replacing manual history/pending; explicit replay matches the saved manual expectation. Invalid import preserves the admitted case and result.');
  await enabled(c+'Edit');await click(c+'Edit');await fill(e+'Text','{');await click(e+'Check');
  assert.equal(await value(e+'Text'),'{');assert.equal(await evaluate(`document.querySelector('${e}Apply').disabled`),true);assert.equal(await evaluate(`document.querySelector('${e}Error').hidden`),false);
  for(const suffix of ['Import','Create','Run','Clear','ExportLoaded','Export'])assert.equal(await evaluate(`document.querySelector('${c}${suffix}').disabled`),true,suffix);
  await screenshot('case-editor-invalid.png');await click(e+'Cancel');assert.deepEqual((await caseSteps()).map(step=>step.status),['passed','passed']);
  await click(c+'Edit');const modified=structuredClone(exportedCase);modified.steps[0].input.event.value=2;await fill(e+'Text',JSON.stringify(modified,null,2));await click(e+'Check');await enabled(e+'Apply');
  await fill(e+'Text',JSON.stringify(modified,null,2)+'\n');assert.equal(await evaluate(`document.querySelector('${e}Apply').disabled`),true);await click(e+'Check');await enabled(e+'Apply');await click(e+'Apply');
  assert.equal(await evaluate(`document.querySelector('${c}Result').hidden`),true);assert.equal(await stepCount(),2);assert.equal((await inspect(p)).candidates[0].status,'selected');
  await click(c+'Run');assert.deepEqual((await caseSteps()).map(step=>step.status),['failed','not-run']);
  await click(c+'Edit');modified.steps[0].expected={stateKey:'idle',transition:true};modified.steps[1].expected={stateKey:'idle',transition:false};
  await fill(e+'Text',JSON.stringify(modified,null,2));await click(e+'Check');await enabled(e+'Apply');await evaluate(`document.querySelector('${e}Panel').scrollIntoView({block:'start'})`);await screenshot('case-editor-checked.png');await click(e+'Apply');await click(c+'Run');assert.deepEqual((await caseSteps()).map(step=>step.status),['passed','passed']);
  // CDP 'allow' can overwrite a same-name download; isolate both exports so
  // their bytes can be compared without assuming Chrome adds a numeric suffix.
  const editedDownload=path.join(temporary,'edited-downloads');await fs.mkdir(editedDownload);
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:editedDownload,eventsEnabled:true});
  await enabled(c+'ExportLoaded');await click(c+'ExportLoaded');let changedFile;
  await wait(async()=>{const next=(await fs.readdir(editedDownload)).find(name=>name.endsWith('.json'));if(next){changedFile=path.join(editedDownload,next);return true;}return false;},'downloaded edited case');
  assert.deepEqual(JSON.parse(await fs.readFile(changedFile,'utf8')),modified);assert.deepEqual(JSON.parse(await fs.readFile(exported,'utf8')),exportedCase);
  report.caseEditing={modified,downloadMatchesApplied:true,originalPathFileUnchanged:true,invalidAndCancelPreserved:true};
  assert.equal(await text('#animationStateScriptEditAfter'),reviewed);assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),false);
  await importCase(exported);await wait(()=>evaluate(`document.querySelector('${c}Run').disabled===false && document.querySelector('${c}Result').hidden`),'restore original imported case');await click(c+'Run');assert.deepEqual((await caseSteps()).map(step=>step.status),['passed','passed']);
  await click(c+'Edit');await fill(e+'Text','{\n  ');
  report.steps.push('A current manual path opens an editable case draft and commits only on Check/Apply. Invalid JSON and cancellation preserve the loaded case/report. Changing input retains explicit expectations and produces a mismatch; editing those expectations changes only the case. Export loaded downloads the applied revision, separately from the original path file.');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await evaluate(`(()=>{window.__previewValue=document.querySelector('${e}Text');window.__previewValue.focus();window.__previewValue.setSelectionRange(0,1);})()`);
  for(const language of ['zh-CN','en','ja']){
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('${p}Body').scrollIntoView({block:'start'})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#animationStateScriptEditDialog');return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,focused:document.activeElement===window.__previewValue,same:document.querySelector('${e}Text')===window.__previewValue,range:[window.__previewValue.selectionStart,window.__previewValue.selectionEnd],text:document.querySelector('${p}Body').innerText};})()`);
    assert.equal(layout.noHorizontalOverflow,true);assert.equal(layout.focused,true);assert.equal(layout.same,true);assert.deepEqual(layout.range,[0,1]);
    assert.equal((await inspect(p)).candidates[0].status,'selected');assert.equal(await text('#animationStateScriptEditAfter'),reviewed);
    report.layout[language]=layout;await screenshot(`preview-${language}-390.png`);await evaluate(`document.querySelector('${p}History').scrollIntoView({block:'start'})`);await screenshot(`sequence-history-${language}-390.png`);await evaluate(`document.querySelector('${c}Title').scrollIntoView({block:'start'})`);await screenshot(`case-${language}-390.png`);await evaluate(`document.querySelector('${e}Panel').scrollIntoView({block:'start'})`);await screenshot(`case-editor-${language}-390.png`);
    await evaluate(`document.querySelector('${e}Cancel').scrollIntoView({block:'center'})`);
    const actions=await evaluate(`(()=>{const b=document.querySelector('${e}Cancel'),r=b.getBoundingClientRect();return {reachable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b,check:document.querySelector('${e}Check').innerText,apply:document.querySelector('${e}Apply').innerText,cancel:b.innerText};})()`);
    assert.equal(actions.reachable,true);report.layout[language].actions=actions;await screenshot(`case-editor-actions-${language}-390.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  assert.equal(await value(e+'Text'),'{\n  ');
  await evaluate(`document.querySelector('${e}Text').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true,cancelable:true}))`);
  assert.equal(await evaluate(`document.querySelector('${e}Panel').hidden`),false);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
  assert.equal(await evaluate(`document.querySelector('${e}Panel').hidden`),true);assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditDialog').open`),true);
  assert.equal(await evaluate('document.activeElement.id'),c.slice(1)+'Edit');
  await evaluate(`window.__oldPreviewLocate=document.querySelector('${p}Transition1Locate')`);
  await fill('#'+editPrefix+'Transition1ConditionItem2Number','4');assert.equal((await inspect(p)).hidden,true);assert.equal(await stepCount(),0);
  assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),true);
  assert.equal(await evaluate(`document.querySelector('${c}Loaded').hidden`),false);assert.equal(await evaluate(`document.querySelector('${c}Result').hidden`),true);
  await enabled(c+'Run');await click(c+'Run');const mismatched=await caseSteps();assert.deepEqual(mismatched.map(step=>step.status),['failed','not-run']);report.manualCase.changedTable=mismatched;
  await evaluate(`document.querySelector('${c}Result').scrollIntoView({block:'start'})`);await screenshot('case-first-mismatch.png');
  await fill('#'+editPrefix+'Transition1ConditionItem2Number','3');assert.equal(await evaluate(`document.querySelector('${c}Result').hidden`),true);
  await enabled(c+'Run');await click(c+'Run');assert.deepEqual((await caseSteps()).map(step=>step.status),['passed','passed']);

  await evaluate(`(()=>{document.querySelector('#${editPrefix}State1Key').focus();window.__oldPreviewLocate.disabled=false;window.__oldPreviewLocate.click();})()`);
  assert.equal(await evaluate('document.activeElement.id'),editPrefix+'State1Key');
  await click('#animationStateScriptEditCancel');await wait(()=>evaluate(`!document.querySelector('#animationStateScriptEditDialog').open`),'cancel table edit');
  assert.equal(await value('#docSourceEditor'),original);assert.deepEqual(await authorTree(root),initial);
  await openEdit();assert.equal(await evaluate(`document.querySelector('${p}Body').hidden`),true);await click(p+'Toggle');
  assert.equal(await evaluate(`document.querySelector('${c}Loaded').hidden`),true);assert.equal(await evaluate(`document.querySelector('${c}Result').hidden`),true);assert.equal(await evaluate(`document.querySelector('${e}Panel').hidden`),true);
  assert.equal(await stepCount(),0);assert.equal(await value(p+'TriggerKind'),'event');assert.equal(await value(p+'PayloadType'),'string');assert.equal(await value(p+'PayloadString'),'');
  await click('#animationStateScriptEditCancel');await wait(()=>evaluate(`!document.querySelector('#animationStateScriptEditDialog').open`),'close fresh table');
  report.steps.push('Chinese English Japanese retain JSON textarea identity focus selection and the unfinished draft at 390px. Changing a real condition invalidates both trial and source review; removed locate controls cannot retarget a row. Cancel/reopen clears trial session and leaves the author source unchanged.');
  await enabled('#projectBuildBtn');await click('#projectBuildBtn');await enabled('#projectBuildScene');await fill('#projectBuildScene',assemblyId,'change');await enabled('#projectBuildPlan');
  async function perform(selector,kind){const previous=(await state()).job?.id;await enabled(selector);await click(selector);let job;await wait(async()=>{job=(await state()).job;return job?.kind===kind&&job.id!==previous&&job.status!=='running';},kind,90000);report.jobs.push(job);assert.equal(job.status,'succeeded',JSON.stringify(job.diagnostics));return job;}
  await perform('#projectBuildPlan','plan');await perform('#projectBuildGenerate','build');const ran=await perform('#projectBuildHeadless','run');
  assert.equal(ran.runtime.project.protocolVersion,10);assert.deepEqual(ran.runtime.project.animationStateEntries.entries.map(row=>row.stateKey),['idle','attack','idle']);
  report.runtime=ran.runtime.project;report.steps.push('The unchanged saved v5 table is separately planned built and run in real Godot. Its publisher supplies shared enabled=true and event value3; actual entries are idle then attack then idle, consistent with the manually adopted event and assumed completion path. Runtime provenance remains independent evidence.');
  await wait(()=>evaluate(`document.querySelector('#projectAnimationStateEntriesSequence')?.dataset.sequence==='3'`),'runtime entries');
  await evaluate(`document.querySelector('#projectAnimationStateEntriesPanel').scrollIntoView({block:'start'})`);await screenshot('preview-matched-runtime.png');
  const after=await authorTree(root);assert.deepEqual(after,initial);report.authorSnapshot={before:initial,after,unchanged:true};
  assert.deepEqual(report.errors,[]);
  for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);
  report.sourceSnapshotUnchanged=true;report.ok=true;
} catch(error) {
  report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;
  try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}
} finally {
  socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}
  report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));
}
