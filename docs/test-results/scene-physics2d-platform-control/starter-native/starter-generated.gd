extends Node

@export var initial_running: bool = true
@export var resume_event: String = "platform.resume"
@export var pause_event: String = "platform.pause"
@export var instance_id: String = ""
var _project
var _platform
var _resume_subscription: int = 0
var _pause_subscription: int = 0
var _desired_running = null

func _object_valid(value) -> bool:
	return typeof(value) == TYPE_OBJECT and is_instance_valid(value)

func _port_method(port, method_name: String, argument_types: Array, return_type: int) -> bool:
	for entry in port.get_method_list():
		if entry["name"] == method_name:
			if entry["args"].size() != argument_types.size() or not entry["default_args"].is_empty() or entry["return"]["type"] != return_type:
				return false
			for index in range(argument_types.size()):
				if entry["args"][index]["type"] != TYPE_NIL and entry["args"][index]["type"] != argument_types[index]:
					return false
			return true
	return false

func _ready() -> void:
	set_physics_process(false)
	if not resume_event.is_empty() and resume_event == pause_event:
		_fail("Resume and pause events must have different names; leave either empty to disable it.")
		return
	if not instance_id.is_empty():
		var pattern := RegEx.new()
		pattern.compile("^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
		if instance_id.length() != 36 or pattern.search(instance_id) == null:
			_fail("The optional event payload filter must be an instance UUID.")
			return
	if not has_meta("viento_project") or not has_meta("viento_platform_control"):
		_fail("Bind this script to a declared moving platform in a project run.")
		return
	var project = get_meta("viento_project")
	var platform = get_meta("viento_platform_control")
	if not _object_valid(project) or not _port_method(project, "subscribe_event", [TYPE_STRING, TYPE_CALLABLE], TYPE_INT) or not _port_method(project, "unsubscribe_event", [TYPE_INT], TYPE_BOOL):
		_fail("The project event port is unavailable or has an unsupported contract.")
		return
	if not _object_valid(platform) or not _port_method(platform, "protocol_version", [], TYPE_INT) or not _port_method(platform, "request_running", [TYPE_BOOL], TYPE_BOOL) or not _port_method(platform, "read_running", [], TYPE_NIL):
		_fail("The platform control port is unavailable or has an unsupported contract.")
		return
	var version = platform.protocol_version()
	if typeof(version) != TYPE_INT or version != 1:
		_fail("The platform control port has an unsupported protocol version.")
		return
	if typeof(platform.read_running()) != TYPE_BOOL:
		_fail("The platform control port is not active.")
		return
	_project = project
	_platform = platform
	if not resume_event.is_empty():
		var subscription = _project.subscribe_event(resume_event, _on_resume)
		if typeof(subscription) != TYPE_INT or subscription <= 0:
			_fail("Cannot subscribe to the platform resume event.")
			return
		_resume_subscription = subscription
	if not pause_event.is_empty():
		var subscription = _project.subscribe_event(pause_event, _on_pause)
		if typeof(subscription) != TYPE_INT or subscription <= 0:
			_fail("Cannot subscribe to the platform pause event.")
			return
		_pause_subscription = subscription
	_request(initial_running)

func _request(running: bool) -> bool:
	_desired_running = running
	return _flush_request()

func _flush_request() -> bool:
	if _desired_running == null:
		set_physics_process(false)
		return true
	if not _object_valid(_project) or not _object_valid(_platform) or typeof(_platform.read_running()) != TYPE_BOOL:
		_fail("The platform control port is no longer active.")
		return false
	var accepted = _platform.request_running(_desired_running)
	if typeof(accepted) != TYPE_BOOL:
		_fail("The platform control port returned an unsupported result.")
		return false
	# The native port accepts the first request in each project intake step.
	# Keep only the latest author intent until a request is accepted; the
	# currently applied state cannot prove an older queued request is absent.
	if accepted:
		_desired_running = null
	set_physics_process(_desired_running != null)
	return true

func _physics_process(_delta: float) -> void:
	_flush_request()

func _event(value, running: bool) -> bool:
	if not instance_id.is_empty() and (typeof(value) != TYPE_STRING or value != instance_id):
		return true
	return _request(running)

func _on_resume(value) -> bool:
	return _event(value, true)

func _on_pause(value) -> bool:
	return _event(value, false)

func _disconnect() -> void:
	var project = _project
	var subscriptions := [_resume_subscription, _pause_subscription]
	_project = null
	_platform = null
	_resume_subscription = 0
	_pause_subscription = 0
	_desired_running = null
	set_physics_process(false)
	if _object_valid(project):
		for subscription in subscriptions:
			if subscription != 0:
				project.unsubscribe_event(subscription)

func _fail(message: String) -> void:
	_disconnect()
	push_error("Platform control: " + message)

func _exit_tree() -> void:
	_disconnect()
