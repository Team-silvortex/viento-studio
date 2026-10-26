extends RefCounted

const ContactPort = preload("res://movement-contacts-port.gd")
var ports: Dictionary = {}
var previous: Dictionary = {}
var current: Dictionary = {}
var opened := true
var stepping := false
var flushing := false

func active(scene: Node) -> bool:
	return opened and scene.project_open and not scene.physics_failed and scene.project_host.state_access(scene.project_visit)

# The existing behavior factory calls this before add_child and author _ready.
func attach(scene: Node, binding: Dictionary, behavior: Node) -> void:
	var instance_id: String = binding["instanceId"]
	if not opened or scene.physics_bodies.get(instance_id) != "character":
		return
	var port = ContactPort.new()
	if not ports.has(instance_id):
		ports[instance_id] = []
	ports[instance_id].append({"port": port, "behavior": weakref(behavior)})
	behavior.set_meta("viento_character_contacts", port)

func begin(scene: Node) -> void:
	current.clear()
	stepping = active(scene)

func sample(scene: Node, character: CharacterBody2D, contacts: Array) -> void:
	if not stepping or not active(scene):
		return
	var owner_id := ""
	for actor in scene.actors:
		if actor["node"] == character and scene.physics_bodies.get(actor["instanceId"]) == "character":
			owner_id = actor["instanceId"]
			break
	if owner_id.is_empty():
		return
	if not current.has(owner_id):
		current[owner_id] = {}
	# The existing contact formatter matches actual actor nodes, not metadata.
	# Null identity means an undeclared collider; it has no author-facing edge.
	for contact in contacts:
		var collider = contact.get("collider")
		if not collider is Dictionary:
			continue
		var body_id: String = collider["bodyId"]
		var instance_id: String = collider["instanceId"]
		var declaration: Dictionary = scene.physics_observation_bodies.get(instance_id, {})
		if declaration.get("id") != body_id or declaration.get("kind") == "sensor" or instance_id == owner_id:
			continue
		current[owner_id][body_id + ":" + instance_id] = {"ownerId": owner_id, "bodyId": body_id, "instanceId": instance_id}

func ordered(a: Dictionary, b: Dictionary) -> bool:
	if a["bodyId"] != b["bodyId"]:
		return a["bodyId"] < b["bodyId"]
	if a["instanceId"] != b["instanceId"]:
		return a["instanceId"] < b["instanceId"]
	return a["ownerId"] < b["ownerId"]

# Legacy jumped/landed callbacks have finished. Compare the complete movement
# result, publish removals before additions, and never reenter the solver.
func finish(scene: Node) -> void:
	stepping = false
	if not active(scene):
		current.clear()
		return
	var ended: Array = []
	var started: Array = []
	for owner_id in scene.physics_bodies:
		if scene.physics_bodies[owner_id] != "character":
			continue
		var before: Dictionary = previous.get(owner_id, {})
		var after: Dictionary = current.get(owner_id, {})
		for key in before:
			if not after.has(key):
				ended.append(before[key])
		for key in after:
			if not before.has(key):
				started.append(after[key])
	previous = current
	current = {}
	ended.sort_custom(ordered)
	started.sort_custom(ordered)
	flushing = true
	for group in [{"signal": "ended", "facts": ended}, {"signal": "started", "facts": started}]:
		for fact in group["facts"]:
			if not active(scene):
				break
			for record in ports.get(fact["ownerId"], []):
				if not active(scene):
					break
				var behavior = record["behavior"].get_ref()
				if not is_instance_valid(behavior) or not behavior.is_inside_tree():
					continue
				record["port"].emit_signal(group["signal"], fact["bodyId"], fact["instanceId"])
	flushing = false

func revoke() -> void:
	opened = false
	stepping = false
	current.clear()
	previous.clear()
	for records in ports.values():
		for record in records:
			var port = record["port"]
			for signal_name in ["started", "ended"]:
				for connection in port.get_signal_connection_list(signal_name):
					port.disconnect(signal_name, connection["callable"])
	ports.clear()
