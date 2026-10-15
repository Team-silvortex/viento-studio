import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const origin = (visitIndex = 1) => ({ visitIndex, sceneId: id(visitIndex === 2 ? 2 : 1), bindingId: id(10), instanceId: id(11), objectId: id(12),
  source: { objectId: id(20), sourcePath: 'documents/behaviors/state.json', sourceRevision: 'sha256:' + 'a'.repeat(64), propertyPath: '/bindings/0' } });
const snapshot = () => ({ revision: 6, entries: [
  { key: 'note', value: '雨の鍵 / 风之钥匙 🔑', revision: 2, origin: origin() },
  { key: 'visit_count', value: 3, revision: 5, origin: origin(3) },
], lastChange: { operation: 'delete', key: 'key_found', revision: 6, origin: origin(3) } });
async function fixture(t, options = {}) {
  let dictionary = {}, languageChanged = () => {}, subscriptions = 0;
  const calls = [], context = { available: true, visible: true, sessionOwner: 'backend:task:build:snapshot:assembly', navigationOwner: 'visit-3', canOpenSource: true };
  const h = await dialogHarness('app-project-state-observation', {
    t: (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? ''),
    onLanguageChange(callback) { languageChanged = callback; subscriptions++; return () => { languageChanged = () => {}; subscriptions--; }; },
  });
  const container = h.document.createElement('div'); container.id = 'projectSharedState'; container.isConnected = true; h.document.body.append(container);
  const controller = h.runtime.setupProjectStateObservation({ container, getContext: () => context,
    onOpen: async (value, opts) => { calls.push({ origin: value, ...opts }); return options.onOpen ? options.onOpen(value, opts) : true; } });
  t.after(() => controller.dispose());
  const el = suffix => h.element('projectSharedState' + suffix);
  return { ...h, container, controller, context, calls, el, set: value => controller.setSnapshot(value),
    rows: () => el('Entries').children.filter(row => !row.hidden),
    filter(value) { el('Search').value = value; el('Search').dispatch('input'); },
    language(value) { dictionary = value; languageChanged(); }, subscriptions: () => subscriptions };
}

test('unsupported observations stay hidden while a supported empty state shows revision zero', async t => {
  const h = await fixture(t); h.set(null); assert.equal(h.el('Panel').hidden, true);
  h.set({ revision: 0, entries: [], lastChange: null });
  assert.equal(h.el('Panel').hidden, false); assert.equal(h.el('Revision').dataset.revision, '0');
  assert.match(h.el('Empty').textContent, /当前没有/); assert.equal(h.el('LastChange').hidden, true);
  assert.equal(h.rows().length, 0); assert.equal(h.calls.length, 0);
});

test('keys, JSON values, per-key revisions and deleted last change are visible without synthesizing a value', async t => {
  const h = await fixture(t); h.set(snapshot());
  assert.equal(h.el('Revision').dataset.revision, '6'); assert.equal(h.rows().length, 2);
  assert.deepEqual(h.rows().map(row => row.dataset.key), ['note', 'visit_count']);
  assert.equal(h.rows()[0].querySelector('pre').textContent, '"雨の鍵 / 风之钥匙 🔑"');
  assert.equal(h.rows()[1].querySelector('pre').textContent, '3');
  assert.equal(h.rows()[0].dataset.revision, '2'); assert.match(h.rows()[0].textContent, /第 1 次访问/);
  const last = h.el('LastChangeBody').children[0]; assert.equal(last.dataset.key, 'key_found');
  assert.match(last.textContent, /删除键.*6/); assert.equal(last.querySelector('pre'), null);
});

test('values and source paths remain literal text across all languages, including false, zero and markup', async t => {
  const h = await fixture(t), value = snapshot();
  value.entries = [
    { key: 'flag', value: false, revision: 1, origin: origin() },
    { key: 'html', value: '<img src=x onerror=bad()> / 状态修订 {0}', revision: 2, origin: origin() },
    { key: 'zero', value: 0, revision: 3, origin: origin() },
  ];
  h.set(value);
  for (const dictionary of [{}, en, ja]) {
    h.language(dictionary);
    assert.equal(h.rows()[0].querySelector('pre').textContent, 'false');
    assert.equal(h.rows()[2].querySelector('pre').textContent, '0');
    assert.equal(h.rows()[1].querySelector('pre').textContent, JSON.stringify(value.entries[1].value));
    assert.equal(h.container.querySelector('img'), null); assert.equal(h.el('Title').textContent, dictionary['会话共享状态'] || '会话共享状态');
    assert.ok(h.rows()[0].querySelector('.project-state-origin').textContent.endsWith('documents/behaviors/state.json'));
  }
});

test('scene visits preserve shared values and filtering while a new task clears both', async t => {
  const h = await fixture(t); h.set(snapshot()); h.filter('NOTE'); assert.equal(h.rows().length, 1);
  const record = h.rows()[0]; h.context.navigationOwner = 'visit-4'; h.set(snapshot());
  assert.equal(h.el('Search').value, 'NOTE'); assert.equal(h.rows()[0], record); assert.match(h.rows()[0].textContent, /第 1 次访问/);
  h.context.sessionOwner = 'backend:new-task:build:snapshot:assembly'; h.controller.refresh();
  assert.equal(h.el('Panel').hidden, true); assert.equal(h.el('Search').value, ''); assert.equal(h.rows().length, 0);
  h.set({ revision: 0, entries: [], lastChange: null }); assert.equal(h.el('Revision').dataset.revision, '0'); assert.equal(h.rows().length, 0);
});

test('equivalent polls and language changes retain focused source buttons and search caret', async t => {
  const h = await fixture(t), value = snapshot(); h.set(value); h.filter('note');
  const search = h.el('Search'); search.focus(); search.selectionStart = 1; search.selectionEnd = 3;
  h.set(structuredClone(value)); h.language(ja);
  assert.equal(h.document.activeElement, search); assert.deepEqual([search.selectionStart, search.selectionEnd], [1, 3]);
  const button = h.rows()[0].querySelector('button'); button.focus(); h.language(en); h.set(structuredClone(value));
  assert.equal(h.rows()[0].querySelector('button'), button); assert.equal(h.document.activeElement, button);
  assert.equal(h.el('Search').value, 'note'); assert.equal(h.calls.length, 0);
});

test('source tickets retain the actual past origin, prevent double opens and survive their own source loading', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(snapshot());
  h.rows()[0].querySelector('button').click(); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].origin.visitIndex, 1); assert.equal(h.calls[0].origin.source.objectId, id(20));
  h.context.canOpenSource = false; h.controller.refresh();
  assert.equal(h.calls[0].isCurrent(), true, 'current admission is separate from an ongoing source read');
  h.rows()[0].querySelector('button').dispatch('click'); assert.equal(h.calls.length, 1);
  h.set(snapshot()); h.language(ja); assert.equal(h.calls[0].isCurrent(), true);
  pending.resolve(true); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true);
});

test('last deletion retains its origin navigation independently from existing keys and filters', async t => {
  const h = await fixture(t); h.set(snapshot()); h.filter('note');
  h.el('LastChangeBody').querySelector('button').click(); await flushDialogs();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].origin.visitIndex, 3);
  assert.equal(h.calls[0].origin.source.propertyPath, '/bindings/0'); assert.equal(h.rows().length, 1);
});

test('new revision, entry identity, visit, session, hidden view and filter revoke pending navigation', async t => {
  for (const change of ['revision', 'entry', 'visit', 'session', 'hidden', 'filter']) {
    const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(snapshot());
    const old = h.rows()[0].querySelector('button'); old.click(); assert.equal(h.calls[0].isCurrent(), true);
    if (change === 'revision') { const next = snapshot(); next.revision = 7; h.set(next); }
    else if (change === 'entry') { const next = snapshot(); next.entries[0].origin = origin(3); h.set(next); }
    else if (change === 'visit') { h.context.navigationOwner = 'visit-4'; h.controller.refresh(); }
    else if (change === 'session') { h.context.sessionOwner = 'new-task'; h.controller.refresh(); }
    else if (change === 'hidden') { h.context.visible = false; h.controller.refresh(); }
    else h.filter('no match');
    assert.equal(h.calls[0].isCurrent(), false, change);
    if (!['revision', 'visit'].includes(change)) { old.dispatch('click'); assert.equal(h.calls.length, 1, change); }
    pending.reject(new Error('late')); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true, change);
  }
});

test('a host mutation cannot change captured values or source identity in place', async t => {
  const h = await fixture(t), value = snapshot(); h.set(value);
  value.entries[0].value = 'changed later'; value.entries[0].origin.source.sourcePath = 'documents/other.json';
  h.rows()[0].querySelector('button').click(); await flushDialogs();
  assert.equal(h.rows()[0].querySelector('pre').textContent, '"雨の鍵 / 风之钥匙 🔑"');
  assert.equal(h.calls[0].origin.source.sourcePath, 'documents/behaviors/state.json');
});

test('source failure preserves the observed state and dispose revokes all callbacks and subscriptions', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(snapshot());
  h.rows()[0].querySelector('button').click(); pending.reject(new Error('no source')); await flushDialogs();
  assert.match(h.el('Navigation').textContent, /无法打开/); assert.equal(h.rows().length, 2);
  const old = h.rows()[0].querySelector('button'); h.controller.dispose();
  assert.equal(h.subscriptions(), 0); assert.equal(h.container.children.length, 0); old.dispatch('click'); assert.equal(h.calls.length, 1);
});

test('the panel has no game mutation port and its dedicated stylesheet stacks content on narrow screens', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-project-state-observation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|fetchJsonApiRequest|requestWorldCommand|on_fixed_update|\.set_project_state\(/);
  const css = await fs.readFile(new URL('../../web/project-state-observation.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 600px\)/); assert.match(css, /white-space: pre-wrap/); assert.match(css, /overflow-wrap: anywhere/);
  const html = await fs.readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  assert.equal(html.match(/href="\/web\/project-state-observation.css"/g)?.length, 1);
});
