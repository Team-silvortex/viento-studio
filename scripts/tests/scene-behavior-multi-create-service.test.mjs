import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSceneBehaviorCreationDraft } from '../../engine/scene-behavior-create-plan.mjs';
import { createScene2DPlan } from '../../engine/build-plan.mjs';
import { createSceneBehaviorCreationService } from '../lib/scene-behavior-creation-service.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { behaviorFixture, fingerprint, targetContents, json, sceneId, scriptId, manifestId, actorId, journal } from './helpers/world-behavior-create-fixture.mjs';

const secondScriptId = '77777777-7777-4777-8777-777777777777';
const thirdInstanceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const thirdBindingId = '99999999-9999-4999-8999-999999999993';

async function multiFixture(t, version = 3) {
  const f = await behaviorFixture(t, version);
  const secondScriptPath = `${f.documents}/scripts/secondary.txt`;
  const secondScript = 'extends Node\n\nfunc _ready():\n\tpass # distinct registered source, never executed by creation\n';
  const sourceRecord = JSON.parse(await fs.readFile(path.join(f.root, `metadata/documents/${scriptId}.json`), 'utf8'));
  await fs.writeFile(path.join(f.root, secondScriptPath), secondScript);
  await fs.writeFile(path.join(f.root, `metadata/documents/${secondScriptId}.json`), json({ ...sourceRecord,
    id: secondScriptId, sourcePath: secondScriptPath }));
  const scene = JSON.parse(await fs.readFile(path.join(f.root, f.scenePath), 'utf8'));
  scene.actors.push({ ...structuredClone(scene.actors[0]), instanceId: thirdInstanceId, position: [350, 360] });
  await fs.writeFile(path.join(f.root, f.scenePath), json(scene));

  const beforeCatalog = await fingerprint(f.root);
  const catalog = await createSceneBehaviorCreationService(f.root).inspect({ sceneObjectId: sceneId });
  assert.deepEqual(await fingerprint(f.root), beforeCatalog, 'Reading the creation catalog must not change author files');
  assert.equal(catalog.scene.instances.length, 3);
  assert.deepEqual(catalog.sources.map(source => source.objectId).sort(), [scriptId, secondScriptId].sort());
  const bindings = [...f.manifest.bindings.map((binding, index) => ({ bindingId: binding.bindingId,
    instanceId: binding.instanceId, sourceObjectId: index === 0 ? scriptId : secondScriptId })),
  { bindingId: thirdBindingId, instanceId: thirdInstanceId, sourceObjectId: scriptId }];
  const planned = createSceneBehaviorCreationDraft({ sceneObjectId: sceneId, backendId: 'org.viento.godot4', language: 'gdscript', bindings });
  assert.equal(planned.ok, true);
  assert.deepEqual(planned.sourceObjectIds, [scriptId, secondScriptId].sort());
  f.input = { ...f.input, worldId: catalog.worldId, baseRevision: catalog.baseRevision,
    sceneObjectRevision: catalog.scene.objectRevision, sceneSourceRevision: catalog.scene.sourceRevision, content: planned.content };
  return { ...f, catalog, bindings, secondScriptPath, secondScript };
}

for (const version of [2, 3]) test(`workspace v${version}: creation catalog and source planner publish three bindings with two deduplicated scripts in one transaction`, async t => {
  const f = await multiFixture(t, version), before = await fingerprint(f.root);
  const preview = await f.execute({ ...f.input, mode: 'preview' });
  assert.deepEqual(await fingerprint(f.root), before, 'Review is read only');
  assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  assert.deepEqual(preview.changes.map(change => change.kind), ['behavior.create', 'relation.add']);
  assert.equal(preview.proposal.affectedObjects.length, 2);
  assert.deepEqual(preview.changes[0].record.relations, [sceneId, scriptId, secondScriptId].sort()
    .map(targetId => ({ kind: 'references', targetId, slot: '' })));

  const applied = await f.execute(f.input), observed = await readWorldSnapshot(f.root);
  assert.equal(applied.status, 'applied'); assert.equal(applied.receipt.state, 'committed');
  assert.equal(applied.revision, preview.revision); assert.equal(observed.projection.world.revision, preview.revision);
  const [content, recordText, sceneRecordText] = await targetContents(f), record = JSON.parse(recordText);
  assert.equal(content, f.input.content, 'The transaction retains exactly the reviewed manifest');
  const manifest = JSON.parse(content);
  assert.deepEqual(manifest.bindings.map(binding => ({ bindingId: binding.bindingId, instanceId: binding.instanceId,
    sourceObjectId: binding.implementation.sourceObjectId })), f.bindings, 'Binding order and identities survive publication');
  assert.ok(manifest.bindings.every(binding => Object.keys(binding.parameters).length === 0 && binding.events.length === 0));
  assert.deepEqual(record.relations, preview.changes[0].record.relations);
  assert.equal(record.relations.length, 3, 'The repeated first script produces just one metadata dependency');
  assert.deepEqual(JSON.parse(sceneRecordText).relations.filter(relation => relation.kind === 'behavior'),
    [{ kind: 'behavior', targetId: manifestId, slot: '' }]);
  assert.ok(sceneRecordText.includes('900719925474099312345'), 'Unrelated large metadata numbers retain their exact digits');
  assert.ok(sceneRecordText.includes('\r\n'), 'Existing scene metadata line endings are preserved');

  const plan = createScene2DPlan(observed, sceneId);
  assert.equal(plan.ok, true, JSON.stringify(plan.diagnostics)); assert.equal(plan.plan.schemaVersion, 3);
  assert.equal(plan.plan.actors.length, 3); assert.equal(plan.plan.behaviors.bindings.length, 3); assert.equal(plan.plan.behaviors.sources.length, 2);
  assert.deepEqual(plan.plan.behaviors.bindings.map(binding => ({ bindingId: binding.bindingId, instanceId: binding.instanceId,
    sourceObjectId: binding.implementation.sourceObjectId })), f.bindings);
  assert.ok(plan.plan.behaviors.bindings.every(binding => binding.objectId === actorId));
  assert.deepEqual(plan.plan.behaviors.sources.map(source => ({ objectId: source.objectId, sourcePath: source.sourcePath, sourceRevision: source.sourceRevision })),
    [...f.catalog.sources].sort((a, b) => a.objectId.localeCompare(b.objectId)).map(({ objectId, sourcePath, sourceRevision }) => ({ objectId, sourcePath, sourceRevision })));
  for (const source of plan.plan.behaviors.sources) assert.equal(source.content, await fs.readFile(path.join(f.root, source.sourcePath), 'utf8'));

  const after = await fingerprint(f.root);
  for (const [name, hash] of Object.entries(before)) if (name !== f.files[2]) assert.equal(after[name], hash, `${name}: author content must stay unchanged`);
  assert.deepEqual(Object.keys(after).filter(name => !Object.hasOwn(before, name)).sort(),
    [f.files[0], f.files[1], `${journal}/head.json`].sort(), 'Only the manifest, registration and transaction head are new');
});

test('editing the second registered script after review rejects all three-target publication and preserves the external edit', async t => {
  const f = await multiFixture(t); await f.execute({ ...f.input, mode: 'preview' });
  const replacement = f.secondScript + '\n# changed after source review\n';
  await fs.writeFile(path.join(f.root, f.secondScriptPath), replacement);
  const beforeApply = await fingerprint(f.root);
  await assert.rejects(f.execute(f.input), { errorCode: 'world_revision_conflict' });
  assert.deepEqual(await fingerprint(f.root), beforeApply);
  assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  assert.equal(await fs.readFile(path.join(f.root, f.secondScriptPath), 'utf8'), replacement);
});

test('the second script is frozen through the before-intent recheck, with no published or staged author files after conflict', async t => {
  const f = await multiFixture(t); await f.execute({ ...f.input, mode: 'preview' });
  const before = await fingerprint(f.root), originalRename = fs.rename;
  let changed = false;
  fs.rename = async (from, to) => {
    const result = await originalRename.call(fs, from, to);
    if (!changed && String(to).endsWith('/behavior-dependencies.json')) {
      changed = true;
      await fs.appendFile(path.join(f.root, f.secondScriptPath), '\n# concurrent second source edit before intent\n');
    }
    return result;
  };
  try { await assert.rejects(f.execute(f.input), { errorCode: 'world_revision_conflict' }); }
  finally { fs.rename = originalRename; }
  assert.equal(changed, true, 'The change was injected after dependency staging, before transaction intent');
  assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  assert.deepEqual(await fs.readdir(path.join(f.root, journal)), [], 'Unpublished staging is removed');
  const after = await fingerprint(f.root);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const [name, hash] of Object.entries(before)) if (name !== f.secondScriptPath) assert.equal(after[name], hash, name);
  assert.notEqual(after[f.secondScriptPath], before[f.secondScriptPath]);
});

test('a destination occupied after review keeps the foreign file and never creates registration or scene behavior relation', async t => {
  const f = await multiFixture(t); await f.execute({ ...f.input, mode: 'preview' });
  const foreign = '{"ownedBy":"external-author","keep":"路径被占用"}\n';
  await fs.writeFile(path.join(f.root, f.input.sourcePath), foreign);
  const beforeApply = await fingerprint(f.root);
  await assert.rejects(f.execute(f.input), error => ['world_revision_conflict', 'world_create_path_conflict'].includes(error.errorCode));
  assert.deepEqual(await fingerprint(f.root), beforeApply);
  assert.deepEqual(await targetContents(f), [foreign, null, f.sceneRecord]);
});
