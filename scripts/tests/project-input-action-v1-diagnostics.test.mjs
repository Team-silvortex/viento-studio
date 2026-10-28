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

test('legacy project v1 reports custom actions as warnings and keeps plans successful', async t => {
  const v1 = await fixture(t, false); const old = await captureBuildSnapshot(v1.author, v1.assemblyId);
  assert.equal(old.ok, true); assert.equal(old.plan.schemaVersion, 1);
  assert.equal(old.diagnostics.length, 4); assert.ok(old.diagnostics.every(row => row.severity === 'warning' && row.code === 'build_input_action_unconfigured'));
  assert.ok(old.diagnostics.every(row => /no input map.*runtime/i.test(row.message)));
  const cli = await runProjectBuildCommand(['--root', v1.author, '--target', v1.assemblyId, '--backend', 'org.viento.godot4']);
  assert.equal(cli.ok, true); assert.deepEqual(cli.diagnostics, old.diagnostics);
  const service = createProjectBuildService(v1.author, { tool:'', cacheRoot:path.join(v1.temporary, 'cache') }); t.after(() => service.close());
  await service.command({ action:'plan', targetId:v1.assemblyId });
  const state = await settled(service); assert.equal(state.job.status, 'succeeded'); assert.equal(state.job.diagnostics.length, 4);
});

test('a legacy project with custom actions and no input map still builds', { skip: !process.env.VIENTO_GODOT_BIN && 'Set VIENTO_GODOT_BIN for Godot build' }, async t => {
  const f = await fixture(t, false);
  const result = await buildProject({ root:f.author, targetId:f.assemblyId, tool:process.env.VIENTO_GODOT_BIN,
    output:path.join(f.temporary, 'legacy-built'), timeoutMs:60000 });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics || result.record?.diagnostics));
});


test('legacy mapping is conservative with defaults, built-in actions and edited sources', () => {
  const behavior = { backendId:'org.viento.godot4', language:'gdscript', manifest:{ objectId:'m', sourcePath:'d.json', sourceRevision:'r' },
    sources:[{ objectId:'s', content:GODOT_CHARACTER_INTENT_SCRIPT }],
    bindings:[{ instanceId:'i', bindingId:'b', parameters:{left_action:'runtime_registered'}, implementation:{sourceObjectId:'s'} }] };
  const scenes = [{ scene:{objectId:'scene'}, behaviors:behavior }];
  assert.equal(inspectProjectInputActionReferences(scenes, null, [])[0].code, 'build_input_action_unconfigured');
  behavior.bindings[0].parameters = {};
  assert.deepEqual(inspectProjectInputActionReferences(scenes, null, []), []);
  behavior.bindings[0].parameters = {left_action:'ui_unknown_future_action', right_action:'ui_up', jump_action:'ui_accept'};
  assert.deepEqual(inspectProjectInputActionReferences(scenes, null, []), []);
  behavior.sources[0].content += '\n# author edited'; behavior.bindings[0].parameters.left_action = 'runtime_registered';
  assert.deepEqual(inspectProjectInputActionReferences(scenes, null, []), []);
});
