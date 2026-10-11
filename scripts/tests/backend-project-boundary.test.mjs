import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { createExecutionBackendRegistry } from '../adapters/node-execution-backends.mjs';
import { GODOT4_EXECUTION_ADAPTER } from '../backends/godot4-adapter.mjs';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-project-boundary-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'source'), cacheRoot = path.join(base, 'cache');
  await fs.cp(new URL('../../examples/scene2d/', import.meta.url), root, { recursive: true });
  // Generation and host ownership are real. This phase fixture starts no
  // Godot process and does not certify imports or engine execution.
  const backendRegistry = createExecutionBackendRegistry([{ ...GODOT4_EXECUTION_ADAPTER,
    async identify(executable) { return { executable, version: '4.7.2.stable', sha256: buildHash('bounded host fixture'), platform: process.platform, arch: process.arch }; },
    async executePhase() { return { status: 'succeeded', exitCode: 0, stdout: '', stderr: '' }; },
  }]);
  const service = createProjectBuildService(root, { cacheRoot, tool: process.execPath, backendRegistry });
  t.after(() => service.close());
  const build = async () => {
    const before = await service.status(); await service.command({ action: 'build', sceneId });
    for (let index = 0; index < 1000; index++) {
      const state = await service.status();
      if (state.job.status !== 'running') {
        assert.equal(state.job.status, 'succeeded', JSON.stringify(state));
        const project = state.projects.find(item => !before.projects.some(old => old.id === item.id));
        assert.ok(project); return { state, project };
      }
      await delay(5);
    }
    assert.fail('Bounded host build did not settle.');
  };
  const first = await build(), detail = await service.command({ action: 'inspect-project', buildId: first.project.id });
  return { base, root, service, build, first, directory: detail.buildDirectory };
}

for (const [label, mutate, verify, expectedReason] of [
  ['manual file added after quarantine rename',
    directory => fs.writeFile(path.join(directory, 'manual-notes.txt'), 'retain this concurrent edit\n'),
    async directory => assert.equal(await fs.readFile(path.join(directory, 'manual-notes.txt'), 'utf8'), 'retain this concurrent edit\n'),
    'backend_project_extra_paths'],
  ['registered file edited after quarantine rename',
    directory => fs.appendFile(path.join(directory, 'project/project.godot'), '\n# concurrent experiment\n'),
    async directory => assert.match(await fs.readFile(path.join(directory, 'project/project.godot'), 'utf8'), /# concurrent experiment/),
    'backend_project_changed'],
]) {
  test(`independent project boundary: preserve ${label} without failing the new build`, async t => {
    const h = await fixture(t), originalRename = fs.rename;
    const sourceBefore = buildHash(await fs.readFile(path.join(h.root, 'documents/scenes/demo.json')));
    let quarantined;
    fs.rename = async (from, to, ...rest) => {
      const result = await originalRename(from, to, ...rest);
      if (from === h.directory && path.basename(to).startsWith('.viento-prune-')) {
        assert.equal(quarantined, undefined); quarantined = to; await mutate(to);
      }
      return result;
    };
    try {
      await h.build(); await h.build(); const fourth = await h.build();
      assert.ok(quarantined, 'cleanup must quarantine before its final content check');
      const preserved = fourth.state.projects.find(item => item.id === h.first.project.id);
      assert.ok(preserved); assert.equal(preserved.retention, 'preserved'); assert.equal(preserved.retentionReason, expectedReason);
      assert.equal(fourth.state.latestBuild.id, fourth.project.id); await verify(quarantined);
      assert.equal(buildHash(await fs.readFile(path.join(h.root, 'documents/scenes/demo.json'))), sourceBefore);
      await assert.rejects(fs.stat(h.directory), { code: 'ENOENT' });
    } finally { fs.rename = originalRename; }
  });
}

test('independent project boundary: a link replacing the old root during quarantine cannot delete the outside directory', async t => {
  const h = await fixture(t), originalRename = fs.rename, outside = path.join(h.base, 'outside'), moved = path.join(h.base, 'moved-owned');
  await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'private.txt'), 'outside owner\n');
  let quarantined;
  fs.rename = async (from, to, ...rest) => {
    if (from === h.directory && path.basename(to).startsWith('.viento-prune-')) {
      await originalRename(from, moved); await fs.symlink(outside, from, 'dir'); quarantined = to;
    }
    return originalRename(from, to, ...rest);
  };
  try {
    await h.build(); await h.build(); const fourth = await h.build();
    assert.ok(quarantined); assert.ok((await fs.lstat(quarantined)).isSymbolicLink());
    assert.equal(await fs.readFile(path.join(outside, 'private.txt'), 'utf8'), 'outside owner\n');
    assert.ok((await fs.stat(path.join(moved, 'backend-project.json'))).isFile());
    const preserved = fourth.state.projects.find(item => item.id === h.first.project.id);
    assert.ok(preserved); assert.equal(preserved.retention, 'preserved');
    assert.equal(fourth.state.latestBuild.id, fourth.project.id);
  } finally { fs.rename = originalRename; }
});

test('independent project boundary: same-byte outside hardlinks prevent automatic deletion while remaining outside execution authority', async t => {
  const h = await fixture(t), file = path.join(h.directory, 'project/project.godot'), outside = path.join(h.base, 'external-reference.godot');
  const original = await fs.readFile(file); await fs.link(file, outside);
  assert.equal((await fs.stat(file)).nlink, 2);
  await h.build(); await h.build(); const fourth = await h.build();
  const preserved = fourth.state.projects.find(item => item.id === h.first.project.id);
  assert.ok(preserved); assert.equal(preserved.retention, 'preserved');
  assert.deepEqual(await fs.readFile(file), original); assert.deepEqual(await fs.readFile(outside), original);
  assert.equal(fourth.state.latestBuild.id, fourth.project.id);
});

test('independent project boundary: thrown build phase attempts exact cleanup and preserves partial project and unrelated sidecars', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-project-failed-boundary-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'author'), output = path.join(base, 'failed-build');
  await fs.cp(new URL('../../examples/scene2d/', import.meta.url), root, { recursive: true });
  const authorBefore = buildHash(await fs.readFile(path.join(root, 'documents/scenes/demo.json')));
  let generatedContext, cleanupContext, cleanupCalls = 0, projectDirectory;
  const backendRegistry = createExecutionBackendRegistry([{ ...GODOT4_EXECUTION_ADAPTER,
    async identify(executable) { return { executable, version: '4.7.2.stable.fixture', sha256: buildHash('failed-phase fixture identity'), platform: process.platform, arch: process.arch }; },
    async generate(plan) {
      const generated = await GODOT4_EXECUTION_ADAPTER.generate(plan);
      generatedContext = { generatedFiles: [...generated.files.keys()], resourceFiles: [...generated.resourceFiles.values()] };
      return generated;
    },
    async executePhase({ directory }) {
      projectDirectory = directory;
      for (const cache of ['.godot', '.host']) {
        await fs.mkdir(path.join(directory, cache)); await fs.writeFile(path.join(directory, cache, 'temporary-cache'), 'recreated cache');
      }
      for (const file of generatedContext.generatedFiles.filter(name => name.endsWith('.gd'))) await fs.writeFile(path.join(directory, `${file}.uid`), 'generated uid');
      for (const file of generatedContext.resourceFiles) await fs.writeFile(path.join(directory, `${file}.import`), 'generated import');
      await fs.writeFile(path.join(directory, 'manual.gd.uid'), 'retain unrelated sidecar');
      await fs.writeFile(path.join(directory, 'manual-notes.txt'), 'retain failed-build investigation');
      throw Object.assign(new Error('bounded phase failure'), { errorCode: 'build_tool_failed' });
    },
    async cleanupProject(directory, context) {
      cleanupCalls++; cleanupContext = structuredClone(context);
      return GODOT4_EXECUTION_ADAPTER.cleanupProject(directory, context);
    },
  }]);
  const result = await buildProject({ root, scene: sceneId, output, tool: process.execPath, backendRegistry });
  assert.equal(result.ok, false); assert.equal(result.status, 'failed'); assert.equal(result.record.status, 'failed');
  assert.equal(cleanupCalls, 1); assert.ok(projectDirectory); assert.ok(generatedContext.generatedFiles.some(name => name.endsWith('.gd')));
  assert.deepEqual(cleanupContext, { generatedFiles: [...generatedContext.generatedFiles, ...generatedContext.resourceFiles], resourceFiles: generatedContext.resourceFiles });
  for (const relative of ['.godot', '.host', ...generatedContext.generatedFiles.filter(name => name.endsWith('.gd')).map(name => `${name}.uid`),
    ...generatedContext.resourceFiles.map(name => `${name}.import`)]) await assert.rejects(fs.lstat(path.join(projectDirectory, relative)), { code: 'ENOENT' });
  for (const relative of generatedContext.generatedFiles) assert.ok((await fs.stat(path.join(projectDirectory, relative))).isFile());
  assert.equal(await fs.readFile(path.join(projectDirectory, 'manual.gd.uid'), 'utf8'), 'retain unrelated sidecar');
  assert.equal(await fs.readFile(path.join(projectDirectory, 'manual-notes.txt'), 'utf8'), 'retain failed-build investigation');
  assert.equal(JSON.parse(await fs.readFile(path.join(result.buildDirectory, 'build.json'))).status, 'failed');
  await assert.rejects(fs.lstat(path.join(result.buildDirectory, 'backend-project.json')), { code: 'ENOENT' });
  assert.equal(buildHash(await fs.readFile(path.join(root, 'documents/scenes/demo.json'))), authorBefore);
});
