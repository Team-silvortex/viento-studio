import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { BEVY_EXECUTION_ADAPTER as adapter } from '../backends/bevy-adapter.mjs';

const tool = { executable: process.execPath, version: 'test-host', sha256: 'a'.repeat(64), platform: process.platform, arch: process.arch };
const released = () => ({ left: false, right: false, up: false, down: false });
const program = () => ({ format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125,
  steps: [{ ...released(), right: true }, released()] });
const result = (phase, status = 'succeeded') => ({ phase, status, exitCode: status === 'succeeded' ? 0 : 1, stdout: '', stderr: '' });
async function fixture(t, mode) {
  const f = await projectAssemblyAuthor(t, { entry: 'audio' });
  for (const id of f.sceneIds) {
    const meta = path.join(f.author, `metadata/documents/${id}.json`), data = JSON.parse(await fs.readFile(meta));
    data.relations = data.relations.filter(item => item.kind === 'reference'); await fs.writeFile(meta, JSON.stringify(data));
    const file = path.join(f.author, data.sourcePath), scene = JSON.parse(await fs.readFile(file));
    for (const actor of scene.actors) delete actor.imageResourceId;
    await fs.writeFile(file, JSON.stringify(scene));
  }
  await fs.rm(path.join(f.author, 'metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json'));
  await fs.rm(path.join(f.author, 'metadata/documents/88888888-8888-4888-8888-888888888888.json'));
  const registry = createExecutionBackendRegistry([{ ...adapter, identify: async () => ({ ...tool }),
    async executePhase(context) {
      if (context.phase !== 'run') return result(context.phase);
      assert.equal(context.targetKind, 'project');
      const scene = JSON.parse(await fs.readFile(path.join(context.directory, 'scene-data.json')));
      const actors = scene.actors.map(a => ({ ...(a.instanceId ? { instanceId: a.instanceId } : {}), objectId: a.objectId, position: [...a.position], state: 'idle' }));
      const send = (prefix, frame) => context.onOutput({ stream: 'stdout', text: `${prefix}${JSON.stringify(frame)}\n` });
      const runtime = frame => send('VIENTO_RUNTIME:', { protocol: scene.schemaVersion, ...frame });
      const sample = index => send('VIENTO_TRACE:', { format: 'viento-runtime-trace', schemaVersion: 1, protocolVersion: scene.schemaVersion, event: 'sample', stepIndex: index, actors });
      runtime({ event: 'ready', sceneObjectId: scene.scene.objectId, actors });
      sample(0);
      if (mode === 'throw') throw new Error('Disconnected.');
      if (mode === 'cancelled' || mode === 'timeout') return result('run', mode);
      if (mode === 'duplicate') sample(0);
      sample(1);
      runtime({ event: 'finished', actors: mode === 'wrong' ? actors.map(a => ({ ...a, position: [999, 999] })) : actors,
        fixedDelta: context.controlProgram.fixedDelta });
      if (mode === 'late-trace') sample(1);
      if (mode === 'late-runtime') runtime({ event: 'state', ...(actors[0].instanceId ? { instanceId: actors[0].instanceId } : {}), objectId: actors[0].objectId, state: 'idle' });
      if (mode === 'truncated') context.onOutput({ stream: 'stdout', text: 'VIENTO_TRACE:{' });
      return result('run', mode === 'terminal-fail' ? 'failed' : 'succeeded');
    } }]);
  const built = await buildProject({ root: f.author, scene: f.assemblyId, output: path.join(f.temporary, 'build'),
    backendId: 'org.viento.bevy', backendRegistry: registry, tool: tool.executable });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  return { ...f, directory: built.buildDirectory, registry };
}
for (const mode of ['success', 'duplicate', 'wrong', 'cancelled', 'timeout', 'throw', 'late-trace', 'late-runtime', 'truncated', 'terminal-fail']) {
  test(`Bevy project entry replay preserves validated evidence and ${mode} status`, async t => {
    const f = await fixture(t, mode), progress = [];
    const run = await runProjectBuild({ buildDirectory: f.directory, tool: tool.executable, backendRegistry: f.registry,
      controlProgram: program(), onProgress: event => { if (event.runtime) progress.push(event.runtime); } });
    assert.equal(run.status, mode === 'success' ? 'succeeded' : ['cancelled', 'timeout'].includes(mode) ? mode : 'failed', JSON.stringify(run));
    assert.equal(run.record.control.samples.length, ['cancelled', 'timeout', 'throw'].includes(mode) ? 1 : 2);
    assert.equal(run.record.runtime.project.visits[0].sceneId, f.entrySceneId);
    assert.equal(run.record.lifecycle.completed, mode === 'success');
    assert.equal(run.record.runtime.control.completedSteps, ['cancelled', 'timeout', 'throw'].includes(mode) ? 1 : 2);
    if (mode === 'success') {
      assert.equal(run.record.events.at(-1).totalSeconds, 0.25);
      assert.equal(run.record.runtime.project.visits[0].elapsedSeconds, 0.25);
      assert.deepEqual(progress.filter(view => view.control).map(view => view.control.completedSteps).filter((x, i, a) => i === 0 || x !== a[i-1]), [0, 1, 2]);
    } else assert.equal(run.record.events.some(item => item.event === 'finished'), false);
    if (['duplicate', 'wrong', 'late-trace', 'late-runtime', 'truncated'].includes(mode)) assert.ok(run.record.diagnostics.some(item => item.code === 'runtime_control_trace_invalid'));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(run.sessionDirectory, 'session.json'))).control, run.record.control);
    await assert.rejects(fs.stat(path.join(run.sessionDirectory, 'project')), { code: 'ENOENT' });
  });
}

test('project control replay snapshots caller-owned nested program before asynchronous build reads', async t => {
  const f = await fixture(t, 'success'), input = program(), expected = structuredClone(input);
  const pending = runProjectBuild({ buildDirectory: f.directory, tool: tool.executable, backendRegistry: f.registry, controlProgram: input });
  input.fixedDelta = 0.25;
  input.steps[0].right = false;
  input.steps.length = 1;
  const run = await pending;
  assert.equal(run.ok, true, JSON.stringify(run.diagnostics || run.record?.diagnostics));
  assert.deepEqual(run.record.control.program, expected);
  assert.equal(run.record.control.samples.length, 2);
  assert.equal(run.record.events.at(-1).totalSeconds, 0.25);
});
