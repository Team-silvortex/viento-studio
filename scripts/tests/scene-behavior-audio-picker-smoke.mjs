// Real browser explicit saved audio-track selection; ordinary scalar editing and save remain separate.
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
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-behavior-audio-picker');
const output = path.resolve(process.env.VIENTO_BEHAVIOR_AUDIO_PICKER_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a new directory beneath scene-behavior-audio-picker evidence.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], errors: [], dialogs: [], layout: {}, limitations: [
 'Actual Chrome with local HTTP editor on a disposable copied author workspace. No installed Tauri or Android device acceptance.',
 'Chosen UUID remains an ordinary string; this proves explicit editing and ordinary save, not script meaning, playback, persistent references or engine execution.',
 'The directory validates saved scene/audio registration and document semantics. WAV bytes are deliberately absent; no playback or build validation is claimed.'
] };
const sources = ['engine/scene-audio-directory.mjs', 'scripts/lib/scene-audio-directory-service.mjs', 'scripts/lib/doc-api-service.mjs', 'scripts/lib/doc-server-routes.mjs',
 'web/modules/app-scene-behaviors.js', 'web/scene-behaviors.css', 'web/modules/app-behavior-source.js', 'web/modules/app-runtime.js', 'web/modules/app-doc-service.js',
 'engine/scene-behaviors.mjs', 'engine/scene-behaviors-edit.mjs', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/tests/scene-behavior-audio-picker-smoke.mjs'];
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
  const manifestPath = 'documents/behaviors/demo.json', manifestFile = path.join(root, manifestPath);
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
  const original = '\ufeff' + (await fs.readFile(manifestFile, 'utf8')).replaceAll('"checkpoint":', '"audio_choice":').replaceAll('\n', '\r\n');
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
    window.__assetReads=0;window.__directoryReads=0;const original=window.fetch;
    window.fetch=async(input,init)=>{const url=String(input);if(url.startsWith('/asset-files/'))window.__assetReads++;
      if(url==='/api/scene-audio-directory'){
        window.__directoryReads++;
        if(window.__failDirectory){window.__failDirectory=false;return new Response(JSON.stringify({error:'Test directory unavailable'}),{status:503,headers:{'Content-Type':'application/json'}});}
        const response=await original(input,init);
        if(window.__holdDirectory){window.__holdDirectory=false;await new Promise(resolve=>window.__releaseDirectory=resolve);}
        return response;
      }return original(input,init);
    };
  })()`});
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor startup');
  await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path.includes('behaviors/demo'))`), 'behavior source in sidebar');
  await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path.includes('behaviors/demo')).click()`);
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.activePath.includes('behaviors/demo')`), 'selected behavior source');
  await enabled('#docEditBtn'); await click('#docEditBtn'); await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing`), 'source edit');
  await enabled('#docEditSourceModeBtn'); await click('#docEditSourceModeBtn'); await enabled('#sceneBehaviorsBtn');
  assert.equal(await value('#docSourceEditor'), visible(original));
  report.system = await evaluate(`(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()`);
  assert.ok(report.system.initializedModules.includes('org.viento.scene-behaviors'));
  const open = async () => { await enabled('#sceneBehaviorsBtn'); await click('#sceneBehaviorsBtn'); await wait(() => evaluate(`document.querySelector('#sceneBehaviorsDialog').open && !document.querySelector('#sceneBehaviorsFields').hidden && !document.querySelector('#sceneBehaviorsInstance').disabled`), 'behavior form'); };
  const check = async () => { await enabled('#sceneBehaviorsCheck'); await click('#sceneBehaviorsCheck'); await enabled('#sceneBehaviorsApply'); };
  const close = async () => { await click('#sceneBehaviorsCancel'); await wait(() => evaluate(`!document.querySelector('#sceneBehaviorsDialog').open`), 'form closed'); };
  const edit = async () => { await fill('#sceneBehaviorsParam1Value', '65'); await fill('#sceneBehaviorsEvent0Name', 'authoring_checkpoint'); };
  const track1='77777777-7777-4777-8777-000000000001',track2='77777777-7777-4777-8777-000000000002';
  const first='99999999-9999-4999-8999-999999999991',second='99999999-9999-4999-8999-999999999992';
  const load=async()=>{await enabled('#sceneBehaviorsLoadAudioTracks');await click('#sceneBehaviorsLoadAudioTracks');await enabled('#sceneBehaviorsParam0AudioTrack');};
  const unchanged=async()=>{assert.deepEqual(await authorTree(root),initial);assert.equal(await value('#docSourceEditor'),visible(original));};
  const status=expected=>wait(()=>evaluate(`document.querySelector('#sceneBehaviorsAudioTracksStatus').dataset.status===${JSON.stringify(expected)}`),'directory '+expected);
  await open();await load();
  assert.deepEqual(await evaluate("Array.from(document.querySelector('#sceneBehaviorsParam0AudioTrack').options,option=>option.value)"),['',track1,track2]);
  assert.equal(await value('#sceneBehaviorsParam0AudioTrack'),'');assert.equal(await value('#sceneBehaviorsParam0Value'),'east');
  assert.equal(await evaluate("document.querySelector('#sceneBehaviorsDialog').dataset.dirty"),'false');
  assert.equal(await evaluate("Boolean(document.querySelector('#sceneBehaviorsParam1AudioTrack'))"),false);
  await fill('#sceneBehaviorsParam0AudioTrack',track2,'change');assert.equal(await value('#sceneBehaviorsParam0Value'),'east');
  assert.equal(await evaluate("document.querySelector('#sceneBehaviorsDialog').dataset.dirty"),'false');
  await click('#sceneBehaviorsParam0UseAudioTrack');assert.equal(await value('#sceneBehaviorsParam0Value'),track2);
  await check();const candidate=await evaluate("document.querySelector('#sceneBehaviorsAfter').textContent");
  assert.equal(candidate,original.replace('"audio_choice": "east"',`"audio_choice": "${track2}"`));
  await fill('#sceneBehaviorsParam0AudioTrack',track1,'change');assert.equal(await value('#sceneBehaviorsParam0Value'),track2);
  assert.equal(await evaluate("document.querySelector('#sceneBehaviorsApply').disabled"),false);
  assert.equal(await evaluate("document.querySelector('#sceneBehaviorsAfter').textContent"),candidate);
  await screenshot('audio-track-review-desktop.png');await unchanged();
  report.steps.push('Saved audio identities are listed in author order despite absent WAV bytes. Any string parameter can explicitly insert an ID; numeric parameters have no helper. Reading or selecting alone does not dirty the form or revoke an approved review.');

  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  for(const language of ['zh-CN','en','ja']){
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    assert.equal(await value('#sceneBehaviorsParam0AudioTrack'),track1);assert.equal(await value('#sceneBehaviorsParam0Value'),track2);
    assert.equal(await evaluate("document.querySelector('#sceneBehaviorsAfter').textContent"),candidate);
    assert.equal(await evaluate("document.querySelector('#sceneBehaviorsApply').disabled"),false);
    await evaluate("document.querySelector('#sceneBehaviorsParam0UseAudioTrack').scrollIntoView({block:'center'})");
    const layout=await evaluate(`(()=>{const d=document.querySelector('#sceneBehaviorsDialog'),r=id=>{const b=document.querySelector(id).getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth;};return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,insertVisible:r('#sceneBehaviorsParam0UseAudioTrack'),cancelVisible:r('#sceneBehaviorsCancel'),checkVisible:r('#sceneBehaviorsCheck'),applyVisible:r('#sceneBehaviorsApply'),option:document.querySelector('#sceneBehaviorsParam0AudioTrack').selectedOptions[0].textContent};})()`);
    assert.ok(Object.entries(layout).filter(([k])=>k!=='option').every(([,v])=>v),JSON.stringify(layout));report.layout[language]=layout;await screenshot(`audio-track-${language}-390.png`);
  }
  await click('#sceneBehaviorsParam0UseAudioTrack');assert.equal(await value('#sceneBehaviorsParam0Value'),track1);assert.equal(await evaluate("document.querySelector('#sceneBehaviorsApply').disabled"),true);
  await fill('#sceneBehaviorsParam1Value','1e-');await fill('#sceneBehaviorsBinding',second,'change');assert.equal(await value('#sceneBehaviorsParam0Value'),'west');assert.equal(await value('#sceneBehaviorsParam0AudioTrack'),'');
  await fill('#sceneBehaviorsBinding',first,'change');assert.equal(await value('#sceneBehaviorsParam1Value'),'1e-');assert.equal(await value('#sceneBehaviorsParam0Value'),track1);assert.equal(await value('#sceneBehaviorsParam0AudioTrack'),track1);
  await close();await unchanged();report.steps.push('At 390px Chinese/English/Japanese preserve the tentative selection and approved review without horizontal overflow. Explicit insertion revokes approval. Binding switches preserve each row and incomplete numeric text; Cancel leaves draft and files unchanged.');
  await call('Emulation.clearDeviceMetricsOverride');await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");

  await open();await fill('#sceneBehaviorsParam1Value','65');await check();const numberCandidate=await evaluate("document.querySelector('#sceneBehaviorsAfter').textContent");
  await evaluate('window.__failDirectory=true');await click('#sceneBehaviorsLoadAudioTracks');await status('error');
  assert.equal(await value('#sceneBehaviorsParam1Value'),'65');assert.equal(await evaluate("document.querySelector('#sceneBehaviorsAfter').textContent"),numberCandidate);assert.equal(await evaluate("document.querySelector('#sceneBehaviorsApply').disabled"),false);
  await load();assert.equal(await evaluate("document.querySelector('#sceneBehaviorsApply').disabled"),false);await close();await unchanged();
  report.steps.push('A directory failure preserves values and the approved ordinary edit. Retry succeeds without changing that review, and Cancel still preserves the source.');

  await open();await evaluate('window.__holdDirectory=true');await click('#sceneBehaviorsLoadAudioTracks');await wait(()=>evaluate("typeof window.__releaseDirectory==='function'"),'held directory response');
  assert.equal(await evaluate("document.querySelector('#sceneBehaviorsParam1Value').disabled"),false);await fill('#sceneBehaviorsParam1Value','1e-');await fill('#sceneBehaviorsBinding',second,'change');await evaluate('window.__releaseDirectory()');await enabled('#sceneBehaviorsParam0AudioTrack');
  assert.equal(await value('#sceneBehaviorsParam0Value'),'west');assert.equal(await value('#sceneBehaviorsParam0AudioTrack'),'');await fill('#sceneBehaviorsBinding',first,'change');assert.equal(await value('#sceneBehaviorsParam1Value'),'1e-');await close();await unchanged();
  await open();await evaluate('(window.__holdDirectory=true,window.__releaseDirectory=null)');await click('#sceneBehaviorsLoadAudioTracks');await wait(()=>evaluate("typeof window.__releaseDirectory==='function'"),'second held response');await close();await open();await evaluate('window.__releaseDirectory()');await delay(200);
  assert.equal(await value('#sceneBehaviorsParam0Value'),'east');assert.equal(await evaluate("document.querySelector('#sceneBehaviorsAudioTracksStatus').dataset.status"),'idle');await close();await unchanged();
  report.steps.push('While reading, ordinary controls remain usable. A response arriving after a binding switch never fills a row; a response from a closed dialog cannot populate a reopened session.');

  await open();await load();await fill('#sceneBehaviorsParam0AudioTrack',track2,'change');await click('#sceneBehaviorsParam0UseAudioTrack');await check();assert.equal(await evaluate("document.querySelector('#sceneBehaviorsAfter').textContent"),candidate);await click('#sceneBehaviorsApply');
  await wait(()=>evaluate("!document.querySelector('#sceneBehaviorsDialog').open"),'draft applied');assert.equal(await value('#docSourceEditor'),visible(candidate));assert.deepEqual(await authorTree(root),initial);
  await open();await load();assert.equal(await value('#sceneBehaviorsParam0Value'),track2);await close();assert.equal(await value('#docSourceEditor'),visible(candidate));assert.deepEqual(await authorTree(root),initial);
  await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readSource()===candidate,'ordinary Save');await wait(()=>evaluate("!(await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges&&!document.querySelector('#sceneBehaviorsBtn').disabled"),'saved source ready');
  await open();assert.equal(await value('#sceneBehaviorsParam0Value'),track2);await close();assert.deepEqual(await authorTree(root),{...initial,[manifestPath]:buildHash(Buffer.from(candidate))});
  report.saved={onlyChangedAuthorPath:manifestPath,beforeSha256:buildHash(Buffer.from(original)),afterSha256:buildHash(Buffer.from(candidate)),bomCrlfPreserved:true};
  report.steps.push('Apply updates only the unsaved ordinary draft, which can reopen and reload the directory. Ordinary Save writes the exact reviewed BOM/CRLF text; only the behavior JSON changes, all other author files remain identical, and reopening retains the ID.');
  report.counts=await evaluate('({assetReads:window.__assetReads,directoryReads:window.__directoryReads})');assert.equal(report.counts.assetReads,0);assert.deepEqual(report.errors,[]);report.authorFilesPreserved=Object.keys(initial).length-1;
  for(const[file,expected]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,file))),expected,`Source changed during smoke: ${file}`);report.sourceSnapshotUnchanged=true;report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(failure){report.captureFailure=failure.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,steps:report.steps,failure:report.failure},null,2));}
