extends "res://project-physics-runtime.gd"

# Independent smoke telemetry never enters the author event bus or changes the
# project's existing protocol. Its fixed budget cannot stop physical gameplay.
var physics_observation_started := false
var physics_observation_finished := false
var physics_observation_count := 0
var physics_observation_limited := false

func physics_observation_emit(event: String, payload: Dictionary) -> void:
	payload["protocol"] = 1
	payload["event"] = event
	print("VIENTO_PHYSICS2D:" + JSON.stringify(payload, "", true, true))

func project_emit(event: String, data: Dictionary = {}) -> void:
	if event == "finished" and smoke and physics_observation_started and not physics_observation_finished:
		physics_observation_finished = true
		physics_observation_emit("finished", {"sampleCount": physics_observation_count, "limited": physics_observation_limited})
	super.project_emit(event, data)
	if event == "ready" and smoke and not physics_observation_started:
		physics_observation_started = true
		physics_observation_emit("ready", {"assemblyId": manifest["assembly"]["objectId"], "limit": 256})

func physics_observe(visit: int, scene_id: String, payload: Dictionary) -> void:
	if not smoke or not physics_observation_started or physics_observation_finished or failed or finished:
		return
	if current == null or visit != visit_index or scene_id != current_scene:
		return
	if physics_observation_count >= 256:
		if not physics_observation_limited:
			physics_observation_limited = true
			physics_observation_emit("limited", {"sampleCount": physics_observation_count})
		return
	physics_observation_count += 1
	payload["sequence"] = physics_observation_count
	payload["visitIndex"] = visit
	payload["sceneId"] = scene_id
	physics_observation_emit("sample", payload)
