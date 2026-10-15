import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { PROJECT_RUNTIME_MAX_VISITS, PROJECT_RUNTIME_MAX_EVENTS, PROJECT_RUNTIME_MAX_LINE } from '../../engine/project-runtime-contracts.mjs';
import { runtimeProject, runtimeId, actorStates, projectReady, enterScene, sceneFrame, readyScene, exitScene, finishProject, projectLine, returnTrip } from './helpers/project-runtime-fixture.mjs';
const clone = value => structuredClone(value);
const push = (reader, frames) => reader.push(frames.map(projectLine).join(''));

test('project visits admit A→B→A with fresh child lifecycles and unchanged protocol 1/2/3 wire frames', () => {
  for (const options of [{}, { legacy: true }, { behavior: true }]) {
    const plan = runtimeProject(options), frames = returnTrip(plan), seen = [], reader = createProjectRuntimeEventReader(plan, { onEvent: event => seen.push(event) });
    const wire = frames.map(projectLine).join('');
    for (let offset = 0; offset < wire.length; offset += 17) reader.push(wire.slice(offset, offset + 17));
    assert.deepEqual(reader.finish(), { events: frames, diagnostics: [] }); assert.deepEqual(seen, frames);
    assert.equal(reader.events.filter(event => event.event === 'ready').length, 1);
    assert.equal(reader.events.filter(event => event.event === 'finished').length, 1);
  }
});

test('project membership, exact keys, lifecycle ordering and terminal integrity reject malformed frames atomically', () => {
  const plan = runtimeProject(), [a, b] = plan.scenes;
  const candidates = [
    [[], enterScene(a, 1)], [[], { ...projectReady(plan), entrySceneId: b.scene.objectId }],
    [[projectReady(plan)], enterScene(b, 1)], [[projectReady(plan)], enterScene(a, 0)],
    [[projectReady(plan), enterScene(a, 1)], exitScene(a, 1, 0, b)],
    [[projectReady(plan), enterScene(a, 1), readyScene(a, 1)], { ...exitScene(a, 1, 0, b), nextSceneId: runtimeId(99) }],
    [[projectReady(plan), enterScene(a, 1), readyScene(a, 1)], exitScene(a, 1, 0, a)],
    [[projectReady(plan), enterScene(a, 1), readyScene(a, 1)], { ...exitScene(a, 1, 0, b), sourcePath: '/tmp/foreign' }],
    [[projectReady(plan), enterScene(a, 1), readyScene(a, 1)], { ...exitScene(a, 1, 0, b), actors: [] }],
    [[projectReady(plan), enterScene(a, 1), readyScene(a, 1)], { ...exitScene(a, 1, 0, b), elapsedSeconds: -1 }],
    [[projectReady(plan), enterScene(a, 1), readyScene(a, 1), exitScene(a, 1, 0, b)], enterScene(a, 2)],
    [[projectReady(plan), enterScene(a, 1), readyScene(a, 1), exitScene(a, 1, 0.25)], finishProject(plan, 1, 0.5)],
    [[projectReady(plan), enterScene(a, 1), readyScene(a, 1), exitScene(a, 1, 0.25)], finishProject(plan, 2, 0.25)],
    [returnTrip(plan), enterScene(a, 4)],
  ];
  for (const [prefix, frame] of candidates) {
    const reader = createProjectRuntimeEventReader(plan); push(reader, prefix); const before = reader.events;
    assert.deepEqual(push(reader, [frame]), []); assert.deepEqual(reader.events, before); assert.equal(reader.diagnostics.length, 1, JSON.stringify(frame));
    assert.equal(reader.diagnostics[0].objectId, plan.assembly.objectId); assert.equal(reader.diagnostics[0].sourcePath, plan.assembly.sourcePath);
  }
});

test('late visits, cross-scene actor events, unknown streams and child finished cannot escape project scope', () => {
  const plan = runtimeProject(), [a, b] = plan.scenes;
  for (const frame of [readyScene(a, 1), readyScene(a, 2), { ...readyScene(b, 2), visitIndex: 1 },
    { ...readyScene(b, 2), stream: 'stderr' }, sceneFrame(b, 2, { protocol: 2, event: 'finished', actors: actorStates(b), fixedDelta: 0.25 }),
    sceneFrame(b, 2, { protocol: 2, event: 'state', instanceId: runtimeId(99), objectId: b.actors[0].objectId, state: 'moving' }),
    sceneFrame(b, 2, { protocol: 1, event: 'ready' }, 'audio')]) {
    const reader = createProjectRuntimeEventReader(plan); push(reader, [projectReady(plan), enterScene(a, 1), readyScene(a, 1), exitScene(a, 1, 0, b), enterScene(b, 2), readyScene(b, 2)]);
    const before = reader.events.length; push(reader, [frame]); assert.equal(reader.events.length, before); assert.ok(reader.diagnostics.length);
  }
  const escaped = createProjectRuntimeEventReader(plan); escaped.push('Godot startup\nVIENTO_RUNTIME:{}\nVIENTO_AUDIO:{}\n');
  assert.equal(escaped.events.length, 0); assert.equal(escaped.diagnostics.length, 2);
});

test('behavior events remain scoped to frozen binding author sources, including errors during a later visit', () => {
  const plan = runtimeProject({ behavior: true }), [a, b] = plan.scenes, binding = a.behaviors.bindings[0];
  const behavior = sceneFrame(a, 3, { protocol: 3, event: 'behavior', bindingId: binding.bindingId, instanceId: binding.instanceId,
    objectId: binding.objectId, name: 'checkpoint', arguments: ['第三次', true, 1] });
  const diagnostic = sceneFrame(a, 3, { protocol: 3, event: 'diagnostic', bindingId: binding.bindingId, instanceId: binding.instanceId,
    objectId: binding.objectId, severity: 'error', code: 'runtime_behavior_scene_target', message: 'Unknown project scene.' });
  const reader = createProjectRuntimeEventReader(plan); push(reader, [...returnTrip(plan).slice(0, 9), behavior, diagnostic]);
  assert.equal(reader.events.at(-2).frame.name, 'checkpoint'); assert.equal(reader.diagnostics[0].sourcePath, a.behaviors.manifest.sourcePath);
  assert.equal(reader.diagnostics[0].propertyPath, '/bindings/0'); assert.equal(reader.diagnostics[0].bindingId, binding.bindingId);
  assert.equal(reader.finish().events.at(-1).event, 'scene-event'); assert.equal(reader.events.some(event => event.event === 'finished'), false);
});

test('visit, event, line and diagnostic limits are independent and recovery cannot admit a 65th visit', () => {
  const plan = runtimeProject(), reader = createProjectRuntimeEventReader(plan); push(reader, [projectReady(plan)]);
  for (let index = 1; index <= PROJECT_RUNTIME_MAX_VISITS; index++) {
    const scene = plan.scenes[(index - 1) % 2], next = plan.scenes[index % 2];
    push(reader, [enterScene(scene, index), readyScene(scene, index)]);
    if (index < PROJECT_RUNTIME_MAX_VISITS) push(reader, [exitScene(scene, index, 0, next)]);
    else { assert.deepEqual(push(reader, [exitScene(scene, index, 0, next)]), []); push(reader, [exitScene(scene, index, 0)]); }
  }
  push(reader, [finishProject(plan, 64, 0)]); assert.equal(reader.events.at(-1).event, 'finished'); assert.equal(reader.diagnostics.length, 1);
  const overflow = createProjectRuntimeEventReader(plan); overflow.push('VIENTO_PROJECT:' + 'x'.repeat(PROJECT_RUNTIME_MAX_LINE)); overflow.push('\n' + projectLine(projectReady(plan)));
  assert.equal(overflow.events.length, 1); assert.equal(overflow.diagnostics.length, 1);
  overflow.push(('VIENTO_PROJECT:{}\n').repeat(200)); assert.equal(overflow.diagnostics.length, 128);
  const budget = createProjectRuntimeEventReader(plan), a = plan.scenes[0]; push(budget, [projectReady(plan), enterScene(a, 1), readyScene(a, 1)]);
  const state = sceneFrame(a, 1, { protocol: 2, event: 'state', instanceId: a.actors[0].instanceId, objectId: a.actors[0].objectId, state: 'idle' });
  budget.push(projectLine(state).repeat(PROJECT_RUNTIME_MAX_EVENTS)); assert.equal(budget.events.length, PROJECT_RUNTIME_MAX_EVENTS); assert.equal(budget.diagnostics.length, 1);
});

test('readers detach plans, expose immutable events and do not invent completion on cancellation', () => {
  const plan = runtimeProject(), original = clone(plan), reader = createProjectRuntimeEventReader(plan);
  plan.scenes[0].scene.objectId = runtimeId(99); plan.assembly.sourcePath = 'changed.json';
  push(reader, [projectReady(original), enterScene(original.scenes[0], 1), readyScene(original.scenes[0], 1)]);
  assert.throws(() => { reader.events[2].frame.actors[0].position[0] = 999; }, TypeError);
  const outside = reader.events; outside.length = 0; assert.equal(reader.events.length, 3);
  const result = reader.finish(); assert.equal(result.events.length, 3); assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(reader.push(projectLine(exitScene(original.scenes[0], 1, 0))), []);
  let getters = 0; const hostile = runtimeProject(); Object.defineProperty(hostile, 'scenes', { enumerable: true, get() { getters++; return []; } });
  assert.throws(() => createProjectRuntimeEventReader(hostile)); assert.equal(getters, 0);
});

test('audio exits validate their own local clock and commands without inheriting the old two-step scene finish constraint', async t => {
  const { projectAssemblyAuthor } = await import('./helpers/project-assembly-backend-fixture.mjs');
  const { captureBuildSnapshot } = await import('../adapters/node-build-snapshot.mjs');
  const { sampleSceneAudio } = await import('../../engine/scene-audio-core.mjs');
  const author = await projectAssemblyAuthor(t, { entry: 'audio' }), captured = await captureBuildSnapshot(author.author, author.assemblyId);
  assert.equal(captured.ok, true); const plan = captured.plan, a = plan.scenes.find(scene => scene.audio), b = plan.scenes.find(scene => !scene.audio);
  const audioFrames = time => [sceneFrame(a, 1, { protocol: 1, event: 'ready', sceneObjectId: a.scene.objectId,
    trackIds: a.audio.document.tracks.map(track => track.id) }, 'audio'), ...sampleSceneAudio(a.audio.document, time).commands.map(command => sceneFrame(a, 1,
      { protocol: 1, event: 'command', ...Object.fromEntries(['cueId', 'trackId', 'resourceId', 'action', 'atSeconds'].map(key => [key, command[key]])) }, 'audio')), sceneFrame(a, 1, { protocol: 1, event: 'finished', timeSeconds: time }, 'audio')];
  const initial = [projectReady(plan), enterScene(a, 1), readyScene(a, 1)];
  for (const duration of [0, 0.125, 0.25]) {
    const reader = createProjectRuntimeEventReader(plan); push(reader, [...initial, ...audioFrames(duration), exitScene(a, 1, duration, b), enterScene(b, 2), readyScene(b, 2), exitScene(b, 2, 0.5 - duration), finishProject(plan, 2, 0.5)]);
    assert.deepEqual(reader.finish().diagnostics, []); assert.equal(reader.events.at(-1).event, 'finished');
  }
  for (const frames of [initial, [...initial, ...audioFrames(0.125)]]) {
    const reader = createProjectRuntimeEventReader(plan); push(reader, frames); assert.deepEqual(push(reader, [exitScene(a, 1, 0.25, b)]), []); assert.ok(reader.diagnostics.length);
  }
});

test('portable project modules import only engine modules and contain no backend process or file APIs', async () => {
  for (const name of ['contracts', 'events', 'query']) {
    const source = await fs.readFile(new URL(`../../engine/project-runtime-${name}.mjs`, import.meta.url), 'utf8');
    assert.doesNotMatch(source.replace(/\/\/[^\n]*/g, ''), /from ['"](?:node:|\.\.\/scripts\/)|(?:^|[^\w.])(?:process|document|window)\./m);
  }
});


test('a host-required half-second project smoke rejects an otherwise coherent early zero-time finish', () => {
  const plan = runtimeProject(), scene = plan.scenes[0], reader = createProjectRuntimeEventReader(plan, { expectedTotalSeconds: 0.5 });
  push(reader, [projectReady(plan), enterScene(scene, 1), readyScene(scene, 1), exitScene(scene, 1, 0), finishProject(plan, 1, 0)]);
  assert.equal(reader.events.some(event => event.event === 'finished'), false);
  assert.equal(reader.diagnostics.length, 1); assert.equal(reader.diagnostics[0].code, 'runtime_protocol_incomplete');
  assert.equal(reader.diagnostics[0].objectId, plan.assembly.objectId);
});

test('a host-required duration accepts a complete half-second run across multiple visits', () => {
  const plan = runtimeProject(), reader = createProjectRuntimeEventReader(plan, { expectedTotalSeconds: 0.5 });
  push(reader, returnTrip(plan)); assert.deepEqual(reader.finish().diagnostics, []);
  assert.equal(reader.events.at(-1).event, 'finished'); assert.equal(reader.events.at(-1).totalSeconds, 0.5);
});

test('window sessions without a host duration expectation can close successfully before the first step', () => {
  const plan = runtimeProject(), scene = plan.scenes[0];
  for (const options of [{}, { expectedTotalSeconds: 0 }]) {
    const reader = createProjectRuntimeEventReader(plan, options);
    push(reader, [projectReady(plan), enterScene(scene, 1), readyScene(scene, 1), exitScene(scene, 1, 0), finishProject(plan, 1, 0)]);
    assert.deepEqual(reader.finish().diagnostics, []); assert.equal(reader.events.at(-1).event, 'finished');
  }
});

test('project duration expectations reject invalid types, nonfinite values and values outside the finite run budget', () => {
  for (const expectedTotalSeconds of [null, true, '0.5', NaN, Infinity, -Infinity, -0.5, 60.001, Number.MAX_SAFE_INTEGER, {}, []]) {
    assert.throws(() => createProjectRuntimeEventReader(runtimeProject(), { expectedTotalSeconds }), { errorCode: 'runtime_project_invalid' });
  }
  assert.doesNotThrow(() => createProjectRuntimeEventReader(runtimeProject(), { expectedTotalSeconds: 60 }));
});
