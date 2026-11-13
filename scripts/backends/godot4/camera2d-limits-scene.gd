extends "res://camera2d-scene.gd"

# This optional outer view layer has no movement, collision or animation authority.
# Keep the historical camera loader and its v1 document intact; authenticate the
# full bounded declaration separately before binding the same logical root.
@export var camera_limits_document := ""
var limits_declaration: Dictionary = {}
var logical_target: WeakRef

func install_camera() -> void:
	var file := FileAccess.open(camera_limits_document, FileAccess.READ)
	if file == null or file.get_length() > 16384:
		camera_fail()
		return
	var document = JSON.parse_string(file.get_as_text())
	if not document is Dictionary or document.get("format") != "viento-scene-camera2d" or document.get("schemaVersion") != 2 or not document.get("camera") is Dictionary:
		camera_fail()
		return
	var declaration: Dictionary = document["camera"]
	var limits = declaration.get("limits")
	if not limits is Dictionary or limits.size() != 4:
		camera_fail()
		return
	for key in ["left", "top", "right", "bottom"]:
		var coordinate = limits.get(key)
		if not (typeof(coordinate) == TYPE_FLOAT or typeof(coordinate) == TYPE_INT) or not is_finite(float(coordinate)) or abs(float(coordinate)) > 100000.0:
			camera_fail()
			return
	if limits["left"] >= limits["right"] or limits["top"] >= limits["bottom"]:
		camera_fail()
		return
	limits_declaration = declaration
	super.install_camera()
	if not is_instance_valid(camera):
		return
	if declaration.get("mode") == "follow":
		logical_target = weakref(camera.get_parent())
	# Native offset is applied after native limits. Use a world-space center with
	# zero native offset so the authored follow offset cannot escape the bounds.
	camera.top_level = true
	camera.offset = Vector2.ZERO
	update_limited_camera()

func _process(_delta: float) -> void:
	if is_instance_valid(camera):
		update_limited_camera()

func update_limited_camera() -> void:
	var desired := Vector2.ZERO
	if limits_declaration.get("mode") == "fixed":
		var center = limits_declaration.get("center")
		if not camera_pair(center):
			camera_fail()
			return
		desired = Vector2(center[0], center[1])
	elif limits_declaration.get("mode") == "follow":
		var target = logical_target.get_ref() if logical_target != null else null
		var offset = limits_declaration.get("offset")
		if not is_instance_valid(target) or not target is Node2D or not camera_pair(offset):
			camera_fail()
			return
		desired = target.global_position + Vector2(offset[0], offset[1])
	else:
		camera_fail()
		return
	var visible := camera.get_viewport().get_visible_rect().size
	var half := visible / camera.zoom / 2.0
	var limits: Dictionary = limits_declaration["limits"]
	camera.global_position = Vector2(limited_axis(desired.x, float(limits["left"]), float(limits["right"]), half.x), limited_axis(desired.y, float(limits["top"]), float(limits["bottom"]), half.y))
	camera.force_update_scroll()

func limited_axis(desired: float, low: float, high: float, half: float) -> float:
	if high - low < half * 2.0:
		return (low + high) / 2.0
	return clampf(desired, low + half, high - half)
