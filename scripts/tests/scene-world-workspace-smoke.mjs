// Real browser Scene2D source draft → layout → source draft → normal save through real HTTP and Chrome.
// Run: VIENTO_SCENE_WORLD_WORKSPACE_OUTPUT=/empty/evidence/path node scripts/tests/scene-world-workspace-smoke.mjs [chromium]
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
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';

let assertionCount = 0;
const assert = new Proxy(strictAssert, { get(target, key) { const value = Reflect.get(target, key); return typeof value === 'function' ? (...args) => { assertionCount++; return Reflect.apply(value, target, args); } : value; } });

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene2d-world-workspace');
const output = path.resolve(process.env.VIENTO_SCENE_WORLD_WORKSPACE_OUTPUT || path.join(evidenceRoot, `browser-${Date.now()}`));
if (!output.startsWith(evidenceRoot + path.sep)) throw new Error('Choose a fresh directory inside the scene2d-world-workspace evidence topic.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_SCENE_WORLD_WORKSPACE_OUTPUT directory; prior evidence is immutable.');
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], errors: [], svgRequests: [], limitations: [
  'HTTP editor and real Chrome canvas only; packaged Tauri IPC and Android were not exercised.',
  'This verifies authoring world coordinates, not a runtime camera, embedded engine viewport, packaged Tauri IPC or device acceptance.',
] };
const sources = ['engine/scene-workspace-view.mjs','engine/scene-layout.mjs','engine/scene-source-layout.mjs','engine/scene-draft-preview.mjs','engine/scene-preview-contract.mjs','engine/studio-core.mjs','engine/studio-core.wasm','web/modules/app-scene-preview-canvas.js','web/modules/app-scene-preview.js','web/modules/app-scene-layout.js','web/modules/app-scene-outline.js','web/scene-preview.css','web/project-build.css','web/i18n/en.js','web/i18n/ja.js','scripts/lib/scene-preview-service.mjs','scripts/lib/resource-package-catalog.mjs','scripts/lib/resource-package-reader.mjs','scripts/lib/resource-package-import.mjs','scripts/lib/resource-package-transaction.mjs','scripts/lib/export-package.mjs','scripts/adapters/node-build-snapshot.mjs','scripts/backends/godot4-instances.mjs','scripts/backends/godot4/runtime-v2.gd','scripts/tests/scene-world-workspace-smoke.mjs'];
report.sources=Object.fromEntries(await Promise.all(sources.map(async name=>[name,buildHash(await fs.readFile(path.join(appRoot,name)))])));
report.node={version:process.version,sha256:buildHash(await fs.readFile(process.execPath))};
let socket, captureFailure, temporary;
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
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-world-workspace-browser-'));
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
      actorRef: { kind: 'tool', id: 'scene-world-workspace-smoke' }, objectId: randomUUID(), documentType: 'document', sourcePath, content };
    await execute(request); return request;
  };
  const core = await create('object.create', 'documents/core.md', '\uFEFF# Traveler / 旅人\r\n\r\n故事属于原 OC。  \r\n');
  const images = [];
  for (const color of ['#44aaee', '#ee6644']) {
    const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${color}"/></svg>`);
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
      { instanceId: instanceIds[0], objectId: variants[0].objectId, groupId: groupIds[0], position: [-240, -120], useProjectionDefaults: true },
      { instanceId: instanceIds[1], objectId: variants[0].objectId, groupId: groupIds[1], position: [1360, 760], useProjectionDefaults: true, size: [120, 60], imageResourceId: images[1].id },
      { instanceId: instanceIds[2], objectId: variants[1].objectId, position: [300, 240], useProjectionDefaults: true },
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
  assert.equal((await buildState()).job, null);
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

  const viewInfo = async selector => evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(selector)}),r=c.getBoundingClientRect(),m=c.getContext('2d').getTransform(),ratio=c.width/r.width;return{rect:{x:r.left,y:r.top,width:r.width,height:r.height},view:{scale:m.a/ratio,offsetX:m.e/ratio,offsetY:m.f/ratio},matrix:{a:m.a,b:m.b,c:m.c,d:m.d,e:m.e,f:m.f},ratio};})()`);
  const pointAt = async (selector, position) => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`); const info=await viewInfo(selector);const p={x:info.rect.x+info.view.offsetX+position[0]*info.view.scale,y:info.rect.y+info.view.offsetY+position[1]*info.view.scale};assert.ok(p.x>=info.rect.x&&p.x<=info.rect.x+info.rect.width&&p.y>=info.rect.y&&p.y<=info.rect.y+info.rect.height,JSON.stringify({p,info,position}));return p; };
  const pointer = async (selector,position,dx=0,dy=0) => { const p=await pointAt(selector,position);await call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...p});if(dx||dy){await call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:p.x+dx/2,y:p.y+dy/2});await call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:p.x+dx,y:p.y+dy});}await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:p.x+dx,y:p.y+dy}); };
  const actorPressed = (container,id) => evaluate(`document.querySelector(${JSON.stringify(container)}+' button[data-actor-id="'+${JSON.stringify(id)}+'"]')?.getAttribute('aria-pressed')`);
  const verifyFocus = async (canvasSelector, position) => { const info=await viewInfo(canvasSelector), actual=[info.view.offsetX+position[0]*info.view.scale,info.view.offsetY+position[1]*info.view.scale];assert.ok(Math.abs(actual[0]-info.rect.width/2)<3&&Math.abs(actual[1]-info.rect.height/2)<3,JSON.stringify({info,position,actual}));const roundtrip=await evaluate(`(()=>{const {sceneToCanvas,canvasToScene}=window.__worldCanvasModule;const v=${JSON.stringify(info.view)},p=${JSON.stringify(position)},q=sceneToCanvas(v,...p);return canvasToScene(v,...q)})()`);for(let axis=0;axis<2;axis++)assert.ok(Math.abs(roundtrip[axis]-position[axis])<1e-7);return info; };
  const actorPixels = async (selector,actor) => evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(selector)}),r=c.getBoundingClientRect(),ctx=c.getContext('2d'),m=ctx.getTransform(),rx=c.width/r.width,ry=c.height/r.height,p=${JSON.stringify(actor.position)},size=${JSON.stringify(actor.size)},cx=(m.e+p[0]*m.a)/rx,cy=(m.f+p[1]*m.d)/ry,hw=size[0]*m.a/(2*rx),hh=size[1]*m.d/(2*ry);const inside=[cx+hw*0.4,cy],candidates=[[cx+hw+6,cy],[cx-hw-6,cy],[cx,cy-hh-6],[cx,cy+hh+6]],valid=([x,y])=>x>=1&&x<r.width-1&&y>=1&&y<r.height-1,outside=candidates.find(valid);if(!valid(inside)||!outside)throw Error('No visible inside/outside actor pixel');const sample=([x,y])=>Array.from(ctx.getImageData(Math.floor(x*rx),Math.floor(y*ry),1,1).data);return{canvas:{width:r.width,height:r.height,pixelWidth:c.width,pixelHeight:c.height},bounds:{left:cx-hw,right:cx+hw,top:cy-hh,bottom:cy+hh},inside:{css:inside,pixel:[Math.floor(inside[0]*rx),Math.floor(inside[1]*ry)],rgba:sample(inside)},outside:{css:outside,pixel:[Math.floor(outside[0]*rx),Math.floor(outside[1]*ry)],rgba:sample(outside)}}})()`);

  await evaluate(`(async()=>{window.__worldCanvasModule=await import('/web/modules/app-scene-preview-canvas.js');window.__worldCanvasModule2=await import('/engine/scene-workspace-view.mjs')})()`);

  await evaluate(`(()=>{window.__worldFrames=[];const original=CanvasRenderingContext2D.prototype.strokeRect;CanvasRenderingContext2D.prototype.strokeRect=function(x,y,w,h){if((this.canvas.id==='scenePreviewCanvas'||this.canvas.id==='sceneLayoutCanvas')&&x===0&&y===0&&w===640&&h===480){const m=this.getTransform();window.__worldFrames.push({id:this.canvas.id,matrix:[m.a,m.b,m.c,m.d,m.e,m.f]});}return original.call(this,x,y,w,h)}})()`);
  await openPreview();await wait(async()=>(await latest())?.payload?.ok&&!(await modalBusy()),'initial saved preview');const initialCapture=await latest();assert.deepEqual(initialCapture.payload.actors.map(a=>a.position),declaration.actors.map(a=>a.position));
  await click('#scenePreviewFit');await wait(()=>evaluate(`window.__worldFrames.some(x=>x.id==='scenePreviewCanvas')`),'viewport frame painted');assert.deepEqual(await readScene(),originalSource);await savedUnchanged();
  await click('#scenePreviewFitAll');const all=await viewInfo('#scenePreviewCanvas');for(const position of declaration.actors.map(actor=>actor.position)){const x=all.view.offsetX+position[0]*all.view.scale,y=all.view.offsetY+position[1]*all.view.scale;assert.ok(x>=0&&x<=all.rect.width&&y>=0&&y<=all.rect.height,JSON.stringify({all,position}));}report.previewFitAll=all;await evaluate(`(()=>{const e=document.querySelector('#scenePreviewGrid');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}))})()`);const grid=await evaluate(`(()=>{const {sceneWorldGrid}=window.__worldCanvasModule2;return sceneWorldGrid(${JSON.stringify(all.view)},${all.rect.width},${all.rect.height})})()`);assert.ok(grid.xs.length<=256&&grid.ys.length<=256);assert.ok(grid.bounds.left<0&&grid.bounds.top<0&&grid.bounds.right>640&&grid.bounds.bottom>480);report.grid={xLines:grid.xs.length,yLines:grid.ys.length,bounds:grid.bounds,step:grid.step};await screenshot('preview-fit-all.png');
  for(const index of [0,1]){await click(`#scenePreviewObjects button[data-actor-id="${instanceIds[index]}"]`);await enabled('#scenePreviewFocusSelection');await click('#scenePreviewFocusSelection');const view=await verifyFocus('#scenePreviewCanvas',declaration.actors[index].position);await pointer('#scenePreviewCanvas',declaration.actors[index].position);assert.equal(await actorPressed('#scenePreviewObjects',instanceIds[index]),'true');const actor=initialCapture.payload.actors[index],pixels=await actorPixels('#scenePreviewCanvas',actor);assert.notDeepEqual(pixels.inside.rgba,pixels.outside.rgba,'world actor must be painted, not merely hit-testable');(report.previewFocus ||= []).push({view,pixels});await screenshot(`preview-focus-${index}.png`);}
  await savedUnchanged();await click('#scenePreviewSource');await wait(()=>evaluate("document.activeElement.id==='docSourceEditor' && !document.querySelector('#projectBuildDialog').open"),'visible source');
  const draftSource=originalSource.replace('A · text draft preview','World workplane draft / 草稿');await fill('#docSourceEditor',draftSource);await openPreview();const draft=await refreshDraft();assert.equal(draft.request.draft.content,draftSource);assert.deepEqual(draft.payload.actors.map(a=>a.position),declaration.actors.map(a=>a.position));
  const exercise = async () => {await openLayout();await click('#sceneLayoutFit');await wait(()=>evaluate(`window.__worldFrames.some(x=>x.id==='sceneLayoutCanvas')`),'layout viewport frame');await click('#sceneLayoutFitAll');const fit=await viewInfo('#sceneLayoutCanvas');report.layoutFitAll=fit;
    for(const index of [0,1]){await click(`#sceneLayoutObjects button[data-actor-id="${instanceIds[index]}"]`);await click('#sceneLayoutFocusSelection');await verifyFocus('#sceneLayoutCanvas',declaration.actors[index].position);await pointer('#sceneLayoutCanvas',declaration.actors[index].position);assert.deepEqual(await selectedIds(),[instanceIds[index]]);}
    await click(`#sceneLayoutObjects button[data-actor-id="${instanceIds[0]}"]`);await click('#sceneLayoutFocusSelection');await click(`#sceneLayoutObjects button[data-group-id="${groupIds[0]}"]`);assert.deepEqual(await selectedIds(),instanceIds.slice(0,2).sort());await pointer('#sceneLayoutCanvas',declaration.actors[0].position,25,16);const reviewed=await checkedLayout();const positions=reviewed.value.actors.map(actor=>actor.position),delta=positions[0].map((v,i)=>v-declaration.actors[0].position[i]);assert.ok(delta.every(x=>x>0));for(const axis of [0,1])assert.ok(Math.abs(positions[1][axis]-declaration.actors[1].position[axis]-delta[axis])<1e-7);assert.deepEqual(positions[2],declaration.actors[2].position);assert.deepEqual(reviewed.value.viewport,declaration.viewport);assert.equal(reviewed.text,replacePositionTokens(draftSource,positions));return reviewed; };
  const first=await exercise();await assertText(draftSource);await savedUnchanged();await click('#sceneLayoutUndo');assert.equal(await evaluate("document.querySelector('#sceneLayoutDialog').dataset.dirty"),'false');await click('#sceneLayoutRedo');assert.equal((await checkedLayout()).text,first.text);await cancelLayout();await assertText(draftSource);await savedUnchanged();
  const candidate=await exercise();assert.equal(candidate.text,first.text);for(const language of ['zh-CN','en','ja']){await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);await evaluate("document.querySelector('#sceneLayoutFitAll').scrollIntoView({block:'center'})");const size=await evaluate(`(()=>{const d=document.querySelector('#sceneLayoutDialog'),fit=document.querySelector('#sceneLayoutFitAll'),focus=document.querySelector('#sceneLayoutFocusSelection'),r=fit.getBoundingClientRect();return{noOverflow:d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth,inside:r.left>=0&&r.right<=innerWidth,fit:fit.textContent,focus:focus.textContent,review:document.querySelector('#sceneLayoutSource').textContent}})()`);assert.equal(size.noOverflow,true,JSON.stringify(size));assert.equal(size.inside,true);assert.equal(size.review,candidate.text);assert.ok(size.fit&&size.focus);(report.layout ||= {})[language]={...size,review:undefined};await screenshot(`layout-${language}-390.png`);}
  await call('Emulation.clearDeviceMetricsOverride');await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('zh-CN')`);const applied=await applyLayout(candidate.text);assert.deepEqual(applied.payload.actors.map(a=>a.position),candidate.value.actors.map(a=>a.position));await savedUnchanged();await closePreview();await enabled('#docSaveBtn');await click('#docSaveBtn');await wait(async()=>await readScene()===candidate.text&&!(await editorState()).dirty,'explicit ordinary save');
  const afterSave=await sourceTree(root);assert.deepEqual(Object.keys(afterSave).filter(file=>afterSave[file]!==initial[file]),[scene.sourcePath]);const savedCapture=await captureBuildSnapshot(root,scene.objectId);assert.equal(savedCapture.ok,true,JSON.stringify(savedCapture.diagnostics));assert.deepEqual(savedCapture.plan.scene.viewport,declaration.viewport);for(const [index,id] of instanceIds.entries())assert.deepEqual(savedCapture.plan.actors.find(a=>a.instanceId===id).position,candidate.value.actors[index].position);
  await openPreview();const reopened=await refreshSaved();assert.deepEqual(reopened.payload.actors.map(a=>a.position),candidate.value.actors.map(a=>a.position));assert.deepEqual(reopened.payload.scene.viewport,declaration.viewport);await closePreview();
  const catalog=await readPackageCatalog(root),plan=await planExport(root,{kind:'resources',revision:catalog.revision,ids:[scene.objectId],includeDependencies:true}),zip=path.join(temporary,'scene-package.zip');await writeExportZip(plan,zip);const stage=path.join(temporary,'unpack');await fs.mkdir(stage);const pack=await unpackResourcePackage(zip,stage),documents=new Set(pack.manifest.documents.map(row=>row.id));assert.ok(documents.has(scene.objectId));assert.ok(documents.has(core.objectId));for(const item of variants)assert.ok(documents.has(item.objectId));
  const target=path.join(temporary,'restored');await fs.mkdir(target);await fs.copyFile(path.join(root,'workspace.json'),path.join(target,'workspace.json'));await fs.cp(path.join(root,'templates'),path.join(target,'templates'),{recursive:true});await fs.mkdir(path.join(target,'documents'),{recursive:true});await registerWorkspace(target);const importPlan=await planPackageImport(target,pack);assert.deepEqual(importPlan.summary.conflicts,[]);assert.equal((await applyPackageImport(target,pack,importPlan.revision)).status,'imported');assert.equal(await fs.readFile(path.join(target,scene.sourcePath),'utf8'),candidate.text);const imported=await captureBuildSnapshot(target,scene.objectId);assert.equal(imported.ok,true,JSON.stringify(imported.diagnostics));assert.deepEqual(imported.plan.scene.viewport,declaration.viewport);for(const [index,id]of instanceIds.entries())assert.deepEqual(imported.plan.actors.find(a=>a.instanceId===id).position,candidate.value.actors[index].position);
  const tool=process.env.VIENTO_GODOT_BIN;assert.ok(tool,'Set VIENTO_GODOT_BIN for the real native build and run');report.tool={sha256:buildHash(await fs.readFile(tool))};const service=createProjectBuildService(target,{tool,cacheRoot:path.join(temporary,'restored-cache')});cleanups.push(()=>service.close());await service.command({action:'build',sceneId:scene.objectId});let build;await wait(async()=>{build=await service.status();return build.job?.status!=='running'},'Godot build',90000);assert.equal(build.job.status,'succeeded',JSON.stringify(build.job.diagnostics));const detail=await service.command({action:'inspect-project',buildId:build.latestBuild.id});const project=path.join(detail.buildDirectory,'project');const generated=JSON.parse(await fs.readFile(path.join(project,'scene.json'),'utf8'));for(const [index,id]of instanceIds.entries())assert.deepEqual(generated.actors.find(a=>a.instanceId===id).position,candidate.value.actors[index].position);await service.command({action:'run',buildId:build.latestBuild.id,mode:'headless'});let hosted;await wait(async()=>{hosted=await service.status();return hosted.job?.status!=='running'},'Godot hosted run',90000);assert.equal(hosted.job.status,'succeeded',JSON.stringify(hosted.job.diagnostics));await runCommand(tool,['--headless','--editor','--path',project,'--import'],{cwd:project,env});const run=await runCommand(tool,['--headless','--path',project,'--','--viento-smoke'],{cwd:project,env});const events=run.stdout.split('\n').filter(line=>line.startsWith('VIENTO_RUNTIME:')).map(line=>JSON.parse(line.slice('VIENTO_RUNTIME:'.length))),ready=events.find(e=>e.event==='ready');assert.ok(ready,run.stdout);for(const [index,id]of instanceIds.entries()){const pos=ready.actors.find(a=>a.instanceId===id)?.position;assert.ok(pos);for(const axis of [0,1])assert.ok(Math.abs(pos[axis]-candidate.value.actors[index].position[axis])<0.02);}assert.ok(events.some(e=>e.event==='finished'));report.godot={buildId:build.latestBuild.id,hostedRun:hosted.job.status,probe:'separate direct Godot import and headless runtime',ready,finished:events.find(e=>e.event==='finished')};
  report.saved={source:scene.sourcePath,sha256:buildHash(candidate.text),positions:candidate.value.actors.map(a=>a.position),viewport:candidate.value.viewport};report.migration={documents:documents.size,packageSha256:buildHash(await fs.readFile(zip)),sceneBytesEqual:true,planPositions:imported.plan.actors.map(a=>({instanceId:a.instanceId,position:a.position}))};report.authorFiles={before:Object.keys(initial).length,after:Object.keys(afterSave).length,onlySceneChanged:true};report.viewportFrames=await evaluate('window.__worldFrames');report.created={sceneId:scene.objectId,instanceIds,groupIds};assert.deepEqual(await sourceTree(root),afterSave);assert.deepEqual(report.errors,[]);assert.deepEqual(report.svgRequests,[]);
  report.steps.push('Actual preview/layout canvases show and hit authored instances outside the runtime viewport; fit and focus only change the view. Multi-selection pointer movement, undo/redo and cancellation preserve the source until applying and normal Save.');report.steps.push('A resource package restores the exact saved scene and projection/OC dependencies; its independent build snapshot has the same viewport and world positions.');

  for(const [name,hash]of Object.entries(report.sources))assert.equal(buildHash(await fs.readFile(path.join(appRoot,name))),hash,'Source changed during smoke: '+name);report.sourceSnapshotUnchanged=true;report.ok=true;
} catch(error) { report.ok=false; report.failure=error.stack; console.error(error); process.exitCode=1; try { await captureFailure?.(); } catch(e) { report.captureFailure=e.message; } }
finally { socket?.close(); for(const cleanup of cleanups.reverse()) try { await cleanup(); } catch(error) { report.ok=false; report.errors.push({cleanup:error.message}); process.exitCode=1; } report.finishedAt=new Date().toISOString(); await fs.writeFile(path.join(output,'browser.json'),json(report).replaceAll(temporary || '\u0000','<fixture>').replaceAll(os.homedir(),'<home>')); }
