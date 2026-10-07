import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { executionHostConfiguration } from '../adapters/node-execution-tool.mjs';
import { runProjectBuildCommand } from '../project-build.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { canonicalJson } from '../../engine/world-projection.mjs';
import { createSceneRuntimeEventReader } from '../../engine/scene-runtime-events.mjs';

const app = fileURLToPath(new URL('../../', import.meta.url));
const backendId = 'org.viento.bevy', sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const bevy = process.env.VIENTO_BEVY_BIN, godot = process.env.VIENTO_GODOT_BIN;
const real = { skip: !bevy || process.platform !== 'linux', timeout: 60000 };
const json = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
async function fixture(t, version = 2) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-bevy-workflow-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'workspace');
  await fs.cp(path.join(app, 'examples/bevy-headless'), root, { recursive: true });
  if (version === 1) {
    const file = path.join(root, 'documents/scenes/demo.json'), scene = JSON.parse(await fs.readFile(file));
    scene.schemaVersion = 1; scene.actors = [scene.actors[0]]; delete scene.actors[0].instanceId; await json(file, scene);
  }
  return { root, temporary, output: path.join(temporary, 'output') };
}
async function inventory(root) {
  const entries = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name); entries[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return entries;
}
const build = h => buildProject({ root: h.root, scene: sceneId, backendId, tool: bevy, output: h.output });
const run = (h, options = {}) => runProjectBuild({ buildDirectory: h.output, backendId, tool: bevy, ...options });
const absent = file => assert.rejects(fs.stat(file), { code: 'ENOENT' });
const settled = async service => {
  for (let attempt = 0; attempt < 600; attempt++) {
    const state = await service.status(); if (state.job?.status !== 'running') return state;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Build service did not settle.');
};

test('host selection keeps Godot default, uses separate trusted tools and never registers an unknown backend', () => {
  assert.deepEqual(executionHostConfiguration({ env: {} }), { backendId: 'org.viento.godot4', tool: undefined });
  assert.deepEqual(executionHostConfiguration({ env: { VIENTO_EXECUTION_BACKEND: backendId, VIENTO_BEVY_BIN: '/bevy', VIENTO_GODOT_BIN: '/godot' } }), { backendId, tool: '/bevy' });
  assert.deepEqual(executionHostConfiguration({ env: {}, backendId, tool: '/explicit' }), { backendId, tool: '/explicit' });
  for (const selected of ['org.viento.unknown', '__proto__', '']) {
    assert.throws(() => executionHostConfiguration({ env: { VIENTO_EXECUTION_BACKEND: selected } }), { errorCode: 'build_backend_missing' });
  }
  const descriptors = createExecutionBackendRegistry().descriptors();
  assert.deepEqual(descriptors.map(item => item.id), ['org.viento.godot4', backendId]);
  assert.equal(descriptors[1].execution.headlessLogic, true); assert.equal(descriptors[1].execution.windowPreview, false);
});

test('explicit backend CLI admission rejects images and GDScript while the unchanged neutral plan remains readable', async t => {
  const h = await fixture(t), before = await inventory(h.root);
  const captured = await captureBuildSnapshot(h.root, sceneId);
  const args = ['--root', h.root, '--scene', sceneId];
  assert.deepEqual(await runProjectBuildCommand(args), { ok: true, plan: captured.plan, snapshotId: captured.snapshotId, diagnostics: [] });
  assert.deepEqual(await runProjectBuildCommand([...args, '--backend', backendId]), await runProjectBuildCommand(args));
  for (const name of ['scene2d', 'scene-behaviors']) {
    const result = await runProjectBuildCommand(['--root', path.join(app, 'examples', name), '--scene', sceneId, '--backend', backendId]);
    assert.equal(result.ok, false); assert.ok(result.diagnostics.some(item => ['build_capability_missing', 'build_backend_plan_unsupported', 'build_behavior_backend_unsupported'].includes(item.code)));
  }
  await assert.rejects(runProjectBuildCommand([...args, '--backend', backendId, '--godot', '/tool']), /Godot-only/);
  await assert.rejects(runProjectBuildCommand([...args, '--godot', '/tool', '--tool', '/another']), /Godot-only/);
  assert.deepEqual(await inventory(h.root), before);
});

test('real Bevy and Godot execute the same frozen v1 and v2 plans with identical identity, movement and lifecycle events', { ...real, skip: real.skip || !godot }, async t => {
  for (const version of [1, 2]) {
    const h = await fixture(t, version), before = await inventory(h.root), captured = await captureBuildSnapshot(h.root, sceneId);
    const bevyBuild = await build(h); assert.equal(bevyBuild.ok, true, JSON.stringify(bevyBuild));
    assert.equal(bevyBuild.record.artifact.kind, 'bevy-scene');
    assert.deepEqual(bevyBuild.record.phases.map(item => item.phase), ['scene-check']);
    assert.equal(bevyBuild.record.snapshotId, captured.snapshotId);
    const bevyRun = await run(h); assert.equal(bevyRun.ok, true, JSON.stringify(bevyRun));
    const godotOutput = path.join(h.temporary, 'godot');
    const godotBuild = await buildProject({ root: h.root, scene: sceneId, tool: godot, output: godotOutput });
    assert.equal(godotBuild.ok, true, JSON.stringify(godotBuild)); assert.equal(godotBuild.record.snapshotId, captured.snapshotId);
    const godotRun = await runProjectBuild({ buildDirectory: godotOutput, tool: godot });
    assert.equal(godotRun.ok, true, JSON.stringify(godotRun)); assert.deepEqual(bevyRun.record.events, godotRun.record.events);
    const neutral = createSceneRuntimeEventReader(captured.plan);
    neutral.push(godotRun.record.phases.find(item => item.phase === 'run').stdout); neutral.finish();
    assert.deepEqual(neutral.diagnostics, []); assert.deepEqual(neutral.events, godotRun.record.events);
    assert.equal(bevyRun.record.events.at(-1).actors[0].position[0], 240);
    if (version === 2) assert.equal(bevyRun.record.events.at(-1).actors[1].position[0], 500);
    assert.deepEqual(await inventory(h.root), before); await absent(path.join(bevyRun.sessionDirectory, 'project'));
  }
});

test('real CLI build replays offline and refuses a foreign backend, altered generated bytes or forged frozen plan', real, async t => {
  const h = await fixture(t), before = await inventory(h.root);
  const built = await runProjectBuildCommand(['--command', 'build', '--root', h.root, '--scene', sceneId, '--backend', backendId, '--tool', bevy, '--output', h.output]);
  assert.equal(built.ok, true, JSON.stringify(built));
  await fs.rename(h.root, h.root + '-offline');
  const replay = await runProjectBuildCommand(['--command', 'run', '--build', h.output, '--backend', backendId, '--tool', bevy]);
  assert.equal(replay.ok, true, JSON.stringify(replay)); assert.equal(replay.record.events.at(-1).actors[0].position[0], 240);
  assert.equal((await run(h, { backendId: 'org.viento.godot4' })).diagnostics[0].code, 'runtime_backend_changed');
  const generatedFile = path.join(h.output, 'project/scene-data.json'), generatedBytes = await fs.readFile(generatedFile);
  await fs.appendFile(generatedFile, ' '); assert.equal((await run(h)).diagnostics[0].code, 'runtime_artifact_changed');
  await fs.writeFile(generatedFile, generatedBytes);
  const snapshotFile = path.join(h.output, 'snapshot.json'), recordFile = path.join(h.output, 'build.json');
  const snapshot = JSON.parse(await fs.readFile(snapshotFile)), record = JSON.parse(await fs.readFile(recordFile));
  snapshot.plan.actors[0].speed = 999; record.snapshotId = `sha256:${buildHash(canonicalJson(snapshot))}`;
  await json(snapshotFile, snapshot); await json(recordFile, record);
  assert.equal((await run(h)).diagnostics[0].code, 'runtime_build_invalid');
  assert.deepEqual(await inventory(h.root + '-offline'), before);
});

test('real backend-owned service builds and runs headlessly while rejecting browser tool/backend overrides and window mode', real, async t => {
  const h = await fixture(t), before = await inventory(h.root);
  const configuration = executionHostConfiguration({ env: { VIENTO_EXECUTION_BACKEND: backendId, VIENTO_BEVY_BIN: bevy } });
  const service = createProjectBuildService(h.root, { ...configuration, cacheRoot: path.join(h.temporary, 'cache') });
  t.after(() => service.close());
  const initial = await service.status(); assert.equal(initial.backend.id, backendId); assert.equal(initial.available, true);
  for (const overrides of [{ backendId: 'org.viento.godot4' }, { tool: bevy }, { executable: bevy }, { output: h.output }]) {
    await assert.rejects(service.command({ action: 'plan', sceneId, ...overrides }), { errorCode: 'build_request_invalid' });
  }
  await service.command({ action: 'plan', sceneId }); const planned = await settled(service); assert.equal(planned.job.status, 'succeeded');
  await service.command({ action: 'build', sceneId, expectedSnapshotId: planned.job.plan.snapshotId });
  const built = await settled(service); assert.equal(built.job.status, 'succeeded', JSON.stringify(built));
  assert.equal(built.latestBuild.backendId, backendId);
  await assert.rejects(service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'window' }), { errorCode: 'build_execution_unsupported' });
  await service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless' });
  const replay = await settled(service); assert.equal(replay.job.status, 'succeeded', JSON.stringify(replay));
  assert.equal(replay.job.backendId, backendId); assert.equal(replay.job.events.at(-1).actors[0].position[0], 240);
  assert.deepEqual(await inventory(h.root), before);
});

test('real live Bevy session cancels after ready and removes its owned project without changing authors', real, async t => {
  const h = await fixture(t), before = await inventory(h.root);
  assert.equal((await build(h)).ok, true);
  const controller = new AbortController();
  const replay = await run(h, { smoke: false, signal: controller.signal,
    onProgress: event => { if (event.event?.event === 'ready') controller.abort(); } });
  assert.equal(replay.status, 'cancelled'); assert.ok(replay.record.events.some(event => event.event === 'ready'));
  await absent(path.join(replay.sessionDirectory, 'project')); assert.deepEqual(await inventory(h.root), before);
});
