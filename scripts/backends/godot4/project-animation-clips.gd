extends RefCounted

# Clip selection shares the bounded scene transport queue. Selection-dependent
# seek bounds are checked at execution, after earlier queued selections.
var host: WeakRef
var queue: Array = []
var reserved_count := 0
var sequence := 0
var draining := false

func _init(owner: Node) -> void:
	host = weakref(owner)

func pending_count() -> int:
	return queue.size()

func request(visit: int, binding: Dictionary, command: Dictionary) -> bool:
	var owner = host.get_ref()
	if owner == null or not owner.state_access(visit):
		return false
	if not owner.current.project_animation_declared():
		return owner.state_fail(binding, "runtime_behavior_animation_missing", "The current scene has no declared animation.")
	if command["action"] == "select" and not owner.current.project_animation_clip_known(command["clipId"]):
		return owner.state_fail(binding, "runtime_behavior_animation_clip", "Choose a clip declared by the current scene animation.")
	if command["action"] == "seek":
		var seconds = command["positionSeconds"]
		if not typeof(seconds) in [TYPE_INT, TYPE_FLOAT] or not is_finite(float(seconds)) or float(seconds) < 0.0 or float(seconds) > owner.current.project_animation_duration():
			return owner.state_fail(binding, "runtime_behavior_animation_command", "Choose a finite position within the current animation duration.")
		command["positionSeconds"] = 0.0 if seconds == 0 else float(seconds)
	if reserved_count >= 256 or queue.size() >= 64:
		return owner.state_fail(binding, "runtime_behavior_animation_limit", "Project animation request budget was exceeded.")
	reserved_count += 1
	queue.push_back({"visitIndex": visit, "sceneId": owner.current_scene, "binding": binding.duplicate(true), "command": command.duplicate(true)})
	owner.schedule_flush()
	return true

func drain() -> void:
	var owner = host.get_ref()
	if draining or owner == null:
		return
	draining = true
	while not queue.is_empty() and not owner.failed and not owner.finished:
		var request: Dictionary = queue[0]
		var binding: Dictionary = request["binding"]
		var state = null
		if owner.current != null and owner.visit_index == request["visitIndex"] and owner.current_scene == request["sceneId"]:
			if not owner.current.project_animation_command_valid(request["command"]):
				owner.state_fail(binding, "runtime_behavior_animation_command", "Choose a position within the selected animation range.")
				break
			state = owner.current.project_animation_execute(request["command"])
		if state == null or owner.failed:
			if not owner.failed:
				owner.state_fail(binding, "runtime_behavior_animation_unavailable", "The declared scene animation is not available for playback.")
			break
		sequence += 1
		owner.project_emit("animation-command", {"commandSequence": sequence, "visitIndex": request["visitIndex"], "sceneId": request["sceneId"],
			"bindingId": binding["bindingId"], "instanceId": binding["instanceId"], "objectId": binding["objectId"], "command": request["command"], "state": state})
		queue.pop_front()
	draining = false

func clear() -> void:
	queue.clear()
