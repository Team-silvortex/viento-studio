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
