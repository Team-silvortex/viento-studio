import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackendProjectDeliveryReview, validateBackendProjectDeliveryReview } from '../../engine/backend-project-delivery.mjs';
import { backendProjectFixture } from './helpers/backend-project-fixture.mjs';

const invalid = { errorCode: 'backend_project_delivery_invalid' };

test('delivery review detaches and freezes the existing Godot and Bevy manifest with stable ASCII names', async t => {
  for (const backend of ['godot', 'bevy']) {
    const f = await backendProjectFixture(t, { backend }), original = structuredClone(f.project);
    const review = createBackendProjectDeliveryReview(original, f.manifestSha256);
    assert.deepEqual(validateBackendProjectDeliveryReview(review), review);
    assert.equal(review.fileName, `viento-${f.build.buildId}.viento-build.zip`);
    assert.equal(Object.isFrozen(review), true); assert.equal(Object.isFrozen(review.project.files[0]), true);
    original.tool.version = 'changed'; assert.notEqual(review.project.tool.version, 'changed');
    assert.equal(JSON.stringify(review).includes(f.author), false); assert.equal(JSON.stringify(review).includes(f.directory), false);
  }
});

test('delivery review rejects unknown schema, forged names, malformed hashes and manifest changes', async t => {
  const f = await backendProjectFixture(t), review = createBackendProjectDeliveryReview(f.project, f.manifestSha256);
  for (const change of [r => { r.extra = true; }, r => { r.schemaVersion = 2; }, r => { r.format = 'viento-archive'; },
    r => { r.fileName = '../project.zip'; }, r => { r.manifestSha256 = 'A'.repeat(64); }, r => { r.project.files[0].size = -1; },
    r => { r.project.tool.path = '/usr/local/godot'; }, r => { r.project.files.length = 0; }]) {
    const changed = structuredClone(review); change(changed); assert.throws(() => validateBackendProjectDeliveryReview(changed), invalid);
  }
});

test('delivery validation never evaluates accessors serializers sparse arrays or pollution keys', async t => {
  const f = await backendProjectFixture(t), review = createBackendProjectDeliveryReview(f.project, f.manifestSha256); let reads = 0;
  const getter = { ...review }; Object.defineProperty(getter, 'project', { enumerable: true, get() { reads++; return f.project; } });
  const nested = structuredClone(review); Object.defineProperty(nested.project.source, 'sceneId', { enumerable: true, get() { reads++; return f.project.source.sceneId; } });
  const serializer = { ...review, toJSON() { reads++; return review; } };
  const sparse = structuredClone(review); delete sparse.project.files[0];
  const poison = structuredClone(review); Object.defineProperty(poison, '__proto__', { value: {}, enumerable: true });
  for (const input of [getter, nested, serializer, sparse, poison, Object.create(review)]) assert.throws(() => validateBackendProjectDeliveryReview(input), invalid);
  assert.equal(reads, 0);
});
