import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCompositionDraft, prepareCompositionDraftApply, isCompositionDraftProposal, validateCompositionCreateCatalog, SCENE_COMPOSITION_CREATE_MAX_ACTORS } from '../../engine/scene-composition-create.mjs';
import { expandSceneComposition } from '../../engine/scene-composition.mjs';
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const rev = digit => `sha256:${digit.repeat(64)}`;
const context = () => ({ sourceToken: 'composition:3', documentRoot: 'documents', documentTypes: [{ id: 'document', label: '文書' }] });
const catalog = () => ({ format: 'viento-scene-composition-create-context', schemaVersion: 1, worldId: 'world:example', worldRevision: rev('a'),
  documentRoot: 'documents', documentTypes: context().documentTypes, existingPaths: ['documents/actor.md'], existingIdentities: [id(1)],
  objects: [{ id: id(1), name: '角色', sourcePath: 'documents/actor.md', sourceRevision: rev('b'), canInheritProjection: false }] });
const request = () => ({ documentType: 'document', sourcePath: 'documents/recipes/new.json', title: '場景 🎮', fragmentId: 'main', actorKey: 'actor', objectId: id(1),
  useProjectionDefaults: false, position: [120, 180], viewport: [960, 640], background: '#122334', placementId: id(2), instanceId: id(3) });
const invalid = e => e?.errorCode === 'composition_authoring_invalid';
const conflict = e => e?.errorCode === 'composition_authoring_conflict';
const propose = (input = request(), ctx = context(), cat = catalog()) => prepareCompositionDraft(ctx, cat, input);

test('ordinary recipe source is complete, Rust-valid, stable and does not allocate a saved document identity', () => {
  const input = request(), ctx = context(), cat = catalog(), before = structuredClone({ input, ctx, cat });
  const proposal = propose(input, ctx, cat), value = JSON.parse(proposal.content), expanded = expandSceneComposition(proposal.content);
  assert.equal(proposal.format, 'viento-scene-composition-draft'); assert.ok(isCompositionDraftProposal(proposal));
  assert.deepEqual(expanded.scene.actors, [{ instanceId: id(3), objectId: id(1), position: [120, 180], size: [64, 64], color: '#87d8b9', speed: 160, controls: 'arrows' }]);
  assert.equal(value.placements[0].placementId, id(2)); assert.deepEqual(value.fragments[0].groups, []); assert.deepEqual(value.placements[0].groupIds, {});
  assert.deepEqual({ input, ctx, cat }, before); assert.equal(propose(input, ctx, cat).content, proposal.content);
  assert.deepEqual(prepareCompositionDraftApply(ctx, cat, proposal), { documentType: input.documentType, sourcePath: input.sourcePath, content: proposal.content });
  assert.equal(Object.hasOwn(value, 'id'), false);
});
test('projection inheritance stays declared without resolved appearance or controls being copied into author source', () => {
  const cat = catalog(); cat.objects[0].canInheritProjection = true;
  const proposal = propose({ ...request(), useProjectionDefaults: true }, context(), cat), actor = JSON.parse(proposal.content).fragments[0].actors[0];
  assert.deepEqual(actor, { key: 'actor', objectId: id(1), position: [120, 180], useProjectionDefaults: true });
  for (const key of ['size', 'color', 'speed', 'controls', 'imageResourceId']) assert.equal(Object.hasOwn(actor, key), false);
  assert.throws(() => propose({ ...request(), useProjectionDefaults: true }), invalid);
});
test('captured proposals and catalog data are detached and deeply immutable', () => {
  const ctx = context(), cat = catalog(), input = request(), proposal = propose(input, ctx, cat), validated = validateCompositionCreateCatalog(cat);
  const before = structuredClone(proposal); input.position[0] = 77; cat.objects[0].name = 'changed'; ctx.documentTypes[0].label = 'changed';
  assert.deepEqual(proposal, before); assert.equal(validated.objects[0].name, '角色');
  for (const value of [proposal, proposal.position, proposal.viewport, proposal.documentTypes, proposal.documentTypes[0], validated.objects[0]]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { proposal.position[0] = 8; }, TypeError);
});
test('forged, copied and serialized proposals cannot acquire editor handoff authority', () => {
  const proposal = propose();
  for (const value of [null, {}, { ...proposal }, structuredClone(proposal), JSON.parse(JSON.stringify(proposal))]) {
    assert.equal(isCompositionDraftProposal(value), false); assert.throws(() => prepareCompositionDraftApply(context(), catalog(), value), conflict);
  }
});
test('editor source ownership, type order and document root are pinned through apply', () => {
  const proposal = propose();
  for (const ctx of [{ ...context(), sourceToken: 'composition:4' }, { ...context(), documentRoot: 'design-data' },
    { ...context(), documentTypes: [{ id: 'document', label: 'Renamed' }] }, null]) assert.throws(() => prepareCompositionDraftApply(ctx, catalog(), proposal), conflict);
});
test('fresh world, candidate body, inheritance and reserved locations must match the reviewed catalog', () => {
  const proposal = propose();
  for (const mutate of [cat => { cat.worldRevision = rev('c'); }, cat => { cat.worldId = 'world:other'; }, cat => { cat.objects[0].sourceRevision = rev('c'); },
    cat => { cat.objects[0].canInheritProjection = true; }, cat => { cat.objects = []; }, cat => { cat.existingPaths.push(request().sourcePath); },
    cat => { cat.existingIdentities.push(id(2)); }]) {
    const cat = catalog(); mutate(cat); assert.throws(() => prepareCompositionDraftApply(context(), cat, proposal), conflict);
  }
});
test('portable JSON locations reject traversal, other roots and case/prefix occupied paths', () => {
  for (const sourcePath of ['other/x.json', 'documents/../x.json', 'documents\\x.json', '/documents/x.json', 'documents/CON.json', 'documents/a?.json',
    'docs-standard/documents/x.json', 'documents/x.txt', 'documents/.hidden/x.json', 'documents//x.json']) assert.throws(() => propose({ ...request(), sourcePath }), invalid);
  for (const existing of ['documents/recipes/new.JSON', 'documents/recipes', 'documents/recipes/new.json/nested.txt']) {
    const cat = catalog(); cat.existingPaths.push(existing);
    assert.throws(() => propose(request(), context(), cat), e => e.errorCode === 'composition_authoring_path_conflict');
  }
});
test('custom author roots and current types work without a built-in scene type; old project roots fail', () => {
  const ctx = { ...context(), documentRoot: '作品/正文' }, cat = { ...catalog(), documentRoot: ctx.documentRoot };
  const proposal = propose({ ...request(), sourcePath: '作品/正文/配方.JSON' }, ctx, cat); assert.ok(proposal.content.includes('場景'));
  assert.throws(() => propose(request(), ctx, catalog()), conflict);
  assert.throws(() => propose({ ...request(), documentType: 'scene' }), invalid);
});
test('unavailable objects and colliding generated identities are rejected before handoff', () => {
  for (const change of [{ objectId: id(9) }, { placementId: id(1) }, { instanceId: id(1) }, { placementId: id(3) }, { placementId: 'main' }, { instanceId: 'bad' }]) assert.throws(() => propose({ ...request(), ...change }), invalid);
  const empty = { ...catalog(), objects: [] }; assert.deepEqual(validateCompositionCreateCatalog(empty).objects, []);
  assert.throws(() => propose(request(), context(), empty), invalid);
});
test('Rust validates scene values and fragment keys without coercing form strings', () => {
  for (const change of [{ title: '' }, { title: ' ' }, { title: 'x'.repeat(161) }, { fragmentId: '1bad' }, { actorKey: '__proto__' }, { position: ['4', 5] },
    { position: [100001, 0] }, { viewport: [64.5, 100] }, { viewport: [20, 100] }, { background: 'red' }, { useProjectionDefaults: 'true' }]) assert.throws(() => propose({ ...request(), ...change }), invalid);
});
test('accessors, inherited serializers, sparse arrays and extra author fields are rejected without executing code', () => {
  let calls = 0;
  const getter = { ...request() }; Object.defineProperty(getter, 'title', { enumerable: true, get() { calls++; return 'evil'; } });
  const serializer = Object.assign(Object.create({ toJSON() { calls++; return request(); } }), request());
  const sparse = { ...request(), position: [, 1] }, extra = { ...request(), content: '{}' };
  for (const value of [getter, serializer, sparse, extra]) assert.throws(() => propose(value), invalid);
  const cat = catalog(); Object.defineProperty(cat.objects[0], 'name', { enumerable: true, get() { calls++; return 'bad'; } });
  assert.throws(() => validateCompositionCreateCatalog(cat), invalid); assert.equal(calls, 0);
});
test('catalog candidate identities, paths, revisions and bounded document types cannot be forged structurally', () => {
  for (const mutate of [cat => { cat.objects.push({ ...cat.objects[0] }); }, cat => { cat.existingIdentities = []; }, cat => { cat.existingPaths = []; },
    cat => { cat.objects[0].sourceRevision = 'bad'; }, cat => { cat.objects[0].canInheritProjection = 1; }, cat => { cat.documentTypes.push({ id: 'document', label: 'Duplicate' }); },
    cat => { cat.documentRoot = 'docs-standard/documents'; }, cat => { cat.objects[0].name = '\ud800'; }, cat => { cat.documentTypes[0].id = { toString: 'bad' }; }]) {
    const cat = catalog(); mutate(cat); assert.throws(() => validateCompositionCreateCatalog(cat), invalid);
  }
});


const multiRequest = (count = 2) => {
  const { actorKey, objectId, useProjectionDefaults, position, instanceId, ...common } = request();
  return { ...common, actors: Array.from({ length: count }, (_, index) => ({ actorKey: `actor${index}`, objectId, useProjectionDefaults,
    position: [120 + index * 20, 180], instanceId: id(10 + index) })) };
};
const mixedCatalog = () => {
  const value = catalog();
  value.objects.push({ id: id(4), name: 'Game projection', sourcePath: 'documents/projection.json', sourceRevision: rev('c'), canInheritProjection: true });
  value.existingPaths.push('documents/projection.json'); value.existingIdentities.push(id(4)); return value;
};

test('single-entry actor arrays generate identical recipe source to the legacy request shape', () => {
  const { actorKey, objectId, useProjectionDefaults, position, instanceId, ...common } = request();
  const input = { ...common, actors: [{ actorKey, objectId, useProjectionDefaults, position, instanceId }] }, proposal = propose(input);
  assert.equal(proposal.content, propose().content); assert.deepEqual(proposal.actors, input.actors);
  assert.equal(Object.hasOwn(proposal, 'actorKey'), false); assert.equal(Object.hasOwn(proposal, 'instanceId'), false);
  assert.deepEqual(prepareCompositionDraftApply(context(), catalog(), proposal), { documentType: input.documentType, sourcePath: input.sourcePath, content: proposal.content });
});
test('mixed ordinary actors and projected actors retain their individual inheritance and positions', () => {
  const input = multiRequest(3), cat = mixedCatalog();
  input.actors[1].objectId = id(4); input.actors[1].useProjectionDefaults = true;
  input.actors[2].objectId = id(4);
  const proposal = propose(input, context(), cat), value = JSON.parse(proposal.content), actors = value.fragments[0].actors;
  assert.equal(value.schemaVersion, 1); assert.equal(value.fragments.length, 1); assert.equal(value.placements.length, 1);
  assert.deepEqual(actors.map(actor => [actor.key, actor.objectId, actor.position]), input.actors.map(actor => [actor.actorKey, actor.objectId, actor.position]));
  assert.deepEqual(actors[1], { key: 'actor1', objectId: id(4), position: [140, 180], useProjectionDefaults: true });
  for (const index of [0, 2]) {
    assert.equal(Object.hasOwn(actors[index], 'useProjectionDefaults'), false); assert.equal(actors[index].controls, 'arrows');
    assert.deepEqual(actors[index].size, [64, 64]); assert.equal(actors[index].speed, 160);
  }
  const scene = expandSceneComposition(proposal.content).scene;
  assert.deepEqual(scene.actors.map(actor => actor.instanceId), input.actors.map(actor => actor.instanceId));
  assert.deepEqual(prepareCompositionDraftApply(context(), cat, proposal), { documentType: input.documentType, sourcePath: input.sourcePath, content: proposal.content });
});
test('the same object can appear repeatedly with separate stable actor keys and instance identities', () => {
  const input = multiRequest(4), proposal = propose(input), value = JSON.parse(proposal.content), scene = expandSceneComposition(proposal.content).scene;
  assert.deepEqual(value.placements[0].actorIds, Object.fromEntries(input.actors.map(actor => [actor.actorKey, actor.instanceId])));
  assert.equal(new Set(scene.actors.map(actor => actor.objectId)).size, 1);
  assert.equal(new Set(scene.actors.map(actor => actor.instanceId)).size, 4);
  assert.equal(propose(input).content, proposal.content);
});
test('creation assistant budgets accept 1 through 64 actors without changing recipe format limits', () => {
  assert.equal(SCENE_COMPOSITION_CREATE_MAX_ACTORS, 64);
  for (const count of [1, 64]) {
    const proposal = propose(multiRequest(count));
    assert.equal(expandSceneComposition(proposal.content).scene.actors.length, count);
    assert.equal(JSON.parse(proposal.content).schemaVersion, 1);
  }
  for (const actors of [[], multiRequest(65).actors, {}, 'actors', 1]) assert.throws(() => propose({ ...multiRequest(), actors }), invalid);
});
test('multi-actor requests reject repeated keys and every placement, catalog or instance identity collision', () => {
  for (const mutate of [input => { input.actors[1].actorKey = input.actors[0].actorKey; }, input => { input.actors[1].instanceId = input.actors[0].instanceId; },
    input => { input.actors[1].instanceId = input.placementId; }, input => { input.actors[1].instanceId = id(1); },
    input => { input.actors[1].instanceId = id(4); }, input => { input.placementId = id(4); }, input => { input.actors[1].instanceId = 'actor'; }]) {
    const input = multiRequest(); mutate(input); assert.throws(() => propose(input, context(), mixedCatalog()), invalid);
  }
});
test('each multi-actor object and inheritance declaration is independently validated', () => {
  for (const mutate of [input => { input.actors[1].objectId = id(9); }, input => { input.actors[1].useProjectionDefaults = true; },
    input => { input.actors[1].useProjectionDefaults = 'false'; }, input => { input.actors[1].objectId = {}; }]) {
    const input = multiRequest(); mutate(input); assert.throws(() => propose(input, context(), mixedCatalog()), invalid);
  }
});
test('Rust validates every multi-actor key and position without accepting coercible values', () => {
  for (const change of [{ actorKey: '__proto__' }, { actorKey: 'constructor' }, { actorKey: 'prototype' }, { actorKey: '1bad' },
    { actorKey: {} }, { actorKey: ['key'] }, { position: ['4', 5] }, { position: [100001, 0] }, { position: [1] }, { position: [1, 2, 3] }]) {
    const input = multiRequest(); Object.assign(input.actors[1], change); assert.throws(() => propose(input), invalid);
  }
});
test('legacy and multi-actor request shapes are exclusive and every actor entry has a complete exact shape', () => {
  for (const input of [{ ...request(), actors: multiRequest().actors }, { ...multiRequest(), actorKey: 'old' }, { ...multiRequest(), instanceId: id(3) },
    { ...multiRequest(), useProjectionDefaults: false }]) assert.throws(() => propose(input), invalid);
  for (const key of ['actorKey', 'objectId', 'useProjectionDefaults', 'position', 'instanceId']) {
    const input = multiRequest(); delete input.actors[1][key]; assert.throws(() => propose(input), invalid);
  }
  for (const key of ['content', 'controls', 'color', 'size', 'fragmentId']) {
    const input = multiRequest(); input.actors[1][key] = 'extra'; assert.throws(() => propose(input), invalid);
  }
});
test('multi-actor proposals deeply snapshot inputs and reject copied authority or subsequent catalog mutation', () => {
  const input = multiRequest(), ctx = context(), cat = catalog(), before = structuredClone({ input, ctx, cat }), proposal = propose(input, ctx, cat);
  assert.deepEqual({ input, ctx, cat }, before);
  const originalContent = proposal.content;
  input.actors[0].position[0] = 999; input.actors[1].actorKey = 'changed'; input.actors.push(input.actors[0]);
  assert.deepEqual(proposal.actors, before.input.actors); assert.equal(proposal.content, originalContent);
  for (const value of [proposal.actors, ...proposal.actors, ...proposal.actors.map(actor => actor.position)]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { proposal.actors[1].position[0] = 999; }, TypeError);
  assert.throws(() => { proposal.actors.push({}); }, TypeError);
  assert.equal(prepareCompositionDraftApply(ctx, cat, proposal).content, originalContent);
  for (const copy of [{ ...proposal }, structuredClone(proposal), JSON.parse(JSON.stringify(proposal))]) {
    assert.equal(isCompositionDraftProposal(copy), false); assert.throws(() => prepareCompositionDraftApply(ctx, cat, copy), conflict);
  }
  cat.objects[0].sourceRevision = rev('c');
  assert.throws(() => prepareCompositionDraftApply(ctx, cat, proposal), conflict);
});
test('malformed nested actor structures reject accessors, serializers and sparse arrays without executing them', () => {
  let calls = 0;
  const accessor = multiRequest(); Object.defineProperty(accessor.actors[1], 'position', { enumerable: true, get() { calls++; return [0, 0]; } });
  const inherited = multiRequest(); inherited.actors[1] = Object.assign(Object.create({ toJSON() { calls++; return {}; } }), inherited.actors[1]);
  const sparse = multiRequest(); delete sparse.actors[0];
  const sparsePosition = multiRequest(); delete sparsePosition.actors[1].position[0];
  const cyclic = multiRequest(); cyclic.actors[1].position = cyclic.actors;
  for (const input of [accessor, inherited, sparse, sparsePosition, cyclic]) assert.throws(() => propose(input), invalid);
  assert.equal(calls, 0);
});
