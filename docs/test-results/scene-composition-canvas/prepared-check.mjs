// Read-only proof of final prepared resources; run with the pinned embedded Node.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const desktop = path.join(root, 'desktop/resources'), mobile = path.join(root, 'mobile/dist');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const revision = content => `sha256:${sha(content)}`;
const rewrite = source => source.replaceAll("from 'yaml'", "from '/vendor/yaml/index.js'")
  .replaceAll("from '../node_modules/yaml/browser/index.js'", "from '/vendor/yaml/index.js'");
const fileSha = async file => sha(await fs.readFile(file));
const importPrepared = file => import(pathToFileURL(path.join(desktop, file)));
assert.equal(process.version, 'v24.20.0', 'Execute this proof with the pinned embedded Node');
assert.equal(await fileSha(process.execPath), '89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7');
const report = { ok: false, recordedAt: new Date().toISOString(),
  scope: 'Read-only acceptance of prepared desktop helper/canvas copies under the pinned shared Node, and the prepared mobile pure helper with the unchanged Rust WASM in an isolated VM. Host injects only module bytes and a deterministic SHA function. This does not accept an installed Tauri application, Android device, author persistence, engine execution, or new standalone Rust tests.',
  embeddedNode: { version: process.version, sha256: await fileSha(process.execPath) },
  proofSourceSha256: await fileSha(fileURLToPath(import.meta.url)), artifacts: {}, desktopChecks: [], mobileChecks: {} };
report.version = (await fs.readFile(path.join(root, 'VERSION'), 'utf8')).trim();
assert.match(report.version, /^\d+\.\d+\.\d+$/);
report.initialRecordingCorrection = { log: 'prepared-check-initial.log', kind: 'proof-old-version-assumption',
  explanation: 'The first proof invocation stopped before manifest or behavior checks because its inherited guard expected 0.0.8; the frozen current source version is read directly instead. No product failure or product change is claimed.' };
report.fixtureCorrection = { log: 'prepared-check-fixture-initial.log', kind: 'proof-missing-provenance-definition',
  explanation: 'The source map stores placement identity rather than a definition UUID. The constructed proof preview initially omitted the provenance objectId and was correctly rejected; the proof now obtains it from the corresponding expanded actor. Product sources are unchanged.' };
const sourceHashes = JSON.parse(await fs.readFile(path.join(evidence, 'source-hashes.json'), 'utf8'));
assert.ok(Object.hasOwn(sourceHashes, 'engine/scene-composition-layout.mjs'));
async function verifySources() {
  for (const [file, expected] of Object.entries(sourceHashes)) assert.equal(await fileSha(path.join(root, file)), expected, `Frozen source changed: ${file}`);
}
await verifySources();
report.frozenSourceManifest = { files: Object.keys(sourceHashes).length, sha256: await fileSha(path.join(evidence, 'source-hashes.json')), hashes: sourceHashes };

async function inventory(directory) {
  const files = {};
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    assert.ok(entry.isFile(), 'Prepared resources must contain only regular files');
    const file = path.join(entry.parentPath, entry.name), bytes = await fs.readFile(file);
    const signature = bytes.length >= 4 ? bytes.readUInt32BE(0) : null;
    const nativeExecutable = [0x7f454c46, 0xcafebabe, 0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe].includes(signature)
      || bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
    files[path.relative(directory, file)] = { bytes: bytes.length, sha256: sha(bytes), ...(nativeExecutable ? { nativeExecutable: true } : {}) };
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en')));
}
const shared = [...(await fs.readdir(path.join(root, 'engine'))).filter(file => file.endsWith('.mjs')).map(file => `engine/${file}`),
  'engine/studio-core.wasm', 'engine/studio-core.build.json', 'web/project-build.css', 'favicon.ico',
  ...['app-runtime.js', 'app-project-build.js', 'app-scene-preview.js', 'app-scene-preview-canvas.js',
    'app-scene-composition-overrides.js', 'app-scene-composition-layout.js', 'app-scene-layout.js', 'app-doc-service.js', 'app-studio-core.js'].map(file => `web/modules/${file}`),
  ...['messages.js', 'en.js', 'ja.js'].map(file => `web/i18n/${file}`)];
const host = ['scripts/adapters/node-studio-core.mjs', 'scripts/adapters/node-build-snapshot.mjs', 'scripts/lib/scene-preview-service.mjs',
  'scripts/lib/doc-api-service.mjs', 'scripts/lib/project-build-service.mjs', 'scripts/lib/resource-package-reader.mjs',
  ...(await fs.readdir(path.join(root, 'scripts/backends'), { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile()).map(entry => path.relative(root, path.join(entry.parentPath, entry.name))),
  ...(await fs.readdir(path.join(root, 'schemas'))).filter(file => file.endsWith('.json')).map(file => `schemas/${file}`)];
const runtimeConfiguration = JSON.parse(await fs.readFile(path.join(root, 'desktop/node-runtime.json'), 'utf8'));
for (const [name, extra] of [['desktop/resources', host], ['mobile/dist', ['mobile/platform.mjs']]]) {
  const base = path.join(root, name), files = await inventory(base), focus = {}, allCopies = {};
  for (const file of [...shared, ...extra]) {
    const source = await fs.readFile(path.join(root, file)), bytes = await fs.readFile(path.join(base, file));
    const expected = name === 'mobile/dist' && file.startsWith('engine/') && file.endsWith('.mjs') ? Buffer.from(rewrite(source.toString('utf8'))) : source;
    assert.equal(sha(bytes), sha(expected), `Focused prepared copy differs: ${name}/${file}`);
    focus[file] = { sourceSha256: sha(source), packagedSha256: sha(bytes), importRewrite: !source.equals(bytes) };
  }
  for (const [file, actual] of Object.entries(files)) {
    let origin = file, transformation = null, expected;
    if (name === 'desktop/resources' && file === 'package.json') {
      origin = 'VERSION'; transformation = 'generated package metadata';
      expected = Buffer.from(JSON.stringify({ private: true, type: 'module', version: report.version, displayVersion: report.version }));
    } else if (name === 'desktop/resources' && file === 'NODE-LICENSE') {
      origin = `desktop/.cache/${runtimeConfiguration.version}-LICENSE`;
      expected = await fs.readFile(path.join(root, origin)); assert.equal(sha(expected), runtimeConfiguration.licenseSha256);
    } else if (name === 'mobile/dist' && file.startsWith('vendor/yaml/')) {
      origin = file === 'vendor/yaml/LICENSE' ? 'node_modules/yaml/LICENSE' : file.replace('vendor/yaml/', 'node_modules/yaml/browser/');
      expected = await fs.readFile(path.join(root, origin));
    } else if (name === 'mobile/dist' && file === 'index.html') {
      origin = 'mobile/index.html'; transformation = 'release version substitution';
      expected = Buffer.from((await fs.readFile(path.join(root, origin), 'utf8')).replaceAll('__VIENTO_VERSION__', report.version));
    } else if (name === 'mobile/dist' && file === 'editor.html') {
      origin = 'web/index.html'; transformation = 'mobile shell entry';
      expected = Buffer.from((await fs.readFile(path.join(root, origin), 'utf8')).replace(/<title>.*?<\/title>/, '<title>Viento Studio</title>')
        .replace('</head>', '<link rel="stylesheet" href="/mobile/mobile.css" /></head>').replace('<body>', '<body class="mobile-host">')
        .replace('<script type="module" src="/web/app.js"></script>', '<script type="module" src="/mobile/editor.js"></script>')
        .replace('<script type="module" src="/web/modules/desktop-bridge.js"></script>', ''));
    } else {
      const source = await fs.readFile(path.join(root, origin));
      expected = name === 'mobile/dist' && file.startsWith('engine/') && file.endsWith('.mjs') ? Buffer.from(rewrite(source.toString('utf8'))) : source;
      if (!source.equals(expected)) transformation = 'local YAML import rewrite';
    }
    assert.equal(actual.sha256, sha(expected), `Full prepared inventory differs: ${name}/${file}`);
    allCopies[file] = { source: origin, sourceSha256: await fileSha(path.join(root, origin)), expectedSha256: sha(expected), transformation };
  }
  assert.ok(!Object.keys(files).some(file => /^(?:examples|works|workspaces|crates)\//.test(file) || file.startsWith('web/data/') || file.startsWith('scripts/tests/')));
  assert.ok(!Object.values(files).some(file => file.nativeExecutable));
  if (name === 'mobile/dist') assert.ok(!Object.keys(files).some(file => file.startsWith('scripts/adapters/') || file.startsWith('scripts/backends/') || file === 'scripts/lib/project-build-service.mjs'));
  report.artifacts[name] = { manifestFileCount: Object.keys(files).length, manifestBytes: Object.values(files).reduce((sum, file) => sum + file.bytes, 0),
    manifestSha256: sha(JSON.stringify(files)), manifest: files, checkedSourceFiles: Object.keys(focus).length,
    checkedSourceSha256: sha(JSON.stringify(focus)), hashes: focus, fullSourceCopyCount: Object.keys(allCopies).length,
    fullSourceCopySha256: sha(JSON.stringify(allCopies)), fullSourceCopies: allCopies };
}
report.libraryTranslations = {};
for (const file of ['messages.js', 'en.js', 'ja.js']) {
  const original = await fs.readFile(path.join(root, 'web/i18n', file)), prepared = await fs.readFile(path.join(root, 'desktop/ui/i18n', file));
  assert.deepEqual(prepared, original); report.libraryTranslations[file] = sha(prepared);
}
report.unchangedFrozenSources = {};
for (const name of ['frozen-backend-baseline.json', 'rust-source-baseline.json', 'historical-baseline.json']) {
  const expected = JSON.parse(await fs.readFile(path.join(evidence, name), 'utf8'));
  for (const [file, digest] of Object.entries(expected)) assert.equal(await fileSha(path.join(root, file)), digest, `Protected source/history changed: ${file}`);
  report.unchangedFrozenSources[name] = { files: Object.keys(expected).length, baselineSha256: await fileSha(path.join(evidence, name)), allMatch: true };
}

const examplePath = path.join(root, 'examples/scene-composition/recipe.json'), exampleBytes = await fs.readFile(examplePath);
const example = JSON.parse(exampleBytes), sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
await importPrepared('scripts/adapters/node-studio-core.mjs');
const moduleFiles = ['engine/scene-composition-layout.mjs', 'engine/scene-composition-overrides.mjs', 'engine/scene-composition.mjs', 'engine/scene-structure.mjs', 'engine/studio-core.mjs'];
const desktopApi = Object.assign({}, ...await Promise.all(moduleFiles.map(importPrepared)));
const { parseJsonSource, locateJsonSource } = await importPrepared('engine/json-source.mjs');

function fixture(api, value = copy(example), dirty = false) {
  const content = serialize(value), sourceRevision = revision(content), expanded = copy(api.expandSceneComposition(content));
  const source = { sourcePath: 'documents/prepared-recipe.json', baseSourceRevision: dirty ? revision('saved baseline') : sourceRevision, content };
  const model = { ok: true, format: 'viento-scene-preview', schemaVersion: 2,
    scene: { objectId: sceneId, sourcePath: source.sourcePath, sourceRevision, viewport: expanded.scene.viewport, background: expanded.scene.background },
    actors: expanded.scene.actors.map(actor => ({ ...actor, name: actor.instanceId })),
    composition: { format: 'viento-scene-composition-preview', schemaVersion: 1, recipeObjectId: sceneId, sourcePath: source.sourcePath,
      sourceRevision, fragmentCount: value.fragments.length, placementCount: value.placements.length },
    sourceLocations: { actors: expanded.sourceMap.actors.map((actor, index) => ({ instanceId: actor.instanceId, objectId: expanded.scene.actors[index].objectId,
      declaration: { objectId: sceneId, sourcePath: source.sourcePath, sourceRevision },
      composition: { fragmentId: actor.fragmentId, placementId: actor.placementId, localKey: actor.localKey } })) },
    sceneStructure: copy(api.createSceneStructure(expanded.scene)), ...(dirty ? { draft: { baseSourceRevision: source.baseSourceRevision, sourceRevision } } : {}) };
  return { source, model, actorId: model.actors[2].instanceId };
}
const positionInvalid = error => error?.errorCode === 'scene_layout_position_invalid';
const noChange = error => error?.errorCode === 'scene_composition_override_unchanged';
async function runCases(api) {
  const checks = [], digest = sha;
  for (const dirty of [false, true]) {
    const f = fixture(api, copy(example), dirty), initial = copy(f), draft = await api.createSceneCompositionLayoutDraft(f.model, f.source, f.actorId, { digest });
    try {
      draft.setPosition(f.actorId, [510, 250]); const proposal = draft.propose();
      assert.deepEqual(copy(proposal.values), { position: [150, 170] });
      assert.deepEqual(copy(proposal.changedPaths), ['/placements/1/overrides/0/values/position']);
      const before = locateJsonSource(parseJsonSource(f.source.content), proposal.changedPaths[0]);
      const after = locateJsonSource(parseJsonSource(proposal.afterContent), proposal.changedPaths[0]);
      assert.equal(f.source.content.slice(0, before.start), proposal.afterContent.slice(0, after.start));
      assert.equal(f.source.content.slice(before.end), proposal.afterContent.slice(after.end));
      assert.deepEqual(copy(await api.prepareSceneCompositionOverrideApply(f.source, proposal, { digest })), { afterContent: proposal.afterContent, changedPaths: copy(proposal.changedPaths) });
      assert.deepEqual(copy(api.expandSceneComposition(proposal.afterContent).scene.actors[2].position), [510, 250]);
      assert.deepEqual(copy(draft.actors().filter(actor => actor.instanceId !== f.actorId)), initial.model.actors.filter(actor => actor.instanceId !== f.actorId));
      assert.deepEqual(f, initial);
    } finally { draft.dispose(); }
  }
  checks.push({ id: 'exact-saved-and-draft-receipt', ok: true, sourceModes: 2, onlyLocalPositionChanges: true, allOtherBytesAndActorsUnchanged: true });
  {
    const value = copy(example); value.placements[1].offset = [0.2, 0.2]; value.placements[1].overrides[0].values.position = [0.1, 0.1];
    const f = fixture(api, value), draft = await api.createSceneCompositionLayoutDraft(f.model, f.source, f.actorId, { digest });
    try {
      const initial = copy(draft.currentPosition(f.actorId)); assert.notEqual(initial[1] - 0.2, 0.1);
      assert.equal(draft.setPosition(f.actorId, initial), false);
      draft.setPosition(f.actorId, [initial[0] + 1, initial[1]]); assert.equal(draft.propose().values.position[1], 0.1);
      draft.undo(); assert.throws(() => draft.propose(), noChange); draft.redo(); draft.setPosition(f.actorId, initial);
      assert.deepEqual(copy(draft.localPosition()), [0.1, 0.1]); assert.equal(draft.state().dirty, false);
      assert.throws(() => draft.propose(), noChange);
    } finally { draft.dispose(); }
  }
  checks.push({ id: 'fractional-axis-history-noop', ok: true });
  {
    const f = fixture(api), draft = await api.createSceneCompositionLayoutDraft(f.model, f.source, f.actorId, { digest });
    try {
      draft.setPosition(f.actorId, [470, 225]); draft.undo(); const state = copy(draft.state()), actors = copy(draft.actors());
      for (const bad of [[-100000, 220], [100001, 0], [NaN, 0], [Infinity, 0], ['1', 2]]) {
        assert.throws(() => draft.setPosition(f.actorId, bad), positionInvalid); assert.deepEqual(copy(draft.state()), state); assert.deepEqual(copy(draft.actors()), actors);
      }
      draft.redo(); assert.deepEqual(copy(draft.currentPosition(f.actorId)), [470, 225]); draft.reset();
      draft.move([f.actorId], [12, 6], 32); assert.deepEqual(copy(draft.currentPosition(f.actorId)), [480, 224]);
      assert.deepEqual(copy(draft.propose().values), { position: [120, 144] }); draft.undo(); assert.equal(draft.state().dirty, false);
    } finally { draft.dispose(); }
  }
  checks.push({ id: 'world-local-bounds-and-rust-snap', ok: true, rejectedPositions: 5 });
  {
    const f = fixture(api), draft = await api.createSceneCompositionLayoutDraft(f.model, f.source, f.actorId, { digest });
    try {
      for (const id of [f.model.actors[0].instanceId, f.model.actors[2].objectId]) assert.throws(() => draft.setPosition(id, [1, 2]), positionInvalid);
      assert.throws(() => draft.move([f.actorId, f.actorId], [1, 2]), positionInvalid);
      draft.setPosition(f.actorId, [510, 250]); const proposal = draft.propose();
      for (const alter of [p => p.afterContent += ' ', p => p.instanceId = f.model.actors[0].instanceId, p => p.values.position[0]++]) {
        const wrong = copy(proposal); alter(wrong); await assert.rejects(api.prepareSceneCompositionOverrideApply(f.source, wrong, { digest }));
      }
      await assert.rejects(api.prepareSceneCompositionOverrideApply({ ...f.source, content: f.source.content + ' ' }, proposal, { digest }));
      const wrongModel = copy(f.model); wrongModel.actors[2].position[0]++;
      await assert.rejects(api.createSceneCompositionLayoutDraft(wrongModel, f.source, f.actorId, { digest }));
      assert.deepEqual(copy(draft.propose()), copy(proposal));
    } finally { draft.dispose(); }
  }
  checks.push({ id: 'foreign-instance-and-stale-receipts', ok: true, rejectedOperations: 8 });
  {
    const f = fixture(api, copy(example), true), initial = copy(f); let resolve;
    const gate = new Promise(done => { resolve = done; }); let captured;
    const pending = api.createSceneCompositionLayoutDraft(f.model, f.source, f.actorId, { digest: text => { captured = text; return gate; } });
    f.model.actors[2].position[0] = 999; f.source.content = '{}'; f.source.baseSourceRevision = revision('changed');
    resolve(sha(captured)); const draft = await pending;
    try {
      assert.deepEqual(copy(draft.actors()), initial.model.actors); draft.setPosition(initial.actorId, [510, 250]);
      const proposal = draft.propose(); proposal.values.position[0] = 999; const actors = draft.actors(); actors[2].position[0] = 999;
      assert.deepEqual(copy(draft.propose().values), { position: [150, 170] });
      assert.equal(draft.propose().sourceRevision, revision(initial.source.content));
      await api.prepareSceneCompositionOverrideApply(initial.source, draft.propose(), { digest });
    } finally { draft.dispose(); }
    assert.throws(() => draft.propose(), error => error?.errorCode === 'scene_layout_draft_invalid');
    assert.throws(() => draft.setPosition(initial.actorId, [1, 2]), error => error?.errorCode === 'scene_layout_draft_invalid');
  }
  checks.push({ id: 'preawait-detach-and-disposal', ok: true });
  return checks;
}
assert.equal(desktopApi.getStudioCoreMetadata().ready, true);
report.desktopChecks = await runCases(desktopApi);
console.log(JSON.stringify({ phase: 'prepared-desktop-layout', cases: report.desktopChecks.length, ok: true }));

const context = vm.createContext({ TextEncoder, TextDecoder, WebAssembly }), modules = new Map();
function load(relative) {
  assert.equal(relative, path.posix.normalize(relative));
  assert.ok(relative.startsWith('engine/') && relative.endsWith('.mjs') && !/[\\\0?#]/.test(relative), 'Only prepared pure engine modules may enter this VM');
  if (!modules.has(relative)) modules.set(relative, fs.readFile(path.join(mobile, relative), 'utf8')
    .then(source => new vm.SourceTextModule(source, { context, identifier: relative })));
  return modules.get(relative);
}
function linker(specifier, referencing) {
  assert.ok(typeof specifier === 'string' && !/[\\\0?#]/.test(specifier) && (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/engine/')));
  return load(path.posix.normalize(specifier.startsWith('/') ? specifier.slice(1) : path.posix.join(path.posix.dirname(referencing.identifier), specifier)));
}
const entry = new vm.SourceTextModule(moduleFiles.map(file => `export * from '/${file}';`).join('\n'), { context, identifier: 'portable-layout-entry' });
await entry.link(linker); await entry.evaluate();
const mobileWasm = await fs.readFile(path.join(mobile, 'engine/studio-core.wasm'));
await entry.namespace.initializeStudioCore(async () => mobileWasm);
assert.equal(entry.namespace.getStudioCoreMetadata().ready, true);
assert.equal(vm.runInContext('[typeof process, typeof require, typeof Buffer, typeof document, typeof window, typeof fetch].join(",")', context), Array(6).fill('undefined').join(','));
const mobileChecks = await runCases(entry.namespace);
report.mobileChecks = { entryModuleCount: moduleFiles.length, moduleCount: modules.size, modules: [...modules.keys()].sort(),
  wasmSha256: sha(mobileWasm), wasmMetadata: copy(entry.namespace.getStudioCoreMetadata()), checks: mobileChecks,
  acceptedCases: mobileChecks.length, rejectedOperations: mobileChecks.reduce((sum, item) => sum + (item.rejectedOperations || item.rejectedPositions || 0), 0),
  noNodeDomNetworkGlobals: true, noHostImports: true, noDeviceAcceptance: true };
assert.deepEqual(mobileChecks, report.desktopChecks);
assert.equal(sha(mobileWasm), await fileSha(path.join(root, 'engine/studio-core.wasm')));
assert.equal(await fileSha(examplePath), sha(exampleBytes));
await verifySources();
for (const [name, artifact] of Object.entries(report.artifacts)) assert.deepEqual(await inventory(path.join(root, name)), artifact.manifest);
assert.equal(report.proofSourceSha256, await fileSha(fileURLToPath(import.meta.url)));
report.ok = true; report.sourceAndPreparedManifestsStableDuringAcceptance = true;
report.counts = { desktopCases: report.desktopChecks.length, mobileCases: mobileChecks.length, totalCases: report.desktopChecks.length + mobileChecks.length };
await fs.writeFile(path.join(evidence, 'packaged-resources.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, counts: report.counts,
  artifacts: Object.fromEntries(Object.entries(report.artifacts).map(([name, value]) => [name, { manifestFileCount: value.manifestFileCount, checkedSourceFiles: value.checkedSourceFiles, fullSourceCopyCount: value.fullSourceCopyCount }])),
  mobileModuleCount: modules.size, frozenSourceFiles: Object.keys(sourceHashes).length }));
