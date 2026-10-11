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
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.env.VIENTO_BACKEND_PROJECT_CATALOG_UI_OUTPUT || path.join(os.tmpdir(), `viento-backend-project-catalog-ui-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Use an empty output directory; old evidence is immutable.');
const configurations = [
  { id: 'org.viento.godot4', example: 'scene2d', tool: process.env.VIENTO_GODOT_BIN, key: 'VIENTO_GODOT_BIN', expectedKind: 'godot-project' },
  { id: 'org.viento.bevy', example: 'bevy-headless', tool: process.env.VIENTO_BEVY_BIN, key: 'VIENTO_BEVY_BIN', expectedKind: 'bevy-scene' },
];
for (const configuration of configurations) if (!configuration.tool || !path.isAbsolute(configuration.tool)) throw new Error(`Set ${configuration.key} to an existing absolute trusted tool.`);
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], jobs: [], projects: [], layout: {}, errors: [], limitations: [
  'Actual source HTTP editor, host restart with identical root/cache, existing trusted Godot/Bevy binaries, and persistent project catalog. No Cargo/native build, fake backend, installed Tauri or Android device.',
  'Timing gates delay actual select HTTP responses only, after host verification/selection; no manifest, tool, service restart or selected target is mocked.',
  'Screenshots cover visible portions of the structured details. Complete inventories are asserted by DOM and actual service payload, not by screenshot alone.',
] };
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


  for (const configuration of configurations) {
    const root = path.join(temporary, configuration.example);
    await fs.cp(path.join(appRoot, 'examples', configuration.example), root, { recursive: true });
    const secondSceneId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const firstRecordPath = path.join(root, 'metadata/documents/dddddddd-dddd-4ddd-8ddd-dddddddddddd.json');
    const record = JSON.parse(await fs.readFile(firstRecordPath)); record.id = secondSceneId; record.sourcePath = 'documents/scenes/second.json';
    const scene = JSON.parse(await fs.readFile(path.join(root, 'documents/scenes/demo.json'))); scene.title = 'Second scene / 別シーン';
    await fs.writeFile(path.join(root, 'documents/scenes/second.json'), JSON.stringify(scene, null, 2) + '\n');
    await fs.writeFile(path.join(root, `metadata/documents/${secondSceneId}.json`), JSON.stringify(record, null, 2) + '\n');
    const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root, VIENTO_EXECUTION_BACKEND: configuration.id,
      XDG_CACHE_HOME: path.join(temporary, `cache-${configuration.example}`), [configuration.key]: configuration.tool };
    delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
    await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
    const before = await sourceTree(root);
    let stop, base;
    const start = async () => { base = await serve({ after: callback => { stop = callback; cleanups.push(callback); } }, appRoot, env); };
    await start();
    const state = async () => { const response = await fetch(`${base}/api/project-build`); assert.equal(response.status, 200); const body = await response.json(); return body.data || body; };
    const complete = async (kind, previousId) => {
      let job;
      await wait(async () => { job = (await state()).job; return job?.kind === kind && job.id !== previousId && job.status !== 'running'; }, `${configuration.id} ${kind}`, 90000);
      assert.equal(job.status, 'succeeded', JSON.stringify(job)); report.jobs.push({ backendId: configuration.id, id: job.id, kind: job.kind, status: job.status }); return job;
    };
    const navigate = async () => {
      await call('Emulation.clearDeviceMetricsOverride'); await call('Page.navigate', { url: `${base}/web/?mode=edit` });
      await wait(() => evaluate(`document.readyState==='complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable && document.querySelector('#projectBuildBtn')?.hidden===false`), 'editor ready');
      await evaluate(`(() => { const original=window.fetch.bind(window); window.__projectCatalogRequests=[]; window.fetch=async (input,init)=>{
        const response=await original(input,init);let body;try{body=JSON.parse(init?.body||'null')}catch{}
        if(['select-project','inspect-project'].includes(body?.action)){const value=await response.clone().json();window.__projectCatalogRequests.push({body,payload:value.data||value});
          if(body.action==='select-project'&&window.__holdProjectSelect)await new Promise(resolve=>{window.__releaseProjectSelect=resolve;});}
        return response;
      }; })()`);
      await click('#projectBuildBtn'); await enabled('#projectBuildRefresh');
    };
    captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,reads:window.__projectCatalogRequests})`); report.serviceFailure = await state(); };
    await navigate(); await enabled('#projectBuildPlan');
    const selectedSceneId = await evaluate(`document.querySelector('#projectBuildScene').value`);
    const buildOnce = async previous => {
      await click('#projectBuildPlan'); const plan = await complete('plan', previous);
      await enabled('#projectBuildGenerate'); await click('#projectBuildGenerate'); const built = await complete('build', plan.id);
      await enabled('#backendProjectInspect'); return built;
    };
    const first = await buildOnce(), firstBuildId = (await state()).latestBuild.id;
    const last = configuration.id === 'org.viento.godot4' ? await buildOnce(first.id) : first;
    const lastBuildId = (await state()).latestBuild.id;
    await click('#projectBuildClose'); await stop(); await start(); await navigate();
    const restored = await state();
    assert.equal(restored.latestBuild, null); assert.equal(restored.projectManagement.scope, 'host-catalog');
    assert.ok(restored.projects.some(row => row.id === firstBuildId && row.origin === 'previous-session' && row.availability === 'unchecked'));
    assert.equal(await evaluate(`document.querySelector('#projectBuildHeadless').disabled`), true);
    await fill('#backendProjectSelect', firstBuildId); await click('#backendProjectInspect');
    await wait(() => evaluate(`document.querySelector('#backendProjectContent').textContent.includes(${JSON.stringify(firstBuildId)})&&document.querySelector('#backendProjectError').hidden`), 'restored project detail');
    assert.equal((await state()).latestBuild, null);
    const detail = await evaluate(`window.__projectCatalogRequests.at(-1).payload`); assert.equal(detail.inspection.complete,true);
    assert.equal(detail.project.project.kind,configuration.expectedKind);
    report.projects.push({backendId:configuration.id,buildId:firstBuildId,manifest:detail.project,inspection:detail.inspection});
    report.steps.push(`${configuration.id}: real host restart restores unchecked historical entries; inspection remains readonly and does not authorize running.`);
    await enabled('#backendProjectActivate'); await click('#backendProjectActivate');
    await wait(() => evaluate(`document.querySelector('#backendProjectRuntime').textContent.includes(${JSON.stringify(firstBuildId)})&&document.querySelector('#projectBuildHeadless').disabled===false`),'explicit project selected');
    assert.equal((await state()).latestBuild.id,firstBuildId);
    await click('#projectBuildHeadless'); const run=await complete('run');assert.equal(run.buildId,firstBuildId);
    report.steps.push(`${configuration.id}: explicit selection verifies frozen identity without starting a tool, then the existing headless Run targets this historical build.`);
    if(configuration.id==='org.viento.godot4') {
      // The selected target remains firstBuildId while the other historical project is merely inspected.
      await enabled('#backendProjectInspect'); await fill('#backendProjectSelect',lastBuildId); await click('#backendProjectInspect');
      await wait(()=>evaluate(`document.querySelector('#backendProjectContent').textContent.includes(${JSON.stringify(lastBuildId)})`),'other historical detail');
      assert.equal((await state()).latestBuild.id,firstBuildId);
      for(const language of ['zh-CN','en','ja']) {
        await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
        await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
        await evaluate(`document.querySelector('#backendProjectPanel').scrollIntoView({block:'start'})`);
        const layout=await evaluate(`(()=>{const dialog=document.querySelector('#projectBuildDialog'),button=document.querySelector('#backendProjectActivate').getBoundingClientRect();return{noHorizontalOverflow:dialog.scrollWidth<=dialog.clientWidth,selectVisible:button.top>=0&&button.bottom<=innerHeight,button:document.querySelector('#backendProjectActivate').textContent,origin:document.querySelector('#backendProjectOrigin').textContent,runtime:document.querySelector('#backendProjectRuntime').textContent,option:document.querySelector('#backendProjectSelect').selectedOptions[0].textContent}})()`);
        assert.equal(layout.noHorizontalOverflow,true);assert.equal(layout.selectVisible,true);
        assert.equal(layout.button,{'zh-CN':'设为运行工程',en:'Use for running',ja:'実行プロジェクトに設定'}[language]);
        assert.ok(layout.runtime.includes(firstBuildId));assert.ok(layout.option.includes({'zh-CN':'历史工程',en:'Previous project',ja:'履歴プロジェクト'}[language]));
        report.layout[language]=layout;await screenshot(`catalog-narrow-${language}.png`);
      }
      report.steps.push('Chinese, English and Japanese 390px catalog views identify history and the actual run target separately; explicit selection is visible without horizontal overflow.');
      // Actual host selects lastBuildId; delay only delivery. Parent close/reopen must recover it by GET, without resubmitting.
      await evaluate(`window.__holdProjectSelect=true`);await click('#backendProjectActivate');
      await wait(()=>evaluate(`typeof window.__releaseProjectSelect==='function'`),'actual select response gate');
      assert.equal((await state()).latestBuild.id,lastBuildId);
      await click('#projectBuildClose');await click('#projectBuildBtn');await enabled('#projectBuildRefresh');
      await wait(()=>evaluate(`document.querySelector('#backendProjectRuntime').textContent.includes(${JSON.stringify(lastBuildId)})`),'reopened GET target');
      await evaluate(`(()=>{window.__holdProjectSelect=false;window.__releaseProjectSelect();delete window.__releaseProjectSelect})()`);await delay(250);
      assert.equal(await evaluate(`document.querySelector('#backendProjectDetails').hidden`),true);
      // A forced refresh also rejects an older in-flight mutation receipt and keeps its verified GET target.
      await fill('#backendProjectSelect',firstBuildId);await evaluate(`window.__holdProjectSelect=true`);await click('#backendProjectActivate');
      await wait(()=>evaluate(`typeof window.__releaseProjectSelect==='function'`),'second select gate');await click('#projectBuildRefresh');
      await wait(()=>evaluate(`document.querySelector('#backendProjectRuntime').textContent.includes(${JSON.stringify(firstBuildId)})`),'refreshed GET target');
      await evaluate(`(()=>{window.__holdProjectSelect=false;window.__releaseProjectSelect();delete window.__releaseProjectSelect})()`);await delay(250);
      assert.equal(await evaluate(`document.querySelector('#backendProjectDetails').hidden`),true);
      report.steps.push('Delayed actual selection responses after close/reopen or forced refresh cannot overwrite the current owner; GET recovers the host-selected target without a repeated mutation.');
      // The same service can run frozen data after author files go offline; no new plan or build is admitted.
      await enabled('#projectBuildRefresh');
      const moved=path.join(temporary,'author-offline');await fs.rename(root,moved);
      try {
        await click('#projectBuildRefresh');await wait(()=>evaluate(`document.querySelector('#projectBuildPlan').disabled&&document.querySelector('#projectBuildCatalogDiagnostic').hidden===false`),'offline author diagnostic and blocked plan');
        assert.equal((await state()).catalogDiagnostic.code,'build_catalog_unavailable');
        assert.equal(await evaluate(`document.querySelector('#projectBuildEditScene').disabled`),true);
        assert.equal(await evaluate(`document.querySelector('#projectBuildGenerate').disabled`),true);
        assert.equal(await evaluate(`document.querySelector('#projectBuildHeadless').disabled`),false);
        await click('#projectBuildHeadless');const offline=await complete('run',run.id);assert.equal(offline.buildId,firstBuildId);
        report.steps.push('Actual author-directory outage shows the author-offline diagnostic and retains historical Run; plan/build remain blocked and no author files are recreated.');
      } catch(error) {report.offlineFailure={service:await state(),page:await evaluate(`({text:document.querySelector('#projectBuildDialog').innerText,refreshDisabled:document.querySelector('#projectBuildRefresh').disabled,planDisabled:document.querySelector('#projectBuildPlan').disabled})`)};throw error;} finally {await fs.rename(moved,root);}
    } else {
      assert.equal(detail.project.files.length,1);assert.equal(detail.project.project.kind,'bevy-scene');
      await enabled('#backendProjectInspect');await click('#backendProjectInspect');
      await wait(()=>evaluate(`document.querySelector('#backendProjectContent').textContent.includes('Cargo')`),'Bevy detail reopened after selecting and running');
      await evaluate(`document.querySelector('#backendProjectPanel').scrollIntoView({block:'start'})`);await screenshot('catalog-bevy-data.png');
      assert.ok(await evaluate(`document.querySelector('#backendProjectContent').textContent.includes('Cargo')`));
      report.steps.push('The restored Bevy project remains an explicit scene-data bundle backed by its trusted runtime; the UI does not claim an author Cargo project or standalone game.');
    }
    await click('#projectBuildClose');assert.deepEqual(await sourceTree(root),before);await stop();
  }
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
