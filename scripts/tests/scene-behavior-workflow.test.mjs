import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureBuildSnapshot, captureScenePreviewSnapshot, captureSceneDraftPreview, buildHash } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { createScene2DPlan } from '../../engine/build-plan.mjs';
import { checkExecutionBackendSupport } from '../../engine/backend-capabilities.mjs';
import { canonicalJson } from '../../engine/canonical-json.mjs';
import { runProjectBuildCommand } from '../project-build.mjs';

const example = fileURLToPath(new URL('../../examples/scene-behaviors/', import.meta.url));
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const manifestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const scriptId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const scenePath = 'documents/scenes/demo.json';
const manifestPath = 'documents/behaviors/demo.json';
const scriptPath = 'documents/scripts/checkpoint.txt';
const godot = process.env.VIENTO_GODOT_BIN;
const real = { skip: !godot && 'Set VIENTO_GODOT_BIN for real behavior integration', timeout: 120000 };
const write = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-behavior-workflow-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'workspace'); await fs.cp(example, root, { recursive: true });
  return { root, temporary };
}
async function tree(root) {
  const hashes = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name);
    hashes[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return hashes;
}
const errors = result => result.record?.diagnostics || result.diagnostics || [];

test('saved behavior planning freezes registered text and independent instance parameters; CLI is read only', async t => {
  const { root, temporary } = await fixture(t), before = await tree(root);
  const captured = await captureBuildSnapshot(root, sceneId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.equal(captured.plan.schemaVersion, 3);
  assert.deepEqual(captured.plan.requiredCapabilities.slice(-2), ['behavior.bindings', 'behavior.gdscript']);
  assert.equal(captured.plan.behaviors.sources.length, 1); assert.equal(captured.plan.behaviors.bindings.length, 2);
  assert.equal(captured.plan.behaviors.sources[0].content, await fs.readFile(path.join(root, scriptPath), 'utf8'));
  assert.deepEqual(captured.plan.behaviors.bindings.map(binding => binding.parameters), [
    { checkpoint: 'east', amount: 40 }, { checkpoint: 'west', amount: 20 }]);
  const observed = await readWorldSnapshot(root);
  assert.deepEqual(createScene2DPlan(observed, sceneId).plan, captured.plan);
  assert.ok(observed.projection.objects.every(object => object.behaviorBindings.length === 0), 'World v1 contract remains unchanged');
  assert.deepEqual(await runProjectBuildCommand(['--root', root, '--scene', sceneId]), {
    ok: true, plan: captured.plan, snapshotId: captured.snapshotId, diagnostics: [] });
  const moved = path.join(temporary, 'moved'); await fs.cp(root, moved, { recursive: true });
  assert.equal((await captureBuildSnapshot(moved, sceneId)).snapshotId, captured.snapshotId);
  assert.deepEqual(await tree(root), before);
});

test('registered behavior bindings require explicit scene opt-in; static previews never acquire execution sources', async t => {
  const { root } = await fixture(t);
  const saved = await captureBuildSnapshot(root, sceneId), preview = await captureScenePreviewSnapshot(root, sceneId);
  assert.equal(saved.plan.schemaVersion, 3); assert.equal(preview.plan.schemaVersion, 2);
  assert.equal(Object.hasOwn(preview.plan, 'behaviors'), false);
  const recordFile = path.join(root, `metadata/documents/${sceneId}.json`), record = JSON.parse(await fs.readFile(recordFile));
  record.relations = record.relations.filter(relation => relation.kind !== 'behavior'); await write(recordFile, record);
  const unbound = await captureBuildSnapshot(root, sceneId);
  assert.equal(unbound.ok, true); assert.equal(unbound.plan.schemaVersion, 2); assert.equal(Object.hasOwn(unbound.plan, 'behaviors'), false);
});

test('draft preview remains separate when saved behavior inputs are invalid or unfinished', async t => {
  const { root } = await fixture(t);
  const original = await fs.readFile(path.join(root, scenePath), 'utf8');
  const observed = await readWorldSnapshot(root), revision = observed.source.documents.find(doc => doc.record?.id === sceneId).sourceRevision;
  const manifest = JSON.parse(await fs.readFile(path.join(root, manifestPath))); manifest.bindings[0].instanceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9';
  await write(path.join(root, manifestPath), manifest);
  assert.equal((await captureBuildSnapshot(root, sceneId)).ok, false);
  const preview = await captureScenePreviewSnapshot(root, sceneId); assert.equal(preview.ok, true); assert.equal(preview.plan.schemaVersion, 2);
  const draft = await captureSceneDraftPreview(root, sceneId, { sourcePath: scenePath, content: original, baseSourceRevision: revision });
  assert.equal(draft.ok, true); assert.equal(draft.plan.schemaVersion, 2); assert.equal(Object.hasOwn(draft, 'snapshot'), false);
});

test('editing only behavior source invalidates approved saved input before engine probing or output allocation', async t => {
  const { root, temporary } = await fixture(t), captured = await captureBuildSnapshot(root, sceneId);
  await fs.appendFile(path.join(root, scriptPath), '\n# external script edit\n');
  const changed = await captureBuildSnapshot(root, sceneId); assert.notEqual(changed.snapshotId, captured.snapshotId);
  const output = path.join(temporary, 'must-not-exist');
  const result = await buildProject({ root, scene: sceneId, tool: process.execPath, output, expectedSnapshotId: captured.snapshotId });
  assert.equal(result.ok, false); assert.equal(errors(result)[0].code, 'build_snapshot_changed');
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
});

test('behavior plan schema, language capabilities and declared backend identity are separate middleware gates', async t => {
  const { root } = await fixture(t), { plan } = await captureBuildSnapshot(root, sceneId);
  const descriptor = { format: 'viento-execution-backend', schemaVersion: 1, id: 'org.viento.fixture', label: 'Fixture', version: '1.0.0',
    platforms: ['linux'], plans: [{ kind: 'scene2d', schemaVersion: 3, runtimeProtocolVersion: 3 }],
    capabilities: [...plan.requiredCapabilities], execution: { build: true, headlessLogic: false, windowPreview: false, windowCapture: false,
      offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] };
  assert.deepEqual(checkExecutionBackendSupport(descriptor, { operation: 'build', plan }).map(item => item.code), ['build_behavior_backend_unsupported']);
  const missing = { ...descriptor, id: plan.behaviors.backendId, capabilities: plan.requiredCapabilities.filter(name => name !== 'behavior.gdscript') };
  assert.equal(checkExecutionBackendSupport(missing, { operation: 'build', plan })[0].capability, 'behavior.gdscript');
  assert.deepEqual(checkExecutionBackendSupport({ ...missing, capabilities: plan.requiredCapabilities }, { operation: 'build', plan }), []);
});

test('host plan summary exposes behavior counts while transport keeps backend/tool selection host-only', async t => {
  const { root, temporary } = await fixture(t);
  const service = createProjectBuildService(root, { tool: process.execPath, cacheRoot: path.join(temporary, 'cache') }); t.after(() => service.close());
  await service.command({ action: 'plan', sceneId });
  for (let attempt = 0; attempt < 500; attempt++) {
    const state = await service.status();
    if (state.job?.status !== 'running') {
      assert.equal(state.job.status, 'succeeded', JSON.stringify(state));
      assert.equal(state.job.plan.behaviorBindingCount, 2); assert.equal(state.job.plan.behaviorSourceCount, 1);
      break;
    }
    if (attempt === 499) assert.fail('plan did not complete');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await assert.rejects(service.command({ action: 'build', sceneId, backendId: 'org.viento.other' }), { errorCode: 'build_request_invalid' });
});

test('real Godot behavior workflow preserves author bytes, replays offline and owns per-instance event identity', real, async t => {
  const { root, temporary } = await fixture(t), before = await tree(root), output = path.join(temporary, 'build');
  const built = await buildProject({ root, scene: sceneId, godot, output }); assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.record.backend.protocolVersion, 3);
  assert.deepEqual(await fs.readFile(path.join(output, 'project/behaviors', `${scriptId}.gd`)), await fs.readFile(path.join(root, scriptPath)));
  assert.deepEqual(await tree(root), before);
  await fs.rename(root, root + '-offline');
  const run = await runProjectBuild({ buildDirectory: output, godot }); assert.equal(run.ok, true, JSON.stringify(run));
  assert.deepEqual(run.record.events.map(frame => frame.event), ['ready', 'behavior', 'behavior', 'finished']);
  const events = run.record.events.filter(frame => frame.event === 'behavior');
  assert.deepEqual(events.map(frame => frame.arguments), [['east', 40], ['west', 20]]);
  assert.notEqual(events[0].bindingId, events[1].bindingId); assert.notEqual(events[0].instanceId, events[1].instanceId);
  assert.equal(events[0].objectId, events[1].objectId); assert.ok(events.every(frame => frame.protocol === 3 && frame.name === 'checkpoint'));
  await assert.rejects(fs.stat(path.join(run.sessionDirectory, 'project')), { code: 'ENOENT' });
  assert.deepEqual(await tree(root + '-offline'), before);
  const snapshot = JSON.parse(await fs.readFile(path.join(output, 'snapshot.json'))), record = JSON.parse(await fs.readFile(path.join(output, 'build.json')));
  snapshot.plan.behaviors.sources[0].content += '\n# forged source\n';
  record.snapshotId = `sha256:${buildHash(canonicalJson(snapshot))}`;
  await write(path.join(output, 'snapshot.json'), snapshot); await write(path.join(output, 'build.json'), record);
  const forged = await runProjectBuild({ buildDirectory: output, godot }); assert.equal(forged.ok, false); assert.equal(errors(forged)[0].code, 'runtime_build_invalid');
});

test('real Godot exported parameter failures locate the binding field without accepting Node properties', real, async t => {
  const { root, temporary } = await fixture(t), manifestFile = path.join(root, manifestPath), original = JSON.parse(await fs.readFile(manifestFile));
  for (const [parameter, value] of [['amount', 'wrong float'], ['name', 'unexported Node property']]) {
    const manifest = structuredClone(original); manifest.bindings[0].parameters[parameter] = value; await write(manifestFile, manifest);
    const before = await tree(root), output = path.join(temporary, 'build-' + parameter);
    const built = await buildProject({ root, scene: sceneId, godot, output }); assert.equal(built.ok, true, JSON.stringify(built));
    const run = await runProjectBuild({ buildDirectory: output, godot }); assert.equal(run.ok, false, JSON.stringify(run));
    const atParameter = errors(run).find(item => item.objectId === manifestId && item.sourcePath === manifestPath
      && item.propertyPath === '/bindings/0/parameters/' + parameter);
    assert.ok(atParameter, JSON.stringify(errors(run))); assert.equal(atParameter.sourceRange?.exact, true);
    assert.equal(JSON.parse((await fs.readFile(manifestFile, 'utf8')).slice(atParameter.sourceRange.start, atParameter.sourceRange.end)), value);
    assert.deepEqual(await tree(root), before);
    await assert.rejects(fs.stat(path.join(run.sessionDirectory, 'project')), { code: 'ENOENT' });
  }
});

test('real Godot script compile failures locate the registered text source and preserve the failed build record', real, async t => {
  const { root, temporary } = await fixture(t);
  await fs.appendFile(path.join(root, scriptPath), '\nfunc incomplete(\n');
  const before = await tree(root), result = await buildProject({ root, scene: sceneId, godot, output: path.join(temporary, 'bad-script') });
  assert.equal(result.ok, false); assert.equal(result.status, 'failed');
  assert.ok(errors(result).some(item => item.objectId === scriptId && item.sourcePath === scriptPath), JSON.stringify(errors(result)));
  assert.deepEqual(await tree(root), before); assert.ok(result.record.phases.length > 0);
});

test('real Godot behavior sessions retain cancellation ownership after both initial events', real, async t => {
  const { root, temporary } = await fixture(t), before = await tree(root), output = path.join(temporary, 'cancel');
  const built = await buildProject({ root, scene: sceneId, godot, output }); assert.equal(built.ok, true, JSON.stringify(built));
  const controller = new AbortController(); let emitted = 0;
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const run = await runProjectBuild({ buildDirectory: output, godot, smoke: false, signal: controller.signal,
      onProgress: event => { if (event.event?.event === 'behavior' && ++emitted === 2) controller.abort(); } });
    assert.equal(emitted, 2); assert.equal(run.status, 'cancelled', JSON.stringify(run));
    await assert.rejects(fs.stat(path.join(run.sessionDirectory, 'project')), { code: 'ENOENT' });
    assert.deepEqual(await tree(root), before);
  } finally { clearTimeout(timer); }
});
