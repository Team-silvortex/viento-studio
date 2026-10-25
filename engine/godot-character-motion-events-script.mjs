// Ordinary author source: the engine port reports motion, this binding publishes.
export const GODOT_CHARACTER_MOTION_EVENTS_SCRIPT = `extends Node

@export var jumped_event: String = "physics.jumped"
@export var landed_event: String = "physics.landed"
var _project
var _motion
var _instance_id: String = ""
var _jump_connected := false
var _land_connected := false

func _object_valid(value) -> bool:
	return typeof(value) == TYPE_OBJECT and is_instance_valid(value)

func _zero_argument_signal(port, name: String) -> bool:
	for entry in port.get_signal_list():
		if entry["name"] == name:
			return entry["args"].is_empty()
	return false

func _ready() -> void:
	if not has_meta("viento_project") or not has_meta("viento_character_motion") or not has_meta("viento_instance_id"):
		_fail("Bind this script to a character with gravity and jumping in a project run.")
		return
	var project = get_meta("viento_project")
	var motion = get_meta("viento_character_motion")
	var instance_id = get_meta("viento_instance_id")
	if not _object_valid(project) or not project.has_method("publish_event"):
		_fail("The project event port is unavailable.")
		return
	if not _object_valid(motion) or not motion.has_method("protocol_version"):
		_fail("The character motion event port is unavailable.")
		return
	var version = motion.protocol_version()
	if typeof(version) != TYPE_INT or version != 1 or not _zero_argument_signal(motion, "jumped") or not _zero_argument_signal(motion, "landed"):
		_fail("The character motion event port has an unsupported contract.")
		return
	var pattern := RegEx.new()
	pattern.compile("^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
	if typeof(instance_id) != TYPE_STRING or instance_id.length() != 36 or pattern.search(instance_id) == null:
		_fail("The behavior instance identity is unavailable.")
		return
	_project = project
	_motion = motion
	_instance_id = instance_id
	if not jumped_event.is_empty():
		if _motion.connect("jumped", _on_jumped) != OK:
			_fail("Cannot subscribe to the character jump event.")
			return
		_jump_connected = true
	if not landed_event.is_empty():
		if _motion.connect("landed", _on_landed) != OK:
			_fail("Cannot subscribe to the character landing event.")
			return
		_land_connected = true

func _publish(name: String) -> void:
	if name.is_empty():
		return
	if not _object_valid(_project):
		_fail("The project event port is no longer available.")
		return
	var accepted = _project.publish_event(name, _instance_id)
	if typeof(accepted) != TYPE_BOOL or not accepted:
		_fail("The project rejected the character motion event.")

func _on_jumped() -> void:
	_publish(jumped_event)

func _on_landed() -> void:
	_publish(landed_event)

func _disconnect() -> void:
	var motion = _motion
	_motion = null
	_project = null
	_instance_id = ""
	if _object_valid(motion):
		if _jump_connected and motion.is_connected("jumped", _on_jumped):
			motion.disconnect("jumped", _on_jumped)
		if _land_connected and motion.is_connected("landed", _on_landed):
			motion.disconnect("landed", _on_landed)
	_jump_connected = false
	_land_connected = false

func _fail(message: String) -> void:
	_disconnect()
	push_error("Character motion events: " + message)

func _exit_tree() -> void:
	_disconnect()
`;
