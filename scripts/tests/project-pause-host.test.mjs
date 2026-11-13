import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAssemblyBuildFixture } from './helpers/project-assembly-backend-fixture.mjs';
import { enterScene, readyScene, projectLine } from './helpers/project-runtime-fixture.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { runProjectBuild } from '../adapters/node-project-build.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { createProjectRuntimeEventReader } from '../../engine/project-runtime-events.mjs';
import { createProjectPauseReader, validateProjectPauseObservation } from '../../engine/project-pause-observation.mjs';

const observerDetail = 'Private project pause host observer fixture';
const phaseResult = () => ({ status: 'succeeded', exitCode: 0, stdout: '', stderr: '', durationMs: 0 });
async function fixture(t, { unterminated = false } = {}) {
  const f = await projectAssemblyBuildFixture(t), protocol = f.build.backend.protocolVersion, plan = f.captured.plan;
  const scene = plan.scenes.find(row => row.scene.objectId === plan.entrySceneId);
  const ready = { protocol, event: 'ready', assemblyId: plan.assembly.objectId, entrySceneId: plan.entrySceneId,
    ...(protocol >= 2 ? { stateRevision: 0 } : {}), ...(protocol >= 3 ? { eventSequence: 0 } : {}),
    ...(protocol >= 4 ? { audioCommandSequence: 0 } : {}), ...(protocol >= 5 ? { animationCommandSequence: 0 } : {}),
    ...(protocol >= 7 ? { animationCompletionSequence: 0 } : {}), ...(protocol >= 8 ? { animationStateSequence: 0 } : {}),
    ...(protocol >= 9 ? { animationStateEntrySequence: 0 } : {}) };
  const frames = [ready, { ...enterScene(scene, 1), protocol }, { ...readyScene(scene, 1), protocol }];
  const paused = { protocol: 1, event: 'state', sequence: 1, visitIndex: 1, sceneId: scene.scene.objectId,
    phase: 'paused', elapsedSeconds: .25, totalSeconds: .25 };
  const text = frames.map(projectLine).join('') + 'VIENTO_PROJECT_PAUSE:' + JSON.stringify(paused) + (unterminated ? '' : '\n');
  // This transport fixture uses a real child process that stays alive after its
  // accepted pause row. It does not model Godot gameplay or alter frozen caps.
  const source = `process.stdout.write(${JSON.stringify(text)});setInterval(()=>{},1000);`;
  const processResults = [], processStarts = [];
  const adapter = { ...f.adapter,
    identify: async () => ({ ...f.build.tool, executable: process.execPath }),
    createEventReader(input, options) {
      // Select the actual pure readers directly so host finalization is tested
      // independently of Godot capability selection and frame-envelope layers.
      return createProjectPauseReader(input, {
        runtimeReader: createProjectRuntimeEventReader(input, { protocolVersion: options.protocolVersion,
          retainedEvents: options.retainedEvents, onEvent: options.onEvent }),
        onSnapshot: options.onPauseSnapshot,
      });
    },
    async executePhase(context) {
      if (context.phase !== 'run') return phaseResult();
      const result = await runBuildProcess(process.execPath, ['-e', source], {
        cwd: context.directory, signal: context.signal, timeoutMs: context.timeoutMs,
        onOutput: context.onOutput, onStart: value => processStarts.push(value.pid),
      });
      processResults.push(result); return result;
    },
  };
  return { ...f, frames, paused, processResults, processStarts, backendRegistry: createExecutionBackendRegistry([adapter]) };
}
async function run(f, { signal, timeoutMs = 2500, onProgress = () => {} } = {}) {
  let result, escaped;
  try {
    result = await runProjectBuild({ buildDirectory: f.directory, tool: process.execPath,
      backendRegistry: f.backendRegistry, headless: true, smoke: false, signal, timeoutMs, onProgress });
  } catch (error) { escaped = { name: error.name, message: error.message }; }
  const sessions = await fs.readdir(path.join(f.directory, 'sessions'));
  assert.equal(sessions.length, 1);
  const sessionDirectory = path.join(f.directory, 'sessions', sessions[0]);
  const disk = JSON.parse(await fs.readFile(path.join(sessionDirectory, 'session.json')));
  assert.equal(escaped, undefined, JSON.stringify({ escaped, diskStatus: disk.status, diskPause: disk.pause }));
  assert.equal(result.ok, false); assert.deepEqual(disk, result.record);
  await assert.rejects(fs.stat(path.join(sessionDirectory, 'project')), { code: 'ENOENT' });
  assert.equal(f.processStarts.length, 1); assert.equal(f.processResults.length, 1);
  assert.equal(result.record.pause.phase, 'incomplete'); assert.equal(result.record.pause.state, 'paused');
  assert.deepEqual(result.record.pause.current, { visitIndex: 1, sceneId: f.paused.sceneId });
  assert.equal(result.record.pause.totalTransitions, 1); assert.deepEqual(result.record.pause.transitions, [f.paused]);
  assert.deepEqual(result.record.pause.retention, { limit: 32, total: 1, retained: 1, dropped: 0, firstSequence: 1, lastSequence: 1 });
  assert.deepEqual(validateProjectPauseObservation(result.record.pause), result.record.pause);
  assert.deepEqual(result.record.events, f.frames); assert.deepEqual(result.record.lifecycle, { started: true, completed: false });
  assert.ok(result.record.diagnostics.length > 0); assert.equal(JSON.stringify(result.record).includes(observerDetail), false);
  return result;
}

test('a paused real child still reaches the host wall-clock timeout and persists its accepted pause row', { timeout: 15000 }, async t => {
  const f = await fixture(t), timeoutMs = 2500, result = await run(f, { timeoutMs });
  assert.equal(result.status, 'timeout'); assert.equal(f.processResults[0].status, 'timeout');
  assert.ok(f.processResults[0].durationMs >= timeoutMs * .8);
  assert.ok(result.record.phases.some(row => row.phase === 'run' && row.status === 'timeout'));
});

test('abort after an accepted pause row stops a real child and retains the incomplete visit and pause evidence', { timeout: 15000 }, async t => {
  const f = await fixture(t), controller = new AbortController(); let cancelledAt = null;
  const result = await run(f, { signal: controller.signal, onProgress: event => {
    if (event.pause?.state === 'paused' && event.pause.totalTransitions === 1) {
      cancelledAt = event.pause.transitions[0].sequence; controller.abort();
    }
  } });
  assert.equal(cancelledAt, 1); assert.equal(result.status, 'cancelled'); assert.equal(f.processResults[0].status, 'cancelled');
  assert.ok(result.record.phases.some(row => row.phase === 'run' && row.status === 'cancelled'));
});

test('repeated pause-observer failure kills the real child without replaying or losing the accepted row', { timeout: 15000 }, async t => {
  const f = await fixture(t); let calls = 0;
  const result = await run(f, { onProgress: event => {
    if (event.pause?.totalTransitions === 1) { calls++; throw new Error(observerDetail); }
  } });
  assert.equal(result.status, 'failed'); assert.equal(f.processResults[0].status, 'observer-failed'); assert.ok(calls >= 2);
});

test('an unterminated pause row admitted during timeout finalization survives repeated observer errors', { timeout: 15000 }, async t => {
  const f = await fixture(t, { unterminated: true }); let calls = 0;
  const result = await run(f, { onProgress: event => {
    if (event.pause?.totalTransitions === 1) { calls++; throw new Error(observerDetail); }
  } });
  assert.equal(result.status, 'failed'); assert.equal(f.processResults[0].status, 'timeout'); assert.ok(calls >= 2);
});
