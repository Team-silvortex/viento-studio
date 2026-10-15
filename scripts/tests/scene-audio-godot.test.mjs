import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { generateGodotProject } from '../backends/godot4-dispatch.mjs';
import { generateGodotBehaviorProject } from '../backends/godot4-behaviors.mjs';
import { stripSceneAudioPlan } from '../../engine/scene-audio.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v2.json', import.meta.url)));
const uuid = n => `99999999-9999-4999-8999-${String(n).padStart(12, '0')}`;
const ids = { manifest: uuid(1), wave: uuid(2), music: uuid(3), effect: uuid(4), source: uuid(5), behavior: uuid(6), binding: uuid(7) };
function pcmWave() {
  const samples = 8000, data = Buffer.alloc(samples * 2), header = Buffer.alloc(44);
  for (let index = 0; index < samples; index++) data.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 220 / 8000) * 16000), index * 2);
  header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(8000, 24); header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
const wave = pcmWave();
function plan({ behavior = false } = {}) {
  const value = structuredClone(golden.plan);
  value.resources = [{ id: ids.wave, sha256: hash(wave), size: wave.length, extension: 'wav', kind: 'audio' }];
  value.actors.forEach(actor => { delete actor.imageResourceId; });
  value.requiredCapabilities = ['scene2d', 'input.arrows', 'state.movement', 'audio.nonspatial', 'audio.timeline'];
  const document = { format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: value.scene.objectId,
    tracks: [{ id: ids.music, resourceId: ids.wave, role: 'music', volume: 0.25, loop: true },
      { id: ids.effect, resourceId: ids.wave, role: 'effect', volume: 0, loop: false }],
    cues: [[0, ids.music, 'play'], [0, ids.effect, 'play'], [0.2, ids.music, 'stop'], [0.25, ids.music, 'play'],
      [0.25, ids.effect, 'stop'], [0.5, ids.music, 'stop'], [0.6, ids.music, 'play']]
      .map(([atSeconds, trackId, action], index) => ({ id: uuid(20 + index), trackId, atSeconds, action })) };
  const manifest = { objectId: ids.manifest, sourcePath: 'documents/scene-audio.json', sourceRevision: `sha256:${hash(JSON.stringify(document))}` };
  value.audio = { format: 'viento-audio-plan', schemaVersion: 1, manifest, document,
    locations: { tracks: document.tracks.map((track, index) => ({ id: track.id, declaration: { ...manifest, propertyPath: `/tracks/${index}` } })),
      cues: document.cues.map((cue, index) => ({ id: cue.id, declaration: { ...manifest, propertyPath: `/cues/${index}` } })) } };
  if (behavior) {
    value.schemaVersion = 3; value.requiredCapabilities.push('behavior.bindings', 'behavior.gdscript');
    const content = 'extends Node\nsignal arrived(value: int)\nfunc _ready() -> void:\n\tarrived.emit(7)\n';
    const manifest = { objectId: ids.behavior, sourcePath: 'documents/behaviors.json', sourceRevision: `sha256:${hash('{}')}` };
    value.behaviors = { format: 'viento-behavior-plan', schemaVersion: 1, backendId: 'org.viento.godot4', language: 'gdscript', manifest,
      sources: [{ objectId: ids.source, sourcePath: 'documents/ready.txt', sourceRevision: `sha256:${hash(content)}`, language: 'gdscript', content }],
      bindings: [{ bindingId: ids.binding, instanceId: value.actors[0].instanceId, objectId: value.actors[0].objectId,
        implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: ids.source }, parameters: {},
        events: [{ signal: 'arrived', event: 'arrival' }], declaration: { ...manifest, propertyPath: '/bindings/0' } }] };
  }
  return value;
}
async function materialize(t, value) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-audio-godot-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const generated = await adapter.generate(value);
  for (const [file, bytes] of generated.files) { await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true }); await fs.writeFile(path.join(directory, file), bytes); }
  for (const [resourceId, file] of generated.resourceFiles) {
    assert.equal(resourceId, ids.wave); await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true }); await fs.writeFile(path.join(directory, file), wave);
  }
  return { directory, generated };
}
const godot = process.env.VIENTO_GODOT_BIN;
const real = { skip: !godot ? 'Set VIENTO_GODOT_BIN for real Godot audio execution' : false };
const audioFrames = result => result.stdout.split('\n').filter(line => line.startsWith('VIENTO_AUDIO:')).map(line => JSON.parse(line.slice('VIENTO_AUDIO:'.length)));
async function prepare(t, value) {
  const f = await materialize(t, value), tool = await adapter.identify(godot);
  for (const phase of adapter.buildPhases) {
    const result = await adapter.executePhase({ phase, directory: f.directory, tool });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
    assert.deepEqual(adapter.diagnostics(result, value), [], result.stdout + result.stderr);
  }
  return { ...f, tool };
}

test('audio composes with scene and behavior bases without changing their frozen files', async () => {
  for (const behavior of [false, true]) {
    const value = plan({ behavior }), before = structuredClone(value), result = await adapter.generate(value);
    const legacy = await (behavior ? generateGodotBehaviorProject : generateGodotProject)(stripSceneAudioPlan(value));
    for (const [file, bytes] of legacy.files) if (file !== 'main.tscn') assert.deepEqual(result.files.get(file), bytes, file);
    assert.match(result.files.get('main.tscn').toString(), /res:\/\/audio-runtime.gd/);
    assert.match(result.files.get('audio-runtime.gd').toString(), behavior ? /^extends "res:\/\/behavior-runtime.gd"/ : /^extends "res:\/\/runtime.gd"/);
    assert.equal(result.resourceFiles.get(ids.wave), `audio/${ids.wave}.wav`); assert.equal(result.imageFiles.size, 0);
    assert.equal(result.backend.version, '0.6.0'); assert.equal(result.backend.protocolVersion, value.schemaVersion);
    assert.deepEqual(result.sourceMap.objects, legacy.sourceMap.objects); assert.deepEqual(result.sourceMap.audio.tracks[0].declaration, value.audio.locations.tracks[0].declaration);
    const cues = JSON.parse(result.files.get('audio.json')).cues;
    assert.deepEqual(cues.map(({ atSecondsBytes, ...cue }) => cue), value.audio.document.cues);
    for (const cue of cues) assert.equal(Buffer.from(cue.atSecondsBytes).readDoubleLE(), cue.atSeconds);
    assert.deepEqual(value, before);
  }
});

test('audio resources keep a dedicated path alongside existing images', async () => {
  const value = plan(); value.resources.unshift(structuredClone(golden.plan.resources[0]));
  value.actors[0].imageResourceId = golden.ids.image; value.requiredCapabilities.push('image');
  const result = await adapter.generate(value);
  assert.equal(result.imageFiles.size, 1); assert.equal(result.resourceFiles.size, 2);
  assert.equal(result.resourceFiles.get(golden.ids.image), `images/${golden.ids.image}.svg`);
  assert.equal(result.sourceMap.resources.find(item => item.resourceId === ids.wave).generatedPath, `audio/${ids.wave}.wav`);
  assert.equal(JSON.parse(result.files.get('scene.json')).actors[0].imageFile, `images/${golden.ids.image}.svg`);
});

test('adapter refuses malformed audio plans before generating a project', async () => {
  for (const mutate of [value => value.audio.document.tracks[0].resourceId = uuid(99), value => value.resources[0].extension = 'mp3',
    value => value.audio.document.tracks[0].volume = -1, value => value.audio.document.tracks[0].loop = 1,
    value => value.audio.document.cues[0].action = 'execute', value => value.audio.document.cues[0].atSeconds = 61,
    value => value.audio.document.sceneObjectId = uuid(99), value => value.audio.locations.tracks[0].declaration.sourcePath = '/etc/passwd']) {
    const value = plan(); mutate(value); await assert.rejects(adapter.generate(value));
  }
});

test('control replay rejects audio composition explicitly before starting a process', async t => {
  const f = await materialize(t, plan());
  await assert.rejects(adapter.executePhase({ phase: 'run', tool: { executable: process.execPath }, directory: f.directory,
    controlProgram: { format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.25, steps: [{ left: false, right: false, up: false, down: false }] } }),
    { errorCode: 'runtime_control_unsupported' });
});

test('real Godot executes ready, fixed-step audio, same-time order and final cleanup exactly once', real, async t => {
  for (const behavior of [false, true]) {
    const value = plan({ behavior }), f = await prepare(t, value), reader = adapter.createEventReader(value);
    const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.tool,
      onOutput: chunk => { if (chunk.stream === 'stdout') reader.push(chunk.text); } }); reader.finish();
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(reader.diagnostics, [], result.stdout + result.stderr);
    const frames = audioFrames(result), commands = frames.filter(frame => frame.event === 'command');
    assert.equal(frames[0].event, 'ready'); assert.equal(frames.at(-1).event, 'finished'); assert.equal(frames.at(-1).timeSeconds, 0.5);
    assert.equal(frames.filter(frame => frame.event === 'finished').length, 1);
    assert.deepEqual(commands.map(frame => [frame.cueId, frame.action, frame.atSeconds]), value.audio.document.cues.slice(0, 6).map(cue => [cue.id, cue.action, cue.atSeconds]));
    assert.equal(reader.events.filter(event => event.event === 'finished').length, 1);
    if (behavior) assert.deepEqual(reader.events.find(event => event.event === 'behavior').arguments, [7]);
    assert.equal(reader.events.at(-1).event, 'finished');
  }
});

test('real Godot reports a missing WAV as a source-owned audio error without a false finish', real, async t => {
  const value = plan(), f = await prepare(t, value);
  await fs.rm(path.join(f.directory, `audio/${ids.wave}.wav`)); await fs.rm(path.join(f.directory, '.godot'), { recursive: true, force: true });
  const reader = adapter.createEventReader(value);
  const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.tool,
    onOutput: chunk => { if (chunk.stream === 'stdout') reader.push(chunk.text); } }); reader.finish();
  assert.notEqual(result.status, 'succeeded');
  const diagnostic = reader.diagnostics.find(item => item.code === 'runtime_audio_failed');
  assert.ok(diagnostic, result.stdout + result.stderr); assert.equal(diagnostic.sourcePath, value.audio.manifest.sourcePath);
  assert.equal(diagnostic.resourceId, ids.wave); assert.ok(diagnostic.propertyPath.startsWith('/tracks/0'));
  assert.ok(!reader.events.some(event => event.event === 'finished'));
});

test('real Godot mixes nonzero PCM, preserves independent loop modes and makes gain zero silent', real, async t => {
  const value = plan(), f = await prepare(t, value);
  // A generated-project test harness captures the native bus before muting its
  // output. It neither changes system audio settings nor relies on a speaker.
  const probe = `extends "res://audio-runtime.gd"
var capture := AudioEffectCapture.new()
func peak() -> float:
\tvar maximum := 0.0
\tfor frame in capture.get_buffer(capture.get_frames_available()):
\t\tmaximum = maxf(maximum, maxf(absf(frame.x), absf(frame.y)))
\treturn maximum
func _ready() -> void:
\tAudioServer.add_bus()
\tvar bus := AudioServer.bus_count - 1
\tAudioServer.set_bus_name(bus, "VientoTestCapture")
\tcapture.buffer_length = 1.0
\tAudioServer.add_bus_effect(bus, capture)
\tAudioServer.set_bus_mute(bus, true)
\tsuper._ready()
\tset_process(false)
\tfor player in audio_players.values():
\t\tplayer.stop()
\t\tplayer.bus = "VientoTestCapture"
\tvar music: AudioStreamPlayer = audio_players["${ids.music}"]
\tvar effect: AudioStreamPlayer = audio_players["${ids.effect}"]
\tif music.stream == effect.stream or music.stream.loop_mode != AudioStreamWAV.LOOP_FORWARD or effect.stream.loop_mode != AudioStreamWAV.LOOP_DISABLED or db_to_linear(effect.volume_db) != 0.0:
\t\tpush_error("Independent audio configuration failed")
\t\tget_tree().quit(1)
\t\treturn
\teffect.play()
\tawait get_tree().create_timer(0.25).timeout
\tvar silent := peak()
\teffect.stop()
\tcapture.clear_buffer()
\tmusic.play()
\tawait get_tree().create_timer(1.1).timeout
\tcapture.clear_buffer()
\tawait get_tree().create_timer(0.2).timeout
\tvar audible := peak()
\tvar looped := music.playing
\taudio_shutdown()
\tawait get_tree().create_timer(0.1).timeout
\tcapture.clear_buffer()
\tawait get_tree().create_timer(0.15).timeout
\tvar stopped := peak()
\tprint("VIENTO_AUDIO_CAPTURE:" + JSON.stringify({"zeroGainPeak": silent, "quarterGainPeak": audible, "stoppedPeak": stopped, "loopModesIndependent": true, "loopPlayingAfterDuration": looped}))
\tif silent != 0.0 or audible < 0.01 or stopped != 0.0 or not looped or music.playing or effect.playing:
\t\tpush_error("Native audio capture mismatch")
\t\tget_tree().quit(1)
\telse:
\t\tget_tree().quit()
`;
  await fs.writeFile(path.join(f.directory, 'capture-probe.gd'), probe);
  await fs.writeFile(path.join(f.directory, 'main.tscn'), f.generated.files.get('main.tscn').toString().replace('res://audio-runtime.gd', 'res://capture-probe.gd'));
  const result = await adapter.executePhase({ phase: 'run', smoke: false, directory: f.directory, tool: f.tool });
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(adapter.diagnostics(result, value), [], result.stdout + result.stderr);
  const frame = result.stdout.split('\n').find(line => line.startsWith('VIENTO_AUDIO_CAPTURE:'));
  assert.ok(frame, result.stdout + result.stderr); const capture = JSON.parse(frame.slice('VIENTO_AUDIO_CAPTURE:'.length));
  assert.equal(capture.zeroGainPeak, 0); assert.ok(capture.quarterGainPeak > 0.01); assert.equal(capture.stoppedPeak, 0);
  assert.equal(capture.loopModesIndependent, true); assert.equal(capture.loopPlayingAfterDuration, true);
  t.diagnostic(JSON.stringify(capture));
});


test('audio import diagnostics use the resource declaration instead of an arbitrary log path', () => {
  const value = plan(), diagnostics = adapter.diagnostics({ status: 'failed', stdout: '',
    stderr: `ERROR: Cannot decode audio/${ids.wave}.wav, sourcePath=/etc/passwd` }, value);
  const item = diagnostics.find(item => item.resourceId === ids.wave);
  assert.equal(item.objectId, ids.manifest); assert.equal(item.sourcePath, value.audio.manifest.sourcePath);
  assert.equal(item.propertyPath, '/tracks/0/resourceId');
});

test('real Godot delivery relocates with audio bytes intact and regenerates only owned import caches', real, async t => {
  const value = plan({ behavior: true }), f = await prepare(t, value);
  const first = await adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.tool });
  assert.equal(first.status, 'succeeded', first.stdout + first.stderr);
  await adapter.cleanupProject(f.directory, { generatedFiles: [...f.generated.files.keys()], resourceFiles: [...f.generated.resourceFiles.values()] });
  const relocated = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-audio-delivery-'));
  t.after(() => fs.rm(relocated, { recursive: true, force: true }));
  await fs.cp(f.directory, relocated, { recursive: true });
  const known = new Set([...f.generated.files.keys(), ...f.generated.resourceFiles.values()]);
  const walk = async (directory, prefix = '') => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), `${relative}/`);
      else assert.ok(known.has(relative), relative);
    }
  };
  await walk(relocated);
  for (const [file, bytes] of f.generated.files) assert.deepEqual(await fs.readFile(path.join(relocated, file)), bytes);
  assert.deepEqual(await fs.readFile(path.join(relocated, `audio/${ids.wave}.wav`)), wave);
  for (const phase of adapter.buildPhases) {
    const result = await adapter.executePhase({ phase, directory: relocated, tool: f.tool });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(adapter.diagnostics(result, value), []);
  }
  const reader = adapter.createEventReader(value), second = await adapter.executePhase({ phase: 'run', directory: relocated, tool: f.tool,
    onOutput: chunk => { if (chunk.stream === 'stdout') reader.push(chunk.text); } }); reader.finish();
  assert.equal(second.status, 'succeeded', second.stdout + second.stderr); assert.deepEqual(reader.diagnostics, []);
  assert.deepEqual(audioFrames(second), audioFrames(first));
  assert.deepEqual(reader.events.find(event => event.event === 'behavior').arguments, [7]);
});

test('actor smoke completion cannot conceal a shortened audio timeline', () => {
  const value = plan(), reader = adapter.createEventReader(value);
  const actors = value.actors.map(actor => ({ instanceId: actor.instanceId, objectId: actor.objectId, position: actor.position, state: 'idle' }));
  const runtime = frame => `VIENTO_RUNTIME:${JSON.stringify(frame)}\n`, audio = frame => `VIENTO_AUDIO:${JSON.stringify(frame)}\n`;
  reader.push(runtime({ protocol: 2, event: 'ready', sceneObjectId: value.scene.objectId, actors }));
  reader.push(audio({ protocol: 1, event: 'ready', sceneObjectId: value.scene.objectId, trackIds: value.audio.document.tracks.map(track => track.id) }));
  for (const cue of value.audio.document.cues.filter(cue => cue.atSeconds === 0)) {
    reader.push(audio({ protocol: 1, event: 'command', cueId: cue.id, trackId: cue.trackId,
      resourceId: value.audio.document.tracks.find(track => track.id === cue.trackId).resourceId, atSeconds: 0, action: cue.action }));
  }
  reader.push(audio({ protocol: 1, event: 'finished', timeSeconds: 0 }));
  reader.push(runtime({ protocol: 2, event: 'finished', actors, fixedDelta: 0.25 }));
  assert.ok(reader.finish().diagnostics.some(item => item.code === 'runtime_audio_protocol_invalid'));
});

test('real Godot preserves valid high precision cue timing through the audio protocol', real, async t => {
  const value = plan(); value.audio.document.cues[0].atSeconds = 0.12345678901234567;
  for (const [id, atSeconds] of [[uuid(90), 0.49999999999999994], [uuid(91), 0.5000000000000001]]) {
    const index = value.audio.document.cues.length;
    value.audio.document.cues.push({ id, trackId: ids.effect, action: 'play', atSeconds });
    value.audio.locations.cues.push({ id, declaration: { ...value.audio.manifest, propertyPath: `/cues/${index}` } });
  }
  const f = await prepare(t, value), reader = adapter.createEventReader(value);
  const result = await adapter.executePhase({ phase: 'run', directory: f.directory, tool: f.tool,
    onOutput: chunk => { if (chunk.stream === 'stdout') reader.push(chunk.text); } }); reader.finish();
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr); assert.deepEqual(reader.diagnostics, [], result.stdout + result.stderr);
  const commands = reader.events.filter(event => event.audioEvent === 'command');
  assert.equal(commands.length, 7);
  assert.equal(commands[0].cueId, value.audio.document.cues[1].id);
  assert.equal(commands[1].cueId, value.audio.document.cues[0].id);
  assert.equal(commands[1].atSeconds, value.audio.document.cues[0].atSeconds);
  assert.equal(commands.at(-2).cueId, uuid(90)); assert.equal(commands.at(-2).atSeconds, 0.49999999999999994);
  assert.ok(!commands.some(command => command.cueId === uuid(91)));
});
