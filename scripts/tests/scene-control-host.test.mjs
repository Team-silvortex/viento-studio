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
const fakeTool = { executable: '/trusted/host/tool', version: 'test-host', sha256: 'a'.repeat(64), platform: process.platform, arch: process.arch };
const released = () => ({ left: false, right: false, up: false, down: false });
const program = () => ({ format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.25,
  steps: [{ ...released(), right: true }, released(), { ...released(), up: true }, released()] });
const phaseResult = (phase, status = 'succeeded') => ({ phase, status, exitCode: status === 'succeeded' ? 0 : 1, stdout: '', stderr: '' });
const gate = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) }; };
async function fixture(t, count = 2) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-control-host-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'workspace'), output = path.join(base, 'build'), cacheRoot = path.join(base, 'cache');
  await fs.cp(path.join(app, 'examples/bevy-headless'), root, { recursive: true });
  if (count !== 2) {
    const file = path.join(root, 'documents/scenes/demo.json'), scene = JSON.parse(await fs.readFile(file));
    scene.actors = Array.from({ length: count }, (_, i) => ({ ...scene.actors[0], instanceId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(i + 1).padStart(12, '0')}` }));
    await fs.writeFile(file, JSON.stringify(scene, null, 2) + '\n');
  }
  return { base, root, output, cacheRoot };
}
async function inventory(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name); result[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return result;
}
function registry({ execute, capability = true, availability } = {}) {
  const descriptor = { ...BEVY_EXECUTION_ADAPTER.descriptor,
    capabilities: [...new Set([...BEVY_EXECUTION_ADAPTER.descriptor.capabilities.filter(item => item !== 'runtime.control-replay'), ...(capability ? ['runtime.control-replay'] : [])])] };
  return createExecutionBackendRegistry([{ ...BEVY_EXECUTION_ADAPTER, descriptor,
    availability: availability || (async () => ({ supported: true, available: true, reason: null })), identify: async () => ({ ...fakeTool }),
    async executePhase(context) {
      if (context.phase !== 'run') return phaseResult(context.phase);
      const scene = JSON.parse(await fs.readFile(path.join(context.directory, 'scene-data.json')));
      const actors = scene.actors.map(actor => ({ ...(actor.instanceId ? { instanceId: actor.instanceId } : {}), objectId: actor.objectId, position: [...actor.position], state: 'idle' }));
      const frames = [], emit = (frame, prefix = 'VIENTO_RUNTIME:') => frames.push(`${prefix}${JSON.stringify(frame)}\n`);
      const flush = () => { const text = frames.join(''); frames.length = 0; context.onOutput({ stream: 'stdout', text }); };
      const ready = () => emit({ protocol: scene.schemaVersion, event: 'ready', sceneObjectId: scene.scene.objectId, actors });
      const sample = (stepIndex, patch = {}) => emit({ format: 'viento-runtime-trace', schemaVersion: 1, protocolVersion: scene.schemaVersion,
        event: 'sample', stepIndex, actors: actors.map((actor, index) => ({ ...actor, position: index === 0 ? [210 + stepIndex * 10, 220] : [...actor.position] })), ...patch }, 'VIENTO_TRACE:');
      const state = value => emit({ protocol: scene.schemaVersion, event: 'state', ...(actors[0].instanceId ? { instanceId: actors[0].instanceId } : {}), objectId: actors[0].objectId, state: value });
      const finished = (position = [210 + ((context.controlProgram?.steps.length || 1) - 1) * 10, 220]) => emit({ protocol: scene.schemaVersion,
        event: 'finished', actors: actors.map((actor, index) => ({ ...actor, position: index === 0 ? position : [...actor.position] })), fixedDelta: context.controlProgram?.fixedDelta || 0.25 });
      if (execute) return execute({ ...context, scene, actors, emit, flush, ready, sample, state, finished });
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
  assert.fail('Finite control job did not settle.');
}
async function builtService(value) {
  await value.command({ action: 'build', sceneId }); const state = await settled(value); assert.equal(state.job.status, 'succeeded', JSON.stringify(state)); return state;
}
const absent = file => assert.rejects(fs.stat(file), { code: 'ENOENT' });

test('control host rejects malformed programs and unsupported modes before touching build paths', async () => {
  for (const controlProgram of [null, {}, { ...program(), fixedDelta: 0 }, { ...program(), sourcePath: '/tmp/author' }, { ...program(), steps: [released(), { ...released(), right: true }] }]) {
    const result = await runProjectBuild({ buildDirectory: '/missing/build', tool: fakeTool.executable, controlProgram });
    assert.equal(result.diagnostics[0].code, 'runtime_control_invalid'); assert.equal(result.record, undefined);
  }
  for (const patch of [{ headless: false }, { smoke: false }, { capture: true }, { headless: 'true' }, { smoke: 1 }, { capture: 0 }]) {
    const result = await runProjectBuild({ buildDirectory: '/missing/build', controlProgram: program(), ...patch });
    assert.equal(result.diagnostics[0].code, 'runtime_control_mode');
  }
  let read = false; const getter = Object.defineProperty({}, 'format', { enumerable: true, get() { read = true; return 'viento-runtime-control'; } });
  const result = await runProjectBuild({ buildDirectory: '/missing/build', controlProgram: getter });
  assert.equal(result.diagnostics[0].code, 'runtime_control_invalid'); assert.equal(read, false);
});

test('control host streams one-chunk ordered samples and persists detached control identity without modifying authors or the frozen artifact', async t => {
  const h = await fixture(t), authors = await inventory(h.root), backendRegistry = await build(h), frozen = await inventory(h.output);
  const input = program(), expected = program(), updates = [];
  const running = runProjectBuild({ buildDirectory: h.output, backendRegistry, tool: fakeTool.executable, controlProgram: input,
    onProgress(event) {
      if (event.runtime) { updates.push([event.runtime.phase, event.runtime.control.completedSteps]); event.runtime.actors[0].position = [-1, -1]; }
      if (event.controlSample) event.controlSample.actors[0].position[0] = -1;
      if (event.event) event.event.protocol = 999;
      if (event.output) event.output.text = 'VIENTO_TRACE:tampered\n';
    } });
  input.fixedDelta = 0.125; input.steps[0].right = false; input.steps.length = 1;
  const result = await running; assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(updates, [['waiting', 0], ['ready', 0], ['ready', 1], ['ready', 2], ['ready', 3], ['ready', 4], ['finished', 4]]);
  assert.deepEqual(result.record.control.program, expected); assert.equal(result.record.control.sha256, `sha256:${buildHash(canonicalJson(expected))}`);
  assert.equal(result.record.control.samples.length, 4); assert.deepEqual(result.record.runtime.actors[0].position, [240, 220]);
  assert.ok(result.record.events.every(frame => frame.protocol === 2)); assert.equal(result.record.runtime.control.completedSteps, 4);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.sessionDirectory, 'session.json'))).control, result.record.control);
  await absent(path.join(result.sessionDirectory, 'project')); assert.deepEqual(await inventory(h.root), authors);
  const after = await inventory(h.output); for (const [file, hash] of Object.entries(frozen)) assert.equal(after[file], hash);
  const plain = await runProjectBuild({ buildDirectory: h.output, backendRegistry, tool: fakeTool.executable });
  assert.equal(plain.ok, true); assert.equal(plain.record.control, undefined); assert.equal(plain.record.runtime.control, undefined);
});

test('malformed, duplicate, premature and incomplete traces fail while retaining admitted positions; failed or timed out replay keeps its last sample', async t => {
  for (const kind of ['duplicate', 'foreign', 'wrong-finish', 'missing', 'failed', 'timeout', 'throw']) {
    const h = await fixture(t), backendRegistry = registry({ execute({ ready, sample, finished, flush }) {
      ready(); sample(0); flush();
      if (kind === 'duplicate') { sample(0); finished(); }
      else if (kind === 'foreign') { sample(1, { actors: [{ objectId: sceneId, position: [0, 0], state: 'idle' }] }); }
      else if (kind === 'wrong-finish') { sample(1); sample(2); sample(3); finished([999, 999]); }
      else if (kind === 'throw') throw new Error('Trusted host failure.');
      flush(); return phaseResult('run', ['failed', 'timeout'].includes(kind) ? kind : 'succeeded');
    } });
    await build(h, backendRegistry);
    const result = await runProjectBuild({ buildDirectory: h.output, backendRegistry, tool: fakeTool.executable, controlProgram: program() });
    assert.equal(result.ok, false, kind); assert.equal(result.status, kind === 'timeout' ? 'timeout' : 'failed', kind);
    assert.equal(result.record.runtime.phase, 'ready', kind); assert.deepEqual(result.record.runtime.actors[0].position, kind === 'wrong-finish' ? [240, 220] : [210, 220], kind);
    assert.equal(result.record.runtime.actors[0].positionSample, 'control', kind);
    assert.equal(result.record.control.samples.length, kind === 'wrong-finish' ? 4 : 1, kind);
    if (['duplicate', 'foreign', 'wrong-finish', 'missing'].includes(kind)) assert.ok(result.record.diagnostics.some(item => item.code === 'runtime_control_trace_invalid'), kind);
    await absent(path.join(result.sessionDirectory, 'project'));
  }
});

test('service control admission rejects extra authority, foreign builds, invalid programs, modes and absent capabilities without acquiring the job slot', async t => {
  const h = await fixture(t), value = service(t, h), built = await builtService(value);
  const request = { action: 'run', buildId: built.latestBuild.id, mode: 'headless', controlProgram: program() };
  for (const patch of [{ tool: '/tmp/tool' }, { backendId }, { controlProgramPath: '/tmp/input' }, { output: '/tmp/output' }, { controlProgram: { ...program(), script: '/tmp/author.rs' } }]) {
    await assert.rejects(value.command({ ...request, ...patch }), { errorCode: patch.controlProgram ? 'runtime_control_invalid' : 'build_request_invalid' });
  }
  await assert.rejects(value.command({ ...request, mode: 'window' }), { errorCode: 'runtime_control_mode' });
  await assert.rejects(value.command({ ...request, buildId: sceneId }), { errorCode: 'build_artifact_missing' });
  const foreign = service(t, h); await assert.rejects(foreign.command(request), { errorCode: 'build_artifact_missing' });
  assert.equal((await value.status()).job.id, built.job.id);
  const deniedRoot = await fixture(t), denied = service(t, deniedRoot, { backendRegistry: registry({ capability: false }) });
  const deniedBuild = await builtService(denied);
  await assert.rejects(denied.command({ ...request, buildId: deniedBuild.latestBuild.id }), { errorCode: 'runtime_control_unsupported' });
  assert.equal((await denied.status()).job.id, deniedBuild.job.id);
});

test('service detaches programs at request entry and retains bounded trace/object observations through raw-event rotation and cancellation', async t => {
  const h = await fixture(t), running = gate();
  const backendRegistry = registry({ async execute({ ready, sample, state, flush, signal }) {
    ready(); sample(0); for (let i = 0; i < 260; i++) state(i % 2 ? 'idle' : 'moving'); flush(); running.resolve();
    await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
    return phaseResult('run', 'cancelled');
  } });
  const value = service(t, h, { backendRegistry }), built = await builtService(value), input = program();
  const promise = value.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless', controlProgram: input });
  input.steps[0].right = false; input.steps.length = 1;
  const started = await promise; await running.promise;
  const state = await value.status(); assert.equal(state.job.events.length, 128); assert.equal(state.job.control.samples.length, 1);
  assert.equal(state.job.control.program.steps.length, 4); assert.equal(state.job.control.program.steps[0].right, true);
  const view = await value.command({ action: 'inspect', jobId: started.job.id });
  assert.equal(view.control.completedSteps, 1); assert.equal(view.actors[0].positionSample, 'control'); assert.equal(view.actors[0].positionStep, 0);
  assert.deepEqual(view.actors[0].position, [210, 220]); assert.equal(view.actors[0].positionCurrent, false);
  state.job.control.samples[0].actors[0].position[0] = -1; view.actors[0].position[0] = -1;
  await value.command({ action: 'cancel', jobId: started.job.id }); const ended = await settled(value);
  assert.equal(ended.job.status, 'cancelled'); assert.equal(ended.job.runtime.phase, 'ready'); assert.equal(ended.job.runtime.control.completedSteps, 1);
  assert.deepEqual(ended.job.control.samples[0].actors[0].position, [210, 220]);
  assert.ok(!ended.job.diagnostics.some(item => item.code === 'runtime_control_trace_invalid'));
  const recordFile = (await fs.readdir(h.cacheRoot, { recursive: true })).find(file => file.endsWith('/session.json'));
  const record = JSON.parse(await fs.readFile(path.join(h.cacheRoot, recordFile))); assert.deepEqual(record.control, ended.job.control);
  await absent(path.join(h.cacheRoot, path.dirname(recordFile), 'project'));
});

test('combined object-step sample limits are rejected before process/session allocation or service job replacement', async t => {
  const h = await fixture(t, 17), backendRegistry = await build(h), before = await inventory(h.output);
  const over = { ...program(), fixedDelta: 0.125, steps: Array.from({ length: 64 }, released) };
  const result = await runProjectBuild({ buildDirectory: h.output, backendRegistry, tool: fakeTool.executable, controlProgram: over });
  assert.equal(result.diagnostics[0].code, 'runtime_control_limit'); assert.equal(result.record, undefined);
  assert.deepEqual(await inventory(h.output), before); await absent(path.join(h.output, 'sessions'));
  const value = service(t, h), built = await builtService(value);
  await assert.rejects(value.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless', controlProgram: over }), { errorCode: 'runtime_control_limit' });
  assert.equal((await value.status()).job.id, built.job.id);
});
