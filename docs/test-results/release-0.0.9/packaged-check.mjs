// Run after final preparation with the pinned embedded Node and existing host tools.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
if (process.argv.includes('--source-only')) {
  await checkSourceArchive();
  process.exit(0);
}
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
  scope: 'Release 0.0.9 current prepared desktop resources under pinned Node execute the same finite cases in real Godot and Bevy, read each current owned member report and verify recomputed pass/fail results, immutable publication and source-offline/build-pruned reads. Optional actual cancellation is recorded only if observed before commit. Prepared mobile resources only run the pure report validator in an isolated VM; no host/device execution, archive migration or installed Tauri acceptance',
  embeddedNode: { version: process.version, sha256: await fileHash(process.execPath) },
  proofSourceSha256: await fileHash(fileURLToPath(import.meta.url)),
  artifacts: {}, unchangedBackendSources: {}, externalTools: [], desktopChecks: [], mobileChecks: {} };
const sourceHashes = JSON.parse(await fs.readFile(path.join(evidence, 'source-hashes.json')));
const expectedSourceFiles = Number(process.env.VIENTO_RELEASE_SOURCE_FILES);
assert.ok(Number.isSafeInteger(expectedSourceFiles) && expectedSourceFiles >= 520, 'Provide the final release source-manifest count');
assert.equal(Object.keys(sourceHashes).length, expectedSourceFiles);
async function verifyFrozenSources() {
  for (const [file, expected] of Object.entries(sourceHashes)) assert.equal(await fileHash(path.join(root, file)), expected, `Frozen source changed: ${file}`);
}
await verifyFrozenSources();
report.frozenSourceManifest = { files: Object.keys(sourceHashes).length, sha256: await fileHash(path.join(evidence, 'source-hashes.json')), hashes: sourceHashes };
report.version = (await fs.readFile(path.join(root, 'VERSION'), 'utf8')).trim();
assert.equal(report.version, '0.0.9');
const runtimeConfiguration = JSON.parse(await fs.readFile(path.join(root, 'desktop/node-runtime.json')));
assert.equal(report.embeddedNode.sha256, '89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7');

const shared = [...(await fs.readdir(path.join(root, 'engine'))).filter(file => file.endsWith('.mjs')).map(file => `engine/${file}`),
  'engine/studio-core.wasm', 'engine/studio-core.build.json', 'web/project-build.css', 'favicon.ico',
  ...['app-runtime.js', 'app-project-build.js', 'app-scene-preview.js', 'app-scene-composition-overrides.js','app-runtime-case-documents.js','app-runtime-case-suites.js','app-runtime-case-report.js','app-doc-service.js'].map(file => `web/modules/${file}`),
  ...['messages.js', 'en.js', 'ja.js'].map(file => `web/i18n/${file}`)];
const host = ['scripts/adapters/node-execution-backends.mjs', 'scripts/adapters/node-execution-tool.mjs',
  'scripts/adapters/node-execution-tool-probe.mjs', 'scripts/adapters/node-project-build.mjs',
  'scripts/adapters/node-build-snapshot.mjs', 'scripts/adapters/node-world-projection.mjs', 'scripts/adapters/node-studio-core.mjs',
  'scripts/adapters/node-runtime-case-suite.mjs','scripts/lib/project-build-service.mjs','scripts/lib/runtime-author-documents.mjs','scripts/lib/runtime-case-documents.mjs','scripts/lib/runtime-case-suites.mjs','scripts/lib/runtime-case-reports.mjs','scripts/adapters/node-document-storage.mjs','scripts/lib/doc-file-store.mjs','scripts/lib/project-documents.mjs','scripts/lib/resource-package-catalog.mjs','scripts/lib/resource-package-reader.mjs','scripts/lib/resource-package-import.mjs', 'scripts/lib/build-process.mjs', 'scripts/lib/doc-api-service.mjs', 'scripts/project-build.mjs',
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
  const allCopies = {};
  for (const [file, prepared] of Object.entries(files)) {
    let origin = file, transformation = null, expected;
    if (name === 'desktop/resources' && file === 'package.json') {
      expected = Buffer.from(JSON.stringify({ private: true, type: 'module', version: report.version, displayVersion: report.version }));
      origin = 'VERSION'; transformation = 'generated package metadata';
    } else if (name === 'desktop/resources' && file === 'NODE-LICENSE') {
      origin = `desktop/.cache/${runtimeConfiguration.version}-LICENSE`;
      expected = await fs.readFile(path.join(root, origin));
      assert.equal(hash(expected), runtimeConfiguration.licenseSha256);
    } else if (name === 'mobile/dist' && file.startsWith('vendor/yaml/')) {
      origin = file === 'vendor/yaml/LICENSE' ? 'node_modules/yaml/LICENSE' : file.replace('vendor/yaml/', 'node_modules/yaml/browser/');
      expected = await fs.readFile(path.join(root, origin));
    } else if (name === 'mobile/dist' && file === 'index.html') {
      origin = 'mobile/index.html'; transformation = 'release version substitution';
      expected = Buffer.from((await fs.readFile(path.join(root, origin), 'utf8')).replaceAll('__VIENTO_VERSION__', report.version));
    } else if (name === 'mobile/dist' && file === 'editor.html') {
      origin = 'web/index.html'; transformation = 'mobile shell entry';
      expected = Buffer.from((await fs.readFile(path.join(root, origin), 'utf8'))
        .replace(/<title>.*?<\/title>/, '<title>Viento Studio</title>')
        .replace('</head>', '<link rel="stylesheet" href="/mobile/mobile.css" /></head>')
        .replace('<body>', '<body class="mobile-host">')
        .replace('<script type="module" src="/web/app.js"></script>', '<script type="module" src="/mobile/editor.js"></script>')
        .replace('<script type="module" src="/web/modules/desktop-bridge.js"></script>', ''));
    } else {
      const source = await fs.readFile(path.join(root, origin));
      expected = name === 'mobile/dist' && file.startsWith('engine/') && file.endsWith('.mjs') ? Buffer.from(rewrite(source.toString('utf8'))) : source;
      if (!expected.equals(source)) transformation = 'local YAML import rewrite';
    }
    assert.equal(prepared.sha256, hash(expected), `Full prepared inventory differs: ${name}/${file}`);
    allCopies[file] = { source: origin, sourceSha256: await fileHash(path.join(root, origin)), expectedSha256: hash(expected), transformation };
  }
  report.artifacts[name].fullSourceCopyCount = Object.keys(allCopies).length;
  report.artifacts[name].fullSourceCopySha256 = hash(JSON.stringify(allCopies));
  report.artifacts[name].fullSourceCopies = allCopies;
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

const { validateRuntimeCase } = await imported('engine/runtime-verification-case.mjs');
const { createRuntimeCaseReport, validateRuntimeCaseReport, RUNTIME_CASE_REPORT_FILE_MAX_BYTES } = await imported('engine/runtime-case-report.mjs');
const { canonicalJson } = await imported('engine/canonical-json.mjs');
const exampleBaseline = await inventory(path.join(root, 'examples/bevy-headless'));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-release-009-packaged-'));
const services = [], portableReports = [], passingSamples = [];
const first = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const release = { left: false, right: false, up: false, down: false };
const definitions = [validateRuntimeCase({ format: 'viento-runtime-case', schemaVersion: 1,
  program: { format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: .125,
    steps: [{ inputs: [{ instanceId: first, ...release, right: true }, { instanceId: second, ...release, left: true }] }, { inputs: [] }] },
  checks: [{ instanceId: first, stepIndex: 0, position: { value: [220, 220], tolerance: .0001 }, state: 'moving' },
    { instanceId: first, stepIndex: 1, position: { value: [220, 220], tolerance: .0001 }, state: 'idle' },
    { instanceId: second, stepIndex: 1, position: { value: [500, 220], tolerance: .0001 }, state: 'idle' }] }),
validateRuntimeCase({ format: 'viento-runtime-case', schemaVersion: 1,
  program: { format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: .125,
    steps: [{ ...release, left: true }, { ...release }] },
  checks: [{ instanceId: first, stepIndex: 0, position: { value: [180, 220], tolerance: .0001 }, state: 'moving' },
    { instanceId: first, stepIndex: 1, position: { value: [180, 220], tolerance: .0001 }, state: 'idle' },
    { instanceId: second, stepIndex: 1, position: { value: [500, 220], tolerance: .0001 }, state: 'idle' }] })];
const wrong = plain(definitions[0]); wrong.checks[0].position.value[0] += 1;
const longCase = validateRuntimeCase({ format: 'viento-runtime-case', schemaVersion: 1,
  program: { format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: .125,
    steps: Array.from({ length: 64 }, (_, index) => ({ inputs: index === 63 ? [] : [{ instanceId: first, ...release,
      ...(index % 2 === 0 ? { right: true } : { left: true }) }] })) },
  checks: [{ instanceId: first, stepIndex: 0, position: { value: [220, 220], tolerance: .0001 }, state: 'moving' },
    { instanceId: first, stepIndex: 63, position: { value: [220, 220], tolerance: .0001 }, state: 'idle' }] });
const wrapper = definition => ({ format: 'viento-runtime-case-document', schemaVersion: 1, sceneObjectId: sceneId, case: definition });
const authorText = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
const readRequest = (job, documentId) => ({ action: 'suite-report', jobId: job.id, documentId });
async function settle(service, expected) {
  for (let index = 0; index < 4000; index++) {
    const state = await service.status();
    assert.equal(state.job?.id, expected.id); assert.equal(state.job?.kind, expected.kind);
    if (state.job.status !== 'running') return state;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Prepared service did not settle');
}
async function runJob(service, payload) {
  const previous = (await service.status()).job?.id, started = await service.command(payload);
  assert.ok(started.job?.id && started.job.id !== previous);
  const kind = payload.action === 'suite-run' ? 'suite' : payload.action;
  assert.equal(started.job.kind, kind);
  return settle(service, { id: started.job.id, kind });
}
async function receiptInventory(cacheRoot) {
  const manifest = await inventory(cacheRoot), result = [];
  for (const file of Object.keys(manifest).filter(file => /^suites\/[^/]+\/suite\.json$/.test(file))) {
    const directory = path.dirname(path.join(cacheRoot, file)), value = JSON.parse(await fs.readFile(path.join(cacheRoot, file)));
    const reports = [];
    for (const name of (await fs.readdir(directory)).filter(name => /^member-[a-f0-9-]+\.json$/.test(name))) {
      const bytes = await fs.readFile(path.join(directory, name)), parsed = validateRuntimeCaseReport(JSON.parse(bytes));
      assert.deepEqual(bytes, Buffer.from(JSON.stringify(parsed) + '\n'));
      assert.equal((await fs.stat(path.join(directory, name))).mode & 0o777, 0o600);
      reports.push({ documentId: parsed.context.documentId, sha256: hash(bytes), bytes: bytes.length, report: plain(parsed) });
    }
    assert.deepEqual(reports.map(item => item.documentId).sort(), value.suite.entries.filter(item => item.reportAvailable).map(item => item.documentId).sort());
    result.push({ id: path.basename(directory), sha256: manifest[file].sha256, record: value, memberReports: reports });
  }
  return result;
}
function validatePublicReport(value, job, entry, group, build, definition, work, tool) {
  assert.deepEqual(validateRuntimeCaseReport(value), value);
  const { context, executionStatus, targets, samples } = value;
  assert.deepEqual(createRuntimeCaseReport({ context, executionStatus, targets, definition, samples }), value);
  assert.equal(context.documentId, entry.documentId); assert.equal(context.sourceVersion, entry.sourceVersion);
  assert.equal(context.suiteDocumentId, group.id); assert.equal(context.suiteSourceVersion, group.version);
  assert.equal(context.sceneObjectId, sceneId); assert.equal(context.sceneSourcePath, 'documents/scenes/demo.json');
  assert.equal(context.buildId, build.id); assert.equal(context.snapshotId, build.snapshotId);
  assert.equal(context.sessionId, entry.sessionId); assert.equal(executionStatus, entry.executionStatus);
  assert.equal(value.evaluation.status, entry.state); assert.equal(value.evaluation.checkCount, entry.checkCount);
  assert.equal(value.evaluation.passedChecks, entry.passedChecks); assert.equal(value.evaluation.failedChecks, entry.failedChecks);
  assert.equal(value.evaluation.unavailableChecks, entry.unavailableChecks);
  assert.equal(entry.reportAvailable, true); assert.equal(Object.isFrozen(value.samples), true);
  const encoded = Buffer.from(JSON.stringify(value) + '\n'); assert.ok(encoded.length <= RUNTIME_CASE_REPORT_FILE_MAX_BYTES);
  for (const privateText of [temporary, work, tool, 'receiptDirectory', 'definitionSha256', 'executable', 'stdout', 'stderr']) {
    assert.ok(!encoded.toString('utf8').includes(privateText), 'Portable member report must not expose host authority or logs');
  }
  assert.equal(job.kind, 'suite'); return encoded;
}

try {
  for (const [backendId, tool] of configured) {
    console.log(JSON.stringify({ phase: 'prepared-report-engine', backendId }));
    const name = backendId.split('.').at(-1), work = path.join(temporary, name), cacheRoot = path.join(temporary, name + '-cache');
    await fs.cp(path.join(root, 'examples/bevy-headless'), work, { recursive: true });
    const original = await inventory(work), service = createProjectBuildService(work, { backendId, tool, cacheRoot }); services.push(service);
    const members = [], savedSources = [];
    const caseInputs = [definitions[0], definitions[1], wrong, ...(backendId === 'org.viento.godot4' ? [longCase] : [])];
    for (const [index, definition] of caseInputs.entries()) {
      const sourcePath = `documents/runtime-cases/report-${index}.json`, catalog = await service.command({ action: 'case-list', sceneId });
      const content = authorText(wrapper(definition));
      const saved = await service.command({ action: 'case-save', sceneId, sceneVersion: catalog.sceneVersion,
        sourcePath, documentType: catalog.defaults.documentType, content });
      const loaded = await service.command({ action: 'case-load', documentId: saved.id });
      assert.equal(loaded.valid, true); assert.equal(loaded.content, content); assert.deepEqual(loaded.definition, definition);
      members.push(loaded); savedSources.push(sourcePath);
    }
    const groups = [];
    const groupMembers = [[members[0], members[1]], [members[2], members[1]], ...(backendId === 'org.viento.godot4' ? [[members[3], members[1]]] : [])];
    for (const [index, rows] of groupMembers.entries()) {
      const sourcePath = `documents/runtime-suites/report-${index}.json`, catalog = await service.command({ action: 'suite-list', sceneId });
      const definition = { format: 'viento-runtime-case-suite', schemaVersion: 1, sceneObjectId: sceneId, documentIds: rows.map(item => item.id) };
      const content = authorText(definition), saved = await service.command({ action: 'suite-save', sceneId, sceneVersion: catalog.sceneVersion,
        sourcePath, documentType: catalog.defaults.documentType, content });
      const loaded = await service.command({ action: 'suite-load', documentId: saved.id });
      assert.equal(loaded.valid, true); assert.equal(loaded.content, content); assert.deepEqual(loaded.definition, definition);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(work, `metadata/documents/${saved.id}.json`))).relations, []);
      groups.push(loaded); savedSources.push(sourcePath);
    }
    const authorBaseline = await inventory(work);
    for (const [file, expected] of Object.entries(original)) assert.deepEqual(authorBaseline[file], expected, 'Existing author bytes must stay immutable');
    const addedFiles = Object.keys(authorBaseline).filter(file => !Object.hasOwn(original, file)).sort();
    assert.deepEqual(addedFiles, [...savedSources, ...[...members, ...groups].map(item => `metadata/documents/${item.id}.json`)].sort());
    const probe = await runProjectBuildCommand(['--command', 'tool-check', '--backend', backendId, '--tool', tool]);
    assert.equal(probe.ok, true); assert.equal(probe.toolStatus.status, 'ready');
    assert.equal(probe.toolStatus.identity.sha256, await fileHash(tool));
    report.externalTools.push({ backendId, identity: probe.toolStatus.identity, bytes: (await fs.stat(tool)).size });
    const planned = await runJob(service, { action: 'plan', sceneId }); assert.equal(planned.job.status, 'succeeded');
    const built = await runJob(service, { action: 'build', sceneId, expectedSnapshotId: planned.job.plan.snapshotId }); assert.equal(built.job.status, 'succeeded');
    const buildFiles = Object.keys(await inventory(cacheRoot)).filter(file => file.endsWith('/build.json')); assert.equal(buildFiles.length, 1);
    const directory = path.dirname(path.join(cacheRoot, buildFiles[0])), generatedBaseline = await inventory(path.join(directory, 'project'));
    const request = group => ({ action: 'suite-run', buildId: built.latestBuild.id, suiteDocumentId: group.id, expectedVersion: group.version });
    const pass = await runJob(service, request(groups[0]));
    assert.equal(pass.job.status, 'succeeded'); assert.equal(pass.job.suite.summary.status, 'passed');
    assert.deepEqual(pass.job.suite.entries.map(item => item.state), ['passed', 'passed']);
    const passReports = [], onlineExports = [];
    for (const [index, entry] of pass.job.suite.entries.entries()) {
      const value = await service.command(readRequest(pass.job, entry.documentId));
      validatePublicReport(value, pass.job, entry, groups[0], built.latestBuild, definitions[index], work, tool);
      assert.equal(value.context.backendId, backendId); assert.equal(value.samples.length, 2);
      passReports.push(plain(value)); portableReports.push(plain(value));
    }
    passingSamples.push(passReports.map(value => value.samples));
    let cancellation = { attempted: false, partialPrefixObserved: false, nativeCancellationClaimed: false };
    if (backendId === 'org.viento.godot4') {
      const started = await service.command(request(groups[2])); let sampled = 0, cancelled = false;
      for (let index = 0; index < 10000; index++) {
        const state = await service.status(); assert.equal(state.job.id, started.job.id);
        if (state.job.status !== 'running') break;
        sampled = state.job.control?.samples.length || 0;
        if (sampled > 0) { await service.command({ action: 'cancel', jobId: started.job.id }); cancelled = true; break; }
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      const state = await settle(service, { id: started.job.id, kind: 'suite' }), current = [];
      for (const [index, entry] of state.job.suite.entries.entries()) {
        if (!entry.reportAvailable) {
          await assert.rejects(service.command(readRequest(state.job, entry.documentId)), error => error.errorCode === 'runtime_report_not_ready' && error.statusCode === 409);
          continue;
        }
        const value = await service.command(readRequest(state.job, entry.documentId));
        validatePublicReport(value, state.job, entry, groups[2], built.latestBuild, index === 0 ? longCase : definitions[1], work, tool);
        current.push(plain(value)); portableReports.push(plain(value));
      }
      if (state.job.status === 'cancelled') {
        assert.equal(state.job.suite.summary.status, 'incomplete'); assert.equal(state.job.suite.summary.complete, false);
        for (const value of current) if (value.executionStatus === 'cancelled') assert.equal(value.evaluation.status, 'incomplete');
        for (const row of state.job.suite.entries) if (row.state === 'not-run') {
          assert.equal(row.reportAvailable, false); assert.equal(row.sessionId, null);
        }
      } else assert.equal(state.job.status, 'succeeded', 'A late cancellation must preserve fully committed results');
      cancellation = { attempted: true, requestedAfterActualSamples: cancelled, observedBeforeRequest: sampled,
        jobId: state.job.id, status: state.job.status, suite: state.job.suite, reports: current,
        partialPrefixObserved: current.some(value => value.executionStatus === 'cancelled' && value.samples.length > 0 && value.samples.length < value.definition.program.steps.length),
        nativeCancellationClaimed: current.some(value => value.executionStatus === 'cancelled'), limitation: 'Actual finite native replay may emit all 64 samples before the polling client can cancel. A complete sample set alone never upgrades a cancelled execution to passed; cancellation between committed members does not claim native cancellation.' };
    }
    const failed = await runJob(service, request(groups[1]));
    assert.equal(failed.job.status, 'succeeded'); assert.equal(failed.job.suite.summary.status, 'failed');
    assert.deepEqual(failed.job.suite.entries.map(item => item.state), ['failed', 'passed']);
    await assert.rejects(service.command(readRequest(pass.job, members[0].id)), error => error.errorCode === 'runtime_report_job_missing' && error.statusCode === 404);
    const failReports = [];
    for (const [index, entry] of failed.job.suite.entries.entries()) {
      const value = await service.command(readRequest(failed.job, entry.documentId));
      const bytes = validatePublicReport(value, failed.job, entry, groups[1], built.latestBuild, index === 0 ? wrong : definitions[1], work, tool);
      assert.equal(value.executionStatus, 'succeeded'); assert.equal(value.evaluation.complete, true);
      assert.equal(value.samples.length, 2); failReports.push(plain(value)); onlineExports.push(bytes); portableReports.push(plain(value));
    }
    assert.equal(failReports[0].evaluation.failedChecks, 1); assert.deepEqual(failReports[0].samples, passReports[0].samples);
    assert.deepEqual(failReports[0].definition.program, passReports[0].definition.program);
    assert.equal(hash(canonicalJson(failReports[0].definition.program)), hash(canonicalJson(passReports[0].definition.program)));
    assert.equal(failReports[0].evaluation.checks[0].positionPassed, false);
    assert.deepEqual(failReports[0].evaluation.checks[0].actual.position, [220, 220]);
    assert.deepEqual(failReports[0].evaluation.checks[0].expected.position.value, [221, 220]);
    assert.deepEqual(failReports[1].evaluation, passReports[1].evaluation);
    assert.deepEqual(await inventory(work), authorBaseline);
    assert.deepEqual(await inventory(path.join(directory, 'project')), generatedBaseline);
    const sessionIds = await fs.readdir(path.join(directory, 'sessions'));
    assert.equal(new Set(sessionIds).size, sessionIds.length);
    const receipts = await receiptInventory(cacheRoot), receiptSessionIds = receipts.flatMap(item => item.record.suite.entries.map(entry => entry.sessionId).filter(Boolean));
    assert.equal(new Set(receiptSessionIds).size, receiptSessionIds.length); assert.equal(receiptSessionIds.length, sessionIds.length);
    assert.ok(receiptSessionIds.every(id => sessionIds.includes(id)));
    for (const receipt of receipts) {
      assert.equal(receipt.record.buildId, built.latestBuild.id); assert.equal(receipt.record.snapshotId, built.latestBuild.snapshotId);
      for (const member of receipt.memberReports) {
        const sessionFile = path.join(directory, 'sessions', member.report.context.sessionId, 'session.json');
        const record = JSON.parse(await fs.readFile(sessionFile));
        assert.equal(record.status, member.report.executionStatus);
        assert.deepEqual(record.control.samples, member.report.samples); assert.deepEqual(record.verification.evaluation, member.report.evaluation);
        assert.deepEqual(record.verification.definition, member.report.definition);
        await assert.rejects(fs.stat(path.join(directory, 'sessions', member.report.context.sessionId, 'project')), { code: 'ENOENT' });
        member.sessionSha256 = await fileHash(sessionFile);
      }
    }
    const actualFailedReceipt = receipts.find(item => item.record.suite.documentId === groups[1].id);
    assert.ok(actualFailedReceipt); assert.equal(actualFailedReceipt.memberReports.length, 2);
    for (const [index, value] of failReports.entries()) {
      const disk = actualFailedReceipt.memberReports.find(item => item.documentId === value.context.documentId);
      assert.equal(hash(onlineExports[index]), disk.sha256); assert.deepEqual(disk.report, value);
    }
    let rejectedAuthorityInputs = 0;
    for (const key of ['path', 'receiptDirectory', 'sessionId', 'backendId', 'tool']) {
      await assert.rejects(service.command({ ...readRequest(failed.job, members[2].id), [key]: key === 'sessionId' ? failReports[0].context.sessionId : tool }), error => error.errorCode === 'build_request_invalid');
      rejectedAuthorityInputs++;
    }
    await assert.rejects(service.command(readRequest(failed.job, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')), error => error.errorCode === 'runtime_report_job_missing' && error.statusCode === 404);
    const foreign = createProjectBuildService(work, { backendId, tool, cacheRoot }); services.push(foreign);
    await assert.rejects(foreign.command(readRequest(failed.job, members[2].id)), error => error.errorCode === 'runtime_report_job_missing' && error.statusCode === 404);
    await foreign.close();
    const beforeReportManifest = Object.fromEntries(Object.entries(await inventory(path.join(cacheRoot, 'suites'))).filter(([file]) => /member-[^/]+\.json$/.test(file)));
    await fs.rename(work, work + '-offline'); await fs.rm(directory, { recursive: true });
    for (const [index, entry] of failed.job.suite.entries.entries()) {
      const value = await service.command(readRequest(failed.job, entry.documentId));
      assert.deepEqual(value, failReports[index]); assert.deepEqual(Buffer.from(JSON.stringify(value) + '\n'), onlineExports[index]);
    }
    assert.deepEqual(await inventory(work + '-offline'), authorBaseline);
    assert.deepEqual(Object.fromEntries(Object.entries(await inventory(path.join(cacheRoot, 'suites'))).filter(([file]) => /member-[^/]+\.json$/.test(file))), beforeReportManifest);
    await assert.rejects(fs.stat(directory), { code: 'ENOENT' }); await assert.rejects(fs.stat(work), { code: 'ENOENT' });
    report.desktopChecks.push({ backendId, buildId: built.latestBuild.id, snapshotId: built.latestBuild.snapshotId,
      savedCaseIds: members.map(item => item.id), savedSuiteIds: groups.map(item => item.id), addedAuthorFiles: addedFiles,
      servicePassedSuite: pass.job.suite, serviceFailedSuite: failed.job.suite, passedReports: passReports, failedReports: failReports,
      cancellation, batchReceipts: receipts, runtimeSessionIdsBeforeBuildPrune: sessionIds,
      onlineReportReads: 4 + (cancellation.reports?.length || 0), offlineBuildPrunedReportReads: failReports.length,
      exportedReportSha256: onlineExports.map(bytes => hash(bytes)), sourceOfflineAndBuildPrunedRead: true,
      originalAuthorBytesImmutable: true, savedAuthorBytesImmutableDuringExecution: true,
      bomCrLfSavedSourcesPreserved: true, sameProgramAndSamplesForPassAndFailure: true, assertionFailureContinues: true,
      generatedProjectImmutableBeforeIntentionalOwnBuildPrune: true, allReportBytesImmutableAfterOfflineAndPrune: true,
      oldJobAndForeignServiceReadsRejected: true, rejectedAuthorityInputs, outputExportByteLimit: RUNTIME_CASE_REPORT_FILE_MAX_BYTES });
    console.log(JSON.stringify({ phase: 'prepared-report-engine-complete', backendId, receipts: receipts.length,
      sessions: sessionIds.length, storedMemberReports: receipts.reduce((sum, item) => sum + item.memberReports.length, 0), cancellation: cancellation.status || 'not attempted' }));
    await service.close();
  }
  assert.deepEqual(passingSamples[0], passingSamples[1]);
  const context = vm.createContext({}), modules = new Map();
  function load(relative) {
    assert.equal(relative, path.posix.normalize(relative));
    assert.ok(relative.startsWith('engine/') && relative.endsWith('.mjs') && !/[\\\0?#]/.test(relative));
    if (!modules.has(relative)) modules.set(relative, fs.readFile(path.join(mobile, relative), 'utf8')
      .then(source => new vm.SourceTextModule(source, { context, identifier: relative })));
    return modules.get(relative);
  }
  function linker(specifier, referencingModule) {
    assert.ok(typeof specifier === 'string' && !/[\\\0?#]/.test(specifier)
      && (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/engine/')),
    'No host, bare, vendor, network or escaped imports may enter the report-only mobile VM');
    return load(path.posix.normalize(specifier.startsWith('/') ? specifier.slice(1)
      : path.posix.join(path.posix.dirname(referencingModule.identifier), specifier)));
  }
  const entryModule = 'engine/runtime-case-report.mjs', entry = await load(entryModule); await entry.link(linker); await entry.evaluate();
  const pure = entry.namespace, valueInVm = value => { context.inputJson = JSON.stringify(value); return vm.runInContext('JSON.parse(inputJson)', context); };
  let accepted = 0, rejected = 0;
  for (const value of portableReports) {
    assert.deepEqual(plain(pure.validateRuntimeCaseReport(valueInVm(value))), value); accepted++;
    const { context, executionStatus, targets, definition, samples } = value;
    assert.deepEqual(plain(pure.createRuntimeCaseReport(valueInVm({ context, executionStatus, targets, definition, samples }))), value); accepted++;
  }
  const exemplar = portableReports[0];
  const mutations = [value => { value.evaluation.status = 'failed'; }, value => { value.evaluation.failedChecks = 1; },
    value => { value.evaluation.checks[0].actual.position[0] += 1; }, value => { value.context.backendId = 'bevy'; },
    value => { value.context.backendId = 'org/evil'; }, value => { value.tool = '/private/tool'; },
    value => { value.context.receiptDirectory = '/private/receipt'; }, value => { value.samples[1].stepIndex = 0; },
    value => { value.samples[0].actors[0].objectId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; },
    value => { value.context.sessionId = null; }];
  for (const mutate of mutations) {
    const bad = plain(exemplar); mutate(bad);
    assert.throws(() => pure.validateRuntimeCaseReport(valueInVm(bad)), error => error.errorCode === 'runtime_case_report_invalid'); rejected++;
  }
  assert.equal(vm.runInContext('[typeof process,typeof require,typeof document,typeof fetch,typeof Buffer].join(",")', context), 'undefined,undefined,undefined,undefined,undefined');
  report.mobileChecks = { entryModuleCount: 1, entryModules: [entryModule], moduleCount: modules.size, modules: [...modules.keys()].sort(),
    validatedActualReports: portableReports.length, acceptedCases: accepted, rejectedCases: rejected,
    recomputesEvaluations: true, strictBackendNamespace: true, outputOnlyShapeValidationNotExternalEngineAuthenticity: true,
    noNodeDomNetworkOrVendorImports: true, desktopSamplesOnly: true,
    androidHostOrDeviceExecutionClaimed: false, androidUiAcceptanceClaimed: false };
  report.counts = { backends: report.desktopChecks.length, builds: report.desktopChecks.length,
    passedServiceSuites: report.desktopChecks.length, failedServiceSuitesWithContinuation: report.desktopChecks.length,
    batchReceipts: report.desktopChecks.reduce((sum, item) => sum + item.batchReceipts.length, 0),
    runtimeSessions: report.desktopChecks.reduce((sum, item) => sum + item.runtimeSessionIdsBeforeBuildPrune.length, 0),
    storedMemberReports: report.desktopChecks.reduce((sum, item) => sum + item.batchReceipts.reduce((count, receipt) => count + receipt.memberReports.length, 0), 0),
    onlineReportReads: report.desktopChecks.reduce((sum, item) => sum + item.onlineReportReads, 0),
    sourceOfflineAndBuildPrunedReportReads: report.desktopChecks.reduce((sum, item) => sum + item.offlineBuildPrunedReportReads, 0),
    actualCancellationAttempts: report.desktopChecks.filter(item => item.cancellation.attempted).length,
    cancelledNativeSuites: report.desktopChecks.filter(item => item.cancellation.nativeCancellationClaimed).length,
    actualPartialCancelledPrefixes: report.desktopChecks.filter(item => item.cancellation.partialPrefixObserved).length,
    archivesExportedOrRestoredThisProbe: 0 };
  report.ok = true;
} finally {
  await Promise.allSettled(services.map(service => service.close())); await fs.rm(temporary, { recursive: true, force: true });
}
await verifyFrozenSources();
assert.deepEqual(await inventory(path.join(root, 'examples/bevy-headless')), exampleBaseline, 'Original example author bytes changed');
for (const artifact of Object.values(report.artifacts)) for (const [file, expected] of Object.entries(artifact.hashes)) {
  assert.equal(await fileHash(path.join(root, file)), expected.sourceSha256, `Source changed during prepared acceptance: ${file}`);
}
for (const [name, artifact] of Object.entries(report.artifacts)) {
  assert.deepEqual(await inventory(path.join(root, name)), artifact.manifest, 'Prepared full resource manifest changed during acceptance');
  for (const expected of Object.values(artifact.fullSourceCopies)) assert.equal(await fileHash(path.join(root, expected.source)), expected.sourceSha256);
}
for (const [backendId, tool] of configured) assert.equal(await fileHash(tool), report.externalTools.find(item => item.backendId === backendId).identity.sha256);
assert.equal(await fileHash(fileURLToPath(import.meta.url)), report.proofSourceSha256, 'Proof source changed during acceptance');
report.sourceHashesStayedStable = true; report.allPreparedManifestFilesVerified = true; report.temporaryFixtureAndCacheRemoved = true;
await fs.writeFile(path.join(evidence, 'packaged-resources.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ok: report.ok, sourceFiles: report.frozenSourceManifest.files,
  artifacts: Object.fromEntries(Object.entries(report.artifacts).map(([key, value]) => [key, {
    manifestFileCount: value.manifestFileCount, manifestBytes: value.manifestBytes, checkedSourceFiles: value.checkedSourceFiles, fullSourceCopyCount: value.fullSourceCopyCount }])),
  counts: report.counts, mobile: report.mobileChecks }));

async function checkSourceArchive() {
  const dist = path.join(root, 'dist');
  const distExisted = await fs.stat(dist).then(value => value.isDirectory(), error => {
    if (error.code !== 'ENOENT') throw error;
    return false;
  });
  await fs.mkdir(dist, { recursive: true });
  const temporaryDirectory = await fs.mkdtemp(path.join(dist, '.release-0.0.9-'));
  const archive = path.join(temporaryDirectory, 'Viento-Studio_0.0.9_source.tar.gz');
  const packager = path.join(root, 'desktop/package-source.py');
  const packagerSha256 = await fileHash(packager);
  const proofSourceSha256 = await fileHash(fileURLToPath(import.meta.url));
  const sourceManifest = path.join(evidence, 'source-hashes.json');
  const sourceManifestSha256 = await fileHash(sourceManifest);
  let result;
  try {
    const packed = spawnSync('python3', [packager, archive], {
      cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 120000,
    });
    assert.equal(packed.error, undefined, packed.error?.message);
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const publication = JSON.parse(packed.stdout.trim());
    assert.equal(publication.archive, archive);
    const auditSource = String.raw`
import hashlib, json, pathlib, re, sys, tarfile
archive_path, root_path, source_manifest_path = map(pathlib.Path, sys.argv[1:])
expected_root = 'Viento-Studio_0.0.9_source'
source_hashes = json.loads(source_manifest_path.read_text())
with tarfile.open(archive_path, 'r:gz') as archive:
    members = archive.getmembers()
    assert all(member.isfile() for member in members), 'Nonregular source archive member'
    names = [member.name for member in members]
    assert len(names) == len(set(names)), 'Duplicate source archive path'
    assert all(name.startswith(expected_root + '/') for name in names)
    manifest_name = expected_root + '/SOURCE_MANIFEST.json'
    manifest_bytes = archive.extractfile(manifest_name).read()
    manifest = json.loads(manifest_bytes)
    assert set(names) == {expected_root + '/' + relative for relative in manifest} | {manifest_name}
    total_bytes = 0
    for relative, expected in manifest.items():
        parts = pathlib.PurePosixPath(relative).parts
        assert relative == '/'.join(parts) and not relative.startswith('/')
        assert not any(part in {'.', '..', 'node_modules', 'target', '__pycache__', '.godot', '.mono', '.gradle', '.kotlin', '.idea', '.tauri', '.cxx', '.externalNativeBuild'} for part in parts)
        assert parts[0] not in {'.git', 'dist', 'works', 'workspaces', 'assets'}, relative
        assert not any(relative == prefix or relative.startswith(prefix + '/') for prefix in [
            'desktop/resources', 'desktop/.cache', 'desktop/ui/i18n', 'src-tauri/binaries',
            'src-tauri/gen/schemas', 'mobile/dist', 'web/data'])
        assert relative not in {'engine/studio-core.wasm', 'engine/studio-core.build.json'}
        assert not relative.endswith(('.pyc', '.jks', '.keystore', '.p12'))
        if parts[0] == 'examples' and '.viento' in parts:
            assert parts[parts.index('.viento') + 1:] == ('workspace.json',)
        data = archive.extractfile(expected_root + '/' + relative).read()
        assert len(data) == expected['size'], relative
        assert hashlib.sha256(data).hexdigest() == expected['sha256'], relative
        assert data == (root_path / relative).read_bytes(), 'Source changed: ' + relative
        total_bytes += len(data)
    required = [
        'VERSION', 'package.json', 'package-lock.json', 'src-tauri/tauri.conf.json',
        'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
        'crates/viento-studio-core/Cargo.toml', 'crates/viento-studio-core/Cargo.lock',
        'crates/viento-bevy-runtime/Cargo.toml', 'crates/viento-bevy-runtime/Cargo.lock',
        'examples/scene2d/workspace.json', 'examples/scene-composition/recipe.json',
        'examples/scene-behaviors/workspace.json', 'examples/bevy-headless/workspace.json',
        'engine/execution-tool-status.mjs', 'engine/runtime-case-document.mjs',
        'engine/runtime-case-suite-contract.mjs', 'engine/runtime-case-suite.mjs',
        'engine/runtime-verification-case.mjs', 'engine/runtime-case-report.mjs',
        'scripts/adapters/node-execution-tool-probe.mjs', 'scripts/adapters/node-runtime-case-suite.mjs',
        'scripts/lib/runtime-author-documents.mjs', 'scripts/lib/runtime-case-documents.mjs',
        'scripts/lib/runtime-case-suites.mjs', 'scripts/lib/runtime-case-reports.mjs',
        'web/modules/app-runtime-case-documents.js', 'web/modules/app-runtime-case-suites.js',
        'web/modules/app-runtime-case-report.js', 'docs/RUNTIME_CASES.md',
        'docs/RUNTIME_CASE_SUITES.md', 'docs/RUNTIME_CASE_REPORTS.md', 'docs/RELEASE_0.0.9.md']
    assert all(relative in manifest for relative in required)
    frozen_excluded = []
    frozen_checked = 0
    for relative, expected in source_hashes.items():
        if relative == 'engine/studio-core.build.json':
            assert relative not in manifest
            frozen_excluded.append(relative)
        else:
            assert manifest[relative]['sha256'] == expected, relative
            frozen_checked += 1
    cases_tests = sorted(relative for relative in manifest if relative.startswith('scripts/tests/')
        and re.search(r'(execution-tool|runtime-case|runtime-verification-case)', relative))
    expected_case_tests = sorted(relative for relative in source_hashes if relative.startswith('scripts/tests/')
        and re.search(r'(execution-tool|runtime-case|runtime-verification-case)', relative))
    assert cases_tests == expected_case_tests and len(cases_tests) > 0
    assert (root_path / 'VERSION').read_text().strip() == '0.0.9'
    assert json.loads(archive.extractfile(expected_root + '/package.json').read())['version'] == '0.0.9'
    assert json.loads(archive.extractfile(expected_root + '/package-lock.json').read())['version'] == '0.0.9'
    print(json.dumps({
        'version': '0.0.9', 'topLevelDirectory': expected_root,
        'files': len(manifest), 'archiveMembers': len(members), 'uncompressedSourceBytes': total_bytes,
        'sourceManifestSha256': hashlib.sha256(manifest_bytes).hexdigest(),
        'requiredFileHashes': {relative: manifest[relative] for relative in required},
        'runtimeCaseAndToolTestFiles': cases_tests,
        'frozenSourceEntriesChecked': frozen_checked, 'frozenGeneratedSourcesExcluded': frozen_excluded,
        'allManifestEntriesVerifiedAgainstArchiveAndCurrentSource': True,
        'bothRustCratesAndLocksIncluded': True, 'allFourOfficialExamplesIncluded': True,
        'noDependenciesGeneratedRuntimeOrUserData': True,
        'symbolicLinksAndDuplicatePathsAbsent': True}, ensure_ascii=False))
`;
    const audited = spawnSync('python3', ['-', archive, root, sourceManifest], {
      cwd: root, input: auditSource, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 120000,
    });
    assert.equal(audited.error, undefined, audited.error?.message);
    assert.equal(audited.status, 0, audited.stderr || audited.stdout);
    const details = JSON.parse(audited.stdout.trim());
    assert.equal(details.files, publication.files);
    assert.equal((await fs.stat(archive)).size, publication.bytes);
    assert.equal(await fileHash(packager), packagerSha256);
    assert.equal(await fileHash(fileURLToPath(import.meta.url)), proofSourceSha256);
    assert.equal(await fileHash(sourceManifest), sourceManifestSha256);
    result = { ok: true, recordedAt: new Date().toISOString(),
      scope: 'Actual normal source packager output, verified against every archive byte and source file at acceptance time. This temporary pre-commit source snapshot excludes generated resources, tools and user works; it does not claim the final Git commit or final audit metadata is contained, and is not an installer or archive migration test.',
      packager: { path: 'desktop/package-source.py', sha256: packagerSha256 },
      proofSourceSha256, frozenSourceManifestSha256: sourceManifestSha256,
      archive: { bytes: publication.bytes, sha256: await fileHash(archive), ...details },
      sourceOnlySnapshotBeforeFinalAuditAndCommit: true,
      installedTauriOrAndroidAcceptanceClaimed: false,
      archiveMigrationExportOrRestoreClaimed: false };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    if (!distExisted) {
      try { await fs.rmdir(dist); } catch (error) { if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT') throw error; }
    }
  }
  assert.ok(result);
  await assert.rejects(fs.stat(temporaryDirectory), { code: 'ENOENT' });
  result.temporarySourceArchiveAndOwnDirectoryRemoved = true;
  await fs.writeFile(path.join(evidence, 'source-archive.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, phase: 'source-archive', files: result.archive.files,
    bytes: result.archive.bytes, sha256: result.archive.sha256,
    frozenSources: result.archive.frozenSourceEntriesChecked, tests: result.archive.runtimeCaseAndToolTestFiles.length,
    temporarySourceArchiveAndOwnDirectoryRemoved: true }));
}
