extends "__PHYSICS_RUNTIME__"

# The project clock calls this same explicit-delta movement in live and smoke.
# Ground and velocity belong to this scene visit, never to an actor's document.
var character_motion_configs: Dictionary = {}
var character_motion_velocities: Dictionary = {}
var character_motion_grounded: Dictionary = {}
var character_motion_jump_held := false

func _ready() -> void:
	super._ready()
	if physics_failed:
		return
	var declaration: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("__PHYSICS_DOCUMENT__"))
	physics_observation_scene = declaration["sceneObjectId"]
	for body in declaration["bodies"]:
		physics_observation_bodies[body["instanceId"]] = body
	var document: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("__MOTION_DOCUMENT__"))
	for body in document["bodies"]:
		var instance_id: String = body["instanceId"]
		character_motion_configs[instance_id] = body["characterMotion"]
		character_motion_velocities[instance_id] = Vector2.ZERO
		character_motion_grounded[instance_id] = false
	character_motion_jump_held = Input.is_action_pressed("ui_accept")

func _process(delta: float) -> void:
	if physics_failed:
		return
	if physics_observation_enabled:
		physics_observation_step += 1
		physics_observation_time += delta
	var input := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	var horizontal := Input.get_axis("ui_left", "ui_right")
	var jump_held := Input.is_action_pressed("ui_accept")
	var jump_pressed := jump_held and not character_motion_jump_held
	for actor in actors:
		var instance_id: String = actor["instanceId"]
		var direction := input if actor["controls"] == "arrows" else Vector2.ZERO
		var motion: Vector2 = direction * actor["speed"] * delta
		var next_state := "moving" if direction != Vector2.ZERO and actor["speed"] > 0 else "idle"
		var kind: String = physics_bodies.get(instance_id, "")
		if kind == "character":
			var character: CharacterBody2D = actor["node"]
			var body: Dictionary = physics_observation_bodies[instance_id]
			var motor: Dictionary = character_motion_configs.get(instance_id, {})
			var velocity: Vector2 = character_motion_velocities.get(instance_id, Vector2.ZERO)
			if not motor.is_empty():
				velocity.x = horizontal * actor["speed"] if actor["controls"] == "arrows" else 0.0
				velocity.y = minf(velocity.y + motor["gravity"] * delta, motor["maxFallSpeed"])
				if jump_pressed and actor["controls"] == "arrows" and character_motion_grounded[instance_id] and motor["jumpSpeed"] > 0.0:
					velocity.y = -motor["jumpSpeed"]
				motion = velocity * delta
				# Preserve the existing movement state as an input-intent signal.
				next_state = "moving" if horizontal != 0.0 and actor["controls"] == "arrows" and actor["speed"] > 0 else "idle"
			var before := character.global_position
			var contacts := physics_observation_move(character, motion, body.get("collisionResponse", "stop"))
			if not motor.is_empty():
				var grounded := false
				for contact in contacts:
					var normal := Vector2(contact["normal"][0], contact["normal"][1])
					if normal.y <= -0.7:
						grounded = true
					if velocity.dot(normal) < 0.0:
						velocity = velocity.slide(normal)
				character_motion_velocities[instance_id] = velocity
				character_motion_grounded[instance_id] = grounded
			if physics_observation_enabled:
				get("project_host").physics_observe(get("project_visit"), physics_observation_scene,
					{"stepIndex": physics_observation_step, "timeSeconds": physics_observation_time, "deltaSeconds": delta,
					"bodyId": body["id"], "instanceId": instance_id, "positionBefore": physics_observation_vector(before),
					"positionAfter": physics_observation_vector(character.global_position), "requestedMotion": physics_observation_vector(motion),
					"contacts": contacts})
		elif kind == "":
			actor["node"].position += motion
		if next_state != actor["state"]:
			actor["state"] = next_state
			emit("state", {"instanceId": instance_id, "objectId": actor["objectId"], "state": next_state})
	character_motion_jump_held = jump_held
