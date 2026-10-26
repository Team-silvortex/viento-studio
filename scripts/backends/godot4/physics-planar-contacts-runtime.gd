extends "__PLANAR_BASE_RUNTIME__"

# The frozen observation wrapper delegates live movement here. Smoke keeps its
# existing loop; both paths call its sole bounded native movement method.
func _ready() -> void:
	super._ready()
	if physics_failed:
		return
	var declaration: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("__PHYSICS_DOCUMENT__"))
	set("physics_observation_scene", declaration["sceneObjectId"])
	var bodies: Dictionary = get("physics_observation_bodies")
	for body in declaration["bodies"]:
		bodies[body["instanceId"]] = body

func _process(delta: float) -> void:
	if physics_failed:
		return
	var input := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	var bodies: Dictionary = get("physics_observation_bodies")
	for actor in actors:
		var direction := input if actor["controls"] == "arrows" else Vector2.ZERO
		var motion: Vector2 = direction * actor["speed"] * delta
		var next_state := "moving" if direction != Vector2.ZERO and actor["speed"] > 0 else "idle"
		var kind: String = physics_bodies.get(actor["instanceId"], "")
		if kind == "character":
			var body: Dictionary = bodies[actor["instanceId"]]
			call("physics_observation_move", actor["node"], motion, body.get("collisionResponse", "stop"))
		elif kind == "":
			actor["node"].position += motion
		if next_state != actor["state"]:
			actor["state"] = next_state
			emit("state", {"instanceId": actor["instanceId"], "objectId": actor["objectId"], "state": next_state})
