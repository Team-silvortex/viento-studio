import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GODOT_ACTION_SCENE_SWITCH_SCRIPT, GODOT_EVENT_SCENE_SWITCH_SCRIPT } from '../../engine/godot-scene-navigation-scripts.mjs';
import { godotSceneNavigationAuthor } from './helpers/godot-scene-navigation-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
import yauzl from 'yauzl';
const executable = process.env.VIENTO_GODOT_BIN;
const native = { skip: !executable ? 'Set VIENTO_GODOT_BIN for native scene navigation' : false, timeout: 180000 };
const windowNative = { ...native, skip: !executable || !process.env.VIENTO_XVFB_TEST ? 'Set VIENTO_GODOT_BIN and VIENTO_XVFB_TEST under isolated Xvfb for XTest keyboard evidence' : false };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const succeeded = result => { assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.doesNotMatch(result.stdout + result.stderr, /(?:SCRIPT ERROR:|ERROR:)/); };
const envFor = directory => ({ ...process.env, GODOT_SILENCE_ROOT_WARNING: '1', XDG_DATA_HOME: path.join(directory, '.probe/data'), XDG_CONFIG_HOME: path.join(directory, '.probe/config'), XDG_CACHE_HOME: path.join(directory, '.probe/cache') });
async function evidence(name, value) {
  const output = process.env.VIENTO_SCENE_NAVIGATION_EVIDENCE_DIR; if (!output) return;
  await fs.mkdir(output, { recursive: true }); const sources = {};
  for (const file of ['engine/godot-scene-navigation-scripts.mjs', 'scripts/tests/godot-scene-navigation-native.test.mjs', 'scripts/tests/helpers/godot-scene-navigation-author-fixture.mjs', 'scripts/tests/helpers/scene-navigation-keyboard.py']) sources[file] = hash(await fs.readFile(file));
  await fs.writeFile(path.join(output, name + '.json'), JSON.stringify({ scope: 'Ordinary author templates over existing project ports; no runtime protocol or generated GD changes', sources, ...value }, null, 2) + '\n');
}

test('native author navigation contracts handle held input, GUI consumption, echoes, focus, refusal retries and duplicate event deliveries', native, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-navigation-contract-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Navigation contract"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
  await fs.writeFile(path.join(directory, 'action.gd'), GODOT_ACTION_SCENE_SWITCH_SCRIPT); await fs.writeFile(path.join(directory, 'event.gd'), GODOT_EVENT_SCENE_SWITCH_SCRIPT);
  const source = `extends SceneTree
class Port extends RefCounted:
\tvar requests: Array = []
\tvar answers: Array = [false, true]
\tvar callback: Callable
\tvar unsubscriptions := 0
\tfunc request_scene(target: String) -> bool:
\t\trequests.append(target)
\t\treturn answers.pop_front() if not answers.is_empty() else true
\tfunc subscribe_event(_event: String, value: Callable) -> int:
\t\tcallback = value
\t\treturn 1
\tfunc unsubscribe_event(_token: int) -> bool:
\t\tunsubscriptions += 1
\t\treturn true
func _initialize() -> void:
\tcall_deferred("check")
func event(pressed: bool):
\tvar value := InputEventAction.new()
\tvalue.action = "navigation_test"
\tvalue.pressed = pressed
\treturn value
func edge(node, pressed: bool, handled: bool = false) -> void:
\tif pressed:
\t\tInput.action_press("navigation_test")
\telse:
\t\tInput.action_release("navigation_test")
\tvar value = event(pressed)
\tnode._input(value)
\tif not handled:
\t\tnode._unhandled_input(value)
func check() -> void:
\tInputMap.add_action("navigation_test")
\tInput.action_press("navigation_test")
\tvar port := Port.new()
\tvar action = preload("res://action.gd").new()
\taction.action_name = "navigation_test"
\taction.target_scene_id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
\taction.set_meta("viento_project", port)
\troot.add_child(action)
\taction._on_focus_entered()
\taction._process(0)
\tedge(action, true)
\tassert(port.requests.size() == 0, "initial held action fired")
\tedge(action, false)
\tedge(action, true, true)
\tedge(action, true)
\tassert(port.requests.size() == 0, "GUI-consumed edge or second mapped press fired")
\tvar echo := InputEventKey.new()
\techo.pressed = true
\techo.echo = true
\taction._input(echo)
\taction._unhandled_input(echo)
\tassert(port.requests.size() == 0, "echo fired")
\tedge(action, false)
\tInput.action_press("navigation_test")
\tvar pending = event(true)
\taction._input(pending)
\taction._on_focus_exited()
\taction._on_focus_entered()
\taction._unhandled_input(pending)
\taction._process(0)
\tassert(port.requests.size() == 0, "focus replayed a pending held edge")
\tedge(action, false)
\tedge(action, true)
\tassert(port.requests.size() == 1 and not action._accepted, "normal refusal was not preserved")
\tfor step in range(10):
\t\taction._process(0.016)
\tassert(port.requests.size() == 1, "idle retried a refused request")
\tedge(action, true)
\tassert(port.requests.size() == 1, "held action retried a refused request")
\tedge(action, false)
\tedge(action, true)
\tassert(port.requests.size() == 2 and action._accepted, "fresh edge did not retry once")
\tedge(action, false)
\tedge(action, true)
\tassert(port.requests.size() == 2, "accepted visit repeated")
\taction.free()
\tInput.action_release("navigation_test")
\tvar event_port := Port.new()
\tvar listener = preload("res://event.gd").new()
\tlistener.target_scene_id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
\tlistener.payload_filter = "win"
\tlistener.set_meta("viento_project", event_port)
\troot.add_child(listener)
\tassert(event_port.callback.call(false) == true)
\tassert(event_port.callback.call("lose") == true)
\tassert(event_port.requests.size() == 0, "filter accepted wrong scalar")
\tassert(event_port.callback.call("win") == true)
\tassert(event_port.requests.size() == 1 and not listener._accepted, "refusal caused callback failure")
\tawait process_frame
\tassert(event_port.requests.size() == 1, "event listener retried without a new event")
\tassert(event_port.callback.call("win") == true)
\tassert(event_port.callback.call("win") == true)
\tassert(event_port.requests.size() == 2 and listener._accepted, "duplicate event navigation was not ignored")
\tlistener.free()
\tassert(event_port.unsubscriptions == 1, "event subscription retained after exit")
\tprint("NAVIGATION_CONTRACT:" + JSON.stringify({"actionAttempts":port.requests.size(),"eventAttempts":event_port.requests.size(),"unsubscriptions":event_port.unsubscriptions,"scope":"Controlled InputEventAction/focus callbacks and fake visit-port contracts; not XTest"}))
\tquit()
`;
  await fs.writeFile(path.join(directory, 'contract.gd'), source);
  const result = await runBuildProcess(executable, ['--path', directory, '--headless', '--script', 'res://contract.gd'], { cwd: directory, env: envFor(directory), timeoutMs: 30000 }); succeeded(result);
  assert.match(result.stdout, /"actionAttempts":2/); assert.match(result.stdout, /"eventAttempts":2/);
  await evidence('controlled-contracts', { nativeStdout: result.stdout, nativeStderr: result.stderr, sourceProbe: source, tool: await adapter.identify(executable) });
});

async function prepareAuthor(t) {
  const f = await godotSceneNavigationAuthor(t), captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = await adapter.generate(captured.plan), directory = path.join(f.temporary, 'generated');
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([id, file]) => [file, captured.resources.get(id)])]) {
    const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
  }
  const tool = await adapter.identify(executable); for (const phase of adapter.buildPhases) succeeded(await adapter.executePhase({ phase, directory, tool, timeoutMs: 60000 }));
  return { ...f, captured, generated, directory, tool };
}
async function unchanged(f) { for (const [name, bytes] of f.generated.files) assert.deepEqual(await fs.readFile(path.join(f.directory, name)), bytes, name); }

async function keyboardProbe(f, output) {
  await fs.mkdir(output, { recursive: true });
  const bindings = { [f.sceneIds[0]]: f.firstBindingId, [f.sceneIds[1]]: f.secondBindingId, [f.sceneIds[2]]: f.thirdBindingId };
  const source = `extends "res://hud2d-project-runtime.gd"
var gui_button: Button
var gui_layer: CanvasLayer
var gui_count := 0
var sample_tick := 0
const NAV_BINDINGS = ${JSON.stringify(bindings)}
func _ready() -> void:
\tsuper._ready()
\tgui_layer = CanvasLayer.new()
\tgui_layer.layer = 2
\tgui_button = Button.new()
\tgui_button.text = "Test GUI consumes Enter / Space"
\tgui_button.position = Vector2(280, 80)
\tgui_button.size = Vector2(320, 48)
\tgui_button.gui_input.connect(_consume_gui)
\tgui_layer.add_child(gui_button)
\tadd_child(gui_layer)
\tgui_button.grab_focus()
func _consume_gui(event: InputEvent) -> void:
\tif event.is_action("menu_start"):
\t\tif event.is_pressed() and not event.is_echo():
\t\t\tgui_count += 1
\t\tgui_button.accept_event()
\t\tprint("NAV_GUI_HANDLED:" + JSON.stringify({"pressed":event.is_pressed(),"handled":get_viewport().is_input_handled()}))
func _input(event: InputEvent) -> void:
\tif event is InputEventKey:
\t\tvar nav = current.find_child("behavior_" + NAV_BINDINGS[current_scene].replace("-", "_"), true, false) if current != null else null
\t\tprint("NAV_INPUT:" + JSON.stringify({"key":event.physical_keycode,"pressed":event.pressed,"echo":event.echo,"sceneId":current_scene,"down":Input.is_action_pressed("menu_start"),"guiFocused":gui_button.has_focus() if gui_button != null else false,"armed":nav.get("_armed") if nav != null and nav.has_method("_on_focus_entered") else false,"candidate":nav.get("_candidate_event_id") if nav != null and nav.has_method("_on_focus_entered") else 0}))
\tif event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_F8:
\t\tgui_button.hide()
\t\tget_viewport().set_input_as_handled()
func enter_scene(scene_id: String) -> void:
\tsuper.enter_scene(scene_id)
\tcall_deferred("capture_visit", visit_index, scene_id)
func leave_scene(reason: String, next_scene: String = "") -> void:
\tvar nav = current.find_child("behavior_" + NAV_BINDINGS[current_scene].replace("-", "_"), true, false)
\tvar retained_port = nav.get_meta("viento_project")
\tvar old_node = weakref(nav)
\tvar visit = visit_index
\tsuper.leave_scene(reason, next_scene)
\tvar refused: bool = not retained_port.request_scene(${JSON.stringify(f.sceneIds[0])})
\tprint("NAV_STALE_PORT:" + JSON.stringify({"visit":visit,"refused":refused,"behaviorFreed":old_node.get_ref() == null}))
\tif not refused or old_node.get_ref() != null:
\t\tpush_error("Stale navigation visit retained authority")
func capture_visit(visit: int, scene_id: String) -> void:
\tawait RenderingServer.frame_post_draw
\tif current != null and visit_index == visit and current_scene == scene_id and visit <= 3:
\t\tget_viewport().get_texture().get_image().save_png(${JSON.stringify(output.replaceAll('\\', '/'))} + "/visit-" + str(visit) + ".png")
func _process(delta: float) -> void:
\tsuper._process(delta)
\tif current == null:
\t\treturn
\tsample_tick += 1
\tif sample_tick % 3 != 0:
\t\treturn
\tvar behavior = current.find_child("behavior_" + NAV_BINDINGS[current_scene].replace("-", "_"), true, false)
\tvar action: bool = behavior.has_method("_on_focus_entered")
\tvar hud = current.get_node_or_null("VientoHUD2D")
\tprint("NAV_SAMPLE:" + JSON.stringify({"sceneId":current_scene,"visit":visit_index,"actionDown":Input.is_action_pressed("menu_start"),"focused":get_window().has_focus(),"armed":behavior.get("_armed") if action else false,"accepted":behavior.get("_accepted"),"guiCount":gui_count,"guiOpen":gui_button.visible if gui_button != null else false,"hudId":hud.get_instance_id() if hud != null else 0,"hudText":hud.rows[0].label.text if hud != null else ""}, "", true, true))
`;
  const files = ['navigation-probe.gd', 'navigation-probe.gd.uid', 'navigation-probe.tscn'];
  await fs.writeFile(path.join(f.directory, files[0]), source);
  await fs.writeFile(path.join(f.directory, files[2]), '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://navigation-probe.gd" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n');
  let result;
  try { result = await runBuildProcess('python3', [new URL('./helpers/scene-navigation-keyboard.py', import.meta.url).pathname, executable, f.directory, output], { cwd: f.directory, env: envFor(f.directory), timeoutMs: 60000 }); }
  finally { for (const file of files) await fs.rm(path.join(f.directory, file), { force: true }); }
  succeeded(result); const data = JSON.parse(result.stdout.trim().split('\n').at(-1)), stdout = await fs.readFile(path.join(output, 'window-output.log'), 'utf8');
  const reader = adapter.createEventReader(f.captured.plan, { capabilities: f.generated.backend.capabilities }); reader.push(stdout); const received = reader.finish();
  assert.deepEqual(received.diagnostics, [], JSON.stringify(received.diagnostics));
  const visits = received.events.filter(frame => frame.event === 'scene-enter'); assert.deepEqual(visits.map(frame => frame.sceneId), [...f.sceneIds, ...f.sceneIds]);
  assert.deepEqual(visits.map(frame => frame.visitIndex), [1, 2, 3, 4, 5, 6]); assert.equal(received.events.at(-1).event, 'finished');
  const publications = received.events.filter(frame => frame.event === 'event-publish'); assert.equal(publications.length, 8);
  assert.ok(publications.every(frame => frame.bindingId === f.publisherBindingId));
  const stale = stdout.split("\n").filter(line => line.startsWith("NAV_STALE_PORT:")).map(line => JSON.parse(line.slice("NAV_STALE_PORT:".length)));
  assert.equal(stale.length, 6); assert.ok(stale.every(row => row.refused && row.behaviorFreed));
  const deliveries = received.events.filter(frame => frame.event === 'event-delivery'); assert.equal(deliveries.length, 8); assert.ok(deliveries.every(frame => frame.status === 'handled'));
  for (const row of reader.projectEvents.entries) { assert.equal(row.origin.source.objectId, f.secondManifestId); assert.equal(row.origin.source.propertyPath, "/bindings/1");
    assert.ok(row.deliveries.every(delivery => delivery.origin.bindingId === f.secondBindingId && delivery.origin.source.propertyPath === "/bindings/0")); }
  assert.ok(data.samples.every(sample => sample.hudId > 0)); assert.equal(new Set(data.samples.filter(sample => sample.visit === 1).map(sample => sample.hudId)).size, 1);
  const hudFirst = data.samples.find(sample => sample.visit === 1), hudReturn = data.samples.find(sample => sample.visit === 4); assert.notEqual(hudFirst.hudId, hudReturn.hudId);
  await unchanged(f);
  const screenshots = {}; for (const visit of [1, 2, 3]) { const file = path.join(output, `visit-${visit}.png`); screenshots[`visit-${visit}`] = { name: path.basename(file), sha256: hash(await fs.readFile(file)) }; }
  return { data, received, staleVisits: stale, projectEvents: reader.projectEvents, nativeStdout: stdout, sourceProbe: source, screenshots };
}
test('XTest real keyboard completes Menu→Game→Results with GUI consumption, focus, held-key re-entry and true event provenance', windowNative, async t => {
  const f = await prepareAuthor(t), output = process.env.VIENTO_SCENE_NAVIGATION_EVIDENCE_DIR ? path.join(process.env.VIENTO_SCENE_NAVIGATION_EVIDENCE_DIR, 'keyboard') : path.join(f.temporary, 'keyboard');
  const result = await keyboardProbe(f, output);
  await evidence('keyboard-flow', { ...result, sourcePlan: f.captured.plan, tool: f.tool, generatedFiles: Object.fromEntries([...f.generated.files].map(([name, bytes]) => [name, hash(bytes)])), contract: 'Existing HUD1, project input-map2 and runtime business protocol retained' });
});

async function treeHashes(directory) {
  const rows = (await fs.readdir(directory, { recursive: true, withFileTypes: true })).filter(row => row.isFile()).map(row => path.join(row.parentPath, row.name)).sort();
  return Object.fromEntries(await Promise.all(rows.map(async file => [path.relative(directory, file), hash(await fs.readFile(file))])));
}
test('three-scene navigation and HUD input-map project runs from a verified offline ZIP using the same XTest keyboard path', windowNative, async t => {
  const author = await godotSceneNavigationAuthor(t), before = await treeHashes(author.author), output = path.join(author.temporary, 'build');
  const built = await buildProject({ root: author.author, targetId: author.assemblyId, tool: executable, output, timeoutMs: 60000 });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  const snapshot = JSON.parse(await fs.readFile(path.join(output, 'snapshot.json'))), generated = await adapter.generate(snapshot.plan), inspect = () => inspectBackendProject({ buildDirectory: output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect }), zip = path.join(author.temporary, 'navigation-project.zip');
  await writeExportZip(delivery, zip); const verified = await verifyBackendProjectDelivery(zip), relocated = path.join(author.temporary, 'relocated'); await fs.mkdir(relocated);
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try { for await (const entry of archive.eachEntry()) {
    assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
    const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
    const file = path.join(relocated, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  await fs.rename(author.author, author.author + '.offline'); await fs.rename(output, output + '.offline');
  await assert.rejects(fs.access(author.author), { code: 'ENOENT' }); await assert.rejects(fs.access(output), { code: 'ENOENT' });
  const f = { ...author, captured: { plan: snapshot.plan }, generated, directory: path.join(relocated, 'project'), tool: await adapter.identify(executable) }, phases = [];
  assert.equal((await fs.readFile(path.join(f.directory, `behaviors/${author.scriptId}.gd`))).toString(), GODOT_ACTION_SCENE_SWITCH_SCRIPT);
  assert.equal((await fs.readFile(path.join(f.directory, `behaviors/${author.secondScriptId}.gd`))).toString(), GODOT_EVENT_SCENE_SWITCH_SCRIPT);
  for (const phase of [...adapter.buildPhases, 'run']) { const result = await adapter.executePhase({ phase, tool: f.tool, directory: f.directory, timeoutMs: 60000 }); succeeded(result); phases.push({ phase, ...result }); }
  const target = process.env.VIENTO_SCENE_NAVIGATION_EVIDENCE_DIR ? path.join(process.env.VIENTO_SCENE_NAVIGATION_EVIDENCE_DIR, 'offline-keyboard') : path.join(author.temporary, 'offline-keyboard');
  const result = await keyboardProbe(f, target); assert.deepEqual(await treeHashes(author.author + '.offline'), before);
  const evidenceDirectory = process.env.VIENTO_SCENE_NAVIGATION_EVIDENCE_DIR; if (evidenceDirectory) await fs.copyFile(zip, path.join(evidenceDirectory, 'navigation-project.zip'));
  await evidence('offline-delivery', { ...result, sourcePlan: snapshot.plan, tool: f.tool, phases, authorBefore: before, authorAfter: await treeHashes(author.author + '.offline'), originalPathsUnavailable: true,
    zip: { size: (await fs.stat(zip)).size, sha256: hash(await fs.readFile(zip)), verification: verified }, generatedFiles: Object.fromEntries([...generated.files].map(([name, bytes]) => [name, hash(bytes)])) });
});
