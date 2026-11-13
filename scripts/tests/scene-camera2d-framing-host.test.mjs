import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scenePhysics2DInputInstancesAuthor } from './helpers/scene-physics2d-input-instances-author-fixture.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { inventory } from './runtime-case-fixture.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { resolveScene2DModel } from '../../engine/scene-model.mjs';
import { captureSceneCamera2DFramingContext } from '../../engine/scene-camera2d-framing-context.mjs';
const cameraId = '98989898-9898-4898-8898-989898989898';
async function fixture(t, { camera = false } = {}) {
 const f = await scenePhysics2DInputInstancesAuthor(t), cacheRoot = path.join(f.temporary, 'framing-unused-cache'), service = createProjectBuildService(f.author, { enabled: true, tool: undefined, cacheRoot }); t.after(() => service.close());
 if (camera) {
  const initial = await service.command({ action: 'camera2d-inspect', sceneId: f.sceneIds[0] });
  const value = { format: 'viento-scene-camera2d', schemaVersion: 1, sceneObjectId: f.sceneIds[0], camera: { mode: 'fixed', center: [400, 240], zoom: 1 } };
  await createWorldCommandService(f.author)({ command: 'camera2d.create', mode: 'apply', worldId: initial.worldId, baseRevision: initial.baseRevision, actorRef: { kind: 'tool', id: 'framing-test' }, objectId: cameraId,
   documentType: initial.documentTypes[0].id, sourcePath: 'documents/cameras/main.json', content: JSON.stringify(value, null, 2) + '\n', sceneObjectId: initial.scene.objectId, sceneObjectRevision: initial.scene.objectRevision, sceneSourceRevision: initial.scene.sourceRevision });
 }
 return { ...f, service, cacheRoot };
}
const inspect = f => f.service.command({ action: 'camera2d-inspect', sceneId: f.sceneIds[0] });

test('host inspect supplies one-snapshot framing without a runtime job, image binary or author write', async t => {
 const f = await fixture(t), assets = await fs.readdir(path.join(f.author, 'assets')), images = assets.filter(name => name.endsWith('.svg')); assert.ok(images.length); for (const name of images) await fs.rm(path.join(f.author, 'assets', name));
 const before = await inventory(f.author), context = await inspect(f), observed = await readWorldSnapshot(f.author), model = resolveScene2DModel(observed, f.sceneIds[0]);
 assert.equal(model.ok, true); assert.ok(model.model.resources.length); assert.ok(observed.source.assets.some(asset => asset.availability === 'missing')); assert.ok(context.framing); assert.equal(context.framing.actors.length, 6); assert.deepEqual(context.framingDiagnostics, []);
 assert.equal(context.framing.worldId, context.worldId); assert.equal(context.framing.baseRevision, context.baseRevision); assert.equal(context.framing.scene.sourceRevision, context.scene.sourceRevision);
 assert.deepEqual(context.framing.actors.map(actor => actor.position), model.model.actors.map(actor => actor.position));
 assert.ok(captureSceneCamera2DFramingContext(context.framing, context)); assert.deepEqual(await inventory(f.author), before);
 assert.equal((await f.service.status()).job, null); await assert.rejects(fs.stat(f.cacheRoot), { code: 'ENOENT' });
});

test('host reference directory identifies a saved assembly entry viewport and refreshes its owning revisions', async t => {
 const f = await fixture(t), initial = await inspect(f);
 await f.edit('documents/projects/demo.json', document => { document.sceneIds = f.sceneIds; document.entrySceneId = f.sceneIds[1]; });
 await f.edit('documents/scenes/audio.json', document => { document.viewport = [1024, 768]; });
 const next = await inspect(f), row = next.framing.viewports.find(item => item.id === `assembly:${f.assemblyId}`);
 assert.ok(row); assert.equal(row.entryScene.objectId, f.sceneIds[1]); assert.deepEqual(row.viewport, [1024, 768]);
 assert.notEqual(next.baseRevision, initial.baseRevision); assert.equal(next.framing.baseRevision, next.baseRevision); assert.notEqual(row.source.sourceRevision, initial.framing.viewports[1].source.sourceRevision);
 assert.deepEqual(next.framing.viewports[0].viewport, next.scene.viewport); assert.equal(next.framing.viewports[0].source.sourceRevision, next.scene.sourceRevision);
});

test('bad optional geometry disables only the illustration while the existing numeric camera still saves', async t => {
 const f = await fixture(t, { camera: true }); await f.edit('documents/scenes/demo.json', document => { document.actors[0].size = [0, 20]; });
 const context = await inspect(f); assert.ok(context.manifest); assert.ok(context.framing); assert.equal(context.framing.actors, null);
 assert.ok(context.framing.diagnostics.some(row => row.code === 'scene_camera2d_framing_geometry_unavailable'));
 const value = JSON.parse(context.manifest.content); value.camera.zoom = 2; const before = await inventory(f.author);
 const saved = await f.service.command({ action: 'camera2d-save', sceneId: f.sceneIds[0], sceneVersion: context.scene.sourceRevision, documentId: cameraId, expectedVersion: context.manifest.sourceRevision, content: JSON.stringify(value) });
 assert.equal(saved.valid, true); const after = await inventory(f.author); for (const [name, digest] of Object.entries(before)) if (name !== context.manifest.sourcePath) assert.equal(after[name], digest, name);
 assert.equal((await f.service.status()).job, null);
});

test('unavailable design viewport leaves inspect and its numeric manifest available with a local framing diagnostic', async t => {
 const f = await fixture(t, { camera: true }); await f.edit('documents/scenes/demo.json', document => { document.viewport = [0, 480]; });
 const before = await inventory(f.author), context = await inspect(f); assert.ok(context.manifest); assert.equal(context.framing, null);
 assert.equal(context.framingDiagnostics[0].code, 'scene_camera2d_framing_unavailable'); assert.deepEqual(await inventory(f.author), before);
});
