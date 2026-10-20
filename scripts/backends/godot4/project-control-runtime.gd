extends "res://project-runtime.gd"

# Optional animation transport composes with the established project host.
# Author scripts receive visit-bound commands, never animation or visual nodes.
class AnimationScenePort extends ScenePort:
	func play_animation() -> bool:
		var owner = host.get_ref()
		return owner != null and owner.animation_control.request(visit_index, binding, {"action": "play"})
	func pause_animation() -> bool:
		var owner = host.get_ref()
		return owner != null and owner.animation_control.request(visit_index, binding, {"action": "pause"})
	func stop_animation() -> bool:
		var owner = host.get_ref()
		return owner != null and owner.animation_control.request(visit_index, binding, {"action": "stop"})
	func seek_animation(seconds) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.animation_control.request(visit_index, binding, {"action": "seek", "positionSeconds": seconds})

var animation_control

func _ready() -> void:
	animation_control = preload("res://project-animation.gd").new(self)
	super._ready()

func make_port(visit: int, binding: Dictionary, instance: Node) -> RefCounted:
	return AnimationScenePort.new(self, visit, binding, instance)

func project_emit(event: String, data: Dictionary = {}) -> void:
	data["protocol"] = 5
	data["event"] = event
	if event == "ready" or event == "finished":
		data["animationCommandSequence"] = animation_control.sequence
	print("VIENTO_PROJECT:" + JSON.stringify(data, "", true, true))

func flush_requests() -> void:
	flush_scheduled = false
	if flushing or failed or finished:
		return
	flushing = true
	while current != null and not failed and not finished:
		event_bus.drain()
		if not failed and not finished:
			audio_control.drain()
		if not failed and not finished:
			animation_control.drain()
		if failed or finished:
			break
		if event_bus.pending_count() > 0 or audio_control.pending_count() > 0 or animation_control.pending_count() > 0:
			continue
		if finish_requested:
			pending_scene = ""
			leave_scene("finished")
			finished = true
			project_emit("finished", {"assemblyId": manifest["assembly"]["objectId"], "visitCount": visit_index, "totalSeconds": total_seconds, "stateRevision": state_revision, "eventSequence": event_bus.sequence, "audioCommandSequence": audio_control.sequence})
			get_tree().quit()
			break
		if pending_scene == "":
			break
		var next_scene := pending_scene
		pending_scene = ""
		leave_scene("switch", next_scene)
		enter_scene(next_scene)
	flushing = false

func abort_project() -> void:
	animation_control.clear()
	super.abort_project()
