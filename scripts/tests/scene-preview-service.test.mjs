import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createScenePreviewService } from '../lib/scene-preview-service.mjs';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';

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
  assert.deepEqual(service.resource(preview.previewId, imageId).bytes, frozen);
  assert.deepEqual(await fs.readFile(path.join(root, 'assets/traveler.svg'), 'utf8'), '<svg>modified</svg>');
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
