extends "res://__HOST_SCRIPT__"

const REPLAY = __PROGRAM_JSON__

func enter_scene(scene_id: String) -> void:
	# Only this execution changes its in-memory entry, never assembly.json.
	members[scene_id] = "__REPLAY_SCENE__"
	super.enter_scene(scene_id)

func run_project_smoke() -> void:
	flush_requests()
	if not await physics_settle():
		return
	var held: Dictionary = {}
	for index in range(REPLAY["steps"].size()):
		if failed or finished or current == null:
			return
		var frame: Dictionary = {}
		var next_held: Dictionary = {}
		for input in REPLAY["steps"][index]["inputs"]:
			var id: String = input["instanceId"]
			var horizontal := float(input["right"]) - float(input["left"])
			var vertical := float(input["down"]) - float(input["up"])
			var jump_held: bool = input["jump"]
			frame[id] = {"direction": Vector2(horizontal, vertical).limit_length(1.0),
				"axis": horizontal, "jump": jump_held and not held.get(id, false)}
			next_held[id] = jump_held
		# Replacing both dictionaries releases every omitted instance this step.
		held = next_held
		current.physics_instance_replay_frame = frame
		var delta: float = REPLAY["fixedDelta"]
		elapsed_seconds += delta
		total_seconds += delta
		current.project_step(delta)
		if not await physics_settle():
			return
	current.physics_instance_replay_frame = {}
	accepting = false
	current.process_mode = Node.PROCESS_MODE_DISABLED
	finish_project()
