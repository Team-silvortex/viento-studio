// Real browser proportional animation timing, review and ordinary Save with the Rust WASM core.
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
import { Readable } from 'node:stream';
import { importMediaAsset } from '../lib/media-assets.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-animation-retime');
const output = path.resolve(process.env.VIENTO_ANIMATION_RETIME_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new directory beneath scene-animation-retime evidence.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
 'Actual Chrome with local HTTP editor on a disposable copied animation workspace. No installed Tauri or Android device acceptance.',
 'Real Chrome Canvas samples use the local Rust WASM core and frozen imported SVG bytes; no native Godot or packaged app claim.',
 'Checks proportional timing in fields, preserved incomplete input and review, ordinary Save and a frozen saved preview. Native Godot execution is tested separately.',
] };
const sources = ['engine/scene-animation-core.mjs','engine/scene-animation-edit.mjs','engine/scene-animation.mjs','engine/studio-core.mjs','engine/studio-core.wasm','engine/studio-modules.mjs',
 'web/modules/app-scene-animation.js','web/modules/app-scene-animation-source.js','web/modules/scene-animation-player.js','web/modules/scene-animation-preview.js','web/scene-animation.css',
 'web/modules/app-runtime.js','web/modules/app-studio-system.js','web/i18n/en.js','web/i18n/ja.js','scripts/tests/scene-animation-retime-smoke.mjs','web/modules/app-scene-animation-retime.js','engine/scene-animation-preview.mjs','engine/scene-animation-visual-frame.mjs','engine/scene-animation-sprite-layout.mjs','web/modules/app-scene-preview.js','web/modules/app-scene-preview-canvas.js','web/modules/app-scene-preview-animation.js','scripts/lib/scene-preview-service.mjs'];
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-animation-retime-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'author'), download = path.join(temporary, 'downloads');
  await fs.cp(path.join(appRoot, 'examples/scene-animation'), root, { recursive: true }); await fs.mkdir(download);
  const manifestPath = 'documents/animations/demo.json', manifestFile = path.join(root, manifestPath);
  const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const sceneFile = path.join(root, 'documents/scenes/demo.json'), scene = JSON.parse(await fs.readFile(sceneFile, 'utf8'));
  const imageBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="128" height="128" fill="#e03030"/><rect x="128" width="128" height="128" fill="#30c060"/><rect y="128" width="128" height="128" fill="#3060e0"/><rect x="128" y="128" width="128" height="128" fill="#e0c030"/></svg>');
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  const imported = await importMediaAsset(root, Readable.from([imageBytes]), 'four-frames.svg');
  for (const actor of scene.actors) { actor.imageResourceId = imported.asset.id; actor.color = '#ffffff'; actor.size = [80, 80]; }
  await fs.writeFile(sceneFile, JSON.stringify(scene, null, 2) + '\n');
  const sceneRegistrationFile = path.join(root, 'metadata/documents/' + sceneId + '.json'), sceneRegistration = JSON.parse(await fs.readFile(sceneRegistrationFile, 'utf8'));
  sceneRegistration.assetBindings.push({ assetId: imported.asset.id, role: 'sprite' }); await fs.writeFile(sceneRegistrationFile, JSON.stringify(sceneRegistration, null, 2) + '\n');
  const document = JSON.parse(await fs.readFile(manifestFile, 'utf8')); document.schemaVersion = 3;
  document.tracks[0] = { ...document.tracks[0], property:'spriteFrame2d', interpolation:'step', grid:{columns:2,rows:2},keyframes:[{atSeconds:0,value:0},{atSeconds:.5,value:1},{atSeconds:1.5,value:3},{atSeconds:2,value:0}] };
  document.clips=[{id:'77777777-7777-4777-8777-000000000001',name:'Attack / 攻撃',startSeconds:.5,endSeconds:1.5,loop:false},{id:'77777777-7777-4777-8777-000000000002',name:'Idle / 待機',startSeconds:1.5,endSeconds:2,loop:true}];
  const original = '\ufeff' + JSON.stringify(document, null, 2).replaceAll('\n', '\r\n') + '\r\n';
  await fs.writeFile(manifestFile, original);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
    XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
  delete env.VIENTO_GODOT_BIN; delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
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
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,captures:window.__sceneCaptures,frames:window.__imageFrames,system:(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()})`); };
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
  const open=async()=>{await enabled('#sceneAnimationBtn');await click('#sceneAnimationBtn');await enabled('#sceneAnimationTrack0Key1X');await enabled('#sceneAnimationTrack0Target');};
  const close=async()=>{await click('#sceneAnimationCancel');await wait(()=>evaluate("!document.querySelector('#sceneAnimationDialog').open"),'closed');};
  const text=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  const unchanged=async(draft=original)=>{assert.deepEqual(await authorTree(root),initial);assert.equal(await value('#docSourceEditor'),visible(draft));};
  const check=async()=>{await enabled('#sceneAnimationCheck');await click('#sceneAnimationCheck');await enabled('#sceneAnimationApply');};

  const alterValues = async () => { await fill('#sceneAnimationTrack1Key1X','210'); await fill('#sceneAnimationClip0Name','Attack edited / 攻撃'); };
  const retime = async target => { await fill('#sceneAnimationRetimeDuration',target); await click('#sceneAnimationRetimeApply'); await wait(()=>evaluate("document.querySelector('#sceneAnimationRetime').getAttribute('aria-busy')==='false'"),'retime finished'); };
  await open(); await alterValues(); await check(); const previousReview=await text('#sceneAnimationAfter');
  await fill('#sceneAnimationPosition','0.75'); const valuesBefore=await text('#sceneAnimationValues');
  for(const target of ['61','0','1e','2.0']) {
    await retime(target); assert.equal(await text('#sceneAnimationAfter'),previousReview); assert.equal(await value('#sceneAnimationPosition'),'0.75'); assert.equal(await text('#sceneAnimationValues'),valuesBefore); assert.equal(await evaluate("document.querySelector('#sceneAnimationApply').disabled"),false);
    assert.match(await text('#sceneAnimationRetimeStatus'),target==='2.0'?/相同/:/保留/); assert.equal(await value('#sceneAnimationDuration'),'2');
  }
  await click('#sceneAnimationPlay'); await retime('2'); assert.equal(await evaluate("document.querySelector('#sceneAnimationPause').disabled"),false); await click('#sceneAnimationPause'); await fill('#sceneAnimationPosition','0.75');
  await fill('#sceneAnimationRetimeDuration','1e');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']) {
    await evaluate("(window.__target=document.querySelector('#sceneAnimationRetimeDuration'),window.__target.focus(),window.__target.setSelectionRange(1,2))");
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate("document.querySelector('#sceneAnimationRetimeDuration')===window.__target&&document.activeElement===window.__target&&window.__target.selectionStart===1&&window.__target.selectionEnd===2"),true);
    assert.equal(await value('#sceneAnimationRetimeDuration'),'1e'); assert.equal(await text('#sceneAnimationAfter'),previousReview); assert.equal(await value('#sceneAnimationPosition'),'0.75');
    await evaluate("document.querySelector('#sceneAnimationRetime').scrollIntoView({block:'center'})");
    const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneAnimationDialog'),fits=id=>{const b=document.querySelector(id).getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth;};return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,target:fits('#sceneAnimationRetimeDuration'),action:fits('#sceneAnimationRetimeApply'),cancel:fits('#sceneAnimationCancel'),check:fits('#sceneAnimationCheck'),apply:fits('#sceneAnimationApply')};})()`);
    assert.ok(Object.values(layout).every(Boolean),JSON.stringify(layout));report.layout[language]=layout;await screenshot(`retime-${language}-390.png`);
  }
  await close(); await unchanged(); await call('Emulation.clearDeviceMetricsOverride'); await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");
  report.steps.push('Invalid targets and unchanged duration preserve reviewed bytes, paused sample time and form values. Unchanged retiming also leaves a running preview active. Editing the independent target alone does not invalidate the review. Chinese, English and Japanese at390px retain the target node, incomplete text, focus and selection; controls fit. Cancel leaves all author files and source draft unchanged.');

  const prepare = async () => {
    await open(); await alterValues(); await retime('1'); assert.equal(await value('#sceneAnimationDuration'),'1'); assert.equal(await value('#sceneAnimationTrack0Key1Time'),'0.25'); assert.equal(await value('#sceneAnimationClip0Start'),'0.25'); assert.equal(await value('#sceneAnimationClip0End'),'0.75');
    assert.equal(await value('#sceneAnimationTrack1Key1X'),'210'); assert.equal(await value('#sceneAnimationClip0Name'),'Attack edited / 攻撃'); assert.equal(await evaluate("document.querySelector('#sceneAnimationApply').disabled"),true); assert.equal(await evaluate("document.querySelector('#sceneAnimationPlay').disabled"),true); await unchanged(); await check();
    const content=await text('#sceneAnimationAfter'),transformed=JSON.parse(content.replace(/^\ufeff/,''));
    const expected=structuredClone(document);expected.durationSeconds=1;expected.tracks[1].keyframes[1].value=210;expected.clips[0].name='Attack edited / 攻撃';for(const track of expected.tracks)for(const key of track.keyframes)key.atSeconds/=2;for(const clip of expected.clips){clip.startSeconds/=2;clip.endSeconds/=2;}
    assert.deepEqual(transformed,expected);await fill('#sceneAnimationPreviewClip',document.clips[0].id,'change');assert.equal(await evaluate("document.querySelector('#sceneAnimationPosition').max"),'0.5');assert.equal(await text('#sceneAnimationStage .scene-animation-shape'),'1');
    return {content,transformed};
  };
  await prepare();await evaluate("document.querySelector('#sceneAnimationRetime').scrollIntoView({block:'center'})");await screenshot('retime-reviewed-desktop.png');await close();await unchanged();
  report.steps.push('Real Rust WASM halves the current valid schema3 form from2s to1s, including every key on sprite and numeric tracks and both named-clip ranges. Unsaved numeric values and clip names survive; IDs, grid, interpolation and loops remain equal. The result stays in fields until a new check/review. The schematic clip range becomes0.5s and its first sample is the expected sprite frame. Cancelling the transformed review writes nothing.');
  const {content:saved,transformed:savedDocument}=await prepare();await click('#sceneAnimationApply');await wait(()=>evaluate("!document.querySelector('#sceneAnimationDialog').open"),'applied to draft');assert.equal(await value('#docSourceEditor'),visible(saved));assert.deepEqual(await authorTree(root),initial);
  await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readSource()===saved,'ordinary retime save');await wait(()=>evaluate("!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges"),'saved source settled');
  const expectedAuthor={...initial,[manifestPath]:buildHash(Buffer.from(saved))};assert.deepEqual(await authorTree(root),expectedAuthor);assert.ok(saved.startsWith('\ufeff'));assert.equal(saved.replaceAll('\r\n','').includes('\n'),false);
  report.saved={onlyChangedAuthorPath:manifestPath,beforeSha256:buildHash(Buffer.from(original)),afterSha256:buildHash(Buffer.from(saved)),bomCrlfPreserved:true,document:savedDocument};
  report.steps.push('Apply updates only the ordinary source draft. Ordinary Save writes exactly the reviewed BOM/CRLF animation and preserves every scene, registration, asset, template and other author file.');

  await evaluate(`(()=>{const original=window.fetch.bind(window);window.__sceneCaptures=[];window.fetch=async(input,init)=>{const response=await original(input,init);if(String(input).includes('/api/scene-preview')&&init?.method==='POST'){const body=await response.clone().json();window.__sceneCaptures.push(body.data||body);}return response;};})()`);
  await enabled('#projectBuildBtn');await click('#projectBuildBtn');await enabled('#projectBuildScene');await fill('#projectBuildScene',sceneId,'change');await click('#projectBuildTabPreview');await enabled('#scenePreviewAnimationPlay');
  const captured=await evaluate('window.__sceneCaptures.at(-1)');assert.equal(captured.animationPreview.status,'ready');assert.deepEqual(captured.animationPreview.document,savedDocument);
  await fill('#scenePreviewAnimationClip',document.clips[0].id,'change');assert.equal(await evaluate("document.querySelector('#scenePreviewAnimationPosition').max"),'0.5');await fill('#scenePreviewAnimationPosition','0.25');await evaluate("document.querySelector('#scenePreviewAnimation').scrollIntoView({block:'center'})");await screenshot('retime-saved-preview.png');await click('#projectBuildClose');
  assert.deepEqual(await authorTree(root),expectedAuthor);assert.deepEqual(report.errors,[]);report.authorFilesPreserved=Object.keys(initial).length-1;
  report.steps.push('Saved scene preview freezes the exact retimed document and exposes the same stable clip with its shortened0.5s range. Preview and inspection cause no additional author writes. No browser exceptions occurred.');
  for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);
  report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));}
