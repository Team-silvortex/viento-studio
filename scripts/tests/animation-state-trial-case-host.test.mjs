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

const caseText = JSON.stringify({ format: 'viento.animation-state-trial-case', version: 1, initialStateKey: 'idle', steps: [
  { input: {kind: 'event', event: {name: 'go', value: 3}, projectState: [{key: 'combat.enabled', value: true}]}, expected: {stateKey: 'attack', transition: true} },
  { input: {kind: 'completed'}, expected: {stateKey: 'idle', transition: true} },
] });
const settle = () => new Promise(resolve => setImmediate(resolve));
async function load(h, file = new File([caseText], 'trial.json', {type:'application/json'})) {
  h.preview('CaseImport').click(); h.preview('CaseFile').files = [file]; h.preview('CaseFile').dispatch('change'); await settle();
}
const statuses = h => h.preview('CaseSteps').children.map(row => row.dataset.status);

test('case import and replay preserve parent author source, change count, current path and pending adoption', async t => {
  const h=await fixture(t), before=h.value(), source=generateEditableGodotAnimationStateScript(before).content;
  h.preview('Toggle').click(); h.set(h.preview('Shared1Type'),'boolean','change');h.set(h.preview('Shared1Boolean'),'true','change');h.run(3);h.preview('Adopt').click();
  h.set(h.preview('TriggerKind'),'completed','change');h.preview('Run').click();const pending=h.preview('Result'), history=h.preview('HistoryList').children[0];
  await load(h);assert.equal(h.preview('CaseLoaded').hidden,false);assert.equal(h.preview('CaseResult').hidden,true);h.preview('CaseRun').click();assert.deepEqual(statuses(h),['passed','passed']);
  assert.equal(h.preview('Result'),pending);assert.equal(pending.hidden,false);assert.equal(h.preview('HistoryList').children[0],history);assert.equal(h.preview('CurrentState').value,'attack');assert.equal(h.preview('Adopt').disabled,false);
  assert.deepEqual(h.value(),before);assert.equal(generateEditableGodotAnimationStateScript(h.value()).content,source);assert.equal(h.changes(),0);
  h.preview('Adopt').click();assert.equal(h.preview('HistoryList').children.length,2);assert.equal(h.preview('CurrentState').value,'idle');assert.deepEqual(statuses(h),['passed','passed']);
});

test('author edits retain imported input but revoke old replay; mismatch stops and reset clears the case', async t => {
  const h=await fixture(t);h.preview('Toggle').click();await load(h);h.preview('CaseRun').click();assert.deepEqual(statuses(h),['passed','passed']);
  h.set(h.el('Transition1ConditionItem2Number'),'4');assert.equal(h.preview('CaseLoaded').hidden,false);assert.equal(h.preview('CaseResult').hidden,true);assert.equal(h.changes(),1);
  h.preview('CaseRun').click();assert.deepEqual(statuses(h),['failed','not-run']);const changed=h.value();
  h.set(h.el('Transition1ConditionItem2Number'),'3');assert.equal(h.preview('CaseResult').hidden,true);h.preview('CaseRun').click();assert.deepEqual(statuses(h),['passed','passed']);assert.equal(h.changes(),2);
  h.controller.setValue(changed);assert.equal(h.preview('CaseLoaded').hidden,true);assert.equal(h.preview('CaseResult').hidden,true);assert.equal(h.preview('Body').hidden,true);
});

test('late file read cannot cross parent folding or same-table author reset', async t => {
  const h=await fixture(t);h.preview('Toggle').click();let finish;
  const file={name:'late.json',size:caseText.length,text:()=>new Promise(resolve=>{finish=resolve;})};
  await load(h,file);h.preview('Toggle').click();h.preview('Toggle').click();finish(caseText);await settle();assert.equal(h.preview('CaseLoaded').hidden,true);
  await load(h,file);h.controller.setValue(table());h.preview('Toggle').click();finish(caseText);await settle();assert.equal(h.preview('CaseLoaded').hidden,true);assert.equal(h.changes(),0);
});
