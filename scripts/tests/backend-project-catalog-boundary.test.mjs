import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { backendProjectFixture } from './helpers/backend-project-fixture.mjs';
import { createProjectRetentionPin, pinProjectFile } from '../adapters/node-backend-project-retention.mjs';
import { createBackendProjectCatalog, assertCatalogProject, BACKEND_PROJECT_CATALOG_FILE } from '../adapters/node-backend-project-catalog.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { GODOT4_EXECUTION_ADAPTER } from '../backends/godot4-adapter.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const backendId = 'org.viento.godot4';
const createdAt = '2026-10-11T08:00:00.000Z';
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-catalog-boundary-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const namespace = path.join(base, 'cache/editor', 'a'.repeat(24), backendId);
  await fs.mkdir(namespace, { recursive: true });
  const options = { namespace, backendId }, catalog = createBackendProjectCatalog(options);
  async function output(owner = catalog) {
    // The existing fixture materializes real frozen host/generator bytes;
    // its tool identity is descriptive and no engine process is started.
    const built = await backendProjectFixture(t);
    const directory = path.join(namespace, randomUUID()); await fs.mkdir(directory);
    const pin = await createProjectRetentionPin(directory);
    await fs.cp(built.directory, directory, { recursive: true });
    for (const item of await fs.readdir(directory, { recursive: true, withFileTypes: true })) if (item.isFile()) {
      const file = path.join(item.parentPath, item.name), relative = path.relative(directory, file).split(path.sep).join('/');
      pinProjectFile(pin, relative, await fs.readFile(file));
    }
    const args = { buildDirectory: directory, project: built.project, manifestSha256: built.manifestSha256,
      title: 'Independent recovery fixture', createdAt, retentionPin: pin };
    const entry = await owner.capture(args);
    return { ...built, directory, pin, args, entry };
  }
  return { base, namespace, options, catalog, output, index: path.join(namespace, BACKEND_PROJECT_CATALOG_FILE) };
}

test('catalog independent boundary: serialized descriptions and foreign catalog instances cannot manufacture a project guard or upsert receipt', async t => {
  const h = await fixture(t), value = await h.output();
  assert.ok(Object.isFrozen(value.entry)); assert.ok(Object.isFrozen(value.entry.physical));
  assert.deepEqual(await assertCatalogProject(value.entry), { buildDirectory: value.directory, expectedBuildId: value.entry.buildId,
    expectedSnapshotId: value.entry.snapshotId, expectedManifestSha256: value.entry.manifestSha256 });
  const dto = JSON.parse(JSON.stringify(value.entry));
  await assert.rejects(assertCatalogProject(dto), { errorCode: 'backend_project_catalog_invalid' });
  await assert.rejects(h.catalog.upsert(dto), { errorCode: 'backend_project_catalog_invalid' });
  const foreign = createBackendProjectCatalog(h.options);
  await assert.rejects(foreign.upsert(value.entry), { errorCode: 'backend_project_catalog_invalid' });
  await assert.rejects(foreign.assertProject(value.entry), { errorCode: 'backend_project_catalog_invalid' });
  await h.catalog.upsert(value.entry);
  const read = await foreign.read(); assert.equal(read.entries.length, 1);
  assert.deepEqual(await foreign.assertProject(read.entries[0]), await assertCatalogProject(value.entry));
  assert.equal(Object.hasOwn(read.entries[0], 'retentionPin'), false);
  assert.equal(Object.hasOwn(read.entries[0], 'files'), false);
});

test('catalog independent boundary: two independent writers merge their own captured outputs without adopting an unindexed UUID directory', async t => {
  const h = await fixture(t), peer = createBackendProjectCatalog(h.options);
  const one = await h.output(), two = await h.output(peer), orphan = path.join(h.namespace, randomUUID());
  await fs.mkdir(orphan); await fs.writeFile(path.join(orphan, 'manual-notes'), 'unindexed directory');
  assert.deepEqual((await h.catalog.read()).entries, []);
  await Promise.all([h.catalog.upsert(one.entry), peer.upsert(two.entry)]);
  const result = await h.catalog.read();
  assert.deepEqual(result.entries.map(item => item.buildId).sort(), [one.entry.buildId, two.entry.buildId].sort());
  assert.ok(Object.isFrozen(result.entries)); assert.ok(result.entries.every(Object.isFrozen));
  assert.equal(await fs.readFile(path.join(orphan, 'manual-notes'), 'utf8'), 'unindexed directory');
  assert.deepEqual(result.entries.map(item => item.directory).sort(), [path.basename(one.directory), path.basename(two.directory)].sort());
});

test('catalog independent boundary: a peer releasing its lock between EEXIST and lstat is retried within the same lock budget', async t => {
  const h = await fixture(t), value = await h.output(), lock = path.join(h.namespace, '.backend-project-catalog.lock');
  await fs.writeFile(lock, 'simulated peer lock', { flag: 'wx' });
  const originalOpen = fs.open; let releases = 0;
  fs.open = async (file, flags, ...rest) => {
    try { return await originalOpen(file, flags, ...rest); }
    catch (error) {
      if (file === lock && flags & constants.O_EXCL && error.code === 'EEXIST' && releases++ === 0) await fs.unlink(lock);
      throw error;
    }
  };
  try { await h.catalog.upsert(value.entry); }
  finally { fs.open = originalOpen; }
  assert.equal(releases, 1); assert.equal((await h.catalog.read()).entries[0].buildId, value.entry.buildId);
});

test('catalog independent boundary: malformed existing index is retained byte for byte and cannot be repaired by a later successful capture', async t => {
  const h = await fixture(t), value = await h.output(), bytes = Buffer.from('{broken recovery index\n');
  await fs.writeFile(h.index, bytes, { flag: 'wx' });
  await assert.rejects(h.catalog.read(), { errorCode: 'backend_project_catalog_corrupt' });
  await assert.rejects(h.catalog.upsert(value.entry), { errorCode: 'backend_project_catalog_corrupt' });
  assert.deepEqual(await fs.readFile(h.index), bytes);
  assert.ok((await fs.stat(path.join(value.directory, 'backend-project.json'))).isFile());
});

test('catalog independent boundary: index symlinks and hardlinks cannot read or overwrite an outside owner', async t => {
  const h = await fixture(t), value = await h.output(), outside = path.join(h.base, 'outside.json');
  await fs.writeFile(outside, 'outside owner\n'); await fs.symlink(outside, h.index);
  await assert.rejects(h.catalog.read()); await assert.rejects(h.catalog.upsert(value.entry));
  assert.equal(await fs.readFile(outside, 'utf8'), 'outside owner\n'); assert.ok((await fs.lstat(h.index)).isSymbolicLink());
  await fs.rm(h.index); await fs.link(outside, h.index);
  await assert.rejects(h.catalog.read()); await assert.rejects(h.catalog.upsert(value.entry));
  assert.equal(await fs.readFile(outside, 'utf8'), 'outside owner\n'); assert.equal((await fs.stat(outside)).nlink, 2);
});

test('catalog independent boundary: stale captured manifest and replaced physical output cannot be persisted or guarded', async t => {
  const h = await fixture(t), value = await h.output();
  const manifest = path.join(value.directory, 'backend-project.json'), original = await fs.readFile(manifest);
  await fs.appendFile(manifest, '\n');
  await assert.rejects(h.catalog.upsert(value.entry), { errorCode: 'backend_project_changed' });
  await assert.rejects(assertCatalogProject(value.entry), { errorCode: 'backend_project_changed' });
  await fs.writeFile(manifest, original);
  await fs.rename(value.directory, path.join(h.base, 'original-output')); await fs.mkdir(value.directory);
  await fs.cp(path.join(h.base, 'original-output'), value.directory, { recursive: true });
  await assert.rejects(assertCatalogProject(value.entry), { errorCode: 'backend_project_owner_changed' });
  await assert.rejects(h.catalog.upsert(value.entry), { errorCode: 'backend_project_owner_changed' });
  assert.deepEqual(await fs.readFile(path.join(h.base, 'original-output', 'backend-project.json')), original);
});

test('catalog independent boundary: successful read does not grant cleanup and refuses a replaced namespace ancestor link', async t => {
  const h = await fixture(t), value = await h.output(); await h.catalog.upsert(value.entry);
  const saved = (await h.catalog.read()).entries[0], savedIndex = await fs.readFile(h.index), ancestor = path.dirname(h.namespace), original = path.join(h.base, 'original-namespace'), outside = path.join(h.base, 'outside');
  await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'notes'), 'outside namespace');
  await fs.rename(ancestor, original); await fs.symlink(outside, ancestor, 'dir');
  await assert.rejects(assertCatalogProject(saved), { errorCode: 'backend_project_catalog_changed' });
  await assert.rejects(h.catalog.read(), { errorCode: 'backend_project_catalog_changed' });
  await assert.rejects(h.catalog.upsert(value.entry), { errorCode: 'backend_project_catalog_changed' });
  assert.equal(await fs.readFile(path.join(outside, 'notes'), 'utf8'), 'outside namespace');
  assert.deepEqual(await fs.readFile(path.join(original, backendId, BACKEND_PROJECT_CATALOG_FILE)), savedIndex);
});

test('catalog independent boundary: an existing unowned lock is never removed as stale or converted into catalog ownership', async t => {
  const h = await fixture(t), value = await h.output(), lock = path.join(h.namespace, '.backend-project-catalog.lock');
  const bytes = Buffer.from('unrecognized peer or stale lock\n'); await fs.writeFile(lock, bytes, { flag: 'wx' });
  await assert.rejects(h.catalog.upsert(value.entry), { errorCode: 'backend_project_catalog_busy' });
  assert.deepEqual(await fs.readFile(lock), bytes); await assert.rejects(fs.stat(h.index), { code: 'ENOENT' });
});

test('catalog independent boundary: externally replaced temporary publication bytes never overwrite the previous valid index', async t => {
  const h = await fixture(t), first = await h.output(), second = await h.output(); await h.catalog.upsert(first.entry);
  const before = await fs.readFile(h.index), originalOpen = fs.open; let replaced = 0;
  fs.open = async (file, flags, ...rest) => {
    const handle = await originalOpen(file, flags, ...rest);
    if (typeof file === 'string' && path.dirname(file) === h.namespace && /^\.backend-project-catalog-[a-f0-9-]+\.tmp$/.test(path.basename(file)) && flags & constants.O_EXCL) {
      const close = handle.close.bind(handle);
      handle.close = async () => {
        const result = await close(); if (replaced++ === 0) { await fs.unlink(file); await fs.writeFile(file, 'external replacement\n', { flag: 'wx' }); } return result;
      };
    }
    return handle;
  };
  try { await assert.rejects(h.catalog.upsert(second.entry)); }
  finally { fs.open = originalOpen; }
  assert.equal(replaced, 1); assert.deepEqual(await fs.readFile(h.index), before);
  assert.deepEqual((await h.catalog.read()).entries.map(entry => entry.buildId), [first.entry.buildId]);
});

async function hostFixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-catalog-selection-boundary-'));
  const root = path.join(base, 'author'), cacheRoot = path.join(base, 'cache'), services = [];
  let gate, identifications = 0, executions = 0;
  t.after(async () => { gate?.release(); await Promise.all(services.map(service => service.close())); await fs.rm(base, { recursive: true, force: true }); });
  await fs.cp(new URL('../../examples/scene2d/', import.meta.url), root, { recursive: true });
  const backendRegistry = createExecutionBackendRegistry([{ ...GODOT4_EXECUTION_ADAPTER,
    async identify(executable) { identifications++; return { executable, version: '4.7.2.stable.fixture', sha256: buildHash('independent catalog host fixture'), platform: process.platform, arch: process.arch }; },
    async executePhase() { executions++; return { status: 'succeeded', exitCode: 0, stdout: '', stderr: '' }; },
    async generate(plan) {
      if (gate && !gate.used) { const held = gate; held.used = true; held.notify(); await held.promise; }
      return GODOT4_EXECUTION_ADAPTER.generate(plan);
    },
  }]);
  const open = () => { const service = createProjectBuildService(root, { cacheRoot, tool: process.execPath, backendRegistry }); services.push(service); return service; };
  async function settled(service) {
    for (let index = 0; index < 1000; index++) {
      const state = await service.status(); if (state.job?.status !== 'running') return state; await delay(5);
    }
    assert.fail('Bounded catalog host job did not settle.');
  }
  async function build(service) {
    const before = await service.status(); await service.command({ action: 'build', sceneId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
    const state = await settled(service); assert.equal(state.job.status, 'succeeded', JSON.stringify(state));
    const project = state.projects.find(item => !before.projects.some(old => old.id === item.id)); assert.ok(project);
    const detail = await service.command({ action: 'inspect-project', buildId: project.id });
    return { state, project, directory: detail.buildDirectory };
  }
  function holdNextGeneration() {
    const blocked = Promise.withResolvers(), entered = Promise.withResolvers();
    gate = { promise: blocked.promise, entered: entered.promise, release: blocked.resolve, notify: entered.resolve, used: false }; return gate;
  }
  async function entered(held) { await Promise.race([held.entered, delay(2000).then(() => assert.fail('Deferred generator was not entered.'))]); }
  const owner = open(), first = await build(owner), second = await build(owner); await owner.close();
  const service = open(); await service.status();
  return { base, root, cacheRoot, owner, service, first, second, open, build, settled, holdNextGeneration, entered,
    counts: () => ({ identifications, executions }) };
}

test('catalog independent host boundary: an earlier delayed project selection cannot overwrite a later explicit selection', async t => {
  const h = await hostFixture(t), held = h.holdNextGeneration(), counts = h.counts();
  const earlier = h.service.command({ action: 'select-project', buildId: h.first.project.id }).then(value => ({ value }), error => ({ error }));
  try {
    await h.entered(held);
    const latest = await h.service.command({ action: 'select-project', buildId: h.second.project.id });
    assert.equal(latest.latestBuild.id, h.second.project.id); held.release();
    const outcome = await earlier; assert.equal(outcome.error?.errorCode, 'backend_project_selection_changed');
    assert.equal((await h.service.status()).latestBuild.id, h.second.project.id); assert.deepEqual(h.counts(), counts);
  } finally { held.release(); await earlier; }
});

test('catalog independent host boundary: close waits for delayed selection and rejects its completion without publishing runtime ownership', async t => {
  const h = await hostFixture(t), held = h.holdNextGeneration();
  const namespace = path.dirname(h.first.directory), index = path.join(namespace, BACKEND_PROJECT_CATALOG_FILE), before = await fs.readFile(index);
  const pending = h.service.command({ action: 'select-project', buildId: h.first.project.id }).then(value => ({ value }), error => ({ error }));
  try {
    await h.entered(held); const closing = h.service.close(); held.release();
    const outcome = await pending; assert.equal(outcome.error?.errorCode, 'build_service_closed'); await closing;
    assert.deepEqual(await fs.readFile(index), before);
    const next = h.open(); const state = await next.status(); assert.equal(state.latestBuild, null);
    assert.equal(state.projects.find(item => item.id === h.first.project.id).availability, 'unchecked');
  } finally { held.release(); await pending; }
});

test('catalog independent host boundary: a new successful build makes a previously delayed project selection stale', async t => {
  const h = await hostFixture(t), held = h.holdNextGeneration();
  const pending = h.service.command({ action: 'select-project', buildId: h.first.project.id }).then(value => ({ value }), error => ({ error }));
  try {
    await h.entered(held); const current = await h.build(h.service); held.release();
    const outcome = await pending; assert.equal(outcome.error?.errorCode, 'backend_project_selection_changed');
    assert.equal((await h.service.status()).latestBuild.id, current.project.id);
  } finally { held.release(); await pending; }
});

test('catalog independent host boundary: selecting a restored project grants no automatic deletion receipt after four new builds', async t => {
  const h = await hostFixture(t), manifest = path.join(h.first.directory, 'backend-project.json'), before = await fs.readFile(manifest);
  const selected = await h.service.command({ action: 'select-project', buildId: h.first.project.id });
  assert.equal(selected.latestBuild.id, h.first.project.id);
  for (let index = 0; index < 4; index++) await h.build(h.service);
  const row = (await h.service.status()).projects.find(item => item.id === h.first.project.id);
  assert.ok(row); assert.equal(row.origin, 'previous-session'); assert.equal(row.retention, 'preserved');
  assert.deepEqual(await fs.readFile(manifest), before);
  const next = h.open(); const state = await next.status(); assert.ok(state.projects.some(item => item.id === h.first.project.id));
});

test('catalog independent host boundary: a restored manifest changed after selection cannot reach tool identification or engine phases', async t => {
  const h = await hostFixture(t); await h.service.command({ action: 'select-project', buildId: h.first.project.id });
  const before = h.counts(), manifest = path.join(h.first.directory, 'backend-project.json'); await fs.appendFile(manifest, '\n');
  await h.service.command({ action: 'run', buildId: h.first.project.id, mode: 'headless' });
  const state = await h.settled(h.service); assert.equal(state.job.status, 'failed');
  assert.equal(state.job.diagnostics[0].code, 'backend_project_changed'); assert.deepEqual(h.counts(), before);
  assert.equal((await fs.readFile(manifest, 'utf8')).endsWith('\n\n'), true);
});
