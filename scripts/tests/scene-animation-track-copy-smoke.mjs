// Real browser copying current animation tracks to explicit saved instances, source review and ordinary Save.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-animation-track-copy');
const output = path.resolve(process.env.VIENTO_ANIMATION_TRACK_COPY_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new directory beneath scene-animation-track-copy evidence.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
 'Actual Chrome with local HTTP editor on a disposable copied animation workspace. No installed Tauri or Android device acceptance.',
 'Real Chrome Canvas samples use the local Rust WASM core and frozen imported SVG bytes; no native Godot or packaged app claim.',
 'Checks copied tracks in fields, preserved review, ordinary Save and both targets using their own frozen images. Native Godot execution is tested separately.',
] };
const sources = ['engine/scene-animation-core.mjs','engine/scene-animation-edit.mjs','engine/scene-animation.mjs','engine/studio-core.mjs','engine/studio-core.wasm','engine/studio-modules.mjs',
 'web/modules/app-scene-animation.js','web/modules/app-scene-animation-source.js','web/modules/scene-animation-player.js','web/modules/scene-animation-preview.js','web/scene-animation.css',
 'web/modules/app-runtime.js','web/modules/app-studio-system.js','web/i18n/en.js','web/i18n/ja.js','scripts/tests/scene-animation-track-copy-smoke.mjs','web/modules/app-scene-animation-track-copy.js','web/modules/app-scene-animation-retime.js','web/modules/app-scene-animation-clips.js','engine/scene-animation-preview.mjs','engine/scene-animation-visual-frame.mjs','engine/scene-animation-sprite-layout.mjs','web/modules/app-scene-preview.js','web/modules/app-scene-preview-canvas.js','web/modules/app-scene-preview-animation.js','scripts/lib/scene-preview-service.mjs'];
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-animation-track-copy-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'author'), download = path.join(temporary, 'downloads');
  await fs.cp(path.join(appRoot, 'examples/scene-animation'), root, { recursive: true }); await fs.mkdir(download);
  const manifestPath = 'documents/animations/demo.json', manifestFile = path.join(root, manifestPath);
  const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const sceneFile = path.join(root, 'documents/scenes/demo.json'), scene = JSON.parse(await fs.readFile(sceneFile, 'utf8'));
  const imageBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="128" height="128" fill="#e03030"/><rect x="128" width="128" height="128" fill="#30c060"/><rect y="128" width="128" height="128" fill="#3060e0"/><rect x="128" y="128" width="128" height="128" fill="#e0c030"/></svg>');
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  const imported = await importMediaAsset(root, Readable.from([imageBytes]), 'four-frames.svg');
  const targetImageBytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="128" height="128" fill="#30e0e0"/><rect x="128" width="128" height="128" fill="#e030e0"/><rect y="128" width="128" height="128" fill="#e09030"/><rect x="128" y="128" width="128" height="128" fill="#ffffff"/></svg>');
  const targetImported=await importMediaAsset(root,Readable.from([targetImageBytes]),'target-frames.svg');
  for (const [index,actor] of scene.actors.entries()) { actor.imageResourceId = index===0?imported.asset.id:targetImported.asset.id; actor.color = '#ffffff'; actor.size = [80, 80]; }
  await fs.writeFile(sceneFile, JSON.stringify(scene, null, 2) + '\n');
  const sceneRegistrationFile = path.join(root, 'metadata/documents/' + sceneId + '.json'), sceneRegistration = JSON.parse(await fs.readFile(sceneRegistrationFile, 'utf8'));
  sceneRegistration.assetBindings.push({ assetId: imported.asset.id, role: 'sprite' }, { assetId: targetImported.asset.id, role: 'sprite' }); await fs.writeFile(sceneRegistrationFile, JSON.stringify(sceneRegistration, null, 2) + '\n');
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

  const sourceTrack=document.tracks[0].id,sourceInstance=document.tracks[0].instanceId,targetInstance=scene.actors[1].instanceId;
  assert.notEqual(sourceInstance,targetInstance);
  const alterValues=async()=>{await fill('#sceneAnimationTrack0Key1X','2');await fill('#sceneAnimationClip0Name','Attack edited / 攻撃');};
  const choose=async target=>{await fill('#sceneAnimationTrackCopySource',sourceTrack,'change');await fill('#sceneAnimationTrackCopyTarget',target,'change');};
  const copyTrack=async()=>{await enabled('#sceneAnimationTrackCopyApply');await click('#sceneAnimationTrackCopyApply');await wait(()=>evaluate("document.querySelector('#sceneAnimationTrackCopy').getAttribute('aria-busy')==='false'"),'copy finished');};
  await open();assert.equal(await value('#sceneAnimationTrackCopySource'),'');assert.equal(await value('#sceneAnimationTrackCopyTarget'),'');assert.equal(await evaluate("document.querySelector('#sceneAnimationTrackCopyApply').disabled"),true);
  await alterValues();await check();const previousReview=await text('#sceneAnimationAfter');await fill('#sceneAnimationPosition','0.75');const sampleBefore=await text('#sceneAnimationValues');
  await choose(sourceInstance);await copyTrack();assert.match(await text('#sceneAnimationTrackCopyStatus'),/已保留/);assert.equal(await text('#sceneAnimationAfter'),previousReview);assert.equal(await value('#sceneAnimationPosition'),'0.75');assert.equal(await text('#sceneAnimationValues'),sampleBefore);assert.equal(await evaluate("document.querySelector('#sceneAnimationApply').disabled"),false);
  await click('#sceneAnimationPlay');await copyTrack();assert.equal(await evaluate("document.querySelector('#sceneAnimationPause').disabled"),false);await click('#sceneAnimationPause');await fill('#sceneAnimationPosition','0.75');
  await choose(targetInstance);assert.equal(await text('#sceneAnimationAfter'),previousReview);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']) {
    await evaluate("(window.__target=document.querySelector('#sceneAnimationTrackCopyTarget'),window.__target.focus())");await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate("document.querySelector('#sceneAnimationTrackCopyTarget')===window.__target&&document.activeElement===window.__target"),true);assert.equal(await value('#sceneAnimationTrackCopySource'),sourceTrack);assert.equal(await value('#sceneAnimationTrackCopyTarget'),targetInstance);assert.equal(await text('#sceneAnimationAfter'),previousReview);assert.equal(await value('#sceneAnimationPosition'),'0.75');
    assert.ok((await text('#sceneAnimationTrackCopySourceDetail')).includes(sourceTrack));assert.ok((await text('#sceneAnimationTrackCopyTargetDetail')).includes(targetInstance));await evaluate("document.querySelector('#sceneAnimationTrackCopySource').scrollIntoView({block:'start'})");
    const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneAnimationDialog'),fits=id=>{const b=document.querySelector(id).getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth;};return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,source:fits('#sceneAnimationTrackCopySource'),target:fits('#sceneAnimationTrackCopyTarget'),action:fits('#sceneAnimationTrackCopyApply'),cancel:fits('#sceneAnimationCancel'),check:fits('#sceneAnimationCheck'),apply:fits('#sceneAnimationApply')};})()`);
    assert.ok(Object.values(layout).every(Boolean),JSON.stringify(layout));report.layout[language]=layout;await screenshot(`track-copy-${language}-390.png`);
  }
  await close();await unchanged();await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");
  report.steps.push('Source and target require explicit selection from the current form and saved scene directory. Copying onto the same instance/property fails while retaining reviewed bytes, field values and paused or running preview. Selecting choices and switching Chinese/English/Japanese at390px preserve review, selected full UUIDs and focused select nodes. Controls fit. Cancel writes no author files or source draft.');

  const prepare=async()=>{
    await open();await alterValues();await choose(targetInstance);await copyTrack();assert.equal(await value('#sceneAnimationTrack4Instance'),targetInstance);assert.equal(await value('#sceneAnimationTrack4Key1X'),'2');assert.equal(await evaluate("document.querySelector('#sceneAnimationApply').disabled"),true);assert.equal(await evaluate("document.querySelector('#sceneAnimationPlay').disabled"),true);await unchanged();await check();
    const content=await text('#sceneAnimationAfter'),copied=JSON.parse(content.replace(/^\ufeff/,'')),expected=structuredClone(document);expected.tracks[0].keyframes[1].value=2;expected.clips[0].name='Attack edited / 攻撃';
    const newTrack=copied.tracks.at(-1);assert.match(newTrack.id,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(expected.tracks.some(track=>track.id===newTrack.id),false);
    expected.tracks.push({...structuredClone(expected.tracks[0]),id:newTrack.id,instanceId:targetInstance});assert.deepEqual(copied,expected);await fill('#sceneAnimationPreviewClip',document.clips[0].id,'change');
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#sceneAnimationStage .scene-animation-shape')).map(element=>element.textContent)"),['2','2']);return{content,copied};
  };
  await prepare();await evaluate("document.querySelector('#sceneAnimationTrackCopy').scrollIntoView({block:'start'})");await screenshot('track-copy-reviewed-desktop.png');await close();await unchanged();
  report.steps.push('Rust WASM copies the current unsaved sprite track to the selected second instance with a fresh UUID. Every existing track, clip, value and setting is preserved semantically, including the edited source frame and clip name. The new track retains the source grid and frame indices. Both schematic targets sample frame2. The result requires a fresh check/review, and cancelling that review writes nothing.');
  const{content:saved,copied:savedDocument}=await prepare();await click('#sceneAnimationApply');await wait(()=>evaluate("!document.querySelector('#sceneAnimationDialog').open"),'applied to draft');assert.equal(await value('#docSourceEditor'),visible(saved));assert.deepEqual(await authorTree(root),initial);
  await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readSource()===saved,'ordinary track copy save');await wait(()=>evaluate("!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges"),'saved source settled');
  const expectedAuthor={...initial,[manifestPath]:buildHash(Buffer.from(saved))};assert.deepEqual(await authorTree(root),expectedAuthor);assert.ok(saved.startsWith('\ufeff'));assert.equal(saved.replaceAll('\r\n','').includes('\n'),false);
  report.saved={onlyChangedAuthorPath:manifestPath,beforeSha256:buildHash(Buffer.from(original)),afterSha256:buildHash(Buffer.from(saved)),bomCrlfPreserved:true,newTrack:savedDocument.tracks.at(-1)};
  report.steps.push('Apply changes only the ordinary source draft. Ordinary Save writes exactly the reviewed BOM/CRLF animation. Scene documents, registrations, both distinct image assets, templates and every other author file retain their bytes.');

  await evaluate(`(()=>{const original=window.fetch.bind(window);window.__sceneCaptures=[];window.fetch=async(input,init)=>{const response=await original(input,init);if(String(input).includes('/api/scene-preview')&&init?.method==='POST'){const body=await response.clone().json();window.__sceneCaptures.push(body.data||body);}return response;};})()`);
  await enabled('#projectBuildBtn');await click('#projectBuildBtn');await enabled('#projectBuildScene');await fill('#projectBuildScene',sceneId,'change');await click('#projectBuildTabPreview');await enabled('#scenePreviewAnimationPlay');
  const captured=await evaluate('window.__sceneCaptures.at(-1)');assert.equal(captured.animationPreview.status,'ready');assert.deepEqual(captured.animationPreview.document,savedDocument);
  await evaluate(`(()=>{const canvas=document.querySelector('#scenePreviewCanvas'),ctx=canvas.getContext('2d'),draw=ctx.drawImage.bind(ctx);window.__imageFrames=[];ctx.drawImage=(...args)=>{const m=ctx.getTransform();window.__imageFrames.push({matrix:[m.a,m.b,m.c,m.d,m.e,m.f],image:[args[0].width,args[0].height],args:args.slice(1)});if(window.__imageFrames.length>20)window.__imageFrames.shift();return draw(...args);};})()`);
  const drawnActors=()=>evaluate(`(()=>{const c=document.querySelector('#scenePreviewCanvas'),ctx=c.getContext('2d');return window.__imageFrames.slice(-2).map(frame=>{const args=frame.args,[x,y,w,h]=args.slice(-4),[a,b,cc,d,e,f]=frame.matrix;const at=(u,v)=>[Math.round(a*(x+w*u)+cc*(y+h*v)+e),Math.round(b*(x+w*u)+d*(y+h*v)+f)];return{...frame,colors:[[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([u,v])=>Array.from(ctx.getImageData(...at(u,v),1,1).data))};});})()`);
  await click('#scenePreviewFit');await fill('#scenePreviewAnimationClip',document.clips[0].id,'change');assert.equal(await value('#scenePreviewAnimationPosition'),'0');const actors=await drawnActors();
  assert.deepEqual(actors[0].colors,Array(4).fill([48,96,224,255]));assert.deepEqual(actors[1].colors,Array(4).fill([224,144,48,255]));assert.deepEqual(actors[0].args.slice(0,4),actors[1].args.slice(0,4));report.preview={actors,sourceImageId:imported.asset.id,targetImageId:targetImported.asset.id};
  await evaluate("document.querySelector('#scenePreviewAnimation').scrollIntoView({block:'center'})");await screenshot('track-copy-saved-preview.png');await click('#projectBuildClose');assert.deepEqual(await authorTree(root),expectedAuthor);assert.deepEqual(report.errors,[]);report.authorFilesPreserved=Object.keys(initial).length-1;
  report.steps.push('Saved scene preview freezes the exact copied document. Actual Canvas pixels show both instances cropping frame2, but the source is blue and the target orange from its own distinct image. Copying did not replace target resources. Preview makes no further author writes and no browser exceptions occurred.');
  for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);
  report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));}
