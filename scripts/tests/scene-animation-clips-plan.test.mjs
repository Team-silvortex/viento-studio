import test from 'node:test';
import assert from 'node:assert/strict';
import '../adapters/node-studio-core.mjs';
import { resolveSceneAnimation, validateSceneAnimationPlan, stripSceneAnimationPlan, sceneAnimationCapabilities } from '../../engine/scene-animation.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const revision = 'sha256:' + 'a'.repeat(64);
const document = () => ({ format: 'viento-scene-animation', schemaVersion: 3, sceneObjectId: id(1), durationSeconds: 2, loop: true,
  tracks: [{ id: id(2), instanceId: id(3), property: 'opacity', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: 1 }] }],
  clips: [{ id: id(4), name: 'Attack', startSeconds: .5, endSeconds: 2, loop: false }] });
function plan(doc = document()) {
  const base = { format: 'viento-build-plan', schemaVersion: 2, kind: 'scene2d', scene: { objectId: id(1) }, actors: [{ instanceId: id(3) }], resources: [], requiredCapabilities: sceneAnimationCapabilities(doc) };
  const observed = { source: { documents: [{ record: { id: id(1), relations: [{ kind: 'animation', targetId: id(5) }] }, sourcePath: 'documents/scene.json', sourceRevision: revision },
    { record: { id: id(5), format: 'viento-document', sourcePath: 'documents/animation.json', relations: [{ kind: 'reference', targetId: id(1) }] }, sourcePath: 'documents/animation.json', sourceRevision: revision, content: JSON.stringify(doc, null, 2) }] } };
  const resolved = resolveSceneAnimation(observed, base); assert.deepEqual(resolved.diagnostics, []);
  return { ...base, animation: resolved.animation };
}
test('schema3 plans opt into clips capability and plan2 aligned clip source locations with no new resources', () => {
  const p = plan(); assert.equal(p.animation.schemaVersion, 2); assert.deepEqual(Object.keys(p.animation.locations), ['tracks', 'clips']);
  assert.deepEqual(p.requiredCapabilities, ['animation.visual2d', 'animation.clips2d']); assert.deepEqual(validateSceneAnimationPlan(p), p.animation);
  const at = p.animation.locations.clips[0]; assert.equal(at.id, id(4)); assert.equal(at.declaration.propertyPath, '/clips/0'); assert.equal(at.declaration.sourceRange.exact, true);
  assert.deepEqual(stripSceneAnimationPlan(p).requiredCapabilities, []); assert.deepEqual(stripSceneAnimationPlan(p).resources, []);
});
test('clip source maps reject omitted reordered foreign or tampered identities without changing legacy plan shape', () => {
  const p = plan();
  for (const mutate of [p => p.animation.schemaVersion = 1, p => delete p.animation.locations.clips, p => p.animation.locations.clips = [], p => p.animation.locations.clips[0].id = id(9),
    p => p.animation.locations.clips[0].declaration.objectId = id(9), p => p.animation.locations.clips[0].declaration.propertyPath = '/tracks/0', p => p.requiredCapabilities.pop()]) {
    const bad = structuredClone(p); mutate(bad); assert.throws(() => validateSceneAnimationPlan(bad), { errorCode: 'build_animation_invalid' });
  }
  for (const version of [1, 2]) { const doc = document(); doc.schemaVersion = version; delete doc.clips; const old = plan(doc);
    assert.equal(old.animation.schemaVersion, 1); assert.deepEqual(Object.keys(old.animation.locations), ['tracks']); assert.deepEqual(validateSceneAnimationPlan(old), old.animation); }
});
test('empty v3 clip list retains explicit capability and plan2 without fabricating dependencies', () => {
  const doc = document(); doc.clips = []; const p = plan(doc); assert.equal(p.animation.schemaVersion, 2); assert.deepEqual(p.animation.locations.clips, []);
  assert.ok(p.requiredCapabilities.includes('animation.clips2d')); assert.deepEqual(validateSceneAnimationPlan(p), p.animation);
});
