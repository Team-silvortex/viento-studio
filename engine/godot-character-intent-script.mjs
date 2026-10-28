// The official starter is ordinary editable author source; exact equality is required before inferring its parameter semantics.
export const GODOT_CHARACTER_INTENT_SCRIPT = `extends Node

@export var left_action: String = "ui_left"
@export var right_action: String = "ui_right"
@export var jump_action: String = "ui_accept"
var _intent
var _jump_held := false

func _actions_valid() -> bool:
	return not left_action.is_empty() and InputMap.has_action(left_action) and not right_action.is_empty() and InputMap.has_action(right_action) and not jump_action.is_empty() and InputMap.has_action(jump_action)

func _ready() -> void:
	set_physics_process(false)
	if not _actions_valid():
		_fail("left_action, right_action, and jump_action must name existing input actions.")
		return
	if not has_meta("viento_character_intent"):
		_fail("Bind this script to a controls=none gravity character in a project scene.")
		return
	var port = get_meta("viento_character_intent")
	if typeof(port) != TYPE_OBJECT or not is_instance_valid(port) or not port.has_method("protocol_version") or not port.has_method("submit"):
		_fail("The character intent port is unavailable.")
		return
	var version = port.protocol_version()
	if typeof(version) != TYPE_INT or version != 1:
		_fail("The character intent port has an unsupported contract.")
		return
	_intent = port
	_jump_held = Input.is_action_pressed(jump_action)
	set_physics_process(true)

func _physics_process(_delta: float) -> void:
	if typeof(_intent) != TYPE_OBJECT or not is_instance_valid(_intent):
		_fail("The character intent port is no longer available.")
		return
	if not _actions_valid():
		_fail("left_action, right_action, and jump_action must name existing input actions.")
		return
	var jump_held := Input.is_action_pressed(jump_action)
	var jump_pressed := jump_held and not _jump_held
	_jump_held = jump_held
	var accepted = _intent.submit(Input.get_axis(left_action, right_action), jump_pressed)
	if typeof(accepted) != TYPE_BOOL:
		_fail("The character intent port returned an invalid result.")

func _fail(message: String) -> void:
	set_physics_process(false)
	_intent = null
	push_error("Character intent: " + message)

func _exit_tree() -> void:
	set_physics_process(false)
	_intent = null
`;
