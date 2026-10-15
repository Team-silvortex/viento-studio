import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSceneAudioCreationDraft } from '../../engine/scene-audio-create-plan.mjs';
import { createSceneAudioCreationRequest, captureSceneAudioCreationContext, confirmSceneAudioCreation, validateSceneAudioCreationResult } from '../../engine/scene-audio-creation-contract.mjs';
import { createSceneAudioCreationService } from '../lib/scene-audio-creation-service.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { transactionHash } from '../lib/world-transaction-state.mjs';
import { audioFixture, fingerprint, targetContents, childAudio, json, sceneId, resourceId, manifestId, actorId, journal } from './helpers/world-audio-create-fixture.mjs';

for (const version of [2, 3]) test(`audio.create workspace v${version} preview predicts three files and apply feeds the existing audio build without changing any asset`, async t => {
  const f = await audioFixture(t, version), before = await fingerprint(f.root), preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.deepEqual(await fingerprint(f.root), before); assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  assert.equal(preview.object.id, manifestId); assert.equal(preview.scene.id, sceneId);
  assert.deepEqual(preview.changes.map(change => change.kind), ['audio.create', 'relation.add']);
  const applied = await f.execute(f.input), observed = await readWorldSnapshot(f.root), built = await captureBuildSnapshot(f.root, sceneId);
  assert.equal(applied.receipt.state, 'committed'); assert.equal(applied.revision, preview.revision); assert.equal(observed.projection.world.revision, preview.revision);
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics)); assert.equal(built.plan.audio.document.tracks.length, 2);
  assert.equal(built.resources.has(resourceId), true);
  const [source, record, sceneRecord] = await targetContents(f); assert.equal(source, f.input.content);
  assert.deepEqual(JSON.parse(record).relations, [{ kind: 'references', targetId: sceneId, slot: '' }]);
  assert.deepEqual(JSON.parse(record).assetBindings, [{ assetId: resourceId, role: 'audio' }]);
  assert.deepEqual(JSON.parse(sceneRecord).relations.filter(relation => relation.kind === 'audio'), [{ kind: 'audio', targetId: manifestId, slot: '' }]);
  assert.ok(sceneRecord.includes('900719925474099312345')); assert.ok(sceneRecord.includes('\r\n'));
  const after = await fingerprint(f.root);
  for (const [name, hash] of Object.entries(before)) if (name !== f.files[2]) assert.equal(after[name], hash, name);
  assert.deepEqual(Object.keys(after).filter(name => !Object.hasOwn(before, name)).sort(), [f.files[0], f.files[1], `${journal}/head.json`].sort());
  await assert.rejects(f.execute(f.input), { errorCode: 'world_revision_conflict' });
});

test('scene definition and registration edits invalidate preview before any audio target publishes', async t => {
  for (const target of ['scene', 'actor', 'record', 'asset-record']) {
    const f = await audioFixture(t); await f.execute({ ...f.input, mode: 'preview' });
    const relative = target === 'scene' ? f.scenePath : target === 'actor' ? `${f.documents}/characters/traveler.md` : target === 'record' ? f.files[2] : `metadata/assets/${resourceId}.json`;
    if (target.includes('record')) { const record = JSON.parse(await fs.readFile(path.join(f.root, relative))); record.changedByAuthor = true; await fs.writeFile(path.join(f.root, relative), json(record)); }
    else await fs.appendFile(path.join(f.root, relative), '\n');
    const before = await fingerprint(f.root);
    await assert.rejects(f.execute(f.input), { errorCode: 'world_revision_conflict' });
    assert.deepEqual(await fingerprint(f.root), before);
  }
});

test('same-size PCM substitution is rejected on preview, apply and the final pre-intent check even when mtimes are restored', async t => {
  for (const phase of ['preview', 'apply', 'intent']) {
    const f = await audioFixture(t), file = path.join(f.root, f.assetPath), original = fs.rename; let changed = false;
    const replace = async () => { const stat = await fs.stat(file), bytes = await fs.readFile(file); bytes[60] ^= 1; await fs.writeFile(file, bytes); await fs.utimes(file, stat.atime, stat.mtime); changed = true; };
    if (phase === 'apply') await f.execute({ ...f.input, mode: 'preview' });
    if (phase === 'intent') fs.rename = async (from, to) => { const result = await original.call(fs, from, to); if (!changed && String(to).endsWith('/audio-dependencies.json')) await replace(); return result; };
    else await replace();
    try { await assert.rejects(f.execute({ ...f.input, mode: phase === 'preview' ? 'preview' : 'apply' }), { errorCode: 'world_audio_resource_changed' }); }
    finally { fs.rename = original; }
    assert.equal(changed, true); assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
    assert.deepEqual(await fs.readdir(path.join(f.root, journal)).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
  }
});

test('correctly registered non-PCM WAV remains an imported resource but cannot be selected for scene creation', async t => {
  const f = await audioFixture(t), file = path.join(f.root, f.assetPath), bytes = await fs.readFile(file); bytes.writeUInt16LE(3, 20); await fs.writeFile(file, bytes);
  const metadata = path.join(f.root, `metadata/assets/${resourceId}.json`), record = JSON.parse(await fs.readFile(metadata)); record.content.sha256 = transactionHash(bytes).slice(7); await fs.writeFile(metadata, json(record));
  const observed = await readWorldSnapshot(f.root); f.input.baseRevision = observed.projection.world.revision;
  const before = await fingerprint(f.root); await assert.rejects(f.execute({ ...f.input, mode: 'preview' }), { errorCode: 'world_audio_resource_format' });
  assert.deepEqual(await fingerprint(f.root), before);
});

test('parallel in-process and real multi-process requests cannot attach two first audio declarations', async t => {
  const f = await audioFixture(t), results = await Promise.allSettled([f.execute(f.input), f.execute(f.input)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.errorCode, 'world_revision_conflict');
  const g = await audioFixture(t), file = path.join(g.root, '.parallel-request.json'); await fs.writeFile(file, JSON.stringify(g.input));
  const children = await Promise.all([childAudio(g, file), childAudio(g, file)]); await fs.rm(file);
  assert.equal(children.filter(child => child.result?.status === 'applied').length, 1, JSON.stringify(children));
  const refused = children.find(child => !child.result); assert.equal(refused.exitCode, 1);
  assert.ok(['world_revision_conflict', 'world_write_busy'].includes(refused.failure?.errorCode), JSON.stringify(refused));
  assert.equal(JSON.parse((await targetContents(g))[2]).relations.filter(relation => relation.kind === 'audio').length, 1);
});

test('occupied portable aliases source links and resource links preserve foreign files and refuse writes', async t => {
  for (const kind of ['occupied', 'source-link', 'resource-link']) {
    const f = await audioFixture(t), outside = path.join(f.root, 'outside-data'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep'), 'foreign');
    if (kind === 'occupied') await fs.mkdir(path.join(f.root, `${f.documents}/audio/CREATED.JSON`));
    else if (kind === 'source-link') { await fs.symlink(outside, path.join(f.root, `${f.documents}/linked`)); f.input.sourcePath = `${f.documents}/linked/created.json`; }
    else { const original = await fs.readFile(path.join(f.root, f.assetPath)); await fs.writeFile(path.join(outside, 'tone.wav'), original); await fs.rm(path.join(f.root, f.assetPath)); await fs.symlink(path.join(outside, 'tone.wav'), path.join(f.root, f.assetPath)); }
    await assert.rejects(f.execute(f.input)); assert.equal(await fs.readFile(path.join(outside, 'keep'), 'utf8'), 'foreign');
    assert.deepEqual((await targetContents(f)).slice(0, 2), [null, null]);
  }
});

test('external resource store supports creation without moving or writing its WAV', async t => {
  const f = await audioFixture(t), external = await fs.mkdtemp('/tmp/viento-audio-external-'); t.after(() => fs.rm(external, { recursive: true, force: true }));
  await fs.rename(path.join(f.root, f.assetPath), path.join(external, 'tone.wav')); await fs.mkdir(path.join(f.root, '.viento'), { recursive: true });
  await fs.writeFile(path.join(f.root, '.viento/local.json'), json({ version: 1, assetStores: { main: external } }));
  const bytes = await fs.readFile(path.join(external, 'tone.wav'));
  const applied = await f.execute(f.input); assert.equal(applied.status, 'applied'); assert.deepEqual(await fs.readFile(path.join(external, 'tone.wav')), bytes);
});

test('a resource-store switch while staging preserves the author change and publishes no declaration', async t => {
  const f = await audioFixture(t), external = await fs.mkdtemp('/tmp/viento-audio-switched-'); t.after(() => fs.rm(external, { recursive: true, force: true }));
  await fs.copyFile(path.join(f.root, f.assetPath), path.join(external, 'tone.wav'));
  const original = fs.rename; let changed = false;
  fs.rename = async (from, to) => {
    const result = await original.call(fs, from, to);
    if (!changed && String(to).endsWith('/audio-dependencies.json')) {
      changed = true; await fs.writeFile(path.join(f.root, '.viento/local.json'), json({ version: 1, assetStores: { main: external } }));
    }
    return result;
  };
  try { await assert.rejects(f.execute(f.input), { errorCode: 'world_audio_resource_changed' }); }
  finally { fs.rename = original; }
  assert.equal(changed, true); assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root, '.viento/local.json'))).assetStores.main, external);
});

function initialAudioDraft(f, mode) {
  return createSceneAudioCreationDraft({ sceneObjectId: sceneId, tracks: f.manifest.tracks.map((track, index) => {
    const cue = f.manifest.cues.find(item => item.trackId === track.id), behavior = mode === 'behavior' || index === 1;
    return { trackId: track.id, cueId: cue.id, resourceId: track.resourceId, role: track.role, volume: track.volume, loop: track.loop,
      startMode: behavior ? 'behavior' : 'timeline', ...(behavior ? {} : { atSeconds: cue.atSeconds }) };
  }) });
}
for (const mode of ['mixed', 'behavior']) test(`${mode} first audio creation previews without writes and persists exact sources and dependencies`, async t => {
  const f = await audioFixture(t), planned = initialAudioDraft(f, mode); assert.equal(planned.ok, true);
  const catalogService = createSceneAudioCreationService(f.root), catalog = captureSceneAudioCreationContext(await catalogService.inspect({ sceneObjectId: sceneId }), sceneId);
  const request = createSceneAudioCreationRequest(catalog, { objectId: f.input.objectId, documentType: f.input.documentType, sourcePath: f.input.sourcePath, content: planned.content });
  const before = await fingerprint(f.root), preview = await f.execute(request), hash = transactionHash(planned.content);
  assert.deepEqual(await fingerprint(f.root), before); assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  assert.deepEqual(validateSceneAudioCreationResult(preview, request, catalog, hash), preview);
  const applyRequest = { ...request, mode: 'apply' }, applied = await f.execute(applyRequest);
  assert.deepEqual(validateSceneAudioCreationResult(applied, applyRequest, catalog, hash), applied);
  const [source, record, sceneRecord] = await targetContents(f), built = await captureBuildSnapshot(f.root, sceneId);
  assert.equal(source, planned.content); assert.equal(JSON.parse(source).cues.length, mode === 'behavior' ? 0 : 1);
  assert.equal(JSON.parse(source).tracks.length, 2); assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  assert.deepEqual(built.plan.audio.document, JSON.parse(source)); assert.equal(built.resources.has(resourceId), true);
  assert.deepEqual(JSON.parse(record).assetBindings, [{ assetId: resourceId, role: 'audio' }]);
  assert.deepEqual(JSON.parse(sceneRecord).relations.filter(item => item.kind === 'audio'), [{ kind: 'audio', targetId: manifestId, slot: '' }]);
  const ready = captureSceneAudioCreationContext(await catalogService.inspect({ sceneObjectId: sceneId }), sceneId);
  assert.equal(ready.status, 'ready'); assert.equal(ready.manifest.trackCount, 2); assert.equal(ready.manifest.content, planned.content);
  assert.equal(confirmSceneAudioCreation(ready, applyRequest, hash), true);
  const after = await fingerprint(f.root);
  for (const [name, digest] of Object.entries(before)) if (name !== f.files[2]) assert.equal(after[name], digest, name);
  assert.deepEqual(Object.keys(after).filter(name => !Object.hasOwn(before, name)).sort(), [f.files[0], f.files[1], `${journal}/head.json`].sort());
});

test('behavior-only startup still verifies registered WAV bytes during preview and apply', async t => {
  for (const mode of ['preview', 'apply']) {
    const f = await audioFixture(t), planned = initialAudioDraft(f, 'behavior'); assert.equal(planned.ok, true);
    f.input.content = planned.content;
    if (mode === 'apply') await f.execute({ ...f.input, mode: 'preview' });
    const file = path.join(f.root, f.assetPath), bytes = await fs.readFile(file); bytes[60] ^= 1; await fs.writeFile(file, bytes);
    const before = await fingerprint(f.root);
    await assert.rejects(f.execute({ ...f.input, mode }), { errorCode: 'world_audio_resource_changed' });
    assert.deepEqual(await fingerprint(f.root), before); assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  }
});
