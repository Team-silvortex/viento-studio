import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { scenePhysics2DDropThroughAuthor } from './helpers/scene-physics2d-drop-through-author-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';

const executable = process.env.VIENTO_GODOT_BIN;
const inputMapId = '38383838-3838-4383-8383-383838383838';
const map = { format:'viento-input-map', schemaVersion:1, actions:[{ name:'mapped_drop', keys:['KeyS'] }] };

async function sourceHashes(root) {
  const files = (await fs.readdir(root, { recursive:true, withFileTypes:true })).filter(item => item.isFile())
    .map(item => path.join(item.parentPath, item.name)).sort();
  return Promise.all(files.map(async file => [path.relative(root, file), createHash('sha256').update(await fs.readFile(file)).digest('hex')]));
}

for (const withMap of [false, true]) test(`real Godot drop starter: ${withMap ? 'mapped' : 'built-in'} input and non-blocking warning`, {
  skip: executable ? false : 'Set VIENTO_GODOT_BIN for a real Godot build and run', timeout:180000,
}, async t => {
  const f = await scenePhysics2DDropThroughAuthor(t, { consumers:false, drop:true });
  if (withMap) {
    await f.write('documents/projects/controls.json', map);
    const record = await f.read(`metadata/documents/${f.assemblyId}.json`);
    await f.write(`metadata/documents/${inputMapId}.json`, { ...record, id:inputMapId, sourcePath:'documents/projects/controls.json', relations:[], assetBindings:[] });
    await f.edit('documents/projects/demo.json', project => { project.schemaVersion = 2; project.inputMapId = inputMapId; });
  }
  const setAction = action => f.edit(f.manifestPath, manifest => {
    manifest.bindings.find(binding => binding.bindingId === f.dropBindingId).parameters.drop_action = action;
  });
  await setAction('missing_drop');
  const before = await sourceHashes(f.author);
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.equal(captured.plan.schemaVersion, withMap ? 2 : 1);
  const warnings = captured.diagnostics.filter(row => row.parameter === 'drop_action');
  assert.equal(warnings.length, 1, JSON.stringify(captured.diagnostics));
  assert.equal(warnings[0].severity, 'warning');
  assert.equal(warnings[0].code, withMap ? 'build_input_action_unmapped' : 'build_input_action_unconfigured');
  assert.equal(warnings[0].bindingId, f.dropBindingId);
  assert.equal(warnings[0].instanceId, f.instanceId);
  const built = await buildProject({ root:f.author, targetId:f.assemblyId, tool:executable,
    output:path.join(f.temporary, 'warning-build'), timeoutMs:60000 });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  assert.deepEqual(await sourceHashes(f.author), before);

  const action = withMap ? 'mapped_drop' : 'ui_down';
  await setAction(action);
  if (withMap) {
    const driverPath = path.join(f.author, 'documents/scripts/motion-input.txt');
    const driver = await fs.readFile(driverPath, 'utf8');
    await fs.writeFile(driverPath, driver.replaceAll('ui_down', action));
  }
  const afterEdit = await sourceHashes(f.author);
  const resolved = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(resolved.ok, true, JSON.stringify(resolved.diagnostics));
  assert.deepEqual(resolved.diagnostics.filter(row => row.parameter === 'drop_action'), []);
  const ready = await buildProject({ root:f.author, targetId:f.assemblyId, tool:executable,
    output:path.join(f.temporary, 'resolved-build'), timeoutMs:60000 });
  assert.equal(ready.ok, true, JSON.stringify(ready.diagnostics || ready.record?.diagnostics));
  const ran = await runProjectBuild({ buildDirectory:ready.buildDirectory, tool:executable, timeoutMs:60000 });
  assert.equal(ran.ok, true, JSON.stringify(ran.diagnostics || ran.record?.diagnostics));
  const exit = ran.record.events.find(event => event.event === 'scene-exit');
  assert.ok(exit, JSON.stringify(ran.record.events));
  const actor = exit.actors.find(item => item.instanceId === f.instanceId);
  const other = exit.actors.find(item => item.instanceId === f.otherInstanceId);
  assert.ok(Math.abs(actor.position[1] - f.expectedLandingY) < .2, JSON.stringify(actor));
  assert.ok(Math.abs(other.position[1] - f.expectedSupportY) < .2, JSON.stringify(other));
  assert.deepEqual(await sourceHashes(f.author), afterEdit);
});
