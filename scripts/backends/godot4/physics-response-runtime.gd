extends "__PHYSICS_RUNTIME__"

# This opt-in layer preserves the explicit project-step delta and legacy stop
# call. It introduces no implicit velocity, gravity, floor or platform policy.
var physics_responses: Dictionary = {}

func _ready() -> void:
	super._ready()
	if physics_failed:
		return
	var declaration = JSON.parse_string(FileAccess.get_file_as_string("__PHYSICS_DOCUMENT__"))
	if not declaration is Dictionary or declaration.get("schemaVersion") != 2:
		physics_fail("Cannot read the generated collision responses.")
		return
	for body in declaration["bodies"]:
		if body["kind"] != "character":
			continue
		var response: String = body.get("collisionResponse", "stop")
		if response != "stop" and response != "slide":
			physics_fail("Generated collision response is unavailable.")
			return
		physics_responses[body["instanceId"]] = response

func physics_slide(character: CharacterBody2D, motion: Vector2) -> void:
	var remainder := motion
	# Each sweep consumes only its untravelled tangent. The fixed bound also
	# terminates initial overlap and corners without an unbounded retry loop.
	for _attempt in range(4):
		var collision := character.move_and_collide(remainder)
		if collision == null:
			return
		remainder = collision.get_remainder().slide(collision.get_normal())
		if remainder.is_zero_approx():
			return

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
			if physics_responses.get(actor["instanceId"], "stop") == "slide":
				physics_slide(character, motion)
			else:
				character.move_and_collide(motion)
		elif kind == "":
			actor["node"].position += motion
		if next_state != actor["state"]:
			actor["state"] = next_state
			emit("state", {"instanceId": actor["instanceId"], "objectId": actor["objectId"], "state": next_state})
