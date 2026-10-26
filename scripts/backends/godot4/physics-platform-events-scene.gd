extends "__SCENE_RUNTIME__"

func _ready() -> void:
	# Install the derived collector before the frozen runtime creates actors
	# and author behavior children. The original native movement stays intact.
	platform_motion = preload("res://platform-events-helper.gd").new(__PLATFORM_IDS__)
	super._ready()

func project_behavior_port(binding: Dictionary, instance: Node) -> RefCounted:
	var project_port := super.project_behavior_port(binding, instance)
	platform_motion.attach(self, binding, instance)
	return project_port

func project_step(delta: float) -> void:
	if not platform_motion.start(self):
		return
	super.project_step(delta)
	# All actors, animation, audio and previous native fact callbacks finish
	# before endpoint callbacks can publish ordinary author project events.
	platform_motion.finish(self)

func project_close(silent: bool = false) -> void:
	platform_motion.revoke()
	super.project_close(silent)
