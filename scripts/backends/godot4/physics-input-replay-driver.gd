extends "res://__HOST_SCRIPT__"

# The input is embedded only after the host validates and detaches it.
const REPLAY = __PROGRAM_JSON__
const ACTIONS = {"left": "ui_left", "right": "ui_right", "up": "ui_up", "down": "ui_down", "jump": "ui_accept"}

func release_replay_actions() -> void:
	for action in ACTIONS.values():
		Input.action_release(action)

func run_project_smoke() -> void:
	release_replay_actions()
	flush_requests()
	if not await physics_settle():
		release_replay_actions()
		return
	for index in range(REPLAY["steps"].size()):
		if failed or finished or current == null:
			release_replay_actions()
			return
		var step: Dictionary = REPLAY["steps"][index]
		for key in ACTIONS:
			if step[key]:
				Input.action_press(ACTIONS[key])
			else:
				Input.action_release(ACTIONS[key])
		var delta: float = REPLAY["fixedDelta"]
		elapsed_seconds += delta
		total_seconds += delta
		current.project_step(delta)
		if not await physics_settle():
			release_replay_actions()
			return
	release_replay_actions()
	accepting = false
	current.process_mode = Node.PROCESS_MODE_DISABLED
	finish_project()
