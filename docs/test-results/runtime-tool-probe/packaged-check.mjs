// Run after final preparation with the pinned embedded Node and existing host tools.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const desktop = path.join(root, 'desktop/resources');
const mobile = path.join(root, 'mobile/dist');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const rewrite = source => source.replaceAll("from 'yaml'", "from '/vendor/yaml/index.js'")
  .replaceAll("from '../node_modules/yaml/browser/index.js'", "from '/vendor/yaml/index.js'");
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const configured = [['org.viento.godot4', process.env.VIENTO_GODOT_BIN], ['org.viento.bevy', process.env.VIENTO_BEVY_BIN]];
assert.equal(process.version, 'v24.20.0', 'Use the pinned embedded Node');
assert.ok(configured.every(([, tool]) => typeof tool === 'string' && path.isAbsolute(tool)), 'Provide both existing host tools');

async function fileHash(file) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}

async function inventory(directory) {
  const files = {};
  const entries = await fs.readdir(directory, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    assert.ok(entry.isFile(), 'Prepared and fixture inventories must contain only regular files and directories');
    const file = path.join(entry.parentPath, entry.name);
    const bytes = await fs.readFile(file);
    const signature = bytes.length >= 4 ? bytes.readUInt32BE(0) : null;
    const nativeExecutable = [0x7f454c46, 0xcafebabe, 0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe].includes(signature)
      || bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
    files[path.relative(directory, file)] = { bytes: bytes.length, sha256: hash(bytes), ...(nativeExecutable ? { nativeExecutable: true } : {}) };
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

const imported = file => import(pathToFileURL(path.join(desktop, file)));
const sourceImport = file => import(pathToFileURL(path.join(root, file)));
const report = { ok: false, recordedAt: new Date().toISOString(),
  scope: 'Final prepared desktop resources execute real Godot and Bevy tool checks, CLI identity checks, and one frozen offline headless session per backend under embedded Node. Prepared mobile executes only the new portable tool-status DTO module in an isolated VM. No installed desktop window, Android device/UI, Android engine execution, arbitrary author code, GPU rendering or additional runtime-control sessions are claimed.',
  embeddedNode: { version: process.version, sha256: await fileHash(process.execPath) },
  artifacts: {}, unchangedBackendSources: {}, externalTools: [], desktopChecks: [], mobileChecks: {} };

const shared = [...(await fs.readdir(path.join(root, 'engine'))).filter(file => file.endsWith('.mjs')).map(file => `engine/${file}`),
  'engine/studio-core.wasm', 'engine/studio-core.build.json', 'web/project-build.css', 'favicon.ico',
  ...['app-runtime.js', 'app-project-build.js', 'app-scene-preview.js', 'app-scene-composition-overrides.js'].map(file => `web/modules/${file}`),
  ...['messages.js', 'en.js', 'ja.js'].map(file => `web/i18n/${file}`)];
const host = ['scripts/adapters/node-execution-backends.mjs', 'scripts/adapters/node-execution-tool.mjs',
  'scripts/adapters/node-execution-tool-probe.mjs', 'scripts/adapters/node-project-build.mjs',
  'scripts/adapters/node-build-snapshot.mjs', 'scripts/adapters/node-world-projection.mjs', 'scripts/adapters/node-studio-core.mjs',
  'scripts/lib/project-build-service.mjs', 'scripts/lib/build-process.mjs', 'scripts/lib/doc-api-service.mjs', 'scripts/project-build.mjs',
  ...(await fs.readdir(path.join(root, 'scripts/backends'), { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile()).map(entry => path.relative(root, path.join(entry.parentPath, entry.name))),
  ...(await fs.readdir(path.join(root, 'schemas'))).filter(file => file.endsWith('.json')).map(file => `schemas/${file}`)];

for (const [name, extra] of [['desktop/resources', host], ['mobile/dist', ['mobile/platform.mjs']]]) {
  const base = path.join(root, name), files = await inventory(base), checked = {};
  for (const file of [...shared, ...extra]) {
    const source = await fs.readFile(path.join(root, file)), prepared = await fs.readFile(path.join(base, file));
    const expected = name === 'mobile/dist' && file.startsWith('engine/') && file.endsWith('.mjs')
      ? Buffer.from(rewrite(source.toString('utf8'))) : source;
    assert.equal(hash(prepared), hash(expected), `Prepared copy differs: ${name}/${file}`);
    checked[file] = { sourceSha256: hash(source), packagedSha256: hash(prepared), importRewrite: !source.equals(prepared) };
  }
  assert.ok(!Object.keys(files).some(file => /^(?:examples|works|workspaces|crates)\//.test(file)
    || file.startsWith('web/data/') || file.startsWith('scripts/tests/')
    || /(?:^|\/)(?:viento-node[^/]*|viento-bevy-runtime[^/]*|Cargo\.lock)$/.test(file)));
  assert.ok(!Object.values(files).some(file => file.nativeExecutable), 'Execution tools must remain outside prepared resource trees');
  if (name === 'mobile/dist') {
    assert.ok(!Object.keys(files).some(file => file.startsWith('scripts/adapters/') || file.startsWith('scripts/backends/')
      || file === 'scripts/lib/project-build-service.mjs' || file === 'scripts/project-build.mjs'));
  }
  report.artifacts[name] = { manifestFileCount: Object.keys(files).length,
    manifestBytes: Object.values(files).reduce((sum, file) => sum + file.bytes, 0),
    manifestSha256: hash(JSON.stringify(files)), manifest: files,
    checkedSourceFiles: Object.keys(checked).length, checkedSourceSha256: hash(JSON.stringify(checked)), hashes: checked };
}
const libraryTranslations = {};
for (const file of ['messages.js', 'en.js', 'ja.js']) {
  const source = await fs.readFile(path.join(root, 'web/i18n', file)), prepared = await fs.readFile(path.join(root, 'desktop/ui/i18n', file));
  assert.deepEqual(prepared, source); libraryTranslations[file] = hash(prepared);
}
report.desktopLibraryTranslationHashes = libraryTranslations;
report.mobileHasNoHostExecutionModulesOrNativeTool = true;
report.preparedResourcesHaveNoRustCrateOrNativeEngineTool = true;

const frozen = JSON.parse(await fs.readFile(path.join(evidence, 'frozen-backend-baseline.json')));
for (const [file, expected] of Object.entries(frozen)) {
  assert.equal(await fileHash(path.join(root, file)), expected);
  assert.equal(await fileHash(path.join(desktop, file)), expected);
}
report.frozenBackendAndCoreSha256 = frozen;
const previous = JSON.parse(await fs.readFile(path.join(root, 'docs/test-results/runtime-instance-control/packaged-resources.json')));
for (const file of host.filter(file => file.startsWith('scripts/backends/'))) {
  const expected = previous.artifacts['desktop/resources'].hashes[file].sourceSha256;
  assert.equal(await fileHash(path.join(root, file)), expected, `Execution backend changed: ${file}`);
  report.unchangedBackendSources[file] = expected;
}

const { createExecutionBackendRegistry } = await imported('scripts/adapters/node-execution-backends.mjs');
const { createExecutionBackendRegistry: createSourceRegistry } = await sourceImport('scripts/adapters/node-execution-backends.mjs');
const { createProjectBuildService } = await imported('scripts/lib/project-build-service.mjs');
const { readExecutionToolCandidate } = await imported('scripts/adapters/node-execution-tool-probe.mjs');
const { validateExecutionToolStatus } = await imported('engine/execution-tool-status.mjs');
const { runProjectBuildCommand } = await imported('scripts/project-build.mjs');
const registry = createExecutionBackendRegistry(), sourceRegistry = createSourceRegistry();
assert.deepEqual(registry.descriptors(), sourceRegistry.descriptors());
report.registry = plain(registry.descriptors());
report.executionFingerprints = {};
report.legacyGodotGoldens = [];
for (const [backendId] of configured) {
  const actual = await registry.resolve(backendId).fingerprint();
  assert.deepEqual(actual, await sourceRegistry.resolve(backendId).fingerprint());
  report.executionFingerprints[backendId] = actual;
}
for (const version of [1, 2]) {
  const golden = JSON.parse(await fs.readFile(path.join(root, `scripts/tests/fixtures/scene-model/legacy-plan-v${version}.json`)));
  const generated = await registry.resolve('org.viento.godot4').generate(golden.plan);
  assert.deepEqual(Object.fromEntries([...generated.files].map(([file, bytes]) => [file, hash(bytes)])), golden.godotFiles);
  assert.deepEqual(generated.sourceMap, golden.godotSourceMap);
  report.legacyGodotGoldens.push({ planVersion: version, fileHashes: golden.godotFiles, sourceMapUnchanged: true });
}

function assertPublic(status, backendId) {
  assert.deepEqual(validateExecutionToolStatus(status), status);
  assert.equal(status.backendId, backendId);
  assert.doesNotMatch(JSON.stringify(status), /"(?:executable|toolPath|candidateKey|stdout|stderr)"/);
}

async function settle(service) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const state = await service.status();
    if (state.job?.status !== 'running') return state;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Prepared service did not settle.');
}

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-tool-probe-packaged-'));
const services = [], mobileInputs = [], events = [];
try {
  for (const [backendId, executable] of configured) {
    const name = backendId.split('.').at(-1), work = path.join(temporary, `workspace-${name}`), cacheRoot = path.join(temporary, `cache-${name}`);
    await fs.cp(path.join(root, 'examples/bevy-headless'), work, { recursive: true });
    const before = await inventory(work), adapter = registry.resolve(backendId);
    let identifyCount = 0;
    const instrumentedRegistry = createExecutionBackendRegistry([{ ...adapter, async identify(...args) {
      identifyCount++; return adapter.identify(...args);
    } }]);
    const service = createProjectBuildService(work, { backendId, tool: executable, backendRegistry: instrumentedRegistry, cacheRoot });
    services.push(service);
    const discovered = await service.status({ refresh: true }); await service.status();
    assert.equal(identifyCount, 0, 'GET/catalog reads must not identify or execute a tool');
    assert.equal(discovered.toolStatus.status, 'unchecked'); assert.equal(discovered.available, true);
    assert.ok(discovered.scenes.some(scene => scene.id === sceneId));
    assert.equal(discovered.job, null); assert.equal(discovered.latestBuild, null);
    await assert.rejects(fs.stat(cacheRoot), { code: 'ENOENT' });
    await assert.rejects(service.command({ action: 'tool-check', toolPath: executable }), { errorCode: 'build_request_invalid' });
    const candidate = await readExecutionToolCandidate(adapter, { toolPath: executable }); assert.equal(candidate.available, true);
    const checked = await service.command({ action: 'tool-check' });
    assert.equal(identifyCount, 1); assertPublic(checked.toolStatus, backendId);
    assert.equal(checked.toolStatus.status, 'ready'); assert.equal(checked.toolStatus.reason, null);
    assert.equal(checked.job, null); assert.equal(checked.latestBuild, null);
    assert.equal(JSON.stringify(checked).includes('candidateKey'), false);
    assert.equal(JSON.stringify(checked).includes(executable), false);
    const identity = checked.toolStatus.identity;
    assert.equal(identity.sha256, await fileHash(executable));
    assert.equal(identity.platform, process.platform); assert.equal(identity.arch, process.arch);
    if (backendId === 'org.viento.bevy') assert.equal(identity.version, 'viento-bevy-runtime 0.3.0 bevy 0.19.1');
    else assert.match(identity.version, /^4\.\d+(?:\.\d+)?\.[\w.-]+$/);
    await service.status(); assert.equal(identifyCount, 1);
    await assert.rejects(fs.stat(cacheRoot), { code: 'ENOENT' });
    assert.deepEqual(await inventory(work), before);
    mobileInputs.push(checked.toolStatus);
    report.externalTools.push({ backendId, identity, bytes: (await fs.stat(executable)).size });

    const cli = await runProjectBuildCommand(['--command', 'tool-check', '--backend', backendId, '--tool', executable]);
    assert.equal(cli.ok, true); assert.deepEqual(cli.toolStatus, checked.toolStatus);
    assert.deepEqual(Object.keys(cli).sort(), ['ok', 'toolStatus']);
    const wrongExecutable = configured.find(([id]) => id !== backendId)[1];
    const wrongCache = path.join(temporary, `wrong-cache-${name}`);
    const wrong = createProjectBuildService(work, { backendId, tool: wrongExecutable, cacheRoot: wrongCache }); services.push(wrong);
    const wrongInitial = await wrong.status(); assert.equal(wrongInitial.available, true);
    const rejected = await wrong.command({ action: 'tool-check' }); assertPublic(rejected.toolStatus, backendId);
    assert.equal(rejected.available, false); assert.equal(rejected.toolStatus.status, 'unavailable');
    assert.equal(rejected.toolStatus.reason, 'tool_version'); assert.equal(rejected.toolStatus.identity, null);
    assert.equal(rejected.job, null); assert.equal(rejected.latestBuild, null);
    await assert.rejects(wrong.command({ action: 'build', sceneId }), { errorCode: 'build_tool_required' });
    await assert.rejects(fs.stat(wrongCache), { code: 'ENOENT' }); await wrong.close(); mobileInputs.push(rejected.toolStatus);
    const wrongCli = await runProjectBuildCommand(['--command', 'tool-check', '--backend', backendId, '--tool', wrongExecutable]);
    assert.equal(wrongCli.ok, false); assert.deepEqual(wrongCli.toolStatus, rejected.toolStatus);

    await service.command({ action: 'plan', sceneId }); const planned = await settle(service);
    assert.equal(planned.job.status, 'succeeded'); assert.equal(identifyCount, 1, 'Plan does not execute a tool');
    await service.command({ action: 'build', sceneId, expectedSnapshotId: planned.job.plan.snapshotId });
    const built = await settle(service); assert.equal(built.job.status, 'succeeded', JSON.stringify(built.job.diagnostics));
    assert.equal(identifyCount, 2, 'A successful probe does not replace build identification');
    const cache = await inventory(cacheRoot), records = Object.keys(cache).filter(file => file.endsWith('/build.json'));
    assert.equal(records.length, 1); const buildDirectory = path.dirname(path.join(cacheRoot, records[0]));
    const record = JSON.parse(await fs.readFile(path.join(buildDirectory, 'build.json')));
    assert.equal(record.buildId, built.latestBuild.id); assert.deepEqual(record.tool, identity);
    const projectBefore = await inventory(path.join(buildDirectory, 'project'));
    assert.deepEqual(await inventory(work), before);
    await service.status({ refresh: true });
    const offline = work + '-offline'; await fs.rename(work, offline);
    let finished;
    try {
      await assert.rejects(fs.stat(work), { code: 'ENOENT' });
      const offlineState = await service.status({ refresh: true });
      assert.deepEqual(offlineState.catalogDiagnostic, { code: 'build_catalog_unavailable' });
      assert.deepEqual(offlineState.latestBuild, built.latestBuild);
      for (const action of ['plan', 'build']) {
        await assert.rejects(service.command({ action, sceneId }), { errorCode: 'world_unavailable' });
        assert.deepEqual((await service.status()).job, built.job, 'Cached catalog cannot admit a new author task');
      }
      await service.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless' });
      finished = await settle(service);
      assert.equal(finished.job.status, 'succeeded', JSON.stringify(finished.job.diagnostics));
      assert.equal(identifyCount, 3, 'Frozen runtime re-identifies independently of the probe and build');
      assert.deepEqual(finished.job.events.map(event => event.event), ['ready', 'state', 'state', 'finished']);
      assert.deepEqual(finished.job.events.at(-1).actors.map(actor => actor.position), [[240,220],[500,220]]);
      assert.equal(finished.job.runtime.phase, 'finished'); assert.equal(finished.job.runtime.sequence, 4);
      assert.deepEqual(await inventory(path.join(buildDirectory, 'project')), projectBefore);
      assert.deepEqual(await inventory(offline), before);
      const sessions = await fs.readdir(path.join(buildDirectory, 'sessions')); assert.equal(sessions.length, 1);
      const session = JSON.parse(await fs.readFile(path.join(buildDirectory, 'sessions', sessions[0], 'session.json')));
      assert.equal(session.status, 'succeeded'); assert.deepEqual(session.events, finished.job.events);
      await assert.rejects(fs.stat(path.join(buildDirectory, 'sessions', sessions[0], 'project')), { code: 'ENOENT' });
      events.push(finished.job.events);
    } finally { await fs.rename(offline, work); }
    assert.deepEqual(await inventory(work), before);
    assert.equal((await service.status({ refresh: true })).catalogDiagnostic, null);
    await service.close();
    report.desktopChecks.push({ backendId, discovery: { sceneCount: discovered.scenes.length, identifyCalls: 0, status: discovered.toolStatus },
      probe: { status: checked.toolStatus, jobCreated: false, outputCreated: false }, cli, wrongTool: rejected.toolStatus, wrongCli,
      planStatus: planned.job.status, buildStatus: built.job.status, buildId: built.latestBuild.id,
      snapshotId: built.latestBuild.snapshotId, buildPhases: record.phases.map(({ phase, status }) => ({ phase, status })),
      offlineRunStatus: finished.job.status, offlineCatalogDiagnostic: finished.catalogDiagnostic,
      offlineAuthorCommandsRejected: ['plan', 'build'], identifyCalls: identifyCount, events: finished.job.events, observation: finished.job.runtime,
      sourceTreeByteIdentical: true, frozenGeneratedProjectByteIdentical: true, sessionProjectRemoved: true, authorInventory: before });
  }
  assert.deepEqual(events[0], events[1]);
  assert.equal(report.desktopChecks.length, 2);
  report.counts = { realReadyServiceProbes: report.desktopChecks.filter(check => check.probe.status.status === 'ready').length,
    realRejectedServiceProbes: report.desktopChecks.filter(check => check.wrongTool.status === 'unavailable').length,
    realReadyCliProbes: report.desktopChecks.filter(check => check.cli.ok).length,
    realRejectedCliProbes: report.desktopChecks.filter(check => !check.wrongCli.ok).length,
    plans: report.desktopChecks.filter(check => check.planStatus === 'succeeded').length,
    builds: report.desktopChecks.filter(check => check.buildStatus === 'succeeded').length,
    offlineRuntimeSessions: report.desktopChecks.filter(check => check.offlineRunStatus === 'succeeded').length,
    offlineAuthorCommandRejections: report.desktopChecks.reduce((sum, check) => sum + check.offlineAuthorCommandsRejected.length, 0),
    runtimeEvents: events.reduce((sum, value) => sum + value.length, 0) };

  const context = vm.createContext({});
  const mobileSource = await fs.readFile(path.join(mobile, 'engine/execution-tool-status.mjs'), 'utf8');
  const module = new vm.SourceTextModule(mobileSource, { context, identifier: 'mobile:/engine/execution-tool-status.mjs' });
  let imports = 0;
  await module.link(specifier => { imports++; throw new Error(`Portable tool status imported host code: ${specifier}`); });
  await module.evaluate();
  const valueInVm = value => { context.inputJson = JSON.stringify(value); return vm.runInContext('JSON.parse(inputJson)', context); };
  let validCases = 0, rejectedCases = 0;
  for (const value of mobileInputs) {
    const portable = module.namespace.validateExecutionToolStatus(valueInVm(value));
    assert.deepEqual(plain(portable), value); assert.ok(Object.isFrozen(portable));
    if (portable.identity) assert.ok(Object.isFrozen(portable.identity)); validCases++;
  }
  for (const status of ['unchecked', 'checking']) {
    const value = module.namespace.createExecutionToolStatus(valueInVm({ backendId: 'org.viento.bevy', status }));
    assert.equal(value.reason, null); assert.equal(value.identity, null); validCases++;
  }
  for (const reason of plain(module.namespace.EXECUTION_TOOL_REASONS)) {
    const value = module.namespace.createExecutionToolStatus(valueInVm({ backendId: 'org.viento.bevy', status: 'unavailable', reason }));
    assert.equal(value.reason, reason); assert.equal(value.identity, null); validCases++;
  }
  const bad = [
    { ...plain(mobileInputs[0]), toolPath: '/private/host' },
    { ...plain(mobileInputs[0]), identity: { ...plain(mobileInputs[0].identity), executable: '/private/host' } },
    { ...plain(mobileInputs[0]), identity: { ...plain(mobileInputs[0].identity), sha256: 'wrong' } },
    { ...plain(mobileInputs[0]), identity: { ...plain(mobileInputs[0].identity), version: '/private/host' } },
    { ...plain(mobileInputs[1]), reason: 'private failure output' },
    { ...plain(mobileInputs[0]), schemaVersion: 2 },
  ];
  for (const value of bad) {
    assert.throws(() => module.namespace.validateExecutionToolStatus(valueInVm(value)), error => error.errorCode === 'build_tool_status_invalid');
    rejectedCases++;
  }
  assert.equal(imports, 0); assert.equal(module.status, 'evaluated');
  assert.equal(vm.runInContext('[typeof process,typeof require,typeof document,typeof fetch,typeof Buffer].join(",")', context),
    'undefined,undefined,undefined,undefined,undefined');
  report.mobileChecks = { moduleCount: 1, moduleStatus: module.status, hostOrRendererImports: imports,
    validCases, rejectedCases, actualDesktopStatuses: mobileInputs, noNodeDomOrNetworkGlobals: true,
    androidExecutionClaimed: false, androidUiClaimed: false };
  report.ok = true;
} finally {
  await Promise.allSettled(services.map(service => service.close()));
  await fs.rm(temporary, { recursive: true, force: true });
}
await assert.rejects(fs.stat(temporary), { code: 'ENOENT' });
report.temporaryFixtureAndCacheRemoved = true;
await fs.writeFile(path.join(evidence, 'packaged-resources.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ok: report.ok, embeddedNode: report.embeddedNode.version,
  artifacts: Object.fromEntries(Object.entries(report.artifacts).map(([name, value]) => [name, {
    manifestFileCount: value.manifestFileCount, manifestBytes: value.manifestBytes, manifestSha256: value.manifestSha256,
    checkedSourceFiles: value.checkedSourceFiles, checkedSourceSha256: value.checkedSourceSha256 }])),
  counts: report.counts, mobile: { moduleCount: report.mobileChecks.moduleCount, validCases: report.mobileChecks.validCases,
    rejectedCases: report.mobileChecks.rejectedCases }, tools: report.externalTools,
  sourceTreeByteIdentical: true, frozenGeneratedProjectByteIdentical: true, temporaryFixtureAndCacheRemoved: true }, null, 2));
