extends SceneTree
var events: Array = []
var failures: Array = []

func require(value: bool, message: String) -> void:
	if not value:
		printerr("PROBE_FAILED: " + message)
		failures.append(message)

func on_arrived(instance_id: String, checkpoint: String) -> void:
	events.append({"instanceId": instance_id, "checkpoint": checkpoint})

func _init() -> void:
	if OS.get_cmdline_user_args().has("--self-test-failure"):
		require(false, "deliberate failure to verify nonzero exit")
	var declaration: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://bindings.json"))
	var behavior: Script = load(declaration.behavior)
	require(behavior.can_instantiate(), "script must instantiate")
	var exported: Dictionary = {}
	for property in behavior.get_script_property_list():
		if property.usage & PROPERTY_USAGE_EDITOR and property.usage & PROPERTY_USAGE_SCRIPT_VARIABLE:
			exported[property.name] = {"type": type_string(property.type), "hint": property.hint, "hintString": property.hint_string, "default": behavior.get_property_default_value(property.name)}
	require(exported.has("speed") and exported.has("checkpoint"), "exported fields")
	var range_parts: PackedStringArray = exported.speed.hintString.split(",")
	require(exported.speed.type == "float" and exported.speed.hint == PROPERTY_HINT_RANGE and range_parts.size() == 3, "field schema")
	require(range_parts.size() == 3 and float(range_parts[0]) == 0.0 and float(range_parts[1]) == 1000.0 and float(range_parts[2]) == 0.5, "numeric range metadata")
	require(exported.speed.default == 160.0 and exported.checkpoint.default == "dock", "exported defaults")
	var methods: Array = []
	for method in behavior.get_script_method_list():
		methods.append(method.name)
	var signals: Array = []
	for item in behavior.get_script_signal_list():
		signals.append(item.name)
	require(methods.has("configure") and methods.has("advance") and signals.has("arrived"), "methods and signal metadata")
	var instances: Array = []
	var calls: Array = []
	var distances: Array = []
	for binding in declaration.instances:
		var instance: Node = behavior.new()
		for key in binding.params:
			require(exported.has(key), "unknown parameter")
			instance.set(key, binding.params[key])
		instance.call("configure", binding.instanceId)
		require(instance.connect("arrived", Callable(self, "on_arrived")) == OK, "connect signal")
		instances.append(instance)
		calls.append(Callable(instance, "advance"))
	for action in calls:
		distances.append(action.call(0.25))
	require(distances == [40.0, 20.0], "independent instance parameters")
	require(events == [{"instanceId":"guard-east","checkpoint":"east"},{"instanceId":"guard-west","checkpoint":"west"}], "signal routing")
	instances[0].set("speed", 200.0)
	require(is_equal_approx(float(calls[0].call(0.25)), 50.0) and is_equal_approx(float(instances[1].get("speed")), 80.0), "parameter update isolation")
	var callback := Callable(self, "on_arrived")
	instances[0].disconnect("arrived", callback)
	calls[0].call(0.25)
	require(events.size() == 3, "disconnect signal")
	var features := {"dotnet": OS.has_feature("C#"), "headless": DisplayServer.get_name() == "headless"}
	print("VIENTO_BINDING_PROBE:" + JSON.stringify({"ok":failures.is_empty(),"failures":failures,"godot":Engine.get_version_info().string,"features":features,"properties":exported,"methods":methods,"signals":signals,"distances":distances,"events":events,"checks":["export metadata and defaults","method and signal discovery","two instances of one behavior","per-instance parameter binding","bound callable invocation","signal routing with instance identity","parameter update isolation","signal disconnect"]}))
	for instance in instances:
		instance.free()
	quit(0 if failures.is_empty() else 1)
