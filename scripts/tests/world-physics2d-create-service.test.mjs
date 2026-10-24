import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { transactionHash } from '../lib/world-transaction-state.mjs';
import { physics2DFixture, fingerprint, targetContents, childPhysics2D, json, sceneId, manifestId, actorId, journal } from './helpers/world-physics2d-create-fixture.mjs';

for (const version of [2, 3]) test(`physics2d.create workspace v${version} preview writes nothing and apply publishes exactly three author files`, async t => {
  const f = await physics2DFixture(t, version), before = await fingerprint(f.root);
  const preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.deepEqual(await fingerprint(f.root), before); assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  assert.deepEqual(preview.changes.map(change => change.kind), ['physics2d.create', 'relation.add']);
  const applied = await f.execute(f.input), observed = await readWorldSnapshot(f.root);
  assert.equal(applied.receipt.state, 'committed'); assert.equal(applied.revision, preview.revision); assert.equal(observed.projection.world.revision, preview.revision);
  const [source, record, sceneRecord] = await targetContents(f); assert.equal(source, f.input.content);
  assert.equal(transactionHash(source), preview.changes[0].afterSourceRevision);
  assert.deepEqual(JSON.parse(record).relations, [{ kind: 'references', targetId: sceneId, slot: '' }]); assert.deepEqual(JSON.parse(record).assetBindings, []);
  assert.deepEqual(JSON.parse(sceneRecord).relations.filter(relation => relation.slot === 'physics2d'), [{ kind: 'references', targetId: manifestId, slot: 'physics2d' }]);
  assert.ok(sceneRecord.includes('900719925474099312345')); assert.ok(sceneRecord.includes('\r\n'));
  const after = await fingerprint(f.root); for (const [name, hash] of Object.entries(before)) if (name !== f.files[2]) assert.equal(after[name], hash, name);
  assert.deepEqual(Object.keys(after).filter(name => !Object.hasOwn(before, name)).sort(), [f.files[0], f.files[1], `${journal}/head.json`].sort());
  await assert.rejects(f.execute(f.input), { errorCode: 'world_revision_conflict' });
});

test('creation ignores unrelated malformed systems and render/movement settings, and never reads resource bytes', async t => {
  const f = await physics2DFixture(t), record = JSON.parse(await fs.readFile(path.join(f.root, f.files[2])));
  for (const [kind, id] of [['audio', '88888888-1111-4111-8111-111111111111'], ['behavior', '88888888-2222-4222-8222-222222222222']]) {
    const sourcePath = `${f.documents}/broken-${kind}.json`; await fs.writeFile(path.join(f.root, sourcePath), '{broken');
    await fs.writeFile(path.join(f.root, `metadata/documents/${id}.json`), json({ format: 'viento-document', version: 1, id, sourcePath,
      documentType: 'character', parserProfile: 'structured', relations: [{ kind: 'references', targetId: sceneId }], assetBindings: [] }));
    record.relations.push({ kind, targetId: id });
  }
  await fs.writeFile(path.join(f.root, f.files[2]), json(record));
  const scene = JSON.parse(await fs.readFile(path.join(f.root, f.scenePath))); scene.actors[0].position = ['rendering is not consulted'];
  scene.actors[1].useProjectionDefaults = true; delete scene.actors[1].controls; delete scene.actors[1].speed;
  await fs.writeFile(path.join(f.root, f.scenePath), json(scene));
  await fs.mkdir(path.join(f.root, 'assets'), { recursive: true }); await fs.writeFile(path.join(f.root, 'assets/foreign.wav'), 'not WAV');
  const observed = await readWorldSnapshot(f.root), object = observed.projection.objects.find(item => item.id === sceneId);
  Object.assign(f.input, { baseRevision: observed.projection.world.revision, sceneObjectRevision: object.revision, sceneSourceRevision: object.documentRefs[0].sourceRevision });
  const before = await fingerprint(f.root), original = fs.readFile, reads = [];
  const mock = t.mock.method(fs, 'readFile', async function(file, ...args) { reads.push(String(file)); return original.call(fs, file, ...args); });
  assert.equal((await f.execute({ ...f.input, mode: 'preview' })).status, 'preview'); mock.mock.restore(); assert.deepEqual(await fingerprint(f.root), before);
  assert.equal(reads.some(file => /\.wav$/i.test(file)), false);
  assert.equal((await f.execute(f.input)).status, 'applied'); assert.equal(await fs.readFile(path.join(f.root, 'assets/foreign.wav'), 'utf8'), 'not WAV');
});

test('scene, definition and registration edits invalidate preview before any target publishes', async t => {
  for (const target of ['scene', 'actor', 'record']) {
    const f = await physics2DFixture(t); await f.execute({ ...f.input, mode: 'preview' });
    const relative = target === 'scene' ? f.scenePath : target === 'actor' ? `${f.documents}/characters/traveler.md` : f.files[2];
    if (target === 'record') { const record = JSON.parse(await fs.readFile(path.join(f.root, relative))); record.changedByAuthor = true; await fs.writeFile(path.join(f.root, relative), json(record)); }
    else await fs.appendFile(path.join(f.root, relative), '\n');
    const before = await fingerprint(f.root); await assert.rejects(f.execute(f.input), { errorCode: 'world_revision_conflict' }); assert.deepEqual(await fingerprint(f.root), before);
  }
});

test('same-size source replacement with restored mtime is caught at the final pre-intent boundary', async t => {
  const f = await physics2DFixture(t), file = path.join(f.root, `${f.documents}/characters/traveler.md`), original = fs.rename; let changed = false;
  const mock = t.mock.method(fs, 'rename', async function(from, to) {
    const result = await original.call(fs, from, to);
    if (!changed && String(to).endsWith('/physics2d-dependencies.json')) {
      const stat = await fs.stat(file), bytes = await fs.readFile(file); bytes[2] = bytes[2] === 84 ? 88 : 84;
      await fs.writeFile(file, bytes); await fs.utimes(file, stat.atime, stat.mtime); changed = true;
    }
    return result;
  });
  await assert.rejects(f.execute(f.input), { errorCode: 'world_revision_conflict' }); mock.mock.restore();
  assert.equal(changed, true); assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  assert.deepEqual(await fs.readdir(path.join(f.root, journal)).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
});

test('parallel local and real cross-process requests cannot create two first physics declarations', async t => {
  const f = await physics2DFixture(t), results = await Promise.allSettled([f.execute(f.input), f.execute(f.input)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(results.find(result => result.status === 'rejected').reason.errorCode, 'world_revision_conflict');
  const g = await physics2DFixture(t), file = path.join(g.root, '.parallel-request.json'); await fs.writeFile(file, JSON.stringify(g.input));
  const children = await Promise.all([childPhysics2D(g, file), childPhysics2D(g, file)]); await fs.rm(file);
  assert.equal(children.filter(child => child.result?.status === 'applied').length, 1, JSON.stringify(children));
  const refused = children.find(child => !child.result); assert.equal(refused.exitCode, 1);
  assert.ok(['world_revision_conflict', 'world_write_busy'].includes(refused.failure?.errorCode), JSON.stringify(refused));
  assert.equal(JSON.parse((await targetContents(g))[2]).relations.filter(relation => relation.kind === 'references' && relation.slot === 'physics2d').length, 1);
});

test('selected declarations cannot be overwritten or duplicated even after a fresh preview revision', async t => {
  const f = await physics2DFixture(t); await f.execute(f.input); const before = await fingerprint(f.root), observed = await readWorldSnapshot(f.root);
  const scene = observed.projection.objects.find(object => object.id === sceneId);
  for (const objectId of [manifestId, '99999999-5555-4555-8555-555555555555']) await assert.rejects(f.execute({ ...f.input,
    objectId, sourcePath: `${f.documents}/physics/another.json`, baseRevision: observed.projection.world.revision, sceneObjectRevision: scene.revision }));
  assert.deepEqual(await fingerprint(f.root), before);
});

test('occupied aliases, hidden paths, uppercase JSON and source links preserve foreign files and refuse publication', async t => {
  for (const kind of ['occupied', 'source-link', 'hidden', 'traversal', 'uppercase']) {
    const f = await physics2DFixture(t), outside = path.join(f.root, 'outside-data'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep'), 'foreign');
    if (kind === 'occupied') await fs.mkdir(path.join(f.root, `${f.documents}/physics/CREATED.JSON`));
    else if (kind === 'source-link') { await fs.symlink(outside, path.join(f.root, `${f.documents}/linked`)); f.input.sourcePath = `${f.documents}/linked/created.json`; }
    else f.input.sourcePath = kind === 'hidden' ? `${f.documents}/.hidden/created.json` : kind === 'uppercase' ? `${f.documents}/physics/upper.JSON` : '../outside.json';
    const before = await fingerprint(f.root); await assert.rejects(f.execute(f.input));
    assert.deepEqual(await fingerprint(f.root), before); assert.equal(await fs.readFile(path.join(outside, 'keep'), 'utf8'), 'foreign'); assert.deepEqual((await targetContents(f)).slice(0, 2), [null, null]);
  }
});

test('malformed shapes, wrong scenes, stale targets, duplicate instances and oversized UTF-8 declarations never publish', async t => {
  const mutate = callback => value => { const m = JSON.parse(value.content.replace(/^\ufeff/, '')); callback(m); value.content = json(m); };
  const changes = [value => { value.content = '{}'; }, mutate(m => { m.sceneObjectId = actorId; }), mutate(m => { m.bodies[0].instanceId = manifestId; }),
    mutate(m => { m.bodies[0].shape.size[0] = 0; }), mutate(m => { m.bodies[1].instanceId = m.bodies[0].instanceId; }),
    mutate(m => { m.bodies[0].unknown = true; }), value => { value.documentType = 'nonexistent'; },
    value => { value.content += ' '.repeat(65537); }, value => { value.content += '中'.repeat(22000); }];
  for (const change of changes) { const f = await physics2DFixture(t); change(f.input); const before = await fingerprint(f.root);
    await assert.rejects(f.execute(f.input)); assert.deepEqual(await fingerprint(f.root), before); }
});

test('the complete 64 KiB declaration budget remains usable through preview, commit and saved source', async t => {
  const f = await physics2DFixture(t); f.input.content += ' '.repeat(65536 - Buffer.byteLength(f.input.content));
  assert.equal(Buffer.byteLength(f.input.content), 65536);
  const before = await fingerprint(f.root); assert.equal((await f.execute({ ...f.input, mode: 'preview' })).status, 'preview'); assert.deepEqual(await fingerprint(f.root), before);
  assert.equal((await f.execute(f.input)).status, 'applied'); assert.equal((await targetContents(f))[0], f.input.content);
});
