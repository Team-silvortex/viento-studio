import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { captureBuildSnapshot, captureScenePreviewSnapshot } from '../adapters/node-build-snapshot.mjs';
import { createScene2DPlan } from '../../engine/build-plan.mjs';
import { validateSceneAnimationPlan, stripSceneAnimationPlan, SCENE_ANIMATION_MAX_BYTES } from '../../engine/scene-animation.mjs';
import { sampleSceneAnimation } from '../../engine/scene-animation-core.mjs';
const root = new URL('../../examples/scene-animation/', import.meta.url).pathname;
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', animationId = '88888888-8888-4888-8888-888888888887';
const fixture = await readWorldSnapshot(root), captured = await captureBuildSnapshot(root, sceneId);
const raw = observed => observed.source.documents.find(item => item.record?.id === animationId);
const scene = observed => observed.source.documents.find(item => item.record?.id === sceneId);
const plan = observed => createScene2DPlan(observed, sceneId);

test('saved animation opts into an independent visual capability and exact track provenance', () => {
  assert.equal(captured.ok, true); assert.equal(captured.plan.schemaVersion, 2);
  assert.equal(captured.resources.size, 0); assert.equal(captured.plan.requiredCapabilities.at(-1), 'animation.visual2d');
  const animation = validateSceneAnimationPlan(captured.plan); assert.equal(animation.document.tracks.length, 4);
  assert.ok(animation.locations.tracks.every((item, index) => item.declaration.sourceRange.exact && item.declaration.propertyPath === `/tracks/${index}`));
  assert.equal(animation.manifest.objectId, animationId);
  assert.deepEqual(sampleSceneAnimation(animation.document, .5).values[0].value, [60, -30]);
  assert.deepEqual(captured.plan.actors[0].position, [200, 220]);
});

test('unlinked declarations and static previews keep the existing scene model and plans unchanged', async () => {
  const observed = structuredClone(fixture); scene(observed).record.relations = scene(observed).record.relations.filter(item => item.kind !== 'animation');
  const expected = stripSceneAnimationPlan(captured.plan);
  assert.deepEqual(plan(observed).plan, expected);
  const preview = await captureScenePreviewSnapshot(root, sceneId);
  assert.equal(preview.ok, true); assert.deepEqual(preview.plan, expected);
  assert.equal(captured.plan.animation.document.loop, true, 'stripping never mutates the original plan');
});

test('missing malformed oversized duplicate and foreign animation sources fail with author locations', () => {
  const mutations = [
    observed => { raw(observed).content = null; },
    observed => { raw(observed).content = '{'; },
    observed => { raw(observed).content = ' '.repeat(SCENE_ANIMATION_MAX_BYTES) + raw(observed).content; },
    observed => { raw(observed).content = raw(observed).content.replace('"loop": true', '"loop": true, "lo\\u006fp": false'); },
    observed => { raw(observed).content = raw(observed).content.replace(sceneId, animationId); },
    observed => { raw(observed).record.relations = []; },
    observed => { raw(observed).sourcePath = '../foreign.json'; },
    observed => { raw(observed).sourceRevision = 'invalid'; },
    observed => { scene(observed).record.relations.push({ kind: 'animation', targetId: animationId }); },
    observed => { scene(observed).record.relations.find(item => item.kind === 'animation').targetId = '00000000-0000-4000-8000-000000000000'; },
  ];
  for (const mutate of mutations) {
    const observed = structuredClone(fixture); mutate(observed); const result = plan(observed);
    assert.equal(result.ok, false); assert.equal(result.plan, null); assert.ok(result.diagnostics.length);
    assert.ok(result.diagnostics.every(item => item.code === 'build_animation_invalid' && [sceneId, animationId].includes(item.objectId)));
  }
});

test('animation targets stable instances rather than shared actor definitions or list positions', () => {
  const observed = structuredClone(fixture), source = raw(observed), document = JSON.parse(source.content);
  document.tracks[0].instanceId = captured.plan.actors[0].objectId; source.content = JSON.stringify(document);
  const invalid = plan(observed); assert.equal(invalid.ok, false);
  assert.equal(invalid.diagnostics[0].propertyPath, '/tracks/0/instanceId'); assert.equal(invalid.diagnostics[0].sourceRange.exact, true);
  document.tracks[0].instanceId = captured.plan.actors[0].instanceId; source.content = JSON.stringify(document);
  const declared = JSON.parse(scene(observed).content); declared.actors.reverse(); scene(observed).content = JSON.stringify(declared);
  assert.equal(plan(observed).ok, true); assert.equal(plan(observed).plan.animation.document.tracks[0].instanceId, document.tracks[0].instanceId);
});

test('BOM and CRLF retain original source coordinates without changing samples', () => {
  const observed = structuredClone(fixture); raw(observed).content = '\ufeff' + raw(observed).content.replaceAll('\n', '\r\n');
  const result = plan(observed); assert.equal(result.ok, true);
  assert.deepEqual(result.plan.animation.document, captured.plan.animation.document);
  const range = result.plan.animation.locations.tracks[0].declaration.sourceRange;
  assert.equal(range.exact, true); assert.equal(range.encoding, 'utf-16');
});

test('frozen plan rejects capability removal invalid targets and reordered or foreign source maps', () => {
  const changes = [
    p => { p.requiredCapabilities = p.requiredCapabilities.filter(item => item !== 'animation.visual2d'); },
    p => { p.schemaVersion = 1; },
    p => { p.animation.manifest.sourcePath = '../foreign.json'; },
    p => { p.animation.manifest.objectId = sceneId; },
    p => { p.animation.document.sceneObjectId = animationId; },
    p => { p.animation.document.tracks[0].instanceId = animationId; },
    p => { p.actors[1].instanceId = p.actors[0].instanceId; },
    p => { p.animation.locations.tracks.reverse(); },
    p => { p.animation.locations.tracks[0].declaration.sourceRevision = 'sha256:' + '0'.repeat(64); },
    p => { p.animation.locations.tracks[0].declaration.propertyPath = '/tracks/1'; },
    p => { p.animation.extra = true; },
  ];
  for (const change of changes) {
    const copy = structuredClone(captured.plan); change(copy);
    assert.throws(() => validateSceneAnimationPlan(copy), { errorCode: 'build_animation_invalid' });
  }
});
