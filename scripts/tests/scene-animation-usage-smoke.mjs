// Real browser explicit saved animation-clip usage and readonly source navigation; ordinary scalar editing and save remain separate.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-animation-usage');
const output = path.resolve(process.env.VIENTO_ANIMATION_USAGE_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new directory beneath scene-animation-usage evidence.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
 'Actual Chrome with local HTTP editor on a disposable copied author workspace. No installed Tauri or Android device acceptance.',
 'Only complete UUID strings in saved same-scene behavior parameters are matched; this is not static script analysis or persistent reference protection.',
 'The directory validates saved scene/animation registration and document semantics. No rendering, script execution or engine command is claimed.'
] };
const sources = ['engine/scene-animation-usage.mjs', 'scripts/lib/scene-animation-usage-service.mjs', 'scripts/lib/doc-api-service.mjs', 'scripts/lib/doc-server-routes.mjs',
 'web/modules/app-scene-animation.js','web/modules/app-scene-animation-clips.js','web/modules/app-scene-animation-usage.js','web/modules/app-source-location.js','web/modules/app-source-reveal.js','web/scene-animation.css','web/modules/app-scene-animation-source.js', 'web/modules/app-runtime.js', 'web/modules/app-doc-service.js',
 'engine/scene-behaviors.mjs', 'engine/scene-behaviors-edit.mjs', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/scene-animation-usage-smoke.mjs'];
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-behavior-authoring-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'author'), download = path.join(temporary, 'downloads');
  await fs.cp(path.join(appRoot, 'examples/scene-behaviors'), root, { recursive: true }); await fs.mkdir(download);
  const manifestPath = 'documents/animations/demo.json', manifestFile = path.join(root, manifestPath);
  const animationRoot = path.join(appRoot, 'examples/scene-animation');
  for (const relative of ['documents/animations', 'templates/animation.json', 'metadata/documents/88888888-8888-4888-8888-888888888887.json']) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await fs.cp(path.join(animationRoot, relative), path.join(root, relative), { recursive: true });
  }
  const animationFile=path.join(root,'documents/animations/demo.json'),animation=JSON.parse(await fs.readFile(animationFile,'utf8'));
  animation.schemaVersion=3;animation.clips=[{id:'77777777-7777-4777-8777-000000000001',name:'Attack <b>',startSeconds:0,endSeconds:1,loop:false},{id:'77777777-7777-4777-8777-000000000002',name:'Attack <b>',startSeconds:.5,endSeconds:2,loop:true}];
  await fs.writeFile(animationFile,JSON.stringify(animation,null,2)+'\n');
  const workspacePath = path.join(root, 'workspace.json'), workspace = JSON.parse(await fs.readFile(workspacePath, 'utf8'));
  workspace.documentTypes.push(JSON.parse(await fs.readFile(path.join(animationRoot, 'workspace.json'), 'utf8')).documentTypes.find(type => type.id === 'animation'));
  await fs.writeFile(workspacePath, JSON.stringify(workspace, null, 2) + '\n');
  const sceneMetaPath = path.join(root, 'metadata/documents/dddddddd-dddd-4ddd-8ddd-dddddddddddd.json'), sceneMeta = JSON.parse(await fs.readFile(sceneMetaPath, 'utf8'));
  sceneMeta.relations.push({kind: 'animation', targetId: '88888888-8888-4888-8888-888888888887', slot: 'animation'});
  await fs.writeFile(sceneMetaPath, JSON.stringify(sceneMeta, null, 2) + '\n');
  const behaviorFile=path.join(root,'documents/behaviors/demo.json'),behavior=JSON.parse(await fs.readFile(behaviorFile,'utf8'));
  for(const binding of behavior.bindings)binding.parameters={embedded:'中文🙂 prefix 77777777-7777-4777-8777-000000000001 suffix',arbitrary:'77777777-7777-4777-8777-000000000001',alias_clip:'77777777-7777-4777-8777-000000000001',other:'77777777-7777-4777-8777-000000000002',future:'77777777-7777-4777-8777-000000000003'};
  await fs.writeFile(behaviorFile,'\ufeff'+JSON.stringify(behavior,null,2).replaceAll('\n','\r\n')+'\r\n');
  const original='\ufeff'+(await fs.readFile(manifestFile,'utf8')).replaceAll('\n','\r\n');await fs.writeFile(manifestFile,original);
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
  await call('Page.addScriptToEvaluateOnNewDocument', {source: `(()=>{
    window.__assetReads=0;window.__usageReads=0;const original=window.fetch;
    window.fetch=async(input,init)=>{const url=String(input);if(url.startsWith('/asset-files/'))window.__assetReads++;
      if(url==='/api/scene-animation-usage'){
        window.__usageReads++;
        if(window.__failUsage){window.__failUsage=false;return new Response(JSON.stringify({error:'Test directory unavailable'}),{status:503,headers:{'Content-Type':'application/json'}});}
        const response=await original(input,init);
        if(window.__holdUsage){window.__holdUsage=false;await new Promise(resolve=>window.__releaseUsage=resolve);}
        return response;
      }return original(input,init);
    };
  })()`});
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor startup');
  await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.includes('animations/demo'))`), 'behavior source in sidebar');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('animations/demo')).click()`);
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.activePath.includes('animations/demo')`), 'selected behavior source');
  await enabled('#docEditBtn'); await click('#docEditBtn'); await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`), 'source edit');
  await enabled('#docEditSourceModeBtn'); await click('#docEditSourceModeBtn'); await enabled('#sceneAnimationBtn');
  assert.equal(await value('#docSourceEditor'), visible(original));
  report.system = await evaluate(`(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()`);
  assert.ok(report.system.initializedModules.includes('org.viento.scene-animation'));
  const clip1='77777777-7777-4777-8777-000000000001',clip2='77777777-7777-4777-8777-000000000002',future='77777777-7777-4777-8777-000000000003';
  const open=async()=>{await enabled('#sceneAnimationBtn');await click('#sceneAnimationBtn');await enabled('#sceneAnimationClip0Name');await enabled('#sceneAnimationTrack0Target');};
  const close=async()=>{await click('#sceneAnimationCancel');await wait(()=>evaluate("!document.querySelector('#sceneAnimationDialog').open"),'animation closed');};
  const check=async()=>{await enabled('#sceneAnimationCheck');await click('#sceneAnimationCheck');await enabled('#sceneAnimationApply');};
  const status=expected=>wait(()=>evaluate(`document.querySelector('#sceneAnimationUsageStatus').dataset.status===${JSON.stringify(expected)}`),'usage '+expected);
  const text=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  const unchanged=async()=>{assert.deepEqual(await authorTree(root),initial);assert.equal(await value('#docSourceEditor'),visible(original));};
  await open();assert.equal(await evaluate('window.__usageReads'),0);await fill('#sceneAnimationClip0Name','Attack renamed');await check();const reviewed=await text('#sceneAnimationAfter');await click('#sceneAnimationPlay');
  await click('#sceneAnimationClip0Usage');await status('ready');assert.equal(await evaluate("document.querySelector('#sceneAnimationUsageMatches').children.length"),4);assert.equal(await evaluate("document.querySelector('#sceneAnimationPause').disabled"),false);assert.equal(await text('#sceneAnimationAfter'),reviewed);assert.equal(await evaluate("document.querySelector('#sceneAnimationApply').disabled"),false);assert.ok((await text('#sceneAnimationUsageMatches')).includes('arbitrary'));assert.ok(!(await text('#sceneAnimationUsageMatches')).includes('embedded'));
  await evaluate("document.querySelector('#sceneAnimationUsage').scrollIntoView({block:'start'})");await screenshot('usage-desktop.png');await unchanged();
  report.steps.push('Explicit clip usage reads only saved same-scene behaviors. Four complete UUID parameters match in author order; embedded prose is excluded. The local renamed form, reviewed proposal and active animation clock remain intact. No author files or source draft change.');

  await click('#sceneAnimationUsageMatch2Source');const sourceText=await value('#sceneAnimationUsageSourceText');const wanted=sourceText.lastIndexOf('"arbitrary": ')+13;
  const selection=await evaluate("(()=>{const s=document.querySelector('#sceneAnimationUsageSourceText');return{start:s.selectionStart,end:s.selectionEnd,text:s.value.slice(s.selectionStart,s.selectionEnd),readonly:s.readOnly,lang:s.getAttribute('lang')};})()");
  assert.equal(selection.text,JSON.stringify(clip1));assert.equal(selection.start,wanted);assert.equal(selection.readonly,true);assert.equal(selection.lang,'');assert.ok(sourceText.startsWith('\ufeff'));assert.ok((await text('#sceneAnimationUsageSourceField')).includes('/bindings/1/parameters/arbitrary'));report.sourceSelection=selection;
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']){
    await click('#sceneAnimationUsageSourceLocate');await evaluate("document.querySelector('#sceneAnimationUsageSourceText').scrollIntoView({block:'center'})");
    const before=await evaluate("(()=>{const s=document.querySelector('#sceneAnimationUsageSourceText');window.__source=s;return{start:s.selectionStart,end:s.selectionEnd,top:s.scrollTop,left:s.scrollLeft};})()");
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    const after=await evaluate("(()=>{const s=document.querySelector('#sceneAnimationUsageSourceText');return{same:s===window.__source,focused:document.activeElement===s,start:s.selectionStart,end:s.selectionEnd,top:s.scrollTop,left:s.scrollLeft};})()");assert.deepEqual(after,{same:true,focused:true,...before});assert.equal(await value('#sceneAnimationUsageSourceText'),sourceText);assert.equal(await text('#sceneAnimationAfter'),reviewed);assert.equal(await evaluate("document.querySelector('#sceneAnimationPause').disabled"),false);
    const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneAnimationDialog'),r=id=>{const b=document.querySelector(id).getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth;};return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,source:r('#sceneAnimationUsageSourceText'),cancel:r('#sceneAnimationCancel'),apply:r('#sceneAnimationApply')};})()`);assert.ok(Object.values(layout).every(Boolean),JSON.stringify(layout));report.layout[language]=layout;await screenshot(`usage-source-${language}-390.png`);
  }
  await close();await unchanged();await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");report.steps.push('Readonly saved-source navigation selects the second binding exact parameter token, not an earlier identical ID in prose. BOM/CRLF source is displayed with browser newline normalization only. At390px Chinese/English/Japanese retain the textarea node, focus, caret, scroll and active preview, with footer controls reachable. Cancel preserves original draft and every author file.');

  await open();await fill('#sceneAnimationClip0Name','Reviewed after retry');await check();const candidate=await text('#sceneAnimationAfter');await click('#sceneAnimationPlay');await evaluate('window.__failUsage=true');await click('#sceneAnimationClip0Usage');await status('failed');assert.equal(await text('#sceneAnimationAfter'),candidate);assert.equal(await evaluate("document.querySelector('#sceneAnimationPause').disabled"),false);await click('#sceneAnimationUsageRefresh');await status('ready');
  await fill('#sceneAnimationClip0Start','1e-');await evaluate("(window.__input=document.querySelector('#sceneAnimationClip0Start'),window.__input.focus(),window.__input.setSelectionRange(1,3))");await click('#sceneAnimationUsageRefresh');await status('ready');assert.equal(await value('#sceneAnimationClip0Start'),'1e-');assert.equal(await evaluate("document.querySelector('#sceneAnimationClip0Start')===window.__input&&document.activeElement===window.__input&&window.__input.selectionEnd===3"),true);await close();await unchanged();report.steps.push('An unavailable usage service preserves reviewed animation and active playback. Retry succeeds; subsequent reads keep an incomplete numeric field, original node and selection unchanged.');

  await open();await evaluate('(window.__holdUsage=true,window.__releaseUsage=null)');await click('#sceneAnimationClip0Usage');await wait(()=>evaluate("typeof window.__releaseUsage==='function'"),'held usage reply');await click('#sceneAnimationClip1Usage');await status('ready');await evaluate('window.__releaseUsage()');await delay(100);assert.equal(await evaluate("document.querySelector('#sceneAnimationUsage').dataset.clipId"),clip2);assert.equal(await evaluate("document.querySelector('#sceneAnimationUsageMatches').children.length"),2);await close();await unchanged();
  await open();await evaluate('(window.__holdUsage=true,window.__releaseUsage=null)');await click('#sceneAnimationClip0Usage');await wait(()=>evaluate("typeof window.__releaseUsage==='function'"),'second held reply');await close();await open();await evaluate('window.__releaseUsage()');await delay(100);assert.equal(await evaluate("document.querySelector('#sceneAnimationUsage').hidden"),true);await close();await unchanged();report.steps.push('Switching clips while a saved reply is held rejects the old result; closing and reopening rejects the previous session. Neither response fills or reopens the wrong usage panel.');

  await open();await click('#sceneAnimationClip0Usage');await status('ready');await evaluate(`(()=>{const c=window.crypto,o=c.randomUUID;c.randomUUID=()=>${JSON.stringify(future)};try{document.querySelector('#sceneAnimationAddClip').click();}finally{c.randomUUID=o;}})()`);await click('#sceneAnimationClip2Usage');assert.equal(await evaluate("document.querySelector('#sceneAnimationUsageMatches').children.length"),2);assert.ok((await text('#sceneAnimationUsageMatches')).includes('future'));assert.equal(await evaluate("document.querySelector('#sceneAnimationUsage').dataset.clipId"),future);await unchanged();await close();await unchanged();report.steps.push('A fixture-controlled newly allocated UUID can be checked before the clip is saved: the panel filters existing saved future-parameter matches, labels the clip as current-form data and performs no write.');

  await open();await click('#sceneAnimationClip0Usage');await status('ready');await click('#sceneAnimationUsageMatch0Source');await evaluate("window.__oldSource=document.querySelector('#sceneAnimationUsageMatch0Source')");await click('#sceneAnimationClip0Remove');assert.equal(await evaluate("document.querySelector('#sceneAnimationUsage').hidden"),true);await evaluate("window.__oldSource.click()");assert.equal(await evaluate("document.querySelector('#sceneAnimationUsageSource').hidden"),true);await check();const saved=await text('#sceneAnimationAfter');assert.deepEqual(JSON.parse(saved.replace(/^\ufeff/,'')).clips.map(clip=>clip.id),[clip2]);await click('#sceneAnimationApply');await wait(()=>evaluate("!document.querySelector('#sceneAnimationDialog').open"),'usage deletion applied');assert.equal(await value('#docSourceEditor'),visible(saved));assert.deepEqual(await authorTree(root),initial);await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readSource()===saved,'ordinary animation save');await wait(()=>evaluate("!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges"),'ordinary save settled');
  assert.deepEqual(await authorTree(root),{...initial,[manifestPath]:buildHash(Buffer.from(saved))});report.saved={onlyChangedAuthorPath:manifestPath,beforeSha256:buildHash(Buffer.from(original)),afterSha256:buildHash(Buffer.from(saved)),bomCrlfPreserved:saved.startsWith('\ufeff')&&!saved.replaceAll('\r\n','').includes('\n')};assert.equal(report.saved.bomCrlfPreserved,true);
  report.steps.push('Removing a referenced clip clears its usage/source view and invalidates the detached source button. Usage is advisory and does not block review: Apply changes only the ordinary draft; Save persists the exact reviewed BOM/CRLF animation. Saved behaviors and every other author file remain byte-identical.');
  report.counts=await evaluate('({assetReads:window.__assetReads,usageReads:window.__usageReads})');assert.equal(report.counts.assetReads,0);assert.deepEqual(report.errors,[]);report.authorFilesPreserved=Object.keys(initial).length-1;
  for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));}
