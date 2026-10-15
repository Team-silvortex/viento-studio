import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import yauzl from 'yauzl';
import { backendProjectFixture } from './helpers/backend-project-fixture.mjs';
import { projectAssemblyBuildFixture, projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { validateBackendProjectManifest, backendProjectSourceIdentity, summarizeBackendProject } from '../../engine/backend-project.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { createBackendProjectCatalog, assertCatalogProject, catalogProjectTarget } from '../adapters/node-backend-project-catalog.mjs';
import { createProjectRetentionPin, pinProjectFile } from '../adapters/node-backend-project-retention.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
const json = value => JSON.stringify(value, null, 2) + '\n';
const invalid = { errorCode: 'backend_project_invalid' };

test('v2 provenance keeps assembly identity, entry and each scene separate, with exact dependency and file roles', async t => {
  const f = await projectAssemblyBuildFixture(t), project = validateBackendProjectManifest(f.project);
  assert.equal(project.schemaVersion, 2); assert.equal(project.source.assemblyId, f.assemblyId); assert.equal(Object.hasOwn(project.source, 'sceneId'), false);
  assert.deepEqual(project.source.scenes.map(scene => scene.sceneId), f.sceneIds);
  assert.equal(project.dependencies.filter(row => row.role === 'scene').length, 2);
  assert.equal(project.dependencies.filter(row => row.role === 'assembly').length, 1);
  assert.equal(project.files.filter(row => row.role === 'author-source-copy').length, 1);
  assert.equal(project.resources.length, 2);
  assert.deepEqual(backendProjectSourceIdentity(project), { objectId: f.assemblyId, sourcePath: 'documents/projects/demo.json',
    sourceRevision: f.captured.plan.assembly.sourceRevision, planKind: 'project', planSchemaVersion: 1, entrySceneId: f.entrySceneId, sceneCount: 2 });
  assert.equal(summarizeBackendProject(project).sceneCount, 2);
  const inspected = await inspectBackendProject({ buildDirectory: f.directory, ...f.pins });
  assert.equal(inspected.inspection.complete, true);
});

test('v2 cannot disguise the assembly as a scene, omit a member, substitute an entry or invent dependency provenance', async t => {
  const f = await projectAssemblyBuildFixture(t);
  for (const change of [value => { value.schemaVersion = 1; }, value => { value.source.sceneId = value.source.assemblyId; },
    value => { value.source.entrySceneId = value.source.assemblyId; }, value => { value.source.scenes.pop(); },
    value => { value.source.scenes[0].sourceRevision = 'sha256:' + 'f'.repeat(64); },
    value => { value.dependencies.find(row => row.role === 'assembly').role = 'author-document'; },
    value => { value.dependencies.find(row => row.role === 'scene').role = 'author-document'; },
    value => { value.source.scenes.push(value.source.scenes[0]); }]) {
    const value = structuredClone(f.project); change(value); assert.throws(() => validateBackendProjectManifest(value), invalid);
  }
});

test('catalog persists a distinct project target and reopens its ownership receipt without author workspace', async t => {
  const f = await projectAssemblyBuildFixture(t), backendId = f.project.backend.id;
  const namespace = path.join(f.temporary, 'cache/editor', 'a'.repeat(24), backendId), directory = path.join(namespace, randomUUID());
  await fs.mkdir(namespace, { recursive: true }); await fs.rename(f.directory, directory);
  const retentionPin = await createProjectRetentionPin(directory); pinProjectFile(retentionPin, 'backend-project.json', json(f.project));
  const catalog = createBackendProjectCatalog({ namespace, backendId });
  const legacy = await backendProjectFixture(t), legacyDirectory = path.join(namespace, randomUUID());
  await fs.rename(legacy.directory, legacyDirectory);
  const legacyPin = await createProjectRetentionPin(legacyDirectory); pinProjectFile(legacyPin, 'backend-project.json', json(legacy.project));
  const legacyEntry = await catalog.capture({ buildDirectory: legacyDirectory, project: legacy.project, manifestSha256: legacy.manifestSha256,
    retentionPin: legacyPin, title: 'Single scene', createdAt: '2026-10-14T00:00:00.000Z' });
  assert.equal((await catalog.upsert(legacyEntry)).schemaVersion, 1);
  const entry = await catalog.capture({ buildDirectory: directory, project: f.project, manifestSha256: f.manifestSha256, retentionPin,
    title: 'Assembly', createdAt: '2026-10-15T00:00:00.000Z' });
  assert.deepEqual(catalogProjectTarget(entry), { objectId: f.assemblyId, planKind: 'project' }); assert.equal(Object.hasOwn(entry, 'sceneId'), false);
  assert.equal((await catalog.upsert(entry)).schemaVersion, 2);
  await fs.rm(f.author, { recursive: true });
  const restored = await createBackendProjectCatalog({ namespace, backendId }).read();
  assert.equal(restored.entries.length, 2); assert.deepEqual(restored.entries[0], legacyEntry);
  const recovered = restored.entries.find(item => item.buildId === entry.buildId);
  assert.deepEqual(recovered, entry); assert.equal((await assertCatalogProject(recovered)).buildDirectory, directory);
});

test('offline project ZIP carries all scene scripts and shared audio/image bytes once, with no private snapshot', async t => {
  const f = await projectAssemblyBuildFixture(t), inspect = () => inspectBackendProject({ buildDirectory: f.directory, ...f.pins });
  await fs.rm(f.author, { recursive: true });
  const plan = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect }), output = path.join(f.temporary, 'project.zip');
  await writeExportZip(plan, output); const verified = await verifyBackendProjectDelivery(output);
  assert.deepEqual(verified.delivery.project, f.project); assert.equal(verified.assetCount, 2);
  const zip = await yauzl.openPromise(output, { lazyEntries: true, autoClose: false }), names = [];
  try { for await (const entry of zip.eachEntry()) names.push(entry.fileName); }
  finally { await new Promise(resolve => { zip.reader.once('close', resolve); zip.close(); }); }
  assert.deepEqual(names.sort(), [...f.project.files.map(file => file.path), 'README.md', 'manifest.json'].sort());
  assert.equal(names.filter(name => name.endsWith('project.godot')).length, 1);
  assert.equal(names.filter(name => name.endsWith('.wav')).length, 1); assert.equal(names.includes('snapshot.json'), false);
});

const tool = process.env.VIENTO_GODOT_BIN;
test('real saved assembly builds, runs, survives inspection and ZIP relocation with a runnable entry scene', { skip: !tool }, async t => {
  const f = await projectAssemblyAuthor(t, { entry: 'audio' });
  const built = await buildProject({ root: f.author, scene: f.assemblyId, godot: tool, output: path.join(f.temporary, 'build'), timeoutMs: 60000 });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  const directory = built.directory || built.output || built.buildDirectory;
  assert.equal(typeof directory, 'string', JSON.stringify(Object.keys(built)));
  const run = await runProjectBuild({ buildDirectory: directory, godot: tool, timeoutMs: 60000 });
  assert.equal(run.ok, true, JSON.stringify(run.diagnostics || run.record?.diagnostics));
  const inspect = () => inspectBackendProject({ buildDirectory: directory });
  const plan = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect }), output = path.join(f.temporary, 'project.zip');
  await writeExportZip(plan, output); await verifyBackendProjectDelivery(output);
  await fs.rm(f.author, { recursive: true });
  const relocated = path.join(f.temporary, 'relocated'); await fs.mkdir(relocated);
  const zip = await yauzl.openPromise(output, { lazyEntries: true, autoClose: false });
  try {
    for await (const entry of zip.eachEntry()) {
      const chunks = []; for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk);
      const file = path.join(relocated, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
    }
  } finally { await new Promise(resolve => { zip.reader.once('close', resolve); zip.close(); }); }
  const identified = await adapter.identify(tool), project = path.join(relocated, 'project');
  for (const phase of ['import', 'run']) {
    const result = await adapter.executePhase({ phase, directory: project, tool: identified, timeoutMs: 60000 });
    assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
    if (phase === 'run') assert.ok(result.stdout.split('\n').filter(line => line.startsWith('VIENTO_PROJECT:'))
      .map(line => JSON.parse(line.slice('VIENTO_PROJECT:'.length))).some(frame => frame.event === 'scene-event' && frame.stream === 'audio'));
  }
});
