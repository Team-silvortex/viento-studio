// Run after both resource preparations with the embedded Node executable:
// src-tauri/binaries/viento-node-x86_64-unknown-linux-gnu --experimental-vm-modules docs/test-results/scene-composition-overrides/packaged-check.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const directory = fileURLToPath(new URL('./', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const revision = value => `sha256:${sha(value)}`;
const plain = value => JSON.parse(JSON.stringify(value));
const rewriteMobile = value => value.replaceAll("from 'yaml'", "from '/vendor/yaml/index.js'")
  .replaceAll("from '../node_modules/yaml/browser/index.js'", "from '/vendor/yaml/index.js'");
assert.equal(process.version, 'v24.20.0', 'Use the pinned embedded Node runtime');
const suffix = process.env.VIENTO_PACKAGED_REPORT_SUFFIX || '';
assert.ok(['', '-first'].includes(suffix));
const report = { ok: false, scope: 'Prepared desktop resources executed with embedded Node; isolated prepared mobile ESM/WASM override editing helpers and preview resolver. No installed Tauri window, Android UI or native device is claimed.',
  version: (await fs.readFile(path.join(root, 'VERSION'), 'utf8')).trim(), embeddedNodeVersion: process.version,
  embeddedNodeSha256: sha(await fs.readFile(process.execPath)), artifacts: {}, runtime: {}, sourceLocations: {} };

const engineFiles = (await fs.readdir(path.join(root, 'engine'))).filter(name => name.endsWith('.mjs')).map(name => 'engine/' + name);
const sharedFiles = [...engineFiles, 'engine/studio-core.wasm', 'engine/studio-core.build.json',
  ...['app-runtime.js', 'app-project-build.js', 'app-scene-composition-overrides.js', 'app-scene-preview.js', 'app-scene-preview-canvas.js', 'app-scene-outline.js'].map(name => 'web/modules/' + name),
  ...['messages.js', 'en.js', 'ja.js'].map(name => 'web/i18n/' + name)];
for (const [label, artifact] of [['desktop', 'desktop/resources'], ['mobile', 'mobile/dist']]) {
  const files = [...sharedFiles, ...(label === 'desktop' ? ['scripts/adapters/node-build-snapshot.mjs', 'scripts/adapters/node-world-projection.mjs',
    'scripts/adapters/node-studio-core.mjs', 'scripts/lib/scene-preview-service.mjs', 'scripts/lib/project-build-service.mjs'] : ['mobile/platform.mjs'])];
  const hashes = {};
  for (const name of files) {
    const source = await fs.readFile(path.join(root, name)), packaged = await fs.readFile(path.join(root, artifact, name));
    const expected = label === 'mobile' && name.startsWith('engine/') && name.endsWith('.mjs') ? Buffer.from(rewriteMobile(source.toString('utf8'))) : source;
    assert.equal(sha(packaged), sha(expected), artifact + '/' + name);
    hashes[name] = { sourceSha256: sha(source), packagedSha256: sha(packaged), importRewrite: !source.equals(packaged) };
  }
  report.artifacts[artifact] = { checkedFiles: files.length, hashes };
}
await assert.rejects(fs.access(path.join(root, 'mobile/dist/scripts/lib/scene-preview-service.mjs')), { code: 'ENOENT' });

function loader(base) {
  const context = vm.createContext({ TextEncoder, TextDecoder, structuredClone, console: { log() {}, warn() {}, error() {} } });
  const modules = new Map();
  function load(identifier) {
    const url = identifier instanceof URL ? identifier : pathToFileURL(path.join(base, identifier));
    const file = fileURLToPath(url); assert.ok(file.startsWith(base + path.sep));
    if (!modules.has(url.href)) modules.set(url.href, fs.readFile(file, 'utf8').then(source => new vm.SourceTextModule(source, { context, identifier: url.href })));
    return modules.get(url.href);
  }
  async function entry(name) {
    const module = await load(name);
    if (module.status === 'unlinked') await module.link((specifier, parent) => {
      if (specifier.startsWith('/')) return load(pathToFileURL(path.join(base, specifier)));
      assert.ok(specifier.startsWith('.'), 'Portable graph must not import Node or external modules: ' + specifier);
      return load(new URL(specifier, parent.identifier));
    });
    if (module.status === 'linked') await module.evaluate();
    return module.namespace;
  }
  return { entry, context, paths: () => [...modules.keys()].map(value => path.relative(base, fileURLToPath(value))).sort() };
}

function validateRecipeLocations(locations, objectId, content) {
  const value = JSON.parse(content.replace(/^\ufeff/, ''));
  const pointer = key => key.split('/').slice(1).reduce((value, part) => value?.[part.replaceAll('~1', '/').replaceAll('~0', '~')], value);
  let count = 0, exact = 0, composite = 0;
  function visit(input) {
    if (!input || typeof input !== 'object') return;
    if (input.objectId === objectId && typeof input.propertyPath === 'string') {
      count++; assert.equal(input.sourcePath, 'documents/scenes/recipe.json'); assert.equal(input.sourceRevision, revision(content));
      assert.ok(!/^\/(actors|groups)(\/|$)/.test(input.propertyPath), 'Never expose generated scene pointers');
      if (input.sourceRange) {
        const range = input.sourceRange; assert.ok(range.start >= 0 && range.end <= content.length && range.end >= range.start);
        if (range.exact) { exact++; assert.deepEqual(JSON.parse(content.slice(range.start, range.end)), pointer(input.propertyPath)); }
        else composite++;
      }
    }
    for (const nested of Object.values(input)) if (nested && typeof nested === 'object') visit(nested);
  }
  visit(locations); assert.ok(count > 30); assert.ok(exact > 20); assert.ok(composite > 0);
  return { recipeLocations: count, exactSourceRanges: exact, compositeOrNearestRanges: composite };
}
async function tree(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath || entry.path, entry.name); result[path.relative(root, file)] = sha(await fs.readFile(file));
  }
  return result;
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) freeze(item);
  return Object.freeze(value);
}

const desktop = path.join(root, 'desktop/resources'), imported = relative => import(pathToFileURL(path.join(desktop, relative)));
const { createDocumentStore } = await imported('engine/document-store.mjs');
const { createNodeDocumentStorage } = await imported('scripts/adapters/node-document-storage.mjs');
const { resolveContainedPath } = await imported('scripts/lib/contained-path.mjs');
const { readRegistry } = await imported('scripts/lib/workspace.mjs');
const { readWorldSnapshot } = await imported('scripts/adapters/node-world-projection.mjs');
const { captureBuildSnapshot, captureScenePreviewSnapshot, captureSceneDraftPreview } = await imported('scripts/adapters/node-build-snapshot.mjs');
const { createScenePreviewService } = await imported('scripts/lib/scene-preview-service.mjs');
const { createProjectBuildService } = await imported('scripts/lib/project-build-service.mjs');
const { resolveSceneCompositionPreview } = await imported('engine/scene-composition-preview.mjs');
const overrides = await imported('engine/scene-composition-overrides.mjs');
const packagedCore = await imported('engine/studio-core.mjs');
const compositionEngine = await imported('engine/scene-composition.mjs');
const sceneSource = await imported('engine/scene-source-layout.mjs');
const geometry = await imported('engine/scene-layout.mjs');
const imageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const recipePath = 'documents/scenes/recipe.json';
const recipe = '\ufeff' + (await fs.readFile(path.join(root, 'examples/scene-composition/recipe.json'), 'utf8')).replaceAll('\n', '\r\n');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-composition-overrides-packaged-'));
let service, builds;
try {
  const work = path.join(temp, 'workspace'); await fs.cp(path.join(root, 'examples/scene2d'), work, { recursive: true });
  const storage = createNodeDocumentStorage({ root: work, resolvePath: async (relativePath, { allowCreate }) => {
    const absolutePath = await resolveContainedPath(work, path.join(work, relativePath), { allowMissing: allowCreate });
    let exists = true; try { await fs.stat(absolutePath); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
    return { relativePath, absolutePath, exists };
  } });
  await createDocumentStore({ storage, editablePrefixes: ['documents/'] }).writeDoc({ path: recipePath, content: recipe, create: true, documentType: 'scene' });
  const record = (await readRegistry(work)).documents.find(item => item.sourcePath === recipePath), id = record.id;
  assert.deepEqual(record.relations, []); assert.deepEqual(record.assetBindings, []);
  const baseline = await tree(work), observed = await readWorldSnapshot(work), observationBefore = JSON.stringify(observed); freeze(observed);
  const resolved = await resolveSceneCompositionPreview(observed, id, { digest: sha });
  assert.equal(resolved.ok, true); assert.equal(resolved.model.scene.sourceRevision, revision(recipe)); assert.equal(JSON.stringify(observed), observationBefore);
  report.sourceLocations.desktop = validateRecipeLocations(resolved.model.sourceLocations, id, recipe);
  assert.equal(resolved.model.sourceLocations.actors[2].fields.position.sourceRange.exact, false);
  assert.deepEqual(new Set(resolved.model.sourceLocations.actors[2].fields.position.contributors.map(item => item.role)), new Set(['override', 'offset']));
  const captured = await captureScenePreviewSnapshot(work, id);
  assert.equal(captured.ok, true); assert.equal(captured.snapshot, undefined); assert.equal(captured.sceneEditing, undefined);
  assert.equal(captured.plan.scene.sourceRevision, revision(recipe)); assert.equal(captured.plan.actors.length, 4); assert.equal(captured.sceneStructure.groups.length, 4);
  assert.equal((await captureBuildSnapshot(work, id, { compositionPreview: true })).ok, false);
  const oldPreview = await captureScenePreviewSnapshot(work, sceneId), oldBuild = await captureBuildSnapshot(work, sceneId);
  assert.equal(oldPreview.snapshotId, oldBuild.snapshotId);
  service = createScenePreviewService(work, { enabled: true }); builds = createProjectBuildService(work, { enabled: true, godot: '', cacheRoot: path.join(temp, 'build-cache') });
  const status = await builds.status(); assert.equal(status.scenes.some(item => item.id === id), false);
  assert.equal(status.previewDocuments.find(item => item.id === id).kind, 'composition'); assert.equal(status.previewDocuments.find(item => item.id === sceneId).kind, 'scene');
  await assert.rejects(builds.command({ action: 'plan', sceneId: id }), { errorCode: 'build_scene_required' });
  assert.equal((await builds.status()).job, null);
  const saved = await service.create({ sceneId: id }); assert.equal(saved.ok, true);
  assert.equal(saved.snapshot, undefined); assert.equal(saved.sceneEditing, undefined); assert.equal(saved.snapshotId, captured.snapshotId);
  const frozenImage = Buffer.from(service.resource(saved.previewId, imageId).bytes);
  assert.equal(sha(frozenImage), saved.resources[0].sha256);
  assert.equal(packagedCore.supportsStudioCoreCompositionPatch(), true);
  const source = { sourcePath: recipePath, baseSourceRevision: revision(recipe), content: recipe };
  const local = await overrides.createSceneCompositionOverrideDraft(saved, source, saved.actors[0].instanceId, { digest: sha });
  assert.equal(local.canClearImage, false);
  const proposal = local.propose({ ...local.values, speed: 172 });
  assert.deepEqual(proposal.values, { speed: 172 });
  assert.deepEqual(proposal.changedPaths, ['/placements/0/overrides/0/values/speed']);
  const prepared = await overrides.prepareSceneCompositionOverrideApply(source, proposal, { digest: sha });
  assert.equal(prepared.afterContent, proposal.afterContent);
  const candidateSource = { ...source, content: prepared.afterContent };
  const candidate = await service.create({ sceneId: id, draft: candidateSource });
  assert.equal(candidate.ok, true); assert.equal(candidate.actors[0].speed, 172); assert.equal(candidate.actors[2].speed, 0);
  assert.equal(candidate.scene.sourceRevision, revision(candidateSource.content));
  assert.equal(candidate.composition.sourceRevision, revision(candidateSource.content));
  assert.equal(candidate.draft.baseSourceRevision, revision(recipe));
  const dirty = await overrides.createSceneCompositionOverrideDraft(candidate, candidateSource, candidate.actors[2].instanceId, { digest: sha });
  assert.deepEqual(dirty.values.position, [100, 140]); assert.deepEqual(dirty.offset, [360, 80]);
  const dirtyProposal = dirty.propose({ ...dirty.values, position: [140, 170], color: '#123456' });
  assert.deepEqual(dirtyProposal.values, { position: [140, 170], color: '#123456' });
  const dirtyPrepared = await overrides.prepareSceneCompositionOverrideApply(candidateSource, dirtyProposal, { digest: sha });
  const dirtySource = { ...candidateSource, content: dirtyPrepared.afterContent };
  const checked = await service.create({ sceneId: id, draft: dirtySource });
  assert.equal(checked.ok, true); assert.deepEqual(checked.actors[2].position, [500, 250]);
  assert.equal(checked.actors[2].color, '#123456'); assert.equal(checked.actors[0].speed, 172);
  assert.deepEqual(checked.actors.map(actor => [actor.objectId, actor.instanceId]), saved.actors.map(actor => [actor.objectId, actor.instanceId]));
  assert.deepEqual(checked.sceneStructure, saved.sceneStructure);
  for (const preview of [candidate, checked]) {
    assert.equal(preview.snapshot, undefined); assert.equal(preview.sceneEditing, undefined);
  }
  report.sourceLocations.overrides = validateRecipeLocations(checked.sourceLocations, id, dirtySource.content);
  const beforeValue = JSON.parse(recipe.slice(1)), afterValue = JSON.parse(dirtySource.content.slice(1));
  assert.deepEqual(afterValue.fragments, beforeValue.fragments);
  for (let index = 0; index < 2; index++) {
    assert.deepEqual(afterValue.placements[index].actorIds, beforeValue.placements[index].actorIds);
    assert.deepEqual(afterValue.placements[index].groupIds, beforeValue.placements[index].groupIds);
  }
  await assert.rejects(overrides.prepareSceneCompositionOverrideApply({ ...candidateSource, content: candidateSource.content + ' ' }, dirtyProposal, { digest: sha }), { errorCode: 'scene_composition_override_conflict' });
  await assert.rejects(overrides.prepareSceneCompositionOverrideApply(candidateSource, { ...dirtyProposal, afterContent: dirtyProposal.afterContent + ' ' }, { digest: sha }), { errorCode: 'scene_composition_override_invalid' });
  assert.deepEqual(await tree(work), baseline);
  report.runtime.overrides = { independentWasmCapability: true, savedAndDirtySourceSessions: true, changedOnlySets: true,
    localAndOffsetWorldPositions: true, appliedOnlyInMemory: true, replayedExactReceipts: true, staleAndForgedRejected: true,
    fragmentsAndOtherActorsAndIdentitiesPreserved: true, sourceAndMetadataBytesUnchanged: true, fullDependencyPreviewValidated: true,
    beforeRevision: revision(recipe), candidateRevision: revision(candidateSource.content), finalRevision: revision(dirtySource.content) };
  // These extra previews deliberately evict older sessions; restore the saved
  // image snapshot used by the existing immutable-resource checks below.
  const refreshedSaved = await service.create({ sceneId: id }); saved.previewId = refreshedSaved.previewId;
  const changed = JSON.parse(recipe.slice(1)); changed.placements[1].offset = [420, 90]; changed.scene.title = 'Packaged draft / 草稿';
  const draft = { sourcePath: recipePath, baseSourceRevision: revision(recipe), content: '\ufeff' + JSON.stringify(changed, null, 2).replaceAll('\n', '\r\n') + '\r\n' };
  const drafted = await captureSceneDraftPreview(work, id, draft), draftPreview = await service.create({ sceneId: id, draft });
  assert.equal(drafted.ok, true); assert.equal(drafted.snapshot, undefined); assert.equal(drafted.sceneEditing, undefined);
  assert.equal(draftPreview.scene.sourceRevision, revision(draft.content)); assert.equal(draftPreview.composition.sourceRevision, revision(draft.content));
  assert.deepEqual(draftPreview.actors[2].position, [520, 230]); assert.notEqual(draftPreview.snapshotId, saved.snapshotId);
  assert.equal(draftPreview.snapshot, undefined); assert.equal(draftPreview.sceneEditing, undefined);
  report.sourceLocations.draft = validateRecipeLocations(draftPreview.sourceLocations, id, draft.content);
  await assert.rejects(service.create({ sceneId: id, draft: { ...draft, baseSourceRevision: `sha256:${'0'.repeat(64)}` } }), { errorCode: 'scene_preview_draft_conflict' });
  const malformed = await service.create({ sceneId: id, draft: { ...draft, content: '{"format":"viento-scene-composition",' } });
  assert.equal(malformed.ok, false); assert.equal(malformed.previewId, null); assert.ok(malformed.diagnostics.length);
  assert.deepEqual(await tree(work), baseline);

  const graph = loader(path.join(root, 'mobile/dist')), wasm = await fs.readFile(path.join(root, 'mobile/dist/engine/studio-core.wasm'));
  const core = await graph.entry('engine/studio-core.mjs'); assert.equal((await core.initializeStudioCore(() => wasm)).ready, true);
  assert.equal(core.supportsStudioCoreCompositionPatch(), true);
  const nativeWasm = await WebAssembly.instantiate(wasm, {});
  const capabilities = Object.fromEntries(['viento_core_protocol_version', 'viento_core_scene_source_version',
    'viento_core_scene_composition_version', 'viento_core_scene_composition_patch_version'].map(name => [name, nativeWasm.instance.exports[name]() ]));
  assert.deepEqual(Object.values(capabilities), [1, 1, 1, 1]);
  const mobile = await graph.entry('engine/scene-composition-preview.mjs');
  const mobileObserved = freeze(plain(observed)), before = JSON.stringify(mobileObserved);
  const mobileModel = await mobile.resolveSceneCompositionPreview(mobileObserved, id, { digest: sha });
  assert.equal(mobileModel.ok, true); assert.deepEqual(plain(mobileModel), plain(resolved)); assert.equal(JSON.stringify(mobileObserved), before);
  assert.equal(mobileModel.snapshot, undefined); assert.equal(mobileModel.sceneEditing, undefined);
  report.sourceLocations.mobile = validateRecipeLocations(mobileModel.model.sourceLocations, id, recipe);
  const overlay = await graph.entry('engine/scene-draft-preview.mjs');
  const mobileOverrides = await graph.entry('engine/scene-composition-overrides.mjs');
  const mobileLocal = await mobileOverrides.createSceneCompositionOverrideDraft(plain(saved), plain(source), saved.actors[0].instanceId, { digest: sha });
  const mobileProposal = mobileLocal.propose({ ...plain(mobileLocal.values), speed: 172 });
  assert.deepEqual(plain(mobileProposal), proposal);
  const mobilePrepared = await mobileOverrides.prepareSceneCompositionOverrideApply(plain(source), mobileProposal, { digest: sha });
  assert.deepEqual(plain(mobilePrepared), prepared);
  const mobileDirty = await mobileOverrides.createSceneCompositionOverrideDraft(plain(candidate), plain(candidateSource), candidate.actors[2].instanceId, { digest: sha });
  const mobileDirtyProposal = mobileDirty.propose({ ...plain(mobileDirty.values), position: [140, 170], color: '#123456' });
  assert.deepEqual(plain(mobileDirtyProposal), dirtyProposal);
  assert.deepEqual(plain(await mobileOverrides.prepareSceneCompositionOverrideApply(plain(candidateSource), mobileDirtyProposal, { digest: sha })), dirtyPrepared);
  const overrideObserved = await overlay.overlaySceneDraftPreview(mobileObserved, id, plain(dirtySource), { digest: sha });
  const overrideModel = await mobile.resolveSceneCompositionPreview(freeze(overrideObserved), id, { digest: sha });
  assert.equal(overrideModel.ok, true); assert.deepEqual(plain(overrideModel.model.actors[2].position), [500, 250]);
  assert.equal(overrideModel.model.scene.sourceRevision, revision(dirtySource.content));
  report.sourceLocations.mobileOverrides = validateRecipeLocations(overrideModel.model.sourceLocations, id, dirtySource.content);
  const mobileComposition = await graph.entry('engine/scene-composition.mjs');
  assert.deepEqual(plain(mobileComposition.expandSceneComposition(recipe)), compositionEngine.expandSceneComposition(recipe));
  const mobileSource = await graph.entry('engine/scene-source-layout.mjs');
  const oldSource = observed.source.documents.find(item => item.record.id === sceneId).content;
  const oldDeclaration = JSON.parse(oldSource.replace(/^\ufeff/, ''));
  const positionChanges = [{ objectId: oldDeclaration.actors[0].instanceId || oldDeclaration.actors[0].objectId, position: [45, 65] }];
  assert.deepEqual(plain(mobileSource.patchSceneSourcePositions(oldSource, positionChanges)), sceneSource.patchSceneSourcePositions(oldSource, positionChanges));
  const mobileGeometry = await graph.entry('engine/scene-layout.mjs');
  const selected = [saved.actors[0].instanceId];
  const moved = geometry.moveSceneSelection(saved.actors, selected, [5, -5]);
  assert.deepEqual(plain(mobileGeometry.moveSceneSelection(plain(saved.actors), selected, [5, -5])), moved);
  const geometryDraft = mobileGeometry.createSceneGeometryDraft(plain(saved.actors), plain(saved.actors));
  try {
    geometryDraft.move(selected, [5, -5]); assert.deepEqual(plain(geometryDraft.currentPosition(selected[0])), [125, 175]);
    geometryDraft.undo(); assert.deepEqual(plain(geometryDraft.currentPosition(selected[0])), [120, 180]);
    geometryDraft.redo(); assert.deepEqual(plain(geometryDraft.currentPosition(selected[0])), [125, 175]);
  } finally { geometryDraft.dispose(); }
  const overlaid = await overlay.overlaySceneDraftPreview(mobileObserved, id, draft, { digest: sha }), overlayBefore = JSON.stringify(overlaid); freeze(overlaid);
  const mobileDraft = await mobile.resolveSceneCompositionPreview(overlaid, id, { digest: sha });
  assert.equal(mobileDraft.ok, true); assert.deepEqual(plain(mobileDraft.model.actors[2].position), [520, 230]);
  assert.equal(mobileDraft.model.scene.sourceRevision, revision(draft.content)); assert.equal(JSON.stringify(overlaid), overlayBefore); assert.equal(JSON.stringify(mobileObserved), before);
  const invalidOverlay = await overlay.overlaySceneDraftPreview(mobileObserved, id, { ...draft, content: '{"format":"viento-scene-composition",' }, { digest: sha });
  const invalid = await mobile.resolveSceneCompositionPreview(invalidOverlay, id, { digest: sha }); assert.equal(invalid.recognized, true); assert.equal(invalid.ok, false);
  assert.equal(vm.runInContext('typeof process', graph.context), 'undefined'); assert.equal(vm.runInContext('typeof Buffer', graph.context), 'undefined');
  const modulePaths = graph.paths(); assert.ok(modulePaths.includes('vendor/yaml/index.js')); assert.ok(modulePaths.every(name => !name.startsWith('scripts/') && !name.startsWith('mobile/')));
  // Resource retention must remain frozen even if the original asset changes.
  const asset = path.join(work, 'assets/traveler.svg'); await fs.writeFile(asset, '<svg>Changed live resource</svg>');
  assert.deepEqual(service.resource(saved.previewId, imageId).bytes, frozenImage);
  const wrongImage = await service.create({ sceneId: id }); assert.equal(wrongImage.ok, false); assert.equal(wrongImage.diagnostics[0].code, 'build_resource_changed');
  assert.equal(wrongImage.diagnostics[0].sourceRevision, revision(recipe)); assert.match(wrongImage.diagnostics[0].propertyPath, /^\/fragments\//);
  assert.deepEqual(service.resource(saved.previewId, imageId).bytes, frozenImage);
  await fs.writeFile(asset, frozenImage); assert.deepEqual(await tree(work), baseline);
  await assert.rejects(fs.access(path.join(temp, 'build-cache')), { code: 'ENOENT' });
  report.runtime.desktop = { actualPreparedModules: true, rawRecipeSourceRevision: revision(recipe), savedAndDraftPreview: true,
    repeatedInstances: 4, groups: 4, recipeAndDefinitionAndAssetMetadataUnchanged: true, sourceTreeByteIdentical: true,
    buildEnvelopeAbsent: true, sceneWritebackAbsent: true, buildsRejectRecipes: true, noBuildJobsOrCache: true, previewCatalogKinds: ['scene', 'composition'],
    imageHashVerifiedAndFrozen: true, changedImageDiagnosticUsesRecipeLocation: true, staleDraftRejected: true, malformedDraftRejected: true, oldSceneSnapshotUnchanged: true };
  report.runtime.mobile = { isolatedPreparedResolver: true, noNodeGlobals: true, completeModelParity: true, rawSourceLocationsVerified: true,
    independentCompositionPatchCapability: true, capabilities, overrideHelperSavedAndDraft: true, exactDesktopPatchParity: true,
    oldExpandAndSceneSourcePatchAndGeometryWithUndoRedo: true,
    originalFrozenObservationUnchanged: true, draftOverlayAndResolver: true, malformedDraftRejected: true, moduleCount: modulePaths.length, modulePaths,
    wasmBytes: wasm.length, wasmSha256: sha(wasm), previewHostBundled: false, mobilePreviewGui: false, nativeDevice: false };
  for (const [artifact, entry] of Object.entries(report.artifacts)) for (const [name, hashes] of Object.entries(entry.hashes)) {
    assert.equal(sha(await fs.readFile(path.join(root, name))), hashes.sourceSha256, 'Source changed during the packaged execution: ' + name);
    assert.equal(sha(await fs.readFile(path.join(root, artifact, name))), hashes.packagedSha256, 'Prepared artifact changed during execution: ' + artifact + '/' + name);
  }
  report.sourceAndPackagedHashesStableThroughoutExecution = true;
  report.harnessSha256 = sha(await fs.readFile(fileURLToPath(import.meta.url)));
  report.ok = true;
} finally {
  await service?.close(); await builds?.close(); await fs.rm(temp, { recursive: true, force: true }); report.syntheticFixtureRemoved = true;
}
await fs.writeFile(path.join(directory, `packaged-resources${suffix}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ok: report.ok, version: report.version, embeddedNode: report.embeddedNodeVersion,
  desktopHashes: report.artifacts['desktop/resources'].checkedFiles, mobileHashes: report.artifacts['mobile/dist'].checkedFiles,
  desktopSavedDraftAndFreeze: true, isolatedMobileResolver: true, mobileLoadedModules: report.runtime.mobile.moduleCount,
  sourceLocations: report.sourceLocations, wasmBytes: report.runtime.mobile.wasmBytes, wasmSha256: report.runtime.mobile.wasmSha256 }));
