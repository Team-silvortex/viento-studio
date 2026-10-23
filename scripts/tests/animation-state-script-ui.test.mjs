import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness } from './dialog-harness.mjs';
import { setupAnimationStateConditionGroup } from '../../web/modules/app-animation-state-condition-group.js';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const defaults = { initialState: 'idle', states: [{ key: 'idle' }, { key: 'action' }], transitions: [
  { from: 'idle', to: 'action', trigger: { kind: 'event', name: 'action' } },
  { from: 'action', to: 'idle', trigger: { kind: 'completed' } },
] };
const copy = value => JSON.parse(JSON.stringify(value));
async function fixture(t) {
  const h = await dialogHarness('app-animation-state-script');
  const container = h.document.createElement('div'); h.document.body.append(container);
  let language = 'zh', changes = 0;
  const context = { active: true, available: true, disabled: false };
  const controller = h.runtime.setupAnimationStateScript({ container, getContext: () => context, onChange: () => changes++,
    translate: (key, ...args) => ({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')) });
  controller.setValue(copy(defaults)); t.after(() => controller.dispose());
  return { ...h, container, controller, context, el: suffix => h.element('animationStateScript' + suffix),
    value: () => copy(controller.getValue()), changes: () => changes,
    set(suffix, value, event = 'input') { const el = this.el(suffix); el.value = value; if (event) el.dispatch(event); },
    language(value) { language = value; controller.refresh(); } };
}

test('a local state table emits only its portable fields and does not change on setup or refresh', async t => {
  const h = await fixture(t); assert.deepEqual(h.value(), defaults);
  assert.equal(h.changes(), 0); h.controller.refresh(); assert.equal(h.changes(), 0);
  assert.deepEqual(Object.keys(h.controller).sort(), ['dispose', 'getValue', 'refresh', 'reset', 'setDisabled', 'setValue']);
  assert.equal(h.el('Initial').value, 'state-1'); assert.equal(h.el('Initial').children[2].dataset.stateKey, 'action');
});

test('renaming a state follows stable row identity in the initial state and both transition ends', async t => {
  const h = await fixture(t); h.set('Initial', 'state-2', 'change');
  h.set('State2Key', 'attack'); const value = h.value();
  assert.equal(value.initialState, 'attack'); assert.equal(value.transitions[0].to, 'attack'); assert.equal(value.transitions[1].from, 'attack');
  assert.equal(h.el('Transition1To').value, 'state-2'); assert.equal(h.el('Transition1To').children[2].dataset.stateKey, 'attack');
  // Invalid intermediate keys remain visible; validation belongs to the core.
  h.set('State2Key', ''); assert.equal(h.value().transitions[0].to, ''); assert.equal(h.el('State2Key').value, '');
});

test('deleting a referenced state leaves explicit missing references even when another row reuses its key', async t => {
  const h = await fixture(t), stale = h.el('State2Remove'); stale.click();
  assert.equal(h.value().transitions[0].to, ''); assert.match(h.el('Status').textContent, /缺失/);
  assert.equal(h.el('Transition1To').children.at(-1).textContent, '缺失状态：action');
  h.el('AddState').click(); h.set('State3Key', 'action');
  assert.equal(h.value().transitions[0].to, ''); assert.equal(h.el('Transition1To').getAttribute('aria-invalid'), 'true');
  h.set('Transition1To', 'state-3', 'change'); h.set('Transition2From', 'state-3', 'change');
  assert.equal(h.value().transitions[0].to, 'action'); assert.doesNotMatch(h.el('Status').textContent, /缺失/);
  const before = h.changes(); stale.click(); assert.equal(h.changes(), before); assert.equal(h.value().states.length, 2);
});

test('transition kind switching retains the event field without leaking it into completion DTOs', async t => {
  const h = await fixture(t); h.set('Transition1Event', 'move.start');
  const event = h.el('Transition1Event'); event.focus(); event.selectionStart = 2; event.selectionEnd = 6;
  h.set('Transition1Kind', 'completed', 'change'); assert.equal(event.parentElement.hidden, true);
  assert.deepEqual(h.value().transitions[0].trigger, { kind: 'completed' });
  h.set('Transition1Kind', 'event', 'change'); assert.equal(event.parentElement.hidden, false);
  assert.equal(event.value, 'move.start'); assert.deepEqual(h.value().transitions[0].trigger, { kind: 'event', name: 'move.start' });
});

test('three-language refresh preserves form nodes, values, focus and incomplete selection', async t => {
  const h = await fixture(t); h.set('State2Key', 'attack_');
  const input = h.el('State2Key'); input.focus(); input.selectionStart = 2; input.selectionEnd = 5;
  const before = h.value(), count = h.changes();
  for (const locale of ['en', 'ja', 'zh']) {
    h.language(locale); assert.equal(h.el('State2Key'), input); assert.equal(h.document.activeElement, input);
    assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 5); assert.deepEqual(h.value(), before);
    assert.equal(h.changes(), count); assert.equal(h.el('Title').textContent, ({ en, ja }[locale]?.['动画状态与转换'] || '动画状态与转换'));
  }
});

test('disabled, hidden, unsupported and removed sessions cannot mutate through old row actions', async t => {
  const h = await fixture(t), old = h.el('State1Remove'), oldKey = h.el('State1Key');
  for (const patch of [{ disabled: true }, { active: false }, { available: false }]) {
    Object.assign(h.context, { active: true, disabled: false, available: true }, patch); h.controller.refresh();
    old.click(); h.el('AddState').click(); oldKey.dispatch('input'); assert.deepEqual(h.value(), defaults); assert.equal(h.changes(), 0);
  }
  assert.match(h.el('Status').textContent, /其他起始脚本/);
  Object.assign(h.context, { active: true, disabled: false, available: true }); h.controller.reset(copy(defaults));
  old.disabled = false; old.click(); oldKey.dispatch('input'); assert.equal(h.changes(), 0); assert.deepEqual(h.value(), defaults);
  const current = h.el('State1Remove'); h.controller.dispose(); current.disabled = false; current.click(); assert.equal(h.changes(), 0);
});

test('new transitions require explicit states, and row count limits do not affect existing fields', async t => {
  const h = await fixture(t); h.el('AddTransition').click();
  assert.deepEqual(h.value().transitions[2], { from: '', to: '', trigger: { kind: 'event', name: '' } });
  assert.equal(h.document.activeElement, h.el('Transition3From'));
  for (let count = 2; count < 16; count++) h.el('AddState').click();
  assert.equal(h.value().states.length, 16); assert.equal(h.el('AddState').disabled, true); h.el('AddState').dispatch('click'); assert.equal(h.value().states.length, 16);
  for (let count = 3; count < 64; count++) h.el('AddTransition').click();
  assert.equal(h.value().transitions.length, 64); assert.equal(h.el('AddTransition').disabled, true); h.el('AddTransition').dispatch('click'); assert.equal(h.value().transitions.length, 64);
  h.set('State1Key', 'rest'); assert.equal(h.value().initialState, 'rest');
});

test('reset preserves unknown references as missing and cannot silently bind them to the first state', async t => {
  const h = await fixture(t);
  h.controller.reset({ initialState: 'gone', states: [{ key: 'idle' }], transitions: [{ from: 'gone', to: 'idle', trigger: { kind: 'completed' } }] });
  assert.equal(h.value().initialState, ''); assert.equal(h.value().transitions[0].from, '');
  assert.equal(h.el('Initial').children.at(-1).textContent, '缺失状态：gone');
  h.el('AddState').click(); h.set('State2Key', 'gone'); assert.equal(h.value().initialState, '');
});

test('all state-table interface text has English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-animation-state-script.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/data-state-i18n="([^"]+)"/g)].map(match => match[1]));
  for (const match of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) keys.add(match[1]);
  for (const key of keys) { assert.ok(en[key], `English: ${key}`); assert.ok(ja[key], `Japanese: ${key}`); }
});

test('creation and reopened tables have independent prefixes, references, notes and disposal', async t => {
  const h = await fixture(t); const container = h.document.createElement('div'); h.document.body.append(container);
  const editing = h.runtime.setupAnimationStateScript({ container, idPrefix: 'animationStateScriptEditTable', mode: 'edit',
    getContext: () => ({ active: true, available: true }), translate: key => key });
  t.after(() => editing.dispose()); editing.setValue(copy(defaults));
  const keys = h.document.querySelectorAll('[id]').map(node => node.id); assert.equal(new Set(keys).size, keys.length);
  const input = h.element('animationStateScriptEditTableState2Key'); input.value = 'attack'; input.dispatch('input');
  assert.equal(editing.getValue().transitions[0].to, 'attack'); assert.equal(h.value().states[1].key, 'action');
  assert.match(h.el('Note').textContent, /可重新打开表格/); assert.match(h.element('animationStateScriptEditTableNote').textContent, /当前原文/);
  editing.dispose(); h.set('State2Key', 'walk'); assert.equal(h.value().transitions[0].to, 'walk');
});


test('a maximum-size refresh reads each transition condition once and never retains values or capabilities across renders', async t => {
  let reads = 0, capability = true, failTranslation = false;
  const h = await dialogHarness('app-animation-state-script', {
    supportsStudioCoreAnimationStateCombinations: () => capability,
    setupAnimationStateConditionGroup: options => {
      const child = setupAnimationStateConditionGroup(options);
      return Object.freeze({ ...child, getValue() { reads++; return child.getValue(); } });
    },
  });
  const container = h.document.createElement('div'); h.document.body.append(container);
  const controller = h.runtime.setupAnimationStateScript({ container, getContext: () => ({ active: true, available: true }),
    translate(key) { if (failTranslation) throw Error('render interrupted'); return key; } }); t.after(() => controller.dispose());
  const value = { initialState: 'idle', states: [{ key: 'idle' }, { key: 'action' }], transitions: Array.from({ length: 64 }, (_, index) => ({
    from: 'idle', to: 'action', trigger: { kind: 'event', name: 'event' + index, condition: { combine: 'all', conditions: Array.from({ length: 8 }, () => ({ type: 'number', operator: 'gte', value: 0 })) } },
  })) };
  controller.setValue(value); reads = 0; controller.refresh(); assert.equal(reads, 64, 'one capability snapshot per render');
  reads = 0; assert.deepEqual(copy(controller.getValue()), value); assert.equal(reads, 64, 'one condition read per exported row');
  const number = h.element('animationStateScriptTransition1ConditionItem1Number'); number.value = '1e-'; reads = 0;
  assert.equal(controller.getValue().transitions[0].trigger.condition.conditions[0].value, '1e-'); assert.equal(reads, 64, 'silent edits are read immediately');
  failTranslation = true; assert.throws(() => controller.refresh(), /render interrupted/); failTranslation = false; capability = false;
  const mode = h.element('animationStateScriptTransition1ConditionCombination'); mode.value = 'any'; mode.dispatch('change'); assert.equal(mode.value, 'all', 'failed renders cannot retain old capability admission');
  capability = true; mode.value = 'any'; mode.dispatch('change'); assert.equal(mode.value, 'any'); assert.equal(controller.getValue().transitions[0].trigger.condition.conditions[0].value, '1e-');
});
