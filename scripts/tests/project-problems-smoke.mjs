// Actual Chrome current-task problems: local filtering, stable task ownership and verified source navigation.
// Authoring runs against a temporary copy. Evidence always uses a new directory.
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

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/project-problems');
const output = path.resolve(process.env.VIENTO_PROJECT_PROBLEMS_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/project-problems.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome and local HTTP editor. No installed Tauri window, mobile WebView, Android, or other desktop OS claim.',
  'Build planning and its static source diagnostics are exercised. No backend generation, engine execution, language server, packaged Tauri, mobile WebView or Android claim.',
  'The existing source serializer retains BOM and source newline style; it does not guarantee every mixed ending inside an edited middle region remains byte-identical.'
] };
const cleanups = [], fixture = { after: callback => cleanups.push(callback) };
const wait = async (check, label, budget = 30000) => { for (let elapsed = 0; elapsed < budget; elapsed += 100) { if (await check()) return; await delay(100); } throw Error('Timed out: ' + label); };
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-project-problems-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const profile = path.join(temporary, 'chrome'); await fs.mkdir(profile);
  const chrome = spawn(process.env.VIENTO_CHROME_BIN || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
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
    else if (value.method === 'Page.javascriptDialogOpening') { report.dialogs.push({ type: value.params.type, message: value.params.message }); void call('Page.handleJavaScriptDialog', { accept: false }); }
  });
  const evaluate = async expression => {
    const value = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true, userGesture: true });
    if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value;
  };
  const key = async (name, code, modifiers = 0, extra = {}) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, modifiers, ...extra });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, modifiers, ...extra });
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const pointerClick = async selector => {
    const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  };
  const fill = (selector, value, event = 'input') => evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event(${JSON.stringify(event)}, {bubbles:true})); })()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === false && !document.querySelector(${JSON.stringify(selector)}).hidden`), selector + ' enabled');
  const screenshot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(image.data, 'base64')); report.screenshots.push(name); };
  const value = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  report.node = { version: process.version, sha256: buildHash(await fs.readFile(process.execPath)) };
  const sources = ['engine/source-diagnostic.mjs', 'engine/source-position.mjs', 'engine/source-draft.mjs', 'web/modules/app-source-diagnostic.js', 'web/source-diagnostic.css', 'web/modules/app-source-reveal.js', 'web/modules/app-source-location.js', 'web/modules/app-source-position.js', 'web/modules/app-runtime.js', 'web/modules/app-project-build.js', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/project-problems-smoke.mjs', 'engine/project-problems.mjs', 'web/modules/app-project-problems.js', 'web/project-problems.css', 'engine/source-search.mjs', 'web/modules/app-source-search.js', 'web/source-search.css'];
  report.sources = Object.fromEntries(await Promise.all(sources.map(async name => [name, buildHash(await fs.readFile(path.join(appRoot, name)))])));
  const root = path.join(temporary, 'author');
  await fs.cp(path.join(appRoot, 'examples/scene2d'), root, { recursive: true });
  const sourcePath = 'documents/scenes/demo.json', sourceFile = path.join(root, sourcePath);
  const scene = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  const otherSceneId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const otherScene = { ...scene, title: 'Independent second scene' };
  await fs.writeFile(path.join(root, 'documents/scenes/other.json'), JSON.stringify(otherScene, null, 2) + '\n');
  const otherRecord = JSON.parse(await fs.readFile(path.join(root, 'metadata/documents/dddddddd-dddd-4ddd-8ddd-dddddddddddd.json'), 'utf8'));
  await fs.writeFile(path.join(root, `metadata/documents/${otherSceneId}.json`), JSON.stringify({ ...otherRecord, id: otherSceneId, sourcePath: 'documents/scenes/other.json' }, null, 2) + '\n');
  const unsafeKey = '<img src=x onerror="globalThis.__problemsInjected=true">';
  scene[unsafeKey] = true;
  scene.title = '换行場景😀 '.repeat(650);
  scene.actors[0].speed = 'invalid speed';
  const plain = '\uFEFF' + JSON.stringify(scene, null, 2) + '\n';
  const original = plain.replaceAll('\n', '\r\n');
  const expectedStart = plain.indexOf('"invalid speed"'), expectedEnd = expectedStart + '"invalid speed"'.length;
  await fs.writeFile(sourceFile, original);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
    XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH; delete env.VIENTO_GODOT_BIN;
  const rebuilt = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
  assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
  const initial = await authorTree(root), base = await serve(fixture, appRoot, env);
  const service = async () => { const response = await fetch(`${base}/api/project-build`); assert.equal(response.status, 200); const body = await response.json(); return body.data || body; };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,panel:document.querySelector('#sourceDiagnosticPanel')?.outerHTML,dialog:document.querySelector('#projectBuildDialog')?.outerHTML})`); report.serviceFailure = await service(); };
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable&&document.querySelector('#projectBuildBtn')?.hidden===false`), 'build-capable editor startup');
  const editor = '#docSourceEditor';
  const snapshot = () => evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return {value:e.value,start:e.selectionStart,end:e.selectionEnd,direction:e.selectionDirection};})()`);
  const state = () => evaluate(`import('/web/modules/app-state.js').then(({appState:s})=>({dirty:s.editHasUnsavedChanges,saving:s.isSaving,rebuilding:s.isRebuilding,creating:s.isCreating,path:s.activePath}))`);
  const panel = () => evaluate(`(()=>{const e=document.querySelector('#sourceDiagnosticPanel');return {hidden:e.hidden,status:e.dataset.status,title:document.querySelector('#sourceDiagnosticTitle').textContent,message:document.querySelector('#sourceDiagnosticMessage').textContent,code:document.querySelector('#sourceDiagnosticCode').textContent,location:document.querySelector('#sourceDiagnosticLocation').textContent,state:document.querySelector('#sourceDiagnosticState').textContent,detailsOpen:document.querySelector('#sourceDiagnosticDetails').open};})()`);
  const openDiagnostic = async () => {
    await enabled('#projectBuildBtn'); await click('#projectBuildBtn');
    await wait(() => evaluate(`Array.from(document.querySelectorAll('#projectBuildDiagnostics button')).some(e=>e.textContent.includes('/actors/0/speed'))`), 'actor speed diagnostic');
    await evaluate(`Array.from(document.querySelectorAll('#projectBuildDiagnostics button')).find(e=>e.textContent.includes('/actors/0/speed')).click()`);
    await wait(() => evaluate(`!document.querySelector('#projectBuildDialog').open&&(await import('/web/modules/app-state.js')).appState.isEditing&&!document.querySelector('#sourceDiagnosticPanel').hidden`), 'diagnostic opens source and panel');
    await delay(120);
  };
  // Independent full-text DOM Range: the exact selected field must be visible
  // after a very long wrapped JSON string, not logicalRow * lineHeight.
  const selectionGeometry = () => evaluate(`(()=>{
    const e=document.querySelector('#docSourceEditor'), c=getComputedStyle(e), mirror=document.createElement('div');
    for(const property of ['fontFamily','fontSize','fontWeight','fontStyle','fontVariant','lineHeight','letterSpacing','wordSpacing','textIndent','textTransform','textAlign','direction','tabSize','paddingTop','paddingRight','paddingBottom','paddingLeft','wordBreak','overflowWrap']) mirror.style[property]=c[property];
    Object.assign(mirror.style,{position:'fixed',left:'-20000px',top:'0',visibility:'hidden',whiteSpace:'pre-wrap',boxSizing:'border-box',width:e.clientWidth+'px',border:'0',height:'auto'});
    const before=document.createTextNode(e.value.slice(0,e.selectionStart)), selected=document.createTextNode(e.value.slice(e.selectionStart,e.selectionEnd)), after=document.createTextNode(e.value.slice(e.selectionEnd));
    mirror.append(before,selected,after);document.body.append(mirror);
    const range=document.createRange();range.setStart(selected,0);range.setEnd(selected,selected.length);
    const r=range.getBoundingClientRect(), mr=mirror.getBoundingClientRect(), lineHeight=parseFloat(c.lineHeight);
    const measured={top:r.top-mr.top,bottom:r.bottom-mr.top,scrollTop:e.scrollTop,clientHeight:e.clientHeight,lineHeight,logicalRow:e.value.slice(0,e.selectionStart).split(String.fromCharCode(10)).length,textareaWidth:e.clientWidth,selected:selected.textContent};
    measured.visible=measured.top>=e.scrollTop-2 && measured.bottom<=e.scrollTop+e.clientHeight+2;
    mirror.remove();return measured;
  })()`);
  await evaluate(`(()=>{window.__problemRequests=[];window.__problemResponses=[];window.__sourceSaves=[];window.__sourceInputs=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);const entry={path:url.pathname,search:url.search,method:init?.method||'GET'};if(url.pathname.startsWith('/api/'))__problemRequests.push(entry);const response=await original(input,init);if(url.pathname.startsWith('/api/'))__problemResponses.push({...entry,status:response.status});if(init?.method==='POST'&&url.pathname==='/api/doc')__sourceSaves.push({status:response.status});return response;};document.querySelector('#docSourceEditor').addEventListener('input',event=>__sourceInputs.push(event.inputType||'input'));})()`);
  const problems = () => evaluate(`(()=>{const list=document.querySelector('#projectBuildDiagnostics');const rows=[...list.querySelectorAll('li.build-diagnostic')];return {summary:document.querySelector('#projectBuildProblemsSummary').textContent,task:document.querySelector('#projectBuildProblemsTask').textContent,empty:document.querySelector('#projectBuildProblemsEmpty').textContent,emptyHidden:document.querySelector('#projectBuildProblemsEmpty').hidden,query:document.querySelector('#projectBuildProblemsSearch').value,severity:document.querySelector('#projectBuildProblemsSeverity').value,visible:rows.filter(row=>!row.hidden).map(row=>({index:row.dataset.index,code:row.dataset.code,severity:row.dataset.severity,text:row.textContent})),totalRows:rows.length};})()`);
  const visibleCodes = async () => (await problems()).visible.map(row => row.code);
  const setSeverity = value => fill('#projectBuildProblemsSeverity', value, 'change');
  const searchProblems = text => fill('#projectBuildProblemsSearch', text);
  const selectDiagnostic = () => evaluate(`document.querySelector('#projectBuildDiagnostics li[data-code="build_actor_value"] button').click()`);
  await click('#projectBuildBtn'); await enabled('#projectBuildPlan');
  const emptyTask = await problems(); assert.equal(emptyTask.totalRows, 0); assert.equal(emptyTask.emptyHidden, false); assert.ok(emptyTask.empty.trim());
  report.initialEmpty = emptyTask;
  await fill('#projectBuildScene', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'change');
  await click('#projectBuildPlan');
  let job;
  await wait(async () => { job = (await service()).job; return job?.kind === 'plan' && job.status !== 'running'; }, 'static build plan completes');
  assert.equal(job.status, 'failed', JSON.stringify(job));
  const diagnostic = job.diagnostics.find(item => item.code === 'build_actor_value' && item.propertyPath === '/actors/0/speed');
  assert.ok(diagnostic); assert.equal(diagnostic.sourcePath, sourcePath); assert.equal(diagnostic.sourceRange.exact, true);
  assert.ok(job.diagnostics.some(item => item.message.includes(unsafeKey)), 'an authored HTML-like field reaches a real diagnostic');
  await wait(async () => (await problems()).totalRows === job.diagnostics.length, 'current-task problem rows arrive');
  const all = await problems(), errors = job.diagnostics.filter(item => (item.severity || 'error') === 'error').length;
  assert.equal(all.visible.length, job.diagnostics.length); assert.equal(all.emptyHidden, true);
  assert.deepEqual(all.summary.match(/\d+/g).map(Number), [all.visible.length, job.diagnostics.length, errors, 0, 0]);
  assert.equal(all.severity, 'all'); assert.ok(all.task.trim());
  report.plan = { id: job.id, kind: job.kind, status: job.status, sceneId: job.sceneId, diagnostics: job.diagnostics };
  report.allProblems = all;
  const beforeFilters = await authorTree(root), postBeforeFilters = await evaluate(`__problemRequests.filter(item=>item.method!=='GET').length`);
  await setSeverity('error'); assert.equal((await problems()).visible.length, errors);
  for (const severity of ['warning', 'info']) {
    await setSeverity(severity); assert.deepEqual(await visibleCodes(), []); assert.equal((await problems()).emptyHidden, false);
  }
  await setSeverity('all');
  for (const text of ['build_actor_value', '/actors/0/speed']) {
    await searchProblems(text); assert.deepEqual(await visibleCodes(), ['build_actor_value']);
  }
  await searchProblems(sourcePath); assert.equal((await problems()).visible.length, job.diagnostics.length);
  await searchProblems('Speed must be from 0 to 2000.'); assert.deepEqual(await visibleCodes(), ['build_actor_value']);
  await searchProblems('no such diagnostic 573818'); assert.deepEqual(await visibleCodes(), []); assert.equal((await problems()).emptyHidden, false);
  report.filteredEmpty = await problems();
  assert.notEqual(report.filteredEmpty.empty, emptyTask.empty);
  await searchProblems('<img src=x'); assert.deepEqual(await visibleCodes(), ['build_feature_unsupported']);
  await click('#projectBuildDiagnostics li[data-code="build_feature_unsupported"] summary');
  const rawDetail = await evaluate(`(()=>{const row=document.querySelector('#projectBuildDiagnostics li[data-code="build_feature_unsupported"]');return {open:row.querySelector('details').open,raw:row.querySelector('pre').textContent,htmlNodes:row.querySelectorAll('img,script,svg').length,injected:globalThis.__problemsInjected===true};})()`);
  assert.equal(rawDetail.open, true); assert.ok(rawDetail.raw.includes('<img src=x'));
  assert.equal(rawDetail.htmlNodes, 0); assert.equal(rawDetail.injected, false); report.rawDetail = rawDetail;
  await evaluate(`document.querySelector('#projectBuildDiagnostics li[data-code="build_feature_unsupported"]').scrollIntoView({block:'center'})`);
  await screenshot('problems-safe-raw-details.png');
  await searchProblems('/actors/0/speed'); await click('#projectBuildDiagnostics li[data-code="build_actor_value"] summary');
  await evaluate(`(()=>{const input=document.querySelector('#projectBuildProblemsSearch');input.focus();input.setSelectionRange(2,6,'backward');window.__preservedProblemRow=document.querySelector('#projectBuildDiagnostics li[data-code="build_actor_value"]');})()`);
  const pollState = () => evaluate(`(()=>{const input=document.querySelector('#projectBuildProblemsSearch'),row=document.querySelector('#projectBuildDiagnostics li[data-code="build_actor_value"]');return {focus:document.activeElement===input,query:input.value,start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection,rowSame:row===window.__preservedProblemRow,detailsOpen:row.querySelector('details').open,task:document.querySelector('#projectBuildProblemsTask').textContent};})()`);
  const beforePoll = await pollState();
  for (let i = 0; i < 2; i++) {
    await enabled('#projectBuildRefresh');
    const responses = await evaluate(`__problemResponses.filter(item=>item.path==='/api/project-build').length`);
    await click('#projectBuildRefresh');
    await wait(() => evaluate(`__problemResponses.filter(item=>item.path==='/api/project-build').length>${responses}&&!document.querySelector('#projectBuildRefresh').disabled`), 'same-task status refresh');
    assert.deepEqual(await pollState(), beforePoll);
  }
  report.sameTaskRefresh = await pollState();
  assert.equal((await service()).job.id, job.id);
  const originalTask = (await problems()).task;
  await fill('#projectBuildScene', otherSceneId, 'change');
  assert.equal(await value('#projectBuildScene'), otherSceneId); assert.equal((await problems()).task, originalTask);
  assert.deepEqual(await visibleCodes(), ['build_actor_value']);
  report.selectedOtherScene = { picker: otherSceneId, task: (await problems()).task, originatingSceneId: job.sceneId };
  await searchProblems('');
  await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('en')`);
  const englishMessage = await evaluate(`document.querySelector('#projectBuildDiagnostics li[data-code="build_actor_value"] p.project-problem-message').textContent`);
  await searchProblems(englishMessage); assert.deepEqual(await visibleCodes(), ['build_actor_value']);
  const queryAfterLocale = await value('#projectBuildProblemsSearch');
  await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('ja')`);
  assert.equal(await value('#projectBuildProblemsSearch'), queryAfterLocale);
  const japaneseMessage = await evaluate(`document.querySelector('#projectBuildDiagnostics li[data-code="build_actor_value"] p.project-problem-message').textContent`);
  assert.notEqual(englishMessage, japaneseMessage); await searchProblems(japaneseMessage); assert.deepEqual(await visibleCodes(), ['build_actor_value']);
  report.localizedSearch = { englishMessage, japaneseMessage };
  await searchProblems(''); await setSeverity('all');
  assert.deepEqual(await authorTree(root), beforeFilters);
  assert.equal(await evaluate(`__problemRequests.filter(item=>item.method!=='GET').length`), postBeforeFilters);
  assert.equal(await evaluate('__sourceInputs.length'), 0); assert.equal(await evaluate('__sourceSaves.length'), 0);
  report.steps.push('A real static Scene2D plan produces current-task problems. Severity counts match the complete task; code, source path, property path, raw detail and translated message filters are literal and local. Empty-task and empty-filter states differ. HTML-like authored details stay plain text. No filter/disclosure/language action posts, rebuilds, saves or changes author files.');
  report.steps.push('Two same-task status refreshes preserve the focused search input, backward caret selection, row identity and open details. Selecting a second registered scene leaves the displayed task bound to the original failed job.');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  for (const language of ['zh-CN', 'en', 'ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await evaluate(`document.querySelector('#projectBuildProblemsSearch').scrollIntoView({block:'center'})`);
    const layout = await evaluate(`(()=>{const dialog=document.querySelector('#projectBuildDialog'),input=document.querySelector('#projectBuildProblemsSearch'),select=document.querySelector('#projectBuildProblemsSeverity'),summary=document.querySelector('#projectBuildProblemsSummary');const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,unobscured:e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};};return {pageOverflow:document.documentElement.scrollWidth>innerWidth,dialogOverflow:dialog.scrollWidth>dialog.clientWidth+1,query:rect(input),severity:rect(select),summary:summary.textContent,task:document.querySelector('#projectBuildProblemsTask').textContent,rows:[...document.querySelectorAll('#projectBuildDiagnostics li')].filter(e=>!e.hidden).map(rect)};})()`);
    report.layout[language] = layout; await screenshot(`project-problems-${language}-390.png`);
    assert.equal(layout.pageOverflow, false); assert.equal(layout.dialogOverflow, false);
    for (const control of [layout.query, layout.severity]) { assert.ok(control.width >= 100, JSON.stringify(layout)); assert.ok(control.left >= 0 && control.right <= 391, JSON.stringify(layout)); assert.equal(control.unobscured, true); }
    for (const row of layout.rows) assert.ok(row.left >= 0 && row.right <= 391, JSON.stringify(layout));
    assert.equal((await problems()).visible.length, job.diagnostics.length); assert.equal(await value('#projectBuildScene'), otherSceneId);
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await searchProblems('/actors/0/speed'); await selectDiagnostic();
  await wait(() => evaluate(`!document.querySelector('#projectBuildDialog').open&&!document.querySelector('#sourceDiagnosticPanel').hidden`), 'filtered problem navigates to original source');
  await delay(150);
  assert.equal(await value(editor), plain); assert.equal((await snapshot()).start, expectedStart); assert.equal((await snapshot()).end, expectedEnd);
  assert.equal((await panel()).status, 'exact'); assert.match((await panel()).location, /\/actors\/0\/speed/);
  const geometry = await selectionGeometry(); assert.equal(geometry.visible, true, JSON.stringify(geometry));
  assert.ok(geometry.top > geometry.logicalRow * geometry.lineHeight + 100); report.wrappedSelection = geometry;
  await screenshot('project-problems-source-navigation.png');
  assert.equal((await state()).dirty, false); assert.deepEqual(await authorTree(root), initial);
  await evaluate(`document.querySelector('#docSourceEditor').focus()`); await call('Input.insertText', { text: '160' });
  const corrected = plain.slice(0, expectedStart) + '160' + plain.slice(expectedEnd);
  assert.equal(await value(editor), corrected); assert.equal((await state()).dirty, true); assert.equal((await panel()).status, 'changed');
  await key('z', 'KeyZ', 2, { windowsVirtualKeyCode: 90 }); assert.equal(await value(editor), plain); assert.equal((await state()).dirty, false);
  assert.equal((await panel()).status, 'changed');
  await key('f', 'KeyF', 2, { windowsVirtualKeyCode: 70 });
  await wait(() => evaluate(`document.querySelector('#sourceSearchPanel')?.hidden===false`), 'existing source search opens');
  await fill('#sourceSearchQuery', 'invalid speed');
  const inputsBeforeSearch = await evaluate('__sourceInputs.length');
  await click('#sourceSearchNext'); assert.equal((await snapshot()).start, expectedStart + 1); assert.equal((await snapshot()).end, expectedEnd - 1);
  assert.equal(await evaluate('__sourceInputs.length'), inputsBeforeSearch); assert.equal((await panel()).status, 'changed');
  await click('#sourceSearchClose');
  await evaluate(`document.querySelector('#docSourceEditor').focus()`); await key('y', 'KeyY', 2, { windowsVirtualKeyCode: 89 });
  assert.equal(await value(editor), corrected); await key('z', 'KeyZ', 2, { windowsVirtualKeyCode: 90 }); assert.equal(await value(editor), plain);
  assert.deepEqual(await authorTree(root), initial); assert.equal(await fs.readFile(sourceFile, 'utf8'), original);
  assert.equal(await evaluate('__sourceSaves.length'), 0); assert.equal((await state()).dirty, false);
  const finalJob = (await service()).job; assert.equal(finalJob.id, job.id); assert.equal(finalJob.kind, 'plan');
  report.final = { jobId: finalJob.id, sceneSourcePath: sourcePath, sourceHash: buildHash(await fs.readFile(sourceFile)), authorFilesChanged: [], sourceSaves: 0,
    preservedBom: original.startsWith('\uFEFF'), onlyCrlf: !original.replaceAll('\r\n', '').includes('\n'), state: await state(), requests: await evaluate('__problemRequests') };
  report.steps.push('Chinese, English and Japanese problems controls remain visible and within a 390px dialog. The original task remains selected independently of the scene picker.');
  report.steps.push('A filtered source action opens the original BOM/CRLF scene and exact actor-speed range, visible after a long soft-wrapped CJK/emoji title. Native editing marks diagnostic context changed; Undo restores all source bytes without pretending the task reran. Existing source search still selects literal matches and preserves Undo/Redo. No author files are saved; only the original static plan exists.');
  assert.deepEqual(report.errors, []); report.completedAt = new Date().toISOString(); report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.stack || String(error);
  if (captureFailure) try { await captureFailure(); } catch (failure) { report.captureFailure = String(failure); }
  process.exitCode = 1;
} finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, output, failure: report.failure || null }));
}
