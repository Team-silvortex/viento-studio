import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root = '/home/chiharukiryu/cdev/viento-studio';
const output = path.join(root, 'docs/test-results/scene-composition-workflow/packaged-resources.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const run = promisify(execFile);
const mobileBinary = '/tmp/viento-composition-workflow-native-target/debug/examples/mobile-storage';
const archiveBinary = '/tmp/viento-composition-workflow-native-target/debug/examples/workspace-archive';
const native = async (...args) => JSON.parse((await run(archiveBinary, args, { timeout: 30000 })).stdout);
const mobileRewrite = value => value.replaceAll("from 'yaml'", "from '/vendor/yaml/index.js'")
  .replaceAll("from '../node_modules/yaml/browser/index.js'", "from '/vendor/yaml/index.js'");
const sourceRecipe = await fs.readFile(path.join(root, 'examples/scene-composition/recipe.json'), 'utf8');
const recipe = '\ufeff' + sourceRecipe.replaceAll('\n', '\r\n');
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', imageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const report = { ok: false, scope: 'Prepared desktop/mobile resources; actual packaged CLI and selective package workflow; isolated mobile ESM/WASM plus native storage bridge. No installer or Android device acceptance.',
  version: (await fs.readFile(path.join(root, 'VERSION'), 'utf8')).trim(), artifacts: {}, runtime: {},
  nativeHelpers: { mobileStorageSha256: sha(await fs.readFile(mobileBinary)), workspaceArchiveSha256: sha(await fs.readFile(archiveBinary)) } };

function loader(base) {
  const context = vm.createContext({ TextEncoder, TextDecoder, URL, Response, Request, Headers, AbortController, AbortSignal,
    setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {} } });
  const modules = new Map();
  function load(identifier) {
    const url = identifier instanceof URL ? identifier : pathToFileURL(path.join(base, identifier));
    const file = fileURLToPath(url); assert.ok(file.startsWith(base + path.sep), 'module stays in packaged artifact');
    if (!modules.has(url.href)) modules.set(url.href, fs.readFile(file, 'utf8').then(source => new vm.SourceTextModule(source, { context, identifier: url.href })));
    return modules.get(url.href);
  }
  async function entry(name) {
    const module = await load(name);
    if (module.status === 'unlinked') await module.link((specifier, parent) => {
      if (specifier.startsWith('/')) return load(pathToFileURL(path.join(base, specifier)));
      assert.ok(specifier.startsWith('.'), 'No Node or external module import: ' + specifier);
      return load(new URL(specifier, parent.identifier));
    });
    if (module.status === 'linked') await module.evaluate();
    return module.namespace;
  }
  return { entry, context, paths: () => [...modules.keys()].map(value => path.relative(base, fileURLToPath(value))).sort() };
}

const engine = (await fs.readdir(path.join(root, 'engine'))).filter(name => name.endsWith('.mjs')).map(name => 'engine/' + name);
const shared = [...engine, 'engine/studio-core.wasm', 'engine/studio-core.build.json'];
const desktopFiles = ['scripts/scene-compose.mjs', 'scripts/adapters/node-studio-core.mjs', 'scripts/adapters/node-world-projection.mjs',
  'scripts/lib/resource-package-catalog.mjs', 'scripts/lib/resource-package-reader.mjs', 'scripts/lib/resource-package-import.mjs'];
for (const [label, artifact] of [['desktop', 'desktop/resources'], ['mobile', 'mobile/dist']]) {
  const files = [...shared, ...(label === 'desktop' ? desktopFiles : ['mobile/platform.mjs'])], hashes = {};
  for (const name of files) {
    const source = await fs.readFile(path.join(root, name)), packaged = await fs.readFile(path.join(root, artifact, name));
    const expected = label === 'mobile' && name.startsWith('engine/') && name.endsWith('.mjs') ? Buffer.from(mobileRewrite(source.toString('utf8'))) : source;
    assert.deepEqual(packaged, expected, `${artifact}/${name}`);
    hashes[name] = { sourceSha256: sha(source), packagedSha256: sha(packaged), importRewrite: !source.equals(packaged) };
  }
  report.artifacts[artifact] = { checkedFiles: files.length, hashes };
}
await assert.rejects(fs.access(path.join(root, 'mobile/dist/scripts/scene-compose.mjs')), { code: 'ENOENT' });
await assert.rejects(fs.access(path.join(root, 'mobile/dist/scripts/lib/resource-package-catalog.mjs')), { code: 'ENOENT' });
const desktopRoot = path.join(root, 'desktop/resources');
const imported = relative => import(pathToFileURL(path.join(desktopRoot, relative)));
const { registerWorkspace, readRegistry } = await imported('scripts/lib/workspace.mjs');
const { createDocumentStore } = await imported('engine/document-store.mjs');
const { createNodeDocumentStorage } = await imported('scripts/adapters/node-document-storage.mjs');
const { resolveContainedPath } = await imported('scripts/lib/contained-path.mjs');
const { readPackageCatalog } = await imported('scripts/lib/resource-package-catalog.mjs');
const { planExport, writeExportZip } = await imported('scripts/lib/export-package.mjs');
const { unpackResourcePackage } = await imported('scripts/lib/resource-package-reader.mjs');
const { planPackageImport } = await imported('scripts/lib/resource-package-import.mjs');
const { applyPackageImport } = await imported('scripts/lib/resource-package-transaction.mjs');
const { expandSceneComposition } = await imported('engine/scene-composition.mjs');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-composition-workflow-packaged-'));
let library;
try {
  const work = path.join(temporary, 'work'); await fs.cp(path.join(root, 'examples/scene2d'), work, { recursive: true });
  await registerWorkspace(work);
  const store = createDocumentStore({ editablePrefixes: ['documents/'], storage: createNodeDocumentStorage({ root: work,
    resolvePath: async (relativePath, { allowCreate }) => {
      const absolutePath = await resolveContainedPath(work, path.join(work, relativePath), { allowMissing: allowCreate });
      let exists = true; try { await fs.stat(absolutePath); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
      return { relativePath, absolutePath, exists };
    } }) });
  const sourcePath = 'documents/scenes/recipe.json';
  await store.writeDoc({ path: sourcePath, content: recipe, create: true, documentType: 'scene' });
  const record = (await readRegistry(work)).documents.find(record => record.sourcePath === sourcePath);
  const recordPath = `metadata/documents/${record.id}.json`, originalMetadata = await fs.readFile(path.join(work, recordPath));
  assert.deepEqual(record.relations, []); assert.deepEqual(record.assetBindings, []);
  const expected = expandSceneComposition(recipe);
  const command = path.join(desktopRoot, 'scripts/scene-compose.mjs');
  const completed = await run(process.execPath, [command, '--root', work, '--object', record.id, '--revision', 'sha256:' + sha(recipe), '--emit', 'bundle'], { timeout: 15000 });
  assert.equal(completed.stderr, ''); const bundle = JSON.parse(completed.stdout);
  assert.equal(bundle.origin.objectId, record.id); assert.equal(bundle.sourceRevision, 'sha256:' + sha(recipe));
  assert.deepEqual(bundle.scene, expected.scene); assert.deepEqual(bundle.sourceMap, expected.sourceMap);
  const catalog = await readPackageCatalog(work), item = catalog.entries.find(item => item.id === record.id);
  assert.deepEqual(item.problems, []); assert.deepEqual(item.dependencies, [actorId, imageId]);
  const resourceArchive = path.join(temporary, 'recipe-resources.zip');
  await writeExportZip(await planExport(work, { kind: 'resources', ids: [record.id], revision: catalog.revision }), resourceArchive);
  const cache = path.join(temporary, 'cache'); await fs.mkdir(cache); const pack = await unpackResourcePackage(resourceArchive, cache);
  assert.equal(pack.manifest.documents.length, 2); assert.equal(pack.manifest.assets.length, 1);
  const target = path.join(temporary, 'target'); await fs.mkdir(target);
  const manifest = JSON.parse(await fs.readFile(path.join(work, 'workspace.json'))); manifest.id = randomUUID();
  await fs.writeFile(path.join(target, 'workspace.json'), JSON.stringify(manifest));
  await fs.cp(path.join(work, 'templates'), path.join(target, 'templates'), { recursive: true }); await registerWorkspace(target);
  const plan = await planPackageImport(target, pack); assert.deepEqual(plan.summary.conflicts, []);
  assert.equal((await applyPackageImport(target, pack, plan.revision)).status, 'imported');
  assert.equal(await fs.readFile(path.join(target, sourcePath), 'utf8'), recipe);
  assert.deepEqual(await fs.readFile(path.join(target, recordPath)), originalMetadata);
  const importedCli = await run(process.execPath, [command, '--root', target, '--object', record.id], { timeout: 15000 });
  assert.deepEqual(JSON.parse(importedCli.stdout), expected.scene);
  report.runtime.desktop = { actualPackagedCli: true, standaloneNodeHost: process.version, registeredOrdinaryCreate: true,
    exactBomCrlfAndIdentityPreserved: true, resourceCatalogDerivedDependencies: item.dependencies, selectivePackageRoundtrip: true,
    packagedDocuments: 2, packagedImages: 1, generatedActors: expected.scene.actors.length, generatedGroups: expected.scene.groups.length,
    sourceRevision: bundle.sourceRevision, sourceMetadataUnchanged: true };

  const graph = loader(path.join(root, 'mobile/dist'));
  const core = await graph.entry('engine/studio-core.mjs'), wasm = await fs.readFile(path.join(root, 'mobile/dist/engine/studio-core.wasm'));
  assert.equal((await core.initializeStudioCore(() => wasm)).ready, true);
  const inspection = await graph.entry('engine/scene-composition-document.mjs'), composition = await graph.entry('engine/scene-composition.mjs');
  const checked = inspection.inspectSceneComposition(recipe); assert.equal(checked.ok, true);
  assert.deepEqual(plain(checked.dependencies), { objectIds: [actorId], imageResourceIds: [imageId] });
  assert.deepEqual(plain(composition.expandSceneComposition(recipe)), expected);
  assert.equal(inspection.inspectSceneComposition('{"format":"viento-scene-composition",').ok, false);
  assert.equal(inspection.inspectSceneComposition('{"title":"ordinary"}').recognized, false);
  const source = { documents: [{ record: { id: actorId }, content: '# Traveler' }], assets: [{ record: { id: imageId, kind: 'image' } }] };
  assert.deepEqual(plain(inspection.validateSceneCompositionDependencies(checked, record, source)), []);
  assert.ok(inspection.validateSceneCompositionDependencies(checked, record, { ...source, assets: [] }).length);
  assert.equal(vm.runInContext('typeof process', graph.context), 'undefined'); assert.equal(vm.runInContext('typeof Buffer', graph.context), 'undefined');
  const sourceModules = graph.paths();
  const { nativeMobileLibrary } = await import(pathToFileURL(path.join(root, 'scripts/tests/mobile-native-harness.mjs')));
  library = await nativeMobileLibrary(mobileBinary, path.join(temporary, 'mobile-library'));
  const fullArchive = path.join(temporary, 'mobile-input.viento.zip'); await writeExportZip(await planExport(work, { kind: 'workspace' }), fullArchive);
  const mobileWork = await library.invoke('mobile_storage', { action: 'importArchive', path: fullArchive });
  const platformModule = await graph.entry('mobile/platform.mjs');
  const platform = platformModule.createMobilePlatform({ invoke: library.invoke, workspaceId: mobileWork.id });
  const readResponse = await platform.request('/api/doc?path=' + encodeURIComponent(sourcePath)); assert.equal(readResponse.status, 200);
  const read = await readResponse.json(); assert.equal(read.content, recipe);
  const edited = recipe.replace('Two parties', 'Packaged mobile parties');
  const saveResponse = await platform.request('/api/doc', { method: 'POST', body: JSON.stringify({ path: sourcePath, content: edited, expectedVersion: read.version }) });
  assert.equal(saveResponse.status, 200);
  const stale = await platform.request('/api/doc', { method: 'POST', body: JSON.stringify({ path: sourcePath, content: recipe, expectedVersion: read.version }) });
  assert.equal(stale.status, 409);
  const current = await (await platform.request('/api/doc?path=' + encodeURIComponent(sourcePath))).json(); assert.equal(current.content, edited);
  assert.equal(inspection.inspectSceneComposition(current.content).ok, true);
  const editedArchive = path.join(temporary, 'mobile-output.viento.zip');
  await library.invoke('mobile_storage', { action: 'exportArchive', workspaceId: mobileWork.id, path: editedArchive });
  const restoredParent = path.join(temporary, 'restored'); await fs.mkdir(restoredParent);
  const restored = await native('import', editedArchive, restoredParent);
  assert.equal(await fs.readFile(path.join(restored.root, sourcePath), 'utf8'), edited);
  assert.deepEqual(await fs.readFile(path.join(restored.root, recordPath)), originalMetadata);
  const restoredCli = await run(process.execPath, [command, '--root', restored.root, '--object', record.id], { timeout: 15000 });
  assert.deepEqual(JSON.parse(restoredCli.stdout), plain(composition.expandSceneComposition(edited)).scene);
  assert.equal(await fs.readFile(path.join(work, sourcePath), 'utf8'), recipe);
  assert.deepEqual(await fs.readFile(path.join(work, recordPath)), originalMetadata);
  report.runtime.mobile = { isolatedPackagedInspector: true, noNodeGlobals: true, wasmBytes: wasm.length, wasmSha256: sha(wasm),
    sourceLoadedModules: sourceModules, dependencyKindAndAvailabilityValidation: true, malformedRejected: true, ordinaryFormatExit: true,
    actualPackagedPlatformToNativeStorage: true, exactBomCrlfPreserved: true, ordinaryEdit: true, staleEditRejected: true,
    nativeArchiveReturnToPackagedDesktopCli: true, metadataAndIdentityPreserved: true, newNodePackageModulesBundled: false,
    finalLoadedModules: graph.paths().length, androidDevice: false };
  report.ok = true;
} finally {
  await library?.close();
  await fs.rm(temporary, { recursive: true, force: true });
  report.syntheticFixtureRemoved = true;
}
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ok: report.ok, desktopHashes: report.artifacts['desktop/resources'].checkedFiles,
  mobileHashes: report.artifacts['mobile/dist'].checkedFiles, desktopCliAndPackages: true, mobileInspectorAndNativeBridge: true,
  wasmBytes: report.runtime.mobile.wasmBytes, wasmSha256: report.runtime.mobile.wasmSha256 }));
