extends "__PHYSICS_RUNTIME__"

# Only built-in character moves are sampled. Interactive runs call the original
# runtime unchanged, and no additional native movement or collision query runs.
var physics_observation_enabled := false
var physics_observation_bodies: Dictionary = {}
var physics_observation_scene := ""
var physics_observation_step := 0
var physics_observation_time := 0.0

func _ready() -> void:
	super._ready()
	physics_observation_enabled = "--viento-smoke" in OS.get_cmdline_user_args()
	if physics_failed or not physics_observation_enabled:
		return
	var declaration: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("__PHYSICS_DOCUMENT__"))
	physics_observation_scene = declaration["sceneObjectId"]
	for body in declaration["bodies"]:
		physics_observation_bodies[body["instanceId"]] = body

func physics_observation_vector(value: Vector2) -> Array:
	return [value.x, value.y]

func physics_observation_contact(collision: KinematicCollision2D) -> Dictionary:
	var collider = null
	var native = collision.get_collider()
	for actor in actors:
		if actor["node"] != native:
			continue
		var body: Dictionary = physics_observation_bodies.get(actor["instanceId"], {})
		if not body.is_empty() and body["kind"] != "sensor":
			collider = {"bodyId": body["id"], "instanceId": actor["instanceId"]}
		break
	return {"collider": collider, "position": physics_observation_vector(collision.get_position()),
		"normal": physics_observation_vector(collision.get_normal()), "travel": physics_observation_vector(collision.get_travel()),
		"remainder": physics_observation_vector(collision.get_remainder())}

func physics_observation_move(character: CharacterBody2D, motion: Vector2, response: String) -> Array:
	var contacts := []
	var remainder := motion
	for _attempt in range(4 if response == "slide" else 1):
		var collision := character.move_and_collide(remainder)
		if collision == null:
			break
		contacts.append(physics_observation_contact(collision))
		if response != "slide":
			break
		remainder = collision.get_remainder().slide(collision.get_normal())
		if remainder.is_zero_approx():
			break
	return contacts

func _process(delta: float) -> void:
	if not physics_observation_enabled:
		super._process(delta)
		return
	if physics_failed:
		return
	physics_observation_step += 1
	physics_observation_time += delta
	var input := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	for actor in actors:
		var direction := input if actor["controls"] == "arrows" else Vector2.ZERO
		var motion: Vector2 = direction * actor["speed"] * delta
		var next_state := "moving" if direction != Vector2.ZERO and actor["speed"] > 0 else "idle"
		var kind: String = physics_bodies.get(actor["instanceId"], "")
		if kind == "character":
			var character: CharacterBody2D = actor["node"]
			var body: Dictionary = physics_observation_bodies[actor["instanceId"]]
			var before := character.global_position
			var contacts := physics_observation_move(character, motion, body.get("collisionResponse", "stop"))
			get("project_host").physics_observe(get("project_visit"), physics_observation_scene,
				{"stepIndex": physics_observation_step, "timeSeconds": physics_observation_time, "deltaSeconds": delta,
				"bodyId": body["id"], "instanceId": actor["instanceId"], "positionBefore": physics_observation_vector(before),
				"positionAfter": physics_observation_vector(character.global_position), "requestedMotion": physics_observation_vector(motion),
				"contacts": contacts})
		elif kind == "":
			actor["node"].position += motion
		if next_state != actor["state"]:
			actor["state"] = next_state
			emit("state", {"instanceId": actor["instanceId"], "objectId": actor["objectId"], "state": next_state})
