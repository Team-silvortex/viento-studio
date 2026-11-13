extends "res://retry-project-runtime.gd"

# Restart is a separate visit-bound port. The inherited retry transaction owns
# the overlay and lifecycle; original navigation and retry ports retain theirs.
class RestartPort extends RefCounted:
	var host: WeakRef
	func _init(owner: Node) -> void:
		host = weakref(owner)
	func request_restart(initial_values: Dictionary = {}) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.restart_request(self, initial_values)

var restart_ports: Dictionary = {}

func make_port(visit: int, binding: Dictionary, instance: Node) -> RefCounted:
	var original = super.make_port(visit, binding, instance)
	var port := RestartPort.new(self)
	restart_ports[port.get_instance_id()] = {"port": weakref(port), "visit": visit, "binding": binding.duplicate(true), "behavior": weakref(instance)}
	instance.set_meta("viento_project_restart", port)
	return original

func restart_request(port, initial_values: Dictionary) -> bool:
	if not is_instance_valid(port):
		return false
	var record = restart_ports.get(port.get_instance_id())
	if record == null or record["port"].get_ref() != port or not state_access(record["visit"]) or not is_instance_valid(record["behavior"].get_ref()):
		return false
	# A restart consumes one ordinary visit in this session, never a new session
	# or admission ledger. Refusals change neither pending work nor shared state.
	if finish_requested or not pending_scene.is_empty() or not retry_pending.is_empty() or not members.has(current_scene) or visit_index >= 64:
		return false
	if initial_values.size() > 16:
		return false
	var values: Dictionary = {}
	for key in initial_values:
		var value = initial_values[key]
		if not state_key_valid(key) or state_value_bytes(value) < 0:
			return false
		values[key] = 0 if typeof(value) in [TYPE_INT, TYPE_FLOAT] and value == 0 else value
	var candidate := shared_state.duplicate()
	candidate.merge(values, true)
	if not super.state_candidate_valid(candidate):
		return false
	var used = execution_budget.snapshot()
	if values.size() > 1024 - used["stateMutations"] or not execution_budget.reserve({"stateMutations": values.size()}):
		return false
	# No author callback runs between reservation and publishing this transaction.
	# The existing flush drains old work, applies the overlay atomically, revokes
	# this visit, and instantiates the same member with a fresh visit identity.
	retry_pending = {"visit": record["visit"], "binding": record["binding"].duplicate(true), "target": current_scene, "values": values}
	pending_scene = current_scene
	schedule_flush()
	return true

func leave_scene(reason: String, next_scene: String = "") -> void:
	super.leave_scene(reason, next_scene)
	restart_ports.clear()

func abort_project() -> void:
	restart_ports.clear()
	super.abort_project()
