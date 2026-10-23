
# Range transport retains a local position. Only visual sampling adds the range
# start; the document loop is never applied a second time to that sample time.
const PROJECT_ANIMATION_SCENE = __ANIMATION_SCENE__
const PROJECT_ANIMATION_DURATION_BYTES = __ANIMATION_DURATION_BYTES__
const PROJECT_ANIMATION_CLIPS = __ANIMATION_CLIPS__
var project_animation_completion_sent := false
var project_animation_phase := "playing"
var project_animation_clock := 0.0
var project_animation_clip = null
var project_animation_position := 0.0
var project_animation_anchor_clock := 0.0
var project_animation_anchor_position := 0.0
var project_animation_anchor_phase := "playing"

func project_animation_declared() -> bool:
	return true

func project_animation_duration() -> float:
	return PackedByteArray(PROJECT_ANIMATION_DURATION_BYTES).decode_double(0)

func project_animation_clip_known(clip_id) -> bool:
	return clip_id == null or typeof(clip_id) == TYPE_STRING and PROJECT_ANIMATION_CLIPS.has(clip_id)

func project_animation_range() -> Dictionary:
	if project_animation_clip == null:
		return {"start": 0.0, "end": animation_duration, "duration": animation_duration, "loop": animation_loop}
	var clip: Dictionary = PROJECT_ANIMATION_CLIPS[project_animation_clip]
	var start: float = PackedByteArray(clip["startBytes"]).decode_double(0)
	var end: float = PackedByteArray(clip["endBytes"]).decode_double(0)
	return {"start": start, "end": end, "duration": end - start, "loop": clip["loop"]}

func project_animation_command_valid(command: Dictionary) -> bool:
	return command["action"] != "seek" or float(command["positionSeconds"]) <= project_animation_range()["duration"]

func project_animation_sample() -> void:
	var selected := project_animation_range()
	animation_time = selected["end"] if not selected["loop"] and project_animation_position == selected["duration"] else selected["start"] + project_animation_position
	animation_apply()

func animation_advance(_delta: float) -> void:
	if not project_open or not animation_started or animation_failed or animation_finished:
		return
	var seconds: float = project_host.elapsed_seconds
	var elapsed: float = seconds - project_animation_anchor_clock
	var selected := project_animation_range()
	var duration: float = selected["duration"]
	project_animation_clock = seconds
	project_animation_phase = project_animation_anchor_phase
	project_animation_position = project_animation_anchor_position
	if project_animation_phase == "playing":
		if selected["loop"]:
			project_animation_position = fmod(project_animation_anchor_position + fmod(elapsed, duration), duration)
		elif elapsed >= duration - project_animation_anchor_position:
			project_animation_position = duration
		else:
			# Match the Rust remaining-time comparison before adding, including
			# the distinct rounding boundaries of subtraction and addition.
			project_animation_position = minf(project_animation_anchor_position + elapsed, duration)
		if not selected["loop"] and project_animation_position == duration:
			project_animation_phase = "finished"
		project_animation_sample()
		if not animation_failed and not project_host.failed and project_animation_phase == "finished" and not project_animation_completion_sent:
			project_animation_completion_sent = true
			project_host.animation_completions.complete(project_visit, project_animation_snapshot())

func project_animation_snapshot() -> Dictionary:
	return {"sceneObjectId": PROJECT_ANIMATION_SCENE, "phase": project_animation_phase, "positionSeconds": project_animation_position, "timeSeconds": project_animation_clock, "clipId": project_animation_clip}

func project_animation_execute(command: Dictionary):
	if not project_open or not animation_started or animation_failed or animation_finished:
		return null
	animation_advance(0.0)
	if animation_failed or project_host.failed:
		return null
	var selected := project_animation_range()
	match command["action"]:
		"select":
			project_animation_clip = command["clipId"]
			project_animation_position = 0.0
			project_animation_phase = "paused"
		"play":
			project_animation_completion_sent = false
			if not selected["loop"] and project_animation_position == selected["duration"]:
				project_animation_position = 0.0
			project_animation_phase = "playing"
		"pause": project_animation_phase = "paused"
		"stop":
			project_animation_position = 0.0
			project_animation_phase = "stopped"
		"seek":
			project_animation_position = fmod(float(command["positionSeconds"]), selected["duration"]) if selected["loop"] else float(command["positionSeconds"])
			project_animation_phase = "paused"
		_: return null
	project_animation_sample()
	if animation_failed:
		return null
	project_animation_anchor_clock = project_animation_clock
	project_animation_anchor_position = project_animation_position
	project_animation_anchor_phase = project_animation_phase
	return project_animation_snapshot()
