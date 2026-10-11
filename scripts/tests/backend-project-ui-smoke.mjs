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
const output = path.resolve(process.env.VIENTO_BACKEND_PROJECT_UI_OUTPUT || path.join(os.tmpdir(), `viento-backend-project-ui-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Use an empty output directory; old evidence is immutable.');
const configurations = [
  { id: 'org.viento.godot4', example: 'scene2d', tool: process.env.VIENTO_GODOT_BIN, key: 'VIENTO_GODOT_BIN', expectedKind: 'godot-project' },
  { id: 'org.viento.bevy', example: 'bevy-headless', tool: process.env.VIENTO_BEVY_BIN, key: 'VIENTO_BEVY_BIN', expectedKind: 'bevy-scene' },
];
for (const configuration of configurations) if (!configuration.tool || !path.isAbsolute(configuration.tool)) throw new Error(`Set ${configuration.key} to an existing absolute trusted tool.`);
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], jobs: [], projects: [], layout: {}, errors: [], limitations: [
  'Actual source HTTP editor, existing trusted Godot/Bevy binaries, and new read-only project manifests. No Cargo/native build, fake backend, installed Tauri or Android device.',
  'Timing gates delay actual inspect HTTP responses only, to verify detached UI ownership; generated manifests and files are not mocked.',
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-backend-project-browser-'));
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
    const before = await sourceTree(root), base = await serve(fixture, appRoot, env);
    const state = async () => { const response = await fetch(`${base}/api/project-build`); assert.equal(response.status, 200); const body = await response.json(); return body.data || body; };
    const complete = async (kind, previousId) => {
      let job;
      await wait(async () => { job = (await state()).job; return job?.kind === kind && job.id !== previousId && job.status !== 'running'; }, `${configuration.id} ${kind}`, 90000);
      assert.equal(job.status, 'succeeded', JSON.stringify(job)); report.jobs.push({ backendId: configuration.id, id: job.id, kind: job.kind, status: job.status }); return job;
    };
    captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText, reads:window.__backendProjectReads})`); report.serviceFailure = await state(); };
    await call('Emulation.clearDeviceMetricsOverride'); await call('Page.navigate', { url: `${base}/web/?mode=edit` });
    await wait(() => evaluate(`document.readyState==='complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable && document.querySelector('#projectBuildBtn')?.hidden===false`), 'editor ready');
    await evaluate(`(() => { const original=window.fetch.bind(window); window.__backendProjectReads=[]; window.fetch=async (input,init)=>{
      const response=await original(input,init); let body; try{body=JSON.parse(init?.body||'null')}catch{}
      if(body?.action==='inspect-project'){const value=await response.clone().json();window.__backendProjectReads.push({body,payload:value.data||value});
        if(window.__holdBackendProjectRead) await new Promise(resolve=>{window.__releaseBackendProjectRead=resolve;});}
      return response;
    }; })()`);
    await click('#projectBuildBtn'); await enabled('#projectBuildPlan');
    const catalog = await state(); assert.equal(catalog.backend.id, configuration.id); assert.equal(catalog.scenes.length, 2);
    const selectedSceneId = await evaluate(`document.querySelector('#projectBuildScene').value`);
    const buildOnce = async previous => {
      await click('#projectBuildPlan'); const plan = await complete('plan', previous);
      await enabled('#projectBuildGenerate'); await click('#projectBuildGenerate'); const built = await complete('build', plan.id);
      await enabled('#backendProjectInspect'); return built;
    };
    const first = await buildOnce(), firstBuildId = (await state()).latestBuild.id;
    const last = configuration.id === 'org.viento.godot4' ? await buildOnce(first.id) : first;
    const latestBuildId = (await state()).latestBuild.id;
    await fill('#backendProjectSelect', firstBuildId); await click('#backendProjectInspect');
    await wait(() => evaluate(`document.querySelector('#backendProjectContent').textContent.includes(${JSON.stringify(firstBuildId)}) && document.querySelector('#backendProjectError').hidden`), 'project details');
    const inspected = await evaluate(`window.__backendProjectReads.at(-1)`); const project = inspected.payload.project;
    assert.deepEqual(inspected.body, { action: 'inspect-project', buildId: firstBuildId });
    assert.equal(project.project.kind, configuration.expectedKind); assert.equal(project.source.sceneId, selectedSceneId);
    assert.equal(inspected.payload.inspection.complete, true); assert.equal(inspected.payload.inspection.recorded, true);
    assert.ok(inspected.payload.buildDirectory.includes(configuration.id)); assert.equal((await state()).latestBuild.id, latestBuildId); assert.equal((await state()).job.id, last.id);
    const inventory = await evaluate(`({files:[...document.querySelector('#backendProjectFiles').children].map(item=>item.dataset.generatedPath),resources:[...document.querySelector('#backendProjectResources').children].map(item=>item.dataset.resourceId),evidence:[...document.querySelector('#backendProjectEvidence').children].map(item=>item.dataset.evidencePath),text:document.querySelector('#backendProjectContent').textContent})`);
    assert.deepEqual(inventory.files, project.files.map(file => file.path)); assert.deepEqual(inventory.resources, project.resources.map(file => file.resourceId));
    assert.deepEqual(inventory.evidence, project.evidence.map(file => file.path)); assert.ok(inventory.text.includes(project.tool.version)); assert.ok(inventory.text.includes(project.tool.sha256));
    assert.ok(!inventory.text.includes(configuration.tool)); report.projects.push({ backendId: configuration.id, project, inspection: inspected.payload.inspection, buildDirectory: inspected.payload.buildDirectory });
    report.steps.push(`${configuration.id}: real plan/build then complete frozen source, generated-file and tool/adapter details; historical selection preserves latest run ownership.`);

    if (configuration.id === 'org.viento.godot4') {
      for (const language of ['zh-CN', 'en', 'ja']) {
        await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
        await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
        await evaluate(`document.querySelector('#backendProjectDetails').scrollIntoView({block:'start'})`);
        const layout = await evaluate(`(() => {const dialog=document.querySelector('#projectBuildDialog'),close=document.querySelector('#backendProjectClose').getBoundingClientRect();return {title:document.querySelector('#backendProjectDetailsTitle').textContent,noHorizontalOverflow:dialog.scrollWidth<=dialog.clientWidth,closeVisible:close.top>=0&&close.bottom<=innerHeight,sourceLiteral:document.querySelector('#backendProjectContent').textContent.includes(${JSON.stringify(project.source.sourcePath)})}})()`);
        assert.equal(layout.noHorizontalOverflow, true); assert.equal(layout.closeVisible, true); assert.equal(layout.sourceLiteral, true);
        assert.equal(layout.title, { 'zh-CN': '后端工程详情', en: 'Backend project details', ja: 'バックエンドプロジェクトの詳細' }[language]);
        report.layout[language] = layout; await screenshot(`project-narrow-${language}.png`);
      }
      report.steps.push('Chinese, English and Japanese structured project details fit 390px; visible close controls and literal source identities remain available.');
      await evaluate(`window.__holdBackendProjectRead=true`); await click('#backendProjectClose'); await click('#backendProjectInspect');
      await wait(() => evaluate(`typeof window.__releaseBackendProjectRead==='function'`), 'actual response gate');
      await click('#projectBuildClose'); await click('#projectBuildBtn'); await enabled('#projectBuildRefresh');
      await evaluate(`(() => {window.__holdBackendProjectRead=false;window.__releaseBackendProjectRead();delete window.__releaseBackendProjectRead})()`); await delay(300);
      assert.equal(await evaluate(`document.querySelector('#backendProjectDetails').hidden`), true);
      await evaluate(`window.__holdBackendProjectRead=true`); await click('#backendProjectInspect');
      await wait(() => evaluate(`typeof window.__releaseBackendProjectRead==='function'`), 'second actual response gate');
      await fill('#projectBuildScene', selectedSceneId === secondSceneId ? 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' : secondSceneId);
      await evaluate(`(() => {window.__holdBackendProjectRead=false;window.__releaseBackendProjectRead();delete window.__releaseBackendProjectRead})()`); await delay(300);
      assert.equal(await evaluate(`document.querySelector('#backendProjectDetails').hidden`), true); assert.equal(await evaluate(`document.querySelector('#backendProjectPanel').hidden`), true);
      assert.equal((await state()).latestBuild.id, latestBuildId); assert.equal((await state()).job.id, last.id);
      report.steps.push('Close/reopen and scene switching discard delayed real inspect responses without new jobs, author writes, or a change to the latest successful build.');
    } else {
      assert.ok(inventory.text.includes('Cargo') || inventory.text.includes('データ'));
      assert.equal(project.files.length, 1); assert.equal(project.resources.length, 0);
      await screenshot('project-bevy-data.png');
      report.steps.push('Actual Bevy data project exposes scene-data.json and the locked trusted runtime; no Cargo author project, asset copy or standalone game is implied.');
    }
    await click('#projectBuildClose'); assert.deepEqual(await sourceTree(root), before);
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
