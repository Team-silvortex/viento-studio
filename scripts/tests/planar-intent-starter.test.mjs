import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { listScriptStarters, prepareScriptDraft, prepareScriptDraftApply } from '../../engine/script-authoring.mjs';
import { GODOT_PLANAR_INTENT_SCRIPT as source } from '../../engine/godot-planar-intent-script.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const starter = listScriptStarters().find(item => item.id === 'godot-planar-intent');
const context = { sourceToken: 'planar-intent:1', documentRoot: 'documents', documentTypes: [{ id: 'note', label: '文档' }] };
const request = { starterId: 'godot-planar-intent', documentType: 'note', sourcePath: 'documents/scripts/平面运动.txt' };

test('planar intent is an immutable translated ordinary TXT draft with explicit save and binding ownership', () => {
  assert.ok(starter); assert.equal(starter.content, source); assert.equal(starter.languageId, 'gdscript'); assert.equal(starter.backendId, 'org.viento.godot4');
  assert.ok(Object.isFrozen(starter));
  for (const dictionary of [en, ja]) for (const key of [starter.label, starter.description]) {
    assert.equal(typeof dictionary[key], 'string'); assert.notEqual(dictionary[key], key); assert.ok(dictionary[key].length);
  }
  const proposal = prepareScriptDraft(context, request);
  assert.deepEqual(prepareScriptDraftApply(context, proposal), { ...request, languageId: 'gdscript', backendId: 'org.viento.godot4', content: source });
  assert.throws(() => prepareScriptDraftApply({ ...context, sourceToken: 'stale' }, proposal), { errorCode: 'script_authoring_conflict' });
  for (const key of ['physics', 'relations', 'instanceId', 'bindingId', 'parameters', 'run', 'save']) assert.equal(Object.hasOwn(proposal, key), false);
});

test('four registered input actions feed the separate planar port without changing nodes, input registration or the old gravity port', () => {
  assert.deepEqual(Array.from(source.matchAll(/@export var (\w+): (\w+) = ([^\n]+)/g), row => row.slice(1)), [
    ['left_action', 'String', '"ui_left"'], ['right_action', 'String', '"ui_right"'],
    ['up_action', 'String', '"ui_up"'], ['down_action', 'String', '"ui_down"'],
  ]);
  assert.match(source, /get_meta\("viento_planar_intent"\)/);
  assert.match(source, /Input\.get_vector\(left_action, right_action, up_action, down_action\)/);
  assert.match(source, /_intent\.submit\(direction\.x, direction\.y\)/);
  assert.doesNotMatch(source, /viento_character_intent|get_parent\(|move_and|global_position|velocity|viento_project|publish_event|FileAccess|load\(|InputMap\.add_action|InputMap\.action_add_event/);
});

const native = process.env.VIENTO_GODOT_BIN;
test('real Godot planar starter handles direction normalization, per-binding actions, normal refusal and observable contract loss', {
  skip: native ? false : 'Set VIENTO_GODOT_BIN to verify the planar author starter', timeout: 30000,
}, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-planar-intent-starter-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await Promise.all([
    fs.writeFile(path.join(directory, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Planar intent starter harness"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n'),
    fs.writeFile(path.join(directory, 'starter.gd'), source), fs.writeFile(path.join(directory, 'test.gd'), harness),
  ]);
  const { stdout, stderr } = await promisify(execFile)(native, ['--headless', '--path', directory, '--script', 'res://test.gd'], {
    timeout: 20000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1',
      XDG_DATA_HOME: path.join(directory, 'data'), XDG_CONFIG_HOME: path.join(directory, 'config'), XDG_CACHE_HOME: path.join(directory, 'cache') },
  });
  const log = stdout + stderr, marker = stdout.split('\n').find(line => line.startsWith('PLANAR_INTENT_STARTER_OK:'));
  assert.ok(marker, log); const result = JSON.parse(marker.slice('PLANAR_INTENT_STARTER_OK:'.length));
  assert.equal(result.expectedFailures, 18); assert.ok(result.checked >= 20);
  assert.doesNotMatch(log, /SCRIPT ERROR:|Parse Error|Compile Error|Assertion failed|Leaked|leaked/);
  const errors = log.split('\n').filter(line => line.startsWith('ERROR:'));
  assert.equal(errors.length, result.expectedFailures, log); assert.ok(errors.every(line => line.startsWith('ERROR: Planar intent: ')), log);
  if (process.env.VIENTO_PLANAR_INTENT_STARTER_REPORT_DIR) {
    const output = process.env.VIENTO_PLANAR_INTENT_STARTER_REPORT_DIR; await fs.mkdir(output, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(output, 'starter-native-stdout.log'), stdout), fs.writeFile(path.join(output, 'starter-native-stderr.log'), stderr),
      fs.writeFile(path.join(output, 'starter-generated.gd'), source), fs.writeFile(path.join(output, 'starter-native-harness.gd'), harness),
      fs.writeFile(path.join(output, 'starter-native.json'), JSON.stringify({ ...result, sourceSha256: createHash('sha256').update(source).digest('hex') }, null, 2) + '\n'),
    ]);
  }
});

const harness = String.raw`extends SceneTree
const Starter = preload("res://starter.gd")
var checked := 0
var expected_failures := 0

class Port extends RefCounted:
	var requests: Array = []
	var accepted := true
	var version := 1
	func protocol_version() -> int:
		return version
	func submit(x, y) -> bool:
		requests.append([x, y])
		return accepted

class TypedPort extends Port:
	func submit(x: float, y: float) -> bool:
		return super.submit(x, y)

class WrongArity extends RefCounted:
	func protocol_version() -> int:
		return 1
	func submit(_x) -> bool:
		assert(false)
		return true

class WrongArguments extends RefCounted:
	func protocol_version() -> int:
		return 1
	func submit(_x: String, _y) -> bool:
		assert(false)
		return true

class IntegerArguments extends RefCounted:
	func protocol_version() -> int:
		return 1
	func submit(_x: int, _y: int) -> bool:
		assert(false)
		return true

class WrongReturn extends RefCounted:
	func protocol_version() -> int:
		return 1
	func submit(_x, _y):
		assert(false)
		return 1

class WrongVersion extends RefCounted:
	func protocol_version():
		assert(false)
		return 1.0
	func submit(_x, _y) -> bool:
		return true

class OptionalVersion extends Port:
	func protocol_version(_extra: int = 0) -> int:
		assert(false)
		return 1

class NodePort extends Node:
	func protocol_version() -> int:
		return 1
	func submit(_x, _y) -> bool:
		return true

func _initialize() -> void:
	call_deferred("run_test")

func actor(port, parameters: Dictionary = {}, metadata := true):
	var value = Starter.new()
	if metadata:
		value.set_meta("viento_planar_intent", port)
	for key in parameters:
		value.set(key, parameters[key])
	root.add_child(value)
	return value

func expected_failure(port, parameters: Dictionary = {}, metadata := true) -> void:
	var value = actor(port, parameters, metadata)
	assert(not value.is_physics_processing())
	assert(value.get("_intent") == null)
	value.free()
	expected_failures += 1
	checked += 1

func release_all() -> void:
	for action in ["ui_left", "ui_right", "ui_up", "ui_down", "planar_left", "planar_right", "planar_up", "planar_down"]:
		if InputMap.has_action(action):
			Input.action_release(action)

func run_test() -> void:
	release_all()
	var port = Port.new()
	var instance = actor(port)
	assert(instance.is_physics_processing())
	assert(port.requests.is_empty())
	Input.action_press("ui_right")
	Input.action_press("ui_down")
	instance._physics_process(0.016)
	assert(port.requests.size() == 1)
	assert(abs(port.requests[0][0] - sqrt(0.5)) < 0.00001)
	assert(abs(port.requests[0][1] - sqrt(0.5)) < 0.00001)
	port.accepted = false
	instance._physics_process(0.016)
	assert(instance.is_physics_processing())
	assert(port.requests.size() == 2)
	release_all()
	instance._physics_process(0.016)
	assert(port.requests[-1] == [0.0, 0.0])
	Input.action_press("ui_up")
	instance._physics_process(0.016)
	assert(port.requests[-1] == [0.0, -1.0])
	release_all()
	instance.free()
	checked += 4

	for action in ["planar_left", "planar_right", "planar_up", "planar_down"]:
		InputMap.add_action(action)
	var defaults = Port.new()
	var custom = TypedPort.new()
	var first = actor(defaults)
	var second = actor(custom, {"left_action":"planar_left", "right_action":"planar_right", "up_action":"planar_up", "down_action":"planar_down"})
	Input.action_press("ui_right")
	Input.action_press("planar_up")
	first._physics_process(0.016)
	second._physics_process(0.016)
	assert(defaults.requests == [[1.0, 0.0]])
	assert(custom.requests == [[0.0, -1.0]])
	release_all()
	InputMap.erase_action("planar_down")
	second._physics_process(0.016)
	assert(not second.is_physics_processing())
	assert(custom.requests.size() == 1)
	expected_failures += 1
	first.free()
	second.free()
	for action in ["planar_left", "planar_right", "planar_up"]:
		InputMap.erase_action(action)
	checked += 3

	for parameter in ["left_action", "right_action", "up_action", "down_action"]:
		var parameters := {}
		parameters[parameter] = "missing_action"
		expected_failure(Port.new(), parameters)
	for bad in [null, 1, RefCounted.new(), WrongArity.new(), WrongArguments.new(), IntegerArguments.new(), WrongReturn.new(), WrongVersion.new(), OptionalVersion.new()]:
		expected_failure(bad)
	expected_failure(Port.new(), {}, false)
	var old_port = Port.new()
	old_port.version = 2
	expected_failure(old_port)

	var changing = Port.new()
	var active = actor(changing)
	changing.version = 2
	active._physics_process(0.016)
	assert(not active.is_physics_processing())
	assert(changing.requests.is_empty())
	active.free()
	expected_failures += 1
	checked += 1
	var doomed_port = NodePort.new()
	root.add_child(doomed_port)
	active = actor(doomed_port)
	doomed_port.free()
	active._physics_process(0.016)
	assert(not active.is_physics_processing())
	active.free()
	expected_failures += 1
	checked += 1
	print("PLANAR_INTENT_STARTER_OK:" + JSON.stringify({"checked":checked,"expectedFailures":expected_failures}))
	quit()
`;
