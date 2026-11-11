extends SceneTree
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
