import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSceneBehaviorProposal, isSceneBehaviorProposal, prepareSceneBehaviorApply } from '../../engine/scene-behaviors-edit.mjs';
import { inspectSceneBehaviors } from '../../engine/scene-behaviors.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';

const id = value => `${String(value).padStart(8, '0')}-1111-4111-8111-111111111111`;
const hash = value => createHash('sha256').update(value).digest('hex');
const declaration = () => ({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1), bindings: [1, 2].map(index => ({
  bindingId: id(index + 10), instanceId: id(index + 20), implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: id(31) },
  parameters: { speed: index * 3.5, enabled: true, text: '你好 / こんにちは', zero: 0 }, events: [{ signal: 'arrived', event: 'checkpoint' }],
})) });
const serialize = value => '\ufeff' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
const original = serialize(declaration()).replace('"speed": 3.5', '"sp\\u0065ed": 35e-1').replace('"zero": 0', '"zero": -0')
  .replace('"你好 / こんにちは"', '"\\u4f60好 \\/ こんにちは"').replace('"schemaVersion": 1', '"schema\\u0056ersion": 1');
const source = (content = original) => ({ sourcePath: 'documents/behaviors/demo.json', token: '2:6:1:4', baseSourceRevision: `sha256:${hash(original)}`,
  sourceRevision: `sha256:${hash(content)}`, content });
const bindings = content => structuredClone(inspectSceneBehaviors(content || original).value.bindings);
const propose = (rows, content = original) => createSceneBehaviorProposal(source(content), { bindings: rows });
const invalid = error => error?.errorCode === 'scene_behavior_authoring_invalid';
const conflict = error => error?.errorCode === 'scene_behavior_authoring_conflict';
const unchanged = error => error?.errorCode === 'scene_behavior_authoring_unchanged';
function raw(content, pointer) { const span = locateJsonSource(parseJsonSource(content), pointer); assert.equal(span?.exact, true); return content.slice(span.start, span.end); }

test('existing behavior edits preserve identities typed values and every unrelated source byte', async () => {
  const rows = bindings(); rows[0].parameters.enabled = false; rows[0].parameters.text = '新文本 😀'; rows[0].events[0].event = 'atCheckpoint';
  const p = propose(rows);
  assert.equal(p.kind, 'scene-behaviors'); assert.equal(isSceneBehaviorProposal(p), true);
  assert.equal(p.afterContent, original.replace('"enabled": true', '"enabled": false').replace('"\\u4f60好 \\/ こんにちは"', '"新文本 😀"').replace('"event": "checkpoint"', '"event": "atCheckpoint"'));
  assert.deepEqual(p.changedPaths, ['/bindings/0/parameters/enabled', '/bindings/0/parameters/text', '/bindings/0/events/0/event']);
  assert.equal(raw(p.afterContent, '/bindings/1'), raw(original, '/bindings/1')); assert.ok(p.afterContent.includes('35e-1')); assert.ok(p.afterContent.includes('"zero": -0'));
  assert.equal(raw(p.afterContent, '/schemaVersion'), '1'); assert.equal(raw(p.afterContent, '/sceneObjectId'), raw(original, '/sceneObjectId'));
  assert.deepEqual(p.bindings.map(row => row.bindingId), rows.map(row => row.bindingId));
  assert.equal((await prepareSceneBehaviorApply(source(), p, { digest: hash })).afterContent, p.afterContent);
});

test('same-shape parameter and signal changes touch leaf tokens and do not normalize key order escapes or unchanged number spelling', () => {
  const rows = bindings(); rows[0].parameters = { zero: 0, text: rows[0].parameters.text, enabled: true, speed: 3.5 }; rows[1].parameters.speed = 15;
  const p = propose(rows); assert.equal(p.afterContent, original.replace('"speed": 7', '"speed": 15'));
  assert.deepEqual(p.changedPaths, ['/bindings/1/parameters/speed']); assert.throws(() => propose(bindings()), unchanged);
  assert.equal(original.startsWith('\ufeff'), true); assert.equal(p.afterContent.endsWith('\r\n'), true);
});

test('parameter and event structural edits replace only their chosen containers and preserve CRLF and tab indentation', () => {
  const rows = bindings(); delete rows[0].parameters.text; rows[0].parameters.amount = 9; rows[0].parameters.toJSON = 'ordinary scalar';
  rows[0].events.push({ signal: 'left', event: 'checkpointLeft' });
  const p = propose(rows), after = inspectSceneBehaviors(p.afterContent).value;
  // The explicitly changed container is serialized; JSON's -0 representation
  // may normalize here, while the leaf-only tests above retain authored bytes.
  assert.deepEqual(after.bindings[0].parameters, JSON.parse(JSON.stringify(rows[0].parameters))); assert.deepEqual(after.bindings[0].events, rows[0].events);
  assert.deepEqual(p.changedPaths, ['/bindings/0/parameters', '/bindings/0/events']);
  for (const pointer of ['/bindings/0/bindingId', '/bindings/0/instanceId', '/bindings/0/implementation', '/bindings/1']) assert.equal(raw(p.afterContent, pointer), raw(original, pointer));
  assert.equal(p.afterContent.replaceAll('\r\n', '').includes('\n'), false);
  assert.ok(p.afterContent.includes('\r\n\t\t\t\t"amount": 9'));
});

test('append insert remove and reorder preserve stable raw bindings and permit multiple behaviors on one instance', () => {
  const rows = bindings(), added = { ...structuredClone(rows[0]), bindingId: id(55), instanceId: rows[0].instanceId };
  const append = propose([...rows, added]); assert.deepEqual(append.changedPaths, ['/bindings']);
  assert.equal(raw(append.afterContent, '/bindings/0'), raw(original, '/bindings/0')); assert.equal(raw(append.afterContent, '/bindings/1'), raw(original, '/bindings/1'));
  assert.equal(append.bindings[2].instanceId, append.bindings[0].instanceId);
  const insert = propose([added, ...rows]); assert.equal(raw(insert.afterContent, '/bindings/1'), raw(original, '/bindings/0')); assert.equal(raw(insert.afterContent, '/bindings/2'), raw(original, '/bindings/1'));
  const remove = propose([rows[1]]); assert.equal(raw(remove.afterContent, '/bindings/0'), raw(original, '/bindings/1'));
  const reorder = propose([rows[1], rows[0]]); assert.equal(raw(reorder.afterContent, '/bindings/0'), raw(original, '/bindings/1')); assert.equal(raw(reorder.afterContent, '/bindings/1'), raw(original, '/bindings/0'));
  for (const result of [append, insert, remove, reorder]) { assert.equal(inspectSceneBehaviors(result.afterContent).ok, true); assert.ok(result.afterContent.startsWith('\ufeff')); assert.ok(result.afterContent.endsWith('\r\n')); }
});

test('structural operations reuse irregular separators and compact single-binding author layout', () => {
  const text = JSON.stringify(declaration()).replace('},{"bindingId"', '} ,\r\n \t {"bindingId"');
  const rows = bindings(text), extra = { ...structuredClone(rows[0]), bindingId: id(70) };
  const appended = propose([...rows, extra], text); assert.ok(appended.afterContent.includes(raw(text, '/bindings/0') + ' ,\r\n \t ' + raw(text, '/bindings/1')));
  const value = declaration(); value.bindings = [value.bindings[0]]; const one = JSON.stringify(value).replace('"bindings":[', '"bindings":[ ');
  const single = bindings(one), result = propose([...single, { ...single[0], bindingId: id(71) }], one);
  assert.equal(inspectSceneBehaviors(result.afterContent).value.bindings.length, 2); assert.ok(result.afterContent.includes('"bindings":[ '));
});

test('instance and source selection are neutral declarations while the original backend and language stay fixed', () => {
  const rows = bindings(); rows[0].instanceId = id(90); rows[0].implementation.sourceObjectId = id(91);
  const p = propose(rows); assert.deepEqual(p.changedPaths, ['/bindings/0/instanceId', '/bindings/0/implementation/sourceObjectId']);
  for (const field of ['backendId', 'language']) {
    const changed = bindings(); for (const row of changed) row.implementation[field] = field === 'backendId' ? 'org.viento.bevy' : 'rust';
    assert.throws(() => propose(changed), invalid);
  }
  const renamed = bindings(); renamed[0].bindingId = id(92); assert.deepEqual(propose(renamed).changedPaths, ['/bindings']);
});

test('typed parameter signal identity and count rules come from the existing behavior contract', () => {
  const mutations = [rows => { rows.length = 0; }, rows => { rows[1].bindingId = rows[0].bindingId; },
    rows => { rows[0].parameters.speed = NaN; }, rows => { rows[0].parameters.speed = Infinity; }, rows => { rows[0].parameters.speed = Number.MAX_SAFE_INTEGER + 1; },
    rows => { rows[0].parameters.speed = {}; }, rows => { rows[0].parameters.speed = null; }, rows => { rows[0].parameters.text = 'a'.repeat(4097); },
    rows => { rows[0].parameters.text = '\ud800'; }, rows => { rows[0].parameters['bad/name'] = true; }, rows => { rows[0].parameters.constructor = 2; },
    rows => { rows[0].parameters = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`p${i}`, i])); },
    rows => { rows[0].events.push({ signal: 'arrived', event: 'other' }); }, rows => { rows[0].events[0].signal = 'not allowed'; },
    rows => { rows[0].events = Array.from({ length: 9 }, (_, i) => ({ signal: `s${i}`, event: `e${i}` })); },
    rows => { rows[0].implementation.language = 'GDScript'; }, rows => { rows[0].extra = 1; }, rows => { rows.push(...Array.from({ length: 31 }, (_, i) => ({ ...rows[0], bindingId: id(100 + i) }))); }];
  for (const mutate of mutations) { const rows = bindings(); mutate(rows); assert.throws(() => propose(rows), invalid); }
  for (const scalar of [false, -4.25, '4.25']) { const rows = bindings(); rows[0].parameters.speed = scalar; assert.equal(propose(rows).bindings[0].parameters.speed, scalar); }
});

test('unknown future malformed duplicate or oversized source remains untouched and cannot gain a proposal', () => {
  for (const text of [original.replace('"schema\\u0056ersion": 1', '"schemaVersion": 2'), original.replace('"format": "viento-scene-behaviors"', '"format": "future-behavior"'),
    original.replace('"bindings": [', '"future":true,"bindings": ['), original.replace('"sceneObjectId":', '"schemaVersion":1,"sceneObjectId":'),
    original.slice(0, -20), ' '.repeat(32768) + original, original.replace('你好', '\ud800') + '\ud800']) {
    assert.throws(() => propose(bindings(), text), invalid);
  }
  const rows = bindings(); rows[0].parameters.text = '中'.repeat(4096); rows[1].parameters.text = '文'.repeat(4096);
  rows[0].parameters.other = '日'.repeat(4096); assert.throws(() => propose(rows), invalid);
});

test('proposal snapshots deeply freeze caller data and reject getters sparse arrays pollution and serializer execution', () => {
  const rows = bindings(); rows[0].parameters.speed = 8; const p = propose(rows); rows[0].parameters.speed = 99;
  assert.equal(p.bindings[0].parameters.speed, 8); assert.equal(Object.isFrozen(p), true); assert.equal(Object.isFrozen(p.bindings[0].events), true);
  let invoked = 0;
  const getter = bindings(); Object.defineProperty(getter[0].parameters, 'speed', { enumerable: true, get() { invoked++; return 8; } });
  const sparse = bindings(); delete sparse[0]; const pollution = bindings(); Object.defineProperty(pollution[0].parameters, '__proto__', { enumerable: true, value: 1 });
  const serializer = bindings(); serializer[0].parameters.toJSON = () => { invoked++; return {}; };
  const symbol = bindings(); symbol[Symbol('bad')] = 1;
  for (const input of [getter, sparse, pollution, serializer, symbol, Object.assign(Object.create({ inherited: 1 }), bindings())]) assert.throws(() => propose(input), invalid);
  const badEdit = Object.defineProperty({}, 'bindings', { enumerable: true, get() { invoked++; return bindings(); } });
  assert.throws(() => createSceneBehaviorProposal(source(), badEdit), invalid);
  const badSource = { ...source() }; Object.defineProperty(badSource, 'content', { enumerable: true, get() { invoked++; return original; } });
  assert.throws(() => createSceneBehaviorProposal(badSource, { bindings: rows }), invalid); assert.equal(invoked, 0);
});

test('source admission checks relative JSON paths tokens Unicode revisions and exact fields', () => {
  const rows = bindings(); rows[0].parameters.speed = 8;
  for (const change of [{ sourcePath: '/tmp/a.json' }, { sourcePath: '../a.json' }, { sourcePath: 'C:a.json' }, { sourcePath: 'a\\b.json' },
    { sourcePath: 'a.txt' }, { sourcePath: 'a//b.json' }, { sourcePath: 'a\0.json' }, { sourcePath: '\ud800.json' },
    { token: '' }, { token: 'a'.repeat(257) }, { token: '\ud800' }, { sourceRevision: 'a'.repeat(64) }, { baseSourceRevision: `sha256:${'A'.repeat(64)}` }, { extra: true }]) {
    assert.throws(() => createSceneBehaviorProposal({ ...source(), ...change }, { bindings: rows }), invalid);
  }
});

test('private brand and current source identity prevent forged stale or cross-session apply', async () => {
  const rows = bindings(); rows[0].parameters.speed = 8; const p = propose(rows), current = source();
  for (const spoof of [structuredClone(p), { ...p }, null, Object.create(p)]) {
    assert.equal(isSceneBehaviorProposal(spoof), false); await assert.rejects(prepareSceneBehaviorApply(current, spoof, { digest: hash }), conflict);
  }
  for (const field of ['sourcePath', 'token', 'content', 'sourceRevision', 'baseSourceRevision']) {
    const changed = { ...current, [field]: field.includes('Revision') ? `sha256:${'f'.repeat(64)}` : field === 'sourcePath' ? 'documents/other.json' : current[field] + ' ' };
    await assert.rejects(prepareSceneBehaviorApply(changed, p, { digest: hash }), conflict);
  }
  for (const digest of [null, () => '', () => 'f'.repeat(64), () => hash(original).toUpperCase()]) await assert.rejects(prepareSceneBehaviorApply(current, p, { digest }), conflict);
});

test('prepare captures source before its async digest and returns a frozen complete candidate', async () => {
  const rows = bindings(); rows[0].parameters.speed = 8; const current = source(), p = propose(rows); let release;
  const pending = prepareSceneBehaviorApply(current, p, { digest: async content => { await new Promise(resolve => { release = resolve; }); return hash(content); } });
  current.content = 'late replacement'; current.token = 'late owner'; release();
  const result = await pending; assert.equal(result.afterContent, p.afterContent); assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.changedPaths), true);
});
