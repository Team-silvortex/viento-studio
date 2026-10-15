// Real multi-instance/multi-script behavior creation, ordinary authoring, Godot and delivery.
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
import { readRegistry } from '../lib/workspace.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';
import { verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-behavior-multi-create');
const output = path.resolve(process.env.VIENTO_BEHAVIOR_MULTI_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a fresh directory under the multi-create evidence root.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome with local HTTP editor and a trusted Godot binary. No installed Tauri window, native picker, Android or other desktop OS claim.',
  'An existing saved Scene2D example is copied and its behavior manifest/opt-in removed. The second script is created through the real editor. This tests behavior creation for two existing instances, not upstream OC/projection/scene creation.',
  'Godot executes headless logic. No rendering, Bevy author behavior, hot reload, LSP or standalone game export is claimed.'
] };
const sources = ['web/modules/app-scene-behavior-create.js', 'web/scene-behavior-create.css', 'web/modules/app-scene-behaviors.js', 'web/modules/app-behavior-source.js', 'web/modules/app-runtime.js',
  'web/modules/app-project-build.js', 'engine/world-behavior-create.mjs', 'engine/world-command-contract.mjs', 'engine/scene-behavior-creation-contract.mjs',
  'scripts/lib/scene-behavior-creation-service.mjs', 'scripts/adapters/node-world-commands.mjs', 'engine/json-source.mjs', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/scene-behavior-multi-create-smoke.mjs', 'engine/scene-behavior-create-plan.mjs', 'engine/scene-behaviors.mjs', 'engine/script-authoring.mjs', 'web/modules/app-script-create.js'];
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-behavior-creation-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'author'), download = path.join(temporary, 'downloads');
  await fs.cp(path.join(appRoot, 'examples/scene-behaviors'), root, { recursive: true }); await fs.mkdir(download);
  const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', scriptId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const sceneMetadataPath = `metadata/documents/${sceneId}.json`;
  await fs.rm(path.join(root, 'documents/behaviors/demo.json'));
  await fs.rm(path.join(root, 'metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json'));
  const sceneMetadata = JSON.parse(await fs.readFile(path.join(root, sceneMetadataPath), 'utf8'));
  sceneMetadata.relations = sceneMetadata.relations.filter(relation => relation.kind !== 'behavior');
  const initialSceneMetadata = (JSON.stringify(sceneMetadata, null, 2) + '\n').replaceAll('\n', '\r\n');
  await fs.writeFile(path.join(root, sceneMetadataPath), initialSceneMetadata);
  const manifestPath = 'documents/behaviors/created-in-studio.json', manifestFile = path.join(root, manifestPath);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root, VIENTO_GODOT_BIN: tool,
    VIENTO_EXECUTION_BACKEND: 'org.viento.godot4', XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  const rebuilt = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env }); assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
  let initial = await authorTree(root);
  const base = await serve(fixture, appRoot, env), readSource = () => fs.readFile(manifestFile, 'utf8');
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
  await evaluate(`(() => {window.__behaviorCreates=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const response=await original(input,init);let body;try{body=JSON.parse(init?.body||'null')}catch{};if(body?.command==='behavior.create'){const result=await response.clone().json();window.__behaviorCreates.push({request:body,result:result.data||result});}return response;};})()`);
  const beforeScript = await authorTree(root), scriptPath = 'documents/scripts/second-in-studio.txt';
  const secondScriptContent = '# Second independent script, authored in Studio.\n' + listScriptStarters().find(item => item.id === 'godot-signal').content;
  await enabled('#scriptCreateBtn'); await click('#scriptCreateBtn'); await enabled('#scriptCreateApply');
  await fill('#scriptCreateStarter', 'godot-signal', 'change'); await fill('#scriptCreateType', 'character', 'change'); await fill('#scriptCreatePath', scriptPath);
  await click('#scriptCreateApply'); await wait(()=>evaluate(`(await import('/web/modules/app-state.js')).appState.isCreating`),'new ordinary script draft');
  await fill('#docSourceEditor', secondScriptContent); assert.deepEqual(await authorTree(root), beforeScript);
  await enabled('#docSaveBtn'); await click('#docSaveBtn');
  await wait(async()=>{try{return await fs.readFile(path.join(root,scriptPath),'utf8')===secondScriptContent;}catch{return false;}},'second script saved');
  await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.isSaving&&!(await import('/web/modules/app-state.js')).appState.isRebuilding&&!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`),'script ordinary save complete');
  const secondScript = (await readRegistry(root)).documents.find(item=>item.sourcePath===scriptPath); assert.ok(secondScript);
  const secondScriptId = secondScript.id; initial = await authorTree(root);
  assert.deepEqual(Object.keys(initial).filter(name=>initial[name]!==beforeScript[name]).sort(),[scriptPath,`metadata/documents/${secondScriptId}.json`].sort());
  for(const [name,hash] of Object.entries(beforeScript)) assert.equal(initial[name],hash);
  report.script = {objectId:secondScriptId,sourcePath:scriptPath,sha256:buildHash(Buffer.from(secondScriptContent))};
  report.steps.push('Create a second GDScript through the built-in script starter, edit its ordinary TXT draft and Save; only its source and registration are added.');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scenes/demo')).click()`);
  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildCreateBehavior');
  const openCreate = async () => { await click('#projectBuildCreateBehavior'); await enabled('#sceneBehaviorCreateCheck'); await fill('#sceneBehaviorCreateType','behavior','change'); await fill('#sceneBehaviorCreatePath',manifestPath); };
  const reviewCreate = async () => { await click('#sceneBehaviorCreateCheck'); await enabled('#sceneBehaviorCreateSave'); };
  const configureBindings = async () => {
    const instances = await evaluate(`Array.from(document.querySelectorAll('#sceneBehaviorCreateInstance option')).map(item=>item.value)`);
    assert.equal(instances.length,2);
    const ids = [await value('#sceneBehaviorCreateBindingList')];
    await fill('#sceneBehaviorCreateInstance', instances[0], 'change'); await fill('#sceneBehaviorCreateSource', scriptId, 'change');
    await click('#sceneBehaviorCreateAddBinding'); ids.push(await value('#sceneBehaviorCreateBindingList'));
    assert.equal(await value('#sceneBehaviorCreateInstance'), instances[1]);
    await fill('#sceneBehaviorCreateSource', secondScriptId, 'change');
    await click('#sceneBehaviorCreateAddBinding'); ids.push(await value('#sceneBehaviorCreateBindingList'));
    await fill('#sceneBehaviorCreateInstance', instances[0], 'change'); await fill('#sceneBehaviorCreateSource', scriptId, 'change');
    assert.equal(new Set(ids).size,3);
    for(const [index,id] of ids.entries()) {
      await fill('#sceneBehaviorCreateBindingList',id,'change');
      assert.equal(await value('#sceneBehaviorCreateSource'),index===1?secondScriptId:scriptId);
      assert.equal(await value('#sceneBehaviorCreateInstance'),instances[index===1?1:0]);
    }
    return ids;
  };
  await openCreate(); const firstIds=await configureBindings(); await reviewCreate();
  await fill('#sceneBehaviorCreateBindingList',firstIds[1],'change');
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorCreateSave').disabled`),false,'selection alone preserves review');
  await fill('#sceneBehaviorCreateSource',scriptId,'change');
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorCreateSave').disabled`),true,'changing script invalidates review');
  await fill('#sceneBehaviorCreateSource',secondScriptId,'change'); await reviewCreate();
  const firstPreview = await evaluate(`window.__behaviorCreates.at(-1)`);
  assert.equal(firstPreview.request.mode,'preview'); assert.equal(firstPreview.request.command,'behavior.create');
  assert.equal(await evaluate(`document.querySelectorAll('#sceneBehaviorCreateRelations li').length`),4);
  assert.deepEqual(await authorTree(root),initial);
  await screenshot('behavior-create-review-desktop.png');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('.scene-behavior-create-body').scrollTop=0`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneBehaviorCreateDialog'),rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};return {noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,close:rect('#sceneBehaviorCreateClose'),check:rect('#sceneBehaviorCreateCheck'),save:rect('#sceneBehaviorCreateSave'),title:document.querySelector('#sceneBehaviorCreateTitle').textContent,bodyScrollable:document.querySelector('.scene-behavior-create-body').scrollHeight>document.querySelector('.scene-behavior-create-body').clientHeight};})()`);
    assert.equal(layout.noHorizontalOverflow,true);assert.equal(layout.bodyScrollable,true);
    for(const action of ['close','check','save']) assert.ok(layout[action].top>=0&&layout[action].bottom<=844&&layout[action].left>=0&&layout[action].right<=390,JSON.stringify(layout));
    assert.equal(await value('#sceneBehaviorCreatePath'),manifestPath); assert.equal(await evaluate(`document.querySelector('#sceneBehaviorCreateSave').disabled`),false);
    report.layout[language]=layout;await screenshot(`behavior-create-${language}-390.png`);
    await evaluate(`document.querySelector('#sceneBehaviorCreateBindingList').scrollIntoView({block:'center'})`);
    const listView=await evaluate(`(()=>{const d=document.querySelector('#sceneBehaviorCreateDialog'),b=document.querySelector('.scene-behavior-create-body').getBoundingClientRect(),l=document.querySelector('#sceneBehaviorCreateBindingList').getBoundingClientRect();return {visible:l.top>=b.top&&l.bottom<=b.bottom,withinWidth:l.left>=0&&l.right<=390,noHorizontalOverflow:d.scrollWidth<=d.clientWidth,count:document.querySelectorAll('#sceneBehaviorCreateBindingList option').length};})()`);
    assert.deepEqual(listView,{visible:true,withinWidth:true,noHorizontalOverflow:true,count:3});report.layout[language].bindingList=listView;
    await screenshot(`behavior-create-${language}-390-bindings.png`);
  }
  await click('#sceneBehaviorCreateCancel');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorCreateDialog').open`),'creation cancelled');
  assert.deepEqual(await authorTree(root),initial);
  report.steps.push('A saved Scene2D without any behavior opens first-behavior creation. Three bindings share two scene instances and two scripts; stable identities survive selection and full source and all four deduplicated relationships are reviewed, then Cancel writes nothing. Chinese, English and Japanese at 390px preserve fields and review, keep Return/Review/Save visible, and allow body scrolling without horizontal overflow.');
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await openCreate();const nextIds=await configureBindings();assert.ok(nextIds.every(id=>!firstIds.includes(id)));await reviewCreate();const preview=await evaluate(`window.__behaviorCreates.at(-1)`);
  assert.notEqual(preview.request.objectId,firstPreview.request.objectId);const createdId=preview.request.objectId;
  await click('#sceneBehaviorCreateSave');await enabled('#sceneBehaviorCreateOpen');
  const savedReceipt=await evaluate(`window.__behaviorCreates.at(-1)`);assert.equal(savedReceipt.result.status,'applied');
  assert.equal(savedReceipt.request.content,preview.request.content);assert.equal(savedReceipt.request.objectId,createdId);
  const original=await readSource(),created=JSON.parse(original);assert.equal(original,preview.request.content);
  assert.equal(created.bindings.length,3);assert.deepEqual(created.bindings.map(item=>item.bindingId),nextIds);for(const item of created.bindings){assert.deepEqual(item.parameters,{});assert.deepEqual(item.events,[]);}
  const recordPath=`metadata/documents/${createdId}.json`,record=JSON.parse(await fs.readFile(path.join(root,recordPath),'utf8'));
  assert.deepEqual(record.relations,[sceneId,scriptId,secondScriptId].sort().map(targetId=>({kind:'references',targetId,slot:''})));
  const afterMetadata=await fs.readFile(path.join(root,sceneMetadataPath),'utf8');assert.ok(afterMetadata.includes('\r\n'));
  const afterCreate=await authorTree(root),actualChanges=[...new Set([...Object.keys(initial),...Object.keys(afterCreate)])].filter(name=>initial[name]!==afterCreate[name]);
  assert.deepEqual(actualChanges.sort(),[manifestPath,recordPath,sceneMetadataPath].sort());
  const nextSceneMetadata=JSON.parse(afterMetadata.replace(/^\ufeff/,''));assert.deepEqual(nextSceneMetadata.relations,[...sceneMetadata.relations,{kind:'behavior',targetId:createdId,slot:''}]);
  report.creation={objectId:createdId,bindingIds:created.bindings.map(item=>item.bindingId),changedAuthorPaths:actualChanges,sourceRevision:savedReceipt.result.changes[0].afterSourceRevision,relations:record.relations,sceneRelation:nextSceneMetadata.relations.at(-1)};
  await click('#sceneBehaviorCreateOpen');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorCreateDialog').open&&!document.querySelector('#projectBuildDialog').open`),'source navigation closes dialogs');
  await enabled('#sceneBehaviorsBtn');await wait(()=>evaluate(`document.activeElement===document.querySelector('#docSourceEditor')`),'source editor focused after both dialogs close');report.sourceFocus=await evaluate(`document.activeElement.id`);assert.equal(await value('#docSourceEditor'),visible(original));
  assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.editInputMode`),'source');
  report.steps.push('One reviewed transaction creates exactly the manifest and its registration and appends the scene behavior relationship, retaining the scene metadata CRLF. Scene/script/asset source bytes are unchanged. The explicit Open button enters the real source editor and exposes the existing behavior editor.');
  await click('#sceneBehaviorsBtn');await enabled('#sceneBehaviorsAddParameter');
  for(const [index,binding] of created.bindings.entries()) {
    await fill('#sceneBehaviorsBinding',binding.bindingId,'change');
    assert.equal(await value('#sceneBehaviorsSource'),index===1?secondScriptId:scriptId);
    await click('#sceneBehaviorsAddParameter');await fill('#sceneBehaviorsParam0Name','checkpoint');await fill('#sceneBehaviorsParam0Value',`multi_${index}`);
    await click('#sceneBehaviorsAddParameter');await fill('#sceneBehaviorsParam1Name','amount');await fill('#sceneBehaviorsParam1Type','number','change');await fill('#sceneBehaviorsParam1Value',String([65,20,7][index]));
    await click('#sceneBehaviorsAddEvent');await fill('#sceneBehaviorsEvent0Signal','arrived');await fill('#sceneBehaviorsEvent0Name',`multi_checkpoint_${index}`);
  }
  await click('#sceneBehaviorsCheck');await enabled('#sceneBehaviorsApply');
  const candidate=await evaluate(`document.querySelector('#sceneBehaviorsAfter').textContent`),parsed=JSON.parse(candidate);
  for(const [index,binding] of parsed.bindings.entries()) {
    assert.deepEqual(binding.parameters,{checkpoint:`multi_${index}`,amount:[65,20,7][index]});
    assert.deepEqual(binding.events,[{signal:'arrived',event:`multi_checkpoint_${index}`}]);
    assert.equal(binding.bindingId,created.bindings[index].bindingId);
  }
  await screenshot('behavior-create-parameters-review.png');
  await click('#sceneBehaviorsApply');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`),'behavior draft applied');
  assert.equal(await value('#docSourceEditor'),visible(candidate));assert.equal(await readSource(),original);
  await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readSource()===candidate,'ordinary behavior save');
  await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges && !document.querySelector('#sceneBehaviorsBtn').disabled`),'save and index refresh complete');
  const after=await authorTree(root);assert.deepEqual(after,{...afterCreate,[manifestPath]:buildHash(Buffer.from(candidate))});
  report.saved={beforeSha256:buildHash(Buffer.from(original)),afterSha256:buildHash(Buffer.from(candidate)),onlyChangedAuthorPath:manifestPath};
  report.steps.push('The independent behavior editor configures separate text/number parameters and signal aliases for all three stable bindings across two scripts. Apply only changes the draft; ordinary Save persists those exact reviewed bytes and changes no other author files.');
  await click('#projectBuildBtn'); await enabled('#projectBuildPlan');
  async function perform(selector, kind) {
    const previous = (await state()).job?.id; await enabled(selector); await click(selector); let job;
    await wait(async () => { job = (await state()).job; return job?.kind === kind && job.id !== previous && job.status !== 'running'; }, kind, 90000);
    report.jobs.push(job); assert.equal(job.status, 'succeeded', JSON.stringify(job)); return job;
  }
  const planned = await perform('#projectBuildPlan', 'plan'); assert.equal(planned.plan.behaviorBindingCount, 3); assert.equal(planned.plan.behaviorSourceCount, 2);
  const built = await perform('#projectBuildGenerate', 'build'), ran = await perform('#projectBuildHeadless', 'run');
  const events=ran.events.filter(event=>event.event==='behavior');assert.equal(events.length,3);
  for(const [index,binding] of parsed.bindings.entries()) {const event=events.find(item=>item.bindingId===binding.bindingId);assert.ok(event);assert.equal(event.name,`multi_checkpoint_${index}`);assert.deepEqual(event.arguments,[`multi_${index}`,[65,20,7][index]]);assert.equal(event.instanceId,binding.instanceId);}
  report.behaviorEvents=events;await screenshot('behavior-create-godot-events.png');
  report.steps.push('The newly created and edited manifest drives real Godot plan → build → headless run: two scripts across three stable bindings emit all three independently configured events on their declared instances, including two bindings on one instance.');
  await evaluate(`(() => { window.__deliveryReceipts=[]; const original=window.fetch.bind(window); window.fetch=async(input,init)=>{const response=await original(input,init);let body;try{body=JSON.parse(init?.body||'null')}catch{};if(body?.kind==='backend-project'){const result=await response.clone().json();window.__deliveryReceipts.push(result.data||result)}return response;}; })()`);
  await enabled('#backendProjectInspect'); await click('#backendProjectInspect'); await enabled('#backendProjectDeliver'); await click('#backendProjectDeliver');
  await enabled('#backendDeliveryPrepare'); await click('#backendDeliveryPrepare'); await enabled('#backendDeliveryDownload');
  const receipt = await evaluate(`window.__deliveryReceipts.at(-1)`); assert.equal(receipt.delivery.project.buildId, built.buildId);
  await click('#backendDeliveryDownload'); await wait(() => evaluate(`!document.querySelector('#backendDeliveryDownload').disabled`), 'download started'); await click('#backendDeliveryClose');
  const archive = path.join(download, receipt.fileName); await wait(async () => { try { return (await fs.stat(archive)).size === receipt.bytes; } catch { return false; } }, 'browser ZIP saved');
  const verified = await verifyBackendProjectDelivery(archive), extraction = path.join(temporary, 'delivered'); await fs.mkdir(extraction);
  const unzip = await runCommand('unzip', ['-q', archive, '-d', extraction], { cwd: temporary }); assert.equal(unzip.code, 0, JSON.stringify(unzip));
  const p = receipt.delivery.project;
  assert.ok(p.files.some(file => file.path.endsWith('.gd'))); assert.equal(planned.plan.behaviorSourceCount, 2); assert.ok(p.resources.length > 0);
  const imported = await runCommand(tool, ['--headless', '--editor', '--path', path.join(extraction, 'project'), '--import', '--quit'], { cwd: temporary, env });
  assert.equal(imported.code, 0, JSON.stringify(imported)); assert.doesNotMatch(imported.stdout + imported.stderr, /SCRIPT ERROR|Parse Error/);
  report.delivery = { fileName: receipt.fileName, bytes: receipt.bytes, sha256: buildHash(await fs.readFile(archive)), fileCount: verified.fileCount,
    assetCount: verified.assetCount, buildId: p.buildId, projectKind: p.project.kind, godotImport: { code: imported.code, stdout: imported.stdout, stderr: imported.stderr } };
  assert.deepEqual(await authorTree(root), after); assert.deepEqual(report.errors, []);
  report.steps.push('The resulting generated project is inspected, delivered through a real browser download, independently verified and extracted, then imported by real Godot at a new location. Scripts and image resources are present; no further author writes occur.');
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
