import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import Ajv from 'ajv/dist/2020.js';
import { readWorldProjection, createWorldQueryService } from '../adapters/node-world-projection.mjs';
import { queryWorldProjection, worldCommandDescriptors } from '../../engine/world-query.mjs';
import { runWorldQuery } from '../world.mjs';
import { fixture, serve, request, write } from './helpers.mjs';
import { runCommand } from '../lib/process.mjs';
import { fileURLToPath } from 'node:url';

const digest = value => createHash('sha256').update(value).digest('hex');
const ajv = new Ajv({ allErrors: true });
for (const name of ['world', 'object', 'command-descriptor', 'changeset', 'world-projection']) {
  ajv.addSchema(JSON.parse(await fs.readFile(new URL(`../../schemas/${name}-v1.schema.json`, import.meta.url))));
}
const schema = name => ajv.getSchema(`https://viento.studio/schemas/${name}-v1.schema.json`);

async function legacy(t, version = 3, root) {
  if (!root) {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-world-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
  }
  const value = JSON.parse(await fs.readFile(new URL(`fixtures/predecessor/v${version}.json`, import.meta.url)));
  for (const [name, content] of Object.entries(value.files)) await write(root, name, content);
  return { root, fixture: value };
}

async function fingerprintTree(root) {
  const result = {};
  async function walk(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name, target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target, relative + '/');
      else result[relative] = digest(await fs.readFile(target));
    }
  }
  await walk(root); return result;
}

for (const version of [1, 2, 3]) test(`World v${version}: source authority, schema, deterministic identity and zero writes`, async t => {
  const { root, fixture } = await legacy(t, version);
  const before = await fingerprintTree(root);
  const projection = await readWorldProjection(root);
  assert.equal(schema('world-projection')(projection), true, JSON.stringify(schema('world-projection').errors));
  assert.equal(projection.objects.length, 2);
  assert.notEqual(projection.world.id, projection.world.projectId);
  assert.deepEqual(await readWorldProjection(root), projection);
  for (const object of projection.objects) {
    assert.equal(object.readOnly, true);
    const source = fixture.files[object.documentRefs[0].sourcePath];
    assert.equal(object.documentRefs[0].sourceRevision, `sha256:${digest(source)}`);
    assert.equal(object.provenance.identity, version === 1 ? 'path-derived' : 'registered');
    for (const binding of object.propertyBindings) {
      assert.equal(binding.sourceRevision, object.documentRefs[0].sourceRevision);
      assert.equal(binding.authorityKind, 'document');
      const { start, end } = binding.authorityRef.range;
      assert.ok(start >= 0 && end > start && end <= source.length);
      assert.equal(source.slice(start, end), object.properties[binding.propertyPath.split('/').at(-1)].value);
    }
  }
  if (version >= 2) {
    assert.deepEqual(new Set(projection.objects.map(object => object.id)), new Set(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']));
    assert.equal(projection.resources[0].id, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    assert.equal(projection.resources[0].contentVerified, false);
    assert.equal(projection.relations[0].properties.slot, '背景');
    assert.equal(projection.resourceBindings[0].resourceId, projection.resources[0].id);
  }
  const copyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-world-copy-'));
  t.after(() => fs.rm(copyRoot, { recursive: true, force: true }));
  await fs.cp(root, copyRoot, { recursive: true });
  assert.deepEqual(await readWorldProjection(copyRoot), projection, 'moving the project must not change identity or revision');
  assert.deepEqual(await fingerprintTree(root), before, 'queries must not create caches, registrations or semantic records');
});

test('queries and CLI preserve exact numeric text and reject a stale source revision', async t => {
  const { root } = await legacy(t);
  await write(root, 'documents/characters/number.json', '\uFEFF{"count":9007199254740993,"flag":true,"label":"<script>alert(1)</script>"}\r\n');
  const query = createWorldQueryService(root);
  const view = await query({ command: 'world.inspect' });
  const object = view.objects.find(object => object.documentRefs[0].sourcePath.endsWith('number.json'));
  assert.equal(Object.values(object.properties).find(field => field.label === 'count').value, '9007199254740993');
  const listed = await runWorldQuery(['--root', root, '--command', 'object.list', '--search', 'number.json']);
  assert.equal(listed.revision, view.revision);
  assert.equal(listed.objects[0].id, object.id);
  const before = await fs.stat(path.join(root, 'documents/characters/number.json'));
  await write(root, 'documents/characters/number.json', '\uFEFF{"count":9007199254740994,"flag":true,"label":"<script>alert(1)</script>"}\r\n');
  await fs.utimes(path.join(root, 'documents/characters/number.json'), before.atime, before.mtime);
  await assert.rejects(query({ command: 'object.inspect', objectId: object.id, expectedRevision: view.revision }), error => error.statusCode === 409 && error.errorCode === 'world_revision_conflict');
  const latest = await query({ command: 'object.inspect', objectId: object.id });
  assert.equal(latest.object.id, object.id);
  assert.notEqual(latest.revision, view.revision);
  await assert.rejects(query({ command: 'property.set' }), error => error.statusCode === 400);
  await assert.rejects(query({ command: 'object.list', search: 'x'.repeat(201) }), error => error.statusCode === 400);
  for (const key of ['constructor', '__proto__', 'toString']) await assert.rejects(query(JSON.parse(`{"${key}":"ignored"}`)), error => error.statusCode === 400);
});

test('missing, unknown and unparsed sources remain visible, with no guessed writable fields', async t => {
  const { root } = await legacy(t);
  const recordPath = 'metadata/documents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json';
  const record = JSON.parse(await fs.readFile(path.join(root, recordPath)));
  record.documentType = 'unknown_plugin'; record.extension = { preserved: ['future', 1] };
  await write(root, recordPath, JSON.stringify(record));
  await fs.rm(path.join(root, record.sourcePath));
  await write(root, 'documents/broken.yaml', 'value: [\n');
  const projection = await readWorldProjection(root);
  const object = projection.objects.find(object => object.id === record.id);
  assert.equal(object.typeRef, 'io.viento.document/document');
  assert.deepEqual(object.provenance.descriptor.extension, record.extension);
  assert.deepEqual(object.properties, {});
  for (const code of ['unknown-document-type', 'source-unavailable', 'unparsed-document']) assert.ok(projection.diagnostics.some(item => item.code === code), code);
  assert.equal(queryWorldProjection(projection, { command: 'world.validate' }).valid, false);
  assert.equal(schema('world-projection')(projection), true, JSON.stringify(schema('world-projection').errors));
});

test('resource availability is an observation, never a verified content digest or design revision', async t => {
  const { root } = await legacy(t);
  const before = await readWorldProjection(root);
  await fs.rm(path.join(root, 'assets/reference.svg'));
  const after = await readWorldProjection(root);
  assert.equal(before.resources[0].availability, 'present-unverified');
  assert.equal(after.resources[0].availability, 'missing');
  assert.equal(after.world.revision, before.world.revision);
  assert.equal(after.resources[0].contentVerified, false);
  assert.ok(after.diagnostics.some(item => item.code === 'resource-unavailable'));
});

test('queries reject linked metadata, oversized sources and unknown formats without exposing host paths', async t => {
  const { root } = await legacy(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-world-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.rename(path.join(root, 'metadata'), path.join(outside, 'metadata'));
  await fs.symlink(path.join(outside, 'metadata'), path.join(root, 'metadata'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readWorldProjection(root), error => error.errorCode === 'world_unavailable' && !error.message.includes(outside));
  await fs.unlink(path.join(root, 'metadata'));
  await fs.rename(path.join(outside, 'metadata'), path.join(root, 'metadata'));
  const large = path.join(root, 'documents/large.txt');
  await fs.writeFile(large, ''); await fs.truncate(large, 8 * 1024 * 1024 + 1);
  await assert.rejects(readWorldProjection(root), error => error.errorCode === 'world_source_limit');
  await fs.rm(large);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'workspace.json'))); manifest.version = 4;
  await write(root, 'workspace.json', JSON.stringify(manifest));
  await assert.rejects(readWorldProjection(root), error => error.errorCode === 'world_unavailable');
});

test('schemas describe actual read commands and only proposed ChangeSets', () => {
  const mutated = worldCommandDescriptors();
  mutated[0].inputSchema.properties.expectedRevision.pattern = '.*';
  assert.equal(worldCommandDescriptors()[0].inputSchema.properties.expectedRevision.pattern, '^sha256:[a-f0-9]{64}$');
  for (const descriptor of worldCommandDescriptors()) {
    assert.equal(schema('command-descriptor')(descriptor), true);
    assert.equal(descriptor.effects.length, 0);
    assert.doesNotThrow(() => ajv.compile(descriptor.inputSchema));
    assert.doesNotThrow(() => ajv.compile(descriptor.outputSchema));
  }
  const proposal = { format: 'viento-changeset', schemaVersion: 1, id: 'proposal-1', worldId: 'world-1', actorRef: { kind: 'user', id: 'local' },
    baseRevision: `sha256:${'a'.repeat(64)}`, commands: [{ id: 'property.set', input: {} }], preconditions: [], affectedObjects: [], state: 'proposed' };
  assert.equal(schema('changeset')(proposal), true);
  assert.equal(schema('changeset')({ ...proposal, state: 'committed' }), false);
});

test('the same portable projection executes with browser globals and preserves input records', async t => {
  // Run the loader in a VM-enabled child, without adding Node globals to the kernel.
  const result = await runCommand(process.execPath, ['--experimental-vm-modules', fileURLToPath(new URL('world-portable-runtime.mjs', import.meta.url))]);
  assert.deepEqual(JSON.parse(result.stdout), { objects: 1, value: '9007199254740993', unchanged: true });
});

test('HTTP and CLI share queries and revision conflicts; HTTP mutations are rejected', async t => {
  const root = await fixture(t);
  await legacy(t, 2, root);
  const base = await serve(t, root);
  assert.equal((await request(base, '/api/capabilities')).data.semanticProjection, true);
  const response = await request(base, '/api/world');
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, await runWorldQuery(['--root', root]));
  assert.equal((await request(base, '/api/world', { command: 'property.set' })).status, 405);
  assert.equal((await request(base, '/api/world?command=world.inspect&command=world.validate')).status, 400);
  assert.equal((await request(base, '/api/world?command=object.inspect&objectId=missing')).status, 404);
  await write(root, 'design-data/characters/traveler.md', '姓名：修改\n');
  const conflict = await request(base, `/api/world?expectedRevision=${encodeURIComponent(response.data.revision)}`);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.errorCode, 'world_revision_conflict');
});
