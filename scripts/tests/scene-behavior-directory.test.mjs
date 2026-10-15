import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SCENE_BEHAVIOR_DIRECTORY_API_PATH, captureSceneBehaviorDirectory, createBehaviorScriptLinkRequest, validateBehaviorScriptLinkResult } from '../../engine/scene-behavior-directory.mjs';
import { prepareRelationAdd } from '../../engine/world-relations.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';

const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const hash = n => n.toString(16).padStart(64, '0');
const revision = n => `sha256:${hash(n)}`;
const endpoint = (n, sourcePath) => ({ objectId: id(n), objectRevision: revision(n), sourcePath, sourceRevision: revision(n + 100) });
const directory = () => ({ format: 'viento-scene-behavior-directory', schemaVersion: 1, status: 'ready', worldId: `world:${hash(1)}`,
  baseRevision: revision(50), documentRoot: 'documents', scene: endpoint(1, 'documents/scenes/demo.json'),
  manifest: { ...endpoint(2, 'documents/behaviors/demo.json'), bindingCount: 2 }, sources: [
    { ...endpoint(3, 'documents/scripts/linked.txt'), name: 'linked.txt', linked: true, usedByBindingIds: [id(100), id(101)] },
    { ...endpoint(4, 'documents/scripts/new.txt'), name: 'new.txt', linked: false, usedByBindingIds: [] },
  ] });
const emptyDirectory = () => ({ ...directory(), status: 'empty', manifest: null, sources: [] });
const rejected = action => assert.throws(action, error => error.errorCode === 'scene_behavior_directory_invalid' && !error.message.includes('SECRET'));
const rejectDirectory = value => rejected(() => captureSceneBehaviorDirectory(value, id(1)));
const freezeTree = value => { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(freezeTree); } };
function resultFor(request, catalog = directory()) {
  const target = catalog.sources.find(source => source.objectId === request.targetObjectId), { mode, ...input } = request;
  const relation = { kind: 'references', targetId: target.objectId, slot: '' };
  const value = { status: mode === 'apply' ? 'applied' : 'preview', worldId: request.worldId, baseRevision: request.baseRevision, revision: revision(51),
    proposal: { format: 'viento-changeset', schemaVersion: 1, id: `proposal:${hash(30)}`, worldId: request.worldId,
      actorRef: structuredClone(request.actorRef), baseRevision: request.baseRevision, commands: [{ id: 'relation.add', input }],
      preconditions: [{ objectId: request.objectId, revision: request.objectRevision }, { objectId: request.targetObjectId, revision: request.targetRevision }],
      affectedObjects: [request.objectId, request.targetObjectId], state: 'proposed' },
    changes: [{ kind: 'relation.add', objectId: request.objectId, sourcePath: catalog.manifest.sourcePath, targetObjectId: target.objectId,
      targetSourcePath: target.sourcePath, recordPath: `metadata/documents/${request.objectId}.json`, relation,
      beforeRecordRevision: revision(60), afterRecordRevision: revision(61) }],
    relation: { id: `relation:${hash(40)}`, worldId: request.worldId, sourceObjectId: request.objectId,
      targetObjectId: request.targetObjectId, typeRef: 'io.viento.relation/references', properties: structuredClone(relation) } };
  if (mode === 'apply') value.receipt = { format: 'viento-transaction-receipt', schemaVersion: 1, transactionId: id(90), worldId: request.worldId,
    proposalId: value.proposal.id, baseRevision: request.baseRevision, revision: value.revision, state: 'committed' };
  return value;
}

test('the API path and exact empty/ready directories are detached and deeply frozen', () => {
  assert.equal(SCENE_BEHAVIOR_DIRECTORY_API_PATH, '/api/scene-behavior-directory');
  for (const input of [emptyDirectory(), directory()]) {
    const before = structuredClone(input), captured = captureSceneBehaviorDirectory(input, id(1));
    assert.deepEqual(captured, before); assert.deepEqual(input, before); assert.notEqual(captured, input); freezeTree(captured);
    input.scene.sourcePath = 'documents/changed.json'; if (input.sources.length) input.sources[0].usedByBindingIds.push(id(102));
    assert.deepEqual(captured, before);
  }
});

test('workspace v2 roots and bounded Unicode names remain portable data', () => {
  const input = directory(); input.documentRoot = 'design-data';
  for (const item of [input.scene, input.manifest, ...input.sources]) item.sourcePath = item.sourcePath.replace('documents/', 'design-data/');
  input.sources[1].sourcePath = 'design-data/脚本/移動.TXT'; input.sources[1].name = '移動.TXT';
  assert.deepEqual(captureSceneBehaviorDirectory(input, id(1)), input);
  const plain = Object.assign(Object.create(null), input);
  assert.deepEqual(captureSceneBehaviorDirectory(plain, id(1)), input);
});

test('directories reject missing extra malformed and mismatched top-level fields', () => {
  for (const key of Object.keys(directory())) { const input = directory(); delete input[key]; rejectDirectory(input); }
  for (const patch of [{ format: 'other' }, { schemaVersion: 2 }, { status: 'loading' }, { worldId: 'world:short' },
    { baseRevision: 'sha256:short' }, { worldId: `world:${'A'.repeat(64)}` }, { extra: true }, { documentRoot: '' },
    { documentRoot: 'documents/' }, { documentRoot: '../documents' }, { documentRoot: 'documents\\sub' }, { documentRoot: 'documents/.private' }]) rejectDirectory({ ...directory(), ...patch });
  for (const value of [null, [], true, 0, 'SECRET', undefined]) rejectDirectory(value);
  for (const expected of [id(2), '', 'invalid', undefined]) rejected(() => captureSceneBehaviorDirectory(directory(), expected));
});

test('empty and ready states cannot conceal a manifest or omit used script identities', () => {
  rejectDirectory({ ...emptyDirectory(), manifest: directory().manifest });
  rejectDirectory({ ...emptyDirectory(), sources: directory().sources });
  rejectDirectory({ ...directory(), manifest: null });
  rejectDirectory({ ...directory(), sources: [] });
  for (const bindingCount of [0, 33, 1.5, '2', -0, NaN, Infinity]) {
    const input = directory(); input.manifest.bindingCount = bindingCount; rejectDirectory(input);
  }
});

test('all endpoints require exact identity and revisions, unique paths, and contained portable extensions', () => {
  for (const select of [value => value.scene, value => value.manifest, value => value.sources[1]]) {
    for (const patch of [{ objectId: 'missing' }, { objectId: id(0xab).toUpperCase() }, { objectRevision: null }, { sourceRevision: 'sha256:x' }, { extra: true }]) {
      const input = directory(); Object.assign(select(input), patch); rejectDirectory(input);
    }
    for (const sourcePath of ['/documents/a.json', 'documents-other/a.json', 'documents/../a.json', 'documents//a.json', 'documents/.hidden/a.json',
      'documents/a\\b.json', 'documents/a?.json', 'documents/CON.json', 'documents/a\ud800.json', 'documents/' + 'x'.repeat(1024) + '.json']) {
      const input = directory(); select(input).sourcePath = sourcePath; rejectDirectory(input);
    }
  }
  for (const select of [value => value.scene, value => value.manifest]) { const input = directory(); select(input).sourcePath = 'documents/scene.txt'; rejectDirectory(input); }
  const extension = directory(); extension.sources[1].sourcePath = 'documents/scripts/new.md'; rejectDirectory(extension);
  const duplicateId = directory(); duplicateId.sources[1].objectId = duplicateId.manifest.objectId; rejectDirectory(duplicateId);
  const duplicatePath = directory(); duplicatePath.sources[1].sourcePath = duplicatePath.sources[0].sourcePath; rejectDirectory(duplicatePath);
  for (const patch of [{ name: '' }, { name: 'x'.repeat(161) }, { name: '\ud800' }, { linked: 1 }, { usedByBindingIds: {} }]) {
    const input = directory(); Object.assign(input.sources[1], patch); rejectDirectory(input);
  }
});

test('used binding identities are globally unique, linked, counted exactly, and use at most eight sources', () => {
  for (const mutate of [value => value.sources[0].usedByBindingIds.pop(), value => value.sources[0].usedByBindingIds.push(id(100)),
    value => { value.sources[1].linked = true; value.sources[1].usedByBindingIds = [id(100)]; },
    value => { value.sources[0].linked = false; }, value => { value.sources[0].usedByBindingIds[0] = 'missing'; }]) {
    const input = directory(); mutate(input); rejectDirectory(input);
  }
  const input = directory(); input.manifest.bindingCount = 9;
  input.sources = Array.from({ length: 9 }, (_, index) => ({ ...endpoint(10 + index, `documents/scripts/${index}.txt`),
    name: `${index}.txt`, linked: true, usedByBindingIds: [id(100 + index)] }));
  rejectDirectory(input);
});

test('256 candidates may include more than eight linked sources while only active bindings use the eight-source budget', () => {
  const input = directory(); input.manifest.bindingCount = 32;
  input.sources = Array.from({ length: 256 }, (_, index) => ({ ...endpoint(10 + index, `documents/scripts/${index}.txt`),
    name: `${index}.txt`, linked: true, usedByBindingIds: index < 8 ? Array.from({ length: 4 }, (__, at) => id(1000 + index * 4 + at)) : [] }));
  const value = captureSceneBehaviorDirectory(input, id(1)); assert.equal(value.sources.length, 256); freezeTree(value);
  input.sources.push({ ...endpoint(300, 'documents/scripts/extra.txt'), name: 'extra.txt', linked: false, usedByBindingIds: [] });
  rejectDirectory(input);
});

test('capture rejects accessors and inherited serializers without executing them', () => {
  let calls = 0;
  const top = directory(); Object.defineProperty(top, 'worldId', { enumerable: true, get() { calls++; return `world:${hash(1)}`; } });
  const nested = directory(); Object.defineProperty(nested.sources[1], 'name', { enumerable: true, get() { calls++; return 'SECRET'; } });
  const array = directory(); Object.defineProperty(array.sources, '1', { enumerable: true, get() { calls++; return directory().sources[1]; } });
  const inherited = Object.assign(Object.create({ toJSON() { calls++; return directory(); } }), directory());
  for (const value of [top, nested, array, inherited]) rejectDirectory(value);
  assert.equal(calls, 0);
});

test('sparse hidden symbol cyclic polluted and oversized inputs fail before unsafe serialization', () => {
  const sparse = directory(); delete sparse.sources[0];
  const hidden = directory(); Object.defineProperty(hidden.scene, 'objectId', { enumerable: false, value: id(1) });
  const symbol = directory(); symbol[Symbol('extra')] = 'SECRET';
  const cyclic = directory(); cyclic.sources[0].name = cyclic;
  const polluted = directory(); Object.defineProperty(polluted.scene, '__proto__', { enumerable: true, value: {} });
  const extraArray = directory(); extraArray.sources.extra = true;
  for (const value of [sparse, hidden, symbol, cyclic, polluted, extraArray]) rejectDirectory(value);
  const proxy = Proxy.revocable(directory(), {}); proxy.revoke(); rejectDirectory(proxy.proxy);
  let enumerations = 0; const enormous = []; enormous.length = 100000000;
  rejectDirectory({ ...directory(), sources: new Proxy(enormous, { ownKeys() { enumerations++; throw Error('SECRET'); } }) });
  assert.equal(enumerations, 0);
});

test('link planning emits only the fixed metadata relation command with exact current endpoint revisions', () => {
  const input = directory(), before = structuredClone(input);
  for (const mode of ['preview', 'apply']) {
    const request = createBehaviorScriptLinkRequest(input, id(4), mode);
    assert.deepEqual(request, { command: 'relation.add', mode, worldId: input.worldId, baseRevision: input.baseRevision,
      objectId: input.manifest.objectId, objectRevision: input.manifest.objectRevision, targetObjectId: id(4), targetRevision: input.sources[1].objectRevision,
      kind: 'references', slot: '', actorRef: { kind: 'user', id: 'studio-behavior-links' } });
    freezeTree(request);
  }
  assert.equal(createBehaviorScriptLinkRequest(input, id(4)).mode, 'preview'); assert.deepEqual(input, before);
  for (const sourceId of [id(1), id(2), id(3), id(5), '', null, {}]) rejected(() => createBehaviorScriptLinkRequest(input, sourceId));
  for (const mode of ['', 'execute', null, {}]) rejected(() => createBehaviorScriptLinkRequest(input, id(4), mode));
  rejected(() => createBehaviorScriptLinkRequest(emptyDirectory(), id(4)));
});

test('preview and committed result capture preserve only a matching reviewed metadata operation', () => {
  for (const mode of ['preview', 'apply']) {
    const catalog = directory(), request = createBehaviorScriptLinkRequest(catalog, id(4), mode), value = resultFor(request, catalog), before = structuredClone(value);
    const result = validateBehaviorScriptLinkResult(value, request, catalog);
    assert.deepEqual(result, before); assert.deepEqual(value, before); freezeTree(result); assert.notEqual(result, value);
    value.changes[0].relation.slot = 'changed'; assert.deepEqual(result, before);
  }
});

test('result validation rejects stale requests and any attempt to widen the planned operation', () => {
  const catalog = directory(), request = createBehaviorScriptLinkRequest(catalog, id(4)), result = resultFor(request);
  for (const patch of [{ kind: 'part-of' }, { slot: 'arbitrary' }, { objectId: id(1) }, { targetObjectId: id(3) },
    { objectRevision: revision(80) }, { targetRevision: revision(80) }, { baseRevision: revision(80) }, { worldId: `world:${hash(80)}` },
    { actorRef: { kind: 'tool', id: 'other' } }, { extra: true }, { mode: 'execute' }]) rejected(() => validateBehaviorScriptLinkResult(result, { ...request, ...patch }, catalog));
  const changed = directory(); changed.sources[1].linked = true; rejected(() => validateBehaviorScriptLinkResult(result, request, changed));
});

test('result validation rejects mismatched status world revisions and additional side effects', () => {
  const catalog = directory(), request = createBehaviorScriptLinkRequest(catalog, id(4));
  for (const mutate of [value => { value.status = 'applied'; }, value => { value.worldId = `world:${hash(80)}`; },
    value => { value.baseRevision = revision(80); }, value => { value.revision = 'sha256:short'; }, value => { value.revision = value.baseRevision; },
    value => { value.changes = []; }, value => { value.changes.push(structuredClone(value.changes[0])); }, value => { value.extra = true; },
    value => { value.receipt = {}; }, value => { value.source = 'SECRET'; }]) {
    const value = resultFor(request); mutate(value); rejected(() => validateBehaviorScriptLinkResult(value, request, catalog));
  }
});

test('every metadata change and relation endpoint, hash, type and property is checked', () => {
  const catalog = directory(), request = createBehaviorScriptLinkRequest(catalog, id(4));
  for (const patch of [{ kind: 'property.set' }, { objectId: id(1) }, { sourcePath: catalog.scene.sourcePath }, { targetObjectId: id(3) },
    { targetSourcePath: 'documents/scripts/wrong.txt' }, { recordPath: `metadata/documents/${id(1)}.json` }, { beforeRecordRevision: null },
    { afterRecordRevision: 'sha256:short' }, { afterRecordRevision: revision(60) }, { relation: { kind: 'part-of', targetId: id(4), slot: '' } },
    { relation: { kind: 'references', targetId: id(4), slot: 'changed' } }, { extra: 'SECRET' }]) {
    const value = resultFor(request); Object.assign(value.changes[0], patch); rejected(() => validateBehaviorScriptLinkResult(value, request, catalog));
  }
  for (const patch of [{ id: 'relation:short' }, { worldId: `world:${hash(80)}` }, { sourceObjectId: id(1) }, { targetObjectId: id(3) },
    { typeRef: 'io.viento.relation/part-of' }, { properties: { kind: 'references', targetId: id(3), slot: '' } }, { extra: true }]) {
    const value = resultFor(request); Object.assign(value.relation, patch); rejected(() => validateBehaviorScriptLinkResult(value, request, catalog));
  }
});

test('the proposal must describe the exact single command and both endpoint preconditions', () => {
  const catalog = directory(), request = createBehaviorScriptLinkRequest(catalog, id(4));
  for (const mutate of [value => { value.format = 'other'; }, value => { value.schemaVersion = 2; }, value => { value.id = 'proposal:short'; },
    value => { value.worldId = `world:${hash(80)}`; }, value => { value.baseRevision = revision(80); }, value => { value.actorRef.id = 'other'; },
    value => { value.state = 'committed'; }, value => { value.commands[0].id = 'property.set'; }, value => { value.commands[0].input.force = true; },
    value => { value.commands.push(structuredClone(value.commands[0])); }, value => { value.preconditions.pop(); },
    value => { value.preconditions[1].revision = revision(80); }, value => { value.affectedObjects.push(id(1)); }, value => { value.extra = true; }]) {
    const value = resultFor(request); mutate(value.proposal); rejected(() => validateBehaviorScriptLinkResult(value, request, catalog));
  }
});

test('apply requires a matching committed transaction receipt with no unknown authority', () => {
  const catalog = directory(), request = createBehaviorScriptLinkRequest(catalog, id(4), 'apply');
  const absent = resultFor(request); delete absent.receipt; rejected(() => validateBehaviorScriptLinkResult(absent, request, catalog));
  for (const patch of [{ format: 'other' }, { schemaVersion: 2 }, { transactionId: 'missing' }, { worldId: `world:${hash(80)}` },
    { proposalId: `proposal:${hash(80)}` }, { baseRevision: revision(80) }, { revision: revision(80) }, { state: 'rolled-back' }, { extra: true }]) {
    const value = resultFor(request); Object.assign(value.receipt, patch); rejected(() => validateBehaviorScriptLinkResult(value, request, catalog));
  }
});

test('result and request getters are rejected without reading them', () => {
  const catalog = directory(), request = createBehaviorScriptLinkRequest(catalog, id(4)); let calls = 0;
  const value = resultFor(request); Object.defineProperty(value.proposal.commands[0], 'input', { enumerable: true, get() { calls++; return {}; } });
  rejected(() => validateBehaviorScriptLinkResult(value, request, catalog));
  const badRequest = { ...request }; Object.defineProperty(badRequest, 'mode', { enumerable: true, get() { calls++; return 'preview'; } });
  rejected(() => validateBehaviorScriptLinkResult(resultFor(request), badRequest, catalog)); assert.equal(calls, 0);
});

test('real pure relation.add planning produces accepted preview and committed receipt shapes without filesystem access', async () => {
  const catalog = directory(), digest = value => createHash('sha256').update(value).digest('hex');
  const documents = [catalog.scene, catalog.manifest, ...catalog.sources].map(item => {
    const record = { format: 'viento-document', version: 1, id: item.objectId, sourcePath: item.sourcePath,
      documentType: 'document', parserProfile: 'structured', relations: [], assetBindings: [] };
    return { sourcePath: item.sourcePath, record, descriptor: { documentType: 'document', parserProfile: 'structured' },
      content: item.sourcePath.endsWith('.json') ? '{"title":"Author source"}\n' : '# Inert source\n', sourceRevision: item.sourceRevision };
  });
  const source = { workspace: { id: id(500), name: 'Pure contract fixture', version: 3 },
    definition: { documentTypes: [{ id: 'document', label: 'Document' }] }, documents, assets: [] };
  const projection = await createWorldProjection(source, { digest });
  catalog.worldId = projection.world.id; catalog.baseRevision = projection.world.revision;
  for (const item of [catalog.scene, catalog.manifest, ...catalog.sources]) item.objectRevision = projection.objects.find(object => object.id === item.objectId).revision;
  const request = createBehaviorScriptLinkRequest(catalog, id(4));
  const recordContent = JSON.stringify(documents.find(document => document.record.id === catalog.manifest.objectId).record, null, 2) + '\n';
  const planned = await prepareRelationAdd(source, projection, recordContent, request, { digest });
  assert.deepEqual(validateBehaviorScriptLinkResult(planned.result, request, catalog), planned.result);
  const appliedRequest = createBehaviorScriptLinkRequest(catalog, id(4), 'apply'), actual = { ...structuredClone(planned.result), status: 'applied',
    receipt: { format: 'viento-transaction-receipt', schemaVersion: 1, transactionId: id(90), worldId: request.worldId,
      proposalId: planned.result.proposal.id, baseRevision: request.baseRevision, revision: planned.result.revision, state: 'committed' } };
  assert.deepEqual(validateBehaviorScriptLinkResult(actual, appliedRequest, catalog), actual);
  assert.equal(planned.plans.length, 1); assert.equal(planned.plans[0].sourcePath, `metadata/documents/${catalog.manifest.objectId}.json`);
});
