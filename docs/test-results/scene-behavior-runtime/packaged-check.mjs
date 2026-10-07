// Run after final desktop/mobile preparation with the pinned embedded Node:
// VIENTO_GODOT_BIN=/absolute/Godot src-tauri/binaries/viento-node-x86_64-unknown-linux-gnu --experimental-vm-modules docs/test-results/scene-behavior-runtime/packaged-check.mjs
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
const godot = process.env.VIENTO_GODOT_BIN;
assert.equal(process.version, 'v24.20.0', 'Use the pinned embedded Node');
assert.ok(godot && path.isAbsolute(godot), 'Provide the existing Godot executable');
const report = { ok: false, recordedAt: new Date().toISOString(),
  scope: 'Prepared desktop modules executed by the pinned embedded Node: actual Godot build and offline headless replay. Prepared mobile modules execute only portable inspection/planning/capability checks in an isolated VM; no installed desktop window, Android device, Android UI or Android game execution is claimed.',
  embeddedNode: { version: process.version, sha256: hash(await fs.readFile(process.execPath)) }, artifacts: {}, runtime: {} };

const shared = [...(await fs.readdir(path.join(root, 'engine'))).filter(file => file.endsWith('.mjs')).map(file => `engine/${file}`),
  'engine/studio-core.wasm', 'engine/studio-core.build.json',
  ...['app-runtime.js', 'app-project-build.js', 'app-scene-preview.js', 'app-scene-composition-overrides.js'].map(file => `web/modules/${file}`),
  ...['messages.js', 'en.js', 'ja.js'].map(file => `web/i18n/${file}`)];
const host = ['scripts/adapters/node-execution-backends.mjs', 'scripts/adapters/node-project-build.mjs', 'scripts/adapters/node-build-snapshot.mjs',
  'scripts/adapters/node-world-projection.mjs', 'scripts/adapters/node-studio-core.mjs', 'scripts/lib/project-build-service.mjs',
  'scripts/lib/build-process.mjs', 'scripts/lib/resource-package-catalog.mjs', 'scripts/lib/resource-package-reader.mjs', 'scripts/lib/resource-package-import.mjs',
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

const desktop = path.join(root, 'desktop/resources');
const imported = file => import(pathToFileURL(path.join(desktop, file)));
const { GODOT4_EXECUTION_ADAPTER: adapter } = await imported('scripts/backends/godot4-adapter.mjs');
const { GODOT4_EXECUTION_ADAPTER: sourceAdapter } = await import(pathToFileURL(path.join(root, 'scripts/backends/godot4-adapter.mjs')));
const { captureBuildSnapshot } = await imported('scripts/adapters/node-build-snapshot.mjs');
const { captureBuildSnapshot: captureSourceBuildSnapshot } = await import(pathToFileURL(path.join(root, 'scripts/adapters/node-build-snapshot.mjs')));
const { readWorldSnapshot } = await imported('scripts/adapters/node-world-projection.mjs');
const { buildProject, runProjectBuild } = await imported('scripts/adapters/node-project-build.mjs');
const { createScene2DPlan } = await imported('engine/build-plan.mjs');
const { inspectSceneBehaviors } = await imported('engine/scene-behaviors.mjs');
const { createProjectBuildService } = await imported('scripts/lib/project-build-service.mjs');
const descriptor = adapter.descriptor, fingerprint = await adapter.fingerprint();
assert.deepEqual(fingerprint, await sourceAdapter.fingerprint());
assert.equal(descriptor.version, '0.3.0'); assert.ok(descriptor.plans.some(plan => plan.schemaVersion === 3 && plan.runtimeProtocolVersion === 3));
report.runtime.executionFingerprint = fingerprint;
report.runtime.descriptor = plain(descriptor);

async function inventory(directory) {
  const result = {};
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name); result[path.relative(directory, file)] = hash(await fs.readFile(file));
  }
  return result;
}
function mobileGraph(base) {
  // Only web-standard text primitives accompany the VM's built-in globals.
  // No Node, filesystem, DOM, host imports or execution adapter enter this graph.
  const context = vm.createContext({ TextEncoder, TextDecoder });
  const modules = new Map();
  function load(identifier) {
    const url = identifier instanceof URL ? identifier : pathToFileURL(path.join(base, identifier));
    const file = fileURLToPath(url); assert.ok(file.startsWith(base + path.sep));
    if (!modules.has(url.href)) modules.set(url.href, fs.readFile(file, 'utf8').then(source => new vm.SourceTextModule(source, { context, identifier: url.href })));
    return modules.get(url.href);
  }
  async function entry(file) {
    const module = await load(file);
    if (module.status === 'unlinked') await module.link((specifier, parent) => {
      if (specifier.startsWith('/')) return load(pathToFileURL(path.join(base, specifier)));
      assert.ok(specifier.startsWith('.'), `Forbidden portable import: ${specifier}`);
      return load(new URL(specifier, parent.identifier));
    });
    if (module.status === 'linked') await module.evaluate();
    return module.namespace;
  }
  const data = value => { context.inputJson = JSON.stringify(value); return vm.runInContext('JSON.parse(inputJson)', context); };
  return { context, entry, data,
    async states() { return Promise.all([...modules].map(async ([url, pending]) => ({ file: path.relative(base, fileURLToPath(url)), status: (await pending).status }))); },
    paths: () => [...modules.keys()].map(url => path.relative(base, fileURLToPath(url))).sort() };
}

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-behavior-packaged-'));
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', manifestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', scriptId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
let service;
try {
  const work = path.join(temporary, 'workspace'), output = path.join(temporary, 'build');
  await fs.cp(path.join(root, 'examples/scene-behaviors'), work, { recursive: true });
  const before = await inventory(work), captured = await captureBuildSnapshot(work, sceneId), observed = await readWorldSnapshot(work);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics)); assert.equal(captured.plan.schemaVersion, 3);
  const sourceCaptured = await captureSourceBuildSnapshot(work, sceneId);
  assert.equal(sourceCaptured.ok, true, JSON.stringify(sourceCaptured.diagnostics));
  assert.deepEqual(sourceCaptured.snapshot, captured.snapshot); assert.equal(sourceCaptured.snapshotId, captured.snapshotId);
  assert.deepEqual(sourceCaptured.resources, captured.resources);
  assert.deepEqual(createScene2DPlan(observed, sceneId).plan, captured.plan);
  const manifest = observed.source.documents.find(document => document.record?.id === manifestId);
  assert.equal(inspectSceneBehaviors(manifest.content).ok, true);
  const expectedParameters = [{ checkpoint: 'east', amount: 40 }, { checkpoint: 'west', amount: 20 }];
  assert.deepEqual(captured.plan.behaviors.bindings.map(binding => binding.parameters), expectedParameters);
  assert.equal(captured.plan.behaviors.sources.length, 1);
  assert.equal(captured.plan.behaviors.sources[0].content, await fs.readFile(path.join(work, 'documents/scripts/checkpoint.txt'), 'utf8'));
  const generated = await adapter.generate(captured.plan), sourceGenerated = await sourceAdapter.generate(captured.plan);
  assert.deepEqual(generated, sourceGenerated);
  assert.deepEqual(generated.files.get(`behaviors/${scriptId}.gd`), Buffer.from(captured.plan.behaviors.sources[0].content));
  const goldenResults = [];
  for (const version of [1, 2]) {
    const golden = JSON.parse(await fs.readFile(path.join(root, `scripts/tests/fixtures/scene-model/legacy-plan-v${version}.json`)));
    const legacy = await adapter.generate(golden.plan), sourceLegacy = await sourceAdapter.generate(golden.plan);
    assert.deepEqual(Object.fromEntries([...legacy.files].map(([file, bytes]) => [file, hash(bytes)])), golden.godotFiles);
    assert.deepEqual(legacy.sourceMap, golden.godotSourceMap); assert.deepEqual(legacy, sourceLegacy);
    if (golden.godotBackend) assert.deepEqual(legacy.backend, golden.godotBackend);
    goldenResults.push({ planVersion: version, backend: legacy.backend, files: golden.godotFiles, sourceMapUnchanged: true });
  }
  service = createProjectBuildService(work, { enabled: true, godot, cacheRoot: path.join(temporary, 'editor-cache') });
  assert.deepEqual((await service.status()).backend, descriptor);
  await service.command({ action: 'plan', sceneId });
  let status;
  for (let attempt = 0; attempt < 500; attempt++) {
    status = await service.status(); if (status.job?.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(status.job.status, 'succeeded'); assert.equal(status.job.plan.behaviorBindingCount, 2); assert.equal(status.job.plan.behaviorSourceCount, 1);
  assert.equal(status.job.plan.snapshotId, captured.snapshotId);
  const built = await buildProject({ root: work, scene: sceneId, godot, output, expectedSnapshotId: captured.snapshotId });
  assert.equal(built.ok, true, JSON.stringify(built.record?.diagnostics || built.diagnostics));
  assert.equal(built.record.backend.protocolVersion, 3); assert.deepEqual(built.record.executionAdapter, fingerprint);
  assert.deepEqual(await inventory(work), before);
  await service.close(); service = null;
  await fs.rename(work, work + '-offline');
  const run = await runProjectBuild({ buildDirectory: output, godot });
  assert.equal(run.ok, true, JSON.stringify(run.record?.diagnostics || run.diagnostics));
  assert.deepEqual(run.record.events.map(event => event.event), ['ready', 'behavior', 'behavior', 'finished']);
  const events = run.record.events.filter(event => event.event === 'behavior');
  assert.deepEqual(events.map(event => event.arguments), [['east', 40], ['west', 20]]);
  for (const [index, event] of events.entries()) {
    const binding = captured.plan.behaviors.bindings[index];
    assert.equal(event.protocol, 3); assert.equal(event.bindingId, binding.bindingId); assert.equal(event.instanceId, binding.instanceId);
    assert.equal(event.objectId, binding.objectId); assert.equal(event.name, 'checkpoint');
  }
  assert.notEqual(events[0].bindingId, events[1].bindingId); assert.notEqual(events[0].instanceId, events[1].instanceId); assert.equal(events[0].objectId, events[1].objectId);
  await assert.rejects(fs.stat(path.join(run.sessionDirectory, 'project')), { code: 'ENOENT' });
  assert.deepEqual(await inventory(work + '-offline'), before);
  report.runtime.desktop = { actualPreparedModules: true, actualGodot: true, godotTool: built.record.tool,
    capturePlanVersion: captured.plan.schemaVersion, frozenSnapshotId: captured.snapshotId, sourceAndPreparedCaptureParity: true,
    singleBehaviorSource: captured.plan.behaviors.sources.map(({ content, ...source }) => ({ ...source, contentBytes: Buffer.byteLength(content), contentSha256: hash(content) })),
    bindingParameters: expectedParameters, servicePlanSummary: status.job.plan,
    buildStatus: built.status, phases: built.record.phases.map(phase => ({ phase: phase.phase, status: phase.status })),
    generatedBackend: built.record.backend, generatedFiles: [...generated.files].map(([file, bytes]) => ({ file, sha256: hash(bytes) })),
    offlineHeadlessStatus: run.status, offlineEvents: run.record.events, frozenSourceAndPackageFingerprintEqual: true,
    sourceTreeBefore: before, sourceTreeAfter: await inventory(work + '-offline'), sourceTreeByteIdentical: true,
    sessionProjectRemoved: true, oldV1V2GoldenResults: goldenResults, nativeDesktopWindow: false };

  const graph = mobileGraph(path.join(root, 'mobile/dist'));
  const behaviors = await graph.entry('engine/scene-behaviors.mjs'), planner = await graph.entry('engine/build-plan.mjs'), capabilities = await graph.entry('engine/backend-capabilities.mjs');
  assert.equal(behaviors.inspectSceneBehaviors(manifest.content).ok, true);
  const mobileObserved = graph.data(observed), beforeMobile = JSON.stringify(mobileObserved);
  const mobilePlan = planner.createScene2DPlan(mobileObserved, sceneId);
  assert.equal(mobilePlan.ok, true, JSON.stringify(mobilePlan.diagnostics)); assert.deepEqual(plain(mobilePlan.plan), captured.plan);
  assert.equal(JSON.stringify(mobileObserved), beforeMobile);
  assert.deepEqual(plain(mobilePlan.plan.behaviors.bindings.map(binding => binding.parameters)), expectedParameters);
  const mobileDescriptor = graph.data(descriptor), portable = capabilities.validateExecutionBackendDescriptor(mobileDescriptor);
  assert.ok(Object.isFrozen(portable.execution)); assert.deepEqual(plain(portable), descriptor);
  assert.deepEqual(plain(capabilities.checkExecutionBackendSupport(mobileDescriptor, graph.data({ operation: 'build', platform: 'linux', plan: captured.plan }))), []);
  const wrongDescriptor = { ...descriptor, id: 'org.viento.other' };
  const wrong = capabilities.checkExecutionBackendSupport(graph.data(wrongDescriptor), graph.data({ operation: 'build', plan: captured.plan }));
  assert.ok(wrong.some(item => item.code === 'build_behavior_backend_unsupported'));
  const unsupported = {};
  for (const operation of ['gpuCompute', 'offscreenRender', 'embeddedViewport', 'unknown']) {
    unsupported[operation] = capabilities.canExecuteBackend(mobileDescriptor, operation, 'linux'); assert.equal(unsupported[operation], false);
  }
  assert.equal(capabilities.canExecuteBackend(mobileDescriptor, 'build', 'android'), false);
  assert.equal(capabilities.canExecuteBackend(graph.data({}), 'build', 'linux'), false);
  const unknown = JSON.parse(manifest.content); unknown.unrecognized = true;
  assert.equal(behaviors.inspectSceneBehaviors(JSON.stringify(unknown)).ok, false);
  const missingActor = JSON.parse(manifest.content); missingActor.bindings[0].instanceId = scriptId;
  const altered = graph.data(observed);
  altered.source.documents.find(document => document.record?.id === manifestId).content = JSON.stringify(missingActor);
  assert.equal(planner.createScene2DPlan(altered, sceneId).ok, false);
  for (const globalName of ['process', 'Buffer', 'require', 'document', 'window', 'fetch']) assert.equal(vm.runInContext(`typeof ${globalName}`, graph.context), 'undefined');
  const modulePaths = graph.paths();
  const moduleStates = await graph.states();
  assert.ok(moduleStates.every(module => module.status === 'evaluated'), 'Every constructed dependency finished ESM evaluation');
  assert.ok(modulePaths.includes('vendor/yaml/index.js')); assert.ok(modulePaths.includes('engine/scene-model.mjs'));
  assert.ok(modulePaths.every(file => file.startsWith('engine/') || file.startsWith('vendor/yaml/')));
  for (const file of ['scripts/adapters/node-execution-backends.mjs', 'scripts/adapters/node-project-build.mjs',
    'scripts/backends/godot4-adapter.mjs', 'scripts/backends/godot4-behaviors.mjs', 'scripts/backends/godot4/behavior-runtime.gd', 'scripts/lib/project-build-service.mjs']) {
    await assert.rejects(fs.stat(path.join(root, 'mobile/dist', file)), { code: 'ENOENT' });
  }
  report.runtime.mobile = { isolatedPreparedModules: true, moduleCount: modulePaths.length, modulePaths,
    constructedModuleCount: moduleStates.length, evaluatedModuleCount: moduleStates.filter(module => module.status === 'evaluated').length, moduleStates,
    explicitlyExercisedExports: ['inspectSceneBehaviors', 'createScene2DPlan (including resolveSceneBehaviors and resolveScene2DModel)',
      'validateExecutionBackendDescriptor', 'checkExecutionBackendSupport', 'canExecuteBackend'],
    inspectRegisteredManifest: true, resolveAndPlanExactDesktopParity: true, bindingParameters: expectedParameters,
    unknownManifestFieldsRejected: true, missingInstanceRejected: true, wrongBackendRejected: true,
    unsupportedOperations: unsupported, undeclaredDescriptorRejected: true, androidExecutionCapabilityRejected: true,
    noNodeOrDomGlobals: true, noHostOrExternalImports: true, sourceObservationUnchanged: true,
    executionAdapterBundled: false, androidExecution: false, androidUi: false, nativeDevice: false };

  for (const [artifact, entry] of Object.entries(report.artifacts)) for (const [file, hashes] of Object.entries(entry.hashes)) {
    assert.equal(hash(await fs.readFile(path.join(root, file))), hashes.sourceSha256, `Source changed during execution: ${file}`);
    assert.equal(hash(await fs.readFile(path.join(root, artifact, file))), hashes.packagedSha256, `Prepared source changed during execution: ${artifact}/${file}`);
  }
  report.sourceAndPackagedHashesStableThroughoutExecution = true;
  report.ok = true;
} finally {
  await service?.close(); await fs.rm(temporary, { recursive: true, force: true }); report.syntheticFixtureRemoved = true;
}
report.harnessSha256 = hash(await fs.readFile(fileURLToPath(import.meta.url)));
await fs.writeFile(path.join(evidence, 'packaged-resources.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ok: report.ok, embeddedNode: report.embeddedNode.version,
  desktopFiles: report.artifacts['desktop/resources'].checkedFiles, mobileFiles: report.artifacts['mobile/dist'].checkedFiles,
  actualGodot: report.runtime.desktop.godotTool.version, offlineHeadless: report.runtime.desktop.offlineHeadlessStatus,
  behaviorEvents: report.runtime.desktop.offlineEvents.filter(event => event.event === 'behavior').length,
  mobilePureModules: report.runtime.mobile.moduleCount, sourceAndPackageHashesStable: report.sourceAndPackagedHashesStableThroughoutExecution }));
