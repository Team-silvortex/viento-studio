// Scene occurrences are independent from registered definitions. All transaction
// and package checks below use disposable synthetic workspaces under /tmp.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { resolveScene2DModel } from '../../engine/scene-model.mjs';
import { createScene2DPlan, validateScene2DRegistration } from '../../engine/build-plan.mjs';
import { sceneActorIdentity } from '../../engine/scene-identity.mjs';
import { updateSceneContent } from '../../engine/world-scene-update.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldProjection, readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { captureBuildSnapshot } from '../adapters/node-build-snapshot.mjs';
import { recoverWorldTransaction } from '../lib/world-transactions.mjs';
import { transactionHash } from '../lib/world-transaction-state.mjs';
import { registerWorkspace, readRegistry } from '../lib/workspace.mjs';
import { readPackageCatalog } from '../lib/resource-package-catalog.mjs';
import { planExport, writeExportZip } from '../lib/export-package.mjs';
import { unpackResourcePackage } from '../lib/resource-package-reader.mjs';
import { planPackageImport } from '../lib/resource-package-import.mjs';
import { applyPackageImport } from '../lib/resource-package-transaction.mjs';

const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v1.json', import.meta.url), 'utf8'));
const predecessor = JSON.parse(await fs.readFile(new URL('./fixtures/predecessor/v3.json', import.meta.url), 'utf8'));
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const storyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', imageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const firstId = '11111111-1111-4111-8111-111111111111', secondId = '22222222-2222-4222-8222-222222222222';
const sourcePath = 'documents/scenes/instances.json', recordPath = `metadata/documents/${sceneId}.json`;
const json = value => JSON.stringify(value, null, 2) + '\n';
const parse = source => JSON.parse(source.replace(/^\uFEFF/, ''));
const serialize = value => '\uFEFF' + json(value).replaceAll('\n', '\r\n');
const actorRef = { kind: 'tool', id: 'scene-instances-test' };
function observed() {
  const value = structuredClone(golden.observed), document = value.source.documents.find(item => item.record.id === golden.ids.scene);
  const scene = parse(document.content); scene.schemaVersion = 2;
  scene.actors = [{ ...scene.actors[0], instanceId: firstId }, { ...scene.actors[0], instanceId: secondId, position: [300, 240], speed: 17, imageResourceId: null }];
  document.content = serialize(scene); document.sourceRevision = transactionHash(document.content);
  return value;
}
function change(value, mutate) {
  const document = value.source.documents.find(item => item.record.id === golden.ids.scene), scene = parse(document.content);
  mutate(scene); document.content = serialize(scene); document.sourceRevision = transactionHash(document.content);
}
const resolved = value => {
  const result = resolveScene2DModel(value, golden.ids.scene);
  assert.equal(result.ok, true, json(result.diagnostics)); return result.model;
};
function plainScene() {
  const actor = { objectId: actorId, position: [100, 120], size: [64, 64], color: '#ffffff', speed: 160, controls: 'arrows', imageResourceId: imageId };
  return { format: 'viento-scene2d', schemaVersion: 2, title: '实例 🦊', viewport: [640, 480], background: '#101827', actors: [
    { ...actor, instanceId: firstId }, { ...actor, instanceId: secondId, position: [300, 240], speed: 100.5, controls: 'none' },
  ] };
}
const spelled = value => serialize(value).replace('"speed": 160', '"speed": 1.6e2').replace('"speed": 100.5', '"speed": 100.50')
  .replace('"title": "实例 🦊"', '"ti\\u0074le": "实例 \\ud83e\\udd8a"');
async function write(root, relative, content) {
  const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content);
}
async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-instances-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'workspace');
  for (const [name, content] of Object.entries(predecessor.files)) await write(root, name, content);
  const view = await readWorldProjection(root), value = plainScene(), content = spelled(value);
  return { root, temporary, value, content, execute: createWorldCommandService(root), input: {
    command: 'scene.create', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision,
    actorRef, objectId: sceneId, documentType: 'character', sourcePath, content,
  } };
}
async function updateRequest(f, value) {
  const view = await readWorldProjection(f.root), object = view.objects.find(item => item.id === sceneId);
  return { command: 'scene.update', mode: 'apply', worldId: view.world.id, baseRevision: view.world.revision, actorRef,
    objectId: sceneId, objectRevision: object.revision, sourceRevision: object.documentRefs[0].sourceRevision, content: json(value) };
}
async function fingerprint(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name), name = path.relative(root, file);
    if (name !== '.viento/registry.lock') result[name] = transactionHash(await fs.readFile(file));
  }
  return result;
}
async function crash(f, point, index = '-') {
  const requestFile = path.join(f.temporary, 'request.json'); await fs.writeFile(requestFile, json(f.input));
  const child = fork(new URL('./world-transaction-crash-worker.mjs', import.meta.url), [f.root, requestFile, point, String(index)], { silent: true, execArgv: [] });
  let stderr = '', timeout; child.stderr.on('data', chunk => { stderr += chunk; }); const exited = once(child, 'exit');
  try {
    const event = await Promise.race([once(child, 'message').then(([value]) => value), exited.then(() => { throw new Error(`Worker exited: ${stderr}`); }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Worker timeout: ${stderr}`)), 15000); })]);
    assert.equal(event.stage, point);
  } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited; }
}

test('Scene2D v2 repeats one projection as independent stable instances and keeps v1 plan bytes unchanged', () => {
  const value = observed(), before = structuredClone(value), model = resolved(value);
  assert.equal(model.schemaVersion, 2);
  assert.deepEqual(model.actors.map(sceneActorIdentity), [firstId, secondId]);
  assert.deepEqual(model.actors.map(actor => actor.objectId), [golden.ids.first, golden.ids.first]);
  assert.deepEqual(model.actors.map(actor => actor.speed), [160, 17]);
  assert.deepEqual(model.actors.map(actor => actor.imageResourceId), [golden.ids.image, undefined]);
  assert.equal(model.resources.length, 1);
  const plan = createScene2DPlan(value, golden.ids.scene).plan;
  assert.equal(plan.schemaVersion, 2); assert.equal(Object.hasOwn(plan, 'sourceLocations'), false);
  assert.deepEqual(createScene2DPlan(golden.observed, golden.ids.scene).plan, golden.plan);
  assert.deepEqual(value, before);
});

test('v2 source locations distinguish repeated definitions and follow instance IDs through reorder', () => {
  const value = observed(), before = resolved(value), original = value.source.documents.find(item => item.record.id === golden.ids.scene);
  const location = before.sourceLocations.actors.find(actor => actor.instanceId === secondId);
  assert.equal(location.objectId, golden.ids.first); assert.equal(location.definition.objectId, golden.ids.first);
  assert.equal(location.declaration.propertyPath, '/actors/1'); assert.equal(location.fields.speed.propertyPath, '/actors/1/speed');
  assert.equal(original.content.slice(location.fields.speed.sourceRange.start, location.fields.speed.sourceRange.end), '17');
  assert.equal(before.sourceLocations.actors[0].fields.speed.objectId, golden.ids.first);
  change(value, scene => scene.actors.reverse());
  const after = resolved(value), next = after.sourceLocations.actors.find(actor => actor.instanceId === secondId);
  assert.equal(next.declaration.propertyPath, '/actors/0'); assert.equal(next.fields.speed.propertyPath, '/actors/0/speed');
  assert.notEqual(next.declaration.sourceRevision, location.declaration.sourceRevision);
  assert.deepEqual(after.actors.map(sceneActorIdentity), [secondId, firstId]);
});

test('instance identity validation is versioned, rejects missing/duplicate IDs and retains the actor bound', () => {
  const cases = [
    [scene => { delete scene.actors[0].instanceId; }, 'build_instance_missing', '/actors/0/instanceId'],
    [scene => { scene.actors[0].instanceId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'; }, 'build_instance_missing', '/actors/0/instanceId'],
    [scene => { scene.actors[1].instanceId = firstId; }, 'build_instance_duplicate', '/actors/1/instanceId'],
    [scene => { scene.schemaVersion = 1; }, 'build_feature_unsupported', '/actors/0/instanceId'],
    [scene => { scene.schemaVersion = 1; for (const actor of scene.actors) delete actor.instanceId; }, 'build_actor_duplicate', '/actors/1/objectId'],
    [scene => { scene.actors[0].objectId = golden.ids.scene; }, 'build_actor_missing', '/actors/0/objectId'],
    [scene => { scene.actors = Array.from({ length: 129 }, (_, index) => ({ ...scene.actors[0], instanceId: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111` })); }, 'build_scene_value', '/actors'],
  ];
  for (const [mutate, code, propertyPath] of cases) {
    const value = observed(); change(value, mutate);
    const result = resolveScene2DModel(value, golden.ids.scene);
    assert.equal(result.ok, false); assert.equal(result.model, null);
    assert.ok(result.diagnostics.some(item => item.code === code && item.propertyPath === propertyPath), json(result.diagnostics));
  }
  const value = observed(); change(value, scene => { scene.actors = Array.from({ length: 128 }, (_, index) => ({ ...scene.actors[0], instanceId: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111` })); });
  assert.equal(resolved(value).actors.length, 128);
});

test('repeated definitions remain participating diagnostics and registration recovery ignores their current bodies', () => {
  const value = observed(); value.projection.diagnostics.push({ severity: 'error', code: 'definition_invalid', objectId: golden.ids.first, sourcePath: 'documents/projections/first.json' });
  assert.ok(resolveScene2DModel(value, golden.ids.scene).diagnostics.some(item => item.code === 'definition_invalid'));
  value.projection.diagnostics = [];
  for (const item of value.source.documents) if (item.record.id !== golden.ids.scene) item.content = '{"format":"viento-object-projection","schemaVersion":1}';
  assert.equal(resolveScene2DModel(value, golden.ids.scene).ok, false);
  assert.equal(validateScene2DRegistration(value, golden.ids.scene).ok, true);
  change(value, scene => { scene.actors[1].instanceId = firstId; });
  assert.equal(validateScene2DRegistration(value, golden.ids.scene).ok, false, 'recovery must still guard stable declaration identity');
});

test('v2 registration refuses duplicate decoded keys while old v1 registration still recovers', () => {
  const value = observed(), source = value.source.documents.find(item => item.record.id === golden.ids.scene);
  source.content = source.content.replace('"schemaVersion": 2', '"schemaVersion": 1, "schemaVersion": 2');
  const checked = validateScene2DRegistration(value, golden.ids.scene);
  assert.equal(checked.ok, false); assert.ok(checked.diagnostics.some(item => item.code === 'build_scene_json'));
  const limited = observed(), boundedSource = limited.source.documents.find(item => item.record.id === golden.ids.scene);
  boundedSource.content = boundedSource.content.replace('\"title\":', `\"title\": ${'['.repeat(70)}0${']'.repeat(70)}, \"title\":`);
  assert.equal(validateScene2DRegistration(limited, golden.ids.scene).ok, false, 'v2 recovery also retains JSON indexing limits');
  const legacy = structuredClone(golden.observed), old = legacy.source.documents.find(item => item.record.id === golden.ids.scene);
  old.content = old.content.replace('"schemaVersion": 1e0', '"schemaVersion": 2, "schemaVersion": 1e0');
  assert.equal(validateScene2DRegistration(legacy, golden.ids.scene).ok, true);
});

test('lossless v2 reorder moves the right raw fragments even when every instance shares one definition', () => {
  const value = plainScene(), source = spelled(value), candidate = structuredClone(value);
  candidate.actors.reverse(); candidate.actors[0].position = [333, 240];
  const edit = updateSceneContent(source, json(candidate));
  assert.deepEqual(parse(edit.afterContent), candidate); assert.ok(edit.changedPaths.includes('/actors'));
  assert.ok(edit.afterContent.startsWith('\uFEFF')); assert.equal(/(?<!\r)\n/.test(edit.afterContent), false);
  assert.match(edit.afterContent, /"ti\\u0074le": "实例 \\ud83e\\udd8a"/);
  assert.ok(edit.afterContent.indexOf('"speed": 100.50') < edit.afterContent.indexOf('"speed": 1.6e2'));
  assert.equal(updateSceneContent(source, json(value)).afterContent, source);
});

test('explicit v1 upgrade retains original fragments and seeded identities, and refuses a lossy downgrade', () => {
  const value = plainScene(); value.schemaVersion = 1; value.actors = [value.actors[0]]; delete value.actors[0].instanceId;
  const source = spelled(value), candidate = structuredClone(value); candidate.schemaVersion = 2;
  candidate.actors[0].instanceId = actorId; candidate.actors.push({ ...candidate.actors[0], instanceId: secondId, position: [300, 240] });
  const edit = updateSceneContent(source, json(candidate));
  assert.deepEqual(parse(edit.afterContent), candidate); assert.match(edit.afterContent, /"speed": 1\.6e2/);
  assert.match(edit.afterContent, /"ti\\u0074le": "实例 \\ud83e\\udd8a"/);
  assert.throws(() => updateSceneContent(edit.afterContent, json(value)), error => error.errorCode === 'world_scene_invalid' && error.payload.diagnostics[0].propertyPath === '/schemaVersion');
});

test('v2 create and update save independent instances with one definition/image dependency and preserve unrelated files', async t => {
  const f = await fixture(t), before = await fingerprint(f.root), preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.deepEqual(await fingerprint(f.root), before);
  assert.deepEqual(preview.changes[0].record.relations, [{ kind: 'references', targetId: actorId, slot: '' }]);
  assert.deepEqual(preview.changes[0].record.assetBindings, [{ assetId: imageId, role: 'image' }]);
  assert.deepEqual(preview.proposal.preconditions.map(item => item.objectId), [actorId]);
  await f.execute(f.input); assert.equal(await fs.readFile(path.join(f.root, sourcePath), 'utf8'), f.content);
  const candidate = structuredClone(f.value); candidate.actors.reverse(); candidate.actors[0].position = [444, 240];
  const updated = await f.execute(await updateRequest(f, candidate));
  const saved = await fs.readFile(path.join(f.root, sourcePath), 'utf8');
  assert.deepEqual(parse(saved), candidate); assert.equal(saved, updated.changes[0].afterText);
  const result = createScene2DPlan(await readWorldSnapshot(f.root), sceneId);
  assert.equal(result.ok, true, json(result.diagnostics)); assert.equal(result.plan.schemaVersion, 2);
  assert.deepEqual(result.plan.actors.map(sceneActorIdentity), [secondId, firstId]);
  assert.deepEqual(result.plan.actors.map(actor => actor.position), [[444, 240], [100, 120]]);
  const record = (await readRegistry(f.root)).documents.find(item => item.id === sceneId);
  assert.equal(record.relations.length, 1); assert.equal(record.assetBindings.length, 1);
  for (const [name, hash] of Object.entries(before)) assert.equal((await fingerprint(f.root))[name], hash, name);
  const prior = await fingerprint(f.root); candidate.actors[1].instanceId = secondId;
  await assert.rejects(f.execute(await updateRequest(f, candidate)), error => error.errorCode === 'world_scene_invalid');
  assert.deepEqual(await fingerprint(f.root), prior);
});

for (const command of ['create', 'update']) for (const committed of [false, true]) {
  test(`v2 scene.${command} SIGKILL recovery ${committed ? 'commits' : 'rolls back'} exact instance bytes without restoring author definitions`, async t => {
    const f = await fixture(t); let before = [null, null];
    if (command === 'update') {
      await f.execute(f.input); before = await Promise.all([sourcePath, recordPath].map(name => fs.readFile(path.join(f.root, name), 'utf8')));
      const candidate = structuredClone(f.value); candidate.actors.reverse(); candidate.actors[0].position = [444, 240];
      f.input = await updateRequest(f, candidate);
    }
    const preview = await f.execute({ ...f.input, mode: 'preview' });
    await crash(f, committed ? 'commit' : 'data', committed ? '-' : 1);
    const directory = path.join(f.root, '.viento/world-transactions/active');
    const intent = JSON.parse(await fs.readFile(path.join(directory, 'intent.json')));
    assert.equal(intent.version, command === 'create' ? 5 : 8); assert.equal(intent.entries.length, 2);
    const after = await Promise.all([0, 1].map(index => fs.readFile(path.join(directory, `${index}.after`), 'utf8')));
    const external = '# Author definition edited after crash 🦊\n'; await write(f.root, predecessor.sourcePath, external);
    assert.equal((await recoverWorldTransaction(f.root)).status, committed ? 'committed' : 'rolled-back');
    const actual = await Promise.all([sourcePath, recordPath].map(name => fs.readFile(path.join(f.root, name), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; })));
    assert.deepEqual(actual, committed ? after : before);
    if (committed) assert.deepEqual(parse(actual[0]), parse(f.input.content));
    assert.equal(await fs.readFile(path.join(f.root, predecessor.sourcePath), 'utf8'), external);
    assert.equal((await recoverWorldTransaction(f.root)).status, 'idle');
    assert.equal(preview.changes[0].objectId, sceneId);
  });
}

for (const committed of [false, true]) test(`explicit v1 instance upgrade recovers ${committed ? 'committed v2' : 'exact v1'} source and retains metadata`, async t => {
  const f = await fixture(t), legacy = structuredClone(f.value); legacy.schemaVersion = 1; legacy.actors = [legacy.actors[0]]; delete legacy.actors[0].instanceId;
  f.input.content = spelled(legacy); await f.execute(f.input);
  const beforeSource = await fs.readFile(path.join(f.root, sourcePath), 'utf8'), beforeRecord = await fs.readFile(path.join(f.root, recordPath), 'utf8');
  const candidate = structuredClone(legacy); candidate.schemaVersion = 2; candidate.actors[0].instanceId = actorId;
  candidate.actors.push({ ...candidate.actors[0], instanceId: secondId, position: [333, 240], controls: 'none' });
  f.input = await updateRequest(f, candidate); const preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.match(preview.changes[0].afterText, /"speed": 1\.6e2/);
  assert.deepEqual(preview.changes[0].addedRelations, []); assert.deepEqual(preview.changes[0].addedBindings, []);
  await crash(f, committed ? 'commit' : 'data', committed ? '-' : 0);
  assert.equal((await recoverWorldTransaction(f.root)).status, committed ? 'committed' : 'rolled-back');
  assert.equal(await fs.readFile(path.join(f.root, sourcePath), 'utf8'), committed ? preview.changes[0].afterText : beforeSource);
  assert.equal(await fs.readFile(path.join(f.root, recordPath), 'utf8'), beforeRecord);
  const built = createScene2DPlan(await readWorldSnapshot(f.root), sceneId);
  assert.equal(built.ok, true, json(built.diagnostics)); assert.equal(built.plan.schemaVersion, committed ? 2 : 1);
  assert.deepEqual(built.plan.actors.map(sceneActorIdentity), committed ? [actorId, secondId] : [actorId]);
});

test('recovery rejects forged duplicate v2 identities even when journal after-image hashes are recomputed', async t => {
  const f = await fixture(t); await crash(f, 'intent');
  const directory = path.join(f.root, '.viento/world-transactions/active'), file = path.join(directory, '0.after');
  const content = parse(await fs.readFile(file, 'utf8')); content.actors[1].instanceId = firstId;
  const after = json(content); await fs.writeFile(file, after);
  const intent = JSON.parse(await fs.readFile(path.join(directory, 'intent.json'))); intent.entries[0].after = transactionHash(after);
  await fs.writeFile(path.join(directory, 'intent.json'), json(intent));
  const before = await fingerprint(f.root);
  await assert.rejects(recoverWorldTransaction(f.root), error => error.errorCode === 'world_journal_invalid');
  assert.deepEqual(await fingerprint(f.root), before);
});

test('resource package round trip retains repeated-instance source and closes shared definition, owned story and image exactly once', async t => {
  const f = await fixture(t); await f.execute(f.input);
  const candidate = structuredClone(f.value); candidate.actors.reverse(); candidate.actors[0].position = [444, 240];
  await f.execute(await updateRequest(f, candidate));
  const before = await fingerprint(f.root), catalog = await readPackageCatalog(f.root);
  const exported = await planExport(f.root, { kind: 'resources', ids: [sceneId], revision: catalog.revision });
  assert.equal(exported.documentCount, 3); assert.equal(exported.assetCount, 1);
  const zip = path.join(f.temporary, 'scene.zip'); await writeExportZip(exported, zip);
  const directory = path.join(f.temporary, 'unpacked'); await fs.mkdir(directory); const pack = await unpackResourcePackage(zip, directory);
  assert.deepEqual(new Set(pack.manifest.documents.map(item => item.id)), new Set([sceneId, actorId, storyId]));
  assert.deepEqual(pack.manifest.assets.map(item => item.id), [imageId]);
  const target = path.join(f.temporary, 'imported'), manifest = JSON.parse(predecessor.files['workspace.json']);
  manifest.id = randomUUID(); manifest.name = 'Imported instances'; await write(target, 'workspace.json', json(manifest));
  for (const [name, content] of Object.entries(predecessor.files)) if (name.startsWith('templates/')) await write(target, name, content);
  await registerWorkspace(target);
  const planned = await planPackageImport(target, pack); assert.deepEqual(planned.summary.conflicts, []);
  assert.equal((await applyPackageImport(target, pack, planned.revision)).status, 'imported');
  for (const name of [sourcePath, recordPath, predecessor.sourcePath, 'documents/stories/origin.md', 'assets/reference.svg']) {
    assert.deepEqual(await fs.readFile(path.join(target, name)), await fs.readFile(path.join(f.root, name)), name);
  }
  const original = await captureBuildSnapshot(f.root, sceneId), restored = await captureBuildSnapshot(target, sceneId);
  assert.equal(restored.ok, true, json(restored.diagnostics)); assert.equal(restored.plan.schemaVersion, 2);
  assert.deepEqual(restored.plan.actors, original.plan.actors); assert.deepEqual(restored.plan.resources, original.plan.resources);
  assert.deepEqual(restored.plan.actors.map(sceneActorIdentity), [secondId, firstId]);
  assert.deepEqual(await fingerprint(f.root), before);
});
