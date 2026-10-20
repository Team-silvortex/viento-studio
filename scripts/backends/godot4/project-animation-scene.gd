
# The project clock is authoritative; paused transport never freezes actor,
# behavior, audio or shared-state time. Shutdown remains owned by the base.
const PROJECT_ANIMATION_SCENE = __ANIMATION_SCENE__
const PROJECT_ANIMATION_DURATION_BYTES = __ANIMATION_DURATION_BYTES__
var project_animation_phase := "playing"
var project_animation_clock := 0.0
var project_animation_anchor_clock := 0.0
var project_animation_anchor_position := 0.0
var project_animation_anchor_phase := "playing"

func project_animation_declared() -> bool:
	return true

func project_animation_duration() -> float:
	return PackedByteArray(PROJECT_ANIMATION_DURATION_BYTES).decode_double(0)

func animation_advance(_delta: float) -> void:
	if not project_open or not animation_started or animation_failed or animation_finished:
		return
	var seconds: float = project_host.elapsed_seconds
	var elapsed: float = seconds - project_animation_anchor_clock
	project_animation_clock = seconds
	project_animation_phase = project_animation_anchor_phase
	animation_time = project_animation_anchor_position
	if project_animation_phase == "playing":
		# Recompute from the last command, never accumulate render-frame rounding.
		animation_time = fmod(project_animation_anchor_position + fmod(elapsed, animation_duration), animation_duration) if animation_loop else minf(project_animation_anchor_position + elapsed, animation_duration)
		if not animation_loop and animation_time == animation_duration:
			project_animation_phase = "finished"
		animation_apply()

func project_animation_execute(command: Dictionary):
	if not project_open or not animation_started or animation_failed or animation_finished:
		return null
	animation_advance(0.0)
	if animation_failed or project_host.failed:
		return null
	match command["action"]:
		"play":
			if not animation_loop and animation_time == animation_duration:
				animation_time = 0.0
			project_animation_phase = "playing"
		"pause": project_animation_phase = "paused"
		"stop":
			animation_time = 0.0
			project_animation_phase = "stopped"
		"seek":
			animation_time = fmod(float(command["positionSeconds"]), animation_duration) if animation_loop else float(command["positionSeconds"])
			project_animation_phase = "paused"
		_: return null
	animation_apply()
	if animation_failed:
		return null
	project_animation_anchor_clock = project_animation_clock
	project_animation_anchor_position = animation_time
	project_animation_anchor_phase = project_animation_phase
	return {"sceneObjectId": PROJECT_ANIMATION_SCENE, "phase": project_animation_phase, "positionSeconds": animation_time, "timeSeconds": project_animation_clock}
