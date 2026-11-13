import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { GODOT_ACTION_SCENE_RESTART_SCRIPT } from '../../engine/godot-scene-restart-script.mjs';
import { godotSceneRestartAuthor, sceneRestartInventory, restartSample, restartId } from './helpers/godot-scene-restart-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';

const executable = process.env.VIENTO_GODOT_BIN;
const native = { skip: !executable ? 'Set VIENTO_GODOT_BIN for actual scene restart tests' : false, timeout: 240000 };
const windowNative = { ...native, skip: !executable || !process.env.VIENTO_XVFB_TEST ? 'Set VIENTO_GODOT_BIN and VIENTO_XVFB_TEST under isolated Xvfb for actual keyboard evidence' : false };
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceNames = ['engine/godot-scene-restart-script.mjs', 'engine/project-scene-restart-diagnostics.mjs', 'engine/project-runtime-events.mjs', 'engine/scene-restart-capability.mjs', 'engine/project-runtime-query.mjs', 'scripts/adapters/node-execution-backends.mjs', 'scripts/lib/project-build-service.mjs',
  'scripts/backends/godot4/restart-project-runtime.gd', 'scripts/backends/godot4-scene-restart.mjs', 'scripts/backends/godot4-scene-restart-projection.mjs',
  'scripts/backends/godot4-scene-restart-inventory.mjs', 'scripts/backends/godot4-adapter.mjs', 'scripts/tests/godot-scene-restart-native.test.mjs',
  'scripts/tests/helpers/godot-scene-restart-author-fixture.mjs', 'scripts/tests/helpers/scene-restart-observer.gd', 'scripts/tests/helpers/scene-restart-keyboard.py'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, hash(await fs.readFile(name))])));
const succeeded = result => { assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.doesNotMatch(result.stdout + result.stderr, /(?:SCRIPT ERROR:|ERROR:|RESTART_OBSERVER_ERROR:)/); };
const envFor = f => ({ ...process.env, LIBGL_ALWAYS_SOFTWARE: '1', GODOT_SILENCE_ROOT_WARNING: '1', XDG_DATA_HOME: path.join(f.temporary, 'xdg/data'), XDG_CONFIG_HOME: path.join(f.temporary, 'xdg/config'), XDG_CACHE_HOME: path.join(f.temporary, 'xdg/cache') });
const printed = (stdout, prefix) => stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
function evidenceDirectory() {
  const requested = process.env.VIENTO_SCENE_RESTART_EVIDENCE_DIR;
  if (!requested) return null;
  const resolved = path.resolve(requested), topic = path.resolve('docs/test-results/scene-restart');
  assert.ok(resolved.startsWith('/tmp/') || resolved.startsWith(topic + path.sep), 'Use /tmp or a fresh scene-restart evidence directory');
  return resolved;
}
async function evidence(name, value) {
  const directory = evidenceDirectory(); if (!directory) return;
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, name + '.json'), JSON.stringify(value, null, 2) + '\n');
}
async function unchanged(f) {
  for (const [name, bytes] of f.generated.files) assert.deepEqual(await fs.readFile(path.join(f.directory, name)), bytes, name);
}
async function prepare(t) {
  const f = await godotSceneRestartAuthor(t), before = await sceneRestartInventory(f.author), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = await adapter.generate(captured.plan), directory = path.join(f.temporary, 'generated');
  assert.ok(generated.backend.capabilities.includes('project.scene-restart'));
  assert.ok(generated.files.has('restart-project-runtime.gd'));
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([id, name]) => [name, captured.resources.get(id)])]) {
    const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
  }
  const tool = await adapter.identify(executable);
  for (const phase of adapter.buildPhases) succeeded(await adapter.executePhase({ phase, directory, tool, timeoutMs: 90000 }));
  return { ...f, before, captured, generated, directory, tool };
}
async function installProbe(f, name, source) {
  await fs.writeFile(path.join(f.directory, name + '.gd'), source);
  await fs.writeFile(path.join(f.directory, name + '.tscn'), `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${name}.gd" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n`);
  return async () => { for (const suffix of ['.gd', '.gd.uid', '.tscn']) await fs.rm(path.join(f.directory, name + suffix), { force: true }); };
}
function readEvents(f, stdout) {
  const reader = adapter.createEventReader(f.captured.plan, { capabilities: f.generated.backend.capabilities }); reader.push(stdout);
  return { reader, received: reader.finish() };
}

// These controlled direct-API probes exercise actual generated ports, teardown
// and admission services. They are separate from the read-only window observer.
test('native restart overlays atomically, preserves session budgets, revokes old ports and respects finish, capacity and 64-visit bounds', native, async t => {
  const sourceBefore = await sourceHashes(), canonicalBefore = await sceneRestartInventory(restartSample), f = await prepare(t);
  const source = `extends "res://restart-project-runtime.gd"
func _ready() -> void:
\tsuper._ready()
\tcall_deferred("check_contract")
func check_contract() -> void:
\tvar behavior = current.find_child("behavior_${f.menuBindingId.replaceAll('-', '_')}", true, false)
\tvar port = behavior.get_meta("viento_project")
\tvar retry = behavior.get_meta("viento_project_retry")
\tvar restart = behavior.get_meta("viento_project_restart")
\tassert(port.write_state("progress", "menu-seed"))
\tvar mode := "commit"
\tfor argument in OS.get_cmdline_user_args():
\t\tif argument.begins_with("--restart-case="):
\t\t\tmode = argument.trim_prefix("--restart-case=")
\tvar before := shared_state.duplicate()
\tvar revision := state_revision
\tvar budget = execution_budget.snapshot()
\tvar too_many: Dictionary = {}
\tfor index in range(17):
\t\ttoo_many["k" + str(index)] = index
\tvar refusals := [not port.request_scene(current_scene), not retry.request_retry(current_scene, {}), not restart.request_restart({"bad key": 0}), not restart.request_restart({"score": []}), not restart.request_restart(too_many)]
\tfor answer in refusals:
\t\tassert(answer, "an invalid or historical self request was accepted")
\tassert(shared_state == before and state_revision == revision and pending_scene.is_empty() and retry_pending.is_empty() and execution_budget.snapshot() == budget, "refusal changed host state")
\tif mode in ["reserved-budget", "reserved-capacity"]:
\t\tif mode == "reserved-budget":
\t\t\tfor index in range(1022):
\t\t\t\tassert(port.write_state("counter", index))
\t\telse:
\t\t\tfor index in range(62):
\t\t\t\tassert(port.write_state("k" + str(index), index))
\t\tbefore = shared_state.duplicate()
\t\trevision = state_revision
\t\tvar values = {"counter":0} if mode == "reserved-budget" else {"extra":0}
\t\tassert(restart.request_restart(values), "last available reservation refused")
\t\tassert(shared_state == before and state_revision == revision, "reservation committed early")
\t\tassert(port.write_state("counter", 1021) if mode == "reserved-budget" else port.write_state("progress", "menu-seed"), "no-op consumed reserved capacity")
\t\tvar changed = port.write_state("progress", "overrun") if mode == "reserved-budget" else port.write_state("late", 1)
\t\tassert(not changed and failed and shared_state == before and state_revision == revision, "old write exceeded reserved capacity or partially committed the overlay")
\telif mode == "capacity":
\t\tfor index in range(63):
\t\t\tassert(port.write_state("k" + str(index), index))
\t\tbefore = shared_state.duplicate()
\t\trevision = state_revision
\t\tbudget = execution_budget.snapshot()
\t\tassert(not restart.request_restart({"extra":0}), "65th merged key accepted")
\t\tassert(shared_state == before and state_revision == revision and pending_scene.is_empty() and retry_pending.is_empty() and execution_budget.snapshot() == budget, "capacity refusal changed state")
\telif mode == "budget":
\t\tfor index in range(1023):
\t\t\tassert(port.write_state("counter", index))
\t\tbefore = shared_state.duplicate()
\t\trevision = state_revision
\t\tbudget = execution_budget.snapshot()
\t\tassert(not restart.request_restart({"counter":0}), "exhausted mutation budget accepted")
\t\tassert(shared_state == before and state_revision == revision and retry_pending.is_empty() and pending_scene.is_empty() and execution_budget.snapshot() == budget, "budget refusal changed state")
\telif mode == "visit-limit":
\t\tfor index in range(63):
\t\t\tassert(restart.request_restart({}), "fresh visit refused before session limit")
\t\t\tflush_requests()
\t\t\tassert(visit_index == index + 2 and current_scene == ${JSON.stringify(f.menuId)})
\t\t\tbehavior = current.find_child("behavior_${f.menuBindingId.replaceAll('-', '_')}", true, false)
\t\t\trestart = behavior.get_meta("viento_project_restart")
\t\tbefore = shared_state.duplicate()
\t\trevision = state_revision
\t\tbudget = execution_budget.snapshot()
\t\tassert(not restart.request_restart({}), "65th visit accepted")
\t\tassert(shared_state == before and state_revision == revision and retry_pending.is_empty() and pending_scene.is_empty() and execution_budget.snapshot() == budget, "visit refusal changed state")
\telse:
\t\tassert(port.write_state("score", 75) and port.write_state("health", 12))
\t\tbefore = shared_state.duplicate()
\t\trevision = state_revision
\t\tvar scene_id := current_scene
\t\tvar old_scene = weakref(current)
\t\tvar old_behavior = weakref(behavior)
\t\tvar values = {} if mode == "empty" else {"score":0, "health":100, "key_found":false}
\t\tassert(restart.request_restart(values), "valid same-scene restart refused")
\t\tvalues["score"] = 999
\t\tassert(shared_state == before and state_revision == revision and retry_pending["values"].get("score", null) != 999, "acceptance mutated state or retained caller dictionary")
\t\tassert(not restart.request_restart({"score":99}) and not port.request_scene(${JSON.stringify(f.gameId)}) and not retry.request_retry(${JSON.stringify(f.gameId)}, {}), "pending restart did not exclude competitors")
\t\tif mode == "finish":
\t\t\tfinish_project()
\t\t\tassert(shared_state == before and state_revision == revision and retry_pending.is_empty() and not restart.request_restart({}), "finish committed a cancelled restart")
\t\telse:
\t\t\tassert(port.write_state("progress", "after-accept"))
\t\t\tassert(port.write_state("score", 33))
\t\t\tflush_requests()
\t\t\tassert(current_scene == scene_id and visit_index == 2, "same scene did not receive exactly one fresh visit")
\t\t\tassert(shared_state == ({"score":33,"health":12,"progress":"after-accept"} if mode == "empty" else {"score":0,"health":100,"key_found":false,"progress":"after-accept"}), "copied overlay or preserved unrelated progress differs")
\t\t\tassert(old_scene.get_ref() == null and old_behavior.get_ref() == null, "old native scene or behavior survived")
\t\t\tvar admitted_state := shared_state.duplicate()
\t\t\tvar admitted_revision := state_revision
\t\t\tvar admitted_budget = execution_budget.snapshot()
\t\t\tassert(port.read_state("score") == null and not port.write_state("score", 999) and not port.erase_state("score") and not port.publish_event("game.audit", true) and not port.request_scene(${JSON.stringify(f.gameId)}) and not retry.request_retry(${JSON.stringify(f.gameId)}, {}) and not restart.request_restart({}) and not port.play_audio(${JSON.stringify(f.collectTrackId)}) and not port.stop_audio(${JSON.stringify(f.collectTrackId)}), "old visit port retained authority")
\t\t\tif port.has_method("play_animation"):
\t\t\t\tassert(not port.play_animation() and not port.pause_animation() and not port.stop_animation() and not port.seek_animation(0), "old animation port retained authority")
\t\t\tassert(not port.unsubscribe_event(1), "old event subscription retained authority")
\t\t\tassert(shared_state == admitted_state and state_revision == admitted_revision and execution_budget.snapshot() == admitted_budget, "stale port affected current state or session budgets")
\tprint("RESTART_CONTRACT:" + JSON.stringify({"mode":mode,"refusals":refusals,"state":shared_state,"revision":state_revision,"budget":execution_budget.snapshot(),"pending":retry_pending,"visit":visit_index}, "", true, true))
\tif not finished and not failed:
\t\tfinish_project()
`;
  const remove = await installProbe(f, 'restart-contract', source), results = [];
  try {
    succeeded(await runBuildProcess(executable, ['--path', f.directory, '--headless', '--check-only', '--script', 'res://restart-contract.gd'], { cwd: f.directory, env: envFor(f), timeoutMs: 45000 }));
    for (const mode of ['commit', 'empty', 'finish', 'capacity', 'budget', 'reserved-budget', 'reserved-capacity', 'visit-limit']) {
      const result = await runBuildProcess(executable, ['--path', f.directory, '--headless', 'res://restart-contract.tscn', '--', '--restart-case=' + mode], { cwd: f.directory, env: envFor(f), timeoutMs: 45000 });
      const { received } = readEvents(f, result.stdout), rows = printed(result.stdout, 'RESTART_CONTRACT:');
      if (mode.startsWith('reserved-')) {
        assert.equal(result.status, 'failed');
        assert.ok(received.diagnostics.some(row => row.code === 'runtime_behavior_state_limit' && row.bindingId === f.menuBindingId), JSON.stringify(received.diagnostics));
        assert.ok(!received.diagnostics.some(row => row.code === 'runtime_project_protocol_invalid'));
        assert.ok(!received.events.some(row => row.event === 'finished'));
      } else {
        succeeded(result); assert.deepEqual(received.diagnostics, [], JSON.stringify(received.diagnostics)); assert.equal(received.events.at(-1).event, 'finished');
      }
      assert.equal(rows.length, 1, result.stdout + result.stderr); assert.equal(rows[0].mode, mode); assert.ok(rows[0].refusals.every(Boolean));
      const visits = received.events.filter(row => row.event === 'scene-enter');
      assert.equal(visits.length, mode === 'visit-limit' ? 64 : ['commit', 'empty'].includes(mode) ? 2 : 1);
      assert.ok(visits.every(row => row.sceneId === f.menuId));
      results.push({ ...rows[0], events: received.events, diagnostics: received.diagnostics, nativeStdout: result.stdout, nativeStderr: result.stderr });
    }
  } finally { await remove(); }
  await unchanged(f); assert.deepEqual(await sceneRestartInventory(f.author), f.before); assert.deepEqual(await sceneRestartInventory(restartSample), canonicalBefore); assert.deepEqual(await sourceHashes(), sourceBefore);
  await evidence('controlled-contracts', { scope: 'Actual generated host and public visit ports under explicit controlled API probes; no actual-keyboard claim.', sourceProbe: source, results, tool: f.tool, sourceBefore, sourceAfter: await sourceHashes(), authorBefore: f.before, authorAfter: await sceneRestartInventory(f.author) });
});

async function keyboard(f, output) {
  await fs.mkdir(output, { recursive: true });
  const observer = await fs.readFile(new URL('./helpers/scene-restart-observer.gd', import.meta.url), 'utf8');
  const observerName = 'scene-restart-observer';
  await fs.writeFile(path.join(f.directory, observerName + '.gd'), observer);
  await fs.writeFile(path.join(f.directory, observerName + '.tscn'), `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${observerName}.gd" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\nsample_directory = ${JSON.stringify(path.join(output, 'frames'))}\n`);
  const driver = fileURLToPath(new URL('./helpers/scene-restart-keyboard.py', import.meta.url));
  let result;
  try {
    succeeded(await runBuildProcess(executable, ['--path', f.directory, '--headless', '--check-only', '--script', 'res://scene-restart-observer.gd'], { cwd: f.directory, env: envFor(f), timeoutMs: 45000 }));
    result = await runBuildProcess('python3', [driver, executable, f.directory, output], { cwd: f.directory, env: envFor(f), timeoutMs: 120000 });
    succeeded(result);
  } finally { for (const suffix of ['.gd', '.gd.uid', '.tscn']) await fs.rm(path.join(f.directory, observerName + suffix), { force: true }); }
  const stdout = await fs.readFile(path.join(output, 'window-output.log'), 'utf8'), data = JSON.parse(await fs.readFile(path.join(output, 'keyboard.json')));
  const { received } = readEvents(f, stdout); assert.deepEqual(received.diagnostics, [], JSON.stringify(received.diagnostics));
  const visits = received.events.filter(row => row.event === 'scene-enter');
  assert.deepEqual(visits.map(row => row.sceneId), [f.menuId, f.gameId, f.gameId, f.gameId]);
  assert.deepEqual(visits.map(row => row.visitIndex), [1, 2, 3, 4]); assert.equal(received.events.at(-1).event, 'finished');
  const enters = printed(stdout, 'RESTART_ENTER:'), gameEnters = enters.filter(row => row.sceneId === f.gameId), leaves = printed(stdout, 'RESTART_LEAVE:');
  assert.equal(gameEnters.length, 3); assert.equal(leaves.length, 4); assert.ok(leaves.every(row => row.allNodesFreed && row.nodeCount > 1));
  for (const row of gameEnters) {
    assert.deepEqual(row.actors[f.playerId].position, f.initialPosition); assert.deepEqual(row.actors[f.playerId].velocity, [0, 0]);
    assert.deepEqual(row.state, { ...f.defaults, progress: 'checkpoint-7' });
    assert.equal(row.animation.time, 0); assert.equal(row.animation.phase, 'playing');
    for (const visual of Object.values(row.animation.visuals)) assert.equal(visual.rotation, 0);
    assert.ok(Object.values(row.audio).length >= 2); assert.ok(Object.values(row.audio).every(track => !track.playing && track.position === 0));
    assert.ok(row.identities.camera > 0 && row.identities.hud > 0);
  }
  for (let index = 1; index < gameEnters.length; index++) {
    const before = gameEnters[index - 1], after = gameEnters[index];
    for (const identity of ['scene', 'hud', 'camera']) assert.notEqual(after.identities[identity], before.identities[identity], identity);
    for (const [id, row] of Object.entries(after.actors)) assert.notEqual(row.id, before.actors[id].id, 'actor ' + id);
    for (const [id, row] of Object.entries(after.audio)) assert.notEqual(row.id, before.audio[id].id, 'audio ' + id);
    for (const [id, row] of Object.entries(after.animation.visuals)) assert.notEqual(row.id, before.animation.visuals[id].id, 'animation ' + id);
    const oldBehaviorIds = Object.entries(before.identities).filter(([name]) => name.startsWith('behavior_')).map(([, id]) => id);
    assert.ok(Object.entries(after.identities).filter(([name]) => name.startsWith('behavior_')).every(([, id]) => !oldBehaviorIds.includes(id)));
    for (const dimension of Object.keys(before.budget)) assert.ok(after.budget[dimension] >= before.budget[dimension], dimension + ' session counter reset');
    for (const sequence of ['eventSequence', 'audioSequence', 'animationSequence', 'totalSeconds', 'stateRevision']) assert.ok(after[sequence] >= before[sequence], sequence + ' session value regressed');
    assert.equal(after.subscriptions, before.subscriptions, 'old subscriptions leaked into the next visit');
  }
  const dirty = data.stages.find(row => row.label === 'dirty-game-door-open-live-audio').sample;
  assert.ok(dirty.audio[f.collectTrackId].playing); assert.equal(dirty.state.door_open, true); assert.equal(dirty.state.health, 2);
  assert.equal(data.stages.find(row => row.label === 'same-crystal-recollected-once').sample.state.score, 1);
  const publishes = received.events.filter(row => row.event === 'event-publish');
  assert.equal(publishes.filter(row => row.name === 'game.collect').length, 4); assert.equal(publishes.filter(row => row.name === 'game.door_open').length, 1);
  assert.equal(publishes.filter(row => row.name === 'game.hazard').length, 1);
  assert.ok(!publishes.some(row => ['game.complete', 'game.failed'].includes(row.name)));
  const restartStates = received.events.filter(row => row.event === 'state' && row.bindingId === f.bindingId);
  assert.deepEqual(restartStates.map(row => [row.visitIndex, row.key]), [[2, 'door_open'], [2, 'health'], [2, 'score'], [3, 'score']]);
  const screenshots = {};
  for (const name of (await fs.readdir(path.join(output, 'frames'))).filter(name => name.endsWith('.png'))) screenshots[name] = hash(await fs.readFile(path.join(output, 'frames', name)));
  assert.ok(Object.keys(screenshots).length >= 4);
  await unchanged(f);
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ ok: true, scope: data.scope, browserAuthorSource: f.browserAuthorSource || null, observerSource: observer, tool: f.tool, events: received.events, enters, leaves, screenshots, generatedFiles: Object.fromEntries([...f.generated.files].map(([name, bytes]) => [name, hash(bytes)])) }, null, 2) + '\n');
  return { stages: data.stages.length, samples: data.samples.length, visits: visits.length, screenshots: Object.keys(screenshots).length, events: received.events.length };
}

function keyboardOutput(f, name) { return path.join(evidenceDirectory() || f.temporary, name); }
test('actual keyboard restarts the same 2D scene with fresh actors, collectible state, door, HUD, camera, animation and live audio', windowNative, async t => {
  const sourceBefore = await sourceHashes(), canonicalBefore = await sceneRestartInventory(restartSample), f = await prepare(t);
  const result = await keyboard(f, keyboardOutput(f, 'keyboard'));
  assert.deepEqual(await sceneRestartInventory(f.author), f.before); assert.deepEqual(await sceneRestartInventory(restartSample), canonicalBefore); assert.deepEqual(await sourceHashes(), sourceBefore);
  await evidence('window-flow', { ok: true, ...result, browserAuthorSource: f.browserAuthorSource || null, sourceBefore, sourceAfter: await sourceHashes(), authorBefore: f.before, authorAfter: await sceneRestartInventory(f.author), canonicalSampleBefore: canonicalBefore, canonicalSampleAfter: await sceneRestartInventory(restartSample) });
});

test('standard delivered project ZIP repeats the same restart keyboard flow after original author and build paths become unavailable', windowNative, async t => {
  const sourceBefore = await sourceHashes(), canonicalBefore = await sceneRestartInventory(restartSample), f = await godotSceneRestartAuthor(t), before = await sceneRestartInventory(f.author), output = path.join(f.temporary, 'build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool: executable, output, timeoutMs: 90000 }); assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  const snapshot = JSON.parse(await fs.readFile(path.join(output, 'snapshot.json'))), generated = await adapter.generate(snapshot.plan), inspect = () => inspectBackendProject({ buildDirectory: output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect }), zip = path.join(f.temporary, 'restart.viento-build.zip');
  await writeExportZip(delivery, zip); const verified = await verifyBackendProjectDelivery(zip), relocated = path.join(f.temporary, 'relocated'); await fs.mkdir(relocated);
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try {
    for await (const entry of archive.eachEntry()) {
      assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
      const chunks = []; for await (const chunk of await archive.openReadStreamPromise(entry)) chunks.push(chunk);
      const file = path.join(relocated, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
    }
  } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
  await fs.rename(f.author, f.author + '.offline'); await fs.rename(output, output + '.offline');
  await assert.rejects(fs.access(f.author), { code: 'ENOENT' }); await assert.rejects(fs.access(output), { code: 'ENOENT' });
  const ready = { ...f, before, captured: { plan: snapshot.plan }, generated, directory: path.join(relocated, 'project'), tool: await adapter.identify(executable) };
  assert.equal(await fs.readFile(path.join(ready.directory, `behaviors/${f.scriptId}.gd`), 'utf8'), GODOT_ACTION_SCENE_RESTART_SCRIPT);
  const phases = [];
  for (const phase of adapter.buildPhases) { const result = await adapter.executePhase({ phase, directory: ready.directory, tool: ready.tool, timeoutMs: 90000 }); succeeded(result); phases.push({ phase, status: result.status, stdout: result.stdout, stderr: result.stderr }); }
  const result = await keyboard(ready, keyboardOutput(ready, 'offline-keyboard'));
  assert.deepEqual(await sceneRestartInventory(f.author + '.offline'), before); assert.deepEqual(await sceneRestartInventory(restartSample), canonicalBefore); assert.deepEqual(await sourceHashes(), sourceBefore);
  if (evidenceDirectory()) await fs.copyFile(zip, path.join(evidenceDirectory(), 'restart.viento-build.zip'));
  await evidence('offline-delivery', { ok: true, ...result, browserAuthorSource: f.browserAuthorSource || null, originalPathsUnavailable: true, phases, zip: { bytes: (await fs.stat(zip)).size, sha256: hash(await fs.readFile(zip)), verification: verified }, authorBefore: before, authorAfter: await sceneRestartInventory(f.author + '.offline'), canonicalSampleBefore: canonicalBefore, canonicalSampleAfter: await sceneRestartInventory(restartSample), sourceBefore, sourceAfter: await sourceHashes() });
});
