extends RefCounted

const DropPort = preload("res://drop-through-port.gd")
var host: WeakRef
var initialized := false
var eligible := false
var opened := true
var stepping := false
var changing := false
var platforms: Dictionary = {}
var characters: Dictionary = {}
var records: Dictionary = {}
var supports: Dictionary = {}
var pending: Dictionary = {}
var owned: Dictionary = {}
var next_token := 0

func active(scene: Node) -> bool:
	return opened and eligible and is_instance_valid(scene) and scene.project_open and not scene.physics_failed and scene.project_host.state_access(scene.project_visit)

func initialize(scene: Node) -> void:
	if initialized:
		return
	initialized = true
	host = weakref(scene)
	var manifest = JSON.parse_string(FileAccess.get_file_as_string("res://drop-through-project.json"))
	if not manifest is Dictionary or not manifest.get("sceneIds") is Array:
		scene.physics_fail("Cannot read the generated drop-through inventory.")
		return
	if not scene.physics_observation_scene in manifest["sceneIds"]:
		return
	var document = JSON.parse_string(FileAccess.get_file_as_string("res://scenes/" + scene.physics_observation_scene + "/one-way.json"))
	if not document is Dictionary or not document.get("bodies") is Array:
		scene.physics_fail("Cannot read the generated drop-through platforms.")
		return
	for body in document["bodies"]:
		for actor in scene.actors:
			if actor["instanceId"] != body["instanceId"]:
				continue
			var node = actor["node"]
			var shape = node.get_node_or_null("VientoCollision")
			if not node is StaticBody2D or not shape is CollisionShape2D or not shape.shape is RectangleShape2D or not shape.one_way_collision:
				scene.physics_fail("Generated drop-through platform is unavailable.", actor)
				return
			platforms[body["instanceId"]] = {"bodyId": body["bodyId"], "node": weakref(node), "shape": weakref(shape), "margin": float(body["oneWay"]["margin"])}
	for actor in scene.actors:
		if scene.character_motion_configs.has(actor["instanceId"]) and actor["node"] is CharacterBody2D:
			characters[actor["instanceId"]] = weakref(actor["node"])
	eligible = not platforms.is_empty() and not characters.is_empty()

func attach(scene: Node, binding: Dictionary, behavior: Node) -> void:
	initialize(scene)
	var instance_id: String = binding["instanceId"]
	if not active(scene) or not characters.has(instance_id):
		return
	next_token += 1
	var port = DropPort.new(self, next_token)
	records[next_token] = {"behavior": weakref(behavior), "instanceId": instance_id}
	behavior.set_meta("viento_character_drop", port)

func record_live(token: int) -> bool:
	if not records.has(token):
		return false
	var behavior = records[token]["behavior"].get_ref()
	return is_instance_valid(behavior) and behavior.is_inside_tree()

func shape_rect(node: PhysicsBody2D):
	if not is_instance_valid(node):
		return null
	var shape = node.get_node_or_null("VientoCollision")
	if not shape is CollisionShape2D or shape.disabled or not (shape.shape is RectangleShape2D or shape.shape is CircleShape2D):
		return null
	var rectangle: Rect2 = shape.global_transform * shape.shape.get_rect()
	return rectangle if rectangle.is_finite() and rectangle.has_area() else null

# The native formatter's identity comes from the actual collider node. Reject
# a normal floor or an unknown support instead of partially ignoring a seam.
func sample(scene: Node, character: CharacterBody2D, contacts: Array) -> void:
	if not stepping or not active(scene):
		return
	var instance_id := ""
	for candidate in characters:
		if characters[candidate].get_ref() == character:
			instance_id = candidate
			break
	if instance_id.is_empty():
		return
	var floors: Dictionary = {}
	var allowed := true
	for contact in contacts:
		if float(contact["normal"][1]) > -0.7:
			continue
		var collider = contact.get("collider")
		if not collider is Dictionary or not platforms.has(collider.get("instanceId", "")):
			allowed = false
			continue
		var platform: Dictionary = platforms[collider["instanceId"]]
		if platform["bodyId"] != collider.get("bodyId"):
			allowed = false
			continue
		var node = platform["node"].get_ref()
		var rectangle = shape_rect(node)
		if rectangle == null:
			allowed = false
			continue
		floors[collider["instanceId"]] = rectangle
	var rectangle = shape_rect(character)
	if not allowed or floors.is_empty() or rectangle == null:
		supports.erase(instance_id)
	else:
		supports[instance_id] = {"rectangle": rectangle, "floors": floors}

func support_valid(scene: Node, instance_id: String) -> bool:
	if not supports.has(instance_id) or not characters.has(instance_id) or not scene.character_motion_grounded.get(instance_id, false):
		return false
	var character = characters[instance_id].get_ref()
	var rectangle = shape_rect(character)
	var support: Dictionary = supports[instance_id]
	if rectangle == null or not rectangle.is_equal_approx(support["rectangle"]):
		return false
	for platform_id in support["floors"]:
		var platform: Dictionary = platforms[platform_id]
		var node = platform["node"].get_ref()
		var shape = platform["shape"].get_ref()
		var current = shape_rect(node)
		if current == null or not is_instance_valid(shape) or not shape.one_way_collision or not current.is_equal_approx(support["floors"][platform_id]):
			return false
		# Never take ownership of an author's pre-existing exception, in either
		# direction, or disable a platform for the other characters on it.
		if character.get_collision_exceptions().has(node) or node.get_collision_exceptions().has(character):
			return false
	return true

func request(token: int) -> bool:
	var scene = host.get_ref() if host != null else null
	if changing or not active(scene) or not record_live(token):
		return false
	var instance_id: String = records[token]["instanceId"]
	if pending.has(instance_id) or owned.has(instance_id) or not support_valid(scene, instance_id):
		return false
	pending[instance_id] = token
	return true

func begin(scene: Node) -> void:
	initialize(scene)
	if changing or not active(scene):
		return
	changing = true
	cleanup()
	var requests := pending
	pending = {}
	var ids := requests.keys()
	ids.sort()
	for instance_id in ids:
		if not record_live(requests[instance_id]) or owned.has(instance_id) or not support_valid(scene, instance_id):
			continue
		var character: CharacterBody2D = characters[instance_id].get_ref()
		var pairs: Array = []
		var platform_ids: Array = supports[instance_id]["floors"].keys()
		platform_ids.sort()
		for platform_id in platform_ids:
			var platform: Dictionary = platforms[platform_id]
			character.add_collision_exception_with(platform["node"].get_ref())
			pairs.append(platform)
		owned[instance_id] = {"character": weakref(character), "pairs": pairs}
		# No teleport, velocity override, extra sweep, timer or synthetic fact.
		# The existing gravity motor moves once and cannot jump in this step.
		scene.character_motion_grounded[instance_id] = false
	supports.clear()
	stepping = true
	changing = false

func release_pair(character, platform: Dictionary) -> void:
	var node = platform["node"].get_ref()
	if is_instance_valid(character) and is_instance_valid(node):
		character.remove_collision_exception_with(node)

func cleanup() -> void:
	for instance_id in owned.keys():
		var entry: Dictionary = owned[instance_id]
		var character = entry["character"].get_ref()
		var character_rect = shape_rect(character)
		var remaining: Array = []
		for platform in entry["pairs"]:
			var node = platform["node"].get_ref()
			var platform_rect = shape_rect(node)
			# Include the native margin so a tiny first gravity step cannot be
			# mistaken for separation across the initial safe-margin gap.
			if character_rect != null and platform_rect != null and character_rect.intersects(platform_rect.grow(maxf(platform["margin"], 0.08)), true):
				remaining.append(platform)
			else:
				release_pair(character, platform)
		if remaining.is_empty():
			owned.erase(instance_id)
		else:
			entry["pairs"] = remaining

func finish(_scene: Node) -> void:
	stepping = false
	if not opened or changing:
		return
	changing = true
	cleanup()
	changing = false

func revoke() -> void:
	opened = false
	stepping = false
	changing = true
	pending.clear()
	supports.clear()
	records.clear()
	for entry in owned.values():
		for platform in entry["pairs"]:
			release_pair(entry["character"].get_ref(), platform)
	owned.clear()
	characters.clear()
	platforms.clear()
	changing = false
