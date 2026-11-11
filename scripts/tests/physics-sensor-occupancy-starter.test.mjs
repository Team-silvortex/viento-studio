import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { listScriptStarters, prepareScriptDraft, prepareScriptDraftApply } from '../../engine/script-authoring.mjs';
import { GODOT_PHYSICS_SENSOR_OCCUPANCY_SCRIPT as source } from '../../engine/godot-physics-sensor-occupancy-script.mjs';

const starter = listScriptStarters().find(row => row.id === 'godot-physics-sensor-occupancy');
const context = { sourceToken: 'sensor-occupancy:1', documentRoot: 'documents', documentTypes: [{ id: 'note', label: '档案' }] };
const request = { starterId: 'godot-physics-sensor-occupancy', documentType: 'note', sourcePath: 'documents/scripts/触发区占用.txt' };
const hash = value => createHash('sha256').update(value).digest('hex');

test('sensor occupancy remains an immutable ordinary TXT draft with the existing review/context boundary', () => {
  assert.ok(starter); assert.equal(starter.content, source); assert.ok(Object.isFrozen(starter));
  const proposal = prepareScriptDraft(context, request);
  assert.deepEqual(prepareScriptDraftApply(context, proposal), { ...request, languageId: 'gdscript', backendId: 'org.viento.godot4', content: source });
  assert.throws(() => prepareScriptDraftApply({ ...context, sourceToken: 'stale' }, proposal), { errorCode: 'script_authoring_conflict' });
  for (const key of ['physics', 'relations', 'instanceId', 'bindingId', 'parameters', 'run', 'save']) assert.equal(Object.hasOwn(proposal, key), false);
  assert.deepEqual(Array.from(source.matchAll(/@export var (\w+): (\w+) = ([^\n]+)/g), row => row.slice(1)), [
    ['occupied_event', 'String', '"physics.occupied"'], ['vacant_event', 'String', '"physics.vacant"'],
  ]);
  assert.doesNotMatch(source, /physics_bodies|physics_observation|project_host|scene\.actors|FileAccess|Input\.|move_and|load\(/);
});

const native = process.env.VIENTO_GODOT_BIN;
test('real Godot verifies native occupancy sets, port contracts, initial overlap, pause and cleanup', {
  skip: native ? false : 'Set VIENTO_GODOT_BIN to verify the sensor occupancy starter in Godot', timeout: 30000,
}, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-sensor-occupancy-starter-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await Promise.all([
    fs.writeFile(path.join(directory, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Sensor occupancy author harness"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n'),
    fs.writeFile(path.join(directory, 'starter.gd'), source), fs.writeFile(path.join(directory, 'test.gd'), harness),
  ]);
  const { stdout, stderr } = await promisify(execFile)(native, ['--headless', '--path', directory, '--script', 'res://test.gd'], {
    timeout: 20000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GODOT_SILENCE_ROOT_WARNING: '1',
      XDG_DATA_HOME: path.join(directory, 'data'), XDG_CACHE_HOME: path.join(directory, 'cache'), XDG_CONFIG_HOME: path.join(directory, 'config') },
  });
  const log = stdout + stderr, marker = stdout.split('\n').find(line => line.startsWith('SENSOR_OCCUPANCY_STARTER_OK:'));
  assert.ok(marker, log);
  const result = JSON.parse(marker.slice('SENSOR_OCCUPANCY_STARTER_OK:'.length));
  assert.ok(result.checked >= 25); assert.ok(result.expectedFailures >= 12);
  assert.doesNotMatch(log, /SCRIPT ERROR:|Parse Error|Compile Error|Assertion failed|Leaked|leaked/);
  const errors = log.split('\n').filter(line => line.startsWith('ERROR:'));
  assert.equal(errors.length, result.expectedFailures, log);
  assert.ok(errors.every(line => line.startsWith('ERROR: Sensor occupancy: ')), log);
  if (process.env.VIENTO_SENSOR_OCCUPANCY_STARTER_REPORT_DIR) {
    const output = process.env.VIENTO_SENSOR_OCCUPANCY_STARTER_REPORT_DIR; await fs.mkdir(output, { recursive: true });
    await Promise.all([fs.writeFile(path.join(output, 'starter-native-stdout.log'), stdout), fs.writeFile(path.join(output, 'starter-native-stderr.log'), stderr),
      fs.writeFile(path.join(output, 'starter-generated.gd'), source), fs.writeFile(path.join(output, 'starter-native-harness.gd'), harness),
      fs.writeFile(path.join(output, 'starter-native.json'), JSON.stringify({ ...result, sourceSha256: hash(source) }, null, 2) + '\n')]);
  }
});

const harness = String.raw`extends SceneTree
const Starter = preload("res://starter.gd")
const ID := "11111111-1111-4111-8111-111111111111"
const OTHER := "22222222-2222-4222-8222-222222222222"
var checked := 0
var expected_failures := 0

class Project extends RefCounted:
	var publications: Array = []
	var accepted := true
	func publish_event(name, value) -> bool:
		publications.append([name, value])
		return accepted

class TypedProject extends Project:
	func publish_event(name: String, value: String) -> bool:
		return super.publish_event(name, value)

class WrongArgument extends RefCounted:
	func publish_event(_name: int, _value) -> bool:
		assert(false)
		return true

class WrongPayload extends RefCounted:
	func publish_event(_name, _value: bool) -> bool:
		assert(false)
		return true

class OptionalArgument extends RefCounted:
	func publish_event(_name, _value = null) -> bool:
		assert(false)
		return true

class WrongArity extends RefCounted:
	func publish_event(_name) -> bool:
		assert(false)
		return true

class WrongReturn extends RefCounted:
	func publish_event(_name, _value):
		assert(false)
		return 1

func make_area() -> Area2D:
	var area := Area2D.new()
	root.add_child(area)
	return area

func body(identity = OTHER):
	var value := CharacterBody2D.new()
	if identity != null:
		value.set_meta("viento_instance_id", identity)
	root.add_child(value)
	return value

func actor(project, parameters: Dictionary = {}, area = null, identity = ID):
	if area == null:
		area = make_area()
	var instance = Starter.new()
	instance.set_meta("viento_project", project)
	if identity != null:
		instance.set_meta("viento_instance_id", identity)
	for key in parameters:
		instance.set(key, parameters[key])
	area.add_child(instance)
	return instance

func reject(project, parameters: Dictionary = {}, identity = ID, area = null) -> void:
	var instance = actor(project, parameters, area, identity)
	assert(not instance._opened and instance._project == null and instance._area == null)
	assert(instance._occupants.is_empty() and not instance.is_physics_processing())
	instance.get_parent().free()
	checked += 1
	expected_failures += 1

func settle() -> void:
	# physics_frame is emitted before node physics callbacks; the following
	# process_frame lets pending occupancy flushes run, including after resume.
	await physics_frame
	await process_frame

func _initialize() -> void:
	call_deferred("run_test")

func run_test() -> void:
	for project in [null, false, 1, "port", RefCounted.new(), WrongArgument.new(), WrongPayload.new(), OptionalArgument.new(), WrongArity.new(), WrongReturn.new()]:
		reject(project)
	for identity in [null, "", "bad", 7, "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"]:
		reject(Project.new(), {}, identity)
	reject(Project.new(), {"occupied_event": "same", "vacant_event": "same"})
	var wrong_parent := Node2D.new()
	root.add_child(wrong_parent)
	reject(Project.new(), {}, ID, wrong_parent)

	var project = Project.new()
	var instance = actor(project)
	var area = instance.get_parent()
	await settle()
	assert(project.publications.is_empty() and not instance.is_physics_processing())
	var first = body()
	var second = body() # Same UUID still means two actual native occupants.
	area.emit_signal("body_entered", first)
	area.emit_signal("body_entered", first)
	area.emit_signal("body_entered", second)
	assert(project.publications.is_empty()) # Publication waits for the batch.
	await settle()
	assert(project.publications == [["physics.occupied", ID]])
	assert(instance._occupants.size() == 2)
	area.emit_signal("body_exited", first)
	area.emit_signal("body_exited", first)
	await settle()
	assert(project.publications.size() == 1 and instance._occupants.size() == 1)
	assert(not first.is_connected("tree_exiting", instance._body_leaving.bind(first.get_instance_id())))
	first.free()
	second.free()
	await settle()
	assert(project.publications == [["physics.occupied", ID], ["physics.vacant", ID]])
	assert(instance._occupants.is_empty() and not instance.is_physics_processing())
	area.free()
	checked += 1

	# Aggregate occupancy is not an enter/exit pulse timeline. Same-turn swaps
	# and enter+exit pairs never announce a transient empty/nonempty state.
	project = TypedProject.new()
	instance = actor(project)
	area = instance.get_parent()
	first = body()
	second = body()
	area.emit_signal("body_entered", first)
	await settle()
	area.emit_signal("body_exited", first)
	area.emit_signal("body_entered", second)
	await settle()
	assert(project.publications == [["physics.occupied", ID]])
	area.emit_signal("body_exited", second)
	await settle()
	area.emit_signal("body_entered", first)
	area.emit_signal("body_exited", first)
	await settle()
	assert(project.publications == [["physics.occupied", ID], ["physics.vacant", ID]])
	first.free()
	second.free()
	area.free()
	checked += 1

	project = Project.new()
	instance = actor(project)
	area = instance.get_parent()
	await settle()
	for identity in [null, "", "bad", 9, "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"]:
		first = body(identity)
		area.emit_signal("body_entered", first)
		first.free()
	var non_body := Node2D.new()
	non_body.set_meta("viento_instance_id", OTHER)
	root.add_child(non_body)
	area.emit_signal("body_entered", non_body)
	non_body.free()
	var other_area := Area2D.new()
	other_area.set_meta("viento_instance_id", OTHER)
	root.add_child(other_area)
	area.emit_signal("body_entered", other_area)
	other_area.free()
	await settle()
	assert(project.publications.is_empty() and instance._occupants.is_empty())
	first = body()
	first.queue_free()
	area.emit_signal("body_entered", first)
	await settle()
	assert(project.publications.is_empty() and instance._occupants.is_empty())
	area.free()
	checked += 1

	for parameters in [{"occupied_event": ""}, {"vacant_event": ""}, {"occupied_event": "", "vacant_event": ""}]:
		project = Project.new()
		instance = actor(project, parameters)
		area = instance.get_parent()
		first = body()
		area.emit_signal("body_entered", first)
		await settle()
		assert(instance._announced_occupied)
		area.emit_signal("body_exited", first)
		await settle()
		assert(not instance._announced_occupied)
		var expected: Array = []
		if not parameters.has("occupied_event"):
			expected.append(["physics.occupied", ID])
		if not parameters.has("vacant_event"):
			expected.append(["physics.vacant", ID])
		assert(project.publications == expected)
		first.free()
		area.free()
		checked += 1

	# A refusal is visible and revokes all callbacks. It is never retried.
	project = Project.new()
	project.accepted = false
	instance = actor(project)
	area = instance.get_parent()
	first = body()
	area.emit_signal("body_entered", first)
	await settle()
	assert(project.publications == [["physics.occupied", ID]])
	assert(not instance._opened and instance._occupants.is_empty())
	assert(area.get_signal_connection_list("body_entered").is_empty())
	assert(first.get_signal_connection_list("tree_exiting").is_empty())
	first.free()
	await settle()
	assert(project.publications.size() == 1)
	area.free()
	checked += 1
	expected_failures += 1

	# Paused body destruction updates native identity membership immediately,
	# but only the final changed state is announced when processing resumes.
	project = Project.new()
	instance = actor(project)
	area = instance.get_parent()
	first = body()
	area.emit_signal("body_entered", first)
	await settle()
	paused = true
	first.free()
	await settle()
	assert(instance._occupants.is_empty() and instance._dirty)
	assert(project.publications == [["physics.occupied", ID]])
	paused = false
	await settle()
	assert(project.publications == [["physics.occupied", ID], ["physics.vacant", ID]])
	assert(not instance._dirty and not instance.is_physics_processing())
	area.free()
	checked += 1

	project = Project.new()
	instance = actor(project)
	area = instance.get_parent()
	await settle()
	area.process_mode = Node.PROCESS_MODE_DISABLED
	first = body()
	area.emit_signal("body_entered", first)
	await settle()
	assert(project.publications.is_empty())
	area.process_mode = Node.PROCESS_MODE_INHERIT
	await settle()
	assert(project.publications == [["physics.occupied", ID]])
	# A normal close disables the scene first. Body lifetime cleanup must not
	# publish against the closing visit or invent an extra vacant event.
	area.process_mode = Node.PROCESS_MODE_DISABLED
	first.free()
	await settle()
	assert(project.publications.size() == 1)
	area.free()
	await settle()
	assert(project.publications.size() == 1)
	checked += 1

	project = Project.new()
	instance = actor(project)
	area = instance.get_parent()
	first = body()
	area.emit_signal("body_entered", first)
	await settle()
	area.remove_child(instance)
	assert(not instance._opened and instance._occupants.is_empty())
	assert(first.get_signal_connection_list("tree_exiting").is_empty())
	first.free()
	await settle()
	assert(project.publications == [["physics.occupied", ID]])
	instance.request_ready()
	area.add_child(instance)
	await settle()
	assert(instance._opened and not instance._announced_occupied)
	second = body()
	area.emit_signal("body_entered", second)
	await settle()
	assert(project.publications == [["physics.occupied", ID], ["physics.occupied", ID]])
	area.free()
	second.free()
	checked += 1

	# Late binding is checked against the actual native server overlap list,
	# not a mocked array or a source-code imitation of the set algorithm.
	project = Project.new()
	area = make_area()
	area.position = Vector2(1000, 1000)
	var shape := CollisionShape2D.new()
	var circle := CircleShape2D.new()
	circle.radius = 20
	shape.shape = circle
	area.add_child(shape)
	first = body()
	first.position = area.position
	var body_shape := CollisionShape2D.new()
	var body_circle := CircleShape2D.new()
	body_circle.radius = 4
	body_shape.shape = body_circle
	first.add_child(body_shape)
	for index in range(4):
		await physics_frame
	await settle()
	assert(area.get_overlapping_bodies().has(first))
	instance = actor(project, {}, area)
	assert(project.publications.is_empty())
	await settle()
	assert(project.publications == [["physics.occupied", ID]])
	assert(instance._occupants.size() == 1)
	for index in range(5):
		await physics_frame
	assert(project.publications.size() == 1) # No stay publication.
	first.position.x += 100
	for index in range(4):
		await physics_frame
	await settle()
	assert(project.publications == [["physics.occupied", ID], ["physics.vacant", ID]])
	first.free()
	area.free()
	checked += 1
	print("SENSOR_OCCUPANCY_STARTER_OK:" + JSON.stringify({"checked": checked, "expectedFailures": expected_failures}))
	quit()
`;
