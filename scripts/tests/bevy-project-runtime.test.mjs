import test from 'node:test';
import assert from 'node:assert/strict';
import { createBevyProjectRuntimeEventReader } from '../backends/bevy-project-runtime.mjs';
import { runtimeProject, actorStates } from './helpers/project-runtime-fixture.mjs';

const line = frame => 'VIENTO_RUNTIME:' + JSON.stringify(frame) + '\n';
const frames = plan => {
  const scene = plan.scenes[0];
  return [
    { protocol: scene.schemaVersion, event: 'ready', sceneObjectId: scene.scene.objectId, actors: actorStates(scene) },
    { protocol: scene.schemaVersion, event: 'state', instanceId: scene.actors[0].instanceId, objectId: scene.actors[0].objectId, state: 'moving' },
    { protocol: scene.schemaVersion, event: 'finished', actors: actorStates(scene), fixedDelta: 0.25 },
  ];
};
test('Bevy bridge scopes real scene frames to one project visit and completes on a valid smoke terminal', () => {
  const plan = runtimeProject(), source = frames(plan), seen = [];
  const reader = createBevyProjectRuntimeEventReader(plan, { onEvent: frame => seen.push(frame) });
  const wire = source.map(line).join('');
  for (let index = 0; index < wire.length; index += 7) reader.push(wire.slice(index, index + 7));
  assert.deepEqual(reader.finish().diagnostics, []);
  assert.deepEqual(reader.events.map(frame => frame.event), ['ready', 'scene-enter', 'scene-event', 'scene-event', 'scene-exit', 'finished']);
  assert.deepEqual(seen, reader.events); assert.equal(reader.events.at(-1).totalSeconds, 0.5);
  assert.deepEqual(reader.events.at(-2).actors, source.at(-1).actors);
});
test('cancellation, malformed input, diagnostics and non-smoke do not invent project completion', () => {
  const plan = runtimeProject(), source = frames(plan);
  const cancelled = createBevyProjectRuntimeEventReader(plan); cancelled.push(line(source[0])); cancelled.finish();
  assert.equal(cancelled.lifecycle.completed, false); assert.deepEqual(cancelled.diagnostics, []);
  const invalid = createBevyProjectRuntimeEventReader(plan); invalid.push(line(source[0]) + 'VIENTO_RUNTIME:{}\n' + line(source[2]));
  assert.equal(invalid.lifecycle.completed, false); assert.equal(invalid.diagnostics[0].code, 'runtime_protocol_invalid');
  const diagnostic = createBevyProjectRuntimeEventReader(plan); diagnostic.push(line(source[0]) + line({ protocol: 2, event: 'diagnostic', severity: 'error', code: 'runtime_failed', message: 'Failure', objectId: plan.entrySceneId }) + line(source[2]));
  assert.equal(diagnostic.lifecycle.completed, false); assert.equal(diagnostic.diagnostics[0].code, 'runtime_failed');
  const live = createBevyProjectRuntimeEventReader(plan, { smoke: false }); live.push(source.map(line).join('')); assert.equal(live.lifecycle.completed, false); assert.equal(live.diagnostics[0].code, 'runtime_protocol_invalid');
  const delta = createBevyProjectRuntimeEventReader(plan); delta.push(line(source[0]) + line({ ...source[2], fixedDelta: 0.125 })); assert.equal(delta.lifecycle.completed, false); assert.equal(delta.diagnostics[0].code, 'runtime_protocol_invalid');
});
test('only project plan and protocol 1 and data-only entry are admitted', () => {
  const plan = runtimeProject(); assert.throws(() => createBevyProjectRuntimeEventReader(plan, { protocolVersion: 2 }), { errorCode: 'runtime_project_invalid' });
  assert.throws(() => createBevyProjectRuntimeEventReader(runtimeProject({ behavior: true })), { errorCode: 'runtime_project_invalid' });
});
test('unterminated final chunk is handled on finish and callbacks remain coherent', () => {
  const plan = runtimeProject(), source = frames(plan), seen = [];
  const reader = createBevyProjectRuntimeEventReader(plan, { onEvent: frame => seen.push(frame) });
  reader.push(source.map(line).join('').trimEnd()); reader.finish();
  assert.equal(reader.lifecycle.completed, true); assert.deepEqual(reader.events, seen); assert.deepEqual(reader.diagnostics, []);
});

test('real Bevy process frames survive project bridge and reflect executed actor movement', { skip: !process.env.VIENTO_BEVY_BIN ? 'Set VIENTO_BEVY_BIN for the pinned Bevy runtime' : false }, async t => {
  const { default: fs } = await import('node:fs/promises');
  const { default: os } = await import('node:os');
  const { default: path } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { generateBevyProject } = await import('../backends/bevy-project.mjs');
  const plan = runtimeProject();
  plan.resources = [];
  for (const scene of plan.scenes) {
    scene.resources = []; scene.requiredCapabilities = scene.requiredCapabilities.filter(value => value !== 'image');
    for (const actor of scene.actors) delete actor.imageResourceId;
  }
  plan.requiredCapabilities = plan.requiredCapabilities.filter(value => value !== 'image');
  const scene = plan.scenes[0], generated = await generateBevyProject(scene), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-bevy-project-bridge-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'scene-data.json'); await fs.writeFile(file, generated.files.get('scene-data.json'));
  const processResult = spawnSync(process.env.VIENTO_BEVY_BIN, ['--scene', file, '--smoke'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(processResult.status, 0, processResult.stderr);
  const reader = createBevyProjectRuntimeEventReader(plan); reader.push(processResult.stdout);
  assert.deepEqual(reader.finish().diagnostics, []); assert.equal(reader.lifecycle.completed, true);
  const exit = reader.events.find(event => event.event === 'scene-exit');
  for (const actor of scene.actors) {
    const actual = exit.actors.find(value => value.instanceId === actor.instanceId);
    assert.deepEqual(actual.position, [actor.position[0] + (actor.controls === 'arrows' ? actor.speed * 0.25 : 0), actor.position[1]]);
  }
  // A real failed process must not acquire a lifecycle merely because the
  // host attempted to start it. Process failure remains the host's diagnosis.
  const broken = JSON.parse(await fs.readFile(file, 'utf8')); broken.actors[0].position[0] = 100001;
  await fs.writeFile(file, JSON.stringify(broken));
  const failed = spawnSync(process.env.VIENTO_BEVY_BIN, ['--scene', file, '--smoke'], { encoding: 'utf8', timeout: 30000 });
  assert.notEqual(failed.status, 0);
  const rejected = createBevyProjectRuntimeEventReader(plan); rejected.push(failed.stdout); rejected.finish();
  assert.deepEqual(rejected.lifecycle, { started: false, completed: false });
});

test('startup diagnostics, invalid ordering and truncated child frames never fabricate a ready project', () => {
  const plan = runtimeProject(), scene = plan.scenes[0], source = frames(plan);
  const error = { protocol: scene.schemaVersion, event: 'diagnostic', severity: 'error', code: 'runtime_resource_missing', message: 'Resource is missing', objectId: scene.scene.objectId };
  const reader = createBevyProjectRuntimeEventReader(plan);
  const text = line(error);
  for (let offset = 0; offset < text.length; offset += 3) reader.push(text.slice(offset, offset + 3));
  assert.deepEqual(reader.events, []); assert.deepEqual(reader.lifecycle, { started: false, completed: false });
  assert.equal(reader.diagnostics[0].code, 'runtime_resource_missing');
  reader.finish(); assert.deepEqual(reader.events, []);
  const early = createBevyProjectRuntimeEventReader(plan); early.push(line(source[2])); early.finish();
  assert.equal(early.lifecycle.started, false); assert.equal(early.lifecycle.completed, false);
  assert.equal(early.diagnostics[0].code, 'runtime_protocol_invalid');
  const truncated = createBevyProjectRuntimeEventReader(plan); truncated.push(line(source[0]).slice(0, -3)); truncated.finish();
  assert.equal(truncated.lifecycle.started, false); assert.equal(truncated.lifecycle.completed, false);
  assert.equal(truncated.diagnostics[0].code, 'runtime_protocol_invalid');
});

test('prior diagnostics remain visible and prevent completion even if the child later reports ready and finished', () => {
  const plan = runtimeProject(), scene = plan.scenes[0], source = frames(plan);
  const error = { protocol: scene.schemaVersion, event: 'diagnostic', severity: 'error', code: 'runtime_resource_missing', message: 'Resource is missing', objectId: scene.scene.objectId };
  const reader = createBevyProjectRuntimeEventReader(plan);
  reader.push(line(error) + source.map(line).join('')); reader.finish();
  assert.equal(reader.lifecycle.started, true); assert.equal(reader.lifecycle.completed, false);
  assert.equal(reader.events.some(event => event.event === 'finished'), false);
  assert.equal(reader.diagnostics[0].code, 'runtime_resource_missing');
  const afterReady = createBevyProjectRuntimeEventReader(plan);
  afterReady.push(line(source[0]) + line(error)); afterReady.finish();
  assert.equal(afterReady.diagnostics.filter(value => value.code === 'runtime_resource_missing').length, 1);
});

test('a ready live visit and a smoke process stopped before terminal evidence remain incomplete', () => {
  const plan = runtimeProject(), source = frames(plan);
  for (const smoke of [false, true]) {
    const reader = createBevyProjectRuntimeEventReader(plan, { smoke });
    reader.push(line(source[0]) + line(source[1])); reader.finish();
    assert.deepEqual(reader.lifecycle, { started: true, completed: false });
    assert.deepEqual(reader.events.map(value => value.event), ['ready', 'scene-enter', 'scene-event', 'scene-event']);
    assert.deepEqual(reader.diagnostics, []);
  }
});
