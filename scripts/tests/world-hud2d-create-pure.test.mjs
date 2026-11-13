import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareHUD2DCreate, inspectHUD2DCreateScene, validateHUD2DCreateRecovery, HUD2D_CREATE_RECOVERY_LIMITS } from '../../engine/world-hud2d-create.mjs';
import { createWorldProjection, canonicalJson } from '../../engine/world-projection.mjs';
import { validateWorldCommand, worldMutationDescriptors } from '../../engine/world-command-contract.mjs';
import { sceneHUD2DFixture, hudId, hudDigest as digest, hudDocument } from './helpers/scene-hud2d-fixture.mjs';
for (const schemaVersion of [1, 2, 3]) test(`HUD first create publishes only source and two registrations for Scene2D ${schemaVersion}`, async () => {
  const f = await sceneHUD2DFixture({ schemaVersion }), before = canonicalJson(f.source), plan = await prepareHUD2DCreate(f.source, f.projection, f.sceneRecordContent, f.request, { digest });
  assert.equal(canonicalJson(f.source), before); assert.equal(plan.kind, 'hud2d.create'); assert.equal(plan.plans.length, 3); assert.equal(plan.plans[0].afterContent, f.request.content);
  assert.equal(plan.plans[0].beforeContent, null); assert.equal(plan.plans[1].beforeContent, null); assert.equal(plan.plans[2].beforeContent, f.sceneRecordContent);
  assert.ok(plan.plans[2].afterContent.startsWith('\ufeff')); assert.ok(plan.plans[2].afterContent.includes('\r\n'));
  const registration = JSON.parse(plan.plans[1].afterContent); assert.deepEqual(registration.relations, [{ kind: 'references', targetId: f.sceneId, slot: 'scene' }]);
  assert.equal(plan.result.relation.properties.slot, 'hud2d'); assert.deepEqual(plan.result.changes.map(row => row.kind), ['hud2d.create', 'relation.add']);
  const next = await createWorldProjection(plan.nextSource, { digest }), context = inspectHUD2DCreateScene(plan.nextSource, next, f.sceneId);
  assert.equal(context.manifest.record.id, f.request.objectId); assert.equal(context.definitions.length, 1); assert.ok(Object.isFrozen(plan.hud2DRecovery.definitions));
  assert.equal(plan.nextSource.documents.find(doc => doc.record.id === f.sceneId).content, f.scene.content);
});
test('first HUD rejects duplicate opt-ins, stale revision, foreign owner, invalid source and paths without mutating source', async () => {
  const f = await sceneHUD2DFixture(), before = canonicalJson(f.source), run = patch => prepareHUD2DCreate(f.source, f.projection, f.sceneRecordContent, { ...f.request, ...patch }, { digest });
  for (const patch of [{ baseRevision: 'sha256:' + '0'.repeat(64) }, { sceneSourceRevision: 'sha256:' + '0'.repeat(64) },
    { content: JSON.stringify(hudDocument([], hudId(777))) }, { content: '{}' }, { sourcePath: 'documents/hud/not-json.txt' }]) await assert.rejects(run(patch));
  assert.equal(canonicalJson(f.source), before);
  const plan = await run({}), next = await createWorldProjection(plan.nextSource, { digest }), scene = next.objects.find(row => row.id === f.sceneId);
  await assert.rejects(prepareHUD2DCreate(plan.nextSource, next, plan.plans[2].afterContent, { ...f.request, objectId: hudId(888), baseRevision: next.world.revision, sceneObjectRevision: scene.revision }, { digest }), { errorCode: 'world_hud2d_invalid' });
});
test('HUD recovery verifies exact frozen scene/OC evidence, hashes, reverse slot and forward link before authorization', async () => {
  const f = await sceneHUD2DFixture(), plan = await prepareHUD2DCreate(f.source, f.projection, f.sceneRecordContent, f.request, { digest });
  const record = JSON.parse(plan.plans[1].afterContent), scene = JSON.parse(plan.plans[2].afterContent.slice(1));
  const check = (r = record, s = scene, evidence = plan.hud2DRecovery) => validateHUD2DCreateRecovery(r, f.request.content, s, evidence, f.registry(), { digest });
  assert.equal((await check()).ok, true);
  for (const mutate of [value => { value.scene.content += ' '; }, value => { value.definitions[0].content += 'tamper'; },
    value => { value.definitions.push(value.definitions[0]); }, value => { value.definitions = []; }, value => { value.extra = true; }]) {
    const evidence = structuredClone(plan.hud2DRecovery); mutate(evidence); assert.equal((await check(record, scene, evidence)).ok, false);
  }
  const reverse = structuredClone(record); reverse.relations[0].slot = ''; assert.equal((await check(reverse)).ok, false);
  const forward = structuredClone(scene); forward.relations = forward.relations.filter(row => row.slot !== 'hud2d'); assert.equal((await check(record, forward)).ok, false);
  let calls = 0; const evidence = structuredClone(plan.hud2DRecovery); Object.defineProperty(evidence.scene, 'content', { enumerable: true, get() { calls++; return f.scene.content; } });
  assert.equal((await check(record, scene, evidence)).ok, false); assert.equal(calls, 0); assert.equal(HUD2D_CREATE_RECOVERY_LIMITS.definitions, 128);
});
test('HUD command is discoverable and captures request data before asynchronous digest work', async () => {
  const f = await sceneHUD2DFixture(), descriptor = worldMutationDescriptors().find(row => row.id === 'hud2d.create'); assert.equal(descriptor.inputSchema.properties.content.maxLength, 65536);
  assert.equal(validateWorldCommand(f.request).command, 'hud2d.create');
  const input = { ...f.request, actorRef: { ...f.request.actorRef } }, delayed = async value => { input.actorRef.id = 'changed'; return digest(value); };
  const plan = await prepareHUD2DCreate(f.source, f.projection, f.sceneRecordContent, input, { digest: delayed }); assert.equal(plan.result.proposal.actorRef.id, 'studio-hud2d-create');
  let calls = 0; const getter = { ...f.request }; Object.defineProperty(getter, 'content', { enumerable: true, get() { calls++; return f.request.content; } });
  assert.throws(() => validateWorldCommand(getter), { errorCode: 'world_command_invalid' }); assert.equal(calls, 0);
});
