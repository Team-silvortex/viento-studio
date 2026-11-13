extends Node

# Only this engine-owned GUI subtree processes during pause. Real GUI gestures
# select frozen item ids; dispatch waits for physical release and revalidates the
# visit. Ordinary author nodes never inherit ALWAYS processing or activation.
var host: WeakRef
var overlay: CanvasLayer
var menu_panel: PanelContainer
var menu_scroll: ScrollContainer
var column: VBoxContainer
var title_label: Label
var panel_style: StyleBoxFlat
var window: Window
var focused := false
var active_mode := ""
var active_port: WeakRef
var active_configuration: Dictionary = {}
var buttons: Array = []
var armed := false
var initial_release := false
var gesture_button := 0
var pending_item_id := ""
var pending_mode := ""
var pending_port: WeakRef
var dispatching := false
var activation_complete := false

func _init(owner: Node) -> void:
	host = weakref(owner)
	process_mode = Node.PROCESS_MODE_ALWAYS

func _ready() -> void:
	window = get_window()
	focused = window.has_focus()
	window.focus_exited.connect(_on_focus_exited)
	window.focus_entered.connect(_on_focus_entered)
	overlay = CanvasLayer.new()
	overlay.name = "VientoMenuOverlay"
	overlay.layer = 129
	add_child(overlay)
	var center := CenterContainer.new()
	center.name = "MenuCenter"
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(center)
	menu_panel = PanelContainer.new()
	menu_panel.name = "MenuPanel"
	panel_style = StyleBoxFlat.new()
	panel_style.bg_color = Color("#101b2b")
	panel_style.border_color = Color("#52718f")
	panel_style.set_border_width_all(1)
	panel_style.set_corner_radius_all(10)
	menu_panel.add_theme_stylebox_override("panel", panel_style)
	center.add_child(menu_panel)
	menu_scroll = ScrollContainer.new()
	menu_scroll.name = "MenuScroll"
	menu_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	menu_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	menu_scroll.follow_focus = true
	menu_panel.add_child(menu_scroll)
	column = VBoxContainer.new()
	column.name = "MenuItems"
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_theme_constant_override("separation", 12)
	menu_scroll.add_child(column)
	title_label = Label.new()
	title_label.name = "MenuTitle"
	title_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	title_label.add_theme_font_size_override("font_size", 24)
	column.add_child(title_label)
	get_viewport().size_changed.connect(_layout_panel)
	_layout_panel()
	overlay.hide()

func _layout_panel() -> void:
	if menu_panel == null or menu_scroll == null:
		return
	var viewport_size: Vector2 = get_viewport().get_visible_rect().size
	var width := floorf(minf(560.0, maxf(1.0, viewport_size.x - 32.0)))
	var height := floorf(minf(440.0, maxf(1.0, viewport_size.y - 32.0)))
	var padding := floorf(minf(16.0, minf(width, height) / 6.0))
	panel_style.content_margin_left = padding
	panel_style.content_margin_right = padding
	panel_style.content_margin_top = padding
	panel_style.content_margin_bottom = padding
	menu_panel.custom_minimum_size = Vector2(width, height)
	menu_scroll.custom_minimum_size = Vector2(maxf(1.0, width - padding * 2.0), maxf(1.0, height - padding * 2.0))

func _cancel_gesture() -> void:
	armed = false
	initial_release = false
	gesture_button = 0
	pending_item_id = ""
	pending_mode = ""
	pending_port = null
	dispatching = false

func clear_configuration() -> void:
	_cancel_gesture()
	active_mode = ""
	active_port = null
	active_configuration = {}
	activation_complete = false
	for button in buttons:
		if is_instance_valid(button):
			button.release_focus()
			button.get_parent().remove_child(button)
			button.queue_free()
	buttons.clear()
	if overlay != null:
		overlay.hide()

func refresh() -> void:
	var owner = host.get_ref()
	var configuration = owner.menu_current_configuration() if owner != null else null
	if configuration == null:
		clear_configuration()
		_restore_pause_overlay()
		return
	var next_port = configuration["port"].get_ref()
	var next_mode: String = owner.menu_mode()
	if active_port != null and active_port.get_ref() == next_port and active_mode == next_mode:
		return
	clear_configuration()
	active_mode = next_mode
	active_port = weakref(next_port)
	active_configuration = configuration.duplicate(true)
	title_label.text = configuration["title"]
	for item in configuration["items"]:
		var button := Button.new()
		button.name = "MenuButton_" + item["id"]
		button.text = item["label"]
		button.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		button.custom_minimum_size = Vector2(0.0, 44.0)
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		button.focus_mode = Control.FOCUS_ALL
		button.action_mode = BaseButton.ACTION_MODE_BUTTON_RELEASE
		button.disabled = true
		button.set_meta("viento_menu_item_id", item["id"])
		button.set_meta("viento_menu_mode", active_mode)
		button.pressed.connect(_on_button_pressed.bind(button, item["id"], active_mode, active_port))
		column.add_child(button)
		buttons.push_back(button)
	for index in range(buttons.size()):
		var button: Button = buttons[index]
		button.focus_neighbor_top = button.get_path_to(buttons[posmod(index - 1, buttons.size())])
		button.focus_neighbor_bottom = button.get_path_to(buttons[(index + 1) % buttons.size()])
		button.focus_previous = button.focus_neighbor_top
		button.focus_next = button.focus_neighbor_bottom
	overlay.show()
	_restore_pause_overlay()

func _restore_pause_overlay() -> void:
	var owner = host.get_ref()
	if owner != null and owner.pause_input != null and owner.pause_input.overlay != null:
		owner.pause_input.overlay.visible = owner.pause_phase != "running" and not (overlay.visible and active_mode == "paused")

func focused_and_released() -> bool:
	if not focused:
		return false
	for action in InputMap.get_actions():
		if Input.is_action_pressed(action):
			return false
	for index in range(1, 10):
		if Input.is_mouse_button_pressed(index):
			return false
	return true

func owns_pending(port, item_id: String, mode: String) -> bool:
	return dispatching and pending_port != null and pending_port.get_ref() == port and pending_item_id == item_id and pending_mode == mode

func _set_buttons_enabled(value: bool) -> void:
	for button in buttons:
		button.disabled = not value

func _process(_delta: float) -> void:
	refresh()
	_restore_pause_overlay()
	var owner = host.get_ref()
	if owner == null or active_port == null or not overlay.visible or owner.failed or owner.finished:
		return
	if not focused:
		_set_buttons_enabled(false)
		return
	if not pending_item_id.is_empty():
		_set_buttons_enabled(false)
		if focused_and_released():
			dispatching = true
			var accepted: bool = owner.menu_dispatch(self, pending_port.get_ref(), pending_item_id, pending_mode)
			dispatching = false
			# Shutdown may clear the configuration inside the synchronous call.
			if active_port == null:
				return
			pending_item_id = ""
			pending_mode = ""
			pending_port = null
			gesture_button = 0
			armed = false
			initial_release = false
			activation_complete = accepted and owner.pause_phase == "running"
		return
	if owner.pause_phase == "waiting-for-release" or activation_complete:
		_set_buttons_enabled(false)
		return
	if focused_and_released():
		armed = true
		gesture_button = 0
		if not initial_release:
			initial_release = true
			_set_buttons_enabled(true)
			if not buttons.is_empty():
				buttons[0].grab_focus()

func _input(event: InputEvent) -> void:
	if not focused or not overlay.visible or not initial_release or not armed or not pending_item_id.is_empty() or activation_complete or event.is_echo():
		return
	var button: Control
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		button = get_viewport().gui_get_hovered_control()
	elif event is InputEventKey and event.pressed and not event.alt_pressed and not event.ctrl_pressed and not event.meta_pressed and event.is_action_pressed("ui_accept", false):
		button = get_viewport().gui_get_focus_owner()
	else:
		return
	armed = false
	if button != null and button in buttons and not button.disabled:
		gesture_button = button.get_instance_id()

func _on_button_pressed(button: Button, item_id: String, mode: String, port: WeakRef) -> void:
	if not focused or not overlay.visible or not initial_release or not pending_item_id.is_empty() or activation_complete or gesture_button != button.get_instance_id() or active_port == null or port.get_ref() != active_port.get_ref() or active_mode != mode:
		return
	gesture_button = 0
	pending_item_id = item_id
	pending_mode = mode
	pending_port = port
	_set_buttons_enabled(false)

func _on_focus_exited() -> void:
	focused = false
	_cancel_gesture()
	_set_buttons_enabled(false)

func _on_focus_entered() -> void:
	focused = true
	_cancel_gesture()
	_set_buttons_enabled(false)

func _exit_tree() -> void:
	clear_configuration()
	if is_instance_valid(window):
		if window.focus_exited.is_connected(_on_focus_exited):
			window.focus_exited.disconnect(_on_focus_exited)
		if window.focus_entered.is_connected(_on_focus_entered):
			window.focus_entered.disconnect(_on_focus_entered)
