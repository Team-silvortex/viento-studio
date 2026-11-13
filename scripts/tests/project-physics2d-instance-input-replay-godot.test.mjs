import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { scenePhysics2DCharacterMotionAuthor } from './helpers/scene-physics2d-character-motion-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';

const executable = process.env.VIENTO_GODOT_BIN;
const real = { skip: !executable ? 'Set VIENTO_GODOT_BIN for native Godot tests' : false, timeout: 180000 };
const id = n => `83838383-8383-4383-8383-${String(n).padStart(12, '0')}`;
const input = (instanceId, values = {}) => ({ instanceId, left: false, right: false, up: false, down: false, jump: false, ...values });
const program = (a, b) => ({ format: 'viento-physics2d-input-replay', schemaVersion: 2, fixedDelta: 1 / 60,
  steps: Array.from({ length: 30 }, (_, n) => ({ inputs: n === 29 ? [] : [
    input(a, { right: n < 21, jump: n >= 6 }),
    ...(n < 22 || n >= 27 ? [input(b, { left: n < 18, jump: n >= 10 })] : []),
  ] })) });
function observations(result) {
  return result.stdout.split('\n').filter(line => line.startsWith('VIENTO_PHYSICS2D:')).map(line => JSON.parse(line.slice('VIENTO_PHYSICS2D:'.length)));
}
const replayFiles = async directory => (await fs.readdir(directory)).filter(name => name.startsWith('viento-physics-replay-'));
async function setup(t, { planar = false, vertical = false } = {}) {
  const f = await scenePhysics2DCharacterMotionAuthor(t);
  const b = id(1), idle = id(2), none = id(3), nonphysical = id(4), wall = id(5);
  await f.edit('documents/scenes/demo.json', scene => {
    const actor = scene.actors[0];
    scene.actors.push(...[[b, 300, 'arrows'], [idle, 500, 'arrows'], [none, 680, 'none'], [nonphysical, 900, 'arrows']]
      .map(([instanceId, x, controls]) => ({ ...structuredClone(actor), instanceId, position: [x, 178], controls })));
    if (!vertical) scene.actors.push({ ...structuredClone(scene.actors[2]), instanceId: wall, position: [155, 165], size: [10, 50] });
    if (vertical) for (const actor of scene.actors) if ([f.instanceId, b, idle, none].includes(actor.instanceId)) actor.position[1] = 180;
  });
  await f.edit(f.physicsPath, physics => {
    const body = physics.bodies[0];
    physics.bodies.push(...[b, idle, none].map((instanceId, n) => ({ ...structuredClone(body), id: id(10 + n), instanceId })));
    if (!vertical) physics.bodies.push({ ...structuredClone(physics.bodies[2]), id: id(20), instanceId: wall, shape: { kind: 'box', size: [10, 50] } });
    if (planar) for (const candidate of physics.bodies) delete candidate.characterMotion;
    if (vertical) { physics.schemaVersion = 6; physics.bodies[2].platformMotion = { kind: 'vertical', offsetY: -60, speed: 60 }; }
  });
  await f.edit('documents/projects/demo.json', project => { project.sceneIds = [f.sceneIds[0]]; });
  await f.edit(`metadata/documents/${f.assemblyId}.json`, record => { record.relations = record.relations.filter(row => row.targetId === f.sceneIds[0]); });
  await f.edit(`metadata/documents/${f.sceneIds[0]}.json`, record => { record.relations = record.relations.filter(row => !['behavior', 'audio', 'animation'].includes(row.kind)); });
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = await adapter.generate(captured.plan);
  const directory = await fs.mkdtemp(path.join(f.temporary, 'instance-replay-stage-'));
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([resource, name]) => [name, captured.resources.get(resource)])]) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), bytes);
  }
  const tool = await adapter.identify(executable), imported = await adapter.executePhase({ phase: 'import', directory, tool, timeoutMs: 60000 });
  assert.equal(imported.status, 'succeeded', imported.stdout + imported.stderr);
  const actorObjectId = captured.plan.scenes[0].actors.find(actor => actor.instanceId === f.instanceId).objectId;
  assert.ok([f.instanceId, b, idle].every(instanceId => captured.plan.scenes[0].actors.find(actor => actor.instanceId === instanceId).objectId === actorObjectId));
  return { ...f, captured, generated, directory, tool, b, idle, none, nonphysical, wall };
}
async function unchanged(f) {
  assert.deepEqual(await replayFiles(f.directory), []);
  for (const [name, bytes] of f.generated.files) assert.deepEqual(await fs.readFile(path.join(f.directory, name)), bytes, name);
}
async function evidence(name, f, extra = {}) {
  const directory = process.env.VIENTO_PHYSICS_INSTANCE_EVIDENCE_DIR;
  if (!directory) return;
  await fs.mkdir(directory, { recursive: true });
  const originalFiles = Object.fromEntries(await Promise.all([...f.generated.files].map(async ([name, bytes]) => [name, {
    expected: createHash('sha256').update(bytes).digest('hex'), actual: createHash('sha256').update(await fs.readFile(path.join(f.directory, name))).digest('hex') }])));
  await fs.writeFile(path.join(directory, `${name}.json`), JSON.stringify({ scope: 'Real Godot adapter execution against disposable author fixture',
    backend: adapter.descriptor.version, tool: f.tool, originalFiles, temporaryEntries: await replayFiles(f.directory), ...extra }, null, 2) + '\n');
}
const run = (f, p, extras = {}) => adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.tool, physicsControlProgram: p, timeoutMs: 60000, ...extras });
function success(result) {
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /(?:SCRIPT ERROR:|ERROR:)/);
  const events = observations(result); assert.equal(events[0].event, 'ready'); assert.equal(events.at(-1).event, 'finished');
  return events.filter(event => event.event === 'sample');
}

test('real Godot: shared-object characters have separate directions, jump edges and omission releases', real, async t => {
  const f = await setup(t), p = program(f.instanceId, f.b), first = await run(f, p), second = await run(f, p);
  const samples = success(first); success(second); assert.deepEqual(observations(first), observations(second));
  assert.equal(samples.length, 120);
  const group = instanceId => samples.filter(sample => sample.instanceId === instanceId), a = group(f.instanceId), b = group(f.b), idle = group(f.idle), none = group(f.none);
  assert.ok(a.every((sample, n) => sample.stepIndex === n + 1));
  assert.ok(a.slice(0, 21).every(sample => sample.requestedMotion[0] > 0));
  assert.ok(b.slice(0, 18).every(sample => sample.requestedMotion[0] < 0));
  assert.ok(a.slice(21).every(sample => sample.requestedMotion[0] === 0));
  assert.ok(b.slice(18).every(sample => sample.requestedMotion[0] === 0));
  assert.ok(idle.every(sample => sample.requestedMotion[0] === 0 && sample.requestedMotion[1] >= 0));
  assert.ok(none.every(sample => sample.requestedMotion[0] === 0 && sample.requestedMotion[1] >= 0));
  assert.ok(a[6].requestedMotion[1] < -1, JSON.stringify(a[6]));
  assert.ok(b[10].requestedMotion[1] < -1, JSON.stringify(b[10]));
  assert.ok(b[27].requestedMotion[1] < -1, JSON.stringify(b[27]));
  assert.ok(a.slice(26, 29).every(sample => sample.requestedMotion[1] >= 0), 'held input must not jump again after landing');
  assert.ok(a.some(sample => sample.contacts.some(contact => contact.collider?.instanceId === f.wall)), 'actual wall collision');
  await unchanged(f);
  const legacy = { format: p.format, schemaVersion: 1, fixedDelta: p.fixedDelta,
    steps: Array.from({ length: 30 }, (_, n) => ({ left: false, right: n < 15, up: false, down: false, jump: false })) };
  const old = success(await run(f, legacy));
  for (const target of [f.instanceId, f.b, f.idle]) assert.ok(old.filter(sample => sample.instanceId === target).slice(0, 15).every(sample => sample.requestedMotion[0] > 0));
  await unchanged(f);
  await evidence('shared-object-gravity', f, { program: p, samples, repeatEqual: true, legacySampleCount: old.length });
});

test('real Godot: planar stop/slide retain normalized diagonal input and zero unlisted characters', real, async t => {
  const f = await setup(t, { planar: true }), p = program(f.instanceId, f.b);
  p.steps = p.steps.map((_, n) => ({ inputs: n < 15 ? [input(f.instanceId, { left: true, up: true }), input(f.b, { right: true, down: true })] : [] }));
  const samples = success(await run(f, p));
  for (const [target, sign] of [[f.instanceId, -1], [f.b, 1]]) {
    const rows = samples.filter(sample => sample.instanceId === target);
    assert.ok(rows.slice(0, 15).every(sample => Math.abs(Math.hypot(...sample.requestedMotion) - 4) < 1e-5));
    assert.ok(rows.slice(0, 15).every(sample => Math.sign(sample.requestedMotion[0]) === sign && Math.sign(sample.requestedMotion[1]) === sign));
    assert.ok(rows.slice(15).every(sample => sample.requestedMotion.every(value => value === 0)));
  }
  assert.ok(samples.filter(sample => [f.idle, f.none].includes(sample.instanceId)).every(sample => sample.requestedMotion.every(value => value === 0)));
  await unchanged(f);
  await evidence('planar-diagonal', f, { program: p, samples });
});

test('real Godot: unknown/static/sensor/nonphysics/controls-none targets are refused before staging', real, async t => {
  const f = await setup(t);
  for (const target of [id(999), f.wallInstanceId, f.sensorInstanceId, f.nonphysical, f.none]) {
    const p = program(f.instanceId, f.b); p.steps[0].inputs = [input(target)];
    await assert.rejects(run(f, p), { errorCode: 'runtime_physics2d_input_target_invalid' }); await unchanged(f);
  }
  await evidence('invalid-targets', f, { rejected: [id(999), f.wallInstanceId, f.sensorInstanceId, f.nonphysical, f.none] });
});

test('real Godot: failed, cancelled and observer-failed instance runs clean all private scripts and UID companions', real, async t => {
  const f = await setup(t), p = program(f.instanceId, f.b);
  const failed = await run(f, p, { tool: { ...f.tool, executable: '/bin/false' } });
  assert.notEqual(failed.status, 'succeeded'); await unchanged(f);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 300);
  try { assert.notEqual((await run(f, p, { signal: controller.signal })).status, 'succeeded'); }
  finally { clearTimeout(timer); }
  await unchanged(f);
  const observer = await run(f, p, { onOutput() { throw new Error('Deliberate observer test'); } });
  assert.equal(observer.status, 'observer-failed'); await unchanged(f);
  await evidence('cleanup', f, { failedStatus: failed.status, observerStatus: observer.status, cancellationVerified: true });
});


test('real Godot: instance replay composes with generated vertical platform control and original carry solver', real, async t => {
  const f = await setup(t, { vertical: true });
  const p = program(f.instanceId, f.b);
  p.steps = p.steps.map((_, n) => ({ inputs: n < 10 ? [input(f.instanceId, { right: true })] : [] }));
  const samples = success(await run(f, p));
  assert.ok(f.generated.files.has(`scenes/${f.sceneIds[0]}/platform-control-scene.gd`));
  assert.equal(samples.length, 120);
  const a = samples.filter(sample => sample.instanceId === f.instanceId), b = samples.filter(sample => sample.instanceId === f.b);
  assert.ok(a.slice(0, 10).every(sample => sample.requestedMotion[0] > 0));
  assert.ok(a.slice(10).every(sample => sample.requestedMotion[0] === 0));
  assert.ok(b.every(sample => sample.requestedMotion[0] === 0));
  assert.ok(b.at(-1).positionAfter[1] < b[0].positionBefore[1] - 5, 'native platform carries the unlisted grounded character');
  await unchanged(f);
  await evidence('vertical-platform', f, { program: p, samples });
});
