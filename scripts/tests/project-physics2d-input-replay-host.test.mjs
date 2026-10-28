import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { scenePhysics2DCharacterMotionAuthor } from './helpers/scene-physics2d-character-motion-author-fixture.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { runProjectBuild } from '../adapters/node-project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const real = { skip: !process.env.VIENTO_GODOT_BIN ? 'Set VIENTO_GODOT_BIN for native Godot tests' : false, timeout: 180000 };
const row = (right = false, jump = false) => ({ left: false, right, up: false, down: false, jump });
const program = () => ({ format: 'viento-physics2d-input-replay', schemaVersion: 1, fixedDelta: 1 / 60,
  steps: Array.from({ length: 30 }, (_, index) => row(index < 15, index === 6)) });
async function settled(service) {
  for (let index = 0; index < 6000; index++) { const value = await service.status(); if (value.job?.status !== 'running') return value; await delay(20); }
  assert.fail('Physics replay job did not finish.');
}
async function hashes(directory) {
  const result = {};
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath || entry.path, entry.name); result[path.relative(directory, file)] = buildHash(await fs.readFile(file));
  }
  return result;
}
async function frozenProject(cache) {
  const entries = await fs.readdir(cache, { recursive: true, withFileTypes: true });
  const snapshots = entries.filter(row => row.isFile() && row.name === 'snapshot.json');
  assert.equal(snapshots.length, 1);
  return path.join(snapshots[0].parentPath || snapshots[0].path, 'project');
}

test('service runs a finite Godot replay, rejects invalid requests before a job, and preserves authors and frozen output', real, async t => {
  const f = await scenePhysics2DCharacterMotionAuthor(t);
  await f.edit('documents/projects/demo.json', value => { value.sceneIds = [f.sceneIds[0]]; });
  await f.edit(`metadata/documents/${f.assemblyId}.json`, value => { value.relations = value.relations.filter(row => row.targetId === f.sceneIds[0]); });
  await f.edit(`metadata/documents/${f.sceneIds[0]}.json`, value => { value.relations = value.relations.filter(row => !['behavior', 'audio', 'animation'].includes(row.kind)); });
  const cacheRoot = path.join(f.temporary, 'service-cache'), service = createProjectBuildService(f.author, { tool: process.env.VIENTO_GODOT_BIN, cacheRoot });
  t.after(() => service.close());
  const authors = await hashes(f.author);
  await service.command({ action: 'build', targetId: f.assemblyId });
  const built = await settled(service); assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job.diagnostics));
  const buildId = built.job.buildId, project = await frozenProject(cacheRoot), artifact = await hashes(project), beforeId = built.job.id;
  const reject = async (payload, code) => {
    await assert.rejects(service.command({ action: 'run', buildId, mode: 'headless', physicsControlProgram: program(), ...payload }), { errorCode: code });
    assert.equal((await service.status()).job.id, beforeId);
  };
  const bad = program(); bad.steps[29].jump = true;
  await reject({ physicsControlProgram: bad }, 'runtime_physics2d_input_invalid');
  await reject({ controlProgram: {} }, 'runtime_physics2d_input_invalid');
  await reject({ runtimeCase: {} }, 'runtime_physics2d_input_invalid');
  await reject({ mode: 'window' }, 'runtime_physics2d_input_unsupported');
  await reject({ physicsReplaySceneId: f.sceneIds[1] }, 'runtime_physics_replay_scene_mismatch');
  const direct = await runProjectBuild({ buildDirectory: path.dirname(project), tool: process.env.VIENTO_GODOT_BIN,
    physicsControlProgram: program(), physicsReplaySceneId: f.sceneIds[1] });
  assert.equal(direct.ok, false); assert.equal(direct.diagnostics[0].code, 'runtime_physics_replay_scene_mismatch');
  assert.equal(direct.sessionDirectory, undefined);
  const input = program();
  await service.command({ action: 'run', buildId, mode: 'headless', physicsControlProgram: input });
  const ran = await settled(service);
  assert.equal(ran.job.status, 'succeeded', JSON.stringify(ran.job.diagnostics));
  assert.equal(ran.job.physicsControl.complete, true); assert.deepEqual(ran.job.physicsControl.program, input);
  assert.equal(ran.job.physics.phase, 'finished'); assert.equal(ran.job.physics.limited, false);
  const samples = ran.job.physics.samples;
  assert.equal(samples.length, 30); assert.deepEqual(samples.map(sample => sample.stepIndex), Array.from({ length: 30 }, (_, i) => i + 1));
  assert.ok(samples.every(sample => Math.abs(sample.deltaSeconds - 1 / 60) <= 1e-6));
  assert.ok(samples[14].positionAfter[0] > samples[0].positionBefore[0] + 40);
  assert.ok(samples[6].positionAfter[1] < samples[6].positionBefore[1] - 1);
  assert.deepEqual(await hashes(f.author), authors); assert.deepEqual(await hashes(project), artifact);
});

test('service refuses replay for a frozen multi-scene project before starting a job', real, async t => {
  const f = await scenePhysics2DCharacterMotionAuthor(t);
  const service = createProjectBuildService(f.author, { tool: process.env.VIENTO_GODOT_BIN, cacheRoot: path.join(f.temporary, 'service-cache') });
  t.after(() => service.close());
  const authors = await hashes(f.author);
  await service.command({ action: 'build', targetId: f.assemblyId });
  const built = await settled(service); assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job.diagnostics));
  assert.equal(built.latestBuild.physicsReplayAvailable, false);
  const project = await frozenProject(path.join(f.temporary, 'service-cache')), artifact = await hashes(project);
  await assert.rejects(service.command({ action: 'run', buildId: built.job.buildId, mode: 'headless', physicsControlProgram: program() }),
    { errorCode: 'runtime_physics2d_input_unsupported' });
  assert.equal((await service.status()).job.id, built.job.id);
  assert.deepEqual(await hashes(f.author), authors); assert.deepEqual(await hashes(project), artifact);
});


test('cancelled and observer-failed replays never persist complete status', real, async t => {
  const f = await scenePhysics2DCharacterMotionAuthor(t);
  await f.edit('documents/projects/demo.json', value => { value.sceneIds = [f.sceneIds[0]]; });
  await f.edit(`metadata/documents/${f.assemblyId}.json`, value => { value.relations = value.relations.filter(row => row.targetId === f.sceneIds[0]); });
  await f.edit(`metadata/documents/${f.sceneIds[0]}.json`, value => { value.relations = value.relations.filter(row => !['behavior', 'audio', 'animation'].includes(row.kind)); });
  const cacheRoot = path.join(f.temporary, 'service-cache'), service = createProjectBuildService(f.author, { tool: process.env.VIENTO_GODOT_BIN, cacheRoot });
  t.after(() => service.close());
  const authors = await hashes(f.author);
  await service.command({ action: 'build', targetId: f.assemblyId });
  const built = await settled(service); assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job.diagnostics));
  const project = await frozenProject(cacheRoot), artifact = await hashes(project), directory = path.dirname(project);
  const controller = new AbortController(); let sawFinalSample = false;
  const cancelled = await runProjectBuild({ buildDirectory: directory, tool: process.env.VIENTO_GODOT_BIN, signal: controller.signal,
    physicsControlProgram: program(), onProgress(event) {
      if (event.physics?.samples.length === 30 && !sawFinalSample) { sawFinalSample = true; controller.abort(); }
    } });
  assert.equal(sawFinalSample, true, 'tail cancellation reached all 30 observations');
  assert.equal(cancelled.ok, false); assert.notEqual(cancelled.record.status, 'succeeded');
  assert.equal(cancelled.record.physicsControl.complete, false);
  const cancelledDisk = JSON.parse(await fs.readFile(path.join(cancelled.sessionDirectory, 'session.json')));
  assert.notEqual(cancelledDisk.status, 'succeeded'); assert.equal(cancelledDisk.physicsControl.complete, false);
  let observerThrew = false;
  const failed = await runProjectBuild({ buildDirectory: directory, tool: process.env.VIENTO_GODOT_BIN,
    physicsControlProgram: program(), onProgress(event) {
      if (event.physics?.phase === 'finished') { observerThrew = true; throw new Error('Injected final observation failure'); }
    } });
  assert.equal(observerThrew, true); assert.equal(failed.ok, false); assert.notEqual(failed.record.status, 'succeeded');
  assert.equal(failed.record.physicsControl.complete, false);
  const failedDisk = JSON.parse(await fs.readFile(path.join(failed.sessionDirectory, 'session.json')));
  assert.notEqual(failedDisk.status, 'succeeded'); assert.equal(failedDisk.physicsControl.complete, false);
  await service.command({ action: 'run', buildId: built.job.buildId, mode: 'headless', physicsControlProgram: program() });
  let active;
  for (let index = 0; index < 2000; index++) {
    active = (await service.status()).job;
    if (active.physics?.samples.length || active.status !== 'running') break;
    await delay(5);
  }
  assert.equal(active.status, 'running'); assert.ok(active.physics?.samples.length > 0);
  await service.command({ action: 'cancel', jobId: active.id });
  const job = (await settled(service)).job;
  assert.notEqual(job.status, 'succeeded'); assert.equal(job.physicsControl.complete, false);
  assert.deepEqual(await hashes(f.author), authors); assert.deepEqual(await hashes(project), artifact);
});
