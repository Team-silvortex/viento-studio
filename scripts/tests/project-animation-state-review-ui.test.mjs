import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { createProjectAnimationStateReview, queryProjectAnimationStateReview } from '../../engine/project-animation-state-review.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const revision = 'sha256:' + 'a'.repeat(64);
const origin = (binding = 1, visitIndex = 1) => ({ visitIndex, sceneId: id(1), bindingId: id(10 + binding), instanceId: id(20 + binding), objectId: id(30 + binding),
  source: { objectId: id(40), sourcePath: 'documents/behaviors/衔接.json', sourceRevision: revision, propertyPath: '/bindings/' + (binding - 1) } });
const scriptSource = () => ({ objectId: id(50), sourcePath: 'documents/scripts/待機 <img src=x>.txt', sourceRevision: revision, propertyPath: '' });
const entry = (sequence = 1, binding = 1) => ({ sequence, origin: origin(binding), scriptSource: scriptSource(), timeSeconds: 0, commandSequence: 0, stateKey: sequence === 3 ? 'action' : 'idle', clipId: null });
const command = (sequence = 1, binding = 1) => ({ sequence, command: { action: 'play' },
  state: { sceneObjectId: id(1), phase: 'playing', positionSeconds: 0, timeSeconds: 0, clipId: null }, origin: origin(binding),
  animation: { objectId: id(60), source: { objectId: id(60), sourcePath: 'documents/animation.json', sourceRevision: revision, propertyPath: '' }, durationSeconds: 1, loop: false }, clip: null });
function observed({ terminal = true, commands = true } = {}) {
  return { format: 'viento-runtime-observation', schemaVersion: 1, sceneObjectId: id(1), protocolVersion: 1, phase: 'ready', sequence: 1, actors: [],
    project: { protocolVersion: 9, assemblyId: id(90), entrySceneId: id(1), activeSceneId: id(1), visits: [{ index: 1, sceneId: id(1), phase: 'ready', elapsedSeconds: 0 }],
      sharedState: { revision: 0, entries: [], lastChange: null }, events: { sequence: 0, entries: [] }, audioCommands: { sequence: 0, entries: [] },
      animationCommands: { sequence: commands ? 10 : 0, entries: commands ? Array.from({ length: 10 }, (_, i) => command(i + 1, i === 2 || i === 3 ? 2 : 1)) : [] },
      animationCompletions: { sequence: 0, entries: [] },
      animationStates: { sequence: terminal ? 1 : 0, entries: terminal ? [{ sequence: 1, visitIndex: 1, sceneId: id(1), timeSeconds: .5, commandSequence: commands ? 10 : 0, reason: 'finished',
        controllers: [1, 2].map(binding => ({ origin: origin(binding), scriptSource: scriptSource(), status: 'active', stateKey: 'idle', clipId: null })) }] : [] },
      animationStateEntries: { sequence: 5, entries: [entry(1), entry(2, 2), entry(3), entry(4), entry(5)] } } };
}
async function fixture(t, overrides = {}) {
  let dictionary = {}, languageChanged = () => {}, subscriptions = 0;
  const calls = [], closed = [], context = { available: true, visible: true, sessionOwner: 'run-1', navigationOwner: 'visit-1', canOpenSource: true, canContinueSource: true };
  const h = await dialogHarness('app-project-animation-state-review', { createProjectAnimationStateReview, queryProjectAnimationStateReview,
    t: (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? ''),
    onLanguageChange(callback) { languageChanged = callback; subscriptions++; return () => { languageChanged = () => {}; subscriptions--; }; },
  });
  const container = h.document.createElement('div'); container.id = 'projectAnimationStateReview'; container.isConnected = true; h.document.body.append(container);
  const review = h.runtime.setupProjectAnimationStateReview({ container, getContext: () => context,
    onOpen: async (source, opts) => { calls.push({ source, ...opts }); return overrides.onOpen ? overrides.onOpen(source, opts) : true; },
    onClose: sequence => { closed.push(sequence); overrides.onClose?.(sequence); } });
  t.after(() => review.dispose());
  return { ...h, container, review, context, calls, closed, el: suffix => h.element('projectAnimationStateReview' + suffix),
    set: value => review.setSnapshot(value), select: sequence => review.selectEntry(sequence),
    language(value) { dictionary = value; languageChanged(); }, subscriptions: () => subscriptions };
}

test('review needs an explicit accepted-entry selection and only admits complete protocol9 observations', async t => {
  const h = await fixture(t); assert.equal(h.el('Panel').hidden, true); h.set(observed()); assert.equal(h.el('Panel').hidden, true);
  assert.equal(h.select(1), true); assert.equal(h.el('Panel').hidden, false);
  assert.equal(h.select(999), false); assert.equal(h.el('Panel').dataset.sequence, '1');
  const p8 = observed(); p8.project.protocolVersion = 8; delete p8.project.animationStateEntries; assert.equal(h.set(p8), false); assert.equal(h.el('Panel').hidden, true);
  h.set(observed()); h.select(3); h.set(null); assert.equal(h.el('Panel').hidden, true); assert.equal(h.select(3), false);
});

test('one controller review follows all repeated records while two bindings sharing a script stay separate', async t => {
  const h = await fixture(t); h.set(observed()); h.select(1);
  assert.deepEqual(h.el('Selection').children.map(option => option.value), ['1', '3', '4', '5']);
  assert.equal(h.el('Previous').disabled, true); assert.equal(h.el('Commands').dataset.count, '8');
  h.el('Next').click(); assert.equal(h.el('Panel').dataset.sequence, '3'); assert.match(h.el('State').textContent, /action/);
  h.el('Selection').value = '5'; h.el('Selection').dispatch('change'); assert.equal(h.el('Panel').dataset.sequence, '5'); assert.equal(h.el('Next').disabled, true);
  h.el('Previous').click(); assert.equal(h.el('Panel').dataset.sequence, '4'); assert.match(h.el('State').textContent, /idle/);
  h.select(2); assert.deepEqual(h.el('Selection').children.map(option => option.value), ['2']); assert.equal(h.el('Commands').dataset.count, '2');
  assert.equal(h.el('Panel').dataset.bindingId, id(12)); assert.equal(h.el('Panel').dataset.visitIndex, '1');
});

test('later commands are cutoff evidence shared by multiple entries rather than claimed transition causes', async t => {
  const h = await fixture(t); h.set(observed()); h.select(1); const rows = h.el('Commands').children;
  assert.deepEqual(rows.map(row => row.dataset.sequence), ['1', '2', '5', '6', '7', '8', '9', '10']);
  h.select(5); assert.equal(h.el('Commands').children[0], rows[0]); assert.equal(h.el('Commands').dataset.count, '8');
  assert.match(h.el('CommandsTitle').textContent, /该记录之后的同绑定已执行命令/);
  assert.match(h.el('CommandsNote').textContent, /多次进入可以共享这些结果/); assert.match(h.el('CommandsNote').textContent, /不一定由所选进入触发/);
  assert.doesNotMatch(h.el('Entry').textContent, /触发|播放成功|正在播放/);
  const changed = observed(); changed.project.animationStateEntries.entries[4].commandSequence = 4;
  h.set(changed); assert.equal(h.el('Panel').hidden, true); h.select(5); assert.equal(h.el('Commands').dataset.count, '6');
});

test('executed seek receipt shows captured phase and position without moving the runtime', async t => {
  const h = await fixture(t), value = observed(); const last = value.project.animationCommands.entries.at(-1);
  last.command = { action: 'seek', positionSeconds: .3 }; last.state.phase = 'paused'; last.state.positionSeconds = .3;
  h.set(value); h.select(1); assert.match(h.el('Commands').children.at(-1).textContent, /跳转/); assert.match(h.el('Commands').children.at(-1).textContent, /执行后状态：暂停.*0.3 秒/);
  assert.equal(h.calls.length, 0);
});

test('terminal snapshot is visit-scoped and inactive unavailable or missing results do not infer a final state', async t => {
  const h = await fixture(t); h.set(observed()); h.select(3);
  assert.equal(h.el('Terminal').hidden, false); assert.equal(h.el('Terminal').dataset.status, 'active'); assert.match(h.el('TerminalState').textContent, /idle/);
  assert.match(h.el('State').textContent, /action/); assert.match(h.el('TerminalBoundary').textContent, /运行结束前快照/);
  for (const status of ['inactive', 'unavailable']) {
    const value = observed(); Object.assign(value.project.animationStates.entries[0].controllers[0], { status, stateKey: null, clipId: null }); h.set(value);
    assert.equal(h.el('Panel').dataset.sequence, '3'); assert.equal(h.el('Terminal').dataset.status, status); assert.equal(h.el('TerminalClip').hidden, true);
    assert.doesNotMatch(h.el('TerminalState').textContent, /idle|action|完整动画/);
  }
  h.set(observed({ terminal: false })); assert.equal(h.el('Terminal').hidden, true); assert.match(h.el('TerminalEmpty').textContent, /尚未采集/);
});

test('appended records commands and terminal snapshots preserve selected entry controls focus and pending source ticket', async t => {
  const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }); h.set(observed({ terminal: false, commands: false })); h.select(3);
  h.el('ScriptSource').focus(); h.el('ScriptSource').click(); const button = h.el('ScriptSource'), option = h.el('Selection').children[1];
  h.context.canOpenSource = false; h.review.refresh(); assert.equal(h.calls[0].isCurrent(), true, 'own loading preserves continuation');
  h.set(observed({ terminal: false })); assert.equal(h.el('Commands').dataset.count, '8'); assert.equal(h.calls[0].isCurrent(), true);
  const next = observed(); next.project.animationStateEntries.sequence = 6; next.project.animationStateEntries.entries.push(entry(6)); h.set(next);
  assert.equal(h.el('Panel').dataset.sequence, '3'); assert.equal(h.el('Selection').children[1], option); assert.equal(h.el('ScriptSource'), button);
  assert.equal(h.document.activeElement, button); assert.equal(h.el('Terminal').hidden, false); assert.equal(h.calls[0].isCurrent(), true);
  gate.resolve(true); await flushDialogs();
});

test('selecting another identical-state identical-cutoff entry revokes pending source navigation', async t => {
  const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }); h.set(observed()); h.select(4); h.el('ScriptSource').click();
  assert.equal(h.calls[0].isCurrent(), true); h.el('Next').click(); assert.equal(h.el('Panel').dataset.sequence, '5'); assert.equal(h.calls[0].isCurrent(), false);
  gate.resolve(true); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true);
});

test('selection replacement removal new session and invalid views clear selection while visit navigation only revokes the ticket', async t => {
  for (const change of ['replacement', 'removal', 'session', 'visit', 'invalid']) {
    const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }); h.set(observed()); h.select(5); h.el('ScriptSource').click();
    if (change === 'session') { h.context.sessionOwner = 'run-2'; h.review.refresh(); }
    else if (change === 'visit') { h.context.navigationOwner = 'visit-2'; h.review.refresh(); }
    else {
      const next = observed();
      if (change === 'replacement') next.project.animationStateEntries.entries[4].timeSeconds = .1;
      else if (change === 'removal') { next.project.animationStateEntries.sequence = 4; next.project.animationStateEntries.entries.pop(); }
      else next.project.animationStateEntries.sequence++;
      h.set(next);
    }
    assert.equal(h.calls[0].isCurrent(), false, change); assert.equal(h.el('Panel').hidden, change !== 'visit', change);
    gate.reject(Error('late')); await flushDialogs(); assert.equal(h.el('Navigation').hidden, true);
  }
});

test('capability visibility continuation authorization detachment and closing invalidate delayed source reads', async t => {
  for (const change of ['available', 'visible', 'continue', 'detached', 'close']) {
    const gate = deferred(), h = await fixture(t, { onOpen: () => gate.promise }); h.set(observed()); h.select(1); h.el('BindingSource').click();
    if (change === 'available') h.context.available = false;
    else if (change === 'visible') h.context.visible = false;
    else if (change === 'continue') h.context.canContinueSource = false;
    else if (change === 'detached') h.container.isConnected = false;
    else h.el('Close').click();
    h.review.refresh(); assert.equal(h.calls[0].isCurrent(), false, change);
    gate.resolve(true); await flushDialogs();
  }
});

test('literal authored data and selected controls survive three-language updates without markup or lost focus', async t => {
  const h = await fixture(t); h.set(observed()); h.select(3); const selected = h.el('Selection'), option = selected.children[1]; selected.focus();
  for (const dictionary of [en, ja, {}]) {
    h.language(dictionary); assert.equal(h.el('Title').textContent, dictionary['控制器状态回看'] || '控制器状态回看');
    assert.equal(h.el('Panel').dataset.sequence, '3'); assert.equal(h.el('Selection'), selected); assert.equal(selected.children[1], option); assert.equal(h.document.activeElement, selected);
    assert.match(h.el('Script').textContent, /待機 <img src=x>.txt/); assert.equal(h.container.querySelector('img'), null);
  }
});

test('explicit close reports selection and moving to a disabled boundary preserves keyboard focus', async t => {
  const h = await fixture(t); h.set(observed()); h.select(3); h.el('Previous').focus(); h.el('Previous').click();
  assert.equal(h.el('Panel').dataset.sequence, '1'); assert.equal(h.el('Previous').disabled, true); assert.equal(h.document.activeElement, h.el('Selection'));
  h.el('Close').click(); assert.deepEqual(h.closed, [1]); assert.equal(h.el('Panel').hidden, true);
});

test('sources preserve exact frozen provenance, block new busy reads and report errors without losing the review', async t => {
  const h = await fixture(t, { onOpen: () => false }); const value = observed(); h.set(value); h.select(1); value.project.animationStateEntries.entries[0].scriptSource.sourcePath = 'changed.txt';
  h.context.canOpenSource = false; h.el('BindingSource').dispatch('click'); assert.equal(h.calls.length, 0);
  h.context.canOpenSource = true; h.el('BindingSource').click(); await flushDialogs(); h.el('ScriptSource').click(); await flushDialogs();
  assert.deepEqual(h.calls.map(call => JSON.parse(JSON.stringify(call.source))), [origin().source, scriptSource()]);
  assert.match(h.el('Navigation').textContent, /无法打开控制器回看来源/); assert.equal(h.el('Panel').hidden, false);
  h.review.dispose(); assert.equal(h.subscriptions(), 0); assert.equal(h.container.children.length, 0);
});

test('review rejects accessor snapshots and owns responsive translated read-only presentation', async t => {
  const h = await fixture(t); let calls = 0; const value = observed(); Object.defineProperty(value, 'project', { enumerable: true, get() { calls++; return {}; } });
  assert.equal(h.set(value), false); assert.equal(calls, 0);
  const source = await fs.readFile(new URL('../../web/modules/app-project-animation-state-review.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|requestWorldCommand|app-state|requestAnimationFrame|setInterval|setTimeout|\.play_animation\(|\.seek_animation\(/);
  const keys = new Set([...source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)].map(match => match[1]));
  for (const key of keys) { assert.ok(en[key], 'English: ' + key); assert.ok(ja[key], 'Japanese: ' + key); }
  const css = await fs.readFile(new URL('../../web/project-animation-state-review.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 600px\)/); assert.match(css, /overflow-wrap: anywhere/); assert.match(css, /flex-direction: column/);
  const html = await fs.readFile(new URL('../../web/index.html', import.meta.url), 'utf8'); assert.equal(html.match(/href="\/web\/project-animation-state-review.css"/g)?.length, 1);
});
