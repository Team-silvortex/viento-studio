extends "__PLATFORM_EVENTS__"

const ControlPort = preload("res://platform-control-port.gd")
var control_scene: WeakRef
var control_visit := -1
var control_records: Dictionary = {}
var control_pending: Dictionary = {}
var control_running: Dictionary = {}

func _init(instance_ids: Array) -> void:
	super(instance_ids)

func attach(scene: Node, binding: Dictionary, behavior: Node) -> void:
	super.attach(scene, binding, behavior)
	var instance_id: String = binding["instanceId"]
	if not active(scene) or not instance_id in declared or not platforms.has(instance_id):
		return
	var platform = platforms[instance_id]["node"].get_ref()
	if not is_instance_valid(platform):
		return
	control_scene = weakref(scene)
	control_visit = scene.project_visit
	var port = ControlPort.new(self)
	control_records[port.get_instance_id()] = {"port": weakref(port), "behavior": weakref(behavior),
		"platform": weakref(platform), "instanceId": instance_id}
	behavior.set_meta("viento_platform_control", port)

# The port is injected before add_child; _ready calls arrive only after the
# actual behavior has joined its trusted platform. Reparented or dead bindings
# lose authority even if their metadata still names the original instance.
func control_record(port) -> Variant:
	var scene = control_scene.get_ref() if control_scene != null else null
	if not active(scene) or scene.project_visit != control_visit or not is_instance_valid(port):
		return null
	var record = control_records.get(port.get_instance_id())
	if record == null or record["port"].get_ref() != port:
		return null
	var behavior = record["behavior"].get_ref()
	var platform = record["platform"].get_ref()
	if not is_instance_valid(behavior) or not behavior.is_inside_tree() or behavior.is_queued_for_deletion() or not is_instance_valid(platform) or not platform.is_inside_tree() or platform.is_queued_for_deletion() or behavior.get_parent() != platform:
		return null
	var instance_id: String = record["instanceId"]
	if not platforms.has(instance_id) or platforms[instance_id]["node"].get_ref() != platform:
		return null
	for actor in scene.actors:
		if actor["instanceId"] == instance_id and actor["node"] == platform:
			return record
	return null

func request_running(port, value) -> bool:
	if typeof(value) != TYPE_BOOL:
		return false
	var record: Variant = control_record(port)
	var scene = control_scene.get_ref() if control_scene != null else null
	if record == null or not scene.can_process():
		return false
	var instance_id: String = record["instanceId"]
	if control_pending.has(instance_id):
		var previous = control_pending[instance_id]["port"].get_ref()
		if previous != null and control_record(previous) != null:
			return false
	control_pending[instance_id] = {"port": weakref(port), "running": value}
	return true

func read_running(port) -> Variant:
	var record: Variant = control_record(port)
	return control_running.get(record["instanceId"], true) if record != null else null

func begin(scene: Node, delta: float) -> void:
	if not active(scene) or not is_finite(delta) or delta < 0.0:
		super.begin(scene, delta)
		return
	var requests := control_pending
	control_pending = {}
	for instance_id in requests:
		var request: Dictionary = requests[instance_id]
		var port = request["port"].get_ref()
		if port != null and control_record(port) != null:
			control_running[instance_id] = request["running"]
	# Only the private, parsed runtime declaration is projected to a zero
	# effective speed. The ordinary support collection and sole character
	# solver still run; original speed is restored before any author callback.
	var speeds: Dictionary = {}
	for instance_id in platforms:
		if not control_running.get(instance_id, true):
			speeds[instance_id] = platforms[instance_id]["motion"]["speed"]
			platforms[instance_id]["motion"]["speed"] = 0.0
	super.begin(scene, delta)
	for instance_id in speeds:
		if platforms.has(instance_id):
			platforms[instance_id]["motion"]["speed"] = speeds[instance_id]

func revoke() -> void:
	control_pending.clear()
	control_running.clear()
	control_records.clear()
	control_scene = null
	control_visit = -1
	super.revoke()
