import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const revision = 'sha256:' + 'a'.repeat(64);
const origin = () => ({ visitIndex: 1, sceneId: id(1), bindingId: id(10), instanceId: id(20), objectId: id(30),
  source: { objectId: id(40), sourcePath: 'documents/behaviors/声音.json', sourceRevision: revision, propertyPath: '/bindings/0' } });
const track = () => ({ trackId: id(50), resourceId: id(60), source: { objectId: id(70), sourcePath: 'documents/audio/音声.json', sourceRevision: revision,
  propertyPath: '/tracks/0', sourceRange: { start: 15, end: 97, encoding: 'utf-16', propertyPath: '/tracks/0', exact: true } } });
const entry = (sequence = 1) => ({ sequence, action: sequence === 1 ? 'play' : 'stop', timeSeconds: sequence === 1 ? 0.25 : 0.5, origin: origin(), track: track() });
const snapshot = () => ({ sequence: 2, entries: [entry(), entry(2)] });
async function fixture(t, options = {}) {
  let dictionary = {}, languageChanged = () => {}, subscriptions = 0;
  const calls = [], context = { available: true, visible: true, sessionOwner: 'backend:task:build:snapshot:assembly', navigationOwner: 'visit-2', canOpenSource: true };
  const h = await dialogHarness('app-project-audio-observation', {
    t: (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? ''),
    onLanguageChange(callback) { languageChanged = callback; subscriptions++; return () => { languageChanged = () => {}; subscriptions--; }; },
  });
  const container = h.document.createElement('div'); container.id = 'projectAudioCommands'; container.isConnected = true; h.document.body.append(container);
  const controller = h.runtime.setupProjectAudioObservation({ container, getContext: () => context,
    onOpen: async (source, opts) => { calls.push({ source, ...opts }); return options.onOpen ? options.onOpen(source, opts) : true; } });
  t.after(() => controller.dispose());
  const el = suffix => h.element('projectAudioCommands' + suffix);
  return { ...h, container, controller, context, calls, el, set: value => controller.setSnapshot(value),
    rows: () => el('Entries').children.filter(row => !row.hidden),
    filter(value) { el('Search').value = value; el('Search').dispatch('input'); },
    language(value) { dictionary = value; languageChanged(); }, subscriptions: () => subscriptions };
}
const sourceButton = (h, kind = 'behavior') => h.rows()[0].querySelector('.project-audio-' + kind + '-source');

test('absent audio-command support stays hidden while an empty supported history is visible at sequence zero', async t => {
  const h = await fixture(t); h.set(null); assert.equal(h.el('Panel').hidden, true);
  h.set({ sequence: 0, entries: [] }); assert.equal(h.el('Panel').hidden, false); assert.equal(h.el('Sequence').dataset.sequence, '0');
  assert.match(h.el('Empty').textContent, /当前没有已执行/); assert.equal(h.rows().length, 0);
  h.set(null); assert.equal(h.el('Panel').hidden, true); assert.equal(h.el('Sequence').dataset.sequence, undefined);
});

test('only executed play and stop commands are listed with exact scene times and identities, without claiming live playback', async t => {
  const h = await fixture(t); h.set(snapshot());
  assert.deepEqual(h.rows().map(row => [row.dataset.sequence, row.dataset.action, row.dataset.trackId]), [['1', 'play', id(50)], ['2', 'stop', id(50)]]);
  assert.equal(h.rows()[0].querySelector('h4').textContent, '已执行播放命令'); assert.equal(h.rows()[1].querySelector('h4').textContent, '已执行停止命令');
  assert.match(h.rows()[0].textContent, /第 1 次访问.*0.25 秒/); assert.match(h.rows()[1].textContent, /0.5 秒/);
  assert.match(h.el('Note').textContent, /不代表当前播放状态或可听见/);
  assert.doesNotMatch(h.rows()[0].textContent, /正在播放|播放成功|已听到/);
});

test('control and track navigation retain distinct frozen document identities and the supplied track range', async t => {
  const h = await fixture(t); h.set(snapshot());
  sourceButton(h).click(); await flushDialogs(); sourceButton(h, 'track').click(); await flushDialogs();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].source)), origin().source); assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1].source)), track().source);
  assert.notEqual(h.calls[0].source.objectId, origin().objectId); assert.notEqual(h.calls[0].source.objectId, h.calls[1].source.objectId);
  assert.equal(h.calls[0].source.sourceRange, undefined); assert.equal(h.calls[1].source.sourceRange.exact, true);
});

test('three languages translate command labels while author paths and markup remain literal', async t => {
  const h = await fixture(t), value = snapshot(); value.entries[0].origin.source.sourcePath = 'documents/<img src=x>.json'; h.set(value);
  for (const dictionary of [{}, en, ja]) {
    h.language(dictionary); assert.equal(h.el('Title').textContent, dictionary['声音控制记录'] || '声音控制记录');
    assert.equal(h.rows()[0].querySelector('h4').textContent, dictionary['已执行播放命令'] || '已执行播放命令');
    assert.equal(h.rows()[1].querySelector('h4').textContent, dictionary['已执行停止命令'] || '已执行停止命令');
    assert.match(h.rows()[0].textContent, /documents\/<img src=x>.json/); assert.match(h.rows()[0].textContent, /documents\/audio\/音声.json/);
    assert.equal(h.container.querySelector('img'), null);
  }
});

test('track and resource filtering survives scene visits and new tasks reset the filter and history', async t => {
  const h = await fixture(t); h.set(snapshot()); h.filter(id(50)); assert.equal(h.rows().length, 2);
  h.filter(id(60)); assert.equal(h.rows().length, 2); h.filter(id(99)); assert.equal(h.rows().length, 0);
  h.filter(id(50)); h.context.navigationOwner = 'visit-3'; h.set(snapshot()); assert.equal(h.el('Search').value, id(50)); assert.equal(h.rows().length, 2);
  h.context.sessionOwner = 'new-run'; h.controller.refresh(); assert.equal(h.el('Search').value, ''); assert.equal(h.rows().length, 0); assert.equal(h.el('Panel').hidden, true);
});

test('append-only receipt history retains focused source links, search caret and ongoing source ownership', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set({ sequence: 1, entries: [entry()] });
  const input = h.el('Search'); input.focus(); input.selectionStart = 2; input.selectionEnd = 4; h.language(ja);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 4]);
  const button = sourceButton(h, 'track'); button.focus(); button.click(); h.set(snapshot()); h.language(en);
  assert.equal(sourceButton(h, 'track'), button); assert.equal(h.document.activeElement, button); assert.equal(h.calls[0].isCurrent(), true);
  pending.resolve(true); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true);
});

test('changing either provenance or command identity revokes a stale source ticket while another command does not', async t => {
  for (const change of ['behavior', 'track', 'action', 'time', 'other']) {
    const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(snapshot()); const button = sourceButton(h); button.click();
    const next = snapshot();
    if (change === 'behavior') next.entries[0].origin.source.sourcePath = 'other.json';
    else if (change === 'track') next.entries[0].track.source.sourceRange.end++;
    else if (change === 'action') next.entries[0].action = 'stop';
    else if (change === 'time') next.entries[0].timeSeconds = 0.125;
    else next.entries[1].timeSeconds = 0.75;
    h.set(next); assert.equal(h.calls[0].isCurrent(), change === 'other', change);
    if (change !== 'other') { button.dispatch('click'); assert.equal(h.calls.length, 1); }
    pending.resolve(true); await flushDialogs();
  }
});

test('busy admission blocks new reads but own-loading busy does not invalidate an admitted source request', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(snapshot());
  h.context.canOpenSource = false; sourceButton(h).dispatch('click'); assert.equal(h.calls.length, 0);
  h.context.canOpenSource = true; sourceButton(h).click(); h.context.canOpenSource = false; h.controller.refresh();
  assert.equal(h.calls[0].isCurrent(), true); sourceButton(h, 'track').dispatch('click'); assert.equal(h.calls.length, 1);
  pending.resolve(true); await flushDialogs();
});

test('visit, task, hidden view, removed history and filtering revoke delayed navigation', async t => {
  for (const change of ['visit', 'task', 'hidden', 'removed', 'filter']) {
    const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(snapshot()); sourceButton(h).click();
    if (change === 'visit') h.context.navigationOwner = 'visit-3';
    else if (change === 'task') h.context.sessionOwner = 'new-run';
    else if (change === 'hidden') h.context.visible = false;
    else if (change === 'removed') h.set(null);
    else h.filter('no-match');
    h.controller.refresh(); assert.equal(h.calls[0].isCurrent(), false, change);
    pending.reject(Error('late')); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true, change);
  }
});

test('captured source ranges are detached and navigation errors preserve the view; disposal revokes listeners', async t => {
  const h = await fixture(t, { onOpen: async () => { throw Error('missing'); } }), value = snapshot(); h.set(value);
  value.entries[0].track.source.sourcePath = 'replaced.json'; value.entries[0].track.source.sourceRange.start = 99;
  sourceButton(h, 'track').click(); await flushDialogs(); assert.equal(h.calls[0].source.sourcePath, 'documents/audio/音声.json'); assert.equal(h.calls[0].source.sourceRange.start, 15);
  assert.match(h.el('Navigation').textContent, /无法打开/); assert.equal(h.rows().length, 2);
  const old = sourceButton(h); h.controller.dispose(); old.dispatch('click'); assert.equal(h.calls.length, 1); assert.equal(h.subscriptions(), 0);
});

test('audio observation owns responsive styles and has no network, player or audio command authority', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-project-audio-observation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|fetchJsonApiRequest|requestWorldCommand|\.play_audio\(|\.stop_audio\(|new Audio\(/);
  const css = await fs.readFile(new URL('../../web/project-audio-observation.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 600px\)/); assert.match(css, /flex-direction: column/); assert.match(css, /overflow-wrap: anywhere/);
  const html = await fs.readFile(new URL('../../web/index.html', import.meta.url), 'utf8'); assert.equal(html.match(/href="\/web\/project-audio-observation.css"/g)?.length, 1);
});
