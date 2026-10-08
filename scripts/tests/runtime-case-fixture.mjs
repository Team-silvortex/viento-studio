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
export const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', backendId = 'org.viento.bevy';
export const objectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const instances = ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'];
export const unknown = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
// A real candidate path for stat-only discovery; execution is still injected.
export const fakeTool = { executable: process.execPath, version: 'instance-host-test', sha256: 'a'.repeat(64), platform: process.platform, arch: process.arch };
const released = () => ({ left: false, right: false, up: false, down: false });
const row = (instanceId, direction) => ({ instanceId, ...released(), ...(direction ? { [direction]: true } : {}) });
export const program = () => ({ format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.125,
  steps: [{ inputs: [row(instances[0], 'right'), row(instances[1], 'left')] }, { inputs: [row(instances[1], 'up')] },
    { inputs: [row(instances[0], 'left')] }, { inputs: [] }] });
export const globalProgram = () => ({ format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125,
  steps: [{ ...released(), right: true }, released()] });
export const phaseResult = (phase, status = 'succeeded') => ({ phase, status, exitCode: status === 'succeeded' ? 0 : 1, stdout: '', stderr: '' });
export const gate = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) }; };
export async function fixture(t, { version = 2, count = 2 } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-runtime-case-host-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'workspace'), output = path.join(base, 'build'), cacheRoot = path.join(base, 'cache');
  await fs.cp(path.join(app, 'examples/bevy-headless'), root, { recursive: true });
  const file = path.join(root, 'documents/scenes/demo.json'), scene = JSON.parse(await fs.readFile(file));
  if (version === 1) { scene.schemaVersion = 1; scene.actors = [scene.actors[0]]; delete scene.actors[0].instanceId; }
  else if (count !== 2) scene.actors = Array.from({ length: count }, (_, i) => ({ ...scene.actors[0], instanceId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(i + 1).padStart(12, '0')}` }));
  await fs.writeFile(file, JSON.stringify(scene, null, 2) + '\n');
  return { base, root, output, cacheRoot, file };
}
export async function inventory(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name); result[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return result;
}
export function registry({ instanceCapability = true, execute } = {}) {
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
export async function build(h, backendRegistry = registry()) {
  const result = await buildProject({ root: h.root, scene: sceneId, backendId, backendRegistry, tool: fakeTool.executable, output: h.output });
  assert.equal(result.ok, true, JSON.stringify(result)); return backendRegistry;
}
export function service(t, h, options = {}) {
  const value = createProjectBuildService(h.root, { backendId, backendRegistry: registry(), tool: fakeTool.executable, cacheRoot: h.cacheRoot, ...options });
  t.after(() => value.close()); return value;
}
export async function settled(value) {
  for (let i = 0; i < 3000; i++) { const result = await value.status(); if (result.job?.status !== 'running') return result; await delay(5); }
  assert.fail('Instance control job did not settle.');
}
export async function builtService(value) {
  await value.command({ action: 'build', sceneId }); const state = await settled(value); assert.equal(state.job.status, 'succeeded', JSON.stringify(state)); return state;
}

export const runtimeCase = () => ({ format: 'viento-runtime-case', schemaVersion: 1, program: program(), checks: [
  { instanceId: instances[0], stepIndex: 0, position: { value: [220, 220], tolerance: 0.0001 }, state: 'moving' },
  { instanceId: instances[0], stepIndex: 3, position: { value: [200, 220], tolerance: 0.0001 }, state: 'idle' },
  { instanceId: instances[1], stepIndex: 3, position: { value: [490, 210], tolerance: 0.0001 }, state: 'idle' },
] });
