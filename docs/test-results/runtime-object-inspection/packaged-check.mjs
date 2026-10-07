// Run after desktop/mobile preparation using the pinned embedded Node:
// VIENTO_BEVY_BIN=/absolute/pinned-host VIENTO_GODOT_BIN=/absolute/Godot VIENTO_STUDIO_CORE_BIN=/absolute/viento-core src-tauri/binaries/viento-node-x86_64-unknown-linux-gnu --experimental-vm-modules docs/test-results/runtime-object-inspection/packaged-check.mjs
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
const hostTool = JSON.parse(await fs.readFile(path.join(evidence, 'host-tool.json')));
assert.equal(bevy, hostTool.path); assert.equal(hash(await fs.readFile(bevy)), hostTool.sha256);
const report = { ok: false, recordedAt: new Date().toISOString(),
  scope: 'Prepared desktop modules run under pinned embedded Node with the external trusted Bevy host and actual Godot. Both execute identical frozen plans offline. Prepared mobile modules execute only renderer-independent frame admission and capability checks and typed runtime object observations/queries in an isolated VM; no installed desktop window, Android device/UI or Android engine execution is claimed.',
  embeddedNode: { version: process.version, sha256: hash(await fs.readFile(process.execPath)) },
  externalBevyTool: hostTool, artifacts: {}, runtime: {} };

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
  'scripts/backends/godot4/runtime.gd', 'scripts/backends/godot4/runtime-v2.gd', 'scripts/backends/godot4/behavior-runtime.gd'];
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

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-bevy-packaged-'));
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
      engines.push({ backendId: selected, tool: built.record.tool, artifact: built.record.artifact,
        buildPhases: built.record.phases.map(({ phase, status }) => ({ phase, status })), offlineStatus: replay.status,
        events: replay.record.events, observation:replay.record.runtime, sourceTreeByteIdentical: true, sessionProjectRemoved: true });
      await fs.rename(work + '-offline', work);
    }
    assert.deepEqual(engines[0].events, engines[1].events);assert.deepEqual(engines[0].observation,engines[1].observation);
    sessions.push({ planVersion: version, snapshotId: captured.snapshotId, sourceAndPreparedCaptureParity: true,
      sourceAndPreparedGeneratorParity: true, identicalEngineEvents: true,identicalRuntimeObservations:true, sourceBefore: before, sourceAfter: await inventory(work), engines });
    const golden = JSON.parse(await fs.readFile(path.join(root, `scripts/tests/fixtures/scene-model/legacy-plan-v${version}.json`)));
    const legacy = await godotAdapter.generate(golden.plan);
    assert.deepEqual(Object.fromEntries([...legacy.files].map(([file, bytes]) => [file, hash(bytes)])), golden.godotFiles);
    assert.deepEqual(legacy.sourceMap, golden.godotSourceMap);
    if (golden.godotBackend) assert.deepEqual(legacy.backend, golden.godotBackend);
    else assert.equal(legacy.backend.sha256, 'dba885d7965715e56b1f1ac394dc78e3227d3502d23318a736dca6eb93beabe6');
    oldGoldens.push({ planVersion: version, backend: legacy.backend, fileHashes: golden.godotFiles, sourceMapUnchanged: true });
  }
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
  assert.deepEqual(await inventory(serviceWork), serviceBefore);
  report.runtime.desktop = { actualPreparedModules: true, actualBevyAndGodot: true, sessions, oldGodotGoldens: oldGoldens,
    unsupportedImageAndGDScript: unsupported, service: { hostSelectedBackend: initial.backend.id, plan: planned.job.plan,
      buildStatus: built.job.status, runStatus: replay.job.status, events: replay.job.events,
      inspection:inspected,inspectionOverridesRejected:true,browserBackendAndToolOverridesRejected: true, windowRejected: true, sourceTreeByteIdentical: true }, nativeDesktopWindow: false };
  await service.close(); service = null;

  const graph = mobileGraph(path.join(root, 'mobile/dist'));
  const runtime = await graph.entry('engine/scene-runtime-events.mjs'), capabilities = await graph.entry('engine/backend-capabilities.mjs'), queries = await graph.entry('engine/scene-runtime-query.mjs');
  const mobileAdmissions = [];
  for (const actual of actualLogs) {
    const reader = runtime.createSceneRuntimeEventReader(graph.data(actual.plan));
    for (let cursor = 0; cursor < actual.stdout.length; cursor += 17) reader.push(actual.stdout.slice(cursor, cursor + 17));
    const result = reader.finish(); assert.deepEqual(plain(result.events), actual.events); assert.deepEqual(plain(result.diagnostics), []);
    const observer=queries.createSceneRuntimeObservation(graph.data(actual.plan));
    for(const event of result.events)observer.push(event);
    const observed=observer.snapshot();assert.deepEqual(plain(observed),actual.observation);
    const queried=queries.querySceneRuntimeObservation(observed,graph.data({objectId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}));
    assert.equal(queried.actors.length,actual.protocolVersion===1?1:2);
    mobileAdmissions.push({observation:plain(observed),queryResult:plain(queried), backendId: actual.backendId, protocolVersion: actual.protocolVersion,
      actualProcessOutputSha256: hash(actual.stdout), actualProcessOutputBytes: Buffer.byteLength(actual.stdout),
      chunkCharacters: 17, admittedEvents: plain(result.events), diagnosticCount: 0 });
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
  assert.equal(moduleStates.length, 3); assert.ok(moduleStates.every(module => module.status === 'evaluated'));
  assert.equal(vm.runInContext('typeof process', graph.context), 'undefined');
  assert.equal(vm.runInContext('typeof document', graph.context), 'undefined');
  assert.equal(vm.runInContext('typeof require', graph.context), 'undefined');
  report.runtime.mobile = { scope: 'Portable prepared module evaluation only; no Android engine, device or UI run.',
    constructedModuleCount: moduleStates.length, evaluatedModuleCount: moduleStates.filter(module => module.status === 'evaluated').length,
    moduleStates, actualExports: { sceneRuntimeQueries:Object.keys(queries),sceneRuntimeEvents: Object.keys(runtime), backendCapabilities: Object.keys(capabilities) },
    actualBevyAndGodotProtocolAdmissions: mobileAdmissions, descriptorValidatedAndFrozen: true,
    windowCaptureRenderAndGPURejected: true, androidPlatformGates: androidGates,
    unsupportedImageAndGDScriptRejected: true, nodeAndDOMGlobalsAbsent: true, noHostAdapterImported: true };
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
  actualEngines: 2, planVersions: [1, 2], preparedOfflineSessions: report.runtime.desktop.sessions.length * 2,
  mobileConstructedModules: report.runtime.mobile.constructedModuleCount, mobileEvaluatedModules: report.runtime.mobile.evaluatedModuleCount,
  sourceAndPackagedHashesStable: report.sourceAndPackagedHashesStableThroughoutExecution }));
