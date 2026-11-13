extends "res://restart-project-runtime.gd"

# Read-only test observer. It forwards the selected inherited physics clock once,
# records native state, consumes only the explicit test GUI keys, and never sends
# gameplay events, mutates actor/state data or replaces generated scripts.
@export var sample_directory: String = "user://restart-observations"
var _observer_frames := 0
var _capture_pending := false
var _last_capture_key := ""
var _gui_button: Button
var _gui_count := 0
var _gui_started := false
var _observer_keys: Dictionary = {}
var _observer_error_reported := false

func _ready() -> void:
	super._ready()
	if DirAccess.make_dir_recursive_absolute(sample_directory) != OK:
		_observer_error("Cannot create the restart observation directory.")
	var layer := CanvasLayer.new()
	layer.layer = 2
	_gui_button = Button.new()
	_gui_button.text = "Test GUI consumes restart keys; F8 closes it"
	_gui_button.position = Vector2(240, 464)
	_gui_button.size = Vector2(480, 44)
	_gui_button.gui_input.connect(_consume_gui)
	layer.add_child(_gui_button)
	add_child(layer)
	_gui_button.hide()

func _consume_gui(event: InputEvent) -> void:
	if event.is_action("restart_game"):
		if event.is_pressed() and not event.is_echo():
			_gui_count += 1
		_gui_button.accept_event()
		print("RESTART_GUI_HANDLED:" + JSON.stringify({"pressed": event.is_pressed(), "handled": get_viewport().is_input_handled()}))

func _input(event: InputEvent) -> void:
	if event is InputEventKey:
		_observer_keys[str(event.physical_keycode)] = event.pressed
		var states: Array = []
		for behavior in current.find_children("behavior_*", "", true, false):
			if behavior.get("_armed") != null:
				states.append({"name": behavior.name, "armed": behavior.get("_armed"), "active": behavior.get("_active"), "focused": behavior.get("_focused"), "candidate": behavior.get("_candidate_event_id")})
		print("RESTART_KEY:" + JSON.stringify({"physical": event.physical_keycode, "key": event.keycode, "pressed": event.pressed, "echo": event.echo, "start": event.is_action("start_retry"), "restart": event.is_action("restart_game"), "states": states, "focusOwner": str(get_viewport().gui_get_focus_owner()), "handled": get_viewport().is_input_handled(), "eventId": event.get_instance_id()}))
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_F8:
		_gui_button.hide()
		_gui_button.release_focus()
		get_viewport().set_input_as_handled()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey:
		print("RESTART_UNHANDLED:" + JSON.stringify({"pressed": event.pressed, "key": event.physical_keycode, "eventId": event.get_instance_id(), "handled": get_viewport().is_input_handled()}))

func enter_scene(scene_id: String) -> void:
	super.enter_scene(scene_id)
	if scene_id == "c011ec70-2026-4113-8113-000000000031" and _gui_button != null and not _gui_started:
		_gui_started = true
		_gui_button.show()
		_gui_button.grab_focus()
	# Capture before the first inherited step advances this new visit's clocks.
	print("RESTART_ENTER:" + JSON.stringify(_snapshot(), "", true, true))

func _native_nodes(node: Node, rows: Array) -> void:
	rows.append({"ref": weakref(node), "id": node.get_instance_id(), "class": node.get_class()})
	for child in node.get_children():
		_native_nodes(child, rows)

func leave_scene(reason: String, next_scene: String = "") -> void:
	var all_nodes: Array = []
	_native_nodes(current, all_nodes)
	var last_snapshot := _snapshot()
	super.leave_scene(reason, next_scene)
	for row in all_nodes:
		assert(row["ref"].get_ref() == null, "old visit native node survived teardown")
	print("RESTART_LEAVE:" + JSON.stringify({"last": last_snapshot, "allNodesFreed": true, "nodeCount": all_nodes.size()}, "", true, true))

func _physics_process(delta: float) -> void:
	super._physics_process(delta)
	if current == null:
		return
	_observer_frames += 1
	if not _capture_pending and _capture_key() != _last_capture_key:
		_capture_pending = true
		_capture_rendered_frame()
	if _observer_frames % 3 == 0:
		print("RESTART_SAMPLE:" + JSON.stringify(_snapshot(), "", true, true))

func _capture_key() -> String:
	return current_scene + ":" + str(visit_index) + ":" + str(state_revision)

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
	var identities: Dictionary = {}
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
			if behavior.get("action_name") == "restart_game":
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
				audio[key] = {"id": player.get_instance_id(), "playing": player.playing, "position": player.get_playback_position()}
		var visuals = scene.get("animation_visuals")
		if visuals is Dictionary:
			animation = {"time": scene.get("animation_time"), "phase": scene.get("project_animation_phase"), "visuals": {}}
			for key in visuals:
				var visual = visuals[key]
				animation["visuals"][key] = {"id": visual.get_instance_id(), "rotation": visual.rotation_degrees}
	return {"sceneId": current_scene, "visit": visit_index, "state": shared_state.duplicate(true), "stateRevision": state_revision, "actors": actors, "identities": identities, "audio": audio, "animation": animation, "hudTexts": hud, "budget": execution_budget.snapshot(), "eventSequence": event_bus.sequence, "audioSequence": audio_control.sequence, "animationSequence": animation_control.sequence, "subscriptions": event_bus.subscriptions.size(), "elapsedSeconds": elapsed_seconds, "totalSeconds": total_seconds, "focused": get_window().has_focus(), "actionDown": Input.is_action_pressed("restart_game"), "guiOpen": _gui_button.visible if _gui_button != null else true, "guiCount": _gui_count, "keys": _observer_keys.duplicate()}

func _capture_rendered_frame() -> void:
	await RenderingServer.frame_post_draw
	if current != null and is_inside_tree():
		var snapshot := _snapshot()
		var stem := "visit-%02d-state-%04d" % [snapshot["visit"], snapshot["stateRevision"]]
		var target := sample_directory.path_join(stem + ".png")
		var texture := get_viewport().get_texture()
		if texture == null or texture.get_image().save_png(target) != OK:
			_observer_error("Cannot save rendered restart frame.")
		else:
			var file := FileAccess.open(sample_directory.path_join(stem + ".json"), FileAccess.WRITE)
			if file == null:
				_observer_error("Cannot save paired restart snapshot.")
			else:
				file.store_string(JSON.stringify(snapshot, "", true, true) + "\n")
				file.close()
	_last_capture_key = _capture_key()
	_capture_pending = false

func _observer_error(message: String) -> void:
	if not _observer_error_reported:
		_observer_error_reported = true
		print("RESTART_OBSERVER_ERROR:" + message)
