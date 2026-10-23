import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { validateProjectAnimationCommandsSnapshot } from '../../engine/project-animation-commands.mjs';
import { deferred } from './editor-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const revision = 'sha256:' + 'a'.repeat(64);
const origin = () => ({ visitIndex: 1, sceneId: id(1), bindingId: id(10), instanceId: id(20), objectId: id(30),
  source: { objectId: id(40), sourcePath: 'documents/behaviors/声音.json', sourceRevision: revision, propertyPath: '/bindings/0' } });
const animation = () => ({ objectId: id(50), durationSeconds: 2, loop: false,
  source: { objectId: id(50), sourcePath: 'documents/animations/动画.json', sourceRevision: revision,
    propertyPath: '', sourceRange: { start: 0, end: 297, encoding: 'utf-16', propertyPath: '', exact: true } } });
const entry = (sequence = 1) => ({ sequence, command: { action: sequence === 1 ? 'play' : 'stop' },
  state: { sceneObjectId: id(1), phase: sequence === 1 ? 'playing' : 'stopped', positionSeconds: sequence === 1 ? 0.25 : 0, timeSeconds: sequence === 1 ? 0.25 : 0.5 },
  origin: origin(), animation: animation() });
const snapshot = () => ({ sequence: 2, entries: [entry(), entry(2)] });
async function fixture(t, options = {}) {
  let dictionary = {}, languageChanged = () => {}, subscriptions = 0;
  const calls = [], context = { available: true, visible: true, sessionOwner: 'backend:task:build:snapshot:assembly', navigationOwner: 'visit-2', canOpenSource: true };
  const h = await dialogHarness('app-project-animation-observation', {
    validateProjectAnimationCommandsSnapshot,
    t: (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? ''),
    onLanguageChange(callback) { languageChanged = callback; subscriptions++; return () => { languageChanged = () => {}; subscriptions--; }; },
  });
  const container = h.document.createElement('div'); container.id = 'projectAnimationCommands'; container.isConnected = true; h.document.body.append(container);
  const controller = h.runtime.setupProjectAnimationObservation({ container, getContext: () => context,
    onOpen: async (source, opts) => { calls.push({ source, ...opts }); return options.onOpen ? options.onOpen(source, opts) : true; } });
  t.after(() => controller.dispose());
  const el = suffix => h.element('projectAnimationCommands' + suffix);
  return { ...h, container, controller, context, calls, el, set: value => controller.setSnapshot(value),
    rows: () => el('Entries').children.filter(row => !row.hidden),
    filter(value) { el('Search').value = value; el('Search').dispatch('input'); },
    language(value) { dictionary = value; languageChanged(); }, subscriptions: () => subscriptions };
}
const sourceButton = (h, kind = 'behavior') => h.rows()[0].querySelector('.project-animation-' + kind + '-source');

test('absent animation-command support stays hidden while an empty supported history is visible at sequence zero', async t => {
  const h = await fixture(t); h.set(null); assert.equal(h.el('Panel').hidden, true);
  h.set({ sequence: 0, entries: [] }); assert.equal(h.el('Panel').hidden, false); assert.equal(h.el('Sequence').dataset.sequence, '0');
  assert.match(h.el('Empty').textContent, /当前没有已执行/); assert.equal(h.rows().length, 0);
  h.set(null); assert.equal(h.el('Panel').hidden, true); assert.equal(h.el('Sequence').dataset.sequence, undefined);
});

test('executed play and stop commands are listed with exact scene times and identities, without claiming live playback', async t => {
  const h = await fixture(t); h.set(snapshot());
  assert.deepEqual(h.rows().map(row => [row.dataset.sequence, row.dataset.action, row.dataset.animationId]), [['1', 'play', id(50)], ['2', 'stop', id(50)]]);
  assert.equal(h.rows()[0].querySelector('h4').textContent, '已执行播放命令'); assert.equal(h.rows()[1].querySelector('h4').textContent, '已执行停止命令');
  assert.match(h.rows()[0].textContent, /第 1 次访问.*0.25 秒/); assert.match(h.rows()[1].textContent, /0.5 秒/);
  assert.match(h.el('Note').textContent, /不代表当前画面/);
  assert.doesNotMatch(h.rows()[0].textContent, /正在播放|播放成功|已听到/);
});

test('control and animation navigation retain distinct frozen document identities and the supplied animation range', async t => {
  const h = await fixture(t); h.set(snapshot());
  sourceButton(h).click(); await flushDialogs(); sourceButton(h, 'animation').click(); await flushDialogs();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].source)), origin().source); assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1].source)), animation().source);
  assert.notEqual(h.calls[0].source.objectId, origin().objectId); assert.notEqual(h.calls[0].source.objectId, h.calls[1].source.objectId);
  assert.equal(h.calls[0].source.sourceRange, undefined); assert.equal(h.calls[1].source.sourceRange.exact, true);
});

test('three languages translate command labels while author paths and markup remain literal', async t => {
  const h = await fixture(t), value = snapshot(); value.entries[0].origin.source.sourcePath = 'documents/<img src=x>.json'; h.set(value);
  for (const dictionary of [{}, en, ja]) {
    h.language(dictionary); assert.equal(h.el('Title').textContent, dictionary['动画控制记录'] || '动画控制记录');
    assert.equal(h.rows()[0].querySelector('h4').textContent, dictionary['已执行播放命令'] || '已执行播放命令');
    assert.equal(h.rows()[1].querySelector('h4').textContent, dictionary['已执行停止命令'] || '已执行停止命令');
    assert.match(h.rows()[0].textContent, /documents\/<img src=x>.json/); assert.match(h.rows()[0].textContent, /documents\/animations\/动画.json/);
    assert.equal(h.container.querySelector('img'), null);
  }
});

test('scene and animation filtering survives scene visits and new tasks reset the filter and history', async t => {
  const h = await fixture(t); h.set(snapshot()); h.filter(id(50)); assert.equal(h.rows().length, 2);
  h.filter(id(1)); assert.equal(h.rows().length, 2); h.filter(id(99)); assert.equal(h.rows().length, 0);
  h.filter(id(50)); h.context.navigationOwner = 'visit-3'; h.set(snapshot()); assert.equal(h.el('Search').value, id(50)); assert.equal(h.rows().length, 2);
  h.context.sessionOwner = 'new-run'; h.controller.refresh(); assert.equal(h.el('Search').value, ''); assert.equal(h.rows().length, 0); assert.equal(h.el('Panel').hidden, true);
});

test('append-only receipt history retains focused source links, search caret and ongoing source ownership', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set({ sequence: 1, entries: [entry()] });
  const input = h.el('Search'); input.focus(); input.selectionStart = 2; input.selectionEnd = 4; h.language(ja);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 4]);
  const button = sourceButton(h, 'animation'); button.focus(); button.click(); h.set(snapshot()); h.language(en);
  assert.equal(sourceButton(h, 'animation'), button); assert.equal(h.document.activeElement, button); assert.equal(h.calls[0].isCurrent(), true);
  pending.resolve(true); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true);
});

test('changing either provenance or command identity revokes a stale source ticket while another command does not', async t => {
  for (const change of ['behavior', 'animation', 'action', 'time', 'other']) {
    const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(snapshot()); const button = sourceButton(h); button.click();
    const next = snapshot();
    if (change === 'behavior') next.entries[0].origin.source.sourcePath = 'other.json';
    else if (change === 'animation') { next.entries[0].animation.source.sourceRange.end++; next.entries[1].animation.source.sourceRange.end++; }
    else if (change === 'action') { next.entries[0].command.action = 'pause'; next.entries[0].state.phase = 'paused'; }
    else if (change === 'time') next.entries[0].state.timeSeconds = 0.125;
    else next.entries[1].state.timeSeconds = 0.75;
    h.set(next); assert.equal(h.calls[0].isCurrent(), change === 'other', change);
    if (change !== 'other') { button.dispatch('click'); assert.equal(h.calls.length, 1); }
    pending.resolve(true); await flushDialogs();
  }
});

test('busy admission blocks new reads but own-loading busy does not invalidate an admitted source request', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); h.set(snapshot());
  h.context.canOpenSource = false; sourceButton(h).dispatch('click'); assert.equal(h.calls.length, 0);
  h.context.canOpenSource = true; sourceButton(h).click(); h.context.canOpenSource = false; h.controller.refresh();
  assert.equal(h.calls[0].isCurrent(), true); sourceButton(h, 'animation').dispatch('click'); assert.equal(h.calls.length, 1);
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
  value.entries[0].animation.source.sourcePath = 'replaced.json'; value.entries[0].animation.source.sourceRange.start = 99;
  sourceButton(h, 'animation').click(); await flushDialogs(); assert.equal(h.calls[0].source.sourcePath, 'documents/animations/动画.json'); assert.equal(h.calls[0].source.sourceRange.start, 0);
  assert.match(h.el('Navigation').textContent, /无法打开/); assert.equal(h.rows().length, 2);
  const old = sourceButton(h); h.controller.dispose(); old.dispatch('click'); assert.equal(h.calls.length, 1); assert.equal(h.subscriptions(), 0);
});

test('animation observation owns responsive styles and has no network, player or animation command authority', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-project-animation-observation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|fetchJsonApiRequest|requestWorldCommand|\.play_animation\(|\.seek_animation\(|requestAnimationFrame|new Audio\(/);
  const css = await fs.readFile(new URL('../../web/project-animation-observation.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 600px\)/); assert.match(css, /flex-direction: column/); assert.match(css, /overflow-wrap: anywhere/);
  const html = await fs.readFile(new URL('../../web/index.html', import.meta.url), 'utf8'); assert.equal(html.match(/href="\/web\/project-animation-observation.css"/g)?.length, 1);
});

test('pause and seek receipts show execution phase and playhead separately from the monotonic scene clock', async t => {
  const h = await fixture(t), first = entry(), second = entry(2);
  first.command = { action: 'pause' }; first.state.phase = 'paused';
  second.command = { action: 'seek', positionSeconds: 1.75 }; second.state = { sceneObjectId: id(1), phase: 'paused', positionSeconds: 1.75, timeSeconds: 0.5 };
  h.set({ sequence: 2, entries: [first, second] });
  assert.deepEqual(h.rows().map(row => row.querySelector('h4').textContent), ['已执行暂停命令', '已执行跳转命令']);
  assert.match(h.rows()[1].querySelector('.project-animation-state').textContent, /暂停.*1.75 秒/);
  assert.match(h.rows()[1].querySelector('.project-animation-sequence').textContent, /场景时间 0.5 秒/);
  assert.doesNotMatch(h.rows()[1].textContent, /正在播放|播放成功/);
});

test('malformed receipts revoke navigation and fail closed without reading accessors or serializers', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }); let invoked = 0;
  h.set(snapshot()); sourceButton(h).click();
  const value = snapshot(); Object.defineProperty(value.entries[0].state, 'positionSeconds', { get() { invoked++; return 0; }, enumerable: true });
  h.set(value); assert.equal(invoked, 0); assert.equal(h.el('Panel').hidden, true); assert.equal(h.calls[0].isCurrent(), false);
  pending.resolve(true); await flushDialogs();
  for (const mutate of [v => { v.sequence++; }, v => { v.entries[0].command.action = 'other'; }, v => { v.entries[0].state.positionSeconds = 99; },
    v => { v.toJSON = () => { invoked++; return snapshot(); }; }]) {
    h.set(snapshot()); const next = snapshot(); mutate(next); h.set(next); assert.equal(h.el('Panel').hidden, true);
  }
  assert.equal(invoked, 0);
});

test('all animation command view strings are translated without changing source identities', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-project-animation-observation.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)].map(match => match[1]));
  for (const key of keys) { assert.ok(en[key], 'English: ' + key); assert.ok(ja[key], 'Japanese: ' + key); }
});

function clipSnapshot() {
  const first = entry(); first.command = { action: 'select', clipId: id(60) };
  first.state = { ...first.state, phase: 'paused', positionSeconds: 0, clipId: id(60) };
  first.clip = { id: id(60), name: '<待机> / 待機 🌬️', startSeconds: .25, endSeconds: 1.25, loop: false,
    source: { ...first.animation.source, propertyPath: '/clips/0', sourceRange: { start: 100, end: 180, encoding: 'utf-16', propertyPath: '/clips/0', exact: true } } };
  return { sequence: 1, entries: [first] };
}
test('protocol6 selection receipts preserve clip names, local time and three independent source links', async t => {
  const h = await fixture(t), value = clipSnapshot(); h.controller.setSnapshot(value, { protocolVersion: 6 });
  assert.equal(h.rows().length, 1); assert.match(h.rows()[0].textContent, /<待机>.*0.25–1.25/);
  assert.equal(h.rows()[0].querySelector('h4').textContent, '已执行选择片段命令');
  for (const kind of ['behavior', 'animation', 'clip']) { sourceButton(h, kind).click(); await flushDialogs(); }
  assert.deepEqual(h.calls.map(c => c.source.propertyPath), ['/bindings/0', '', '/clips/0']);
  assert.equal(h.calls[2].source.sourceRange.start, 100); assert.equal(h.container.querySelector('img'), null);
  h.filter(id(60)); assert.equal(h.rows().length, 1); h.filter('待機'); assert.equal(h.rows().length, 1);
  for (const dictionary of [en, ja]) { h.language(dictionary); assert.equal(h.rows()[0].querySelector('h4').textContent, dictionary['已执行选择片段命令']); }
  h.controller.setSnapshot(value); assert.equal(h.el('Panel').hidden, true);
});
test('a changed clip declaration revokes in-flight navigation while invalid selection metadata hides the panel', async t => {
  const pending = deferred(), h = await fixture(t, { onOpen: () => pending.promise }), value = clipSnapshot();
  h.controller.setSnapshot(value, { protocolVersion: 6 }); sourceButton(h, 'clip').click();
  const next = structuredClone(value); next.entries[0].clip.source.sourceRange.end++;
  h.controller.setSnapshot(next, { protocolVersion: 6 }); assert.equal(h.calls[0].isCurrent(), false);
  pending.resolve(true); await flushDialogs();
  next.entries[0].clip.id = id(61); h.controller.setSnapshot(next, { protocolVersion: 6 }); assert.equal(h.el('Panel').hidden, true);
});


test('protocol7 preserves named clip command receipts independently of natural completion records', async t => {
  const h = await fixture(t); h.controller.setSnapshot(clipSnapshot(), { protocolVersion: 7 });
  assert.equal(h.el('Panel').hidden, false); assert.match(h.rows()[0].textContent, /待機/);
  assert.equal(h.rows()[0].querySelector('.project-animation-clip').hidden, false);
  h.filter(id(60)); assert.equal(h.rows().length, 1); sourceButton(h, 'clip').click(); await flushDialogs();
  assert.equal(h.calls[0].source.propertyPath, '/clips/0');
});
