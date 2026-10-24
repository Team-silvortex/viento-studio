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
test('manual trials leave the author table, generated source and parent change count untouched', async t => {
  const h = await fixture(t), before = h.value(), source = generateEditableGodotAnimationStateScript(before).content;
  h.preview('Toggle').click(); h.run(3);
  assert.equal(h.preview('Transition1').dataset.status, 'rejected'); assert.equal(h.preview('Transition2').dataset.status, 'selected');
  h.set(h.preview('Shared1Type'), 'boolean', 'change'); h.set(h.preview('Shared1Boolean'), 'true', 'change'); h.run(3);
  assert.equal(h.preview('Transition1').dataset.status, 'selected'); assert.equal(h.preview('Transition2').dataset.status, 'not-evaluated');
  assert.deepEqual(h.value(), before); assert.equal(generateEditableGodotAnimationStateScript(h.value()).content, source); assert.equal(h.changes(), 0);
  h.preview('Transition1Locate').click(); assert.equal(h.document.activeElement, h.el('Transition1From')); assert.equal(h.changes(), 0);
});
test('reordering clears results and an old locate button cannot target a different author row', async t => {
  const h = await fixture(t); h.preview('Toggle').click(); h.run(3); const old = h.preview('Transition1Locate');
  h.el('Transition1MoveDown').click(); assert.equal(h.preview('Result').hidden, true); assert.equal(h.changes(), 1);
  h.el('State1Key').focus(); old.disabled = false; old.click(); assert.equal(h.document.activeElement, h.el('State1Key'));
  // The new order has an invalid non-final fallback. No stale preview may remain.
  assert.equal(h.preview('Run').disabled, true);
  h.el('Transition1MoveUp').click(); h.preview('Run').click(); assert.equal(h.preview('Transition1').dataset.status, 'rejected');
  h.preview('Transition2Locate').click(); assert.equal(h.document.activeElement, h.el('Transition2From'));
});
test('a same-table author reset clears samples and the old trial authority', async t => {
  const h = await fixture(t); h.preview('Toggle').click(); h.run(3);
  const old = h.preview('Transition2Locate'); h.controller.setValue(table());
  assert.equal(h.preview('Body').hidden, true); assert.equal(h.preview('Result').hidden, true);
  h.el('State1Key').focus(); old.disabled = false; old.click(); assert.equal(h.document.activeElement, h.el('State1Key'));
  h.preview('Toggle').click(); assert.equal(h.preview('PayloadType').value, 'string'); assert.equal(h.preview('PayloadString').value, '');
  assert.equal(h.preview('Shared2Type').value, 'missing'); assert.equal(h.changes(), 0);
});
test('host disabling and invalid author edits revoke results while preserving partial manual input', async t => {
  const h = await fixture(t); h.preview('Toggle').click(); h.run(3);
  h.controller.setDisabled(true); assert.equal(h.preview('Result').hidden, true); assert.equal(h.preview('Run').disabled, true);
  h.controller.setDisabled(false); h.run(3); h.set(h.preview('PayloadNumber'), '1e-');
  assert.equal(h.preview('Result').hidden, true); assert.equal(h.preview('Run').disabled, true); h.controller.refresh();
  assert.equal(h.preview('PayloadNumber').value, '1e-'); assert.equal(h.changes(), 0);
  h.run(3); h.set(h.el('State1Key'), 'INVALID'); assert.equal(h.preview('Result').hidden, true); assert.equal(h.preview('Run').disabled, true);
  assert.equal(h.changes(), 1);
});
