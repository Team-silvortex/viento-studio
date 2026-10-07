import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { BEVY_EXECUTION_ADAPTER as adapter } from '../backends/bevy-adapter.mjs';
import { BEVY_RUNTIME_IDENTITY } from '../backends/bevy-project.mjs';
import { validateGeneratedExecutionProject } from '../adapters/node-execution-backends.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixtures = await Promise.all([1, 2].map(version => fs.readFile(new URL(`./fixtures/scene-model/legacy-plan-v${version}.json`, import.meta.url), 'utf8').then(JSON.parse)));
function plan(version = 2) {
  const value = structuredClone(fixtures[version - 1].plan);
  value.resources = []; value.requiredCapabilities = value.requiredCapabilities.filter(item => item !== 'image');
  for (const actor of value.actors) delete actor.imageResourceId;
  return value;
}
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-bevy-adapter-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory;
}
async function fixture(t, body) {
  const directory = await temporary(t), project = path.join(directory, 'generated ; literal $(never-execute)'),
    toolPath = path.join(directory, 'bevy ; literal $(never-execute)'), calls = path.join(directory, 'calls.jsonl');
  await fs.mkdir(project);
  const script = `#!${process.execPath}\n` + (body || `const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))+'\\n');
if (process.argv[2] === '--version') console.log(${JSON.stringify(BEVY_RUNTIME_IDENTITY)});
else console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),data:process.env.XDG_DATA_HOME,config:process.env.XDG_CONFIG_HOME,cache:process.env.XDG_CACHE_HOME}));\n`);
  await fs.writeFile(toolPath, script, { mode: 0o700 }); return { directory, project, toolPath, tool: { executable: toolPath }, calls, script };
}
const linux = { skip: process.platform !== 'linux' ? 'Bevy adapter is enabled only on Linux' : false };

test('Bevy descriptor advertises only real headless v1/v2 operations and freezes its host contract', () => {
  assert.equal(adapter.descriptor.id, 'org.viento.bevy'); assert.equal(adapter.descriptor.version, '0.3.0');
  assert.deepEqual(adapter.descriptor.capabilities, ['scene2d', 'input.arrows', 'state.movement', 'runtime.control-replay', 'runtime.control-replay.instances']);
  assert.deepEqual(adapter.descriptor.plans, [1, 2].map(version => ({ kind: 'scene2d', schemaVersion: version, runtimeProtocolVersion: version })));
  assert.deepEqual(adapter.descriptor.execution, { build: true, headlessLogic: true, windowPreview: false, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false });
  assert.equal(adapter.acceptsLegacyBuildRecords, false); assert.deepEqual(adapter.buildPhases, ['scene-check']); assert.deepEqual(adapter.runtimePhases, []);
  for (const value of [adapter, adapter.descriptor, adapter.descriptor.execution, adapter.descriptor.plans, adapter.buildPhases, adapter.runtimePhases]) assert.ok(Object.isFrozen(value));
});

test('generated Bevy scenes contain runtime data only and keep author navigation in a detached host map', async () => {
  for (const version of [1, 2]) {
    const value = plan(version), before = structuredClone(value), generated = await adapter.generate(value), accepted = validateGeneratedExecutionProject(adapter, value, generated);
    assert.deepEqual(value, before); assert.deepEqual([...accepted.files.keys()], ['scene-data.json']); assert.equal(accepted.resourceFiles.size, 0);
    assert.deepEqual(accepted.artifact, { kind: 'bevy-scene', entry: 'scene-data.json', requiresTool: true });
    const text = accepted.files.get('scene-data.json').toString(), runtime = JSON.parse(text);
    assert.equal(runtime.format, 'viento-bevy-scene'); assert.equal(runtime.schemaVersion, version);
    assert.equal(runtime.actors.length, 2); assert.deepEqual(runtime.resources, []);
    assert.doesNotMatch(text, /sourcePath|sourceRevision|origin|fieldSources|PRIVATE_AUTHOR_BODY|declaration/);
    assert.equal(accepted.sourceMap.objects[0].sourcePath, value.actors[0].sourcePath);
    assert.equal(accepted.sourceMap.objects[0].declaration.propertyPath, value.actors[0].declaration.propertyPath);
    if (version === 2) assert.equal(new Set(runtime.actors.map(actor => actor.objectId)).size, 1);
    assert.equal(generated.backend.protocolVersion, version); assert.match(generated.backend.sha256, /^[a-f0-9]{64}$/);
  }
});

test('generation admits a private snapshot before async reads and treats literal user strings as JSON data', async () => {
  const value = plan(); value.scene.title = 'Scene " ; $(not-shell) 🦊'; const before = structuredClone(value);
  const pending = adapter.generate(value); value.scene.title = 'Mutated'; value.actors[0].position[0] = 999;
  const generated = await pending, runtime = JSON.parse(generated.files.get('scene-data.json'));
  assert.equal(runtime.scene.title, before.scene.title); assert.deepEqual(runtime.actors[0].position, before.actors[0].position);
  generated.sourceMap.scene.title = 'Changed map'; assert.equal(value.scene.title, 'Mutated');
});

test('images, behavior plans and incompatible capabilities are rejected before generation including stripped image tokens', async () => {
  await assert.rejects(adapter.generate(fixtures[1].plan), { errorCode: 'build_capability_missing' });
  const bypass = structuredClone(fixtures[1].plan); bypass.requiredCapabilities = bypass.requiredCapabilities.filter(item => item !== 'image');
  await assert.rejects(adapter.generate(bypass), { errorCode: 'build_capability_missing' });
  for (const change of [{ schemaVersion: 3 }, { requiredCapabilities: ['gpu.compute'] }, { kind: 'scene3d' }]) {
    await assert.rejects(adapter.generate({ ...plan(), ...change }), error => ['build_backend_plan_unsupported', 'build_capability_missing'].includes(error.errorCode));
  }
});

test('invalid paired identities, dimensions and resource filename authority cannot reach the runtime artifact', async () => {
  const changes = [
    value => { value.actors[0].instanceId = '../escape'; },
    value => { value.actors[1].instanceId = value.actors[0].instanceId; },
    value => { value.actors[0].speed = -1; },
    value => { value.actors[0].controls = 'shell'; },
    value => { value.scene.viewport = [0, 480]; },
    value => { value.actors[0].position = [NaN, 0]; },
    value => { value.actors[0] = null; },
    value => { value.actors = []; },
  ];
  for (const change of changes) { const value = plan(); change(value); await assert.rejects(adapter.generate(value)); }
  const v1 = plan(1); v1.actors[0].instanceId = fixtures[1].ids.instances[0]; await assert.rejects(adapter.generate(v1), { errorCode: 'build_backend_plan_invalid' });
});

test('availability never executes tools, while identify pins exact runtime, Bevy version and executable bytes', linux, async t => {
  const f = await fixture(t);
  assert.deepEqual(await adapter.availability({ toolPath: f.toolPath }), { supported: true, available: true, reason: null });
  await assert.rejects(fs.stat(f.calls), { code: 'ENOENT' });
  for (const toolPath of [undefined, 'relative', f.project, path.join(f.directory, 'absent')]) assert.equal((await adapter.availability({ toolPath })).available, false);
  assert.equal((await adapter.availability({ toolPath: f.toolPath, platform: 'android' })).supported, false);
  const identified = await adapter.identify(f.toolPath); assert.equal(identified.executable, await fs.realpath(f.toolPath));
  assert.equal(identified.version, BEVY_RUNTIME_IDENTITY); assert.equal(identified.sha256, hash(f.script));
  await fs.writeFile(f.toolPath, `#!${process.execPath}\nconsole.log('viento-bevy-runtime 0.1.0 bevy 0.18.0');\n`);
  await assert.rejects(adapter.identify(f.toolPath), { errorCode: 'build_tool_version' });
  await assert.rejects(adapter.identify(process.execPath), { errorCode: 'build_tool_version' });
});

test('Bevy-specific check/run arguments remain literal and host paths stay inside generated project', linux, async t => {
  const f = await fixture(t), observed = [];
  const cases = [ [{ phase: 'scene-check' }, ['--check']], [{ phase: 'run' }, ['--smoke']], [{ phase: 'run', smoke: false }, []] ];
  for (const [options, suffix] of cases) {
    const result = await adapter.executePhase({ ...options, tool: f.tool, directory: f.project, onOutput: value => observed.push(value) });
    assert.equal(result.status, 'succeeded'); const output = JSON.parse(result.stdout);
    assert.deepEqual(output.args, ['--scene', path.join(f.project, 'scene-data.json'), ...suffix]); assert.equal(output.cwd, f.project);
    assert.equal(output.data, path.join(f.project, '.host/data')); assert.equal(output.config, path.join(f.project, '.host/config')); assert.equal(output.cache, path.join(f.project, '.host/cache'));
  }
  assert.ok(observed.every(item => item.stream === 'stdout'));
});

test('unsupported mode, phase, capture, relative tool and output requests fail before a process is created', linux, async t => {
  const f = await fixture(t), base = { phase: 'run', tool: f.tool, directory: f.project };
  for (const mode of ['windowPreview', 'windowCapture', 'offscreenRender', 'embeddedViewport', 'gpuCompute', 'headless', null]) {
    await assert.rejects(adapter.executePhase({ ...base, mode }), { errorCode: 'build_execution_unsupported' });
  }
  await assert.rejects(adapter.executePhase({ ...base, phase: 'cargo-build' }), { errorCode: 'build_execution_unsupported' });
  await assert.rejects(adapter.executePhase({ ...base, capturePath: '/tmp/capture.png' }), { errorCode: 'runtime_capture_mode' });
  await assert.rejects(adapter.executePhase({ ...base, smoke: 1 }), { errorCode: 'runtime_mode_invalid' });
  await assert.rejects(adapter.executePhase({ ...base, tool: { executable: 'relative' } }), { errorCode: 'build_tool_required' });
  await assert.rejects(adapter.executePhase({ ...base, directory: 'relative' }), { errorCode: 'build_output_invalid' });
  await assert.rejects(fs.stat(f.calls), { code: 'ENOENT' });
});

test('shared process ownership handles cancellation, deadlines and failed observers for Bevy', linux, async t => {
  const f = await fixture(t, 'console.log("started");setInterval(()=>{},1000);\n');
  const base = { phase: 'run', tool: f.tool, directory: f.project };
  const controller = new AbortController(); controller.abort(); assert.equal((await adapter.executePhase({ ...base, signal: controller.signal })).status, 'cancelled');
  const running = new AbortController(); assert.equal((await adapter.executePhase({ ...base, signal: running.signal, onOutput: () => running.abort() })).status, 'cancelled');
  assert.equal((await adapter.executePhase({ ...base, timeoutMs: 100 })).status, 'timeout');
  assert.equal((await adapter.executePhase({ ...base, onOutput() { throw new Error('failed observer'); } })).status, 'observer-failed');
});

test('resource diagnostics from the check phase resolve only frozen source identities and reject forged author paths', () => {
  const value = plan(), actor = value.actors[0];
  const frames = [
    { protocol: 2, event: 'diagnostic', severity: 'error', code: 'runtime_scene_invalid', message: 'Invalid scene.', instanceId: actor.instanceId, objectId: actor.objectId },
    { protocol: 2, event: 'diagnostic', severity: 'error', code: 'fake', message: 'Redirect', sourcePath: '/etc/passwd' },
  ];
  const output = frames.map(item => 'VIENTO_RUNTIME:' + JSON.stringify(item) + '\n').join('');
  const diagnostics = adapter.diagnostics({ status: 'failed', stdout: output, stderr: '', phase: 'scene-check' }, value);
  assert.equal(diagnostics.length, 3); assert.equal(diagnostics[0].instanceId, actor.instanceId);
  assert.equal(diagnostics[0].sourcePath, actor.declaration.sourcePath); assert.equal(diagnostics[0].propertyPath, actor.declaration.propertyPath);
  assert.ok(diagnostics.every(item => item.sourcePath !== '/etc/passwd'));
  assert.deepEqual(adapter.diagnostics({ status: 'succeeded', stdout: output, stderr: '', phase: 'run' }, value), [], 'run frames belong to the shared event owner only');
});

test('cleanup removes only owned host cache paths and cannot follow them into author data', async t => {
  const directory = await temporary(t), project = path.join(directory, 'project'), author = path.join(directory, 'author');
  await fs.mkdir(project); await fs.mkdir(author); await fs.writeFile(path.join(author, 'keep.txt'), 'keep');
  await fs.symlink(author, path.join(project, '.host'), 'dir'); await fs.writeFile(path.join(project, 'scene-data.json'), '{}');
  await adapter.cleanupProject(project); assert.deepEqual(await fs.readdir(project), ['scene-data.json']);
  assert.equal(await fs.readFile(path.join(author, 'keep.txt'), 'utf8'), 'keep');
  const link = path.join(directory, 'link'); await fs.symlink(project, link, 'dir');
  await assert.rejects(adapter.cleanupProject(link), { errorCode: 'build_output_invalid' });
});

test('execution fingerprints cover the packaged implementation without depending on unbundled Rust checkout files', async () => {
  const files = ['scripts/backends/bevy-adapter.mjs', 'scripts/backends/bevy-project.mjs', 'engine/scene-runtime-events.mjs',
    'engine/scene-control-program.mjs', 'engine/build-plan.mjs', 'engine/backend-capabilities.mjs', 'scripts/adapters/node-execution-backends.mjs'];
  const identities = await Promise.all(files.map(async file => ({ path: file, sha256: hash(await fs.readFile(new URL(`../../${file}`, import.meta.url))) })));
  assert.deepEqual(await adapter.fingerprint(), { id: 'org.viento.bevy', contractVersion: 1, sha256: hash(JSON.stringify(identities)) });
});

test('real Bevy App/ECS runtime checks and runs both legacy and paired-instance scene plans', { skip: !process.env.VIENTO_BEVY_BIN ? 'Set VIENTO_BEVY_BIN to test the real pinned runtime' : linux.skip }, async t => {
  const directory = await temporary(t), tool = await adapter.identify(process.env.VIENTO_BEVY_BIN);
  for (const version of [1, 2]) {
    const value = plan(version), generated = await adapter.generate(value), project = path.join(directory, String(version));
    await fs.mkdir(project); for (const [file, bytes] of generated.files) await fs.writeFile(path.join(project, file), bytes);
    const checked = await adapter.executePhase({ phase: 'scene-check', tool, directory: project });
    assert.equal(checked.status, 'succeeded', checked.stderr + checked.stdout); assert.deepEqual(adapter.diagnostics(checked, value), []);
    const reader = adapter.createEventReader(value), result = await adapter.executePhase({ phase: 'run', tool, directory: project,
      onOutput: output => { if (output.stream === 'stdout') reader.push(output.text); } });
    assert.equal(result.status, 'succeeded', result.stderr + result.stdout);
    const runtime = reader.finish(); assert.deepEqual(runtime.diagnostics, []);
    assert.equal(runtime.events[0].event, 'ready'); const finished = runtime.events.at(-1); assert.equal(finished.event, 'finished'); assert.equal(finished.fixedDelta, 0.25);
    for (const actor of value.actors) {
      const final = finished.actors.find(item => version === 2 ? item.instanceId === actor.instanceId : item.objectId === actor.objectId);
      assert.deepEqual(final.position, [actor.position[0] + (actor.controls === 'arrows' ? actor.speed * 0.25 : 0), actor.position[1]]);
    }
    const source = path.join(project, 'scene-data.json'), bad = JSON.parse(await fs.readFile(source, 'utf8')); bad.actors[0].position[0] = 100001;
    await fs.writeFile(source, JSON.stringify(bad)); const failed = await adapter.executePhase({ phase: 'scene-check', tool, directory: project });
    assert.equal(failed.status, 'failed');
    const diagnostics = adapter.diagnostics(failed, value);
    assert.ok(diagnostics.some(item => item.code === 'build_process_failed' && item.sourcePath === value.scene.sourcePath));
  }
});
