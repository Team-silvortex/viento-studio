import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { scenePhysics2DCharacterMotionAuthor } from './helpers/scene-physics2d-character-motion-author-fixture.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { registerWorkspace } from '../lib/workspace.mjs';
import { readPackageCatalog, packageDigest } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { inventory } from './runtime-case-fixture.mjs';

const real = { skip: !process.env.VIENTO_GODOT_BIN ? 'Set VIENTO_GODOT_BIN for native Godot tests' : false, timeout: 180000 };
const program = () => ({ format: 'viento-physics2d-input-replay', schemaVersion: 1, fixedDelta: 1 / 60,
  steps: Array.from({ length: 30 }, (_, i) => ({ left: false, right: i < 15, up: false, down: false, jump: i === 6 })) });
const envelope = sceneId => ({ format: 'viento-physics2d-replay-document', schemaVersion: 1, sceneObjectId: sceneId, replay: program() });
const raw = sceneId => '\uFEFF' + JSON.stringify(envelope(sceneId), null, '\t').replaceAll('\n', '\r\n') + '\r\n';
async function fixture(t) {
  const f = await scenePhysics2DCharacterMotionAuthor(t, { animation: false });
  await f.edit('documents/projects/demo.json', value => { value.sceneIds = [f.sceneIds[0]]; });
  await f.edit(`metadata/documents/${f.assemblyId}.json`, value => { value.relations = value.relations.filter(row => row.targetId === f.sceneIds[0]); });
  await f.edit(`metadata/documents/${f.sceneIds[0]}.json`, value => { value.relations = value.relations.filter(row => !['behavior', 'audio', 'animation'].includes(row.kind)); });
  const service = createProjectBuildService(f.author, { tool: process.env.VIENTO_GODOT_BIN || process.execPath, cacheRoot: path.join(f.temporary, 'cache') });
  t.after(() => service.close());
  return { ...f, service };
}
async function create(service, sceneId, content = raw(sceneId)) {
  const catalog = await service.command({ action: 'physics-replay-list', sceneId });
  return service.command({ action: 'physics-replay-save', sceneId, sceneVersion: catalog.sceneVersion,
    sourcePath: 'documents/physics-replays/输入回放.json', documentType: catalog.defaults.documentType, content });
}
async function settled(service) {
  for (let i = 0; i < 6000; i++) { const state = await service.status(); if (state.job?.status !== 'running') return state; await delay(20); }
  assert.fail('Godot job did not settle');
}

test('registered replay documents preserve source bytes and identity while rejecting stale scene and document writes', async t => {
  const f = await fixture(t), sceneId = f.sceneIds[0], before = await inventory(f.author), saved = await create(f.service, sceneId);
  assert.equal(saved.valid, true); assert.equal(saved.sceneId, sceneId); assert.deepEqual(saved.definition, program());
  assert.equal(saved.content, raw(sceneId)); assert.deepEqual(await f.service.command({ action: 'physics-replay-load', documentId: saved.id }), saved);
  assert.deepEqual(Object.keys(await inventory(f.author)).filter(file => !(file in before)).sort(),
    [saved.path, `metadata/documents/${saved.id}.json`].sort());
  for (const [file, hash] of Object.entries(before)) assert.equal((await inventory(f.author))[file], hash, file);
  const other = await f.service.command({ action: 'physics-replay-list', sceneId: f.sceneIds[1] });
  assert.ok(!other.documents.some(entry => entry.id === saved.id));
  const external = JSON.stringify({ ...envelope(sceneId), replay: { ...program(), steps: program().steps.map((step, i) => ({ ...step, right: i < 5 })) } }) + '\n';
  await fs.writeFile(path.join(f.author, saved.path), external);
  await assert.rejects(f.service.command({ action: 'physics-replay-save', sceneId, sceneVersion: saved.sceneVersion,
    documentId: saved.id, expectedVersion: saved.version, content: raw(sceneId) }), error => error.statusCode === 409);
  const changed = await f.service.command({ action: 'physics-replay-load', documentId: saved.id }); assert.equal(changed.content, external);
  const scenePath = path.join(f.author, 'documents/scenes/demo.json');
  const scene = JSON.parse(await fs.readFile(scenePath)); scene.title += ' external'; await fs.writeFile(scenePath, JSON.stringify(scene));
  await assert.rejects(f.service.command({ action: 'physics-replay-save', sceneId, sceneVersion: saved.sceneVersion,
    documentId: saved.id, expectedVersion: changed.version, content: raw(sceneId) }), error => error.statusCode === 409);
  assert.equal(await fs.readFile(path.join(f.author, saved.path), 'utf8'), external);
});

test('resource package closes replay scene dependency and migrates saved author content to an isolated workspace', async t => {
  const f = await fixture(t), sceneId = f.sceneIds[0], saved = await create(f.service, sceneId), before = await inventory(f.author);
  const catalog = await readPackageCatalog(f.author), replay = catalog.entries.find(entry => entry.id === saved.id);
  assert.ok(replay, 'saved document is in the source catalog'); assert.ok(replay.dependencies.includes(sceneId), 'scene identity is a declared dependency');
  const exportPlan = await planExport(f.author, { kind: 'resources', revision: catalog.revision, ids: [saved.id], includeDependencies: true });
  const zip = path.join(f.temporary, 'replay.viento-package.zip'); await writeExportZip(exportPlan, zip);
  const stage = path.join(f.temporary, 'unpack'); await fs.mkdir(stage); const pack = await unpackResourcePackage(zip, stage);
  assert.ok(pack.manifest.documents.some(item => item.id === saved.id)); assert.ok(pack.manifest.documents.some(item => item.id === sceneId));
  const scene = JSON.parse(await fs.readFile(path.join(f.author, 'documents/scenes/demo.json')));
  const documentIds = new Set(pack.manifest.documents.map(item => item.id));
  for (const actor of scene.actors) assert.ok(documentIds.has(actor.objectId), `actor definition ${actor.objectId} is included`);
  assert.ok(documentIds.has(f.physicsId), 'scene physics declaration is included');
  const assetIds = new Set(pack.manifest.assets.map(item => item.id));
  assert.ok(scene.actors.some(actor => actor.imageResourceId), 'fixture exercises an actual referenced image');
  for (const actor of scene.actors) if (actor.imageResourceId) assert.ok(assetIds.has(actor.imageResourceId), `actor image ${actor.imageResourceId} is included`);
  // Forge a checksum-correct archive with an unpinned missing scene. The reader
  // must reject the broken graph, even if every remaining file digest matches.
  const manifest = structuredClone(pack.manifest), bodies = new Map();
  for (const file of manifest.files) bodies.set(file.path, await fs.readFile(path.join(pack.content, file.path)));
  manifest.documents = manifest.documents.filter(item => item.id !== sceneId);
  bodies.delete('documents/scenes/demo.json'); bodies.delete(`metadata/documents/${sceneId}.json`);
  manifest.files = [...bodies].map(([name, bytes]) => ({ path: name, size: bytes.length, sha256: packageDigest(bytes) }));
  const forgedFile = path.join(f.temporary, 'forged.zip'), forged = new yazl.ZipFile();
  forged.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
  for (const [name, bytes] of bodies) forged.addBuffer(bytes, name);
  const done = pipeline(forged.outputStream, createWriteStream(forgedFile)); forged.end(); await done;
  const forgedStage = path.join(f.temporary, 'forged'); await fs.mkdir(forgedStage);
  await assert.rejects(unpackResourcePackage(forgedFile, forgedStage));
  const target = path.join(f.temporary, 'target'); await fs.mkdir(target);
  await fs.copyFile(path.join(f.author, 'workspace.json'), path.join(target, 'workspace.json'));
  await fs.cp(path.join(f.author, 'templates'), path.join(target, 'templates'), { recursive: true });
  await fs.mkdir(path.join(target, 'documents'), { recursive: true }); await registerWorkspace(target);
  const preview = await planPackageImport(target, pack); assert.deepEqual(preview.summary.conflicts, []);
  assert.equal((await applyPackageImport(target, pack, preview.revision)).status, 'imported');
  const targetService = createProjectBuildService(target, { tool: process.execPath, cacheRoot: path.join(f.temporary, 'target-cache') });
  t.after(() => targetService.close());
  const loaded = await targetService.command({ action: 'physics-replay-load', documentId: saved.id });
  assert.equal(loaded.id, saved.id); assert.equal(loaded.sceneId, sceneId); assert.equal(loaded.content, raw(sceneId)); assert.deepEqual(loaded.definition, program());
  assert.deepEqual(await inventory(f.author), before);
});

test('real Godot replays a migrated document on a separately rebuilt workspace, and refuses a wrong scene before job creation', real, async t => {
  const f = await fixture(t), sceneId = f.sceneIds[0], saved = await create(f.service, sceneId), catalog = await readPackageCatalog(f.author);
  const exportPlan = await planExport(f.author, { kind: 'resources', revision: catalog.revision,
    ids: [saved.id], includeDependencies: true });
  const zip = path.join(f.temporary, 'complete.viento-package.zip'); await writeExportZip(exportPlan, zip);
  const stage = path.join(f.temporary, 'complete-unpack'); await fs.mkdir(stage); const pack = await unpackResourcePackage(zip, stage);
  const target = path.join(f.temporary, 'target'); await fs.mkdir(target);
  await fs.copyFile(path.join(f.author, 'workspace.json'), path.join(target, 'workspace.json'));
  await fs.cp(path.join(f.author, 'templates'), path.join(target, 'templates'), { recursive: true });
  await fs.mkdir(path.join(target, 'documents'), { recursive: true }); await registerWorkspace(target);
  const preview = await planPackageImport(target, pack); assert.deepEqual(preview.summary.conflicts, []);
  await applyPackageImport(target, pack, preview.revision);
  const service = createProjectBuildService(target, { tool: process.env.VIENTO_GODOT_BIN, cacheRoot: path.join(f.temporary, 'target-cache') });
  t.after(() => service.close());
  const loaded = await service.command({ action: 'physics-replay-load', documentId: saved.id });
  assert.equal(loaded.content, raw(sceneId)); assert.deepEqual(loaded.definition, program());
  await fs.rename(f.author, f.author + '-offline');
  // The selected replay package does not imply an arbitrary project assembly.
  // Create one explicitly in the restored author workspace through its public API.
  const assemblyCatalog = await service.command({ action: 'assembly-list' });
  const assembly = await service.command({ action: 'assembly-save', worldId: assemblyCatalog.worldId,
    baseRevision: assemblyCatalog.baseRevision, sourcePath: 'documents/projects/restored.json',
    documentType: assemblyCatalog.defaults.documentType,
    content: JSON.stringify({ format: 'viento-project-assembly', schemaVersion: 1,
      title: 'Restored project', entrySceneId: sceneId, sceneIds: [sceneId] }) });
  const before = await inventory(target);
  await service.command({ action: 'build', targetId: assembly.id }); const built = await settled(service);
  assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job.diagnostics));
  const buildId = built.job.buildId, beforeJobId = built.job.id;
  await assert.rejects(service.command({ action: 'run', buildId, mode: 'headless', physicsControlProgram: loaded.definition, physicsReplaySceneId: f.sceneIds[1] }));
  assert.equal((await service.status()).job.id, beforeJobId);
  await service.command({ action: 'run', buildId, mode: 'headless', physicsControlProgram: loaded.definition, physicsReplaySceneId: loaded.sceneId });
  const ran = await settled(service); assert.equal(ran.job.status, 'succeeded', JSON.stringify(ran.job.diagnostics));
  assert.equal(ran.job.physicsControl.complete, true); assert.deepEqual(ran.job.physicsControl.program, program());
  const samples = ran.job.physics.samples; assert.equal(samples.length, 30);
  assert.ok(samples[14].positionAfter[0] > samples[0].positionBefore[0] + 40);
  assert.ok(samples[6].positionAfter[1] < samples[6].positionBefore[1] - 1);
  assert.deepEqual(await inventory(target), before);
});
