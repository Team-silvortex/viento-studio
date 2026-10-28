import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { GODOT_CHARACTER_INTENT_SCRIPT } from '../../engine/godot-character-intent-script.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';
import { inspectProjectInputActionReferences } from '../../engine/project-input-action-diagnostics.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { runProjectBuildCommand } from '../project-build.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';

const map = { format: 'viento-input-map', schemaVersion: 1, actions: [{ name: 'mapped_left', keys: ['KeyA'] }] };
const json = value => JSON.stringify(value, null, 2) + '\n';
const secondBehaviorId = '44334433-4433-4433-8433-443344334433';
async function fixture(t, withMap = true) {
  const f = await projectAssemblyAuthor(t, { inputMap: withMap ? map : null });
  const read = async name => JSON.parse(await fs.readFile(path.join(f.author, name), 'utf8'));
  const write = async (name, value) => fs.writeFile(path.join(f.author, name), typeof value === 'string' ? value : json(value));
  const binding = await read('documents/behaviors/demo.json');
  binding.bindings[0].parameters = { left_action: 'mapped_left', right_action: 'missing_right', jump_action: 'ui_filedialog_refresh' };
  binding.bindings[1].parameters = { left_action: 'runtime_registered' };
  binding.bindings.forEach(row => { row.events = []; });
  await write('documents/behaviors/demo.json', binding);
  await write('documents/scripts/checkpoint.txt', GODOT_CHARACTER_INTENT_SCRIPT);
  const second = structuredClone(binding); second.sceneObjectId = f.sceneIds[1];
  second.bindings[0].parameters = {}; second.bindings[1].parameters = { jump_action: 'missing_jump' };
  await write('documents/behaviors/second.json', second);
  const record = await read('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json');
  record.id = secondBehaviorId; record.sourcePath = 'documents/behaviors/second.json'; record.relations[0].targetId = f.sceneIds[1];
  await write(`metadata/documents/${secondBehaviorId}.json`, record);
  const sceneRecord = await read(`metadata/documents/${f.sceneIds[1]}.json`);
  sceneRecord.relations.push({ kind: 'behavior', targetId: secondBehaviorId, slot: 'instance behaviors' });
  await write(`metadata/documents/${f.sceneIds[1]}.json`, sceneRecord);
  return { ...f, read, write };
}
async function settled(service) {
  for (let i = 0; i < 4000; i++) { const status = await service.status(); if (status.job?.status !== 'running') return status; await delay(20); }
  assert.fail('Timed out waiting for plan');
}

test('official template defaults are unchanged; v2 suggestions include each scene and instance with exact source locations', async t => {
  assert.equal(listScriptStarters().find(item => item.id === 'godot-character-intent').content, GODOT_CHARACTER_INTENT_SCRIPT);
  const f = await fixture(t), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.equal(captured.plan.schemaVersion, 2);
  const rows = captured.diagnostics;
  assert.equal(rows.length, 3, JSON.stringify(rows));
  assert.ok(rows.every(row => row.code === 'build_input_action_unmapped' && row.severity === 'warning'));
  assert.deepEqual(rows.map(row => [row.sceneId, row.instanceId, row.parameter]), [
    [f.sceneIds[0], 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'right_action'],
    [f.sceneIds[0], 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'left_action'],
    [f.sceneIds[1], 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'jump_action'],
  ]);
  for (const row of rows) {
    const content = await fs.readFile(path.join(f.author, row.sourcePath), 'utf8');
    assert.equal(row.sourceRange.exact, true);
    assert.match(content.slice(row.sourceRange.start, row.sourceRange.end), /^"(?:missing_right|runtime_registered|missing_jump)"$/);
  }

});

test('custom script sources are not inferred; ui_ actions remain conservative', () => {
  const behavior = { backendId: 'org.viento.godot4', language: 'gdscript', manifest: { objectId:'m', sourcePath:'d.json', sourceRevision:'r' },
    sources: [{ objectId:'s', content:GODOT_CHARACTER_INTENT_SCRIPT + '\n# edited' }],
    bindings: [{ instanceId:'i', bindingId:'b', parameters:{ left_action:'unregistered' }, implementation:{ sourceObjectId:'s' } }] };
  const scenes = [{ scene:{objectId:'scene'}, behaviors:behavior }];
  assert.deepEqual(inspectProjectInputActionReferences(scenes, map, []), []);
  behavior.sources[0].content = GODOT_CHARACTER_INTENT_SCRIPT;
  behavior.bindings[0].parameters = {left_action:'ui_unknown_future_action', right_action:'ui_up', jump_action:'ui_accept'};
  assert.deepEqual(inspectProjectInputActionReferences(scenes, map, []), []);
  behavior.bindings[0].parameters.left_action = '';
  assert.equal(inspectProjectInputActionReferences(scenes, map, [])[0].severity, 'warning');
});

test('CLI and service surface warnings while keeping plan successful; unsupported backend still fails', async t => {
  const f = await fixture(t);
  for (const backend of [undefined, 'org.viento.godot4']) {
    const result = await runProjectBuildCommand(['--root', f.author, '--target', f.assemblyId, ...(backend ? ['--backend', backend] : [])]);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics)); assert.equal(result.diagnostics.length, 3);
  }
  const rejected = await runProjectBuildCommand(['--root', f.author, '--target', f.assemblyId, '--backend', 'org.viento.bevy']);
  assert.equal(rejected.ok, false); assert.ok(rejected.diagnostics.some(row => row.code === 'build_backend_plan_unsupported'));
  assert.ok(rejected.diagnostics.some(row => row.severity === 'warning'));
  const service = createProjectBuildService(f.author, { tool: '', cacheRoot: path.join(f.temporary, 'cache') }); t.after(() => service.close());
  await service.command({ action:'plan', targetId:f.assemblyId }); const state = await settled(service);
  assert.equal(state.job.status, 'succeeded'); assert.equal(state.job.diagnostics.length, 3);
  assert.ok(state.job.plan.snapshotId);
});

test('a non-blocking suggestion does not prevent real Godot build', { skip: !process.env.VIENTO_GODOT_BIN && 'Set VIENTO_GODOT_BIN for Godot build' }, async t => {
  const f = await fixture(t);
  const result = await buildProject({ root:f.author, targetId:f.assemblyId, tool:process.env.VIENTO_GODOT_BIN,
    output:path.join(f.temporary, 'built'), timeoutMs:60000 });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics || result.record?.diagnostics));
});


for (const warningCount of [256, 288]) test(`service preserves backend errors and exact omitted count with ${warningCount} input warnings`, async t => {
  const f = await fixture(t);
  const extraSceneId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccd';
  const extraBehaviorId = '44334433-4433-4433-8433-443344334434';
  const firstScene = await f.read('documents/scenes/demo.json');
  const firstSceneRecord = await f.read(`metadata/documents/${f.sceneIds[0]}.json`);
  const firstBehavior = await f.read('documents/behaviors/demo.json');
  const firstBehaviorRecord = await f.read('metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json');
  await f.write('documents/scenes/third.json', { ...firstScene, title:'Third scene' });
  await f.write(`metadata/documents/${extraSceneId}.json`, { ...firstSceneRecord, id:extraSceneId, sourcePath:'documents/scenes/third.json',
    relations:firstSceneRecord.relations.map(item => item.kind === 'behavior' ? { ...item, targetId:extraBehaviorId } : item) });
  await f.write(`metadata/documents/${extraBehaviorId}.json`, { ...firstBehaviorRecord, id:extraBehaviorId, sourcePath:'documents/behaviors/third.json',
    relations:firstBehaviorRecord.relations.map((item, index) => index === 0 ? { ...item, targetId:extraSceneId } : item) });
  const makeBindings = count => Array.from({ length:count }, (_, index) => ({ ...firstBehavior.bindings[0],
    bindingId:`12345678-1234-4234-8234-${String(index + 1).padStart(12, '0')}`,
    parameters:count === 22 && index === 21 ? {left_action:'missing_left'} : {left_action:'missing_left',right_action:'missing_right',jump_action:'missing_jump'}, events:[] }));
  for (const [sceneId, file] of [[f.sceneIds[0], 'documents/behaviors/demo.json'], [f.sceneIds[1], 'documents/behaviors/second.json'], [extraSceneId, 'documents/behaviors/third.json']]) {
    await f.write(file, { ...firstBehavior, sceneObjectId:sceneId, bindings:makeBindings(sceneId === extraSceneId && warningCount === 256 ? 22 : 32) });
  }
  const assembly = await f.read('documents/projects/demo.json'); assembly.sceneIds.push(extraSceneId); await f.write('documents/projects/demo.json', assembly);
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.equal(captured.diagnostics.length, 256);
  assert.equal(captured.diagnostics.at(-1).code, warningCount === 288 ? 'build_input_action_unmapped_limit' : 'build_input_action_unmapped');
  const service = createProjectBuildService(f.author, { backendId:'org.viento.bevy', tool:'', cacheRoot:path.join(f.temporary, 'cache') });
  t.after(() => service.close());
  await service.command({ action:'plan', targetId:f.assemblyId }); const state = await settled(service);
  assert.equal(state.job.status, 'failed'); assert.equal(state.job.diagnostics.length, 256);
  assert.ok(state.job.diagnostics.some(row => row.severity === 'error' && row.code === 'build_backend_plan_unsupported'), JSON.stringify(state.job.diagnostics.slice(0, 3)));
  const marker = state.job.diagnostics.find(row => row.code === 'build_input_action_unmapped_limit');
  assert.ok(marker);
  const kept = state.job.diagnostics.filter(row => row.code === 'build_input_action_unmapped').length;
  assert.ok(kept > 0); assert.equal(marker.omittedCount, warningCount - kept);
});
