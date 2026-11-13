extends "res://retry-project-runtime.gd"

# Test-only observer. This script does not drive input, send gameplay events,
# change actors or replace the generated runtime's update/close behavior.
@export var sample_directory: String = "user://topdown-observations"
var _observer_frames := 0
var _capture_pending := false
var _last_capture_key := ""
var _observer_error_reported := false

func _ready() -> void:
	super._ready()
	if DirAccess.make_dir_recursive_absolute(sample_directory) != OK:
		_observer_error("Cannot create the observer output directory.")

func _physics_process(delta: float) -> void:
	super._physics_process(delta)
	_observer_frames += 1
	if not _capture_pending and _capture_key() != _last_capture_key:
		_capture_pending = true
		_capture_rendered_frame()
	if _observer_frames % 3 != 0:
		return
	var snapshot := _snapshot()
	var encoded := JSON.stringify(snapshot, "", true, true)
	print("TOPDOWN_SAMPLE:" + encoded)
	_write_atomic(sample_directory.path_join("latest.json"), encoded)

func _capture_key() -> String:
	return current_scene + ":" + str(visit_index) + ":" + str(state_revision)

func _hud_labels(node: Node, result: Array) -> void:
	if node is Label:
		result.append({"text": node.text, "visible": node.is_visible_in_tree()})
	for child in node.get_children():
		_hud_labels(child, result)

func _snapshot() -> Dictionary:
	var actor_rows: Dictionary = {}
	var body_layers: Dictionary = {}
	var hud_texts: Array = []
	var scene = current
	if is_instance_valid(scene):
		var declared = scene.get("actors")
		if declared is Array:
			for declaration in declared:
				if not declaration is Dictionary:
					continue
				var node = declaration.get("node")
				if not is_instance_valid(node) or not node is Node2D:
					continue
				var identity: String = declaration.get("instanceId", "")
				actor_rows[identity] = {
					"objectId": declaration.get("objectId", ""),
					"nativeClass": node.get_class(),
					"position": [node.position.x, node.position.y],
					"globalPosition": [node.global_position.x, node.global_position.y],
					"visible": node.visible,
					"visibleInTree": node.is_visible_in_tree(),
					"movementState": declaration.get("state", "")
				}
				if node is CollisionObject2D:
					actor_rows[identity]["collisionLayer"] = node.collision_layer
					actor_rows[identity]["collisionMask"] = node.collision_mask
				if node is Area2D:
					actor_rows[identity]["monitoring"] = node.monitoring
				if node is StaticBody2D:
					body_layers[identity] = {"layer": node.collision_layer, "mask": node.collision_mask}
		for child in scene.get_children():
			if child is CanvasLayer:
				_hud_labels(child, hud_texts)
	var window := get_window()
	return {
		"sceneId": current_scene,
		"visit": visit_index,
		"stateRevision": state_revision,
		"state": shared_state.duplicate(true),
		"actors": actor_rows,
		"doorLayers": body_layers,
		"hudTexts": hud_texts,
		"focused": window.has_focus() if is_instance_valid(window) else false,
		"idleFrame": Engine.get_process_frames(),
		"physicsFrame": Engine.get_physics_frames(),
		"elapsedSeconds": elapsed_seconds,
		"totalSeconds": total_seconds,
		"failed": failed,
		"finished": finished
	}

func _capture_rendered_frame() -> void:
	if DisplayServer.get_name() == "headless":
		_last_capture_key = _capture_key()
		_capture_pending = false
		return
	await RenderingServer.frame_post_draw
	if not is_inside_tree():
		_capture_pending = false
		return
	# Re-read after rendering: the paired JSON describes the same completed
	# frame as the image, rather than the earlier state that requested capture.
	var snapshot := _snapshot()
	var stem := "visit-%02d-state-%04d-frame-%06d" % [snapshot["visit"], snapshot["stateRevision"], snapshot["idleFrame"]]
	var capture_path := sample_directory.path_join(stem + ".png")
	var texture := get_viewport().get_texture()
	if texture == null:
		_observer_error("The rendered viewport texture is unavailable.")
	else:
		var image := texture.get_image()
		if image == null or image.save_png(capture_path) != OK:
			_observer_error("Cannot save the rendered observer capture.")
		else:
			snapshot["capturePath"] = capture_path
			_write_atomic(sample_directory.path_join(stem + ".json"), JSON.stringify(snapshot, "", true, true))
	_last_capture_key = _capture_key()
	_capture_pending = false

func _write_atomic(path: String, content: String) -> void:
	var temporary := path + ".tmp"
	var file := FileAccess.open(temporary, FileAccess.WRITE)
	if file == null:
		_observer_error("Cannot open the observer JSON output.")
		return
	file.store_string(content + "\n")
	file.flush()
	var written := file.get_error()
	file.close()
	if written != OK or DirAccess.rename_absolute(temporary, path) != OK:
		_observer_error("Cannot atomically publish the observer JSON output.")

func _observer_error(message: String) -> void:
	if not _observer_error_reported:
		_observer_error_reported = true
		print("TOPDOWN_OBSERVER_ERROR:" + message)
