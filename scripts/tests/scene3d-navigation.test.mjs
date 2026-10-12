import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DObjectIndex, queryScene3DObjects, createScene3DSourceLocation, isScene3DSourceLocation, scene3DSourceDisplaySelection } from '../../engine/scene3d-navigation.mjs';
import { isScene3DPropertiesProposal } from '../../engine/scene3d-properties.mjs';

const sample = JSON.parse(await fs.readFile(new URL('../../examples/scene3d/scene.json', import.meta.url), 'utf8'));
const model = () => structuredClone(sample);
const raw = value => '\ufeff' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t';
const snapshot = content => ({ sourcePath: 'documents/scenes/箱.json', token: '3:7:1', content });
const invalid = { errorCode: 'scene3d_navigation_invalid' };
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;

test('display index detaches frozen presentation rows in native source order without exposing geometry or authoring authority', () => {
  const parsed = structuredClone(parseScene3DSource(raw(model()))), index = createScene3DObjectIndex(parsed);
  assert.deepEqual(Object.keys(index), ['objects']); assert.equal(Object.isFrozen(index), true);
  assert.deepEqual(index.objects.map(row => row.instanceId), parsed.model.objects.map(object => object.instanceId));
  for (const row of index.objects) {
    assert.deepEqual(Object.keys(row), ['instanceId', 'name', 'primitive', 'propertyPath', 'sourceRange']);
    assert.equal(Object.isFrozen(row), true); assert.equal(Object.isFrozen(row.sourceRange), true);
    assert.equal(Object.hasOwn(row, 'position'), false); assert.equal(Object.hasOwn(row, 'applyDraft'), false);
  }
  const before = index.objects[0].name; parsed.model.objects[0].name = 'changed'; parsed.sourceLocations.objects[0].sourceRange.start = 0;
  assert.equal(index.objects[0].name, before); assert.notEqual(index.objects[0].sourceRange.start, 0);
});

test('literal name and UUID substring queries are case insensitive without modifying authored whitespace Unicode or query input', () => {
  const value = model(); value.objects[0].name = '  箱🦊\r\nBlue [box]  '; value.objects[1].name = 'BLUE second';
  const index = createScene3DObjectIndex(parseScene3DSource(raw(value)));
  assert.equal(queryScene3DObjects(index, '  bLuE  ').length, 2);
  assert.equal(queryScene3DObjects(index, '箱🦊')[0].name, value.objects[0].name);
  assert.deepEqual(queryScene3DObjects(index, '[').map(row => row.instanceId), [value.objects[0].instanceId]);
  assert.deepEqual(queryScene3DObjects(index, value.objects[1].instanceId.toUpperCase()).map(row => row.instanceId), [value.objects[1].instanceId]);
  assert.equal(Object.isFrozen(queryScene3DObjects(index, '')), true);
  assert.equal(queryScene3DObjects(index, ' \r\n\t ').length, value.objects.length);
  assert.deepEqual(queryScene3DObjects(index, 'unknown'), []);
});

test('filtering does not normalize names or change the index order for 128 stable identities', () => {
  const value = model(), box = value.objects[0]; value.objects = Array.from({ length: 128 }, (_, n) => ({ ...box, instanceId: id(n), name: n % 2 ? 'Café' : 'Cafe\u0301' }));
  const index = createScene3DObjectIndex(parseScene3DSource(raw(value)));
  assert.equal(queryScene3DObjects(index).length, 128);
  assert.deepEqual(queryScene3DObjects(index, 'CAFÉ').map(row => row.instanceId), value.objects.filter((_, n) => n % 2).map(row => row.instanceId));
  assert.equal(queryScene3DObjects(index, 'Cafe\u0301').length, 64);
});

test('index clones cannot impersonate a display session and query accepts only literal strings', () => {
  const index = createScene3DObjectIndex(parseScene3DSource(raw(model()))); let calls = 0;
  for (const fake of [{ ...index }, structuredClone(index), null, { objects: [] }]) assert.throws(() => queryScene3DObjects(fake), invalid);
  for (const query of [null, 7, new String('box'), { toString() { calls++; return 'box'; } }]) assert.throws(() => queryScene3DObjects(index, query), invalid);
  assert.equal(calls, 0);
});

test('native source navigation resolves stable identity after reorder rather than accepting a stale array index', () => {
  const value = model(), target = value.objects[0].instanceId; value.objects.reverse();
  const source = raw(value).replace('"objects"', '"objec\\u0074s"').replaceAll('"instanceId"', '"ins\\u0074anceId"');
  const location = createScene3DSourceLocation(snapshot(source), target), index = value.objects.findIndex(object => object.instanceId === target);
  assert.equal(location.propertyPath, `/objects/${index}`);
  assert.equal(location.sourceRange.encoding, 'utf-16'); assert.equal(location.sourceRange.exact, true);
  assert.deepEqual(JSON.parse(source.slice(location.sourceRange.start, location.sourceRange.end)), value.objects[index]);
  assert.equal(location.content, source); assert.equal(isScene3DSourceLocation(location), true); assert.equal(isScene3DPropertiesProposal(location), false);
  assert.equal(Object.isFrozen(location), true); assert.equal(Object.isFrozen(location.sourceRange), true);
});

test('navigation captures source before returning and rejects forged or cloned source-location receipts', () => {
  const input = snapshot(raw(model())), location = createScene3DSourceLocation(input, model().objects[0].instanceId);
  input.content = '{}'; input.token = 'new'; assert.notEqual(location.content, input.content); assert.equal(location.token, '3:7:1');
  for (const fake of [{ ...location }, structuredClone(location), JSON.parse(JSON.stringify(location)), null]) assert.equal(isScene3DSourceLocation(fake), false);
});

test('navigation admission rejects extra ranges authorship revisions getters paths and wrong identities without caller execution', () => {
  const source = snapshot(raw(model())), target = model().objects[0].instanceId; let reads = 0;
  const getter = { ...source }; Object.defineProperty(getter, 'content', { enumerable: true, get() { reads++; throw Error('caller'); } });
  for (const input of [getter, { ...source, sourceRange: { start: 0, end: 1 } }, { ...source, sourceRevision: 'sha256:fake' }, [], null,
    { ...source, token: '' }, { ...source, token: 't'.repeat(257) }, { ...source, sourcePath: '/scene.json' }, { ...source, sourcePath: '../scene.json' },
    { ...source, sourcePath: 'a//scene.json' }, { ...source, sourcePath: 'a/./scene.json' }, { ...source, sourcePath: 'a\\scene.json' }, { ...source, sourcePath: 'a\0.json' }, { ...source, sourcePath: 'a.md' }]) {
    assert.throws(() => createScene3DSourceLocation(input, target), invalid);
  }
  for (const identity of ['missing', 0, {}, target.toUpperCase().replace(/^./, 'Z')]) assert.throws(() => createScene3DSourceLocation(source, identity), invalid);
  assert.equal(reads, 0);
});

test('native parser remains the only admission path for malformed and over-budget author source', () => {
  const source = raw(model()), target = model().objects[0].instanceId;
  for (const content of ['{}', source.replace('"schemaVersion": 1', '"schemaVersion": 1,"schemaVersion":1'), source + '\ud800']) {
    assert.throws(() => createScene3DSourceLocation(snapshot(content), target), { errorCode: 'scene3d_invalid' });
  }
  assert.throws(() => createScene3DSourceLocation(snapshot(source + ' '.repeat(128 * 1024)), target), { errorCode: 'scene3d_limit' });
});

test('private native ranges map BOM CRLF CR astral and escaped keys to exact textarea display without changing raw bytes', () => {
  for (const newline of ['\r\n', '\r', '\n']) {
    const value = model(); value.name = '🦊\r\nScene';
    const content = ('\ufeff' + JSON.stringify(value, null, '\t') + '\n \t').replaceAll('\n', newline).replace('"objects"', '"objec\\u0074s"');
    const location = createScene3DSourceLocation(snapshot(content), value.objects[1].instanceId), displayed = content.replace(/\r\n|\r/g, '\n');
    const selection = scene3DSourceDisplaySelection(location, displayed);
    assert.deepEqual(JSON.parse(displayed.slice(selection.start, selection.end)), value.objects[1]);
    assert.equal(Object.isFrozen(selection), true); assert.equal(location.content, content);
    assert.throws(() => scene3DSourceDisplaySelection(location, displayed + ' '), invalid);
    assert.throws(() => scene3DSourceDisplaySelection({ ...location }, displayed), invalid);
  }
});

test('portable navigation layer has no host imports source serializer renderer or mutable source capability', async () => {
  const source = await fs.readFile(new URL('../../engine/scene3d-navigation.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /node:|\bfetch\s*\(|\bprocess\b|\bdocument\b|JSON\.parse|JSON\.stringify|applyDraft|saveEdit|WebGL/);
  const exports = await import('../../engine/index.mjs'); assert.equal(exports.createScene3DSourceLocation, createScene3DSourceLocation);
});
