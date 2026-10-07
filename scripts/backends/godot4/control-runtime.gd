extends "res://runtime.gd"

# Only trusted session data reaches this wrapper. Global replay retains the
# frozen movement path; instance replay owns independent directions per actor.
var instance_control := false
var instance_inputs: Dictionary = {}

func _process(delta: float) -> void:
	if not instance_control:
		super._process(delta)
		return
	for actor in actors:
		var direction := Vector2.ZERO
		if actor["controls"] == "arrows" and instance_inputs.has(actor["instanceId"]):
			var controls: Dictionary = instance_inputs[actor["instanceId"]]
			direction = Vector2(int(controls["right"]) - int(controls["left"]), int(controls["down"]) - int(controls["up"]))
			if direction.length_squared() > 1:
				direction = direction.normalized()
		var next_state := "moving" if direction != Vector2.ZERO and actor["speed"] > 0 else "idle"
		actor["node"].position += direction * actor["speed"] * delta
		if next_state != actor["state"]:
			actor["state"] = next_state
			emit("state", {"instanceId": actor["instanceId"], "objectId": actor["objectId"], "state": next_state})

func control_failed() -> void:
	for action in ["ui_left", "ui_right", "ui_up", "ui_down"]:
		Input.action_release(action)
	emit("diagnostic", {"severity": "error", "code": "runtime_control_invalid", "message": "Invalid bounded runtime control program."})
	get_tree().quit(1)

func exact_keys(value: Dictionary, expected: Array) -> bool:
	if value.size() != expected.size():
		return false
	for key in expected:
		if not value.has(key):
			return false
	return true

func arrow_fields(value: Dictionary) -> bool:
	for key in ["left", "right", "up", "down"]:
		if not value[key] is bool:
			return false
	return true

func released(value: Dictionary) -> bool:
	return not value["left"] and not value["right"] and not value["up"] and not value["down"]

func run_smoke() -> void:
	var file := FileAccess.open("res://control-program.json", FileAccess.READ)
	if file == null or file.get_length() > 262144:
		control_failed()
		return
	var byte_length := file.get_length()
	var parsed = JSON.parse_string(file.get_as_text())
	file.close()
	if not parsed is Dictionary or not exact_keys(parsed, ["format", "schemaVersion", "fixedDelta", "steps"]):
		control_failed()
		return
	var program: Dictionary = parsed
	if program["format"] != "viento-runtime-control" or not program["schemaVersion"] is float or (program["schemaVersion"] != 1 and program["schemaVersion"] != 2) or not program["fixedDelta"] is float or not program["steps"] is Array:
		control_failed()
		return
	var version: int = int(program["schemaVersion"])
	var protocol := 2 if not actors.is_empty() and actors[0].has("instanceId") else 1
	if version == 1 and byte_length > 16384 or version == 2 and protocol != 2:
		control_failed()
		return
	var delta: float = program["fixedDelta"]
	var steps: Array = program["steps"]
	if not is_finite(delta) or delta <= 0 or delta > 0.25 or steps.is_empty() or steps.size() > 64 or delta * steps.size() > 8 or actors.size() * steps.size() > 1024:
		control_failed()
		return
	var known_instances: Dictionary = {}
	if version == 2:
		for actor in actors:
			known_instances[actor["instanceId"]] = true
	var row_count := 0
	for step in steps:
		if not step is Dictionary:
			control_failed()
			return
		if version == 1:
			if not exact_keys(step, ["left", "right", "up", "down"]) or not arrow_fields(step):
				control_failed()
				return
		else:
			if not exact_keys(step, ["inputs"]) or not step["inputs"] is Array:
				control_failed()
				return
			var seen: Dictionary = {}
			for row in step["inputs"]:
				if not row is Dictionary or not exact_keys(row, ["instanceId", "left", "right", "up", "down"]) or not arrow_fields(row):
					control_failed()
					return
				if not row["instanceId"] is String or not known_instances.has(row["instanceId"]) or seen.has(row["instanceId"]):
					control_failed()
					return
				seen[row["instanceId"]] = true
				row_count += 1
				if row_count > 1024:
					control_failed()
					return
	var last: Dictionary = steps.back()
	if version == 1:
		if not released(last):
			control_failed()
			return
	else:
		for row in last["inputs"]:
			if not released(row):
				control_failed()
				return
	instance_control = version == 2
	var actions := {"left": "ui_left", "right": "ui_right", "up": "ui_up", "down": "ui_down"}
	for action in actions.values():
		Input.action_release(action)
	for index in range(steps.size()):
		var step: Dictionary = steps[index]
		if instance_control:
			instance_inputs.clear()
			for row in step["inputs"]:
				instance_inputs[row["instanceId"]] = row
		else:
			for key in actions:
				if step[key]:
					Input.action_press(actions[key])
				else:
					Input.action_release(actions[key])
		_process(delta)
		print("VIENTO_TRACE:" + JSON.stringify({"format": "viento-runtime-trace", "schemaVersion": 1,
			"protocolVersion": protocol, "event": "sample", "stepIndex": index, "actors": states()}))
	for action in actions.values():
		Input.action_release(action)
	instance_inputs.clear()
	emit("finished", {"actors": states(), "fixedDelta": delta})
	get_tree().quit()
