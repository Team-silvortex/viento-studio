import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createProjectRetentionPin, pinProjectFile, inspectProjectRetention, assertProjectOwnership } from '../adapters/node-backend-project-retention.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { GODOT4_EXECUTION_ADAPTER } from '../backends/godot4-adapter.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-project-management-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return base;
}
async function settled(service) {
  for (let i = 0; i < 1000; i++) {
    const state = await service.status();
    if (state.job?.status !== 'running') return state;
    await delay(5);
  }
  assert.fail('Job did not settle.');
}
async function hostFixture(t, { failPhase = false } = {}) {
  const base = await fixture(t), root = path.join(base, 'source'), cacheRoot = path.join(base, 'cache');
  await fs.cp(new URL('../../examples/scene2d/', import.meta.url), root, { recursive: true });
  let identifications = 0;
  const backendRegistry = createExecutionBackendRegistry([{ ...GODOT4_EXECUTION_ADAPTER,
    async identify(executable) { identifications++; return { executable, version: '4.7.2.stable', sha256: buildHash('tool fixture'), platform: process.platform, arch: process.arch }; },
    async executePhase() { if (failPhase) throw new Error('Host fixture failure.'); return { status: 'succeeded', exitCode: 0, stdout: '', stderr: '' }; },
  }]);
  const service = createProjectBuildService(root, { cacheRoot, tool: process.execPath, backendRegistry });
  t.after(() => service.close());
  const build = async () => {
    const before = await service.status();
    await service.command({ action: 'build', sceneId });
    const state = await settled(service);
    const project = state.projects.find(item => !before.projects.some(old => old.id === item.id));
    const directory = path.join(cacheRoot, 'editor', buildHash(path.resolve(root)).slice(0, 24), GODOT4_EXECUTION_ADAPTER.descriptor.id, state.job.id);
    return { state, project, directory };
  };
  return { base, root, cacheRoot, service, build, identifications: () => identifications };
}

test('project retention: exact host-written receipts permit cleanup without changing any file', async t => {
  const directory = await fixture(t), pin = await createProjectRetentionPin(directory);
  await fs.mkdir(path.join(directory, 'project'));
  await fs.writeFile(path.join(directory, 'project/input.json'), '{"stable":true}');
  pinProjectFile(pin, 'project/input.json', '{"stable":true}');
  assert.deepEqual(await inspectProjectRetention(pin), { complete: true, reason: null });
  await fs.appendFile(path.join(directory, 'project/input.json'), '\n');
  assert.equal((await inspectProjectRetention(pin)).complete, false);
  assert.equal(await fs.readFile(path.join(directory, 'project/input.json'), 'utf8'), '{"stable":true}\n');
});

for (const [name, change, reason] of [
  ['new file', async root => fs.writeFile(path.join(root, 'author-notes.txt'), 'keep me'), 'backend_project_extra_paths'],
  ['new empty directory', async root => fs.mkdir(path.join(root, 'author-files')), 'backend_project_extra_paths'],
  ['run report', async root => fs.mkdir(path.join(root, 'sessions')), 'backend_project_sessions_retained'],
  ['link', async root => fs.symlink('missing', path.join(root, 'linked')), 'backend_project_link'],
]) {
  test(`project retention: preserve ${name}`, async t => {
    const directory = await fixture(t), pin = await createProjectRetentionPin(directory);
    await change(directory);
    assert.deepEqual(await inspectProjectRetention(pin), { complete: false, reason });
  });
}

test('project retention: replaced owned root and parent links cannot grant deletion or inspection ownership', async t => {
  const base = await fixture(t), directory = path.join(base, 'owned'); await fs.mkdir(directory);
  const pin = await createProjectRetentionPin(directory), moved = path.join(base, 'moved');
  await fs.rename(directory, moved); await fs.symlink(moved, directory, 'dir');
  await assert.rejects(assertProjectOwnership(pin), { errorCode: 'backend_project_owner_changed' });
  assert.equal((await inspectProjectRetention(pin)).reason, 'backend_project_owner_changed');
  await fs.unlink(directory); await fs.mkdir(directory);
  await assert.rejects(assertProjectOwnership(pin), { errorCode: 'backend_project_owner_changed' });
  const parent = path.join(base, 'parent'); await fs.mkdir(parent);
  const child = path.join(parent, 'owned'); await fs.mkdir(child);
  const childPin = await createProjectRetentionPin(child);
  await fs.rename(parent, path.join(base, 'physical-parent')); await fs.symlink(path.join(base, 'physical-parent'), parent, 'dir');
  assert.equal((await inspectProjectRetention(childPin)).reason, 'backend_project_owner_changed');
});

test('project manager: stable owned history, read-only details, namespace separation and only three pristine outputs', async t => {
  const { service, build, root, identifications } = await hostFixture(t);
  const sourceBefore = buildHash(await fs.readFile(path.join(root, 'documents/scenes/demo.json')));
  const first = await build(); assert.equal(first.state.job.status, 'succeeded');
  assert.equal(first.project.retention, 'automatic');
  const count = identifications();
  const detail = await service.command({ action: 'inspect-project', buildId: first.project.id });
  assert.equal(detail.project.buildId, first.project.id);
  assert.equal(detail.inspection.recorded, true); assert.equal(detail.inspection.complete, true);
  assert.equal(identifications(), count, 'inspection must never start a tool identity process');
  assert.equal(detail.buildDirectory, first.directory);
  await build(); await build(); const fourth = await build();
  assert.equal(fourth.state.projects.length, 3);
  assert.equal(fourth.state.projectManagement.retentionLimit, 3);
  assert.equal(fourth.state.projectManagement.scope, 'host-catalog');
  await assert.rejects(fs.stat(first.directory), { code: 'ENOENT' });
  await assert.rejects(service.command({ action: 'inspect-project', buildId: first.project.id }), { errorCode: 'build_artifact_missing' });
  assert.equal(buildHash(await fs.readFile(path.join(root, 'documents/scenes/demo.json'))), sourceBefore);
});

for (const [name, mutate, reason] of [
  ['changed generated bytes', async d => fs.appendFile(path.join(d, 'project/project.godot'), '\n# author experiment\n'), 'backend_project_changed'],
  ['added file', async d => fs.writeFile(path.join(d, 'author-notes.txt'), 'do not delete'), 'backend_project_extra_paths'],
  ['changed manifest', async d => fs.appendFile(path.join(d, 'backend-project.json'), '\n'), 'backend_project_changed'],
  ['runtime reports', async d => fs.mkdir(path.join(d, 'sessions')), 'backend_project_sessions_retained'],
  ['linked project', async d => { await fs.rename(path.join(d, 'project'), path.join(d, 'saved')); await fs.symlink('saved', path.join(d, 'project'), 'dir'); }, null],
]) {
  test(`project manager: ${name} stay visible when pruning newer builds`, async t => {
    const { service, build } = await hostFixture(t);
    const first = await build(); await mutate(first.directory);
    await build(); await build(); const fourth = await build();
    const preserved = fourth.state.projects.find(item => item.id === first.project.id);
    assert.equal(preserved.retention, 'preserved');
    if (reason) assert.equal(preserved.retentionReason, reason);
    assert.equal(fourth.state.projects.length, 4); assert.equal(fourth.state.projectManagement.preservedCount, 1);
    assert.equal((await fs.stat(first.directory)).isDirectory(), true);
    assert.equal((await service.status()).latestBuild.id, fourth.project.id);
  });
}

test('project manager: failed partial outputs are inspect-disabled and pristine receipts are still bounded', async t => {
  const { service, build } = await hostFixture(t, { failPhase: true });
  const first = await build(); assert.equal(first.state.job.status, 'failed');
  assert.equal((await fs.stat(path.join(first.directory, 'project/project.godot'))).isFile(), true);
  await assert.rejects(service.command({ action: 'inspect-project', buildId: first.project.id }), { errorCode: 'build_artifact_missing' });
  await build(); await build(); const fourth = await build();
  assert.equal(fourth.state.projects.length, 3);
  await assert.rejects(fs.stat(first.directory), { code: 'ENOENT' });
});

test('project manager: strict identifiers, closed gate, offline source and recorded history cannot adopt a replaced root', async t => {
  const { base, root, cacheRoot, service, build } = await hostFixture(t);
  const first = await build();
  for (const payload of [{ action: 'inspect-project', buildId: '../escape' },
    { action: 'inspect-project', buildId: first.project.id, buildDirectory: first.directory },
    { action: 'inspect-project', buildId: first.project.id, backendId: 'untrusted' }]) {
    await assert.rejects(service.command(payload), { errorCode: 'build_request_invalid' });
  }
  await fs.rename(root, path.join(base, 'source-offline'));
  assert.equal((await service.command({ action: 'inspect-project', buildId: first.project.id })).project.buildId, first.project.id);
  await fs.rename(first.directory, `${first.directory}-moved`); await fs.symlink(`${first.directory}-moved`, first.directory, 'dir');
  await assert.rejects(service.command({ action: 'inspect-project', buildId: first.project.id }), { errorCode: 'backend_project_owner_changed' });
  await service.close();
  await assert.rejects(service.command({ action: 'inspect-project', buildId: first.project.id }), { errorCode: 'build_service_closed' });
  await fs.rename(path.join(base, 'source-offline'), root);
  const next = createProjectBuildService(root, { cacheRoot, tool: '' }); t.after(() => next.close());
  const restored = await next.status();
  assert.equal(restored.projects.length, 1); assert.equal(restored.projects[0].id, first.project.id);
  assert.equal(restored.projects[0].origin, 'previous-session'); assert.equal(restored.projects[0].availability, 'unchecked');
  assert.equal(restored.projects[0].retention, 'preserved'); assert.equal(restored.latestBuild, null);
  await assert.rejects(next.command({ action: 'select-project', buildId: first.project.id }), { errorCode: 'backend_project_catalog_changed' });
  assert.equal((await fs.lstat(first.directory)).isSymbolicLink(), true, 'prior-host output is never silently adopted or removed');
});
