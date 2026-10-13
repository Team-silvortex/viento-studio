import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { recoverWorldTransaction } from '../lib/world-transactions.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { transactionHash, readTransactionStatus } from '../lib/world-transaction-state.mjs';
import { behaviorFixture, fingerprint, targetContents, crashBehavior, json, sceneId, scriptId, actorId, manifestId, journal } from './helpers/world-behavior-create-fixture.mjs';

for (const [point, index, committed] of [['intent', '-', false], ['source-ready', 0, false], ['data', 0, false],
  ['source-ready', 1, false], ['data', 1, false], ['source-ready', 2, false], ['data', 2, false], ['commit', '-', true], ['head', '-', true]]) {
  test(`behavior.create v9 SIGKILL ${point}/${index} restores ${committed ? 'all three after-images' : 'two absences and the exact old scene record'}`, async t => {
    const f = await behaviorFixture(t), before = await fingerprint(f.root), preview = await f.execute({ ...f.input, mode: 'preview' });
    await crashBehavior(f, point, index);
    await assert.rejects(readWorldSnapshot(f.root), { errorCode: 'world_recovery_required' });
    await assert.rejects(readRegistry(f.root), { errorCode: 'world_recovery_required' });
    const intent = JSON.parse(await fs.readFile(path.join(f.root, journal, 'active/intent.json'))); assert.equal(intent.version, 9);
    assert.deepEqual(intent.entries.map(entry => entry.before === null), [true, true, false]);
    const recovered = await recoverWorldTransaction(f.root), contents = await targetContents(f);
    assert.equal(recovered.status, committed ? 'committed' : 'rolled-back');
    if (committed) { assert.equal(contents[0], f.input.content); assert.equal(JSON.parse(contents[1]).id, manifestId);
      assert.equal(JSON.parse(contents[2]).relations.filter(relation => relation.kind === 'behavior').length, 1); }
    else assert.deepEqual(contents, [null, null, f.sceneRecord]);
    const observed = await readWorldSnapshot(f.root); assert.equal(observed.projection.world.revision, committed ? preview.revision : f.input.baseRevision);
    const after = await fingerprint(f.root);
    for (const [name, hash] of Object.entries(before)) if (name !== f.files[2] || !committed) assert.equal(after[name], hash, name);
    assert.equal(Object.keys(after).some(name => /\.viento-[^/]+\.tmp$/.test(name)), false);
    assert.equal((await recoverWorldTransaction(f.root)).status, 'idle');
  });
}

test('recovery is restartable during reverse rollback and forward publication without restoring author dependencies', async t => {
  for (const committed of [false, true]) {
    const f = await behaviorFixture(t); await crashBehavior(f, committed ? 'commit' : 'data', committed ? '-' : 2);
    if (committed) {
      await fs.writeFile(path.join(f.root, f.files[2]), f.sceneRecord);
      await fs.rm(path.join(f.root, f.files[1])); await fs.rm(path.join(f.root, f.files[0]));
    }
    await fs.appendFile(path.join(f.root, f.scriptPath), '\n# author changed after interruption\n');
    await fs.appendFile(path.join(f.root, `${f.documents}/characters/traveler.md`), '\n作者后续变更\n');
    const script = await fs.readFile(path.join(f.root, f.scriptPath)), definition = await fs.readFile(path.join(f.root, `${f.documents}/characters/traveler.md`));
    await crashBehavior(f, 'recovery-file', committed ? 0 : 2, true);
    assert.equal((await recoverWorldTransaction(f.root)).status, committed ? 'committed' : 'rolled-back');
    assert.deepEqual(await fs.readFile(path.join(f.root, f.scriptPath)), script); assert.deepEqual(await fs.readFile(path.join(f.root, `${f.documents}/characters/traveler.md`)), definition);
    if (!committed) assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
    else assert.equal((await targetContents(f))[0], f.input.content);
  }
});

test('ordinary data-phase failures roll back and lost completion after commit returns the committed receipt', async t => {
  const f = await behaviorFixture(t);
  const failing = createWorldCommandService(f.root, { checkpoint: async (point, detail) => { if (point === 'data' && detail.index === 2) throw Error('simulated I/O failure'); } });
  await assert.rejects(failing(f.input)); assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  const g = await behaviorFixture(t);
  const lost = createWorldCommandService(g.root, { checkpoint: async point => { if (point === 'commit') throw Error('lost completion'); } });
  const result = await lost(g.input); assert.equal(result.status, 'applied'); assert.equal(result.receipt.state, 'committed');
  assert.equal((await readTransactionStatus(g.root)).pending, false);
});

test('external edits to owned after-images or other registrations preserve conflicts and never publish recovery files', async t => {
  for (const target of ['owned', 'registry']) {
    const f = await behaviorFixture(t); await crashBehavior(f, 'data', 1);
    const relative = target === 'owned' ? f.files[0] : `metadata/documents/${scriptId}.json`;
    await fs.appendFile(path.join(f.root, relative), target === 'owned' ? '\nexternal author edit\n' : ' ');
    // Registry guards are semantic; changing an actual extension detects a real registration edit.
    if (target === 'registry') { const record = JSON.parse(await fs.readFile(path.join(f.root, relative))); record.extra = true; await fs.writeFile(path.join(f.root, relative), json(record)); }
    const before = await fingerprint(f.root); await assert.rejects(recoverWorldTransaction(f.root), { errorCode: 'world_recovery_conflict' });
    assert.deepEqual(await fingerprint(f.root), before); assert.equal((await readTransactionStatus(f.root)).pending, true);
  }
});

test('v9 refuses unknown journal fields mutated metadata snapshots extra stage files and rehashed frozen dependency forgeries', async t => {
  const mutations = [
    async (intent) => { intent.extra = true; },
    async (intent) => { intent.entries[0].extra = true; },
    async (intent) => { intent.entries[0].before = `sha256:${'0'.repeat(64)}`; },
    async (intent) => { intent.entries[2].sourcePath = `metadata/documents/${actorId}.json`; },
    async (intent) => { intent.behaviorRecovery.size = 32 * 1024 * 1024 + 1; },
    async (intent, f, active) => { const data = JSON.parse(await fs.readFile(path.join(active, 'behavior-dependencies.json'))); data.extra = true;
      const bytes = Buffer.from(JSON.stringify(data)); await fs.writeFile(path.join(active, 'behavior-dependencies.json'), bytes); intent.behaviorRecovery = { size: bytes.length, sha256: transactionHash(bytes) }; },
    async (intent, f, active) => { const data = JSON.parse(await fs.readFile(path.join(active, 'behavior-dependencies.json'))); data.scripts.push({ ...data.scripts[0] });
      const bytes = Buffer.from(JSON.stringify(data)); await fs.writeFile(path.join(active, 'behavior-dependencies.json'), bytes); intent.behaviorRecovery = { size: bytes.length, sha256: transactionHash(bytes) }; },
    async (intent, f, active) => { const record = JSON.parse(await fs.readFile(path.join(active, '2.after'))); record.injected = true;
      const bytes = Buffer.from(json(record)); await fs.writeFile(path.join(active, '2.after'), bytes); intent.entries[2].after = transactionHash(bytes); },
    async (intent, f, active) => { await fs.writeFile(path.join(active, 'unlisted-source.json'), 'foreign'); },
  ];
  for (const mutate of mutations) {
    const f = await behaviorFixture(t); await crashBehavior(f, 'data', 0);
    const active = path.join(f.root, journal, 'active'), file = path.join(active, 'intent.json'), intent = JSON.parse(await fs.readFile(file));
    await mutate(intent, f, active); await fs.writeFile(file, JSON.stringify(intent)); const before = await fingerprint(f.root);
    await assert.rejects(recoverWorldTransaction(f.root), { errorCode: 'world_journal_invalid' }); assert.deepEqual(await fingerprint(f.root), before);
    assert.equal((await readTransactionStatus(f.root)).pending, true);
  }
});

test('foreign metadata temp names and symlinks are not hidden by the two-path v9 recovery exception', async t => {
  for (const kind of ['foreign', 'link']) {
    const f = await behaviorFixture(t); await crashBehavior(f, 'source-ready', 2);
    const intent = JSON.parse(await fs.readFile(path.join(f.root, journal, 'active/intent.json'))), name = `metadata/documents/.viento-${intent.id}-2.tmp`;
    if (kind === 'foreign') await fs.writeFile(path.join(f.root, 'metadata/documents/unrelated.tmp'), 'foreign');
    else { await fs.rm(path.join(f.root, name)); await fs.symlink(path.join(f.root, f.scenePath), path.join(f.root, name)); }
    await assert.rejects(recoverWorldTransaction(f.root), { errorCode: 'world_journal_invalid' });
    if (kind === 'foreign') assert.equal(await fs.readFile(path.join(f.root, 'metadata/documents/unrelated.tmp'), 'utf8'), 'foreign');
    else assert.equal((await fs.lstat(path.join(f.root, name))).isSymbolicLink(), true);
  }
});
