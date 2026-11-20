import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../../', import.meta.url));
await import(app + '/scripts/adapters/node-studio-core.mjs');
const { buildProject } = await import(app + '/scripts/adapters/node-project-build.mjs');
const { GODOT4_EXECUTION_ADAPTER: adapter } = await import(app + '/scripts/backends/godot4-adapter.mjs');
const { runBuildProcess } = await import(app + '/scripts/lib/build-process.mjs');
const { readRegistry } = await import(app + '/scripts/lib/workspace.mjs');
const { listScriptStarters } = await import(app + '/engine/script-authoring.mjs');
const [authorArgument, outputArgument] = process.argv.slice(2);
const executable = process.env.VIENTO_GODOT_BIN;
assert.ok(authorArgument && outputArgument && executable && path.isAbsolute(executable), 'Supply author, output, and VIENTO_GODOT_BIN.');
const author = path.resolve(authorArgument), output = path.resolve(outputArgument);
assert.ok(output.startsWith('/tmp/') && output !== author && !output.startsWith(author + path.sep), 'Use a separate disposable output directory.');
await fs.mkdir(output, { recursive: true });
assert.deepEqual(await fs.readdir(output), [], 'Preserve all earlier run evidence.');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJSON = (name, value) => fs.writeFile(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
async function tree(root) {
  const result = {};
  for (const row of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    assert.equal(row.isSymbolicLink(), false, 'The native smoke author must be portable.');
    if (row.isFile()) {
      const file = path.join(row.parentPath || row.path, row.name);
      result[path.relative(root, file)] = sha(await fs.readFile(file));
    }
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
const before = await tree(author), registry = await readRegistry(author);
assert.equal(registry.documents.length, 7, 'Consume the seven documents saved through the first-creation audio workflow.');
assert.equal(registry.assets.length, 1, 'Consume exactly one registered PCM WAV.');
const documents = [];
for (const record of registry.documents) {
  const content = await fs.readFile(path.join(author, record.sourcePath), 'utf8');
  let value = null;
  if (record.sourcePath.endsWith('.json')) value = JSON.parse(content.replace(/^\uFEFF/, ''));
  documents.push({ record, content, value });
}
const only = format => { const rows = documents.filter(row => row.value?.format === format); assert.equal(rows.length, 1, format); return rows[0]; };
const assembly = only('viento-project-assembly'), scene = only('viento-scene2d'), audio = only('viento-scene-audio'), behavior = only('viento-scene-behaviors');
assert.deepEqual(assembly.value.sceneIds, [scene.record.id]);
assert.equal(assembly.value.entrySceneId, scene.record.id);
assert.equal(audio.value.sceneObjectId, scene.record.id);
assert.equal(behavior.value.sceneObjectId, scene.record.id);
assert.equal(audio.value.tracks.length, 2);
assert.deepEqual(audio.value.cues, [], 'Authored timeline cues must not simulate the behavior request.');
const [unselectedTrack, selectedTrack] = audio.value.tracks;
assert.deepEqual([unselectedTrack.role, unselectedTrack.volume, unselectedTrack.loop], ['effect', 0.25, false]);
assert.deepEqual([selectedTrack.role, selectedTrack.volume, selectedTrack.loop], ['music', 0.15, true]);
assert.equal(unselectedTrack.resourceId, selectedTrack.resourceId);
assert.equal(selectedTrack.resourceId, registry.assets[0].id);
const starters = listScriptStarters(), sources = {};
for (const id of ['godot-project-event-audio', 'godot-project-events']) {
  const starter = starters.find(row => row.id === id); assert.ok(starter);
  const candidates = documents.filter(row => row.content === starter.content); assert.equal(candidates.length, 1, 'Preserve the official author script: ' + id);
  sources[id] = candidates[0];
}
assert.equal(behavior.value.bindings.length, 2);
const bindingFor = id => { const rows = behavior.value.bindings.filter(row => row.implementation.sourceObjectId === sources[id].record.id); assert.equal(rows.length, 1, id); assert.equal(rows[0].implementation.backendId, 'org.viento.godot4'); assert.equal(rows[0].implementation.language, 'gdscript'); return rows[0]; };
const audioBinding = bindingFor('godot-project-event-audio'), publisherBinding = bindingFor('godot-project-events');
assert.deepEqual(audioBinding.parameters, { event_name: 'checkpoint', track_id: selectedTrack.id, instance_id: '' });
assert.deepEqual(publisherBinding.parameters, {});
assert.ok(scene.value.actors.some(row => row.instanceId === audioBinding.instanceId));
assert.ok(scene.value.actors.some(row => row.instanceId === publisherBinding.instanceId));
await writeJSON('author-before.json', before);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-create-audio-native-build-'));
const env = { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1', LIBGL_ALWAYS_SOFTWARE: '1', XDG_DATA_HOME: path.join(temporary, 'data'), XDG_CONFIG_HOME: path.join(temporary, 'config'), XDG_CACHE_HOME: path.join(temporary, 'cache') };
let finalVerification;
const phases = [];
try {
  const built = await buildProject({ root: author, targetId: assembly.record.id, tool: executable, output: path.join(temporary, 'build'), timeoutMs: 90000 });
  await writeJSON('build-result.json', built);
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics || built));
  const snapshotBytes = await fs.readFile(path.join(temporary, 'build/snapshot.json'));
  const snapshot = JSON.parse(snapshotBytes), generated = await adapter.generate(snapshot.plan), directory = path.join(temporary, 'build/project'), tool = await adapter.identify(executable);
  const generatedBefore = {}, resourceBefore = {};
  for (const [name, bytes] of generated.files) { assert.deepEqual(await fs.readFile(path.join(directory, name)), bytes, name); generatedBefore[name] = sha(bytes); }
  for (const [id, name] of generated.resourceFiles) resourceBefore[name] = { resourceId: id, sha256: sha(await fs.readFile(path.join(directory, name))) };
  const projectScene = generated.files.get('project.tscn').toString('utf8'), mainScript = projectScene.match(/\[ext_resource type="Script" path="(res:\/\/[^"\r\n]+)" id="1"\]/);
  assert.ok(mainScript, 'Select the generated root script without rewriting it.');
  const observer = `extends ${JSON.stringify(mainScript[1])}

# Test-only independent child: reads native players and shared state. It never
# calls a gameplay port, publishes an event, or starts/stops an audio player.
var audio_observer
class AudioObserver extends Node:
\tvar project_ref: WeakRef
\tvar started_msec := 0
\tvar success_msec := -1
\tvar sampled_msec := -50
\tvar done := false
\tfunc _ready() -> void:
\t\tstarted_msec = Time.get_ticks_msec()
\tfunc _process(_delta: float) -> void:
\t\tif done:
\t\t\treturn
\t\tvar project = project_ref.get_ref()
\t\tif project == null:
\t\t\treturn
\t\tvar now := Time.get_ticks_msec()
\t\tvar sample: Dictionary = project.audio_observer_snapshot()
\t\tif now - sampled_msec >= 50:
\t\t\tsampled_msec = now
\t\t\tprint("FIRST_AUDIO_SAMPLE:" + JSON.stringify(sample, "", true, true))
\t\tvar tracks: Dictionary = sample.get("tracks", {})
\t\tvar selected: Dictionary = tracks.get(${JSON.stringify(selectedTrack.id)}, {})
\t\tvar unselected: Dictionary = tracks.get(${JSON.stringify(unselectedTrack.id)}, {})
\t\tif sample.get("state", {}).get("last_event") == "hello" and selected.get("playing") == true and unselected.get("playing") == false:
\t\t\tif success_msec < 0:
\t\t\t\tsuccess_msec = now
\t\t\tvar hold_seconds: float = maxf(1.1, float(selected.get("lengthSeconds", 0.0)) + 0.25)
\t\t\tif float(now - success_msec) / 1000.0 >= hold_seconds:
\t\t\t\tdone = true
\t\t\t\tsample["observedPlayingSeconds"] = float(now - success_msec) / 1000.0
\t\t\t\tprint("FIRST_AUDIO_FINAL:" + JSON.stringify(sample, "", true, true))
\t\t\t\t# Exercise the generated project's ordinary close handling only.
\t\t\t\tget_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)
\t\t\t\treturn
\t\telif success_msec >= 0:
\t\t\tdone = true
\t\t\tprint("FIRST_AUDIO_OBSERVER_ERROR:Playback or state changed during observation.")
\t\t\tget_tree().quit(1)
\t\tif now - started_msec > 10000:
\t\t\tdone = true
\t\t\tprint("FIRST_AUDIO_OBSERVER_ERROR:No stable event-driven playback within ten seconds.")
\t\t\tget_tree().quit(1)

func _ready() -> void:
\tsuper._ready()
\taudio_observer = AudioObserver.new()
\taudio_observer.project_ref = weakref(self)
\tadd_child(audio_observer)

func audio_observer_snapshot() -> Dictionary:
\tvar tracks: Dictionary = {}
\tvar scene = current
\tif is_instance_valid(scene):
\t\tvar players: Variant = scene.get("audio_players")
\t\tif players is Dictionary:
\t\t\tfor id in players:
\t\t\t\tvar player = players[id]
\t\t\t\tif not is_instance_valid(player) or not player is AudioStreamPlayer:
\t\t\t\t\tcontinue
\t\t\t\tvar stream = player.stream
\t\t\t\ttracks[id] = {"nativeClass": player.get_class(), "playing": player.playing,
\t\t\t\t\t"gain": db_to_linear(player.volume_db), "streamPresent": stream != null,
\t\t\t\t\t"streamClass": stream.get_class() if stream != null else "",
\t\t\t\t\t"lengthSeconds": stream.get_length() if stream != null else 0.0,
\t\t\t\t\t"loopMode": stream.loop_mode if stream is AudioStreamWAV else -1,
\t\t\t\t\t"streamInstanceId": stream.get_instance_id() if stream != null else -1}
\treturn {"sceneId": current_scene, "visitIndex": visit_index, "state": shared_state.duplicate(true),
\t\t"stateRevision": state_revision, "tracks": tracks, "failed": failed, "finished": finished,
\t\t"nativeAudioDriver": AudioServer.get_driver_name(), "elapsedSeconds": elapsed_seconds}
`;
  const wrapper = `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://first-audio-observer.gd" id="1"]\n\n[node name="VientoProject" type="Node2D"]\nscript = ExtResource("1")\n`;
  await fs.writeFile(path.join(directory, 'first-audio-observer.gd'), observer);
  await fs.writeFile(path.join(directory, 'first-audio-observer.tscn'), wrapper);
  await fs.writeFile(path.join(output, 'observer.gd'), observer);
  await fs.writeFile(path.join(output, 'observer.tscn'), wrapper);
  await fs.writeFile(path.join(output, 'snapshot.json'), snapshotBytes);
  const checkResult = (result, phase) => { assert.equal(result.status, 'succeeded', phase + '\n' + result.stdout + result.stderr); assert.doesNotMatch(result.stdout + result.stderr, /(?:SCRIPT ERROR:|ERROR:|FIRST_AUDIO_OBSERVER_ERROR:)/, phase); };
  for (const phase of adapter.buildPhases) {
    const result = await adapter.executePhase({ phase, directory, tool, timeoutMs: 90000 });
    phases.push({ phase, ...result }); await writeJSON('phases.json', phases); checkResult(result, phase);
  }
  const args = ['--headless', '--audio-driver', 'Dummy', '--path', directory, 'res://first-audio-observer.tscn'];
  const result = await runBuildProcess(executable, args, { cwd: directory, env, timeoutMs: 30000 });
  await fs.writeFile(path.join(output, 'native-output.log'), result.stdout + result.stderr);
  await writeJSON('native-process.json', { ...result, stdout: undefined, stderr: undefined, arguments: args });
  checkResult(result, 'actual observer run');
  const reader = adapter.createEventReader(snapshot.plan, { capabilities: generated.backend.capabilities });
  reader.push(result.stdout); const received = reader.finish();
  assert.deepEqual(received.diagnostics, []);
  const events = received.events, publications = events.filter(row => row.event === 'event-publish'), commands = events.filter(row => row.event === 'audio-command');
  assert.equal(publications.length, 1);
  assert.deepEqual([publications[0].name, publications[0].value, publications[0].bindingId], ['checkpoint', 'hello', publisherBinding.bindingId]);
  assert.equal(events.filter(row => row.event === 'event-delivery' && row.status === 'handled').length, 2);
  assert.equal(commands.length, 1, 'Exactly one real accepted and executed audio command.');
  assert.deepEqual([commands[0].action, commands[0].trackId, commands[0].bindingId], ['play', selectedTrack.id, audioBinding.bindingId]);
  assert.equal(events.filter(row => row.event === 'scene-enter').length, 1);
  assert.equal(events.at(-1).event, 'finished');
  assert.equal(events.at(-1).eventSequence, 1);
  assert.equal(events.at(-1).audioCommandSequence, 1);
  assert.ok(events.some(row => row.event === 'state' && row.key === 'last_event' && row.value === 'hello' && row.bindingId === publisherBinding.bindingId));
  const parsePrinted = prefix => result.stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
  const samples = parsePrinted('FIRST_AUDIO_SAMPLE:'), finals = parsePrinted('FIRST_AUDIO_FINAL:');
  assert.ok(samples.length > 10); assert.equal(finals.length, 1);
  const observed = finals[0];
  assert.equal(observed.sceneId, scene.record.id); assert.equal(observed.visitIndex, 1);
  assert.deepEqual(observed.state, { last_event: 'hello' }); assert.equal(observed.stateRevision, 1);
  assert.equal(observed.failed, false); assert.equal(observed.finished, false);
  assert.equal(observed.nativeAudioDriver, 'Dummy');
  assert.deepEqual(Object.keys(observed.tracks).sort(), [unselectedTrack.id, selectedTrack.id].sort());
  for (const track of [unselectedTrack, selectedTrack]) {
    const player = observed.tracks[track.id];
    assert.equal(player.nativeClass, 'AudioStreamPlayer'); assert.equal(player.streamPresent, true); assert.equal(player.streamClass, 'AudioStreamWAV');
    assert.ok(Math.abs(player.gain - track.volume) < 0.000001, JSON.stringify(player));
    assert.equal(player.loopMode, track.loop ? 1 : 0); assert.ok(player.lengthSeconds > 0);
    assert.equal(player.playing, track === selectedTrack);
  }
  assert.notEqual(observed.tracks[selectedTrack.id].streamInstanceId, observed.tracks[unselectedTrack.id].streamInstanceId, 'Shared PCM retains separate track stream/loop instances.');
  assert.ok(observed.observedPlayingSeconds > observed.tracks[selectedTrack.id].lengthSeconds);
  const generatedAfter = {}, resourceAfter = {};
  for (const [name, bytes] of generated.files) { const after = await fs.readFile(path.join(directory, name)); assert.deepEqual(after, bytes, name); generatedAfter[name] = sha(after); }
  for (const [id, name] of generated.resourceFiles) resourceAfter[name] = { resourceId: id, sha256: sha(await fs.readFile(path.join(directory, name))) };
  assert.deepEqual(resourceAfter, resourceBefore);
  const after = await tree(author); assert.deepEqual(after, before);
  await writeJSON('author-after.json', after);
  await writeJSON('observer-result.json', { samples, final: observed });
  await writeJSON('events.json', received);
  finalVerification = { ok: true, tool, driver: { path: 'scripts/tests/scene-behavior-create-audio-native-smoke.mjs', sha256: sha(await fs.readFile(fileURLToPath(import.meta.url))) },
    author: { root: author, documents: registry.documents.length, assets: registry.assets.length, fileCount: Object.keys(before).length, unchanged: true, before: 'author-before.json', after: 'author-after.json' },
    identities: { assemblyId: assembly.record.id, sceneId: scene.record.id, audioId: audio.record.id, behaviorId: behavior.record.id, audioBindingId: audioBinding.bindingId, publisherBindingId: publisherBinding.bindingId, selectedTrackId: selectedTrack.id, unselectedTrackId: unselectedTrack.id },
    officialScripts: Object.fromEntries(Object.entries(sources).map(([id, row]) => [id, { objectId: row.record.id, sourcePath: row.record.sourcePath, sha256: sha(row.content) }])),
    generatedBefore, generatedAfter, resourceBefore, resourceAfter, events: events.length, samples: samples.length, observation: observed,
    checks: ['The browser-created author has one saved scene, two unchanged official scripts, a two-binding first behavior, one two-track audio declaration, and a one-member assembly.', 'An authored deferred checkpoint publication delivers hello to both real behavior callbacks; last_event and the selected second-track playback originate from those callbacks.', 'A read-only independent child observes native AudioStreamPlayer and AudioStreamWAV instances, separate loop settings and gains, and selected playback beyond one source duration.', 'The first effect track never receives a command and remains stopped. No authored cues simulate behavior playback.', 'Ordinary project close produces a valid finished event; every canonical generated file, resource and author file remains byte-for-byte unchanged.'],
    limitations: ['Headless Godot with the Dummy audio driver validates native playback state, stream decoding and looping; it does not claim physical speaker output or a listening test.', 'This is a seven-document first-behavior audio slice, not a complete game or installed desktop application test.'] };
  await writeJSON('verification.json', finalVerification);
  console.log(JSON.stringify({ ok: true, events: events.length, samples: samples.length, generatedFiles: generated.files.size, authorFiles: Object.keys(before).length, authorDocuments: registry.documents.length, assets: registry.assets.length }));
} catch (error) {
  const after = await tree(author); await writeJSON('author-after.json', after);
  await writeJSON('failure.json', { ok: false, name: error.name, message: error.message, stack: error.stack, authorUnchanged: JSON.stringify(after) === JSON.stringify(before), phases: phases.map(({ phase, status }) => ({ phase, status })) });
  throw error;
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
