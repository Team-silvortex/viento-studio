extends RefCounted

const IntentPort = preload("res://planar-intent-port.gd")
var eligible: Dictionary = {}
var host: WeakRef
var visit := -1
var opened := true
var records: Dictionary = {}
var pending: Dictionary = {}
var current: Dictionary = {}

func _init(instance_ids: Array) -> void:
	for id in instance_ids:
		eligible[id] = true

func visit_active(scene: Node) -> bool:
	return opened and is_instance_valid(scene) and scene.is_inside_tree() and not scene.is_queued_for_deletion() and scene.project_open and not scene.physics_failed and scene.project_host.state_access(scene.project_visit)

func active(scene: Node) -> bool:
	return visit_active(scene) and scene.project_host.pending_scene.is_empty()

func attach(scene: Node, binding: Dictionary, behavior: Node) -> void:
	var id: String = binding["instanceId"]
	if not visit_active(scene) or not eligible.has(id) or scene.physics_bodies.get(id) != "character":
		return
	var motors = scene.get("character_motion_configs")
	if motors is Dictionary and motors.has(id):
		return
	for actor in scene.actors:
		if actor["instanceId"] == id and actor["controls"] == "none" and actor["node"] is CharacterBody2D:
			host = weakref(scene)
			visit = scene.project_visit
			var port = IntentPort.new(self)
			records[port.get_instance_id()] = {"port": weakref(port), "instanceId": id, "behavior": weakref(behavior), "character": weakref(actor["node"])}
			behavior.set_meta("viento_planar_intent", port)
			return

func record(port) -> Variant:
	var scene = host.get_ref() if host != null else null
	if not active(scene) or scene.project_visit != visit or not is_instance_valid(port):
		return null
	var value = records.get(port.get_instance_id())
	if value == null or value["port"].get_ref() != port:
		return null
	var behavior = value["behavior"].get_ref()
	var character = value["character"].get_ref()
	if not is_instance_valid(behavior) or not behavior.is_inside_tree() or behavior.is_queued_for_deletion() or not is_instance_valid(character) or not character.is_inside_tree() or character.is_queued_for_deletion() or behavior.get_parent() != character:
		return null
	for actor in scene.actors:
		if actor["instanceId"] == value["instanceId"] and actor["node"] == character and actor["controls"] == "none":
			return value
	return null

func submit(port, x, y) -> bool:
	var value = record(port)
	var scene = host.get_ref() if host != null else null
	if value == null or not scene.can_process():
		return false
	if typeof(x) not in [TYPE_INT, TYPE_FLOAT] or typeof(y) not in [TYPE_INT, TYPE_FLOAT]:
		return false
	if not is_finite(float(x)) or not is_finite(float(y)) or absf(float(x)) > 1.0 or absf(float(y)) > 1.0:
		return false
	var id: String = value["instanceId"]
	if pending.has(id):
		var previous = pending[id]["port"].get_ref()
		if previous != null and record(previous) != null:
			return false
	pending[id] = {"port": weakref(port), "direction": Vector2(float(x), float(y))}
	return true

func begin(scene: Node) -> bool:
	current.clear()
	if not active(scene):
		pending.clear()
		return false
	if not scene.can_process():
		return false
	var requests := pending
	pending = {}
	for id in requests:
		var request: Dictionary = requests[id]
		var port = request["port"].get_ref()
		if port != null and record(port) != null:
			# Components are admitted independently. Normalize only the consumed
			# direction; shorter analog vectors retain their original strength.
			current[id] = request["direction"].limit_length(1.0)
	return true

func take(instance_id: String) -> Vector2:
	return current.get(instance_id, Vector2.ZERO)

func revoke() -> void:
	opened = false
	pending.clear()
	current.clear()
	records.clear()
	host = null
	visit = -1
