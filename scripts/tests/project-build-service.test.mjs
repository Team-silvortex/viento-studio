import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

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
