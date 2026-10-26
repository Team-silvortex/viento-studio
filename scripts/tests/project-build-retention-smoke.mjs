// Actual Chrome + current HTTP editor; synthetic status responses only.
// No Godot/Bevy runtime is executed. This checks raw-retention UI, not host retention or project event ledgers.
// Run: node scripts/tests/project-build-retention-smoke.mjs [/absolute/chrome]
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.env.VIENTO_BUILD_RETENTION_OUTPUT || path.join(os.tmpdir(), `viento-build-retention-ui-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty output directory; prior evidence is immutable.');
const cleanups = [], fixture = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', kind: 'synthetic-raw-job-ui', observations: [], errors: [], limitations: [
  'Actual Chrome renders the current editor over local HTTP. Build status GET/cancel responses are synthetic browser fixtures, not Godot or Bevy execution.',
  '1200 synthetic raw event summaries and synthetic log lines are reduced to 128 records and 32768 UTF-16 code units before display. Host retention is tested separately.',
  'These raw summaries are not the validated project event ledger. No claim of complete runtime observation, installed Tauri or Android verification.',
] };
let socket, captureFailure;
const wait = async (check, label, milliseconds = 20000) => {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) { if (await check()) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
};
try {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-build-retention-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'workspace');
  await fs.cp(path.join(appRoot, 'examples/scene2d'), root, { recursive: true });
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root, XDG_CACHE_HOME: path.join(temporary, 'cache') };
  for (const key of ['VIENTO_SESSION_TOKEN', 'VIENTO_PREFERENCES_PATH', 'VIENTO_GODOT_BIN', 'VIENTO_BEVY_BIN']) delete env[key];
  await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
  const base = await serve(fixture, appRoot, env);
  const profile = path.join(temporary, 'chrome'); await fs.mkdir(profile);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; } });
  let port;
  await wait(async () => { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return Boolean(port); } catch { return false; } }, 'Chrome');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const pending = new Map(); let sequence = 0;
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.id) { const request = pending.get(value.id); pending.delete(value.id); value.error ? request?.reject(new Error(value.error.message)) : request?.resolve(value.result); }
    else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 20000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const screenshot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(image.data, 'base64')); };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({ text: document.body.innerText, requests: window.__retentionRequests })`); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const backendId = 'org.viento.godot4';
    const events = Array.from({length:1200}, (_,index) => ({ event:'fixture', sequence:index+1, text:'Synthetic raw event <img src=x onerror=window.retentionInjected=true>' }));
    const logs = events.map(event => 'Synthetic raw log '+event.sequence+' 🌀 <script>window.retentionInjected=true</script>\\n').join('');
    window.__retentionRequests=[];
    window.__retentionFixture={ supported:true, available:true, reason:null, platform:'linux', latestBuild:null,
      scenes:[{id:'synthetic-scene', title:'Synthetic raw-job fixture', sourcePath:'synthetic.json'}],
      backend:{format:'viento-execution-backend',schemaVersion:1,id:backendId,version:'0.2.0',label:'Synthetic UI fixture — no runtime execution',platforms:['linux'],
        plans:[{kind:'scene2d',schemaVersion:1,runtimeProtocolVersion:1}],capabilities:['scene2d'],extensions:[],
        execution:{build:true,headlessLogic:true,windowPreview:true,windowCapture:false,offscreenRender:false,embeddedViewport:false,gpuCompute:false}},
      job:{id:'synthetic-run-1200',backendId,kind:'run',sceneId:'synthetic-scene',status:'running',phase:'running',diagnostics:[],events:events.slice(-128),logs:logs.slice(-32768),
        retention:{logs:{unit:'utf16-code-units',limit:32768,total:logs.length,retained:32768,dropped:logs.length-32768},events:{unit:'records',limit:128,total:1200,retained:128,dropped:1072}}}};
    const original=window.fetch.bind(window);
    window.fetch=async (input,options={}) => {
      const pathname=new URL(typeof input==='string'?input:input.url,location.href).pathname;
      if(pathname!=='/api/project-build') return original(input,options);
      const body=JSON.parse(options.body||'null'); window.__retentionRequests.push({method:options.method||'GET',body});
      if(body?.action==='cancel') { window.__retentionFixture.job.status='cancelled';window.__retentionFixture.job.phase='completed'; }
      else if(body) throw new Error('Unexpected synthetic fixture mutation: '+body.action);
      return new Response(JSON.stringify(window.__retentionFixture), {status:200,headers:{'Content-Type':'application/json'}});
    };
  })();` });
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState==='complete' && document.querySelector('#projectBuildBtn')?.hidden===false`), 'editor ready');
  await click('#projectBuildBtn');
  await wait(() => evaluate(`document.querySelector('#projectBuildEventRetention')?.textContent.includes('1200')`), 'synthetic retained events');
  await evaluate(`(() => { document.querySelector('#projectBuildRaw').open=true; window.__retentionLogNode=document.querySelector('#projectBuildLogs'); document.querySelector('#projectBuildLogs').focus(); })()`);
  const pollStart = await evaluate('window.__retentionRequests.length');
  await wait(() => evaluate(`window.__retentionRequests.length>${pollStart}`), 'real controller polling');
  assert.equal(await evaluate(`document.activeElement===window.__retentionLogNode`), true, 'polling retains log focus');
  report.pollFocusPreserved = true;
  const expected = { 'zh-CN': { raw: /原始事件摘要.*不是项目事件账本/, status: { running: '进行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' } },
    en: { raw: /Raw event summaries.*not the project event ledger/, status: { running: 'Running', succeeded: 'Completed', failed: 'Failed', cancelled: 'Cancelled' } },
    ja: { raw: /元のイベント要約.*プロジェクトイベント台帳とは別/, status: { running: '実行中', succeeded: '完了', failed: '失敗', cancelled: 'キャンセル' } } };
  for (const [language, labels] of Object.entries(expected)) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate(`document.activeElement===window.__retentionLogNode`), true, 'language switch retains log focus');
    for (const status of ['running', 'succeeded', 'failed', 'cancelled']) {
      await evaluate(`(() => { window.__retentionFixture.job.status=${JSON.stringify(status)};window.__retentionFixture.job.phase=${JSON.stringify(status==='running'?'running':'completed')}; document.querySelector('#projectBuildRefresh').click(); })()`);
      await wait(() => evaluate(`document.querySelector('#projectBuildStatus').textContent.includes(${JSON.stringify(labels.status[status])})`), `${language} ${status}`);
      const observation = await evaluate(`(() => { const dialog=document.querySelector('#projectBuildDialog'), logs=document.querySelector('#projectBuildLogs'), raw=document.querySelector('#projectBuildRaw');
        return { status:document.querySelector('#projectBuildStatus').textContent, logs:document.querySelector('#projectBuildLogRetention').textContent,
          events:document.querySelector('#projectBuildEventRetention').textContent, summary:document.querySelector('#projectBuildEvents').textContent,
          fits:dialog.scrollWidth<=dialog.clientWidth, labelsFit:['projectBuildLogRetention','projectBuildEventRetention'].every(id=>{const node=document.getElementById(id);return node.scrollWidth<=node.clientWidth && !node.hidden}),
          focus:document.activeElement===window.__retentionLogNode, stableNode:logs===window.__retentionLogNode, expanded:raw.open,
          injected:Boolean(window.retentionInjected)||logs.children.length>0, error:!document.querySelector('#projectBuildError').hidden,
          retainedEvents:(logs.textContent.match(/"sequence":/g)||[]).length, first:logs.textContent.includes('"sequence":1073'),last:logs.textContent.includes('"sequence":1200')}; })()`);
      assert.match(observation.events, labels.raw); assert.ok(observation.events.includes('128') && observation.events.includes('1200') && observation.events.includes('1072'));
      assert.ok(observation.logs.includes('32768') && observation.logs.includes('UTF-16'));
      for (const key of ['fits','labelsFit','focus','stableNode','expanded','first','last']) assert.equal(observation[key],true,`${language} ${status}: ${key}`);
      assert.equal(observation.injected,false); assert.equal(observation.error,false); assert.equal(observation.retainedEvents,128);
      assert.doesNotMatch(observation.summary,/完整|full content|全文/);
      await evaluate(`document.querySelector('#projectBuildLogRetention').scrollIntoView({block:'start'})`);
      const file = `${status}-${language}-390.png`; await screenshot(file);
      report.observations.push({ language, status, viewport: {width:390,height:844}, screenshot:file, ...observation });
    }
  }
  await evaluate(`(() => { delete window.__retentionFixture.job.retention; document.querySelector('#projectBuildRefresh').click(); })()`);
  await wait(() => evaluate(`document.querySelector('#projectBuildEventRetention').textContent.includes('保持情報を取得できません')`), 'legacy host fallback');
  const unavailable = await evaluate(`({logs:document.querySelector('#projectBuildLogRetention').textContent,events:document.querySelector('#projectBuildEventRetention').textContent,focus:document.activeElement===window.__retentionLogNode})`);
  assert.equal(unavailable.focus,true); assert.doesNotMatch(unavailable.logs+unavailable.events,/1200|32768|1072/); report.legacy = unavailable;
  await evaluate(`(() => { window.__retentionFixture.job.retention={logs:{total:'<img src=x onerror=window.retentionInjected=true>'},events:{unit:'records',limit:128,total:1200,retained:128,dropped:-1}};document.querySelector('#projectBuildRefresh').click(); })()`);
  await delay(200);
  assert.equal(await evaluate(`document.querySelector('#projectBuildEventRetention').textContent.includes('保持情報を取得できません')&&!window.retentionInjected`),true);
  report.invalidMetadataFallback = true;
  assert.ok((await evaluate('window.__retentionRequests')).every(request=>request.body===null), 'smoke performs no real or synthetic job start');
  assert.deepEqual(report.errors, []); report.ok=true;
} catch(error) {
  report.ok=false;report.failure=error.stack;process.exitCode=1;
  try { await captureFailure?.(); } catch(captureError) { report.captureFailure=captureError.message; }
} finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch(error) {report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}
  report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ok:report.ok,browser:report.browser,observations:report.observations.length,limitations:report.limitations,failure:report.failure,output},null,2));
}
