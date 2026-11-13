import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { GODOT_ACTION_SCENE_SWITCH_SCRIPT as action, GODOT_EVENT_SCENE_SWITCH_SCRIPT as event } from '../../engine/godot-scene-navigation-scripts.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { runProjectBuildCommand } from '../project-build.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
const json = value => JSON.stringify(value, null, 2) + '\n';
async function fixture(t, code = action) {
  const f = await projectAssemblyAuthor(t, { inputMap:{ format:'viento-input-map', schemaVersion:1, actions:[{ name:'start_game', keys:['Enter'] }] } });
  const read = async name => JSON.parse(await fs.readFile(path.join(f.author, name), 'utf8'));
  const write = async (name, value) => fs.writeFile(path.join(f.author, name), typeof value === 'string' ? value : json(value));
  const behavior = await read('documents/behaviors/demo.json');
  behavior.bindings.forEach(row => { row.parameters = { target_scene_id:f.sceneIds[1] }; row.events = []; });
  if (code === action) behavior.bindings[0].parameters.action_name = 'start_game';
  await write('documents/behaviors/demo.json', behavior); await write('documents/scripts/checkpoint.txt', code);
  return { ...f, read, write, behavior };
}
async function inventory(root, prefix = '') {
  const result = {};
  for (const item of await fs.readdir(path.join(root, prefix), { withFileTypes:true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) Object.assign(result, await inventory(root, name));
    else result[name] = createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex');
  }
  return result;
}
async function settled(service) {
  for (let index = 0; index < 3000; index++) { const state = await service.status(); if (state.job?.status !== 'running') return state; await delay(20); }
  assert.fail('Scene navigation service did not settle');
}

test('saved official action and event bindings retain ordinary assembly/behavior formats and exact sources', async t => {
  for (const code of [action, event]) {
    const f = await fixture(t, code), before = await inventory(f.author), captured = await captureBuildSnapshot(f.author, f.assemblyId);
    assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics)); assert.equal(captured.plan.schemaVersion, 2);
    assert.equal(captured.plan.inputMap.document.actions[0].name, 'start_game');
    assert.equal(captured.plan.scenes[0].behaviors.schemaVersion, 1);
    assert.equal(captured.plan.scenes[0].behaviors.sources[0].content, code);
    assert.equal(captured.plan.scenes[0].behaviors.bindings[0].parameters.target_scene_id, f.sceneIds[1]);
    assert.ok(!captured.plan.requiredCapabilities.some(cap => /navigation|scene-switch/.test(cap)));
    assert.deepEqual(await inventory(f.author), before);
  }
});

test('saved missing, foreign, current and uppercase targets are assembly errors with exact author locations', async t => {
  const f = await fixture(t), cases = [[undefined, 'required'], ['33333333-3333-4333-8333-333333333339', 'member'], [f.sceneIds[0], 'current'], [f.sceneIds[1].toUpperCase(), 'uuid']];
  for (const [target, reason] of cases) {
    if (target === undefined) delete f.behavior.bindings[0].parameters.target_scene_id;
    else f.behavior.bindings[0].parameters.target_scene_id = target;
    await f.write('documents/behaviors/demo.json', f.behavior);
    const before = await inventory(f.author), captured = await captureBuildSnapshot(f.author, f.assemblyId);
    assert.equal(captured.ok, false); assert.equal(captured.plan, null);
    const row = captured.diagnostics.find(row => row.code === 'build_scene_navigation_target_invalid'); assert.ok(row, JSON.stringify(captured.diagnostics));
    assert.equal(row.reason, reason); assert.equal(row.sceneId, f.sceneIds[0]); assert.equal(row.bindingId, f.behavior.bindings[0].bindingId);
    assert.equal(row.instanceId, f.behavior.bindings[0].instanceId); assert.equal(row.sourcePath, 'documents/behaviors/demo.json');
    assert.equal(row.sourceRange.exact, target !== undefined);
    const content = await fs.readFile(path.join(f.author, row.sourcePath), 'utf8'), selected = content.slice(row.sourceRange.start, row.sourceRange.end);
    assert.equal(selected, target === undefined ? JSON.stringify(f.behavior.bindings[0].parameters, null, 2).replaceAll('\n', '\n      ') : JSON.stringify(target));
    assert.deepEqual(await inventory(f.author), before);
  }
});

test('CLI and HTTP-service planning refuse invalid navigation before exposing any plan', async t => {
  const f = await fixture(t, event); f.behavior.bindings[0].parameters.target_scene_id = ''; await f.write('documents/behaviors/demo.json', f.behavior);
  const before = await inventory(f.author), cli = await runProjectBuildCommand(['--root', f.author, '--target', f.assemblyId]);
  assert.equal(cli.ok, false); assert.ok(cli.diagnostics.some(row => row.code === 'build_scene_navigation_target_invalid'));
  const service = createProjectBuildService(f.author, { tool:'', cacheRoot:path.join(f.temporary, 'cache') }); t.after(() => service.close());
  await service.command({ action:'plan', targetId:f.assemblyId }); const state = await settled(service);
  assert.equal(state.job.status, 'failed'); assert.equal(state.job.plan, null);
  assert.ok(state.job.diagnostics.some(row => row.code === 'build_scene_navigation_target_invalid' && row.reason === 'required'));
  assert.deepEqual(await inventory(f.author), before);
});

test('Node and HTTP-service build rejection precedes tool invocation and output directory creation', async t => {
  const f = await fixture(t), output = path.join(f.temporary, 'never-built'), cacheRoot = path.join(f.temporary, 'cache');
  f.behavior.bindings[0].parameters.target_scene_id = '22222222-2222-4222-8222-222222222222'; await f.write('documents/behaviors/demo.json', f.behavior);
  const before = await inventory(f.author), result = await buildProject({ root:f.author, targetId:f.assemblyId, tool:'', output });
  assert.equal(result.ok, false); assert.equal(result.status, 'rejected');
  assert.ok(result.diagnostics.some(row => row.code === 'build_scene_navigation_target_invalid'));
  await assert.rejects(fs.stat(output), { code:'ENOENT' });
  const service = createProjectBuildService(f.author, { tool:process.execPath, cacheRoot }); t.after(() => service.close());
  await service.command({ action:'build', targetId:f.assemblyId }); const state = await settled(service);
  assert.equal(state.job.status, 'failed'); assert.ok(state.job.diagnostics.some(row => row.code === 'build_scene_navigation_target_invalid'));
  const files = await inventory(cacheRoot).catch(error => { if (error.code === 'ENOENT') return {}; throw error; });
  assert.ok(!Object.keys(files).some(name => /(?:^|\/)(?:build\.json|project\.godot|snapshot\.json|backend-project\.json)$/.test(name)), Object.keys(files).join('\n'));
  assert.deepEqual(await inventory(f.author), before);
});

test('ordinary edited and legacy ready scripts retain their old target semantics', async t => {
  const f = await fixture(t); f.behavior.bindings[0].parameters.target_scene_id = '';
  await f.write('documents/behaviors/demo.json', f.behavior);
  for (const code of [action + '\n# author customization\n', listScriptStarters().find(item => item.id === 'godot-scene-switch').content]) {
    await f.write('documents/scripts/checkpoint.txt', code);
    const captured = await captureBuildSnapshot(f.author, f.assemblyId);
    assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
    assert.equal(captured.plan.scenes[0].behaviors.sources[0].content, code);
    assert.ok(!captured.diagnostics.some(row => row.code.startsWith('build_scene_navigation_')));
  }
});

test('invalid saved action/event parameters are located and blocking, not silently converted', async t => {
  for (const [code, values, reason] of [[action, { action_name:false }, 'action'], [event, { event_name:'constructor' }, 'event'], [event, { payload_filter:'界'.repeat(1366) }, 'filter']]) {
    const f = await fixture(t, code); Object.assign(f.behavior.bindings[0].parameters, values); await f.write('documents/behaviors/demo.json', f.behavior);
    const captured = await captureBuildSnapshot(f.author, f.assemblyId), row = captured.diagnostics.find(row => row.code === 'build_scene_navigation_parameter_invalid');
    assert.equal(captured.ok, false); assert.ok(row, JSON.stringify(captured.diagnostics)); assert.equal(row.reason, reason); assert.equal(row.sourceRange.exact, true);
    const content = await fs.readFile(path.join(f.author, row.sourcePath), 'utf8');
    assert.equal(content.slice(row.sourceRange.start, row.sourceRange.end), JSON.stringify(Object.values(values)[0]));
  }
});


test('a broken target scene reports its real model error without misdiagnosing a legal navigation member', async t => {
  const f = await fixture(t), baseline = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(baseline.ok, true, JSON.stringify(baseline.diagnostics));
  const original = await f.read('documents/scenes/audio.json'), broken = structuredClone(original);
  broken.viewport[0] = 0; await f.write('documents/scenes/audio.json', broken);
  const before = await inventory(f.author), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, false); assert.equal(captured.plan, null);
  assert.ok((await f.read('documents/projects/demo.json')).sceneIds.includes(f.behavior.bindings[0].parameters.target_scene_id));
  assert.equal(captured.diagnostics.length, 1, JSON.stringify(captured.diagnostics));
  assert.equal(captured.diagnostics[0].code, 'build_scene_value');
  assert.equal(captured.diagnostics[0].objectId, f.sceneIds[1]); assert.equal(captured.diagnostics[0].propertyPath, '/viewport');
  assert.equal(captured.diagnostics.some(row => row.code.startsWith('build_scene_navigation_')), false);
  assert.deepEqual(await inventory(f.author), before);

  await f.write('documents/scenes/audio.json', original);
  f.behavior.bindings[0].parameters.target_scene_id = '22222222-2222-4222-8222-222222222222';
  await f.write('documents/behaviors/demo.json', f.behavior);
  const restoredBefore = await inventory(f.author), invalidTarget = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(invalidTarget.ok, false); assert.equal(invalidTarget.plan, null);
  assert.ok(invalidTarget.diagnostics.some(row => row.code === 'build_scene_navigation_target_invalid' && row.reason === 'member'));
  assert.deepEqual(await inventory(f.author), restoredBefore);
});
