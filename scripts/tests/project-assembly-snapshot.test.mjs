import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
import { createBuildTargetPlan, entryScenePlan } from '../../engine/build-target.mjs';
import { validateProjectAssemblyPlan } from '../../engine/project-assembly-plan.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';

async function withoutRedundantRelations(f) {
  const file = path.join(f.author, `metadata/documents/${f.assemblyId}.json`), value = JSON.parse(await fs.readFile(file));
  value.relations = []; await fs.writeFile(file, JSON.stringify(value));
}

test('assembly snapshot freezes all scene plans with one shared resource and reproduces after relocation', async t => {
  const f = await projectAssemblyAuthor(t); await withoutRedundantRelations(f);
  const captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.equal(captured.snapshot.schemaVersion, 1); assert.equal(captured.plan.kind, 'project');
  assert.deepEqual(captured.plan.scenes.map(scene => scene.schemaVersion), [3, 2]);
  assert.equal(captured.plan.scenes[1].audio.document.tracks.length, 2);
  assert.equal(captured.resources.size, 2); assert.equal(captured.plan.resources.length, 2);
  assert.equal(entryScenePlan(captured.plan).scene.objectId, f.entrySceneId);
  assert.deepEqual(validateProjectAssemblyPlan(captured.plan), captured.plan);
  for (const resource of captured.plan.resources) assert.equal(buildHash(captured.resources.get(resource.id)), resource.sha256);
  const moved = path.join(f.temporary, 'moved'); await fs.cp(f.author, moved, { recursive: true });
  assert.equal((await captureBuildSnapshot(moved, f.assemblyId)).snapshotId, captured.snapshotId);
  const projection = await createWorldProjection(captured.snapshot.source, { digest: buildHash });
  assert.deepEqual(createBuildTargetPlan({ source: captured.snapshot.source, projection }, f.assemblyId).plan, captured.plan);
});

test('non-entry resource failures point to their own audio declaration and frozen bytes remain intact', async t => {
  const f = await projectAssemblyAuthor(t), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  await fs.writeFile(path.join(f.author, 'assets/tone.wav'), 'changed');
  const rejected = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(rejected.ok, false); assert.equal(rejected.diagnostics[0].resourceId, f.waveId);
  assert.equal(rejected.diagnostics[0].sourcePath, 'documents/audio/demo.json');
  assert.match(rejected.diagnostics[0].propertyPath, /^\/tracks\//);
  assert.equal(buildHash(captured.resources.get(f.waveId)), captured.plan.resources.find(item => item.id === f.waveId).sha256);
});

test('an author change during any member resource capture rejects the whole assembly snapshot', async t => {
  const f = await projectAssemblyAuthor(t), original = fs.open;
  let changed = false;
  fs.open = async function(file, ...args) {
    if (!changed && String(file) === path.join(f.author, 'assets/tone.wav')) {
      changed = true;
      const member = path.join(f.author, 'documents/scenes/audio.json');
      await fs.appendFile(member, '\n');
    }
    return original.call(this, file, ...args);
  };
  try { await assert.rejects(captureBuildSnapshot(f.author, f.assemblyId), { errorCode: 'build_input_changed' }); }
  finally { fs.open = original; }
  assert.equal(changed, true);
});

test('assembly membership changes invalidate snapshots and unfinished transactions block capture', async t => {
  const f = await projectAssemblyAuthor(t), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  const file = path.join(f.author, 'documents/projects/demo.json'), value = JSON.parse(await fs.readFile(file));
  value.entrySceneId = f.sceneIds[1]; await fs.writeFile(file, JSON.stringify(value));
  const next = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(next.ok, true); assert.notEqual(next.snapshotId, captured.snapshotId);
  assert.equal(entryScenePlan(next.plan).scene.objectId, f.sceneIds[1]);
  await fs.mkdir(path.join(f.author, '.viento/world-transactions/active'), { recursive: true });
  await assert.rejects(captureBuildSnapshot(f.author, f.assemblyId), { errorCode: 'world_recovery_required' });
});
