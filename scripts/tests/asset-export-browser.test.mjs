import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { API_PATHS } from '../lib/doc-api-contract.mjs';
import { MEDIA_MAX_BYTES, mediaKindForName, mediaMarkup } from '../lib/media-format.mjs';
import { applyLanguage, onLanguageChange } from '../../web/i18n/index.js';

const assets = ['image', 'video', 'audio'].map((kind, i) => ({ id: `media-${i}`, category: 'asset', name: `素材 ${i}.` + ['png', 'mp4', 'wav'][i],
  path: `assets/media-${i}`, url: `/asset-files/media-${i}`, size: 123, status: 'available', kind, dependencies: [], children: [], problems: [] }));
const missing = { ...assets[0], id: 'missing', status: 'missing' };
async function ui(t, overrides = {}) {
  const requests = [], checks = [], releases = [], handoffs = [], notices = [], listeners = [];
  const state = { editable: true, path: 'documents/角色.md', title: '角色', dirty: true, creating: false, busy: false };
  const h = await dialogHarness('app-export', {
    API_PATHS, crypto: { randomUUID }, MEDIA_MAX_BYTES, mediaKindForName, mediaMarkup,
    loadResourcePackageCatalog: async () => ({ revision: 'catalogue', entries: [...assets, missing] }),
    requestExport: (payload, signal) => { const task = deferred(); requests.push({ ...task, payload, signal }); return task.promise; },
    checkExport: (id, signal) => { const task = deferred(); checks.push({ ...task, id, signal }); return task.promise; },
    releaseExport: async id => { releases.push(id); },
    loadMediaAssets: async () => ({ assets: [...assets, missing] }),
    onLanguageChange: listener => { const off = onLanguageChange(listener); listeners.push(off); },
    ...overrides,
  });
  t.after(() => { listeners.forEach(off => off()); applyLanguage('zh-CN'); });
  const createElement = h.document.createElement;
  h.document.createElement = tag => {
    const node = createElement(tag);
    if (tag === 'a') node.click = () => handoffs.push({ name: node.download, href: node.href });
    return node;
  };
  const controller = h.runtime.setupExport({ getContext: () => ({ ...state }), setBusy: busy => { state.busy = busy; } });
  const editor = h.element('docSourceEditor'); editor.value = '# 未保存草稿\n前文后文'; editor.selectionStart = editor.selectionEnd = 10; editor.focus();
  const draft = editor.value, caret = editor.selectionStart;
  const media = (await fs.readFile(new URL('../../web/modules/app-media-editor.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '').replaceAll('export ', '');
  vm.runInContext(media, h.runtime);
  h.runtime.setupMediaEditor({ isEditable: () => true, isBusy: () => state.busy,
    getContext: () => ({ input: editor, path: state.path, content: editor.value, start: editor.selectionStart, end: editor.selectionEnd, documentType: 'document' }),
    setBusy: busy => { state.busy = busy; }, exportAsset: controller.exportAsset,
    insertText: (target, text) => target.input.setRangeText(text, target.start, target.end, 'end'),
    changed: () => { state.dirty = true; }, status: text => notices.push(text),
  });
  const findExport = (list, id) => h.element(list).querySelectorAll('.doc-asset-export').find(button => button.dataset.assetId === id);
  async function openMedia() { h.element('docMediaInsertBtn').click(); await flushDialogs(); }
  async function openPackages() {
    h.element('docExportBtn').click();
    const radios = h.element('docExportOptions').querySelectorAll('input[name="exportKind"]');
    for (const radio of radios) radio.checked = radio.value === 'resources';
    radios.find(radio => radio.checked).dispatch('change', { bubbles: true }); await flushDialogs();
  }
  async function ready(asset, id = `job-${asset.id}`) {
    requests.at(-1).resolve({ id, fileName: asset.name, bytes: 123, assetCount: 1, documentCount: 0 }); await flushDialogs();
  }
  return { ...h, controller, state, editor, draft, caret, requests, checks, releases, handoffs, notices, findExport, openMedia, openPackages, ready };
}

test('media cards export image/video/audio independently, preserve unsaved text and allow insertion afterwards', async t => {
  const h = await ui(t); await h.openMedia();
  assert.equal(h.findExport('docMediaList', missing.id).disabled, true);
  for (const asset of assets) {
    const button = h.findExport('docMediaList', asset.id);
    assert.notEqual(button.parentElement.tagName, 'BUTTON');
    button.click(); assert.equal(h.requests.at(-1).payload.kind, 'asset');
    assert.equal(h.requests.at(-1).payload.assetId, asset.id);
    assert.equal(h.element('docExportOptions').hidden, true);
    assert.equal(h.element('docMediaDialog').open, true);
    await h.ready(asset); h.element('docExportDownload').click();
    assert.equal(h.handoffs.length, assets.indexOf(asset));
    h.checks.at(-1).resolve(); await flushDialogs();
    assert.equal(h.handoffs.at(-1).name, asset.name);
    assert.doesNotMatch(h.element('docExportMessage').textContent, /解压|ZIP/);
    h.element('docExportCloseBtn').click(); await flushDialogs();
    assert.equal(h.element('docMediaDialog').open, true);
    assert.equal(h.editor.value, h.draft); assert.equal(h.editor.selectionStart, h.caret);
    assert.equal(h.state.dirty, true); assert.equal(h.state.busy, false);
  }
  const insert = h.element('docMediaList').querySelectorAll('.doc-media-choice').find(button => button.dataset.assetId === assets[0].id);
  insert.click(); await flushDialogs();
  assert.equal(h.editor.value, h.draft.slice(0, h.caret) + `\n\n${mediaMarkup(assets[0])}\n\n` + h.draft.slice(h.caret));
  assert.equal(h.element('docMediaDialog').open, false); assert.deepEqual(h.releases, []);
});

test('per-resource export keeps package selection and returns without toggling checkboxes', async t => {
  const h = await ui(t); h.state.dirty = false; await h.openPackages();
  const checkbox = h.element('docPackageEntries').querySelector('input'); checkbox.checked = true; checkbox.dispatch('change', { bubbles: true });
  const roots = h.element('docPackageEntries').querySelectorAll('input:checked').map(input => input.value);
  h.findExport('docPackageEntries', assets[2].id).click(); await h.ready(assets[2]);
  assert.equal(h.element('docExportBackBtn').hidden, false);
  h.element('docExportBackBtn').click();
  assert.equal(h.element('docExportOptions').hidden, false);
  assert.deepEqual(h.element('docPackageEntries').querySelectorAll('input:checked').map(input => input.value), roots);
  assert.deepEqual(h.releases, [`job-${assets[2].id}`]);
  h.element('docExportStartBtn').click(); assert.equal(h.requests.at(-1).payload.kind, 'resources');
  assert.deepEqual([...h.requests.at(-1).payload.ids], roots);
  h.requests.at(-1).resolve({ id: 'package', fileName: 'test.zip', bytes: 1, assetCount: 1 }); await flushDialogs();
});

test('back during preparation cancels raw export and discards late results without changing the package selection', async t => {
  const h = await ui(t); h.state.dirty = false; await h.openPackages();
  h.findExport('docPackageEntries', assets[0].id).click(); h.element('docExportBackBtn').click();
  assert.equal(h.requests[0].signal.aborted, true);
  await h.ready(assets[0]);
  assert.equal(h.element('docExportOptions').hidden, false);
  assert.equal(h.element('docExportMessage').textContent, '');
  assert.deepEqual(h.releases, [`job-${assets[0].id}`]); assert.equal(h.state.busy, false);
  assert.equal(h.element('docExportDownload').hidden, true);
});

test('raw file failures, cancellation, expired probes and retry keep the selected resource and draft', async t => {
  const h = await ui(t); await h.openMedia(); h.findExport('docMediaList', assets[1].id).click();
  h.requests[0].reject(new Error('文件内容与登记不一致')); await flushDialogs();
  assert.match(h.element('docExportMessage').textContent, /登记不一致/); assert.equal(h.element('docExportStartBtn').disabled, false);
  h.element('docExportStartBtn').click(); h.element('docExportCancelBtn').click();
  assert.equal(h.requests[1].signal.aborted, true); h.requests[1].reject(new Error('cancelled')); await flushDialogs();
  h.element('docExportStartBtn').click(); await h.ready(assets[1]);
  h.element('docExportDownload').click(); h.checks[0].reject(Object.assign(new Error('expired'), { status: 410 })); await flushDialogs();
  assert.equal(h.handoffs.length, 0); assert.equal(h.element('docExportStartBtn').disabled, false);
  h.element('docExportStartBtn').click(); await h.ready(assets[1], 'retry');
  h.element('docExportDownload').click(); h.checks[1].resolve(); await flushDialogs();
  assert.equal(h.handoffs[0].href, '/api/export?id=retry'); assert.equal(h.editor.value, h.draft);
  assert.equal(h.requests[3].payload.assetId, assets[1].id);
});

test('raw export status translates in English and Japanese without changing the filename', async t => {
  const h = await ui(t); await h.openMedia();
  applyLanguage('en'); h.findExport('docMediaList', assets[0].id).click();
  assert.equal(h.element('docExportTitle').textContent, 'Export original file');
  assert.equal(h.requests[0].payload.language, 'en');
  assert.match(h.element('docExportMessage').textContent, /original file/);
  await h.ready(assets[0]); applyLanguage('ja');
  assert.equal(h.element('docExportTitle').textContent, '元のファイルを書き出す');
  h.element('docExportDownload').click(); h.checks[0].resolve(); await flushDialogs();
  assert.equal(h.handoffs[0].name, assets[0].name);
  assert.match(h.element('docExportMessage').textContent, /元の形式/);
});

test('native raw export automatically opens its picker, allows cancellation/retry and releases only after saving', async t => {
  const calls = [];
  const h = await ui(t, { location: { href: 'http://127.0.0.1/?desktop=1' },
    fetch: async (url, options) => { calls.push(JSON.parse(options.body)); return { ok: true }; } });
  await h.openMedia(); h.findExport('docMediaList', assets[2].id).click(); await h.ready(assets[2]);
  assert.equal(calls.length, 1); assert.equal(h.element('docExportCloseBtn').disabled, true);
  const result = detail => h.runtime.window.dispatch('viento-export-result', { detail: { ...calls.at(-1), ...detail } });
  result({ ok: true, cancelled: true }); await flushDialogs();
  assert.equal(h.state.busy, false); assert.deepEqual(h.releases, []);
  h.element('docExportSaveBtn').click(); result({ ok: true, path: '/exports/主题曲.wav' }); await flushDialogs();
  assert.equal(calls.length, 2); assert.deepEqual(h.releases, [`job-${assets[2].id}`]);
  assert.match(h.element('docExportMessage').textContent, /主题曲.wav/);
  assert.equal(h.editor.value, h.draft); assert.equal(h.editor.selectionStart, h.caret);
});
