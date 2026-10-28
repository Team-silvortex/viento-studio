import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GODOT_CHARACTER_DROP_THROUGH_SCRIPT } from '../../engine/godot-character-drop-through-script.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';
import { inspectProjectInputActionReferences } from '../../engine/project-input-action-diagnostics.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { runProjectBuildCommand } from '../project-build.mjs';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';

const map = { format:'viento-input-map', schemaVersion:1, actions:[{ name:'mapped_drop', keys:['KeyS'] }] };
const json = value => JSON.stringify(value, null, 2) + '\n';

for (const withMap of [false, true]) test(`drop starter checks saved project v${withMap ? 2 : 1} without blocking its plan`, async t => {
  const f = await projectAssemblyAuthor(t, { inputMap:withMap ? map : null });
  const manifestPath = path.join(f.author, 'documents/behaviors/demo.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.bindings[0].parameters = { drop_action:'missing_drop' };
  manifest.bindings[1].parameters = {};
  manifest.bindings.forEach(row => { row.events = []; });
  await fs.writeFile(manifestPath, json(manifest));
  await fs.writeFile(path.join(f.author, 'documents/scripts/checkpoint.txt'), GODOT_CHARACTER_DROP_THROUGH_SCRIPT);
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.equal(captured.plan.schemaVersion, withMap ? 2 : 1);
  assert.equal(captured.diagnostics.length, 1);
  const [row] = captured.diagnostics;
  assert.equal(row.code, withMap ? 'build_input_action_unmapped' : 'build_input_action_unconfigured');
  assert.equal(row.severity, 'warning');
  assert.equal(row.parameter, 'drop_action');
  assert.equal(row.sceneId, f.sceneIds[0]);
  assert.equal(row.instanceId, manifest.bindings[0].instanceId);
  assert.equal(row.bindingId, manifest.bindings[0].bindingId);
  assert.equal(row.propertyPath, '/bindings/0/parameters/drop_action');
  const content = await fs.readFile(manifestPath, 'utf8');
  assert.equal(row.sourceRange.exact, true);
  assert.equal(content.slice(row.sourceRange.start, row.sourceRange.end), '"missing_drop"');
  const cli = await runProjectBuildCommand(['--root', f.author, '--target', f.assemblyId, '--backend', 'org.viento.godot4']);
  assert.equal(cli.ok, true); assert.deepEqual(cli.diagnostics, captured.diagnostics);
  manifest.bindings[0].parameters.drop_action = withMap ? 'mapped_drop' : 'ui_down';
  await fs.writeFile(manifestPath, json(manifest));
  const resolved = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(resolved.ok, true); assert.deepEqual(resolved.diagnostics, []);
});

test('only the unchanged official drop starter is inferred; defaults and built-ins stay conservative', () => {
  assert.equal(listScriptStarters().find(item => item.id === 'godot-character-drop-through').content, GODOT_CHARACTER_DROP_THROUGH_SCRIPT);
  const behavior = { backendId:'org.viento.godot4', language:'gdscript', manifest:{ objectId:'m', sourcePath:'d.json', sourceRevision:'r' },
    sources:[{ objectId:'s', content:GODOT_CHARACTER_DROP_THROUGH_SCRIPT }],
    bindings:[{ instanceId:'i', bindingId:'b', parameters:{}, implementation:{ sourceObjectId:'s' } }] };
  const scenes = [{ scene:{objectId:'scene'}, behaviors:behavior }];
  for (const inputMap of [null, map]) {
    behavior.bindings[0].parameters = {};
    assert.deepEqual(inspectProjectInputActionReferences(scenes, inputMap, []), []);
    behavior.bindings[0].parameters = { drop_action:'ui_unknown_future_action' };
    assert.deepEqual(inspectProjectInputActionReferences(scenes, inputMap, []), []);
    behavior.bindings[0].parameters = { drop_action:'mapped_drop' };
    assert.equal(inspectProjectInputActionReferences(scenes, inputMap, []).length, inputMap ? 0 : 1);
    behavior.bindings[0].parameters = { drop_action:'' };
    assert.equal(inspectProjectInputActionReferences(scenes, inputMap, [])[0].severity, 'warning');
    behavior.sources[0].content += '\n# author edited';
    assert.deepEqual(inspectProjectInputActionReferences(scenes, inputMap, []), []);
    behavior.sources[0].content = GODOT_CHARACTER_DROP_THROUGH_SCRIPT;
  }
});

test('each missing drop action identifies its own scene, binding, instance and source range', () => {
  const scenes = [], documents = [];
  for (let n = 0; n < 2; n++) {
    const bindings = Array.from({length:2}, (_, i) => ({ bindingId:`binding-${n}-${i}`, instanceId:`instance-${n}-${i}`,
      parameters:{ drop_action:`missing_${n}_${i}` }, implementation:{ sourceObjectId:'source' } }));
    const content = json({ bindings });
    const manifest = { objectId:`manifest-${n}`, sourcePath:`scene-${n}.json`, sourceRevision:`rev-${n}` };
    documents.push({ record:{id:manifest.objectId}, sourcePath:manifest.sourcePath, sourceRevision:manifest.sourceRevision, content });
    scenes.push({ scene:{objectId:`scene-${n}`}, behaviors:{ backendId:'org.viento.godot4', language:'gdscript', manifest,
      sources:[{ objectId:'source', content:GODOT_CHARACTER_DROP_THROUGH_SCRIPT }], bindings } });
  }
  const diagnostics = inspectProjectInputActionReferences(scenes, map, documents);
  assert.equal(diagnostics.length, 4);
  diagnostics.forEach((row, n) => {
    const scene = Math.floor(n / 2), binding = n % 2;
    assert.equal(row.sceneId, `scene-${scene}`); assert.equal(row.bindingId, `binding-${scene}-${binding}`);
    assert.equal(row.instanceId, `instance-${scene}-${binding}`); assert.equal(row.sourcePath, `scene-${scene}.json`);
    assert.equal(row.propertyPath, `/bindings/${binding}/parameters/drop_action`);
    assert.equal(row.sourceRange.exact, true);
    assert.equal(documents[scene].content.slice(row.sourceRange.start, row.sourceRange.end), `"missing_${scene}_${binding}"`);
  });
});
