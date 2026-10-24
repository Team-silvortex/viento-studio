import { createProjectAnimationStateReview } from '../../engine/project-animation-state-review.mjs';
import { validateProjectAnimationStateTriggeredEntriesSnapshot } from '../../engine/project-animation-state-entry-triggers.mjs';
import { describeProjectAnimationStateEntryTrigger } from '../../web/modules/app-project-animation-state-trigger.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { validateProjectAnimationStateEntriesSnapshot } from '../../engine/project-animation-state-entries.mjs';
import { deferred } from './editor-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const revision = 'sha256:' + 'a'.repeat(64);
const origin = (n = 1, visitIndex = 1) => ({ visitIndex, sceneId: id(1), bindingId: id(10 + n), instanceId: id(20 + n), objectId: id(30 + n),
  source: { objectId: id(40), sourcePath: 'documents/behaviors/衔接.json', sourceRevision: revision, propertyPath: '/bindings/' + (n - 1) } });
const scriptSource = () => ({ objectId: id(50), sourcePath: 'documents/scripts/待機 <img src=x>.txt', sourceRevision: revision, propertyPath: '' });
const entry = (sequence = 1, n = 1, visit = 1) => ({ sequence, origin: origin(n, visit), scriptSource: scriptSource(),
  timeSeconds: visit === 1 ? 0.25 : 0, commandSequence: 0, stateKey: 'idle', clipId: id(60) });
const snapshot = () => ({ sequence: 1, entries: [entry()] });
async function fixture(t, options = {}) {
  let dictionary = {}, languageChanged = () => {}, subscriptions = 0;
  const calls = [], context = { available: true, visible: true, sessionOwner: 'backend:task:build:snapshot:assembly', navigationOwner: 'visit-2', canOpenSource: true };
  const h = await dialogHarness('app-project-animation-state-entry-observation', { describeProjectAnimationStateEntryTrigger, validateProjectAnimationStateEntriesSnapshot, validateProjectAnimationStateTriggeredEntriesSnapshot,
    t: (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? ''),
    onLanguageChange(callback) { languageChanged = callback; subscriptions++; return () => { languageChanged = () => {}; subscriptions--; }; },
    createProjectAnimationStateReview, ...options.globals,
  });
  const container = h.document.createElement('div'); container.id = 'projectAnimationStateEntries'; container.isConnected = true; h.document.body.append(container);
  const observer = h.runtime.setupProjectAnimationStateEntryObservation({ container, getContext: () => context,
    onOpen: async (source, opts) => { calls.push({ source, ...opts }); return options.onOpen ? options.onOpen(source, opts) : true; } });
  t.after(() => observer.dispose());
  const el = suffix => h.element('projectAnimationStateEntries' + suffix);
  return { ...h, container, observer, context, calls, el, set: (value, opts) => observer.setSnapshot(value, opts),
    rows: () => el('Entries').children.filter(row => !row.hidden),
    filter(value) { el('Search').value = value; el('Search').dispatch('input'); },
    language(value) { dictionary = value; languageChanged(); }, subscriptions: () => subscriptions };
}
const sourceButton = (h, kind = 'binding', index = 0) => h.rows()[index].querySelector('.project-animation-state-entry-' + kind + '-source');

test('entry records use exact protocol-specific shapes; empty or forcibly cancelled histories never infer a state', async t => {
  const h = await fixture(t); h.set(null); assert.equal(h.el('Panel').hidden, true);
  h.set({ sequence: 0, entries: [] }); assert.equal(h.el('Panel').hidden, false); assert.equal(h.el('Sequence').dataset.sequence, '0');
  assert.equal(h.el('Empty').textContent, '尚未采集动画状态进入记录。'); assert.match(h.el('Note').textContent, /强制取消可能留下不完整记录/);
  for (const protocolVersion of [1, 2, 3, 4, 5, 6, 7, 8, 10, 11]) {
    h.set(snapshot()); h.set(snapshot(), { protocolVersion });
    assert.equal(h.el('Panel').hidden, true); assert.equal(h.rows().length, 0); assert.equal(h.el('Sequence').dataset.sequence, undefined);
  }
});

test('initial same-frame entries and repeated re-entry remain separate without claiming triggers or playback success', async t => {
  const h = await fixture(t), value = { sequence: 5, entries: [entry(1), entry(2, 2), entry(3), entry(4), entry(5)] };
  value.entries[2].stateKey = 'action'; h.set(value);
  assert.equal(h.rows().length, 5); assert.deepEqual(h.rows().map(row => row.dataset.stateKey), ['idle', 'idle', 'action', 'idle', 'idle']);
  assert.deepEqual(h.rows().map(row => row.dataset.bindingId), [id(11), id(12), id(11), id(11), id(11)]);
  assert.match(h.rows()[0].textContent, /脚本接受进入状态：idle/); assert.match(h.rows()[0].textContent, /进入时已执行动画命令序号：0/);
  assert.match(h.rows()[0].textContent, /第 1 次访问.*场景时间 0.25 秒/); assert.match(h.el('Note').textContent, /不推测触发原因，也不表示动画命令已经执行/);
  for (const row of h.rows()) assert.doesNotMatch(row.textContent, /初始进入|同状态重启|事件触发|自然完成触发|播放成功|已执行播放/);
});

test('clip and full-animation state selections are literal script choices', async t => {
  const h = await fixture(t); h.set(snapshot()); assert.match(h.rows()[0].textContent, new RegExp(id(60)));
  const value = snapshot(); value.entries[0].clipId = null; h.set(value); assert.match(h.rows()[0].textContent, /状态选择：完整动画/);
});

test('binding and script navigation carry exact separate provenance and an empty script pointer', async t => {
  const h = await fixture(t); h.set(snapshot());
  for (const kind of ['binding', 'script']) { sourceButton(h, kind).click(); await flushDialogs(); }
  assert.deepEqual(h.calls.map(call => JSON.parse(JSON.stringify(call.source))), [origin().source, scriptSource()]);
  assert.equal(h.calls[1].source.propertyPath, ''); assert.equal(h.calls[1].source.objectId, id(50));
});

test('filtering by scene binding script and state keeps repeated entries and distinguishes bindings sharing a script', async t => {
  const h = await fixture(t), value = { sequence: 5, entries: [entry(1), entry(2, 2), entry(3), entry(4), entry(5)] };
  value.entries[2].stateKey = 'action'; h.set(value);
  for (const filter of [id(50), '待機', id(1)]) { h.filter(filter); assert.equal(h.rows().length, 5); }
  h.filter(id(11)); assert.equal(h.rows().length, 4); h.filter('action'); assert.equal(h.rows().length, 1);
  assert.equal(h.rows()[0].dataset.sequence, '3');
  h.filter('no-match'); assert.equal(h.rows().length, 0); assert.equal(h.el('Empty').textContent, '没有匹配的动画状态进入记录。');
  h.context.navigationOwner = 'visit-3'; h.observer.refresh(); assert.equal(h.el('Search').value, 'no-match');
  h.context.sessionOwner = 'new-run'; h.observer.refresh(); assert.equal(h.el('Search').value, ''); assert.equal(h.el('Panel').hidden, true);
});

test('language changes preserve literal author data focused search selection and admitted row nodes', async t => {
  const h = await fixture(t); h.set(snapshot()); const row = h.rows()[0], search = h.el('Search'); h.filter('待機'); search.focus(); search.selectionStart = 0; search.selectionEnd = 1;
  for (const dictionary of [en, ja, {}]) {
    h.language(dictionary); assert.equal(h.el('Title').textContent, dictionary['动画状态进入记录'] || '动画状态进入记录');
    assert.equal(h.rows()[0], row); assert.equal(row.querySelector('h4').textContent, (dictionary['脚本接受进入状态：{0}'] || '脚本接受进入状态：{0}').replace('{0}', 'idle'));
    assert.match(row.textContent, /待機 <img src=x>.txt/); assert.equal(h.container.querySelector('img'), null);
    assert.equal(h.document.activeElement, search); assert.deepEqual([search.value, search.selectionStart, search.selectionEnd], ['待機', 0, 1]);
  }
});

test('appending same-binding repeated entries and new visits retains focused buttons filters and pending navigation', async t => {
  const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }); h.set(snapshot()); h.filter('idle');
  const button = sourceButton(h, 'script'); button.focus(); button.click(); h.language(ja);
  const next = snapshot(); next.sequence = 3; next.entries.push(entry(2), entry(3, 1, 2)); h.set(next);
  assert.equal(sourceButton(h, 'script'), button); assert.equal(h.document.activeElement, button); assert.equal(h.calls[0].isCurrent(), true);
  assert.equal(h.el('Search').value, 'idle'); assert.equal(h.rows().length, 3); gate.resolve(true); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true);
});

test('replacing a record revokes its old source handle while changing another record preserves navigation', async t => {
  for (const change of ['script', 'binding', 'state', 'clip', 'time', 'command', 'sibling']) {
    const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }); h.set(snapshot()); const old = sourceButton(h, 'script'); old.click();
    const next = snapshot(), item = next.entries[0];
    if (change === 'script') item.scriptSource.sourceRevision = 'sha256:' + 'b'.repeat(64);
    else if (change === 'binding') item.origin.source.propertyPath = '/bindings/2';
    else if (change === 'state') item.stateKey = 'attack';
    else if (change === 'clip') item.clipId = null;
    else if (change === 'time') item.timeSeconds++;
    else if (change === 'command') item.commandSequence++;
    else { next.sequence = 2; next.entries.push(entry(2, 2)); }
    h.set(next); assert.equal(h.calls[0].isCurrent(), change === 'sibling', change);
    old.dispatch('click'); assert.equal(h.calls.length, 1); gate.resolve(true); await flushDialogs();
  }
});

test('visit task visibility capability detachment removal filtering and protocol change revoke delayed reads', async t => {
  for (const change of ['visit', 'task', 'hidden', 'capability', 'detached', 'removed', 'filter', 'protocol']) {
    const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }); h.set(snapshot()); sourceButton(h).click();
    if (change === 'visit') h.context.navigationOwner = 'visit-3';
    else if (change === 'task') h.context.sessionOwner = 'new-run';
    else if (change === 'hidden') h.context.visible = false;
    else if (change === 'capability') h.context.available = false;
    else if (change === 'detached') h.container.isConnected = false;
    else if (change === 'removed') h.set(null);
    else if (change === 'protocol') h.set(snapshot(), { protocolVersion: 8 });
    else h.filter('attack');
    h.observer.refresh(); assert.equal(h.calls[0].isCurrent(), false, change);
    gate.reject(Error('late')); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true);
  }
});

test('busy click admission and own-loading are distinct and single-flight guards preserve admitted navigation', async t => {
  const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }); h.set(snapshot());
  h.context.canOpenSource = false; sourceButton(h).dispatch('click'); assert.equal(h.calls.length, 0);
  h.context.canOpenSource = true; sourceButton(h).click(); h.context.canOpenSource = false; h.observer.refresh();
  assert.equal(h.calls[0].isCurrent(), true); sourceButton(h, 'script').dispatch('click'); assert.equal(h.calls.length, 1);
  gate.resolve(true); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true);
});

test('validation rejects forged shape and accessors while caller mutation cannot redirect frozen navigation', async t => {
  const h = await fixture(t), value = snapshot(); h.set(value); value.entries[0].scriptSource.sourcePath = 'redirect.txt';
  sourceButton(h, 'script').click(); await flushDialogs(); assert.equal(h.calls[0].source.sourcePath, scriptSource().sourcePath);
  let invoked = 0;
  for (const mutate of [v => { v.sequence++; }, v => { v.entries[0].reason = 'event'; }, v => { v.entries[0].status = 'active'; },
    v => { v.entries[0].stateKey = '<img>'; }, v => { v.entries[0].scriptSource.propertyPath = '/bindings/0'; },
    v => { v.toJSON = () => { invoked++; return snapshot(); }; },
    v => Object.defineProperty(v.entries[0], 'clipId', { enumerable: true, get() { invoked++; return null; } })]) {
    h.set(snapshot()); const bad = snapshot(); mutate(bad); h.set(bad); assert.equal(h.el('Panel').hidden, true); assert.equal(h.rows().length, 0);
  }
  assert.equal(invoked, 0);
});

test('navigation failure preserves records and disposal revokes old controls and language listeners', async t => {
  const h = await fixture(t, { onOpen: () => { throw Error('missing'); } }); h.set(snapshot()); sourceButton(h).click(); await flushDialogs();
  assert.match(h.el('Navigation').textContent, /无法打开动画状态进入来源/); assert.equal(h.rows().length, 1);
  const old = sourceButton(h); h.observer.dispose(); old.dispatch('click'); assert.equal(h.calls.length, 1); assert.equal(h.subscriptions(), 0);
});

test('entry view is responsive and translated without execution authoring polling or inferred playback authority', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-project-animation-state-entry-observation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|fetchJsonApiRequest|requestWorldCommand|\.play_animation\(|\.subscribe_animation_completed\(|requestAnimationFrame|setInterval|setTimeout|new Audio\(/);
  const keys = new Set([...source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)].map(match => match[1]));
  for (const key of keys) { assert.ok(en[key], 'English: ' + key); assert.ok(ja[key], 'Japanese: ' + key); }
  const css = await fs.readFile(new URL('../../web/project-animation-state-entry-observation.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 600px\)/); assert.match(css, /flex-direction: column/); assert.match(css, /overflow-wrap: anywhere/);
  const html = await fs.readFile(new URL('../../web/index.html', import.meta.url), 'utf8'); assert.equal(html.match(/href="\/web\/project-animation-state-entry-observation.css"/g)?.length, 1);
});


test('protocol10 displays recorded sources while default protocol9 rejects new trigger fields', async t => {
  const h = await fixture(t), triggers = [{ kind: 'initial' }, { kind: 'event', eventSequence: 2, subscriptionId: 7 },
    { kind: 'completed', completionSequence: 1, subscriptionId: 8 }, { kind: 'direct' }];
  const value = { sequence: 4, entries: triggers.map((trigger, i) => ({ ...entry(i + 1), trigger })) };
  h.set(value); assert.equal(h.el('Panel').hidden, true);
  h.set(value, { protocolVersion: 10 }); assert.equal(h.el('Panel').hidden, false);
  assert.deepEqual(h.rows().map(row => row.querySelector('.project-animation-state-entry-trigger').dataset.kind), ['initial', 'event', 'completed', 'direct']);
  assert.match(h.rows()[0].textContent, /初始化回调/); assert.match(h.rows()[1].textContent, /事件 #2 · 订阅 7/);
  assert.match(h.rows()[2].textContent, /自然完成 #1 · 订阅 8/); assert.match(h.rows()[3].textContent, /直接进入/);
  assert.match(h.el('Note').textContent, /不包含分支命中或条件求值过程/);
  h.set(snapshot()); assert.match(h.rows()[0].textContent, /进入来源：未记录（协议 9）/);
  h.set(snapshot(), { protocolVersion: 10 }); assert.equal(h.el('Panel').hidden, true);
  h.set({ sequence: 0, entries: [] }, { protocolVersion: 10 }); assert.equal(h.el('Panel').hidden, false);
});

test('protocol10 source labels keep row and keyboard focus across languages and reject forged trigger snapshots', async t => {
  const h = await fixture(t), value = { sequence: 1, entries: [{ ...entry(), trigger: { kind: 'event', eventSequence: 1, subscriptionId: 4 } }] };
  h.set(value, { protocolVersion: 10 }); const row = h.rows()[0], source = sourceButton(h); source.focus();
  for (const dictionary of [en, ja, {}]) {
    h.language(dictionary); assert.equal(h.rows()[0], row); assert.equal(h.document.activeElement, source);
    assert.equal(row.querySelector('.project-animation-state-entry-trigger').textContent,
      (dictionary['进入来源：事件 #{0} · 订阅 {1}'] || '进入来源：事件 #{0} · 订阅 {1}').replace('{0}', '1').replace('{1}', '4'));
  }
  let invoked = 0;
  for (const mutate of [v => delete v.entries[0].trigger, v => v.entries[0].trigger.eventSequence = 0,
    v => v.entries[0].trigger.kind = 'guessed', v => v.entries[0].trigger.branch = 1,
    v => Object.defineProperty(v.entries[0].trigger, 'eventSequence', { enumerable: true, get() { invoked++; return 1; } })]) {
    const bad = structuredClone(value); mutate(bad); h.set(bad, { protocolVersion: 10 }); assert.equal(h.el('Panel').hidden, true);
  }
  assert.equal(invoked, 0);
  const helper = await fs.readFile(new URL('../../web/modules/app-project-animation-state-trigger.js', import.meta.url), 'utf8');
  for (const match of helper.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) { assert.ok(en[match[1]], match[1]); assert.ok(ja[match[1]], match[1]); }
});


test('whole observations preserve exact protocol10 entry admission and forward validated review snapshots', async t => {
  const received = [], selected = [];
  // setObservation creates this envelope in the VM after real core admission.
  // Rebuild only that envelope for the host validator, as browser modules share one realm.
  const h = await fixture(t, { globals: {
    validateProjectAnimationStateTriggeredEntriesSnapshot: value => validateProjectAnimationStateTriggeredEntriesSnapshot({ sequence: value.sequence, entries: value.entries }),
    validateProjectAnimationStateEntriesSnapshot: value => validateProjectAnimationStateEntriesSnapshot({ sequence: value.sequence, entries: value.entries }),
    setupProjectAnimationStateReview: () => ({
    setSnapshot(value) { received.push(value); return Boolean(value); }, selectEntry(sequence) { selected.push(sequence); return true; }, refresh() {}, dispose() {},
  }) } });
  const value = { format: 'viento-runtime-observation', schemaVersion: 1, sceneObjectId: id(1), protocolVersion: 1, phase: 'ready', sequence: 1, actors: [],
    project: { protocolVersion: 10, assemblyId: id(90), entrySceneId: id(1), activeSceneId: id(1), visits: [{ index: 1, sceneId: id(1), phase: 'ready', elapsedSeconds: 0 }],
      sharedState: { revision: 0, entries: [], lastChange: null }, events: { sequence: 0, entries: [] }, audioCommands: { sequence: 0, entries: [] },
      animationCommands: { sequence: 0, entries: [] }, animationCompletions: { sequence: 0, entries: [] }, animationStates: { sequence: 0, entries: [] },
      animationStateEntries: { sequence: 1, entries: [{ ...entry(), clipId: null, trigger: { kind: 'initial' } }] } } };
  h.observer.setObservation(value); assert.equal(h.el('Panel').hidden, false); assert.match(h.rows()[0].textContent, /初始化回调/);
  assert.equal(received.at(-1), value); h.filter('no-match'); assert.equal(h.observer.selectEntry(1), true); assert.deepEqual(selected, [1]);
  h.filter(''); h.rows()[0].querySelector('.project-animation-state-entry-review').click(); assert.deepEqual(selected, [1, 1]);
  const legacy = structuredClone(value); legacy.project.protocolVersion = 9; delete legacy.project.animationStateEntries.entries[0].trigger;
  h.observer.setObservation(legacy); assert.match(h.rows()[0].textContent, /来源：未记录/); assert.equal(received.at(-1), legacy);
  const forged = structuredClone(value); forged.project.protocolVersion = 9; h.observer.setObservation(forged);
  assert.equal(h.el('Panel').hidden, true); assert.equal(received.at(-1), null); assert.equal(h.observer.selectEntry(1), false);
});
