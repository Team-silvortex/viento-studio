import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT_PHYSICS2D_INPUT_REPLAY_FORMAT as format, PROJECT_PHYSICS2D_INPUT_REPLAY_STEPS as count,
  PROJECT_PHYSICS2D_INPUT_REPLAY_DELTA as delta, validateProjectPhysics2DInputReplay as validate } from '../../engine/project-physics2d-input-replay.mjs';

const released = () => ({ left: false, right: false, up: false, down: false, jump: false });
const program = () => ({ format, schemaVersion: 1, fixedDelta: delta, steps: Array.from({ length: count }, released) });
const invalid = value => assert.throws(() => validate(value), error => error instanceof TypeError && error.errorCode === 'runtime_physics2d_input_invalid');

test('thirty 60 Hz action samples are detached and frozen without changing the original', () => {
  const input = program(); input.steps[0].right = true; input.steps[1].jump = true;
  const result = validate(input);
  assert.deepEqual(result, input);
  assert.notEqual(result, input); assert.notEqual(result.steps, input.steps); assert.notEqual(result.steps[0], input.steps[0]);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.steps)); assert.ok(result.steps.every(Object.isFrozen));
  input.steps[0].right = false; assert.equal(result.steps[0].right, true);
});

test('format, version, duration and complete release are strict', () => {
  for (const change of [p => { p.format = 'viento-runtime-control'; }, p => { p.schemaVersion = 3; },
    p => { p.fixedDelta = .016; }, p => { p.fixedDelta = 0; }, p => { p.steps.pop(); },
    p => { p.steps.push(released()); }, p => { p.steps[29].jump = true; },
    p => { p.steps[29].right = true; }, p => { p.extra = true; }]) {
    const input = program(); change(input); invalid(input);
  }
});

test('each sample requires exactly five explicit booleans', () => {
  for (const change of [p => { delete p.steps[0].jump; }, p => { p.steps[0].jump = 1; },
    p => { p.steps[0].right = 'true'; }, p => { p.steps[0].other = false; },
    p => { p.steps[0] = null; }, p => { p.steps[0] = []; }]) {
    const input = program(); change(input); invalid(input);
  }
});

test('rejects accessors, sparse arrays, hidden properties, symbols and custom prototypes', () => {
  let called = false;
  for (const change of [
    p => { Object.defineProperty(p, 'format', { enumerable: true, get() { called = true; return format; } }); },
    p => { Object.defineProperty(p.steps[0], 'jump', { enumerable: true, get() { called = true; return false; } }); },
    p => { delete p.steps[3]; },
    p => { Object.defineProperty(p.steps, '1', { enumerable: false, value: released() }); },
    p => { p.steps[0][Symbol('extra')] = true; },
    p => { Object.defineProperty(p.steps[0], 'extra', { value: true }); },
    p => { Object.setPrototypeOf(p.steps[0], { jump: false }); },
    p => { p.steps.toJSON = () => []; },
  ]) { const input = program(); change(input); invalid(input); }
  assert.equal(called, false);
});

const instance = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const targeted = () => ({ format, schemaVersion: 2, fixedDelta: delta,
  steps: Array.from({ length: count }, () => ({ inputs: [] })) });
const targetRow = (n, action) => ({ instanceId: instance(n), ...released(), ...(action ? { [action]: true } : {}) });

test('v2 independently admits at most eight explicit instance rows per step and deep-freezes detached data', () => {
  const input = targeted();
  input.steps[0].inputs = [targetRow(1, 'right'), targetRow(2, 'left')];
  input.steps[4].inputs = Array.from({ length: 8 }, (_, i) => targetRow(i + 1, 'jump'));
  input.steps[29].inputs = [targetRow(1)];
  const before = structuredClone(input), output = validate(input);
  assert.deepEqual(output, before); assert.deepEqual(input, before);
  assert.notEqual(output.steps[0], input.steps[0]);
  assert.notEqual(output.steps[0].inputs, input.steps[0].inputs);
  assert.notEqual(output.steps[0].inputs[0], input.steps[0].inputs[0]);
  assert.ok(Object.isFrozen(output) && Object.isFrozen(output.steps));
  assert.ok(output.steps.every(step => Object.isFrozen(step) && Object.isFrozen(step.inputs) && step.inputs.every(Object.isFrozen)));
  input.steps[0].inputs[0].right = false;
  assert.equal(output.steps[0].inputs[0].right, true);
  assert.deepEqual(validate(output), output);
});

test('v2 rows cannot duplicate an instance, exceed the budget, omit action fields or press the final step', () => {
  for (const change of [
    p => { p.steps[0].inputs = [targetRow(1), targetRow(1)]; },
    p => { p.steps[0].inputs = Array.from({ length: 9 }, (_, i) => targetRow(i + 1)); },
    p => { for (let i = 0; i < 9; i++) p.steps[i].inputs = [targetRow(i + 1)]; },
    p => { p.steps[0].inputs = [{ ...targetRow(1), instanceId: 'hero' }]; },
    p => { p.steps[0].inputs = [{ ...targetRow(1), instanceId: 'ABCDEFAB-0000-0000-0000-000000000001' }]; },
    p => { const row = targetRow(1); delete row.jump; p.steps[0].inputs = [row]; },
    p => { p.steps[0].inputs = [{ ...targetRow(1), jump: 1 }]; },
    p => { p.steps[0].inputs = [{ ...targetRow(1), extra: false }]; },
    p => { p.steps[0] = { ...released(), inputs: [] }; },
    p => { p.steps[0] = {}; },
    p => { p.steps[0].inputs = null; },
    p => { p.steps[29].inputs = [targetRow(1, 'jump')]; },
    p => { p.steps[29].inputs = [targetRow(1, 'left')]; },
  ]) { const input = targeted(); change(input); invalid(input); }
  const full = targeted();
  full.steps = full.steps.map((_, index) => ({ inputs: Array.from({ length: 8 }, (_, i) => targetRow(i + 1, index < 29 ? 'right' : null)) }));
  assert.equal(validate(full).steps.flatMap(step => step.inputs).length, 240);
});

test('v2 nested descriptors reject executable, hidden, sparse and inherited data before getters execute', () => {
  let called = 0;
  const getter = { enumerable: true, get() { called++; return []; } };
  for (const change of [
    p => { Object.defineProperty(p.steps[0], 'inputs', getter); },
    p => { Object.defineProperty(p.steps[0].inputs, '0', { ...getter, get() { called++; return targetRow(1); } }); },
    p => { Object.defineProperty(p.steps[0].inputs[0], 'instanceId', { ...getter, get() { called++; return instance(1); } }); },
    p => { Object.defineProperty(p.steps[0].inputs[0], 'jump', { ...getter, get() { called++; return false; } }); },
    p => { delete p.steps[0].inputs[0]; },
    p => { Object.defineProperty(p.steps[0].inputs, '0', { enumerable: false, value: targetRow(1) }); },
    p => { p.steps[0].inputs.extra = false; },
    p => { p.steps[0].inputs[Symbol('extra')] = true; },
    p => { p.steps[0].inputs.toJSON = () => []; },
    p => { Object.setPrototypeOf(p.steps[0].inputs, null); },
    p => { Object.setPrototypeOf(p.steps[0].inputs[0], { instanceId: instance(1) }); },
    p => { Object.defineProperty(p.steps[0].inputs[0], 'hidden', { value: 1 }); },
    p => { p.steps[0].inputs[0][Symbol('extra')] = 1; },
  ]) {
    const input = targeted(); input.steps[0].inputs = [targetRow(1)]; change(input); invalid(input);
  }
  assert.equal(called, 0);
});

test('v2 omitted targets are explicit empty steps, not retained input from previous frames', () => {
  const input = targeted(); input.steps[0].inputs = [targetRow(1, 'right')];
  const output = validate(input);
  assert.deepEqual(output.steps[1], { inputs: [] });
  assert.deepEqual(output.steps[29], { inputs: [] });
  const first = Object.assign(Object.create(null), targetRow(1));
  input.steps[0].inputs = [first];
  assert.deepEqual(validate(input).steps[0].inputs[0], targetRow(1));
});
