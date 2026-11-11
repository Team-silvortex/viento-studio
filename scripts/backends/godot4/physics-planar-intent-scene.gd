extends "__PLANAR_BASE__"

var planar_intent = preload("res://planar-intent-helper.gd").new(__PLANAR_INSTANCES__)
var planar_step_active := false

func _ready() -> void:
	tree_exiting.connect(planar_intent.revoke)
	super._ready()

func project_behavior_port(binding: Dictionary, instance: Node) -> RefCounted:
	var project_port := super.project_behavior_port(binding, instance)
	planar_intent.attach(self, binding, instance)
	return project_port

func project_step(delta: float) -> void:
	# Zero/invalid steps do not consume an accepted request. Paused steps are
	# equally inert; ownership is checked again when actual execution resumes.
	if not is_finite(delta) or delta <= 0.0 or not planar_step_permitted() or not planar_intent.begin(self):
		return
	planar_step_active = true
	super.project_step(delta)
	planar_step_active = false

func planar_step_permitted() -> bool:
	if planar_step_active:
		return false
	var contacts = get("movement_contacts")
	if contacts == null or not contacts.opened or contacts.stepping or contacts.flushing:
		return false
	if get("character_events_open") != null and (not get("character_events_open") or get("character_events_stepping") or get("character_events_flushing")):
		return false
	var platform = get("platform_motion")
	if platform != null and platform.has_method("start") and (platform.stepping or platform.flushing or not platform.active(self)):
		return false
	return true

func project_close(silent: bool = false) -> void:
	planar_intent.revoke()
	super.project_close(silent)
