import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createScenePreviewService } from '../lib/scene-preview-service.mjs';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const imageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-preview-'));
  await fs.cp(new URL('../../examples/scene2d/', import.meta.url), root, { recursive: true });
  const service = createScenePreviewService(root, { enabled: true, ...options });
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, service };
}
async function fingerprint(root) {
  const hashes = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const file = path.join(entry.parentPath || entry.path, entry.name);
      hashes[path.relative(root, file)] = buildHash(await fs.readFile(file));
    }
  }
  return hashes;
}

test('scene preview freezes the build plan and verified images without a tool, cache, or author writes', async t => {
  const { root, service } = await fixture(t), before = await fingerprint(root);
  const expected = await captureBuildSnapshot(root, sceneId), preview = await service.create({ sceneId });
  assert.equal(preview.ok, true); assert.equal(preview.format, 'viento-scene-preview'); assert.equal(preview.schemaVersion, 1);
  assert.equal(preview.snapshotId, expected.snapshotId); assert.deepEqual(preview.scene, expected.plan.scene);
  assert.deepEqual(preview.actors, expected.plan.actors); assert.equal(preview.resources.length, 1);
  const observed = await readWorldSnapshot(root), object = observed.projection.objects.find(item => item.id === sceneId);
  assert.deepEqual(preview.sceneEditing, { worldId: observed.projection.world.id, baseRevision: observed.projection.world.revision,
    objectRevision: object.revision, sourceRevision: object.documentRefs[0].sourceRevision,
    content: await fs.readFile(path.join(root, expected.plan.scene.sourcePath), 'utf8') });
  assert.equal(expected.snapshot.sceneEditing, undefined);
  assert.equal(expected.snapshot.sourceLocations, undefined);
  assert.equal(expected.snapshot.plan.sourceLocations, undefined);
  assert.deepEqual(preview.sourceLocations, expected.sourceLocations);
  const position = preview.sourceLocations.actors[0].fields.position;
  assert.equal(position.sourceRevision, preview.sceneEditing.sourceRevision);
  assert.equal(position.propertyPath, '/actors/0/position');
  assert.equal(position.sourceRange.exact, true);
  assert.deepEqual(JSON.parse(preview.sceneEditing.content.slice(position.sourceRange.start, position.sourceRange.end)), expected.plan.actors[0].position);
  assert.equal(expected.snapshotId, `sha256:${buildHash(canonicalJson(expected.snapshot))}`);
  assert.equal(preview.resources[0].contentType, 'image/svg+xml');
  assert.equal(preview.resources[0].url, `/api/scene-preview?previewId=${preview.previewId}&resourceId=${imageId}`);
  assert.equal(preview.snapshot, undefined); assert.ok(!JSON.stringify(preview).includes(root));
  assert.deepEqual(service.resource(preview.previewId, imageId).bytes, expected.resources.get(imageId));
  assert.deepEqual(await fingerprint(root), before);
  preview.resources[0].contentType = 'text/html';
  assert.equal(service.resource(preview.previewId, imageId).contentType, 'image/svg+xml');
});

test('scene preview retains frozen bytes and the last usable snapshot when live resources become invalid', async t => {
  const { root, service } = await fixture(t), preview = await service.create({ sceneId });
  const frozen = Buffer.from(service.resource(preview.previewId, imageId).bytes);
  await fs.writeFile(path.join(root, 'assets/traveler.svg'), '<svg>modified</svg>');
  assert.deepEqual(service.resource(preview.previewId, imageId).bytes, frozen);
  const rejected = await service.create({ sceneId });
  assert.equal(rejected.ok, false); assert.equal(rejected.previewId, null);
  assert.equal(rejected.diagnostics[0].code, 'build_resource_changed');
  assert.deepEqual(rejected.diagnostics[0].sourceRange, preview.sourceLocations.actors[0].fields.imageResourceId.sourceRange);
  assert.equal(rejected.diagnostics[0].sourceRevision, preview.sceneEditing.sourceRevision);
  assert.deepEqual(service.resource(preview.previewId, imageId).bytes, frozen);
  assert.deepEqual(await fs.readFile(path.join(root, 'assets/traveler.svg'), 'utf8'), '<svg>modified</svg>');
});

test('scene preview exposes only frozen scene editing fields and never the rest of a host capture', async t => {
  const { root, service } = await fixture(t, { capture: async (...args) => {
    const captured = await captureBuildSnapshot(...args);
    captured.sceneEditing.hostPath = '/private/workspace'; captured.sceneEditing.documents = captured.snapshot.source.documents;
    return captured;
  } });
  const preview = await service.create({ sceneId }), frozen = structuredClone(preview.sceneEditing);
  assert.deepEqual(Object.keys(preview.sceneEditing).sort(), ['baseRevision', 'content', 'objectRevision', 'sourceRevision', 'worldId']);
  assert.ok(!JSON.stringify(preview).includes('/private/workspace'));
  const source = path.join(root, preview.scene.sourcePath);
  await fs.writeFile(source, frozen.content.replace('Viento Scene2D', 'Changed title'));
  const next = await service.create({ sceneId });
  assert.deepEqual(preview.sceneEditing, frozen); assert.notEqual(next.sceneEditing.baseRevision, frozen.baseRevision);
  assert.notEqual(next.sceneEditing.objectRevision, frozen.objectRevision); assert.notEqual(next.sceneEditing.sourceRevision, frozen.sourceRevision);
  assert.equal(next.scene.sourceRevision, next.sceneEditing.sourceRevision);
  assert.equal(next.sceneEditing.content, await fs.readFile(source, 'utf8'));
});

test('scene preview rejects malformed scenes and strict identities without opening arbitrary paths', async t => {
  const { root, service } = await fixture(t), before = await fingerprint(root);
  for (const payload of [null, [], {}, { sceneId, root }, { sceneId: '../scene.json' }, { action: 'capture', sceneId }]) {
    await assert.rejects(service.create(payload), { errorCode: 'scene_preview_request_invalid' });
  }
  assert.throws(() => service.resource(sceneId, '../image'), { errorCode: 'scene_preview_request_invalid' });
  assert.throws(() => service.release('../snapshot'), { errorCode: 'scene_preview_request_invalid' });
  assert.throws(() => service.resource(sceneId, imageId), { errorCode: 'scene_preview_expired' });
  const missing = await service.create({ sceneId: imageId }); assert.equal(missing.ok, false);
  assert.equal(missing.diagnostics[0].code, 'build_scene_required');
  assert.deepEqual(await fingerprint(root), before);
  await fs.writeFile(path.join(root, 'documents/scenes/demo.json'), '{invalid');
  const invalid = await service.create({ sceneId }); assert.equal(invalid.ok, false);
  assert.equal(invalid.diagnostics[0].code, 'build_scene_json');
});

test('scene preview evicts the oldest of three snapshots and explicit release is idempotent', async t => {
  const { service } = await fixture(t);
  const first = await service.create({ sceneId }), second = await service.create({ sceneId }), third = await service.create({ sceneId });
  assert.throws(() => service.resource(first.previewId, imageId), { errorCode: 'scene_preview_expired' });
  assert.equal(service.resource(second.previewId, imageId).bytes.length, 231);
  assert.equal(service.resource(third.previewId, imageId).bytes.length, 231);
  assert.deepEqual(service.release(second.previewId), { released: true });
  assert.deepEqual(service.release(second.previewId), { released: false });
  assert.throws(() => service.resource(second.previewId, imageId), { errorCode: 'scene_preview_expired' });
  assert.equal(service.resource(third.previewId, imageId).bytes.length, 231);
});

test('scene preview expiration releases images even when no new capture replaces them', async t => {
  const { service } = await fixture(t, { ttlMs: 30 }), preview = await service.create({ sceneId });
  assert.equal(service.resource(preview.previewId, imageId).bytes.length, 231);
  await delay(60);
  assert.throws(() => service.resource(preview.previewId, imageId), { errorCode: 'scene_preview_expired' });
  assert.deepEqual(service.release(preview.previewId), { released: false });
});

test('scene preview total retained bytes are bounded independently of the snapshot count', async t => {
  const bytes = Buffer.alloc(65 * 1024 * 1024);
  const { service } = await fixture(t, { capture: async () => ({ ok: true, diagnostics: [], snapshotId: 'sha256:test',
    plan: { scene: {}, actors: [], resources: [{ id: imageId, size: bytes.length, sha256: buildHash(bytes), extension: 'png' }] },
    resources: new Map([[imageId, bytes]]) }) });
  const first = await service.create({ sceneId }), second = await service.create({ sceneId });
  assert.throws(() => service.resource(first.previewId, imageId), { errorCode: 'scene_preview_expired' });
  assert.equal(service.resource(second.previewId, imageId).bytes.length, bytes.length);
  assert.equal(second.sceneEditing, undefined, 'legacy capture implementations can still supply read-only previews');
});

test('new preview captures supersede late older requests and never capture concurrently', async t => {
  let releaseFirst, captures = 0, inFlight = 0, peak = 0;
  const { root, service } = await fixture(t, { capture: async (...args) => {
    captures++; inFlight++; peak = Math.max(peak, inFlight);
    if (captures === 1) await new Promise(resolve => { releaseFirst = resolve; });
    try { return await captureBuildSnapshot(...args); } finally { inFlight--; }
  } });
  const first = service.create({ sceneId });
  const firstRejected = assert.rejects(first, { errorCode: 'scene_preview_superseded' });
  const second = service.create({ sceneId });
  assert.equal(captures, 1); releaseFirst();
  await firstRejected; const preview = await second;
  assert.equal(preview.ok, true); assert.equal(captures, 2); assert.equal(peak, 1);
  assert.equal(preview.snapshotId, (await captureBuildSnapshot(root, sceneId)).snapshotId);
});

test('scene preview close aborts and waits for capture, blocks late publication, and is idempotent', async t => {
  let aborted = false;
  const { service } = await fixture(t, { capture: async (_root, _scene, { signal }) => {
    await new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
    return { ok: false, diagnostics: [] };
  } });
  const pending = service.create({ sceneId }), rejected = assert.rejects(pending, { errorCode: 'scene_preview_closed' });
  await service.close(); await rejected; await service.close(); assert.equal(aborted, true);
  await assert.rejects(service.create({ sceneId }), { errorCode: 'scene_preview_closed' });
  assert.throws(() => service.resource(sceneId, imageId), { errorCode: 'scene_preview_closed' });
});

test('scene preview disabled hosts never inspect workspace content', async t => {
  const { service } = await fixture(t, { enabled: false, capture: () => assert.fail('Disabled preview attempted capture') });
  await assert.rejects(service.create({ sceneId }), { errorCode: 'scene_preview_unavailable' });
  assert.throws(() => service.resource(sceneId, imageId), { errorCode: 'scene_preview_unavailable' });
  assert.throws(() => service.release(sceneId), { errorCode: 'scene_preview_unavailable' });
});

test('scene preview cannot follow replaced asset symlinks or admit unverified image bytes', async t => {
  const { root, service } = await fixture(t), original = await fs.readFile(path.join(root, 'assets/traveler.svg'));
  const outside = path.join(root, 'outside.svg'); await fs.writeFile(outside, original);
  await fs.unlink(path.join(root, 'assets/traveler.svg'));
  await fs.symlink(outside, path.join(root, 'assets/traveler.svg'));
  const linked = await service.create({ sceneId }); assert.equal(linked.ok, false);
  assert.equal(linked.diagnostics[0].code, 'path_forbidden');
  await fs.unlink(path.join(root, 'assets/traveler.svg'));
  await fs.writeFile(path.join(root, 'assets/traveler.svg'), original);
  const recordPath = path.join(root, `metadata/assets/${imageId}.json`), record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  delete record.content; await fs.writeFile(recordPath, JSON.stringify(record));
  await assert.rejects(service.create({ sceneId }), { errorCode: 'world_unavailable' });
});

test('scene preview captures only complete plans and hides host exceptions', async t => {
  const { service } = await fixture(t, { capture: async () => { throw new Error('/private/host/path failed'); } });
  await assert.rejects(service.create({ sceneId }), error => {
    assert.equal(error.errorCode, 'scene_preview_failed'); assert.equal(error.statusCode, 422);
    assert.ok(!error.message.includes('/private/host')); return true;
  });
});

test('disconnecting a preview request aborts its capture without replacing the last good images', async t => {
  let captures = 0, release, aborted = false;
  const { service } = await fixture(t, { capture: async (...args) => {
    if (++captures > 1) {
      const signal = args[2].signal;
      await new Promise(resolve => { release = resolve; signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }); });
    }
    return captureBuildSnapshot(...args);
  } });
  const first = await service.create({ sceneId }), controller = new AbortController();
  const second = service.create({ sceneId }, { signal: controller.signal });
  const rejected = assert.rejects(second, { errorCode: 'scene_preview_superseded' });
  assert.equal(typeof release, 'function'); controller.abort(); await rejected; assert.equal(aborted, true);
  assert.equal(service.resource(first.previewId, imageId).bytes.length, 231);
});

test('v2 preview shares frozen image bytes while resource errors locate the actual instance override', async t => {
  const { root, service } = await fixture(t), sourcePath = path.join(root, 'documents/scenes/demo.json');
  const scene = JSON.parse(await fs.readFile(sourcePath, 'utf8')), actor = scene.actors[0];
  scene.schemaVersion = 2;
  scene.actors = [
    { ...actor, instanceId: '11111111-1111-4111-8111-111111111111', imageResourceId: null },
    { ...actor, instanceId: '22222222-2222-4222-8222-222222222222', position: [420, 220] },
    { ...actor, instanceId: '33333333-3333-4333-8333-333333333333', position: [600, 220] },
  ];
  delete scene.actors[0].imageResourceId;
  await fs.writeFile(sourcePath, '\uFEFF' + JSON.stringify(scene, null, 2).replaceAll('\n', '\r\n'));
  const before = await fingerprint(root), preview = await service.create({ sceneId });
  assert.equal(preview.ok, true, JSON.stringify(preview.diagnostics)); assert.equal(preview.schemaVersion, 2); assert.equal(preview.resources.length, 1);
  assert.deepEqual(preview.actors.map(value => value.instanceId), scene.actors.map(value => value.instanceId));
  assert.equal(new Set(preview.actors.map(value => value.objectId)).size, 1);
  const captured = await captureBuildSnapshot(root, sceneId);
  assert.equal(captured.snapshot.schemaVersion, 1); assert.equal(captured.snapshot.plan.schemaVersion, 2);
  assert.equal(captured.resources.size, 1); assert.equal(captured.snapshot.source.documents.filter(value => value.record?.id === actor.objectId).length, 1);
  assert.deepEqual(await fingerprint(root), before);
  await fs.writeFile(path.join(root, 'assets/traveler.svg'), '<svg>changed</svg>');
  const rejected = await service.create({ sceneId }); assert.equal(rejected.ok, false);
  const diagnostic = rejected.diagnostics.find(value => value.code === 'build_resource_changed');
  assert.equal(diagnostic.propertyPath, '/actors/1/imageResourceId');
  assert.deepEqual(diagnostic.sourceRange, preview.sourceLocations.actors[1].fields.imageResourceId.sourceRange);
  assert.notDeepEqual(diagnostic.sourceRange, preview.sourceLocations.actors[0].fields.imageResourceId.sourceRange);
  assert.equal(service.resource(preview.previewId, imageId).bytes.length, 231, 'prior frozen preview bytes remain available');
});

test('schema3 capture and preview carry detached editor groups outside an unchanged v2 runtime plan', async t => {
  const { root, service } = await fixture(t), source = path.join(root, 'documents/scenes/demo.json');
  const value = JSON.parse(await fs.readFile(source, 'utf8')), actor = value.actors[0];
  const parent = '11111111-1111-4111-8111-111111111111', child = '22222222-2222-4222-8222-222222222222';
  value.schemaVersion = 3; value.groups = [{ groupId: parent, name: 'Shared actors' }, { groupId: child, name: 'Child', parentGroupId: parent }];
  value.actors = [{ ...actor, instanceId: '33333333-3333-4333-8333-333333333333', groupId: child },
    { ...actor, instanceId: '44444444-4444-4444-8444-444444444444', position: [420, 220] }];
  const content = '\uFEFF' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n'); await fs.writeFile(source, content);
  const before = await fingerprint(root), captured = await captureBuildSnapshot(root, sceneId), result = await service.create({ sceneId });
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics)); assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(captured.plan.schemaVersion, 2); assert.equal(result.schemaVersion, 2); assert.equal(captured.snapshot.schemaVersion, 1);
  assert.deepEqual(result.sceneStructure, captured.sceneStructure); assert.deepEqual(result.sceneStructure.groups, value.groups);
  assert.deepEqual(result.sceneStructure.memberships, [{ instanceId: value.actors[0].instanceId, groupId: child }]);
  assert.deepEqual(Object.keys(result.sceneEditing).sort(), ['baseRevision', 'content', 'objectRevision', 'sourceRevision', 'worldId']);
  assert.equal(result.sceneEditing.content, content); assert.equal(captured.snapshot.sceneStructure, undefined); assert.equal(captured.snapshot.plan.sceneStructure, undefined);
  assert.equal(captured.plan.groups, undefined); assert.ok(captured.plan.actors.every(actor => !Object.hasOwn(actor, 'groupId')));
  assert.equal(result.sourceLocations.groups[1].declaration.propertyPath, '/groups/1'); assert.equal(result.sourceLocations.groups[1].fields.parentGroupId.propertyPath, '/groups/1/parentGroupId');
  assert.deepEqual(await fingerprint(root), before); result.sceneStructure.groups[0].name = 'Client-only';
  assert.equal((await service.create({ sceneId })).sceneStructure.groups[0].name, 'Shared actors');
  assert.equal(captured.sceneStructure.groups[0].name, 'Shared actors'); assert.ok(!JSON.stringify(result).includes(root));
});

test('preview rejects malformed structure sidecars without leaking host-only fields or retaining resource handles', async t => {
  let forged;
  const { service } = await fixture(t, { capture: async (...args) => {
    const captured = await captureBuildSnapshot(...args); captured.sceneStructure = forged; return captured;
  } });
  forged = { format: 'viento-scene-structure', schemaVersion: 1, sourceSchemaVersion: 3, groups: [], memberships: [], hostPath: '/private/workspace' };
  await assert.rejects(service.create({ sceneId }), { errorCode: 'scene_structure_invalid' });
});
