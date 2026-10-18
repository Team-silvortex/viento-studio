import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { captureSceneAudioUsage, isSceneAudioUsage, sceneAudioUsageMatchSource,
  sceneAudioUsageSource } from '../../engine/scene-audio-usage.mjs';
import { sourceLocationSelection } from '../../web/modules/app-source-location.js';

const id = number => `aaaaaaaa-0000-4000-8000-${String(number).padStart(12, '0')}`;
const revision = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const invalid = { errorCode: 'scene_audio_usage_invalid' };
const binding = number => ({ bindingId: id(100 + number), instanceId: id(200 + number),
  implementation: { backendId: 'org.example.independent', language: 'custom', sourceObjectId: id(9) },
  parameters: { note: '中文🙂 prefix ' + id(5) + ' suffix', sound_a: id(5), sound_b: id(5) }, events: [] });
const behavior = () => ({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1),
  bindings: [binding(1), binding(2)] });
function fixture(behaviorContent = JSON.stringify(behavior(), null, 2)) {
  const audioContent = JSON.stringify({ format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: id(1),
    tracks: [{ id: id(5), resourceId: id(7), role: 'effect', volume: .5, loop: false }], cues: [] });
  const raw = { format: 'viento-scene-audio-usage', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: revision('world'),
    scene: { objectId: id(1), sourcePath: 'documents/scenes/main.json', sourceRevision: revision('scene') },
    audio: { objectId: id(2), sourcePath: 'documents/audio/main.json', sourceRevision: revision(audioContent), content: audioContent },
    behavior: behaviorContent === null ? null : { objectId: id(3), sourcePath: 'documents/behaviors/main.json',
      sourceRevision: revision(behaviorContent), content: behaviorContent } };
  const source = { sourcePath: raw.audio.sourcePath, token: 'source:1', baseSourceRevision: raw.audio.sourceRevision,
    sourceRevision: raw.audio.sourceRevision, content: raw.audio.content };
  return { raw, source, catalog: captureSceneAudioUsage(source, raw) };
}
function assertLocation(catalog, match, content, start, token) {
  const value = sceneAudioUsageSource(catalog, match);
  assert.equal(value.content, content);
  assert.equal(value.sourcePath, catalog.behavior.sourcePath);
  assert.equal(value.sourceRevision, revision(content));
  assert.equal(value.propertyPath, match.propertyPath);
  assert.deepEqual(value.sourceRange, { start, end: start + token.length, encoding: 'utf-16',
    propertyPath: match.propertyPath, exact: true });
  assert.equal(content.slice(value.sourceRange.start, value.sourceRange.end), token);
  assert.equal(JSON.parse(token), match.trackId);
  return value;
}

test('usage source returns only a frozen exact snapshot and keeps the existing public catalog contract', () => {
  const { raw, source, catalog } = fixture(), match = catalog.matches[0], value = sceneAudioUsageSource(catalog, match);
  assert.deepEqual(Object.keys(catalog).sort(), ['scene', 'audio', 'behavior', 'savedContent', 'matches'].sort());
  assert.deepEqual(Object.keys(catalog.behavior).sort(), ['objectId', 'sourcePath', 'sourceRevision'].sort());
  assert.deepEqual(Object.keys(value).sort(), ['sourcePath', 'sourceRevision', 'content', 'propertyPath', 'sourceRange'].sort());
  assert.equal(value.content, raw.behavior.content);
  assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.sourceRange));
  assert.throws(() => { value.content = 'replacement'; }, TypeError);
  assert.throws(() => { value.sourceRange.start = 0; }, TypeError);
  assert.ok(isSceneAudioUsage(catalog)); assert.ok(sceneAudioUsageMatchSource(catalog, source));
  assert.equal(catalog.savedContent, raw.audio.content);
  assert.deepEqual(sceneAudioUsageSource(catalog, match), value);
});

test('equal UUID strings locate their exact parameter and binding instead of the first text occurrence', () => {
  const { raw, catalog } = fixture(), content = raw.behavior.content;
  assert.equal(catalog.matches.length, 4);
  const starts = [];
  for (const [index, match] of catalog.matches.entries()) {
    const bindingStart = content.indexOf(`"bindingId": "${id(101 + Math.floor(index / 2))}"`);
    const prefix = `"${match.parameterName}": `;
    const start = content.indexOf(prefix, bindingStart) + prefix.length;
    assertLocation(catalog, match, content, start, JSON.stringify(id(5)));
    starts.push(start);
  }
  assert.equal(new Set(starts).size, 4);
  assert.ok(starts[0] > content.indexOf(id(5)), 'the earlier UUID inside ordinary text is not selected');
});

test('BOM newline variants escaped strings and preceding Unicode retain exact original UTF16 ranges', () => {
  for (const newline of ['\n', '\r\n', '\r']) for (const bom of ['', '\ufeff']) {
    const escaped = '\\u0061' + id(5).slice(1), token = '"' + escaped + '"';
    const content = bom + JSON.stringify(behavior(), null, 2).replaceAll(id(5), escaped).replaceAll('\n', newline);
    const { catalog } = fixture(content);
    for (const [index, match] of catalog.matches.entries()) {
      const bindingStart = content.indexOf(`"bindingId": "${id(101 + Math.floor(index / 2))}"`);
      const prefix = `"${match.parameterName}": `, start = content.indexOf(prefix, bindingStart) + prefix.length;
      const location = assertLocation(catalog, match, content, start, token);
      const selection = sourceLocationSelection(content, location, location.sourceRevision);
      assert.equal(selection.status, 'exact');
      assert.equal(content.replace(/\r\n|\r/g, '\n').slice(selection.start, selection.end), token);
      assert.equal(selection.start, content.slice(0, start).replace(/\r\n|\r/g, '\n').length);
    }
  }
});

test('minified behavior snapshots select full string tokens without normalizing document bytes', () => {
  const content = JSON.stringify(behavior()), { catalog } = fixture(content);
  for (const [index, match] of catalog.matches.entries()) {
    const bindingStart = content.indexOf(`"bindingId":"${id(101 + Math.floor(index / 2))}"`);
    const prefix = `"${match.parameterName}":`, start = content.indexOf(prefix, bindingStart) + prefix.length;
    assertLocation(catalog, match, content, start, JSON.stringify(id(5)));
  }
});

test('source accessor rejects copied inherited serialized or foreign catalog and match objects', () => {
  const { catalog } = fixture(), other = fixture().catalog, match = catalog.matches[0];
  for (const value of [null, undefined, 1, 'catalog', {}, { ...catalog }, structuredClone(catalog), Object.create(catalog)]) {
    assert.throws(() => sceneAudioUsageSource(value, match), invalid);
  }
  for (const value of [null, undefined, 1, match.trackId, [], {}, { ...match }, structuredClone(match), Object.create(match), other.matches[0]]) {
    assert.throws(() => sceneAudioUsageSource(catalog, value), invalid);
  }
  assert.throws(() => sceneAudioUsageSource(other, match), invalid);
});

test('untrusted catalog and match getters serializers and proxy traps are not consulted', () => {
  const { catalog } = fixture(), match = catalog.matches[0]; let calls = 0;
  const accessor = {};
  for (const key of ['matches', 'behavior', 'content', 'sourcePath', 'propertyPath', 'trackId', 'sourceRange', 'toJSON']) {
    Object.defineProperty(accessor, key, { enumerable: true, get() { calls++; throw Error('Untrusted accessor'); } });
  }
  const traps = { get() { calls++; throw Error('Untrusted get'); }, ownKeys() { calls++; throw Error('Untrusted keys'); },
    getPrototypeOf() { calls++; throw Error('Untrusted prototype'); }, getOwnPropertyDescriptor() { calls++; throw Error('Untrusted descriptor'); } };
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const value of [accessor, new Proxy(catalog, traps), revoked.proxy]) assert.throws(() => sceneAudioUsageSource(value, match), invalid);
  for (const value of [accessor, new Proxy(match, traps), revoked.proxy]) assert.throws(() => sceneAudioUsageSource(catalog, value), invalid);
  assert.equal(calls, 0);
});

test('caller mutation and later directories cannot replace the captured saved source', () => {
  const { raw, source, catalog } = fixture(), original = raw.behavior.content, old = sceneAudioUsageSource(catalog, catalog.matches[0]);
  const changed = behavior(); changed.bindings.reverse(); changed.bindings[0].parameters.sound_a = id(6);
  raw.behavior.content = '\ufeff' + JSON.stringify(changed, null, 4).replaceAll('\n', '\r\n');
  raw.behavior.sourceRevision = revision(raw.behavior.content);
  raw.behavior.sourcePath = 'documents/behaviors/later.json';
  const next = captureSceneAudioUsage(source, raw), current = sceneAudioUsageSource(next, next.matches[0]);
  assert.equal(old.content, original);
  assert.deepEqual(sceneAudioUsageSource(catalog, catalog.matches[0]), old);
  assert.equal(current.content, raw.behavior.content); assert.equal(current.sourcePath, raw.behavior.sourcePath);
  assert.notEqual(current.sourceRevision, old.sourceRevision);
  assert.notEqual(current.sourceRange.start, old.sourceRange.start);
  assert.throws(() => sceneAudioUsageSource(catalog, next.matches[0]), invalid);
  assert.throws(() => sceneAudioUsageSource(next, catalog.matches[0]), invalid);
});

test('missing behavior or a saved declaration without UUID matches supplies no location', () => {
  const missing = fixture(null), value = behavior();
  for (const binding of value.bindings) binding.parameters = { ordinary: 'text', amount: 10, enabled: true };
  const empty = fixture(JSON.stringify(value)), match = fixture().catalog.matches[0];
  for (const { catalog } of [missing, empty]) {
    assert.deepEqual(catalog.matches, []);
    assert.throws(() => sceneAudioUsageSource(catalog, match), invalid);
    assert.throws(() => sceneAudioUsageSource(catalog, undefined), invalid);
  }
});

test('saved source locations stay separate from an unsaved audio source and its five-field ownership', () => {
  const { raw, source } = fixture(), document = JSON.parse(source.content); document.tracks[0].volume = .25;
  const draft = { ...source, content: '\ufeff' + JSON.stringify(document, null, 2).replaceAll('\n', '\r\n') };
  draft.sourceRevision = revision(draft.content);
  const catalog = captureSceneAudioUsage(draft, raw), sourceView = sceneAudioUsageSource(catalog, catalog.matches[0]);
  assert.equal(sourceView.content, raw.behavior.content); assert.equal(catalog.savedContent, source.content);
  assert.ok(sceneAudioUsageMatchSource(catalog, { ...draft }));
  assert.equal(sceneAudioUsageMatchSource(catalog, source), false);
  for (const key of ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content']) {
    assert.equal(sceneAudioUsageMatchSource(catalog, { ...draft, [key]: draft[key] + 'changed' }), false, key);
  }
  const before = JSON.stringify(draft); sceneAudioUsageSource(catalog, catalog.matches[1]);
  assert.equal(JSON.stringify(draft), before);
});
