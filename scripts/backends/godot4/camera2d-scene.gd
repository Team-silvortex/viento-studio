extends Node

@export var camera_document := ""
var camera: Camera2D

func _ready() -> void:
	# Children become ready before their parent. Wait for the complete generated
	# actor/physics factory, then bind the final logical root exactly once.
	var scene := get_parent()
	if scene.is_node_ready():
		install_camera()
	else:
		scene.ready.connect(install_camera, CONNECT_ONE_SHOT)

func camera_fail() -> void:
	var scene := get_parent()
	if scene != null and scene.has_method("emit"):
		scene.emit("diagnostic", {"severity": "error", "code": "runtime_camera2d_invalid", "message": "Generated camera2d declaration or logical target is unavailable."})
	get_tree().quit(1)

func install_camera() -> void:
	var scene := get_parent()
	var file := FileAccess.open(camera_document, FileAccess.READ)
	if file == null or file.get_length() > 16384:
		camera_fail()
		return
	var document = JSON.parse_string(file.get_as_text())
	if not document is Dictionary or document.get("format") != "viento-scene-camera2d" or document.get("schemaVersion") != 1 or not document.get("camera") is Dictionary:
		camera_fail()
		return
	var declaration: Dictionary = document["camera"]
	var zoom_value = declaration.get("zoom")
	if not (typeof(zoom_value) == TYPE_FLOAT or typeof(zoom_value) == TYPE_INT) or not is_finite(float(zoom_value)) or zoom_value < 0.125 or zoom_value > 8.0:
		camera_fail()
		return
	var parent: Node2D = scene as Node2D
	var center := Vector2.ZERO
	var offset := Vector2.ZERO
	if declaration.get("mode") == "fixed":
		var values = declaration.get("center")
		if not camera_pair(values):
			camera_fail()
			return
		center = Vector2(values[0], values[1])
	elif declaration.get("mode") == "follow":
		var values = declaration.get("offset")
		if not camera_pair(values):
			camera_fail()
			return
		offset = Vector2(values[0], values[1])
		parent = null
		for actor in scene.get("actors"):
			if actor.get("instanceId") == declaration.get("targetInstanceId"):
				parent = actor.get("node") as Node2D
				break
	else:
		camera_fail()
		return
	if not is_instance_valid(parent):
		camera_fail()
		return
	camera = Camera2D.new()
	camera.name = "VientoCamera2DView"
	camera.enabled = false
	camera.position = center
	camera.offset = offset
	camera.zoom = Vector2(float(zoom_value), float(zoom_value))
	camera.ignore_rotation = true
	camera.position_smoothing_enabled = false
	camera.rotation_smoothing_enabled = false
	camera.drag_horizontal_enabled = false
	camera.drag_vertical_enabled = false
	# Camera2D follows only this logical root. Animation affects its visual child.
	parent.add_child(camera)
	camera.enabled = true
	camera.make_current()
	camera.reset_smoothing()
	camera.force_update_scroll()

func camera_pair(value) -> bool:
	if not value is Array or value.size() != 2:
		return false
	for coordinate in value:
		if not (typeof(coordinate) == TYPE_FLOAT or typeof(coordinate) == TYPE_INT) or not is_finite(float(coordinate)) or abs(float(coordinate)) > 100000.0:
			return false
	return true
