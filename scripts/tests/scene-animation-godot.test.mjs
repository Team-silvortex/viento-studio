import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { BEVY_EXECUTION_ADAPTER as bevy } from '../backends/bevy-adapter.mjs';
import { BEVY_RUST_EXECUTION_ADAPTER as bevyRust } from '../backends/bevy-rust-adapter.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { validateSceneControlPlan } from '../../engine/scene-control-program.mjs';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan-contract.mjs';
import { stripSceneAnimationPlan } from '../../engine/scene-animation.mjs';
import { sampleSceneAnimation } from '../../engine/scene-animation-core.mjs';
import { godotAssemblyScripts } from '../backends/godot4-project.mjs';
import { projectSceneSwitchingAuthor } from './helpers/project-scene-switching-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
import yauzl from 'yauzl';

const hash = value => createHash('sha256').update(value).digest('hex');
const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v2.json', import.meta.url)));
const id = n => `56565656-5656-4565-8565-${String(n).padStart(12, '0')}`;
const json = value => JSON.stringify(value, null, 2) + '\n';
const toolPath = process.env.VIENTO_GODOT_BIN, real = { skip: !toolPath ? 'Set VIENTO_GODOT_BIN for real animation execution' : false };
const program = { format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.25, steps: [{ left: false, right: false, up: false, down: false }] };
const wave = Buffer.alloc(60);
wave.write('RIFF'); wave.writeUInt32LE(52, 4); wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16);
wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28);
wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(16, 40);
function withAnimation(base, { loop = true, durationSeconds = .5 } = {}) {
  const value = structuredClone(base), instanceId = value.actors[0].instanceId;
  const document = { format: 'viento-scene-animation', schemaVersion: 1, sceneObjectId: value.scene.objectId, durationSeconds, loop,
    tracks: [['offset2d', 'linear', [0, 0], [40, -20]], ['rotation2d', 'linear', -360, 720],
      ['scale2d', 'linear', [1, 1], [2, .5]], ['opacity', 'step', 1, .2]].map(([property, interpolation, start, end], index) => ({
      id: id(index + 2), instanceId, property, interpolation,
      keyframes: [{ atSeconds: 0, value: start }, { atSeconds: durationSeconds, value: end }],
    })) };
  document.tracks[3].keyframes.splice(1, 0, { atSeconds: durationSeconds / 2, value: .6 });
  if (value.actors[1]) document.tracks.push({ id: id(7), instanceId: value.actors[1].instanceId, property: 'offset2d', interpolation: 'step', keyframes: [{ atSeconds: 0, value: [11, 3] }] });
  const manifest = { objectId: id(1), sourcePath: 'documents/animation.json', sourceRevision: `sha256:${hash(json(document))}` };
  value.animation = { format: 'viento-animation-plan', schemaVersion: 1, manifest, document,
    locations: { tracks: document.tracks.map((track, index) => ({ id: track.id, declaration: { ...manifest, propertyPath: `/tracks/${index}` } })) } };
  value.requiredCapabilities = [...new Set([...value.requiredCapabilities, 'animation.visual2d'])]; return value;
}
function plan({ behavior = false, audio = false, ...animation } = {}) {
  const value = structuredClone(golden.plan); value.resources = []; value.actors.forEach(actor => { delete actor.imageResourceId; });
  value.requiredCapabilities = ['scene2d', 'input.arrows', 'state.movement'];
  if (behavior) {
    value.schemaVersion = 3; value.requiredCapabilities.push('behavior.bindings', 'behavior.gdscript');
    const content = 'extends Node\nfunc _ready() -> void:\n\tprint("ANIMATION_BEHAVIOR_PARENT:" + str(get_parent().has_meta("viento_instance_id")))\n';
    const manifest = { objectId: id(10), sourcePath: 'documents/behaviors.json', sourceRevision: `sha256:${hash('{}')}` };
    value.behaviors = { format: 'viento-behavior-plan', schemaVersion: 1, backendId: 'org.viento.godot4', language: 'gdscript', manifest,
      sources: [{ objectId: id(11), sourcePath: 'documents/ready.txt', sourceRevision: `sha256:${hash(content)}`, language: 'gdscript', content }],
      bindings: [{ bindingId: id(12), instanceId: value.actors[0].instanceId, objectId: value.actors[0].objectId,
        implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: id(11) }, parameters: {}, events: [],
        declaration: { ...manifest, propertyPath: '/bindings/0' } }] };
  }
  if (audio) {
    value.resources = [{ id: id(20), sha256: hash(wave), size: wave.length, extension: 'wav', kind: 'audio' }];
    value.requiredCapabilities.push('audio.nonspatial', 'audio.timeline');
    const document = { format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: value.scene.objectId,
      tracks: [{ id: id(21), resourceId: id(20), role: 'effect', volume: .5, loop: false }],
      cues: [{ id: id(22), trackId: id(21), atSeconds: .25, action: 'play' }] };
    const manifest = { objectId: id(23), sourcePath: 'documents/audio.json', sourceRevision: `sha256:${hash(json(document))}` };
    value.audio = { format: 'viento-audio-plan', schemaVersion: 1, manifest, document,
      locations: { tracks: [{ id: id(21), declaration: { ...manifest, propertyPath: '/tracks/0' } }],
        cues: [{ id: id(22), declaration: { ...manifest, propertyPath: '/cues/0' } }] } };
  }
  return withAnimation(value, animation);
}
async function materialize(t, value, resourceBytes = new Map([[id(20), wave]])) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-animation-godot-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const generated = await adapter.generate(value);
  for (const [file, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([resourceId, file]) => [file, resourceBytes.get(resourceId)])]) {
    await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true }); await fs.writeFile(path.join(directory, file), bytes);
  }
  return { directory, generated };
}
async function prepare(f, value) {
  const tool = await adapter.identify(toolPath);
  for (const phase of adapter.buildPhases) {
    const result = await adapter.executePhase({ phase, directory: f.directory, tool, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
    assert.deepEqual(adapter.diagnostics(result, value), [], result.stdout + result.stderr);
  }
  return tool;
}

test('animation sidecar composes with all scene, behavior and audio bases while preserving frozen base files', async () => {
  for (const behavior of [false, true]) for (const audio of [false, true]) {
    const value = plan({ behavior, audio }), before = structuredClone(value), generated = await adapter.generate(value);
    const legacy = await adapter.generate(stripSceneAnimationPlan(value));
    for (const [file, bytes] of legacy.files) if (file !== 'main.tscn') assert.deepEqual(generated.files.get(file), bytes, file);
    assert.deepEqual(generated.resourceFiles, legacy.resourceFiles);
    assert.deepEqual(generated.sourceMap.objects, legacy.sourceMap.objects);
    assert.match(generated.files.get('main.tscn').toString(), /res:\/\/animation-runtime.gd/);
    assert.ok(generated.files.get('animation-runtime.gd').toString().startsWith(`extends "res://${audio ? 'audio-runtime' : behavior ? 'behavior-runtime' : 'runtime'}.gd"`));
    assert.equal(generated.backend.protocolVersion, value.schemaVersion);
    assert.deepEqual(generated.sourceMap.animation.tracks[0].declaration, value.animation.locations.tracks[0].declaration);
    const document = JSON.parse(generated.files.get('animation.json'));
    assert.equal(Buffer.from(document.durationSecondsBytes).readDoubleLE(), value.animation.document.durationSeconds);
    for (const track of document.tracks) for (const key of track.keyframes) assert.equal(Buffer.from(key.atSecondsBytes).readDoubleLE(), key.atSeconds);
    assert.deepEqual(value, before);
  }
});

test('unsupported backends cannot lose animation by deleting its required capability and ordinary plans stay admitted', async () => {
  for (const backend of [bevy, bevyRust]) {
    const value = plan();
    assert.ok(checkExecutionBackendSupport(backend.descriptor, { operation: 'build', plan: value }).some(item => item.capability === 'animation.visual2d'));
    value.requiredCapabilities = value.requiredCapabilities.filter(item => item !== 'animation.visual2d');
    assert.ok(checkExecutionBackendSupport(backend.descriptor, { operation: 'build', plan: value }).some(item => item.code === 'build_capability_missing' && item.capability === 'animation.visual2d'));
    await assert.rejects(backend.generate(value));
  }
  const plain = stripSceneAnimationPlan(plan());
  assert.deepEqual(checkExecutionBackendSupport(bevy.descriptor, { operation: 'build', plan: plain }), []);
  await bevy.generate(plain);
});

test('animation validates provenance, instance membership, budgets and capability before project generation', async () => {
  for (const change of [p => p.animation.document.sceneObjectId = id(99), p => p.animation.document.tracks[0].instanceId = id(99),
    p => p.animation.document.tracks[0].keyframes[1].atSeconds = 0, p => p.animation.document.tracks[1].property = 'position',
    p => p.animation.locations.tracks[0].declaration.sourcePath = '/etc/passwd', p => p.requiredCapabilities.pop()]) {
    const value = plan(); change(value); await assert.rejects(adapter.generate(value));
  }
});

test('control replay refuses animation in pure admission and adapter execution before launching a process', async t => {
  const value = plan(); assert.throws(() => validateSceneControlPlan(value, program), { errorCode: 'runtime_control_unsupported' });
  const f = await materialize(t, value);
  await assert.rejects(adapter.executePhase({ phase: 'run', tool: { executable: process.execPath }, directory: f.directory, controlProgram: program }), { errorCode: 'runtime_control_unsupported' });
});

for (const behavior of [false, true]) for (const audio of [false, true]) test(`real Godot visual animation preserves movement and behavior/audio execution (${behavior}, ${audio})`, real, async t => {
  const value = plan({ behavior, audio }), f = await materialize(t, value), tool = await prepare(f, value);
  // Instrument the generated sidecar solely to observe its actual clock and
  // transform at each normal smoke step. The original base smoke remains intact.
  await fs.writeFile(path.join(f.directory, 'animation-observer.gd'), `extends "res://animation-runtime.gd"\nfunc _process(delta: float) -> void:\n\tsuper._process(delta)\n\tvar visual: Node2D = animation_visuals["${value.actors[0].instanceId}"]\n\tprint("ANIMATION_SAMPLE:" + JSON.stringify({"time": animation_time, "offset": [visual.position.x, visual.position.y], "scale": [visual.scale.x, visual.scale.y], "rotation": visual.rotation_degrees, "opacity": visual.modulate.a}))\n`);
  await fs.writeFile(path.join(f.directory, 'main.tscn'), f.generated.files.get('main.tscn').toString().replace('res://animation-runtime.gd', 'res://animation-observer.gd'));
  const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(adapter.diagnostics(result, value), [], result.stdout + result.stderr);
  const reader = adapter.createEventReader(value); reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, [], result.stdout + result.stderr);
  const frames = result.stdout.split('\n').filter(line => line.startsWith('ANIMATION_SAMPLE:')).map(line => JSON.parse(line.slice('ANIMATION_SAMPLE:'.length)));
  assert.equal(frames.length, 2); assert.equal(frames[0].time, .25); assert.equal(frames[1].time, 0);
  assert.deepEqual(frames[0].offset, [20, -10]); assert.deepEqual(frames[1].offset, [0, 0]);
  assert.deepEqual(frames[0].scale, [1.5, .75]); assert.ok(Math.abs(frames[0].rotation - 180) < .001); assert.ok(Math.abs(frames[0].opacity - .6) < .00001);
  const finish = reader.events.findLast(event => event.event === 'finished' && event.actors); assert.ok(finish);
  for (const [index, actor] of value.actors.entries()) assert.deepEqual(finish.actors[index].position, [actor.position[0] + (actor.controls === 'arrows' ? actor.speed * .25 : 0), actor.position[1]]);
  if (behavior) assert.match(result.stdout, /ANIMATION_BEHAVIOR_PARENT:true/);
  if (audio) { assert.equal(reader.events.filter(event => event.event === 'audio' && event.audioEvent === 'command').length, 1); assert.equal(reader.events.findLast(event => event.event === 'audio' && event.audioEvent === 'finished').timeSeconds, .5); }
});

test('real Godot samples agree with Rust for loop boundaries, intermediate values, held endpoints and independent duplicate definitions', real, async t => {
  for (const loop of [true, false]) {
    const value = plan({ loop }), f = await materialize(t, value), tool = await prepare(f, value);
    const times = [0, .125, .24999999999999997, .25, .49999999999999994, .5, .5000000000000001, 1.125, 60];
    // Byte-encode sample times too, independently of Godot's JSON parser.
    const bytes = times.map(time => { const b = Buffer.alloc(8); b.writeDoubleLE(time); return [...b]; });
    await fs.writeFile(path.join(f.directory, 'animation-probe.gd'), `extends "res://animation-runtime.gd"\nfunc run_smoke() -> void:\n\tfor time_bytes in ${JSON.stringify(bytes)}:\n\t\tvar seconds: float = PackedByteArray(time_bytes).decode_double(0)\n\t\tanimation_time = fmod(seconds, animation_duration) if animation_loop else minf(seconds, animation_duration)\n\t\tanimation_apply()\n\t\tvar rows := []\n\t\tfor track in animation_tracks:\n\t\t\trows.append({"id": track["id"], "value": animation_value(track, animation_time)})\n\t\tprint("ANIMATION_PROBE:" + JSON.stringify(rows, "", true, true))\n\tanimation_shutdown()\n\tvar before: float = animation_time\n\tanimation_advance(.125)\n\tif animation_time != before:\n\t\tpush_error("Stopped animation advanced")\n\t\tget_tree().quit(1)\n\t\treturn\n\tget_tree().quit()\n`);
    await fs.writeFile(path.join(f.directory, 'main.tscn'), f.generated.files.get('main.tscn').toString().replace('res://animation-runtime.gd', 'res://animation-probe.gd'));
    const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, value), [], result.stdout + result.stderr);
    const frames = result.stdout.split('\n').filter(line => line.startsWith('ANIMATION_PROBE:')).map(line => JSON.parse(line.slice('ANIMATION_PROBE:'.length)));
    assert.equal(frames.length, times.length);
    for (const [index, time] of times.entries()) {
      const expected = sampleSceneAnimation(value.animation.document, time);
      assert.deepEqual(frames[index], expected.values.map(sample => ({ id: sample.trackId, value: sample.value })), `${loop}: ${time}`);
    }
  }
});

async function assembly(t) {
  const f = await projectSceneSwitchingAuthor(t), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const value = structuredClone(captured.plan); value.scenes = value.scenes.map((scene, index) => {
    const child = withAnimation(scene), animation = child.animation;
    animation.manifest = { ...animation.manifest, objectId: id(100 + index), sourcePath: `documents/animation-${index}.json` };
    animation.locations.tracks = animation.document.tracks.map((track, at) => ({ id: track.id, declaration: { ...animation.manifest, propertyPath: `/tracks/${at}` } }));
    return child;
  });
  value.requiredCapabilities = [...new Set([...value.requiredCapabilities, 'animation.visual2d'])].sort();
  return { ...f, captured, value };
}

test('project inventories and remaps animation composition including five-script behavior/audio scenes', async t => {
  const f = await assembly(t), generated = await materialize(t, f.value, f.captured.resources);
  const scripts = await godotAssemblyScripts(generated.directory);
  assert.equal(scripts.length, [...generated.generated.files.keys()].filter(name => name.endsWith('.gd')).length);
  for (const child of f.value.scenes) {
    const prefix = `scenes/${child.scene.objectId}`;
    assert.ok(scripts.includes(`${prefix}/animation-runtime.gd`));
    assert.match(generated.generated.files.get(`${prefix}/animation-runtime.gd`).toString(), new RegExp(`res://${prefix}/animation.json`));
    assert.match(generated.generated.files.get(`${prefix}/project-scene.gd`).toString(), /animation_shutdown\(\)/);
  }
  const invalid = structuredClone(f.value); invalid.scenes[0].animation.document.tracks[0].instanceId = id(99);
  assert.throws(() => validateProjectAssemblyPlan(invalid));
});

test('real project animation survives scene A to B to A and starts a fresh clock for each visit', real, async t => {
  const f = await assembly(t), generated = await materialize(t, f.value, f.captured.resources), tool = await prepare(generated, f.value);
  for (const child of f.value.scenes) {
    const file = path.join(generated.directory, `scenes/${child.scene.objectId}/project-scene.gd`), source = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, source.replace('set_process(false)', 'set_process(false)\n\tprint("ANIMATION_VISIT_READY:" + str(animation_time))').replace('animation_shutdown()', 'animation_shutdown()\n\tprint("ANIMATION_VISIT_CLOSED:" + str(animation_finished))'));
  }
  const result = await adapter.executePhase({ phase: 'run', directory: generated.directory, tool });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(adapter.diagnostics(result, f.value), [], result.stdout + result.stderr);
  const reader = adapter.createEventReader(f.value); reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, [], result.stdout + result.stderr);
  assert.deepEqual(reader.events.filter(event => event.event === 'scene-enter').map(event => event.sceneId), [f.sceneIds[0], f.sceneIds[1], f.sceneIds[0]]);
  assert.equal(result.stdout.split('\n').filter(line => line === 'ANIMATION_VISIT_READY:0.0').length, 3);
  assert.equal(result.stdout.split('\n').filter(line => line === 'ANIMATION_VISIT_CLOSED:true').length, 3);
});


test('real Godot retains IEEE-754 subnormal durations and a key just after a fixed step', real, async t => {
  for (const duration of [Number.MIN_VALUE, .5]) {
    const value = plan({ loop: false });
    value.animation.document.durationSeconds = duration;
    value.animation.document.tracks = [{ ...value.animation.document.tracks[3], interpolation: 'step',
      keyframes: [{ atSeconds: 0, value: 1 }, { atSeconds: duration === .5 ? .25000000000000006 : duration, value: .2 }] }];
    value.animation.locations.tracks = [{ id: value.animation.document.tracks[0].id, declaration: { ...value.animation.manifest, propertyPath: '/tracks/0' } }];
    const f = await materialize(t, value), tool = await prepare(f, value);
    await fs.writeFile(path.join(f.directory, 'animation-edge.gd'), `extends "res://animation-runtime.gd"\nfunc run_smoke() -> void:\n\tif animation_duration <= 0.0:\n\t\tpush_error("ANIMATION_ZERO_DURATION")\n\t\tget_tree().quit(1)\n\t\treturn\n\tprint("ANIMATION_EDGE:" + JSON.stringify([animation_value(animation_tracks[0], 0.0), animation_value(animation_tracks[0], .25), animation_value(animation_tracks[0], .5)], "", true, true))\n\tget_tree().quit()\n`);
    await fs.writeFile(path.join(f.directory, 'main.tscn'), f.generated.files.get('main.tscn').toString().replace('res://animation-runtime.gd', 'res://animation-edge.gd'));
    const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, value), [], result.stdout + result.stderr);
    const row = result.stdout.split('\n').find(line => line.startsWith('ANIMATION_EDGE:'));
    assert.deepEqual(JSON.parse(row.slice('ANIMATION_EDGE:'.length)), duration === .5 ? [1, 1, .2] : [1, .2, .2]);
  }
});

test('saved animation author project builds, runs, exports a verified ZIP and starts independently after relocation', real, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-animation-delivery-')); t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const author = path.join(temporary, 'author'), output = path.join(temporary, 'build');
  await fs.cp(new URL('../../examples/scene-animation/', import.meta.url), author, { recursive: true });
  const animationFile = path.join(author, 'documents/animations/demo.json'), original = await fs.readFile(animationFile);
  const built = await buildProject({ root: author, scene: 'documents/scenes/demo.json', tool: toolPath, output });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built.diagnostics));
  const ran = await runProjectBuild({ buildDirectory: built.buildDirectory, tool: toolPath, headless: true, smoke: true });
  assert.equal(ran.ok, true, JSON.stringify(ran.record?.diagnostics));
  const rejected = await runProjectBuild({ buildDirectory: built.buildDirectory, tool: toolPath, headless: true, smoke: true, controlProgram: program });
  assert.equal(rejected.ok, false); assert.ok((rejected.record?.diagnostics || rejected.diagnostics).some(item => item.code === 'runtime_control_unsupported'));
  const inspect = () => inspectBackendProject({ buildDirectory: built.buildDirectory });
  const inspection = await inspect(), delivery = await planBackendProjectDelivery({ inspection, assertCurrent: inspect });
  const zipFile = path.join(temporary, 'animation-project.zip'); await writeExportZip(delivery, zipFile);
  assert.ok((await verifyBackendProjectDelivery(zipFile)).fileCount > 0);
  assert.deepEqual(await fs.readFile(animationFile), original);
  const moved = path.join(temporary, 'relocated'), archive = await yauzl.openPromise(zipFile, { lazyEntries: true, autoClose: false });
  const inventory = [];
  try {
    for await (const entry of archive.eachEntry()) {
      const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
      const file = path.join(moved, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks)); inventory.push(entry.fileName);
    }
  } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  assert.ok(inventory.includes('project/animation-runtime.gd')); assert.ok(inventory.includes('project/animation.json'));
  assert.equal(inventory.some(name => name.includes('.godot/') || name.endsWith('snapshot.json') || name.startsWith('sessions/')), false);
  const snapshot = JSON.parse(await fs.readFile(path.join(built.buildDirectory, 'snapshot.json')));
  await fs.rm(author, { recursive: true }); await fs.rm(built.buildDirectory, { recursive: true });
  const tool = await adapter.identify(toolPath), directory = path.join(moved, 'project');
  for (const phase of [...adapter.buildPhases, 'run']) {
    const result = await adapter.executePhase({ phase, directory, tool, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, snapshot.plan), [], result.stdout + result.stderr);
    if (phase === 'run') { const reader = adapter.createEventReader(snapshot.plan); reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, []); assert.ok(reader.events.some(event => event.event === 'finished')); }
  }
});


test('an animation parse error in a multi-scene project names only its owning saved manifest', async t => {
  const { value } = await assembly(t), owner = value.scenes[1];
  const output = { status: 'succeeded', stdout: '', stderr: `SCRIPT ERROR: Parse Error: Invalid animation\n  at: GDScript::reload (res://scenes/${owner.scene.objectId}/animation-runtime.gd:7)\n` };
  const diagnostics = adapter.diagnostics(output, value);
  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.equal(diagnostics[0].objectId, owner.animation.manifest.objectId);
  assert.equal(diagnostics[0].sourcePath, owner.animation.manifest.sourcePath);
  assert.equal(diagnostics[0].sourceRevision, owner.animation.manifest.sourceRevision);
});

test('real Godot missing animation data reports an error without a successful finished event', real, async t => {
  const value = plan(), f = await materialize(t, value), tool = await prepare(f, value);
  await fs.rm(path.join(f.directory, 'animation.json'));
  const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool });
  assert.equal(result.status, 'failed', result.stdout + result.stderr);
  const reader = adapter.createEventReader(value); reader.push(result.stdout); reader.finish();
  assert.ok(reader.diagnostics.some(item => item.code === 'runtime_animation_failed'), JSON.stringify(reader.diagnostics));
  assert.equal(reader.events.some(event => event.event === 'finished'), false);
});


test('real Sprite2D behavior and authored sibling visuals remain on the logical actor when animation starts', real, async t => {
  const value = plan({ behavior: true }), source = value.behaviors.sources[0];
  source.content = 'extends Sprite2D\nfunc _ready() -> void:\n\tvar sibling := Sprite2D.new()\n\tsibling.name = "AuthorSprite"\n\tget_parent().add_child(sibling)\n';
  source.sourceRevision = `sha256:${hash(source.content)}`;
  const f = await materialize(t, value), tool = await prepare(f, value), bindingId = value.behaviors.bindings[0].bindingId;
  await fs.writeFile(path.join(f.directory, 'animation-isolation.gd'), `extends "res://animation-runtime.gd"\nfunc run_smoke() -> void:\n\tvar actor: Node2D = actors[0]["node"]\n\tvar visual: Node2D = animation_visuals["${value.actors[0].instanceId}"]\n\tvar behavior: Node = actor.get_node("behavior_${bindingId.replaceAll('-', '_')}")\n\tvar sibling: Node = actor.get_node("AuthorSprite")\n\tif behavior.get_parent() != actor or sibling.get_parent() != actor or visual.get_child_count() != 1 or actor.get_child(0) != visual:\n\t\tpush_error("ANIMATION_MOVED_AUTHOR_NODE")\n\t\tget_tree().quit(1)\n\t\treturn\n\tprint("ANIMATION_ISOLATION:true")\n\tsuper.run_smoke()\n`);
  await fs.writeFile(path.join(f.directory, 'main.tscn'), f.generated.files.get('main.tscn').toString().replace('res://animation-runtime.gd', 'res://animation-isolation.gd'));
  const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, value), [], result.stdout + result.stderr);
  assert.match(result.stdout, /ANIMATION_ISOLATION:true/);
  const reader = adapter.createEventReader(value); reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, []); assert.ok(reader.events.some(event => event.event === 'finished'));
});
