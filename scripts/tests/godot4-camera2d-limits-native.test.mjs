import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { scenePhysics2DCharacterMotionAuthor } from './helpers/scene-physics2d-character-motion-author-fixture.mjs';
import { cameraProject, cameraOn, cameraStage } from './helpers/godot-camera2d-fixture.mjs';
import yauzl from 'yauzl';
import { runtimeId } from './helpers/project-runtime-fixture.mjs';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
const executable = process.env.VIENTO_GODOT_BIN;
const native = { skip: !executable ? 'Set VIENTO_GODOT_BIN for real bounded camera tests' : false, timeout: 180000 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const succeeded = result => { assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.doesNotMatch(result.stdout + result.stderr, /(?:SCRIPT ERROR:|ERROR:)/); };
function bounded(plan, index, camera) {
  cameraOn(plan, index, camera); plan.scenes[index].camera2d.document.schemaVersion = 2;
  for (const owner of [plan, plan.scenes[index]]) owner.requiredCapabilities = [...new Set([...owner.requiredCapabilities, 'scene.camera2d.limits2d'])].sort();
  return plan;
}
async function prepare(t, plan, resources = new Map()) {
  const generated = await adapter.generate(plan), directory = await cameraStage(t, generated), tool = await adapter.identify(executable);
  for (const [id, name] of generated.resourceFiles) { await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), resources.get(id)); }
  for (const phase of adapter.buildPhases) succeeded(await adapter.executePhase({ phase, directory, tool, timeoutMs: 60000 }));
  return { generated, directory, tool, plan };
}
const observer = `extends "res://camera2d-project-runtime.gd"
func vector(value: Vector2) -> Array:
\treturn [value.x, value.y]
func observe(label: String) -> void:
\tvar helper = current.get_node_or_null("VientoCamera2D")
\tvar camera = helper.camera
\tcamera.force_update_scroll()
\tvar view = get_viewport()
\tvar actors: Array = []
\tfor actor in current.actors:
\t\tactors.append({"instanceId":actor.instanceId,"position":vector(actor.node.global_position),"class":actor.node.get_class()})
\tprint("VIENTO_CAMERA_LIMITS_TEST:" + JSON.stringify({"label":label,"sceneId":current_scene,"visit":visit_index,"cameraId":camera.get_instance_id(),
\t\t"viewport":vector(view.get_visible_rect().size),"origin":vector(view.canvas_transform.origin),"basisX":vector(view.canvas_transform.x),"basisY":vector(view.canvas_transform.y),
\t\t"center":vector(camera.get_screen_center_position()),"globalPosition":vector(camera.global_position),"offset":vector(camera.offset),"topLevel":camera.top_level,"actors":actors}, "", true, true))
func settled() -> void:
\tawait get_tree().process_frame
\tawait get_tree().process_frame
`;
async function probe(f, source, window = false) {
  const names = ['camera-limits-test.gd', 'camera-limits-test.gd.uid', 'camera-limits-test.tscn'];
  await fs.writeFile(path.join(f.directory, names[0]), observer + source);
  await fs.writeFile(path.join(f.directory, names[2]), '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://camera-limits-test.gd" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n');
  let result;
  try { result = await runBuildProcess(executable, ['--path', f.directory, ...(window ? [] : ['--headless']), 'res://camera-limits-test.tscn', '--', '--viento-smoke'], { cwd: f.directory, timeoutMs: 60000, env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1' } }); }
  finally { for (const name of names) await fs.rm(path.join(f.directory, name), { force: true }); }
  succeeded(result);
  for (const [name, bytes] of f.generated.files) assert.deepEqual(await fs.readFile(path.join(f.directory, name)), bytes, name);
  return { result, samples: result.stdout.split('\n').filter(line => line.startsWith('VIENTO_CAMERA_LIMITS_TEST:')).map(line => JSON.parse(line.slice('VIENTO_CAMERA_LIMITS_TEST:'.length))) };
}
function expected(sample, declaration) {
  const desired = declaration.mode === 'fixed' ? declaration.center : declaration.offset.map((value, axis) => value + sample.actors.find(actor => actor.instanceId === declaration.targetInstanceId).position[axis]);
  const low = [declaration.limits.left, declaration.limits.top], high = [declaration.limits.right, declaration.limits.bottom];
  return desired.map((value, axis) => high[axis] - low[axis] < sample.viewport[axis] / declaration.zoom ? (low[axis] + high[axis]) / 2 : Math.max(low[axis] + sample.viewport[axis] / declaration.zoom / 2, Math.min(high[axis] - sample.viewport[axis] / declaration.zoom / 2, value)));
}
function check(sample, declaration) {
  const center = expected(sample, declaration), zoom = declaration.zoom;
  for (const [actual, wanted] of [[sample.center[0], center[0]], [sample.center[1], center[1]], [sample.origin[0], sample.viewport[0] / 2 - center[0] * zoom], [sample.origin[1], sample.viewport[1] / 2 - center[1] * zoom], [sample.basisX[0], zoom], [sample.basisY[1], zoom]]) assert.ok(Math.abs(actual - wanted) < .1, JSON.stringify({ sample, actual, wanted }));
  assert.equal(sample.topLevel, true); assert.deepEqual(sample.offset, [0, 0]);
}
async function evidence(name, f, extra) {
  const output = process.env.VIENTO_CAMERA2D_LIMITS_EVIDENCE_DIR; if (!output) return;
  await fs.mkdir(output, { recursive: true });
  const sources = {};
  for (const file of ['engine/scene-camera2d.mjs', 'scripts/backends/godot4-adapter.mjs', ...['', '-projection', '-inventory'].map(suffix => `scripts/backends/godot4-camera2d${suffix}.mjs`), ...['scene', 'project', 'limits-scene'].map(name => `scripts/backends/godot4/camera2d-${name}.gd`), 'scripts/tests/godot4-camera2d-limits-native.test.mjs']) sources[file] = hash(await fs.readFile(file));
  const files = Object.fromEntries(await Promise.all([...f.generated.files].map(async ([name, bytes]) => [name, { expected: hash(bytes), actual: hash(await fs.readFile(path.join(f.directory, name))) }])));
  await fs.writeFile(path.join(output, name + '.json'), JSON.stringify({ scope: 'Disposable bounded-camera project; real native viewport, actor and pixel observations', tool: f.tool, descriptor: adapter.descriptor.version, backend: f.generated.backend, sources, files, ...extra }, null, 2) + '\n');
}
test('native bounded fixed camera clamps fractional edges, centers small worlds, and uses actual entry viewport across visits', native, async t => {
  const plan = cameraProject(), first = { mode: 'fixed', center: [-1000, 1000], zoom: 2, limits: { left: -400.5, top: -300.25, right: 500.75, bottom: 700.5 } },
    second = { mode: 'fixed', center: [10000, -10000], zoom: .125, limits: { left: 10.25, top: -80.5, right: 30.75, bottom: -20.25 } };
  bounded(plan, 0, first); bounded(plan, 1, second); plan.scenes[1].viewport = { width: 320, height: 200 };
  const f = await prepare(t, plan), { result, samples } = await probe(f, `
func run_project_smoke() -> void:
\tawait settled()
\tobserve("fixed-edges")
\tleave_scene("switch", "${plan.scenes[1].scene.objectId}")
\tenter_scene("${plan.scenes[1].scene.objectId}")
\tawait settled()
\tobserve("small-world")
\tget_window().size = Vector2i(960, 540)
\tawait settled()
\tobserve("resized-small-world")
\tleave_scene("switch", "${plan.scenes[0].scene.objectId}")
\tenter_scene("${plan.scenes[0].scene.objectId}")
\tawait settled()
\tobserve("revisit-resized")
\tfinish_project()
`);
  assert.equal(samples.length, 4); samples.forEach((sample, index) => check(sample, [first, second, second, first][index]));
  assert.deepEqual(samples[1].viewport, samples[0].viewport); assert.notDeepEqual(samples[2].viewport, samples[0].viewport);
  assert.notEqual(samples[0].cameraId, samples[3].cameraId); assert.deepEqual(samples[0].actors, samples[3].actors);
  await evidence('fixed-small-resize', f, { declarations: [first, second], samples, nativeStdout: result.stdout, nativeStderr: result.stderr });
});
test('native bounded follow applies offset before clamping, follows stable logical instance and ignores animated visual transforms', native, async t => {
  const plan = cameraProject(); for (const actor of plan.scenes[0].actors) { actor.speed = 0; actor.controls = 'none'; }
  const declaration = { mode: 'follow', targetInstanceId: plan.scenes[0].actors[1].instanceId, offset: [180, -90], zoom: 2,
    limits: { left: -500.25, top: -400.5, right: 1000.5, bottom: 900.25 } };
  bounded(plan, 0, declaration); const f = await prepare(t, plan), { result, samples } = await probe(f, `
func run_project_smoke() -> void:
\tawait settled()
\tobserve("initial")
\tvar target = current.actors[1].node
\ttarget.position = Vector2(980, -390)
\tawait settled()
\tobserve("target-near-boundary")
\ttarget.get_child(0).position = Vector2(600, -500)
\ttarget.get_child(0).rotation = 1.3
\ttarget.rotation = 0.7
\tawait settled()
\tobserve("visual-offset")
\ttarget.position = Vector2(-2000, 2000)
\tawait settled()
\tobserve("outside-world")
\tfinish_project()
`);
  assert.equal(samples.length, 4); samples.forEach(sample => check(sample, declaration));
  assert.deepEqual(samples[1].center, samples[2].center); assert.deepEqual(samples[1].actors, samples[2].actors);
  assert.deepEqual(samples[3].actors[1].position, [-2000, 2000]); assert.deepEqual(samples[0].actors[0], samples[3].actors[0]);
  await evidence('follow-logical-offset', f, { declaration, samples, nativeStdout: result.stdout, nativeStderr: result.stderr });
});
test('native bounded camera observes original physical character movement without clamping or replacing the solver', native, async t => {
  const author = await scenePhysics2DCharacterMotionAuthor(t);
  await author.edit('documents/projects/demo.json', document => { document.sceneIds = [author.sceneIds[0]]; });
  await author.edit(`metadata/documents/${author.assemblyId}.json`, record => { record.relations = record.relations.filter(row => row.targetId === author.sceneIds[0]); });
  await author.edit(`metadata/documents/${author.sceneIds[0]}.json`, record => { record.relations = record.relations.filter(row => !['behavior', 'audio', 'animation'].includes(row.kind)); });
  const captured = await captureBuildSnapshot(author.author, author.assemblyId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const plan = structuredClone(captured.plan), declaration = { mode: 'follow', targetInstanceId: author.instanceId, offset: [1000, -1000], zoom: 1,
    limits: { left: 0, top: 0, right: 1000, bottom: 800 } }; bounded(plan, 0, declaration);
  const f = await prepare(t, plan, captured.resources), { result, samples } = await probe(f, `
func run_project_smoke() -> void:
\tif not await physics_settle():
\t\treturn
\tawait settled()
\tobserve("physical-initial")
\tInput.action_press("ui_right")
\tfor step in range(20):
\t\tcurrent.project_step(1.0 / 60.0)
\t\tif not await physics_settle():
\t\t\treturn
\t\tawait settled()
\t\tobserve("physical-step")
\tInput.action_release("ui_right")
\tfinish_project()
`);
  assert.equal(samples.length, 21); samples.forEach(sample => { check(sample, declaration); assert.equal(sample.actors[0].class, 'CharacterBody2D'); });
  assert.ok(samples.at(-1).actors[0].position[0] > samples[0].actors[0].position[0] + 10); assert.deepEqual(samples[0].center, samples.at(-1).center);
  await evidence('physical-follow', f, { declaration, samples, nativeStdout: result.stdout, nativeStderr: result.stderr });
});
test('native Xvfb bounded camera pixels reflect zoom, pre-clamp offset, small-world centering and real window resize', { ...native, skip: !executable || !process.env.VIENTO_XVFB_TEST ? 'Set VIENTO_GODOT_BIN and VIENTO_XVFB_TEST under isolated Xvfb' : false }, async t => {
  const plan = cameraProject(); for (const scene of plan.scenes) for (const [index, actor] of scene.actors.entries()) { actor.position = index ? [1400, 900] : [1000, 800]; actor.size = [40, 40]; actor.speed = 0; actor.controls = 'none'; actor.color = index ? '#20d080' : '#d02040'; }
  const first = { mode: 'follow', targetInstanceId: plan.scenes[0].actors[1].instanceId, offset: [100, -100], zoom: 2, limits: { left: 1000, top: 700, right: 1800, bottom: 1300 } },
    second = { mode: 'fixed', center: [-1000, 1000], zoom: .5, limits: { left: 1300, top: 800, right: 1500, bottom: 1000 } };
  bounded(plan, 0, first); bounded(plan, 1, second);
  const f = await prepare(t, plan), output = process.env.VIENTO_CAMERA2D_LIMITS_EVIDENCE_DIR || path.join(f.directory, 'captures'); await fs.mkdir(output, { recursive: true });
  const screenshots = Object.fromEntries(['follow', 'fixed-small', 'resized-small'].map(name => [name, path.join(output, name + '.png')]));
  const { result, samples } = await probe(f, `
func snap(label: String, destination: String) -> void:
\tobserve(label)
\tawait RenderingServer.frame_post_draw
\tif get_viewport().get_texture().get_image().save_png(destination) != OK:
\t\tget_tree().quit(1)
func run_project_smoke() -> void:
\tawait settled()
\tawait snap("follow", ${JSON.stringify(screenshots.follow)})
\tleave_scene("switch", "${plan.scenes[1].scene.objectId}")
\tenter_scene("${plan.scenes[1].scene.objectId}")
\tawait settled()
\tawait snap("fixed-small", ${JSON.stringify(screenshots['fixed-small'])})
\tget_window().size = Vector2i(960, 540)
\tawait settled()
\tawait snap("resized-small", ${JSON.stringify(screenshots['resized-small'])})
\tfinish_project()
`, true);
  assert.equal(samples.length, 3); samples.forEach((sample, index) => check(sample, index ? second : first));
  const analysis = await runBuildProcess('python3', ['-c', `from PIL import Image\nimport json,sys\nout={}\nfor name in sys.argv[1:]:\n im=Image.open(name).convert('RGB'); pts=[(x,y) for y in range(im.height) for x in range(im.width) if im.getpixel((x,y))==(32,208,128)]\n if not pts: raise Exception('No actor color '+name)\n out[name]={'size':list(im.size),'bounds':[min(x for x,y in pts),min(y for x,y in pts),max(x for x,y in pts)+1,max(y for x,y in pts)+1],'pixels':len(pts)}\nprint(json.dumps(out))`, ...Object.values(screenshots)], { timeoutMs: 30000 });
  succeeded(analysis); const pixels = JSON.parse(analysis.stdout);
  for (const [index, file] of Object.values(screenshots).entries()) { const sample = samples[index], zoom = index ? .5 : 2, center = expected(sample, index ? second : first), extent = 40 * zoom,
    actor = sample.actors[1].position, screen = actor.map((value, axis) => sample.viewport[axis] / 2 + (value - center[axis]) * zoom), image = pixels[file];
    assert.deepEqual(image.size, sample.viewport); assert.deepEqual(image.bounds, [screen[0] - extent / 2, screen[1] - extent / 2, screen[0] + extent / 2, screen[1] + extent / 2]); assert.equal(image.pixels, extent * extent);
  }
  await evidence('window-pixels', f, { declarations: [first, second], samples, pixels, screenshots: Object.fromEntries(await Promise.all(Object.entries(screenshots).map(async ([name, file]) => [name, { name: path.basename(file), sha256: hash(await fs.readFile(file)) }]))), nativeStdout: result.stdout, nativeStderr: result.stderr, renderer: 'Real Xvfb window; llvmpipe is software GL, not evidence of hardware GPU' });
});

async function treeHashes(directory) {
  const rows = (await fs.readdir(directory, { recursive: true, withFileTypes: true })).filter(row => row.isFile()).map(row => path.join(row.parentPath, row.name)).sort();
  return Object.fromEntries(await Promise.all(rows.map(async file => [path.relative(directory, file), hash(await fs.readFile(file))])));
}
test('bounded camera project ZIP retains full limits and runs offline after the original author and build disappear', native, async t => {
  const author = await projectAssemblyAuthor(t), documentId = runtimeId(150), instance = runtimeId(151), sourcePath = 'documents/projects/camera-limits.json';
  const read = async file => JSON.parse(await fs.readFile(path.join(author.author, file))), write = async (file, value) => fs.writeFile(path.join(author.author, file), JSON.stringify(value, null, 2) + '\n');
  const scenePath = 'documents/scenes/demo.json', scene = await read(scenePath);
  scene.actors.push({ ...structuredClone(scene.actors[0]), instanceId: instance, position: [1400, 900], speed: 0, controls: 'none' }); await write(scenePath, scene);
  const declaration = { mode: 'follow', targetInstanceId: instance, offset: [900, -500], zoom: 2, limits: { left: 1000.25, top: 700.5, right: 1800.75, bottom: 1300.25 } };
  const document = { format: 'viento-scene-camera2d', schemaVersion: 2, sceneObjectId: author.sceneIds[0], camera: declaration }; await write(sourcePath, document);
  const record = await read(`metadata/documents/${author.assemblyId}.json`);
  await write(`metadata/documents/${documentId}.json`, { ...record, id: documentId, sourcePath, relations: [{ kind: 'references', targetId: author.sceneIds[0], slot: 'scene' }] });
  const sceneRecord = await read(`metadata/documents/${author.sceneIds[0]}.json`); sceneRecord.relations.push({ kind: 'references', targetId: documentId, slot: 'camera2d' }); await write(`metadata/documents/${author.sceneIds[0]}.json`, sceneRecord);
  const before = await treeHashes(author.author), output = path.join(author.temporary, 'build'), built = await buildProject({ root: author.author, targetId: author.assemblyId, tool: executable, output, timeoutMs: 60000 });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built)); assert.equal(built.record.backend.version, '0.46.0');
  const snapshot = JSON.parse(await fs.readFile(path.join(output, 'snapshot.json'))), generated = await adapter.generate(snapshot.plan), inspect = () => inspectBackendProject({ buildDirectory: output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect }), zip = path.join(author.temporary, 'camera-limits.zip');
  await writeExportZip(delivery, zip); const verified = await verifyBackendProjectDelivery(zip), relocated = path.join(author.temporary, 'relocated'); await fs.mkdir(relocated);
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try { for await (const entry of archive.eachEntry()) {
    assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
    const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
    const file = path.join(relocated, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  await fs.rename(author.author, author.author + '.offline'); await fs.rename(output, output + '.offline');
  await assert.rejects(fs.access(author.author), { code: 'ENOENT' }); await assert.rejects(fs.access(output), { code: 'ENOENT' });
  const f = { plan: snapshot.plan, generated, directory: path.join(relocated, 'project'), tool: await adapter.identify(executable) }, phases = [];
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, `scenes/${author.sceneIds[0]}/camera2d-limits.json`))), document);
  const derived = JSON.parse(await fs.readFile(path.join(f.directory, `scenes/${author.sceneIds[0]}/camera2d.json`))); assert.equal(derived.schemaVersion, 1); assert.equal(Object.hasOwn(derived.camera, 'limits'), false);
  assert.deepEqual(await fs.readFile(path.join(f.directory, 'camera2d-limits-scene.gd')), generated.files.get('camera2d-limits-scene.gd'));
  for (const phase of [...adapter.buildPhases, 'run']) { const result = await adapter.executePhase({ phase, tool: f.tool, directory: f.directory, timeoutMs: 60000 }); succeeded(result); phases.push({ phase, ...result }); }
  const { result, samples } = await probe(f, '\nfunc run_project_smoke() -> void:\n\tawait settled()\n\tobserve("offline-limits")\n\tfinish_project()\n');
  assert.equal(samples.length, 1); check(samples[0], declaration); assert.deepEqual(samples[0].actors.find(actor => actor.instanceId === instance).position, [1400, 900]);
  assert.deepEqual(await treeHashes(author.author + '.offline'), before);
  const evidenceDirectory = process.env.VIENTO_CAMERA2D_LIMITS_EVIDENCE_DIR;
  if (evidenceDirectory) { await fs.mkdir(evidenceDirectory, { recursive: true }); await fs.copyFile(zip, path.join(evidenceDirectory, 'camera-limits-project.zip')); }
  await evidence('offline-delivery', f, { sourcePlan: snapshot.plan, declaration, authorHashes: before, authorAfter: await treeHashes(author.author + '.offline'), originalPathsUnavailable: true, zip: { bytes: (await fs.stat(zip)).size, sha256: hash(await fs.readFile(zip)), verification: verified }, phases, samples, nativeStdout: result.stdout, nativeStderr: result.stderr });
});
