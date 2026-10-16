import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { SCENE_AUDIO_DIRECTORY_API_PATH, captureSceneAudioDirectory, captureSceneBehaviorAudioTracks, isSceneBehaviorAudioTracks,
  sceneBehaviorAudioTracksMatchSource, sceneBehaviorAudioTrackValue } from '../../engine/scene-audio-directory.mjs';
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const revision = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const scene = () => ({ objectId: id(1), sourcePath: 'documents/scenes/main.json', sourceRevision: revision('scene') });
const audio = () => ({ format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: id(1),
  tracks: [{ id: id(5), resourceId: id(7), role: 'effect', volume: .5, loop: false }, { id: id(4), resourceId: id(7), role: 'music', volume: .25, loop: true }], cues: [] });
const raw = () => ({ format: 'viento-scene-audio-directory', schemaVersion: 1, status: 'ready', worldId: 'world:' + 'a'.repeat(64),
  revision: revision('world'), scene: scene(), manifest: { objectId: id(2), sourcePath: 'documents/audio/main.json', sourceRevision: revision('audio'), content: JSON.stringify(audio()) } });
const content = JSON.stringify({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1), bindings: [{ bindingId: id(3), instanceId: id(8),
  implementation: { backendId: 'org.example.independent', language: 'custom', sourceObjectId: id(9) }, parameters: { arbitrary: '', track_id: 'ordinary' }, events: [] }] });
const source = () => ({ sourcePath: 'documents/behaviors/main.json', token: 'source:1', baseSourceRevision: revision(content), sourceRevision: revision(content), content });
const invalid = { errorCode: 'scene_audio_directory_invalid' };

test('audio identity directory captures exact detached frozen data with no resource availability contract', () => {
  assert.equal(SCENE_AUDIO_DIRECTORY_API_PATH, '/api/scene-audio-directory');
  const input = raw(), result = captureSceneAudioDirectory(input, id(1));
  assert.deepEqual(result, input); assert.notEqual(result.scene, input.scene); assert.ok(Object.isFrozen(result.manifest));
  input.scene.sourcePath = 'other'; input.manifest.content = '{}';
  assert.equal(result.scene.sourcePath, scene().sourcePath); assert.equal(JSON.parse(result.manifest.content).tracks.length, 2);
  assert.deepEqual(Object.keys(result).sort(), ['format', 'schemaVersion', 'status', 'worldId', 'revision', 'scene', 'manifest'].sort());
});
test('source-bound catalog exposes authored order and only the track identity values', () => {
  const input = source(), catalog = captureSceneBehaviorAudioTracks(input, raw(), scene());
  assert.ok(isSceneBehaviorAudioTracks(catalog)); assert.ok(sceneBehaviorAudioTracksMatchSource(catalog, source()));
  assert.deepEqual(Object.keys(catalog).sort(), ['status', 'scene', 'manifest', 'tracks'].sort());
  assert.deepEqual(catalog.tracks, [{ trackId: id(5), resourceId: id(7), role: 'effect' }, { trackId: id(4), resourceId: id(7), role: 'music' }]);
  assert.deepEqual(Object.keys(catalog.manifest).sort(), ['objectId', 'sourcePath', 'sourceRevision'].sort());
  assert.equal(sceneBehaviorAudioTrackValue(catalog, id(4)), id(4)); assert.ok(Object.isFrozen(catalog.tracks[0]));
  assert.throws(() => { catalog.tracks.push({}); }, TypeError);
  input.token = 'later'; assert.equal(sceneBehaviorAudioTracksMatchSource(catalog, input), false);
});
test('empty explicit opt-in produces no candidates and no invented track identities', () => {
  const input = raw(); input.status = 'empty'; input.manifest = null;
  const catalog = captureSceneBehaviorAudioTracks(source(), input, scene());
  assert.equal(catalog.status, 'empty'); assert.equal(catalog.manifest, null); assert.deepEqual(catalog.tracks, []);
  assert.throws(() => sceneBehaviorAudioTrackValue(catalog, id(5)), invalid);
});
test('catalog authority cannot be forged serialized copied or used to choose a resource UUID', () => {
  const catalog = captureSceneBehaviorAudioTracks(source(), raw(), scene());
  for (const forged of [null, {}, { ...catalog }, structuredClone(catalog), Object.create(catalog)]) {
    assert.equal(isSceneBehaviorAudioTracks(forged), false); assert.equal(sceneBehaviorAudioTracksMatchSource(forged, source()), false);
    assert.throws(() => sceneBehaviorAudioTrackValue(forged, id(5)), invalid);
  }
  for (const trackId of [id(7), id(99), id(5).toUpperCase().replace('4000', '4AAA'), null, { valueOf: () => id(5) }])
    assert.throws(() => sceneBehaviorAudioTrackValue(catalog, trackId), invalid);
});
test('all source identity fields are privately pinned while unsaved ordinary parameter text remains eligible', () => {
  const draft = source(); draft.content = content.replace('ordinary', 'unsaved'); draft.sourceRevision = revision(draft.content);
  const catalog = captureSceneBehaviorAudioTracks(draft, raw(), scene());
  assert.ok(sceneBehaviorAudioTracksMatchSource(catalog, draft)); assert.equal(sceneBehaviorAudioTracksMatchSource(catalog, source()), false);
  for (const [key, value] of [['sourcePath', 'documents/other.json'], ['token', 'source:2'], ['baseSourceRevision', revision('later')],
    ['sourceRevision', revision('other')], ['content', content]]) assert.equal(sceneBehaviorAudioTracksMatchSource(catalog, { ...draft, [key]: value }), false);
});
test('behavior source exact fields reject getters symbols hidden fields and nonplain prototypes without invoking them', () => {
  let calls = 0;
  for (const mutate of [s => Object.defineProperty(s, 'content', { enumerable: true, get() { calls++; return content; } }),
    s => Object.defineProperty(s, 'token', { value: 'hidden', enumerable: false }), s => { s[Symbol('extra')] = true; },
    s => { s.extra = true; }, s => Object.setPrototypeOf(s, { inherited: true }), s => { s.toJSON = () => { calls++; return {}; }; }]) {
    const s = source(); mutate(s); assert.throws(() => captureSceneBehaviorAudioTracks(s, raw(), scene()), invalid);
  }
  assert.equal(calls, 0);
});
test('source text paths revisions and behavior semantics are independently bounded', () => {
  for (const mutate of [s => { s.sourcePath = '../main.json'; }, s => { s.sourcePath = '/main.json'; }, s => { s.sourcePath = 'C:main.json'; },
    s => { s.sourcePath = 'documents/main.txt'; }, s => { s.token = ''; }, s => { s.token = '\ud800'; }, s => { s.token = 'x'.repeat(257); },
    s => { s.sourceRevision = 'bad'; }, s => { s.content = '{}'; }, s => { s.content = 'x'.repeat(32769); },
    s => { s.content = content.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'); },
    s => { s.content = content.replace('"ordinary"', '"' + '中'.repeat(12000) + '"'); }]) {
    const s = source(); mutate(s); assert.throws(() => captureSceneBehaviorAudioTracks(s, raw(), scene()), invalid);
  }
});
test('directory and expected scene reject accessors before reading author data', () => {
  let calls = 0;
  for (const mutate of [d => Object.defineProperty(d, 'scene', { enumerable: true, get() { calls++; return scene(); } }),
    d => Object.defineProperty(d.manifest, 'content', { enumerable: true, get() { calls++; return '{}'; } }),
    d => Object.setPrototypeOf(d.scene, { bad: true }), d => { d.scene.extra = true; }, d => { d[Symbol('extra')] = true; },
    d => { d.manifest.toJSON = () => { calls++; return {}; }; }]) {
    const d = raw(); mutate(d); assert.throws(() => captureSceneAudioDirectory(d, id(1)), invalid);
  }
  const expected = scene(); Object.defineProperty(expected, 'objectId', { enumerable: true, get() { calls++; return id(1); } });
  assert.throws(() => captureSceneBehaviorAudioTracks(source(), raw(), expected), invalid); assert.equal(calls, 0);
});
test('directory rejects mismatched scene or manifest identities and inconsistent ready/empty state', () => {
  for (const mutate of [d => { d.schemaVersion = 2; }, d => { d.status = 'other'; }, d => { d.status = 'empty'; }, d => { d.manifest = null; },
    d => { d.scene.objectId = id(6); }, d => { d.worldId = 'bad'; }, d => { d.revision = 'bad'; },
    d => { d.manifest.objectId = id(1); }, d => { d.manifest.sourcePath = d.scene.sourcePath; }, d => { d.manifest.sourcePath = '../audio.json'; },
    d => { d.manifest.sourceRevision = 'bad'; }, d => { d.manifest.content = JSON.stringify({ ...audio(), sceneObjectId: id(8) }); }]) {
    const d = raw(); mutate(d); assert.throws(() => captureSceneAudioDirectory(d, id(1)), invalid);
  }
  assert.throws(() => captureSceneAudioDirectory(raw(), id(99)), invalid);
  for (const [key, value] of [['objectId', id(99)], ['sourcePath', 'documents/changed.json'], ['sourceRevision', revision('changed')]])
    assert.throws(() => captureSceneBehaviorAudioTracks(source(), raw(), { ...scene(), [key]: value }), invalid);
  const d = raw(); d.manifest.sourcePath = source().sourcePath;
  assert.throws(() => captureSceneBehaviorAudioTracks(source(), d, scene()), invalid);
});
test('native audio rules reject malformed declarations and track/cue errors without interpreting strings as scripts', () => {
  for (const content of ['{}', 'x'.repeat(32769), JSON.stringify(audio()).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    JSON.stringify({ ...audio(), tracks: [] }), JSON.stringify({ ...audio(), tracks: [audio().tracks[0], audio().tracks[0]] }),
    JSON.stringify({ ...audio(), cues: [{ id: id(10), trackId: id(99), action: 'play', atSeconds: 0 }] })]) {
    const d = raw(); d.manifest.content = content; assert.throws(() => captureSceneAudioDirectory(d, id(1)), invalid);
  }
  const s = source(); s.content = content.replace('"ordinary"', '"play_audio(unknown)"'); s.sourceRevision = revision(s.content);
  assert.ok(isSceneBehaviorAudioTracks(captureSceneBehaviorAudioTracks(s, raw(), scene())));
});
