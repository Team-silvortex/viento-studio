import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT } from '../../engine/godot-scene-retry-script.mjs';
import { GODOT_ACTION_SCENE_SWITCH_SCRIPT } from '../../engine/godot-scene-navigation-scripts.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { runProjectBuildCommand } from '../project-build.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { projectSceneRetryAuthor, sceneRetryInventory } from './helpers/project-scene-retry-author-fixture.mjs';

async function settled(service) {
  for (let index = 0; index < 3000; index++) {
    const state = await service.status(); if (state.job?.status !== 'running') return state; await delay(20);
  }
  assert.fail('Scene retry build service did not settle');
}

test('saved retry source, scalar initializer and input map retain existing author and build schemas', async t => {
  const f = await projectSceneRetryAuthor(t), before = await sceneRetryInventory(f.author);
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics)); assert.equal(captured.plan.schemaVersion, 2);
  assert.equal(captured.plan.scenes[0].behaviors.schemaVersion, 1);
  assert.equal(captured.plan.scenes[0].behaviors.sources[0].content, GODOT_ACTION_SCENE_RETRY_SCRIPT);
  assert.deepEqual(captured.plan.scenes[0].behaviors.bindings[0].parameters, f.behavior.bindings[0].parameters);
  assert.deepEqual(captured.plan.inputMap.document, f.inputMap);
  assert.ok(!captured.plan.requiredCapabilities.some(cap => /retry|restart/.test(cap)));
  assert.deepEqual(await sceneRetryInventory(f.author), before);
});

test('saved retry targets and initializer errors report exact registered author parameters', async t => {
  const f = await projectSceneRetryAuthor(t);
  for (const [parameter, value, code, reason] of [
    ['target_scene_id', undefined, 'build_scene_retry_target_invalid', 'required'],
    ['target_scene_id', '33333333-3333-4333-8333-333333333339', 'build_scene_retry_target_invalid', 'member'],
    ['target_scene_id', f.sceneIds[0], 'build_scene_retry_target_invalid', 'current'],
    ['target_scene_id', f.sceneIds[1].toUpperCase(), 'build_scene_retry_target_invalid', 'uuid'],
    ['state_values_json', '{"score":0,"\\u0073core":1}', 'build_scene_retry_values_invalid', 'json'],
    ['state_values_json', '{"score":1e309}', 'build_scene_retry_values_invalid', 'value'],
    ['state_values_json', false, 'build_scene_retry_values_invalid', 'type'],
    ['action_name', '', 'build_scene_retry_parameter_invalid', 'action'],
  ]) {
    f.behavior.bindings[0].parameters = { action_name: 'retry_game', target_scene_id: f.sceneIds[1], state_values_json: '{}' };
    if (value === undefined) delete f.behavior.bindings[0].parameters[parameter]; else f.behavior.bindings[0].parameters[parameter] = value;
    await f.write('documents/behaviors/demo.json', f.behavior);
    const before = await sceneRetryInventory(f.author), captured = await captureBuildSnapshot(f.author, f.assemblyId);
    assert.equal(captured.ok, false); assert.equal(captured.plan, null);
    const row = captured.diagnostics.find(row => row.code === code); assert.ok(row, JSON.stringify(captured.diagnostics)); assert.equal(row.reason, reason);
    assert.equal(row.sceneId, f.sceneIds[0]); assert.equal(row.bindingId, f.behavior.bindings[0].bindingId); assert.equal(row.instanceId, f.behavior.bindings[0].instanceId);
    assert.equal(row.sourcePath, 'documents/behaviors/demo.json'); assert.equal(row.propertyPath, '/bindings/0/parameters/' + parameter);
    assert.equal(row.sourceRange.exact, value !== undefined);
    if (value !== undefined) {
      const content = await fs.readFile(path.join(f.author, row.sourcePath), 'utf8'); assert.equal(content.slice(row.sourceRange.start, row.sourceRange.end), JSON.stringify(value));
    }
    assert.deepEqual(await sceneRetryInventory(f.author), before);
  }
});

test('CLI and build-service retry planning reject invalid state JSON without exposing a plan', async t => {
  const f = await projectSceneRetryAuthor(t); f.behavior.bindings[0].parameters.state_values_json = '{';
  await f.write('documents/behaviors/demo.json', f.behavior); const before = await sceneRetryInventory(f.author);
  const cli = await runProjectBuildCommand(['--root', f.author, '--target', f.assemblyId]);
  assert.equal(cli.ok, false); assert.ok(cli.diagnostics.some(row => row.code === 'build_scene_retry_values_invalid'));
  const service = createProjectBuildService(f.author, { tool: '', cacheRoot: path.join(f.temporary, 'cache') }); t.after(() => service.close());
  await service.command({ action: 'plan', targetId: f.assemblyId }); const state = await settled(service);
  assert.equal(state.job.status, 'failed'); assert.equal(state.job.plan, null);
  assert.ok(state.job.diagnostics.some(row => row.code === 'build_scene_retry_values_invalid' && row.reason === 'json'));
  assert.deepEqual(await sceneRetryInventory(f.author), before);
});

test('retry preflight blocks Node and service builds before tool invocation or generated output', async t => {
  const f = await projectSceneRetryAuthor(t); f.behavior.bindings[0].parameters.target_scene_id = f.sceneIds[0];
  await f.write('documents/behaviors/demo.json', f.behavior);
  const before = await sceneRetryInventory(f.author), output = path.join(f.temporary, 'never-built'), cacheRoot = path.join(f.temporary, 'cache');
  const result = await buildProject({ root: f.author, targetId: f.assemblyId, tool: '', output });
  assert.equal(result.ok, false); assert.equal(result.status, 'rejected'); assert.ok(result.diagnostics.some(row => row.code === 'build_scene_retry_target_invalid'));
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  const service = createProjectBuildService(f.author, { tool: process.execPath, cacheRoot }); t.after(() => service.close());
  await service.command({ action: 'build', targetId: f.assemblyId }); const state = await settled(service);
  assert.equal(state.job.status, 'failed'); assert.ok(state.job.diagnostics.some(row => row.code === 'build_scene_retry_target_invalid'));
  const files = await sceneRetryInventory(cacheRoot).catch(error => { if (error.code === 'ENOENT') return {}; throw error; });
  assert.ok(!Object.keys(files).some(name => /(?:^|\/)(?:build\.json|project\.godot|snapshot\.json|backend-project\.json)$/.test(name)), Object.keys(files).join('\n'));
  assert.deepEqual(await sceneRetryInventory(f.author), before);
});

test('edited retry sources remain ordinary author code and retain raw parameters', async t => {
  const f = await projectSceneRetryAuthor(t, { edited: true }); f.behavior.bindings[0].parameters = { target_scene_id: '', state_values_json: '{' };
  await f.write('documents/behaviors/demo.json', f.behavior); const before = await sceneRetryInventory(f.author);
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics)); assert.equal(captured.plan.scenes[0].behaviors.sources[0].content, f.content);
  assert.equal(captured.plan.scenes[0].behaviors.bindings[0].parameters.state_values_json, '{');
  assert.ok(!captured.diagnostics.some(row => row.code.startsWith('build_scene_retry_'))); assert.deepEqual(await sceneRetryInventory(f.author), before);
});

test('broken retry destination retains its original scene error instead of a false foreign-member diagnostic', async t => {
  const f = await projectSceneRetryAuthor(t), original = await f.read('documents/scenes/audio.json'), broken = structuredClone(original);
  broken.viewport[0] = 0; await f.write('documents/scenes/audio.json', broken); const before = await sceneRetryInventory(f.author);
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, false); assert.equal(captured.plan, null); assert.equal(captured.diagnostics.length, 1, JSON.stringify(captured.diagnostics));
  assert.equal(captured.diagnostics[0].code, 'build_scene_value'); assert.equal(captured.diagnostics[0].objectId, f.sceneIds[1]);
  assert.ok(!captured.diagnostics.some(row => row.code.startsWith('build_scene_retry_'))); assert.deepEqual(await sceneRetryInventory(f.author), before);
  await f.write('documents/scenes/audio.json', original); const restored = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(restored.ok, true, JSON.stringify(restored.diagnostics));
});


test('existing navigation errors retain precedence when retry and ordinary navigation share an assembly', async t => {
  const f = await projectSceneRetryAuthor(t), navigationId = '76543210-1234-4234-8234-123456789abc';
  const scriptRecord = await f.read(`metadata/documents/${f.scriptId}.json`);
  await f.write('documents/scripts/ordinary-navigation.txt', GODOT_ACTION_SCENE_SWITCH_SCRIPT);
  await f.write(`metadata/documents/${navigationId}.json`, { ...scriptRecord, id: navigationId, sourcePath: 'documents/scripts/ordinary-navigation.txt' });
  const behaviorRecord = await f.read('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json');
  behaviorRecord.relations.push({ kind: 'reference', targetId: navigationId, slot: 'implementation' });
  await f.write('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', behaviorRecord);
  f.behavior.bindings[0].parameters.state_values_json = '{';
  const navigation = structuredClone(f.behavior.bindings[0]); navigation.bindingId = '76543210-1234-4234-8234-123456789abd';
  navigation.implementation.sourceObjectId = navigationId; navigation.parameters = { target_scene_id: '' };
  f.behavior.bindings.push(navigation); await f.write('documents/behaviors/demo.json', f.behavior);
  const before = await sceneRetryInventory(f.author), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, false); assert.equal(captured.plan, null);
  assert.ok(captured.diagnostics.some(row => row.code === 'build_scene_navigation_target_invalid'));
  assert.ok(!captured.diagnostics.some(row => row.code.startsWith('build_scene_retry_')));
  assert.deepEqual(await sceneRetryInventory(f.author), before);
});
