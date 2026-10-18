import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSceneAnimationCreationService } from '../lib/scene-animation-creation-service.mjs';
import { createSceneAnimationCreationRequest, captureSceneAnimationCreationContext, confirmSceneAnimationCreation, validateSceneAnimationCreationResult } from '../../engine/scene-animation-creation-contract.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { transactionHash } from '../lib/world-transaction-state.mjs';
import { animationFixture, fingerprint, targetContents, childAnimation, json, sceneId, manifestId, actorId, journal } from './helpers/world-animation-create-fixture.mjs';

for (const version of [2, 3]) test(`animation.create workspace v${version} preview writes nothing and apply publishes exactly three author files`, async t => {
  const f = await animationFixture(t, version), service = createSceneAnimationCreationService(f.root);
  const catalog = captureSceneAnimationCreationContext(await service.inspect({ sceneObjectId: sceneId }), sceneId);
  assert.equal(catalog.status, 'empty'); assert.equal(catalog.manifest, null); assert.equal(catalog.targets.length, 2);
  assert.equal(catalog.targets[0].name, 'Traveler / 旅人 / 旅人'); assert.ok(!Object.hasOwn(catalog, 'resources'));
  const request = createSceneAnimationCreationRequest(catalog, Object.fromEntries(['objectId', 'documentType', 'sourcePath', 'content'].map(key => [key, f.input[key]])));
  const before = await fingerprint(f.root), preview = await f.execute(request), hash = transactionHash(f.input.content);
  assert.deepEqual(await fingerprint(f.root), before); assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  assert.deepEqual(preview.changes.map(change => change.kind), ['animation.create', 'relation.add']);
  assert.deepEqual(validateSceneAnimationCreationResult(preview, request, catalog, hash), preview);
  const applyRequest = { ...request, mode: 'apply' }, applied = await f.execute(applyRequest), observed = await readWorldSnapshot(f.root);
  assert.deepEqual(validateSceneAnimationCreationResult(applied, applyRequest, catalog, hash), applied);
  assert.equal(applied.receipt.state, 'committed'); assert.equal(applied.revision, preview.revision); assert.equal(observed.projection.world.revision, preview.revision);
  const [source, record, sceneRecord] = await targetContents(f); assert.equal(source, f.input.content);
  assert.deepEqual(JSON.parse(record).relations, [{ kind: 'references', targetId: sceneId, slot: '' }]); assert.deepEqual(JSON.parse(record).assetBindings, []);
  assert.deepEqual(JSON.parse(sceneRecord).relations.filter(relation => relation.kind === 'animation'), [{ kind: 'animation', targetId: manifestId, slot: '' }]);
  assert.ok(sceneRecord.includes('900719925474099312345')); assert.ok(sceneRecord.includes('\r\n'));
  const after = await fingerprint(f.root); for (const [name, hash] of Object.entries(before)) if (name !== f.files[2]) assert.equal(after[name], hash, name);
  assert.deepEqual(Object.keys(after).filter(name => !Object.hasOwn(before, name)).sort(), [f.files[0], f.files[1], `${journal}/head.json`].sort());
  const ready = await service.inspect({ sceneObjectId: sceneId }); assert.equal(ready.status, 'ready'); assert.equal(ready.manifest.trackCount, 4);
  assert.equal(ready.manifest.content, f.input.content); assert.ok(Object.isFrozen(ready.targets[0])); assert.equal(confirmSceneAnimationCreation(ready, applyRequest, hash), true);
  await assert.rejects(f.execute(applyRequest), { errorCode: 'world_revision_conflict' });
});

test('catalog and creation ignore broken audio, behavior and render settings and never read resource bytes', async t => {
  const f = await animationFixture(t), sceneRecord = JSON.parse(await fs.readFile(path.join(f.root, f.files[2])));
  for (const [kind, id] of [['audio', '88888888-1111-4111-8111-111111111111'], ['behavior', '88888888-2222-4222-8222-222222222222']]) {
    const sourcePath = `${f.documents}/broken-${kind}.json`;
    await fs.writeFile(path.join(f.root, sourcePath), '{broken');
    await fs.writeFile(path.join(f.root, `metadata/documents/${id}.json`), json({ format: 'viento-document', version: 1, id, sourcePath,
      documentType: 'character', parserProfile: 'structured', relations: [{ kind: 'references', targetId: sceneId }], assetBindings: [] }));
    sceneRecord.relations.push({ kind, targetId: id });
  }
  await fs.writeFile(path.join(f.root, f.files[2]), json(sceneRecord));
  const scene = JSON.parse(await fs.readFile(path.join(f.root, f.scenePath))); scene.actors[0].position = ['rendering is not consulted']; await fs.writeFile(path.join(f.root, f.scenePath), json(scene));
  await fs.mkdir(path.join(f.root, 'assets'), { recursive: true }); await fs.writeFile(path.join(f.root, 'assets/foreign.wav'), 'not WAV');
  const observed = await readWorldSnapshot(f.root), object = observed.projection.objects.find(object => object.id === sceneId);
  f.input.baseRevision = observed.projection.world.revision; f.input.sceneObjectRevision = object.revision; f.input.sceneSourceRevision = object.documentRefs[0].sourceRevision;
  const before = await fingerprint(f.root), original = fs.readFile, reads = [];
  const mock = t.mock.method(fs, 'readFile', async function(file, ...args) { reads.push(String(file)); return original.call(fs, file, ...args); });
  assert.equal((await createSceneAnimationCreationService(f.root).inspect({ sceneObjectId: sceneId })).targets.length, 2);
  assert.equal((await f.execute({ ...f.input, mode: 'preview' })).status, 'preview'); mock.mock.restore(); assert.deepEqual(await fingerprint(f.root), before);
  assert.equal(reads.some(file => /\.wav$/i.test(file)), false);
  assert.equal((await f.execute(f.input)).status, 'applied'); assert.equal(await fs.readFile(path.join(f.root, 'assets/foreign.wav'), 'utf8'), 'not WAV');
});

test('scene definition and registration edits invalidate preview before any target publishes', async t => {
  for (const target of ['scene', 'actor', 'record']) {
    const f = await animationFixture(t); await f.execute({ ...f.input, mode: 'preview' });
    const relative = target === 'scene' ? f.scenePath : target === 'actor' ? `${f.documents}/characters/traveler.md` : f.files[2];
    if (target === 'record') { const record = JSON.parse(await fs.readFile(path.join(f.root, relative))); record.changedByAuthor = true; await fs.writeFile(path.join(f.root, relative), json(record)); }
    else await fs.appendFile(path.join(f.root, relative), '\n');
    const before = await fingerprint(f.root); await assert.rejects(f.execute(f.input), { errorCode: 'world_revision_conflict' }); assert.deepEqual(await fingerprint(f.root), before);
  }
});

test('same-size source substitution with restored mtime is caught at the final pre-intent boundary', async t => {
  const f = await animationFixture(t), file = path.join(f.root, `${f.documents}/characters/traveler.md`), original = fs.rename; let changed = false;
  const mock = t.mock.method(fs, 'rename', async function(from, to) {
    const result = await original.call(fs, from, to);
    if (!changed && String(to).endsWith('/animation-dependencies.json')) {
      const stat = await fs.stat(file), bytes = await fs.readFile(file); bytes[2] = bytes[2] === 84 ? 88 : 84;
      await fs.writeFile(file, bytes); await fs.utimes(file, stat.atime, stat.mtime); changed = true;
    }
    return result;
  });
  await assert.rejects(f.execute(f.input), { errorCode: 'world_revision_conflict' }); mock.mock.restore();
  assert.equal(changed, true); assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  assert.deepEqual(await fs.readdir(path.join(f.root, journal)).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
});

test('parallel in-process and real multi-process requests cannot create two first declarations', async t => {
  const f = await animationFixture(t), results = await Promise.allSettled([f.execute(f.input), f.execute(f.input)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(results.find(result => result.status === 'rejected').reason.errorCode, 'world_revision_conflict');
  const g = await animationFixture(t), file = path.join(g.root, '.parallel-request.json'); await fs.writeFile(file, JSON.stringify(g.input));
  const children = await Promise.all([childAnimation(g, file), childAnimation(g, file)]); await fs.rm(file);
  assert.equal(children.filter(child => child.result?.status === 'applied').length, 1, JSON.stringify(children));
  const refused = children.find(child => !child.result); assert.equal(refused.exitCode, 1);
  assert.ok(['world_revision_conflict', 'world_write_busy'].includes(refused.failure?.errorCode), JSON.stringify(refused));
  assert.equal(JSON.parse((await targetContents(g))[2]).relations.filter(relation => relation.kind === 'animation').length, 1);
});

test('existing selected declarations are navigable but cannot be overwritten or duplicated with a fresh revision', async t => {
  const f = await animationFixture(t); await f.execute(f.input); const before = await fingerprint(f.root), observed = await readWorldSnapshot(f.root);
  const scene = observed.projection.objects.find(object => object.id === sceneId), service = createSceneAnimationCreationService(f.root);
  assert.equal((await service.inspect({ sceneObjectId: sceneId })).manifest.objectId, manifestId);
  for (const objectId of [manifestId, '99999999-5555-4555-8555-555555555555']) await assert.rejects(f.execute({ ...f.input,
    objectId, sourcePath: `${f.documents}/animations/another.json`, baseRevision: observed.projection.world.revision, sceneObjectRevision: scene.revision }));
  assert.deepEqual(await fingerprint(f.root), before);
});

test('occupied aliases, hidden paths and source links preserve foreign files and refuse publication', async t => {
  for (const kind of ['occupied', 'source-link', 'hidden', 'traversal']) {
    const f = await animationFixture(t), outside = path.join(f.root, 'outside-data'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep'), 'foreign');
    if (kind === 'occupied') await fs.mkdir(path.join(f.root, `${f.documents}/animations/CREATED.JSON`));
    else if (kind === 'source-link') { await fs.symlink(outside, path.join(f.root, `${f.documents}/linked`)); f.input.sourcePath = `${f.documents}/linked/created.json`; }
    else f.input.sourcePath = kind === 'hidden' ? `${f.documents}/.hidden/created.json` : '../outside.json';
    await assert.rejects(f.execute(f.input)); assert.equal(await fs.readFile(path.join(outside, 'keep'), 'utf8'), 'foreign'); assert.deepEqual((await targetContents(f)).slice(0, 2), [null, null]);
  }
});

test('malformed semantics, stale targets, unsupported type and oversized UTF-8 body never publish', async t => {
  const changes = [value => { value.content = '{}'; }, value => { const m = JSON.parse(value.content.replace(/^\ufeff/, '')); m.sceneObjectId = actorId; value.content = json(m); },
    value => { const m = JSON.parse(value.content.replace(/^\ufeff/, '')); m.tracks[0].instanceId = manifestId; value.content = json(m); },
    value => { value.documentType = 'nonexistent'; }, value => { value.content += ' '.repeat(131073); }, value => { value.content += '中'.repeat(44000); }];
  for (const change of changes) { const f = await animationFixture(t); change(f.input); const before = await fingerprint(f.root);
    await assert.rejects(f.execute(f.input)); assert.deepEqual(await fingerprint(f.root), before); }
});

test('catalog captures requests before await and rejects accessors and extra authority without invoking code', async t => {
  const f = await animationFixture(t), service = createSceneAnimationCreationService(f.root), payload = { sceneObjectId: sceneId };
  const pending = service.inspect(payload); payload.sceneObjectId = manifestId; assert.equal((await pending).scene.objectId, sceneId);
  let calls = 0; const getter = { get sceneObjectId() { calls++; return sceneId; } };
  for (const input of [null, [], {}, getter, { sceneObjectId: sceneId, execute: true }, { sceneObjectId: sceneId, [Symbol('x')]: 1 }, Object.create({ sceneObjectId: sceneId }), { sceneObjectId: '../bad' }])
    await assert.rejects(service.inspect(input), { errorCode: 'world_command_invalid' });
  assert.equal(calls, 0);
});

test('catalog rejects ambiguous animation relations and unavailable definitions instead of offering creation', async t => {
  for (const kind of ['dangling', 'ambiguous', 'definition']) { const f = await animationFixture(t);
    if (kind === 'definition') await fs.rm(path.join(f.root, `${f.documents}/characters/traveler.md`));
    else { await f.execute(f.input); const file = path.join(f.root, f.files[2]), record = JSON.parse(await fs.readFile(file));
      record.relations.push({ kind: 'animation', targetId: kind === 'dangling' ? '99999999-5555-4555-8555-555555555555' : actorId }); await fs.writeFile(file, json(record)); }
    const before = await fingerprint(f.root); await assert.rejects(createSceneAnimationCreationService(f.root).inspect({ sceneObjectId: sceneId })); assert.deepEqual(await fingerprint(f.root), before); }
});

test('ready context stays navigable after a target instance is deleted without authoring a replacement', async t => {
  const f = await animationFixture(t); await f.execute(f.input);
  const file = path.join(f.root, f.scenePath), scene = JSON.parse(await fs.readFile(file)); scene.actors = scene.actors.slice(1); await fs.writeFile(file, json(scene));
  const before = await fingerprint(f.root), context = await createSceneAnimationCreationService(f.root).inspect({ sceneObjectId: sceneId });
  assert.equal(context.status, 'ready'); assert.equal(context.manifest.content, f.input.content); assert.equal(context.targets.length, 1);
  assert.equal(context.targets[0].instanceId, scene.actors[0].instanceId); assert.deepEqual(await fingerprint(f.root), before);
});

test('the full 128 KiB UTF-8 declaration budget remains usable by preview, commit and ready catalog', async t => {
  const f = await animationFixture(t); f.input.content += ' '.repeat(131072 - Buffer.byteLength(f.input.content));
  assert.equal(Buffer.byteLength(f.input.content), 131072);
  const before = await fingerprint(f.root); assert.equal((await f.execute({ ...f.input, mode: 'preview' })).status, 'preview'); assert.deepEqual(await fingerprint(f.root), before);
  assert.equal((await f.execute(f.input)).status, 'applied'); assert.equal((await createSceneAnimationCreationService(f.root).inspect({ sceneObjectId: sceneId })).manifest.content, f.input.content);
});
