import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { BEVY_EXECUTION_ADAPTER as bevy } from '../backends/bevy-adapter.mjs';
import { GODOT4_EXECUTION_ADAPTER as godot } from '../backends/godot4-adapter.mjs';
import { createSceneControlTraceReader } from '../../engine/scene-control-program.mjs';

const first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222';
const none = '33333333-3333-4333-8333-333333333333', zero = '44444444-4444-4444-8444-444444444444';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v2.json', import.meta.url), 'utf8'));
const legacy = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v1.json', import.meta.url), 'utf8'));
const row = (instanceId, left = false, right = false, up = false, down = false) => ({ instanceId, left, right, up, down });
const program = () => ({ format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.125,
  steps: [{ inputs: [row(first, false, true), row(second, true), row(none, false, false, false, true), row(zero, false, true)] },
    { inputs: [row(first, false, false, true)] }, { inputs: [row(first, false, true, false, true), row(second, false, true, true)] },
    { inputs: [row(second, false, false, false, true)] }, { inputs: [] }] });
function plan(version = 2) {
  const value = structuredClone(version === 2 ? golden.plan : legacy.plan);
  value.resources = []; value.requiredCapabilities = value.requiredCapabilities.filter(capability => capability !== 'image');
  for (const actor of value.actors) delete actor.imageResourceId;
  value.actors[0].position = [200, 220]; value.actors[0].speed = 160;
  value.actors[1].position = [500, 220]; value.actors[1].speed = 80;
  if (version === 2) {
    const idle = { ...structuredClone(value.actors[0]), instanceId: none, position: [600, 300], controls: 'none' };
    const stopped = { ...structuredClone(value.actors[0]), instanceId: zero, position: [400, 500], speed: 0 };
    value.actors.push(idle, stopped);
  }
  return value;
}
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-instance-backends-'));
  t.after(() => fs.rm(root, { recursive: true, force: true })); return root;
}
async function writeProject(adapter, value, directory) {
  const generated = await adapter.generate(value); await fs.mkdir(directory);
  for (const [file, bytes] of generated.files) await fs.writeFile(path.join(directory, file), bytes);
  return generated;
}
async function inventory(directory) {
  return Object.fromEntries(await Promise.all((await fs.readdir(directory)).filter(file => !file.startsWith('.')).map(async file => [file, hash(await fs.readFile(path.join(directory, file)))])));
}

test('per-instance control is an additive capability, with engine-owned implementation versions', () => {
  assert.equal(bevy.descriptor.version, '0.3.0'); assert.equal(godot.descriptor.version, '0.5.0');
  for (const adapter of [bevy, godot]) {
    assert.ok(adapter.descriptor.capabilities.includes('runtime.control-replay'));
    assert.ok(adapter.descriptor.capabilities.includes('runtime.control-replay.instances'));
    assert.equal(Object.keys(adapter.descriptor.execution).length, 7);
  }
});

test('adapters reject unknown or definition targets, duplicate rows, plan1 and row overflow before staging or spawning', { skip: process.platform !== 'linux' }, async t => {
  const root = await temporary(t);
  for (const [name, adapter] of [['godot', godot], ['bevy', bevy]]) {
    const directory = path.join(root, name); await writeProject(adapter, plan(), directory);
    const executable = path.join(root, name + '-tool'), calls = path.join(root, name + '-calls');
    await fs.writeFile(executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(calls)},'spawned');\n`, { mode: 0o700 });
    const before = await inventory(directory), base = { phase: 'run', directory, tool: { executable } };
    for (const target of ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', plan().actors[0].objectId]) {
      const input = program(); input.steps[0].inputs[0].instanceId = target; const original = structuredClone(input);
      await assert.rejects(adapter.executePhase({ ...base, controlProgram: input }), { errorCode: 'runtime_control_target_missing' });
      assert.deepEqual(input, original); assert.deepEqual(await inventory(directory), before);
    }
    const duplicate = program(); duplicate.steps[0].inputs.push({ ...duplicate.steps[0].inputs[0] });
    await assert.rejects(adapter.executePhase({ ...base, controlProgram: duplicate }), { errorCode: 'runtime_control_invalid' });
    const oversized = program(); oversized.steps = Array.from({ length: 9 }, () => ({ inputs: Array.from({ length: 128 }, (_, index) => row(`bbbbbbbb-bbbb-4bbb-8bbb-${index.toString(16).padStart(12,'0')}`)) }));
    await assert.rejects(adapter.executePhase({ ...base, controlProgram: oversized }), { errorCode: 'runtime_control_limit' });
    const legacyDirectory = path.join(root, name + '-legacy'); await writeProject(adapter, plan(1), legacyDirectory);
    await assert.rejects(adapter.executePhase({ ...base, directory: legacyDirectory, controlProgram: program() }), { errorCode: 'runtime_control_unsupported' });
    await assert.rejects(fs.stat(calls), { code: 'ENOENT' }); assert.deepEqual(await inventory(directory), before);
  }
});

const real = { skip: !process.env.VIENTO_BEVY_BIN || !process.env.VIENTO_GODOT_BIN || process.platform !== 'linux', timeout: 60000 };
test('real engine replay drives repeated-definition instances in opposite directions with independent release and movement', real, async t => {
  const root = await temporary(t), value = plan(), controlProgram = program(), runs = [];
  for (const [name, adapter, executable] of [['godot', godot, process.env.VIENTO_GODOT_BIN], ['bevy', bevy, process.env.VIENTO_BEVY_BIN]]) {
    const directory = path.join(root, name), generated = await writeProject(adapter, value, directory), tool = await adapter.identify(executable);
    for (const phase of adapter.runtimePhases) {
      const checked = await adapter.executePhase({ phase, directory, tool }); assert.equal(checked.status, 'succeeded', checked.stdout + checked.stderr);
    }
    // Godot's import phase creates a runtime.gd.uid cache beside the source.
    // Replay must preserve both the original generated bytes and that cache.
    for (const [file, bytes] of generated.files) assert.deepEqual(await fs.readFile(path.join(directory,file)), bytes);
    const before = await inventory(directory);
    const events = adapter.createEventReader(value), trace = createSceneControlTraceReader(value, controlProgram, { onRuntime: line => events.push(line) });
    const result = await adapter.executePhase({ phase: 'run', directory, tool, controlProgram,
      onOutput: output => { if (output.stream === 'stdout') trace.push(output.text); } });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, value), []);
    const traced = trace.finish(); events.finish(); assert.deepEqual(traced.diagnostics, []); assert.deepEqual(events.diagnostics, []);
    assert.equal(traced.samples.length, 5); assert.equal(new Set(value.actors.map(actor => actor.objectId)).size, 1);
    assert.deepEqual(traced.samples[0].actors.slice(0,2).map(actor => actor.position), [[220,220],[490,220]]);
    assert.deepEqual(traced.samples[1].actors.slice(0,2).map(actor => actor.position), [[220,200],[490,220]]);
    assert.equal(traced.samples[1].actors[0].state, 'moving'); assert.equal(traced.samples[1].actors[1].state, 'idle');
    assert.equal(traced.samples[3].actors[0].state, 'idle'); assert.equal(traced.samples[3].actors[1].state, 'moving');
    assert.ok(traced.samples.at(-1).actors.every(actor => actor.state === 'idle'));
    for (const sample of traced.samples) {
      assert.deepEqual(sample.actors[2].position, [600,300]); assert.equal(sample.actors[2].state, 'idle');
      assert.deepEqual(sample.actors[3].position, [400,500]); assert.equal(sample.actors[3].state, 'idle');
      assert.deepEqual(sample.actors.map(actor => actor.instanceId), [first,second,none,zero]);
    }
    assert.deepEqual(events.events.at(-1).actors, traced.samples.at(-1).actors); assert.equal(events.events.at(-1).fixedDelta, 0.125);
    assert.deepEqual(await inventory(directory), before);
    for (const file of ['control-program.json','control-runtime.gd','control.tscn']) await assert.rejects(fs.stat(path.join(directory, file)), { code: 'ENOENT' });
    runs.push({ samples: traced.samples, events: events.events });
  }
  for (let step = 0; step < controlProgram.steps.length; step++) for (let index = 0; index < value.actors.length; index++) {
    const a = runs[0].samples[step].actors[index], b = runs[1].samples[step].actors[index];
    assert.equal(a.instanceId, b.instanceId); assert.equal(a.objectId, b.objectId); assert.equal(a.state, b.state);
    assert.ok(a.position.every((coordinate, axis) => Math.abs(coordinate - b.position[axis]) <= 0.0001));
  }
  assert.deepEqual(runs[0].events.filter(event => event.event === 'state'), runs[1].events.filter(event => event.event === 'state'));
});

test('empty instance steps release all actors and explicit false rows give identical results', real, async t => {
  const root = await temporary(t), value = plan(), input = program();
  input.steps = [{ inputs: [row(first,false,true),row(second,true)] }, { inputs: [] }];
  const explicit = structuredClone(input); explicit.steps[1].inputs = [row(first),row(second)];
  for (const [name, adapter, executable] of [['godot', godot, process.env.VIENTO_GODOT_BIN], ['bevy', bevy, process.env.VIENTO_BEVY_BIN]]) {
    const directory = path.join(root,name); await writeProject(adapter,value,directory); const tool = await adapter.identify(executable);
    for (const phase of adapter.runtimePhases) assert.equal((await adapter.executePhase({ phase,directory,tool })).status,'succeeded');
    const results = [];
    for (const controlProgram of [input,explicit]) {
      const result = await adapter.executePhase({ phase:'run',directory,tool,controlProgram }); assert.equal(result.status,'succeeded',result.stdout+result.stderr);
      const trace = createSceneControlTraceReader(value,controlProgram); trace.push(result.stdout); const traced = trace.finish(); assert.deepEqual(traced.diagnostics,[]);
      assert.ok(traced.samples.at(-1).actors.every(actor => actor.state === 'idle')); results.push(traced.samples);
    }
    assert.deepEqual(results[0],results[1]);
  }
});
