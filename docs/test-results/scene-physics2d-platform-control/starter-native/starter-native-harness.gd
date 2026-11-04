extends SceneTree
const Starter = preload("res://starter.gd")
const ID := "11111111-1111-4111-8111-111111111111"
const OTHER := "22222222-2222-4222-8222-222222222222"
var checked := 0
var expected_failures := 0

class Port extends RefCounted:
	var requests: Array = []
	var running = true
	var accepted := true
	func protocol_version() -> int:
		return 1
	func request_running(value) -> bool:
		requests.append(value)
		return accepted
	func read_running():
		return running

class RacingPort extends Port:
	func request_running(value) -> bool:
		requests.append(value)
		return requests.size() != 2

class TypedPort extends Port:
	func request_running(value: bool) -> bool:
		return super.request_running(value)

class OldPort extends Port:
	func protocol_version() -> int:
		return 2

class WrongVersion extends RefCounted:
	func protocol_version():
		return 1.0
	func request_running(_value) -> bool:
		assert(false)
		return true
	func read_running():
		return true

class OptionalVersion extends Port:
	func protocol_version(_extra: int = 0) -> int:
		assert(false)
		return 1

class WrongRequest extends RefCounted:
	func protocol_version() -> int:
		return 1
	func request_running(_value: int) -> bool:
		assert(false)
		return true
	func read_running():
		return true

class OptionalRequest extends RefCounted:
	func protocol_version() -> int:
		return 1
	func request_running(_value = true) -> bool:
		assert(false)
		return true
	func read_running():
		return true

class WrongRequestResult extends RefCounted:
	func protocol_version() -> int:
		return 1
	func request_running(_value):
		assert(false)
		return 1
	func read_running():
		return true

class WrongRead extends RefCounted:
	func protocol_version() -> int:
		return 1
	func request_running(_value) -> bool:
		assert(false)
		return true
	func read_running() -> bool:
		return true

class OptionalRead extends RefCounted:
	func protocol_version() -> int:
		return 1
	func request_running(_value) -> bool:
		assert(false)
		return true
	func read_running(_extra = null):
		assert(false)
		return true

class Project extends RefCounted:
	var subscriptions: Dictionary = {}
	var sequence := 0
	var removals: Array = []
	var fail_at := 0
	var failure_value := 0
	func subscribe_event(name, callback) -> int:
		sequence += 1
		if sequence == fail_at:
			return failure_value
		subscriptions[sequence] = [name, callback]
		return sequence
	func unsubscribe_event(id) -> bool:
		removals.append(id)
		return subscriptions.erase(id)
	func deliver(name: String, value) -> Array:
		var results: Array = []
		for row in subscriptions.values():
			if row[0] == name:
				results.append(row[1].call(value))
		return results

class WrongSubscribe extends RefCounted:
	func subscribe_event(_name: int, _callback) -> int:
		assert(false)
		return 1
	func unsubscribe_event(_id) -> bool:
		assert(false)
		return true

class OptionalSubscribe extends RefCounted:
	func subscribe_event(_name, _callback = null) -> int:
		assert(false)
		return 1
	func unsubscribe_event(_id) -> bool:
		assert(false)
		return true

class WrongUnsubscribe extends RefCounted:
	func subscribe_event(_name, _callback) -> int:
		assert(false)
		return 1
	func unsubscribe_event(_id: String) -> bool:
		assert(false)
		return true

func actor(project, port, parameters: Dictionary = {}):
	var instance = Starter.new()
	instance.set_meta("viento_project", project)
	instance.set_meta("viento_platform_control", port)
	for key in parameters:
		instance.set(key, parameters[key])
	return instance

func reject(project, port, parameters: Dictionary = {}) -> void:
	var instance = actor(project, port, parameters)
	root.add_child(instance)
	assert(instance._project == null and instance._platform == null)
	assert(instance._resume_subscription == 0 and instance._pause_subscription == 0)
	instance.free()
	checked += 1
	expected_failures += 1

func _initialize() -> void:
	call_deferred("run_test")

func run_test() -> void:
	for port in [null, false, 1, "port", RefCounted.new(), OldPort.new(), WrongVersion.new(), OptionalVersion.new(), WrongRequest.new(), OptionalRequest.new(), WrongRequestResult.new(), WrongRead.new(), OptionalRead.new()]:
		reject(Project.new(), port)
	for project in [null, false, RefCounted.new(), WrongSubscribe.new(), OptionalSubscribe.new(), WrongUnsubscribe.new()]:
		reject(project, Port.new())
	var port = Port.new()
	port.running = null
	reject(Project.new(), port)
	reject(Project.new(), Port.new(), {"resume_event": "same", "pause_event": "same"})
	reject(Project.new(), Port.new(), {"instance_id": "bad UUID"})
	for index in [1, 2]:
		var project = Project.new()
		project.fail_at = index
		reject(project, Port.new())
		assert(project.subscriptions.is_empty())
		assert(project.removals == ([] if index == 1 else [1]))

	var project = Project.new()
	port = Port.new()
	var instance = actor(project, port)
	root.add_child(instance)
	assert(port.requests == [true] and project.subscriptions.size() == 2)
	assert(instance._desired_running == null and not instance.is_physics_processing())
	assert(project.deliver("platform.pause", null) == [true])
	assert(project.deliver("platform.resume", 42) == [true])
	assert(port.requests == [true, false, true])
	assert(port.running == true) # A request is queued; source does not apply it.
	instance.free()
	assert(project.removals == [1, 2] and project.subscriptions.is_empty())
	checked += 1

	project = Project.new()
	port = TypedPort.new()
	instance = actor(project, port, {"initial_running": false})
	root.add_child(instance)
	assert(port.requests == [false])
	instance.free()
	checked += 1

	project = Project.new()
	port = Port.new()
	instance = actor(project, port, {"instance_id": ID})
	root.add_child(instance)
	for payload in [OTHER, 7, null, true, [ID], {"instanceId": ID}]:
		assert(project.deliver("platform.pause", payload) == [true])
	assert(port.requests == [true])
	assert(project.deliver("platform.pause", ID) == [true])
	assert(project.deliver("platform.resume", ID) == [true])
	assert(port.requests == [true, false, true])
	instance.free()
	checked += 1

	for parameters in [{"resume_event": ""}, {"pause_event": ""}, {"resume_event": "", "pause_event": ""}]:
		project = Project.new()
		port = Port.new()
		instance = actor(project, port, parameters)
		root.add_child(instance)
		assert(port.requests == [true])
		assert(project.subscriptions.size() == 2 - parameters.size())
		if parameters.has("resume_event"):
			assert(project.deliver("platform.resume", ID).is_empty())
		if parameters.has("pause_event"):
			assert(project.deliver("platform.pause", ID).is_empty())
		instance.free()
		assert(project.subscriptions.is_empty())
		checked += 1

	project = Project.new()
	port = Port.new()
	port.accepted = false
	instance = actor(project, port, {"initial_running": false})
	root.add_child(instance)
	assert(project.subscriptions.size() == 2)
	assert(project.deliver("platform.resume", null) == [true])
	assert(project.deliver("platform.pause", null) == [true])
	assert(port.requests == [false, true, false] and project.removals.is_empty())
	assert(instance._desired_running == false and instance.is_physics_processing())
	instance._physics_process(0.016)
	assert(port.requests == [false, true, false, false])
	port.accepted = true
	assert(project.deliver("platform.resume", null) == [true])
	assert(port.requests == [false, true, false, false, true])
	assert(instance._desired_running == null and not instance.is_physics_processing())
	instance.free()
	checked += 1

	# Inactive ports cannot ever accept another request. Stop retrying and
	# remove subscriptions rather than spinning for the rest of the visit.
	project = Project.new()
	port = Port.new()
	instance = actor(project, port)
	root.add_child(instance)
	port.running = null
	port.accepted = false
	assert(project.deliver("platform.pause", null) == [false])
	assert(project.subscriptions.is_empty() and project.removals == [1, 2])
	assert(instance._desired_running == null and not instance.is_physics_processing())
	instance.free()
	checked += 1
	expected_failures += 1

	# Startup pause occupies the native slot; sensor entry must survive its
	# refusal even though read_running() still reports the desired true state.
	project = Project.new()
	port = RacingPort.new()
	instance = actor(project, port, {"initial_running": false})
	root.add_child(instance)
	assert(project.deliver("platform.resume", null) == [true])
	assert(port.running == true and instance._desired_running == true)
	assert(instance.is_physics_processing())
	instance._physics_process(0.016)
	assert(port.requests == [false, true, true])
	assert(instance._desired_running == null and not instance.is_physics_processing())
	instance.free()
	checked += 1

	# New events replace the latest refused state, and leaving cancels retry.
	project = Project.new()
	port = Port.new()
	port.accepted = false
	instance = actor(project, port)
	root.add_child(instance)
	assert(project.deliver("platform.pause", null) == [true])
	assert(project.deliver("platform.resume", null) == [true])
	assert(project.deliver("platform.pause", null) == [true])
	port.accepted = true
	instance._physics_process(0.016)
	assert(port.requests == [true, false, true, false, false])
	port.accepted = false
	assert(project.deliver("platform.resume", null) == [true])
	root.remove_child(instance)
	assert(instance._desired_running == null and not instance.is_physics_processing())
	assert(project.subscriptions.is_empty())
	instance.free()
	checked += 1

	project = Project.new()
	port = Port.new()
	instance = actor(project, port, {"resume_event": "sensor.enter", "pause_event": "sensor.exit", "instance_id": ID, "initial_running": false})
	root.add_child(instance)
	assert(project.deliver("sensor.enter", ID) == [true])
	assert(project.deliver("sensor.exit", ID) == [true])
	assert(port.requests == [false, true, false])
	instance.free()
	checked += 1

	project = Project.new()
	port = Port.new()
	instance = actor(project, port)
	root.add_child(instance)
	root.remove_child(instance)
	assert(project.subscriptions.is_empty())
	assert(project.deliver("platform.resume", null).is_empty())
	instance.request_ready()
	root.add_child(instance)
	assert(project.subscriptions.size() == 2 and port.requests == [true, true])
	instance.free()
	assert(project.removals == [1, 2, 3, 4])
	checked += 1

	# There is no author-local cap: repeated accepted event callbacks remain
	# bounded by the existing project event service rather than this starter.
	project = Project.new()
	port = Port.new()
	instance = actor(project, port)
	root.add_child(instance)
	for index in range(256):
		assert(project.deliver("platform.pause", null) == [true])
	assert(port.requests.size() == 257 and project.subscriptions.size() == 2)
	instance.free()
	checked += 1
	print("PLATFORM_CONTROL_STARTER_OK:" + JSON.stringify({"checked": checked, "expectedFailures": expected_failures}))
	quit()
