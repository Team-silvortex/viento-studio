import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { readPackageCatalog, packageDigest } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { readRegistry } from '../lib/workspace.mjs';

const ids = { scene: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', suite: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  first: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', second: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  definition: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', instance: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' };
const scenePath = 'documents/scenes/demo.json', suitePath = 'documents/suites/release.json';
const paths = { [ids.first]: 'documents/cases/first.json', [ids.second]: 'documents/cases/second.json' };
const released = () => ({ left: false, right: false, up: false, down: false });
const suite = () => ({ format: 'viento-runtime-case-suite', schemaVersion: 1, sceneObjectId: ids.scene,
  documentIds: [ids.second, ids.first] });
const member = (schemaVersion = 1) => ({ format: 'viento-runtime-case-document', schemaVersion: 1, sceneObjectId: ids.scene,
  case: { format: 'viento-runtime-case', schemaVersion: 1,
    program: { format: 'viento-runtime-control', schemaVersion, fixedDelta: 0.125,
      steps: schemaVersion === 1 ? [released(), released()] : [{ inputs: [] }, { inputs: [] }] },
    checks: [{ instanceId: ids.instance, stepIndex: 1, position: { value: [200, 220], tolerance: 0 }, state: 'idle' }] } });
async function write(root, file, bytes) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), bytes);
}
async function edit(root, file, change) {
  const value = JSON.parse((await fs.readFile(path.join(root, file), 'utf8')).replace(/^\uFEFF/, ''));
  change(value); await write(root, file, JSON.stringify(value, null, 2) + '\n');
}
async function register(root, id, sourcePath, documentType, value) {
  await write(root, sourcePath, '\uFEFF' + JSON.stringify(value, null, 2).replace(/\n/g, '\r\n') + '\r\n');
  await write(root, `metadata/documents/${id}.json`, JSON.stringify({ format: 'viento-document', version: 1,
    id, sourcePath, documentType, parserProfile: 'structured', relations: [], assetBindings: [] }, null, 2) + '\n');
}
async function fixture(t, { empty = false, includeSuite = true, includeMembers = true, legacy = false } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-runtime-suite-package-')), root = path.join(base, 'workspace');
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await fs.cp(new URL('../../examples/bevy-headless/', import.meta.url), root, { recursive: true });
  await edit(root, 'workspace.json', value => {
    value.id = randomUUID(); value.documentTypes.push({ id: 'case', label: 'Case', directory: 'cases', parserProfile: 'structured' },
      { id: 'suite', label: 'Suite', directory: 'suites', parserProfile: 'structured' });
    if (legacy) { value.version = 2; value.paths.documents = 'design-data'; value.paths.templates = 'data-template'; }
  });
  if (empty) {
    for (const name of ['documents', 'metadata', 'assets', '.viento']) await fs.rm(path.join(root, name), { recursive: true, force: true });
    for (const name of ['documents', 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(root, name), { recursive: true });
  } else {
    if (includeMembers) {
      await register(root, ids.first, paths[ids.first], 'case', member(1));
      await register(root, ids.second, paths[ids.second], 'case', member(2));
    }
    if (includeSuite) await register(root, ids.suite, suitePath, 'suite', suite());
  }
  if (legacy) { await fs.rename(path.join(root, 'documents'), path.join(root, 'design-data')); await fs.rename(path.join(root, 'templates'), path.join(root, 'data-template')); }
  return { root, base };
}
async function exported(h, selected = [ids.suite], options = {}) {
  const catalog = await readPackageCatalog(h.root), plan = await planExport(h.root, { kind: 'resources', revision: catalog.revision, ids: selected, ...options });
  const file = path.join(h.base, `${randomUUID()}.zip`), stage = path.join(h.base, `unpacked-${randomUUID()}`);
  await writeExportZip(plan, file); await fs.mkdir(stage); return unpackResourcePackage(file, stage);
}
async function rewritten(h, pack, change) {
  const manifest = structuredClone(pack.manifest), bodies = new Map();
  for (const file of manifest.files) bodies.set(file.path, await fs.readFile(path.join(pack.content, file.path)));
  await change(manifest, bodies);
  manifest.files = [...bodies].map(([path, bytes]) => ({ path, size: bytes.length, sha256: packageDigest(bytes) }));
  const zip = new yazl.ZipFile(), file = path.join(h.base, `${randomUUID()}.zip`), stage = path.join(h.base, `forged-${randomUUID()}`);
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json'); for (const [name, bytes] of bodies) zip.addBuffer(bytes, name);
  const written = pipeline(zip.outputStream, createWriteStream(file)); zip.end(); await written; await fs.mkdir(stage); return { file, stage, manifest };
}
const changedBody = (bodies, file, change) => {
  const value = JSON.parse(bodies.get(file).toString('utf8').replace(/^\uFEFF/, '')); change(value); bodies.set(file, Buffer.from(JSON.stringify(value)));
};
async function inventory(root) {
  const result = {};
  for (const item of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (item.isFile()) {
    const absolute = path.join(item.parentPath, item.name), relative = path.relative(root, absolute);
    if (!relative.startsWith('.viento/')) result[relative] = packageDigest(await fs.readFile(absolute));
  }
  return result;
}

test('suite dependencies and optional scene children derive from source without metadata changes or duplicate identities', async t => {
  const h = await fixture(t), before = await inventory(h.root), catalog = await readPackageCatalog(h.root);
  const group = catalog.entries.find(item => item.id === ids.suite);
  assert.deepEqual(group.problems, []); assert.deepEqual(new Set(group.dependencies), new Set([ids.scene, ids.first, ids.second]));
  assert.deepEqual(new Set(catalog.entries.find(item => item.id === ids.scene).children), new Set([ids.suite, ids.first, ids.second]));
  assert.deepEqual(await inventory(h.root), before);
  for (const id of [ids.suite, ids.first]) await edit(h.root, `metadata/documents/${id}.json`, value => { value.relations.push({ kind: 'part-of', targetId: ids.scene }); });
  const children = (await readPackageCatalog(h.root)).entries.find(item => item.id === ids.scene).children;
  assert.equal(children.length, 3); assert.equal(new Set(children).size, 3);
});

test('suite selection closes members scene and definitions while disabling scene children omits optional suites and cases', async t => {
  const h = await fixture(t);
  for (const selected of [[ids.suite], [ids.scene]]) {
    const pack = await exported(h, selected); assert.deepEqual(new Set(pack.manifest.documents.map(item => item.id)), new Set(Object.values(ids).filter(id => id !== ids.instance)));
    assert.equal(pack.manifest.requirements.length, 0);
  }
  const withoutChildren = await exported(h, [ids.scene], { includeChildren: false });
  assert.deepEqual(new Set(withoutChildren.manifest.documents.map(item => item.id)), new Set([ids.scene, ids.definition]));
  const explicitSuite = await exported(h, [ids.suite], { includeChildren: false }); assert.equal(explicitSuite.manifest.documents.length, 5);
});

test('suite round trips preserve member order stable identities BOM CRLF and exact scene bytes', async t => {
  const h = await fixture(t), target = await fixture(t, { empty: true }), before = await inventory(h.root), pack = await exported(h);
  const preview = await planPackageImport(target.root, pack); assert.deepEqual(preview.summary.conflicts, []); await applyPackageImport(target.root, pack, preview.revision);
  for (const file of [suitePath, ...Object.values(paths), scenePath]) assert.deepEqual(await fs.readFile(path.join(target.root, file)), await fs.readFile(path.join(h.root, file)), file);
  assert.deepEqual(JSON.parse((await fs.readFile(path.join(target.root, suitePath), 'utf8')).replace(/^\uFEFF/, '')).documentIds, suite().documentIds);
  const registry = await readRegistry(target.root); assert.equal(registry.documents.length, 5); assert.deepEqual(registry.documents.find(item => item.id === ids.suite).relations, []);
  assert.deepEqual(await inventory(h.root), before);
});

test('v3 to v2 path migration changes only registrations while suite and members keep original UUID and source bytes', async t => {
  const h = await fixture(t), target = await fixture(t, { empty: true, legacy: true }), pack = await exported(h);
  const preview = await planPackageImport(target.root, pack); assert.deepEqual(preview.summary.conflicts, []); await applyPackageImport(target.root, pack, preview.revision);
  for (const file of [suitePath, ...Object.values(paths), scenePath]) {
    assert.deepEqual(await fs.readFile(path.join(target.root, file.replace(/^documents\//, 'design-data/'))), await fs.readFile(path.join(h.root, file)));
  }
  assert.equal((await readRegistry(target.root)).documents.find(item => item.id === ids.suite).sourcePath, 'design-data/suites/release.json');
});

test('excluded suite dependencies are exact scene and member requirements and matching existing targets import without cloning', async t => {
  const h = await fixture(t), target = await fixture(t, { includeSuite: false }), empty = await fixture(t, { empty: true });
  const pack = await exported(h, [ids.suite], { includeDependencies: false, includeChildren: false });
  assert.equal(pack.manifest.documents.length, 1); assert.deepEqual(new Set(pack.manifest.requirements.map(item => item.id)), new Set([ids.scene, ids.first, ids.second]));
  assert.ok((await planPackageImport(empty.root, pack)).summary.conflicts.some(item => item.reason === 'dependency'));
  const preview = await planPackageImport(target.root, pack); assert.deepEqual(preview.summary.conflicts, []); await applyPackageImport(target.root, pack, preview.revision);
  assert.deepEqual(await fs.readFile(path.join(target.root, suitePath)), await fs.readFile(path.join(h.root, suitePath)));
});

test('included scene with required members and definitions defers only their unavailable bodies', async t => {
  const h = await fixture(t), target = await fixture(t, { includeSuite: false });
  const pack = await exported(h, [ids.suite, ids.scene], { includeDependencies: false, includeChildren: false });
  assert.deepEqual(new Set(pack.manifest.requirements.map(item => item.id)), new Set([ids.first, ids.second, ids.definition]));
  assert.deepEqual((await planPackageImport(target.root, pack)).summary.conflicts, []);
  pack.manifest.requirements = pack.manifest.requirements.filter(item => item.id !== ids.first);
  assert.ok((await planPackageImport(target.root, pack)).summary.conflicts.some(item => item.reason === 'dependency'));
});

test('changed required member source and post-preview target changes reject publication without author writes', async t => {
  const h = await fixture(t), target = await fixture(t, { includeSuite: false }), pack = await exported(h, [ids.suite], { includeDependencies: false, includeChildren: false });
  const preview = await planPackageImport(target.root, pack); assert.deepEqual(preview.summary.conflicts, []);
  await fs.appendFile(path.join(target.root, paths[ids.first]), ' \n'); const before = await inventory(target.root);
  assert.ok((await planPackageImport(target.root, pack)).summary.conflicts.some(item => item.reason === 'dependency'));
  await assert.rejects(applyPackageImport(target.root, pack, preview.revision), /冲突|变化/); assert.deepEqual(await inventory(target.root), before);
  await assert.rejects(fs.stat(path.join(target.root, suitePath)), { code: 'ENOENT' });
});

test('hash-matching required members still reject cross-scene bindings or incorrect instance targets', async t => {
  for (const change of [value => { value.sceneObjectId = randomUUID(); }, value => { value.case.checks[0].instanceId = ids.definition; }]) {
    const h = await fixture(t), target = await fixture(t, { includeSuite: false }), pack = await exported(h, [ids.suite], { includeDependencies: false, includeChildren: false });
    await edit(target.root, paths[ids.first], change); const bytes = await fs.readFile(path.join(target.root, paths[ids.first]));
    pack.manifest.requirements.find(item => item.id === ids.first).content = { size: bytes.length, sha256: packageDigest(bytes) };
    const before = await inventory(target.root), preview = await planPackageImport(target.root, pack);
    assert.ok(preview.summary.conflicts.some(item => item.path === suitePath && item.reason === 'dependency'));
    await assert.rejects(applyPackageImport(target.root, pack, preview.revision), /冲突/); assert.deepEqual(await inventory(target.root), before);
  }
});

test('checksum-correct archives cannot conceal suite member or scene declarations or borrow unpinned ambient documents', async t => {
  const h = await fixture(t), pack = await exported(h), target = await fixture(t, { includeSuite: false });
  for (const missing of [ids.first, ids.scene]) {
    const forged = await rewritten(h, pack, (manifest, bodies) => {
      manifest.documents = manifest.documents.filter(item => item.id !== missing);
      bodies.delete(missing === ids.scene ? scenePath : paths[missing]); bodies.delete(`metadata/documents/${missing}.json`);
    });
    await assert.rejects(unpackResourcePackage(forged.file, forged.stage), /资源包格式/);
  }
  pack.manifest.documents = pack.manifest.documents.filter(item => item.id !== ids.first);
  assert.ok((await planPackageImport(target.root, pack)).summary.conflicts.some(item => item.path === suitePath && item.reason === 'dependency'));
});

test('checksum-correct reader rejects bad members cross-scene wrappers self references and included scene errors', async t => {
  const h = await fixture(t), pack = await exported(h);
  for (const [file, change] of [[paths[ids.first], value => { value.sceneObjectId = randomUUID(); }],
    [paths[ids.first], value => { value.format = 'ordinary-json'; }],
    [suitePath, value => { value.documentIds[0] = ids.suite; }],
    [suitePath, value => { value.documentIds[0] = ids.scene; }],
    [suitePath, value => { value.documentIds.push(value.documentIds[0]); }],
    [scenePath, value => { value.schemaVersion = 1; }],
    [`metadata/documents/${ids.scene}.json`, value => { value.relations = []; }]]) {
    const forged = await rewritten(h, pack, (manifest, bodies) => changedBody(bodies, file, change));
    await assert.rejects(unpackResourcePackage(forged.file, forged.stage), /资源包格式/);
  }
});

test('known included scene errors cannot be deferred merely because all suite members are declared requirements', async t => {
  const h = await fixture(t), pack = await exported(h, [ids.suite, ids.scene], { includeDependencies: false, includeChildren: false });
  for (const change of [value => { value.actors = {}; }, value => { value.format = 'viento-scene-composition'; },
    value => { value.schemaVersion = 1; }, value => { value.actors[1].instanceId = value.actors[0].instanceId; }]) {
    const forged = await rewritten(h, pack, (manifest, bodies) => changedBody(bodies, scenePath, change));
    await assert.rejects(unpackResourcePackage(forged.file, forged.stage), /资源包格式/);
  }
  const behavior = await rewritten(h, pack, (manifest, bodies) => changedBody(bodies, `metadata/documents/${ids.scene}.json`,
    value => { value.relations.push({ kind: 'behavior', targetId: ids.first }); }));
  await assert.rejects(unpackResourcePackage(behavior.file, behavior.stage), /资源包格式/);
});

test('unfinished oversized extra-field non-JSON and invalid UTF-8 suite documents remain editable but cannot export selectively', async t => {
  for (const change of [h => write(h.root, suitePath, '{"format":"viento-runtime-case-suite",'),
    h => edit(h.root, suitePath, value => { value.engine = 'godot'; }),
    h => write(h.root, suitePath, JSON.stringify(suite()) + ' '.repeat(16384)),
    h => write(h.root, suitePath, Buffer.concat([Buffer.from(JSON.stringify(suite()) + '\n'), Buffer.from([0xff])])),
    async h => { const next = suitePath.replace(/\.json$/, '.md'); await fs.rename(path.join(h.root, suitePath), path.join(h.root, next));
      await edit(h.root, `metadata/documents/${ids.suite}.json`, value => { value.sourcePath = next; }); }]) {
    const h = await fixture(t); await change(h); const catalog = await readPackageCatalog(h.root), before = await inventory(h.root);
    assert.ok(catalog.entries.find(item => item.id === ids.suite).problems.length);
    await assert.rejects(planExport(h.root, { kind: 'resources', revision: catalog.revision, ids: [ids.suite] }), /资源|解析|导出/);
    assert.deepEqual(await inventory(h.root), before);
  }
});

test('aggregate suite actor-step budgets are enforced even when every individual case is valid', async t => {
  const h = await fixture(t);
  await edit(h.root, scenePath, value => { value.actors = Array.from({ length: 16 }, (_, index) => ({ ...value.actors[0],
    instanceId: index === 0 ? ids.instance : `abababab-abab-4bab-8bab-${index.toString(16).padStart(12, '0')}` })); });
  const documentIds = [];
  for (let index = 0; index < 8; index++) {
    const id = randomUUID(), file = `documents/cases/large-${index}.json`, value = member();
    value.case.program.steps = Array.from({ length: 64 }, released); value.case.checks[0].stepIndex = 63;
    await register(h.root, id, file, 'case', value); documentIds.push(id);
  }
  await edit(h.root, suitePath, value => { value.documentIds = documentIds; });
  const catalog = await readPackageCatalog(h.root);
  for (const id of documentIds) assert.deepEqual(catalog.entries.find(item => item.id === id).problems, []);
  assert.ok(catalog.entries.find(item => item.id === ids.suite).problems.length);
  await assert.rejects(planExport(h.root, { kind: 'resources', revision: catalog.revision, ids: [ids.suite] }), /资源|解析|导出/);
  const pack = await exported(h, documentIds, { includeChildren: false });
  const registration = JSON.parse(await fs.readFile(path.join(h.root, `metadata/documents/${ids.suite}.json`)));
  const forged = await rewritten(h, pack, async (manifest, bodies) => {
    manifest.documents.push({ id: ids.suite, sourcePath: suitePath,
      definition: { ...manifest.documents.find(item => item.id === documentIds[0]).definition, documentType: 'suite' } });
    const { content, templateSource, ...type } = catalog.types.find(item => item.id === 'suite'); manifest.types.push(type);
    manifest.roots.push(ids.suite);
    bodies.set(suitePath, await fs.readFile(path.join(h.root, suitePath)));
    bodies.set(`metadata/documents/${ids.suite}.json`, await fs.readFile(path.join(h.root, `metadata/documents/${ids.suite}.json`)));
  });
  await assert.rejects(unpackResourcePackage(forged.file, forged.stage), /资源包格式/);
  const direct = { ...pack, content: path.join(forged.stage, 'content'), manifest: forged.manifest,
    files: new Map(forged.manifest.files.map(file => [file.path, file])), records: new Map(pack.records) };
  direct.records.set(ids.suite, { record: registration, raw: Buffer.from(JSON.stringify(registration)) });
  assert.ok((await planPackageImport((await fixture(t, { empty: true })).root, direct)).summary.conflicts.some(item => item.path === suitePath && item.reason === 'dependency'));
});

test('full workspace archives preserve damaged suite author bytes and stable workspace identity', async t => {
  const h = await fixture(t), damaged = Buffer.from('{"format":"viento-runtime-case-suite",\r\n'); await write(h.root, suitePath, damaged);
  const plan = await planExport(h.root, { kind: 'workspace' }), file = path.join(h.base, 'workspace.zip'); await writeExportZip(plan, file);
  const zip = await yauzl.openPromise(file, { lazyEntries: true }); let found = false;
  try { for await (const entry of zip.eachEntry()) if (entry.fileName === suitePath) {
    const chunks = []; for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), damaged); found = true;
  } } finally { zip.close(); }
  assert.equal(found, true); assert.equal(plan.archiveManifest.workspace.id, JSON.parse(await fs.readFile(path.join(h.root, 'workspace.json'))).id);
});
