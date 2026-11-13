import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { sceneHUD2DFixture, hudId, hudDigest } from './helpers/scene-hud2d-fixture.mjs';
const hudJson = value => JSON.stringify(value, null, 2) + '\n';
import { readPackageCatalog, packageDigest } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
async function inventory(root, prefix = '') {
  const result = {};
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await inventory(root, name));
    else { assert.ok(entry.isFile()); result[name] = hudDigest(await fs.readFile(path.join(root, name))); }
  }
  return result;
}
async function fixture(t) {
  const f = await sceneHUD2DFixture({ enabled: true }), temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-hud-package-')), author = path.join(temporary, 'author');
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const write = async (name, content) => { await fs.mkdir(path.dirname(path.join(author, name)), { recursive: true }); await fs.writeFile(path.join(author, name), typeof content === 'string' ? content : hudJson(content)); };
  for (const folder of ['assets', 'templates', 'metadata/assets']) await fs.mkdir(path.join(author, folder), { recursive: true });
  await write('workspace.json', f.source.workspace);
  for (const document of f.source.documents) { await write(document.sourcePath, document.content); await write(`metadata/documents/${document.record.id}.json`, document.record); }
  return { ...f, hudDocumentId: f.hud.record.id, temporary, author, write };
}
async function exportPack(f, { includeDependencies = true, id = f.hudDocumentId, name = 'hud' } = {}) {
  const catalog = await readPackageCatalog(f.author), plan = await planExport(f.author, { kind: 'resources', revision: catalog.revision,
    ids: [id], includeDependencies, includeChildren: false });
  const zip = path.join(f.temporary, name + '.zip'); await writeExportZip(plan, zip);
  const stage = path.join(f.temporary, name); await fs.mkdir(stage); return unpackResourcePackage(zip, stage);
}
async function forgedPack(f, pack, name, edit) {
  const manifest = structuredClone(pack.manifest), bodies = new Map();
  for (const file of manifest.files) bodies.set(file.path, await fs.readFile(path.join(pack.content, file.path)));
  edit(manifest, bodies);
  manifest.files = [...bodies].map(([name, bytes]) => ({ path: name, size: bytes.length, sha256: packageDigest(bytes) }));
  const archive = path.join(f.temporary, name + '.zip'), zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
  for (const [name, bytes] of bodies) zip.addBuffer(bytes, name);
  const done = pipeline(zip.outputStream, createWriteStream(archive)); zip.end(); await done;
  const stage = path.join(f.temporary, name); await fs.mkdir(stage); return unpackResourcePackage(archive, stage);
}

test('HUD closure relocates exact independent author bytes and rebuilds without the original project', async t => {
  const f = await fixture(t), content = '\ufeff' + JSON.stringify(f.value, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
  await f.write(f.hud.sourcePath, content);
  const before = await inventory(f.author), captured = await captureBuildSnapshot(f.author, f.assemblyId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const pack = await exportPack(f, { id: f.assemblyId });
  assert.deepEqual(new Set(pack.manifest.documents.map(item => item.id)), new Set([f.assemblyId, f.sceneId, f.hudDocumentId, f.definitionId]));
  const target = path.join(f.temporary, 'relocated'); await fs.mkdir(target);
  const workspace = { ...f.source.workspace, version: 2, id: hudId(100), paths: { documents: 'design-data', templates: 'data-template', metadata: 'metadata' } };
  await fs.writeFile(path.join(target, 'workspace.json'), hudJson(workspace));
  for (const folder of ['design-data', 'data-template', 'assets', 'metadata/documents', 'metadata/assets']) await fs.mkdir(path.join(target, folder), { recursive: true });
  const review = await planPackageImport(target, pack); assert.deepEqual(review.summary.conflicts, []);
  assert.equal((await applyPackageImport(target, pack, review.revision)).status, 'imported');
  await fs.rename(f.author, f.author + '-offline');
  const rebuilt = await captureBuildSnapshot(target, f.assemblyId);
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt.diagnostics));
  const child = rebuilt.plan.scenes[0]; assert.deepEqual(child.hud2d.document, f.value);
  assert.equal(child.hud2d.manifest.sourcePath, 'design-data/hud/overlay.json');
  assert.equal(child.hud2d.manifest.sourceRevision, captured.plan.scenes[0].hud2d.manifest.sourceRevision);
  assert.deepEqual(child.actors.map(actor => actor.instanceId), f.instances); assert.equal(child.actors[0].objectId, child.actors[1].objectId);
  assert.equal(await fs.readFile(path.join(target, 'design-data/hud/overlay.json'), 'utf8'), content);
  assert.deepEqual(await inventory(f.author + '-offline'), before);
});
test('wrong HUD scene ownership is exposed by catalog and cannot be exported despite valid metadata', async t => {
  const f = await fixture(t); f.value.sceneObjectId = hudId(777); await f.write(f.hud.sourcePath, f.value);
  const before = await inventory(f.author), catalog = await readPackageCatalog(f.author), hud = catalog.entries.find(item => item.id === f.hudDocumentId);
  assert.ok(hud.problems.includes('正文解析失败'));
  await assert.rejects(planExport(f.author, { kind: 'resources', revision: catalog.revision, ids: [f.hudDocumentId], includeDependencies: true }));
  assert.deepEqual(await inventory(f.author), before);
});
test('checksum-correct included packages cannot forge HUD ownership or erase the unique scene opt-in', async t => {
  const f = await fixture(t), pack = await exportPack(f), before = await inventory(f.author);
  await assert.rejects(forgedPack(f, pack, 'unknown-target', (_, bodies) => {
    const value = structuredClone(f.value); value.sceneObjectId = hudId(777); bodies.set(f.hud.sourcePath, Buffer.from(hudJson(value)));
  }));
  await assert.rejects(forgedPack(f, pack, 'missing-slot', (_, bodies) => {
    const file = `metadata/documents/${f.sceneId}.json`, value = JSON.parse(bodies.get(file));
    value.relations = value.relations.filter(row => row.slot !== 'hud2d'); bodies.set(file, Buffer.from(hudJson(value)));
  }));
  assert.deepEqual(await inventory(f.author), before);
});
test('external scene source and selected HUD metadata are revalidated after availability deferral', async t => {
  for (const mutate of ['source', 'selection']) {
    const f = await fixture(t), pack = await exportPack(f, { includeDependencies: false, name: 'required-scene' });
    assert.equal(pack.manifest.documents.length, 1); assert.ok(pack.manifest.requirements.some(item => item.id === f.sceneId));
    const valid = await planPackageImport(f.author, pack); assert.deepEqual(valid.summary.conflicts, []);
    if (mutate === 'source') await f.write(f.scene.sourcePath, { ...f.declaration, title: 'Externally changed' });
    else { const record = structuredClone(f.scene.record); record.relations = record.relations.filter(row => row.slot !== 'hud2d'); await f.write(`metadata/documents/${f.sceneId}.json`, record); }
    const before = await inventory(f.author), invalid = await planPackageImport(f.author, pack);
    assert.ok(invalid.summary.conflicts.some(item => item.reason === 'dependency'));
    assert.deepEqual(await inventory(f.author), before);
  }
});
test('bad reverse slot and invalid HUD geometry cannot hide in a checksum-correct package', async t => {
  const f = await fixture(t), pack = await exportPack(f);
  await assert.rejects(forgedPack(f, pack, 'bad-reverse-slot', (_, bodies) => {
    const file = `metadata/documents/${f.hudDocumentId}.json`, record = JSON.parse(bodies.get(file));
    record.relations[0].slot = 'wrong'; bodies.set(file, Buffer.from(hudJson(record)));
  }));
  await assert.rejects(forgedPack(f, pack, 'bad-geometry', (_, bodies) => {
    const value = structuredClone(f.value); value.elements[0].size[0] = 0;
    bodies.set(f.hud.sourcePath, Buffer.from(hudJson(value)));
  }));
});
