import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRuntimeCaseDocumentService } from '../lib/runtime-case-documents.mjs';
import { createRuntimeCaseSuiteDocumentService } from '../lib/runtime-case-suites.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { readRegistry } from '../lib/workspace.mjs';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const instanceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const assemblyId = '12345678-1234-4234-8234-123456789abc';
const assemblyPath = 'documents/projects/entry.json';
const casePath = 'documents/cases/entry.json';
const released = { left: false, right: false, up: false, down: false };

async function makeAuthor(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-entry-case-package-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'author');
  await fs.cp(new URL('../../examples/bevy-headless/', import.meta.url), root, { recursive: true });
  await fs.mkdir(path.join(root, 'documents/projects'), { recursive: true });
  await fs.mkdir(path.join(root, 'documents/cases'), { recursive: true });
  const assembly = { format: 'viento-project-assembly', schemaVersion: 1, title: 'Entry project', entrySceneId: sceneId, sceneIds: [sceneId] };
  await fs.writeFile(path.join(root, assemblyPath), JSON.stringify(assembly, null, 2) + '\n');
  const sceneRecord = JSON.parse(await fs.readFile(path.join(root, `metadata/documents/${sceneId}.json`), 'utf8'));
  await fs.writeFile(path.join(root, `metadata/documents/${assemblyId}.json`), JSON.stringify({ ...sceneRecord, id: assemblyId, sourcePath: assemblyPath, relations: [], assetBindings: [] }));
  const author = createRuntimeCaseDocumentService(root), catalog = await author.list(sceneId);
  const definition = { format: 'viento-runtime-case-document', schemaVersion: 1, sceneObjectId: sceneId,
    case: { format: 'viento-runtime-case', schemaVersion: 1,
      program: { format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.125, steps: [{ inputs: [{ instanceId, ...released }] }] },
      checks: [{ instanceId, stepIndex: 0, position: { value: [200, 220], tolerance: 0 }, state: 'idle' }] } };
  // Preserve BOM, CRLF and original text through the same writer the editor uses.
  const content = '\uFEFF' + JSON.stringify(definition, null, 2).replace(/\n/g, '\r\n') + '\r\n';
  const saved = await author.save({ sceneId, sceneVersion: catalog.sceneVersion, sourcePath: casePath,
    documentType: catalog.defaults.documentType, content });
  assert.equal(saved.content, content);
  assert.equal(saved.sceneId, sceneId);
  return { base, root, saved, content };
}

async function makeTarget(f, name) {
  const root = path.join(f.base, name);
  await fs.cp(new URL('../../examples/bevy-headless/', import.meta.url), root, { recursive: true });
  const workspacePath = path.join(root, 'workspace.json');
  const workspace = JSON.parse(await fs.readFile(workspacePath, 'utf8'));
  workspace.id = randomUUID(); workspace.version = 2;
  workspace.paths.documents = 'design-data'; workspace.paths.templates = 'data-template';
  await fs.writeFile(workspacePath, JSON.stringify(workspace, null, 2));
  await fs.rename(path.join(root, 'templates'), path.join(root, 'data-template'));
  for (const name of ['documents', 'metadata', 'assets', '.viento']) await fs.rm(path.join(root, name), { recursive: true, force: true });
  for (const name of ['design-data', 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(root, name), { recursive: true });
  return root;
}

async function exportSelection(f, name, ids, includeChildren) {
  const catalog = await readPackageCatalog(f.root);
  const plan = await planExport(f.root, { kind: 'resources', revision: catalog.revision, ids,
    includeDependencies: true, includeChildren });
  const file = path.join(f.base, `${name}.zip`), stage = path.join(f.base, `${name}-unpacked`);
  await writeExportZip(plan, file); await fs.mkdir(stage);
  return unpackResourcePackage(file, stage);
}

test('entry case follows explicit selection or included scene children, with exact source and identity after relocation', async t => {
  const f = await makeAuthor(t), beforeCase = await fs.readFile(path.join(f.root, casePath));
  const catalog = await readPackageCatalog(f.root);
  assert.ok(catalog.entries.find(item => item.id === assemblyId).dependencies.includes(sceneId));
  assert.ok(catalog.entries.find(item => item.id === sceneId).children.includes(f.saved.id));
  assert.ok(catalog.entries.find(item => item.id === f.saved.id).dependencies.includes(sceneId));
  for (const scenario of [
    { name: 'explicit-case', ids: [f.saved.id], includeChildren: false, includesAssembly: false, includesCase: true },
    { name: 'assembly-with-children', ids: [assemblyId], includeChildren: true, includesAssembly: true, includesCase: true },
    { name: 'assembly-without-children', ids: [assemblyId], includeChildren: false, includesAssembly: true, includesCase: false },
  ]) {
    const pack = await exportSelection(f, scenario.name, scenario.ids, scenario.includeChildren);
    const ids = new Set(pack.manifest.documents.map(item => item.id));
    assert.equal(ids.has(assemblyId), scenario.includesAssembly, scenario.name);
    assert.equal(ids.has(f.saved.id), scenario.includesCase, scenario.name);
    assert.ok(ids.has(sceneId), scenario.name); assert.ok(ids.has(actorId), scenario.name);
    const target = await makeTarget(f, scenario.name + '-target');
    const preview = await planPackageImport(target, pack);
    assert.deepEqual(preview.summary.conflicts, [], scenario.name);
    assert.equal((await applyPackageImport(target, pack, preview.revision)).status, 'imported');
    const records = await readRegistry(target);
    if (scenario.includesCase) {
      const record = records.documents.find(item => item.id === f.saved.id);
      assert.equal(record.sourcePath, 'design-data/cases/entry.json');
      assert.deepEqual(await fs.readFile(path.join(target, record.sourcePath)), beforeCase);
      const loaded = await createRuntimeCaseDocumentService(target).load(f.saved.id);
      assert.equal(loaded.valid, true); assert.equal(loaded.sceneId, sceneId); assert.equal(loaded.content, f.content);
      assert.equal(loaded.definition.checks[0].instanceId, instanceId);
    } else {
      assert.equal(records.documents.some(item => item.id === f.saved.id), false);
      await assert.rejects(fs.access(path.join(target, 'design-data/cases/entry.json')), { code: 'ENOENT' });
    }
    if (scenario.includesAssembly) {
      const record = records.documents.find(item => item.id === assemblyId);
      const assembly = JSON.parse(await fs.readFile(path.join(target, record.sourcePath), 'utf8'));
      assert.equal(assembly.entrySceneId, sceneId);
    }
  }
  assert.deepEqual(await fs.readFile(path.join(f.root, casePath)), beforeCase);
});


test('entry suite selection and assembly children preserve ordered case dependencies and original bytes across migration', async t => {
  const f = await makeAuthor(t), cases = createRuntimeCaseDocumentService(f.root);
  const caseDefinition = JSON.parse(f.content.replace(/^\uFEFF/, ''));
  caseDefinition.case.checks[0].position.value[0] += 1;
  const secondContent = '\uFEFF' + JSON.stringify(caseDefinition, null, '\t').replace(/\n/g, '\r\n') + '\r\n';
  const caseCatalog = await cases.list(sceneId);
  const second = await cases.save({ sceneId, sceneVersion: caseCatalog.sceneVersion,
    sourcePath: 'documents/cases/second.json', documentType: caseCatalog.defaults.documentType, content: secondContent });
  const groups = createRuntimeCaseSuiteDocumentService(f.root), groupCatalog = await groups.list(sceneId);
  const suite = { format: 'viento-runtime-case-suite', schemaVersion: 1, sceneObjectId: sceneId,
    documentIds: [second.id, f.saved.id] };
  const suiteContent = '\uFEFF' + JSON.stringify(suite, null, '\t').replace(/\n/g, '\r\n') + '\r\n';
  const group = await groups.save({ sceneId, sceneVersion: groupCatalog.sceneVersion,
    sourcePath: 'documents/suites/entry.json', documentType: groupCatalog.defaults.documentType, content: suiteContent });
  const before = new Map([[f.saved.id, Buffer.from(f.content)], [second.id, Buffer.from(secondContent)], [group.id, Buffer.from(suiteContent)]]);
  const catalog = await readPackageCatalog(f.root);
  const suiteEntry = catalog.entries.find(item => item.id === group.id);
  assert.deepEqual(new Set(suiteEntry.dependencies), new Set([sceneId, second.id, f.saved.id]));
  assert.ok(catalog.entries.find(item => item.id === sceneId).children.includes(group.id));

  for (const scenario of [
    { name: 'explicit-suite', ids: [group.id], includeChildren: false, assembly: false, cases: true },
    { name: 'suite-assembly-with-children', ids: [assemblyId], includeChildren: true, assembly: true, cases: true },
    { name: 'suite-assembly-without-children', ids: [assemblyId], includeChildren: false, assembly: true, cases: false },
  ]) {
    const pack = await exportSelection(f, scenario.name, scenario.ids, scenario.includeChildren);
    const ids = new Set(pack.manifest.documents.map(item => item.id));
    assert.deepEqual(ids, new Set([sceneId, actorId, ...(scenario.assembly ? [assemblyId] : []),
      ...(scenario.cases ? [group.id, second.id, f.saved.id] : [])]), scenario.name);
    const target = await makeTarget(f, scenario.name + '-target');
    const preview = await planPackageImport(target, pack);
    assert.deepEqual(preview.summary.conflicts, [], scenario.name);
    assert.equal((await applyPackageImport(target, pack, preview.revision)).status, 'imported');
    const records = await readRegistry(target);
    if (scenario.cases) {
      for (const [id, bytes] of before) {
        const record = records.documents.find(item => item.id === id);
        assert.ok(record?.sourcePath.startsWith('design-data/'), scenario.name);
        assert.deepEqual(await fs.readFile(path.join(target, record.sourcePath)), bytes, scenario.name);
      }
      const loaded = await createRuntimeCaseSuiteDocumentService(target).load(group.id);
      assert.equal(loaded.valid, true, scenario.name);
      assert.equal(loaded.sceneId, sceneId, scenario.name);
      assert.deepEqual(loaded.definition.documentIds, [second.id, f.saved.id], scenario.name);
      assert.equal(loaded.content, suiteContent, scenario.name);
    } else {
      for (const id of before.keys()) assert.equal(records.documents.some(item => item.id === id), false, scenario.name);
    }
    if (scenario.assembly) {
      const record = records.documents.find(item => item.id === assemblyId);
      const assembly = JSON.parse(await fs.readFile(path.join(target, record.sourcePath), 'utf8'));
      assert.equal(assembly.entrySceneId, sceneId, scenario.name);
    }
  }
  for (const [id, bytes] of before) {
    const record = (await readRegistry(f.root)).documents.find(item => item.id === id);
    assert.deepEqual(await fs.readFile(path.join(f.root, record.sourcePath)), bytes);
  }
});
