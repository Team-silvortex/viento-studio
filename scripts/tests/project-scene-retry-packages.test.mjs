import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT } from '../../engine/godot-scene-retry-script.mjs';
import { hudDocument, hudId } from './helpers/scene-hud2d-fixture.mjs';
import { projectSceneRetryAuthor, sceneRetryInventory, retryFixtureJson as json } from './helpers/project-scene-retry-author-fixture.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';

const hudObjectId = '76543210-1234-4234-8234-123456789abd';
async function fixture(t, edited = false) {
  const f = await projectSceneRetryAuthor(t, { edited });
  f.behavior.bindings[0].parameters.state_values_json = '{"score":0,"health":100,"key_found":false,"banner":"再开 / Retry / 再開 😀"}';
  if (edited) f.behavior.bindings[0].parameters.target_scene_id = '';
  await f.write('documents/behaviors/demo.json', f.behavior);
  const hud = hudDocument(undefined, f.sceneIds[1]);
  const hudContent = '\ufeff' + JSON.stringify(hud, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
  await f.write('documents/hud/retry-overlay.json', hudContent);
  const record = await f.read(`metadata/documents/${f.sceneIds[1]}.json`);
  await f.write(`metadata/documents/${hudObjectId}.json`, { ...record, id: hudObjectId, sourcePath: 'documents/hud/retry-overlay.json',
    relations: [{ kind: 'references', targetId: f.sceneIds[1], slot: 'scene' }], assetBindings: [] });
  record.relations.push({ kind: 'references', targetId: hudObjectId, slot: 'hud2d' }); await f.write(`metadata/documents/${f.sceneIds[1]}.json`, record);
  return { ...f, hud, hudContent };
}
async function exportPack(f, id = f.assemblyId) {
  const catalog = await readPackageCatalog(f.author), review = await planExport(f.author, { kind: 'resources', revision: catalog.revision, ids: [id], includeDependencies: true, includeChildren: false });
  const archive = path.join(f.temporary, 'retry.zip'); await writeExportZip(review, archive);
  const stage = path.join(f.temporary, 'unpacked'); await fs.mkdir(stage); return unpackResourcePackage(archive, stage);
}
async function relocate(f, pack) {
  const target = path.join(f.temporary, 'relocated'); await fs.mkdir(target);
  const workspace = { ...await f.read('workspace.json'), version: 2, id: hudId(101), paths: { documents: 'design-data', templates: 'data-template', metadata: 'metadata' } };
  await fs.writeFile(path.join(target, 'workspace.json'), json(workspace));
  for (const name of ['design-data', 'data-template', 'assets', 'metadata/documents', 'metadata/assets']) await fs.mkdir(path.join(target, name), { recursive: true });
  const review = await planPackageImport(target, pack); assert.deepEqual(review.summary.conflicts, [], JSON.stringify(review.summary));
  assert.equal((await applyPackageImport(target, pack, review.revision)).status, 'imported'); return target;
}

test('retry assembly migration preserves exact scripts, scalar defaults, HUD, input and resources with its original root offline', async t => {
  const f = await fixture(t), before = await sceneRetryInventory(f.author), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const pack = await exportPack(f), ids = new Set(pack.manifest.documents.map(row => row.id));
  for (const id of [f.assemblyId, ...f.sceneIds, f.scriptId, f.inputMapId, hudObjectId]) assert.ok(ids.has(id), id);
  assert.ok(pack.manifest.assets.some(row => row.id === f.waveId)); assert.equal(pack.manifest.format, 'viento-resource-package'); assert.equal(pack.manifest.version, 1);
  const target = await relocate(f, pack); await fs.rename(f.author, f.author + '-offline');
  const rebuilt = await captureBuildSnapshot(target, f.assemblyId);
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt.diagnostics)); assert.equal(rebuilt.plan.schemaVersion, captured.plan.schemaVersion);
  assert.deepEqual(rebuilt.plan.requiredCapabilities, captured.plan.requiredCapabilities); assert.equal(rebuilt.plan.entrySceneId, f.entrySceneId);
  assert.deepEqual(rebuilt.plan.scenes.map(scene => scene.scene.objectId), f.sceneIds); assert.deepEqual(rebuilt.plan.inputMap.document, f.inputMap);
  assert.deepEqual(rebuilt.plan.scenes[1].hud2d.document, f.hud);
  const behavior = rebuilt.plan.scenes[0].behaviors;
  assert.deepEqual(behavior.bindings.map(row => [row.bindingId, row.instanceId, row.parameters]), captured.plan.scenes[0].behaviors.bindings.map(row => [row.bindingId, row.instanceId, row.parameters]));
  assert.equal(behavior.sources.find(row => row.objectId === f.scriptId).content, GODOT_ACTION_SCENE_RETRY_SCRIPT);
  assert.equal(await fs.readFile(path.join(target, 'design-data/scripts/checkpoint.txt'), 'utf8'), GODOT_ACTION_SCENE_RETRY_SCRIPT);
  assert.equal(await fs.readFile(path.join(target, 'design-data/hud/retry-overlay.json'), 'utf8'), f.hudContent);
  assert.equal(rebuilt.plan.scenes[1].hud2d.manifest.sourcePath, 'design-data/hud/retry-overlay.json');
  assert.equal(rebuilt.plan.scenes[1].audio.document.tracks[0].resourceId, captured.plan.scenes[1].audio.document.tracks[0].resourceId);
  assert.deepEqual(await sceneRetryInventory(f.author + '-offline'), before);
});

test('edited retry source stays ordinary author text through unchanged resource archive migration', async t => {
  const f = await fixture(t, true), before = await sceneRetryInventory(f.author), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const pack = await exportPack(f), target = await relocate(f, pack); await fs.rename(f.author, f.author + '-offline');
  const rebuilt = await captureBuildSnapshot(target, f.assemblyId);
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt.diagnostics));
  assert.equal(rebuilt.plan.scenes[0].behaviors.sources.find(row => row.objectId === f.scriptId).content, f.content);
  assert.equal(rebuilt.plan.scenes[0].behaviors.bindings[0].parameters.target_scene_id, '');
  assert.ok(!rebuilt.diagnostics.some(row => row.code.startsWith('build_scene_retry_'))); assert.deepEqual(await sceneRetryInventory(f.author + '-offline'), before);
});

test('retry target strings do not invent package dependencies on scenes outside the selected closure', async t => {
  const f = await fixture(t), before = await sceneRetryInventory(f.author);
  const pack = await exportPack(f, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  assert.ok(pack.manifest.documents.some(row => row.id === f.sceneIds[0]));
  assert.ok(!pack.manifest.documents.some(row => row.id === f.sceneIds[1])); assert.ok(!pack.manifest.requirements.some(row => row.id === f.sceneIds[1]));
  assert.ok(!pack.manifest.documents.some(row => row.id === f.assemblyId));
  assert.equal(JSON.parse(await fs.readFile(path.join(pack.content, 'documents/behaviors/demo.json'), 'utf8')).bindings[0].parameters.target_scene_id, f.sceneIds[1]);
  const target = await relocate(f, pack); assert.equal(await fs.readFile(path.join(target, 'design-data/scripts/checkpoint.txt'), 'utf8'), GODOT_ACTION_SCENE_RETRY_SCRIPT);
  assert.deepEqual(await sceneRetryInventory(f.author), before);
});
