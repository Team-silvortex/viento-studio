extends RefCounted

# The controller authenticates this exact object, never mutable author metadata.
var owner: WeakRef

func _init(controller) -> void:
	owner = weakref(controller)

func protocol_version() -> int:
	return 1

func submit(x, y) -> bool:
	var controller = owner.get_ref() if owner != null else null
	return controller != null and controller.submit(self, x, y)
