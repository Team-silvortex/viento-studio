// Actual Chrome authors all/any guards, saves v5 and runs the frozen Godot project.
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

const table = { initialState:'idle', states:[{key:'idle'},{key:'attack'}], transitions:[
  {from:'idle',to:'attack',trigger:{kind:'event',name:'action',condition:{type:'boolean',operator:'eq',value:true,selector:{kind:'projectState',key:'combat.enabled'}}}}
] };

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/animation-condition-groups');
const output = path.resolve(process.env.VIENTO_ANIMATION_CONDITION_GROUPS_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/animation-condition-groups.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome HTTP editor and Godot headless execution in a disposable author workspace. No installed Tauri, Android, Bevy or native visual rendering claim.',
  'A fixture prepares scenes, clips, publisher and an existing v4 TXT. UI previews creation, reviews v5, saves one ordinary TXT, reopens it and plans/builds/runs the frozen project. Initial OC creation and binding are fixture setup.',
  'The graph is a static projection of the current valid form. It does not prove runtime state, reachability or execution.'
] };
const sources = ['engine/animation-state-combinations-core.mjs','engine/godot-animation-combinations-script.mjs','web/modules/app-animation-state-condition-group.js','web/animation-state-condition-group.css','engine/animation-state-selectors-core.mjs','engine/godot-animation-selectors-script.mjs','engine/animation-state-graph.mjs','scripts/backends/godot4-adapter.mjs','scripts/backends/godot4-project.mjs','engine/animation-state-branches-core.mjs', 'engine/godot-animation-branches-script.mjs', 'web/modules/app-animation-state-condition.js', 'engine/animation-state-conditions-core.mjs', 'web/animation-state-condition.css', 'engine/script-authoring.mjs', 'engine/godot-animation-state-script.mjs', 'engine/animation-state-table-core.mjs', 'engine/animation-state-graph.mjs', 'engine/studio-core.mjs', 'engine/studio-core.wasm', 'engine/animation-state-script-source.mjs', 'engine/animation-state-script-edit.mjs', 'web/modules/app-animation-state-graph.js', 'web/animation-state-graph.css', 'web/modules/app-animation-state-script.js', 'web/animation-state-script.css', 'web/modules/app-script-create.js', 'web/script-create.css', 'web/modules/app-animation-state-script-source.js', 'web/modules/app-animation-state-script-edit.js', 'web/animation-state-script-edit.css', 'web/modules/app-studio-system.js', 'web/modules/app-runtime.js', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/animation-condition-groups-smoke.mjs'];
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
  const combined=structuredClone(table);
  combined.transitions[0].trigger.condition={combine:'all',conditions:[table.transitions[0].trigger.condition,{type:'number',operator:'gte',value:3}]};
  const anyTable=structuredClone(combined);anyTable.transitions[0].trigger.condition.combine='any';
  const generated=generateGodotAnimationStateScript(combined), anyGenerated=generateGodotAnimationStateScript(anyTable);
  const original=generateGodotAnimationStateScript(table).content;
  await authorFixture.script('checkpoint',original);
  await authorFixture.configure({clip_idle:idleId,clip_attack:attackId});
  await authorFixture.script('publisher','extends Node\nfunc _ready() -> void:\n\tvar project = get_meta("viento_project")\n\tproject.write_state("combat.enabled", true)\n\tproject.publish_event("action", 2)\n');
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
  const condition = prefix => '#' + prefix + 'Transition1Condition';
  const graphOpen = async prefix => { await enabled('#'+prefix+'GraphToggle'); if(await evaluate(`document.querySelector('#${prefix}GraphToggle').getAttribute('aria-expanded')==='false'`)) await click('#'+prefix+'GraphToggle'); await wait(()=>evaluate(`document.querySelectorAll('#${prefix}GraphCanvas .animation-state-graph-node').length>0`),'graph '+prefix); };
  const declaration = async selector => JSON.parse((await text(selector)).split('\n')[1].replace('#@viento-animation-state-script ',''));
  const setShared = async prefix => {
    const p=condition(prefix);await fill(p+'Mode','shared','change');await fill(p+'Key','combat.enabled');
    await fill(p+'Type','boolean','change');await fill(p+'Boolean','true','change');await fill(p+'Operator','eq','change');
  };
  const addNumber=async prefix=>{const p=condition(prefix);await fill(p+'Combination','all','change');await click(p+'AddItem');await fill(p+'Item2Type','number','change');await fill(p+'Item2Number','3');await fill(p+'Item2Operator','gte','change');};
  await enabled('#scriptCreateBtn');await click('#scriptCreateBtn');await enabled('#scriptCreateApply');
  await fill('#scriptCreateStarter','godot-project-animation-state-table','change');await enabled('#scriptCreateApply');
  await setShared(createPrefix);await addNumber(createPrefix);await enabled('#scriptCreateApply');
  assert.equal((await declaration('#scriptCreateSource')).generator,'godot-gdscript-v5');
  assert.equal((await declaration('#scriptCreateSource')).table.transitions[0].trigger.condition.conditions.length,2);
  await graphOpen(createPrefix);assert.match(await text('#'+createPrefix+'GraphTransitions'),/combat\.enabled/);
  await evaluate(`document.querySelector('${condition(createPrefix)}Combination').scrollIntoView({block:'center'})`);await screenshot('groups-create-desktop.png');
  await click('#scriptCreateCancel');await wait(()=>evaluate(`!document.querySelector('#scriptCreateDialog').open`),'cancel creation');assert.deepEqual(await authorTree(root),initial);
  report.steps.push('Creation previews a two-leaf v5 all guard, including a shared-state key and payload comparison; its static graph lists the conditions. Cancelling changes no author files.');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scripts/checkpoint')).click()`);
  await wait(()=>evaluate(`document.querySelector('#docSourceEditor').value===${JSON.stringify(original)}`),'saved v4 source');
  await enabled('#docEditBtn');await click('#docEditBtn');await wait(()=>evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`),'source editing');
  const openEdit=async()=>{await enabled('#animationStateScriptEditBtn');await click('#animationStateScriptEditBtn');await enabled('#animationStateScriptEditCheck');};
  const approve=async()=>{await click('#animationStateScriptEditCheck');await enabled('#animationStateScriptEditApply');};
  const save=async expected=>{await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await fs.readFile(scriptFile,'utf8')===expected,'ordinary Save');await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.isSaving&&!(await import('/web/modules/app-state.js')).appState.isRebuilding&&!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`),'saved baseline');};
  await openEdit();const ep=condition(editPrefix);assert.equal(await value(ep+'Combination'),'single');await addNumber(editPrefix);await approve();
  assert.equal(await text('#animationStateScriptEditBefore'),original);assert.equal(await text('#animationStateScriptEditAfter'),generated.content);
  await evaluate(`window.__groupNumber=document.querySelector('${ep}Item2Number')`);
  await click(ep+'Item2MoveUp');assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),true);
  await click(ep+'Item2MoveDown');await fill(ep+'Combination','single','change');assert.equal(await value(ep+'Key'),'combat.enabled');
  await fill(ep+'Combination','all','change');assert.equal(await evaluate(`document.querySelector('${ep}Item2Number')===window.__groupNumber`),true);await approve();
  assert.equal(await text('#animationStateScriptEditAfter'),generated.content);
  await fill(ep+'Combination','any','change');await approve();assert.equal(await text('#animationStateScriptEditAfter'),anyGenerated.content);
  await fill(ep+'Combination','all','change');await approve();await graphOpen(editPrefix);assert.match(await text('#'+editPrefix+'GraphTransitions'),/combat\.enabled/);
  await evaluate(`(() => { window.__groupNumber.focus(); window.__groupNumber.setSelectionRange(0,1); })()`);
  await evaluate(`document.querySelector('${ep}Item2Row').scrollIntoView({block:'center'})`);await screenshot('groups-reedit-desktop.png');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']){
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.deepEqual(await evaluate(`({same:document.querySelector('${ep}Item2Number')===window.__groupNumber,focused:document.activeElement===window.__groupNumber,start:window.__groupNumber.selectionStart,end:window.__groupNumber.selectionEnd})`),{same:true,focused:true,start:0,end:1});
    assert.equal(await text('#animationStateScriptEditAfter'),generated.content);assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),false);
    await evaluate(`document.querySelector('${ep}Item2Row').scrollIntoView({block:'center'})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#animationStateScriptEditDialog'),r=document.querySelector('${ep}Item2Number').getBoundingClientRect();return{noDocumentOverflow:document.documentElement.scrollWidth<=innerWidth,noDialogOverflow:d.scrollWidth<=d.clientWidth,left:r.left,right:r.right};})()`);
    assert.equal(layout.noDocumentOverflow,true);assert.equal(layout.noDialogOverflow,true);assert.ok(layout.left>=0&&layout.right<=390,JSON.stringify(layout));
    report.layout[language]=layout;await screenshot('groups-'+language+'-390.png');
  }
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  assert.deepEqual(await authorTree(root),initial);await click('#animationStateScriptEditApply');
  await wait(()=>evaluate(`!document.querySelector('#animationStateScriptEditDialog').open&&document.querySelector('#docSourceEditor').value===${JSON.stringify(generated.content)}`),'reviewed draft');
  assert.deepEqual(await authorTree(root),initial);await save(generated.content);
  const after=await authorTree(root);assert.deepEqual(Object.keys(after).filter(name=>after[name]!==initial[name]),[scriptPath]);assert.deepEqual((await readRegistry(root)).documents.find(row=>row.id===scriptRecord.id),scriptRecord);
  await openEdit();assert.equal(await value(ep+'Combination'),'all');assert.equal(await value(ep+'Item1Key'),'combat.enabled');assert.equal(await value(ep+'Item2Number'),'3');
  await click('#animationStateScriptEditCancel');await wait(()=>evaluate(`!document.querySelector('#animationStateScriptEditDialog').open`),'close re-edit');
  report.steps.push('Re-edit copies the existing v4 scalar into a group. Adding, sorting and changing all/any revoke review; single/group buffers, stable leaf nodes and three-language 390px focus are preserved. Apply changes only the draft; ordinary Save changes one TXT and reopening restores both leaves.');
  const openBuild=async()=>{await enabled('#projectBuildBtn');await click('#projectBuildBtn');await enabled('#projectBuildScene');await fill('#projectBuildScene',assemblyId,'change');await enabled('#projectBuildPlan');};
  async function perform(selector,kind){const previous=(await state()).job?.id;await enabled(selector);await click(selector);let job;
    await wait(async()=>{job=(await state()).job;return job?.kind===kind&&job.id!==previous&&job.status!=='running';},kind,90000);
    report.jobs.push(job);assert.equal(job.status,'succeeded',JSON.stringify(job.diagnostics));return job;}
  async function runProject(){await openBuild();await perform('#projectBuildPlan','plan');await perform('#projectBuildGenerate','build');return (await perform('#projectBuildHeadless','run')).runtime.project;}
  let project=await runProject();assert.equal(project.protocolVersion,9);assert.deepEqual(project.animationStateEntries.entries.map(row=>row.stateKey),['idle']);
  assert.equal(project.animationCommands.sequence,2);assert.equal(project.animationStates.entries[0].controllers[0].stateKey,'idle');
  await wait(()=>evaluate(`document.querySelector('#projectAnimationStateEntriesSequence')?.dataset.sequence==='1'`),'all guard entries');
  await evaluate(`document.querySelector('#projectAnimationStateEntriesPanel').scrollIntoView({block:'start'})`);await screenshot('groups-all-runtime.png');
  assert.deepEqual(await authorTree(root),after);await click('#projectBuildClose');await wait(()=>evaluate(`!document.querySelector('#projectBuildDialog').open`),'close build');
  await openEdit();await fill(ep+'Combination','any','change');await approve();assert.equal(await text('#animationStateScriptEditAfter'),anyGenerated.content);
  await click('#animationStateScriptEditApply');await wait(()=>evaluate(`!document.querySelector('#animationStateScriptEditDialog').open`),'any draft');await save(anyGenerated.content);
  const afterAny=await authorTree(root);assert.deepEqual(Object.keys(afterAny).filter(name=>afterAny[name]!==after[name]),[scriptPath]);
  project=await runProject();assert.equal(project.protocolVersion,9);assert.deepEqual(project.animationStateEntries.entries.map(row=>row.stateKey),['idle','attack']);
  assert.deepEqual(project.animationStateEntries.entries.map(row=>row.clipId),[idleId,attackId]);assert.equal(project.animationCommands.sequence,4);assert.equal(project.animationStates.entries[0].controllers[0].stateKey,'attack');
  await wait(()=>evaluate(`document.querySelector('#projectAnimationStateEntriesSequence')?.dataset.sequence==='2'`),'any guard entries');
  await evaluate(`document.querySelector('#projectAnimationStateEntriesPanel').scrollIntoView({block:'start'})`);await screenshot('groups-any-runtime.png');assert.deepEqual(await authorTree(root),afterAny);
  report.script={sourcePath:scriptPath,objectId:scriptRecord.id,v4Sha256:buildHash(Buffer.from(original)),v5AllSha256:buildHash(Buffer.from(generated.content)),v5AnySha256:buildHash(Buffer.from(anyGenerated.content)),untouchedAuthorFiles:Object.keys(initial).length-1};
  report.steps.push('GUI plan/build/run observes all(shared=true,payload=2>=3) staying idle with two commands. After explicit any-mode review and ordinary Save, a fresh project run enters idle then attack with four commands. Both use existing protocol 9 entries and terminal samples, preserving all saved author bytes.');
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
