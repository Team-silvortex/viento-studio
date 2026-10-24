extends RefCounted

# Per-session delivery policy. The coordinator owns scene lifetime and emits
# protocol frames; this object owns only subscriptions, queues and budgets.
var host: WeakRef
var subscriptions: Dictionary = {}
var queue: Array = []
var registration_count := 0
var sequence := 0
var reserved_deliveries := 0
var total_bytes := 0
var pending_bytes := 0
var draining := false

func _init(owner: Node) -> void:
	host = weakref(owner)

func pending_count() -> int:
	return queue.size()

func fail(binding: Dictionary, code: String, message: String) -> bool:
	return host.get_ref().state_fail(binding, code, message)

# Godot 4.7 compares a bound Callable by its method alone. Include the bound
# argument identities so distinct closures do not silently share a token.
func same_callback(first: Callable, second: Callable) -> bool:
	if first != second or first.get_unbound_arguments_count() != second.get_unbound_arguments_count():
		return false
	var first_arguments := first.get_bound_arguments()
	var second_arguments := second.get_bound_arguments()
	if first_arguments.size() != second_arguments.size():
		return false
	for index in range(first_arguments.size()):
		if typeof(first_arguments[index]) != typeof(second_arguments[index]) or not is_same(first_arguments[index], second_arguments[index]):
			return false
	return true

func subscribe(visit: int, binding: Dictionary, behavior, name, callback) -> int:
	var owner = host.get_ref()
	if owner == null or not owner.state_access(visit):
		return 0
	if not owner.state_key_valid(name):
		fail(binding, "runtime_behavior_event_name", "Project event name is invalid.")
		return 0
	if typeof(callback) != TYPE_CALLABLE or not callback.is_valid() or behavior == null or callback.get_object() != behavior or callback.get_argument_count() != 1:
		fail(binding, "runtime_behavior_event_callback", "Project event callback must belong to this behavior and accept one payload.")
		return 0
	for id in subscriptions:
		var existing: Dictionary = subscriptions[id]
		if existing["visit"] == visit and existing["binding"]["bindingId"] == binding["bindingId"] and existing["name"] == name and same_callback(existing["callback"], callback):
			return id
	if subscriptions.size() >= 64 or registration_count >= 1024:
		fail(binding, "runtime_behavior_event_limit", "Project event subscription budget was exceeded.")
		return 0
	registration_count += 1
	subscriptions[registration_count] = {"visit": visit, "binding": binding.duplicate(true), "name": name, "callback": callback, "behavior": weakref(behavior)}
	return registration_count

func unsubscribe(visit: int, binding: Dictionary, id) -> bool:
	var owner = host.get_ref()
	if owner == null or not owner.state_access(visit):
		return false
	if typeof(id) != TYPE_INT or id < 1 or id > 1024:
		return fail(binding, "runtime_behavior_event_subscription", "Project event subscription identity is invalid.")
	if not subscriptions.has(id):
		return false
	var existing: Dictionary = subscriptions[id]
	if existing["visit"] != visit or existing["binding"]["bindingId"] != binding["bindingId"]:
		return false
	subscriptions.erase(id)
	return true

func publish(visit: int, binding: Dictionary, name, value) -> bool:
	var owner = host.get_ref()
	if owner == null or not owner.state_access(visit):
		return false
	if not owner.state_key_valid(name):
		return fail(binding, "runtime_behavior_event_name", "Project event name is invalid.")
	var value_bytes: int = owner.state_value_bytes(value)
	if value_bytes < 0:
		return fail(binding, "runtime_behavior_event_value", "Project event payload is not a supported bounded scalar.")
	if (typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT) and value == 0:
		value = 0
	var recipients: Array = []
	var ids: Array = subscriptions.keys()
	ids.sort()
	for id in ids:
		var subscription: Dictionary = subscriptions[id]
		if subscription["visit"] == visit and subscription["name"] == name:
			var target: Dictionary = subscription["binding"]
			recipients.push_back({"subscriptionId": id, "bindingId": target["bindingId"], "instanceId": target["instanceId"], "objectId": target["objectId"]})
	var bytes: int = name.length() + value_bytes
	if sequence >= 128 or reserved_deliveries + recipients.size() > 1024 or total_bytes + bytes > 524288 or (not recipients.is_empty() and (queue.size() >= 64 or pending_bytes + bytes > 16384)):
		return fail(binding, "runtime_behavior_event_limit", "Project event delivery budget was exceeded.")
	sequence += 1
	reserved_deliveries += recipients.size()
	total_bytes += bytes
	owner.project_emit("event-publish", {"visitIndex": visit, "sceneId": owner.current_scene, "bindingId": binding["bindingId"],
		"instanceId": binding["instanceId"], "objectId": binding["objectId"], "sequence": sequence, "name": name, "value": value, "recipients": recipients})
	if not recipients.is_empty():
		queue.push_back({"visit": visit, "sceneId": owner.current_scene, "sequence": sequence, "value": value, "recipients": recipients, "bytes": bytes})
		pending_bytes += bytes
		owner.schedule_flush()
	return true

# GDScript has no exception catcher. An async call can abort its direct caller;
# isolate it here so the drain still receives false and rejects the delivery.
func invoke_callback(callback: Callable, value) -> bool:
	var result = callback.call(value)
	return typeof(result) == TYPE_BOOL and result == true

func drain() -> void:
	var owner = host.get_ref()
	if draining or owner == null:
		return
	draining = true
	while not queue.is_empty() and not owner.failed and not owner.finished:
		var message: Dictionary = queue[0]
		for target in message["recipients"]:
			if owner.failed or owner.finished:
				break
			var id: int = target["subscriptionId"]
			var status := "skipped"
			if subscriptions.has(id):
				var subscription: Dictionary = subscriptions[id]
				var callback: Callable = subscription["callback"]
				var behavior = subscription["behavior"].get_ref()
				if not callback.is_valid() or behavior == null or callback.get_object() != behavior:
					fail(subscription["binding"], "runtime_behavior_event_callback", "Project event callback is no longer valid.")
					break
				var observes: bool = owner.has_method("begin_animation_dispatch")
				if observes:
					owner.begin_animation_dispatch(message["visit"], subscription["binding"], callback, {"kind": "event", "eventSequence": message["sequence"], "subscriptionId": id})
				var accepted := invoke_callback(callback, message["value"])
				if observes:
					owner.end_animation_dispatch()
				if not accepted:
					fail(subscription["binding"], "runtime_behavior_event_callback", "Project event callback must synchronously return true.")
					break
				if owner.failed or owner.finished:
					break
				status = "handled"
			owner.project_emit("event-delivery", {"visitIndex": message["visit"], "sceneId": message["sceneId"], "sequence": message["sequence"], "subscriptionId": id, "status": status})
		if owner.failed or owner.finished:
			break
		pending_bytes -= message["bytes"]
		queue.pop_front()
	draining = false

func revoke_visit(visit: int) -> void:
	for id in subscriptions.keys():
		if subscriptions[id]["visit"] == visit:
			subscriptions.erase(id)

func clear() -> void:
	subscriptions.clear()
	queue.clear()
	pending_bytes = 0
