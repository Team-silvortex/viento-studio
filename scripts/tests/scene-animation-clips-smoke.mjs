// Real browser named-clip authoring, source review/save and frozen image scene preview.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-animation-clips');
const output = path.resolve(process.env.VIENTO_ANIMATION_CLIPS_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new directory beneath scene-animation-clips evidence.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
 'Actual Chrome with local HTTP editor on a disposable copied animation workspace. No installed Tauri or Android device acceptance.',
 'Real Chrome Canvas samples use the local Rust WASM core and frozen imported SVG bytes; no native Godot or packaged app claim.',
 'Checks browser field editing, review, ordinary Save and frozen Canvas preview. Native Godot clip commands are covered by separate service/runtime tests.',
] };
const sources = ['engine/scene-animation-core.mjs','engine/scene-animation-edit.mjs','engine/scene-animation.mjs','engine/studio-core.mjs','engine/studio-core.wasm','engine/studio-modules.mjs',
 'web/modules/app-scene-animation.js','web/modules/app-scene-animation-source.js','web/modules/scene-animation-player.js','web/modules/scene-animation-preview.js','web/scene-animation.css',
 'web/modules/app-runtime.js','web/modules/app-studio-system.js','web/i18n/en.js','web/i18n/ja.js','scripts/tests/scene-animation-clips-smoke.mjs','web/modules/app-scene-animation-clips.js','engine/scene-animation-preview.mjs','engine/scene-animation-visual-frame.mjs','engine/scene-animation-sprite-layout.mjs','web/modules/app-scene-preview.js','web/modules/app-scene-preview-canvas.js','web/modules/app-scene-preview-animation.js','scripts/lib/scene-preview-service.mjs'];
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-animation-clips-browser-'));
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
  const document = JSON.parse(await fs.readFile(manifestFile, 'utf8')); document.schemaVersion = 2; document.tracks = [{ ...document.tracks[0], property:'spriteFrame2d', interpolation:'step', grid:{columns:2,rows:2},keyframes:[{atSeconds:0,value:0},{atSeconds:.5,value:1},{atSeconds:1.5,value:3}] }];
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

  const prepareClips = async () => {
    await click('#sceneAnimationAddClip');
    await fill('#sceneAnimationClip0Name', 'Attack <b>'); await fill('#sceneAnimationClip0Start','0.5'); await fill('#sceneAnimationClip0End','1.5'); await fill('#sceneAnimationClip0Loop','false','change');
    await click('#sceneAnimationAddClip');
    await fill('#sceneAnimationClip1Name','Idle'); await fill('#sceneAnimationClip1Start','1.5'); await fill('#sceneAnimationClip1End','2'); await fill('#sceneAnimationClip1Loop','true','change');
  };
  await open(); await prepareClips(); await check();
  const reviewed=await text('#sceneAnimationAfter'),checked=JSON.parse(reviewed.replace(/^\ufeff/,''));
  assert.equal(checked.schemaVersion,3); assert.deepEqual(checked.tracks,document.tracks); assert.equal(checked.clips.length,2);
  const selected=checked.clips[0].id;
  await fill('#sceneAnimationPreviewClip',selected,'change'); assert.equal(await value('#sceneAnimationPosition'),'0'); assert.equal(await evaluate("document.querySelector('#sceneAnimationPosition').max"),'1');
  assert.equal(await text('#sceneAnimationStage .scene-animation-shape'),'1'); await fill('#sceneAnimationPosition','1'); assert.equal(await text('#sceneAnimationStage .scene-animation-shape'),'3');
  await unchanged(); await evaluate("document.querySelector('#sceneAnimationClips').scrollIntoView({block:'start'})"); await screenshot('clips-editor-desktop.png');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']) {
    await evaluate("(window.__name=document.querySelector('#sceneAnimationClip0Name'),window.__name.focus(),window.__name.setSelectionRange(0,6))");
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate("document.querySelector('#sceneAnimationClip0Name')===window.__name&&document.activeElement===window.__name&&window.__name.selectionStart===0&&window.__name.selectionEnd===6"),true);
    assert.equal(await value('#sceneAnimationClip0Name'),'Attack <b>'); assert.equal(await text('#sceneAnimationAfter'),reviewed); assert.equal(await value('#sceneAnimationPreviewClip'),selected);
    await evaluate("document.querySelector('#sceneAnimationClip0Name').scrollIntoView({block:'center'})");
    const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneAnimationDialog'),r=id=>{const b=document.querySelector(id).getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth;};return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,name:r('#sceneAnimationClip0Name'),cancel:r('#sceneAnimationCancel'),check:r('#sceneAnimationCheck'),apply:r('#sceneAnimationApply')};})()`);
    assert.ok(Object.values(layout).every(Boolean),JSON.stringify(layout));report.layout[language]=layout;await screenshot(`clips-editor-${language}-390.png`);
  }
  await close();await unchanged();await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");
  report.steps.push('Real field editor adds two overlapping-capable stable-UUID clip records to a schema2 sprite document, preserving every track and reviewing schema3. Schematic selection starts at global0.5/local0/frame1; local1 reaches global1.5/frame3. Chinese/English/Japanese at390px preserve focused authored name, cursor, selected UUID and full review. Cancel changes no author bytes or source draft.');

  await open();await prepareClips();await check();const saved=await text('#sceneAnimationAfter'),savedDocument=JSON.parse(saved.replace(/^\ufeff/,'')),attack=savedDocument.clips[0].id,idle=savedDocument.clips[1].id;
  assert.deepEqual(savedDocument.tracks,document.tracks);await click('#sceneAnimationApply');await wait(()=>evaluate("!document.querySelector('#sceneAnimationDialog').open"),'applied to draft');
  assert.equal(await value('#docSourceEditor'),visible(saved));assert.deepEqual(await authorTree(root),initial);
  await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readSource()===saved,'ordinary clip save');await wait(()=>evaluate("!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges"),'saved source settled');
  const expectedAuthor={...initial,[manifestPath]:buildHash(Buffer.from(saved))};assert.deepEqual(await authorTree(root),expectedAuthor);assert.ok(saved.startsWith('\ufeff'));assert.equal(saved.replaceAll('\r\n','').includes('\n'),false);
  report.saved={onlyChangedAuthorPath:manifestPath,beforeSha256:buildHash(Buffer.from(original)),afterSha256:buildHash(Buffer.from(saved)),bomCrlfPreserved:true,clips:savedDocument.clips};
  report.steps.push('Apply only updates the ordinary editor draft. Normal Save persists exactly the reviewed source with BOM/CRLF, while tracks, scene, assets, registrations, templates and all other author bytes remain unchanged.');

  await evaluate(`(()=>{const original=window.fetch.bind(window);window.__sceneCaptures=[];window.__released=[];window.fetch=async(input,init)=>{const url=String(input),response=await original(input,init);if(url.includes('/api/scene-preview')&&init?.method==='DELETE')window.__released.push(url);if(url.includes('/api/scene-preview')&&init?.method==='POST'){const body=await response.clone().json();window.__sceneCaptures.push(body.data||body);}return response;};})()`);
  await enabled('#projectBuildBtn');await click('#projectBuildBtn');await enabled('#projectBuildScene');await fill('#projectBuildScene',sceneId,'change');await click('#projectBuildTabPreview');await enabled('#scenePreviewAnimationPlay');await enabled('#scenePreviewRefresh');
  const captured=await evaluate('window.__sceneCaptures.at(-1)');assert.equal(captured.animationPreview.status,'ready');assert.deepEqual(captured.animationPreview.document,savedDocument);
  await evaluate(`(()=>{const canvas=document.querySelector('#scenePreviewCanvas'),ctx=canvas.getContext('2d'),draw=ctx.drawImage.bind(ctx);window.__imageFrames=[];ctx.drawImage=(...args)=>{const m=ctx.getTransform();window.__imageFrames.push({matrix:[m.a,m.b,m.c,m.d,m.e,m.f],image:[args[0].width,args[0].height],args:args.slice(1)});if(window.__imageFrames.length>20)window.__imageFrames.shift();return draw(...args);};})()`);
  const canvasHash=()=>evaluate(`(()=>{const c=document.querySelector('#scenePreviewCanvas'),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let hash=2166136261;for(const v of data)hash=Math.imul(hash^v,16777619);return hash>>>0;})()`);
  const drawnActors=()=>evaluate(`(()=>{const c=document.querySelector('#scenePreviewCanvas'),ctx=c.getContext('2d');return window.__imageFrames.slice(-2).map(frame=>{const args=frame.args,[x,y,w,h]=args.slice(-4),[a,b,cc,d,e,f]=frame.matrix;const at=(u,v)=>[Math.round(a*(x+w*u)+cc*(y+h*v)+e),Math.round(b*(x+w*u)+d*(y+h*v)+f)];return{...frame,colors:[[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([u,v])=>Array.from(ctx.getImageData(...at(u,v),1,1).data))};});})()`);
  await click('#scenePreviewFit');const staticHash=await canvasHash(),initialActors=await drawnActors();report.frames=[];
  const colors=[[224,48,48,255],[48,192,96,255],[48,96,224,255],[224,192,48,255]];
  for(const[clip,local,index]of[[attack,'0',1],[attack,'1',3],[idle,'0.5',3],['','0',0]]){
    await fill('#scenePreviewAnimationClip',clip,'change');assert.equal(await value('#scenePreviewAnimationPosition'),'0');await fill('#scenePreviewAnimationPosition',local);const actors=await drawnActors();
    assert.deepEqual(actors[0].colors,Array(4).fill(colors[index]));assert.deepEqual(actors[1].colors,initialActors[1].colors);report.frames.push({clip:clip||null,local:Number(local),index,actors});
  }
  await fill('#scenePreviewAnimationClip',attack,'change');assert.equal(await evaluate("document.querySelector('#scenePreviewAnimationPosition').max"),'1');assert.equal(await evaluate("document.querySelector('#scenePreviewAnimationPause').disabled"),true);
  await click('#scenePreviewAnimationPlay');await delay(100);await fill('#scenePreviewAnimationClip',idle,'change');await delay(80);assert.equal(await value('#scenePreviewAnimationPosition'),'0');assert.equal(await evaluate("document.querySelector('#scenePreviewAnimationPosition').max"),'0.5');assert.equal(await evaluate("document.querySelector('#scenePreviewAnimationPause').disabled"),true);
  await evaluate("document.querySelector('#scenePreviewAnimation').scrollIntoView({block:'center'})");await screenshot('clips-scene-desktop.png');
  await click('#scenePreviewAnimationStop');assert.equal(await canvasHash(),staticHash);assert.equal(await evaluate("document.querySelector('#scenePreviewLayoutEdit').disabled"),false);
  report.steps.push('Saved preview freezes the reviewed schema3 document and imported image. Actual Canvas pixels confirm Attack local0/global0.5 is green frame1 and local1/global1.5 is yellow frame3, Idle loops within its0.5s range, and whole selection restores frame0. The second instance retains its full sprite sheet. Switching a running preview pauses at the new clip start and no old clock advances it.');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']){
    await fill('#scenePreviewAnimationClip',attack,'change');await fill('#scenePreviewAnimationPosition','0.25');await evaluate("(window.__selector=document.querySelector('#scenePreviewAnimationClip'),window.__selector.focus())");await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate("document.activeElement===window.__selector&&document.querySelector('#scenePreviewAnimationClip')===window.__selector"),true);assert.equal(await value('#scenePreviewAnimationClip'),attack);assert.equal(await value('#scenePreviewAnimationPosition'),'0.25');await evaluate("document.querySelector('#scenePreviewAnimation').scrollIntoView({block:'start'})");
    const layout=await evaluate(`(()=>{const d=document.querySelector('#projectBuildDialog'),s=document.querySelector('#scenePreviewAnimationClip').getBoundingClientRect();return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,selectorFits:s.left>=0&&s.right<=innerWidth};})()`);assert.ok(Object.values(layout).every(Boolean),JSON.stringify(layout));report.layout['preview-'+language]=layout;await screenshot(`clips-scene-${language}-390.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride');await click('#scenePreviewAnimationStop');assert.equal(await evaluate("document.querySelector('#scenePreviewLayoutEdit').disabled"),false);
  await click('#scenePreviewRefresh');await enabled('#scenePreviewAnimationPlay');assert.equal(await value('#scenePreviewAnimationClip'),'');assert.equal(await value('#scenePreviewAnimationPosition'),'0');await wait(()=>evaluate('window.__released.length>0'),'old preview released');await click('#projectBuildClose');
  assert.deepEqual(await authorTree(root),expectedAuthor);assert.deepEqual(report.errors,[]);report.authorFilesPreserved=Object.keys(initial).length-1;
  report.steps.push('Saved clip selector and source-range hints fit390px in all three languages, preserving focused control, selected identity and paused local time. Stop restores exact static Canvas pixels and layout access. Refresh resets selection and releases the old frozen snapshot. No browser exceptions or unintended author writes.');
  for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);
  report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));}
