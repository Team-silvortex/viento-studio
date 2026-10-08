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

const ids = { scene: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', case: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  definition: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  first: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', second: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' };
const casePath = 'documents/cases/released.json', scenePath = 'documents/scenes/demo.json';
const released = () => ({ left: false, right: false, up: false, down: false });
const declaration = (schemaVersion = 2) => ({ format: 'viento-runtime-case-document', schemaVersion: 1, sceneObjectId: ids.scene,
  case: { format: 'viento-runtime-case', schemaVersion: 1,
    program: { format: 'viento-runtime-control', schemaVersion, fixedDelta: 0.125,
      steps: schemaVersion === 1 ? [released(), released()] : [{ inputs: [{ instanceId: ids.first, ...released() }] }, { inputs: [] }] },
    checks: [{ instanceId: ids.first, stepIndex: 1, position: { value: [200, 220], tolerance: 0 }, state: 'idle' },
      { instanceId: ids.second, stepIndex: 1, position: { value: [500, 220], tolerance: 0 }, state: 'idle' }] } });
async function write(root, file, content) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), content);
}
async function edit(root, file, change) {
  const value = JSON.parse((await fs.readFile(path.join(root, file), 'utf8')).replace(/^\uFEFF/, ''));
  change(value); await write(root, file, JSON.stringify(value, null, 2) + '\n');
}
async function fixture(t, { empty = false, includeCase = true, schemaVersion = 2, documents = 'documents' } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-runtime-case-package-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'workspace');
  await fs.cp(new URL('../../examples/bevy-headless/', import.meta.url), root, { recursive: true });
  await edit(root, 'workspace.json', workspace => {
    workspace.id = randomUUID(); workspace.documentTypes.push({ id: 'case', label: 'Runtime case', directory: 'cases', parserProfile: 'structured' });
    workspace.paths.documents = documents;
    if (documents !== 'documents') { workspace.version = 2; workspace.paths.templates = 'data-template'; }
  });
  if (documents !== 'documents') {
    await fs.rename(path.join(root, 'documents'), path.join(root, documents));
    await fs.rename(path.join(root, 'templates'), path.join(root, 'data-template'));
  }
  if (empty) {
    for (const name of [documents, 'metadata', 'assets', '.viento']) await fs.rm(path.join(root, name), { recursive: true, force: true });
    for (const name of [documents, 'metadata/documents', 'metadata/assets', 'assets']) await fs.mkdir(path.join(root, name), { recursive: true });
  } else if (includeCase) {
    // Exact author bytes, including BOM and CRLF, must survive path migration.
    await write(root, casePath, '\uFEFF' + JSON.stringify(declaration(schemaVersion), null, 2).replace(/\n/g, '\r\n') + '\r\n');
    await write(root, `metadata/documents/${ids.case}.json`, JSON.stringify({ format: 'viento-document', version: 1,
      id: ids.case, sourcePath: casePath, documentType: 'case', parserProfile: 'structured', relations: [], assetBindings: [] }, null, 2) + '\n');
  }
  return { root, base };
}
async function exported(h, selected = [ids.case], options = {}) {
  const catalog = await readPackageCatalog(h.root);
  const plan = await planExport(h.root, { kind: 'resources', revision: catalog.revision, ids: selected, ...options });
  const file = path.join(h.base, `${randomUUID()}.zip`), stage = path.join(h.base, `unpacked-${randomUUID()}`);
  await writeExportZip(plan, file); await fs.mkdir(stage);
  return unpackResourcePackage(file, stage);
}
async function rewrite(h, pack, change) {
  const manifest = structuredClone(pack.manifest), bodies = new Map();
  for (const file of manifest.files) bodies.set(file.path, await fs.readFile(path.join(pack.content, file.path)));
  await change(manifest, bodies);
  manifest.files = [...bodies].map(([path, bytes]) => ({ path, size: bytes.length, sha256: packageDigest(bytes) }));
  const zip = new yazl.ZipFile(), file = path.join(h.base, `${randomUUID()}.zip`), stage = path.join(h.base, `forged-${randomUUID()}`);
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
  for (const [name, bytes] of bodies) zip.addBuffer(bytes, name);
  const written = pipeline(zip.outputStream, createWriteStream(file)); zip.end(); await written; await fs.mkdir(stage);
  return { file, stage };
}
async function authorInventory(root) {
  const entries = {};
  for (const item of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (item.isFile()) {
    const absolute = path.join(item.parentPath, item.name), relative = path.relative(root, absolute);
    if (!relative.startsWith('.viento/')) entries[relative] = packageDigest(await fs.readFile(absolute));
  }
  return entries;
}

test('case source binds its scene without metadata edges and scene child discovery is bounded and deduplicated', async t => {
  const h = await fixture(t), before = await authorInventory(h.root), catalog = await readPackageCatalog(h.root);
  const entry = catalog.entries.find(item => item.id === ids.case), scene = catalog.entries.find(item => item.id === ids.scene);
  assert.deepEqual(entry.problems, []); assert.deepEqual(entry.dependencies, [ids.scene]); assert.deepEqual(scene.children, [ids.case]);
  assert.deepEqual((await readRegistry(h.root)).documents.find(item => item.id === ids.case).relations, []);
  assert.deepEqual(await authorInventory(h.root), before);
  await edit(h.root, `metadata/documents/${ids.case}.json`, value => { value.relations.push({ kind: 'part-of', targetId: ids.scene }); });
  assert.deepEqual((await readPackageCatalog(h.root)).entries.find(item => item.id === ids.scene).children, [ids.case]);
});

test('selection closes case-to-scene-to-definition dependencies and scene children remain optional', async t => {
  const h = await fixture(t), casePack = await exported(h), scenePack = await exported(h, [ids.scene]);
  for (const pack of [casePack, scenePack]) assert.deepEqual(new Set(pack.manifest.documents.map(item => item.id)), new Set([ids.case, ids.scene, ids.definition]));
  assert.equal(casePack.manifest.requirements.length, 0);
  const withoutChildren = await exported(h, [ids.scene], { includeChildren: false });
  assert.deepEqual(new Set(withoutChildren.manifest.documents.map(item => item.id)), new Set([ids.scene, ids.definition]));
});

test('global and instance case round trips preserve all identities and original author bytes', async t => {
  for (const schemaVersion of [1, 2]) {
    const h = await fixture(t, { schemaVersion }), target = await fixture(t, { empty: true }), before = await authorInventory(h.root), pack = await exported(h);
    const preview = await planPackageImport(target.root, pack); assert.deepEqual(preview.summary.conflicts, []);
    await applyPackageImport(target.root, pack, preview.revision);
    for (const file of [casePath, scenePath, 'documents/characters/traveler.md']) {
      assert.deepEqual(await fs.readFile(path.join(target.root, file)), await fs.readFile(path.join(h.root, file)), file);
    }
    const records = await readRegistry(target.root); assert.deepEqual(new Set(records.documents.map(item => item.id)), new Set([ids.case, ids.scene, ids.definition]));
    assert.deepEqual(records.documents.find(item => item.id === ids.case).relations, []);
    const saved = JSON.parse((await fs.readFile(path.join(target.root, casePath), 'utf8')).replace(/^\uFEFF/, ''));
    assert.deepEqual(saved, declaration(schemaVersion)); assert.deepEqual(await authorInventory(h.root), before);
  }
});

test('a different document root remaps only registered paths and preserves scene and case UUID bytes', async t => {
  const h = await fixture(t), target = await fixture(t, { empty: true, documents: 'design-data' }), pack = await exported(h);
  const preview = await planPackageImport(target.root, pack); assert.deepEqual(preview.summary.conflicts, []);
  await applyPackageImport(target.root, pack, preview.revision);
  const mapped = 'design-data/cases/released.json';
  assert.deepEqual(await fs.readFile(path.join(target.root, mapped)), await fs.readFile(path.join(h.root, casePath)));
  assert.deepEqual(await fs.readFile(path.join(target.root, 'design-data/scenes/demo.json')), await fs.readFile(path.join(h.root, scenePath)));
  const registration = (await readRegistry(target.root)).documents.find(item => item.id === ids.case);
  assert.equal(registration.sourcePath, mapped); assert.equal(registration.id, ids.case);
});

test('multiple cases sharing a scene retain one dependency identity and round trip both exact sources', async t => {
  const h = await fixture(t), secondId = randomUUID(), secondPath = 'documents/cases/second.json';
  await write(h.root, secondPath, JSON.stringify(declaration(1), null, 2) + '\n');
  await write(h.root, `metadata/documents/${secondId}.json`, JSON.stringify({ format: 'viento-document', version: 1,
    id: secondId, sourcePath: secondPath, documentType: 'case', parserProfile: 'structured', relations: [], assetBindings: [] }));
  const catalog = await readPackageCatalog(h.root);
  assert.deepEqual(new Set(catalog.entries.find(item => item.id === ids.scene).children), new Set([ids.case, secondId]));
  const pack = await exported(h, [ids.scene]), target = await fixture(t, { empty: true });
  assert.equal(pack.manifest.documents.length, 4);
  const preview = await planPackageImport(target.root, pack); assert.deepEqual(preview.summary.conflicts, []);
  await applyPackageImport(target.root, pack, preview.revision);
  for (const file of [casePath, secondPath]) assert.deepEqual(await fs.readFile(path.join(target.root, file)), await fs.readFile(path.join(h.root, file)));
});

test('pinned excluded scenes defer only unavailable bodies and must match actual target hashes at import', async t => {
  const h = await fixture(t), target = await fixture(t, { includeCase: false }), empty = await fixture(t, { empty: true });
  const pack = await exported(h, [ids.case], { includeDependencies: false, includeChildren: false });
  assert.equal(pack.manifest.documents.length, 1); assert.deepEqual(pack.manifest.requirements.map(item => item.id), [ids.scene]);
  assert.ok((await planPackageImport(empty.root, pack)).summary.conflicts.some(item => item.reason === 'dependency'));
  const preview = await planPackageImport(target.root, pack); assert.deepEqual(preview.summary.conflicts, []);
  await applyPackageImport(target.root, pack, preview.revision);
  assert.deepEqual(await fs.readFile(path.join(target.root, casePath)), await fs.readFile(path.join(h.root, casePath)));
  await edit(target.root, scenePath, value => { value.actors[0].instanceId = randomUUID(); });
  const before = await authorInventory(target.root), changed = await planPackageImport(target.root, pack);
  assert.ok(changed.summary.conflicts.some(item => item.reason === 'dependency'));
  await assert.rejects(applyPackageImport(target.root, pack, changed.revision), /冲突/);
  assert.deepEqual(await authorInventory(target.root), before);
});

test('included scenes may defer declared definition requirements but cannot borrow an undeclared ambient definition', async t => {
  const h = await fixture(t), target = await fixture(t, { includeCase: false });
  const pack = await exported(h, [ids.case, ids.scene], { includeDependencies: false, includeChildren: false });
  assert.deepEqual(pack.manifest.requirements.map(item => item.id), [ids.definition]);
  assert.deepEqual((await planPackageImport(target.root, pack)).summary.conflicts, []);
  pack.manifest.requirements = [];
  assert.ok((await planPackageImport(target.root, pack)).summary.conflicts.some(item => item.reason === 'dependency'));
});

test('a hash-matching required scene still cannot authorize checks for absent instances', async t => {
  const h = await fixture(t), target = await fixture(t, { includeCase: false });
  const pack = await exported(h, [ids.case], { includeDependencies: false, includeChildren: false });
  await edit(target.root, scenePath, value => { value.actors[0].instanceId = randomUUID(); });
  const bytes = await fs.readFile(path.join(target.root, scenePath));
  pack.manifest.requirements[0].content = { size: bytes.length, sha256: packageDigest(bytes) };
  const preview = await planPackageImport(target.root, pack);
  assert.ok(preview.summary.conflicts.some(item => item.path === casePath && item.reason === 'dependency'),
    'The scene hash matches; rejection must come from actual case-to-instance admission');
  const before = await authorInventory(target.root);
  await assert.rejects(applyPackageImport(target.root, pack, preview.revision), /冲突/);
  assert.deepEqual(await authorInventory(target.root), before);
});

test('checksum-correct packages cannot erase the case scene dependency or use an unpinned ambient scene', async t => {
  const h = await fixture(t), pack = await exported(h), target = await fixture(t, { includeCase: false });
  const forged = await rewrite(h, pack, (manifest, bodies) => {
    manifest.documents = manifest.documents.filter(item => item.id !== ids.scene);
    bodies.delete(scenePath); bodies.delete(`metadata/documents/${ids.scene}.json`);
  });
  await assert.rejects(unpackResourcePackage(forged.file, forged.stage), /资源包格式/);
  pack.manifest.documents = pack.manifest.documents.filter(item => item.id !== ids.scene);
  const before = await authorInventory(target.root), preview = await planPackageImport(target.root, pack);
  assert.ok(preview.summary.conflicts.some(item => item.reason === 'dependency')); assert.deepEqual(await authorInventory(target.root), before);
});

test('checksum-correct packages reject wrong instance checks, malformed scenes and erased scene-definition links', async t => {
  const h = await fixture(t), pack = await exported(h);
  for (const [file, change] of [[casePath, value => { value.case.checks[0].instanceId = ids.definition; }],
    [casePath, value => { value.schemaVersion = 2; }],
    [casePath, value => { value.tool = '/untrusted/tool'; }],
    [casePath, value => { value.case.program.steps[0].inputs[0].instanceId = ids.scene; }],
    [scenePath, value => { value.actors[0].instanceId = randomUUID(); }],
    [scenePath, value => { value.actors = { invalid: true }; }],
    [`metadata/documents/${ids.scene}.json`, value => { value.relations = []; }]]) {
    const forged = await rewrite(h, pack, (manifest, bodies) => {
      const value = JSON.parse(bodies.get(file).toString('utf8').replace(/^\uFEFF/, '')); change(value); bodies.set(file, Buffer.from(JSON.stringify(value)));
    });
    await assert.rejects(unpackResourcePackage(forged.file, forged.stage), /资源包格式/);
  }
  await edit(pack.content, casePath, value => { value.case.checks[0].instanceId = randomUUID(); });
  assert.ok((await planPackageImport((await fixture(t, { empty: true })).root, pack)).summary.conflicts.some(item => item.reason === 'dependency'));
});

test('recognized malformed, extra-field, non-JSON, invalid UTF-8 and oversized case sources cannot export selectively', async t => {
  for (const change of [h => write(h.root, casePath, '{"format":"viento-runtime-case-document",'),
    h => edit(h.root, casePath, value => { value.backendId = 'org.viento.bevy'; }),
    async h => { const next = casePath.replace(/\.json$/, '.md'); await fs.rename(path.join(h.root, casePath), path.join(h.root, next));
      await edit(h.root, `metadata/documents/${ids.case}.json`, value => { value.sourcePath = next; }); },
    async h => write(h.root, casePath, Buffer.concat([Buffer.from(JSON.stringify(declaration()) + '\n'), Buffer.from([0xff])])),
    h => write(h.root, casePath, JSON.stringify(declaration()) + ' '.repeat(262144))]) {
    const h = await fixture(t); await change(h);
    const catalog = await readPackageCatalog(h.root), entry = catalog.entries.find(item => item.id === ids.case);
    assert.ok(entry.problems.length); const before = await authorInventory(h.root);
    await assert.rejects(planExport(h.root, { kind: 'resources', revision: catalog.revision, ids: [ids.case] }), /资源|解析|导出/);
    assert.deepEqual(await authorInventory(h.root), before);
  }
});

test('changes to a pinned scene after preview invalidate publication without modifying the case or author sources', async t => {
  const h = await fixture(t), target = await fixture(t, { includeCase: false });
  const pack = await exported(h, [ids.case], { includeDependencies: false, includeChildren: false }), preview = await planPackageImport(target.root, pack);
  assert.deepEqual(preview.summary.conflicts, []);
  await fs.appendFile(path.join(target.root, scenePath), ' \n');
  const before = await authorInventory(target.root);
  await assert.rejects(applyPackageImport(target.root, pack, preview.revision), /冲突|变化/);
  assert.deepEqual(await authorInventory(target.root), before);
  await assert.rejects(fs.stat(path.join(target.root, casePath)), { code: 'ENOENT' });
});

test('complete workspace archives preserve damaged editable case bytes instead of silently dropping the document', async t => {
  const h = await fixture(t), damaged = Buffer.from('{"format":"viento-runtime-case-document",\r\n');
  await write(h.root, casePath, damaged);
  const plan = await planExport(h.root, { kind: 'workspace' }), file = path.join(h.base, 'workspace.zip');
  await writeExportZip(plan, file); const zip = await yauzl.openPromise(file, { lazyEntries: true });
  let found = false;
  try { for await (const entry of zip.eachEntry()) if (entry.fileName === casePath) {
    const chunks = []; for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), damaged); found = true;
  } } finally { zip.close(); }
  assert.equal(found, true); assert.equal(plan.archiveManifest.workspace.id, JSON.parse(await fs.readFile(path.join(h.root, 'workspace.json'))).id);
});
