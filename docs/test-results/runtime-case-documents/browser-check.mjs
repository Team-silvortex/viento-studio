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
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-runtime-case-documents-browser-'));
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
  const targets = await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json();
  const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  connections.push(socket); cdp = new Cdp(socket);
  await cdp.call('Runtime.enable'); await cdp.call('Page.enable');
  report.browser = (await cdp.call('Browser.getVersion')).product;
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 820, deviceScaleFactor: 1, mobile: false });
  const h = await host('bevy-case-documents', 'org.viento.bevy', process.env.VIENTO_BEVY_BIN);
  await cdp.call('Page.navigate', { url: h.url });
  await until(() => cdp.evaluate("Boolean(document.getElementById('modeEditBtn') && !document.getElementById('modeEditBtn').disabled && document.getElementById('projectBuildBtn') && !document.getElementById('projectBuildBtn').hidden)"), 'editable host');
  await cdp.evaluate("document.getElementById('modeEditBtn').click()");
  await until(() => cdp.evaluate("document.getElementById('modeEditBtn').getAttribute('aria-pressed') === 'true' || document.getElementById('modeEditBtn').classList.contains('mode-btn-active')"), 'edit mode');
  await cdp.evaluate("document.getElementById('projectBuildBtn').click()");
  await until(() => cdp.evaluate("Boolean(document.getElementById('projectBuildDialog')?.open && !document.getElementById('projectBuildPlan')?.disabled)"), 'workbench');
  const state = async () => (await cdp.evaluate("fetch('/api/project-build').then(r=>r.json())")).data;
  const jobs = [];
  async function run(id,kind) {
    await until(() => cdp.evaluate(`!document.getElementById('${id}').disabled`), id);
    const oldId = (await state()).job?.id;
    await cdp.evaluate(`document.getElementById('${id}').click()`);
    const result = await until(async () => {const s=await state();return s.job?.id!==oldId && s.job?.kind===kind && s.job.status!=='running'?s:null;}, `${id} terminal`);
    assert.equal(result.job.status,'succeeded', JSON.stringify(result.job)); jobs.push(result.job);return result;
  }
  await run('projectBuildPlan','plan');await run('projectBuildGenerate','build');
  await run('projectBuildControl','run');
  await until(() => cdp.evaluate("!document.getElementById('projectBuildCaseGenerate').disabled"),'sample baseline');
  await cdp.evaluate("document.getElementById('projectBuildCaseEditor').open=true;document.getElementById('projectBuildCaseGenerate').click()");
  const baseline=await cdp.evaluate("document.getElementById('projectBuildCaseProgram').value");
  const definition=JSON.parse(baseline); assert.equal(definition.format,'viento-runtime-case');assert.equal(definition.checks.length,2);
  await until(()=>cdp.evaluate("Boolean(document.getElementById('projectBuildCaseDocumentRefresh')&&!document.getElementById('projectBuildCaseDocumentRefresh').disabled)"),'case refresh enabled');
  await cdp.evaluate("document.getElementById('projectBuildCaseDocumentRefresh').click()");
  const uiText=()=>cdp.evaluate("(()=>{const e=document.getElementById('projectBuildCaseProgram');return {value:e.value,start:e.selectionStart,end:e.selectionEnd};})()");
  const catalog=()=>cdp.evaluate("fetch('/api/project-build',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'case-list',sceneId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'})}).then(r=>r.json()).then(v=>v.data)");
  await until(()=>cdp.evaluate("Boolean(document.getElementById('projectBuildCaseDocumentSave')&&!document.getElementById('projectBuildCaseDocumentSave').disabled)"),'case save enabled');
  await cdp.evaluate("(()=>{const e=document.getElementById('projectBuildCaseDocumentPath');e.value='documents/runtime-cases/browser.json';e.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('projectBuildCaseDocumentSave').click();})()");
  const saved=await until(async()=>{const c=await catalog();return c?.documents?.length===1?c.documents[0]:null;},'case registered');
  assert.equal(saved.valid,true);const savedBytes=await fs.readFile(path.join(h.workspace,saved.path),'utf8');const wrapper=JSON.parse(savedBytes);
  assert.equal(wrapper.format,'viento-runtime-case-document');assert.equal(wrapper.sceneObjectId,'dddddddd-dddd-4ddd-8ddd-dddddddddddd');assert.deepEqual(wrapper.case,definition);
  await until(()=>cdp.evaluate("!document.getElementById('projectBuildCaseDocumentLoad').disabled"),'load saved case');
  await cdp.evaluate("document.getElementById('projectBuildCaseProgram').value='';document.getElementById('projectBuildCaseProgram').dispatchEvent(new Event('input',{bubbles:true}));window.confirm=()=>true;document.getElementById('projectBuildCaseDocumentLoad').click()");
  await until(async()=>JSON.parse((await uiText()).value||'null')?.format==='viento-runtime-case','saved definition loaded');
  const pass=await run('projectBuildCaseRun','run');assert.equal(pass.job.verification.evaluation.status,'passed');
  await cdp.evaluate("(()=>{const e=document.getElementById('projectBuildCaseProgram'),v=JSON.parse(e.value);v.checks[0].position.value[0]+=1;e.value=JSON.stringify(v,null,2);e.dispatchEvent(new Event('input',{bubbles:true}));e.setSelectionRange(12,19);window.confirm=()=>false;document.getElementById('projectBuildCaseDocumentLoad').click();})()");
  const draft=await uiText();await delay(100);assert.deepEqual(await uiText(),draft);
  await until(()=>cdp.evaluate("!document.getElementById('projectBuildCaseDocumentSave').disabled"),'save after terminal UI poll');
  await fs.writeFile(path.join(h.workspace,saved.path),savedBytes+' ');
  await cdp.evaluate("document.getElementById('projectBuildCaseDocumentSave').click()");
  await until(()=>cdp.evaluate("Boolean(document.getElementById('projectBuildCaseDocumentError').textContent)"),'revision conflict');
  assert.deepEqual(await uiText(),draft);assert.equal(await fs.readFile(path.join(h.workspace,saved.path),'utf8'),savedBytes+' ');
  await cdp.evaluate("(()=>{const e=document.getElementById('projectBuildCaseDocumentPath');e.value='documents/runtime-cases/browser-copy.json';e.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('projectBuildCaseDocumentSaveAs').click();})()");
  const copied=await until(async()=>{const c=await catalog();return c?.documents?.length===2?c.documents.find(d=>d.id!==saved.id):null;},'explicit save new copy');
  assert.equal(copied.valid,true);const fail=await run('projectBuildCaseRun','run');assert.equal(fail.job.verification.evaluation.status,'failed');assert.equal(fail.job.verification.evaluation.failedChecks,1);
  assert.deepEqual(pass.job.control.program,fail.job.control.program);
  const text=await uiText();
  for(const locale of ['zh-CN','en','ja']) {
    await cdp.evaluate(`import('/web/i18n/index.js').then(m=>m.applyLanguage('${locale}'))`);
    await cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await cdp.evaluate("document.getElementById('projectBuildCaseDocumentSave').scrollIntoView({block:'center'})");
    const layout=await cdp.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,dialog:[...document.querySelectorAll('dialog')].filter(d=>d.open).map(d=>({width:d.clientWidth,scroll:d.scrollWidth})),save:document.getElementById('projectBuildCaseDocumentSave').textContent,load:document.getElementById('projectBuildCaseDocumentLoad').textContent,status:document.getElementById('projectBuildCaseDocumentStatus').textContent})");
    assert.ok(layout.scroll<=layout.width);assert.ok(layout.dialog.every(d=>d.scroll<=d.width));assert.deepEqual(await uiText(),text);
    if(locale!=='zh-CN'){assert.notEqual(layout.save,'保存用例');assert.notEqual(layout.load,'载入用例');assert.ok(!layout.status.startsWith('已载入'));}
    const screenshot=await cdp.call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(evidence,`${locale}-390.png`),Buffer.from(screenshot.data,'base64'));report.locales.push({locale,...layout});
  }
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:820,deviceScaleFactor:1,mobile:false});
  await cdp.evaluate("document.getElementById('projectBuildClose').click();document.getElementById('projectBuildBtn').click()");await until(()=>cdp.evaluate("document.getElementById('projectBuildDialog').open"),'reopen');assert.deepEqual(await uiText(),text);
  await fs.rename(h.workspace,h.workspace+'-offline');await delay(3100);assert.equal((await state()).catalogDiagnostic?.code,'build_catalog_unavailable');
  const offline=await run('projectBuildCaseRun','run');assert.equal(offline.job.verification.evaluation.status,'failed');
  const unavailable=await catalog();assert.equal(unavailable,undefined);await fs.rename(h.workspace+'-offline',h.workspace);
  await cdp.evaluate("document.getElementById('projectBuildClose').click();document.querySelector('.doc-item[data-path]').click()");
  await until(()=>cdp.evaluate("Boolean(document.getElementById('docEditBtn')&&!document.getElementById('docEditBtn').disabled)"),'author edit');await cdp.evaluate("document.getElementById('docEditBtn').click()");
  await until(()=>cdp.evaluate("!document.getElementById('docSourceEditor').disabled&&document.getElementById('docSourceEditor').value.length>0"),'author source');
  const authorDraft=await cdp.evaluate("(()=>{const e=document.getElementById('docSourceEditor');e.value+='\\nunsaved author';e.dispatchEvent(new Event('input',{bubbles:true}));e.setSelectionRange(5,9);return {value:e.value,start:e.selectionStart,end:e.selectionEnd};})()");
  await cdp.evaluate("document.getElementById('projectBuildBtn').click()");await until(()=>cdp.evaluate("document.getElementById('projectBuildDialog').open"),'dirty author reopen');
  assert.equal(await cdp.evaluate("document.getElementById('projectBuildCaseDocumentSave').disabled"),true);assert.equal(await cdp.evaluate("document.getElementById('projectBuildCaseRun').disabled"),true);
  await cdp.evaluate("document.getElementById('projectBuildClose').click()");assert.deepEqual(await cdp.evaluate("(()=>{const e=document.getElementById('docSourceEditor');return {value:e.value,start:e.selectionStart,end:e.selectionEnd};})()"),authorDraft);
  const after=await authors(h.workspace);for(const [file,sha]of Object.entries(h.before))assert.equal(after[file],sha,file);assert.equal(Object.keys(after).length,Object.keys(h.before).length+4);assert.deepEqual(report.errors,[]);
  report.jobs=jobs;report.scenarios=[{name:'register and reload stable case',documentId:saved.id},{name:'cancel draft replacement preserves text'},{name:'external conflict preserves both author bytes and local draft'},{name:'save new copy and real failed expectation',documentId:copied.id},{name:'source offline frozen case and fresh catalog rejection'},{name:'three languages narrow layout, caret, reopen and dirty author protection'}];
  report.originalAuthorFiles=Object.keys(h.before).length;report.newCaseFiles=4;report.originalAuthorBytesUnchanged=true;report.draftAndCaretPreserved=true;report.ok=true;
} catch (error) {
  report.failure = error.message;
  if (cdp) {
    try { report.failureState = await cdp.evaluate("(async()=>({body:document.body.innerText.slice(-12000),state:await fetch('/api/project-build').then(r=>r.json()),button:document.getElementById('projectBuildCaseDocumentSave')?.outerHTML}))()"); }
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
