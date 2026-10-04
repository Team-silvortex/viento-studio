extends Node
signal arrived(instance_id: String, checkpoint: String)
@export_range(0, 1000, 0.5) var speed: float = 160.0
@export var checkpoint: String = "dock"
var instance_id: String = ""

func configure(id: String) -> void:
	instance_id = id

func advance(delta: float) -> float:
	arrived.emit(instance_id, checkpoint)
	return speed * delta
