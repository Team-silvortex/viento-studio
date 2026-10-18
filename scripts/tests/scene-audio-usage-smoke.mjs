// Real browser readonly audio usage checks; form references and saved text matches stay distinct.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-audio-usage');
const output = path.resolve(process.env.VIENTO_AUDIO_USAGE_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new directory beneath scene-audio-usage evidence.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
 'Actual Chrome with local HTTP editor on a disposable copied author workspace. No installed Tauri or Android device acceptance.',
 'Behavior UUID matches are ordinary strings in one saved scene-selected document; no script interpretation, global usage guarantee, playback or engine execution.',
 'The usage service validates scene/audio/behavior registration. WAV bytes are absent; the World reader still reads document inventory and stats assets.'
] };
const sources = ['engine/scene-audio-usage.mjs','scripts/lib/scene-audio-usage-service.mjs','scripts/lib/doc-api-service.mjs','scripts/lib/doc-server-routes.mjs',
 'web/modules/app-scene-audio.js','web/scene-audio.css','web/modules/app-scene-audio-source.js','web/modules/app-runtime.js','web/modules/app-doc-service.js',
 'engine/scene-audio-edit.mjs','engine/scene-audio-core.mjs','engine/scene-behaviors.mjs','web/i18n/en.js','web/i18n/ja.js','scripts/tests/scene-audio-usage-smoke.mjs'];
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
  behavior.bindings[0].parameters = { custom_sound: '77777777-7777-4777-8777-000000000001', amount: 40 };
  behavior.bindings[1].parameters = { arbitrary_name: '77777777-7777-4777-8777-000000000002', amount: 20 };
  await fs.writeFile(behaviorFile,JSON.stringify(behavior,null,2)+'\n');
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
  const counts=async()=>({cues:await evaluate("document.querySelector('#sceneAudioUsageCueList').children.length"),matches:await evaluate("document.querySelector('#sceneAudioUsageBehaviorList').children.length")});
  const unchanged=async()=>{assert.deepEqual(await authorTree(root),initial);assert.equal(await value('#docSourceEditor'),visible(original));};
  await open();await click('#sceneAudioTrack0Usage');await status('ready');
  assert.deepEqual(await counts(),{cues:2,matches:1});assert.match(await text('#sceneAudioUsageBehaviorList'),/custom_sound/);assert.match(await text('#sceneAudioUsageBehaviorPath'),/documents\/behaviors\/demo.json/);
  assert.equal(await evaluate("document.querySelector('#sceneAudioDialog').dataset.dirty"),'false');
  await fill('#sceneAudioCue0Time','1e-');await fill('#sceneAudioCue0Track',track2,'change');assert.deepEqual(await counts(),{cues:1,matches:1});
  await click('#sceneAudioTrack1Usage');assert.deepEqual(await counts(),{cues:2,matches:1});assert.match(await text('#sceneAudioUsageBehaviorList'),/arbitrary_name/);
  assert.equal(await value('#sceneAudioCue0Time'),'1e-');await fill('#sceneAudioCue0Time','0');await fill('#sceneAudioCue0Track',track1,'change');
  await fill('#sceneAudioTrack0Volume','0.2');await check();const candidate=await text('#sceneAudioAfter');
  await click('#sceneAudioUsageRefresh');await status('ready');assert.equal(await text('#sceneAudioAfter'),candidate);assert.equal(await evaluate("document.querySelector('#sceneAudioApply').disabled"),false);
  await screenshot('usage-review-desktop.png');await unchanged();report.steps.push('Current-form cue targets update immediately while incomplete numeric text survives. Saved behavior matches use arbitrary parameter names. Reads preserve pristine state and an approved ordinary edit without requiring WAV bytes.');

  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']){
    await evaluate("(window.__focused=document.querySelector('#sceneAudioTrack0Volume'),window.__focused.focus())");
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await evaluate("document.activeElement===window.__focused&&document.querySelector('#sceneAudioTrack0Volume')===window.__focused"),true);
    assert.equal(await value('#sceneAudioTrack0Volume'),'0.2');assert.equal(await text('#sceneAudioAfter'),candidate);assert.equal(await evaluate("document.querySelector('#sceneAudioApply').disabled"),false);
    await evaluate("document.querySelector('#sceneAudioUsage').scrollIntoView({block:'start'})");
    const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneAudioDialog'),r=id=>{const b=document.querySelector(id).getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth;};return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,cancelVisible:r('#sceneAudioCancel'),checkVisible:r('#sceneAudioCheck'),applyVisible:r('#sceneAudioApply'),refresh:document.querySelector('#sceneAudioUsageRefresh').textContent};})()`);
    assert.ok(Object.entries(layout).filter(([k])=>k!=='refresh').every(([,v])=>v),JSON.stringify(layout));report.layout[language]=layout;await screenshot(`usage-${language}-390.png`);
  }
  await close();await unchanged();await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");
  report.steps.push('Chinese/English/Japanese at 390px retain the exact input node, focus, values and approved review, with no horizontal overflow and reachable footer actions. Cancel changes no draft or author files.');

  await open();await fill('#sceneAudioTrack0Volume','0.2');await check();await evaluate('window.__failUsage=true');await click('#sceneAudioTrack0Usage');await status('failed');
  assert.equal(await text('#sceneAudioAfter'),candidate);assert.equal(await evaluate("document.querySelector('#sceneAudioApply').disabled"),false);
  await click('#sceneAudioUsageRefresh');await status('ready');await close();await unchanged();
  await open();await evaluate('window.__holdUsage=true');await click('#sceneAudioTrack0Usage');await wait(()=>evaluate("typeof window.__releaseUsage==='function'"),'held usage');
  await fill('#sceneAudioTrack0Volume','1e-');await click('#sceneAudioTrack1Usage');await evaluate('window.__releaseUsage()');await status('ready');
  assert.equal(await value('#sceneAudioTrack0Volume'),'1e-');assert.match(await text('#sceneAudioUsageBehaviorList'),/arbitrary_name/);await close();await unchanged();
  await open();await evaluate('(window.__holdUsage=true,window.__releaseUsage=null)');await click('#sceneAudioTrack0Usage');await wait(()=>evaluate("typeof window.__releaseUsage==='function'"),'second held usage');await close();await open();await evaluate('window.__releaseUsage()');await delay(200);
  assert.equal(await evaluate("document.querySelector('#sceneAudioUsage').hidden"),true);assert.equal(await value('#sceneAudioTrack0Volume'),'0.12');await close();await unchanged();
  report.steps.push('A failed read preserves the approved edit and can retry. While a read is pending, ordinary fields and track selection remain usable. A response filters the currently selected track and cannot repopulate a reopened dialog.');

  await open();await click('#sceneAudioTrack0Clone');await click('#sceneAudioTrack2Usage');await status('ready');assert.deepEqual(await counts(),{cues:0,matches:0});
  await click('#sceneAudioTrack2Remove');assert.equal(await evaluate("document.querySelector('#sceneAudioUsage').hidden"),true);
  await click('#sceneAudioTrack1Usage');await status('ready');assert.deepEqual(await counts(),{cues:1,matches:1});
  await click('#sceneAudioCue1Remove');await enabled('#sceneAudioTrack1Remove');assert.deepEqual(await counts(),{cues:0,matches:1});
  await click('#sceneAudioTrack1Remove');assert.equal(await evaluate("document.querySelectorAll('.scene-audio-track').length"),1);await close();await unchanged();
  report.steps.push('New unsaved track identities can be inspected. Removing the selected track closes its helper. Saved text matches remain advisory: after removing the real cue reference, existing track removal works, without modifying behavior text. Cancel preserves all files.');

  await open();await fill('#sceneAudioTrack0Volume','0.2');await click('#sceneAudioTrack0Usage');await status('ready');await check();assert.equal(await text('#sceneAudioAfter'),candidate);await click('#sceneAudioApply');
  await wait(()=>evaluate("!document.querySelector('#sceneAudioDialog').open"),'applied');assert.equal(await value('#docSourceEditor'),visible(candidate));assert.deepEqual(await authorTree(root),initial);
  await open();await click('#sceneAudioTrack0Usage');await status('ready');assert.deepEqual(await counts(),{cues:2,matches:1});await close();
  await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readSource()===candidate,'ordinary save');
  await wait(()=>evaluate("!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges&&!document.querySelector('#sceneAudioBtn').disabled"),'saved ready');
  await open();await click('#sceneAudioTrack0Usage');await status('ready');assert.equal(await value('#sceneAudioTrack0Volume'),'0.2');await close();
  assert.deepEqual(await authorTree(root),{...initial,[manifestPath]:buildHash(Buffer.from(candidate))});
  report.saved={onlyChangedAuthorPath:manifestPath,beforeSha256:buildHash(Buffer.from(original)),afterSha256:buildHash(Buffer.from(candidate)),bomCrlfPreserved:true};
  report.steps.push('Apply changes only the ordinary unsaved audio draft, which can read usage again. Ordinary Save writes exact reviewed BOM/CRLF bytes; only the audio JSON changes, behavior and other files remain identical, and the saved source reopens with working usage reads.');
  report.counts=await evaluate('({assetReads:window.__assetReads,usageReads:window.__usageReads})');assert.equal(report.counts.assetReads,0);assert.deepEqual(report.errors,[]);report.authorFilesPreserved=Object.keys(initial).length-1;
  for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));}
