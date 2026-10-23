import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { validateProjectAnimationStatesSnapshot } from '../../engine/project-animation-states.mjs';
import { deferred } from './editor-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const revision = 'sha256:' + 'a'.repeat(64);
const origin = (n = 1, visitIndex = 1) => ({ visitIndex, sceneId: id(1), bindingId: id(10 + n), instanceId: id(20 + n), objectId: id(30 + n),
  source: { objectId: id(40), sourcePath: 'documents/behaviors/衔接.json', sourceRevision: revision, propertyPath: '/bindings/' + (n - 1) } });
const scriptSource = () => ({ objectId: id(50), sourcePath: 'documents/scripts/待機 <img src=x>.txt', sourceRevision: revision, propertyPath: '' });
const controller = (n = 1, visitIndex = 1) => ({ origin: origin(n, visitIndex), scriptSource: scriptSource(), status: 'active', stateKey: 'idle', clipId: id(60) });
const entry = (sequence = 1) => ({ sequence, visitIndex: sequence, sceneId: id(1), timeSeconds: sequence * 2, commandSequence: sequence,
  reason: 'switch', controllers: [controller(1, sequence), controller(2, sequence)] });
const snapshot = () => ({ sequence: 1, entries: [entry()] });
async function fixture(t, options = {}) {
  let dictionary = {}, languageChanged = () => {}, subscriptions = 0;
  const calls = [], context = { available: true, visible: true, sessionOwner: 'backend:task:build:snapshot:assembly', navigationOwner: 'visit-2', canOpenSource: true };
  const h = await dialogHarness('app-project-animation-state-observation', { validateProjectAnimationStatesSnapshot,
    t: (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? ''),
    onLanguageChange(callback) { languageChanged = callback; subscriptions++; return () => { languageChanged = () => {}; subscriptions--; }; },
  });
  const container = h.document.createElement('div'); container.id = 'projectAnimationStates'; container.isConnected = true; h.document.body.append(container);
  const observer = h.runtime.setupProjectAnimationStateObservation({ container, getContext: () => context,
    onOpen: async (source, opts) => { calls.push({ source, ...opts }); return options.onOpen ? options.onOpen(source, opts) : true; } });
  t.after(() => observer.dispose());
  const el = suffix => h.element('projectAnimationStates' + suffix);
  return { ...h, container, observer, context, calls, el, set: (value, opts) => observer.setSnapshot(value, opts),
    rows: () => el('Entries').children.filter(row => !row.hidden),
    controllers: () => el('Entries').children.filter(row => !row.hidden).flatMap(row => row.querySelectorAll('.project-animation-state-controller').filter(item => !item.hidden)),
    filter(value) { el('Search').value = value; el('Search').dispatch('input'); },
    language(value) { dictionary = value; languageChanged(); }, subscriptions: () => subscriptions };
}
const sourceButton = (h, kind = 'binding', index = 0) => h.controllers()[index].querySelector('.project-animation-state-' + kind + '-source');

test('protocols8–9 expose snapshots and no samples mean uncollected rather than a guessed state', async t => {
  const h = await fixture(t); h.set(null); assert.equal(h.el('Panel').hidden, true);
  h.set({ sequence: 0, entries: [] }); assert.equal(h.el('Panel').hidden, false); assert.equal(h.el('Sequence').dataset.sequence, '0');
  assert.equal(h.el('Empty').textContent, '尚未采集动画状态快照。');
  assert.match(h.el('Note').textContent, /强制取消可能没有记录/);
  for (const protocolVersion of [1, 2, 3, 4, 5, 6, 7, 10]) {
    h.set(snapshot()); h.set(snapshot(), { protocolVersion });
    assert.equal(h.el('Panel').hidden, true); assert.equal(h.rows().length, 0); assert.equal(h.el('Sequence').dataset.sequence, undefined);
  }
});

test('two bindings to one script stay distinct and accepted states are separate from executed command sequences', async t => {
  const h = await fixture(t), value = snapshot(); value.entries[0].controllers[1].stateKey = 'attack'; h.set(value);
  assert.equal(h.rows().length, 1); assert.equal(h.controllers().length, 2);
  assert.deepEqual(h.controllers().map(item => item.dataset.bindingId), [id(11), id(12)]);
  assert.match(h.rows()[0].textContent, /截至已执行动画命令序号：1/);
  assert.match(h.controllers()[0].textContent, /脚本已接受状态：idle/); assert.match(h.controllers()[1].textContent, /脚本已接受状态：attack/);
  assert.match(h.rows()[0].textContent, /第 1 次访问.*场景时间 2 秒/);
  assert.match(h.el('Note').textContent, /不表示动画命令已经执行/);
  assert.doesNotMatch(h.controllers()[0].textContent, /正在播放|播放成功|已执行播放|转换历史/);
});

test('inactive and unavailable controllers do not present a full-animation selection or infer missing state', async t => {
  const h = await fixture(t), value = snapshot();
  value.entries[0].controllers[0] = { ...controller(), status: 'inactive', stateKey: null, clipId: null };
  value.entries[0].controllers[1] = { ...controller(2), status: 'unavailable', stateKey: null, clipId: null }; h.set(value);
  assert.match(h.controllers()[0].textContent, /当前没有已接受状态/); assert.match(h.controllers()[0].textContent, /控制器未激活/);
  assert.match(h.controllers()[1].textContent, /未采集已接受状态/); assert.match(h.controllers()[1].textContent, /未读取到脚本状态/);
  assert.doesNotMatch(h.controllers()[1].textContent, /当前没有已接受状态|完整动画/);
  for (const item of h.controllers()) assert.equal(item.querySelector('.project-animation-state-clip').hidden, true);
  value.entries[0].controllers[0] = { ...controller(), clipId: null }; h.set(value);
  assert.match(h.controllers()[0].textContent, /状态选择：完整动画/);
});

test('switch finished and aborted boundaries show distinct snapshot reasons without claiming transition replay', async t => {
  const h = await fixture(t);
  for (const [reason, label] of [['switch', '场景切换前快照'], ['finished', '运行结束前快照'], ['aborted', '运行中止前快照']]) {
    const value = snapshot(); value.entries[0].reason = reason; h.set(value);
    assert.equal(h.rows()[0].querySelector('h4').textContent, label);
  }
});

test('binding and script navigation carry distinct exact identities with an empty script pointer', async t => {
  const h = await fixture(t); h.set(snapshot());
  for (const kind of ['binding', 'script']) { sourceButton(h, kind).click(); await flushDialogs(); }
  assert.deepEqual(h.calls.map(call => JSON.parse(JSON.stringify(call.source))), [origin().source, scriptSource()]);
  assert.equal(h.calls[1].source.propertyPath, ''); assert.equal(h.calls[1].source.objectId, id(50));
});

test('filtering narrows controllers by binding script state and scene without showing a sibling just because it shares a visit', async t => {
  const h = await fixture(t), value = snapshot(); value.entries[0].controllers[1].stateKey = 'attack'; h.set(value);
  for (const filter of [id(50), '待機', id(1)]) { h.filter(filter); assert.equal(h.controllers().length, 2); }
  h.filter(id(12)); assert.deepEqual(h.controllers().map(item => item.dataset.bindingId), [id(12)]);
  h.filter('attack'); assert.equal(h.controllers().length, 1); assert.equal(h.controllers()[0].dataset.bindingId, id(12));
  h.filter('no-match'); assert.equal(h.rows().length, 0); assert.equal(h.el('Empty').textContent, '没有匹配的动画状态快照。');
  h.context.navigationOwner = 'visit-3'; h.observer.refresh(); assert.equal(h.el('Search').value, 'no-match');
  h.context.sessionOwner = 'new-run'; h.observer.refresh(); assert.equal(h.el('Search').value, ''); assert.equal(h.el('Panel').hidden, true);
});

test('three languages preserve literal author data and focused search/caret without inserting markup', async t => {
  const h = await fixture(t); h.set(snapshot()); const search = h.el('Search'); h.filter('待機'); search.focus(); search.selectionStart = 0; search.selectionEnd = 1;
  for (const dictionary of [en, ja, {}]) {
    h.language(dictionary); assert.equal(h.el('Title').textContent, dictionary['动画状态快照'] || '动画状态快照');
    assert.equal(h.controllers()[0].querySelector('.project-animation-state-accepted').textContent, (dictionary['脚本已接受状态：{0}'] || '脚本已接受状态：{0}').replace('{0}', 'idle'));
    assert.match(h.controllers()[0].textContent, /待機 <img src=x>.txt/); assert.equal(h.container.querySelector('img'), null);
    assert.equal(h.document.activeElement, search); assert.deepEqual([search.value, search.selectionStart, search.selectionEnd], ['待機', 0, 1]);
  }
});

test('appended visit snapshots retain focused source buttons and admitted source tickets', async t => {
  const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }); h.set(snapshot());
  const button = sourceButton(h, 'script'); button.focus(); button.click(); h.language(ja);
  const next = snapshot(); next.sequence = 2; next.entries.push(entry(2)); h.set(next);
  assert.equal(sourceButton(h, 'script'), button); assert.equal(h.document.activeElement, button); assert.equal(h.calls[0].isCurrent(), true);
  assert.equal(h.controllers().length, 4); gate.resolve(true); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true);
});

test('only altered controller identity or boundary metadata revokes a pending source ticket', async t => {
  for (const change of ['script', 'binding', 'state', 'clip', 'time', 'command', 'reason', 'sibling']) {
    const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }); h.set(snapshot()); const old = sourceButton(h, 'script'); old.click();
    const next = snapshot(), member = next.entries[0].controllers[0];
    if (change === 'script') member.scriptSource.sourceRevision = 'sha256:' + 'b'.repeat(64);
    else if (change === 'binding') member.origin.source.propertyPath = '/bindings/2';
    else if (change === 'state') member.stateKey = 'attack';
    else if (change === 'clip') member.clipId = null;
    else if (change === 'time') next.entries[0].timeSeconds++;
    else if (change === 'command') next.entries[0].commandSequence++;
    else if (change === 'reason') next.entries[0].reason = 'finished';
    else next.entries[0].controllers[1].stateKey = 'attack';
    h.set(next); assert.equal(h.calls[0].isCurrent(), change === 'sibling', change);
    old.dispatch('click'); assert.equal(h.calls.length, 1); gate.resolve(true); await flushDialogs();
  }
});

test('visit task visibility capability detachment removal and filtering revoke delayed source reads', async t => {
  for (const change of ['visit', 'task', 'hidden', 'capability', 'detached', 'removed', 'filter']) {
    const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }); h.set(snapshot()); sourceButton(h).click();
    if (change === 'visit') h.context.navigationOwner = 'visit-3';
    else if (change === 'task') h.context.sessionOwner = 'new-run';
    else if (change === 'hidden') h.context.visible = false;
    else if (change === 'capability') h.context.available = false;
    else if (change === 'detached') h.container.isConnected = false;
    else if (change === 'removed') h.set(null);
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

test('invalid snapshots fail closed without invoking accessors and later caller mutation cannot redirect source reads', async t => {
  const h = await fixture(t), value = snapshot(); h.set(value); value.entries[0].controllers[0].scriptSource.sourcePath = 'redirect.txt';
  sourceButton(h, 'script').click(); await flushDialogs(); assert.equal(h.calls[0].source.sourcePath, scriptSource().sourcePath);
  let invoked = 0;
  for (const mutate of [v => { v.sequence++; }, v => { v.entries[0].reason = 'cancelled'; }, v => { v.entries[0].controllers[0].status = 'finished'; },
    v => { v.entries[0].controllers[0].stateKey = '<img>'; }, v => { v.entries[0].controllers[0].scriptSource.propertyPath = '/bindings/0'; },
    v => { v.toJSON = () => { invoked++; return snapshot(); }; },
    v => Object.defineProperty(v.entries[0].controllers[0], 'clipId', { enumerable: true, get() { invoked++; return null; } })]) {
    h.set(snapshot()); const bad = snapshot(); mutate(bad); h.set(bad); assert.equal(h.el('Panel').hidden, true); assert.equal(h.rows().length, 0);
  }
  assert.equal(invoked, 0);
});

test('navigation failure preserves snapshots while disposal revokes controls and language listeners', async t => {
  const h = await fixture(t, { onOpen: () => { throw Error('missing'); } }); h.set(snapshot()); sourceButton(h).click(); await flushDialogs();
  assert.match(h.el('Navigation').textContent, /无法打开动画状态来源/); assert.equal(h.rows().length, 1);
  const old = sourceButton(h); h.observer.dispose(); old.dispatch('click'); assert.equal(h.calls.length, 1); assert.equal(h.subscriptions(), 0);
});

test('snapshot view owns responsive styles and translations without execution authoring or polling authority', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-project-animation-state-observation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|fetchJsonApiRequest|requestWorldCommand|\.play_animation\(|\.subscribe_animation_completed\(|requestAnimationFrame|setInterval|setTimeout|new Audio\(/);
  const keys = new Set([...source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)].map(match => match[1]));
  for (const key of keys) { assert.ok(en[key], 'English: ' + key); assert.ok(ja[key], 'Japanese: ' + key); }
  const css = await fs.readFile(new URL('../../web/project-animation-state-observation.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 600px\)/); assert.match(css, /flex-direction: column/); assert.match(css, /overflow-wrap: anywhere/);
  const html = await fs.readFile(new URL('../../web/index.html', import.meta.url), 'utf8'); assert.equal(html.match(/href="\/web\/project-animation-state-observation.css"/g)?.length, 1);
});

test('protocol9 retains terminal snapshots beside state entry history', async t => {
  const h = await fixture(t); h.set(snapshot(), { protocolVersion: 9 });
  assert.equal(h.el('Panel').hidden, false); assert.equal(h.rows().length, 1);
  sourceButton(h, 'script').click(); await flushDialogs(); assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].source)), scriptSource());
});
