import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { PROJECT_TEMPLATE_CATALOG } from '../lib/project-layout.mjs';
import { applyLanguage } from '../../web/i18n/index.js';
import { nativeFailure } from '../../mobile/platform.mjs';

async function libraryHarness(handler) {
  let languageChanged;
  const h = await dialogHarness('app-keyboard', {
    nativeFailure, setupSettings: async () => {}, onLanguageChange: callback => { languageChanged = callback; },
  });
  const html = await fs.readFile(new URL('../../mobile/index.html', import.meta.url), 'utf8');
  h.document.body.innerHTML = html.match(/<body\b[^>]*>([\s\S]*?)<script/)[1];
  const calls = [];
  h.runtime.window.__TAURI__ = { core: { invoke: async (name, args) => {
    calls.push({ name, args });
    if (args.action === 'list') return [];
    return handler(args);
  } } };
  const source = (await fs.readFile(new URL('../../mobile/library.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/gm, '');
  await vm.runInContext(`(async () => { ${source} })()`, h.runtime);
  return { ...h, calls, language: value => { applyLanguage(value); languageChanged(); } };
}

test('mobile template selection, language changes and failed creation preserve the selected project kind', async (t) => {
  t.after(() => applyLanguage('zh-CN'));
  const create = deferred();
  const h = await libraryHarness(args => args.action === 'templates' ? PROJECT_TEMPLATE_CATALOG : create.promise);
  const select = h.element('projectTemplate'), form = h.element('createWorkspace');
  assert.equal(select.value, 'org.viento.blank');
  select.value = 'org.viento.software-design'; select.dispatch('change');
  h.language('ja');
  assert.equal(select.value, 'org.viento.software-design');
  assert.equal(select.children.at(-1).textContent, 'ソフトウェア設計');
  assert.match(h.element('templateDescription').textContent, /コンポーネント/);
  h.element('workspaceName').value = 'Draft project';
  form.dispatch('submit');
  assert.equal(select.disabled, true);
  form.dispatch('submit');
  assert.equal(h.calls.filter(item => item.args.action === 'create').length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1).args.payload)), { name: 'Draft project', templateId: 'org.viento.software-design' });
  create.reject(new Error('disk unavailable')); await flushDialogs();
  assert.equal(select.disabled, false);
  assert.equal(select.value, 'org.viento.software-design');
  assert.equal(h.element('workspaceName').value, 'Draft project');
  assert.equal(h.element('mobileRetry').hidden, false);
});

test('mobile creation stays unavailable when the catalogue fails to load and recovers on retry', async () => {
  let attempts = 0;
  const h = await libraryHarness(args => {
    assert.equal(args.action, 'templates');
    if (!attempts++) throw new Error('catalogue unavailable');
    return PROJECT_TEMPLATE_CATALOG;
  });
  const form = h.element('createWorkspace');
  assert.equal(form.querySelector('button').disabled, true);
  h.element('workspaceName').value = 'No fallback'; form.dispatch('submit');
  assert.equal(h.calls.some(item => item.args.action === 'create'), false);
  h.element('mobileRetry').click(); await flushDialogs();
  assert.equal(form.querySelector('button').disabled, false);
  assert.equal(h.element('projectTemplate').value, 'org.viento.blank');
});
