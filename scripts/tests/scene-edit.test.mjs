// Independent existing-scene edit → build → dependency export → migration coverage.
// Every authored document, image, archive and build is disposable data under /tmp.
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
import { registerWorkspace, readRegistry, verifyWorkspace } from '../lib/workspace.mjs';
import { importMediaAsset } from '../lib/media-assets.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { nativeMobileLibrary } from './mobile-native-harness.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const parsed = value => JSON.parse(value.replace(/^\uFEFF/, ''));
const actorRef = { kind: 'tool', id: 'scene-edit-integration' };
const archiveBinary = process.env.VIENTO_TEST_ARCHIVE_BINARY, mobileBinary = process.env.VIENTO_MOBILE_STORE_BIN;
const godot = process.env.VIENTO_GODOT_BIN, nativeRun = promisify(execFile);
const recordPath = id => `metadata/documents/${id}.json`;
async function write(root, relative, content) {
  const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content);
}
async function blank(root) {
  const template = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank');
  await write(root, 'workspace.json', json({ format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Scene editing', createdAt: 0,
    ...structuredClone(WORKSPACE_LAYOUT), documentTypes: structuredClone(template.documentTypes) }));
  for (const [name, content] of Object.entries(template.templates)) await write(root, `templates/${name}`, content);
  await registerWorkspace(root);
}
async function createRequest(root, patch) {
  const view = await readWorldProjection(root);
  return { command: 'object.create', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
    actorRef, objectId: randomUUID(), documentType: 'document', ...patch };
}
async function updateRequest(f, mutate) {
  const view = await readWorldProjection(f.root), object = view.objects.find(item => item.id === f.scene.objectId), source = object.documentRefs[0];
  const candidate = parsed(await fs.readFile(path.join(f.root, source.sourcePath), 'utf8')); mutate(candidate);
  return { command: 'scene.update', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
    actorRef, objectId: object.id, objectRevision: object.revision, sourceRevision: source.sourceRevision,
    content: JSON.stringify(candidate) }; // Candidate formatting is not the author's saved formatting.
}
async function fingerprint(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name); result[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return result;
}
async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-edit-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'blank'); await blank(root);
  const execute = createWorldCommandService(root);
  const core = await createRequest(root, { sourcePath: 'documents/core.md', content: '\uFEFF# 共同 OC\r\n\r\n背景：人物自己的故事，与场景布局分离。  \r\n' });
  await execute(core);
  const ordinary = await createRequest(root, { sourcePath: 'documents/ordinary.md', content: '# 普通对象\n\n无需强制使用投影。\n' }); await execute(ordinary);
  const unused = await createRequest(root, { sourcePath: 'documents/unused.md', content: '# 无关文档\n' }); await execute(unused);
  const images = [];
  for (const color of ['#4455aa', '#55aa44', '#aa4455', '#222222']) {
    const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${color}"/></svg>`);
    const imported = await importMediaAsset(root, Readable.from([bytes]), `${color.slice(1)}.svg`);
    images.push({ ...(await readRegistry(root)).assets.find(item => item.id === imported.asset.id), bytes });
  }
  const projections = [];
  for (let index = 0; index < 2; index++) {
    const template = getProjectionTemplates().find(item => item.id.endsWith(index ? '.rpg-npc' : '.rpg-player'));
    const declaration = { format: 'viento-object-projection', schemaVersion: 1, title: `投影 ${index + 1}`, sourceObjectId: core.objectId,
      template: await lockProjectionTemplate(template, { digest: buildHash }),
      configuration: { ...Object.fromEntries(template.fields.map(field => [field.id, field.default])), image: images[index].id } };
    const input = await createRequest(root, { command: 'projection.create', sourcePath: `documents/projections/p${index + 1}.json`, content: json(declaration) });
    await execute(input); projections.push({ ...input, declaration });
  }
  const declaration = { format: 'viento-scene2d', schemaVersion: 1, title: '初始场景', viewport: [640, 480], background: '#101827',
    actors: [{ objectId: projections[0].objectId, position: [100, 150], useProjectionDefaults: true, imageResourceId: images[0].id }] };
  const content = '\uFEFF' + (JSON.stringify(declaration, null, '\t') + '\n \t').replace('"schemaVersion": 1', '"schemaVersion": 1e0').replaceAll('\n', '\r\n');
  const scene = await createRequest(root, { command: 'scene.create', sourcePath: 'documents/scenes/current.json', content }); await execute(scene);
  const sceneRecord = (await readRegistry(root)).documents.find(item => item.id === scene.objectId);
  sceneRecord.relations.push({ kind: 'see-also', targetId: core.objectId, slot: '作者注释' });
  sceneRecord.assetBindings.push({ assetId: images[0].id, role: '旧图说明' });
  sceneRecord.userNotes = { exact: 'LARGE_INTEGER', text: '不要重新序列化' };
  await write(root, recordPath(scene.objectId), json(sceneRecord).replace('"LARGE_INTEGER"', '9007199254740993').replaceAll('\n', '\r\n'));
  const other = await createRequest(root, { command: 'scene.create', sourcePath: 'documents/scenes/other.json',
    content: json({ ...declaration, title: '另一场景', actors: [{ objectId: projections[0].objectId, position: [100, 150], useProjectionDefaults: true }] }) });
  await execute(other);
  return { root, temporary, execute, core, ordinary, unused, projections, images, scene, other };
}
function edit(f, value) {
  value.title = '再布局 "夏"'; value.viewport = [800, 600]; value.background = '#203040';
  value.actors = [
    { objectId: f.projections[1].objectId, position: [350, 150], useProjectionDefaults: true, speed: 60, controls: 'arrows', imageResourceId: null },
    { objectId: f.projections[0].objectId, position: [80, 120], useProjectionDefaults: true, speed: 240, imageResourceId: f.images[2].id },
    { objectId: f.ordinary.objectId, position: [500, 200], size: [40, 50], color: '#ffffff', speed: 0, controls: 'none' },
  ];
}
async function change(f) { const input = await updateRequest(f, value => edit(f, value)); await f.execute(input); return input; }
async function settled(service) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = await service.status(); if (state.job?.status !== 'running') return state; await delay(10);
  }
  assert.fail('Build service did not settle');
}

test('existing scene edits append dependencies atomically, preserve source formatting and other author files, and resolve inherited versus overridden fields', async t => {
  const f = await fixture(t), before = await fingerprint(f.root), beforeRegistry = await readRegistry(f.root);
  const oldPlan = await captureBuildSnapshot(f.root, f.scene.objectId), otherPlan = await captureBuildSnapshot(f.root, f.other.objectId);
  const request = await updateRequest(f, value => edit(f, value));
  const preview = await f.execute({ ...request, mode: 'preview' }); assert.equal(preview.status, 'preview');
  assert.deepEqual(await fingerprint(f.root), before, 'preview creates no files');
  const applied = await f.execute(request); assert.equal(applied.status, 'applied'); assert.equal(applied.revision, preview.revision);
  const content = await fs.readFile(path.join(f.root, f.scene.sourcePath), 'utf8');
  assert.equal(content, preview.changes[0].afterText, 'the preview is exactly the saved source');
  assert.equal(content, applied.changes[0].afterText);
  assert.ok(content.startsWith('\uFEFF{\r\n\t"format": "viento-scene2d",\r\n\t"schemaVersion": 1e0,'));
  assert.ok(content.endsWith('\r\n \t'), 'author trailing whitespace survives');
  assert.ok(!/(?<!\r)\n/.test(content), 'new tokens respect existing CRLF');
  assert.deepEqual(parsed(content), parsed(request.content));
  const after = await fingerprint(f.root), allowed = new Set([f.scene.sourcePath, recordPath(f.scene.objectId), '.viento/world-transactions/head.json']);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const [file, digest] of Object.entries(before)) if (!allowed.has(file)) assert.equal(after[file], digest, file);
  const oldRecord = beforeRegistry.documents.find(item => item.id === f.scene.objectId);
  const record = (await readRegistry(f.root)).documents.find(item => item.id === f.scene.objectId);
  assert.deepEqual(record, { ...oldRecord, relations: [...oldRecord.relations,
    { kind: 'references', targetId: f.projections[1].objectId, slot: '' }, { kind: 'references', targetId: f.ordinary.objectId, slot: '' }],
  assetBindings: [...oldRecord.assetBindings, { assetId: f.images[2].id, role: 'image' }] });
  assert.match(await fs.readFile(path.join(f.root, recordPath(f.scene.objectId)), 'utf8'), /9007199254740993/);
  const captured = await captureBuildSnapshot(f.root, f.scene.objectId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.notEqual(captured.snapshotId, oldPlan.snapshotId); assert.deepEqual(captured.plan.scene.viewport, [800, 600]);
  assert.equal(captured.plan.scene.title, '再布局 "夏"'); assert.equal(captured.plan.scene.background, '#203040');
  assert.deepEqual(captured.plan.actors.map(item => item.objectId), [f.projections[1].objectId, f.projections[0].objectId, f.ordinary.objectId]);
  const [npc, player] = captured.plan.actors;
  assert.deepEqual(npc.position, [350, 150]); assert.equal(npc.speed, 60); assert.equal(npc.controls, 'arrows'); assert.equal(npc.imageResourceId, undefined);
  assert.deepEqual(npc.size, [f.projections[1].declaration.configuration.width, f.projections[1].declaration.configuration.height]);
  assert.deepEqual(npc.fieldSources.speed, { objectId: f.scene.objectId, sourcePath: f.scene.sourcePath, propertyPath: '/actors/0/speed' });
  assert.deepEqual(npc.fieldSources['size/0'], { objectId: f.projections[1].objectId, sourcePath: f.projections[1].sourcePath, propertyPath: '/configuration/width' });
  assert.deepEqual(player.position, [80, 120]); assert.equal(player.speed, 240); assert.equal(player.imageResourceId, f.images[2].id);
  assert.deepEqual(player.fieldSources.imageResourceId, { objectId: f.scene.objectId, sourcePath: f.scene.sourcePath, propertyPath: '/actors/1/imageResourceId' });
  for (const actor of [npc, player]) assert.equal(actor.origin.objectId, f.core.objectId);
  assert.deepEqual(captured.plan.resources.map(item => item.id), [f.images[2].id], 'historical bindings do not enter the current runtime');
  assert.deepEqual(captured.resources.get(f.images[2].id), f.images[2].bytes);
  assert.deepEqual((await captureBuildSnapshot(f.root, f.other.objectId)).plan.actors, otherPlan.plan.actors);
  assert.equal((await verifyWorkspace(f.root)).ok, true);
});

test('removing actors and restoring projection inheritance retains old dependencies without reusing stale scene overrides', async t => {
  const f = await fixture(t); await change(f);
  const before = await fingerprint(f.root), registry = await readRegistry(f.root);
  await f.execute(await updateRequest(f, scene => { scene.actors = [{ objectId: f.projections[0].objectId, position: [20, 30], useProjectionDefaults: true }]; }));
  const inherited = await captureBuildSnapshot(f.root, f.scene.objectId); assert.equal(inherited.ok, true, JSON.stringify(inherited.diagnostics));
  assert.equal(inherited.plan.actors.length, 1); assert.equal(inherited.plan.actors[0].speed, f.projections[0].declaration.configuration.speed);
  assert.equal(inherited.plan.actors[0].imageResourceId, f.images[0].id);
  assert.deepEqual(inherited.plan.actors[0].fieldSources.speed, { objectId: f.projections[0].objectId, sourcePath: f.projections[0].sourcePath, propertyPath: '/configuration/speed' });
  assert.deepEqual(await readRegistry(f.root), registry, 'removal from the scene does not erase historical or user-defined dependencies');
  await f.execute(await updateRequest(f, scene => { scene.actors[0].imageResourceId = null; }));
  const cleared = await captureBuildSnapshot(f.root, f.scene.objectId); assert.equal(cleared.ok, true, JSON.stringify(cleared.diagnostics));
  assert.equal(cleared.plan.actors[0].imageResourceId, undefined); assert.deepEqual(cleared.plan.resources, []);
  assert.deepEqual(await readRegistry(f.root), registry);
  const after = await fingerprint(f.root);
  for (const [file, digest] of Object.entries(before)) if (![f.scene.sourcePath, '.viento/world-transactions/head.json'].includes(file)) assert.equal(after[file], digest, file);
  for (const image of f.images) assert.deepEqual(await fs.readFile(path.join(f.root, 'assets', image.location.path)), image.bytes);
});

test('an existing scene edit invalidates an editor build preview before engine execution and allows a new plan', { skip: process.platform !== 'linux' }, async t => {
  const f = await fixture(t), cacheRoot = path.join(f.temporary, 'cache');
  const service = createProjectBuildService(f.root, { godot: process.execPath, cacheRoot });
  try {
    await service.command({ action: 'plan', sceneId: f.scene.objectId }); const original = await settled(service);
    assert.equal(original.job.status, 'succeeded'); await change(f);
    await service.command({ action: 'build', sceneId: f.scene.objectId, expectedSnapshotId: original.job.plan.snapshotId });
    const rejected = await settled(service); assert.equal(rejected.job.status, 'failed');
    assert.equal(rejected.job.diagnostics[0].code, 'build_snapshot_changed'); assert.equal(rejected.latestBuild, null);
    await assert.rejects(fs.stat(cacheRoot), { code: 'ENOENT' });
    await service.command({ action: 'plan', sceneId: f.scene.objectId }); const fresh = await settled(service);
    assert.equal(fresh.job.status, 'succeeded'); assert.notEqual(fresh.job.plan.snapshotId, original.job.plan.snapshotId);
    assert.equal(fresh.job.plan.actorCount, 3);
  } finally { await service.close(); }
});

test('selected edited-scene export preserves current and historical dependencies and builds after import into another blank project', async t => {
  const f = await fixture(t); await change(f);
  // A removed actor remains a known authoring dependency but must not run.
  await f.execute(await updateRequest(f, scene => { scene.actors = scene.actors.filter(item => item.objectId !== f.ordinary.objectId); }));
  const before = await fingerprint(f.root), catalog = await readPackageCatalog(f.root);
  const plan = await planExport(f.root, { kind: 'resources', ids: [f.scene.objectId], revision: catalog.revision });
  const zip = path.join(f.temporary, 'scene.zip'); await writeExportZip(plan, zip);
  const stage = path.join(f.temporary, 'unpacked'); await fs.mkdir(stage); const pack = await unpackResourcePackage(zip, stage);
  const documents = [f.scene, f.core, ...f.projections, f.ordinary];
  assert.deepEqual(new Set(pack.manifest.documents.map(item => item.id)), new Set(documents.map(item => item.objectId)));
  assert.deepEqual(new Set(pack.manifest.assets.map(item => item.id)), new Set(f.images.slice(0, 3).map(item => item.id)));
  const target = path.join(f.temporary, 'imported'); await blank(target);
  const preview = await planPackageImport(target, pack); assert.deepEqual(preview.summary.conflicts, []); await applyPackageImport(target, pack, preview.revision);
  for (const item of documents) {
    assert.deepEqual(await fs.readFile(path.join(target, item.sourcePath)), await fs.readFile(path.join(f.root, item.sourcePath)));
    assert.deepEqual(await fs.readFile(path.join(target, recordPath(item.objectId))), await fs.readFile(path.join(f.root, recordPath(item.objectId))));
  }
  const original = await captureBuildSnapshot(f.root, f.scene.objectId), restored = await captureBuildSnapshot(target, f.scene.objectId);
  assert.equal(restored.ok, true, JSON.stringify(restored.diagnostics));
  assert.deepEqual(restored.plan.actors, original.plan.actors); assert.deepEqual(restored.plan.resources, original.plan.resources);
  assert.deepEqual(restored.resources.get(f.images[2].id), f.images[2].bytes);
  assert.equal(restored.plan.actors.length, 2, 'removed actors travel as dependencies but never reappear in the scene');
  assert.deepEqual(await fingerprint(f.root), before);
});

test('edited-scene bytes and dependencies survive Node → Rust → mobile → Rust complete migration', {
  skip: (!archiveBinary || !mobileBinary) && 'Set VIENTO_TEST_ARCHIVE_BINARY and VIENTO_MOBILE_STORE_BIN for native migration',
}, async t => {
  const f = await fixture(t); await change(f); const before = await fingerprint(f.root);
  const captured = await captureBuildSnapshot(f.root, f.scene.objectId), other = await captureBuildSnapshot(f.root, f.other.objectId);
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
    for (const item of [f.core, f.ordinary, f.unused, ...f.projections, f.scene, f.other]) {
      const read = await call('read', { workspaceId: work.id, path: item.sourcePath });
      assert.equal(read.content, original.get(item.sourcePath).toString('utf8'));
    }
    const outgoing = path.join(f.temporary, 'mobile.zip'); await call('exportArchive', { workspaceId: work.id, path: outgoing });
    ({ root: finalRoot } = await native('import', outgoing, parent));
  } finally { await library.close(); }
  for (const [file, bytes] of original) assert.deepEqual(await fs.readFile(path.join(finalRoot, file)), bytes, file);
  assert.deepEqual(await readRegistry(finalRoot), await readRegistry(f.root));
  assert.equal((await captureBuildSnapshot(finalRoot, f.scene.objectId)).snapshotId, captured.snapshotId);
  assert.equal((await captureBuildSnapshot(finalRoot, f.other.objectId)).snapshotId, other.snapshotId);
  const exported = await planExport(finalRoot, { kind: 'workspace' });
  assert.deepEqual(new Set(exported.entries.map(entry => entry.path)), new Set(original.keys()));
  for (const entry of exported.entries) assert.deepEqual(entry.buffer || await fs.readFile(entry.absolute), original.get(entry.path));
  assert.deepEqual(await fingerprint(f.root), before);
});

test('real Godot rebuild uses edited layout, new actor references, explicit overrides and cleared inherited images', {
  skip: !godot && 'Set VIENTO_GODOT_BIN for the real edited-scene runtime', timeout: 90000,
}, async t => {
  const f = await fixture(t), oldPlan = await captureBuildSnapshot(f.root, f.scene.objectId); await change(f);
  const before = await fingerprint(f.root), output = path.join(f.temporary, 'build');
  const stale = await buildProject({ root: f.root, scene: f.scene.objectId, godot, output, expectedSnapshotId: oldPlan.snapshotId });
  assert.equal(stale.ok, false); assert.equal(stale.diagnostics[0].code, 'build_snapshot_changed');
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  const current = await captureBuildSnapshot(f.root, f.scene.objectId);
  const built = await buildProject({ root: f.root, scene: f.scene.objectId, godot, output, expectedSnapshotId: current.snapshotId });
  assert.equal(built.ok, true, JSON.stringify(built));
  const generated = JSON.parse(await fs.readFile(path.join(built.buildDirectory, 'project/scene.json')));
  assert.deepEqual(generated.viewport, [800, 600]);
  assert.equal(generated.actors[0].imageResourceId, undefined); assert.equal(generated.actors[1].imageResourceId, f.images[2].id);
  const ran = await runProjectBuild({ buildDirectory: built.buildDirectory, godot }); assert.equal(ran.ok, true, JSON.stringify(ran));
  assert.deepEqual(ran.record.events.at(-1).actors, [
    { objectId: f.projections[1].objectId, position: [365, 150], state: 'idle' },
    { objectId: f.projections[0].objectId, position: [140, 120], state: 'idle' },
    { objectId: f.ordinary.objectId, position: [500, 200], state: 'idle' },
  ]);
  assert.deepEqual(await fingerprint(f.root), before);
});
