import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSceneAudioCreationService } from '../lib/scene-audio-creation-service.mjs';
import { audioFixture, fingerprint, sceneId, manifestId, resourceId, json } from './helpers/world-audio-create-fixture.mjs';
const id = n => `${String(n).padStart(8, '0')}-3333-4333-8333-333333333333`;

test('catalog is read-only and saved-world pinned; successful apply converges from empty to ready with the exact persisted source', async t => {
  const f = await audioFixture(t), service = createSceneAudioCreationService(f.root), before = await fingerprint(f.root);
  const value = await service.inspect({ sceneObjectId: sceneId });
  assert.equal(value.format, 'viento-audio-creation-context'); assert.equal(value.status, 'empty'); assert.equal(value.manifest, null);
  assert.equal(value.documentRoot, f.documents); assert.equal(value.scene.objectId, sceneId);
  assert.equal(value.resources.length, 1); assert.equal(value.resources[0].availability, 'unverified'); assert.equal(value.resources[0].resourceId, resourceId);
  for (const rev of [value.baseRevision, value.scene.sourceRevision, value.scene.objectRevision, value.resources[0].resourceRevision]) assert.match(rev, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(value).includes(f.root), false); assert.ok(Object.isFrozen(value.resources[0]));
  assert.deepEqual(await fingerprint(f.root), before);
  await f.execute(f.input); const ready = await service.inspect({ sceneObjectId: sceneId });
  assert.equal(ready.status, 'ready'); assert.equal(ready.manifest.objectId, manifestId); assert.equal(ready.manifest.content, f.input.content); assert.equal(ready.manifest.trackCount, 2);
  assert.ok(Object.isFrozen(ready.manifest.assetBindings[0]));
});

test('catalog does not inspect PCM bytes and excludes missing, other-format and oversized registrations without hiding existing generic media', async t => {
  const f = await audioFixture(t), service = createSceneAudioCreationService(f.root), bytes = await fs.readFile(path.join(f.root, f.assetPath));
  bytes.writeUInt16LE(3, 20); await fs.writeFile(path.join(f.root, f.assetPath), bytes);
  assert.equal((await service.inspect({ sceneObjectId: sceneId })).resources.length, 1);
  const template = JSON.parse(await fs.readFile(path.join(f.root, `metadata/assets/${resourceId}.json`)));
  for (const [n, ext, size, missing] of [[1, 'wav', 100, false], [2, 'ogg', 100, false], [3, 'wav', 34 * 1024 * 1024, true], [4, 'wav', 100, true]]) {
    const record = { ...template, legacyPaths: [], id: id(n), location: { store: 'main', path: `candidate-${n}.${ext}` }, content: { ...template.content, size } };
    await fs.writeFile(path.join(f.root, `metadata/assets/${id(n)}.json`), json(record));
    if (!missing) await fs.writeFile(path.join(f.root, 'assets', record.location.path), Buffer.alloc(size));
  }
  assert.deepEqual(new Set((await service.inspect({ sceneObjectId: sceneId })).resources.map(x => x.resourceId)), new Set([resourceId, id(1)]));
});

test('catalog snapshots requests before await and refuses accessors, aliases, extras and malformed identity without calling getters', async t => {
  const f = await audioFixture(t), service = createSceneAudioCreationService(f.root), payload = { sceneObjectId: sceneId };
  const pending = service.inspect(payload); payload.sceneObjectId = manifestId; assert.equal((await pending).scene.objectId, sceneId);
  let calls = 0; const getter = { get sceneObjectId() { calls++; return sceneId; } };
  for (const input of [null, [], {}, getter, { sceneObjectId: sceneId, execute: true }, { sceneObjectId: sceneId, [Symbol('x')]: 1 }, Object.create({ sceneObjectId: sceneId }), { sceneObjectId: '../bad' }]) {
    await assert.rejects(service.inspect(input), { errorCode: 'world_command_invalid' });
  }
  assert.equal(calls, 0);
});

test('catalog refuses dangling or ambiguous audio relations instead of offering duplicate first creation', async t => {
  for (const relations of [[{ kind: 'audio', targetId: manifestId }], [{ kind: 'audio', targetId: manifestId }, { kind: 'audio', targetId: resourceId }]]) {
    const f = await audioFixture(t), file = path.join(f.root, f.files[2]), record = JSON.parse(await fs.readFile(file)); record.relations.push(...relations); await fs.writeFile(file, json(record));
    const before = await fingerprint(f.root); await assert.rejects(createSceneAudioCreationService(f.root).inspect({ sceneObjectId: sceneId }));
    assert.deepEqual(await fingerprint(f.root), before);
  }
});

test('catalog navigates the existing example reference relation without demanding a newly canonical registration', async t => {
  const f = await audioFixture(t), oldManifestId = '88888888-8888-4888-8888-888888888888';
  for (const relative of ['documents/audio/demo.json', `metadata/documents/${oldManifestId}.json`, `metadata/documents/${sceneId}.json`]) {
    await fs.copyFile(new URL('../../examples/scene-audio/' + relative, import.meta.url), path.join(f.root, relative));
  }
  const { captureSceneAudioCreationContext } = await import('../../engine/scene-audio-creation-contract.mjs');
  const value = captureSceneAudioCreationContext(await createSceneAudioCreationService(f.root).inspect({ sceneObjectId: sceneId }), sceneId);
  assert.equal(value.status, 'ready'); assert.equal(value.manifest.objectId, oldManifestId);
  assert.deepEqual(value.manifest.relations, [{ kind: 'reference', targetId: sceneId, slot: 'scene' }]);
});

test('catalog permits 256 candidates without reading their audio and refuses overflow explicitly', async t => {
  const f = await audioFixture(t), service = createSceneAudioCreationService(f.root);
  const template = JSON.parse(await fs.readFile(path.join(f.root, `metadata/assets/${resourceId}.json`)));
  const add = async n => {
    const record = { ...template, id: id(n), legacyPaths: [], location: { store: 'main', path: `candidate-${n}.wav` }, content: { ...template.content, size: 44 } };
    await fs.writeFile(path.join(f.root, `metadata/assets/${id(n)}.json`), json(record)); await fs.writeFile(path.join(f.root, 'assets', record.location.path), Buffer.alloc(44));
  };
  for (let n = 1; n <= 255; n++) await add(n);
  assert.equal((await service.inspect({ sceneObjectId: sceneId })).resources.length, 256);
  await add(256); await assert.rejects(service.inspect({ sceneObjectId: sceneId }), { statusCode: 413, errorCode: 'world_audio_create_limit' });
});
