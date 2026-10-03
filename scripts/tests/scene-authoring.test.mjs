// Independent authoring-to-build coverage. Start from the actual blank package;
// no pre-authored Scene2D, legacy template fixture, or production workspace.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';
import { canonicalJson } from '../../engine/world-projection.mjs';
import { registerWorkspace, readRegistry, verifyWorkspace } from '../lib/workspace.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { importMediaAsset } from '../lib/media-assets.mjs';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
import { buildProject, runProjectBuild } from '../adapters/node-project-build.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';

const blank = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank');
const actorRef = { kind: 'tool', id: 'scene-authoring-integration' };
const svg = color => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>\n`);
const imageBytes = svg('#65ac80');
const sourcePath = 'documents/scenes/初舞台.json';
const sceneRecordPath = id => `metadata/documents/${id}.json`;
const json = value => JSON.stringify(value, null, 2) + '\n';
const godot = process.env.VIENTO_GODOT_BIN;
const archiveBinary = process.env.VIENTO_TEST_ARCHIVE_BINARY;
const nativeRun = promisify(execFile);
const native = async (...args) => JSON.parse((await nativeRun(archiveBinary, args, { timeout: 15000 })).stdout);

async function write(root, relative, bytes) {
  const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
}
async function blankProject(root) {
  // Same closed manifest/template snapshot as native creation, materialized in
  // JS for a fast test. This is not an assertion of native GUI creation coverage.
  const workspace = { format: 'viento-workspace', version: 3, id: randomUUID(), name: '空白から Scene2D', createdAt: 0,
    ...structuredClone(WORKSPACE_LAYOUT), documentTypes: structuredClone(blank.documentTypes),
    projectTemplate: { packageId: blank.packageId, version: blank.version, digest: `sha256:${buildHash(canonicalJson(blank))}` } };
  await write(root, 'workspace.json', json(workspace));
  for (const [name, content] of Object.entries(blank.templates)) await write(root, `templates/${name}`, content);
  await registerWorkspace(root);
  assert.deepEqual((await readRegistry(root)).documents, []);
  assert.deepEqual((await readRegistry(root)).assets, []);
  assert.deepEqual(await fs.readdir(path.join(root, 'documents')), []);
  assert.deepEqual(workspace.documentTypes.map(type => type.id), ['document']);
  return workspace;
}
async function command(root, patch) {
  const view = await readWorldProjection(root);
  return { command: 'object.create', mode: 'apply', objectId: randomUUID(), documentType: 'document',
    worldId: view.world.id, baseRevision: view.world.revision, actorRef, ...patch };
}
async function fingerprints(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name);
    result[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return result;
}
async function authored(t, { secondActor = false, unused = false, nativeCreate = false } = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-authoring-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  let root, workspace;
  if (nativeCreate) {
    ({ root } = await native('create', temporary, '空白から Scene2D', blank.packageId));
    workspace = JSON.parse(await fs.readFile(path.join(root, 'workspace.json')));
    assert.equal(workspace.projectTemplate.packageId, blank.packageId);
    assert.deepEqual(workspace.documentTypes, blank.documentTypes);
    assert.deepEqual((await readRegistry(root)).documents, []);
    assert.deepEqual((await readRegistry(root)).assets, []);
    assert.deepEqual(await fs.readdir(path.join(root, 'documents')), []);
  } else {
    root = path.join(temporary, 'blank'); await fs.mkdir(root);
    workspace = await blankProject(root);
  }
  const execute = createWorldCommandService(root);
  const actor = await command(root, { sourcePath: 'documents/旅人.md', content: '\uFEFF# 旅人\r\n\r\n背景：作者原文は変更しない。  \r\n' });
  await execute(actor);
  const actorIds = [actor.objectId];
  if (secondActor) {
    const other = await command(root, { sourcePath: 'documents/同伴.md', content: '# 同伴\n\n背景：独立档案。\n' });
    await execute(other); actorIds.push(other.objectId);
  }
  if (unused) await execute(await command(root, { sourcePath: 'documents/未选用.md', content: '# 不属于场景\n' }));
  const imported = await importMediaAsset(root, Readable.from([imageBytes]), '旅人 #100%.svg');
  const duplicate = await importMediaAsset(root, Readable.from([imageBytes]), 'same-image.svg');
  assert.equal(duplicate.reused, true); assert.equal(duplicate.asset.id, imported.asset.id);
  if (unused) await importMediaAsset(root, Readable.from([svg('#bb6644')]), '未选用.svg');
  const scene = { format: 'viento-scene2d', schemaVersion: 1, title: '初舞台 / First scene', viewport: [640, 480], background: '#101827',
    actors: actorIds.map((objectId, index) => ({ objectId, position: [100 + index * 100, 150], size: [48, 48], color: '#ffffff',
      controls: index === 0 ? 'arrows' : 'none', speed: index === 0 ? 160 : 0, imageResourceId: imported.asset.id })) };
  const input = await command(root, { command: 'scene.create', sourcePath, content: json(scene) });
  return { temporary, root, workspace, execute, actor, actorIds, imageId: imported.asset.id, scene, input };
}
async function archiveEntries(file) {
  const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value)));
  return new Promise((resolve, reject) => {
    const entries = new Map();
    zip.on('error', reject); zip.on('end', () => resolve(entries));
    zip.on('entry', entry => {
      zip.openReadStream(entry, (error, stream) => {
        if (error) { zip.close(); reject(error); return; }
        const chunks = []; stream.on('data', chunk => chunks.push(chunk));
        stream.on('error', failure => { zip.close(); reject(failure); });
        stream.on('end', () => { entries.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
      });
    });
    zip.readEntry();
  });
}

test('blank → ordinary actors and imported image → atomic scene → reopened build plan, complete backup and dependency package', async t => {
  const f = await authored(t, { secondActor: true, unused: true }), before = await fingerprints(f.root);
  const preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.equal(preview.status, 'preview'); assert.deepEqual(await fingerprints(f.root), before, 'preview never writes');
  const applied = await f.execute(f.input); assert.equal(applied.status, 'applied');
  const record = (await readRegistry(f.root)).documents.find(item => item.id === f.input.objectId);
  assert.equal(record.documentType, 'document', 'blank project needs no extra built-in scene or character types');
  assert.deepEqual(new Set(record.relations.map(relation => relation.targetId)), new Set(f.actorIds));
  assert.deepEqual(record.assetBindings.map(binding => binding.assetId), [f.imageId], 'shared image binds once');
  assert.ok(record.relations.every(relation => relation.kind === 'references'));
  const after = await fingerprints(f.root);
  for (const [file, digest] of Object.entries(before)) if (file !== '.viento/world-transactions/head.json') assert.equal(after[file], digest, file);
  assert.deepEqual(Object.keys(after).filter(file => !Object.hasOwn(before, file)).sort(), [sourcePath, sceneRecordPath(f.input.objectId)].sort(), 'only scene source and its registration are added');
  assert.equal(await fs.readFile(path.join(f.root, sourcePath), 'utf8'), f.input.content);
  assert.equal((await verifyWorkspace(f.root)).ok, true);
  const captured = await captureBuildSnapshot(f.root, f.input.objectId); assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  assert.equal(captured.plan.actors.length, 2); assert.equal(captured.plan.resources.length, 1);
  assert.deepEqual(captured.resources.get(f.imageId), imageBytes);

  const moved = path.join(f.temporary, 'moved project 日本語'); await fs.rename(f.root, moved);
  const reopened = await captureBuildSnapshot(moved, sourcePath);
  assert.equal(reopened.snapshotId, captured.snapshotId, 'host location is absent from frozen identity');
  assert.deepEqual((await readWorldProjection(moved)).objects.find(item => item.id === f.input.objectId).id, f.input.objectId);
  const zipFile = path.join(f.temporary, 'full.viento.zip');
  const full = await planExport(moved, { kind: 'workspace' }); await writeExportZip(full, zipFile);
  const files = await archiveEntries(zipFile), manifest = JSON.parse(files.get('manifest.json'));
  assert.equal(manifest.workspace.id, f.workspace.id);
  for (const entry of manifest.files) {
    const bytes = files.get(entry.path); assert.ok(bytes, entry.path);
    assert.equal(bytes.length, entry.size); assert.equal(buildHash(bytes), entry.sha256);
    assert.deepEqual(bytes, await fs.readFile(path.join(moved, entry.path)), entry.path);
  }
  assert.ok(![...files.keys()].some(file => file.startsWith('.viento/') && file !== '.viento/workspace.json'));
  for (const file of [sourcePath, sceneRecordPath(f.input.objectId), 'workspace.json', 'templates/document.md']) assert.ok(files.has(file), file);

  const catalog = await readPackageCatalog(moved);
  const selected = await planExport(moved, { kind: 'resources', revision: catalog.revision, ids: [f.input.objectId] });
  assert.equal(selected.documentCount, 3, 'scene and both actors; unrelated document excluded'); assert.equal(selected.assetCount, 1);
  const packageFile = path.join(f.temporary, 'scene.viento-package.zip'); await writeExportZip(selected, packageFile);
  const staging = path.join(f.temporary, 'package'); await fs.mkdir(staging);
  const pack = await unpackResourcePackage(packageFile, staging);
  assert.deepEqual(new Set(pack.manifest.documents.map(item => item.id)), new Set([f.input.objectId, ...f.actorIds]));
  assert.deepEqual(pack.manifest.assets.map(item => item.id), [f.imageId]);
  const target = path.join(f.temporary, 'other-blank'); await blankProject(target);
  const importPlan = await planPackageImport(target, pack); assert.deepEqual(importPlan.summary.conflicts, []);
  await applyPackageImport(target, pack, importPlan.revision);
  const restored = await captureBuildSnapshot(target, f.input.objectId); assert.equal(restored.ok, true, JSON.stringify(restored.diagnostics));
  assert.deepEqual(restored.resources.get(f.imageId), imageBytes);
  assert.equal(await fs.readFile(path.join(target, f.actor.sourcePath), 'utf8'), f.actor.content, 'BOM, CRLF and original background survive reuse');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(target, 'workspace.json'))).documentTypes, blank.documentTypes);
});

test('scene authoring rejects stale actor inputs and preserves occupied user paths before any new scene is published', async t => {
  const f = await authored(t), actorFile = path.join(f.root, f.actor.sourcePath);
  await f.execute({ ...f.input, mode: 'preview' });
  await fs.appendFile(actorFile, '\r\n外部修改\r\n');
  const before = await fingerprints(f.root);
  await assert.rejects(f.execute(f.input), error => error.errorCode === 'world_revision_conflict');
  assert.deepEqual(await fingerprints(f.root), before);
  await assert.rejects(fs.stat(path.join(f.root, sourcePath)), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(f.root, sceneRecordPath(f.input.objectId))), { code: 'ENOENT' });
  await write(f.root, sourcePath, 'owner data');
  const fresh = await command(f.root, { ...f.input, baseRevision: (await readWorldProjection(f.root)).world.revision });
  const occupied = await fingerprints(f.root);
  await assert.rejects(f.execute(fresh), error => error.statusCode === 409 || error.errorCode?.includes('path'));
  assert.deepEqual(await fingerprints(f.root), occupied, 'failed scene creation never replaces existing source');
});

test('scene references preserve changed image bytes; build capture refuses stale resource fingerprints', async t => {
  const f = await authored(t); await f.execute(f.input);
  const image = (await readRegistry(f.root)).assets.find(item => item.id === f.imageId);
  const file = path.join(f.root, 'assets', image.location.path), changed = svg('#112233');
  await fs.writeFile(file, changed);
  const before = await fingerprints(f.root), captured = await captureBuildSnapshot(f.root, f.input.objectId);
  assert.equal(captured.ok, false); assert.ok(captured.diagnostics.some(item => item.code === 'build_resource_changed' && item.resourceId === f.imageId));
  assert.deepEqual(await fingerprints(f.root), before); assert.deepEqual(await fs.readFile(file), changed);
});

test('native blank creation → authored scene → Node and Rust complete archive restores preserve build identity and every file', {
  skip: !archiveBinary && 'Set VIENTO_TEST_ARCHIVE_BINARY to validate native creation and complete archive restore',
}, async t => {
  const f = await authored(t, { secondActor: true, unused: true, nativeCreate: true });
  await f.execute(f.input);
  const before = await fingerprints(f.root), registry = await readRegistry(f.root);
  const captured = await captureBuildSnapshot(f.root, f.input.objectId);
  assert.equal(captured.ok, true, JSON.stringify(captured.diagnostics));
  const nodeArchive = path.join(f.temporary, 'node.viento.zip');
  await writeExportZip(await planExport(f.root, { kind: 'workspace' }), nodeArchive);
  const original = await archiveEntries(nodeArchive), manifest = JSON.parse(original.get('manifest.json'));
  const parent = path.join(f.temporary, 'restored'); await fs.mkdir(parent);
  const assertRestored = async root => {
    for (const entry of manifest.files) assert.deepEqual(await fs.readFile(path.join(root, entry.path)), original.get(entry.path), entry.path);
    assert.deepEqual(await readRegistry(root), registry, 'stable identities, actor relations and shared image binding survive native restore');
    const restored = await captureBuildSnapshot(root, f.input.objectId);
    assert.equal(restored.ok, true, JSON.stringify(restored.diagnostics));
    assert.equal(restored.snapshotId, captured.snapshotId);
    assert.deepEqual(restored.resources.get(f.imageId), imageBytes);
    assert.equal((await verifyWorkspace(root)).ok, true);
    await assert.rejects(fs.stat(path.join(root, '.viento/local.json')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(root, '.viento/world-transactions')), { code: 'ENOENT' });
  };
  const { root: restored } = await native('import', nodeArchive, parent); await assertRestored(restored);
  const nativeArchive = path.join(f.temporary, 'native.viento.zip'); await native('export', restored, nativeArchive);
  const nativeFiles = await archiveEntries(nativeArchive);
  for (const entry of manifest.files) assert.deepEqual(nativeFiles.get(entry.path), original.get(entry.path), entry.path);
  const { root: roundTrip } = await native('import', nativeArchive, parent); await assertRestored(roundTrip);
  const finalArchive = path.join(f.temporary, 'again.viento.zip');
  await writeExportZip(await planExport(roundTrip, { kind: 'workspace' }), finalArchive);
  const finalFiles = await archiveEntries(finalArchive), finalManifest = JSON.parse(finalFiles.get('manifest.json'));
  assert.equal(finalManifest.workspace.id, f.workspace.id);
  assert.deepEqual(new Set(finalFiles.keys()), new Set(original.keys()));
  for (const entry of manifest.files) assert.deepEqual(finalFiles.get(entry.path), original.get(entry.path), entry.path);
  assert.deepEqual(await fingerprints(f.root), before, 'full archive round-trip leaves original workspace bytes untouched');
});

test('real Godot runs a scene authored from the blank template and imported media', {
  skip: !godot && 'Set VIENTO_GODOT_BIN to validate the real authoring-to-runtime path', timeout: 90000,
}, async t => {
  const f = await authored(t); await f.execute(f.input); const before = await fingerprints(f.root);
  const built = await buildProject({ root: f.root, scene: f.input.objectId, godot, output: path.join(f.temporary, 'build') });
  assert.equal(built.ok, true, JSON.stringify(built));
  const run = await runProjectBuild({ buildDirectory: built.buildDirectory, godot });
  assert.equal(run.ok, true, JSON.stringify(run));
  assert.deepEqual(run.record.events.map(event => event.event), ['ready', 'state', 'state', 'finished']);
  assert.deepEqual(run.record.events.at(-1).actors[0], { objectId: f.actor.objectId, position: [140, 150], state: 'idle' });
  assert.deepEqual(await fingerprints(f.root), before);
});
