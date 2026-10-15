import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { runProjectBuildCommand } from '../project-build.mjs';
import { readFrozenProjectBuild, runProjectBuild } from '../adapters/node-project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const first = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const second = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const json = value => JSON.stringify(value, null, 2) + '\n';
async function fixture(t, options = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-assembly-workflow-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'author'), cacheRoot = path.join(temporary, 'cache');
  await fs.cp(new URL('../../examples/scene2d/', import.meta.url), root, { recursive: true });
  const scene = JSON.parse(await fs.readFile(path.join(root, 'documents/scenes/demo.json')));
  scene.schemaVersion = 2; scene.title = 'Second room'; scene.background = '#334455';
  scene.actors[0].instanceId = '12121212-1212-4212-8212-121212121212'; scene.actors[0].position = [111, 222];
  await fs.writeFile(path.join(root, 'documents/scenes/second.json'), json(scene));
  const record = JSON.parse(await fs.readFile(path.join(root, `metadata/documents/${first}.json`)));
  record.id = second; record.sourcePath = 'documents/scenes/second.json';
  await fs.writeFile(path.join(root, `metadata/documents/${second}.json`), json(record));
  const service = createProjectBuildService(root, { tool: '', cacheRoot, ...options }); t.after(() => service.close());
  const catalog = await service.command({ action: 'assembly-list' });
  const definition = { format: 'viento-project-assembly', schemaVersion: 1, title: 'Two-room work', entrySceneId: second, sceneIds: [first, second] };
  const assembly = await service.command({ action: 'assembly-save', worldId: catalog.worldId, baseRevision: catalog.baseRevision,
    sourcePath: 'documents/game.json', documentType: catalog.defaults.documentType, content: json(definition) });
  return { temporary, root, cacheRoot, service, assembly, definition };
}
async function settled(service) {
  for (let index = 0; index < 3000; index++) {
    const state = await service.status(); if (state.job?.status !== 'running') return state; await delay(20);
  }
  assert.fail('Project assembly job did not finish');
}
async function authorHashes(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name), relative = path.relative(root, file);
    if (!relative.startsWith('.viento/')) result[relative] = buildHash(await fs.readFile(file));
  }
  return result;
}

test('assembly workflow: built-in author actions feed an explicit project target without changing single-scene discovery', async t => {
  const { root, cacheRoot, service, assembly } = await fixture(t);
  const before = await authorHashes(root), state = await service.status({ refresh: true });
  assert.equal(state.scenes.length, 3);
  assert.deepEqual(state.scenes.find(row => row.id === assembly.id), { id: assembly.id, sourcePath: assembly.path,
    title: 'Two-room work', kind: 'project', entrySceneId: second, sceneCount: 2 });
  assert.deepEqual(state.previewDocuments.map(row => row.id).sort(), [first, second].sort());
  for (const payload of [{ action: 'plan', sceneId: assembly.id }, { action: 'plan', targetId: assembly.id, sceneId: first },
    { action: 'plan' }, { action: 'plan', targetId: '../bad' }]) await assert.rejects(service.command(payload), { errorCode: 'build_request_invalid' });
  await service.command({ action: 'plan', targetId: assembly.id });
  const planned = await settled(service);
  assert.equal(planned.job.status, 'succeeded', JSON.stringify(planned.job.diagnostics));
  assert.equal(planned.job.targetKind, 'project'); assert.equal(planned.job.targetId, assembly.id);
  assert.equal(planned.job.plan.sceneCount, 2); assert.equal(planned.job.plan.entrySceneId, second);
  assert.equal(planned.job.plan.actorCount, 2); assert.equal(planned.job.plan.resourceCount, 1);
  await service.command({ action: 'plan', sceneId: first });
  const single = await settled(service); assert.equal(single.job.status, 'succeeded'); assert.equal(single.job.plan.kind, undefined);
  const cli = await runProjectBuildCommand(['--root', root, '--target', assembly.id]);
  assert.equal(cli.ok, true); assert.equal(cli.plan.kind, 'project'); assert.deepEqual(cli.plan.scenes.map(scene => scene.schemaVersion), [1, 2]);
  await assert.rejects(runProjectBuildCommand(['--root', root, '--target', assembly.id, '--scene', first]));
  assert.deepEqual(await authorHashes(root), before);
  await assert.rejects(fs.stat(cacheRoot), { code: 'ENOENT' });
});

test('assembly workflow: a saved non-entry member change invalidates the reviewed snapshot before tool execution', async t => {
  const { root, cacheRoot, service, assembly } = await fixture(t, { tool: process.execPath });
  await service.command({ action: 'plan', targetId: assembly.id });
  const snapshotId = (await settled(service)).job.plan.snapshotId;
  await fs.appendFile(path.join(root, 'documents/scenes/demo.json'), '\n');
  await service.command({ action: 'build', targetId: assembly.id, expectedSnapshotId: snapshotId });
  const failed = await settled(service); assert.equal(failed.job.status, 'failed');
  assert.equal(failed.job.diagnostics[0].code, 'build_snapshot_changed');
  await assert.rejects(fs.stat(cacheRoot), { code: 'ENOENT' });
});

test('assembly workflow: Bevy refuses the aggregate while preserving individually buildable members', async t => {
  const { root, assembly } = await fixture(t);
  const result = await runProjectBuildCommand(['--root', root, '--target', assembly.id, '--backend', 'org.viento.bevy']);
  assert.equal(result.ok, false); assert.ok(result.diagnostics.some(item => item.code === 'build_backend_plan_unsupported'));
});

test('assembly workflow: real Godot freezes two scenes, runs the selected entry, restores offline and refuses scene-only replay', {
  skip: !process.env.VIENTO_GODOT_BIN && 'Set VIENTO_GODOT_BIN for actual project execution',
}, async t => {
  const tool = process.env.VIENTO_GODOT_BIN;
  const { root, cacheRoot, service, assembly } = await fixture(t, { tool });
  const before = await authorHashes(root);
  await service.command({ action: 'plan', targetId: assembly.id });
  const snapshot = (await settled(service)).job.plan.snapshotId;
  await service.command({ action: 'build', targetId: assembly.id, expectedSnapshotId: snapshot });
  const built = await settled(service); assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job.diagnostics));
  const id = built.latestBuild.id;
  assert.equal(built.latestBuild.targetKind, 'project'); assert.equal(built.latestBuild.entrySceneId, second);
  const inspection = await service.command({ action: 'inspect-project', buildId: id });
  assert.equal(inspection.project.schemaVersion, 2); assert.equal(inspection.project.source.assemblyId, assembly.id);
  assert.deepEqual(inspection.project.source.scenes.map(row => row.sceneId), [first, second]);
  assert.equal(inspection.project.dependencies.filter(row => row.role === 'scene').length, 2);
  await service.command({ action: 'run', buildId: id, mode: 'headless' });
  const ran = await settled(service); assert.equal(ran.job.status, 'succeeded', JSON.stringify(ran.job.diagnostics));
  assert.equal(ran.job.runtime.sceneObjectId, second);
  assert.ok(ran.job.events.some(event => event.event === 'ready'));
  assert.deepEqual(await authorHashes(root), before);
  const frozen = await readFrozenProjectBuild(inspection.buildDirectory);
  assert.equal(frozen.plan.entrySceneId, second);
  const controlProgram = { format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: .25, steps: [{ left: false, right: false, up: false, down: false }] };
  // The ordinary run API must not accidentally route aggregate identities into a scene reader.
  const rejected = await runProjectBuild({ buildDirectory: inspection.buildDirectory, tool, controlProgram });
  assert.equal(rejected.ok, false); assert.equal(rejected.diagnostics[0].code, 'runtime_control_unsupported');
  await assert.rejects(service.command({ action: 'run', buildId: id, mode: 'headless', controlProgram }), { errorCode: 'runtime_control_unsupported' });
  await service.close(); await fs.rename(path.join(root, 'documents'), path.join(root, 'author-offline'));
  const restored = createProjectBuildService(root, { tool, cacheRoot }); t.after(() => restored.close());
  const offline = await restored.status();
  assert.equal(offline.projects.find(row => row.id === id).targetKind, 'project');
  await restored.command({ action: 'select-project', buildId: id });
  await restored.command({ action: 'run', buildId: id, mode: 'headless' });
  const again = await settled(restored); assert.equal(again.job.status, 'succeeded', JSON.stringify(again.job.diagnostics));
  assert.equal(again.job.runtime.sceneObjectId, second);
});
