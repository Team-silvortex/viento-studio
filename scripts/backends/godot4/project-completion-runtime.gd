extends "res://project-clip-runtime.gd"

class CompletionScenePort extends ClipScenePort:
	func subscribe_animation_completed(callback) -> int:
		var owner = host.get_ref()
		return owner.animation_completions.subscribe(visit_index, binding, behavior.get_ref(), callback) if owner != null else 0
	func unsubscribe_animation_completed(id) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.animation_completions.unsubscribe(visit_index, binding, id)

var animation_completions

func _ready() -> void:
	animation_completions = preload("res://project-animation-completions.gd").new(self)
	super._ready()

func make_port(visit: int, binding: Dictionary, instance: Node) -> RefCounted:
	return CompletionScenePort.new(self, visit, binding, instance)

func project_emit(event: String, data: Dictionary = {}) -> void:
	data["protocol"] = 7
	data["event"] = event
	if event == "ready" or event == "finished":
		data["animationCommandSequence"] = animation_control.sequence
		data["animationCompletionSequence"] = animation_completions.sequence
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
		if not failed and not finished:
			animation_completions.drain()
		if failed or finished:
			break
		if event_bus.pending_count() > 0 or audio_control.pending_count() > 0 or animation_control.pending_count() > 0 or animation_completions.pending_count() > 0:
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

func leave_scene(reason: String, next_scene: String = "") -> void:
	animation_completions.revoke_visit(visit_index)
	super.leave_scene(reason, next_scene)

func abort_project() -> void:
	animation_completions.clear()
	super.abort_project()
