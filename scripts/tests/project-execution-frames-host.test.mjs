import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAssemblyBuildFixture } from './helpers/project-assembly-backend-fixture.mjs';
import { enterScene, readyScene, exitScene } from './helpers/project-runtime-fixture.mjs';
import { createProjectFrameEncoder } from './helpers/project-execution-frames-fixture.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { runProjectBuild } from '../adapters/node-project-build.mjs';

async function fixture(t, mode = 'complete') {
  const f = await projectAssemblyBuildFixture(t), protocol = f.build.backend.protocolVersion;
  const plan = f.captured.plan, scene = plan.scenes.find(row => row.scene.objectId === plan.entrySceneId);
  const wrap = frame => ({ ...frame, protocol });
  const frames = [{ protocol, event: 'ready', assemblyId: plan.assembly.objectId, entrySceneId: plan.entrySceneId,
    stateRevision: 0, eventSequence: 0, audioCommandSequence: 0 }, wrap(enterScene(scene, 1)), wrap(readyScene(scene, 1)),
    wrap(exitScene(scene, 1, .5)), { protocol, event: 'finished', assemblyId: plan.assembly.objectId,
      visitCount: 1, totalSeconds: .5, stateRevision: 0, eventSequence: 0, audioCommandSequence: 0 }];
  let executed = false;
  const backendRegistry = createExecutionBackendRegistry([{ ...f.adapter,
    identify: async () => ({ ...f.build.tool, executable: process.execPath }),
    async executePhase(context) {
      if (context.phase === 'run') {
        executed = true;
        const encode = createProjectFrameEncoder();
        const text = frames.map((frame, index) => mode === 'bare' ? 'VIENTO_PROJECT:' + JSON.stringify(frame) + '\n'
          : encode(frame, { idleFrame: index + 10, physicsFrame: index + 20 })).join('');
        context.onOutput({ stream: 'stdout', text: mode === 'tail' ? text.slice(0, -1) : text });
      }
      return { status: 'succeeded', exitCode: 0, stdout: '', stderr: '', durationMs: 0 };
    },
  }]);
  return { ...f, frames, backendRegistry, executed: () => executed };
}
async function run(f, onProgress) {
  const result = await runProjectBuild({ buildDirectory: f.directory, tool: process.execPath,
    backendRegistry: f.backendRegistry, headless: true, smoke: false, onProgress });
  assert.ok(result.record, JSON.stringify(result));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.sessionDirectory, 'session.json'))), result.record);
  await assert.rejects(fs.stat(path.join(result.sessionDirectory, 'project')), { code: 'ENOENT' });
  return result;
}

test('exact execution positions persist after a final unterminated envelope and consumer mutations stay detached', async t => {
  const f = await fixture(t, 'tail'), views = [];
  const result = await run(f, event => {
    if (event.executionFrames) {
      views.push(structuredClone(event.executionFrames));
      if (event.executionFrames.frames[0]) event.executionFrames.frames[0].clock.idleFrame = -1;
      event.executionFrames.frames.length = 0;
    }
  });
  assert.equal(result.ok, true, JSON.stringify(result.record.diagnostics));
  assert.equal(result.record.executionFrames.phase, 'finished');
  assert.equal(result.record.executionFrames.totalFrames, 5);
  assert.deepEqual(result.record.events, f.frames);
  assert.deepEqual(result.record.lifecycle, { started: true, completed: true });
  assert.equal(result.record.eventRetention.total, 5);
  assert.deepEqual(result.record.executionFrames.frames.map(row => row.clock), f.frames.map((_, index) => ({ idleFrame: index + 10, physicsFrame: index + 20 })));
  assert.ok(views.some(view => view.phase === 'finished'));
});

for (const kind of ['position-consumer', 'business-consumer']) test(`${kind} failure preserves each admitted position exactly once`, async t => {
  const f = await fixture(t); let calls = 0;
  const result = await run(f, event => {
    if (kind === 'position-consumer' ? event.executionFrames?.totalFrames === 3 : event.event?.event === 'scene-event') {
      calls++; throw new Error('private execution position callback detail');
    }
  });
  assert.ok(calls >= 1); assert.equal(result.status, 'failed');
  assert.equal(result.record.executionFrames.phase, 'incomplete');
  assert.equal(result.record.executionFrames.totalFrames, 3);
  assert.deepEqual(result.record.executionFrames.frames.map(row => row.index), [1, 2, 3]);
  assert.deepEqual(result.record.events, f.frames.slice(0, 3));
  assert.equal(result.record.eventRetention.total, 3);
  assert.ok(result.record.diagnostics.some(row => row.code === 'build_failed'));
  assert.equal(JSON.stringify(result.record.diagnostics).includes('private execution position'), false);
});

test('an initial position notification failure saves an incomplete empty observation before execution', async t => {
  const f = await fixture(t);
  const result = await run(f, event => { if (event.executionFrames) throw new Error('initial position observer'); });
  assert.equal(result.status, 'failed'); assert.equal(f.executed(), false);
  assert.equal(result.record.executionFrames.phase, 'incomplete');
  assert.equal(result.record.executionFrames.totalFrames, 0);
  assert.deepEqual(result.record.executionFrames.frames, []);
});

test('a new generated project cannot silently downgrade its runtime output to unwrapped project frames', async t => {
  const f = await fixture(t, 'bare'), result = await run(f);
  assert.equal(result.status, 'failed');
  assert.equal(result.record.executionFrames.phase, 'incomplete');
  assert.equal(result.record.executionFrames.totalFrames, 0);
  assert.deepEqual(result.record.events, []);
  assert.ok(result.record.diagnostics.some(row => row.code === 'runtime_execution_frame_invalid'));
});

for (const mutation of ['remove-frames', 'add-capability', 'change-version']) test(`stored backend metadata cannot select a different runtime reader: ${mutation}`, async t => {
  const f = await fixture(t), build = structuredClone(f.build);
  if (mutation === 'remove-frames') build.backend.capabilities = build.backend.capabilities.filter(value => value !== 'runtime.execution-frames');
  else if (mutation === 'add-capability') build.backend.capabilities.push('runtime.unknown-observation');
  else build.backend.version = '0.33.0';
  await fs.writeFile(path.join(f.directory, 'build.json'), JSON.stringify(build));
  const result = await runProjectBuild({ buildDirectory: f.directory, tool: process.execPath,
    backendRegistry: f.backendRegistry, headless: true, smoke: false });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.equal(f.executed(), false, 'Reject metadata changes before executing any runtime.');
  assert.ok(result.diagnostics.some(row => row.code === 'runtime_adapter_changed'), JSON.stringify(result));
  await assert.rejects(fs.stat(path.join(f.directory, 'sessions')), { code: 'ENOENT' });
});
