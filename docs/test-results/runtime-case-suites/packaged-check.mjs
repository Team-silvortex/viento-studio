// Run after final preparation with the pinned embedded Node and existing host tools.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
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
  scope: 'Persist two cases and an ordered suite, preserve UUID and exact BOM/CRLF source bytes through native full archive restore, then final prepared desktop resources execute the same Godot/Bevy cases via service and CLI UUID/path batches; assertion failure continues into the next member and admitted batches finish with source offline. Prepared mobile resources only preflight suite data, source-derived dependency IDs and summaries in an isolated pure VM; no Android host/device execution or UI acceptance.',
  embeddedNode: { version: process.version, sha256: await fileHash(process.execPath) },
  proofSourceSha256: await fileHash(fileURLToPath(import.meta.url)),
  artifacts: {}, unchangedBackendSources: {}, externalTools: [], desktopChecks: [], mobileChecks: {} };

const shared = [...(await fs.readdir(path.join(root, 'engine'))).filter(file => file.endsWith('.mjs')).map(file => `engine/${file}`),
  'engine/studio-core.wasm', 'engine/studio-core.build.json', 'web/project-build.css', 'favicon.ico',
  ...['app-runtime.js', 'app-project-build.js', 'app-scene-preview.js', 'app-scene-composition-overrides.js','app-runtime-case-documents.js','app-runtime-case-suites.js','app-doc-service.js'].map(file => `web/modules/${file}`),
  ...['messages.js', 'en.js', 'ja.js'].map(file => `web/i18n/${file}`)];
const host = ['scripts/adapters/node-execution-backends.mjs', 'scripts/adapters/node-execution-tool.mjs',
  'scripts/adapters/node-execution-tool-probe.mjs', 'scripts/adapters/node-project-build.mjs',
  'scripts/adapters/node-build-snapshot.mjs', 'scripts/adapters/node-world-projection.mjs', 'scripts/adapters/node-studio-core.mjs',
  'scripts/adapters/node-runtime-case-suite.mjs','scripts/lib/project-build-service.mjs','scripts/lib/runtime-author-documents.mjs','scripts/lib/runtime-case-documents.mjs','scripts/lib/runtime-case-suites.mjs','scripts/adapters/node-document-storage.mjs','scripts/lib/doc-file-store.mjs','scripts/lib/project-documents.mjs','scripts/lib/resource-package-catalog.mjs','scripts/lib/resource-package-reader.mjs','scripts/lib/resource-package-import.mjs', 'scripts/lib/build-process.mjs', 'scripts/lib/doc-api-service.mjs', 'scripts/project-build.mjs',
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

const { validateRuntimeCase, evaluateRuntimeCase } = await imported('engine/runtime-verification-case.mjs');
const { summarizeRuntimeCaseSuite } = await imported('engine/runtime-case-suite.mjs');
const { readWorldSnapshot } = await imported('scripts/adapters/node-world-projection.mjs');
const archiveTool = process.env.VIENTO_TEST_ARCHIVE_BINARY;
assert.ok(typeof archiveTool === 'string' && path.isAbsolute(archiveTool), 'Provide the fresh native full-archive helper');
const nativeProof = JSON.parse(await fs.readFile(path.join(evidence, 'native-helpers-proof.json')));
const archiveProof = nativeProof.binaries.find(binary => binary.path === archiveTool);
assert.ok(nativeProof.ok && nativeProof.freshBuild && nativeProof.offlineLocked && archiveProof);
assert.equal(await fileHash(archiveTool), archiveProof.sha256);
assert.equal((await fs.stat(archiveTool)).size, archiveProof.size);
report.nativeArchive = { sha256: archiveProof.sha256, bytes: archiveProof.size, freshOfflineLockedHelper: true };

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-case-suites-packaged-'));
const originalXdgCacheHome = process.env.XDG_CACHE_HOME;
const services = [], inputs = [];
const casePaths = ['documents/runtime-cases/first.json', 'documents/runtime-cases/second.json'];
const suitePath = 'documents/runtime-suites/prepared.json';
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
const wrapper = definition => ({ format: 'viento-runtime-case-document', schemaVersion: 1, sceneObjectId: sceneId, case: definition });
const authorText = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
const authorData = files => Object.fromEntries(Object.entries(files).filter(([file]) =>
  /^(?:documents|templates|metadata|assets)\//.test(file) || ['workspace.json', '.viento/workspace.json'].includes(file)));
async function settle(service, expected) {
  for (let index = 0; index < 3000; index++) {
    const state = await service.status();
    assert.equal(state.job?.id, expected.id, 'Observe the newly submitted task');
    assert.equal(state.job?.kind, expected.kind, 'Observe the expected task kind');
    if (state.job.status !== 'running') return state;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Prepared service did not settle');
}
async function runJob(service, payload) {
  const previous = (await service.status()).job?.id, started = await service.command(payload);
  assert.ok(started.job?.id && started.job.id !== previous, 'Each operation registers a new task');
  const kind = payload.action === 'suite-run' ? 'suite' : payload.action;
  assert.equal(started.job.kind, kind);
  return settle(service, { id: started.job.id, kind });
}
async function session(directory, entry) {
  assert.match(entry.sessionId, /^[a-f0-9-]{36}$/);
  const file = path.join(directory, 'sessions', entry.sessionId, 'session.json');
  const value = JSON.parse(await fs.readFile(file));
  assert.equal(value.status, 'succeeded');
  assert.equal(value.verification.evaluation.status, entry.state);
  assert.equal(value.verification.evaluation.complete, true);
  await assert.rejects(fs.stat(path.join(directory, 'sessions', entry.sessionId, 'project')), { code: 'ENOENT' });
  return { id: entry.sessionId, sha256: await fileHash(file), record: value };
}
async function receipts(base) {
  const files = Object.keys(await inventory(base)).filter(file => /(?:^|\/)suites\/[^/]+\/suite\.json$/.test(file));
  return Promise.all(files.map(async file => ({ id: path.basename(path.dirname(file)), sha256: await fileHash(path.join(base, file)),
    record: JSON.parse(await fs.readFile(path.join(base, file))) })));
}

try {
  for (const [backendId, tool] of configured) {
    console.log(JSON.stringify({ phase: 'prepared-suite-engine', backendId }));
    const name = backendId.split('.').at(-1), work = path.join(temporary, name), authorCache = path.join(temporary, name + '-author-cache');
    await fs.cp(path.join(root, 'examples/bevy-headless'), work, { recursive: true });
    const before = await inventory(work), author = createProjectBuildService(work, { backendId, tool, cacheRoot: authorCache }); services.push(author);
    const members = [];
    for (const [index, definition] of definitions.entries()) {
      const catalog = await author.command({ action: 'case-list', sceneId });
      const content = authorText(wrapper(definition));
      const saved = await author.command({ action: 'case-save', sceneId, sceneVersion: catalog.sceneVersion,
        sourcePath: casePaths[index], documentType: catalog.defaults.documentType, content });
      const loaded = await author.command({ action: 'case-load', documentId: saved.id });
      assert.equal(loaded.content, content); assert.deepEqual(loaded.definition, definition); assert.equal(loaded.valid, true);
      members.push(loaded);
    }
    const suiteDefinition = { format: 'viento-runtime-case-suite', schemaVersion: 1, sceneObjectId: sceneId, documentIds: members.map(item => item.id) };
    const suiteText = authorText(suiteDefinition), catalog = await author.command({ action: 'suite-list', sceneId });
    const group = await author.command({ action: 'suite-save', sceneId, sceneVersion: catalog.sceneVersion,
      sourcePath: suitePath, documentType: catalog.defaults.documentType, content: suiteText });
    const loadedGroup = await author.command({ action: 'suite-load', documentId: group.id });
    assert.equal(loadedGroup.content, suiteText); assert.deepEqual(loadedGroup.definition, suiteDefinition); assert.equal(loadedGroup.valid, true);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(work, `metadata/documents/${group.id}.json`))).relations, []);
    const savedBefore = await inventory(work);
    for (const [file, value] of Object.entries(before)) assert.deepEqual(savedBefore[file], value, 'Saving does not modify existing author files');
    const addedAuthorFiles = Object.keys(savedBefore).filter(file => !Object.hasOwn(before, file)).sort();
    assert.deepEqual(addedAuthorFiles, [...casePaths, suitePath, ...[group, ...members].map(item => `metadata/documents/${item.id}.json`)].sort());
    const archive = path.join(temporary, name + '.viento.zip'), parent = path.join(temporary, name + '-restored'); await fs.mkdir(parent);
    const exported = JSON.parse((await execute(archiveTool, ['export', work, archive], { timeout: 30000, maxBuffer: 1048576 })).stdout);
    const restored = JSON.parse((await execute(archiveTool, ['import', archive, parent], { timeout: 30000, maxBuffer: 1048576 })).stdout).root;
    const expectedAuthorData = authorData(savedBefore);
    assert.equal(exported.files, Object.keys(expectedAuthorData).length);
    assert.deepEqual(authorData(await inventory(restored)), expectedAuthorData);
    assert.equal(JSON.parse(await fs.readFile(path.join(restored, 'workspace.json'))).id, JSON.parse(await fs.readFile(path.join(work, 'workspace.json'))).id);
    await author.close();
    const cacheRoot = path.join(temporary, name + '-restored-cache'), service = createProjectBuildService(restored, { backendId, tool, cacheRoot }); services.push(service);
    for (const member of members) {
      const loaded = await service.command({ action: 'case-load', documentId: member.id });
      assert.equal(loaded.id, member.id); assert.equal(loaded.version, member.version); assert.equal(loaded.content, member.content); assert.equal(loaded.valid, true);
    }
    const migratedGroup = await service.command({ action: 'suite-load', documentId: group.id });
    assert.equal(migratedGroup.id, group.id); assert.equal(migratedGroup.version, group.version); assert.equal(migratedGroup.content, suiteText);
    const probe = await runProjectBuildCommand(['--command', 'tool-check', '--backend', backendId, '--tool', tool]); assert.equal(probe.ok, true);
    report.externalTools.push({ backendId, identity: probe.toolStatus.identity, bytes: (await fs.stat(tool)).size });
    const planned = await runJob(service, { action: 'plan', sceneId }); assert.equal(planned.job.status, 'succeeded');
    const built = await runJob(service, { action: 'build', sceneId, expectedSnapshotId: planned.job.plan.snapshotId }); assert.equal(built.job.status, 'succeeded');
    const buildPaths = Object.keys(await inventory(cacheRoot)).filter(file => file.endsWith('/build.json')); assert.equal(buildPaths.length, 1);
    const directory = path.dirname(path.join(cacheRoot, buildPaths[0])), frozen = await inventory(path.join(directory, 'project'));
    const plan = JSON.parse(await fs.readFile(path.join(directory, 'snapshot.json'))).plan;
    const admittedSource = plain((await readWorldSnapshot(restored)).source);
    const unchangedBefore = await inventory(restored);
    const request = { action: 'suite-run', buildId: built.latestBuild.id, suiteDocumentId: group.id, expectedVersion: group.version };
    const pass = await runJob(service, request);
    assert.equal(pass.job.status, 'succeeded'); assert.equal(pass.job.suite.summary.status, 'passed');
    assert.deepEqual(pass.job.suite.entries.map(item => item.state), ['passed', 'passed']);
    assert.deepEqual(pass.job.suite.entries.map(item => item.documentId), suiteDefinition.documentIds);
    const passSessions = await Promise.all(pass.job.suite.entries.map(entry => session(directory, entry)));
    const cliCache = path.join(temporary, name + '-cli-cache'); process.env.XDG_CACHE_HOME = cliCache;
    const cliResults = [];
    for (const documentRef of [group.id, suitePath]) {
      const result = await runProjectBuildCommand(['--command', 'run', '--root', restored, '--build', directory,
        '--backend', backendId, '--tool', tool, '--runtime-suite', documentRef]);
      assert.equal(result.ok, true); assert.equal(result.status, 'succeeded'); assert.equal(result.record.suite.summary.status, 'passed');
      assert.deepEqual(result.record.suite.entries.map(item => item.documentId), suiteDefinition.documentIds);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.receiptDirectory, 'suite.json'))), result.record);
      cliResults.push({ referenceKind: documentRef === group.id ? 'UUID' : 'project-relative-path', record: result.record });
    }
    assert.deepEqual(await inventory(restored), unchangedBefore, 'Batches and CLI do not write author files');
    const wrong = plain(definitions[0]); wrong.checks[0].position.value[0] += 1;
    const caseCatalog = await service.command({ action: 'case-list', sceneId });
    const updated = await service.command({ action: 'case-save', sceneId, sceneVersion: caseCatalog.sceneVersion,
      documentId: members[0].id, expectedVersion: members[0].version, content: authorText(wrapper(wrong)) });
    assert.notEqual(updated.version, members[0].version);
    assert.equal((await service.command({ action: 'suite-load', documentId: group.id })).version, group.version, 'Member edits never rewrite suite bytes');
    const offlineBefore = await inventory(restored);
    assert.deepEqual(Object.keys(offlineBefore), Object.keys(unchangedBefore));
    assert.deepEqual(Object.keys(offlineBefore).filter(file => offlineBefore[file].sha256 !== unchangedBefore[file].sha256), [casePaths[0]]);
    const started = await service.command(request);
    assert.equal(started.job.kind, 'suite'); assert.notEqual(started.job.id, pass.job.id);
    await fs.rename(restored, restored + '-offline');
    const failed = await settle(service, { id: started.job.id, kind: 'suite' });
    assert.equal(failed.job.status, 'succeeded'); assert.equal(failed.job.suite.summary.status, 'failed');
    assert.deepEqual(failed.job.suite.entries.map(item => item.state), ['failed', 'passed']);
    assert.equal(failed.job.suite.entries[0].sourceVersion, updated.version);
    assert.equal(failed.job.suite.entries[1].sourceVersion, members[1].version);
    const failSessions = await Promise.all(failed.job.suite.entries.map(entry => session(directory, entry)));
    assert.deepEqual(passSessions[0].record.control.program, failSessions[0].record.control.program);
    assert.equal(passSessions[0].record.control.sha256, failSessions[0].record.control.sha256);
    assert.equal(failSessions[0].record.verification.evaluation.failedChecks, 1);
    assert.deepEqual(failSessions[1].record.verification.definition, definitions[1]);
    const lastJob = failed.job.id;
    await assert.rejects(service.command(request)); assert.equal((await service.status()).job.id, lastJob, 'New suites cannot reopen offline author data');
    const offline = await runJob(service, { action: 'run', buildId: built.latestBuild.id, mode: 'headless', runtimeCase: definitions[0], runtimeCaseSceneId: sceneId });
    assert.equal(offline.job.status, 'succeeded'); assert.equal(offline.job.verification.evaluation.status, 'passed');
    const sessionIds = await fs.readdir(path.join(directory, 'sessions')); assert.equal(sessionIds.length, 9); assert.equal(new Set(sessionIds).size, 9);
    const batchReceipts = [...await receipts(cacheRoot), ...await receipts(cliCache)]; assert.equal(batchReceipts.length, 4);
    assert.equal(new Set(batchReceipts.map(item => item.id)).size, 4);
    const suiteSessionIds = batchReceipts.flatMap(item => item.record.suite.entries.map(entry => entry.sessionId));
    assert.equal(suiteSessionIds.length, 8); assert.equal(new Set(suiteSessionIds).size, 8);
    assert.ok(suiteSessionIds.every(id => sessionIds.includes(id)));
    for (const receipt of batchReceipts) {
      assert.equal(receipt.record.buildId, built.latestBuild.id); assert.equal(receipt.record.snapshotId, built.latestBuild.snapshotId);
      assert.equal(receipt.record.status, 'succeeded'); assert.equal(receipt.record.suite.summary.complete, true);
    }
    assert.deepEqual(batchReceipts.map(item => item.record.suite.summary.status).sort(), ['failed', 'passed', 'passed', 'passed']);
    assert.deepEqual(await inventory(restored + '-offline'), offlineBefore); assert.deepEqual(await inventory(work), savedBefore);
    assert.deepEqual(await inventory(path.join(directory, 'project')), frozen);
    inputs.push({ plan, suiteDefinition, suiteText, members: members.map((item, index) => ({ documentId: item.id, document: wrapper(definitions[index]) })),
      source: admittedSource, samples: passSessions.map(item => item.record.control.samples),
      evaluations: passSessions.map(item => item.record.verification.evaluation), wrong, failedEvaluation: failSessions[0].record.verification.evaluation });
    report.desktopChecks.push({ backendId, buildId: built.latestBuild.id, snapshotId: built.latestBuild.snapshotId,
      savedCaseIds: members.map(item => item.id), savedSuiteId: group.id, savedSuiteVersion: group.version,
      observedJobs: [planned, built, pass, failed, offline].map(state => ({ id: state.job.id, kind: state.job.kind, status: state.job.status })),
      servicePassedSuite: pass.job.suite, serviceFailedSuite: failed.job.suite, cliResults, batchReceipts,
      sessions: sessionIds, passedSessionChecks: passSessions.map(item => ({ id: item.id, sha256: item.sha256, evaluation: item.record.verification.evaluation })),
      failedSessionChecks: failSessions.map(item => ({ id: item.id, sha256: item.sha256, evaluation: item.record.verification.evaluation })),
      archive: { sha256: await fileHash(archive), authorFileCount: Object.keys(expectedAuthorData).length, authorManifestSha256: hash(JSON.stringify(expectedAuthorData)), rootReadmeOutsideArchive: true },
      addedAuthorFiles, fullArchiveStableIdentityAndBytes: true, omittedInputsRelease: true, controlsNoneRemainsIdle: true,
      assertionFailureContinues: true, admittedBatchCompletedWithSourceOffline: true, newOfflineSuiteAdmissionRejectedWithoutJob: true,
      frozenOfflineIndividualCasePassed: true, frozenGeneratedProjectByteIdentical: true, unchangedAuthorBytesOutsideExplicitFirstCaseEdit: true });
    await service.close();
  }
  assert.deepEqual(inputs[0].samples, inputs[1].samples);
  report.counts = { backends: inputs.length, builds: inputs.length, casesPerSuite: 2,
    batchReceipts: report.desktopChecks.reduce((count, item) => count + item.batchReceipts.length, 0),
    runtimeSessions: report.desktopChecks.reduce((count, item) => count + item.sessions.length, 0),
    passedServiceSuites: 2, failedServiceSuitesWithContinuation: 2, cliUuidSuites: 2, cliPathSuites: 2,
    offlineAdmittedSuites: 2, offlineIndividualCasePasses: 2 };

  const context = vm.createContext({}), modules = new Map();
  function load(relative) {
    assert.equal(relative, path.posix.normalize(relative));
    assert.ok(/^(?:engine\/|vendor\/yaml\/)/.test(relative) && /\.(?:mjs|js)$/.test(relative) && !/[\\\0?#]/.test(relative));
    if (!modules.has(relative)) modules.set(relative, fs.readFile(path.join(mobile, relative), 'utf8')
      .then(source => new vm.SourceTextModule(source, { context, identifier: relative })));
    return modules.get(relative);
  }
  function linker(specifier, referencingModule) {
    assert.ok(typeof specifier === 'string' && !/[\\\0?#]/.test(specifier)
      && (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/engine/') || specifier.startsWith('/vendor/yaml/')),
    'No host, bare, network or escaped imports may enter the mobile VM');
    return load(path.posix.normalize(specifier.startsWith('/') ? specifier.slice(1)
      : path.posix.join(path.posix.dirname(referencingModule.identifier), specifier)));
  }
  const entryModules = ['engine/runtime-case-suite.mjs', 'engine/runtime-case-document.mjs', 'engine/runtime-verification-case.mjs'];
  const entry = new vm.SourceTextModule(entryModules.map(file => `import '/${file}';`).join('\n'), { context, identifier: 'portable-suite-entry' });
  await entry.link(linker); await entry.evaluate();
  const suiteModule = (await load(entryModules[0])).namespace, caseModule = (await load(entryModules[2])).namespace;
  const valueInVm = value => { context.inputJson = JSON.stringify(value); return vm.runInContext('JSON.parse(inputJson)', context); };
  let accepted = 0, rejected = 0;
  for (const input of inputs) {
    assert.deepEqual(plain(suiteModule.validateRuntimeCaseSuite(valueInVm(input.suiteDefinition))), input.suiteDefinition); accepted++;
    const inspected = suiteModule.inspectRuntimeCaseSuite(input.suiteText); assert.equal(inspected.ok, true); assert.deepEqual(plain(inspected.value), input.suiteDefinition); accepted++;
    assert.deepEqual(plain(suiteModule.validateRuntimeCaseSuitePlan(valueInVm(input.plan), valueInVm(input.suiteDefinition), valueInVm(input.members))), input.suiteDefinition); accepted++;
    assert.deepEqual(plain(suiteModule.runtimeCaseSuiteDocumentIds(valueInVm(input.suiteDefinition))), [sceneId, ...input.suiteDefinition.documentIds]); accepted++;
    const record = input.source.documents.find(item => item.record?.id === input.suiteDefinition.documentIds[0]);
    const suiteRecord = input.source.documents.find(item => item.record?.id && item.content === input.suiteText).record;
    assert.ok(record);
    assert.deepEqual(plain(suiteModule.validateRuntimeCaseSuiteDependencies(valueInVm(input.suiteDefinition), valueInVm(suiteRecord), valueInVm(input.source))), []); accepted++;
    const unavailable = plain(input.source); unavailable.documents.find(item => item.record?.id === input.suiteDefinition.documentIds[0]).content = null;
    const diagnostics = plain(suiteModule.validateRuntimeCaseSuiteDependencies(valueInVm(input.suiteDefinition), valueInVm(suiteRecord), valueInVm(unavailable)));
    assert.ok(diagnostics.some(item => item.code === 'runtime_suite_dependency_unavailable' && item.relatedObjectId === input.suiteDefinition.documentIds[0])); accepted++;
    const unknown = plain(input.suiteDefinition); unknown.documentIds[0] = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    assert.ok(suiteModule.validateRuntimeCaseSuiteDependencies(valueInVm(unknown), valueInVm(suiteRecord), valueInVm(input.source)).length); rejected++;
    const badPlan = plain(input.plan); badPlan.scene.objectId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    assert.throws(() => suiteModule.validateRuntimeCaseSuitePlan(valueInVm(badPlan), valueInVm(input.suiteDefinition), valueInVm(input.members))); rejected++;
    for (const [index, member] of input.members.entries()) {
      assert.deepEqual(plain(caseModule.evaluateRuntimeCase(valueInVm(input.plan), valueInVm(member.document.case), valueInVm(input.samples[index]), valueInVm({ complete: true }))), input.evaluations[index]); accepted++;
    }
    assert.deepEqual(plain(caseModule.evaluateRuntimeCase(valueInVm(input.plan), valueInVm(input.wrong), valueInVm(input.samples[0]), valueInVm({ complete: true }))), input.failedEvaluation); accepted++;
  }
  for (const states of [['passed', 'passed'], ['failed', 'passed'], ['incomplete', 'not-run'], ['running', 'queued']]) {
    assert.deepEqual(plain(suiteModule.summarizeRuntimeCaseSuite(valueInVm(states))), plain(summarizeRuntimeCaseSuite(states))); accepted++;
  }
  for (const bad of [{ ...plain(inputs[0].suiteDefinition), tool: '/private' }, { ...plain(inputs[0].suiteDefinition), documentIds: [] },
    { ...plain(inputs[0].suiteDefinition), documentIds: [inputs[0].suiteDefinition.documentIds[0], inputs[0].suiteDefinition.documentIds[0]] },
    { ...plain(inputs[0].suiteDefinition), documentIds: [sceneId] }]) {
    assert.throws(() => suiteModule.validateRuntimeCaseSuite(valueInVm(bad))); rejected++;
  }
  assert.equal(vm.runInContext('[typeof process,typeof require,typeof document,typeof fetch,typeof Buffer].join(",")', context), 'undefined,undefined,undefined,undefined,undefined');
  report.mobileChecks = { entryModuleCount: entryModules.length, entryModules, moduleCount: modules.size, modules: [...modules.keys()].sort(),
    acceptedCases: accepted, rejectedCases: rejected, noNodeDomOrNetworkGlobals: true, desktopSamplesOnly: true,
    sourceDerivedDependencyIdsValidated: true, androidHostOrDeviceExecutionClaimed: false, androidUiAcceptanceClaimed: false };
  report.ok = true;
} finally {
  if (originalXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = originalXdgCacheHome;
  await Promise.allSettled(services.map(service => service.close())); await fs.rm(temporary, { recursive: true, force: true });
}
for (const artifact of Object.values(report.artifacts)) for (const [file, expected] of Object.entries(artifact.hashes)) {
  assert.equal(await fileHash(path.join(root, file)), expected.sourceSha256, `Source changed during prepared acceptance: ${file}`);
}
assert.equal(await fileHash(fileURLToPath(import.meta.url)), report.proofSourceSha256, 'Proof source changed during acceptance');
assert.equal(await fileHash(archiveTool), report.nativeArchive.sha256, 'Native archive helper changed during acceptance');
report.sourceHashesStayedStable = true; report.temporaryFixtureAndCacheRemoved = true;
await fs.writeFile(path.join(evidence, 'packaged-resources.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ok: report.ok, artifacts: Object.fromEntries(Object.entries(report.artifacts).map(([key, value]) => [key,
  { manifestFileCount: value.manifestFileCount, checkedSourceFiles: value.checkedSourceFiles }])), counts: report.counts, mobile: report.mobileChecks }));
