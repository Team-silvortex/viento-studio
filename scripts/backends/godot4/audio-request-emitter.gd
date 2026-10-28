extends RefCounted

# Synchronous metadata only: the existing audio queue owns IDs, admission,
# playback, scheduling and FIFO removal at the observed commit points.
static func clock() -> Dictionary:
	return {"idleFrame": Engine.get_process_frames(), "physicsFrame": Engine.get_physics_frames()}

static func emit_accepted(request: Dictionary) -> void:
	var binding: Dictionary = request["binding"]
	print("VIENTO_AUDIO_REQUEST:" + JSON.stringify({"protocol": 1, "event": "accepted", "requestId": request["requestId"],
		"clock": clock(), "origin": {"visitIndex": request["visitIndex"], "sceneId": request["sceneId"],
			"bindingId": binding["bindingId"], "instanceId": binding["instanceId"], "objectId": binding["objectId"]},
		"trackId": request["trackId"], "action": request["action"]}, "", true, true))

static func emit_applied(request: Dictionary, command_sequence: int) -> void:
	print("VIENTO_AUDIO_REQUEST:" + JSON.stringify({"protocol": 1, "event": "applied", "requestId": request["requestId"],
		"clock": clock(), "commandSequence": command_sequence,
		"executionFrameIndex": preload("res://execution-frame-emitter.gd").frame_index}, "", true, true))

static func emit_discarded(request: Dictionary) -> void:
	print("VIENTO_AUDIO_REQUEST:" + JSON.stringify({"protocol": 1, "event": "discarded", "requestId": request["requestId"],
		"clock": clock(), "reason": "abort"}, "", true, true))
