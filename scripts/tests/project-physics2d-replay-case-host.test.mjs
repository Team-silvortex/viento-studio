import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { scenePhysics2DCharacterMotionAuthor } from './helpers/scene-physics2d-character-motion-author-fixture.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { runProjectBuild } from '../adapters/node-project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const real = { skip: !process.env.VIENTO_GODOT_BIN ? 'Set VIENTO_GODOT_BIN for native Godot tests' : false, timeout: 180000 };
const program = () => ({ format: 'viento-physics2d-input-replay', schemaVersion: 1, fixedDelta: 1 / 60,
  steps: Array.from({ length: 30 }, (_, index) => ({ left: false, right: index < 15, up: false, down: false, jump: index === 6 })) });
const acceptance = (id, expected = [0, 0], tolerance = [10000, 10000]) => ({ format: 'viento-physics2d-replay-case', schemaVersion: 1,
  program: program(), checks: [{ instanceId: id, stepIndex: 1, positionAfter: { value: expected, tolerance } }] });
async function settled(service) {
  for (let i = 0; i < 6000; i++) { const value = await service.status(); if (value.job?.status !== 'running') return value; await delay(20); }
  assert.fail('Physics acceptance job did not finish.');
}
async function hashes(directory) {
  const result = {};
  for (const e of await fs.readdir(directory, { recursive: true, withFileTypes: true })) if (e.isFile()) {
    const file = path.join(e.parentPath || e.path, e.name); result[path.relative(directory, file)] = buildHash(await fs.readFile(file));
  }
  return result;
}
async function frozenProject(cache) {
  const entries = await fs.readdir(cache, { recursive: true, withFileTypes: true });
  const snapshots = entries.filter(row => row.isFile() && row.name === 'snapshot.json');
  assert.equal(snapshots.length, 1);
  return path.join(snapshots[0].parentPath || snapshots[0].path, 'project');
}

test('physics acceptance uses a frozen plan and trusted complete Godot observations, preserving execution status and source', real, async t => {
  const f = await scenePhysics2DCharacterMotionAuthor(t);
  await f.edit('documents/projects/demo.json', value => { value.sceneIds = [f.sceneIds[0]]; });
  await f.edit(`metadata/documents/${f.assemblyId}.json`, value => { value.relations = value.relations.filter(row => row.targetId === f.sceneIds[0]); });
  await f.edit(`metadata/documents/${f.sceneIds[0]}.json`, value => { value.relations = value.relations.filter(row => !['behavior', 'audio', 'animation'].includes(row.kind)); });
  const cache = path.join(f.temporary, 'service-cache'), service = createProjectBuildService(f.author, { tool: process.env.VIENTO_GODOT_BIN, cacheRoot: cache });
  t.after(() => service.close());
  const authorHash = await hashes(f.author);
  await service.command({ action: 'build', targetId: f.assemblyId });
  const built = await settled(service); assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job.diagnostics));
  const project = await frozenProject(cache), directory = path.dirname(project), projectHash = await hashes(project), buildId = built.job.buildId;
  const payload = { action: 'run', buildId, mode: 'headless', physicsReplaySceneId: f.sceneIds[0] };
  await assert.rejects(service.command({ ...payload, physicsReplayCase: acceptance('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') }), { errorCode: 'runtime_physics2d_case_invalid' });
  await assert.rejects(service.command({ ...payload, physicsReplayCase: acceptance(f.instanceId), physicsControlProgram: program() }), { errorCode: 'runtime_physics2d_case_invalid' });
  await assert.rejects(service.command({ ...payload, physicsReplayCase: acceptance(f.instanceId), physicsReplaySceneId: f.sceneIds[1] }), { errorCode: 'runtime_physics_replay_scene_mismatch' });
  assert.equal((await service.status()).job.id, built.job.id);
  const input = acceptance(f.instanceId), pending = service.command({ ...payload, physicsReplayCase: input });
  input.checks[0].positionAfter.value[0] = 99999;
  const admitted = await pending;
  assert.equal(admitted.job.physicsVerification.evaluation.status, 'incomplete');
  assert.equal(admitted.job.physicsVerification.definition.checks[0].positionAfter.value[0], 0);
  const passed = (await settled(service)).job;
  assert.equal(passed.status, 'succeeded', JSON.stringify(passed.diagnostics));
  assert.equal(passed.physicsControl.complete, true);
  assert.equal(passed.physicsVerification.evaluation.status, 'passed');
  assert.equal(passed.physicsVerification.evaluation.checks[0].positionAfter.passed, true);
  await service.command({ ...payload, physicsReplayCase: acceptance(f.instanceId, [9999, 9999], [0, 0]) });
  const failed = (await settled(service)).job;
  assert.equal(failed.status, 'succeeded'); assert.equal(failed.physicsControl.complete, true);
  assert.equal(failed.physicsVerification.evaluation.status, 'failed');
  assert.equal(failed.physicsVerification.evaluation.checks[0].positionAfter.passed, false);
  const direct = await runProjectBuild({ buildDirectory: directory, tool: process.env.VIENTO_GODOT_BIN,
    physicsReplayCase: acceptance(f.instanceId, [9999, 9999], [0, 0]), physicsReplaySceneId: f.sceneIds[0] });
  assert.equal(direct.ok, false); assert.equal(direct.status, 'succeeded');
  assert.equal(direct.record.physicsVerification.evaluation.status, 'failed');
  const disk = JSON.parse(await fs.readFile(path.join(direct.sessionDirectory, 'session.json')));
  assert.deepEqual(disk.physicsVerification, direct.record.physicsVerification);
  const controller = new AbortController(); let sawLast = false;
  const cancelled = await runProjectBuild({ buildDirectory: directory, tool: process.env.VIENTO_GODOT_BIN, signal: controller.signal,
    physicsReplayCase: acceptance(f.instanceId), onProgress(event) {
      if (event.physics?.samples.length === 30 && !sawLast) { sawLast = true; controller.abort(); }
    } });
  assert.equal(sawLast, true); assert.equal(cancelled.ok, false); assert.equal(cancelled.record.status, 'cancelled');
  assert.equal(cancelled.record.physicsControl.complete, false); assert.equal(cancelled.record.physicsVerification.evaluation.status, 'incomplete');
  const cancelDisk = JSON.parse(await fs.readFile(path.join(cancelled.sessionDirectory, 'session.json')));
  assert.equal(cancelDisk.physicsVerification.evaluation.status, 'incomplete');
  // Cancellation during the asynchronous staging write precedes publication.
  // It must be persisted as incomplete, never as a passing candidate.
  const beforeCommit = new AbortController(), originalWrite = fs.writeFile;
  let cancelledDuringStage = false, staged;
  fs.writeFile = async (file, data, options) => {
    const result = await originalWrite(file, data, options);
    if (!cancelledDuringStage && typeof file === 'string' && path.basename(file).startsWith('.session.json.') && typeof data === 'string') {
      const candidate = JSON.parse(data);
      if (candidate.physicsVerification?.evaluation.status === 'passed') { cancelledDuringStage = true; beforeCommit.abort(); }
    }
    return result;
  };
  try { staged = await runProjectBuild({ buildDirectory: directory, tool: process.env.VIENTO_GODOT_BIN,
    physicsReplayCase: acceptance(f.instanceId), signal: beforeCommit.signal }); }
  finally { fs.writeFile = originalWrite; }
  assert.equal(cancelledDuringStage, true); assert.equal(staged.record.status, 'cancelled');
  assert.equal(staged.record.physicsVerification.evaluation.status, 'incomplete');
  const stagedDisk = JSON.parse(await fs.readFile(path.join(staged.sessionDirectory, 'session.json')));
  assert.equal(stagedDisk.status, 'cancelled'); assert.equal(stagedDisk.physicsVerification.evaluation.status, 'incomplete');

  // A successful atomic rename is the commit point. Cancellation injected just
  // after it is too late and cannot cause a second, possibly failing rewrite.
  const afterCommit = new AbortController(), originalRenameSync = fsSync.renameSync, originalRename = fs.rename;
  let cancelledAfterRename = false, atCommit;
  fsSync.renameSync = (from, to) => {
    originalRenameSync(from, to);
    if (!cancelledAfterRename && to.endsWith('/session.json')) {
      const written = JSON.parse(fsSync.readFileSync(to, 'utf8'));
      if (written.physicsVerification?.evaluation.status === 'passed') { cancelledAfterRename = true; afterCommit.abort(); }
    }
  };
  fs.rename = async (from, to) => {
    if (cancelledAfterRename && to.endsWith('/session.json')) throw Object.assign(new Error('Injected rewrite failure'), { code: 'EIO' });
    return originalRename(from, to);
  };
  try { atCommit = await runProjectBuild({ buildDirectory: directory, tool: process.env.VIENTO_GODOT_BIN,
    physicsReplayCase: acceptance(f.instanceId), signal: afterCommit.signal }); }
  finally { fsSync.renameSync = originalRenameSync; fs.rename = originalRename; }
  assert.equal(cancelledAfterRename, true); assert.equal(atCommit.record.status, 'succeeded');
  assert.equal(atCommit.record.physicsVerification.evaluation.status, 'passed');
  const commitDisk = JSON.parse(await fs.readFile(path.join(atCommit.sessionDirectory, 'session.json')));
  assert.equal(commitDisk.status, 'succeeded'); assert.equal(commitDisk.physicsVerification.evaluation.status, 'passed');
  let observerThrew = false;
  const observed = await runProjectBuild({ buildDirectory: directory, tool: process.env.VIENTO_GODOT_BIN,
    physicsReplayCase: acceptance(f.instanceId), onProgress(event) {
      if (event.physics?.phase === 'finished') { observerThrew = true; throw new Error('Injected final observer failure'); }
    } });
  assert.equal(observerThrew, true); assert.equal(observed.ok, false); assert.equal(observed.record.status, 'failed');
  assert.equal(observed.record.physicsVerification.evaluation.status, 'incomplete');
  const failedDisk = JSON.parse(await fs.readFile(path.join(observed.sessionDirectory, 'session.json')));
  assert.equal(failedDisk.physicsVerification.evaluation.status, 'incomplete');
  await service.command({ ...payload, physicsReplayCase: acceptance(f.instanceId) });
  let active;
  for (let i = 0; i < 2000; i++) {
    active = (await service.status()).job;
    if (active.physics?.samples.length || active.status !== 'running') break;
    await delay(5);
  }
  assert.equal(active.status, 'running'); assert.ok(active.physics?.samples.length > 0);
  await service.command({ action: 'cancel', jobId: active.id });
  const cancelledJob = (await settled(service)).job;
  assert.equal(cancelledJob.status, 'cancelled'); assert.equal(cancelledJob.physicsControl.complete, false);
  assert.equal(cancelledJob.physicsVerification.evaluation.status, 'incomplete');
  let lateJobId, lateCancel, lateSession;
  fsSync.renameSync = (from, to) => {
    originalRenameSync(from, to);
    if (!lateCancel && to.endsWith('/session.json')) {
      const written = JSON.parse(fsSync.readFileSync(to, 'utf8'));
      if (written.physicsVerification?.evaluation.status === 'passed') {
        lateSession = to; lateCancel = service.command({ action: 'cancel', jobId: lateJobId });
      }
    }
  };
  fs.rename = async (from, to) => {
    if (lateCancel && to.endsWith('/session.json')) throw Object.assign(new Error('Injected rewrite failure'), { code: 'EIO' });
    return originalRename(from, to);
  };
  try {
    const started = await service.command({ ...payload, physicsReplayCase: acceptance(f.instanceId) });
    lateJobId = started.job.id;
    const committedJob = (await settled(service)).job;
    assert.ok(lateCancel); await lateCancel;
    assert.equal(committedJob.status, 'succeeded');
    assert.equal(committedJob.physicsControl.complete, true);
    assert.equal(committedJob.physicsVerification.evaluation.status, 'passed');
    const persistedJob = JSON.parse(await fs.readFile(lateSession));
    assert.equal(persistedJob.status, committedJob.status);
    assert.deepEqual(persistedJob.physicsVerification.evaluation, committedJob.physicsVerification.evaluation);
  } finally { fsSync.renameSync = originalRenameSync; fs.rename = originalRename; }
  assert.deepEqual(await hashes(f.author), authorHash); assert.deepEqual(await hashes(project), projectHash);
});

test('physics acceptance documents use service save, list, load and conflict checks without touching existing authors', async t => {
  const f = await scenePhysics2DCharacterMotionAuthor(t);
  await f.edit(`metadata/documents/${f.sceneIds[0]}.json`, value => { value.relations = value.relations.filter(row => !['behavior', 'audio', 'animation'].includes(row.kind)); });
  const service = createProjectBuildService(f.author, { tool: process.execPath, cacheRoot: path.join(f.temporary, 'service-cache') });
  t.after(() => service.close());
  const before = await hashes(f.author), catalog = await service.command({ action: 'physics-case-list', sceneId: f.sceneIds[0] });
  const raw = JSON.stringify({ format: 'viento-physics2d-replay-case-document', schemaVersion: 1,
    sceneObjectId: f.sceneIds[0], case: acceptance(f.instanceId) }) + '\n';
  const saved = await service.command({ action: 'physics-case-save', sceneId: f.sceneIds[0], sceneVersion: catalog.sceneVersion,
    sourcePath: 'documents/physics-cases/example.json', documentType: catalog.defaults.documentType, content: raw });
  assert.equal(saved.valid, true); assert.deepEqual(saved.definition, acceptance(f.instanceId));
  assert.equal(saved.content, raw); assert.deepEqual(await service.command({ action: 'physics-case-load', documentId: saved.id }), saved);
  const updated = await service.command({ action: 'physics-case-list', sceneId: f.sceneIds[0] });
  assert.ok(updated.documents.some(item => item.id === saved.id));
  const other = await service.command({ action: 'physics-case-list', sceneId: f.sceneIds[1] });
  assert.ok(!other.documents.some(item => item.id === saved.id));
  const after = await hashes(f.author);
  assert.deepEqual(Object.keys(after).filter(file => !(file in before)).sort(), [saved.path, `metadata/documents/${saved.id}.json`].sort());
  for (const [file, hash] of Object.entries(before)) assert.equal(after[file], hash, file);
  await fs.writeFile(path.join(f.author, saved.path), raw + ' ');
  await assert.rejects(service.command({ action: 'physics-case-save', sceneId: f.sceneIds[0], sceneVersion: saved.sceneVersion,
    documentId: saved.id, expectedVersion: saved.version, content: raw }), error => error.statusCode === 409);
  assert.equal(await fs.readFile(path.join(f.author, saved.path), 'utf8'), raw + ' ');
});
