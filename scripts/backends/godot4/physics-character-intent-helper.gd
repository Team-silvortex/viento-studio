extends RefCounted

const IntentPort = preload("res://character-intent-port.gd")
var host: WeakRef
var opened := true
var tokens := 0
var records: Dictionary = {}
var pending: Dictionary = {}
var current: Dictionary = {}

func active(scene: Node) -> bool:
	return opened and is_instance_valid(scene) and scene.project_open and not scene.physics_failed and scene.project_host.state_access(scene.project_visit)

func attach(scene: Node, binding: Dictionary, behavior: Node) -> void:
	var id: String = binding["instanceId"]
	var motors = scene.get("character_motion_configs")
	if not opened or not motors is Dictionary or not motors.has(id):
		return
	for actor in scene.actors:
		if actor["instanceId"] == id and actor["controls"] == "none":
			tokens += 1
			host = weakref(scene)
			records[tokens] = {"instanceId": id, "behavior": weakref(behavior)}
			behavior.set_meta("viento_character_intent", IntentPort.new(self, tokens))
			return

func live(token: int) -> bool:
	if not records.has(token):
		return false
	var node = records[token]["behavior"].get_ref()
	return is_instance_valid(node) and node.is_inside_tree() and not node.is_queued_for_deletion()

func submit(token: int, axis, jump) -> bool:
	var scene = host.get_ref() if host != null else null
	if not active(scene) or not scene.can_process() or not live(token):
		return false
	if typeof(axis) not in [TYPE_INT, TYPE_FLOAT] or typeof(jump) != TYPE_BOOL:
		return false
	var value := float(axis)
	if not is_finite(value) or value < -1.0 or value > 1.0:
		return false
	var id: String = records[token]["instanceId"]
	if pending.has(id) and not live(pending[id]["token"]):
		pending.erase(id)
	if pending.has(id):
		return false
	pending[id] = {"token": token, "axis": value, "jump": jump}
	return true

func begin(scene: Node) -> void:
	current.clear()
	if not active(scene):
		pending.clear()
		return
	var requests := pending
	pending = {}
	for id in requests:
		var request: Dictionary = requests[id]
		if live(request["token"]):
			current[id] = {"axis": request["axis"], "jump": request["jump"]}

func take(id: String) -> Dictionary:
	return current.get(id, {"axis": 0.0, "jump": false})

func revoke() -> void:
	opened = false
	pending.clear()
	current.clear()
	records.clear()
