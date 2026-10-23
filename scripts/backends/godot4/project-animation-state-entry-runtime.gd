extends "res://project-animation-state-runtime.gd"

class StateEntryScenePort extends CompletionScenePort:
	func record_animation_state_entry() -> void:
		var owner = host.get_ref()
		if owner != null:
			owner.animation_state_entered(visit_index, binding, behavior.get_ref())

var animation_state_entry_sequence := 0
var animation_state_entry_reserved := 0

func animation_state_controller(binding: Dictionary) -> Variant:
	for controller in animation_state_controllers():
		if controller["bindingId"] == binding["bindingId"] and controller["instanceId"] == binding["instanceId"] and controller["objectId"] == binding["objectId"] and controller["scriptObjectId"] == binding["implementation"]["sourceObjectId"]:
			return controller
	return null

func make_behavior_instance(visit: int, binding: Dictionary, script: Script):
	if visit == visit_index and animation_state_controller(binding) != null:
		# Only the fixed generated wrapper is substituted. Parameter and signal
		# reflection still runs against the untouched original Script resource.
		var wrapper = load("res://animation-state-wrappers/" + binding["implementation"]["sourceObjectId"] + ".gd")
		return wrapper.new() if wrapper != null and wrapper.can_instantiate() else null
	return script.new()

func make_port(visit: int, binding: Dictionary, instance: Node) -> RefCounted:
	var original = super.make_port(visit, binding, instance)
	if animation_state_controller(binding) != null:
		return StateEntryScenePort.new(self, visit, binding, instance)
	return original

func animation_state_entered(visit: int, binding: Dictionary, instance) -> void:
	if not state_access(visit) or animation_state_sampled_visit == visit:
		return
	var controller: Variant = animation_state_controller(binding)
	var reference = animation_state_instances.get(binding["bindingId"])
	if controller == null or not is_instance_valid(instance) or reference == null or reference.get_ref() != instance:
		state_fail(binding, "runtime_behavior_animation_state_entry_invalid", "Animation state entry does not belong to a registered controller instance.")
		return
	var active = instance.get("_active")
	var state = instance.get("_state")
	var clip = instance.get("_selected_clip")
	if typeof(active) != TYPE_BOOL or not active or typeof(state) != TYPE_INT or state < 0 or state >= controller["states"].size() or not ((clip == null and controller["clips"][state] == null) or (typeof(clip) == TYPE_STRING and typeof(controller["clips"][state]) == TYPE_STRING and clip == controller["clips"][state])):
		state_fail(binding, "runtime_behavior_animation_state_entry_invalid", "Animation state entry fields differ from the frozen controller declaration.")
		return
	# The fixed wrapper reports immediately after select + play acceptance.
	# Read the actual queue to prevent a repeated observation-port call from
	# inventing a second entry for the same accepted request pair.
	var requests: Array = animation_control.queue
	var reservation: int = animation_control.reserved_count
	var pair_valid := reservation >= animation_state_entry_reserved + 2 and requests.size() >= 2
	if pair_valid:
		for request in [requests[-2], requests[-1]]:
			pair_valid = pair_valid and request["visitIndex"] == visit and request["sceneId"] == current_scene and request["binding"]["bindingId"] == binding["bindingId"] and request["binding"]["instanceId"] == binding["instanceId"] and request["binding"]["objectId"] == binding["objectId"]
		pair_valid = pair_valid and requests[-2]["command"]["action"] == "select" and requests[-2]["command"].get("clipId") == clip and requests[-1]["command"]["action"] == "play"
	if not pair_valid:
		state_fail(binding, "runtime_behavior_animation_state_entry_invalid", "Animation state entry has no new accepted select and play request pair.")
		return
	if animation_state_entry_sequence >= 128:
		state_fail(binding, "runtime_behavior_animation_state_entry_limit", "Animation state entry budget was exceeded.")
		return
	animation_state_entry_reserved = reservation
	animation_state_entry_sequence += 1
	project_emit("animation-state-entered", {"sequence": animation_state_entry_sequence, "visitIndex": visit, "sceneId": current_scene, "timeSeconds": elapsed_seconds, "commandSequence": animation_control.sequence, "bindingId": binding["bindingId"], "instanceId": binding["instanceId"], "objectId": binding["objectId"], "stateIndex": state, "clipId": clip})

func project_emit(event: String, data: Dictionary = {}) -> void:
	if event == "finished" and failed:
		return
	data["protocol"] = 9
	data["event"] = event
	if event == "ready" or event == "finished":
		data["animationCommandSequence"] = animation_control.sequence
		data["animationCompletionSequence"] = animation_completions.sequence
		data["animationStateSequence"] = animation_state_sequence
		data["animationStateEntrySequence"] = animation_state_entry_sequence
	print("VIENTO_PROJECT:" + JSON.stringify(data, "", true, true))
