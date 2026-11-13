import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { recoverWorldTransaction } from '../lib/world-transactions.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readTransactionStatus, transactionHash } from '../lib/world-transaction-state.mjs';
import { physics2DFixture, fingerprint, targetContents, crashPhysics2D, json, sceneId, actorId, manifestId, journal } from './helpers/world-physics2d-create-fixture.mjs';

async function fixture(t, version = 3, follow = false) {
  const f = await physics2DFixture(t, version);
  const elements = [{ id: '12121212-1212-4212-8212-121212121212', kind: 'label', anchor: 'top-left', offset: [12, 16], size: [240, 40], fontSize: 24, color: '#ffffff',
    content: { kind: 'state', key: 'score', prefix: '分数 / Score / 得点: ', suffix: '', missing: '0' } },
    { id: '23232323-2323-4323-8323-232323232323', kind: 'bar', anchor: 'top-right', offset: [-12, 16], size: [200, 20], key: 'health', min: 0, max: 100, fallback: 50, fillColor: '#80d9b6', backgroundColor: '#102030ff' }];
  f.input.command = 'hud2d.create'; f.input.content = '\uFEFF' + json({ format: 'viento-scene-hud2d', schemaVersion: 1, sceneObjectId: sceneId, elements }).replaceAll('\n', '\r\n');
  return f;
}
for (const version of [2, 3]) test(`hud2d.create workspace ${version} preview/apply publishes exactly three files`, async t => {
  const f = await fixture(t, version, true), before = await fingerprint(f.root), preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.deepEqual(await fingerprint(f.root), before); assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  assert.deepEqual(preview.changes.map(item => item.kind), ['hud2d.create', 'relation.add']);
  const result = await f.execute(f.input); assert.equal(result.receipt.state, 'committed'); assert.equal(result.revision, preview.revision);
  const [source, record, scene] = await targetContents(f); assert.equal(source, f.input.content);
  assert.deepEqual(JSON.parse(record).relations, [{ kind: 'references', targetId: sceneId, slot: 'scene' }]);
  assert.deepEqual(JSON.parse(scene).relations.filter(item => item.slot === 'hud2d'), [{ kind: 'references', targetId: manifestId, slot: 'hud2d' }]);
  assert.ok(scene.includes('900719925474099312345')); assert.ok(scene.includes('\r\n'));
  const after = await fingerprint(f.root); for (const [name, hash] of Object.entries(before)) if (name !== f.files[2]) assert.equal(after[name], hash, name);
  await assert.rejects(f.execute(f.input), { errorCode: 'world_revision_conflict' });
});
for (const [point, index, committed] of [['intent', '-', false], ['source-ready', 0, false], ['data', 0, false], ['source-ready', 1, false], ['data', 1, false], ['source-ready', 2, false], ['data', 2, false], ['commit', '-', true], ['head', '-', true]]) test(`hud2d v14 SIGKILL at ${point}/${index}`, async t => {
  const f = await fixture(t, 3, true), before = await fingerprint(f.root), preview = await f.execute({ ...f.input, mode: 'preview' });
  await crashPhysics2D(f, point, index); await assert.rejects(readWorldSnapshot(f.root), { errorCode: 'world_recovery_required' });
  const intent = JSON.parse(await fs.readFile(path.join(f.root, journal, 'active/intent.json'))); assert.equal(intent.version, 14);
  assert.deepEqual(intent.entries.map(entry => entry.before === null), [true, true, false]);
  const recovered = await recoverWorldTransaction(f.root), actual = await targetContents(f); assert.equal(recovered.status, committed ? 'committed' : 'rolled-back');
  if (committed) { assert.equal(actual[0], f.input.content); assert.equal(JSON.parse(actual[1]).id, manifestId); assert.equal(JSON.parse(actual[2]).relations.filter(item => item.slot === 'hud2d').length, 1); }
  else assert.deepEqual(actual, [null, null, f.sceneRecord]);
  assert.equal((await readWorldSnapshot(f.root)).projection.world.revision, committed ? preview.revision : f.input.baseRevision);
  const after = await fingerprint(f.root); for (const [name, hash] of Object.entries(before)) if (name !== f.files[2] || !committed) assert.equal(after[name], hash, name);
  assert.equal((await recoverWorldTransaction(f.root)).status, 'idle');
});
test('ordinary data-phase failure rolls back and a lost post-commit response converges', async t => {
  const f = await fixture(t), failing = createWorldCommandService(f.root, { checkpoint: async (point, detail) => { if (point === 'data' && detail.index === 2) throw Error('injected failure'); } });
  await assert.rejects(failing(f.input)); assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  const g = await fixture(t), lost = createWorldCommandService(g.root, { checkpoint: async point => { if (point === 'commit') throw Error('lost response'); } });
  assert.equal((await lost(g.input)).receipt.state, 'committed'); assert.equal((await readTransactionStatus(g.root)).pending, false);
});
test('owned source or foreign registration edits block recovery without any publication', async t => {
  for (const target of ['owned', 'registry']) {
    const f = await fixture(t); await crashPhysics2D(f, 'data', 1);
    const file = path.join(f.root, target === 'owned' ? f.files[0] : `metadata/documents/${actorId}.json`);
    if (target === 'owned') await fs.appendFile(file, ' foreign'); else { const value = JSON.parse(await fs.readFile(file)); value.extra = true; await fs.writeFile(file, json(value)); }
    const before = await fingerprint(f.root); await assert.rejects(recoverWorldTransaction(f.root), { errorCode: 'world_recovery_conflict' });
    assert.deepEqual(await fingerprint(f.root), before); assert.equal((await readTransactionStatus(f.root)).pending, true);
  }
});
test('v14 rejects rehashed forged dependencies, altered reverse link and unlisted stage files', async t => {
  const mutations = [
    async (intent, active) => { intent.extra = true; },
    async (intent, active) => { const name = path.join(active, 'hud2d-dependencies.json'), value = JSON.parse(await fs.readFile(name)); value.definitions[0].content += 'tamper'; const bytes = Buffer.from(JSON.stringify(value)); await fs.writeFile(name, bytes); intent.hud2DRecovery = { size: bytes.length, sha256: transactionHash(bytes) }; },
    async (intent, active) => { const name = path.join(active, '1.after'), value = JSON.parse(await fs.readFile(name)); value.relations[0].slot = ''; const bytes = Buffer.from(json(value)); await fs.writeFile(name, bytes); intent.entries[1].after = transactionHash(bytes); },
    async (intent, active) => { await fs.writeFile(path.join(active, 'unknown.json'), 'foreign'); },
  ];
  for (const mutate of mutations) {
    const f = await fixture(t); await crashPhysics2D(f, 'data', 0); const active = path.join(f.root, journal, 'active'), file = path.join(active, 'intent.json'), intent = JSON.parse(await fs.readFile(file));
    await mutate(intent, active); await fs.writeFile(file, JSON.stringify(intent)); const before = await fingerprint(f.root);
    await assert.rejects(recoverWorldTransaction(f.root), { errorCode: 'world_journal_invalid' }); assert.deepEqual(await fingerprint(f.root), before);
  }
});

test('recovery is restartable in rollback and forward replay without restoring changed author definitions', async t => {
  for (const committed of [false, true]) {
    const f = await fixture(t); await crashPhysics2D(f, committed ? 'commit' : 'data', committed ? '-' : 2);
    if (committed) { await fs.writeFile(path.join(f.root, f.files[2]), f.sceneRecord); await fs.rm(path.join(f.root, f.files[1])); await fs.rm(path.join(f.root, f.files[0])); }
    const file = path.join(f.root, `${f.documents}/characters/traveler.md`); await fs.appendFile(file, '\nLater author change\n'); const changed = await fs.readFile(file);
    await crashPhysics2D(f, 'recovery-file', committed ? 0 : 2, true); assert.equal((await recoverWorldTransaction(f.root)).status, committed ? 'committed' : 'rolled-back');
    assert.deepEqual(await fs.readFile(file), changed); if (!committed) assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]); else assert.equal((await targetContents(f))[0], f.input.content);
  }
});
test('simultaneous first hud creates cannot publish two opt-ins', async t => {
  const f = await fixture(t), results = await Promise.allSettled([f.execute(f.input), f.execute(f.input)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(results.find(result => result.status === 'rejected').reason.errorCode, 'world_revision_conflict');
  assert.equal(JSON.parse((await targetContents(f))[2]).relations.filter(item => item.kind === 'references' && item.slot === 'hud2d').length, 1);
});
test('invalid declaration, bad UTF-8 budget and stale target do not publish', async t => {
  const cases = [f => { f.input.content = '{}'; }, f => { f.input.content = f.input.content.replace(sceneId, actorId); },
    f => { const value = JSON.parse(f.input.content.slice(1)); value.elements.push(value.elements[0]); f.input.content = json(value); },
    f => { f.input.content += '中'.repeat(22000); }, f => { f.input.sourcePath = `${f.documents}/physics/UPPER.JSON`; }];
  for (const change of cases) { const f = await fixture(t, 3, true); change(f); const before = await fingerprint(f.root); await assert.rejects(f.execute(f.input)); assert.deepEqual(await fingerprint(f.root), before); }
});
test('symlinked output directory cannot redirect creation outside the author document root', async t => {
  const f = await fixture(t), outside = path.join(f.root, 'outside-hud'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep'), 'foreign');
  await fs.symlink(outside, path.join(f.root, `${f.documents}/hud-link`)); f.input.sourcePath = `${f.documents}/hud-link/created.json`;
  const before = await fingerprint(f.root); await assert.rejects(f.execute(f.input)); assert.deepEqual(await fingerprint(f.root), before); assert.equal(await fs.readFile(path.join(outside, 'keep'), 'utf8'), 'foreign');
});

test('same-size definition replacement preserving mtime is caught before intent publication', async t => {
  const f = await fixture(t), file = path.join(f.root, `${f.documents}/characters/traveler.md`), rename = fs.rename; let changed = false;
  const mock = t.mock.method(fs, 'rename', async function(from, to) {
    const result = await rename.call(fs, from, to);
    if (!changed && String(to).endsWith('/hud2d-dependencies.json')) {
      const stat = await fs.stat(file), data = await fs.readFile(file); data[2] = data[2] === 84 ? 88 : 84;
      await fs.writeFile(file, data); await fs.utimes(file, stat.atime, stat.mtime); changed = true;
    }
    return result;
  });
  try { await assert.rejects(f.execute(f.input), { errorCode: 'world_revision_conflict' }); } finally { mock.mock.restore(); }
  assert.equal(changed, true); assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  assert.deepEqual(await fs.readdir(path.join(f.root, journal)).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
});
test('foreign metadata temporary files or a symlink cannot be hidden by recovery', async t => {
  for (const kind of ['foreign', 'link']) {
    const f = await fixture(t); await crashPhysics2D(f, 'source-ready', 2);
    const intent = JSON.parse(await fs.readFile(path.join(f.root, journal, 'active/intent.json'))), temporary = path.join(f.root, `metadata/documents/.viento-${intent.id}-2.tmp`);
    if (kind === 'foreign') await fs.writeFile(path.join(f.root, 'metadata/documents/other.tmp'), 'foreign');
    else { await fs.rm(temporary); await fs.symlink(path.join(f.root, f.scenePath), temporary); }
    await assert.rejects(recoverWorldTransaction(f.root), { errorCode: 'world_journal_invalid' });
    if (kind === 'foreign') assert.equal(await fs.readFile(path.join(f.root, 'metadata/documents/other.tmp'), 'utf8'), 'foreign');
    else assert.equal((await fs.lstat(temporary)).isSymbolicLink(), true);
  }
});
