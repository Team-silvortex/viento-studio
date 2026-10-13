// Actual Chrome source search: literal navigation, native replacement undo, and ordinary source persistence.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/source-search');
const output = path.resolve(process.env.VIENTO_SOURCE_SEARCH_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/source-search.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome and local HTTP editor. No installed Tauri window, mobile WebView, Android, or other desktop OS claim.',
  'Literal source search/replacement and a static diagnostic handoff are exercised. No backend generation, engine execution, regular expressions, cross-file search or language server is claimed.',
  'The existing source serializer retains BOM and source newline style; it does not guarantee every mixed ending inside an edited middle region remains byte-identical.'
] };
report.mediaUploads = [];
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-source-search-browser-'));
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
    else if (value.method === 'Network.requestWillBeSent' && value.params.request.method === 'POST' && new URL(value.params.request.url).pathname === '/api/assets') report.mediaUploads.push({ method: value.params.request.method, url: value.params.request.url });
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
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable'); report.browser = (await call('Browser.getVersion')).product;
  report.node = { version: process.version, sha256: buildHash(await fs.readFile(process.execPath)) };
  const sources = ['engine/source-search.mjs', 'engine/source-diagnostic.mjs', 'engine/source-position.mjs', 'engine/source-draft.mjs', 'web/modules/app-source-search.js', 'web/source-search.css', 'web/modules/app-source-diagnostic.js', 'web/source-diagnostic.css', 'web/modules/app-source-reveal.js', 'web/modules/app-source-position.js', 'web/modules/app-runtime.js', 'web/modules/app-project-build.js', 'web/modules/app-media-editor.js', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/source-search-smoke.mjs'];
  report.sources = Object.fromEntries(await Promise.all(sources.map(async name => [name, buildHash(await fs.readFile(path.join(appRoot, name)))])));
  const root = path.join(temporary, 'author');
  await fs.cp(path.join(appRoot, 'examples/scene2d'), root, { recursive: true });
  const sourcePath = 'documents/scenes/demo.json', sourceFile = path.join(root, sourcePath);
  const scene = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  scene.title = 'Needle needle NEEDLE · LIT LIT LIT · ' + '换行場景😀 '.repeat(650);
  scene.actors[0].speed = 'invalid speed';
  const plain = '\uFEFF' + JSON.stringify(scene, null, 2) + '\n';
  const original = plain.replaceAll('\n', '\r\n');
  const invalidLiteral = '"invalid speed"', invalidStart = plain.indexOf(invalidLiteral), invalidEnd = invalidStart + invalidLiteral.length;
  await fs.writeFile(sourceFile, original);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
    XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH; delete env.VIENTO_GODOT_BIN;
  const rebuilt = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
  assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
  const initial = await authorTree(root), base = await serve(fixture, appRoot, env);
  const service = async () => { const response = await fetch(`${base}/api/project-build`); assert.equal(response.status, 200); const body = await response.json(); return body.data || body; };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,search:document.querySelector('#sourceSearchPanel')?.outerHTML,diagnostic:document.querySelector('#sourceDiagnosticPanel')?.outerHTML})`); report.serviceFailure = await service(); };
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable&&document.querySelector('#projectBuildBtn')?.hidden===false`), 'build-capable editor startup');
  const editor = '#docSourceEditor';
  const snapshot = () => evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');return {value:e.value,start:e.selectionStart,end:e.selectionEnd,direction:e.selectionDirection};})()`);
  const state = () => evaluate(`import('/web/modules/app-state.js').then(({appState:s})=>({dirty:s.editHasUnsavedChanges,saving:s.isSaving,rebuilding:s.isRebuilding,creating:s.isCreating,path:s.activePath}))`);
  const searchState = () => evaluate(`(()=>{const e=document.querySelector('#sourceSearchStatus');return {count:Number(e.dataset.count),current:Number(e.dataset.current),text:e.textContent,hidden:document.querySelector('#sourceSearchPanel').hidden,query:document.querySelector('#sourceSearchQuery').value,replacement:document.querySelector('#sourceSearchReplacement').value,matchCase:document.querySelector('#sourceSearchMatchCase').checked};})()`);
  const selection = async (start, end = start, direction = 'forward') => {
    await evaluate(`(()=>{const e=document.querySelector('#docSourceEditor');e.focus();e.setSelectionRange(${start},${end},${JSON.stringify(direction)});})()`); await delay(40);
  };
  const query = async (text, count) => { await fill('#sourceSearchQuery', text); if (count !== undefined) await wait(async () => (await searchState()).count === count, `literal match count ${count} for ${text}`); };
  const expectSelection = async (start, end) => { await wait(async () => { const selected = await snapshot(); return selected.start === start && selected.end === end; }, `selection ${start}:${end}`); };
  const open = async modifier => {
    await evaluate(`document.querySelector('#docSourceEditor').focus()`);
    await key('f', 'KeyF', modifier, { windowsVirtualKeyCode: 70 });
    await wait(() => evaluate(`document.querySelector('#sourceSearchPanel')?.hidden===false`), 'source find keyboard entry');
  };
  const undo = async () => { await evaluate(`document.querySelector('#docSourceEditor').focus()`); await key('z', 'KeyZ', 2, { windowsVirtualKeyCode: 90 }); };
  const redo = async () => { await evaluate(`document.querySelector('#docSourceEditor').focus()`); await key('y', 'KeyY', 2, { windowsVirtualKeyCode: 89 }); };
  const selectionGeometry = () => evaluate(`(()=>{
    const e=document.querySelector('#docSourceEditor'), c=getComputedStyle(e), mirror=document.createElement('div');
    for(const property of ['fontFamily','fontSize','fontWeight','fontStyle','fontVariant','lineHeight','letterSpacing','wordSpacing','textIndent','textTransform','textAlign','direction','tabSize','paddingTop','paddingRight','paddingBottom','paddingLeft','wordBreak','overflowWrap']) mirror.style[property]=c[property];
    Object.assign(mirror.style,{position:'fixed',left:'-20000px',top:'0',visibility:'hidden',whiteSpace:'pre-wrap',boxSizing:'border-box',width:e.clientWidth+'px',border:'0',height:'auto'});
    const before=document.createTextNode(e.value.slice(0,e.selectionStart)), selected=document.createTextNode(e.value.slice(e.selectionStart,e.selectionEnd)), after=document.createTextNode(e.value.slice(e.selectionEnd));
    mirror.append(before,selected,after);document.body.append(mirror);const range=document.createRange();range.setStart(selected,0);range.setEnd(selected,selected.length);
    const r=range.getBoundingClientRect(), mr=mirror.getBoundingClientRect(), lineHeight=parseFloat(c.lineHeight);
    const measured={top:r.top-mr.top,bottom:r.bottom-mr.top,scrollTop:e.scrollTop,clientHeight:e.clientHeight,lineHeight,logicalRow:e.value.slice(0,e.selectionStart).split(String.fromCharCode(10)).length,textareaWidth:e.clientWidth,selected:selected.textContent};
    measured.visible=measured.top>=e.scrollTop-2 && measured.bottom<=e.scrollTop+e.clientHeight+2;mirror.remove();return measured;
  })()`);
  await click('#projectBuildBtn'); await enabled('#projectBuildPlan'); await click('#projectBuildPlan');
  let job;
  await wait(async () => { job = (await service()).job; return job?.kind === 'plan' && job.status !== 'running'; }, 'static plan');
  assert.equal(job.status, 'failed'); assert.ok(job.diagnostics.some(item => item.code === 'build_actor_value' && item.propertyPath === '/actors/0/speed'));
  report.plan = { id: job.id, kind: job.kind, status: job.status, diagnosticCodes: job.diagnostics.map(item => item.code) };
  await wait(() => evaluate(`Array.from(document.querySelectorAll('#projectBuildDiagnostics button')).some(e=>e.textContent.includes('/actors/0/speed'))`), 'speed diagnostic');
  await evaluate(`Array.from(document.querySelectorAll('#projectBuildDiagnostics button')).find(e=>e.textContent.includes('/actors/0/speed')).click()`);
  await wait(() => evaluate(`!document.querySelector('#projectBuildDialog').open&&(await import('/web/modules/app-state.js')).appState.isEditing&&!document.querySelector('#sourceDiagnosticPanel').hidden`), 'source opens with diagnostic');
  await delay(120); await enabled('#sourceSearchOpen'); assert.equal(await value(editor), plain);
  await evaluate(`(()=>{window.__sourceSearchRequests=[];window.__sourceSaves=[];window.__sourceInputs=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.pathname.startsWith('/api/'))window.__sourceSearchRequests.push({path:url.pathname,method:init?.method||'GET'});const response=await original(input,init);if(init?.method==='POST'&&url.pathname==='/api/doc'){let body;try{body=JSON.parse(init.body)}catch{};window.__sourceSaves.push({body,status:response.status});}return response;};document.querySelector('#docSourceEditor').addEventListener('input',event=>__sourceInputs.push(event.inputType||'input'));})()`);
  await selection(0); await open(2);
  assert.equal((await searchState()).matchCase, true);
  await evaluate(`(()=>{window.__mediaOpenCount=0;new MutationObserver(records=>{window.__mediaOpenCount+=records.filter(record=>record.attributeName==='open'&&record.oldValue===null).length;}).observe(document.querySelector('#docMediaDialog'),{attributes:true,attributeFilter:['open'],attributeOldValue:true});})()`);
  const beforeMediaSource = await snapshot(), beforeMediaState = await state(), beforeMediaInputs = await evaluate('window.__sourceInputs.length');
  report.mediaIsolation = [];
  for (const field of ['Query', 'Replacement']) for (const kind of ['paste', 'drop']) {
    const observed = await evaluate(`(()=>{const target=document.querySelector('#sourceSearch${field}');target.focus();const transfer=new DataTransfer();const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII='),c=>c.charCodeAt(0));transfer.items.add(new File([bytes],'search-field-fixture.png',{type:'image/png'}));let highlighted=false;if(${JSON.stringify(kind)}==='drop'){target.dispatchEvent(new DragEvent('dragover',{dataTransfer:transfer,bubbles:true,cancelable:true}));highlighted=document.querySelector('.doc-editor-surface').classList.contains('is-media-drop');target.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));}else{target.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));}return {field:${JSON.stringify(field)},kind:${JSON.stringify(kind)},fileCount:transfer.files.length,highlighted,mediaOpenNow:document.querySelector('#docMediaDialog').open};})()`);
    await delay(200); report.mediaIsolation.push(observed);
    assert.equal(observed.fileCount, 1); assert.equal(observed.mediaOpenNow, false); assert.equal(observed.highlighted, false);
    assert.equal(await evaluate('window.__mediaOpenCount'), 0); assert.deepEqual(report.mediaUploads, []);
    assert.deepEqual(await snapshot(), beforeMediaSource); assert.deepEqual(await state(), beforeMediaState);
    assert.equal(await evaluate('window.__sourceInputs.length'), beforeMediaInputs);
    assert.equal(await value('#sourceSearchQuery'), ''); assert.equal(await value('#sourceSearchReplacement'), '');
  }
  assert.deepEqual(await authorTree(root), initial);
  report.steps.push('Real browser image File/DataTransfer paste and dragover/drop events on both search text fields never open the media importer or highlight the authoring drop target. Network capture observes no upload (including XHR), and source, selection, dirty state, input events, registry and assets stay unchanged. These are real DOM bubbling checks using synthetic events, not an OS clipboard claim.');
  await query('Needle', 1); await click('#sourceSearchMatchCase'); await query('Needle', 3);
  const needleStarts = [...plain.matchAll(/needle/gi)].map(match => match.index);
  assert.equal(needleStarts.length, 3);
  await click('#sourceSearchNext'); await expectSelection(needleStarts[0], needleStarts[0] + 6); assert.equal((await searchState()).current, 1);
  await click('#sourceSearchNext'); await expectSelection(needleStarts[1], needleStarts[1] + 6); assert.equal((await searchState()).current, 2);
  await click('#sourceSearchPrevious'); await expectSelection(needleStarts[0], needleStarts[0] + 6);
  await click('#sourceSearchPrevious'); await expectSelection(needleStarts[2], needleStarts[2] + 6); assert.equal((await searchState()).current, 3);
  await click('#sourceSearchNext'); await expectSelection(needleStarts[0], needleStarts[0] + 6); assert.equal((await searchState()).current, 1);
  await click('#sourceSearchMatchCase'); await query('needle', 1); await click('#sourceSearchNext'); await expectSelection(needleStarts[1], needleStarts[1] + 6);
  await query('absent-in-this-source', 0); const beforeNone = await snapshot(); await click('#sourceSearchNext'); assert.deepEqual(await snapshot(), beforeNone);
  await query(invalidLiteral, 1); await click('#sourceSearchNext'); await expectSelection(invalidStart, invalidEnd);
  const geometry = await selectionGeometry(); assert.equal(geometry.visible, true, JSON.stringify(geometry));
  assert.ok(geometry.top > geometry.logicalRow * geometry.lineHeight + 100); report.wrappedSelection = geometry;
  await screenshot('source-search-desktop.png');
  assert.equal((await state()).dirty, false); assert.equal(await evaluate('window.__sourceInputs.length'), 0); assert.equal(await evaluate('window.__sourceSaves.length'), 0); assert.deepEqual(await authorTree(root), initial);
  report.steps.push('Real Ctrl+F from the native source editor opens literal search. Case-sensitive and insensitive counts, Next/Previous, both wrap directions, and no-match navigation select only exact matches without changing text, dirty state, input events or author files.');
  report.steps.push('An independent full-text DOM Range measurement verifies the far speed match is visible after a very long wrapped CJK/emoji JSON string. Search operates on the current BOM/CRLF-backed draft; the build fixture only runs static validation.');
  await fill('#sourceSearchReplacement', '160'); await enabled('#sourceSearchReplace');
  const beforeModal = await snapshot(), modalInputs = await evaluate('window.__sourceInputs.length');
  await enabled('#sourcePositionOpen'); await click('#sourcePositionOpen');
  await wait(() => evaluate(`document.querySelector('#sourcePositionDialog').open`), 'Go to line coexists with search');
  await click('#sourceSearchReplace'); assert.deepEqual(await snapshot(), beforeModal); assert.equal(await evaluate('window.__sourceInputs.length'), modalInputs);
  await click('#sourcePositionCancel'); await wait(() => evaluate(`!document.querySelector('#sourcePositionDialog').open`), 'Go to line cancel');
  assert.deepEqual(await snapshot(), beforeModal); await enabled('#sourceSearchReplace');
  report.steps.push('An open Go to line modal blocks replacement even when an underlying button is invoked directly. Cancel preserves the exact source selection and restores the search action.');
  await click('#sourceSearchReplace');
  const speedCorrected = plain.slice(0, invalidStart) + '160' + plain.slice(invalidEnd);
  assert.equal(await value(editor), speedCorrected); assert.equal((await state()).dirty, true);
  assert.equal(await evaluate(`document.querySelector('#sourceDiagnosticPanel').dataset.status`), 'changed');
  await undo(); assert.equal(await value(editor), plain); assert.equal((await state()).dirty, false);
  assert.equal(await evaluate(`document.querySelector('#sourceDiagnosticPanel').dataset.status`), 'changed');
  await redo(); assert.equal(await value(editor), speedCorrected); await undo(); assert.equal(await value(editor), plain);
  report.steps.push('Replace current affects only the selected literal match and uses native undo/redo. The existing diagnostic becomes changed after replacement and remains changed after Undo restores the source.');
  const shortcutInputs = await evaluate('window.__sourceInputs.length');
  const fieldIndentShortcut = await evaluate(`(()=>{const e=document.querySelector('#sourceSearchQuery');e.focus();const event=new KeyboardEvent('keydown',{key:']',ctrlKey:true,bubbles:true,cancelable:true});e.dispatchEvent(event);return event.defaultPrevented;})()`);
  assert.equal(fieldIndentShortcut, false); assert.equal(await value(editor), plain); assert.equal(await evaluate('window.__sourceInputs.length'), shortcutInputs);
  await selection(invalidStart, invalidEnd); await key(']', 'BracketRight', 2, { windowsVirtualKeyCode: 221 });
  assert.notEqual(await value(editor), plain); await key('[', 'BracketLeft', 2, { windowsVirtualKeyCode: 219 }); assert.equal(await value(editor), plain);
  report.steps.push('Existing source indentation shortcuts still work with search open, while the same shortcut in a search field leaves the source untouched.');
  await query('LIT', 3); await fill('#sourceSearchReplacement', '$&/$1');
  const beforeAllInputs = await evaluate('window.__sourceInputs.length'); await enabled('#sourceSearchReplaceAll'); await click('#sourceSearchReplaceAll');
  const allReplaced = plain.split('LIT').join('$&/$1'); assert.equal(await value(editor), allReplaced);
  assert.equal(await evaluate('window.__sourceInputs.length'), beforeAllInputs + 1, 'Replace All performs one native input transaction');
  const afterAllSelection = await snapshot();
  for (const language of ['en', 'ja', 'zh-CN']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    const expectedMessage = await evaluate(`(await import('/web/i18n/index.js')).t('已替换 {0} 处；请按普通流程保存。',3)`);
    assert.equal((await searchState()).text, expectedMessage); assert.deepEqual(await snapshot(), afterAllSelection);
  }
  await undo(); assert.equal(await value(editor), plain, 'one native Undo reverts every replacement');
  await redo(); assert.equal(await value(editor), allReplaced);
  await query('$&/$1', 3); await click('#sourceSearchNext'); const literalSelection = await snapshot();
  assert.equal(literalSelection.value.slice(literalSelection.start, literalSelection.end), '$&/$1');
  report.steps.push('Replace All changes all three matches in one native input operation and one Undo restores all of them. Replacement text $&/$1 stays literal, and searching the resulting dollar/sign characters finds exactly three matches.');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  if (await evaluate(`document.querySelector('#docSidebarToggleBtn').getAttribute('aria-expanded')==='true'`)) await click('#docSidebarToggleBtn');
  const beforeLanguage = await snapshot(); const searchBeforeLanguage = await searchState();
  for (const language of ['zh-CN', 'en', 'ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.deepEqual(await snapshot(), beforeLanguage); const localized = await searchState();
    for (const field of ['query', 'replacement', 'matchCase', 'count', 'current']) assert.equal(localized[field], searchBeforeLanguage[field], field);
    await evaluate(`document.querySelector('#sourceSearchPanel').scrollIntoView({block:'start'})`);
    const layout = await evaluate(`(()=>{const p=document.querySelector('#sourceSearchPanel'),e=document.querySelector('#docSourceEditor');const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};const er=e.getBoundingClientRect(),frame=e.closest('.content-frame').getBoundingClientRect();return {noHorizontalOverflow:document.documentElement.scrollWidth<=innerWidth,panel:rect(p),editor:rect(e),editorVisibleHeight:Math.max(0,Math.min(er.bottom,frame.bottom,innerHeight)-Math.max(er.top,frame.top,0)),panelOverflow:p.scrollWidth>p.clientWidth,labels:p.innerText};})()`);
    report.layout[language] = layout; await screenshot(`source-search-${language}-390.png`);
    assert.equal(layout.noHorizontalOverflow, true); assert.equal(layout.panelOverflow, false); assert.ok(layout.editor.height >= 100, JSON.stringify(layout)); assert.ok(layout.editorVisibleHeight >= 100, JSON.stringify(layout));
    const controls = {};
    for (const suffix of ['Query', 'Replacement', 'MatchCase', 'Previous', 'Next', 'Replace', 'ReplaceAll', 'Close']) {
      const measured = await evaluate(`(()=>{const e=document.querySelector('#sourceSearch${suffix}');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,visible:e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};})()`);
      assert.ok(measured.left >= 0 && measured.right <= 391, JSON.stringify({ suffix, measured })); assert.equal(measured.visible, true, JSON.stringify({ suffix, measured })); controls[suffix] = measured;
    }
    report.layout[language].controls = controls;
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await undo(); assert.equal(await value(editor), plain); await redo(); assert.equal(await value(editor), allReplaced);
  report.steps.push('Chinese, English and Japanese search controls fit 390px. Each input and action remains reachable in the scrollable source pane, with a usable textarea. Language changes preserve query/replacement/case/count, source selection, and the native undo/redo history.');
  const beforeClose = await snapshot(); await click('#sourceSearchClose'); assert.equal((await searchState()).hidden, true); assert.deepEqual(await snapshot(), beforeClose);
  await open(4); assert.equal((await searchState()).hidden, false);
  const inputShortcut = await evaluate(`(()=>{const e=document.querySelector('#sourceSearchQuery');e.focus();const event=new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true});e.dispatchEvent(event);return event.defaultPrevented;})()`);
  assert.equal(inputShortcut, false, 'source find shortcut does not consume other text input browser shortcuts');
  await query(invalidLiteral, 1); await click('#sourceSearchNext'); await fill('#sourceSearchReplacement', '160'); await enabled('#sourceSearchReplace'); await click('#sourceSearchReplace');
  const finalText = allReplaced.replace(invalidLiteral, '160'); assert.equal(await value(editor), finalText);
  const beforeFinalClose = await snapshot(); await click('#sourceSearchClose'); assert.deepEqual(await snapshot(), beforeFinalClose);
  assert.equal(await evaluate('window.__sourceSaves.length'), 0); assert.deepEqual(await authorTree(root), initial);
  report.steps.push('Closing search preserves source and selection; real Cmd+F reopens it. The shortcut remains scoped to the source textarea and leaves other text fields alone. Search and replacements never save automatically.');
  await enabled('#docSaveBtn'); await click('#docSaveBtn'); const saved = finalText.replaceAll('\n', '\r\n');
  await wait(async () => await fs.readFile(sourceFile, 'utf8') === saved, 'ordinary source save');
  await wait(async () => { const s = await state(); return !s.dirty && !s.saving && !s.rebuilding; }, 'save and index refresh');
  const after = await authorTree(root), changed = Object.keys(after).filter(name => after[name] !== initial[name]);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(initial).sort()); assert.deepEqual(changed, [sourcePath]); assert.equal(await evaluate('window.__sourceSaves.length'), 1);
  report.saved = { sourcePath, beforeHash: initial[sourcePath], afterHash: after[sourcePath], authorFilesChanged: changed, bytes: Buffer.byteLength(saved),
    preservedBom: saved.startsWith('\uFEFF'), onlyCrlf: !saved.replaceAll('\r\n', '').includes('\n'), response: await evaluate('window.__sourceSaves[0]'), state: await state() };
  await open(2); await query('$&/$1', 3);
  if (await evaluate(`document.querySelector('#docSidebarToggleBtn').getAttribute('aria-expanded')!=='true'`)) await click('#docSidebarToggleBtn');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(e=>e.dataset.path.includes('characters/traveler')).click()`);
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.activePath.includes('characters/traveler')&&document.querySelector('#sourceSearchPanel').hidden`), 'source switch clears old search panel');
  assert.equal(await value('#sourceSearchQuery'), ''); assert.equal(await value('#sourceSearchReplacement'), '');
  assert.deepEqual(await authorTree(root), after); const finalJob = (await service()).job; assert.equal(finalJob.id, job.id); assert.equal(finalJob.kind, 'plan');
  report.steps.push('Ordinary Save is the only persistence operation: exactly one source request, only the target scene changes, BOM and CRLF are preserved, and templates/registry/assets remain identical. Switching documents clears the old search panel and both query fields. No engine project is generated or executed.');
  assert.deepEqual(report.mediaUploads, []); assert.deepEqual(report.errors, []); report.completedAt = new Date().toISOString(); report.passed = true;
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
