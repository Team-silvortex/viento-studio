import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness } from './dialog-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const copy = value => JSON.parse(JSON.stringify(value));
const branchTable = () => ({ eventSelection: 'firstMatch', initialState: 'idle', states: [{ key: 'idle' }, { key: 'attack' }, { key: 'retreat' }], transitions: [
  { from: 'idle', to: 'attack', trigger: { kind: 'event', name: 'hit', condition: { type: 'number', operator: 'gte', value: 10 } } },
  { from: 'idle', to: 'retreat', trigger: { kind: 'event', name: 'hit', condition: { type: 'number', operator: 'eq', value: 3 } } },
  { from: 'idle', to: 'idle', trigger: { kind: 'event', name: 'hit' } },
  { from: 'attack', to: 'idle', trigger: { kind: 'completed' } },
] });
const uniqueTable = () => ({ initialState: 'idle', states: [{ key: 'idle' }, { key: 'attack' }], transitions: [
  { from: 'idle', to: 'attack', trigger: { kind: 'event', name: 'hit' } },
  { from: 'attack', to: 'idle', trigger: { kind: 'completed' } },
] });
async function fixture(t, settings = {}) {
  let capability = settings.available ?? true, conditionCapability = settings.conditions ?? true, changes = 0, language = 'zh';
  const h = await dialogHarness('app-animation-state-script', { supportsStudioCoreAnimationStateBranches: () => capability, supportsStudioCoreAnimationStateConditions: () => conditionCapability });
  const context = { active: true, available: true, disabled: false };
  const container = h.document.createElement('div'); h.document.body.append(container);
  const translate = (key, ...args) => ({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, i) => String(args[i] ?? ''));
  const controller = h.runtime.setupAnimationStateScript({ container, getContext: () => context, onChange: () => changes++, translate });
  controller.setValue(settings.table || branchTable()); t.after(() => controller.dispose());
  const el = suffix => h.element('animationStateScript' + suffix);
  return { ...h, controller, context, container, el, value: () => copy(controller.getValue()), changes: () => changes,
    set(suffix, value, event = 'change') { const node = el(suffix); node.value = value; if (event) node.dispatch(event); },
    capability(value) { capability = value; controller.refresh(); },
    conditionCapability(value) { conditionCapability = value; controller.refresh(); },
    language(value) { language = value; controller.refresh(); },
  };
}

test('explicit first-match mode round trips while unique mode omits the new property and preserves duplicates', async t => {
  const h = await fixture(t); assert.equal(h.el('EventSelection').value, 'firstMatch'); assert.deepEqual(h.value(), branchTable());
  h.set('EventSelection', 'unique'); const unique = h.value(); assert.equal(Object.hasOwn(unique, 'eventSelection'), false); assert.deepEqual(unique.transitions, branchTable().transitions);
  assert.match(h.el('EventSelectionNote').textContent, /保留现有分支/); assert.equal(h.el('Transition1MoveUp').hidden, true);
  h.set('EventSelection', 'firstMatch'); assert.deepEqual(h.value(), branchTable()); assert.equal(h.changes(), 2);
  const old = await fixture(t, { table: uniqueTable() }); assert.deepEqual(old.value(), uniqueTable()); assert.equal(old.el('EventSelection').value, 'unique');
});

test('reordering preserves row identity, state references, input focus and hidden typed condition buffers', async t => {
  const h = await fixture(t), first = h.el('Transition1'), number = h.el('Transition1ConditionNumber');
  h.set('Transition1ConditionNumber', '1e-', 'input'); h.set('Transition1ConditionType', 'string'); h.set('Transition1ConditionString', 'retained🙂', 'input');
  number.focus(); number.selectionStart = 1; number.selectionEnd = 3;
  h.el('Transition1MoveDown').click(); assert.equal(h.el('Transitions').children[1], first); assert.equal(h.el('Transition1'), first); assert.equal(h.document.activeElement, number);
  assert.deepEqual([number.selectionStart, number.selectionEnd], [1, 3]); assert.deepEqual(h.value().transitions.map(edge => edge.to), ['retreat', 'attack', 'idle', 'idle']);
  h.set('Transition1ConditionType', 'number'); assert.equal(number.value, '1e-'); assert.equal(h.value().transitions[1].trigger.condition.value, '1e-');
  h.set('Transition1ConditionType', 'string'); assert.equal(h.value().transitions[1].trigger.condition.value, 'retained🙂');
  h.set('State2Key', 'strike', 'input'); assert.equal(h.value().transitions[1].to, 'strike'); assert.equal(h.value().transitions[3].from, 'strike');
});

test('first and last rows have guarded move boundaries and visible order numbers track actual precedence', async t => {
  const h = await fixture(t); assert.equal(h.el('Transition1MoveUp').disabled, true); assert.equal(h.el('Transition4MoveDown').disabled, true);
  h.el('Transition1MoveUp').disabled = false; h.el('Transition1MoveUp').click(); h.el('Transition4MoveDown').disabled = false; h.el('Transition4MoveDown').click(); assert.equal(h.changes(), 0);
  h.el('Transition2MoveUp').click(); assert.equal(h.el('Transition2Order').textContent, '转换顺序 1'); assert.equal(h.el('Transition1Order').textContent, '转换顺序 2');
  assert.equal(h.el('Transition2MoveUp').disabled, true); assert.equal(h.el('Transition1MoveUp').disabled, false); assert.equal(h.changes(), 1);
});

test('graph locations follow reordered identities and old graph controls cannot target a different transition', async t => {
  const h = await fixture(t); h.el('GraphToggle').click(); assert.equal(h.el('GraphCanvas').children.length, 1);
  const old = h.el('GraphTransition1Locate'); h.el('Transition2MoveUp').click(); h.el('State1Key').focus(); old.disabled = false; old.click();
  assert.equal(h.document.activeElement, h.el('State1Key')); h.el('GraphTransition1Locate').click(); assert.equal(h.document.activeElement, h.el('Transition2From'));
  h.el('GraphTransition2Locate').click(); assert.equal(h.document.activeElement, h.el('Transition1From')); assert.equal(h.changes(), 1);
});

test('moving a fallback before its group conditions keeps the input and clears the invalid graph until repaired', async t => {
  const h = await fixture(t); h.el('GraphToggle').click(); const before = h.value(); h.el('Transition3MoveUp').click();
  assert.equal(h.el('GraphCanvas').children.length, 0); assert.match(h.el('GraphStatus').textContent, /尚未有效/); assert.equal(h.value().transitions.length, 4);
  h.el('Transition3MoveDown').click(); assert.equal(h.el('GraphCanvas').children.length, 1); assert.deepEqual(h.value(), before);
  h.set('EventSelection', 'unique'); assert.equal(h.el('GraphCanvas').children.length, 0); h.set('EventSelection', 'firstMatch'); assert.equal(h.el('GraphCanvas').children.length, 1);
});

test('reset, removed rows and disposal revoke retained move handlers even when DOM IDs are reused', async t => {
  const h = await fixture(t), old = h.el('Transition1MoveDown'); h.controller.reset(branchTable()); old.disabled = false; old.click(); assert.deepEqual(h.value(), branchTable()); assert.equal(h.changes(), 0);
  const removed = h.el('Transition1MoveDown'); h.el('Transition1Remove').click(); const before = h.value(); removed.disabled = false; removed.click(); assert.deepEqual(h.value(), before); assert.equal(h.changes(), 1);
  const detached = h.el('Transition2MoveDown'); h.controller.dispose(); detached.disabled = false; detached.click(); assert.equal(h.changes(), 1); assert.equal(h.container.children.length, 0);
});

test('readonly, inactive and forced-disabled sessions reject retained reorder and mode callbacks', async t => {
  for (const patch of [{ disabled: true }, { active: false }, { available: false }]) {
    const h = await fixture(t); Object.assign(h.context, patch); h.controller.refresh(); const before = h.value();
    h.el('Transition1MoveDown').disabled = false; h.el('Transition1MoveDown').click(); h.set('EventSelection', 'unique'); assert.deepEqual(h.value(), before); assert.equal(h.changes(), 0);
  }
  const h = await fixture(t); h.controller.setDisabled(true); h.el('Transition1MoveDown').disabled = false; h.el('Transition1MoveDown').click(); assert.equal(h.changes(), 0);
});

test('missing branch support preserves branch input and disables only the new mode and its assistance', async t => {
  const h = await fixture(t); h.el('GraphToggle').click(); const before = h.value(); h.capability(false); assert.deepEqual(h.value(), before);
  assert.equal(h.el('GraphCanvas').children.length, 0); assert.equal(h.el('Transition1MoveDown').disabled, true); assert.equal(h.el('Transition1ConditionMode').disabled, false); assert.equal(h.el('Transition1ConditionMode').children.find(option => option.value === 'compare').disabled, true); assert.equal(h.el('Transition1ConditionType').disabled, true); assert.match(h.el('Status').textContent, /不支持有序事件分支/);
  h.set('EventSelection', 'unique'); assert.equal(Object.hasOwn(h.value(), 'eventSelection'), false); assert.equal(h.el('Transition1ConditionMode').disabled, false);
  h.set('EventSelection', 'firstMatch'); assert.equal(h.el('EventSelection').value, 'unique'); assert.equal(Object.hasOwn(h.value(), 'eventSelection'), false);
  const old = await fixture(t, { available: false, table: uniqueTable() }); old.el('GraphToggle').click(); assert.equal(old.el('GraphCanvas').children.length, 1); old.set('State2Key', 'edited', 'input'); assert.equal(old.value().states[1].key, 'edited');
});

test('a standalone branch marker enables typed conditions and graph even when the older condition marker is absent', async t => {
  const h = await fixture(t, { conditions: false }); assert.equal(h.el('Transition1ConditionMode').disabled, false); h.el('GraphToggle').click(); assert.equal(h.el('GraphCanvas').children.length, 1);
  h.set('Transition1ConditionNumber', '20', 'input'); assert.equal(h.value().transitions[0].trigger.condition.value, 20);
  h.set('EventSelection', 'unique'); assert.equal(h.el('Transition1ConditionMode').disabled, false); assert.equal(h.el('Transition1ConditionMode').children.find(option => option.value === 'compare').disabled, true); assert.equal(h.el('Transition1ConditionType').disabled, true); assert.equal(h.el('GraphCanvas').children.length, 0);
});

test('language changes translate mode, precedence and movement without changing values or row identity', async t => {
  const h = await fixture(t), row = h.el('Transition1'), before = h.value(); h.el('Transition1Event').focus();
  for (const locale of ['en', 'ja', 'zh']) { h.language(locale); assert.deepEqual(h.value(), before); assert.equal(h.el('Transition1'), row); assert.equal(h.document.activeElement, h.el('Transition1Event')); assert.equal(h.changes(), 0); }
  h.language('en'); assert.equal(h.el('Transition1MoveDown').textContent, 'Move transition down'); assert.match(h.el('EventSelectionNote').textContent, /first matching branch/);
});

test('every new form and parent-controller message has English and Japanese translations', async () => {
  for (const name of ['app-animation-state-script', 'app-script-create', 'app-animation-state-script-edit']) {
    const source = await fs.readFile(new URL('../../web/modules/' + name + '.js', import.meta.url), 'utf8');
    const keys = new Set([...source.matchAll(/data-(?:state-)?i18n="([^"]+)"/g)].map(match => match[1]));
    for (const match of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) keys.add(match[1]);
    for (const key of keys) { assert.ok(en[key], `English: ${key}`); assert.ok(ja[key], `Japanese: ${key}`); }
  }
});

test('silent selection changes remain visible to review signatures and invalid mode values cannot become legacy tables', async t => {
  const h = await fixture(t, { table: uniqueTable() }); h.set('EventSelection', 'firstMatch', null); assert.equal(h.value().eventSelection, 'firstMatch'); h.controller.refresh(); assert.equal(h.el('EventSelection').value, 'firstMatch');
  for (const invalid of ['', 'lastMatch']) { h.set('EventSelection', invalid, null); assert.equal(h.value().eventSelection, invalid); h.controller.refresh(); assert.equal(h.value().eventSelection, invalid); }
  h.el('EventSelection').dispatch('change'); assert.equal(h.el('EventSelection').value, 'unique'); assert.deepEqual(h.value(), uniqueTable());
});
