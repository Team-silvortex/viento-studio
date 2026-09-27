import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../lib/process.mjs';
import Ajv from 'ajv/dist/2020.js';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { createNodeDocumentStorage } from '../adapters/node-document-storage.mjs';
import { recoverWorldTransaction } from '../lib/world-transactions.mjs';
import { readTransactionStatus, readWorldFence, assertWorldFence } from '../lib/world-transaction-state.mjs';
import { readRegistry, withRegistryLock } from '../lib/workspace.mjs';
import { createExportService } from '../lib/export-service.mjs';
import { worldMutationDescriptors } from '../../engine/world-command-contract.mjs';
import { runWorldQuery } from '../world.mjs';
import { fixture, write, serve, request } from './helpers.mjs';

const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'];
const journal = '.viento/world-transactions';
async function materialize(t, version = 3, root) {
  if (!root) { root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-transaction-')); t.after(() => fs.rm(root, { recursive: true, force: true })); }
  const frozen = JSON.parse(await fs.readFile(new URL(`fixtures/predecessor/v${version}.json`, import.meta.url)));
  for (const [name, content] of Object.entries(frozen.files)) await write(root, name, content);
  const record = JSON.parse(frozen.files[`metadata/documents/${ids[0]}.json`]);
  record.id = ids[1]; record.sourcePath = record.sourcePath.replace('traveler.md', 'companion.md');
  await write(root, `metadata/documents/${ids[1]}.json`, JSON.stringify(record));
  await write(root, record.sourcePath, '\uFEFF# 同伴\r\n\r\n姓名：同伴\r\n生命：200\r\n\r\n保留空格。  \r\n');
  const projection = await readWorldProjection(root);
  const commands = ids.map((id, index) => {
    const object = projection.objects.find(item => item.id === id);
    const [key] = Object.entries(object.properties).find(([, value]) => value.label === '生命');
    return { command: 'property.set', objectId: id, objectRevision: object.revision, sourceRevision: object.documentRefs[0].sourceRevision,
      propertyPath: `/properties/${key}`, value: index ? '225' : '125' };
  });
  const input = { command: 'changeset.apply', mode: 'apply', worldId: projection.world.id, baseRevision: projection.world.revision,
    actorRef: { kind: 'tool', id: 'transaction-test' }, commands };
  const files = [frozen.sourcePath, record.sourcePath];
  const before = await Promise.all(files.map(file => fs.readFile(path.join(root, file), 'utf8')));
  const after = before.map((value, index) => value.replace(`生命：${index ? '200' : '100'}`, `生命：${index ? '225' : '125'}`));
  return { root, files, before, after, input, execute: createWorldCommandService(root) };
}
async function contents(f) { return Promise.all(f.files.map(file => fs.readFile(path.join(f.root, file), 'utf8'))); }
async function crash(t, f, point, index = '-', recover = false, observe) {
  const requestFile = path.join(f.root, '.request.json'); await fs.writeFile(requestFile, JSON.stringify(f.input));
  const child = fork(new URL('./world-transaction-crash-worker.mjs', import.meta.url), [f.root, recover ? 'recover' : requestFile, point, String(index)], { silent: true });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = once(child, 'exit');
  let timeout;
  try {
    const event = await Promise.race([once(child, 'message').then(([value]) => value),
      exited.then(() => { throw new Error(`Worker exited: ${stderr}`); }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Worker timed out: ${stderr}`)), 15000); })]);
    assert.equal(event.stage, point, JSON.stringify(event));
    if (observe) await observe();
  } finally {
    clearTimeout(timeout); child.kill('SIGKILL'); await exited;
    await fs.rm(requestFile, { force: true });
  }
}

for (const version of [2, 3]) test(`ChangeSet v${version}: preview, exact two-source commit, receipt, no-op and inverse`, async t => {
  const f = await materialize(t, version);
  await fs.chmod(path.join(f.root, f.files[0]), 0o640);
  const beforeStat = await fs.stat(path.join(f.root, f.files[0]));
  const preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.equal(preview.status, 'preview'); assert.equal(preview.proposal.affectedObjects.length, 2);
  assert.deepEqual(await contents(f), f.before);
  await assert.rejects(fs.stat(path.join(f.root, journal)), { code: 'ENOENT' });
  assert.equal((await fs.stat(path.join(f.root, f.files[0]))).mtimeMs, beforeStat.mtimeMs);
  const result = await f.execute(f.input);
  assert.deepEqual(await contents(f), f.after);
  assert.equal(result.receipt.state, 'committed'); assert.equal((await readTransactionStatus(f.root)).pending, false);
  assert.equal((await fs.stat(path.join(f.root, f.files[0]))).mode & 0o777, 0o640);
  assert.equal((await readWorldProjection(f.root)).world.revision, preview.revision);
  const ajv = new Ajv();
  const validate = ajv.compile(JSON.parse(await fs.readFile(new URL('../../schemas/transaction-receipt-v1.schema.json', import.meta.url))));
  assert.equal(validate(result.receipt), true, JSON.stringify(validate.errors));
  const descriptor = worldMutationDescriptors().find(item => item.id === 'changeset.apply');
  const { command, ...descriptorInput } = f.input;
  assert.equal(ajv.compile(descriptor.inputSchema)(descriptorInput), true);
  const fence = await readWorldFence(f.root);
  await f.execute({ ...result.inverseCommand, mode: 'apply' });
  assert.deepEqual(await contents(f), f.before);
  await assert.rejects(assertWorldFence(f.root, fence), error => error.errorCode === 'world_read_conflict');
  const unchanged = { ...f.input, commands: f.input.commands.map((item, index) => ({ ...item, value: index ? '200' : '100' })) };
  const head = await fs.readFile(path.join(f.root, journal, 'head.json'));
  assert.equal((await f.execute(unchanged)).status, 'unchanged');
  assert.deepEqual(await fs.readFile(path.join(f.root, journal, 'head.json')), head);
  await assert.rejects(f.execute({ ...f.input, commands: [f.input.commands[0], f.input.commands[0]] }), error => error.errorCode === 'world_command_invalid');
});

test('whole-batch validation precedes every write; ordinary publication failure rolls back', async t => {
  const f = await materialize(t);
  await assert.rejects(f.execute({ ...f.input, commands: [f.input.commands[0], { ...f.input.commands[1], value: 'bad number' }] }), error => error.errorCode === 'world_property_value_invalid');
  assert.deepEqual(await contents(f), f.before);
  await assert.rejects(fs.stat(path.join(f.root, journal)), { code: 'ENOENT' });
  const failing = createWorldCommandService(f.root, { checkpoint: async (stage, { index }) => { if (stage === 'data' && index === 0) throw new Error('injected I/O failure'); } });
  await assert.rejects(failing(f.input)); assert.deepEqual(await contents(f), f.before);
  assert.equal((await readTransactionStatus(f.root)).receipt.state, 'rolled-back');
  const committed = createWorldCommandService(f.root, { checkpoint: async stage => { if (stage === 'commit') throw new Error('lost completion'); } });
  assert.equal((await committed(f.input)).status, 'applied'); assert.deepEqual(await contents(f), f.after);
});

for (const [point, index, committed] of [['intent', '-', false], ['source-ready', 0, false], ['source-ready', 1, false], ['data', 0, false], ['data', 1, false], ['commit', '-', true], ['head', '-', true]]) {
  test(`SIGKILL after ${point}/${index}: recover to ${committed ? 'all new' : 'all old'} and block partial reads`, async t => {
    const f = await materialize(t);
    await crash(t, f, point, index);
    assert.equal((await readTransactionStatus(f.root)).pending, true);
    const blocked = error => error.errorCode === 'world_recovery_required';
    await assert.rejects(readWorldProjection(f.root), blocked);
    await assert.rejects(readRegistry(f.root), blocked);
    await assert.rejects(withRegistryLock(f.root, () => assert.fail('legacy write entered')), blocked);
    const storage = createNodeDocumentStorage({ root: f.root });
    await assert.rejects(storage.read({ handle: path.join(f.root, f.files[0]) }), blocked);
    await assert.rejects(createExportService(f.root).create({}), blocked);
    const result = await runWorldQuery(['--root', f.root, '--recover']);
    assert.equal(result.status, committed ? 'committed' : 'rolled-back');
    assert.deepEqual(await contents(f), committed ? f.after : f.before);
    assert.equal((await recoverWorldTransaction(f.root)).status, 'idle');
    assert.equal((await readTransactionStatus(f.root)).pending, false);
    assert.equal((await fs.readdir(path.dirname(path.join(f.root, f.files[0])))).some(name => name.startsWith('.viento-')), false);
  });
}

test('SIGKILL during rollback and roll-forward is idempotent across another restart', async t => {
  for (const committed of [false, true]) {
    const f = await materialize(t);
    await crash(t, f, committed ? 'commit' : 'data', committed ? '-' : 1);
    if (committed) for (const [index, file] of f.files.entries()) await write(f.root, file, f.before[index]);
    await crash(t, f, 'recovery-file', 0, true);
    assert.equal((await readTransactionStatus(f.root)).pending, true);
    await recoverWorldTransaction(f.root);
    assert.deepEqual(await contents(f), committed ? f.after : f.before);
  }
});

for (const kind of ['external-source', 'truncated-image', 'symlink-image', 'escaping-path', 'foreign-project', 'bad-commit', 'oversized-intent']) {
  test(`recovery preserves every source and the journal on ${kind}`, async t => {
    const f = await materialize(t); await crash(t, f, 'data', 0);
    const intentFile = `${journal}/active/intent.json`, intent = JSON.parse(await fs.readFile(path.join(f.root, intentFile)));
    if (kind === 'external-source') await write(f.root, f.files[1], 'external edit');
    if (kind === 'truncated-image') await write(f.root, `${journal}/active/1.before`, 'truncated');
    if (kind === 'symlink-image') { await fs.unlink(path.join(f.root, journal, 'active/1.after')); await fs.symlink(path.join(f.root, f.files[1]), path.join(f.root, journal, 'active/1.after')); }
    if (kind === 'escaping-path') { intent.entries[1].sourcePath = 'documents/../../outside'; await write(f.root, intentFile, JSON.stringify(intent)); }
    if (kind === 'foreign-project') { intent.projectId = ids[0]; await write(f.root, intentFile, JSON.stringify(intent)); }
    if (kind === 'bad-commit') await write(f.root, `${journal}/active/commit.json`, '{"id":"wrong"}');
    if (kind === 'oversized-intent') await write(f.root, intentFile, 'x'.repeat(65537));
    const beforeRecovery = await contents(f);
    await assert.rejects(recoverWorldTransaction(f.root), error => ['world_recovery_conflict', 'world_journal_invalid'].includes(error.errorCode));
    assert.deepEqual(await contents(f), beforeRecovery);
    assert.equal((await readTransactionStatus(f.root)).pending, true);
  });
}

test('HTTP fences cached indexes, raw sources, legacy writes and exports; authenticated recovery and startup resume work', async t => {
  const root = await fixture(t), f = await materialize(t, 3, root), base = await serve(t, root);
  assert.equal((await request(base, '/api/index')).status, 200);
  await crash(t, f, 'data', 0, false, async () => {
    await assert.rejects(recoverWorldTransaction(root), error => error.errorCode === 'registry_busy');
  });
  for (const url of ['/api/world', `/api/doc?path=${encodeURIComponent(f.files[0])}`, '/api/index', `/${f.files[0]}`]) {
    const result = await request(base, url); assert.equal(result.status, 409, `${url}: ${JSON.stringify(result)}`);
  }
  assert.equal((await request(base, '/api/doc', { path: f.files[0], content: 'legacy', expectedVersion: f.input.commands[0].sourceRevision })).status, 409);
  assert.equal((await request(base, '/api/export', { kind: 'workspace' })).status, 409);
  assert.equal((await request(base, '/api/world/transaction')).data.pending, true);
  const recovered = await request(base, '/api/world/commands', { command: 'world.recover', mode: 'apply' });
  assert.equal(recovered.status, 200); assert.equal(recovered.data.status, 'rolled-back');
  assert.deepEqual(await contents(f), f.before);
  const preview = await request(base, '/api/world/commands', { ...f.input, mode: 'preview' });
  assert.equal(preview.status, 200);
  const applied = await request(base, '/api/world/commands', f.input);
  assert.equal(applied.data.revision, preview.data.revision); assert.deepEqual(await contents(f), f.after);
  const other = await fixture(t), pending = await materialize(t, 3, other);
  await crash(t, pending, 'data', 0); const restarted = await serve(t, other);
  assert.equal((await request(restarted, '/api/world/transaction')).data.pending, false);
  assert.deepEqual(await contents(pending), pending.before);
});

test('ChangeSet planning runs in browser globals with exact integers and no host I/O', async () => {
  const result = await runCommand(process.execPath, ['--experimental-vm-modules', fileURLToPath(new URL('./world-portable-runtime.mjs', import.meta.url)), '--changesets']);
  assert.deepEqual(JSON.parse(result.stdout), { after: '{"count":9007199254740995}', inverse: '9007199254740993', proposal: 'proposed', unchanged: true });
});

test('recovery requires the same write authentication as semantic commits', async t => {
  const root = await fixture(t), f = await materialize(t, 3, root);
  const base = await serve(t, root, { DOC_API_TOKEN: 'recovery-fixture-token', DOC_API_REQUIRE_WRITE_AUTH: '1' });
  await crash(t, f, 'data', 0);
  const input = { command: 'world.recover', mode: 'apply' };
  assert.equal((await request(base, '/api/world/commands', input)).status, 401);
  assert.equal((await readTransactionStatus(root)).pending, true);
  const response = await fetch(`${base}/api/world/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer recovery-fixture-token' }, body: JSON.stringify(input) });
  assert.equal(response.status, 200); assert.deepEqual(await contents(f), f.before);
});
