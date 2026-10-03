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
import { readWorldProjection, readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { recoverWorldTransaction } from '../lib/world-transactions.mjs';
import { readTransactionStatus, transactionHash } from '../lib/world-transaction-state.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { createExportService } from '../lib/export-service.mjs';
import { worldMutationDescriptors } from '../../engine/world-command-contract.mjs';
import { createScene2DPlan } from '../../engine/build-plan.mjs';
import { prepareSceneCreate } from '../../engine/world-scene-create.mjs';
import { runWorldQuery } from '../world.mjs';
import { runCommand } from '../lib/process.mjs';
import { fixture, write, serve, request } from './helpers.mjs';

const objectId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherActorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const imageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const recordPath = `metadata/documents/${objectId}.json`;
const journal = '.viento/world-transactions';
const scene = () => ({ format: 'viento-scene2d', schemaVersion: 1, title: '新的场景', viewport: [800, 480], background: '#0d1829',
  actors: [actorId, otherActorId].map((id, index) => ({ objectId: id, position: [200 + 100 * index, 220], size: [80, 80],
    color: '#ffffff', speed: 160, controls: index ? 'none' : 'arrows', imageResourceId: imageId })) });
async function materialize(t, version = 3, root) {
  if (!root) { root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-create-')); t.after(() => fs.rm(root, { recursive: true, force: true })); }
  const frozen = JSON.parse(await fs.readFile(new URL(`fixtures/predecessor/v${version}.json`, import.meta.url)));
  for (const [name, content] of Object.entries(frozen.files)) await write(root, name, content);
  const projection = await readWorldProjection(root);
  const sourcePath = `${version === 3 ? 'documents' : 'design-data'}/scenes/new.json`;
  const input = { command: 'scene.create', mode: 'apply', objectId, documentType: 'character', sourcePath,
    content: `\uFEFF${JSON.stringify(scene(), null, 2).replaceAll('\n', '\r\n')}\r\n`,
    worldId: projection.world.id, baseRevision: projection.world.revision, actorRef: { kind: 'tool', id: 'scene-creation-test' } };
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
      if (name === '.viento/registry.lock') continue; // Recovery may retire the crashed process's lease.
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

for (const version of [2, 3]) test(`scene.create v${version}: preview predicts exact source, deduplicated dependencies and build plan without modifying existing data`, async t => {
  const f = await materialize(t, version), before = await fingerprint(f.root);
  const snapshot = await readWorldSnapshot(f.root), original = JSON.stringify(snapshot);
  const plan = await prepareSceneCreate(snapshot.source, snapshot.projection, { ...f.input, mode: 'preview' },
    { digest: value => transactionHash(value).slice(7) });
  assert.equal(JSON.stringify(snapshot), original);
  const preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.deepEqual(preview, plan.result); assert.deepEqual(await fingerprint(f.root), before);
  assert.deepEqual(await contents(f), [null, null]); assert.equal(plan.plans.length, 2);
  const record = preview.changes[0].record;
  assert.equal(preview.changes[0].kind, 'scene.create');
  assert.deepEqual(record.relations, [actorId, otherActorId].map(targetId => ({ kind: 'references', targetId, slot: '' })));
  assert.deepEqual(record.assetBindings, [{ assetId: imageId, role: 'image' }]);
  assert.deepEqual(preview.proposal.preconditions.map(item => item.objectId), [actorId, otherActorId]);
  const descriptor = worldMutationDescriptors().find(item => item.id === 'scene.create'), ajv = new Ajv();
  for (const [file, value] of [['command-descriptor', descriptor], ['changeset', preview.proposal]]) {
    const validate = ajv.compile(JSON.parse(await fs.readFile(new URL(`../../schemas/${file}-v1.schema.json`, import.meta.url))));
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
  }
  const { command, ...args } = f.input;
  assert.equal(ajv.compile(descriptor.inputSchema)(args), true); assert.equal(ajv.compile(descriptor.outputSchema)(preview), true);
  const applied = await f.execute(f.input), latest = await readWorldSnapshot(f.root);
  assert.deepEqual({ ...applied, receipt: undefined }, { ...preview, status: 'applied', receipt: undefined });
  assert.equal(latest.projection.world.revision, preview.revision);
  assert.deepEqual(latest.projection.objects.find(item => item.id === objectId), preview.object);
  assert.equal((await contents(f))[0], f.input.content);
  assert.deepEqual(JSON.parse((await contents(f))[1]), record);
  const build = createScene2DPlan(latest, objectId);
  assert.equal(build.ok, true, JSON.stringify(build.diagnostics)); assert.equal(build.plan.actors.length, 2); assert.equal(build.plan.resources.length, 1);
  const after = await fingerprint(f.root);
  for (const [file, hash] of Object.entries(before)) assert.equal(after[file], hash, file);
  assert.deepEqual(Object.keys(after).filter(file => !Object.hasOwn(before, file)).sort(), [...f.files, `${journal}/head.json`].sort());
  await assert.rejects(f.execute(f.input), error => error.errorCode === 'world_revision_conflict');
  await assert.rejects(f.execute({ ...f.input, baseRevision: latest.projection.world.revision }), error => error.errorCode === 'world_identity_conflict');
});

test('scene.create rejects malformed, unsupported and unregistered declarations with build diagnostics and no writes', async t => {
  const f = await materialize(t), before = await fingerprint(f.root);
  const declarations = [
    ['{', 'build_scene_json'], ['{}', 'build_scene_format'],
    [{ ...scene(), arbitraryScript: 'run()' }, 'build_feature_unsupported'],
    [{ ...scene(), actors: [] }, 'build_scene_value'],
    [{ ...scene(), viewport: [0, 480] }, 'build_scene_value'],
    [{ ...scene(), actors: [scene().actors[0], scene().actors[0]] }, 'build_actor_duplicate'],
    [{ ...scene(), actors: [{ ...scene().actors[0], objectId }] }, 'build_actor_missing'],
    [{ ...scene(), actors: [{ ...scene().actors[0], objectId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }] }, 'build_actor_missing'],
    [{ ...scene(), actors: [{ ...scene().actors[0], imageResourceId: actorId }] }, 'build_image_unsupported'],
    [{ ...scene(), actors: [{ ...scene().actors[0], controls: 'custom' }] }, 'build_feature_unsupported'],
  ];
  for (const [declaration, expected] of declarations) {
    const content = typeof declaration === 'string' ? declaration : JSON.stringify(declaration);
    await assert.rejects(f.execute({ ...f.input, content }), error => error.errorCode === 'world_scene_invalid'
      && error.payload.diagnostics.some(item => item.code === expected && item.objectId === objectId && item.sourcePath === f.input.sourcePath), expected);
  }
  await assert.rejects(f.execute({ ...f.input, sourcePath: 'documents/scenes/new.md' }), error => error.errorCode === 'world_scene_invalid'
    && error.payload.diagnostics.some(item => item.code === 'build_scene_format'));
  for (const [patch, code] of [[{ force: true }, 'world_command_invalid'], [{ documentType: 'scene' }, 'world_type_unknown'],
    [{ objectId: actorId }, 'world_identity_conflict'], [{ sourcePath: '../new.json' }, 'world_create_path_invalid'],
    [{ content: '\uD800' }, 'world_command_invalid']]) await assert.rejects(f.execute({ ...f.input, ...patch }), error => error.errorCode === code);
  assert.deepEqual(await fingerprint(f.root), before);
  await fs.rm(path.join(f.root, 'documents/characters/traveler.md'));
  await assert.rejects(f.execute({ ...f.input, baseRevision: (await readWorldProjection(f.root)).world.revision }), error => error.errorCode === 'world_scene_invalid'
    && error.payload.diagnostics.some(item => item.code === 'build_actor_missing'));
});

test('an empty generic project creates an actor then a scene using only its existing document type', async t => {
  const f = await materialize(t), manifestFile = path.join(f.root, 'workspace.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile));
  manifest.documentTypes = [{ id: 'document', label: 'Document', directory: '', parserProfile: 'structured', template: 'document.md' }];
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  for (const directory of ['documents', 'metadata/documents']) {
    await fs.rm(path.join(f.root, directory), { recursive: true }); await fs.mkdir(path.join(f.root, directory));
  }
  const empty = await readWorldProjection(f.root);
  await assert.rejects(f.execute({ ...f.input, documentType: 'document', baseRevision: empty.world.revision }), error => error.errorCode === 'world_scene_invalid');
  const actor = await f.execute({ ...f.input, command: 'object.create', documentType: 'document', objectId: actorId,
    sourcePath: 'documents/actor.md', content: '# Actor\n', baseRevision: empty.world.revision });
  const declaration = scene(); declaration.actors = [declaration.actors[0]]; delete declaration.actors[0].imageResourceId;
  const result = await f.execute({ ...f.input, documentType: 'document', content: JSON.stringify(declaration), baseRevision: actor.revision });
  const build = createScene2DPlan(await readWorldSnapshot(f.root), objectId);
  assert.equal(result.object.typeRef, 'io.viento.document/document'); assert.equal(build.ok, true);
  assert.deepEqual(build.plan.resources, []); assert.deepEqual(result.changes[0].record.assetBindings, []);
  assert.equal(await fs.readFile(manifestFile, 'utf8'), JSON.stringify(manifest));
});

for (const [point, index, committed] of [['intent', '-', false], ['source-ready', 0, false], ['data', 0, false], ['source-ready', 1, false], ['data', 1, false], ['commit', '-', true], ['head', '-', true]]) {
  test(`scene.create v5 SIGKILL at ${point}/${index}: recovery ${committed ? 'commits' : 'rolls back'} both files`, async t => {
    const f = await materialize(t), preview = await f.execute({ ...f.input, mode: 'preview' });
    await crash(f, point, index);
    const intent = JSON.parse(await fs.readFile(path.join(f.root, journal, 'active/intent.json')));
    assert.equal(intent.version, 5); assert.match(intent.registryHash, /^sha256:/); assert.equal(intent.entries.length, 2);
    for (const read of [() => readWorldProjection(f.root), () => readRegistry(f.root), () => createExportService(f.root).create({})]) {
      await assert.rejects(read(), error => error.errorCode === 'world_recovery_required');
    }
    assert.equal((await recoverWorldTransaction(f.root)).status, committed ? 'committed' : 'rolled-back');
    const [source, record] = await contents(f);
    if (committed) { assert.equal(source, f.input.content); assert.deepEqual(JSON.parse(record), preview.changes[0].record); }
    else assert.deepEqual([source, record], [null, null]);
    assert.equal((await readWorldProjection(f.root)).world.revision, committed ? preview.revision : f.input.baseRevision);
    assert.equal((await recoverWorldTransaction(f.root)).status, 'idle');
    assert.equal(Object.keys(await fingerprint(f.root)).some(file => /\/\.viento-[^/]+\.tmp$/.test(file)), false);
  });
}

test('scene.create recovery is restartable and ordinary failures roll back without changing actor records', async t => {
  for (const committed of [false, true]) {
    const f = await materialize(t); await crash(f, committed ? 'commit' : 'data', committed ? '-' : 1);
    if (committed) for (const file of f.files) await fs.rm(path.join(f.root, file));
    await crash(f, 'recovery-file', committed ? 0 : 1, true);
    await recoverWorldTransaction(f.root);
    assert.equal((await contents(f)).every(value => committed ? typeof value === 'string' : value === null), true);
    assert.equal((await readTransactionStatus(f.root)).pending, false);
  }
  const f = await materialize(t), original = await fs.readFile(path.join(f.root, `metadata/documents/${actorId}.json`), 'utf8');
  const failing = createWorldCommandService(f.root, { checkpoint: async (stage, { index }) => {
    if (stage === 'data' && index === 1) throw new Error('publication interrupted');
  } });
  await assert.rejects(failing(f.input)); assert.deepEqual(await contents(f), [null, null]);
  assert.equal(await fs.readFile(path.join(f.root, `metadata/documents/${actorId}.json`), 'utf8'), original);
});

for (const kind of ['actor-registration', 'asset-registration', 'extra-relation', 'extra-binding', 'unsupported-scene', 'foreign-source', 'downgrade-v2', 'record-path-escape']) {
  test(`scene recovery preserves journal and targets on ${kind}`, async t => {
    const f = await materialize(t); await crash(f, 'data', 0);
    const intentFile = path.join(f.root, journal, 'active/intent.json'), intent = JSON.parse(await fs.readFile(intentFile));
    if (kind === 'actor-registration' || kind === 'asset-registration') {
      const file = `metadata/${kind === 'actor-registration' ? 'documents/' + actorId : 'assets/' + imageId}.json`;
      const record = JSON.parse(await fs.readFile(path.join(f.root, file))); record.extension = 'external';
      await write(f.root, file, JSON.stringify(record));
    }
    if (kind === 'extra-relation' || kind === 'extra-binding') {
      const record = JSON.parse(await fs.readFile(path.join(f.root, journal, 'active/1.after')));
      if (kind === 'extra-relation') record.relations[0].kind = 'part-of';
      else record.assetBindings.push({ assetId: imageId, role: 'extra' });
      await write(f.root, `${journal}/active/1.after`, JSON.stringify(record)); intent.entries[1].after = transactionHash(JSON.stringify(record));
    }
    if (kind === 'unsupported-scene') {
      const content = JSON.stringify({ ...scene(), execute: 'arbitrary' });
      await write(f.root, `${journal}/active/0.after`, content); intent.entries[0].after = transactionHash(content);
      await write(f.root, f.input.sourcePath, content);
    }
    if (kind === 'foreign-source') await write(f.root, f.files[0], 'external replacement');
    if (kind === 'downgrade-v2') intent.version = 2;
    if (kind === 'record-path-escape') intent.entries[1].sourcePath = 'metadata/elsewhere.json';
    await fs.writeFile(intentFile, JSON.stringify(intent));
    const before = await fingerprint(f.root);
    await assert.rejects(recoverWorldTransaction(f.root), error => ['world_recovery_conflict', 'world_journal_invalid'].includes(error.errorCode));
    assert.deepEqual(await fingerprint(f.root), before); assert.equal((await readTransactionStatus(f.root)).pending, true);
  });
}

test('scene creation is exposed through authenticated HTTP and CLI with identical preview and saved buildability', async t => {
  const root = await fixture(t), f = await materialize(t, 3, root);
  const base = await serve(t, root, { DOC_API_TOKEN: 'scene-token', DOC_API_REQUIRE_WRITE_AUTH: '1' });
  assert.equal((await request(base, '/api/capabilities')).data.semanticCommands.includes('scene.create'), true);
  assert.equal((await request(base, '/api/world/commands', f.input)).status, 401);
  const post = async input => {
    const response = await fetch(`${base}/api/world/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer scene-token' }, body: JSON.stringify(input) });
    return { status: response.status, json: await response.json() };
  };
  const inputFile = path.join(root, '.request.json'); await fs.writeFile(inputFile, JSON.stringify({ ...f.input, mode: 'preview' }));
  const preview = await post({ ...f.input, mode: 'preview' }); assert.equal(preview.status, 200);
  assert.deepEqual(preview.json.data, await runWorldQuery(['--root', root, '--request', inputFile]));
  const invalid = await post({ ...f.input, content: '{}' }); assert.equal(invalid.status, 422);
  assert.equal(invalid.json.errorCode, 'world_scene_invalid'); assert.equal(invalid.json.diagnostics[0].code, 'build_scene_format');
  const applied = await post(f.input); assert.equal(applied.status, 200);
  assert.equal((await request(base, '/api/world')).data.revision, applied.json.data.revision);
  assert.equal(createScene2DPlan(await readWorldSnapshot(root), objectId).ok, true);
});

test('scene.create planning runs with browser globals and no host I/O', async () => {
  const result = await runCommand(process.execPath, ['--experimental-vm-modules', fileURLToPath(new URL('world-portable-runtime.mjs', import.meta.url)), '--scene']);
  assert.deepEqual(JSON.parse(result.stdout), { kind: 'scene.create', unchanged: true, files: 2, actors: 1 });
});
