// Actual browser saved script references, source navigation and ordinary parameter repair.
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
import { generateEditableGodotAnimationStateScript as generateGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';

const table = {initialState:'idle',states:[{key:'idle'},{key:'strike'},{key:'walk'}],transitions:[
  {from:'idle',to:'strike',trigger:{kind:'event',name:'action'}},
  {from:'strike',to:'idle',trigger:{kind:'completed'}},
  {from:'idle',to:'walk',trigger:{kind:'event',name:'move'}},
  {from:'walk',to:'idle',trigger:{kind:'event',name:'stop'}},
  {from:'walk',to:'strike',trigger:{kind:'event',name:'action'}},
]};

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/script-usage');
const output = path.resolve(process.env.VIENTO_SCRIPT_USAGE_OUTPUT || path.join(evidenceRoot, `browser-authoring-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/script-usage.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: { behavior: {} }, limitations: [
  'Actual Chrome with isolated HTTP editor; no installed Tauri, Android or native engine execution claim.',
  'Fixtures prepare registered scenes, saved state-table script and three bindings across two scenes. GUI coverage starts at script usage, not creating the initial workspace.',
  'Only registered nonownership references are enumerated; dynamic script references and undeclared dependencies are not inferred.'
] };
const sources = ['engine/script-usage.mjs', 'scripts/lib/script-usage-service.mjs', 'scripts/lib/doc-api-service.mjs', 'scripts/lib/doc-server-routes.mjs', 'web/modules/app-script-usage.js', 'web/modules/app-script-usage-source.js', 'web/modules/app-runtime.js', 'web/modules/app-studio-system.js', 'web/modules/app-doc-service.js', 'web/script-usage.css', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/script-usage-smoke.mjs'];
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
let socket, captureFailure, acceptDialogs = false;
try {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-script-authoring-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const authorFixture = await projectEventAnimationAuthor(fixture);
  const root = authorFixture.author, download = path.join(temporary, 'downloads'); await fs.mkdir(download);
  const attackId = authorFixture.clipIds[0][1], idleId = authorFixture.clipIds[0][0];
  await authorFixture.edit('documents/animations/scene-0.json', document => { document.clips[1].endSeconds = .75; });
  const generated = generateGodotAnimationStateScript(table);
  await authorFixture.script('checkpoint', generated.content);
  await authorFixture.configure({clip_idle:idleId,clip_attack:attackId});
  await authorFixture.script('publisher', 'extends Node\n');
  await authorFixture.edit('documents/behaviors/demo.json',model=>model.bindings.push({...structuredClone(model.bindings[0]),bindingId:'61616161-6161-4161-8161-000000000001'}));
  await authorFixture.edit('documents/behaviors/second.json',model=>{model.bindings[0].implementation.sourceObjectId=authorFixture.scriptId;model.bindings[0].parameters={clip_idle:authorFixture.clipIds[1][0],clip_attack:authorFixture.clipIds[1][1]};});
  await authorFixture.edit(`metadata/documents/${authorFixture.secondManifestId}.json`,record=>record.relations.push({kind:'reference',targetId:authorFixture.scriptId,slot:'shared-controller'}));
  await authorFixture.edit('metadata/documents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json',record=>record.relations.push({kind:'reference',targetId:authorFixture.scriptId,slot:'implementation-notes'}));
  const manifestPath = 'documents/behaviors/demo.json', manifestFile = path.join(root, manifestPath);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
    XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
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
    else if (value.method === 'Page.javascriptDialogOpening') { report.dialogs.push({ type: value.params.type, message: value.params.message }); void call('Page.handleJavaScriptDialog', { accept: acceptDialogs }); }
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
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,system:(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()})`); report.serviceFailure = await state(); report.editorFailure = await evaluate(`(()=>import('/web/modules/app-state.js').then(({appState:s})=>({isSaving:s.isSaving,isRebuilding:s.isRebuilding,isMutatingWorld:s.isMutatingWorld,dirty:s.editHasUnsavedChanges,creating:s.isCreating,planDisabled:document.querySelector('#projectBuildPlan')?.disabled,behaviorDisabled:document.querySelector('#sceneBehaviorsBtn')?.disabled})))()`); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: download, eventsEnabled: true });
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor startup');
  const manifestBefore=await readSource(),originalModel=JSON.parse(manifestBefore),bindingId=originalModel.bindings[0].bindingId;
  const scriptPath='documents/scripts/checkpoint.txt',dirtyScript=generated.content+'\n# unsaved source preserved until confirmed\n';
  await wait(()=>evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(b=>b.dataset.path.endsWith('/'+${JSON.stringify(scriptPath)}))`),'script in sidebar');
  const openScript=async()=>{
    await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(b=>b.dataset.path.endsWith('/'+${JSON.stringify(scriptPath)})).click()`);
    await wait(()=>evaluate(`document.querySelector('#docSourceEditor').value===${JSON.stringify(generated.content)}`),'saved script editor');
    await enabled('#docEditBtn');await click('#docEditBtn');await enabled('#scriptUsageBtn');
  };
  const openUsage=async()=>{await click('#scriptUsageBtn');await enabled('#scriptUsageSource1Binding1');};
  await openScript();await fill('#docSourceEditor',dirtyScript);await openUsage();
  assert.equal(await value('#docSourceEditor'),dirtyScript);
  assert.equal(await evaluate(`document.querySelectorAll('#scriptUsageReferences [id*="Binding"]').length`),3);
  await screenshot('usage-references-desktop.png');
  await click('#scriptUsageSource1Binding1');await enabled('#scriptUsageOpenSource');
  const sourceView=await evaluate(`(()=>{const s=document.querySelector('#scriptUsageSource');return {content:s.value,start:s.selectionStart,end:s.selectionEnd};})()`);
  assert.equal(sourceView.content,manifestBefore);assert.equal(JSON.parse(sourceView.content.slice(sourceView.start,sourceView.end)).bindingId,bindingId);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']){
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('#scriptUsageReferences').scrollIntoView({block:'start'})`);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#scriptUsageDialog'),r=document.querySelector('#scriptUsageClose').getBoundingClientRect();return {fits:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,close:{left:r.left,right:r.right,top:r.top,bottom:r.bottom}};})()`);
    assert.equal(layout.fits,true);assert.ok(layout.close.left>=0&&layout.close.right<=390&&layout.close.top>=0&&layout.close.bottom<=844);
    await screenshot(`usage-list-${language}-390.png`);
    await evaluate(`document.querySelector('#scriptUsageSource').scrollIntoView({block:'center'})`);await screenshot(`usage-source-${language}-390.png`);
    const selection=await evaluate(`(()=>{const s=document.querySelector('#scriptUsageSource');return {start:s.selectionStart,end:s.selectionEnd};})()`);
    assert.deepEqual(selection,{start:sourceView.start,end:sourceView.end});report.layout.behavior[language]=layout;
  }
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  assert.deepEqual(await authorTree(root),initial);
  report.steps.push('A dirty TXT queries saved registered references across two scenes and three bindings. Exact binding snapshots remain read-only; three-language 390px lists and source views preserve the selected range and author files.');
  await click('#scriptUsageOpenSource');await enabled('#scriptUsageOpenSource');
  assert.equal(await evaluate(`document.querySelector('#scriptUsageDialog').open`),true);assert.equal(await value('#docSourceEditor'),dirtyScript);
  assert.deepEqual(await authorTree(root),initial);assert.equal(report.dialogs.at(-1)?.type,'confirm');await screenshot('usage-cancel-navigation.png');
  acceptDialogs=true;await click('#scriptUsageOpenSource');
  await wait(()=>evaluate(`!document.querySelector('#scriptUsageDialog').open&&document.querySelector('#docSourceEditor').value===${JSON.stringify(manifestBefore)}&&!(await import('/web/modules/app-state.js')).appState.isLoadingSource`),'confirmed source navigation');
  const selected=await evaluate(`(()=>{const s=document.querySelector('#docSourceEditor');return s.value.slice(s.selectionStart,s.selectionEnd);})()`);
  assert.equal(JSON.parse(selected).bindingId,bindingId);assert.deepEqual(await authorTree(root),initial);
  await screenshot('usage-binding-editor.png');report.steps.push('Opening the source uses the existing dirty-draft confirmation: cancellation retains the script, confirmation opens the current behavior at the exact binding. Neither action saves any author file.');
  await enabled('#sceneBehaviorsBtn');await click('#sceneBehaviorsBtn');await enabled('#sceneBehaviorsAddParameter');await fill('#sceneBehaviorsBinding',bindingId,'change');
  await enabled('#sceneBehaviorsParam1ContractTarget');await fill('#sceneBehaviorsParam1ContractTarget','clip_strike','change');
  await click('#sceneBehaviorsParam1RenameParameter');await enabled('#sceneBehaviorsAddMissingParameters');await click('#sceneBehaviorsAddMissingParameters');
  await enabled('#sceneBehaviorsCheck');await click('#sceneBehaviorsCheck');await enabled('#sceneBehaviorsApply');
  const repaired=await evaluate(`document.querySelector('#sceneBehaviorsAfter').textContent`);
  await screenshot('usage-parameter-repair.png');await click('#sceneBehaviorsApply');
  await wait(()=>evaluate(`!document.querySelector('#sceneBehaviorsDialog').open&&document.querySelector('#docSourceEditor').value===${JSON.stringify(repaired)}`),'repair draft');
  assert.deepEqual(await authorTree(root),initial);
  await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readSource()===repaired,'ordinary behavior Save');
  await wait(()=>evaluate(`!(await import('/web/modules/app-state.js')).appState.isSaving&&!(await import('/web/modules/app-state.js')).appState.isRebuilding&&!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges`),'save refresh');
  const saved=JSON.parse(repaired);assert.equal(saved.bindings[0].parameters.clip_strike,attackId);assert.equal(Object.hasOwn(saved.bindings[0].parameters,'clip_attack'),false);
  assert.deepEqual(saved.bindings.slice(1),originalModel.bindings.slice(1));
  const after=await authorTree(root);assert.deepEqual(Object.keys(after).filter(p=>after[p]!==initial[p]),[manifestPath]);
  await openScript();await openUsage();await click('#scriptUsageSource1Binding1');
  const refreshed=await value('#scriptUsageSource');assert.equal(refreshed,repaired);assert.equal(await value('#docSourceEditor'),generated.content);
  await screenshot('usage-refreshed-after-save.png');assert.deepEqual(await authorTree(root),after);
  report.steps.push('The existing parameter interface repairs only the explicitly selected binding. Full review and ordinary Save modify only its behavior manifest. Reopening usage reads the newly saved values while the other two bindings and script stay unchanged.');
  assert.deepEqual(report.errors,[]);
  for(const [file,expected] of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);
  report.sourceSnapshotUnchanged=true;report.ok=true;
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  try { await captureFailure?.(); } catch (failure) { report.captureFailure = failure.message; }
} finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({cleanup:error.message}); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report,null,2) + '\n');
  console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));
}
