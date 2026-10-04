import '../adapters/node-studio-core.mjs';
// Preview draft → scene.update → build inputs → selected resource migration.
// All source, metadata, media and archives are disposable fixtures under /tmp.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createSceneLayoutDraft } from '../../engine/scene-layout.mjs';
import { getProjectionTemplates, lockProjectionTemplate } from '../../engine/object-projection.mjs';
import { createScenePreviewService } from '../lib/scene-preview-service.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection } from '../adapters/node-world-projection.mjs';
import { captureBuildSnapshot, buildHash } from '../adapters/node-build-snapshot.mjs';
import { generateGodotProject } from '../backends/godot4.mjs';
import { registerWorkspace, readRegistry } from '../lib/workspace.mjs';
import { PROJECT_TEMPLATE_CATALOG, WORKSPACE_LAYOUT } from '../lib/project-layout.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const projectionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', imageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sourcePath = 'documents/scenes/demo.json', recordPath = `metadata/documents/${sceneId}.json`;
const json = value => JSON.stringify(value, null, 2) + '\n', parsed = value => JSON.parse(value.replace(/^\uFEFF/, ''));
async function write(root, relative, content) {
  const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content);
}
async function fingerprint(root) {
  const hashes = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name); hashes[path.relative(root, file)] = buildHash(await fs.readFile(file));
  }
  return hashes;
}
async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-layout-')), root = path.join(temporary, 'source');
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  await fs.cp(new URL('../../examples/scene2d/', import.meta.url), root, { recursive: true });
  const execute = createWorldCommandService(root), view = await readWorldProjection(root), template = getProjectionTemplates()[0];
  const projection = { format: 'viento-object-projection', schemaVersion: 1, title: 'Layout projection', sourceObjectId: actorId,
    template: await lockProjectionTemplate(template, { digest: buildHash }),
    configuration: { ...Object.fromEntries(template.fields.map(field => [field.id, field.default])), image: imageId } };
  await execute({ command: 'projection.create', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
    actorRef: { kind: 'tool', id: 'scene-layout-test' }, objectId: projectionId, documentType: 'character',
    sourcePath: 'documents/projections/player.json', content: json(projection) });
  const declaration = parsed(await fs.readFile(path.join(root, sourcePath), 'utf8'));
  declaration.title = 'Keep \u65c5人'; declaration.actors[0].useProjectionDefaults = false;
  declaration.actors.push({ objectId: projectionId, position: [400, 200], useProjectionDefaults: true, imageResourceId: null });
  const content = '\uFEFF' + (JSON.stringify(declaration, null, '\t') + '\n \t')
    .replace('Keep 旅人', 'Keep \\u65c5人').replace('"speed": 160', '"speed": 1.6e2').replace('"schemaVersion": 1', '"schemaVersion": 1e0').replaceAll('\n', '\r\n');
  await write(root, sourcePath, content);
  const record = JSON.parse(await fs.readFile(path.join(root, recordPath), 'utf8'));
  record.relations.push({ kind: 'references', targetId: projectionId, slot: '' });
  record.assetBindings.push({ assetId: imageId, role: 'image' }); record.authorNote = { literal: 'large-number' };
  await write(root, recordPath, json(record).replace('"large-number"', '900719925474099312345').replaceAll('\n', '\r\n'));
  const service = createScenePreviewService(root, { enabled: true }); t.after(() => service.close());
  return { root, temporary, execute, service, content, declaration };
}

test('scene preview layout saves only positions with exact unrelated tokens and metadata retained, and changes the build plan', async t => {
  const f = await fixture(t), before = await fingerprint(f.root), preview = await f.service.create({ sceneId });
  const draft = createSceneLayoutDraft(preview); assert.ok(draft);
  t.after(() => draft.dispose());
  draft.setPosition(actorId, [240.5, -10]); draft.setPosition(projectionId, [500, 275]);
  const proposal = await f.execute(draft.command()); assert.equal(proposal.status, 'preview');
  assert.deepEqual(await fingerprint(f.root), before, 'canvas edits and command preview create no files');
  const saved = await f.execute(draft.command('apply')); assert.equal(saved.status, 'applied');
  assert.deepEqual(saved.changes[0].changedPaths, ['/actors/0/position/0', '/actors/0/position/1', '/actors/1/position/0', '/actors/1/position/1']);
  assert.deepEqual(saved.changes[0].addedRelations, []); assert.deepEqual(saved.changes[0].addedBindings, []);
  const content = await fs.readFile(path.join(f.root, sourcePath), 'utf8');
  assert.equal(content, proposal.changes[0].afterText); assert.equal(draft.matches(content), true);
  assert.ok(content.startsWith('\uFEFF{\r\n')); assert.ok(content.endsWith('\r\n \t')); assert.ok(!/(?<!\r)\n/.test(content));
  assert.match(content, /"speed": 1\.6e2/); assert.match(content, /"schemaVersion": 1e0/); assert.match(content, /Keep \\u65c5人/);
  const expected = structuredClone(f.declaration); expected.actors[0].position = [240.5, -10]; expected.actors[1].position = [500, 275];
  assert.deepEqual(parsed(content), expected);
  const after = await fingerprint(f.root);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const [name, hash] of Object.entries(before)) if (![sourcePath, '.viento/world-transactions/head.json'].includes(name)) assert.equal(after[name], hash, name);
  const frozen = await captureBuildSnapshot(f.root, sceneId); assert.notEqual(frozen.snapshotId, preview.snapshotId);
  assert.deepEqual(frozen.plan.actors.map(actor => actor.position), [[240.5, -10], [500, 275]]);
  assert.equal(frozen.plan.actors[1].imageResourceId, undefined, 'explicit null still suppresses the inherited image');
  assert.equal(frozen.plan.actors[1].fieldSources.speed.objectId, projectionId, 'unmodified inherited fields remain projection-owned');
  const generated = await generateGodotProject(frozen.plan);
  assert.deepEqual(JSON.parse(generated.files.get('scene.json')).actors.map(actor => actor.position), [[240.5, -10], [500, 275]]);
  assert.equal(Object.hasOwn(frozen.snapshot, 'sceneEditing'), false);
});

test('layout undo back to origin produces no author or transaction writes and unknown-save reconciliation compares whole content', async t => {
  const f = await fixture(t), preview = await f.service.create({ sceneId }), draft = createSceneLayoutDraft(preview);
  t.after(() => draft.dispose());
  const before = await fingerprint(f.root);
  draft.setPosition(actorId, [1, 2]); draft.undo(); assert.equal(draft.state().dirty, false);
  assert.equal(draft.command().content, f.content);
  assert.equal((await f.execute(draft.command('apply'))).status, 'unchanged');
  assert.deepEqual(await fingerprint(f.root), before);
  draft.setPosition(projectionId, [10, 20]); await f.execute(draft.command('apply'));
  const observed = await f.service.create({ sceneId }); assert.equal(draft.matches(observed.sceneEditing.content), true);
  assert.equal(draft.matches(JSON.stringify({ ...parsed(observed.sceneEditing.content), title: 'External title' })), false);
});

test('layout commands retain their observed World/object/source versions and reject newer actor or scene input without clobbering it', async t => {
  const f = await fixture(t), draft = createSceneLayoutDraft(await f.service.create({ sceneId }));
  t.after(() => draft.dispose());
  draft.setPosition(actorId, [21, 34]);
  await fs.appendFile(path.join(f.root, 'documents/characters/traveler.md'), '\nExternal author change\n');
  const newer = await fingerprint(f.root);
  for (const mode of ['preview', 'apply']) await assert.rejects(f.execute(draft.command(mode)), { errorCode: 'world_revision_conflict' });
  assert.deepEqual(await fingerprint(f.root), newer); assert.deepEqual(draft.currentPosition(actorId), [21, 34]);
  const fresh = createSceneLayoutDraft(await f.service.create({ sceneId })); fresh.setPosition(actorId, [55, 89]);
  t.after(() => fresh.dispose());
  await fs.writeFile(path.join(f.root, sourcePath), f.content.replace('Keep', 'Other'));
  const external = await fingerprint(f.root);
  await assert.rejects(f.execute(fresh.command('apply')), { errorCode: 'world_revision_conflict' });
  assert.deepEqual(await fingerprint(f.root), external); assert.equal(fresh.state().dirty, true);
});

test('saved layout exports with OC, projection and image dependencies and reopens identically in another project', async t => {
  const f = await fixture(t), draft = createSceneLayoutDraft(await f.service.create({ sceneId }));
  t.after(() => draft.dispose());
  draft.setPositions([{ objectId: actorId, position: [123, 456] }, { objectId: projectionId, position: [456, 123] }]);
  draft.move([actorId, projectionId], [32, 32], 32); draft.align([actorId, projectionId], 'top');
  const selectedPositions = draft.actors().map(actor => actor.position);
  await f.execute(draft.command('apply'));
  const before = await fingerprint(f.root), catalog = await readPackageCatalog(f.root);
  const exportPlan = await planExport(f.root, { kind: 'resources', ids: [sceneId], revision: catalog.revision });
  const archive = path.join(f.temporary, 'layout.zip'); await writeExportZip(exportPlan, archive);
  const unpacked = path.join(f.temporary, 'unpacked'); await fs.mkdir(unpacked);
  const pack = await unpackResourcePackage(archive, unpacked);
  assert.deepEqual(new Set(pack.manifest.documents.map(item => item.id)), new Set([sceneId, actorId, projectionId]));
  assert.deepEqual(pack.manifest.assets.map(item => item.id), [imageId]);
  const target = path.join(f.temporary, 'restored'), template = PROJECT_TEMPLATE_CATALOG.templates.find(item => item.packageId === 'org.viento.blank');
  await write(target, 'workspace.json', json({ format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Restored layout', createdAt: 0,
    ...structuredClone(WORKSPACE_LAYOUT), documentTypes: structuredClone(template.documentTypes) }));
  for (const [name, content] of Object.entries(template.templates)) await write(target, `templates/${name}`, content);
  await registerWorkspace(target);
  const imported = await planPackageImport(target, pack); assert.deepEqual(imported.summary.conflicts, []);
  await applyPackageImport(target, pack, imported.revision);
  const original = await captureBuildSnapshot(f.root, sceneId), restored = await captureBuildSnapshot(target, sceneId);
  assert.equal(restored.ok, true); assert.deepEqual(restored.plan.actors, original.plan.actors); assert.deepEqual(restored.plan.resources, original.plan.resources);
  assert.deepEqual(restored.plan.actors.map(actor => actor.position), selectedPositions);
  const generated = await generateGodotProject(restored.plan);
  assert.deepEqual(JSON.parse(generated.files.get('scene.json')).actors.map(actor => actor.position), selectedPositions);
  for (const item of pack.manifest.documents) {
    assert.deepEqual(await fs.readFile(path.join(target, item.sourcePath)), await fs.readFile(path.join(f.root, item.sourcePath)));
    assert.deepEqual(await fs.readFile(path.join(target, `metadata/documents/${item.id}.json`)), await fs.readFile(path.join(f.root, `metadata/documents/${item.id}.json`)));
  }
  assert.deepEqual(restored.resources.get(imageId), original.resources.get(imageId));
  assert.equal((await readRegistry(target)).documents.length, 3); assert.deepEqual(await fingerprint(f.root), before);
});

test('batch scene moves and resolved-size alignment undo together, preserve source bytes, and save only coordinates into build inputs', async t => {
  const f = await fixture(t), projectionPath = path.join(f.root, 'documents/projections/player.json');
  const projection = JSON.parse(await fs.readFile(projectionPath, 'utf8'));
  projection.configuration.width = 40; projection.configuration.height = 120;
  await fs.writeFile(projectionPath, json(projection));
  const before = await fingerprint(f.root), preview = await f.service.create({ sceneId }), draft = createSceneLayoutDraft(preview), ids = [actorId, projectionId];
  t.after(() => draft.dispose());
  assert.deepEqual(draft.actors().map(actor => actor.size), [[80, 80], [40, 120]]);
  assert.equal(draft.move(ids, [50, -10]), true);
  assert.equal(draft.align(ids, 'left'), true); assert.equal(draft.align(ids, 'middle'), true);
  const expectedPositions = [[250, 190], [230, 190]];
  assert.deepEqual(draft.actors().map(actor => actor.position), expectedPositions);
  for (let count = 0; count < 3; count++) assert.equal(draft.undo(), true);
  assert.equal(draft.undo(), false); assert.equal(draft.state().dirty, false); assert.equal(draft.command().content, f.content);
  assert.equal((await f.execute(draft.command('apply'))).status, 'unchanged'); assert.deepEqual(await fingerprint(f.root), before);
  for (let count = 0; count < 3; count++) assert.equal(draft.redo(), true);
  assert.equal(draft.redo(), false);
  const proposal = await f.execute(draft.command()); assert.deepEqual(await fingerprint(f.root), before);
  const saved = await f.execute(draft.command('apply')); assert.equal(saved.status, 'applied');
  assert.ok(saved.changes[0].changedPaths.every(pointer => /^\/actors\/[01]\/position\/[01]$/.test(pointer)));
  assert.deepEqual(saved.changes[0].addedRelations, []); assert.deepEqual(saved.changes[0].addedBindings, []);
  const savedContent = await fs.readFile(path.join(f.root, sourcePath), 'utf8');
  assert.equal(savedContent, proposal.changes[0].afterText); assert.ok(savedContent.startsWith('\uFEFF{\r\n'));
  assert.match(savedContent, /"speed": 1\.6e2/); assert.match(savedContent, /"schemaVersion": 1e0/); assert.match(savedContent, /Keep \\u65c5人/);
  const expected = structuredClone(f.declaration); expected.actors.forEach((actor, index) => { actor.position = expectedPositions[index]; });
  assert.deepEqual(parsed(savedContent), expected, 'inheritance, explicit false/null and absent fields remain unchanged');
  const captured = await captureBuildSnapshot(f.root, sceneId); assert.deepEqual(captured.plan.actors.map(actor => actor.position), expectedPositions);
  assert.deepEqual(captured.plan.actors[1].size, [40, 120]); assert.equal(captured.plan.actors[1].imageResourceId, undefined);
  const generated = await generateGodotProject(captured.plan);
  assert.deepEqual(JSON.parse(generated.files.get('scene.json')).actors.map(actor => actor.position), expectedPositions);
  const after = await fingerprint(f.root);
  for (const [name, hash] of Object.entries(before)) if (![sourcePath, '.viento/world-transactions/head.json'].includes(name)) assert.equal(after[name], hash, name);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
});
