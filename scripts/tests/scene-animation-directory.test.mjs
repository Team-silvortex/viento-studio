import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { SCENE_ANIMATION_DIRECTORY_API_PATH, captureSceneAnimationDirectory, captureSceneBehaviorAnimationClips, isSceneBehaviorAnimationClips,
  sceneBehaviorAnimationClipsMatchSource, sceneBehaviorAnimationClipValue } from '../../engine/scene-animation-directory.mjs';
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const revision = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const scene = () => ({ objectId: id(1), sourcePath: 'documents/scenes/main.json', sourceRevision: revision('scene') });
const animation = () => ({ format: 'viento-scene-animation', schemaVersion: 3, sceneObjectId: id(1), durationSeconds: 2, loop: true,
  tracks: [{ id: id(10), instanceId: id(8), property: 'opacity', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: 2, value: 1 }] }],
  clips: [{ id: id(5), name: '待機 / Idle', startSeconds: .25, endSeconds: 1, loop: true },
    { id: id(4), name: '攻撃 / Attack', startSeconds: .5, endSeconds: 2, loop: false }] });
const raw = () => ({ format: 'viento-scene-animation-directory', schemaVersion: 1, status: 'ready', worldId: 'world:' + 'a'.repeat(64),
  revision: revision('world'), scene: scene(), manifest: { objectId: id(2), sourcePath: 'documents/animations/main.json', sourceRevision: revision('animation'), content: JSON.stringify(animation()) } });
const content = JSON.stringify({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1), bindings: [{ bindingId: id(3), instanceId: id(8),
  implementation: { backendId: 'org.example.independent', language: 'custom', sourceObjectId: id(9) }, parameters: { arbitrary: '', clip_id: 'ordinary' }, events: [] }] });
const source = () => ({ sourcePath: 'documents/behaviors/main.json', token: 'source:1', baseSourceRevision: revision(content), sourceRevision: revision(content), content });
const invalid = { errorCode: 'scene_animation_directory_invalid' };

test('animation identity directory captures exact detached frozen data with no resource availability contract', () => {
  assert.equal(SCENE_ANIMATION_DIRECTORY_API_PATH, '/api/scene-animation-directory');
  const input = raw(), result = captureSceneAnimationDirectory(input, id(1));
  assert.deepEqual(result, input); assert.notEqual(result.scene, input.scene); assert.ok(Object.isFrozen(result.manifest));
  input.scene.sourcePath = 'other'; input.manifest.content = '{}';
  assert.equal(result.scene.sourcePath, scene().sourcePath); assert.equal(JSON.parse(result.manifest.content).clips.length, 2);
  assert.deepEqual(Object.keys(result).sort(), ['format', 'schemaVersion', 'status', 'worldId', 'revision', 'scene', 'manifest'].sort());
});
test('source-bound catalog exposes authored order and only named clip identities and authored range descriptors', () => {
  const input = source(), catalog = captureSceneBehaviorAnimationClips(input, raw(), scene());
  assert.ok(isSceneBehaviorAnimationClips(catalog)); assert.ok(sceneBehaviorAnimationClipsMatchSource(catalog, source()));
  assert.deepEqual(Object.keys(catalog).sort(), ['status', 'scene', 'manifest', 'clips'].sort());
  assert.deepEqual(catalog.clips, animation().clips.map(({ id: clipId, ...clip }) => ({ clipId, ...clip })));
  assert.deepEqual(Object.keys(catalog.manifest).sort(), ['objectId', 'sourcePath', 'sourceRevision'].sort());
  assert.equal(sceneBehaviorAnimationClipValue(catalog, id(4)), id(4)); assert.ok(Object.isFrozen(catalog.clips[0]));
  assert.throws(() => { catalog.clips.push({}); }, TypeError);
  input.token = 'later'; assert.equal(sceneBehaviorAnimationClipsMatchSource(catalog, input), false);
});
test('empty explicit opt-in produces no candidates and no invented clip identities', () => {
  const input = raw(); input.status = 'empty'; input.manifest = null;
  const catalog = captureSceneBehaviorAnimationClips(source(), input, scene());
  assert.equal(catalog.status, 'empty'); assert.equal(catalog.manifest, null); assert.deepEqual(catalog.clips, []);
  assert.throws(() => sceneBehaviorAnimationClipValue(catalog, id(5)), invalid);
});
test('catalog authority cannot be forged serialized copied or used to choose a track, scene, manifest or arbitrary UUID', () => {
  const catalog = captureSceneBehaviorAnimationClips(source(), raw(), scene());
  for (const forged of [null, {}, { ...catalog }, structuredClone(catalog), Object.create(catalog)]) {
    assert.equal(isSceneBehaviorAnimationClips(forged), false); assert.equal(sceneBehaviorAnimationClipsMatchSource(forged, source()), false);
    assert.throws(() => sceneBehaviorAnimationClipValue(forged, id(5)), invalid);
  }
  for (const clipId of [id(10), id(1), id(2), id(99), id(5).toUpperCase().replace('4000', '4AAA'), null, { valueOf: () => id(5) }])
    assert.throws(() => sceneBehaviorAnimationClipValue(catalog, clipId), invalid);
});
test('all source identity fields are privately pinned while unsaved ordinary parameter text remains eligible', () => {
  const draft = source(); draft.content = content.replace('ordinary', 'unsaved'); draft.sourceRevision = revision(draft.content);
  const catalog = captureSceneBehaviorAnimationClips(draft, raw(), scene());
  assert.ok(sceneBehaviorAnimationClipsMatchSource(catalog, draft)); assert.equal(sceneBehaviorAnimationClipsMatchSource(catalog, source()), false);
  for (const [key, value] of [['sourcePath', 'documents/other.json'], ['token', 'source:2'], ['baseSourceRevision', revision('later')],
    ['sourceRevision', revision('other')], ['content', content]]) assert.equal(sceneBehaviorAnimationClipsMatchSource(catalog, { ...draft, [key]: value }), false);
});
test('behavior source exact fields reject getters symbols hidden fields and nonplain prototypes without invoking them', () => {
  let calls = 0;
  for (const mutate of [s => Object.defineProperty(s, 'content', { enumerable: true, get() { calls++; return content; } }),
    s => Object.defineProperty(s, 'token', { value: 'hidden', enumerable: false }), s => { s[Symbol('extra')] = true; },
    s => { s.extra = true; }, s => Object.setPrototypeOf(s, { inherited: true }), s => { s.toJSON = () => { calls++; return {}; }; }]) {
    const s = source(); mutate(s); assert.throws(() => captureSceneBehaviorAnimationClips(s, raw(), scene()), invalid);
  }
  assert.equal(calls, 0);
});
test('source text paths revisions and behavior semantics are independently bounded', () => {
  for (const mutate of [s => { s.sourcePath = '../main.json'; }, s => { s.sourcePath = '/main.json'; }, s => { s.sourcePath = 'C:main.json'; },
    s => { s.sourcePath = 'documents/main.txt'; }, s => { s.token = ''; }, s => { s.token = '\ud800'; }, s => { s.token = 'x'.repeat(257); },
    s => { s.sourceRevision = 'bad'; }, s => { s.content = '{}'; }, s => { s.content = 'x'.repeat(32769); },
    s => { s.content = content.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'); },
    s => { s.content = content.replace('"ordinary"', '"' + '中'.repeat(12000) + '"'); }]) {
    const s = source(); mutate(s); assert.throws(() => captureSceneBehaviorAnimationClips(s, raw(), scene()), invalid);
  }
});
test('directory and expected scene reject accessors before reading author data', () => {
  let calls = 0;
  for (const mutate of [d => Object.defineProperty(d, 'scene', { enumerable: true, get() { calls++; return scene(); } }),
    d => Object.defineProperty(d.manifest, 'content', { enumerable: true, get() { calls++; return '{}'; } }),
    d => Object.setPrototypeOf(d.scene, { bad: true }), d => { d.scene.extra = true; }, d => { d[Symbol('extra')] = true; },
    d => { d.manifest.toJSON = () => { calls++; return {}; }; }]) {
    const d = raw(); mutate(d); assert.throws(() => captureSceneAnimationDirectory(d, id(1)), invalid);
  }
  const expected = scene(); Object.defineProperty(expected, 'objectId', { enumerable: true, get() { calls++; return id(1); } });
  assert.throws(() => captureSceneBehaviorAnimationClips(source(), raw(), expected), invalid); assert.equal(calls, 0);
});
test('directory rejects mismatched scene or manifest identities and inconsistent ready/empty state', () => {
  for (const mutate of [d => { d.schemaVersion = 2; }, d => { d.status = 'other'; }, d => { d.status = 'empty'; }, d => { d.manifest = null; },
    d => { d.scene.objectId = id(6); }, d => { d.worldId = 'bad'; }, d => { d.revision = 'bad'; },
    d => { d.manifest.objectId = id(1); }, d => { d.manifest.sourcePath = d.scene.sourcePath; }, d => { d.manifest.sourcePath = '../animation.json'; },
    d => { d.manifest.sourceRevision = 'bad'; }, d => { d.manifest.content = JSON.stringify({ ...animation(), sceneObjectId: id(8) }); }]) {
    const d = raw(); mutate(d); assert.throws(() => captureSceneAnimationDirectory(d, id(1)), invalid);
  }
  assert.throws(() => captureSceneAnimationDirectory(raw(), id(99)), invalid);
  for (const [key, value] of [['objectId', id(99)], ['sourcePath', 'documents/changed.json'], ['sourceRevision', revision('changed')]])
    assert.throws(() => captureSceneBehaviorAnimationClips(source(), raw(), { ...scene(), [key]: value }), invalid);
  const d = raw(); d.manifest.sourcePath = source().sourcePath;
  assert.throws(() => captureSceneBehaviorAnimationClips(source(), d, scene()), invalid);
});
test('native animation rules reject malformed curves and clips without interpreting strings as scripts', () => {
  const badDocuments = [];
  for (const mutate of [a => { a.tracks = []; }, a => { a.tracks.push(a.tracks[0]); },
    a => { a.clips[1].id = a.clips[0].id; }, a => { a.clips[0].name = ' padded '; },
    a => { a.clips[0].name = 'x'.repeat(129); }, a => { a.clips[0].name = 'line\nnext'; },
    a => { a.clips[0].name = '\ud800'; }, a => { a.clips[0].startSeconds = 1; },
    a => { a.clips[0].endSeconds = 2.1; }, a => { a.clips[0].loop = 1; },
    a => { a.clips[0].unknown = true; }, a => { a.schemaVersion = 4; },
    a => { a.clips = Array.from({ length: 33 }, (_, i) => ({ ...a.clips[0], id: id(100 + i) })); }]) {
    const a = animation(); mutate(a); badDocuments.push(JSON.stringify(a));
  }
  for (const content of ['{}', JSON.stringify(animation()).replace('"schemaVersion":3', '"schemaVersion":3,"schemaVersion":3'),
    JSON.stringify(animation()).replace('"clips":', '"cl\\u0069ps":[],"clips":'), ...badDocuments]) {
    const d = raw(); d.manifest.content = content; assert.throws(() => captureSceneAnimationDirectory(d, id(1)), invalid);
  }
  const s = source(); s.content = content.replace('"ordinary"', '"select_animation_clip(unknown)"'); s.sourceRevision = revision(s.content);
  assert.ok(isSceneBehaviorAnimationClips(captureSceneBehaviorAnimationClips(s, raw(), scene())));
});
test('legacy schema1/2 and schema3 without named clips stay ready without invented candidates or upgrades', () => {
  for (const version of [1, 2, 3]) {
    const a = animation(); a.schemaVersion = version;
    if (version === 3) a.clips = []; else delete a.clips;
    const d = raw(); d.manifest.content = JSON.stringify(a);
    const directory = captureSceneAnimationDirectory(d, id(1));
    const catalog = captureSceneBehaviorAnimationClips(source(), directory, scene());
    assert.equal(catalog.status, 'ready'); assert.deepEqual(catalog.clips, []); assert.equal(catalog.manifest.objectId, id(2));
    assert.equal(directory.manifest.content, JSON.stringify(a)); assert.throws(() => sceneBehaviorAnimationClipValue(catalog, null), invalid);
  }
});
test('overlapping ranges repeated names Unicode scalar names and the 32 clip boundary are owned by Rust validation', () => {
  const a = animation(); a.clips = Array.from({ length: 32 }, (_, i) => ({ ...a.clips[0], id: id(100 + i), name: '🌸'.repeat(128) }));
  const d = raw(); d.manifest.content = JSON.stringify(a);
  const catalog = captureSceneBehaviorAnimationClips(source(), d, scene());
  assert.equal(catalog.clips.length, 32); assert.equal(catalog.clips[0].name, '🌸'.repeat(128));
  assert.equal(sceneBehaviorAnimationClipValue(catalog, id(131)), id(131));
});
test('animation raw source has its separate 128 KiB budget while behavior sources remain limited to 32 KiB', () => {
  const d = raw(), compact = d.manifest.content;
  d.manifest.content = compact + ' '.repeat(131072 - Buffer.byteLength(compact));
  assert.equal(Buffer.byteLength(captureSceneAnimationDirectory(d, id(1)).manifest.content), 131072);
  assert.equal(captureSceneBehaviorAnimationClips(source(), d, scene()).clips.length, 2);
  d.manifest.content += ' '; assert.throws(() => captureSceneAnimationDirectory(d, id(1)), invalid);
  d.manifest.content = compact + '中'.repeat(44000); assert.throws(() => captureSceneAnimationDirectory(d, id(1)), invalid);
  const s = source(); s.content += ' '.repeat(32768 - Buffer.byteLength(s.content));
  assert.equal(captureSceneBehaviorAnimationClips(s, raw(), scene()).clips.length, 2);
  s.content += ' '; assert.throws(() => captureSceneBehaviorAnimationClips(s, raw(), scene()), invalid);
});
