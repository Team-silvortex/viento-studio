// Scene groups organize stable occurrences without changing runtime actors. All transaction
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
import { validateSceneGroups, buildSceneOutline } from '../../engine/scene-groups.mjs';
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
const groupId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', childId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const emptyId = '99999999-9999-4999-8999-999999999999';
const sourcePath = 'documents/scenes/groups.json', recordPath = `metadata/documents/${sceneId}.json`;
const json = value => JSON.stringify(value, null, 2) + '\n';
const parse = source => JSON.parse(source.replace(/^\uFEFF/, ''));
const serialize = value => '\uFEFF' + json(value).replaceAll('\n', '\r\n');
const actorRef = { kind: 'tool', id: 'scene-groups-test' };
function observed() {
  const value = structuredClone(golden.observed), document = value.source.documents.find(item => item.record.id === golden.ids.scene);
  const scene = parse(document.content); scene.schemaVersion = 3; scene.groups = groups();
  scene.actors = [{ ...scene.actors[0], instanceId: firstId, groupId }, { ...scene.actors[0], instanceId: secondId, groupId: childId, position: [300, 240], speed: 17, imageResourceId: null }];
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
function groups() { return [{ groupId, name: '旅人 / Party' }, { groupId: childId, name: '同行者 / Companions', parentGroupId: groupId }, { groupId: emptyId, name: 'Empty' }]; }
function plainScene() {
  const actor = { objectId: actorId, position: [100, 120], size: [64, 64], color: '#ffffff', speed: 160, controls: 'arrows', imageResourceId: imageId };
  return { format: 'viento-scene2d', schemaVersion: 3, groups: groups(), title: '实例 🦊', viewport: [640, 480], background: '#101827', actors: [
    { ...actor, instanceId: firstId, groupId }, { ...actor, instanceId: secondId, groupId: childId, position: [300, 240], speed: 100.5, controls: 'none' },
  ] };
}
const spelled = value => serialize(value).replace('"speed": 160', '"speed": 1.6e2').replace('"speed": 100.5', '"speed": 100.50')
  .replace('"title": "实例 🦊"', '"ti\\u0074le": "实例 \\ud83e\\udd8a"');
async function write(root, relative, content) {
  const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content);
}
async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-groups-'));
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


test('author v3 keeps groups in model and provenance while compiling unchanged plan v2 actor DTOs', () => {
  const value = observed(), before = structuredClone(value), model = resolved(value);
  assert.equal(model.schemaVersion, 3); assert.deepEqual(model.groups, groups());
  assert.deepEqual(model.actors.map(actor => actor.groupId), [groupId, childId]);
  const plan = createScene2DPlan(value, golden.ids.scene).plan;
  assert.equal(plan.schemaVersion, 2); assert.equal(Object.hasOwn(plan, 'groups'), false);
  assert.equal(plan.actors.some(actor => Object.hasOwn(actor, 'groupId')), false);
  const v2 = structuredClone(value); change(v2, scene => { scene.schemaVersion = 2; delete scene.groups; for (const actor of scene.actors) delete actor.groupId; });
  // The document revision records source edits; all compiled actor semantics and
  // resource dependencies otherwise remain byte-for-byte equivalent.
  const plainPlan = createScene2DPlan(v2, golden.ids.scene).plan;
  plainPlan.scene.sourceRevision = plan.scene.sourceRevision;
  assert.deepEqual(plan, plainPlan);
  assert.deepEqual(createScene2DPlan(golden.observed, golden.ids.scene).plan, golden.plan);
  assert.deepEqual(value, before);
});

test('group validation rejects malformed topology, identities, memberships, fields and version confusion', () => {
  const cases = [
    [scene => { delete scene.groups; }, 'build_group_value', '/groups'],
    [scene => { scene.groups = null; }, 'build_group_value', '/groups'],
    [scene => { scene.groups[0] = null; }, 'build_group_value', '/groups/0'],
    [scene => { scene.groups[0].groupId = groupId.toUpperCase(); }, 'build_group_missing', '/groups/0/groupId'],
    [scene => { scene.groups[1].groupId = groupId; }, 'build_group_duplicate', '/groups/1/groupId'],
    [scene => { scene.groups[0].groupId = firstId; }, 'build_group_duplicate', '/groups/0/groupId'],
    [scene => { scene.groups[0].name = ' \t '; }, 'build_group_value', '/groups/0/name'],
    [scene => { scene.groups[0].name = 'a'.repeat(161); }, 'build_group_value', '/groups/0/name'],
    [scene => { scene.groups[0].name = 'a\u007f'; }, 'build_group_value', '/groups/0/name'],
    [scene => { scene.groups[0].parentGroupId = null; }, 'build_group_parent', '/groups/0/parentGroupId'],
    [scene => { scene.groups[0].parentGroupId = actorId; }, 'build_group_parent', '/groups/0/parentGroupId'],
    [scene => { scene.groups[0].parentGroupId = groupId; }, 'build_group_cycle', '/groups/0/parentGroupId'],
    [scene => { scene.groups[0].parentGroupId = childId; }, 'build_group_cycle', '/groups/0/parentGroupId'],
    [scene => { scene.actors[0].groupId = null; }, 'build_actor_group', '/actors/0/groupId'],
    [scene => { scene.actors[0].groupId = actorId; }, 'build_actor_group', '/actors/0/groupId'],
    [scene => { scene.groups[0]['size/0'] = 2; }, 'build_feature_unsupported', '/groups/0/size~10'],
    [scene => { scene.schemaVersion = 2; }, 'build_feature_unsupported', '/groups'],
    [scene => { scene.schemaVersion = 2; delete scene.groups; }, 'build_feature_unsupported', '/actors/0/groupId'],
  ];
  for (const [mutate, code, propertyPath] of cases) {
    const value = observed(); change(value, mutate); const checked = resolveScene2DModel(value, golden.ids.scene);
    assert.equal(checked.ok, false); assert.equal(checked.model, null);
    assert.ok(checked.diagnostics.some(item => item.code === code && item.propertyPath === propertyPath), json(checked.diagnostics));
    assert.equal(validateScene2DRegistration(value, golden.ids.scene).ok, false);
  }
});

test('group limits allow 128 groups and 16 levels, empty groups and repeated names without accepting extra depth', () => {
  const value = observed(), id = index => `${String(index).padStart(8, '0')}-3333-4333-8333-333333333333`;
  change(value, scene => { scene.groups = Array.from({ length: 128 }, (_, index) => ({ groupId: id(index), name: 'Same name', ...(index > 0 && index < 16 ? { parentGroupId: id(index - 1) } : {}) })); for (const actor of scene.actors) delete actor.groupId; });
  assert.equal(resolved(value).groups.length, 128);
  change(value, scene => { scene.groups[16].parentGroupId = id(15); });
  assert.ok(resolveScene2DModel(value, golden.ids.scene).diagnostics.some(item => item.code === 'build_group_depth' && item.propertyPath === '/groups/16/parentGroupId'));
  change(value, scene => { delete scene.groups[16].parentGroupId; scene.groups.push({ groupId: id(128), name: 'Too many' }); });
  assert.ok(resolveScene2DModel(value, golden.ids.scene).diagnostics.some(item => item.code === 'build_group_value' && item.propertyPath === '/groups'));
  change(value, scene => { scene.groups = []; }); assert.deepEqual(resolved(value).groups, []);
});

test('outline is deterministic, keeps source paint order in descendant IDs and searches groups, ancestors, actors and identities', () => {
  const declaration = plainScene(), actors = declaration.actors.map((actor, index) => ({ ...actor, name: index ? 'Navigator' : 'Traveler' }));
  actors.reverse(); actors.push({ ...actors[0], instanceId: actorId, groupId: undefined, name: 'Root visitor' }); delete actors[2].groupId;
  const before = structuredClone({ groups: declaration.groups, actors });
  const tree = buildSceneOutline(before);
  assert.deepEqual(tree.map(node => [node.kind, node.groupId || node.instanceId]), [['group', groupId], ['group', emptyId], ['actor', actorId]]);
  assert.deepEqual(tree[0].children.map(node => [node.kind, node.groupId || node.instanceId]), [['group', childId], ['actor', firstId]]);
  assert.deepEqual(tree[0].instanceIds, [secondId, firstId]);
  assert.deepEqual(buildSceneOutline(before, 'NAVIGATOR')[0].children[0].children.map(node => node.instanceId), [secondId]);
  assert.deepEqual(buildSceneOutline(before, 'NAVIGATOR')[0].instanceIds, [secondId, firstId]);
  assert.deepEqual(buildSceneOutline(before, 'party')[0], tree[0]);
  assert.equal(buildSceneOutline(before, '33333333').length, 0);
  assert.equal(buildSceneOutline(before, emptyId)[0].groupId, emptyId);
  const memberships = actors.map(({ instanceId, groupId }) => ({ instanceId, ...(groupId ? { groupId } : {}) }));
  const runtime = actors.map(({ groupId, ...actor }) => actor);
  assert.deepEqual(buildSceneOutline({ groups: declaration.groups, actors: runtime, memberships }), tree);
  assert.deepEqual(buildSceneOutline({ actors: [{ objectId: actorId, name: 'Legacy' }] }), [{ kind: 'actor', instanceId: actorId, objectId: actorId, name: 'Legacy' }]);
  assert.deepEqual(before, { groups: declaration.groups, actors });
  assert.throws(() => buildSceneOutline({ ...before, memberships: [{ instanceId: firstId, groupId: null }] }), TypeError);
  assert.throws(() => buildSceneOutline({ ...before, memberships: [{ instanceId: firstId }, { instanceId: firstId }] }), TypeError);
  assert.throws(() => buildSceneOutline({ ...before, memberships: [{ instanceId: sceneId }] }), TypeError);
  assert.throws(() => buildSceneOutline({ groups: [{ groupId, name: 'Loop', parentGroupId: groupId }], actors }), TypeError);
});

test('v3 group provenance follows stable group IDs after reorder and locates parent and escaped name text', () => {
  const value = observed(), model = resolved(value), document = value.source.documents.find(item => item.record.id === golden.ids.scene);
  const group = model.sourceLocations.groups.find(item => item.groupId === childId);
  assert.equal(group.declaration.propertyPath, '/groups/1'); assert.equal(group.fields.name.propertyPath, '/groups/1/name');
  assert.equal(parse(document.content.slice(group.fields.name.sourceRange.start, group.fields.name.sourceRange.end)), '同行者 / Companions');
  assert.equal(parse(document.content.slice(group.fields.parentGroupId.sourceRange.start, group.fields.parentGroupId.sourceRange.end)), groupId);
  assert.equal(model.sourceLocations.groups[0].fields.parentGroupId.sourceRange.exact, false);
  change(value, scene => { scene.groups.reverse(); });
  assert.equal(resolved(value).sourceLocations.groups.find(item => item.groupId === groupId).declaration.propertyPath, '/groups/2');
  assert.deepEqual(resolved(value).actors.map(sceneActorIdentity), model.actors.map(sceneActorIdentity));
});

test('v3 recovery rejects duplicate decoded group keys and source budget overflow without changing legacy recovery', () => {
  const value = observed(), source = value.source.documents.find(item => item.record.id === golden.ids.scene);
  source.content = source.content.replace('"schemaVersion": 3', '"schemaVersion": 1, "schemaVersion": 3');
  assert.equal(validateScene2DRegistration(value, golden.ids.scene).ok, false);
  const duplicate = observed(), duplicateSource = duplicate.source.documents.find(item => item.record.id === golden.ids.scene);
  duplicateSource.content = duplicateSource.content.replace('\"name\": \"旅人 / Party\"', '\"name\": \"Earlier\", \"na\\u006de\": \"旅人 / Party\"');
  assert.equal(resolveScene2DModel(duplicate, golden.ids.scene).ok, false);
  assert.equal(validateScene2DRegistration(duplicate, golden.ids.scene).ok, false);
  const limited = observed(), boundedSource = limited.source.documents.find(item => item.record.id === golden.ids.scene);
  boundedSource.content = boundedSource.content.replace('"groups":', `"title": ${'['.repeat(70)}0${']'.repeat(70)}, "groups":`);
  assert.equal(validateScene2DRegistration(limited, golden.ids.scene).ok, false);
  const legacy = structuredClone(golden.observed), old = legacy.source.documents.find(item => item.record.id === golden.ids.scene);
  old.content = old.content.replace('"schemaVersion": 1e0', '"schemaVersion": 3, "schemaVersion": 1e0');
  assert.equal(validateScene2DRegistration(legacy, golden.ids.scene).ok, true);
});

test('lossless group reorder and reparent preserve scalar spelling, actor paint order, BOM and CRLF', () => {
  const value = plainScene(), source = spelled(value).replace('"name": "旅人 / Party"', '"na\\u006de": "旅人 \\/ Party"'), candidate = structuredClone(value);
  candidate.groups.reverse(); candidate.groups[1].parentGroupId = emptyId; candidate.actors[0].groupId = childId;
  const edit = updateSceneContent(source, json(candidate));
  assert.deepEqual(parse(edit.afterContent), candidate); assert.ok(edit.changedPaths.includes('/groups'));
  assert.ok(edit.changedPaths.includes('/groups/1/parentGroupId')); assert.ok(edit.changedPaths.includes('/actors/0/groupId'));
  assert.ok(edit.afterContent.startsWith('\uFEFF')); assert.equal(/(?<!\r)\n/.test(edit.afterContent), false);
  assert.match(edit.afterContent, /"na\\u006de": "旅人 \\\/ Party"/); assert.match(edit.afterContent, /"speed": 1\.6e2/);
  assert.deepEqual(parse(edit.afterContent).actors.map(sceneActorIdentity), [firstId, secondId]);
  assert.equal(updateSceneContent(source, json(value)).afterContent, source);
});

for (const version of [1, 2]) test(`explicit v${version} group upgrade preserves actor fragments and refuses downgrade`, () => {
  const value = plainScene(); value.schemaVersion = version; delete value.groups;
  for (const actor of value.actors) delete actor.groupId;
  if (version === 1) { value.actors = [value.actors[0]]; delete value.actors[0].instanceId; }
  const source = spelled(value), candidate = structuredClone(value); candidate.schemaVersion = 3; candidate.groups = groups();
  if (version === 1) candidate.actors[0].instanceId = candidate.actors[0].objectId;
  candidate.actors[0].groupId = childId;
  const edit = updateSceneContent(source, json(candidate));
  assert.deepEqual(parse(edit.afterContent), candidate); assert.match(edit.afterContent, /"speed": 1\.6e2/);
  assert.throws(() => updateSceneContent(edit.afterContent, json(value)), error => error.errorCode === 'world_scene_invalid' && error.payload.diagnostics[0].propertyPath === '/schemaVersion');
});

test('group create/update preserve definition metadata, source paint order and dependencies; invalid trees make no writes', async t => {
  const f = await fixture(t), before = await fingerprint(f.root), preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.deepEqual(await fingerprint(f.root), before);
  assert.deepEqual(preview.changes[0].record.relations, [{ kind: 'references', targetId: actorId, slot: '' }]);
  assert.equal(preview.changes[0].record.assetBindings.length, 1);
  await f.execute(f.input); const record = await fs.readFile(path.join(f.root, recordPath), 'utf8');
  const candidate = structuredClone(f.value); candidate.groups.reverse(); candidate.groups[1].parentGroupId = emptyId; candidate.actors[0].groupId = childId;
  const updated = await f.execute(await updateRequest(f, candidate)), saved = await fs.readFile(path.join(f.root, sourcePath), 'utf8');
  assert.deepEqual(parse(saved), candidate); assert.equal(saved, updated.changes[0].afterText);
  assert.deepEqual(updated.changes[0].addedRelations, []); assert.deepEqual(updated.changes[0].addedBindings, []);
  assert.equal(await fs.readFile(path.join(f.root, recordPath), 'utf8'), record);
  const result = createScene2DPlan(await readWorldSnapshot(f.root), sceneId); assert.equal(result.ok, true, json(result.diagnostics));
  assert.deepEqual(result.plan.actors.map(sceneActorIdentity), [firstId, secondId]);
  for (const [name, hash] of Object.entries(before)) assert.equal((await fingerprint(f.root))[name], hash, name);
  const prior = await fingerprint(f.root); candidate.groups[0].parentGroupId = childId;
  await assert.rejects(f.execute(await updateRequest(f, candidate)), error => error.errorCode === 'world_scene_invalid');
  assert.deepEqual(await fingerprint(f.root), prior);
});

for (const command of ['create', 'update']) for (const committed of [false, true]) {
  test(`v3 grouped scene.${command} SIGKILL recovery ${committed ? 'commits' : 'rolls back'} exact group and instance bytes`, async t => {
    const f = await fixture(t); let before = [null, null];
    if (command === 'update') {
      await f.execute(f.input); before = await Promise.all([sourcePath, recordPath].map(name => fs.readFile(path.join(f.root, name), 'utf8')));
      const candidate = structuredClone(f.value); candidate.groups.reverse(); candidate.actors[0].groupId = childId;
      f.input = await updateRequest(f, candidate);
    }
    await crash(f, committed ? 'commit' : 'data', committed ? '-' : 1);
    const directory = path.join(f.root, '.viento/world-transactions/active'), intent = parse(await fs.readFile(path.join(directory, 'intent.json'), 'utf8'));
    assert.equal(intent.version, command === 'create' ? 5 : 8); assert.equal(intent.entries.length, 2);
    const after = await Promise.all([0, 1].map(index => fs.readFile(path.join(directory, `${index}.after`), 'utf8')));
    const external = '# Definition edited after crash\n'; await write(f.root, predecessor.sourcePath, external);
    assert.equal((await recoverWorldTransaction(f.root)).status, committed ? 'committed' : 'rolled-back');
    const actual = await Promise.all([sourcePath, recordPath].map(name => fs.readFile(path.join(f.root, name), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; })));
    assert.deepEqual(actual, committed ? after : before);
    if (committed) assert.deepEqual(parse(actual[0]), parse(f.input.content));
    assert.equal(await fs.readFile(path.join(f.root, predecessor.sourcePath), 'utf8'), external);
    assert.equal((await recoverWorldTransaction(f.root)).status, 'idle');
  });
}

for (const committed of [false, true]) test(`explicit v2 group upgrade recovers ${committed ? 'committed v3' : 'exact v2'} source without changing instance identities or metadata`, async t => {
  const f = await fixture(t), legacy = structuredClone(f.value); legacy.schemaVersion = 2; delete legacy.groups;
  for (const actor of legacy.actors) delete actor.groupId;
  f.input.content = spelled(legacy); await f.execute(f.input);
  const beforeSource = await fs.readFile(path.join(f.root, sourcePath), 'utf8'), beforeRecord = await fs.readFile(path.join(f.root, recordPath), 'utf8');
  const candidate = structuredClone(legacy); candidate.schemaVersion = 3; candidate.groups = groups(); candidate.actors[1].groupId = childId;
  f.input = await updateRequest(f, candidate); const preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.match(preview.changes[0].afterText, /"speed": 1\.6e2/);
  assert.deepEqual(preview.changes[0].addedRelations, []); assert.deepEqual(preview.changes[0].addedBindings, []);
  await crash(f, committed ? 'commit' : 'data', committed ? '-' : 0);
  assert.equal((await recoverWorldTransaction(f.root)).status, committed ? 'committed' : 'rolled-back');
  assert.equal(await fs.readFile(path.join(f.root, sourcePath), 'utf8'), committed ? preview.changes[0].afterText : beforeSource);
  assert.equal(await fs.readFile(path.join(f.root, recordPath), 'utf8'), beforeRecord);
  const model = resolveScene2DModel(await readWorldSnapshot(f.root), sceneId).model;
  assert.equal(model.schemaVersion, committed ? 3 : 2); assert.deepEqual(model.actors.map(sceneActorIdentity), [firstId, secondId]);
  if (committed) assert.deepEqual(model.groups, candidate.groups); else assert.equal(Object.hasOwn(model, 'groups'), false);
});

test('recovery refuses forged group cycles even with recomputed journal image hashes', async t => {
  const f = await fixture(t); await crash(f, 'intent');
  const directory = path.join(f.root, '.viento/world-transactions/active'), file = path.join(directory, '0.after');
  const content = parse(await fs.readFile(file, 'utf8')); content.groups[0].parentGroupId = childId;
  const after = json(content); await fs.writeFile(file, after);
  const intent = parse(await fs.readFile(path.join(directory, 'intent.json'), 'utf8')); intent.entries[0].after = transactionHash(after);
  await fs.writeFile(path.join(directory, 'intent.json'), json(intent)); const before = await fingerprint(f.root);
  await assert.rejects(recoverWorldTransaction(f.root), error => error.errorCode === 'world_journal_invalid');
  assert.deepEqual(await fingerprint(f.root), before);
});

test('resource package migration retains nested groups and memberships and deduplicates shared definition, owned story and image', async t => {
  const f = await fixture(t); await f.execute(f.input);
  const candidate = structuredClone(f.value); candidate.groups.reverse(); candidate.actors[0].groupId = childId; await f.execute(await updateRequest(f, candidate));
  const before = await fingerprint(f.root), catalog = await readPackageCatalog(f.root);
  const exported = await planExport(f.root, { kind: 'resources', ids: [sceneId], revision: catalog.revision });
  assert.equal(exported.documentCount, 3); assert.equal(exported.assetCount, 1);
  const zip = path.join(f.temporary, 'scene.zip'); await writeExportZip(exported, zip);
  const directory = path.join(f.temporary, 'unpacked'); await fs.mkdir(directory); const pack = await unpackResourcePackage(zip, directory);
  assert.deepEqual(new Set(pack.manifest.documents.map(item => item.id)), new Set([sceneId, actorId, storyId]));
  assert.deepEqual(pack.manifest.assets.map(item => item.id), [imageId]);
  const target = path.join(f.temporary, 'imported'), manifest = parse(predecessor.files['workspace.json']);
  manifest.id = randomUUID(); manifest.name = 'Imported groups'; await write(target, 'workspace.json', json(manifest));
  for (const [name, content] of Object.entries(predecessor.files)) if (name.startsWith('templates/')) await write(target, name, content);
  await registerWorkspace(target); const planned = await planPackageImport(target, pack); assert.deepEqual(planned.summary.conflicts, []);
  assert.equal((await applyPackageImport(target, pack, planned.revision)).status, 'imported');
  for (const name of [sourcePath, recordPath, predecessor.sourcePath, 'documents/stories/origin.md', 'assets/reference.svg']) assert.deepEqual(await fs.readFile(path.join(target, name)), await fs.readFile(path.join(f.root, name)), name);
  const original = await captureBuildSnapshot(f.root, sceneId), restored = await captureBuildSnapshot(target, sceneId);
  assert.equal(restored.ok, true, json(restored.diagnostics)); assert.equal(restored.plan.schemaVersion, 2);
  assert.deepEqual(restored.plan.actors, original.plan.actors); assert.deepEqual(restored.plan.resources, original.plan.resources);
  const model = resolveScene2DModel(await readWorldSnapshot(target), sceneId).model;
  assert.deepEqual(model.groups, candidate.groups); assert.deepEqual(model.actors.map(actor => actor.groupId), [childId, childId]);
  assert.deepEqual(await fingerprint(f.root), before);
});
