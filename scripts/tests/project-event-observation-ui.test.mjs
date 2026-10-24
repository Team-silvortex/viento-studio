import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const origin = (binding = 1, visitIndex = 1) => ({ visitIndex, sceneId: id(visitIndex === 2 ? 2 : 1), bindingId: id(10 + binding), instanceId: id(20 + binding), objectId: id(30 + binding),
  source: { objectId: id(40 + binding), sourcePath: `documents/behaviors/${binding}.json`, sourceRevision: 'sha256:' + 'a'.repeat(64), propertyPath: '/bindings/0' } });
const entry = (sequence = 1) => ({ sequence, name: sequence === 1 ? 'checkpoint' : 'after', value: '雨の鍵 / 风之钥匙 🔑', origin: origin(),
  deliveries: [{ subscriptionId: 1, origin: origin(2), status: 'pending' }, { subscriptionId: 2, origin: origin(3), status: 'handled' }, { subscriptionId: 3, origin: origin(4), status: 'skipped' }] });
const snapshot = () => ({ sequence: 1, entries: [entry()] });
async function fixture(t, options = {}) {
  let dictionary = {}, languageChanged = () => {}, subscriptions = 0;
  const calls = [], context = { available: true, visible: true, sessionOwner: 'backend:task:build:snapshot:assembly', navigationOwner: 'visit-1', canOpenSource: true };
  const h = await dialogHarness('app-project-event-observation', {
    t: (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? ''),
    onLanguageChange(callback) { languageChanged = callback; subscriptions++; return () => { languageChanged = () => {}; subscriptions--; }; },
  });
  const container = h.document.createElement('div'); container.id = 'projectEventTrace'; container.isConnected = true; h.document.body.append(container);
  const controller = h.runtime.setupProjectEventObservation({ container, getContext: () => context, onReviewEvent: options.onReviewEvent,
    onOpen: async (value, opts) => { calls.push({ origin: value, ...opts }); return options.onOpen ? options.onOpen(value, opts) : true; } });
  t.after(() => controller.dispose());
  const el = suffix => h.element('projectEventTrace' + suffix);
  return { ...h, container, controller, context, calls, el, set: value => controller.setSnapshot(value),
    rows: () => el('Entries').children.filter(row => !row.hidden),
    filter(value) { el('Search').value = value; el('Search').dispatch('input'); },
    language(value) { dictionary = value; languageChanged(); }, subscriptions: () => subscriptions };
}
const publisher = h => h.rows()[0].querySelector('.project-event-publisher-source');
const subscribers = h => h.rows()[0].querySelectorAll('.project-event-subscriber-source');

test('an absent event capability stays hidden while supported empty history shows sequence zero', async t => {
  const h = await fixture(t); h.set(null); assert.equal(h.el('Panel').hidden, true);
  h.set({ sequence: 0, entries: [] }); assert.equal(h.el('Panel').hidden, false); assert.equal(h.el('Sequence').dataset.sequence, '0');
  assert.match(h.el('Empty').textContent, /当前没有/); assert.equal(h.rows().length, 0); assert.equal(h.calls.length, 0);
  h.set(null); assert.equal(h.el('Panel').hidden, true); assert.equal(h.el('Sequence').dataset.sequence, undefined);
});

test('publications display separate pending, handled and skipped recipients with both frozen sources', async t => {
  const h = await fixture(t); h.set(snapshot()); const row = h.rows()[0];
  assert.equal(row.dataset.sequence, '1'); assert.equal(row.dataset.name, 'checkpoint');
  assert.equal(row.querySelector('pre').textContent, '"雨の鍵 / 风之钥匙 🔑"');
  const deliveries = row.querySelectorAll('.project-event-delivery');
  assert.deepEqual(deliveries.map(item => item.dataset.status), ['pending', 'handled', 'skipped']);
  assert.match(deliveries[0].textContent, /等待处理/); assert.match(deliveries[1].textContent, /已处理（回调成功）/); assert.match(deliveries[2].textContent, /已跳过（已取消订阅）/);
  publisher(h).click(); await flushDialogs(); assert.equal(h.calls[0].origin.bindingId, id(11)); assert.equal(h.calls[0].origin.source.objectId, id(41));
  subscribers(h)[1].click(); await flushDialogs(); assert.equal(h.calls[1].origin.bindingId, id(13)); assert.equal(h.calls[1].origin.source.objectId, id(43));
  assert.notEqual(h.calls[1].origin.source.objectId, h.calls[1].origin.objectId);
});

test('publication without subscribers is visible and never presented as a handled callback', async t => {
  const h = await fixture(t), value = snapshot(); value.entries[0].deliveries = []; h.set(value);
  assert.match(h.rows()[0].textContent, /发布时没有订阅者/); assert.match(h.rows()[0].textContent, /已发布/);
  assert.equal(subscribers(h).length, 0); assert.doesNotMatch(h.rows()[0].textContent, /已处理/);
});

test('event values, names and author locations stay literal in all three languages', async t => {
  const h = await fixture(t), value = snapshot(); value.entries[0].name = '<img src=x>'; value.entries[0].value = '<script>bad()</script> 状态修订 {0}';
  h.set(value);
  for (const dictionary of [{}, en, ja]) {
    h.language(dictionary); assert.equal(h.el('Title').textContent, dictionary['项目事件记录'] || '项目事件记录');
    assert.equal(h.rows()[0].querySelector('code').textContent, '<img src=x>');
    assert.equal(h.rows()[0].querySelector('pre').textContent, JSON.stringify(value.entries[0].value));
    assert.equal(h.container.querySelector('img'), null); assert.equal(h.container.querySelector('script'), null);
    assert.match(h.rows()[0].querySelector('.project-event-origin').textContent, /documents\/behaviors\/1.json/);
    for (const [index, key] of ['等待处理', '已处理（回调成功）', '已跳过（已取消订阅）'].entries()) assert.equal(h.rows()[0].querySelectorAll('.project-event-status')[index].textContent, dictionary[key] || key);
  }
  for (const scalar of [false, 0, '']) { value.entries[0].value = scalar; h.set(value); assert.equal(h.rows()[0].querySelector('pre').textContent, JSON.stringify(scalar)); }
});

test('scene changes retain history and name filtering; a different run resets both', async t => {
  const h = await fixture(t); h.set(snapshot()); h.filter('CHECK'); const row = h.rows()[0];
  h.context.navigationOwner = 'visit-2'; h.set(snapshot()); assert.equal(h.el('Search').value, 'CHECK'); assert.equal(h.rows()[0], row);
  assert.match(row.textContent, /第 1 次访问/);
  h.context.sessionOwner = 'new-run'; h.controller.refresh(); assert.equal(h.el('Search').value, ''); assert.equal(h.el('Panel').hidden, true); assert.equal(h.rows().length, 0);
  h.set({ sequence: 0, entries: [] }); assert.equal(h.el('Sequence').dataset.sequence, '0');
});

test('polls and history appends retain focused publisher links, search caret and existing source tickets', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(snapshot());
  const search = h.el('Search'); search.focus(); search.selectionStart = 1; search.selectionEnd = 3; h.set(snapshot()); h.language(ja);
  assert.equal(h.document.activeElement, search); assert.deepEqual([search.selectionStart, search.selectionEnd], [1, 3]);
  const button = publisher(h); button.focus(); button.click();
  const next = snapshot(); next.sequence = 2; next.entries.push(entry(2)); h.set(next); h.language(en);
  assert.equal(publisher(h), button); assert.equal(h.document.activeElement, button); assert.equal(h.calls[0].isCurrent(), true);
  pending.resolve(true); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true);
});

test('recipient completion at the same publication sequence preserves publisher navigation and revokes only that recipient ticket', async t => {
  for (const role of ['publisher', 'subscriber']) {
    const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(snapshot());
    const button = role === 'publisher' ? publisher(h) : subscribers(h)[0]; button.click();
    const next = snapshot(); next.entries[0].deliveries[0].status = 'handled'; h.set(next);
    assert.equal(h.el('Sequence').dataset.sequence, '1'); assert.equal(h.calls[0].isCurrent(), role === 'publisher');
    assert.equal(publisher(h).disabled, role === 'publisher');
    if (role === 'subscriber') { button.dispatch('click'); assert.equal(h.calls.length, 1); }
    pending.resolve(true); await flushDialogs();
  }
});

test('another recipient changing status does not revoke an unaffected recipient source read', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(snapshot()); subscribers(h)[1].click();
  const next = snapshot(); next.entries[0].deliveries[0].status = 'skipped'; h.set(next);
  assert.equal(h.calls[0].isCurrent(), true); pending.resolve(true); await flushDialogs();
});

test('source loading may become busy after admission but initial or duplicate busy clicks remain blocked', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(snapshot());
  h.context.canOpenSource = false; publisher(h).dispatch('click'); assert.equal(h.calls.length, 0);
  h.context.canOpenSource = true; publisher(h).click(); assert.equal(h.calls.length, 1);
  h.context.canOpenSource = false; h.controller.refresh(); assert.equal(h.calls[0].isCurrent(), true);
  subscribers(h)[0].dispatch('click'); assert.equal(h.calls.length, 1); pending.resolve(true); await flushDialogs();
});

test('publisher identity, removed rows, visit, task, visibility and filter revoke stale navigation', async t => {
  for (const change of ['origin', 'removed', 'visit', 'task', 'hidden', 'filter']) {
    const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(snapshot()); const button = publisher(h); button.click();
    if (change === 'origin') { const next = snapshot(); next.entries[0].origin = origin(3); h.set(next); }
    else if (change === 'removed') h.set({ sequence: 0, entries: [] });
    else if (change === 'visit') { h.context.navigationOwner = 'visit-2'; h.controller.refresh(); }
    else if (change === 'task') { h.context.sessionOwner = 'new-run'; h.controller.refresh(); }
    else if (change === 'hidden') { h.context.visible = false; h.controller.refresh(); }
    else h.filter('none');
    assert.equal(h.calls[0].isCurrent(), false, change);
    if (change !== 'visit') { button.dispatch('click'); assert.equal(h.calls.length, 1, change); }
    pending.reject(new Error('late')); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true, change);
  }
});

test('captured history and provenance cannot be changed by mutating the incoming snapshot', async t => {
  const h = await fixture(t), input = snapshot(); h.set(input);
  input.entries[0].value = 'replaced'; input.entries[0].origin.source.sourcePath = 'other.json'; input.entries[0].deliveries[0].status = 'handled';
  publisher(h).click(); await flushDialogs(); assert.equal(h.calls[0].origin.source.sourcePath, 'documents/behaviors/1.json');
  assert.equal(h.rows()[0].querySelector('pre').textContent, '"雨の鍵 / 风之钥匙 🔑"'); assert.equal(h.rows()[0].querySelector('.project-event-delivery').dataset.status, 'pending');
});

test('navigation failure keeps the history and disposing revokes callbacks and language subscriptions', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(snapshot()); publisher(h).click();
  pending.reject(new Error('failed')); await flushDialogs(); assert.match(h.el('Navigation').textContent, /无法打开/); assert.equal(h.rows().length, 1);
  const old = publisher(h); h.controller.dispose(); old.dispatch('click'); assert.equal(h.calls.length, 1);
  assert.equal(h.subscriptions(), 0); assert.equal(h.container.children.length, 0);
});

test('the trace panel has no network or publishing port and owns its responsive stylesheet', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-project-event-observation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|fetchJsonApiRequest|requestWorldCommand|\.publish_event\(|\.subscribe\(/);
  const css = await fs.readFile(new URL('../../web/project-event-observation.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 600px\)/); assert.match(css, /white-space: pre-wrap/); assert.match(css, /overflow-wrap: anywhere/);
  const html = await fs.readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  assert.equal(html.match(/href="\/web\/project-event-observation.css"/g)?.length, 1);
});


test('optional event-review navigation exposes a guarded selection and restores focus independently of sources', async t => {
  const calls = [], h = await fixture(t, { onReviewEvent: (sequence, ticket) => calls.push({ sequence, ...ticket }) }); h.set(snapshot());
  const button = h.rows()[0].querySelector('.project-event-review-open'); assert.equal(button.hidden, false); button.click();
  assert.equal(calls[0].sequence, 1); assert.equal(calls[0].isCurrent(), true); assert.equal(h.calls.length, 0);
  assert.equal(h.controller.focusEvent(1), true); assert.equal(h.document.activeElement, button);
  h.filter('no-match'); assert.equal(calls[0].isCurrent(), false); assert.equal(h.controller.focusEvent(1), true); assert.equal(h.document.activeElement, h.el('Search'));
  button.dispatch('click'); assert.equal(calls.length, 1); h.filter(''); h.context.sessionOwner = 'next-run'; h.controller.refresh(); assert.equal(h.controller.focusEvent(1), false);
  const legacy = await fixture(t); legacy.set(snapshot()); assert.equal(legacy.rows()[0].querySelector('.project-event-review-open').hidden, true);
});
