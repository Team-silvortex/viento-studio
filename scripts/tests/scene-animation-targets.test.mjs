import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { SCENE_ANIMATION_TARGETS_API_PATH, captureSceneAnimationTargetSource, captureSceneAnimationTargetDirectory,
  captureSceneAnimationTargets, isSceneAnimationTargets, sceneAnimationTargetsMatchSource, sceneAnimationTargetsEqual,
  sceneAnimationTargetValue, validateSceneAnimationTargets } from '../../engine/scene-animation-targets.mjs';

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const revision = value => 'sha256:' + hash(value);
const invalid = { errorCode: 'scene_animation_targets_invalid' };
const animation = () => ({ format: 'viento-scene-animation', schemaVersion: 1, sceneObjectId: id(1), durationSeconds: 2, loop: false,
  tracks: [{ id: id(20), instanceId: id(8), property: 'offset2d', interpolation: 'linear',
    keyframes: [{ atSeconds: 0, value: [0, 0] }, { atSeconds: 2, value: [10, 20] }] }] });
const saved = () => '\ufeff' + JSON.stringify(animation(), null, '\t').replaceAll('\n', '\r\n') + '\r\n';
const source = (content = saved()) => ({ sourcePath: 'documents/animations/main.json', token: 'source:1',
  baseSourceRevision: revision(saved()), sourceRevision: revision(content), content });
const raw = () => ({ format: 'viento-scene-animation-targets', schemaVersion: 1, worldId: 'world:' + hash('world'), revision: revision('world revision'),
  scene: { objectId: id(1), sourcePath: 'documents/scenes/main.json', sourceRevision: revision('scene') },
  manifest: { objectId: id(2), sourcePath: source().sourcePath, sourceRevision: revision(saved()), content: saved() },
  targets: [{ instanceId: id(8), objectId: id(3), name: '旅行者 🦊', sourcePath: 'documents/characters/traveler.md' },
    { instanceId: id(7), objectId: id(3), name: '旅行者 🦊', sourcePath: 'documents/characters/traveler.md' },
    { instanceId: id(9), objectId: id(4), name: '<other & actor>', sourcePath: 'documents/characters/other.json' }] });
const catalog = (s = source(), data = raw()) => captureSceneAnimationTargets(s, data);
const nullRecord = value => Object.assign(Object.create(null), value);
function frozenTree(value) {
  if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); for (const item of Object.values(value)) frozenTree(item); }
}

test('animation target sources preserve exact five-field BOM/CRLF text without aliasing caller data', () => {
  assert.equal(SCENE_ANIMATION_TARGETS_API_PATH, '/api/scene-animation-targets');
  const input = source(), captured = captureSceneAnimationTargetSource(input);
  assert.deepEqual(captured, input); assert.notEqual(captured, input); assert.ok(Object.isFrozen(captured));
  assert.equal(captured.content, saved()); input.content = '{}'; input.token = 'other';
  assert.equal(captured.content, saved()); assert.equal(captured.token, 'source:1');
  assert.deepEqual(captureSceneAnimationTargetSource(nullRecord(source())), source());
});

test('target directory retains author order, repeated definition instances and literal display labels', () => {
  const input = raw(), result = captureSceneAnimationTargetDirectory(input, id(1));
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
  assert.equal(isSceneAnimationTargets(value), true); assert.equal(sceneAnimationTargetsMatchSource(value, source()), true);
  assert.deepEqual(Object.keys(value).sort(), ['manifest', 'savedContent', 'scene', 'targets']);
  assert.deepEqual(Object.keys(value.manifest).sort(), ['objectId', 'sourcePath', 'sourceRevision']);
  assert.equal(value.savedContent, saved()); frozenTree(value);
  assert.equal(sceneAnimationTargetValue(value, id(7)), id(7)); assert.equal(validateSceneAnimationTargets(value, animation()), true);
  assert.throws(() => { value.targets[0].instanceId = id(99); }, TypeError);
  assert.throws(() => { value.targets.push(input.targets[0]); }, TypeError);
  s.token = 'later'; input.targets[0].instanceId = id(100); assert.equal(sceneAnimationTargetsMatchSource(value, source()), true);
});

test('ordinary unsaved animation text binds the saved base revision and preserves its own source revision', () => {
  const text = saved().replace('"durationSeconds": 2', '"durationSeconds": 3'), draft = source(text), value = catalog(draft);
  assert.notEqual(draft.sourceRevision, draft.baseSourceRevision);
  assert.equal(value.savedContent, saved()); assert.equal(sceneAnimationTargetsMatchSource(value, draft), true);
  assert.equal(sceneAnimationTargetsMatchSource(value, source()), false);
  const wrong = raw(); wrong.manifest.sourceRevision = draft.sourceRevision;
  assert.throws(() => catalog(draft, wrong), invalid);
});

test('every source identity field participates in catalog matching and equality', () => {
  const value = catalog();
  const changes = { sourcePath: 'documents/animations/other.json', token: 'source:2', baseSourceRevision: revision('new base'),
    sourceRevision: revision('new source'), content: saved() + ' ' };
  for (const [key, replacement] of Object.entries(changes)) {
    assert.equal(sceneAnimationTargetsMatchSource(value, { ...source(), [key]: replacement }), false, key);
  }
  const nextSource = source(saved() + ' '), next = catalog(nextSource);
  assert.equal(sceneAnimationTargetsEqual(value, next), false);
  assert.equal(sceneAnimationTargetsEqual(value, catalog()), true);
});

test('catalog equality includes private world state and all source and target directory values', () => {
  const value = catalog();
  for (const mutate of [d => { d.worldId = 'world:' + hash('other world'); }, d => { d.revision = revision('other world revision'); },
    d => { d.scene.sourceRevision = revision('new scene'); }, d => { d.scene.sourcePath = 'documents/scenes/other.json'; },
    d => { d.manifest.objectId = id(30); }, d => { d.targets.reverse(); }, d => { d.targets[2].name = 'new name'; },
    d => { d.targets[2].sourcePath = 'documents/characters/renamed.md'; }, d => { d.targets[2].objectId = id(31); },
    d => { d.targets[2].instanceId = id(32); }, d => { d.manifest.content += ' '; }]) {
    const data = raw(); mutate(data); const changed = catalog(source(), data);
    assert.equal(sceneAnimationTargetsEqual(value, changed), false);
  }
  const changedWorld = raw(); changedWorld.revision = revision('new world');
  const visuallySame = catalog(source(), changedWorld);
  assert.deepEqual(value, visuallySame); assert.equal(sceneAnimationTargetsEqual(value, visuallySame), false);
  const reordered = raw(); reordered.scene = { sourceRevision: reordered.scene.sourceRevision, sourcePath: reordered.scene.sourcePath, objectId: reordered.scene.objectId };
  assert.equal(sceneAnimationTargetsEqual(value, catalog(source(), reordered)), true);
});

test('catalog brand cannot be recovered by serialization copying prototype inheritance or raw directory capture', () => {
  const value = catalog();
  for (const forged of [null, {}, { ...value }, structuredClone(value), JSON.parse(JSON.stringify(value)), Object.create(value),
    captureSceneAnimationTargetDirectory(raw(), id(1))]) {
    assert.equal(isSceneAnimationTargets(forged), false); assert.equal(sceneAnimationTargetsMatchSource(forged, source()), false);
    assert.equal(sceneAnimationTargetsEqual(value, forged), false); assert.equal(sceneAnimationTargetsEqual(forged, value), false);
    assert.throws(() => sceneAnimationTargetValue(forged, id(8)), invalid);
    assert.throws(() => validateSceneAnimationTargets(forged, animation()), invalid);
  }
});

test('selection accepts only issued instance identities without coercing names or definition IDs', () => {
  const value = catalog(); let reads = 0;
  for (const candidate of [id(3), id(1), id(2), id(99), '', null, 7, '旅行者 🦊',
    { toString() { reads++; return id(8); }, valueOf() { reads++; return id(8); } }]) assert.throws(() => sceneAnimationTargetValue(value, candidate), invalid);
  assert.equal(reads, 0); assert.equal(sceneAnimationTargetValue(value, id(8)), id(8));
});

test('missing targets remain readable and selectable for repair but fail complete candidate validation', () => {
  const missing = animation(); missing.tracks[0].instanceId = id(90);
  missing.tracks.push({ id: id(21), instanceId: id(90), property: 'opacity', interpolation: 'step', keyframes: [{ atSeconds: 0, value: 1 }] },
    { id: id(22), instanceId: id(91), property: 'rotation2d', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: 0 }] });
  const text = JSON.stringify(missing), s = source(text), data = raw();
  s.baseSourceRevision = s.sourceRevision; data.manifest.content = text; data.manifest.sourceRevision = s.baseSourceRevision;
  const value = catalog(s, data); assert.equal(isSceneAnimationTargets(value), true); assert.equal(sceneAnimationTargetValue(value, id(7)), id(7));
  assert.throws(() => validateSceneAnimationTargets(value, missing), error => {
    assert.equal(error.errorCode, 'scene_animation_target_missing'); assert.deepEqual(error.instanceIds, [id(90), id(91)]);
    assert.ok(Object.isFrozen(error.instanceIds)); return true;
  });
  const repaired = structuredClone(missing); repaired.tracks.forEach(track => { track.instanceId = id(7); });
  assert.equal(validateSceneAnimationTargets(value, repaired), true); assert.equal(missing.tracks[0].instanceId, id(90));
});

test('candidate validation retains Rust animation rules and cannot switch the directory scene', () => {
  const value = catalog();
  for (const mutate of [d => { d.durationSeconds = 0; }, d => { d.tracks = []; }, d => { d.tracks[0].keyframes[1].atSeconds = 0; },
    d => { d.tracks[0].keyframes[1].value = [Infinity, 0]; }, d => { d.tracks.push(structuredClone(d.tracks[0])); }]) {
    const document = animation(); mutate(document); assert.throws(() => validateSceneAnimationTargets(value, document));
  }
  assert.throws(() => validateSceneAnimationTargets(value, { ...animation(), sceneObjectId: id(99) }), invalid);
  let reads = 0; const document = animation(); Object.defineProperty(document.tracks[0], 'instanceId', { enumerable: true, get() { reads++; return id(8); } });
  assert.throws(() => validateSceneAnimationTargets(value, document)); assert.equal(reads, 0);
});

test('source capture rejects extra symbol hidden inherited accessor and serializer fields without evaluating them', () => {
  let reads = 0;
  for (const mutate of [s => { s.extra = true; }, s => { s[Symbol('extra')] = true; },
    s => Object.defineProperty(s, 'token', { value: 'hidden', enumerable: false }),
    s => Object.defineProperty(s, 'content', { enumerable: true, get() { reads++; return saved(); } }),
    s => Object.setPrototypeOf(s, { extra: true }), s => { s.toJSON = () => { reads++; return {}; }; }]) {
    const s = source(); mutate(s); assert.throws(() => captureSceneAnimationTargetSource(s), invalid);
    assert.throws(() => captureSceneAnimationTargets(s, raw()), invalid);
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
    const data = raw(); mutate(data); assert.throws(() => captureSceneAnimationTargetDirectory(data, id(1)), invalid);
  }
  assert.equal(reads, 0);
});

test('null-prototype records are detached normally while list holes extra fields and altered prototypes are rejected', () => {
  const data = raw(); data.scene = nullRecord(data.scene); data.manifest = nullRecord(data.manifest); data.targets = data.targets.map(nullRecord);
  assert.deepEqual(captureSceneAnimationTargetDirectory(nullRecord(data), id(1)), raw());
  for (const mutate of [d => { delete d.targets[0]; }, d => { d.targets.extra = true; }, d => { d.targets[Symbol('extra')] = true; },
    d => { delete d.targets[0]; d.targets.extra = true; }, d => Object.setPrototypeOf(d.targets, null),
    d => Object.setPrototypeOf(d.targets, Object.create(Array.prototype)), d => Object.defineProperty(d.targets, '0', { enumerable: false, value: d.targets[0] })]) {
    const input = raw(); mutate(input); assert.throws(() => captureSceneAnimationTargetDirectory(input, id(1)), invalid);
  }
});

test('ambient serializers are rejected without evaluating their functions or getters', () => {
  let reads = 0;
  for (const prototype of [Object.prototype, Array.prototype]) {
    const previous = Object.getOwnPropertyDescriptor(prototype, 'toJSON'), inputSource = source(), inputDirectory = raw();
    try {
      Object.defineProperty(prototype, 'toJSON', { configurable: true, get() { reads++; return () => { reads++; return {}; }; } });
      assert.throws(() => captureSceneAnimationTargetSource(inputSource), invalid);
      assert.throws(() => captureSceneAnimationTargetDirectory(inputDirectory, id(1)), invalid);
    } finally { if (previous) Object.defineProperty(prototype, 'toJSON', previous); else delete prototype.toJSON; }
  }
  assert.equal(reads, 0);
});

test('source paths are normalized relative JSON identifiers and source tokens and revisions are bounded', () => {
  for (const sourcePath of ['../main.json', '/main.json', 'C:main.json', 'documents\\main.json', 'documents//main.json',
    './documents/main.json', 'documents/./main.json', 'documents/../main.json', '.hidden/main.json', 'documents/main.json/',
    'documents/main.txt', 'documents/\nmain.json', 'documents/\x7fmain.json', 'documents/main\ud800.json', 'x'.repeat(4097) + '.json'])
    assert.throws(() => captureSceneAnimationTargetSource({ ...source(), sourcePath }), invalid, sourcePath);
  for (const [key, value] of [['token', ''], ['token', 'x'.repeat(257)], ['token', '\ud800'], ['baseSourceRevision', 'bad'], ['sourceRevision', 'sha256:' + 'A'.repeat(64)]])
    assert.throws(() => captureSceneAnimationTargetSource({ ...source(), [key]: value }), invalid, key);
  assert.ok(captureSceneAnimationTargetSource({ ...source(), sourcePath: 'documents/动画.JSON', token: 'x'.repeat(256) }));
});

test('source and saved document reject malformed syntax duplicate decoded keys invalid Unicode and foreign animation semantics', () => {
  for (const content of ['', '{}', '[1]', '{', saved() + '\ud800', JSON.stringify({ ...animation(), tracks: [] }),
    saved().replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'),
    saved().replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersi\\u006fn": 1'),
    saved().replace('viento-scene-animation', 'viento-scene-audio')]) {
    assert.throws(() => captureSceneAnimationTargetSource(source(content)), invalid);
    const data = raw(); data.manifest.content = content; assert.throws(() => captureSceneAnimationTargetDirectory(data, id(1)), invalid);
  }
});

test('both raw text bounds count UTF-8 bytes including BOM rather than only UTF-16 units', () => {
  const compact = '\ufeff' + JSON.stringify(animation()), padded = compact + ' '.repeat(131072 - Buffer.byteLength(compact));
  assert.equal(Buffer.byteLength(padded), 131072); assert.equal(padded.length, 131070);
  assert.ok(captureSceneAnimationTargetSource(source(padded)));
  const data = raw(); data.manifest.content = padded; assert.ok(captureSceneAnimationTargetDirectory(data, id(1)));
  for (const content of [padded + ' ', ' '.repeat(131073) + JSON.stringify(animation())]) {
    assert.throws(() => captureSceneAnimationTargetSource(source(content)), invalid);
    data.manifest.content = content; assert.throws(() => captureSceneAnimationTargetDirectory(data, id(1)), invalid);
  }
});

test('directory rejects incompatible versions identities revisions and cross-scene saved declarations', () => {
  for (const mutate of [d => { d.format = 'other'; }, d => { d.schemaVersion = 2; }, d => { d.worldId = 'world:short'; },
    d => { d.revision = 'invalid'; }, d => { d.scene.objectId = id(30); }, d => { d.scene.sourceRevision = 'invalid'; },
    d => { d.scene.sourcePath = 'documents/scene.txt'; }, d => { d.manifest.objectId = id(1); }, d => { d.manifest.sourcePath = d.scene.sourcePath; },
    d => { d.manifest.sourceRevision = 'invalid'; }, d => { d.manifest.content = JSON.stringify({ ...animation(), sceneObjectId: id(30) }); }]) {
    const data = raw(); mutate(data); assert.throws(() => captureSceneAnimationTargetDirectory(data, id(1)), invalid);
  }
  for (const expected of [null, 'other', id(30)]) assert.throws(() => captureSceneAnimationTargetDirectory(raw(), expected), invalid);
});

test('source-bound capture rejects manifest path base revision and scene mismatches', () => {
  for (const mutate of [d => { d.manifest.sourcePath = 'documents/animations/other.json'; }, d => { d.manifest.sourceRevision = revision('new base'); }]) {
    const data = raw(); mutate(data); assert.throws(() => catalog(source(), data), invalid);
  }
  const other = animation(); other.sceneObjectId = id(30); assert.throws(() => catalog(source(JSON.stringify(other))), invalid);
});

test('target rows require distinct instance IDs and coherent definition identity path and title mappings', () => {
  for (const mutate of [d => { d.targets[1].instanceId = d.targets[0].instanceId; }, d => { d.targets[1].sourcePath = 'documents/characters/alias.md'; },
    d => { d.targets[1].name = 'inconsistent title'; }, d => { d.targets[2].sourcePath = d.targets[0].sourcePath; },
    d => { d.targets[2].objectId = id(1); }, d => { d.targets[2].objectId = id(2); },
    d => { d.targets[2].sourcePath = d.scene.sourcePath; }, d => { d.targets[2].sourcePath = d.manifest.sourcePath; },
    d => { d.targets[2].instanceId = 'not-a-uuid'; }, d => { d.targets[2].objectId = null; }]) {
    const data = raw(); mutate(data); assert.throws(() => captureSceneAnimationTargetDirectory(data, id(1)), invalid);
  }
});

test('target display names and definition paths reject malformed data while preserving author-visible text', () => {
  for (const [key, value] of [['name', ''], ['name', '   '], ['name', '\nlabel'], ['name', 'label\x7f'], ['name', '\ud800'], ['name', 'x'.repeat(161)],
    ['sourcePath', '../outside.md'], ['sourcePath', '/outside.md'], ['sourcePath', 'documents\\actor.md'], ['sourcePath', 'C:actor.md'],
    ['sourcePath', 'documents//actor.md'], ['sourcePath', 'documents/actor\0.md'], ['sourcePath', 'documents/actor\ud800.md']]) {
    const data = raw(); data.targets[2][key] = value; assert.throws(() => captureSceneAnimationTargetDirectory(data, id(1)), invalid, key);
  }
  const data = raw(); data.targets[2].name = 'x'.repeat(160); data.targets[2].sourcePath = 'documents/角色.txt';
  assert.equal(captureSceneAnimationTargetDirectory(data, id(1)).targets[2].name.length, 160);
});

test('directory admits exactly one through 128 authored instances with no invented candidates', () => {
  const data = raw(); data.targets = [data.targets[0]]; assert.equal(captureSceneAnimationTargetDirectory(data, id(1)).targets.length, 1);
  data.targets = Array.from({ length: 128 }, (_, index) => ({ ...raw().targets[0], instanceId: id(1000 + index) }));
  assert.equal(captureSceneAnimationTargetDirectory(data, id(1)).targets.length, 128);
  data.targets.push({ ...data.targets[0], instanceId: id(2000) }); assert.throws(() => captureSceneAnimationTargetDirectory(data, id(1)), invalid);
  data.targets = []; assert.throws(() => captureSceneAnimationTargetDirectory(data, id(1)), invalid);
});
