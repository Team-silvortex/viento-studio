import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { recoverWorldTransaction } from '../lib/world-transactions.mjs';
import { readTransactionStatus, transactionHash } from '../lib/world-transaction-state.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { createExportService } from '../lib/export-service.mjs';
import { worldMutationDescriptors } from '../../engine/world-command-contract.mjs';
import { runWorldQuery } from '../world.mjs';
import { runCommand } from '../lib/process.mjs';
import { fixture, write, serve, request } from './helpers.mjs';
import { nativeMobileLibrary } from './mobile-native-harness.mjs';
import { createMobilePlatform } from '../../mobile/platform.mjs';

const objectId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const recordPath = `metadata/documents/${objectId}.json`;
const journal = '.viento/world-transactions';
async function materialize(t, version = 3, root) {
  if (!root) { root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-create-')); t.after(() => fs.rm(root, { recursive: true, force: true })); }
  const frozen = JSON.parse(await fs.readFile(new URL(`fixtures/predecessor/v${version}.json`, import.meta.url)));
  for (const [name, content] of Object.entries(frozen.files)) await write(root, name, content);
  const projection = await readWorldProjection(root);
  const sourcePath = `${version === 3 ? 'documents' : 'design-data'}/new/subfolder/new.json`;
  const input = { command: 'object.create', mode: 'apply', objectId, documentType: 'character', sourcePath,
    content: '\uFEFF{ "name":"新对象", "count":9007199254740993 }\r\n',
    worldId: projection.world.id, baseRevision: projection.world.revision, actorRef: { kind: 'tool', id: 'creation-test' } };
  return { root, input, execute: createWorldCommandService(root), files: [sourcePath, recordPath] };
}
async function contents(f) {
  return Promise.all(f.files.map(file => fs.readFile(path.join(f.root, file), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; })));
}
async function fingerprint(root) {
  const result = {};
  async function walk(dir, prefix = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`, file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file, `${name}/`); else result[name] = transactionHash(await fs.readFile(file));
    }
  }
  await walk(root); return result;
}
async function crash(f, point, index = '-', recovery = false) {
  const requestFile = path.join(f.root, '.request.json'); await fs.writeFile(requestFile, JSON.stringify(f.input));
  const child = fork(new URL('./world-transaction-crash-worker.mjs', import.meta.url), [f.root, recovery ? 'recover' : requestFile, point, String(index)], { silent: true, execArgv: [] });
  let stderr = '', timeout;
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = once(child, 'exit');
  try {
    const event = await Promise.race([once(child, 'message').then(([value]) => value),
      exited.then(() => { throw new Error(`Worker exited: ${stderr}`); }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Worker timeout: ${stderr}`)), 15000); })]);
    assert.equal(event.stage, point);
  } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited; await fs.rm(requestFile, { force: true }); }
}

for (const version of [2, 3]) test(`object.create v${version}: pure preview, exact source + UUID record, schema, revision and stale retry`, async t => {
  const f = await materialize(t, version), before = await fingerprint(f.root);
  const preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.deepEqual(await fingerprint(f.root), before);
  assert.deepEqual(await contents(f), [null, null]);
  assert.equal(preview.object.id, objectId);
  assert.equal(Object.values(preview.object.properties).find(field => field.label === 'count').value, '9007199254740993');
  const ajv = new Ajv();
  const descriptor = worldMutationDescriptors().find(item => item.id === 'object.create');
  for (const [file, value] of [['command-descriptor', descriptor], ['changeset', preview.proposal]]) {
    const validate = ajv.compile(JSON.parse(await fs.readFile(new URL(`../../schemas/${file}-v1.schema.json`, import.meta.url))));
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
  }
  const { command, ...args } = f.input;
  assert.equal(ajv.compile(descriptor.inputSchema)(args), true);
  assert.equal(ajv.compile(descriptor.outputSchema)(preview), true);
  assert.equal(descriptor.undoMode, 'none');
  const applied = await f.execute(f.input), view = await readWorldProjection(f.root);
  assert.deepEqual({ ...applied, receipt: undefined }, { ...preview, status: 'applied', receipt: undefined });
  assert.equal(applied.receipt.state, 'committed'); assert.equal(view.world.revision, preview.revision);
  assert.deepEqual(view.objects.find(item => item.id === objectId), preview.object);
  const [source, record] = await contents(f);
  assert.equal(source, f.input.content); assert.deepEqual(JSON.parse(record), preview.changes[0].record);
  assert.equal((await readRegistry(f.root)).documents.find(item => item.id === objectId).sourcePath, f.input.sourcePath);
  const after = await fingerprint(f.root);
  for (const [file, hash] of Object.entries(before)) assert.equal(after[file], hash, file);
  assert.deepEqual(Object.keys(after).filter(file => !Object.hasOwn(before, file)).sort(), [...f.files, `${journal}/head.json`].sort());
  await assert.rejects(f.execute(f.input), error => error.errorCode === 'world_revision_conflict');
  await assert.rejects(f.execute({ ...f.input, baseRevision: view.world.revision }), error => error.errorCode === 'world_identity_conflict');
  assert.equal((await recoverWorldTransaction(f.root)).status, 'idle');
});

test('an empty new source remains distinct from absence during rollback and publication', async t => {
  const f = await materialize(t);
  f.input = { ...f.input, sourcePath: 'documents/new/empty.md', content: '' }; f.files[0] = f.input.sourcePath;
  const preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.equal(preview.changes[0].beforeText, null); assert.equal(preview.changes[0].afterText, '');
  await crash(f, 'data', 0); assert.deepEqual(await contents(f), ['', null]);
  await recoverWorldTransaction(f.root); assert.deepEqual(await contents(f), [null, null]);
  await f.execute(f.input); assert.equal((await contents(f))[0], '');
  assert.equal((await readWorldProjection(f.root)).world.revision, preview.revision);
});

test('creation rejects unknown types, identities, reserved paths, malformed sources and extra keys before writing', async t => {
  const f = await materialize(t), before = await fingerprint(f.root);
  for (const [patch, code] of [
    [{ documentType: 'not-installed' }, 'world_type_unknown'],
    [{ objectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, 'world_identity_conflict'],
    [{ objectId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, 'world_identity_conflict'],
    [{ sourcePath: 'documents/CHARACTERS/new.md' }, 'world_create_path_conflict'],
    [{ sourcePath: 'documents/characters/traveler.md/child.md' }, 'world_create_path_conflict'],
    [{ sourcePath: 'documents/characters' }, 'world_create_path_conflict'],
    [{ content: '{bad json}' }, 'world_create_source_invalid'],
    [{ sourcePath: 'documents/new.yaml', content: 'value: [broken' }, 'world_create_source_invalid'],
    [{ content: '\uD800' }, 'world_command_invalid'], [{ sourcePath: 'documents/\uD800.md' }, 'world_command_invalid'],
    [{ force: true }, 'world_command_invalid'], [{ objectId: '../bad' }, 'world_command_invalid'],
    ...['../outside.md', 'assets/new.md', 'documents/../new.md', 'documents/.hidden.md', 'documents/CON.md',
      'documents/new.exe', 'documents/new.md ', 'documents//new.md'].map(sourcePath => [{ sourcePath }, 'world_create_path_invalid']),
  ]) await assert.rejects(f.execute({ ...f.input, ...patch }), error => error.errorCode === code, JSON.stringify(patch));
  assert.deepEqual(await fingerprint(f.root), before);
  await fs.rm(path.join(f.root, 'documents/characters/traveler.md'));
  const current = await readWorldProjection(f.root);
  await assert.rejects(f.execute({ ...f.input, baseRevision: current.world.revision, sourcePath: 'documents/characters/traveler.md' }), error => error.errorCode === 'world_create_path_conflict');
});

test('creation checks filesystem directories, NFC aliases and symlinks omitted from the object inventory', async t => {
  const f = await materialize(t);
  await fs.mkdir(path.join(f.root, 'documents/Caf\u00e9'));
  await write(f.root, 'documents/occupied.bin', 'opaque');
  await fs.symlink(path.join(f.root, 'assets'), path.join(f.root, 'documents/linked'));
  for (const sourcePath of ['documents/Cafe\u0301/new.md', 'documents/occupied.bin/new.md', 'documents/linked/new.md']) {
    await assert.rejects(f.execute({ ...f.input, sourcePath }));
  }
  assert.deepEqual(await contents(f), [null, null]);
});

test('custom parser definitions predict the exact created object and configuration edits invalidate preview', async t => {
  const f = await materialize(t), file = path.join(f.root, 'workspace.json');
  const manifest = JSON.parse(await fs.readFile(file));
  manifest.documentTypes[0].parserOptions = { titleField: 'title', allowedFieldKeys: ['title'] };
  manifest.documentTypes[0].fieldGroups = [{ title: 'Identity', fields: ['title'] }];
  await fs.writeFile(file, JSON.stringify(manifest));
  const input = { ...f.input, baseRevision: (await readWorldProjection(f.root)).world.revision, content: '{"title":"Custom","ignored":42}' };
  const preview = await f.execute({ ...input, mode: 'preview' });
  manifest.documentTypes[0].label = 'Changed'; await fs.writeFile(file, JSON.stringify(manifest));
  await assert.rejects(f.execute(input), error => error.errorCode === 'world_revision_conflict');
  manifest.documentTypes[0].label = '角色'; await fs.writeFile(file, JSON.stringify(manifest));
  await f.execute(input);
  assert.deepEqual((await readWorldProjection(f.root)).objects.find(item => item.id === objectId), preview.object);
});

for (const [point, index, committed] of [['intent', '-', false], ['source-ready', 0, false], ['data', 0, false], ['source-ready', 1, false], ['data', 1, false], ['commit', '-', true], ['head', '-', true]]) {
  test(`object.create SIGKILL at ${point}/${index}: recover ${committed ? 'both new files' : 'both absences'}`, async t => {
    const f = await materialize(t), preview = await f.execute({ ...f.input, mode: 'preview' });
    await crash(f, point, index);
    for (const read of [() => readWorldProjection(f.root), () => readRegistry(f.root), () => createExportService(f.root).create({})]) {
      await assert.rejects(read(), error => error.errorCode === 'world_recovery_required');
    }
    const recovered = await recoverWorldTransaction(f.root);
    assert.equal(recovered.status, committed ? 'committed' : 'rolled-back');
    const [source, record] = await contents(f);
    if (committed) { assert.equal(source, f.input.content); assert.deepEqual(JSON.parse(record), preview.changes[0].record); }
    else assert.deepEqual([source, record], [null, null]);
    assert.equal((await readWorldProjection(f.root)).world.revision, committed ? preview.revision : f.input.baseRevision);
    assert.equal((await recoverWorldTransaction(f.root)).status, 'idle');
    assert.equal(Object.keys(await fingerprint(f.root)).some(file => /\/\.viento-[^/]+\.tmp$/.test(file)), false);
  });
}

test('creation recovery can restart after a second SIGKILL during rollback or roll-forward', async t => {
  for (const committed of [false, true]) {
    const f = await materialize(t);
    await crash(f, committed ? 'commit' : 'data', committed ? '-' : 1);
    if (committed) for (const file of f.files) await fs.rm(path.join(f.root, file));
    await crash(f, 'recovery-file', committed ? 0 : 1, true);
    await recoverWorldTransaction(f.root);
    assert.equal((await readTransactionStatus(f.root)).pending, false);
    assert.equal((await contents(f)).every(value => committed ? typeof value === 'string' : value === null), true);
  }
});

for (const kind of ['foreign-source', 'foreign-record', 'truncated-image', 'record-path-escape', 'record-identity', 'symlink-target']) {
  test(`creation recovery preserves all targets and journal on ${kind}`, async t => {
    const f = await materialize(t); await crash(f, 'data', 0);
    const intentFile = path.join(f.root, journal, 'active/intent.json'), intent = JSON.parse(await fs.readFile(intentFile));
    if (kind === 'foreign-source') await write(f.root, f.files[0], 'external replacement');
    if (kind === 'foreign-record') await write(f.root, f.files[1], '{"external":true}');
    if (kind === 'truncated-image') await write(f.root, `${journal}/active/1.after`, '{');
    if (kind === 'record-path-escape') intent.entries[1].sourcePath = 'metadata/elsewhere.json';
    if (kind === 'record-identity') {
      const record = JSON.parse(await fs.readFile(path.join(f.root, journal, 'active/1.after'))); record.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      await write(f.root, `${journal}/active/1.after`, JSON.stringify(record)); intent.entries[1].after = transactionHash(JSON.stringify(record));
    }
    if (kind === 'symlink-target') await fs.symlink(path.join(f.root, f.files[0]), path.join(f.root, f.files[1]));
    await fs.writeFile(intentFile, JSON.stringify(intent));
    const before = await contents(f);
    await assert.rejects(recoverWorldTransaction(f.root), error => ['world_recovery_conflict', 'world_journal_invalid'].includes(error.errorCode));
    assert.deepEqual(await contents(f), before); assert.equal((await readTransactionStatus(f.root)).pending, true);
  });
}

test('exclusive publication never overwrites an external creator; ordinary failures roll back both files', async t => {
  const f = await materialize(t);
  const external = createWorldCommandService(f.root, { checkpoint: async (stage, { index }) => {
    if (stage === 'source-ready' && index === 0) await write(f.root, f.input.sourcePath, 'external creator');
  } });
  await assert.rejects(external(f.input), error => error.errorCode === 'world_recovery_conflict');
  assert.deepEqual(await contents(f), ['external creator', null]);
  assert.equal((await readTransactionStatus(f.root)).pending, true);
  const other = await materialize(t);
  const failing = createWorldCommandService(other.root, { checkpoint: async (stage, { index }) => { if (stage === 'data' && index === 1) throw new Error('disk failure'); } });
  await assert.rejects(failing(other.input)); assert.deepEqual(await contents(other), [null, null]);
  const committed = createWorldCommandService(other.root, { checkpoint: async stage => { if (stage === 'commit') throw new Error('lost acknowledgement'); } });
  assert.equal((await committed(other.input)).status, 'applied');
});

test('HTTP and CLI share creation previews, authentication, cached-index invalidation and startup recovery', async t => {
  const root = await fixture(t), f = await materialize(t, 3, root), copy = await materialize(t);
  const base = await serve(t, root, { DOC_API_TOKEN: 'creation-token', DOC_API_REQUIRE_WRITE_AUTH: '1' });
  assert.equal((await request(base, '/api/capabilities')).data.semanticCommands.includes('object.create'), true);
  await request(base, '/api/index');
  assert.equal((await request(base, '/api/world/commands', f.input)).status, 401);
  const post = async input => {
    const response = await fetch(`${base}/api/world/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer creation-token' }, body: JSON.stringify(input) });
    assert.equal(response.status, 200); return (await response.json()).data;
  };
  const inputFile = path.join(copy.root, '.request.json');
  await fs.writeFile(inputFile, JSON.stringify({ ...f.input, mode: 'preview' }));
  const preview = await post({ ...f.input, mode: 'preview' });
  assert.deepEqual(preview, await runWorldQuery(['--root', copy.root, '--request', inputFile]));
  const applied = await post(f.input);
  assert.equal((await request(base, '/api/world')).data.revision, applied.revision);
  const index = await request(base, '/api/index'); assert.match(JSON.stringify(index.data), new RegExp(objectId));
  await fs.writeFile(inputFile, JSON.stringify(f.input));
  const cli = JSON.parse((await runCommand(process.execPath, [fileURLToPath(new URL('../world.mjs', import.meta.url)), '--root', copy.root, '--request', inputFile])).stdout);
  assert.equal(cli.revision, applied.revision); assert.deepEqual(await contents(copy), await contents(f));
  const other = await fixture(t), pending = await materialize(t, 3, other);
  await crash(pending, 'data', 1); const restarted = await serve(t, other);
  assert.equal((await request(restarted, '/api/world/transaction')).data.pending, false);
  assert.deepEqual(await contents(pending), [null, null]);
});

test('object.create planning runs with browser globals and no host I/O', async () => {
  const result = await runCommand(process.execPath, ['--experimental-vm-modules', fileURLToPath(new URL('world-portable-runtime.mjs', import.meta.url)), '--create']);
  assert.deepEqual(JSON.parse(result.stdout), { value: '9007199254740993', unchanged: true, files: 2 });
});

for (const version of [2, 3]) test(`created v${version} object survives native export → mobile import/export → desktop restore`, {
  skip: !process.env.VIENTO_TEST_ARCHIVE_BINARY || !process.env.VIENTO_MOBILE_STORE_BIN,
}, async t => {
  const f = await materialize(t, version), binary = process.env.VIENTO_TEST_ARCHIVE_BINARY;
  const incoming = path.join(f.root, 'incoming.zip');
  await crash(f, 'data', 0);
  await assert.rejects(runCommand(binary, ['export', f.root, incoming]));
  await assert.rejects(fs.stat(incoming), { code: 'ENOENT' });
  await recoverWorldTransaction(f.root); const saved = await f.execute(f.input);
  await runCommand(binary, ['export', f.root, incoming]);
  const library = await nativeMobileLibrary(process.env.VIENTO_MOBILE_STORE_BIN, path.join(f.root, 'mobile'));
  t.after(() => library.close());
  const work = await library.invoke('mobile_storage', { action: 'importArchive', path: incoming });
  const platform = createMobilePlatform({ invoke: library.invoke, workspaceId: work.id });
  assert.equal((await platform.index()).docs.find(item => item.id === objectId).sourcePath, f.input.sourcePath);
  assert.equal((await library.invoke('mobile_storage', { action: 'read', workspaceId: work.id, path: f.input.sourcePath })).content, f.input.content);
  const outgoing = path.join(f.root, 'outgoing.zip');
  await library.invoke('mobile_storage', { action: 'exportArchive', workspaceId: work.id, path: outgoing });
  const parent = path.join(f.root, 'restored'); await fs.mkdir(parent);
  const restored = JSON.parse((await runCommand(binary, ['import', outgoing, parent])).stdout).root;
  assert.deepEqual(await contents({ ...f, root: restored }), await contents(f));
  assert.equal((await readWorldProjection(restored)).world.revision, saved.revision);
});
