import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { sceneCamera2DFixture, cameraJson, cameraId } from './helpers/scene-camera2d-fixture.mjs';
import { inventory } from './runtime-case-fixture.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { createHash } from 'node:crypto';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { physics2dPureFixture, digest, sceneId, instanceA } from './helpers/world-physics2d-create-pure-fixture.mjs';
import { prepareCamera2DCreate, validateCamera2DCreateRecovery } from '../../engine/world-camera2d-create.mjs';
import { editSceneCamera2DSource } from '../../engine/scene-camera2d-edit.mjs';
const bounds = { left: -500, top: -200, right: 1800, bottom: 1200 };
async function fixture(t) {
  const f = await sceneCamera2DFixture({ enabled: false }), temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-camera-limits-author-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true })); const author = path.join(temporary, 'author');
  const write = async (name, input) => { await fs.mkdir(path.dirname(path.join(author, name)), { recursive: true }); await fs.writeFile(path.join(author, name), typeof input === 'string' ? input : cameraJson(input)); };
  for (const folder of ['assets', 'templates', 'metadata/assets']) await fs.mkdir(path.join(author, folder), { recursive: true });
  await write('workspace.json', f.source.workspace);
  for (const doc of f.source.documents.filter(doc => doc.record.id !== f.cameraDocumentId)) { await write(doc.sourcePath, doc.content); await write(`metadata/documents/${doc.record.id}.json`, doc.record); }
  const cacheRoot = path.join(temporary, 'cache'), service = createProjectBuildService(author, { enabled: true, tool: undefined, cacheRoot });
  t.after(() => service.close()); const world = createWorldCommandService(author);
  const context = await service.command({ action: 'camera2d-inspect', sceneId: f.sceneId });
  const value = { ...f.value, schemaVersion: 2, camera: { ...f.value.camera, limits: { ...bounds } } };
  const content = '\ufeff' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
  const request = { command: 'camera2d.create', mode: 'preview', worldId: context.worldId, baseRevision: context.baseRevision,
    actorRef: { kind: 'tool', id: 'camera-limits-author-test' }, objectId: f.cameraDocumentId, documentType: 'document',
    sourcePath: f.camera.sourcePath, content, sceneObjectId: f.sceneId, sceneObjectRevision: context.scene.objectRevision, sceneSourceRevision: context.scene.sourceRevision };
  return { ...f, temporary, author, write, service, world, context, value, content, request, cacheRoot };
}
async function create(f) { const result = await f.world({ ...f.request, mode: 'apply' }); assert.equal(result.status, 'applied'); return f.service.command({ action: 'camera2d-inspect', sceneId: f.sceneId }); }
const save = (f, context, content) => f.service.command({ action: 'camera2d-save', sceneId: f.sceneId, sceneVersion: context.scene.sourceRevision,
  documentId: f.cameraDocumentId, expectedVersion: context.manifest.sourceRevision, content });

test('bounded camera preview is read-only and existing creation atomically publishes three exact files', async t => {
  const f = await fixture(t), before = await inventory(f.author);
  const preview = await f.world(f.request); assert.equal(preview.status, 'preview'); assert.deepEqual(await inventory(f.author), before);
  const context = await create(f), after = await inventory(f.author);
  const changed = Object.keys(after).filter(name => before[name] !== after[name]);
  assert.ok(changed.includes('.viento/world-transactions/head.json'));
  // Three author files plus the existing transaction head receipt, not a new journal format.
  assert.deepEqual(new Set(changed.filter(name => !name.startsWith('.viento/'))), new Set([f.camera.sourcePath, `metadata/documents/${f.cameraDocumentId}.json`, `metadata/documents/${f.sceneId}.json`]));
  assert.equal(context.manifest.content, f.content); assert.deepEqual(JSON.parse(f.content.slice(1)).camera.limits, bounds);
  assert.equal(context.targets.length, 2); assert.equal(context.framing.actors.length, 2);
  const built = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  assert.deepEqual(built.plan.scenes[0].camera2d.document, f.value); assert.ok(built.plan.requiredCapabilities.includes('scene.camera2d.limits2d'));
  assert.equal((await f.service.status()).job, null); await assert.rejects(fs.stat(f.cacheRoot), { code: 'ENOENT' });
});
test('bounds edits save only camera source, honor revisions, preserve formatting and explicitly return to v1', async t => {
  const f = await fixture(t), context = await create(f), before = await inventory(f.author);
  const camera = { ...f.value.camera, limits: { ...bounds, left: -750.5 } }, content = editSceneCamera2DSource(f.content, camera);
  const saved = await save(f, context, content); assert.equal(saved.valid, true); assert.equal(saved.content, content); assert.ok(content.startsWith('\ufeff')); assert.ok(content.endsWith('\r\n'));
  const after = await inventory(f.author); assert.deepEqual(Object.keys(after).filter(name => before[name] !== after[name]), [f.camera.sourcePath]);
  await assert.rejects(save(f, context, f.content), { errorCode: 'scene_camera2d_document_conflict' });
  const next = await f.service.command({ action: 'camera2d-inspect', sceneId: f.sceneId }), { limits, ...unbounded } = camera;
  const reverted = editSceneCamera2DSource(next.manifest.content, unbounded); assert.equal(JSON.parse(reverted.slice(1)).schemaVersion, 1);
  await save(f, next, reverted); const snapshot = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(snapshot.ok, true); assert.equal(snapshot.plan.requiredCapabilities.includes('scene.camera2d.limits2d'), false);
});
test('invalid bounded create/save and stale scene dependencies leave every author byte intact', async t => {
  const f = await fixture(t), before = await inventory(f.author), invalid = JSON.stringify({ ...f.value, camera: { ...f.value.camera, limits: { ...bounds, right: bounds.left } } });
  await assert.rejects(f.world({ ...f.request, mode: 'apply', content: invalid }), { errorCode: 'world_camera2d_invalid' });
  assert.deepEqual(await inventory(f.author), before); const context = await create(f), created = await inventory(f.author);
  await assert.rejects(save(f, context, invalid)); assert.deepEqual(await inventory(f.author), created);
  const changedScene = f.scene.content + ' '; await f.write(f.scene.sourcePath, changedScene); const changed = await inventory(f.author);
  await assert.rejects(save(f, context, f.content), { errorCode: 'scene_camera2d_scene_conflict' }); assert.deepEqual(await inventory(f.author), changed);
});
test('bounded author dependency package restores exact v2 bytes and same-OC follow UUID at a new root', async t => {
  const f = await fixture(t); await create(f); const before = await inventory(f.author), catalog = await readPackageCatalog(f.author);
  const plan = await planExport(f.author, { kind: 'resources', revision: catalog.revision, ids: [f.assemblyId], includeDependencies: true, includeChildren: false });
  const archive = path.join(f.temporary, 'limits.zip'); await writeExportZip(plan, archive); const stage = path.join(f.temporary, 'unpack'); await fs.mkdir(stage);
  const pack = await unpackResourcePackage(archive, stage); assert.equal(pack.manifest.documents.length, 4);
  for (const [name, mutate] of [['invalid-bounds', value => { value.camera.limits.right = value.camera.limits.left; }],
    ['hidden-v1-bounds', value => { value.schemaVersion = 1; }]]) {
    const manifest = structuredClone(pack.manifest), bodies = new Map();
    for (const file of manifest.files) bodies.set(file.path, await fs.readFile(path.join(pack.content, file.path)));
    const forged = structuredClone(f.value); mutate(forged); bodies.set(f.camera.sourcePath, Buffer.from(cameraJson(forged)));
    manifest.files = [...bodies].map(([path, bytes]) => ({ path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
    const zip = new yazl.ZipFile(), destination = path.join(f.temporary, name + '.zip'); zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
    for (const [name, bytes] of bodies) zip.addBuffer(bytes, name);
    const done = pipeline(zip.outputStream, createWriteStream(destination)); zip.end(); await done;
    const unpack = path.join(f.temporary, name); await fs.mkdir(unpack); await assert.rejects(unpackResourcePackage(destination, unpack));
  }
  const target = path.join(f.temporary, 'restored'); await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'workspace.json'), cameraJson({ ...f.source.workspace, version: 2, id: cameraId(199), paths: { documents: 'design-data', templates: 'data-template', metadata: 'metadata' } }));
  for (const folder of ['design-data', 'data-template', 'assets', 'metadata/documents', 'metadata/assets']) await fs.mkdir(path.join(target, folder), { recursive: true });
  const review = await planPackageImport(target, pack); assert.deepEqual(review.summary.conflicts, []); assert.equal((await applyPackageImport(target, pack, review.revision)).status, 'imported');
  await fs.rename(f.author, f.author + '-offline'); const rebuilt = await captureBuildSnapshot(target, f.assemblyId);
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt.diagnostics)); assert.deepEqual(rebuilt.plan.scenes[0].camera2d.document, f.value);
  assert.equal(rebuilt.plan.scenes[0].camera2d.manifest.sourcePath, 'design-data/cameras/world.json'); assert.equal(await fs.readFile(path.join(target, 'design-data/cameras/world.json'), 'utf8'), f.content);
  assert.equal(rebuilt.plan.scenes[0].actors[0].objectId, rebuilt.plan.scenes[0].actors[1].objectId); assert.equal(rebuilt.plan.scenes[0].camera2d.document.camera.targetInstanceId, f.instances[1]);
  assert.deepEqual(await inventory(f.author + '-offline'), before);
});

test('the unchanged creation journal validates bounded frozen dependencies without mutating their author intent', async () => {
  const f = await physics2dPureFixture(3, 2), value = { format: 'viento-scene-camera2d', schemaVersion: 2, sceneObjectId: sceneId,
    camera: { mode: 'follow', targetInstanceId: instanceA, offset: [500, -250], zoom: 2, limits: { ...bounds } } };
  const content = cameraJson(value), request = { ...f.request, command: 'camera2d.create', sourcePath: `${f.context.documentRoot}/cameras/bounded.json`, content };
  const p = await prepareCamera2DCreate(f.source, f.projection, f.sceneRecordContent, request, { digest });
  const record = JSON.parse(p.plans[1].afterContent), scene = JSON.parse(p.plans[2].afterContent.replace(/^\ufeff/, ''));
  assert.equal((await validateCamera2DCreateRecovery(record, content, scene, p.camera2DRecovery, f.registry(), { digest })).ok, true);
  assert.equal(p.plans[0].afterContent, content); assert.deepEqual(JSON.parse(content).camera.offset, [500, -250]);
  const malformed = structuredClone(value); malformed.camera.limits.left = malformed.camera.limits.right;
  assert.equal((await validateCamera2DCreateRecovery(record, cameraJson(malformed), scene, p.camera2DRecovery, f.registry(), { digest })).ok, false);
});
