extends "res://project-animation-state-trigger-runtime.gd"

# The outer protocol layer selects scoped queues before the first author _ready.
# All existing source wrappers, event scopes and state snapshots remain intact.
var animation_target_queues_ready := false
var animation_target_bindings: Dictionary = {}
var animation_target_ports: Dictionary = {}

# Resolve the original port object before reading its public compatibility fields.
# This is origin ownership for the public API, not a sandbox for author GDScript.
class TargetScenePort extends CompletionScenePort:
	func play_animation() -> bool:
		var owner = host.get_ref()
		return owner != null and owner.animation_port_command(self, {"action": "play"})
	func pause_animation() -> bool:
		var owner = host.get_ref()
		return owner != null and owner.animation_port_command(self, {"action": "pause"})
	func stop_animation() -> bool:
		var owner = host.get_ref()
		return owner != null and owner.animation_port_command(self, {"action": "stop"})
	func seek_animation(seconds) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.animation_port_command(self, {"action": "seek", "positionSeconds": seconds})
	func select_animation_clip(clip_id = null) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.animation_port_command(self, {"action": "select", "clipId": clip_id})
	func subscribe_animation_completed(callback) -> int:
		var owner = host.get_ref()
		return owner.animation_port_subscribe(self, callback) if owner != null else 0
	func unsubscribe_animation_completed(id) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.animation_port_unsubscribe(self, id)

class TargetStateScenePort extends TargetScenePort:
	func record_animation_state_entry() -> void:
		var owner = host.get_ref()
		if owner != null:
			owner.animation_port_entered(self)
	func record_animation_state_entry_trigger(kind: String, event_name: String = "") -> void:
		var owner = host.get_ref()
		if owner != null:
			owner.animation_port_entered(self, kind, event_name)

func enter_scene(scene_id: String) -> void:
	if not animation_target_queues_ready:
		animation_control = preload("res://project-animation-targets.gd").new(self)
		animation_completions = preload("res://project-animation-target-completions.gd").new(self)
		animation_target_queues_ready = true
	animation_target_bindings.clear()
	animation_target_ports.clear()
	super.enter_scene(scene_id)

func make_port(visit: int, binding: Dictionary, instance: Node) -> RefCounted:
	# Preserve the ancestor's recognized state-controller instance registration.
	super.make_port(visit, binding, instance)
	var port = TargetStateScenePort.new(self, visit, binding, instance) if animation_state_controller(binding) != null else TargetScenePort.new(self, visit, binding, instance)
	# The validated manifest declaration and actual object identity own this port.
	animation_target_bindings[binding["bindingId"]] = binding.duplicate(true)
	animation_target_ports[port.get_instance_id()] = {"port": weakref(port), "visit": visit, "binding": binding.duplicate(true), "behavior": weakref(instance)}
	return port

func animation_port_record(port):
	if not is_instance_valid(port):
		return null
	var record = animation_target_ports.get(port.get_instance_id())
	if record == null or record["port"].get_ref() != port or not state_access(record["visit"]):
		return null
	var instance = record["behavior"].get_ref()
	if not is_instance_valid(instance):
		return null
	if port.visit_index != record["visit"] or port.binding != record["binding"] or port.behavior.get_ref() != instance:
		state_fail(record["binding"], "runtime_behavior_animation_missing", "Animation port fields differ from its registered origin.")
		return null
	return record

func animation_port_command(port, command: Dictionary) -> bool:
	var record = animation_port_record(port)
	return record != null and animation_control.request(record["visit"], record["binding"], command)

func animation_port_subscribe(port, callback) -> int:
	var record = animation_port_record(port)
	return animation_completions.subscribe(record["visit"], record["binding"], record["behavior"].get_ref(), callback) if record != null else 0

func animation_port_unsubscribe(port, id) -> bool:
	var record = animation_port_record(port)
	return record != null and animation_completions.unsubscribe(record["visit"], record["binding"], id)

func animation_port_entered(port, kind: String = "direct", event_name: String = "") -> void:
	var record = animation_port_record(port)
	if record != null:
		animation_state_entered_with_trigger(record["visit"], record["binding"], record["behavior"].get_ref(), kind, event_name)

func animation_target(visit: int, binding: Dictionary):
	if not state_access(visit) or not animation_target_bindings.has(binding.get("bindingId")):
		return null
	var declaration: Dictionary = animation_target_bindings[binding["bindingId"]]
	if declaration != binding or not current.project_animation_declared():
		return null
	return current.project_animation_target_for_instance(declaration["instanceId"])

func animation_target_missing(visit: int, binding: Dictionary) -> bool:
	if not state_access(visit):
		return false
	var declaration = animation_target_bindings.get(binding.get("bindingId"))
	if declaration == null:
		return false
	# Report the registered source, not fields a caller has already changed.
	return state_fail(declaration, "runtime_behavior_animation_missing", "This registered binding has no declared animation target in the current scene.")

func project_emit(event: String, data: Dictionary = {}) -> void:
	if event == "finished" and failed:
		return
	data["protocol"] = 11
	data["event"] = event
	if event == "animation-state-entered":
		data["trigger"] = animation_entry_trigger.duplicate(true)
	if event == "ready" or event == "finished":
		data["animationCommandSequence"] = animation_control.sequence
		data["animationCompletionSequence"] = animation_completions.sequence
		data["animationStateSequence"] = animation_state_sequence
		data["animationStateEntrySequence"] = animation_state_entry_sequence
	print("VIENTO_PROJECT:" + JSON.stringify(data, "", true, true))
