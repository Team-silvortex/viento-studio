extends "res://platform-motion-helper.gd"

var vertical: Dictionary = {}
var gaps: Dictionary = {}
var exceptions: Dictionary = {}
var native_ground: Dictionary = {}
var advances: Dictionary = {}

# Native support probes are separate from recorded movement sweeps.
const SUPPORT_REACH := 1.1

func install(scene: Node, document_path: String) -> void:
	super.install(scene, document_path)
	var document = JSON.parse_string(FileAccess.get_file_as_string(document_path.get_base_dir() + "/platform-vertical.json"))
	if not document is Dictionary or document.get("format") != "viento-godot-platform-vertical2d":
		scene.physics_fail("Cannot read the generated vertical platform declaration.")
		return
	for body in document["bodies"]:
		vertical[body["instanceId"]] = true
		var node = platforms[body["instanceId"]]["node"].get_ref()
		# Kinematic transforms apply on the next server tick. The explicit
		# project clock needs same-step static transforms for support queries.
		PhysicsServer2D.body_set_mode(node.get_rid(), PhysicsServer2D.BODY_MODE_STATIC)

func initial_support(scene: Node, instance_id: String) -> String:
	var character = characters[instance_id].get_ref()
	if not is_instance_valid(character) or scene.character_motion_velocities.get(instance_id, Vector2.ZERO).y < 0.0:
		return ""
	var collision := KinematicCollision2D.new()
	if not character.test_move(character.global_transform, Vector2(0.0, SUPPORT_REACH), collision):
		return ""
	if collision.get_normal().y > -0.7:
		return ""
	for platform_id in vertical:
		var platform = platforms[platform_id]["node"].get_ref()
		if collision.get_collider() == platform and not character.get_collision_exceptions().has(platform) and not platform.get_collision_exceptions().has(character):
			gaps[instance_id] = maxf(0.0, collision.get_travel().y)
			return platform_id
	return ""

func permitted(node: PhysicsBody2D, displacement: Vector2, excluded: Array[RID]) -> bool:
	if displacement.is_zero_approx():
		return true
	var parameters := PhysicsTestMotionParameters2D.new()
	parameters.from = node.global_transform
	parameters.motion = displacement
	parameters.exclude_bodies = excluded
	parameters.margin = 0.02
	var result := PhysicsTestMotionResult2D.new()
	var hit := PhysicsServer2D.body_test_motion(node.get_rid(), parameters, result)
	return not hit

func release_exceptions() -> void:
	for instance_id in exceptions:
		var character = characters[instance_id].get_ref()
		var platform = platforms[exceptions[instance_id]]["node"].get_ref()
		if is_instance_valid(character) and is_instance_valid(platform):
			character.remove_collision_exception_with(platform)
	exceptions.clear()

# A discrete step may cross either endpoint several times. Test both reached
# extrema so a small final net displacement cannot tunnel through an obstacle.
func swept_displacements(platform: Dictionary, delta: float) -> Array[Vector2]:
	var motion: Dictionary = platform["motion"]
	var distance: float = absf(float(motion["offsetX"]))
	var phase: float = platform["phase"]
	var advance: float = float(motion["speed"]) * delta
	var next_phase := fposmod(phase + advance, distance * 2.0)
	var before_travel: float = phase if phase <= distance else distance * 2.0 - phase
	var after_travel: float = next_phase if next_phase <= distance else distance * 2.0 - next_phase
	var low := minf(before_travel, after_travel)
	var high := maxf(before_travel, after_travel)
	var first := int(floor(phase / distance)) + 1
	var last := int(floor((phase + advance) / distance))
	if advance >= distance * 2.0 or last - first >= 1:
		low = 0.0
		high = distance
	elif last >= first:
		if first % 2 == 0:
			low = 0.0
		else:
			high = distance
	var sign_value := signf(float(motion["offsetX"]))
	return [Vector2(0.0, (low - before_travel) * sign_value), Vector2(0.0, (high - before_travel) * sign_value)]

func begin(scene: Node, delta: float) -> void:
	release_exceptions()
	carries.clear()
	gaps.clear()
	native_ground.clear()
	advances.clear()
	if not active(scene) or not is_finite(delta) or delta < 0.0:
		return
	for instance_id in characters:
		var platform_id := supported(scene, instance_id)
		if platform_id.is_empty():
			platform_id = initial_support(scene, instance_id)
		if not platform_id.is_empty():
			carries[instance_id] = platform_id
	for platform_id in platforms:
		var platform: Dictionary = platforms[platform_id]
		var node = platform["node"].get_ref()
		if not is_instance_valid(node):
			continue
		var motion: Dictionary = platform["motion"]
		var distance: float = absf(float(motion["offsetX"]))
		var next_phase := fposmod(float(platform["phase"]) + float(motion["speed"]) * delta, distance * 2.0)
		var travelled: float = next_phase if next_phase <= distance else distance * 2.0 - next_phase
		var before: Vector2 = node.global_position
		var offset := signf(float(motion["offsetX"])) * travelled
		var axis := Vector2(0.0, offset) if vertical.has(platform_id) else Vector2(offset, 0.0)
		var after: Vector2 = platform["origin"] + axis
		var excluded: Array[RID] = []
		var allowed := true
		var sweeps: Array[Vector2] = []
		if vertical.has(platform_id):
			sweeps = swept_displacements(platform, delta)
		for instance_id in carries:
			if carries[instance_id] != platform_id or not vertical.has(platform_id):
				continue
			var character = characters[instance_id].get_ref()
			excluded.append(character.get_rid())
			var except_platform: Array[RID] = [node.get_rid()]
			for sweep in sweeps:
				if not permitted(character, sweep, except_platform):
					allowed = false
		if vertical.has(platform_id):
			# PhysicsServer motion queries use the moving body's exception list;
			# also honor a character-owned drop/author exception in reverse.
			for instance_id in characters:
				var character = characters[instance_id].get_ref()
				if is_instance_valid(character) and (character.get_collision_exceptions().has(node) or node.get_collision_exceptions().has(character)):
					excluded.append(character.get_rid())
			for sweep in sweeps:
				if not permitted(node, sweep, excluded):
					allowed = false
		if allowed:
			node.global_position = after
			node.force_update_transform()
			if vertical.has(platform_id):
				PhysicsServer2D.body_set_state(node.get_rid(), PhysicsServer2D.BODY_STATE_TRANSFORM, node.global_transform)
			platform["phase"] = next_phase
			advances[platform_id] = true
		platform["delta"] = node.global_position - before
	supports.clear()

func motion(scene: Node, character: CharacterBody2D, desired: Vector2, velocity: Vector2) -> Vector2:
	if not active(scene) or velocity.y < 0.0:
		return desired
	for instance_id in carries:
		if characters[instance_id].get_ref() != character:
			continue
		var platform_id: String = carries[instance_id]
		if not vertical.has(platform_id):
			return super.motion(scene, character, desired, velocity)
		var platform: Dictionary = platforms[platform_id]
		var node = platform["node"].get_ref()
		if is_instance_valid(node) and not character.get_collision_exceptions().has(node) and not node.get_collision_exceptions().has(character):
			character.add_collision_exception_with(node)
			exceptions[instance_id] = carries[instance_id]
			return Vector2(desired.x, platform["delta"].y + float(gaps.get(instance_id, 0.0)))
	return desired

func sample(scene: Node, character: CharacterBody2D, contacts: Array) -> void:
	super.sample(scene, character, contacts)
	for instance_id in exceptions.keys():
		if characters[instance_id].get_ref() != character:
			continue
		var platform_id: String = exceptions[instance_id]
		var platform = platforms[platform_id]["node"].get_ref()
		if is_instance_valid(platform):
			character.remove_collision_exception_with(platform)
			var collision := KinematicCollision2D.new()
			var hit := character.test_move(character.global_transform, Vector2(0.0, 0.15), collision)
			if hit and collision.get_collider() == platform and collision.get_normal().y <= -0.7:
				native_ground[instance_id] = true
				supports[instance_id] = {"platform":platform_id,"characterRect":shape_rect(character),"platformRect":shape_rect(platform)}
				var facts := contacts.duplicate()
				facts.append(scene.physics_observation_contact(collision))
				scene.movement_contacts.sample(scene, character, facts)
		exceptions.erase(instance_id)

func revoke() -> void:
	release_exceptions()
	vertical.clear()
	gaps.clear()
	native_ground.clear()
	advances.clear()
	super.revoke()
