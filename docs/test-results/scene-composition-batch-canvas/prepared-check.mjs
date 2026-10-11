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
  scope: 'Read-only acceptance of prepared desktop batch helper/canvas copies under the pinned shared Node, and the prepared mobile batch helper with the rebuilt Rust WASM in an isolated VM. Host injects only module bytes and a deterministic SHA function. This does not accept an installed Tauri application, Android device, author persistence, engine execution, or new standalone Rust tests.',
  embeddedNode: { version: process.version, sha256: await fileSha(process.execPath) },
  proofSourceSha256: await fileSha(fileURLToPath(import.meta.url)), artifacts: {}, desktopChecks: [], mobileChecks: {} };
report.version = (await fs.readFile(path.join(root, 'VERSION'), 'utf8')).trim();
assert.match(report.version, /^\d+\.\d+\.\d+$/);
report.initialProofCorrection = { log: 'prepared-check-initial.log', kind: 'proof-local-import-allowlist',
  explanation: 'Desktop completed all eight groups. The initial isolated mobile proof rejected the JSON-range utility\'s prepared local YAML import because its proof-only linker allowed engine paths only. The linker now additionally accepts the already fingerprinted vendor/yaml files; it still rejects host imports and provides no Node, DOM or network globals. Product sources and prepared resources are unchanged.' };
const sourceHashes = JSON.parse(await fs.readFile(path.join(evidence, 'source-hashes.json'), 'utf8'));
assert.ok(Object.hasOwn(sourceHashes, 'engine/scene-composition-batch-layout.mjs'));
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
    'app-scene-composition-overrides.js', 'app-scene-composition-layout.js', 'app-scene-composition-batch-layout.js', 'app-scene-layout.js', 'app-doc-service.js', 'app-studio-core.js'].map(file => `web/modules/${file}`),
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
{
  const files = await inventory(path.join(root,'desktop/ui')), allCopies = {};
  for (const [file, item] of Object.entries(files)) {
    const origin = file.startsWith('i18n/') ? `web/${file}` : `desktop/ui/${file}`;
    assert.equal(item.sha256, await fileSha(path.join(root,origin)));
    allCopies[file] = { source: origin, sourceSha256: item.sha256, expectedSha256: item.sha256, transformation: null };
  }
  report.artifacts['desktop/ui'] = { manifestFileCount: Object.keys(files).length, manifestBytes: Object.values(files).reduce((sum,file) => sum + file.bytes,0),
    manifestSha256: sha(JSON.stringify(files)), manifest: files, checkedSourceFiles: Object.keys(files).length,
    checkedSourceSha256: sha(JSON.stringify(allCopies)), hashes: allCopies, fullSourceCopyCount: Object.keys(files).length,
    fullSourceCopySha256: sha(JSON.stringify(allCopies)), fullSourceCopies: allCopies };
}
report.unchangedFrozenSources = {};
for (const name of ['frozen-backend-baseline.json', 'single-instance-baseline.json', 'historical-baseline.json']) {
  const expected = JSON.parse(await fs.readFile(path.join(evidence, name), 'utf8'));
  for (const [file, digest] of Object.entries(expected)) assert.equal(await fileSha(path.join(root, file)), digest, `Protected source/history changed: ${file}`);
  report.unchangedFrozenSources[name] = { files: Object.keys(expected).length, baselineSha256: await fileSha(path.join(evidence, name)), allMatch: true };
}


const examplePath = path.join(root, 'examples/scene-composition/recipe.json'), exampleBytes = await fs.readFile(examplePath);
const example = JSON.parse(exampleBytes), sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const serialize = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const parse = text => JSON.parse(text.replace(/^\uFEFF/, ''));
function fixture(api, value = copy(example), dirty = false) {
  const content = typeof value === 'string' ? value : serialize(value), sourceRevision = revision(content), decoded = parse(content);
  const expanded = copy(api.expandSceneComposition(content));
  const source = { sourcePath: 'documents/prepared-batch-recipe.json', baseSourceRevision: dirty ? revision('saved baseline') : sourceRevision, content };
  const model = { ok: true, format: 'viento-scene-preview', schemaVersion: 2,
    scene: { objectId: sceneId, sourcePath: source.sourcePath, sourceRevision, viewport: expanded.scene.viewport, background: expanded.scene.background },
    actors: expanded.scene.actors.map(actor => ({ ...actor, name: actor.instanceId })),
    composition: { format: 'viento-scene-composition-preview', schemaVersion: 1, recipeObjectId: sceneId, sourcePath: source.sourcePath,
      sourceRevision, fragmentCount: decoded.fragments.length, placementCount: decoded.placements.length },
    sourceLocations: { actors: expanded.sourceMap.actors.map((actor, index) => ({ instanceId: actor.instanceId, objectId: expanded.scene.actors[index].objectId,
      declaration: { objectId: sceneId, sourcePath: source.sourcePath, sourceRevision },
      composition: { fragmentId: actor.fragmentId, placementId: actor.placementId, localKey: actor.localKey } })) },
    sceneStructure: copy(api.createSceneStructure(expanded.scene)), ...(dirty ? { draft: { baseSourceRevision: source.baseSourceRevision, sourceRevision } } : {}) };
  return { source, model, ids: model.actors.map(actor => actor.instanceId) };
}
const positionInvalid = error => error?.errorCode === 'scene_layout_position_invalid';
const noChange = error => error?.errorCode === 'scene_composition_override_unchanged';
async function runCases(api) {
  const checks = [], digest = sha;
  assert.equal(api.supportsStudioCoreCompositionPositions(), true);
  for (const dirty of [false, true]) {
    const f = fixture(api, copy(example), dirty), original = copy(f);
    const draft = await api.createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest });
    try {
      assert.equal(draft.setPositions(f.ids.map((objectId, index) => ({ objectId,
        position: [f.model.actors[index].position[0] + 17, f.model.actors[index].position[1] + 9] }))), true);
      const proposal = copy(draft.propose()), after = parse(proposal.afterContent);
      assert.equal(proposal.changes.length, 4);
      assert.deepEqual(proposal.changes.map(change => change.instanceId), f.ids);
      assert.deepEqual(proposal.changes.map(change => change.position), [[137,189],[217,189],[117,149],[217,189]]);
      assert.deepEqual(copy(await api.prepareSceneCompositionBatchLayoutApply(f.source, proposal, { digest })),
        { afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
      assert.deepEqual(copy(api.expandSceneComposition(proposal.afterContent).scene.actors.map(actor => actor.position)),
        f.model.actors.map(actor => [actor.position[0] + 17, actor.position[1] + 9]));
      assert.deepEqual(after.fragments, example.fragments);
      assert.deepEqual(after.placements.map(placement => [placement.actorIds, placement.groupIds, placement.offset]),
        example.placements.map(placement => [placement.actorIds, placement.groupIds, placement.offset]));
      assert.deepEqual(after.placements[1].overrides[0].values,
        { position: [117,149], color: '#f1c46e', speed: 0, controls: 'none' });
      assert.equal(proposal.afterContent.startsWith('\uFEFF'), true);
      assert.equal(proposal.afterContent.endsWith('\r\n \t'), true);
      const beforeFragment = api.locateJsonSource(api.parseJsonSource(f.source.content), '/fragments');
      const afterFragment = api.locateJsonSource(api.parseJsonSource(proposal.afterContent), '/fragments');
      assert.equal(f.source.content.slice(beforeFragment.start, beforeFragment.end), proposal.afterContent.slice(afterFragment.start, afterFragment.end));
      assert.equal(draft.undo(), true); assert.equal(draft.state().dirty, false); assert.throws(() => draft.propose(), noChange);
      assert.equal(draft.redo(), true); assert.deepEqual(copy(draft.propose()), proposal);
      assert.deepEqual(f, original);
    } finally { draft.dispose(); }
  }
  checks.push({ id: 'saved-and-dirty-source-four-target-receipt', ok: true, sourceModes: 2, batchTargets: 4, oneAtomicHistoryStep: true,
    detachedAuthorSource: true, fragmentsStableIdsGroupsOffsetAndOtherValuesUnchanged: true });
  {
    for (const shape of ['absent', 'empty', 'existing']) {
      const value = copy(example); delete value.placements[0].overrides;
      if (shape === 'empty') value.placements[0].overrides = [];
      if (shape === 'existing') value.placements[0].overrides = [{ actorKey: 'leader', values: { speed: 0 } }];
      const f = fixture(api, value), request = { protocolVersion: 1, operation: 'sceneComposition.patchPositions', content: f.source.content,
        changes: [{ placementId: value.placements[0].placementId, actorKey: 'companion', position: [231,198] },
          { placementId: value.placements[0].placementId, actorKey: 'leader', position: [141,198] }] };
      const receipt = copy(api.dispatchStudioCoreCompositionPositions(request));
      assert.deepEqual(copy(api.dispatchStudioCoreCompositionPositions({ ...request, changes: [...request.changes].reverse() })), receipt);
      const entries = parse(receipt.afterContent).placements[0].overrides;
      assert.deepEqual(entries.map(entry => entry.actorKey), ['leader','companion']);
      assert.deepEqual(entries[0].values, shape === 'existing' ? { speed: 0, position: [141,198] } : { position: [141,198] });
      assert.deepEqual(entries[1].values, { position: [231,198] });
    }
  }
  checks.push({ id: 'same-placement-atomic-append-and-order', ok: true, containerShapes: 3, requestOrderIndependent: true });
  {
    const f = fixture(api), draft = await api.createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest });
    try {
      draft.move([f.ids[0], f.ids[2]], [11,7]); draft.undo();
      const state = copy(draft.state()), actors = copy(draft.actors());
      const invalidBatches = [
        [{ objectId: f.ids[0], position: [130,190] }, { objectId: f.ids[2], position: [-100000,220] }],
        [{ objectId: f.ids[0], position: [130,190] }, { objectId: f.ids[2], position: [100001,220] }],
        [{ objectId: f.ids[0], position: [130,190] }, { objectId: f.ids[0], position: [140,190] }],
        [{ objectId: f.ids[0], position: [130,190] }, { objectId: f.model.actors[0].objectId, position: [140,190] }],
        [{ objectId: f.ids[0], position: [NaN,190] }],
        Array.from({ length: 129 }, () => ({ objectId: f.ids[0], position: [130,190] })),
      ];
      for (const input of invalidBatches) {
        assert.throws(() => draft.setPositions(input), positionInvalid);
        assert.deepEqual(copy(draft.state()), state); assert.deepEqual(copy(draft.actors()), actors);
      }
      assert.equal(draft.setPositions([]), false); assert.deepEqual(copy(draft.state()), state);
      draft.redo(); assert.deepEqual(copy(draft.currentPosition(f.ids[0])), [131,187]);
      assert.deepEqual(copy(draft.currentPosition(f.ids[2])), [471,227]);
      draft.reset(); draft.move([f.ids[0], f.ids[2]], [12,6], 32);
      const positions = copy([draft.currentPosition(f.ids[0]), draft.currentPosition(f.ids[2])]);
      assert.deepEqual(positions, [[128,192],[468,232]]);
      assert.deepEqual(positions[1].map((coordinate, axis) => coordinate - positions[0][axis]), [340,40]);
    } finally { draft.dispose(); }
  }
  checks.push({ id: 'all-local-bounds-before-history-atomic-move', ok: true, rejectedOperations: 6, redoAndUnselectedActorsUnchanged: true });
  {
    const value = copy(example); value.placements[1].offset = [0.2,0.2]; value.placements[1].overrides[0].values.position = [0.1,0.1];
    const f = fixture(api, value), draft = await api.createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest });
    try {
      const initial = copy(draft.currentPosition(f.ids[2])); assert.notEqual(initial[1] - 0.2, 0.1);
      assert.equal(draft.setPosition(f.ids[2], initial), false);
      draft.setPosition(f.ids[2], [initial[0] + 1, initial[1]]);
      assert.equal(draft.propose().changes[0].position[1], 0.1);
      draft.setPosition(f.ids[0], [140,190]); draft.setPosition(f.ids[2], initial);
      assert.deepEqual(copy(draft.propose().changes.map(change => change.instanceId)), [f.ids[0]]);
      draft.reset(); assert.equal(draft.state().dirty, false); assert.throws(() => draft.propose(), noChange);
    } finally { draft.dispose(); }
  }
  checks.push({ id: 'fractional-unchanged-axis-and-returned-target-noop', ok: true });
  {
    const f = fixture(api), draft = await api.createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest });
    try {
      for (const alignment of ['left','center','right','top','middle','bottom']) {
        const expected = copy(api.alignSceneSelection(f.model.actors, [f.ids[0],f.ids[3]], alignment));
        draft.align([f.ids[0],f.ids[3]], alignment);
        for (const { objectId, position } of expected) assert.deepEqual(copy(draft.currentPosition(objectId)), position);
        assert.deepEqual(copy(draft.currentPosition(f.ids[1])), f.model.actors[1].position);
        assert.deepEqual(copy(draft.currentPosition(f.ids[2])), f.model.actors[2].position);
        await api.prepareSceneCompositionBatchLayoutApply(f.source, draft.propose(), { digest });
        draft.undo(); assert.equal(draft.state().dirty, false); draft.reset();
      }
    } finally { draft.dispose(); }
  }
  checks.push({ id: 'six-size-aware-alignments-one-history-step', ok: true, alignmentModes: 6 });
  {
    const value = copy(example); value.placements[0].overrides = [{ actorKey: 'leader', values: { position: [0,0] } },
      { actorKey: 'companion', values: { position: [99999.9999999,0] } }];
    const raw = serialize(value), content = raw + ' '.repeat(128 * 1024 - new TextEncoder().encode(raw).length);
    const f = fixture(api, content), draft = await api.createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest });
    try {
      assert.equal(new TextEncoder().encode(content).length, 128 * 1024);
      assert.throws(() => api.dispatchStudioCoreCompositionPositions({ protocolVersion: 1, operation: 'sceneComposition.patchPositions', content,
        changes: [{ placementId: value.placements[0].placementId, actorKey: 'leader', position: [100000,0] }] }),
      error => error?.errorCode === 'scene_composition_limit');
      draft.setPositions([{ objectId: f.ids[0], position: [100000,0] }, { objectId: f.ids[1], position: [1,0] }]);
      const proposal = draft.propose(); assert.ok(new TextEncoder().encode(proposal.afterContent).length < 128 * 1024);
      await api.prepareSceneCompositionBatchLayoutApply(f.source, proposal, { digest });
    } finally { draft.dispose(); }
  }
  checks.push({ id: 'final-budget-shrink-offsets-growth-without-intermediate-commit', ok: true, exactSourceBytes: 131072 });
  {
    const f = fixture(api), draft = await api.createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest });
    try {
      draft.move([f.ids[0],f.ids[2]], [13,9]); const proposal = copy(draft.propose());
      for (const alter of [p => p.afterContent += ' ', p => p.changes[0].position[0]++, p => p.changes.reverse(),
        p => p.changes.push(copy(p.changes[0])), p => p.changes[0].instanceId = f.model.actors[0].objectId,
        p => p.changes[0].placementId = example.placements[1].placementId, p => p.changedPaths.reverse()]) {
        const wrong = copy(proposal); alter(wrong);
        await assert.rejects(api.prepareSceneCompositionBatchLayoutApply(f.source, wrong, { digest }));
      }
      await assert.rejects(api.prepareSceneCompositionBatchLayoutApply({ ...f.source, content: f.source.content + ' ' }, proposal, { digest }));
      assert.deepEqual(copy(draft.propose()), proposal);
      const wrongModel = copy(f.model); wrongModel.sourceLocations.actors[3].composition.placementId = example.placements[0].placementId;
      await assert.rejects(api.createSceneCompositionBatchLayoutDraft(wrongModel, f.source, { digest }));
    } finally { draft.dispose(); }
  }
  checks.push({ id: 'canonical-identities-foreign-provenance-stale-and-forged-receipts', ok: true, rejectedOperations: 9 });
  {
    const f = fixture(api, copy(example), true), initial = copy(f); let resolve, captured;
    const gate = new Promise(done => { resolve = done; });
    const pending = api.createSceneCompositionBatchLayoutDraft(f.model, f.source, { digest: text => { captured = text; return gate; } });
    f.model.actors[2].position[0] = 999; f.source.content = '{}'; f.source.baseSourceRevision = revision('changed');
    resolve(sha(captured)); const draft = await pending;
    try {
      assert.deepEqual(copy(draft.actors()), initial.model.actors); draft.move([initial.ids[0],initial.ids[2]], [13,9]);
      const original = copy(draft.propose()), proposal = draft.propose(); proposal.changes[0].position[0] = 999;
      const actors = draft.actors(); actors[2].position[0] = 999;
      assert.deepEqual(copy(draft.propose()), original); await api.prepareSceneCompositionBatchLayoutApply(initial.source, original, { digest });
    } finally { draft.dispose(); }
    assert.throws(() => draft.propose(), error => error?.errorCode === 'scene_layout_draft_invalid');
    for (let index = 0; index < 36; index++) {
      const opened = await api.createSceneCompositionBatchLayoutDraft(initial.model, initial.source, { digest }); opened.dispose();
    }
    const history = await api.createSceneCompositionBatchLayoutDraft(initial.model, initial.source, { digest });
    try {
      const start = initial.model.actors[0].position;
      for (let index = 1; index <= 130; index++) history.setPosition(initial.ids[0], [start[0] + index,start[1]]);
      let undoCount = 0; while (history.undo()) undoCount++;
      assert.equal(undoCount,100); assert.deepEqual(copy(history.currentPosition(initial.ids[0])), [start[0] + 30,start[1]]);
      history.reset(); assert.equal(history.state().dirty, false); assert.deepEqual(copy(history.actors()), initial.model.actors);
    } finally { history.dispose(); }
    const legacy = await api.createSceneCompositionLayoutDraft(initial.model, initial.source, initial.ids[2], { digest });
    try {
      legacy.setPosition(initial.ids[2],[510,250]); const proposal = legacy.propose();
      assert.deepEqual(copy(proposal.values), { position: [150,170] });
      assert.equal(Object.hasOwn(proposal,'changes'), false);
      await api.prepareSceneCompositionOverrideApply(initial.source, proposal, { digest });
    } finally { legacy.dispose(); }
  }
  checks.push({ id: 'async-copy-ownership-disposal-100-history-and-legacy-single-contract', ok: true, disposedSessions: 36, historyLimit: 100 });
  return checks;
}

await importPrepared('scripts/adapters/node-studio-core.mjs');
const moduleFiles = ['engine/scene-composition-batch-layout.mjs', 'engine/scene-composition-layout.mjs',
  'engine/scene-composition-overrides.mjs', 'engine/scene-composition.mjs', 'engine/scene-structure.mjs',
  'engine/scene-layout.mjs', 'engine/studio-core.mjs', 'engine/json-source.mjs'];
const desktopApi = Object.assign({}, ...await Promise.all(moduleFiles.map(importPrepared)));
report.desktopChecks = await runCases(desktopApi);
console.log(JSON.stringify({ phase: 'prepared-desktop-batch-layout', cases: report.desktopChecks.length, ok: true }));

const context = vm.createContext({ TextEncoder, TextDecoder, WebAssembly }), modules = new Map();
function load(relative) {
  assert.equal(relative, path.posix.normalize(relative));
  assert.ok((relative.startsWith('engine/') && relative.endsWith('.mjs') || relative.startsWith('vendor/yaml/') && relative.endsWith('.js'))
    && !/[\\\0?#]/.test(relative), 'Only prepared pure engine modules and the fingerprinted local YAML library may enter this VM');
  if (!modules.has(relative)) modules.set(relative, fs.readFile(path.join(mobile, relative), 'utf8')
    .then(source => new vm.SourceTextModule(source, { context, identifier: relative })));
  return modules.get(relative);
}
function linker(specifier, referencing) {
  assert.ok(typeof specifier === 'string' && !/[\\\0?#]/.test(specifier)
    && (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/engine/') || specifier.startsWith('/vendor/yaml/')));
  return load(path.posix.normalize(specifier.startsWith('/') ? specifier.slice(1) : path.posix.join(path.posix.dirname(referencing.identifier), specifier)));
}
const entry = new vm.SourceTextModule(moduleFiles.map(file => `export * from '/${file}';`).join('\n'), { context, identifier: 'portable-batch-layout-entry' });
await entry.link(linker); await entry.evaluate();
const mobileWasm = await fs.readFile(path.join(mobile, 'engine/studio-core.wasm'));
await entry.namespace.initializeStudioCore(async () => mobileWasm);
assert.equal(entry.namespace.getStudioCoreMetadata().ready, true);
assert.equal(entry.namespace.supportsStudioCoreCompositionPositions(), true);
assert.equal(vm.runInContext('[typeof process, typeof require, typeof Buffer, typeof document, typeof window, typeof fetch].join(",")', context), Array(6).fill('undefined').join(','));
const mobileChecks = await runCases(entry.namespace);
report.mobileChecks = { entryModuleCount: moduleFiles.length, moduleCount: modules.size, modules: [...modules.keys()].sort(),
  wasmSha256: sha(mobileWasm), wasmMetadata: copy(entry.namespace.getStudioCoreMetadata()), checks: mobileChecks,
  acceptedCases: mobileChecks.length, rejectedOperations: mobileChecks.reduce((sum, item) => sum + (item.rejectedOperations || 0), 0),
  noNodeDomNetworkGlobals: true, noHostImports: true, noDeviceAcceptance: true };
assert.deepEqual(mobileChecks, report.desktopChecks);
assert.equal(sha(mobileWasm), await fileSha(path.join(root, 'engine/studio-core.wasm')));
assert.equal(await fileSha(examplePath), sha(exampleBytes));
await verifySources();
for (const [name, artifact] of Object.entries(report.artifacts)) assert.deepEqual(await inventory(path.join(root, name)), artifact.manifest);
assert.equal(report.proofSourceSha256, await fileSha(fileURLToPath(import.meta.url)));
report.ok = true; report.sourceAndPreparedManifestsStableDuringAcceptance = true;
report.counts = { desktopCases: report.desktopChecks.length, mobileCases: mobileChecks.length, totalCases: report.desktopChecks.length + mobileChecks.length };
const output = path.join(evidence, 'packaged-resources.json');
try { await fs.access(output); throw new Error('Refusing to overwrite an existing final prepared-resource report'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, counts: report.counts,
  artifacts: Object.fromEntries(Object.entries(report.artifacts).map(([name, value]) => [name, { manifestFileCount: value.manifestFileCount, checkedSourceFiles: value.checkedSourceFiles, fullSourceCopyCount: value.fullSourceCopyCount }])),
  mobileModuleCount: modules.size, frozenSourceFiles: Object.keys(sourceHashes).length }));
