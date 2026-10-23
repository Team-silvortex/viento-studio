import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { createProjectRuntimeObservation, queryProjectRuntimeObservation } from '../../engine/project-runtime-query.mjs';
import { runtimeProject, runtimeId, projectReady, enterScene, readyScene, exitScene, sceneFrame, projectLine, returnTrip } from './helpers/project-runtime-fixture.mjs';
import { sharedStateProject, sharedFrame, sharedReady, sharedFinished, stateFrame, stateOrigin, stateReturnTrip } from './helpers/project-shared-state-fixture.mjs';
const push = (reader, frames) => reader.push(frames.map(projectLine).join(''));
const apply = (observer, frames) => frames.forEach(frame => assert.equal(observer.push(frame), true, JSON.stringify(frame)));
function running() {
  const plan = sharedStateProject(), [a, b] = plan.scenes, reader = createProjectRuntimeEventReader(plan, { protocolVersion: 2 });
  push(reader, [sharedReady(plan), sharedFrame(enterScene(a, 1)), sharedFrame(readyScene(a, 1))]); return { plan, a, b, reader };
}
function reject(reader, frame) {
  const before = reader.sharedState, events = reader.events.length, diagnostics = reader.diagnostics.length;
  assert.deepEqual(push(reader, [frame]), []); assert.deepEqual(reader.sharedState, before);
  assert.equal(reader.events.length, events); assert.equal(reader.diagnostics.length, diagnostics + 1);
}

test('project protocol 2 preserves session state through A→B→A with frozen binding provenance and global revisions', () => {
  const plan = sharedStateProject(), frames = stateReturnTrip(plan), callbacks = [];
  const reader = createProjectRuntimeEventReader(plan, { protocolVersion: 2, expectedTotalSeconds: 0.5, onEvent: frame => callbacks.push(frame) });
  assert.equal(push(reader, frames).length, frames.length); assert.deepEqual(reader.finish().diagnostics, []); assert.deepEqual(callbacks, reader.events);
  assert.deepEqual(reader.sharedState.entries, [
    { key: 'coins', value: true, revision: 4, origin: stateOrigin(plan.scenes[0], 3) },
    { key: 'message', value: '风と風 🌬️', revision: 2, origin: stateOrigin(plan.scenes[1], 2) },
  ]);
  assert.equal(reader.events.filter(frame => frame.event === 'state').length, 4); assert.equal(reader.sharedState.lastChange.origin.visitIndex, 3);
  assert.equal(Object.hasOwn(reader.events.find(frame => frame.event === 'state'), 'source'), false);
});

test('protocol selection is explicit: default v1 remains byte-shaped and rejects v2, while v2 rejects downgrades', () => {
  const plan = sharedStateProject(), old = createProjectRuntimeEventReader(plan), modern = createProjectRuntimeEventReader(plan, { protocolVersion: 2 });
  assert.equal(Object.hasOwn(old, 'sharedState'), false); assert.deepEqual(push(old, [sharedReady(plan)]), []);
  push(old, returnTrip(plan)); assert.equal(old.events.at(-1).protocol, 1);
  const legacy = createProjectRuntimeEventReader(plan), a = plan.scenes[0];
  push(legacy, [projectReady(plan), enterScene(a, 1), readyScene(a, 1)]);
  assert.deepEqual(push(legacy, [{ ...stateFrame(a, 1, 1, 'key', true), protocol: 1 }]), []);
  reject(modern, projectReady(plan)); push(modern, [sharedReady(plan)]); reject(modern, enterScene(plan.scenes[0], 1));
  for (const protocolVersion of [0, 8, '2', null, true, NaN, Infinity, {}, []]) {
    assert.throws(() => createProjectRuntimeEventReader(plan, { protocolVersion }), { errorCode: 'runtime_project_invalid' });
    assert.throws(() => createProjectRuntimeObservation(plan, { protocolVersion }), { errorCode: 'runtime_project_invalid' });
  }
  const view = createProjectRuntimeObservation(plan).snapshot(); assert.deepEqual(Object.keys(view.project), ['assemblyId', 'entrySceneId', 'activeSceneId', 'visits']);
});

test('state requires project readiness, entered child readiness and a live current visit', () => {
  const plan = sharedStateProject(), [a, b] = plan.scenes, reader = createProjectRuntimeEventReader(plan, { protocolVersion: 2 });
  const mutation = stateFrame(a, 1, 1, 'key', true); reject(reader, mutation); push(reader, [sharedReady(plan)]); reject(reader, mutation);
  push(reader, [sharedFrame(enterScene(a, 1))]); reject(reader, mutation); push(reader, [sharedFrame(readyScene(a, 1)), mutation]);
  push(reader, [sharedFrame(exitScene(a, 1, 0.25, b))]); reject(reader, stateFrame(a, 1, 2, 'key', false));
  push(reader, [sharedFrame(enterScene(b, 2)), sharedFrame(readyScene(b, 2))]); reject(reader, stateFrame(a, 1, 2, 'key', false));
  push(reader, [sharedFrame(exitScene(b, 2, 0.25, a)), sharedFrame(enterScene(a, 3)), sharedFrame(readyScene(a, 3))]);
  reject(reader, stateFrame(a, 1, 2, 'key', false)); assert.equal(push(reader, [stateFrame(a, 3, 2, 'key', false)]).length, 1);
});

test('frozen binding tuple ownership and exact wire keys reject source path injection', () => {
  const { a, b, reader } = running(), valid = stateFrame(a, 1, 1, 'key', true);
  for (const frame of [
    { ...valid, bindingId: runtimeId(99) }, { ...valid, instanceId: a.actors[1].instanceId }, { ...valid, objectId: runtimeId(99) },
    { ...valid, sceneId: b.scene.objectId }, { ...valid, visitIndex: 2 }, { ...valid, sourcePath: 'documents/forged.json' },
    { ...valid, source: a.behaviors.bindings[0].declaration }, { ...valid, origin: stateOrigin(a) }, { ...valid, stateRevision: 1 },
  ]) reject(reader, frame);
  push(reader, [valid]); assert.deepEqual(reader.sharedState.entries[0].origin.source, a.behaviors.bindings[0].declaration);
  assert.notEqual(reader.sharedState.entries[0].origin.source.objectId, reader.sharedState.entries[0].origin.objectId);
});

test('no-op, missing delete, malformed scalar and revision failures leave the admitted state intact', () => {
  const { a, reader } = running(); push(reader, [stateFrame(a, 1, 1, 'key', 1)]);
  for (const frame of [stateFrame(a, 1, 2, 'key', 1), stateFrame(a, 1, 2, 'missing', undefined, 'delete'),
    stateFrame(a, 1, 1, 'key', 2), stateFrame(a, 1, 3, 'key', 2), stateFrame(a, 1, 2, 'key', null), stateFrame(a, 1, 2, 'key', undefined), stateFrame(a, 1, 2, 'key', '\ud800'),
    { ...stateFrame(a, 1, 2, 'key', undefined, 'delete'), value: 1 }, stateFrame(a, 1, 2, 'key', 'a'.repeat(4097)),
    stateFrame(a, 1, 2, 'constructor', true), stateFrame(a, 1, 2, 'key', 1e9 + 1)]) reject(reader, frame);
  push(reader, [stateFrame(a, 1, 2, 'key', undefined, 'delete')]); assert.equal(reader.sharedState.revision, 2); assert.equal(reader.sharedState.entries.length, 0);
});

test('reader state budgets remain independent of the outer event budget', () => {
  const { a, reader } = running();
  for (let revision = 1; revision <= 1024; revision++) assert.equal(push(reader, [stateFrame(a, 1, revision, 'key', revision)]).length, 1);
  reject(reader, stateFrame(a, 1, 1025, 'key', 0)); assert.equal(reader.events.length, 1027);
  const bounded = running();
  for (let revision = 1; revision <= 64; revision++) push(bounded.reader, [stateFrame(bounded.a, 1, revision, 'k' + revision, false)]);
  reject(bounded.reader, stateFrame(bounded.a, 1, 65, 'overflow', false));
  const bytes = running();
  for (let revision = 1; revision <= 4; revision++) push(bytes.reader, [stateFrame(bytes.a, 1, revision, String.fromCharCode(64 + revision), 'a'.repeat(4095))]);
  reject(bytes.reader, stateFrame(bytes.a, 1, 5, 'A', 'a'.repeat(4096)));
});

test('root ready cannot preload state and root finished must close the exact admitted state revision and smoke duration', () => {
  const plan = sharedStateProject(), a = plan.scenes[0], reader = createProjectRuntimeEventReader(plan, { protocolVersion: 2, expectedTotalSeconds: 0.5 });
  for (const ready of [{ ...sharedReady(plan), stateRevision: 1 }, { ...sharedReady(plan), entries: [] }, sharedFrame(projectReady(plan))]) reject(reader, ready);
  push(reader, [sharedReady(plan), sharedFrame(enterScene(a, 1)), sharedFrame(readyScene(a, 1)), stateFrame(a, 1, 1, 'key', true), sharedFrame(exitScene(a, 1, 0.5))]);
  reject(reader, sharedFinished(plan, 1, 0.5, 0)); const missing = sharedFinished(plan, 1, 0.5, 1); delete missing.stateRevision; reject(reader, missing);
  push(reader, [sharedFinished(plan, 1, 0.5, 1)]); reject(reader, stateFrame(a, 1, 2, 'key', false));
  const early = createProjectRuntimeEventReader(plan, { protocolVersion: 2, expectedTotalSeconds: 0.5 });
  push(early, [sharedReady(plan), sharedFrame(enterScene(a, 1)), sharedFrame(readyScene(a, 1)), sharedFrame(exitScene(a, 1, 0)), sharedFinished(plan, 1, 0, 0)]);
  assert.equal(early.events.at(-1).event, 'scene-exit'); assert.equal(early.diagnostics.at(-1).code, 'runtime_protocol_incomplete');
});

test('observation retains historical writers while revoking actor coordinates at exit and preserving state under filters', () => {
  const plan = sharedStateProject(), [a, b] = plan.scenes, observer = createProjectRuntimeObservation(plan, { protocolVersion: 2 });
  const initial = observer.snapshot(); assert.deepEqual(initial.project.sharedState, { revision: 0, entries: [], lastChange: null }); assert.deepEqual(queryProjectRuntimeObservation(initial), initial);
  apply(observer, stateReturnTrip(plan).slice(0, 5));
  const between = queryProjectRuntimeObservation(observer.snapshot()); assert.equal(between.project.activeSceneId, b.scene.objectId); assert.equal(between.phase, 'waiting');
  assert.ok(between.actors.every(actor => actor.position === null)); assert.equal(between.project.sharedState.entries[0].origin.sceneId, a.scene.objectId);
  apply(observer, stateReturnTrip(plan).slice(5)); const view = observer.snapshot();
  const selected = queryProjectRuntimeObservation(view, { instanceId: a.actors[0].instanceId }); assert.equal(selected.actors.length, 1); assert.deepEqual(selected.project.sharedState, view.project.sharedState);
  assert.equal(selected.project.sharedState.entries[1].origin.sceneId, b.scene.objectId); assert.equal(selected.project.sharedState.entries[1].origin.visitIndex, 2);
  assert.deepEqual(queryProjectRuntimeObservation(view, { objectId: plan.assembly.objectId }).project.sharedState, view.project.sharedState);
});

test('observation deletion keeps a visible last-change source when no entries remain', () => {
  const plan = sharedStateProject(), a = plan.scenes[0], observer = createProjectRuntimeObservation(plan, { protocolVersion: 2 });
  apply(observer, [sharedReady(plan), sharedFrame(enterScene(a, 1)), sharedFrame(readyScene(a, 1)), stateFrame(a, 1, 1, 'key', true), stateFrame(a, 1, 2, 'key', undefined, 'delete')]);
  const view = queryProjectRuntimeObservation(observer.snapshot()); assert.deepEqual(view.project.sharedState.entries, []);
  assert.deepEqual(view.project.sharedState.lastChange, { operation: 'delete', key: 'key', revision: 2, origin: stateOrigin(a) });
});

test('query rejects invented protocol/state fields and origins outside the admitted visit history without invoking getters', () => {
  const plan = sharedStateProject(), observer = createProjectRuntimeObservation(plan, { protocolVersion: 2 }); apply(observer, stateReturnTrip(plan));
  const view = observer.snapshot();
  for (const mutate of [
    v => delete v.project.sharedState, v => delete v.project.protocolVersion, v => v.project.protocolVersion = 1,
    v => v.project.sharedState.entries[0].origin.visitIndex = 4, v => v.project.sharedState.entries[1].origin.sceneId = plan.entrySceneId,
    v => v.project.sharedState.entries[1].origin.sourcePath = 'extra.json', v => v.project.sharedState.lastChange = null,
    v => v.project.sharedState.entries[1].value = { unsafe: true }, v => v.project.sharedState.entries[1].origin.source.extra = true,
  ]) { const input = structuredClone(view); mutate(input); assert.throws(() => queryProjectRuntimeObservation(input), { errorCode: 'runtime_project_invalid' }); }
  let calls = 0; Object.defineProperty(view.project.sharedState.entries[0].origin, 'source', { enumerable: true, get() { calls++; return {}; } });
  assert.throws(() => queryProjectRuntimeObservation(view)); assert.equal(calls, 0);
  const waiting = createProjectRuntimeObservation(plan, { protocolVersion: 2 }); apply(waiting, [sharedReady(plan), sharedFrame(enterScene(plan.scenes[0], 1))]);
  const invalid = waiting.snapshot(); invalid.project.sharedState = observer.snapshot().project.sharedState;
  assert.throws(() => queryProjectRuntimeObservation(invalid));
});

test('frozen plan, input events, callback values and returned state cannot mutate session provenance', () => {
  const plan = sharedStateProject(), original = structuredClone(plan), observer = createProjectRuntimeObservation(plan, { protocolVersion: 2 });
  plan.scenes[0].behaviors.bindings[0].declaration.sourcePath = 'modified.json';
  const a = original.scenes[0], input = stateFrame(a, 1, 1, 'key', 'initial'); apply(observer, [sharedReady(original), sharedFrame(enterScene(a, 1)), sharedFrame(readyScene(a, 1)), input]);
  input.value = 'changed'; const expected = observer.snapshot(); assert.deepEqual(expected.project.sharedState.entries[0].origin.source, a.behaviors.bindings[0].declaration);
  const external = queryProjectRuntimeObservation(expected); external.project.sharedState.entries[0].origin.source.sourcePath = 'external.json'; external.project.sharedState.lastChange.origin.visitIndex = 64;
  assert.deepEqual(observer.snapshot(), expected);
  let calls = 0; const hostile = stateFrame(a, 1, 2, 'key', false); Object.defineProperty(hostile, 'value', { enumerable: true, get() { calls++; return false; } });
  assert.equal(observer.push(hostile), false); assert.equal(calls, 0); assert.deepEqual(observer.snapshot(), expected);
  const { reader, a: scene } = running(); push(reader, [stateFrame(scene, 1, 1, 'key', true)]); assert.throws(() => reader.events.at(-1).value = false, TypeError);
  const outside = reader.sharedState; outside.entries.length = 0; assert.equal(reader.sharedState.entries.length, 1);
});

test('protocol 2 can observe a legacy child without inventing a behavior binding or a state write', () => {
  const plan = runtimeProject({ legacy: true }), frames = returnTrip(plan).map(sharedFrame); frames[0].stateRevision = 0; frames.at(-1).stateRevision = 0;
  const observer = createProjectRuntimeObservation(plan, { protocolVersion: 2 }); apply(observer, frames);
  const view = queryProjectRuntimeObservation(observer.snapshot()); assert.equal(view.protocolVersion, 1); assert.equal(view.project.protocolVersion, 2);
  assert.deepEqual(view.project.sharedState, { revision: 0, entries: [], lastChange: null });
});

test('protocol 2 retains independent audio visit clocks before a later behavior writes shared state', async t => {
  const { projectAssemblyAuthor } = await import('./helpers/project-assembly-backend-fixture.mjs');
  const { captureBuildSnapshot } = await import('../adapters/node-build-snapshot.mjs');
  const { sampleSceneAudio } = await import('../../engine/scene-audio-core.mjs');
  const author = await projectAssemblyAuthor(t, { entry: 'audio' }), captured = await captureBuildSnapshot(author.author, author.assemblyId);
  assert.equal(captured.ok, true); const plan = captured.plan, a = plan.scenes.find(scene => scene.audio), b = plan.scenes.find(scene => !scene.audio);
  const duration = 0.125, audio = [sceneFrame(a, 1, { protocol: 1, event: 'ready', sceneObjectId: a.scene.objectId, trackIds: a.audio.document.tracks.map(track => track.id) }, 'audio'),
    ...sampleSceneAudio(a.audio.document, duration).commands.map(command => sceneFrame(a, 1, { protocol: 1, event: 'command', ...Object.fromEntries(['cueId', 'trackId', 'resourceId', 'action', 'atSeconds'].map(key => [key, command[key]])) }, 'audio')),
    sceneFrame(a, 1, { protocol: 1, event: 'finished', timeSeconds: duration }, 'audio')].map(sharedFrame);
  const reader = createProjectRuntimeEventReader(plan, { protocolVersion: 2, expectedTotalSeconds: 0.5 });
  const frames = [sharedReady(plan), sharedFrame(enterScene(a, 1)), sharedFrame(readyScene(a, 1)), ...audio, sharedFrame(exitScene(a, 1, duration, b)),
    sharedFrame(enterScene(b, 2)), sharedFrame(readyScene(b, 2)), stateFrame(b, 2, 1, 'heard', true), sharedFrame(exitScene(b, 2, 0.5 - duration)), sharedFinished(plan, 2, 0.5, 1)];
  assert.equal(push(reader, frames).length, frames.length); assert.deepEqual(reader.finish().diagnostics, []); assert.equal(reader.sharedState.entries[0].origin.visitIndex, 2);
});
