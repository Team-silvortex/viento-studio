import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
import { createSceneAudioTrackProposal, prepareSceneAudioApply } from '../../engine/scene-audio-edit.mjs';
import { createSceneAudioCreationService } from '../lib/scene-audio-creation-service.mjs';
import { validateSceneAudioPlan } from '../../engine/scene-audio.mjs';
import { GODOT4_EXECUTION_ADAPTER } from '../backends/godot4-adapter.mjs';
import { projectAudioControlAuthor } from './helpers/project-audio-control-author-fixture.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
const id = n => `12345678-1111-4111-8111-${String(n).padStart(12, '0')}`;
const json = value => JSON.stringify(value, null, 2) + '\n';
const sourcePath = 'documents/audio/demo.json', sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', audioId = '88888888-8888-4888-8888-888888888888';
async function authors(root) {
  const files = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name), name = path.relative(root, file);
    if (!name.startsWith('.viento/')) files[name] = buildHash(await fs.readFile(file));
  }
  return files;
}
async function propose(content, edit, name = sourcePath) {
  const source = { sourcePath: name, token: 'test:track-workflow', content, sourceRevision: 'sha256:' + buildHash(content), baseSourceRevision: 'sha256:' + buildHash(content) };
  const proposal = await createSceneAudioTrackProposal(source, edit);
  return prepareSceneAudioApply(source, proposal, { digest: buildHash });
}
test('track edits preserve surplus metadata/assets while freezing only currently used audio bytes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-audio-tracks-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(new URL('../../examples/scene-audio/', import.meta.url), root, { recursive: true });
  const read = async name => JSON.parse(await fs.readFile(path.join(root, name)));
  const write = (name, value) => fs.writeFile(path.join(root, name), json(value));
  const original = await read(sourcePath), wave = original.tracks[0].resourceId;
  const resource = await read(`metadata/assets/${wave}.json`);
  await fs.copyFile(path.join(root, 'assets/tone.wav'), path.join(root, 'assets/extra.wav'));
  await write(`metadata/assets/${id(1)}.json`, { ...resource, id: id(1), name: 'Unused generated tone', location: { ...resource.location, path: 'extra.wav' }, legacyPaths: ['assets/extra.wav'] });
  const metadataPath = `metadata/documents/${audioId}.json`, metadata = await read(metadataPath);
  metadata.assetBindings.push({ assetId: id(1), role: 'audio' }); await write(metadataPath, metadata);
  original.tracks.push({ ...original.tracks[1], id: id(2), resourceId: id(1) }); await write(sourcePath, original);
  const initial = await authors(root), content = await fs.readFile(path.join(root, sourcePath), 'utf8');
  const capturedBefore = await captureBuildSnapshot(root, sceneId); assert.equal(capturedBefore.ok, true); assert.equal(capturedBefore.resources.size, 2);
  const tracks = [original.tracks[0], { ...original.tracks[0], id: id(3), role: 'effect', volume: .2, loop: false }];
  const cues = original.cues.map(cue => cue.trackId === original.tracks[1].id ? { ...cue, trackId: id(3) } : cue);
  const applied = await propose(content, { tracks, cues }); assert.deepEqual(await authors(root), initial);
  // Simulate the already-reviewed ordinary save, separate from proposal creation.
  await fs.writeFile(path.join(root, sourcePath), applied.afterContent);
  const after = await authors(root); assert.deepEqual(after, { ...initial, [sourcePath]: buildHash(applied.afterContent) });
  const result = await captureBuildSnapshot(root, sceneId); assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.plan.audio.document.tracks, tracks); assert.equal(result.resources.size, 1); assert.deepEqual(result.plan.resources.map(row => row.id), [wave]);
  assert.deepEqual(validateSceneAudioPlan(result.plan).document.tracks, tracks);
  assert.deepEqual(result.plan.audio.locations.tracks.map(row => [row.id, row.declaration.propertyPath]), [[tracks[0].id, '/tracks/0'], [tracks[1].id, '/tracks/1']]);
  const context = await createSceneAudioCreationService(root).inspect({ sceneObjectId: sceneId });
  assert.equal(context.status, 'ready'); assert.equal(context.manifest.trackCount, 2); assert.deepEqual(context.manifest.assetBindings, metadata.assetBindings); assert.equal(context.resources.length, 2);
  const generated = await GODOT4_EXECUTION_ADAPTER.generate(result.plan); assert.deepEqual([...generated.resourceFiles.keys()], [wave]);
  assert.deepEqual(JSON.parse(generated.files.get('audio.json')).tracks.map(({ file, ...track }) => track), tracks);
  assert.deepEqual(await authors(root), after);
});

test('removing a cue-free track does not rewrite dynamic behavior references and real runtime reports the stale ID', {
  skip: !process.env.VIENTO_GODOT_BIN && 'Set VIENTO_GODOT_BIN to verify dynamic behavior references after track removal',
}, async t => {
  const f = await projectAudioControlAuthor(t), name = 'documents/audio/first.json', file = path.join(f.author, name);
  const content = await fs.readFile(file, 'utf8'), original = JSON.parse(content); assert.deepEqual(original.cues, []);
  const initial = await authors(f.author), tracks = original.tracks.filter(track => track.id !== f.trackId); assert.equal(tracks.length, 1);
  const applied = await propose(content, { tracks, cues: [] }, name); await fs.writeFile(file, applied.afterContent);
  const after = await authors(f.author); assert.deepEqual(after, { ...initial, [name]: buildHash(applied.afterContent) });
  const output = path.join(f.temporary, 'removed-track'), tool = process.env.VIENTO_GODOT_BIN;
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  const ran = await runProjectBuild({ buildDirectory: output, tool, headless: true, smoke: true });
  assert.equal(ran.ok, false); assert.equal(ran.status, 'failed');
  assert.ok(ran.record.diagnostics.some(row => row.code === 'runtime_behavior_audio_track' && row.sourcePath === 'documents/behaviors/demo.json' && row.bindingId === f.receiverBindingId), JSON.stringify(ran.record.diagnostics));
  assert.equal(ran.record.events.some(row => row.event === 'audio-command' || row.event === 'finished'), false);
  assert.deepEqual(await authors(f.author), after);
});
