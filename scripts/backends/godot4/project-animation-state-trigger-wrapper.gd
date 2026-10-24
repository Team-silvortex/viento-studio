extends "res://behaviors/__SCRIPT_OBJECT_ID__.gd"

# Fixed observation scopes never replace the generated controller's decisions.
# A direct call outside the actual dispatcher cannot borrow a message identity.
var _viento_entry_kind := "direct"
var _viento_entry_event := ""
var _viento_ready_seen := false

func _ready() -> void:
	var previous := _viento_entry_kind
	_viento_entry_kind = "initial" if not _viento_ready_seen and is_inside_tree() else "direct"
	_viento_ready_seen = true
	super._ready()
	_viento_entry_kind = previous

func _on_event(value, event_name: String) -> bool:
	var previous := _viento_entry_kind
	var previous_event := _viento_entry_event
	_viento_entry_kind = "event"
	_viento_entry_event = event_name
	var accepted := super._on_event(value, event_name)
	_viento_entry_kind = previous
	_viento_entry_event = previous_event
	return accepted

func _on_completed(clip_id) -> bool:
	var previous := _viento_entry_kind
	_viento_entry_kind = "completed"
	var accepted := super._on_completed(clip_id)
	_viento_entry_kind = previous
	return accepted

func _enter_state(next_state: int) -> bool:
	var accepted := super._enter_state(next_state)
	if accepted:
		_project.record_animation_state_entry_trigger(_viento_entry_kind, _viento_entry_event)
	return accepted
