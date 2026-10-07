import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { runBuildProcess } from '../lib/build-process.mjs';
import { createScene2DPlan, checkBuildCapabilities } from '../../engine/build-plan.mjs';
import { resolveSceneBehaviors } from '../../engine/scene-behaviors.mjs';
import { inspectObjectProjection, renderProjectionRuntime, validateProjectionDependencies } from '../../engine/object-projection.mjs';
import { sceneActorIdentity } from '../../engine/scene-identity.mjs';
import { validateSceneGroups } from '../../engine/scene-groups.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { runProjectBuildCommand } from '../project-build.mjs';

const example = fileURLToPath(new URL('../../examples/scene2d/', import.meta.url));
const scene = 'documents/scenes/demo.json';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const imageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const godot = process.env.VIENTO_GODOT_BIN;
const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-build-test-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'workspace');
  await fs.cp(example, root, { recursive: true });
  return { temporary, root };
}

async function tree(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name);
    result[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return result;
}

test('scene build: deterministic, movable, frozen bytes; portable planner has no host globals', async t => {
  const { root, temporary } = await fixture(t);
  const before = await tree(root);
  const captured = await captureBuildSnapshot(root, scene);
  assert.equal(captured.ok, true);
  const copied = path.join(temporary, 'moved'); await fs.cp(root, copied, { recursive: true });
  assert.equal((await captureBuildSnapshot(copied, sceneId)).snapshotId, captured.snapshotId);
  assert.deepEqual(await runProjectBuildCommand(['--root', root, '--scene', scene]), {
    ok: true, plan: captured.plan, snapshotId: captured.snapshotId, diagnostics: [],
  });
  const modelSource = await fs.readFile(new URL('../../engine/scene-model.mjs', import.meta.url), 'utf8');
  const resolveScene2DModel = vm.runInNewContext(`${modelSource.replace(/^import .*\n/gm, '').replaceAll('export ', '')}\nresolveScene2DModel`,
    { inspectObjectProjection, renderProjectionRuntime, validateProjectionDependencies, parseJsonSource, locateJsonSource, sceneActorIdentity, validateSceneGroups });
  const source = await fs.readFile(new URL('../../engine/build-plan.mjs', import.meta.url), 'utf8');
  const portable = vm.runInNewContext(`${source.replace(/^import .*\n/gm, '').replace(/^export \{.*\} from .*\n/gm, '').replaceAll('export ', '')}\ncreateScene2DPlan`,
    { resolveScene2DModel, resolveSceneBehaviors });
  const observed = await readWorldSnapshot(root);
  assert.deepEqual(JSON.parse(JSON.stringify(portable(observed, scene))), createScene2DPlan(observed, scene));
  assert.deepEqual(checkBuildCapabilities(captured.plan, { capabilities: [] }).map(item => item.capability), captured.plan.requiredCapabilities);
  assert.deepEqual(await tree(root), before);
  await fs.writeFile(path.join(root, 'assets/traveler.svg'), 'changed after capture');
  assert.equal(buildHash(captured.resources.get(imageId)), captured.plan.resources[0].sha256, 'frozen bytes survive external changes');
  const changed = await captureBuildSnapshot(root, scene);
  assert.equal(changed.ok, false); assert.equal(changed.diagnostics[0].code, 'build_resource_changed');
  assert.equal(changed.diagnostics[0].propertyPath, '/actors/0/imageResourceId');
});

test('scene build: rejects unknown features, missing references, invalid values and unbound resources at source fields', async t => {
  const { root } = await fixture(t);
  const original = JSON.parse(await fs.readFile(path.join(root, scene)));
  for (const [mutate, code, pointer] of [
    [value => { value.actors[0].behavior = 'arbitrary.nuis'; }, 'build_feature_unsupported', '/actors/0/behavior'],
    [value => { value.actors[0].objectId = '../../escape'; }, 'build_actor_missing', '/actors/0/objectId'],
    [value => { value.actors.push(value.actors[0]); }, 'build_actor_duplicate', '/actors/1/objectId'],
    [value => { value.actors[0].position[0] = 'NaN'; }, 'build_actor_value', '/actors/0/position'],
    [value => { value.actors[0].imageResourceId = actorId; }, 'build_image_unsupported', '/actors/0/imageResourceId'],
  ]) {
    const value = structuredClone(original); mutate(value); await writeJson(path.join(root, scene), value);
    const result = await captureBuildSnapshot(root, scene);
    assert.equal(result.ok, false); assert.ok(result.diagnostics.some(item => item.code === code && item.propertyPath === pointer && item.objectId === sceneId));
  }
  await writeJson(path.join(root, scene), original);
  const recordFile = path.join(root, `metadata/documents/${actorId}.json`);
  const record = JSON.parse(await fs.readFile(recordFile)); record.assetBindings = [];
  await writeJson(recordFile, record);
  assert.equal((await captureBuildSnapshot(root, scene)).diagnostics[0].code, 'build_image_unbound');
});

test('scene snapshot rejects links, missing images and unfinished source transactions without writes', async t => {
  const { root, temporary } = await fixture(t);
  await fs.rename(path.join(root, 'assets'), path.join(temporary, 'outside-assets'));
  const missing = await captureBuildSnapshot(root, scene);
  assert.equal(missing.ok, false); assert.equal(missing.diagnostics[0].resourceId, imageId);
  await fs.symlink(path.join(temporary, 'outside-assets'), path.join(root, 'assets'), 'dir');
  assert.equal((await captureBuildSnapshot(root, scene)).ok, false);
  await fs.unlink(path.join(root, 'assets'));
  // A deliberate local store binding is supported; a linked default store is not.
  await fs.mkdir(path.join(root, '.viento'), { recursive: true });
  await writeJson(path.join(root, '.viento/local.json'), { version: 1, assetStores: { main: path.join(temporary, 'outside-assets') } });
  assert.equal((await captureBuildSnapshot(root, scene)).ok, true);
  await fs.mkdir(path.join(root, '.viento/world-transactions/active'), { recursive: true });
  const before = await tree(root);
  await assert.rejects(captureBuildSnapshot(root, scene), { errorCode: 'world_recovery_required' });
  assert.deepEqual(await tree(root), before);
});

test('scene snapshot detects an author edit during image capture', async t => {
  const { root } = await fixture(t);
  const open = fs.open;
  let changed = false;
  fs.open = async (file, ...args) => {
    if (String(file) === path.join(root, 'assets/traveler.svg') && !changed) {
      changed = true;
      await fs.appendFile(path.join(root, 'documents/characters/traveler.md'), '\n外部编辑\n');
    }
    return open(file, ...args);
  };
  try { await assert.rejects(captureBuildSnapshot(root, scene), { errorCode: 'build_input_changed' }); }
  finally { fs.open = open; }
  assert.equal(changed, true);
});

test('process lifecycle: missing tool, nonzero exit, bounded logs, timeout, cancellation and descendant cleanup', async t => {
  const { temporary } = await fixture(t);
  assert.equal((await runBuildProcess(path.join(temporary, 'absent'), [], { cwd: temporary })).status, 'unavailable');
  assert.equal((await runBuildProcess(process.execPath, ['-e', 'process.exit(7)'], { cwd: temporary })).exitCode, 7);
  const noisy = await runBuildProcess(process.execPath, ['-e', 'setInterval(()=>process.stdout.write("x".repeat(10000)),1)'], { cwd: temporary, maxOutputBytes: 1024 });
  assert.equal(noisy.status, 'output-limit'); assert.equal(noisy.stdout.length, 1024);
  const controller = new AbortController();
  const cancelled = runBuildProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: temporary, signal: controller.signal });
  controller.abort(); assert.equal((await cancelled).status, 'cancelled');
  const descendant = `const{spawn}=require('node:child_process');const p=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'inherit'});console.log(p.pid);process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
  const timed = await runBuildProcess(process.execPath, ['-e', descendant], { cwd: temporary, timeoutMs: 200 });
  assert.equal(timed.status, 'timeout');
  if (process.platform === 'linux') {
    const pid = Number(timed.stdout.trim()); assert.ok(pid > 0);
    try { assert.match(await fs.readFile(`/proc/${pid}/stat`, 'utf8'), /^\d+ \(.+\) Z /, 'a descendant must be dead, possibly waiting for init to reap it'); }
    // The kernel can reap it between opening /proc/<pid>/stat and reading it.
    catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
  }
});

test('build request validation and a missing engine never create an output or modify source', async t => {
  const { root, temporary } = await fixture(t);
  const before = await tree(root), output = path.join(temporary, 'absent-build');
  const result = await buildProject({ root, scene, output, godot: path.join(temporary, 'missing') });
  assert.equal(result.ok, false); assert.equal(result.diagnostics[0].code, 'build_tool_unavailable');
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  await assert.rejects(runProjectBuildCommand(['--root', root, '--scene', scene, '--timeout-ms', '-1']));
  await assert.rejects(runProjectBuildCommand(['--root', root, '--scene', scene, '--command', 'deploy']));
  assert.deepEqual(await tree(root), before);
});

test('real Godot: build/import, cold run from frozen input, movement states, safeguards and failure cleanup', {
  skip: !godot && 'Set VIENTO_GODOT_BIN to run the real Godot integration', timeout: 120000,
}, async t => {
  const { root, temporary } = await fixture(t);
  const before = await tree(root), output = path.join(temporary, 'build');
  const built = await buildProject({ root, scene, godot, output });
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.record.artifact.kind, 'godot-project');
  assert.equal(built.record.artifact.requiresTool, true);
  assert.deepEqual(await tree(root), before);
  // After capture, source can disappear entirely; run owns only generated data.
  await fs.rename(root, `${root}-offline`);
  const run = await runProjectBuild({ buildDirectory: output, godot });
  assert.equal(run.ok, true, JSON.stringify(run));
  assert.deepEqual(run.record.events.filter(item => item.event === 'state').map(item => item.state), ['moving', 'idle']);
  assert.deepEqual(run.record.events.find(item => item.event === 'finished').actors[0], { objectId: actorId, position: [240, 220], state: 'idle' });
  assert.deepEqual(await tree(`${root}-offline`), before);
  await assert.rejects(fs.stat(path.join(run.sessionDirectory, 'project')), { code: 'ENOENT' });
  await fs.rename(`${root}-offline`, root);
  for (const requested of [path.join(root, 'generated'), path.join(root, 'assets/generated'), output]) {
    const rejected = await buildProject({ root, scene, godot, output: requested });
    assert.equal(rejected.ok, false); assert.match(rejected.diagnostics[0].code, /^build_output_/);
  }
  const controller = new AbortController();
  const pending = runProjectBuild({ buildDirectory: output, godot, smoke: false, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 6000);
  const cancelled = await pending; clearTimeout(timer);
  assert.equal(cancelled.status, 'cancelled', JSON.stringify(cancelled));
  assert.ok(cancelled.record.events.some(item => item.event === 'ready'), 'cancel after the real runtime starts');
  if (cancelled.sessionDirectory) await assert.rejects(fs.stat(path.join(cancelled.sessionDirectory, 'project')), { code: 'ENOENT' });
  const timeout = await runProjectBuild({ buildDirectory: output, godot, smoke: false, timeoutMs: 6000 });
  assert.equal(timeout.status, 'timeout', JSON.stringify(timeout));
  assert.ok(timeout.record.events.some(item => item.event === 'ready'), 'timeout after the real runtime starts');
  await assert.rejects(fs.stat(path.join(timeout.sessionDirectory, 'project')), { code: 'ENOENT' });
  await fs.appendFile(path.join(output, 'project/runtime.gd'), '\n# altered\n');
  const altered = await runProjectBuild({ buildDirectory: output, godot });
  assert.equal(altered.ok, false); assert.equal(altered.diagnostics[0].code, 'runtime_artifact_changed');
  // Validly registered but undecodable image: hash validation passes, actual
  // Godot import must still fail and the diagnostic must retain resource ID.
  await fs.writeFile(path.join(root, 'assets/traveler.svg'), '<svg broken');
  const resourceFile = path.join(root, `metadata/assets/${imageId}.json`);
  const resource = JSON.parse(await fs.readFile(resourceFile));
  resource.content = { size: 11, sha256: buildHash('<svg broken') }; await writeJson(resourceFile, resource);
  const broken = await buildProject({ root, scene, godot, output: path.join(temporary, 'broken') });
  assert.equal(broken.ok, false, JSON.stringify(broken));
  assert.ok(broken.record.diagnostics.some(item => item.resourceId === imageId));
  await assert.rejects(fs.stat(path.join(broken.buildDirectory, 'project/.godot')), { code: 'ENOENT' });
});
