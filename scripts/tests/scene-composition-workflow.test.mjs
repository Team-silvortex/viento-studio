// Registered recipes remain ordinary author-owned JSON. Dependency closure is
// derived from current source at package/read time; metadata is never rewritten.
import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { createDocumentStore } from '../../engine/document-store.mjs';
import { createNodeDocumentStorage } from '../adapters/node-document-storage.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { registerWorkspace, readRegistry } from '../lib/workspace.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { getProjectionTemplates, lockProjectionTemplate } from '../../engine/object-projection.mjs';
import { expandSceneComposition } from '../../engine/scene-composition.mjs';
import { inspectSceneComposition } from '../../engine/scene-composition-document.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { nativeMobileLibrary } from './mobile-native-harness.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { runSceneComposeCommand } from '../scene-compose.mjs';

const example = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url)));
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', originalImage = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const projectionId = '70000000-1111-4111-8111-111111111111';
const recipePath = 'documents/scenes/recipe.json';
const json = value => JSON.stringify(value, null, 2) + '\n';
const serialize = value => '\ufeff' + json(value).replaceAll('\n', '\r\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const run = promisify(execFile);
const archiveBinary = process.env.VIENTO_TEST_ARCHIVE_BINARY, mobileBinary = process.env.VIENTO_MOBILE_STORE_BIN, godot = process.env.VIENTO_GODOT_BIN;
const native = async (...args) => JSON.parse((await run(archiveBinary, args, { timeout: 30000 })).stdout);
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-composition-workflow-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory;
}
async function inventory(root) {
  const result = {};
  for (const item of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (item.isFile()) {
    const file = path.join(item.parentPath, item.name); result[path.relative(root, file)] = hash(await fs.readFile(file));
  }
  return result;
}
function storeFor(root) {
  const storage = createNodeDocumentStorage({ root, resolvePath: async (relativePath, { allowCreate }) => {
    const absolutePath = await resolveContainedPath(root, path.join(root, relativePath), { allowMissing: allowCreate });
    let exists = true; try { await fs.stat(absolutePath); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
    return { relativePath, absolutePath, exists };
  } });
  return createDocumentStore({ storage, editablePrefixes: ['documents/'] });
}
async function fixture(t) {
  const directory = await temporary(t), root = path.join(directory, 'workspace');
  await fs.cp(new URL('../../examples/scene2d/', import.meta.url), root, { recursive: true });
  await fs.writeFile(path.join(root, 'documents/characters/unused.md'), '# Unplaced definition\nMust migrate with its unused fragment.\n');
  for (const [name, fill] of [['projection', '#aabbcc'], ['shadowed', '#112233'], ['override', '#445566'], ['unused', '#778899']]) {
    await fs.writeFile(path.join(root, `assets/${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${fill}"/></svg>\n`);
  }
  await registerWorkspace(root); const registry = await readRegistry(root);
  const images = Object.fromEntries(['projection', 'shadowed', 'override', 'unused'].map(name => [name, registry.assets.find(item => item.location.path === `${name}.svg`).id]));
  const unusedId = registry.documents.find(item => item.sourcePath === 'documents/characters/unused.md').id;
  const template = getProjectionTemplates().find(item => item.id.endsWith('.rpg-player'));
  const configuration = Object.fromEntries(template.fields.map(field => [field.id, field.default])); configuration.image = images.projection;
  const declaration = { format: 'viento-object-projection', schemaVersion: 1, title: 'Inherited traveler', sourceObjectId: actorId,
    template: await lockProjectionTemplate(template, { digest: hash }), configuration };
  const world = await readWorldProjection(root);
  await createWorldCommandService(root)({ command: 'projection.create', mode: 'apply', worldId: world.world.id, baseRevision: world.world.revision,
    actorRef: { kind: 'tool', id: 'composition-workflow-test' }, objectId: projectionId, documentType: 'character', sourcePath: 'documents/characters/projected.json', content: json(declaration) });
  const recipe = structuredClone(example), leader = recipe.fragments[0].actors[0];
  leader.objectId = projectionId; leader.useProjectionDefaults = true;
  for (const field of ['size', 'color', 'speed', 'controls', 'imageResourceId']) delete leader[field];
  recipe.fragments[0].actors[1].imageResourceId = images.shadowed;
  for (const placement of recipe.placements) (placement.overrides ||= []).push({ actorKey: 'companion', values: { imageResourceId: images.override } });
  recipe.fragments.push({ fragmentId: 'unplaced', actors: [{ ...structuredClone(example.fragments[0].actors[1]), key: 'waiting', objectId: unusedId, imageResourceId: images.unused }], groups: [] });
  delete recipe.fragments[1].actors[0].groupKey;
  const store = storeFor(root), content = serialize(recipe);
  const created = await store.writeDoc({ path: recipePath, content, create: true, documentType: 'scene' });
  const record = (await readRegistry(root)).documents.find(item => item.sourcePath === recipePath);
  const recordPath = `metadata/documents/${record.id}.json`, recordBytes = await fs.readFile(path.join(root, recordPath));
  assert.deepEqual(record.relations, []); assert.deepEqual(record.assetBindings, []);
  return { directory, root, recipe, content, store, created, record, recordPath, recordBytes, images, unusedId };
}
async function save(f, content, expectedVersion) {
  const current = expectedVersion || (await f.store.getDocByPath(recipePath)).version;
  return f.store.writeDoc({ path: recipePath, content, expectedVersion: current });
}
async function assertRecordUnchanged(f) { assert.deepEqual(await fs.readFile(path.join(f.root, f.recordPath)), f.recordBytes); }
async function exported(f, options = {}) {
  const catalog = await readPackageCatalog(f.root), plan = await planExport(f.root, { kind: 'resources', ids: [f.record.id], revision: catalog.revision, ...options });
  const archive = path.join(f.directory, `${randomUUID()}.zip`); await writeExportZip(plan, archive);
  const cache = path.join(f.directory, `unpacked-${randomUUID()}`); await fs.mkdir(cache);
  return { catalog, plan, archive, pack: await unpackResourcePackage(archive, cache) };
}
async function emptyTarget(f) {
  const root = path.join(f.directory, `target-${randomUUID()}`); await fs.mkdir(root);
  const manifest = JSON.parse(await fs.readFile(path.join(f.root, 'workspace.json'))); manifest.id = randomUUID(); manifest.name = 'Imported recipe';
  await fs.writeFile(path.join(root, 'workspace.json'), json(manifest)); await fs.cp(path.join(f.root, 'templates'), path.join(root, 'templates'), { recursive: true });
  await registerWorkspace(root); return root;
}
async function zipEntries(file) {
  const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value)));
  return new Promise((resolve, reject) => {
    const result = new Map(); zip.on('error', reject); zip.on('end', () => resolve(result));
    zip.on('entry', entry => zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error); const chunks = []; stream.on('error', reject); stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => { result.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
    })); zip.readEntry();
  });
}
async function rewriteArchive(f, archive, mutate) {
  const entries = await zipEntries(archive), manifest = JSON.parse(entries.get('manifest.json'));
  await mutate(manifest, entries);
  // The archive attacker controls manifest hashes; integrity alone must not
  // hide recipe references to files/requirements removed from the package.
  manifest.files = manifest.files.filter(item => entries.has(item.path)).map(item => ({ ...item, size: entries.get(item.path).length, sha256: hash(entries.get(item.path)) }));
  entries.set('manifest.json', Buffer.from(json(manifest)));
  const zip = new yazl.ZipFile(), output = path.join(f.directory, `${randomUUID()}.forged.zip`);
  for (const [name, bytes] of entries) zip.addBuffer(bytes, name);
  const finished = pipeline(zip.outputStream, createWriteStream(output)); zip.end(); await finished; return output;
}
async function rejectedArchive(f, archive) {
  const cache = path.join(f.directory, `rejected-${randomUUID()}`); await fs.mkdir(cache);
  await assert.rejects(unpackResourcePackage(archive, cache), { errorCode: 'resource_package_failed' });
}

test('ordinary document creation/save preserves recipe identity and exact bytes without writing dependency metadata', async t => {
  const f = await fixture(t), original = await f.store.getDocByPath(recipePath);
  assert.equal(original.content, f.content); assert.equal(original.version, f.created.version);
  const updated = f.content.replace('Two parties', 'Two edited parties'), saved = await save(f, updated);
  assert.equal(await fs.readFile(path.join(f.root, recipePath), 'utf8'), updated); assert.notEqual(saved.version, original.version);
  await assert.rejects(save(f, f.content, original.version), error => error.statusCode === 409);
  assert.equal((await readRegistry(f.root)).documents.find(item => item.sourcePath === recipePath).id, f.record.id);
  await assertRecordUnchanged(f);
});
test('catalog derives all source dependencies, including unused fragments and shadowed images, plus the projection closure', async t => {
  const f = await fixture(t), before = await inventory(f.root), catalog = await readPackageCatalog(f.root), item = catalog.entries.find(item => item.id === f.record.id);
  assert.deepEqual(item.problems, []); assert.equal(item.name, f.recipe.scene.title);
  const inspected = inspectSceneComposition(f.content), expanded = expandSceneComposition(f.content);
  assert.equal(inspected.ok, true);
  assert.deepEqual(inspected.dependencies.objectIds, [actorId, projectionId, f.unusedId].sort());
  assert.deepEqual(inspected.dependencies.imageResourceIds, [f.images.shadowed, f.images.override, f.images.unused].sort());
  assert.ok(expanded.scene.actors.every(actor => actor.imageResourceId !== f.images.shadowed && actor.imageResourceId !== f.images.unused));

  assert.deepEqual(new Set(item.dependencies), new Set([actorId, projectionId, f.unusedId, f.images.shadowed, f.images.override, f.images.unused]));
  const { plan, pack } = await exported(f);
  assert.equal(plan.documentCount, 4); assert.equal(plan.assetCount, 5);
  assert.deepEqual(new Set(pack.manifest.documents.map(item => item.id)), new Set([f.record.id, actorId, projectionId, f.unusedId]));
  assert.deepEqual(new Set(pack.manifest.assets.map(item => item.id)), new Set([originalImage, ...Object.values(f.images)]));
  assert.deepEqual(pack.records.get(f.record.id).record, f.record); assert.deepEqual(await inventory(f.root), before);
});
test('changing only recipe source immediately updates derived closure and catalog revision without retaining stale metadata edges', async t => {
  const f = await fixture(t), before = await readPackageCatalog(f.root), changed = structuredClone(f.recipe);
  changed.fragments.pop(); changed.fragments[0].actors[1].imageResourceId = f.images.override;
  await save(f, serialize(changed)); const after = await readPackageCatalog(f.root), item = after.entries.find(item => item.id === f.record.id);
  assert.notEqual(after.revision, before.revision); assert.deepEqual(item.problems, []);
  assert.ok(!item.dependencies.includes(f.unusedId)); assert.ok(!item.dependencies.includes(f.images.unused)); assert.ok(!item.dependencies.includes(f.images.shadowed));
  assert.ok(item.dependencies.includes(f.images.override)); await assertRecordUnchanged(f);
});
test('resource package migration preserves recipe source/UUID and re-expands to identical scene and provenance', async t => {
  const f = await fixture(t), { pack } = await exported(f), target = await emptyTarget(f), before = await inventory(f.root);
  const planned = await planPackageImport(target, pack); assert.deepEqual(planned.summary.conflicts, []);
  assert.equal((await applyPackageImport(target, pack, planned.revision)).status, 'imported');
  const restored = await fs.readFile(path.join(target, recipePath), 'utf8'); assert.equal(restored, f.content);
  assert.deepEqual(await fs.readFile(path.join(target, f.recordPath)), f.recordBytes);
  assert.deepEqual(expandSceneComposition(restored), expandSceneComposition(f.content));
  const recatalog = await readPackageCatalog(target); assert.deepEqual(recatalog.entries.find(item => item.id === f.record.id).problems, []);
  assert.deepEqual(await inventory(f.root), before); await assertRecordUnchanged(f);
});
test('excluded dependencies are pinned requirements and stale required content rejects import without writes', async t => {
  const f = await fixture(t), { pack } = await exported(f, { includeDependencies: false });
  assert.deepEqual(pack.manifest.documents.map(item => item.id), [f.record.id]); assert.equal(pack.manifest.assets.length, 0);
  assert.deepEqual(new Set(pack.manifest.requirements.map(item => item.id)), new Set([actorId, projectionId, f.unusedId, f.images.shadowed, f.images.override, f.images.unused]));
  const target = path.join(f.directory, 'with-dependencies'); await fs.cp(f.root, target, { recursive: true });
  await fs.rm(path.join(target, recipePath)); await fs.rm(path.join(target, f.recordPath));
  const planned = await planPackageImport(target, pack); assert.deepEqual(planned.summary.conflicts, []);
  await fs.appendFile(path.join(target, 'documents/characters/unused.md'), 'Changed after preview\n'); const before = await inventory(target);
  await assert.rejects(applyPackageImport(target, pack, planned.revision), error => error.statusCode === 409);
  assert.deepEqual(await inventory(target), before);
});
test('reader rejects omitted source-declared assets or document requirements even after manifest hashes are rewritten', async t => {
  const f = await fixture(t), complete = await exported(f), thin = await exported(f, { includeDependencies: false }), before = await inventory(f.root);
  const missingAsset = await rewriteArchive(f, complete.archive, (manifest, entries) => {
    const item = manifest.assets.find(item => item.id === f.images.shadowed); manifest.assets = manifest.assets.filter(asset => asset !== item);
    entries.delete(item.path); entries.delete(`metadata/assets/${item.id}.json`);
  });
  await rejectedArchive(f, missingAsset);
  const missingRequired = await rewriteArchive(f, thin.archive, manifest => { manifest.requirements = manifest.requirements.filter(item => item.id !== f.unusedId); });
  await rejectedArchive(f, missingRequired);
  // Target already has the same IDs. A caller bypassing ZIP inspection still
  // cannot let ambient, unpinned project records legitimize a forged manifest.
  const forgedPack = { ...thin.pack, manifest: { ...thin.pack.manifest, requirements: thin.pack.manifest.requirements.filter(item => item.id !== f.unusedId) } };
  let refused = false;
  try { const plan = await planPackageImport(f.root, forgedPack); refused = plan.summary.conflicts.length > 0; }
  catch (error) { assert.equal(error.errorCode, 'resource_package_failed'); refused = true; }
  assert.equal(refused, true); assert.deepEqual(await inventory(f.root), before);
});
test('source dependency category spoofing and invalid UTF8 remain rejected despite valid archive hashes', async t => {
  const f = await fixture(t), { archive } = await exported(f);
  const swapped = await rewriteArchive(f, archive, (manifest, entries) => {
    const recipe = structuredClone(f.recipe); recipe.fragments[1].actors[0].objectId = f.images.unused; entries.set(recipePath, Buffer.from(serialize(recipe)));
  });
  await rejectedArchive(f, swapped);
  const invalidUtf8 = await rewriteArchive(f, archive, (manifest, entries) => {
    const bytes = entries.get(recipePath), text = Buffer.from('Two parties'), index = bytes.indexOf(text); assert.ok(index >= 0);
    const changed = Buffer.from(bytes); changed[index] = 0xff; entries.set(recipePath, changed);
  });
  await rejectedArchive(f, invalidUtf8);
});
test('unfinished source remains saveable and fully backupable; selective export rejects it until the author repairs it', async t => {
  const f = await fixture(t), unfinished = '\ufeff{ "format": "viento-scene-composition",\r\n "scene":';
  await save(f, unfinished); assert.equal((await f.store.getDocByPath(recipePath)).content, unfinished);
  const catalog = await readPackageCatalog(f.root), item = catalog.entries.find(item => item.id === f.record.id); assert.ok(item.problems.length);
  await assert.rejects(planExport(f.root, { kind: 'resources', ids: [f.record.id], revision: catalog.revision }), { errorCode: 'resource_package_failed' });
  const archive = path.join(f.directory, 'unfinished.viento.zip'); await writeExportZip(await planExport(f.root, { kind: 'workspace' }), archive);
  assert.equal((await zipEntries(archive)).get(recipePath).toString('utf8'), unfinished);
  assert.throws(() => expandSceneComposition(unfinished), { errorCode: 'scene_composition_invalid' });
  await save(f, f.content); assert.deepEqual((await readPackageCatalog(f.root)).entries.find(item => item.id === f.record.id).problems, []);
  await assertRecordUnchanged(f);
});
test('catalog diagnoses self, nested recipe, missing definition, wrong-kind image and malformed Unicode without changing author files', async t => {
  const f = await fixture(t), nestedPath = 'documents/scenes/nested.json';
  await f.store.writeDoc({ path: nestedPath, content: f.content, create: true, documentType: 'scene' });
  const nestedId = (await readRegistry(f.root)).documents.find(item => item.sourcePath === nestedPath).id;
  const cases = [recipe => { recipe.fragments[1].actors[0].objectId = f.record.id; }, recipe => { recipe.fragments[1].actors[0].objectId = nestedId; },
    recipe => { recipe.fragments[1].actors[0].objectId = '99999999-1111-4111-8111-111111111111'; }, recipe => { recipe.fragments[1].actors[0].imageResourceId = actorId; }];
  for (const mutate of cases) {
    const recipe = structuredClone(f.recipe); mutate(recipe); await save(f, serialize(recipe)); const before = await inventory(f.root);
    assert.ok((await readPackageCatalog(f.root)).entries.find(item => item.id === f.record.id).problems.length); assert.deepEqual(await inventory(f.root), before);
  }
  const assetPath = path.join(f.root, `metadata/assets/${f.images.unused}.json`), originalAsset = await fs.readFile(assetPath);
  const wrongKind = JSON.parse(originalAsset); wrongKind.kind = 'audio'; await fs.writeFile(assetPath, json(wrongKind));
  await save(f, f.content);
  assert.ok((await readPackageCatalog(f.root)).entries.find(item => item.id === f.record.id).problems.length, 'an existing non-image asset cannot satisfy an image reference');
  await fs.writeFile(assetPath, originalAsset);
  const bytes = Buffer.from(f.content); bytes[bytes.indexOf(Buffer.from('Two parties'))] = 0xff; await fs.writeFile(path.join(f.root, recipePath), bytes);
  assert.ok((await readPackageCatalog(f.root)).entries.find(item => item.id === f.record.id).problems.length);
  await assertRecordUnchanged(f);
});

test('registered CLI reads current source with optimistic revision and logical origin, emits a detached result and makes no writes', async t => {
  const f = await fixture(t), before = await inventory(f.root), revision = `sha256:${hash(f.content)}`;
  const args = ['--root', f.root, '--object', f.record.id], direct = await runSceneComposeCommand(args);
  assert.deepEqual(direct, expandSceneComposition(f.content).scene);
  const bundle = await runSceneComposeCommand([...args, '--revision', revision, '--emit', 'bundle']);
  assert.equal(bundle.format, 'viento-scene-composition-result'); assert.equal(bundle.schemaVersion, 1); assert.equal(bundle.sourceRevision, revision);
  assert.deepEqual(bundle.scene, direct); assert.deepEqual(bundle.sourceMap, expandSceneComposition(f.content).sourceMap);
  const world = await readWorldProjection(f.root);
  assert.deepEqual(bundle.origin, { kind: 'registered-document', objectId: f.record.id, sourcePath: recipePath, worldId: world.world.id, worldRevision: world.world.revision });
  assert.equal(JSON.stringify(bundle).includes(f.root), false);
  const cli = new URL('../scene-compose.mjs', import.meta.url).pathname;
  const processResult = await run(process.execPath, [cli, ...args, '--revision', revision, '--emit', 'bundle'], { timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.equal(processResult.stderr, ''); assert.deepEqual(JSON.parse(processResult.stdout), bundle);
  assert.deepEqual(await inventory(f.root), before);
  await save(f, f.content.replace('Two parties', 'Changed parties'));
  await assert.rejects(runSceneComposeCommand([...args, '--revision', revision]), error => error.errorCode === 'scene_composition_revision_conflict');
  assert.equal((await runSceneComposeCommand(args)).title, 'Changed parties / 两支队伍 / 二つの隊'); await assertRecordUnchanged(f);
});
test('registered CLI rejects mode confusion, unknown document and incomplete source dependencies without creating a baked scene', async t => {
  const f = await fixture(t), args = ['--root', f.root, '--object', f.record.id];
  for (const input of [['--root', f.root], ['--object', f.record.id], [...args, '--input', path.join(f.root, recipePath)],
    ['--input', path.join(f.root, recipePath), '--revision', `sha256:${hash(f.content)}`]]) {
    await assert.rejects(runSceneComposeCommand(input), { errorCode: 'scene_composition_arguments' });
  }
  await assert.rejects(runSceneComposeCommand(['--root', f.root, '--object', '99999999-1111-4111-8111-111111111111']), error => typeof error.errorCode === 'string');
  const changed = structuredClone(f.recipe); changed.fragments[1].actors[0].objectId = '99999999-1111-4111-8111-111111111111';
  await save(f, serialize(changed)); const before = await inventory(f.root);
  await assert.rejects(runSceneComposeCommand(args), error => typeof error.errorCode === 'string' && error.errorCode.startsWith('scene_composition_'));
  assert.deepEqual(await inventory(f.root), before); await assertRecordUnchanged(f);
});
test('complete native archive restore and re-export retain recipe bytes, logical identity and empty authored dependency metadata', {
  skip: !archiveBinary && 'Set VIENTO_TEST_ARCHIVE_BINARY for native recipe archive roundtrip.', timeout: 120000,
}, async t => {
  const f = await fixture(t), before = await inventory(f.root), incoming = path.join(f.directory, 'desktop.viento.zip');
  await writeExportZip(await planExport(f.root, { kind: 'workspace' }), incoming);
  const original = await zipEntries(incoming), manifest = JSON.parse(original.get('manifest.json')), parent = path.join(f.directory, 'restored'); await fs.mkdir(parent);
  const first = await native('import', incoming, parent);
  for (const entry of manifest.files) assert.deepEqual(await fs.readFile(path.join(first.root, entry.path)), original.get(entry.path), entry.path);
  assert.deepEqual(await fs.readFile(path.join(first.root, f.recordPath)), f.recordBytes);
  assert.deepEqual(await runSceneComposeCommand(['--root', first.root, '--object', f.record.id]), expandSceneComposition(f.content).scene);
  const outgoing = path.join(f.directory, 'native.viento.zip'); await native('export', first.root, outgoing);
  const second = await native('import', outgoing, parent);
  assert.equal(await fs.readFile(path.join(second.root, recipePath), 'utf8'), f.content);
  assert.deepEqual((await readRegistry(second.root)).documents.find(item => item.id === f.record.id), f.record);
  assert.deepEqual(await inventory(f.root), before);
});
test('desktop recipe archive crosses native mobile storage, ordinary mobile edit and desktop restore without losing references or identities', {
  skip: (!archiveBinary || !mobileBinary) && 'Set VIENTO_TEST_ARCHIVE_BINARY and VIENTO_MOBILE_STORE_BIN for native mobile storage roundtrip.', timeout: 120000,
}, async t => {
  const f = await fixture(t), before = await inventory(f.root), incoming = path.join(f.directory, 'to-mobile.viento.zip');
  await writeExportZip(await planExport(f.root, { kind: 'workspace' }), incoming);
  const library = await nativeMobileLibrary(mobileBinary, path.join(f.directory, 'mobile'));
  try {
    const call = (action, args = {}) => library.invoke('mobile_storage', { action, ...args });
    const workspace = await call('importArchive', { path: incoming });
    const read = await call('read', { workspaceId: workspace.id, path: recipePath }); assert.equal(read.content, f.content);
    const edited = f.content.replace('Two parties', 'Mobile parties');
    await call('save', { workspaceId: workspace.id, payload: { path: recipePath, content: edited, expectedVersion: read.version } });
    await assert.rejects(call('save', { workspaceId: workspace.id, payload: { path: recipePath, content: f.content, expectedVersion: read.version } }), error => error.statusCode === 409);
    const outgoing = path.join(f.directory, 'from-mobile.viento.zip'); await call('exportArchive', { workspaceId: workspace.id, path: outgoing });
    const parent = path.join(f.directory, 'mobile-restored'); await fs.mkdir(parent); const restored = await native('import', outgoing, parent);
    assert.equal(await fs.readFile(path.join(restored.root, recipePath), 'utf8'), edited);
    assert.deepEqual(await fs.readFile(path.join(restored.root, f.recordPath)), f.recordBytes);
    assert.deepEqual(await readRegistry(restored.root), await readRegistry(f.root));
    assert.deepEqual(await runSceneComposeCommand(['--root', restored.root, '--object', f.record.id]), expandSceneComposition(edited).scene);
    const catalog = await readPackageCatalog(restored.root); assert.deepEqual(catalog.entries.find(item => item.id === f.record.id).problems, []);
    assert.deepEqual(await inventory(f.root), before);
  } finally { await library.close(); }
});
test('registered recipe explicitly bakes through scene.create and real Godot while recipe source and metadata remain unchanged', {
  skip: !godot && 'Set VIENTO_GODOT_BIN for registered recipe bake/build/run.', timeout: 120000,
}, async t => {
  const f = await fixture(t), scene = await runSceneComposeCommand(['--root', f.root, '--object', f.record.id]), world = await readWorldProjection(f.root);
  const id = randomUUID(); await createWorldCommandService(f.root)({ command: 'scene.create', mode: 'apply', worldId: world.world.id, baseRevision: world.world.revision,
    actorRef: { kind: 'tool', id: 'recipe-explicit-bake-test' }, objectId: id, documentType: 'scene', sourcePath: 'documents/scenes/baked.json', content: json(scene) });
  const before = await inventory(f.root), built = await buildProject({ root: f.root, scene: id, godot, output: path.join(f.directory, 'build') });
  assert.equal(built.ok, true, json(built)); const result = await runProjectBuild({ buildDirectory: built.buildDirectory, godot }); assert.equal(result.ok, true, json(result));
  const finished = result.record.events.find(item => item.event === 'finished');
  assert.deepEqual(finished.actors.map(actor => actor.instanceId), scene.actors.map(actor => actor.instanceId));
  assert.ok(finished.actors[0].position[0] > scene.actors[0].position[0]);
  assert.deepEqual(await inventory(f.root), before); assert.equal(await fs.readFile(path.join(f.root, recipePath), 'utf8'), f.content); await assertRecordUnchanged(f);
});
