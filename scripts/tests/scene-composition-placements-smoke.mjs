// Real browser placement ADD/COPY/REMOVE → complete preview → guarded memory source → ordinary save in a disposable recipe.
// Run: VIENTO_COMPOSITION_PLACEMENTS_OUTPUT=/empty/evidence/path node scripts/tests/scene-composition-placements-smoke.mjs [chromium]
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
import { registerWorkspace, resolveAssetRoot } from '../lib/workspace.mjs';
import { importMediaAsset } from '../lib/media-assets.mjs';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';
import { getProjectionTemplates, lockProjectionTemplate } from '../../engine/object-projection-template.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.env.VIENTO_COMPOSITION_PLACEMENTS_OUTPUT || path.join(os.tmpdir(), `viento-placements-evidence-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_COMPOSITION_PLACEMENTS_OUTPUT directory; prior evidence is immutable.');
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], errors: [], svgRequests: [], limitations: [
  'Real HTTP editor and Chrome only; no installed Tauri window or Android device acceptance.',
  'One recipe placement ADD/COPY/REMOVE only; no fragment/group definition editing, executable recipe build or cross-file transaction.',
] };
const reviewedSources=['scripts/tests/scene-composition-placements-smoke.mjs','engine/scene-composition-placements.mjs','engine/studio-core.mjs','engine/studio-core.wasm',
  'crates/viento-studio-core/src/scene_composition_placements_patch.rs','web/modules/app-scene-composition-placements.js','engine/scene-authoring-candidate.mjs','engine/scene-authoring-workflow.mjs','web/modules/app-scene-authoring.js','web/modules/app-scene-preview.js','web/modules/app-project-build.js','web/modules/app-runtime.js','web/i18n/en.js','web/i18n/ja.js'];
report.node={version:process.version,sha256:buildHash(await fs.readFile(process.execPath))};
report.sources=Object.fromEntries(await Promise.all(reviewedSources.map(async name=>[name,buildHash(await fs.readFile(path.join(appRoot,name)))])));
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-placements-browser-'));
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
  for (const color of ['#44aaee', '#ee6644', '#aa44ee']) {
    const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><script>fetch('http://127.0.0.1:9/viento-preview-script');top.__sceneSvgExecuted=true;</script><image href="http://127.0.0.1:9/viento-preview-external.png" width="1" height="1"/><rect width="32" height="32" fill="${color}"/></svg>`);
    const imported = await importMediaAsset(root, Readable.from([bytes]), `${color.slice(1)}.svg`); images.push(imported.asset);
  }
  const selected = getProjectionTemplates().find(item => item.id.endsWith('.rpg-player'));
  const configuration = { ...Object.fromEntries(selected.fields.map(field => [field.id, field.default])),
    width: 96, height: 56, color: '#2288aa', speed: 175, controls: 'arrows', image: images[0].id };
  const projection = await create('projection.create', 'documents/projections/player.json', json({
    format: 'viento-object-projection', schemaVersion: 1, title: 'Player defaults', sourceObjectId: core.objectId,
    template: await lockProjectionTemplate(selected, { digest: buildHash }), configuration }));
  const unusedProjection = await create('projection.create', 'documents/projections/unused-player.json', json({
    format: 'viento-object-projection', schemaVersion: 1, title: 'Unused player defaults', sourceObjectId: core.objectId,
    template: await lockProjectionTemplate(selected, { digest: buildHash }), configuration: { ...configuration, image: images[2].id } }));
  const declaration = JSON.parse(await fs.readFile(path.join(appRoot, 'examples/scene-composition/recipe.json')));
  for (const [index, actor] of declaration.fragments[0].actors.entries()) { actor.objectId = core.objectId; actor.imageResourceId = images[index].id; }
  declaration.fragments[0].actors[0].objectId = projection.objectId;
  declaration.fragments[0].actors[0].useProjectionDefaults = true;
  declaration.fragments[0].actors[0].imageResourceId = null;
  declaration.placements[0].overrides = [{ actorKey: 'leader', values: {
    position: [100.125, 140.25], size: [88.5, 64.25], color: '#f1c46eff', speed: 0, controls: 'none', imageResourceId: null } }];
  declaration.placements[1].offset = [0, 0];
  declaration.placements[1].overrides = [{ actorKey: 'companion', values: {
    position: [220.5, 200.25], size: [50.5, 50.25], color: '#abcdee', speed: 1, controls: 'arrows', imageResourceId: images[1].id } }];
  declaration.fragments.push({ fragmentId: 'unused', groups: [{ key: 'solo', name: 'First placement / 初放置 / 初配置' }], actors: [{
    key: 'newcomer', objectId: unusedProjection.objectId, groupKey: 'solo', position: [350, 260], useProjectionDefaults: true }] });
  const groupIds = declaration.placements.flatMap(item => Object.values(item.groupIds)), instanceIds = declaration.placements.flatMap(item => Object.values(item.actorIds));
  const serialize = value => '\uFEFF' + json(value).replaceAll('\n', '\r\n');
  // Non-canonical author spelling is intentional. Copy must preserve these tokens.
  const originalSource = serialize(declaration).replace('100.125', '1.00125e2').replace('140.25', '1.4025e2').replaceAll('"leader":', '"le\\u0061der":');
  const scene = await create('object.create', 'documents/scenes/recipe.json', originalSource);
  const onlyPlacement = structuredClone(declaration); onlyPlacement.placements = [onlyPlacement.placements[0]]; onlyPlacement.scene.title = 'Last placement guard';
  const singleSource = serialize(onlyPlacement), singleScene = await create('object.create', 'documents/scenes/last-placement.json', singleSource);
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
  const instrumentFetch = () => evaluate(`(() => { const original = window.fetch.bind(window); window.__sceneCaptures = []; window.fetch = async (input, init) => {
    const response = await original(input, init); const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/scene-preview') && init?.method === 'DELETE') (window.__previewReleases ||= []).push(url);
    if (url.includes('/api/scene-preview') && init?.method === 'POST') {
      const body = await response.clone().json(); window.__sceneCaptures.push({ request: JSON.parse(init.body), status: response.status, payload: body.data || body });
      if (window.__holdNextPreview) { window.__holdNextPreview = false; window.__heldPreview = true; await new Promise(resolve => { window.__releasePreview = resolve; }); }
      if (window.__tamperNextPreview) { window.__tamperNextPreview = false; (body.data || body).sourceLocations.groups.pop(); return new Response(JSON.stringify(body), {status:response.status,headers:response.headers}); }
    } return response;
  }; })()`);
  await instrumentFetch();
  report.capturePhases=[];
  const archiveCaptures=async name=>report.capturePhases.push({name,captures:await evaluate('window.__sceneCaptures'),released:await evaluate('window.__previewReleases||[]')});
  const latest = () => evaluate('window.__sceneCaptures.at(-1)');
  const captureCount = () => evaluate('window.__sceneCaptures.length');
  const editorText = () => evaluate("document.querySelector('#docSourceEditor').value");
  const modalBusy = () => evaluate("document.querySelector('#projectBuildPreviewPanel').getAttribute('aria-busy') === 'true'");
  const waitCapture = async count => { await wait(async () => await captureCount() > count && !(await modalBusy()), 'preview response and images complete'); return latest(); };
  const refreshDraft = async () => { await enabled('#scenePreviewDraftRefresh'); const count = await captureCount(); await click('#scenePreviewDraftRefresh'); return waitCapture(count); };
  const refreshSaved = async () => { await enabled('#scenePreviewRefresh'); const count = await captureCount(); await click('#scenePreviewRefresh'); return waitCapture(count); };
  const openPreview = async (sceneId = scene.objectId, waitReady = true) => { await click('#projectBuildBtn'); await enabled('#projectBuildTabPreview'); await click('#projectBuildTabPreview'); await enabled('#projectBuildScene'); await fill('#projectBuildScene', sceneId, 'change');
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
  assert.equal(await evaluate("document.querySelector('#scenePreviewCompositionPlacements').disabled"), true);
  await click('#scenePreviewSource'); await wait(() => evaluate("document.activeElement.id === 'docSourceEditor' && !document.querySelector('#projectBuildDialog').open"), 'clean recipe source');
  await evaluate("window.__appState=(await import('/web/modules/app-state.js')).appState");
  const state = () => evaluate('({dirty:window.__appState.editHasUnsavedChanges,base:window.__appState.activeEditSourceVersion})');
  const readScene = () => fs.readFile(path.join(root, scene.sourcePath), 'utf8');
  assert.equal((await state()).dirty, false);
  const el = suffix => '#sceneCompositionPlacements' + suffix;
  const parsed = text => JSON.parse(text.replace(/^\ufeff/, ''));
  const identity = payload => ({ actors:payload.actors.map(item=>item.instanceId), groups:payload.sceneStructure.groups.map(item=>item.groupId) });
  const rawSpan = (content, pointer) => { const data=parseJsonSource(content); assert.equal(data.ok,true); const span=locateJsonSource(data,pointer); assert.ok(span,pointer); return content.slice(span.start,span.end); };
  const placementSpan = (content,id) => rawSpan(content,'/placements/'+parsed(content).placements.findIndex(item=>item.placementId===id));
  const assertUntouched = (before,after,removed=null) => {
    assert.equal(rawSpan(after,'/fragments'),rawSpan(before,'/fragments'),'Shared fragment raw bytes stay unchanged');
    assert.equal(rawSpan(after,'/scene'),rawSpan(before,'/scene'),'Scene header raw bytes stay unchanged');
    for(const item of parsed(before).placements) if(item.placementId!==removed) assert.equal(placementSpan(after,item.placementId),placementSpan(before,item.placementId),'Unrelated placement raw span: '+item.placementId);
    assert.ok(after.startsWith('\uFEFF')); assert.ok(after.includes('\r\n'));
  };
  const openPlacements = async () => {
    await enabled('#scenePreviewCompositionPlacements'); await click('#scenePreviewCompositionPlacements');
    await wait(()=>evaluate("document.querySelector('#sceneCompositionPlacementsDialog')?.open && !document.querySelector('#sceneCompositionPlacementsFragment').disabled"),'source-bound placement editor');
  };
  const chooseFragment = async id => { await fill(el('Fragment'),id,'change'); await delay(30); };
  const choosePlacement = async id => { await fill(el('Placement'),id,'change'); await delay(30); };
  const checkbox = async value => { if(await evaluate("document.querySelector('#sceneCompositionPlacementsOffsetEnabled').checked")!==value)await click(el('OffsetEnabled')); };
  const configureAdd = async (fragment='unused',offset=null) => { await chooseFragment(fragment);await enabled(el('Add'));await click(el('Add')); if(offset!==null){await checkbox(true);await fill(el('X'),String(offset[0]));await fill(el('Y'),String(offset[1]));} };
  const configureCopy = async id => { await choosePlacement(id);await enabled(el('Copy'));await click(el('Copy')); };
  const configureRemove = async id => { await choosePlacement(id);await enabled(el('Remove'));await click(el('Remove')); };
  const currentTargets = () => evaluate("[...document.querySelector('#sceneCompositionPlacementsTargets').children].filter(n=>n.dataset.placementId).map(n=>({placementId:n.dataset.placementId,fragmentId:n.dataset.fragmentId,actors:[...n.querySelectorAll('[data-instance-id]')].map(a=>({instanceId:a.dataset.instanceId,actorKey:a.dataset.actorKey})),groups:[...n.querySelectorAll('[data-group-id]')].map(g=>({groupId:g.dataset.groupId,groupKey:g.dataset.groupKey}))}))");
  const check = async () => { await enabled(el('Check'));const count=await captureCount();await click(el('Check'));await enabled(el('Apply'));assert.ok(await captureCount()>count);return {content:await evaluate("document.querySelector('#sceneCompositionPlacementsSource').textContent"),preview:(await latest()).payload}; };
  const failedCheck = async flag => { if(flag)await evaluate(`window.${flag}=true`);await enabled(el('Check'));await click(el('Check'));await wait(()=>evaluate("document.querySelector('#sceneCompositionPlacementsDialog').getAttribute('aria-busy')==='false' && document.querySelector('#sceneCompositionPlacementsApply').disabled && document.querySelector('#sceneCompositionPlacementsMessage').textContent.length>0"),'candidate rejected without approval'); };
  const cancel = async () => { await enabled(el('Cancel'));await click(el('Cancel'));await wait(()=>evaluate("!document.querySelector('#sceneCompositionPlacementsDialog').open"),'cancel placement operation'); };
  const apply = async () => { await enabled(el('Apply'));await click(el('Apply'));await wait(()=>evaluate("!document.querySelector('#sceneCompositionPlacementsDialog').open && !document.querySelector('#projectBuildDialog').open && document.activeElement.id==='docSourceEditor'"),'apply placement to ordinary source'); };
  const save = async content => { await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readScene()===content,'ordinary raw recipe Save');assert.equal((await state()).dirty,false); };
  const reopen = async id => { await openPreview(id);return (await refreshSaved()).payload; };
  const sourceOpen = async () => { await click('#scenePreviewSource');await wait(()=>evaluate("document.activeElement.id==='docSourceEditor' && !document.querySelector('#projectBuildDialog').open"),'open ordinary source'); };
  const changedAuthorFiles = async () => { const current=await sourceTree(root);assert.deepEqual(Object.keys(current),Object.keys(initial));return Object.keys(current).filter(key=>current[key]!==initial[key]); };
  const newIdentity = (target,before) => {
    const ids=[target.placementId,...target.actors.map(a=>a.instanceId),...target.groups.map(g=>g.groupId)];
    const existing=new Set([scene.objectId,...parsed(before).placements.flatMap(p=>[p.placementId,...Object.values(p.actorIds),...Object.values(p.groupIds)])]);
    assert.equal(new Set(ids).size,ids.length);assert.ok(ids.every(id=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)&&!existing.has(id)));
  };
  const verifyComplete = (content,payload) => {
    const value=parsed(content);const actors=[],groups=[];
    for(const placement of value.placements){const fragment=value.fragments.find(f=>f.fragmentId===placement.fragmentId);
      for(const actor of fragment.actors){const id=placement.actorIds[actor.key];actors.push(id);const actual=payload.actors.find(item=>item.instanceId===id),location=payload.sourceLocations.actors.find(item=>item.instanceId===id);assert.ok(actual);assert.equal(actual.objectId,actor.objectId);assert.deepEqual(location.composition,{fragmentId:fragment.fragmentId,placementId:placement.placementId,localKey:actor.key});assert.equal(location.declaration.objectId,scene.objectId);assert.equal(location.declaration.sourcePath,scene.sourcePath);assert.equal(location.declaration.sourceRevision,payload.composition.sourceRevision);
        const membership=payload.sceneStructure.memberships.find(item=>item.instanceId===id);if(actor.groupKey)assert.equal(membership?.groupId,placement.groupIds[actor.groupKey]);
      }
      for(const group of fragment.groups){const id=placement.groupIds[group.key];groups.push(id);const actual=payload.sceneStructure.groups.find(item=>item.groupId===id),location=payload.sourceLocations.groups.find(item=>item.groupId===id);assert.ok(actual);if(group.parentKey)assert.equal(actual.parentId||actual.parentGroupId,placement.groupIds[group.parentKey]);assert.deepEqual(location.composition,{fragmentId:fragment.fragmentId,placementId:placement.placementId,localKey:group.key});assert.equal(location.declaration.sourceRevision,payload.composition.sourceRevision);}
    }
    assert.deepEqual(identity(payload),{actors,groups});
  };
  let committed=originalSource;
  await reopen();await openPlacements();
  assert.deepEqual(await evaluate("[...document.querySelector('#sceneCompositionPlacementsFragment').options].map(n=>n.value)"),['party','unused']);
  await configureAdd();const unusedTarget=(await currentTargets())[0];newIdentity(unusedTarget,committed);
  const assetRecord=JSON.parse(await fs.readFile(path.join(root,'metadata/assets',`${images[2].id}.json`))),assetFile=path.join(resolveAssetRoot(root),assetRecord.location.path),heldAsset=path.join(temporary,'held-unused.svg');
  await fs.rename(assetFile,heldAsset);await failedCheck();assert.equal((await latest()).payload.ok,false);assert.equal(await readScene(),committed);assert.deepEqual(await currentTargets(),[unusedTarget]);
  await fs.rename(heldAsset,assetFile);const canceledAdd=await check();assert.equal(canceledAdd.preview.actors.length,5);assertUntouched(committed,canceledAdd.content);await cancel();assert.deepEqual(await sourceTree(root),initial);
  report.steps.push('An unused fragment becomes a first placement with explicit fresh maps; its previously unconsumed projection image is checked by real complete preview, missing bytes reject approval, and Cancel preserves all author files.');

  await openPlacements();await configureAdd('unused',[20.5,-10.25]);const addedTarget=(await currentTargets())[0];newIdentity(addedTarget,committed);
  await fill(el('X'),'21');await fill(el('X'),'20.5');assert.deepEqual(await currentTargets(),[addedTarget]);
  const added=await check(),addedPlacement=parsed(added.content).placements.at(-1);assertUntouched(committed,added.content);assert.deepEqual(addedPlacement.offset,[20.5,-10.25]);assert.equal(Object.hasOwn(addedPlacement,'overrides'),false);verifyComplete(added.content,added.preview);
  const newcomer=added.preview.actors.find(item=>item.instanceId===addedTarget.actors[0].instanceId);assert.equal(newcomer.objectId,unusedProjection.objectId);assert.equal(newcomer.origin.objectId,core.objectId);assert.deepEqual(newcomer.position,[370.5,249.75]);assert.deepEqual(newcomer.size,[96,56]);assert.equal(newcomer.imageResourceId,images[2].id);
  report.layout={};
  for(const language of ['zh-CN','en','ja']){
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await delay(160);await evaluate("document.querySelector('#sceneCompositionPlacementsDialog').scrollTop=0");await delay(100);
    const metrics=await evaluate("(()=>{const d=document.querySelector('#sceneCompositionPlacementsDialog'),f=d.querySelector('footer').getBoundingClientRect();return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth+2,actionsVisible:f.top>=0&&f.bottom<=innerHeight+2,approved:!document.querySelector('#sceneCompositionPlacementsApply').disabled,text:d.innerText};})()");
    assert.ok(metrics.noHorizontalOverflow);assert.ok(metrics.actionsVisible);assert.ok(metrics.approved);assert.ok(metrics.text.includes(await evaluate("(await import('/web/i18n/index.js')).t('检查放置结构修改')")));assert.deepEqual(await currentTargets(),[addedTarget]);
    report.layout[language]={noHorizontalOverflow:true,actionsVisible:true,approved:true};await screenshot(`placements-narrow-${language}.png`);
    await evaluate("document.querySelector('#sceneCompositionPlacementsTargets').scrollIntoView({block:'center'})");await delay(100);await screenshot(`placements-impact-${language}.png`);
  }
  await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");await call('Emulation.clearDeviceMetricsOverride');await delay(100);await screenshot('placements-reviewed.png');
  await evaluate("document.querySelector('#sceneCompositionPlacementsX').value='21.5'");await click(el('Apply'));assert.equal(await evaluate("document.querySelector('#sceneCompositionPlacementsDialog').open && document.querySelector('#sceneCompositionPlacementsApply').disabled"),true);
  await fill(el('X'),'20.5');const approvedAdd=await check();assert.deepEqual(await currentTargets(),[addedTarget]);await apply();await assertDraftInput(approvedAdd.content);assert.equal((await state()).dirty,true);assert.equal(await readScene(),committed);await save(approvedAdd.content);committed=approvedAdd.content;
  assert.deepEqual(await changedAuthorFiles(),[scene.sourcePath]);verifyComplete(committed,await reopen());
  report.steps.push('ADD keeps one UUID allocation during raw input changes, repeated review and three 390px languages; projection, image, nested identity provenance and offset are complete. Silent unreviewed input is refused; Apply changes memory and ordinary Save preserves BOM/CRLF.');

  const copyAndSave=async(id,{tamper=false}={})=>{
    const before=committed;await openPlacements();await configureCopy(id);const target=(await currentTargets())[0];newIdentity(target,before);assert.equal(target.actors.length,2);assert.equal(target.groups.length,2);
    if(tamper){await failedCheck('__tamperNextPreview');assert.equal((await latest()).payload.ok,true,'The actual server result was valid before the controlled receipt corruption');assert.deepEqual(await currentTargets(),[target]);}
    const copied=await check(),original=parsed(before).placements.find(p=>p.placementId===id),candidate=parsed(copied.content).placements.at(-1);
    assertUntouched(before,copied.content);assert.equal(candidate.fragmentId,original.fragmentId);assert.deepEqual(candidate.overrides,original.overrides);assert.equal(Object.hasOwn(candidate,'offset'),Object.hasOwn(original,'offset'));if(Object.hasOwn(original,'offset'))assert.deepEqual(candidate.offset,original.offset);
    let expectedRaw=placementSpan(before,id);for(const[previous,next]of [[original.placementId,candidate.placementId],...Object.keys(original.actorIds).map(k=>[original.actorIds[k],candidate.actorIds[k]]),...Object.keys(original.groupIds).map(k=>[original.groupIds[k],candidate.groupIds[k]])])expectedRaw=expectedRaw.replaceAll(JSON.stringify(previous),JSON.stringify(next));
    assert.equal(placementSpan(copied.content,candidate.placementId),expectedRaw,'Only placement/actor/group UUID string values change in copied raw source span');
    verifyComplete(copied.content,copied.preview);for(const key of Object.keys(original.actorIds)){const old=copied.preview.actors.find(a=>a.instanceId===original.actorIds[key]),fresh=copied.preview.actors.find(a=>a.instanceId===candidate.actorIds[key]);for(const field of ['position','size','color','speed','controls','imageResourceId'])assert.deepEqual(fresh[field],old[field],'Copied effective field '+field);}
    await apply();assert.equal(await readScene(),before);await save(copied.content);committed=copied.content;verifyComplete(committed,await reopen());return {id:candidate.placementId,target};
  };
  const copiedAbsent=await copyAndSave(declaration.placements[0].placementId),copiedZero=await copyAndSave(declaration.placements[1].placementId,{tamper:true});
  report.steps.push('COPY appends two full nested-group placements with fresh complete maps, retaining every six-field local override, absent versus explicit-zero offset, escaped keys and exponent tokens byte-for-byte except identity values. A deliberately corrupted group provenance receipt is rejected, then retry succeeds and saved reopen retains identities.');

  const beforeRemove=committed;await click(`#scenePreviewObjects button[data-actor-id="${instanceIds[0]}"]`);await openPlacements();assert.equal(await evaluate("document.querySelector('#sceneCompositionPlacementsPlacement').value"),declaration.placements[0].placementId);
  await configureRemove(declaration.placements[0].placementId);const removed=await check();assertUntouched(beforeRemove,removed.content,declaration.placements[0].placementId);assert.equal(parsed(removed.content).placements.some(p=>p.placementId===declaration.placements[0].placementId),false);verifyComplete(removed.content,removed.preview);assert.equal(removed.preview.actors.some(a=>a.instanceId===instanceIds[0]),false);await cancel();assert.equal(await readScene(),beforeRemove);
  await openPlacements();await configureRemove(declaration.placements[0].placementId);const approvedRemove=await check();await apply();await save(approvedRemove.content);committed=approvedRemove.content;verifyComplete(committed,await reopen());
  report.steps.push('REMOVE may remove the placement containing the selected opener. Complete actor/group mappings and local overrides disappear together; shared raw fragments and every other placement span remain unchanged. Cancel and ordinary Save/reopen both retain their proper source state.');

  await openPlacements();await configureAdd();const lateBefore=await editorText(),releaseCount=await evaluate('(window.__previewReleases||[]).length');await evaluate('window.__holdNextPreview=true');await click(el('Check'));await wait(()=>evaluate('window.__heldPreview===true'),'real candidate held after HTTP completion');
  await evaluate("document.querySelector('#sceneCompositionPlacementsDialog').close()");await wait(()=>evaluate("!document.querySelector('#sceneCompositionPlacementsDialog').open"),'forced close owner expiry');await closePreview();const staleDraft=committed.replace('Two parties','Local owner changed');await fill('#docSourceEditor',staleDraft);assert.equal((await state()).dirty,true);await evaluate('window.__releasePreview()');
  await wait(async()=>await evaluate('(window.__previewReleases||[]).length')>releaseCount,'late candidate server session released');assert.equal(await editorText(),staleDraft.replace(/\r\n|\r/g,'\n'),'Late candidate cannot replace a changed visible source draft');assert.notEqual(await editorText(),lateBefore);assert.equal(await readScene(),committed);await fill('#docSourceEditor',committed);assert.equal((await state()).dirty,false);assert.equal(await evaluate("document.querySelector('#sceneCompositionPlacementsApply').disabled"),true);
  report.faultInjections=['One valid HTTP response has its last sourceLocations.groups entry removed before delivery.','A real HTTP response is held, then its child is forcibly closed and the parent preview is closed; an actual visible source edit changes ownership before response delivery.','Capability phases wrap only the new WASM capability export at page boot; every other export and all HTTP/DOM controllers remain real.'];
  report.steps.push('A held real candidate arriving after dialog and source ownership change never reopens or replaces the new visible draft and is released by the HTTP host; this is an explicit asynchronous fault injection.');
  await openPreview(singleScene.objectId);await refreshSaved();await sourceOpen();await openPreview(singleScene.objectId);await refreshSaved();await openPlacements();
  assert.equal(await evaluate("document.querySelector('#sceneCompositionPlacementsRemove').disabled"),true);await click(el('Remove'));assert.equal(await evaluate("document.querySelector('#sceneCompositionPlacementsCheck').disabled"),true);await cancel();assert.equal(await fs.readFile(path.join(root,singleScene.sourcePath),'utf8'),singleSource);await closePreview();
  report.steps.push('The last remaining placement cannot be removed; the independent one-placement recipe stays byte-identical.');

  await archiveCaptures('ordinary-placement-authoring');
  report.capabilityPhases=[];
  for(const mode of ['absent','unsupported']){
    const source=`(()=>{const original=WebAssembly.instantiate.bind(WebAssembly);WebAssembly.instantiate=async(...args)=>{const result=await original(...args);if(result?.instance?.exports?.viento_core_scene_composition_placements_version){const exports={...result.instance.exports};${mode==='absent'?'delete exports.viento_core_scene_composition_placements_version;':'exports.viento_core_scene_composition_placements_version=()=>2;'}return{module:result.module,instance:{exports}};}return result;};})()`;
    const injection=await call('Page.addScriptToEvaluateOnNewDocument',{source});await call('Page.navigate',{url:`${base}/web/?mode=edit`});await wait(()=>evaluate("document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable&&document.querySelector('#projectBuildBtn')?.hidden===false"),'capability fault editor boot');await instrumentFetch();await evaluate("window.__appState=(await import('/web/modules/app-state.js')).appState");
    await openPreview();await refreshSaved();await sourceOpen();await openPreview();await refreshSaved();assert.equal(await evaluate("document.querySelector('#scenePreviewCompositionPlacements').disabled && !document.querySelector('#scenePreviewCompositionPlacements').hidden"),true);
    await click('#scenePreviewCompositionPlacements');assert.equal(await evaluate("document.querySelector('#sceneCompositionPlacementsDialog')?.open||false"),false);
    const actor=parsed(committed).placements[0].actorIds.leader;await click(`#scenePreviewObjects button[data-actor-id="${actor}"]`);
    const oldEntries=[['scenePreviewCompositionPlacement','sceneCompositionPlacement'],['scenePreviewCompositionStructure','sceneCompositionStructure'],['scenePreviewCompositionFragment','sceneCompositionFragments'],['scenePreviewCompositionLayout','sceneCompositionLayout'],['scenePreviewCompositionBatchLayout','sceneCompositionBatchLayout']];
    for(const[button,prefix]of oldEntries){await enabled('#'+button);await click('#'+button);await wait(()=>evaluate(`document.querySelector('#${prefix}Dialog')?.open`),'old editor '+prefix);await enabled('#'+prefix+'Cancel');await click('#'+prefix+'Cancel');await wait(()=>evaluate(`!document.querySelector('#${prefix}Dialog').open`),'old editor cancel '+prefix);}
    assert.equal(await readScene(),committed);await closePreview();await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier});report.capabilityPhases.push({mode,newEntryDisabled:true,oldEditorsOpenedAndCanceled:oldEntries.map(v=>v[0])});await archiveCaptures('capability-'+mode);
  }
  report.steps.push('With only the new WASM capability absent or unsupported, the placement-structure entry is disabled while five previous recipe editors still open and cancel through their real helpers; no author or backend build writes occur.');
  await call('Page.navigate',{url:`${base}/web/?mode=edit`});await wait(()=>evaluate("document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable&&document.querySelector('#projectBuildBtn')?.hidden===false"),'ordinary final editor boot');await instrumentFetch();await evaluate("window.__appState=(await import('/web/modules/app-state.js')).appState");await openPreview();await refreshSaved();await sourceOpen();await reopen();await openPlacements();await configureAdd('unused');const finalCandidate=await check();
  const external=committed.replace('Two parties','External placement edit');await fs.writeFile(path.join(root,scene.sourcePath),external);await apply();await assertDraftInput(finalCandidate.content);await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(()=>evaluate("!document.querySelector('#docSaveConflictDialog').classList.contains('is-hidden')"),'ordinary Save external source conflict');assert.equal(await readScene(),external);await assertDraftInput(finalCandidate.content);await click('#docSaveConflictCancelBtn');
  assert.deepEqual(await sourceTree(root),{...initial,[scene.sourcePath]:buildHash(Buffer.from(external))});assert.equal((await buildState()).job,null);assert.equal(report.svgRequests.length,0);assert.equal(report.errors.length,0);assert.equal(await evaluate('Boolean(window.__sceneSvgExecuted)'),false);
  report.steps.push('Ordinary Save detects a concurrent external recipe write and preserves both the reviewed local draft and exact external disk bytes. Original OC, projections, media, metadata and independent last-placement fixture stay untouched.');
  report.created={recipeId:scene.objectId,singleRecipeId:singleScene.objectId,projectionId:projection.objectId,unusedProjectionId:unusedProjection.objectId,instanceIds,groupIds,addedTarget,copiedAbsent,copiedZero,images:images.map(item=>item.id)};
  report.authorFiles={before:initial,after:await sourceTree(root)};await archiveCaptures('ordinary-external-save-conflict');report.captures=report.capturePhases.flatMap(phase=>phase.captures);report.normalSave={sourceSha256:buildHash(committed),onlyChangedFile:scene.sourcePath,externalConflictPreserved:true};
  for(const[name,digest]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,name))),digest,'Source changed during browser proof: '+name);
  report.sourceStableDuringProof=true;report.screenshotScope='Visible 390px form and identity-impact sections are captured in three languages. Complete source bytes, stable identity maps and actor/group provenance are asserted from real DOM and HTTP responses, beyond screenshot appearance.';report.ok=true;
} catch(error){report.ok=false;report.failure=error.stack||String(error);process.exitCode=1;try{await captureFailure?.();}catch(captureError){report.captureFailure=captureError.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}
 report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),json(report));console.log(JSON.stringify({ok:report.ok,steps:report.steps,limitations:report.limitations,failure:report.failure,output},null,2));}
