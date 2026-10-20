import test from 'node:test';
import assert from 'node:assert/strict';
import '../adapters/node-studio-core.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { captureBuildSnapshot, captureScenePreviewSnapshot } from '../adapters/node-build-snapshot.mjs';
import { createScene2DPlan } from '../../engine/build-plan.mjs';
import { validateSceneAnimationPlan, stripSceneAnimationPlan } from '../../engine/scene-animation.mjs';
import { GODOT4_EXECUTION_ADAPTER as godot } from '../backends/godot4-adapter.mjs';
import { BEVY_EXECUTION_ADAPTER as bevy } from '../backends/bevy-adapter.mjs';
import { BEVY_RUST_EXECUTION_ADAPTER as bevyRust } from '../backends/bevy-rust-adapter.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { spriteAnimationFixture, sceneId, imageId, scenePath } from './helpers/scene-animation-sprite-fixture.mjs';

const spriteTrack = plan => plan.animation.document.tracks.find(track => track.property === 'spriteFrame2d');
test('sprite tracks use the existing instance image, frozen bytes and track source map without extra resources', async t => {
  const f = await spriteAnimationFixture(t), before = await readWorldSnapshot(f.root), captured = await captureBuildSnapshot(f.root, sceneId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.equal(captured.resources.size, 1); assert.equal(captured.plan.resources.length, 1);
  assert.deepEqual(captured.plan.requiredCapabilities.slice(-2), ['animation.visual2d', 'animation.sprite2d']);
  assert.equal(validateSceneAnimationPlan(captured.plan).document.schemaVersion, 2);
  assert.equal(captured.plan.actors[0].imageResourceId, imageId); assert.equal(captured.plan.actors[1].imageResourceId, imageId);
  const preview = await captureScenePreviewSnapshot(f.root, sceneId);
  assert.deepEqual(preview.plan, stripSceneAnimationPlan(captured.plan));
  assert.deepEqual(preview.resources, captured.resources);
  assert.deepEqual(await readWorldSnapshot(f.root), before);
  const declaration = captured.plan.animation.locations.tracks[4].declaration;
  assert.equal(declaration.propertyPath, '/tracks/4'); assert.equal(declaration.sourceRange.exact, true);
});

test('missing actor image is diagnosed at the frame track; shared definitions do not supply another instance image', async t => {
  const f = await spriteAnimationFixture(t);
  await f.edit(scenePath, scene => { delete scene.actors[0].imageResourceId; });
  const observed = await readWorldSnapshot(f.root), planned = createScene2DPlan(observed, sceneId);
  assert.equal(planned.ok, false); assert.equal(planned.plan, null);
  assert.deepEqual(planned.diagnostics.map(item => [item.code, item.propertyPath]), [['build_animation_invalid', '/tracks/4/instanceId']]);
});

test('frozen frame plans reject missing, duplicate, audio, unverified and unlisted resources and removed capability', async t => {
  const f = await spriteAnimationFixture(t), captured = await captureBuildSnapshot(f.root, sceneId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  for (const change of [
    p => { p.resources = []; }, p => { p.resources.push({ ...p.resources[0] }); },
    p => { delete p.actors[0].imageResourceId; }, p => { p.actors[0].imageResourceId = sceneId; },
    p => { p.resources[0].kind = 'audio'; }, p => { p.resources[0].extension = 'wav'; },
    p => { p.resources[0].sha256 = ''; }, p => { p.resources[0].size = 0; },
    p => { p.requiredCapabilities = p.requiredCapabilities.filter(cap => cap !== 'animation.sprite2d'); },
  ]) {
    const p = structuredClone(captured.plan); change(p);
    assert.throws(() => validateSceneAnimationPlan(p), { errorCode: 'build_animation_invalid' });
    await assert.rejects(godot.generate(p));
  }
});

test('sprite capability cannot be hidden from Godot admission or unsupported Bevy adapters', async t => {
  const f = await spriteAnimationFixture(t), captured = await captureBuildSnapshot(f.root, sceneId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  for (const backend of [bevy, bevyRust]) {
    assert.ok(checkExecutionBackendSupport(backend.descriptor, { operation: 'build', plan: captured.plan }).some(item => item.capability === 'animation.sprite2d'));
    await assert.rejects(backend.generate(captured.plan));
  }
  const p = structuredClone(captured.plan); p.requiredCapabilities = p.requiredCapabilities.filter(cap => cap !== 'animation.sprite2d');
  assert.ok(checkExecutionBackendSupport(godot.descriptor, { operation: 'build', plan: p }).some(item => item.code === 'build_animation_invalid' && item.capability === 'animation.sprite2d'));
  assert.ok(checkExecutionBackendSupport(bevy.descriptor, { operation: 'build', plan: p }).some(item => item.code === 'build_capability_missing' && item.capability === 'animation.sprite2d'));
  assert.deepEqual(spriteTrack(captured.plan).grid, { columns: 2, rows: 2 });
});
