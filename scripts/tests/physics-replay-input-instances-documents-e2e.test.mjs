import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { scenePhysics2DInputInstancesAuthor, physicsInstanceReplay, physicsInstanceCase } from './helpers/scene-physics2d-input-instances-author-fixture.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { createPhysicsReplayDocumentService } from '../lib/physics-replay-documents.mjs';
import { createPhysicsReplayCaseDocumentService } from '../lib/physics-replay-case-documents.mjs';
import { readPackageCatalog, packageDigest } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { registerWorkspace } from '../lib/workspace.mjs';
import { inventory } from './runtime-case-fixture.mjs';

const unknown = '74747474-7474-4474-8474-000000000999';
const envelope = (f, kind) => ({ format: kind === 'replay' ? 'viento-physics2d-replay-document' : 'viento-physics2d-replay-case-document',
  schemaVersion: 1, sceneObjectId: f.sceneIds[0], [kind === 'replay' ? 'replay' : 'case']: kind === 'replay'
    ? physicsInstanceReplay(f.instanceId, f.secondInstanceId) : physicsInstanceCase(f.instanceId, f.secondInstanceId) });
const raw = value => '\ufeff' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
async function fixture(t) {
  const f = await scenePhysics2DInputInstancesAuthor(t), cacheRoot = path.join(f.temporary, 'document-only-cache');
  const service = createProjectBuildService(f.author, { tool: process.execPath, cacheRoot });
  t.after(() => service.close());
  return { ...f, service, cacheRoot };
}
async function save(f, kind, value, name = kind) {
  const action = kind === 'replay' ? 'physics-replay' : 'physics-case';
  const catalog = await f.service.command({ action: `${action}-list`, sceneId: f.sceneIds[0] });
  return f.service.command({ action: `${action}-save`, sceneId: f.sceneIds[0], sceneVersion: catalog.sceneVersion,
    sourcePath: `documents/physics-tests/${name}-双角色.json`, documentType: catalog.defaults.documentType, content: raw(value) });
}

test('v2 replay and embedded-case programs save, update and reload same-OC inputs while unknown source targets cause no write', async t => {
  const f = await fixture(t), original = await inventory(f.author);
  for (const kind of ['replay', 'case']) {
    const action = kind === 'replay' ? 'physics-replay' : 'physics-case', value = envelope(f, kind), content = raw(value);
    const saved = await save(f, kind, value);
    assert.equal(saved.valid, true); assert.equal(saved.content, content);
    const definition = kind === 'replay' ? value.replay : value.case;
    assert.deepEqual(saved.definition, definition);
    assert.deepEqual(await f.service.command({ action: `${action}-load`, documentId: saved.id }), saved);
    const changed = structuredClone(value), input = kind === 'replay' ? changed.replay : changed.case.program;
    input.steps[2].inputs[1].jump = true;
    const updated = await f.service.command({ action: `${action}-save`, sceneId: f.sceneIds[0], sceneVersion: saved.sceneVersion,
      documentId: saved.id, expectedVersion: saved.version, content: raw(changed) });
    assert.equal(updated.id, saved.id); assert.notEqual(updated.version, saved.version);
    assert.equal(updated.content, raw(changed));
    assert.deepEqual((await f.service.command({ action: `${action}-load`, documentId: saved.id })).definition, updated.definition);
    const invalid = structuredClone(changed), invalidInput = kind === 'replay' ? invalid.replay : invalid.case.program;
    invalidInput.steps[3].inputs[1].instanceId = unknown;
    const beforeReject = await inventory(f.author), errorCode = kind === 'replay'
      ? 'runtime_physics_replay_instance_missing' : 'runtime_physics_case_instance_missing';
    await assert.rejects(f.service.command({ action: `${action}-save`, sceneId: f.sceneIds[0], sceneVersion: updated.sceneVersion,
      documentId: updated.id, expectedVersion: updated.version, content: raw(invalid) }), { errorCode });
    await assert.rejects(save(f, kind, invalid, `${kind}-invalid`), { errorCode });
    assert.deepEqual(await inventory(f.author), beforeReject);
    assert.equal(await fs.readFile(path.join(f.author, saved.path), 'utf8'), raw(changed));
  }
  const after = await inventory(f.author);
  for (const [name, hash] of Object.entries(original)) assert.equal(after[name], hash, name);
  assert.equal(Object.keys(after).length, Object.keys(original).length + 4);
  assert.equal((await f.service.status()).job, null);
  await assert.rejects(fs.stat(f.cacheRoot), { code: 'ENOENT' });
});

test('v2 replay and acceptance selectively export their complete dependencies and reload offline after migration', async t => {
  const f = await fixture(t), values = [envelope(f, 'replay'), envelope(f, 'case')];
  const saved = [await save(f, 'replay', values[0]), await save(f, 'case', values[1])], before = await inventory(f.author);
  const catalog = await readPackageCatalog(f.author), sceneId = f.sceneIds[0];
  for (const document of saved) {
    const entry = catalog.entries.find(item => item.id === document.id);
    assert.ok(entry.dependencies.includes(sceneId)); assert.deepEqual(entry.problems, []);
  }
  const exportPlan = await planExport(f.author, { kind: 'resources', revision: catalog.revision,
    ids: saved.map(item => item.id), includeDependencies: true });
  const archive = path.join(f.temporary, 'two-instance-inputs.viento-package.zip'); await writeExportZip(exportPlan, archive);
  const stage = path.join(f.temporary, 'input-unpack'); await fs.mkdir(stage);
  const pack = await unpackResourcePackage(archive, stage), documentIds = new Set(pack.manifest.documents.map(item => item.id));
  for (const id of [sceneId, f.physicsId, ...saved.map(item => item.id)]) assert.ok(documentIds.has(id), `retained ${id}`);
  const scene = JSON.parse(await fs.readFile(path.join(f.author, 'documents/scenes/demo.json'))), sharedOC = scene.actors[0].objectId;
  assert.equal(scene.actors.find(item => item.instanceId === f.secondInstanceId).objectId, sharedOC);
  assert.equal(pack.manifest.documents.filter(item => item.id === sharedOC).length, 1, 'one OC definition supports both stable scene instances');
  const assetIds = new Set(pack.manifest.assets.map(item => item.id));
  for (const actor of scene.actors) if (actor.imageResourceId) assert.ok(assetIds.has(actor.imageResourceId));
  // Recompute every file digest after forging an input reference. Valid ZIP
  // checksums cannot excuse a target absent from the included saved scene.
  for (const index of [0, 1]) {
    const manifest = structuredClone(pack.manifest), bodies = new Map();
    for (const file of manifest.files) bodies.set(file.path, await fs.readFile(path.join(pack.content, file.path)));
    const forgedValue = structuredClone(values[index]), program = index === 0 ? forgedValue.replay : forgedValue.case.program;
    program.steps[0].inputs[0].instanceId = unknown;
    bodies.set(saved[index].path, Buffer.from(raw(forgedValue)));
    manifest.files = [...bodies].map(([name, bytes]) => ({ path: name, size: bytes.length, sha256: packageDigest(bytes) }));
    const forged = new yazl.ZipFile(), filename = path.join(f.temporary, `forged-input-${index}.zip`);
    forged.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
    for (const [name, bytes] of bodies) forged.addBuffer(bytes, name);
    const written = pipeline(forged.outputStream, createWriteStream(filename)); forged.end(); await written;
    const forgedStage = path.join(f.temporary, `forged-input-${index}`); await fs.mkdir(forgedStage);
    await assert.rejects(unpackResourcePackage(filename, forgedStage));
  }
  const target = path.join(f.temporary, 'imported'); await fs.mkdir(target);
  await fs.copyFile(path.join(f.author, 'workspace.json'), path.join(target, 'workspace.json'));
  await fs.cp(path.join(f.author, 'templates'), path.join(target, 'templates'), { recursive: true });
  await fs.mkdir(path.join(target, 'documents'), { recursive: true }); await registerWorkspace(target);
  const preview = await planPackageImport(target, pack); assert.deepEqual(preview.summary.conflicts, []);
  assert.equal((await applyPackageImport(target, pack, preview.revision)).status, 'imported');
  assert.deepEqual(await inventory(f.author), before);
  await fs.rename(f.author, f.author + '-offline');
  const services = [createPhysicsReplayDocumentService(target), createPhysicsReplayCaseDocumentService(target)];
  for (const [index, service] of services.entries()) {
    const loaded = await service.load(saved[index].id);
    assert.equal(loaded.valid, true); assert.equal(loaded.content, raw(values[index]));
    assert.deepEqual(loaded.definition, index === 0 ? values[index].replay : values[index].case);
  }
  assert.deepEqual(await inventory(f.author + '-offline'), before);
});

test('stale v2 input instance references mark source documents invalid and prevent export even when checks still reference valid actors', async t => {
  const f = await fixture(t);
  for (const kind of ['replay', 'case']) {
    const value = envelope(f, kind), saved = await save(f, kind, value), changed = structuredClone(value);
    const program = kind === 'replay' ? changed.replay : changed.case.program;
    program.steps[1].inputs[1].instanceId = unknown;
    await fs.writeFile(path.join(f.author, saved.path), raw(changed));
    const action = kind === 'replay' ? 'physics-replay' : 'physics-case';
    const loaded = await f.service.command({ action: `${action}-load`, documentId: saved.id });
    assert.equal(loaded.valid, false); assert.equal(loaded.content, raw(changed));
    const errorCode = kind === 'replay' ? 'runtime_physics_replay_instance_missing' : 'runtime_physics_case_instance_missing';
    assert.ok(loaded.diagnostics.some(item => item.code === errorCode));
    const catalog = await readPackageCatalog(f.author), entry = catalog.entries.find(item => item.id === saved.id);
    assert.ok(entry.problems.includes('正文解析失败'), 'catalog exposes its established generic source-parse problem');
    const before = await inventory(f.author);
    await assert.rejects(planExport(f.author, { kind: 'resources', revision: catalog.revision, ids: [saved.id], includeDependencies: true }));
    assert.deepEqual(await inventory(f.author), before);
  }
});
