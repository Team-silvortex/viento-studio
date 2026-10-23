extends RefCounted

# Completion ownership belongs to the scene animation. Only recipients have
# behavior origins; an automatic completion never fabricates a publisher.
var host: WeakRef
var subscriptions: Dictionary = {}
var queue: Array = []
var registration_count := 0
var sequence := 0
var reserved_deliveries := 0
var draining := false

func _init(owner: Node) -> void:
	host = weakref(owner)

func pending_count() -> int:
	return queue.size()

func subscribe(visit: int, binding: Dictionary, behavior, callback) -> int:
	var owner = host.get_ref()
	if owner == null or not owner.state_access(visit):
		return 0
	if not owner.current.project_animation_declared():
		owner.state_fail(binding, "runtime_behavior_animation_missing", "The current scene has no declared animation.")
		return 0
	if typeof(callback) != TYPE_CALLABLE or not callback.is_valid() or behavior == null or callback.get_object() != behavior or callback.get_argument_count() != 1:
		owner.state_fail(binding, "runtime_behavior_animation_completion_callback", "Animation completion callback must belong to this behavior and accept one clip identity.")
		return 0
	for id in subscriptions:
		var existing: Dictionary = subscriptions[id]
		if existing["visit"] == visit and existing["binding"]["bindingId"] == binding["bindingId"] and owner.event_bus.same_callback(existing["callback"], callback):
			return id
	if subscriptions.size() >= 64 or registration_count >= 1024:
		owner.state_fail(binding, "runtime_behavior_animation_completion_limit", "Animation completion subscription budget was exceeded.")
		return 0
	registration_count += 1
	subscriptions[registration_count] = {"visit": visit, "binding": binding.duplicate(true), "callback": callback, "behavior": weakref(behavior)}
	return registration_count

func unsubscribe(visit: int, binding: Dictionary, id) -> bool:
	var owner = host.get_ref()
	if owner == null or not owner.state_access(visit):
		return false
	if typeof(id) != TYPE_INT or id < 1 or id > 1024:
		return owner.state_fail(binding, "runtime_behavior_animation_completion_subscription", "Animation completion subscription identity is invalid.")
	if not subscriptions.has(id):
		return false
	var existing: Dictionary = subscriptions[id]
	if existing["visit"] != visit or existing["binding"]["bindingId"] != binding["bindingId"]:
		return false
	subscriptions.erase(id)
	return true

func complete(visit: int, state: Dictionary) -> void:
	var owner = host.get_ref()
	if owner == null or not owner.state_access(visit):
		return
	var recipients: Array = []
	var ids: Array = subscriptions.keys()
	ids.sort()
	for id in ids:
		var subscription: Dictionary = subscriptions[id]
		if subscription["visit"] == visit:
			var target: Dictionary = subscription["binding"]
			recipients.push_back({"subscriptionId": id, "bindingId": target["bindingId"], "instanceId": target["instanceId"], "objectId": target["objectId"]})
	if sequence >= 320 or reserved_deliveries + recipients.size() > 1024 or not recipients.is_empty() and queue.size() >= 64:
		owner.current.emit("diagnostic", {"severity": "error", "code": "runtime_animation_completion_limit", "message": "Animation completion delivery budget was exceeded."})
		return
	sequence += 1
	reserved_deliveries += recipients.size()
	var message := {"completionSequence": sequence, "commandSequence": owner.animation_control.sequence, "visitIndex": visit, "sceneId": owner.current_scene, "state": state.duplicate(true), "recipients": recipients}
	owner.project_emit("animation-completed", message.duplicate(true))
	if not recipients.is_empty():
		queue.push_back(message)
		owner.schedule_flush()

func invoke_callback(callback: Callable, clip_id) -> bool:
	var result = callback.call(clip_id)
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
			if subscriptions.has(id) and owner.state_access(message["visitIndex"]) and owner.current_scene == message["sceneId"] and owner.animation_control.sequence == message["commandSequence"] and owner.pending_scene == "" and not owner.finish_requested:
				var subscription: Dictionary = subscriptions[id]
				var behavior = subscription["behavior"].get_ref()
				var callback: Callable = subscription["callback"]
				if behavior == null:
					subscriptions.erase(id)
				elif not callback.is_valid() or callback.get_object() != behavior:
					owner.state_fail(subscription["binding"], "runtime_behavior_animation_completion_callback", "Animation completion callback is no longer valid.")
					break
				elif not invoke_callback(callback, message["state"]["clipId"]):
					if not owner.failed:
						owner.state_fail(subscription["binding"], "runtime_behavior_animation_completion_callback", "Animation completion callback must synchronously return true.")
					break
				elif not owner.failed and not owner.finished:
					status = "handled"
			if owner.failed or owner.finished:
				break
			owner.project_emit("animation-completion-delivery", {"visitIndex": message["visitIndex"], "sceneId": message["sceneId"], "completionSequence": message["completionSequence"], "subscriptionId": id, "status": status})
		if owner.failed or owner.finished:
			break
		queue.pop_front()
	draining = false

func revoke_visit(visit: int) -> void:
	for id in subscriptions.keys():
		if subscriptions[id]["visit"] == visit:
			subscriptions.erase(id)

func clear() -> void:
	subscriptions.clear()
	queue.clear()
