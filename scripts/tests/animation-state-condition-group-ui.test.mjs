import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness } from './dialog-harness.mjs';
import { inspectAnimationStateDeclarationWithCombinations } from '../../engine/animation-state-conditions-core.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const scalar = () => ({ type: 'number', operator: 'gte', value: 0 });
const shared = () => ({ type: 'boolean', operator: 'eq', value: false, selector: { kind: 'projectState', key: 'combat.enabled' } });
const grouped = () => ({ combine: 'all', conditions: [scalar(), shared()] });
const table = condition => ({ initialState: 'idle', states: [{ key: 'idle' }, { key: 'action' }], transitions: [
  { from: 'idle', to: 'action', trigger: { kind: 'event', name: 'action', ...(condition === undefined ? {} : { condition }) } },
  { from: 'action', to: 'idle', trigger: { kind: 'completed' } },
] });
async function fixture(t, settings = {}) {
  let changes = 0, language = 'zh', capability = settings.combinations ?? true;
  const context = { active: true, disabled: false, available: true, selectorsAvailable: true, combinationsAvailable: capability };
  const h = await dialogHarness(settings.parent ? 'app-animation-state-script' : 'app-animation-state-condition-group', {
    supportsStudioCoreAnimationStateCombinations: () => capability,
    supportsStudioCoreAnimationStateSelectors: () => settings.selectors ?? true,
    supportsStudioCoreAnimationStateBranches: () => settings.branches ?? true,
    supportsStudioCoreAnimationStateConditions: () => settings.conditions ?? true,
  });
  const container = h.document.createElement('div'); h.document.body.append(container);
  const translate = (key, ...args) => { settings.onTranslate?.(key); return ({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, i) => String(args[i] ?? '')); };
  const controller = settings.parent ? h.runtime.setupAnimationStateScript({ container, getContext: () => ({ ...context }), onChange: () => changes++, translate })
    : h.runtime.setupAnimationStateConditionGroup({ container, getContext: () => ({ ...context }), onChange: () => changes++, translate, value: settings.value });
  if (settings.parent) controller.setValue(settings.table || table(settings.value)); else controller.refresh();
  t.after(() => controller.dispose());
  const prefix = settings.parent ? 'animationStateScriptTransition1Condition' : 'animationStateCondition';
  const el = suffix => h.element(prefix + suffix);
  return { ...h, controller, container, context, el, value: () => copy(controller.getValue()), changes: () => changes,
    set(suffix, value, event = 'change') { el(suffix).value = value; if (event) el(suffix).dispatch(event); },
    capability(value) { capability = value; context.combinationsAvailable = value; controller.refresh(); },
    language(value) { language = value; controller.refresh(); },
    form(suffix, value, event = 'change') { const item = h.element('animationStateScript' + suffix); item.value = value; if (event) item.dispatch(event); },
  };
}

test('single mode retains the existing IDs and scalar DTO without adding a wrapper declaration', async t => {
  for (const condition of [undefined, scalar(), shared()]) {
    const h = await fixture(t, { value: condition }); assert.equal(h.el('Combination').value, 'single'); assert.deepEqual(h.value(), condition);
    assert.equal(h.el('Group').hidden, true); assert.equal(h.el('Single').hidden, false); assert.equal(h.changes(), 0);
    assert.deepEqual(Object.keys(h.controller).sort(), ['dispose', 'getValue', 'refresh', 'setValue']);
  }
});

test('first grouping copies the current scalar input once and preserves independent single and group buffers', async t => {
  const h = await fixture(t, { value: scalar() }), original = h.el('Number'); h.set('Number', '1e-', 'input'); h.set('Combination', 'all');
  assert.deepEqual(h.value(), { combine: 'all', conditions: [{ ...scalar(), value: '1e-' }] }); assert.match(h.el('GroupNote').textContent, /复制为第 1 项/);
  h.set('Item1Number', '2', 'input'); h.set('Combination', 'single'); assert.equal(h.el('Number'), original); assert.equal(original.value, '1e-');
  h.set('Number', '3', 'input'); h.set('Combination', 'any'); assert.deepEqual(h.value(), { combine: 'any', conditions: [{ ...scalar(), value: 2 }] });
  assert.throws(() => inspectAnimationStateDeclarationWithCombinations(table({ combine: 'all', conditions: [{ ...scalar(), value: '1e-' }] })));
});

test('an existing group first switches to explicitly explained no condition without choosing a leaf', async t => {
  const h = await fixture(t, { value: grouped() }); h.set('Combination', 'single'); assert.equal(h.value(), undefined); assert.equal(h.el('SingleNote').hidden, false); assert.match(h.el('SingleNote').textContent, /从无条件开始/);
  h.set('Mode', 'compare'); h.set('String', 'new single', 'input'); h.set('Combination', 'all'); assert.deepEqual(h.value(), grouped());
  h.set('Combination', 'single'); assert.deepEqual(h.value(), { type: 'string', operator: 'eq', value: 'new single' });
});

test('all and any retain rows, duplicate leaves, focused inputs and unfinished typed values', async t => {
  const h = await fixture(t, { value: { combine: 'all', conditions: [scalar(), scalar()] } }); h.set('Item1Number', '2e-', 'input');
  const input = h.el('Item1Number'), row = h.el('Item1Row'); input.focus(); input.selectionStart = 1; input.selectionEnd = 3;
  for (const mode of ['any', 'all']) { h.set('Combination', mode); assert.equal(h.el('Item1Row'), row); assert.equal(h.document.activeElement, input); assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 3]); assert.equal(h.value().conditions.length, 2); assert.equal(h.value().conditions[0].value, '2e-'); }
});

test('adding is capped at eight and removing the last condition keeps an invalid empty draft', async t => {
  const h = await fixture(t); h.set('Combination', 'all'); assert.deepEqual(h.value(), { combine: 'all', conditions: [] }); assert.match(h.el('GroupStatus').textContent, /空组合不能生成/);
  for (let i = 0; i < 8; i++) h.el('AddItem').click(); assert.equal(h.value().conditions.length, 8); assert.equal(h.el('AddItem').disabled, true);
  h.el('AddItem').disabled = false; h.el('AddItem').click(); assert.equal(h.value().conditions.length, 8);
  for (let i = 1; i <= 8; i++) h.el('Item' + i + 'Remove').click(); assert.equal(h.document.activeElement, h.el('AddItem')); assert.deepEqual(h.value(), { combine: 'all', conditions: [] });
  assert.throws(() => inspectAnimationStateDeclarationWithCombinations(table(h.value())), { errorCode: 'animation_state_table_invalid' });
});

test('group leaves cannot select no condition or silently drop an invalid item', async t => {
  const h = await fixture(t, { value: grouped() }), mode = h.el('Item1Mode'), none = mode.children.find(option => option.value === 'none');
  assert.equal(none.hidden, true); assert.equal(none.disabled, true); h.set('Item1Mode', 'none'); assert.equal(mode.value, 'compare'); assert.equal(h.value().conditions.length, 2);
  h.set('Item1Mode', 'none', null); assert.equal(h.value().conditions.length, 2); assert.equal(h.value().conditions[0].type, '');
  assert.throws(() => inspectAnimationStateDeclarationWithCombinations(table(h.value())), { errorCode: 'animation_state_table_invalid' });
});

test('reordering preserves source and type buffers and focuses the source when a boundary button becomes disabled', async t => {
  const h = await fixture(t, { value: grouped() }); h.set('Item1Number', '1e-', 'input'); h.set('Item1Type', 'string'); h.set('Item1String', 'kept🙂', 'input');
  h.set('Item1Mode', 'shared'); h.set('Item1Key', 'combat.ready', 'input'); h.set('Item1Type', 'boolean'); h.set('Item1Boolean', 'true');
  const input = h.el('Item1Key'), row = h.el('Item1Row'); input.focus(); input.selectionStart = 2; input.selectionEnd = 7; h.el('Item1MoveDown').click();
  assert.equal(h.el('Items').children[1], row); assert.equal(h.document.activeElement, input); assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 7]);
  h.set('Item1Mode', 'compare'); assert.equal(h.el('Item1String').value, 'kept🙂'); h.set('Item1Type', 'number'); assert.equal(h.el('Item1Number').value, '1e-');
  h.el('Item1MoveUp').focus(); h.el('Item1MoveUp').click(); assert.equal(h.el('Item1MoveUp').disabled, true); assert.equal(h.document.activeElement, h.el('Item1Mode'));
  h.el('Item1Remove').click(); assert.equal(h.document.activeElement, h.el('Item2Mode'));
});

test('removed, reset and disposed item callbacks cannot change replacement rows or steal focus', async t => {
  const h = await fixture(t, { value: grouped() }), old = h.el('Item1Remove'), oldMode = h.el('Item1Mode'); h.controller.setValue(grouped()); h.controller.refresh(); const before = h.value(), count = h.changes();
  old.disabled = false; old.click(); oldMode.value = 'shared'; oldMode.dispatch('change'); assert.deepEqual(h.value(), before); assert.equal(h.changes(), count);
  const last = h.el('Combination'); h.controller.dispose(); last.dispatch('change'); old.click(); assert.equal(h.changes(), count); assert.equal(h.container.children.length, 0);
});

test('missing combination support preserves the group and offers an explicit return to single mode', async t => {
  const h = await fixture(t, { value: grouped() }); h.capability(false); assert.deepEqual(h.value(), grouped()); assert.equal(h.el('Combination').disabled, false); assert.equal(h.el('AddItem').disabled, true); assert.equal(h.el('Item1Number').disabled, true);
  assert.equal(h.el('Combination').children.find(option => option.value === 'single').disabled, false); assert.match(h.el('GroupStatus').textContent, /已有输入会保留/);
  h.set('Combination', 'single'); assert.equal(h.value(), undefined); h.set('Mode', 'compare'); h.set('Type', 'boolean'); assert.deepEqual(h.value(), { type: 'boolean', operator: 'eq', value: false });
  h.set('Combination', 'all'); assert.equal(h.el('Combination').value, 'single'); h.capability(true); h.set('Combination', 'all'); assert.deepEqual(h.value(), grouped());
});

test('unknown explicit and silent group modes remain invalid until a deliberate valid choice rechecks them', async t => {
  const h = await fixture(t, { value: grouped() });
  for (const event of ['change', null]) { const before = h.changes(); h.set('Combination', '', event); assert.equal(h.value().combine, ''); assert.throws(() => inspectAnimationStateDeclarationWithCombinations(table(h.value()))); h.set('Combination', 'all'); assert.deepEqual(h.value(), grouped()); assert.ok(h.changes() > before); }
});

test('disabled and inactive sessions reject retained add, move, remove and combination callbacks', async t => {
  for (const patch of [{ disabled: true }, { active: false }]) {
    const h = await fixture(t, { value: grouped() }); Object.assign(h.context, patch); h.controller.refresh(); const before = h.value();
    for (const suffix of ['AddItem', 'Item1MoveDown', 'Item1Remove']) { h.el(suffix).disabled = false; h.el(suffix).click(); }
    h.set('Combination', 'single'); assert.deepEqual(h.value(), before); assert.equal(h.changes(), 0);
  }
});

test('three-language refresh retains group selection, raw values and active node selection ranges', async t => {
  const h = await fixture(t, { value: grouped() }); h.set('Item2Key', ' combat.enabled ', 'input'); const input = h.el('Item2Key'), before = h.value(), count = h.changes(); input.focus(); input.selectionStart = 1; input.selectionEnd = 6;
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.deepEqual(h.value(), before); assert.equal(h.document.activeElement, input); assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 6]); assert.equal(h.changes(), count); }
});

test('completion trigger hides but retains group inputs, and table reordering keeps child identities', async t => {
  const h = await fixture(t, { parent: true, value: grouped() }); h.form('Transition1Kind', 'completed'); assert.deepEqual(h.value().transitions[0].trigger, { kind: 'completed' });
  h.form('Transition1Kind', 'event'); assert.deepEqual(h.value().transitions[0].trigger.condition, grouped());
  h.form('EventSelection', 'firstMatch'); const input = h.el('Item2Key'); input.focus(); input.selectionStart = 2; input.selectionEnd = 7; h.element('animationStateScriptTransition1MoveDown').click();
  assert.equal(h.el('Item2Key'), input); assert.equal(h.document.activeElement, input); assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 7]); assert.deepEqual(h.value().transitions[1].trigger.condition, grouped());
});

test('the combination marker alone supports mixed groups, other scalar transitions, ordering and the static graph', async t => {
  const value = table(grouped()); value.transitions.push({ from: 'idle', to: 'idle', trigger: { kind: 'event', name: 'rest', condition: shared() } });
  const h = await fixture(t, { parent: true, table: value, conditions: false, selectors: false, branches: false }); h.form('EventSelection', 'firstMatch');
  assert.equal(h.element('animationStateScriptEventSelection').value, 'firstMatch'); assert.equal(h.element('animationStateScriptTransition3ConditionKey').disabled, false);
  h.element('animationStateScriptGraphToggle').click(); assert.equal(h.element('animationStateScriptGraphCanvas').children.length, 1); assert.match(h.element('animationStateScriptGraphTransitions').textContent, /全部满足.*combat.enabled/);
  h.capability(false); assert.equal(h.element('animationStateScriptGraphCanvas').children.length, 0); assert.deepEqual(h.value().transitions[0].trigger.condition, grouped());
});

test('constructing a group never reads a parent session before initialization', async t => {
  const h = await dialogHarness('app-animation-state-condition-group'), container = h.document.createElement('div'); let calls = 0;
  const controller = h.runtime.setupAnimationStateConditionGroup({ container, value: grouped(), getContext() { calls++; throw Error('parent TDZ'); } }); t.after(() => controller.dispose()); assert.equal(calls, 0); assert.deepEqual(copy(controller.getValue()), grouped());
});

test('all group labels, counts and validation messages have English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-animation-state-condition-group.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/data-condition-group-i18n="([^"]+)"/g)].map(match => match[1]));
  for (const match of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) keys.add(match[1]);
  for (const key of keys) { assert.ok(en[key], `English: ${key}`); assert.ok(ja[key], `Japanese: ${key}`); }
});


test('an interrupted group refresh releases its context before a later source choice', async t => {
  let fail = false; const h = await fixture(t, { value: grouped(), onTranslate() { if (fail) throw Error('group render interrupted'); } });
  fail = true; assert.throws(() => h.controller.refresh(), /group render interrupted/); fail = false;
  h.context.combinationsAvailable = false; h.set('Combination', 'any'); assert.equal(h.el('Combination').value, 'all');
  h.context.combinationsAvailable = true; h.set('Combination', 'any'); assert.equal(h.el('Combination').value, 'any');
});
