import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { validateSceneControlProgram, validateSceneControlPlan, createSceneControlTraceReader,
  SCENE_CONTROL_V1_FILE_MAX_BYTES, SCENE_CONTROL_V2_FILE_MAX_BYTES } from '../../engine/scene-control-program.mjs';
import { createSceneRuntimeObservation, querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import { createSceneRuntimeEventReader } from '../../engine/scene-runtime-events.mjs';

const plans = await Promise.all([1, 2].map(version => fs.readFile(new URL(`./fixtures/scene-model/legacy-plan-v${version}.json`, import.meta.url), 'utf8')
  .then(value => JSON.parse(value).plan)));
const plan = plans[1], first = plan.actors[0].instanceId, second = plan.actors[1].instanceId;
const released = () => ({ left: false, right: false, up: false, down: false });
const row = (instanceId, keys = {}) => ({ instanceId, ...released(), ...keys });
const program = () => ({ format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.25,
  steps: [{ inputs: [row(first, { right: true }), row(second, { left: true })] },
    { inputs: [row(second, { up: true })] }, { inputs: [] }] });
const states = index => plan.actors.map((actor, ordinal) => ({ objectId: actor.objectId, instanceId: actor.instanceId,
  position: [actor.position[0] + (index < 0 ? 0 : ordinal === 0 ? 10 : -10), actor.position[1] + (index < 1 || ordinal === 0 ? 0 : -10)],
  state: index < 0 || index === 2 || index === 1 && ordinal === 0 ? 'idle' : 'moving' }));
const ready = () => ({ protocol: 2, event: 'ready', sceneObjectId: plan.scene.objectId, actors: states(-1) });
const sample = stepIndex => ({ format: 'viento-runtime-trace', schemaVersion: 1, protocolVersion: 2,
  event: 'sample', stepIndex, actors: states(stepIndex) });
const finished = () => ({ protocol: 2, event: 'finished', actors: states(2), fixedDelta: 0.25 });
const encoded = value => `${value.format === 'viento-runtime-trace' ? 'VIENTO_TRACE:' : 'VIENTO_RUNTIME:'}${JSON.stringify(value)}\n`;

test('schema 2 preserves exact instance input rows, empty release steps and deeply detached immutable programs', () => {
  const input = program(), expected = structuredClone(input), result = validateSceneControlProgram(input);
  assert.deepEqual(result, expected); assert.ok(Object.isFrozen(result) && Object.isFrozen(result.steps));
  assert.ok(result.steps.every(step => Object.isFrozen(step) && Object.isFrozen(step.inputs) && step.inputs.every(Object.isFrozen)));
  input.steps[0].inputs[0].left = true; input.steps[1].inputs[0].instanceId = first;
  assert.deepEqual(result, expected);
  const lastRows = program(); lastRows.steps.at(-1).inputs = [row(first), row(second)];
  assert.deepEqual(validateSceneControlProgram(lastRows), lastRows);
  const silent = { ...program(), steps: [{ inputs: [] }] }; assert.deepEqual(validateSceneControlProgram(silent), silent);
  assert.equal(SCENE_CONTROL_V1_FILE_MAX_BYTES, 16384); assert.equal(SCENE_CONTROL_V2_FILE_MAX_BYTES, 262144);
});

test('schema 2 refuses mixed versions, malformed identities, duplicate targets and unknown row or step fields', () => {
  const changes = [value => { value.schemaVersion = 3; }, value => { value.steps[0] = released(); },
    value => { value.steps[0].right = true; }, value => { value.steps[0].inputs = {}; },
    value => { value.steps[0].inputs[0].instanceId = plan.actors[0].objectId.toUpperCase(); },
    value => { delete value.steps[0].inputs[0].instanceId; }, value => { value.steps[0].inputs[0].objectId = plan.actors[0].objectId; },
    value => { value.steps[0].inputs[0].left = 0; }, value => { delete value.steps[0].inputs[0].up; },
    value => { value.steps[0].inputs[1].instanceId = first; }, value => { value.steps[0].inputs[0].entity = 1; },
    value => { value.steps[0].inputs[0].sourcePath = '/tmp/control.json'; }, value => { value.steps.at(-1).inputs = [row(first, { down: true })]; },
    value => { value.steps[0].inputs = Array.from({ length: 129 }, (_, index) => row(`${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`)); }];
  for (const change of changes) {
    const value = program(); change(value);
    assert.throws(() => validateSceneControlProgram(value), error => error.errorCode === 'runtime_control_invalid');
  }
  const legacy = { ...program(), schemaVersion: 1 }; assert.throws(() => validateSceneControlProgram(legacy), TypeError);
});

test('instance row accessors, sparse collections, hidden fields and prototypes never execute or become input data', () => {
  let invoked = 0; const getter = program();
  Object.defineProperty(getter.steps[0].inputs[0], 'right', { enumerable: true, get() { invoked++; return true; } });
  const sparse = program(); delete sparse.steps[0].inputs[0];
  const hidden = program(); Object.defineProperty(hidden.steps[0].inputs[0], 'extra', { value: true });
  const inherited = program(); inherited.steps[0].inputs[0] = Object.create(row(first));
  const symbol = program(); symbol.steps[0].inputs[0][Symbol('method')] = () => {};
  const cycle = program(); cycle.steps[0].inputs[0].self = cycle;
  const poisoned = program(); poisoned.steps[0].inputs[0] = JSON.parse('{"__proto__": {"right":true}}');
  for (const value of [getter, sparse, hidden, inherited, symbol, cycle, poisoned]) assert.throws(() => validateSceneControlProgram(value), TypeError);
  assert.equal(invoked, 0);
});

test('schema 2 retains duration and full-sample limits and separately bounds the total instance input rows', () => {
  const identifiers = Array.from({ length: 128 }, (_, index) => `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`);
  const inputs = identifiers.map(id => row(id));
  const full = { ...program(), steps: Array.from({ length: 8 }, () => ({ inputs: structuredClone(inputs) })) };
  assert.deepEqual(validateSceneControlProgram(full), full);
  const maxPlan = structuredClone(plan); maxPlan.actors = identifiers.map(instanceId => ({ ...plan.actors[0], instanceId }));
  assert.deepEqual(validateSceneControlPlan(maxPlan, full), full);
  const tooMany = { ...full, steps: [...full.steps, { inputs: [row(first)] }] };
  assert.throws(() => validateSceneControlProgram(tooMany), error => error.errorCode === 'runtime_control_limit');
  const sparseInputs = { ...full, steps: Array.from({ length: 9 }, () => ({ inputs: [] })) };
  assert.deepEqual(validateSceneControlProgram(sparseInputs), sparseInputs);
  assert.throws(() => validateSceneControlPlan(maxPlan, sparseInputs), error => error.errorCode === 'runtime_control_limit');
  const maxSteps = { ...program(), fixedDelta: 0.125, steps: Array.from({ length: 64 }, () => ({ inputs: [] })) };
  assert.deepEqual(validateSceneControlPlan(plan, maxSteps), maxSteps);
  for (const value of [{ ...maxSteps, fixedDelta: 0.25 }, { ...maxSteps, steps: [...maxSteps.steps, { inputs: [] }] },
    { ...program(), fixedDelta: 0 }, { ...program(), fixedDelta: 0.251 }, { ...program(), steps: [] }]) {
    assert.throws(() => validateSceneControlProgram(value), TypeError);
  }
});

test('valid large schema 2 collections report the input limit before copy-node defense without executing accessors', () => {
  const inputs = Array.from({ length: 128 }, (_, index) => row(`${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`));
  for (const count of [9, 10, 11, 64]) {
    const oversized = { ...program(), fixedDelta: 0.125, steps: Array.from({ length: count }, () => ({ inputs: structuredClone(inputs) })) };
    assert.throws(() => validateSceneControlProgram(oversized), error => error.errorCode === 'runtime_control_limit');
  }
  let invoked = 0;
  const getter = program(); Object.defineProperty(getter, 'schemaVersion', { enumerable: true, get() { invoked++; return 2; } });
  const stepGetter = program(); Object.defineProperty(stepGetter.steps[0], 'inputs', { enumerable: true, get() { invoked++; return inputs; } });
  const elementGetter = program(); Object.defineProperty(elementGetter.steps, '0', { enumerable: true, get() { invoked++; return { inputs }; } });
  for (const invalid of [getter, stepGetter, elementGetter]) {
    assert.throws(() => validateSceneControlProgram(invalid), error => error.errorCode === 'runtime_control_invalid');
  }
  assert.equal(invoked, 0);
});

test('instance targets are checked only against frozen instance IDs before reader or observation construction', () => {
  assert.equal(new Set(plan.actors.map(actor => actor.objectId)).size, 1);
  assert.deepEqual(validateSceneControlPlan(plan, program()), program());
  for (const target of [plan.actors[0].objectId, plan.scene.objectId, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee']) {
    const value = program(); value.steps[0].inputs[0].instanceId = target;
    for (const create of [() => validateSceneControlPlan(plan, value), () => createSceneControlTraceReader(plan, value),
      () => createSceneRuntimeObservation(plan, { controlProgram: value })]) {
      assert.throws(create, error => error.errorCode === 'runtime_control_target_missing');
    }
  }
  const aliasPlan = structuredClone(plan); aliasPlan.actors[0].instanceId = aliasPlan.actors[0].objectId;
  const aliasProgram = program(); aliasProgram.steps[0].inputs[0].instanceId = aliasPlan.actors[0].instanceId;
  assert.deepEqual(validateSceneControlPlan(aliasPlan, aliasProgram), aliasProgram);
});

test('instance programs reject legacy plans even when every step is an empty release while global schema 1 remains supported', () => {
  const value = { ...program(), steps: [{ inputs: [] }] };
  for (const create of [() => validateSceneControlPlan(plans[0], value), () => createSceneControlTraceReader(plans[0], value),
    () => createSceneRuntimeObservation(plans[0], { controlProgram: value })]) {
    assert.throws(create, error => error.errorCode === 'runtime_control_unsupported');
  }
  const legacy = { format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.25,
    steps: [{ ...released(), right: true }, released()] };
  for (const oldPlan of plans) assert.deepEqual(validateSceneControlPlan(oldPlan, legacy), legacy);
});

test('instance control admission keeps trace and runtime observation shapes unchanged and does not infer missing-target motion', () => {
  const controlProgram = program(), observer = createSceneRuntimeObservation(plan, { controlProgram });
  const eventReader = createSceneRuntimeEventReader(plan, { onEvent: event => observer.push(event) });
  const seen = [], reader = createSceneControlTraceReader(plan, controlProgram, {
    onRuntime: text => eventReader.push(text), onSample: value => { seen.push(value); assert.equal(observer.pushSample(value), true); },
  });
  reader.push([ready(), sample(0), sample(1)].map(encoded).join(''));
  const partial = observer.snapshot(); assert.equal(partial.phase, 'ready'); assert.equal(partial.control.completedSteps, 2);
  assert.equal(partial.actors[0].state, 'idle'); assert.equal(partial.actors[1].state, 'moving');
  assert.deepEqual(querySceneRuntimeObservation(partial, { instanceId: second }).actors, [partial.actors[1]]);
  assert.deepEqual(Object.keys(partial.control).sort(), ['completedSteps', 'fixedDelta', 'stepCount']);
  for (const value of seen) {
    assert.equal(value.schemaVersion, 1); assert.equal(value.protocolVersion, 2);
    assert.deepEqual(Object.keys(value).sort(), ['actors', 'event', 'format', 'protocolVersion', 'schemaVersion', 'stepIndex']);
  }
  reader.push([sample(2), finished()].map(encoded).join('')); assert.deepEqual(reader.finish().diagnostics, []);
  assert.deepEqual(eventReader.finish().diagnostics, []); const final = observer.snapshot();
  assert.equal(final.phase, 'finished'); assert.equal(final.control.completedSteps, 3);
  assert.ok(final.actors.every(actor => actor.positionSample === 'finished' && !Object.hasOwn(actor, 'positionStep')));
  // Admission records values reported by the trusted backend. It does not
  // derive positions from the omitted first-instance input in the second step.
  assert.deepEqual(final.actors.map(actor => actor.position), states(2).map(actor => actor.position));
});

test('schema 2 control validation and trace sequencing remain portable without filesystem or engine globals', async () => {
  const source = await fs.readFile(new URL('../../engine/scene-control-program.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import\s/m); const context = vm.createContext({});
  vm.runInContext(source.replaceAll('export ', '') + '\nglobalThis.controlApi = { validateSceneControlPlan, createSceneControlTraceReader };', context);
  assert.equal(vm.runInContext('typeof process+":"+typeof Buffer+":"+typeof document+":"+typeof window+":"+typeof require', context), 'undefined:undefined:undefined:undefined:undefined');
  const result = vm.runInContext(`(() => { const plan = ${JSON.stringify(plan)}, program = ${JSON.stringify(program())};
    const checked = controlApi.validateSceneControlPlan(plan,program), reader = controlApi.createSceneControlTraceReader(plan,checked);
    reader.push(${JSON.stringify([ready(), sample(0), sample(1), sample(2), finished()].map(encoded).join(''))});
    return JSON.stringify(reader.finish()); })()`, context);
  const value = JSON.parse(result); assert.equal(value.samples.length, 3); assert.deepEqual(value.diagnostics, []);
});
