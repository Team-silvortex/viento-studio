import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAssemblyBuildFixture } from './helpers/project-assembly-backend-fixture.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { runProjectBuild } from '../adapters/node-project-build.mjs';
import { PROJECT_EXECUTION_BUDGET_POLICY } from '../../engine/project-execution-budget.mjs';

const zero = Object.fromEntries(Object.keys(PROJECT_EXECUTION_BUDGET_POLICY).map(key => [key, 0]));
const observerMessage = 'Execution clock finalization observer fixture';
const phaseResult = () => ({ status: 'succeeded', exitCode: 0, stdout: '', stderr: '', durationMs: 0 });

async function fixture(t, execute) {
  const f = await projectAssemblyBuildFixture(t);
  const tool = { ...f.build.tool, executable: process.execPath };
  const backendRegistry = createExecutionBackendRegistry([{ ...f.adapter,
    identify: async () => ({ ...tool }),
    async executePhase(context) {
      if (context.phase === 'run') execute(context);
      return phaseResult();
    },
  }]);
  return { ...f, backendRegistry, tool };
}

async function run(f, onProgress) {
  let result, escaped;
  try {
    result = await runProjectBuild({ buildDirectory: f.directory, tool: f.tool.executable,
      backendRegistry: f.backendRegistry, headless: true, smoke: false, onProgress });
  } catch (error) { escaped = { name: error.name, message: error.message }; }
  const sessions = await fs.readdir(path.join(f.directory, 'sessions'));
  assert.equal(sessions.length, 1);
  const sessionDirectory = path.join(f.directory, 'sessions', sessions[0]);
  const disk = JSON.parse(await fs.readFile(path.join(sessionDirectory, 'session.json')));
  await assert.rejects(fs.stat(path.join(sessionDirectory, 'project')), { code: 'ENOENT' });
  assert.equal(escaped, undefined, JSON.stringify({ escaped, diskStatus: disk.status, diskClock: disk.executionClock }));
  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.deepEqual(disk, result.record);
  assert.equal(result.record.executionClock.phase, 'incomplete');
  assert.ok(result.record.diagnostics.some(row => row.code === 'build_failed' && row.severity === 'error'));
  assert.equal(JSON.stringify(result.record.diagnostics).includes(observerMessage), false);
  return result.record;
}

test('an unterminated clock sample survives repeated observer errors during host finalization', async t => {
  const used = { ...zero, stateMutations: 5 };
  const frame = { protocol: 1, event: 'sample', index: 1, clock: { idleFrame: 0, physicsFrame: 0 },
    used, total: used, reason: 'sample' };
  const f = await fixture(t, ({ onOutput }) => {
    // A truncated process stream can end after JSON and before its newline.
    // The first observer call therefore happens inside reader.finish().
    onOutput({ stream: 'stdout', text: 'VIENTO_EXECUTION_CLOCK:' + JSON.stringify(frame) });
  });
  let calls = 0;
  const record = await run(f, event => {
    if (event.executionClock?.totalWindows > 0) { calls++; throw new Error(observerMessage); }
  });
  assert.equal(calls, 2);
  assert.equal(record.executionClock.totalWindows, 1);
  assert.deepEqual(record.executionClock.total, used);
  assert.deepEqual(record.executionClock.windows[0].used, used);
  assert.equal(record.executionClock.windows[0].index, 1);
});

test('a consumer failing before execution cannot interrupt the final clock snapshot and disk record', async t => {
  let runStarted = false, failed = false;
  const calls = { starting: 0, clock: 0, eventPositions: 0 }, notifications = [];
  const f = await fixture(t, () => { runStarted = true; });
  const record = await run(f, event => {
    if (event.phase === 'starting') failed = true;
    if (failed) {
      notifications.push(Object.keys(event));
      if (event.phase === 'starting') calls.starting++;
      if (event.executionClock?.phase === 'incomplete') calls.clock++;
      if (event.eventPositions?.phase === 'incomplete') calls.eventPositions++;
      throw new Error(observerMessage);
    }
  });
  assert.equal(runStarted, false);
  // Each observation channel reports its own incomplete state. The new event
  // position notification must not be mistaken for a duplicate clock callback.
  assert.deepEqual(calls, { starting: 1, clock: 1, eventPositions: 1 });
  assert.deepEqual(notifications, [['phase'], ['executionClock'], ['eventPositions']]);
  assert.equal(record.executionClock.totalWindows, 0);
  assert.deepEqual(record.executionClock.total, zero);
  assert.deepEqual(record.executionClock.windows, []);
  assert.equal(record.eventPositions.phase, 'incomplete');
  assert.deepEqual(record.eventPositions.items, []);
});

test('an initial clock notification failure persists an incomplete session before reader assignment', async t => {
  let runStarted = false, calls = 0;
  const f = await fixture(t, () => { runStarted = true; });
  const record = await run(f, event => {
    if (event.executionClock) { calls++; throw new Error(observerMessage); }
  });
  assert.equal(runStarted, false);
  assert.equal(calls, 1);
  assert.equal(record.executionClock.totalWindows, 0);
  assert.deepEqual(record.executionClock.total, zero);
  assert.deepEqual(record.executionClock.windows, []);
});
