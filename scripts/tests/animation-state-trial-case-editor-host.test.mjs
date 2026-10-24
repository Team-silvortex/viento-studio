import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { generateEditableGodotAnimationStateScript } from '../../engine/animation-state-script-source.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const table = () => ({ eventSelection: 'firstMatch', initialState: 'idle', states: [{ key: 'idle' }, { key: 'attack' }], transitions: [
  { from: 'idle', to: 'attack', trigger: { kind: 'event', name: 'go', condition: { combine: 'all', conditions: [
    { type: 'boolean', operator: 'eq', value: true, selector: { kind: 'projectState', key: 'combat.enabled' } },
    { type: 'number', operator: 'gte', value: 3 },
  ] } } },
  { from: 'idle', to: 'idle', trigger: { kind: 'event', name: 'go' } },
  { from: 'attack', to: 'idle', trigger: { kind: 'completed' } },
] });
const caseText = JSON.stringify({ format: 'viento.animation-state-trial-case', version: 1, initialStateKey: 'idle', steps: [
  { input: { kind: 'event', event: { name: 'go', value: 3 }, projectState: [{ key: 'combat.enabled', value: true }] }, expected: { stateKey: 'attack', transition: true } },
  { input: { kind: 'completed' }, expected: { stateKey: 'idle', transition: true } },
] });
async function fixture(t) {
  const h = await dialogHarness('app-animation-state-script'), container = h.document.createElement('div'); h.document.body.append(container);
  const context = { active: true, available: true, disabled: false }; let changes = 0;
  const controller = h.runtime.setupAnimationStateScript({ container, getContext: () => context, onChange: () => changes++,
    translate: (key, ...args) => key.replace(/\{(\d+)\}/g, (_, index) => String(args[index])) });
  controller.setValue(table()); t.after(() => controller.dispose());
  const el = suffix => h.element('animationStateScript' + suffix), preview = suffix => el('EventPreview' + suffix), editor = suffix => preview('CaseEditor' + suffix);
  const set = (node, value, event = 'input') => { node.value = value; node.dispatch(event); };
  const run = (value = 3) => { set(preview('PayloadType'), 'number', 'change'); set(preview('PayloadNumber'), String(value)); preview('Run').click(); };
  function recordPath() {
    set(preview('Shared1Type'), 'boolean', 'change'); set(preview('Shared1Boolean'), 'true', 'change'); run(); preview('Adopt').click();
    set(preview('TriggerKind'), 'completed', 'change'); preview('Run').click(); preview('Adopt').click();
  }
  const source = () => generateEditableGodotAnimationStateScript(clone(controller.getValue())).content;
  preview('Toggle').click();
  return { ...h, controller, context, el, preview, editor, set, run, recordPath, source, changes: () => changes,
    value: () => clone(controller.getValue()), draft: () => JSON.parse(editor('Text').value),
    edit(value) { set(editor('Text'), typeof value === 'string' ? value : JSON.stringify(value, null, 2)); },
    statuses: () => preview('CaseSteps').children.map(row => row.dataset.status),
  };
}
async function load(h, raw = caseText, name = 'original.json') {
  h.preview('CaseImport').click(); h.preview('CaseFile').files = [new File([raw], name, { type: 'application/json' })]; h.preview('CaseFile').dispatch('change'); await flushDialogs();
}
function checkAndApply(h) { h.editor('Check').click(); assert.equal(h.editor('Apply').disabled, false); h.editor('Apply').click(); }

// Mount the real author table and children while retaining source, live-path
// and pending controls across independent case editing.
test('recorded path creates an editable case draft and explicit check/apply/replay never changes author or pending adoption', async t => {
  const h = await fixture(t), before = h.value(), source = h.source(); h.recordPath();
  h.set(h.preview('TriggerKind'), 'event', 'change'); h.run();
  const history = [...h.preview('HistoryList').children], pending = h.preview('Result'), pendingText = pending.textContent;
  assert.equal(h.preview('Adopt').disabled, false); h.preview('CaseCreate').click();
  assert.equal(h.editor('Panel').hidden, false); assert.equal(h.preview('CaseLoaded').hidden, true); assert.equal(h.editor('Apply').disabled, true);
  assert.equal(h.draft().steps.length, 2); assert.deepEqual(h.draft().steps.map(step => step.expected.stateKey), ['attack', 'idle']);
  const changed = h.draft(); changed.steps[0].input.event.value = 2; h.edit(changed);
  h.editor('Check').click(); assert.equal(h.preview('CaseLoaded').hidden, true); assert.equal(h.preview('CaseResult').hidden, true);
  h.editor('Apply').click(); assert.equal(h.editor('Panel').hidden, true); assert.equal(h.preview('CaseLoaded').hidden, false); assert.equal(h.preview('CaseResult').hidden, true);
  assert.equal(h.preview('CurrentState').value, 'idle'); assert.deepEqual(h.preview('HistoryList').children, history); assert.equal(pending.hidden, false); assert.equal(pending.textContent, pendingText); assert.equal(h.preview('Adopt').disabled, false);
  h.preview('CaseRun').click(); assert.deepEqual(h.statuses(), ['failed', 'not-run']);
  assert.deepEqual(h.value(), before); assert.equal(h.source(), source); assert.equal(h.changes(), 0);
  h.preview('Adopt').click(); assert.equal(h.preview('HistoryList').children.length, 3); assert.equal(h.preview('CurrentState').value, 'attack'); assert.deepEqual(h.statuses(), ['failed', 'not-run']);
});

test('editing an imported case and cancelling retains its exact report and the independent manual path', async t => {
  const h = await fixture(t), source = h.source(); h.recordPath(); await load(h); h.preview('CaseRun').click();
  const row = h.preview('CaseSteps').children[0], loaded = h.preview('CaseLoadedSummary').textContent, history = [...h.preview('HistoryList').children];
  h.preview('CaseEdit').click(); const changed = h.draft(); changed.steps[0].input.event.value = 2; h.edit(changed); h.editor('Check').click();
  assert.equal(h.editor('Apply').disabled, false); assert.equal(h.preview('CaseSteps').children[0], row); assert.deepEqual(h.statuses(), ['passed', 'passed']);
  h.editor('Cancel').click(); assert.equal(h.editor('Panel').hidden, true); assert.equal(h.preview('CaseLoadedSummary').textContent, loaded); assert.equal(h.preview('CaseSteps').children[0], row);
  h.preview('CaseEdit').click(); assert.equal(h.draft().steps[0].input.event.value, 3); h.editor('Cancel').click();
  assert.deepEqual(h.preview('HistoryList').children, history); assert.equal(h.source(), source); assert.equal(h.changes(), 0);
});

test('create from the current path stages replacement without overwriting a loaded case or report', async t => {
  const h = await fixture(t); h.recordPath(); await load(h); h.preview('CaseRun').click(); const row = h.preview('CaseSteps').children[0];
  h.preview('CaseCreate').click(); h.edit('{'); h.editor('Check').click(); assert.equal(h.editor('Apply').disabled, true);
  assert.equal(h.editor('Error').hidden, false); assert.equal(h.preview('CaseSteps').children[0], row); assert.deepEqual(h.statuses(), ['passed', 'passed']);
  h.editor('Cancel').click(); assert.equal(h.preview('CaseSteps').children[0], row); assert.equal(h.preview('CaseLoaded').hidden, false); assert.equal(h.changes(), 0);
});

test('invalid checked text preserves source, case, report, live path and pending result', async t => {
  const h = await fixture(t), source = h.source(); h.recordPath(); h.set(h.preview('TriggerKind'), 'event', 'change'); h.run(); await load(h); h.preview('CaseRun').click();
  const row = h.preview('CaseSteps').children[0], history = [...h.preview('HistoryList').children], pendingText = h.preview('Result').textContent;
  const contradiction = JSON.parse(caseText); contradiction.steps[0].expected.transition = false;
  for (const raw of ['{ "steps": [', JSON.stringify(contradiction), caseText.replace('"version":1', '"version":2,"version":1')]) {
    h.preview('CaseEdit').click(); h.edit(raw); h.editor('Check').click(); assert.equal(h.editor('Text').value, raw); assert.equal(h.editor('Error').hidden, false); assert.equal(h.editor('Apply').disabled, true);
    h.editor('Apply').disabled = false; h.editor('Apply').click();
    assert.equal(h.editor('Panel').hidden, false); assert.equal(h.preview('CaseSteps').children[0], row); assert.deepEqual(h.statuses(), ['passed', 'passed']); h.editor('Cancel').click();
  }
  assert.deepEqual(h.preview('HistoryList').children, history); assert.equal(h.preview('Result').textContent, pendingText); assert.equal(h.preview('Adopt').disabled, false); assert.equal(h.source(), source); assert.equal(h.changes(), 0);
  h.preview('Adopt').click(); assert.equal(h.preview('CurrentState').value, 'attack');
});

test('check alone does not apply and any changed raw buffer needs a new check', async t => {
  const h = await fixture(t); await load(h); h.preview('CaseRun').click(); const row = h.preview('CaseSteps').children[0]; h.preview('CaseEdit').click();
  const original = h.editor('Text').value; h.editor('Check').click(); assert.equal(h.editor('Apply').disabled, false); assert.equal(h.preview('CaseSteps').children[0], row);
  h.editor('Text').value = '{'; h.editor('Apply').click(); assert.equal(h.editor('Panel').hidden, false); assert.equal(h.preview('CaseSteps').children[0], row);
  h.editor('Text').value = original; h.editor('Apply').disabled = false; h.editor('Apply').click(); assert.equal(h.editor('Panel').hidden, false); assert.equal(h.preview('CaseSteps').children[0], row);
  checkAndApply(h); assert.equal(h.editor('Panel').hidden, true); assert.equal(h.preview('CaseResult').hidden, true); assert.equal(h.changes(), 0);
});

test('author generation changes preserve the independent raw case and checked result', async t => {
  const h = await fixture(t); await load(h); h.preview('CaseRun').click(); h.preview('CaseEdit').click();
  const edited = h.draft(); edited.steps[0].input.event.value = 2; h.edit(edited); h.editor('Check').click(); const raw = h.editor('Text').value;
  h.el('AddState').click(); assert.equal(h.changes(), 1); assert.equal(h.value().states.length, 3);
  assert.equal(h.editor('Panel').hidden, false); assert.equal(h.editor('Text').value, raw); assert.equal(h.editor('Apply').disabled, false); assert.equal(h.preview('CaseResult').hidden, true);
  const source = h.source(); h.editor('Apply').click(); assert.equal(h.preview('CaseLoaded').hidden, false); assert.equal(h.preview('CaseResult').hidden, true);
  h.preview('CaseRun').click(); assert.deepEqual(h.statuses(), ['failed', 'not-run']); assert.equal(h.source(), source); assert.equal(h.changes(), 1);
});

test('ordinary author field edits do not reset a partially invalid raw case buffer', async t => {
  const h = await fixture(t); await load(h); h.preview('CaseEdit').click(); h.edit('{"steps":[\n');
  h.set(h.el('Transition1ConditionItem2Number'), '4'); assert.equal(h.editor('Panel').hidden, false); assert.equal(h.editor('Text').value, '{"steps":[\n'); assert.equal(h.changes(), 1);
  h.editor('Check').click(); assert.equal(h.editor('Text').value, '{"steps":[\n'); assert.equal(h.editor('Apply').disabled, true); h.editor('Cancel').click();
  h.preview('CaseRun').click(); assert.deepEqual(h.statuses(), ['failed', 'not-run']); assert.equal(h.changes(), 1);
});

test('folding keeps raw draft but requires a fresh check before application after reopening', async t => {
  const h = await fixture(t); await load(h); h.preview('CaseRun').click(); const row = h.preview('CaseSteps').children[0]; h.preview('CaseEdit').click();
  const edited = h.draft(); edited.steps[0].input.event.value = 2; h.edit(edited); h.editor('Check').click(); const raw = h.editor('Text').value;
  h.preview('Toggle').click(); assert.equal(h.preview('Body').hidden, true); h.preview('Toggle').click();
  assert.equal(h.editor('Text').value, raw); assert.equal(h.editor('Panel').hidden, false); assert.equal(h.editor('Apply').disabled, true); assert.equal(h.preview('CaseSteps').children[0], row);
  checkAndApply(h); assert.equal(h.preview('CaseResult').hidden, true); h.preview('CaseRun').click(); assert.deepEqual(h.statuses(), ['failed', 'not-run']); assert.equal(h.changes(), 0);
});

test('same-table reset removes loaded case and draft; retained old apply controls cannot restore them', async t => {
  const h = await fixture(t); await load(h); h.preview('CaseEdit').click(); h.editor('Check').click(); const oldApply = h.editor('Apply'), oldText = h.editor('Text'), raw = oldText.value;
  h.controller.setValue(table()); assert.equal(h.preview('Body').hidden, true); assert.equal(h.preview('CaseLoaded').hidden, true);
  oldText.value = raw; oldApply.disabled = false; oldApply.click(); h.preview('Toggle').click();
  assert.equal(h.editor('Panel').hidden, true); assert.equal(h.preview('CaseLoaded').hidden, true); assert.equal(h.preview('CaseResult').hidden, true); assert.equal(h.changes(), 0);
});

test('opening edit revokes an older pending file read that cannot replace an applied case later', async t => {
  const h = await fixture(t); await load(h); let resolve;
  h.preview('CaseImport').click(); h.preview('CaseFile').files = [{ name: 'late.json', size: caseText.length, text: () => new Promise(finish => { resolve = finish; }) }]; h.preview('CaseFile').dispatch('change'); await flushDialogs();
  h.preview('CaseEdit').click(); assert.equal(h.editor('Panel').hidden, false); const edited = h.draft(); edited.steps[0].input.event.value = 2; h.edit(edited); checkAndApply(h);
  resolve(caseText); await flushDialogs(); assert.equal(h.preview('CaseResult').hidden, true); h.preview('CaseRun').click(); assert.deepEqual(h.statuses(), ['failed', 'not-run']);
  assert.doesNotMatch(h.preview('CaseLoadedSummary').textContent, /late\.json/); assert.equal(h.changes(), 0);
});

test('closing the parent session clears a draft and ignores its former check/application controls', async t => {
  const h = await fixture(t); await load(h); h.preview('CaseEdit').click(); const raw = h.editor('Text').value; h.editor('Check').click();
  h.context.active = false; h.controller.refresh(); h.context.active = true; h.controller.refresh(); h.preview('Toggle').click();
  h.editor('Text').value = raw; h.editor('Apply').disabled = false; h.editor('Apply').click();
  assert.equal(h.editor('Panel').hidden, true); assert.equal(h.preview('CaseLoaded').hidden, true); assert.equal(h.preview('CaseResult').hidden, true); assert.equal(h.changes(), 0);
});
