extends "res://behaviors/__SCRIPT_OBJECT_ID__.gd"

# Generated observation only: the original controller owns all state changes.
# A successful return means both requests were accepted, not yet executed.
func _enter_state(next_state: int) -> bool:
	var accepted := super._enter_state(next_state)
	if accepted:
		_project.record_animation_state_entry()
	return accepted
