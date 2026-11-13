extends "res://project-pause-runtime.gd"

# The observer is an independent ALWAYS sibling of gameplay. It never calls a
# gameplay port, advances a game clock or changes generated actor/state data.
@export var sample_directory: String = "user://pause-observations"
var monitor
class Monitor extends Node:
	var owner_ref: WeakRef
	var button: Button
	var gui_count := 0
	var gui_started := false
	var keys: Dictionary = {}
	var sampled_msec := -50
	var capture_key := ""
	var capture_pending := false
	var captures := 0
	func _ready() -> void:
		process_mode = Node.PROCESS_MODE_ALWAYS
		var layer := CanvasLayer.new()
		layer.layer = 20
		button = Button.new()
		button.text = "Test GUI consumes pause keys; F8 closes it"
		button.position = Vector2(240, 464)
		button.size = Vector2(480, 44)
		button.gui_input.connect(_consume_gui)
		layer.add_child(button)
		add_child(layer)
		button.hide()
	func _consume_gui(event: InputEvent) -> void:
		if event.is_action("pause"):
			if event.is_pressed() and not event.is_echo():
				gui_count += 1
			button.accept_event()
	func _input(event: InputEvent) -> void:
		if event is InputEventKey:
			keys[str(event.physical_keycode)] = event.pressed
			if event.pressed and not event.echo and event.physical_keycode == KEY_F8:
				button.hide()
				button.release_focus()
				get_viewport().set_input_as_handled()
	func _process(_delta: float) -> void:
		var project = owner_ref.get_ref()
		if project == null or project.current == null:
			return
		if project.current_scene == "c011ec70-2026-4113-8113-000000000031" and not gui_started:
			gui_started = true
			button.show()
			button.grab_focus()
		var now_msec := Time.get_ticks_msec()
		if now_msec - sampled_msec >= 50:
			sampled_msec = now_msec
			print("PAUSE_SAMPLE:" + JSON.stringify(project._snapshot(), "", true, true))
		var next_key := str(project.visit_index) + ":" + str(project.state_revision) + ":" + str(project.pause_phase) + ":" + str(button.visible)
		if next_key != capture_key and not capture_pending:
			capture_key = next_key
			capture_pending = true
			_capture()
	func _capture() -> void:
		await RenderingServer.frame_post_draw
		var project = owner_ref.get_ref()
		if project != null and project.current != null:
			captures += 1
			var stem := "frame-%03d" % captures
			var snapshot = project._snapshot()
			var target: String = project.sample_directory.path_join(stem)
			assert(get_viewport().get_texture().get_image().save_png(target + ".png") == OK)
			var file := FileAccess.open(target + ".json", FileAccess.WRITE)
			assert(file != null)
			file.store_string(JSON.stringify(snapshot, "", true, true) + "\n")
			file.close()
		capture_pending = false
func _ready() -> void:
	super._ready()
	assert(DirAccess.make_dir_recursive_absolute(sample_directory) == OK)
	monitor = Monitor.new()
	monitor.owner_ref = weakref(self)
	monitor.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(monitor)

func _hud_labels(node: Node, result: Array) -> void:
	if node is Label:
		result.append({"text": node.text, "visible": node.is_visible_in_tree()})
	for child in node.get_children():
		_hud_labels(child, result)

func _snapshot() -> Dictionary:
	var actors: Dictionary = {}
	var audio: Dictionary = {}
	var animation: Dictionary = {}
	var hud: Array = []
	var pause_texts: Array = []
	_hud_labels(pause_input.overlay, pause_texts)
	var identities: Dictionary = {}
	var ticks: Dictionary = {}
	var phase := "unavailable"
	var scene = current
	if is_instance_valid(scene):
		identities["scene"] = scene.get_instance_id()
		for declaration in scene.actors:
			var node = declaration.get("node")
			if not is_instance_valid(node) or not node is Node2D:
				continue
			var identity: String = declaration["instanceId"]
			actors[identity] = {"id": node.get_instance_id(), "position": [node.position.x, node.position.y], "visible": node.visible, "class": node.get_class()}
			if node is CollisionObject2D:
				actors[identity]["collisionLayer"] = node.collision_layer
				actors[identity]["collisionMask"] = node.collision_mask
			if node is CharacterBody2D:
				actors[identity]["velocity"] = [node.velocity.x, node.velocity.y]
		for behavior in scene.find_children("behavior_*", "", true, false):
			identities[behavior.name] = behavior.get_instance_id()
			if behavior.get("pause_test_idle_ticks") != null:
				ticks[behavior.name] = [behavior.pause_test_idle_ticks, behavior.pause_test_physics_ticks]
			if behavior.has_meta("viento_project_pause"):
				phase = behavior.get_meta("viento_project_pause").status()
			if behavior.get("action_name") == "pause":
				identities["restartArmed"] = behavior.get("_armed")
			if behavior.get("action_name") == "start_retry":
				identities["startArmed"] = behavior.get("_armed")
		var camera = scene.find_child("VientoCamera2DView", true, false)
		if camera != null:
			identities["camera"] = camera.get_instance_id()
		var overlay = scene.get_node_or_null("VientoHUD2D")
		if overlay != null:
			identities["hud"] = overlay.get_instance_id()
			_hud_labels(overlay, hud)
		var players = scene.get("audio_players")
		if players is Dictionary:
			for key in players:
				var player = players[key]
				audio[key] = {"id": player.get_instance_id(), "playing": player.playing, "position": player.get_playback_position(), "streamPaused": player.stream_paused}
		var visuals = scene.get("animation_visuals")
		if visuals is Dictionary:
			animation = {"time": scene.get("animation_time"), "phase": scene.get("project_animation_phase"), "visuals": {}}
			for key in visuals:
				var visual = visuals[key]
				animation["visuals"][key] = {"id": visual.get_instance_id(), "rotation": visual.rotation_degrees}
	return {"sceneId": current_scene, "visit": visit_index, "state": shared_state.duplicate(true), "stateRevision": state_revision, "actors": actors, "identities": identities, "audio": audio, "animation": animation, "hudTexts": hud, "budget": execution_budget.snapshot(), "eventSequence": event_bus.sequence, "audioSequence": audio_control.sequence, "animationSequence": animation_control.sequence, "subscriptions": event_bus.subscriptions.size(), "elapsedSeconds": elapsed_seconds, "totalSeconds": total_seconds, "focused": get_window().has_focus(), "pauseTexts": pause_texts, "pauseOverlayVisible": pause_input.overlay.visible, "phase": phase, "treePaused": get_tree().paused, "ticks": ticks, "guiOpen": monitor.button.visible, "guiCount": monitor.gui_count, "keys": monitor.keys.duplicate()}
