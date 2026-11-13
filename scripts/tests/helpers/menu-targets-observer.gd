extends "res://project-menu-runtime.gd"

# Independent read-only observation. No gameplay callback, port, clock or
# controller method is invoked; optional animation/audio fields are not assumed.
@export var sample_directory: String = "user://menu-targets-observations"
var monitor

class Monitor extends Node:
	var owner_ref: WeakRef
	var keys: Dictionary = {}
	var mouse_buttons: Dictionary = {}
	var sampled_msec := -50
	var capture_visit := -1
	var capture_pending := false
	var captures := 0
	func _ready() -> void:
		process_mode = Node.PROCESS_MODE_ALWAYS
	func _input(event: InputEvent) -> void:
		if event is InputEventKey:
			keys[str(event.physical_keycode)] = event.pressed
		elif event is InputEventMouseButton:
			mouse_buttons[str(event.button_index)] = event.pressed
	func _process(_delta: float) -> void:
		var project = owner_ref.get_ref()
		if project == null or not is_instance_valid(project.get("current")):
			return
		var now_msec := Time.get_ticks_msec()
		if now_msec - sampled_msec >= 50:
			sampled_msec = now_msec
			print("MENU_SAMPLE:" + JSON.stringify(project._snapshot(), "", true, true))
		var visit = project.get("visit_index")
		if visit != capture_visit and not capture_pending:
			capture_visit = visit
			capture_pending = true
			_capture()
	func _capture() -> void:
		await RenderingServer.frame_post_draw
		var project = owner_ref.get_ref()
		if project != null and is_instance_valid(project.get("current")):
			captures += 1
			var target: String = project.sample_directory.path_join("frame-%03d" % captures)
			assert(get_viewport().get_texture().get_image().save_png(target + ".png") == OK)
			var file := FileAccess.open(target + ".json", FileAccess.WRITE)
			assert(file != null)
			file.store_string(JSON.stringify(project._snapshot(), "", true, true) + "\n")
			file.close()
		capture_pending = false

func _ready() -> void:
	super._ready()
	assert(DirAccess.make_dir_recursive_absolute(sample_directory) == OK)
	monitor = Monitor.new()
	monitor.owner_ref = weakref(self)
	monitor.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(monitor)

func _snapshot() -> Dictionary:
	var state = get("shared_state")
	assert(state is Dictionary)
	var menu = get("menu_input")
	assert(is_instance_valid(menu))
	var buttons: Array = []
	_menu_buttons(menu.get("overlay"), buttons)
	return {"sceneId": get("current_scene"), "visit": get("visit_index"), "state": state.duplicate(true), "focused": get_window().has_focus(), "keys": monitor.keys.duplicate(), "mouseButtons": monitor.mouse_buttons.duplicate(), "menuButtons": buttons, "menuArmed": menu.get("armed"), "viewportSize": [get_viewport().get_visible_rect().size.x, get_viewport().get_visible_rect().size.y], "windowSize": [get_window().size.x, get_window().size.y], "frame": Engine.get_process_frames()}

func _menu_buttons(node: Node, result: Array) -> void:
	if node is Button and node.has_meta("viento_menu_item_id"):
		var rectangle: Rect2 = node.get_global_rect()
		result.append({"id": node.get_meta("viento_menu_item_id"), "mode": node.get_meta("viento_menu_mode"), "text": node.text, "visible": node.is_visible_in_tree(), "disabled": node.disabled, "focused": node.has_focus(), "rect": [rectangle.position.x, rectangle.position.y, rectangle.size.x, rectangle.size.y]})
	for child in node.get_children():
		_menu_buttons(child, result)
