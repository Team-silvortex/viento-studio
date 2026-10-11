// Real browser shared organization group ADD/EDIT/ASSIGN/REMOVE → complete preview → guarded memory source → ordinary save in a disposable recipe.
// Run: VIENTO_COMPOSITION_GROUPS_OUTPUT=/empty/evidence/path node scripts/tests/scene-composition-groups-smoke.mjs [chromium]
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
const output = path.resolve(process.env.VIENTO_COMPOSITION_GROUPS_OUTPUT || path.join(os.tmpdir(), `viento-groups-evidence-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_COMPOSITION_GROUPS_OUTPUT directory; prior evidence is immutable.');
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], errors: [], svgRequests: [], limitations: [
  'Real HTTP editor and Chrome only; no installed Tauri window or Android device acceptance.',
  'One recipe shared organization group ADD/EDIT/ASSIGN/REMOVE only; no fragment or actor definition editing, executable recipe build or cross-file transaction.',
] };
const reviewedSources=['scripts/tests/scene-composition-groups-smoke.mjs','engine/scene-composition-groups.mjs','engine/studio-core.mjs','engine/studio-core.wasm',
  'crates/viento-studio-core/src/scene_composition_groups_patch.rs','web/modules/app-scene-composition-groups.js','engine/scene-authoring-candidate.mjs','engine/scene-authoring-workflow.mjs','web/modules/app-scene-authoring.js','web/modules/app-scene-preview.js','web/modules/app-project-build.js','web/modules/app-runtime.js','web/i18n/en.js','web/i18n/ja.js'];
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-groups-browser-'));
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
  const deep = structuredClone(declaration); deep.scene.title = 'Sixteen-level organization guard';
  deep.fragments = [deep.fragments[0]]; deep.fragments[0].groups = Array.from({length:16},(_,index)=>({key:'d'+index,name:'Depth '+index,...(index?{parentKey:'d'+(index-1)}:{})}));
  for(const actor of deep.fragments[0].actors)actor.groupKey='d15';
  for(const placement of deep.placements)placement.groupIds=Object.fromEntries(deep.fragments[0].groups.map(group=>[group.key,randomUUID()]));
  const deepSource=serialize(deep),deepScene=await create('object.create','documents/scenes/deep-groups.json',deepSource);
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
      if (window.__tamperNextPreview) { const fault=window.__tamperNextPreview; window.__tamperNextPreview=false; const data=body.data||body;
        if(fault==='name')data.sceneStructure.groups[0].name='Forged but valid group name';
        if(fault==='parent'){const group=data.sceneStructure.groups.find(item=>item.parentGroupId);delete group.parentGroupId;}
        if(fault==='member'){const member=data.sceneStructure.memberships[0];member.groupId=data.sceneStructure.groups.find(item=>item.groupId!==member.groupId).groupId;}
        return new Response(JSON.stringify(body),{status:response.status,headers:response.headers}); }
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

  await openPreview();await wait(async()=>(await latest())?.payload?.ok&&!(await modalBusy()),'saved recipe');
  const saved=(await latest()).payload;assert.equal(saved.actors.length,4);assert.equal(saved.sceneEditing,undefined);await readOnlyButtons();
  assert.equal(await evaluate("document.querySelector('#scenePreviewCompositionGroups').disabled"),true);
  await click('#scenePreviewSource');await wait(()=>evaluate("document.activeElement.id==='docSourceEditor'&&!document.querySelector('#projectBuildDialog').open"),'clean recipe source');
  await evaluate("window.__appState=(await import('/web/modules/app-state.js')).appState");
  const state=()=>evaluate('({dirty:window.__appState.editHasUnsavedChanges,base:window.__appState.activeEditSourceVersion})');
  const readScene=()=>fs.readFile(path.join(root,scene.sourcePath),'utf8');assert.equal((await state()).dirty,false);
  const el=suffix=>'#sceneCompositionGroups'+suffix,parsed=text=>JSON.parse(text.replace(/^\ufeff/,''));
  const rawSpan=(content,pointer)=>{const source=parseJsonSource(content);assert.equal(source.ok,true);const span=locateJsonSource(source,pointer);assert.ok(span,pointer);return content.slice(span.start,span.end);};
  const sourceWithoutOrganization=content=>{const value=parsed(content);for(const part of value.fragments){delete part.groups;for(const actor of part.actors)delete actor.groupKey;}for(const placement of value.placements)delete placement.groupIds;return value;};
  const assertOrganizationOnly=(before,after)=>{
    assert.deepEqual(sourceWithoutOrganization(after),sourceWithoutOrganization(before),'Only organizational declarations/mappings can change');
    assert.equal(rawSpan(after,'/scene'),rawSpan(before,'/scene'),'Scene header raw span');
    for(const[fi,part]of parsed(before).fragments.entries())for(const[ai,actor]of part.actors.entries())for(const field of Object.keys(actor).filter(k=>k!=='groupKey'))assert.equal(rawSpan(after,`/fragments/${fi}/actors/${ai}/${field}`),rawSpan(before,`/fragments/${fi}/actors/${ai}/${field}`),'Actor raw token '+field);
    for(const[pi,placement]of parsed(before).placements.entries())for(const field of Object.keys(placement).filter(k=>k!=='groupIds'))assert.equal(rawSpan(after,`/placements/${pi}/${field}`),rawSpan(before,`/placements/${pi}/${field}`),'Placement raw tokens '+field);
    assert.ok(after.startsWith('\uFEFF'));assert.ok(after.includes('\r\n'));
  };
  const verifyComplete=(content,payload)=>{
    const value=parsed(content),expectedGroups=[],expectedMemberships=[],expectedActors=[];
    for(const placement of value.placements){const part=value.fragments.find(f=>f.fragmentId===placement.fragmentId);
      for(const group of part.groups){const groupId=placement.groupIds[group.key];expectedGroups.push({groupId,name:group.name,...(Object.hasOwn(group,'parentKey')?{parentGroupId:placement.groupIds[group.parentKey]}:{})});const location=payload.sourceLocations.groups.find(item=>item.groupId===groupId);assert.ok(location);assert.deepEqual(location.composition,{fragmentId:part.fragmentId,placementId:placement.placementId,localKey:group.key});assert.equal(location.declaration.objectId,scene.objectId);assert.equal(location.declaration.sourcePath,scene.sourcePath);assert.equal(location.declaration.sourceRevision,payload.composition.sourceRevision);}
      for(const actor of part.actors){const instanceId=placement.actorIds[actor.key];expectedActors.push(instanceId);if(Object.hasOwn(actor,'groupKey'))expectedMemberships.push({instanceId,groupId:placement.groupIds[actor.groupKey]});const location=payload.sourceLocations.actors.find(item=>item.instanceId===instanceId);assert.ok(location);assert.equal(location.objectId,actor.objectId);assert.deepEqual(location.composition,{fragmentId:part.fragmentId,placementId:placement.placementId,localKey:actor.key});assert.equal(location.declaration.sourceRevision,payload.composition.sourceRevision);}
    }
    assert.deepEqual(payload.sceneStructure.groups,expectedGroups,'Every generated group name and parent declaration must exactly match source');assert.deepEqual(payload.sceneStructure.memberships,expectedMemberships,'Source-ordered complete actor memberships must match');assert.deepEqual(payload.actors.map(a=>a.instanceId),expectedActors);
    assert.deepEqual(payload.actors.map(a=>({instanceId:a.instanceId,objectId:a.objectId,position:a.position,size:a.size,color:a.color,speed:a.speed,controls:a.controls,imageResourceId:a.imageResourceId})),saved.actors.map(a=>({instanceId:a.instanceId,objectId:a.objectId,position:a.position,size:a.size,color:a.color,speed:a.speed,controls:a.controls,imageResourceId:a.imageResourceId})),'Organizational edits preserve all runtime geometry/attributes and actor order');
  };
  const openGroups=async()=>{await enabled('#scenePreviewCompositionGroups');await click('#scenePreviewCompositionGroups');await wait(()=>evaluate("document.querySelector('#sceneCompositionGroupsDialog')?.open&&!document.querySelector('#sceneCompositionGroupsFragment').disabled"),'source-bound organizational editor');};
  const choose=async(suffix,value)=>{await fill(el(suffix),value,'change');await delay(30);};
  const configureAdd=async({fragment='party',key='guests',name='Guests / 来客 / 来客 🦊',parent='party'}={})=>{await choose('Fragment',fragment);await enabled(el('Add'));await click(el('Add'));await fill(el('Key'),key);await fill(el('Name'),name);await choose('Parent',parent);};
  const configureEdit=async({fragment='party',group='guests',name='Guests renamed / 来客改名 / 来客名変更',parent='companions'}={})=>{await choose('Fragment',fragment);await choose('Group',group);await enabled(el('Edit'));await click(el('Edit'));await fill(el('Name'),name);await choose('Parent',parent);};
  const configureAssign=async({fragment='party',actor='companion',group='guests'}={})=>{await choose('Fragment',fragment);await choose('Actor',actor);await enabled(el('Assign'));await click(el('Assign'));await choose('Assignment',group);};
  const configureRemove=async(fragment='party',group='guests')=>{await choose('Fragment',fragment);await choose('Group',group);await enabled(el('Remove'));await click(el('Remove'));};
  const currentTargets=()=>evaluate("[...document.querySelector('#sceneCompositionGroupsTargets').children].filter(n=>n.dataset.placementId).map(row=>({placementId:row.dataset.placementId,fragmentId:row.dataset.fragmentId,groups:[...row.querySelectorAll('[data-group-key][data-group-id]')].map(g=>({groupKey:g.dataset.groupKey,groupId:g.dataset.groupId,parentGroupId:g.dataset.parentGroupId||null,text:g.textContent})),actors:[...row.querySelectorAll('[data-actor-key][data-instance-id]')].map(a=>({actorKey:a.dataset.actorKey,instanceId:a.dataset.instanceId,groupId:a.dataset.groupId||null,text:a.textContent}))}))");
  const allocations=()=>evaluate("[...document.querySelector('#sceneCompositionGroupsTargets').children].filter(n=>n.dataset.placementId).map(row=>({placementId:row.dataset.placementId,groupId:row.dataset.groupId||[...row.querySelectorAll('[data-group-key][data-group-id]')].find(group=>group.dataset.groupKey===document.querySelector('#sceneCompositionGroupsKey').value)?.dataset.groupId}))");
  const check=async()=>{await enabled(el('Check'));const count=await captureCount();await click(el('Check'));await enabled(el('Apply'));assert.ok(await captureCount()>count);return{content:await evaluate("document.querySelector('#sceneCompositionGroupsSource').textContent"),preview:(await latest()).payload};};
  const failedCheck=async(fault=null,{expectHttp=false}={})=>{const count=await captureCount();if(fault)await evaluate(`window.__tamperNextPreview=${JSON.stringify(fault)}`);await enabled(el('Check'));await click(el('Check'));await wait(()=>evaluate("document.querySelector('#sceneCompositionGroupsDialog').getAttribute('aria-busy')==='false'&&document.querySelector('#sceneCompositionGroupsApply').disabled&&document.querySelector('#sceneCompositionGroupsMessage').textContent.length>0"),'invalid candidate keeps raw input without approval');if(expectHttp){assert.ok(await captureCount()>count);const previewId=(await latest()).payload.previewId;await wait(()=>evaluate(`(window.__previewReleases||[]).some(url=>url.includes(${JSON.stringify('previewId=')}+${JSON.stringify(previewId)}))`),'refused temporary candidate released');}};
  const cancel=async()=>{await enabled(el('Cancel'));await click(el('Cancel'));await wait(()=>evaluate("!document.querySelector('#sceneCompositionGroupsDialog').open"),'cancel group operation');};
  const apply=async()=>{await enabled(el('Apply'));await click(el('Apply'));await wait(()=>evaluate("!document.querySelector('#sceneCompositionGroupsDialog').open&&!document.querySelector('#projectBuildDialog').open&&document.activeElement.id==='docSourceEditor'"),'group operation applied to ordinary source');};
  const save=async content=>{await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readScene()===content,'ordinary raw recipe Save');assert.equal((await state()).dirty,false);};
  const reopen=async id=>{await openPreview(id);return(await refreshSaved()).payload;};
  const sourceOpen=async()=>{await click('#scenePreviewSource');await wait(()=>evaluate("document.activeElement.id==='docSourceEditor'&&!document.querySelector('#projectBuildDialog').open"),'visible ordinary source');};
  const changedAuthorFiles=async()=>{const current=await sourceTree(root);assert.deepEqual(Object.keys(current),Object.keys(initial));return Object.keys(current).filter(key=>current[key]!==initial[key]);};
  const commit=async review=>{const before=committed;await apply();await assertDraftInput(review.content);assert.equal(await readScene(),before,'Apply does not write disk');assert.equal((await state()).dirty,true);await save(review.content);committed=review.content;assert.deepEqual(await changedAuthorFiles(),[scene.sourcePath]);verifyComplete(committed,await reopen());};
  let committed=originalSource;
  await reopen();await openGroups();assert.deepEqual(await evaluate("[...document.querySelector('#sceneCompositionGroupsFragment').options].map(n=>n.value)"),['party','unused']);await configureAdd();
  const allocated=await allocations(),newIds=allocated.map(row=>row.groupId);assert.equal(allocated.length,2);assert.deepEqual(allocated.map(row=>row.placementId),declaration.placements.map(p=>p.placementId));assert.equal(new Set(newIds).size,2);assert.ok(newIds.every(id=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)&&!instanceIds.includes(id)&&!groupIds.includes(id)&&!declaration.placements.some(p=>p.placementId===id)&&id!==scene.objectId));
  await fill(el('Name'),' ');await failedCheck();assert.equal(await evaluate("document.querySelector('#sceneCompositionGroupsName').value"),' ');assert.deepEqual(await allocations(),allocated);await fill(el('Name'),'Guests / 来客 / 来客 🦊');
  const added=await check();assertOrganizationOnly(committed,added.content);const expectedAdd=parsed(committed);expectedAdd.fragments[0].groups.push({key:'guests',name:'Guests / 来客 / 来客 🦊',parentKey:'party'});for(const[index,placement]of expectedAdd.placements.entries())placement.groupIds.guests=newIds[index];assert.deepEqual(parsed(added.content),expectedAdd);verifyComplete(added.content,added.preview);
  await cancel();assert.deepEqual(await sourceTree(root),initial);assert.equal(await readScene(),committed);
  report.steps.push('ADD supplies one fresh group UUID for each source-ordered placement, keeps identities through invalid-name correction, and reviews complete group/membership provenance; Cancel preserves every author file.');

  await openGroups();await configureAdd();const acceptedAllocation=await allocations(),acceptedIds=acceptedAllocation.map(row=>row.groupId);await fill(el('Key'),'guestsAlternate');await fill(el('Key'),'guests');await fill(el('Name'),'Temporary label');await fill(el('Name'),'Guests / 来客 / 来客 🦊');assert.deepEqual(await allocations(),acceptedAllocation);
  const acceptedAdd=await check();assertOrganizationOnly(committed,acceptedAdd.content);verifyComplete(acceptedAdd.content,acceptedAdd.preview);report.layout={};
  for(const language of ['zh-CN','en','ja']){await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await delay(160);await evaluate("document.querySelector('#sceneCompositionGroupsDialog').scrollTop=0");await delay(100);const metrics=await evaluate("(()=>{const d=document.querySelector('#sceneCompositionGroupsDialog'),f=d.querySelector('footer').getBoundingClientRect(),c=document.querySelector('#sceneCompositionGroupsCheck');return{noHorizontalOverflow:d.scrollWidth<=d.clientWidth+2,actionsVisible:f.top>=0&&f.bottom<=innerHeight+2,approved:!document.querySelector('#sceneCompositionGroupsApply').disabled,text:d.innerText,checkKey:c.dataset.i18n};})()");assert.ok(metrics.noHorizontalOverflow);assert.ok(metrics.actionsVisible);assert.ok(metrics.approved);assert.ok(metrics.text.includes(await evaluate(`(await import('/web/i18n/index.js')).t(${JSON.stringify(metrics.checkKey)})`)));assert.deepEqual(await allocations(),acceptedAllocation);report.layout[language]={noHorizontalOverflow:true,actionsVisible:true,approved:true};await screenshot(`groups-narrow-${language}.png`);await evaluate("document.querySelector('#sceneCompositionGroupsTargets').scrollIntoView({block:'center'})");await delay(100);await screenshot(`groups-impact-${language}.png`);}
  await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");await call('Emulation.clearDeviceMetricsOverride');await delay(100);await screenshot('groups-reviewed.png');await evaluate("document.querySelector('#sceneCompositionGroupsName').value='Unreviewed name'");await click(el('Apply'));assert.equal(await evaluate("document.querySelector('#sceneCompositionGroupsDialog').open&&document.querySelector('#sceneCompositionGroupsApply').disabled"),true);await fill(el('Name'),'Guests / 来客 / 来客 🦊');const finalAdd=await check();await commit(finalAdd);
  report.steps.push('ADD preserves allocation across key/name input, checks and three 390px languages. Silent unreviewed text cannot apply; guarded Apply updates memory only and ordinary Save/reopen retains exact BOM/CRLF and both stable group mappings.');

  await openGroups();await configureEdit();const edited=await check();assertOrganizationOnly(committed,edited.content);const expectedEdit=parsed(committed);Object.assign(expectedEdit.fragments[0].groups.find(g=>g.key==='guests'),{name:'Guests renamed / 来客改名 / 来客名変更',parentKey:'companions'});assert.deepEqual(parsed(edited.content),expectedEdit);verifyComplete(edited.content,edited.preview);assert.deepEqual(parsed(edited.content).placements.map(p=>p.groupIds.guests),acceptedIds);await commit(edited);
  report.steps.push('EDIT changes the shared raw name and parent across every placement while retaining all group/actor UUIDs, source order, geometry, projections, images, local overrides and offset lexemes.');
  await openGroups();await configureAssign();const assigned=await check();assertOrganizationOnly(committed,assigned.content);const expectedAssign=parsed(committed);expectedAssign.fragments[0].actors.find(a=>a.key==='companion').groupKey='guests';assert.deepEqual(parsed(assigned.content),expectedAssign);verifyComplete(assigned.content,assigned.preview);await commit(assigned);
  await openGroups();await choose('Group','guests');assert.equal(await evaluate("document.querySelector('#sceneCompositionGroupsRemove').disabled"),true);await click(el('Remove'));assert.equal(await evaluate("document.querySelector('#sceneCompositionGroupsCheck').disabled"),true);await choose('Group','party');assert.equal(await evaluate("document.querySelector('#sceneCompositionGroupsRemove').disabled"),true);await cancel();assert.equal(await readScene(),committed);
  await openGroups();await configureAssign({group:''});const rooted=await check();assertOrganizationOnly(committed,rooted.content);const expectedRoot=parsed(committed);delete expectedRoot.fragments[0].actors.find(a=>a.key==='companion').groupKey;assert.deepEqual(parsed(rooted.content),expectedRoot);verifyComplete(rooted.content,rooted.preview);await commit(rooted);
  await openGroups();await configureRemove();const removed=await check();assertOrganizationOnly(committed,removed.content);const expectedRemove=parsed(committed);expectedRemove.fragments[0].groups=expectedRemove.fragments[0].groups.filter(g=>g.key!=='guests');for(const placement of expectedRemove.placements)delete placement.groupIds.guests;assert.deepEqual(parsed(removed.content),expectedRemove);verifyComplete(removed.content,removed.preview);await commit(removed);
  report.steps.push('ASSIGN moves the shared actor into the new mapped group and then to the root by removing groupKey. Nonempty or parent groups cannot be removed; once empty, leaf REMOVE deletes the declaration and every placement map without implicit promotion or identity/geometry changes.');

  await openGroups();await configureEdit({group:'party',name:'Cycle attempt',parent:'companions'});await failedCheck();assert.equal(await evaluate("document.querySelector('#sceneCompositionGroupsName').value"),'Cycle attempt');assert.equal(await evaluate("document.querySelector('#sceneCompositionGroupsParent').value"),'companions');assert.equal(await readScene(),committed);await evaluate("(()=>{const option=document.createElement('option');option.value='unknownRoot';option.textContent='Unknown fixture parent';document.querySelector('#sceneCompositionGroupsParent').append(option);})()");await choose('Parent','unknownRoot');await failedCheck();assert.equal(await evaluate("document.querySelector('#sceneCompositionGroupsParent').value"),'unknownRoot');assert.equal(await readScene(),committed);await cancel();
  await closePreview();await openPreview(deepScene.objectId);await refreshSaved();await sourceOpen();await openPreview(deepScene.objectId);await refreshSaved();await openGroups();await configureAdd({key:'depth17',name:'Depth seventeen',parent:'d15'});const deepAllocation=await allocations();await failedCheck();assert.equal(await evaluate("document.querySelector('#sceneCompositionGroupsParent').value"),'d15');assert.deepEqual(await allocations(),deepAllocation);await cancel();assert.equal(await fs.readFile(path.join(root,deepScene.sourcePath),'utf8'),deepSource);await closePreview();await openPreview();await refreshSaved();await sourceOpen();await reopen();
  report.steps.push('A cyclic reparent, a deliberately injected unknown parent option and a seventeenth-level group are rejected atomically. Authored labels/parent values and allocated IDs stay available for correction; the separate sixteen-level source fixture is byte-identical.');

  await openGroups();await choose('Fragment','unused');assert.equal(await evaluate("document.querySelector('#sceneCompositionGroupsRemove').disabled"),true,'Unused actors still count as raw members');await configureAssign({fragment:'unused',actor:'newcomer',group:''});const unusedRoot=await check();assert.deepEqual(await currentTargets(),[]);assertOrganizationOnly(committed,unusedRoot.content);verifyComplete(unusedRoot.content,unusedRoot.preview);await commit(unusedRoot);
  await openGroups();await configureRemove('unused','solo');const unusedLast=await check();assert.deepEqual(await currentTargets(),[]);assert.deepEqual(parsed(unusedLast.content).fragments[1].groups,[]);assert.equal(Object.hasOwn(parsed(unusedLast.content).fragments[1].actors[0],'groupKey'),false);verifyComplete(unusedLast.content,unusedLast.preview);await commit(unusedLast);
  await openGroups();await configureAdd({fragment:'unused',key:'reserveRoot',name:'Reserve / 未放置 / 未配置',parent:''});const unusedAdd=await check();assert.deepEqual(await currentTargets(),[]);assert.deepEqual(parsed(unusedAdd.content).fragments[1].groups,[{key:'reserveRoot',name:'Reserve / 未放置 / 未配置'}]);verifyComplete(unusedAdd.content,unusedAdd.preview);await commit(unusedAdd);
  await openGroups();await configureEdit({fragment:'unused',group:'reserveRoot',name:'Reserve edited',parent:''});const unusedEdit=await check();assert.deepEqual(await currentTargets(),[]);verifyComplete(unusedEdit.content,unusedEdit.preview);await commit(unusedEdit);
  await openGroups();await configureRemove('unused','reserveRoot');const unusedRemove=await check();assert.deepEqual(parsed(unusedRemove.content).fragments[1].groups,[]);verifyComplete(unusedRemove.content,unusedRemove.preview);await commit(unusedRemove);
  report.steps.push('Unused fragments use source declarations to guard occupied groups, support all four actions with empty generated target lists, and may remove their last empty group while retaining groups:[]; their changes do not invent effective instances.');

  await openGroups();await configureEdit({group:'party',name:'Receipt checked',parent:''});for(const fault of ['name','parent','member']){await failedCheck(fault,{expectHttp:true});assert.equal((await latest()).payload.ok,true);assert.equal(await evaluate("document.querySelector('#sceneCompositionGroupsName').value"),'Receipt checked');assert.equal(await readScene(),committed);}const recovered=await check();verifyComplete(recovered.content,recovered.preview);await cancel();
  report.steps.push('Real valid HTTP candidates with unchanged identities but deliberately forged group name, parent or actor membership cannot approve. Each bad temporary receipt is released and the untouched raw intent can be rechecked successfully.');
  await openGroups();await configureEdit({group:'party',name:'Late checked',parent:''});const releasedBefore=await evaluate('(window.__previewReleases||[]).length');await evaluate('window.__holdNextPreview=true');await click(el('Check'));await wait(()=>evaluate('window.__heldPreview===true'),'real group candidate held after HTTP completion');await evaluate("document.querySelector('#sceneCompositionGroupsDialog').close()");await closePreview();const staleDraft=committed.replace('Two parties','Local source owner changed');await fill('#docSourceEditor',staleDraft);assert.equal((await state()).dirty,true);await evaluate('window.__releasePreview()');await wait(async()=>await evaluate('(window.__previewReleases||[]).length')>releasedBefore,'late group preview released');await assertDraftInput(staleDraft);assert.equal(await readScene(),committed);assert.equal(await evaluate("document.querySelector('#sceneCompositionGroupsDialog').open"),false);await fill('#docSourceEditor',committed);assert.equal((await state()).dirty,false);
  report.steps.push('A held real candidate arriving after the child/parent close and an actual visible source edit never replaces the new draft, reopens its view or grants stale approval; its host preview is released.');
  await archiveCaptures('ordinary-group-authoring');report.capabilityPhases=[];
  for(const mode of ['absent','unsupported']){const source=`(()=>{const original=WebAssembly.instantiate.bind(WebAssembly);WebAssembly.instantiate=async(...args)=>{const result=await original(...args);if(result?.instance?.exports?.viento_core_scene_composition_groups_version){const exports={...result.instance.exports};${mode==='absent'?'delete exports.viento_core_scene_composition_groups_version;':'exports.viento_core_scene_composition_groups_version=()=>2;'}return{module:result.module,instance:{exports}};}return result;};})()`;const injection=await call('Page.addScriptToEvaluateOnNewDocument',{source});await call('Page.navigate',{url:`${base}/web/?mode=edit`});await wait(()=>evaluate("document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable&&document.querySelector('#projectBuildBtn')?.hidden===false"),'group capability fault editor boot');await instrumentFetch();await evaluate("window.__appState=(await import('/web/modules/app-state.js')).appState");await openPreview();await refreshSaved();await sourceOpen();await reopen();assert.equal(await evaluate("document.querySelector('#scenePreviewCompositionGroups').disabled&&!document.querySelector('#scenePreviewCompositionGroups').hidden"),true);await click('#scenePreviewCompositionGroups');assert.equal(await evaluate("document.querySelector('#sceneCompositionGroupsDialog')?.open||false"),false);
    await click(`#scenePreviewObjects button[data-actor-id="${instanceIds[0]}"]`);const oldEntries=[['scenePreviewCompositionOverride','sceneCompositionOverrides'],['scenePreviewCompositionLayout','sceneCompositionLayout'],['scenePreviewCompositionBatchLayout','sceneCompositionBatchLayout'],['scenePreviewCompositionFragment','sceneCompositionFragments'],['scenePreviewCompositionPlacement','sceneCompositionPlacement'],['scenePreviewCompositionStructure','sceneCompositionStructure'],['scenePreviewCompositionPlacements','sceneCompositionPlacements']];for(const[button,prefix]of oldEntries){await enabled('#'+button);await click('#'+button);await wait(()=>evaluate(`document.querySelector('#${prefix}Dialog')?.open`),'old editor '+prefix);await enabled('#'+prefix+'Cancel');await click('#'+prefix+'Cancel');await wait(()=>evaluate(`!document.querySelector('#${prefix}Dialog').open`),'old editor cancellation');}assert.equal(await readScene(),committed);await closePreview();await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier});report.capabilityPhases.push({mode,newEntryDisabled:true,oldEditorsOpenedAndCanceled:oldEntries.map(v=>v[0])});await archiveCaptures('group-capability-'+mode);
  }
  report.steps.push('When only the new groups ABI is absent or unsupported, its entry closes independently and all seven previous recipe editors still open/cancel through real current helpers without author or backend build writes.');
  await call('Page.navigate',{url:`${base}/web/?mode=edit`});await wait(()=>evaluate("document.readyState==='complete'&&(await import('/web/modules/app-state.js')).appState.editBackendAvailable&&document.querySelector('#projectBuildBtn')?.hidden===false"),'final ordinary editor boot');await instrumentFetch();await evaluate("window.__appState=(await import('/web/modules/app-state.js')).appState");await openPreview();await refreshSaved();await sourceOpen();await reopen();await openGroups();await configureEdit({group:'party',name:'Unsaved against external',parent:''});const finalCandidate=await check();const external=committed.replace('Two parties','External group source edit');await fs.writeFile(path.join(root,scene.sourcePath),external);await apply();await assertDraftInput(finalCandidate.content);await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(()=>evaluate("!document.querySelector('#docSaveConflictDialog').classList.contains('is-hidden')"),'ordinary Save concurrent source conflict');assert.equal(await readScene(),external);await assertDraftInput(finalCandidate.content);await click('#docSaveConflictCancelBtn');assert.deepEqual(await sourceTree(root),{...initial,[scene.sourcePath]:buildHash(Buffer.from(external))});assert.equal((await buildState()).job,null);assert.equal(report.svgRequests.length,0);assert.equal(report.errors.length,0);assert.equal(await evaluate('Boolean(window.__sceneSvgExecuted)'),false);
  report.steps.push('Ordinary Save detects an external recipe write and retains both reviewed local draft and disk bytes. Original OC, projections, images, metadata and deep-depth fixture remain unchanged; organizational editing never starts a backend build.');
  report.faultInjections=['One out-of-catalog parent option is deliberately added to the DOM select to test refusal of an invalid raw parent intent.', 'Only the three real HTTP candidate deliveries named name/parent/member are modified after untouched responses are captured.','A real preview response is held while its child is forcibly closed, parent preview closed and an actual visible source edit advances ownership.','Capability phases wrap only the new groups WASM capability export at boot; all other exports/controllers/HTTP remain real.'];
  report.created={recipeId:scene.objectId,deepRecipeId:deepScene.objectId,projectionId:projection.objectId,unusedProjectionId:unusedProjection.objectId,originalInstanceIds:instanceIds,originalGroupIds:groupIds,addedGroupIds:acceptedIds,images:images.map(i=>i.id)};report.authorFiles={before:initial,after:await sourceTree(root)};await archiveCaptures('ordinary-group-save-conflict');report.captures=report.capturePhases.flatMap(p=>p.captures);report.normalSave={sourceSha256:buildHash(committed),onlyChangedFile:scene.sourcePath,externalConflictPreserved:true};for(const[name,digest]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,name))),digest,'Source changed during browser proof: '+name);report.sourceStableDuringProof=true;report.screenshotScope='Seven visible form/impact screenshots are viewport samples. Complete source, actor/group identities, labels, parent declarations and ordered memberships are checked from actual DOM and HTTP beyond screenshots.';report.ok=true;
} catch(error){report.ok=false;report.failure=error.stack||String(error);process.exitCode=1;try{await captureFailure?.();}catch(captureError){report.captureFailure=captureError.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}
 report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),json(report));console.log(JSON.stringify({ok:report.ok,steps:report.steps,limitations:report.limitations,failure:report.failure,output},null,2));}
