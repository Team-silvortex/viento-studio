// Actual Chrome source navigation: logical positions, wrapped-row visibility and native editing history.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/source-navigation');
const output = path.resolve(process.env.VIENTO_SOURCE_NAVIGATION_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/source-navigation.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome and local HTTP editor. No installed Tauri window, mobile WebView, Android, or other desktop OS claim.',
  'Only logical source position/navigation and ordinary source saving are exercised. No code execution, language server, visual line gutter or backend build is claimed.',
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-source-navigation-browser-'));
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
  const sources = ['engine/source-position.mjs', 'engine/source-draft.mjs', 'web/modules/app-source-position.js', 'web/modules/app-runtime.js',
    'web/source-position.css', 'web/source-indentation.css', 'web/editor-layout.css', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/source-position-smoke.mjs'];
  report.sources = Object.fromEntries(await Promise.all(sources.map(async name => [name, buildHash(await fs.readFile(path.join(appRoot, name)))])));
  const root = path.join(temporary, 'author');
  await fs.cp(path.join(appRoot, 'examples/scene-behaviors'), root, { recursive: true });
  const sourcePath = 'documents/scripts/checkpoint.txt', sourceFile = path.join(root, sourcePath);
  const lines = ['\uFEFF# 导航示范 😀', 'extends Node', '# ' + '柔软换行\t場景🙂 '.repeat(350),
    ...Array.from({ length: 125 }, (_, i) => `# row ${i + 4} · 場景🙂\t目标`), 'func _ready() -> void:', '\tpass', ''];
  const plain = lines.join('\n'), original = lines.join('\r\n');
  await fs.writeFile(sourceFile, original);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
    XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  const rebuilt = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
  assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
  const initial = await authorTree(root), base = await serve(fixture, appRoot, env);
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,bar:document.querySelector('#sourcePositionBar')?.outerHTML,dialog:document.querySelector('#sourcePositionDialog')?.outerHTML,selections:window.__navigationSelections})`); };
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor startup');
  await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.includes('scripts/checkpoint'))`), 'registered TXT in sidebar');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scripts/checkpoint')).click()`);
  await enabled('#docEditBtn'); await click('#docEditBtn'); await enabled('#sourcePositionOpen');
  const editor = '#docSourceEditor'; assert.equal(await value(editor), plain);
  const selection = async (start, end = start, direction = 'forward') => {
    await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');e.focus();e.setSelectionRange(${start},${end},${JSON.stringify(direction)});})()`);
    await delay(40);
  };
  const snapshot = () => evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return {value:e.value,start:e.selectionStart,end:e.selectionEnd,direction:e.selectionDirection};})()`);
  const state = () => evaluate(`import('/web/modules/app-state.js').then(({appState:s})=>({dirty:s.editHasUnsavedChanges,saving:s.isSaving,rebuilding:s.isRebuilding,creating:s.isCreating}))`);
  const lineStart = number => lines.slice(0, number - 1).join('\n').length + (number > 1 ? 1 : 0);
  const positionText = () => evaluate(`document.querySelector('#sourcePositionText').textContent`);
  const expectPosition = async (line, column, total = lines.length) => {
    const expected = await evaluate(`(await import('/web/i18n/index.js')).t('第 {0} 行，第 {1} 列 · 共 {2} 行',${line},${column},${total})`);
    await wait(async () => await positionText() === expected, `position ${line}:${column}`);
  };
  const goTo = async number => {
    await enabled('#sourcePositionOpen'); await click('#sourcePositionOpen');
    await wait(() => evaluate(`document.querySelector('#sourcePositionDialog').open`), 'Go to line opens');
    await fill('#sourcePositionLine', String(number)); await enabled('#sourcePositionGo'); await click('#sourcePositionGo');
    await wait(() => evaluate(`!document.querySelector('#sourcePositionDialog').open`), 'Go to line closes');
    await delay(50);
  };
  // This independent DOM Range measurement uses the actual browser line boxes
  // for the complete text. It does not assume logicalLine * lineHeight.
  const caretGeometry = () => evaluate(`(()=>{
    const e=document.querySelector('#docSourceEditor'), c=getComputedStyle(e), mirror=document.createElement('div');
    for(const property of ['fontFamily','fontSize','fontWeight','fontStyle','fontVariant','lineHeight','letterSpacing','wordSpacing','textIndent','textTransform','textAlign','direction','tabSize','paddingTop','paddingRight','paddingBottom','paddingLeft','wordBreak','overflowWrap']) mirror.style[property]=c[property];
    Object.assign(mirror.style,{position:'fixed',left:'-20000px',top:'0',visibility:'hidden',whiteSpace:'pre-wrap',boxSizing:'border-box',width:e.clientWidth+'px',border:'0',height:'auto'});
    const before=document.createTextNode(e.value.slice(0,e.selectionStart)), after=document.createTextNode(e.value.slice(e.selectionStart)||' ');
    mirror.append(before,after);document.body.append(mirror);
    const range=document.createRange();range.setStart(after,0);range.setEnd(after,Math.min(1,after.length));
    const r=range.getBoundingClientRect(), mr=mirror.getBoundingClientRect(), lineHeight=parseFloat(c.lineHeight);
    const measured={top:r.top-mr.top,bottom:r.bottom-mr.top,scrollTop:e.scrollTop,clientHeight:e.clientHeight,lineHeight,logicalRow:e.value.slice(0,e.selectionStart).split('\\n').length,textareaWidth:e.clientWidth};
    measured.visible=measured.top>=e.scrollTop-2 && measured.bottom<=e.scrollTop+e.clientHeight+2;
    mirror.remove();return measured;
  })()`);
  await delay(150);
  await evaluate(`(()=>{window.__navigationRequests=[];window.__sourceSaves=[];window.__sourceInputs=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.pathname.startsWith('/api/'))window.__navigationRequests.push({path:url.pathname,method:init?.method||'GET'});const response=await original(input,init);if(init?.method==='POST'&&url.pathname==='/api/doc'){let body;try{body=JSON.parse(init.body)}catch{};window.__sourceSaves.push({body,status:response.status});}return response;};document.querySelector('#docSourceEditor').addEventListener('input',event=>__sourceInputs.push(event.inputType||'input'));})()`);
  await selection(1); await expectPosition(1, 1);
  const emojiEnd = plain.indexOf('😀') + 2; await selection(emojiEnd); await expectPosition(1, emojiEnd);
  const backStart = lineStart(9) + lines[8].indexOf('🙂') + 2, backEnd = lineStart(16) + 4;
  await selection(backStart, backEnd, 'backward'); await expectPosition(9, backStart - lineStart(9) + 1);
  const backward = await snapshot();
  await click('#sourcePositionOpen'); assert.equal(await value('#sourcePositionLine'), '9'); await click('#sourcePositionCancel');
  await wait(() => evaluate(`!document.querySelector('#sourcePositionDialog').open`), 'cancel closed'); assert.deepEqual(await snapshot(), backward);
  await selection(0); await key('g', 'KeyG', 2, { windowsVirtualKeyCode: 71 });
  await wait(() => evaluate(`document.querySelector('#sourcePositionDialog').open`), 'Ctrl+G opens');
  for (const invalid of ['0', '2.5', String(lines.length + 1), 'not-a-line']) {
    await fill('#sourcePositionLine', invalid); await click('#sourcePositionGo');
    assert.equal(await evaluate(`document.querySelector('#sourcePositionDialog').open`), true, invalid);
    assert.equal((await snapshot()).start, 0); assert.equal((await snapshot()).end, 0);
  }
  await click('#sourcePositionCancel'); await wait(() => evaluate(`!document.querySelector('#sourcePositionDialog').open`), 'invalid dialog cancel');
  await goTo(94); assert.equal((await snapshot()).start, lineStart(94)); assert.equal((await snapshot()).end, lineStart(94)); await expectPosition(94, 1);
  const geometry = await caretGeometry(); assert.equal(geometry.visible, true, JSON.stringify(geometry));
  assert.ok(geometry.top > geometry.logicalRow * geometry.lineHeight + 100, 'long preceding row actually wraps beyond logical line count');
  report.wrappedCaret = geometry;
  await screenshot('source-navigation-desktop.png');
  await goTo(lines.length); assert.equal((await snapshot()).start, plain.length); await expectPosition(lines.length, 1);
  await goTo(1); assert.equal((await snapshot()).start, 1, 'first visible column is after initial BOM'); await expectPosition(1, 1);
  assert.equal((await state()).dirty, false); assert.equal(await evaluate('window.__sourceInputs.length'), 0);
  assert.deepEqual(await evaluate('window.__navigationRequests'), []); assert.deepEqual(await authorTree(root), initial);
  report.steps.push('Clean BOM/CRLF text with CJK, emoji, tabs and a very long soft-wrapped row reports UTF-16 logical positions, including the active backward-selection end. Cancel preserves selection; invalid rows cannot navigate. Ctrl+G and far-row/EOF/first-row navigation are read-only and target the visible caret after BOM.');
  report.steps.push('An independent full-text DOM Range geometry measurement verifies the far logical row is visible after long soft wrapping; navigation emits no input event, API request, dirty state or author file write.');
  await goTo(22); const typedAt = (await snapshot()).start;
  await call('Input.insertText', { text: '# typed ' });
  const typed = plain.slice(0, typedAt) + '# typed ' + plain.slice(typedAt); assert.equal(await value(editor), typed);
  assert.equal((await state()).dirty, true);
  await goTo(108); await key('z', 'KeyZ', 2, { windowsVirtualKeyCode: 90 }); assert.equal(await value(editor), plain);
  await key('y', 'KeyY', 2, { windowsVirtualKeyCode: 89 }); assert.equal(await value(editor), typed);
  report.steps.push('Real typed input remains a native undoable operation after jumping to a distant line: Ctrl+Z removes only the typed edit and Ctrl+Y restores it.');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  if (await evaluate(`document.querySelector('#docSidebarToggleBtn').getAttribute('aria-expanded')==='true'`)) await click('#docSidebarToggleBtn');
  const beforeLanguage = await snapshot();
  for (const language of ['zh-CN', 'en', 'ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`); assert.deepEqual(await snapshot(), beforeLanguage);
    const layout = await evaluate(`(()=>{const bar=document.querySelector('#sourcePositionBar'),e=document.querySelector('#docSourceEditor');const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,unobscured:n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};};return {noHorizontalOverflow:document.documentElement.scrollWidth<=innerWidth,bar:rect(bar),editor:rect(e),open:rect(document.querySelector('#sourcePositionOpen')),labels:bar.innerText};})()`);
    assert.equal(layout.noHorizontalOverflow, true); assert.ok(layout.editor.height >= 100); assert.equal(layout.open.unobscured, true); assert.ok(layout.open.left >= 0 && layout.open.right <= 391);
    report.layout[language] = layout; await screenshot(`source-navigation-${language}-390.png`);
    await click('#sourcePositionOpen');
    const dialogLayout = await evaluate(`(()=>{const d=document.querySelector('#sourcePositionDialog'),r=d.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,noOverflow:d.scrollWidth<=d.clientWidth};})()`);
    assert.ok(dialogLayout.left >= 0 && dialogLayout.right <= 391); assert.equal(dialogLayout.noOverflow, true);
    await screenshot(`source-navigation-dialog-${language}-390.png`); await click('#sourcePositionCancel');
    await wait(() => evaluate(`!document.querySelector('#sourcePositionDialog').open`), 'localized dialog closes'); assert.deepEqual(await snapshot(), beforeLanguage);
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await selection(beforeLanguage.start, beforeLanguage.end, beforeLanguage.direction);
  await key('z', 'KeyZ', 2, { windowsVirtualKeyCode: 90 }); assert.equal(await value(editor), plain);
  await key('y', 'KeyY', 2, { windowsVirtualKeyCode: 89 }); assert.equal(await value(editor), typed);
  report.steps.push('Chinese, English and Japanese bar/dialog controls fit 390px. Switching language and opening/cancelling the dialog preserve source, selection and native undo/redo history.');
  await selection(typedAt); const imeBefore = await snapshot();
  await evaluate(`document.querySelector('#docSourceEditor').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'入力'}))`);
  const composing = await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor'),event=new KeyboardEvent('keydown',{key:'g',ctrlKey:true,bubbles:true,cancelable:true});e.dispatchEvent(event);return event.defaultPrevented;})()`);
  assert.equal(composing, false); await click('#sourcePositionOpen'); assert.equal(await evaluate(`document.querySelector('#sourcePositionDialog').open`), false); assert.deepEqual(await snapshot(), imeBefore);
  await evaluate(`document.querySelector('#docSourceEditor').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'入力'}))`);
  const legacy = await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor'),event=new KeyboardEvent('keydown',{key:'g',ctrlKey:true,keyCode:229,bubbles:true,cancelable:true});e.dispatchEvent(event);return event.defaultPrevented;})()`);
  assert.equal(legacy, false); assert.equal(await evaluate(`document.querySelector('#sourcePositionDialog').open`), false);
  await key('Tab', 'Tab', 0, { windowsVirtualKeyCode: 9 }); assert.equal(await evaluate(`document.activeElement===document.querySelector('#docSourceEditor')`), false); assert.equal(await value(editor), typed);
  report.steps.push('Composition state, including a key event lacking isComposing and legacy keyCode 229, leaves source navigation inactive. Normal Tab moves focus without inserting text.');
  assert.deepEqual(await authorTree(root), initial); assert.equal(await evaluate('window.__sourceSaves.length'), 0);
  await enabled('#docSaveBtn'); await click('#docSaveBtn'); const saved = typed.replaceAll('\n', '\r\n');
  await wait(async () => await fs.readFile(sourceFile, 'utf8') === saved, 'ordinary save');
  await wait(async () => { const s = await state(); return !s.dirty && !s.saving && !s.rebuilding; }, 'save and index refresh');
  const after = await authorTree(root), changed = Object.keys(after).filter(name => after[name] !== initial[name]);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(initial).sort()); assert.deepEqual(changed, [sourcePath]); assert.equal(await evaluate('window.__sourceSaves.length'), 1);
  report.saved = { sourcePath, beforeHash: initial[sourcePath], afterHash: after[sourcePath], authorFilesChanged: changed, bytes: Buffer.byteLength(saved),
    preservedBom: saved.startsWith('\uFEFF'), onlyCrlf: !saved.replaceAll('\r\n', '').includes('\n'), response: await evaluate('window.__sourceSaves[0]'), state: await state() };
  report.steps.push('Only ordinary Save writes the typed source: exactly one document request, only target TXT changed, BOM/CRLF preserved, clean state restored. Navigation never writes source, registry, templates or assets.');
  await evaluate(`(()=>{window.__navigationSelections=[];const e=document.querySelector('#docSourceEditor'),original=e.setSelectionRange;e.setSelectionRange=function(...args){__navigationSelections.push({args,stack:new Error().stack});return original.apply(this,args);};})()`);
  await enabled('#scriptCreateBtn'); await click('#scriptCreateBtn'); await enabled('#scriptCreateApply');
  await fill('#scriptCreateStarter', 'godot-signal', 'change'); await fill('#scriptCreatePath', 'documents/scripts/navigation-draft.txt');
  await enabled('#scriptCreateApply'); await click('#scriptCreateApply');
  await wait(() => evaluate(`!document.querySelector('#scriptCreateDialog').open&&(await import('/web/modules/app-state.js')).appState.isCreating`), 'new script handoff'); await enabled('#sourcePositionOpen');
  await goTo(3); assert.equal((await snapshot()).start, (await value(editor)).split('\n').slice(0, 2).join('\n').length + 1);
  await click('#settingsBtn'); await wait(() => evaluate(`document.querySelector('#settingsDialog').open`), 'settings open');
  await fill('#languageSelect', 'ja', 'change'); await enabled('#settingsDialog button'); await click('#settingsDialog button');
  await wait(() => evaluate(`!document.querySelector('#settingsDialog').open`), 'settings close'); await enabled('#sourcePositionOpen');
  assert.deepEqual(await authorTree(root), after); assert.equal(await evaluate('window.__sourceSaves.length'), 1);
  report.newDraftSelections = await evaluate('window.__navigationSelections');
  report.steps.push('New-script handoff and settings language changes restore source-navigation availability after modal close. Navigating the new script draft does not register or write it.');
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
