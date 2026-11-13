import test from 'node:test';
import assert from 'node:assert/strict';
import { GODOT_ACTION_SCENE_RETRY_SCRIPT } from '../../engine/godot-scene-retry-script.mjs';
import { GODOT_ACTION_SCENE_SWITCH_SCRIPT, GODOT_EVENT_SCENE_SWITCH_SCRIPT } from '../../engine/godot-scene-navigation-scripts.mjs';
import { hasGodotSceneRetryParameterDeclaration, discoverGodotSceneRetryParameterContract } from '../../engine/godot-scene-retry-parameters.mjs';
import { reviewScriptParameterRows } from '../../engine/script-parameter-interface.mjs';

const parameters = () => [
  { name: 'action_name', type: 'string', defaultValue: 'ui_accept', referenceKind: '' },
  { name: 'target_scene_id', type: 'string', defaultValue: '', referenceKind: '' },
  { name: 'state_values_json', type: 'string', defaultValue: '{"score":0,"health":100}', referenceKind: '' },
];
const forms = () => [GODOT_ACTION_SCENE_RETRY_SCRIPT, '\uFEFF' + GODOT_ACTION_SCENE_RETRY_SCRIPT,
  GODOT_ACTION_SCENE_RETRY_SCRIPT.replaceAll('\n', '\r\n'), '\uFEFF' + GODOT_ACTION_SCENE_RETRY_SCRIPT.replaceAll('\n', '\r\n')];
const form = rows => ({ backendId: 'org.viento.godot4', language: 'gdscript', parameters: rows });

test('exact retry representations expose only the three actual ordinary String defaults', () => {
  assert.ok(GODOT_ACTION_SCENE_RETRY_SCRIPT.includes('@export var action_name: String = "ui_accept"\n'));
  assert.ok(GODOT_ACTION_SCENE_RETRY_SCRIPT.includes('@export var target_scene_id: String = ""\n'));
  assert.ok(GODOT_ACTION_SCENE_RETRY_SCRIPT.includes('@export var state_values_json: String = \'{"score":0,"health":100}\'\n'));
  for (const content of forms()) {
    assert.equal(hasGodotSceneRetryParameterDeclaration(content), true);
    const result = discoverGodotSceneRetryParameterContract(content);
    assert.deepEqual(result, { format: 'viento-script-parameters', schemaVersion: 1, backendId: 'org.viento.godot4', language: 'gdscript', status: 'ready', parameters: parameters() });
    assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.parameters), true);
    assert.equal(result.parameters.every(Object.isFrozen), true);
    for (const key of ['content', 'source', 'script', 'sceneId', 'objectId', 'instanceId', 'referenceKind']) assert.equal(Object.hasOwn(result, key), false, key);
    assert.equal(JSON.stringify(result).includes('extends Node'), false);
    assert.throws(() => { result.parameters[2].defaultValue = '{"health":3}'; }, TypeError);
    assert.equal(discoverGodotSceneRetryParameterContract(content).parameters[2].defaultValue, '{"score":0,"health":100}');
  }
});
test('source edits, partial matches, pretend declarations and unsupported representations remain ordinary manual source', () => {
  const code = GODOT_ACTION_SCENE_RETRY_SCRIPT;
  const nonmatches = [code + '\n', code + '\n# own change\n', code.slice(0, -1), ' ' + code, '\uFEFF\uFEFF' + code,
    code + '\uFEFF', code.replace('\n', '\r\n'), code.replaceAll('\n', '\r'), code.replaceAll('\n', '\r\n').replace('\r\n', '\n'),
    code.replace('"ui_accept"', '"start_retry"'), code.replace('"health":100', '"health":3'),
    code.replace('@export var target_scene_id', '@export var custom_target'), code.replace('extends Node', 'extends Node2D'),
    code.replace('_project.request_retry(target_scene_id, _initial_values)', '_project.request_retry(target_scene_id, {})'),
    '@export var action_name: String = "ui_accept"\n@export var target_scene_id: String = ""\n@export var state_values_json: String = \'{"score":0,"health":100}\'\n',
    '#@viento-retry-parameters {"schemaVersion":2}\n' + code, '# comment\n' + code,
    GODOT_ACTION_SCENE_SWITCH_SCRIPT, GODOT_EVENT_SCENE_SWITCH_SCRIPT, 'pub struct RetryParameters {}'];
  for (const content of nonmatches) {
    assert.equal(hasGodotSceneRetryParameterDeclaration(content), false);
    assert.equal(discoverGodotSceneRetryParameterContract(content), null);
  }
});
test('bounded non-string and malformed text never invokes author coercion or yields a contract', () => {
  let calls = 0;
  const object = { toString() { calls++; return GODOT_ACTION_SCENE_RETRY_SCRIPT; }, get content() { calls++; return GODOT_ACTION_SCENE_RETRY_SCRIPT; } };
  for (const content of [null, undefined, false, 0, 1n, Symbol('retry'), {}, [], object, new String(GODOT_ACTION_SCENE_RETRY_SCRIPT),
    'x'.repeat(65537), GODOT_ACTION_SCENE_RETRY_SCRIPT + '中'.repeat(23000), '\ud800', '\udfff', GODOT_ACTION_SCENE_RETRY_SCRIPT.replace('Node', '\ud800')]) {
    assert.equal(hasGodotSceneRetryParameterDeclaration(content), false); assert.equal(discoverGodotSceneRetryParameterContract(content), null);
  }
  assert.equal(calls, 0);
});
test('the existing row review offers explicit missing defaults without inferring target or initializer semantics', () => {
  const contract = discoverGodotSceneRetryParameterContract(GODOT_ACTION_SCENE_RETRY_SCRIPT), empty = reviewScriptParameterRows(contract, form([]));
  assert.deepEqual(empty.missing, parameters()); assert.equal(empty.canAddMissing, true);
  const rows = [{ name: 'action_name', type: 'string', value: 'start_retry' },
    { name: 'target_scene_id', type: 'string', value: 'manual target' }, { name: 'state_values_json', type: 'string', value: '{"health":3}' },
    { name: 'own_parameter', type: 'string', value: 'keep' }], before = structuredClone(rows);
  const reviewed = reviewScriptParameterRows(contract, form(rows));
  assert.equal(reviewed.canAddMissing, false); assert.deepEqual(reviewed.missing, []); assert.deepEqual(reviewed.invalidValues, []);
  assert.deepEqual(reviewed.unknown, [{ index: 3, name: 'own_parameter' }]); assert.deepEqual(rows, before);
  const mismatched = reviewScriptParameterRows(contract, form([{ name: 'action_name', type: 'number', value: '1e-' }]));
  assert.deepEqual(mismatched.typeMismatches, [{ index: 0, name: 'action_name', expectedType: 'string', actualType: 'number' }]);
  assert.deepEqual(mismatched.missing.map(row => row.name), ['target_scene_id', 'state_values_json']);
});
