extends SceneTree
const Starter = preload("res://starter.gd")
const INSTANCE_ID := "11111111-1111-4111-8111-111111111111"
const OTHER_ID := "22222222-2222-4222-8222-222222222222"

class Port extends RefCounted:
	signal origin_reached
	signal destination_reached
	func protocol_version() -> int:
		return 1

class OldPort extends Port:
	func protocol_version() -> int:
		return 0

class WrongVersionType extends RefCounted:
	signal origin_reached
	signal destination_reached
	func protocol_version():
		return 1.0

class WrongVersionArity extends RefCounted:
	signal origin_reached
	signal destination_reached
	func protocol_version(_value: int) -> int:
		assert(false)
		return 1

class OptionalVersionArgument extends RefCounted:
	signal origin_reached
	signal destination_reached
	func protocol_version(_value: int = 0) -> int:
		assert(false)
		return 1

class WrongOriginSignal extends RefCounted:
	signal origin_reached(value: String)
	signal destination_reached
	func protocol_version() -> int:
		return 1

class WrongDestinationSignal extends RefCounted:
	signal origin_reached
	signal destination_reached(value: String)
	func protocol_version() -> int:
		return 1

class MissingSignal extends RefCounted:
	signal origin_reached
	func protocol_version() -> int:
		return 1

class NodePort extends Node:
	signal origin_reached
	signal destination_reached
	func protocol_version() -> int:
		return 1

class Project extends RefCounted:
	var publications: Array = []
	var accepted := true
	var calls := 0
	func publish_event(name, value) -> bool:
		calls += 1
		if not accepted:
			return false
		publications.append([name, value])
		return true

class TypedProject extends RefCounted:
	var publications: Array = []
	func publish_event(name: String, value: String) -> bool:
		publications.append([name, value])
		return true

class NodeProject extends Node:
	func publish_event(_name, _value) -> bool:
		return true

class WrongProjectArity extends RefCounted:
	func publish_event(_name) -> bool:
		assert(false)
		return true

class OptionalProjectArgument extends RefCounted:
	func publish_event(_name, _value = "") -> bool:
		assert(false)
		return true

class WrongProjectReturn extends RefCounted:
	func publish_event(_name, _value) -> int:
		assert(false)
		return 1

class UntypedProjectReturn extends RefCounted:
	func publish_event(_name, _value):
		assert(false)
		return true

class WrongProjectTypes extends RefCounted:
	func publish_event(_name: int, _value: int) -> bool:
		assert(false)
		return true

var checked := 0
var expected_failures := 0

func starter(project, port):
	var instance = Starter.new()
	instance.set_meta("viento_project", project)
	instance.set_meta("viento_instance_id", INSTANCE_ID)
	instance.set_meta("viento_platform_events", port)
	return instance

func disconnected(instance, port) -> void:
	assert(instance.get("_platform") == null)
	assert(instance.get("_project") == null)
	assert(instance.get("_instance_id") == "")
	assert(not instance.get("_origin_connected"))
	assert(not instance.get("_destination_connected"))
	if typeof(port) == TYPE_OBJECT and is_instance_valid(port):
		for name in ["origin_reached", "destination_reached"]:
			if port.has_signal(name):
				assert(port.get_signal_connection_list(name).is_empty())

func invalid(instance, port) -> void:
	root.add_child(instance)
	disconnected(instance, port)
	instance.free()
	checked += 1
	expected_failures += 1

func _initialize() -> void:
	call_deferred("run_checks")

func run_checks() -> void:
	var project = Project.new()
	var port = Port.new()
	var instance = starter(project, port)
	root.add_child(instance)
	assert(project.publications.is_empty())
	assert(port.get_signal_connection_list("origin_reached").size() == 1)
	assert(port.get_signal_connection_list("destination_reached").size() == 1)
	port.destination_reached.emit()
	port.origin_reached.emit()
	assert(project.publications == [["physics.platform_destination", INSTANCE_ID], ["physics.platform_origin", INSTANCE_ID]])
	root.remove_child(instance)
	disconnected(instance, port)
	port.destination_reached.emit()
	port.origin_reached.emit()
	assert(project.publications.size() == 2)
	instance.free()
	checked += 1

	for disabled in ["origin", "destination", "both"]:
		project = Project.new()
		port = Port.new()
		instance = starter(project, port)
		instance.origin_event = "custom.origin" if disabled == "destination" else ""
		instance.destination_event = "custom.destination" if disabled == "origin" else ""
		root.add_child(instance)
		assert(project.publications.is_empty())
		assert(port.get_signal_connection_list("origin_reached").size() == (1 if disabled == "destination" else 0))
		assert(port.get_signal_connection_list("destination_reached").size() == (1 if disabled == "origin" else 0))
		port.origin_reached.emit()
		port.destination_reached.emit()
		var expected := []
		if disabled == "destination":
			expected.append(["custom.origin", INSTANCE_ID])
		if disabled == "origin":
			expected.append(["custom.destination", INSTANCE_ID])
		assert(project.publications == expected)
		instance.free()
		assert(port.get_signal_connection_list("origin_reached").is_empty())
		assert(port.get_signal_connection_list("destination_reached").is_empty())
		checked += 1

	project = TypedProject.new()
	port = Port.new()
	instance = starter(project, port)
	instance.origin_event = "custom.origin"
	instance.destination_event = "custom.destination"
	root.add_child(instance)
	port.origin_reached.emit()
	port.destination_reached.emit()
	assert(project.publications == [["custom.origin", INSTANCE_ID], ["custom.destination", INSTANCE_ID]])
	instance.free()
	checked += 1

	project = Project.new()
	port = Port.new()
	var other_port = Port.new()
	instance = starter(project, port)
	var other = starter(project, other_port)
	other.set_meta("viento_instance_id", OTHER_ID)
	root.add_child(instance)
	root.add_child(other)
	port.destination_reached.emit()
	assert(project.publications == [["physics.platform_destination", INSTANCE_ID]])
	other_port.origin_reached.emit()
	assert(project.publications == [["physics.platform_destination", INSTANCE_ID], ["physics.platform_origin", OTHER_ID]])
	instance.free()
	other_port.destination_reached.emit()
	assert(project.publications.back() == ["physics.platform_destination", OTHER_ID])
	other.free()
	checked += 1

	for unavailable in [false, RefCounted.new(), OldPort.new(), WrongVersionType.new(), WrongVersionArity.new(), OptionalVersionArgument.new(), WrongOriginSignal.new(), WrongDestinationSignal.new(), MissingSignal.new()]:
		project = Project.new()
		instance = starter(project, unavailable)
		invalid(instance, unavailable)
		assert(project.publications.is_empty())

	for unavailable in [false, RefCounted.new(), WrongProjectArity.new(), OptionalProjectArgument.new(), WrongProjectReturn.new(), UntypedProjectReturn.new(), WrongProjectTypes.new()]:
		port = Port.new()
		instance = starter(unavailable, port)
		invalid(instance, port)

	for identity in [false, 1, "", "not-a-uuid", "AAAAAAAA-1111-4111-8111-111111111111", INSTANCE_ID + "\n", " " + INSTANCE_ID, "11111111-1111-4111-8111-11111111111g"]:
		project = Project.new()
		port = Port.new()
		instance = starter(project, port)
		instance.set_meta("viento_instance_id", identity)
		invalid(instance, port)
		assert(project.publications.is_empty())

	for key in ["viento_project", "viento_platform_events", "viento_instance_id"]:
		project = Project.new()
		port = Port.new()
		instance = starter(project, port)
		instance.remove_meta(key)
		invalid(instance, port)
		assert(project.publications.is_empty())

	project = Project.new()
	project.accepted = false
	port = Port.new()
	instance = starter(project, port)
	root.add_child(instance)
	port.destination_reached.emit()
	disconnected(instance, port)
	port.origin_reached.emit()
	assert(project.calls == 1 and project.publications.is_empty())
	instance.free()
	checked += 1
	expected_failures += 1

	var dead_project = NodeProject.new()
	port = Port.new()
	instance = starter(dead_project, port)
	root.add_child(instance)
	dead_project.free()
	port.origin_reached.emit()
	disconnected(instance, port)
	instance.free()
	checked += 1
	expected_failures += 1

	project = Project.new()
	var dead_port = NodePort.new()
	instance = starter(project, dead_port)
	root.add_child(instance)
	dead_port.free()
	instance.free()
	assert(project.publications.is_empty())
	checked += 1

	project = Project.new()
	port = Port.new()
	instance = starter(project, port)
	root.add_child(instance)
	root.remove_child(instance)
	disconnected(instance, port)
	instance.request_ready()
	root.add_child(instance)
	assert(project.publications.is_empty())
	port.origin_reached.emit()
	assert(project.publications == [["physics.platform_origin", INSTANCE_ID]])
	assert(port.get_signal_connection_list("origin_reached").size() == 1)
	instance.free()
	checked += 1

	# No source-level lifetime cap: the project owns acceptance and its existing
	# publication budget. The source disconnects only after an explicit refusal.
	project = Project.new()
	port = Port.new()
	instance = starter(project, port)
	root.add_child(instance)
	for index in range(256):
		port.destination_reached.emit()
	assert(project.calls == 256 and project.publications.size() == 256)
	instance.free()
	checked += 1

	print("PLATFORM_ENDPOINT_STARTER_OK:" + JSON.stringify({"checked": checked, "expectedFailures": expected_failures}))
	quit()
