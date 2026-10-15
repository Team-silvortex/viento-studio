extends RefCounted

# Visit-bound requests own only track identities and binding provenance. Audio
# nodes remain inside each scene; the coordinator supplies the safe-point clock.
var host: WeakRef
var queue: Array = []
var reserved_count := 0
var sequence := 0
var draining := false

func _init(owner: Node) -> void:
	host = weakref(owner)

func pending_count() -> int:
	return queue.size()

func request(visit: int, binding: Dictionary, track_id, action: String) -> bool:
	var owner = host.get_ref()
	if owner == null or not owner.state_access(visit):
		return false
	if typeof(track_id) != TYPE_STRING or owner.current.project_audio_resource(track_id) == "":
		return owner.state_fail(binding, "runtime_behavior_audio_track", "Choose an audio track declared by the current scene.")
	if reserved_count >= 256 or queue.size() >= 64:
		return owner.state_fail(binding, "runtime_behavior_audio_limit", "Project audio request budget was exceeded.")
	reserved_count += 1
	queue.push_back({"visitIndex": visit, "sceneId": owner.current_scene, "binding": binding.duplicate(true), "trackId": track_id,
		"resourceId": owner.current.project_audio_resource(track_id), "action": action})
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
		if owner.current == null or owner.visit_index != request["visitIndex"] or owner.current_scene != request["sceneId"] or not owner.current.project_audio_execute(request["trackId"], request["action"]):
			owner.state_fail(binding, "runtime_behavior_audio_unavailable", "The declared scene audio track is not available for playback.")
			break
		sequence += 1
		owner.project_emit("audio-command", {"commandSequence": sequence, "visitIndex": request["visitIndex"], "sceneId": request["sceneId"],
			"bindingId": binding["bindingId"], "instanceId": binding["instanceId"], "objectId": binding["objectId"],
			"trackId": request["trackId"], "resourceId": request["resourceId"], "action": request["action"], "timeSeconds": owner.current.project_audio_time()})
		queue.pop_front()
	draining = false

func clear() -> void:
	queue.clear()
