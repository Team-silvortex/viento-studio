import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotProject, godotDiagnostics, createRuntimeEventReader } from '../backends/godot4-dispatch.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';

const root = new URL('../../', import.meta.url), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const goldens = await Promise.all([1, 2].map(version => fs.readFile(new URL(`./fixtures/scene-model/legacy-plan-v${version}.json`, import.meta.url), 'utf8').then(JSON.parse)));
const frozen = {
  'scripts/backends/godot4/physics-character-motion-runtime.gd': '82e745e373e76f66e3cd825c9763b5dd22365da5ffca0cfde0fd349c404f948c',
  'scripts/backends/godot4-physics-character-motion.mjs': '69e510c0f89e3b6d1526be11fec09c519bbe249b68a3db2ff874fc5c5ee9bcb8',
  'scripts/backends/godot4-physics-observation.mjs': 'a57cd89113f2088b577919b9b632470f8ebf2b565b39cf48074bbcf9e7368391',
  'scripts/backends/godot4/physics-observation-runtime.gd': 'dfac842adbec1822b2628c1484c48c97c3efa468c24952da5ab98ee96b5524f7',
  'scripts/backends/godot4/project-physics-observation-runtime.gd': '606bfa3df3ed047e34eb8a01bb1139d4d8fe5f42f5041eb28e00434736c473f7',
  'scripts/backends/godot4-physics-response.mjs': '4662812020b3f1aa513d32d9918b87a07648c6c55da382f7d1187fa7996b9de1',
  'scripts/backends/godot4/physics-response-runtime.gd': '34c26239d216d232e757dc2d1357fb2a60546a56e32a426da4930aca4838aa83',
  'scripts/backends/godot4/project-physics-runtime.gd': '1d81deea4b2b5549e705dbed4b0c9a3b07403bdde76bfedc3ce127fb652b2742',
  'scripts/backends/godot4-physics.mjs': '3131d66a627678956035fe9b9c7aaf1181f1cf91b36c9571d2e280d8b9b7db7b',
  'scripts/backends/godot4/physics-runtime.gd': '2f5749f32edf4bb2570f495752cfc93bd295a24df573b7ac8a10de34c8affecd',
  'scripts/backends/godot4.mjs': 'd42d385b5a6e62ff4aa91d00f6065bdd0cefbc7ddde55e08cf5e3c62060fff77',
  'scripts/backends/godot4-dispatch.mjs': 'ac0900a870def37b93a3cab3b095497389d48703cdcf577fe455cff83574bdbe',
  'scripts/backends/godot4-instances.mjs': '5530025ea8327c95db7f75605dd29e177036a232192fc4b1f2935c45d50c0a85',
  'scripts/backends/godot4/runtime.gd': '9a4af2ffd3662c8381851ddd830618137e5e20cce08493fe6523309e1cc2bdfd',
  'scripts/backends/godot4/runtime-v2.gd': 'f2637ad317e6c105cd20d51381d5edf12a6af16f879b9eaf69f201bfc4e91de8',
};
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-godot-adapter-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory;
}
async function fixture(t, { body } = {}) {
  const directory = await temporary(t), project = path.join(directory, 'generated ; literal $(not-a-shell)');
  const toolPath = path.join(directory, 'godot ; literal $(not-a-shell)'), calls = path.join(directory, 'calls.jsonl');
  await fs.mkdir(project);
  const script = `#!${process.execPath}\n` + (body || `const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))+'\\n');
if (process.argv[2] === '--version') console.log('4.7.2.stable.fixture');
else console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), warning: process.env.GODOT_SILENCE_ROOT_WARNING,
  data: process.env.XDG_DATA_HOME, config: process.env.XDG_CONFIG_HOME, cache: process.env.XDG_CACHE_HOME }));\n`);
  await fs.writeFile(toolPath, script, { mode: 0o700 });
  return { directory, project, toolPath, calls, tool: { executable: toolPath }, script };
}
const linux = { skip: process.platform !== 'linux' ? 'Godot execution adapter is enabled only on Linux' : false };

test('Godot descriptor and host contract are immutable, precise and independent of legacy build metadata', () => {
  assert.deepEqual(adapter.descriptor, { format: 'viento-execution-backend', schemaVersion: 1,
    id: 'org.viento.godot4', label: 'Godot 4', version: '0.36.0', platforms: ['linux'],
    plans: [{ kind: 'scene2d', schemaVersion: 1, runtimeProtocolVersion: 1 }, { kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }, { kind: 'scene2d', schemaVersion: 3, runtimeProtocolVersion: 3 }, { kind: 'project', schemaVersion: 1, runtimeProtocolVersion: 11 }],
    capabilities: ['runtime.audio-requests', 'runtime.animation-requests', 'runtime.execution-frames', 'runtime.execution-clock', 'physics.platform-events2d', 'physics.platform-motion2d', 'physics.character-drop-through2d', 'physics.character-contacts2d', 'physics.one-way-platform2d', 'physics.character-events2d', 'physics.character-motion2d', 'physics.observe2d', 'physics.bodies2d', 'physics.character2d', 'physics.sensors2d', 'physics.character-slide2d', 'scene2d', 'input.arrows', 'state.movement', 'image', 'behavior.bindings', 'behavior.gdscript', 'runtime.control-replay', 'runtime.control-replay.instances', 'audio.nonspatial', 'audio.timeline', 'project.scenes', 'project.scene-switching', 'project.shared-state', 'project.events', 'project.audio-control', 'project.animation-control', 'project.animation-completion', 'project.animation-state-snapshots', 'project.animation-state-entries', 'project.animation-state-entry-triggers', 'animation.visual2d', 'animation.sprite2d', 'animation.clips2d', 'animation.instances2d'],
    execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] });
  assert.equal(adapter.contractVersion, 1); assert.equal(adapter.acceptsLegacyBuildRecords, true);
  assert.deepEqual(adapter.buildPhases, ['import', 'script-check']); assert.deepEqual(adapter.runtimePhases, ['import']);
  for (const value of [adapter, adapter.descriptor, adapter.descriptor.execution, adapter.descriptor.plans, ...adapter.descriptor.plans, adapter.buildPhases, adapter.runtimePhases]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { adapter.descriptor.execution.gpuCompute = true; }, TypeError);
  for (const operation of ['offscreenRender', 'embeddedViewport', 'gpuCompute']) assert.equal(checkExecutionBackendSupport(adapter.descriptor, { operation })[0].code, 'build_execution_unsupported');
});

test('adapter preserves frozen v1/v2 file hashes, source owner maps and generator fingerprints', async () => {
  for (const golden of goldens) {
    const before = structuredClone(golden.plan), direct = await generateGodotProject(golden.plan), generated = await adapter.generate(golden.plan);
    assert.deepEqual(golden.plan, before);
    assert.deepEqual(Object.fromEntries([...generated.files].map(([file, bytes]) => [file, hash(bytes)])), golden.godotFiles);
    assert.deepEqual(generated.sourceMap, golden.godotSourceMap); assert.deepEqual(generated.backend, direct.backend);
    if (golden.godotBackend) assert.deepEqual(generated.backend, golden.godotBackend);
    assert.deepEqual(generated.resourceFiles, generated.imageFiles); assert.notEqual(generated.resourceFiles, generated.imageFiles);
    assert.deepEqual(generated.artifact, { kind: 'godot-project', entry: 'project.godot', requiresTool: true });
    assert.equal(generated.resourceFiles.get(golden.ids.image), `images/${golden.ids.image}.svg`);
    assert.deepEqual(generated.files, direct.files); generated.resourceFiles.clear(); assert.equal(generated.imageFiles.size, 1);
  }
  for (const [file, expected] of Object.entries(frozen)) assert.equal(hash(await fs.readFile(new URL(file, root))), expected, `${file} remains frozen`);
});

test('generation owns an admitted plan before asynchronous reads and never shares source objects with its caller', async () => {
  const plan = structuredClone(goldens[0].plan), initial = structuredClone(plan), generated = adapter.generate(plan);
  plan.scene.title = 'changed after generation began'; plan.actors[0].position[0] = 999;
  const result = await generated;
  assert.deepEqual(Object.fromEntries([...result.files].map(([file, bytes]) => [file, hash(bytes)])), goldens[0].godotFiles);
  assert.deepEqual(result.sourceMap, goldens[0].godotSourceMap);
  result.sourceMap.scene.title = 'changed through the returned map';
  assert.equal(plan.scene.title, 'changed after generation began');
  assert.notEqual(result.sourceMap.scene, initial.scene);
});

test('generation rejects unsupported plan headers and required capabilities without rewriting author inputs', async () => {
  for (const [key, value, code] of [['schemaVersion', 4, 'build_backend_plan_unsupported'], ['kind', 'scene3d', 'build_backend_plan_unsupported'], ['requiredCapabilities', ['gpu.compute'], 'build_capability_missing']]) {
    const plan = { ...structuredClone(goldens[0].plan), [key]: value }, before = structuredClone(plan);
    await assert.rejects(adapter.generate(plan), { errorCode: code }); assert.deepEqual(plan, before);
  }
});

test('availability remains a non-executing stat/access check and identification retains Godot version pinning', linux, async t => {
  const f = await fixture(t), missing = { supported: true, available: false, reason: 'tool_missing' };
  assert.deepEqual(await adapter.availability({ toolPath: f.toolPath }), { supported: true, available: true, reason: null });
  await assert.rejects(fs.stat(f.calls), { code: 'ENOENT' }, 'availability did not execute the candidate');
  for (const toolPath of [undefined, 'relative', path.join(f.directory, 'absent'), f.project]) assert.deepEqual(await adapter.availability({ toolPath }), missing);
  await fs.chmod(f.toolPath, 0o600); assert.deepEqual(await adapter.availability({ toolPath: f.toolPath }), missing); await fs.chmod(f.toolPath, 0o700);
  for (const options of [{ enabled: false }, { platform: 'win32' }, { platform: 'darwin' }]) assert.deepEqual(await adapter.availability({ toolPath: f.toolPath, ...options }), { supported: false, available: false, reason: 'platform_unsupported' });
  assert.deepEqual(await adapter.availability({ toolPath: process.execPath }), { supported: true, available: true, reason: null });
  await assert.rejects(adapter.identify(process.execPath), { errorCode: 'build_tool_version' });
  const tool = await adapter.identify(f.toolPath);
  assert.equal(tool.executable, await fs.realpath(f.toolPath)); assert.equal(tool.version, '4.7.2.stable.fixture'); assert.equal(tool.sha256, hash(f.script));
  assert.equal(tool.platform, process.platform); assert.equal(tool.arch, process.arch);
  assert.deepEqual((await fs.readFile(f.calls, 'utf8')).trim().split('\n').map(JSON.parse), [['--version']]);
});

test('real spawned processes receive legacy Godot flags, literal arguments and isolated host paths', linux, async t => {
  const f = await fixture(t), output = [], source = path.join(f.directory, 'author.json'), text = '{"author":"must remain unchanged"}\n';
  await fs.writeFile(source, text);
  const capturePath = path.join(f.directory, 'capture ; literal $(not-a-shell).png');
  const cases = [
    [{ phase: 'import' }, ['--headless', '--editor', '--import']],
    [{ phase: 'script-check' }, ['--headless', '--script', 'res://runtime.gd', '--check-only']],
    [{ phase: 'run', mode: 'headlessLogic' }, ['--headless', '--', '--viento-smoke']],
    [{ phase: 'run', mode: 'headlessLogic', smoke: false }, ['--headless', '--']],
    [{ phase: 'run', mode: 'windowPreview' }, ['--', '--viento-smoke']],
    [{ phase: 'run', mode: 'windowPreview', smoke: false }, ['--']],
    [{ phase: 'run', mode: 'windowCapture', capturePath }, ['--', '--viento-smoke', `--viento-capture=${capturePath}`]],
  ];
  for (const [options, expected] of cases) {
    const result = await adapter.executePhase({ ...options, tool: f.tool, directory: f.project, onOutput: value => output.push(value) });
    assert.equal(result.status, 'succeeded', result.stderr); const observed = JSON.parse(result.stdout);
    assert.deepEqual(observed.args, ['--path', f.project, ...expected]); assert.equal(observed.cwd, f.project);
    assert.equal(observed.warning, '1'); assert.equal(observed.data, path.join(f.project, '.host/data'));
    assert.equal(observed.config, path.join(f.project, '.host/config')); assert.equal(observed.cache, path.join(f.project, '.host/cache'));
  }
  assert.equal((await fs.readFile(f.calls, 'utf8')).trim().split('\n').length, cases.length);
  assert.equal(await fs.readFile(source, 'utf8'), text); assert.ok(output.every(item => item.stream === 'stdout'));
});

test('unsupported modes and invalid capture combinations are rejected before any process starts', linux, async t => {
  const f = await fixture(t), base = { phase: 'run', tool: f.tool, directory: f.project }, capturePath = path.join(f.directory, 'preview.png');
  for (const mode of ['offscreenRender', 'embeddedViewport', 'gpuCompute', 'headless', '', null]) await assert.rejects(adapter.executePhase({ ...base, mode }), { errorCode: 'build_execution_unsupported' });
  for (const options of [{ phase: 'anything' }, { phase: undefined }]) await assert.rejects(adapter.executePhase({ ...base, ...options }), { errorCode: 'build_execution_unsupported' });
  for (const options of [
    { mode: 'headlessLogic', capturePath }, { mode: 'windowPreview', capturePath }, { mode: 'windowCapture' },
    { mode: 'windowCapture', smoke: false, capturePath }, { mode: 'windowCapture', capturePath: 'relative.png' },
    { mode: 'windowCapture', capturePath: '/tmp/nul\0.png' }, { phase: 'import', capturePath }, { phase: 'script-check', capturePath },
  ]) await assert.rejects(adapter.executePhase({ ...base, ...options }), { errorCode: 'runtime_capture_mode' });
  await assert.rejects(adapter.executePhase({ ...base, smoke: 1 }), { errorCode: 'runtime_mode_invalid' });
  await assert.rejects(adapter.executePhase({ ...base, tool: { executable: 'relative' } }), { errorCode: 'build_tool_required' });
  await assert.rejects(adapter.executePhase({ ...base, directory: 'relative' }), { errorCode: 'build_output_invalid' });
  await assert.rejects(fs.stat(f.calls), { code: 'ENOENT' });
});

test('phase execution delegates cancellation, deadlines and observer failures to the shared process owner', linux, async t => {
  const f = await fixture(t, { body: 'console.log("started");setInterval(()=>{},1000);\n' });
  const controller = new AbortController(); controller.abort();
  assert.equal((await adapter.executePhase({ phase: 'run', tool: f.tool, directory: f.project, signal: controller.signal })).status, 'cancelled');
  const running = new AbortController();
  const cancelled = await adapter.executePhase({ phase: 'run', tool: f.tool, directory: f.project, signal: running.signal, onOutput: () => running.abort() });
  assert.equal(cancelled.status, 'cancelled'); assert.match(cancelled.stdout, /started/);
  assert.equal((await adapter.executePhase({ phase: 'run', tool: f.tool, directory: f.project, timeoutMs: 100 })).status, 'timeout');
  const failed = await adapter.executePhase({ phase: 'import', tool: f.tool, directory: f.project, onOutput() { throw new Error('observer failed'); } });
  assert.equal(failed.status, 'observer-failed');
});

test('diagnostics and event readers retain v1/v2 source ownership and reject redirected runtime locations', () => {
  for (const golden of goldens) {
    const plan = golden.plan, result = { status: 'failed', stdout: '', stderr: `ERROR: Cannot load ${golden.ids.image}` };
    assert.deepEqual(adapter.diagnostics(result, plan), godotDiagnostics(result, plan));
    const protocols = [adapter.createEventReader(plan), createRuntimeEventReader(plan)];
    const actors = plan.actors.map(actor => ({ ...(actor.instanceId ? { instanceId: actor.instanceId } : {}), objectId: actor.objectId, position: actor.position, state: 'idle' }));
    const frames = [{ protocol: plan.schemaVersion, event: 'ready', sceneObjectId: plan.scene.objectId, actors },
      { protocol: plan.schemaVersion, event: 'diagnostic', severity: 'error', code: 'fake', message: 'Untrusted', sourcePath: '/etc/passwd' }];
    for (const reader of protocols) { reader.push(frames.map(frame => `VIENTO_RUNTIME:${JSON.stringify(frame)}\n`).join('')); reader.finish(); }
    assert.deepEqual(protocols[0].events, protocols[1].events); assert.deepEqual(protocols[0].diagnostics, protocols[1].diagnostics);
    assert.equal(protocols[0].events[0].event, 'ready'); assert.ok(protocols[0].diagnostics.some(value => value.code === 'runtime_protocol_invalid'));
    assert.ok(protocols[0].diagnostics.every(value => value.sourcePath !== '/etc/passwd'));
  }
});

test('cleanup removes only known generated caches and never follows their links into source data', async t => {
  const directory = await temporary(t), project = path.join(directory, 'project'), author = path.join(directory, 'author');
  await fs.mkdir(project); await fs.mkdir(author); await fs.writeFile(path.join(author, 'keep.json'), '{"keep":true}');
  await fs.mkdir(path.join(project, '.godot')); await fs.writeFile(path.join(project, '.godot/cache'), 'discard');
  await fs.symlink(author, path.join(project, '.host'), 'dir');
  for (const file of ['project.godot', 'runtime.gd', 'scene.json', '.host-backup']) await fs.writeFile(path.join(project, file), file);
  await adapter.cleanupProject(project); await adapter.cleanupProject(project);
  assert.deepEqual((await fs.readdir(project)).sort(), ['.host-backup', 'project.godot', 'runtime.gd', 'scene.json']);
  assert.equal(await fs.readFile(path.join(author, 'keep.json'), 'utf8'), '{"keep":true}');
  const link = path.join(directory, 'project-link'); await fs.symlink(project, link, 'dir');
  await assert.rejects(adapter.cleanupProject(link), { errorCode: 'build_output_invalid' });
});

test('execution fingerprint covers adapter, shared capability contract and host registry separately from historical generators', async () => {
  const files = ['engine/project-event-positions.mjs', 'engine/project-queued-requests.mjs', 'engine/project-audio-requests.mjs', 'scripts/backends/godot4-audio-requests.mjs', 'scripts/backends/godot4/audio-request-emitter.gd', 'engine/project-animation-requests.mjs', 'scripts/backends/godot4-animation-requests.mjs', 'scripts/backends/godot4/animation-request-emitter.gd', 'scripts/backends/godot4-execution-clock.mjs', 'scripts/backends/godot4/execution-clock-host.gd', 'scripts/backends/godot4/execution-clock-budget.gd', 'engine/project-execution-clock.mjs', 'engine/project-execution-frames.mjs', 'scripts/backends/godot4-execution-frames.mjs', 'scripts/backends/godot4/execution-frame-emitter.gd', 'scripts/backends/godot4-execution-budget.mjs', 'scripts/backends/godot4/project-execution-budget.gd', 'engine/project-execution-budget.mjs', 'scripts/backends/godot4-physics-platform-events.mjs', 'scripts/backends/godot4/physics-platform-events-helper.gd', 'scripts/backends/godot4/physics-platform-events-port.gd', 'scripts/backends/godot4/physics-platform-events-scene.gd', 'scripts/backends/godot4-physics-platform-motion.mjs', 'scripts/backends/godot4/physics-platform-motion-helper.gd', 'scripts/backends/godot4-physics-drop-through.mjs', 'scripts/backends/godot4/physics-drop-through-bridge.gd', 'scripts/backends/godot4/physics-drop-through-helper.gd', 'scripts/backends/godot4/physics-drop-through-port.gd', 'scripts/backends/godot4-physics-movement-contacts.mjs', 'scripts/backends/godot4/physics-movement-contacts-helper.gd', 'scripts/backends/godot4/physics-planar-contacts-runtime.gd', 'scripts/backends/godot4-physics-character-contacts.mjs', 'scripts/backends/godot4/physics-character-contacts-helper.gd', 'scripts/backends/godot4/physics-character-contacts-port.gd', 'scripts/backends/godot4-physics-one-way.mjs', 'scripts/backends/godot4/physics-one-way-helper.gd', 'scripts/backends/godot4-physics-character-events.mjs', 'scripts/backends/godot4/physics-character-events-scene.gd', 'scripts/backends/godot4/physics-character-events-port.gd', 'scripts/backends/godot4-physics-character-motion.mjs', 'scripts/backends/godot4/physics-character-motion-runtime.gd', 'scripts/backends/godot4-physics-observation.mjs', 'scripts/backends/godot4/physics-observation-runtime.gd', 'scripts/backends/godot4/project-physics-observation-runtime.gd', 'scripts/backends/godot4-physics-response.mjs', 'scripts/backends/godot4/physics-response-runtime.gd', 'scripts/backends/godot4-physics.mjs', 'scripts/backends/godot4/physics-runtime.gd', 'scripts/backends/godot4/project-physics-runtime.gd', 'engine/scene-physics2d.mjs', 'engine/scene-physics2d-core.mjs', 'scripts/backends/godot4/project-animation-target-runtime.gd', 'scripts/backends/godot4/project-animation-targets.gd', 'scripts/backends/godot4/project-animation-target-completions.gd', 'scripts/backends/godot4/project-animation-target-scene.gd', 'engine/project-animation-targets.mjs', 'scripts/backends/godot4/project-animation-state-trigger-runtime.gd', 'scripts/backends/godot4/project-animation-state-trigger-wrapper.gd', 'scripts/backends/godot4/project-animation-state-entry-runtime.gd', 'scripts/backends/godot4/project-animation-state-entry-wrapper.gd', 'engine/project-animation-state-entries.mjs', 'engine/project-animation-state-entry-triggers.mjs', 'scripts/backends/godot4/project-animation-state-runtime.gd', 'engine/project-animation-states.mjs', 'engine/animation-state-script-source.mjs', 'engine/animation-state-table-core.mjs', 'engine/animation-state-conditions-core.mjs', 'engine/animation-state-branches-core.mjs', 'engine/godot-animation-state-script.mjs', 'engine/godot-animation-state-conditions-script.mjs', 'engine/godot-animation-branches-script.mjs', 'engine/godot-animation-selectors-script.mjs', 'engine/animation-state-selectors-core.mjs', 'engine/godot-animation-combinations-script.mjs', 'engine/animation-state-combinations-core.mjs', 'scripts/backends/godot4/project-completion-runtime.gd', 'scripts/backends/godot4/project-animation-completions.gd', 'scripts/backends/godot4/project-animation-completion-scene.gd', 'engine/project-animation-completions.mjs', 'scripts/backends/godot4-clip-animation.mjs', 'scripts/backends/godot4/project-clip-runtime.gd', 'scripts/backends/godot4/project-animation-clips.gd', 'scripts/backends/godot4/project-animation-clip-scene.gd', 'engine/project-animation-transport.mjs', 'scripts/backends/godot4-sprite-animation.mjs', 'scripts/backends/godot4/animation-sprite-runtime.gd', 'scripts/backends/godot4-animation.mjs', 'scripts/backends/godot4/animation-runtime.gd', 'engine/scene-animation.mjs', 'engine/scene-animation-core.mjs', 'engine/scene-behavior-events.mjs', 'engine/scene-runtime-events.mjs', 'scripts/backends/godot4-adapter.mjs', 'engine/backend-capabilities.mjs', 'scripts/adapters/node-execution-backends.mjs',
    'scripts/backends/godot4-behaviors.mjs', 'scripts/backends/godot4/behavior-runtime.gd', 'engine/scene-behaviors.mjs', 'engine/build-plan.mjs', 'engine/scene-control-program.mjs',
    'scripts/backends/godot4/control-runtime.gd', 'scripts/backends/godot4/control.tscn',
    'scripts/backends/godot4-audio.mjs', 'scripts/backends/godot4/audio-runtime.gd', 'engine/scene-audio-events.mjs', 'engine/scene-audio-core.mjs', 'engine/scene-audio.mjs',
    'engine/studio-core.mjs', 'engine/studio-core.wasm', 'scripts/lib/audio-wav.mjs', 'engine/audio-wav.mjs', 'scripts/backends/godot4-project.mjs',
    'engine/project-assembly-plan.mjs', 'engine/project-assembly-plan-contract.mjs', 'engine/project-assembly.mjs', 'engine/build-target.mjs',
    'engine/project-runtime-contracts.mjs', 'engine/project-runtime-events.mjs', 'engine/project-physics2d-trace.mjs', 'engine/project-shared-state.mjs', 'engine/project-event-bus.mjs', 'engine/project-animation-commands.mjs', 'engine/project-audio-commands.mjs', 'scripts/backends/godot4/project-control-runtime.gd', 'scripts/backends/godot4/project-animation.gd', 'scripts/backends/godot4/project-animation-scene.gd', 'scripts/backends/godot4/project-runtime.gd', 'scripts/backends/godot4/project-scene.gd', 'scripts/backends/godot4/project-events.gd', 'scripts/backends/godot4/project-audio.gd'];
  const identities = await Promise.all(files.map(async file => ({ path: file, sha256: hash(await fs.readFile(new URL(file, root))) })));
  const fingerprint = await adapter.fingerprint();
  assert.deepEqual(fingerprint, { id: adapter.descriptor.id, contractVersion: 1, sha256: hash(JSON.stringify(identities)) });
  for (const file of ['scripts/backends/godot4-physics-platform-events.mjs', 'scripts/backends/godot4/physics-platform-events-helper.gd', 'scripts/backends/godot4/physics-platform-events-port.gd', 'scripts/backends/godot4/physics-platform-events-scene.gd', 'scripts/backends/godot4-physics-platform-motion.mjs', 'scripts/backends/godot4/physics-platform-motion-helper.gd', 'scripts/backends/godot4-physics-drop-through.mjs', 'scripts/backends/godot4/physics-drop-through-bridge.gd', 'scripts/backends/godot4/physics-drop-through-helper.gd', 'scripts/backends/godot4/physics-drop-through-port.gd', 'scripts/backends/godot4-physics-movement-contacts.mjs', 'scripts/backends/godot4/physics-movement-contacts-helper.gd', 'scripts/backends/godot4/physics-planar-contacts-runtime.gd', 'scripts/backends/godot4-physics-character-contacts.mjs', 'scripts/backends/godot4/physics-character-contacts-helper.gd', 'scripts/backends/godot4/physics-character-contacts-port.gd', 'scripts/backends/godot4-physics-one-way.mjs', 'scripts/backends/godot4/physics-one-way-helper.gd', 'scripts/backends/godot4-physics-character-events.mjs', 'scripts/backends/godot4/physics-character-events-scene.gd', 'scripts/backends/godot4/physics-character-events-port.gd', 'scripts/backends/godot4-physics-character-motion.mjs', 'scripts/backends/godot4/physics-character-motion-runtime.gd', 'scripts/backends/godot4-physics-observation.mjs', 'scripts/backends/godot4/physics-observation-runtime.gd', 'scripts/backends/godot4/project-physics-observation-runtime.gd', 'engine/project-physics2d-trace.mjs', 'scripts/backends/godot4-physics-response.mjs', 'scripts/backends/godot4/physics-response-runtime.gd', 'scripts/backends/godot4-physics.mjs', 'scripts/backends/godot4/physics-runtime.gd', 'scripts/backends/godot4/project-physics-runtime.gd', 'engine/scene-physics2d.mjs', 'engine/scene-physics2d-core.mjs', 'scripts/backends/godot4/project-animation-target-runtime.gd', 'scripts/backends/godot4/project-animation-targets.gd', 'scripts/backends/godot4/project-animation-target-completions.gd', 'scripts/backends/godot4/project-animation-target-scene.gd', 'engine/project-animation-targets.mjs', 'engine/godot-animation-selectors-script.mjs', 'engine/animation-state-selectors-core.mjs', 'engine/godot-animation-combinations-script.mjs', 'engine/animation-state-combinations-core.mjs']) {
    assert.equal(identities.filter(identity => identity.path === file).length, 1);
    assert.notEqual(fingerprint.sha256, hash(JSON.stringify(identities.filter(identity => identity.path !== file))));
  }
  assert.deepEqual(await adapter.fingerprint(), await adapter.fingerprint());
  assert.notEqual((await adapter.fingerprint()).sha256, goldens[1].godotBackend.sha256);
  for (const [file, expected] of Object.entries(frozen)) assert.equal(hash(await fs.readFile(new URL(file, root))), expected);
});
