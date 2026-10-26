// Ordinary author source: request the current character's queued one-way drop.
export const GODOT_CHARACTER_DROP_THROUGH_SCRIPT = `extends Node

@export var drop_action: String = "ui_down"
var _drop
var _held := false

func _object_valid(value) -> bool:
	return typeof(value) == TYPE_OBJECT and is_instance_valid(value)

func _port_method(port, method_name: String, return_type: int) -> bool:
	for entry in port.get_method_list():
		if entry["name"] == method_name:
			return entry["args"].is_empty() and entry["default_args"].is_empty() and entry["return"]["type"] == return_type
	return false

func _ready() -> void:
	set_process(false)
	if drop_action.is_empty() or not InputMap.has_action(drop_action):
		_fail("drop_action must name an existing input action.")
		return
	if not has_meta("viento_character_drop"):
		_fail("Bind this script to a gravity-and-jump character in a project scene with a static one-way platform.")
		return
	var drop = get_meta("viento_character_drop")
	if not _object_valid(drop) or not _port_method(drop, "protocol_version", TYPE_INT) or not _port_method(drop, "request_drop", TYPE_BOOL):
		_fail("The character drop-through port has an unsupported contract.")
		return
	var version = drop.protocol_version()
	if typeof(version) != TYPE_INT or version != 1:
		_fail("The character drop-through port has an unsupported contract.")
		return
	_drop = drop
	_held = Input.is_action_pressed(drop_action)
	set_process(true)

func _process(_delta: float) -> void:
	if not _object_valid(_drop):
		_fail("The character drop-through port is no longer available.")
		return
	if not InputMap.has_action(drop_action):
		_fail("drop_action must name an existing input action.")
		return
	var pressed := Input.is_action_pressed(drop_action)
	var rising := pressed and not _held
	_held = pressed
	if rising:
		var accepted = _drop.request_drop()
		if typeof(accepted) != TYPE_BOOL:
			_fail("The character drop-through port returned an invalid result.")

func _stop() -> void:
	set_process(false)
	_drop = null
	_held = false

func _fail(message: String) -> void:
	_stop()
	push_error("Character drop-through: " + message)

func _exit_tree() -> void:
	_stop()
`;
