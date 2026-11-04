extends "res://drop-through-helper.gd"

# A descending platform can separate upward from a falling character before
# that character has crossed it. Keep only this layer's drop exceptions until
# the character is below the platform or has left its horizontal span.
var vertical: Dictionary = {}

func initialize(scene: Node) -> void:
	super.initialize(scene)
	if not eligible or not vertical.is_empty():
		return
	var document = JSON.parse_string(FileAccess.get_file_as_string("res://scenes/" + scene.physics_observation_scene + "/platform-vertical.json"))
	if not document is Dictionary or document.get("format") != "viento-godot-platform-vertical2d":
		scene.physics_fail("Cannot read the generated vertical drop-through declaration.")
		return
	for body in document["bodies"]:
		vertical[body["instanceId"]] = true

func cleanup() -> void:
	for instance_id in owned.keys():
		var entry: Dictionary = owned[instance_id]
		var character = entry["character"].get_ref()
		var character_rect = shape_rect(character)
		var remaining: Array = []
		for platform in entry["pairs"]:
			var node = platform["node"].get_ref()
			var platform_rect = shape_rect(node)
			var retain := false
			if character_rect != null and platform_rect != null:
				var margin := maxf(float(platform["margin"]), 0.08)
				var target: Rect2 = platform_rect.grow(margin)
				var platform_id := ""
				for id in platforms:
					if platforms[id]["node"].get_ref() == node:
						platform_id = id
						break
				if vertical.has(platform_id):
					var overlaps_x: bool = character_rect.end.x >= target.position.x and character_rect.position.x <= target.end.x
					retain = overlaps_x and character_rect.position.y <= target.end.y
				else:
					retain = character_rect.intersects(target, true)
			if retain:
				remaining.append(platform)
			else:
				release_pair(character, platform)
		if remaining.is_empty():
			owned.erase(instance_id)
		else:
			entry["pairs"] = remaining

func revoke() -> void:
	vertical.clear()
	super.revoke()
