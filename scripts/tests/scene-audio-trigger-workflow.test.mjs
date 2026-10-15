import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAudioControlAuthor } from './helpers/project-audio-control-author-fixture.mjs';
import { createSceneAudioCreationDraft } from '../../engine/scene-audio-create-plan.mjs';
import { createSceneAudioCreationRequest } from '../../engine/scene-audio-creation-contract.mjs';
import { createSceneAudioCreationService } from '../lib/scene-audio-creation-service.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
const tool = process.env.VIENTO_GODOT_BIN;
async function authors(root) {
  const files = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name), name = path.relative(root, file);
    if (!name.startsWith('.viento/')) files[name] = buildHash(await fs.readFile(file));
  }
  return files;
}

test('behavior-only creation retains resources and drives real project events without any automatic audio cue', {
  skip: !tool && 'Set VIENTO_GODOT_BIN to run actual behavior audio creation',
}, async t => {
  const f = await projectAudioControlAuthor(t), sceneId = f.sceneIds[0], sourcePath = 'documents/audio/first.json';
  const original = JSON.parse(await fs.readFile(path.join(f.author, sourcePath)));
  const metadataPath = `metadata/documents/${f.firstAudioId}.json`, sceneMetadataPath = `metadata/documents/${sceneId}.json`;
  await fs.rm(path.join(f.author, sourcePath)); await fs.rm(path.join(f.author, metadataPath));
  const scene = JSON.parse(await fs.readFile(path.join(f.author, sceneMetadataPath)));
  scene.relations = scene.relations.filter(relation => relation.kind !== 'audio');
  await fs.writeFile(path.join(f.author, sceneMetadataPath), JSON.stringify(scene, null, 2) + '\n');
  const before = await authors(f.author), service = createSceneAudioCreationService(f.author), execute = createWorldCommandService(f.author);
  const context = await service.inspect({ sceneObjectId: sceneId }); assert.equal(context.status, 'empty');
  const draft = createSceneAudioCreationDraft({ sceneObjectId: sceneId, tracks: original.tracks.map((track, index) => ({
    trackId: track.id, cueId: `12345678-1111-4111-8111-00000000000${index}`, resourceId: track.resourceId,
    role: track.role, volume: track.volume, loop: track.loop, startMode: 'behavior',
  })) });
  assert.equal(draft.ok, true, JSON.stringify(draft.diagnostics)); assert.deepEqual(JSON.parse(draft.content), original);
  const request = createSceneAudioCreationRequest(context, { objectId: f.firstAudioId, documentType: 'audio', sourcePath, content: draft.content });
  await execute(request); assert.deepEqual(await authors(f.author), before);
  const committed = await execute({ ...request, mode: 'apply' }); assert.equal(committed.receipt.state, 'committed');
  const after = await authors(f.author);
  assert.deepEqual(Object.keys(after).filter(name => after[name] !== before[name]).sort(), [sourcePath, metadataPath, sceneMetadataPath].sort());
  assert.equal(await fs.readFile(path.join(f.author, sourcePath), 'utf8'), draft.content);
  const record = JSON.parse(await fs.readFile(path.join(f.author, metadataPath)));
  assert.deepEqual(record.assetBindings, [...new Set(original.tracks.map(track => track.resourceId))].sort().map(assetId => ({ assetId, role: 'audio' })));
  assert.equal((await service.inspect({ sceneObjectId: sceneId })).status, 'ready');
  const output = path.join(f.temporary, 'created-behavior-audio');
  const built = await buildProject({ root: f.author, targetId: f.assemblyId, tool, output });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  const ran = await runProjectBuild({ buildDirectory: output, tool, headless: true, smoke: true });
  assert.equal(ran.ok, true, JSON.stringify(ran.record?.diagnostics));
  const runtime = ran.record.runtime.project, commands = runtime.audioCommands;
  assert.equal(runtime.protocolVersion, 4); assert.equal(commands.sequence, f.expectedAudioSequence);
  assert.deepEqual(commands.entries.map(entry => entry.action), f.expectedAudioActions);
  assert.deepEqual(commands.entries.map(entry => entry.origin.visitIndex), f.expectedAudioVisits);
  assert.deepEqual(commands.entries.map(entry => entry.track.source.objectId), f.expectedAudioVisits.map(visit => visit === 2 ? f.secondAudioId : f.firstAudioId));
  assert.equal(runtime.sharedState.revision, f.expectedRevision); assert.equal(runtime.events.sequence, f.expectedSequence);
  assert.equal(ran.record.events.some(event => event.event === 'scene-event' && event.stream === 'audio' && event.frame.event === 'command'), false);
  assert.deepEqual(await authors(f.author), after);
});
