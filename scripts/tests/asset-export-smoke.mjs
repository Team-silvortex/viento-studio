// Real Chromium + real HTTP services, using disposable projects only.
// Run: node scripts/tests/asset-export-smoke.mjs [chromium-executable]
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, write, serve, node } from './helpers.mjs';
import { registerWorkspace, readRegistry } from '../lib/workspace.mjs';
import { PROJECT_DEFAULTS } from '../lib/project-layout.mjs';

const cleanups = [], t = { after: cleanup => cleanups.push(cleanup) };
const output = path.resolve('docs/test-results/asset-export'); await fs.mkdir(output, { recursive: true });
const report = { browser: 'Chromium', steps: [], files: [], errors: [] };
let socket;
try {
  const root = await fixture(t);
  await write(root, 'workspace.json', JSON.stringify({ format: 'viento-workspace', version: 3, id: randomUUID(), name: '单素材导出实测', createdAt: 0,
    paths: PROJECT_DEFAULTS.paths, assetStores: PROJECT_DEFAULTS.assetStores, documentTypes: PROJECT_DEFAULTS.documentTypes }));
  const original = '# 星野\n\n姓名：星野\n';
  await write(root, 'documents/characters/角色.md', original);
  const originals = new Map([
    ['立绘 #100%.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64')],
    ['片段%20空 格.mp4', Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex')],
    ['テーマ曲.wav', Buffer.from('524946462600000057415645666d74201000000001000100401f0000803e00000200100064617461020000000000', 'hex')],
  ]);
  for (const [name, bytes] of originals) await write(root, `assets/${name}`, bytes);
  await registerWorkspace(root); await node(root, ['scripts/ops/rebuild.mjs']);
  const registry = await readRegistry(root), base = await serve(t, root);
  const profile = await fs.mkdtemp('/tmp/viento-asset-chrome-'); cleanups.push(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
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
  const screenshot = async name => { const image = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(output, name), Buffer.from(image.data, 'base64')); };
  await call('Page.navigate', { url: `${base}/web/?mode=edit` });
  await wait(() => evaluate(`document.readyState === 'complete' && (await import('/web/modules/app-state.js')).appState.editBackendAvailable`), 'editor backend');
  await evaluate(`document.querySelector('#docExportBtn').click()`);
  await evaluate(`document.querySelector('input[name=exportKind][value=resources]').click()`);
  await wait(() => evaluate(`!document.querySelector('#docExportOptions').disabled && document.querySelectorAll('#docPackageEntries .doc-asset-export').length === 3`), 'resource list');
  const image = registry.assets.find(a => a.kind === 'image'), audio = registry.assets.find(a => a.kind === 'audio');
  await evaluate(`(document.querySelector('#docPackageClear').click(), document.querySelector('#docPackageEntries input[value="${audio.id}"]').click())`);
  await screenshot('resource-list-zh.png');
  const download = async asset => {
    await wait(() => evaluate(`!document.querySelector('#docExportDownload').hidden && !document.querySelector('#docExportDownload').disabled`), 'prepared original');
    await evaluate(`document.querySelector('#docExportDownload').click()`);
    const expected = originals.get(asset.location.path);
    const downloaded = path.join(downloads, asset.location.path);
    await wait(async () => { try { return (await fs.stat(downloaded)).size === expected.length; } catch { return false; } }, 'downloaded original');
    const bytes = await fs.readFile(downloaded); assert.deepEqual(bytes, expected);
    report.files.push({ name: asset.location.path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    await fs.rm(downloaded);
  };
  await evaluate(`document.querySelector('#docPackageEntries .doc-asset-export[data-asset-id="${image.id}"]').click()`);
  await download(image);
  await evaluate(`document.querySelector('#docExportBackBtn').click()`);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#docPackageEntries input:checked'), node => node.value)`), [audio.id]);
  await evaluate(`document.querySelector('#docExportCloseBtn').click()`);
  report.steps.push('Export one image from the package list; return with selection unchanged');
  await evaluate(`document.querySelector('#docEditBtn').click()`);
  await wait(() => evaluate(`(await import('/web/modules/app-state.js')).appState.isEditing && !document.querySelector('#docSourceEditor').readOnly`), 'editing source');
  await evaluate(`document.querySelector('#docEditSourceModeBtn').click()`);
  const draft = original + '\n未保存的草稿 / unsaved / 下書き';
  await evaluate(`(() => { const input = document.querySelector('#docSourceEditor'); input.value = ${JSON.stringify(draft)}; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); input.setSelectionRange(5, 5); })()`);
  await evaluate(`document.querySelector('#docMediaInsertBtn').click()`);
  await wait(() => evaluate(`document.querySelectorAll('#docMediaList .doc-asset-export').length === 3`), 'media cards');
  await screenshot('media-picker-zh.png');
  for (const [i, asset] of registry.assets.entries()) {
    const language = ['zh-CN', 'en', 'ja'][i];
    await evaluate(`(await import('/web/i18n/index.js')).applyLanguage('${language}')`);
    await evaluate(`document.querySelector('#docMediaList .doc-asset-export[data-asset-id="${asset.id}"]').click()`);
    await download(asset);
    if (language === 'en') await screenshot('original-export-en.png');
    await evaluate(`document.querySelector('#docExportCloseBtn').click()`);
    assert.equal(await evaluate(`document.querySelector('#docMediaDialog').open`), true);
    assert.deepEqual(await evaluate(`({ value: document.querySelector('#docSourceEditor').value, caret: document.querySelector('#docSourceEditor').selectionStart, dirty: (await import('/web/modules/app-state.js')).appState.editHasUnsavedChanges })`), { value: draft, caret: 5, dirty: true });
  }
  report.steps.push('Export image, video and audio from media cards in Chinese/English/Japanese; compare downloaded filenames and every byte');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await screenshot('media-picker-narrow-ja.png');
  assert.equal(await evaluate(`document.querySelector('#docMediaDialog').scrollWidth <= document.querySelector('#docMediaDialog').clientWidth`), true);
  await evaluate(`document.querySelector('#docMediaList .doc-media-choice[data-asset-id="${image.id}"]').click()`);
  await wait(() => evaluate(`!document.querySelector('#docMediaDialog').open`), 'insert after export');
  assert.ok((await evaluate(`document.querySelector('#docSourceEditor').value`)).includes(`asset:${image.id}`));
  assert.equal(await fs.readFile(path.join(root, 'documents/characters/角色.md'), 'utf8'), original);
  for (const [name, bytes] of originals) assert.deepEqual(await fs.readFile(path.join(root, 'assets', name)), bytes);
  report.steps.push('Keep draft text and caret across exports; verify narrow layout and insert at the original caret afterwards; source files unchanged');
  assert.deepEqual(report.errors, []); report.ok = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) { report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1; }
finally {
  socket?.close();
  for (const cleanup of cleanups.reverse()) try { await cleanup(); } catch (error) { report.errors.push({ cleanup: error.message }); report.ok = false; process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'browser.json'), `${JSON.stringify(report, null, 2)}\n`);
}
