import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveScenePhysics2D, validateScenePhysics2DPlan, stripScenePhysics2DPlan,
  scenePhysics2DCapabilities, SCENE_PHYSICS2D_CAPABILITIES, SCENE_PHYSICS2D_MAX_BYTES } from '../../engine/scene-physics2d.mjs';
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const revision = 'sha256:' + 'a'.repeat(64), otherRevision = 'sha256:' + 'b'.repeat(64);
function fixture({ root = 'documents', schemaVersion = 2, kinds = ['static', 'character', 'sensor'] } = {}) {
  const bodies = kinds.map((kind, n) => ({ id: id(10 + n), instanceId: id(20 + n), kind,
    shape: n % 2 ? { kind: 'circle', radius: 16 } : { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 2 }));
  const document = { format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: id(1), bodies };
  const plan = { format: 'viento-build-plan', schemaVersion, kind: 'scene2d', scene: { objectId: id(1), sourcePath: `${root}/scene.json`, sourceRevision: revision },
    actors: bodies.map(body => ({ instanceId: body.instanceId, objectId: id(3), controls: body.kind === 'character' ? 'arrows' : 'none', speed: body.kind === 'character' ? 160 : 0 })),
    resources: [{ id: id(4), kind: 'audio' }], requiredCapabilities: ['scene2d', ...scenePhysics2DCapabilities(document)] };
  const scene = { record: { format: 'viento-document', version: 1, id: id(1), relations: [{ kind: 'references', slot: 'physics2d', targetId: id(2) }] },
    sourcePath: plan.scene.sourcePath, sourceRevision: revision };
  const source = { record: { format: 'viento-document', version: 1, id: id(2), sourcePath: `${root}/物理🌧.json`, relations: [{ kind: 'references', targetId: id(1), slot: '' }] },
    sourcePath: `${root}/物理🌧.json`, sourceRevision: revision, content: '\ufeff' + (JSON.stringify(document, null, 2) + '\n').replaceAll('\n', '\r\n') };
  return { plan, document, scene, source, observed: { source: { documents: [scene, source] } } };
}
function admitted(f = fixture()) {
  const result = resolveScenePhysics2D(f.observed, f.plan);
  assert.deepEqual(result.diagnostics, []); assert.equal(result.ok, true);
  return structuredClone({ ...f.plan, physics: result.physics });
}

test('physics opt-in binds registered JSON and exact instance sources in both document roots', () => {
  for (const root of ['documents', 'design-data']) for (const schemaVersion of [2, 3]) {
    const f = fixture({ root, schemaVersion }), original = structuredClone(f), plan = admitted(f);
    assert.deepEqual(f, original); assert.equal(plan.physics.format, 'viento-physics2d-plan'); assert.equal(plan.physics.schemaVersion, 1);
    assert.deepEqual(validateScenePhysics2DPlan(plan), plan.physics);
    for (const [index, item] of plan.physics.locations.bodies.entries()) {
      assert.equal(item.id, f.document.bodies[index].id); assert.equal(item.declaration.propertyPath, `/bodies/${index}`);
      const { start, end, exact, encoding } = item.declaration.sourceRange;
      assert.equal(exact, true); assert.equal(encoding, 'utf-16');
      assert.deepEqual(JSON.parse(f.source.content.slice(start, end)), f.document.bodies[index]);
      assert.equal(item.declaration.objectId, f.source.record.id); assert.equal(item.declaration.sourceRevision, revision);
    }
  }
});

test('only references with the physics2d slot opt in; absent relation keeps old plans unchanged', () => {
  for (const relations of [[], [{ kind: 'physics2d', targetId: id(2) }], [{ kind: 'references', targetId: id(2) }],
    [{ kind: 'references', slot: 'audio', targetId: id(2) }]]) {
    const f = fixture({ schemaVersion: 1 }); f.scene.record.relations = relations;
    const before = structuredClone(f); assert.deepEqual(resolveScenePhysics2D(f.observed, f.plan), { ok: true, physics: null, diagnostics: [] });
    assert.deepEqual(f, before);
  }
});

test('capabilities follow body kinds and stripping physics preserves unrelated scene extensions', () => {
  assert.deepEqual(SCENE_PHYSICS2D_CAPABILITIES, ['physics.bodies2d', 'physics.character2d', 'physics.sensors2d']);
  for (const [kinds, expected] of [[['static'], ['physics.bodies2d']], [['character'], ['physics.bodies2d', 'physics.character2d']],
    [['sensor'], ['physics.bodies2d', 'physics.sensors2d']]]) {
    const f = fixture({ kinds }), plan = admitted(f); plan.audio = { marker: 'keep' };
    assert.deepEqual(scenePhysics2DCapabilities(f.document), expected); assert.deepEqual(validateScenePhysics2DPlan(plan), plan.physics);
    const before = structuredClone(plan), stripped = stripScenePhysics2DPlan(plan);
    assert.equal(Object.hasOwn(stripped, 'physics'), false); assert.deepEqual(stripped.requiredCapabilities, ['scene2d']);
    assert.deepEqual(stripped.resources, plan.resources); assert.deepEqual(stripped.audio, plan.audio); assert.deepEqual(plan, before);
  }
});

test('ordinary scalar toJSON behavior parameters survive both legacy and opted-in physics plans', () => {
  const f = fixture(); f.plan.behaviors = { parameters: { toJSON: 'an ordinary declared string' } };
  assert.equal(resolveScenePhysics2D(f.observed, f.plan).ok, true);
  const plan = admitted(f); assert.deepEqual(validateScenePhysics2DPlan(plan), plan.physics);
  const legacy = fixture(); legacy.scene.record.relations = [];
  legacy.plan.otherExtension = Object.create({ outsideThisDomain: true });
  assert.deepEqual(resolveScenePhysics2D(legacy.observed, legacy.plan), { ok: true, physics: null, diagnostics: [] });
});

test('ambiguous selections unavailable or oversized source and wrong registration fail at the scene', () => {
  const changes = [f => f.scene.record.relations.push({ kind: 'references', slot: 'physics2d', targetId: id(99) }),
    f => f.observed.source.documents.push(structuredClone(f.source)), f => f.observed.source.documents.pop(),
    f => f.source.content = null, f => f.source.content += ' '.repeat(SCENE_PHYSICS2D_MAX_BYTES),
    f => f.source.record.sourcePath = 'documents/other.json', f => f.source.record.version = 2,
    f => f.source.sourcePath = 'documents/file.txt', f => f.plan.schemaVersion = 1];
  for (const change of changes) {
    const f = fixture(); change(f); const result = resolveScenePhysics2D(f.observed, f.plan);
    assert.equal(result.ok, false); assert.equal(result.physics, null);
    assert.equal(result.diagnostics[0].code, 'build_physics_invalid'); assert.equal(result.diagnostics[0].objectId, id(1));
  }
});

test('the 64 KiB author source limit counts UTF-8 bytes including BOM and retained whitespace', () => {
  const f = fixture(), initialBytes = new TextEncoder().encode(f.source.content).length;
  f.source.content += ' '.repeat(SCENE_PHYSICS2D_MAX_BYTES - initialBytes);
  assert.equal(new TextEncoder().encode(f.source.content).length, SCENE_PHYSICS2D_MAX_BYTES);
  assert.equal(resolveScenePhysics2D(f.observed, f.plan).ok, true);
  f.source.content += ' ';
  assert.equal(resolveScenePhysics2D(f.observed, f.plan).diagnostics[0].code, 'build_physics_invalid');
});

test('scene ownership requires exact scene id and ordinary inverse references', () => {
  for (const relation of [[], [{ kind: 'part-of', targetId: id(1) }], [{ kind: 'reference', targetId: id(1) }], [{ kind: 'references', targetId: id(999) }]]) {
    const f = fixture(); f.source.record.relations = relation;
    const result = resolveScenePhysics2D(f.observed, f.plan); assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].objectId, id(2)); assert.equal(result.diagnostics[0].propertyPath, '/sceneObjectId');
  }
  const f = fixture(); f.document.sceneObjectId = id(999); f.source.content = JSON.stringify(f.document);
  assert.equal(resolveScenePhysics2D(f.observed, f.plan).diagnostics[0].propertyPath, '/sceneObjectId');
});

test('instance membership is scene-local even when object definitions are shared', () => {
  const f = fixture(); f.document.bodies[1].instanceId = id(999); f.source.content = JSON.stringify(f.document);
  const result = resolveScenePhysics2D(f.observed, f.plan), item = result.diagnostics[0];
  assert.equal(result.ok, false); assert.equal(item.instanceId, id(999)); assert.equal(item.bodyId, id(11));
  assert.equal(item.propertyPath, '/bodies/1/instanceId'); assert.equal(item.sourceRevision, revision);
  assert.equal(f.source.content.slice(item.sourceRange.start, item.sourceRange.end), JSON.stringify(id(999)));
  assert.deepEqual(validateScenePhysics2DPlan(admitted()).document.bodies.map(row => row.instanceId), [id(20), id(21), id(22)]);
});

test('static and sensor mappings reject built-in motion while characters retain existing controls', () => {
  for (const index of [0, 2]) for (const change of [actor => actor.controls = 'arrows', actor => actor.speed = 1]) {
    const f = fixture(); change(f.plan.actors[index]); const result = resolveScenePhysics2D(f.observed, f.plan);
    assert.equal(result.ok, false); assert.equal(result.diagnostics[0].propertyPath, `/bodies/${index}/instanceId`);
    const plan = admitted(); change(plan.actors[index]); assert.throws(() => validateScenePhysics2DPlan(plan), { errorCode: 'build_physics_invalid' });
  }
  const f = fixture(); f.plan.actors[1].controls = 'none'; f.plan.actors[1].speed = 0;
  assert.equal(resolveScenePhysics2D(f.observed, f.plan).ok, true);
});

test('frozen validation rejects foreign source maps capabilities geometry and unstable actor identities', () => {
  const changes = [p => p.physics.schemaVersion = 2, p => p.physics.extra = true,
    p => p.physics.manifest.sourceRevision += '\n', p => p.physics.manifest.sourcePath = '../physics.json',
    p => p.physics.document.sceneObjectId = id(999), p => p.physics.document.bodies[0].mask = 65536,
    p => p.requiredCapabilities = p.requiredCapabilities.filter(value => value !== 'physics.character2d'),
    p => p.actors[1].instanceId = p.actors[0].instanceId, p => delete p.actors[0].instanceId,
    p => p.physics.locations.bodies[0].id = id(999), p => p.physics.locations.bodies.reverse(),
    p => p.physics.locations.bodies[0].declaration.sourceRevision = otherRevision,
    p => p.physics.locations.bodies[0].declaration.propertyPath = '/bodies/1',
    p => p.physics.locations.bodies[0].declaration.sourceRange.exact = false,
    p => p.physics.locations.bodies[0].declaration.sourceRange.propertyPath = '/bodies/1',
    p => p.physics.locations.bodies[0].declaration.sourceRange.start = -1];
  for (const change of changes) { const plan = admitted(); change(plan); assert.throws(() => validateScenePhysics2DPlan(plan), { errorCode: 'build_physics_invalid' }); }
});

test('exact source ranges are optional on frozen maps but supplied ranges cannot borrow identity', () => {
  const plan = admitted(); for (const item of plan.physics.locations.bodies) delete item.declaration.sourceRange;
  assert.deepEqual(validateScenePhysics2DPlan(plan), plan.physics);
});

test('duplicate JSON keys fail rather than collapsing a physics declaration', () => {
  const f = fixture(); f.source.content = JSON.stringify(f.document).replace('"mask":2', '"mask":1,"ma\\u0073k":2');
  const result = resolveScenePhysics2D(f.observed, f.plan); assert.equal(result.ok, false); assert.equal(result.physics, null);
  assert.equal(result.diagnostics[0].objectId, id(2)); assert.equal(result.diagnostics[0].code, 'build_physics_invalid');
});

test('frozen admission rejects accessors fake prototypes sparse arrays and serialization hooks without executing them', () => {
  let reads = 0;
  const getter = admitted(); Object.defineProperty(getter.physics.document.bodies[0], 'mask', { enumerable: true, get() { reads++; return 2; } });
  const serializer = admitted(); serializer.physics.toJSON = () => { reads++; return {}; };
  const inherited = admitted(); Object.setPrototypeOf(inherited.physics.manifest, { injected: true });
  const sparse = admitted(); delete sparse.physics.locations.bodies[0];
  for (const plan of [getter, serializer, inherited, sparse]) assert.throws(() => validateScenePhysics2DPlan(plan), { errorCode: 'build_physics_invalid' });
  assert.equal(reads, 0);
});
