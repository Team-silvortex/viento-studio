extends Node
@export var clip_idle: String = ""
var entered: int = -1
func _ready() -> void:
	_enter_state(0)
func _enter_state(next_state: int) -> bool:
	entered = next_state
	return true
func event() -> void:
	_enter_state(entered)
