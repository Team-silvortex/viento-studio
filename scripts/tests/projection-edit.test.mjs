// Independent edit → build → dependency package → native migration coverage.
// Author data is always created under a disposable blank project in /tmp.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';
import { getProjectionTemplates, lockProjectionTemplate } from '../../engine/object-projection.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { registerWorkspace, readRegistry } from '../lib/workspace.mjs';
import { importMediaAsset } from '../lib/media-assets.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { nativeMobileLibrary } from './mobile-native-harness.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const parsed = value => JSON.parse(value.replace(/^\uFEFF/, ''));
const actorRef = { kind: 'tool', id: 'projection-edit-integration' };
const archiveBinary = process.env.VIENTO_TEST_ARCHIVE_BINARY, mobileBinary = process.env.VIENTO_MOBILE_STORE_BIN;
const godot = process.env.VIENTO_GODOT_BIN, nativeRun = promisify(execFile);
const coreContent = '\uFEFF# 共同 OC\r\n\r\n背景：角色自己的故事，永不由投影编辑改写。  \r\n';
const recordPath = id => `metadata/documents/${id}.json`;
async function write(root, relative, content) {
  const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content);
}
async function blank(root) {
  const template = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank');
  await write(root, 'workspace.json', json({ format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Projection editing', createdAt: 0,
    ...structuredClone(WORKSPACE_LAYOUT), documentTypes: structuredClone(template.documentTypes) }));
  for (const [name, content] of Object.entries(template.templates)) await write(root, `templates/${name}`, content);
  await registerWorkspace(root);
}
async function createRequest(root, patch) {
  const view = await readWorldProjection(root);
  return { command: 'object.create', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
    actorRef, objectId: randomUUID(), documentType: 'document', ...patch };
}
async function updateRequest(root, projectionId, mutate) {
  const view = await readWorldProjection(root), object = view.objects.find(item => item.id === projectionId), source = object.documentRefs[0];
  const candidate = parsed(await fs.readFile(path.join(root, source.sourcePath), 'utf8')); mutate(candidate);
  return { command: 'projection.update', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
    actorRef, objectId: projectionId, objectRevision: object.revision, sourceRevision: source.sourceRevision,
    content: JSON.stringify(candidate) }; // Candidate formatting must not replace the author's formatting.
}
async function fingerprint(root) {
  const values = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name); values[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return values;
}
async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-projection-edit-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'blank'); await blank(root);
  const execute = createWorldCommandService(root), core = await createRequest(root, { sourcePath: 'documents/core.md', content: coreContent }); await execute(core);
  const images = [];
  for (const color of ['#4455aa', '#55aa44', '#aa4455']) {
    const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${color}"/></svg>`);
    const result = await importMediaAsset(root, Readable.from([bytes]), `${color.slice(1)}.svg`);
    images.push({ ...(await readRegistry(root)).assets.find(item => item.id === result.asset.id), bytes });
  }
  const projections = [];
  for (let index = 0; index < 2; index++) {
    const template = getProjectionTemplates().find(item => item.id.endsWith(index ? '.rpg-npc' : '.rpg-player'));
    const declaration = { format: 'viento-object-projection', schemaVersion: 1, title: `投影 ${index + 1}`, sourceObjectId: core.objectId,
      template: await lockProjectionTemplate(template, { digest: buildHash }),
      configuration: { ...Object.fromEntries(template.fields.map(field => [field.id, field.default])), image: images[index].id } };
    const content = index ? json(declaration) : '\uFEFF' + (JSON.stringify(declaration, null, '\t') + '\n \t')
      .replace('"health": 100', '"health": 1e2').replaceAll('\n', '\r\n');
    const request = await createRequest(root, { command: 'projection.create', sourcePath: `documents/projections/p${index + 1}.json`, content });
    await execute(request); projections.push({ ...request, declaration });
  }
  const p1 = projections[0], metadata = (await readRegistry(root)).documents.find(item => item.id === p1.objectId);
  metadata.relations.push({ kind: 'see-also', targetId: core.objectId, slot: '作者附注' });
  metadata.assetBindings.push({ assetId: images[0].id, role: 'portrait-alternate' });
  metadata.userNotes = { precise: 'PLACEHOLDER', text: '保留' };
  await write(root, recordPath(p1.objectId), json(metadata).replace('"PLACEHOLDER"', '9007199254740993'));
  const declaration = { format: 'viento-scene2d', schemaVersion: 1, title: '继承场景', viewport: [640, 480], background: '#101827',
    actors: projections.map((item, index) => ({ objectId: item.objectId, position: [100 + index * 100, 150], useProjectionDefaults: true })) };
  const scene = await createRequest(root, { command: 'scene.create', sourcePath: 'documents/scenes/inherited.json', content: json(declaration) }); await execute(scene);
  const explicit = { ...declaration, title: '保留旧图片的场景', actors: [{ objectId: p1.objectId, position: [100, 150],
    size: [50, 60], speed: 20, controls: 'arrows', color: '#ffffff', imageResourceId: images[0].id }] };
  const oldScene = await createRequest(root, { command: 'scene.create', sourcePath: 'documents/scenes/old-image.json', content: json(explicit) }); await execute(oldScene);
  // Existing Scene2D documents may rely solely on an actor's binding. Keep that
  // supported legacy shape so this test detects accidental binding removal.
  const oldRecord = (await readRegistry(root)).documents.find(item => item.id === oldScene.objectId); oldRecord.assetBindings = [];
  await write(root, recordPath(oldScene.objectId), json(oldRecord));
  return { root, temporary, execute, core, projections, images, scene, oldScene };
}
const edits = (f, value) => {
  value.title = '投影 1 新形态 "夏"'; value.configuration.role = '新阶段'; value.configuration.width = 96;
  value.configuration.speed = 240; value.configuration.color = '#ffeecc'; value.configuration.image = f.images[2].id;
};
async function change(f) {
  const request = await updateRequest(f.root, f.projections[0].objectId, value => edits(f, value));
  await f.execute(request); return request;
}
async function settled(service) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = await service.status(); if (state.job?.status !== 'running') return state; await delay(10);
  }
  assert.fail('Build service did not settle');
}

test('editing P1 atomically preserves lexical source formatting, OC/P2/scene bytes and old-image compatibility while changing inherited build values', async t => {
  const f = await fixture(t), p1 = f.projections[0], before = await fingerprint(f.root);
  const oldPlan = await captureBuildSnapshot(f.root, f.scene.objectId), oldMetadata = (await readRegistry(f.root)).documents.find(item => item.id === p1.objectId);
  const request = await updateRequest(f.root, p1.objectId, value => edits(f, value));
  const preview = await f.execute({ ...request, mode: 'preview' }); assert.equal(preview.status, 'preview');
  assert.deepEqual(await fingerprint(f.root), before, 'preview writes nothing');
  const applied = await f.execute(request); assert.equal(applied.status, 'applied'); assert.equal(applied.revision, preview.revision);
  const expected = p1.content.replace(JSON.stringify(p1.declaration.title), JSON.stringify('投影 1 新形态 "夏"'))
    .replace('"role": ""', '"role": "新阶段"').replace('"width": 80', '"width": 96').replace('"speed": 160', '"speed": 240')
    .replace('"color": "#ffffff"', '"color": "#ffeecc"').replace(f.images[0].id, f.images[2].id);
  assert.equal(await fs.readFile(path.join(f.root, p1.sourcePath), 'utf8'), expected, 'BOM, CRLF, tabs, trailing whitespace and untouched 1e2 stay exact');
  const after = await fingerprint(f.root), allowed = new Set([p1.sourcePath, recordPath(p1.objectId), '.viento/world-transactions/head.json']);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const [file, hash] of Object.entries(before)) if (!allowed.has(file)) assert.equal(after[file], hash, file);
  const metadata = (await readRegistry(f.root)).documents.find(item => item.id === p1.objectId);
  assert.deepEqual(metadata, { ...oldMetadata, assetBindings: [...oldMetadata.assetBindings, { assetId: f.images[2].id, role: 'image' }] });
  assert.match(await fs.readFile(path.join(f.root, recordPath(p1.objectId)), 'utf8'), /9007199254740993/);
  const current = await captureBuildSnapshot(f.root, f.scene.objectId); assert.equal(current.ok, true, JSON.stringify(current.diagnostics));
  assert.notEqual(current.snapshotId, oldPlan.snapshotId); assert.equal(current.plan.actors[0].speed, 240);
  assert.deepEqual(current.plan.actors[0].size, [96, 80]); assert.equal(current.plan.actors[0].imageResourceId, f.images[2].id);
  assert.deepEqual(current.plan.actors[1], oldPlan.plan.actors[1]); assert.equal(current.plan.actors[0].origin.objectId, f.core.objectId);
  const legacy = await captureBuildSnapshot(f.root, f.oldScene.objectId); assert.equal(legacy.ok, true, JSON.stringify(legacy.diagnostics));
  assert.equal(legacy.plan.actors[0].imageResourceId, f.images[0].id); assert.equal(legacy.plan.actors[0].speed, 20);
});

test('clearing an edited projection image stops inheritance without deleting media or breaking explicit old-image scenes', async t => {
  const f = await fixture(t); await change(f);
  const before = await fingerprint(f.root), registry = await readRegistry(f.root), p1 = f.projections[0];
  await f.execute(await updateRequest(f.root, p1.objectId, value => { value.configuration.image = ''; }));
  const current = await captureBuildSnapshot(f.root, f.scene.objectId); assert.equal(current.ok, true, JSON.stringify(current.diagnostics));
  assert.equal(current.plan.actors[0].imageResourceId, undefined); assert.deepEqual(current.plan.resources.map(item => item.id), [f.images[1].id]);
  assert.equal((await captureBuildSnapshot(f.root, f.oldScene.objectId)).ok, true);
  assert.deepEqual(await readRegistry(f.root), registry, 'removing a use never deletes existing bindings or resource registrations');
  const after = await fingerprint(f.root);
  for (const [file, hash] of Object.entries(before)) if (![p1.sourcePath, '.viento/world-transactions/head.json'].includes(file)) assert.equal(after[file], hash, file);
  for (const image of f.images) assert.deepEqual(await fs.readFile(path.join(f.root, 'assets', image.location.path)), image.bytes);
});

test('a projection update invalidates an earlier editor build preview before any engine can run and permits a fresh plan', { skip: process.platform !== 'linux' }, async t => {
  const f = await fixture(t), cacheRoot = path.join(f.temporary, 'cache');
  const service = createProjectBuildService(f.root, { godot: process.execPath, cacheRoot });
  try {
    await service.command({ action: 'plan', sceneId: f.scene.objectId }); const original = await settled(service);
    assert.equal(original.job.status, 'succeeded'); await change(f);
    await service.command({ action: 'build', sceneId: f.scene.objectId, expectedSnapshotId: original.job.plan.snapshotId });
    const rejected = await settled(service); assert.equal(rejected.job.status, 'failed');
    assert.equal(rejected.job.diagnostics[0].code, 'build_snapshot_changed'); assert.equal(rejected.latestBuild, null);
    await assert.rejects(fs.stat(cacheRoot), { code: 'ENOENT' });
    await service.command({ action: 'plan', sceneId: f.scene.objectId }); const refreshed = await settled(service);
    assert.equal(refreshed.job.status, 'succeeded'); assert.notEqual(refreshed.job.plan.snapshotId, original.job.plan.snapshotId);
  } finally { await service.close(); }
});

test('single-selection migration retains edited and legacy image dependencies without copying P2 and remains buildable in a new blank project', async t => {
  const f = await fixture(t); await change(f);
  const catalog = await readPackageCatalog(f.root), plan = await planExport(f.root, { kind: 'resources', ids: [f.projections[0].objectId], revision: catalog.revision });
  const zip = path.join(f.temporary, 'p1.zip'); await writeExportZip(plan, zip);
  const stage = path.join(f.temporary, 'unpacked'); await fs.mkdir(stage); const pack = await unpackResourcePackage(zip, stage);
  assert.deepEqual(new Set(pack.manifest.documents.map(item => item.id)), new Set([f.core.objectId, f.projections[0].objectId]));
  assert.deepEqual(new Set(pack.manifest.assets.map(item => item.id)), new Set([f.images[0].id, f.images[2].id]));
  const target = path.join(f.temporary, 'imported'); await blank(target);
  const preview = await planPackageImport(target, pack); assert.deepEqual(preview.summary.conflicts, []); await applyPackageImport(target, pack, preview.revision);
  for (const item of [f.core, f.projections[0]]) {
    assert.deepEqual(await fs.readFile(path.join(target, item.sourcePath)), await fs.readFile(path.join(f.root, item.sourcePath)));
    assert.deepEqual(await fs.readFile(path.join(target, recordPath(item.objectId))), await fs.readFile(path.join(f.root, recordPath(item.objectId))));
  }
  const scene = parsed(f.scene.content); scene.actors = [scene.actors[0]];
  const request = await createRequest(target, { command: 'scene.create', sourcePath: 'documents/scenes/restored.json', content: json(scene) });
  await createWorldCommandService(target)(request);
  const captured = await captureBuildSnapshot(target, request.objectId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.equal(captured.plan.actors[0].speed, 240); assert.deepEqual(captured.resources.get(f.images[2].id), f.images[2].bytes);
});

test('edited projection bytes, retained metadata and both scenes survive Node → Rust → mobile → Rust complete migration', {
  skip: (!archiveBinary || !mobileBinary) && 'Set VIENTO_TEST_ARCHIVE_BINARY and VIENTO_MOBILE_STORE_BIN for native migration',
}, async t => {
  const f = await fixture(t); await change(f); const before = await fingerprint(f.root);
  const captured = await captureBuildSnapshot(f.root, f.scene.objectId), oldCaptured = await captureBuildSnapshot(f.root, f.oldScene.objectId);
  const plan = await planExport(f.root, { kind: 'workspace' }), original = new Map();
  for (const entry of plan.entries) original.set(entry.path, entry.buffer || await fs.readFile(entry.absolute));
  const incoming = path.join(f.temporary, 'node.zip'); await writeExportZip(plan, incoming);
  const native = async (...args) => JSON.parse((await nativeRun(archiveBinary, args, { timeout: 15000 })).stdout);
  const parent = path.join(f.temporary, 'restored'); await fs.mkdir(parent);
  const { root: restored } = await native('import', incoming, parent);
  const nativeArchive = path.join(f.temporary, 'native.zip'); await native('export', restored, nativeArchive);
  const library = await nativeMobileLibrary(mobileBinary, path.join(f.temporary, 'mobile'));
  let finalRoot;
  try {
    const call = (action, args = {}) => library.invoke('mobile_storage', { action, ...args });
    const work = await call('importArchive', { path: nativeArchive });
    for (const item of [f.core, ...f.projections, f.scene, f.oldScene]) {
      const read = await call('read', { workspaceId: work.id, path: item.sourcePath });
      assert.equal(read.content, original.get(item.sourcePath).toString('utf8'));
    }
    const outgoing = path.join(f.temporary, 'mobile.zip'); await call('exportArchive', { workspaceId: work.id, path: outgoing });
    ({ root: finalRoot } = await native('import', outgoing, parent));
  } finally { await library.close(); }
  for (const [file, bytes] of original) assert.deepEqual(await fs.readFile(path.join(finalRoot, file)), bytes, file);
  assert.deepEqual(await readRegistry(finalRoot), await readRegistry(f.root));
  assert.equal((await captureBuildSnapshot(finalRoot, f.scene.objectId)).snapshotId, captured.snapshotId);
  assert.equal((await captureBuildSnapshot(finalRoot, f.oldScene.objectId)).snapshotId, oldCaptured.snapshotId);
  const finalPlan = await planExport(finalRoot, { kind: 'workspace' });
  assert.deepEqual(new Set(finalPlan.entries.map(entry => entry.path)), new Set(original.keys()));
  for (const entry of finalPlan.entries) assert.deepEqual(entry.buffer || await fs.readFile(entry.absolute), original.get(entry.path));
  assert.deepEqual(await fingerprint(f.root), before);
});

test('real Godot rebuild after an API edit uses the new P1 speed and image while P2 keeps its independent behavior', {
  skip: !godot && 'Set VIENTO_GODOT_BIN for the real edited projection runtime', timeout: 90000,
}, async t => {
  const f = await fixture(t), original = await captureBuildSnapshot(f.root, f.scene.objectId); await change(f);
  const before = await fingerprint(f.root), output = path.join(f.temporary, 'build');
  const stale = await buildProject({ root: f.root, scene: f.scene.objectId, godot, output, expectedSnapshotId: original.snapshotId });
  assert.equal(stale.ok, false); assert.equal(stale.diagnostics[0].code, 'build_snapshot_changed');
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  const current = await captureBuildSnapshot(f.root, f.scene.objectId);
  const built = await buildProject({ root: f.root, scene: f.scene.objectId, godot, output, expectedSnapshotId: current.snapshotId });
  assert.equal(built.ok, true, JSON.stringify(built));
  const generated = JSON.parse(await fs.readFile(path.join(built.buildDirectory, 'project/scene.json')));
  assert.equal(generated.actors[0].imageResourceId, f.images[2].id); assert.equal(generated.actors[0].speed, 240);
  const ran = await runProjectBuild({ buildDirectory: built.buildDirectory, godot }); assert.equal(ran.ok, true, JSON.stringify(ran));
  assert.deepEqual(ran.record.events.at(-1).actors, [
    { objectId: f.projections[0].objectId, position: [160, 150], state: 'idle' },
    { objectId: f.projections[1].objectId, position: [200, 150], state: 'idle' },
  ]);
  assert.deepEqual(await fingerprint(f.root), before);
});
