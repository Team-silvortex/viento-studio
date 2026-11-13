extends "res://__CAMERA_PROJECT_BASE__"

const CAMERA_SCENES = __CAMERA_SCENES__

func enter_scene(scene_id: String) -> void:
	# Each PackedScene keeps its original root script and actor paths. Only the
	# selected in-memory member entry gains the independent view adapter node.
	if CAMERA_SCENES.has(scene_id):
		members[scene_id] = CAMERA_SCENES[scene_id]
	super.enter_scene(scene_id)
