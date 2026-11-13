// Ordinary editable author behaviors. They use the existing visit-bound project
// port, never mutate the tree, input map, runtime protocol or generated solver.
export const GODOT_ACTION_SCENE_SWITCH_SCRIPT = `extends Node

@export var action_name: String = "ui_accept"
@export var target_scene_id: String = ""
var _project
var _active := false
var _armed := false
var _candidate_event_id: int = 0
var _accepted := false
var _window: Window
var _focused := false

func _object_valid(value) -> bool:
	return typeof(value) == TYPE_OBJECT and is_instance_valid(value)

func _uuid(value: String) -> bool:
	var pattern := RegEx.new()
	pattern.compile("^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
	return value.length() == 36 and pattern.search(value) != null

func _ready() -> void:
	_deactivate()
	if action_name.is_empty() or not _uuid(target_scene_id):
		_fail("Choose an existing input action and a target member scene UUID.")
		return
	if not has_meta("viento_project"):
		_fail("Bind this script in a project assembly run.")
		return
	var project = get_meta("viento_project")
	if not _object_valid(project) or not project.has_method("request_scene"):
		_fail("The visit-bound scene request port is unavailable.")
		return
	if not InputMap.has_action(action_name):
		_fail("The named input action is not registered; configure the project input map first.")
		return
	_project = project
	_active = true
	_accepted = false
	_window = get_window()
	_focused = _window.has_focus()
	_window.focus_exited.connect(_on_focus_exited)
	_window.focus_entered.connect(_on_focus_entered)
	# Entering a scene while the key is held must not navigate straight through it.
	_armed = _focused and not Input.is_action_pressed(action_name)
	set_process(true)
	set_process_input(true)
	set_process_unhandled_input(true)

func _process(_delta: float) -> void:
	# Observe only. A refused request is never polled or replayed here.
	_candidate_event_id = 0
	if _active:
		_armed = _focused and not Input.is_action_pressed(action_name)

func _input(event: InputEvent) -> void:
	_candidate_event_id = 0
	if not _active or not _focused or _accepted or event.is_echo():
		return
	if event.is_action_released(action_name):
		_armed = not Input.is_action_pressed(action_name)
	elif event.is_action_pressed(action_name, false):
		# Observe before GUI dispatch but do not handle the event or navigate.
		# A GUI-consumed press still consumes its edge, including another mapped
		# key pressed in the same frame before the idle observer can run.
		if _armed:
			_candidate_event_id = event.get_instance_id()
		_armed = false

func _unhandled_input(event: InputEvent) -> void:
	if not _active or not _focused or _accepted or event.is_echo() or event.get_instance_id() != _candidate_event_id:
		return
	_candidate_event_id = 0
	if not event.is_action_pressed(action_name, false):
		return
	if not _object_valid(_project):
		_fail("The visit-bound scene request port is no longer available.")
		return
	var accepted = _project.request_scene(target_scene_id)
	if typeof(accepted) != TYPE_BOOL:
		_fail("The scene request port returned an invalid result.")
		return
	if accepted:
		_accepted = true
		_deactivate()
		get_viewport().set_input_as_handled()
	# false is ordinary competition. A fresh release/press may try again; this
	# press, echoes and later idle frames never retry the request automatically.

func _on_focus_exited() -> void:
	_focused = false
	_armed = false
	_candidate_event_id = 0

func _on_focus_entered() -> void:
	_focused = true
	_armed = false
	_candidate_event_id = 0
	# An observed release or a later idle observation of the released action
	# rearms input. Focus changes never replay a previously held key.

func _deactivate() -> void:
	if is_instance_valid(_window):
		if _window.focus_exited.is_connected(_on_focus_exited):
			_window.focus_exited.disconnect(_on_focus_exited)
		if _window.focus_entered.is_connected(_on_focus_entered):
			_window.focus_entered.disconnect(_on_focus_entered)
	_window = null
	_focused = false
	_active = false
	_armed = false
	_candidate_event_id = 0
	_project = null
	set_process(false)
	set_process_input(false)
	set_process_unhandled_input(false)

func _fail(message: String) -> void:
	_deactivate()
	push_error("Input scene navigation: " + message)

func _exit_tree() -> void:
	_deactivate()
`;

export const GODOT_EVENT_SCENE_SWITCH_SCRIPT = `extends Node

@export var event_name: String = "game.complete"
@export var target_scene_id: String = ""
@export var payload_filter: String = ""
var _project
var _subscription: int = 0
var _active := false
var _accepted := false

func _object_valid(value) -> bool:
	return typeof(value) == TYPE_OBJECT and is_instance_valid(value)

func _uuid(value: String) -> bool:
	var pattern := RegEx.new()
	pattern.compile("^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
	return value.length() == 36 and pattern.search(value) != null

func _event_name_valid(value: String) -> bool:
	var pattern := RegEx.new()
	pattern.compile("^[A-Za-z][A-Za-z0-9_.-]{0,63}$")
	var matched = pattern.search(value)
	return value.length() <= 64 and not value in ["constructor", "prototype", "__proto__"] and matched != null and matched.get_string() == value

func _filter_valid(value: String) -> bool:
	if value.to_utf8_buffer().size() > 4096:
		return false
	for index in range(value.length()):
		var code := value.unicode_at(index)
		if code < 0 or code > 0x10ffff or (code >= 0xd800 and code <= 0xdfff):
			return false
	return true

func _ready() -> void:
	_disconnect()
	if not _event_name_valid(event_name) or not _uuid(target_scene_id) or not _filter_valid(payload_filter):
		_fail("Choose a project event, a target member scene UUID and a bounded scalar text filter.")
		return
	if not has_meta("viento_project"):
		_fail("Bind this script in a project assembly run.")
		return
	var project = get_meta("viento_project")
	if not _object_valid(project):
		_fail("The visit-bound project event port is unavailable.")
		return
	for method in ["subscribe_event", "unsubscribe_event", "request_scene"]:
		if not project.has_method(method):
			_fail("The project event and scene request port has an unsupported contract.")
			return
	_project = project
	_active = true
	_accepted = false
	var token = _project.subscribe_event(event_name, _on_event)
	if typeof(token) != TYPE_INT or token <= 0:
		_fail("Cannot subscribe to the requested project event.")
		return
	_subscription = token

func _on_event(value) -> bool:
	# A captured batch can still deliver after the first request was accepted.
	# Ignoring those deliveries is normal handling, never a fatal callback error.
	if not _active or _accepted:
		return true
	if _subscription == 0 or not _object_valid(_project):
		_fail("The project event subscription is no longer available.")
		return false
	if not payload_filter.is_empty() and (typeof(value) != TYPE_STRING or value != payload_filter):
		return true
	var accepted = _project.request_scene(target_scene_id)
	if typeof(accepted) != TYPE_BOOL:
		_fail("The scene request port returned an invalid result.")
		return false
	_accepted = accepted
	# A false request is a normal refusal. Only a new matching publication may
	# try again. The coordinator applies accepted navigation after FIFO delivery.
	return true

func _disconnect() -> void:
	var project = _project
	var subscription := _subscription
	_project = null
	_subscription = 0
	_active = false
	if subscription != 0 and _object_valid(project) and project.has_method("unsubscribe_event"):
		project.unsubscribe_event(subscription)

func _fail(message: String) -> void:
	_disconnect()
	push_error("Event scene navigation: " + message)

func _exit_tree() -> void:
	_disconnect()
`;
