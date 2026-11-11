// Ordinary author source. Native Area2D callbacks supply actual body objects;
// UUID metadata selects eligible scene bodies, not a registration authenticator.
export const GODOT_PHYSICS_SENSOR_OCCUPANCY_SCRIPT = `extends Node

@export var occupied_event: String = "physics.occupied"
@export var vacant_event: String = "physics.vacant"
var _project
var _area: Area2D
var _instance_id: String = ""
var _occupants: Dictionary = {}
var _opened := false
var _initializing := false
var _dirty := false
var _flush_scheduled := false
var _announced_occupied := false

func _object_valid(value) -> bool:
	return typeof(value) == TYPE_OBJECT and is_instance_valid(value)

func _uuid_valid(value) -> bool:
	if typeof(value) != TYPE_STRING or value.length() != 36:
		return false
	var pattern := RegEx.new()
	pattern.compile("^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
	return pattern.search(value) != null

func _publish_port(port) -> bool:
	for method in port.get_method_list():
		if method["name"] == "publish_event":
			if method["args"].size() != 2 or not method["default_args"].is_empty() or method["return"]["type"] != TYPE_BOOL:
				return false
			for argument in method["args"]:
				if argument["type"] != TYPE_NIL and argument["type"] != TYPE_STRING:
					return false
			return true
	return false

func _ready() -> void:
	_disconnect()
	if not occupied_event.is_empty() and occupied_event == vacant_event:
		_fail("Occupied and vacant events must have different names; leave either empty to disable it.")
		return
	if not get_parent() is Area2D or not has_meta("viento_project") or not has_meta("viento_instance_id"):
		_fail("Bind this script to a physical trigger-area instance in a project run.")
		return
	var project = get_meta("viento_project")
	var instance_id = get_meta("viento_instance_id")
	if not _object_valid(project) or not _publish_port(project):
		_fail("The project event port is unavailable or has an unsupported contract.")
		return
	if not _uuid_valid(instance_id):
		_fail("The trigger-area instance identity is unavailable.")
		return
	_project = project
	_area = get_parent() as Area2D
	_instance_id = instance_id
	_opened = true
	if _area.connect("body_entered", _body_entered) != OK or _area.connect("body_exited", _body_exited) != OK:
		_fail("Cannot subscribe to the trigger-area body events.")
		return
	# Wait until the scene's ordinary behaviors have all subscribed. Fresh areas
	# report initial overlaps at their next native physics update as usual.
	_initializing = true
	call_deferred("_initialize_occupancy")

func _initialize_occupancy() -> void:
	if not _opened or not is_instance_valid(_area):
		return
	_initializing = false
	for body in _area.get_overlapping_bodies():
		_body_entered(body)
	_schedule_flush()

func _body_entered(body) -> void:
	if not _opened or not _object_valid(body) or not body is PhysicsBody2D or not body.is_inside_tree() or body.is_queued_for_deletion():
		return
	if not body.has_meta("viento_instance_id") or not _uuid_valid(body.get_meta("viento_instance_id")):
		return
	# Use the actual native object, never UUID metadata, as occupancy identity.
	var key: int = body.get_instance_id()
	if _occupants.has(key):
		return
	var leaving := _body_leaving.bind(key)
	if body.connect("tree_exiting", leaving) != OK:
		_fail("Cannot track an occupying body's lifetime.")
		return
	_occupants[key] = {"body": weakref(body), "leaving": leaving}
	_schedule_flush()

func _body_exited(body) -> void:
	if _object_valid(body):
		_remove_occupant(body.get_instance_id())

func _body_leaving(key: int) -> void:
	_remove_occupant(key)

func _remove_occupant(key: int) -> void:
	if not _opened or not _occupants.has(key):
		return
	var record: Dictionary = _occupants[key]
	_occupants.erase(key)
	var body = record["body"].get_ref()
	if _object_valid(body) and body.is_connected("tree_exiting", record["leaving"]):
		body.disconnect("tree_exiting", record["leaving"])
	_schedule_flush()

func _schedule_flush() -> void:
	if not _opened:
		return
	_dirty = true
	set_physics_process(true)
	if not _flush_scheduled:
		_flush_scheduled = true
		call_deferred("_flush_occupancy")

func _physics_process(_delta: float) -> void:
	if _dirty:
		_flush_occupancy()

func _flush_occupancy() -> void:
	_flush_scheduled = false
	if not _opened or _initializing or not can_process():
		return
	_dirty = false
	set_physics_process(false)
	var occupied := not _occupants.is_empty()
	if occupied == _announced_occupied:
		return
	# Coalesce native callbacks in this dispatch turn. Paused/disabled behaviors
	# retain the final state for their next enabled physics callback; closing
	# revokes it in _exit_tree instead of inventing a vacant event.
	var name: String = occupied_event if occupied else vacant_event
	if name.is_empty():
		_announced_occupied = occupied
		return
	if not _object_valid(_project):
		_fail("The project event port is no longer available.")
		return
	var accepted = _project.publish_event(name, _instance_id)
	if typeof(accepted) != TYPE_BOOL or not accepted:
		_fail("The project rejected the trigger-area occupancy event.")
		return
	_announced_occupied = occupied

func _disconnect() -> void:
	_opened = false
	_initializing = false
	_dirty = false
	_flush_scheduled = false
	_announced_occupied = false
	set_physics_process(false)
	if is_instance_valid(_area):
		if _area.is_connected("body_entered", _body_entered):
			_area.disconnect("body_entered", _body_entered)
		if _area.is_connected("body_exited", _body_exited):
			_area.disconnect("body_exited", _body_exited)
	for record in _occupants.values():
		var body = record["body"].get_ref()
		if _object_valid(body) and body.is_connected("tree_exiting", record["leaving"]):
			body.disconnect("tree_exiting", record["leaving"])
	_occupants.clear()
	_project = null
	_area = null
	_instance_id = ""

func _fail(message: String) -> void:
	_disconnect()
	push_error("Sensor occupancy: " + message)

func _exit_tree() -> void:
	_disconnect()
`;
