// Actual Chrome checks the read-only state graph and ordinary source authoring.
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

const table = { initialState: 'idle', states: [{key:'idle'}, {key:'attack'}, {key:'isolated'}], transitions: [
  {from:'idle',to:'attack',trigger:{kind:'event',name:'action'}},
  {from:'attack',to:'idle',trigger:{kind:'completed'}},
  {from:'attack',to:'attack',trigger:{kind:'event',name:'again'}},
  {from:'idle',to:'attack',trigger:{kind:'event',name:'alternate'}},
  {from:'idle',to:'attack',trigger:{kind:'completed'}},
] };

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/animation-state-graph');
const output = path.resolve(process.env.VIENTO_ANIMATION_STATE_GRAPH_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/animation-state-graph.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome over local HTTP in a disposable author workspace. No installed Tauri, Android, native picker, game execution or Godot claim.',
  'A fixture prepares scenes, clips and an existing state-table TXT. Current UI previews creation and re-edit forms, focuses fields, reviews and saves one ordinary TXT. Initial OC creation and binding are fixture setup.',
  'The graph is a static projection of the current valid form. It does not prove runtime state, reachability or execution.'
] };
const sources = ['engine/script-authoring.mjs', 'engine/godot-animation-state-script.mjs', 'engine/animation-state-table-core.mjs', 'engine/animation-state-graph.mjs', 'engine/studio-core.mjs', 'engine/studio-core.wasm', 'engine/animation-state-script-source.mjs', 'engine/animation-state-script-edit.mjs', 'web/modules/app-animation-state-graph.js', 'web/animation-state-graph.css', 'web/modules/app-animation-state-script.js', 'web/animation-state-script.css', 'web/modules/app-script-create.js', 'web/script-create.css', 'web/modules/app-animation-state-script-source.js', 'web/modules/app-animation-state-script-edit.js', 'web/animation-state-script-edit.css', 'web/modules/app-studio-system.js', 'web/modules/app-runtime.js', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/animation-state-graph-smoke.mjs'];
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
  const generated = generateGodotAnimationStateScript(table);
  const originalTable={...table,transitions:table.transitions.map(edge=>edge.trigger.name==='action'?{...edge,trigger:{kind:'event',name:'before-edit'}}:edge)};
  const original=generateGodotAnimationStateScript(originalTable).content;
  await authorFixture.script('checkpoint', original);
  await authorFixture.configure({clip_idle:idleId,clip_attack:attackId,clip_isolated:idleId});
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
  // Creation and existing-source editors share a table but never graph IDs.
  await enabled('#scriptCreateBtn'); await click('#scriptCreateBtn'); await enabled('#scriptCreateApply');
  await fill('#scriptCreateStarter','godot-project-animation-state-table','change'); await enabled('#scriptCreateApply');
  const createGraph = 'animationStateScriptGraph', editGraph = 'animationStateScriptEditTableGraph';
  const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  const graphCounts = prefix => evaluate(`({nodes:document.querySelectorAll('#${prefix}Canvas .animation-state-graph-node').length,routes:document.querySelectorAll('#${prefix}Canvas .animation-state-graph-route').length,states:document.querySelectorAll('#${prefix}States>li').length,edges:document.querySelectorAll('#${prefix}Transitions>li').length})`);
  const graphOpen = async prefix => { await enabled('#'+prefix+'Toggle'); if(await evaluate(`document.querySelector('#${prefix}Toggle').getAttribute('aria-expanded')==='false'`)) await click('#'+prefix+'Toggle'); await wait(()=>evaluate(`document.querySelectorAll('#${prefix}Canvas .animation-state-graph-node').length>0`),'graph '+prefix); };
  const creationSource = await text('#scriptCreateSource'), creationDirty = await evaluate(`document.querySelector('#scriptCreateDialog').dataset.dirty`);
  await graphOpen(createGraph); assert.deepEqual(await graphCounts(createGraph), {nodes:2,routes:2,states:2,edges:2});
  await click('#'+createGraph+'State2Select'); await click('#'+createGraph+'State2Locate');
  assert.equal(await evaluate(`document.activeElement.id`),'animationStateScriptState2Key');
  await click('#'+createGraph+'Transition2Select'); await click('#'+createGraph+'Transition2Locate');
  assert.equal(await evaluate(`document.activeElement.id`),'animationStateScriptTransition2From');
  await click('#'+createGraph+'Toggle'); await graphOpen(createGraph);
  assert.equal(await text('#scriptCreateSource'),creationSource); assert.equal(await evaluate(`document.querySelector('#scriptCreateApply').disabled`),false);
  assert.equal(await evaluate(`document.querySelector('#scriptCreateDialog').dataset.dirty`),creationDirty);
  await evaluate(`document.querySelector('#${createGraph}Canvas').scrollIntoView({block:'start'})`); await screenshot('graph-create-desktop.png');
  await fill('#animationStateScriptState2Key','attack');
  assert.notEqual(await text('#scriptCreateSource'),creationSource); assert.match(await text('#'+createGraph+'States'),/attack/);
  await fill('#animationStateScriptState2Key',''); assert.equal(await evaluate(`document.querySelector('#scriptCreateApply').disabled`),true);
  assert.deepEqual(await graphCounts(createGraph),{nodes:0,routes:0,states:0,edges:0});
  await fill('#animationStateScriptState2Key','attack'); await enabled('#scriptCreateApply');
  await click('#scriptCreateCancel'); await wait(()=>evaluate(`!document.querySelector('#scriptCreateDialog').open`),'cancel creation');
  assert.deepEqual(await authorTree(root),initial); assert.equal(await evaluate(`window.__scriptSaves.length`),0);
  report.steps.push('New-script graph selection, field location and collapse/reopen preserve the exact reviewed source and dirty state. Real key edits regenerate source; an incomplete key removes all stale graph items. Cancelling writes no author files.');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scripts/checkpoint')).click()`);
  await wait(()=>evaluate(`document.querySelector('#docSourceEditor').value===${JSON.stringify(original)}`),'saved controller');
  await enabled('#docEditBtn'); await click('#docEditBtn');
  await wait(()=>evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`),'source editing');
  assert.equal(await evaluate(`(()=>{const ids=Array.from(document.querySelectorAll('[id]'),e=>e.id);return ids.length===new Set(ids).size;})()`),true);
  const beforeEditor=await value('#docSourceEditor');
  const openEdit = async () => { await enabled('#animationStateScriptEditBtn'); await click('#animationStateScriptEditBtn'); await enabled('#animationStateScriptEditCheck'); };
  const approve = async () => { await click('#animationStateScriptEditCheck'); await enabled('#animationStateScriptEditApply'); };
  const reviewUnchanged = async () => {
    assert.equal(await text('#animationStateScriptEditBefore'),original); assert.equal(await text('#animationStateScriptEditAfter'),generated.content);
    assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),false);
    assert.equal(await value('#docSourceEditor'),beforeEditor); assert.deepEqual(await authorTree(root),initial);
  };
  await openEdit(); await graphOpen(editGraph); assert.deepEqual(await graphCounts(editGraph),{nodes:3,routes:3,states:3,edges:5});
  assert.match(await text('#'+editGraph+'States'),/isolated/); assert.match(await text('#'+editGraph+'Transitions'),/before-edit/);
  await fill('#animationStateScriptEditTableTransition1Event','action'); await approve();
  await click('#'+editGraph+'State2Select'); await click('#'+editGraph+'State2Locate');
  assert.equal(await evaluate(`document.activeElement.id`),'animationStateScriptEditTableState2Key');
  await click('#'+editGraph+'Transition3Select'); await click('#'+editGraph+'Transition3Locate');
  assert.equal(await evaluate(`document.activeElement.id`),'animationStateScriptEditTableTransition3From');
  await evaluate(`document.querySelector('#${editGraph}Route1').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  assert.deepEqual(await evaluate(`[1,4,5].map(index=>document.querySelector('#${editGraph}Transition'+index+'Select').getAttribute('aria-pressed'))`),['true','true','true']);
  await reviewUnchanged();
  await evaluate(`document.querySelector('#${editGraph}Canvas').scrollIntoView({block:'start'})`); await screenshot('graph-reedit-routes-desktop.png');
  await evaluate(`document.querySelector('#${editGraph}Transitions').scrollIntoView({block:'start'})`); await screenshot('graph-reedit-multi-trigger-desktop.png');
  report.steps.push('The re-edit graph retains all three states including an isolated state, five transitions, a reverse direction, a self-loop and three triggers sharing a route. Selecting that route selects exactly its three transitions; explicit Locate focuses the corresponding real field without revoking the approved source.');
  // Invalid local forms clear old graph elements, including detached handlers.
  await evaluate(`window.__oldGraphLocate=document.querySelector('#${editGraph}State2Locate')`);
  await fill('#animationStateScriptEditTableState2Key','');
  assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),true);
  assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditReview').hidden`),true);
  assert.deepEqual(await graphCounts(editGraph),{nodes:0,routes:0,states:0,edges:0});
  await evaluate(`(()=>{document.querySelector('#animationStateScriptEditTableTransition1Event').focus();window.__oldGraphLocate.click()})()`);
  assert.equal(await evaluate(`document.activeElement.id`),'animationStateScriptEditTableTransition1Event');
  await screenshot('graph-invalid-cleared.png');
  await fill('#animationStateScriptEditTableState2Key','attack'); await approve();
  await click('#'+editGraph+'Toggle'); await reviewUnchanged(); await graphOpen(editGraph); await reviewUnchanged();
  await click('#'+editGraph+'State2Select');
  await evaluate(`(()=>{window.__graphNode=document.querySelector('#${editGraph}Node2');window.__graphInput=document.querySelector('#animationStateScriptEditTableTransition1Event');window.__graphInput.focus();window.__graphInput.setSelectionRange(1,4)})()`);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate(`document.querySelector('#${editGraph}Node2')===window.__graphNode`),true);
    assert.deepEqual(await evaluate(`({same:document.querySelector('#animationStateScriptEditTableTransition1Event')===window.__graphInput,focused:document.activeElement===window.__graphInput,start:window.__graphInput.selectionStart,end:window.__graphInput.selectionEnd,selected:document.querySelector('#${editGraph}State2Select').getAttribute('aria-pressed')})`),{same:true,focused:true,start:1,end:4,selected:'true'});
    await reviewUnchanged();
    await evaluate(`document.querySelector('#${editGraph}Canvas').scrollIntoView({block:'start'})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#animationStateScriptEditDialog'),c=document.querySelector('#${editGraph}Canvas'),r=c.getBoundingClientRect();return{noDocumentOverflow:document.documentElement.scrollWidth<=innerWidth,noDialogOverflow:d.scrollWidth<=d.clientWidth,canvasLeft:r.left,canvasRight:r.right,canvasWidth:c.clientWidth,canvasScrollWidth:c.scrollWidth,nodes:document.querySelectorAll('#${editGraph}Canvas .animation-state-graph-node').length};})()`);
    assert.equal(layout.noDocumentOverflow,true); assert.equal(layout.noDialogOverflow,true); assert.ok(layout.canvasLeft>=0&&layout.canvasRight<=390,JSON.stringify(layout)); assert.equal(layout.nodes,3);
    report.layout[language]=layout; await screenshot(`graph-${language}-390.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await click('#animationStateScriptEditCancel'); await wait(()=>evaluate(`!document.querySelector('#animationStateScriptEditDialog').open`),'cancel re-edit');
  assert.equal(await value('#docSourceEditor'),beforeEditor); assert.deepEqual(await authorTree(root),initial);
  report.steps.push('An invalid state clears every graph node and transition; a detached Locate button cannot focus a replacement row. Repair restores the graph. Collapse and Chinese/English/Japanese changes preserve the source review, exact graph/input nodes, input focus and text selection. At390px only the bounded graph canvas scrolls horizontally. Cancel leaves source and all author files unchanged.');
  await openEdit(); await fill('#animationStateScriptEditTableTransition1Event','action'); await approve(); await graphOpen(editGraph); await reviewUnchanged();
  await click('#animationStateScriptEditApply');
  await wait(()=>evaluate(`!document.querySelector('#animationStateScriptEditDialog').open&&document.querySelector('#docSourceEditor').value===${JSON.stringify(generated.content)}`),'draft apply');
  assert.deepEqual(await authorTree(root),initial); assert.equal(await fs.readFile(scriptFile,'utf8'),original);
  assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`),true);
  await openEdit(); await graphOpen(editGraph); assert.match(await text('#'+editGraph+'Transitions'),/action/);
  assert.equal(await value('#animationStateScriptEditTableTransition1Event'),'action','reopen reads dirty editor source');
  await click('#animationStateScriptEditCheck'); await enabled('#animationStateScriptEditCheck');
  assert.equal(await evaluate(`document.querySelector('#animationStateScriptEditApply').disabled`),true);
  await click('#animationStateScriptEditCancel'); await wait(()=>evaluate(`!document.querySelector('#animationStateScriptEditDialog').open`),'close unchanged draft');
  await enabled('#docSaveBtn'); await click('#docSaveBtn');
  await wait(async()=>await fs.readFile(scriptFile,'utf8')===generated.content,'ordinary Save');
  await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.isSaving&&!(await import('/web/modules/app-state.js')).appState.isRebuilding&&!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`),'saved baseline');
  const afterScript=await authorTree(root); assert.deepEqual(Object.keys(afterScript).filter(name=>afterScript[name]!==initial[name]),[scriptPath]);
  assert.deepEqual((await readRegistry(root)).documents.find(row=>row.id===scriptRecord.id),scriptRecord);
  await openEdit(); await graphOpen(editGraph); assert.deepEqual(await graphCounts(editGraph),{nodes:3,routes:3,states:3,edges:5});
  assert.equal(await value('#animationStateScriptEditTableTransition1Event'),'action');
  await evaluate(`document.querySelector('#${editGraph}Canvas').scrollIntoView({block:'start'})`); await screenshot('graph-saved-reopened-desktop.png');
  await click('#animationStateScriptEditCancel'); await wait(()=>evaluate(`!document.querySelector('#animationStateScriptEditDialog').open`),'close saved graph');
  assert.equal(await evaluate(`window.__scriptSaves.length`),0); assert.deepEqual(await authorTree(root),afterScript);
  report.script={sourcePath:scriptPath,objectId:scriptRecord.id,changedAuthorPaths:[scriptPath],sourceSha256:buildHash(Buffer.from(generated.content)),untouchedAuthorFiles:Object.keys(initial).length-1};
  report.steps.push('A deliberate event change follows Check → reviewed source → Apply to the unsaved draft → ordinary Save. The graph reopens both the dirty draft and the saved TXT. Only that TXT changes; registration, identity, bindings and every other author file remain unchanged.');
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
