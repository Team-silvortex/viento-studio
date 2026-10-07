import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createSceneRuntimeEventReader } from '../../engine/scene-runtime-events.mjs';
import { createRuntimeEventReader as legacyReader } from '../backends/godot4-dispatch.mjs';

const fixtures = await Promise.all([1, 2].map(version => fs.readFile(new URL(`./fixtures/scene-model/legacy-plan-v${version}.json`, import.meta.url), 'utf8').then(JSON.parse)));
const frame = value => `VIENTO_RUNTIME:${JSON.stringify(value)}\n`;
const states = plan => plan.actors.map(actor => ({ ...(actor.instanceId ? { instanceId: actor.instanceId } : {}),
  objectId: actor.objectId, position: actor.position, state: 'idle' }));
const ready = plan => ({ protocol: plan.schemaVersion, event: 'ready', sceneObjectId: plan.scene.objectId, actors: states(plan) });

test('neutral protocol admission preserves old v1/v2 accepted frames and trusted diagnostic navigation', () => {
  for (const { plan } of fixtures) {
    const actor = plan.actors[0], protocol = plan.schemaVersion;
    const frames = [ready(plan), { protocol, event: 'state', ...(actor.instanceId ? { instanceId: actor.instanceId } : {}), objectId: actor.objectId, state: 'moving' },
      { protocol, event: 'diagnostic', severity: 'error', code: 'runtime_resource_invalid', message: 'Image cannot be loaded.',
        ...(actor.instanceId ? { instanceId: actor.instanceId } : {}), objectId: actor.objectId, resourceId: actor.imageResourceId },
      { protocol, event: 'finished', actors: states(plan), fixedDelta: 0.25 }];
    const readers = [createSceneRuntimeEventReader(plan), legacyReader(plan)];
    for (const reader of readers) reader.push(frames.map(frame).join(''));
    assert.deepEqual(readers[0].finish(), readers[1].finish());
    assert.equal(readers[0].events.length, 4); assert.equal(readers[0].diagnostics.length, 1);
  }
});

test('protocol v2 accepts two instances of one definition and refuses missing, repeated and mismatched identities', () => {
  const plan = fixtures[1].plan;
  assert.equal(new Set(plan.actors.map(actor => actor.objectId)).size, 1);
  const good = createSceneRuntimeEventReader(plan); good.push(frame(ready(plan))); assert.equal(good.events.length, 1);
  for (const change of [
    value => { delete value.actors[0].instanceId; },
    value => { value.actors[1].instanceId = value.actors[0].instanceId; },
    value => { value.actors[0].objectId = plan.scene.objectId; },
    value => { value.actors.pop(); },
  ]) {
    const value = structuredClone(ready(plan)); change(value);
    const reader = createSceneRuntimeEventReader(plan); reader.push(frame(value));
    assert.equal(reader.events.length, 0); assert.equal(reader.diagnostics[0].code, 'runtime_protocol_invalid');
  }
});

test('engine output cannot redirect source links, pretend to provide a behavior frame or advance invalid lifecycles', () => {
  const plan = fixtures[1].plan, actor = plan.actors[0], protocol = 2;
  const invalid = [
    { protocol, event: 'state', instanceId: actor.instanceId, objectId: actor.objectId, state: 'moving' },
    { protocol, event: 'behavior', bindingId: actor.instanceId, name: 'checkpoint', arguments: [] },
    { protocol, event: 'diagnostic', severity: 'error', code: 'fake', message: 'Redirect', sourcePath: '/etc/passwd' },
  ];
  const reader = createSceneRuntimeEventReader(plan); reader.push(invalid.map(frame).join(''));
  reader.push(frame(ready(plan))); reader.push(frame(ready(plan)));
  reader.push(frame({ protocol, event: 'finished', actors: states(plan), fixedDelta: 0.25 }));
  reader.push(frame(ready(plan))); reader.finish();
  assert.deepEqual(reader.events.map(item => item.event), ['ready', 'finished']);
  assert.equal(reader.diagnostics.length, 5); assert.ok(reader.diagnostics.every(item => item.sourcePath === plan.scene.sourcePath));
});

test('stream fragmentation, CRLF and an unfinished final frame are handled without ordinary-log event injection', () => {
  const plan = fixtures[1].plan, observed = [], reader = createSceneRuntimeEventReader(plan, { onEvent: item => observed.push(item) });
  const text = 'engine startup\r\n' + frame(ready(plan)).replace(/\n$/, '\r\n')
    + frame({ protocol: 2, event: 'finished', actors: states(plan), fixedDelta: 0.25 }).trimEnd();
  for (let offset = 0; offset < text.length; offset += 7) reader.push(text.slice(offset, offset + 7));
  reader.finish(); reader.finish(); assert.deepEqual(reader.events.map(item => item.event), ['ready', 'finished']);
  assert.deepEqual(observed, reader.events); assert.deepEqual(reader.push(frame(ready(plan))), []);
});

test('unbounded protocol lines and event floods are rejected with bounded diagnostics', () => {
  const plan = fixtures[1].plan, reader = createSceneRuntimeEventReader(plan);
  reader.push('ordinary '.repeat(10000) + '\n'); assert.equal(reader.diagnostics.length, 0);
  reader.push('VIENTO_RUNTIME:' + 'x'.repeat(100000) + '\n'); assert.equal(reader.diagnostics.length, 1);
  reader.push(frame(ready(plan)));
  const actor = plan.actors[0], event = frame({ protocol: 2, event: 'state', instanceId: actor.instanceId, objectId: actor.objectId, state: 'idle' });
  reader.push(event.repeat(4100)); reader.finish(); assert.equal(reader.events.length, 4096); assert.equal(reader.diagnostics.length, 2);
});

test('portable event middleware runs without Node, DOM, imports or filesystem globals', async () => {
  const source = await fs.readFile(new URL('../../engine/scene-runtime-events.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import\s/m);
  const context = vm.createContext({});
  vm.runInContext(source.replaceAll('export ', '') + '\nglobalThis.readerApi = createSceneRuntimeEventReader;', context);
  assert.equal(vm.runInContext('typeof process+":"+typeof Buffer+":"+typeof document+":"+typeof window+":"+typeof require', context), 'undefined:undefined:undefined:undefined:undefined');
  const result = vm.runInContext(`(() => { const plan = ${JSON.stringify(fixtures[1].plan)}; const reader = readerApi(plan);
    reader.push(${JSON.stringify(frame(ready(fixtures[1].plan)))}); return JSON.stringify(reader.finish()); })()`, context);
  const value = JSON.parse(result); assert.equal(value.events[0].event, 'ready'); assert.deepEqual(value.diagnostics, []);
});
