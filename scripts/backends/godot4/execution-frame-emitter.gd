extends RefCounted

# One coordinator per process; inherited print sites share this static counter.
# Metadata is sampled exactly when the existing business frame is emitted.
static var frame_index: int = 0

static func emit_frame(data: Dictionary) -> void:
	frame_index += 1
	print("VIENTO_EXECUTION_FRAME:" + JSON.stringify({"protocol": 1, "index": frame_index,
		"clock": {"idleFrame": Engine.get_process_frames(), "physicsFrame": Engine.get_physics_frames()},
		"frame": data}, "", true, true))
