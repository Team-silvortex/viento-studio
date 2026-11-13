import test from 'node:test';
import assert from 'node:assert/strict';
import { physics2dPureFixture, id, digest, revision, actorId, sceneId, manifestId, instanceA } from './helpers/world-physics2d-create-pure-fixture.mjs';
import { prepareCamera2DCreate, inspectCamera2DCreateScene, validateCamera2DCreateRecovery } from '../../engine/world-camera2d-create.mjs';
import { createWorldProjection, canonicalJson } from '../../engine/world-projection.mjs';
import { worldMutationDescriptors, validateWorldCommand } from '../../engine/world-command-contract.mjs';

const content = (camera = { mode: 'fixed', center: [320, 240], zoom: 1 }) => '\uFEFF' + JSON.stringify({ format: 'viento-scene-camera2d', schemaVersion: 1, sceneObjectId: sceneId, camera }, null, 2).replaceAll('\n', '\r\n') + '\r\n';
async function fixture(version = 3, schema = 2, camera) {
  const f = await physics2dPureFixture(version, schema);
  f.request = { ...f.request, command: 'camera2d.create', sourcePath: `${f.context.documentRoot}/cameras/demo.json`, content: content(camera) };
  return { ...f, run: (patch = {}, options = { digest }) => prepareCamera2DCreate(f.source, f.projection, f.sceneRecordContent, { ...f.request, ...patch }, options) };
}
for (const [version, schema] of [[2, 2], [3, 2], [3, 3]]) test(`camera2d.create plans exact three files in workspace ${version}, scene ${schema}`, async () => {
  const f = await fixture(version, schema), before = canonicalJson(f.source), p = await f.run();
  assert.equal(canonicalJson(f.source), before); assert.equal(p.kind, 'camera2d.create'); assert.equal(p.plans.length, 3);
  assert.equal(p.plans[0].afterContent, f.request.content); assert.equal(p.plans[0].beforeContent, null); assert.equal(p.plans[1].beforeContent, null);
  assert.equal(p.plans[2].beforeContent, f.sceneRecordContent); assert.ok(p.plans[2].afterContent.startsWith('\uFEFF')); assert.ok(p.plans[2].afterContent.includes('\r\n'));
  assert.deepEqual(p.result.changes.map(change => change.kind), ['camera2d.create', 'relation.add']);
  const record = JSON.parse(p.plans[1].afterContent); assert.deepEqual(record.relations, [{ kind: 'references', targetId: sceneId, slot: 'scene' }]);
  assert.equal(p.result.relation.properties.slot, 'camera2d');
  const next = await createWorldProjection(p.nextSource, { digest }), ready = inspectCamera2DCreateScene(p.nextSource, next, sceneId);
  assert.equal(ready.manifest.record.id, manifestId); assert.equal(ready.targets.length, 2);
});
test('follow accepts only a stable member of the frozen scene, not an object id or another scene', async () => {
  const f = await fixture(3, 2, { mode: 'follow', targetInstanceId: instanceA, offset: [-100, 30], zoom: 2 });
  assert.equal((await f.run()).plans.length, 3);
  for (const target of [actorId, id(999)]) await assert.rejects(f.run({ content: content({ mode: 'follow', targetInstanceId: target, offset: [0, 0], zoom: 1 }) }), { errorCode: 'world_camera2d_invalid' });
  await assert.rejects(f.run({ content: JSON.stringify({ format: 'viento-scene-camera2d', schemaVersion: 1, sceneObjectId: id(999), camera: { mode: 'fixed', center: [0, 0], zoom: 1 } }) }), { errorCode: 'world_camera2d_invalid' });
});
test('source limits, schema, extensions, stale revisions and existing camera fail closed', async () => {
  const f = await fixture();
  for (const camera of [{ mode: 'fixed', center: [0, 0], zoom: 0 }, { mode: 'fixed', center: [100001, 0], zoom: 1 }, { mode: 'fixed', center: [0, 0], zoom: 1, extra: true }]) await assert.rejects(f.run({ content: content(camera) }), { errorCode: 'world_camera2d_invalid' });
  await assert.rejects(f.run({ baseRevision: revision('stale') }), { errorCode: 'world_revision_conflict' });
  await assert.rejects(f.run({ sceneSourceRevision: revision('stale') }), { errorCode: 'world_revision_conflict' });
  await assert.rejects(f.run({ sourcePath: 'documents/cameras/not-json.txt' }), { errorCode: 'world_camera2d_invalid' });
  await assert.rejects(f.run({ content: ' '.repeat(16385) }), { errorCode: 'world_command_invalid' });
  const p = await f.run(), next = await createWorldProjection(p.nextSource, { digest }), scene = next.objects.find(o => o.id === sceneId);
  await assert.rejects(prepareCamera2DCreate(p.nextSource, next, p.plans[2].afterContent, { ...f.request, objectId: id(100), baseRevision: next.world.revision, sceneObjectRevision: scene.revision }, { digest }), { errorCode: 'world_camera2d_invalid' });
});
test('recovery rejects forged frozen dependencies, reverse links, and extra files', async () => {
  const f = await fixture(3, 2, { mode: 'follow', targetInstanceId: instanceA, offset: [0, 0], zoom: 1 }), p = await f.run();
  const record = JSON.parse(p.plans[1].afterContent), scene = JSON.parse(p.plans[2].afterContent.replace(/^\uFEFF/, ''));
  const check = (r, s, evidence) => validateCamera2DCreateRecovery(r, f.request.content, s, evidence, f.registry(), { digest });
  assert.equal((await check(record, scene, p.camera2DRecovery)).ok, true);
  for (const mutate of [x => { x.scene.content += ' '; }, x => { x.definitions[0].objectId = id(999); }, x => { x.definitions.push(x.definitions[0]); }, x => { x.extra = true; }]) {
    const evidence = structuredClone(p.camera2DRecovery); mutate(evidence); assert.equal((await check(record, scene, evidence)).ok, false);
  }
  const reverse = structuredClone(record); reverse.relations[0].slot = ''; assert.equal((await check(reverse, scene, p.camera2DRecovery)).ok, false);
  const unlink = structuredClone(scene); unlink.relations = unlink.relations.filter(x => x.slot !== 'camera2d'); assert.equal((await check(record, unlink, p.camera2DRecovery)).ok, false);
});
test('command request is detached, bounded, and publicly discoverable', async () => {
  const f = await fixture(), descriptor = worldMutationDescriptors().find(item => item.id === 'camera2d.create');
  assert.equal(descriptor.inputSchema.properties.content.maxLength, 16384); assert.equal(validateWorldCommand(f.request).command, 'camera2d.create');
  const input = { ...f.request, actorRef: { ...f.request.actorRef } }, delayed = async value => { input.actorRef.id = 'altered'; return digest(value); };
  assert.equal((await f.run(input, { digest: delayed })).result.proposal.actorRef.id, f.request.actorRef.id);
  const accessor = { ...f.request }; Object.defineProperty(accessor, 'content', { enumerable: true, get: () => f.request.content });
  assert.throws(() => validateWorldCommand(accessor), { errorCode: 'world_command_invalid' });
});
