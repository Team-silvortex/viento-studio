import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { cameraProject, cameraOn, cameraStage } from './helpers/godot-camera2d-fixture.mjs';
import { runtimeId } from './helpers/project-runtime-fixture.mjs';
import { scenePhysics2DCharacterMotionAuthor } from './helpers/scene-physics2d-character-motion-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import yauzl from 'yauzl';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
const executable = process.env.VIENTO_GODOT_BIN;
const native = { skip: !executable ? 'Set VIENTO_GODOT_BIN for native camera tests' : false, timeout: 180000 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function succeeded(result) { assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.doesNotMatch(result.stdout + result.stderr, /(?:SCRIPT ERROR:|ERROR:)/); }
async function prepare(t, plan, resources = new Map()) {
  const generated = await adapter.generate(plan), directory = await cameraStage(t, generated), tool = await adapter.identify(executable);
  for (const [id, name] of generated.resourceFiles) { await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), resources.get(id)); }
  succeeded(await adapter.executePhase({ phase: 'import', directory, tool, timeoutMs: 60000 }));
  succeeded(await adapter.executePhase({ phase: 'script-check', directory, tool, timeoutMs: 60000 }));
  return { plan, generated, directory, tool };
}
async function unchanged(f) { for (const [name, bytes] of f.generated.files) assert.deepEqual(await fs.readFile(path.join(f.directory, name)), bytes, name); }
async function evidence(name, f, extra) {
  if (!process.env.VIENTO_CAMERA2D_EVIDENCE_DIR) return;
  await fs.mkdir(process.env.VIENTO_CAMERA2D_EVIDENCE_DIR, { recursive: true });
  const files = Object.fromEntries(await Promise.all([...f.generated.files].map(async ([name, bytes]) => [name, { expected: hash(bytes), actual: hash(await fs.readFile(path.join(f.directory, name))) }])));
  await fs.writeFile(path.join(process.env.VIENTO_CAMERA2D_EVIDENCE_DIR, `${name}.json`), JSON.stringify({ scope: 'Disposable generated Godot project; real native viewport/camera observations', tool: f.tool, descriptor: adapter.descriptor.version, files, ...extra }, null, 2) + '\n');
}
const sharedProbe = `extends "res://camera2d-project-runtime.gd"
func vector(value: Vector2) -> Array:
\treturn [value.x, value.y]
func observe(label: String) -> void:
\tvar helper = current.get_node_or_null("VientoCamera2D")
\tvar camera = helper.camera if helper != null else null
\tif camera != null:
\t\tcamera.force_update_scroll()
\tvar view = get_viewport()
\tvar transform = view.canvas_transform
\tvar actors: Array = []
\tfor actor in current.actors:
\t\tactors.append({"instanceId": actor.instanceId, "position": vector(actor.node.global_position), "class": actor.node.get_class()})
\tprint("VIENTO_CAMERA_TEST:" + JSON.stringify({"label":label,"sceneId":current_scene,"visit":visit_index,
\t\t"origin":vector(transform.origin),"basisX":vector(transform.x),"basisY":vector(transform.y),"viewport":vector(view.get_visible_rect().size),"actors":actors,
\t\t"cameraId":camera.get_instance_id() if camera != null else 0,"parent":str(camera.get_parent().name) if camera != null else "",
\t\t"center":vector(camera.get_screen_center_position()) if camera != null else [],"cameraPosition":vector(camera.position) if camera != null else [],
\t\t"rotationIgnored":camera.ignore_rotation if camera != null else false}, "", true, true))
`;
async function probe(f, source, { window = false } = {}) {
  const names = ['camera-test.gd', 'camera-test.gd.uid', 'camera-test.tscn'];
  await fs.writeFile(path.join(f.directory, names[0]), sharedProbe + source);
  await fs.writeFile(path.join(f.directory, names[2]), '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://camera-test.gd" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n');
  let result;
  try { result = await runBuildProcess(executable, ['--path', f.directory, ...(window ? [] : ['--headless']), 'res://camera-test.tscn', '--', '--viento-smoke'], { cwd: f.directory, timeoutMs: 60000, env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1' } }); }
  finally { for (const name of names) await fs.rm(path.join(f.directory, name), { force: true }); }
  succeeded(result); await unchanged(f);
  return { result, samples: result.stdout.split('\n').filter(line => line.startsWith('VIENTO_CAMERA_TEST:')).map(line => JSON.parse(line.slice('VIENTO_CAMERA_TEST:'.length))) };
}
function viewport(sample, center, zoom) {
  for (const [actual, expected] of [[sample.basisX[0], zoom], [sample.basisX[1], 0], [sample.basisY[0], 0], [sample.basisY[1], zoom],
    [sample.origin[0], sample.viewport[0] / 2 - center[0] * zoom], [sample.origin[1], sample.viewport[1] / 2 - center[1] * zoom]]) assert.ok(Math.abs(actual - expected) < .01, JSON.stringify({ sample, actual, expected }));
}

test('native camera follow selects the logical instance, ignores visual transforms and rebuilds across mixed visits', native, async t => {
  const plan = cameraProject(), first = plan.scenes[0], second = plan.scenes[1], third = structuredClone(second);
  third.scene.objectId = runtimeId(3); third.scene.sourcePath = 'documents/scenes/third.json';
  for (const actor of third.actors) for (const source of [actor.declaration, ...Object.values(actor.fieldSources)]) if (source?.objectId === second.scene.objectId) { source.objectId = third.scene.objectId; source.sourcePath = third.scene.sourcePath; }
  plan.scenes.push(third);
  const target = first.actors[1].instanceId;
  cameraOn(plan, 0, { mode: 'follow', targetInstanceId: target, offset: [-24, 16], zoom: 2 });
  cameraOn(plan, 1, { mode: 'fixed', center: [-100, 800], zoom: .125 });
  const f = await prepare(t, plan), { result, samples } = await probe(f, `
func run_project_smoke() -> void:
\tawait get_tree().process_frame
\tobserve("initial")
\tvar target = current.actors[1].node
\ttarget.position += Vector2(73, -41)
\ttarget.rotation = 0.7
\tvar visual = target.get_child(0)
\tvisual.position = Vector2(600, -500)
\tvisual.rotation = 1.3
\tawait get_tree().process_frame
\tobserve("moved")
\tleave_scene("switch", "${second.scene.objectId}")
\tenter_scene("${second.scene.objectId}")
\tawait get_tree().process_frame
\tobserve("fixed")
\tleave_scene("switch", "${third.scene.objectId}")
\tenter_scene("${third.scene.objectId}")
\tawait get_tree().process_frame
\tobserve("unconfigured")
\tleave_scene("switch", "${first.scene.objectId}")
\tenter_scene("${first.scene.objectId}")
\tawait get_tree().process_frame
\tobserve("revisited")
\tfinish_project()
`);
  assert.equal(samples.length, 5); const [initial, moved, fixed, none, revisit] = samples;
  const center = sample => [sample.actors[1].position[0] - 24, sample.actors[1].position[1] + 16];
  viewport(initial, center(initial), 2); viewport(moved, center(moved), 2); viewport(fixed, [-100, 800], .125); viewport(revisit, center(revisit), 2);
  assert.equal(initial.parent, `actor_${target.replaceAll('-', '_')}`); assert.equal(moved.parent, initial.parent); assert.equal(initial.rotationIgnored, true);
  assert.deepEqual(moved.actors[0], initial.actors[0]); assert.deepEqual(moved.actors[1].position, [initial.actors[1].position[0] + 73, initial.actors[1].position[1] - 41]);
  assert.deepEqual(none.origin, [0, 0]); assert.deepEqual(none.basisX, [1, 0]); assert.deepEqual(none.basisY, [0, 1]); assert.equal(none.cameraId, 0);
  assert.notEqual(revisit.cameraId, initial.cameraId); assert.deepEqual(revisit.actors, initial.actors); assert.equal(fixed.parent, 'VientoScene');
  succeeded(await adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.tool, timeoutMs: 60000 })); await unchanged(f);
  await evidence('mixed-visits', f, { samples, nativeStdout: result.stdout, nativeStderr: result.stderr });
});

test('native camera zoom boundary eight and authored negative center map world coordinates exactly', native, async t => {
  const plan = cameraOn(cameraProject(), 0, { mode: 'fixed', center: [-100000, 100000], zoom: 8 }), f = await prepare(t, plan);
  const { result, samples } = await probe(f, '\nfunc run_project_smoke() -> void:\n\tawait get_tree().process_frame\n\tobserve("fixed-boundary")\n\tfinish_project()\n');
  assert.equal(samples.length, 1); viewport(samples[0], [-100000, 100000], 8);
  await evidence('fixed-boundaries', f, { samples, nativeStdout: result.stdout, nativeStderr: result.stderr });
});

test('native camera attaches after physical body replacement and follows the original solver', native, async t => {
  const author = await scenePhysics2DCharacterMotionAuthor(t);
  await author.edit('documents/projects/demo.json', document => { document.sceneIds = [author.sceneIds[0]]; });
  await author.edit(`metadata/documents/${author.assemblyId}.json`, record => { record.relations = record.relations.filter(row => row.targetId === author.sceneIds[0]); });
  await author.edit(`metadata/documents/${author.sceneIds[0]}.json`, record => { record.relations = record.relations.filter(row => !['behavior', 'audio', 'animation'].includes(row.kind)); });
  const captured = await captureBuildSnapshot(author.author, author.assemblyId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const plan = structuredClone(captured.plan); cameraOn(plan, 0, { mode: 'follow', targetInstanceId: author.instanceId, offset: [32, -16], zoom: .5 });
  const f = await prepare(t, plan, captured.resources), { result, samples } = await probe(f, `
func run_project_smoke() -> void:
\tif not await physics_settle():
\t\treturn
\tobserve("physical-initial")
\tInput.action_press("ui_right")
\tfor step in range(20):
\t\tcurrent.project_step(1.0 / 60.0)
\t\tif not await physics_settle():
\t\t\treturn
\t\tobserve("physical-step")
\tInput.action_release("ui_right")
\tfinish_project()
`);
  assert.equal(samples.length, 21);
  for (const sample of samples) { assert.equal(sample.actors[0].class, 'CharacterBody2D'); assert.equal(sample.parent, `actor_${author.instanceId.replaceAll('-', '_')}`); viewport(sample, [sample.actors[0].position[0] + 32, sample.actors[0].position[1] - 16], .5); }
  assert.ok(samples.at(-1).actors[0].position[0] > samples[0].actors[0].position[0] + 10, 'actual original native solver movement');
  await evidence('physical-follow', f, { samples, nativeStdout: result.stdout, nativeStderr: result.stderr });
});

test('native Xvfb screenshots show follow instance, independent visual offset and fixed zoom', { ...native, skip: !executable || !process.env.VIENTO_XVFB_TEST ? 'Set VIENTO_GODOT_BIN and VIENTO_XVFB_TEST under isolated Xvfb for camera pixels' : false }, async t => {
  const plan = cameraProject();
  for (const scene of plan.scenes) for (const [index, actor] of scene.actors.entries()) { actor.position = index ? [1400, 900] : [1000, 800]; actor.size = [40, 40]; actor.speed = 0; actor.controls = 'none'; actor.color = index ? '#20d080' : '#d02040'; }
  cameraOn(plan, 0, { mode: 'follow', targetInstanceId: plan.scenes[0].actors[1].instanceId, offset: [-24, 16], zoom: 2 });
  cameraOn(plan, 1, { mode: 'fixed', center: [1400, 900], zoom: .5 });
  const f = await prepare(t, plan), output = process.env.VIENTO_CAMERA2D_EVIDENCE_DIR || path.join(f.directory, 'captures'); await fs.mkdir(output, { recursive: true });
  const screenshots = Object.fromEntries(['follow', 'visual-offset', 'fixed'].map(name => [name, path.join(output, `${name}.png`)]));
  const { result, samples } = await probe(f, `
func snap(label: String, destination: String) -> void:
\tobserve(label)
\tawait RenderingServer.frame_post_draw
\tif get_viewport().get_texture().get_image().save_png(destination) != OK:
\t\tget_tree().quit(1)
func run_project_smoke() -> void:
\tawait get_tree().process_frame
\tawait snap("follow", ${JSON.stringify(screenshots.follow)})
\tcurrent.actors[1].node.get_child(0).position = Vector2(30, -10)
\tcurrent.actors[1].node.get_child(0).rotation = PI / 2
\tawait get_tree().process_frame
\tawait snap("visual-offset", ${JSON.stringify(screenshots['visual-offset'])})
\tleave_scene("switch", "${plan.scenes[1].scene.objectId}")
\tenter_scene("${plan.scenes[1].scene.objectId}")
\tawait get_tree().process_frame
\tawait snap("fixed", ${JSON.stringify(screenshots.fixed)})
\tfinish_project()
`, { window: true });
  const analysis = await runBuildProcess('python3', ['-c', `from PIL import Image\nimport json,sys\nout={}\nfor name in sys.argv[1:]:\n im=Image.open(name).convert('RGB'); pts=[(x,y) for y in range(im.height) for x in range(im.width) if im.getpixel((x,y))==(32,208,128)]\n if not pts: raise Exception('No exact actor color '+name)\n out[name]={'size':list(im.size),'bounds':[min(x for x,y in pts),min(y for x,y in pts),max(x for x,y in pts)+1,max(y for x,y in pts)+1],'pixels':len(pts)}\nprint(json.dumps(out))`, ...Object.values(screenshots)], { timeoutMs: 30000 });
  succeeded(analysis); const pixels = JSON.parse(analysis.stdout);
  for (const [label, offset, extent] of [['follow', [48, -32], 80], ['visual-offset', [108, -52], 80], ['fixed', [0, 0], 20]]) {
    const { size, bounds, pixels: count } = pixels[screenshots[label]], center = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    assert.deepEqual(center, [size[0] / 2 + offset[0], size[1] / 2 + offset[1]]); assert.equal(bounds[2] - bounds[0], extent); assert.equal(bounds[3] - bounds[1], extent); assert.equal(count, extent * extent);
  }
  assert.deepEqual(samples[0].center, samples[1].center); assert.deepEqual(samples[0].actors, samples[1].actors);
  await evidence('window-pixels', f, { samples, pixels, screenshots: Object.fromEntries(await Promise.all(Object.entries(screenshots).map(async ([name, file]) => [name, { name: path.basename(file), sha256: hash(await fs.readFile(file)) }]))), nativeStdout: result.stdout, nativeStderr: result.stderr, renderer: 'Xvfb window with software GL when llvmpipe is reported; no hardware-GPU claim' });
});

async function treeHashes(directory) {
  const rows = (await fs.readdir(directory, { recursive: true, withFileTypes: true })).filter(row => row.isFile()).map(row => path.join(row.parentPath, row.name)).sort();
  return Object.fromEntries(await Promise.all(rows.map(async file => [path.relative(directory, file), hash(await fs.readFile(file))])));
}
test('recorded camera project ZIP imports, checks and runs after original author/build paths disappear', native, async t => {
  const author = await projectAssemblyAuthor(t), documentId = runtimeId(150), instance = runtimeId(151), sourcePath = 'documents/projects/camera.json';
  const read = async file => JSON.parse(await fs.readFile(path.join(author.author, file))), write = async (file, value) => fs.writeFile(path.join(author.author, file), JSON.stringify(value, null, 2) + '\n');
  const scenePath = 'documents/scenes/demo.json', scene = await read(scenePath);
  scene.actors.push({ ...structuredClone(scene.actors[0]), instanceId: instance, position: [1400, 900], speed: 0, controls: 'none' });
  await write(scenePath, scene);
  const document = { format: 'viento-scene-camera2d', schemaVersion: 1, sceneObjectId: author.sceneIds[0], camera: { mode: 'follow', targetInstanceId: instance, offset: [-24, 16], zoom: 2 } };
  await write(sourcePath, document);
  const record = await read(`metadata/documents/${author.assemblyId}.json`);
  await write(`metadata/documents/${documentId}.json`, { ...record, id: documentId, sourcePath, relations: [{ kind: 'references', targetId: author.sceneIds[0], slot: 'scene' }] });
  const sceneRecord = await read(`metadata/documents/${author.sceneIds[0]}.json`); sceneRecord.relations.push({ kind: 'references', targetId: documentId, slot: 'camera2d' });
  await write(`metadata/documents/${author.sceneIds[0]}.json`, sceneRecord);
  const before = await treeHashes(author.author), output = path.join(author.temporary, 'build'), built = await buildProject({ root: author.author, targetId: author.assemblyId, tool: executable, output, timeoutMs: 60000 });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built)); assert.equal(built.record.backend.version, '0.47.0');
  const snapshot = JSON.parse(await fs.readFile(path.join(output, 'snapshot.json'))), generated = await adapter.generate(snapshot.plan), inspect = () => inspectBackendProject({ buildDirectory: output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect }), zip = path.join(author.temporary, 'camera.zip');
  await writeExportZip(delivery, zip); const verified = await verifyBackendProjectDelivery(zip);
  const relocated = path.join(author.temporary, 'relocated'); await fs.mkdir(relocated);
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try { for await (const entry of archive.eachEntry()) {
    assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
    const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
    const file = path.join(relocated, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  await fs.rename(author.author, author.author + '.offline'); await fs.rename(output, output + '.offline');
  await assert.rejects(fs.access(author.author), { code: 'ENOENT' }); await assert.rejects(fs.access(output), { code: 'ENOENT' });
  const f = { plan: snapshot.plan, generated, directory: path.join(relocated, 'project'), tool: await adapter.identify(executable) }, phases = [];
  for (const phase of [...adapter.buildPhases, 'run']) { const result = await adapter.executePhase({ phase, tool: f.tool, directory: f.directory, timeoutMs: 60000 }); succeeded(result); phases.push({ phase, ...result }); }
  const { result, samples } = await probe(f, '\nfunc run_project_smoke() -> void:\n\tawait get_tree().process_frame\n\tobserve("offline-delivery")\n\tfinish_project()\n');
  assert.equal(samples[0].parent, `actor_${instance.replaceAll('-', '_')}`); viewport(samples[0], [1376, 916], 2);
  assert.deepEqual(await treeHashes(author.author + '.offline'), before);
  const evidenceDirectory = process.env.VIENTO_CAMERA2D_EVIDENCE_DIR;
  if (evidenceDirectory) await fs.copyFile(zip, path.join(evidenceDirectory, 'camera-project.zip'));
  await evidence('offline-delivery', f, { sourcePlan: snapshot.plan, authorHashes: before, authorAfter: await treeHashes(author.author + '.offline'), originalPathsUnavailable: true, zip: { bytes: (await fs.stat(zip)).size, sha256: hash(await fs.readFile(zip)), verification: verified }, phases, samples, nativeStdout: result.stdout, nativeStderr: result.stderr });
});
