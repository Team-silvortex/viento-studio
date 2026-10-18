extends "res://runtime.gd"

# Only generated Sprite2D/Polygon2D visuals move into the animation container.
# Input, behavior nodes, labels and runtime observation keep the actor root.
var animation_visuals: Dictionary = {}
var animation_tracks: Array = []
var animation_duration := 1.0
var animation_loop := false
var animation_time := 0.0
var animation_started := false
var animation_failed := false
var animation_finished := false

func animation_fail(message: String) -> void:
	animation_failed = true
	set_process(false)
	emit("diagnostic", {"severity": "error", "code": "runtime_animation_failed", "message": message})
	get_tree().quit(1)

func emit(event: String, data: Dictionary = {}) -> void:
	if event == "diagnostic":
		animation_failed = true
	if event == "finished":
		animation_shutdown()
	super.emit(event, data)

func _ready() -> void:
	super._ready()
	if animation_failed:
		return
	var declaration = JSON.parse_string(FileAccess.get_file_as_string("res://animation.json"))
	if not declaration is Dictionary or declaration.get("format") != "viento-godot-animation":
		animation_fail("Cannot read generated visual animation manifest.")
		return
	animation_duration = PackedByteArray(declaration["durationSecondsBytes"]).decode_double(0)
	animation_loop = declaration["loop"]
	animation_tracks = declaration["tracks"]
	for track in animation_tracks:
		for key in track["keyframes"]:
			key["atSeconds"] = PackedByteArray(key["atSecondsBytes"]).decode_double(0)
			if track["property"] in ["offset2d", "scale2d"]:
				key["value"] = [PackedByteArray(key["valueBytes"][0]).decode_double(0), PackedByteArray(key["valueBytes"][1]).decode_double(0)]
			else:
				key["value"] = PackedByteArray(key["valueBytes"]).decode_double(0)
		var identity: String = track["instanceId"]
		if animation_visuals.has(identity):
			continue
		var actor_node: Node2D = null
		for actor in actors:
			if actor.get("instanceId") == identity:
				actor_node = actor["node"]
				break
		if actor_node == null:
			animation_fail("Generated animation instance is unavailable.")
			return
		# The frozen base creates its original visual first, before its label
		# and before any authored behavior children. A behavior may itself
		# extend Sprite2D or add sibling visuals; those stay on the actor.
		var generated_visual: Node = actor_node.get_child(0) if actor_node.get_child_count() > 0 else null
		if not (generated_visual is Sprite2D or generated_visual is Polygon2D):
			animation_fail("Generated animation visual is unavailable.")
			return
		var visual := Node2D.new()
		visual.name = "VientoVisual"
		actor_node.add_child(visual)
		actor_node.move_child(visual, 0)
		generated_visual.reparent(visual, false)
		animation_visuals[identity] = visual
	animation_started = true
	animation_apply()

func animation_value(track: Dictionary, seconds: float):
	var keys: Array = track["keyframes"]
	var previous: Dictionary = keys[0]
	for index in range(1, keys.size()):
		var next: Dictionary = keys[index]
		if seconds < float(next["atSeconds"]):
			if track["interpolation"] == "step":
				return previous["value"]
			var ratio: float = (seconds - float(previous["atSeconds"])) / (float(next["atSeconds"]) - float(previous["atSeconds"]))
			if previous["value"] is Array:
				return [animation_lerp(previous["value"][0], next["value"][0], ratio), animation_lerp(previous["value"][1], next["value"][1], ratio)]
			return animation_lerp(previous["value"], next["value"], ratio)
		previous = next
	return previous["value"]

func animation_lerp(first: float, last: float, ratio: float) -> float:
	return clampf(lerpf(first, last, ratio), minf(first, last), maxf(first, last))

func animation_apply() -> void:
	for track in animation_tracks:
		var visual: Node2D = animation_visuals[track["instanceId"]]
		if not is_instance_valid(visual):
			animation_fail("Generated animated visual is unavailable.")
			return
		var value = animation_value(track, animation_time)
		match track["property"]:
			"offset2d": visual.position = Vector2(value[0], value[1])
			"rotation2d": visual.rotation_degrees = float(value)
			"scale2d": visual.scale = Vector2(value[0], value[1])
			"opacity": visual.modulate.a = float(value)

func animation_advance(delta: float) -> void:
	if not animation_started or animation_failed or animation_finished:
		return
	animation_time = fmod(animation_time + delta, animation_duration) if animation_loop else minf(animation_time + delta, animation_duration)
	animation_apply()

func _process(delta: float) -> void:
	if animation_failed:
		return
	super._process(delta)
	animation_advance(delta)

func run_smoke() -> void:
	if not animation_failed:
		super.run_smoke()

func animation_shutdown() -> void:
	animation_finished = true
