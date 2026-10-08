import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { BEVY_EXECUTION_ADAPTER } from '../backends/bevy-adapter.mjs';
import { fixture, service, builtService, settled, runtimeCase } from './runtime-case-fixture.mjs';

const app = fileURLToPath(new URL('../../', import.meta.url));
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const first = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const released = () => ({ left: false, right: false, up: false, down: false });

test('a case cancelled during final session persistence cannot return or persist a passed verdict',
  { skip: process.platform !== 'linux' }, async t => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-runtime-case-finalization-'));
    t.after(() => fs.rm(base, { recursive: true, force: true }));
    const root = path.join(base, 'workspace'), output = path.join(base, 'build');
    await fs.cp(path.join(app, 'examples/bevy-headless'), root, { recursive: true });
    const backendRegistry = createExecutionBackendRegistry([{ ...BEVY_EXECUTION_ADAPTER,
      async identify(executable) { return { executable, version: 'trusted-boundary-fixture',
        sha256: 'a'.repeat(64), platform: process.platform, arch: process.arch }; },
      async executePhase(context) {
        if (context.phase !== 'run') return { status: 'succeeded', exitCode: 0, stdout: '', stderr: '' };
        const scene = JSON.parse(await fs.readFile(path.join(context.directory, 'scene-data.json')));
        const actors = scene.actors.map(actor => ({ instanceId: actor.instanceId, objectId: actor.objectId,
          position: [...actor.position], state: 'idle' }));
        const frames = ['VIENTO_RUNTIME:' + JSON.stringify({ protocol: 2, event: 'ready', sceneObjectId: scene.scene.objectId, actors })];
        for (let stepIndex = 0; stepIndex < context.controlProgram.steps.length; stepIndex++) {
          frames.push('VIENTO_TRACE:' + JSON.stringify({ format: 'viento-runtime-trace', schemaVersion: 1,
            protocolVersion: 2, event: 'sample', stepIndex, actors }));
        }
        frames.push('VIENTO_RUNTIME:' + JSON.stringify({ protocol: 2, event: 'finished', actors, fixedDelta: context.controlProgram.fixedDelta }));
        const stdout = frames.join('\n') + '\n'; context.onOutput({ stream: 'stdout', text: stdout });
        return { status: 'succeeded', exitCode: 0, stdout, stderr: '' };
      },
    }]);
    const built = await buildProject({ root, scene: sceneId, output, backendId: 'org.viento.bevy', backendRegistry, tool: process.execPath });
    assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
    const runtimeCase = { format: 'viento-runtime-case', schemaVersion: 1,
      program: { format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125, steps: [released(), released()] },
      checks: [{ instanceId: first, stepIndex: 1, position: { value: [200,220], tolerance: 0 }, state: 'idle' }] };
    const controller = new AbortController(), originalRename = fs.rename;
    let cancelledAtPersistence = false, result;
    // Inject cancellation into the real atomic persistence boundary, after a
    // successful trace was evaluated and before its final record is committed.
    fs.rename = async function(from, to) {
      if (path.basename(to) === 'session.json') {
        const pending = JSON.parse(await fs.readFile(from));
        if (pending.status === 'succeeded' && pending.verification?.evaluation.status === 'passed') {
          cancelledAtPersistence = true; controller.abort();
        }
      }
      return originalRename.call(this, from, to);
    };
    try {
      result = await runProjectBuild({ buildDirectory: output, backendId: 'org.viento.bevy', backendRegistry,
        tool: process.execPath, runtimeCase, signal: controller.signal });
    } finally { fs.rename = originalRename; }
    assert.equal(cancelledAtPersistence, true, 'The test must exercise the final successful persistence window');
    assert.equal(controller.signal.aborted, true);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'cancelled'); assert.equal(result.record.status, 'cancelled');
    assert.equal(result.record.verification.evaluation.complete, false);
    assert.equal(result.record.verification.evaluation.status, 'incomplete');
    assert.equal(result.record.verification.evaluation.passedChecks, 1, 'Admitted samples remain useful after cancellation');
    assert.ok(result.record.diagnostics.some(item => item.code === 'runtime_cancelled'));
    const persisted = JSON.parse(await fs.readFile(path.join(result.sessionDirectory, 'session.json')));
    assert.equal(persisted.status, 'cancelled'); assert.deepEqual(persisted.verification, result.record.verification);
    await assert.rejects(fs.stat(path.join(result.sessionDirectory, 'project')), { code: 'ENOENT' });
  });

test('a service preserves the committed case verdict when cancellation arrives before it consumes the host result',
  { skip: process.platform !== 'linux' }, async t => {
    const h = await fixture(t), value = service(t, h), built = await builtService(value);
    const OriginalController = globalThis.AbortController, originalRename = fs.rename;
    const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
    let controller, committed = false, cancelledAfterCommit = false, sessionFile;
    // The final host signal read is synchronous with its return. Queue the
    // abort immediately after that read, ahead of the service's await consumer.
    globalThis.AbortController = class extends OriginalController {
      constructor() {
        super(); controller = this;
        const owner = this;
        Object.defineProperty(this.signal, 'aborted', { get() {
          const result = aborted.call(this);
          if (committed && !result && !cancelledAfterCommit) {
            cancelledAfterCommit = true; queueMicrotask(() => owner.abort());
          }
          return result;
        } });
      }
    };
    fs.rename = async function(from, to) {
      let successfulCase = false;
      if (path.basename(to) === 'session.json') {
        const pending = JSON.parse(await fs.readFile(from));
        successfulCase = pending.status === 'succeeded' && pending.verification?.evaluation.status === 'passed';
      }
      const result = await originalRename.call(this, from, to);
      if (successfulCase) { committed = true; sessionFile = to; }
      return result;
    };
    let state;
    try {
      await value.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless', runtimeCase: runtimeCase() });
      state = await settled(value);
    } finally { globalThis.AbortController = OriginalController; fs.rename = originalRename; }
    assert.equal(committed, true); assert.equal(cancelledAfterCommit, true);
    assert.equal(aborted.call(controller.signal), true, 'Cancellation must precede the service consuming the committed result');
    assert.equal(state.job.status, 'succeeded'); assert.equal(state.job.verification.evaluation.status, 'passed');
    assert.equal(state.job.verification.evaluation.complete, true); assert.equal(state.job.diagnostics.length, 0);
    const persisted = JSON.parse(await fs.readFile(sessionFile));
    assert.equal(persisted.status, 'succeeded'); assert.deepEqual(persisted.verification, state.job.verification);
  });
