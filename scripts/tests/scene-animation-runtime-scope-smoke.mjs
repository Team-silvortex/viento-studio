// Real Chrome authoring for explicit runtime playback scope, using only a disposable workspace.
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
import { buildHash, captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER } from '../backends/godot4-adapter.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/animation-instance-runtime');
const output = path.resolve(process.env.VIENTO_ANIMATION_RUNTIME_SCOPE_OUTPUT || path.join(evidenceRoot, `browser-scope-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new directory beneath the animation instance runtime evidence.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
 'Actual Chrome with the source HTTP editor on a disposable copied animation workspace. This is source validation, not installed Tauri or Android acceptance.',
 'Real Chrome Canvas samples use the local Rust WASM core and frozen imported SVG bytes; no native Godot or packaged app claim.',
 'Checks explicit runtime scope, full review, ordinary Save, immutable saved preview and frozen build-plan declarations. The standalone-scene rejection is called through the actual adapter generator without executing Godot; native execution is tested separately.',
] };
const sources = ['engine/scene-animation-core.mjs','engine/scene-animation-edit.mjs','engine/scene-animation.mjs','engine/studio-core.mjs','engine/studio-core.wasm','engine/studio-modules.mjs',
 'web/modules/app-scene-animation.js','web/modules/app-scene-animation-source.js','web/modules/scene-animation-player.js','web/modules/scene-animation-preview.js','web/scene-animation.css',
 'web/modules/app-runtime.js','web/modules/app-studio-system.js','web/i18n/en.js','web/i18n/ja.js','scripts/tests/scene-animation-runtime-scope-smoke.mjs','scripts/backends/godot4-adapter.mjs','engine/build-plan.mjs','engine/project-assembly-plan.mjs','engine/backend-capabilities.mjs','engine/scene-animation-instance-playback.mjs','web/modules/app-scene-animation-retime.js','engine/scene-animation-preview.mjs','engine/scene-animation-visual-frame.mjs','engine/scene-animation-sprite-layout.mjs','web/modules/app-scene-preview.js','web/modules/app-scene-preview-canvas.js','web/modules/app-scene-preview-animation.js','scripts/lib/scene-preview-service.mjs'];
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-animation-runtime-scope-browser-'));
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
  const assemblyId='91919191-9191-4191-8191-000000000001',assemblyPath='documents/scenes/scope-project.json';
  await fs.writeFile(path.join(root,assemblyPath),JSON.stringify({format:'viento-project-assembly',schemaVersion:1,title:'Scope project',entrySceneId:sceneId,sceneIds:[sceneId]},null,2)+'\n');
  await fs.writeFile(path.join(root,'metadata/documents/'+assemblyId+'.json'),JSON.stringify({format:'viento-document',version:1,id:assemblyId,sourcePath:assemblyPath,documentType:'scene',parserProfile:'structured',relations:[{kind:'reference',targetId:sceneId,slot:'scene'}],assetBindings:[]},null,2)+'\n');

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
  const sampleSemantics=content=>content.split('\n\n').map(block=>{const[id,propertyValue]=block.split('\n');return {instanceId:id,value:JSON.parse(propertyValue.slice(propertyValue.indexOf(': ')+2))};});
  const projectHints={
    'zh-CN':'按实例运行目前需要从项目组装构建，单独场景构建暂不支持此范围；已保存场景预览仍可单独使用。',
    en:'Instance runtime scope currently requires a project assembly build; standalone scene builds do not support it yet. Saved-scene preview remains available independently.',
    ja:'インスタンス別の実行には、現在プロジェクトアセンブリからのビルドが必要です。単独シーンのビルドはまだこの範囲に対応していません。保存済みシーンのプレビューは単独でも利用できます。',
  };
  const unchanged=async(draft=original)=>{assert.deepEqual(await authorTree(root),initial);assert.equal(await value('#docSourceEditor'),visible(draft));};
  const check=async()=>{await enabled('#sceneAnimationCheck');await click('#sceneAnimationCheck');await enabled('#sceneAnimationApply');};

  await open(); assert.equal(await value('#sceneAnimationPlaybackScope'),'scene');assert.equal(await evaluate("document.querySelector('#sceneAnimationDialog').dataset.dirty"),'false');
  await click('#sceneAnimationCheck');await wait(()=>evaluate("document.querySelector('#sceneAnimationDialog').getAttribute('aria-busy')==='false'"),'unchanged check');assert.equal(await text('#sceneAnimationAfter'),'');
  await fill('#sceneAnimationPlaybackScope','instance','change');assert.equal(await evaluate("document.querySelector('#sceneAnimationPlaybackScopeProjectHint').hidden"),false);assert.equal(await evaluate("document.querySelector('#sceneAnimationDialog').dataset.dirty"),'true');
  await fill('#sceneAnimationPlaybackScope','scene','change');assert.equal(await evaluate("document.querySelector('#sceneAnimationDialog').dataset.dirty"),'false');await close();await unchanged();
  report.steps.push('Opening and checking the legacy schema3 animation leaves it unchanged. Selecting instance then returning to scene before review clears the local change; Cancel preserves every author file and source draft.');

  const prepare=async()=>{await open();await fill('#sceneAnimationPlaybackScope','instance','change');await check();const reviewed=await text('#sceneAnimationAfter'),candidate=JSON.parse(reviewed.replace(/^\ufeff/,''));assert.deepEqual(candidate,{...document,schemaVersion:4,playbackScope:'instance'});assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#sceneAnimationChangedPaths li')).map(n=>n.textContent)"),['/schemaVersion','/playbackScope']);assert.equal(await text('#sceneAnimationBefore'),original);await unchanged();return {reviewed,candidate};};
  const first=await prepare();await fill('#sceneAnimationPreviewClip',document.clips[0].id,'change');await fill('#sceneAnimationPosition','0.5');const sample=await text('#sceneAnimationValues');
  assert.ok(sample.includes(document.tracks[0].instanceId));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']){
    await evaluate("(window.__scope=document.querySelector('#sceneAnimationPlaybackScope'),window.__scope.focus())");await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate("document.querySelector('#sceneAnimationPlaybackScope')===window.__scope&&document.activeElement===window.__scope"),true);assert.equal(await value('#sceneAnimationPlaybackScope'),'instance');assert.equal(await text('#sceneAnimationAfter'),first.reviewed);assert.equal(await value('#sceneAnimationPosition'),'0.5');assert.deepEqual(sampleSemantics(await text('#sceneAnimationValues')),sampleSemantics(sample));assert.equal(await evaluate("document.querySelector('#sceneAnimationApply').disabled"),false);
    assert.equal(await text('#sceneAnimationPlaybackScopeProjectHint'),projectHints[language]);assert.equal(await evaluate("document.querySelector('#sceneAnimationPlaybackScopeProjectHint').hidden"),false);
    await evaluate("document.querySelector('#sceneAnimationPlaybackScope').scrollIntoView({block:'center'})");
    const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneAnimationDialog'),fits=id=>{const b=document.querySelector(id).getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth;};return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,scope:fits('#sceneAnimationPlaybackScope'),cancel:fits('#sceneAnimationCancel'),check:fits('#sceneAnimationCheck'),apply:fits('#sceneAnimationApply')};})()`);
    assert.ok(Object.values(layout).every(Boolean),JSON.stringify(layout));report.layout[language]=layout;await screenshot(`runtime-scope-${language}-390.png`);
  }
  await close();await unchanged();await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");
  report.steps.push('The explicit instance selection reviews only schemaVersion and playbackScope while all tracks, clips, IDs, values and loops remain equal. The actual Rust schematic preview accepts the v4 named clip. Chinese, English and Japanese at390px preserve the focused selector node, choice, approval and sampled clip time without horizontal overflow. Cancelling the reviewed change writes nothing.');

  const {reviewed:saved,candidate:savedDocument}=await prepare();await evaluate("document.querySelector('#sceneAnimationPlaybackScope').scrollIntoView({block:'center'})");await screenshot('runtime-scope-reviewed-desktop.png');
  await click('#sceneAnimationApply');await wait(()=>evaluate("!document.querySelector('#sceneAnimationDialog').open"),'apply to ordinary draft');assert.equal(await value('#docSourceEditor'),visible(saved));assert.deepEqual(await authorTree(root),initial);
  await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readSource()===saved,'ordinary scope Save');await wait(()=>evaluate("!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges"),'ordinary saved source settled');
  const expectedAuthor={...initial,[manifestPath]:buildHash(Buffer.from(saved))};assert.deepEqual(await authorTree(root),expectedAuthor);assert.ok(saved.startsWith('\ufeff'));assert.equal(saved.replaceAll('\r\n','').includes('\n'),false);
  report.saved={onlyChangedAuthorPath:manifestPath,beforeSha256:buildHash(Buffer.from(original)),afterSha256:buildHash(Buffer.from(saved)),bomCrlfPreserved:true,document:savedDocument};
  report.steps.push('Apply modifies only the ordinary source draft; Save writes exactly the reviewed BOM/CRLF animation. Every scene, assembly, registration, template, image and other author file remains byte-identical.');

  await open();assert.equal(await value('#sceneAnimationPlaybackScope'),'instance');await fill('#sceneAnimationPlaybackScope','scene','change');await check();const returned=JSON.parse((await text('#sceneAnimationAfter')).replace(/^\ufeff/,''));assert.deepEqual(returned,{...savedDocument,playbackScope:'scene'});assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#sceneAnimationChangedPaths li')).map(n=>n.textContent)"),['/playbackScope']);await close();assert.equal(await readSource(),saved);assert.deepEqual(await authorTree(root),expectedAuthor);
  report.steps.push('Reopening the saved v4 source restores its instance choice. Reviewing a return to scene changes only playbackScope and retains schema4; cancelling keeps the saved instance setting intact.');

  await evaluate(`(()=>{const original=window.fetch.bind(window);window.__sceneCaptures=[];window.fetch=async(input,init)=>{const response=await original(input,init);if(String(input).includes('/api/scene-preview')&&init?.method==='POST'){const body=await response.clone().json();window.__sceneCaptures.push(body.data||body);}return response;};})()`);
  await enabled('#projectBuildBtn');await click('#projectBuildBtn');await enabled('#projectBuildScene');await fill('#projectBuildScene',sceneId,'change');await click('#projectBuildTabPreview');await enabled('#scenePreviewAnimationMode');
  const captured=await evaluate('window.__sceneCaptures.at(-1)');assert.equal(captured.animationPreview.status,'ready');assert.deepEqual(captured.animationPreview.document,savedDocument);
  assert.equal(await value('#scenePreviewAnimationMode'),'scene');await fill('#scenePreviewAnimationMode','instance','change');await enabled('#scenePreviewInstanceAnimationPlay');await fill('#scenePreviewInstanceAnimationClip',document.clips[0].id,'change');await fill('#scenePreviewInstanceAnimationPosition','0.5');assert.equal(await value('#scenePreviewInstanceAnimationPosition'),'0.5');
  await evaluate("document.querySelector('#scenePreviewInstanceAnimationTitle').scrollIntoView({block:'center'})");await screenshot('runtime-scope-independent-saved-preview.png');await fill('#scenePreviewAnimationMode','scene','change');await enabled('#scenePreviewAnimationPlay');await click('#projectBuildClose');
  assert.deepEqual(await authorTree(root),expectedAuthor);assert.equal((await readSource()),saved);
  report.steps.push('Saved scene preview captures the exact schema4 source. Switching its temporary mode from whole scene to instance and back, selecting a clip and seeking does not change the runtime playbackScope or any author file.');

  const sceneSnapshot=await captureBuildSnapshot(root,sceneId);assert.equal(sceneSnapshot.ok,true,JSON.stringify(sceneSnapshot.diagnostics));assert.equal(sceneSnapshot.plan.animation.schemaVersion,3);assert.equal(sceneSnapshot.plan.animation.document.playbackScope,'instance');assert.ok(sceneSnapshot.plan.requiredCapabilities.includes('animation.instances2d'));
  await assert.rejects(GODOT4_EXECUTION_ADAPTER.generate(sceneSnapshot.plan),{errorCode:'build_animation_instances_require_project'});
  const assembled=await captureBuildSnapshot(root,assemblyId);assert.equal(assembled.ok,true,JSON.stringify(assembled.diagnostics));assert.equal(assembled.plan.kind,'project');assert.equal(assembled.plan.schemaVersion,1);assert.ok(assembled.plan.requiredCapabilities.includes('animation.instances2d'));assert.equal(assembled.plan.scenes[0].animation.schemaVersion,3);assert.deepEqual(assembled.plan.scenes[0].animation.document,savedDocument);
  report.plan={sceneSnapshotId:sceneSnapshot.snapshotId,sceneSchemaVersion:sceneSnapshot.plan.schemaVersion,animationSchemaVersion:sceneSnapshot.plan.animation.schemaVersion,requiredCapabilities:sceneSnapshot.plan.requiredCapabilities,standaloneRejection:'build_animation_instances_require_project',assemblySnapshotId:assembled.snapshotId,assemblySchemaVersion:assembled.plan.schemaVersion,assemblyCapabilities:assembled.plan.requiredCapabilities};
  await fs.writeFile(path.join(output,'saved-plans.json'),JSON.stringify({scene:sceneSnapshot.plan,project:assembled.plan},null,2)+'\n');
  report.steps.push('The real saved-byte build capture produces animation subplan3 and animation.instances2d for both scene and assembly. The actual adapter generator explicitly rejects standalone instance-scope scene generation; project assembly remains parent schema1. No Godot process is executed.');
  assert.deepEqual(await authorTree(root),expectedAuthor);assert.deepEqual(report.errors,[]);report.authorFilesPreserved=Object.keys(initial).length-1;
  for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);
  report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));}
