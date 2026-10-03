extends Node2D

var actors: Array[Dictionary] = []
var smoke := false

func emit(event: String, data: Dictionary = {}) -> void:
	data["protocol"] = 1
	data["event"] = event
	print("VIENTO_RUNTIME:" + JSON.stringify(data))

func fail(message: String, actor: Dictionary = {}) -> void:
	emit("diagnostic", {"severity": "error", "code": "runtime_image_failed", "message": message,
		"objectId": actor.get("objectId", ""), "resourceId": actor.get("imageResourceId", "")})
	get_tree().quit(1)

func _ready() -> void:
	smoke = "--viento-smoke" in OS.get_cmdline_user_args()
	var scene: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://scene.json"))
	RenderingServer.set_default_clear_color(Color(scene["background"]))
	var title := Label.new()
	title.text = scene["title"] + "  |  Arrow keys: move  |  Esc: close"
	title.position = Vector2(16, 12)
	add_child(title)
	for declaration in scene["actors"]:
		var actor: Dictionary = declaration.duplicate(true)
		var node := Node2D.new()
		node.name = "actor_" + actor["objectId"].replace("-", "_")
		node.set_meta("viento_object_id", actor["objectId"])
		node.position = Vector2(actor["position"][0], actor["position"][1])
		var extent := Vector2(actor["size"][0], actor["size"][1])
		if actor.has("imageFile"):
			var texture := load("res://" + actor["imageFile"]) as Texture2D
			if texture == null:
				fail("Cannot load generated image.", actor)
				return
			var sprite := Sprite2D.new()
			sprite.texture = texture
			sprite.scale = extent / texture.get_size()
			sprite.modulate = Color(actor["color"])
			node.add_child(sprite)
		else:
			var shape := Polygon2D.new()
			shape.polygon = PackedVector2Array([Vector2(-extent.x, -extent.y), Vector2(extent.x, -extent.y), extent, Vector2(-extent.x, extent.y)])
			shape.scale = Vector2(0.5, 0.5)
			shape.color = Color(actor["color"])
			node.add_child(shape)
		var label := Label.new()
		label.text = actor["name"]
		label.position = Vector2(-extent.x / 2, extent.y / 2 + 4)
		node.add_child(label)
		add_child(node)
		actor["node"] = node
		actor["state"] = "idle"
		actors.append(actor)
	emit("ready", {"sceneObjectId": scene["objectId"], "actors": states()})
	if smoke:
		set_process(false)
		call_deferred("run_smoke")

func states() -> Array:
	var result := []
	for actor in actors:
		var position: Vector2 = actor["node"].position
		result.append({"objectId": actor["objectId"], "position": [position.x, position.y], "state": actor["state"]})
	return result

func _process(delta: float) -> void:
	var input := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	for actor in actors:
		var direction := input if actor["controls"] == "arrows" else Vector2.ZERO
		var next_state := "moving" if direction != Vector2.ZERO and actor["speed"] > 0 else "idle"
		actor["node"].position += direction * actor["speed"] * delta
		if next_state != actor["state"]:
			actor["state"] = next_state
			emit("state", {"objectId": actor["objectId"], "state": next_state})
	if not smoke and Input.is_action_just_pressed("ui_cancel"):
		get_tree().quit()

func run_smoke() -> void:
	# Exercise the same input/action and movement path with a fixed time step.
	Input.action_press("ui_right")
	_process(0.25)
	Input.action_release("ui_right")
	_process(0.25)
	for actor in actors:
		var expected := Vector2(actor["position"][0], actor["position"][1])
		if actor["controls"] == "arrows":
			expected.x += actor["speed"] * 0.25
		if not actor["node"].position.is_equal_approx(expected) or actor["state"] != "idle":
			emit("diagnostic", {"severity": "error", "code": "runtime_smoke_failed", "objectId": actor["objectId"], "message": "Movement or state mismatch."})
			get_tree().quit(1)
			return
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--viento-capture="):
			await RenderingServer.frame_post_draw
			var error := get_viewport().get_texture().get_image().save_png(argument.trim_prefix("--viento-capture="))
			if error != OK:
				emit("diagnostic", {"severity": "error", "code": "runtime_capture_failed", "message": "Cannot save preview frame."})
				get_tree().quit(1)
				return
	emit("finished", {"actors": states(), "fixedDelta": 0.25})
	get_tree().quit()
