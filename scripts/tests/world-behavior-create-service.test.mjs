import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { createScene2DPlan } from '../../engine/build-plan.mjs';
import { behaviorFixture, fingerprint, targetContents, childBehavior, json, sceneId, scriptId, manifestId, actorId, journal } from './helpers/world-behavior-create-fixture.mjs';

for (const version of [2, 3]) test(`behavior.create workspace v${version} preview predicts all three owned files and apply preserves every other author byte`, async t => {
  const f = await behaviorFixture(t, version), before = await fingerprint(f.root), preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.deepEqual(await fingerprint(f.root), before); assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  assert.equal(preview.object.id, manifestId); assert.equal(preview.scene.id, sceneId); assert.equal(preview.proposal.affectedObjects.length, 2);
  assert.deepEqual(preview.changes.map(change => change.kind), ['behavior.create', 'relation.add']);
  const applied = await f.execute(f.input), observed = await readWorldSnapshot(f.root), plan = createScene2DPlan(observed, sceneId);
  assert.equal(applied.receipt.state, 'committed'); assert.equal(applied.revision, preview.revision); assert.equal(observed.projection.world.revision, preview.revision);
  assert.equal(plan.ok, true); assert.equal(plan.plan.behaviors.bindings.length, 2); assert.equal(plan.plan.behaviors.bindings[0].objectId, actorId);
  const [source, record, sceneRecord] = await targetContents(f); assert.equal(source, f.input.content);
  assert.deepEqual(JSON.parse(record).relations.map(relation => relation.targetId).sort(), [sceneId, scriptId].sort());
  assert.deepEqual(JSON.parse(sceneRecord).relations.filter(relation => relation.kind === 'behavior'), [{ kind: 'behavior', targetId: manifestId, slot: '' }]);
  assert.ok(sceneRecord.includes('900719925474099312345')); assert.ok(sceneRecord.includes('\r\n'));
  const after = await fingerprint(f.root);
  for (const [name, hash] of Object.entries(before)) if (name !== f.files[2]) assert.equal(after[name], hash, name);
  assert.deepEqual(Object.keys(after).filter(name => !Object.hasOwn(before, name)).sort(), [f.files[0], f.files[1], `${journal}/head.json`].sort());
  await assert.rejects(f.execute(f.input), { errorCode: 'world_revision_conflict' });
});

test('behavior creation treats implementation text as inert source and never adds author script content', async t => {
  const f = await behaviorFixture(t);
  await fs.writeFile(path.join(f.root, f.scriptPath), 'process.exit(81); throw new Error("must never execute");\n');
  const observed = await readWorldSnapshot(f.root), scene = observed.projection.objects.find(object => object.id === sceneId);
  const request = { ...f.input, baseRevision: observed.projection.world.revision, sceneObjectRevision: scene.revision };
  const before = await fs.readFile(path.join(f.root, f.scriptPath)); const applied = await f.execute(request);
  assert.equal(applied.status, 'applied'); assert.deepEqual(await fs.readFile(path.join(f.root, f.scriptPath)), before);
});

test('scene script actor and metadata edits invalidate preview before any of the three targets publishes', async t => {
  for (const target of ['scene', 'script', 'actor', 'record']) {
    const f = await behaviorFixture(t); await f.execute({ ...f.input, mode: 'preview' });
    const relative = target === 'scene' ? f.scenePath : target === 'script' ? f.scriptPath : target === 'actor' ? `${f.documents}/characters/traveler.md` : f.files[2];
    if (target === 'record') { const record = JSON.parse(await fs.readFile(path.join(f.root, relative))); record.changedByAuthor = true; await fs.writeFile(path.join(f.root, relative), json(record)); }
    else await fs.appendFile(path.join(f.root, relative), '\n');
    const before = await fingerprint(f.root);
    await assert.rejects(f.execute(f.input), { errorCode: 'world_revision_conflict' });
    assert.deepEqual(await fingerprint(f.root), before); assert.deepEqual((await targetContents(f)).slice(0, 2), [null, null]);
  }
});

test('a dependency edit at beforeIntent keeps all author targets unchanged and removes unpublished staging', async t => {
  const f = await behaviorFixture(t), original = fs.rename; let changed = false;
  fs.rename = async (from, to) => {
    const result = await original.call(fs, from, to);
    if (!changed && String(to).endsWith('/behavior-dependencies.json')) { changed = true; await fs.appendFile(path.join(f.root, f.scriptPath), '\n# external edit before intent\n'); }
    return result;
  };
  try { await assert.rejects(createWorldCommandService(f.root)(f.input), { errorCode: 'world_revision_conflict' }); }
  finally { fs.rename = original; }
  assert.equal(changed, true); assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  assert.deepEqual(await fs.readdir(path.join(f.root, journal)), []);
});

test('request extensions paths malformed declarations identities and stale scene revisions refuse all writes', async t => {
  const f = await behaviorFixture(t), before = await fingerprint(f.root);
  for (const patch of [{ execute: true }, { sceneObjectId: actorId }, { sceneObjectRevision: `sha256:${'0'.repeat(64)}` },
    { sceneSourceRevision: `sha256:${'0'.repeat(64)}` }, { objectId: scriptId }, { sourcePath: '../outside.json' },
    { sourcePath: `${f.documents}/behaviors/new.txt` }, { content: '{}' }, { documentType: 'not-installed' }]) {
    await assert.rejects(f.execute({ ...f.input, ...patch }), error => error.errorCode?.startsWith('world_'));
    assert.deepEqual(await fingerprint(f.root), before);
  }
});

test('parallel in-process and real multi-process requests cannot create two first behavior manifests', async t => {
  const f = await behaviorFixture(t), results = await Promise.allSettled([f.execute(f.input), f.execute(f.input)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.errorCode, 'world_revision_conflict');
  const g = await behaviorFixture(t), file = path.join(g.root, '.parallel-request.json'); await fs.writeFile(file, JSON.stringify(g.input));
  const children = await Promise.all([childBehavior(g, file), childBehavior(g, file)]); await fs.rm(file);
  assert.equal(children.filter(child => child.result?.status === 'applied').length, 1);
  const refused = children.find(child => !child.result); assert.equal(refused.exitCode, 1);
  assert.ok(['world_revision_conflict', 'world_write_busy'].includes(refused.failure?.errorCode), JSON.stringify(refused));
  assert.equal(refused.failure.statusCode, 409);
  assert.equal(JSON.parse((await targetContents(g))[2]).relations.filter(relation => relation.kind === 'behavior').length, 1);
});

test('occupied portable aliases and filesystem links outside source keep foreign files intact', async t => {
  for (const kind of ['occupied', 'link']) {
    const f = await behaviorFixture(t), outside = path.join(f.root, 'outside-data'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep'), 'foreign');
    if (kind === 'occupied') await fs.mkdir(path.join(f.root, `${f.documents}/behaviors/CREATED.JSON`));
    else { await fs.symlink(outside, path.join(f.root, `${f.documents}/linked`)); f.input.sourcePath = `${f.documents}/linked/created.json`; }
    await assert.rejects(f.execute(f.input)); assert.equal(await fs.readFile(path.join(outside, 'keep'), 'utf8'), 'foreign');
    assert.deepEqual((await targetContents(f)).slice(0, 2), [null, null]);
  }
});
