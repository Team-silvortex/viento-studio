extends "__SCENE_RUNTIME__"

func _ready() -> void:
	platform_motion = preload("__CONTROL_HELPER__").new(__PLATFORM_IDS__)
__DROP_SETUP__	super._ready()

func project_behavior_port(binding: Dictionary, instance: Node) -> RefCounted:
	var project_port := super.project_behavior_port(binding, instance)
	platform_motion.attach(self, binding, instance)
	return project_port

func project_step(delta: float) -> void:
	if not platform_motion.start(self):
		return
	super.project_step(delta)
	platform_motion.finish(self)

func project_close(silent: bool = false) -> void:
	platform_motion.revoke()
	super.project_close(silent)
__VERTICAL_GROUND__
