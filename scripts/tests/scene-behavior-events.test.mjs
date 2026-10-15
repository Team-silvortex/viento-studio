import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createSceneBehaviorEventReader } from '../../engine/scene-behavior-events.mjs';
import { createSceneRuntimeEventReader } from '../../engine/scene-runtime-events.mjs';
import { inspectSceneBehaviors, SCENE_BEHAVIOR_LIMITS } from '../../engine/scene-behaviors.mjs';
import { createBehaviorRuntimeEventReader } from '../backends/godot4-behaviors.mjs';

const id = number => `${number.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const hash = text => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const frame = value => `VIENTO_RUNTIME:${JSON.stringify(value)}\n`;
function plan(backendId = 'org.viento.bevy-rust', language = 'rust') {
  const scene = { objectId: id(1), sourcePath: 'documents/scene.json', sourceRevision: hash('{}') };
  const manifest = { objectId: id(2), sourcePath: 'documents/behaviors.json', sourceRevision: hash('{}') };
  const content = language === 'rust' ? 'pub fn ready() {}\n' : 'extends Node\n';
  const actors = [0, 1].map(index => ({ objectId: id(3), instanceId: id(4 + index), position: [index * 10, 0],
    sourcePath: 'documents/actor.md', sourceRevision: hash('# actor'), declaration: { ...scene, propertyPath: `/actors/${index}` } }));
  return { format: 'viento-build-plan', schemaVersion: 3, kind: 'scene2d', scene, actors, resources: [],
    behaviors: { format: 'viento-behavior-plan', schemaVersion: 1, backendId, language, manifest,
      sources: [{ objectId: id(6), sourcePath: 'documents/first.txt', sourceRevision: hash(content), language, content },
        { objectId: id(7), sourcePath: 'documents/second.txt', sourceRevision: hash(content), language, content }],
      bindings: [0, 1, 2].map(index => ({ bindingId: id(10 + index), objectId: id(3), instanceId: actors[index === 1 ? 1 : 0].instanceId,
        implementation: { backendId, language, sourceObjectId: id(index === 2 ? 7 : 6) }, parameters: { amount: 35, checkpoint: '中日🦊', enabled: true },
        events: [{ signal: 'arrived', event: `checkpoint_${index}` }], declaration: { ...manifest, propertyPath: `/bindings/${index}` } })) } };
}
const states = value => value.actors.map(actor => ({ instanceId: actor.instanceId, objectId: actor.objectId, position: actor.position, state: 'idle' }));
const ready = value => ({ protocol: 3, event: 'ready', sceneObjectId: value.scene.objectId, actors: states(value) });
const finished = value => ({ protocol: 3, event: 'finished', actors: states(value), fixedDelta: 0.25 });
const behavior = (value, index = 0) => { const binding = value.behaviors.bindings[index]; return { protocol: 3, event: 'behavior',
  bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId, name: binding.events[0].event, arguments: ['中日🦊', 35, true] }; };
const diagnostic = (value, index = 0) => { const binding = value.behaviors.bindings[index]; return { protocol: 3, event: 'diagnostic',
  bindingId: binding.bindingId, instanceId: binding.instanceId, objectId: binding.objectId,
  severity: 'error', code: 'runtime_behavior_parameter', message: 'Wrong parameter type.', parameter: 'amount' }; };

test('neutral protocol 3 accepts identical paired events for Rust and GDScript, including several bindings on one instance', () => {
  for (const [backend, language] of [['org.viento.bevy-rust', 'rust'], ['org.viento.godot4', 'gdscript'], ['org.future.runtime', 'custom']]) {
    const value = plan(backend, language), events = [ready(value), ...[0, 1, 2].map(index => behavior(value, index)), finished(value)];
    const received = [], reader = createSceneBehaviorEventReader(value, { onEvent: event => received.push(event) });
    reader.push(events.map(frame).join('')); reader.finish();
    assert.deepEqual(reader.events, events); assert.deepEqual(received, events); assert.deepEqual(reader.diagnostics, []);
  }
});

test('Godot compatibility export keeps the same event and source diagnostics as neutral admission', () => {
  const value = plan('org.viento.godot4', 'gdscript'), neutral = createSceneBehaviorEventReader(value), compatibility = createBehaviorRuntimeEventReader(value);
  const stream = [ready(value), behavior(value), diagnostic(value, 2), finished(value)].map(frame).join('');
  neutral.push(stream); compatibility.push(stream);
  assert.deepEqual(neutral.finish(), compatibility.finish());
  assert.throws(() => createBehaviorRuntimeEventReader(plan()), { errorCode: 'build_behavior_invalid' });
});

test('input mutations cannot rewrite binding authority or diagnostic navigation after capture', () => {
  const value = plan(), original = structuredClone(value), reader = createSceneBehaviorEventReader(value);
  value.behaviors.bindings[0].events[0].event = 'changed'; value.behaviors.manifest.sourcePath = 'documents/changed.json';
  value.behaviors.bindings[0].declaration.sourcePath = 'documents/changed.json';
  reader.push([ready(original), behavior(original), diagnostic(original)].map(frame).join('')); reader.finish();
  assert.equal(reader.events.length, 3); assert.equal(reader.diagnostics[0].sourcePath, original.behaviors.manifest.sourcePath);
  assert.equal(reader.diagnostics[0].sourceRevision, original.behaviors.manifest.sourceRevision);
  assert.equal(reader.diagnostics[0].propertyPath, '/bindings/0/parameters/amount');
});

test('shared author schema rejects mixed implementations, duplicate IDs, reserved parameters and invalid scalar/event definitions', () => {
  const mutations = [value => { value.behaviors.bindings[0].implementation.backendId = 'org.other.engine'; },
    value => { value.behaviors.bindings[0].implementation.language = 'gdscript'; },
    value => { value.behaviors.bindings[1].bindingId = value.behaviors.bindings[0].bindingId; },
    value => { value.behaviors.bindings[0].parameters.constructor = 1; },
    value => { value.behaviors.bindings[0].parameters.amount = null; },
    value => { value.behaviors.bindings[0].parameters.amount = Number.MAX_SAFE_INTEGER + 1; },
    value => { value.behaviors.bindings[0].events.push({ signal: 'arrived', event: 'other' }); }];
  for (const mutate of mutations) { const value = plan(); mutate(value); assert.throws(() => createSceneBehaviorEventReader(value), TypeError); }
});

test('plan admission verifies paired instances, source inventory and frozen binding declaration locations', () => {
  const mutations = [value => { value.schemaVersion = 2; }, value => { value.kind = 'scene3d'; },
    value => { value.actors[1].instanceId = value.actors[0].instanceId; },
    value => { value.behaviors.bindings[0].objectId = id(999); },
    value => { value.behaviors.bindings[0].instanceId = id(999); delete value.behaviors.bindings[0].objectId; },
    value => { value.behaviors.sources.pop(); }, value => { value.behaviors.sources[1].sourceRevision = 'untrusted'; },
    value => { value.behaviors.sources[1].sourcePath = '../outside.txt'; },
    value => { value.behaviors.sources[1].sourcePath = 'C:/outside.txt'; },
    value => { value.behaviors.sources[1].content = 'x'.repeat(65537); },
    value => { value.behaviors.bindings[1].declaration.propertyPath = '/bindings/0'; },
    value => { value.behaviors.bindings[1].declaration.sourcePath = 'documents/other.json'; },
    value => { value.behaviors.bindings[1].declaration.code = 'forged'; },
    value => { value.behaviors.bindings[2].implementation.sourceObjectId = id(6); }];
  for (const mutate of mutations) { const value = plan(); mutate(value); assert.throws(() => createSceneBehaviorEventReader(value), TypeError); }
});

test('caller accessors, inherited serializers and sparse plans are refused without executing them', () => {
  let called = 0;
  const value = plan(); Object.defineProperty(value.behaviors.bindings[0], 'parameters', { enumerable: true, get() { called++; return {}; } });
  assert.throws(() => createSceneBehaviorEventReader(value), TypeError); assert.equal(called, 0);
  const inherited = Object.assign(Object.create({ toJSON() { called++; return plan(); } }), plan());
  assert.throws(() => createSceneBehaviorEventReader(inherited), TypeError); assert.equal(called, 0);
  const sparse = plan(); delete sparse.behaviors.sources[0]; assert.throws(() => createSceneBehaviorEventReader(sparse), TypeError);
});

test('binding frames cannot forge identity, event names, arguments or author paths', () => {
  const value = plan(), valid = behavior(value);
  for (const malformed of [{ ...valid, bindingId: id(99) }, { ...valid, instanceId: id(99) }, { ...valid, objectId: id(99) },
    { ...valid, name: 'not_declared' }, { ...valid, protocol: 2 }, { ...valid, arguments: [null] }, { ...valid, arguments: [1, 2, 3, 4, 5] },
    { ...valid, arguments: [{ value: 1 }] }, { ...valid, arguments: ['x'.repeat(4097)] }, { ...valid, arguments: ['\ud800'] },
    { ...valid, sourcePath: '/outside' }, { ...valid, sourceRevision: hash('forged') }]) {
    const reader = createSceneBehaviorEventReader(value); reader.push(frame(ready(value))); reader.push(frame(malformed)); reader.finish();
    assert.equal(reader.events.length, 1); assert.deepEqual(reader.diagnostics.map(item => item.code), ['runtime_protocol_invalid']);
  }
});

test('zero through four scalar event arguments keep type and order', () => {
  const value = plan(), reader = createSceneBehaviorEventReader(value), argumentsList = [[], [true], [false, 0], ['中日', -12.5, true], ['text', 0, false, 1.5]];
  reader.push(frame(ready(value)));
  for (const argumentsValue of argumentsList) reader.push(frame({ ...behavior(value), arguments: argumentsValue }));
  assert.deepEqual(reader.events.slice(1).map(event => event.arguments), argumentsList); assert.deepEqual(reader.diagnostics, []);
});

test('diagnostics resolve only a declared binding parameter and never accept output-owned source navigation', () => {
  const value = plan(), valid = diagnostic(value, 2);
  for (const malformed of [{ ...valid, parameter: 'absent' }, { ...valid, parameter: ['amount'] }, { ...valid, code: 'some_error' },
    { ...valid, severity: 'warning' }, { ...valid, message: '' }, { ...valid, sourcePath: '/outside' }, { ...valid, objectId: id(99) }]) {
    const reader = createSceneBehaviorEventReader(value); reader.push(frame(malformed)); reader.finish();
    assert.equal(reader.events.length, 0); assert.deepEqual(reader.diagnostics.map(item => item.code), ['runtime_protocol_invalid']);
  }
  const reader = createSceneBehaviorEventReader(value); reader.push(frame(valid)); reader.finish();
  assert.equal(reader.diagnostics[0].bindingId, value.behaviors.bindings[2].bindingId);
  assert.equal(reader.diagnostics[0].relatedObjectId, value.actors[0].objectId);
  assert.equal(reader.diagnostics[0].propertyPath, '/bindings/2/parameters/amount');
});

test('lifecycle admission rejects behavior before ready, duplicate ready and all frames after finished', () => {
  const value = plan(), reader = createSceneBehaviorEventReader(value);
  reader.push([behavior(value), ready(value), ready(value), finished(value), behavior(value), diagnostic(value)].map(frame).join(''));
  assert.deepEqual(reader.events.map(item => item.event), ['ready', 'finished']); assert.equal(reader.diagnostics.length, 4);
});

test('stream fragmentation, CRLF and unfinished final frames keep event order and finish is idempotent', () => {
  const value = plan(), reader = createSceneBehaviorEventReader(value), stream = [ready(value), behavior(value), finished(value)].map(frame).join('').replaceAll('\n', '\r\n').trimEnd();
  for (let index = 0; index < stream.length; index += 7) reader.push(stream.slice(index, index + 7));
  reader.finish(); const before = structuredClone(reader.events); reader.finish(); reader.push(frame(behavior(value)));
  assert.deepEqual(reader.events, before); assert.deepEqual(reader.events.map(item => item.event), ['ready', 'behavior', 'finished']);
  assert.deepEqual(reader.diagnostics, []);
});

test('event floods and oversized lines remain bounded while ordinary logs cannot inject events', () => {
  const value = plan(), reader = createSceneBehaviorEventReader(value);
  reader.push('log ' + frame(behavior(value))); reader.push('VIENTO_RUNTIME:' + 'x'.repeat(65536) + '\n'); reader.push(frame(ready(value)));
  for (let index = 0; index < 4100; index++) reader.push(frame(behavior(value)));
  reader.finish(); assert.equal(reader.events.length, 4096); assert.equal(reader.diagnostics.length, 2);
  const invalid = createSceneBehaviorEventReader(value); invalid.push('VIENTO_RUNTIME:bad\n'.repeat(200)); assert.equal(invalid.diagnostics.length, 128);
});

test('portable behavior reader runs without Node, DOM or an engine runtime', async () => {
  const source = await fs.readFile(new URL('../../engine/scene-behavior-events.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /node:|godot4|\b(?:window|document|process|Buffer)\./);
  const context = vm.createContext({ inspectSceneBehaviors, SCENE_BEHAVIOR_LIMITS, createSceneRuntimeEventReader, TextEncoder });
  vm.runInContext(source.replace(/^import .*;\n/gm, '').replaceAll('export ', '') + '\nglobalThis.createReader = createSceneBehaviorEventReader;', context);
  context.planJson = JSON.stringify(plan());
  const reader = vm.runInContext('createReader(JSON.parse(planJson))', context);
  reader.push([ready(plan()), behavior(plan()), finished(plan())].map(frame).join('')); reader.finish();
  assert.deepEqual(Array.from(reader.events, event => event.event), ['ready', 'behavior', 'finished']); assert.equal(reader.diagnostics.length, 0);
});
