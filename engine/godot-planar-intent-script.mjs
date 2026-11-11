// Ordinary editable author source. Exact source equality is required before
// treating its four exported names as project input-action references.
export const GODOT_PLANAR_INTENT_SCRIPT = `extends Node

@export var left_action: String = "ui_left"
@export var right_action: String = "ui_right"
@export var up_action: String = "ui_up"
@export var down_action: String = "ui_down"
var _intent

func _actions_valid() -> bool:
	for action in [left_action, right_action, up_action, down_action]:
		if action.is_empty() or not InputMap.has_action(action):
			return false
	return true

func _port_method(port, method_name: String, arguments: int, result_type: int) -> bool:
	for method in port.get_method_list():
		if method["name"] != method_name:
			continue
		if method["args"].size() != arguments or not method["default_args"].is_empty() or method["return"]["type"] != result_type:
			return false
		for argument in method["args"]:
			if argument["type"] not in [TYPE_NIL, TYPE_FLOAT]:
				return false
		return true
	return false

func _port_valid(port) -> bool:
	if typeof(port) != TYPE_OBJECT or not is_instance_valid(port):
		return false
	if not _port_method(port, "protocol_version", 0, TYPE_INT) or not _port_method(port, "submit", 2, TYPE_BOOL):
		return false
	var version = port.protocol_version()
	return typeof(version) == TYPE_INT and version == 1

func _ready() -> void:
	set_physics_process(false)
	if not _actions_valid():
		_fail("left_action, right_action, up_action, and down_action must name existing input actions.")
		return
	if not has_meta("viento_planar_intent"):
		_fail("Bind this script to a controls=none physical character without gravity in a project scene.")
		return
	var port = get_meta("viento_planar_intent")
	if not _port_valid(port):
		_fail("The planar intent port is unavailable or has an unsupported contract.")
		return
	_intent = port
	set_physics_process(true)

func _physics_process(_delta: float) -> void:
	if not _port_valid(_intent):
		_fail("The planar intent port is no longer available or has an unsupported contract.")
		return
	if not _actions_valid():
		_fail("left_action, right_action, up_action, and down_action must name existing input actions.")
		return
	var direction := Input.get_vector(left_action, right_action, up_action, down_action)
	var accepted = _intent.submit(direction.x, direction.y)
	if typeof(accepted) != TYPE_BOOL:
		_fail("The planar intent port returned an invalid result.")
	# false is a normal refusal, including another binding winning this step.
	# Submit current input on the next callback; never replay a refused request.

func _fail(message: String) -> void:
	set_physics_process(false)
	_intent = null
	push_error("Planar intent: " + message)

func _exit_tree() -> void:
	set_physics_process(false)
	_intent = null
`;
