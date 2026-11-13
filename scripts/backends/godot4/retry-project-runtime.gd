extends "res://__RETRY_PROJECT_BASE__"

# This separate port preserves every original project/animation port identity.
# It accepts a bounded state overlay and a different member scene as one visit
# transaction. Session admission counters and business sequences never reset.
class RetryPort extends RefCounted:
	var host: WeakRef
	func _init(owner: Node) -> void:
		host = weakref(owner)
	func request_retry(target_scene_id: String, initial_values: Dictionary = {}) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.retry_request(self, target_scene_id, initial_values)

var retry_ports: Dictionary = {}
var retry_pending: Dictionary = {}

func make_port(visit: int, binding: Dictionary, instance: Node) -> RefCounted:
	var original = super.make_port(visit, binding, instance)
	var port := RetryPort.new(self)
	retry_ports[port.get_instance_id()] = {"port": weakref(port), "visit": visit, "binding": binding.duplicate(true), "behavior": weakref(instance)}
	instance.set_meta("viento_project_retry", port)
	return original

func retry_request(port, target_scene_id: String, initial_values: Dictionary) -> bool:
	if not is_instance_valid(port):
		return false
	var record = retry_ports.get(port.get_instance_id())
	if record == null or record["port"].get_ref() != port or not state_access(record["visit"]) or not is_instance_valid(record["behavior"].get_ref()):
		return false
	# Competition and shutdown are ordinary refusals, before any validation or
	# reservation. A failed request never changes state or pending navigation.
	if finish_requested or not pending_scene.is_empty() or not retry_pending.is_empty() or target_scene_id == current_scene or not members.has(target_scene_id) or visit_index >= 64:
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
	if values.size() > 1024 - used["stateMutations"]:
		return false
	if not super.request_scene(record["visit"], record["binding"], target_scene_id):
		return false
	# No author callback runs between the capacity check and this reservation.
	# Keep rollback explicit if an unavailable ledger nevertheless refuses it.
	if not execution_budget.reserve({"stateMutations": values.size()}):
		pending_scene = ""
		return false
	retry_pending = {"visit": record["visit"], "binding": record["binding"].duplicate(true), "target": target_scene_id, "values": values}
	return true

func state_candidate_valid(candidate: Dictionary) -> bool:
	if not super.state_candidate_valid(candidate):
		return false
	if retry_pending.is_empty():
		return true
	# Already reserved mutation capacity belongs to the retry. Later old-visit
	# writes still use the original ledger and must also leave a valid overlay.
	var merged := candidate.duplicate()
	merged.merge(retry_pending["values"], true)
	return super.state_candidate_valid(merged)

func leave_scene(reason: String, next_scene: String = "") -> void:
	var retry := retry_pending
	retry_pending = {}
	if reason == "switch" and not failed and not finished and not finish_requested and not retry.is_empty() and retry["visit"] == visit_index and retry["target"] == next_scene:
		var values: Dictionary = retry["values"]
		var keys: Array = values.keys()
		keys.sort()
		var changed: Array = []
		var candidate := shared_state.duplicate()
		for key in keys:
			if not shared_state.has(key) or not state_same(shared_state[key], values[key]):
				changed.push_back(key)
			candidate[key] = values[key]
		# No author callback can observe an intermediate subset of this overlay.
		shared_state = candidate
		var binding: Dictionary = retry["binding"]
		for key in changed:
			state_revision += 1
			project_emit("state", {"visitIndex": visit_index, "sceneId": current_scene, "bindingId": binding["bindingId"],
				"instanceId": binding["instanceId"], "objectId": binding["objectId"], "revision": state_revision,
				"operation": "set", "key": key, "value": values[key]})
	super.leave_scene(reason, next_scene)
	retry_ports.clear()

func abort_project() -> void:
	retry_pending.clear()
	retry_ports.clear()
	super.abort_project()
