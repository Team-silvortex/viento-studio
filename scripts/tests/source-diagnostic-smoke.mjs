// Actual Chrome build diagnostic handoff: preserved context, exact wrapped source selection, and native editing history.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/source-diagnostics');
const output = path.resolve(process.env.VIENTO_SOURCE_DIAGNOSTIC_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/source-diagnostics.');
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-source-diagnostics-browser-'));
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
  const sources = ['engine/source-diagnostic.mjs', 'engine/source-position.mjs', 'engine/source-draft.mjs', 'web/modules/app-source-diagnostic.js', 'web/source-diagnostic.css', 'web/modules/app-source-reveal.js', 'web/modules/app-source-location.js', 'web/modules/app-source-position.js', 'web/modules/app-runtime.js', 'web/modules/app-project-build.js', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/source-diagnostic-smoke.mjs'];
  report.sources = Object.fromEntries(await Promise.all(sources.map(async name => [name, buildHash(await fs.readFile(path.join(appRoot, name)))])));
  const root = path.join(temporary, 'author');
  await fs.cp(path.join(appRoot, 'examples/scene2d'), root, { recursive: true });
  const sourcePath = 'documents/scenes/demo.json', sourceFile = path.join(root, sourcePath);
  const scene = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
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
  await click('#projectBuildBtn'); await enabled('#projectBuildPlan'); await click('#projectBuildPlan');
  let job;
  await wait(async () => { job = (await service()).job; return job?.kind === 'plan' && job.status !== 'running'; }, 'static build plan completes');
  assert.equal(job.status, 'failed', JSON.stringify(job));
  const diagnostic = job.diagnostics.find(item => item.code === 'build_actor_value' && item.propertyPath === '/actors/0/speed');
  assert.ok(diagnostic); assert.equal(diagnostic.sourcePath, sourcePath); assert.equal(diagnostic.sourceRange.exact, true);
  report.plan = { id: job.id, kind: job.kind, status: job.status, diagnostics: job.diagnostics };
  await click('#projectBuildClose'); await openDiagnostic();
  assert.equal(await value(editor), plain); assert.equal((await snapshot()).start, expectedStart); assert.equal((await snapshot()).end, expectedEnd);
  const exact = await panel(); assert.equal(exact.hidden, false); assert.equal(exact.status, 'exact');
  assert.match(exact.code, /build_actor_value/); assert.match(exact.location, /\/actors\/0\/speed/); assert.ok(exact.message.trim());
  assert.equal(exact.detailsOpen, false);
  const geometry = await selectionGeometry(); assert.equal(geometry.visible, true, JSON.stringify(geometry));
  assert.ok(geometry.top > geometry.logicalRow * geometry.lineHeight + 100, 'preceding CJK/emoji string actually soft-wraps');
  report.wrappedSelection = geometry; report.exact = exact; await screenshot('source-diagnostic-desktop.png');
  await evaluate(`(()=>{window.__diagnosticRequests=[];window.__sourceSaves=[];window.__sourceInputs=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.pathname.startsWith('/api/'))window.__diagnosticRequests.push({path:url.pathname,method:init?.method||'GET'});const response=await original(input,init);if(init?.method==='POST'&&url.pathname==='/api/doc'){let body;try{body=JSON.parse(init.body)}catch{};window.__sourceSaves.push({body,status:response.status});}return response;};document.querySelector('#docSourceEditor').addEventListener('input',event=>__sourceInputs.push(event.inputType||'input'));})()`);
  const beforeDetails = await snapshot(); await click('#sourceDiagnosticDetails summary');
  assert.equal((await panel()).detailsOpen, true); assert.deepEqual(await snapshot(), beforeDetails);
  assert.match(await evaluate(`document.querySelector('#sourceDiagnosticDetails').textContent`), /build_actor_value/);
  await screenshot('source-diagnostic-details.png'); await click('#sourceDiagnosticDetails summary');
  assert.equal((await state()).dirty, false); assert.deepEqual(await authorTree(root), initial);
  assert.equal(await evaluate('window.__sourceInputs.length'), 0); assert.equal(await evaluate('window.__sourceSaves.length'), 0);
  report.steps.push('A real static Scene2D build plan reports the actor speed diagnostic with exact provenance. Its source action opens the BOM/CRLF document, retains diagnostic code/message/path beside the editor, and selects the exact JSON string. Independent full-text DOM Range measurement confirms visibility after a long CJK/emoji soft-wrapped title. No engine is executed.');
  report.steps.push('The diagnostic panel and collapsible details only display information: no input event, dirty state, document save, or author file write. The oversized title is a separate intentional fixture diagnostic; the selected target is /actors/0/speed.');
  await evaluate(`document.querySelector('#docSourceEditor').focus()`);
  await call('Input.insertText', { text: '160' });
  const corrected = plain.slice(0, expectedStart) + '160' + plain.slice(expectedEnd);
  assert.equal(await value(editor), corrected); assert.equal((await state()).dirty, true); assert.equal((await panel()).status, 'changed');
  await key('z', 'KeyZ', 2, { windowsVirtualKeyCode: 90 }); assert.equal(await value(editor), plain);
  assert.equal((await panel()).status, 'changed'); assert.equal((await state()).dirty, false);
  report.steps.push('Typing a numeric speed marks the displayed diagnosis as needing a new check. Native Undo restores every source character but conservatively leaves the old diagnosis marked changed.');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  if (await evaluate(`document.querySelector('#docSidebarToggleBtn').getAttribute('aria-expanded')==='true'`)) await click('#docSidebarToggleBtn');
  const beforeLanguage = await snapshot();
  for (const language of ['zh-CN', 'en', 'ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.deepEqual(await snapshot(), beforeLanguage); assert.equal((await panel()).status, 'changed');
    await evaluate(`document.querySelector('#sourceDiagnosticPanel').scrollIntoView({block:'nearest'})`);
    const layout = await evaluate(`(()=>{const p=document.querySelector('#sourceDiagnosticPanel'),e=document.querySelector('#docSourceEditor'),b=document.querySelector('#sourceDiagnosticDismiss');const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,unobscured:n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};};return {noHorizontalOverflow:document.documentElement.scrollWidth<=innerWidth,panel:rect(p),editor:rect(e),dismiss:rect(b),panelOverflow:p.scrollWidth>p.clientWidth,labels:p.innerText};})()`);
    report.layout[language] = layout; await screenshot(`source-diagnostic-${language}-390.png`);
    assert.equal(layout.noHorizontalOverflow, true); assert.equal(layout.panelOverflow, false); assert.ok(layout.editor.height >= 100, JSON.stringify(layout));
    assert.ok(layout.panel.height >= 80, JSON.stringify(layout)); assert.ok(layout.dismiss.bottom <= layout.panel.bottom + 1, JSON.stringify(layout));
    assert.ok(layout.dismiss.left >= 0 && layout.dismiss.right <= 391); assert.equal(layout.dismiss.unobscured, true);
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await evaluate(`document.querySelector('#docSourceEditor').focus()`);
  await key('y', 'KeyY', 2, { windowsVirtualKeyCode: 89 }); assert.equal(await value(editor), corrected);
  await key('z', 'KeyZ', 2, { windowsVirtualKeyCode: 90 }); assert.equal(await value(editor), plain); assert.equal((await panel()).status, 'changed');
  report.steps.push('Chinese, English and Japanese diagnostic panels fit 390px with a scrollable source pane and a usable editor. Scrolling the panel into view exposes the entire dismiss control. Language changes preserve selection/content, and the original edit still redoes and undoes natively.');
  if (await evaluate(`document.querySelector('#docSidebarToggleBtn').getAttribute('aria-expanded')!=='true'`)) await click('#docSidebarToggleBtn');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(e=>e.dataset.path.includes('characters/traveler')).click()`);
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.activePath.includes('characters/traveler')&&document.querySelector('#sourceDiagnosticPanel').hidden`), 'switching source clears current diagnostic');
  await openDiagnostic(); assert.equal((await panel()).status, 'exact');
  const beforeDismiss = await snapshot(), beforeDismissState = await state(), inputsBeforeDismiss = await evaluate('window.__sourceInputs.length'), requestsBeforeDismiss = await evaluate('window.__diagnosticRequests.length');
  await click('#sourceDiagnosticDismiss'); assert.equal((await panel()).hidden, true);
  assert.deepEqual(await snapshot(), beforeDismiss); assert.deepEqual(await state(), beforeDismissState);
  assert.equal(await evaluate('window.__sourceInputs.length'), inputsBeforeDismiss); assert.equal(await evaluate('window.__diagnosticRequests.length'), requestsBeforeDismiss);
  assert.deepEqual(await authorTree(root), initial);
  report.steps.push('Switching to another document clears the displayed diagnostic. Reopening the current plan restores an exact current-source diagnosis. Dismiss changes only the panel, preserving source, selection, dirty state, requests and author files.');
  await openDiagnostic(); await evaluate(`document.querySelector('#docSourceEditor').focus()`); await call('Input.insertText', { text: '160' });
  assert.equal(await value(editor), corrected); assert.equal((await panel()).status, 'changed');
  await enabled('#docSaveBtn'); await click('#docSaveBtn'); const saved = corrected.replaceAll('\n', '\r\n');
  await wait(async () => await fs.readFile(sourceFile, 'utf8') === saved, 'ordinary source save');
  await wait(async () => { const s = await state(); return !s.dirty && !s.saving && !s.rebuilding; }, 'ordinary save and index refresh');
  const after = await authorTree(root), changed = Object.keys(after).filter(name => after[name] !== initial[name]);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(initial).sort()); assert.deepEqual(changed, [sourcePath]); assert.equal(await evaluate('window.__sourceSaves.length'), 1);
  const finalJob = (await service()).job; assert.equal(finalJob.id, job.id); assert.equal(finalJob.kind, 'plan');
  report.saved = { sourcePath, beforeHash: initial[sourcePath], afterHash: after[sourcePath], authorFilesChanged: changed, bytes: Buffer.byteLength(saved),
    preservedBom: saved.startsWith('\uFEFF'), onlyCrlf: !saved.replaceAll('\r\n', '').includes('\n'), response: await evaluate('window.__sourceSaves[0]'), state: await state() };
  report.steps.push('Only ordinary Save persists the numeric speed edit: exactly one source save, only the target scene changed, BOM and CRLF retained, and the editor returns clean. Registry/templates/assets remain identical. The build service still holds only its original static plan, with no generated or executed engine project.');
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
