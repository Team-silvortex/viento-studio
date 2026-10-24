
# Scope is fixed by the saved animation declaration. Scene and instance lanes
# never compete for a visual: one scene has exactly one of these two modes.
const PROJECT_ANIMATION_SCENE = __ANIMATION_SCENE__
const PROJECT_ANIMATION_DURATION_BYTES = __ANIMATION_DURATION_BYTES__
const PROJECT_ANIMATION_CLIPS = __ANIMATION_CLIPS__
const PROJECT_ANIMATION_SCOPE = __ANIMATION_SCOPE__
const PROJECT_ANIMATION_INSTANCES = __ANIMATION_INSTANCES__
var project_animation_lanes: Dictionary = {}

func project_animation_declared() -> bool:
	return true

func project_animation_duration() -> float:
	return PackedByteArray(PROJECT_ANIMATION_DURATION_BYTES).decode_double(0)

func project_animation_clip_known(clip_id) -> bool:
	return clip_id == null or typeof(clip_id) == TYPE_STRING and PROJECT_ANIMATION_CLIPS.has(clip_id)

func project_animation_target_known(target: Dictionary) -> bool:
	if PROJECT_ANIMATION_SCOPE == "scene":
		return target.size() == 1 and target.get("kind") == "scene"
	return target.size() == 2 and target.get("kind") == "instance" and target.get("instanceId") in PROJECT_ANIMATION_INSTANCES

func project_animation_target_for_instance(instance_id: String):
	var target := {"kind": "scene"} if PROJECT_ANIMATION_SCOPE == "scene" else {"kind": "instance", "instanceId": instance_id}
	return target if project_animation_target_known(target) else null

func project_animation_lane_key(target: Dictionary) -> String:
	return "scene" if target["kind"] == "scene" else target["instanceId"]

func project_animation_initialize_lanes() -> void:
	if not project_animation_lanes.is_empty():
		return
	var targets: Array = [{"kind": "scene"}]
	if PROJECT_ANIMATION_SCOPE == "instance":
		targets = []
		for identity in PROJECT_ANIMATION_INSTANCES:
			targets.append({"kind": "instance", "instanceId": identity})
	for target in targets:
		var phase := "playing" if PROJECT_ANIMATION_SCOPE == "scene" else "stopped"
		project_animation_lanes[project_animation_lane_key(target)] = {"target": target, "phase": phase, "clipId": null,
			"positionSeconds": 0.0, "timeSeconds": 0.0, "anchorClock": 0.0, "anchorPosition": 0.0,
			"anchorPhase": phase, "completionSent": false}

func project_animation_target_range(lane: Dictionary) -> Dictionary:
	if lane["clipId"] == null:
		return {"start": 0.0, "end": animation_duration, "duration": animation_duration, "loop": animation_loop}
	var clip: Dictionary = PROJECT_ANIMATION_CLIPS[lane["clipId"]]
	var start: float = PackedByteArray(clip["startBytes"]).decode_double(0)
	var end: float = PackedByteArray(clip["endBytes"]).decode_double(0)
	return {"start": start, "end": end, "duration": end - start, "loop": clip["loop"]}

func project_animation_command_valid_target(target: Dictionary, command: Dictionary) -> bool:
	if not project_animation_target_known(target):
		return false
	project_animation_initialize_lanes()
	return command["action"] != "seek" or float(command["positionSeconds"]) <= project_animation_target_range(project_animation_lanes[project_animation_lane_key(target)])["duration"]

func project_animation_target_sample(lane: Dictionary) -> void:
	var selected := project_animation_target_range(lane)
	var seconds: float = selected["end"] if not selected["loop"] and lane["positionSeconds"] == selected["duration"] else selected["start"] + lane["positionSeconds"]
	var target: Dictionary = lane["target"]
	for track in animation_tracks:
		if target["kind"] == "instance" and track["instanceId"] != target["instanceId"]:
			continue
		var visual: Node2D = animation_visuals[track["instanceId"]]
		if not is_instance_valid(visual):
			animation_fail("Generated animated visual is unavailable.")
			return
		var value = animation_value(track, seconds)
		match track["property"]:
			"offset2d": visual.position = Vector2(value[0], value[1])
			"rotation2d": visual.rotation_degrees = float(value)
			"scale2d": visual.scale = Vector2(value[0], value[1])
			"opacity": visual.modulate.a = float(value)
			"spriteFrame2d":
				var sprites = get("animation_sprites")
				var sprite = sprites.get(track["instanceId"]) if sprites is Dictionary else null
				if not is_instance_valid(sprite) or not sprite is Sprite2D:
					animation_fail("Generated frame animation image is unavailable.")
					return
				sprite.frame = int(value)

func project_animation_target_snapshot(target: Dictionary) -> Dictionary:
	project_animation_initialize_lanes()
	var lane: Dictionary = project_animation_lanes[project_animation_lane_key(target)]
	return {"sceneObjectId": PROJECT_ANIMATION_SCENE, "phase": lane["phase"], "positionSeconds": lane["positionSeconds"], "timeSeconds": lane["timeSeconds"], "clipId": lane["clipId"]}

func animation_advance(_delta: float) -> void:
	if not project_open or not animation_started or animation_failed or animation_finished:
		return
	project_animation_initialize_lanes()
	var seconds: float = project_host.elapsed_seconds
	for key in project_animation_lanes:
		var lane: Dictionary = project_animation_lanes[key]
		var elapsed: float = seconds - lane["anchorClock"]
		var selected := project_animation_target_range(lane)
		var duration: float = selected["duration"]
		lane["timeSeconds"] = seconds
		lane["phase"] = lane["anchorPhase"]
		lane["positionSeconds"] = lane["anchorPosition"]
		if lane["phase"] != "playing":
			continue
		if selected["loop"]:
			lane["positionSeconds"] = fmod(lane["anchorPosition"] + fmod(elapsed, duration), duration)
		elif elapsed >= duration - lane["anchorPosition"]:
			lane["positionSeconds"] = duration
		else:
			lane["positionSeconds"] = minf(lane["anchorPosition"] + elapsed, duration)
		if not selected["loop"] and lane["positionSeconds"] == duration:
			lane["phase"] = "finished"
		project_animation_target_sample(lane)
		if animation_failed or project_host.failed:
			return
		if lane["phase"] == "finished" and not lane["completionSent"]:
			lane["completionSent"] = true
			project_host.animation_completions.complete_target(project_visit, lane["target"], project_animation_target_snapshot(lane["target"]))

func project_animation_execute_target(target: Dictionary, command: Dictionary):
	if not project_open or not animation_started or animation_failed or animation_finished or not project_animation_target_known(target):
		return null
	animation_advance(0.0)
	if animation_failed or project_host.failed:
		return null
	var lane: Dictionary = project_animation_lanes[project_animation_lane_key(target)]
	var selected := project_animation_target_range(lane)
	match command["action"]:
		"select":
			lane["clipId"] = command["clipId"]
			lane["positionSeconds"] = 0.0
			lane["phase"] = "paused"
		"play":
			lane["completionSent"] = false
			if not selected["loop"] and lane["positionSeconds"] == selected["duration"]:
				lane["positionSeconds"] = 0.0
			lane["phase"] = "playing"
		"pause": lane["phase"] = "paused"
		"stop":
			lane["positionSeconds"] = 0.0
			lane["phase"] = "stopped"
		"seek":
			lane["positionSeconds"] = fmod(float(command["positionSeconds"]), selected["duration"]) if selected["loop"] else float(command["positionSeconds"])
			lane["phase"] = "paused"
		_: return null
	project_animation_target_sample(lane)
	if animation_failed:
		return null
	lane["anchorClock"] = lane["timeSeconds"]
	lane["anchorPosition"] = lane["positionSeconds"]
	lane["anchorPhase"] = lane["phase"]
	return project_animation_target_snapshot(target)
