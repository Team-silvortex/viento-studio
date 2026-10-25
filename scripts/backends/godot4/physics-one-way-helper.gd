extends RefCounted

# Called once after native roots exist and before author behaviors are attached.
# Godot owns every one-way test. This helper never moves or queries a body.
static func install(scene: Node, document_path: String) -> bool:
	if scene.physics_failed:
		return false
	var document = JSON.parse_string(FileAccess.get_file_as_string(document_path))
	if not document is Dictionary or document.get("format") != "viento-godot-one-way2d":
		scene.physics_fail("Cannot read the generated one-way platform declaration.")
		return false
	for body in document["bodies"]:
		var actor: Dictionary = {}
		for candidate in scene.actors:
			if candidate["instanceId"] == body["instanceId"]:
				actor = candidate
				break
		if actor.is_empty() or not actor["node"] is StaticBody2D:
			scene.physics_fail("Generated one-way platform is unavailable.", actor)
			return false
		var collision = actor["node"].get_node_or_null("VientoCollision")
		if not collision is CollisionShape2D or not collision.shape is RectangleShape2D:
			scene.physics_fail("Generated one-way platform shape is unavailable.", actor)
			return false
		collision.one_way_collision = true
		collision.one_way_collision_margin = body["oneWay"]["margin"]
	return true
