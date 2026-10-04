// Real browser Scene2D source draft → layout → source draft → normal save through real HTTP and Chrome.
// Run: VIENTO_SCENE_SOURCE_LAYOUT_OUTPUT=/empty/evidence/path node scripts/tests/scene-source-layout-smoke.mjs [chromium]
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import strictAssert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { buildHash, captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { registerWorkspace } from '../lib/workspace.mjs';
import { importMediaAsset } from '../lib/media-assets.mjs';
import { getProjectionTemplates, lockProjectionTemplate } from '../../engine/object-projection.mjs';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';

let assertionCount = 0;
const assert = new Proxy(strictAssert, { get(target, key) { const value = Reflect.get(target, key); return typeof value === 'function' ? (...args) => { assertionCount++; return Reflect.apply(value, target, args); } : value; } });

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.env.VIENTO_SCENE_SOURCE_LAYOUT_OUTPUT || path.join(os.tmpdir(), `viento-scene-source-layout-evidence-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_SCENE_SOURCE_LAYOUT_OUTPUT directory; prior evidence is immutable.');
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], errors: [], svgRequests: [], limitations: [
  'HTTP editor and real Chrome canvas only; packaged Tauri IPC and Android were not exercised.',
  'This checks source-draft layout editing and normal editor save in isolated fixtures. No engine process, native IPC or device acceptance is claimed.',
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-source-layout-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'workspace'), template = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank');
  const write = async (relative, content) => { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); };
  for (const name of ['documents', 'templates', 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(root, name), { recursive: true });
  await write('workspace.json', json({ format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Scene source layout smoke', createdAt: 0,
    ...WORKSPACE_LAYOUT, documentTypes: template.documentTypes }));
  for (const [name, content] of Object.entries(template.templates)) await write(`templates/${name}`, content);
  await registerWorkspace(root);
  const execute = createWorldCommandService(root);
  const create = async (command, sourcePath, content) => {
    const view = await readWorldProjection(root), request = { command, mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
      actorRef: { kind: 'tool', id: 'scene-source-layout-smoke' }, objectId: randomUUID(), documentType: 'document', sourcePath, content };
    await execute(request); return request;
  };
  const core = await create('object.create', 'documents/core.md', '\uFEFF# Traveler / 旅人\r\n\r\n故事属于原 OC。  \r\n');
  const images = [];
  for (const color of ['#44aaee', '#ee6644']) {
    const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><script>fetch('http://127.0.0.1:9/viento-preview-script');top.__sceneSvgExecuted=true;</script><image href="http://127.0.0.1:9/viento-preview-external.png" width="1" height="1"/><rect width="32" height="32" fill="${color}"/></svg>`);
    const imported = await importMediaAsset(root, Readable.from([bytes]), `${color.slice(1)}.svg`); images.push(imported.asset);
  }
  const variants = [];
  for (const [index, suffix] of ['rpg-player', 'rpg-npc'].entries()) {
    const selected = getProjectionTemplates().find(item => item.id.endsWith(`.${suffix}`));
    const projectionDeclaration = { format: 'viento-object-projection', schemaVersion: 1, title: index ? 'Traveler · NPC' : 'Traveler · Player', sourceObjectId: core.objectId,
      template: await lockProjectionTemplate(selected, { digest: buildHash }),
      configuration: { ...Object.fromEntries(selected.fields.map(field => [field.id, field.default])), image: images[0].id, speed: index ? 0 : 180 } };
    variants.push(await create('projection.create', `documents/projections/${suffix}.json`, json(projectionDeclaration)));
  }
  const groupIds = [randomUUID(), randomUUID()], instanceIds = [randomUUID(), randomUUID(), randomUUID()];
  const declaration = { format: 'viento-scene2d', schemaVersion: 3, title: 'A · text draft preview', viewport: [640, 480], background: '#101827',
    groups: [{ groupId: groupIds[0], name: '原文 Town😀' }, { groupId: groupIds[1], name: '居民 Residents', parentGroupId: groupIds[0] }], actors: [
      { instanceId: instanceIds[0], objectId: variants[0].objectId, groupId: groupIds[0], position: [160, 200], useProjectionDefaults: true },
      { instanceId: instanceIds[1], objectId: variants[0].objectId, groupId: groupIds[1], position: [380, 200], useProjectionDefaults: true, size: [120, 60], imageResourceId: images[1].id },
      { instanceId: instanceIds[2], objectId: variants[1].objectId, position: [520, 350], useProjectionDefaults: true },
    ] };
  const serialize = value => '\uFEFF' + json(value).replaceAll('\n', '\r\n');
  const originalSource = serialize(declaration)
    .replace(/("viewport": \[\r\n\s*)640,/, (_, prefix) => prefix + '6.40e2,')
    .replace(/("position": \[\r\n\s*)160,(\r\n\s*)200/, (_, prefix, separator) => prefix + '1.60e2,' + separator + '2.000e2')
    .replace(/("position": \[\r\n\s*)520,/, (_, prefix) => prefix + '5.20e2,');
  const scene = await create('scene.create', 'documents/scenes/a.json', originalSource);
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root, XDG_CACHE_HOME: path.join(temporary, 'cache') };
  delete env.VIENTO_GODOT_BIN; delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
  const initial = await sourceTree(root), savedBuild = await captureBuildSnapshot(root, scene.objectId), base = await serve(t, appRoot, env);
  const buildState = async () => { const response = await fetch(`${base}/api/project-build`); assert.equal(response.status, 200); const body = await response.json(); return body.data || body; };
  assert.equal((await buildState()).available, false); assert.equal((await buildState()).job, null);
  const profile = path.join(temporary, 'chrome'); await fs.mkdir(profile);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; } });
  let port;
  await wait(async () => { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return !!port; } catch { return false; } }, 'Chrome');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const pending = new Map(); let sequence = 0, confirmAccept = false;
  socket.addEventListener('message', event => { const value = JSON.parse(event.data); if (value.id) {
    const request = pending.get(value.id); pending.delete(value.id); value.error ? request?.reject(new Error(value.error.message)) : request?.resolve(value.result);
  } else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
    else if (value.method === 'Page.javascriptDialogOpening') { report.confirmations ||= []; report.confirmations.push(value.params.message); void call('Page.handleJavaScriptDialog', { accept: confirmAccept }); }
    else if (value.method === 'Network.requestWillBeSent' && value.params.request.url.includes('127.0.0.1:9/viento-preview-')) report.svgRequests.push(value.params.request.url); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value, event = 'input') => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (input.id === 'docSourceEditor') { if (document.querySelector('#projectBuildDialog').open || document.querySelector('#sceneLayoutDialog').open || input.disabled || !input.checkVisibility()) throw new Error('Source editor must be visible and interactive'); input.focus(); } input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === false && !document.querySelector(${JSON.stringify(selector)}).hidden`), `${selector} enabled`);
  const screenshot = async name => { const value = await call('Page.captureScreenshot', { format: 'png' }), bytes = Buffer.from(value.data, 'base64'); await fs.writeFile(path.join(output, name), bytes); (report.screenshots ||= []).push({path:name,bytes:bytes.length,sha256:buildHash(bytes)}); };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({ text: document.body.innerText, captures: window.__sceneCaptures, editor: document.querySelector('#docSourceEditor')?.value, state: (await import('/web/modules/app-state.js')).appState })`); report.serviceFailure = await buildState(); };
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable && document.querySelector('#projectBuildBtn')?.hidden === false`), 'preview-capable editor');
  await evaluate(`(() => { const original = window.fetch.bind(window); window.__sceneCaptures = []; window.__writeRequests = []; window.fetch = async (input, init) => {
    const response = await original(input, init); const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/scene-preview') && init?.method === 'POST') {
      const body = await response.clone().json(); window.__sceneCaptures.push({ request: JSON.parse(init.body), status: response.status, payload: body.data || body });
    } if (init?.method && !['GET','HEAD'].includes(init.method.toUpperCase())) window.__writeRequests.push({url,method:init.method,status:response.status}); return response;
  }; })()`);
  const latest = () => evaluate('window.__sceneCaptures.at(-1)');
  const captureCount = () => evaluate('window.__sceneCaptures.length');
  const editorText = () => evaluate("document.querySelector('#docSourceEditor').value");
  const modalBusy = () => evaluate("document.querySelector('#projectBuildPreviewPanel').getAttribute('aria-busy') === 'true'");
  const waitCapture = async count => { await wait(async () => await captureCount() > count && !(await modalBusy()), 'preview response and images complete'); return latest(); };
  const refreshDraft = async () => { await enabled('#scenePreviewDraftRefresh'); const count = await captureCount(); await click('#scenePreviewDraftRefresh'); return waitCapture(count); };
  const refreshSaved = async () => { await enabled('#scenePreviewRefresh'); const count = await captureCount(); await click('#scenePreviewRefresh'); return waitCapture(count); };
  const openPreview = async () => { await click('#projectBuildBtn'); await enabled('#projectBuildScene'); await fill('#projectBuildScene', scene.objectId, 'change'); await click('#projectBuildTabPreview');
    await wait(() => evaluate("document.querySelector('#projectBuildDialog').open && !document.querySelector('#projectBuildPreviewPanel').hidden"), 'preview panel'); await enabled('#scenePreviewRefresh'); };
  const closePreview = async () => { await click('#projectBuildClose'); await wait(() => evaluate("!document.querySelector('#projectBuildDialog').open"), 'return editor'); };

  const editorState = () => evaluate("(() => { const s = (window.__appState); return {dirty:s.editHasUnsavedChanges,baseVersion:s.activeEditSourceVersion,path:s.activeEditSource}; })()");
  await evaluate("window.__appState = (await import('/web/modules/app-state.js')).appState");
  const assertText = async source => assert.equal(await editorText(), source.replace(/\r\n|\r/g, '\n'), 'visible draft preserves Unicode/BOM and textarea newline conversion');
  const readScene = () => fs.readFile(path.join(root, scene.sourcePath), 'utf8');
  const savedUnchanged = async () => {
    assert.deepEqual(await sourceTree(root), initial, 'no author files changed');
    assert.equal((await captureBuildSnapshot(root, scene.objectId)).snapshotId, savedBuild.snapshotId, 'saved build snapshot unchanged');
    assert.equal((await buildState()).job, null);
    const writes = await evaluate('window.__writeRequests');
    assert.deepEqual(writes.filter(item => item.url.includes('/api/world/commands') || /\/api\/doc(?:\?|$)/.test(item.url)), [], 'layout never invokes world or document write endpoints');
  };
  const openLayout = async () => {
    await enabled('#scenePreviewDraftLayoutEdit'); await click('#scenePreviewDraftLayoutEdit');
    await wait(() => evaluate("document.querySelector('#sceneLayoutDialog').open && document.querySelector('#sceneLayoutDialog').getAttribute('aria-busy') !== 'true'"), 'source layout dialog');
    await enabled('#sceneLayoutX');
    assert.equal(await evaluate("document.querySelector('#sceneLayoutReload').hidden"), true, 'source mode cannot reload saved scene over text draft');
  };
  const checkedLayout = async () => {
    await enabled('#sceneLayoutCheck'); await click('#sceneLayoutCheck'); await enabled('#sceneLayoutSave');
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await evaluate("document.querySelector('#sceneLayoutSource').scrollIntoView({block:'center'})");
    const metrics=await evaluate("(() => {const pre=document.querySelector('#sceneLayoutSource'),rect=pre.getBoundingClientRect(),css=getComputedStyle(pre);return {rect:{top:rect.top,left:rect.left,width:rect.width,height:rect.height},clientHeight:pre.clientHeight,scrollHeight:pre.scrollHeight,overflowY:css.overflowY,display:css.display,visibility:css.visibility,open:document.querySelector('#sceneLayoutReview').open};})()");
    assert.ok(metrics.open && metrics.clientHeight>=100 && metrics.rect.width>=200,'review source has a readable visible area');
    assert.ok(metrics.scrollHeight>metrics.clientHeight && ['auto','scroll'].includes(metrics.overflowY),'complete source remains scrollable');
    (report.reviewMetrics ||= []).push(metrics);
    const text = await evaluate("document.querySelector('#sceneLayoutSource').textContent");
    return { text, value: JSON.parse(text.replace(/^\uFEFF/, '')) };
  };
  const selectedIds = () => evaluate("Array.from(document.querySelectorAll('#sceneLayoutObjects input[data-actor-id]')).filter(input=>input.checked).map(input=>input.dataset.actorId).sort()");
  const coordinates = () => evaluate("['sceneLayoutX','sceneLayoutY'].map(id=>Number(document.getElementById(id).value))");
  const drag = async (position, dx, dy) => {
    await evaluate("document.querySelector('#sceneLayoutCanvas').scrollIntoView({block:'center'})");
    const point = await evaluate(`(async () => { const canvas=document.querySelector('#sceneLayoutCanvas'), b=canvas.getBoundingClientRect();
      const {fitSceneView,sceneToCanvas}=await import('/web/modules/app-scene-preview-canvas.js');
      const [x,y]=sceneToCanvas(fitSceneView([640,480],b.width,b.height),...${JSON.stringify(position)}); return {x:b.left+x,y:b.top+y}; })()`);
    await call('Input.dispatchMouseEvent', {type:'mouseMoved', ...point});
    await call('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});
    await call('Input.dispatchMouseEvent', {type:'mouseMoved',button:'left',buttons:1,x:point.x+dx/2,y:point.y+dy/2});
    await call('Input.dispatchMouseEvent', {type:'mouseMoved',button:'left',buttons:1,x:point.x+dx,y:point.y+dy});
    await call('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:point.x+dx,y:point.y+dy});
  };
  // Independent expected patch: replace only changed coordinate number tokens,
  // preserving every byte around them (BOM, CRLF, indentation and exponent spelling).
  const replacePositionTokens = (source, positions) => {
    let index = 0;
    const number = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;
    const token = (sourceToken, value) => Number(sourceToken.trim()) === value ? sourceToken : sourceToken.replace(number, String(value));
    const result = source.replace(/("position"\s*:\s*\[)([^,\]]+)(,)([^\]]+)(\])/g, (_,head,x,comma,y,tail) => {
      const position=positions[index++]; return head+token(x,position[0])+comma+token(y,position[1])+tail;
    });
    assert.equal(index, positions.length); return result;
  };
  const cancelLayout = async () => { confirmAccept=true; await click('#sceneLayoutCancel'); await wait(()=>evaluate("!document.querySelector('#sceneLayoutDialog').open"),'cancel layout'); confirmAccept=false; };
  const applyLayout = async expected => {
    const count=await captureCount(); await click('#sceneLayoutSave');
    await wait(()=>evaluate("!document.querySelector('#sceneLayoutDialog').open"),'layout applied to text');
    const result=await waitCapture(count); assert.equal(result.payload.ok,true); assert.equal(result.request.draft.content,expected);
    await assertText(expected); return result;
  };
  await openPreview(); await wait(async()=>(await latest())?.payload?.ok && !(await modalBusy()),'initial saved capture');
  await click('#scenePreviewSource'); await wait(()=>evaluate("document.activeElement.id==='docSourceEditor' && !document.querySelector('#projectBuildDialog').open"),'visible source');
  const draftSource=originalSource.replace('A · text draft preview','Draft · layout / 草稿').replace('原文 Town😀','草稿の町 Draft town😀');
  await fill('#docSourceEditor',draftSource); assert.equal((await editorState()).dirty,true); const originalEditorState=await editorState();
  await openPreview(); const draft=await refreshDraft(); assert.equal(draft.request.draft.content,draftSource);
  assert.deepEqual(draft.payload.actors.map(actor=>actor.position),declaration.actors.map(actor=>actor.position));
  assert.equal(draft.payload.actors[0].objectId,draft.payload.actors[1].objectId,'separate instances share one definition');
  await openLayout(); await click(`#sceneLayoutObjects button[data-group-id="${groupIds[0]}"]`);
  assert.deepEqual(await selectedIds(),instanceIds.slice(0,2).sort());
  await drag([160,200],36,24); const moved=await checkedLayout();
  const positions=moved.value.actors.map(actor=>actor.position),delta=positions[0].map((v,i)=>v-declaration.actors[0].position[i]);
  assert.ok(delta.every(v=>v>0),'real pointer moves selected descendants');
  for(const axis of [0,1])assert.ok(Math.abs(positions[1][axis]-declaration.actors[1].position[axis]-delta[axis])<1e-8);
  assert.deepEqual(moved.value.actors[2],declaration.actors[2]); assert.deepEqual(moved.value.groups,JSON.parse(draftSource.slice(1)).groups);
  assert.equal(moved.text,replacePositionTokens(draftSource,positions),'review is exact coordinate-token patch');
  await assertText(draftSource); await savedUnchanged();
  await click('#sceneLayoutUndo'); assert.equal(await evaluate("document.querySelector('#sceneLayoutDialog').dataset.dirty"),'false');
  for(const [index,id] of instanceIds.entries()) { await click(`#sceneLayoutObjects button[data-actor-id="${id}"]`); assert.deepEqual(await coordinates(),declaration.actors[index].position); }
  await click('#sceneLayoutRedo'); assert.equal((await checkedLayout()).text,moved.text);
  await click(`#sceneLayoutObjects button[data-actor-id="${instanceIds[0]}"]`);
  await fill('#sceneLayoutX','242.5','change');
  assert.equal(await evaluate("document.querySelector('#sceneLayoutSave').disabled && document.querySelector('#sceneLayoutReview').hidden"),true,'new coordinates invalidate approval');
  const candidate=await checkedLayout(); assert.equal(candidate.value.actors[0].position[0],242.5);
  assert.equal(candidate.text,replacePositionTokens(draftSource,candidate.value.actors.map(actor=>actor.position)));
  await screenshot('source-layout-review-zh.png'); await cancelLayout(); await assertText(draftSource); await savedUnchanged();
  report.steps.push('A v3 dirty text draft with nested groups and two instances of one definition enters layout. Real pointer dragging moves only parent descendants, Undo/Redo is one operation, coordinate edits invalidate review, and candidate JSON patches only position number tokens. Cancel leaves the exact text draft and all saved files/snapshots unchanged.');

  await openLayout(); await click(`#sceneLayoutObjects button[data-group-id="${groupIds[0]}"]`); await drag([160,200],36,24);
  await click(`#sceneLayoutObjects button[data-actor-id="${instanceIds[0]}"]`); await fill('#sceneLayoutX','242.5','change');
  const toApply=await checkedLayout(); assert.equal(toApply.text,replacePositionTokens(draftSource,toApply.value.actors.map(actor=>actor.position)));
  for(const language of ['en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('${language}')`);
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await evaluate("document.querySelector('#sceneLayoutSave').scrollIntoView({block:'center'})");
    assert.equal(await evaluate("document.querySelector('#sceneLayoutDialog').scrollWidth <= document.querySelector('#sceneLayoutDialog').clientWidth"),true,'source layout fits390px');
    assert.equal(await evaluate("document.querySelector('#sceneLayoutSource').textContent"),toApply.text,'locale preserves approved bytes');
    assert.equal(await evaluate("document.querySelector('#sceneLayoutSave').disabled"),false);
    await screenshot(`source-layout-narrow-${language}.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')");
  const applied=await applyLayout(toApply.text);
  assert.deepEqual(applied.payload.actors.map(actor=>actor.position),toApply.value.actors.map(actor=>actor.position));
  assert.deepEqual(await editorState(),originalEditorState,'apply retains the same dirty editor and saved baseline');
  await savedUnchanged(); await screenshot('source-layout-applied-preview-zh.png');
  report.steps.push('English/Japanese at390px retain the approved source patch. Applying layout closes the modal, replaces only the main in-memory text draft, and refreshes its canvas. The editor remains dirty against the original baseline; no document/world write endpoint is called, and saved build capture stays identical.');

  await openLayout(); await click(`#sceneLayoutObjects button[data-actor-id="${instanceIds[0]}"]`); await fill('#sceneLayoutX','300','change'); await checkedLayout();
  const newerSource=toApply.text.replace('Draft · layout / 草稿','Newer concurrent text / 新正文');
  // Dedicated race probe, deliberately unlike normal typing: inject a competing
  // editor input while its textarea is behind a modal, after layout approval.
  await evaluate(`(() => { const input=document.querySelector('#docSourceEditor'); input.value=${JSON.stringify(newerSource)}; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await click('#sceneLayoutSave');
  await wait(()=>evaluate("document.querySelector('#sceneLayoutDialog').open && document.querySelector('#sceneLayoutDialog').getAttribute('aria-busy')!=='true' && document.querySelector('#sceneLayoutSave').disabled"),'newer text rejects stale apply');
  await assertText(newerSource); await savedUnchanged();
  report.sourceConflict=await evaluate("document.querySelector('#sceneLayoutMessage').textContent");
  assert.match(report.sourceConflict,/变化|已失效/); await cancelLayout(); await closePreview();
  await fill('#docSourceEditor',toApply.text); await openPreview(); await refreshDraft(); await closePreview();
  report.steps.push('A dedicated race probe injects a newer main-editor input after layout review while the modal is open. Stale apply is rejected, the newer text is retained, the layout draft stays open, and disk/build capture are untouched. Normal interactions always type only in the visible, unblocked source textarea.');

  await enabled('#docSaveBtn'); await click('#docSaveBtn');
  await wait(async()=>await readScene()===toApply.text && !(await editorState()).dirty,'normal editor save');
  const afterSave=await sourceTree(root);
  assert.deepEqual(Object.keys(afterSave).filter(file=>afterSave[file]!==initial[file]),[scene.sourcePath],'normal save changes only scene source');
  const savedCapture=await captureBuildSnapshot(root,scene.objectId);
  assert.notEqual(savedCapture.snapshotId,savedBuild.snapshotId);
  await openPreview(); const saved=await refreshSaved();
  assert.equal(saved.request.draft,undefined); assert.deepEqual(saved.payload.actors.map(actor=>actor.position),toApply.value.actors.map(actor=>actor.position));
  assert.deepEqual(saved.payload.sceneStructure.groups,toApply.value.groups); assert.equal(saved.payload.scene.sourceRevision,`sha256:${buildHash(toApply.text)}`);
  report.normalSave={sourceSha256:buildHash(toApply.text),snapshotBefore:savedBuild.snapshotId,snapshotAfter:savedCapture.snapshotId};
  report.steps.push('Only the normal main-editor Save persists the applied draft. Reopening saved preview yields the exact positions, nested groups and source SHA; all other author files remain byte-identical and the build snapshot changes only at this explicit save.');

  await closePreview(); const finalDraft=toApply.text.replace('Draft · layout / 草稿','Final unsaved draft / 未保存');
  await fill('#docSourceEditor',finalDraft); await openPreview(); await refreshDraft(); await openLayout();
  await click(`#sceneLayoutObjects button[data-actor-id="${instanceIds[0]}"]`); await fill('#sceneLayoutY','333','change'); const finalCandidate=await checkedLayout();
  const externalSource=toApply.text.replace('Draft · layout / 草稿','External saved source / 外部'); await write(scene.sourcePath,externalSource);
  const conflictBaseline=await editorState(), countBeforeConflict=await captureCount();
  await click('#sceneLayoutSave');
  await wait(()=>evaluate("!document.querySelector('#sceneLayoutDialog').open"),'external changes do not prevent a pure in-memory edit');
  const conflictPreview=await waitCapture(countBeforeConflict);
  assert.equal(conflictPreview.status,409,'preview reports that the saved baseline changed');
  await assertText(finalCandidate.text); assert.deepEqual(await editorState(),conflictBaseline,'in-memory edit retains original save preconditions');
  assert.equal(await readScene(),externalSource,'applying draft layout does not write disk');
  report.savedPreviewConflict=conflictPreview.payload;
  await closePreview(); await enabled('#docSaveBtn'); await click('#docSaveBtn');
  await wait(()=>evaluate("!document.querySelector('#docSaveConflictDialog').classList.contains('is-hidden')"),'normal save opens conflict dialog');
  assert.equal(await readScene(),externalSource); await assertText(finalCandidate.text);
  report.savedConflict=await evaluate("document.querySelector('#docSaveConflictDialog').textContent");
  await screenshot('source-layout-save-conflict-zh.png'); await click('#docSaveConflictKeepBtn');
  await wait(()=>evaluate("document.querySelector('#docSaveConflictDialog').classList.contains('is-hidden')"),'keep local text draft');
  await assertText(finalCandidate.text); assert.equal((await editorState()).dirty,true); assert.equal(await readScene(),externalSource);
  await write(scene.sourcePath,toApply.text); assert.deepEqual(await sourceTree(root),afterSave);
  report.steps.push('If the saved file changes externally after layout review, layout still applies only to memory and retains the original save preconditions. Automatic draft preview returns HTTP409, and normal main-editor Save opens its conflict dialog. Keeping the local draft preserves both its new coordinates and the external file; the isolated fixture is restored afterwards.');

  assert.equal((await buildState()).job,null); assert.deepEqual(report.errors,[]); assert.deepEqual(report.svgRequests,[]);
  report.created={sceneId:scene.objectId,instanceIds,groupIds}; report.authorFiles=await sourceTree(root);
  report.captures=await evaluate('window.__sceneCaptures'); report.requests=await evaluate('window.__writeRequests');
  assert.deepEqual(report.requests.filter(item=>item.url.includes('/api/world/commands')),[],'all source-layout operations bypass world write commands');
  report.ok=true;
} catch(error) { report.ok=false; report.failure=error.stack; console.error(error); process.exitCode=1; try { await captureFailure?.(); } catch(e) { report.captureFailure=e.message; } }
finally { socket?.close(); for(const cleanup of cleanups.reverse()) try { await cleanup(); } catch(error) { report.ok=false; report.errors.push({cleanup:error.message}); process.exitCode=1; }
 report.assertions=assertionCount; report.finishedAt=new Date().toISOString(); await fs.writeFile(path.join(output,'browser.json'),json(report)); console.log(JSON.stringify({ok:report.ok,steps:report.steps,limitations:report.limitations,failure:report.failure,output},null,2)); }
