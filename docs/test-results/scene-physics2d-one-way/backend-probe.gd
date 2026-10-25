extends SceneTree
var cases: Array = []
func _initialize() -> void:
	call_deferred("run")
func shape_node(size: Vector2) -> CollisionShape2D:
	var collision := CollisionShape2D.new()
	var shape := RectangleShape2D.new()
	shape.size = size
	collision.shape = shape
	return collision
func platform(world: Node2D, position: Vector2, size: Vector2, one_way: bool, margin: float, label: String) -> StaticBody2D:
	var body := StaticBody2D.new()
	body.name = label
	body.position = position
	var collision := shape_node(size)
	collision.one_way_collision = one_way
	collision.one_way_collision_margin = margin
	body.add_child(collision)
	world.add_child(body)
	return body
func character(world: Node2D, position: Vector2, circle: bool = false) -> CharacterBody2D:
	var body := CharacterBody2D.new()
	body.position = position
	var collision := shape_node(Vector2(20, 20))
	if circle:
		var shape := CircleShape2D.new()
		shape.radius = 10
		collision.shape = shape
	body.add_child(collision)
	world.add_child(body)
	return body
func settle() -> void:
	await physics_frame
	await process_frame
func vector(value: Vector2) -> Array:
	return [value.x, value.y]
func move(body: CharacterBody2D, motion: Vector2) -> Dictionary:
	var before := body.position
	var collision := body.move_and_collide(motion)
	return {"before": vector(before), "after": vector(body.position), "motion": vector(motion), "collision": null if collision == null else {"normal": vector(collision.get_normal()), "travel": vector(collision.get_travel()), "remainder": vector(collision.get_remainder()), "collider": collision.get_collider().name}}
func direct_case(label: String, start: Vector2, motions: Array, one_way: bool, margin: float = 1.0, thickness: float = 10.0, circle: bool = false) -> void:
	var world := Node2D.new()
	root.add_child(world)
	platform(world, Vector2(0, 100), Vector2(200, thickness), one_way, margin, "platform")
	var body := character(world, start, circle)
	await settle()
	var moves: Array = []
	for motion in motions:
		moves.append(move(body, motion))
		await settle()
	cases.append({"name": label, "oneWay": one_way, "margin": margin, "moves": moves})
	world.free()
	await settle()
func motor_case(label: String, gravity: float, jump_speed: float, frames: int, platform_y: float) -> void:
	var world := Node2D.new()
	root.add_child(world)
	platform(world, Vector2(0, 200), Vector2(1000, 20), false, 1, "floor")
	platform(world, Vector2(0, platform_y), Vector2(200, 10), true, 1, "one_way")
	var body := character(world, Vector2(0, 180))
	await settle()
	var velocity := Vector2.ZERO
	var grounded := false
	var events: Array = []
	var upper_contacts: Array = []
	var minimum_y := body.position.y
	for index in range(frames):
		var delta := 1.0 / 60.0
		velocity.y = minf(velocity.y + gravity * delta, 1200)
		if index == 5 and grounded:
			velocity.y = -jump_speed
			events.append({"event": "jumped", "step": index + 1})
		var remainder := velocity * delta
		var next_grounded := false
		var land_on := ""
		for _attempt in range(4):
			var collision := body.move_and_collide(remainder)
			if collision == null:
				break
			var normal := collision.get_normal()
			if collision.get_collider().name == "one_way":
				upper_contacts.append({"step": index + 1, "normal": vector(normal), "requestedY": remainder.y})
			if normal.y <= -0.7:
				next_grounded = true
				land_on = collision.get_collider().name
			if velocity.dot(normal) < 0:
				velocity = velocity.slide(normal)
			remainder = collision.get_remainder().slide(normal)
			if remainder.is_zero_approx():
				break
		if not grounded and next_grounded:
			events.append({"event": "landed", "step": index + 1, "collider": land_on})
		grounded = next_grounded
		minimum_y = minf(minimum_y, body.position.y)
		await settle()
	cases.append({"name": label, "gravity": gravity, "jumpSpeed": jump_speed, "frames": frames, "minimumY": minimum_y, "finalPosition": vector(body.position), "grounded": grounded, "events": events, "upperContacts": upper_contacts})
	world.free()
	await settle()
func run() -> void:
	var shape := CollisionShape2D.new()
	var properties := {}
	for property in shape.get_property_list():
		if String(property["name"]).begins_with("one_way"):
			properties[property["name"]] = str(shape.get(property["name"]))
	shape.free()
	await direct_case("one-way-through-and-land", Vector2(0, 140), [Vector2(0, -80), Vector2(0, 80)], true)
	await direct_case("solid-underneath-control", Vector2(0, 140), [Vector2(0, -80)], false)
	await direct_case("one-way-side-pass", Vector2(-130, 100), [Vector2(100, 0)], true)
	await direct_case("one-way-fast-fall", Vector2(0, -1000), [Vector2(0, 2000)], true)
	await direct_case("one-way-thin", Vector2(0, 140), [Vector2(0, -80), Vector2(0, 80)], true, 1, 2)
	await direct_case("one-way-circle-character", Vector2(0, 140), [Vector2(0, -80), Vector2(0, 80)], true, 1, 10, true)
	await direct_case("initial-overlap-margin1", Vector2(0, 95), [Vector2(0, 5)], true, 1)
	await direct_case("initial-overlap-margin16", Vector2(0, 95), [Vector2(0, 5)], true, 16)
	for margin in [0.01, 0.1, 0.5, 1.0]:
		await direct_case("margin-through-and-land", Vector2(0, 140), [Vector2(0, -80), Vector2(0, 80)], true, margin)
		await direct_case("margin-max-fall-60hz", Vector2(0, 40), [Vector2(0, 4000.0 / 60.0)], true, margin)
		await direct_case("margin-overlap", Vector2(0, 95), [Vector2(0, 5)], true, margin)
	await motor_case("motor-default", 980, 360, 60, 150)
	await motor_case("motor-smoke-half-second", 2000, 400, 30, 160)
	print("VIENTO_ONE_WAY_PROBE:" + JSON.stringify({"version": Engine.get_version_info(), "properties": properties, "cases": cases}))
	quit()
