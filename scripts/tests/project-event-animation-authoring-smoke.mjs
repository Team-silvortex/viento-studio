// Actual browser event animation starter, first binding and named clip parameter authoring.
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
import { readRegistry } from '../lib/workspace.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/project-event-animation');
const output = path.resolve(process.env.VIENTO_PROJECT_EVENT_ANIMATION_AUTHORING_OUTPUT || path.join(evidenceRoot, `browser-authoring-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/project-event-animation.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt:new Date().toISOString(),steps:[],screenshots:[],errors:[],dialogs:[],layout:{script:{},behavior:{}},limitations:[
  'Actual Chrome on a local HTTP editor and disposable copied author workspace. No installed Tauri or Android acceptance.',
  'This proves ordinary TXT creation, first behavior registration, explicit named clip selection and ordinary Save. Native event subscription and engine execution are tested separately.'
] };
const sources=['engine/script-authoring.mjs','engine/scene-animation-directory.mjs','web/modules/app-script-create.js','web/modules/app-scene-behavior-create.js','web/modules/app-scene-behaviors.js','web/modules/app-scene-behavior-animation-clips.js','web/modules/app-behavior-source.js','web/modules/app-doc-service.js','web/modules/app-runtime.js','web/script-create.css','web/scene-behaviors.css','web/i18n/en.js','web/i18n/ja.js','scripts/tests/project-event-animation-authoring-smoke.mjs'];
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
  const root=path.join(temporary,'author'),download=path.join(temporary,'downloads');await fs.mkdir(download);await fs.cp(path.join(appRoot,'examples/scene-animation'),root,{recursive:true});
  const sceneId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',animationFile=path.join(root,'documents/animations/demo.json'),animation=JSON.parse(await fs.readFile(animationFile,'utf8'));
  animation.schemaVersion=3;animation.clips=[{id:'77777777-7777-4777-8777-000000000001',name:'Idle / 待機',startSeconds:0,endSeconds:1,loop:true},{id:'77777777-7777-4777-8777-000000000002',name:'Attack / 攻撃',startSeconds:.5,endSeconds:2,loop:false}];await fs.writeFile(animationFile,JSON.stringify(animation,null,2)+'\n');
  let scriptId;
  const manifestPath = 'documents/behaviors/demo.json', manifestFile = path.join(root, manifestPath);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
 XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
  delete env.VIENTO_GODOT_BIN; delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
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
  const starter = listScriptStarters().find(item => item.id === 'godot-project-animation-event');
  const openScript = async () => {
    await enabled('#scriptCreateBtn'); await click('#scriptCreateBtn'); await enabled('#scriptCreateApply');
    await fill('#scriptCreateStarter', 'godot-project-animation-event', 'change'); await fill('#scriptCreateType', 'character', 'change');
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
    assert.equal(await value('#scriptCreateStarter'), 'godot-project-animation-event');
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
  report.steps.push('The event animation starter previews every exact script byte. Its event and clip parameters, selected path and existing character document type persist in Chinese, English and Japanese at 390px; the final source line is reachable by scrolling. Return/Create/Cancel remain visible. Cancel changes no editor state or author files.');
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
  assert.ok(catalog.sources.some(item => item.objectId === scriptId && item.sourcePath === scriptPath));
  report.script={starterId:starter.id,sourcePath:scriptPath,objectId:scriptId,documentType:scriptRecord.documentType,sourceSha256:buildHash(Buffer.from(starter.content)),changedAuthorPaths:[scriptPath,`metadata/documents/${scriptId}.json`],sourceFocused:true,ordinarySaveCount:await evaluate(`window.__scriptSaves.length`)};
  await screenshot('script-create-ordinary-save.png');
  report.steps.push('Create script opens the normal TXT source draft and focuses its editor without any file or registration write. Ordinary Save stores the reviewed GDScript bytes under the existing character type, adds only source plus registration, and immediately makes that source visible to the existing behavior source directory.');
  await enabled('#projectBuildBtn');await click('#projectBuildBtn');await enabled('#projectBuildScene');await fill('#projectBuildScene',sceneId,'change');await enabled('#projectBuildCreateBehavior');
  const openCreation=async()=>{await click('#projectBuildCreateBehavior');await enabled('#sceneBehaviorCreateCheck');await fill('#sceneBehaviorCreateProfile','godot-gdscript','change');await fill('#sceneBehaviorCreateType','character','change');await fill('#sceneBehaviorCreatePath',manifestPath);await fill('#sceneBehaviorCreateSource',scriptId,'change');};
  const reviewCreation=async()=>{await click('#sceneBehaviorCreateCheck');await enabled('#sceneBehaviorCreateSave');};
  await openCreation();await reviewCreation();const firstCreation=await evaluate('window.__behaviorCreates.at(-1)');assert.equal(firstCreation.request.mode,'preview');assert.deepEqual(JSON.parse(firstCreation.request.content).bindings[0].parameters,{});assert.deepEqual(await authorTree(root),afterScript);await click('#sceneBehaviorCreateCancel');await wait(()=>evaluate("!document.querySelector('#sceneBehaviorCreateDialog').open"),'creation cancellation');assert.deepEqual(await authorTree(root),afterScript);
  await openCreation();await reviewCreation();const createdPreview=await evaluate('window.__behaviorCreates.at(-1)');await click('#sceneBehaviorCreateSave');await enabled('#sceneBehaviorCreateOpen');const creation=await evaluate('window.__behaviorCreates.at(-1)');assert.equal(creation.result.status,'applied');assert.equal(creation.request.content,createdPreview.request.content);
  const original=await readSource(),created=JSON.parse(original),behaviorId=creation.request.objectId;assert.equal(original,creation.request.content);assert.equal(created.bindings.length,1);assert.equal(created.bindings[0].implementation.sourceObjectId,scriptId);assert.deepEqual(created.bindings[0].parameters,{});assert.deepEqual(created.bindings[0].events,[]);
  const behaviorRegistration=`metadata/documents/${behaviorId}.json`,sceneRegistration=`metadata/documents/${sceneId}.json`,afterCreation=await authorTree(root);
  assert.deepEqual(Object.keys(afterCreation).filter(name=>afterCreation[name]!==afterScript[name]).sort(),[manifestPath,behaviorRegistration,sceneRegistration].sort());assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,behaviorRegistration),'utf8')).relations,[sceneId,scriptId].sort().map(targetId=>({kind:'references',targetId,slot:''})));
  await click('#sceneBehaviorCreateOpen');await wait(()=>evaluate("!document.querySelector('#sceneBehaviorCreateDialog').open&&!document.querySelector('#projectBuildDialog').open"),'created behavior source');await enabled('#sceneBehaviorsBtn');assert.equal(await value('#docSourceEditor'),visible(original));report.creation={objectId:behaviorId,bindingId:created.bindings[0].bindingId,sourceId:scriptId,changedAuthorPaths:[manifestPath,behaviorRegistration,sceneRegistration]};
  report.steps.push('The existing first-behavior UI reviews and cancels without writes, then saves one binding to the new script in one explicit transaction. It creates only the behavior source and registration plus the scene relationship. Open enters the ordinary behavior source editor.');

  const openBehavior=async()=>{await enabled('#sceneBehaviorsBtn');await click('#sceneBehaviorsBtn');await enabled('#sceneBehaviorsAddParameter');};
  const configure=async()=>{await click('#sceneBehaviorsAddParameter');await fill('#sceneBehaviorsParam0Name','event_name');await fill('#sceneBehaviorsParam0Value','checkpoint');await click('#sceneBehaviorsAddParameter');await fill('#sceneBehaviorsParam1Name','clip_id');await fill('#sceneBehaviorsParam1Value','');await enabled('#sceneBehaviorsLoadAnimationClips');await click('#sceneBehaviorsLoadAnimationClips');await enabled('#sceneBehaviorsParam1AnimationClip');};
  await openBehavior();await configure();const clipId='77777777-7777-4777-8777-000000000002';assert.equal(await value('#sceneBehaviorsParam1Value'),'');
  const choices=await evaluate("Array.from(document.querySelector('#sceneBehaviorsParam1AnimationClip').options,option=>({id:option.value,text:option.textContent}))");assert.ok(choices.find(choice=>choice.id===clipId).text.includes('Attack / 攻撃'));report.choices=choices;
  await fill('#sceneBehaviorsParam1AnimationClip',clipId,'change');assert.equal(await value('#sceneBehaviorsParam1Value'),'');await click('#sceneBehaviorsParam1UseAnimationClip');assert.equal(await value('#sceneBehaviorsParam1Value'),clipId);await click('#sceneBehaviorsCheck');await enabled('#sceneBehaviorsApply');const candidate=await evaluate("document.querySelector('#sceneBehaviorsAfter').textContent");assert.deepEqual(JSON.parse(candidate).bindings[0].parameters,{event_name:'checkpoint',clip_id:clipId});assert.deepEqual(await authorTree(root),afterCreation);assert.equal(await readSource(),original);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']){
    await evaluate("(window.__clip=document.querySelector('#sceneBehaviorsParam1Value'),window.__clip.focus(),window.__clip.setSelectionRange(1,8))");await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);assert.equal(await evaluate("document.querySelector('#sceneBehaviorsParam1Value')===window.__clip&&document.activeElement===window.__clip&&window.__clip.selectionStart===1&&window.__clip.selectionEnd===8"),true);assert.equal(await value('#sceneBehaviorsParam0Value'),'checkpoint');assert.equal(await value('#sceneBehaviorsParam1Value'),clipId);assert.equal(await evaluate("document.querySelector('#sceneBehaviorsAfter').textContent"),candidate);assert.equal(await evaluate("document.querySelector('#sceneBehaviorsApply').disabled"),false);await evaluate("document.querySelector('#sceneBehaviorsParam1UseAnimationClip').scrollIntoView({block:'center'})");
    const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneBehaviorsDialog'),r=id=>{const b=document.querySelector(id).getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight;};return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,insert:r('#sceneBehaviorsParam1UseAnimationClip'),apply:r('#sceneBehaviorsApply'),cancel:r('#sceneBehaviorsCancel')};})()`);assert.ok(Object.values(layout).every(Boolean),JSON.stringify(layout));report.layout.behavior[language]=layout;await screenshot(`event-animation-parameters-${language}-390.png`);
  }
  await click('#sceneBehaviorsCancel');await wait(()=>evaluate("!document.querySelector('#sceneBehaviorsDialog').open"),'behavior form cancellation');assert.deepEqual(await authorTree(root),afterCreation);assert.equal(await value('#docSourceEditor'),visible(original));await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");
  report.steps.push('Event name remains an ordinary string. The saved animation directory offers clips by name, interval and full UUID; tentative selection does not fill clip_id, and explicit insertion does. Three languages at390px retain field nodes, selection, values and complete review. Cancel leaves the created behavior source unchanged.');
  await openBehavior();await configure();await fill('#sceneBehaviorsParam1AnimationClip',clipId,'change');await click('#sceneBehaviorsParam1UseAnimationClip');await click('#sceneBehaviorsCheck');await enabled('#sceneBehaviorsApply');assert.equal(await evaluate("document.querySelector('#sceneBehaviorsAfter').textContent"),candidate);await screenshot('event-animation-parameters-review.png');await click('#sceneBehaviorsApply');await wait(()=>evaluate("!document.querySelector('#sceneBehaviorsDialog').open"),'parameter draft applied');assert.equal(await value('#docSourceEditor'),visible(candidate));assert.equal(await readSource(),original);assert.deepEqual(await authorTree(root),afterCreation);await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readSource()===candidate,'ordinary parameter Save');await wait(()=>evaluate("!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges&&!document.querySelector('#sceneBehaviorsBtn').disabled"),'saved parameter source settled');
  assert.deepEqual(await authorTree(root),{...afterCreation,[manifestPath]:buildHash(Buffer.from(candidate))});assert.equal(await fs.readFile(scriptFile,'utf8'),starter.content);await openBehavior();assert.equal(await value('#sceneBehaviorsParam0Value'),'checkpoint');assert.equal(await value('#sceneBehaviorsParam1Value'),clipId);await click('#sceneBehaviorsCancel');report.saved={onlyChangedAuthorPath:manifestPath,beforeSha256:buildHash(Buffer.from(original)),afterSha256:buildHash(Buffer.from(candidate)),parameters:{event_name:'checkpoint',clip_id:clipId}};
  report.steps.push('Applying the reviewed parameters changes only the normal source draft. Ordinary Save persists exact reviewed behavior bytes, reopening retains event_name and clip_id, and the new starter script plus every other author file remain unchanged. Engine execution is tested separately.');
  assert.deepEqual(report.errors,[]);
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
