// Real Godot / ordinary author event / native platform integration. Separate
// from the default test list; only disposable fixtures and a new proof directory.
import '../adapters/node-studio-core.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { inspectBackendProject } from '../adapters/node-backend-project.mjs';
import { planBackendProjectDelivery, verifyBackendProjectDelivery } from '../adapters/node-backend-project-delivery.mjs';
import { GODOT4_EXECUTION_ADAPTER as adapter } from '../backends/godot4-adapter.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { GODOT_PHYSICS_SENSOR_SCRIPT } from '../../engine/godot-physics-sensor-script.mjs';
import { GODOT_PLATFORM_CONTROL_SCRIPT } from '../../engine/godot-platform-control-script.mjs';
import { GODOT_PHYSICS_SENSOR_OCCUPANCY_SCRIPT } from '../../engine/godot-physics-sensor-occupancy-script.mjs';
import { scenePhysics2DSensorOccupancyAuthor } from './helpers/scene-physics2d-sensor-occupancy-author-fixture.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidenceRoot = path.join(appRoot, 'docs/test-results/scene-physics2d-sensor-occupancy');
const output = path.resolve(process.env.VIENTO_SENSOR_OCCUPANCY_OUTPUT || path.join(evidenceRoot, `native-${Date.now()}`));
const tool = process.env.VIENTO_GODOT_BIN;
if (!tool || !path.isAbsolute(tool)) throw Error('Set VIENTO_GODOT_BIN to the trusted absolute Godot path.');
if (!output.startsWith(evidenceRoot + path.sep)) throw Error('Use a fresh evidence directory in the sensor-occupancy topic.');
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw Error('Use a fresh empty evidence directory.');
const hash = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => hash(JSON.stringify(value));
const sources = ['engine/godot-physics-sensor-occupancy-script.mjs', 'engine/godot-physics-sensor-script.mjs',
  'engine/godot-platform-control-script.mjs', 'engine/script-authoring.mjs', 'engine/project-event-positions.mjs',
  'engine/project-runtime-events.mjs', 'engine/scene-physics2d.mjs', 'scripts/backends/godot4-adapter.mjs',
  'scripts/backends/godot4-physics-platform-control.mjs', 'scripts/backends/godot4/physics-platform-control-helper.gd',
  'scripts/adapters/node-project-build.mjs', 'scripts/adapters/node-build-snapshot.mjs',
  'scripts/adapters/node-backend-project.mjs', 'scripts/adapters/node-backend-project-delivery.mjs',
  'scripts/lib/export-package.mjs', 'scripts/lib/resource-package-reader.mjs', 'scripts/lib/resource-package-transaction.mjs',
  'scripts/tests/helpers/scene-physics2d-sensor-occupancy-author-fixture.mjs', 'scripts/tests/scene-physics2d-sensor-occupancy-smoke.mjs'];
const report = { format: 'viento-sensor-occupancy-native-proof', schemaVersion: 1, startedAt: new Date().toISOString(),
  sources: Object.fromEntries(await Promise.all(sources.map(async name => [name, hash(await fs.readFile(path.join(appRoot, name)))]))),
  cases: [], limitations: ['Real Linux Godot headless execution with ordinary author TXT; no installed Tauri, Android, window rendering or Bevy claim.',
    'The native probe moves genuine frozen CharacterBody2D nodes at named steps to create independently observable Area2D transitions. It does not fabricate runtime protocol frames.',
    'Selective resource packages carry saved starter TXT, typed parameters and relationships. Destination project types/templates are explicit seed definitions, not claimed to be transferred by that package.',
    'Starter reflection / duplicate signals / body destruction edge cases have a separate native test. This report covers integration, author migration and generated-project delivery.'] };
const logs = [];
const sanitize = value => value.replaceAll('/home/chiharukiryu/.cache/io.viento.studio/toolchains', '<toolchains>').replaceAll(appRoot, '<app-root>').replace(/\/tmp\/viento-[^\s"'\\]+/g, '<temporary>');
async function hashes(directory, prefix = '') {
  const result = {};
  for (const row of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${row.name}` : row.name;
    if (row.isDirectory()) Object.assign(result, await hashes(directory, name));
    else { assert.ok(row.isFile()); result[name] = hash(await fs.readFile(path.join(directory, name))); }
  }
  return result;
}
const probes = text => text.split('\n').filter(line => line.startsWith('OCCUPANCY_PROBE:')).map(line => JSON.parse(line.slice('OCCUPANCY_PROBE:'.length)));
function assertClean(result, plan) {
  assert.equal(result.status, 'succeeded', result.stdout + result.stderr);
  assert.deepEqual(adapter.diagnostics(result, plan), [], result.stdout + result.stderr);
  assert.ok(!/Assertion failed|SCRIPT ERROR:|Parse Error:/.test(result.stdout + result.stderr), result.stdout + result.stderr);
}
async function stage(f, captured) {
  const generated = await adapter.generate(captured.plan), directory = await fs.mkdtemp(path.join(f.temporary, 'occupancy-staged-'));
  for (const [name, bytes] of [...generated.files, ...[...generated.resourceFiles].map(([id, name]) => [name, captured.resources.get(id)])]) {
    const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
  }
  return { directory, generated };
}
async function execute(captured, generated, directory, label) {
  const identified = await adapter.identify(tool);
  for (const phase of adapter.runtimePhases) {
    const imported = await adapter.executePhase({ phase, directory, tool: identified, timeoutMs: 60000 });
    logs.push(`CASE ${label} ${phase}\n${imported.stdout}${imported.stderr}`); assertClean(imported, captured.plan);
  }
  const result = await adapter.executePhase({ phase: 'run', directory, tool: identified, timeoutMs: 60000 });
  logs.push(`CASE ${label} run\n${result.stdout}${result.stderr}`); assertClean(result, captured.plan);
  const reader = adapter.createEventReader(captured.plan, { smoke: true, protocolVersion: generated.backend.protocolVersion,
    capabilities: generated.backend.capabilities });
  reader.push(result.stdout); assert.deepEqual(reader.finish().diagnostics, [], result.stdout);
  assert.equal(reader.lifecycle.completed, true);
  return { probes: probes(result.stdout), eventPositions: reader.eventPositions,
    projectEvents: reader.projectEvents, physics: reader.snapshot?.(), events: reader.events, tool: identified };
}
function platform(row, instanceId) { return row.platforms.find(item => item.instanceId === instanceId); }
function assertWindow(rows, start, end, expected, instanceId, label) {
  const selected = rows.filter(row => row.step >= start && row.step <= end);
  assert.ok(selected.length >= Math.max(1, end - start), `${label}: missing samples`);
  assert.ok(selected.every(row => platform(row, instanceId).running === expected), `${label}: ${JSON.stringify(selected)}`);
  if (expected) assert.ok(new Set(selected.map(row => platform(row, instanceId).phase)).size > 1, `${label}: platform did not advance`);
  else assert.equal(new Set(selected.map(row => platform(row, instanceId).phase)).size, 1, `${label}: paused platform advanced`);
}
function assertChoreography(f, result) {
  const rows = result.probes.filter(row => row.visit === 1);
  assertWindow(rows, 3, 8, true, f.platformInstanceId, 'A leaves B remains');
  assertWindow(rows, 12, 16, false, f.platformInstanceId, 'last occupant left and other plate cannot resume');
  assertWindow(rows, 20, 28, true, f.platformInstanceId, 'reentry resumes first platform');
  assertWindow(rows, 3, 12, false, f.stationaryInstanceId, 'second platform stays paused before own plate');
  assertWindow(rows, 16, 17, true, f.stationaryInstanceId, 'second plate alone resumes second platform');
  assertWindow(rows, 21, 28, false, f.stationaryInstanceId, 'second plate final departure pauses only second platform');
  const primary = result.events.filter(row => row.event === 'event-publish' && row.bindingId === f.sensorBindingId);
  assert.deepEqual(primary.map(row => [row.name, row.value]), [['physics.occupied', f.sensorInstanceId], ['physics.vacant', f.sensorInstanceId], ['physics.occupied', f.sensorInstanceId]]);
  const secondary = result.events.filter(row => row.event === 'event-publish' && row.bindingId === f.sensorTwoBindingId);
  assert.deepEqual(secondary.map(row => [row.name, row.value]), [['physics.occupied', f.sensorTwoInstanceId], ['physics.vacant', f.sensorTwoInstanceId]]);
  const legacy = result.events.filter(row => row.event === 'event-publish' && row.bindingId === f.legacyBindingId);
  assert.deepEqual(legacy.map(row => [row.name, row.value]), [['legacy.entered', f.instanceId], ['legacy.exited', f.instanceId]]);
  assert.equal(result.eventPositions.phase, 'finished');
  for (const [bindingId, sourceId] of [[f.sensorBindingId, f.sensorScriptId], [f.sensorTwoBindingId, f.sensorTwoScriptId]]) {
    const entries = result.eventPositions.items.filter(row => row.origin.bindingId === bindingId);
    assert.ok(entries.length > 0);
    for (const entry of entries) {
      const scene = f.captured.plan.scenes.find(scene => scene.scene.objectId === entry.origin.sceneId);
      const binding = scene.behaviors.bindings.find(binding => binding.bindingId === bindingId);
      assert.equal(binding.sourceObjectId || binding.implementation?.sourceObjectId || scene.behaviors.sources.find(source => source.objectId === sourceId)?.objectId, sourceId);
      assert.deepEqual(entry.origin.source, binding.declaration);
      assert.ok(Number.isSafeInteger(entry.published.executionFrameIndex));
      assert.ok(entry.deliveries.length === 2);
      for (const delivery of entry.deliveries) {
        assert.equal(delivery.status, 'handled');
        assert.ok([f.controlBindingId, f.controlTwoBindingId].includes(delivery.origin.bindingId));
        const receiver = scene.behaviors.bindings.find(binding => binding.bindingId === delivery.origin.bindingId);
        assert.deepEqual(delivery.origin.source, receiver.declaration);
        assert.ok(delivery.delivered.executionFrameIndex >= entry.published.executionFrameIndex);
      }
    }
  }
}
async function archiveExtract(zip, target) {
  const archive = await yauzl.openPromise(zip, { lazyEntries: true, autoClose: false });
  try { for await (const entry of archive.eachEntry()) {
    assert.ok(!entry.fileName.startsWith('/') && !entry.fileName.split('/').includes('..'));
    const chunks = []; for await (const bytes of await archive.openReadStreamPromise(entry)) chunks.push(bytes);
    const file = path.join(target, entry.fileName); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.concat(chunks));
  } } finally { await new Promise(resolve => { archive.reader.once('close', resolve); archive.close(); }); }
}
async function runCase(name, operation) {
  const cleanups = [], fixture = { after: fn => cleanups.push(fn) };
  try { const value = await operation(fixture); report.cases.push({ name, passed: true, ...value }); console.log(`PASS ${name}`); }
  finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
}
try {
  report.tool = await adapter.identify(tool);
  report.node = { version: process.version, sha256: hash(await fs.readFile(process.execPath)) };
  await runCase('two-occupants-two-filtered-platforms', async t => {
    const f = await scenePhysics2DSensorOccupancyAuthor(t), before = await hashes(f.author);
    f.captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(f.captured.ok, true, JSON.stringify(f.captured.diagnostics));
    const staged = await stage(f, f.captured), result = await execute(f.captured, staged.generated, staged.directory, 'two-occupants');
    assertChoreography(f, result);
    assert.deepEqual(await hashes(f.author), before);
    for (const [name, bytes] of staged.generated.files) assert.deepEqual(await fs.readFile(path.join(staged.directory, name)), bytes, name);
    return { backend: staged.generated.backend, authorFiles: Object.keys(before).length, authorSha256: jsonHash(before), authorUnchanged: true,
      generatedUnchanged: true, legacySensorCoexists: true, legacySensorPublications: result.events.filter(row => row.event === 'event-publish' && row.bindingId === f.legacyBindingId), probes: result.probes, eventPositions: result.eventPositions, projectEvents: result.projectEvents };
  });
  await runCase('scene-exit-and-reentry-reset-without-vacant-tail', async t => {
    const f = await scenePhysics2DSensorOccupancyAuthor(t, { roundTrip: true }), before = await hashes(f.author);
    f.captured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(f.captured.ok, true, JSON.stringify(f.captured.diagnostics));
    const staged = await stage(f, f.captured), result = await execute(f.captured, staged.generated, staged.directory, 'roundtrip');
    const publications = result.events.filter(row => row.event === 'event-publish' && [f.sensorBindingId, f.sensorTwoBindingId].includes(row.bindingId));
    assert.deepEqual(publications.map(row => [row.visitIndex, row.name, row.value]), [[1, 'physics.occupied', f.sensorInstanceId], [3, 'physics.occupied', f.sensorInstanceId]]);
    const returned = result.probes.filter(row => row.visit === 3 && row.step >= 3);
    assert.ok(returned.length >= 5); assert.ok(returned.every(row => platform(row, f.platformInstanceId).running));
    assert.ok(new Set(returned.map(row => platform(row, f.platformInstanceId).phase)).size > 2);
    assert.deepEqual(await hashes(f.author), before);
    return { authorUnchanged: true, authorSha256: jsonHash(before), probes: result.probes, eventPositions: result.eventPositions,
      publications, visits: result.events.filter(row => ['scene-enter', 'scene-exit'].includes(row.event)) };
  });
  await runCase('selective-author-migration-and-offline-generated-delivery', async t => {
    const f = await scenePhysics2DSensorOccupancyAuthor(t);
    // Deliberately retain authored line endings and an independent template.
    const rawManifest = '\uFEFF' + JSON.stringify(await f.read(f.manifestPath), null, '\t').replaceAll('\n', '\r\n') + '\r\n';
    await fs.writeFile(path.join(f.author, f.manifestPath), rawManifest);
    const rawScript = GODOT_PHYSICS_SENSOR_OCCUPANCY_SCRIPT.replaceAll('\n', '\r\n');
    await f.script('sensor', rawScript);
    const before = await hashes(f.author), registry = await readRegistry(f.author), catalog = await readPackageCatalog(f.author);
    const exportPlan = await planExport(f.author, { kind: 'resources', revision: catalog.revision, ids: [f.assemblyId], includeDependencies: true, includeChildren: false });
    const authorZip = path.join(f.temporary, 'occupancy.viento-package.zip'); await writeExportZip(exportPlan, authorZip);
    const unpacked = path.join(f.temporary, 'author-unpacked'); await fs.mkdir(unpacked);
    const pack = await unpackResourcePackage(authorZip, unpacked);
    const transferred = new Set(pack.manifest.documents.map(item => item.id));
    for (const id of [f.assemblyId, f.sceneIds[0], f.physicsId, f.manifestId, f.sensorScriptId, f.sensorTwoScriptId, f.controlScriptId, f.controlTwoScriptId, f.legacyScriptId]) assert.ok(transferred.has(id), id);
    const target = path.join(f.temporary, 'migrated-author');
    await fs.cp(f.author, target, { recursive: true });
    const workspacePath = path.join(target, 'workspace.json'), workspace = JSON.parse(await fs.readFile(workspacePath, 'utf8'));
    workspace.id = randomUUID(); workspace.version = 2; workspace.paths = { documents: 'design-data', templates: 'data-template', metadata: 'metadata' };
    await fs.rename(path.join(target, 'templates'), path.join(target, 'data-template')); await fs.writeFile(workspacePath, JSON.stringify(workspace, null, 2) + '\n');
    for (const name of ['documents', 'metadata', 'assets', '.viento']) await fs.rm(path.join(target, name), { recursive: true, force: true });
    for (const name of ['design-data', 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(target, name), { recursive: true });
    const preview = await planPackageImport(target, pack); assert.deepEqual(preview.summary.conflicts, []);
    assert.equal((await applyPackageImport(target, pack, preview.revision)).status, 'imported');
    const restored = await readRegistry(target);
    for (const original of registry.documents.filter(item => transferred.has(item.id))) {
      const copied = restored.documents.find(item => item.id === original.id);
      assert.equal(copied.sourcePath, original.sourcePath.replace(/^documents\//, 'design-data/'));
      assert.deepEqual(await fs.readFile(path.join(target, copied.sourcePath)), await fs.readFile(path.join(f.author, original.sourcePath)));
      assert.deepEqual(copied.relations, original.relations); assert.deepEqual(copied.assetBindings, original.assetBindings);
    }
    assert.equal(await fs.readFile(path.join(target, 'design-data/scripts/sensor.txt'), 'utf8'), rawScript);
    assert.equal(await fs.readFile(path.join(target, 'design-data/behaviors/demo.json'), 'utf8'), rawManifest);
    const captured = await captureBuildSnapshot(target, f.assemblyId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
    const oldCaptured = await captureBuildSnapshot(f.author, f.assemblyId); assert.equal(oldCaptured.ok, true, JSON.stringify(oldCaptured.diagnostics));
    assert.deepEqual(captured.plan.requiredCapabilities, oldCaptured.plan.requiredCapabilities);
    const buildDirectory = path.join(f.temporary, 'migrated-build');
    const built = await buildProject({ root: target, targetId: f.assemblyId, tool, output: buildDirectory, timeoutMs: 60000 });
    assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built));
    const frozenHashes = await hashes(path.join(buildDirectory, 'project'));
    const session = await runProjectBuild({ buildDirectory, tool, timeoutMs: 60000 });
    assert.equal(session.ok, true, JSON.stringify(session.record?.diagnostics || session));
    const runText = session.record.phases.filter(item => item.phase === 'run').map(item => item.stdout).join('\n');
    logs.push(`CASE migrated-host\n${runText}`);
    const migrated = { ...f, captured }, generated = await adapter.generate(captured.plan);
    const decoded = adapter.createEventReader(captured.plan, { smoke: true, protocolVersion: generated.backend.protocolVersion, capabilities: generated.backend.capabilities });
    decoded.push(runText); assert.deepEqual(decoded.finish().diagnostics, []);
    assertChoreography(migrated, { probes: probes(runText), events: decoded.events, eventPositions: decoded.eventPositions });
    // Cancel a continuous isolated session after it has genuinely started; the
    // frozen generated project and author sources are checked again afterward.
    const controller = new AbortController(); let cancelledAfterReady = false;
    const cancelled = await runProjectBuild({ buildDirectory, tool, timeoutMs: 60000, smoke: false, signal: controller.signal,
      onProgress: event => { if (event.event?.event === 'ready' && !cancelledAfterReady) { cancelledAfterReady = true; controller.abort(); } } });
    assert.equal(cancelledAfterReady, true); assert.equal(cancelled.ok, false); assert.equal(cancelled.record.status, 'cancelled');
    for (const row of await fs.readdir(path.join(buildDirectory, 'sessions'), { withFileTypes: true })) if (row.isDirectory()) {
      await assert.rejects(fs.stat(path.join(buildDirectory, 'sessions', row.name, 'project')), { code: 'ENOENT' });
    }
    assert.deepEqual(await hashes(path.join(buildDirectory, 'project')), frozenHashes);
    const inspect = () => inspectBackendProject({ buildDirectory });
    const delivery = await planBackendProjectDelivery({ inspection: await inspect(), assertCurrent: inspect });
    const zip = path.join(f.temporary, 'occupancy.viento-build.zip'); await writeExportZip(delivery, zip); await verifyBackendProjectDelivery(zip);
    const archiveBytes = await fs.readFile(zip), moved = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-occupancy-offline-'));
    t.after(() => fs.rm(moved, { recursive: true, force: true })); await archiveExtract(zip, moved);
    assert.equal(await fs.readFile(path.join(moved, 'project/behaviors', `${f.sensorScriptId}.gd`), 'utf8'), rawScript);
    assert.equal(await fs.readFile(path.join(moved, 'project/behaviors', `${f.controlScriptId}.gd`), 'utf8'), GODOT_PLATFORM_CONTROL_SCRIPT);
    assert.deepEqual(await hashes(f.author), before);
    const targetHashes = await hashes(target); await fs.rename(f.author, f.author + '.offline'); await fs.rename(target, target + '.offline'); await fs.rename(buildDirectory, buildDirectory + '.offline');
    const offline = await execute(captured, generated, path.join(moved, 'project'), 'offline-delivered'); assertChoreography(migrated, offline);
    assert.deepEqual(await hashes(f.author + '.offline'), before); assert.deepEqual(await hashes(target + '.offline'), targetHashes);
    return { importedDocuments: transferred.size, originalAuthorUnchanged: true, restoredAuthorUnchanged: true,
      scriptBytes: Buffer.byteLength(rawScript), scriptSha256: hash(rawScript), manifestSha256: hash(rawManifest),
      package: { bytes: (await fs.stat(authorZip)).size, sha256: hash(await fs.readFile(authorZip)) },
      delivery: { bytes: archiveBytes.length, sha256: hash(archiveBytes), originalAuthorOffline: true, restoredAuthorOffline: true, originalBuildOffline: true },
      cancelledAfterReady, cancellation: { status: cancelled.record.status, sessionsCleaned: true, frozenProjectUnchanged: true },
      host: { status: session.record.status, eventPositions: session.record.eventPositions },
      offline: { probes: offline.probes, eventPositions: offline.eventPositions } };
  });
  for (const [name, expected] of Object.entries(report.sources)) assert.equal(hash(await fs.readFile(path.join(appRoot, name))), expected, `Source changed: ${name}`);
  assert.equal(GODOT_PHYSICS_SENSOR_SCRIPT.includes('entered_event'), true);
  report.sourceSnapshotUnchanged = true; report.ok = true; report.passed = report.cases.length; report.failed = 0;
} catch (error) { report.ok = false; report.failure = error.stack; console.error(error); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, 'native.json'), sanitize(JSON.stringify(report, null, 2)) + '\n');
  await fs.writeFile(path.join(output, 'stdout.log'), sanitize(logs.join('\n')));
  console.log(`Evidence: ${path.relative(appRoot, output)}`);
}
