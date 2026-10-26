// Ordinary author source: native endpoints become explicitly bounded project events.
export const GODOT_PLATFORM_ENDPOINT_EVENTS_SCRIPT = `extends Node

@export var origin_event: String = "physics.platform_origin"
@export var destination_event: String = "physics.platform_destination"
var _project
var _platform
var _instance_id: String = ""
var _origin_connected := false
var _destination_connected := false

func _object_valid(value) -> bool:
	return typeof(value) == TYPE_OBJECT and is_instance_valid(value)

func _port_method(port, method_name: String, argument_count: int, return_type: int) -> bool:
	for entry in port.get_method_list():
		if entry["name"] == method_name:
			if entry["args"].size() != argument_count or not entry["default_args"].is_empty() or entry["return"]["type"] != return_type:
				return false
			for argument in entry["args"]:
				if argument["type"] != TYPE_NIL and argument["type"] != TYPE_STRING:
					return false
			return true
	return false

func _zero_argument_signal(port, name: String) -> bool:
	for entry in port.get_signal_list():
		if entry["name"] == name:
			return entry["args"].is_empty()
	return false

func _ready() -> void:
	if not has_meta("viento_project") or not has_meta("viento_platform_events") or not has_meta("viento_instance_id"):
		_fail("Bind this script to a declared moving platform in a project run.")
		return
	var project = get_meta("viento_project")
	var platform = get_meta("viento_platform_events")
	var instance_id = get_meta("viento_instance_id")
	if not _object_valid(project) or not _port_method(project, "publish_event", 2, TYPE_BOOL):
		_fail("The project event port is unavailable or has an unsupported contract.")
		return
	if not _object_valid(platform) or not _port_method(platform, "protocol_version", 0, TYPE_INT):
		_fail("The platform endpoint event port is unavailable or has an unsupported contract.")
		return
	var version = platform.protocol_version()
	if typeof(version) != TYPE_INT or version != 1 or not _zero_argument_signal(platform, "origin_reached") or not _zero_argument_signal(platform, "destination_reached"):
		_fail("The platform endpoint event port has an unsupported contract.")
		return
	var pattern := RegEx.new()
	pattern.compile("^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
	if typeof(instance_id) != TYPE_STRING or instance_id.length() != 36 or pattern.search(instance_id) == null:
		_fail("The behavior instance identity is unavailable.")
		return
	_project = project
	_platform = platform
	_instance_id = instance_id
	if not origin_event.is_empty():
		if _platform.connect("origin_reached", _on_origin_reached) != OK:
			_fail("Cannot subscribe to the platform origin event.")
			return
		_origin_connected = true
	if not destination_event.is_empty():
		if _platform.connect("destination_reached", _on_destination_reached) != OK:
			_fail("Cannot subscribe to the platform destination event.")
			return
		_destination_connected = true

func _publish(name: String) -> void:
	if name.is_empty():
		return
	if not _object_valid(_project):
		_fail("The project event port is no longer available.")
		return
	var accepted = _project.publish_event(name, _instance_id)
	if typeof(accepted) != TYPE_BOOL or not accepted:
		_fail("The project rejected the platform endpoint event.")

func _on_origin_reached() -> void:
	_publish(origin_event)

func _on_destination_reached() -> void:
	_publish(destination_event)

func _disconnect() -> void:
	var platform = _platform
	_platform = null
	_project = null
	_instance_id = ""
	if _object_valid(platform):
		if _origin_connected and platform.is_connected("origin_reached", _on_origin_reached):
			platform.disconnect("origin_reached", _on_origin_reached)
		if _destination_connected and platform.is_connected("destination_reached", _on_destination_reached):
			platform.disconnect("destination_reached", _on_destination_reached)
	_origin_connected = false
	_destination_connected = false

func _fail(message: String) -> void:
	_disconnect()
	push_error("Platform endpoint events: " + message)

func _exit_tree() -> void:
	_disconnect()
`;
