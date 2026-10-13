// Actual Chrome verification of the offline documentation atlas. No app server,
// author workspace, build backend or engine process is started by this check.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { renderAtlasHtml } from '../function-atlas-view.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(root, 'docs/test-results/functional-mapping');
const output = path.resolve(process.env.VIENTO_FUNCTION_ATLAS_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new evidence directory inside docs/test-results/functional-mapping.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Choose a new empty evidence directory.');
const hash = value => createHash('sha256').update(value).digest('hex');
const sources = ['docs/function-atlas.json', 'scripts/function-atlas-view.mjs', 'scripts/tests/function-atlas-smoke.mjs'];
const fingerprints = async () => Object.fromEntries(await Promise.all(sources.map(async name => [name, hash(await fs.readFile(path.join(root, name)))])));
const report = { startedAt: new Date().toISOString(), groups: [], screenshots: [], errors: [], requests: [], layout: {}, limitations: [
  'Actual Chrome opens generated documentation through file://. The page has no application server or execution backend.',
  'This checks offline mapping navigation, score/evidence display, text safety, narrow layout and focus. It does not rerun the historical product evidence or increase feature maturity.',
  'No Godot, Bevy, installed Tauri, native picker or Android device is exercised. Existing atlas data and scores remain unchanged.',
] };
const wait = async (check, label, budget = 15000) => {
  const deadline = Date.now() + budget;
  while (Date.now() < deadline) { if (await check()) return; await delay(100); }
  throw Error(`Timed out: ${label}`);
};
let temporary, chrome, socket, evaluate, screenshot, chromeLog = '';
const pending = new Map();
try {
  report.sources = await fingerprints();
  report.node = { version: process.version, executable: process.execPath, sha256: hash(await fs.readFile(process.execPath)) };
  const data = JSON.parse(await fs.readFile(path.join(root, 'docs/function-atlas.json'), 'utf8'));
  const flow = data.workflows.find(item => item.id === 'composition-to-delivery');
  assert.ok(flow, 'composition delivery workflow is present');
  assert.ok(flow.gaps?.length, 'composition workflow names its remaining gaps');
  const gapIds = flow.gaps.map(item => typeof item === 'string' ? item : item.function);
  assert.ok(gapIds.every(id => data.axes.function.some(item => item.id === id)), 'gap references resolve to real feature identities');
  const gapId = gapIds.find(id => !flow.steps.includes(id)); assert.ok(gapId, 'a planned gap is outside the executable stage list');
  const binding = data.bindings.find(item => item.function === 'scene.composition_materialize' && item.architecture === 'semantic-js');
  assert.ok(binding, 'materialization has its own semantic binding');
  const cell = dimension => data.cells.find(item => JSON.stringify(item.coordinates) === JSON.stringify([binding.architecture, binding.function, binding.implementation, dimension.id]));
  const refs = binding.evidence.map(id => data.evidence.find(item => item.id === id));
  assert.ok(refs.some(item => item?.kind === 'source') && refs.some(item => item?.kind === 'report'), 'reviewed binding exposes source and report evidence');
  report.atlas = { version: data.meta.version, commit: data.meta.commit, functions: data.axes.function.length,
    bindings: data.bindings.length, cells: data.cells.length, scoreSha256: hash(JSON.stringify(data.cells)), workflow: flow.id, gapIds, binding: binding.id };
  const htmlPath = path.join(root, 'docs/function-atlas.html'), html = renderAtlasHtml(data);
  // Only this renderer is used: the full generator would refresh unrelated
  // source snapshots or historical report paths in an isolated candidate.
  await fs.writeFile(htmlPath, html); report.htmlSha256 = hash(html);
  const base = pathToFileURL(htmlPath).href;
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-atlas-browser-'));
  report.temporaryRoot = temporary;
  const executable = process.argv[2] || '/usr/bin/google-chrome';
  const launcher = await fs.realpath(executable);
  report.chromeTool = { requested: executable, launcher, sha256: hash(await fs.readFile(launcher)) };
  const binary = path.join(path.dirname(launcher), 'chrome');
  if (binary !== launcher) { try { report.chromeTool.binary = { path: binary, sha256: hash(await fs.readFile(binary)) }; } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  const profile = path.join(temporary, 'profile'); await fs.mkdir(profile);
  chrome = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-extensions', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    '--window-size=1440,1100', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  chrome.stderr.on('data', bytes => { chromeLog = (chromeLog + bytes).slice(-32768); });
  let launchError; chrome.on('error', error => { launchError = error; });
  let port;
  await wait(async () => {
    if (launchError) throw launchError;
    if (chrome.exitCode !== null) throw Error('Chrome exited before its debugging endpoint was ready.');
    try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return Boolean(port); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return false; }
  }, 'Chrome startup');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(value => value.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  let sequence = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.id) {
      const request = pending.get(value.id); if (!request) return;
      pending.delete(value.id); clearTimeout(request.timer);
      value.error ? request.reject(Error(value.error.message)) : request.resolve(value.result);
    } else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
    else if (value.method === 'Network.requestWillBeSent') report.requests.push({ url: value.params.request.url, type: value.params.type });
    else if (value.method === 'Page.javascriptDialogOpening') {
      report.errors.push({ dialog: value.params.message }); void call('Page.handleJavaScriptDialog', { accept: false });
    }
  });
  evaluate = async expression => {
    const value = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true, userGesture: true });
    if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value;
  };
  const click = selector => evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing selector');const d=e.closest('details');if(d)d.open=true;e.click();})()`);
  const fill = (selector, value, event = 'input') => evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  const state = () => evaluate(`({hash:location.hash,workflow:document.querySelector('#workflow').value,feature:document.querySelector('#feature').value,rows:[...document.querySelectorAll('#list .binding-row')].map(e=>e.dataset.binding),focus:document.activeElement.id||document.activeElement.dataset.binding||document.activeElement.dataset.feature})`);
  screenshot = async name => { const result = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(result.data, 'base64')); report.screenshots.push(name); };
  const navigate = async hashValue => {
    await call('Page.navigate', { url: base + hashValue });
    await wait(() => evaluate(`document.readyState==='complete'&&document.querySelector('#list .binding-row')`), 'offline atlas loaded');
  };
  const checkDetail = async () => {
    const observed = await evaluate(`({text:document.querySelector('#detail').textContent,scores:[...document.querySelectorAll('#detail .detail-score')].map(e=>({title:e.querySelector('strong').textContent,reason:e.querySelector('p').textContent})),links:[...document.querySelectorAll('#detail a[href]')].map(e=>({href:e.getAttribute('href'),text:e.textContent}))})`);
    assert.ok(observed.text.includes(binding.id)); assert.equal(observed.scores.length, data.axes.maturity.length);
    data.axes.maturity.forEach((dimension, index) => {
      const expected = cell(dimension);
      assert.equal(observed.scores[index].title, `${dimension.label} · ${Number.isInteger(expected?.value) ? `${expected.value} / 5` : '未评分'}`);
      assert.equal(observed.scores[index].reason, expected.reason);
    });
    for (const ref of refs.filter(item => ['source', 'report'].includes(item.kind))) assert.ok(observed.links.some(link => link.href === '../' + ref.path.split('/').map(encodeURIComponent).join('/')), ref.path);
    return observed;
  };
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable'); report.browser = await call('Browser.getVersion');
  await navigate(`#workflow=${flow.id}`);
  assert.equal((await state()).workflow, flow.id);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#workflow-stages>li.workflow-step')].map(e=>e.dataset.feature)`), flow.steps);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#workflow-gaps .workflow-gap')].map(e=>e.dataset.feature)`), gapIds);
  const executableBindings = data.bindings.filter(item => flow.steps.includes(item.function)).map(item => item.id);
  assert.deepEqual(new Set((await state()).rows), new Set(executableBindings));
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#workflow-stages .workflow-binding[data-binding="${binding.id}"] .score-value')].map(e=>e.textContent)`),
    data.axes.maturity.map(dimension => Number.isInteger(cell(dimension)?.value) ? String(cell(dimension).value) : '—'));
  await evaluate(`document.querySelector('#workflow-stages').scrollIntoView({block:'start'})`); await screenshot('workflow-desktop.png');
  report.groups.push('A direct offline workflow URL expands its ordered functional stages and separately lists planned gaps; the normal binding list contains only the executable stage scope.');

  await click(`#workflow-stages .workflow-binding[data-binding="${binding.id}"]`);
  assert.equal((await state()).focus, 'detail'); assert.equal((await state()).feature, binding.function);
  report.binding = await checkDetail(); const bindingRoute = (await state()).hash;
  assert.equal(new URLSearchParams(bindingRoute.slice(1)).get('binding'), binding.id);
  await evaluate(`document.querySelector('#detail').scrollIntoView({block:'start'})`); await screenshot('binding-detail-desktop.png');
  await click(`#workflow-gaps a[data-feature="${gapId}"]`);
  const gapState = await state(); assert.equal(gapState.workflow, flow.id); assert.equal(gapState.feature, gapId);
  assert.deepEqual(new Set(gapState.rows), new Set(data.bindings.filter(item => item.function === gapId).map(item => item.id)));
  assert.ok(gapState.rows.length, 'planned gap binding is not lost to the workflow stage filter');
  for (const gapBinding of data.bindings.filter(item => item.function === gapId)) {
    const expected = data.axes.maturity.map(dimension => {
      const value = data.cells.find(item => JSON.stringify(item.coordinates) === JSON.stringify([gapBinding.architecture, gapBinding.function, gapBinding.implementation, dimension.id]))?.value;
      return Number.isInteger(value) ? String(value) : '—';
    });
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('#workflow-gaps .workflow-binding[data-binding="${gapBinding.id}"] .score-value')].map(e=>e.textContent)`), expected);
  }
  await evaluate('history.back()'); await wait(async () => (await state()).hash === bindingRoute, 'back to binding route'); await checkDetail();
  await evaluate('history.forward()'); await wait(async () => (await state()).hash === gapState.hash, 'forward to gap route');
  assert.equal((await state()).feature, gapId);
  report.groups.push('The materialization binding shows its four original scores, reasons and source/report links; planned-gap navigation escapes the stage filter without losing workflow context; browser back/forward restores both routes.');

  await fill('#search', 'atlas-no-match-17dc382fdc'); assert.equal((await state()).rows.length, 0);
  await click('#workflow-overview-reset'); const overview = await state();
  assert.equal(overview.workflow, flow.id); assert.equal(overview.feature, ''); assert.deepEqual(new Set(overview.rows), new Set(executableBindings));
  assert.equal(await evaluate(`document.querySelector('#search').value`), ''); assert.equal(overview.focus, 'workflow');
  await click('#reset'); const reset = await state(); assert.equal(reset.workflow, ''); assert.equal(reset.feature, ''); assert.equal(reset.rows.length, data.bindings.length);
  await evaluate(`location.hash='workflow=not-a-real-workflow'`);
  await wait(() => evaluate(`!document.querySelector('#route-note').hidden`), 'invalid deep-link warning');
  assert.equal((await state()).workflow, ''); assert.equal((await state()).rows.length, data.bindings.length);
  await click('#reset'); assert.equal(await evaluate(`document.querySelector('#route-note').hidden`), true);
  await evaluate(`location.hash=${JSON.stringify(`workflow=${flow.id}&workflow=${flow.id}`)}`);
  await wait(() => evaluate(`!document.querySelector('#route-note').hidden`), 'duplicate parameter warning');
  assert.equal((await state()).workflow, '');
  assert.equal(await evaluate(`document.querySelectorAll('#priorities .priority-card').length`), data.priorities.length);
  const priorityTarget = data.priorities[0].functions[0];
  await click(`#priorities .priority-card[data-priority="0"] a[data-feature="${priorityTarget}"]`);
  assert.equal((await state()).feature, priorityTarget); assert.ok((await state()).rows.length);
  report.groups.push('Workflow overview reset clears conflicting filters while keeping the route; full reset restores all bindings. Unknown or duplicate route parameters cannot silently select another scope. Priority links open their actual feature bindings.');

  await navigate(`#workflow=${flow.id}`);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  for (const theme of ['light', 'dark']) {
    await fill('#theme', theme, 'change');
    await evaluate(`document.querySelector('#workflow-stages').scrollIntoView({block:'start'})`);
    const layout = await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,background:getComputedStyle(document.body).backgroundColor,stageCount:document.querySelectorAll('#workflow-stages>li').length})`);
    assert.equal(layout.theme, theme); assert.ok(layout.scrollWidth <= layout.width, JSON.stringify(layout)); report.layout[theme] = layout;
    await screenshot(`workflow-${theme}-390.png`);
  }
  assert.notEqual(report.layout.light.background, report.layout.dark.background);
  await click(`#workflow-stages .workflow-binding[data-binding="${binding.id}"]`); await checkDetail();
  assert.equal((await state()).focus, 'detail');
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), true);
  await screenshot('binding-detail-390.png');
  await evaluate(`document.querySelector('#workflow').focus()`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  report.keyboard = await evaluate(`(()=>{const e=document.activeElement,s=getComputedStyle(e),r=e.getBoundingClientRect();return{id:e.id,tag:e.tagName,focusVisible:e.matches(':focus-visible'),outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`);
  assert.equal(report.keyboard.focusVisible, true); assert.notEqual(report.keyboard.outlineStyle, 'none');
  assert.ok(parseFloat(report.keyboard.outlineWidth) >= 2); assert.ok(report.keyboard.left >= 0 && report.keyboard.right <= 390);
  await screenshot('keyboard-focus-390.png');
  report.groups.push('At 390 CSS pixels the workflow and binding details fit horizontally; light/dark themes produce different backgrounds; keyboard Tab retains a visible focus ring and links hand off focus to their semantic target.');

  const malicious = structuredClone(data), injected = '<img src=x onerror="window.__atlasInjected=1"></script><script>window.__atlasInjected=2</script>';
  malicious.axes.function.find(item => item.id === binding.function).label = injected;
  malicious.workflows.find(item => item.id === flow.id).label = injected;
  malicious.axes.implementation.find(item => item.id === binding.implementation).paths.push('javascript:window.__atlasInjected=3');
  const fixturePath = path.join(temporary, 'untrusted-atlas.html'); await fs.writeFile(fixturePath, renderAtlasHtml(malicious));
  await call('Page.navigate', { url: pathToFileURL(fixturePath).href + `#workflow=${flow.id}&feature=${binding.function}&binding=${binding.id}` });
  await wait(() => evaluate(`document.readyState==='complete'&&document.querySelector('#detail').textContent.includes(${JSON.stringify(binding.id)})`), 'untrusted text fixture');
  report.textSafety = await evaluate(`({injected:window.__atlasInjected??null,literal:document.querySelector('#detail h2').textContent,unsafeElements:document.querySelectorAll('img[src=x],a[href^="javascript:"]').length})`);
  assert.equal(report.textSafety.injected, null); assert.equal(report.textSafety.literal, injected); assert.equal(report.textSafety.unsafeElements, 0);
  assert.equal(report.requests.filter(item => /^https?:/.test(item.url)).length, 0, 'offline document must not initiate HTTP requests');
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  report.groups.push('A separate generated fixture renders hostile labels literally, blocks executable file links and initiates no HTTP request. The real atlas data and four-axis scores are untouched.');
  report.finalSources = await fingerprints(); assert.deepEqual(report.finalSources, report.sources);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = { message: error.message, stack: error.stack };
  if (evaluate) { try { report.pageFailure = await evaluate(`({url:location.href,text:document.body.innerText,focus:document.activeElement.id})`); } catch (captureError) { report.captureError = captureError.message; } }
  if (screenshot) { try { await screenshot('failure.png'); } catch (captureError) { report.screenshotError = captureError.message; } }
  process.exitCode = 1;
} finally {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('Browser smoke ended.')); } pending.clear();
  if (socket) socket.close();
  if (chrome?.pid && chrome.exitCode === null && chrome.signalCode === null) {
    const exited = once(chrome, 'exit');
    try { process.kill(-chrome.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') report.cleanupError = error.message; }
    const done = await Promise.race([exited.then(() => true), delay(5000).then(() => false)]);
    if (!done) { try { process.kill(-chrome.pid, 'SIGKILL'); await exited; } catch (error) { if (error.code !== 'ESRCH') report.cleanupError = error.message; } }
  }
  if (temporary) {
    try { await fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); report.temporaryCleaned = true; }
    catch (error) { report.cleanupError = error.message; }
  }
  if (report.cleanupError) { report.ok = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, 'chrome.log'), chromeLog);
  await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ ok: report.ok, groups: report.groups.length, output, failure: report.failure?.message }) + '\n');
}
