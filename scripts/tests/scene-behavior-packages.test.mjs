import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import yazl from 'yazl';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { readPackageCatalog, packageDigest } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { readRegistry } from '../lib/workspace.mjs';

const ids = { scene: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', manifest: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', source: 'ffffffff-ffff-4fff-8fff-ffffffffffff' };
const manifestPath = 'documents/behaviors/demo.json', sourcePath = 'documents/scripts/checkpoint.txt';
async function root(t, empty = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-behavior-package-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.cp(new URL('../../examples/scene-behaviors/', import.meta.url), directory, { recursive: true });
  if (empty) {
    for (const name of ['documents', 'assets', 'metadata', '.viento']) await fs.rm(path.join(directory, name), { recursive: true, force: true });
    for (const name of ['documents', 'assets', 'metadata/documents', 'metadata/assets']) await fs.mkdir(path.join(directory, name), { recursive: true });
    const workspace = JSON.parse(await fs.readFile(path.join(directory, 'workspace.json'))); workspace.id = randomUUID();
    await fs.writeFile(path.join(directory, 'workspace.json'), JSON.stringify(workspace));
  }
  return directory;
}
async function exported(t, source, selected = [ids.scene], options = {}) {
  const catalog = await readPackageCatalog(source), plan = await planExport(source, { kind: 'resources', revision: catalog.revision, ids: selected, includeChildren: false, ...options });
  const output = path.join(source, `${randomUUID()}.zip`); await writeExportZip(plan, output);
  const staging = path.join(source, `.package-${randomUUID()}`); await fs.mkdir(staging);
  return unpackResourcePackage(output, staging);
}
async function editJson(root, relative, change) {
  const file = path.join(root, relative), value = JSON.parse(await fs.readFile(file)); change(value);
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}
async function rewritten(pack, source, change) {
  const manifest = structuredClone(pack.manifest), bodies = new Map();
  for (const file of manifest.files) bodies.set(file.path, await fs.readFile(path.join(pack.content, file.path)));
  await change(manifest, bodies);
  manifest.files = [...bodies].map(([path, bytes]) => ({ path, size: bytes.length, sha256: packageDigest(bytes) }));
  const zip = new yazl.ZipFile(), file = path.join(source, `${randomUUID()}.zip`), stage = path.join(source, `.package-${randomUUID()}`);
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
  for (const [name, bytes] of bodies) zip.addBuffer(bytes, name);
  const copied = pipeline(zip.outputStream, createWriteStream(file)); zip.end(); await copied; await fs.mkdir(stage);
  return { file, stage };
}

test('scene resource selection closes cyclic opt-in, manifest and script UUID dependencies', async t => {
  const source = await root(t), catalog = await readPackageCatalog(source);
  assert.deepEqual(catalog.entries.find(item => item.id === ids.manifest).problems, []);
  assert.ok(catalog.entries.find(item => item.id === ids.manifest).dependencies.includes(ids.source));
  const pack = await exported(t, source);
  assert.equal(pack.manifest.documents.length, 4); assert.equal(pack.manifest.assets.length, 1);
  assert.ok(pack.manifest.documents.some(item => item.id === ids.source));
  assert.deepEqual(await fs.readFile(path.join(pack.content, sourcePath)), await fs.readFile(path.join(source, sourcePath)));
});

test('selective round trip preserves original behavior bytes, identities and explicit execution relation', async t => {
  const source = await root(t), target = await root(t, true), pack = await exported(t, source);
  const preview = await planPackageImport(target, pack); assert.deepEqual(preview.summary.conflicts, []);
  await applyPackageImport(target, pack, preview.revision);
  const registry = await readRegistry(target), scene = registry.documents.find(item => item.id === ids.scene);
  assert.ok(scene.relations.some(relation => relation.kind === 'behavior' && relation.targetId === ids.manifest));
  assert.deepEqual(await fs.readFile(path.join(target, manifestPath)), await fs.readFile(path.join(source, manifestPath)));
  assert.deepEqual(await fs.readFile(path.join(target, sourcePath)), await fs.readFile(path.join(source, sourcePath)));
});

test('body-derived dependencies cannot be concealed by deleting metadata edges', async t => {
  const source = await root(t);
  await editJson(source, `metadata/documents/${ids.manifest}.json`, value => { value.relations = value.relations.filter(item => item.targetId !== ids.source); });
  const catalog = await readPackageCatalog(source), entry = catalog.entries.find(item => item.id === ids.manifest);
  assert.ok(entry.dependencies.includes(ids.source)); assert.ok(entry.problems.length);
  await assert.rejects(planExport(source, { kind: 'resources', revision: catalog.revision, ids: [ids.scene] }), /解析|导出|资源/);
  assert.ok((await fs.readFile(path.join(source, manifestPath), 'utf8')).includes('viento-scene-behaviors'), 'Rejected selective export preserves editable source');
});

test('catalog refuses wrong instances, unfinished recognized manifests and oversized UTF-8 scripts', async t => {
  for (const alter of [async source => editJson(source, manifestPath, value => { value.bindings[0].instanceId = randomUUID(); }),
    async source => fs.writeFile(path.join(source, manifestPath), '{"format":"viento-scene-behaviors",'),
    async source => fs.writeFile(path.join(source, sourcePath), '中'.repeat(22000))]) {
    const source = await root(t); await alter(source);
    assert.ok((await readPackageCatalog(source)).entries.find(item => item.id === ids.manifest).problems.length);
  }
});

test('checksum-correct reader rejects a manifest whose source UUID or registered reference edge is erased', async t => {
  const source = await root(t), pack = await exported(t, source);
  for (const alter of [(manifest, bodies) => {
    const file = `metadata/documents/${ids.manifest}.json`, record = JSON.parse(bodies.get(file)); record.relations = [];
    bodies.set(file, Buffer.from(JSON.stringify(record)));
  }, (manifest, bodies) => {
    manifest.documents = manifest.documents.filter(item => item.id !== ids.source);
    bodies.delete(sourcePath); bodies.delete(`metadata/documents/${ids.source}.json`);
    const file = `metadata/documents/${ids.manifest}.json`, record = JSON.parse(bodies.get(file)); record.relations = record.relations.filter(item => item.targetId !== ids.source);
    bodies.set(file, Buffer.from(JSON.stringify(record)));
  }]) {
    const rewrite = await rewritten(pack, source, alter); await assert.rejects(unpackResourcePackage(rewrite.file, rewrite.stage), /资源包格式/);
  }
});

test('checksum-correct reader validates included scene instance membership and script byte budgets', async t => {
  const source = await root(t), pack = await exported(t, source);
  for (const alter of [(manifest, bodies) => { bodies.set(sourcePath, Buffer.from('中'.repeat(22000))); }, (manifest, bodies) => {
    const value = JSON.parse(bodies.get(manifestPath)); value.bindings[0].instanceId = randomUUID(); bodies.set(manifestPath, Buffer.from(JSON.stringify(value)));
  }]) {
    const rewrite = await rewritten(pack, source, alter); await assert.rejects(unpackResourcePackage(rewrite.file, rewrite.stage), /资源包格式/);
  }
});

test('pinned requirements defer unavailable bytes during reading and revalidate exact scene/script targets on import', async t => {
  const source = await root(t), target = await root(t, true), pack = await exported(t, source, [ids.manifest], { includeDependencies: false });
  assert.equal(pack.manifest.documents.length, 1); assert.equal(pack.manifest.requirements.length, 2);
  assert.ok((await planPackageImport(target, pack)).summary.conflicts.some(item => item.reason === 'dependency'));
  const existing = await root(t);
  assert.deepEqual((await planPackageImport(existing, pack)).summary.conflicts, []);
  await fs.writeFile(path.join(existing, sourcePath), '# Changed registered script\n');
  assert.ok((await planPackageImport(existing, pack)).summary.conflicts.some(item => item.reason === 'dependency'));
});

test('already unpacked package planning re-derives behavior references and cannot use unpinned ambient UUIDs', async t => {
  const source = await root(t), existing = await root(t), pack = await exported(t, source, [ids.manifest], { includeDependencies: false });
  pack.manifest.requirements = pack.manifest.requirements.filter(item => item.id !== ids.source);
  assert.ok((await planPackageImport(existing, pack)).summary.conflicts.some(item => item.reason === 'dependency'));
  const fresh = await exported(t, source);
  await editJson(fresh.content, manifestPath, value => { value.bindings[0].instanceId = randomUUID(); });
  assert.ok((await planPackageImport(await root(t, true), fresh)).summary.conflicts.some(item => item.reason === 'dependency'));
  const omittedActor = await exported(t, source), scene = JSON.parse(await fs.readFile(path.join(omittedActor.content, 'documents/scenes/demo.json')));
  omittedActor.manifest.documents = omittedActor.manifest.documents.filter(item => item.id !== scene.actors[0].objectId);
  assert.ok((await planPackageImport(existing, omittedActor)).summary.conflicts.some(item => item.reason === 'dependency'), 'An included scene cannot borrow an undeclared ambient actor');
  const malformedActors = await exported(t, source);
  await editJson(malformedActors.content, 'documents/scenes/demo.json', value => { value.actors = { find: 1 }; });
  assert.ok((await planPackageImport(await root(t, true), malformedActors)).summary.conflicts.some(item => item.reason === 'dependency'), 'Malformed actor collections return dependency diagnostics rather than invoking nonfunctions');
});

test('checksum-correct scene and matching binding cannot introduce an unregistered actor definition in reader or import', async t => {
  const source = await root(t), pack = await exported(t, source), scenePath = 'documents/scenes/demo.json';
  const instanceId = randomUUID(), phantomObjectId = randomUUID();
  const alter = (manifest, bodies) => {
    const scene = JSON.parse(bodies.get(scenePath)), behavior = JSON.parse(bodies.get(manifestPath));
    scene.actors[0].objectId = phantomObjectId; scene.actors[0].instanceId = instanceId;
    behavior.bindings[0].instanceId = instanceId;
    bodies.set(scenePath, Buffer.from(JSON.stringify(scene))); bodies.set(manifestPath, Buffer.from(JSON.stringify(behavior)));
  };
  const rewrite = await rewritten(pack, source, alter);
  await assert.rejects(unpackResourcePackage(rewrite.file, rewrite.stage), /资源包格式/);
  await editJson(pack.content, scenePath, value => { value.actors[0].objectId = phantomObjectId; value.actors[0].instanceId = instanceId; });
  await editJson(pack.content, manifestPath, value => { value.bindings[0].instanceId = instanceId; });
  assert.ok((await planPackageImport(await root(t, true), pack)).summary.conflicts.some(item => item.reason === 'dependency'));
});

test('removing only the scene-to-bound-actor edge rejects checksum-correct reader and direct import planning', async t => {
  const source = await root(t), pack = await exported(t, source), file = `metadata/documents/${ids.scene}.json`;
  const record = JSON.parse(await fs.readFile(path.join(pack.content, file))), scene = JSON.parse(await fs.readFile(path.join(pack.content, 'documents/scenes/demo.json')));
  record.relations = record.relations.filter(relation => relation.targetId !== scene.actors[0].objectId);
  const raw = Buffer.from(JSON.stringify(record)), rewrite = await rewritten(pack, source, (manifest, bodies) => bodies.set(file, raw));
  await assert.rejects(unpackResourcePackage(rewrite.file, rewrite.stage), /资源包格式/);
  pack.records.set(ids.scene, { record, raw });
  assert.ok((await planPackageImport(await root(t, true), pack)).summary.conflicts.some(item => item.reason === 'dependency'));
});
