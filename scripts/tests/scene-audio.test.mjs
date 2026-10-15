import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { createScene2DPlan } from '../../engine/build-plan.mjs';
import { validateSceneAudioPlan, stripSceneAudioPlan } from '../../engine/scene-audio.mjs';
import { createSceneAudioEventReader } from '../../engine/scene-audio-events.mjs';
import { createRuntimeEventReader } from '../backends/godot4-instances.mjs';
import { validatePcmWave } from '../lib/audio-wav.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
const source = new URL('../../examples/scene-audio/', import.meta.url);
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', audioId = '88888888-8888-4888-8888-888888888888';
const captured = await captureBuildSnapshot(source.pathname, sceneId), fixture = await readWorldSnapshot(source.pathname);
const rawAudio = observed => observed.source.documents.find(item => item.record?.id === audioId);
const sceneRecord = observed => observed.source.documents.find(item => item.record?.id === sceneId).record;
const generate = observed => createScene2DPlan(observed, sceneId);
const line = value => 'VIENTO_AUDIO:' + JSON.stringify(value) + '\n';
const runtime = value => 'VIENTO_RUNTIME:' + JSON.stringify(value) + '\n';
function frames(plan = captured.plan) {
  const audio = plan.audio.document;
  const actors = plan.actors.map(actor => ({ instanceId: actor.instanceId, objectId: actor.objectId, position: actor.position, state: 'idle' }));
  const ready = runtime({ protocol: 2, event: 'ready', sceneObjectId: sceneId, actors });
  const audioReady = line({ protocol: 1, event: 'ready', sceneObjectId: sceneId, trackIds: audio.tracks.map(track => track.id) });
  const commands = audio.cues.map(cue => ({ protocol: 1, event: 'command', cueId: cue.id, trackId: cue.trackId,
    resourceId: audio.tracks.find(track => track.id === cue.trackId).resourceId, atSeconds: cue.atSeconds, action: cue.action }));
  const audioFinished = line({ protocol: 1, event: 'finished', timeSeconds: .5 });
  const finished = runtime({ protocol: 2, event: 'finished', actors, fixedDelta: .25 });
  return { ready, audioReady, commands, audioFinished, finished };
}
function reader(plan = captured.plan) { return createSceneAudioEventReader(plan, { createBaseReader: createRuntimeEventReader }); }

test('saved audio opts into independent capabilities and one exact resource copy', () => {
  assert.equal(captured.ok, true); const plan = captured.plan;
  assert.equal(plan.schemaVersion, 2); assert.equal(plan.audio.document.tracks.length, 2);
  assert.equal(plan.resources.length, 1); assert.equal(captured.resources.size, 1);
  assert.equal(buildHash(captured.resources.get(plan.resources[0].id)), plan.resources[0].sha256);
  assert.deepEqual(plan.requiredCapabilities.slice(-2), ['audio.nonspatial', 'audio.timeline']);
  assert.equal(validateSceneAudioPlan(plan).document.sceneObjectId, sceneId);
  const stripped = stripSceneAudioPlan(plan); assert.equal(stripped.audio, undefined); assert.equal(stripped.resources.length, 0);
  assert.ok(plan.audio.locations.tracks[0].declaration.sourceRange.exact);
});

test('unlinked audio stays data and does not silently alter old scene plans', () => {
  const observed = structuredClone(fixture); sceneRecord(observed).relations = sceneRecord(observed).relations.filter(item => item.kind !== 'audio');
  const result = generate(observed); assert.equal(result.ok, true); assert.equal(result.plan.audio, undefined);
  assert.deepEqual(result.plan, stripSceneAudioPlan(captured.plan));
});

test('missing, duplicate, unbound, malformed and wrong-scene declarations reject with author provenance', () => {
  const changes = [
    observed => { rawAudio(observed).content = null; },
    observed => { sceneRecord(observed).relations.push({ kind: 'audio', targetId: audioId }); },
    observed => { rawAudio(observed).record.assetBindings = []; },
    observed => { rawAudio(observed).record.relations = []; },
    observed => { const item = rawAudio(observed); item.content = item.content.replace('"volume": 0.12', '"volume": 3'); },
    observed => { const item = rawAudio(observed); item.content = item.content.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'); },
    observed => { const item = rawAudio(observed); item.content = item.content.replace(sceneId, audioId); },
    observed => { observed.source.assets[0].record.kind = 'image'; },
    observed => { observed.source.assets[0].record.content.sha256 = 'invalid'; },
  ];
  for (const change of changes) {
    const observed = structuredClone(fixture); change(observed); const result = generate(observed);
    assert.equal(result.ok, false); assert.equal(result.plan, null); assert.ok(result.diagnostics.length);
    assert.ok(result.diagnostics.every(item => [sceneId, audioId].includes(item.objectId)));
  }
});

test('cue execution sorts stably while source pointers retain original indices', () => {
  const observed = structuredClone(fixture), source = rawAudio(observed), value = JSON.parse(source.content);
  [value.cues[0], value.cues[2]] = [value.cues[2], value.cues[0]]; source.content = JSON.stringify(value);
  const result = generate(observed); assert.equal(result.ok, true);
  assert.equal(result.plan.audio.document.cues[0].atSeconds, 0);
  assert.equal(result.plan.audio.locations.cues.find(item => item.id === value.cues[2].id).declaration.propertyPath, '/cues/2');
});

test('frozen plan rejects foreign locations, extra resources and missing capabilities', () => {
  for (const change of [p => { p.audio.manifest.sourcePath = '../foreign.json'; }, p => { p.audio.locations.tracks[0].declaration.objectId = sceneId; },
    p => { p.resources.push({ ...p.resources[0], id: '00000000-0000-4000-8000-000000000001' }); }, p => { p.requiredCapabilities.pop(); }]) {
    const plan = structuredClone(captured.plan); change(plan); assert.throws(() => validateSceneAudioPlan(plan), error => error.errorCode === 'build_audio_invalid');
  }
});

test('Bevy routes explicitly reject audio capabilities rather than discard sound', () => {
  const registry = createExecutionBackendRegistry();
  for (const id of ['org.viento.bevy', 'org.viento.bevy-rust']) {
    const adapter = registry.resolve(id); const diagnostics = checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', plan: captured.plan });
    assert.ok(diagnostics.some(item => item.code === 'build_capability_missing' && item.capability === 'audio.nonspatial'));
    const stripped = structuredClone(captured.plan); stripped.requiredCapabilities = ['scene2d'];
    const bypass = checkExecutionBackendSupport(adapter.descriptor, { operation: 'build', plan: stripped });
    assert.ok(bypass.some(item => item.code === 'build_audio_invalid'));
    assert.ok(bypass.some(item => item.code === 'build_capability_missing'));
  }
});

test('PCM container enforces exact lengths, type, rate and aligned data without changing bytes', async () => {
  const bytes = await fs.readFile(new URL('assets/tone.wav', source));
  assert.deepEqual(validatePcmWave(bytes), { channels: 1, sampleRate: 22050, frameBytes: 2, frames: 22050 });
  for (const edit of [b => b.writeUInt32LE(1, 4), b => b.writeUInt16LE(3, 20), b => b.writeUInt16LE(3, 22),
    b => b.writeUInt32LE(1, 24), b => b.writeUInt16LE(8, 34), b => b.writeUInt32LE(44099, 40)]) {
    const corrupt = Buffer.from(bytes); edit(corrupt); assert.throws(() => validatePcmWave(corrupt), error => error.errorCode === 'build_audio_format');
  }
  assert.throws(() => validatePcmWave(bytes.subarray(0, 43)));
});

test('audio byte drift and invalid PCM report the declaration resource field', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-audio-capture-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(source, root, { recursive: true });
  const file = path.join(root, 'assets/tone.wav'), bytes = await fs.readFile(file); bytes[0] = 0; await fs.writeFile(file, bytes);
  let result = await captureBuildSnapshot(root, sceneId); assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].objectId, audioId); assert.equal(result.diagnostics[0].propertyPath, '/tracks/0/resourceId');
  const recordFile = path.join(root, 'metadata/assets/99999999-9999-4999-8999-999999999999.json'), record = JSON.parse(await fs.readFile(recordFile));
  record.content.sha256 = buildHash(bytes); await fs.writeFile(recordFile, JSON.stringify(record));
  result = await captureBuildSnapshot(root, sceneId); assert.equal(result.ok, false); assert.equal(result.diagnostics[0].code, 'build_audio_format');
});

test('audio stream admits chunked commands without changing actor lifecycle', () => {
  const f = frames(), r = reader(), text = f.ready + f.audioReady + f.commands.map(line).join('') + f.audioFinished + f.finished;
  for (let i = 0; i < text.length; i += 7) r.push(text.slice(i, i + 7));
  assert.equal(r.finish().diagnostics.length, 0); assert.equal(r.events.filter(item => item.event === 'audio').length, 5);
  assert.equal(r.events.at(-1).event, 'finished');
});

test('audio stream rejects reorder, forgery, duplicate, premature finish and missing completion', () => {
  const f = frames();
  for (const audio of [line(f.commands[0]), f.audioReady + line(f.commands[1]), f.audioReady + line({ ...f.commands[0], resourceId: sceneId }),
    f.audioReady + line(f.commands[0]) + line(f.commands[0]), f.audioReady + f.audioFinished, f.audioReady]) {
    const r = reader(); r.push(f.ready + audio + f.finished); assert.ok(r.finish().diagnostics.length);
  }
});

test('audio diagnostics can only identify a frozen track and cannot supply their own source path', () => {
  const f = frames(), track = captured.plan.audio.document.tracks[0];
  const diagnostic = { protocol: 1, event: 'diagnostic', severity: 'error', code: 'runtime_audio_failed', message: 'Cannot load stream.', trackId: track.id, resourceId: track.resourceId };
  const r = reader(); r.push(f.ready + line(diagnostic)); assert.equal(r.diagnostics[0].objectId, audioId); assert.equal(r.diagnostics[0].propertyPath, '/tracks/0');
  const forged = reader(); forged.push(f.ready + line({ ...diagnostic, sourcePath: '/etc/passwd' })); assert.equal(forged.diagnostics[0].code, 'runtime_audio_protocol_invalid');
});

test('oversized audio frame is discarded once and cannot become a valid suffix', () => {
  const f = frames(), r = reader(); r.push(f.ready + 'VIENTO_AUDIO:' + 'x'.repeat(70000)); r.push(line({ protocol: 1, event: 'ready' }));
  r.push(f.audioReady + f.commands.map(line).join('') + f.audioFinished + f.finished);
  assert.equal(r.finish().diagnostics.length, 1); assert.equal(r.events.filter(item => item.audioEvent === 'ready').length, 1);
});
