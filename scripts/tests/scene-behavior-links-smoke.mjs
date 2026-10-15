// Existing behavior script linking, independent draft editing, Godot and delivery.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-behavior-links');
const output = path.resolve(process.env.VIENTO_BEHAVIOR_LINKS_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a fresh directory under the behavior-links evidence root.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome with local HTTP editor and a trusted Godot binary. No installed Tauri window, native picker, Android or other desktop OS claim.',
  'An existing two-binding Scene2D example is copied unchanged. A new script is authored in Studio, linked to its existing manifest, then used by a third binding. This does not test blank-project or upstream OC/projection creation.',
  'Godot executes headless logic. No rendering, Bevy author behavior, hot reload, LSP or standalone game export is claimed.'
] };
const sources = ['web/modules/app-scene-behavior-links.js', 'web/scene-behavior-links.css', 'engine/scene-behavior-directory.mjs',
  'scripts/lib/scene-behavior-directory-service.mjs', 'scripts/lib/doc-api-service.mjs', 'scripts/lib/doc-server-routes.mjs',
  'web/modules/app-doc-service.js', 'web/modules/app-studio-system.js', 'web/modules/app-project-build.js', 'web/modules/app-runtime.js',
  'web/modules/app-scene-behaviors.js', 'web/modules/app-behavior-source.js', 'web/modules/app-script-create.js',
  'engine/world-relations.mjs', 'scripts/adapters/node-world-commands.mjs', 'web/i18n/en.js', 'web/i18n/ja.js',
  'scripts/tests/scene-behavior-links-smoke.mjs'];
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-behavior-links-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'author'), download = path.join(temporary, 'downloads');
  await fs.cp(path.join(appRoot, 'examples/scene-behaviors'), root, { recursive: true }); await fs.mkdir(download);
  const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', scriptId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const manifestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const recordPath = `metadata/documents/${manifestId}.json`;
  const manifestPath = 'documents/behaviors/demo.json', manifestFile = path.join(root, manifestPath);
  const originalRecord = JSON.parse(await fs.readFile(path.join(root, recordPath), 'utf8'));
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
  await evaluate(`(() => {window.__behaviorLinks=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const response=await original(input,init);let body;try{body=JSON.parse(init?.body||'null')}catch{};if(body?.command==='relation.add'){const result=await response.clone().json();window.__behaviorLinks.push({request:body,result:result.data||result});}return response;};})()`);
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
  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildManageBehavior');
  const original=await readSource(), beforeBindings=JSON.parse(original).bindings;
  const openLinks = async () => { await click('#projectBuildManageBehavior'); await enabled('#sceneBehaviorLinksOpen'); };
  const reviewLink = async () => { await fill('#sceneBehaviorLinksSource',secondScriptId,'change');await enabled('#sceneBehaviorLinksCheck');await click('#sceneBehaviorLinksCheck');await enabled('#sceneBehaviorLinksSave'); };
  await openLinks();
  assert.equal(await evaluate(`document.querySelectorAll('#sceneBehaviorLinksScripts li').length`),1);
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorLinksScripts li').dataset.usage`),'used');
  await reviewLink();
  const firstPreview=await evaluate(`window.__behaviorLinks.at(-1)`);
  assert.equal(firstPreview.request.mode,'preview');assert.equal(firstPreview.request.objectId,manifestId);assert.equal(firstPreview.request.targetObjectId,secondScriptId);
  assert.equal(await evaluate(`document.querySelectorAll('#sceneBehaviorLinksRelations li').length`),1);
  assert.deepEqual(await authorTree(root),initial);
  await screenshot('behavior-links-review-desktop.png');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('.scene-behavior-links-body').scrollTop=0`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneBehaviorLinksDialog'),rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};return {noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,close:rect('#sceneBehaviorLinksClose'),check:rect('#sceneBehaviorLinksCheck'),save:rect('#sceneBehaviorLinksSave'),open:rect('#sceneBehaviorLinksOpen'),cancel:rect('#sceneBehaviorLinksCancel'),title:document.querySelector('#sceneBehaviorLinksTitle').textContent,bodyScrollable:document.querySelector('.scene-behavior-links-body').scrollHeight>document.querySelector('.scene-behavior-links-body').clientHeight};})()`);
    assert.equal(layout.noHorizontalOverflow,true);
    for(const action of ['close','check','save','open','cancel']) assert.ok(layout[action].top>=0&&layout[action].bottom<=844&&layout[action].left>=0&&layout[action].right<=390,JSON.stringify(layout));
    assert.equal(await value('#sceneBehaviorLinksSource'),secondScriptId);assert.equal(await evaluate(`document.querySelector('#sceneBehaviorLinksSave').disabled`),false);
    report.layout[language]=layout;await screenshot(`behavior-links-${language}-390.png`);
  }
  await click('#sceneBehaviorLinksCancel');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorLinksDialog').open`),'link cancelled');
  assert.deepEqual(await authorTree(root),initial);
  report.steps.push('Manage existing behavior finds the saved manifest and its used script. Preview reviews exactly one new script reference; Cancel writes nothing. Chinese, English and Japanese at 390px retain the selection/review and all footer and return controls without horizontal overflow.');
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await openLinks();await reviewLink();await click('#sceneBehaviorLinksSave');await enabled('#sceneBehaviorLinksOpen');
  const applied=await evaluate(`window.__behaviorLinks.at(-1)`);assert.equal(applied.result.status,'applied');assert.equal(applied.result.receipt.state,'committed');
  const afterLink=await authorTree(root),changed=Object.keys(afterLink).filter(name=>afterLink[name]!==initial[name]);assert.deepEqual(changed,[recordPath]);
  assert.equal(await readSource(),original);
  const linkedRecord=JSON.parse(await fs.readFile(path.join(root,recordPath),'utf8'));
  assert.deepEqual(linkedRecord,{...originalRecord,relations:[...originalRecord.relations,{kind:'references',targetId:secondScriptId,slot:''}]});
  assert.equal(await evaluate(`document.querySelectorAll('#sceneBehaviorLinksScripts li').length`),2);
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorLinksScripts li[data-object-id="${secondScriptId}"]').dataset.usage`),'available');
  assert.equal(await evaluate(`document.querySelector('#sceneBehaviorLinksSave').disabled`),true);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('#sceneBehaviorLinksSource option')).some(x=>x.value===${JSON.stringify(secondScriptId)})`),false);
  report.link={manifestId,sourceObjectId:secondScriptId,changedAuthorPaths:changed,receiptState:applied.result.receipt.state,relation:linkedRecord.relations.at(-1)};
  await screenshot('behavior-links-saved.png');
  report.steps.push('Save reference uses the real relation.add transaction and changes exactly the manifest registration. Scene, behavior text, scripts and assets remain byte-identical; the new script is shown as available but unused and cannot be added twice.');
  await click('#sceneBehaviorLinksOpen');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorLinksDialog').open&&!document.querySelector('#projectBuildDialog').open`),'source navigation closes dialogs');
  await enabled('#sceneBehaviorsBtn');await wait(()=>evaluate(`document.activeElement===document.querySelector('#docSourceEditor')`),'source editor focused');
  report.sourceFocus=await evaluate(`document.activeElement.id`);assert.equal(await value('#docSourceEditor'),visible(original));
  assert.equal(await evaluate(`(await import('/web/modules/app-state.js')).appState.editInputMode`),'source');
  await click('#sceneBehaviorsBtn');await enabled('#sceneBehaviorsAddBinding');await click('#sceneBehaviorsAddBinding');
  const thirdId=await value('#sceneBehaviorsBinding');assert.ok(!beforeBindings.some(binding=>binding.bindingId===thirdId));
  await fill('#sceneBehaviorsSource',secondScriptId,'change');
  await click('#sceneBehaviorsAddParameter');await fill('#sceneBehaviorsParam0Name','checkpoint');await fill('#sceneBehaviorsParam0Value','linked_in_studio');
  await click('#sceneBehaviorsAddParameter');await fill('#sceneBehaviorsParam1Name','amount');await fill('#sceneBehaviorsParam1Type','number','change');await fill('#sceneBehaviorsParam1Value','35');
  await click('#sceneBehaviorsAddEvent');await fill('#sceneBehaviorsEvent0Signal','arrived');await fill('#sceneBehaviorsEvent0Name','linked_checkpoint');
  await click('#sceneBehaviorsCheck');await enabled('#sceneBehaviorsApply');
  const candidate=await evaluate(`document.querySelector('#sceneBehaviorsAfter').textContent`),parsed=JSON.parse(candidate);
  assert.deepEqual(parsed.bindings.slice(0,2),beforeBindings);assert.equal(parsed.bindings.length,3);assert.equal(parsed.bindings[2].implementation.sourceObjectId,secondScriptId);
  assert.deepEqual(parsed.bindings[2].parameters,{checkpoint:'linked_in_studio',amount:35});assert.deepEqual(parsed.bindings[2].events,[{signal:'arrived',event:'linked_checkpoint'}]);
  await screenshot('behavior-links-binding-review.png');
  await click('#sceneBehaviorsApply');await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`),'behavior draft applied');
  assert.equal(await value('#docSourceEditor'),visible(candidate));assert.deepEqual(await authorTree(root),afterLink);
  await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readSource()===candidate,'ordinary behavior save');
  await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges && !document.querySelector('#sceneBehaviorsBtn').disabled`),'save and index refresh complete');
  const after=await authorTree(root);assert.deepEqual(after,{...afterLink,[manifestPath]:buildHash(Buffer.from(candidate))});
  report.saved={beforeSha256:buildHash(Buffer.from(original)),afterSha256:buildHash(Buffer.from(candidate)),onlyChangedAuthorPath:manifestPath,addedBindingId:thirdId,bindings:3,sources:2};
  report.steps.push('Open behavior source performs guarded navigation into the ordinary editor. The independent behavior editor now offers the linked script, adds a third stable binding with typed parameters and a signal, and retains both existing bindings. Apply edits only the draft; ordinary Save changes only the behavior source.');
  await click('#projectBuildBtn'); await enabled('#projectBuildPlan');
  async function perform(selector, kind) {
    const previous = (await state()).job?.id; await enabled(selector); await click(selector); let job;
    await wait(async () => { job = (await state()).job; return job?.kind === kind && job.id !== previous && job.status !== 'running'; }, kind, 90000);
    report.jobs.push(job); assert.equal(job.status, 'succeeded', JSON.stringify(job)); return job;
  }
  const planned = await perform('#projectBuildPlan', 'plan'); assert.equal(planned.plan.behaviorBindingCount, 3); assert.equal(planned.plan.behaviorSourceCount, 2);
  const built = await perform('#projectBuildGenerate', 'build'), ran = await perform('#projectBuildHeadless', 'run');
  const events=ran.events.filter(event=>event.event==='behavior');assert.equal(events.length,3);
  for(const binding of parsed.bindings) {const event=events.find(item=>item.bindingId===binding.bindingId);assert.ok(event);assert.equal(event.name,binding.events[0].event);assert.deepEqual(event.arguments,[binding.parameters.checkpoint,binding.parameters.amount]);assert.equal(event.instanceId,binding.instanceId);}
  report.behaviorEvents=events;await screenshot('behavior-links-godot-events.png');
  report.steps.push('The existing and newly linked scripts drive real Godot plan → build → headless run: three stable bindings produce east/40, west/20 and linked_in_studio/35 with their declared signal aliases and instances.');
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
