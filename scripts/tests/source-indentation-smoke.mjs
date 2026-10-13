// Actual Chrome source editing: native transactions and the ordinary document save path.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/source-editing');
const output = path.resolve(process.env.VIENTO_SOURCE_EDITING_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/source-editing.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const probeOnly = process.argv.includes('--probe-only');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome and local HTTP editor. No installed Tauri window, mobile WebView, Android, or other desktop OS claim.',
  'Only generic source indentation and ordinary source saving are exercised. No code execution, formatter, language server, or backend build is claimed.',
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-source-editing-browser-'));
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
  await evaluate(`(() => {document.body.innerHTML='<textarea id="probe"></textarea>';const e=document.querySelector('#probe');e.value='first\\nsecond';e.focus();e.setSelectionRange(e.value.length,e.value.length);window.__probeEvents=[];e.addEventListener('input',v=>__probeEvents.push({type:v.inputType,value:e.value}));})()`);
  await call('Input.insertText', { text: ' typed' });
  const probeBefore = await value('#probe');
  const probeApplied = await evaluate(`(()=>{const e=document.querySelector('#probe');e.setSelectionRange(0,e.value.length);return document.execCommand('insertText',false,'  first\\n  second typed');})()`);
  assert.equal(probeApplied, true); assert.equal(await value('#probe'), '  first\n  second typed');
  await key('z', 'KeyZ', 2, { windowsVirtualKeyCode: 90 }); assert.equal(await value('#probe'), probeBefore);
  await key('y', 'KeyY', 2, { windowsVirtualKeyCode: 89 }); assert.equal(await value('#probe'), '  first\n  second typed');
  report.nativeProbe = { commandAccepted: probeApplied, oneUndoPreservesPriorTyping: true, nativeRedo: true, inputEvents: await evaluate('window.__probeEvents') };
  report.steps.push('A real typed insertion followed by one execCommand insertText range replacement emits native input events, undoes separately from prior typing, and redoes with native Ctrl+Y.');
  if (!probeOnly) {
    const sources = ['engine/source-indentation.mjs', 'engine/source-draft.mjs', 'web/modules/app-source-indentation.js', 'web/modules/app-runtime.js',
      'web/source-indentation.css', 'web/editor-layout.css', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/source-indentation-smoke.mjs'];
    report.sources = Object.fromEntries(await Promise.all(sources.map(async name => [name, buildHash(await fs.readFile(path.join(appRoot, name)))])));
    const root = path.join(temporary, 'author');
    await fs.cp(path.join(appRoot, 'examples/scene-behaviors'), root, { recursive: true });
    const sourcePath = 'documents/scripts/checkpoint.txt', sourceFile = path.join(root, sourcePath);
    const original = '\uFEFFextends Node\r\n\r\nfunc _ready() -> void:\r\n\tprint("原文")\r\n\tprint("第二行")\r\n';
    await fs.writeFile(sourceFile, original);
    const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
      XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
    delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
    const rebuilt = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
    assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
    const initial = await authorTree(root), base = await serve(fixture, appRoot, env);
    captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,toolbar:document.querySelector('#sourceIndentToolbar')?.outerHTML})`); };
    await call('Page.navigate', { url: `${base}/web/?mode=edit` });
    await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor startup');
    await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.includes('scripts/checkpoint'))`), 'registered TXT in sidebar');
    await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('scripts/checkpoint')).click()`);
    await enabled('#docEditBtn'); await click('#docEditBtn'); await enabled('#sourceIndent');
    const editor = '#docSourceEditor', plain = original.replaceAll('\r\n', '\n');
    assert.equal(await value(editor), plain);
    assert.equal(await value('#sourceIndentUnit'), 'tab');
    await evaluate(`(()=>{window.__sourceSaves=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const response=await original(input,init);if(init?.method==='POST'&&new URL(typeof input==='string'?input:input.url,location.href).pathname==='/api/doc'){let body;try{body=JSON.parse(init.body)}catch{};window.__sourceSaves.push({body,status:response.status});}return response;};})()`);
    const selection = async (start, end = start, direction = 'forward') => evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');e.focus();e.setSelectionRange(${start},${end},${JSON.stringify(direction)});})()`);
    const snapshot = () => evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return {value:e.value,start:e.selectionStart,end:e.selectionEnd,direction:e.selectionDirection};})()`);
    const state = () => evaluate(`import('/web/modules/app-state.js').then(({appState:s})=>({dirty:s.editHasUnsavedChanges,saving:s.isSaving,rebuilding:s.isRebuilding,creating:s.isCreating}))`);
    await selection(plain.indexOf('原文') + '原文'.length); await call('Input.insertText', { text: ' typed' });
    const typed = plain.replace('原文', '原文 typed'); assert.equal(await value(editor), typed);
    const first = typed.indexOf('\tprint'), end = typed.length;
    await selection(first, end, 'backward');
    const beforeIndent = await snapshot(); await pointerClick('#sourceIndent');
    const indented = typed.replaceAll('\tprint', '\t\tprint'); assert.equal(await value(editor), indented);
    assert.equal((await snapshot()).direction, 'backward');
    assert.equal((await state()).dirty, true);
    await key('z', 'KeyZ', 2, { windowsVirtualKeyCode: 90 }); assert.equal(await value(editor), typed, 'native undo preserves the preceding typed edit');
    await key('y', 'KeyY', 2, { windowsVirtualKeyCode: 89 }); assert.equal(await value(editor), indented);
    report.steps.push('A saved BOM/CRLF TXT opens in the ordinary source editor. Automatic indentation uses its existing tabs. Real text input, backward multi-line toolbar indentation and native undo/redo preserve prior typing and set ordinary draft dirty state.');
    await screenshot('source-indentation-desktop.png');
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    if (await evaluate(`document.querySelector('#docSidebarToggleBtn').getAttribute('aria-expanded')==='true'`)) await click('#docSidebarToggleBtn');
    const beforeLanguage = await snapshot();
    for (const language of ['zh-CN', 'en', 'ja']) {
      await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
      assert.deepEqual(await snapshot(), beforeLanguage, 'language changes preserve source and selection');
      const layout = await evaluate(`(()=>{const bar=document.querySelector('#sourceIndentToolbar'),e=document.querySelector('#docSourceEditor');const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,unobscured:n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};};return {noHorizontalOverflow:document.documentElement.scrollWidth<=innerWidth,toolbar:rect(bar),editor:rect(e),indent:rect(document.querySelector('#sourceIndent')),outdent:rect(document.querySelector('#sourceOutdent')),unit:rect(document.querySelector('#sourceIndentUnit')),labels:bar.innerText};})()`);
      assert.equal(layout.noHorizontalOverflow, true); assert.ok(layout.editor.height >= 100);
      for (const name of ['indent', 'outdent', 'unit']) { assert.ok(layout[name].width > 0); assert.ok(layout[name].left >= 0 && layout[name].right <= 391); assert.equal(layout[name].unobscured, true); }
      report.layout[language] = layout; await screenshot(`source-indentation-${language}-390.png`);
    }
    await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
    await selection(beforeLanguage.start, beforeLanguage.end, beforeLanguage.direction);
    await key('z', 'KeyZ', 2, { windowsVirtualKeyCode: 90 }); assert.equal(await value(editor), typed);
    await key('y', 'KeyY', 2, { windowsVirtualKeyCode: 89 }); assert.equal(await value(editor), indented);
    report.steps.push('Chinese, English and Japanese controls fit a 390px viewport; language changes retain source, selection and the browser native undo/redo history.');
    await selection(indented.indexOf('\t\tprint'), indented.length, 'backward');
    await key('[', 'BracketLeft', 2, { windowsVirtualKeyCode: 219 }); assert.equal(await value(editor), typed);
    await key(']', 'BracketRight', 2, { windowsVirtualKeyCode: 221 }); assert.equal(await value(editor), indented);
    await click('#sourceOutdent'); assert.equal(await value(editor), typed);
    // A range ending at the next line start must not indent that next line.
    const secondStart = typed.indexOf('\tprint', first + 1);
    await selection(first, secondStart); await click('#sourceIndent');
    const oneLine = typed.slice(0, first) + '\t' + typed.slice(first); assert.equal(await value(editor), oneLine);
    await click('#sourceOutdent'); assert.equal(await value(editor), typed);
    for (const [unit, spaces] of [['spaces-2', '  '], ['spaces-4', '    ']]) {
      await fill('#sourceIndentUnit', unit, 'change'); await selection(0); await click('#sourceIndent');
      assert.equal(await value(editor), '\uFEFF' + spaces + typed.slice(1), 'indent stays after BOM');
      await click('#sourceOutdent'); assert.equal(await value(editor), typed);
    }
    report.steps.push('Real Ctrl+[ / Ctrl+] and toolbar outdent handle multi-line selection; selection ending at the next line start excludes that line. Explicit two/four-space indentation on the first line keeps BOM at byte zero.');
    await selection(first, typed.length);
    const imeBefore = await snapshot();
    await evaluate(`document.querySelector('#docSourceEditor').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'入力'}))`);
    await click('#sourceIndent'); assert.deepEqual(await snapshot(), imeBefore);
    const composingKey = await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor'),event=new KeyboardEvent('keydown',{key:']',ctrlKey:true,isComposing:true,bubbles:true,cancelable:true});e.dispatchEvent(event);return event.defaultPrevented;})()`);
    assert.equal(composingKey, false); assert.deepEqual(await snapshot(), imeBefore);
    await evaluate(`document.querySelector('#docSourceEditor').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'入力'}))`);
    const legacyKey = await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor'),event=new KeyboardEvent('keydown',{key:']',ctrlKey:true,keyCode:229,bubbles:true,cancelable:true});e.dispatchEvent(event);return event.defaultPrevented;})()`);
    assert.equal(legacyKey, false); assert.deepEqual(await snapshot(), imeBefore);
    await selection(first); await key('Tab', 'Tab', 0, { windowsVirtualKeyCode: 9 });
    assert.equal(await evaluate(`document.activeElement===document.querySelector('#docSourceEditor')`), false);
    assert.equal(await value(editor), typed);
    report.steps.push('During an explicit IME composition, toolbar clicks and composing keyboard events make no text edit; legacy keyCode 229 is also left untouched. A real Tab key navigates focus without inserting text.');
    assert.deepEqual(await authorTree(root), initial, 'text editing writes no author files before ordinary Save');
    assert.equal(await evaluate('window.__sourceSaves.length'), 0);
    await enabled('#docSaveBtn'); await click('#docSaveBtn');
    const saved = typed.replaceAll('\n', '\r\n');
    await wait(async () => await fs.readFile(sourceFile, 'utf8') === saved, 'ordinary source save');
    await wait(async () => { const s = await state(); return !s.dirty && !s.saving && !s.rebuilding; }, 'save and index refresh');
    const after = await authorTree(root), changed = Object.keys(after).filter(name => after[name] !== initial[name]);
    assert.deepEqual(Object.keys(after).sort(), Object.keys(initial).sort()); assert.deepEqual(changed, [sourcePath]);
    assert.equal(await value(editor), typed); assert.equal(await evaluate('window.__sourceSaves.length'), 1);
    assert.equal(await value('#sourceIndentUnit'), 'spaces-4', 'ordinary save retains the manually selected indentation unit');
    report.saved = { sourcePath, beforeHash: initial[sourcePath], afterHash: after[sourcePath], authorFilesChanged: changed,
      bytes: Buffer.byteLength(saved), preservedBom: saved.startsWith('\uFEFF'), onlyCrlf: !saved.replaceAll('\r\n', '').includes('\n'), state: await state(), response: await evaluate('window.__sourceSaves[0]') };
    await screenshot('source-indentation-saved.png');
    report.steps.push('All editing before Save leaves source, registry, templates and assets byte-identical. Ordinary Save makes exactly one document request, retains BOM/CRLF and changes only the selected TXT source; draft becomes clean after index refresh.');
    await enabled('#scriptCreateBtn'); await click('#scriptCreateBtn'); await enabled('#scriptCreateApply');
    await fill('#scriptCreateStarter', 'godot-signal', 'change');
    await fill('#scriptCreatePath', 'documents/scripts/indentation-draft.txt');
    await enabled('#scriptCreateApply'); await click('#scriptCreateApply');
    await wait(() => evaluate(`!document.querySelector('#scriptCreateDialog').open&&(await import('/web/modules/app-state.js')).appState.isCreating`), 'new script source handoff');
    await enabled('#sourceIndent'); assert.equal(await value('#sourceIndentUnit'), 'tab', 'a new tab-based starter replaces the previous manual indentation setting');
    assert.deepEqual(await authorTree(root), after, 'new source draft changes no author files');
    report.steps.push('The existing new-script assistant hands a tab-based starter into the same source editor. Its new session detects tabs rather than inheriting the previous document manual unit, without creating any author files.');
    report.beforeIndent = beforeIndent;
  }
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
