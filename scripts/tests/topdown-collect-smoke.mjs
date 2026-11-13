// Actual Studio HTTP UI over a copied reference-game workspace. All writes stay
// in /tmp; this checks author inspection/edit/save/build, not from-blank creation.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import '../adapters/node-studio-core.mjs';
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { readRegistry } from '../lib/workspace.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const canonical = path.join(appRoot, 'examples/topdown-collect');
const source = path.resolve(process.env.VIENTO_TOPDOWN_SOURCE || canonical);
const output = path.resolve(process.env.VIENTO_TOPDOWN_BROWSER_OUTPUT || `/tmp/viento-topdown-browser-${Date.now()}`);
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to an absolute trusted tool path.');
if (!output.startsWith('/tmp/')) throw Error('This smoke writes evidence only beneath /tmp.');
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw Error('Use a new empty evidence directory.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceNames = ['web/modules/app-project-build.js', 'web/modules/app-runtime.js', 'web/modules/app-state.js', 'web/modules/app-doc-service.js', 'web/modules/app-scene-preview.js', 'web/modules/app-scene-preview-canvas.js', 'web/modules/app-scene-physics2d.js', 'web/modules/app-scene-hud2d.js', 'web/i18n/en.js', 'web/i18n/ja.js', 'scripts/adapters/node-project-build.mjs', 'scripts/adapters/node-build-snapshot.mjs', 'scripts/lib/doc-api-service.mjs', 'scripts/lib/doc-server-routes.mjs'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, hash(await fs.readFile(path.join(appRoot, name)))])));
async function authorTree(root) {
  const hashes = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name), name = path.relative(root, file);
    if (name.split(path.sep).some(part => part.startsWith('.'))) continue;
    hashes[name] = hash(await fs.readFile(file));
  }
  return Object.fromEntries(Object.entries(hashes).sort());
}
const cleanups = [], fixture = { after: callback => cleanups.push(callback) };
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], jobs: [], errors: [], dialogs: [], layout: {}, limitations: [
  'Actual Chrome and Studio HTTP editor over a disposable copy of the existing reference-game author workspace. This is not from-blank UI creation.',
  'Canvas, collision-map and HUD sample previews are author views. No gameplay, actual native game input, installed Tauri, Android, independent export, 30-minute session or physical keyboard claim.',
  'The sole intended author change is an ordinary saved guide/controller comment. HUD cancellation and inspection must preserve every other author file.'
] };
const wait = async (check, label, budget = 45000) => { for (const end = Date.now() + budget; Date.now() < end;) { if (await check()) return; await delay(100); } throw Error('Timed out: ' + label); };
let socket, captureFailure, confirmAccept = false, author;
try {
  report.sourcesBefore = await sourceHashes(); report.driverSha256 = hash(await fs.readFile(fileURLToPath(import.meta.url)));
  report.sampleBefore = await authorTree(source); report.node = { version: process.version, sha256: hash(await fs.readFile(process.execPath)) }; report.tool = { executable: tool, sha256: hash(await fs.readFile(tool)), version: (await runCommand(tool, ['--version'], { cwd: appRoot })).stdout.trim() };
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-topdown-author-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  author = path.join(temporary, 'author'); await fs.cp(source, author, { recursive: true, filter: name => !path.basename(name).startsWith('.') });
  const registry = await readRegistry(author), documents = [];
  for (const record of registry.documents) {
    const content = await fs.readFile(path.join(author, record.sourcePath), 'utf8'); let value; try { value = JSON.parse(content.replace(/^\ufeff/, '')); } catch {}
    documents.push({ record, content, value });
  }
  const assembly = documents.find(row => row.record.sourcePath === 'documents/projects/game.json') || documents.find(row => row.value?.format === 'viento-project-assembly');
  const level = documents.find(row => row.record.sourcePath === 'documents/scenes/level.json') || documents.find(row => row.value?.format === 'viento-scene2d' && row.record.relations?.some(relation => relation.slot === 'physics2d'));
  assert.ok(assembly && level, 'sample has a saved registered assembly and physical level');
  const physics = documents.find(row => row.value?.format === 'viento-scene-physics2d' && row.value.sceneObjectId === level.record.id);
  const hud = documents.find(row => row.value?.format === 'viento-scene-hud2d' && row.value.sceneObjectId === level.record.id);
  const controller = documents.find(row => row.record.sourcePath === 'documents/scripts/controller.txt') || documents.find(row => /controller/i.test(row.record.sourcePath) && /^extends Node/m.test(row.content));
  const guide = documents.find(row => /\.md$/i.test(row.record.sourcePath) && /guide|说明|玩法|操作/i.test(row.record.sourcePath + ' ' + (row.record.title || '')));
  const editDoc = guide || controller; assert.ok(physics && hud && editDoc, 'sample has registered physics, HUD and editable guide/controller');
  report.sample = { source, assembly: assembly.record, level: level.record, physics: physics.record, hud: hud.record, controller: controller?.record, guide: guide?.record, edited: editDoc.record, sceneCount: assembly.value.sceneIds.length, actorCount: level.value.actors.length, bodyCount: physics.value.bodies.length, hudElements: hud.value.elements.length, preexistingSample: true };
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: author, VIENTO_GODOT_BIN: tool, VIENTO_EXECUTION_BACKEND: 'org.viento.godot4', XDG_CACHE_HOME: path.join(temporary, 'cache'), XDG_CONFIG_HOME: path.join(temporary, 'config') };
  delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  const rebuilt = await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env }); assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt));
  const initial = await authorTree(author); assert.deepEqual(initial, report.sampleBefore, 'index rebuild must preserve sample author bytes');
  const base = await serve(fixture, appRoot, env), state = async () => { const result = await fetch(`${base}/api/project-build`).then(r => r.json()); return result.data || result; };
  const profile = path.join(temporary, 'chrome'); await fs.mkdir(profile);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; } });
  let port; await wait(async () => { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return Boolean(port); } catch { return false; } }, 'Chrome startup');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()); socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const pending = new Map(); let sequence = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  socket.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.id) { const p = pending.get(data.id); pending.delete(data.id); data.error ? p?.reject(Error(data.error.message)) : p?.resolve(data.result); } else if (data.method === 'Runtime.exceptionThrown') report.errors.push(data.params.exceptionDetails); else if (data.method === 'Page.javascriptDialogOpening') { report.dialogs.push({ type: data.params.type, message: data.params.message, accepted: confirmAccept }); void call('Page.handleJavaScriptDialog', { accept: confirmAccept }); } });
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression: `(async()=>(${expression}))()`, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value, event = 'input') => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled===false&&!document.querySelector(${JSON.stringify(selector)}).hidden`), selector + ' enabled');
  const screenshot = async name => { const result = await call('Page.captureScreenshot', { format: 'png' }), bytes = Buffer.from(result.data, 'base64'); await fs.writeFile(path.join(output, name), bytes); report.screenshots.push({ name, bytes: bytes.length, sha256: hash(bytes) }); };
  const idle = () => wait(() => evaluate(`(()=>{const s=window.__topdownState;return !s.isSaving&&!s.isRebuilding&&!s.isLoadingSource})()`), 'editor idle');
  const openDocument = async record => {
    await idle();
    await wait(() => evaluate(`window.__topdownState.docs.some(row=>row.id===${JSON.stringify(record.id)})`), 'registered document index loaded');
    const indexPath = await evaluate(`(()=>{const d=window.__topdownState.docs.find(row=>row.id===${JSON.stringify(record.id)});if(!d)throw Error('Registered sample document missing from index');return d.path;})()`);
    await wait(() => evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).some(button=>button.dataset.path===${JSON.stringify(indexPath)})`), 'document sidebar rendered');
    await evaluate(`Array.from(document.querySelectorAll('#docList button[data-path]')).find(button=>button.dataset.path===${JSON.stringify(indexPath)}).click()`);
    await wait(() => evaluate(`window.__topdownState.activePath===${JSON.stringify(indexPath)}&&!window.__topdownState.isLoadingSource`), 'selected ' + record.sourcePath);
    await wait(async () => { const s = await evaluate(`({editing:window.__topdownState.isEditing,source:window.__topdownState.activeEditSource,loading:window.__topdownState.isLoadingSource,canEdit:document.querySelector('#docEditBtn')?.disabled===false})`); if (s.editing && (s.source === record.sourcePath || s.source.endsWith('/' + record.sourcePath)) && !s.loading) return true; if (!s.editing && !s.loading && s.canEdit) await click('#docEditBtn'); return false; }, 'editing ' + record.sourcePath);
    await enabled('#docEditSourceModeBtn'); await click('#docEditSourceModeBtn');
    await wait(() => evaluate(`document.querySelector('#docSourceEditor').checkVisibility()&&!document.querySelector('#docSourceEditor').disabled`), 'source editor visible');
  };
  const openBuild = async target => { if (!await evaluate(`document.querySelector('#projectBuildDialog')?.open`)) { await enabled('#projectBuildBtn'); await click('#projectBuildBtn'); } await enabled('#projectBuildScene'); await fill('#projectBuildScene', target, 'change'); };
  const closeBuild = async () => { await click('#projectBuildClose'); await wait(() => evaluate(`!document.querySelector('#projectBuildDialog').open`), 'build closed'); };
  const language = async value => { await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(value)})`); };
  const resetSize = () => call('Emulation.clearDeviceMetricsOverride');
  const modalLayout = async selector => evaluate(`(()=>{const d=document.querySelector(${JSON.stringify(selector)});return {noOverflow:d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1,title:d.querySelector('h2')?.textContent,width:innerWidth,height:innerHeight};})()`);
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({text:document.body.innerText,source:document.querySelector('#docSourceEditor')?.value,state:window.__topdownState})`); report.serviceFailure = await state(); };
  await call('Runtime.enable'); await call('Page.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable&&document.querySelector('#projectBuildBtn')?.hidden===false`), 'Studio startup');
  await evaluate(`window.__topdownState=(await import('/web/modules/app-state.js')).appState`);

  await openDocument(editDoc.record); const beforeText = await fs.readFile(path.join(author, editDoc.record.sourcePath), 'utf8');
  const comment = /\.md$/i.test(editDoc.record.sourcePath) ? '\n<!-- Browser author validation: ordinary saved guide comment. -->\n' : '\n# Browser author validation: ordinary saved controller comment.\n';
  await fill('#docSourceEditor', beforeText + comment); await wait(() => evaluate('window.__topdownState.editHasUnsavedChanges'), 'unsaved ordinary comment');
  assert.deepEqual(await authorTree(author), initial, 'typing must remain a draft');
  confirmAccept = true; await click('#docCancelBtn'); await wait(() => evaluate('!window.__topdownState.isEditing'), 'cancel ordinary comment'); confirmAccept = false;
  assert.deepEqual(await authorTree(author), initial, 'Cancel must preserve all author files'); report.steps.push('Ordinary comment typing followed by Cancel leaves all author files unchanged.');
  await openDocument(editDoc.record); await fill('#docSourceEditor', beforeText + comment); await enabled('#docSaveBtn'); await click('#docSaveBtn');
  await wait(async () => await fs.readFile(path.join(author, editDoc.record.sourcePath), 'utf8') === beforeText + comment, 'ordinary comment saved'); await idle();
  await wait(() => evaluate('!window.__topdownState.editHasUnsavedChanges'), 'saved editor clean');
  const saved = await authorTree(author); assert.deepEqual(saved, { ...initial, [editDoc.record.sourcePath]: hash(Buffer.from(beforeText + comment)) });
  await screenshot('ordinary-source-saved-desktop.png');
  await call('Page.reload'); await wait(() => evaluate(`document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'Studio reopen'); await evaluate(`window.__topdownState=(await import('/web/modules/app-state.js')).appState`);
  await openDocument(editDoc.record); assert.equal(await evaluate(`document.querySelector('#docSourceEditor').value`), (beforeText + comment).replace(/\r\n?/g, '\n')); assert.deepEqual(await authorTree(author), saved);
  report.edit = { sourcePath: editDoc.record.sourcePath, beforeSha256: hash(Buffer.from(beforeText)), afterSha256: saved[editDoc.record.sourcePath], changedPaths: Object.keys(saved).filter(p => saved[p] !== initial[p]), reopened: true };
  report.steps.push('Save persists exactly one ordinary guide/controller source file; reloading Studio and reopening retains the saved comment.');

  await openDocument(level.record); await openBuild(level.record.id); await enabled('#projectBuildTabPreview'); await click('#projectBuildTabPreview'); await enabled('#scenePreviewRefresh'); await click('#scenePreviewRefresh');
  await wait(() => evaluate(`document.querySelectorAll('#scenePreviewObjects button[data-actor-id]').length===${level.value.actors.length}&&document.querySelector('#projectBuildPreviewPanel').getAttribute('aria-busy')!=='true'`), 'all saved level actors in preview');
  for (const lang of ['zh-CN', 'en', 'ja']) {
    await language(lang); await enabled('#scenePreviewFitAll'); await click('#scenePreviewFitAll'); await evaluate(`document.querySelector('#scenePreviewCanvas').scrollIntoView({block:'center'})`);
    const layout = await modalLayout('#projectBuildDialog'); assert.equal(layout.noOverflow, true, JSON.stringify(layout));
    const canvas = await evaluate(`(()=>{const c=document.querySelector('#scenePreviewCanvas'),r=c.getBoundingClientRect();return {width:c.width,height:c.height,cssWidth:r.width,cssHeight:r.height,actors:document.querySelectorAll('#scenePreviewObjects button[data-actor-id]').length};})()`);
    assert.ok(canvas.width > 0 && canvas.height > 0 && canvas.cssWidth > 0 && canvas.cssHeight > 0); report.layout['level-' + lang] = { ...layout, canvas }; await screenshot(`level-${lang}-390.png`);
  }
  await resetSize(); await click('#projectBuildTabBuild'); await enabled('#projectBuildSceneHUD2D'); await click('#projectBuildSceneHUD2D');
  await wait(() => evaluate(`document.querySelector('#sceneHUD2DDialog').open&&document.querySelector('#sceneHUD2DDialog').getAttribute('aria-busy')==='false'&&!document.querySelector('#sceneHUD2DFields').disabled`), 'saved level HUD open');
  assert.equal(await evaluate(`document.querySelectorAll('#sceneHUD2DList li button').length`), hud.value.elements.length);
  const labelIndex = hud.value.elements.findIndex(row => row.kind === 'label'); assert.ok(labelIndex >= 0);
  await evaluate(`document.querySelectorAll('#sceneHUD2DList li button')[${labelIndex}].click()`);
  const label = hud.value.elements[labelIndex], field = label.content.kind === 'literal' ? '#sceneHUD2DText' : '#sceneHUD2DPrefix', originalField = label.content.kind === 'literal' ? label.content.text : label.content.prefix;
  await fill(field, originalField + ' [preview only]'); await enabled('#sceneHUD2DCheck'); await click('#sceneHUD2DCheck'); await enabled('#sceneHUD2DSave');
  for (const lang of ['zh-CN', 'en', 'ja']) {
    await language(lang); await fill('#sceneHUD2DSample', 'number', 'change'); await fill('#sceneHUD2DSampleNumber', '50'); await evaluate(`document.querySelector('#sceneHUD2DCanvas').scrollIntoView({block:'center'})`);
    const layout = await modalLayout('#sceneHUD2DDialog'); assert.equal(layout.noOverflow, true, JSON.stringify(layout));
    const view = await evaluate(`JSON.parse(document.querySelector('#sceneHUD2DCanvas').dataset.view)`); assert.equal(view.elements.length, hud.value.elements.length); report.layout['hud-' + lang] = { ...layout, preview: view }; await screenshot(`hud-${lang}-390.png`);
  }
  await resetSize(); confirmAccept = true; await click('#sceneHUD2DCancel'); await wait(() => evaluate(`!document.querySelector('#sceneHUD2DDialog').open`), 'HUD canceled'); confirmAccept = false;
  assert.deepEqual(await authorTree(author), saved, 'HUD review and preview samples must not save any author changes'); await closeBuild();
  report.steps.push('Saved level canvas shows every declared actor; the existing HUD is reviewed with temporary preview values in three languages, then Cancel preserves all saved author bytes.');

  await openDocument(physics.record); await enabled('#scenePhysics2DBtn'); await click('#scenePhysics2DBtn');
  await wait(() => evaluate(`document.querySelector('#scenePhysics2DDialog').open&&!document.querySelector('#scenePhysics2DFields').hidden`), 'physics editor open');
  assert.equal(await evaluate(`document.querySelector('#scenePhysics2DBody').options.length`), physics.value.bodies.length);
  await wait(() => evaluate(`!document.querySelector('#scenePhysics2DSpaceView').hidden&&document.querySelector('#scenePhysics2DSpaceView').childElementCount>0`), 'physics spatial map ready');
  const character = physics.value.bodies.find(row => row.kind === 'character'); assert.ok(character); await fill('#scenePhysics2DBody', character.id, 'change');
  for (const lang of ['zh-CN', 'en', 'ja']) {
    await language(lang); await evaluate(`document.querySelector('#scenePhysics2DSpace').scrollIntoView({block:'center'})`);
    const layout = await modalLayout('#scenePhysics2DDialog'); assert.equal(layout.noOverflow, true, JSON.stringify(layout));
    const identity = await evaluate(`({instance:document.querySelector('#scenePhysics2DInstance').value,kind:document.querySelector('#scenePhysics2DKind').value,mapVisible:!document.querySelector('#scenePhysics2DSpaceView').hidden,mapNodes:document.querySelector('#scenePhysics2DSpaceView').childElementCount})`);
    assert.equal(identity.instance, character.instanceId); assert.equal(identity.kind, 'character'); assert.ok(identity.mapVisible && identity.mapNodes > 0); report.layout['physics-' + lang] = { ...layout, ...identity }; await screenshot(`physics-${lang}-390.png`);
  }
  await resetSize(); await click('#scenePhysics2DCancel'); await wait(() => evaluate(`!document.querySelector('#scenePhysics2DDialog').open`), 'physics closed'); assert.deepEqual(await authorTree(author), saved);
  report.steps.push('The existing collision-body catalogue and spatial map show the actual sample character in Chinese, English and Japanese; closing writes nothing.');

  await openDocument(assembly.record); await openBuild(assembly.record.id);
  if (await evaluate(`document.querySelector('#projectBuildTabBuild').checkVisibility()`)) await click('#projectBuildTabBuild');
  const perform = async (selector, kind) => { const previous = (await state()).job?.id; await enabled(selector); await click(selector); let job; await wait(async () => { job = (await state()).job; return job?.kind === kind && job.id !== previous && job.status !== 'running'; }, kind + ' completed', 120000); report.jobs.push(job); assert.equal(job.status, 'succeeded', JSON.stringify(job)); return job; };
  await perform('#projectBuildPlan', 'plan');
  if (process.env.VIENTO_TOPDOWN_SKIP_BUILD !== '1') await perform('#projectBuildGenerate', 'build');
  await screenshot('assembly-plan-build-desktop.png'); await closeBuild();
  assert.deepEqual(await authorTree(author), saved, 'planning/build must consume saved author files without editing them');
  report.steps.push(process.env.VIENTO_TOPDOWN_SKIP_BUILD === '1' ? 'The actual assembly passes Check plan in the Studio UI; native generation was explicitly skipped.' : 'The actual assembly passes Check plan and Build project through Studio controls; author data remains unchanged.');
  report.authorBefore = initial; report.authorAfter = await authorTree(author); report.sampleAfter = await authorTree(source); assert.deepEqual(report.sampleAfter, report.sampleBefore, 'original sample changed during browser run');
  report.sourcesAfter = await sourceHashes(); assert.deepEqual(report.sourcesAfter, report.sourcesBefore); assert.equal(hash(await fs.readFile(fileURLToPath(import.meta.url))), report.driverSha256); assert.deepEqual(report.errors, []); report.ok = true;
} catch (error) { report.ok = false; report.failure = error.stack; process.exitCode = 1; console.error(error); try { await captureFailure?.(); } catch (failure) { report.captureFailure = failure.message; } }
finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.ok = false; report.errors.push({ cleanup: error.message }); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ ok: report.ok, output, screenshots: report.screenshots.length, steps: report.steps, failure: report.failure }, null, 2));
}
