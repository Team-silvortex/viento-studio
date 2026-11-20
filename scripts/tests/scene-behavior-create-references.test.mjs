import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSceneBehaviorReferenceDirectory, captureSceneBehaviorReferences, isSceneBehaviorReferences } from '../../engine/scene-behavior-reference-directory.mjs';
import { captureSceneBehaviorCreateReferences, isSceneBehaviorCreateReferences, sceneBehaviorCreateReferencesMatchOrigin, listSceneBehaviorCreateStringParameters, proposeSceneBehaviorCreateReference } from '../../engine/scene-behavior-create-references.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rev = n => 'sha256:' + n.repeat(64);
const scene = () => ({ objectId: id(1), sourcePath: 'documents/scenes/main.json', sourceRevision: rev('1') });
const origin = () => ({ worldId: 'world:' + 'a'.repeat(64), baseRevision: rev('a'), scene: { ...scene(), objectRevision: rev('b') } });
const named = (n, sourcePath, name) => ({ objectId: id(n), sourcePath, name, sourceRevision: rev('2') });
const assembly = () => named(3, 'documents/projects/demo.json', 'Project');
const definition = () => named(2, 'documents/actor.md', 'Actor');
const raw = (selected = true) => ({ format: 'viento-scene-behavior-reference-directory', schemaVersion: 1,
  worldId: origin().worldId, revision: origin().baseRevision, scene: scene(),
  instances: [{ instanceId: id(4), ...definition() }, { instanceId: id(5), ...definition() }], assemblies: [assembly()],
  selectedAssembly: selected ? { ...assembly(), members: [{ ...scene(), name: 'Main' }, named(6, 'documents/scenes/next.json', 'Next')], inputMap: { objectId: id(7), sourcePath: 'documents/input.json', sourceRevision: rev('3') }, actions: [{ name: 'start', keys: ['Enter'] }] } : null });
const catalog = (selected = true) => captureSceneBehaviorCreateReferences(origin(), raw(selected));
const propose = (content = '{"target":""}', extra = {}) => proposeSceneBehaviorCreateReference({ content, catalog: catalog(), origin: origin(), parameter: 'target', kind: 'scene', value: id(6), ...extra });
const invalid = fn => assert.throws(fn, error => error instanceof TypeError);

test('creation reference capture is detached, frozen and binds saved world plus scene without a behavior-source brand', () => {
  const input = raw(), base = origin(), value = captureSceneBehaviorCreateReferences(base, input);
  assert.ok(isSceneBehaviorCreateReferences(value)); assert.ok(sceneBehaviorCreateReferencesMatchOrigin(value, origin())); assert.equal(isSceneBehaviorReferences(value), false);
  input.instances[0].name = 'changed'; base.scene.sourceRevision = rev('f');
  assert.equal(value.instances[0].name, 'Actor'); assert.equal(sceneBehaviorCreateReferencesMatchOrigin(value, base), false);
  assert.equal(value.instances[0].objectId, value.instances[1].objectId); assert.notEqual(value.instances[0].instanceId, value.instances[1].instanceId);
  assert.ok(Object.isFrozen(value.selectedAssembly.actions[0].keys));
});
test('world, scene and origin metadata changes cannot reuse a creation catalog', () => {
  const c = catalog();
  for (const key of ['worldId','baseRevision']) { const o = origin(); o[key] = key === 'worldId' ? 'world:' + 'b'.repeat(64) : rev('e'); assert.equal(sceneBehaviorCreateReferencesMatchOrigin(c, o), false); invalid(() => propose('{}', { catalog: c, origin: o })); }
  for (const key of ['objectId','objectRevision','sourcePath','sourceRevision']) { const o = origin(); o.scene[key] = key === 'objectId' ? id(90) : key === 'sourcePath' ? 'documents/other.json' : rev('e'); assert.equal(sceneBehaviorCreateReferencesMatchOrigin(c, o), false); }
  for (const mutate of [r => r.worldId = 'world:' + 'b'.repeat(64), r => r.revision = rev('e'), r => r.scene.sourcePath = 'documents/other.json', r => r.scene.sourceRevision = rev('e')]) { const r = raw(); mutate(r); invalid(() => captureSceneBehaviorCreateReferences(origin(), r)); }
});
test('only existing scalar String parameters are offered without inferring their names', () => {
  const content = '{"target":"","action_name":"old","enabled":false,"speed":-0,"probe":1e2}';
  const rows = listSceneBehaviorCreateStringParameters(content); assert.deepEqual(rows, [{ name: 'target', value: '' }, { name: 'action_name', value: 'old' }]); assert.ok(Object.isFrozen(rows[0]));
});
test('one selected String token is replaced while BOM, CRLF, Unicode, number spellings and other fields stay exact', () => {
  const before = '\uFEFF{\r\n\t"probe":1e2,"zero":-0,"note":"😀\\r\\n\\u0061",\r\n\t"target" : "old\\u0020value"\r\n}\r\n';
  const result = propose(before), expected = before.replace('"old\\u0020value"', JSON.stringify(id(6)));
  assert.deepEqual(result, { content: expected, changed: true }); assert.ok(Object.isFrozen(result));
  assert.equal(before.includes(id(6)), false);
});
test('same semantic String is an exact no-op, retaining its escaped lexeme', () => {
  const content = '{ "target" : "sta\\u0072t", "x":1e2 }\n';
  assert.deepEqual(propose(content, { kind: 'action', value: 'start' }), { content, changed: false });
});
test('instance choices use stable instance IDs rather than shared definition IDs', () => {
  const c = catalog(false);
  assert.equal(JSON.parse(propose('{"target":""}', { catalog: c, kind: 'instance', value: id(5) }).content).target, id(5));
  invalid(() => propose('{"target":""}', { catalog: c, kind: 'instance', value: id(2) }));
});
test('scenes and actions require an explicit selected assembly; built-in or unrelated values are not catalog entries', () => {
  for (const options of [{ catalog: catalog(false) }, { catalog: catalog(false), kind: 'action', value: 'start' }, { value: id(99) }, { kind: 'action', value: 'ui_accept' }, { kind: 'action', value: 'start\n' }, { kind: 'scene', value: id(6) + '\n' }]) invalid(() => propose(undefined, options));
  assert.equal(JSON.parse(propose(undefined, { kind: 'action', value: 'start' }).content).target, 'start');
  assert.equal(JSON.parse(propose(undefined, { kind: 'scene', value: id(1) }).content).target, id(1), 'directory choices do not infer a retry/navigation policy');
});
test('forged, serialized and old manifest-bound catalogs never become first-creation catalogs', () => {
  const c = catalog(), behavior = JSON.stringify({ format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1), bindings: [{ bindingId: id(8), instanceId: id(4), implementation: { backendId: 'org.example.backend', language: 'custom', sourceObjectId: id(9) }, parameters: {}, events: [] }] });
  const old = captureSceneBehaviorReferences({ sourcePath: 'documents/bindings.json', token: 'saved', baseSourceRevision: rev('4'), sourceRevision: rev('4'), content: behavior }, raw(), scene());
  for (const forged of [raw(), captureSceneBehaviorReferenceDirectory(raw(), id(1)), JSON.parse(JSON.stringify(c)), { ...c }, old]) { assert.equal(isSceneBehaviorCreateReferences(forged), false); invalid(() => propose(undefined, { catalog: forged })); }
});
test('malformed or unfinished JSON and non-String targets are left for manual correction', () => {
  for (const content of ['', '{"target":1e-}', '{"target":"a","target":"b"}', '{"target":false}', '{"target":0}', '{"target":[]}', '{"target":{}}', '[]', 'null', '{"other":""}', '{"__proto__":""}', '{"target":"\\ud800"}']) invalid(() => propose(content));
  invalid(() => propose(undefined, { parameter: 'missing' })); invalid(() => propose(undefined, { kind: 'run', value: 'start' }));
});
test('strict data capture never invokes origin, directory or proposal getters and serializers', () => {
  let reads = 0;
  const o = origin(); Object.defineProperty(o.scene, 'objectId', { enumerable: true, get() { reads++; return id(1); } }); invalid(() => captureSceneBehaviorCreateReferences(o, raw()));
  const r = raw(); Object.defineProperty(r.instances[0], 'name', { enumerable: true, get() { reads++; return 'Actor'; } }); invalid(() => captureSceneBehaviorCreateReferences(origin(), r));
  const values = { content: '{}', catalog: catalog(), origin: origin(), parameter: 'target', kind: 'scene', value: id(6) }; Object.defineProperty(values, 'content', { enumerable: true, get() { reads++; return '{}'; } }); invalid(() => proposeSceneBehaviorCreateReference(values));
  const serial = origin(); serial.toJSON = () => { reads++; return {}; }; invalid(() => captureSceneBehaviorCreateReferences(serial, raw())); assert.equal(reads, 0);
});
test('inherited, extra or newline-terminated origin facts are rejected', () => {
  for (const mutate of [o => Object.setPrototypeOf(o, { inherited: true }), o => o.scene.objectId += '\n', o => o.baseRevision += '\n', o => o.scene.sourceRevision += '\n', o => o.worldId += '\n', o => o.scene.extra = true]) { const o = origin(); mutate(o); invalid(() => captureSceneBehaviorCreateReferences(o, raw())); }
});
test('oversized parameter fragments are refused before parsing their JSON', () => {
  const source = '{"target":""}' + ' '.repeat(32769), original = JSON.parse; let large = 0;
  JSON.parse = function(value, ...args) { if (value === source || typeof value === 'string' && value.length > 32768) large++; return original(value, ...args); };
  try { invalid(() => propose(source)); } finally { JSON.parse = original; }
  assert.equal(large, 0);
});
