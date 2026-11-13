import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GODOT_ACTION_SCENE_SWITCH_SCRIPT as action, GODOT_EVENT_SCENE_SWITCH_SCRIPT as event } from '../../engine/godot-scene-navigation-scripts.mjs';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { hudDocument, hudId } from './helpers/scene-hud2d-fixture.mjs';
import { readPackageCatalog, packageDigest } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
const json = value => JSON.stringify(value, null, 2) + '\n';
const eventId = '76543210-1234-4234-8234-123456789abc', hudObjectId = '76543210-1234-4234-8234-123456789abd';
async function fixture(t, edited = false) {
  const inputMap = { format:'viento-input-map', schemaVersion:1, actions:[{ name:'start_game', keys:['Enter', 'Space'] }] };
  const f = await projectAssemblyAuthor(t, { inputMap });
  const read = async name => JSON.parse(await fs.readFile(path.join(f.author, name), 'utf8'));
  const write = async (name, value) => { await fs.mkdir(path.dirname(path.join(f.author, name)), { recursive:true }); await fs.writeFile(path.join(f.author, name), typeof value === 'string' ? value : json(value)); };
  const behavior = await read('documents/behaviors/demo.json');
  behavior.bindings[0].parameters = { action_name:'start_game', target_scene_id:edited ? '' : f.sceneIds[1] };
  behavior.bindings[1].parameters = { event_name:'game.complete', payload_filter:'次へ 😀', target_scene_id:f.sceneIds[1] };
  behavior.bindings.forEach(row => { row.events = []; }); behavior.bindings[1].implementation.sourceObjectId = eventId;
  await write('documents/behaviors/demo.json', behavior);
  const actionContent = action + (edited ? '\n' : '');
  await write('documents/scripts/checkpoint.txt', actionContent); await write('documents/scripts/event-navigation.txt', event);
  const scriptRecord = await read(`metadata/documents/${f.scriptId}.json`);
  await write(`metadata/documents/${eventId}.json`, { ...scriptRecord, id:eventId, sourcePath:'documents/scripts/event-navigation.txt' });
  const behaviorRecord = await read('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json');
  behaviorRecord.relations.push({ kind:'reference', targetId:eventId, slot:'implementation' });
  await write('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', behaviorRecord);
  const hud = hudDocument(undefined, f.sceneIds[0]), hudContent = '\ufeff' + JSON.stringify(hud, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
  await write('documents/hud/overlay.json', hudContent);
  await write(`metadata/documents/${hudObjectId}.json`, { ...behaviorRecord, id:hudObjectId, sourcePath:'documents/hud/overlay.json',
    relations:[{ kind:'references', targetId:f.sceneIds[0], slot:'scene' }] });
  const sceneRecord = await read(`metadata/documents/${f.sceneIds[0]}.json`);
  sceneRecord.relations.push({ kind:'references', targetId:hudObjectId, slot:'hud2d' }); await write(`metadata/documents/${f.sceneIds[0]}.json`, sceneRecord);
  return { ...f, read, write, behavior, inputMap, hud, hudContent, actionContent };
}
async function inventory(root, prefix = '') {
  const result = {};
  for (const item of await fs.readdir(path.join(root, prefix), { withFileTypes:true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) Object.assign(result, await inventory(root, name)); else result[name] = packageDigest(await fs.readFile(path.join(root, name)));
  }
  return result;
}
async function exportPack(f, id = f.assemblyId) {
  const catalog = await readPackageCatalog(f.author), review = await planExport(f.author, { kind:'resources', revision:catalog.revision, ids:[id], includeDependencies:true, includeChildren:false });
  const archive = path.join(f.temporary, 'navigation.zip'); await writeExportZip(review, archive);
  const stage = path.join(f.temporary, 'unpacked'); await fs.mkdir(stage); return unpackResourcePackage(archive, stage);
}
async function relocate(f, pack) {
  const target = path.join(f.temporary, 'relocated'); await fs.mkdir(target);
  const workspace = { ...await f.read('workspace.json'), version:2, id:hudId(101), paths:{ documents:'design-data', templates:'data-template', metadata:'metadata' } };
  await fs.writeFile(path.join(target, 'workspace.json'), json(workspace));
  for (const name of ['design-data', 'data-template', 'assets', 'metadata/documents', 'metadata/assets']) await fs.mkdir(path.join(target, name), { recursive:true });
  const review = await planPackageImport(target, pack); assert.deepEqual(review.summary.conflicts, [], JSON.stringify(review.summary));
  assert.equal((await applyPackageImport(target, pack, review.revision)).status, 'imported'); return target;
}

test('assembly closure migrates both exact scripts, navigation identities, HUD, input and media without the original author root', async t => {
  const f = await fixture(t), before = await inventory(f.author), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const pack = await exportPack(f), ids = new Set(pack.manifest.documents.map(row => row.id));
  for (const id of [f.assemblyId, ...f.sceneIds, f.scriptId, eventId, hudObjectId, f.inputMapId]) assert.ok(ids.has(id), id);
  assert.ok(pack.manifest.assets.some(row => row.id === f.waveId));
  assert.equal(pack.manifest.format, 'viento-resource-package'); assert.equal(pack.manifest.version, 1);
  const target = await relocate(f, pack); await fs.rename(f.author, f.author + '-offline');
  const rebuilt = await captureBuildSnapshot(target, f.assemblyId);
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt.diagnostics)); assert.equal(rebuilt.plan.schemaVersion, captured.plan.schemaVersion);
  assert.deepEqual(rebuilt.plan.requiredCapabilities, captured.plan.requiredCapabilities);
  assert.deepEqual(rebuilt.plan.scenes.map(row => row.scene.objectId), f.sceneIds); assert.equal(rebuilt.plan.entrySceneId, f.entrySceneId);
  assert.deepEqual(rebuilt.plan.inputMap.document, f.inputMap);
  assert.deepEqual(rebuilt.plan.scenes[0].hud2d.document, f.hud);
  const behavior = rebuilt.plan.scenes[0].behaviors;
  assert.deepEqual(behavior.bindings.map(row => [row.bindingId, row.instanceId, row.parameters]), captured.plan.scenes[0].behaviors.bindings.map(row => [row.bindingId, row.instanceId, row.parameters]));
  assert.equal(behavior.sources.find(row => row.objectId === f.scriptId).content, action); assert.equal(behavior.sources.find(row => row.objectId === eventId).content, event);
  assert.equal(await fs.readFile(path.join(target, 'design-data/scripts/checkpoint.txt'), 'utf8'), action);
  assert.equal(await fs.readFile(path.join(target, 'design-data/scripts/event-navigation.txt'), 'utf8'), event);
  assert.equal(await fs.readFile(path.join(target, 'design-data/hud/overlay.json'), 'utf8'), f.hudContent);
  assert.equal(rebuilt.plan.scenes[0].hud2d.manifest.sourcePath, 'design-data/hud/overlay.json');
  assert.equal(rebuilt.plan.scenes[1].audio.document.tracks[0].resourceId, captured.plan.scenes[1].audio.document.tracks[0].resourceId);
  assert.deepEqual(await inventory(f.author + '-offline'), before);
});

test('one-byte customization remains ordinary author code across the unchanged archive migration', async t => {
  const f = await fixture(t, true), before = await inventory(f.author), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const pack = await exportPack(f), target = await relocate(f, pack); await fs.rename(f.author, f.author + '-offline');
  const rebuilt = await captureBuildSnapshot(target, f.assemblyId);
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt.diagnostics));
  assert.equal(rebuilt.plan.scenes[0].behaviors.sources.find(row => row.objectId === f.scriptId).content, f.actionContent);
  assert.equal(rebuilt.plan.scenes[0].behaviors.bindings[0].parameters.target_scene_id, '');
  assert.ok(!rebuilt.diagnostics.some(row => row.code.startsWith('build_scene_navigation_')));
  assert.deepEqual(await inventory(f.author + '-offline'), before);
});

test('ordinary target parameter strings do not invent package dependencies on scenes outside the selected closure', async t => {
  const f = await fixture(t), before = await inventory(f.author), pack = await exportPack(f, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  assert.ok(pack.manifest.documents.some(row => row.id === f.sceneIds[0]));
  assert.ok(!pack.manifest.documents.some(row => row.id === f.sceneIds[1]));
  assert.ok(!pack.manifest.requirements.some(row => row.id === f.sceneIds[1]));
  assert.ok(!pack.manifest.documents.some(row => row.id === f.assemblyId));
  assert.equal(JSON.parse(await fs.readFile(path.join(pack.content, 'documents/behaviors/demo.json'), 'utf8')).bindings[0].parameters.target_scene_id, f.sceneIds[1]);
  const target = await relocate(f, pack);
  assert.equal(await fs.readFile(path.join(target, 'design-data/scripts/checkpoint.txt'), 'utf8'), action);
  assert.deepEqual(await inventory(f.author), before);
});
