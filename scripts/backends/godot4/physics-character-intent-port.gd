extends RefCounted

var owner: WeakRef
var token: int

func _init(controller, id: int) -> void:
	owner = weakref(controller)
	token = id

func protocol_version() -> int:
	return 1

func submit(axis, jump) -> bool:
	var controller = owner.get_ref() if owner != null else null
	return controller != null and controller.submit(token, axis, jump)
