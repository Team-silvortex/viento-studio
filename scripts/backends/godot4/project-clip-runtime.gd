extends "res://project-control-runtime.gd"

# Selection extends the visit-bound transport port; event/audio ownership and
# safe-point ordering continue to belong to the established project host.
class ClipScenePort extends AnimationScenePort:
	func select_animation_clip(clip_id = null) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.animation_control.request(visit_index, binding, {"action": "select", "clipId": clip_id})

func make_port(visit: int, binding: Dictionary, instance: Node) -> RefCounted:
	return ClipScenePort.new(self, visit, binding, instance)

func project_emit(event: String, data: Dictionary = {}) -> void:
	data["protocol"] = 6
	data["event"] = event
	if event == "ready" or event == "finished":
		data["animationCommandSequence"] = animation_control.sequence
	print("VIENTO_PROJECT:" + JSON.stringify(data, "", true, true))
