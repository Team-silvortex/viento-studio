// Real saved Scene2D per-instance preview; disposable source and new evidence only.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-animation-instance-preview');
const output = path.resolve(process.env.VIENTO_ANIMATION_INSTANCE_PREVIEW_OUTPUT
  || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep) || !path.basename(output).startsWith('browser-')) {
  throw Error('Use a new scene-animation-instance-preview/browser-* evidence directory.');
}
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Evidence must be new.');
const report = {
  startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], layout: {}, limitations: [
    'Real Chrome with local HTTP authoring preview in a disposable copied example; no packaged Tauri, Android or engine-runtime claim.',
    'Only saved Scene2D graphical tracks are previewed. State scripts, events, behavior, physics and audio are not executed.',
    'Background visibility and cancelled animation callbacks are explicitly injected to exercise stale browser callback guards; normal playback uses real requestAnimationFrame.',
    'Refresh replaces the captured preview owner while the saved source remains identical; no author edit is needed to invalidate old callbacks.',
  ],
};
const sources = [
  'engine/studio-core.wasm', 'engine/scene-animation-core.mjs', 'engine/scene-animation-preview.mjs',
  'engine/scene-animation-instance-playback.mjs', 'engine/scene-animation-instance-visual-frame.mjs',
  'engine/scene-animation-visual-frame.mjs', 'scripts/lib/scene-preview-service.mjs',
  'scripts/adapters/node-build-snapshot.mjs', 'scripts/lib/doc-api-service.mjs',
  'web/modules/app-scene-preview-animation.js', 'web/modules/app-scene-preview-instance-animation.js',
  'web/modules/app-scene-preview.js', 'web/modules/app-scene-preview-canvas.js',
  'web/modules/scene-animation-player.js', 'web/modules/app-project-build.js',
  'web/modules/app-studio-system.js', 'web/i18n/en.js', 'web/i18n/ja.js', 'web/scene-preview.css',
  'scripts/tests/scene-animation-instance-preview-smoke.mjs',
];
report.sources = Object.fromEntries(await Promise.all(sources.map(async name => [name,
  buildHash(await fs.readFile(path.join(appRoot, name)))])));
report.node = { version: process.version, sha256: buildHash(await fs.readFile(process.execPath)) };
const cleanups = [], fixture = { after: callback => cleanups.push(callback) };
const wait = async (check, label, budget = 45000) => {
  for (let elapsed = 0; elapsed < budget; elapsed += 100) {
    if (await check()) return;
    await delay(100);
  }
  throw Error('Timed out: ' + label);
};
async function authorTree(root) {
  const hashes = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name), name = path.relative(root, file);
    if (name === 'workspace.json' || /^(documents|templates|metadata|assets)\//.test(name)) {
      hashes[name] = buildHash(await fs.readFile(file));
    }
  }
  return hashes;
}
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const firstId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const secondId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const shortClip = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const loopClip = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const selector = suffix => '#scenePreviewInstanceAnimation' + suffix;
let socket, captureFailure;
try {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-animation-instance-preview-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'author');
  await fs.cp(path.join(appRoot, 'examples/scene-animation'), root, { recursive: true });
  const manifestPath = path.join(root, 'documents/animations/demo.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  Object.assign(manifest, { schemaVersion: 3, durationSeconds: 4, loop: false,
    tracks: [
      { id: '66666666-6666-4666-8666-000000000001', instanceId: firstId, property: 'offset2d', interpolation: 'linear',
        keyframes: [[0, 0], [100, -60], [0, 0], [-100, 60], [0, 0]].map((value, atSeconds) => ({ atSeconds, value })) },
      { id: '66666666-6666-4666-8666-000000000002', instanceId: secondId, property: 'offset2d', interpolation: 'linear',
        keyframes: [[0, 0], [-80, 40], [0, 0], [80, -40], [0, 0]].map((value, atSeconds) => ({ atSeconds, value })) },
    ], clips: [
      { id: shortClip, name: 'Short / 短动作 / 短い動き', startSeconds: 0, endSeconds: 1, loop: false },
      { id: loopClip, name: 'Loop / 循环 / ループ', startSeconds: 1, endSeconds: 3, loop: true },
    ] });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
    XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
  delete env.VIENTO_GODOT_BIN; delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  const rebuilt = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
  assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
  const initial = await authorTree(root), base = await serve(fixture, appRoot, env);
  const state = async () => { const response = await fetch(`${base}/api/project-build`).then(value => value.json()); return response.data || response; };
  const profile = path.join(temporary, 'chrome'); await fs.mkdir(profile);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,1100', 'about:blank',
  ], { stdio: 'ignore' });
  cleanups.push(async () => {
    if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; }
  });
  let port;
  await wait(async () => {
    try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return Boolean(port); }
    catch { return false; }
  }, 'Chrome startup');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(value => value.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const pending = new Map(); let sequence = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.id) {
      const request = pending.get(value.id); pending.delete(value.id);
      value.error ? request?.reject(Error(value.error.message)) : request?.resolve(value.result);
    } else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
    else if (value.method === 'Page.javascriptDialogOpening') {
      (report.dialogs ||= []).push({ type: value.params.type, message: value.params.message });
      void call('Page.handleJavaScriptDialog', { accept: true });
    }
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression: `(async()=>(${expression}))()`,
      awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const click = target => evaluate(`document.querySelector(${JSON.stringify(target)}).click()`);
  const fill = (target, value, event = 'input') => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(target)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  const value = target => evaluate(`document.querySelector(${JSON.stringify(target)}).value`);
  const enabled = target => wait(() => evaluate(`document.querySelector(${JSON.stringify(target)})?.disabled===false&&document.querySelector(${JSON.stringify(target)}).checkVisibility()`), target + ' enabled');
  const screenshot = async name => {
    const image = await call('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(output, name), Buffer.from(image.data, 'base64')); report.screenshots.push(name);
  };
  const overview = () => evaluate(`Array.from(document.querySelectorAll('${selector('Overview')} li')).map(e=>({instanceId:e.dataset.instanceId,phase:e.dataset.phase,active:e.dataset.active,text:e.textContent}))`);
  const pixelState = () => evaluate(`(()=>{
    const c=document.querySelector('#scenePreviewCanvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    const colors=[[131,221,186],[175,148,232]],bounds=colors.map(()=>({x:c.width,y:c.height,right:-1,bottom:-1,count:0}));let hash=2166136261;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;for(let k=0;k<4;k++)hash=Math.imul(hash^d[i+k],16777619);
      if(d[i+3]>250)colors.forEach((rgb,j)=>{if(rgb.every((v,k)=>Math.abs(v-d[i+k])<2)){const b=bounds[j];b.x=Math.min(b.x,x);b.y=Math.min(b.y,y);b.right=Math.max(b.right,x);b.bottom=Math.max(b.bottom,y);b.count++;}});}
    return{width:c.width,height:c.height,hash:hash>>>0,bounds};})()`);
  captureFailure = async () => {
    await screenshot('failure.png');
    report.pageFailure = await evaluate(`({text:document.body.innerText,system:(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot(),captures:window.__instanceCaptures,requests:window.__instanceRequests})`);
    report.serviceFailure = await state();
  };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor startup');
  await evaluate(`(()=>{
    const fetch=window.fetch.bind(window);window.__instanceCaptures=[];window.__instanceRequests=[];window.__authorWrites=[];window.__buildRequests=[];window.__previewReleases=[];
    window.fetch=async(input,init)=>{const url=String(input),method=String(init?.method||'GET').toUpperCase();
      const release=method==='DELETE'&&new URL(url,location.href).pathname==='/api/scene-preview';
      if(release)window.__previewReleases.push({url,method});
      if(['PUT','PATCH','DELETE'].includes(method)&&!release||url.includes('/api/world/commands')&&method==='POST')window.__authorWrites.push({url,method,body:init?.body});
      if(url.includes('/api/project-build')&&method!=='GET')window.__buildRequests.push({url,method,body:init?.body});
      const response=await fetch(input,init);
      if(url.includes('/api/scene-preview')&&method==='POST'){const body=await response.clone().json();window.__instanceRequests.push(JSON.parse(init.body));window.__instanceCaptures.push(body.data||body);
        if(window.__holdNextPreview){window.__holdNextPreview=false;window.__heldPreview=true;await new Promise(resolve=>window.__releasePreview=resolve);}}
      return response;};
    const raf=window.requestAnimationFrame.bind(window);window.__previewCallbacks=[];
    window.requestAnimationFrame=callback=>{window.__previewCallbacks.push(callback);if(window.__previewCallbacks.length>100)window.__previewCallbacks.shift();return raf(callback);};
  })()`);
  await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); await enabled('#projectBuildScene');
  await fill('#projectBuildScene', sceneId, 'change'); await click('#projectBuildTabPreview'); await enabled('#scenePreviewAnimationMode');
  const captured = await evaluate('window.__instanceCaptures.at(-1)');
  assert.equal(captured.animationPreview.status, 'ready'); assert.equal(captured.animationPreview.document.schemaVersion, 3);
  assert.equal(captured.actors[0].objectId, captured.actors[1].objectId); assert.notEqual(captured.actors[0].instanceId, captured.actors[1].instanceId);
  assert.deepEqual(captured.animationPreview.document.tracks.map(track => track.instanceId), [firstId, secondId]);
  await fill('#scenePreviewAnimationMode', 'instance', 'change'); await enabled(selector('Play'));
  assert.equal(await value(selector('Instance')), firstId); assert.equal(await value(selector('Clip')), '');
  assert.deepEqual((await overview()).map(row => [row.phase, row.active]), [['stopped', 'false'], ['stopped', 'false']]);
  assert.equal(await evaluate("document.querySelector('#scenePreviewLayoutEdit').disabled"), false);
  await evaluate("document.querySelector('#scenePreviewCanvas').scrollIntoView({block:'center'})");
  const staticPixels = await pixelState(); staticPixels.bounds.forEach(bounds => assert.ok(bounds.count > 100));
  await fill(selector('Clip'), shortClip, 'change'); await fill(selector('Position'), '.5');
  const firstOnly = await pixelState(); assert.notDeepEqual(firstOnly.bounds[0], staticPixels.bounds[0]); assert.deepEqual(firstOnly.bounds[1], staticPixels.bounds[1]);
  await fill(selector('Instance'), secondId, 'change'); await fill(selector('Clip'), loopClip, 'change'); await fill(selector('Position'), '.75');
  const simultaneous = await pixelState(); assert.deepEqual(simultaneous.bounds[0], firstOnly.bounds[0]); assert.notDeepEqual(simultaneous.bounds[1], staticPixels.bounds[1]);
  const rows = await overview(); assert.ok(rows[0].text.includes('0.50') && rows[0].text.includes('Short')); assert.ok(rows[1].text.includes('0.75') && rows[1].text.includes('Loop'));
  await fill(selector('Instance'), firstId, 'change'); assert.equal(await value(selector('Position')), '0.5'); assert.equal(await value(selector('Clip')), shortClip);
  assert.deepEqual(await pixelState(), simultaneous); await fill(selector('Instance'), secondId, 'change');
  assert.equal(await value(selector('Position')), '0.75'); assert.equal(await value(selector('Clip')), loopClip); assert.deepEqual(await pixelState(), simultaneous);
  assert.equal(await evaluate("document.querySelector('#scenePreviewLayoutEdit').disabled"), true);
  await screenshot('instances-independent-desktop.png');
  report.frames = { static: staticPixels, firstOnly, simultaneous, overview: rows };
  report.steps.push('Two instances of one object independently select non-loop and loop clips. Different paused positions are visible together in actual canvas pixels; selecting either instance preserves both frames, clips and local times.');

  await fill(selector('Instance'), firstId, 'change'); await click(selector('Stop'));
  const oneStopped = await pixelState(); assert.deepEqual(oneStopped.bounds[0], staticPixels.bounds[0]); assert.deepEqual(oneStopped.bounds[1], simultaneous.bounds[1]);
  assert.equal(await evaluate("document.querySelector('#scenePreviewLayoutEdit').disabled"), true);
  await click(selector('StopAll')); assert.deepEqual(await pixelState(), staticPixels); assert.equal(await evaluate("document.querySelector('#scenePreviewLayoutEdit').disabled"), false);
  report.steps.push('Stopping the selected instance restores only its saved static position while the other paused frame remains visible and layout stays locked. Stop All restores exact static canvas pixels and enables layout editing.');

  await fill(selector('Position'), '.8'); await click(selector('Play'));
  await fill(selector('Instance'), secondId, 'change'); await fill(selector('Position'), '1.5'); await click(selector('Play'));
  await wait(async () => { const rows = await overview(); return rows[0]?.phase === 'finished' && rows[1]?.phase === 'playing'; }, 'first finishes while second loops');
  await delay(650); const running = await overview(); assert.equal(running[0].phase, 'finished'); assert.equal(running[1].phase, 'playing');
  const loopTime = Number(await value(selector('Position'))); assert.ok(loopTime >= 0 && loopTime < 1.5, 'Second local time wrapped through its own 2-second loop.');
  await screenshot('instances-finished-and-looping-desktop.png'); await click(selector('Pause'));
  report.playback = { overview: running, loopTime }; report.steps.push('Real requestAnimationFrame playback completes the first non-loop clip while the second instance wraps and keeps playing its own loop. Pausing the selected loop leaves the finished frame intact.');

  await fill(selector('Instance'), firstId, 'change'); await fill(selector('Position'), '.5');
  await fill(selector('Instance'), secondId, 'change'); await fill(selector('Position'), '.75');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  for (const language of ['zh-CN', 'en', 'ja']) {
    await evaluate(`(window.__instanceTimeInput=document.querySelector('${selector('Position')}'),window.__instanceTimeInput.focus())`);
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await value(selector('Position')), '0.75'); assert.equal(await value(selector('Instance')), secondId); assert.equal(await value(selector('Clip')), loopClip);
    assert.equal(await evaluate(`document.activeElement===window.__instanceTimeInput&&document.querySelector('${selector('Position')}')===window.__instanceTimeInput`), true);
    const afterLocale = await overview(); assert.ok(afterLocale[0].text.includes('0.50')); assert.ok(afterLocale[1].text.includes('0.75'));
    await evaluate("document.querySelector('#scenePreviewAnimationInstances').scrollIntoView({block:'center'})");
    const ids = ['scenePreviewAnimationMode', 'scenePreviewAnimationInstances', ...['Instance', 'Clip', 'Play', 'Pause', 'Stop', 'StopAll', 'Position', 'Summary', 'Overview'].map(suffix => 'scenePreviewInstanceAnimation' + suffix)];
    const layout = await evaluate(`(()=>{const ids=${JSON.stringify(ids)},rect=id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth};};return{overflow:document.querySelector('#projectBuildDialog').scrollWidth>document.querySelector('#projectBuildDialog').clientWidth||document.documentElement.scrollWidth>innerWidth,rects:Object.fromEntries(ids.map(id=>[id,rect(id)])),title:document.querySelector('#scenePreviewInstanceAnimationTitle').textContent,status:document.querySelector('${selector('Status')}').textContent,summary:document.querySelector('${selector('Summary')}').textContent};})()`);
    assert.equal(layout.overflow, false, JSON.stringify(layout));
    for (const rect of Object.values(layout.rects)) assert.ok(rect.left >= 0 && rect.right <= 390, JSON.stringify(layout));
    report.layout[language] = layout; await screenshot(`instances-${language}-390.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");
  report.steps.push('Chinese, English and Japanese controls and instance summaries fit 390px. Changing language preserves the selected instance, both paused frames and exact local times, and the same focused timeline node.');

  await click(selector('Play')); await wait(() => evaluate(`document.querySelector('${selector('Status')}').dataset.phase==='playing'`), 'loop playing before background');
  await evaluate(`(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));})()`);
  const backgroundTime = await value(selector('Position')); await delay(150); assert.equal(await value(selector('Position')), backgroundTime);
  assert.equal(await evaluate(`document.querySelector('${selector('Status')}').dataset.phase`), 'paused'); await evaluate('delete document.hidden');
  report.steps.push('The background visibility handler pauses active instance clocks at the last painted frame without changing their selected clips or positions.');

  await click(selector('Play')); await delay(100); await evaluate('window.__staleHiddenCallback=window.__previewCallbacks.at(-1)');
  await click('#projectBuildTabBuild'); assert.equal(await evaluate("document.querySelector('#scenePreviewAnimationInstances').hidden"), true);
  await evaluate('window.__staleHiddenCallback(performance.now())'); await delay(100);
  assert.equal(await evaluate("document.querySelector('#scenePreviewAnimationInstances').hidden"), true);
  await click('#projectBuildTabPreview'); await enabled('#scenePreviewAnimationMode');
  assert.equal(await value('#scenePreviewAnimationMode'), 'scene'); await fill('#scenePreviewAnimationMode', 'instance', 'change'); await enabled(selector('Play'));
  assert.deepEqual((await overview()).map(row => [row.phase, row.active]), [['stopped', 'false'], ['stopped', 'false']]);
  assert.deepEqual(await pixelState(), staticPixels);
  await click(selector('Play')); await delay(100); await evaluate('(window.__staleRefreshCallback=window.__previewCallbacks.at(-1),window.__holdNextPreview=true,window.__heldPreview=false)');
  await click('#scenePreviewRefresh'); await wait(() => evaluate('window.__heldPreview'), 'held refresh response');
  await evaluate('window.__staleRefreshCallback(performance.now())');
  assert.equal(await evaluate("document.querySelector('#scenePreviewAnimationInstances').hidden"), true);
  await evaluate('window.__releasePreview()'); await enabled('#scenePreviewAnimationMode');
  await fill('#scenePreviewAnimationMode', 'instance', 'change'); await enabled(selector('Play'));
  await evaluate('window.__staleRefreshCallback(performance.now())');
  assert.deepEqual((await overview()).map(row => [row.phase, row.active]), [['stopped', 'false'], ['stopped', 'false']]);
  assert.deepEqual(await pixelState(), staticPixels); assert.equal(await evaluate("document.querySelector('#scenePreviewLayoutEdit').disabled"), false);
  report.steps.push('Hiding the preview and replacing its captured snapshot reset instance state. Explicitly replaying cancelled old animation callbacks cannot reactivate a hidden view or modify the fresh static instance session.');

  await evaluate('(window.__holdNextPreview=true,window.__heldPreview=false)'); await click('#scenePreviewRefresh'); await wait(() => evaluate('window.__heldPreview'), 'held response before close');
  await click('#projectBuildClose'); await evaluate('window.__releasePreview()'); await delay(150);
  assert.equal(await evaluate("document.querySelector('#projectBuildDialog').open"), false); assert.equal(await evaluate("document.querySelector('#scenePreviewAnimationInstances').hidden"), true);
  assert.deepEqual(await authorTree(root), initial); assert.deepEqual(await evaluate('window.__authorWrites'), []);
  assert.deepEqual(await evaluate('window.__buildRequests'), []); assert.equal((await state()).job, null); assert.deepEqual(report.errors, []);
  report.previewReleases = await evaluate('window.__previewReleases'); assert.ok(report.previewReleases.length >= 3);
  report.requests = await evaluate('window.__instanceRequests'); assert.ok(report.requests.every(request => request.includeAnimation === true && !request.draft));
  report.steps.push('A late HTTP snapshot cannot reopen a closed dialog. All author bytes remain unchanged; no author write, build request or build job occurs.');
  report.authorFilesUnchanged = true; report.authorFileCount = Object.keys(initial).length;
  for (const [file, expected] of Object.entries(report.sources)) {
    assert.equal(buildHash(await fs.readFile(path.join(appRoot, file))), expected, `Source changed during smoke: ${file}`);
  }
  report.sourceSnapshotUnchanged = true; report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  try { await captureFailure?.(); } catch (failure) { report.captureFailure = failure.message; }
} finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) {
    try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, output, steps: report.steps, failure: report.failure }, null, 2));
}
