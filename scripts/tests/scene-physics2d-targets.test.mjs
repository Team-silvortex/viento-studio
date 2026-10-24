import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { SCENE_PHYSICS2D_TARGETS_API_PATH, captureScenePhysics2DTargetSource, captureScenePhysics2DTargetDirectory,
  captureScenePhysics2DTargets, isScenePhysics2DTargets, scenePhysics2DTargetsMatchSource, scenePhysics2DTargetsEqual,
  scenePhysics2DTargetValue, validateScenePhysics2DTargets } from '../../engine/scene-physics2d-targets.mjs';

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const revision = value => 'sha256:' + hash(value);
const invalid = { errorCode: 'scene_physics2d_targets_invalid' };
const body = (n, instanceId = id(8)) => ({ id: id(n), instanceId, kind: 'static', shape: { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 2 });
const physics = () => ({ format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: id(1), bodies: [body(20)] });
const saved = () => '\ufeff' + JSON.stringify(physics(), null, '\t').replaceAll('\n', '\r\n') + '\r\n';
const source = (content = saved()) => ({ sourcePath: 'documents/physics/main.json', token: 'source:1',
  baseSourceRevision: revision(saved()), sourceRevision: revision(content), content });
const raw = () => ({ format: 'viento-scene-physics2d-targets', schemaVersion: 1, worldId: 'world:' + hash('world'), revision: revision('world revision'),
  scene: { objectId: id(1), sourcePath: 'documents/scenes/main.json', sourceRevision: revision('scene') },
  manifest: { objectId: id(2), sourcePath: source().sourcePath, sourceRevision: revision(saved()), content: saved() },
  targets: [{ instanceId: id(8), objectId: id(3), name: '旅行者 🦊', sourcePath: 'documents/characters/traveler.md' },
    { instanceId: id(7), objectId: id(3), name: '旅行者 🦊', sourcePath: 'documents/characters/traveler.md' },
    { instanceId: id(9), objectId: id(4), name: '<other & actor>', sourcePath: 'documents/characters/other.json' }] });
const catalog = (s = source(), data = raw()) => captureScenePhysics2DTargets(s, data);
const nullRecord = value => Object.assign(Object.create(null), value);
function frozenTree(value) {
  if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); for (const item of Object.values(value)) frozenTree(item); }
}

test('physics target sources preserve exact five-field BOM/CRLF text without aliasing caller data', () => {
  assert.equal(SCENE_PHYSICS2D_TARGETS_API_PATH, '/api/scene-physics2d-targets');
  const input = source(), captured = captureScenePhysics2DTargetSource(input);
  assert.deepEqual(captured, input); assert.notEqual(captured, input); assert.ok(Object.isFrozen(captured));
  assert.equal(captured.content, saved()); input.content = '{}'; input.token = 'other';
  assert.equal(captured.content, saved()); assert.equal(captured.token, 'source:1');
  assert.deepEqual(captureScenePhysics2DTargetSource(nullRecord(source())), source());
});

test('target directory retains author order, repeated definition instances and literal display labels', () => {
  const input = raw(), result = captureScenePhysics2DTargetDirectory(input, id(1));
  assert.deepEqual(result, input); assert.notEqual(result, input); assert.notEqual(result.targets, input.targets); frozenTree(result);
  assert.deepEqual(result.targets.map(item => item.instanceId), [id(8), id(7), id(9)]);
  assert.equal(result.targets[0].objectId, result.targets[1].objectId);
  assert.equal(result.targets[2].name, '<other & actor>');
  input.scene.sourceRevision = revision('changed'); input.manifest.content = '{}'; input.targets[0].name = 'changed'; input.targets.reverse();
  assert.equal(result.scene.sourceRevision, revision('scene')); assert.equal(result.manifest.content, saved());
  assert.equal(result.targets[0].name, '旅行者 🦊');
});

test('branded catalogs expose detached identities and saved bytes without granting raw directory authority', () => {
  const s = source(), input = raw(), value = catalog(s, input);
  assert.equal(isScenePhysics2DTargets(value), true); assert.equal(scenePhysics2DTargetsMatchSource(value, source()), true);
  assert.deepEqual(Object.keys(value).sort(), ['manifest', 'savedContent', 'scene', 'targets']);
  assert.deepEqual(Object.keys(value.manifest).sort(), ['objectId', 'sourcePath', 'sourceRevision']);
  assert.equal(value.savedContent, saved()); frozenTree(value);
  assert.equal(scenePhysics2DTargetValue(value, id(7)), id(7)); assert.equal(validateScenePhysics2DTargets(value, physics()), true);
  assert.throws(() => { value.targets[0].instanceId = id(99); }, TypeError);
  assert.throws(() => { value.targets.push(input.targets[0]); }, TypeError);
  s.token = 'later'; input.targets[0].instanceId = id(100); assert.equal(scenePhysics2DTargetsMatchSource(value, source()), true);
});

test('ordinary unsaved physics text binds the saved base revision and preserves its own source revision', () => {
  const text = saved().replace('"layer": 1', '"layer": 3'), draft = source(text), value = catalog(draft);
  assert.notEqual(draft.sourceRevision, draft.baseSourceRevision);
  assert.equal(value.savedContent, saved()); assert.equal(scenePhysics2DTargetsMatchSource(value, draft), true);
  assert.equal(scenePhysics2DTargetsMatchSource(value, source()), false);
  const wrong = raw(); wrong.manifest.sourceRevision = draft.sourceRevision;
  assert.throws(() => catalog(draft, wrong), invalid);
});

test('every source identity field participates in catalog matching and equality', () => {
  const value = catalog();
  const changes = { sourcePath: 'documents/physics/other.json', token: 'source:2', baseSourceRevision: revision('new base'),
    sourceRevision: revision('new source'), content: saved() + ' ' };
  for (const [key, replacement] of Object.entries(changes)) {
    assert.equal(scenePhysics2DTargetsMatchSource(value, { ...source(), [key]: replacement }), false, key);
  }
  const nextSource = source(saved() + ' '), next = catalog(nextSource);
  assert.equal(scenePhysics2DTargetsEqual(value, next), false);
  assert.equal(scenePhysics2DTargetsEqual(value, catalog()), true);
});

test('catalog equality includes private world state and all source and target directory values', () => {
  const value = catalog();
  for (const mutate of [d => { d.worldId = 'world:' + hash('other world'); }, d => { d.revision = revision('other world revision'); },
    d => { d.scene.sourceRevision = revision('new scene'); }, d => { d.scene.sourcePath = 'documents/scenes/other.json'; },
    d => { d.manifest.objectId = id(30); }, d => { d.targets.reverse(); }, d => { d.targets[2].name = 'new name'; },
    d => { d.targets[2].sourcePath = 'documents/characters/renamed.md'; }, d => { d.targets[2].objectId = id(31); },
    d => { d.targets[2].instanceId = id(32); }, d => { d.manifest.content += ' '; }]) {
    const data = raw(); mutate(data); const changed = catalog(source(), data);
    assert.equal(scenePhysics2DTargetsEqual(value, changed), false);
  }
  const changedWorld = raw(); changedWorld.revision = revision('new world');
  const visuallySame = catalog(source(), changedWorld);
  assert.deepEqual(value, visuallySame); assert.equal(scenePhysics2DTargetsEqual(value, visuallySame), false);
  const reordered = raw(); reordered.scene = { sourceRevision: reordered.scene.sourceRevision, sourcePath: reordered.scene.sourcePath, objectId: reordered.scene.objectId };
  assert.equal(scenePhysics2DTargetsEqual(value, catalog(source(), reordered)), true);
});

test('catalog brand cannot be recovered by serialization copying prototype inheritance or raw directory capture', () => {
  const value = catalog();
  for (const forged of [null, {}, { ...value }, structuredClone(value), JSON.parse(JSON.stringify(value)), Object.create(value),
    captureScenePhysics2DTargetDirectory(raw(), id(1))]) {
    assert.equal(isScenePhysics2DTargets(forged), false); assert.equal(scenePhysics2DTargetsMatchSource(forged, source()), false);
    assert.equal(scenePhysics2DTargetsEqual(value, forged), false); assert.equal(scenePhysics2DTargetsEqual(forged, value), false);
    assert.throws(() => scenePhysics2DTargetValue(forged, id(8)), invalid);
    assert.throws(() => validateScenePhysics2DTargets(forged, physics()), invalid);
  }
});

test('selection accepts only issued instance identities without coercing names or definition IDs', () => {
  const value = catalog(); let reads = 0;
  for (const candidate of [id(3), id(1), id(2), id(99), '', null, 7, '旅行者 🦊',
    { toString() { reads++; return id(8); }, valueOf() { reads++; return id(8); } }]) assert.throws(() => scenePhysics2DTargetValue(value, candidate), invalid);
  assert.equal(reads, 0); assert.equal(scenePhysics2DTargetValue(value, id(8)), id(8));
});

test('missing targets remain readable and selectable for repair but fail complete candidate validation', () => {
  const missing = physics(); missing.bodies[0].instanceId = id(90);
  missing.bodies.push(body(21, id(91)));
  const text = JSON.stringify(missing), s = source(text), data = raw();
  s.baseSourceRevision = s.sourceRevision; data.manifest.content = text; data.manifest.sourceRevision = s.baseSourceRevision;
  const value = catalog(s, data); assert.equal(isScenePhysics2DTargets(value), true); assert.equal(scenePhysics2DTargetValue(value, id(7)), id(7));
  assert.throws(() => validateScenePhysics2DTargets(value, missing), error => {
    assert.equal(error.errorCode, 'scene_physics2d_target_missing'); assert.deepEqual(error.instanceIds, [id(90), id(91)]);
    assert.ok(Object.isFrozen(error.instanceIds)); return true;
  });
  const repaired = structuredClone(missing); repaired.bodies[0].instanceId = id(7); repaired.bodies[1].instanceId = id(9);
  assert.equal(validateScenePhysics2DTargets(value, repaired), true); assert.equal(missing.bodies[0].instanceId, id(90));
});

test('candidate validation retains Rust physics rules and cannot switch the directory scene', () => {
  const value = catalog();
  for (const mutate of [d => { d.bodies[0].shape.size[0] = 0; }, d => { d.bodies = []; }, d => { d.bodies[0].layer = 65536; },
    d => { d.bodies[0].offset[0] = Infinity; }, d => { d.bodies.push(structuredClone(d.bodies[0])); },
    d => { d.bodies.push(body(21)); }]) {
    const document = physics(); mutate(document); assert.throws(() => validateScenePhysics2DTargets(value, document));
  }
  assert.throws(() => validateScenePhysics2DTargets(value, { ...physics(), sceneObjectId: id(99) }), invalid);
  let reads = 0; const document = physics(); Object.defineProperty(document.bodies[0], 'instanceId', { enumerable: true, get() { reads++; return id(8); } });
  assert.throws(() => validateScenePhysics2DTargets(value, document)); assert.equal(reads, 0);
});

test('source capture rejects extra symbol hidden inherited accessor and serializer fields without evaluating them', () => {
  let reads = 0;
  for (const mutate of [s => { s.extra = true; }, s => { s[Symbol('extra')] = true; },
    s => Object.defineProperty(s, 'token', { value: 'hidden', enumerable: false }),
    s => Object.defineProperty(s, 'content', { enumerable: true, get() { reads++; return saved(); } }),
    s => Object.setPrototypeOf(s, { extra: true }), s => { s.toJSON = () => { reads++; return {}; }; }]) {
    const s = source(); mutate(s); assert.throws(() => captureScenePhysics2DTargetSource(s), invalid);
    assert.throws(() => captureScenePhysics2DTargets(s, raw()), invalid);
  }
  assert.equal(reads, 0);
});

test('directory capture checks descriptor-safe data at every nested boundary', () => {
  let reads = 0;
  for (const mutate of [d => { d.extra = true; }, d => { d[Symbol('extra')] = true; },
    d => Object.defineProperty(d, 'scene', { enumerable: true, get() { reads++; return raw().scene; } }),
    d => Object.defineProperty(d.manifest, 'content', { enumerable: true, get() { reads++; return saved(); } }),
    d => Object.defineProperty(d.targets[0], 'name', { enumerable: true, get() { reads++; return 'title'; } }),
    d => Object.defineProperty(d.targets, '0', { enumerable: true, get() { reads++; return raw().targets[0]; } }),
    d => Object.defineProperty(d.targets[0], 'instanceId', { enumerable: false, value: id(8) }),
    d => { d.targets[0].extra = true; }, d => { d.targets[0][Symbol('extra')] = true; },
    d => { d.targets[0].toJSON = () => { reads++; return {}; }; }, d => Object.setPrototypeOf(d.scene, { inherited: true }),
    d => { d.manifest.extra = true; }, d => { d.scene.extra = true; }, d => Object.setPrototypeOf(d.targets[0], { inherited: true })]) {
    const data = raw(); mutate(data); assert.throws(() => captureScenePhysics2DTargetDirectory(data, id(1)), invalid);
  }
  assert.equal(reads, 0);
});

test('null-prototype records are detached normally while list holes extra fields and altered prototypes are rejected', () => {
  const data = raw(); data.scene = nullRecord(data.scene); data.manifest = nullRecord(data.manifest); data.targets = data.targets.map(nullRecord);
  assert.deepEqual(captureScenePhysics2DTargetDirectory(nullRecord(data), id(1)), raw());
  for (const mutate of [d => { delete d.targets[0]; }, d => { d.targets.extra = true; }, d => { d.targets[Symbol('extra')] = true; },
    d => { delete d.targets[0]; d.targets.extra = true; }, d => Object.setPrototypeOf(d.targets, null),
    d => Object.setPrototypeOf(d.targets, Object.create(Array.prototype)), d => Object.defineProperty(d.targets, '0', { enumerable: false, value: d.targets[0] })]) {
    const input = raw(); mutate(input); assert.throws(() => captureScenePhysics2DTargetDirectory(input, id(1)), invalid);
  }
});

test('ambient serializers are rejected without evaluating their functions or getters', () => {
  let reads = 0;
  for (const prototype of [Object.prototype, Array.prototype]) {
    const previous = Object.getOwnPropertyDescriptor(prototype, 'toJSON'), inputSource = source(), inputDirectory = raw();
    try {
      Object.defineProperty(prototype, 'toJSON', { configurable: true, get() { reads++; return () => { reads++; return {}; }; } });
      assert.throws(() => captureScenePhysics2DTargetSource(inputSource), invalid);
      assert.throws(() => captureScenePhysics2DTargetDirectory(inputDirectory, id(1)), invalid);
    } finally { if (previous) Object.defineProperty(prototype, 'toJSON', previous); else delete prototype.toJSON; }
  }
  assert.equal(reads, 0);
});

test('source paths are normalized relative JSON identifiers and source tokens and revisions are bounded', () => {
  for (const sourcePath of ['../main.json', '/main.json', 'C:main.json', 'documents\\main.json', 'documents//main.json',
    './documents/main.json', 'documents/./main.json', 'documents/../main.json', '.hidden/main.json', 'documents/main.json/',
    'documents/main.txt', 'documents/main.JSON', 'documents/\nmain.json', 'documents/\x7fmain.json', 'documents/main\ud800.json', 'x'.repeat(4097) + '.json'])
    assert.throws(() => captureScenePhysics2DTargetSource({ ...source(), sourcePath }), invalid, sourcePath);
  for (const [key, value] of [['token', ''], ['token', 'x'.repeat(257)], ['token', '\ud800'], ['baseSourceRevision', 'bad'], ['sourceRevision', 'sha256:' + 'A'.repeat(64)]])
    assert.throws(() => captureScenePhysics2DTargetSource({ ...source(), [key]: value }), invalid, key);
  assert.ok(captureScenePhysics2DTargetSource({ ...source(), sourcePath: 'documents/物理.json', token: 'x'.repeat(256) }));
});

test('source and saved document reject malformed syntax duplicate decoded keys invalid Unicode and foreign physics semantics', () => {
  for (const content of ['', '{}', '[1]', '{', saved() + '\ud800', JSON.stringify({ ...physics(), bodies: [] }),
    saved().replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'),
    saved().replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersi\\u006fn": 1'),
    saved().replace('viento-scene-physics2d', 'viento-scene-audio')]) {
    assert.throws(() => captureScenePhysics2DTargetSource(source(content)), invalid);
    const data = raw(); data.manifest.content = content; assert.throws(() => captureScenePhysics2DTargetDirectory(data, id(1)), invalid);
  }
});

test('both raw text bounds count UTF-8 bytes including BOM rather than only UTF-16 units', () => {
  const compact = '\ufeff' + JSON.stringify(physics()), padded = compact + ' '.repeat(65536 - Buffer.byteLength(compact));
  assert.equal(Buffer.byteLength(padded), 65536); assert.equal(padded.length, 65534);
  assert.ok(captureScenePhysics2DTargetSource(source(padded)));
  const data = raw(); data.manifest.content = padded; assert.ok(captureScenePhysics2DTargetDirectory(data, id(1)));
  for (const content of [padded + ' ', ' '.repeat(65537) + JSON.stringify(physics())]) {
    assert.throws(() => captureScenePhysics2DTargetSource(source(content)), invalid);
    data.manifest.content = content; assert.throws(() => captureScenePhysics2DTargetDirectory(data, id(1)), invalid);
  }
});

test('directory rejects incompatible versions identities revisions and cross-scene saved declarations', () => {
  for (const mutate of [d => { d.format = 'other'; }, d => { d.schemaVersion = 2; }, d => { d.worldId = 'world:short'; },
    d => { d.revision = 'invalid'; }, d => { d.scene.objectId = id(30); }, d => { d.scene.sourceRevision = 'invalid'; },
    d => { d.scene.sourcePath = 'documents/scene.txt'; }, d => { d.manifest.objectId = id(1); }, d => { d.manifest.sourcePath = d.scene.sourcePath; },
    d => { d.manifest.sourceRevision = 'invalid'; }, d => { d.manifest.content = JSON.stringify({ ...physics(), sceneObjectId: id(30) }); }]) {
    const data = raw(); mutate(data); assert.throws(() => captureScenePhysics2DTargetDirectory(data, id(1)), invalid);
  }
  for (const expected of [null, 'other', id(30)]) assert.throws(() => captureScenePhysics2DTargetDirectory(raw(), expected), invalid);
});

test('source-bound capture rejects manifest path base revision and scene mismatches', () => {
  for (const mutate of [d => { d.manifest.sourcePath = 'documents/physics/other.json'; }, d => { d.manifest.sourceRevision = revision('new base'); }]) {
    const data = raw(); mutate(data); assert.throws(() => catalog(source(), data), invalid);
  }
  const other = physics(); other.sceneObjectId = id(30); assert.throws(() => catalog(source(JSON.stringify(other))), invalid);
});

test('target rows require distinct instance IDs and coherent definition identity path and title mappings', () => {
  for (const mutate of [d => { d.targets[1].instanceId = d.targets[0].instanceId; }, d => { d.targets[1].sourcePath = 'documents/characters/alias.md'; },
    d => { d.targets[1].name = 'inconsistent title'; }, d => { d.targets[2].sourcePath = d.targets[0].sourcePath; },
    d => { d.targets[2].objectId = id(1); }, d => { d.targets[2].objectId = id(2); },
    d => { d.targets[2].sourcePath = d.scene.sourcePath; }, d => { d.targets[2].sourcePath = d.manifest.sourcePath; },
    d => { d.targets[2].instanceId = 'not-a-uuid'; }, d => { d.targets[2].objectId = null; }]) {
    const data = raw(); mutate(data); assert.throws(() => captureScenePhysics2DTargetDirectory(data, id(1)), invalid);
  }
});

test('target display names and definition paths reject malformed data while preserving author-visible text', () => {
  for (const [key, value] of [['name', ''], ['name', '   '], ['name', '\nlabel'], ['name', 'label\x7f'], ['name', '\ud800'], ['name', 'x'.repeat(161)],
    ['sourcePath', '../outside.md'], ['sourcePath', '/outside.md'], ['sourcePath', 'documents\\actor.md'], ['sourcePath', 'C:actor.md'],
    ['sourcePath', 'documents//actor.md'], ['sourcePath', 'documents/actor\0.md'], ['sourcePath', 'documents/actor\ud800.md']]) {
    const data = raw(); data.targets[2][key] = value; assert.throws(() => captureScenePhysics2DTargetDirectory(data, id(1)), invalid, key);
  }
  const data = raw(); data.targets[2].name = 'x'.repeat(160); data.targets[2].sourcePath = 'documents/角色.txt';
  assert.equal(captureScenePhysics2DTargetDirectory(data, id(1)).targets[2].name.length, 160);
});

test('directory admits exactly one through 128 authored instances with no invented candidates', () => {
  const data = raw(); data.targets = [data.targets[0]]; assert.equal(captureScenePhysics2DTargetDirectory(data, id(1)).targets.length, 1);
  data.targets = Array.from({ length: 128 }, (_, index) => ({ ...raw().targets[0], instanceId: id(1000 + index) }));
  assert.equal(captureScenePhysics2DTargetDirectory(data, id(1)).targets.length, 128);
  data.targets.push({ ...data.targets[0], instanceId: id(2000) }); assert.throws(() => captureScenePhysics2DTargetDirectory(data, id(1)), invalid);
  data.targets = []; assert.throws(() => captureScenePhysics2DTargetDirectory(data, id(1)), invalid);
});


test('UUID and digest identities reject trailing newlines rather than accepting end-of-line anchors', () => {
  for (const mutate of [d => { d.worldId += '\n'; }, d => { d.revision += '\n'; },
    d => { d.scene.objectId += '\n'; }, d => { d.scene.sourceRevision += '\n'; },
    d => { d.manifest.objectId += '\n'; }, d => { d.manifest.sourceRevision += '\n'; },
    d => { d.targets[0].instanceId += '\n'; }, d => { d.targets[0].objectId += '\n'; }]) {
    const data = raw(); mutate(data); assert.throws(() => captureScenePhysics2DTargetDirectory(data, id(1)), invalid);
  }
  assert.throws(() => captureScenePhysics2DTargetDirectory(raw(), id(1) + '\n'), invalid);
  assert.throws(() => scenePhysics2DTargetValue(catalog(), id(8) + '\n'), invalid);
  for (const key of ['baseSourceRevision', 'sourceRevision']) {
    const input = source(); input[key] += '\n'; assert.throws(() => captureScenePhysics2DTargetSource(input), invalid);
  }
});

test('directory membership does not invent movement rules or collapse instances sharing an object definition', () => {
  const value = catalog(), candidate = physics();
  candidate.bodies.push({ ...body(21, id(7)), kind: 'sensor', shape: { kind: 'circle', radius: 12 } },
    { ...body(22, id(9)), kind: 'character' });
  assert.equal(validateScenePhysics2DTargets(value, candidate), true);
  assert.equal(candidate.bodies.length, 3);
  assert.equal(value.targets[0].objectId, value.targets[1].objectId);
});
