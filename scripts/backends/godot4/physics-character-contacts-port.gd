extends RefCounted

# Edges of contacts reported by the motor's movement sweeps in this scene visit.
# These are not geometric overlap, persistent touch, or grounded-state signals.
signal started(body_id: String, instance_id: String)
signal ended(body_id: String, instance_id: String)

func protocol_version() -> int:
	return 1
