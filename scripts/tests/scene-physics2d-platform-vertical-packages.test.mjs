import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { scenePhysics2DPlatformMotionAuthor } from './helpers/scene-physics2d-platform-motion-author-fixture.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';

async function hashes(root, prefix = '') {
  const result = {};
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await hashes(root, name));
    else { assert.ok(entry.isFile()); result[name] = createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex'); }
  }
  return result;
}

// This is author migration. Native generation and offline generated-project
// delivery are verified separately by platform-vertical-backends.test.mjs.
test('vertical platform author closure relocates intact and produces the same frozen semantic plan', async t => {
  const f = await scenePhysics2DPlatformMotionAuthor(t, { consumers: false });
  const declaration = await f.read(f.physicsPath);
  declaration.schemaVersion = 6;
  const body = declaration.bodies.find(body => body.id === f.platformBodyId);
  body.platformMotion = { kind: 'vertical', offsetY: -48, speed: 240 };
  const content = '\uFEFF' + JSON.stringify(declaration, null, '\t').replace(/\n/g, '\r\n') + '\r\n';
  await fs.writeFile(path.join(f.author, f.physicsPath), content);
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const before = await hashes(f.author), registry = await readRegistry(f.author);
  const catalog = await readPackageCatalog(f.author);
  const plan = await planExport(f.author, { kind: 'resources', revision: catalog.revision,
    ids: [f.assemblyId], includeDependencies: true, includeChildren: false });
  const zip = path.join(f.temporary, 'vertical-author.zip');
  await writeExportZip(plan, zip);
  const stage = path.join(f.temporary, 'unpacked'); await fs.mkdir(stage);
  const pack = await unpackResourcePackage(zip, stage);
  const transferred = new Set(pack.manifest.documents.map(document => document.id));
  for (const id of [f.assemblyId, f.sceneIds[0], f.physicsId]) assert.ok(transferred.has(id));

  const target = path.join(f.temporary, 'relocated-author');
  await fs.cp(f.author, target, { recursive: true });
  const workspacePath = path.join(target, 'workspace.json');
  const workspace = JSON.parse(await fs.readFile(workspacePath, 'utf8'));
  workspace.id = randomUUID(); workspace.version = 2; workspace.paths = { documents: 'design-data', templates: 'data-template', metadata: 'metadata' };
  await fs.rename(path.join(target, 'templates'), path.join(target, 'data-template'));
  await fs.writeFile(workspacePath, JSON.stringify(workspace, null, 2) + '\n');
  for (const name of ['documents', 'metadata', 'assets', '.viento']) await fs.rm(path.join(target, name), { recursive: true, force: true });
  for (const name of ['design-data', 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(target, name), { recursive: true });
  const preview = await planPackageImport(target, pack);
  assert.deepEqual(preview.summary.conflicts, []);
  assert.equal((await applyPackageImport(target, pack, preview.revision)).status, 'imported');
  const relocated = await readRegistry(target);
  for (const original of registry.documents.filter(document => transferred.has(document.id))) {
    const copy = relocated.documents.find(document => document.id === original.id);
    assert.equal(copy.sourcePath, original.sourcePath.replace(/^documents\//, 'design-data/'));
    assert.deepEqual(await fs.readFile(path.join(target, copy.sourcePath)), await fs.readFile(path.join(f.author, original.sourcePath)));
    assert.deepEqual(copy.relations, original.relations);
    assert.deepEqual(copy.assetBindings, original.assetBindings);
  }
  const physics = relocated.documents.find(document => document.id === f.physicsId);
  assert.equal(await fs.readFile(path.join(target, physics.sourcePath), 'utf8'), content);
  const rebuilt = await captureBuildSnapshot(target, f.assemblyId);
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt.diagnostics));
  assert.deepEqual(rebuilt.plan.requiredCapabilities, captured.plan.requiredCapabilities);
  const oldScene = captured.plan.scenes.find(scene => scene.physics), newScene = rebuilt.plan.scenes.find(scene => scene.physics);
  assert.deepEqual(newScene.physics.document, oldScene.physics.document);
  assert.equal(newScene.physics.document.bodies.find(body => body.id === f.platformBodyId).platformMotion.offsetY, -48);
  assert.equal(newScene.physics.manifest.objectId, f.physicsId);
  assert.equal(newScene.physics.manifest.sourceRevision, oldScene.physics.manifest.sourceRevision);
  assert.equal(newScene.physics.manifest.sourcePath, 'design-data/physics/scene-0.json');
  assert.deepEqual(await hashes(f.author), before);
});
