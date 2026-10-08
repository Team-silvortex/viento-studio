// Isolated real Chrome/HTTP member-report acceptance; requires VIENTO_GODOT_BIN.
// It never uses an installed app/profile or an Android device.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { validateRuntimeCaseReport } from '../../../engine/runtime-case-report.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./browser/', import.meta.url));
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-runtime-case-reports-browser-'));
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
      else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) (report.httpErrors ||= []).push({url:message.params.response.url,status:message.params.response.status});
      else if (message.method === 'Network.loadingFailed') (report.networkFailures ||= []).push({type:message.params.type,errorText:message.params.errorText});
      else if (message.method === 'Log.entryAdded' && message.params.entry.level==='error') (report.consoleErrors ||= []).push(message.params.entry.text);
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
  await cdp.call('Runtime.enable'); await cdp.call('Page.enable'); await cdp.call('Network.enable'); await cdp.call('Log.enable');
  report.browser = (await cdp.call('Browser.getVersion')).product;
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 820, deviceScaleFactor: 1, mobile: false });


  assert.ok(process.env.VIENTO_GODOT_BIN,'Set VIENTO_GODOT_BIN to the actual trusted Godot executable.');
  const h=await host('godot-case-reports','org.viento.godot4',process.env.VIENTO_GODOT_BIN),sceneId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const jobs=[],documents=[],downloads=[];report.executionBackend=h.backendId;report.sourceHashes={};
  report.layoutCorrection={initialEvidence:'browser-initial/browser.json',finding:'The first passing functional run exposed an English heading squeezed by the Close button at 390 px.',remedy:'A CSS-only narrow-screen rule gives the detail heading its own full row; all original JSON, screenshots and downloaded reports remain in browser-initial.',productScope:'No JavaScript or test changes.'};
  for(const file of ['web/modules/app-runtime-case-report.js','web/modules/app-runtime-case-suites.js','web/modules/app-project-build.js','web/project-build.css','web/i18n/en.js','web/i18n/ja.js','engine/runtime-case-report.mjs','scripts/lib/project-build-service.mjs','scripts/lib/runtime-case-reports.mjs','scripts/adapters/node-runtime-case-suite.mjs'])report.sourceHashes[file]=hash(await fs.readFile(path.join(root,file)));
  const downloadRoot=path.join(base,'downloads');await fs.mkdir(downloadRoot);
  await cdp.call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadRoot,eventsEnabled:true});
  await cdp.call('Page.navigate',{url:h.url});
  const step=name=>console.log(JSON.stringify({step:name}));
  const enabled=id=>cdp.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});return Boolean(e&&!e.hidden&&!e.disabled&&e.getClientRects().length)})()`);
  const click=async id=>{await until(()=>enabled(id),`${id} visible and enabled`);await cdp.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);};
  const setInput=async(id,value)=>cdp.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const state=async()=>(await cdp.evaluate("fetch('/api/project-build').then(r=>r.json())")).data;
  const api=body=>cdp.evaluate(`fetch('/api/project-build',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(async r=>({status:r.status,...await r.json()}))`);
  const cases=async()=>(await api({action:'case-list',sceneId})).data;
  const suites=async()=>(await api({action:'suite-list',sceneId})).data;
  const coreText=()=>cdp.evaluate("(()=>{const e=document.getElementById('projectBuildCaseProgram');return {value:e.value,start:e.selectionStart,end:e.selectionEnd}})()");
  const selectedMembers=()=>cdp.evaluate("[...document.querySelectorAll('#projectBuildSuiteCases input:checked')].map(e=>e.dataset.documentId)");
  const toggle=async id=>{await until(()=>cdp.evaluate(`Boolean(document.querySelector('#projectBuildSuiteCases input[data-document-id="${id}"]')&&!document.querySelector('#projectBuildSuiteCases input[data-document-id="${id}"]').disabled)`),'member selection enabled');await cdp.evaluate(`document.querySelector('#projectBuildSuiteCases input[data-document-id="${id}"]').click()`);};
  const inspect=async id=>{await until(()=>cdp.evaluate(`Boolean(document.querySelector('#projectBuildSuiteEntries button[data-document-id="${id}"]')&&!document.querySelector('#projectBuildSuiteEntries button[data-document-id="${id}"]').disabled)`),'member report available');await cdp.evaluate(`document.querySelector('#projectBuildSuiteEntries button[data-document-id="${id}"]').click()`);await until(()=>enabled('projectBuildCaseReportExport'),'validated member report');};
  async function run(id,kind){const old=(await state()).job?.id;await click(id);const result=await until(async()=>{const s=await state();return s.job?.id!==old&&s.job.kind===kind&&s.job.status!=='running'?s:null;},`${kind} new terminal task`,45000);assert.equal(result.job.status,'succeeded');jobs.push(result.job);return result;}
  async function saveCase(definition,sourcePath){await click('projectBuildCaseDocumentNew');await setInput('projectBuildCaseProgram',JSON.stringify(definition,null,2));await setInput('projectBuildCaseDocumentPath',sourcePath);await click('projectBuildCaseDocumentSave');const saved=await until(async()=>{const c=await cases();return c?.documents.find(d=>d.path===sourcePath);},'case registered');await until(()=>cdp.evaluate(`document.getElementById('projectBuildCaseDocumentSelect').value===${JSON.stringify(saved.id)}&&!document.getElementById('projectBuildCaseDocumentLoad').disabled`),'case save response adopted');assert.equal(saved.valid,true);documents.push(saved);return saved;}
  async function saveSuite(sourcePath){await setInput('projectBuildSuitePath',sourcePath);await click('projectBuildSuiteSave');const saved=await until(async()=>{const c=await suites();return c?.documents.find(d=>d.path===sourcePath);},'suite registered');await until(()=>cdp.evaluate(`document.getElementById('projectBuildSuiteSelect').value===${JSON.stringify(saved.id)}&&!document.getElementById('projectBuildSuiteLoad').disabled`),'suite save response adopted');assert.equal(saved.valid,true);documents.push(saved);return saved;}
  async function receipt(job,documentId){const result=await api({action:'suite-report',jobId:job.id,documentId});assert.equal(result.status,200);return validateRuntimeCaseReport(result.data);}
  async function download(expected,name){const file=path.join(downloadRoot,`runtime-case-report-${expected.context.documentId}.json`);await click('projectBuildCaseReportExport');await until(async()=>{try{return(await fs.stat(file)).isFile();}catch{return false;}},'explicit Blob report download');const bytes=await fs.readFile(file),value=validateRuntimeCaseReport(JSON.parse(bytes));assert.deepEqual(value,expected);assert.equal(bytes.toString('utf8'),JSON.stringify(value)+'\n');await fs.mkdir(path.join(evidence,'downloads'),{recursive:true});await fs.writeFile(path.join(evidence,'downloads',name),bytes);downloads.push({name,documentId:value.context.documentId,sessionId:value.context.sessionId,executionStatus:value.executionStatus,evaluationStatus:value.evaluation.status,sampleCount:value.samples.length,checkCount:value.evaluation.checkCount,sha256:hash(bytes),bytes:bytes.length,compact:true,validated:true});return value;}

  await until(()=>cdp.evaluate("Boolean(document.getElementById('modeEditBtn')&&!document.getElementById('modeEditBtn').disabled&&document.getElementById('projectBuildBtn')&&!document.getElementById('projectBuildBtn').hidden&&document.querySelector('.doc-item[data-path]'))"),'editor initialized with build capability');
  await click('modeEditBtn');await until(()=>cdp.evaluate("document.getElementById('modeEditBtn').classList.contains('mode-btn-active')"),'editor mode');await click('projectBuildBtn');
  await run('projectBuildPlan','plan');await run('projectBuildGenerate','build');await run('projectBuildControl','run');
  await cdp.evaluate("document.getElementById('projectBuildCaseEditor').open=true");await click('projectBuildCaseGenerate');
  const baseline=await cdp.evaluate("JSON.parse(document.getElementById('projectBuildCaseProgram').value)"),controlText=await cdp.evaluate("document.getElementById('projectBuildControlProgram').value");
  await click('projectBuildCaseDocumentRefresh');const failure=structuredClone(baseline);failure.checks[0].position.value[0]+=1;
  const failedCase=await saveCase(failure,'documents/runtime-cases/first-fails.json'),passedCase=await saveCase(baseline,'documents/runtime-cases/last-passes.json');
  await cdp.evaluate("document.getElementById('projectBuildSuiteEditor').open=true");await click('projectBuildSuiteRefresh');await toggle(failedCase.id);await toggle(passedCase.id);
  const group=await saveSuite('documents/runtime-suites/member-details.json');const batch=(await run('projectBuildSuiteRun','suite')).job;
  assert.deepEqual(batch.suite.entries.map(e=>e.state),['failed','passed']);assert.ok(batch.suite.entries.every(e=>e.reportAvailable===true));
  // Terminal API observation does not imply the parent UI has polled it yet.
  await until(()=>enabled('projectBuildSuiteRun'),'parent GUI adopts terminal batch');step('real Godot batch terminal');
  const failedReport=await receipt(batch,failedCase.id);assert.equal(failedReport.evaluation.status,'failed');assert.equal(failedReport.context.sessionId,batch.suite.entries[0].sessionId);
  assert.notEqual(failedReport.context.sessionId,batch.suite.entries[1].sessionId);
  await cdp.evaluate("document.getElementById('projectBuildCaseProgram').setSelectionRange(9,15)");const caseDraft=await coreText();
  assert.deepEqual(await fs.readdir(downloadRoot),[]);await inspect(failedCase.id);
  assert.ok(await cdp.evaluate(`document.getElementById('projectBuildCaseReportContext').textContent.includes(${JSON.stringify(failedCase.id)})`));
  assert.ok(await cdp.evaluate("document.getElementById('projectBuildCaseReportStatus').textContent.includes('验收未通过')"));
  assert.ok(await cdp.evaluate("document.getElementById('projectBuildCaseReportChecks').textContent.includes('每轴容差')"));
  assert.deepEqual(await coreText(),caseDraft);assert.deepEqual(await fs.readdir(downloadRoot),[]);await download(failedReport,'failed-member.json');
  report.scenarios.push({name:'inspect failed first member after passed last member and explicitly download its actual JSON',jobId:batch.id,documentId:failedCase.id,sessionId:failedReport.context.sessionId});step('failed member report and download');

  // Delay only delivery of an actual HTTP response, never fabricate its data.
  await cdp.evaluate("window.__reportOriginalFetch=window.fetch;window.__reportGate={held:false,enabled:true};window.fetch=async(...args)=>{const response=await window.__reportOriginalFetch(...args);let action;try{action=JSON.parse(args[1]?.body||'{}').action}catch{};if(action==='suite-report'&&window.__reportGate.enabled){window.__reportGate.enabled=false;window.__reportGate.held=true;return await new Promise(resolve=>window.__reportGate.release=()=>resolve(response))}return response};");
  await cdp.evaluate(`document.querySelector('#projectBuildSuiteEntries button[data-document-id="${failedCase.id}"]').click()`);await until(()=>cdp.evaluate("window.__reportGate.held"),'actual report HTTP response held');
  await click('projectBuildCaseReportClose');await inspect(passedCase.id);
  await cdp.evaluate("window.__reportGate.release();window.fetch=window.__reportOriginalFetch;delete window.__reportOriginalFetch");await delay(120);
  assert.ok(await cdp.evaluate(`document.getElementById('projectBuildCaseReportContext').textContent.includes(${JSON.stringify(passedCase.id)})`));
  assert.ok(await cdp.evaluate("document.getElementById('projectBuildCaseReportStatus').textContent.includes('验收通过')"));assert.deepEqual(await coreText(),caseDraft);
  assert.equal((await fs.readdir(downloadRoot)).length,1);report.scenarios.push({name:'late actual member response after detail close cannot replace a newer member'});step('late report response discarded');
  await inspect(failedCase.id);
  for(const locale of ['zh-CN','en','ja']){
    await cdp.evaluate(`import('/web/i18n/index.js').then(m=>m.applyLanguage('${locale}'))`);await cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await cdp.evaluate("document.getElementById('projectBuildCaseReportTitle').scrollIntoView({block:'start'})");
    const layout=await cdp.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,dialogs:[...document.querySelectorAll('dialog')].filter(d=>d.open).map(d=>({width:d.clientWidth,scroll:d.scrollWidth})),title:document.getElementById('projectBuildCaseReportTitle').textContent,exportLabel:document.getElementById('projectBuildCaseReportExport').textContent,status:document.getElementById('projectBuildCaseReportStatus').textContent,checks:document.getElementById('projectBuildCaseReportChecks').innerText})");
    assert.ok(layout.scroll<=layout.width);assert.ok(layout.dialogs.every(d=>d.scroll<=d.width));assert.deepEqual(await coreText(),caseDraft);
    if(locale!=='zh-CN'){assert.notEqual(layout.title,'用例验收详情');assert.notEqual(layout.exportLabel,'导出用例报告 JSON');assert.ok(!layout.status.includes('执行：'));assert.ok(!layout.checks.includes('每轴容差'));}
    const image=await cdp.call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(evidence,`${locale}-390.png`),Buffer.from(image.data,'base64'));report.locales.push({locale,...layout});
  }
  report.scenarios.push({name:'three languages at 390 px show execution, check values, tolerance and member details without changing the core case'});step('three translated narrow layouts');
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:820,deviceScaleFactor:1,mobile:false});

  const released={up:false,down:false,left:false,right:false},longDefinition={format:baseline.format,schemaVersion:1,
    program:{format:baseline.program.format,schemaVersion:1,fixedDelta:0.125,steps:Array.from({length:64},()=>({...released}))},
    checks:[{instanceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',stepIndex:63,position:{value:[200,220],tolerance:0.0001},state:'idle'}]};
  const longCase=await saveCase(longDefinition,'documents/runtime-cases/cancelled-prefix.json');await click('projectBuildSuiteNew');await click('projectBuildSuiteRefresh');for(const id of await selectedMembers())await toggle(id);await toggle(longCase.id);await toggle(passedCase.id);
  const cancelGroup=await saveSuite('documents/runtime-suites/cancelled-details.json');const oldJob=(await state()).job.id;await click('projectBuildSuiteRun');
  await until(()=>cdp.evaluate("document.getElementById('projectBuildCaseReportPanel').hidden&&document.getElementById('projectBuildCaseReportExport').disabled"),'new job clears old report');
  const running=await until(async()=>{const s=await state();return s.job?.id!==oldJob&&s.job.kind==='suite'&&s.job.status==='running'&&s.job.control?.samples?.length>0?s:null;},'actual Godot sample prefix');
  await click('projectBuildCancel');const cancelled=await until(async()=>{const s=await state();return s.job.id===running.job.id&&s.job.status!=='running'?s.job:null;},'cancelled suite terminal');
  assert.equal(cancelled.status,'cancelled');assert.deepEqual(cancelled.suite.entries.map(e=>e.state),['incomplete','not-run']);assert.equal(cancelled.suite.entries[0].reportAvailable,true);assert.equal(cancelled.suite.entries[1].reportAvailable,false);jobs.push(cancelled);
  await until(()=>enabled('projectBuildSuiteRun'),'GUI adopts cancelled job');await inspect(longCase.id);const cancelledReport=await receipt(cancelled,longCase.id);
  assert.equal(cancelledReport.executionStatus,'cancelled');assert.equal(cancelledReport.evaluation.status,'incomplete');assert.ok(cancelledReport.samples.length>0);
  assert.equal(await cdp.evaluate(`document.querySelector('#projectBuildSuiteEntries button[data-document-id="${passedCase.id}"]').disabled`),true);
  const notRun=await api({action:'suite-report',jobId:cancelled.id,documentId:passedCase.id});assert.equal(notRun.status,409);
  const prior=await api({action:'suite-report',jobId:batch.id,documentId:failedCase.id});assert.equal(prior.status,404);
  report.scenarios.push({name:'cancelled member exposes actual incomplete prefix, unstarted and prior-job members are unavailable',jobId:cancelled.id,prefixSamples:cancelledReport.samples.length,notRunStatus:notRun.status,priorJobStatus:prior.status});step('cancelled prefix report, prior-job and not-run guards');

  await fs.rename(h.workspace,h.workspace+'-offline');await delay(3100);await click('projectBuildRefresh');
  await until(()=>cdp.evaluate("document.getElementById('projectBuildCatalogDiagnostic').hidden===false"),'GUI knows author source is offline');
  await inspect(longCase.id);assert.deepEqual(await receipt(cancelled,longCase.id),cancelledReport);await download(cancelledReport,'cancelled-member.json');
  assert.equal((await state()).job.id,cancelled.id);assert.equal(await cdp.evaluate("document.getElementById('projectBuildSuiteRun').disabled"),true);
  await fs.rename(h.workspace+'-offline',h.workspace);await click('projectBuildRefresh');await until(()=>cdp.evaluate("document.getElementById('projectBuildCatalogDiagnostic').hidden"),'restored author source observed');
  report.scenarios.push({name:'source-offline detail and explicit JSON download use frozen current member without another engine task',documentId:longCase.id});step('offline current report and download');

  await click('projectBuildClose');await cdp.evaluate("document.querySelector('.doc-item[data-path]').click()");await click('docEditBtn');await until(()=>cdp.evaluate("!document.getElementById('docSourceEditor').disabled&&document.getElementById('docSourceEditor').value.length>0"),'author source editor');
  const authorDraft=await cdp.evaluate("(()=>{const e=document.getElementById('docSourceEditor');e.value+='\\nunsaved report author';e.dispatchEvent(new Event('input',{bubbles:true}));e.setSelectionRange(5,9);return {value:e.value,start:e.selectionStart,end:e.selectionEnd}})()");
  await click('projectBuildBtn');await inspect(longCase.id);assert.equal(await cdp.evaluate("document.getElementById('projectBuildSuiteRun').disabled&&document.getElementById('projectBuildSuiteSave').disabled"),true);
  await click('projectBuildCaseReportClose');await click('projectBuildClose');assert.deepEqual(await cdp.evaluate("(()=>{const e=document.getElementById('docSourceEditor');return {value:e.value,start:e.selectionStart,end:e.selectionEnd}})()"),authorDraft);
  assert.equal(await cdp.evaluate("document.getElementById('projectBuildControlProgram').value"),controlText);
  const after=await authors(h.workspace);for(const[file,sha]of Object.entries(h.before))assert.equal(after[file],sha,file);assert.equal(documents.length,5);assert.equal(new Set(documents.map(d=>d.id)).size,5);assert.equal(Object.keys(after).length,Object.keys(h.before).length+10);assert.deepEqual(report.errors,[]);
  report.scenarios.push({name:'dirty author draft and caret survive readonly member detail with writes and new batch disabled'});
  report.jobs=jobs;assert.equal(new Set(jobs.map(job=>job.id)).size,jobs.length);report.downloads=downloads;report.downloadsValidated=downloads.length;
  report.authorDocuments=documents;report.originalAuthorFiles=Object.keys(h.before).length;report.newRegisteredDocuments=5;report.newAuthorAndMetadataFiles=10;
  report.cancelledSampleObservation={sampleCount:cancelledReport.samples.length,programStepCount:cancelledReport.definition.program.steps.length,evaluationComplete:cancelledReport.evaluation.complete,note:'Cancellation was observed after a real prefix was captured. In this run that prefix contains all steps; execution and verification remain cancelled/incomplete, rather than claiming a truncated trace.'};
  report.originalAuthorBytesUnchanged=true;report.draftAndCaretPreserved=true;report.httpDiagnosticsNote='Expected current-job/not-run API errors and missing demo preview thumbnails are recorded. No zero-HTTP-error claim is made.';report.ok=true;
}catch(error){
  report.failure=error.message;if(cdp)try{report.failureState=await cdp.evaluate("(async()=>({body:document.body.innerText.slice(-18000),state:await fetch('/api/project-build').then(r=>r.json()),reportExport:document.getElementById('projectBuildCaseReportExport')?.outerHTML,reportStatus:document.getElementById('projectBuildCaseReportStatus')?.textContent,reportError:document.getElementById('projectBuildCaseReportError')?.textContent}))()");}catch{/*Preserve first failure.*/}throw error;
}finally{
  for(const socket of connections)socket.close();for(const child of children.reverse()){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);try{await child.done;}finally{clearTimeout(timer);}}
  await fs.rm(base,{recursive:true,force:true});report.finishedAt=new Date().toISOString();report.temporaryDirectoriesRemoved=true;
  const reportPath=path.join(evidence,'browser.json');try{const previous=JSON.parse(await fs.readFile(reportPath,'utf8'));if(!previous.ok)await fs.copyFile(reportPath,path.join(evidence,'browser-initial.json'),1).catch(()=>{});}catch{/*First recording.*/}
  await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({ok:report.ok,browser:report.browser,scenarios:report.scenarios.length,locales:report.locales.length,jobs:report.jobs?.length,downloads:report.downloadsValidated,errors:report.errors.length}));
