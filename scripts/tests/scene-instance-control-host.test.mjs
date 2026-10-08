import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { BEVY_EXECUTION_ADAPTER } from '../backends/bevy-adapter.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';

const app = fileURLToPath(new URL('../../', import.meta.url));
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', backendId = 'org.viento.bevy';
const objectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const instances = ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'];
const unknown = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
// A real candidate path for stat-only discovery; execution is still injected.
const fakeTool = { executable: process.execPath, version: 'instance-host-test', sha256: 'a'.repeat(64), platform: process.platform, arch: process.arch };
const released = () => ({ left: false, right: false, up: false, down: false });
const row = (instanceId, direction) => ({ instanceId, ...released(), ...(direction ? { [direction]: true } : {}) });
const program = () => ({ format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.125,
  steps: [{ inputs: [row(instances[0], 'right'), row(instances[1], 'left')] }, { inputs: [row(instances[1], 'up')] },
    { inputs: [row(instances[0], 'left')] }, { inputs: [] }] });
const globalProgram = () => ({ format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125,
  steps: [{ ...released(), right: true }, released()] });
const phaseResult = (phase, status = 'succeeded') => ({ phase, status, exitCode: status === 'succeeded' ? 0 : 1, stdout: '', stderr: '' });
const gate = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) }; };
async function fixture(t, { version = 2, count = 2 } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-instance-control-host-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'workspace'), output = path.join(base, 'build'), cacheRoot = path.join(base, 'cache');
  await fs.cp(path.join(app, 'examples/bevy-headless'), root, { recursive: true });
  const file = path.join(root, 'documents/scenes/demo.json'), scene = JSON.parse(await fs.readFile(file));
  if (version === 1) { scene.schemaVersion = 1; scene.actors = [scene.actors[0]]; delete scene.actors[0].instanceId; }
  else if (count !== 2) scene.actors = Array.from({ length: count }, (_, i) => ({ ...scene.actors[0], instanceId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(i + 1).padStart(12, '0')}` }));
  await fs.writeFile(file, JSON.stringify(scene, null, 2) + '\n');
  return { base, root, output, cacheRoot, file };
}
async function inventory(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name); result[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return result;
}
function registry({ instanceCapability = true, execute } = {}) {
  const descriptor = { ...BEVY_EXECUTION_ADAPTER.descriptor,
    capabilities: [...new Set([...BEVY_EXECUTION_ADAPTER.descriptor.capabilities.filter(item => item !== 'runtime.control-replay.instances'),
      'runtime.control-replay', ...(instanceCapability ? ['runtime.control-replay.instances'] : [])])] };
  return createExecutionBackendRegistry([{ ...BEVY_EXECUTION_ADAPTER, descriptor,
    availability: async () => ({ supported: true, available: true, reason: null }), identify: async () => ({ ...fakeTool }),
    async executePhase(context) {
      if (context.phase !== 'run') return phaseResult(context.phase);
      const scene = JSON.parse(await fs.readFile(path.join(context.directory, 'scene-data.json')));
      const actors = scene.actors.map(actor => ({ ...(actor.instanceId ? { instanceId: actor.instanceId } : {}), objectId: actor.objectId, position: [...actor.position], state: 'idle' }));
      const frames = [], emit = (frame, prefix = 'VIENTO_RUNTIME:') => frames.push(`${prefix}${JSON.stringify(frame)}\n`);
      const flush = () => { const text = frames.join(''); frames.length = 0; context.onOutput({ stream: 'stdout', text }); };
      const ready = () => emit({ protocol: scene.schemaVersion, event: 'ready', sceneObjectId: scene.scene.objectId, actors });
      // These are fixed protocol fixtures, not a host-side movement simulator.
      const poses = [[[220, 220], [490, 220]], [[220, 220], [490, 210]], [[200, 220], [490, 210]], [[200, 220], [490, 210]]];
      const sampleActors = index => actors.map((actor, at) => ({ ...actor, position: poses[index][at],
        state: index === 0 || index === 1 && at === 1 || index === 2 && at === 0 ? 'moving' : 'idle' }));
      const sample = index => emit({ format: 'viento-runtime-trace', schemaVersion: 1, protocolVersion: scene.schemaVersion,
        event: 'sample', stepIndex: index, actors: sampleActors(index) }, 'VIENTO_TRACE:');
      const finished = () => emit({ protocol: scene.schemaVersion, event: 'finished',
        actors: context.controlProgram ? sampleActors(context.controlProgram.steps.length - 1) : actors, fixedDelta: context.controlProgram?.fixedDelta || 0.25 });
      if (execute) return execute({ ...context, ready, sample, finished, emit, flush, actors });
      ready(); if (context.controlProgram) context.controlProgram.steps.forEach((_, index) => sample(index)); finished(); flush(); return phaseResult('run');
    },
  }]);
}
async function build(h, backendRegistry = registry()) {
  const result = await buildProject({ root: h.root, scene: sceneId, backendId, backendRegistry, tool: fakeTool.executable, output: h.output });
  assert.equal(result.ok, true, JSON.stringify(result)); return backendRegistry;
}
function service(t, h, options = {}) {
  const value = createProjectBuildService(h.root, { backendId, backendRegistry: registry(), tool: fakeTool.executable, cacheRoot: h.cacheRoot, ...options });
  t.after(() => value.close()); return value;
}
async function settled(value) {
  for (let i = 0; i < 3000; i++) { const result = await value.status(); if (result.job?.status !== 'running') return result; await delay(5); }
  assert.fail('Instance control job did not settle.');
}
async function builtService(value) {
  await value.command({ action: 'build', sceneId }); const state = await settled(value); assert.equal(state.job.status, 'succeeded', JSON.stringify(state)); return state;
}

test('host detaches sparse instance programs and admits paired samples without touching authors or frozen outputs', async t => {
  const h = await fixture(t), authors = await inventory(h.root), backendRegistry = await build(h), frozen = await inventory(h.output);
  const input = program(), expected = program(), updates = [];
  const pending = runProjectBuild({ buildDirectory: h.output, backendRegistry, tool: fakeTool.executable, controlProgram: input,
    onProgress(event) {
      if (event.controlSample) { updates.push(event.controlSample.stepIndex); event.controlSample.actors[1].position[0] = -1; }
      if (event.runtime?.actors[0]?.position) event.runtime.actors[0].position[0] = -1;
    } });
  input.steps[0].inputs[0].instanceId = unknown; input.steps[1].inputs.length = 0; input.fixedDelta = 0.25;
  const result = await pending; assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(updates, [0, 1, 2, 3]);
  assert.deepEqual(result.record.control.program, expected); assert.equal(result.record.control.sha256, `sha256:${buildHash(canonicalJson(expected))}`);
  assert.deepEqual(result.record.control.samples[1].actors.map(actor => [actor.instanceId, actor.position, actor.state]),
    [[instances[0], [220, 220], 'idle'], [instances[1], [490, 210], 'moving']]);
  assert.deepEqual(result.record.runtime.actors.map(actor => actor.position), [[200, 220], [490, 210]]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.sessionDirectory, 'session.json'))).control, result.record.control);
  assert.deepEqual(await inventory(h.root), authors);
  const after = await inventory(h.output); for (const [file, hash] of Object.entries(frozen)) assert.equal(after[file], hash);
  await assert.rejects(fs.stat(path.join(result.sessionDirectory, 'project')), { code: 'ENOENT' });
});

test('host rejects foreign and definition IDs, instance replay on plan1 and absent capability before session or process allocation', async t => {
  for (const kind of ['foreign', 'definition', 'plan1', 'capability']) {
    const h = await fixture(t, { version: kind === 'plan1' ? 1 : 2 }); let executions = 0;
    const backendRegistry = registry({ instanceCapability: kind !== 'capability', execute() { executions++; return phaseResult('run'); } });
    await build(h, backendRegistry); const before = await inventory(h.output), input = program();
    if (kind === 'foreign' || kind === 'definition') input.steps[0].inputs[0].instanceId = kind === 'foreign' ? unknown : objectId;
    const result = await runProjectBuild({ buildDirectory: h.output, backendRegistry, tool: fakeTool.executable, controlProgram: input });
    assert.equal(result.diagnostics[0].code, ['foreign', 'definition'].includes(kind) ? 'runtime_control_target_missing' : 'runtime_control_unsupported', kind);
    assert.equal(result.record, undefined, kind); assert.equal(executions, 0, kind); assert.deepEqual(await inventory(h.output), before, kind);
  }
});

test('service rejects malformed, duplicate, foreign, definition and over-budget instance rows without replacing its owned job', async t => {
  const h = await fixture(t), value = service(t, h), built = await builtService(value);
  const request = { action: 'run', buildId: built.latestBuild.id, mode: 'headless', controlProgram: program() };
  const badPrograms = [
    [{ ...program(), steps: [{ inputs: [row(unknown)] }] }, 'runtime_control_target_missing', 422],
    [{ ...program(), steps: [{ inputs: [row(objectId)] }] }, 'runtime_control_target_missing', 422],
    [{ ...program(), steps: [{ inputs: [row(instances[0]), row(instances[0])] }] }, 'runtime_control_invalid', 400],
    [{ ...program(), steps: [{ inputs: [{ ...row(instances[0]), path: '/tmp/author' }] }] }, 'runtime_control_invalid', 400],
  ];
  const ids = Array.from({ length: 128 }, (_, i) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(i + 1).padStart(12, '0')}`);
  for (const count of [9, 11, 64]) badPrograms.push([
    { ...program(), steps: Array.from({ length: count }, () => ({ inputs: ids.map(id => row(id)) })) }, 'runtime_control_limit', 422]);
  let invoked = 0;
  const accessor = program();
  Object.defineProperty(accessor.steps[0].inputs[0], 'right', { enumerable: true, get() { invoked++; return true; } });
  badPrograms.push([accessor, 'runtime_control_invalid', 400]);
  for (const [controlProgram, errorCode, statusCode] of badPrograms) {
    await assert.rejects(value.command({ ...request, controlProgram }), { errorCode, statusCode });
    assert.equal((await value.status()).job.id, built.job.id);
  }
  assert.equal(invoked, 0);
  for (const patch of [{ controlProgramPath: '/tmp/program.json' }, { tool: '/tmp/tool' }, { backendId }, { output: '/tmp/output' }]) {
    await assert.rejects(value.command({ ...request, ...patch }), { errorCode: 'build_request_invalid', statusCode: 400 });
  }
  const foreignService = service(t, h); await assert.rejects(foreignService.command(request), { errorCode: 'build_artifact_missing' });
  assert.equal((await value.status()).job.id, built.job.id);
});

test('public control targets remain detached frozen-build facts despite later author edits and response mutations', async t => {
  const h = await fixture(t), value = service(t, h), built = await builtService(value);
  const expected = built.latestBuild.controlTargets;
  assert.equal(built.latestBuild.planSchemaVersion, 2); assert.equal(built.latestBuild.actorCount, 2);
  assert.deepEqual(expected.map(target => [target.instanceId, target.objectId]), instances.map(id => [id, objectId]));
  for (const target of expected) {
    assert.deepEqual(Object.keys(target).sort(), ['instanceId', 'name', 'objectId']); assert.ok(target.name.length <= 160);
  }
  built.latestBuild.controlTargets[0].instanceId = unknown;
  const authored = JSON.parse(await fs.readFile(h.file)); authored.actors[0].instanceId = unknown; await fs.writeFile(h.file, JSON.stringify(authored));
  const after = await value.status({ refresh: true }); assert.deepEqual(after.latestBuild.controlTargets, instances.map((id, index) => ({ ...expected[index], instanceId: id })));
  const input = program(); input.steps[0].inputs[0].instanceId = unknown;
  await assert.rejects(value.command({ action: 'run', buildId: after.latestBuild.id, mode: 'headless', controlProgram: input }), { errorCode: 'runtime_control_target_missing' });
  await value.command({ action: 'run', buildId: after.latestBuild.id, mode: 'headless', controlProgram: program() });
  const ended = await settled(value); assert.equal(ended.job.status, 'succeeded', JSON.stringify(ended));
  assert.deepEqual(ended.job.control.program, program()); assert.deepEqual(ended.job.runtime.actors.map(actor => actor.instanceId), instances);
});

test('service cancellation keeps independent same-definition samples and request identity after mutation and event-ring rotation', async t => {
  const h = await fixture(t), running = gate();
  const backendRegistry = registry({ async execute({ ready, sample, emit, flush, actors, signal }) {
    ready(); sample(0); sample(1); for (let i = 0; i < 260; i++) emit({ protocol: 2, event: 'state',
      instanceId: actors[0].instanceId, objectId: actors[0].objectId, state: i % 2 ? 'idle' : 'moving' });
    flush(); running.resolve(); await new Promise(resolve => signal.aborted ? resolve() : signal.addEventListener('abort', resolve, { once: true }));
    return phaseResult('run', 'cancelled');
  } });
  const value = service(t, h, { backendRegistry }), built = await builtService(value), input = program();
  const pending = value.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless', controlProgram: input });
  input.steps[0].inputs[0].instanceId = unknown; input.steps.length = 1;
  const started = await pending; await running.promise;
  const state = await value.status(); assert.equal(state.job.events.length, 128); assert.equal(state.job.control.samples.length, 2);
  assert.deepEqual(state.job.control.program, program());
  const view = await value.command({ action: 'inspect', jobId: started.job.id, instanceId: instances[1] });
  assert.equal(view.actors.length, 1); assert.deepEqual(view.actors[0].position, [490, 210]); assert.equal(view.actors[0].positionStep, 1);
  state.job.control.samples[1].actors[1].position[0] = -1; view.actors[0].position[0] = -1;
  await value.command({ action: 'cancel', jobId: started.job.id }); const ended = await settled(value);
  assert.equal(ended.job.status, 'cancelled'); assert.equal(ended.job.control.samples.length, 2);
  assert.deepEqual(ended.job.control.samples[1].actors[1].position, [490, 210]);
  assert.equal(ended.job.runtime.control.completedSteps, 2); assert.ok(!ended.job.diagnostics.some(item => item.code === 'runtime_control_trace_invalid'));
});

test('global replay and ordinary runs stay compatible when instance support or plan2 identities are absent', async t => {
  for (const version of [1, 2]) {
    const h = await fixture(t, { version }), value = service(t, h, { backendRegistry: registry({ instanceCapability: false }) });
    const built = await builtService(value); assert.equal(built.latestBuild.controlTargets, undefined);
    await assert.rejects(value.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless', controlProgram: program() }), { errorCode: 'runtime_control_unsupported', statusCode: 422 });
    assert.equal((await value.status()).job.id, built.job.id);
    await value.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless', controlProgram: globalProgram() });
    const replay = await settled(value); assert.equal(replay.job.status, 'succeeded', JSON.stringify(replay)); assert.equal(replay.job.control.program.schemaVersion, 1);
    await value.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless' });
    const plain = await settled(value); assert.equal(plain.job.status, 'succeeded'); assert.equal(plain.job.control, undefined); assert.equal(plain.job.runtime.control, undefined);
  }
});
