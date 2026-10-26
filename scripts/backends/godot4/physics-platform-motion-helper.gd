extends RefCounted

# Declared horizontal trajectories and native support facts are separate from
# input, animation, project events and the character's sole movement solver.
var opened := true
var initialized := false
var host: WeakRef
var platforms: Dictionary = {}
var characters: Dictionary = {}
var supports: Dictionary = {}
var carries: Dictionary = {}

func active(scene: Node) -> bool:
	return opened and is_instance_valid(scene) and scene.project_open and not scene.physics_failed and scene.project_host.state_access(scene.project_visit)

func install(scene: Node, document_path: String) -> void:
	if initialized:
		return
	initialized = true
	host = weakref(scene)
	if scene.physics_failed:
		return
	var document = JSON.parse_string(FileAccess.get_file_as_string(document_path))
	if not document is Dictionary or document.get("format") != "viento-godot-platform-motion2d":
		scene.physics_fail("Cannot read the generated platform movement declaration.")
		return
	for body in document["bodies"]:
		var actor: Dictionary = {}
		for candidate in scene.actors:
			if candidate["instanceId"] == body["instanceId"]:
				actor = candidate
				break
		if actor.is_empty() or not actor["node"] is StaticBody2D:
			scene.physics_fail("Generated moving platform is unavailable.", actor)
			return
		var original: StaticBody2D = actor["node"]
		var collision = original.get_node_or_null("VientoCollision")
		if not collision is CollisionShape2D or not collision.shape is RectangleShape2D:
			scene.physics_fail("Generated moving platform shape is unavailable.", actor)
			return
		var native := AnimatableBody2D.new()
		native.name = original.name
		native.transform = original.transform
		native.collision_layer = original.collision_layer
		native.collision_mask = original.collision_mask
		# The project clock owns the explicit step in both live and smoke runs.
		native.sync_to_physics = false
		for key in original.get_meta_list():
			native.set_meta(key, original.get_meta(key))
		for child in original.get_children():
			original.remove_child(child)
			native.add_child(child)
		var index := original.get_index()
		scene.remove_child(original)
		original.free()
		scene.add_child(native)
		scene.move_child(native, index)
		actor["node"] = native
		platforms[body["instanceId"]] = {"bodyId": body["bodyId"], "node": weakref(native), "shape": weakref(collision),
			"origin": native.global_position, "motion": body["platformMotion"], "phase": 0.0, "delta": Vector2.ZERO}
	for actor in scene.actors:
		if actor["instanceId"] in document["characters"] and actor["node"] is CharacterBody2D:
			characters[actor["instanceId"]] = weakref(actor["node"])
	scene.tree_exiting.connect(revoke)

func shape_rect(body: PhysicsBody2D):
	if not is_instance_valid(body):
		return null
	var shape = body.get_node_or_null("VientoCollision")
	if not shape is CollisionShape2D or shape.disabled or not (shape.shape is RectangleShape2D or shape.shape is CircleShape2D):
		return null
	var rectangle: Rect2 = shape.global_transform * shape.shape.get_rect()
	return rectangle if rectangle.is_finite() and rectangle.has_area() else null

func supported(scene: Node, instance_id: String) -> String:
	if not supports.has(instance_id) or not characters.has(instance_id) or not scene.character_motion_grounded.get(instance_id, false):
		return ""
	var support: Dictionary = supports[instance_id]
	var platform_id: String = support["platform"]
	if not platforms.has(platform_id):
		return ""
	var character = characters[instance_id].get_ref()
	var platform = platforms[platform_id]["node"].get_ref()
	var character_rect = shape_rect(character)
	var platform_rect = shape_rect(platform)
	if character_rect == null or platform_rect == null or not character_rect.is_equal_approx(support["characterRect"]) or not platform_rect.is_equal_approx(support["platformRect"]):
		return ""
	if character.get_collision_exceptions().has(platform) or platform.get_collision_exceptions().has(character) or (character.collision_mask & platform.collision_layer) == 0:
		return ""
	return platform_id

# Existing drop commands have already run. Validate the last support before
# changing a platform; no transform/query is used to invent a new contact.
func begin(scene: Node, delta: float) -> void:
	carries.clear()
	if not active(scene) or not is_finite(delta) or delta < 0.0:
		return
	for instance_id in supports:
		var platform_id := supported(scene, instance_id)
		if not platform_id.is_empty():
			carries[instance_id] = platform_id
	for platform in platforms.values():
		var node = platform["node"].get_ref()
		if not is_instance_valid(node):
			continue
		var motion: Dictionary = platform["motion"]
		var distance: float = absf(float(motion["offsetX"]))
		platform["phase"] = fposmod(float(platform["phase"]) + float(motion["speed"]) * delta, distance * 2.0)
		var phase: float = platform["phase"]
		var travelled: float = phase if phase <= distance else distance * 2.0 - phase
		var before: Vector2 = node.global_position
		node.global_position = platform["origin"] + Vector2(signf(float(motion["offsetX"])) * travelled, 0.0)
		platform["delta"] = node.global_position - before
	supports.clear()

# Called after the old motor has accepted/rejected jumping, immediately before
# its original observation and single movement pass. Airborne/jumping bodies
# and characters that requested drop-through never inherit platform movement.
func motion(scene: Node, character: CharacterBody2D, desired: Vector2, velocity: Vector2) -> Vector2:
	if not active(scene) or velocity.y < 0.0:
		return desired
	for instance_id in carries:
		if characters[instance_id].get_ref() != character:
			continue
		var platform: Dictionary = platforms[carries[instance_id]]
		var node = platform["node"].get_ref()
		if is_instance_valid(node) and not character.get_collision_exceptions().has(node) and not node.get_collision_exceptions().has(character):
			return desired + platform["delta"]
	return desired

func sample(scene: Node, character: CharacterBody2D, contacts: Array) -> void:
	if not active(scene):
		return
	var instance_id := ""
	for candidate in characters:
		if characters[candidate].get_ref() == character:
			instance_id = candidate
			break
	if instance_id.is_empty():
		return
	var selected := ""
	for contact in contacts:
		if float(contact["normal"][1]) > -0.7:
			continue
		var collider = contact.get("collider")
		if not collider is Dictionary or not platforms.has(collider.get("instanceId", "")):
			return
		var platform_id: String = collider["instanceId"]
		if platforms[platform_id]["bodyId"] != collider.get("bodyId") or not selected.is_empty() and selected != platform_id:
			return
		selected = platform_id
	if selected.is_empty():
		return
	var character_rect = shape_rect(character)
	var platform_rect = shape_rect(platforms[selected]["node"].get_ref())
	if character_rect != null and platform_rect != null:
		supports[instance_id] = {"platform": selected, "characterRect": character_rect, "platformRect": platform_rect}

func revoke() -> void:
	opened = false
	supports.clear()
	carries.clear()
	characters.clear()
	platforms.clear()
