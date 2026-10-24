// Actual Chrome fresh author preflight → exact source repair → Godot build/run.
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
import { projectAnimationPreflightFixture } from './helpers/project-animation-preflight-fixture.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
import '../adapters/node-studio-core.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/project-animation-preflight');
const output = path.resolve(process.env.VIENTO_ANIMATION_PREFLIGHT_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/project-animation-preflight.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome HTTP editor and Godot headless execution; no installed Tauri, Android, visual renderer or Bevy animation claim.',
  'Only exact generated state controllers are semantically reviewed. Ordinary scripts, frozen builds and runtime protocol admission retain their existing contracts.'
] };
const sources = ['engine/project-animation-preflight.mjs','engine/animation-state-script-source.mjs','engine/project-animation-states.mjs',
  'scripts/adapters/node-build-snapshot.mjs','scripts/adapters/node-project-build.mjs','scripts/lib/project-build-service.mjs',
  'web/modules/app-project-build.js','web/modules/app-project-problems.js','web/i18n/en.js','web/i18n/ja.js',
  'scripts/tests/helpers/project-animation-preflight-fixture.mjs','scripts/tests/project-animation-preflight-smoke.mjs'];
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-animation-preflight-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const authorFixture = await projectAnimationPreflightFixture(fixture, { documents: 'design-data' });
  const root = authorFixture.author, download = path.join(temporary, 'downloads'); await fs.mkdir(download);
  const sceneId = authorFixture.sceneIds[0], assemblyId = authorFixture.assemblyId;
  report.fixture = {sceneId, assemblyId, behaviorPath:authorFixture.behaviorPath, missingClip:authorFixture.missingClip, goodClip:authorFixture.goodClip,
    controllerSha256:buildHash(authorFixture.controller), documents:authorFixture.documents};
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
  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildScene');
  await fill('#projectBuildScene', assemblyId, 'change'); await enabled('#projectBuildPlan');
  async function perform(selector, kind, status = 'succeeded') {
    const previous = (await state()).job?.id; await enabled(selector); await click(selector); let job;
    await wait(async () => { job = (await state()).job; return job?.kind === kind && job.id !== previous && job.status !== 'running'; }, kind, 90000);
    report.jobs.push(job); assert.equal(job.status, status, JSON.stringify(job.diagnostics)); return job;
  }
  const rejected = await perform('#projectBuildPlan', 'plan', 'failed');
  assert.equal(rejected.diagnostics.length, 1);
  const issue = rejected.diagnostics[0], pointer = '/bindings/1/parameters/clip_attack';
  assert.equal(issue.code, 'build_animation_state_clip_missing'); assert.equal(issue.sourcePath, authorFixture.behaviorPath); assert.equal(issue.propertyPath, pointer);
  assert.deepEqual(issue.sourceRange, locateJsonSource(parseJsonSource(authorFixture.behaviorText), pointer));
  assert.equal(authorFixture.behaviorText.slice(issue.sourceRange.start, issue.sourceRange.end), JSON.stringify(authorFixture.missingClip));
  assert.equal(await evaluate(`document.querySelector('#projectBuildGenerate').disabled`), true);
  assert.equal((await state()).latestBuild, null); assert.deepEqual((await state()).projects, []); assert.equal((await state()).toolStatus.status, 'unchecked');
  await assert.rejects(fs.stat(path.join(temporary, 'cache/io.viento.studio/builds')), {code:'ENOENT'});
  assert.deepEqual(await authorTree(root), initial);
  await wait(() => evaluate(`document.querySelectorAll('.project-problem-source').length===1`), 'preflight problem source');
  await evaluate(`document.querySelector('#projectBuildProblems').scrollIntoView({block:'start'})`); await screenshot('preflight-desktop.png');
  report.steps.push('A saved exact generated controller references a noninitial clip UUID owned only by another scene. GUI Plan rejects before any tool or generated output, points at the exact BOM/CRLF/UTF-16 JSON value and preserves every author byte.');
  await call('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:false});
  for (const language of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('#projectBuildProblems').scrollIntoView({block:'start'})`);
    const layout = await evaluate(`(() => { const d=document.querySelector('#projectBuildDialog'); return { noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,
      message:document.querySelector('.project-problem-message').textContent, source:document.querySelector('.project-problem-source').textContent, code:document.querySelector('.project-problem').dataset.code };})()`);
    assert.equal(layout.noHorizontalOverflow,true,JSON.stringify(layout)); assert.equal(layout.code,issue.code); report.layout[language]=layout;
    await screenshot('preflight-'+language+'-390.png');
  }
  assert.equal(new Set(Object.values(report.layout).map(row=>row.message)).size,3);
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await enabled('.project-problem-source'); await click('.project-problem-source');
  const visibleBefore = visible(authorFixture.behaviorText);
  await wait(() => evaluate(`!document.querySelector('#projectBuildDialog').open&&!(await import('/web/modules/app-state.js')).appState.isLoadingSource&&document.querySelector('#docSourceEditor').value===${JSON.stringify(visibleBefore)}`), 'exact diagnostic source navigation');
  const location = await evaluate(`(() => { const e=document.querySelector('#docSourceEditor');return {start:e.selectionStart,end:e.selectionEnd,selected:e.value.slice(e.selectionStart,e.selectionEnd)};})()`);
  const visibleRange = locateJsonSource(parseJsonSource(visibleBefore),pointer); assert.equal(location.start,visibleRange.start); assert.equal(location.end,visibleRange.end);
  assert.equal(location.selected,JSON.stringify(authorFixture.missingClip)); report.navigation={source:issue,location};
  await screenshot('preflight-source.png'); assert.deepEqual(await authorTree(root),initial);
  const fixed = visibleBefore.replace(JSON.stringify(authorFixture.missingClip),JSON.stringify(authorFixture.goodClip));
  await fill('#docSourceEditor',fixed); await enabled('#docSaveBtn'); await click('#docSaveBtn');
  await wait(() => evaluate(`!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges&&!(await import('/web/modules/app-state.js')).appState.isSaving`), 'ordinary source Save',90000);
  const repaired = await authorTree(root);
  assert.deepEqual(Object.keys(repaired).filter(name=>initial[name]!==repaired[name]),[authorFixture.behaviorPath]); assert.deepEqual(Object.keys(repaired),Object.keys(initial));
  const savedText=await fs.readFile(path.join(root,authorFixture.behaviorPath),'utf8');
  assert.equal(savedText,authorFixture.behaviorText.replace(JSON.stringify(authorFixture.missingClip),JSON.stringify(authorFixture.goodClip)));
  report.steps.push('Chinese, English and Japanese problem labels fit 390px. Clicking the problem selects exactly the missing clip JSON value despite BOM/CRLF and an earlier astral character. Ordinary editor Save changes only that behavior source and preserves its original encoding/newlines.');
  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildScene'); await fill('#projectBuildScene',assemblyId,'change');
  await perform('#projectBuildPlan','plan'); await perform('#projectBuildGenerate','build'); const ran=await perform('#projectBuildHeadless','run');
  const project=ran.runtime.project; assert.equal(project.protocolVersion,10); assert.equal(project.animationCommands.sequence,2);
  assert.deepEqual(project.animationCommands.entries.map(row=>row.command.action),['select','play']);
  assert.ok(project.animationCommands.entries.every(row=>row.state.clipId===authorFixture.clipIds[0][0]));
  await screenshot('preflight-recovered-run.png');
  report.runtime={jobId:ran.id,protocolVersion:project.protocolVersion,commands:project.animationCommands};
  report.authorSnapshot={before:initial,afterSave:repaired,after:await authorTree(root)}; assert.deepEqual(report.authorSnapshot.after,repaired);
  report.steps.push('After explicit repair, GUI Plan, Build and actual Godot headless Run succeed. Only the initial idle select/play executes; the noninitial state reference was nevertheless checked before build. Existing protocol 10 remains unchanged and subsequent tasks preserve all author bytes.');
  assert.deepEqual(report.errors,[]); assert.deepEqual(report.dialogs,[]);
  for (const [file,expected] of Object.entries(report.sources)) assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,'Source changed during smoke: '+file);
  report.sourceSnapshotUnchanged=true; report.ok=true;
} catch(error){
  report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;
  try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}
} finally{
  socket?.close();
  for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}
  report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));
}
