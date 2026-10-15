import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAudioControlAuthor } from './helpers/project-audio-control-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
const tool = process.env.VIENTO_GODOT_BIN;
const real = { skip: !tool ? 'Set VIENTO_GODOT_BIN for real project audio control' : false };
async function build(t, edit) {
  const f = await projectAudioControlAuthor(t); if (edit) await edit(f);
  const output = path.join(f.temporary, 'audio-control-build');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  return { ...f, output };
}
async function run(f, options = {}) {
  return runProjectBuild({ buildDirectory: f.output, tool, headless: true, smoke: true, ...options });
}
const commands = result => result.record.events.filter(event => event.event === 'audio-command');

test('real ready and event requests reach declared scene audio before A→B→A and reset on a new run', real, async t => {
  const f = await build(t);
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = await run(f); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result.diagnostics));
    const { events, runtime } = result.record, rows = commands(result);
    assert.equal(events[0].protocol, 4); assert.equal(events[0].audioCommandSequence, 0);
    assert.equal(events.at(-1).audioCommandSequence, f.expectedAudioSequence);
    assert.deepEqual(rows.map(row => row.commandSequence), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(rows.map(row => row.action), f.expectedAudioActions);
    assert.deepEqual(rows.map(row => row.visitIndex), f.expectedAudioVisits);
    assert.ok(rows.every(row => row.timeSeconds === 0 && row.trackId === f.trackId));
    assert.equal(runtime.project.audioCommands.sequence, 8);
    assert.deepEqual(runtime.project.audioCommands.entries.map(row => row.track.source.objectId), [f.firstAudioId, f.firstAudioId, f.firstAudioId, f.secondAudioId, f.secondAudioId, f.firstAudioId, f.firstAudioId, f.firstAudioId]);
    assert.equal(runtime.project.audioCommands.entries[0].origin.bindingId, f.receiverBindingId);
    assert.equal(runtime.project.events.sequence, f.expectedSequence);
    assert.equal(runtime.project.sharedState.revision, f.expectedRevision);
    for (const visit of [1, 2, 3]) {
      const ready = events.findIndex(row => row.event === 'scene-event' && row.visitIndex === visit && row.stream === 'audio' && row.frame.event === 'ready');
      const first = events.findIndex(row => row.event === 'audio-command' && row.visitIndex === visit);
      const last = events.findLastIndex(row => row.event === 'audio-command' && row.visitIndex === visit);
      const exit = events.findIndex(row => row.event === 'scene-exit' && row.visitIndex === visit);
      assert.ok(ready < first && last < exit);
    }
    assert.equal(events.some(row => row.event === 'scene-event' && row.stream === 'audio' && row.frame.event === 'command'), false, 'empty cue manifests do not invent timeline commands');
  }
});

const writeScript = (f, name, source) => fs.writeFile(path.join(f.author, `documents/scripts/${name}.txt`), source);
async function isolated(f, source) {
  await writeScript(f, 'publisher', 'extends Node\n');
  await writeScript(f, 'second', 'extends Node\n');
  await writeScript(f, 'checkpoint', source);
}
async function jsonEdit(f, name, edit) {
  const file = path.join(f.author, name), value = JSON.parse(await fs.readFile(file)); edit(value);
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
}
const printed = (result, prefix) => result.record.phases.at(-1).stdout.split('\n').filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
function rejected(result, f, code) {
  assert.equal(result.ok, false); assert.equal(result.status, 'failed'); assert.ok(result.record, JSON.stringify(result));
  assert.ok(result.record.diagnostics.some(item => item.code === code && item.bindingId === f.receiverBindingId
    && item.sourcePath === 'documents/behaviors/demo.json'), JSON.stringify(result.record.diagnostics));
  assert.equal(result.record.diagnostics.some(item => item.code === 'runtime_project_protocol_invalid'), false, JSON.stringify(result.record.diagnostics));
  assert.equal(result.record.events.some(event => event.event === 'finished'), false);
}

test('the unchanged built-in audio starter compiles with a declared track and safely guards a single scene', real, async t => {
  const { listScriptStarters } = await import('../../engine/script-authoring.mjs');
  const starter = listScriptStarters().find(item => item.id === 'godot-project-audio'); assert.ok(starter);
  const f = await build(t, async value => {
    await isolated(value, starter.content);
    await jsonEdit(value, 'documents/behaviors/demo.json', manifest => { manifest.bindings[0].parameters = { track_id: value.trackId }; });
  });
  const result = await run(f); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics));
  assert.deepEqual(commands(result).map(row => row.action), ['play']);
  assert.equal(result.record.events.filter(row => row.event === 'event-delivery' && row.status === 'handled').length, 1);
  const output = path.join(f.temporary, 'single-audio-starter');
  const single = await buildProject({ root: f.author, scene: f.sceneIds[0], tool, output });
  assert.equal(single.ok, true, JSON.stringify(single.diagnostics || single.record?.diagnostics));
  const guarded = await runProjectBuild({ buildDirectory: output, tool, headless: true, smoke: true });
  assert.equal(guarded.ok, true, JSON.stringify(guarded.record?.diagnostics));
  assert.equal(guarded.record.events.some(row => row.event === 'audio-command'), false);
});

test('initial requested playback follows authored time-zero cues and retains later timeline order', real, async t => {
  const f = await build(t, async value => {
    await isolated(value, `extends Node
func _ready() -> void:
\tprint("ACCEPTED:" + JSON.stringify(get_meta("viento_project").play_audio("${value.trackId}")))
`);
    await jsonEdit(value, 'documents/audio/first.json', audio => {
      audio.cues = [0, 0.25, 0.5].map((atSeconds, index) => ({ id: `12345678-1234-4234-8234-123456789b0${index}`, trackId: value.trackId, atSeconds, action: index === 2 ? 'play' : 'stop' }));
    });
  });
  const result = await run(f); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics));
  assert.deepEqual(printed(result, 'ACCEPTED:'), [true]);
  const rows = result.record.events.flatMap(row => row.event === 'audio-command' ? [['manual', row.action, row.timeSeconds]]
    : row.event === 'scene-event' && row.stream === 'audio' && row.frame.event === 'command' ? [['timeline', row.frame.action, row.frame.atSeconds]] : []);
  assert.deepEqual(rows, [['timeline', 'stop', 0], ['manual', 'play', 0], ['timeline', 'stop', 0.25], ['timeline', 'play', 0.5]]);
});

test('old visit audio ports cannot control an identically named track in the next scene', real, async t => {
  const f = await build(t, async value => {
    await isolated(value, `extends Node
static var old_port
func _ready() -> void:
\told_port = get_meta("viento_project")
\told_port.play_audio("${value.trackId}")
\told_port.request_scene("${value.sceneIds[1]}")
`);
    await writeScript(value, 'second', `extends Node
func _ready() -> void:
\tvar old = load("res://behaviors/${value.scriptId}.gd").old_port
\tprint("STALE_AUDIO:" + JSON.stringify([old.play_audio("${value.trackId}"), old.stop_audio("${value.trackId}")]))
\tget_meta("viento_project").play_audio("${value.trackId}")
`);
  });
  const result = await run(f); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics));
  assert.deepEqual(printed(result, 'STALE_AUDIO:'), [[false, false]]);
  assert.deepEqual(commands(result).map(row => row.visitIndex), [1, 2]);
  assert.deepEqual(result.record.runtime.project.audioCommands.entries.map(row => row.track.source.objectId), [f.firstAudioId, f.secondAudioId]);
  const events = result.record.events;
  const stopped = events.findIndex(row => row.event === 'scene-event' && row.visitIndex === 1 && row.stream === 'audio' && row.frame.event === 'finished');
  const entered = events.findIndex(row => row.event === 'scene-enter' && row.visitIndex === 2);
  assert.ok(stopped > 0 && stopped < entered);
});

for (const [name, argument] of [['boolean track', 'true'], ['unknown track', '"12345678-1234-4234-8234-123456789fff"']]) {
  test(`real ${name} is rejected at its owning binding without a playback receipt`, real, async t => {
    const f = await build(t, value => isolated(value, `extends Node
func _ready() -> void:
\tprint("AUDIO_REJECTED:" + JSON.stringify(get_meta("viento_project").play_audio(${argument})))
`));
    const result = await run(f); rejected(result, f, 'runtime_behavior_audio_track');
    assert.deepEqual(printed(result, 'AUDIO_REJECTED:'), [false]); assert.equal(commands(result).length, 0);
  });
}

test('a scene without audio cannot access another project member audio declaration', real, async t => {
  const f = await build(t, async value => {
    await isolated(value, `extends Node
func _ready() -> void:
\tget_meta("viento_project").stop_audio("${value.trackId}")
`);
    await jsonEdit(value, `metadata/documents/${value.sceneIds[0]}.json`, record => { record.relations = record.relations.filter(row => row.targetId !== value.firstAudioId); });
  });
  const result = await run(f); rejected(result, f, 'runtime_behavior_audio_track'); assert.equal(commands(result).length, 0);
});

test('a failing event callback discards its accepted audio request without inventing playback', real, async t => {
  const f = await build(t, value => isolated(value, `extends Node
var p
func _ready() -> void:
\tp = get_meta("viento_project")
\tp.subscribe_event("sound", _on_sound)
\tp.publish_event("sound", true)
func _on_sound(_value) -> bool:
\tprint("AUDIO_ACCEPTED:" + JSON.stringify(p.play_audio("${value.trackId}")))
\treturn false
`));
  const result = await run(f); rejected(result, f, 'runtime_behavior_event_callback');
  assert.deepEqual(printed(result, 'AUDIO_ACCEPTED:'), [true]); assert.equal(commands(result).length, 0);
});

test('the 65th pending audio request fails before any queued player operation', real, async t => {
  const f = await build(t, value => isolated(value, `extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tvar accepted := 0
\tfor i in range(65):
\t\tif p.play_audio("${value.trackId}"):
\t\t\taccepted += 1
\tprint("AUDIO_ACCEPTED_COUNT:" + JSON.stringify(accepted))
`));
  const result = await run(f); rejected(result, f, 'runtime_behavior_audio_limit');
  assert.deepEqual(printed(result, 'AUDIO_ACCEPTED_COUNT:'), [64]); assert.equal(commands(result).length, 0);
});

test('the 257th session request is rejected while the previous 256 real operations remain attributable', real, async t => {
  const f = await build(t, async value => {
    const source = next => `extends Node
func _ready() -> void:
\tvar p = get_meta("viento_project")
\tfor i in range(64):
\t\tif not p.stop_audio("${value.trackId}"):
\t\t\treturn
\tp.request_scene("${next}")
`;
    await isolated(value, source(value.sceneIds[1])); await writeScript(value, 'second', source(value.sceneIds[0]));
  });
  const result = await run(f, { timeoutMs: 60000 }); rejected(result, f, 'runtime_behavior_audio_limit');
  assert.equal(commands(result).length, 256);
  assert.deepEqual(commands(result).map(row => row.commandSequence), Array.from({ length: 256 }, (_, index) => index + 1));
  assert.equal(result.record.runtime.project.audioCommands.sequence, 256);
});

test('native audio becoming unavailable between acceptance and execution has no success receipt', real, async t => {
  const f = await build(t, value => isolated(value, `extends Node
func _ready() -> void:
\tcall_deferred("_probe")
func _probe() -> void:
\t# Test-only access to emulate a scene runtime failure after track admission.
\tget_tree().root.get_node("VientoProject/VientoScene").audio_started = false
\tprint("AUDIO_ACCEPTED:" + JSON.stringify(get_meta("viento_project").play_audio("${value.trackId}")))
`));
  const result = await run(f); rejected(result, f, 'runtime_behavior_audio_unavailable');
  assert.deepEqual(printed(result, 'AUDIO_ACCEPTED:'), [true]); assert.equal(commands(result).length, 0);
});

test('window close drains callback playback before audio shutdown and project completion', real, async t => {
  const f = await build(t, value => isolated(value, `extends Node
var p
func _ready() -> void:
\tp = get_meta("viento_project")
\tp.subscribe_event("close", _on_close)
\tp.publish_event("close", true)
func _on_close(_value) -> bool:
\tget_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)
\treturn p.play_audio("${value.trackId}")
`));
  const result = await run(f, { smoke: false }); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics));
  const events = result.record.events;
  const delivery = events.findIndex(row => row.event === 'event-delivery');
  const played = events.findIndex(row => row.event === 'audio-command');
  const stopped = events.findIndex(row => row.event === 'scene-event' && row.stream === 'audio' && row.frame.event === 'finished');
  assert.ok(delivery < played && played < stopped); assert.equal(events.at(-1).audioCommandSequence, 1);
});

test('behavior audio requests produce native PCM, loop across the WAV duration and stop to true silence', real, async t => {
  let silentTrack;
  const f = await build(t, async value => {
    await jsonEdit(value, 'documents/audio/first.json', audio => { audio.tracks[1].volume = 0; silentTrack = audio.tracks[1].id; });
    await isolated(value, `extends Node
var capture := AudioEffectCapture.new()
var p
func peak() -> float:
\tvar maximum := 0.0
\tfor frame in capture.get_buffer(capture.get_frames_available()):
\t\tmaximum = maxf(maximum, maxf(absf(frame.x), absf(frame.y)))
\treturn maximum
func _ready() -> void:
\tp = get_meta("viento_project")
\tcall_deferred("_probe")
func _probe() -> void:
\t# Test-only local bus capture observes real samples without system output.
\tAudioServer.add_bus()
\tvar bus := AudioServer.bus_count - 1
\tAudioServer.set_bus_name(bus, "VientoControlCapture")
\tcapture.buffer_length = 1.0
\tAudioServer.add_bus_effect(bus, capture)
\tAudioServer.set_bus_mute(bus, true)
\tvar scene = get_tree().root.get_node("VientoProject/VientoScene")
\tfor player in scene.audio_players.values():
\t\tplayer.bus = "VientoControlCapture"
\tp.play_audio("${value.trackId}")
\tawait get_tree().create_timer(1.1).timeout
\tcapture.clear_buffer()
\tawait get_tree().create_timer(0.2).timeout
\tvar audible := peak()
\tvar looped: bool = scene.audio_players["${value.trackId}"].playing
\tp.stop_audio("${value.trackId}")
\tawait get_tree().create_timer(0.1).timeout
\tcapture.clear_buffer()
\tawait get_tree().create_timer(0.15).timeout
\tvar stopped := peak()
\tp.play_audio("${silentTrack}")
\tawait get_tree().create_timer(0.1).timeout
\tcapture.clear_buffer()
\tawait get_tree().create_timer(0.15).timeout
\tvar silent := peak()
\tp.stop_audio("${silentTrack}")
\tprint("AUDIO_CONTROL_PCM:" + JSON.stringify({"audiblePeak": audible, "stoppedPeak": stopped, "zeroGainPeak": silent, "loopPlayingAfterDuration": looped}))
\tget_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)
`);
  });
  const result = await run(f, { smoke: false, timeoutMs: 60000 }); assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics));
  const [capture] = printed(result, 'AUDIO_CONTROL_PCM:'); assert.ok(capture, JSON.stringify(result.record));
  assert.ok(capture.audiblePeak > 0.01); assert.equal(capture.stoppedPeak, 0); assert.equal(capture.zeroGainPeak, 0); assert.equal(capture.loopPlayingAfterDuration, true);
  assert.deepEqual(commands(result).map(row => [row.action, row.trackId]), [['play', f.trackId], ['stop', f.trackId], ['play', silentTrack], ['stop', silentTrack]]);
  assert.ok(commands(result).at(-1).timeSeconds > 1.5); t.diagnostic(JSON.stringify(capture));
});
