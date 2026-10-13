// Actual Chrome + HTTP editor + existing trusted Godot and Bevy tools.
// Read-response gates below control timing only; no tool/manifest is mocked.
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
import { verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.env.VIENTO_BACKEND_PROJECT_DELIVERY_OUTPUT || path.join(os.tmpdir(), `viento-backend-project-delivery-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Use an empty output directory; old evidence is immutable.');
const configurations = [
  { id: 'org.viento.godot4', example: 'scene2d', tool: process.env.VIENTO_GODOT_BIN, key: 'VIENTO_GODOT_BIN', expectedKind: 'godot-project' },
];
for (const configuration of configurations) if (!configuration.tool || !path.isAbsolute(configuration.tool)) throw new Error(`Set ${configuration.key} to an existing absolute trusted tool.`);
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], jobs: [], projects: [], layout: {}, errors: [], limitations: ['Actual Chrome and local HTTP editor with installed Godot. Scene2D example, not a test of authoring every upstream setting/projection.', 'Desktop save is covered by controller event tests, not an installed Tauri native picker; Bevy delivery by fixture-backed Node tests, not real runtime execution.']  };
const cleanups = [], fixture = { after: callback => cleanups.push(callback) };
let socket, captureFailure;
const wait = async (check, label, milliseconds = 45000) => {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) { if (await check()) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
};
async function sourceTree(root) {
  const hashes = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name), name = path.relative(root, file);
    if (!name.startsWith('.viento/')) hashes[name] = buildHash(await fs.readFile(file));
  }
  return hashes;
}
try {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-backend-project-catalog-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const profile = path.join(temporary, 'chrome'); await fs.mkdir(profile);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; } });
  let port;
  await wait(async () => { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return Boolean(port); } catch { return false; } }, 'Chrome');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(value => value.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const pending = new Map(); let sequence = 0;
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.id) { const request = pending.get(value.id); pending.delete(value.id); value.error ? request?.reject(new Error(value.error.message)) : request?.resolve(value.result); }
    else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const value = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
    if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails)); return value.result.value;
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value) => evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === false && !document.querySelector(${JSON.stringify(selector)}).hidden`), `${selector} enabled`);
  const screenshot = async name => { const result = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(result.data, 'base64')); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;



  const configuration = configurations[0], root=path.join(temporary,'author'), download=path.join(temporary,'download');
  await fs.mkdir(download);await fs.cp(path.join(appRoot,'examples/scene2d'),root,{recursive:true});
  const env={...process.env,VIENTO_APP_ROOT:appRoot,VIENTO_WORKSPACE_ROOT:root,VIENTO_GODOT_BIN:configuration.tool,
    VIENTO_EXECUTION_BACKEND:configuration.id,XDG_CACHE_HOME:path.join(temporary,'cache'),XDG_CONFIG_HOME:path.join(temporary,'config')};
  delete env.VIENTO_SESSION_TOKEN;delete env.VIENTO_PREFERENCES_PATH;
  await runCommand(process.execPath,[path.join(appRoot,'scripts/ops/rebuild.mjs')],{cwd:appRoot,env});
  const before=await sourceTree(root),base=await serve(fixture,appRoot,env);
  const state=async()=>{const body=await fetch(`${base}/api/project-build`).then(r=>r.json());return body.data||body;};
  captureFailure=async()=>{await screenshot('failure.png');report.pageFailure=await evaluate(`document.body.innerText`);report.serviceFailure=await state();};
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:download,eventsEnabled:true});
  await call('Page.navigate',{url:`${base}/web/?mode=edit`});
  await wait(()=>evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable&&document.querySelector('#projectBuildBtn')?.hidden===false`),'editor');
  await evaluate(`(()=>{window.__deliveries=[];const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const response=await original(input,init);let body;try{body=JSON.parse(init?.body||'null')}catch{};if(body?.kind==='backend-project'){const v=await response.clone().json();window.__deliveries.push(v.data||v)}return response;};})()`);
  await click('#projectBuildBtn'); await enabled('#projectBuildPlan');await click('#projectBuildPlan');
  await wait(async()=>{const job=(await state()).job;return job?.kind==='plan'&&job.status!=='running';},'plan');
  await enabled('#projectBuildGenerate');await click('#projectBuildGenerate');
  let built;await wait(async()=>{built=(await state()).job;return built?.kind==='build'&&built.status!=='running';},'build',90000);assert.equal(built.status,'succeeded',JSON.stringify(built));
  await enabled('#backendProjectInspect');await click('#backendProjectInspect');await enabled('#backendProjectDeliver');await click('#backendProjectDeliver');
  assert.equal(await evaluate(`document.querySelector('#backendDeliveryDialog').open`),true);
  for(const language of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    const layout=await evaluate(`(()=>{const d=document.querySelector('#backendDeliveryDialog'),b=document.querySelector('#backendDeliveryPrepare').getBoundingClientRect();return {noHorizontalOverflow:d.scrollWidth<=d.clientWidth,prepareVisible:b.top>=0&&b.bottom<=innerHeight,label:document.querySelector('#backendDeliveryPrepare').textContent};})()`);
    assert.equal(layout.noHorizontalOverflow,true);assert.equal(layout.prepareVisible,true);report.layout[language]=layout;await screenshot(`delivery-${language}.png`);
  }
  await click('#backendDeliveryPrepare');await enabled('#backendDeliveryDownload');
  const receipt=await evaluate(`window.__deliveries.at(-1)`);assert.equal(receipt.delivery.project.project.kind,'godot-project');
  await click('#backendDeliveryDownload');await wait(()=>evaluate(`document.querySelector('#backendDeliveryDownload').disabled===false`),'download dispatched');
  await click('#backendDeliveryClose');
  const archive=path.join(download,receipt.fileName);await wait(async()=>{try{return (await fs.stat(archive)).size===receipt.bytes}catch{return false}},'actual browser download');
  const verified=await verifyBackendProjectDelivery(archive);assert.equal(verified.delivery.project.buildId,receipt.delivery.project.buildId);
  const testZip=await runCommand('unzip',['-t',archive],{cwd:temporary});assert.equal(testZip.code,0,JSON.stringify(testZip));
  const extracted=path.join(temporary,'delivered');await fs.mkdir(extracted);await runCommand('unzip',['-q',archive,'-d',extracted],{cwd:temporary});
  const imported=await runCommand(configuration.tool,['--headless','--editor','--path',path.join(extracted,'project'),'--import','--quit'],{cwd:temporary,env:{...process.env,HOME:path.join(temporary,'godot-home')}});
  assert.equal(imported.code,0,JSON.stringify(imported));assert.ok(!/SCRIPT ERROR|Parse Error/.test(imported.stdout+imported.stderr));
  report.delivery={id:receipt.id,bytes:receipt.bytes,fileName:receipt.fileName,buildId:receipt.delivery.project.buildId,fileCount:verified.fileCount,sha256:buildHash(await fs.readFile(archive)),godotImport:{code:imported.code,stdout:imported.stdout,stderr:imported.stderr}};
  report.steps.push('Real Scene2D Godot build → read-only inspection → delivery review → ZIP preparation → browser download → close → independent verification → unzip test → relocated Godot import.');
  report.steps.push('Chinese/English/Japanese review at 390px: no horizontal overflow, preparation action stays visible.');
  const forbidden=await fetch(`${base}/api/export`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.invalid'},body:JSON.stringify({kind:'backend-project',buildId:receipt.delivery.project.buildId,expectedSnapshotId:receipt.delivery.project.snapshotId,expectedManifestSha256:receipt.delivery.manifestSha256})});assert.equal(forbidden.status,403);
  await fetch(`${base}/api/export`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'release',id:receipt.id})});
  assert.equal((await fetch(`${base}/api/export?id=${receipt.id}`)).status,410);
  await click('#projectBuildClose');assert.deepEqual(await sourceTree(root),before);
  report.steps.push('Cross-origin preparation rejected; explicit release expires download; original author files unchanged.');
  assert.deepEqual(report.errors, []); report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  try { await captureFailure?.(); } catch (failure) { report.captureFailure = failure.message; }
} finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, steps: report.steps, output, failure: report.failure, limitations: report.limitations }, null, 2));
}
