extends RefCounted

# The behavior owns a capability for its own instance in this scene visit.
# Acceptance queues a request; the next native step revalidates its support.
var owner: WeakRef
var token: int

func _init(helper: RefCounted, identity: int) -> void:
	owner = weakref(helper)
	token = identity

func protocol_version() -> int:
	return 1

func request_drop() -> bool:
	var helper = owner.get_ref()
	return helper != null and helper.request(token)
