import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePhysics2DCharacterMotionAuthor } from './helpers/scene-physics2d-character-motion-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';

const executable = process.env.VIENTO_GODOT_BIN;
const real = { skip: !executable ? 'Set VIENTO_GODOT_BIN for native Godot tests' : false, timeout: 180000 };
const row = (right = false, jump = false) => ({ left: false, right, up: false, down: false, jump });
const program = () => ({ format: 'viento-physics2d-input-replay', schemaVersion: 1, fixedDelta: 1 / 60,
  steps: Array.from({ length: 30 }, (_, index) => row(index < 15, index === 6)) });
async function setup(t) {
  const f = await scenePhysics2DCharacterMotionAuthor(t);
  await f.edit('documents/projects/demo.json', value => { value.sceneIds = [f.sceneIds[0]]; });
  await f.edit(`metadata/documents/${f.assemblyId}.json`, value => { value.relations = value.relations.filter(row => row.targetId === f.sceneIds[0]); });
  await f.edit(`metadata/documents/${f.sceneIds[0]}.json`, value => {
    value.relations = value.relations.filter(row => !['behavior', 'audio', 'animation'].includes(row.kind));
  });
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = await adapter.generate(captured.plan);
  const directory = await fs.mkdtemp(path.join(f.temporary, 'replay-stage-'));
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([resource, name]) => [name, captured.resources.get(resource)])]) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await fs.writeFile(path.join(directory, name), bytes);
  }
  const tool = await adapter.identify(executable);
  const imported = await adapter.executePhase({ phase: 'import', directory, tool, timeoutMs: 60000 });
  assert.equal(imported.status, 'succeeded', imported.stdout + imported.stderr);
  return { ...f, captured, generated, directory, tool };
}
const replayFiles = async dir => (await fs.readdir(dir)).filter(name => name.startsWith('viento-physics-replay-'));
function observations(result) {
  return result.stdout.split('\n').filter(line => line.startsWith('VIENTO_PHYSICS2D:')).map(line => JSON.parse(line.slice('VIENTO_PHYSICS2D:'.length)));
}
test('real Godot: fixed input replays horizontal movement and grounded jump through actual physics barriers', real, async t => {
  const f = await setup(t), replay = program();
  const run = async p => adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.tool, physicsControlProgram: p, timeoutMs: 60000 });
  const first = await run(replay), second = await run(replay);
  for (const result of [first, second]) {
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /(?:SCRIPT ERROR:|ERROR:)/);
    const events = observations(result), samples = events.filter(event => event.event === 'sample');
    assert.equal(samples.length, 30, JSON.stringify(events));
    assert.deepEqual(samples.map(sample => sample.stepIndex), Array.from({ length: 30 }, (_, i) => i + 1));
    assert.ok(samples.every(sample => Math.abs(sample.deltaSeconds - 1 / 60) < 1e-8));
    assert.ok(samples[14].positionAfter[0] > samples[0].positionBefore[0] + 40, JSON.stringify(samples));
    assert.ok(samples[6].positionAfter[1] < samples[6].positionBefore[1] - 1, JSON.stringify(samples[6]));
    assert.ok(samples[29].positionAfter[0] === samples[15].positionAfter[0], JSON.stringify(samples));
  }
  assert.deepEqual(observations(first), observations(second));
  assert.deepEqual(await replayFiles(f.directory), []);
  for (const [name, bytes] of f.generated.files) assert.deepEqual(await fs.readFile(path.join(f.directory, name)), bytes, name);
});

test('real Godot: malformed replay and authored behavior are refused before staging', real, async t => {
  const f = await setup(t), invalid = program(); invalid.steps[29].jump = true;
  await assert.rejects(adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.tool, physicsControlProgram: invalid }), { errorCode: 'runtime_physics2d_input_invalid' });
  const inventory = path.join(f.directory, 'assembly.json'), original = await fs.readFile(inventory);
  const value = JSON.parse(original); value.behaviorSources = [{ objectId: f.scriptId, path: `behaviors/${f.scriptId}.gd` }];
  await fs.writeFile(inventory, JSON.stringify(value));
  await assert.rejects(adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.tool, physicsControlProgram: program() }));
  await fs.writeFile(inventory, original);
  assert.deepEqual(await replayFiles(f.directory), []);
});


test('real Godot: failed and cancelled runs remove their owned temporary drivers', real, async t => {
  const f = await setup(t);
  const failed = await adapter.executePhase({ phase: 'run', directory: f.directory, tool: { ...f.tool, executable: '/bin/false' }, physicsControlProgram: program() });
  assert.notEqual(failed.status, 'succeeded');
  assert.deepEqual(await replayFiles(f.directory), []);
  const controller = new AbortController();
  const execution = adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.tool, signal: controller.signal, physicsControlProgram: program(), timeoutMs: 60000 });
  const timer = setTimeout(() => controller.abort(), 300);
  try {
    const cancelled = await execution;
    assert.notEqual(cancelled.status, 'succeeded');
  } finally { clearTimeout(timer); }
  assert.deepEqual(await replayFiles(f.directory), []);
  for (const [name, bytes] of f.generated.files) assert.deepEqual(await fs.readFile(path.join(f.directory, name)), bytes, name);
});
