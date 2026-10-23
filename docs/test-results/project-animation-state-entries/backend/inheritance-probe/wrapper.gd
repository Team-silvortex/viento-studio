extends "res://base.gd"
func _enter_state(next_state: int) -> bool:
	var accepted := super._enter_state(next_state)
	if accepted:
		print("ENTRY:", entered, ":", clip_idle)
	return accepted
