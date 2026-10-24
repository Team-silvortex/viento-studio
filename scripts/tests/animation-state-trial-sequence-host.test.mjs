import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness } from './dialog-harness.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';
const clone = value => JSON.parse(JSON.stringify(value));
const table = () => ({ eventSelection: 'firstMatch', initialState: 'idle', states: [{ key: 'idle' }, { key: 'attack' }], transitions: [
  { from: 'idle', to: 'attack', trigger: { kind: 'event', name: 'go', condition: { combine: 'all', conditions: [
    { type: 'boolean', operator: 'eq', value: true, selector: { kind: 'projectState', key: 'combat.enabled' } },
    { type: 'number', operator: 'gte', value: 3 },
  ] } } }, { from: 'idle', to: 'idle', trigger: { kind: 'event', name: 'go' } },
  { from: 'attack', to: 'idle', trigger: { kind: 'completed' } },
] });
async function fixture(t) {
  const h = await dialogHarness('app-animation-state-script'), container = h.document.createElement('div'); h.document.body.append(container);
  const context = { active: true, available: true, disabled: false }; let changes = 0;
  const controller = h.runtime.setupAnimationStateScript({ container, getContext: () => context, onChange: () => changes++, translate: (key, ...args) => key.replace(/\{(\d+)\}/g, (_, i) => String(args[i])) });
  controller.setValue(table()); t.after(() => controller.dispose());
  const el = suffix => h.element('animationStateScript' + suffix), preview = suffix => el('EventPreview' + suffix);
  const set = (node, value, event = 'input') => { node.value = value; node.dispatch(event); };
  const run = value => { set(preview('PayloadType'), 'number', 'change'); set(preview('PayloadNumber'), String(value)); preview('Run').click(); };
  return { ...h, el, preview, set, run, controller, context, changes: () => changes, value: () => clone(controller.getValue()) };
}

test('event and completed steps advance only on adoption and never alter author source or parent change count', async t => {
  const h = await fixture(t), before = h.value(), source = generateEditableGodotAnimationStateScript(before).content;
  h.preview('Toggle').click(); h.set(h.preview('Shared1Type'), 'boolean', 'change'); h.set(h.preview('Shared1Boolean'), 'true', 'change'); h.run(3);
  assert.equal(h.preview('CurrentState').value, 'idle'); assert.equal(h.preview('HistoryList').children.length, 0);
  h.preview('Adopt').click(); assert.equal(h.preview('CurrentState').value, 'attack'); assert.equal(h.preview('HistoryList').children.length, 1);
  h.set(h.preview('TriggerKind'), 'completed', 'change'); h.preview('Run').click();
  assert.equal(h.preview('CurrentState').value, 'attack'); assert.equal(h.preview('Transition3').dataset.status, 'selected');
  h.preview('Adopt').click(); assert.equal(h.preview('CurrentState').value, 'idle'); assert.equal(h.preview('HistoryList').children.length, 2);
  assert.deepEqual(h.value(), before); assert.equal(generateEditableGodotAnimationStateScript(h.value()).content, source); assert.equal(h.changes(), 0);
  h.preview('Undo').click(); assert.equal(h.preview('CurrentState').value, 'attack'); assert.equal(h.preview('TriggerKind').value, 'completed'); assert.equal(h.preview('HistoryList').children.length, 1); assert.equal(h.preview('Result').hidden, true);
  h.preview('Undo').click(); assert.equal(h.preview('CurrentState').value, 'idle'); assert.equal(h.preview('TriggerKind').value, 'event'); assert.equal(h.preview('PayloadNumber').value, '3'); assert.equal(h.preview('HistoryList').children.length, 0); assert.equal(h.changes(), 0);
});
test('same-table reset clears a sequence and retained adopt or locate controls cannot revive it', async t => {
  const h = await fixture(t); h.preview('Toggle').click(); h.run(3); h.preview('Adopt').click(); h.run(3);
  const oldLocate = h.preview('Transition1Locate'), oldAdopt = h.preview('Adopt'); h.controller.setValue(table());
  assert.equal(h.preview('HistoryList').children.length, 0); assert.equal(h.preview('Body').hidden, true);
  h.el('State1Key').focus(); oldAdopt.disabled = false; oldAdopt.click(); oldLocate.disabled = false; oldLocate.click();
  assert.equal(h.preview('HistoryList').children.length, 0); assert.equal(h.document.activeElement, h.el('State1Key')); assert.equal(h.changes(), 0);
});
test('real author changes clear the whole sequence and source review remains author-owned', async t => {
  const h = await fixture(t); h.preview('Toggle').click(); h.run(3); h.preview('Adopt').click();
  assert.equal(h.preview('HistoryList').children.length, 1);
  h.set(h.el('State1Key'), 'INVALID'); assert.equal(h.preview('HistoryList').children.length, 0); assert.equal(h.preview('Run').disabled, true); assert.equal(h.changes(), 1);
  h.set(h.el('State1Key'), 'idle'); assert.equal(h.preview('HistoryList').children.length, 0); h.run(3); h.preview('Adopt').click();
  h.el('Transition1MoveDown').click(); assert.equal(h.preview('HistoryList').children.length, 0); assert.equal(h.preview('Result').hidden, true);
});
