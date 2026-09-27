import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { worldMutationDescriptors, validateWorldCommand } from '../../engine/world-commands.mjs';
import { withRegistryLock } from '../lib/workspace.mjs';
import { writeDocumentAtomically } from '../lib/doc-file-store.mjs';
import { runWorldQuery } from '../world.mjs';
import { fixture, serve, request, write } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';

const objectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const cli = fileURLToPath(new URL('../world.mjs', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
async function materialize(t, version = 3, root) {
  if (!root) { root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-command-')); t.after(() => fs.rm(root, { recursive: true, force: true })); }
  const fixture = JSON.parse(await fs.readFile(new URL(`fixtures/predecessor/v${version}.json`, import.meta.url)));
  for (const [name, content] of Object.entries(fixture.files)) await write(root, name, content);
  return { root, sourcePath: fixture.sourcePath };
}
async function fingerprints(root) {
  const result = {};
  async function walk(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), name + '/');
      else result[name] = digest(await fs.readFile(path.join(directory, entry.name)));
    }
  }
  await walk(root); return result;
}
async function command(root, label = '生命', value = '125', id = objectId) {
  const view = await readWorldProjection(root), object = view.objects.find(item => item.id === id) || view.objects[0];
  const [key] = Object.entries(object.properties).find(([, field]) => field.label === label);
  return { command: 'property.set', mode: 'preview', worldId: view.world.id, baseRevision: view.world.revision,
    objectId: object.id, objectRevision: object.revision, sourceRevision: object.documentRefs[0].sourceRevision,
    propertyPath: `/properties/${key}`, value, actorRef: { kind: 'tool', id: 'test' } };
}

for (const version of [2, 3]) test(`property.set v${version}: zero-write preview, exact publication, no-op and guarded inverse`, async t => {
  const { root, sourcePath } = await materialize(t, version), execute = createWorldCommandService(root);
  const input = await command(root), before = await fingerprints(root);
  const content = await fs.readFile(path.join(root, sourcePath), 'utf8');
  const stat = await fs.stat(path.join(root, sourcePath));
  const preview = await execute(input);
  assert.equal(preview.status, 'preview'); assert.equal(preview.change.beforeValue, '100'); assert.equal(preview.change.afterValue, '125');
  assert.deepEqual(await fingerprints(root), before);
  const applied = await execute({ ...input, mode: 'apply' });
  assert.deepEqual(applied, { ...preview, status: 'applied' });
  assert.equal(await fs.readFile(path.join(root, sourcePath), 'utf8'), content.replace('生命：100', '生命：125'));
  assert.equal((await fs.stat(path.join(root, sourcePath))).mode, stat.mode);
  const after = await fingerprints(root); assert.notEqual(after[sourcePath], before[sourcePath]);
  delete after[sourcePath]; delete before[sourcePath]; assert.deepEqual(after, before, 'only one source file changes');
  assert.equal((await readWorldProjection(root)).world.revision, applied.revision);
  await assert.rejects(execute({ ...input, mode: 'apply' }), error => error.errorCode === 'world_revision_conflict');
  const same = await command(root, '生命', '125');
  const unchangedStat = await fs.stat(path.join(root, sourcePath));
  assert.equal((await execute({ ...same, mode: 'apply' })).status, 'unchanged');
  assert.equal((await fs.stat(path.join(root, sourcePath))).mtimeMs, unchangedStat.mtimeMs);
  const undone = await execute({ ...applied.inverseCommand, mode: 'apply' });
  assert.equal(undone.revision, input.baseRevision);
  assert.equal(await fs.readFile(path.join(root, sourcePath), 'utf8'), content);
});

for (const [extension, content, label, value, replacement] of [
  ['json', '\uFEFF{ "count":9007199254740993, "label":"old", "count":2 }\r\n', 'count', '9007199254740995', ['9007199254740993', '9007199254740995']],
  ['yaml', '\uFEFFcount: 9007199254740993 # retain comment\r\nlabel: old\r\nother: &saved keep\r\nref: *saved\r\n', 'count', '9007199254740995', ['9007199254740993', '9007199254740995']],
  ['json', '{"label":"old","flag":false}\n', 'label', '<script>\n"new"</script>', ['"old"', '"<script>\\n\\"new\\"</script>"']],
  ['yaml', 'label: |\r\n  old\r\nflag: true # retained\r\n', 'label', 'new\nlines\n', ['|\r\n  old\r\n', '"new\\nlines\\n"\r\n']],
]) test(`property.set preserves ${extension} syntax around ${label}: ${content.slice(0, 28)}`, async t => {
  const { root } = await materialize(t), recordPath = `metadata/documents/${objectId}.json`;
  const record = JSON.parse(await fs.readFile(path.join(root, recordPath)));
  await fs.rm(path.join(root, record.sourcePath)); record.sourcePath = `documents/characters/values.${extension}`;
  await write(root, recordPath, JSON.stringify(record)); await write(root, record.sourcePath, content);
  const input = await command(root, label, value);
  const result = await createWorldCommandService(root)({ ...input, mode: 'apply' });
  assert.equal(await fs.readFile(path.join(root, record.sourcePath), 'utf8'), content.replace(...replacement));
  assert.equal((await readWorldProjection(root)).world.revision, result.revision);
});

test('commands reject missing revisions, extra keys, invalid types and structure-changing text without writes', async t => {
  const { root } = await materialize(t), execute = createWorldCommandService(root), input = await command(root);
  const before = await fingerprints(root);
  for (const key of ['mode', 'worldId', 'baseRevision', 'objectRevision', 'sourceRevision', 'actorRef']) {
    const missing = { ...input }; delete missing[key];
    await assert.rejects(execute(missing), error => error.errorCode === 'world_command_invalid');
  }
  for (const bad of [null, [], { ...input, force: true }, { ...input, value: 123 }, { ...input, mode: 'commit' },
    { ...input, value: '\uD800' }, { ...input, command: 'object.create' },
    { ...input, actorRef: { kind: 'tool', id: 'test', admin: true } },
    { ...input, propertyPath: '/properties/__proto__' }]) await assert.rejects(execute(bad), error => error.statusCode === 400);
  await assert.rejects(execute({ ...input, value: 'not a number' }), error => error.errorCode === 'world_property_value_invalid');
  await assert.rejects(execute({ ...input, propertyPath: '/properties/field-1999' }), error => error.errorCode === 'world_property_not_found');
  await assert.rejects(execute(await command(root, '姓名', '改名\n注入：字段')), error => error.errorCode === 'world_property_roundtrip');
  assert.deepEqual(await fingerprints(root), before);
});

test('unknown and unregistered objects remain read-only; changed parser metadata invalidates a preview', async t => {
  const { root } = await materialize(t), execute = createWorldCommandService(root), input = await command(root);
  const file = `metadata/documents/${objectId}.json`, record = JSON.parse(await fs.readFile(path.join(root, file)));
  await write(root, file, JSON.stringify({ ...record, documentType: 'unknown-plugin' }));
  await assert.rejects(execute({ ...input, mode: 'apply' }), error => error.errorCode === 'world_revision_conflict');
  await assert.rejects(execute(await command(root)), error => error.errorCode === 'world_property_read_only');
  await write(root, file, JSON.stringify(record));
  await write(root, 'documents/characters/unregistered.md', '姓名：未登记\n生命：100\n');
  const projection = await readWorldProjection(root), unregistered = projection.objects.find(item => item.provenance.identity === 'path-derived');
  await assert.rejects(execute(await command(root, '生命', '125', unregistered.id)), error => error.errorCode === 'world_property_read_only');
});

test('same-size external edits and two in-process writers cannot silently replace a stale revision', async t => {
  const { root, sourcePath } = await materialize(t), execute = createWorldCommandService(root), input = await command(root);
  const file = path.join(root, sourcePath), original = await fs.readFile(file, 'utf8'), stat = await fs.stat(file);
  await fs.writeFile(file, original.replace('100', '101')); await fs.utimes(file, stat.atime, stat.mtime);
  await assert.rejects(execute({ ...input, mode: 'apply' }), error => error.errorCode === 'world_revision_conflict');
  assert.match(await fs.readFile(file, 'utf8'), /101/);
  const current = await command(root);
  const results = await Promise.allSettled([execute({ ...current, mode: 'apply' }), execute({ ...current, mode: 'apply', value: '150' })]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.errorCode, 'world_revision_conflict');
});

test('HTTP, CLI and the legacy editor share writes, revisions and the cross-process registry lock', async t => {
  const root = await fixture(t); const { sourcePath } = await materialize(t, 3, root);
  const { root: copy } = await materialize(t), base = await serve(t, root), input = await command(root);
  const cliFile = path.join(os.tmpdir(), `viento-request-${process.pid}-${Date.now()}.json`);
  t.after(() => fs.rm(cliFile, { force: true }));
  await fs.writeFile(cliFile, JSON.stringify(input));
  const preview = await request(base, '/api/world/commands', input);
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.data, await runWorldQuery(['--root', copy, '--request', cliFile]));
  await fs.writeFile(cliFile, JSON.stringify({ ...input, mode: 'apply' }));
  const applied = await request(base, '/api/world/commands', { ...input, mode: 'apply' });
  assert.equal(applied.status, 200);
  const fromCli = JSON.parse((await runCommand(process.execPath, [cli, '--root', copy, '--request', cliFile])).stdout);
  assert.deepEqual(applied.data, fromCli);
  assert.deepEqual(await fs.readFile(path.join(root, sourcePath)), await fs.readFile(path.join(copy, sourcePath)));
  assert.equal((await request(base, '/api/world')).data.revision, applied.data.revision);
  const current = await command(root, '生命', '175');
  await fs.writeFile(cliFile, JSON.stringify({ ...current, mode: 'apply' }));
  await withRegistryLock(root, async () => {
    await assert.rejects(runCommand(process.execPath, [cli, '--root', root, '--request', cliFile]), /world_write_busy/);
    const locked = await request(base, '/api/doc', { path: sourcePath, content: 'blocked', expectedVersion: current.sourceRevision });
    assert.equal(locked.status, 409);
  });
  const legacy = await request(base, '/api/doc', { path: sourcePath, content: '# 原文编辑\n姓名：最新\n生命：177\n', expectedVersion: current.sourceRevision });
  assert.equal(legacy.status, 200);
  assert.equal((await request(base, '/api/world/commands', { ...current, mode: 'apply' })).status, 409);
  const latest = await command(root, '生命', '178');
  assert.equal((await request(base, '/api/world/commands', { ...latest, mode: 'apply' })).status, 200);
  assert.equal((await request(base, '/api/doc', { path: sourcePath, content: 'stale legacy draft', expectedVersion: latest.sourceRevision })).status, 409);
});

test('HTTP command preview and apply use existing auth, JSON limits, and method restrictions', async t => {
  const root = await fixture(t); await materialize(t, 3, root);
  const base = await serve(t, root, { DOC_API_TOKEN: 'fixture-token', DOC_API_REQUIRE_WRITE_AUTH: '1' }), input = await command(root);
  const before = await fs.readFile(path.join(root, 'documents/characters/traveler.md'));
  assert.equal((await request(base, '/api/capabilities')).data.semanticCommands[0], 'property.set');
  assert.equal((await request(base, '/api/world/commands')).status, 405);
  for (const mode of ['preview', 'apply']) assert.equal((await request(base, '/api/world/commands', { ...input, mode })).status, 401);
  const post = (headers, body) => fetch(`${base}/api/world/commands`, { method: 'POST', headers, body });
  const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-token' };
  assert.equal((await post({}, JSON.stringify(input))).status, 415);
  assert.equal((await post({ ...auth, Authorization: 'Bearer wrong' }, JSON.stringify(input))).status, 403);
  assert.equal((await post(auth, '{invalid')).status, 400);
  assert.equal((await post(auth, JSON.stringify({ ...input, value: 'x'.repeat(1024 * 1024) }))).status, 413);
  assert.equal((await post(auth, JSON.stringify(input))).status, 200);
  assert.deepEqual(await fs.readFile(path.join(root, 'documents/characters/traveler.md')), before);
});

test('command schemas match the runtime contract and proposals remain separate from save receipts', async t => {
  const { root } = await materialize(t), input = await command(root), descriptor = worldMutationDescriptors()[0];
  const ajv = new Ajv({ allErrors: true });
  const validateDescriptor = ajv.compile(JSON.parse(await fs.readFile(new URL('../../schemas/command-descriptor-v1.schema.json', import.meta.url))));
  const validateProposal = ajv.compile(JSON.parse(await fs.readFile(new URL('../../schemas/changeset-v1.schema.json', import.meta.url))));
  assert.equal(validateDescriptor(descriptor), true);
  const { command: id, ...args } = input;
  assert.equal(ajv.compile(descriptor.inputSchema)(args), true);
  assert.doesNotThrow(() => validateWorldCommand({ command: id, ...args }));
  const result = await createWorldCommandService(root)({ ...input, mode: 'apply' });
  assert.equal(ajv.compile(descriptor.outputSchema)(result), true);
  assert.equal(validateProposal(result.proposal), true); assert.equal(result.proposal.state, 'proposed');
  descriptor.inputSchema.properties.mode.enum.push('force');
  assert.equal(worldMutationDescriptors()[0].inputSchema.properties.mode.enum.includes('force'), false);
});

test('publication preconditions can reject an edit without replacing its source or leaking temporary files', async t => {
  const { root, sourcePath } = await materialize(t), file = path.join(root, sourcePath), before = await fingerprints(root);
  await assert.rejects(writeDocumentAtomically(file, 'not published', { beforePublish: () => { throw new Error('conflict'); } }), /conflict/);
  assert.deepEqual(await fingerprints(root), before);
});

test('property planning runs in browser globals without host APIs', async () => {
  const result = await runCommand(process.execPath, ['--experimental-vm-modules', fileURLToPath(new URL('world-portable-runtime.mjs', import.meta.url)), '--commands']);
  assert.deepEqual(JSON.parse(result.stdout), { after: '{"count":9007199254740995}', proposal: 'proposed', unchanged: true });
});
