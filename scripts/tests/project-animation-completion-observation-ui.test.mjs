import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { validateProjectAnimationCompletionsSnapshot } from '../../engine/project-animation-completions.mjs';
import { deferred } from './editor-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const revision = 'sha256:' + 'a'.repeat(64);
const origin = (n = 1) => ({ visitIndex: 1, sceneId: id(1), bindingId: id(10 + n), instanceId: id(20 + n), objectId: id(30 + n),
  source: { objectId: id(40), sourcePath: 'documents/behaviors/衔接.json', sourceRevision: revision, propertyPath: '/bindings/' + (n - 1) } });
const animation = () => ({ objectId: id(50), durationSeconds: 2, loop: false,
  source: { objectId: id(50), sourcePath: 'documents/animations/动画.json', sourceRevision: revision,
    propertyPath: '', sourceRange: { start: 0, end: 297, encoding: 'utf-16', propertyPath: '', exact: true } } });
const entry = (sequence = 1) => ({ sequence, commandSequence: sequence - 1, visitIndex: 1, sceneId: id(1),
  state: { sceneObjectId: id(1), phase: 'finished', positionSeconds: 2, timeSeconds: sequence * 2, clipId: null },
  animation: animation(), clip: null, deliveries: [{ subscriptionId: 1, origin: origin(), status: 'handled' }] });
const snapshot = () => ({ sequence: 1, entries: [entry()] });
function clipSnapshot() {
  const value = snapshot(), first = value.entries[0];
  first.clip = { id: id(60), name: '<攻击> / 攻撃 🌬️', startSeconds: .25, endSeconds: 1.25, loop: false,
    source: { ...first.animation.source, propertyPath: '/clips/0', sourceRange: { start: 100, end: 180, encoding: 'utf-16', propertyPath: '/clips/0', exact: true } } };
  first.state.clipId = first.clip.id; first.state.positionSeconds = 1; first.state.timeSeconds = 1;
  return value;
}
async function fixture(t, options = {}) {
  let dictionary = {}, languageChanged = () => {}, subscriptions = 0;
  const calls = [], context = { available: true, visible: true, sessionOwner: 'backend:task:build:snapshot:assembly', navigationOwner: 'visit-2', canOpenSource: true };
  const h = await dialogHarness('app-project-animation-completion-observation', {
    validateProjectAnimationCompletionsSnapshot,
    t: (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? ''),
    onLanguageChange(callback) { languageChanged = callback; subscriptions++; return () => { languageChanged = () => {}; subscriptions--; }; },
  });
  const container = h.document.createElement('div'); container.id = 'projectAnimationCompletions'; container.isConnected = true; h.document.body.append(container);
  const controller = h.runtime.setupProjectAnimationCompletionObservation({ container, getContext: () => context,
    onReviewTarget: options.onReviewTarget, onOpen: async (source, opts) => { calls.push({ source, ...opts }); return options.onOpen ? options.onOpen(source, opts) : true; } });
  t.after(() => controller.dispose());
  const el = suffix => h.element('projectAnimationCompletions' + suffix);
  return { ...h, container, controller, context, calls, el, set: (value, options) => controller.setSnapshot(value, options),
    rows: () => el('Entries').children.filter(row => !row.hidden),
    filter(value) { el('Search').value = value; el('Search').dispatch('input'); },
    language(value) { dictionary = value; languageChanged(); }, subscriptions: () => subscriptions };
}
const sourceButton = (h, kind = 'animation') => h.rows()[0].querySelector('.project-animation-completion-' + kind + '-source');

test('completion panels admit protocols7–10 and distinguish an empty supported history from no support', async t => {
  const h = await fixture(t); h.set(null); assert.equal(h.el('Panel').hidden, true);
  h.set({ sequence: 0, entries: [] }); assert.equal(h.el('Panel').hidden, false); assert.equal(h.el('Sequence').dataset.sequence, '0');
  assert.match(h.el('Empty').textContent, /当前没有动画自然完成/);
  for (const protocolVersion of [1, 2, 3, 4, 5, 6, 11]) {
    h.set(snapshot(), { protocolVersion: 7 }); h.set(snapshot(), { protocolVersion });
    assert.equal(h.el('Panel').hidden, true); assert.equal(h.rows().length, 0); assert.equal(h.el('Sequence').dataset.sequence, undefined);
  }
});

test('whole and clip completions show the frozen scene clock, local endpoint and command sequence', async t => {
  const h = await fixture(t); h.set(snapshot());
  assert.equal(h.rows()[0].querySelector('h4').textContent, '动画已自然完成');
  assert.match(h.rows()[0].textContent, /完整动画/); assert.match(h.rows()[0].textContent, /完成时播放头 2 秒.*命令序号 0/);
  assert.match(h.rows()[0].textContent, /第 1 次访问.*场景时间 2 秒/);
  h.set(clipSnapshot()); assert.match(h.rows()[0].textContent, /<攻击>.*0.25–1.25/); assert.match(h.rows()[0].textContent, /完成时播放头 1 秒/);
  assert.match(h.el('Note').textContent, /停止、跳转到末尾和循环边界不会/);
  assert.match(h.el('DeliveryNote').textContent, /不保证后续动画命令已经执行/);
});

test('pending handled and skipped deliveries expose subscriber identities without claiming permanent unsubscription', async t => {
  const h = await fixture(t), value = snapshot();
  value.entries[0].deliveries = ['handled', 'skipped', 'pending'].map((status, i) => ({ subscriptionId: i + 1, origin: origin(i + 1), status })); h.set(value);
  assert.deepEqual(h.rows()[0].querySelectorAll('.project-animation-completion-delivery').map(row => row.dataset.status), ['handled', 'skipped', 'pending']);
  assert.match(h.rows()[0].textContent, /同步回调成功/); assert.match(h.rows()[0].textContent, /本次未调用/); assert.match(h.rows()[0].textContent, /等待处理/);
  assert.match(h.rows()[0].textContent, new RegExp('对象 ' + id(31))); assert.doesNotMatch(h.rows()[0].textContent, /脚本/);
  assert.match(h.rows()[0].textContent, new RegExp(id(11)));  assert.match(h.rows()[0].textContent, new RegExp(id(21))); assert.match(h.rows()[0].textContent, new RegExp(id(31)));
  assert.doesNotMatch(h.rows()[0].textContent, /已取消订阅|动画已播放/); assert.match(h.el('DeliveryNote').textContent, /不代表永久退订/);
  value.entries[0].deliveries = []; h.set(value); assert.match(h.rows()[0].textContent, /完成时没有订阅者/);
});

test('animation clip and subscriber links carry distinct exact source identities without a fictional publisher', async t => {
  const h = await fixture(t), value = clipSnapshot(); h.set(value);
  for (const kind of ['animation', 'clip', 'subscriber']) { sourceButton(h, kind).click(); await flushDialogs(); }
  assert.deepEqual(h.calls.map(call => JSON.parse(JSON.stringify(call.source))), [value.entries[0].animation.source, value.entries[0].clip.source, origin().source]);
  assert.equal(h.calls[1].source.sourceRange.start, 100); assert.equal(h.calls[2].source.objectId, id(40)); assert.notEqual(h.calls[2].source.objectId, origin().objectId);
  assert.equal(h.container.querySelector('.project-animation-completion-publisher-source'), null);
});

test('three languages preserve literal author data and focused filtering state', async t => {
  const h = await fixture(t), value = clipSnapshot(); value.entries[0].deliveries[0].origin.source.sourcePath = 'documents/<img src=x>.json'; h.set(value);
  const search = h.el('Search'); h.filter('攻'); search.focus(); search.selectionStart = 0; search.selectionEnd = 1;
  for (const dictionary of [en, ja, {}]) {
    h.language(dictionary); assert.equal(h.el('Title').textContent, dictionary['动画自然完成记录'] || '动画自然完成记录');
    assert.equal(h.rows()[0].querySelector('h4').textContent, dictionary['动画已自然完成'] || '动画已自然完成');
    assert.match(h.rows()[0].textContent, /documents\/<img src=x>.json/); assert.equal(h.container.querySelector('img'), null);
    assert.equal(h.document.activeElement, search); assert.deepEqual([search.value, search.selectionStart, search.selectionEnd], ['攻', 0, 1]);
  }
});

test('filtering supports scene animation clip ID and name; a new run clears history and filters', async t => {
  const h = await fixture(t); h.set(clipSnapshot());
  for (const filter of [id(1), id(50), id(60), '攻撃']) { h.filter(filter); assert.equal(h.rows().length, 1); }
  h.filter('no match'); assert.equal(h.rows().length, 0);
  h.context.navigationOwner = 'visit-3'; h.controller.refresh(); assert.equal(h.el('Search').value, 'no match');
  h.context.sessionOwner = 'new-run'; h.controller.refresh(); assert.equal(h.el('Search').value, ''); assert.equal(h.el('Panel').hidden, true);
});

test('delivery updates and appended completions retain a focused animation source and its admitted navigation', async t => {
  const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }), initial = snapshot(); initial.entries[0].deliveries[0].status = 'pending'; h.set(initial);
  const button = sourceButton(h); button.focus(); button.click(); h.set(snapshot()); h.language(ja);
  assert.equal(sourceButton(h), button); assert.equal(h.document.activeElement, button); assert.equal(h.calls[0].isCurrent(), true);
  const next = snapshot(); next.sequence = 2; next.entries.push(entry(2)); h.set(next); assert.equal(sourceButton(h), button); assert.equal(h.calls[0].isCurrent(), true);
  gate.resolve(true); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true);
});

test('only the changed subscriber ticket is revoked when its delivery status changes', async t => {
  const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }), initial = snapshot(); initial.entries[0].deliveries[0].status = 'pending'; h.set(initial);
  const old = sourceButton(h, 'subscriber'); old.click(); h.set(snapshot());
  assert.equal(h.calls[0].isCurrent(), false); old.dispatch('click'); assert.equal(h.calls.length, 1);
  gate.resolve(true); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true);
});

test('changed provenance or completion identity revokes retained source controls', async t => {
  for (const change of ['animation', 'clip', 'clock', 'commands']) {
    const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }); h.set(clipSnapshot()); const old = sourceButton(h, 'clip'); old.click();
    const next = clipSnapshot();
    if (change === 'animation') next.entries[0].animation.source.sourceRange.end++;
    else if (change === 'clip') next.entries[0].clip.source.sourceRange.end++;
    else if (change === 'clock') next.entries[0].state.timeSeconds++;
    else next.entries[0].commandSequence++;
    h.set(next); assert.equal(h.calls[0].isCurrent(), false, change); old.dispatch('click'); assert.equal(h.calls.length, 1);
    gate.resolve(true); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true);
  }
});

test('visit task visibility capability removal and filtering revoke delayed completion-source reads', async t => {
  for (const change of ['visit', 'task', 'hidden', 'capability', 'removed', 'filter']) {
    const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }); h.set(snapshot()); sourceButton(h).click();
    if (change === 'visit') h.context.navigationOwner = 'visit-3';
    else if (change === 'task') h.context.sessionOwner = 'new-run';
    else if (change === 'hidden') h.context.visible = false;
    else if (change === 'capability') h.context.available = false;
    else if (change === 'removed') h.set(null);
    else h.filter('no-match');
    h.controller.refresh(); assert.equal(h.calls[0].isCurrent(), false, change);
    gate.reject(Error('late')); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true);
  }
});

test('busy admission blocks new navigation but does not revoke an admitted read when the host enters own-loading', async t => {
  const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }); h.set(snapshot());
  h.context.canOpenSource = false; sourceButton(h).dispatch('click'); assert.equal(h.calls.length, 0);
  h.context.canOpenSource = true; sourceButton(h).click(); h.context.canOpenSource = false; h.controller.refresh();
  assert.equal(h.calls[0].isCurrent(), true); sourceButton(h, 'subscriber').dispatch('click'); assert.equal(h.calls.length, 1);
  gate.resolve(true); await flushDialogs();
});

test('invalid completion snapshots fail closed without invoking accessors and detached input cannot redirect source reads', async t => {
  const h = await fixture(t), value = clipSnapshot(); h.set(value); value.entries[0].clip.source.sourceRange.start = 99;
  sourceButton(h, 'clip').click(); await flushDialogs(); assert.equal(h.calls[0].source.sourceRange.start, 100);
  let invoked = 0;
  for (const mutate of [v => { v.sequence++; }, v => { v.entries[0].state.phase = 'stopped'; }, v => { v.entries[0].animation.loop = true; },
    v => { v.entries[0].deliveries[0].status = 'cancelled'; }, v => { v.toJSON = () => { invoked++; return snapshot(); }; },
    v => Object.defineProperty(v.entries[0].state, 'clipId', { enumerable: true, get() { invoked++; return null; } })]) {
    h.set(snapshot()); const next = snapshot(); mutate(next); h.set(next); assert.equal(h.el('Panel').hidden, true); assert.equal(h.rows().length, 0);
  }
  assert.equal(invoked, 0);
});

test('failed navigation preserves records and disposal revokes old controls and language listeners', async t => {
  const h = await fixture(t, { onOpen: () => { throw Error('missing'); } }); h.set(snapshot()); sourceButton(h).click(); await flushDialogs();
  assert.match(h.el('Navigation').textContent, /无法打开动画完成/); assert.equal(h.rows().length, 1);
  const old = sourceButton(h); h.controller.dispose(); old.dispatch('click'); assert.equal(h.calls.length, 1); assert.equal(h.subscriptions(), 0);
});

test('completion observation owns responsive styles and translated text without network or animation authority', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-project-animation-completion-observation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|fetchJsonApiRequest|requestWorldCommand|\.play_animation\(|\.subscribe_animation_completed\(|requestAnimationFrame|new Audio\(/);
  const keys = new Set([...source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)].map(match => match[1]));
  for (const key of keys) { assert.ok(en[key], 'English: ' + key); assert.ok(ja[key], 'Japanese: ' + key); }
  const css = await fs.readFile(new URL('../../web/project-animation-completion-observation.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 600px\)/); assert.match(css, /flex-direction: column/); assert.match(css, /overflow-wrap: anywhere/);
  const html = await fs.readFile(new URL('../../web/index.html', import.meta.url), 'utf8'); assert.equal(html.match(/href="\/web\/project-animation-completion-observation.css"/g)?.length, 1);
});

test('protocol8 retains completion provenance beside state snapshots', async t => {
  const h = await fixture(t); h.set(clipSnapshot(), { protocolVersion: 8 });
  assert.equal(h.el('Panel').hidden, false); assert.equal(h.rows().length, 1);
  sourceButton(h, 'subscriber').click(); await flushDialogs(); assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].source)), origin().source);
});

test('protocol9 retains completion provenance beside state snapshots', async t => {
  const h = await fixture(t); h.set(clipSnapshot(), { protocolVersion: 9 });
  assert.equal(h.el('Panel').hidden, false); assert.equal(h.rows().length, 1);
  sourceButton(h, 'subscriber').click(); await flushDialogs(); assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].source)), origin().source);
});

test('protocol10 retains completion provenance beside state snapshots', async t => {
  const h = await fixture(t); h.set(clipSnapshot(), { protocolVersion: 10 });
  assert.equal(h.el('Panel').hidden, false); assert.equal(h.rows().length, 1);
  sourceButton(h, 'subscriber').click(); await flushDialogs(); assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].source)), origin().source);
});

function targetCompletions() {
  const first = entry(), second = entry(2);
  for (const [index, value] of [first, second].entries()) {
    value.commandSequence = 2; value.targetCommandSequence = index + 1; value.state.timeSeconds = 2;
    value.target = { kind: 'instance', instanceId: origin(index + 1).instanceId };
    value.deliveries = [{ subscriptionId: index + 1, origin: origin(index + 1), status: 'handled' }];
  }
  return { sequence: 2, entries: [first, second] };
}
test('protocol11 displays simultaneous independent completions with separate lane anchors and instance filtering', async t => {
  const h = await fixture(t), value = targetCompletions(); h.set(value, { protocolVersion: 11 });
  assert.equal(h.rows().length, 2); assert.deepEqual(h.rows().map(row => row.dataset.targetInstanceId), [id(21), id(22)]);
  assert.equal(h.rows()[0].querySelector('.project-animation-completion-anchor').textContent, '目标最后命令序号 1 · 全部命令截止 2');
  assert.equal(h.rows()[1].querySelector('.project-animation-completion-anchor').textContent, '目标最后命令序号 2 · 全部命令截止 2');
  h.filter(id(22)); const search = h.el('Search'); search.focus(); search.selectionStart = 1; search.selectionEnd = 4;
  for (const dictionary of [{}, en, ja]) {
    h.language(dictionary); assert.equal(h.rows().length, 1); assert.equal(h.rows()[0].dataset.sequence, '2');
    assert.equal(h.rows()[0].querySelector('.project-animation-completion-target').textContent, (dictionary['动画目标：实例 {0}'] || '动画目标：实例 {0}').replace('{0}', id(22)));
    assert.equal(h.document.activeElement, search); assert.deepEqual([search.selectionStart, search.selectionEnd], [1, 4]);
  }
  sourceButton(h, 'subscriber').click(); await flushDialogs(); assert.equal(h.calls[0].source.propertyPath, '/bindings/1');
  h.set(value, { protocolVersion: 10 }); assert.equal(h.el('Panel').hidden, true);
  delete value.entries[0].target; h.set(value, { protocolVersion: 11 }); assert.equal(h.el('Panel').hidden, true);
});

test('protocol11 changed completion target identity revokes delayed source navigation', async t => {
  const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }), value = targetCompletions();
  h.set(value, { protocolVersion: 11 }); sourceButton(h).click();
  const changed = structuredClone(value); changed.entries[0].target.instanceId = id(99); changed.entries[0].deliveries[0].origin.instanceId = id(99);
  h.set(changed, { protocolVersion: 11 }); assert.equal(h.rows().length, 2); assert.equal(h.calls[0].isCurrent(), false);
  gate.resolve(true); await flushDialogs();
  const scene = snapshot(); scene.entries[0].target = { kind: 'scene' }; scene.entries[0].targetCommandSequence = 0;
  h.set(scene, { protocolVersion: 11 }); assert.equal(h.rows()[0].querySelector('.project-animation-completion-target').textContent, '动画目标：整场景');
});


test('target review opener preserves record identity and cannot activate detached or filtered receipts', async t => {
  const reviewed = [], h = await fixture(t, { onReviewTarget: (record, context) => reviewed.push({ record, ...context }) });
  h.set(targetCompletions(), { protocolVersion: 11 });
  const button = h.rows()[0].querySelector('.project-animation-completion-target-review-open'); button.click();
  assert.deepEqual(JSON.parse(JSON.stringify(reviewed[0].record)), { kind: 'completion', sequence: 1 }); assert.equal(reviewed[0].isCurrent(), true);
  h.filter('no-match'); button.dispatch('click'); assert.equal(reviewed.length, 1); assert.equal(reviewed[0].isCurrent(), false);
  h.controller.focusRecord(1); assert.equal(h.document.activeElement, h.el('Search'));
  h.filter(''); h.controller.focusRecord(1); assert.equal(h.document.activeElement, button);
  h.context.sessionOwner = 'new-run'; h.controller.refresh(); button.dispatch('click'); assert.equal(reviewed.length, 1);
  assert.equal(h.controller.focusRecord(1), false);
});
