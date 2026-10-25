// Ordinary author source: no ready-time publication, playback or resource IO.
export const GODOT_PROJECT_EVENT_AUDIO_SCRIPT = `extends Node

@export var event_name: String = "physics.landed"
@export var track_id: String = ""
@export var instance_id: String = ""
var _project
var _subscription: int = 0

func _object_valid(value) -> bool:
	return typeof(value) == TYPE_OBJECT and is_instance_valid(value)

func _uuid(value: String) -> bool:
	var pattern := RegEx.new()
	pattern.compile("^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
	return value.length() == 36 and pattern.search(value) != null

func _ready() -> void:
	if event_name.is_empty() or not _uuid(track_id) or (not instance_id.is_empty() and not _uuid(instance_id)):
		_fail("Choose an event name, a declared track UUID and an optional instance UUID.")
		return
	if not has_meta("viento_project"):
		_fail("Bind this script in a project run with a declared audio track.")
		return
	var project = get_meta("viento_project")
	if not _object_valid(project):
		_fail("The project event and audio port is unavailable.")
		return
	for method in ["subscribe_event", "unsubscribe_event", "play_audio"]:
		if not project.has_method(method):
			_fail("The project event and audio port has an unsupported contract.")
			return
	_project = project
	var subscription = _project.subscribe_event(event_name, _on_event)
	if typeof(subscription) != TYPE_INT or subscription <= 0:
		_fail("Cannot subscribe to the requested project event.")
		return
	_subscription = subscription

func _on_event(value) -> bool:
	if _subscription == 0 or not _object_valid(_project):
		_fail("The project event subscription is no longer available.")
		return false
	if not instance_id.is_empty() and (typeof(value) != TYPE_STRING or value != instance_id):
		return true
	var accepted = _project.play_audio(track_id)
	if typeof(accepted) != TYPE_BOOL or not accepted:
		_fail("The project rejected the requested audio track.")
		return false
	return true

func _disconnect() -> void:
	var project = _project
	var subscription := _subscription
	_project = null
	_subscription = 0
	if subscription != 0 and _object_valid(project) and project.has_method("unsubscribe_event"):
		project.unsubscribe_event(subscription)

func _fail(message: String) -> void:
	_disconnect()
	push_error("Project event audio: " + message)

func _exit_tree() -> void:
	_disconnect()
`;
