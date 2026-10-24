extends "__PROJECT_RUNTIME__"

# Only physics-enabled projects select this clock. The inherited project port,
# event queues and runtime protocol retain their existing ownership and format.
func _ready() -> void:
	super._ready()
	set_process(false)
	set_physics_process(not smoke)

func _process(_delta: float) -> void:
	pass

func _physics_process(delta: float) -> void:
	super._process(delta)

# Area2D monitoring is updated by Godot's actual physics step. Settle a newly
# entered visit too: its bodies must be registered before the next movement.
func physics_settle() -> bool:
	for _attempt in range(64):
		var previous_visit := visit_index
		await get_tree().physics_frame
		await get_tree().process_frame
		if failed or finished or current == null:
			return false
		flush_requests()
		if failed or finished or current == null:
			return false
		if previous_visit == visit_index:
			return true
	return false

func run_project_smoke() -> void:
	flush_requests()
	if not await physics_settle():
		Input.action_release("ui_right")
		return
	# Thirty real physics barriers preserve the existing .5 second smoke
	# duration while allowing sensors to observe entry and exit between moves.
	for step in range(30):
		if failed or finished or current == null:
			Input.action_release("ui_right")
			return
		if step == 0:
			Input.action_press("ui_right")
		elif step == 15:
			Input.action_release("ui_right")
		var delta := 1.0 / 60.0
		elapsed_seconds += delta
		total_seconds += delta
		current.project_step(delta)
		if not await physics_settle():
			Input.action_release("ui_right")
			return
	Input.action_release("ui_right")
	accepting = false
	current.process_mode = Node.PROCESS_MODE_DISABLED
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--viento-capture="):
			await RenderingServer.frame_post_draw
			if get_viewport().get_texture().get_image().save_png(argument.trim_prefix("--viento-capture=")) != OK:
				current.emit("diagnostic", {"severity": "error", "code": "runtime_capture_failed", "message": "Cannot save preview frame."})
				return
	finish_project()
