import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { GODOT4_EXECUTION_ADAPTER } from '../backends/godot4-adapter.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { createBackendProjectCatalog, BACKEND_PROJECT_CATALOG_FILE } from '../adapters/node-backend-project-catalog.mjs';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-project-catalog-service-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'author'), cacheRoot = path.join(base, 'cache');
  await fs.cp(new URL('../../examples/scene2d/', import.meta.url), root, { recursive: true });
  let identities = 0, generations = 0;
  // Real frozen generation/inspection and IO, bounded phase fixture only.
  // This test does not certify an engine import or runtime execution.
  const backendRegistry = createExecutionBackendRegistry([{ ...GODOT4_EXECUTION_ADAPTER,
    async generate(plan) { generations++; return GODOT4_EXECUTION_ADAPTER.generate(plan); },
    async identify(executable) { identities++; return { executable, version: '4.7.2.stable.fixture',
      sha256: buildHash('catalog phase fixture'), platform: process.platform, arch: process.arch }; },
    async executePhase() { return { status: 'succeeded', exitCode: 0, stdout: '', stderr: '' }; },
  }]);
  let service;
  const restart = async (tool = process.execPath) => {
    await service?.close(); service = createProjectBuildService(root, { cacheRoot, backendRegistry, tool });
    t.after(() => service.close()); return service;
  };
  await restart();
  const build = async () => {
    await service.command({ action: 'build', sceneId });
    for (let i = 0; i < 1000; i++) {
      const state = await service.status();
      if (state.job?.status !== 'running') { assert.equal(state.job.status, 'succeeded', JSON.stringify(state)); return state; }
      await delay(5);
    }
    assert.fail('Build did not settle.');
  };
  return { base, root, cacheRoot, restart, build, get service() { return service; },
    counts: () => ({ identities, generations }) };
}

test('catalog service: restart lists historical projects without generation, tool process, implicit runtime selection or private path leakage', async t => {
  const h = await fixture(t), first = await h.build(), id = first.latestBuild.id;
  const detail = await h.service.command({ action: 'inspect-project', buildId: id });
  const before = h.counts(); await h.restart('');
  const state = await h.service.status();
  assert.deepEqual(h.counts(), before); assert.equal(state.latestBuild, null);
  assert.equal(state.projects.length, 1); assert.equal(state.projects[0].origin, 'previous-session');
  assert.equal(state.projects[0].availability, 'unchecked'); assert.equal(state.projects[0].retention, 'preserved');
  assert.equal(state.projectManagement.scope, 'host-catalog');
  for (const privatePath of [h.base, detail.buildDirectory]) assert.equal(JSON.stringify(state).includes(privatePath), false);
  assert.deepEqual(await h.service.command({ action: 'inspect-project', buildId: id }), detail);
  assert.equal((await h.service.status()).latestBuild, null);
  const chosen = await h.service.command({ action: 'select-project', buildId: id });
  assert.equal(chosen.latestBuild.id, id); assert.equal(chosen.latestBuild.snapshotId, first.latestBuild.snapshotId);
  assert.equal(chosen.projects[0].availability, 'verified'); assert.equal(h.counts().identities, before.identities);
});

test('catalog service: restored build is not runnable until explicitly selected and inspect does not switch targets', async t => {
  const h = await fixture(t), first = await h.build(), id = first.latestBuild.id;
  await h.restart();
  await assert.rejects(h.service.command({ action: 'run', buildId: id, mode: 'headless' }), { errorCode: 'build_artifact_missing' });
  const second = await h.build();
  await h.service.command({ action: 'inspect-project', buildId: id });
  assert.equal((await h.service.status()).latestBuild.id, second.latestBuild.id);
  assert.equal((await h.service.command({ action: 'select-project', buildId: id })).latestBuild.id, id);
});

test('catalog service: failed historical selection preserves the current target and author bytes', async t => {
  const h = await fixture(t), first = await h.build();
  const detail = await h.service.command({ action: 'inspect-project', buildId: first.latestBuild.id });
  const authorBefore = await fs.readFile(path.join(h.root, 'documents/scenes/demo.json'));
  await h.restart(); const second = await h.build();
  await fs.appendFile(path.join(detail.buildDirectory, 'project/project.godot'), '\n# manual change\n');
  await assert.rejects(h.service.command({ action: 'select-project', buildId: first.latestBuild.id }), { errorCode: 'backend_project_changed' });
  const state = await h.service.status(); assert.equal(state.latestBuild.id, second.latestBuild.id);
  assert.equal(state.projects.find(p => p.id === first.latestBuild.id).availability, 'unavailable');
  assert.deepEqual(await fs.readFile(path.join(h.root, 'documents/scenes/demo.json')), authorBefore);
});

test('catalog service: source offline after restart keeps frozen scene selection, forbids new author builds and allows tool-free inspection', async t => {
  const h = await fixture(t), first = await h.build(), id = first.latestBuild.id;
  await h.service.close(); await fs.rename(h.root, path.join(h.base, 'offline-author')); await h.restart('');
  const state = await h.service.status();
  assert.equal(state.scenes[0].id, sceneId); assert.equal(state.scenes[0].frozenOnly, true);
  assert.equal(state.catalogDiagnostic.code, 'build_catalog_unavailable');
  await h.service.command({ action: 'inspect-project', buildId: id });
  const chosen = await h.service.command({ action: 'select-project', buildId: id }); assert.equal(chosen.latestBuild.id, id);
  await assert.rejects(h.service.command({ action: 'plan', sceneId }));
  assert.equal(chosen.projectManagement.catalogDiagnostic, null);
});

test('catalog service: an unindexed copied project is never discovered or adopted', async t => {
  const h = await fixture(t), first = await h.build(), id = first.latestBuild.id;
  const detail = await h.service.command({ action: 'inspect-project', buildId: id });
  const unknown = path.join(path.dirname(detail.buildDirectory), randomUUID());
  await fs.cp(detail.buildDirectory, unknown, { recursive: true });
  await fs.writeFile(path.join(unknown, 'notes.txt'), 'unowned file');
  await h.restart();
  assert.deepEqual((await h.service.status({ refresh: true })).projects.map(p => p.id), [id]);
  await assert.rejects(h.service.command({ action: 'select-project', buildId: path.basename(unknown) }), { errorCode: 'build_artifact_missing' });
  assert.equal(await fs.readFile(path.join(unknown, 'notes.txt'), 'utf8'), 'unowned file');
});

test('catalog service: replacing the author workspace UUID cannot inherit a prior frozen project at the same path', async t => {
  const h = await fixture(t), first = await h.build(), id = first.latestBuild.id;
  await h.restart();
  const file = path.join(h.root, 'workspace.json'), value = JSON.parse(await fs.readFile(file));
  value.id = randomUUID(); await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
  // Direct POST without a preceding status still has the identity guard.
  await assert.rejects(h.service.command({ action: 'select-project', buildId: id }), { errorCode: 'backend_project_workspace_changed' });
  assert.equal((await h.service.status()).latestBuild, null);
});

test('catalog service: normal current-session retention updates the persistent index after pruning', async t => {
  const h = await fixture(t); const ids = [];
  for (let i = 0; i < 4; i++) ids.push((await h.build()).latestBuild.id);
  const current = await h.service.status(); assert.equal(current.projects.length, 3);
  assert.ok(!current.projects.some(p => p.id === ids[0]));
  await h.restart(); const restored = await h.service.status();
  assert.deepEqual(new Set(restored.projects.map(p => p.id)), new Set(ids.slice(1)));
  assert.ok(restored.projects.every(p => p.origin === 'previous-session' && p.retention === 'preserved'));
});

test('catalog service: selection rejects injected paths and backend identities before resolving entries', async t => {
  const h = await fixture(t);
  for (const payload of [{ action: 'select-project', buildId: sceneId, path: h.base },
    { action: 'select-project', buildId: sceneId, backendId: 'org.viento.bevy' },
    { action: 'select-project', buildId: '../outside' }]) {
    await assert.rejects(h.service.command(payload), { errorCode: 'build_request_invalid' });
  }
});

test('catalog service: explicit refresh removes deleted historic registrations and revokes their runtime selection without deleting files', async t => {
  const h = await fixture(t), first = await h.build(), id = first.latestBuild.id;
  const detail = await h.service.command({ action: 'inspect-project', buildId: id });
  await h.restart(); await h.service.command({ action: 'select-project', buildId: id });
  const catalog = createBackendProjectCatalog({ namespace: path.dirname(detail.buildDirectory), backendId: 'org.viento.godot4' });
  await catalog.remove(id);
  const refreshed = await h.service.status({ refresh: true }); assert.equal(refreshed.latestBuild, null);
  assert.equal(refreshed.projects.length, 0); assert.ok((await fs.stat(detail.buildDirectory)).isDirectory());
  await assert.rejects(h.service.command({ action: 'run', buildId: id, mode: 'headless' }), { errorCode: 'build_artifact_missing' });
  const current = await h.build(); await catalog.remove(current.latestBuild.id);
  assert.equal((await h.service.status({ refresh: true })).latestBuild.id, current.latestBuild.id,
    'catalog omission cannot revoke current in-memory creating-host receipts');
});

test('catalog service: a corrupt index stays byte-exact and visible while a new build succeeds in the current session', async t => {
  const h = await fixture(t), first = await h.build();
  const detail = await h.service.command({ action: 'inspect-project', buildId: first.latestBuild.id });
  const file = path.join(path.dirname(detail.buildDirectory), BACKEND_PROJECT_CATALOG_FILE), corrupt = 'manually broken index\n';
  await fs.writeFile(file, corrupt); await h.restart();
  const state = await h.service.status(); assert.equal(state.projects.length, 0);
  assert.equal(state.projectManagement.catalogDiagnostic.code, 'backend_project_catalog_corrupt');
  const next = await h.build(); assert.equal(next.job.status, 'succeeded'); assert.equal(next.projects.length, 1);
  assert.equal(next.projects[0].origin, 'current-session');
  assert.equal(next.projectManagement.catalogDiagnostic.code, 'backend_project_catalog_corrupt');
  assert.equal(await fs.readFile(file, 'utf8'), corrupt);
});
