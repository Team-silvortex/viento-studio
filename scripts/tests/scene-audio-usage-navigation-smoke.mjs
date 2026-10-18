// Real browser cue navigation and exact saved-behavior source inspection without leaving audio drafts.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-audio-usage-navigation');
const output = path.resolve(process.env.VIENTO_AUDIO_USAGE_NAVIGATION_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new directory beneath scene-audio-usage-navigation evidence.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
 'Actual Chrome with local HTTP editor on a disposable copied author workspace. No installed Tauri or Android device acceptance.',
 'Behavior UUID matches are ordinary strings in one saved scene-selected document; no script interpretation, global usage guarantee, playback or engine execution.',
 'The usage service validates scene/audio/behavior registration. WAV bytes are absent; the World reader still reads document inventory and stats assets.'
] };
const sources = ['engine/scene-audio-usage.mjs','scripts/lib/scene-audio-usage-service.mjs','scripts/lib/doc-api-service.mjs','scripts/lib/doc-server-routes.mjs',
 'web/modules/app-scene-audio.js','web/scene-audio.css','web/modules/app-scene-audio-source.js','web/modules/app-runtime.js','web/modules/app-doc-service.js',
 'web/modules/app-source-location.js','web/modules/app-source-reveal.js','engine/json-source.mjs','engine/scene-audio-edit.mjs','engine/scene-audio-core.mjs','engine/scene-behaviors.mjs','web/i18n/en.js','web/i18n/ja.js','scripts/tests/scene-audio-usage-navigation-smoke.mjs'];
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
  const manifestPath = 'documents/audio/demo.json', manifestFile = path.join(root, manifestPath);
  const audioRoot = path.join(appRoot, 'examples/scene-audio');
  for (const relative of ['documents/audio', 'templates/audio.json', 'metadata/documents/88888888-8888-4888-8888-888888888888.json', 'metadata/assets/99999999-9999-4999-8999-999999999999.json']) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await fs.cp(path.join(audioRoot, relative), path.join(root, relative), { recursive: true });
  }
  // Do not copy tone.wav: choosing a saved identity must not demand playable bytes.
  const workspacePath = path.join(root, 'workspace.json'), workspace = JSON.parse(await fs.readFile(workspacePath, 'utf8'));
  workspace.documentTypes.push(JSON.parse(await fs.readFile(path.join(audioRoot, 'workspace.json'), 'utf8')).documentTypes.find(type => type.id === 'audio'));
  await fs.writeFile(workspacePath, JSON.stringify(workspace, null, 2) + '\n');
  const sceneMetaPath = path.join(root, 'metadata/documents/dddddddd-dddd-4ddd-8ddd-dddddddddddd.json'), sceneMeta = JSON.parse(await fs.readFile(sceneMetaPath, 'utf8'));
  sceneMeta.relations.push({kind: 'audio', targetId: '88888888-8888-4888-8888-888888888888', slot: 'audio'});
  await fs.writeFile(sceneMetaPath, JSON.stringify(sceneMeta, null, 2) + '\n');
  const behaviorFile = path.join(root,'documents/behaviors/demo.json'), behavior = JSON.parse(await fs.readFile(behaviorFile,'utf8'));
  behavior.bindings[0].parameters = { memo: '氛围 🌧️ 与字面文本', custom_sound: '77777777-7777-4777-8777-000000000001', alt_sound: '77777777-7777-4777-8777-000000000001', amount: 40 };
  behavior.bindings[1].parameters = { arbitrary_name: '77777777-7777-4777-8777-000000000002', shared_sound: '77777777-7777-4777-8777-000000000001', amount: 20 };
  const savedBehavior='\ufeff'+(JSON.stringify(behavior,null,2)+'\n').replace('\"alt_sound\": \"77777777','\"alt_sound\": \"\\u00377777777').replaceAll('\n','\r\n');
  await fs.writeFile(behaviorFile,savedBehavior);
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
  await call('Page.addScriptToEvaluateOnNewDocument', {source: `(()=>{
    window.__assetReads=0;window.__usageReads=0;const original=window.fetch;
    window.fetch=async(input,init)=>{const url=String(input);if(url.startsWith('/asset-files/'))window.__assetReads++;
      if(url==='/api/scene-audio-usage'){
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
  await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.includes('audio/demo'))`), 'behavior source in sidebar');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('audio/demo')).click()`);
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.activePath.includes('audio/demo')`), 'selected behavior source');
  await enabled('#docEditBtn'); await click('#docEditBtn'); await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`), 'source edit');
  await enabled('#docEditSourceModeBtn'); await click('#docEditSourceModeBtn'); await enabled('#sceneAudioBtn');
  assert.equal(await value('#docSourceEditor'), visible(original));
  report.system = await evaluate(`(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()`);
  assert.ok(report.system.initializedModules.includes('org.viento.scene-audio'));
  const track1='77777777-7777-4777-8777-000000000001',track2='77777777-7777-4777-8777-000000000002';
  const open=async()=>{await enabled('#sceneAudioBtn');await click('#sceneAudioBtn');await enabled('#sceneAudioTrack0Volume');};
  const close=async()=>{await click('#sceneAudioCancel');await wait(()=>evaluate("!document.querySelector('#sceneAudioDialog').open"),'closed');};
  const check=async()=>{await enabled('#sceneAudioCheck');await click('#sceneAudioCheck');await enabled('#sceneAudioApply');};
  const status=expected=>wait(()=>evaluate(`document.querySelector('#sceneAudioUsageStatus').dataset.status===${JSON.stringify(expected)}`),'usage '+expected);
  const text=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  const usage=async(index=0)=>{await click(`#sceneAudioTrack${index}Usage`);await status('ready');};
  const inspect=async(index=0)=>{await click(`#sceneAudioUsageMatch${index}Source`);await wait(()=>evaluate("!document.querySelector('#sceneAudioUsageSource').hidden"),'source visible');};
  const selection=()=>evaluate("(()=>{const e=document.querySelector('#sceneAudioUsageSourceText');return {value:e.value,start:e.selectionStart,end:e.selectionEnd,selected:e.value.slice(e.selectionStart,e.selectionEnd),readOnly:e.readOnly,focused:document.activeElement===e};})()");
  const active=()=>evaluate('document.activeElement?.id');
  const sourceHidden=()=>evaluate("document.querySelector('#sceneAudioUsageSource').hidden");
  const unchanged=async(draft=original)=>{assert.deepEqual(await authorTree(root),initial);assert.equal(await value('#docSourceEditor'),visible(draft));};
  const token1=JSON.stringify(track1),escapedToken='"\\u0037'+track1.slice(1)+'"';
  assert.ok(savedBehavior.includes(escapedToken));
  await open();await fill('#sceneAudioTrack0Volume','0.2');await check();const candidate=await text('#sceneAudioAfter');await usage();
  const reads=await evaluate('window.__usageReads');
  await click('#sceneAudioUsageCue2Locate');assert.equal(await active(),'sceneAudioCue2Track');
  assert.equal(await evaluate("document.querySelector('#sceneAudioApply').disabled"),false);assert.equal(await text('#sceneAudioAfter'),candidate);
  await inspect(0);let selected=await selection();assert.equal(selected.value,visible(savedBehavior));assert.equal(selected.selected,token1);assert.equal(selected.readOnly,true);assert.equal(selected.focused,true);
  assert.match(await text('#sceneAudioUsageSourceField'),/\/bindings\/0\/parameters\/custom_sound/);
  const firstOffset=selected.start;await inspect(1);selected=await selection();assert.equal(selected.selected,escapedToken);assert.ok(selected.start>firstOffset);
  assert.match(await text('#sceneAudioUsageSourceField'),/\/bindings\/0\/parameters\/alt_sound/);
  await inspect(2);selected=await selection();assert.equal(selected.selected,token1);assert.match(await text('#sceneAudioUsageSourceField'),/\/bindings\/1\/parameters\/shared_sound/);
  assert.equal(await evaluate('window.__usageReads'),reads);assert.equal(await evaluate("document.querySelector('#sceneAudioApply').disabled"),false);assert.equal(await text('#sceneAudioAfter'),candidate);
  assert.ok((await evaluate("(await import('/web/modules/app-state.js')).appState.activePath")).includes('audio/demo'));
  await screenshot('source-desktop.png');await unchanged();
  report.steps.push('Current cue location focuses the correct form row. Three saved matches of the same UUID open different exact JSON tokens, including an escaped UUID after Chinese/emoji in BOM/CRLF text. Inspection is readonly, adds no HTTP read, keeps the audio document and approved draft, and changes no author files.');

  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await evaluate("(window.__sourceNode=document.querySelector('#sceneAudioUsageSourceText'),window.__sourceNode.focus(),window.__sourceNode.scrollTop=20)");
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const remembered=await selection(),scroll=await evaluate('window.__sourceNode.scrollTop');
  report.localeScroll=[];
  const scrollInfo=()=>evaluate("(()=>{const e=window.__sourceNode,s=getComputedStyle(e);return {scroll:e.scrollTop,height:e.clientHeight,scrollHeight:e.scrollHeight,width:e.clientWidth,font:s.font,lineHeight:s.lineHeight,lang:document.documentElement.lang};})()");
  for(const language of ['zh-CN','en','ja']){
    const beforeScroll=await scrollInfo();
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    report.localeScroll.push({language,before:beforeScroll,after:await scrollInfo()});
    assert.equal(await evaluate("document.querySelector('#sceneAudioUsageSourceText')===window.__sourceNode&&document.activeElement===window.__sourceNode"),true);
    assert.deepEqual(await selection(),remembered);assert.equal(await evaluate('window.__sourceNode.scrollTop'),scroll);
    assert.equal(await text('#sceneAudioAfter'),candidate);assert.equal(await evaluate("document.querySelector('#sceneAudioApply').disabled"),false);
    await evaluate("document.querySelector('#sceneAudioUsageSource').scrollIntoView({block:'start'})");
    const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneAudioDialog'),r=id=>{const b=document.querySelector(id).getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth;};return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,cancelVisible:r('#sceneAudioCancel'),checkVisible:r('#sceneAudioCheck'),applyVisible:r('#sceneAudioApply'),sourceLabel:document.querySelector('#sceneAudioUsageSource').innerText.slice(0,180)};})()`);
    assert.ok(Object.entries(layout).filter(([k])=>k!=='sourceLabel').every(([,v])=>v),JSON.stringify(layout));report.layout[language]=layout;await screenshot(`source-${language}-390.png`);
  }
  report.locatedViewport=await evaluate(`(()=>{const original=document.createRange;let measured;
    document.createRange=function(){const range=original.call(document),bounds=range.getBoundingClientRect.bind(range);range.getBoundingClientRect=()=>{const row=bounds(),mirror=range.startContainer.parentElement;measured={top:row.top-mirror.getBoundingClientRect().top,height:row.height,language:mirror.getAttribute('lang')};return row;};return range;};
    try{document.querySelector('#sceneAudioUsageSourceLocate').click();const e=window.__sourceNode;return{...measured,scroll:e.scrollTop,heightAvailable:e.clientHeight};}finally{document.createRange=original;}})()`);
  assert.equal(report.locatedViewport.language,'');assert.equal((await selection()).selected,token1);
  assert.ok(report.locatedViewport.top>=report.locatedViewport.scroll&&report.locatedViewport.top+report.locatedViewport.height<=report.locatedViewport.scroll+report.locatedViewport.heightAvailable,JSON.stringify(report.locatedViewport));
  await screenshot('source-ja-located-390.png');
  await click('#sceneAudioUsageSourceDismiss');assert.equal(await sourceHidden(),true);assert.equal(await evaluate("document.querySelector('#sceneAudioDialog').open"),true);assert.equal(await text('#sceneAudioAfter'),candidate);
  await close();await unchanged();await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");
  report.steps.push('Chinese/English/Japanese at 390px preserve the same readonly node, exact selection, focus, scroll and approved edit. The source can be collapsed without closing the parent form; cancellation preserves audio draft and files.');

  await open();await usage();await evaluate('window.__oldCue=document.querySelector("#sceneAudioUsageCue2Locate")');await click('#sceneAudioCue2Up');
  await evaluate('window.__oldCue.click()');assert.notEqual(await active(),'sceneAudioCue1Track');
  await click('#sceneAudioUsageCue1Locate');assert.equal(await active(),'sceneAudioCue1Track');
  await fill('#sceneAudioTrack0Volume','1e-');await inspect(0);assert.equal(await value('#sceneAudioTrack0Volume'),'1e-');
  await click('#sceneAudioUsageSourceLocate');assert.equal((await selection()).selected,token1);
  await fill('#sceneAudioCue1Track',track2,'change');assert.equal(await sourceHidden(),false);assert.equal(await value('#sceneAudioTrack0Volume'),'1e-');
  await evaluate('window.__oldCue=document.querySelector("#sceneAudioUsageCue0Locate")');await click('#sceneAudioCue0Remove');await evaluate('window.__oldCue.click()');assert.notEqual(await active(),'sceneAudioCue0Track');
  await click('#sceneAudioAddCue');await fill('#sceneAudioCue2Track',track1,'change');await click('#sceneAudioUsageCue2Locate');assert.equal(await active(),'sceneAudioCue2Track');
  await click('#sceneAudioTrack1Usage');assert.equal(await sourceHidden(),true);await inspect(0);assert.equal((await selection()).selected,JSON.stringify(track2));
  await click('#sceneAudioUsageDismiss');assert.equal(await sourceHidden(),true);await close();await unchanged();
  report.steps.push('Cue navigation follows stable identities after reorder, target changes, deletion and new cue creation; detached buttons cannot jump to replacement rows. Incomplete numeric text survives source inspection. Switching tracks or hiding usage clears the source preview.');

  await open();await fill('#sceneAudioTrack0Volume','0.2');await check();await usage();await inspect(0);
  await evaluate('window.__oldMatch=document.querySelector("#sceneAudioUsageMatch0Source")');
  const changedBehavior=savedBehavior.replace('"custom_sound": '+token1,'"custom_sound": '+JSON.stringify(track2));await fs.writeFile(behaviorFile,changedBehavior);
  assert.equal((await selection()).value,visible(savedBehavior));await evaluate('(window.__holdUsage=true,window.__releaseUsage=null)');await click('#sceneAudioUsageRefresh');assert.equal(await sourceHidden(),true);
  await evaluate('window.__oldMatch.click()');assert.equal(await sourceHidden(),true);await wait(()=>evaluate("typeof window.__releaseUsage==='function'"),'held refresh');
  assert.equal(await text('#sceneAudioAfter'),candidate);await evaluate('window.__releaseUsage()');await status('ready');assert.equal(await sourceHidden(),true);
  await evaluate('window.__oldMatch.click()');assert.equal(await sourceHidden(),true);await inspect(0);assert.equal((await selection()).value,visible(changedBehavior));assert.equal((await selection()).selected,escapedToken);
  await evaluate('window.__failUsage=true');await click('#sceneAudioUsageRefresh');assert.equal(await sourceHidden(),true);await status('failed');assert.equal(await text('#sceneAudioAfter'),candidate);assert.equal(await evaluate("document.querySelector('#sceneAudioApply').disabled"),false);
  await fs.writeFile(behaviorFile,savedBehavior);await click('#sceneAudioUsageRefresh');await status('ready');await inspect(0);assert.equal((await selection()).value,visible(savedBehavior));
  await evaluate('window.__oldMatch=document.querySelector("#sceneAudioUsageMatch0Source")');await close();await open();await evaluate('window.__oldMatch.click()');assert.equal(await sourceHidden(),true);await close();await unchanged();
  report.steps.push('The viewer explicitly shows the last-read saved snapshot. External behavior edits appear only after refresh; refresh clears old text immediately, late responses never reopen it, old buttons stay invalid, and failure/retry preserves approval. Closing/reopening cannot resurrect the old source.');

  await open();await fill('#sceneAudioTrack0Volume','0.2');await check();await usage();await inspect(0);await click('#sceneAudioApply');await wait(()=>evaluate("!document.querySelector('#sceneAudioDialog').open"),'applied');
  assert.equal(await value('#docSourceEditor'),visible(candidate));assert.deepEqual(await authorTree(root),initial);
  await open();await fill('#sceneAudioTrack1Volume','1e-');await usage();await inspect(1);assert.equal((await selection()).selected,escapedToken);await close();await unchanged(candidate);
  await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readSource()===candidate,'ordinary save');
  await wait(()=>evaluate("!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges&&!document.querySelector('#sceneAudioBtn').disabled"),'saved ready');
  await open();await usage();await inspect(2);assert.equal((await selection()).selected,token1);await close();
  assert.deepEqual(await authorTree(root),{...initial,[manifestPath]:buildHash(Buffer.from(candidate))});
  report.saved={onlyChangedAuthorPath:manifestPath,beforeSha256:buildHash(Buffer.from(original)),afterSha256:buildHash(Buffer.from(candidate)),bomCrlfPreserved:true};
  report.steps.push('Inspection also works over an already unsaved ordinary audio draft. Cancel retains it, Apply remains independent, and ordinary Save writes only the reviewed audio change with BOM/CRLF preserved; behavior and all other author files are unchanged.');
  report.counts=await evaluate('({assetReads:window.__assetReads,usageReads:window.__usageReads})');assert.equal(report.counts.assetReads,0);assert.deepEqual(report.errors,[]);report.authorFilesPreserved=Object.keys(initial).length-1;
  for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));}
