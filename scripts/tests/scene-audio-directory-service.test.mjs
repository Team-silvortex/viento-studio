import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createSceneAudioDirectoryService } from '../lib/scene-audio-directory-service.mjs';
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', manifestId = '88888888-8888-4888-8888-888888888888';
const assetId = '99999999-9999-4999-8999-999999999999';
const scenePath = 'documents/scenes/demo.json', manifestPath = 'documents/audio/demo.json';
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const recordPath = value => `metadata/documents/${value}.json`;
const json = value => JSON.stringify(value, null, 2) + '\n';
const error = (kind, status) => e => e.errorCode === `scene_audio_directory_${kind}` && e.statusCode === status;
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-audio-directory-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(new URL('../../examples/scene-audio/', import.meta.url), root, { recursive: true });
  const read = name => fs.readFile(path.join(root, name), 'utf8');
  const write = async (name, value) => { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : json(value)); };
  const edit = async (name, change) => { const value = JSON.parse(await read(name)); change(value); await write(name, value); };
  const service = createSceneAudioDirectoryService(root);
  return { root, read, write, edit, service, inspect: () => service.inspect({ sceneObjectId: sceneId }) };
}
async function tree(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name); result[path.relative(root, file)] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
  }
  return result;
}
test('saved audio directory returns frozen source identity and original bytes without writes or asset reads', async t => {
  const f = await fixture(t), original = '\ufeff' + (await f.read(manifestPath)).replaceAll('\n', '\r\n'); await f.write(manifestPath, original);
  const before = await tree(f.root), reads = [], readFile = fs.readFile;
  const mock = t.mock.method(fs, 'readFile', async function(file, ...args) { reads.push(String(file)); return readFile.call(fs, file, ...args); });
  const value = await f.inspect(); mock.mock.restore();
  assert.equal(value.status, 'ready'); assert.equal(value.scene.objectId, sceneId); assert.equal(value.manifest.objectId, manifestId);
  assert.equal(value.manifest.content, original); assert.match(value.worldId, /^world:[a-f0-9]{64}$/); assert.match(value.revision, /^sha256:[a-f0-9]{64}$/);
  assert.equal(value.manifest.sourceRevision, 'sha256:' + createHash('sha256').update(original).digest('hex'));
  assert.ok(Object.isFrozen(value.manifest)); assert.equal(reads.some(file => file.endsWith('.wav')), false);
  assert.equal(JSON.stringify(value).includes(f.root), false); assert.deepEqual(await tree(f.root), before);
});
test('missing or corrupt WAV bytes and absent resource registrations do not block saved track identities', async t => {
  const f = await fixture(t), original = (await f.inspect()).manifest.content;
  await fs.rm(path.join(f.root, 'assets/tone.wav')); assert.equal((await f.inspect()).manifest.content, original);
  await f.write('assets/tone.wav', 'not a wave'); assert.equal((await f.inspect()).manifest.content, original);
  await fs.rm(path.join(f.root, `metadata/assets/${assetId}.json`)); assert.equal((await f.inspect()).manifest.content, original);
  await f.edit(recordPath(manifestId), value => { value.assetBindings = []; });
  assert.equal((await f.inspect()).manifest.content, original, 'identity browsing is independent of resource binding/playability');
});
test('more than 256 unrelated registered WAV assets do not constrain track identity browsing', async t => {
  const f = await fixture(t), original = JSON.parse(await f.read(`metadata/assets/${assetId}.json`));
  for (let n = 0; n < 257; n++) { const asset = structuredClone(original); asset.id = id(n); asset.location.path = `extra-${n}.wav`; asset.legacyPaths = [];
    await f.write(`metadata/assets/${asset.id}.json`, asset); }
  const before = await tree(f.root), value = await f.inspect();
  assert.equal(value.status, 'ready'); assert.equal(JSON.parse(value.manifest.content).tracks.length, 2); assert.deepEqual(await tree(f.root), before);
});
test('only an explicit audio relation admits a manifest, including Scene2D v2 and v3', async t => {
  const f = await fixture(t); await f.edit(recordPath(sceneId), value => { value.relations = value.relations.filter(relation => relation.kind !== 'audio'); });
  for (const version of [2, 3]) {
    await f.edit(scenePath, value => { value.schemaVersion = version; if (version === 3) value.groups = []; });
    const before = await tree(f.root), value = await f.inspect(); assert.equal(value.status, 'empty'); assert.equal(value.manifest, null); assert.deepEqual(await tree(f.root), before);
  }
});
test('audio directory does not require unrelated actor rendering or complete build plans', async t => {
  const f = await fixture(t); await fs.rm(path.join(f.root, 'documents/characters/traveler.md'));
  await f.edit(scenePath, value => { value.actors[0].position = ['not a render coordinate']; });
  assert.equal((await f.inspect()).status, 'ready');
});
test('duplicate audio selection and missing selected registration or content cannot masquerade as empty', async t => {
  for (const mutation of [async f => f.edit(recordPath(sceneId), value => { value.relations.push({ kind: 'audio', targetId: id(1), slot: '' }); }),
    async f => fs.rm(path.join(f.root, recordPath(manifestId))), async f => fs.rm(path.join(f.root, manifestPath))]) {
    const f = await fixture(t); await mutation(f); const before = await tree(f.root);
    await assert.rejects(f.inspect(), e => /^scene_audio_directory_(invalid|unavailable)$/.test(e.errorCode)); assert.deepEqual(await tree(f.root), before);
  }
});
test('manifest scene mismatch missing reverse reference ownership-only reverse reference and malformed semantics are rejected', async t => {
  for (const mutation of [f => f.edit(manifestPath, value => { value.sceneObjectId = id(1); }),
    f => f.edit(recordPath(manifestId), value => { value.relations = []; }),
    f => f.edit(recordPath(manifestId), value => { value.relations = [{ kind: 'part-of', targetId: sceneId, slot: '' }]; }),
    f => f.write(manifestPath, '{}'), f => f.edit(manifestPath, value => { value.tracks[1].id = value.tracks[0].id; })]) {
    const f = await fixture(t); await mutation(f); const before = await tree(f.root);
    await assert.rejects(f.inspect(), error('invalid', 400)); assert.deepEqual(await tree(f.root), before);
  }
});
test('registered scene JSON identity is checked independently from audio declarations', async t => {
  for (const mutation of [f => f.edit(scenePath, value => { value.schemaVersion = 1; }), f => f.edit(scenePath, value => { value.format = 'other'; }),
    f => f.edit(scenePath, value => { value.actors[0].instanceId = 'invalid'; }), f => f.write(scenePath, '{bad'),
    f => f.edit(recordPath(sceneId), value => { value.relations = [{ kind: 'audio', targetId: sceneId, slot: '' }]; })]) {
    const f = await fixture(t); await mutation(f); await assert.rejects(f.inspect(), error('invalid', 400));
  }
});
test('audio directory enforces its own manifest source budget and unicode byte budget', async t => {
  for (const trailing of [' '.repeat(32769), '中'.repeat(11000)]) {
    const f = await fixture(t); await f.write(manifestPath, (await f.read(manifestPath)) + trailing);
    await assert.rejects(f.inspect(), error('limit', 413));
  }
});
test('request data is captured synchronously and getters are never invoked', async t => {
  const f = await fixture(t); let calls = 0;
  for (const input of [null, {}, [], { sceneObjectId: sceneId, execute: true }, Object.create({ sceneObjectId: sceneId }),
    Object.defineProperty({}, 'sceneObjectId', { enumerable: true, get() { calls++; return sceneId; } })])
    await assert.rejects(f.service.inspect(input), error('invalid', 400));
  assert.equal(calls, 0);
  const input = { sceneObjectId: sceneId }, pending = f.service.inspect(input); input.sceneObjectId = id(99);
  assert.equal((await pending).scene.objectId, sceneId);
});
test('a snapshot race maps to a conflict and never returns mixed scene/audio revisions', async t => {
  const f = await fixture(t), original = fs.readFile, filename = path.join(f.root, manifestPath); let count = 0;
  const mock = t.mock.method(fs, 'readFile', async function(file, ...args) {
    const value = await original.call(fs, file, ...args);
    if (String(file) === filename && ++count === 1) await fs.writeFile(filename, String(value) + '\n');
    return value;
  });
  await assert.rejects(f.inspect(), error('conflict', 409)); mock.mock.restore(); assert.ok(count >= 2);
});
