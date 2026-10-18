// Real browser keyframe authoring, Rust schematic playback and ordinary source saving.
// Only temporary copied author files and a new evidence directory are written.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-animation');
const output = path.resolve(process.env.VIENTO_ANIMATION_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new directory beneath scene-animation evidence.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
 'Actual Chrome with local HTTP editor on a disposable copied animation workspace. No installed Tauri or Android device acceptance.',
 'The built-in preview renders schematic shapes from actual Rust samples. Real scene rendering and Godot delivery have separate evidence.',
] };
const sources = ['engine/scene-animation-core.mjs','engine/scene-animation-edit.mjs','engine/scene-animation.mjs','engine/studio-core.mjs','engine/studio-core.wasm','engine/studio-modules.mjs',
 'web/modules/app-scene-animation.js','web/modules/app-scene-animation-source.js','web/modules/scene-animation-player.js','web/modules/scene-animation-preview.js','web/scene-animation.css',
 'web/modules/app-runtime.js','web/modules/app-studio-system.js','web/i18n/en.js','web/i18n/ja.js','scripts/tests/scene-animation-smoke.mjs'];
report.sources = Object.fromEntries(await Promise.all(sources.map(async name => [name, buildHash(await fs.readFile(path.join(appRoot, name)))])));
report.node = { version: process.version, sha256: buildHash(await fs.readFile(process.execPath)) };
const cleanups = [], fixture = { after: callback => cleanups.push(callback) };
const wait = async (check, label, budget = 45000) => { for (let elapsed = 0; elapsed < budget; elapsed += 100) { if (await check()) return; await delay(100); } throw Error('Timed out: ' + label); };
async function authorTree(root) {
  const hashes = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name), name = path.relative(root, file);
    if (name === 'workspace.json' || /^(documents|templates|metadata|assets)\//.test(name)) hashes[name] = buildHash(await fs.readFile(file));
  }
  return hashes;
}
let socket, captureFailure;
try {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-animation-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'author'), download = path.join(temporary, 'downloads');
  await fs.cp(path.join(appRoot, 'examples/scene-animation'), root, { recursive: true }); await fs.mkdir(download);
  const manifestPath = 'documents/animations/demo.json', manifestFile = path.join(root, manifestPath);
  const original = '\ufeff' + (await fs.readFile(manifestFile, 'utf8')).replaceAll('\n', '\r\n');
  await fs.writeFile(manifestFile, original);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
    XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  const rebuilt = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env }); assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
  const initial = await authorTree(root), base = await serve(fixture, appRoot, env), readSource = () => fs.readFile(manifestFile, 'utf8');
  const profile = path.join(temporary, 'chrome'); await fs.mkdir(profile);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; } });
  let port;
  await wait(async () => { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return Boolean(port); } catch { return false; } }, 'Chrome startup');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(value => value.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const pending = new Map(); let sequence = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.id) { const request = pending.get(value.id); pending.delete(value.id); value.error ? request?.reject(Error(value.error.message)) : request?.resolve(value.result); }
    else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
    else if (value.method === 'Page.javascriptDialogOpening') { report.dialogs.push({ type: value.params.type, message: value.params.message }); void call('Page.handleJavaScriptDialog', { accept: true }); }
  });
  const evaluate = async expression => {
    const value = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true, userGesture: true });
    if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value;
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value, event = 'input') => evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event(${JSON.stringify(event)}, {bubbles:true})); })()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === false && !document.querySelector(${JSON.stringify(selector)}).hidden`), selector + ' enabled');
  const screenshot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(image.data, 'base64')); report.screenshots.push(name); };
  const value = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
  const visible = content => content.replace(/\r\n?/g, '\n');
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,system:(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()})`); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: download, eventsEnabled: true });
  await call('Page.addScriptToEvaluateOnNewDocument', {source: `(()=>{window.__assetReads=0;const original=window.fetch;window.fetch=(input,init)=>{if(String(input).startsWith('/asset-files/'))window.__assetReads++;return original(input,init);};})()`});
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor startup');
  await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.includes('animations/demo'))`), 'animation source in sidebar');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('animations/demo')).click()`);
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.activePath.includes('animations/demo')`), 'selected animation source');
  await enabled('#docEditBtn'); await click('#docEditBtn'); await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`), 'source edit');
  await enabled('#docEditSourceModeBtn'); await click('#docEditSourceModeBtn'); await enabled('#sceneAnimationBtn');
  assert.equal(await value('#docSourceEditor'), visible(original));
  report.system = await evaluate(`(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()`);
  assert.ok(report.system.initializedModules.includes('org.viento.scene-animation'));
  const open=async()=>{await enabled('#sceneAnimationBtn');await click('#sceneAnimationBtn');await enabled('#sceneAnimationTrack0Key1X');};
  const close=async()=>{await click('#sceneAnimationCancel');await wait(()=>evaluate("!document.querySelector('#sceneAnimationDialog').open"),'closed');};
  const text=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  const unchanged=async(draft=original)=>{assert.deepEqual(await authorTree(root),initial);assert.equal(await value('#docSourceEditor'),visible(draft));};
  const check=async()=>{await enabled('#sceneAnimationCheck');await click('#sceneAnimationCheck');await enabled('#sceneAnimationApply');};
  await open();await enabled('#sceneAnimationPlay');
  await fill('#sceneAnimationPosition','.5');assert.match(await text('#sceneAnimationValues'),/\[60,-30\]/);
  await click('#sceneAnimationPlay');await wait(async()=>Number(await value('#sceneAnimationPosition'))!==0.5,'clock advance');await click('#sceneAnimationPause');
  const paused=await value('#sceneAnimationPosition');await delay(120);assert.equal(await value('#sceneAnimationPosition'),paused);
  await click('#sceneAnimationStop');assert.equal(Number(await value('#sceneAnimationPosition')),0);
  await unchanged();report.steps.push('Valid saved animation opens in its independent module. Actual Rust sampling at 0.5s produces offset [60,-30]; play advances, pause holds, stop returns to zero without changing source or files.');

  await fill('#sceneAnimationTrack0Key1X','160');assert.equal(await evaluate("document.querySelector('#sceneAnimationPlay').disabled"),true);await check();
  const candidate=await text('#sceneAnimationAfter');assert.notEqual(candidate,original);
  await fill('#sceneAnimationPosition','.5');assert.match(await text('#sceneAnimationValues'),/\[80,-30\]/);
  await evaluate("document.querySelector('#sceneAnimationPreview').scrollIntoView({block:'start'})");await screenshot('preview-desktop.png');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']){
    await evaluate("(window.__key=document.querySelector('#sceneAnimationTrack0Key1X'),window.__key.focus(),window.__key.setSelectionRange(1,2))");
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate("document.querySelector('#sceneAnimationTrack0Key1X')===window.__key&&document.activeElement===window.__key&&window.__key.selectionStart===1&&window.__key.selectionEnd===2"),true);
    assert.equal(await value('#sceneAnimationTrack0Key1X'),'160');assert.equal(await text('#sceneAnimationAfter'),candidate);assert.equal(await evaluate("document.querySelector('#sceneAnimationApply').disabled"),false);
    await evaluate("document.querySelector('#sceneAnimationPreview').scrollIntoView({block:'start'})");
    const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneAnimationDialog'),r=id=>{const b=document.querySelector(id).getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth;};return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,cancelVisible:r('#sceneAnimationCancel'),checkVisible:r('#sceneAnimationCheck'),applyVisible:r('#sceneAnimationApply')};})()`);
    assert.ok(Object.values(layout).every(Boolean),JSON.stringify(layout));report.layout[language]=layout;await screenshot(`preview-${language}-390.png`);
  }
  await close();await unchanged();await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");
  report.steps.push('Edited keyframes require a fresh check before sampling or Apply. Review and exact Rust offset [80,-30] agree; Chinese/English/Japanese at 390px retain input node, focus, selection, checked draft and reachable footer actions. Cancel changes no author files.');

  await open();await fill('#sceneAnimationDuration','1e-');await click('#sceneAnimationCheck');await wait(()=>evaluate("document.querySelector('#sceneAnimationDialog').getAttribute('aria-busy')==='false'"),'invalid settled');
  assert.equal(await value('#sceneAnimationDuration'),'1e-');assert.equal(await evaluate("document.querySelector('#sceneAnimationApply').disabled"),true);assert.equal(await evaluate("document.querySelector('#sceneAnimationPlay').disabled"),true);
  await fill('#sceneAnimationDuration','2');await click('#sceneAnimationTrack0AddKey');await check();
  const added=JSON.parse((await text('#sceneAnimationAfter')).replace(/^\ufeff/,''));assert.equal(added.tracks[0].keyframes.length,4);assert.equal(added.tracks[0].keyframes.at(-1).atSeconds,2);
  await evaluate('window.__oldRemove=document.querySelector("#sceneAnimationTrack0Key1Remove")');await click('#sceneAnimationTrack0Key1Remove');
  const keyCount=await evaluate("document.querySelectorAll('#sceneAnimationTracks .scene-animation-key').length");await evaluate('window.__oldRemove.click()');assert.equal(await evaluate("document.querySelectorAll('#sceneAnimationTracks .scene-animation-key').length"),keyCount);
  await click('#sceneAnimationAddTrack');assert.equal(await value('#sceneAnimationTrack4Instance'),'');await fill('#sceneAnimationTrack4Instance','not-an-instance');await click('#sceneAnimationTrack4Remove');
  assert.equal(await evaluate("document.querySelector('#sceneAnimationTrack4Instance')===null"),true);await close();await unchanged();
  report.steps.push('Invalid numeric input remains editable and clears old preview/approval. Adding a key chooses a valid time inside the current duration. Removing keys and adding/removing tracks preserve the ordinary draft, and detached old row buttons cannot mutate replacement rows.');

  await open();await fill('#sceneAnimationTrack0Key1X','160');await check();const savedCandidate=await text('#sceneAnimationAfter');await click('#sceneAnimationApply');await wait(()=>evaluate("!document.querySelector('#sceneAnimationDialog').open"),'applied');
  assert.equal(await value('#docSourceEditor'),visible(savedCandidate));assert.deepEqual(await authorTree(root),initial);
  await open();assert.equal(await value('#sceneAnimationTrack0Key1X'),'160');await fill('#sceneAnimationDuration','1e-');await close();await unchanged(savedCandidate);
  await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readSource()===savedCandidate,'ordinary save');
  await wait(()=>evaluate("!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges&&!document.querySelector('#sceneAnimationBtn').disabled"),'saved ready');
  await open();await fill('#sceneAnimationPosition','.5');assert.match(await text('#sceneAnimationValues'),/\[80,-30\]/);await close();
  assert.deepEqual(await authorTree(root),{...initial,[manifestPath]:buildHash(Buffer.from(savedCandidate))});
  assert.ok(savedCandidate.startsWith('\ufeff'));assert.equal(savedCandidate.replaceAll('\r\n','').includes('\n'),false);
  report.saved={onlyChangedAuthorPath:manifestPath,beforeSha256:buildHash(Buffer.from(original)),afterSha256:buildHash(Buffer.from(savedCandidate)),bomCrlfPreserved:true};
  report.steps.push('Apply updates only the ordinary source draft, reopening reads that unsaved draft, and Cancel retains it. Ordinary Save writes only the reviewed animation with BOM/CRLF preserved; the scene, actor, templates and registration files remain unchanged.');
  report.assetReads=await evaluate('window.__assetReads');assert.equal(report.assetReads,0);assert.deepEqual(report.errors,[]);report.authorFilesPreserved=Object.keys(initial).length-1;
  for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));}
