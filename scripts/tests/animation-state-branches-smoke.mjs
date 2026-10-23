// Actual Chrome checks explicit ordered branches, reordering and ordinary source saving.
// No runtime or native-engine execution is part of this check.
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

const table = { initialState: 'idle', states: [{key:'idle'}, {key:'attack'}], transitions: [
  {from:'idle',to:'attack',trigger:{kind:'event',name:'action',condition:{type:'number',operator:'gt',value:0}}},
  {from:'attack',to:'idle',trigger:{kind:'completed'}},
] };

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/animation-state-branches');
const output = path.resolve(process.env.VIENTO_ANIMATION_STATE_BRANCHES_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/animation-state-branches.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome over local HTTP in a disposable author workspace. No installed Tauri, Android, native picker, game execution or Godot claim.',
  'A fixture prepares scenes, clips and an existing state-table TXT. Current UI creates ordered branches, reviews v2/v3 proposals and saves one ordinary TXT. Initial OC creation and binding are fixture setup.',
  'The graph is a static projection of the current valid form. It does not prove runtime state, reachability or execution.'
] };
const sources = ['engine/animation-state-branches-core.mjs', 'engine/godot-animation-branches-script.mjs', 'web/modules/app-animation-state-condition.js', 'engine/animation-state-conditions-core.mjs', 'web/animation-state-condition.css', 'engine/script-authoring.mjs', 'engine/godot-animation-state-script.mjs', 'engine/animation-state-table-core.mjs', 'engine/animation-state-graph.mjs', 'engine/studio-core.mjs', 'engine/studio-core.wasm', 'engine/animation-state-script-source.mjs', 'engine/animation-state-script-edit.mjs', 'web/modules/app-animation-state-graph.js', 'web/animation-state-graph.css', 'web/modules/app-animation-state-script.js', 'web/animation-state-script.css', 'web/modules/app-script-create.js', 'web/script-create.css', 'web/modules/app-animation-state-script-source.js', 'web/modules/app-animation-state-script-edit.js', 'web/animation-state-script-edit.css', 'web/modules/app-studio-system.js', 'web/modules/app-runtime.js', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/animation-state-branches-smoke.mjs'];
report.sources = Object.fromEntries(await Promise.all(sources.map(async name => [name, buildHash(await fs.readFile(path.join(appRoot, name)))])));
report.node = { version: process.version, sha256: buildHash(await fs.readFile(process.execPath)) };
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
  const fallback={from:'idle',to:'idle',trigger:{kind:'event',name:'action'}};
  const branching={...table,eventSelection:'firstMatch',transitions:[table.transitions[0],fallback,table.transitions[1]]};
  const generated=generateGodotAnimationStateScript(branching);
  const original=generateGodotAnimationStateScript(table).content;
  await authorFixture.script('checkpoint', original);
  await authorFixture.configure({clip_idle:idleId,clip_attack:attackId});
  await authorFixture.script('publisher', `extends Node\nfunc _ready() -> void:\n\tcall_deferred("publish")\nfunc publish() -> void:\n\tget_meta("viento_project").publish_event("action", true)\n`);
  const manifestPath = 'documents/behaviors/demo.json', manifestFile = path.join(root, manifestPath);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
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
  const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  const createPrefix='animationStateScript', editPrefix='animationStateScriptEditTable';
  const condition = prefix => '#' + prefix + 'Transition1Condition';
  const graphOpen = async prefix => { await enabled('#'+prefix+'GraphToggle'); if(await evaluate(`document.querySelector('#${prefix}GraphToggle').getAttribute('aria-expanded')==='false'`)) await click('#'+prefix+'GraphToggle'); await wait(()=>evaluate(`document.querySelectorAll('#${prefix}GraphCanvas .animation-state-graph-node').length>0`),'graph '+prefix); };
  const setNumber = async prefix => { const p=condition(prefix); await fill(p+'Mode','compare','change'); await fill(p+'Type','number','change'); await fill(p+'Number','0'); await fill(p+'Operator','gt','change'); };
  const declaration = async selector => JSON.parse((await text(selector)).split('\n')[1].replace('#@viento-animation-state-script ',''));
  const setMode = (prefix, mode) => fill('#'+prefix+'EventSelection',mode,'change');
  const addFallback = async prefix => {
    await click('#'+prefix+'AddTransition');
    await fill('#'+prefix+'Transition3From','state-1','change');
    await fill('#'+prefix+'Transition3To','state-1','change');
    await fill('#'+prefix+'Transition3Event','action');
  };
  await enabled('#scriptCreateBtn'); await click('#scriptCreateBtn'); await enabled('#scriptCreateApply');
  await fill('#scriptCreateStarter','godot-project-animation-state-table','change'); await enabled('#scriptCreateApply');
  assert.equal((await declaration('#scriptCreateSource')).generator,'godot-gdscript-v1');
  await setMode(createPrefix,'firstMatch'); await setNumber(createPrefix); await addFallback(createPrefix);
  await enabled('#scriptCreateApply');
  assert.equal((await declaration('#scriptCreateSource')).generator,'godot-gdscript-v3');
  await click('#'+createPrefix+'Transition3MoveUp'); await enabled('#scriptCreateApply');
  await click('#'+createPrefix+'Transition3MoveUp');
  assert.equal(await evaluate(`document.querySelector('#scriptCreateApply').disabled`),true,'fallback before a later predicate must reject generation');
  await click('#'+createPrefix+'Transition3MoveDown'); await enabled('#scriptCreateApply'); await graphOpen(createPrefix);
  await evaluate(`document.querySelector('#${createPrefix}EventSelection').scrollIntoView({block:'center'})`);
  await screenshot('branches-create-desktop.png');
  await click('#scriptCreateCancel'); await wait(()=>evaluate(`!document.querySelector('#scriptCreateDialog').open`),'cancel creation');
  assert.deepEqual(await authorTree(root),initial);
  report.steps.push('Creation explicitly enables v3, adds a fallback and reorders it. A fallback before a later predicate blocks generation; cancelling changes no author files.');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scripts/checkpoint')).click()`);
  await wait(()=>evaluate(`document.querySelector('#docSourceEditor').value===${JSON.stringify(original)}`),'saved v2 controller');
  await enabled('#docEditBtn'); await click('#docEditBtn');
  await wait(()=>evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`),'source editing');
  const openEdit=async()=>{await enabled('#animationStateScriptEditBtn');await click('#animationStateScriptEditBtn');await enabled('#animationStateScriptEditCheck');};
  const approve=async()=>{await click('#animationStateScriptEditCheck');await enabled('#animationStateScriptEditApply');};
  await openEdit(); const ep=condition(editPrefix);
  await setMode(editPrefix,'firstMatch'); await addFallback(editPrefix); await approve();
  await evaluate(`(()=>{window.__branchInput=document.querySelector('${ep}Number');window.__branchRow=document.querySelector('#${editPrefix}Transition3')})()`);
  await click('#'+editPrefix+'Transition3MoveUp');
  assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),true,'reordering revokes source review');
  assert.equal(await evaluate(`document.querySelector('${ep}Number')===window.__branchInput&&document.querySelector('#${editPrefix}Transition3')===window.__branchRow`),true);
  await approve();
  assert.equal(await text('#animationStateScriptEditBefore'),original); assert.equal(await text('#animationStateScriptEditAfter'),generated.content);
  await click('#'+editPrefix+'Transition3MoveUp'); await click('#animationStateScriptEditCheck');
  assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),true);
  await click('#'+editPrefix+'Transition3MoveDown'); await approve(); await graphOpen(editPrefix);
  assert.equal(await text('#animationStateScriptEditAfter'),generated.content);
  assert.deepEqual(await authorTree(root),initial); assert.equal(await value('#docSourceEditor'),original);
  await evaluate(`document.querySelector('#${editPrefix}EventSelection').scrollIntoView({block:'center'})`); await screenshot('branches-reedit-desktop.png');
  report.steps.push('Re-edit preserves condition inputs and row identity while moving nodes. Order changes revoke review; invalid fallback order is rejected. Valid review reproduces exact v3 bytes without author writes.');
  await evaluate(`(()=>{window.__branchInput.focus();window.__branchInput.setSelectionRange(0,1)})()`);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.deepEqual(await evaluate(`({same:document.querySelector('${ep}Number')===window.__branchInput,focused:document.activeElement===window.__branchInput,start:window.__branchInput.selectionStart,end:window.__branchInput.selectionEnd})`),{same:true,focused:true,start:0,end:1});
    assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),false);
    assert.equal(await text('#animationStateScriptEditAfter'),generated.content);
    await evaluate(`document.querySelector('#${editPrefix}EventSelection').scrollIntoView({block:'center'})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#animationStateScriptEditDialog'),c=document.querySelector('#${editPrefix}EventSelection'),r=c.getBoundingClientRect();return{noDocumentOverflow:document.documentElement.scrollWidth<=innerWidth,noDialogOverflow:d.scrollWidth<=d.clientWidth,left:r.left,right:r.right};})()`);
    assert.equal(layout.noDocumentOverflow,true);assert.equal(layout.noDialogOverflow,true);assert.ok(layout.left>=0&&layout.right<=390,JSON.stringify(layout));
    report.layout[language]=layout;await screenshot('branches-'+language+'-390.png');
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  report.steps.push('Chinese, English and Japanese at 390px preserve the exact input, focus, selection, branch order and reviewed source without horizontal overflow.');
  await click('#animationStateScriptEditApply');
  await wait(()=>evaluate(`!document.querySelector('#animationStateScriptEditDialog').open&&document.querySelector('#docSourceEditor').value===${JSON.stringify(generated.content)}`),'draft apply');
  assert.deepEqual(await authorTree(root),initial); assert.equal(await fs.readFile(scriptFile,'utf8'),original);
  const save=async expected=>{await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await fs.readFile(scriptFile,'utf8')===expected,'ordinary Save');await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.isSaving&&!(await import('/web/modules/app-state.js')).appState.isRebuilding&&!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`),'saved baseline');};
  await save(generated.content);
  const after=await authorTree(root); assert.deepEqual(Object.keys(after).filter(name=>after[name]!==initial[name]),[scriptPath]);
  assert.deepEqual((await readRegistry(root)).documents.find(row=>row.id===scriptRecord.id),scriptRecord);
  await openEdit(); assert.equal(await value('#'+editPrefix+'EventSelection'),'firstMatch');
  assert.equal(await value(ep+'Number'),'0'); assert.equal(await value('#'+editPrefix+'Transition2Event'),'action');
  await graphOpen(editPrefix); await evaluate(`document.querySelector('#${editPrefix}EventSelection').scrollIntoView({block:'center'})`); await screenshot('branches-saved-reopened-desktop.png');
  await setMode(editPrefix,'unique'); await click('#animationStateScriptEditCheck');
  assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),true);
  assert.equal(await evaluate(`document.querySelectorAll('#${editPrefix}Transitions > .animation-state-script-transition').length`),3,'disabling branches must not delete duplicate edges');
  await click('#'+editPrefix+'Transition2Remove'); await approve(); assert.equal(await text('#animationStateScriptEditAfter'),original);
  await click('#animationStateScriptEditApply'); await wait(()=>evaluate(`!document.querySelector('#animationStateScriptEditDialog').open`),'explicit legacy repair draft');
  assert.deepEqual(await authorTree(root),after); await save(original); assert.deepEqual(await authorTree(root),initial);
  report.script={sourcePath:scriptPath,objectId:scriptRecord.id,v2Sha256:buildHash(Buffer.from(original)),v3Sha256:buildHash(Buffer.from(generated.content)),untouchedAuthorFiles:Object.keys(initial).length-1};
  report.steps.push('Apply updates only a draft; ordinary Save changes exactly one TXT. Reopening restores v3 order. Turning off branch mode preserves duplicate edges and rejects them until explicitly removed; Save then restores original v2 bytes.');
  assert.deepEqual(report.errors,[]);
  for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);
  report.sourceSnapshotUnchanged=true; report.ok=true;
} catch(error) {
  report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;
  try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}
} finally {
  socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}
  report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));
}
