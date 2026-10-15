extends Node2D

# Project ownership is separate from scene-local actor, behavior and audio state.
# Scripts receive only a visit-bound request port, never this coordinator.
class ScenePort extends RefCounted:
	var host: WeakRef
	var visit_index: int
	var binding: Dictionary
	var behavior: WeakRef
	func _init(owner: Node, visit: int, declaration: Dictionary, instance: Node) -> void:
		host = weakref(owner)
		visit_index = visit
		binding = declaration.duplicate(true)
		behavior = weakref(instance)
	func request_scene(scene_id: String) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.request_scene(visit_index, binding, scene_id)
	func read_state(key) -> Variant:
		var owner = host.get_ref()
		return owner.read_state(visit_index, binding, key) if owner != null else null
	func write_state(key, value) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.write_state(visit_index, binding, key, value)
	func erase_state(key) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.erase_state(visit_index, binding, key)
	func play_audio(track_id) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.audio_control.request(visit_index, binding, track_id, "play")
	func stop_audio(track_id) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.audio_control.request(visit_index, binding, track_id, "stop")
	func subscribe_event(name, callback) -> int:
		var owner = host.get_ref()
		return owner.event_bus.subscribe(visit_index, binding, behavior.get_ref(), name, callback) if owner != null else 0
	func unsubscribe_event(id) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.event_bus.unsubscribe(visit_index, binding, id)
	func publish_event(name, value) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.event_bus.publish(visit_index, binding, name, value)

var event_bus
var audio_control
var finish_requested := false
var manifest: Dictionary
var shared_state: Dictionary = {}
var state_revision := 0
var members: Dictionary = {}
var current
var current_scene := ""
var visit_index := 0
var elapsed_seconds := 0.0
var total_seconds := 0.0
var pending_scene := ""
var accepting := false
var failed := false
var finished := false
var flushing := false
var flush_scheduled := false
var smoke := false

func project_emit(event: String, data: Dictionary = {}) -> void:
	data["protocol"] = 4
	data["event"] = event
	print("VIENTO_PROJECT:" + JSON.stringify(data, "", true, true))

func _ready() -> void:
	event_bus = preload("res://project-events.gd").new(self)
	audio_control = preload("res://project-audio.gd").new(self)
	get_tree().auto_accept_quit = false
	smoke = "--viento-smoke" in OS.get_cmdline_user_args()
	manifest = JSON.parse_string(FileAccess.get_file_as_string("res://assembly.json"))
	for row in manifest["scenes"]:
		members[row["sceneId"]] = row["entry"]
	project_emit("ready", {"assemblyId": manifest["assembly"]["objectId"], "entrySceneId": manifest["entrySceneId"], "stateRevision": 0, "eventSequence": 0, "audioCommandSequence": 0})
	enter_scene(manifest["entrySceneId"])
	if smoke:
		set_process(false)
		call_deferred("run_project_smoke")
	else:
		schedule_flush()

func make_port(visit: int, binding: Dictionary, instance: Node) -> RefCounted:
	return ScenePort.new(self, visit, binding, instance)

func request_scene(visit: int, binding: Dictionary, scene_id: String) -> bool:
	if not accepting or failed or finished or visit != visit_index or current == null:
		return false
	if scene_id == current_scene or pending_scene != "":
		return false
	if not members.has(scene_id):
		current.emit("diagnostic", {"severity": "error", "code": "runtime_behavior_scene_target", "message": "The requested scene is not an assembly member.",
			"bindingId": binding["bindingId"], "instanceId": binding["instanceId"], "objectId": binding["objectId"]})
		return false
	if visit_index >= 64:
		current.emit("diagnostic", {"severity": "error", "code": "runtime_behavior_scene_limit", "message": "The project visit limit was reached.",
			"bindingId": binding["bindingId"], "instanceId": binding["instanceId"], "objectId": binding["objectId"]})
		return false
	pending_scene = scene_id
	schedule_flush()
	return true

# Only a currently admitted visit may read or mutate the session dictionary.
# Scalars never expose a shared container or an engine object to author code.
func state_access(visit: int) -> bool:
	return accepting and not failed and not finished and visit == visit_index and current != null

func state_key_valid(key) -> bool:
	if typeof(key) != TYPE_STRING or key.length() < 1 or key.length() > 64 or key in ["constructor", "prototype", "__proto__"]:
		return false
	for index in range(key.length()):
		var code: int = key.unicode_at(index)
		var letter := (code >= 65 and code <= 90) or (code >= 97 and code <= 122)
		if not letter and (index == 0 or not ((code >= 48 and code <= 57) or code in [45, 46, 95])):
			return false
	return true

func state_value_bytes(value) -> int:
	if typeof(value) == TYPE_BOOL:
		return 1
	if typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT:
		return 8 if is_finite(float(value)) and abs(float(value)) <= 1000000000.0 else -1
	if typeof(value) != TYPE_STRING:
		return -1
	for index in range(value.length()):
		var code: int = value.unicode_at(index)
		if code < 0 or code > 0x10ffff or (code >= 0xd800 and code <= 0xdfff):
			return -1
	var count: int = value.to_utf8_buffer().size()
	return count if count <= 4096 else -1

func state_same(first, second) -> bool:
	var first_number := typeof(first) == TYPE_INT or typeof(first) == TYPE_FLOAT
	var second_number := typeof(second) == TYPE_INT or typeof(second) == TYPE_FLOAT
	return first == second if (first_number and second_number) or typeof(first) == typeof(second) else false

func state_fail(binding: Dictionary, code: String, message: String) -> bool:
	current.emit("diagnostic", {"severity": "error", "code": code, "message": message,
		"bindingId": binding["bindingId"], "instanceId": binding["instanceId"], "objectId": binding["objectId"]})
	return false

func state_candidate_valid(candidate: Dictionary) -> bool:
	if candidate.size() > 64 or state_revision >= 1024:
		return false
	var bytes := 0
	for key in candidate:
		var value_bytes := state_value_bytes(candidate[key])
		if not state_key_valid(key) or value_bytes < 0:
			return false
		bytes += key.length() + value_bytes
	return bytes <= 16384

func read_state(visit: int, binding: Dictionary, key) -> Variant:
	if not state_access(visit):
		return null
	if not state_key_valid(key):
		state_fail(binding, "runtime_behavior_state_key", "Shared state key is invalid.")
		return null
	return shared_state.get(key)

func write_state(visit: int, binding: Dictionary, key, value) -> bool:
	if not state_access(visit):
		return false
	if not state_key_valid(key):
		return state_fail(binding, "runtime_behavior_state_key", "Shared state key is invalid.")
	if state_value_bytes(value) < 0:
		return state_fail(binding, "runtime_behavior_state_value", "Shared state value is not a supported bounded scalar.")
	if shared_state.has(key) and state_same(shared_state[key], value):
		return true
	if (typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT) and value == 0:
		value = 0
	var candidate := shared_state.duplicate()
	candidate[key] = value
	if not state_candidate_valid(candidate):
		return state_fail(binding, "runtime_behavior_state_limit", "Shared state budget was exceeded.")
	shared_state = candidate
	state_revision += 1
	project_emit("state", {"visitIndex": visit, "sceneId": current_scene, "bindingId": binding["bindingId"],
		"instanceId": binding["instanceId"], "objectId": binding["objectId"], "revision": state_revision,
		"operation": "set", "key": key, "value": value})
	return true

func erase_state(visit: int, binding: Dictionary, key) -> bool:
	if not state_access(visit):
		return false
	if not state_key_valid(key):
		return state_fail(binding, "runtime_behavior_state_key", "Shared state key is invalid.")
	if not shared_state.has(key):
		return false
	var candidate := shared_state.duplicate()
	candidate.erase(key)
	if not state_candidate_valid(candidate):
		return state_fail(binding, "runtime_behavior_state_limit", "Shared state budget was exceeded.")
	shared_state = candidate
	state_revision += 1
	project_emit("state", {"visitIndex": visit, "sceneId": current_scene, "bindingId": binding["bindingId"],
		"instanceId": binding["instanceId"], "objectId": binding["objectId"], "revision": state_revision,
		"operation": "delete", "key": key})
	return true

func schedule_flush() -> void:
	if not flush_scheduled and not flushing and not failed and not finished:
		flush_scheduled = true
		call_deferred("flush_requests")

func enter_scene(scene_id: String) -> void:
	visit_index += 1
	current_scene = scene_id
	elapsed_seconds = 0.0
	project_emit("scene-enter", {"visitIndex": visit_index, "sceneId": current_scene})
	var packed := load("res://" + members[scene_id]) as PackedScene
	if packed == null:
		failed = true
		get_tree().quit(1)
		return
	current = packed.instantiate()
	current.name = "VientoScene"
	current.project_host = self
	current.project_visit = visit_index
	accepting = true
	add_child(current)

func scene_event(visit: int, stream: String, frame: Dictionary) -> void:
	if current == null or visit != visit_index or finished:
		return
	project_emit("scene-event", {"visitIndex": visit, "sceneId": current_scene, "stream": stream, "frame": frame})
	if frame.get("event") == "diagnostic":
		failed = true
		accepting = false
		pending_scene = ""
		set_process(false)
		call_deferred("abort_project")

func leave_scene(reason: String, next_scene: String = "") -> void:
	accepting = false
	event_bus.revoke_visit(visit_index)
	var actors = current.states()
	# Shutdown must finish before the next visit can emit a ready frame.
	current.project_close()
	var data := {"visitIndex": visit_index, "sceneId": current_scene, "reason": reason,
		"elapsedSeconds": elapsed_seconds, "actors": actors}
	if reason == "switch":
		data["nextSceneId"] = next_scene
	project_emit("scene-exit", data)
	remove_child(current)
	current.free()
	current = null

func flush_requests() -> void:
	flush_scheduled = false
	if flushing or failed or finished:
		return
	flushing = true
	while current != null and not failed and not finished:
		event_bus.drain()
		if not failed and not finished:
			audio_control.drain()
		if failed or finished:
			break
		if event_bus.pending_count() > 0 or audio_control.pending_count() > 0:
			continue
		if finish_requested:
			pending_scene = ""
			leave_scene("finished")
			finished = true
			project_emit("finished", {"assemblyId": manifest["assembly"]["objectId"], "visitCount": visit_index, "totalSeconds": total_seconds, "stateRevision": state_revision, "eventSequence": event_bus.sequence, "audioCommandSequence": audio_control.sequence})
			get_tree().quit()
			break
		if pending_scene == "":
			break
		var next_scene := pending_scene
		pending_scene = ""
		leave_scene("switch", next_scene)
		enter_scene(next_scene)
	flushing = false

func _process(delta: float) -> void:
	if failed or finished or current == null:
		return
	if Input.is_action_just_pressed("ui_cancel"):
		finish_project()
		return
	elapsed_seconds += delta
	total_seconds += delta
	current.project_step(delta)

func run_project_smoke() -> void:
	flush_requests()
	for step in range(2):
		if failed or finished or current == null:
			Input.action_release("ui_right")
			return
		if step == 0:
			Input.action_press("ui_right")
		else:
			Input.action_release("ui_right")
		elapsed_seconds += 0.25
		total_seconds += 0.25
		current.project_step(0.25)
		flush_requests()
	Input.action_release("ui_right")
	if failed or current == null:
		return
	# Rendering may await a frame. Freeze callbacks so capture cannot move the
	# selected visit or execute a third logical step while it is being captured.
	accepting = false
	current.process_mode = Node.PROCESS_MODE_DISABLED
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--viento-capture="):
			await RenderingServer.frame_post_draw
			if get_viewport().get_texture().get_image().save_png(argument.trim_prefix("--viento-capture=")) != OK:
				current.emit("diagnostic", {"severity": "error", "code": "runtime_capture_failed", "message": "Cannot save preview frame."})
				return
	finish_project()

func finish_project() -> void:
	if failed or finished or current == null:
		return
	finish_requested = true
	flush_requests()

func abort_project() -> void:
	accepting = false
	event_bus.clear()
	audio_control.clear()
	pending_scene = ""
	Input.action_release("ui_right")
	if current != null:
		current.project_close(true)
		remove_child(current)
		current.free()
		current = null
	get_tree().quit(1)

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		finish_requested = true
		schedule_flush()
