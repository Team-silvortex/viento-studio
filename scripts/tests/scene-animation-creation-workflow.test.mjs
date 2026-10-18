// First creation through the shared command -> saved target picker -> frozen
// executable plan. All author writes and generated probes stay in temp roots.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { createSceneAnimationCreationDraft } from '../../engine/scene-animation-create-plan.mjs';
import { captureSceneAnimationCreationContext, createSceneAnimationCreationRequest, validateSceneAnimationCreationResult, confirmSceneAnimationCreation } from '../../engine/scene-animation-creation-contract.mjs';
import { captureSceneAnimationTargets, validateSceneAnimationTargets } from '../../engine/scene-animation-targets.mjs';
import { sampleSceneAnimation } from '../../engine/scene-animation-core.mjs';
import { createSceneAnimationCreationService } from '../lib/scene-animation-creation-service.mjs';
import { createSceneAnimationTargetsService } from '../lib/scene-animation-targets-service.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const revision = value => 'sha256:' + hash(value);
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const id = n => `61616161-6161-4616-8616-${String(n).padStart(12, '0')}`;
const json = value => JSON.stringify(value, null, 2) + '\n';
async function fixture(t, property, endValue, schemaVersion = 2) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-animation-creation-workflow-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(new URL('../../examples/scene-animation/', import.meta.url), root, { recursive: true });
  await fs.rm(path.join(root, 'documents/animations/demo.json'));
  await fs.rm(path.join(root, 'metadata/documents/88888888-8888-4888-8888-888888888887.json'));
  const sceneRecordPath = path.join(root, `metadata/documents/${sceneId}.json`), record = JSON.parse(await fs.readFile(sceneRecordPath));
  record.relations = record.relations.filter(row => row.kind !== 'animation'); await fs.writeFile(sceneRecordPath, '\ufeff' + json(record).replaceAll('\n', '\r\n'));
  const sceneFile = path.join(root, 'documents/scenes/demo.json'), scene = JSON.parse(await fs.readFile(sceneFile));
  scene.schemaVersion = schemaVersion; if (schemaVersion === 3) scene.groups = [];
  await fs.writeFile(sceneFile, json(scene)); const beforeScene = await fs.readFile(sceneFile);
  const directory = createSceneAnimationCreationService(root), context = captureSceneAnimationCreationContext(await directory.inspect({ sceneObjectId: sceneId }), sceneId);
  assert.equal(context.status, 'empty'); assert.equal(context.targets.length, 2); assert.equal(context.targets[0].objectId, context.targets[1].objectId);
  const planned = createSceneAnimationCreationDraft({ sceneObjectId: sceneId, trackId: id(2), instanceId: context.targets[1].instanceId, property, durationSeconds: 1, loop: false, endValue });
  assert.equal(planned.ok, true, JSON.stringify(planned.diagnostics));
  const request = createSceneAnimationCreationRequest(context, { objectId: id(1), documentType: 'animation', sourcePath: 'documents/animations/created.json', content: planned.content });
  const execute = createWorldCommandService(root), preview = await execute(request);
  validateSceneAnimationCreationResult(preview, request, context, revision(planned.content));
  await assert.rejects(fs.stat(path.join(root, request.sourcePath)), { code: 'ENOENT' });
  const applying = { ...request, mode: 'apply' }, applied = await execute(applying);
  validateSceneAnimationCreationResult(applied, applying, context, revision(planned.content));
  assert.equal(applied.revision, preview.revision); assert.deepEqual(await fs.readFile(sceneFile), beforeScene);
  assert.ok((await fs.readFile(sceneRecordPath, 'utf8')).startsWith('\ufeff'));
  const ready = captureSceneAnimationCreationContext(await directory.inspect({ sceneObjectId: sceneId }), sceneId);
  assert.equal(confirmSceneAnimationCreation(ready, applying, revision(planned.content)), true);
  const source = { sourcePath: request.sourcePath, token: 'first-created', content: planned.content, baseSourceRevision: revision(planned.content), sourceRevision: revision(planned.content) };
  const targets = captureSceneAnimationTargets(source, await createSceneAnimationTargetsService(root).inspect({ sceneObjectId: sceneId }));
  validateSceneAnimationTargets(targets, JSON.parse(planned.content));
  const frozen = await captureBuildSnapshot(root, sceneId); assert.equal(frozen.ok, true, JSON.stringify(frozen.diagnostics));
  assert.deepEqual(frozen.plan.animation.document, JSON.parse(planned.content)); assert.equal(frozen.plan.animation.manifest.objectId, id(1));
  assert.equal(frozen.plan.animation.locations.tracks[0].declaration.sourcePath, request.sourcePath);
  assert.equal(frozen.plan.animation.locations.tracks[0].declaration.sourceRevision, revision(planned.content));
  assert.ok(frozen.plan.requiredCapabilities.includes('animation.visual2d'));
  return { root, plan: frozen.plan, source, directory, applied, context };
}
for (const [property, endValue, schema] of [['offset2d', [40, -20], 2], ['rotation2d', 360, 3], ['scale2d', [2, .5], 2], ['opacity', .2, 3]]) {
  test(`first-created ${property} animation feeds target selection and saved Scene2D v${schema} build provenance`, async t => {
    const f = await fixture(t, property, endValue, schema), generated = await adapter.generate(f.plan);
    assert.ok(generated.files.has('animation.json')); assert.match(generated.files.get('main.tscn').toString(), /animation-runtime\.gd/);
    assert.equal(f.plan.animation.document.tracks.length, 1); assert.equal(f.plan.animation.document.tracks[0].keyframes.length, 2);
    const end = sampleSceneAnimation(f.plan.animation.document, 1); assert.equal(end.finished, true); assert.deepEqual(end.values[0].value, endValue);
    assert.equal(generated.resourceFiles.size, 0);
  });
}
test('real Godot executes a first-created registered animation on the chosen duplicate-definition instance', {
  skip: !process.env.VIENTO_GODOT_BIN ? 'Set VIENTO_GODOT_BIN for the actual first-creation to engine path' : false,
}, async t => {
  const f = await fixture(t, 'offset2d', [40, -20]), generated = await adapter.generate(f.plan);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-animation-created-godot-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const [file, content] of generated.files) { await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true }); await fs.writeFile(path.join(directory, file), content); }
  const tool = await adapter.identify(process.env.VIENTO_GODOT_BIN);
  for (const phase of adapter.buildPhases) {
    const result = await adapter.executePhase({ phase, directory, tool, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, f.plan), []);
  }
  const target = f.plan.animation.document.tracks[0].instanceId;
  await fs.writeFile(path.join(directory, 'created-animation-observer.gd'), `extends "res://animation-runtime.gd"\nfunc _process(delta: float) -> void:\n\tsuper._process(delta)\n\tvar visual: Node2D = animation_visuals["${target}"]\n\tprint("CREATED_ANIMATION:" + JSON.stringify({"time": animation_time, "position": [visual.position.x, visual.position.y]}))\n`);
  await fs.writeFile(path.join(directory, 'main.tscn'), generated.files.get('main.tscn').toString().replace('res://animation-runtime.gd', 'res://created-animation-observer.gd'));
  const result = await adapter.executePhase({ phase: 'run', directory, tool });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, f.plan), []);
  const frames = result.stdout.split('\n').filter(line => line.startsWith('CREATED_ANIMATION:')).map(line => JSON.parse(line.slice('CREATED_ANIMATION:'.length)));
  assert.equal(frames.length, 2);
  for (const frame of frames) assert.deepEqual(frame.position, sampleSceneAnimation(f.plan.animation.document, frame.time).values[0].value);
  assert.deepEqual(frames.map(frame => frame.position), [[10, -5], [20, -10]]);
  assert.equal(await fs.readFile(path.join(f.root, f.source.sourcePath), 'utf8'), f.source.content);
});
