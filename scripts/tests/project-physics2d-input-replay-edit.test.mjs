import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT_PHYSICS2D_INPUT_REPLAY_FORMAT as format, PROJECT_PHYSICS2D_INPUT_REPLAY_STEPS as count,
  PROJECT_PHYSICS2D_INPUT_REPLAY_DELTA as delta, validateProjectPhysics2DInputReplay as validate } from '../../engine/project-physics2d-input-replay.mjs';
import { PROJECT_PHYSICS2D_INPUT_REPLAY_ACTIONS as actions, setProjectPhysics2DInputReplayRange as setRange,
  clearProjectPhysics2DInputReplay as clear, convertProjectPhysics2DInputReplayToInstances as toInstances } from '../../engine/project-physics2d-input-replay-edit.mjs';

const released = () => ({ left: false, right: false, up: false, down: false, jump: false });
const program = () => ({ format, schemaVersion: 1, fixedDelta: delta, steps: Array.from({ length: count }, released) });
const editInvalid = fn => assert.throws(fn, error => error instanceof TypeError && error.errorCode === 'runtime_physics2d_input_edit_invalid');

test('range editing is inclusive, isolated to one action, and leaves the source untouched', () => {
  const input = program(); input.steps[3].left = true; input.steps[4].jump = true;
  const before = structuredClone(input);
  const output = setRange(input, 'right', 2, 5, true);
  assert.deepEqual(input, before);
  assert.deepEqual(output.steps.map(step => step.right), input.steps.map((_, i) => i >= 2 && i <= 5));
  assert.equal(output.steps[3].left, true); assert.equal(output.steps[4].jump, true);
  assert.notEqual(output, input); assert.notEqual(output.steps, input.steps);
  assert.ok(Object.isFrozen(output) && Object.isFrozen(output.steps) && output.steps.every(Object.isFrozen));
  assert.deepEqual(validate(output), output);
  input.steps[3].left = false; assert.equal(output.steps[3].left, true);
});

test('editing accepts frozen snapshots, releases subranges, and clears every track', () => {
  let input = setRange(program(), 'up', 0, count - 2, true);
  input = setRange(input, 'jump', 3, 8, true);
  const releasedRange = setRange(input, 'up', 1, count - 1, false);
  assert.equal(releasedRange.steps[0].up, true);
  assert.ok(releasedRange.steps.slice(1).every(step => !step.up));
  assert.ok(releasedRange.steps.slice(3, 9).every(step => step.jump));
  const blank = clear(releasedRange);
  assert.ok(blank.steps.every(step => actions.every(action => !step[action])));
  assert.equal(releasedRange.steps[0].up, true);
  assert.deepEqual(validate(blank), blank);
});

test('invalid edits fail without mutating the input, including final-frame presses', () => {
  const input = program(), before = structuredClone(input);
  for (const args of [
    ['other', 0, 0, true], ['__proto__', 0, 0, true], [null, 0, 0, true],
    ['left', -1, 1, true], ['left', 2, 1, true], ['left', 0, count, false],
    ['left', 0, count - 1, true], ['left', count - 1, count - 1, true],
    ['left', 0.5, 1, true], ['left', '0', 1, true], ['left', 0, Infinity, true],
    ['left', 0, 1, 1], ['left', 0, 1, undefined],
  ]) editInvalid(() => setRange(input, ...args));
  assert.deepEqual(input, before);
});

test('operations validate the original before edits rather than masking malformed data', () => {
  const input = program(); input.steps[count - 1].jump = true;
  assert.throws(() => setRange(input, 'jump', 0, count - 1, false), { errorCode: 'runtime_physics2d_input_invalid' });
  assert.throws(() => clear(input), { errorCode: 'runtime_physics2d_input_invalid' });
  let called = false;
  Object.defineProperty(input.steps[0], 'left', { enumerable: true, get() { called = true; return false; } });
  assert.throws(() => clear(input), { errorCode: 'runtime_physics2d_input_invalid' });
  assert.equal(called, false);
});

const instance = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const targeted = () => ({ format, schemaVersion: 2, fixedDelta: delta,
  steps: Array.from({ length: count }, () => ({ inputs: [] })) });
const row = (n, action) => ({ instanceId: instance(n), ...released(), ...(action ? { [action]: true } : {}) });

test('v2 range editing isolates the selected instance, adds only pressed rows and leaves other fields untouched', () => {
  const input = targeted();
  input.steps[2].inputs = [row(2, 'left'), row(1, 'jump')];
  input.steps[3].inputs = [row(2, 'up')];
  const before = structuredClone(input), output = setRange(input, 'right', 2, 4, true, instance(1));
  assert.deepEqual(input, before);
  assert.deepEqual(output.steps[2].inputs, [row(2, 'left'), { ...row(1, 'jump'), right: true }]);
  assert.deepEqual(output.steps[3].inputs, [row(2, 'up'), row(1, 'right')]);
  assert.deepEqual(output.steps[4].inputs, [row(1, 'right')]);
  assert.deepEqual(output.steps[5].inputs, []);
  assert.ok(Object.isFrozen(output.steps[2].inputs[1]));
  const releasedRange = setRange(output, 'right', 3, 29, false, instance(1));
  assert.equal(releasedRange.steps[2].inputs[1].right, true);
  assert.equal(releasedRange.steps[3].inputs[1].right, false);
  assert.deepEqual(releasedRange.steps[5].inputs, []);
  assert.deepEqual(releasedRange.steps[29].inputs, []);
  assert.deepEqual(validate(releasedRange), releasedRange);
});

test('v2 can clear one instance or every instance while preserving row order and detached shape', () => {
  const input = targeted(); input.steps[0].inputs = [row(2, 'left'), row(1, 'right')];
  const one = clear(input, instance(1));
  assert.deepEqual(one.steps[0].inputs, [row(2, 'left'), row(1)]);
  const all = clear(one);
  assert.deepEqual(all.steps[0].inputs, [row(2), row(1)]);
  assert.equal(input.steps[0].inputs[1].right, true);
  assert.notEqual(all.steps[0].inputs[0], one.steps[0].inputs[0]);
  assert.deepEqual(clear(all, instance(3)), all);
});

test('v2 edit targets, row budget and final-step release are strict and atomic', () => {
  const input = targeted(); input.steps[0].inputs = Array.from({ length: 8 }, (_, i) => row(i + 1));
  const before = structuredClone(input);
  for (const target of [undefined, null, '', 'hero', {}, 1]) {
    editInvalid(() => setRange(input, 'right', 0, 0, true, target));
    if (target !== undefined) editInvalid(() => clear(input, target));
  }
  editInvalid(() => setRange(input, 'jump', 0, 0, true, instance(9)));
  const spread = targeted();
  for (let i = 0; i < 8; i++) spread.steps[i].inputs = [row(i + 1)];
  editInvalid(() => setRange(spread, 'right', 10, 10, true, instance(9)));
  assert.deepEqual(spread.steps[10], { inputs: [] });
  editInvalid(() => setRange(input, 'jump', 29, 29, true, instance(1)));
  assert.deepEqual(setRange(input, 'right', 0, 0, false, instance(9)), input);
  assert.equal(setRange(input, 'right', 0, 0, true, instance(1)).steps[0].inputs[0].right, true);
  editInvalid(() => setRange(program(), 'right', 0, 0, true, instance(1)));
  editInvalid(() => clear(program(), instance(1)));
  assert.deepEqual(input, before);
  const invalid = targeted(); invalid.steps[29].inputs = [row(1, 'jump')];
  assert.throws(() => clear(invalid), { errorCode: 'runtime_physics2d_input_invalid' });
});


test('explicit v1-to-v2 conversion copies every action to each selected instance without changing the source', () => {
  const input = program(); input.steps[0].right = true; input.steps[2].jump = true; input.steps[8].down = true;
  const before = structuredClone(input), ids = Object.freeze([instance(2), instance(1)]);
  const output = toInstances(input, ids);
  assert.equal(output.schemaVersion, 2);
  output.steps.forEach((step, index) => assert.deepEqual(step.inputs, ids.map(instanceId => ({ instanceId, ...before.steps[index] }))));
  assert.deepEqual(input, before);
  assert.ok(Object.isFrozen(output.steps[0].inputs[0]));
  assert.notEqual(output.steps[0].inputs[0], output.steps[0].inputs[1]);
  input.steps[0].right = false; assert.equal(output.steps[0].inputs[1].right, true);
  assert.deepEqual(validate(output), output);
  assert.equal(toInstances(before, Array.from({ length: 8 }, (_, i) => instance(i + 1))).steps.flatMap(step => step.inputs).length, 240);
});

test('v2 conversion only clones and never remaps or drops targets from an existing instance program', () => {
  const input = targeted(); input.steps[0].inputs = [row(2, 'left'), row(1, 'right')];
  const before = structuredClone(input), output = toInstances(input, [instance(3)]);
  assert.deepEqual(output, before); assert.notEqual(output.steps[0].inputs[0], input.steps[0].inputs[0]);
  assert.deepEqual(toInstances(input), before);
  assert.equal(input.steps[0].inputs[1].right, true);
});

test('conversion rejects malformed, oversized, repeated and executable target lists before getters run', () => {
  let called = false;
  for (const ids of [undefined, null, {}, [], [instance(1), instance(1)], ['hero'], [instance(1), null],
    Array.from({ length: 9 }, (_, i) => instance(i + 1))]) editInvalid(() => toInstances(program(), ids));
  for (const change of [
    ids => { delete ids[0]; },
    ids => { Object.defineProperty(ids, '0', { enumerable: false, value: instance(1) }); },
    ids => { Object.defineProperty(ids, '0', { enumerable: true, get() { called = true; return instance(1); } }); },
    ids => { ids.extra = true; }, ids => { ids[Symbol('extra')] = true; },
    ids => { ids.toJSON = () => []; }, ids => { Object.setPrototypeOf(ids, null); },
  ]) { const ids = [instance(1)]; change(ids); editInvalid(() => toInstances(program(), ids)); }
  assert.equal(called, false);
  const malformed = program(); malformed.steps[29].jump = true;
  assert.throws(() => toInstances(malformed, [instance(1)]), { errorCode: 'runtime_physics2d_input_invalid' });
});
