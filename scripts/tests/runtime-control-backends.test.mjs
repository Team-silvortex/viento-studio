import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { BEVY_EXECUTION_ADAPTER as bevy } from '../backends/bevy-adapter.mjs';
import { GODOT4_EXECUTION_ADAPTER as godot } from '../backends/godot4-adapter.mjs';
import { createSceneControlTraceReader } from '../../engine/scene-control-program.mjs';

const fixtures = await Promise.all([1, 2].map(version => fs.readFile(new URL(`./fixtures/scene-model/legacy-plan-v${version}.json`, import.meta.url), 'utf8').then(JSON.parse)));
const hash = value => createHash('sha256').update(value).digest('hex');
const input = (left = false, right = false, up = false, down = false) => ({ left, right, up, down });
const program = () => ({ format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125,
  steps: [input(false, true), input(false, false, true), input(true), input(false, false, false, true),
    input(false, true, true), input(true, true, true, true), input()] });
function plan(version) {
  const value = structuredClone(fixtures[version - 1].plan);
  value.resources = []; value.requiredCapabilities = value.requiredCapabilities.filter(capability => capability !== 'image');
  for (const actor of value.actors) delete actor.imageResourceId;
  // Use the two repeated-definition instances at separate positions with their
  // own speed; the legacy protocol has two distinct definition identities.
  value.actors[0].position = [200, 220]; value.actors[0].speed = 160;
  value.actors[1].position = [500, 220]; value.actors[1].speed = 80;
  return value;
}
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-control-backends-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory;
}
async function writeProject(adapter, value, directory) {
  const generated = await adapter.generate(value);
  await fs.mkdir(directory);
  for (const [file, bytes] of generated.files) {
    await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await fs.writeFile(path.join(directory, file), bytes);
  }
  return generated;
}
async function fake(t, adapter) {
  const root = await temporary(t), directory = path.join(root, 'project'), executable = path.join(root, 'tool'), calls = path.join(root, 'calls.jsonl');
  await fs.mkdir(directory);
  const scene = { schemaVersion: 2, actors: [{}] };
  await fs.writeFile(path.join(directory, adapter === bevy ? 'scene-data.json' : 'scene.json'), JSON.stringify(scene));
  await fs.writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');
fs.appendFileSync(${JSON.stringify(calls)},'run\\n');
console.log(JSON.stringify({args:process.argv.slice(2),control:JSON.parse(fs.readFileSync('control-program.json','utf8')),
wrapper:fs.existsSync('control-runtime.gd')?fs.readFileSync('control-runtime.gd','utf8'):null,
scene:fs.existsSync('control.tscn')?fs.readFileSync('control.tscn','utf8'):null}));\n`, { mode: 0o700 });
  return { root, directory, executable, calls, tool: { executable } };
}

test('both adapters expose finite control replay as a capability without adding execution modes', () => {
  for (const adapter of [bevy, godot]) {
    assert.ok(adapter.descriptor.capabilities.includes('runtime.control-replay'));
    assert.equal(Object.keys(adapter.descriptor.execution).length, 7);
    assert.equal(adapter.descriptor.execution.headlessLogic, true);
    assert.equal(adapter.descriptor.execution.gpuCompute, false);
  }
});

test('adapters stage only validated control data and trusted session wrappers, then remove staged files', { skip: process.platform !== 'linux' }, async t => {
  for (const adapter of [bevy, godot]) {
    const f = await fake(t, adapter), before = await fs.readdir(f.directory), value = program(), original = structuredClone(value);
    const pending = adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.tool, controlProgram: value });
    value.steps[0].right = false;
    const result = await pending; assert.equal(result.status, 'succeeded', result.stderr);
    const actual = JSON.parse(result.stdout); assert.deepEqual(actual.control, original);
    if (adapter === bevy) {
      assert.deepEqual(actual.args, ['--scene', path.join(f.directory, 'scene-data.json'), '--smoke', '--control-program', path.join(f.directory, 'control-program.json')]);
      assert.equal(actual.wrapper, null); assert.equal(actual.scene, null);
    } else {
      assert.deepEqual(actual.args, ['--path', f.directory, '--headless', 'res://control.tscn', '--', '--viento-smoke']);
      assert.equal(hash(actual.wrapper), hash(await fs.readFile(new URL('../backends/godot4/control-runtime.gd', import.meta.url))));
      assert.equal(hash(actual.scene), hash(await fs.readFile(new URL('../backends/godot4/control.tscn', import.meta.url))));
    }
    assert.deepEqual(await fs.readdir(f.directory), before);
  }
});

test('control admission refuses unsafe modes, invalid DTOs, behavior plans and actor-step overflows before spawning', { skip: process.platform !== 'linux' }, async t => {
  for (const adapter of [bevy, godot]) {
    const f = await fake(t, adapter), base = { phase: 'run', directory: f.directory, tool: f.tool, controlProgram: program() };
    for (const options of [{ smoke: false }, { mode: 'windowPreview' }, { phase: adapter.buildPhases[0] }]) {
      await assert.rejects(adapter.executePhase({ ...base, ...options }), { errorCode: 'runtime_control_unsupported' });
    }
    for (const value of [{ ...program(), tool: '/author/tool' }, { ...program(), fixedDelta: 0 },
      { ...program(), steps: [input(false, true)] }]) {
      await assert.rejects(adapter.executePhase({ ...base, controlProgram: value }), { errorCode: 'runtime_control_invalid' });
    }
    const scenePath = path.join(f.directory, adapter === bevy ? 'scene-data.json' : 'scene.json');
    await fs.writeFile(scenePath, JSON.stringify({ schemaVersion: 3, actors: [{}] }));
    await assert.rejects(adapter.executePhase(base), { errorCode: 'runtime_control_unsupported' });
    await fs.writeFile(scenePath, JSON.stringify({ schemaVersion: 2, actors: Array(128).fill({}) }));
    const many = { ...program(), steps: Array.from({ length: 9 }, () => input()) };
    await assert.rejects(adapter.executePhase({ ...base, controlProgram: many }), { errorCode: 'runtime_control_limit' });
    await assert.rejects(fs.stat(f.calls), { code: 'ENOENT' });
    assert.equal((await fs.readdir(f.directory)).length, 1);
  }
});

test('session staging never overwrites or follows an existing control-file link', { skip: process.platform !== 'linux' }, async t => {
  for (const adapter of [bevy, godot]) {
    const f = await fake(t, adapter), author = path.join(f.root, 'author-control.json'), text = 'keep this author content';
    await fs.writeFile(author, text);
    await fs.symlink(author, path.join(f.directory, 'control-program.json'));
    await assert.rejects(adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.tool, controlProgram: program() }), { code: 'EEXIST' });
    assert.equal(await fs.readFile(author, 'utf8'), text);
    assert.equal((await fs.lstat(path.join(f.directory, 'control-program.json'))).isSymbolicLink(), true);
    for (const file of ['control.tscn', 'control-runtime.gd']) await assert.rejects(fs.stat(path.join(f.directory, file)), { code: 'ENOENT' });
    await assert.rejects(fs.stat(f.calls), { code: 'ENOENT' });
  }
});

test('controlled execution cleans trusted session files after cancellation or observer failure', { skip: process.platform !== 'linux' }, async t => {
  for (const adapter of [bevy, godot]) {
    const f = await fake(t, adapter), before = await fs.readdir(f.directory);
    await fs.writeFile(f.executable, `#!${process.execPath}\nconsole.log('started');setInterval(()=>{},1000);\n`, { mode: 0o700 });
    const signal = new AbortController();
    const cancelled = await adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.tool, controlProgram: program(),
      signal: signal.signal, onOutput() { signal.abort(); } });
    assert.equal(cancelled.status, 'cancelled'); assert.deepEqual(await fs.readdir(f.directory), before);
    const failed = await adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.tool, controlProgram: program(),
      onOutput() { throw new Error('Observer rejected output'); } });
    assert.equal(failed.status, 'observer-failed'); assert.deepEqual(await fs.readdir(f.directory), before);
  }
});

const real = { skip: !process.env.VIENTO_BEVY_BIN || !process.env.VIENTO_GODOT_BIN || process.platform !== 'linux', timeout: 60000 };
test('real Godot and Bevy replay v1/v2 arrow sequences with paired identities and normalized diagonal trajectories', real, async t => {
  const root = await temporary(t);
  for (const version of [1, 2]) {
    const value = plan(version), replay = program(), runs = [];
    for (const [name, adapter, executable] of [['godot', godot, process.env.VIENTO_GODOT_BIN], ['bevy', bevy, process.env.VIENTO_BEVY_BIN]]) {
      const directory = path.join(root, `${name}-${version}`), generated = await writeProject(adapter, value, directory), tool = await adapter.identify(executable);
      const before = Object.fromEntries(await Promise.all([...generated.files.keys()].map(async file => [file, hash(await fs.readFile(path.join(directory, file)))])));
      for (const phase of adapter.runtimePhases) {
        const result = await adapter.executePhase({ phase, directory, tool });
        assert.equal(result.status, 'succeeded', result.stderr + result.stdout); assert.deepEqual(adapter.diagnostics(result, value), []);
      }
      const events = adapter.createEventReader(value);
      const trace = createSceneControlTraceReader(value, replay, { onRuntime: line => events.push(line) });
      const result = await adapter.executePhase({ phase: 'run', directory, tool, controlProgram: replay,
        onOutput: output => { if (output.stream === 'stdout') trace.push(output.text); } });
      assert.equal(result.status, 'succeeded', result.stderr + result.stdout); assert.deepEqual(adapter.diagnostics(result, value), []);
      const samples = trace.finish(); events.finish();
      assert.deepEqual(events.diagnostics, []); assert.deepEqual(samples.diagnostics, []);
      assert.equal(samples.samples.length, 7);
      const last = events.events.at(-1); assert.equal(last.event, 'finished'); assert.equal(last.fixedDelta, 0.125);
      assert.deepEqual(last.actors, samples.samples.at(-1).actors);
      assert.deepEqual(Object.fromEntries(await Promise.all([...generated.files.keys()].map(async file => [file, hash(await fs.readFile(path.join(directory, file)))]))), before);
      for (const file of ['control-program.json', 'control-runtime.gd', 'control.tscn']) await assert.rejects(fs.stat(path.join(directory, file)), { code: 'ENOENT' });
      runs.push({ events: events.events, samples: samples.samples });
    }
    for (let step = 0; step < replay.steps.length; step++) {
      const left = runs[0].samples[step], right = runs[1].samples[step];
      assert.equal(left.stepIndex, right.stepIndex); assert.equal(left.protocolVersion, version);
      for (let actor = 0; actor < value.actors.length; actor++) {
        const a = left.actors[actor], b = right.actors[actor];
        assert.equal(a.objectId, b.objectId); assert.equal(a.instanceId, b.instanceId); assert.equal(a.state, b.state);
        // Godot Vector2 is f32; Bevy stores f64. Compare physical behavior with
        // the explicit 0.0001-unit tolerance, never promise byte equal floats.
        assert.ok(a.position.every((number, axis) => Math.abs(number - b.position[axis]) <= 0.0001), `${version}/${step}/${actor}: ${a.position} ~= ${b.position}`);
      }
    }
    assert.deepEqual(runs[0].samples[0].actors.map(actor => actor.position), [[220, 220], [510, 220]]);
    assert.deepEqual(runs[0].samples[1].actors.map(actor => actor.position), [[220, 200], [510, 210]]);
    assert.ok(runs[0].samples[5].actors.every(actor => actor.state === 'idle'));
    assert.deepEqual(runs[0].samples[5].actors, runs[0].samples[6].actors);
  }
});

test('real replay keeps none controls and zero-speed actors idle and preserves old default smoke behavior', real, async t => {
  const root = await temporary(t), value = plan(2), replay = program();
  value.actors[1].controls = 'none';
  const zero = structuredClone(value.actors[0]); zero.instanceId = '33333333-3333-4333-8333-333333333333'; zero.speed = 0;
  value.actors.push(zero);
  for (const [name, adapter, executable] of [['godot', godot, process.env.VIENTO_GODOT_BIN], ['bevy', bevy, process.env.VIENTO_BEVY_BIN]]) {
    const directory = path.join(root, name); await writeProject(adapter, value, directory); const tool = await adapter.identify(executable);
    for (const phase of adapter.runtimePhases) assert.equal((await adapter.executePhase({ phase, directory, tool })).status, 'succeeded');
    const reader = createSceneControlTraceReader(value, replay), result = await adapter.executePhase({ phase: 'run', directory, tool, controlProgram: replay });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr); reader.push(result.stdout);
    const traced = reader.finish(); assert.deepEqual(traced.diagnostics, []);
    for (const sample of traced.samples) {
      assert.deepEqual(sample.actors[1].position, value.actors[1].position); assert.equal(sample.actors[1].state, 'idle');
      assert.deepEqual(sample.actors[2].position, value.actors[2].position); assert.equal(sample.actors[2].state, 'idle');
    }
    const plain = await adapter.executePhase({ phase: 'run', directory, tool });
    assert.equal(plain.status, 'succeeded', plain.stdout + plain.stderr); assert.doesNotMatch(plain.stdout, /VIENTO_TRACE:/);
    const old = adapter.createEventReader(value); old.push(plain.stdout); old.finish(); assert.deepEqual(old.diagnostics, []);
    assert.deepEqual(old.events.at(-1).actors.map(actor => actor.position), [[240, 220], [500, 220], [200, 220]]);
    assert.equal(old.events.at(-1).fixedDelta, 0.25);
  }
});

test('Godot control replay inherits legacy image initialization without changing generated scene inventories', {
  skip: !process.env.VIENTO_GODOT_BIN || process.platform !== 'linux', timeout: 30000,
}, async t => {
  const root = await temporary(t), tool = await godot.identify(process.env.VIENTO_GODOT_BIN), replay = program();
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="48"><rect width="32" height="48" fill="#80d0a0"/></svg>');
  const resource = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', sha256: hash(bytes), size: bytes.length, extension: 'svg' };
  for (const version of [1, 2]) {
    const value = plan(version); value.resources = [resource]; value.requiredCapabilities.push('image');
    value.actors[0].imageResourceId = resource.id;
    const directory = path.join(root, String(version)), generated = await writeProject(godot, value, directory);
    const imageFile = path.join(directory, generated.imageFiles.get(resource.id));
    await fs.mkdir(path.dirname(imageFile)); await fs.writeFile(imageFile, bytes);
    for (const phase of godot.runtimePhases) {
      const result = await godot.executePhase({ phase, directory, tool });
      assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(godot.diagnostics(result, value), []);
    }
    const reader = createSceneControlTraceReader(value, replay), events = godot.createEventReader(value);
    const result = await godot.executePhase({ phase: 'run', directory, tool, controlProgram: replay });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(godot.diagnostics(result, value), []);
    reader.push(result.stdout); events.push(result.stdout); const trace = reader.finish(); events.finish();
    assert.deepEqual(trace.diagnostics, []); assert.deepEqual(events.diagnostics, []); assert.equal(trace.samples.length, 7);
    assert.deepEqual(events.events.at(-1).actors, trace.samples.at(-1).actors);
    assert.deepEqual(await fs.readFile(imageFile), bytes);
    for (const [file, original] of generated.files) assert.deepEqual(await fs.readFile(path.join(directory, file)), original);
  }
});
