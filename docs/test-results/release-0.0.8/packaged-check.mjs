// Run after desktop/mobile preparation using the pinned embedded Node:
// VIENTO_BEVY_BIN=/absolute/pinned-host VIENTO_GODOT_BIN=/absolute/Godot VIENTO_STUDIO_CORE_BIN=/absolute/viento-core src-tauri/binaries/viento-node-x86_64-unknown-linux-gnu --experimental-vm-modules docs/test-results/release-0.0.8/packaged-check.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const mobileRewrite = source => source.replaceAll("from 'yaml'", "from '/vendor/yaml/index.js'")
  .replaceAll("from '../node_modules/yaml/browser/index.js'", "from '/vendor/yaml/index.js'");
const bevy = process.env.VIENTO_BEVY_BIN, godot = process.env.VIENTO_GODOT_BIN;
const backendId = 'org.viento.bevy', sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
assert.equal(process.version, 'v24.20.0', 'Use the pinned embedded Node');
assert.ok(bevy && path.isAbsolute(bevy) && godot && path.isAbsolute(godot), 'Provide both existing engine tools');
const { verifyReleaseVersions, installerVersions } = await import(pathToFileURL(path.join(root, 'desktop/version.mjs')));
const release = await verifyReleaseVersions(root);
assert.equal(release.version, '0.0.8');
const hostTool = JSON.parse(await fs.readFile(path.join(evidence, 'host-tool.json')));
assert.equal(bevy, hostTool.path); assert.equal(hash(await fs.readFile(bevy)), hostTool.sha256);
const report = { ok: false, recordedAt: new Date().toISOString(),
  scope: 'Prepared desktop modules run under pinned embedded Node with the external trusted Bevy host and actual Godot. Both execute identical frozen plans offline. Prepared mobile modules execute only renderer-independent frame admission and capability checks and typed runtime object observations/queries and global and per-instance finite control replay admission in an isolated VM; no installed desktop window, Android device/UI or Android engine execution is claimed.',
  embeddedNode: { version: process.version, sha256: hash(await fs.readFile(process.execPath)) },
  externalBevyTool: hostTool, release: { ...release, ...installerVersions(release.version) }, artifacts: {}, runtime: {} };

const shared = [...(await fs.readdir(path.join(root, 'engine'))).filter(file => file.endsWith('.mjs')).map(file => `engine/${file}`),
  'engine/studio-core.wasm', 'engine/studio-core.build.json', 'web/project-build.css',
  ...['app-runtime.js', 'app-project-build.js', 'app-scene-preview.js', 'app-scene-composition-overrides.js'].map(file => `web/modules/${file}`),
  ...['messages.js', 'en.js', 'ja.js'].map(file => `web/i18n/${file}`)];
const host = ['scripts/adapters/node-execution-backends.mjs', 'scripts/adapters/node-execution-tool.mjs',
  'scripts/adapters/node-project-build.mjs', 'scripts/adapters/node-build-snapshot.mjs', 'scripts/adapters/node-world-projection.mjs',
  'scripts/adapters/node-studio-core.mjs', 'scripts/lib/project-build-service.mjs', 'scripts/lib/build-process.mjs',
  'scripts/project-build.mjs', 'scripts/lib/doc-api-service.mjs',
  'scripts/backends/bevy-adapter.mjs', 'scripts/backends/bevy-project.mjs',
  'scripts/backends/godot4-adapter.mjs', 'scripts/backends/godot4-behaviors.mjs', 'scripts/backends/godot4.mjs',
  'scripts/backends/godot4-dispatch.mjs', 'scripts/backends/godot4-instances.mjs',
  'scripts/backends/godot4/runtime.gd', 'scripts/backends/godot4/runtime-v2.gd', 'scripts/backends/godot4/behavior-runtime.gd',
  'scripts/backends/godot4/control-runtime.gd', 'scripts/backends/godot4/control.tscn'];
for (const [artifact, extra] of [['desktop/resources', host], ['mobile/dist', ['mobile/platform.mjs']]]) {
  const hashes = {};
  for (const file of [...shared, ...extra]) {
    const source = await fs.readFile(path.join(root, file)), prepared = await fs.readFile(path.join(root, artifact, file));
    const expected = artifact === 'mobile/dist' && file.startsWith('engine/') && file.endsWith('.mjs') ? Buffer.from(mobileRewrite(source.toString('utf8'))) : source;
    assert.equal(hash(prepared), hash(expected), `Prepared source mismatch: ${artifact}/${file}`);
    hashes[file] = { sourceSha256: hash(source), packagedSha256: hash(prepared), importRewrite: !source.equals(prepared) };
  }
  report.artifacts[artifact] = { checkedFiles: Object.keys(hashes).length, hashes };
}
const frozen = JSON.parse(await fs.readFile(path.join(evidence, 'frozen-backend-baseline.json')));
for (const [file, expected] of Object.entries(frozen)) {
  assert.equal(hash(await fs.readFile(path.join(root, file))), expected, `Historical source: ${file}`);
  assert.equal(hash(await fs.readFile(path.join(root, 'desktop/resources', file))), expected, `Historical prepared source: ${file}`);
}
report.frozenBackendAndCoreSha256 = frozen;
for (const artifact of ['desktop/resources', 'mobile/dist']) {
  await assert.rejects(fs.stat(path.join(root, artifact, 'crates/viento-bevy-runtime')), { code: 'ENOENT' });
  const entries = await fs.readdir(path.join(root, artifact), { recursive: true, withFileTypes: true });
  assert.ok(!entries.some(entry => entry.name.startsWith('viento-bevy-runtime') || entry.name === 'Cargo.lock'));
}
await assert.rejects(fs.stat(path.join(root, 'mobile/dist/scripts/backends')), { code: 'ENOENT' });
await assert.rejects(fs.stat(path.join(root, 'mobile/dist/scripts/adapters')), { code: 'ENOENT' });
report.rustCrateAndBevyBinaryNotBundled = true;
report.mobileHasNoExecutionAdapters = true;

const desktop = path.join(root, 'desktop/resources');
const imported = file => import(pathToFileURL(path.join(desktop, file)));
const { BEVY_EXECUTION_ADAPTER: adapter } = await imported('scripts/backends/bevy-adapter.mjs');
const { BEVY_EXECUTION_ADAPTER: sourceAdapter } = await import(pathToFileURL(path.join(root, 'scripts/backends/bevy-adapter.mjs')));
const { GODOT4_EXECUTION_ADAPTER: godotAdapter } = await imported('scripts/backends/godot4-adapter.mjs');
const { createExecutionBackendRegistry } = await imported('scripts/adapters/node-execution-backends.mjs');
const { executionHostConfiguration } = await imported('scripts/adapters/node-execution-tool.mjs');
const { captureBuildSnapshot } = await imported('scripts/adapters/node-build-snapshot.mjs');
const { captureBuildSnapshot: captureSourceBuildSnapshot } = await import(pathToFileURL(path.join(root, 'scripts/adapters/node-build-snapshot.mjs')));
const { buildProject, runProjectBuild } = await imported('scripts/adapters/node-project-build.mjs');
const { createProjectBuildService } = await imported('scripts/lib/project-build-service.mjs');
const { querySceneRuntimeObservation } = await imported('engine/scene-runtime-query.mjs');
const { canonicalJson } = await imported('engine/canonical-json.mjs');
const { validateSceneControlProgram, validateSceneControlPlan } = await imported('engine/scene-control-program.mjs');
const input = (right = false, left = false) => ({ left, right, up: false, down: false });
const controlProgram = validateSceneControlProgram({ format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125,
  steps: [input(true), input(), input(false, true), input()] });
const controlSha256 = `sha256:${hash(canonicalJson(controlProgram))}`;
const instanceFirst = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', instanceSecond = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const instanceInput = (instanceId, left = false, right = false, up = false, down = false) => ({ instanceId, left, right, up, down });
const instanceProgram = validateSceneControlProgram({ format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.125,
  steps: [{ inputs: [instanceInput(instanceFirst, false, true), instanceInput(instanceSecond, true)] },
    { inputs: [instanceInput(instanceSecond, false, false, true)] }, { inputs: [instanceInput(instanceFirst, true)] }, { inputs: [] }] });
const instanceProgramSha256 = `sha256:${hash(canonicalJson(instanceProgram))}`;
const descriptors = createExecutionBackendRegistry().descriptors();
assert.deepEqual(descriptors.map(item => item.id), ['org.viento.godot4', backendId]);
assert.deepEqual(executionHostConfiguration({ env: {} }), { backendId: 'org.viento.godot4', tool: undefined });
const configuration = executionHostConfiguration({ env: { VIENTO_EXECUTION_BACKEND: backendId, VIENTO_BEVY_BIN: bevy, VIENTO_GODOT_BIN: godot } });
assert.deepEqual(configuration, { backendId, tool: bevy });
const fingerprint = await adapter.fingerprint(); assert.deepEqual(fingerprint, await sourceAdapter.fingerprint());
const tool = await adapter.identify(bevy); assert.equal(tool.sha256, hostTool.sha256);
report.runtime.registry = plain(descriptors); report.runtime.hostConfiguration = configuration;
report.runtime.executionFingerprint = fingerprint; report.runtime.identifiedBevyTool = tool;

async function inventory(directory) {
  const result = {};
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name); result[path.relative(directory, file)] = hash(await fs.readFile(file));
  }
  return result;
}
function mobileGraph(base) {
  const context = vm.createContext({ TextEncoder, TextDecoder }), modules = new Map();
  function load(identifier) {
    const url = identifier instanceof URL ? identifier : pathToFileURL(path.join(base, identifier));
    const file = fileURLToPath(url); assert.ok(file.startsWith(base + path.sep));
    if (!modules.has(url.href)) modules.set(url.href, fs.readFile(file, 'utf8').then(source => new vm.SourceTextModule(source, { context, identifier: url.href })));
    return modules.get(url.href);
  }
  async function entry(file) {
    const module = await load(file);
    if (module.status === 'unlinked') await module.link((specifier, parent) => {
      assert.ok(specifier.startsWith('.'), `Forbidden portable import: ${specifier}`);
      return load(new URL(specifier, parent.identifier));
    });
    if (module.status === 'linked') await module.evaluate();
    return module.namespace;
  }
  const data = value => { context.inputJson = JSON.stringify(value); return vm.runInContext('JSON.parse(inputJson)', context); };
  return { context, entry, data,
    async states() { return Promise.all([...modules].map(async ([url, pending]) => ({ file: path.relative(base, fileURLToPath(url)), status: (await pending).status }))); } };
}
async function settle(service) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const status = await service.status(); if (status.job?.status !== 'running') return status;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Prepared build service did not settle.');
}

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-instance-packaged-'));
const actualLogs = [], sessions = [], oldGoldens = [];
let service;
try {
  for (const version of [1, 2]) {
    const work = path.join(temporary, `workspace-v${version}`);
    await fs.cp(path.join(root, 'examples/bevy-headless'), work, { recursive: true });
    if (version === 1) {
      const file = path.join(work, 'documents/scenes/demo.json'), value = JSON.parse(await fs.readFile(file));
      value.schemaVersion = 1; value.actors = [value.actors[0]]; delete value.actors[0].instanceId;
      await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
    }
    const before = await inventory(work), captured = await captureBuildSnapshot(work, sceneId);
    assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics)); assert.equal(captured.plan.schemaVersion, version);
    const sourceCaptured = await captureSourceBuildSnapshot(work, sceneId);
    assert.deepEqual(sourceCaptured.snapshot, captured.snapshot); assert.equal(sourceCaptured.snapshotId, captured.snapshotId);
    const generated = await adapter.generate(captured.plan), sourceGenerated = await sourceAdapter.generate(captured.plan);
    assert.deepEqual(generated, sourceGenerated); assert.equal(generated.files.size, 1); assert.equal(generated.resourceFiles.size, 0);
    const content = JSON.parse(generated.files.get('scene-data.json'));
    assert.deepEqual(Object.keys(content).sort(), ['actors', 'format', 'resources', 'scene', 'schemaVersion']);
    assert.ok(content.actors.every(actor => actor.sourcePath === undefined && actor.declaration === undefined && actor.origin === undefined));
    const engines = [];
    for (const [selected, executable] of [[backendId, bevy], ['org.viento.godot4', godot]]) {
      const output = path.join(temporary, `build-v${version}-${selected.split('.').at(-1)}`);
      const built = await buildProject({ root: work, scene: sceneId, backendId: selected, tool: executable, output, expectedSnapshotId: captured.snapshotId });
      assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built.diagnostics));
      assert.equal(built.record.snapshotId, captured.snapshotId);
      assert.deepEqual(await inventory(work), before);
      await fs.rename(work, work + '-offline');
      const outputBefore = await inventory(path.join(output, 'project'));
      const replay = await runProjectBuild({ buildDirectory: output, backendId: selected, tool: executable });
      assert.equal(replay.ok, true, JSON.stringify(replay.record?.diagnostics || replay.diagnostics));
      assert.deepEqual(replay.record.events.map(event => event.event), ['ready', 'state', 'state', 'finished']);
      assert.equal(replay.record.events.at(-1).actors[0].position[0], 240);
      if (version === 2) assert.equal(replay.record.events.at(-1).actors[1].position[0], 500);
      assert.deepEqual(await inventory(work + '-offline'), before);
      await assert.rejects(fs.stat(path.join(replay.sessionDirectory, 'project')), { code: 'ENOENT' });
      const runPhase = replay.record.phases.find(item => item.phase === 'run');
      assert.equal(replay.record.runtime.phase,'finished');
      assert.equal(replay.record.runtime.sequence,4);
      assert.ok(replay.record.runtime.actors.every(actor=>actor.positionCurrent && actor.positionSample==='finished'));
      assert.deepEqual(replay.record.runtime.actors.map(actor=>actor.position),replay.record.events.at(-1).actors.map(actor=>actor.position));
      const observed=querySceneRuntimeObservation(replay.record.runtime,{objectId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
      assert.equal(observed.actors.length,version===1?1:2);
      actualLogs.push({ backendId: selected, protocolVersion: version, stdout: runPhase.stdout, events: replay.record.events, plan: captured.plan, observation:replay.record.runtime });
      assert.deepEqual(await inventory(path.join(output, 'project')), outputBefore);
      validateSceneControlPlan(captured.plan, controlProgram);
      const controlled = await runProjectBuild({ buildDirectory: output, backendId: selected, tool: executable, controlProgram });
      assert.equal(controlled.ok, true, JSON.stringify(controlled.record?.diagnostics || controlled.diagnostics));
      assert.deepEqual(controlled.record.control.program, controlProgram);
      assert.equal(controlled.record.control.sha256, controlSha256); assert.equal(controlled.record.control.samples.length, 4);
      assert.deepEqual(controlled.record.events.map(event => event.event), ['ready', 'state', 'state', 'state', 'state', 'finished']);
      assert.deepEqual(controlled.record.control.samples.map(sample => sample.actors[0].position), [[220,220],[220,220],[200,220],[200,220]]);
      if (version === 2) assert.ok(controlled.record.control.samples.every(sample => sample.actors[1].position[0] === 500));
      assert.deepEqual(controlled.record.events.at(-1).actors, controlled.record.control.samples.at(-1).actors);
      assert.equal(controlled.record.runtime.phase, 'finished'); assert.equal(controlled.record.runtime.sequence, 10);
      assert.deepEqual(controlled.record.runtime.control, { stepCount: 4, completedSteps: 4, fixedDelta: 0.125 });
      assert.ok(controlled.record.runtime.actors.every(actor => actor.positionCurrent && actor.positionSample === 'finished'));
      assert.deepEqual(controlled.record.runtime.actors.map(actor => actor.position), controlled.record.events.at(-1).actors.map(actor => actor.position));
      assert.deepEqual(await inventory(work + '-offline'), before); assert.deepEqual(await inventory(path.join(output, 'project')), outputBefore);
      await assert.rejects(fs.stat(path.join(controlled.sessionDirectory, 'project')), { code: 'ENOENT' });
      const controlledPhase = controlled.record.phases.find(item => item.phase === 'run');
      assert.match(controlledPhase.stdout, /VIENTO_TRACE:/);
      actualLogs.push({ backendId: selected, protocolVersion: version, stdout: controlledPhase.stdout, events: controlled.record.events,
        plan: captured.plan, observation: controlled.record.runtime, control: controlled.record.control });
      engines.push({ backendId: selected, tool: built.record.tool, artifact: built.record.artifact,
        buildPhases: built.record.phases.map(({ phase, status }) => ({ phase, status })), offlineStatus: replay.status,
        events: replay.record.events, observation:replay.record.runtime, sourceTreeByteIdentical: true, sessionProjectRemoved: true,
        controlReplay: { status: controlled.status, program: controlled.record.control.program, sha256: controlled.record.control.sha256,
          samples: controlled.record.control.samples, events: controlled.record.events, observation: controlled.record.runtime,
          sourceTreeByteIdentical: true, frozenGeneratedProjectByteIdentical: true, sessionProjectRemoved: true } });
      await fs.rename(work + '-offline', work);
    }
    assert.deepEqual(engines[0].events, engines[1].events);assert.deepEqual(engines[0].observation,engines[1].observation);
    assert.deepEqual(engines[0].controlReplay, engines[1].controlReplay);
    sessions.push({ planVersion: version, snapshotId: captured.snapshotId, sourceAndPreparedCaptureParity: true,
      sourceAndPreparedGeneratorParity: true, identicalEngineEvents: true,identicalRuntimeObservations:true, identicalControlReplay: true, sourceBefore: before, sourceAfter: await inventory(work), engines });
    const golden = JSON.parse(await fs.readFile(path.join(root, `scripts/tests/fixtures/scene-model/legacy-plan-v${version}.json`)));
    const legacy = await godotAdapter.generate(golden.plan);
    assert.deepEqual(Object.fromEntries([...legacy.files].map(([file, bytes]) => [file, hash(bytes)])), golden.godotFiles);
    assert.deepEqual(legacy.sourceMap, golden.godotSourceMap);
    if (golden.godotBackend) assert.deepEqual(legacy.backend, golden.godotBackend);
    else assert.equal(legacy.backend.sha256, 'dba885d7965715e56b1f1ac394dc78e3227d3502d23318a736dca6eb93beabe6');
    oldGoldens.push({ planVersion: version, backend: legacy.backend, fileHashes: golden.godotFiles, sourceMapUnchanged: true });
  }
  const instanceWork = path.join(temporary, 'workspace-instance-control');
  await fs.cp(path.join(root, 'examples/bevy-headless'), instanceWork, { recursive: true });
  const instanceSceneFile = path.join(instanceWork, 'documents/scenes/demo.json');
  const instanceScene = JSON.parse(await fs.readFile(instanceSceneFile)); instanceScene.actors[1].controls = 'arrows';
  await fs.writeFile(instanceSceneFile, JSON.stringify(instanceScene, null, 2) + '\n');
  const instanceBefore = await inventory(instanceWork), instanceCaptured = await captureBuildSnapshot(instanceWork, sceneId);
  assert.equal(instanceCaptured.ok, true, JSON.stringify(instanceCaptured.diagnostics)); assert.equal(instanceCaptured.plan.schemaVersion, 2);
  assert.equal(new Set(instanceCaptured.plan.actors.map(actor => actor.objectId)).size, 1);
  const instanceSourceCaptured = await captureSourceBuildSnapshot(instanceWork, sceneId);
  assert.equal(instanceSourceCaptured.snapshotId, instanceCaptured.snapshotId); assert.deepEqual(instanceSourceCaptured.snapshot, instanceCaptured.snapshot);
  const instanceSessions = [];
  for (const [selected, executable] of [[backendId, bevy], ['org.viento.godot4', godot]]) {
    const output = path.join(temporary, `build-instances-${selected.split('.').at(-1)}`);
    const built = await buildProject({ root: instanceWork, scene: sceneId, backendId: selected, tool: executable, output, expectedSnapshotId: instanceCaptured.snapshotId });
    assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built.diagnostics));
    const projectBefore = await inventory(path.join(output, 'project'));
    await fs.rename(instanceWork, instanceWork + '-offline');
    const result = await runProjectBuild({ buildDirectory: output, backendId: selected, tool: executable, controlProgram: instanceProgram });
    assert.equal(result.ok, true, JSON.stringify(result.record?.diagnostics || result.diagnostics));
    assert.deepEqual(result.record.control.program, instanceProgram); assert.equal(result.record.control.sha256, instanceProgramSha256);
    assert.deepEqual(result.record.control.samples.map(sample => sample.actors.map(actor => actor.position)),
      [[[220,220],[490,220]], [[220,220],[490,210]], [[200,220],[490,210]], [[200,220],[490,210]]]);
    assert.deepEqual(result.record.control.samples[1].actors.map(actor => actor.state), ['idle','moving']);
    assert.deepEqual(result.record.control.samples[2].actors.map(actor => actor.state), ['moving','idle']);
    assert.ok(result.record.control.samples.at(-1).actors.every(actor => actor.state === 'idle'));
    assert.deepEqual(result.record.events.at(-1).actors, result.record.control.samples.at(-1).actors);
    assert.deepEqual(result.record.runtime.control, { stepCount: 4, completedSteps: 4, fixedDelta: 0.125 }); assert.equal(result.record.runtime.sequence, 12);
    assert.deepEqual(await inventory(instanceWork + '-offline'), instanceBefore); assert.deepEqual(await inventory(path.join(output, 'project')), projectBefore);
    await assert.rejects(fs.stat(path.join(result.sessionDirectory, 'project')), { code: 'ENOENT' });
    const phase = result.record.phases.find(phase => phase.phase === 'run');
    actualLogs.push({ backendId: selected, protocolVersion: 2, stdout: phase.stdout, events: result.record.events,
      plan: instanceCaptured.plan, observation: result.record.runtime, control: result.record.control });
    instanceSessions.push({ backendId: selected, status: result.status, snapshotId: result.record.snapshotId,
      control: result.record.control, events: result.record.events, observation: result.record.runtime,
      authorTreeByteIdentical: true, frozenProjectByteIdentical: true, sessionProjectRemoved: true });
    await fs.rename(instanceWork + '-offline', instanceWork);
  }
  assert.deepEqual(instanceSessions[0].control, instanceSessions[1].control);
  assert.deepEqual(instanceSessions[0].events, instanceSessions[1].events); assert.deepEqual(instanceSessions[0].observation, instanceSessions[1].observation);
  report.runtime.instanceControl = { planVersion: 2, sourceAndPreparedCaptureParity: true,
    sameDefinitionIndependentInstances: true, identicalControlSamplesEventsObservations: true, sessions: instanceSessions };

  const unsupported = [];
  for (const name of ['scene2d', 'scene-behaviors']) {
    const work = path.join(temporary, `unsupported-${name}`); await fs.cp(path.join(root, 'examples', name), work, { recursive: true });
    const before = await inventory(work), captured = await captureBuildSnapshot(work, sceneId);
    assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
    const admission = await buildProject({ root: work, scene: sceneId, ...configuration, output: path.join(temporary, `rejected-${name}`) });
    assert.equal(admission.ok, false);
    assert.ok(admission.diagnostics.some(item => ['build_capability_missing', 'build_backend_plan_unsupported', 'build_behavior_backend_unsupported'].includes(item.code)));
    await assert.rejects(fs.stat(path.join(temporary, `rejected-${name}`)), { code: 'ENOENT' });
    assert.deepEqual(await inventory(work), before);
    unsupported.push({ example: name, planVersion: captured.plan.schemaVersion, diagnostics: admission.diagnostics,
      sourceTreeByteIdentical: true, noOutputCreated: true });
  }
  const serviceWork = path.join(temporary, 'service-workspace'); await fs.cp(path.join(root, 'examples/bevy-headless'), serviceWork, { recursive: true });
  const serviceBefore = await inventory(serviceWork);
  service = createProjectBuildService(serviceWork, { ...configuration, cacheRoot: path.join(temporary, 'service-cache') });
  const initial = await service.status(); assert.equal(initial.backend.id, backendId); assert.equal(initial.available, true);
  for (const payload of [{ tool: bevy }, { backendId: 'org.viento.godot4' }, { executable: bevy }]) {
    await assert.rejects(service.command({ action: 'plan', sceneId, ...payload }), { errorCode: 'build_request_invalid' });
  }
  await service.command({ action: 'plan', sceneId }); const planned = await settle(service); assert.equal(planned.job.status, 'succeeded');
  await service.command({ action: 'build', sceneId, expectedSnapshotId: planned.job.plan.snapshotId }); const built = await settle(service);
  assert.equal(built.job.status, 'succeeded', JSON.stringify(built)); assert.equal(built.latestBuild.backendId, backendId);
  await assert.rejects(service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'window' }), { errorCode: 'build_execution_unsupported' });
  await service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless' }); const replay = await settle(service);
  assert.equal(replay.job.status, 'succeeded', JSON.stringify(replay)); assert.equal(replay.job.events.at(-1).actors[0].position[0], 240);
  assert.equal(replay.job.events.at(-1).actors[1].position[0], 500);
  const inspected=await service.command({action:'inspect',jobId:replay.job.id,instanceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'});
  assert.equal(inspected.actors.length,1);assert.deepEqual(inspected.actors[0].position,[240,220]);
  assert.equal(inspected.snapshotId,replay.job.snapshotId);assert.equal(inspected.buildId,built.latestBuild.id);
  for(const extra of [{tool:bevy},{backendId:'org.viento.godot4'},{entityId:42},{sourcePath:'/tmp/forged'}])
    await assert.rejects(service.command({action:'inspect',jobId:replay.job.id,...extra}),{errorCode:'build_request_invalid'});
  assert.deepEqual((await service.status()).job,replay.job);
  await service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless', controlProgram });
  const controlledService = await settle(service); assert.equal(controlledService.job.status, 'succeeded', JSON.stringify(controlledService));
  assert.deepEqual(controlledService.job.control.program, controlProgram); assert.equal(controlledService.job.control.sha256, controlSha256);
  assert.equal(controlledService.job.control.samples.length, 4); assert.deepEqual(controlledService.job.runtime.control, { stepCount: 4, completedSteps: 4, fixedDelta: 0.125 });
  const controlledInspection = await service.command({ action: 'inspect', jobId: controlledService.job.id, instanceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' });
  assert.equal(controlledInspection.actors.length, 1); assert.deepEqual(controlledInspection.actors[0].position, [200,220]);
  assert.equal(controlledInspection.actors[0].positionCurrent, true); assert.equal(controlledInspection.snapshotId, planned.job.plan.snapshotId);
  for (const invalid of [{ ...plain(controlProgram), fixedDelta: 0 }, { ...plain(controlProgram), sourcePath: '/tmp/forged' },
    { ...plain(controlProgram), steps: [input(true)] }]) {
    await assert.rejects(service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless', controlProgram: invalid }), { errorCode: 'runtime_control_invalid' });
    assert.deepEqual((await service.status()).job, controlledService.job);
  }
  await assert.rejects(service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'window', controlProgram }), { errorCode: 'runtime_control_mode' });
  assert.deepEqual((await service.status()).job, controlledService.job);
  assert.deepEqual(await inventory(serviceWork), serviceBefore);
  report.runtime.desktop = { actualPreparedModules: true, actualBevyAndGodot: true, sessions, oldGodotGoldens: oldGoldens,
    unsupportedImageAndGDScript: unsupported, service: { hostSelectedBackend: initial.backend.id, plan: planned.job.plan,
      buildStatus: built.job.status, runStatus: replay.job.status, events: replay.job.events,
      inspection:inspected,inspectionOverridesRejected:true, controlReplay: { status: controlledService.job.status, control: controlledService.job.control,
        events: controlledService.job.events, observation: controlledService.job.runtime, inspection: controlledInspection,
        malformedControlsAndWindowModeRejectedWithoutNewJob: true }, browserBackendAndToolOverridesRejected: true, windowRejected: true, sourceTreeByteIdentical: true }, nativeDesktopWindow: false };
  await service.close(); service = null;

  service = createProjectBuildService(instanceWork, { ...configuration, cacheRoot: path.join(temporary, 'service-instance-cache') });
  await service.command({ action: 'plan', sceneId }); const instancePlanned = await settle(service);
  assert.equal(instancePlanned.job.status, 'succeeded', JSON.stringify(instancePlanned));
  await service.command({ action: 'build', sceneId, expectedSnapshotId: instancePlanned.job.plan.snapshotId }); const instanceBuilt = await settle(service);
  assert.equal(instanceBuilt.job.status, 'succeeded', JSON.stringify(instanceBuilt));
  const targets = instanceBuilt.latestBuild.controlTargets;
  assert.equal(targets.length, 2); assert.deepEqual(targets.map(target => target.instanceId), [instanceFirst,instanceSecond]);
  assert.equal(new Set(targets.map(target => target.objectId)).size, 1);
  assert.ok(targets.every(target => Object.keys(target).sort().join(',') === 'instanceId,name,objectId'));
  await service.command({ action: 'run', buildId: instanceBuilt.latestBuild.id, mode: 'headless', controlProgram: instanceProgram });
  const instanceRun = await settle(service); assert.equal(instanceRun.job.status, 'succeeded', JSON.stringify(instanceRun));
  assert.equal(instanceRun.job.control.sha256, instanceProgramSha256); assert.deepEqual(instanceRun.job.control.samples, instanceSessions[0].control.samples);
  assert.deepEqual(instanceRun.job.events, instanceSessions[0].events);
  const selectedInstance = await service.command({ action: 'inspect', jobId: instanceRun.job.id, instanceId: instanceSecond });
  assert.equal(selectedInstance.actors.length, 1); assert.deepEqual(selectedInstance.actors[0].position, [490,210]);
  assert.equal(selectedInstance.actors[0].positionCurrent, true); assert.equal(selectedInstance.actors[0].instanceId, instanceSecond);
  for (const id of ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', targets[0].objectId]) {
    const invalid = plain(instanceProgram); invalid.steps[0].inputs[0].instanceId = id;
    await assert.rejects(service.command({ action: 'run', buildId: instanceBuilt.latestBuild.id, mode: 'headless', controlProgram: invalid }), { errorCode: 'runtime_control_target_missing' });
    assert.deepEqual((await service.status()).job, instanceRun.job); assert.deepEqual((await service.status()).latestBuild, instanceBuilt.latestBuild);
  }
  assert.deepEqual(await inventory(instanceWork), instanceBefore);
  report.runtime.desktop.instanceService = { preparedService: true, targets, latestBuildFromFrozenSnapshot: true,
    runStatus: instanceRun.job.status, control: instanceRun.job.control, events: instanceRun.job.events, observation: instanceRun.job.runtime,
    inspection: selectedInstance, unknownAndDefinitionTargetsRejectedBeforeJob: true, sourceTreeByteIdentical: true };
  await service.close(); service = null;

  const behaviorWork = path.join(temporary, 'service-behavior-workspace');
  await fs.cp(path.join(root, 'examples/scene-behaviors'), behaviorWork, { recursive: true });
  const behaviorBefore = await inventory(behaviorWork);
  service = createProjectBuildService(behaviorWork, { backendId: 'org.viento.godot4', tool: godot,
    cacheRoot: path.join(temporary, 'service-behavior-cache') });
  await service.command({ action: 'plan', sceneId }); const behaviorPlanned = await settle(service);
  assert.equal(behaviorPlanned.job.status, 'succeeded', JSON.stringify(behaviorPlanned));
  await service.command({ action: 'build', sceneId, expectedSnapshotId: behaviorPlanned.job.plan.snapshotId });
  const behaviorBuilt = await settle(service); assert.equal(behaviorBuilt.job.status, 'succeeded', JSON.stringify(behaviorBuilt));
  assert.equal(behaviorBuilt.latestBuild.planSchemaVersion, 3);
  await assert.rejects(service.command({ action: 'run', buildId: behaviorBuilt.latestBuild.id, mode: 'headless', controlProgram }),
    { errorCode: 'runtime_control_unsupported' });
  assert.deepEqual((await service.status()).job, behaviorBuilt.job); assert.deepEqual(await inventory(behaviorWork), behaviorBefore);
  report.runtime.desktop.behaviorControlAdmission = { preparedGodotService: true, planVersion: 3,
    actualBuildStatus: behaviorBuilt.job.status, rejectedCode: 'runtime_control_unsupported', noNewJob: true, sourceTreeByteIdentical: true };
  await service.close(); service = null;

  const graph = mobileGraph(path.join(root, 'mobile/dist'));
  const runtime = await graph.entry('engine/scene-runtime-events.mjs'), capabilities = await graph.entry('engine/backend-capabilities.mjs'), queries = await graph.entry('engine/scene-runtime-query.mjs'), controls = await graph.entry('engine/scene-control-program.mjs');
  const mobileAdmissions = [];
  for (const actual of actualLogs) {
    const plan = graph.data(actual.plan), portableProgram = actual.control ? graph.data(actual.control.program) : undefined;
    const observer = queries.createSceneRuntimeObservation(plan, portableProgram ? { controlProgram: portableProgram } : {});
    const reader = runtime.createSceneRuntimeEventReader(plan, { onEvent: event => { assert.equal(observer.push(event), true); } });
    const trace = portableProgram ? controls.createSceneControlTraceReader(plan, portableProgram, {
      onRuntime: line => reader.push(line), onSample: sample => { assert.equal(observer.pushSample(sample), true); },
    }) : null;
    for (let cursor = 0; cursor < actual.stdout.length; cursor += 17) (trace || reader).push(actual.stdout.slice(cursor, cursor + 17));
    const traced = trace?.finish(); const result = reader.finish();
    assert.deepEqual(plain(result.events), actual.events); assert.deepEqual(plain(result.diagnostics), []);
    if (traced) { assert.deepEqual(plain(traced.samples), actual.control.samples); assert.deepEqual(plain(traced.diagnostics), []); }
    const observed=observer.snapshot();assert.deepEqual(plain(observed),actual.observation);
    const queried=queries.querySceneRuntimeObservation(observed,graph.data({objectId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}));
    assert.equal(queried.actors.length,actual.protocolVersion===1?1:2);
    mobileAdmissions.push({observation:plain(observed),queryResult:plain(queried), backendId: actual.backendId, protocolVersion: actual.protocolVersion,
      actualProcessOutputSha256: hash(actual.stdout), actualProcessOutputBytes: Buffer.byteLength(actual.stdout),
      chunkCharacters: 17, admittedEvents: plain(result.events), diagnosticCount: 0,
      ...(traced ? { control: actual.control.program, controlSha256: actual.control.sha256, admittedControlSamples: plain(traced.samples) } : {}) });
  }
  const portableBevy = capabilities.validateExecutionBackendDescriptor(graph.data(adapter.descriptor));
  assert.ok(Object.isFrozen(portableBevy.execution)); assert.deepEqual(plain(portableBevy), adapter.descriptor);
  for (const operation of ['windowPreview', 'windowCapture', 'offscreenRender', 'embeddedViewport', 'gpuCompute']) {
    assert.equal(capabilities.canExecuteBackend(portableBevy, operation, 'linux'), false);
  }
  assert.equal(capabilities.canExecuteBackend(portableBevy, 'headlessLogic', 'linux'), true);
  const androidGates = {};
  for (const descriptor of descriptors) {
    androidGates[descriptor.id] = {};
    for (const operation of ['build', 'headlessLogic', 'windowPreview', 'gpuCompute']) {
      const allowed = capabilities.canExecuteBackend(graph.data(descriptor), operation, 'android');
      assert.equal(allowed, false); androidGates[descriptor.id][operation] = allowed;
    }
  }
  for (const name of ['scene2d', 'scene-behaviors']) {
    const captured = await captureBuildSnapshot(path.join(temporary, `unsupported-${name}`), sceneId);
    const diagnostics = capabilities.checkExecutionBackendSupport(portableBevy, graph.data({ operation: 'build', platform: 'linux', plan: captured.plan }));
    assert.ok(diagnostics.length > 0);
  }
  const moduleStates = await graph.states();
  const admitted = controls.validateSceneControlProgram(graph.data(controlProgram));
  assert.deepEqual(plain(admitted), controlProgram); assert.ok(Object.isFrozen(admitted) && Object.isFrozen(admitted.steps));
  for (const invalid of [{ ...plain(controlProgram), fixedDelta: 0 }, { ...plain(controlProgram), executable: '/tmp/forged' }]) {
    assert.throws(() => controls.validateSceneControlProgram(graph.data(invalid)));
  }
  const crowded = plain(actualLogs.find(actual => actual.protocolVersion === 2).plan);
  crowded.actors = Array.from({ length: 128 }, (_, index) => ({ ...crowded.actors[0], instanceId: `bbbbbbbb-bbbb-4bbb-8bbb-${index.toString(16).padStart(12,'0')}` }));
  assert.throws(() => controls.validateSceneControlPlan(graph.data(crowded), graph.data({ ...plain(controlProgram), steps: Array.from({ length: 9 }, () => input()) })), { errorCode: 'runtime_control_limit' });
  const instanceAdmitted = controls.validateSceneControlProgram(graph.data(instanceProgram));
  assert.deepEqual(plain(instanceAdmitted), instanceProgram); assert.ok(Object.isFrozen(instanceAdmitted.steps[0].inputs[0]));
  for (const id of ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', instanceCaptured.plan.actors[0].objectId]) {
    const invalid = plain(instanceProgram); invalid.steps[0].inputs[0].instanceId = id;
    assert.throws(() => controls.validateSceneControlPlan(graph.data(instanceCaptured.plan), graph.data(invalid)), { errorCode: 'runtime_control_target_missing' });
  }
  const legacyPlan = actualLogs.find(actual => actual.protocolVersion === 1).plan;
  assert.throws(() => controls.validateSceneControlPlan(graph.data(legacyPlan), graph.data(instanceProgram)), { errorCode: 'runtime_control_unsupported' });
  assert.equal(moduleStates.length, 4); assert.ok(moduleStates.every(module => module.status === 'evaluated'));
  assert.equal(vm.runInContext('typeof process', graph.context), 'undefined');
  assert.equal(vm.runInContext('typeof document', graph.context), 'undefined');
  assert.equal(vm.runInContext('typeof require', graph.context), 'undefined');
  report.runtime.mobile = { scope: 'Portable prepared module evaluation only; no Android engine, device or UI run.',
    constructedModuleCount: moduleStates.length, evaluatedModuleCount: moduleStates.filter(module => module.status === 'evaluated').length,
    moduleStates, actualExports: { sceneControlPrograms: Object.keys(controls), sceneRuntimeQueries:Object.keys(queries),sceneRuntimeEvents: Object.keys(runtime), backendCapabilities: Object.keys(capabilities) },
    actualBevyAndGodotProtocolAdmissions: mobileAdmissions, descriptorValidatedAndFrozen: true,
    windowCaptureRenderAndGPURejected: true, androidPlatformGates: androidGates,
    unsupportedImageAndGDScriptRejected: true, validProgramDetachedFrozen: true, malformedProgramsAndActorStepOverflowRejected: true, validInstanceProgramDetachedFrozen: true, unknownAndDefinitionInstanceTargetsRejected: true, instanceProgramOnPlan1Rejected: true, nodeAndDOMGlobalsAbsent: true, noHostAdapterImported: true };
  for (const [artifact, record] of Object.entries(report.artifacts)) for (const [file, hashes] of Object.entries(record.hashes)) {
    assert.equal(hash(await fs.readFile(path.join(root, file))), hashes.sourceSha256, `Source changed during execution: ${file}`);
    assert.equal(hash(await fs.readFile(path.join(root, artifact, file))), hashes.packagedSha256, `Prepared source changed during execution: ${artifact}/${file}`);
  }
  assert.equal(hash(await fs.readFile(bevy)), hostTool.sha256); report.sourceAndPackagedHashesStableThroughoutExecution = true;
  report.ok = true;
} finally {
  await service?.close(); await fs.rm(temporary, { recursive: true, force: true }); report.syntheticFixtureRemoved = true;
}
report.harnessSha256 = hash(await fs.readFile(fileURLToPath(import.meta.url)));
await fs.writeFile(path.join(evidence, 'packaged-resources.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ok: report.ok, embeddedNode: report.embeddedNode.version,
  desktopFiles: report.artifacts['desktop/resources'].checkedFiles, mobileFiles: report.artifacts['mobile/dist'].checkedFiles,
  actualEngines: 2, planVersions: [1, 2], preparedDefaultOfflineSessions: report.runtime.desktop.sessions.length * 2, preparedControlOfflineSessions: report.runtime.desktop.sessions.length * 2, preparedInstanceOfflineSessions: report.runtime.instanceControl.sessions.length, preparedOfflineSessions: report.runtime.desktop.sessions.length * 4 + report.runtime.instanceControl.sessions.length,
  mobileConstructedModules: report.runtime.mobile.constructedModuleCount, mobileEvaluatedModules: report.runtime.mobile.evaluatedModuleCount,
  sourceAndPackagedHashesStable: report.sourceAndPackagedHashesStableThroughoutExecution }));
