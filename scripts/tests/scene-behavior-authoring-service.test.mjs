import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createSceneBehaviorAuthoringService } from '../lib/scene-behavior-authoring-service.mjs';

const manifestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const scriptId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourcePath = 'documents/behaviors/demo.json';
const id = number => `${String(number).padStart(8, '0')}-3333-4333-8333-333333333333`;
const json = value => JSON.stringify(value, null, 2) + '\n';
const fail = kind => error => error.errorCode === `scene_behavior_authoring_${kind}`;

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-behavior-authoring-test-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'workspace');
  await fs.cp(new URL('../../examples/scene-behaviors/', import.meta.url), root, { recursive: true });
  const read = relative => fs.readFile(path.join(root, relative), 'utf8');
  const write = (relative, content) => fs.writeFile(path.join(root, relative), typeof content === 'string' ? content : json(content));
  const recordPath = objectId => `metadata/documents/${objectId}.json`;
  const record = async objectId => JSON.parse(await read(recordPath(objectId)));
  const value = JSON.parse(await read(sourcePath));
  const service = createSceneBehaviorAuthoringService(root);
  const inspect = (content = json(value)) => service.inspect({ sourcePath, content });
  async function addDocument(objectId, relative, content, relation) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await write(relative, content);
    await write(recordPath(objectId), { format: 'viento-document', version: 1, id: objectId, sourcePath: relative,
      documentType: 'script', parserProfile: 'structured', relations: [], assetBindings: [] });
    if (relation) { const data = await record(manifestId); data.relations.push({ kind: relation, targetId: objectId }); await write(recordPath(manifestId), data); }
  }
  return { root, temporary, read, write, recordPath, record, value, service, inspect, addDocument };
}

async function tree(root) {
  const files = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name);
    files[path.relative(root, file)] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
  }
  return files;
}

test('behavior authoring reads an immutable instance/source catalog without executing source or modifying any file', async t => {
  const f = await fixture(t);
  const scriptPath = (await f.record(scriptId)).sourcePath;
  await f.write(scriptPath, '# SOURCE_SECRET\nthrow new Error("must never execute");\n');
  const before = await tree(f.root), receipt = await f.inspect();
  assert.equal(receipt.format, 'viento-behavior-authoring-context'); assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.sourcePath, sourcePath); assert.equal(receipt.objectId, manifestId);
  assert.equal(receipt.scene.objectId, sceneId); assert.equal(receipt.scene.instances.length, 2);
  assert.notEqual(receipt.scene.instances[0].instanceId, receipt.scene.instances[1].instanceId);
  assert.equal(receipt.scene.instances[0].objectId, actorId); assert.equal(receipt.scene.instances[1].objectId, actorId);
  assert.ok(receipt.scene.instances.every(instance => instance.name.includes('Traveler')));
  assert.deepEqual(receipt.sources.map(source => [source.objectId, source.sourcePath, source.name]), [[scriptId, scriptPath, 'checkpoint.txt']]);
  assert.match(receipt.dependencyRevision, /^sha256:[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(receipt.scene.instances[0])); assert.ok(Object.isFrozen(receipt.sources[0]));
  assert.throws(() => { receipt.sources[0].objectId = actorId; }, TypeError);
  for (const secret of [f.root, f.temporary, 'SOURCE_SECRET', 'throw new Error', 'content', 'extends Node']) assert.equal(JSON.stringify(receipt).includes(secret), false);
  assert.deepEqual(await tree(f.root), before);
});

test('draft parameters bindings implementation language and saved manifest body do not change the dependency revision', async t => {
  const f = await fixture(t), before = await f.inspect();
  const changed = structuredClone(f.value); changed.bindings.reverse(); changed.bindings[0].parameters.amount = 120;
  changed.bindings.forEach(binding => { binding.implementation.backendId = 'org.example.native'; binding.implementation.language = 'native.experimental'; });
  assert.equal((await f.inspect('\uFEFF' + json(changed).replaceAll('\n', '\r\n'))).dependencyRevision, before.dependencyRevision);
  await f.write(sourcePath, json(changed));
  assert.equal((await f.inspect()).dependencyRevision, before.dependencyRevision);
});

test('manifest metadata scene metadata and source bytes scripts and all definitions are pinned independently', async t => {
  const f = await fixture(t), baseline = (await f.inspect()).dependencyRevision;
  const targets = [f.recordPath(manifestId), f.recordPath(sceneId), 'documents/scenes/demo.json',
    f.recordPath(scriptId), 'documents/scripts/checkpoint.txt', f.recordPath(actorId), 'documents/characters/traveler.md'];
  for (const target of targets) {
    const original = await f.read(target);
    if (target.startsWith('metadata/')) { const value = JSON.parse(original); value.assetBindings = []; value.revisionNote = 'metadata changed'; await f.write(target, value); }
    else await f.write(target, original + '\n');
    assert.notEqual((await f.inspect()).dependencyRevision, baseline, target);
    await f.write(target, original); assert.equal((await f.inspect()).dependencyRevision, baseline, target);
  }
});

test('catalog offers unused linked readable TXT sources and omits ownership missing unrelated and non-TXT documents', async t => {
  const f = await fixture(t);
  for (let index = 1; index <= 9; index++) await f.addDocument(id(index), `documents/scripts/unused-${index}.txt`, `# private-${index}\n`, 'reference');
  await f.addDocument(id(20), 'documents/scripts/unlinked.txt', 'secret');
  await f.addDocument(id(21), 'documents/scripts/owned.txt', 'secret', 'part-of');
  await f.addDocument(id(22), 'documents/scripts/notes.md', 'secret', 'reference');
  await f.addDocument(id(23), 'documents/scripts/missing.txt', 'secret', 'reference'); await fs.unlink(path.join(f.root, 'documents/scripts/missing.txt'));
  await f.write('documents/scripts/unregistered.txt', 'secret');
  const receipt = await f.inspect(); assert.equal(receipt.sources.length, 10);
  assert.deepEqual(new Set(receipt.sources.map(source => source.objectId)), new Set([scriptId, ...Array.from({ length: 9 }, (_, index) => id(index + 1))]));
  const before = receipt.dependencyRevision;
  await f.write('documents/scripts/unused-1.txt', 'changed unused registered script');
  assert.notEqual((await f.inspect()).dependencyRevision, before);
});

test('missing duplicate or redirected scene behavior opt-in never creates a relation or mutates author files', async t => {
  const f = await fixture(t), original = await f.record(sceneId);
  for (const relations of [original.relations.filter(row => row.kind !== 'behavior'),
    original.relations.map(row => row.kind === 'behavior' ? { ...row, kind: 'reference' } : row),
    original.relations.map(row => row.kind === 'behavior' ? { ...row, targetId: scriptId } : row),
    [...original.relations, { kind: 'behavior', targetId: scriptId }]]) {
    await f.write(f.recordPath(sceneId), { ...original, relations }); const before = await tree(f.root);
    await assert.rejects(f.inspect(), error => fail('invalid')(error) && error.payload.diagnostics.some(row => row.code === 'build_behavior_unlinked'));
    assert.deepEqual(await tree(f.root), before);
  }
});

test('manifest-to-scene or source ownership-only references and unregistered used sources are rejected', async t => {
  const f = await fixture(t), original = await f.record(manifestId);
  for (const objectId of [sceneId, scriptId]) {
    await f.write(f.recordPath(manifestId), { ...original, relations: original.relations.map(row => row.targetId === objectId ? { ...row, kind: 'part-of' } : row) });
    await assert.rejects(f.inspect(), error => fail('invalid')(error) && error.payload.diagnostics.some(row => row.code === 'build_behavior_unlinked' && row.relatedObjectId === objectId));
  }
  await f.write(f.recordPath(manifestId), original); await fs.unlink(path.join(f.root, f.recordPath(scriptId)));
  await assert.rejects(f.inspect(), fail('unavailable'));
});

test('every scene instance definition remains readable and linked even when the draft only binds another actor', async t => {
  const f = await fixture(t), scene = JSON.parse(await f.read('documents/scenes/demo.json'));
  scene.actors[1].objectId = id(42); await f.write('documents/scenes/demo.json', scene);
  const draft = structuredClone(f.value); draft.bindings = [draft.bindings[0]];
  await assert.rejects(f.inspect(json(draft)), fail('unavailable'));
  await f.addDocument(id(42), 'documents/characters/second.md', '# Second actor\n');
  await assert.rejects(f.inspect(json(draft)), fail('invalid'));
  const record = await f.record(sceneId); record.relations.push({ kind: 'part-of', targetId: id(42) }); await f.write(f.recordPath(sceneId), record);
  await assert.rejects(f.inspect(json(draft)), fail('invalid'));
  record.relations.at(-1).kind = 'reference'; await f.write(f.recordPath(sceneId), record);
  const receipt = await f.inspect(json(draft)); assert.equal(receipt.scene.instances[1].objectId, id(42));
  const before = receipt.dependencyRevision; await f.write('documents/characters/second.md', '# Changed second actor\n');
  assert.notEqual((await f.inspect(json(draft))).dependencyRevision, before);
});

test('Scene2D schema v3 remains supported while v1 ambiguous IDs missing bindings and unavailable source bytes reject', async t => {
  const f = await fixture(t), original = JSON.parse(await f.read('documents/scenes/demo.json'));
  const scene = { ...original, schemaVersion: 3, groups: [] }; await f.write('documents/scenes/demo.json', scene);
  assert.equal((await f.inspect()).scene.instances.length, 2);
  for (const mutate of [v => { v.schemaVersion = 1; }, v => { v.actors[1].instanceId = v.actors[0].instanceId; }, v => { v.actors = []; }]) {
    const value = structuredClone(original); mutate(value); await f.write('documents/scenes/demo.json', value); await assert.rejects(f.inspect(), fail('invalid'));
  }
  await f.write('documents/scenes/demo.json', original);
  const draft = structuredClone(f.value); draft.bindings[0].instanceId = id(77); await assert.rejects(f.inspect(json(draft)), fail('invalid'));
  await fs.unlink(path.join(f.root, 'documents/scripts/checkpoint.txt')); await assert.rejects(f.inspect(), fail('unavailable'));
});

test('payload validation refuses unknown fields getters inherited values symbols aliases and malformed declarations before reading the world', async t => {
  const f = await fixture(t), content = json(f.value); let called = 0;
  const getter = { sourcePath }; Object.defineProperty(getter, 'content', { enumerable: true, get() { called++; throw Error('must not run'); } });
  const hidden = { sourcePath }; Object.defineProperty(hidden, 'content', { value: content });
  const symbol = { sourcePath, content, [Symbol('extra')]: true };
  for (const payload of [null, [], {}, getter, hidden, symbol, Object.assign(Object.create({}), { sourcePath, content }),
    { sourcePath, content, toJSON() { called++; } }, { sourcePath: './' + sourcePath, content },
    { sourcePath: '/tmp/manifest.json', content }, { sourcePath: 'documents/../manifest.json', content },
    { sourcePath, content: {} }, { sourcePath, content: '{}' },
    { sourcePath, content: content.replace('"schemaVersion": 1', '"schemaVersion": 1,"schemaVersion": 1') }]) {
    await assert.rejects(f.service.inspect(payload), fail('invalid'));
  }
  assert.equal(called, 0);
  assert.equal((await f.service.inspect(Object.assign(Object.create(null), { sourcePath, content }))).objectId, manifestId);
});

test('32 KiB draft and 64 KiB candidate budgets count UTF-8 bytes including unused associated candidates', async t => {
  const f = await fixture(t);
  for (const content of [' '.repeat(32769) + json(f.value), JSON.stringify({ ...f.value, extra: '中'.repeat(12000) }), '\ud800' + json(f.value)]) {
    await assert.rejects(f.inspect(content), error => fail('invalid')(error) && error.statusCode === 413);
  }
  await f.addDocument(id(30), 'documents/scripts/large.txt', '中'.repeat(22000), 'reference');
  await assert.rejects(f.inspect(), error => fail('invalid')(error) && error.statusCode === 413 && error.payload.diagnostics.some(row => row.relatedObjectId === id(30)));
});

test('candidate catalogs allow 256 linked sources independently of the eight-source binding limit and reject larger catalogs', async t => {
  const f = await fixture(t);
  for (let index = 1; index <= 255; index++) await f.addDocument(id(index), `documents/scripts/candidate-${index}.txt`, '# inert candidate\n', 'reference');
  assert.equal((await f.inspect()).sources.length, 256);
  await f.addDocument(id(256), 'documents/scripts/candidate-256.txt', '# inert candidate\n', 'reference');
  await assert.rejects(f.inspect(), error => fail('invalid')(error) && error.statusCode === 413);
});

test('unregistered missing or unreadable manifest and unfinished author transactions have explicit availability/conflict errors', async t => {
  const f = await fixture(t), content = json(f.value);
  await assert.rejects(f.service.inspect({ sourcePath: 'documents/behaviors/missing.json', content }), fail('unavailable'));
  await fs.unlink(path.join(f.root, sourcePath)); await assert.rejects(f.inspect(), fail('unavailable'));
  await f.write(sourcePath, content); await fs.mkdir(path.join(f.root, '.viento/world-transactions/active'), { recursive: true });
  await assert.rejects(f.inspect(), fail('conflict'));
});

test('external dependency edits during a captured read reject rather than produce a mixed authoring revision', async t => {
  const f = await fixture(t), script = path.join(f.root, 'documents/scripts/checkpoint.txt'), originalRead = fs.readFile;
  let changed = false;
  fs.readFile = async (file, ...args) => {
    const bytes = await originalRead.call(fs, file, ...args);
    if (!changed && String(file) === script) {
      changed = true;
      const stat = await fs.stat(script), changedBytes = Buffer.from(bytes); changedBytes[changedBytes.length - 2] ^= 1;
      await fs.writeFile(script, changedBytes); await fs.utimes(script, stat.atime, stat.mtime);
    }
    return bytes;
  };
  try { await assert.rejects(f.inspect(), fail('conflict')); }
  finally { fs.readFile = originalRead; }
  assert.equal(changed, true);
  assert.equal((await f.inspect()).sources[0].objectId, scriptId);
});

test('caller mutations after inspection starts cannot redirect the manifest or change the captured draft', async t => {
  const f = await fixture(t), request = { sourcePath, content: json(f.value) }, pending = f.service.inspect(request);
  request.sourcePath = 'documents/scenes/demo.json'; request.content = '{}';
  assert.equal((await pending).objectId, manifestId);
});

test('long Unicode actor and script labels stay bounded without splitting surrogate pairs', async t => {
  const f = await fixture(t), prefix = 'a'.repeat(159);
  await f.write('documents/characters/traveler.md', `# ${prefix}🚀 actor\n`);
  await f.addDocument(id(99), `documents/scripts/${prefix}🚀.txt`, '# private title\n', 'reference');
  const receipt = await f.inspect(), source = receipt.sources.find(row => row.objectId === id(99));
  assert.equal(source.name, prefix); assert.equal(receipt.scene.instances[0].name, prefix);
  for (const name of [source.name, receipt.scene.instances[0].name]) {
    assert.ok(name.length <= 160); assert.equal(Buffer.from(name, 'utf8').toString('utf8'), name);
  }
});
