extends "__SCENE_RUNTIME__"

const CharacterEventsPort = preload("res://character-events-port.gd")
var character_events_ports: Dictionary = {}
var character_events_pending: Array = []
var character_events_open := true
var character_events_stepping := false
var character_events_flushing := false

# The inherited behavior factory calls this before add_child and author _ready.
# Keep the existing project/animation port and attach a separate native API.
func project_behavior_port(binding: Dictionary, instance: Node) -> RefCounted:
	var project_port := super.project_behavior_port(binding, instance)
	var instance_id: String = binding["instanceId"]
	if character_events_open and character_motion_configs.has(instance_id):
		var port = CharacterEventsPort.new()
		if not character_events_ports.has(instance_id):
			character_events_ports[instance_id] = []
		character_events_ports[instance_id].append({"port": port, "behavior": weakref(instance)})
		instance.set_meta("viento_character_motion", port)
	return project_port

# These two hooks occur inside the unchanged movement decisions. No input,
# trace frame, collision query or second integration is used to infer a fact.
func character_events_jump(instance_id: String) -> void:
	if character_events_stepping and character_events_open and character_events_ports.has(instance_id):
		character_events_pending.append({"instanceId": instance_id, "kind": "jumped"})

func character_events_ground(instance_id: String, was_grounded: bool, grounded: bool) -> void:
	if character_events_stepping and character_events_open and not was_grounded and grounded and character_events_ports.has(instance_id):
		character_events_pending.append({"instanceId": instance_id, "kind": "landed"})

func project_step(delta: float) -> void:
	if not character_events_open or not project_open or character_events_stepping or character_events_flushing:
		return
	character_events_pending.clear()
	character_events_stepping = true
	super.project_step(delta)
	character_events_stepping = false
	# All actor moves and inherited animation/audio updates finish before author
	# callbacks can publish events or request a different scene.
	var facts := character_events_pending
	character_events_pending = []
	character_events_flushing = true
	for fact in facts:
		if not character_events_open or physics_failed or not project_host.state_access(project_visit):
			break
		for record in character_events_ports.get(fact["instanceId"], []):
			if not character_events_open or not project_host.state_access(project_visit):
				break
			var behavior = record["behavior"].get_ref()
			if not is_instance_valid(behavior) or not behavior.is_inside_tree():
				continue
			var port = record["port"]
			if fact["kind"] == "jumped":
				port.jumped.emit()
			else:
				port.landed.emit()
	character_events_flushing = false

func character_events_revoke() -> void:
	character_events_open = false
	character_events_pending.clear()
	for records in character_events_ports.values():
		for record in records:
			var port = record["port"]
			for signal_name in ["jumped", "landed"]:
				for connection in port.get_signal_connection_list(signal_name):
					port.disconnect(signal_name, connection["callable"])
	character_events_ports.clear()

func project_close(silent: bool = false) -> void:
	character_events_revoke()
	super.project_close(silent)

func _ready() -> void:
	tree_exiting.connect(character_events_revoke)
	super._ready()
