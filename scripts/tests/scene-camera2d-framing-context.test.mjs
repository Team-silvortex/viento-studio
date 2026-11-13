import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { resolveScene2DModel } from '../../engine/scene-model.mjs';
import { createSceneCamera2DFramingContext } from '../lib/scene-camera2d-framing.mjs';
import { captureSceneCamera2DFramingContext } from '../../engine/scene-camera2d-framing-context.mjs';
import { sceneCamera2DFixture, cameraId, cameraJson, cameraDigest } from './helpers/scene-camera2d-fixture.mjs';
const invalid = { errorCode: 'scene_camera2d_framing_invalid' };
function catalog(f, sceneId = f.sceneId) {
 const document = f.source.documents.find(row => row.record.id === sceneId), object = f.projection.objects.find(row => row.id === sceneId), scene = JSON.parse(document.content.replace(/^\uFEFF/, ''));
 return { worldId: f.projection.world.id, baseRevision: f.projection.world.revision,
  scene: { objectId: sceneId, objectRevision: object.revision, sourcePath: document.sourcePath, sourceRevision: document.sourceRevision, viewport: scene.viewport },
  targets: scene.actors.map(actor => ({ instanceId: actor.instanceId, objectId: actor.objectId, name: f.projection.objects.find(row => row.id === actor.objectId)?.name })) };
}
async function refresh(f) { f.projection = await createWorldProjection(f.source, { digest: cameraDigest }); return f; }
function add(f, id, sourcePath, value) {
 const prototype = f.scene || f.source.documents[0], content = cameraJson(value);
 const document = { ...prototype, sourcePath, content, sourceRevision: `sha256:${cameraDigest(content)}`, record: { ...prototype.record, id, sourcePath, relations: [], assetBindings: [] } };
 f.source.documents.push(document); return document;
}
const capture = f => createSceneCamera2DFramingContext(f, f.sceneId, catalog(f));

test('framing context owns bounded logical geometry and scene/assembly source versions from one snapshot', async () => {
 const f = await sceneCamera2DFixture(), before = structuredClone(f.source), view = capture(f), c = catalog(f);
 assert.equal(view.worldId, c.worldId); assert.equal(view.baseRevision, c.baseRevision); assert.deepEqual(view.scene, Object.fromEntries(Object.entries(c.scene).filter(([key]) => key !== 'viewport')));
 assert.deepEqual(view.actors.map(row => row.position), [[-100, -80], [1500, 900]]); assert.equal(view.actors[0].objectId, view.actors[1].objectId);
 assert.deepEqual(view.viewports.map(row => row.kind), ['scene', 'assembly-entry']); assert.deepEqual(view.viewports[0].viewport, [640, 480]);
 assert.equal(view.viewports[1].source.objectId, f.assemblyId); assert.equal(view.viewports[1].source.sourceRevision, f.assembly.sourceRevision);
 assert.deepEqual(view.viewports[1].entryScene, view.scene); assert.ok(Object.isFrozen(view.actors[0].position)); assert.deepEqual(f.source, before);
 const detached = captureSceneCamera2DFramingContext(structuredClone(view), c); assert.notEqual(detached, view); assert.notEqual(detached.actors[0].position, view.actors[0].position);
 assert.equal(Object.hasOwn(view.actors[0], 'imageResourceId'), false); assert.equal(JSON.stringify(view).includes('content'), false);
});

test('projection inheritance is resolved by the shared scene model rather than raw geometry defaults', async () => {
 const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v2.json', import.meta.url))), f = { ...golden.observed, sceneId: golden.ids.scene };
 const current = await sceneCamera2DFixture(); f.source.workspace = current.source.workspace; f.source.definition = current.source.definition; await refresh(f);
 const declaration = JSON.parse(f.source.documents.find(row => row.record.id === f.sceneId).content.replace(/^\uFEFF/, ''));
 assert.equal(declaration.actors[0].useProjectionDefaults, true); assert.equal(Object.hasOwn(declaration.actors[0], 'size'), false);
 const view = capture(f), model = resolveScene2DModel(f, f.sceneId); assert.equal(model.ok, true);
 assert.deepEqual(view.actors.map(row => row.size), model.model.actors.map(row => row.size)); assert.deepEqual(view.actors[0].size, [80, 60]);
 assert.deepEqual(view.actors.map(row => row.color), model.model.actors.map(row => row.color));
});

test('assembly viewport reference uses the saved entry scene, independently of executable behavior readiness', async () => {
 const f = await sceneCamera2DFixture(), secondId = cameraId(50), second = add(f, secondId, 'documents/scenes/entry.json', { ...f.declaration, viewport: [1024, 768] });
 second.record.relations.push({ kind: 'references', targetId: f.definitionId, slot: 'definition' }, { kind: 'behavior', targetId: cameraId(999), slot: 'unavailable-behavior' });
 f.update(f.assembly, { format: 'viento-project-assembly', schemaVersion: 1, title: 'Reference assembly', sceneIds: [f.sceneId, secondId], entrySceneId: secondId }); await refresh(f);
 const view = capture(f), row = view.viewports[1]; assert.deepEqual(row.viewport, [1024, 768]); assert.equal(row.source.objectId, f.assemblyId); assert.equal(row.entryScene.objectId, secondId); assert.equal(row.entryScene.sourceRevision, second.sourceRevision);
 assert.deepEqual(view.viewports[0].viewport, [640, 480]); assert.equal(Object.hasOwn(row, 'runnable'), false); assert.deepEqual(view.diagnostics, []);
});

test('bad optional assembly references remain local while the selected scene still frames', async () => {
 const f = await sceneCamera2DFixture(), secondId = cameraId(50); add(f, secondId, 'documents/scenes/bad-entry.json', { ...f.declaration, viewport: [0, 768] });
 f.update(f.assembly, { format: 'viento-project-assembly', schemaVersion: 1, title: 'Bad viewport', sceneIds: [f.sceneId, secondId], entrySceneId: secondId }); await refresh(f);
 const view = capture(f); assert.equal(view.actors.length, 2); assert.equal(view.viewports.length, 1); assert.equal(view.diagnostics[0].code, 'scene_camera2d_framing_reference_unavailable'); assert.equal(view.diagnostics[0].objectId, f.assemblyId);
});

test('invalid geometry and duplicate instance identities never fall back to fabricated actor rectangles', async () => {
 for (const mutate of [scene => { scene.actors[0].position = [NaN, 0]; }, scene => { scene.actors[0].size = [0, 20]; }, scene => { scene.actors[1].instanceId = scene.actors[0].instanceId; }]) {
  const f = await sceneCamera2DFixture(); mutate(f.declaration); f.update(f.scene, f.declaration); await refresh(f); const view = capture(f);
  assert.equal(view.actors, null); assert.ok(view.diagnostics.some(row => row.code === 'scene_camera2d_framing_geometry_unavailable')); assert.equal(view.viewports[0].kind, 'scene');
 }
});

test('assembly reference directory is capped at 32 with an explicit local truncation notice', async () => {
 const f = await sceneCamera2DFixture(); f.source.documents = f.source.documents.filter(row => row.record.id !== f.assemblyId);
 for (let n = 0; n < 34; n++) add(f, cameraId(100 + n), `documents/projects/ref-${n}.json`, { format: 'viento-project-assembly', schemaVersion: 1, title: `Ref ${n}`, sceneIds: [f.sceneId], entrySceneId: f.sceneId });
 await refresh(f); const view = capture(f); assert.equal(view.viewports.length, 33); assert.equal(view.viewports[0].kind, 'scene'); assert.equal(view.diagnostics.at(-1).code, 'scene_camera2d_framing_references_limited');
});

test('browser capture binds scene/world versions, exact actor identity/order and design viewport', async () => {
 const f = await sceneCamera2DFixture(), context = catalog(f), original = capture(f);
 for (const mutate of [
  x => { x.baseRevision = `sha256:${'f'.repeat(64)}`; }, x => { x.scene.sourceRevision = `sha256:${'f'.repeat(64)}`; },
  x => { x.worldId = `world:${'f'.repeat(64)}`; }, x => { x.scene.objectId = cameraId(999); }, x => { x.actors.reverse(); },
  x => { x.actors[0].objectId = cameraId(999); }, x => { x.actors[1].instanceId = x.actors[0].instanceId; },
  x => { x.viewports[0].viewport = [800, 480]; }, x => { x.viewports[1].id = x.viewports[0].id; },
  x => { x.viewports[1].entryScene.sourceRevision = `sha256:${'f'.repeat(64)}`; }, x => { x.actors[0].image = 'not-a-geometry-field'; },
  x => { x.actors[0].position = [Infinity, 0]; }, x => { x.viewports.push(...Array(33).fill(x.viewports[1])); },
 ]) { const value = structuredClone(original); mutate(value); assert.throws(() => captureSceneCamera2DFramingContext(value, context), invalid); }
});

test('browser capture rejects accessors, serializers, sparse/named arrays and coercion hooks without executing them', async () => {
 const f = await sceneCamera2DFixture(), context = catalog(f), original = capture(f); let called = 0;
 const values = [];
 const getter = structuredClone(original); Object.defineProperty(getter.actors[0], 'position', { enumerable: true, get() { called++; return [0, 0]; } }); values.push(getter);
 const named = structuredClone(original); named.actors.extra = 1; values.push(named);
 const sparse = structuredClone(original); delete sparse.actors[0]; values.push(sparse);
 const hidden = structuredClone(original); Object.defineProperty(hidden, 'baseRevision', { value: original.baseRevision, enumerable: false }); values.push(hidden);
 const serializer = structuredClone(original); serializer.toJSON = () => { called++; return original; }; values.push(serializer);
 const symbol = structuredClone(original); symbol[Symbol('private')] = 1; values.push(symbol);
 const color = structuredClone(original); color.actors[0].color = { toString() { called++; return '#ffffff'; } }; values.push(color);
 for (const value of values) assert.throws(() => captureSceneCamera2DFramingContext(value, context), invalid);
 const parent = structuredClone(context); parent.worldId = { toString() { called++; return original.worldId; } }; assert.throws(() => captureSceneCamera2DFramingContext(original, parent), invalid);
 assert.equal(called, 0);
});


test('reference truncation notice survives a full local diagnostic budget', async () => {
 const f = await sceneCamera2DFixture(); f.source.documents = f.source.documents.filter(row => row.record.id !== f.assemblyId);
 for (let n = 0; n < 65; n++) add(f, cameraId(300 + n), `documents/projects/broken-${n}.json`, { format: 'viento-project-assembly', schemaVersion: 1, title: 'Broken', sceneIds: [], entrySceneId: f.sceneId });
 for (let n = 0; n < 34; n++) add(f, cameraId(400 + n), `documents/projects/reference-${n}.json`, { format: 'viento-project-assembly', schemaVersion: 1, title: `Ref ${n}`, sceneIds: [f.sceneId], entrySceneId: f.sceneId });
 await refresh(f); const view = capture(f); assert.equal(view.viewports.length, 33); assert.equal(view.diagnostics.length, 64); assert.equal(view.diagnostics.at(-1).code, 'scene_camera2d_framing_references_limited');
});


test('JSON-looking Markdown assemblies are not saved assembly viewport references', async () => {
 const f = await sceneCamera2DFixture(); add(f, cameraId(80), 'documents/projects/example.md', { format: 'viento-project-assembly', schemaVersion: 1, title: 'Markdown example', sceneIds: [f.sceneId], entrySceneId: f.sceneId });
 await refresh(f); const view = capture(f); assert.equal(view.viewports.length, 2); assert.ok(!view.viewports.some(row => row.source.objectId === cameraId(80)));
 const forged = structuredClone(view); forged.viewports[1].source.sourcePath = 'documents/projects/example.md'; assert.throws(() => captureSceneCamera2DFramingContext(forged, catalog(f)), invalid);
});
