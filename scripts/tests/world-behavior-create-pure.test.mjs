import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import { createProjectModel } from '../../engine/project.mjs';
import { createWorldProjection, canonicalJson } from '../../engine/world-projection.mjs';
import { worldMutationDescriptors, validateWorldCommand, RELATION_KINDS } from '../../engine/world-command-contract.mjs';
import { prepareBehaviorCreate, inspectBehaviorCreateScene, behaviorCreateRegistration, appendSceneBehaviorRelation,
  behaviorCreationRegistryGuard, validateBehaviorCreateRecovery, BEHAVIOR_CREATE_RECOVERY_LIMITS } from '../../engine/world-behavior-create.mjs';
import { createScene2DPlan } from '../../engine/build-plan.mjs';

const id = value => `${value.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const digest = value => createHash('sha256').update(value).digest('hex');
const revision = value => `sha256:${digest(value)}`;
const clone = value => structuredClone(value);
const actorId = id(1), sceneId = id(2), scriptId = id(3), manifestId = id(4), instanceA = id(5), instanceB = id(6);
const manifest = () => ({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: sceneId,
  bindings: [instanceA, instanceB].map((instanceId, index) => ({ bindingId: id(10 + index), instanceId,
    implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: scriptId },
    parameters: { speed: index ? 2.5 : 1, enabled: true, label: '中 / 日本語' }, events: [{ signal: 'arrived', event: 'checkpoint' }] })) });

async function fixture(version = 3, schemaVersion = 2) {
  const workspace = { format: 'viento-workspace', version, id: id(99), name: 'Synthetic behavior creation', createdAt: 1,
    documentTypes: [{ id: 'document', label: 'Document', directory: '', parserProfile: 'structured' }] };
  const model = createProjectModel({ paths: { documents: 'documents', templates: 'templates', metadata: 'metadata' }, documentTypes: workspace.documentTypes, templates: {} });
  const definition = model.projectDefinition(workspace), root = definition.paths.documents;
  const document = (objectId, relative, content, relations = []) => {
    const sourcePath = `${root}/${relative}`, record = { format: 'viento-document', version: 1, id: objectId, sourcePath,
      documentType: 'document', parserProfile: 'structured', relations, assetBindings: [] };
    return { record, sourcePath, content, sourceRevision: revision(content), descriptor: model.resolveDocumentDefinition(workspace, sourcePath, record) };
  };
  const declaration = { format: 'viento-scene2d', schemaVersion, title: 'Repeated actors', viewport: [640, 480], background: '#0d1829',
    ...(schemaVersion === 3 ? { groups: [] } : {}), actors: [instanceA, instanceB].map(instanceId => ({ instanceId, objectId: actorId,
      position: [20, 30], size: [20, 20], color: '#ffffff', speed: 0, controls: 'none' })) };
  const scene = document(sceneId, 'scenes/demo.json', '\uFEFF' + JSON.stringify(declaration, null, 2).replaceAll('\n', '\r\n') + '\r\n',
    [{ kind: 'references', targetId: actorId, slot: 'definition' }]);
  const sceneRecordContent = '\uFEFF' + JSON.stringify(scene.record, null, 2).replace('"assetBindings": []', '"assetBindings": [], "extension": {"count":9007199254740993,"text":"\\u4e2d","number":1e2}')
    .replaceAll('\n', '\r\n') + '\r\n';
  scene.record = JSON.parse(sceneRecordContent.slice(1)); scene.descriptor = model.resolveDocumentDefinition(workspace, scene.sourcePath, scene.record);
  const source = { workspace, definition, documents: [document(actorId, 'actors/traveler.md', '# Traveler\n\nLife: 100\n'), scene,
    document(scriptId, 'scripts/checkpoint.txt', '\uFEFFextends Node\r\n# this is author data, never executed\r\n')], assets: [] };
  const projection = await createWorldProjection(source, { digest }), sceneObject = projection.objects.find(object => object.id === sceneId);
  const content = '\uFEFF' + JSON.stringify(manifest(), null, 2).replaceAll('\n', '\r\n') + '\r\n';
  const request = { command: 'behavior.create', mode: 'preview', worldId: projection.world.id, baseRevision: projection.world.revision,
    actorRef: { kind: 'tool', id: 'pure-behavior-test' }, objectId: manifestId, documentType: 'document', sourcePath: `${root}/behaviors/demo.json`, content,
    sceneObjectId: sceneId, sceneObjectRevision: sceneObject.revision, sceneSourceRevision: scene.sourceRevision };
  const registry = () => ({ documents: source.documents.map(document => document.record), assets: [] });
  return { source, projection, request, sceneRecordContent, scene, registry,
    run: (patch = {}, options = { digest }) => prepareBehaviorCreate(source, projection, sceneRecordContent, { ...request, ...patch }, options) };
}

for (const [version, schemaVersion] of [[2, 2], [3, 2], [3, 3]]) test(`behavior.create workspace ${version} / scene ${schemaVersion} predicts three exact writes and a usable v3 build without touching inputs`, async () => {
  const f = await fixture(version, schemaVersion), before = canonicalJson(f.source), plan = await f.run();
  assert.equal(canonicalJson(f.source), before); assert.equal(plan.kind, 'behavior.create'); assert.equal(plan.plans.length, 3);
  assert.deepEqual(plan.plans.map(item => item.beforeContent), [null, null, f.sceneRecordContent]);
  assert.deepEqual(plan.plans.map(item => item.change.objectId), [manifestId, manifestId, sceneId]);
  assert.equal(plan.plans[0].afterContent, f.request.content);
  assert.equal(plan.plans[2].afterContent.replace(', {"kind":"behavior","targetId":"' + manifestId + '","slot":""}', ''), f.sceneRecordContent);
  assert.match(plan.plans[2].afterContent, /9007199254740993/); assert.match(plan.plans[2].afterContent, /\\u4e2d/); assert.match(plan.plans[2].afterContent, /1e2/);
  assert.deepEqual(plan.result.changes[0].record.relations, [sceneId, scriptId].map(targetId => ({ kind: 'references', targetId, slot: '' })));
  assert.deepEqual(plan.result.changes[0].record.assetBindings, []);
  assert.equal(plan.result.changes[0].afterSourceRevision, revision(f.request.content));
  assert.equal(plan.result.object.documentRefs[0].sourceRevision, revision(f.request.content));
  assert.equal(plan.result.scene.id, sceneId); assert.equal(plan.result.relation.properties.kind, 'behavior');
  assert.deepEqual(plan.result.proposal.affectedObjects, [manifestId, sceneId]);
  assert.deepEqual(plan.result.proposal.preconditions.map(item => item.objectId), [actorId, sceneId, scriptId]);
  const { mode, ...input } = f.request; assert.deepEqual(plan.result.proposal.commands, [{ id: 'behavior.create', input }]);
  assert.equal((await f.run({ mode: 'apply' })).result.proposal.id, plan.result.proposal.id);
  for (const document of f.source.documents) assert.equal(plan.nextSource.documents.find(item => item.record.id === document.record.id).content, document.content);
  const next = await createWorldProjection(plan.nextSource, { digest }), build = createScene2DPlan({ source: plan.nextSource, projection: next }, sceneId);
  assert.equal(next.world.revision, plan.result.revision); assert.equal(build.ok, true, JSON.stringify(build.diagnostics));
  assert.equal(build.plan.schemaVersion, 3); assert.equal(build.plan.behaviors.bindings.length, 2);
  assert.deepEqual(build.plan.behaviors.bindings.map(binding => binding.instanceId), [instanceA, instanceB]);
  assert.equal(build.plan.behaviors.sources.length, 1); assert.equal(build.plan.behaviors.sources[0].content, f.source.documents[2].content);
});

test('behavior descriptor has its own strict request and keeps generic relation.add closed', async () => {
  const f = await fixture(), descriptor = worldMutationDescriptors().find(item => item.id === 'behavior.create');
  assert.ok(descriptor); assert.equal(descriptor.undoMode, 'none'); assert.deepEqual(descriptor.requiredCapabilities, ['world.read', 'document.write']);
  assert.deepEqual(validateWorldCommand(f.request), f.request); assert.deepEqual(RELATION_KINDS, ['part-of', 'references']);
  for (const patch of [{ command: 'scene.create' }, { force: true }, { sceneObjectId: '../bad' }, { content: 'x'.repeat(32769) },
    { sceneSourceRevision: 'bad' }, { sceneObjectRevision: undefined }, { content: '\ud800' }]) {
    assert.throws(() => validateWorldCommand({ ...f.request, ...patch }), { errorCode: 'world_command_invalid' });
  }
  let calls = 0;
  for (const key of ['command', 'content', 'actorRef']) {
    const request = { ...f.request }; Object.defineProperty(request, key, { get() { calls++; return f.request[key]; }, enumerable: true });
    assert.throws(() => validateWorldCommand(request), { errorCode: 'world_command_invalid' });
  }
  const request = { ...f.request, actorRef: Object.create({ toJSON() { calls++; return f.request.actorRef; } }) };
  assert.throws(() => validateWorldCommand(request), { errorCode: 'world_command_invalid' });
  assert.equal(calls, 0);
  const ajv = new Ajv(), plan = await f.run();
  for (const [name, value] of [['command-descriptor', descriptor], ['changeset', plan.result.proposal]]) {
    const validate = ajv.compile(JSON.parse(await fs.readFile(new URL(`../../schemas/${name}-v1.schema.json`, import.meta.url))));
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
  }
  const { command, ...args } = f.request;
  assert.equal(ajv.compile(descriptor.inputSchema)(args), true); assert.equal(ajv.compile(descriptor.outputSchema)(plan.result), true);
  assert.throws(() => validateWorldCommand({ ...f.request, actorRef: { kind: 'user', id: '\ud800' } }), { errorCode: 'world_command_invalid' });
});

test('creation keeps the same binding identity and remains engine-neutral', async () => {
  const f = await fixture(), value = manifest(); value.bindings.forEach(binding => { binding.implementation.backendId = 'org.example.native'; binding.implementation.language = 'experimental'; });
  const plan = await f.run({ content: JSON.stringify(value) });
  assert.deepEqual(JSON.parse(plan.plans[0].afterContent).bindings.map(binding => binding.bindingId), [id(10), id(11)]);
  assert.deepEqual(inspectBehaviorCreateScene(f.source, f.projection, sceneId).instances, [{ instanceId: instanceA, objectId: actorId }, { instanceId: instanceB, objectId: actorId }]);
});

test('stale world, object and scene source reject before creating any plan', async () => {
  const f = await fixture();
  for (const key of ['baseRevision', 'sceneObjectRevision', 'sceneSourceRevision']) await assert.rejects(f.run({ [key]: revision('stale') }), { errorCode: 'world_revision_conflict' });
  await assert.rejects(f.run({ worldId: 'other-world' }), { errorCode: 'world_revision_conflict' });
  await assert.rejects(prepareBehaviorCreate(f.source, f.projection, f.sceneRecordContent.replace('9007199254740993', '42'), f.request, { digest }), { errorCode: 'world_revision_conflict' });
  f.scene.content += '\n'; await assert.rejects(f.run(), { errorCode: 'world_revision_conflict' });
});

test('first creation refuses existing, dangling and duplicate behavior opt-ins and ownership-only actors', async () => {
  for (const relations of [[{ kind: 'behavior', targetId: manifestId }], [{ kind: 'behavior', targetId: id(98) }],
    [{ kind: 'behavior', targetId: manifestId }, { kind: 'behavior', targetId: id(98) }]]) {
    const f = await fixture(); f.scene.record.relations.push(...relations);
    assert.throws(() => inspectBehaviorCreateScene(f.source, f.projection, sceneId), { errorCode: 'world_behavior_invalid' });
    await assert.rejects(f.run(), { errorCode: 'world_behavior_invalid' });
  }
  const f = await fixture(); f.scene.record.relations[0].kind = 'part-of';
  await assert.rejects(f.run(), { errorCode: 'world_behavior_invalid' });
});

test('malformed manifest, wrong scene, bad instance, scalar types and missing or oversized script all reject', async () => {
  const f = await fixture();
  for (const edit of [value => { value.sceneObjectId = id(97); }, value => { value.bindings = []; }, value => { value.bindings[0].instanceId = id(97); },
    value => { value.bindings[0].parameters.speed = null; }, value => { value.bindings[0].implementation.sourceObjectId = actorId; },
    value => { value.bindings[0].implementation.sourceObjectId = id(97); }, value => { value.bindings[1].bindingId = value.bindings[0].bindingId; },
    value => { value.bindings[1].implementation.language = 'rust'; }]) {
    const value = manifest(); edit(value); await assert.rejects(f.run({ content: JSON.stringify(value) }), { errorCode: 'world_behavior_invalid' });
  }
  for (const content of ['{}', '{broken', '{"format":"viento-scene-behaviors","schemaVersion":1,"schemaVersion":1}', JSON.stringify(manifest()).replace('"speed":1', '"speed":1e999')]) {
    await assert.rejects(f.run({ content }), { errorCode: 'world_behavior_invalid' });
  }
  f.source.documents[2].content = 'x'.repeat(65537);
  await assert.rejects(f.run(), { errorCode: 'world_behavior_invalid' });
});

test('Scene2D v1, unknown schema, invalid unbound actors and unavailable definitions cannot enter first behavior catalog', async () => {
  for (const change of [value => { value.schemaVersion = 1; }, value => { value.schemaVersion = 4; }, value => { value.actors[1].instanceId = instanceA; },
    value => { value.actors[1].size = [0, 20]; }, value => { value.actors[1].objectId = id(98); }]) {
    const f = await fixture(), value = JSON.parse(f.scene.content.slice(1)); change(value); f.scene.content = JSON.stringify(value);
    assert.throws(() => inspectBehaviorCreateScene(f.source, f.projection, sceneId), { errorCode: 'world_behavior_invalid' });
  }
  const f = await fixture(); f.source.documents[0].content = null;
  assert.throws(() => inspectBehaviorCreateScene(f.source, f.projection, sceneId), { errorCode: 'world_behavior_invalid' });
});

test('source path, type and UUID collision gates reuse object.create', async () => {
  const f = await fixture();
  for (const [patch, errorCode] of [[{ sourcePath: 'documents/new.txt' }, 'world_behavior_invalid'], [{ sourcePath: 'outside/new.json' }, 'world_create_path_invalid'],
    [{ sourcePath: f.scene.sourcePath }, 'world_create_path_conflict'], [{ objectId: actorId }, 'world_identity_conflict'], [{ documentType: 'missing' }, 'world_type_unknown']]) {
    await assert.rejects(f.run(patch), { errorCode });
  }
});

test('request is detached before async digest and the derived dependency evidence is deeply frozen', async () => {
  const f = await fixture(), original = clone(f.request); let changed = false;
  const plan = await prepareBehaviorCreate(f.source, f.projection, f.sceneRecordContent, f.request, { digest: async text => {
    if (!changed) { changed = true; f.request.content = '{}'; f.request.objectId = id(97); f.request.actorRef.id = 'changed'; }
    return digest(text);
  } });
  assert.equal(plan.plans[0].afterContent, original.content); assert.equal(plan.result.object.id, original.objectId);
  assert.equal(plan.result.proposal.actorRef.id, original.actorRef.id);
  assert.ok(Object.isFrozen(plan.behaviorRecovery.scripts[0])); assert.throws(() => { plan.behaviorRecovery.scene.content = ''; }, TypeError);
});

test('recovery validates frozen inputs without current author sources and registry guard survives every partial publish state', async () => {
  const f = await fixture(), plan = await f.run(), record = plan.result.changes[0].record, sceneRecord = JSON.parse(plan.plans[2].afterContent.slice(1));
  const check = (evidence = plan.behaviorRecovery, registry = f.registry()) => validateBehaviorCreateRecovery(record, f.request.content, sceneRecord, evidence, registry, { digest });
  assert.equal((await check()).ok, true);
  f.source.documents.forEach(document => { document.content = '# External edit after journal'; });
  assert.equal((await check()).ok, true, 'recovery reads frozen bytes, not current content');
  const registry = f.registry(), before = behaviorCreationRegistryGuard(registry, manifestId, sceneId);
  registry.documents.push(record); assert.equal(behaviorCreationRegistryGuard(registry, manifestId, sceneId), before);
  registry.documents = registry.documents.map(item => item.id === sceneId ? sceneRecord : item);
  assert.equal(behaviorCreationRegistryGuard(registry, manifestId, sceneId), before);
  registry.documents.find(item => item.id === scriptId).extension = 'changed';
  assert.notEqual(behaviorCreationRegistryGuard(registry, manifestId, sceneId), before);
});

test('recovery rejects altered hashes, extra or missing evidence, mismatched registration, hostile accessors and sparse arrays', async () => {
  const f = await fixture(), plan = await f.run(), record = plan.result.changes[0].record, sceneRecord = JSON.parse(plan.plans[2].afterContent.slice(1));
  const check = input => validateBehaviorCreateRecovery(record, f.request.content, sceneRecord, input, f.registry(), { digest });
  for (const edit of [value => { value.scene.content += '\n'; }, value => { value.scripts = []; }, value => { value.definitions = []; },
    value => { value.scripts.push(clone(value.scripts[0])); }, value => { value.extra = true; }, value => { value.definitions[0].sourcePath = 'documents/elsewhere.md'; },
    value => { value.scene.extra = true; }, value => { value.scene.content = '\ud800'; }, value => { value.scripts = new Array(1); },
    value => { value.scripts[0].content = 'x'.repeat(BEHAVIOR_CREATE_RECOVERY_LIMITS.scriptBytes + 1); }]) {
    const evidence = clone(plan.behaviorRecovery); edit(evidence); assert.equal((await check(evidence)).ok, false);
  }
  let called = false; const evidence = clone(plan.behaviorRecovery);
  Object.defineProperty(evidence.scripts[0], 'content', { get() { called = true; return ''; }, enumerable: true });
  assert.equal((await check(evidence)).ok, false); assert.equal(called, false);
  const invalidScene = clone(sceneRecord); invalidScene.relations.push({ kind: 'behavior', targetId: scriptId });
  assert.equal((await validateBehaviorCreateRecovery(record, f.request.content, invalidScene, plan.behaviorRecovery, f.registry(), { digest })).ok, false);
  assert.equal((await validateBehaviorCreateRecovery({ ...record, arbitrary: true }, f.request.content, sceneRecord, plan.behaviorRecovery, f.registry(), { digest })).ok, false);
});

test('one registered TXT may serve as both actor definition and behavior source only with identical role evidence', async () => {
  const f = await fixture(), value = JSON.parse(f.scene.content.slice(1));
  value.actors[0].objectId = scriptId;
  f.scene.content = JSON.stringify(value); f.scene.sourceRevision = revision(f.scene.content);
  f.scene.record.relations.push({ kind: 'references', targetId: scriptId, slot: '' });
  f.scene.descriptor.relations = f.scene.record.relations;
  const projection = await createWorldProjection(f.source, { digest }), sceneObject = projection.objects.find(object => object.id === sceneId);
  const request = { ...f.request, baseRevision: projection.world.revision, sceneObjectRevision: sceneObject.revision, sceneSourceRevision: f.scene.sourceRevision };
  const plan = await prepareBehaviorCreate(f.source, projection, JSON.stringify(f.scene.record), request, { digest });
  assert.equal(plan.behaviorRecovery.definitions.length, 2);
  assert.deepEqual(plan.behaviorRecovery.definitions.find(item => item.objectId === scriptId), plan.behaviorRecovery.scripts[0]);
  const evidence = clone(plan.behaviorRecovery); evidence.definitions.find(item => item.objectId === scriptId).content += '\n';
  const checked = await validateBehaviorCreateRecovery(plan.result.changes[0].record, request.content, JSON.parse(plan.plans[2].afterContent), evidence, f.registry(), { digest });
  assert.equal(checked.ok, false);
});

test('recovery enforces serialized and per-document budgets before accepting a snapshot', async () => {
  const f = await fixture(), plan = await f.run(), sceneRecord = JSON.parse(plan.plans[2].afterContent.slice(1));
  const check = evidence => validateBehaviorCreateRecovery(plan.result.changes[0].record, f.request.content, sceneRecord, evidence, f.registry(), { digest });
  for (const role of ['scene', 'definitions']) {
    const evidence = clone(plan.behaviorRecovery), entry = role === 'scene' ? evidence.scene : evidence.definitions[0];
    entry.content = 'x'.repeat(BEHAVIOR_CREATE_RECOVERY_LIMITS.definitionBytes + 1);
    assert.equal((await check(evidence)).ok, false);
  }
  const evidence = clone(plan.behaviorRecovery), large = 'x'.repeat(BEHAVIOR_CREATE_RECOVERY_LIMITS.definitionBytes);
  evidence.definitions = Array.from({ length: 5 }, (_, index) => ({ objectId: id(50 + index), sourcePath: `documents/large-${index}.txt`,
    sourceRevision: revision(large), content: large }));
  assert.equal((await check(evidence)).ok, false);
});

test('dependency registration derivation is sorted and scene append never admits a general metadata edit', async () => {
  const f = await fixture(), value = manifest(), base = { id: manifestId, relations: [], assetBindings: [] };
  assert.deepEqual(behaviorCreateRegistration(base, value).relations.map(item => item.targetId), [sceneId, scriptId]);
  const edit = appendSceneBehaviorRelation(f.sceneRecordContent, manifestId);
  assert.deepEqual(edit.after, { ...edit.before, relations: [...edit.before.relations, { kind: 'behavior', targetId: manifestId, slot: '' }] });
  for (const content of ['{}', '{bad', JSON.stringify({ ...f.scene.record, relations: {} }), JSON.stringify(edit.after)]) {
    assert.throws(() => appendSceneBehaviorRelation(content, manifestId));
  }
});
