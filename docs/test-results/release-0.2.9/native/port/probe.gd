extends SceneTree
const Helper = preload("res://planar-intent-helper.gd")
const Port = preload("res://planar-intent-port.gd")
const A := "11111111-1111-4111-8111-111111111111"
const B := "22222222-2222-4222-8222-222222222222"
var checked := 0
var failed: Array = []
var cases: Array = []

class FakeHost extends RefCounted:
	var current_visit := 1
	var enabled := true
	var pending_scene := ""
	func state_access(index: int) -> bool:
		return enabled and index == current_visit

class FakeScene extends Node2D:
	var project_open := true
	var physics_failed := false
	var project_visit := 1
	var project_host = FakeHost.new()
	var character_motion_configs: Dictionary = {}
	var physics_bodies: Dictionary = {}
	var actors: Array = []

func check(value: bool, label: String) -> void:
	checked += 1
	if not value:
		failed.append(label)

func close_vector(actual: Vector2, expected: Vector2, label: String) -> void:
	check(actual.is_equal_approx(expected), label + ": " + str(actual) + " != " + str(expected))

func fixture(identities: Array = [A, B]) -> Dictionary:
	var scene = FakeScene.new()
	root.add_child(scene)
	return {"scene": scene, "helper": Helper.new(identities)}

func physical(scene, identity: String, native_kind := "character", declaration := "character", controls := "none"):
	var body
	match native_kind:
		"static": body = StaticBody2D.new()
		"sensor": body = Area2D.new()
		"node": body = Node2D.new()
		_: body = CharacterBody2D.new()
	scene.add_child(body)
	scene.physics_bodies[identity] = declaration
	scene.actors.append({"instanceId": identity, "controls": controls, "node": body})
	return body

func bind(helper, scene, body, identity: String):
	var behavior = Node.new()
	helper.attach(scene, {"instanceId": identity}, behavior)
	body.add_child(behavior)
	return behavior

func port(behavior):
	return behavior.get_meta("viento_planar_intent") if behavior.has_meta("viento_planar_intent") else null

func dispose(f: Dictionary) -> void:
	f["helper"].revoke()
	if is_instance_valid(f["scene"]):
		f["scene"].free()

func _initialize() -> void:
	call_deferred("run_probe")

func eligibility() -> void:
	for row in [
		["eligible", A, "character", "character", "none", false, true],
		["not-listed", B, "character", "character", "none", false, false],
		["gravity", A, "character", "character", "none", true, false],
		["arrows", A, "character", "character", "arrows", false, false],
		["static", A, "static", "static", "none", false, false],
		["sensor", A, "sensor", "sensor", "none", false, false],
		["nonphysical", A, "node", "character", "none", false, false],
		["undeclared", A, "character", "", "none", false, false],
	]:
		var f = fixture([A])
		var body = physical(f.scene, row[1], row[2], row[3], row[4])
		if row[5]:
			f.scene.character_motion_configs[row[1]] = {"kind":"platformer"}
		var behavior = bind(f.helper, f.scene, body, row[1])
		check((port(behavior) != null) == row[6], "grant/" + row[0])
		if port(behavior) != null:
			check(port(behavior).protocol_version() == 1, "grant/version")
		dispose(f)
	for condition in ["closed", "failed", "wrong-visit"]:
		var f = fixture()
		var body = physical(f.scene, A)
		if condition == "closed": f.scene.project_open = false
		if condition == "failed": f.scene.physics_failed = true
		if condition == "wrong-visit": f.scene.project_host.current_visit = 2
		check(port(bind(f.helper, f.scene, body, A)) == null, "grant/" + condition)
		dispose(f)
	# A ready-time pending scene switch must not produce a missing-metadata
	# contract error, but no input may enter the departing visit's queue.
	var queued = fixture()
	var body = physical(queued.scene, A)
	queued.scene.project_host.pending_scene = B
	var pending_port = port(bind(queued.helper, queued.scene, body, A))
	check(pending_port != null, "ready-switch/metadata-still-injected")
	if pending_port != null:
		check(not pending_port.submit(1.0, 0.0), "ready-switch/submission-refused")
	check(not queued.helper.begin(queued.scene), "ready-switch/step-refused")
	dispose(queued)

func numeric_admission() -> void:
	var f = fixture()
	var p = port(bind(f.helper, f.scene, physical(f.scene, A), A))
	check(p != null, "numbers/port")
	if p == null:
		dispose(f)
		return
	for invalid in [true, false, null, "0", [], {}, NAN, INF, -INF, 1.0001, -1.0001]:
		for pair in [[invalid, 0.0], [0.0, invalid]]:
			check(not p.submit(pair[0], pair[1]), "numbers/reject-" + str(pair))
			check(p.submit(0.25, -0.5), "numbers/invalid-did-not-occupy-slot")
			check(f.helper.begin(f.scene), "numbers/step")
			close_vector(f.helper.take(A), Vector2(0.25, -0.5), "numbers/admitted-vector")
	check(p.submit(1, 1), "numbers/integer-components-accepted")
	f.helper.begin(f.scene)
	close_vector(f.helper.take(A), Vector2(1, 1).normalized(), "numbers/diagonal-normalized-at-consumption")
	check(p.submit(0.1, -0.2), "numbers/short-vector-accepted")
	f.helper.begin(f.scene)
	close_vector(f.helper.take(A), Vector2(0.1, -0.2), "numbers/short-vector-strength-retained")
	f.helper.begin(f.scene)
	close_vector(f.helper.take(A), Vector2.ZERO, "numbers/no-request-is-zero")
	dispose(f)

func first_request_and_instances() -> void:
	var f = fixture()
	var first = physical(f.scene, A)
	var pa = port(bind(f.helper, f.scene, first, A))
	var competing = port(bind(f.helper, f.scene, first, A))
	var pb = port(bind(f.helper, f.scene, physical(f.scene, B), B))
	check(pa.submit(0.5, 0.25), "first/accepted")
	check(not competing.submit(-1.0, -1.0), "first/refusal-does-not-overwrite")
	check(pb.submit(-0.25, -0.5), "first/other-instance-independent")
	f.helper.begin(f.scene)
	close_vector(f.helper.take(A), Vector2(0.5, 0.25), "first/original-vector-kept")
	close_vector(f.helper.take(B), Vector2(-0.25, -0.5), "first/second-vector")
	check(competing.submit(-1.0, 0.0), "first/slot-released-next-step")
	f.helper.begin(f.scene)
	close_vector(f.helper.take(A), Vector2(-1.0, 0.0), "first/next-request")
	close_vector(f.helper.take(B), Vector2.ZERO, "first/other-instance-not-latched")
	dispose(f)

func dead_pending_and_owner_identity() -> void:
	for queued in [false, true]:
		var f = fixture()
		var body = physical(f.scene, A)
		var old = bind(f.helper, f.scene, body, A)
		var replacement = bind(f.helper, f.scene, body, A)
		var old_port = port(old)
		var new_port = port(replacement)
		check(old_port.submit(1.0, 0.0), "dead/queued-first")
		if queued: old.queue_free()
		else: old.free()
		check(not old_port.submit(-1.0, 0.0), "dead/old-owner-rejected")
		check(new_port.submit(-0.5, 0.5), "dead/valid-owner-reclaims-slot")
		f.helper.begin(f.scene)
		close_vector(f.helper.take(A), Vector2(-0.5, 0.5), "dead/replacement-consumed")
		dispose(f)
	var f = fixture()
	var first = physical(f.scene, A)
	var other = physical(f.scene, B)
	var behavior = bind(f.helper, f.scene, first, A)
	var original = port(behavior)
	var forged = Port.new(f.helper)
	check(not forged.submit(1.0, 0.0), "owner/forged-port-object")
	behavior.set_meta("viento_instance_id", B)
	check(original.submit(0.25, 0.25), "owner/metadata-does-not-redirect")
	f.helper.begin(f.scene)
	close_vector(f.helper.take(A), Vector2(0.25, 0.25), "owner/original-instance")
	close_vector(f.helper.take(B), Vector2.ZERO, "owner/other-instance-unaffected")
	check(original.submit(0.5, 0.0), "owner/pending-before-reparent")
	first.remove_child(behavior)
	other.add_child(behavior)
	check(not original.submit(0.0, 1.0), "owner/wrong-parent-rejected")
	f.helper.begin(f.scene)
	close_vector(f.helper.take(A), Vector2.ZERO, "owner/reparented-pending-discarded")
	dispose(f)

func pause_contract() -> void:
	var f = fixture()
	var p = port(bind(f.helper, f.scene, physical(f.scene, A), A))
	check(p.submit(0.5, 0.25), "pause/pending-before-pause")
	paused = true
	check(not p.submit(-0.5, -0.25), "pause/reject-new")
	check(not f.helper.begin(f.scene), "pause/no-consumption")
	close_vector(f.helper.take(A), Vector2.ZERO, "pause/no-current-direction")
	paused = false
	check(not p.submit(-1.0, 0.0), "pause/original-pending-still-reserves-slot")
	check(f.helper.begin(f.scene), "pause/resume-step")
	close_vector(f.helper.take(A), Vector2(0.5, 0.25), "pause/kept-original-pending")
	f.helper.begin(f.scene)
	close_vector(f.helper.take(A), Vector2.ZERO, "pause/not-latched-after-consumption")
	dispose(f)

func departing_and_queued_nodes() -> void:
	for kind in ["scene", "character", "behavior", "pending-switch"]:
		var f = fixture()
		var body = physical(f.scene, A)
		var behavior = bind(f.helper, f.scene, body, A)
		var p = port(behavior)
		check(p.submit(1.0, 0.0), "depart/initial-" + kind)
		if kind == "scene": f.scene.queue_free()
		if kind == "character": body.queue_free()
		if kind == "behavior": behavior.queue_free()
		if kind == "pending-switch": f.scene.project_host.pending_scene = B
		check(not p.submit(0.0, 1.0), "depart/reject-" + kind)
		f.helper.begin(f.scene)
		close_vector(f.helper.take(A), Vector2.ZERO, "depart/discard-pending-" + kind)
		dispose(f)
	var f = fixture()
	var p = port(bind(f.helper, f.scene, physical(f.scene, A), A))
	f.scene.free()
	check(not p.submit(1.0, 0.0), "depart/freed-scene-port-rejected")
	f.helper.revoke()

func close_revoke_and_new_visit() -> void:
	var f = fixture()
	var body = physical(f.scene, A)
	var p = port(bind(f.helper, f.scene, body, A))
	check(p.submit(1.0, 0.0), "close/initial")
	f.scene.project_open = false
	check(not p.submit(0.0, 1.0), "close/rejected")
	check(not f.helper.begin(f.scene), "close/step-rejected")
	close_vector(f.helper.take(A), Vector2.ZERO, "close/old-pending-cleared")
	f.helper.revoke()
	f.scene.project_open = true
	check(not p.submit(1.0, 0.0), "revoke/open-flag-cannot-revive")
	check(not f.helper.begin(f.scene), "revoke/begin-cannot-revive")
	check(port(bind(f.helper, f.scene, body, A)) == null, "revoke/attach-cannot-revive")
	var fresh = Helper.new([A])
	f.scene.project_visit = 2
	f.scene.project_host.current_visit = 2
	var next = port(bind(fresh, f.scene, body, A))
	check(next != null, "visit/new-port")
	check(next.submit(0.0, -1.0), "visit/new-request")
	check(not p.submit(1.0, 0.0), "visit/old-port-still-rejected")
	fresh.begin(f.scene)
	close_vector(fresh.take(A), Vector2(0.0, -1.0), "visit/only-new-visit-consumed")
	fresh.revoke()
	dispose(f)

func missing_actor_and_helper_lifetime() -> void:
	var f = fixture()
	var body = physical(f.scene, A)
	var behavior = Node.new()
	f.helper.attach(f.scene, {"instanceId":A}, behavior)
	var p = port(behavior)
	check(p != null, "lifetime/preadd-port-injected")
	check(not p.submit(1.0, 0.0), "lifetime/preadd-cannot-submit")
	body.add_child(behavior)
	check(p.submit(0.0, 0.5), "lifetime/actual-parent-activates")
	f.scene.actors.clear()
	check(not p.submit(1.0, 0.0), "lifetime/actor-no-longer-frozen-member")
	f.helper.begin(f.scene)
	close_vector(f.helper.take(A), Vector2.ZERO, "lifetime/removed-actor-pending-discarded")
	dispose(f)
	var orphan
	var next = fixture()
	var node = physical(next.scene, A)
	var helper = Helper.new([A])
	orphan = port(bind(helper, next.scene, node, A))
	helper = null
	check(not orphan.submit(1.0, 0.0), "lifetime/expired-controller-weakref")
	dispose(next)

func run_probe() -> void:
	for entry in [
		["eligibility-and-ready-switch", eligibility],
		["finite-numeric-admission-and-vector-policy", numeric_admission],
		["first-request-and-instance-isolation", first_request_and_instances],
		["dead-pending-and-authentic-owner", dead_pending_and_owner_identity],
		["pause-and-single-consumption", pause_contract],
		["departing-and-queued-nodes", departing_and_queued_nodes],
		["close-revoke-and-new-visit", close_revoke_and_new_visit],
		["actor-and-helper-lifetime", missing_actor_and_helper_lifetime],
	]:
		var before: int = failed.size()
		var count_before := checked
		entry[1].call()
		cases.append({"name":entry[0],"passed":failed.size() == before,"checks":checked-count_before})
	print("PLANAR_INTENT_COMPONENT:" + JSON.stringify({"checked":checked,"failed":failed,"cases":cases}))
	quit(0 if failed.is_empty() else 1)
