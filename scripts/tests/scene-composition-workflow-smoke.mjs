// Recipe creation/editing and selective migration through the existing UI.
// Real Chromium + HTTP services; disposable projects only.
// Run: node scripts/tests/scene-composition-workflow-smoke.mjs [chromium-executable]
// Use VIENTO_COMPOSITION_SMOKE_OUTPUT for a fresh evidence directory on reruns.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, write, serve, node } from './helpers.mjs';
import { registerWorkspace, readRegistry, writeJson } from '../lib/workspace.mjs';
import { PROJECT_DEFAULTS } from '../lib/project-layout.mjs';

const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const output = path.resolve(process.env.VIENTO_COMPOSITION_SMOKE_OUTPUT || 'docs/test-results/scene-composition-workflow/browser');
try { await fs.access(path.join(output, 'browser.json')); throw new Error('Refusing to overwrite an existing browser report; choose a new VIENTO_COMPOSITION_SMOKE_OUTPUT.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.mkdir(output, { recursive: true });
const report = { browser: 'Chromium', steps: [], errors: [] };
let socket, captureFailure;
try {
  const source = await fixture(t), target = await fixture(t);
  for (const root of [source, target]) {
    await write(root, 'workspace.json', JSON.stringify({ format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Scene recipe workflow 场景配方实测', createdAt: 0,
      paths: PROJECT_DEFAULTS.paths, assetStores: PROJECT_DEFAULTS.assetStores, documentTypes: PROJECT_DEFAULTS.documentTypes }));
    await fs.mkdir(path.join(root, 'documents'), { recursive: true });
    for (const [name, content] of Object.entries(PROJECT_DEFAULTS.templates)) await write(root, `templates/${name}`, content);
  }
  await write(source, 'documents/characters/角色.md', '# 星野\n\n姓名：星野\n');
  await write(source, 'documents/stories/背景.md', '# 风之旅途\n\n原有大纲保持不变。\n');
  await write(source, 'assets/portrait.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="#8bd8bc"/></svg>');
  await write(source, 'assets/unused.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><circle cx="30" cy="30" r="25" fill="#f1c46e"/></svg>');
  await registerWorkspace(source); await registerWorkspace(target);
  const registry = await readRegistry(source), hero = registry.documents.find(item => item.sourcePath.includes('characters/'));
  const story = registry.documents.find(item => item.sourcePath.includes('stories/')), asset = registry.assets.find(item => item.location.path === 'portrait.svg');
  const unusedAsset = registry.assets.find(item => item.location.path === 'unused.svg');
  const recipe = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url)));
  for (const actor of recipe.fragments[0].actors) { actor.objectId = hero.id; actor.imageResourceId = asset.id; }
  const unusedActor = { ...recipe.fragments[0].actors[1], key: 'waiting', imageResourceId: unusedAsset.id }; delete unusedActor.groupKey;
  recipe.fragments.push({ fragmentId: 'not-placed', groups: [], actors: [unusedActor] });
  const recipePath = 'documents/scenes/workflow-recipe.json';
  const content = JSON.stringify(recipe, null, 2) + '\n';
  story.relations = [{ kind: 'part-of', targetId: hero.id, slot: '背景故事' }];
  await writeJson(path.join(source, `metadata/documents/${story.id}.json`), story);
  await write(source, hero.sourcePath, `# 星野\n\n姓名：星野\n\n![立绘](asset:${asset.id})\n`);
  await node(source, ['scripts/ops/rebuild.mjs']); await node(target, ['scripts/ops/rebuild.mjs']);
  const sourceUrl = await serve(t, source), targetUrl = await serve(t, target);
  const profile = await fs.mkdtemp('/tmp/viento-composition-chrome-'); cleanups.push(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const downloads = path.join(profile, 'downloads'); await fs.mkdir(downloads);
  const chrome = spawn(process.argv[2] || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
  cleanups.push(async () => { if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; } });
  async function wait(check, label) { for (let i = 0; i < 300; i += 1) { if (await check()) return; await delay(100); } throw new Error(`Timed out: ${label}`); }
  let port;
  await wait(async () => { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return !!port; } catch { return false; } }, 'Chrome');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  let sequence = 0; const pending = new Map();
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (value.id) { const request = pending.get(value.id); pending.delete(value.id); value.error ? request?.reject(new Error(value.error.message)) : request?.resolve(value.result); }
    else if (value.method === 'Runtime.exceptionThrown') report.errors.push(value.params.exceptionDetails);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  await call('Runtime.enable'); await call('Page.enable');
  report.browser = (await call('Browser.getVersion')).product;
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  async function openEditor(url) {
    await call('Page.navigate', { url: `${url}/web/?mode=edit` });
    await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor backend');
  }
  async function openExport() {
    await evaluate(`document.querySelector('#docExportBtn').click()`);
    await wait(() => evaluate(`document.querySelector('#docExportDialog').open`), 'export dialog');
    await evaluate(`document.querySelector('input[name=exportKind][value=resources]').click()`);
    await wait(() => evaluate(`document.querySelector('#docExportOptions').disabled === false && !document.querySelector('#docPackageMessage').textContent`), 'resource catalogue');
  }
  const screenshot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(image.data, 'base64')); };
  captureFailure = async () => {
    report.editorState = await evaluate(`({ state: ((s) => Object.fromEntries(['isCreating', 'isSaving', 'isRebuilding', 'isLoadingTemplate', 'isLoadingSource', 'editHasUnsavedChanges', 'activeEditSource', 'activeCreateType'].map(key => [key, s[key]])))((await import('/web/modules/app-state.js')).appState),
      status: document.querySelector('#docEditStatus')?.textContent, path: document.querySelector('#docCreatePathInput')?.value,
      saveDisabled: document.querySelector('#docSaveBtn')?.disabled, text: document.querySelector('#docSourceEditor')?.value })`);
    await screenshot('failure.png');
  };
  await openEditor(sourceUrl);
  await evaluate(`document.querySelector('#docCreateBtn').click()`);
  await wait(() => evaluate(`((s) => s.isCreating && !s.isLoadingTemplate)((await import('/web/modules/app-state.js')).appState)`), 'new ordinary document');
  await evaluate(`((element) => { element.value = 'document'; element.dispatchEvent(new Event('change', { bubbles: true })); })(document.querySelector('#docCreateTypeSelect'))`);
  await wait(() => evaluate(`((s) => s.activeCreateType === 'document' && !s.isLoadingTemplate)((await import('/web/modules/app-state.js')).appState)`), 'ordinary document template');
  async function fillInput(selector, value) {
    await evaluate(`((element) => { element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('input', { bubbles: true })); })(document.querySelector(${JSON.stringify(selector)}))`);
  }
  await fillInput('#docCreatePathInput', recipePath);
  await fillInput('#docSourceEditor', content);
  await wait(() => evaluate(`!document.querySelector('#docSaveBtn').disabled`), 'create save button');
  await evaluate(`document.querySelector('#docSaveBtn').click()`);
  await wait(() => evaluate(`((s) => !s.isCreating && !s.isSaving && !s.isRebuilding && !s.editHasUnsavedChanges && s.activeEditSource.replace(/^docs-standard\\//, '') === ${JSON.stringify(recipePath)})((await import('/web/modules/app-state.js')).appState)`), 'create registered JSON');
  const record = (await readRegistry(source)).documents.find(item => item.sourcePath === recipePath);
  assert.ok(record, 'ordinary UI create must register a UUID');
  const metadataPath = `metadata/documents/${record.id}.json`, metadata = await fs.readFile(path.join(source, metadataPath));
  assert.deepEqual(record.relations, []); assert.deepEqual(record.assetBindings, []);
  assert.equal(await fs.readFile(path.join(source, recipePath), 'utf8'), content);
  const edited = content.replace('Two parties / 两支队伍 / 二つの隊', 'Edited recipe / 编辑后的配方 / 編集したレシピ');
  await fillInput('#docSourceEditor', edited);
  await evaluate(`document.querySelector('#docSaveBtn').click()`);
  await wait(() => evaluate(`((s) => !s.isSaving && !s.editHasUnsavedChanges)((await import('/web/modules/app-state.js')).appState)`), 'save ordinary recipe source');
  assert.equal(await fs.readFile(path.join(source, recipePath), 'utf8'), edited);
  assert.deepEqual(await fs.readFile(path.join(source, metadataPath)), metadata);
  assert.equal(await evaluate(`document.querySelector('#runtimeErrorPanel').hidden`), true, 'ordinary create/edit must not produce UI errors');
  await screenshot('recipe-editor-zh.png');
  report.steps.push('Create registered recipe JSON and edit its source with existing editor controls; preserve UUID and authored metadata');
  await openExport();
  await evaluate(`(document.querySelector('#docPackageClear').click(), document.querySelector('#docPackageEntries input[value="${record.id}"]').click())`);
  assert.equal(await evaluate(`document.querySelectorAll('#docPackageEntries input:checked').length`), 5);
  await screenshot('recipe-selection-zh.png');
  report.steps.push('Select recipe; definition, owned story, placed image and image from an unused fragment are automatically included');
  await evaluate(`document.querySelector('#docExportStartBtn').click()`);
  await wait(() => evaluate(`!document.querySelector('#docExportDownload').hidden && !document.querySelector('#docExportDownload').disabled`), 'prepared ZIP');
  await evaluate(`document.querySelector('#docExportDownload').click()`);
  let downloaded;
  await wait(async () => { downloaded = (await fs.readdir(downloads)).find(file => file.endsWith('.viento-package.zip')); return !!downloaded; }, 'browser download');
  const packageFile = path.join(downloads, downloaded), bytes = await fs.readFile(packageFile);
  report.package = { name: downloaded, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  report.steps.push('Download resource ZIP through the browser');
  await openEditor(targetUrl); await openExport();
  await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('ja')`);
  const doc = await call('DOM.getDocument'); const input = await call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#docPackageFile' });
  await call('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [packageFile] });
  await wait(() => evaluate(`!document.querySelector('#docPackageImportPreview').hidden && !document.querySelector('#docPackageImportApply').disabled`), 'import preview');
  await screenshot('recipe-import-ja.png'); report.steps.push('Preview verified package in another empty project in Japanese');
  await evaluate(`document.querySelector('#docPackageImportApply').click()`);
  await wait(() => evaluate(`document.querySelector('#docPackageMessage').textContent.includes('インポートしました') && !document.querySelector('#docExportOptions').disabled`), 'import and rebuild');
  const imported = await readRegistry(target);
  assert.deepEqual(new Set(imported.documents.map(item => item.id)), new Set([hero.id, story.id, record.id]));
  assert.deepEqual(new Set(imported.assets.map(item => item.id)), new Set([asset.id, unusedAsset.id]));
  for (const document of [hero, story, record]) assert.deepEqual(await fs.readFile(path.join(target, document.sourcePath)), await fs.readFile(path.join(source, document.sourcePath)));
  assert.deepEqual(await fs.readFile(path.join(target, metadataPath)), metadata);
  for (const resource of [asset, unusedAsset]) assert.deepEqual(await fs.readFile(path.join(target, `assets/${resource.location.path}`)), await fs.readFile(path.join(source, `assets/${resource.location.path}`)));
  const index = JSON.parse(await fs.readFile(path.join(target, '.viento/cache/indexes/documents.json'), 'utf8'));
  assert.ok(index.docs.some(doc => doc.id === record.id));
  assert.equal(await evaluate(`document.querySelector('#runtimeErrorPanel').hidden`), true, 'import must not produce UI errors');
  report.steps.push('Confirm import; verify recipe/definition/story/image bytes, UUIDs, unchanged metadata and rebuilt editor index');
  assert.deepEqual(report.errors, []); report.ok = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1;
  try { await captureFailure?.(); } catch (diagnosticError) { report.diagnosticError = diagnosticError.message; }
}
finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.errors.push({ cleanup: error.message }); report.ok = false; process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'browser.json'), `${JSON.stringify(report, null, 2)}\n`);
}
