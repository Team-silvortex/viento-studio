import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { GODOT_ACTION_PROJECT_PAUSE_SCRIPT } from '../../engine/godot-project-pause-script.mjs';
import { godotProjectPauseAuthor, projectPauseInventory, pauseSample, pauseId } from './helpers/project-pause-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';

const executable = process.env.VIENTO_GODOT_BIN;
const native = { skip: !executable ? 'Set VIENTO_GODOT_BIN for actual project pause tests' : false, timeout: 240000 };
const windowNative = { ...native, skip: !executable || !process.env.VIENTO_XVFB_TEST ? 'Set VIENTO_GODOT_BIN and VIENTO_XVFB_TEST under isolated Xvfb for actual keyboard evidence' : false };
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceNames = ['engine/godot-project-pause-script.mjs', 'scripts/backends/godot4/project-pause-runtime.gd', 'scripts/backends/godot4/project-pause-input.gd', 'scripts/backends/godot4-adapter.mjs', 'scripts/tests/godot-project-pause-native.test.mjs', 'scripts/tests/helpers/project-pause-author-fixture.mjs', 'scripts/tests/helpers/project-pause-observer.gd', 'scripts/tests/helpers/project-pause-keyboard.py'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, hash(await fs.readFile(name))])));
const succeeded = result => { assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.doesNotMatch(result.stdout + result.stderr, /(?:SCRIPT ERROR:|ERROR:|PAUSE_OBSERVER_ERROR:)/); };
const envFor = f => ({ ...process.env, LIBGL_ALWAYS_SOFTWARE: '1', GODOT_SILENCE_ROOT_WARNING: '1', XDG_DATA_HOME: path.join(f.temporary, 'xdg/data'), XDG_CONFIG_HOME: path.join(f.temporary, 'xdg/config'), XDG_CACHE_HOME: path.join(f.temporary, 'xdg/cache') });
const printed = (stdout, prefix) => stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
function evidenceDirectory() {
  const requested = process.env.VIENTO_PROJECT_PAUSE_EVIDENCE_DIR;
  if (!requested) return null;
  const resolved = path.resolve(requested), topic = path.resolve('docs/test-results/project-pause');
  assert.ok(resolved.startsWith('/tmp/') || resolved.startsWith(topic + path.sep), 'Use /tmp or a fresh project-pause evidence directory');
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
  const f = await godotProjectPauseAuthor(t), before = await projectPauseInventory(f.author), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const generated = await adapter.generate(captured.plan), directory = path.join(f.temporary, 'generated');
  assert.ok(generated.backend.capabilities.includes('project.pause'));
  assert.ok(generated.files.has('project-pause-runtime.gd'));
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

// Explicit API probes are separate from the read-only real-keyboard observer.
test('native pause guards are atomic, preserve the session ledger, revoke stale ports and permit shutdown', native, async t => {
  const sourceBefore = await sourceHashes(), canonicalBefore = await projectPauseInventory(pauseSample), f = await prepare(t);
  const source = `extends "res://project-pause-runtime.gd"
var probe_physics := false
var probe_port
func _ready() -> void:
\tsuper._ready()
\tcall_deferred("check_contract")
func _physics_process(delta: float) -> void:
\tif probe_physics:
\t\tprobe_physics = false
\t\tassert(not probe_port.request_pause(true), "physics callback paused the tree")
\t\tcall_deferred("finish_project")
\t\tprint("PAUSE_CONTRACT:" + JSON.stringify({"mode":"physics","ok":true}))
\t\treturn
\tsuper._physics_process(delta)
func check_contract() -> void:
\tawait get_tree().process_frame
\tvar mode := "finish"
\tfor argument in OS.get_cmdline_user_args():
\t\tif argument.begins_with("--pause-case="):
\t\t\tmode = argument.trim_prefix("--pause-case=")
\tvar menu_behavior = current.find_child("behavior_${f.menuBindingId.replaceAll('-', '_')}", true, false)
\tvar old_port = menu_behavior.get_meta("viento_project_pause")
\tassert(menu_behavior.get_meta("viento_project_retry").request_retry(${JSON.stringify(f.gameId)}, {"score":0,"health":3,"door_open":false}))
\tflush_requests()
\tvar behavior = current.find_child("behavior_${f.bindingId.replaceAll('-', '_')}", true, false)
\tvar port = behavior.get_meta("viento_project_pause")
\tvar game_port = behavior.get_meta("viento_project")
\tassert(not old_port.request_pause(true) and old_port.status() == "unavailable" and not old_port.is_paused())
\tassert(not pause_request(RefCounted.new(), true))
\tassert(not PausePort.new(self).request_pause(true))
\tassert(not port.configure_toggle_action("missing_action"))
\tvar state := shared_state.duplicate(true)
\tvar revision := state_revision
\tvar budget = execution_budget.snapshot()
\tvar visit := visit_index
\tvar scene_identity = current.get_instance_id()
\tvar seconds := total_seconds
\tvar sequence := pause_sequence
\tif mode == "physics":
\t\tprobe_port = port
\t\tprobe_physics = true
\t\treturn
\tflushing = true
\tassert(not port.request_pause(true))
\tflushing = false
\tpending_scene = ${JSON.stringify(f.winId)}
\tassert(not port.request_pause(true) and pending_scene == ${JSON.stringify(f.winId)})
\tpending_scene = ""
\tretry_pending = {"sentinel":true}
\tassert(not port.request_pause(true) and retry_pending == {"sentinel":true})
\tretry_pending = {}
\tfor service in [event_bus, audio_control, animation_control]:
\t\tservice.queue.push_back({"sentinel":true})
\t\tassert(not port.request_pause(true) and service.queue == [{"sentinel":true}])
\t\tservice.queue.clear()
\tfor property in get_property_list():
\t\tif property["name"] == "animation_completions":
\t\t\tvar completion = get("animation_completions")
\t\t\tcompletion.queue.push_back({"sentinel":true})
\t\t\tassert(not port.request_pause(true) and completion.queue.size() == 1)
\t\t\tcompletion.queue.clear()
\tassert(pause_phase == "running" and not get_tree().paused and pause_sequence == sequence)
\tassert(shared_state == state and state_revision == revision and execution_budget.snapshot() == budget and visit_index == visit and current.get_instance_id() == scene_identity)
\tassert(port.request_pause(true) and port.is_paused() and port.status() == "paused" and get_tree().paused)
\tsequence = pause_sequence
\tassert(port.request_pause(true) and pause_sequence == sequence)
\tassert(game_port.read_state("score") == null and not game_port.write_state("paused_write", 1) and not game_port.publish_event("game.paused", true) and not game_port.play_audio(${JSON.stringify(f.collectTrackId)}) and not game_port.request_scene(${JSON.stringify(f.winId)}))
\tflush_requests()
\tawait get_tree().create_timer(0.2, true).timeout
\tassert(total_seconds == seconds and shared_state == state and state_revision == revision and execution_budget.snapshot() == budget and current.get_instance_id() == scene_identity and visit_index == visit)
\tassert(port.request_pause(false) and port.status() == "waiting-for-release" and get_tree().paused)
\tassert(port.request_pause(true) and port.status() == "paused" and get_tree().paused)
\tprint("PAUSE_CONTRACT:" + JSON.stringify({"mode":mode,"ok":true,"visit":visit_index,"state":shared_state,"budget":execution_budget.snapshot(),"phase":pause_phase}))
\tif mode == "abort":
\t\tabort_project()
\t\tassert(not get_tree().paused and old_port.status() == "unavailable" and port.status() == "unavailable")
\telif mode == "close":
\t\t_notification(NOTIFICATION_WM_CLOSE_REQUEST)
\telse:
\t\tfinish_project()
`;
  const remove = await installProbe(f, 'pause-contract', source), results = [];
  try {
    succeeded(await runBuildProcess(executable, ['--path', f.directory, '--headless', '--check-only', '--script', 'res://pause-contract.gd'], { cwd: f.directory, env: envFor(f), timeoutMs: 45000 }));
    for (const mode of ['finish', 'close', 'abort', 'physics']) {
      const result = await runBuildProcess(executable, ['--path', f.directory, '--headless', 'res://pause-contract.tscn', '--', '--pause-case=' + mode], { cwd: f.directory, env: envFor(f), timeoutMs: 45000 });
      assert.equal(result.status, mode === 'abort' ? 'failed' : 'succeeded', result.stdout + result.stderr);
      assert.doesNotMatch(result.stdout + result.stderr, /SCRIPT ERROR:|ERROR:/);
      const { received } = readEvents(f, result.stdout), rows = printed(result.stdout, 'PAUSE_CONTRACT:');
      assert.equal(rows.length, 1, result.stdout + result.stderr); assert.equal(rows[0].mode, mode); assert.equal(rows[0].ok, true);
      assert.deepEqual(received.diagnostics, [], JSON.stringify(received.diagnostics));
      if (mode !== 'abort') assert.equal(received.events.at(-1).event, 'finished');
      results.push({ ...rows[0], nativeStdout: result.stdout, nativeStderr: result.stderr, events: received.events });
    }
  } finally { await remove(); }
  await unchanged(f); assert.deepEqual(await projectPauseInventory(f.author), f.before); assert.deepEqual(await projectPauseInventory(pauseSample), canonicalBefore); assert.deepEqual(await sourceHashes(), sourceBefore);
  await evidence('controlled-contracts', { scope: 'Actual generated host and registered visit ports under explicit controlled API probes; no keyboard claim.', sourceProbe: source, results, sourceBefore, sourceAfter: await sourceHashes(), authorBefore: f.before, authorAfter: await projectPauseInventory(f.author) });
});

async function keyboard(f, output) {
  await fs.mkdir(output, { recursive: true });
  const observer = await fs.readFile(new URL('./helpers/project-pause-observer.gd', import.meta.url), 'utf8'), observerName = 'project-pause-observer';
  await fs.writeFile(path.join(f.directory, observerName + '.gd'), observer);
  await fs.writeFile(path.join(f.directory, observerName + '.tscn'), `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${observerName}.gd" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\nsample_directory = ${JSON.stringify(path.join(output, 'frames'))}\n`);
  try {
    succeeded(await runBuildProcess(executable, ['--path', f.directory, '--headless', '--check-only', '--script', 'res://project-pause-observer.gd'], { cwd: f.directory, env: envFor(f), timeoutMs: 45000 }));
    succeeded(await runBuildProcess('python3', [fileURLToPath(new URL('./helpers/project-pause-keyboard.py', import.meta.url)), executable, f.directory, output], { cwd: f.directory, env: envFor(f), timeoutMs: 120000 }));
  } finally { for (const suffix of ['.gd', '.gd.uid', '.tscn']) await fs.rm(path.join(f.directory, observerName + suffix), { force: true }); }
  const stdout = await fs.readFile(path.join(output, 'window-output.log'), 'utf8'), data = JSON.parse(await fs.readFile(path.join(output, 'keyboard.json'))), { received } = readEvents(f, stdout);
  assert.deepEqual(received.diagnostics, [], JSON.stringify(received.diagnostics)); assert.equal(received.events.at(-1).event, 'finished');
  const visits = received.events.filter(row => row.event === 'scene-enter'); assert.deepEqual(visits.map(row => row.sceneId), [f.menuId, f.gameId]); assert.deepEqual(visits.map(row => row.visitIndex), [1, 2]);
  const pauseFrames = printed(stdout, 'VIENTO_PROJECT_PAUSE:'); assert.ok(pauseFrames.length >= 9);
  assert.ok(pauseFrames.every((row, index) => row.sequence === index + 1 && row.visitIndex === 2 && row.sceneId === f.gameId));
  assert.ok(pauseFrames.some(row => row.phase === 'waiting-for-release')); assert.ok(pauseFrames.some(row => row.phase === 'running'));
  const paused = data.stages.find(row => row.label === 'native-gameplay-and-media-frozen').sample;
  assert.equal(paused.pauseOverlayVisible, true); assert.ok(paused.pauseTexts.some(row => row.text === f.parameters.paused_text && row.visible));
  const first = data.stages.find(row => row.label === 'running-with-live-audio').sample, last = data.stages.find(row => row.label === 'paused-before-Escape').sample;
  for (const name of ['scene', 'camera', 'hud']) assert.equal(last.identities[name], first.identities[name]);
  for (const [name, count] of Object.entries(first.budget)) assert.ok(last.budget[name] >= count);
  const screenshots = Object.fromEntries(await Promise.all((await fs.readdir(path.join(output, 'frames'))).filter(name => name.endsWith('.png')).map(async name => [name, hash(await fs.readFile(path.join(output, 'frames', name)))])));
  assert.ok(Object.keys(screenshots).length >= 6); await unchanged(f);
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ ok: true, scope: data.scope, browserAuthorSource: f.browserAuthorSource || null, tool: f.tool, events: received.events, pauseFrames, screenshots, generatedFiles: Object.fromEntries([...f.generated.files].map(([name, bytes]) => [name, hash(bytes)])) }, null, 2) + '\n');
  return { stages: data.stages.length, samples: data.samples.length, visits: visits.length, screenshots: Object.keys(screenshots).length, events: received.events.length, pauseFrames: pauseFrames.length };
}
function keyboardOutput(f, name) { return path.join(evidenceDirectory() || f.temporary, name); }
test('actual keyboard pauses and resumes the same 2D visit with frozen gameplay, callbacks, animation and native PCM playback', windowNative, async t => {
  const sourceBefore = await sourceHashes(), canonicalBefore = await projectPauseInventory(pauseSample), f = await prepare(t), result = await keyboard(f, keyboardOutput(f, 'keyboard'));
  assert.deepEqual(await projectPauseInventory(f.author), f.before); assert.deepEqual(await projectPauseInventory(pauseSample), canonicalBefore); assert.deepEqual(await sourceHashes(), sourceBefore);
  await evidence('window-flow', { ok: true, ...result, browserAuthorSource: f.browserAuthorSource || null, sourceBefore, sourceAfter: await sourceHashes(), authorBefore: f.before, authorAfter: await projectPauseInventory(f.author), canonicalSampleBefore: canonicalBefore, canonicalSampleAfter: await projectPauseInventory(pauseSample) });
});

test('standard delivered project ZIP repeats the same pause keyboard flow after original author and build paths become unavailable', windowNative, async t => {
  const sourceBefore = await sourceHashes(), canonicalBefore = await projectPauseInventory(pauseSample), f = await godotProjectPauseAuthor(t), before = await projectPauseInventory(f.author), output = path.join(f.temporary, 'build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool: executable, output, timeoutMs: 90000 }); assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
  const snapshot = JSON.parse(await fs.readFile(path.join(output, 'snapshot.json'))), generated = await adapter.generate(snapshot.plan), inspect = () => inspectBackendProject({ buildDirectory: output });
  const delivery = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect }), zip = path.join(f.temporary, 'pause.viento-build.zip');
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
  assert.equal(await fs.readFile(path.join(ready.directory, `behaviors/${f.scriptId}.gd`), 'utf8'), GODOT_ACTION_PROJECT_PAUSE_SCRIPT);
  const phases = [];
  for (const phase of adapter.buildPhases) { const result = await adapter.executePhase({ phase, directory: ready.directory, tool: ready.tool, timeoutMs: 90000 }); succeeded(result); phases.push({ phase, status: result.status, stdout: result.stdout, stderr: result.stderr }); }
  const result = await keyboard(ready, keyboardOutput(ready, 'offline-keyboard'));
  assert.deepEqual(await projectPauseInventory(f.author + '.offline'), before); assert.deepEqual(await projectPauseInventory(pauseSample), canonicalBefore); assert.deepEqual(await sourceHashes(), sourceBefore);
  if (evidenceDirectory()) await fs.copyFile(zip, path.join(evidenceDirectory(), 'pause.viento-build.zip'));
  await evidence('offline-delivery', { ok: true, ...result, browserAuthorSource: f.browserAuthorSource || null, originalPathsUnavailable: true, phases, zip: { bytes: (await fs.stat(zip)).size, sha256: hash(await fs.readFile(zip)), verification: verified }, authorBefore: before, authorAfter: await projectPauseInventory(f.author + '.offline'), canonicalSampleBefore: canonicalBefore, canonicalSampleAfter: await projectPauseInventory(pauseSample), sourceBefore, sourceAfter: await sourceHashes() });
});
