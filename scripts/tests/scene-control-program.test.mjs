import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { validateSceneControlProgram, validateSceneControlPlan, createSceneControlTraceReader,
  SCENE_CONTROL_TRACE_FORMAT } from '../../engine/scene-control-program.mjs';
import { createSceneRuntimeEventReader } from '../../engine/scene-runtime-events.mjs';
import { createSceneRuntimeObservation, querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';

const plans = await Promise.all([1, 2].map(version => fs.readFile(new URL(`./fixtures/scene-model/legacy-plan-v${version}.json`, import.meta.url), 'utf8')
  .then(value => JSON.parse(value).plan)));
const release = () => ({ left: false, right: false, up: false, down: false });
const program = (count = 3, fixedDelta = 0.25) => ({ format: 'viento-runtime-control', schemaVersion: 1, fixedDelta,
  steps: Array.from({ length: count }, (_, index) => ({ ...release(), right: index !== count - 1 })) });
const actors = (plan, stepIndex = -1) => plan.actors.map((actor, index) => ({ objectId: actor.objectId,
  ...(plan.schemaVersion !== 1 ? { instanceId: actor.instanceId } : {}),
  position: [actor.position[0] + (stepIndex < 0 ? 0 : (stepIndex + 1) * (index + 1)), actor.position[1]],
  state: 'idle' }));
const ready = plan => ({ protocol: plan.schemaVersion, event: 'ready', sceneObjectId: plan.scene.objectId, actors: actors(plan) });
const sample = (plan, stepIndex) => ({ format: SCENE_CONTROL_TRACE_FORMAT, schemaVersion: 1,
  protocolVersion: plan.schemaVersion, event: 'sample', stepIndex, actors: actors(plan, stepIndex) });
const finished = (plan, replay = program()) => ({ protocol: plan.schemaVersion, event: 'finished',
  fixedDelta: replay.fixedDelta, actors: actors(plan, replay.steps.length - 1) });
const frame = value => `${value.format === SCENE_CONTROL_TRACE_FORMAT ? 'VIENTO_TRACE:' : 'VIENTO_RUNTIME:'}${JSON.stringify(value)}\n`;
const state = plan => ({ protocol: plan.schemaVersion, event: 'state', objectId: plan.actors[0].objectId,
  ...(plan.schemaVersion === 2 ? { instanceId: plan.actors[0].instanceId } : {}), state: 'moving' });
const frames = (plan, replay = program()) => [ready(plan), ...replay.steps.map((_, index) => sample(plan, index)), finished(plan, replay)];

test('finite control programs accept exact boolean input, boundary duration and detached immutable data', () => {
  for (const input of [program(1), program(32), program(64, 0.125), program(64, Number.MIN_VALUE)]) {
    const expected = structuredClone(input), value = validateSceneControlProgram(input);
    assert.deepEqual(value, expected); assert.notEqual(value, input);
    assert.ok(Object.isFrozen(value) && Object.isFrozen(value.steps) && value.steps.every(Object.isFrozen));
    input.steps[0].left = true; assert.deepEqual(value, expected);
  }
  const both = program(); both.steps[0].left = true; both.steps[0].up = true; both.steps[0].down = true;
  assert.deepEqual(validateSceneControlProgram(both), both);
});

test('control program limits reject hidden paths, execution fields, numeric overflow and unreleased final inputs', () => {
  const changes = [
    value => { value.format = 'other'; }, value => { value.schemaVersion = 2; },
    ...[0, -0.1, 0.250001, Infinity, NaN, '0.25', null].map(delta => value => { value.fixedDelta = delta; }),
    value => { value.steps = []; }, value => { value.steps = program(65, 0.01).steps; },
    value => { value.steps = program(33).steps; }, value => { value.steps[0].right = 1; },
    value => { delete value.steps[0].up; }, value => { value.steps[0].direction = [1, 0]; },
    value => { value.steps.at(-1).up = true; }, value => { value.entity = 1; },
    value => { value.path = '/tmp/commands.json'; }, value => { value.steps[0].objectId = plans[1].actors[0].objectId; },
  ];
  for (const change of changes) {
    const value = program(); change(value);
    assert.throws(() => validateSceneControlProgram(value), error => error instanceof TypeError && error.errorCode === 'runtime_control_invalid');
  }
});

test('control data rejects accessors, prototypes, sparse arrays, symbols and cycles without invoking values', () => {
  let invoked = 0;
  const getter = program(); Object.defineProperty(getter.steps[0], 'right', { enumerable: true, get() { invoked++; return true; } });
  const hidden = program(); Object.defineProperty(hidden, 'hidden', { value: true });
  const sparse = program(); delete sparse.steps[0];
  const symbol = program(); symbol[Symbol('payload')] = true;
  const cycle = program(); cycle.steps[0].cycle = cycle;
  const arrayPrototype = program(); Object.setPrototypeOf(arrayPrototype.steps, Object.create(Array.prototype));
  const inherited = Object.create(program());
  for (const value of [getter, hidden, sparse, symbol, cycle, arrayPrototype, inherited, null, [],
    JSON.parse('{"__proto__":{}}'), { ...program(), fixedDelta: 1n }]) {
    assert.throws(() => validateSceneControlProgram(value), TypeError);
  }
  assert.equal(invoked, 0);
});

test('joint actor and step budget is rejected before trace or observer creation while boundary replay remains valid', () => {
  const plan = structuredClone(plans[1]);
  plan.actors = Array.from({ length: 128 }, (_, index) => ({ ...plan.actors[0],
    instanceId: `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111` }));
  assert.deepEqual(validateSceneControlPlan(plan, program(8)), program(8));
  assert.doesNotThrow(() => createSceneControlTraceReader(plan, program(8)));
  assert.doesNotThrow(() => createSceneRuntimeObservation(plan, { controlProgram: program(8) }));
  for (const create of [() => validateSceneControlPlan(plan, program(9)),
    () => createSceneControlTraceReader(plan, program(9)), () => createSceneRuntimeObservation(plan, { controlProgram: program(9) })]) {
    assert.throws(create, error => error.errorCode === 'runtime_control_limit');
  }
  assert.deepEqual(validateSceneControlPlan(plans[1], program(64, 0.125)), program(64, 0.125));
});

test('control plan admission rejects incompatible identity and unsafe provenance while omitting large author data', () => {
  const changes = [value => { value.kind = 'other'; }, value => { value.schemaVersion = 3; },
    value => { value.scene.sourcePath = '/etc/passwd'; }, value => { value.scene.sourcePath = '../outside'; },
    value => { value.scene.objectId = 'entity:1'; }, value => { value.actors = []; },
    value => { value.actors[1].instanceId = value.actors[0].instanceId; }, value => { delete value.actors[0].instanceId; },
    value => { value.actors[0].objectId = 'bad'; }, value => { value.actors = Array(2); }];
  for (const change of changes) {
    const value = structuredClone(plans[1]); change(value);
    assert.throws(() => validateSceneControlPlan(value, program()), TypeError);
  }
  let invoked = 0; const getter = structuredClone(plans[1]);
  Object.defineProperty(getter.actors[0], 'objectId', { enumerable: true, get() { invoked++; return plans[1].actors[0].objectId; } });
  assert.throws(() => validateSceneControlPlan(getter, program()), TypeError); assert.equal(invoked, 0);
  const long = structuredClone(plans[1]); long.actors[0].name = 'Author title\n'.repeat(100000);
  assert.deepEqual(validateSceneControlPlan(long, program()), program());
  for (const path of ['documents/demo:a.json', 'documents/line\nbreak.json']) {
    const value = structuredClone(plans[1]); value.scene.sourcePath = path;
    assert.doesNotThrow(() => validateSceneControlPlan(value, program()));
  }
});

test('control trace protocol 1 and 2 maps complete actor identities independent of ECS order', () => {
  for (const plan of plans) {
    const reader = createSceneControlTraceReader(plan, program()), accepted = [];
    const values = frames(plan); values[1].actors.reverse(); values.at(-1).actors.reverse();
    accepted.push(...reader.push(values.map(frame).join('')));
    const result = reader.finish(); assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.samples, values.slice(1, -1)); assert.deepEqual(accepted, result.samples);
    assert.ok(result.samples.every(item => Object.isFrozen(item) && Object.isFrozen(item.actors)));
    result.samples.pop(); assert.equal(reader.samples.length, 3);
    assert.deepEqual(reader.push(frame(sample(plan, 0))), []);
  }
});

test('one-chunk lifecycle and sample callbacks retain stream order for the existing observer and event reader', () => {
  for (const plan of plans) {
    const observer = createSceneRuntimeObservation(plan, { controlProgram: program() }), order = [];
    const runtime = createSceneRuntimeEventReader(plan, { onEvent: event => {
      order.push(event.event); observer.push(event);
    } });
    const reader = createSceneControlTraceReader(plan, program(), {
      onRuntime: text => runtime.push(text), onSample: value => { order.push(`sample:${value.stepIndex}`); assert.equal(observer.pushSample(value), true); },
    });
    const values = frames(plan); values.splice(2, 0, state(plan));
    reader.push(values.map(frame).join('')); assert.deepEqual(reader.finish().diagnostics, []);
    assert.deepEqual(runtime.finish().diagnostics, []);
    assert.deepEqual(order, ['ready', 'sample:0', 'state', 'sample:1', 'sample:2', 'finished']);
    const view = observer.snapshot(); assert.equal(view.phase, 'finished'); assert.equal(view.sequence, 6);
    assert.deepEqual(view.control, { stepCount: 3, completedSteps: 3, fixedDelta: 0.25 });
    assert.deepEqual(view.actors.map(item => item.position), actors(plan, 2).map(item => item.position));
    assert.ok(view.actors.every(item => item.positionSample === 'finished' && !Object.hasOwn(item, 'positionStep')));
  }
});

test('a rejected contradictory final frame cannot replace the last valid control observation', () => {
  const plan = plans[1], observer = createSceneRuntimeObservation(plan, { controlProgram: program() });
  const runtime = createSceneRuntimeEventReader(plan, { onEvent: event => observer.push(event) });
  const reader = createSceneControlTraceReader(plan, program(), {
    onRuntime: text => runtime.push(text), onSample: value => observer.pushSample(value),
  });
  reader.push(frames(plan).slice(0, -1).map(frame).join('')); const before = observer.snapshot();
  const contradictory = finished(plan); contradictory.actors[0].position[0] += 100;
  reader.push(frame(contradictory)); assert.deepEqual(observer.snapshot(), before);
  assert.equal(observer.snapshot().phase, 'ready'); assert.equal(reader.diagnostics.length, 1);
  assert.deepEqual(runtime.events.map(value => value.event), ['ready']);
  reader.finish({ requireComplete: false }); assert.deepEqual(observer.snapshot(), before);
});

test('malformed trace identities and fields are rejected atomically without losing valid subsequent samples', () => {
  for (const plan of plans) {
    const changes = [
      value => { value.protocolVersion = 3; }, value => { value.schemaVersion = 2; }, value => { value.format = 'other'; },
      value => { value.event = 'state'; }, value => { value.stepIndex = -1; }, value => { value.stepIndex = 1; },
      value => { value.stepIndex = 0.1; }, value => { value.actors.pop(); }, value => { value.actors[0] = null; },
      value => { value.actors[1] = structuredClone(value.actors[0]); }, value => { value.actors[0].objectId = plan.scene.objectId; },
      value => { value.actors[0].position = [1]; }, value => { value.actors[0].position = ['1', 2]; },
      value => { value.actors[0].state = 'running'; }, value => { value.actors[0].sourcePath = '/etc/passwd'; },
      value => { value.actors[0].entity = 7; }, value => { value.tool = '/tmp/tool'; },
    ];
    if (plan.schemaVersion === 2) changes.push(value => { delete value.actors[0].instanceId; });
    else changes.push(value => { value.actors[0].instanceId = plans[1].actors[0].instanceId; });
    for (const change of changes) {
      const reader = createSceneControlTraceReader(plan, program()), bad = sample(plan, 0); change(bad);
      reader.push(frame(ready(plan))); assert.doesNotThrow(() => reader.push(`VIENTO_TRACE:${JSON.stringify(bad)}\n`));
      assert.equal(reader.samples.length, 0); assert.equal(reader.diagnostics.length, 1);
      reader.push(frames(plan).slice(1).map(frame).join(''));
      const result = reader.finish(); assert.equal(result.samples.length, 3); assert.equal(result.diagnostics.length, 1);
      assert.ok(result.diagnostics.every(item => item.sourcePath === plan.scene.sourcePath));
    }
  }
});

test('trace lifecycle rejects early, duplicate, reordered, surplus and inconsistent final frames', () => {
  const plan = plans[1], value = program(), base = frames(plan);
  const badFinished = structuredClone(base.at(-1)); badFinished.actors[0].position[0] += 1;
  for (const values of [
    [sample(plan, 0)], [ready(plan), ready(plan)], [ready(plan), sample(plan, 1)],
    [ready(plan), sample(plan, 0), sample(plan, 0)], base.slice(0, -1),
    [...base.slice(0, -1), { ...finished(plan), fixedDelta: 0.125 }], [...base.slice(0, -1), badFinished],
    [...base, sample(plan, 3)], [...base, ready(plan)], [ready(plan), finished(plan)],
  ]) {
    const reader = createSceneControlTraceReader(plan, value); reader.push(values.map(frame).join(''));
    assert.ok(reader.finish().diagnostics.length > 0);
  }
  const cancelled = createSceneControlTraceReader(plan, value); cancelled.push(base.slice(0, 2).map(frame).join(''));
  assert.equal(cancelled.finish({ requireComplete: false }).diagnostics.length, 0);
  assert.equal(cancelled.samples.length, 1);
  assert.equal(cancelled.finish().diagnostics.length, 0);
  const malformed = createSceneControlTraceReader(plan, value); malformed.push('VIENTO_TRACE:{bad\n');
  assert.equal(malformed.finish({ requireComplete: false }).diagnostics.length, 1);
});

test('trace fragmentation, CRLF, ordinary logs and an unfinished final line preserve bounded admission', () => {
  const plan = plans[1], reader = createSceneControlTraceReader(plan, program()), text = 'Bevy log VIENTO_TRACE:ignored\r\n'
    + frames(plan).map(frame).join('').replaceAll('\n', '\r\n').trimEnd();
  for (let index = 0; index < text.length; index += 7) reader.push(text.slice(index, index + 7));
  const result = reader.finish(); assert.equal(result.samples.length, 3); assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(reader.finish(), result);
  const bounded = createSceneControlTraceReader(plan, program());
  bounded.push('ordinary '.repeat(10000) + '\n'); assert.equal(bounded.diagnostics.length, 0);
  bounded.push('VIENTO_TRACE:' + 'x'.repeat(100000) + '\n'); assert.equal(bounded.diagnostics.length, 1);
  bounded.push(frame(ready(plan))); bounded.push(frame(sample(plan, 1)).repeat(1000));
  assert.equal(bounded.diagnostics.length, 128); assert.equal(bounded.samples.length, 0);
  assert.equal(bounded.finish({ requireComplete: false }).diagnostics.length, 128);
});

test('control observations update full samples, mark later state samples stale and retain independent repeated instances', () => {
  const plan = plans[1], observer = createSceneRuntimeObservation(plan, { controlProgram: program() });
  assert.deepEqual(observer.snapshot().control, { stepCount: 3, completedSteps: 0, fixedDelta: 0.25 });
  observer.push(ready(plan)); assert.equal(observer.pushSample(sample(plan, 0)), true);
  const fresh = observer.snapshot(); assert.equal(fresh.phase, 'ready'); assert.equal(fresh.sequence, 2);
  assert.ok(fresh.actors.every(actor => actor.positionSample === 'control' && actor.positionStep === 0 && actor.positionCurrent));
  observer.push(state(plan)); const stale = observer.snapshot();
  assert.equal(stale.actors[0].positionCurrent, false); assert.equal(stale.actors[1].positionCurrent, true);
  assert.deepEqual(stale.actors[0].position, fresh.actors[0].position);
  const one = querySceneRuntimeObservation(stale, { instanceId: plan.actors[1].instanceId });
  assert.deepEqual(one.actors, [stale.actors[1]]); assert.deepEqual(one.control, stale.control);
  assert.deepEqual(querySceneRuntimeObservation(querySceneRuntimeObservation(stale, { objectId: plan.scene.objectId })).actors, []);
  const incoming = sample(plan, 1); assert.equal(observer.pushSample(incoming), true); incoming.actors[0].position[0] = -999;
  assert.deepEqual(observer.snapshot().actors[0].position, actors(plan, 1)[0].position);
  assert.deepEqual(querySceneRuntimeObservation(observer.snapshot()), observer.snapshot());
});

test('control observer rejects bad complete samples and premature completion atomically, without changing legacy DTOs', () => {
  const plan = plans[1], replay = program(), observer = createSceneRuntimeObservation(plan, { controlProgram: replay });
  assert.equal(observer.pushSample(sample(plan, 0)), false); observer.push(ready(plan));
  const before = observer.snapshot();
  for (const change of [value => { value.actors.pop(); }, value => { value.actors[1] = structuredClone(value.actors[0]); },
    value => { value.actors[0].position[0] = Infinity; }, value => { value.actors[0].entity = 1; },
    value => { value.stepIndex = 1; }, value => { value.protocolVersion = 1; }]) {
    const value = sample(plan, 0); change(value); assert.equal(observer.pushSample(value), false); assert.deepEqual(observer.snapshot(), before);
  }
  assert.equal(observer.push(finished(plan)), false); assert.deepEqual(observer.snapshot(), before);
  for (let index = 0; index < 3; index++) assert.equal(observer.pushSample(sample(plan, index)), true);
  const complete = observer.snapshot(); assert.equal(observer.pushSample(sample(plan, 3)), false);
  assert.equal(observer.push({ ...finished(plan), fixedDelta: 0.125 }), false); assert.deepEqual(observer.snapshot(), complete);
  assert.equal(observer.push(finished(plan)), true); assert.equal(observer.pushSample(sample(plan, 0)), false);
  for (const plan of [...plans, { ...plans[1], schemaVersion: 3 }]) {
    const legacy = createSceneRuntimeObservation(plan); assert.equal(Object.hasOwn(legacy.snapshot(), 'control'), false);
    assert.equal(legacy.pushSample(sample(plans[1], 0)), false); assert.equal(legacy.push(ready(plan)), true);
    assert.ok(legacy.snapshot().actors.every(actor => !Object.hasOwn(actor, 'positionStep')));
  }
  assert.throws(() => createSceneRuntimeObservation({ ...plan, schemaVersion: 3 }, { controlProgram: replay }), TypeError);
});

test('queries reject fabricated control progress, inconsistent position steps and control fields in old observations', () => {
  const plan = plans[1], observer = createSceneRuntimeObservation(plan, { controlProgram: program() });
  observer.push(ready(plan)); observer.pushSample(sample(plan, 0)); const view = observer.snapshot();
  const changes = [value => { value.control.completedSteps = 2; }, value => { value.control.completedSteps = -1; },
    value => { value.control.stepCount = 65; }, value => { value.control.fixedDelta = 0; },
    value => { value.control.executable = '/tmp/evil'; }, value => { value.actors[0].positionStep = 1; },
    value => { delete value.actors[0].positionStep; }, value => { value.actors[0].positionSample = 'ready'; },
    value => { value.sequence = 1; }, value => { value.protocolVersion = 3; }, value => { value.actors[0].positionCurrent = false; }];
  for (const change of changes) { const bad = structuredClone(view); change(bad); assert.throws(() => querySceneRuntimeObservation(bad), TypeError); }
  const old = createSceneRuntimeObservation(plan); old.push(ready(plan)); const oldView = old.snapshot(); oldView.actors[0].positionStep = 0;
  assert.throws(() => querySceneRuntimeObservation(oldView), TypeError);
  const readyOnly = observer.snapshot(); readyOnly.phase = 'finished'; readyOnly.actors.forEach(actor => {
    actor.positionSample = 'finished'; delete actor.positionStep;
  }); assert.throws(() => querySceneRuntimeObservation(readyOnly), TypeError);
});

test('portable control validation and trace admission run without imports, Node, DOM or filesystem globals', async () => {
  const source = await fs.readFile(new URL('../../engine/scene-control-program.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import\s/m);
  const context = vm.createContext({});
  vm.runInContext(source.replaceAll('export ', '') + '\nglobalThis.controlReader = createSceneControlTraceReader;', context);
  assert.equal(vm.runInContext('typeof process+":"+typeof Buffer+":"+typeof document+":"+typeof window+":"+typeof require', context), 'undefined:undefined:undefined:undefined:undefined');
  const result = vm.runInContext(`(() => { const reader = controlReader(${JSON.stringify(plans[1])}, ${JSON.stringify(program())});
    reader.push(${JSON.stringify(frames(plans[1]).map(frame).join(''))}); return JSON.stringify(reader.finish()); })()`, context);
  const value = JSON.parse(result); assert.equal(value.samples.length, 3); assert.deepEqual(value.diagnostics, []);
});
