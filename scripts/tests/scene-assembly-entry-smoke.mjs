// Actual Chrome creates an explicit single-member assembly from its saved scene.
// The new project uses existing protocol 11; this does not enable standalone scene runtime.
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
import '../adapters/node-studio-core.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-assembly-entry');
const output = path.resolve(process.env.VIENTO_SCENE_ASSEMBLY_ENTRY_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/scene-assembly-entry.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome HTTP editor and trusted Godot headless execution; no installed Tauri, Android, native visual rendering or Bevy animation claim.',
  'The disposable fixture retains its existing assembly and all original author bytes. Only the explicitly reviewed new assembly JSON and its document registration may be created. A single member is an existing project capability; this test verifies the new author entry and its execution handoff.'
] };
const sources = ['engine/project-assembly.mjs','engine/project-assembly-plan.mjs','engine/project-assembly-plan-contract.mjs',
  'engine/project-animation-targets.mjs','engine/project-runtime-events.mjs','engine/project-runtime-query.mjs','engine/studio-core.wasm',
  'scripts/lib/project-assembly-documents.mjs','scripts/lib/project-documents.mjs','scripts/lib/project-build-service.mjs',
  'scripts/backends/godot4-project.mjs','scripts/backends/godot4/project-animation-target-runtime.gd',
  'scripts/backends/godot4/project-animation-targets.gd','scripts/backends/godot4/project-animation-target-completions.gd','scripts/backends/godot4-adapter.mjs',
  'web/modules/app-project-build.js','web/modules/app-project-assembly.js','web/project-assembly.css','web/project-build.css',
  'web/index.html','web/i18n/index.js','web/i18n/en.js','web/i18n/ja.js','scripts/tests/scene-assembly-entry-smoke.mjs'];
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
report.requests = [];
let socket, captureFailure;
try {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-assembly-entry-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const authorFixture = await projectEventAnimationAuthor(fixture);
  const root = authorFixture.author, download = path.join(temporary, 'downloads'); await fs.mkdir(download);
  const sceneId = authorFixture.sceneIds[0], existingAssemblyId = authorFixture.assemblyId;
  const assemblyDocumentType = (await authorFixture.read(`metadata/documents/${existingAssemblyId}.json`)).documentType;
  const instanceA = authorFixture.instanceId, instanceB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const [clipA, clipB] = authorFixture.clipIds[0];
  await authorFixture.edit('documents/animations/scene-0.json', document => {
    document.schemaVersion = 4; document.playbackScope = 'instance';
    document.clips[0] = { ...document.clips[0], name: '待机 / Idle / 待機', startSeconds: .25, endSeconds: .5, loop: false };
    document.clips[1] = { ...document.clips[1], name: '攻击 / Attack / 攻撃', startSeconds: .5, endSeconds: .75, loop: false };
    document.tracks.push(...document.tracks.map((track, index) => ({ ...structuredClone(track), id: `62626262-6262-4262-8262-${String(index + 100).padStart(12, '0')}`, instanceId: instanceB })));
  });
  const player = `extends Node\n@export var clip_id: String = ""\nfunc _ready() -> void:\n\tvar p = get_meta("viento_project")\n\tp.subscribe_animation_completed(_done)\n\tp.select_animation_clip(clip_id)\n\tp.play_animation()\nfunc _done(_clip) -> bool:\n\treturn true\n`;
  await authorFixture.script('checkpoint', player);
  await authorFixture.script('publisher', player);
  await authorFixture.script('second', player);
  await authorFixture.configure({clip_id:clipA});
  await authorFixture.edit('documents/behaviors/demo.json', manifest => {
    manifest.bindings[1].parameters = {clip_id:clipB};
    manifest.bindings.push({ ...structuredClone(manifest.bindings[0]), bindingId: authorFixture.secondBindingId, instanceId: instanceB,
      implementation: { ...manifest.bindings[0].implementation, sourceObjectId: authorFixture.secondScriptId } });
  });
  await authorFixture.edit('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', metadata => {
    metadata.relations.push({ kind: 'reference', targetId: authorFixture.secondScriptId, slot: 'implementation' });
  });
  report.fixture = { sceneId, existingAssemblyId, assemblyDocumentType, instanceA, instanceB, clipA, clipB,
    bindingA:authorFixture.receiverBindingId, secondBindingA:authorFixture.publisherBindingId, bindingB:authorFixture.secondBindingId,
    schemaVersion:4, playbackScope:'instance', playerSourceSha256:buildHash(player) };
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
    else if (value.method === 'Network.requestWillBeSent' && value.params.request.url.includes('/api/project-build') && value.params.request.postData) {
      try { const body = JSON.parse(value.params.request.postData); if (body.action) report.requests.push(body); } catch {}
    }
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
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: download, eventsEnabled: true });
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor startup');
  await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.includes('scenes/demo'))`), 'saved scene in sidebar');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scenes/demo')).click()`);
  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildScene');
  await fill('#projectBuildScene', sceneId, 'change');
  await enabled('#projectBuildAssemblyFromScene');
  const beforeEntry = await state();
  await click('#projectBuildAssemblyFromScene');
  await wait(() => evaluate(`document.querySelector('#projectAssemblyDialog')?.open && document.querySelector('#projectAssemblyCheck')?.disabled === false`), 'seeded assembly draft');
  const seeded = await evaluate(`(() => { const ids = s => Array.from(document.querySelector(s).options, option => option.value); return {
    name:document.querySelector('#projectAssemblyName').value,path:document.querySelector('#projectAssemblyPath').value,documentType:document.querySelector('#projectAssemblyType').value,
    members:ids('#projectAssemblyMembers'),entry:document.querySelector('#projectAssemblyEntry').value,
    saveDisabled:document.querySelector('#projectAssemblySave').disabled,reviewHidden:document.querySelector('#projectAssemblyReview').hidden,
    status:document.querySelector('#projectAssemblyStatus').textContent,dirty:document.querySelector('#projectAssemblyDialog').dataset.dirty
  }; })()`);
  assert.deepEqual(seeded.members,[sceneId]); assert.equal(seeded.entry,sceneId);
  assert.equal(seeded.saveDisabled,true); assert.equal(seeded.reviewHidden,true);
  assert.deepEqual(await authorTree(root),initial);
  assert.equal((await state()).job?.id,beforeEntry.job?.id);
  assert.equal(report.requests.filter(row=>row.action==='assembly-save').length,0);
  report.seeded = seeded; await screenshot('scene-assembly-seeded-desktop.png');
  const createdPath = 'documents/projects/single-instance.json', createdTitle = '单场景独立动画 / Single-scene animation / 単一シーン';
  await fill('#projectAssemblyName',createdTitle); await fill('#projectAssemblyPath',createdPath);
  await fill('#projectAssemblyType',assemblyDocumentType,'change');
  assert.equal(await value('#projectAssemblyType'),assemblyDocumentType);
  await enabled('#projectAssemblyCheck'); await click('#projectAssemblyCheck'); await enabled('#projectAssemblySave');
  const reviewedSource = await evaluate(`document.querySelector('#projectAssemblySource').textContent`), definition = JSON.parse(reviewedSource);
  assert.deepEqual(definition,{format:'viento-project-assembly',schemaVersion:1,title:createdTitle,entrySceneId:sceneId,sceneIds:[sceneId]});
  assert.deepEqual(await authorTree(root),initial);
  assert.equal(report.requests.filter(row=>row.action==='assembly-save').length,0);
  report.reviewed = {path:createdPath,definition,content:reviewedSource,sha256:buildHash(reviewedSource)};
  await evaluate(`document.querySelector('#projectAssemblyReview').scrollIntoView({block:'start'})`); await screenshot('scene-assembly-reviewed-desktop.png');
  await evaluate(`(()=>{window.__assemblyEntryInput=document.querySelector('#projectAssemblyName');window.__assemblyEntryInput.focus();window.__assemblyEntryInput.setSelectionRange(2,5);})()`);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for (const language of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('#projectAssemblyFields').scrollIntoView({block:'start'})`);
    const layout = await evaluate(`(()=>{const d=document.querySelector('#projectAssemblyDialog'),e=document.querySelector('#projectAssemblyName'),body=d.querySelector('.project-assembly-body');return {
      noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&body.scrollWidth<=body.clientWidth&&document.documentElement.scrollWidth<=innerWidth,
      title:document.querySelector('#projectAssemblyTitle').textContent,same:e===window.__assemblyEntryInput,focused:document.activeElement===e,
      value:e.value,start:e.selectionStart,end:e.selectionEnd,path:document.querySelector('#projectAssemblyPath').value,
      entry:document.querySelector('#projectAssemblyEntry').value,members:Array.from(document.querySelector('#projectAssemblyMembers').options,o=>o.value),
      review:document.querySelector('#projectAssemblySource').textContent,saveDisabled:document.querySelector('#projectAssemblySave').disabled,
      status:document.querySelector('#projectAssemblyStatus').textContent};})()`);
    assert.equal(layout.noHorizontalOverflow,true,JSON.stringify(layout)); assert.equal(layout.same,true); assert.equal(layout.focused,true);
    assert.equal(layout.value,createdTitle); assert.equal(layout.path,createdPath); assert.equal(layout.entry,sceneId);
    assert.deepEqual(layout.members,[sceneId]); assert.equal(layout.review,reviewedSource); assert.equal(layout.saveDisabled,false);
    assert.equal(layout.start,2); assert.equal(layout.end,5);
    report.layout[language]=layout; await screenshot(`scene-assembly-${language}-390.png`);
  }
  assert.equal(new Set(Object.values(report.layout).map(row=>row.title)).size,3);
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await enabled('#projectAssemblySave'); await click('#projectAssemblySave');
  await wait(() => evaluate(`document.querySelector('#projectAssemblyDialog').dataset.dirty==='false' && document.querySelector('#projectAssemblyClose').disabled===false && document.querySelector('#projectBuildScene').value!==${JSON.stringify(sceneId)}`),'explicit assembly save and parent target refresh',90000);
  const assemblyId = await value('#projectBuildScene'); assert.match(assemblyId,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.notEqual(assemblyId,existingAssemblyId); assert.notEqual(assemblyId,sceneId);
  assert.equal(await value('#projectAssemblyDocuments'),assemblyId);
  assert.equal(await evaluate(`document.querySelector('#projectAssemblyDocuments').selectedOptions[0]?.textContent`),createdTitle);
  report.savedPicker={id:assemblyId,title:createdTitle,immediate:true};
  const createdMetadataPath = `metadata/documents/${assemblyId}.json`;
  const actualSource = await fs.readFile(path.join(root,createdPath),'utf8'), registration = JSON.parse(await fs.readFile(path.join(root,createdMetadataPath),'utf8'));
  assert.equal(actualSource,reviewedSource); assert.equal(registration.id,assemblyId); assert.equal(registration.sourcePath,createdPath);
  assert.equal(registration.documentType,assemblyDocumentType); assert.deepEqual(registration.relations,[]); assert.deepEqual(registration.assetBindings,[]);
  const afterCreation = await authorTree(root);
  for (const [file,hash] of Object.entries(initial)) assert.equal(afterCreation[file],hash,`Existing author file changed: ${file}`);
  assert.deepEqual(Object.keys(afterCreation).filter(file=>!Object.hasOwn(initial,file)).sort(),[createdPath,createdMetadataPath].sort());
  assert.equal(report.requests.filter(row=>row.action==='assembly-save').length,1);
  assert.equal(report.requests.find(row=>row.action==='assembly-save').content,reviewedSource);
  assert.equal(report.requests.find(row=>row.action==='assembly-save').sourcePath,createdPath);
  const afterSave = await state(), target = afterSave.scenes.find(row=>row.id===assemblyId);
  assert.equal(target.kind,'project'); assert.equal(target.entrySceneId,sceneId); assert.equal(target.sceneCount,1);
  assert.ok(afterSave.scenes.some(row=>row.id===sceneId&&row.kind!=='project')); assert.ok(afterSave.scenes.some(row=>row.id===existingAssemblyId&&row.kind==='project'));
  report.created = {id:assemblyId,path:createdPath,metadataPath:createdMetadataPath,registration,content:actualSource,target};
  report.steps.push('The saved Scene2D entry opens a new explicit assembly draft with that scene as its only member and entry. The existing default document type follows the first project category; the author explicitly selects its existing project-assembly category before review. Editing and review do not save or run. Chinese, English and Japanese at 390px preserve input identity, focus, text selection, membership, complete reviewed source and save readiness. One explicit Save creates exactly one assembly JSON and one registration, keeping all pre-existing author bytes and the old assembly unchanged.');
  await screenshot('scene-assembly-saved-desktop.png'); await enabled('#projectAssemblyClose'); await click('#projectAssemblyClose');
  assert.equal(await evaluate(`document.querySelector('#projectAssemblyDialog').open`),false);
  assert.equal(await value('#projectBuildScene'),assemblyId);
  async function perform(selector,kind) {
    const previous=(await state()).job?.id;await enabled(selector);await click(selector);let job;
    await wait(async()=>{job=(await state()).job;return job?.kind===kind&&job.id!==previous&&!['queued','running'].includes(job.status);},kind,90000);
    report.jobs.push(job);assert.equal(job.status,'succeeded',JSON.stringify(job.diagnostics));return job;
  }
  const planned = await perform('#projectBuildPlan','plan');
  assert.equal(planned.targetKind,'project'); assert.equal(planned.targetId,assemblyId); assert.equal(planned.plan.sceneCount,1); assert.equal(planned.plan.entrySceneId,sceneId);
  const built = await perform('#projectBuildGenerate','build'); assert.equal(built.targetKind,'project');
  const ran = await perform('#projectBuildHeadless','run'), project = ran.runtime.project;
  const history = project.animationCommands, completed = project.animationCompletions;
  assert.equal(project.protocolVersion,11); assert.equal(history.sequence,6); assert.equal(completed.sequence,2);
  assert.deepEqual(history.entries.map(row=>row.command.action),['select','play','select','play','select','play']);
  assert.deepEqual(history.entries.map(row=>row.target.instanceId),[instanceA,instanceA,instanceA,instanceA,instanceB,instanceB]);
  assert.deepEqual(history.entries.map(row=>row.state.clipId),[clipA,clipA,clipB,clipB,clipA,clipA]);
  assert.deepEqual(history.entries.map(row=>row.origin.bindingId),[authorFixture.receiverBindingId,authorFixture.receiverBindingId,authorFixture.publisherBindingId,authorFixture.publisherBindingId,authorFixture.secondBindingId,authorFixture.secondBindingId]);
  assert.deepEqual(completed.entries.map(row=>[row.target.instanceId,row.targetCommandSequence,row.commandSequence]),[[instanceA,4,6],[instanceB,6,6]]);
  assert.deepEqual(completed.entries.map(row=>row.deliveries.length),[2,1]);
  assert.ok(completed.entries.every(row=>row.state.phase==='finished'&&row.deliveries.every(delivery=>delivery.status==='handled')));
  report.runtime={jobId:ran.id,protocolVersion:project.protocolVersion,history,completed,actualReceipts:true};
  await wait(()=>evaluate(`document.querySelector('#projectAnimationCommandsSequence')?.dataset.sequence==='6'&&document.querySelector('#projectAnimationCompletionsSequence')?.dataset.sequence==='2'`),'p11 receipt display');
  await enabled('.project-animation-command[data-sequence="1"] .project-animation-target-review-open');
  await click('.project-animation-command[data-sequence="1"] .project-animation-target-review-open');
  const panel = '#projectAnimationTargetReviewPanel';
  await wait(()=>evaluate(`!document.querySelector('${panel}').hidden&&document.querySelector('${panel}').dataset.targetInstanceId===${JSON.stringify(instanceA)}`),'target review from new project');
  const review = await evaluate(`(()=>{const p=document.querySelector('${panel}');return {target:{...p.dataset},commands:Array.from(p.querySelectorAll('.project-animation-target-review-command'),r=>Number(r.dataset.sequence)),completions:Array.from(p.querySelectorAll('.project-animation-target-review-completion'),r=>Number(r.dataset.sequence))};})()`);
  assert.deepEqual(review.commands,[1,2,3,4]); assert.deepEqual(review.completions,[1]); report.targetReview=review;
  await evaluate(`document.querySelector('${panel}').scrollIntoView({block:'start'})`); await screenshot('scene-assembly-running-target-review.png');
  report.steps.push('The saved assembly becomes the explicitly selected project target. Chrome plan/build/headless-run uses the actual Godot backend and existing protocol 11: three bindings on two instances produce six animation commands and two natural completions, with same-target command anchors 4 and 6. The resulting target review shows the expected shared A lane. This is a project assembly run, not standalone Scene2D support.');
  const final = await authorTree(root); assert.deepEqual(final,afterCreation); assert.deepEqual(report.errors,[]); assert.deepEqual(report.dialogs,[]);
  report.authorSnapshot={before:initial,afterCreation,after:final,existingUnchanged:true,createdOnly:[createdPath,createdMetadataPath],postSaveUnchanged:true};
  for(const[file,expected]of Object.entries(report.sources)) assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);
  report.sourceSnapshotUnchanged=true;report.ok=true;
} catch(error) {
  report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;
  try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}
} finally {
  socket?.close();
  for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}
  report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));
}
