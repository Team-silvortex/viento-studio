extends RefCounted

# The controller authenticates this exact port object. Public fields and
# author metadata are never the authority for the target platform.
var owner: WeakRef

func _init(controller) -> void:
	owner = weakref(controller)

func protocol_version() -> int:
	return 1

func request_running(value) -> bool:
	var controller = owner.get_ref() if owner != null else null
	return controller != null and controller.request_running(self, value)

func read_running() -> Variant:
	var controller = owner.get_ref() if owner != null else null
	return controller.read_running(self) if controller != null else null
