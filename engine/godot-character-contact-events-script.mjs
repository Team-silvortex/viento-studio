// Ordinary author source: native movement contacts become bounded project events.
export const GODOT_CHARACTER_CONTACT_EVENTS_SCRIPT = `extends Node

@export var started_event: String = "physics.contact_started"
@export var ended_event: String = "physics.contact_ended"
@export var other_instance_id: String = ""
var _project
var _contacts
var _instance_id: String = ""
var _started_connected := false
var _ended_connected := false

func _object_valid(value) -> bool:
	return typeof(value) == TYPE_OBJECT and is_instance_valid(value)

func _uuid_valid(value) -> bool:
	if typeof(value) != TYPE_STRING or value.length() != 36:
		return false
	var pattern := RegEx.new()
	pattern.compile("^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
	return pattern.search(value) != null

func _contact_signal(port, name: String) -> bool:
	for entry in port.get_signal_list():
		if entry["name"] == name:
			var arguments: Array = entry["args"]
			return arguments.size() == 2 and arguments[0]["type"] == TYPE_STRING and arguments[1]["type"] == TYPE_STRING
	return false

func _ready() -> void:
	if not has_meta("viento_project") or not has_meta("viento_character_contacts") or not has_meta("viento_instance_id"):
		_fail("Bind this script to a character with supported 2D collision movement in a project run.")
		return
	var project = get_meta("viento_project")
	var contacts = get_meta("viento_character_contacts")
	var instance_id = get_meta("viento_instance_id")
	if not _object_valid(project) or not project.has_method("publish_event"):
		_fail("The project event port is unavailable.")
		return
	if not _object_valid(contacts) or not contacts.has_method("protocol_version"):
		_fail("The character contact event port is unavailable.")
		return
	var version = contacts.protocol_version()
	if typeof(version) != TYPE_INT or version != 1 or not _contact_signal(contacts, "started") or not _contact_signal(contacts, "ended"):
		_fail("The character contact event port has an unsupported contract.")
		return
	if not _uuid_valid(instance_id):
		_fail("The behavior instance identity is unavailable.")
		return
	if not other_instance_id.is_empty() and not _uuid_valid(other_instance_id):
		_fail("other_instance_id must be empty or a valid instance UUID.")
		return
	_project = project
	_contacts = contacts
	_instance_id = instance_id
	if not started_event.is_empty():
		if _contacts.connect("started", _on_started) != OK:
			_fail("Cannot subscribe to the character contact start event.")
			return
		_started_connected = true
	if not ended_event.is_empty():
		if _contacts.connect("ended", _on_ended) != OK:
			_fail("Cannot subscribe to the character contact end event.")
			return
		_ended_connected = true

func _publish(name: String, body_id, instance_id) -> void:
	if name.is_empty():
		return
	if not _uuid_valid(body_id) or not _uuid_valid(instance_id) or instance_id == _instance_id:
		_fail("The character contact event contains an invalid other-body identity.")
		return
	if not other_instance_id.is_empty() and other_instance_id != instance_id:
		return
	if not _object_valid(_project):
		_fail("The project event port is no longer available.")
		return
	var accepted = _project.publish_event(name, instance_id)
	if typeof(accepted) != TYPE_BOOL or not accepted:
		_fail("The project rejected the character contact event.")

func _on_started(body_id, instance_id) -> void:
	_publish(started_event, body_id, instance_id)

func _on_ended(body_id, instance_id) -> void:
	_publish(ended_event, body_id, instance_id)

func _disconnect() -> void:
	var contacts = _contacts
	_contacts = null
	_project = null
	_instance_id = ""
	if _object_valid(contacts):
		if _started_connected and contacts.is_connected("started", _on_started):
			contacts.disconnect("started", _on_started)
		if _ended_connected and contacts.is_connected("ended", _on_ended):
			contacts.disconnect("ended", _on_ended)
	_started_connected = false
	_ended_connected = false

func _fail(message: String) -> void:
	_disconnect()
	push_error("Character contact events: " + message)

func _exit_tree() -> void:
	_disconnect()
`;
