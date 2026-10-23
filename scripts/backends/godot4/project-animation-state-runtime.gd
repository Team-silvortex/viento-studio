extends "res://project-completion-runtime.gd"

# Observe only frozen, exactly recognized state-script bindings. Author scripts
# retain their original bytes; weak references cannot keep a freed Node alive.
var animation_state_sequence := 0
var animation_state_instances: Dictionary = {}
var animation_state_sampled_visit := 0

func make_port(visit: int, binding: Dictionary, instance: Node) -> RefCounted:
	for controller in animation_state_controllers():
		if controller["bindingId"] == binding["bindingId"] and controller["instanceId"] == binding["instanceId"] and controller["objectId"] == binding["objectId"]:
			animation_state_instances[binding["bindingId"]] = weakref(instance)
			break
	return super.make_port(visit, binding, instance)

func animation_state_controllers() -> Array:
	for scene in manifest.get("scenes", []):
		if scene["sceneId"] == current_scene:
			return scene.get("animationStateControllers", [])
	return []

func project_emit(event: String, data: Dictionary = {}) -> void:
	# A corrupt private observation must never fabricate a normal finish.
	if event == "finished" and failed:
		return
	data["protocol"] = 8
	data["event"] = event
	if event == "ready" or event == "finished":
		data["animationCommandSequence"] = animation_control.sequence
		data["animationCompletionSequence"] = animation_completions.sequence
		data["animationStateSequence"] = animation_state_sequence
	print("VIENTO_PROJECT:" + JSON.stringify(data, "", true, true))

func animation_state_snapshot(reason: String) -> bool:
	if visit_index < 1 or animation_state_sampled_visit == visit_index:
		return true
	animation_state_sampled_visit = visit_index
	var controllers := animation_state_controllers()
	if controllers.is_empty():
		return true
	var rows: Array = []
	for controller in controllers:
		var row := {"bindingId": controller["bindingId"], "instanceId": controller["instanceId"], "objectId": controller["objectId"], "status": "unavailable", "stateIndex": null, "clipId": null}
		var reference = animation_state_instances.get(controller["bindingId"])
		var instance = reference.get_ref() if reference != null else null
		if is_instance_valid(instance):
			var active = instance.get("_active")
			var state = instance.get("_state")
			var clip = instance.get("_selected_clip")
			var valid := typeof(active) == TYPE_BOOL and typeof(state) == TYPE_INT
			if valid and active:
				valid = state >= 0 and state < controller["states"].size() and ((clip == null and controller["clips"][state] == null) or (typeof(clip) == TYPE_STRING and typeof(controller["clips"][state]) == TYPE_STRING and clip == controller["clips"][state]))
			elif valid:
				valid = state == -1 and clip == null
			if not valid:
				if current != null:
					current.emit("diagnostic", {"severity": "error", "code": "runtime_behavior_animation_state_invalid", "message": "Animation state controller fields differ from the frozen declaration.", "bindingId": controller["bindingId"], "instanceId": controller["instanceId"], "objectId": controller["objectId"]})
				failed = true
				return false
			row["status"] = "active" if active else "inactive"
			row["stateIndex"] = state
			row["clipId"] = clip
		rows.append(row)
	animation_state_sequence += 1
	project_emit("animation-state-snapshot", {"sequence": animation_state_sequence, "visitIndex": visit_index, "sceneId": current_scene, "timeSeconds": elapsed_seconds, "commandSequence": animation_control.sequence, "reason": reason, "controllers": rows})
	return true

func enter_scene(scene_id: String) -> void:
	if failed:
		return
	animation_state_instances.clear()
	super.enter_scene(scene_id)

func leave_scene(reason: String, next_scene: String = "") -> void:
	if not animation_state_snapshot(reason):
		abort_project()
		return
	super.leave_scene(reason, next_scene)
	animation_state_instances.clear()

func abort_project() -> void:
	animation_state_snapshot("aborted")
	super.abort_project()
	animation_state_instances.clear()
