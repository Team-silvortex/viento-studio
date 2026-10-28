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
  for (const change of [p => { p.format = 'viento-runtime-control'; }, p => { p.schemaVersion = 2; },
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
