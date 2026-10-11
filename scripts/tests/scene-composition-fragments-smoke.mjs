// Real browser shared fragment actor editing → guarded source draft → ordinary save in a disposable recipe.
// Run: VIENTO_COMPOSITION_FRAGMENT_OUTPUT=/empty/evidence/path node scripts/tests/scene-composition-fragments-smoke.mjs [chromium]
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { buildHash, captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { registerWorkspace } from '../lib/workspace.mjs';
import { importMediaAsset } from '../lib/media-assets.mjs';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.env.VIENTO_COMPOSITION_FRAGMENT_OUTPUT || path.join(os.tmpdir(), `viento-composition-fragment-evidence-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_COMPOSITION_FRAGMENT_OUTPUT directory; prior evidence is immutable.');
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], errors: [], svgRequests: [], limitations: [
  'Real HTTP editor and Chrome only; no installed Tauri window or Android device acceptance.',
  'Six explicit set-only shared actor fields in one recipe source session. No declaration deletion, placement-offset change, executable recipe build or cross-file transaction.',
] };
let socket, captureFailure;
const wait = async (check, label, milliseconds = 45000) => {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) { if (await check()) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
};
const json = value => JSON.stringify(value, null, 2) + '\n';
async function sourceTree(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name), relative = path.relative(root, file);
    if (relative.startsWith('.viento/')) continue;
    result[relative] = buildHash(await fs.readFile(file));
  }
  return result;
}
try {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-composition-fragment-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'workspace'), template = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank');
  const write = async (relative, content) => { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); };
  for (const name of ['documents', 'templates', 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(root, name), { recursive: true });
  await write('workspace.json', json({ format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Composition preview smoke', createdAt: 0,
    ...WORKSPACE_LAYOUT, documentTypes: template.documentTypes }));
  for (const [name, content] of Object.entries(template.templates)) await write(`templates/${name}`, content);
  await registerWorkspace(root);
  const execute = createWorldCommandService(root);
  const create = async (command, sourcePath, content) => {
    const view = await readWorldProjection(root), request = { command, mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
      actorRef: { kind: 'tool', id: 'composition-preview-smoke' }, objectId: randomUUID(), documentType: 'document', sourcePath, content };
    await execute(request); return request;
  };
  const core = await create('object.create', 'documents/core.md', '\uFEFF# Traveler / 旅人\r\n\r\n故事属于原 OC。  \r\n');
  const images = [];
  for (const color of ['#44aaee', '#ee6644']) {
    const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><script>fetch('http://127.0.0.1:9/viento-preview-script');top.__sceneSvgExecuted=true;</script><image href="http://127.0.0.1:9/viento-preview-external.png" width="1" height="1"/><rect width="32" height="32" fill="${color}"/></svg>`);
    const imported = await importMediaAsset(root, Readable.from([bytes]), `${color.slice(1)}.svg`); images.push(imported.asset);
  }
  const declaration = JSON.parse(await fs.readFile(path.join(appRoot, 'examples/scene-composition/recipe.json')));
  for (const [index, actor] of declaration.fragments[0].actors.entries()) { actor.objectId = core.objectId; actor.imageResourceId = images[index].id; }
  declaration.placements[1].overrides.push({ actorKey: 'companion', values: { speed: 0 } });
  delete declaration.fragments[0].actors[1].imageResourceId;
  const groupIds = declaration.placements.flatMap(item => Object.values(item.groupIds)), instanceIds = declaration.placements.flatMap(item => Object.values(item.actorIds));
  const serialize = value => '\uFEFF' + json(value).replaceAll('\n', '\r\n');
  const originalSource = serialize(declaration);
  const scene = await create('object.create', 'documents/scenes/recipe.json', originalSource);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root, XDG_CACHE_HOME: path.join(temporary, 'cache') };
  delete env.VIENTO_GODOT_BIN; delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
  const initial = await sourceTree(root), rejectedBuild = await captureBuildSnapshot(root, scene.objectId), base = await serve(t, appRoot, env);
  assert.equal(rejectedBuild.ok, false); assert.ok(rejectedBuild.diagnostics.some(item => item.code === 'build_scene_format'));
  const buildState = async () => { const response = await fetch(`${base}/api/project-build`); assert.equal(response.status, 200); const body = await response.json(); return body.data || body; };
  const catalog = await buildState(); assert.equal(catalog.available, false); assert.equal(catalog.job, null);
  assert.equal(catalog.scenes.length, 0); assert.equal(catalog.previewDocuments.find(item => item.id === scene.objectId)?.kind, 'composition');
  const profile = path.join(temporary, 'chrome'); await fs.mkdir(profile);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; } });
  let port;
  await wait(async () => { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return !!port; } catch { return false; } }, 'Chrome');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const pending = new Map(); let sequence = 0;
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.id) {
    const request = pending.get(value.id); pending.delete(value.id); value.error ? request?.reject(new Error(value.error.message)) : request?.resolve(value.result);
  } else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
    else if (value.method === 'Page.javascriptDialogOpening') { report.confirmations ||= []; report.confirmations.push(value.params.message); void call('Page.handleJavaScriptDialog', { accept: true }); }
    else if (value.method === 'Network.requestWillBeSent' && value.params.request.url.includes('127.0.0.1:9/viento-preview-')) report.svgRequests.push(value.params.request.url); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value, event = 'input') => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (input.id === 'docSourceEditor') { if (document.querySelector('#projectBuildDialog').open || input.disabled || !input.checkVisibility()) throw new Error('Source editor must be visible and interactive'); input.focus(); } input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === false && !document.querySelector(${JSON.stringify(selector)}).hidden`), `${selector} enabled`);
  const screenshot = async name => { const value = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(value.data, 'base64')); };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({ text: document.body.innerText, captures: window.__sceneCaptures, editor: document.querySelector('#docSourceEditor')?.value, state: (await import('/web/modules/app-state.js')).appState })`); report.serviceFailure = await buildState(); };
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable && document.querySelector('#projectBuildBtn')?.hidden === false`), 'preview-capable editor');
  await evaluate(`(() => { const original = window.fetch.bind(window); window.__sceneCaptures = []; window.fetch = async (input, init) => {
    const response = await original(input, init); const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/scene-preview') && init?.method === 'POST') {
      const body = await response.clone().json(); window.__sceneCaptures.push({ request: JSON.parse(init.body), status: response.status, payload: body.data || body });
      if (window.__holdNextPreview) { window.__holdNextPreview = false; window.__heldPreview = true; await new Promise(resolve => { window.__releasePreview = resolve; }); }
    } return response;
  }; })()`);
  const latest = () => evaluate('window.__sceneCaptures.at(-1)');
  const captureCount = () => evaluate('window.__sceneCaptures.length');
  const editorText = () => evaluate("document.querySelector('#docSourceEditor').value");
  const modalBusy = () => evaluate("document.querySelector('#projectBuildPreviewPanel').getAttribute('aria-busy') === 'true'");
  const waitCapture = async count => { await wait(async () => await captureCount() > count && !(await modalBusy()), 'preview response and images complete'); return latest(); };
  const refreshDraft = async () => { await enabled('#scenePreviewDraftRefresh'); const count = await captureCount(); await click('#scenePreviewDraftRefresh'); return waitCapture(count); };
  const refreshSaved = async () => { await enabled('#scenePreviewRefresh'); const count = await captureCount(); await click('#scenePreviewRefresh'); return waitCapture(count); };
  const openPreview = async (waitReady = true) => { await click('#projectBuildBtn'); await enabled('#projectBuildTabPreview'); await click('#projectBuildTabPreview'); await enabled('#projectBuildScene'); await fill('#projectBuildScene', scene.objectId, 'change');
    await wait(() => evaluate("document.querySelector('#projectBuildDialog').open && !document.querySelector('#projectBuildPreviewPanel').hidden"), 'preview panel'); if (waitReady) await enabled('#scenePreviewRefresh'); };
  const closePreview = async () => { await click('#projectBuildClose'); await wait(() => evaluate("!document.querySelector('#projectBuildDialog').open"), 'return editor'); };
  const readOnlyButtons = async () => {
    for (const id of ['scenePreviewEdit','scenePreviewLayoutEdit','scenePreviewDraftLayoutEdit']) {
      assert.equal(await evaluate(`document.querySelector('#${id}').hidden && document.querySelector('#${id}').disabled`), true, `${id} must stay read-only`);
      await click(`#${id}`);
    }
    assert.equal(await evaluate(`Boolean(document.querySelector('#sceneLayoutDialog')?.open || document.querySelector('#sceneCreateDialog')?.open)`), false);
    assert.equal((await buildState()).job, null);
  };
  const assertDraftInput = async value => assert.equal(await editorText(), value.replace(/\r\n|\r/g, '\n'), 'draft input retained including Unicode and BOM');
  const selectActor = () => click(`#scenePreviewObjects button[data-actor-id="${instanceIds[2]}"]`);

  await openPreview(); await wait(async () => (await latest())?.payload?.ok && !(await modalBusy()), 'saved recipe');
  const saved = (await latest()).payload;
  assert.equal(saved.actors.length, 4); assert.equal(saved.sceneEditing, undefined); await readOnlyButtons();
  assert.equal(await evaluate("document.querySelector('#scenePreviewCompositionFragment').disabled"), true);
  await click('#scenePreviewSource'); await wait(() => evaluate("document.activeElement.id === 'docSourceEditor' && !document.querySelector('#projectBuildDialog').open"), 'clean recipe source');
  const readScene = () => fs.readFile(path.join(root, scene.sourcePath), 'utf8');
  await evaluate("window.__appState=(await import('/web/modules/app-state.js')).appState");
  const state = () => evaluate('({dirty:window.__appState.editHasUnsavedChanges,base:window.__appState.activeEditSourceVersion})');
  const cleanState = await state(); assert.equal(cleanState.dirty, false);
  const el = suffix => '#sceneCompositionFragments' + suffix;
  const fragmentOpen = async (id = instanceIds[2]) => {
    await click(`#scenePreviewObjects button[data-actor-id="${id}"]`);
    await enabled('#scenePreviewCompositionFragment'); await click('#scenePreviewCompositionFragment');
    await wait(() => evaluate("document.querySelector('#sceneCompositionFragmentsDialog')?.open && !document.querySelector('#sceneCompositionFragmentsPositionSelected').disabled"), 'fragment editor');
  };
  const mark = async suffix => { if (!(await evaluate(`document.querySelector(${JSON.stringify(el(suffix+'Selected'))}).checked`))) await click(el(suffix+'Selected')); };
  const check = async () => { await enabled(el('Check')); const count = await captureCount(); await click(el('Check')); await enabled(el('Apply'));
    assert.ok(await captureCount() > count); return evaluate("document.querySelector('#sceneCompositionFragmentsSource').textContent"); };
  const cancel = async () => { await enabled(el('Cancel')); await click(el('Cancel')); await wait(() => evaluate("!document.querySelector('#sceneCompositionFragmentsDialog').open"), 'cancel fragment'); };
  const apply = async () => { await enabled(el('Apply')); await click(el('Apply')); await wait(() => evaluate("!document.querySelector('#sceneCompositionFragmentsDialog').open && !document.querySelector('#projectBuildDialog').open && document.activeElement.id==='docSourceEditor'"), 'fragment applied to source'); };
  const unchanged = async () => { assert.deepEqual(await sourceTree(root), initial); assert.equal(await readScene(), originalSource); };
  const changeLeader = async () => { await mark('Position'); await fill(el('X'),145); await fill(el('Y'),200);
    await mark('Size'); await fill(el('Width'),72); await fill(el('Height'),40); await mark('Color'); await fill(el('Color'),'#3366ff'); };

  await openPreview(); await refreshSaved(); await fragmentOpen();
  assert.equal(await evaluate("document.querySelector('#sceneCompositionFragmentsX').value"),'120');
  assert.equal(await evaluate("document.querySelector('#sceneCompositionFragmentsColor').value"),'#ffffff');
  assert.equal(await evaluate("document.querySelector('#sceneCompositionFragmentsCheck').disabled"),true);
  assert.equal(await evaluate("document.querySelector('#sceneCompositionFragmentsTargets').children.length"),2);
  await cancel(); await unchanged();
  report.steps.push('A locally overridden instance opens its raw shared declaration, not its effective or local values. No field is implicitly selected and cancel preserves all author bytes.');

  await fragmentOpen(); await changeLeader(); let candidate=await check();
  let reviewed=JSON.parse(candidate.replace(/^\ufeff/,''));
  assert.deepEqual(reviewed.placements,declaration.placements);
  assert.deepEqual(reviewed.fragments[0].actors[1],declaration.fragments[0].actors[1]);
  assert.deepEqual(reviewed.fragments[0].actors[0].position,[145,200]);
  assert.deepEqual(reviewed.fragments[0].actors[0].size,[72,40]); assert.equal(reviewed.fragments[0].actors[0].color,'#3366ff');
  const checked=(await latest()).payload; assert.deepEqual(checked.actors[0].position,[145,200]);
  assert.deepEqual(checked.actors[2].position,[460,220]); assert.equal(checked.actors[2].color,'#f1c46e');
  assert.deepEqual(checked.actors[0].size,[72,40]); assert.deepEqual(checked.actors[2].size,[72,40]);
  assert.equal(await evaluate("document.querySelector('#sceneCompositionFragmentsTargets').children.length"),2);
  const impacts=await evaluate("document.querySelector('#sceneCompositionFragmentsTargets').textContent");
  assert.ok(impacts.includes('局部覆盖仍优先') && impacts.includes('参与共享修改'));
  assert.ok(candidate.startsWith('\ufeff') && candidate.includes('\r\n')); await unchanged();
  for (const locale of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(locale)})`);
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false}); await delay(100);
    await evaluate("document.querySelector('#sceneCompositionFragmentsCheck').scrollIntoView({block:'end'})");
    const bounds=await evaluate("(()=>{const d=document.querySelector('#sceneCompositionFragmentsDialog'),b=d.getBoundingClientRect();return {left:b.left,right:b.right,scrollWidth:d.scrollWidth,width:d.clientWidth,apply:document.querySelector('#sceneCompositionFragmentsApply').disabled};})()");
    assert.ok(bounds.left>=0 && bounds.right<=391 && bounds.scrollWidth<=bounds.width+1); assert.equal(bounds.apply,false);
    await screenshot(`fragment-narrow-${locale}.png`); await unchanged();
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");
  await screenshot('fragment-source-review.png'); await apply(); await assertDraftInput(candidate); await unchanged();
  assert.equal((await state()).base,cleanState.base); assert.equal((await state()).dirty,true);
  report.steps.push('Three explicitly selected fields create one exact shared actor patch. Both placements inherit size, while an existing local position and color stay authoritative. Complete source and per-instance impact review survives three 390px locales; apply only edits memory.');

  await enabled('#docSaveBtn'); await click('#docSaveBtn'); await wait(async()=>await readScene()===candidate,'ordinary shared declaration save');
  assert.equal((await state()).dirty,false); let after=await sourceTree(root);
  assert.deepEqual(Object.keys(initial).filter(file=>after[file]!==initial[file]),[scene.sourcePath]);
  await openPreview(); await refreshSaved(); const reopened=(await latest()).payload;
  assert.deepEqual(reopened.actors.map(a=>a.instanceId),instanceIds); assert.deepEqual(reopened.sceneStructure,saved.sceneStructure);
  assert.deepEqual(reopened.actors.map(a=>a.position),[[145,200],[200,180],[460,220],[560,260]]);
  report.steps.push('Normal Save changes only the original recipe, and reopening preserves all stable instances, groups, placements, local overrides, metadata and asset bytes.');

  await fragmentOpen(instanceIds[1]); assert.equal(await evaluate("document.querySelector('#sceneCompositionFragmentsImage').value"),'');
  assert.equal(await evaluate("document.querySelector('#sceneCompositionFragmentsImageSelected').checked"),false);
  await mark('Image'); await fill(el('Image'),images[1].id,'change'); const imageCandidate=await check();
  const withImage=JSON.parse(imageCandidate.replace(/^\ufeff/,''));
  assert.equal(withImage.fragments[0].actors[1].imageResourceId,images[1].id);
  assert.deepEqual(withImage.placements,declaration.placements);
  assert.equal((await latest()).payload.actors[1].imageResourceId,images[1].id);
  assert.equal((await latest()).payload.actors[3].imageResourceId,images[1].id);
  await apply(); assert.equal(await readScene(),candidate); await enabled('#docSaveBtn'); await click('#docSaveBtn');
  await wait(async()=>await readScene()===imageCandidate,'shared missing image declaration save'); candidate=imageCandidate;
  report.steps.push('An absent optional image field stays unselected and empty until explicitly set to a registered resource; full dependency/image review reaches both associated instances and ordinary Save preserves other declarations.');

  await openPreview(); await refreshSaved(); await fragmentOpen(); await mark('Speed'); await fill(el('Speed'),190); await check();
  await evaluate("document.querySelector('#sceneCompositionFragmentsSpeed').value='191'"); await click(el('Apply'));
  assert.equal(await evaluate("document.querySelector('#sceneCompositionFragmentsApply').disabled"),true); await cancel();
  assert.equal(await readScene(),candidate); report.steps.push('A field changed without an input event cannot reuse review approval. Cancel leaves the saved declaration untouched.');

  await fragmentOpen(); await mark('Speed'); await fill(el('Speed'),195); const conflicted=await check();
  const external=candidate.replace('Two parties','External shared / 外部'); await write(scene.sourcePath,external);
  await apply(); await assertDraftInput(conflicted); await enabled('#docSaveBtn'); await click('#docSaveBtn');
  await wait(()=>evaluate("!document.querySelector('#docSaveConflictDialog').classList.contains('is-hidden')"),'ordinary save conflict');
  await screenshot('fragment-save-conflict.png'); await click('#docSaveConflictCancelBtn');
  assert.equal(await readScene(),external); await assertDraftInput(conflicted); assert.equal((await state()).dirty,true);
  after=await sourceTree(root); assert.deepEqual(Object.keys(initial).filter(file=>file!==scene.sourcePath && after[file]!==initial[file]),[]);
  assert.equal((await buildState()).job,null); assert.equal(await evaluate('Boolean(window.__sceneSvgExecuted)'),false);
  assert.equal(report.errors.length,0); assert.equal(report.svgRequests.length,0);
  report.steps.push('An external source write after shared review is protected by normal Save conflict handling, preserving both external bytes and the local shared draft without forced overwrite.');
  report.created={recipeId:scene.objectId,instanceIds,groupIds,images:images.map(a=>a.id)};
  report.authorFiles={before:initial,after}; report.captures=await evaluate('window.__sceneCaptures');
  report.normalSave={sourceSha256:buildHash(candidate),onlyChangedFile:scene.sourcePath};
  report.layout={rawTemplateOnly:true,explicitFields:true,linkedInstanceMasks:true,completeDependencyReview:true,localOverridesStable:true,absentImageExplicit:true,ordinarySave:true,stableIds:true}; report.ok=true;
} catch(error) { process.exitCode=1; report.ok=false; report.failure=error.stack||String(error); try {await captureFailure?.();} catch(e){report.captureFailure=e.message;} }
finally { socket?.close(); for(const cleanup of cleanups.reverse()) try {await cleanup();} catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}
  report.finishedAt=new Date().toISOString(); await fs.writeFile(path.join(output,'browser.json'),json(report)); console.log(JSON.stringify({ok:report.ok,steps:report.steps,limitations:report.limitations,failure:report.failure,output},null,2)); }
