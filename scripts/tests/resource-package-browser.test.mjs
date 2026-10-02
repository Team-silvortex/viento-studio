import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { applyLanguage, onLanguageChange } from '../../web/i18n/index.js';
import { API_PATHS } from '../lib/doc-api-contract.mjs';

const catalog = { revision: 'revision-one', entries: [
  { id: 'hero', category: 'document', kind: 'document', name: '角色', path: 'documents/角色.md', size: 100, status: 'available', problems: [], dependencies: ['image'], children: ['story'] },
  { id: 'story', category: 'document', kind: 'document', name: '背景故事', path: 'documents/故事.md', size: 200, status: 'available', problems: [], dependencies: ['hero'], children: [] },
  { id: 'image', category: 'asset', kind: 'image', name: '立绘', path: 'assets/立绘.png', size: 1024, status: 'available', problems: [], dependencies: [], children: [] },
  { id: 'font', category: 'asset', kind: 'font', name: '字体', path: 'assets/字体.woff2', size: 500, status: 'available', problems: [], dependencies: [], children: [] },
] };
const preview = { id: 'import-job', revision: 'import-revision', documentCount: 1, assetCount: 1, newFiles: 4, reusedFiles: 0,
  conflicts: [], items: [{ path: 'documents/角色.md' }, { path: 'assets/立绘.png' }] };

async function ui(t, overrides = {}) {
  const state = { path: 'documents/角色.md', title: '角色', editable: true, dirty: false, creating: false, busy: false };
  const requests = [], commands = [], releases = [], listeners = [], uploads = [];
  let applied = 0;
  const h = await dialogHarness('app-export', {
    API_PATHS,
    loadResourcePackageCatalog: async () => structuredClone(catalog),
    inspectResourcePackage: (file, signal) => { const task = deferred(); uploads.push({ ...task, file, signal }); return task.promise; },
    resourcePackageCommand: async payload => { commands.push(payload); return payload.action === 'preview' ? structuredClone(preview) : { status: 'imported' }; },
    requestExport: async payload => { requests.push(payload); return { id: 'export-job', fileName: 'test.viento-package.zip', bytes: 1200, assetCount: 1 }; },
    releaseExport: async id => { releases.push(id); }, checkExport: async () => {},
    onLanguageChange: listener => { const off = onLanguageChange(listener); listeners.push(off); },
    ...overrides,
  });
  h.runtime.setupExport({ getContext: () => ({ ...state }), setBusy: busy => { state.busy = busy; }, applied: async () => { applied += 1; } });
  t.after(() => { listeners.forEach(off => off()); applyLanguage('zh-CN'); });
  function kind(value) {
    const radios = h.element('docExportOptions').querySelectorAll('input[name="exportKind"]');
    for (const radio of radios) radio.checked = radio.value === value;
    radios.find(radio => radio.value === value).dispatch('change', { bubbles: true });
  }
  h.element('docExportBtn').click(); kind('resources'); await flushDialogs();
  const choose = file => { h.element('docPackageFile').files = [file]; h.element('docPackageFile').dispatch('change', { bubbles: true }); };
  return { ...h, state, requests, commands, releases, uploads, kind, choose, applied: () => applied };
}

test('package selector includes dependencies and children and preserves roots across search and language changes', async t => {
  const h = await ui(t);
  assert.equal(h.element('docResourcePackageOptions').hidden, false);
  assert.equal(h.element('docExportStartBtn').disabled, false);
  const checks = h.element('docPackageEntries').querySelectorAll('input');
  assert.equal(checks.find(item => item.value === 'story').checked, true);
  assert.equal(checks.find(item => item.value === 'image').disabled, true);
  h.element('docPackageSearch').value = '字体'; h.element('docPackageSearch').dispatch('input');
  h.element('docPackageSelectVisible').click();
  applyLanguage('ja');
  assert.match(h.element('docPackageSummary').textContent, /選択 2 件/);
  h.element('docExportStartBtn').click(); await flushDialogs();
  assert.deepEqual([...h.requests[0].ids], ['hero', 'font']);
  assert.equal(h.requests[0].revision, catalog.revision);
  assert.equal(h.requests[0].includeDependencies, true);
  assert.equal(h.requests[0].language, 'ja');
  h.element('docPackageClear').click(); await flushDialogs();
  assert.deepEqual(h.releases, ['export-job']); assert.equal(h.element('docExportStartBtn').disabled, true);
});

test('dependency toggles show external requirements and empty selection blocks export', async t => {
  const h = await ui(t);
  for (const id of ['docPackageDependencies', 'docPackageChildren']) { h.element(id).checked = false; h.element(id).dispatch('change', { bubbles: true }); }
  assert.match(h.element('docPackageSummary').textContent, /外部依赖 1 项/);
  h.element('docPackageClear').click(); h.element('docExportStartBtn').click();
  assert.equal(h.requests.length, 0);
});

test('upload is a preview, importing is explicit, locks close and refreshes the project once', async t => {
  const commit = deferred(), commands = [];
  const h = await ui(t, { resourcePackageCommand: payload => {
    commands.push(payload); return payload.action === 'import' ? commit.promise : Promise.resolve({ released: true });
  } });
  h.choose({ name: 'example.viento-package.zip', size: 100 });
  assert.equal(h.element('docExportOptions').disabled, true);
  h.uploads[0].resolve(structuredClone(preview)); await flushDialogs();
  assert.equal(commands.length, 0); assert.equal(h.element('docPackageImportPreview').hidden, false);
  assert.equal(h.element('docExportStartBtn').disabled, true);
  h.element('docPackageImportApply').click();
  assert.equal(commands[0].action, 'import'); assert.equal(commands[0].revision, preview.revision);
  h.element('docExportDialog').dispatch('cancel'); assert.equal(h.element('docExportDialog').open, true);
  assert.equal(h.element('docExportCloseBtn').disabled, true);
  commit.resolve({ status: 'imported' }); await flushDialogs();
  assert.equal(h.applied(), 1); assert.match(h.element('docPackageMessage').textContent, /资源包已导入/);
  assert.equal(h.state.busy, false);
});

test('conflicts block import and failed attempts need a fresh target preview', async t => {
  const commands = [];
  const h = await ui(t, { resourcePackageCommand: async payload => {
    commands.push(payload);
    if (payload.action === 'import') throw new Error('目标项目已变化，请重新预览导入');
    return structuredClone(preview);
  } });
  h.choose({ size: 100 }); h.uploads[0].resolve({ ...structuredClone(preview), conflicts: [{ path: 'assets/x', reason: 'content' }] }); await flushDialogs();
  assert.equal(h.element('docPackageImportApply').disabled, true); h.element('docPackageImportApply').click(); assert.equal(commands.length, 0);
  h.element('docPackageImportRefresh').click(); await flushDialogs();
  h.element('docPackageImportApply').click(); await flushDialogs();
  assert.equal(h.element('docPackageImportApply').disabled, true); assert.match(h.element('docPackageMessage').textContent, /重新预览/);
  h.element('docPackageImportRefresh').click(); await flushDialogs(); assert.equal(h.element('docPackageImportApply').disabled, false);
});

test('closing during upload aborts and releases a late preview without altering a reopened dialog', async t => {
  const h = await ui(t);
  h.choose({ size: 100 }); h.element('docExportCloseBtn').click();
  assert.equal(h.uploads[0].signal.aborted, true);
  h.element('docExportBtn').click(); await flushDialogs();
  h.uploads[0].resolve(structuredClone(preview)); await flushDialogs();
  assert.ok(h.commands.some(command => command.action === 'release' && command.id === preview.id));
  assert.equal(h.element('docPackageImportPreview').hidden, true);
  assert.equal(h.element('docExportStartBtn').disabled, false);
});

test('browse mode and unsaved drafts cannot start resource imports', async t => {
  const h = await ui(t);
  h.state.editable = false; h.kind('document'); h.kind('resources'); await flushDialogs();
  assert.equal(h.element('docPackageChooseFile').hidden, true);
  h.choose({ size: 100 }); assert.equal(h.uploads.length, 0);
  h.state.editable = true; h.state.dirty = true;
  h.choose({ size: 100 }); assert.equal(h.uploads.length, 0);
});

test('interrupted import exposes recovery and an ordinary resource catalogue hides it', async t => {
  const good = await ui(t);
  assert.equal(good.element('docPackageRecover').hidden, true);
  const h = await ui(t, { loadResourcePackageCatalog: async () => { throw Object.assign(new Error('资源包导入尚未完成，请先恢复导入'), { code: 'resource_package_recovery_required' }); } });
  assert.equal(h.element('docPackageRecover').hidden, false);
  h.element('docPackageRecover').click(); await flushDialogs();
  assert.equal(h.commands[0].action, 'recover'); assert.equal(h.applied(), 1);
  assert.equal(h.element('docPackageRecover').hidden, true);
});
