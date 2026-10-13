// Real new-script draft, ordinary TXT save, first-behavior creation and Godot execution.
// The existing first-behavior smoke supplies its Chrome, author-file and delivery checks.
// Only temporary copied author files and a new evidence directory are written.
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
import { verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/script-authoring');
const output = path.resolve(process.env.VIENTO_SCRIPT_AUTHORING_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/script-authoring.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: { script: {}, behavior: {} }, limitations: [
  'Actual Chrome with local HTTP editor and a trusted Godot binary. No installed Tauri window, native picker, Android or other desktop OS claim.',
  'An existing saved Scene2D example is copied; its old TXT source, source registration, behavior manifest and opt-in are removed. The script type is also removed from this fixture. This tests fresh script creation and first behavior, not upstream OC/projection/scene creation.',
  'Godot executes headless logic. No rendering, Bevy author behavior, hot reload, LSP or standalone game export is claimed.'
] };
const sources = ['engine/script-authoring.mjs', 'engine/studio-modules.mjs', 'web/modules/app-studio-system.js', 'web/modules/app-script-create.js', 'web/script-create.css', 'web/modules/app-state.js', 'web/modules/app-scene-behavior-create.js', 'web/scene-behavior-create.css', 'web/modules/app-scene-behaviors.js', 'web/modules/app-behavior-source.js', 'web/modules/app-runtime.js',
  'web/modules/app-project-build.js', 'engine/world-behavior-create.mjs', 'engine/world-command-contract.mjs', 'engine/scene-behavior-creation-contract.mjs',
  'scripts/lib/scene-behavior-creation-service.mjs', 'scripts/adapters/node-world-commands.mjs', 'engine/json-source.mjs', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/script-authoring-smoke.mjs'];
report.sources = Object.fromEntries(await Promise.all(sources.map(async name => [name, buildHash(await fs.readFile(path.join(appRoot, name)))])));
report.node = { version: process.version, sha256: buildHash(await fs.readFile(process.execPath)) };
report.tool = { sha256: buildHash(await fs.readFile(tool)) };
const cleanups = [], fixture = { after: callback => cleanups.push(callback) };
const wait = async (check, label, budget = 45000) => { for (let elapsed = 0; elapsed < budget; elapsed += 100) { if (await check()) return; await delay(100); } throw Error('Timed out: ' + label); };
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
  const root = path.join(temporary, 'author'), download = path.join(temporary, 'downloads');
  await fs.cp(path.join(appRoot, 'examples/scene-behaviors'), root, { recursive: true }); await fs.mkdir(download);
  const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  let scriptId;
  const sceneMetadataPath = `metadata/documents/${sceneId}.json`;
  await fs.rm(path.join(root, 'documents/behaviors/demo.json'));
  await fs.rm(path.join(root, 'metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json'));
  await fs.rm(path.join(root, 'documents/scripts/checkpoint.txt'));
  await fs.rm(path.join(root, 'metadata/documents/ffffffff-ffff-4fff-8fff-ffffffffffff.json'));
  const workspaceFile = path.join(root, 'workspace.json');
  const workspace = JSON.parse(await fs.readFile(workspaceFile, 'utf8'));
  workspace.documentTypes = workspace.documentTypes.filter(type => type.id !== 'script');
  await fs.writeFile(workspaceFile, JSON.stringify(workspace, null, 2) + '\n');
  const sceneMetadata = JSON.parse(await fs.readFile(path.join(root, sceneMetadataPath), 'utf8'));
  sceneMetadata.relations = sceneMetadata.relations.filter(relation => relation.kind !== 'behavior');
  const initialSceneMetadata = (JSON.stringify(sceneMetadata, null, 2) + '\n').replaceAll('\n', '\r\n');
  await fs.writeFile(path.join(root, sceneMetadataPath), initialSceneMetadata);
  const manifestPath = 'documents/behaviors/created-in-studio.json', manifestFile = path.join(root, manifestPath);
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
  const starter = listScriptStarters().find(item => item.id === 'godot-signal');
  const openScript = async () => {
    await enabled('#scriptCreateBtn'); await click('#scriptCreateBtn'); await enabled('#scriptCreateApply');
    await fill('#scriptCreateStarter', 'godot-signal', 'change'); await fill('#scriptCreateType', 'character', 'change');
    await fill('#scriptCreatePath', scriptPath); await enabled('#scriptCreateApply');
  };
  await enabled('#scriptCreateBtn');
  const beforeEditor = await evaluate(`(async()=>{const {appState:s}=await import('/web/modules/app-state.js');return {activePath:s.activePath,creating:s.isCreating,editing:s.isEditing,source:document.querySelector('#docSourceEditor').value};})()`);
  await openScript();
  assert.equal(await evaluate(`document.querySelectorAll('#scriptCreateStarter option').length`), 2);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('#scriptCreateType option')).some(item=>item.value==='script')`), false);
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
    assert.equal(await value('#scriptCreateStarter'), 'godot-signal');
    assert.equal(await value('#scriptCreateType'), 'character');
    assert.equal(await evaluate(`document.querySelector('#scriptCreateSource').textContent`), starter.content);
    assert.equal(await evaluate(`document.querySelector('#scriptCreateApply').disabled`), false);
    report.layout.script[language] = layout; await screenshot(`script-create-${language}-390.png`);
    await evaluate(`document.querySelector('.script-create-body').scrollTop=document.querySelector('.script-create-body').scrollHeight`);
    layout.fullSourceVisible = await evaluate(`(()=>{const p=document.querySelector('#scriptCreateSource'),b=document.querySelector('.script-create-body'),r=p.getBoundingClientRect(),s=b.getBoundingClientRect();return r.top>=s.top&&r.bottom<=s.bottom&&p.scrollWidth<=p.clientWidth;})()`);
    assert.equal(layout.fullSourceVisible, true, 'the complete starter remains readable by scrolling the modal body');
    await screenshot(`script-create-${language}-390-source.png`);
  }
  await click('#scriptCreateCancel'); await wait(()=>evaluate(`!document.querySelector('#scriptCreateDialog').open`),'script creation cancelled');
  assert.deepEqual(await authorTree(root), initial);
  assert.deepEqual(await evaluate(`(async()=>{const {appState:s}=await import('/web/modules/app-state.js');return {activePath:s.activePath,creating:s.isCreating,editing:s.isEditing,source:document.querySelector('#docSourceEditor').value};})()`), beforeEditor);
  assert.equal(await evaluate(`window.__scriptSaves.length`), 0);
  report.steps.push('A project without a script document type offers two known GDScript starters. Full source preview and selected fields persist in Chinese, English and Japanese at 390px with visible Return/Create/Cancel. Cancel changes no editor state or author files.');
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
  const catalogResponse = await fetch(`${base}/api/scene-behavior-creation`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sceneObjectId:sceneId})});
  assert.equal(catalogResponse.status,200); const catalogBody=await catalogResponse.json(),catalog=catalogBody.data||catalogBody;
  assert.deepEqual(catalog.sources.map(item=>({objectId:item.objectId,sourcePath:item.sourcePath})),[{objectId:scriptId,sourcePath:scriptPath}]);
  report.script={starterId:starter.id,sourcePath:scriptPath,objectId:scriptId,documentType:scriptRecord.documentType,sourceSha256:buildHash(Buffer.from(starter.content)),changedAuthorPaths:[scriptPath,`metadata/documents/${scriptId}.json`],sourceFocused:true,ordinarySaveCount:await evaluate(`window.__scriptSaves.length`)};
  await screenshot('script-create-ordinary-save.png');
  report.steps.push('Create script opens the normal TXT source draft and focuses its editor without any file or registration write. Ordinary Save stores the reviewed GDScript bytes under the existing character type, adds only source plus registration, and immediately makes that source visible to first-behavior creation.');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scenes/demo')).click()`);
  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildCreateBehavior');
  const openCreate = async () => { await click('#projectBuildCreateBehavior'); await enabled('#sceneBehaviorCreateCheck'); assert.equal(await value('#sceneBehaviorCreateSource'),scriptId); await fill('#sceneBehaviorCreateType','behavior','change'); await fill('#sceneBehaviorCreatePath',manifestPath); };
  const reviewCreate = async () => { await click('#sceneBehaviorCreateCheck'); await enabled('#sceneBehaviorCreateSave'); };
  await openCreate(); await reviewCreate();
  const firstPreview = await evaluate(`window.__behaviorCreates.at(-1)`);
  assert.equal(firstPreview.request.mode,'preview'); assert.equal(firstPreview.request.command,'behavior.create');
  assert.equal(await evaluate(`document.querySelectorAll('#sceneBehaviorCreateRelations li').length`),3);
  assert.deepEqual(await authorTree(root),afterScript);
  await screenshot('behavior-create-review-desktop.png');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await enabled('#sceneBehaviorCreateSave');
    await evaluate(`document.querySelector('.scene-behavior-create-body').scrollTop=0`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneBehaviorCreateDialog'),rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};return {noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,close:rect('#sceneBehaviorCreateClose'),check:rect('#sceneBehaviorCreateCheck'),save:rect('#sceneBehaviorCreateSave'),title:document.querySelector('#sceneBehaviorCreateTitle').textContent,bodyScrollable:document.querySelector('.scene-behavior-create-body').scrollHeight>document.querySelector('.scene-behavior-create-body').clientHeight};})()`);
    assert.equal(layout.noHorizontalOverflow,true);assert.equal(layout.bodyScrollable,true);
    for(const action of ['close','check','save']) assert.ok(layout[action].top>=0&&layout[action].bottom<=844&&layout[action].left>=0&&layout[action].right<=390,JSON.stringify(layout));
    assert.equal(await value('#sceneBehaviorCreatePath'),manifestPath); assert.equal(await evaluate(`document.querySelector('#sceneBehaviorCreateSave').disabled`),false);
    report.layout.behavior[language]=layout;await screenshot(`behavior-create-${language}-390.png`);
  }
  await click('#sceneBehaviorCreateCancel');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorCreateDialog').open`),'creation cancelled');
  assert.deepEqual(await authorTree(root),afterScript);
  report.steps.push('A saved Scene2D without any behavior opens first-behavior creation. Full source and all three relationships are reviewed, then Cancel writes nothing. Chinese, English and Japanese at 390px preserve fields and review, keep Return/Review/Save visible, and allow body scrolling without horizontal overflow.');
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await openCreate();await reviewCreate();const preview=await evaluate(`window.__behaviorCreates.at(-1)`);
  assert.notEqual(preview.request.objectId,firstPreview.request.objectId);const createdId=preview.request.objectId;
  await click('#sceneBehaviorCreateSave');await enabled('#sceneBehaviorCreateOpen');
  const savedReceipt=await evaluate(`window.__behaviorCreates.at(-1)`);assert.equal(savedReceipt.result.status,'applied');
  assert.equal(savedReceipt.request.content,preview.request.content);assert.equal(savedReceipt.request.objectId,createdId);
  const original=await readSource(),created=JSON.parse(original);assert.equal(original,preview.request.content);
  assert.equal(created.bindings.length,1);assert.deepEqual(created.bindings[0].parameters,{});assert.deepEqual(created.bindings[0].events,[]);
  const recordPath=`metadata/documents/${createdId}.json`,record=JSON.parse(await fs.readFile(path.join(root,recordPath),'utf8'));
  assert.deepEqual(record.relations,[sceneId,scriptId].sort().map(targetId=>({kind:'references',targetId,slot:''})));
  const afterMetadata=await fs.readFile(path.join(root,sceneMetadataPath),'utf8');assert.ok(afterMetadata.includes('\r\n'));
  const afterCreate=await authorTree(root),actualChanges=[...new Set([...Object.keys(afterScript),...Object.keys(afterCreate)])].filter(name=>afterScript[name]!==afterCreate[name]);
  assert.deepEqual(actualChanges.sort(),[manifestPath,recordPath,sceneMetadataPath].sort());
  const nextSceneMetadata=JSON.parse(afterMetadata.replace(/^\ufeff/,''));assert.deepEqual(nextSceneMetadata.relations,[...sceneMetadata.relations,{kind:'behavior',targetId:createdId,slot:''}]);
  report.creation={objectId:createdId,bindingId:created.bindings[0].bindingId,changedAuthorPaths:actualChanges,sourceRevision:savedReceipt.result.changes[0].afterSourceRevision,relations:record.relations,sceneRelation:nextSceneMetadata.relations.at(-1)};
  await click('#sceneBehaviorCreateOpen');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorCreateDialog').open&&!document.querySelector('#projectBuildDialog').open`),'source navigation closes dialogs');
  await enabled('#sceneBehaviorsBtn');await wait(()=>evaluate(`document.activeElement===document.querySelector('#docSourceEditor')`),'source editor focused after both dialogs close');report.sourceFocus=await evaluate(`document.activeElement.id`);assert.equal(await value('#docSourceEditor'),visible(original));
  assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.editInputMode`),'source');
  report.steps.push('One reviewed transaction creates exactly the manifest and its registration and appends the scene behavior relationship, retaining the scene metadata CRLF. Scene/script/asset source bytes are unchanged. The explicit Open button enters the real source editor and exposes the existing behavior editor.');
  await click('#sceneBehaviorsBtn');await enabled('#sceneBehaviorsAddParameter');
  await click('#sceneBehaviorsAddParameter');await fill('#sceneBehaviorsParam0Name','checkpoint');await fill('#sceneBehaviorsParam0Value','script_authored_in_studio');
  await click('#sceneBehaviorsAddParameter');await fill('#sceneBehaviorsParam1Name','amount');await fill('#sceneBehaviorsParam1Type','number','change');await fill('#sceneBehaviorsParam1Value','65');
  await click('#sceneBehaviorsAddEvent');await fill('#sceneBehaviorsEvent0Signal','arrived');await fill('#sceneBehaviorsEvent0Name','script_authoring_checkpoint');
  await click('#sceneBehaviorsCheck');await enabled('#sceneBehaviorsApply');
  const candidate=await evaluate(`document.querySelector('#sceneBehaviorsAfter').textContent`),parsed=JSON.parse(candidate);
  assert.deepEqual(parsed.bindings[0].parameters,{checkpoint:'script_authored_in_studio',amount:65});assert.deepEqual(parsed.bindings[0].events,[{signal:'arrived',event:'script_authoring_checkpoint'}]);
  await screenshot('behavior-create-parameters-review.png');
  await click('#sceneBehaviorsApply');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`),'behavior draft applied');
  assert.equal(await value('#docSourceEditor'),visible(candidate));assert.equal(await readSource(),original);
  await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readSource()===candidate,'ordinary behavior save');
  await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges && !document.querySelector('#sceneBehaviorsBtn').disabled`),'save and index refresh complete');
  const after=await authorTree(root);assert.deepEqual(after,{...afterCreate,[manifestPath]:buildHash(Buffer.from(candidate))});
  report.saved={beforeSha256:buildHash(Buffer.from(original)),afterSha256:buildHash(Buffer.from(candidate)),onlyChangedAuthorPath:manifestPath};
  report.steps.push('The existing behavior editor adds text/number parameters and a signal alias. Apply only changes the draft; ordinary Save persists those exact reviewed bytes and changes no other author files.');
  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildPlan');
  async function perform(selector, kind) {
    const previous = (await state()).job?.id; await enabled(selector); await click(selector); let job;
    await wait(async () => { job = (await state()).job; return job?.kind === kind && job.id !== previous && job.status !== 'running'; }, kind, 90000);
    report.jobs.push(job); assert.equal(job.status, 'succeeded', JSON.stringify(job)); return job;
  }
  const planned = await perform('#projectBuildPlan', 'plan'); assert.equal(planned.plan.behaviorBindingCount, 1); assert.equal(planned.plan.behaviorSourceCount, 1);
  const built = await perform('#projectBuildGenerate', 'build'), ran = await perform('#projectBuildHeadless', 'run');
  const events=ran.events.filter(event=>event.event==='behavior');assert.equal(events.length,1);
  const first=events[0];assert.equal(first.bindingId,parsed.bindings[0].bindingId);assert.equal(first.name,'script_authoring_checkpoint');assert.deepEqual(first.arguments,['script_authored_in_studio',65]);assert.equal(first.instanceId,parsed.bindings[0].instanceId);
  report.behaviorEvents=events;
  await wait(()=>evaluate(`document.querySelector('#projectBuildBehaviorEventList')?.textContent.includes('script_authoring_checkpoint')`),'Godot event displayed in the real editor');
  report.displayedBehaviorEvents=await evaluate(`document.querySelector('#projectBuildBehaviorEventList').textContent`);
  await evaluate(`document.querySelector('#projectBuildBehaviorEventList').scrollIntoView({block:'center'})`);
  await screenshot('behavior-create-godot-events.png');
  report.steps.push('The newly created and edited manifest drives real Godot plan → build → headless run: the selected instance emits script_authoring_checkpoint with script_authored_in_studio/65, bound to the newly created stable binding ID.');
  if (process.env.VIENTO_SCRIPT_AUTHORING_VERIFY_DELIVERY === '1') {
  await evaluate(`(() => { window.__deliveryReceipts=[]; const original=window.fetch.bind(window); window.fetch=async(input,init)=>{const response=await original(input,init);let body;try{body=JSON.parse(init?.body||'null')}catch{};if(body?.kind==='backend-project'){const result=await response.clone().json();window.__deliveryReceipts.push(result.data||result)}return response;}; })()`);
  await enabled('#backendProjectInspect'); await click('#backendProjectInspect'); await enabled('#backendProjectDeliver'); await click('#backendProjectDeliver');
  await enabled('#backendDeliveryPrepare'); await click('#backendDeliveryPrepare'); await enabled('#backendDeliveryDownload');
  const receipt = await evaluate(`window.__deliveryReceipts.at(-1)`); assert.equal(receipt.delivery.project.buildId, built.buildId);
  await click('#backendDeliveryDownload'); await wait(() => evaluate(`!document.querySelector('#backendDeliveryDownload').disabled`), 'download started'); await click('#backendDeliveryClose');
  const archive = path.join(download, receipt.fileName); await wait(async () => { try { return (await fs.stat(archive)).size === receipt.bytes; } catch { return false; } }, 'browser ZIP saved');
  const verified = await verifyBackendProjectDelivery(archive), extraction = path.join(temporary, 'delivered'); await fs.mkdir(extraction);
  const unzip = await runCommand('unzip', ['-q', archive, '-d', extraction], { cwd: temporary }); assert.equal(unzip.code, 0, JSON.stringify(unzip));
  const p = receipt.delivery.project;
  assert.ok(p.files.some(file => file.path.endsWith('.gd'))); assert.ok(p.resources.length > 0);
  const imported = await runCommand(tool, ['--headless', '--editor', '--path', path.join(extraction, 'project'), '--import', '--quit'], { cwd: temporary, env });
  assert.equal(imported.code, 0, JSON.stringify(imported)); assert.doesNotMatch(imported.stdout + imported.stderr, /SCRIPT ERROR|Parse Error/);
  report.delivery = { fileName: receipt.fileName, bytes: receipt.bytes, sha256: buildHash(await fs.readFile(archive)), fileCount: verified.fileCount,
    assetCount: verified.assetCount, buildId: p.buildId, projectKind: p.project.kind, godotImport: { code: imported.code, stdout: imported.stdout, stderr: imported.stderr } };
  assert.deepEqual(await authorTree(root), after); assert.deepEqual(report.errors, []);
  report.steps.push('The resulting generated project is inspected, delivered through a real browser download, independently verified and extracted, then imported by real Godot at a new location. Scripts and image resources are present; no further author writes occur.');
  } else {
    assert.deepEqual(await authorTree(root), after); assert.deepEqual(report.errors, []);
    report.delivery = { skipped: true, reason: 'Set VIENTO_SCRIPT_AUTHORING_VERIFY_DELIVERY=1 to include generated-project delivery verification.' };
  }
  for(const [file,expected] of Object.entries(report.sources)) assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);
  report.sourceSnapshotUnchanged=true;
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  try { await captureFailure?.(); } catch (failure) { report.captureFailure = failure.message; }
} finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, output, steps: report.steps, failure: report.failure }, null, 2));
}
