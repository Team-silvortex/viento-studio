// Isolated real Chrome/HTTP acceptance; requires VIENTO_GODOT_BIN,
// VIENTO_BEVY_BIN and VIENTO_BEVY_OLD_BIN. Never uses an installed app/profile.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./browser/', import.meta.url));
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-tool-probe-browser-'));
await fs.mkdir(evidence, { recursive: true });
const report = { ok: false, startedAt: new Date().toISOString(), scope: 'Fresh source 0.0.8 unreleased increment, actual isolated Chrome and Linux editor HTTP service; no installed Tauri or Android acceptance.', scenarios: [], locales: [], errors: [] };
const children = [], connections = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function authors(directory) {
  const result = {};
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name), relative = path.relative(directory, file);
    if (relative.split(path.sep)[0] !== '.viento') result[relative] = hash(await fs.readFile(file));
  }
  return result;
}
async function until(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await delay(40); }
  throw new Error(`Timed out: ${label}`);
}
async function childProcess(executable, args, options) {
  const child = spawn(executable, args, options); children.push(child);
  child.done = new Promise(resolve => child.once('close', code => resolve(code)));
  child.output = '';
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', bytes => { child.output += bytes; });
  return child;
}
async function host(name, backendId, tool) {
  const directory = path.join(base, name), workspace = path.join(directory, 'workspace');
  await fs.mkdir(directory);
  await fs.cp(path.join(root, 'examples/bevy-headless'), workspace, { recursive: true });
  const before = await authors(workspace);
  const env = { ...process.env, VIENTO_APP_ROOT: root, VIENTO_WORKSPACE_ROOT: workspace,
    VIENTO_EXECUTION_BACKEND: backendId, VIENTO_GODOT_BIN: backendId === 'org.viento.godot4' ? tool : '',
    VIENTO_BEVY_BIN: backendId === 'org.viento.bevy' ? tool : '', VIENTO_PREFERENCES_PATH: '', VIENTO_SESSION_TOKEN: '',
    XDG_CONFIG_HOME: path.join(directory, 'config'), XDG_DATA_HOME: path.join(directory, 'data'), XDG_CACHE_HOME: path.join(directory, 'cache'),
    DOC_API_HOST: '127.0.0.1', DOC_API_REQUIRE_WRITE_AUTH: '0', DOC_API_TOKEN: '', DOC_API_WRITE_TOKEN: '',
    DOC_API_RATE_LIMIT_MAX_REQUESTS: '10000', PORT: '0' };
  const rebuild = await childProcess(process.execPath, [path.join(root, 'scripts/ops/rebuild.mjs')], { cwd: workspace, env });
  assert.equal(await rebuild.done, 0, rebuild.output);
  const server = await childProcess(process.execPath, [path.join(root, 'scripts/doc-site-server.mjs'), '--port', '0'], { cwd: workspace, env });
  const port = await until(() => server.output.match(/running at http:\/\/127\.0\.0\.1:(\d+)/)?.[1], `${name} server`);
  return { name, workspace, before, url: `http://127.0.0.1:${port}`, backendId };
}
class Cdp {
  constructor(socket) {
    this.socket = socket; this.id = 0; this.pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const item = this.pending.get(message.id); if (!item) return;
        this.pending.delete(message.id); clearTimeout(item.timer);
        if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
      } else if (message.method === 'Runtime.exceptionThrown') report.errors.push(message.params.exceptionDetails.text);
    });
  }
  async call(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 25000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
}
let cdp;
try {
  const chrome = await childProcess('/usr/bin/google-chrome-stable', ['--headless=new', '--remote-debugging-port=0',
    `--user-data-dir=${path.join(base, 'chrome')}`, '--no-first-run', '--disable-default-apps', '--disable-dev-shm-usage', 'about:blank'], {});
  const endpoint = await until(() => chrome.output.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], 'Chrome endpoint');
  const debug = new URL(endpoint);
  const targets = await (await fetch(`http://${debug.host}/json/list`)).json();
  const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  connections.push(socket); cdp = new Cdp(socket);
  await cdp.call('Runtime.enable'); await cdp.call('Page.enable');
  report.browser = (await cdp.call('Browser.getVersion')).product;
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 820, deviceScaleFactor: 1, mobile: false });
  const choices = [
    ['bevy-ready', 'org.viento.bevy', process.env.VIENTO_BEVY_BIN, 'ready', null],
    ['bevy-old', 'org.viento.bevy', process.env.VIENTO_BEVY_OLD_BIN, 'unavailable', 'tool_version'],
    ['bevy-missing', 'org.viento.bevy', '', 'unavailable', 'tool_missing'],
    ['godot-ready', 'org.viento.godot4', process.env.VIENTO_GODOT_BIN, 'ready', null],
  ];
  for (const [name, backendId, tool, expected, reason] of choices) {
    assert.ok(tool !== undefined, `${name} tool must be explicitly supplied`);
    const h = await host(name, backendId, tool);
    await cdp.call('Page.navigate', { url: h.url });
    await until(() => cdp.evaluate("Boolean(document.getElementById('modeEditBtn') && !document.getElementById('modeEditBtn').disabled && document.getElementById('projectBuildBtn') && !document.getElementById('projectBuildBtn').hidden)"), 'editable host detection');
    await cdp.evaluate("document.getElementById('modeEditBtn').click()");
    await until(() => cdp.evaluate("document.getElementById('modeEditBtn').getAttribute('aria-pressed') === 'true' || document.getElementById('modeEditBtn').classList.contains('mode-btn-active')"), 'edit mode');
    await cdp.evaluate("document.getElementById('projectBuildBtn').click()");
    await until(() => cdp.evaluate("Boolean(document.getElementById('projectBuildToolCheck') && !document.getElementById('projectBuildToolCheck').hidden && !document.getElementById('projectBuildToolCheck').disabled && document.getElementById('projectBuildDialog').open)"), 'tool check entry');
    const initial = await cdp.evaluate("fetch('/api/project-build').then(r=>r.json())");
    assert.equal(initial.data.toolStatus.status, 'unchecked'); assert.equal(initial.data.job, null);
    await cdp.evaluate("document.getElementById('projectBuildToolCheck').click()");
    await until(() => cdp.evaluate("!document.getElementById('projectBuildToolCheck').disabled"), 'identity completion');
    const checked = (await cdp.evaluate("fetch('/api/project-build').then(r=>r.json())")).data;
    assert.equal(checked.toolStatus.status, expected); assert.equal(checked.toolStatus.reason, reason); assert.equal(checked.job, null);
    if (tool) assert.ok(!JSON.stringify(checked.toolStatus).includes(tool));
    assert.equal(await cdp.evaluate("document.getElementById('projectBuildPlan').disabled"), false);
    if (expected !== 'ready') assert.equal(await cdp.evaluate("document.getElementById('projectBuildGenerate').disabled"), true);
    const wrong = await cdp.evaluate("fetch('/api/project-build',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'tool-check',tool:'/untrusted',backendId:'other'})}).then(async r=>({status:r.status,body:await r.json()}))");
    assert.equal(wrong.status, 400); assert.equal(wrong.body.errorCode, 'build_request_invalid');
    if (name === 'bevy-ready') {
      const jobs = [];
      for (const [id, kind] of [['projectBuildPlan', 'plan'], ['projectBuildGenerate', 'build'], ['projectBuildHeadless', 'run']]) {
        await until(() => cdp.evaluate(`!document.getElementById('${id}').disabled`), id);
        const previousJobId = (await cdp.evaluate("fetch('/api/project-build').then(r=>r.json())")).data.job?.id;
        await cdp.evaluate(`document.getElementById('${id}').click()`);
        const state = await until(async () => {
          const value = (await cdp.evaluate("fetch('/api/project-build').then(r=>r.json())")).data;
          return value.job?.id !== previousJobId && value.job?.kind === kind && value.job.status !== 'running' ? value : null;
        }, `${id} finish`);
        assert.equal(state.job.status, 'succeeded'); jobs.push(state.job);
      }
      const beforeCheck = (await cdp.evaluate("fetch('/api/project-build').then(r=>r.json())")).data;
      await cdp.evaluate("document.getElementById('projectBuildToolCheck').click()");
      await until(() => cdp.evaluate("!document.getElementById('projectBuildToolCheck').disabled"), 'second check');
      const afterCheck = (await cdp.evaluate("fetch('/api/project-build').then(r=>r.json())")).data;
      assert.deepEqual(afterCheck.job, beforeCheck.job); assert.deepEqual(afterCheck.latestBuild, beforeCheck.latestBuild);
      for (const locale of ['zh-CN', 'en', 'ja']) {
        await cdp.evaluate(`import('/web/i18n/index.js').then(m=>m.applyLanguage('${locale}'))`);
        await cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
        const layout = await cdp.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,dialog:[...document.querySelectorAll('dialog')].filter(d=>d.open).map(d=>({width:d.clientWidth,scroll:d.scrollWidth})),button:document.getElementById('projectBuildToolCheck').textContent,message:document.getElementById('projectBuildAvailability').textContent})");
        assert.ok(layout.scroll <= layout.width, JSON.stringify(layout)); assert.ok(layout.dialog.every(d => d.scroll <= d.width), JSON.stringify(layout));
        const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png' });
        await fs.writeFile(path.join(evidence, `${locale}-390.png`), Buffer.from(screenshot.data, 'base64'));
        report.locales.push({ locale, ...layout });
      }
      await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 820, deviceScaleFactor: 1, mobile: false });
      await cdp.evaluate("document.getElementById('projectBuildClose').click(); document.querySelector('.doc-item[data-path]').click()");
      await until(() => cdp.evaluate("Boolean(document.getElementById('docEditBtn') && !document.getElementById('docEditBtn').disabled)"), 'edit entry');
      await cdp.evaluate("document.getElementById('docEditBtn').click()");
      await until(() => cdp.evaluate("!document.getElementById('docSourceEditor').disabled && document.getElementById('docSourceEditor').value.length>0"), 'source editor');
      const draft = await cdp.evaluate("(()=>{const e=document.getElementById('docSourceEditor'); e.value+='\\nunsaved tool-check draft';e.dispatchEvent(new Event('input',{bubbles:true}));e.setSelectionRange(5,9);return {value:e.value,start:e.selectionStart,end:e.selectionEnd};})()");
      await cdp.evaluate("document.getElementById('projectBuildBtn').click()");
      await until(() => cdp.evaluate("!document.getElementById('projectBuildToolCheck').disabled"), 'dirty check permitted');
      assert.equal(await cdp.evaluate("document.getElementById('projectBuildPlan').disabled"), true);
      await cdp.evaluate("document.getElementById('projectBuildToolCheck').click()");
      await until(() => cdp.evaluate("!document.getElementById('projectBuildToolCheck').disabled"), 'dirty check finish');
      await cdp.evaluate("document.getElementById('projectBuildClose').click()");
      assert.deepEqual(await cdp.evaluate("(()=>{const e=document.getElementById('docSourceEditor');return {value:e.value,start:e.selectionStart,end:e.selectionEnd};})()"), draft);
      report.draftPreserved = true; report.jobs = jobs;
    }
    assert.deepEqual(await authors(h.workspace), h.before);
    report.scenarios.push({ name, backendId, toolStatus: checked.toolStatus, authoredFilesUnchanged: Object.keys(h.before).length });
  }
  assert.deepEqual(report.errors, []); report.ok = true;
} catch (error) {
  report.failure = error.message;
  if (cdp) {
    try { report.failureState = await cdp.evaluate("(async()=>({body:document.body.innerText.slice(-12000),state:await fetch('/api/project-build').then(r=>r.json()),button:document.getElementById('projectBuildToolCheck')?.outerHTML}))()"); }
    catch { /* Preserve the first acceptance failure. */ }
  }
  throw error;
} finally {
  for (const socket of connections) socket.close();
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await child.done; } finally { clearTimeout(timer); }
  }
  await fs.rm(base, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString(); report.temporaryDirectoriesRemoved = true;
  await fs.writeFile(path.join(evidence, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ ok: report.ok, browser: report.browser, scenarios: report.scenarios.length, locales: report.locales.length, jobs: report.jobs?.length, errors: report.errors.length }));
