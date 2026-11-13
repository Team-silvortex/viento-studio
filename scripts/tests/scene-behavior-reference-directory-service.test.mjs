import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createSceneBehaviorReferenceDirectoryService } from '../lib/scene-behavior-reference-directory-service.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';

const id = n => `c011ec70-2026-4113-8113-${String(n).padStart(12, '0')}`;
const sceneId = id(31), assemblyId = id(100), inputId = id(101), crystalId = id(12);
const scenePath = 'documents/scenes/level.json', assemblyPath = 'documents/projects/game.json', inputPath = 'documents/inputs/keyboard.json';
const recordPath = value => `metadata/documents/${value}.json`;
const json = value => JSON.stringify(value, null, 2) + '\n';
const error = (kind, status) => e => e.errorCode === `scene_behavior_reference_directory_${kind}` && e.statusCode === status;
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-behavior-references-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(new URL('../../examples/topdown-collect/', import.meta.url), root, { recursive: true });
  const read = name => fs.readFile(path.join(root, name), 'utf8');
  const write = async (name, value) => { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), typeof value === 'string' ? value : json(value)); };
  const edit = async (name, change) => { const value = JSON.parse(await read(name)); change(value); await write(name, value); };
  const service = createSceneBehaviorReferenceDirectoryService({ PROJECT_ROOT: root });
  return { root, read, write, edit, service, inspect: (assemblyObjectId = null) => service.inspect({ sceneObjectId: sceneId, assemblyObjectId }) };
}
async function tree(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name); result[path.relative(root, file)] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
  }
  return result;
}
async function addAssembly(f, number, modify = () => {}) {
  const sourcePath = `documents/projects/extra-${number}.json`, value = JSON.parse(await f.read(assemblyPath)); modify(value);
  await f.write(sourcePath, value);
  const record = JSON.parse(await f.read(recordPath(assemblyId))); record.id = id(number); record.sourcePath = sourcePath;
  await f.write(recordPath(record.id), record);
  return record.id;
}
async function unregister(f, objectId) {
  // Keep unrelated registration relationships valid so the test reaches this
  // directory's selected dependency gate rather than the World reader's gate.
  for (const file of await fs.readdir(path.join(f.root, 'metadata/documents'))) {
    await f.edit(`metadata/documents/${file}`, value => { value.relations = (value.relations || []).filter(row => row.targetId !== objectId); });
  }
  await fs.rm(path.join(f.root, recordPath(objectId)));
}
test('saved references are read only, source-labelled and preserve separate repeated instances without reading resource bytes', async t => {
  const f = await fixture(t), before = await tree(f.root), reads = [], original = fs.readFile;
  const mock = t.mock.method(fs, 'readFile', async function(file, ...args) { reads.push(String(file)); return original.call(fs, file, ...args); });
  const value = await f.inspect(); mock.mock.restore();
  assert.equal(value.format, 'viento-scene-behavior-reference-directory'); assert.equal(value.schemaVersion, 1);
  assert.equal(value.scene.objectId, sceneId); assert.equal(value.scene.sourcePath, scenePath);
  const repeated = value.instances.filter(instance => instance.objectId === crystalId);
  assert.equal(repeated.length, 3); assert.equal(new Set(repeated.map(instance => instance.instanceId)).size, 3);
  for (const row of repeated) { assert.ok(row.name); assert.equal(row.sourcePath, 'documents/definitions/crystal.md');
    assert.equal(row.sourceRevision, 'sha256:' + createHash('sha256').update(await f.read(row.sourcePath)).digest('hex')); }
  assert.equal(value.assemblies.length, 1); assert.equal(value.assemblies[0].objectId, assemblyId);
  assert.equal(value.selectedAssembly, null, 'even one containing assembly requires explicit selection');
  assert.equal(reads.some(file => /\.(wav|png|ttf)$/i.test(file)), false);
  assert.equal(JSON.stringify(value).includes(f.root), false); assert.equal(JSON.stringify(value).includes('content'), false);
  assert.ok(Object.isFrozen(value.instances[0])); assert.deepEqual(await tree(f.root), before);
});
test('explicit selected assembly uses declared membership and its linked input map, with names and original sources', async t => {
  const f = await fixture(t), before = await tree(f.root), value = await f.inspect(assemblyId), selected = value.selectedAssembly;
  assert.equal(selected.objectId, assemblyId); assert.equal(selected.name, 'Crystal Courtyard'); assert.equal(selected.sourcePath, assemblyPath);
  assert.deepEqual(selected.members.map(row => row.objectId), [id(30), id(31), id(32), id(33)]);
  for (const member of selected.members) assert.ok(member.name && member.sourcePath && member.sourceRevision);
  assert.deepEqual(selected.inputMap, { objectId: inputId, sourcePath: inputPath,
    sourceRevision: 'sha256:' + createHash('sha256').update(await f.read(inputPath)).digest('hex') });
  assert.deepEqual(selected.actions, [{ name: 'start_retry', keys: ['Enter', 'Space'] }]);
  assert.ok(Object.isFrozen(selected.actions[0].keys)); assert.deepEqual(await tree(f.root), before);
});
test('multiple containing projects stay ambiguous until chosen and each exposes only its own map', async t => {
  const f = await fixture(t), alternateInput = id(402), alternatePath = 'documents/inputs/alternate.json';
  await f.write(alternatePath, { format: 'viento-input-map', schemaVersion: 1, actions: [{ name: 'dash', keys: ['KeyK'] }] });
  const record = JSON.parse(await f.read(recordPath(inputId))); record.id = alternateInput; record.sourcePath = alternatePath;
  await f.write(recordPath(alternateInput), record);
  const alternate = await addAssembly(f, 400, value => { value.title = 'Alternate'; value.sceneIds = [sceneId]; value.entrySceneId = sceneId; value.inputMapId = alternateInput; });
  await addAssembly(f, 401, value => { value.title = 'Unrelated'; value.sceneIds = [id(30)]; });
  const unspecified = await f.inspect(); assert.equal(unspecified.assemblies.length, 2); assert.equal(unspecified.selectedAssembly, null);
  const first = await f.inspect(assemblyId), second = await f.inspect(alternate);
  assert.deepEqual(second.instances, first.instances); assert.deepEqual(second.selectedAssembly.members.map(member => member.objectId), [sceneId]);
  assert.deepEqual(first.selectedAssembly.actions.map(action => action.name), ['start_retry']);
  assert.deepEqual(second.selectedAssembly.actions, [{ name: 'dash', keys: ['KeyK'] }]);
  await assert.rejects(f.inspect(id(401)), error('invalid', 400));
});
test('schema one assembly has no authored input actions and unrelated maps never fill it', async t => {
  const f = await fixture(t); await f.edit(assemblyPath, value => { value.schemaVersion = 1; delete value.inputMapId; });
  const value = await f.inspect(assemblyId); assert.equal(value.selectedAssembly.inputMap, null); assert.deepEqual(value.selectedAssembly.actions, []);
});
test('reference browsing is independent of rendering, tool availability and external asset bytes', async t => {
  const f = await fixture(t); await f.edit(scenePath, value => { value.actors[0].position = ['not a renderer coordinate']; });
  await f.write('documents/scripts/controller.txt', 'not an executable script');
  await fs.rm(path.join(f.root, 'assets'), { recursive: true });
  const value = await f.inspect(assemblyId); assert.equal(value.instances.length, 11); assert.equal(value.selectedAssembly.members.length, 4);
});
test('selected missing or malformed members and maps cannot silently become empty', async t => {
  for (const mutate of [f => unregister(f, id(32)), f => fs.rm(path.join(f.root, 'documents/scenes/win.json')),
    f => f.write('documents/scenes/win.json', '{}'), f => fs.rm(path.join(f.root, recordPath(inputId))),
    f => fs.rm(path.join(f.root, inputPath)), f => f.write(inputPath, '{}'),
    f => f.edit(inputPath, value => { value.actions[0].name = 'ui_accept'; }),
    f => f.edit(inputPath, value => { value.actions[0].keys = ['Escape']; })]) {
    const f = await fixture(t); await mutate(f); const before = await tree(f.root);
    assert.equal((await f.inspect()).selectedAssembly, null, 'unselected context does not imply selected dependency availability');
    await assert.rejects(f.inspect(assemblyId), e => /^scene_behavior_reference_directory_(invalid|unavailable)$/.test(e.errorCode));
    assert.deepEqual(await tree(f.root), before);
  }
});
test('selected assembly registration, declaration, membership and byte limits are checked explicitly', async t => {
  for (const [mutate, kind, status] of [[f => fs.rm(path.join(f.root, recordPath(assemblyId))), 'unavailable', 422],
    [f => fs.rm(path.join(f.root, assemblyPath)), 'unavailable', 422], [f => f.write(assemblyPath, '{}'), 'invalid', 400],
    [f => f.edit(assemblyPath, value => { value.sceneIds = [id(30)]; }), 'invalid', 400],
    [f => f.write(assemblyPath, '{"format":"viento-project-assembly",bad'), 'invalid', 400],
    [async f => f.write(assemblyPath, (await f.read(assemblyPath)) + ' '.repeat(32769)), 'limit', 413],
    [async f => f.write(inputPath, (await f.read(inputPath)) + '中'.repeat(11000)), 'limit', 413]]) {
    const f = await fixture(t); await mutate(f); await assert.rejects(f.inspect(assemblyId), error(kind, status));
  }
});
test('current instance UUIDs and readable linked definition registrations are required without collapsing repeats', async t => {
  for (const [mutate, kind] of [[f => f.edit(scenePath, value => { value.actors[0].instanceId = 'invalid'; }), 'invalid'],
    [f => f.edit(scenePath, value => { value.actors[1].instanceId = value.actors[0].instanceId; }), 'invalid'],
    [f => f.edit(scenePath, value => { value.schemaVersion = 1; }), 'invalid'],
    [f => fs.rm(path.join(f.root, recordPath(crystalId))), 'unavailable'],
    [f => fs.rm(path.join(f.root, 'documents/definitions/crystal.md')), 'unavailable'],
    [f => f.edit(recordPath(sceneId), value => { value.relations = value.relations.filter(row => row.targetId !== crystalId); }), 'invalid'],
    [f => f.edit(recordPath(sceneId), value => { value.relations = value.relations.map(row => row.targetId === crystalId ? { ...row, kind: 'part-of' } : row); }), 'invalid']]) {
    const f = await fixture(t); await mutate(f); await assert.rejects(f.inspect(), error(kind, kind === 'unavailable' ? 422 : 400));
  }
});
test('full World revision invalidates references for saved definition, member, input-map and metadata changes', async t => {
  const f = await fixture(t); let before = await f.inspect(assemblyId);
  for (const mutate of [async () => f.write('documents/definitions/crystal.md', (await f.read('documents/definitions/crystal.md')) + '\nChanged definition.\n'),
    () => f.edit('documents/scenes/win.json', value => { value.title += ' changed'; }),
    () => f.edit(inputPath, value => { value.actions[0].keys = ['KeyK']; }),
    () => f.edit(recordPath(sceneId), value => { value.relations[0].slot += '-changed'; }),
    async () => f.write('documents/guide.md', (await f.read('documents/guide.md')) + '\nUnrelated saved change.\n')]) {
    await mutate(); const after = await f.inspect(assemblyId); assert.equal(after.worldId, before.worldId); assert.notEqual(after.revision, before.revision); before = after;
  }
});
test('request fields are captured before awaiting a snapshot and accessors never run', async t => {
  const f = await fixture(t), observed = await readWorldSnapshot(f.root); let reads = 0, calls = 0, release;
  const waiting = new Promise(resolve => { release = resolve; });
  const service = createSceneBehaviorReferenceDirectoryService({ PROJECT_ROOT: f.root, readSnapshot: async () => { reads++; await waiting; return observed; } });
  const valid = { sceneObjectId: sceneId, assemblyObjectId: null };
  for (const input of [null, {}, [], { sceneObjectId: sceneId }, { ...valid, execute: true }, Object.create(valid),
    { ...valid, assemblyObjectId: undefined }, { ...valid, assemblyObjectId: 'not a UUID' },
    Object.defineProperty({ assemblyObjectId: null }, 'sceneObjectId', { enumerable: true, get() { calls++; return sceneId; } }),
    Object.defineProperty({ sceneObjectId: sceneId }, 'assemblyObjectId', { enumerable: true, get() { calls++; return null; } })])
    await assert.rejects(service.inspect(input), error('invalid', 400));
  assert.equal(reads, 0); assert.equal(calls, 0);
  const input = { sceneObjectId: sceneId, assemblyObjectId: assemblyId }, pending = service.inspect(input);
  input.sceneObjectId = id(99); input.assemblyObjectId = null; release();
  const value = await pending; assert.equal(value.scene.objectId, sceneId); assert.equal(value.selectedAssembly.objectId, assemblyId); assert.equal(reads, 1);
});
test('source changes during a real snapshot return conflict instead of mixed member/input revisions', async t => {
  const f = await fixture(t), original = fs.readFile, filename = path.join(f.root, inputPath); let reads = 0;
  const mock = t.mock.method(fs, 'readFile', async function(file, ...args) {
    const value = await original.call(fs, file, ...args);
    if (String(file) === filename && ++reads === 1) await fs.writeFile(filename, String(value) + '\n');
    return value;
  });
  await assert.rejects(f.inspect(assemblyId), error('conflict', 409)); mock.mock.restore(); assert.ok(reads >= 2);
});
test('snapshot fences and source limits preserve explicit service error classes', async () => {
  for (const [sourceCode, sourceStatus, expected, status] of [['world_read_conflict', 409, 'conflict', 409],
    ['world_recovery_required', 409, 'conflict', 409], ['world_journal_invalid', 409, 'conflict', 409],
    ['world_source_limit', 413, 'limit', 413], ['world_unavailable', 422, 'unavailable', 422]]) {
    const service = createSceneBehaviorReferenceDirectoryService({ PROJECT_ROOT: '/unused', readSnapshot: async () => {
      throw Object.assign(new Error('private host path'), { errorCode: sourceCode, statusCode: sourceStatus });
    } });
    await assert.rejects(service.inspect({ sceneObjectId: sceneId, assemblyObjectId: null }), error(expected, status));
  }
});
