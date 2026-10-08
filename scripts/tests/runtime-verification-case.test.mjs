import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { RUNTIME_CASE_FORMAT, RUNTIME_CASE_EVALUATION_FORMAT, RUNTIME_CASE_FILE_MAX_BYTES, RUNTIME_CASE_CHECK_LIMIT,
  validateRuntimeCase, validateRuntimeCasePlan, evaluateRuntimeCase } from '../../engine/runtime-verification-case.mjs';

const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const second = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const objectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const unknown = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const arrows = (right = false) => ({ left: false, right, up: false, down: false });
const program = () => ({ format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.25, steps: [arrows(true), arrows()] });
const plan = () => ({ format: 'viento-build-plan', kind: 'scene2d', schemaVersion: 2,
  scene: { objectId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', sourcePath: 'documents/scenes/demo.json' },
  actors: [{ instanceId: first, objectId }, { instanceId: second, objectId }] });
const definition = () => ({ format: RUNTIME_CASE_FORMAT, schemaVersion: 1, program: program(), checks: [
  { instanceId: first, stepIndex: 0, position: { value: [10, 20], tolerance: 0 }, state: 'moving' },
  { instanceId: second, stepIndex: 0, position: { value: [30, 40], tolerance: 0 } },
  { instanceId: first, stepIndex: 1, state: 'idle' },
] });
const sample = stepIndex => ({ format: 'viento-runtime-trace', schemaVersion: 1, protocolVersion: 2, event: 'sample', stepIndex,
  actors: [{ instanceId: first, objectId, position: [10, 20], state: stepIndex === 0 ? 'moving' : 'idle' },
    { instanceId: second, objectId, position: [30, 40], state: stepIndex === 0 ? 'moving' : 'idle' }] });
const samples = () => [sample(0), sample(1)];
const is = code => value => value instanceof TypeError && value.errorCode === code;
const invalid = is('runtime_case_invalid');
const invalidSample = is('runtime_case_sample_invalid');

test('runtime cases detach and freeze global or instance programs and both expectation fields', () => {
  const input = definition(), value = validateRuntimeCase(input);
  assert.deepEqual(value, input); assert.notEqual(value, input);
  assert.equal(RUNTIME_CASE_FILE_MAX_BYTES, 256 * 1024); assert.equal(RUNTIME_CASE_CHECK_LIMIT, 128);
  for (const item of [value, value.program, value.program.steps, value.program.steps[0], value.checks,
    value.checks[0], value.checks[0].position, value.checks[0].position.value]) assert.equal(Object.isFrozen(item), true);
  input.program.steps[0].right = false; input.checks[0].position.value[0] = 999;
  assert.equal(value.program.steps[0].right, true); assert.deepEqual(value.checks[0].position.value, [10, 20]);
  const instance = definition();
  instance.program = { ...program(), schemaVersion: 2, steps: [{ inputs: [{ instanceId: first, ...arrows(true) }] }, { inputs: [] }] };
  assert.deepEqual(validateRuntimeCasePlan(plan(), instance).program, instance.program);
});

test('case and check fields are exact data with at least one expectation and no object or host aliases', () => {
  for (const key of ['format', 'schemaVersion', 'program', 'checks']) {
    const value = definition(); delete value[key]; assert.throws(() => validateRuntimeCase(value), invalid);
  }
  for (const key of ['name', 'backendId', 'tool', 'path', 'code', 'executionStatus']) {
    assert.throws(() => validateRuntimeCase({ ...definition(), [key]: '/private/value' }), invalid);
  }
  for (const check of [
    { instanceId: first, stepIndex: 0 }, { objectId, stepIndex: 0, state: 'idle' },
    { instanceId: first, stepIndex: 0, state: 'Idle' }, { instanceId: first, stepIndex: 0, state: null },
    { instanceId: first, stepIndex: 0, position: null },
    { instanceId: first, stepIndex: 0, position: { value: [10, 20] } },
    { instanceId: first, stepIndex: 0, position: { value: [10, 20], tolerance: 0, relative: true } },
    { instanceId: first, stepIndex: 0, position: { value: [10, 20, 30], tolerance: 0 } },
    { instanceId: first.toUpperCase(), stepIndex: 0, state: 'idle' },
  ]) assert.throws(() => validateRuntimeCase({ ...definition(), checks: [check] }), invalid);
  assert.throws(() => validateRuntimeCase({ ...definition(), schemaVersion: 2 }), invalid);
});

test('checks use zero-based program steps and unique instance-step pairs with a 128 row bound', () => {
  for (const stepIndex of [-1, 2, 0.5, '0', true, NaN, Infinity]) {
    assert.throws(() => validateRuntimeCase({ ...definition(), checks: [{ instanceId: first, stepIndex, state: 'idle' }] }), invalid);
  }
  const duplicate = definition(); duplicate.checks.push({ instanceId: first, stepIndex: 0, state: 'idle' });
  assert.throws(() => validateRuntimeCase(duplicate), invalid);
  assert.throws(() => validateRuntimeCase({ ...definition(), checks: [] }), invalid);
  const full = { ...definition(), program: { ...program(), fixedDelta: 0.125, steps: Array.from({ length: 64 }, () => arrows()) },
    checks: Array.from({ length: 128 }, (_, index) => ({ instanceId: index % 2 ? second : first, stepIndex: Math.floor(index / 2), state: 'idle' })) };
  assert.equal(validateRuntimeCasePlan(plan(), full).checks.length, 128);
  full.checks.push({ instanceId: unknown, stepIndex: 0, state: 'idle' });
  assert.throws(() => validateRuntimeCase(full), is('runtime_case_limit'));
  const overCopyArrayBudget = { ...definition(), checks: Array.from({ length: 1025 }, (_, index) => ({
    instanceId: `cccccccc-cccc-4ccc-8ccc-${index.toString(16).padStart(12, '0')}`, stepIndex: 0, state: 'idle' })) };
  assert.throws(() => validateRuntimeCase(overCopyArrayBudget), is('runtime_case_limit'));
});

test('plan admission accepts only actual frozen plan2 instances, including same-definition occurrences', () => {
  const value = definition(); assert.deepEqual(validateRuntimeCasePlan(plan(), value), value);
  for (const schemaVersion of [1, 3]) {
    assert.throws(() => validateRuntimeCasePlan({ ...plan(), schemaVersion }, value), is('runtime_case_unsupported'));
  }
  for (const instanceId of [objectId, unknown]) {
    assert.throws(() => validateRuntimeCasePlan(plan(), { ...value, checks: [{ instanceId, stepIndex: 0, state: 'idle' }] }),
      is('runtime_case_target_missing'));
  }
  const equalIdentity = plan(); equalIdentity.actors[0].instanceId = objectId;
  assert.equal(validateRuntimeCasePlan(equalIdentity, { ...value, checks: [{ instanceId: objectId, stepIndex: 0, state: 'idle' }] }).checks.length, 1);
  const targeted = { ...value, program: { ...program(), schemaVersion: 2, steps: [{ inputs: [{ instanceId: unknown, ...arrows(true) }] }, { inputs: [] }] } };
  assert.throws(() => validateRuntimeCasePlan(plan(), targeted), is('runtime_case_target_missing'));
});

test('old control duration, final release, input and actor-step budgets remain admission prerequisites', () => {
  for (const changed of [
    { fixedDelta: 0 }, { fixedDelta: 0.251 }, { steps: [arrows(true)] },
    { steps: Array.from({ length: 33 }, () => arrows()) },
  ]) assert.throws(() => validateRuntimeCase({ ...definition(), program: { ...program(), ...changed } }), invalid);
  const many = plan(); many.actors = Array.from({ length: 128 }, (_, index) => ({ objectId,
    instanceId: `bbbbbbbb-bbbb-4bbb-8bbb-${index.toString(16).padStart(12, '0')}` }));
  const long = { ...definition(), program: { ...program(), fixedDelta: 0.125, steps: Array.from({ length: 9 }, () => arrows()) },
    checks: [{ instanceId: many.actors[0].instanceId, stepIndex: 0, state: 'idle' }] };
  assert.throws(() => validateRuntimeCasePlan(many, long), is('runtime_case_limit'));
  // Keep the existing descriptor-only 1024-row limit diagnostic, even when a
  // full case copy would otherwise encounter its node budget first.
  const oversized = { ...long, program: { ...long.program, schemaVersion: 2,
    steps: Array.from({ length: 64 }, () => ({ inputs: many.actors.map(actor => ({ instanceId: actor.instanceId, ...arrows() })) })) } };
  assert.throws(() => validateRuntimeCase(oversized), is('runtime_case_limit'));
  // The full permitted program, checks and trace tree must fit the defensive
  // copy budgets together, rather than rejecting a legal maximum workload.
  const maximum = { ...long, program: { ...long.program, schemaVersion: 2,
    steps: Array.from({ length: 8 }, () => ({ inputs: many.actors.map(actor => ({ instanceId: actor.instanceId, ...arrows() })) })) },
    checks: many.actors.map(actor => ({ instanceId: actor.instanceId, stepIndex: 7, state: 'idle' })) };
  const maximumSamples = Array.from({ length: 8 }, (_, stepIndex) => ({ ...sample(stepIndex),
    actors: many.actors.map(actor => ({ ...actor, position: [0, 0], state: 'idle' })) }));
  const result = evaluateRuntimeCase(many, maximum, maximumSamples, { complete: true });
  assert.equal(result.status, 'passed'); assert.equal(result.passedChecks, 128); assert.equal(result.sampleCount, 8);
});

test('evaluation distinguishes same-definition instances and freezes standalone expected and actual results', () => {
  const input = definition(), observed = samples();
  observed[0].actors.reverse();
  const result = evaluateRuntimeCase(plan(), input, observed, { complete: true });
  assert.equal(result.format, RUNTIME_CASE_EVALUATION_FORMAT); assert.equal(result.schemaVersion, 1);
  assert.deepEqual([result.status, result.complete, result.stepCount, result.sampleCount, result.checkCount], ['passed', true, 2, 2, 3]);
  assert.deepEqual([result.passedChecks, result.failedChecks, result.unavailableChecks], [3, 0, 0]);
  assert.deepEqual(result.checks[0], { checkIndex: 0, instanceId: first, stepIndex: 0, status: 'passed',
    expected: { position: { value: [10, 20], tolerance: 0 }, state: 'moving' }, actual: { position: [10, 20], state: 'moving' },
    positionPassed: true, statePassed: true });
  assert.equal(result.checks[1].statePassed, null); assert.equal(result.checks[2].positionPassed, null);
  input.checks[0].position.value[0] = 999; observed[0].actors.find(actor => actor.instanceId === first).position[0] = 888;
  assert.deepEqual(result.checks[0].actual.position, [10, 20]); assert.deepEqual(result.checks[0].expected.position.value, [10, 20]);
  for (const item of [result, result.checks, result.checks[0], result.checks[0].expected, result.checks[0].actual,
    result.checks[0].actual.position]) assert.equal(Object.isFrozen(item), true);
  assert.equal(Object.hasOwn(result, 'executionStatus'), false);
});

test('position tolerance is explicit per axis and inclusive, with exact state outcomes and no hidden epsilon', () => {
  const value = definition(); value.checks[0].position.tolerance = 0.25;
  const observed = samples(); observed[0].actors[0].position = [10.25, 19.75];
  assert.equal(evaluateRuntimeCase(plan(), value, observed, { complete: true }).status, 'passed');
  observed[0].actors[0].position[1] = 19.749;
  let result = evaluateRuntimeCase(plan(), value, observed, { complete: true });
  assert.equal(result.status, 'failed'); assert.equal(result.complete, true);
  assert.equal(result.checks[0].positionPassed, false); assert.equal(result.checks[0].statePassed, true);
  const exactCase = { ...definition(), checks: [{ instanceId: first, stepIndex: 0, position: { value: [0, 0], tolerance: 0 } }] };
  observed[0].actors[0].position = [Number.EPSILON, 0];
  assert.equal(evaluateRuntimeCase(plan(), exactCase, observed, { complete: true }).status, 'failed');
  observed[0].actors[0].state = 'idle';
  result = evaluateRuntimeCase(plan(), definition(), observed, { complete: true });
  assert.equal(result.checks[0].statePassed, false);
});

test('finite expectations and user-selected large tolerances have no artificial magnitude cap', () => {
  const value = { ...definition(), checks: [{ instanceId: first, stepIndex: 0,
    position: { value: [1e100, -1e100], tolerance: 1e101 } }] };
  assert.equal(evaluateRuntimeCase(plan(), value, samples(), { complete: true }).status, 'passed');
  for (const tolerance of [-1, NaN, Infinity, '0']) {
    assert.throws(() => validateRuntimeCase({ ...value, checks: [{ ...value.checks[0], position: { value: [0, 0], tolerance } }] }), invalid);
  }
  const observed = samples(); observed[0].actors[0].position = [-Number.MAX_VALUE, 0];
  value.checks[0].position = { value: [Number.MAX_VALUE, 0], tolerance: Number.MAX_VALUE };
  const result = evaluateRuntimeCase(plan(), value, observed, { complete: true });
  assert.equal(result.status, 'failed'); assert.ok(!JSON.stringify(result).includes('Infinity'));
});

test('partial or externally incomplete runs retain observed check outcomes and mark missing samples unavailable', () => {
  const observed = samples(); observed[0].actors[0].state = 'idle';
  const result = evaluateRuntimeCase(plan(), definition(), observed.slice(0, 1), { complete: true });
  assert.equal(result.status, 'incomplete'); assert.equal(result.complete, false);
  assert.deepEqual([result.passedChecks, result.failedChecks, result.unavailableChecks], [1, 1, 1]);
  assert.deepEqual(result.checks[2], { checkIndex: 2, instanceId: first, stepIndex: 1, status: 'unavailable',
    expected: { position: null, state: 'idle' }, actual: null, positionPassed: null, statePassed: null });
  const cancelled = evaluateRuntimeCase(plan(), definition(), samples(), { complete: false });
  assert.equal(cancelled.status, 'incomplete'); assert.equal(cancelled.passedChecks, 3);
  assert.equal(evaluateRuntimeCase(plan(), definition(), samples()).status, 'incomplete');
  const absent = evaluateRuntimeCase(plan(), definition(), [], { complete: false });
  assert.equal(absent.status, 'incomplete'); assert.equal(absent.unavailableChecks, 3);
  assert.ok(absent.checks.every(check => check.actual === null));
  for (const options of [{ complete: 'true' }, { complete: true, executionStatus: 'succeeded' }, null]) {
    assert.throws(() => evaluateRuntimeCase(plan(), definition(), samples(), options), invalid);
  }
});

test('sample admission rejects missing prefixes, duplicate or extra steps and fabricated lifecycle events', () => {
  for (const input of [[sample(1)], [sample(1), sample(0)], [sample(0), sample(0)],
    [sample(0), sample(1), sample(2)], [null], [{ ...sample(0), event: 'ready' }], [{ ...sample(0), event: 'finished' }],
    [{ ...sample(0), protocolVersion: 1 }], [{ ...sample(0), schemaVersion: 2 }],
    [{ ...sample(0), stepIndex: '0' }], [{ ...sample(0), fixedDelta: 0.25 }]]) {
    assert.throws(() => evaluateRuntimeCase(plan(), definition(), input, { complete: true }), invalidSample);
  }
  assert.equal(evaluateRuntimeCase(plan(), definition(), [], { complete: true }).status, 'incomplete');
});

test('sample admission requires all frozen identity pairs and finite typed positions and states', () => {
  for (const mutate of [
    value => value.actors.pop(), value => { value.actors[1] = structuredClone(value.actors[0]); },
    value => { value.actors[0].instanceId = unknown; }, value => { value.actors[0].objectId = unknown; },
    value => { value.actors[0].position = [Infinity, 0]; }, value => { value.actors[0].position = ['10', 20]; },
    value => { value.actors[0].state = null; }, value => { value.actors[0].node = '/outside'; },
  ]) {
    const value = sample(0); mutate(value);
    assert.throws(() => evaluateRuntimeCase(plan(), definition(), [value], { complete: false }), invalidSample);
  }
});

test('case, sample and completion accessors or polluted non-data trees never execute during admission', () => {
  let calls = 0;
  const getter = definition(); Object.defineProperty(getter, 'program', { enumerable: true, get() { calls++; return program(); } });
  const nested = definition(); Object.defineProperty(nested.checks[0].position, 'tolerance', { enumerable: true, get() { calls++; return 0; } });
  const hidden = definition(); Object.defineProperty(hidden, 'path', { value: '/outside' });
  const cyclic = definition(); cyclic.checks.push(cyclic);
  const sparse = definition(); delete sparse.checks[1];
  for (const value of [getter, nested, hidden, cyclic, sparse, Object.assign(Object.create({ authority: true }), definition()),
    { ...definition(), [Symbol('secret')]: true }, JSON.parse('{"format":"viento-runtime-case","schemaVersion":1,"program":{},"checks":[],"__proto__":{}}')]) {
    assert.throws(() => validateRuntimeCase(value), invalid);
  }
  const frame = sample(0); Object.defineProperty(frame.actors[0], 'position', { enumerable: true, get() { calls++; return [10, 20]; } });
  assert.throws(() => evaluateRuntimeCase(plan(), definition(), [frame]), invalidSample);
  const options = {}; Object.defineProperty(options, 'complete', { enumerable: true, get() { calls++; return true; } });
  assert.throws(() => evaluateRuntimeCase(plan(), definition(), samples(), options), invalid);
  const frozenPlan = plan(); Object.defineProperty(frozenPlan, 'schemaVersion', { enumerable: true, get() { calls++; return 2; } });
  assert.throws(() => validateRuntimeCasePlan(frozenPlan, definition()), invalid);
  assert.equal(calls, 0);
});

test('case validation and evaluation share the portable control core without Node or DOM authority', async () => {
  const [control, runtimeCase] = await Promise.all([
    fs.readFile(new URL('../../engine/scene-control-program.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../engine/runtime-verification-case.mjs', import.meta.url), 'utf8'),
  ]);
  const source = `const shared=(()=>{${control.replaceAll('export ', '')};return {validateSceneControlProgram,validateSceneControlPlan,SCENE_CONTROL_TRACE_FORMAT};})();
    (()=>{${runtimeCase.replace(/^import[^\n]+\n/m, 'const {validateSceneControlProgram,validateSceneControlPlan,SCENE_CONTROL_TRACE_FORMAT}=shared;\n').replaceAll('export ', '')}
    return JSON.stringify(evaluateRuntimeCase(${JSON.stringify(plan())},${JSON.stringify(definition())},${JSON.stringify(samples())},{complete:true}));})();`;
  const result = JSON.parse(new vm.Script(source).runInContext(vm.createContext({})));
  assert.equal(result.status, 'passed'); assert.equal(result.passedChecks, 3); assert.equal(result.complete, true);
  assert.equal(result.checks[0].positionPassed, true);
});
