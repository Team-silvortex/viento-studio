import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { recoverWorldTransaction } from '../lib/world-transactions.mjs';
import { physics2DFixture, fingerprint, targetContents, crashPhysics2D, sceneId, manifestId, journal } from './helpers/world-physics2d-create-fixture.mjs';

function sliding(f) {
  const value = JSON.parse(f.input.content.replace(/^\ufeff/, ''));
  value.schemaVersion = 2; value.bodies[0].collisionResponse = 'slide';
  f.input.content = '\ufeff' + JSON.stringify(value, null, 2).replace('"layer": 1', '"layer": 1e0').replaceAll('\n', '\r\n') + '\r\n';
  return value;
}
for (const version of [2, 3]) test(`response author v2 creation preserves exact bytes and three-file ownership in workspace v${version}`, async t => {
  const f = await physics2DFixture(t, version), value = sliding(f), before = await fingerprint(f.root);
  const preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.deepEqual(await fingerprint(f.root), before);
  const result = await f.execute(f.input);
  assert.equal(result.receipt.state, 'committed'); assert.equal(result.revision, preview.revision);
  const contents = await targetContents(f); assert.equal(contents[0], f.input.content);
  assert.deepEqual(JSON.parse(contents[0].replace(/^\ufeff/, '')), value);
  assert.deepEqual(JSON.parse(contents[1]).relations, [{ kind: 'references', targetId: sceneId, slot: '' }]);
  assert.equal(JSON.parse(contents[2]).relations.filter(r => r.targetId === manifestId && r.slot === 'physics2d').length, 1);
  const observed = await readWorldSnapshot(f.root); assert.equal(observed.projection.world.revision, preview.revision);
  const after = await fingerprint(f.root);
  for (const [name, hash] of Object.entries(before)) if (name !== f.files[2]) assert.equal(after[name], hash, name);
  assert.deepEqual(Object.keys(after).filter(name => !Object.hasOwn(before, name)).sort(), [f.files[0], f.files[1], `${journal}/head.json`].sort());
});

for (const [point, index, committed] of [['intent', '-', false], ['data', 2, false], ['commit', '-', true]]) {
  test(`response author v2 uses existing v12 recovery at ${point}/${index} without losing or normalizing content`, async t => {
    const f = await physics2DFixture(t); sliding(f);
    const before = await fingerprint(f.root), preview = await f.execute({ ...f.input, mode: 'preview' });
    await crashPhysics2D(f, point, index);
    await assert.rejects(readWorldSnapshot(f.root), { errorCode: 'world_recovery_required' });
    const intent = JSON.parse(await fs.readFile(path.join(f.root, journal, 'active/intent.json')));
    assert.equal(intent.version, 12); assert.equal(intent.entries.length, 3);
    const result = await recoverWorldTransaction(f.root), contents = await targetContents(f);
    assert.equal(result.status, committed ? 'committed' : 'rolled-back');
    if (committed) {
      assert.equal(contents[0], f.input.content);
      assert.equal(JSON.parse(contents[1]).id, manifestId);
      assert.equal(JSON.parse(contents[2]).relations.filter(r => r.slot === 'physics2d').length, 1);
    } else assert.deepEqual(contents, [null, null, f.sceneRecord]);
    const after = await fingerprint(f.root);
    for (const [name, hash] of Object.entries(before)) if (name !== f.files[2] || !committed) assert.equal(after[name], hash, name);
    assert.equal((await readWorldSnapshot(f.root)).projection.world.revision, committed ? preview.revision : f.input.baseRevision);
    assert.equal((await recoverWorldTransaction(f.root)).status, 'idle');
  });
}

test('invalid response declarations fail preview and creation without publishing any author files', async t => {
  for (const bad of ['legacy-slide', 'sensor-response', 'unknown-response']) {
    const f = await physics2DFixture(t), doc = sliding(f);
    if (bad === 'legacy-slide') doc.schemaVersion = 1;
    if (bad === 'sensor-response') doc.bodies[1].collisionResponse = 'slide';
    if (bad === 'unknown-response') doc.bodies[0].collisionResponse = 'bounce';
    f.input.content = JSON.stringify(doc); const before = await fingerprint(f.root);
    for (const mode of ['preview', 'apply']) await assert.rejects(f.execute({ ...f.input, mode }));
    assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
    assert.deepEqual(await fingerprint(f.root), before);
  }
});
