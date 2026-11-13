extends "res://__HUD_PROJECT_BASE__"

const HUD_SCENES = __HUD_SCENES__

func enter_scene(scene_id: String) -> void:
	super.enter_scene(scene_id)
	# The complete original actor/physics/behavior factory and author _ready have
	# finished before this visit receives an independent screen-space view.
	if current != null and HUD_SCENES.has(scene_id):
		var overlay = preload("res://hud2d-scene.gd").new()
		overlay.name = "VientoHUD2D"
		overlay.hud_document = HUD_SCENES[scene_id]
		current.add_child(overlay)
