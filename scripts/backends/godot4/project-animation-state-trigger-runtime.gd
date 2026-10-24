extends "res://project-animation-state-entry-runtime.gd"

class StateTriggerScenePort extends StateEntryScenePort:
	func record_animation_state_entry_trigger(kind: String, event_name: String = "") -> void:
		var owner = host.get_ref()
		if owner != null:
			owner.animation_state_entered_with_trigger(visit_index, binding, behavior.get_ref(), kind, event_name)

# Dispatch owns these scopes. Clear them outside invoke_callback, so a script
# error or rejected asynchronous callback cannot leave a borrowed identity.
var animation_dispatch_scopes: Array = []
var animation_entry_trigger := {"kind": "direct"}

func begin_animation_dispatch(visit: int, binding: Dictionary, callback: Callable, trigger: Dictionary) -> void:
	animation_dispatch_scopes.push_back({"visit": visit, "binding": binding.duplicate(true), "callback": callback, "trigger": trigger.duplicate(true)})

func end_animation_dispatch() -> void:
	animation_dispatch_scopes.pop_back()

func make_port(visit: int, binding: Dictionary, instance: Node) -> RefCounted:
	var original = super.make_port(visit, binding, instance)
	if animation_state_controller(binding) != null:
		return StateTriggerScenePort.new(self, visit, binding, instance)
	return original

func animation_state_entered_with_trigger(visit: int, binding: Dictionary, instance, kind: String, event_name: String) -> void:
	var trigger := {"kind": "direct"}
	if is_instance_valid(instance) and kind == "initial" and instance.is_inside_tree() and instance.get("_viento_entry_kind") == "initial":
		trigger = {"kind": "initial"}
	elif not animation_dispatch_scopes.is_empty():
		var scope: Dictionary = animation_dispatch_scopes[-1]
		var callback: Callable = scope["callback"]
		var matches: bool = scope["visit"] == visit and callback.get_object() == instance
		for key in ["bindingId", "instanceId", "objectId"]:
			matches = matches and scope["binding"][key] == binding[key]
		if matches and scope["trigger"]["kind"] == kind:
			if kind == "event" and event_bus.same_callback(callback, Callable(instance, "_on_event").bind(event_name)):
				trigger = scope["trigger"].duplicate(true)
			elif kind == "completed" and event_bus.same_callback(callback, Callable(instance, "_on_completed")):
				trigger = scope["trigger"].duplicate(true)
	var previous: Dictionary = animation_entry_trigger
	animation_entry_trigger = trigger
	# Retain p9's registered instance, frozen state/clip and new request-pair checks.
	super.animation_state_entered(visit, binding, instance)
	animation_entry_trigger = previous

func project_emit(event: String, data: Dictionary = {}) -> void:
	if event == "finished" and failed:
		return
	data["protocol"] = 10
	data["event"] = event
	if event == "animation-state-entered":
		data["trigger"] = animation_entry_trigger.duplicate(true)
	if event == "ready" or event == "finished":
		data["animationCommandSequence"] = animation_control.sequence
		data["animationCompletionSequence"] = animation_completions.sequence
		data["animationStateSequence"] = animation_state_sequence
		data["animationStateEntrySequence"] = animation_state_entry_sequence
	print("VIENTO_PROJECT:" + JSON.stringify(data, "", true, true))
