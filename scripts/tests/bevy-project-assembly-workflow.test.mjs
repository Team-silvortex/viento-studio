import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';
import { projectAssemblyAuthor } from './helpers/project-assembly-backend-fixture.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { writeExportZip } from '../lib/export-package.mjs';
import { BEVY_EXECUTION_ADAPTER as adapter } from '../backends/bevy-adapter.mjs';

async function author(t) {
  const f = await projectAssemblyAuthor(t, { entry: 'audio' });
  for (const [index, id] of f.sceneIds.entries()) {
    const metaPath = path.join(f.author, `metadata/documents/${id}.json`);
    const metadata = JSON.parse(await fs.readFile(metaPath));
    metadata.relations = metadata.relations.filter(item => item.kind === 'reference');
    await fs.writeFile(metaPath, JSON.stringify(metadata));
    const scenePath = path.join(f.author, metadata.sourcePath);
    const scene = JSON.parse(await fs.readFile(scenePath));
    for (const actor of scene.actors) { delete actor.imageResourceId; actor.controls = 'arrows'; actor.speed = 80; }
    scene.title = `Data scene ${index + 1}`;
    await fs.writeFile(scenePath, JSON.stringify(scene));
  }
  await fs.rm(path.join(f.author, 'metadata/documents/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json'));
  await fs.rm(path.join(f.author, 'metadata/documents/88888888-8888-4888-8888-888888888888.json'));
  return f;
}
const tool = process.env.VIENTO_BEVY_BIN;
test('real Bevy builds every project scene, runs its entry, and delivers the offline project', { skip: !tool }, async t => {
  const f = await author(t), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const built = await buildProject({ root: f.author, scene: f.assemblyId, backendId: 'org.viento.bevy', tool,
    output: path.join(f.temporary, 'build'), timeoutMs: 60000 });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  const directory = built.buildDirectory;
  assert.deepEqual(built.record.phases[0].sceneChecks.map(row => row.sceneId), f.sceneIds);
  assert.ok(built.record.phases[0].sceneChecks.every(row => row.status === 'succeeded'));
  const run = await runProjectBuild({ buildDirectory: directory, tool, timeoutMs: 60000 });
  assert.equal(run.ok, true, JSON.stringify(run.diagnostics || run.record?.diagnostics));
  assert.equal(run.record.events.find(event => event.event === 'scene-enter').sceneId, f.entrySceneId);
  assert.equal(run.record.events.at(-1).event, 'finished');
  const inspect = () => inspectBackendProject({ buildDirectory: directory });
  await fs.rm(f.author, { recursive: true });
  const delivery = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect });
  const zipPath = path.join(f.temporary, 'delivery.zip'); await writeExportZip(delivery, zipPath);
  const verified = await verifyBackendProjectDelivery(zipPath);
  assert.deepEqual(verified.delivery.project.source.scenes.map(row => row.sceneId), f.sceneIds);
  const relocated = path.join(f.temporary, 'relocated'); await fs.mkdir(relocated);
  const zip = await yauzl.openPromise(zipPath, { lazyEntries: true, autoClose: false });
  try { for await (const entry of zip.eachEntry()) {
    const chunks = []; for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk);
    const file = path.join(relocated, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
  } } finally { await new Promise(resolve => { zip.reader.once('close', resolve); zip.close(); }); }
  const project = path.join(relocated, 'project'), identified = await adapter.identify(tool);
  const check = await adapter.executePhase({ phase: 'scene-check', tool: identified, directory: project });
  assert.equal(check.status, 'succeeded', check.stderr);
  const reader = adapter.createEventReader(captured.plan);
  const executed = await adapter.executePhase({ phase: 'run', tool: identified, directory: project,
    onOutput: output => { if (output.stream === 'stdout') reader.push(output.text); } });
  assert.equal(executed.status, 'succeeded'); assert.deepEqual(reader.finish().diagnostics, []);
  assert.equal(reader.events.at(-1).event, 'finished');
  const rootEntry = path.join(project, 'scene-data.json'), entryBytes = await fs.readFile(rootEntry);
  await fs.writeFile(rootEntry, '{}');
  await assert.rejects(adapter.executePhase({ phase: 'run', tool: identified, directory: project }), { errorCode: 'build_assembly_invalid' });
  await fs.writeFile(rootEntry, entryBytes);
  const nonEntry = f.sceneIds.find(id => id !== f.entrySceneId);
  const invalidFile = path.join(project, 'scenes', nonEntry, 'scene-data.json');
  const original = await fs.readFile(invalidFile);
  await fs.writeFile(invalidFile, entryBytes);
  await assert.rejects(adapter.executePhase({ phase: 'scene-check', tool: identified, directory: project }), { errorCode: 'build_assembly_invalid' });
  await fs.writeFile(invalidFile, original);
  const invalid = JSON.parse(original); invalid.actors[0].position[0] = 100001;
  await fs.writeFile(invalidFile, JSON.stringify(invalid));
  const failed = await adapter.executePhase({ phase: 'scene-check', tool: identified, directory: project });
  assert.equal(failed.status, 'failed');
  assert.ok(adapter.diagnostics(failed, captured.plan).some(item => item.code === 'build_process_failed'
    && item.sourcePath === captured.plan.scenes.find(scene => scene.scene.objectId === nonEntry).scene.sourcePath));
  const replay = { format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125, steps: [{ left: false, right: true, up: false, down: false }, { left: false, right: false, up: false, down: false }] };
  const replayed = await runProjectBuild({ buildDirectory: directory, tool, timeoutMs: 60000, controlProgram: replay });
  assert.equal(replayed.ok, true, JSON.stringify(replayed.diagnostics || replayed.record?.diagnostics));
  assert.equal(replayed.record.control.samples.length, 2);
  assert.equal(replayed.record.runtime.control.completedSteps, 2);
  assert.equal(replayed.record.events.at(-1).totalSeconds, 0.25);
  assert.equal(replayed.record.runtime.project.visits[0].sceneId, f.entrySceneId);
  const entryScene = captured.plan.scenes.find(scene => scene.scene.objectId === f.entrySceneId);
  const instanceId = entryScene.actors[0].instanceId;
  const instanceReplay = { format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.0625,
    steps: [{ inputs: [{ instanceId, left: false, right: true, up: false, down: false }] }, { inputs: [] }] };
  const instanceRun = await runProjectBuild({ buildDirectory: directory, tool, timeoutMs: 60000, controlProgram: instanceReplay });
  assert.equal(instanceRun.ok, true, JSON.stringify(instanceRun.diagnostics || instanceRun.record?.diagnostics));
  assert.equal(instanceRun.record.control.samples.length, 2);
  assert.equal(instanceRun.record.events.at(-1).totalSeconds, 0.125);
  assert.equal(instanceRun.record.control.samples[0].actors[0].instanceId, instanceId);
  assert.deepEqual(instanceRun.record.control.samples[0].actors[0].position, [entryScene.actors[0].position[0] + 5, entryScene.actors[0].position[1]]);
  assert.deepEqual(instanceRun.record.control.samples[0].actors[1].position, entryScene.actors[1].position);
  assert.deepEqual(instanceRun.record.control.samples[1].actors[0].position, instanceRun.record.control.samples[0].actors[0].position);
  assert.deepEqual(instanceRun.record.control.samples[1].actors[1].position, entryScene.actors[1].position);
  const foreign = structuredClone(instanceReplay); foreign.steps[0].inputs[0].instanceId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const rejected = await runProjectBuild({ buildDirectory: directory, tool, timeoutMs: 60000, controlProgram: foreign });
  assert.equal(rejected.ok, false); assert.equal(rejected.diagnostics[0].code, 'runtime_control_target_missing');
  assert.equal(rejected.record, undefined);
  const assemblyPath = path.join(project, 'assembly.json'), assembly = await fs.readFile(assemblyPath);
  await fs.rm(assemblyPath);
  await assert.rejects(adapter.executePhase({ phase: 'run', tool: identified, directory: project, targetKind: 'project', controlProgram: replay }), { errorCode: 'build_assembly_invalid' });
  await fs.writeFile(assemblyPath, assembly);
});
