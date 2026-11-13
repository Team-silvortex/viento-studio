import test from 'node:test';
import assert from 'node:assert/strict';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT as retry } from '../../engine/godot-scene-retry-script.mjs';
import { GODOT_ACTION_SCENE_SWITCH_SCRIPT as navigation } from '../../engine/godot-scene-navigation-scripts.mjs';
import { PROJECT_SCENE_RETRY_LIMITS, DEFAULT_PROJECT_SCENE_RETRY_STATE_VALUES, parseProjectSceneRetryStateValues as parse,
  inspectProjectSceneRetryReferences as inspect } from '../../engine/project-scene-retry-diagnostics.mjs';
import { runtimeProject, runtimeId } from './helpers/project-runtime-fixture.mjs';

const invalidValues = (value, reason) => assert.throws(() => parse(value), error => error instanceof TypeError
  && error.errorCode === 'build_scene_retry_values_invalid' && error.reason === reason);
const invalidInspection = run => assert.throws(run, error => error instanceof TypeError && error.errorCode === 'build_scene_retry_invalid');
function fixture(code = retry) {
  const plan = runtimeProject({ behavior: true }), behavior = plan.scenes[0].behaviors;
  behavior.sources[0].content = code; behavior.bindings[0].events = [];
  behavior.bindings[0].parameters = { target_scene_id: plan.scenes[1].scene.objectId };
  const document = { record: { id: behavior.manifest.objectId, sourcePath: behavior.manifest.sourcePath },
    sourcePath: behavior.manifest.sourcePath, sourceRevision: behavior.manifest.sourceRevision, content: '' };
  const write = () => { document.content = '\ufeff' + JSON.stringify({ bindings: behavior.bindings }, null, '\t').replaceAll('\n', '\r\n') + '\r\n'; };
  write(); return { scenes: plan.scenes, behavior, binding: behavior.bindings[0], document, write };
}

test('retry initializers are bounded explicit scalars, sorted immutable copies and normalize negative zero', () => {
  assert.deepEqual(PROJECT_SCENE_RETRY_LIMITS, { keys: 16, bytes: 4096 });
  assert.equal(DEFAULT_PROJECT_SCENE_RETRY_STATE_VALUES, '{"score":0,"health":100}');
  assert.deepEqual(parse(DEFAULT_PROJECT_SCENE_RETRY_STATE_VALUES), { health: 100, score: 0 });
  assert.deepEqual(parse('{}'), {});
  const text = '{"z":-0,"a":false,"note":"雨の鍵 / 风之钥匙 😀\\n","empty":"","minimum":-1000000000,"maximum":1e9}';
  const values = parse(text);
  assert.deepEqual(Object.keys(values), ['a', 'empty', 'maximum', 'minimum', 'note', 'z']);
  assert.equal(Object.is(values.z, -0), false); assert.equal(values.a, false); assert.equal(values.empty, '');
  assert.equal(values.note, '雨の鍵 / 风之钥匙 😀\n'); assert.equal(Object.isFrozen(values), true);
  assert.throws(() => { values.a = true; }, TypeError); assert.notEqual(values, parse(text));
  assert.equal(Object.keys(parse(JSON.stringify(Object.fromEntries(Array.from({ length: 16 }, (_, index) => ['key' + index, index]))))).length, 16);
  invalidValues(JSON.stringify(Object.fromEntries(Array.from({ length: 17 }, (_, index) => ['key' + index, index]))), 'keys');
});

test('retry JSON admits exactly 4096 UTF-8 bytes and rejects oversized or invalid scalar text', () => {
  const ascii = JSON.stringify({ a: 'x'.repeat(4088) }), unicode = JSON.stringify({ a: '界'.repeat(1362) + 'ab' });
  assert.equal(new TextEncoder().encode(ascii).length, 4096); assert.equal(new TextEncoder().encode(unicode).length, 4096);
  assert.equal(parse(ascii).a.length, 4088); assert.equal(parse(unicode).a.length, 1364);
  invalidValues(ascii + ' ', 'text'); invalidValues(unicode + ' ', 'text'); invalidValues('\ud800', 'text');
  for (const value of [null, false, 0, {}, []]) invalidValues(value, 'type');
});

test('retry JSON rejects decoded duplicate keys, BOM, malformed shapes and unsupported values', () => {
  for (const value of ['', ' ', '{', '{"a":1,}', '{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '\ufeff{}', '{} trailing', '{"a":NaN}']) invalidValues(value, 'json');
  for (const value of ['null', 'false', '1', '"text"', '[]', '[{}]']) invalidValues(value, 'object');
  for (const value of ['{"a":null}', '{"a":{}}', '{"a":[]}', '{"a":1e309}', '{"a":1000000001}', '{"a":-1000000001}', '{"a":"\\ud800"}', '{"a":"\\udfff"}']) invalidValues(value, 'value');
  for (const key of ['', '1key', 'constructor', 'prototype', '__proto__', 'key\n', '界', 'a'.repeat(65)]) invalidValues(JSON.stringify({ [key]: 1 }), 'key');
  assert.equal(parse('{"\\u0061":true}').a, true); assert.equal(parse('{"a":"\\ud83d\\ude00"}').a, '😀');
});

test('only exact retry source admits other members and default initializer without altering authors', () => {
  const f = fixture(), before = structuredClone(f.scenes);
  assert.deepEqual(inspect(f.scenes, [f.document]), []); assert.deepEqual(f.scenes, before);
  f.binding.parameters.state_values_json = '{}'; f.binding.parameters.action_name = 'menu_retry';
  assert.deepEqual(inspect(f.scenes, [f.document]), []);
});

test('retry target failures locate the actual behavior parameter with frozen UTF-16 ranges', () => {
  for (const [target, reason] of [['', 'required'], [false, 'uuid'], [runtimeId(10).toUpperCase(), 'uuid'], [runtimeId(90), 'member'], ['current', 'current']]) {
    const f = fixture(); f.binding.parameters.target_scene_id = target === 'current' ? f.scenes[0].scene.objectId : target; f.write();
    const [row] = inspect(f.scenes, [f.document]); assert.equal(row.code, 'build_scene_retry_target_invalid'); assert.equal(row.reason, reason);
    assert.equal(row.objectId, f.document.record.id); assert.equal(row.sourceRevision, f.document.sourceRevision);
    assert.equal(row.sceneId, f.scenes[0].scene.objectId); assert.equal(row.bindingId, f.binding.bindingId); assert.equal(row.instanceId, f.binding.instanceId);
    assert.equal(row.propertyPath, '/bindings/0/parameters/target_scene_id'); assert.equal(row.sourceRange.exact, true);
    assert.equal(f.document.content.slice(row.sourceRange.start, row.sourceRange.end), JSON.stringify(f.binding.parameters.target_scene_id));
    assert.equal(Object.isFrozen(row.sourceRange), true);
  }
  const f = fixture(); delete f.binding.parameters.target_scene_id; f.write();
  const rows = inspect(f.scenes, [f.document]); assert.equal(rows[0].reason, 'required');
  assert.equal(rows[0].sourceRange.propertyPath, '/bindings/0/parameters'); assert.equal(rows[0].sourceRange.exact, false);
});

test('retry action and JSON errors are blocking parameter diagnostics with exact author ranges', () => {
  for (const [parameter, value, code, reason] of [
    ['action_name', '', 'build_scene_retry_parameter_invalid', 'action'],
    ['action_name', false, 'build_scene_retry_parameter_invalid', 'action'],
    ['action_name', '\ud800', 'build_scene_retry_parameter_invalid', 'action'],
    ['state_values_json', false, 'build_scene_retry_values_invalid', 'type'],
    ['state_values_json', '{"score":0,"\\u0073core":2}', 'build_scene_retry_values_invalid', 'json'],
    ['state_values_json', '\ufeff{}', 'build_scene_retry_values_invalid', 'json'],
    ['state_values_json', '{"score":1e309}', 'build_scene_retry_values_invalid', 'value'],
    ['state_values_json', JSON.stringify({ a: '界'.repeat(1363) }), 'build_scene_retry_values_invalid', 'text'],
  ]) {
    const f = fixture(); f.binding.parameters[parameter] = value; f.write();
    const [row] = inspect(f.scenes, [f.document]); assert.equal(row.code, code); assert.equal(row.reason, reason);
    assert.equal(row.parameter, parameter); assert.equal(row.propertyPath, '/bindings/0/parameters/' + parameter);
    assert.equal(row.sourceRange.exact, true); assert.equal(f.document.content.slice(row.sourceRange.start, row.sourceRange.end), JSON.stringify(value));
  }
});

test('edited retry sources, old navigation, other languages and duplicate source identities are never inferred', () => {
  for (const code of [retry + '\n', '\ufeff' + retry, retry.replaceAll('\n', '\r\n'), navigation]) {
    const f = fixture(code); f.binding.parameters = { target_scene_id: '', action_name: false, state_values_json: '{' };
    assert.deepEqual(inspect(f.scenes, [f.document]), []);
  }
  for (const field of ['backendId', 'language']) {
    const f = fixture(); f.behavior[field] = 'custom'; f.binding.parameters.target_scene_id = '';
    assert.deepEqual(inspect(f.scenes, []), []);
  }
  const f = fixture(); f.behavior.sources.push(structuredClone(f.behavior.sources[0])); f.binding.parameters.target_scene_id = '';
  assert.deepEqual(inspect(f.scenes, []), []);
});

test('retry source locations are omitted for stale or ambiguous author identity', () => {
  for (const change of [doc => { doc.sourceRevision = 'sha256:' + '0'.repeat(64); }, doc => { doc.sourcePath = 'elsewhere.json'; }, doc => { doc.record.sourcePath = 'elsewhere.json'; }]) {
    const f = fixture(); f.binding.parameters.state_values_json = '{'; f.write(); change(f.document);
    const [row] = inspect(f.scenes, [f.document]); assert.equal(row.reason, 'json'); assert.equal(Object.hasOwn(row, 'sourceRange'), false);
  }
  const f = fixture(); f.binding.parameters.state_values_json = '{'; f.write();
  assert.equal(Object.hasOwn(inspect(f.scenes, [f.document, structuredClone(f.document)])[0], 'sourceRange'), false);
});

test('bounded retry inspection rejects accessors, sparse lists and hidden fields without invoking callers', () => {
  let calls = 0;
  for (const parameter of ['target_scene_id', 'action_name', 'state_values_json']) {
    const f = fixture(); Object.defineProperty(f.binding.parameters, parameter, { enumerable: true, get() { calls++; return '{}'; } });
    invalidInspection(() => inspect(f.scenes, []));
  }
  assert.equal(calls, 0);
  const f = fixture(); Object.defineProperty(f.binding.parameters, 'state_values_json', { enumerable: false, value: '{}' });
  invalidInspection(() => inspect(f.scenes, [])); invalidInspection(() => inspect(Array(1), []));
  invalidInspection(() => inspect(Array(33).fill({}), []));
  const extra = []; extra.extra = true; invalidInspection(() => inspect([], extra));
  const bindings = fixture(); bindings.behavior.bindings = Array(33).fill(bindings.binding); invalidInspection(() => inspect(bindings.scenes, []));
  const sources = fixture(); sources.behavior.sources = Array(9).fill(sources.behavior.sources[0]); invalidInspection(() => inspect(sources.scenes, []));
});

test('retry diagnostic truncation preserves order and exact omission counts', () => {
  for (const count of [256, 288, 320]) {
    const f = fixture(); f.binding.parameters.target_scene_id = '';
    const scenes = Array.from({ length: Math.ceil(count / 32) }, (_, sceneIndex) => {
      const scene = structuredClone(f.scenes[0]); scene.scene.objectId = runtimeId(100 + sceneIndex);
      scene.behaviors.bindings = Array.from({ length: Math.min(32, count - sceneIndex * 32) }, (_, index) => ({ ...structuredClone(f.binding), bindingId: runtimeId(1000 + sceneIndex * 32 + index) }));
      return scene;
    });
    const rows = inspect(scenes, []); assert.equal(rows.length, 256); assert.equal(Object.isFrozen(rows), true);
    assert.equal(rows[0].bindingId, runtimeId(1000)); assert.equal(rows[254].bindingId, runtimeId(1254));
    assert.equal(rows[255].code, count === 256 ? 'build_scene_retry_target_invalid' : 'build_scene_retry_limit');
    if (count > 256) assert.equal(rows[255].omittedCount, count - 255);
  }
});


test('malformed retry provenance rejects object values without freezing or invoking their accessors', () => {
  let calls = 0;
  const poisoned = () => ({ get unexpected() { calls++; return 'called'; } });
  for (const field of ['objectId', 'sourcePath', 'sourceRevision']) {
    const f = fixture(); f.binding.parameters.target_scene_id = ''; f.behavior.manifest[field] = poisoned();
    invalidInspection(() => inspect(f.scenes, []));
  }
  for (const field of ['bindingId', 'instanceId']) {
    const f = fixture(); f.binding.parameters.target_scene_id = ''; f.binding[field] = poisoned();
    invalidInspection(() => inspect(f.scenes, []));
  }
  const f = fixture(); f.binding.parameters.target_scene_id = ''; f.scenes[0].scene.objectId = poisoned();
  invalidInspection(() => inspect(f.scenes, [])); assert.equal(calls, 0);
});
