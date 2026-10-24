extends "__BASE_RUNTIME__"

# Native bodies own the logical root. Visual animation remains a child layer;
# author behaviors are attached by the next runtime only after these roots exist.
var physics_bodies: Dictionary = {}
var physics_failed := false

func physics_fail(message: String, actor: Dictionary = {}) -> void:
	physics_failed = true
	emit("diagnostic", {"severity": "error", "code": "runtime_physics_failed", "message": message,
		"instanceId": actor.get("instanceId", ""), "objectId": actor.get("objectId", "")})
	get_tree().quit(1)

func _ready() -> void:
	super._ready()
	var declaration = JSON.parse_string(FileAccess.get_file_as_string("__PHYSICS_DOCUMENT__"))
	if not declaration is Dictionary or declaration.get("format") != "viento-godot-physics2d":
		physics_fail("Cannot read the generated physics declaration.")
		return
	for body in declaration["bodies"]:
		var actor: Dictionary = {}
		for candidate in actors:
			if candidate["instanceId"] == body["instanceId"]:
				actor = candidate
				break
		if actor.is_empty() or physics_bodies.has(body["instanceId"]):
			physics_fail("Generated physics instance is unavailable.")
			return
		var native: CollisionObject2D
		match body["kind"]:
			"static": native = StaticBody2D.new()
			"character": native = CharacterBody2D.new()
			"sensor": native = Area2D.new()
			_:
				physics_fail("Generated physics body kind is unavailable.", actor)
				return
		var original: Node2D = actor["node"]
		var index := original.get_index()
		native.name = original.name
		native.transform = original.transform
		for key in original.get_meta_list():
			native.set_meta(key, original.get_meta(key))
		native.collision_layer = int(body["layer"])
		native.collision_mask = int(body["mask"])
		# Keep the generated visual first for the animation runtime. No authored
		# child has run _ready yet; its parent is the final native body.
		for child in original.get_children():
			original.remove_child(child)
			native.add_child(child)
		var collision := CollisionShape2D.new()
		collision.name = "VientoCollision"
		collision.position = Vector2(body["offset"][0], body["offset"][1])
		if body["shape"]["kind"] == "box":
			var rectangle := RectangleShape2D.new()
			rectangle.size = Vector2(body["shape"]["size"][0], body["shape"]["size"][1])
			collision.shape = rectangle
		else:
			var circle := CircleShape2D.new()
			circle.radius = body["shape"]["radius"]
			collision.shape = circle
		native.add_child(collision)
		remove_child(original)
		original.free()
		add_child(native)
		move_child(native, index)
		actor["node"] = native
		physics_bodies[body["instanceId"]] = body["kind"]

func _process(delta: float) -> void:
	if physics_failed:
		return
	var input := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	for actor in actors:
		var direction := input if actor["controls"] == "arrows" else Vector2.ZERO
		var motion: Vector2 = direction * actor["speed"] * delta
		var next_state := "moving" if direction != Vector2.ZERO and actor["speed"] > 0 else "idle"
		var kind: String = physics_bodies.get(actor["instanceId"], "")
		if kind == "character":
			var character: CharacterBody2D = actor["node"]
			character.move_and_collide(motion)
		elif kind == "":
			actor["node"].position += motion
		if next_state != actor["state"]:
			actor["state"] = next_state
			emit("state", {"instanceId": actor["instanceId"], "objectId": actor["objectId"], "state": next_state})
