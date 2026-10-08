import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER } from '../backends/godot4-adapter.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const example = new URL('../../examples/scene2d/', import.meta.url);
async function fixture(t, options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-build-service-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'source'); await fs.cp(example, root, { recursive: true });
  const cacheRoot = path.join(base, 'cache');
  const service = createProjectBuildService(root, { godot: '', cacheRoot, ...options });
  t.after(() => service.close());
  return { base, root, cacheRoot, service };
}
async function settled(service) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = await service.status();
    if (state.job?.status !== 'running') return state;
    await delay(10);
  }
  assert.fail('Build job did not settle');
}
async function fingerprint(root) {
  const values = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name);
    values[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return values;
}

async function probeFixture(t, identify, adapterOverrides = {}) {
  const toolDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-service-tool-'));
  t.after(() => fs.rm(toolDirectory, { recursive: true, force: true }));
  const tool = path.join(toolDirectory, 'host-owned-tool');
  await fs.writeFile(tool, 'host-owned executable fixture\n', { mode: 0o700 });
  let identifications = 0;
  const backendRegistry = createExecutionBackendRegistry([{ ...GODOT4_EXECUTION_ADAPTER, ...adapterOverrides,
    async identify(executable, options) {
      identifications++;
      if (identify) return identify(executable, options);
      return { executable, version: '4.7.2.stable', sha256: buildHash(await fs.readFile(executable)), platform: process.platform, arch: process.arch };
    } }]);
  return { ...(await fixture(t, { tool, backendRegistry })), tool, identifications: () => identifications };
}

test('editor build jobs: plans work without an engine and never write the project or cache', { skip: process.platform !== 'linux' }, async t => {
  const { root, cacheRoot, service } = await fixture(t);
  const before = await fingerprint(root);
  const initial = await service.status();
  assert.equal(initial.available, false); assert.equal(initial.reason, 'tool_missing');
  assert.deepEqual(initial.scenes.map(scene => scene.id), [sceneId]);
  const submitted = await service.command({ action: 'plan', sceneId });
  assert.equal(submitted.job.kind, 'plan');
  const result = await settled(service);
  assert.equal(result.job.status, 'succeeded'); assert.equal(result.job.plan.actorCount, 1);
  assert.equal(result.job.plan.resourceCount, 1); assert.match(result.job.plan.snapshotId, /^sha256:/);
  assert.deepEqual(await fingerprint(root), before);
  await assert.rejects(fs.stat(cacheRoot), { code: 'ENOENT' });
  // Read snapshots cannot mutate service state.
  result.job.status = 'failed'; result.scenes.length = 0;
  assert.equal((await service.status()).job.status, 'succeeded');
  assert.equal((await service.status()).scenes.length, 1);
});

test('editor build jobs: strict requests, serial ownership, cancel identity and closing gate', { skip: process.platform !== 'linux' }, async t => {
  const { service } = await fixture(t);
  for (const payload of [null, [], { action: 'shell' }, { action: 'plan', sceneId, executable: '/tmp/tool' }, { action: 'plan', sceneId, output: '/tmp/output' }, { action: 'plan', sceneId: '../escape' }]) {
    await assert.rejects(service.command(payload), { errorCode: 'build_request_invalid' });
  }
  await assert.rejects(service.command({ action: 'build', sceneId }), { errorCode: 'build_tool_required' });
  const submissions = await Promise.allSettled([service.command({ action: 'plan', sceneId }), service.command({ action: 'plan', sceneId })]);
  assert.equal(submissions.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(submissions.find(result => result.status === 'rejected').reason.errorCode, 'build_busy');
  const id = submissions.find(result => result.status === 'fulfilled').value.job.id;
  await assert.rejects(service.command({ action: 'cancel', jobId: sceneId }), { errorCode: 'build_job_missing' });
  await service.command({ action: 'cancel', jobId: id });
  const result = await settled(service); assert.equal(result.job.status, 'cancelled');
  assert.equal((await service.command({ action: 'cancel', jobId: id })).job.status, 'cancelled');
  await service.close(); await service.close();
  await assert.rejects(service.command({ action: 'plan', sceneId }), { errorCode: 'build_service_closed' });
  await assert.rejects(service.status(), { errorCode: 'build_service_closed' });
});

test('editor build jobs: a checked snapshot cannot silently build newer source', { skip: process.platform !== 'linux' }, async t => {
  // Node is only an available host path here: the stale snapshot must be
  // rejected before any tool identification or process can execute.
  const { service, root, cacheRoot } = await fixture(t, { godot: process.execPath });
  await service.command({ action: 'plan', sceneId });
  const expectedSnapshotId = (await settled(service)).job.plan.snapshotId;
  await fs.appendFile(path.join(root, 'documents/characters/traveler.md'), '\n外部已保存修改\n');
  await service.command({ action: 'build', sceneId, expectedSnapshotId });
  const result = await settled(service);
  assert.equal(result.job.status, 'failed');
  assert.equal(result.job.diagnostics[0].code, 'build_snapshot_changed');
  assert.equal(result.latestBuild, null);
  await assert.rejects(fs.stat(cacheRoot), { code: 'ENOENT' });
});

test('editor build jobs: disabled hosts do not discover or execute project inputs', async t => {
  const { service } = await fixture(t, { enabled: false, godot: process.execPath });
  const result = await service.status();
  assert.equal(result.supported, false); assert.equal(result.available, false); assert.deepEqual(result.scenes, []);
  await assert.rejects(service.command({ action: 'plan', sceneId }), { errorCode: 'build_platform_unsupported' });
});

test('editor build jobs: unavailable artifacts and incompatible tool are rejected without arbitrary paths', { skip: process.platform !== 'linux' }, async t => {
  const { service } = await fixture(t, { godot: process.execPath });
  await assert.rejects(service.command({ action: 'run', buildId: sceneId, mode: 'window' }), { errorCode: 'build_artifact_missing' });
  await assert.rejects(service.command({ action: 'run', buildId: sceneId, mode: 'window', buildDirectory: '/tmp' }), { errorCode: 'build_request_invalid' });
  await service.command({ action: 'build', sceneId });
  const result = await settled(service); assert.equal(result.job.status, 'failed');
  assert.equal(result.job.diagnostics[0].code, 'build_tool_version');
});

test('editor tool checks: discovery never identifies, checks are detached and replacement invalidates cached identity', { skip: process.platform !== 'linux' }, async t => {
  const { service, root, cacheRoot, tool, identifications } = await probeFixture(t);
  const before = await fingerprint(root);
  assert.equal((await service.status()).toolStatus.status, 'unchecked');
  await service.status({ refresh: true }); assert.equal(identifications(), 0);
  await service.command({ action: 'plan', sceneId });
  const planned = await settled(service);
  const checked = await service.command({ action: 'tool-check' });
  assert.equal(identifications(), 1); assert.equal(checked.available, true);
  assert.equal(checked.toolStatus.status, 'ready'); assert.equal(checked.toolStatus.reason, null);
  assert.deepEqual(checked.job, planned.job); assert.equal(checked.latestBuild, null);
  assert.deepEqual(Object.keys(checked.toolStatus.identity).sort(), ['arch', 'platform', 'sha256', 'version']);
  assert.equal(JSON.stringify(checked).includes(tool), false);
  assert.equal(JSON.stringify(checked).includes('candidateKey'), false);
  checked.toolStatus.identity.version = 'mutated response';
  assert.equal((await service.status()).toolStatus.identity.version, '4.7.2.stable');
  assert.equal(identifications(), 1);
  await fs.appendFile(tool, 'replacement bytes\n');
  const replaced = await service.status();
  assert.equal(replaced.toolStatus.status, 'unchecked'); assert.equal(replaced.toolStatus.identity, null);
  assert.equal(identifications(), 1, 'a changed file does not spawn an implicit probe');
  assert.deepEqual(await fingerprint(root), before);
  await assert.rejects(fs.stat(cacheRoot), { code: 'ENOENT' });
});

test('editor tool checks: strict host-owned requests and incompatible versions fail early while plans remain available', { skip: process.platform !== 'linux' }, async t => {
  const { service, root, cacheRoot } = await fixture(t, { tool: process.execPath });
  const before = await fingerprint(root);
  for (const key of ['backendId', 'toolPath', 'tool', 'godot', 'sceneId', 'output', 'timeoutMs', 'controlProgram', 'jobId']) {
    await assert.rejects(service.command({ action: 'tool-check', [key]: '/tmp/untrusted' }), { errorCode: 'build_request_invalid' });
  }
  const checked = await service.command({ action: 'tool-check' });
  assert.equal(checked.toolStatus.status, 'unavailable'); assert.equal(checked.toolStatus.reason, 'tool_version');
  assert.equal(checked.available, false); assert.equal(checked.reason, 'tool_version'); assert.equal(checked.job, null);
  assert.equal((await service.status()).toolStatus.reason, 'tool_version');
  await assert.rejects(service.command({ action: 'build', sceneId }), { errorCode: 'build_tool_required' });
  await service.command({ action: 'plan', sceneId }); assert.equal((await settled(service)).job.status, 'succeeded');
  assert.deepEqual(await fingerprint(root), before);
  await assert.rejects(fs.stat(cacheRoot), { code: 'ENOENT' });
  const missing = await fixture(t);
  assert.equal((await missing.service.command({ action: 'tool-check' })).toolStatus.reason, 'tool_missing');
  const disabled = await fixture(t, { enabled: false, tool: process.execPath });
  const unsupported = await disabled.service.command({ action: 'tool-check' });
  assert.equal(unsupported.toolStatus.reason, 'platform_unsupported'); assert.deepEqual(unsupported.scenes, []);
});

test('editor tool checks: probe owns the shared slot and shutdown aborts and awaits it without replacing the previous job', { skip: process.platform !== 'linux' }, async t => {
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const { service, identifications } = await probeFixture(t, async (_executable, { signal }) => {
    started();
    await new Promise((resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  await service.command({ action: 'plan', sceneId }); const prior = await settled(service);
  const pending = service.command({ action: 'tool-check' });
  const rejected = assert.rejects(pending, { errorCode: 'build_service_closed' });
  await entered;
  const during = await service.status();
  assert.equal(during.toolStatus.status, 'checking'); assert.deepEqual(during.job, prior.job);
  await assert.rejects(service.command({ action: 'tool-check' }), { errorCode: 'build_busy' });
  await assert.rejects(service.command({ action: 'plan', sceneId }), { errorCode: 'build_busy' });
  assert.equal(identifications(), 1);
  await service.close(); await rejected; await service.close();
  await assert.rejects(service.status(), { errorCode: 'build_service_closed' });
});

test('editor tool checks: a binary changed during identification cannot publish a ready identity', { skip: process.platform !== 'linux' }, async t => {
  const { service } = await probeFixture(t, async executable => {
    const identity = { executable, version: '4.7.2.stable', sha256: buildHash(await fs.readFile(executable)), platform: process.platform, arch: process.arch };
    await fs.appendFile(executable, 'changed during identity check\n');
    return identity;
  });
  const result = await service.command({ action: 'tool-check' });
  assert.equal(result.toolStatus.status, 'unavailable'); assert.equal(result.toolStatus.reason, 'tool_changed');
  assert.equal(result.toolStatus.identity, null); assert.equal(result.available, false); assert.equal(result.job, null);
});

test('editor tool checks: checks preserve successful artifacts, recover after failure and never grant execution identity', { skip: process.platform !== 'linux' }, async t => {
  let compatible = true;
  const { service, root, identifications } = await probeFixture(t, async executable => {
    if (!compatible) throw Object.assign(new Error('private host detail'), { errorCode: 'build_tool_version' });
    return { executable, version: '4.7.2.stable', sha256: buildHash(await fs.readFile(executable)), platform: process.platform, arch: process.arch };
  }, { async executePhase() { return { status: 'succeeded', exitCode: 0, stdout: '', stderr: '' }; } });
  const before = await fingerprint(root);
  await service.command({ action: 'build', sceneId }); const built = await settled(service);
  assert.equal(built.job.status, 'succeeded'); assert.equal(identifications(), 1); assert.ok(built.latestBuild);
  const checked = await service.command({ action: 'tool-check' });
  assert.equal(checked.toolStatus.status, 'ready'); assert.equal(identifications(), 2);
  assert.deepEqual(checked.job, built.job); assert.deepEqual(checked.latestBuild, built.latestBuild);
  compatible = false;
  const failure = await service.command({ action: 'tool-check' });
  assert.equal(failure.toolStatus.reason, 'tool_version'); assert.equal(failure.available, false);
  assert.deepEqual(failure.job, built.job); assert.deepEqual(failure.latestBuild, built.latestBuild);
  compatible = true;
  const recovered = await service.command({ action: 'tool-check' });
  assert.equal(recovered.toolStatus.status, 'ready'); assert.equal(recovered.available, true);
  assert.deepEqual(recovered.latestBuild, built.latestBuild); assert.equal(identifications(), 4);
  await service.command({ action: 'build', sceneId, expectedSnapshotId: built.latestBuild.snapshotId });
  assert.equal((await settled(service)).job.status, 'succeeded');
  assert.equal(identifications(), 5, 'execution re-identifies the host tool independently of cached probe success');
  assert.deepEqual(await fingerprint(root), before);
});

test('editor frozen jobs remain observable and usable when author sources go offline, without allowing cached-source builds', { skip: process.platform !== 'linux' }, async t => {
  let entered, finish;
  let runEntered = new Promise(resolve => { entered = resolve; });
  const { service, root, base } = await probeFixture(t, undefined, {
    async executePhase({ phase, directory, signal, onOutput }) {
      const result = { status: 'succeeded', exitCode: 0, stdout: '', stderr: '' };
      if (phase !== 'run') return result;
      const scene = JSON.parse(await fs.readFile(path.join(directory, 'scene.json'), 'utf8'));
      const actors = scene.actors.map(actor => ({ objectId: actor.objectId, position: actor.position, state: 'idle' }));
      const emit = value => onOutput({ stream: 'stdout', text: `VIENTO_RUNTIME:${JSON.stringify(value)}\n` });
      emit({ protocol: 1, event: 'ready', sceneObjectId: scene.objectId, actors });
      await new Promise(resolve => {
        finish = resolve; entered();
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', resolve, { once: true });
      });
      if (signal.aborted) return { ...result, status: 'cancelled' };
      emit({ protocol: 1, event: 'finished', actors, fixedDelta: 0.25 });
      return result;
    },
  });
  const before = await fingerprint(root);
  await service.command({ action: 'build', sceneId }); const built = await settled(service);
  assert.equal(built.job.status, 'succeeded'); assert.ok(built.latestBuild);
  const offlineRoot = path.join(base, 'offline-author'); await fs.rename(root, offlineRoot);
  // Exercise ordinary polling after the real catalog TTL, not only force refresh.
  await delay(3100);
  const offline = await service.status();
  assert.deepEqual(offline.catalogDiagnostic, { code: 'build_catalog_unavailable' });
  assert.deepEqual(offline.scenes, built.scenes); assert.deepEqual(offline.job, built.job);
  assert.deepEqual(offline.latestBuild, built.latestBuild);
  assert.equal(JSON.stringify(offline.catalogDiagnostic).includes(root), false);
  const refreshed = await service.status({ refresh: true }); assert.deepEqual(refreshed.catalogDiagnostic, offline.catalogDiagnostic);
  for (const action of ['plan', 'build']) {
    await assert.rejects(service.command({ action, sceneId }), { errorCode: 'world_unavailable' });
    assert.deepEqual((await service.status()).job, built.job, 'stale catalog admission creates no new author job');
  }
  const checked = await service.command({ action: 'tool-check' });
  assert.equal(checked.toolStatus.status, 'ready'); assert.deepEqual(checked.job, built.job);
  assert.deepEqual(checked.catalogDiagnostic, offline.catalogDiagnostic);
  const started = await service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless' });
  await runEntered;
  const observation = await service.command({ action: 'inspect', jobId: started.job.id });
  assert.equal(observation.actors.length, 1); assert.equal(observation.phase, 'ready');
  finish(); const completed = await settled(service);
  assert.equal(completed.job.status, 'succeeded'); assert.equal(completed.job.runtime.phase, 'finished');
  assert.deepEqual(completed.catalogDiagnostic, offline.catalogDiagnostic);
  runEntered = new Promise(resolve => { entered = resolve; });
  const next = await service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless' });
  await runEntered;
  const cancelling = await service.command({ action: 'cancel', jobId: next.job.id });
  assert.deepEqual(cancelling.catalogDiagnostic, offline.catalogDiagnostic);
  assert.equal((await settled(service)).job.status, 'cancelled');
  await fs.rename(offlineRoot, root);
  assert.equal((await service.status({ refresh: true })).catalogDiagnostic, null);
  assert.deepEqual(await fingerprint(root), before);
  await service.command({ action: 'plan', sceneId }); assert.equal((await settled(service)).job.status, 'succeeded');
});

test('editor catalog failures still reject first discovery and source-only sessions without owned frozen builds', { skip: process.platform !== 'linux' }, async t => {
  const initial = await fixture(t);
  await fs.rename(initial.root, path.join(initial.base, 'offline-initial'));
  await assert.rejects(initial.service.status(), { errorCode: 'world_unavailable' });
  const readOnly = await fixture(t);
  await readOnly.service.status();
  await readOnly.service.command({ action: 'plan', sceneId }); await settled(readOnly.service);
  await fs.rename(readOnly.root, path.join(readOnly.base, 'offline-plan'));
  await assert.rejects(readOnly.service.status({ refresh: true }), { errorCode: 'world_unavailable' });
});
