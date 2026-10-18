import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { SCENE_AUDIO_USAGE_API_PATH, captureSceneAudioUsageDirectory, captureSceneAudioUsage, isSceneAudioUsage,
  sceneAudioUsageMatchSource } from '../../engine/scene-audio-usage.mjs';
const id = number => `aaaaaaaa-0000-4000-8000-${String(number).padStart(12, '0')}`;
const revision = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const scene = () => ({ objectId: id(1), sourcePath: 'documents/scenes/main.json', sourceRevision: revision('scene') });
const audio = () => ({ format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: id(1),
  tracks: [{ id: id(5), resourceId: id(7), role: 'effect', volume: .5, loop: false }], cues: [] });
const binding = number => ({ bindingId: id(100 + number), instanceId: id(200 + number),
  implementation: { backendId: 'org.example.independent', language: 'custom', sourceObjectId: id(9) },
  parameters: { anything: id(5), future_track: id(6), track_id: 'ordinary text' }, events: [] });
const behavior = () => ({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1), bindings: [binding(1)] });
function raw() {
  const audioContent = JSON.stringify(audio()), behaviorContent = JSON.stringify(behavior());
  return { format: 'viento-scene-audio-usage', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: revision('world'), scene: scene(),
    audio: { objectId: id(2), sourcePath: 'documents/audio/main.json', sourceRevision: revision(audioContent), content: audioContent },
    behavior: { objectId: id(3), sourcePath: 'documents/behaviors/main.json', sourceRevision: revision(behaviorContent), content: behaviorContent } };
}
const source = (input = raw()) => ({ sourcePath: input.audio.sourcePath, token: 'source:1',
  baseSourceRevision: input.audio.sourceRevision, sourceRevision: input.audio.sourceRevision, content: input.audio.content });
const setBehavior = (value, document) => { value.behavior.content = JSON.stringify(document); value.behavior.sourceRevision = revision(value.behavior.content); };
const invalid = { errorCode: 'scene_audio_usage_invalid' };

test('usage directory captures exact detached frozen saved document data', () => {
  assert.equal(SCENE_AUDIO_USAGE_API_PATH, '/api/scene-audio-usage');
  const input = raw(), value = captureSceneAudioUsageDirectory(input, id(1));
  assert.deepEqual(value, input); assert.notEqual(value.audio, input.audio); assert.ok(Object.isFrozen(value.behavior));
  input.audio.content = '{}'; input.behavior.sourcePath = 'changed';
  assert.equal(value.audio.content, raw().audio.content); assert.equal(value.behavior.sourcePath, raw().behavior.sourcePath);
});
test('usage catalog reports ordinary complete UUID scalar matches and preserves author binding and parameter order', () => {
  const input = raw(), document = behavior(); document.bindings.push(binding(2)); setBehavior(input, document);
  const catalog = captureSceneAudioUsage(source(input), input);
  assert.deepEqual(Object.keys(catalog).sort(), ['scene', 'audio', 'behavior', 'savedContent', 'matches'].sort());
  assert.ok(isSceneAudioUsage(catalog)); assert.ok(sceneAudioUsageMatchSource(catalog, source(input)));
  assert.deepEqual(catalog.matches, document.bindings.flatMap((value, index) => ['anything', 'future_track'].map(parameterName => ({
    trackId: value.parameters[parameterName], bindingId: value.bindingId, instanceId: value.instanceId, parameterName,
    propertyPath: `/bindings/${index}/parameters/${parameterName}` }))));
  assert.equal(catalog.matches.some(match => match.trackId === id(6)), true, 'a UUID need not already be a saved track');
  assert.equal(catalog.savedContent, input.audio.content); assert.ok(Object.isFrozen(catalog.matches[0]));
  assert.throws(() => catalog.matches.push({}), TypeError);
});
test('UUID matching has no parameter-name heuristics, trimming, casing, substring or scalar coercion', () => {
  const input = raw(), document = behavior(); document.bindings[0].parameters = { arbitrary: id(5), track_id: 'not an ID',
    leading: ' ' + id(5), trailing: id(5) + ' ', upper: id(5).toUpperCase(), embedded: `play(${id(5)})`, number: 42, boolean: true,
    newline: id(5) + '\n', prefix: id(5) + 'x', empty: '' }; setBehavior(input, document);
  assert.deepEqual(captureSceneAudioUsage(source(input), input).matches.map(match => match.parameterName), ['arbitrary']);
});
test('no selected behavior is distinct from a selected valid behavior with no matching scalar', () => {
  const none = raw(); none.behavior = null;
  const missing = captureSceneAudioUsage(source(none), none); assert.equal(missing.behavior, null); assert.deepEqual(missing.matches, []);
  const empty = raw(), document = behavior(); document.bindings[0].parameters = { track_id: 'ordinary' }; setBehavior(empty, document);
  const present = captureSceneAudioUsage(source(empty), empty); assert.ok(present.behavior); assert.deepEqual(present.matches, []);
});
test('source ownership permits unsaved audio content while pinning the saved baseline and scene', () => {
  const input = raw(), original = source(input), draft = { ...original }, document = audio();
  document.tracks.push({ ...document.tracks[0], id: id(6) }); draft.content = '\ufeff' + JSON.stringify(document, null, 2).replaceAll('\n', '\r\n'); draft.sourceRevision = revision(draft.content);
  const catalog = captureSceneAudioUsage(draft, input); assert.equal(catalog.savedContent, original.content);
  assert.ok(sceneAudioUsageMatchSource(catalog, { ...draft })); assert.equal(sceneAudioUsageMatchSource(catalog, original), false);
  for (const [key, value] of [['sourcePath', 'documents/other.json'], ['token', 'new'], ['baseSourceRevision', revision('later')],
    ['sourceRevision', revision('different')], ['content', original.content]]) assert.equal(sceneAudioUsageMatchSource(catalog, { ...draft, [key]: value }), false);
  draft.token = 'caller mutation'; assert.equal(sceneAudioUsageMatchSource(catalog, draft), false);
});
test('ordinary source may use the editor 64KiB limit independently of 32KiB saved directory sources', () => {
  const input = raw(), draft = source(input); draft.content += ' '.repeat(40000); draft.sourceRevision = revision(draft.content);
  assert.ok(isSceneAudioUsage(captureSceneAudioUsage(draft, input)));
  draft.content += ' '.repeat(30000); assert.throws(() => captureSceneAudioUsage(draft, input), invalid);
});
test('a catalog cannot be forged by copying serialization or inheritance', () => {
  const catalog = captureSceneAudioUsage(source(), raw());
  for (const value of [null, {}, { ...catalog }, structuredClone(catalog), Object.create(catalog)]) {
    assert.equal(isSceneAudioUsage(value), false); assert.equal(sceneAudioUsageMatchSource(value, source()), false);
  }
});
test('source descriptors reject getters hidden fields inherited fields serializers and symbols without executing them', () => {
  let calls = 0;
  for (const mutate of [value => Object.defineProperty(value, 'content', { enumerable: true, get() { calls++; return raw().audio.content; } }),
    value => Object.defineProperty(value, 'token', { value: 'hidden', enumerable: false }), value => { value[Symbol('extra')] = true; },
    value => { value.extra = true; }, value => Object.setPrototypeOf(value, { inherited: true }), value => { value.toJSON = () => { calls++; return {}; }; }]) {
    const value = source(); mutate(value); assert.throws(() => captureSceneAudioUsage(value, raw()), invalid);
  }
  assert.equal(calls, 0);
});
test('directory descriptors reject accessors before traversing any author source', () => {
  let calls = 0;
  for (const mutate of [value => Object.defineProperty(value, 'scene', { enumerable: true, get() { calls++; return scene(); } }),
    value => Object.defineProperty(value.behavior, 'content', { enumerable: true, get() { calls++; return '{}'; } }),
    value => Object.setPrototypeOf(value.audio, { bad: true }), value => { value.scene.extra = true; }, value => { value[Symbol('extra')] = true; },
    value => { value.behavior.toJSON = () => { calls++; return {}; }; }]) {
    const value = raw(); mutate(value); assert.throws(() => captureSceneAudioUsageDirectory(value, id(1)), invalid);
  }
  assert.equal(calls, 0);
});
test('saved source identities cannot alias scenes each other or the audio editor baseline', () => {
  for (const mutate of [value => { value.scene.objectId = id(99); }, value => { value.audio.objectId = id(1); },
    value => { value.behavior.objectId = value.audio.objectId; }, value => { value.behavior.sourcePath = value.audio.sourcePath; },
    value => { value.audio.sourcePath = value.scene.sourcePath; }, value => { value.audio.sourceRevision = 'invalid'; },
    value => { value.behavior.sourcePath = '../escape.json'; }, value => { value.worldId = 'bad'; }, value => { value.revision = 'bad'; },
    value => { value.format = 'other'; }, value => { value.schemaVersion = 2; }]) {
    const value = raw(); mutate(value); assert.throws(() => captureSceneAudioUsageDirectory(value, id(1)), invalid);
  }
  assert.throws(() => captureSceneAudioUsageDirectory(raw(), id(99)), invalid);
  assert.throws(() => captureSceneAudioUsage({ ...source(), sourcePath: 'documents/other.json' }, raw()), invalid);
  assert.throws(() => captureSceneAudioUsage({ ...source(), baseSourceRevision: revision('changed') }, raw()), invalid);
});
test('invalid selected audio or behavior declarations never become an empty match list', () => {
  for (const kind of ['audio', 'behavior']) for (const content of ['{}', '{broken', 'x'.repeat(32769), raw()[kind].content + '中'.repeat(11000),
    raw()[kind].content.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    raw()[kind].content.replace(id(1), id(99))]) {
    const value = raw(); value[kind].content = content; assert.throws(() => captureSceneAudioUsageDirectory(value, id(1)), invalid);
  }
  const duplicate = raw(), document = behavior(); document.bindings.push(document.bindings[0]); setBehavior(duplicate, document);
  assert.throws(() => captureSceneAudioUsageDirectory(duplicate, id(1)), invalid);
});
test('source paths tokens UTF-8 byte limits and audio semantics remain bounded', () => {
  for (const mutate of [value => { value.sourcePath = '../audio.json'; }, value => { value.sourcePath = '/audio.json'; },
    value => { value.sourcePath = 'C:audio.json'; }, value => { value.sourcePath = 'documents/audio.txt'; }, value => { value.token = ''; },
    value => { value.token = '\ud800'; }, value => { value.token = 'x'.repeat(257); }, value => { value.sourceRevision = 'bad'; },
    value => { value.content = '{}'; }, value => { value.content += '中'.repeat(22000); },
    value => { value.content = value.content.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'); }]) {
    const value = source(); mutate(value); assert.throws(() => captureSceneAudioUsage(value, raw()), invalid);
  }
});
test('bounded manifests aggregate every scalar from many bindings without truncation', () => {
  const input = raw(), document = behavior(); document.bindings = Array.from({ length: 16 }, (_, index) => ({ ...binding(index),
    parameters: Object.fromEntries(Array.from({ length: 20 }, (_, field) => [`p${field}`, id(field + 5)])) })); setBehavior(input, document);
  const catalog = captureSceneAudioUsage(source(input), input); assert.equal(catalog.matches.length, 320);
  assert.equal(catalog.matches.at(-1).propertyPath, '/bindings/15/parameters/p19');
  document.bindings = Array.from({ length: 33 }, (_, index) => binding(index)); setBehavior(input, document);
  assert.throws(() => captureSceneAudioUsageDirectory(input, id(1)), invalid);
});
