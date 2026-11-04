extends "__SCENE_RUNTIME__"

func _ready() -> void:
	# Install the derived collector before the frozen runtime creates actors
	# and author behavior children. The original native movement stays intact.
	platform_motion = preload("res://platform-vertical-events-helper.gd").new(__PLATFORM_IDS__)
__DROP_SETUP__	super._ready()

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

# The carry solver records a native support probe separately from its sole
# movement sweep. Preserve sweep-only traces while keeping grounded gameplay.
func character_events_ground(instance_id: String, was_grounded: bool, grounded: bool) -> void:
	if platform_motion.native_ground.has(instance_id):
		grounded = true
		get("character_motion_grounded")[instance_id] = true
		var velocity: Vector2 = get("character_motion_velocities")[instance_id]
		velocity.y = 0.0
		get("character_motion_velocities")[instance_id] = velocity
	if get("character_events_stepping") and get("character_events_open") and not was_grounded and grounded and get("character_events_ports").has(instance_id):
		get("character_events_pending").append({"instanceId": instance_id, "kind": "landed"})
