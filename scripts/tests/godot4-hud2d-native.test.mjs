import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { resolveSceneHUD2DView } from '../../engine/scene-hud2d-view.mjs';
import { SCENE_HUD2D_ANCHORS } from '../../engine/scene-hud2d.mjs';
import { cameraProject, cameraOn, cameraStage } from './helpers/godot-camera2d-fixture.mjs';
import { hudOn, hudLabel, hudBar } from './helpers/godot-hud2d-fixture.mjs';
import { runtimeId } from './helpers/project-runtime-fixture.mjs';
import { projectSharedStateAuthor } from './helpers/project-shared-state-author-fixture.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
import yauzl from 'yauzl';
const executable = process.env.VIENTO_GODOT_BIN;
const native = { skip: !executable ? 'Set VIENTO_GODOT_BIN for real screen-space HUD tests' : false, timeout: 180000 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const succeeded = result => { assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.doesNotMatch(result.stdout + result.stderr, /(?:SCRIPT ERROR:|ERROR:)/); };
async function prepare(t, plan, resources = new Map()) {
  const generated = await adapter.generate(plan), directory = await cameraStage(t, generated), tool = await adapter.identify(executable);
  for (const [id, name] of generated.resourceFiles) { await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), resources.get(id)); }
  for (const phase of adapter.buildPhases) succeeded(await adapter.executePhase({ phase, directory, tool, timeoutMs: 60000 }));
  return { generated, directory, tool, plan };
}
const observer = `extends "res://hud2d-project-runtime.gd"
func vector(value: Vector2) -> Array:
\treturn [value.x, value.y]
func settled() -> void:
\tawait get_tree().process_frame
\tawait get_tree().process_frame
func observe(label: String) -> void:
\tvar helper = current.get_node_or_null("VientoHUD2D")
\tvar elements: Array = []
\tif helper != null:
\t\tfor row in helper.rows:
\t\t\tvar node = row.node
\t\t\tvar transform = node.get_global_transform_with_canvas()
\t\t\tvar item = {"id":row.declaration.id,"kind":row.declaration.kind,"position":vector(node.position),"size":vector(node.size),"origin":vector(transform.origin),"basisX":vector(transform.x),"basisY":vector(transform.y),"mouseFilter":node.mouse_filter,"focusMode":node.focus_mode}
\t\t\tif row.declaration.kind == "label":
\t\t\t\titem["text"] = row.label.text
\t\t\telse:
\t\t\t\titem["fillSize"] = vector(row.fill.size)
\t\t\telements.append(item)
\tvar actors: Array = []
\tfor actor in current.actors:
\t\tactors.append({"instanceId":actor.instanceId,"position":vector(actor.node.global_position)})
\tprint("VIENTO_HUD_TEST:" + JSON.stringify({"label":label,"sceneId":current_scene,"visit":visit_index,"viewport":vector(get_viewport().get_visible_rect().size),"state":shared_state,"revision":state_revision,"hudId":helper.get_instance_id() if helper != null else 0,"lastRevision":helper.last_state_revision if helper != null else -1,"layer":helper.layer if helper != null else 0,"followsWorld":helper.follow_viewport_enabled if helper != null else false,"worldOrigin":vector(get_viewport().canvas_transform.origin),"elements":elements,"actors":actors}, "", true, true))
`;
async function probe(f, source, { window = false } = {}) {
  const names = ['hud-test.gd', 'hud-test.gd.uid', 'hud-test.tscn'];
  await fs.writeFile(path.join(f.directory, names[0]), observer + source);
  await fs.writeFile(path.join(f.directory, names[2]), '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://hud-test.gd" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n');
  let result;
  try { result = await runBuildProcess(executable, ['--path', f.directory, ...(window ? [] : ['--headless']), 'res://hud-test.tscn', '--', '--viento-smoke'], { cwd: f.directory, timeoutMs: 60000, env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1' } }); }
  finally { for (const name of names) await fs.rm(path.join(f.directory, name), { force: true }); }
  succeeded(result); for (const [name, bytes] of f.generated.files) assert.deepEqual(await fs.readFile(path.join(f.directory, name)), bytes, name);
  return { result, samples: result.stdout.split('\n').filter(line => line.startsWith('VIENTO_HUD_TEST:')).map(line => JSON.parse(line.slice('VIENTO_HUD_TEST:'.length))) };
}
function viewMatches(sample, document) {
  const expected = resolveSceneHUD2DView({ document, viewport: sample.viewport, state: Object.entries(sample.state).map(([key, value]) => ({ key, value })) });
  assert.equal(sample.layer, 1); assert.equal(sample.followsWorld, false); assert.equal(sample.lastRevision, sample.revision); assert.equal(sample.elements.length, expected.elements.length);
  expected.elements.forEach((element, index) => {
    const actual = sample.elements[index], rect = element.rect; assert.equal(actual.id, element.id); assert.deepEqual(actual.position, [rect.x, rect.y]); assert.deepEqual(actual.size, [rect.width, rect.height]);
    assert.deepEqual(actual.origin, actual.position); assert.deepEqual(actual.basisX, [1, 0]); assert.deepEqual(actual.basisY, [0, 1]); assert.equal(actual.mouseFilter, 2); assert.equal(actual.focusMode, 0);
    if (element.kind === 'label') assert.equal(actual.text, element.text); else { assert.ok(Math.abs(actual.fillSize[0] - rect.width * element.ratio) < .001); assert.equal(actual.fillSize[1], rect.height); }
  });
}
async function evidence(name, f, extra) {
  const output = process.env.VIENTO_HUD2D_EVIDENCE_DIR; if (!output) return;
  await fs.mkdir(output, { recursive: true });
  const files = Object.fromEntries(await Promise.all([...f.generated.files].map(async ([name, bytes]) => [name, { expected: hash(bytes), actual: hash(await fs.readFile(path.join(f.directory, name))) }]))), sources = {};
  for (const file of ['engine/scene-hud2d.mjs', 'engine/scene-hud2d-view.mjs', 'scripts/backends/godot4-adapter.mjs', 'scripts/backends/godot4-camera2d-inventory.mjs', ...['', '-projection', '-inventory'].map(suffix => `scripts/backends/godot4-hud2d${suffix}.mjs`), ...['scene', 'project'].map(name => `scripts/backends/godot4/hud2d-${name}.gd`), 'scripts/tests/godot4-hud2d-native.test.mjs', 'scripts/tests/helpers/godot-hud2d-fixture.mjs']) sources[file] = hash(await fs.readFile(file));
  await fs.writeFile(path.join(output, name + '.json'), JSON.stringify({ scope: 'Disposable HUD project, real native node and screen-space observations', tool: f.tool, descriptor: adapter.descriptor.version, backend: f.generated.backend, sources, files, ...extra }, null, 2) + '\n');
}

test('native HUD mirrors pure state text/bar semantics without changing revision or world geometry', native, async t => {
  const plan = cameraProject(), elements = [hudLabel(), hudBar(), hudLabel(172, { offset: [16, 56], content: { kind: 'state', key: 'truth', prefix: '[', suffix: ']', missing: '?' } }),
    hudLabel(173, { offset: [16, 96], content: { kind: 'state', key: 'empty', prefix: '[', suffix: ']', missing: '?' } }), hudLabel(174, { offset: [16, 136], content: { kind: 'state', key: 'control', prefix: '', suffix: '', missing: '?' } })];
  elements.push(...SCENE_HUD2D_ANCHORS.map((anchor, index) => hudLabel(200 + index, { anchor, offset: [0, 0], size: [20, 16], fontSize: 8, content: { kind: 'literal', text: anchor } })));
  hudOn(plan, 0, elements); const f = await prepare(t, plan), { result, samples } = await probe(f, `
func run_project_smoke() -> void:
\tawait settled()
\tobserve("missing")
\tshared_state = {"score":0,"truth":false,"empty":"","health":0,"control":"A" + String.chr(0) + "B" + String.chr(127) + "C\\t\\n\\r"}
\tstate_revision += 1
\tawait settled()
\tobserve("zero-false-empty-controls")
\tshared_state = {"score":-1.2345,"truth":true,"empty":"雨の鍵 / 风之钥匙 🔑","health":75}
\tstate_revision += 1
\tawait settled()
\tobserve("values")
\tshared_state["score"] = -0.00049
\tshared_state["health"] = false
\tstate_revision += 1
\tawait settled()
\tobserve("negative-zero-and-nonnumeric-bar")
\tshared_state.erase("score")
\tshared_state["health"] = 1000
\tstate_revision += 1
\tawait settled()
\tobserve("delete-and-clamp")
\tfinish_project()
`);
  assert.equal(samples.length, 5); samples.forEach(sample => viewMatches(sample, plan.scenes[0].hud2d.document));
  assert.deepEqual(samples.map(sample => sample.revision), [0, 1, 2, 3, 4]); assert.deepEqual(samples[0].actors, samples.at(-1).actors);
  assert.equal(samples[1].elements[0].text, 'Score: 0'); assert.equal(samples[1].elements[2].text, '[false]'); assert.equal(samples[1].elements[3].text, '[]');
  await evidence('scalar-semantics', f, { sourcePlan: plan, samples, nativeStdout: result.stdout, nativeStderr: result.stderr });
});

test('native HUD stays screen-anchored through camera movement, real viewport resize and scene re-entry', native, async t => {
  const plan = cameraProject(); cameraOn(plan, 0, { mode: 'follow', targetInstanceId: plan.scenes[0].actors[1].instanceId, offset: [-24, 16], zoom: 2 });
  for (const scene of plan.scenes) for (const actor of scene.actors) { actor.controls = 'none'; actor.speed = 0; }
  hudOn(plan, 0); const f = await prepare(t, plan), { result, samples } = await probe(f, `
func run_project_smoke() -> void:
\tshared_state = {"score":12,"health":50}
\tstate_revision += 1
\tawait settled()
\tobserve("initial")
\tvar old_hud = weakref(current.get_node("VientoHUD2D"))
\tcurrent.actors[1].node.position += Vector2(700, -500)
\tawait settled()
\tobserve("camera-moved")
\tget_window().size = Vector2i(960, 540)
\tawait settled()
\tobserve("resized")
\tleave_scene("switch", "${plan.scenes[1].scene.objectId}")
\tenter_scene("${plan.scenes[1].scene.objectId}")
\tawait settled()
\tif old_hud.get_ref() != null:
\t\tpush_error("STALE_HUD_RETAINED")
\tobserve("unconfigured")
\tshared_state["score"] = 13
\tstate_revision += 1
\tleave_scene("switch", "${plan.scenes[0].scene.objectId}")
\tenter_scene("${plan.scenes[0].scene.objectId}")
\tawait settled()
\tobserve("revisited")
\tfinish_project()
`);
  assert.equal(samples.length, 5); for (const index of [0, 1, 2, 4]) viewMatches(samples[index], plan.scenes[0].hud2d.document);
  assert.deepEqual(samples[0].elements, samples[1].elements); assert.notDeepEqual(samples[0].worldOrigin, samples[1].worldOrigin);
  assert.notDeepEqual(samples[0].viewport, samples[2].viewport); assert.equal(samples[3].hudId, 0); assert.deepEqual(samples[3].elements, []);
  assert.notEqual(samples[0].hudId, samples[4].hudId); assert.equal(samples[4].elements[0].text, 'Score: 13'); assert.equal(samples[4].revision, 2);
  await evidence('camera-resize-visits', f, { sourcePlan: plan, samples, nativeStdout: result.stdout, nativeStderr: result.stderr });
});

async function authorHUD(t) {
  const author = await projectSharedStateAuthor(t), id = runtimeId(190), sourcePath = 'documents/projects/hud.json';
  const read = async file => JSON.parse(await fs.readFile(path.join(author.author, file))), write = async (file, value) => fs.writeFile(path.join(author.author, file), JSON.stringify(value, null, 2) + '\n');
  const elements = [hudLabel(), hudBar(), hudLabel(172, { anchor: 'top-right', offset: [-16, 16], content: { kind: 'state', key: 'truth', prefix: '[', suffix: ']', missing: '?' } })];
  const document = { format: 'viento-scene-hud2d', schemaVersion: 1, sceneObjectId: author.sceneIds[0], elements }; await write(sourcePath, document);
  const record = await read(`metadata/documents/${author.assemblyId}.json`);
  await write(`metadata/documents/${id}.json`, { ...record, id, sourcePath, relations: [{ kind: 'references', targetId: author.sceneIds[0], slot: 'scene' }] });
  const sceneRecord = await read(`metadata/documents/${author.sceneIds[0]}.json`); sceneRecord.relations.push({ kind: 'references', targetId: id, slot: 'hud2d' }); await write(`metadata/documents/${author.sceneIds[0]}.json`, sceneRecord);
  await fs.writeFile(path.join(author.author, 'documents/scripts/checkpoint.txt'), `extends Node
var project
func _ready() -> void:
\tproject = get_meta("viento_project")
\tproject.write_state("score", 0)
\tproject.write_state("truth", false)
\tproject.write_state("health", 50)
func update_values() -> void:
\tproject.write_state("score", 1.2345)
\tproject.write_state("truth", true)
\tproject.write_state("health", 75)
`);
  await fs.writeFile(path.join(author.author, 'documents/scripts/second.txt'), 'extends Node\n');
  return { ...author, hudDocument: document };
}
test('native Xvfb HUD pixels survive camera transforms and resize and display authored state at the frozen render boundary', { ...native, skip: !executable || !process.env.VIENTO_XVFB_TEST ? 'Set VIENTO_GODOT_BIN and VIENTO_XVFB_TEST under isolated Xvfb' : false }, async t => {
  const author = await authorHUD(t), captured = await captureBuildSnapshot(author.author, author.assemblyId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const plan = structuredClone(captured.plan); cameraOn(plan, 0, { mode: 'follow', targetInstanceId: plan.scenes[0].actors[0].instanceId, offset: [0, 0], zoom: 2 });
  const f = await prepare(t, plan, captured.resources), output = process.env.VIENTO_HUD2D_EVIDENCE_DIR || path.join(f.directory, 'captures'); await fs.mkdir(output, { recursive: true });
  const screenshots = Object.fromEntries(['initial', 'camera-moved', 'resized', 'frozen-update'].map(name => [name, path.join(output, name + '.png')]));
  const { result, samples } = await probe(f, `
func snap(label: String, destination: String) -> void:
\tawait RenderingServer.frame_post_draw
\tobserve(label)
\tif get_viewport().get_texture().get_image().save_png(destination) != OK:
\t\tget_tree().quit(1)
func run_project_smoke() -> void:
\tawait settled()
\tawait snap("initial", ${JSON.stringify(screenshots.initial)})
\tcurrent.actors[0].node.position += Vector2(700, -500)
\tawait settled()
\tawait snap("camera-moved", ${JSON.stringify(screenshots['camera-moved'])})
\tget_window().size = Vector2i(960, 540)
\tawait settled()
\tawait snap("resized", ${JSON.stringify(screenshots.resized)})
\tvar behavior = current.find_child("behavior_${author.firstBindingId.replaceAll('-', '_')}", true, false)
\tbehavior.update_values()
\tcurrent.process_mode = Node.PROCESS_MODE_DISABLED
\tawait snap("frozen-update", ${JSON.stringify(screenshots['frozen-update'])})
\tfinish_project()
`, { window: true });
  assert.equal(samples.length, 4); samples.forEach(sample => viewMatches(sample, author.hudDocument));
  assert.deepEqual(samples[0].elements, samples[1].elements); assert.notDeepEqual(samples[0].worldOrigin, samples[1].worldOrigin);
  assert.equal(samples[0].revision, 3); assert.equal(samples[0].elements[0].text, 'Score: 0'); assert.equal(samples[0].elements[2].text, '[false]');
  assert.equal(samples[3].revision, 6); assert.equal(samples[3].elements[0].text, 'Score: 1.235'); assert.equal(samples[3].elements[2].text, '[true]');
  const mutations = result.stdout.split('\n').flatMap(line => line.startsWith('VIENTO_EXECUTION_FRAME:')
    ? [JSON.parse(line.slice('VIENTO_EXECUTION_FRAME:'.length)).frame] : line.startsWith('VIENTO_PROJECT:') ? [JSON.parse(line.slice('VIENTO_PROJECT:'.length))] : []).filter(frame => frame.event === 'state');
  assert.equal(mutations.length, 6); assert.ok(mutations.every(frame => frame.bindingId === author.firstBindingId), 'only real author binding wrote shared state');
  const analysis = await runBuildProcess('python3', ['-c', `from PIL import Image\nimport json,sys\nout={}\nfor name in sys.argv[1:]:\n im=Image.open(name).convert('RGB'); pts=[(x,y) for y in range(im.height) for x in range(im.width) if im.getpixel((x,y))==(32,208,128)]\n if not pts: raise Exception('No HUD fill color '+name)\n out[name]={'size':list(im.size),'bounds':[min(x for x,y in pts),min(y for x,y in pts),max(x for x,y in pts)+1,max(y for x,y in pts)+1],'pixels':len(pts)}\nprint(json.dumps(out))`, ...Object.values(screenshots)], { timeoutMs: 30000 });
  succeeded(analysis); const pixels = JSON.parse(analysis.stdout);
  Object.values(screenshots).forEach((file, index) => { const bar = samples[index].elements[1], fill = pixels[file]; assert.deepEqual(fill.size, samples[index].viewport);
    assert.deepEqual(fill.bounds, [bar.position[0], bar.position[1], bar.position[0] + bar.fillSize[0], bar.position[1] + bar.fillSize[1]]); assert.equal(fill.pixels, bar.fillSize[0] * bar.fillSize[1]); });
  await evidence('window-author-state', f, { sourcePlan: plan, samples, stateMutationCount: mutations.length, mutations, pixels, screenshots: Object.fromEntries(await Promise.all(Object.entries(screenshots).map(async ([name, file]) => [name, { name: path.basename(file), sha256: hash(await fs.readFile(file)) }]))), nativeStdout: result.stdout, nativeStderr: result.stderr, renderer: 'Real Xvfb window; llvmpipe is software GL, not hardware GPU evidence' });
});
async function treeHashes(directory) {
  const rows = (await fs.readdir(directory, { recursive: true, withFileTypes: true })).filter(row => row.isFile()).map(row => path.join(row.parentPath, row.name)).sort();
  return Object.fromEntries(await Promise.all(rows.map(async file => [path.relative(directory, file), hash(await fs.readFile(file))])));
}
test('HUD project ZIP retains authored label/bar and runs offline after original author and build paths disappear', native, async t => {
  const author = await authorHUD(t), before = await treeHashes(author.author), output = path.join(author.temporary, 'build');
  const built = await buildProject({ root: author.author, targetId: author.assemblyId, tool: executable, output, timeoutMs: 60000 });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built)); assert.equal(built.record.backend.version, '0.47.0');
  const snapshot = JSON.parse(await fs.readFile(path.join(output, 'snapshot.json'))), generated = await adapter.generate(snapshot.plan), inspect = () => inspectBackendProject({ buildDirectory: output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect }), zip = path.join(author.temporary, 'hud-project.zip');
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
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, `scenes/${author.sceneIds[0]}/hud2d.json`))), author.hudDocument);
  for (const phase of [...adapter.buildPhases, 'run']) { const result = await adapter.executePhase({ phase, tool: f.tool, directory: f.directory, timeoutMs: 60000 }); succeeded(result); phases.push({ phase, ...result }); }
  const { result, samples } = await probe(f, '\nfunc run_project_smoke() -> void:\n\tawait settled()\n\tobserve("offline-HUD")\n\tfinish_project()\n');
  assert.equal(samples.length, 1); viewMatches(samples[0], author.hudDocument); assert.equal(samples[0].revision, 3); assert.equal(samples[0].elements[0].text, 'Score: 0');
  assert.deepEqual(await treeHashes(author.author + '.offline'), before);
  const evidenceDirectory = process.env.VIENTO_HUD2D_EVIDENCE_DIR; if (evidenceDirectory) { await fs.mkdir(evidenceDirectory, { recursive: true }); await fs.copyFile(zip, path.join(evidenceDirectory, 'hud-project.zip')); }
  await evidence('offline-delivery', f, { sourcePlan: snapshot.plan, authorHashes: before, authorAfter: await treeHashes(author.author + '.offline'), originalPathsUnavailable: true,
    zip: { bytes: (await fs.stat(zip)).size, sha256: hash(await fs.readFile(zip)), verification: verified }, phases, samples, nativeStdout: result.stdout, nativeStderr: result.stderr });
});
