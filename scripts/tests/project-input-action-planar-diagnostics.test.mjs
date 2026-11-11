import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GODOT_PLANAR_INTENT_SCRIPT } from '../../engine/godot-planar-intent-script.mjs';
import { inspectProjectInputActionReferences } from '../../engine/project-input-action-diagnostics.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { runProjectBuildCommand } from '../project-build.mjs';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';

const map = { format:'viento-input-map', schemaVersion:1, actions:[{ name:'mapped_left', keys:['KeyA'] }] };
const json = value => JSON.stringify(value, null, 2) + '\n';
const fields = ['left_action', 'right_action', 'up_action', 'down_action'];

for (const withMap of [false, true]) test(`planar starter exposes independent four-action suggestions in project v${withMap ? 2 : 1} without blocking plans`, async t => {
  const f = await projectAssemblyAuthor(t, { inputMap:withMap ? map : null });
  const file = path.join(f.author, 'documents/behaviors/demo.json'), document = JSON.parse(await fs.readFile(file, 'utf8'));
  document.bindings[0].parameters = { left_action:'mapped_left', right_action:'missing_right', up_action:'missing_up', down_action:'ui_unknown_future_action' };
  document.bindings[1].parameters = { down_action:'missing_down' };
  document.bindings.forEach(binding => { binding.events = []; });
  await fs.writeFile(file, json(document)); await fs.writeFile(path.join(f.author, 'documents/scripts/checkpoint.txt'), GODOT_PLANAR_INTENT_SCRIPT);
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics)); assert.equal(captured.plan.schemaVersion, withMap ? 2 : 1);
  const rows = captured.diagnostics;
  assert.deepEqual(rows.map(row => [row.instanceId, row.parameter]), [
    ...(!withMap ? [[document.bindings[0].instanceId, 'left_action']] : []),
    [document.bindings[0].instanceId, 'right_action'], [document.bindings[0].instanceId, 'up_action'], [document.bindings[1].instanceId, 'down_action'],
  ]);
  for (const row of rows) {
    assert.equal(row.code, withMap ? 'build_input_action_unmapped' : 'build_input_action_unconfigured'); assert.equal(row.severity, 'warning');
    const index = row.instanceId === document.bindings[0].instanceId ? 0 : 1;
    assert.equal(row.sceneId, f.sceneIds[0]); assert.equal(row.bindingId, document.bindings[index].bindingId);
    assert.equal(row.propertyPath, `/bindings/${index}/parameters/${row.parameter}`); assert.equal(row.sourceRange.exact, true);
    const content = await fs.readFile(file, 'utf8'); assert.equal(content.slice(row.sourceRange.start, row.sourceRange.end), JSON.stringify(document.bindings[index].parameters[row.parameter]));
  }
  const cli = await runProjectBuildCommand(['--root', f.author, '--target', f.assemblyId, '--backend', 'org.viento.godot4']);
  assert.equal(cli.ok, true); assert.deepEqual(cli.diagnostics, captured.diagnostics);
  await fs.appendFile(path.join(f.author, 'documents/scripts/checkpoint.txt'), '\n# ordinary author edit\n');
  const edited = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(edited.ok, true); assert.deepEqual(edited.diagnostics, []);
});

test('only exact planar source is inferred; defaults built-ins custom runtime registrations and other backend scripts keep their boundaries', () => {
  const behavior = { backendId:'org.viento.godot4', language:'gdscript', manifest:{ objectId:'m', sourcePath:'d.json', sourceRevision:'r' },
    sources:[{ objectId:'s', content:GODOT_PLANAR_INTENT_SCRIPT }],
    bindings:[{ instanceId:'i', bindingId:'b', parameters:{}, implementation:{ sourceObjectId:'s' } }] };
  const scenes = [{ scene:{objectId:'scene'}, behaviors:behavior }];
  for (const inputMap of [null, map]) {
    behavior.bindings[0].parameters = {}; assert.deepEqual(inspectProjectInputActionReferences(scenes, inputMap, []), []);
    behavior.bindings[0].parameters = Object.fromEntries(fields.map(name => [name,'ui_unknown_future_action']));
    assert.deepEqual(inspectProjectInputActionReferences(scenes, inputMap, []), []);
    behavior.bindings[0].parameters = { left_action:'mapped_left' };
    assert.equal(inspectProjectInputActionReferences(scenes, inputMap, []).length, inputMap ? 0 : 1);
    for (const value of ['', false, 0, null]) {
      behavior.bindings[0].parameters = {up_action:value}; const [row] = inspectProjectInputActionReferences(scenes, inputMap, []);
      assert.equal(row.parameter, 'up_action'); assert.equal(row.severity, 'warning');
    }
    behavior.sources[0].content += '\n# edited'; assert.deepEqual(inspectProjectInputActionReferences(scenes, inputMap, []), []);
    behavior.sources[0].content = GODOT_PLANAR_INTENT_SCRIPT;
  }
  behavior.backendId = 'org.viento.bevy-rust'; assert.deepEqual(inspectProjectInputActionReferences(scenes, map, []), []);
});

test('four-action warning budget keeps exact omitted count without expanding the established 256-row limit', () => {
  const bindings = Array.from({length:65}, (_, index) => ({ instanceId:`i-${index}`, bindingId:`b-${index}`,
    parameters:Object.fromEntries(fields.map(name => [name,`missing_${index}_${name}`])), implementation:{sourceObjectId:'s'} }));
  const scenes = [{scene:{objectId:'scene'},behaviors:{backendId:'org.viento.godot4',language:'gdscript',manifest:{objectId:'m',sourcePath:'d.json',sourceRevision:'r'},sources:[{objectId:'s',content:GODOT_PLANAR_INTENT_SCRIPT}],bindings}}];
  const diagnostics = inspectProjectInputActionReferences(scenes, map, []);
  assert.equal(diagnostics.length,256); assert.equal(diagnostics.at(-1).code,'build_input_action_unmapped_limit'); assert.equal(diagnostics.at(-1).omittedCount,5);
  assert.equal(diagnostics.filter(row => row.code === 'build_input_action_unmapped').length,255);
});
