// Isolated real Chrome/HTTP suite acceptance; requires VIENTO_GODOT_BIN.
// It never uses an installed app/profile or an Android device.
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
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-runtime-case-suites-browser-'));
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

  assert.ok(process.env.VIENTO_GODOT_BIN, 'Set VIENTO_GODOT_BIN to the trusted actual Godot executable.');
  const h = await host('godot-case-suites', 'org.viento.godot4', process.env.VIENTO_GODOT_BIN);
  const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const jobs = [], authorDocuments = [];
  report.executionBackend = h.backendId;
  report.toolSha256 = hash(await fs.readFile(process.env.VIENTO_GODOT_BIN));
  report.sourceHashes = {};
  for (const file of ['web/modules/app-runtime-case-suites.js','web/modules/app-project-build.js','web/project-build.css','web/i18n/en.js','web/i18n/ja.js','engine/runtime-case-suite.mjs','scripts/lib/project-build-service.mjs','scripts/lib/runtime-case-suites.mjs','scripts/adapters/node-runtime-case-suite.mjs']) report.sourceHashes[file] = hash(await fs.readFile(path.join(root,file)));
  await cdp.call('Page.navigate', { url: h.url });
  const existsEnabled = id => cdp.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});return Boolean(e&&!e.hidden&&!e.disabled&&e.getClientRects().length)})()`);
  const click = async id => { await until(()=>existsEnabled(id),`${id} visible and enabled`);await cdp.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`); };
  const setInput = async (id,value) => cdp.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const state = async () => (await cdp.evaluate("fetch('/api/project-build').then(r=>r.json())")).data;
  const api = payload => cdp.evaluate(`fetch('/api/project-build',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(payload)})}).then(async r=>({status:r.status,...await r.json()}))`);
  const catalog = async () => (await api({action:'suite-list',sceneId})).data;
  const caseCatalog = async () => (await api({action:'case-list',sceneId})).data;
  const selectedMembers = () => cdp.evaluate("[...document.querySelectorAll('#projectBuildSuiteCases input:checked')].map(e=>e.dataset.documentId)");
  const suiteDraft = () => cdp.evaluate("({members:[...document.querySelectorAll('#projectBuildSuiteCases input:checked')].map(e=>e.dataset.documentId),path:document.getElementById('projectBuildSuitePath').value,start:document.getElementById('projectBuildSuitePath').selectionStart,end:document.getElementById('projectBuildSuitePath').selectionEnd})");
  const toggle = async id => { await until(()=>cdp.evaluate(`Boolean(document.querySelector('#projectBuildSuiteCases input[data-document-id="${id}"]')&&!document.querySelector('#projectBuildSuiteCases input[data-document-id="${id}"]').disabled)`),`member ${id} enabled`);await cdp.evaluate(`document.querySelector('#projectBuildSuiteCases input[data-document-id="${id}"]').click()`); };
  async function run(id,kind,expectedStatus='succeeded') {
    await until(()=>existsEnabled(id),`${id} UI unlocked`);const oldId=(await state()).job?.id;
    await click(id);
    const result=await until(async()=>{const s=await state();return s.job?.id!==oldId&&s.job?.kind===kind&&s.job.status!=='running'?s:null;},`${id} new ${kind} terminal`,45000);
    assert.equal(result.job.status,expectedStatus,JSON.stringify(result.job));jobs.push(result.job);return result;
  }
  async function saveCase(definition,sourcePath) {
    await click('projectBuildCaseDocumentNew');await setInput('projectBuildCaseProgram',JSON.stringify(definition,null,2));
    await setInput('projectBuildCaseDocumentPath',sourcePath);await click('projectBuildCaseDocumentSave');
    const saved=await until(async()=>{const c=await caseCatalog();return c?.documents.find(d=>d.path===sourcePath);},`registered ${sourcePath}`);
    await until(()=>cdp.evaluate(`document.getElementById('projectBuildCaseDocumentSelect').value===${JSON.stringify(saved.id)}&&!document.getElementById('projectBuildCaseDocumentLoad').disabled`),'author case save UI unlocked');
    assert.equal(saved.valid,true);authorDocuments.push(saved);return saved;
  }
  async function saveSuite(sourcePath,asNew=false) {
    await setInput('projectBuildSuitePath',sourcePath);await click(asNew?'projectBuildSuiteSaveAs':'projectBuildSuiteSave');
    const saved=await until(async()=>{const c=await catalog();return c?.documents.find(d=>d.path===sourcePath);},`registered ${sourcePath}`);
    await until(()=>cdp.evaluate(`document.getElementById('projectBuildSuiteSelect').value===${JSON.stringify(saved.id)}&&!document.getElementById('projectBuildSuiteLoad').disabled`),'author suite save UI unlocked');
    assert.equal(saved.valid,true);authorDocuments.push(saved);return saved;
  }
  async function loadSuite(documentId) {
    await until(()=>existsEnabled('projectBuildSuiteSelect'),'suite selector unlocked');
    await cdp.evaluate(`(()=>{const e=document.getElementById('projectBuildSuiteSelect');e.value=${JSON.stringify(documentId)};e.dispatchEvent(new Event('change',{bubbles:true}));window.confirm=()=>true;})()`);
    await click('projectBuildSuiteLoad');
    await until(()=>existsEnabled('projectBuildSuiteRun'),'saved suite loaded and eligible');
  }
  await click('modeEditBtn');
  await until(()=>cdp.evaluate("document.getElementById('modeEditBtn').getAttribute('aria-pressed')==='true'||document.getElementById('modeEditBtn').classList.contains('mode-btn-active')"),'edit mode');
  await click('projectBuildBtn');await until(()=>cdp.evaluate("document.getElementById('projectBuildDialog').open"),'workbench');
  await run('projectBuildPlan','plan');await run('projectBuildGenerate','build');await run('projectBuildControl','run');
  await until(()=>existsEnabled('projectBuildCaseGenerate'),'complete control baseline eligible');
  await cdp.evaluate("document.getElementById('projectBuildCaseEditor').open=true");await click('projectBuildCaseGenerate');
  const baseline = await cdp.evaluate("JSON.parse(document.getElementById('projectBuildCaseProgram').value)");
  assert.equal(baseline.format,'viento-runtime-case');assert.equal(baseline.checks.length,2);
  await click('projectBuildCaseDocumentRefresh');await until(()=>existsEnabled('projectBuildCaseDocumentNew'),'case library ready');
  const passA=await saveCase(baseline,'documents/runtime-cases/pass-a.json');
  const failedDefinition=structuredClone(baseline);failedDefinition.checks[0].position.value[0]+=1;
  const failB=await saveCase(failedDefinition,'documents/runtime-cases/fail-b.json');
  const passC=await saveCase(baseline,'documents/runtime-cases/pass-c.json');
  await cdp.evaluate("document.getElementById('projectBuildSuiteEditor').open=true");await click('projectBuildSuiteRefresh');
  await until(()=>cdp.evaluate("document.querySelectorAll('#projectBuildSuiteCases input').length===3"),'three registered member choices');
  for(const member of [failB,passC,passA])await toggle(member.id);
  const ordered=[failB.id,passC.id,passA.id];assert.deepEqual(await selectedMembers(),ordered);
  const primary=await saveSuite('documents/runtime-suites/ordered.json');
  const primaryPath=path.join(h.workspace,primary.path),primaryBytes=await fs.readFile(primaryPath,'utf8'),suiteDefinition=JSON.parse(primaryBytes);
  assert.deepEqual(suiteDefinition,{format:'viento-runtime-case-suite',schemaVersion:1,sceneObjectId:sceneId,documentIds:ordered});
  assert.ok(!ordered.includes(primary.id));assert.equal(new Set(authorDocuments.map(d=>d.id)).size,4);
  report.scenarios.push({name:'explicit three-member order and independent author UUID registration',documentId:primary.id,memberIds:ordered});

  // Confirm only after deliberately changing local membership; decline must
  // preserve both draft membership and an independently edited path/caret.
  await toggle(passA.id);await setInput('projectBuildSuitePath','documents/runtime-suites/draft-copy.json');
  await cdp.evaluate("document.getElementById('projectBuildSuitePath').setSelectionRange(10,17);window.confirm=()=>false");
  const declinedDraft=await suiteDraft();await click('projectBuildSuiteLoad');await delay(120);
  assert.deepEqual(await suiteDraft(),declinedDraft);assert.equal(await cdp.evaluate("document.getElementById('projectBuildSuiteRun').disabled"),true);
  await loadSuite(primary.id);assert.deepEqual(await selectedMembers(),ordered);
  const raw='\uFEFF'+JSON.stringify(suiteDefinition,null,'\t').replaceAll('\n','\r\n')+'\r\n';
  await fs.writeFile(primaryPath,raw);await click('projectBuildSuiteRefresh');await loadSuite(primary.id);
  await click('projectBuildSuiteSave');await until(()=>existsEnabled('projectBuildSuiteRun'),'unchanged raw save settled');
  assert.equal(await fs.readFile(primaryPath,'utf8'),raw);
  await toggle(passA.id);const conflictDraft=await suiteDraft();await fs.writeFile(primaryPath,raw+' ');
  await click('projectBuildSuiteSave');await until(()=>cdp.evaluate("!document.getElementById('projectBuildSuiteError').hidden"),'external group CAS conflict');
  assert.deepEqual(await suiteDraft(),conflictDraft);assert.equal(await fs.readFile(primaryPath,'utf8'),raw+' ');
  const copy=await saveSuite('documents/runtime-suites/copy.json',true);
  const copyBytes=await fs.readFile(path.join(h.workspace,copy.path),'utf8');assert.deepEqual(JSON.parse(copyBytes).documentIds,[failB.id,passC.id]);
  assert.notEqual(copy.id,primary.id);
  report.scenarios.push({name:'declined overwrite, unchanged BOM/CRLF save, document conflict and explicit save-as',originalDocumentId:primary.id,copyDocumentId:copy.id,rawBytesPreserved:true});

  const scenePath=path.join(h.workspace,(await state()).scenes.find(s=>s.id===sceneId).sourcePath),sceneBytes=await fs.readFile(scenePath);
  await fs.writeFile(scenePath,Buffer.concat([sceneBytes,Buffer.from(' ')]));await click('projectBuildSuiteRefresh');
  const sceneConflictDraft=await suiteDraft();await click('projectBuildSuiteSave');
  await until(()=>cdp.evaluate("document.getElementById('projectBuildSuiteError').textContent.includes('场景原文已变化')"),'refresh does not promote loaded scene CAS');
  assert.deepEqual(await suiteDraft(),sceneConflictDraft);assert.equal(await fs.readFile(path.join(h.workspace,copy.path),'utf8'),copyBytes);
  await fs.writeFile(scenePath,sceneBytes);await click('projectBuildSuiteRefresh');await loadSuite(primary.id);
  report.scenarios.push({name:'source scene CAS remains loaded baseline after explicit catalog refresh',sceneOriginalBytesRestored:true});

  const batch=await run('projectBuildSuiteRun','suite');
  assert.deepEqual(batch.job.suite.entries.map(e=>e.documentId),ordered);
  assert.deepEqual(batch.job.suite.entries.map(e=>e.state),['failed','passed','passed']);
  assert.deepEqual(batch.job.suite.entries.map(e=>e.executionStatus),['succeeded','succeeded','succeeded']);
  assert.equal(batch.job.suite.summary.status,'failed');assert.equal(batch.job.suite.summary.complete,true);
  assert.equal(new Set(batch.job.suite.entries.map(e=>e.sessionId)).size,3);
  await until(()=>cdp.evaluate("!document.getElementById('projectBuildSuiteResult').hidden&&document.getElementById('projectBuildSuiteEntries').children.length===3"),'UI observes full host batch');
  assert.equal(await cdp.evaluate("document.getElementById('projectBuildCaseResult').hidden"),true);
  assert.equal(await cdp.evaluate("document.getElementById('projectBuildCaseGenerate').disabled"),true);
  report.scenarios.push({name:'real Godot assertion failure continues subsequent members',jobId:batch.job.id,states:batch.job.suite.entries.map(e=>e.state),executionStatuses:batch.job.suite.entries.map(e=>e.executionStatus)});

  // The suite result and author member/path draft survive rendering in all
  // languages, an ordinary status poll and closing/reopening the workbench.
  await cdp.evaluate("document.getElementById('projectBuildSuitePath').setSelectionRange(9,15)");const languageDraft=await suiteDraft();
  for(const locale of ['zh-CN','en','ja']) {
    await cdp.evaluate(`import('/web/i18n/index.js').then(m=>m.applyLanguage('${locale}'))`);
    await cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await cdp.evaluate("document.getElementById('projectBuildSuiteSave').scrollIntoView({block:'center'})");
    const layout=await cdp.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,dialog:[...document.querySelectorAll('dialog')].filter(d=>d.open).map(d=>({width:d.clientWidth,scroll:d.scrollWidth})),save:document.getElementById('projectBuildSuiteSave').textContent,load:document.getElementById('projectBuildSuiteLoad').textContent,run:document.getElementById('projectBuildSuiteRun').textContent,status:document.getElementById('projectBuildSuiteStatus').textContent,summary:document.getElementById('projectBuildSuiteSummary').textContent})");
    assert.ok(layout.scroll<=layout.width);assert.ok(layout.dialog.every(d=>d.scroll<=d.width));assert.deepEqual(await suiteDraft(),languageDraft);
    if(locale!=='zh-CN'){assert.notEqual(layout.save,'保存验收组');assert.notEqual(layout.load,'载入验收组');assert.notEqual(layout.run,'运行已保存验收组');assert.ok(!layout.status.startsWith('已载入'));assert.ok(!layout.summary.includes('批量验收未通过'));}
    const screenshot=await cdp.call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(evidence,`${locale}-390.png`),Buffer.from(screenshot.data,'base64'));report.locales.push({locale,...layout});
  }
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:820,deviceScaleFactor:1,mobile:false});
  await click('projectBuildClose');await click('projectBuildBtn');await until(()=>cdp.evaluate("document.getElementById('projectBuildDialog').open"),'reopened suite workbench');
  assert.deepEqual(await suiteDraft(),languageDraft);
  report.scenarios.push({name:'three languages at 390 px, member order and path caret preserved across poll and reopen'});

  // A separate long released program has a genuine runtime sample prefix.
  // It is an explicit new author document; existing expectations are unchanged.
  await cdp.evaluate("document.getElementById('projectBuildCaseEditor').open=true");
  const released={up:false,down:false,left:false,right:false};
  const longDefinition={format:'viento-runtime-case',schemaVersion:1,program:{format:'viento-scene-control',schemaVersion:1,fixedDelta:0.125,steps:Array.from({length:64},()=>({...released}))},checks:[{instanceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',stepIndex:63,position:{value:[200,220],tolerance:0.0001},state:'idle'}]};
  const longCase=await saveCase(longDefinition,'documents/runtime-cases/long-released.json');
  await click('projectBuildSuiteNew');await click('projectBuildSuiteRefresh');for(const id of await selectedMembers())await toggle(id);
  await toggle(longCase.id);await toggle(passA.id);const cancellationGroup=await saveSuite('documents/runtime-suites/cancel.json');
  const oldJob=(await state()).job.id;await click('projectBuildSuiteRun');
  const running=await until(async()=>{const s=await state();return s.job?.id!==oldJob&&s.job?.kind==='suite'&&s.job.status==='running'&&s.job.suite.entries[0].state==='running'&&s.job.control?.samples?.length>0?s:null;},'active Godot suite real trace prefix');
  await until(()=>existsEnabled('projectBuildCancel'),'host-owned cancel available');
  assert.equal(await cdp.evaluate("document.getElementById('projectBuildSuiteSave').disabled&&document.getElementById('projectBuildCaseRun').disabled"),true);
  await click('projectBuildCancel');
  const cancelled=await until(async()=>{const s=await state();return s.job?.id===running.job.id&&s.job.status!=='running'?s:null;},'cancelled Godot batch terminal');
  assert.equal(cancelled.job.status,'cancelled');assert.deepEqual(cancelled.job.suite.entries.map(e=>e.state),['incomplete','not-run']);assert.equal(cancelled.job.suite.entries[1].sessionId,null);
  assert.equal(cancelled.job.suite.summary.status,'incomplete');jobs.push(cancelled.job);
  report.scenarios.push({name:'real Godot cancellation after trace sample stops remaining member',documentId:cancellationGroup.id,jobId:cancelled.job.id,sampledPrefix:running.job.control.samples.length,states:cancelled.job.suite.entries.map(e=>e.state)});

  // New batch admission needs fresh author inputs. Existing frozen artifact
  // remains observable while the source catalog is offline.
  await fs.rename(h.workspace,h.workspace+'-offline');await delay(3100);
  assert.equal((await state()).catalogDiagnostic?.code,'build_catalog_unavailable');
  await until(()=>cdp.evaluate("document.getElementById('projectBuildSuiteRun').disabled&&document.getElementById('projectBuildSuiteSave').disabled"),'offline suite admission and write blocked');
  const denied=await api({action:'suite-run',buildId:cancelled.job.buildId,suiteDocumentId:cancellationGroup.id,expectedVersion:cancellationGroup.version});
  assert.ok(denied.status>=400);assert.equal((await state()).job.id,cancelled.job.id);assert.ok((await api({action:'suite-list',sceneId})).status>=400);
  await fs.rename(h.workspace+'-offline',h.workspace);await cdp.evaluate("fetch('/api/project-build?refresh=1').then(r=>r.json())");
  await until(async()=>!(await state()).catalogDiagnostic,'author catalog restored');
  report.scenarios.push({name:'offline source rejects new author reads/writes/batch admission without allocating a job',status:denied.status,retainedJobId:cancelled.job.id});

  await click('projectBuildClose');await cdp.evaluate("document.querySelector('.doc-item[data-path]').click()");
  await click('docEditBtn');await until(()=>cdp.evaluate("!document.getElementById('docSourceEditor').disabled&&document.getElementById('docSourceEditor').value.length>0"),'author source loaded');
  const authorDraft=await cdp.evaluate("(()=>{const e=document.getElementById('docSourceEditor');e.value+='\\nunsaved author suite';e.dispatchEvent(new Event('input',{bubbles:true}));e.setSelectionRange(5,9);return {value:e.value,start:e.selectionStart,end:e.selectionEnd};})()");
  await click('projectBuildBtn');await until(()=>cdp.evaluate("document.getElementById('projectBuildDialog').open"),'dirty author workbench');
  assert.equal(await cdp.evaluate("document.getElementById('projectBuildSuiteSave').disabled&&document.getElementById('projectBuildSuiteRun').disabled"),true);
  await click('projectBuildClose');assert.deepEqual(await cdp.evaluate("(()=>{const e=document.getElementById('docSourceEditor');return {value:e.value,start:e.selectionStart,end:e.selectionEnd};})()"),authorDraft);
  const after=await authors(h.workspace);for(const [file,sha]of Object.entries(h.before))assert.equal(after[file],sha,file);
  assert.equal(authorDocuments.length,7);assert.equal(new Set(authorDocuments.map(d=>d.id)).size,7);assert.equal(Object.keys(after).length,Object.keys(h.before).length+14);assert.deepEqual(report.errors,[]);
  report.scenarios.push({name:'dirty author draft and caret survive workbench with suite write/run disabled'});
  report.jobs=jobs;assert.equal(new Set(jobs.map(j=>j.id)).size,jobs.length);
  report.authorDocuments=authorDocuments;report.originalAuthorFiles=Object.keys(h.before).length;report.newRegisteredDocuments=7;report.newAuthorAndMetadataFiles=14;
  report.originalAuthorBytesUnchanged=true;report.draftAndCaretPreserved=true;report.ok=true;
} catch (error) {
  report.failure=error.message;
  if(cdp)try {report.failureState=await cdp.evaluate("(async()=>({body:document.body.innerText.slice(-18000),state:await fetch('/api/project-build').then(r=>r.json()),suiteRun:document.getElementById('projectBuildSuiteRun')?.outerHTML,suiteStatus:document.getElementById('projectBuildSuiteStatus')?.textContent,suiteError:document.getElementById('projectBuildSuiteError')?.textContent}))()");}catch { /* Preserve the first acceptance failure. */ }
  throw error;
} finally {
  for(const socket of connections)socket.close();
  for(const child of children.reverse()){
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);
    try{await child.done;}finally{clearTimeout(timer);}
  }
  await fs.rm(base,{recursive:true,force:true});report.finishedAt=new Date().toISOString();report.temporaryDirectoriesRemoved=true;
  const reportPath=path.join(evidence,'browser.json');try{const previous=JSON.parse(await fs.readFile(reportPath,'utf8'));if(!previous.ok){await fs.copyFile(reportPath,path.join(evidence,'browser-initial.json'),1).catch(()=>{});}}catch{/* First recording. */}
  await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({ok:report.ok,browser:report.browser,scenarios:report.scenarios.length,locales:report.locales.length,jobs:report.jobs?.length,errors:report.errors.length}));
