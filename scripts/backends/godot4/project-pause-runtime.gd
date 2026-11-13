extends "res://restart-project-runtime.gd"

# The session and scene remain pausable. Only the separate input/menu subtree
# runs while paused; ordinary author nodes never move to that subtree.
class PausePort extends RefCounted:
	var host: WeakRef
	func _init(owner: Node) -> void:
		host = weakref(owner)
	func request_pause(value: bool) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.pause_request(self, value)
	func is_paused() -> bool:
		var owner = host.get_ref()
		return owner != null and owner.pause_port_status(self) in ["paused", "waiting-for-release"]
	func status() -> String:
		var owner = host.get_ref()
		return owner.pause_port_status(self) if owner != null else "unavailable"
	func configure_toggle_action(action_name: String, paused_text: String = "Paused", resume_text: String = "Release controls to resume") -> bool:
		var owner = host.get_ref()
		return owner != null and owner.pause_configure(self, action_name, paused_text, resume_text)

var pause_ports: Dictionary = {}
var pause_phase := "running"
var pause_sequence := 0
var pause_input: Node
var pause_waiting_port: WeakRef
var pause_owns_tree := false

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_PAUSABLE
	pause_input = preload("res://project-pause-input.gd").new(self)
	pause_input.name = "VientoPauseInput"
	add_child(pause_input)
	super._ready()

func make_port(visit: int, binding: Dictionary, instance: Node) -> RefCounted:
	var original = super.make_port(visit, binding, instance)
	var port := PausePort.new(self)
	pause_ports[port.get_instance_id()] = {"port": weakref(port), "visit": visit, "binding": binding.duplicate(true), "behavior": weakref(instance)}
	instance.set_meta("viento_project_pause", port)
	return original

func pause_port_valid(port) -> bool:
	if not is_instance_valid(port):
		return false
	var record = pause_ports.get(port.get_instance_id())
	if record == null or record["port"].get_ref() != port or not super.state_access(record["visit"]) or finish_requested:
		return false
	var behavior = record["behavior"].get_ref()
	return is_instance_valid(behavior) and behavior is Node and behavior.is_inside_tree() and not behavior.is_queued_for_deletion() and current.is_ancestor_of(behavior)

func pause_port_status(port) -> String:
	return pause_phase if pause_port_valid(port) else "unavailable"

func pause_action_valid(action_name: String) -> bool:
	if action_name.is_empty() or action_name.length() > 64 or action_name == "ui_cancel":
		return false
	for index in range(action_name.length()):
		var code := action_name.unicode_at(index)
		if not (code >= 97 and code <= 122) and (index == 0 or not (code >= 48 and code <= 57 or code == 95)):
			return false
	return InputMap.has_action(action_name)

func pause_text_valid(text: String) -> bool:
	if text.length() < 1 or text.length() > 160:
		return false
	for index in range(text.length()):
		var code := text.unicode_at(index)
		if code < 32 or code >= 127 and code <= 159 or code >= 0xd800 and code <= 0xdfff or code > 0x10ffff:
			return false
	return true

func pause_configure(port, action_name: String, paused_text: String, resume_text: String) -> bool:
	if not pause_port_valid(port) or pause_phase != "running" or pause_input == null:
		return false
	if not pause_action_valid(action_name):
		return false
	for text in [paused_text, resume_text]:
		if not pause_text_valid(text):
			return false
	return pause_input.configure(port, action_name, paused_text, resume_text)

func pause_queues_empty() -> bool:
	if event_bus == null or audio_control == null or event_bus.pending_count() != 0 or audio_control.pending_count() != 0:
		return false
	# Optional transports are owned by the inherited runtime variants.
	for property in get_property_list():
		if property["name"] in ["animation_control", "animation_completions"]:
			var service = get(property["name"])
			if service != null and service.pending_count() != 0:
				return false
	return true

func pause_safe_point() -> bool:
	return not flushing and not Engine.is_in_physics_frame() and not finish_requested and pending_scene.is_empty() and retry_pending.is_empty() and pause_queues_empty()

func pause_emit_phase() -> void:
	pause_sequence += 1
	print("VIENTO_PROJECT_PAUSE:" + JSON.stringify({"protocol": 1, "event": "state", "sequence": pause_sequence,
		"visitIndex": visit_index, "sceneId": current_scene, "phase": pause_phase,
		"elapsedSeconds": elapsed_seconds, "totalSeconds": total_seconds}, "", true, true))
	if pause_input != null:
		pause_input.show_phase(pause_phase)

func pause_request(port, value: bool) -> bool:
	if not pause_port_valid(port):
		return false
	if value and pause_phase == "paused" or not value and pause_phase in ["running", "waiting-for-release"]:
		return true
	if pause_sequence >= 1000000000:
		return false
	if value:
		if pause_phase == "running" and (not pause_safe_point() or get_tree().paused):
			return false
		pause_waiting_port = null
		pause_phase = "paused"
		pause_owns_tree = true
		get_tree().paused = true
		pause_emit_phase()
		return true
	# Resume never opens gameplay inside the input callback. The always-running
	# controller waits for focus and the release of every registered action.
	pause_waiting_port = weakref(port)
	pause_phase = "waiting-for-release"
	pause_emit_phase()
	return true

func pause_cancel_resume() -> bool:
	if pause_phase != "waiting-for-release" or pause_sequence >= 1000000000:
		return false
	pause_waiting_port = null
	pause_phase = "paused"
	pause_emit_phase()
	return true

func pause_resume_released() -> bool:
	if pause_phase != "waiting-for-release" or pause_waiting_port == null or not pause_port_valid(pause_waiting_port.get_ref()) or pause_sequence >= 1000000000:
		return false
	if pause_input == null or not pause_input.focused_and_released() or not pause_queues_empty() or not pending_scene.is_empty() or not retry_pending.is_empty():
		return false
	pause_waiting_port = null
	pause_phase = "running"
	pause_emit_phase()
	pause_owns_tree = false
	get_tree().paused = false
	schedule_flush()
	return true

func state_access(visit: int) -> bool:
	return pause_phase == "running" and super.state_access(visit)

func request_scene(visit: int, binding: Dictionary, scene_id: String) -> bool:
	return pause_phase == "running" and super.request_scene(visit, binding, scene_id)

func flush_requests() -> void:
	# Deferred methods and signals still execute during SceneTree pause. The
	# gameplay gate therefore also applies to every previously scheduled flush.
	if pause_phase != "running" and not finish_requested:
		flush_scheduled = false
		return
	super.flush_requests()

func pause_clear_visit() -> void:
	pause_ports.clear()
	pause_waiting_port = null
	if pause_input != null:
		pause_input.clear_configuration()

func pause_release_tree() -> void:
	# Call only after the old scene has been revoked/freed. Shutdown does not
	# manufacture a running observation or awaken old gameplay callbacks.
	pause_phase = "running"
	if pause_owns_tree and get_tree() != null:
		pause_owns_tree = false
		get_tree().paused = false

func leave_scene(reason: String, next_scene: String = "") -> void:
	accepting = false
	pause_clear_visit()
	super.leave_scene(reason, next_scene)
	pause_release_tree()

func abort_project() -> void:
	accepting = false
	pause_clear_visit()
	super.abort_project()
	pause_release_tree()

func _exit_tree() -> void:
	accepting = false
	pause_clear_visit()
	pause_release_tree()
