import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { readPackageCatalog, inspectPackageProjectAssembly } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { registerWorkspace } from '../lib/workspace.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { createProjectAssemblyDocumentService } from '../lib/project-assembly-documents.mjs';

async function fixture(t, { dependencies = true } = {}) {
  const f = await projectAssemblyAuthor(t);
  const file = path.join(f.author, `metadata/documents/${f.assemblyId}.json`), record = JSON.parse(await fs.readFile(file));
  record.relations = []; await fs.writeFile(file, JSON.stringify(record));
  const catalog = await readPackageCatalog(f.author);
  const plan = await planExport(f.author, { kind: 'resources', revision: catalog.revision, ids: [f.assemblyId], includeDependencies: dependencies, includeChildren: false });
  const zip = path.join(f.temporary, 'assembly.zip'); await writeExportZip(plan, zip);
  const staging = path.join(f.temporary, 'unpacked'); await fs.mkdir(staging);
  const pack = await unpackResourcePackage(zip, staging);
  const target = path.join(f.temporary, 'target'); await fs.mkdir(target);
  await fs.copyFile(path.join(f.author, 'workspace.json'), path.join(target, 'workspace.json'));
  await fs.mkdir(path.join(target, 'documents')); await fs.mkdir(path.join(target, 'assets'));
  await registerWorkspace(target);
  return { ...f, catalog, plan, pack, target };
}

test('assembly package derives member closure from author source and round trips all scenes and runtime dependencies', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.catalog.entries.find(item => item.id === f.assemblyId).dependencies, [...f.sceneIds].sort());
  for (const id of [...f.sceneIds, f.scriptId]) assert.ok(f.pack.manifest.documents.some(item => item.id === id));
  assert.ok(f.pack.manifest.assets.some(item => item.id === f.waveId));
  assert.deepEqual(f.pack.records.get(f.assemblyId).record.relations, []);
  const preview = await planPackageImport(f.target, f.pack);
  assert.deepEqual(preview.summary.conflicts, []);
  assert.equal((await applyPackageImport(f.target, f.pack, preview.revision)).status, 'imported');
  const captured = await captureBuildSnapshot(f.target, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.deepEqual(captured.plan.scenes.map(item => item.scene.objectId), f.sceneIds);
  assert.equal(captured.plan.resources.length, 2);
  assert.deepEqual(await fs.readFile(path.join(f.target, 'documents/projects/demo.json')), await fs.readFile(path.join(f.author, 'documents/projects/demo.json')));
});

test('assembly export refuses malformed or unreadable member declarations', async t => {
  const f = await projectAssemblyAuthor(t);
  await fs.writeFile(path.join(f.author, 'documents/scenes/audio.json'), '{"format":"viento-scene-composition","schemaVersion":1}');
  const catalog = await readPackageCatalog(f.author);
  assert.ok(catalog.entries.find(item => item.id === f.assemblyId).problems.length);
  await assert.rejects(planExport(f.author, { kind: 'resources', revision: catalog.revision, ids: [f.assemblyId] }));
  const content = Buffer.from('{"format":"viento-project-assembly","schemaVersion":1}');
  assert.equal(inspectPackageProjectAssembly(content, 'ordinary.txt').ok, false);
});

test('assembly import rejects member IDs omitted from package declarations', async t => {
  const f = await fixture(t);
  f.pack.manifest.documents = f.pack.manifest.documents.filter(item => item.id !== f.sceneIds[1]);
  await assert.rejects(planPackageImport(f.target, f.pack));
});

test('assembly-only packages declare both external scene requirements and reject absent destinations', async t => {
  const f = await fixture(t, { dependencies: false });
  assert.equal(f.pack.manifest.documents.length, 1);
  assert.deepEqual(new Set(f.pack.manifest.requirements.map(item => item.id)), new Set(f.sceneIds));
  assert.ok((await planPackageImport(f.target, f.pack)).summary.conflicts.length);
});


test('assembly import verifies declared member source kinds rather than UUID availability alone', async t => {
  const f = await fixture(t), file = path.join(f.pack.content, 'documents/projects/demo.json');
  const value = JSON.parse(await fs.readFile(file)); value.sceneIds[1] = f.scriptId;
  await fs.writeFile(file, JSON.stringify(value));
  const preview = await planPackageImport(f.target, f.pack);
  assert.ok(preview.summary.conflicts.some(item => JSON.stringify(item).includes('dependency')));
});


test('input mapping follows the assembly through selection, export and offline import', async t => {
  const f = await projectAssemblyAuthor(t), inputId = '33333333-3333-4333-8333-333333333333';
  const assemblyPath = path.join(f.author, 'documents/projects/demo.json');
  const assembly = JSON.parse(await fs.readFile(assemblyPath));
  const input = { format: 'viento-input-map', schemaVersion: 1, actions: [{ name: 'left', keys: ['KeyA', 'ArrowLeft'] }] };
  const inputPath = 'documents/projects/controls.json', inputBytes = JSON.stringify(input, null, 2) + '\n';
  await fs.writeFile(path.join(f.author, inputPath), inputBytes);
  const recordPath = path.join(f.author, `metadata/documents/${f.assemblyId}.json`), record = JSON.parse(await fs.readFile(recordPath));
  await fs.writeFile(path.join(f.author, `metadata/documents/${inputId}.json`), JSON.stringify({ ...record, id: inputId, sourcePath: inputPath, relations: [], assetBindings: [] }));
  await fs.writeFile(assemblyPath, JSON.stringify({ ...assembly, schemaVersion: 2, inputMapId: inputId }, null, 2));
  const catalog = await readPackageCatalog(f.author), assemblyEntry = catalog.entries.find(item => item.id === f.assemblyId);
  assert.ok(assemblyEntry.dependencies.includes(inputId)); assert.deepEqual(assemblyEntry.problems, []);
  const plan = await planExport(f.author, { kind: 'resources', revision: catalog.revision, ids: [f.assemblyId], includeDependencies: true, includeChildren: false });
  const zip = path.join(f.temporary, 'with-input.zip'); await writeExportZip(plan, zip);
  const staging = path.join(f.temporary, 'unpacked-input'); await fs.mkdir(staging);
  const pack = await unpackResourcePackage(zip, staging); assert.ok(pack.manifest.documents.some(item => item.id === inputId));
  const target = path.join(f.temporary, 'target-input'); await fs.mkdir(target);
  await fs.copyFile(path.join(f.author, 'workspace.json'), path.join(target, 'workspace.json'));
  await fs.mkdir(path.join(target, 'documents')); await fs.mkdir(path.join(target, 'assets')); await registerWorkspace(target);
  const documents = pack.manifest.documents;
  pack.manifest.documents = documents.filter(item => item.id !== inputId);
  assert.ok((await planPackageImport(target, pack)).summary.conflicts.length);
  pack.manifest.documents = documents;
  const preview = await planPackageImport(target, pack); assert.deepEqual(preview.summary.conflicts, []);
  assert.equal((await applyPackageImport(target, pack, preview.revision)).status, 'imported');
  await fs.rename(f.author, `${f.author}-offline`);
  const captured = await captureBuildSnapshot(target, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics)); assert.equal(captured.plan.schemaVersion, 2);
  assert.deepEqual(captured.plan.inputMap.document, input); assert.equal(await fs.readFile(path.join(target, inputPath), 'utf8'), inputBytes);
  await fs.writeFile(path.join(target, inputPath), '{}');
  assert.equal(captured.plan.inputMap.document.actions[0].keys[0], 'KeyA');
  const after = await captureBuildSnapshot(target, f.assemblyId); assert.equal(after.ok, false);
});


test('assembly editor lists valid registered input maps and protects saved versions', async t => {
  const f = await projectAssemblyAuthor(t), inputId = '33333333-3333-4333-8333-333333333333';
  const record = JSON.parse(await fs.readFile(path.join(f.author, `metadata/documents/${f.assemblyId}.json`)));
  const inputPath = 'documents/projects/controls.json', input = { format: 'viento-input-map', schemaVersion: 1, actions: [{ name: 'jump', keys: ['Space'] }] };
  await fs.writeFile(path.join(f.author, inputPath), JSON.stringify(input));
  await fs.writeFile(path.join(f.author, `metadata/documents/${inputId}.json`), JSON.stringify({ ...record, id: inputId, sourcePath: inputPath, relations: [], assetBindings: [] }));
  const service = createProjectAssemblyDocumentService(f.author), catalog = await service.list();
  assert.equal(catalog.inputMaps.length, 1); assert.equal(catalog.inputMaps[0].id, inputId); assert.equal(catalog.inputMaps[0].path, inputPath);
  const existing = await service.load(f.assemblyId), assembly = { ...existing.definition, schemaVersion: 2, inputMapId: inputId };
  const saved = await service.save({ worldId: existing.worldId, baseRevision: existing.baseRevision, documentId: f.assemblyId, expectedVersion: existing.version, content: JSON.stringify(assembly) });
  assert.equal(saved.valid, true); assert.equal(saved.definition.inputMapId, inputId);
  await fs.writeFile(path.join(f.author, inputPath), JSON.stringify({ ...input, actions: [{ name: 'ui_cancel', keys: ['Space'] }] }));
  const changed = await service.list(); assert.equal(changed.inputMaps.length, 0); assert.equal(changed.documents[0].valid, false);
  await assert.rejects(service.save({ worldId: changed.worldId, baseRevision: changed.baseRevision, documentId: saved.id, expectedVersion: saved.version, content: JSON.stringify(assembly) }), { errorCode: 'project_assembly_document_invalid' });
  assert.equal((await service.load(f.assemblyId)).definition.inputMapId, inputId);
});
