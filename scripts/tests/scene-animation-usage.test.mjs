import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { sourceLocationSelection } from '../../web/modules/app-source-location.js';
import { SCENE_ANIMATION_USAGE_API_PATH, captureSceneAnimationUsageDirectory, captureSceneAnimationUsage, isSceneAnimationUsage,
  sceneAnimationUsageMatchSource, sceneAnimationUsageSource } from '../../engine/scene-animation-usage.mjs';
const id = number => `aaaaaaaa-0000-4000-8000-${String(number).padStart(12, '0')}`;
const revision = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const scene = () => ({ objectId: id(1), sourcePath: 'documents/scenes/main.json', sourceRevision: revision('scene') });
const animation = () => ({ format: 'viento-scene-animation', schemaVersion: 3, sceneObjectId: id(1), durationSeconds: 2, loop: true,
  tracks: [{ id: id(10), instanceId: id(201), property: 'opacity', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: 0 }, { atSeconds: 2, value: 1 }] }],
  clips: [{ id: id(5), name: '待機 / Idle', startSeconds: 0, endSeconds: 1, loop: true }] });
const binding = number => ({ bindingId: id(100 + number), instanceId: id(200 + number),
  implementation: { backendId: 'org.example.independent', language: 'custom', sourceObjectId: id(9) },
  parameters: { anything: id(5), future_clip: id(6), clip_id: 'ordinary text' }, events: [] });
const behavior = () => ({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1), bindings: [binding(1)] });
function raw() {
  const animationContent = JSON.stringify(animation()), behaviorContent = JSON.stringify(behavior());
  return { format: 'viento-scene-animation-usage', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: revision('world'), scene: scene(),
    animation: { objectId: id(2), sourcePath: 'documents/animations/main.json', sourceRevision: revision(animationContent), content: animationContent },
    behavior: { objectId: id(3), sourcePath: 'documents/behaviors/main.json', sourceRevision: revision(behaviorContent), content: behaviorContent } };
}
const source = (input = raw()) => ({ sourcePath: input.animation.sourcePath, token: 'source:1',
  baseSourceRevision: input.animation.sourceRevision, sourceRevision: input.animation.sourceRevision, content: input.animation.content });
const setBehavior = (value, document) => { value.behavior.content = JSON.stringify(document); value.behavior.sourceRevision = revision(value.behavior.content); };
const invalid = { errorCode: 'scene_animation_usage_invalid' };

test('usage directory captures exact detached frozen saved document data', () => {
  assert.equal(SCENE_ANIMATION_USAGE_API_PATH, '/api/scene-animation-usage');
  const input = raw(), value = captureSceneAnimationUsageDirectory(input, id(1));
  assert.deepEqual(value, input); assert.notEqual(value.animation, input.animation); assert.ok(Object.isFrozen(value.behavior));
  input.animation.content = '{}'; input.behavior.sourcePath = 'changed';
  assert.equal(value.animation.content, raw().animation.content); assert.equal(value.behavior.sourcePath, raw().behavior.sourcePath);
});
test('usage catalog reports ordinary complete UUID scalar matches and preserves author binding and parameter order', () => {
  const input = raw(), document = behavior(); document.bindings.push(binding(2)); setBehavior(input, document);
  const catalog = captureSceneAnimationUsage(source(input), input);
  assert.deepEqual(Object.keys(catalog).sort(), ['scene', 'animation', 'behavior', 'savedContent', 'matches'].sort());
  assert.ok(isSceneAnimationUsage(catalog)); assert.ok(sceneAnimationUsageMatchSource(catalog, source(input)));
  assert.deepEqual(catalog.matches, document.bindings.flatMap((value, index) => ['anything', 'future_clip'].map(parameterName => ({
    clipId: value.parameters[parameterName], bindingId: value.bindingId, instanceId: value.instanceId, parameterName,
    propertyPath: `/bindings/${index}/parameters/${parameterName}` }))));
  assert.equal(catalog.matches.some(match => match.clipId === id(6)), true, 'a UUID need not already be a saved clip');
  assert.equal(catalog.savedContent, input.animation.content); assert.ok(Object.isFrozen(catalog.matches[0]));
  assert.throws(() => catalog.matches.push({}), TypeError);
});
test('UUID matching has no parameter-name heuristics, trimming, casing, substring or scalar coercion', () => {
  const input = raw(), document = behavior(); document.bindings[0].parameters = { arbitrary: id(5), clip_id: 'not an ID',
    leading: ' ' + id(5), trailing: id(5) + ' ', upper: id(5).toUpperCase(), embedded: `play(${id(5)})`, number: 42, boolean: true,
    newline: id(5) + '\n', prefix: id(5) + 'x', empty: '' }; setBehavior(input, document);
  assert.deepEqual(captureSceneAnimationUsage(source(input), input).matches.map(match => match.parameterName), ['arbitrary']);
});
test('no selected behavior is distinct from a selected valid behavior with no matching scalar', () => {
  const none = raw(); none.behavior = null;
  const missing = captureSceneAnimationUsage(source(none), none); assert.equal(missing.behavior, null); assert.deepEqual(missing.matches, []);
  const empty = raw(), document = behavior(); document.bindings[0].parameters = { clip_id: 'ordinary' }; setBehavior(empty, document);
  const present = captureSceneAnimationUsage(source(empty), empty); assert.ok(present.behavior); assert.deepEqual(present.matches, []);
});
test('source ownership permits unsaved animation content while pinning the saved baseline and scene', () => {
  const input = raw(), original = source(input), draft = { ...original }, document = animation();
  document.clips.push({ ...document.clips[0], id: id(6), name: '攻撃 / Attack' }); draft.content = '\ufeff' + JSON.stringify(document, null, 2).replaceAll('\n', '\r\n'); draft.sourceRevision = revision(draft.content);
  const catalog = captureSceneAnimationUsage(draft, input); assert.equal(catalog.savedContent, original.content);
  assert.ok(sceneAnimationUsageMatchSource(catalog, { ...draft })); assert.equal(sceneAnimationUsageMatchSource(catalog, original), false);
  for (const [key, value] of [['sourcePath', 'documents/other.json'], ['token', 'new'], ['baseSourceRevision', revision('later')],
    ['sourceRevision', revision('different')], ['content', original.content]]) assert.equal(sceneAnimationUsageMatchSource(catalog, { ...draft, [key]: value }), false);
  draft.token = 'caller mutation'; assert.equal(sceneAnimationUsageMatchSource(catalog, draft), false);
});
test('saved and unsaved animation sources have independent 128 KiB budgets while behavior source is limited to 32 KiB', () => {
  const input = raw(), draft = source(input), compact = draft.content;
  draft.content += ' '.repeat(131072 - Buffer.byteLength(compact)); draft.sourceRevision = revision(draft.content);
  assert.ok(isSceneAnimationUsage(captureSceneAnimationUsage(draft, input)));
  input.animation.content = draft.content; input.animation.sourceRevision = revision(input.animation.content);
  assert.ok(isSceneAnimationUsage(captureSceneAnimationUsage(source(input), input)));
  draft.content += ' '; assert.throws(() => captureSceneAnimationUsage(draft, raw()), invalid);
  input.animation.content += ' '; assert.throws(() => captureSceneAnimationUsageDirectory(input, id(1)), invalid);
  const within = raw(); within.behavior.content += ' '.repeat(32768 - Buffer.byteLength(within.behavior.content));
  assert.ok(captureSceneAnimationUsageDirectory(within, id(1))); within.behavior.content += ' ';
  assert.throws(() => captureSceneAnimationUsageDirectory(within, id(1)), invalid);
});
test('a catalog cannot be forged by copying serialization or inheritance', () => {
  const catalog = captureSceneAnimationUsage(source(), raw());
  for (const value of [null, {}, { ...catalog }, structuredClone(catalog), Object.create(catalog)]) {
    assert.equal(isSceneAnimationUsage(value), false); assert.equal(sceneAnimationUsageMatchSource(value, source()), false);
  }
});
test('source descriptors reject getters hidden fields inherited fields serializers and symbols without executing them', () => {
  let calls = 0;
  for (const mutate of [value => Object.defineProperty(value, 'content', { enumerable: true, get() { calls++; return raw().animation.content; } }),
    value => Object.defineProperty(value, 'token', { value: 'hidden', enumerable: false }), value => { value[Symbol('extra')] = true; },
    value => { value.extra = true; }, value => Object.setPrototypeOf(value, { inherited: true }), value => { value.toJSON = () => { calls++; return {}; }; }]) {
    const value = source(); mutate(value); assert.throws(() => captureSceneAnimationUsage(value, raw()), invalid);
  }
  assert.equal(calls, 0);
});
test('directory descriptors reject accessors before traversing any author source', () => {
  let calls = 0;
  for (const mutate of [value => Object.defineProperty(value, 'scene', { enumerable: true, get() { calls++; return scene(); } }),
    value => Object.defineProperty(value.behavior, 'content', { enumerable: true, get() { calls++; return '{}'; } }),
    value => Object.setPrototypeOf(value.animation, { bad: true }), value => { value.scene.extra = true; }, value => { value[Symbol('extra')] = true; },
    value => { value.behavior.toJSON = () => { calls++; return {}; }; }]) {
    const value = raw(); mutate(value); assert.throws(() => captureSceneAnimationUsageDirectory(value, id(1)), invalid);
  }
  assert.equal(calls, 0);
});
test('saved source identities cannot alias scenes each other or the animation editor baseline', () => {
  for (const mutate of [value => { value.scene.objectId = id(99); }, value => { value.animation.objectId = id(1); },
    value => { value.behavior.objectId = value.animation.objectId; }, value => { value.behavior.sourcePath = value.animation.sourcePath; },
    value => { value.animation.sourcePath = value.scene.sourcePath; }, value => { value.animation.sourceRevision = 'invalid'; },
    value => { value.behavior.sourcePath = '../escape.json'; }, value => { value.worldId = 'bad'; }, value => { value.revision = 'bad'; },
    value => { value.format = 'other'; }, value => { value.schemaVersion = 2; }]) {
    const value = raw(); mutate(value); assert.throws(() => captureSceneAnimationUsageDirectory(value, id(1)), invalid);
  }
  assert.throws(() => captureSceneAnimationUsageDirectory(raw(), id(99)), invalid);
  assert.throws(() => captureSceneAnimationUsage({ ...source(), sourcePath: 'documents/other.json' }, raw()), invalid);
  assert.throws(() => captureSceneAnimationUsage({ ...source(), baseSourceRevision: revision('changed') }, raw()), invalid);
});
test('invalid selected animation or behavior declarations never become an empty match list', () => {
  for (const kind of ['animation', 'behavior']) for (const content of ['{}', '{broken', 'x'.repeat(131073), raw()[kind].content + '中'.repeat(44000),
    raw()[kind].content.replace(/"schemaVersion":([13])/, '"schemaVersion":$1,"schemaVersion":$1'),
    raw()[kind].content.replace(id(1), id(99))]) {
    const value = raw(); value[kind].content = content; assert.throws(() => captureSceneAnimationUsageDirectory(value, id(1)), invalid);
  }
  const duplicate = raw(), document = behavior(); document.bindings.push(document.bindings[0]); setBehavior(duplicate, document);
  assert.throws(() => captureSceneAnimationUsageDirectory(duplicate, id(1)), invalid);
});
test('source paths tokens UTF-8 byte limits and animation semantics remain bounded', () => {
  for (const mutate of [value => { value.sourcePath = '../animation.json'; }, value => { value.sourcePath = '/animation.json'; },
    value => { value.sourcePath = 'C:animation.json'; }, value => { value.sourcePath = 'documents/animation.txt'; }, value => { value.token = ''; },
    value => { value.token = '\ud800'; }, value => { value.token = 'x'.repeat(257); }, value => { value.sourceRevision = 'bad'; },
    value => { value.content = '{}'; }, value => { value.content += '中'.repeat(44000); },
    value => { value.content = value.content.replace('"schemaVersion":3', '"schemaVersion":3,"schemaVersion":3'); }]) {
    const value = source(); mutate(value); assert.throws(() => captureSceneAnimationUsage(value, raw()), invalid);
  }
});
test('bounded manifests aggregate every scalar from many bindings without truncation', () => {
  const input = raw(), document = behavior(); document.bindings = Array.from({ length: 16 }, (_, index) => ({ ...binding(index),
    parameters: Object.fromEntries(Array.from({ length: 20 }, (_, field) => [`p${field}`, id(field + 5)])) })); setBehavior(input, document);
  const catalog = captureSceneAnimationUsage(source(input), input); assert.equal(catalog.matches.length, 320);
  assert.equal(catalog.matches.at(-1).propertyPath, '/bindings/15/parameters/p19');
  document.bindings = Array.from({ length: 33 }, (_, index) => binding(index)); setBehavior(input, document);
  assert.throws(() => captureSceneAnimationUsageDirectory(input, id(1)), invalid);
});

const sourceBinding = number => ({ bindingId: id(100 + number), instanceId: id(200 + number),
  implementation: { backendId: 'org.example.independent', language: 'custom', sourceObjectId: id(9) },
  parameters: { note: '中文🙂 prefix ' + id(5) + ' suffix', clip_a: id(5), clip_b: id(5) }, events: [] });
const sourceBehavior = () => ({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1),
  bindings: [sourceBinding(1), sourceBinding(2)] });
function fixture(behaviorContent = JSON.stringify(sourceBehavior(), null, 2)) {
  const animationContent = JSON.stringify(animation());
  const raw = { format: 'viento-scene-animation-usage', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: revision('world'),
    scene: { objectId: id(1), sourcePath: 'documents/scenes/main.json', sourceRevision: revision('scene') },
    animation: { objectId: id(2), sourcePath: 'documents/animations/main.json', sourceRevision: revision(animationContent), content: animationContent },
    behavior: behaviorContent === null ? null : { objectId: id(3), sourcePath: 'documents/behaviors/main.json',
      sourceRevision: revision(behaviorContent), content: behaviorContent } };
  const source = { sourcePath: raw.animation.sourcePath, token: 'source:1', baseSourceRevision: raw.animation.sourceRevision,
    sourceRevision: raw.animation.sourceRevision, content: raw.animation.content };
  return { raw, source, catalog: captureSceneAnimationUsage(source, raw) };
}
function assertLocation(catalog, match, content, start, token) {
  const value = sceneAnimationUsageSource(catalog, match);
  assert.equal(value.content, content);
  assert.equal(value.sourcePath, catalog.behavior.sourcePath);
  assert.equal(value.sourceRevision, revision(content));
  assert.equal(value.propertyPath, match.propertyPath);
  assert.deepEqual(value.sourceRange, { start, end: start + token.length, encoding: 'utf-16',
    propertyPath: match.propertyPath, exact: true });
  assert.equal(content.slice(value.sourceRange.start, value.sourceRange.end), token);
  assert.equal(JSON.parse(token), match.clipId);
  return value;
}

test('usage source returns only a frozen exact snapshot and keeps the existing public catalog contract', () => {
  const { raw, source, catalog } = fixture(), match = catalog.matches[0], value = sceneAnimationUsageSource(catalog, match);
  assert.deepEqual(Object.keys(catalog).sort(), ['scene', 'animation', 'behavior', 'savedContent', 'matches'].sort());
  assert.deepEqual(Object.keys(catalog.behavior).sort(), ['objectId', 'sourcePath', 'sourceRevision'].sort());
  assert.deepEqual(Object.keys(value).sort(), ['sourcePath', 'sourceRevision', 'content', 'propertyPath', 'sourceRange'].sort());
  assert.equal(value.content, raw.behavior.content);
  assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.sourceRange));
  assert.throws(() => { value.content = 'replacement'; }, TypeError);
  assert.throws(() => { value.sourceRange.start = 0; }, TypeError);
  assert.ok(isSceneAnimationUsage(catalog)); assert.ok(sceneAnimationUsageMatchSource(catalog, source));
  assert.equal(catalog.savedContent, raw.animation.content);
  assert.deepEqual(sceneAnimationUsageSource(catalog, match), value);
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
    const content = bom + JSON.stringify(sourceBehavior(), null, 2).replaceAll(id(5), escaped).replaceAll('\n', newline);
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
  const content = JSON.stringify(sourceBehavior()), { catalog } = fixture(content);
  for (const [index, match] of catalog.matches.entries()) {
    const bindingStart = content.indexOf(`"bindingId":"${id(101 + Math.floor(index / 2))}"`);
    const prefix = `"${match.parameterName}":`, start = content.indexOf(prefix, bindingStart) + prefix.length;
    assertLocation(catalog, match, content, start, JSON.stringify(id(5)));
  }
});

test('source accessor rejects copied inherited serialized or foreign catalog and match objects', () => {
  const { catalog } = fixture(), other = fixture().catalog, match = catalog.matches[0];
  for (const value of [null, undefined, 1, 'catalog', {}, { ...catalog }, structuredClone(catalog), Object.create(catalog)]) {
    assert.throws(() => sceneAnimationUsageSource(value, match), invalid);
  }
  for (const value of [null, undefined, 1, match.clipId, [], {}, { ...match }, structuredClone(match), Object.create(match), other.matches[0]]) {
    assert.throws(() => sceneAnimationUsageSource(catalog, value), invalid);
  }
  assert.throws(() => sceneAnimationUsageSource(other, match), invalid);
});

test('untrusted catalog and match getters serializers and proxy traps are not consulted', () => {
  const { catalog } = fixture(), match = catalog.matches[0]; let calls = 0;
  const accessor = {};
  for (const key of ['matches', 'behavior', 'content', 'sourcePath', 'propertyPath', 'clipId', 'sourceRange', 'toJSON']) {
    Object.defineProperty(accessor, key, { enumerable: true, get() { calls++; throw Error('Untrusted accessor'); } });
  }
  const traps = { get() { calls++; throw Error('Untrusted get'); }, ownKeys() { calls++; throw Error('Untrusted keys'); },
    getPrototypeOf() { calls++; throw Error('Untrusted prototype'); }, getOwnPropertyDescriptor() { calls++; throw Error('Untrusted descriptor'); } };
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const value of [accessor, new Proxy(catalog, traps), revoked.proxy]) assert.throws(() => sceneAnimationUsageSource(value, match), invalid);
  for (const value of [accessor, new Proxy(match, traps), revoked.proxy]) assert.throws(() => sceneAnimationUsageSource(catalog, value), invalid);
  assert.equal(calls, 0);
});

test('caller mutation and later directories cannot replace the captured saved source', () => {
  const { raw, source, catalog } = fixture(), original = raw.behavior.content, old = sceneAnimationUsageSource(catalog, catalog.matches[0]);
  const changed = sourceBehavior(); changed.bindings.reverse(); changed.bindings[0].parameters.clip_a = id(6);
  raw.behavior.content = '\ufeff' + JSON.stringify(changed, null, 4).replaceAll('\n', '\r\n');
  raw.behavior.sourceRevision = revision(raw.behavior.content);
  raw.behavior.sourcePath = 'documents/behaviors/later.json';
  const next = captureSceneAnimationUsage(source, raw), current = sceneAnimationUsageSource(next, next.matches[0]);
  assert.equal(old.content, original);
  assert.deepEqual(sceneAnimationUsageSource(catalog, catalog.matches[0]), old);
  assert.equal(current.content, raw.behavior.content); assert.equal(current.sourcePath, raw.behavior.sourcePath);
  assert.notEqual(current.sourceRevision, old.sourceRevision);
  assert.notEqual(current.sourceRange.start, old.sourceRange.start);
  assert.throws(() => sceneAnimationUsageSource(catalog, next.matches[0]), invalid);
  assert.throws(() => sceneAnimationUsageSource(next, catalog.matches[0]), invalid);
});

test('missing behavior or a saved declaration without UUID matches supplies no location', () => {
  const missing = fixture(null), value = sourceBehavior();
  for (const binding of value.bindings) binding.parameters = { ordinary: 'text', amount: 10, enabled: true };
  const empty = fixture(JSON.stringify(value)), match = fixture().catalog.matches[0];
  for (const { catalog } of [missing, empty]) {
    assert.deepEqual(catalog.matches, []);
    assert.throws(() => sceneAnimationUsageSource(catalog, match), invalid);
    assert.throws(() => sceneAnimationUsageSource(catalog, undefined), invalid);
  }
});

test('saved source locations stay separate from an unsaved animation source and its five-field ownership', () => {
  const { raw, source } = fixture(), document = JSON.parse(source.content); document.clips[0].endSeconds = .75;
  const draft = { ...source, content: '\ufeff' + JSON.stringify(document, null, 2).replaceAll('\n', '\r\n') };
  draft.sourceRevision = revision(draft.content);
  const catalog = captureSceneAnimationUsage(draft, raw), sourceView = sceneAnimationUsageSource(catalog, catalog.matches[0]);
  assert.equal(sourceView.content, raw.behavior.content); assert.equal(catalog.savedContent, source.content);
  assert.ok(sceneAnimationUsageMatchSource(catalog, { ...draft }));
  assert.equal(sceneAnimationUsageMatchSource(catalog, source), false);
  for (const key of ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content']) {
    assert.equal(sceneAnimationUsageMatchSource(catalog, { ...draft, [key]: draft[key] + 'changed' }), false, key);
  }
  const before = JSON.stringify(draft); sceneAnimationUsageSource(catalog, catalog.matches[1]);
  assert.equal(JSON.stringify(draft), before);
});

test('usage keeps ordinary UUID matches for schema1 schema2 and schema3 empty clips without upgrading saved text', () => {
  for (const schemaVersion of [1, 2, 3]) {
    const input = raw(), document = animation(); document.schemaVersion = schemaVersion;
    if (schemaVersion === 3) document.clips = []; else delete document.clips;
    input.animation.content = JSON.stringify(document); input.animation.sourceRevision = revision(input.animation.content);
    const catalog = captureSceneAnimationUsage(source(input), input);
    assert.equal(catalog.savedContent, input.animation.content); assert.equal(catalog.matches.length, 2);
    assert.equal(sceneAnimationUsageSource(catalog, catalog.matches[0]).content, input.behavior.content);
  }
});
test('Rust rejects malformed animation curves and clips independently of behavior matches', () => {
  for (const mutate of [a => { a.clips[0].name = ' padded '; }, a => { a.clips[0].endSeconds = 0; },
    a => { a.clips.push(a.clips[0]); }, a => { a.clips[0].extra = true; }, a => { a.tracks = []; }]) {
    const input = raw(), document = animation(); mutate(document); input.animation.content = JSON.stringify(document);
    assert.throws(() => captureSceneAnimationUsageDirectory(input, id(1)), invalid);
    assert.throws(() => captureSceneAnimationUsage({ ...source(), content: input.animation.content }, raw()), invalid);
  }
});

test('missing array primitive and extra descriptor inputs cannot acquire usage identity', () => {
  for (const value of [undefined, null, [], 1, 'source', {}, { ...source(), command: 'execute' }]) {
    assert.throws(() => captureSceneAnimationUsage(value, raw()), invalid);
  }
  for (const value of [undefined, null, [], 1, 'raw', {}, { ...raw(), command: 'execute' }]) {
    assert.throws(() => captureSceneAnimationUsageDirectory(value, id(1)), invalid);
  }
  const input = raw(); input.animation = null; assert.throws(() => captureSceneAnimationUsageDirectory(input, id(1)), invalid);
});
