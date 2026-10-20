import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yauzl from 'yauzl';
import '../adapters/node-studio-core.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotAnimationProject as generateLegacy } from '../backends/godot4-animation.mjs';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
import { sampleSceneAnimation } from '../../engine/scene-animation-core.mjs';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan-contract.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
import { spriteAnimationFixture, sceneId, imageId, animationPath, spriteSheet } from './helpers/scene-animation-sprite-fixture.mjs';
import { projectSceneSwitchingAuthor } from './helpers/project-scene-switching-fixture.mjs';
import { fingerprint } from './helpers/scene-animation-scene-preview-fixture.mjs';

const toolPath = process.env.VIENTO_GODOT_BIN, real = { skip: !toolPath ? 'Set VIENTO_GODOT_BIN for actual sprite animation execution' : false };
const id = n => `57575757-5757-4575-8575-${String(n).padStart(12, '0')}`;
const json = value => JSON.stringify(value, null, 2) + '\n';
async function materialize(t, value, resources) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-sprite-godot-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const generated = await adapter.generate(value);
  for (const [file, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([resourceId, file]) => [file, resources.get(resourceId)])]) {
    await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true }); await fs.writeFile(path.join(directory, file), bytes);
  }
  return { directory, generated };
}
async function prepare(f, value) {
  const tool = await adapter.identify(toolPath);
  for (const phase of adapter.buildPhases) {
    const result = await adapter.executePhase({ phase, directory: f.directory, tool, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, value), [], result.stdout + result.stderr);
  }
  return tool;
}
async function capture(t) {
  const f = await spriteAnimationFixture(t), captured = await captureBuildSnapshot(f.root, sceneId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics)); return { ...f, ...captured };
}

test('v1 animation retains every generated file, source map, resource and 0.12.0 fingerprint', async () => {
  const captured = await captureBuildSnapshot(new URL('../../examples/scene-animation/', import.meta.url).pathname, sceneId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = await adapter.generate(captured.plan), legacy = await generateLegacy(captured.plan);
  assert.equal(generated.backend.version, '0.12.0');
  assert.deepEqual(generated.files, legacy.files); assert.deepEqual(generated.backend, legacy.backend);
  assert.deepEqual(generated.sourceMap, legacy.sourceMap); assert.deepEqual(generated.resourceFiles, legacy.imageFiles);
  assert.equal(generated.backend.capabilities.includes('animation.sprite2d'), false);
});

test('frame capability changes only its runtime sidecar and adds no asset copies or generated paths', async t => {
  const f = await capture(t), before = structuredClone(f.plan), generated = await adapter.generate(f.plan), legacy = await generateLegacy(f.plan);
  assert.equal(generated.backend.version, '0.13.0'); assert.ok(generated.backend.capabilities.includes('animation.sprite2d'));
  assert.deepEqual([...generated.files.keys()], [...legacy.files.keys()]);
  for (const [file, bytes] of legacy.files) if (file !== 'animation-runtime.gd') assert.deepEqual(generated.files.get(file), bytes, file);
  assert.deepEqual(generated.resourceFiles, legacy.imageFiles); assert.equal(generated.resourceFiles.size, 1);
  assert.match(generated.files.get('animation-runtime.gd').toString(), /sprite\.hframes = columns/);
  const document = JSON.parse(generated.files.get('animation.json'));
  assert.deepEqual(document.tracks.at(-1).grid, { columns: 2, rows: 2 }); assert.equal(document.schemaVersion, 2);
  assert.deepEqual(f.plan, before);
});

test('real Godot frame stepping, grid coordinates and fixed visual dimensions match Rust independently per instance', real, async t => {
  const source = await capture(t), f = await materialize(t, source.plan, source.resources), tool = await prepare(f, source.plan);
  const times = [0, .49999999999999994, .5, 1, 1.5, 2, 2.5];
  const timeBytes = times.map(time => { const b = Buffer.alloc(8); b.writeDoubleLE(time); return [...b]; });
  await fs.writeFile(path.join(f.directory, 'sprite-probe.gd'), `extends "res://animation-runtime.gd"\nfunc run_smoke() -> void:\n\tfor time_bytes in ${JSON.stringify(timeBytes)}:\n\t\tvar seconds: float = PackedByteArray(time_bytes).decode_double(0)\n\t\tanimation_time = fmod(seconds, animation_duration) if animation_loop else minf(seconds, animation_duration)\n\t\tanimation_apply()\n\t\tvar result := []\n\t\tfor actor in actors:\n\t\t\tvar sprite: Sprite2D = animation_sprites[actor["instanceId"]]\n\t\t\tvar extent: Vector2 = sprite.get_rect().size * sprite.scale\n\t\t\tvar visual: Node2D = animation_visuals[actor["instanceId"]]\n\t\t\tresult.append({"instanceId": actor["instanceId"], "frame": sprite.frame, "coords": [sprite.frame_coords.x, sprite.frame_coords.y], "extent": [extent.x, extent.y], "grid": [sprite.hframes, sprite.vframes], "offset": [visual.position.x, visual.position.y], "rotation": visual.rotation_degrees, "scale": [visual.scale.x, visual.scale.y], "opacity": visual.modulate.a, "visualChildren": visual.get_child_count(), "labelParentIsActor": actor["node"].get_child(1).get_parent() == actor["node"]})\n\t\tprint("SPRITE_SAMPLE:" + JSON.stringify(result, "", true, true))\n\tanimation_shutdown()\n\tvar before: float = animation_time\n\tanimation_advance(.25)\n\tif animation_time != before:\n\t\tget_tree().quit(1)\n\t\treturn\n\tget_tree().quit()\n`);
  await fs.writeFile(path.join(f.directory, 'main.tscn'), f.generated.files.get('main.tscn').toString().replace('res://animation-runtime.gd', 'res://sprite-probe.gd'));
  const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, source.plan), [], result.stdout + result.stderr);
  const samples = result.stdout.split('\n').filter(line => line.startsWith('SPRITE_SAMPLE:')).map(line => JSON.parse(line.slice('SPRITE_SAMPLE:'.length)));
  assert.equal(samples.length, times.length);
  for (const [index, seconds] of times.entries()) {
    const expected = sampleSceneAnimation(source.plan.animation.document, seconds).values;
    for (const [at, actual] of samples[index].entries()) {
      const tracks = expected.filter(track => track.instanceId === actual.instanceId), frame = tracks.find(track => track.property === 'spriteFrame2d').value;
      assert.equal(actual.frame, frame); assert.deepEqual(actual.coords, [frame % 2, Math.floor(frame / 2)]);
      assert.deepEqual(actual.extent, source.plan.actors[at].size); assert.deepEqual(actual.grid, [2, 2]);
      assert.equal(actual.visualChildren, 1); assert.equal(actual.labelParentIsActor, true);
      for (const [property, key] of [['offset2d', 'offset'], ['scale2d', 'scale'], ['rotation2d', 'rotation'], ['opacity', 'opacity']]) {
        const sample = tracks.find(track => track.property === property); if (!sample) continue;
        const a = [].concat(actual[key]), b = [].concat(sample.value); assert.equal(a.length, b.length);
        a.forEach((value, n) => assert.ok(Math.abs(value - b[n]) < 0.0001, `${seconds}: ${key}`));
      }
    }
  }
});

async function assembly(t) {
  const f = await projectSceneSwitchingAuthor(t), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const value = structuredClone(captured.plan);
  for (const [index, scene] of value.scenes.entries()) {
    const document = { format: 'viento-scene-animation', schemaVersion: 2, sceneObjectId: scene.scene.objectId, durationSeconds: 2, loop: true,
      tracks: [{ id: id(20 + index), instanceId: scene.actors[0].instanceId, property: 'spriteFrame2d', interpolation: 'step', grid: { columns: 2, rows: 2 }, keyframes: [{ atSeconds: 0, value: 1 }, { atSeconds: .25, value: 3 }] }] };
    const manifest = { objectId: id(index), sourcePath: `documents/animations/sprite-${index}.json`, sourceRevision: `sha256:${buildHash(json(document))}` };
    scene.animation = { format: 'viento-animation-plan', schemaVersion: 1, manifest, document,
      locations: { tracks: [{ id: document.tracks[0].id, declaration: { ...manifest, propertyPath: '/tracks/0' } }] } };
    scene.requiredCapabilities.push('animation.visual2d', 'animation.sprite2d');
  }
  value.requiredCapabilities = [...new Set(['project.scenes', ...value.scenes.flatMap(scene => scene.requiredCapabilities)])].sort();
  return { ...f, captured, value };
}

test('assembly admission preserves frame capability across members and cannot drop it at the root', async t => {
  const f = await assembly(t); validateProjectAssemblyPlan(f.value);
  f.value.requiredCapabilities = f.value.requiredCapabilities.filter(capability => capability !== 'animation.sprite2d');
  assert.throws(() => validateProjectAssemblyPlan(f.value));
  assert.ok(checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', plan: f.value }).some(item => item.code === 'build_assembly_invalid' && item.capability === 'animation.sprite2d'));
  await assert.rejects(adapter.generate(f.value));
});

test('real Godot scene A to B to A reentry resets frame and composes behavior and audio', real, async t => {
  const source = await assembly(t), f = await materialize(t, source.value, source.captured.resources), tool = await prepare(f, source.value);
  assert.equal(f.generated.backend.version, '0.14.0');
  for (const child of source.value.scenes) {
    const file = path.join(f.directory, `scenes/${child.scene.objectId}/project-scene.gd`), content = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, content.replace('set_process(false)', `set_process(false)\n\tprint("SPRITE_VISIT:" + JSON.stringify([animation_time, animation_sprites["${child.actors[0].instanceId}"].frame]))`));
  }
  const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, source.value), [], result.stdout + result.stderr);
  const reader = adapter.createEventReader(source.value); reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, [], result.stdout + result.stderr);
  assert.deepEqual(reader.events.filter(event => event.event === 'scene-enter').map(event => event.sceneId), [source.sceneIds[0], source.sceneIds[1], source.sceneIds[0]]);
  const visits = result.stdout.split('\n').filter(line => line.startsWith('SPRITE_VISIT:')).map(line => JSON.parse(line.slice('SPRITE_VISIT:'.length)));
  assert.deepEqual(visits, [[0, 1], [0, 1], [0, 1]]);
});

test('saved grid animation builds and exports its unchanged image once, then runs after the author workspace is removed', real, async t => {
  const f = await spriteAnimationFixture(t), original = await fingerprint(f.root, { authorOnly: true });
  const built = await buildProject({ root: f.root, scene: sceneId, tool: toolPath, output: path.join(f.directory, 'build') });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built.diagnostics));
  const ran = await runProjectBuild({ buildDirectory: built.buildDirectory, tool: toolPath, headless: true, smoke: true });
  assert.equal(ran.ok, true, JSON.stringify(ran.record?.diagnostics));
  const inspect = () => inspectBackendProject({ buildDirectory: built.buildDirectory });
  const inspection = await inspect(), delivery = await planBackendProjectDelivery({ inspection, assertCurrent: inspect });
  const zipFile = path.join(f.directory, 'sprite-project.zip'); await writeExportZip(delivery, zipFile);
  assert.ok((await verifyBackendProjectDelivery(zipFile)).fileCount > 0);
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), original);
  const moved = path.join(f.directory, 'relocated'), archive = await yauzl.openPromise(zipFile, { lazyEntries: true, autoClose: false });
  const files = new Map();
  try {
    for await (const entry of archive.eachEntry()) {
      const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
      const bytes = Buffer.concat(chunks), file = path.join(moved, entry.fileName);
      await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes); files.set(entry.fileName, bytes);
    }
  } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  assert.deepEqual([...files.keys()].filter(name => name.endsWith(`/${imageId}.svg`)), [`project/images/${imageId}.svg`]);
  assert.equal(files.get(`project/images/${imageId}.svg`).toString(), spriteSheet);
  assert.equal(JSON.parse(files.get('project/animation.json')).tracks.at(-1).property, 'spriteFrame2d');
  const snapshot = JSON.parse(await fs.readFile(path.join(built.buildDirectory, 'snapshot.json')));
  await fs.rm(f.root, { recursive: true }); await fs.rm(built.buildDirectory, { recursive: true });
  const tool = await adapter.identify(toolPath), directory = path.join(moved, 'project');
  for (const phase of [...adapter.buildPhases, 'run']) {
    const result = await adapter.executePhase({ phase, directory, tool, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, snapshot.plan), [], result.stdout + result.stderr);
  }
});
