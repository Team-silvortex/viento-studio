import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePhysics2DCharacterMotionAuthor } from './helpers/scene-physics2d-character-motion-author-fixture.mjs';
import { createPhysicsReplayCaseDocumentService } from '../lib/physics-replay-case-documents.mjs';
import { createPhysicsReplayDocumentService } from '../lib/physics-replay-documents.mjs';
import { registerWorkspace } from '../lib/workspace.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { inventory } from './runtime-case-fixture.mjs';

const program = () => ({ format: 'viento-physics2d-input-replay', schemaVersion: 1, fixedDelta: 1 / 60,
  steps: Array.from({ length: 30 }, (_, i) => ({ left: false, right: i < 15, up: false, down: false, jump: i === 6 })) });
const envelope = (sceneId, instanceId) => ({ format: 'viento-physics2d-replay-case-document', schemaVersion: 1, sceneObjectId: sceneId,
  case: { format: 'viento-physics2d-replay-case', schemaVersion: 1, program: program(), checks: [{ instanceId, stepIndex: 15,
    positionAfter: { value: [250, 180], tolerance: [10, 10] }, contact: { exists: false } }] } });
async function fixture(t) {
  const f = await scenePhysics2DCharacterMotionAuthor(t, { animation: false });
  await f.edit('documents/projects/demo.json', value => { value.sceneIds = [f.sceneIds[0]]; });
  await f.edit(`metadata/documents/${f.assemblyId}.json`, value => { value.relations = value.relations.filter(row => row.targetId === f.sceneIds[0]); });
  await f.edit(`metadata/documents/${f.sceneIds[0]}.json`, value => { value.relations = value.relations.filter(row => !['behavior', 'audio', 'animation'].includes(row.kind)); });
  const scene = JSON.parse(await fs.readFile(path.join(f.author, 'documents/scenes/demo.json')));
  return { ...f, scene, cases: createPhysicsReplayCaseDocumentService(f.author), replays: createPhysicsReplayDocumentService(f.author) };
}
async function save(service, sceneId, content, location) {
  const catalog = await service.list(sceneId);
  return service.save({ sceneId, sceneVersion: catalog.sceneVersion, sourcePath: location, documentType: catalog.defaults.documentType, content });
}
test('isolated case registration preserves old replay bytes and enforces scene and document versions', async t => {
  const f = await fixture(t), sceneId = f.sceneIds[0], old = JSON.stringify({ format: 'viento-physics2d-replay-document', schemaVersion: 1, sceneObjectId: sceneId, replay: program() }) + '\n';
  const original = await save(f.replays, sceneId, old, 'documents/physics-replays/old.json');
  const content = '\ufeff' + JSON.stringify(envelope(sceneId, f.scene.actors[0].instanceId), null, '\t').replaceAll('\n', '\r\n') + '\r\n';
  const before = await inventory(f.author), saved = await save(f.cases, sceneId, content, 'documents/physics-cases/case.json');
  assert.equal(saved.valid, true); assert.equal(saved.content, content); assert.deepEqual(saved.definition, envelope(sceneId, f.scene.actors[0].instanceId).case);
  assert.deepEqual(Object.keys(await inventory(f.author)).filter(file => !(file in before)).sort(), [saved.path, `metadata/documents/${saved.id}.json`].sort());
  for (const [file, hash] of Object.entries(before)) assert.equal((await inventory(f.author))[file], hash, file);
  assert.equal((await f.replays.load(original.id)).content, old);
  assert.ok(!(await f.cases.list(sceneId)).documents.some(d => d.id === original.id));
  assert.ok(!(await f.replays.list(sceneId)).documents.some(d => d.id === saved.id));
  await fs.writeFile(path.join(f.author, saved.path), content + ' ');
  await assert.rejects(f.cases.save({ sceneId, sceneVersion: saved.sceneVersion, documentId: saved.id, expectedVersion: saved.version, content }), e => e.statusCode === 409);
  const fresh = await f.cases.load(saved.id);
  await f.edit('documents/scenes/demo.json', scene => { scene.title += ' changed'; });
  await assert.rejects(f.cases.save({ sceneId, sceneVersion: saved.sceneVersion, documentId: saved.id, expectedVersion: fresh.version, content }), e => e.statusCode === 409);
  assert.equal((await f.replays.load(original.id)).content, old);
});
test('selective package migrates an acceptance document with scene, physics, actors and images', async t => {
  const f = await fixture(t), sceneId = f.sceneIds[0], content = JSON.stringify(envelope(sceneId, f.scene.actors[0].instanceId), null, 2) + '\n';
  const saved = await save(f.cases, sceneId, content, 'documents/physics-cases/case.json'), before = await inventory(f.author);
  const catalog = await readPackageCatalog(f.author), item = catalog.entries.find(e => e.id === saved.id);
  assert.ok(item.dependencies.includes(sceneId)); assert.deepEqual(item.problems, []);
  const exportPlan = await planExport(f.author, { kind: 'resources', revision: catalog.revision, ids: [saved.id], includeDependencies: true });
  const zip = path.join(f.temporary, 'case.viento-package.zip'); await writeExportZip(exportPlan, zip);
  const stage = path.join(f.temporary, 'unpack'); await fs.mkdir(stage); const pack = await unpackResourcePackage(zip, stage);
  const documents = new Set(pack.manifest.documents.map(d => d.id)), assets = new Set(pack.manifest.assets.map(a => a.id));
  assert.ok(documents.has(saved.id) && documents.has(sceneId) && documents.has(f.physicsId));
  for (const actor of f.scene.actors) { assert.ok(documents.has(actor.objectId)); if (actor.imageResourceId) assert.ok(assets.has(actor.imageResourceId)); }
  const target = path.join(f.temporary, 'target'); await fs.mkdir(target);
  await fs.copyFile(path.join(f.author, 'workspace.json'), path.join(target, 'workspace.json'));
  await fs.cp(path.join(f.author, 'templates'), path.join(target, 'templates'), { recursive: true });
  await fs.mkdir(path.join(target, 'documents'), { recursive: true }); await registerWorkspace(target);
  const preview = await planPackageImport(target, pack); assert.deepEqual(preview.summary.conflicts, []);
  assert.equal((await applyPackageImport(target, pack, preview.revision)).status, 'imported');
  assert.deepEqual(await inventory(f.author), before);
  await fs.rename(f.author, f.author + '-offline');
  const loaded = await createPhysicsReplayCaseDocumentService(target).load(saved.id);
  assert.equal(loaded.id, saved.id); assert.equal(loaded.sceneId, sceneId); assert.equal(loaded.content, content);
  assert.deepEqual(loaded.definition, envelope(sceneId, f.scene.actors[0].instanceId).case);
});
test('pinned scene dependencies may be deferred but stale scene instances cannot be exported', async t => {
  const f = await fixture(t), sceneId = f.sceneIds[0], instanceId = f.scene.actors[0].instanceId;
  const saved = await save(f.cases, sceneId, JSON.stringify(envelope(sceneId, instanceId)), 'documents/physics-cases/case.json');
  let catalog = await readPackageCatalog(f.author);
  const exportPlan = await planExport(f.author, { kind: 'resources', revision: catalog.revision, ids: [saved.id], includeDependencies: false, includeChildren: false });
  const zip = path.join(f.temporary, 'deferred.viento-package.zip'); await writeExportZip(exportPlan, zip);
  const stage = path.join(f.temporary, 'deferred-unpack'); await fs.mkdir(stage); const pack = await unpackResourcePackage(zip, stage);
  assert.deepEqual(pack.manifest.requirements.map(item => item.id), [sceneId]);
  const empty = path.join(f.temporary, 'empty'); await fs.mkdir(empty);
  await fs.copyFile(path.join(f.author, 'workspace.json'), path.join(empty, 'workspace.json'));
  await fs.cp(path.join(f.author, 'templates'), path.join(empty, 'templates'), { recursive: true });
  await fs.mkdir(path.join(empty, 'documents'), { recursive: true }); await registerWorkspace(empty);
  assert.ok((await planPackageImport(empty, pack)).summary.conflicts.some(item => item.reason === 'dependency'));
  const stale = envelope(sceneId, instanceId); stale.case.checks[0].instanceId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000999';
  await fs.writeFile(path.join(f.author, saved.path), JSON.stringify(stale));
  catalog = await readPackageCatalog(f.author);
  assert.ok(catalog.entries.find(item => item.id === saved.id).problems.length);
  await assert.rejects(planExport(f.author, { kind: 'resources', revision: catalog.revision, ids: [saved.id], includeDependencies: true }));
});

test('real Godot verifies a saved case after selective export, offline migration and a fresh project build',
  { skip: !process.env.VIENTO_GODOT_BIN ? 'Set VIENTO_GODOT_BIN for native Godot tests' : false, timeout: 180000 }, async t => {
  const { createProjectBuildService } = await import('../lib/project-build-service.mjs');
  const { evaluateProjectPhysics2DReplayCase } = await import('../../engine/project-physics2d-replay-case.mjs');
  const { setTimeout: delay } = await import('node:timers/promises');
  const f = await fixture(t), sceneId = f.sceneIds[0];
  const metadata = JSON.parse(await fs.readFile(path.join(f.author, `metadata/documents/${f.physicsId}.json`)));
  const physics = JSON.parse(await fs.readFile(path.join(f.author, metadata.sourcePath)));
  const instanceId = physics.bodies.find(body => body.kind === 'character').instanceId;
  const value = envelope(sceneId, instanceId);
  value.case.checks[0].positionAfter = { value: [0, 0], tolerance: [1e6, 1e6] };
  delete value.case.checks[0].contact;
  const content = JSON.stringify(value, null, 2) + '\n';
  const saved = await save(f.cases, sceneId, content, 'documents/physics-cases/acceptance.json');
  const original = await inventory(f.author), catalog = await readPackageCatalog(f.author);
  const exportPlan = await planExport(f.author, { kind: 'resources', revision: catalog.revision, ids: [saved.id], includeDependencies: true });
  const zip = path.join(f.temporary, 'real-case.viento-package.zip'); await writeExportZip(exportPlan, zip);
  const stage = path.join(f.temporary, 'real-unpack'); await fs.mkdir(stage); const pack = await unpackResourcePackage(zip, stage);
  const target = path.join(f.temporary, 'real-target'); await fs.mkdir(target);
  await fs.copyFile(path.join(f.author, 'workspace.json'), path.join(target, 'workspace.json'));
  await fs.cp(path.join(f.author, 'templates'), path.join(target, 'templates'), { recursive: true });
  await fs.mkdir(path.join(target, 'documents'), { recursive: true }); await registerWorkspace(target);
  const preview = await planPackageImport(target, pack); assert.deepEqual(preview.summary.conflicts, []);
  assert.equal((await applyPackageImport(target, pack, preview.revision)).status, 'imported');
  assert.deepEqual(await inventory(f.author), original);
  await fs.rename(f.author, f.author + '-offline');
  const cacheRoot = path.join(f.temporary, 'real-cache');
  const service = createProjectBuildService(target, { tool: process.env.VIENTO_GODOT_BIN, cacheRoot }); t.after(() => service.close());
  const loaded = await service.command({ action: 'physics-case-load', documentId: saved.id });
  assert.equal(loaded.content, content); assert.deepEqual(loaded.definition, value.case);
  const assemblyCatalog = await service.command({ action: 'assembly-list' });
  const assembly = await service.command({ action: 'assembly-save', worldId: assemblyCatalog.worldId,
    baseRevision: assemblyCatalog.baseRevision, sourcePath: 'documents/projects/restored.json', documentType: assemblyCatalog.defaults.documentType,
    content: JSON.stringify({ format: 'viento-project-assembly', schemaVersion: 1, title: 'Restored project', entrySceneId: sceneId, sceneIds: [sceneId] }) });
  const before = await inventory(target);
  async function settled() {
    for (let i = 0; i < 6000; i++) { const state = await service.status(); if (state.job?.status !== 'running') return state; await delay(20); }
    assert.fail('Godot job did not settle');
  }
  await service.command({ action: 'build', targetId: assembly.id }); const built = await settled();
  assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job.diagnostics));
  await service.command({ action: 'run', buildId: built.job.buildId, mode: 'headless', physicsReplayCase: loaded.definition, physicsReplaySceneId: sceneId });
  const ran = await settled(); assert.equal(ran.job.status, 'succeeded', JSON.stringify(ran.job.diagnostics));
  assert.equal(ran.job.physicsControl.complete, true); assert.equal(ran.job.physicsVerification.evaluation.status, 'passed');
  assert.equal(ran.job.physics.samples.length, 30);
  assert.ok(ran.job.physics.samples[14].positionAfter[0] > ran.job.physics.samples[0].positionBefore[0] + 40);
  // Re-evaluate exactly the same trusted Godot samples against a deliberately
  // wrong expectation; no second run or mutable author document is involved.
  async function locateSnapshot(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { const found = await locateSnapshot(file); if (found) return found; }
      else if (entry.name === 'snapshot.json') return file;
    }
    return null;
  }
  const snapshotPath = await locateSnapshot(cacheRoot); assert.ok(snapshotPath);
  const plan = JSON.parse(await fs.readFile(snapshotPath)).plan;
  const wrong = structuredClone(loaded.definition), actual = ran.job.physicsVerification.evaluation.checks[0].positionAfter.actual;
  wrong.checks[0].positionAfter = { value: [actual[0] + 100, actual[1]], tolerance: [0, 0] };
  const failed = evaluateProjectPhysics2DReplayCase(plan, wrong, ran.job.physics, { complete: true });
  assert.equal(failed.status, 'failed'); assert.deepEqual(failed.checks[0].positionAfter.actual, actual);
  assert.deepEqual(await inventory(target), before);
  assert.deepEqual(await inventory(f.author + '-offline'), original);
});
