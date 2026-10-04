// Real browser Scene2D v3 nested organization groups through the real HTTP editor and Chrome pointer/keyboard input.
// Run: VIENTO_SCENE_GROUPS_OUTPUT=/empty/evidence/path node scripts/tests/scene-groups-smoke.mjs [chromium]
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
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { registerWorkspace } from '../lib/workspace.mjs';
import { importMediaAsset } from '../lib/media-assets.mjs';
import { getProjectionTemplates, lockProjectionTemplate } from '../../engine/object-projection.mjs';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.env.VIENTO_SCENE_GROUPS_OUTPUT || path.join(os.tmpdir(), `viento-scene-groups-evidence-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_SCENE_GROUPS_OUTPUT directory; prior evidence is immutable.');
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], errors: [], svgRequests: [], limitations: [
  'HTTP editor and real Chrome canvas only; packaged Tauri IPC and Android were not exercised.',
  'Layout edits exercise static positions only. No Godot tool, runtime movement, audio, or gameplay was used.',
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-groups-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'workspace'), template = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank');
  const write = async (relative, content) => { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); };
  for (const name of ['documents', 'templates', 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(root, name), { recursive: true });
  await write('workspace.json', json({ format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Scene layout smoke', createdAt: 0,
    ...WORKSPACE_LAYOUT, documentTypes: template.documentTypes }));
  for (const [name, content] of Object.entries(template.templates)) await write(`templates/${name}`, content);
  await registerWorkspace(root);
  const execute = createWorldCommandService(root);
  const create = async (command, sourcePath, content) => {
    const view = await readWorldProjection(root), request = { command, mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
      actorRef: { kind: 'tool', id: 'scene-layout-smoke' }, objectId: randomUUID(), documentType: 'document', sourcePath, content };
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
    const declaration = { format: 'viento-object-projection', schemaVersion: 1, title: index ? 'Traveler · NPC' : 'Traveler · Player', sourceObjectId: core.objectId,
      template: await lockProjectionTemplate(selected, { digest: buildHash }),
      configuration: { ...Object.fromEntries(selected.fields.map(field => [field.id, field.default])), image: images[0].id, speed: index ? 0 : 180 } };
    variants.push(await create('projection.create', `documents/projections/${suffix}.json`, json(declaration)));
  }
  const declaration = { format: 'viento-scene2d', schemaVersion: 1, title: 'A · inherited and overridden', viewport: [640, 480], background: '#101827', actors: [
    { objectId: variants[0].objectId, position: [160, 200], useProjectionDefaults: true },
    { objectId: variants[1].objectId, position: [380, 200], useProjectionDefaults: true, size: [120, 60], imageResourceId: images[1].id },
  ] };
  const scene = await create('scene.create', 'documents/scenes/a.json', '\uFEFF' + json(declaration).replaceAll('\n', '\r\n'));
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root, XDG_CACHE_HOME: path.join(temporary, 'cache') };
  delete env.VIENTO_GODOT_BIN; delete env.VIENTO_SESSION_TOKEN; delete env.VIENTO_PREFERENCES_PATH;
  await runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
  const initial = await sourceTree(root), base = await serve(t, appRoot, env);
  const state = async () => { const response = await fetch(`${base}/api/project-build`); assert.equal(response.status, 200); const body = await response.json(); return body.data || body; };
  assert.equal((await state()).available, false); assert.equal((await state()).job, null);
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
  const fill = (selector, value, event = 'input') => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === false && !document.querySelector(${JSON.stringify(selector)}).hidden`), `${selector} enabled`);
  const screenshot = async name => { const value = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(value.data, 'base64')); };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate(`({ text: document.body.innerText, captures: window.__sceneCaptures, html: document.querySelector('#sceneLayoutDialog')?.innerHTML })`); report.serviceFailure = await state(); };
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable'); report.browser = (await call('Browser.getVersion')).product;
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable && document.querySelector('#projectBuildBtn')?.hidden === false`), 'preview-capable editor');
  // Capture public snapshots to verify the saved preview changes only after Apply.
  await evaluate(`(() => { const original = window.fetch.bind(window); window.__sceneCaptures = []; window.fetch = async (input, init) => {
    const response = await original(input, init); const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/scene-preview') && init?.method === 'POST') {
      const body = await response.clone().json(); window.__sceneCaptures.push(body.data || body);
    }
    if (url.includes('/api/project-build') && !init?.method && window.__holdNextLayoutBuildRefresh) {
      window.__holdNextLayoutBuildRefresh = false; window.__layoutBuildRefreshHeld = true; await new Promise(resolve => { window.__releaseLayoutBuildRefresh = resolve; });
    } return response;
  }; })()`);

  const latest = () => evaluate('window.__sceneCaptures.at(-1)');
  const readScene = async () => JSON.parse((await fs.readFile(path.join(root, scene.sourcePath), 'utf8')).replace(/^\uFEFF/, ''));
  const waitScene = async () => { await wait(async () => (await latest())?.scene?.objectId === scene.objectId && (await latest())?.ok, 'saved scene capture'); await enabled('#scenePreviewLayoutEdit'); };
  const openLayout = async () => { await enabled('#scenePreviewLayoutEdit'); await click('#scenePreviewLayoutEdit');
    await wait(() => evaluate(`document.querySelector('#sceneLayoutDialog')?.open && document.querySelector('#sceneLayoutDialog').getAttribute('aria-busy') !== 'true'`), 'layout editor open'); };
  const instanceIds = () => evaluate(`Array.from(document.querySelectorAll('[id^="sceneActor"][id$="Instance"]'), input => input.value)`);
  const drag = async (position, dx, dy) => {
    await evaluate(`document.querySelector('#sceneLayoutCanvas').scrollIntoView({ block: 'center' })`);
    const point = await evaluate(`(async () => { const canvas = document.querySelector('#sceneLayoutCanvas'), b = canvas.getBoundingClientRect();
      const { fitSceneView, sceneToCanvas } = await import('/web/modules/app-scene-preview-canvas.js');
      const [x, y] = sceneToCanvas(fitSceneView([640, 480], b.width, b.height), ...${JSON.stringify(position)}); return { x: b.left + x, y: b.top + y }; })()`);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...point });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: point.x + dx / 2, y: point.y + dy / 2 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: point.x + dx, y: point.y + dy });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, x: point.x + dx, y: point.y + dy });
  };
  const checkedLayout = async () => {
    await enabled('#sceneLayoutCheck'); await click('#sceneLayoutCheck'); await enabled('#sceneLayoutSave');
    const text = await evaluate(`document.querySelector('#sceneLayoutSource').textContent`); return { text, value: JSON.parse(text.replace(/^\uFEFF/, '')) };
  };
  await click('#projectBuildBtn'); await enabled('#projectBuildScene'); await fill('#projectBuildScene', scene.objectId, 'change');
  await click('#projectBuildTabPreview'); await waitScene(); assert.equal((await latest()).schemaVersion, 1);
  await enabled('#scenePreviewEdit'); await click('#scenePreviewEdit'); await enabled('#sceneCreateCheck');
  assert.deepEqual(await readScene(), declaration); await click('#sceneCreateEnableInstances');
  await click('#sceneActor0Duplicate'); await fill('#sceneActor1position0', '320'); await fill('#sceneActor1position1', '320');
  const ids = await instanceIds(); assert.equal(ids.length, 3);
  await enabled('#sceneCreateEnableGroups'); await click('#sceneCreateEnableGroups');
  await enabled('#sceneCreateAddGroup'); await click('#sceneCreateAddGroup'); await fill('#sceneGroup0Name', '城镇 Town😀');
  await click('#sceneCreateAddGroup'); await fill('#sceneGroup1Name', '居民 Residents');
  const groupIds = await evaluate(`['sceneGroup0Identity','sceneGroup1Identity'].map(id => document.getElementById(id).value)`);
  await fill('#sceneGroup1Parent', groupIds[0], 'change');
  assert.equal(await evaluate(`Array.from(document.querySelector('#sceneGroup0Parent').options).some(option => option.value === '${groupIds[1]}')`), false, 'parent options exclude descendants');
  await fill('#sceneActor0Group', groupIds[0], 'change'); await fill('#sceneActor1Group', groupIds[1], 'change');
  assert.equal(await evaluate(`document.querySelector('#sceneGroup0Remove').disabled && document.querySelector('#sceneGroup1Remove').disabled`), true, 'nonempty groups cannot remove members accidentally');
  await click('#sceneCreateAddGroup'); await enabled('#sceneGroup2Remove'); await click('#sceneGroup2Remove');
  assert.deepEqual(await instanceIds(), ids);
  await click('#sceneCreateCheck'); await enabled('#sceneCreateSave');
  const checked = await evaluate(`document.querySelector('#sceneCreateSource').textContent`), grouped = JSON.parse(checked.replace(/^\uFEFF/, ''));
  assert.equal(grouped.schemaVersion, 3); assert.equal(grouped.groups.length, 2);
  assert.deepEqual(grouped.actors.map(actor => actor.instanceId), ids);
  assert.deepEqual(grouped.actors.map(actor => actor.groupId), [groupIds[0],groupIds[1],undefined]);
  assert.deepEqual(await sourceTree(root), initial, 'group authoring/review stays local before save');
  await screenshot('groups-author-check-zh.png');
  for (const language of ['en', 'ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('${language}')`);
    if (language === 'ja') await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    assert.deepEqual(await instanceIds(), ids);
    await evaluate(`document.querySelector('#sceneGroup0Name').scrollIntoView({ block: 'center' })`);
    assert.equal(await evaluate(`document.querySelector('#sceneCreateDialog').scrollWidth <= document.querySelector('#sceneCreateDialog').clientWidth`), true);
    await screenshot(`groups-author-${language}.png`);
  }
  await call('Emulation.clearDeviceMetricsOverride'); await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await click('#sceneCreateSave'); await wait(async () => JSON.stringify(await readScene()) === JSON.stringify(grouped), 'group source saved');
  await enabled('#sceneCreateClose'); await click('#sceneCreateClose');
  await wait(async () => (await latest())?.sceneStructure?.groups?.length === 2, 'group preview refreshed');
  const preview = await latest(); assert.equal(preview.schemaVersion, 2); assert.equal(preview.sceneStructure.sourceSchemaVersion, 3);
  assert.equal(preview.actors.some(actor => Object.hasOwn(actor, 'groupId')), false, 'author grouping never enters plan actors');
  assert.equal(checked[0], '\uFEFF'); assert.ok(checked.includes('\r\n')); assert.ok(!checked.replaceAll('\r\n','').includes('\n'));
  const groupedTree = await sourceTree(root); assert.deepEqual(Object.keys(groupedTree).filter(file => groupedTree[file] !== initial[file]), [scene.sourcePath]);
  report.steps.push('Explicit v1→instances→groups upgrades only the checked draft. Parent/child groups, member assignment and empty-only removal preserve instance IDs; parent choices exclude cycles. Save preserves BOM/CRLF and changes only scene text. English/Japanese and390px form retain the same draft.');

  await enabled('#scenePreviewSearch');
  await click(`#scenePreviewObjects button[data-group-toggle="${groupIds[0]}"]`);
  assert.equal(await evaluate(`document.querySelector('#scenePreviewObjects button[data-group-toggle="${groupIds[0]}"]').getAttribute('aria-expanded')`), 'false');
  await fill('#scenePreviewSearch', 'Residents');
  await wait(() => evaluate(`Boolean(document.querySelector('#scenePreviewObjects button[data-group-toggle="${groupIds[0]}"]')) && Boolean(document.querySelector('#scenePreviewObjects button[data-actor-id="${ids[1]}"]'))`), 'search retains matching group ancestors and descendants');
  assert.equal(await evaluate(`document.querySelector('#scenePreviewObjects button[data-actor-id="${ids[2]}"]') === null`), true, 'unrelated root actor filtered');
  await screenshot('groups-search-zh.png');
  await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('en')`);
  assert.equal(await evaluate(`document.querySelector('#scenePreviewSearch').value`), 'Residents');
  await fill('#scenePreviewSearch', '');
  assert.equal(await evaluate(`document.querySelector('#scenePreviewObjects button[data-group-toggle="${groupIds[0]}"]').getAttribute('aria-expanded')`), 'false', 'clearing search restores prior collapse');
  await click(`#scenePreviewObjects button[data-group-toggle="${groupIds[0]}"]`);
  await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);
  await click(`#scenePreviewObjects button[data-group-source="${groupIds[0]}"]`);
  await wait(() => evaluate(`document.activeElement.id === 'docSourceEditor' && document.querySelector('#docEditStatus').textContent.includes('已定位来源字段')`), 'group name exact source focus');
  const selected = await evaluate(`(() => { const e=document.querySelector('#docSourceEditor');return {text:e.value.slice(e.selectionStart,e.selectionEnd),status:document.querySelector('#docEditStatus').textContent};})()`);
  assert.equal(JSON.parse(selected.text), '城镇 Town😀'); assert.ok(selected.status.includes('/groups/0/name'));
  report.sourceSelection = selected; await screenshot('groups-source-name-zh.png'); assert.deepEqual(await sourceTree(root), groupedTree);
  report.steps.push('Nested outline collapse and search preserve matching ancestors without changing the canvas or author files. Clearing search restores collapse and language switches keep the query. Group source opens the real textarea and selects the exact Unicode name after BOM/CRLF offset conversion.');

  await click('#projectBuildBtn'); await waitScene(); await openLayout();
  await click(`#sceneLayoutObjects button[data-group-id="${groupIds[0]}"]`);
  const selectedIds = () => evaluate(`Array.from(document.querySelectorAll('#sceneLayoutObjects input[data-actor-id]')).filter(input => input.checked).map(input => input.dataset.actorId).sort()`);
  assert.deepEqual(await selectedIds(), ids.slice(0,2).sort());
  await drag([160,200],36,24); const moved=await checkedLayout();
  const delta=moved.value.actors[0].position.map((value,axis)=>value-grouped.actors[0].position[axis]);
  assert.ok(delta[0]>0&&delta[1]>0);
  for(const axis of [0,1])assert.ok(Math.abs(moved.value.actors[1].position[axis]-grouped.actors[1].position[axis]-delta[axis])<1e-8);
  assert.deepEqual(moved.value.actors[2],grouped.actors[2]);assert.deepEqual(moved.value.groups,grouped.groups);
  await click('#sceneLayoutUndo');
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutDialog').dataset.dirty`),'false','undo returns to the saved baseline');
  for(const [index,id] of ids.entries()){
    await click(`#sceneLayoutObjects button[data-actor-id="${id}"]`);
    assert.deepEqual(await evaluate(`['sceneLayoutX','sceneLayoutY'].map(id=>Number(document.getElementById(id).value))`),grouped.actors[index].position);
  }
  await click(`#sceneLayoutObjects button[data-group-id="${groupIds[0]}"]`);
  await click('#sceneLayoutRedo');assert.deepEqual((await checkedLayout()).value,moved.value);
  await screenshot('groups-layout-descendants-zh.png');assert.deepEqual(await sourceTree(root),groupedTree);
  await click('#sceneLayoutSave');await wait(async()=>(await fs.readFile(path.join(root,scene.sourcePath),'utf8'))===moved.text,'group layout saved');
  await enabled('#sceneLayoutClose');await click('#sceneLayoutClose');
  await wait(async()=>(await latest())?.actors?.[0]?.position?.[0]===moved.value.actors[0].position[0],'saved grouped preview');
  await openLayout();await click(`#sceneLayoutObjects button[data-group-id="${groupIds[1]}"]`);assert.deepEqual(await selectedIds(),[ids[1]]);
  report.steps.push('Selecting a parent group expands to all and only descendant instances. Real pointer dragging preserves their spacing and original actor order, leaves ungrouped actors fixed, and is one Undo/Redo step. Save/reopen retains groups and memberships; selecting a child selects only its descendant.');

  await fill('#sceneLayoutX','420','change');await checkedLayout();
  const external=moved.text.replace('城镇 Town😀','外部改名 External');assert.notEqual(external,moved.text);await write(scene.sourcePath,external);
  await click('#sceneLayoutSave');await wait(()=>evaluate(`document.querySelector('#sceneLayoutSave').disabled && document.querySelector('#sceneLayoutDialog').getAttribute('aria-busy') !== 'true'`),'group source conflict');
  assert.equal(await fs.readFile(path.join(root,scene.sourcePath),'utf8'),external);
  assert.equal(await evaluate(`document.querySelector('#sceneLayoutX').value`),'420');assert.deepEqual(await selectedIds(),[ids[1]]);
  report.conflict=await evaluate(`document.querySelector('#sceneLayoutMessage').textContent`);await screenshot('groups-conflict-preserves-draft-zh.png');
  confirmAccept=true;await click('#sceneLayoutCancel');await wait(()=>evaluate(`!document.querySelector('#sceneLayoutDialog').open`),'discard conflict draft');
  await write(scene.sourcePath,moved.text);
  assert.equal((await state()).job,null);assert.deepEqual(report.errors,[]);assert.deepEqual(report.svgRequests,[]);
  report.steps.push('An external group-name change after layout review rejects stale Apply, preserves the selected child instance and local position draft, and never overwrites author text. No build job or engine is launched by the editor workflow.');
  const deep = structuredClone(moved.value);
  deep.groups = Array.from({length:16},(_,index)=>({groupId:randomUUID(),name:`第 ${index+1} 层 · Nested group`}));
  for(let index=1;index<deep.groups.length;index++)deep.groups[index].parentGroupId=deep.groups[index-1].groupId;
  for(const actor of deep.actors)delete actor.groupId;
  deep.actors[0].groupId=deep.groups.at(-1).groupId;
  await write(scene.sourcePath,json(deep));await enabled('#scenePreviewRefresh');await click('#scenePreviewRefresh');
  await wait(async()=>(await latest())?.sceneStructure?.groups?.length===16,'depth16 preview');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('#scenePreviewObjects').scrollIntoView({block:'start'})`);
  report.deepOutline=await evaluate(`(() => {const list=document.querySelector('#scenePreviewObjects'),aside=list.closest('aside'); return {listWidth:list.clientWidth,listScrollWidth:list.scrollWidth,asideWidth:aside.clientWidth,asideScrollWidth:aside.scrollWidth};})()`);
  assert.ok(report.deepOutline.asideScrollWidth<=report.deepOutline.asideWidth,'depth16 outline fits narrow viewport');
  await fill('#scenePreviewSearch',ids[0]);
  assert.equal(await evaluate(`document.querySelectorAll('#scenePreviewObjects [data-group-toggle]').length`),16);
  await evaluate(`document.querySelector('#scenePreviewObjects button[data-actor-id="${ids[0]}"]').scrollIntoView({block:'center'})`);
  const deepestWidth=await evaluate(`document.querySelector('#scenePreviewObjects button[data-actor-id="${ids[0]}"]').getBoundingClientRect().width`);
  assert.ok(deepestWidth>=160,'deepest instance remains readable at390px');report.deepOutline.deepestButtonWidth=deepestWidth;
  await screenshot('groups-depth16-narrow-zh.png');
  await call('Emulation.clearDeviceMetricsOverride');await write(scene.sourcePath,moved.text);
  report.steps.push('A16-level group chain remains usable at390px; searching the deepest instance retains all16 ancestors without horizontal overflow. The temporary source fixture is then restored.');
  report.created={sceneId:scene.objectId,instanceIds:ids,groupIds};report.authorFiles=await sourceTree(root);report.captures=await evaluate('window.__sceneCaptures');report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);process.exitCode=1;try{await captureFailure?.();}catch(e){report.captureFailure=e.message;}}
finally{socket?.close();for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.ok=false;report.errors.push({cleanup:error.message});process.exitCode=1;}
 report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'browser.json'),json(report));console.log(JSON.stringify({ok:report.ok,steps:report.steps,limitations:report.limitations,failure:report.failure,output},null,2));}
