extends "res://runtime.gd"

var behavior_failed := false
var behavior_finished := false

func emit(event: String, data: Dictionary = {}) -> void:
	if event == "diagnostic":
		behavior_failed = true
	if event == "finished":
		behavior_finished = true
	data["protocol"] = 3
	data["event"] = event
	print("VIENTO_RUNTIME:" + JSON.stringify(data))

func behavior_fail(code: String, message: String, binding: Dictionary, parameter: String = "") -> void:
	var data := {"severity": "error", "code": code, "message": message, "bindingId": binding["bindingId"],
		"instanceId": binding["instanceId"], "objectId": binding["objectId"]}
	if parameter != "":
		data["parameter"] = parameter
	emit("diagnostic", data)
	get_tree().quit(1)

func _ready() -> void:
	super._ready()
	if behavior_failed:
		return
	var declaration: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://behaviors.json"))
	var scripts: Dictionary = {}
	for source in declaration["sources"]:
		scripts[source["objectId"]] = load("res://" + source["path"])
	for binding in declaration["bindings"]:
		var script: Script = scripts[binding["implementation"]["sourceObjectId"]]
		if script == null or not script.can_instantiate():
			behavior_fail("runtime_behavior_script", "Cannot instantiate behavior script.", binding)
			return
		var base_type := script.get_instance_base_type()
		if base_type != "Node" and not ClassDB.is_parent_class(base_type, "Node"):
			behavior_fail("runtime_behavior_script", "Behavior must derive from Node.", binding)
			return
		for method in script.get_script_method_list():
			if method["name"] == "_init" and method["args"].size() > method["default_args"].size():
				behavior_fail("runtime_behavior_script", "Behavior constructor must accept no arguments.", binding)
				return
		var exported: Dictionary = {}
		for property in script.get_script_property_list():
			if property["usage"] & PROPERTY_USAGE_EDITOR and property["usage"] & PROPERTY_USAGE_SCRIPT_VARIABLE:
				exported[property["name"]] = property
		for key in binding["parameters"]:
			if not exported.has(key) or not parameter_matches(binding["parameters"][key], exported[key]["type"]):
				behavior_fail("runtime_behavior_parameter", "Behavior parameter is missing or has the wrong exported type.", binding, key)
				return
		var declared_signals: Dictionary = {}
		for item in script.get_script_signal_list():
			declared_signals[item["name"]] = item
		for event in binding["events"]:
			if not declared_signals.has(event["signal"]) or not signal_supported(declared_signals[event["signal"]]["args"]):
				behavior_fail("runtime_behavior_signal", "Behavior signal is missing or requires unsupported arguments.", binding)
				return
		var instance = script.new()
		if not instance is Node:
			if instance is Object:
				instance.free()
			behavior_fail("runtime_behavior_script", "Behavior must instantiate a Node with no constructor arguments.", binding)
			return
		instance.name = "behavior_" + binding["bindingId"].replace("-", "_")
		instance.set_meta("viento_binding_id", binding["bindingId"])
		instance.set_meta("viento_instance_id", binding["instanceId"])
		instance.set_meta("viento_object_id", binding["objectId"])
		for key in binding["parameters"]:
			var value = binding["parameters"][key]
			if exported[key]["type"] == TYPE_INT:
				value = int(value)
			elif exported[key]["type"] == TYPE_FLOAT:
				value = float(value)
			instance.set(key, value)
		for event in binding["events"]:
			var count: int = declared_signals[event["signal"]]["args"].size()
			var callback := Callable(self, "behavior_event_" + str(count)).bind(binding, event["event"])
			if instance.connect(event["signal"], callback) != OK:
				instance.free()
				behavior_fail("runtime_behavior_signal", "Cannot connect behavior signal.", binding)
				return
		for actor in actors:
			if actor["instanceId"] == binding["instanceId"]:
				actor["node"].add_child(instance)
				break
		if behavior_failed:
			return

func parameter_matches(value, expected: int) -> bool:
	if expected == TYPE_FLOAT:
		return (typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT) and is_finite(float(value))
	if expected == TYPE_INT:
		return (typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT) and is_finite(float(value)) and float(value) == floor(float(value)) and abs(float(value)) <= 9007199254740991.0
	return (expected == TYPE_BOOL or expected == TYPE_STRING) and typeof(value) == expected

func signal_supported(args: Array) -> bool:
	if args.size() > 4:
		return false
	for argument in args:
		if not argument["type"] in [TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING]:
			return false
	return true

func send_behavior_event(arguments: Array, binding: Dictionary, alias: String) -> void:
	if behavior_failed or behavior_finished:
		return
	for argument in arguments:
		if not event_scalar(argument):
			behavior_fail("runtime_behavior_event", "Behavior signal emitted an unsupported value.", binding)
			return
	emit("behavior", {"bindingId": binding["bindingId"], "instanceId": binding["instanceId"], "objectId": binding["objectId"], "name": alias, "arguments": arguments})

func event_scalar(value) -> bool:
	if typeof(value) == TYPE_INT:
		return value >= -9007199254740991 and value <= 9007199254740991
	if typeof(value) == TYPE_FLOAT:
		return is_finite(value) and (value != floor(value) or abs(value) <= 9007199254740991.0)
	if typeof(value) == TYPE_STRING:
		return value.to_utf16_buffer().size() <= 8192
	return typeof(value) == TYPE_BOOL

func behavior_event_0(binding: Dictionary, alias: String) -> void:
	send_behavior_event([], binding, alias)
func behavior_event_1(a, binding: Dictionary, alias: String) -> void:
	send_behavior_event([a], binding, alias)
func behavior_event_2(a, b, binding: Dictionary, alias: String) -> void:
	send_behavior_event([a, b], binding, alias)
func behavior_event_3(a, b, c, binding: Dictionary, alias: String) -> void:
	send_behavior_event([a, b, c], binding, alias)
func behavior_event_4(a, b, c, d, binding: Dictionary, alias: String) -> void:
	send_behavior_event([a, b, c, d], binding, alias)

func run_smoke() -> void:
	if not behavior_failed:
		super.run_smoke()
