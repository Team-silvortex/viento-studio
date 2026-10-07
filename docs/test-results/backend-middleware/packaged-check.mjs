// Run with the pinned embedded Node and --experimental-vm-modules.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const mobileRewrite = value => value.replaceAll("from 'yaml'", "from '/vendor/yaml/index.js'")
  .replaceAll("from '../node_modules/yaml/browser/index.js'", "from '/vendor/yaml/index.js'");
assert.equal(process.version, 'v24.20.0');
const godot = process.env.VIENTO_GODOT_BIN;
assert.ok(godot && path.isAbsolute(godot), 'Provide the existing Godot executable through VIENTO_GODOT_BIN');
const report = { ok: false, scope: 'Prepared desktop modules with embedded Node and real Godot build/headless runs; portable capability contract only in an isolated mobile VM. No installed desktop window or Android execution/UI is claimed.',
  embeddedNode: { version: process.version, sha256: sha(await fs.readFile(process.execPath)) }, artifacts: {}, runtime: {} };
const shared = [...(await fs.readdir(path.join(root, 'engine'))).filter(name => name.endsWith('.mjs')).map(name => 'engine/' + name),
  'engine/studio-core.wasm', 'engine/studio-core.build.json',
  ...['app-runtime.js', 'app-project-build.js', 'app-scene-preview.js', 'app-scene-composition-overrides.js'].map(name => 'web/modules/' + name),
  ...['messages.js', 'en.js', 'ja.js'].map(name => 'web/i18n/' + name)];
const hostFiles = ['scripts/adapters/node-execution-backends.mjs', 'scripts/adapters/node-project-build.mjs',
  'scripts/adapters/node-build-snapshot.mjs', 'scripts/adapters/node-studio-core.mjs', 'scripts/lib/project-build-service.mjs',
  'scripts/lib/build-process.mjs', 'scripts/backends/godot4-adapter.mjs', 'scripts/backends/godot4.mjs',
  'scripts/backends/godot4-dispatch.mjs', 'scripts/backends/godot4-instances.mjs',
  'scripts/backends/godot4/runtime.gd', 'scripts/backends/godot4/runtime-v2.gd'];
for (const [label, extras] of [['desktop/resources', hostFiles], ['mobile/dist', ['mobile/platform.mjs']]]) {
  const hashes = {};
  for (const file of [...shared, ...extras]) {
    const source = await fs.readFile(path.join(root, file)), packaged = await fs.readFile(path.join(root, label, file));
    const expected = label === 'mobile/dist' && file.startsWith('engine/') && file.endsWith('.mjs') ? Buffer.from(mobileRewrite(source.toString('utf8'))) : source;
    assert.equal(sha(packaged), sha(expected), label + '/' + file);
    hashes[file] = { sourceSha256: sha(source), packagedSha256: sha(packaged), importRewrite: !source.equals(packaged) };
  }
  report.artifacts[label] = { checkedFiles: Object.keys(hashes).length, hashes };
}
const historical = JSON.parse(await fs.readFile(path.join(evidence, 'frozen-backend-baseline.json')));
for (const [file, expected] of Object.entries(historical)) {
  assert.equal(sha(await fs.readFile(path.join(root, file))), expected, 'Historical source changed: ' + file);
  assert.equal(sha(await fs.readFile(path.join(root, 'desktop/resources', file))), expected, 'Packaged historical implementation changed: ' + file);
}
report.historicalGeneratorAndWasmHashes = historical;

const desktop = path.join(root, 'desktop/resources');
const packaged = relative => import(pathToFileURL(path.join(desktop, relative)));
const { createExecutionBackendRegistry, DEFAULT_EXECUTION_BACKEND, executionAdapterFingerprint } = await packaged('scripts/adapters/node-execution-backends.mjs');
const { GODOT4_EXECUTION_ADAPTER } = await packaged('scripts/backends/godot4-adapter.mjs');
const { buildProject, runProjectBuild } = await packaged('scripts/adapters/node-project-build.mjs');
const { captureBuildSnapshot } = await packaged('scripts/adapters/node-build-snapshot.mjs');
const { createProjectBuildService } = await packaged('scripts/lib/project-build-service.mjs');
const { canExecuteBackend } = await packaged('engine/backend-capabilities.mjs');
const sourceAdapter = (await import(pathToFileURL(path.join(root, 'scripts/backends/godot4-adapter.mjs')))).GODOT4_EXECUTION_ADAPTER;
const registry = createExecutionBackendRegistry(), adapter = registry.resolve(DEFAULT_EXECUTION_BACKEND), descriptor = adapter.descriptor;
assert.deepEqual(descriptor, GODOT4_EXECUTION_ADAPTER.descriptor);
assert.deepEqual(descriptor.execution, { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false });
assert.ok(Object.isFrozen(descriptor.execution));
assert.throws(() => registry.resolve('org.viento.unregistered'), { errorCode: 'build_backend_missing' });
const fingerprint = await executionAdapterFingerprint(adapter);
assert.deepEqual(fingerprint, await sourceAdapter.fingerprint());
report.runtime.descriptor = plain(descriptor);
report.runtime.executionFingerprint = fingerprint;

async function inventory(directory) {
  const result = {};
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name); result[path.relative(directory, file)] = sha(await fs.readFile(file));
  }
  return result;
}
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-backend-packaged-'));
let service;
try {
  const work = path.join(temporary, 'source'), output = path.join(temporary, 'build');
  await fs.cp(path.join(root, 'examples/scene2d'), work, { recursive: true });
  const before = await inventory(work), sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const captured = await captureBuildSnapshot(work, sceneId); assert.equal(captured.ok, true);
  const generated = await adapter.generate(captured.plan), sourceGenerated = await sourceAdapter.generate(captured.plan);
  assert.deepEqual([...generated.files].map(([name, bytes]) => [name, sha(bytes)]), [...sourceGenerated.files].map(([name, bytes]) => [name, sha(bytes)]));
  assert.deepEqual(generated.backend, sourceGenerated.backend);
  assert.equal(generated.backend.sha256, 'dba885d7965715e56b1f1ac394dc78e3227d3502d23318a736dca6eb93beabe6');
  service = createProjectBuildService(work, { enabled: true, godot, cacheRoot: path.join(temporary, 'editor-cache') });
  const status = await service.status(); assert.equal(status.available, true); assert.equal(status.platform, process.platform);
  assert.deepEqual(status.backend, descriptor);
  for (const extra of [{ backendId: 'org.viento.other' }, { tool: godot }, { executable: godot }, { adapter: 'source code' }]) {
    await assert.rejects(service.command({ action: 'plan', sceneId, ...extra }), { errorCode: 'build_request_invalid' });
  }
  await service.command({ action: 'plan', sceneId });
  let planned;
  for (let attempt = 0; attempt < 500; attempt++) { planned = await service.status(); if (planned.job?.status !== 'running') break; await delay(10); }
  assert.equal(planned.job.status, 'succeeded'); assert.equal(planned.job.backendId, descriptor.id);
  assert.equal(planned.job.plan.snapshotId, captured.snapshotId);
  const built = await buildProject({ root: work, scene: sceneId, godot, output, expectedSnapshotId: captured.snapshotId });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics || built.record?.diagnostics));
  assert.deepEqual(built.record.executionAdapter, fingerprint);
  assert.equal(built.record.backend.sha256, generated.backend.sha256);
  assert.deepEqual(built.record.phases.map(phase => [phase.phase, phase.status]), [['import', 'succeeded'], ['script-check', 'succeeded']]);
  const run = await runProjectBuild({ buildDirectory: output, godot });
  assert.equal(run.ok, true, JSON.stringify(run.diagnostics || run.record?.diagnostics));
  assert.ok(run.record.events.some(event => event.event === 'ready')); assert.ok(run.record.events.some(event => event.event === 'finished'));
  assert.deepEqual(run.record.executionAdapter, fingerprint);
  await assert.rejects(fs.stat(path.join(run.sessionDirectory, 'project')), { code: 'ENOENT' });
  const legacy = structuredClone(built.record); delete legacy.executionAdapter;
  await fs.writeFile(path.join(output, 'build.json'), JSON.stringify(legacy));
  const legacyRun = await runProjectBuild({ buildDirectory: output, godot });
  assert.equal(legacyRun.ok, true, JSON.stringify(legacyRun.diagnostics || legacyRun.record?.diagnostics));
  assert.equal(legacyRun.record.backendId, descriptor.id); assert.ok(legacyRun.record.events.some(event => event.event === 'finished'));
  await assert.rejects(fs.stat(path.join(legacyRun.sessionDirectory, 'project')), { code: 'ENOENT' });
  assert.deepEqual(await inventory(work), before);
  report.runtime.desktop = { actualPreparedModules: true, actualGodot: true, godotTool: built.record.tool,
    descriptorCapabilities: { supported: Object.entries(descriptor.execution).filter(([, enabled]) => enabled).map(([name]) => name),
      notImplemented: Object.entries(descriptor.execution).filter(([, enabled]) => !enabled).map(([name]) => name) },
    serviceStatusAndPlan: true, hostOnlyAdapterSelection: true, buildStatus: built.status, phases: built.record.phases.map(phase => ({ phase: phase.phase, status: phase.status })),
    generatedBackend: built.record.backend, generatedFiles: [...generated.files].map(([name, bytes]) => ({ name, sha256: sha(bytes) })),
    headlessStatus: run.status, events: run.record.events.map(event => event.event), legacyWithoutExecutionAdapterStatus: legacyRun.status,
    legacyEvents: legacyRun.record.events.map(event => event.event), executionFingerprintMatchesSource: true, generatedBytesMatchSource: true,
    historicalGeneratorHashUnchanged: true, sourceTreeByteIdentical: true, nativeDesktopWindow: false };

  const mobilePath = path.join(root, 'mobile/dist/engine/backend-capabilities.mjs');
  const context = vm.createContext({});
  const module = new vm.SourceTextModule(await fs.readFile(mobilePath, 'utf8'), { context, identifier: pathToFileURL(mobilePath).href });
  let imports = 0;
  await module.link(() => { imports++; throw new Error('The portable capability contract unexpectedly imports host code'); });
  await module.evaluate();
  context.descriptorJson = JSON.stringify(descriptor);
  const mobileDescriptor = vm.runInContext('JSON.parse(descriptorJson)', context);
  const portable = module.namespace, checked = portable.validateExecutionBackendDescriptor(mobileDescriptor);
  assert.deepEqual(plain(checked), descriptor); assert.ok(Object.isFrozen(checked.execution));
  const modes = {};
  for (const [operation, enabled] of Object.entries(descriptor.execution)) {
    modes[operation] = portable.canExecuteBackend(mobileDescriptor, operation, 'linux'); assert.equal(modes[operation], enabled);
    assert.equal(canExecuteBackend(descriptor, operation, 'linux'), enabled);
    assert.equal(portable.canExecuteBackend(mobileDescriptor, operation, 'android'), false);
  }
  for (const operation of ['unknown', '', undefined]) assert.equal(portable.canExecuteBackend(mobileDescriptor, operation, 'linux'), false);
  for (const expression of ['undefined', 'null', '{}', '({id:"godot4"})', '({...JSON.parse(descriptorJson),execution:{build:true}})']) {
    assert.equal(portable.canExecuteBackend(vm.runInContext(expression, context), 'build', 'linux'), false);
  }
  for (const globalName of ['process', 'Buffer', 'require', 'document', 'window']) assert.equal(vm.runInContext(`typeof ${globalName}`, context), 'undefined');
  for (const file of ['scripts/adapters/node-execution-backends.mjs', 'scripts/adapters/node-project-build.mjs', 'scripts/backends/godot4-adapter.mjs', 'scripts/lib/project-build-service.mjs']) {
    await assert.rejects(fs.stat(path.join(root, 'mobile/dist', file)), { code: 'ENOENT' });
  }
  assert.equal(imports, 0);
  report.runtime.mobile = { isolatedPreparedContract: true, moduleCount: 1, noNodeOrDomGlobals: true, noHostImports: true,
    modes, unknownAndMissingDeclarationsRejected: true, unsupportedPlatformRejected: true, frozenDetachedDescriptor: true,
    executionAdapterBundled: false, androidExecution: false, androidUi: false };
  for (const [artifact, value] of Object.entries(report.artifacts)) for (const [file, hashes] of Object.entries(value.hashes)) {
    assert.equal(sha(await fs.readFile(path.join(root, file))), hashes.sourceSha256, 'Source changed during execution: ' + file);
    assert.equal(sha(await fs.readFile(path.join(root, artifact, file))), hashes.packagedSha256, 'Packaged bytes changed during execution: ' + artifact + '/' + file);
  }
  report.sourceAndPackagedHashesStableThroughoutExecution = true;
  report.ok = true;
} finally {
  await service?.close(); await fs.rm(temporary, { recursive: true, force: true }); report.syntheticFixtureRemoved = true;
}
report.harnessSha256 = sha(await fs.readFile(fileURLToPath(import.meta.url)));
await fs.writeFile(path.join(evidence, 'packaged-resources.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ok: report.ok, node: report.embeddedNode.version,
  desktopHashes: report.artifacts['desktop/resources'].checkedFiles, mobileHashes: report.artifacts['mobile/dist'].checkedFiles,
  actualGodot: report.runtime.desktop.godotTool.version, headless: report.runtime.desktop.headlessStatus,
  legacyWithoutExecutionAdapter: report.runtime.desktop.legacyWithoutExecutionAdapterStatus,
  mobilePortableModules: report.runtime.mobile.moduleCount, sourceAndPackageHashesStable: report.sourceAndPackagedHashesStableThroughoutExecution }));
