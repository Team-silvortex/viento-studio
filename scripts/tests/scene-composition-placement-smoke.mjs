// Real browser shared fragment declaration SET/RESET → guarded source draft → ordinary save in a disposable recipe.
// Run: VIENTO_COMPOSITION_PLACEMENT_OUTPUT=/empty/evidence/path node scripts/tests/scene-composition-fragments-smoke.mjs [chromium]
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
import { getProjectionTemplates, lockProjectionTemplate } from '../../engine/object-projection-template.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.env.VIENTO_COMPOSITION_PLACEMENT_OUTPUT || path.join(os.tmpdir(), `viento-placement-offset-evidence-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_COMPOSITION_PLACEMENT_OUTPUT directory; prior evidence is immutable.');
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], errors: [], svgRequests: [], limitations: [
  'Real HTTP editor and Chrome only; no installed Tauri window or Android device acceptance.',
  'One recipe placement offset SET/removal only; no actor/group structure or scale transform, executable recipe build or cross-file transaction.',
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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-placement-offset-browser-'));
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
  const selected = getProjectionTemplates().find(item => item.id.endsWith('.rpg-player'));
  const configuration = { ...Object.fromEntries(selected.fields.map(field => [field.id, field.default])),
    width: 96, height: 56, color: '#2288aa', speed: 175, controls: 'arrows', image: images[0].id };
  const projection = await create('projection.create', 'documents/projections/player.json', json({
    format: 'viento-object-projection', schemaVersion: 1, title: 'Player defaults', sourceObjectId: core.objectId,
    template: await lockProjectionTemplate(selected, { digest: buildHash }), configuration }));
  const declaration = JSON.parse(await fs.readFile(path.join(appRoot, 'examples/scene-composition/recipe.json')));
  for (const [index, actor] of declaration.fragments[0].actors.entries()) { actor.objectId = core.objectId; actor.imageResourceId = images[index].id; }
  declaration.fragments[0].actors[0].objectId = projection.objectId;
  declaration.fragments[0].actors[0].useProjectionDefaults = true;
  declaration.fragments[0].actors[0].imageResourceId = null;
  declaration.placements[1].overrides[0].values.imageResourceId = images[1].id;
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
  assert.equal(await evaluate("document.querySelector('#scenePreviewCompositionPlacement').disabled"), true);
  await click('#scenePreviewSource'); await wait(() => evaluate("document.activeElement.id === 'docSourceEditor' && !document.querySelector('#projectBuildDialog').open"), 'clean recipe source');
  const readScene = () => fs.readFile(path.join(root, scene.sourcePath), 'utf8');
  await evaluate("window.__appState=(await import('/web/modules/app-state.js')).appState");
  const state = () => evaluate('({dirty:window.__appState.editHasUnsavedChanges,base:window.__appState.activeEditSourceVersion})');
  const cleanState = await state(); assert.equal(cleanState.dirty, false);
  const el = suffix => '#sceneCompositionPlacement' + suffix;
  const parsed = text => JSON.parse(text.replace(/^\ufeff/, ''));
  const placementOpen = async (id = instanceIds[2]) => {
    await click(`#scenePreviewObjects button[data-actor-id="${id}"]`); await enabled('#scenePreviewCompositionPlacement'); await click('#scenePreviewCompositionPlacement');
    await wait(() => evaluate("document.querySelector('#sceneCompositionPlacementDialog')?.open && !document.querySelector('#sceneCompositionPlacementX').disabled"), 'placement editor');
  };
  const check = async () => { await enabled(el('Check')); const count = await captureCount(); await click(el('Check')); await enabled(el('Apply'));
    assert.ok(await captureCount() > count); return evaluate("document.querySelector('#sceneCompositionPlacementSource').textContent"); };
  const cancel = async () => { await enabled(el('Cancel')); await click(el('Cancel')); await wait(() => evaluate("!document.querySelector('#sceneCompositionPlacementDialog').open"), 'cancel placement'); };
  const apply = async () => { await enabled(el('Apply')); await click(el('Apply')); await wait(() => evaluate("!document.querySelector('#sceneCompositionPlacementDialog').open && !document.querySelector('#projectBuildDialog').open && document.activeElement.id==='docSourceEditor'"), 'placement applied to source'); };
  const unchanged = async () => { assert.deepEqual(await sourceTree(root), initial); assert.equal(await readScene(), originalSource); };
  const idsOf = payload => ({ actors: payload.actors.map(a => a.instanceId), groups: payload.sceneStructure.groups.map(g => g.groupId) });
  const identities = idsOf(saved);
  await openPreview(); await refreshSaved(); await placementOpen();
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(el('X'))}).value`), '360');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(el('Y'))}).value`), '80');
  assert.deepEqual(await evaluate("[...document.querySelector('#sceneCompositionPlacementTargets').children].map(n=>n.dataset.instanceId)"), instanceIds.slice(2));
  assert.deepEqual(await evaluate("[...document.querySelector('#sceneCompositionPlacementGroups').children].map(n=>n.dataset.groupId)"), groupIds.slice(2));
  await cancel(); await unchanged(); report.steps.push('Source-bound raw offset and complete actor/group identity list; cancel leaves all author files unchanged.');

  await placementOpen(); await fill(el('X'), '450'); await fill(el('Y'), '90');
  const candidate = await check(), candidatePreview = (await latest()).payload;
  assert.deepEqual(idsOf(candidatePreview), identities);
  assert.deepEqual(candidatePreview.actors.map(a => a.position), [[120,180],[200,180],[550,230],[650,270]]);
  const data = parsed(candidate); assert.deepEqual(data.fragments, declaration.fragments); assert.deepEqual(data.placements[0], declaration.placements[0]);
  assert.deepEqual(data.placements[1], { ...declaration.placements[1], offset: [450,90] });
  assert.ok(candidate.startsWith('\uFEFF')); assert.ok(candidate.includes('\r\n')); await unchanged();
  report.layout = {};
  for (const language of ['zh-CN','en','ja']) {
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage(${JSON.stringify(language)})`);
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await evaluate("document.querySelector('#sceneCompositionPlacementDialog').scrollTop=0"); await delay(180);
    const metrics = await evaluate("(() => { const d=document.querySelector('#sceneCompositionPlacementDialog'), f=d.querySelector('footer'), a=document.querySelector('#sceneCompositionPlacementApply'), r=f.getBoundingClientRect(); return { noHorizontalOverflow:d.scrollWidth<=d.clientWidth+2, actionsVisible:r.top>=0&&r.bottom<=innerHeight+2, approved:!a.disabled, text:d.innerText }; })()");
    assert.ok(metrics.noHorizontalOverflow); assert.ok(metrics.actionsVisible); assert.ok(metrics.approved);
    const expected = { 'zh-CN': '检查放置偏移修改', en: 'Check placement offset changes', ja: '配置オフセットの変更を確認' };
    assert.ok(metrics.text.includes(expected[language]), language + ' visible translation'); report.layout[language] = { noHorizontalOverflow: true, actionsVisible: true, approved: true };
    await screenshot(`placement-narrow-${language}.png`);
  }
  await evaluate("(await import('/web/i18n/index.js')).applyLanguage('zh-CN')"); await call('Emulation.clearDeviceMetricsOverride'); await delay(120); await screenshot('placement-reviewed.png');
  await apply(); await assertDraftInput(candidate); assert.equal((await state()).dirty, true); await unchanged();
  await enabled('#docSaveBtn'); await click('#docSaveBtn'); await wait(async () => await readScene() === candidate, 'ordinary save offset');
  const afterFirst = await sourceTree(root); const changed = Object.keys(afterFirst).filter(key => afterFirst[key] !== initial[key]); assert.deepEqual(changed, [scene.sourcePath]);
  assert.equal((await state()).dirty, false); report.steps.push('SET moves all placement actors after local overrides, preserves unrelated placement/templates/UUIDs, reviews three narrow locales, applies memory then saves only recipe.');

  await openPreview(); const savedCandidate = (await refreshSaved()).payload; assert.deepEqual(idsOf(savedCandidate), identities);
  await placementOpen(); await click(el('Reset')); assert.equal(await evaluate(`document.querySelector(${JSON.stringify(el('X'))}).value`), '450');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(el('X'))}).disabled`), true);
  const resetCandidate = await check(), resetPreview = (await latest()).payload;
  assert.equal(Object.hasOwn(parsed(resetCandidate).placements[1], 'offset'), false);
  assert.deepEqual(resetPreview.actors.map(a=>a.position), [[120,180],[200,180],[100,140],[200,180]]); assert.deepEqual(idsOf(resetPreview), identities);
  assert.deepEqual(parsed(resetCandidate).placements[1].overrides, declaration.placements[1].overrides);
  await apply(); assert.equal(await readScene(), candidate); await enabled('#docSaveBtn'); await click('#docSaveBtn'); await wait(async () => await readScene() === resetCandidate, 'ordinary save restoration');
  report.steps.push('DELETE restores missing default [0,0], keeps local overrides and all identities, and changes disk only through ordinary Save.');

  await openPreview(); await refreshSaved(); await placementOpen();
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(el('X'))}).value`), ''); assert.equal(await evaluate(`document.querySelector(${JSON.stringify(el('Reset'))}).disabled`), true);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(el('Check'))}).disabled`), true);
  await fill(el('X'), '0'); await fill(el('Y'), '0'); const zeroCandidate = await check(), zeroPreview = (await latest()).payload;
  assert.deepEqual(parsed(zeroCandidate).placements[1].offset, [0,0]); assert.deepEqual(zeroPreview.actors.map(a=>a.position), resetPreview.actors.map(a=>a.position));
  await apply(); assert.equal(await readScene(), resetCandidate); await enabled('#docSaveBtn'); await click('#docSaveBtn'); await wait(async () => await readScene() === zeroCandidate, 'explicit zero declaration save');
  await openPreview(); await refreshSaved(); await placementOpen(); await click(el('Reset')); const removedZero = await check();
  assert.equal(Object.hasOwn(parsed(removedZero).placements[1], 'offset'), false); await cancel(); assert.equal(await readScene(), zeroCandidate);
  report.steps.push('Absent offset is not silently inserted; explicit zero SET and explicit zero DELETE are distinct author changes even when all scene positions stay equal.');

  await placementOpen(); await fill(el('X'), '100000'); await fill(el('Y'), '0'); await click(el('Check'));
  await wait(() => evaluate("document.querySelector('#sceneCompositionPlacementStatus').textContent.includes('有误') && document.querySelector('#sceneCompositionPlacementApply').disabled"), 'expanded coordinate range rejects full placement');
  assert.equal(await readScene(), zeroCandidate);
  await fill(el('X'), '20'); await fill(el('Y'), '30'); await check();
  await evaluate("document.querySelector('#sceneCompositionPlacementX').value='21'"); await click(el('Apply'));
  assert.equal(await evaluate("document.querySelector('#sceneCompositionPlacementDialog').open && document.querySelector('#sceneCompositionPlacementApply').disabled"), true);
  await fill(el('X'), '20'); const finalCandidate = await check();
  const external = zeroCandidate.replace('Two parties', 'External author edit'); await fs.writeFile(path.join(root, scene.sourcePath), external);
  await apply(); await assertDraftInput(finalCandidate); await enabled('#docSaveBtn'); await click('#docSaveBtn');
  await wait(() => evaluate("!document.querySelector('#docSaveConflictDialog').classList.contains('is-hidden')"), 'normal save external conflict');
  assert.equal(await readScene(), external); await assertDraftInput(finalCandidate); await click('#docSaveConflictCancelBtn');
  assert.deepEqual((await sourceTree(root)), { ...initial, [scene.sourcePath]: buildHash(Buffer.from(external)) });
  assert.equal((await buildState()).job, null); assert.equal(report.svgRequests.length, 0); assert.equal(report.errors.length, 0);
  report.steps.push('Expanded out-of-range coordinates and silent unreviewed edits fail closed; normal Save detects external writes and retains both disk and local draft.');
  report.created = { recipeId: scene.objectId, projectionId: projection.objectId, instanceIds, groupIds, images: images.map(a => a.id) };
  report.authorFiles = { before: initial, after: await sourceTree(root) }; report.captures = await evaluate('window.__sceneCaptures');
  report.normalSave = { sourceSha256: buildHash(zeroCandidate), onlyChangedFile: scene.sourcePath, externalConflictPreserved: true };
  assert.equal(await evaluate('Boolean(window.__sceneSvgExecuted)'), false);
  report.ok = true;
} catch(error) { report.ok=false; report.failure=error.stack||String(error); process.exitCode=1; try { await captureFailure?.(); } catch(captureError) { report.captureFailure=captureError.message; } }
finally { socket?.close(); for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch(error) { report.ok=false; report.errors.push({cleanup:error.message}); process.exitCode=1; }
  report.finishedAt=new Date().toISOString(); await fs.writeFile(path.join(output,'browser.json'),json(report)); console.log(JSON.stringify({ok:report.ok,steps:report.steps,limitations:report.limitations,failure:report.failure,output},null,2)); }
