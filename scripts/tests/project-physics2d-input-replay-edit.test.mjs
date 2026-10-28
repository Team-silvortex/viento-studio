import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT_PHYSICS2D_INPUT_REPLAY_FORMAT as format, PROJECT_PHYSICS2D_INPUT_REPLAY_STEPS as count,
  PROJECT_PHYSICS2D_INPUT_REPLAY_DELTA as delta, validateProjectPhysics2DInputReplay as validate } from '../../engine/project-physics2d-input-replay.mjs';
import { PROJECT_PHYSICS2D_INPUT_REPLAY_ACTIONS as actions, setProjectPhysics2DInputReplayRange as setRange,
  clearProjectPhysics2DInputReplay as clear } from '../../engine/project-physics2d-input-replay-edit.mjs';

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
