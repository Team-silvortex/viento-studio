// Real HTTP editor and Studio composition root in a disposable drama workspace.
// VIENTO_STUDIO_SYSTEM_OUTPUT must be a new empty evidence directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { serve } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { registerWorkspace } from '../lib/workspace.mjs';
import { importMediaAsset } from '../lib/media-assets.mjs';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.env.VIENTO_STUDIO_SYSTEM_OUTPUT || path.join(os.tmpdir(), `viento-studio-system-${Date.now()}`));
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Choose an empty VIENTO_STUDIO_SYSTEM_OUTPUT; previous evidence remains immutable.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), json = value => JSON.stringify(value, null, 2) + '\n';
const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const report = { startedAt: new Date().toISOString(), browser: '', steps: [], errors: [], modules: [], screenshots: [], limitations: [
  'Real Chrome and HTTP editor only; no installed desktop window, Android device, 3D renderer or engine execution claim.',
  'The no-export phase replaces only web/app.js boot configuration through Chrome interception; all runtime, module controllers, HTTP media and source Save remain real.',
  'Startup assembly is boot-only. Build/preview and World remain their existing aggregate view adapters; capability-plan activity grants no author write or tool permission.',
] };
report.node = { version: process.version, sha256: hash(await fs.readFile(process.execPath)) };
const reviewed = ['scripts/tests/studio-system-smoke.mjs', 'engine/studio-modules.mjs', 'engine/project.mjs', 'web/modules/app-studio-system.js',
  'web/modules/app-runtime.js', 'web/app.js', 'web/modules/app-media-editor.js', 'web/modules/app-export.js', 'web/i18n/settings.js'];
report.sources = Object.fromEntries(await Promise.all(reviewed.map(async name => [name, hash(await fs.readFile(path.join(appRoot, name)))])));
let socket, captureFailure;
const wait = async (check, label) => { for (let attempt = 0; attempt < 450; attempt++) { if (await check()) return; await delay(100); } throw new Error(`Timed out: ${label}`); };
try {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-studio-system-browser-'));
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const root = path.join(temporary, 'workspace'), template = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.oc-drama');
  assert.ok(template);
  const write = async (relative, content) => { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); };
  for (const name of ['documents', 'templates', 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(root, name), { recursive: true });
  const makeProfile = schemaVersion => ({ format: 'viento-studio-profile', schemaVersion,
    required: [{ capability: 'document.edit', apiVersion: 1 }, { capability: 'scene.representation.scene4d', apiVersion: 1 }],
    optional: [{ capability: 'resource.reference', apiVersion: 1 }] });
  let manifest = { format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Independent drama Studio', createdAt: 0,
    ...WORKSPACE_LAYOUT, documentTypes: template.documentTypes, projectTemplate: { packageId: template.packageId, version: template.version }, studioProfile: makeProfile(1) };
  await write('workspace.json', json(manifest));
  for (const [name, content] of Object.entries(template.templates)) await write(`templates/${name}`, content);
  await registerWorkspace(root);
  const execute = createWorldCommandService(root), world = await readWorldProjection(root);
  const sourcePath = 'documents/scenes/dialogue.md', original = '\ufeff# 第一场 / First scene\r\n\r\n（灯光亮起）\r\n\r\n人物甲：你是谁？\r\n\r\n人物乙：旅人。\r\n\r\n人物甲：我也是。\r\n';
  const objectId = randomUUID();
  await execute({ command: 'object.create', mode: 'apply', worldId: world.world.id, baseRevision: world.world.revision,
    actorRef: { kind: 'tool', id: 'studio-system-smoke' }, objectId, documentType: 'scene', sourcePath, content: original });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i/7sAAAAASUVORK5CYII=', 'base64');
  const asset = (await importMediaAsset(root, Readable.from([png]), 'Drama portrait.png')).asset;
  const env = { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root, XDG_CACHE_HOME: path.join(temporary, 'cache') };
  for (const key of ['VIENTO_GODOT_BIN', 'VIENTO_BEVY_BIN', 'VIENTO_EXECUTION_BACKEND', 'VIENTO_SESSION_TOKEN', 'VIENTO_PREFERENCES_PATH']) delete env[key];
  const rebuild = () => runCommand(process.execPath, [path.join(appRoot, 'scripts/ops/rebuild.mjs')], { cwd: appRoot, env });
  await rebuild(); let base = await serve(t, appRoot, env);
  const readSource = () => fs.readFile(path.join(root, sourcePath), 'utf8');
  const documentInventory = async () => (await fs.readdir(path.join(root, 'documents'), { recursive: true })).sort();
  const originalInventory = await documentInventory();
  const browserProfile = path.join(temporary, 'chrome'); await fs.mkdir(browserProfile);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${browserProfile}`, '--remote-debugging-port=0', '--window-size=1440,1080', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; } });
  let port; await wait(async () => { try { port = (await fs.readFile(path.join(browserProfile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return Boolean(port); } catch { return false; } }, 'Chrome startup');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  const pending = new Map(); let sequence = 0, bootOverride = false;
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  socket.addEventListener('message', event => { const value = JSON.parse(event.data);
    if (value.id) { const request = pending.get(value.id); pending.delete(value.id); value.error ? request?.reject(new Error(value.error.message)) : request?.resolve(value.result); }
    else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
    else if (value.method === 'Network.requestWillBeSent' && value.params.request.url.includes('/web/modules/')) report.modules.push(new URL(value.params.request.url).pathname);
    else if (value.method === 'Fetch.requestPaused') {
      const entry = "import { initApp } from './modules/app-runtime.js'; await initApp({ features: { export: false } });";
      void call(bootOverride ? 'Fetch.fulfillRequest' : 'Fetch.continueRequest', bootOverride
        ? { requestId: value.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }], body: Buffer.from(entry).toString('base64') }
        : { requestId: value.params.requestId });
    }
  });
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const input = (selector, value, event = 'input') => evaluate(`(() => { const target = document.querySelector(${JSON.stringify(selector)}); target.value = ${JSON.stringify(value)}; target.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`);
  const enabled = selector => wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === false`), `${selector} enabled`);
  const state = expression => evaluate(`(() => import('/web/modules/app-state.js').then(({ appState }) => (${expression})))()`);
  const snapshot = () => evaluate("(await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot()");
  const screenshot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(image.data, 'base64')); report.screenshots.push(name); };
  captureFailure = async () => { await screenshot('failure.png'); report.pageFailure = await evaluate("({ text: document.body.innerText, source: document.querySelector('#docSourceEditor')?.value, snapshot: (await import('/web/modules/app-runtime.js')).getStudioSystemSnapshot() })"); };
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable'); await call('Network.setCacheDisabled', { cacheDisabled: true }); report.browser = (await call('Browser.getVersion')).product;
  const navigate = async phase => { await call('Page.navigate', { url: `${base}/web/?mode=edit&system=${phase}` });
    await wait(() => state(`appState.editBackendAvailable && appState.docs.some(doc => doc.id === ${JSON.stringify(objectId)} && typeof doc._sourceCachedText === 'string')`), 'actual runtime and drama source'); };
  const startEdit = async () => { await enabled('#docEditBtn'); await click('#docEditBtn');
    await wait(() => state('appState.isEditing'), 'ordinary source edit'); await click('#docEditSourceModeBtn');
    await wait(() => evaluate("document.querySelector('#docSourceEditor').checkVisibility() && !document.querySelector('#docSourceEditor').disabled"), 'source input'); };
  const assertProse = async () => { const doc = await state(`(() => { const doc=appState.docs.find(item=>item.id===${JSON.stringify(objectId)}); return {documentType:doc.category,fields:Object.keys(doc.fields),raw:doc._sourceCachedText}; })()`);
    assert.equal(doc.documentType, 'scene'); assert.deepEqual(doc.fields, ['_header']);
    for (const line of ['（灯光亮起）', '人物甲：你是谁？', '人物乙：旅人。', '人物甲：我也是。']) assert.ok(doc.raw.includes(line)); };
  await navigate('missing-3d'); const first = await snapshot(); report.initialSnapshot = first;
  assert.ok(report.modules.includes('/web/modules/app-studio-system.js')); assert.equal(first.lifecycle, 'boot-only'); assert.equal(first.hotReload, false);
  assert.equal(first.initializedModules.length, 12); assert.equal(await evaluate("document.querySelectorAll('#settingsDialog').length"), 1);
  assert.equal(first.plan.satisfied, false); assert.equal(first.plan.requests.find(request => request.capability === 'scene.representation.scene4d').status, 'missing');
  assert.equal(first.plan.requests.find(request => request.capability === 'document.edit').status, 'supported'); assert.equal(first.plan.modules.every(module => module.active), true);
  assert.deepEqual(await state('appState.workspace.studioProfile'), manifest.studioProfile); await assertProse();
  assert.deepEqual(await documentInventory(), originalInventory);
  report.steps.push('Actual runtime loads one Studio root with eleven module records; a drama scene stays prose and a required missing future representation capability leaves the base editor assembled and editable.');

  for (const [button, dialog, close] of [['#projectSettingsBtn', '#projectSettingsDialog', '#projectSettingsClose'],
    ['#worldBrowserBtn', '#worldBrowserDialog', '#worldClose'], ['#projectBuildBtn', '#projectBuildDialog', '#projectBuildClose'],
    ['#docExportBtn', '#docExportDialog', '#docExportCloseBtn']]) {
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(button)}).hidden`), false); await click(button);
    await wait(() => evaluate(`document.querySelector(${JSON.stringify(dialog)}).open`), `${dialog} mounted`); await enabled(close); await click(close);
    await wait(() => evaluate(`!document.querySelector(${JSON.stringify(dialog)}).open`), `${dialog} closed`);
  }
  const buildStatus = await fetch(`${base}/api/project-build`).then(response => response.json());
  assert.equal((buildStatus.data || buildStatus).job, null);
  report.steps.push('Project types/templates, World, build and export dialogs open through the real system-mounted controllers without starting an engine.');

  await startEdit(); await evaluate("document.querySelector('#docSourceEditor').focus()"); await click('#docMediaInsertBtn');
  await wait(() => evaluate(`document.querySelector('#docMediaDialog').open && document.querySelector('#docMediaList .doc-asset-export[data-asset-id="${asset.id}"]')`), 'media optional export provider');
  await click(`#docMediaList .doc-asset-export[data-asset-id="${asset.id}"]`);
  await wait(() => evaluate("document.querySelector('#docExportDialog').open && !document.querySelector('#docExportDownload').hidden"), 'real asset export job');
  assert.equal(await readSource(), original); await enabled('#docExportCloseBtn'); await click('#docExportCloseBtn'); await enabled('#docMediaCloseBtn'); await click('#docMediaCloseBtn');
  report.steps.push('The real media view obtains the optional export provider and prepares an original image export through HTTP while author source remains unchanged.');
  const marker = '\n人物乙：新的能力声明不会替我改写剧本。\n', edited = (await evaluate("document.querySelector('#docSourceEditor').value")) + marker;
  await input('#docSourceEditor', edited); await enabled('#docSaveBtn'); await click('#docSaveBtn');
  const expected = original + marker.replaceAll('\n', '\r\n');
  await wait(async () => await readSource() === expected, 'ordinary prose Save exact bytes'); assert.equal(await state('appState.editHasUnsavedChanges'), false);
  assert.deepEqual(await documentInventory(), originalInventory);
  report.steps.push('Ordinary Save persists only the explicit drama draft, retaining BOM, CRLF, repeated speakers, and document inventory; no scene representation is generated automatically.');

  manifest = { ...manifest, studioProfile: makeProfile(2) }; await write('workspace.json', json(manifest)); await rebuild(); base = await serve(t, appRoot, env);
  await navigate('future-profile'); const future = await snapshot(); report.futureSnapshot = future;
  assert.equal(future.plan.diagnostics[0].code, 'studio_profile_invalid'); assert.equal(future.plan.modules.every(module => module.active), true);
  assert.deepEqual(await state('appState.workspace.studioProfile'), manifest.studioProfile); await assertProse(); await startEdit();
  const futureMarker = '\n（此处仍由作者决定。）\n'; await input('#docSourceEditor', (await evaluate("document.querySelector('#docSourceEditor').value")) + futureMarker);
  await enabled('#docSaveBtn'); await click('#docSaveBtn'); const futureExpected = expected + futureMarker.replaceAll('\n', '\r\n');
  await wait(async () => await readSource() === futureExpected, 'future-profile ordinary Save');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'workspace.json'), 'utf8')).studioProfile, manifest.studioProfile);
  assert.deepEqual(await documentInventory(), originalInventory);
  report.steps.push('A future schema is preserved as author data with a local invalid-profile diagnostic; source editing and exact ordinary Save continue without rewriting the manifest or creating a 2D/3D scene.');

  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  for (const language of ['zh-CN', 'en', 'ja']) {
    await click('#settingsBtn'); await wait(() => evaluate("document.querySelector('#settingsDialog').open"), 'settings mounted');
    await input('#languageSelect', language, 'change'); await wait(() => evaluate(`(await import('/web/i18n/index.js')).getLanguage() === ${JSON.stringify(language)} && !document.querySelector('#languageSelect').disabled`), `saved ${language}`);
    assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false); await screenshot(`settings-${language}-390.png`);
    await click('#settingsDialog button[type="submit"]'); await wait(() => evaluate("!document.querySelector('#settingsDialog').open"), 'settings close');
  }
  report.steps.push('The actual settings module switches Chinese, English and Japanese at 390 px; the dialog has no horizontal page overflow and preserves the author profile/draft.');

  bootOverride = true; await call('Fetch.enable', { patterns: [{ urlPattern: '*/web/app.js*', requestStage: 'Request' }] });
  await navigate('export-disabled'); const separated = await snapshot(); report.noExportSnapshot = separated;
  assert.equal(separated.plan.modules.find(module => module.id === 'org.viento.export').active, false);
  assert.equal(separated.plan.capabilities.find(item => item.capability === 'resource.reference').active, true);
  assert.equal(separated.initializedModules.includes('org.viento.export'), false); assert.equal(separated.initializedModules.includes('org.viento.media'), true);
  await startEdit(); await evaluate("(() => { const input=document.querySelector('#docSourceEditor'); input.focus(); input.setSelectionRange(input.value.length,input.value.length); })()");
  await click('#docMediaInsertBtn'); await wait(() => evaluate(`document.querySelector('#docMediaList .doc-media-choice[data-asset-id="${asset.id}"]')`), 'reference picker without export');
  assert.equal(await evaluate("document.querySelectorAll('#docMediaList .doc-asset-export').length"), 0);
  await click(`#docMediaList .doc-media-choice[data-asset-id="${asset.id}"]`);
  await wait(() => evaluate(`!document.querySelector('#docMediaDialog').open && document.querySelector('#docSourceEditor').value.includes(${JSON.stringify(`asset:${asset.id}`)})`), 'real reference insertion without exporter');
  assert.equal(await readSource(), futureExpected); assert.equal(await state('appState.editHasUnsavedChanges'), true);
  await enabled('#docSaveBtn'); await click('#docSaveBtn'); await wait(async () => (await readSource()).includes(`asset:${asset.id}`), 'ordinary media reference Save');
  assert.deepEqual(await documentInventory(), originalInventory); assert.deepEqual(report.errors, []);
  report.steps.push('An explicit export=false boot uses real controllers and HTTP: no media export action is mounted, while selecting an existing image inserts a draft reference and ordinary Save persists it.');
  report.modules = [...new Set(report.modules)].sort(); report.status = 'passed';
} catch (error) {
  await captureFailure?.().catch(() => {}); report.status = 'failed'; report.failure = String(error.stack || error); process.exitCode = 1;
} finally {
  if (socket) socket.close();
  for (const cleanup of cleanups.reverse()) await cleanup();
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(output, 'browser.json'), json(report));
  console.log(json(report));
}
