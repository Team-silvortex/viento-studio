extends RefCounted

# Coalesced facts for this behavior's platform and scene visit. Each signal
# means its endpoint was reached at least once in the completed project step;
# it does not count crossings. Initial placement and zero time emit nothing.
signal origin_reached
signal destination_reached

func protocol_version() -> int:
	return 1
