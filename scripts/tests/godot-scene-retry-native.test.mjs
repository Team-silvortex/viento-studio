import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT } from '../../engine/godot-scene-retry-script.mjs';
import { parseProjectSceneRetryStateValues } from '../../engine/project-scene-retry-diagnostics.mjs';
import { godotSceneRetryAuthor } from './helpers/godot-scene-retry-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';

const executable = process.env.VIENTO_GODOT_BIN;
const native = { skip: !executable ? 'Set VIENTO_GODOT_BIN for native scene retry' : false, timeout: 180000 };
const windowNative = { ...native, skip: !executable || !process.env.VIENTO_XVFB_TEST ? 'Set VIENTO_GODOT_BIN and VIENTO_XVFB_TEST under isolated Xvfb for XTest retry evidence' : false };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const succeeded = result => { assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.doesNotMatch(result.stdout + result.stderr, /(?:SCRIPT ERROR:|ERROR:)/); };
const envFor = directory => ({ ...process.env, GODOT_SILENCE_ROOT_WARNING: '1', XDG_DATA_HOME: path.join(directory, '.retry/data'), XDG_CONFIG_HOME: path.join(directory, '.retry/config'), XDG_CACHE_HOME: path.join(directory, '.retry/cache') });
const sourceNames = ['engine/godot-scene-retry-script.mjs', 'engine/project-scene-retry-diagnostics.mjs', 'engine/script-authoring.mjs', 'scripts/backends/godot4/retry-project-runtime.gd', 'scripts/backends/godot4-scene-retry.mjs', 'scripts/backends/godot4-scene-retry-projection.mjs', 'scripts/backends/godot4-scene-retry-inventory.mjs', 'scripts/backends/godot4-adapter.mjs', 'scripts/adapters/node-project-build.mjs', 'scripts/lib/project-build-service.mjs', 'scripts/tests/godot-scene-retry-native.test.mjs', 'scripts/tests/helpers/godot-scene-retry-author-fixture.mjs', 'scripts/tests/helpers/retry-keyboard.py'];
async function sourceHashes() { return Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, hash(await fs.readFile(name))]))); }
async function evidence(name, value) {
  const output = process.env.VIENTO_SCENE_RETRY_EVIDENCE_DIR; if (!output) return;
  const resolved = path.resolve(output), topic = path.resolve('docs/test-results/scene-retry');
  assert.ok(resolved.startsWith(topic + path.sep), 'Use a new directory in the scene-retry evidence topic');
  await fs.mkdir(resolved, { recursive: true });
  await fs.writeFile(path.join(resolved, name + '.json'), JSON.stringify({ sources: await sourceHashes(), ...value }, null, 2) + '\n');
}
async function prepareAuthor(t) {
  const f = await godotSceneRetryAuthor(t), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = await adapter.generate(captured.plan), directory = path.join(f.temporary, 'generated');
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([id, name]) => [name, captured.resources.get(id)])]) {
    const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
  }
  assert.ok(generated.files.has('retry-project-runtime.gd')); assert.ok(generated.files.has('retry-project.tscn'));
  const tool = await adapter.identify(executable);
  for (const phase of adapter.buildPhases) succeeded(await adapter.executePhase({ phase, directory, tool, timeoutMs: 60000 }));
  return { ...f, captured, generated, directory, tool };
}
async function unchanged(f) { for (const [name, bytes] of f.generated.files) assert.deepEqual(await fs.readFile(path.join(f.directory, name)), bytes, name); }
function readEvents(f, stdout) {
  const reader = adapter.createEventReader(f.captured.plan, { capabilities: f.generated.backend.capabilities }); reader.push(stdout);
  const received = reader.finish(); assert.deepEqual(received.diagnostics, [], JSON.stringify(received.diagnostics)); return { received, reader };
}
const printed = (stdout, prefix) => stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
async function installProbe(f, source, name = 'retry-probe') {
  await fs.writeFile(path.join(f.directory, name + '.gd'), source);
  await fs.writeFile(path.join(f.directory, name + '.tscn'), `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${name}.gd" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n`);
  return async () => { for (const suffix of ['.gd', '.gd.uid', '.tscn']) await fs.rm(path.join(f.directory, name + suffix), { force: true }); };
}

const parserCases = [
  { text: '{}', accepted: true },
  { text: '{"flag":true,"other":false,"score":-0,"health":1.25,"level":1e2,"note":"雨 🔑"}', accepted: true },
  { text: '{"sco\\u0072e":0,"note":"\\ud83d\\udd11"}', accepted: true },
  { text: '{"score":0,"sco\\u0072e":1}', accepted: false },
  { text: '\ufeff{"score":0}', accepted: false },
  { text: '{"score":0,}', accepted: false },
  { text: '{"score":01}', accepted: false },
  { text: '{"score":1.}', accepted: false },
  { text: '{"score":1e1000}', accepted: false },
  { text: '{"note":"\\ud800"}', accepted: false },
  { text: '{"note":"\\udc00"}', accepted: false },
  { text: '{"score":[]}', accepted: false },
  { text: '{"score":{}}', accepted: false },
  { text: '{"score":null}', accepted: false },
  { text: '[]', accepted: false },
  { text: JSON.stringify(Object.fromEntries(Array.from({ length: 17 }, (_, i) => ['k' + i, i]))), accepted: false },
  { text: '{"note":"' + '雨'.repeat(1400) + '"}', accepted: false },
];

test('native retry parser and generated host preserve atomic refusal, copied reservations, merged state and finish precedence', native, async t => {
  const sourcesBefore = await sourceHashes(), f = await prepareAuthor(t);
  const parserExpected = parserCases.map(row => { try { return { accepted: true, value: parseProjectSceneRetryStateValues(row.text) }; } catch { return { accepted: false, value: null }; } });
  assert.deepEqual(parserExpected.map(row => row.accepted), parserCases.map(row => row.accepted));
  const source = `extends "res://retry-project-runtime.gd"
func _ready() -> void:
\tsuper._ready()
\tcall_deferred("check_contract")
func check_contract() -> void:
\tvar action = load("res://behaviors/${f.scriptId}.gd").new()
\tvar parser_results: Array = []
\tfor row in ${JSON.stringify(parserCases)}:
\t\tvar parsed = action._parse_initial_values(row["text"])
\t\tassert((parsed != null) == row["accepted"], "retry parser case differs: " + row["text"])
\t\tparser_results.append({"accepted":parsed != null,"value":parsed})
\taction.free()
\tvar behavior = current.find_child("behavior_${f.firstBindingId.replaceAll('-', '_')}", true, false)
\tvar port = behavior.get_meta("viento_project")
\tvar retry = behavior.get_meta("viento_project_retry")
\tvar mode := "commit"
\tfor argument in OS.get_cmdline_user_args():
\t\tif argument.begins_with("--retry-case="):
\t\t\tmode = argument.trim_prefix("--retry-case=")
\tvar before := shared_state.duplicate()
\tvar revision := state_revision
\tvar budget = execution_budget.snapshot()
\tvar refusals := [not retry.request_retry(current_scene, {"score":0}), not retry.request_retry("12345678-1234-4234-8234-123456789fff", {"score":0}), not retry.request_retry(${JSON.stringify(f.gameId)}, {"bad key":0}), not retry.request_retry(${JSON.stringify(f.gameId)}, {"score":[]})]
\tfor answer in refusals:
\t\tassert(answer, "retry refusal was accepted")
\tassert(shared_state == before and state_revision == revision and pending_scene == "" and retry_pending.is_empty() and execution_budget.snapshot() == budget, "refusal changed host state")
\tif mode in ["reserved-budget", "reserved-capacity"]:
\t\tif mode == "reserved-budget":
\t\t\tfor i in range(1022):
\t\t\t\tassert(port.write_state("counter", i))
\t\telse:
\t\t\tfor i in range(62):
\t\t\t\tassert(port.write_state("k" + str(i), i))
\t\tbefore = shared_state.duplicate()
\t\trevision = state_revision
\t\tvar values = {"counter":0} if mode == "reserved-budget" else {"extra":0}
\t\tassert(retry.request_retry(${JSON.stringify(f.gameId)}, values), "last available reservation refused")
\t\tassert(shared_state == before and state_revision == revision, "reservation committed early")
\t\tassert(port.write_state("counter", 1021) if mode == "reserved-budget" else port.write_state("progress", "menu-seed"), "no-op write lost reserved capacity")
\t\tvar changed = port.write_state("progress", "overrun") if mode == "reserved-budget" else port.write_state("late", 1)
\t\tassert(not changed and failed and shared_state == before and state_revision == revision, "old write exceeded a retry reservation or partially committed defaults")
\telif mode == "capacity":
\t\tfor i in range(63):
\t\t\tassert(port.write_state("k" + str(i), i))
\t\tbefore = shared_state.duplicate()
\t\trevision = state_revision
\t\tbudget = execution_budget.snapshot()
\t\tassert(not retry.request_retry(${JSON.stringify(f.gameId)}, {"extra":0}), "65th merged key was accepted")
\t\tassert(shared_state == before and state_revision == revision and retry_pending.is_empty() and pending_scene == "" and execution_budget.snapshot() == budget, "capacity refusal was not atomic")
\telif mode == "budget":
\t\tfor i in range(1023):
\t\t\tassert(port.write_state("counter", i))
\t\tbefore = shared_state.duplicate()
\t\trevision = state_revision
\t\tbudget = execution_budget.snapshot()
\t\tassert(not retry.request_retry(${JSON.stringify(f.gameId)}, {"counter":0}), "exhausted mutation budget was accepted")
\t\tassert(shared_state == before and state_revision == revision and retry_pending.is_empty() and pending_scene == "" and execution_budget.snapshot() == budget, "budget refusal was not atomic")
\telse:
\t\tassert(port.write_state("score", 75) and port.write_state("health", 12))
\t\tbefore = shared_state.duplicate()
\t\trevision = state_revision
\t\tvar values = {"score":0,"health":100,"key_found":false,"level":1}
\t\tassert(retry.request_retry(${JSON.stringify(f.gameId)}, values), "valid retry refused")
\t\tvalues["score"] = 999
\t\tassert(shared_state == before and state_revision == revision and retry_pending["values"]["score"] == 0, "acceptance mutated state or retained caller dictionary")
\t\tassert(not retry.request_retry(${JSON.stringify(f.failureId)}, {"score":99}), "pending retry did not exclude a second request")
\t\tassert(not port.request_scene(${JSON.stringify(f.failureId)}), "ordinary competing scene request was accepted")
\t\tif mode == "finish":
\t\t\tfinish_project()
\t\t\tassert(shared_state == before and state_revision == revision and retry_pending.is_empty() and not retry.request_retry(${JSON.stringify(f.gameId)}, {}), "finish committed a cancelled retry")
\t\telse:
\t\t\tassert(port.write_state("progress", "after-accept"))
\t\t\tassert(port.write_state("score", 33))
\t\t\tflush_requests()
\t\t\tassert(current_scene == ${JSON.stringify(f.gameId)} and visit_index == 2, "retry did not enter target exactly once")
\t\t\tassert(shared_state == {"score":0,"health":100,"key_found":false,"level":1,"progress":"after-accept"}, "retry failed to merge copied defaults and preserved progress")
\t\t\tassert(not is_instance_valid(behavior), "old behavior survived retry")
\t\t\tassert(port.read_state("score") == null and not port.write_state("score", 999) and not port.erase_state("score") and not port.publish_event("game.audit", true) and not port.request_scene(${JSON.stringify(f.menuId)}) and not retry.request_retry(${JSON.stringify(f.menuId)}, {}), "old visit retained authority")
\tprint("RETRY_CONTRACT:" + JSON.stringify({"mode":mode,"parser":parser_results,"refusals":refusals,"state":shared_state,"revision":state_revision,"budget":execution_budget.snapshot(),"pending":retry_pending}))
\tif not finished and not failed:
\t\tfinish_project()
`;
  const remove = await installProbe(f, source, 'retry-contract'), results = [];
  try {
    for (const mode of ['commit', 'finish', 'capacity', 'budget', 'reserved-budget', 'reserved-capacity']) {
      const result = await runBuildProcess(executable, ['--path', f.directory, '--headless', 'res://retry-contract.tscn', '--', '--retry-case=' + mode], { cwd: f.directory, env: envFor(f.directory), timeoutMs: 45000 });
      const reader = adapter.createEventReader(f.captured.plan, { capabilities: f.generated.backend.capabilities }); reader.push(result.stdout); const received = reader.finish(), rows = printed(result.stdout, 'RETRY_CONTRACT:');
      if (mode.startsWith('reserved-')) {
        assert.equal(result.status, 'failed'); assert.ok(received.diagnostics.some(row => row.code === 'runtime_behavior_state_limit' && row.bindingId === f.firstBindingId), JSON.stringify(received.diagnostics));
        assert.ok(!received.diagnostics.some(row => row.code === 'runtime_project_protocol_invalid')); assert.ok(!received.events.some(row => row.event === 'finished'));
      } else { succeeded(result); assert.deepEqual(received.diagnostics, []); assert.equal(received.events.at(-1).event, 'finished'); }
      assert.equal(rows.length, 1); assert.equal(rows[0].mode, mode); assert.ok(rows[0].refusals.every(Boolean));
      assert.deepEqual(rows[0].parser, parserExpected, 'Godot parser and author preflight disagree');
      const visits = received.events.filter(row => row.event === 'scene-enter'); assert.equal(visits.length, mode === 'commit' ? 2 : 1);
      results.push({ mode, ...rows[0], events: received.events, diagnostics: received.diagnostics, nativeStdout: result.stdout, nativeStderr: result.stderr });
    }
  } finally { await remove(); }
  await unchanged(f); assert.deepEqual(await sourceHashes(), sourcesBefore);
  await evidence('controlled-contracts', { scope: 'Real generated host and actual visit ports; direct API/parser probes, no OS keyboard claim', parserCases, sourceProbe: source, results, sourceBefore: sourcesBefore, sourceAfter: await sourceHashes(), tool: f.tool });
});

async function keyboardProbe(f, output) {
  await fs.mkdir(output, { recursive: true });
  const bindings = { [f.menuId]: f.firstBindingId, [f.gameId]: f.secondBindingId, [f.failureId]: f.thirdBindingId };
  const source = `extends "res://retry-project-runtime.gd"
var gui_button: Button
var gui_count := 0
var sample_tick := 0
const NAV_BINDINGS = ${JSON.stringify(bindings)}
func _ready() -> void:
\tsuper._ready()
\tvar layer := CanvasLayer.new()
\tlayer.layer = 2
\tgui_button = Button.new()
\tgui_button.text = "Test GUI consumes retry keys"
\tgui_button.position = Vector2(280, 350)
\tgui_button.size = Vector2(360, 48)
\tgui_button.gui_input.connect(_consume_gui)
\tlayer.add_child(gui_button)
\tadd_child(layer)
\tgui_button.grab_focus()
func _consume_gui(event: InputEvent) -> void:
\tif event.is_action("retry_game"):
\t\tif event.is_pressed() and not event.is_echo():
\t\t\tgui_count += 1
\t\tgui_button.accept_event()
\t\tprint("RETRY_GUI_HANDLED:" + JSON.stringify({"pressed":event.is_pressed(),"handled":get_viewport().is_input_handled()}))
func _input(event: InputEvent) -> void:
\tif event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_F8:
\t\tgui_button.hide()
\t\tget_viewport().set_input_as_handled()
func enter_scene(scene_id: String) -> void:
\tsuper.enter_scene(scene_id)
\tvar ids: Array = []
\tfor behavior in current.find_children("behavior_*", "", true, false):
\t\tids.append(behavior.get_instance_id())
\tprint("RETRY_ENTER_SNAPSHOT:" + JSON.stringify({"sceneId":scene_id,"visit":visit_index,"state":shared_state,"actors":current.states(),"actorId":current.actors[0]["node"].get_instance_id(),"behaviorIds":ids,"hudId":current.get_node("VientoHUD2D").get_instance_id()}))
\tcall_deferred("capture_visit", visit_index, scene_id)
func leave_scene(reason: String, next_scene: String = "") -> void:
\tvar retained: Array = []
\tfor behavior in current.find_children("behavior_*", "", true, false):
\t\tretained.append({"node":weakref(behavior),"port":behavior.get_meta("viento_project"),"retry":behavior.get_meta("viento_project_retry")})
\tvar hud = weakref(current.get_node("VientoHUD2D"))
\tvar actor = weakref(current.actors[0]["node"])
\tvar visit := visit_index
\tsuper.leave_scene(reason, next_scene)
\tvar before := shared_state.duplicate()
\tvar revision := state_revision
\tvar checks: Array = []
\tfor row in retained:
\t\tvar port = row["port"]
\t\tvar retry = row["retry"]
\t\tchecks.append(row["node"].get_ref() == null and port.read_state("score") == null and not port.write_state("score", 999) and not port.erase_state("score") and not port.publish_event("game.audit", true) and not port.request_scene(${JSON.stringify(f.menuId)}) and not retry.request_retry(${JSON.stringify(f.gameId)}, {"score":999}))
\tvar unchanged := before == shared_state and revision == state_revision
\tassert(hud.get_ref() == null and actor.get_ref() == null and unchanged, "retry visit retained actor/HUD/state authority")
\tfor answer in checks:
\t\tassert(answer, "stale behavior or port retained authority")
\tprint("RETRY_STALE_PORTS:" + JSON.stringify({"visit":visit,"checks":checks,"hudFreed":hud.get_ref() == null,"actorFreed":actor.get_ref() == null,"stateUnchanged":unchanged}))
func capture_visit(visit: int, scene_id: String) -> void:
\tawait RenderingServer.frame_post_draw
\tif current != null and visit_index == visit and current_scene == scene_id:
\t\tget_viewport().get_texture().get_image().save_png(${JSON.stringify(output.replaceAll('\\', '/'))} + "/visit-" + str(visit) + ".png")
func _process(delta: float) -> void:
\tsuper._process(delta)
\tif current == null:
\t\treturn
\tsample_tick += 1
\tif sample_tick % 3 != 0:
\t\treturn
\tvar hud = current.get_node("VientoHUD2D")
\tvar texts: Array = []
\tfor row in hud.rows:
\t\ttexts.append(row["label"].text)
\tvar gameplay = current.find_child("behavior_${f.publisherBindingId.replaceAll('-', '_')}", true, false)
\tvar nav = current.find_child("behavior_" + NAV_BINDINGS[current_scene].replace("-", "_"), true, false)
\tvar action: bool = nav.has_method("_on_focus_entered")
\tprint("RETRY_SAMPLE:" + JSON.stringify({"sceneId":current_scene,"visit":visit_index,"state":shared_state,"revision":state_revision,"position":current.states()[0]["position"],"actorId":current.actors[0]["node"].get_instance_id(),"gameBehaviorId":gameplay.get_instance_id() if gameplay != null else 0,"ticks":gameplay.ticks if gameplay != null else 0,"audits":gameplay.audits if gameplay != null else 0,"subscriptions":event_bus.subscriptions.size(),"hudId":hud.get_instance_id(),"hudText":texts,"actionDown":Input.is_action_pressed("retry_game"),"focused":get_window().has_focus(),"armed":nav.get("_armed") if action else false,"guiCount":gui_count,"guiOpen":gui_button.visible if gui_button != null else false,"budget":execution_budget.snapshot()}, "", true, true))
`;
  const remove = await installProbe(f, source); let result;
  try {
    result = await runBuildProcess('python3', [new URL('./helpers/retry-keyboard.py', import.meta.url).pathname, executable, f.directory, output], { cwd: f.directory, env: envFor(f.directory), timeoutMs: 70000 });
  } finally { await remove(); }
  succeeded(result);
  const data = JSON.parse(result.stdout.trim().split('\n').at(-1)), stdout = await fs.readFile(path.join(output, 'window-output.log'), 'utf8');
  const { received, reader } = readEvents(f, stdout), visits = received.events.filter(row => row.event === 'scene-enter');
  assert.deepEqual(visits.map(row => row.sceneId), [f.menuId, f.gameId, f.failureId, f.gameId]);
  assert.deepEqual(visits.map(row => row.visitIndex), [1, 2, 3, 4]); assert.equal(received.events.at(-1).event, 'finished');
  const stale = printed(stdout, 'RETRY_STALE_PORTS:'); assert.equal(stale.length, 4);
  assert.ok(stale.every(row => row.actorFreed && row.hudFreed && row.stateUnchanged && row.checks.every(Boolean)));
  const enters = printed(stdout, 'RETRY_ENTER_SNAPSHOT:'), gameVisits = enters.filter(row => row.sceneId === f.gameId);
  assert.equal(gameVisits.length, 2); assert.deepEqual(gameVisits[0].actors[0].position, f.gameInitialPosition); assert.deepEqual(gameVisits[1].actors[0].position, f.gameInitialPosition);
  for (const key of ['actorId', 'hudId']) assert.notEqual(gameVisits[0][key], gameVisits[1][key]);
  assert.ok(gameVisits[0].behaviorIds.every(id => !gameVisits[1].behaviorIds.includes(id)));
  assert.deepEqual(gameVisits[1].state, { ...f.initialValues, progress: 'checkpoint-7' });
  const first = data.samples.find(row => row.visit === 2), reset = data.samples.find(row => row.visit === 4);
  assert.equal(first.subscriptions, 2); assert.equal(reset.subscriptions, 2); assert.equal(reset.audits, 0);
  assert.deepEqual(reset.hudText.slice(1), ['level: 1', 'score: 0', 'health: 100', 'key_found: false']);
  for (const key of Object.keys(first.budget)) assert.ok(reset.budget[key] >= first.budget[key], key + ' admission counter reset');
  const publications = received.events.filter(row => row.event === 'event-publish'); assert.equal(publications.length, 3); assert.ok(publications.every(row => row.bindingId === f.publisherBindingId && row.visitIndex === 2));
  const deliveries = received.events.filter(row => row.event === 'event-delivery'); assert.equal(deliveries.length, 3); assert.ok(deliveries.every(row => row.status === 'handled' && row.visitIndex === 2));
  const retryChanges = received.events.filter(row => row.event === 'state' && row.bindingId === f.thirdBindingId);
  assert.deepEqual(retryChanges.map(row => row.key), ['health', 'key_found', 'level', 'score']); assert.ok(retryChanges.every(row => row.visitIndex === 3));
  assert.equal(reader.sharedState.lastChange.origin.bindingId, f.thirdBindingId);
  const screenshots = {};
  for (const visit of [1, 2, 3, 4]) { const name = `visit-${visit}.png`; screenshots[name] = hash(await fs.readFile(path.join(output, name))); }
  await unchanged(f);
  return { data, received, projectEvents: reader.projectEvents, staleVisits: stale, enters, nativeStdout: stdout, sourceProbe: source, screenshots };
}

test('XTest window retries Failure→Game with declared state defaults, preserved progress and fresh actors, behaviors and HUD', windowNative, async t => {
  const sourcesBefore = await sourceHashes(), f = await prepareAuthor(t);
  const output = process.env.VIENTO_SCENE_RETRY_EVIDENCE_DIR ? path.join(process.env.VIENTO_SCENE_RETRY_EVIDENCE_DIR, 'keyboard') : path.join(f.temporary, 'keyboard');
  const result = await keyboardProbe(f, output); assert.deepEqual(await sourceHashes(), sourcesBefore);
  await evidence('keyboard-flow', { ...result, sourcePlan: f.captured.plan, tool: f.tool, generatedFiles: Object.fromEntries([...f.generated.files].map(([name, bytes]) => [name, hash(bytes)])), sourceBefore: sourcesBefore, sourceAfter: await sourceHashes(), scope: 'Different-member retry; four declared defaults reset, unrelated progress and finite-session counters preserved. No current-scene restart or fresh-session claim.' });
});

async function treeHashes(directory) {
  const rows = (await fs.readdir(directory, { recursive: true, withFileTypes: true })).filter(row => row.isFile()).map(row => path.join(row.parentPath || row.path, row.name)).sort();
  return Object.fromEntries(await Promise.all(rows.map(async file => [path.relative(directory, file), hash(await fs.readFile(file))])));
}

test('verified offline project ZIP runs the same retry keyboard path after original author and build paths are unavailable', windowNative, async t => {
  const sourcesBefore = await sourceHashes(), author = await godotSceneRetryAuthor(t), before = await treeHashes(author.author), output = path.join(author.temporary, 'build');
  const built = await buildProject({ root: author.author, targetId: author.assemblyId, tool: executable, output, timeoutMs: 60000 }); assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  const snapshot = JSON.parse(await fs.readFile(path.join(output, 'snapshot.json'))), generated = await adapter.generate(snapshot.plan), inspect = () => inspectBackendProject({ buildDirectory: output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect }), zip = path.join(author.temporary, 'retry-project.zip');
  await writeExportZip(delivery, zip); const verified = await verifyBackendProjectDelivery(zip), relocated = path.join(author.temporary, 'relocated'); await fs.mkdir(relocated);
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try {
    for await (const entry of archive.eachEntry()) {
      assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
      const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
      const file = path.join(relocated, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
    }
  } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  await fs.rename(author.author, author.author + '.offline'); await fs.rename(output, output + '.offline');
  await assert.rejects(fs.access(author.author), { code: 'ENOENT' }); await assert.rejects(fs.access(output), { code: 'ENOENT' });
  const f = { ...author, captured: { plan: snapshot.plan }, generated, directory: path.join(relocated, 'project'), tool: await adapter.identify(executable) }, phases = [];
  for (const id of [author.scriptId, author.thirdScriptId]) assert.equal(await fs.readFile(path.join(f.directory, `behaviors/${id}.gd`), 'utf8'), GODOT_ACTION_SCENE_RETRY_SCRIPT);
  for (const phase of [...adapter.buildPhases, 'run']) { const result = await adapter.executePhase({ phase, tool: f.tool, directory: f.directory, timeoutMs: 60000 }); succeeded(result); phases.push({ phase, ...result }); }
  const target = process.env.VIENTO_SCENE_RETRY_EVIDENCE_DIR ? path.join(process.env.VIENTO_SCENE_RETRY_EVIDENCE_DIR, 'offline-keyboard') : path.join(author.temporary, 'offline-keyboard');
  const result = await keyboardProbe(f, target); assert.deepEqual(await treeHashes(author.author + '.offline'), before); assert.deepEqual(await sourceHashes(), sourcesBefore);
  if (process.env.VIENTO_SCENE_RETRY_EVIDENCE_DIR) await fs.copyFile(zip, path.join(process.env.VIENTO_SCENE_RETRY_EVIDENCE_DIR, 'retry-project.zip'));
  await evidence('offline-delivery', { ...result, sourcePlan: snapshot.plan, tool: f.tool, phases, authorBefore: before, authorAfter: await treeHashes(author.author + '.offline'), originalPathsUnavailable: true, zip: { bytes: (await fs.stat(zip)).size, sha256: hash(await fs.readFile(zip)), verification: verified }, generatedFiles: Object.fromEntries([...generated.files].map(([name, bytes]) => [name, hash(bytes)])), sourceBefore: sourcesBefore, sourceAfter: await sourceHashes() });
});
