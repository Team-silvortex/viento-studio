import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { serve, request } from './helpers.mjs';
import { scenePhysics2DAuthor } from './helpers/scene-physics2d-author-fixture.mjs';
import { fingerprint } from './helpers/scene-animation-scene-preview-fixture.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject } from '../adapters/node-project-build.mjs';
import { runProjectBuildCommand } from '../project-build.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const actorRef = { kind: 'user', id: 'physics-workflow-test' };
const absentInstance = '71717171-7171-4171-8171-717171717171';
const json = value => JSON.stringify(value, null, 2) + '\n';
const hashes = f => fingerprint(f.author, { authorOnly: true });
const changed = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => before[name] !== after[name]).sort();
async function host(t, f) {
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: f.author,
    VIENTO_GODOT_BIN: process.execPath, VIENTO_EXECUTION_BACKEND: 'org.viento.godot4',
    XDG_CACHE_HOME: path.join(f.temporary, 'cache'), XDG_CONFIG_HOME: path.join(f.temporary, 'config') });
  const api = async (route, payload) => { const response = await request(base, route, payload); assert.equal(response.status, 200, JSON.stringify(response)); return response.data; };
  const job = async action => {
    const accepted = await api('/api/project-build', { action, targetId: f.assemblyId });
    for (const deadline = Date.now() + 15000; Date.now() < deadline;) {
      const state = await api('/api/project-build');
      if (state.job?.id === accepted.job.id && state.job.status !== 'running') return state.job;
      await delay(20);
    }
    assert.fail('Physics author job did not settle.');
  };
  return { api, job };
}
async function relationCommand(f, objectId, targetObjectId, slot) {
  const view = await readWorldProjection(f.author);
  return { command: 'relation.add', mode: 'preview', worldId: view.world.id, baseRevision: view.world.revision,
    objectId, objectRevision: view.objects.find(object => object.id === objectId).revision,
    targetObjectId, targetRevision: view.objects.find(object => object.id === targetObjectId).revision,
    kind: 'references', slot, actorRef };
}
async function applyOrdinary(h, f, command, expectedFiles) {
  const before = await hashes(f), preview = await h.api('/api/world/commands', command);
  assert.equal(preview.status, 'preview'); assert.deepEqual(await hashes(f), before, 'command preview preserves all author files');
  const applied = await h.api('/api/world/commands', { ...command, mode: 'apply' });
  assert.equal(applied.status, 'applied'); assert.equal(applied.receipt.state, 'committed'); assert.equal(applied.revision, preview.revision);
  const after = await hashes(f); assert.deepEqual(changed(before, after), [...expectedFiles].sort());
  return after;
}

// Creation deliberately uses ordinary semantic commands rather than another
// feature-owned transaction. A scene opts in only after its reverse reference.
test('ordinary object.create and reverse/forward relation.add form an independently registered physics declaration', async t => {
  const f = await scenePhysics2DAuthor(t);
  await f.edit(`metadata/documents/${f.sceneIds[0]}.json`, record => { record.relations = record.relations.filter(row => row.slot !== 'physics2d'); });
  await fs.rm(path.join(f.author, f.physicsPath)); await fs.rm(path.join(f.author, `metadata/documents/${f.physicsId}.json`));
  const h = await host(t, f), view = await readWorldProjection(f.author);
  const content = '\ufeff' + json(f.physics).replaceAll('\n', '\r\n');
  await applyOrdinary(h, f, { command: 'object.create', mode: 'preview', worldId: view.world.id, baseRevision: view.world.revision,
    actorRef, objectId: f.physicsId, documentType: 'physics', sourcePath: f.physicsPath, content },
  [f.physicsPath, `metadata/documents/${f.physicsId}.json`]);
  assert.equal(await fs.readFile(path.join(f.author, f.physicsPath), 'utf8'), content);
  let captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.equal(captured.plan.scenes.some(scene => scene.physics), false, 'registration alone does not enable physics');
  await applyOrdinary(h, f, await relationCommand(f, f.physicsId, f.sceneIds[0], ''), [`metadata/documents/${f.physicsId}.json`]);
  captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(captured.ok, true);
  assert.equal(captured.plan.scenes.some(scene => scene.physics), false, 'a reverse dependency alone does not enable physics');
  const after = await applyOrdinary(h, f, await relationCommand(f, f.sceneIds[0], f.physicsId, 'physics2d'), [`metadata/documents/${f.sceneIds[0]}.json`]);
  captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.deepEqual(captured.plan.scenes[0].physics.document, f.physics);
  assert.equal(captured.plan.scenes[0].physics.manifest.sourcePath, f.physicsPath);
  assert.equal(captured.plan.scenes[1].physics, undefined, 'unrelated scenes remain outside physics');
  const registry = await readRegistry(f.author), record = registry.documents.find(row => row.id === f.physicsId);
  assert.deepEqual(record.assetBindings, []); assert.equal(record.documentType, 'physics');
  assert.deepEqual(record.relations, [{ kind: 'references', targetId: f.sceneIds[0], slot: '' }]);
  assert.equal((await h.job('plan')).status, 'succeeded');
  assert.deepEqual(await hashes(f), after, 'capturing and planning never rewrite source, template, metadata or behavior files');
  await assert.rejects(fs.stat(path.join(f.temporary, 'cache/io.viento.studio/builds')), { code: 'ENOENT' });
});

for (const documents of ['documents', 'design-data']) test(`missing physics target rejects before tools and ordinary HTTP Save repairs exact source (${documents})`, async t => {
  const f = await scenePhysics2DAuthor(t);
  if (documents !== 'documents') {
    await f.edit('workspace.json', workspace => { workspace.version = 2; workspace.paths.documents = documents; workspace.paths.templates = 'data-template'; });
    await fs.rename(path.join(f.author, 'documents'), path.join(f.author, documents));
    await fs.rename(path.join(f.author, 'templates'), path.join(f.author, 'data-template'));
    for (const name of await fs.readdir(path.join(f.author, 'metadata/documents'))) await f.edit(`metadata/documents/${name}`, record => { record.sourcePath = record.sourcePath.replace(/^documents\//, documents + '/'); });
    f.physicsPath = f.physicsPath.replace(/^documents\//, documents + '/');
  }
  const document = structuredClone(f.physics); document.bodies[0].instanceId = absentInstance;
  const content = '\ufeff' + json(document).replaceAll('\n', '\r\n'); await f.write(f.physicsPath, content);
  const before = await hashes(f), pointer = '/bodies/0/instanceId';
  const captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(captured.ok, false); assert.equal(captured.snapshotId, undefined);
  const issue = captured.diagnostics.find(item => item.code === 'build_physics_invalid'); assert.ok(issue, JSON.stringify(captured.diagnostics));
  assert.equal(issue.objectId, f.physicsId); assert.equal(issue.sourcePath, f.physicsPath); assert.equal(issue.propertyPath, pointer);
  assert.equal(issue.instanceId, absentInstance); assert.equal(issue.bodyId, f.physics.bodies[0].id);
  assert.deepEqual(issue.sourceRange, locateJsonSource(parseJsonSource(content), pointer));
  assert.equal(content.slice(issue.sourceRange.start, issue.sourceRange.end), JSON.stringify(absentInstance));
  let resolves = 0; const phases = [], output = path.join(f.temporary, 'never-created');
  const rejected = await buildProject({ root: f.author, targetId: f.assemblyId, tool: '/must-not-be-opened', output,
    backendRegistry: { resolve() { resolves++; throw new Error('Invalid physics author data must fail before backend selection.'); } },
    onProgress: item => phases.push(item.phase) });
  assert.equal(rejected.ok, false); assert.deepEqual(rejected.diagnostics, captured.diagnostics); assert.equal(resolves, 0); assert.deepEqual(phases, ['snapshot']);
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  const cli = await runProjectBuildCommand(['--root', f.author, '--target', f.assemblyId]); assert.equal(cli.ok, false); assert.deepEqual(cli.diagnostics, captured.diagnostics);
  const h = await host(t, f);
  for (const action of ['plan', 'build']) { const job = await h.job(action); assert.equal(job.status, 'failed'); assert.deepEqual(job.diagnostics, captured.diagnostics); }
  assert.equal((await h.api('/api/project-build')).toolStatus.status, 'unchecked');
  await assert.rejects(fs.stat(path.join(f.temporary, 'cache/io.viento.studio/builds')), { code: 'ENOENT' });
  assert.deepEqual(await hashes(f), before);
  const original = await h.api('/api/doc?path=' + encodeURIComponent(f.physicsPath));
  const repaired = content.replace(JSON.stringify(absentInstance), JSON.stringify(f.instanceId));
  await h.api('/api/doc', { path: f.physicsPath, content: repaired, expectedVersion: original.version });
  const after = await hashes(f); assert.deepEqual(changed(before, after), [f.physicsPath]);
  assert.equal(await fs.readFile(path.join(f.author, f.physicsPath), 'utf8'), repaired, 'ordinary Save preserves author BOM and CRLF');
  const fixed = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(fixed.ok, true, JSON.stringify(fixed.diagnostics));
  assert.equal(fixed.plan.scenes[0].physics.document.bodies[0].instanceId, f.instanceId);
  assert.equal((await h.job('plan')).status, 'succeeded'); assert.deepEqual(await hashes(f), after);
});
