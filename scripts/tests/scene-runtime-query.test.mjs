import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createSceneRuntimeObservation, querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import { createScene2DPlan } from '../../engine/build-plan.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';

const plans = await Promise.all([1, 2].map(version => fs.readFile(new URL(`./fixtures/scene-model/legacy-plan-v${version}.json`, import.meta.url), 'utf8')
  .then(value => JSON.parse(value).plan)));
plans.push({ ...structuredClone(plans[1]), schemaVersion: 3 });
const clone = value => structuredClone(value);
const states = plan => plan.actors.map(actor => ({ objectId: actor.objectId,
  ...(plan.schemaVersion !== 1 ? { instanceId: actor.instanceId } : {}), position: [...actor.position], state: 'idle' }));
const ready = plan => ({ protocol: plan.schemaVersion, event: 'ready', sceneObjectId: plan.scene.objectId, actors: states(plan) });
const finished = plan => ({ protocol: plan.schemaVersion, event: 'finished', actors: states(plan), fixedDelta: 0.25 });
const state = (plan, value = 'moving', index = 0) => ({ protocol: plan.schemaVersion, event: 'state', objectId: plan.actors[index].objectId,
  ...(plan.schemaVersion !== 1 ? { instanceId: plan.actors[index].instanceId } : {}), state: value });
const observation = (plan = plans[1]) => createSceneRuntimeObservation(plan);

test('waiting observations use frozen plan identity, name and source with no simulated coordinates in protocols 1, 2 and 3', () => {
  for (const plan of plans) {
    const view = observation(plan).snapshot();
    assert.equal(view.format, 'viento-runtime-observation'); assert.equal(view.schemaVersion, 1);
    assert.equal(view.sceneObjectId, plan.scene.objectId); assert.equal(view.protocolVersion, plan.schemaVersion);
    assert.equal(view.phase, 'waiting'); assert.equal(view.sequence, 0);
    assert.equal(view.actors.length, plan.actors.length);
    for (const [index, actor] of view.actors.entries()) {
      assert.equal(actor.objectId, plan.actors[index].objectId); assert.equal(actor.name, plan.actors[index].name);
      assert.equal(actor.instanceId, plan.schemaVersion === 1 ? undefined : plan.actors[index].instanceId);
      assert.equal(actor.position, null); assert.equal(actor.state, null); assert.equal(actor.positionSample, null);
      assert.equal(actor.positionCurrent, false);
      assert.deepEqual(actor.source, { ...plan.actors[index].declaration, sourceRevision: plan.scene.sourceRevision });
      assert.deepEqual(Object.keys(actor).sort(), ['objectId', ...(plan.schemaVersion === 1 ? [] : ['instanceId']),
        'name', 'position', 'state', 'positionSample', 'positionCurrent', 'source'].sort());
    }
    assert.deepEqual(querySceneRuntimeObservation(view), view);
  }
});

test('ready collections are mapped by identity into plan order and only observed frames advance sequence', () => {
  for (const plan of plans) {
    const observer = observation(plan), frame = ready(plan); frame.actors.reverse();
    assert.equal(observer.push(frame), true);
    const view = observer.snapshot(); assert.equal(view.phase, 'ready'); assert.equal(view.sequence, 1);
    assert.deepEqual(view.actors.map(actor => actor.objectId), plan.actors.map(actor => actor.objectId));
    assert.deepEqual(view.actors.map(actor => actor.position), plan.actors.map(actor => actor.position));
    assert.ok(view.actors.every(actor => actor.state === 'idle' && actor.positionSample === 'ready' && actor.positionCurrent));
    assert.equal(observer.push({ protocol: plan.schemaVersion, event: 'diagnostic', severity: 'error', code: 'example', message: 'A diagnostic.' }), false);
    assert.equal(observer.push({ protocol: plan.schemaVersion, event: 'behavior', bindingId: 'binding', name: 'checkpoint', arguments: [] }), false);
    assert.deepEqual(observer.snapshot(), view);
  }
});

test('a state event makes only its instance coordinate sample stale and returning idle never restores coordinate freshness', () => {
  for (const plan of plans) {
    const observer = observation(plan); observer.push(ready(plan));
    assert.equal(observer.push(state(plan)), true);
    const moving = observer.snapshot(); assert.equal(moving.sequence, 2); assert.equal(moving.actors[0].state, 'moving');
    assert.deepEqual(moving.actors[0].position, plan.actors[0].position); assert.equal(moving.actors[0].positionSample, 'ready');
    assert.equal(moving.actors[0].positionCurrent, false); assert.equal(moving.actors[1].positionCurrent, true);
    assert.equal(observer.push(state(plan, 'idle')), true);
    const idle = observer.snapshot(); assert.equal(idle.sequence, 3); assert.equal(idle.actors[0].state, 'idle');
    assert.equal(idle.actors[0].positionCurrent, false); assert.deepEqual(idle.actors[0].position, plan.actors[0].position);
    assert.deepEqual(querySceneRuntimeObservation(idle).actors, idle.actors);
  }
});

test('finished restores complete final samples and freezes the terminal observation', () => {
  for (const plan of plans) {
    const observer = observation(plan); observer.push(ready(plan)); observer.push(state(plan));
    const finalFrame = finished(plan); finalFrame.actors[0].position[0] += 40;
    finalFrame.actors.reverse(); assert.equal(observer.push(finalFrame), true);
    const view = observer.snapshot(); assert.equal(view.phase, 'finished'); assert.equal(view.sequence, 3);
    assert.equal(view.actors[0].position[0], plan.actors[0].position[0] + 40);
    assert.ok(view.actors.every(actor => actor.positionSample === 'finished' && actor.positionCurrent));
    for (const frame of [state(plan), ready(plan), finished(plan), { protocol: plan.schemaVersion, event: 'diagnostic' }]) {
      assert.equal(observer.push(frame), false); assert.deepEqual(observer.snapshot(), view);
    }
  }
});

test('invalid complete actor collections and lifecycle frames are rejected atomically for every protocol', () => {
  for (const plan of plans) {
    const mutations = [
      frame => { frame.actors.pop(); }, frame => { frame.actors.push(clone(frame.actors[0])); },
      frame => { frame.actors[1] = clone(frame.actors[0]); }, frame => { frame.actors[1].objectId = plan.scene.objectId; },
      frame => { frame.actors[1].position[0] = Infinity; }, frame => { frame.actors[1].position = [10]; },
      frame => { frame.actors[1].state = 'running'; }, frame => { frame.actors[1].sourcePath = '/etc/passwd'; },
      frame => { frame.actors[0].instanceId = plan.schemaVersion === 1 ? plans[1].actors[0].instanceId : plan.scene.objectId; },
      frame => { frame.protocol = 4; }, frame => { frame.tool = '/unsafe'; },
    ];
    if (plan.schemaVersion !== 1) mutations.push(frame => { delete frame.actors[0].instanceId; });
    for (const mutate of mutations) {
      const observer = observation(plan), waiting = observer.snapshot(), first = ready(plan); mutate(first);
      assert.equal(observer.push(first), false); assert.deepEqual(observer.snapshot(), waiting);
      observer.push(ready(plan)); const before = observer.snapshot(), last = finished(plan); mutate(last);
      assert.equal(observer.push(last), false); assert.deepEqual(observer.snapshot(), before);
    }
    const observer = observation(plan), waiting = observer.snapshot();
    for (const frame of [finished(plan), state(plan), { ...ready(plan), sceneObjectId: plans[1].actors[0].objectId }]) {
      assert.equal(observer.push(frame), false); assert.deepEqual(observer.snapshot(), waiting);
    }
    observer.push(ready(plan)); const before = observer.snapshot();
    for (const frame of [ready(plan), { ...finished(plan), fixedDelta: 0 }, { ...finished(plan), fixedDelta: -0.1 },
      { ...finished(plan), fixedDelta: NaN }, { ...state(plan), objectId: plan.scene.objectId },
      { ...state(plan), sourcePath: 'documents/another.md' }, { ...state(plan), state: null }]) {
      assert.equal(observer.push(frame), false); assert.deepEqual(observer.snapshot(), before);
    }
  }
});

test('queries distinguish an instance from repeated definitions and combine both identities without engine handles', () => {
  const plan = plans[1], observer = observation(plan); observer.push(ready(plan)); const view = observer.snapshot();
  assert.equal(new Set(plan.actors.map(actor => actor.objectId)).size, 1);
  const all = querySceneRuntimeObservation(view, { objectId: plan.actors[0].objectId }); assert.equal(all.actors.length, 2);
  const one = querySceneRuntimeObservation(view, { instanceId: plan.actors[1].instanceId });
  assert.deepEqual(one.actors, [view.actors[1]]); assert.equal(one.phase, view.phase); assert.equal(one.sequence, view.sequence);
  assert.deepEqual(querySceneRuntimeObservation(view, { instanceId: plan.actors[1].instanceId, objectId: plan.actors[1].objectId }), one);
  assert.deepEqual(querySceneRuntimeObservation(view, { instanceId: plan.actors[1].instanceId, objectId: plan.scene.objectId }).actors, []);
  assert.deepEqual(querySceneRuntimeObservation(view, { objectId: plan.scene.objectId }).actors, []);
  assert.deepEqual(querySceneRuntimeObservation(view, { instanceId: plan.scene.objectId }).actors, []);
  assert.deepEqual(querySceneRuntimeObservation(querySceneRuntimeObservation(view, { objectId: plan.scene.objectId })).actors, []);
  const old = observation(plans[0]); old.push(ready(plans[0]));
  assert.equal(querySceneRuntimeObservation(old.snapshot(), { objectId: plans[0].actors[0].objectId }).actors.length, 1);
  assert.deepEqual(querySceneRuntimeObservation(old.snapshot(), { instanceId: plan.actors[0].instanceId }).actors, []);
});

test('observers detach plans, event arrays and snapshots; query output never shares mutable source or position data', () => {
  const plan = clone(plans[1]), expectedSource = { ...clone(plan.actors[0].declaration), sourceRevision: plan.scene.sourceRevision }, expectedName = plan.actors[0].name;
  const observer = observation(plan), frame = ready(plan), expectedPosition = [...frame.actors[0].position];
  plan.actors[0].declaration.sourcePath = 'documents/changed.json'; plan.actors[0].name = 'changed';
  observer.push(frame); frame.actors[0].position[0] = 999; frame.actors[0].objectId = plan.scene.objectId;
  const snapshot = observer.snapshot(); assert.deepEqual(snapshot.actors[0].position, expectedPosition);
  assert.deepEqual(snapshot.actors[0].source, expectedSource); assert.equal(snapshot.actors[0].name, expectedName);
  const query = querySceneRuntimeObservation(snapshot); query.actors[0].source.sourcePath = 'documents/other.json';
  query.actors[0].position[0] = -999; query.actors.pop();
  assert.deepEqual(observer.snapshot(), snapshot);
  snapshot.actors[0].source.propertyPath = '/changed'; snapshot.actors[0].position[0] = -1000;
  assert.deepEqual(observer.snapshot().actors[0].source, expectedSource);
  assert.deepEqual(observer.snapshot().actors[0].position, expectedPosition);
});

test('source fallbacks and composition contributor ranges retain only typed frozen author navigation', () => {
  const plan = clone(plans[1]);
  plan.actors[0].declaration = { ...plan.actors[0].declaration, sourceRevision: `sha256:${'a'.repeat(64)}`,
    sourceRange: { start: 20, end: 50, encoding: 'utf-16', propertyPath: '/actors', exact: false },
    contributors: [{ ...plan.actors[0].declaration, role: 'identity', sourceRevision: plan.scene.sourceRevision }] };
  const view = observation(plan).snapshot(); assert.deepEqual(view.actors[0].source, plan.actors[0].declaration);
  assert.deepEqual(querySceneRuntimeObservation(view).actors[0].source, plan.actors[0].declaration);
  delete plan.actors[0].declaration; assert.deepEqual(observation(plan).snapshot().actors[0].source,
    { ...plan.actors[0].fieldSources.position, sourceRevision: plan.scene.sourceRevision });
  delete plan.actors[0].fieldSources; assert.deepEqual(observation(plan).snapshot().actors[0].source,
    { objectId: plan.actors[0].objectId, sourcePath: plan.actors[0].sourcePath, propertyPath: '', sourceRevision: plan.actors[0].sourceRevision });
});

test('actual world projection and scene planning retain existing relative colon paths and long multiline author titles', async () => {
  const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v2.json', import.meta.url), 'utf8'));
  const source = clone(golden.observed.source), sceneId = golden.plan.scene.objectId, objectId = golden.plan.actors[0].objectId;
  source.workspace.version = 2; source.definition = { documentTypes: [{ id: 'document', label: 'Document' }] };
  const digest = value => createHash('sha256').update(value).digest('hex');
  const actorDocument = source.documents.find(document => document.record.id === objectId);
  const name = '多行\n角色'.repeat(14000);
  actorDocument.sourcePath = 'documents/oc:a.json'; actorDocument.record.sourcePath = actorDocument.sourcePath;
  actorDocument.record.relations = []; actorDocument.record.assetBindings = [];
  actorDocument.content = JSON.stringify({ name }); actorDocument.sourceRevision = `sha256:${digest(actorDocument.content)}`;
  const sceneDocument = source.documents.find(document => document.record.id === sceneId);
  const scene = JSON.parse(sceneDocument.content.replace(/^\uFEFF/, ''));
  scene.actors = golden.plan.actors.map(actor => ({ instanceId: actor.instanceId, objectId, position: actor.position,
    size: [32, 48], color: '#80d0a0', speed: 160, controls: 'arrows' }));
  sceneDocument.sourcePath = 'documents/scenes/demo:a.json'; sceneDocument.record.sourcePath = sceneDocument.sourcePath;
  sceneDocument.content = JSON.stringify(scene); sceneDocument.sourceRevision = `sha256:${digest(sceneDocument.content)}`;
  for (const document of source.documents) document.descriptor = { ...document.record, documentType: 'document',
    ...(document === actorDocument ? { parserOptions: { titleField: 'name' } } : {}) };
  const projection = await createWorldProjection(source, { digest });
  const captured = createScene2DPlan({ source, projection }, sceneId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.equal(captured.plan.actors[0].name, name); assert.equal(captured.plan.actors[0].sourcePath, 'documents/oc:a.json');
  const before = clone(captured.plan), observer = observation(captured.plan);
  assert.equal(observer.snapshot().actors[0].name, name.slice(0, 4096));
  assert.equal(observer.snapshot().actors[0].source.sourcePath, 'documents/scenes/demo:a.json');
  assert.equal(observer.snapshot().actors[0].source.sourceRevision, sceneDocument.sourceRevision);
  observer.push(ready(captured.plan)); observer.push(finished(captured.plan));
  assert.equal(querySceneRuntimeObservation(observer.snapshot()).phase, 'finished');
  assert.deepEqual(captured.plan, before);
  for (const path of ['documents/a:b.md', 'documents/line\nbreak.md', 'documents/./name.md']) {
    const plan = clone(plans[1]); plan.actors[0].declaration.sourcePath = path;
    assert.equal(querySceneRuntimeObservation(observation(plan).snapshot()).actors[0].source.sourcePath, path);
  }
});

test('derived author sources gain only matching frozen scene or actor revisions and never overwrite existing provenance', () => {
  const plan = clone(plans[1]), before = clone(plan), source = observation(plan).snapshot().actors[0].source;
  assert.equal(Object.hasOwn(plan.actors[0].declaration, 'sourceRevision'), false);
  assert.equal(source.sourceRevision, plan.scene.sourceRevision); assert.deepEqual(plan, before);
  const existing = `sha256:${'d'.repeat(64)}`; plan.actors[0].declaration.sourceRevision = existing;
  assert.equal(observation(plan).snapshot().actors[0].source.sourceRevision, existing);
  plan.actors[0].declaration = { objectId: plan.actors[0].objectId, sourcePath: plan.actors[0].sourcePath, propertyPath: '' };
  assert.equal(observation(plan).snapshot().actors[0].source.sourceRevision, plan.actors[0].sourceRevision);
  plan.actors[0].declaration.sourcePath = 'documents/different.json';
  assert.equal(Object.hasOwn(observation(plan).snapshot().actors[0].source, 'sourceRevision'), false);
  const view = observation().snapshot(); view.actors[0].source.sourceRevision = 'sha256:wrong';
  assert.throws(() => querySceneRuntimeObservation(view), TypeError);
});

test('construction refuses incompatible plans, duplicate identity, unsafe navigation and non-data inputs without invoking accessors', () => {
  const mutations = [
    plan => { plan.format = 'unknown'; }, plan => { plan.kind = 'other'; }, plan => { plan.schemaVersion = 4; },
    plan => { plan.scene.objectId = 'entity:1'; }, plan => { plan.actors = []; }, plan => { plan.actors[0].objectId = 'bad'; },
    plan => { delete plan.actors[0].instanceId; }, plan => { plan.actors[1].instanceId = plan.actors[0].instanceId; },
    plan => { plan.actors[0].declaration.sourcePath = '/etc/passwd'; }, plan => { plan.actors[0].declaration.propertyPath = 'not-pointer'; },
    plan => { plan.actors[0].declaration.sourcePath = '../other'; }, plan => { plan.actors[0].declaration.executable = 'evil'; },
    plan => { plan.actors[0].declaration.sourceRange = { start: 50, end: 20, encoding: 'utf-16' }; },
    plan => { plan.actors[0].name = {}; }, plan => { plan.actors = Array(2); },
  ];
  for (const mutate of mutations) { const plan = clone(plans[1]); mutate(plan); assert.throws(() => observation(plan), TypeError); }
  const old = clone(plans[0]); old.actors[1].objectId = old.actors[0].objectId; assert.throws(() => observation(old), TypeError);
  let invoked = 0; const getter = clone(plans[1]);
  Object.defineProperty(getter.actors[0], 'name', { enumerable: true, get() { invoked++; return 'unexpected'; } });
  assert.throws(() => observation(getter), TypeError); assert.equal(invoked, 0);
  for (const value of [null, [], Object.create(plans[1]), JSON.parse('{"__proto__":{}}')]) assert.throws(() => observation(value), TypeError);
  const cycle = clone(plans[1]); cycle.actors[0].declaration.self = cycle.actors[0].declaration; assert.throws(() => observation(cycle), TypeError);
});

test('queries strictly reject extra fields, malformed UUIDs and accessor or prototype requests', () => {
  const view = observation().snapshot();
  for (const request of [null, [], { objectId: '' }, { instanceId: '1' }, { entity: 10 }, { sourcePath: '/etc/passwd' },
    { instanceId: undefined }, { objectId: null }, { objectId: plans[1].actors[0].objectId, backendId: 'org.viento.bevy' },
    JSON.parse('{"__proto__":{}}'), Object.create({ objectId: plans[1].actors[0].objectId })]) {
    assert.throws(() => querySceneRuntimeObservation(view, request), TypeError);
  }
  let invoked = 0; const request = {};
  Object.defineProperty(request, 'instanceId', { enumerable: true, get() { invoked++; return plans[1].actors[0].instanceId; } });
  assert.throws(() => querySceneRuntimeObservation(view, request), TypeError); assert.equal(invoked, 0);
});

test('queries reject fabricated unsafe DTOs and inconsistent phase or coordinate freshness', () => {
  const observer = observation(); observer.push(ready(plans[1])); const baseline = observer.snapshot();
  const mutations = [
    view => { view.format = 'unknown'; }, view => { view.protocolVersion = 4; }, view => { view.sequence = -1; },
    view => { view.phase = 'waiting'; }, view => { view.sequence = 0; }, view => { view.extra = 'field'; },
    view => { view.actors[1].instanceId = view.actors[0].instanceId; }, view => { view.actors[0].position[1] = NaN; },
    view => { view.actors[0].positionSample = 'finished'; }, view => { view.actors[0].positionCurrent = false; },
    view => { view.actors[0].entity = 1; }, view => { view.actors[0].source.sourcePath = '/javascript:alert(1)'; },
    view => { view.actors[0].source.sourcePath = 'documents/../../private'; },
    view => { view.actors[0].source.sourcePath = 'C:\\private'; },
    view => { view.actors[0].source.sourceRange = { start: -1, end: 8, encoding: 'utf-16' }; },
    view => { view.actors[0].source.sourceRevision = 'bad'; }, view => { view.actors[0].source.propertyPath = '/bad~2pointer'; },
    view => { view.actors[0].source.contributors = [{ ...view.actors[0].source, sourcePath: '../escape', role: 'identity' }]; },
  ];
  for (const mutate of mutations) { const value = clone(baseline); mutate(value); assert.throws(() => querySceneRuntimeObservation(value), TypeError); }
  observer.push(finished(plans[1])); const final = observer.snapshot(); final.actors[0].positionCurrent = false;
  assert.throws(() => querySceneRuntimeObservation(final), TypeError);
  const waiting = observation().snapshot(); waiting.actors[0].position = [1, 2];
  assert.throws(() => querySceneRuntimeObservation(waiting), TypeError);
});

test('invalid event accessors, hidden fields, sparse collections and cycles do not execute or change the observation', () => {
  const observer = observation(), before = observer.snapshot(); let invoked = 0;
  const getter = ready(plans[1]); Object.defineProperty(getter, 'sceneObjectId', { enumerable: true, get() { invoked++; return plans[1].scene.objectId; } });
  assert.equal(observer.push(getter), false); assert.equal(invoked, 0);
  const hidden = ready(plans[1]); Object.defineProperty(hidden, 'hidden', { value: true });
  const sparse = ready(plans[1]); delete sparse.actors[0];
  const cycle = ready(plans[1]); cycle.self = cycle;
  const symbol = ready(plans[1]); symbol[Symbol('hidden')] = true;
  for (const value of [hidden, sparse, cycle, symbol, null, [], Object.create(ready(plans[1]))]) {
    assert.equal(observer.push(value), false); assert.deepEqual(observer.snapshot(), before);
  }
});

test('the observation and query layer links only its portable control module in an isolated context without Node or DOM', async () => {
  const source = await fs.readFile(new URL('../../engine/scene-runtime-query.mjs', import.meta.url), 'utf8');
  const controlSource = await fs.readFile(new URL('../../engine/scene-control-program.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(controlSource, /^import\s/m);
  assert.equal(source.match(/^import\s/gm)?.length, 1);
  assert.match(source, /from '\.\/scene-control-program\.mjs'/);
  const context = vm.createContext({});
  vm.runInContext(`globalThis.controlApi = (() => { ${controlSource.replaceAll('export ', '')}
    return { validateSceneControlPlan, SCENE_CONTROL_TRACE_FORMAT }; })();`, context);
  vm.runInContext(source.replace(/^import .*$/m, 'const { validateSceneControlPlan, SCENE_CONTROL_TRACE_FORMAT } = globalThis.controlApi;')
    .replaceAll('export ', '') + '\nglobalThis.observationApi = createSceneRuntimeObservation; globalThis.queryApi = querySceneRuntimeObservation;', context);
  assert.equal(vm.runInContext('typeof process+":"+typeof Buffer+":"+typeof document+":"+typeof window+":"+typeof require', context), 'undefined:undefined:undefined:undefined:undefined');
  const value = vm.runInContext(`(() => { const observer = observationApi(${JSON.stringify(plans[1])}); observer.push(${JSON.stringify(ready(plans[1]))});
    observer.push(${JSON.stringify(state(plans[1]))}); return JSON.stringify(queryApi(observer.snapshot(), {instanceId:${JSON.stringify(plans[1].actors[0].instanceId)}})); })()`, context);
  const parsed = JSON.parse(value); assert.equal(parsed.actors.length, 1); assert.equal(parsed.actors[0].state, 'moving');
  assert.equal(parsed.actors[0].positionCurrent, false); assert.equal(parsed.sequence, 2);
});
