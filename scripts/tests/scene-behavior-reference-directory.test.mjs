import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { SCENE_BEHAVIOR_REFERENCE_DIRECTORY_API_PATH, captureSceneBehaviorReferenceDirectory, captureSceneBehaviorReferences,
  isSceneBehaviorReferences, sceneBehaviorReferencesMatchSource, sceneBehaviorReferenceValue } from '../../engine/scene-behavior-reference-directory.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const revision = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const scene = () => ({ objectId: id(1), sourcePath: 'documents/scenes/main.json', sourceRevision: revision('main') });
const named = (n, name, path) => ({ objectId: id(n), name, sourcePath: path, sourceRevision: revision(path) });
const assembly = () => named(20, 'Main project', 'documents/projects/main.json');
const definition = () => named(2, 'Player', 'documents/player.md');
const raw = (selected = true) => ({ format: 'viento-scene-behavior-reference-directory', schemaVersion: 1,
  worldId: 'world:' + 'a'.repeat(64), revision: revision('world'), scene: scene(),
  instances: [{ instanceId: id(8), ...definition() }, { instanceId: id(10), ...definition() }],
  assemblies: [assembly()], selectedAssembly: selected ? { ...assembly(),
    members: [{ ...scene(), name: 'Main' }, named(21, 'Next', 'documents/scenes/next.json')],
    inputMap: { objectId: id(30), sourcePath: 'documents/input.json', sourceRevision: revision('input') },
    actions: [{ name: 'jump', keys: ['KeyJ', 'Space'] }, { name: 'retry', keys: ['Enter'] }] } : null });
const content = JSON.stringify({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1),
  bindings: [{ bindingId: id(3), instanceId: id(8), implementation: { backendId: 'org.example.independent', language: 'custom', sourceObjectId: id(9) },
    parameters: { target: 'ordinary text' }, events: [] }] });
const source = () => ({ sourcePath: 'documents/behaviors/main.json', token: 'source:1', baseSourceRevision: revision(content), sourceRevision: revision(content), content });
const invalid = { errorCode: 'scene_behavior_reference_directory_invalid' };
const catalog = (input = raw()) => captureSceneBehaviorReferences(source(), input, scene());

test('reference directory keeps detached frozen names and source identities, including repeated definitions', () => {
  assert.equal(SCENE_BEHAVIOR_REFERENCE_DIRECTORY_API_PATH, '/api/scene-behavior-reference-directory');
  const input = raw(), value = captureSceneBehaviorReferenceDirectory(input, id(1));
  assert.deepEqual(value, input); assert.notEqual(value.instances[0], input.instances[0]);
  assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.selectedAssembly.actions[0].keys));
  input.instances[0].name = 'changed'; input.selectedAssembly.members.pop(); input.selectedAssembly.actions[0].keys.push('KeyQ');
  assert.equal(value.instances[0].name, 'Player'); assert.equal(value.instances.length, 2);
  assert.equal(value.instances[0].objectId, value.instances[1].objectId);
  assert.notEqual(value.instances[0].instanceId, value.instances[1].instanceId);
  assert.deepEqual(value.selectedAssembly.actions[0].keys, ['KeyJ', 'Space']);
  assert.equal(isSceneBehaviorReferences(value), false, 'wire validation alone grants no source-bound catalog brand');
});
test('explicit assembly offers only member scene IDs and authored action names beside local instance IDs', () => {
  const value = catalog(); assert.ok(isSceneBehaviorReferences(value));
  assert.deepEqual(value, raw()); assert.ok(sceneBehaviorReferencesMatchSource(value, source()));
  for (const [kind, scalar] of [['instance', id(8)], ['instance', id(10)], ['scene', id(1)], ['scene', id(21)], ['action', 'jump']])
    assert.equal(sceneBehaviorReferenceValue(value, { kind, value: scalar }), scalar);
  for (const [kind, scalar] of [['instance', id(2)], ['instance', id(21)], ['scene', id(99)], ['scene', id(20)],
    ['action', 'ui_accept'], ['action', 'KeyJ'], ['action', 'ordinary text'], ['action', ''], ['instance', 'not a UUID']])
    assert.equal(sceneBehaviorReferenceValue(value, { kind, value: scalar }), null);
});
test('one or several containing assemblies never select themselves and local instances stay available', () => {
  for (const count of [0, 1, 2]) {
    const input = raw(false); input.assemblies = count ? [assembly()] : [];
    if (count === 2) input.assemblies.push(named(40, 'Other', 'documents/projects/other.json'));
    const value = catalog(input); assert.equal(value.selectedAssembly, null);
    assert.equal(sceneBehaviorReferenceValue(value, { kind: 'instance', value: id(8) }), id(8));
    assert.equal(sceneBehaviorReferenceValue(value, { kind: 'scene', value: id(1) }), null);
    assert.equal(sceneBehaviorReferenceValue(value, { kind: 'action', value: 'jump' }), null);
  }
  const input = raw(); input.selectedAssembly.inputMap = null; input.selectedAssembly.actions = [];
  assert.equal(sceneBehaviorReferenceValue(catalog(input), { kind: 'action', value: 'jump' }), null);
});
test('catalog brand cannot be forged and exact five source fields remain private and pinned', () => {
  const original = source(), value = captureSceneBehaviorReferences(original, raw(), scene()); original.token = 'later';
  assert.ok(sceneBehaviorReferencesMatchSource(value, source())); assert.equal(sceneBehaviorReferencesMatchSource(value, original), false);
  assert.equal(Object.hasOwn(value, 'content'), false); assert.equal(Object.hasOwn(value, 'token'), false);
  for (const forged of [null, {}, { ...value }, structuredClone(value), Object.create(value)]) {
    assert.equal(isSceneBehaviorReferences(forged), false); assert.equal(sceneBehaviorReferencesMatchSource(forged, source()), false);
    assert.throws(() => sceneBehaviorReferenceValue(forged, { kind: 'instance', value: id(8) }), invalid);
  }
  for (const [key, changed] of [['sourcePath', 'documents/other.json'], ['token', 'source:2'], ['baseSourceRevision', revision('base')],
    ['sourceRevision', revision('saved')], ['content', content.replace('ordinary text', 'changed text')]])
    assert.equal(sceneBehaviorReferencesMatchSource(value, { ...source(), [key]: changed }), false);
  const draft = source(); draft.content = content.replace('ordinary text', 'unsaved parameter'); draft.sourceRevision = revision(draft.content);
  assert.ok(sceneBehaviorReferencesMatchSource(captureSceneBehaviorReferences(draft, raw(), scene()), draft));
});
test('all directory levels reject accessors, serializers, holes, symbols and inherited data without invoking getters', () => {
  let calls = 0;
  const getter = (object, key, value) => Object.defineProperty(object, key, { enumerable: true, get() { calls++; return value; } });
  for (const mutate of [d => getter(d, 'scene', scene()), d => getter(d.scene, 'objectId', id(1)), d => getter(d.instances[0], 'name', 'Player'),
    d => getter(d.instances, '0', d.instances[0]), d => getter(d.assemblies[0], 'name', 'Main'), d => getter(d.selectedAssembly, 'members', []),
    d => getter(d.selectedAssembly.members[0], 'name', 'Main'), d => getter(d.selectedAssembly.inputMap, 'sourcePath', 'documents/input.json'),
    d => getter(d.selectedAssembly.actions[0], 'name', 'jump'), d => getter(d.selectedAssembly.actions[0].keys, '0', 'KeyJ'),
    d => { d[Symbol('extra')] = 1; }, d => { d.instances.extra = true; }, d => { delete d.instances[0]; },
    d => Object.setPrototypeOf(d.instances, {}), d => Object.setPrototypeOf(d.scene, { inherited: true }),
    d => { d.toJSON = () => { calls++; return {}; }; }, d => Object.defineProperty(d.scene, 'objectId', { enumerable: false, value: id(1) })]) {
    const input = raw(); mutate(input); assert.throws(() => captureSceneBehaviorReferenceDirectory(input, id(1)), invalid);
  }
  const expected = scene(); getter(expected, 'objectId', id(1));
  assert.throws(() => captureSceneBehaviorReferences(source(), raw(), expected), invalid);
  const inputSource = source(); getter(inputSource, 'content', content);
  assert.throws(() => captureSceneBehaviorReferences(inputSource, raw(), scene()), invalid);
  assert.equal(sceneBehaviorReferencesMatchSource(catalog(), inputSource), false); assert.equal(calls, 0);
});
test('wire limits, identity consistency and declared map semantics are enforced independently', () => {
  for (const mutate of [d => { d.schemaVersion = 2; }, d => { d.worldId = 'world:bad'; }, d => { d.revision = 'bad'; },
    d => { d.scene.objectId = id(99); }, d => { d.scene.sourcePath = '../main.json'; }, d => { d.scene.sourcePath = 'C:main.json'; },
    d => { d.scene.sourceRevision = 'bad'; }, d => { d.instances = []; }, d => { d.instances[1].instanceId = id(8); },
    d => { d.instances[1].sourceRevision = revision('different definition'); }, d => { d.instances[0].name = 'x'.repeat(161); },
    d => { d.instances[0].name = '\ud800'; }, d => { d.instances[0].name = 'bad\nlabel'; }, d => { d.instances[0].sourcePath = '\ud800'; },
    d => { d.instances = Array.from({ length: 129 }, (_, n) => ({ ...d.instances[0], instanceId: id(n + 100) })); },
    d => { d.assemblies.push({ ...assembly() }); }, d => { d.assemblies = Array.from({ length: 257 }, (_, n) => named(n + 100, 'Project', `documents/p${n}.json`)); },
    d => { d.selectedAssembly.name = 'forged name'; }, d => { d.selectedAssembly.members.shift(); },
    d => { d.selectedAssembly.members[0].sourceRevision = revision('other current scene'); },
    d => { d.selectedAssembly.members.push({ ...d.selectedAssembly.members[0] }); },
    d => { d.selectedAssembly.members = Array.from({ length: 33 }, (_, n) => named(n + 100, 'Scene', `documents/s${n}.json`)); },
    d => { d.selectedAssembly.inputMap = null; }, d => { d.selectedAssembly.inputMap.objectId = id(1); },
    d => { d.selectedAssembly.actions = []; }, d => { d.selectedAssembly.actions[0].name = 'ui_accept'; },
    d => { d.selectedAssembly.actions[1].name = 'jump'; }, d => { d.selectedAssembly.actions[0].keys = ['KeyJ', 'KeyJ']; },
    d => { d.selectedAssembly.actions[0].keys = ['Escape']; }, d => { d.selectedAssembly.actions[0].keys = ['KeyJ', '\ud800']; }]) {
    const input = raw(); mutate(input); assert.throws(() => captureSceneBehaviorReferenceDirectory(input, id(1)), invalid);
  }
});
test('behavior source and expected saved scene must match exact ownership and bounded plain source data', () => {
  for (const mutate of [s => { s.sourcePath = '../main.json'; }, s => { s.sourcePath = 'documents/main.txt'; }, s => { s.token = ''; },
    s => { s.token = 'x'.repeat(257); }, s => { s.token = '\ud800'; }, s => { s.content = '{}'; }, s => { s.extra = true; },
    s => { s.content = content.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'); },
    s => { s.content += ' '.repeat(32768); }, s => { s.content = content.replace('ordinary text', '中'.repeat(12000)); }]) {
    const input = source(); mutate(input); assert.throws(() => captureSceneBehaviorReferences(input, raw(), scene()), invalid);
  }
  for (const [key, changed] of [['objectId', id(99)], ['sourcePath', 'documents/scenes/other.json'], ['sourceRevision', revision('later')]])
    assert.throws(() => captureSceneBehaviorReferences(source(), raw(), { ...scene(), [key]: changed }), invalid);
  const input = source(); input.sourcePath = scene().sourcePath;
  assert.throws(() => captureSceneBehaviorReferences(input, raw(), scene()), invalid);
});
test('reference selection accepts only exact data and never coerces author values', () => {
  const value = catalog(); let calls = 0;
  for (const selection of [null, {}, { kind: 'script', value: id(8) }, { kind: 'instance', value: 8 }, { kind: 'action', value: 'x'.repeat(4097) },
    { kind: 'action', value: '\ud800' }, { kind: 'instance', value: id(8), execute: true },
    Object.defineProperty({ kind: 'instance' }, 'value', { enumerable: true, get() { calls++; return id(8); } })])
    assert.throws(() => sceneBehaviorReferenceValue(value, selection), invalid);
  assert.equal(calls, 0);
});
