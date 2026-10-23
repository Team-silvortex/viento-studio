extends SceneTree
func _initialize() -> void:
	var instance = preload("res://wrapper.gd").new()
	instance.clip_idle = "inherited"
	root.add_child.call_deferred(instance)
	instance.event.call_deferred()
	quit.call_deferred()
