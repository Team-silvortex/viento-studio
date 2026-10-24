// Actual Chrome physics panel → reviewed source draft → ordinary save → real Godot collision/events/animation.
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
import { scenePhysics2DAuthor } from './helpers/scene-physics2d-author-fixture.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
import '../adapters/node-studio-core.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-physics2d-editor');
const output = path.resolve(process.env.VIENTO_PHYSICS2D_EDITOR_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/scene-physics2d-editor.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome HTTP editor and Godot headless execution; no installed Tauri, Android, visual rendering or Bevy physics claim.',
  'Existing declaration editing with manually entered instance UUIDs. Local shape diagram is not simulation or scene placement. Scene membership, registration and controls are build preflight concerns; no new physics solver or protocol.'
] };
const sources = ['engine/scene-physics2d-edit.mjs','engine/scene-physics2d.mjs','engine/scene-physics2d-core.mjs',
  'web/modules/app-scene-physics2d.js','web/modules/app-scene-physics2d-source.js','web/scene-physics2d.css',
  'web/modules/app-runtime.js','web/modules/app-studio-system.js','engine/studio-modules.mjs','web/i18n/en.js','web/i18n/ja.js',
  'scripts/backends/godot4-physics.mjs','scripts/backends/godot4/physics-runtime.gd','scripts/backends/godot4/project-physics-runtime.gd',
  'scripts/tests/helpers/scene-physics2d-author-fixture.mjs','scripts/tests/scene-physics2d-editor-smoke.mjs'];
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
    if (name === 'workspace.json' || /^(documents|design-data|templates|data-template|metadata|assets)\//.test(name)) hashes[name] = buildHash(await fs.readFile(file));
  }
  return hashes;
}
let socket, captureFailure;
try {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-physics2d-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const authorFixture = await scenePhysics2DAuthor(fixture);
  const authorFile = path.join(authorFixture.author, authorFixture.physicsPath);
  const original = '\ufeff' + (await fs.readFile(authorFile, 'utf8')).replace('"bodies"', '"bodi\\u0065s"')
    .replace('"layer": 1', '"layer": 1e0').replace(/\n/g, '\r\n');
  await fs.writeFile(authorFile, original);
  const root = authorFixture.author, download = path.join(temporary, 'downloads'); await fs.mkdir(download);
  const sceneId = authorFixture.sceneIds[0], assemblyId = authorFixture.assemblyId;
  report.fixture = { sceneId, assemblyId, physicsPath: authorFixture.physicsPath,
    instanceId: authorFixture.instanceId, sensorBindingId: authorFixture.sensorBindingId, sensorInstanceId: authorFixture.sensorInstanceId };
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

  await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.endsWith(${JSON.stringify(authorFixture.physicsPath)}))`), 'physics source in sidebar');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.endsWith(${JSON.stringify(authorFixture.physicsPath)})).click()`);
  await enabled('#docEditBtn'); await click('#docEditBtn');
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`), 'ordinary physics edit');
  await enabled('#docEditSourceModeBtn'); await click('#docEditSourceModeBtn');
  assert.equal(await value('#docSourceEditor'), visible(original));
  const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  const settled = () => wait(() => evaluate(`document.querySelector('#scenePhysics2DDialog').getAttribute('aria-busy')==='false'`), 'physics panel settled');
  const open = async () => { await enabled('#scenePhysics2DBtn'); await click('#scenePhysics2DBtn'); await enabled('#scenePhysics2DInstance'); };
  const edit = async () => { await fill('#scenePhysics2DShape', 'circle', 'change'); await fill('#scenePhysics2DRadius', '12'); await fill('#scenePhysics2DX', '2'); };
  const review = async () => { await enabled('#scenePhysics2DCheck'); await click('#scenePhysics2DCheck'); await enabled('#scenePhysics2DApply'); return text('#scenePhysics2DAfter'); };
  const unchanged = async () => { assert.deepEqual(await authorTree(root),initial); assert.equal(await value('#docSourceEditor'),visible(original)); };
  await open();
  const bodyIds = await evaluate(`Array.from(document.querySelector('#scenePhysics2DBody').options, option=>option.value)`);
  assert.deepEqual(bodyIds,authorFixture.physics.bodies.map(body=>body.id));
  assert.equal(await evaluate(`document.querySelector('#scenePhysics2DStage').hidden`),false);
  await screenshot('physics-editor-desktop.png');
  await click('#scenePhysics2DAdd');
  assert.equal(await evaluate(`document.querySelector('#scenePhysics2DBody').options.length`),4);
  assert.equal(await value('#scenePhysics2DInstance'),'');
  await click('#scenePhysics2DCheck'); await settled();
  assert.equal(await evaluate(`document.querySelector('#scenePhysics2DApply').disabled`),true);
  assert.equal(await text('#scenePhysics2DDiagnostic'),'scene_physics2d_authoring_invalid');
  await unchanged(); await click('#scenePhysics2DRemove');
  assert.deepEqual(await evaluate(`Array.from(document.querySelector('#scenePhysics2DBody').options, option=>option.value)`),bodyIds);
  await fill('#scenePhysics2DBody',bodyIds[0],'change'); await edit();
  await fill('#scenePhysics2DRadius','1e-'); await click('#scenePhysics2DCheck'); await settled();
  assert.equal(await value('#scenePhysics2DRadius'),'1e-');
  assert.equal(await evaluate(`document.querySelector('#scenePhysics2DApply').disabled&&document.querySelector('#scenePhysics2DStage').hidden`),true);
  await unchanged();
  await fill('#scenePhysics2DRadius','12'); const first=await review();
  assert.equal(await text('#scenePhysics2DBefore'),original);
  assert.equal(await evaluate(`document.querySelector('#scenePhysics2DStage .scene-physics2d-shape').dataset.kind`),'circle');
  assert.equal(first.charCodeAt(0),0xFEFF);
  assert.ok(first.includes('"bodi\\u0065s"'));
  assert.ok(first.includes('"layer": 1e0'));
  const sourceTree=parseJsonSource(original),resultTree=parseJsonSource(first);
  for(const index of [1,2]){
    const before=locateJsonSource(sourceTree,`/bodies/${index}`),after=locateJsonSource(resultTree,`/bodies/${index}`);
    assert.equal(first.slice(after.start,after.end),original.slice(before.start,before.end));
  }
  await unchanged();
  await evaluate(`document.querySelector('#scenePhysics2DStage').scrollIntoView({block:'center'})`); await screenshot('physics-circle-review.png');
  report.steps.push('Existing physics source opens a dedicated editor. Adding a body does not create a scene instance; an empty instance ID fails validation, removal restores the original identities. Incomplete numeric input stays visible and clears approval/diagram. Rust-checked circle and offset changes review without author or draft writes.');
  await evaluate(`(() => { window.__physicsRadius=document.querySelector('#scenePhysics2DRadius'); window.__physicsRadius.focus();window.__physicsRadius.setSelectionRange(0,1); })()`);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']){
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate(`document.querySelector('#scenePhysics2DRadius')===window.__physicsRadius&&document.activeElement===window.__physicsRadius&&window.__physicsRadius.selectionStart===0&&window.__physicsRadius.selectionEnd===1`),true);
    assert.equal(await value('#scenePhysics2DRadius'),'12');assert.equal(await value('#scenePhysics2DX'),'2');
    assert.equal(await text('#scenePhysics2DAfter'),first);assert.equal(await evaluate(`document.querySelector('#scenePhysics2DApply').disabled`),false);
    await evaluate(`document.querySelector('.scene-physics2d-body').scrollTop=0`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#scenePhysics2DDialog'),rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right};};return{noDialogScroll:d.scrollHeight<=d.clientHeight&&getComputedStyle(d).overflowY==='hidden',noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,close:rect('#scenePhysics2DClose'),check:rect('#scenePhysics2DCheck'),apply:rect('#scenePhysics2DApply'),cancel:rect('#scenePhysics2DCancel'),title:document.querySelector('#scenePhysics2DTitle').textContent,bodyScrollable:document.querySelector('.scene-physics2d-body').scrollHeight>document.querySelector('.scene-physics2d-body').clientHeight};})()`);
    report.layout[language]=layout;await screenshot('physics-editor-'+language+'-390.png');
    assert.equal(layout.noHorizontalOverflow,true,JSON.stringify(layout));assert.equal(layout.noDialogScroll,true,JSON.stringify(layout));assert.equal(layout.bodyScrollable,true);
    for(const action of ['close','check','apply','cancel'])assert.ok(layout[action].top>=0&&layout[action].bottom<=844&&layout[action].left>=0&&layout[action].right<=390,JSON.stringify(layout));
    await evaluate(`document.querySelector('#scenePhysics2DMask').scrollIntoView({block:'center'})`);
    const fixed=await evaluate(`Object.fromEntries(['Close','Check','Apply','Cancel'].map(id=>{const r=document.querySelector('#scenePhysics2D'+id).getBoundingClientRect();return[id.toLowerCase(),{top:r.top,bottom:r.bottom,left:r.left,right:r.right}];}))`);
    for(const action of ['close','check','apply','cancel'])assert.deepEqual(fixed[action],layout[action],'Fixed action moved while body scrolled: '+action);
    assert.equal(await evaluate(`(()=>{const r=document.querySelector('#scenePhysics2DMask').getBoundingClientRect(),b=document.querySelector('.scene-physics2d-body').getBoundingClientRect();return r.top>=b.top&&r.bottom<=b.bottom&&r.left>=0&&r.right<=390;})()`),true);
  }
  assert.equal(new Set(Object.values(report.layout).map(row=>row.title)).size,3);
  await click('#scenePhysics2DCancel');await wait(()=>evaluate(`!document.querySelector('#scenePhysics2DDialog').open`),'physics form cancelled');await unchanged();
  report.steps.push('At 390px, Chinese, English and Japanese preserve the exact input element, focus/selection, reviewed source and approval. Return, Check, Apply and Cancel remain visible and the final field can scroll into view. Confirmed Cancel preserves all author bytes and the original editor draft.');
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await open();await edit();const candidate=await review();assert.equal(candidate,first);
  await click('#scenePhysics2DApply');await wait(()=>evaluate(`!document.querySelector('#scenePhysics2DDialog').open`),'physics changes applied to draft');
  assert.equal(await value('#docSourceEditor'),visible(candidate));assert.deepEqual(await authorTree(root),initial);
  assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`),true);await screenshot('physics-unsaved-draft.png');
  await open();assert.equal(await value('#scenePhysics2DShape'),'circle');assert.equal(await value('#scenePhysics2DRadius'),'12');await click('#scenePhysics2DCancel');
  assert.equal(await value('#docSourceEditor'),visible(candidate));assert.deepEqual(await authorTree(root),initial);
  await enabled('#docSaveBtn');await click('#docSaveBtn');
  await wait(async()=>await fs.readFile(authorFile,'utf8')===candidate,'ordinary Save writes exact reviewed physics source');
  await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges&&!(await import('/web/modules/app-state.js')).appState.isSaving`),'ordinary Save finished');
  const repaired=await authorTree(root);assert.deepEqual(Object.keys(repaired).filter(name=>initial[name]!==repaired[name]),[authorFixture.physicsPath]);assert.deepEqual(Object.keys(repaired),Object.keys(initial));
  const saved=JSON.parse(candidate.replace(/^\uFEFF/,'')),expected=structuredClone(authorFixture.physics);
  expected.bodies[0].shape={kind:'circle',radius:12};expected.bodies[0].offset[0]=2;assert.deepEqual(saved,expected);
  report.steps.push('Apply changes only the ordinary unsaved draft. Reopening reads that draft and Cancel retains it. Normal Save writes exactly the reviewed source, preserving BOM, CRLF, escaped root key, unchanged numeric spelling and unchanged body slices; metadata, scene and other author files remain byte-identical.');
  await enabled('#projectBuildBtn');await click('#projectBuildBtn');await enabled('#projectBuildScene');await fill('#projectBuildScene',assemblyId,'change');
  async function perform(selector,kind){const previous=(await state()).job?.id;await enabled(selector);await click(selector);let job;await wait(async()=>{job=(await state()).job;return job?.kind===kind&&job.id!==previous&&job.status!=='running';},kind,90000);report.jobs.push(job);assert.equal(job.status,'succeeded',JSON.stringify(job.diagnostics));return job;}
  await perform('#projectBuildPlan','plan');await perform('#projectBuildGenerate','build');const ran=await perform('#projectBuildHeadless','run');
  const project=ran.runtime.project;assert.equal(project.protocolVersion,10);
  assert.equal(project.events.sequence,2);assert.deepEqual(project.events.entries.map(row=>row.name),['physics.entered','physics.exited']);
  assert.ok(project.events.entries.every(row=>row.value===authorFixture.instanceId&&row.origin.bindingId===authorFixture.sensorBindingId&&row.origin.instanceId===authorFixture.sensorInstanceId));
  assert.deepEqual(project.animationStateEntries.entries.map(row=>row.stateKey),['idle','action','idle']);assert.deepEqual(project.animationStateEntries.entries.map(row=>row.trigger.kind),['initial','event','completed']);
  assert.equal(project.animationCommands.sequence,6);assert.equal(project.animationCompletions.sequence,1);
  const actor=ran.runtime.actors.find(row=>row.instanceId===authorFixture.instanceId);assert.ok(actor);
  assert.ok(actor.position[0]>130.8&&actor.position[0]<=131.01,JSON.stringify(actor));
  await wait(()=>evaluate(`document.querySelector('#projectAnimationStateEntriesSequence')?.dataset.sequence==='3'&&!document.querySelector('#projectAnimationStateEntriesPanel').hidden`),'rendered final animation entries');
  await evaluate(`document.querySelector('#projectAnimationStateEntriesPanel').scrollIntoView({block:'start'})`);await screenshot('physics-editor-run.png');report.runtime=ran.runtime;
  report.steps.push('GUI Plan, Build and real Godot headless Run consume the saved circle radius 12 and local offset X 2. Character stops at x≈131; actual sensor enter/exit publishes the other instance UUID from its sensor binding. Animation completes idle/action/idle under unchanged project protocol 10.');
  report.authorSnapshot={before:initial,afterSave:repaired,after:await authorTree(root)};assert.deepEqual(report.authorSnapshot.after,repaired);
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.dialogs,[{type:'confirm',message:'今回の物理フォームの変更を破棄しますか？ソースの下書きは変更されません。'}]);
  for(const [file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,'Source changed during smoke: '+file);
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
