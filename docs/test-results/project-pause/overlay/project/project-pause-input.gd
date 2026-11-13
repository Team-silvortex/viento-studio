extends Node

# This is the only always-running subtree. Author behavior instances stay under
# their scene actors; this node owns input edges and the basic pause overlay.
var host: WeakRef
var configured_port: WeakRef
var action_name := ""
var paused_text := "Paused"
var resume_text := "Release controls to resume"
var window: Window
var focused := false
var armed := false
var candidate_event_id := 0
var focus_pause_pending := false
var overlay: CanvasLayer
var title_label: Label
var help_label: Label
var pause_panel: PanelContainer
var pause_scroll: ScrollContainer
var panel_style: StyleBoxFlat

func _init(owner: Node) -> void:
	host = weakref(owner)
	process_mode = Node.PROCESS_MODE_ALWAYS

func _ready() -> void:
	window = get_window()
	focused = window.has_focus()
	window.focus_exited.connect(_on_focus_exited)
	window.focus_entered.connect(_on_focus_entered)
	overlay = CanvasLayer.new()
	overlay.name = "VientoPauseOverlay"
	overlay.layer = 128
	add_child(overlay)
	var center := CenterContainer.new()
	center.name = "PauseCenter"
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(center)
	pause_panel = PanelContainer.new()
	pause_panel.name = "PausePanel"
	panel_style = StyleBoxFlat.new()
	panel_style.bg_color = Color("#101b2b")
	panel_style.border_color = Color("#52718f")
	panel_style.set_border_width_all(1)
	panel_style.set_corner_radius_all(10)
	pause_panel.add_theme_stylebox_override("panel", panel_style)
	center.add_child(pause_panel)
	pause_scroll = ScrollContainer.new()
	pause_scroll.name = "PauseTextScroll"
	pause_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	pause_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	pause_scroll.focus_mode = Control.FOCUS_ALL
	pause_scroll.follow_focus = true
	pause_panel.add_child(pause_scroll)
	var column := VBoxContainer.new()
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_theme_constant_override("separation", 12)
	pause_scroll.add_child(column)
	title_label = Label.new()
	title_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	title_label.add_theme_font_size_override("font_size", 24)
	column.add_child(title_label)
	help_label = Label.new()
	help_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	help_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	column.add_child(help_label)
	get_viewport().size_changed.connect(_layout_panel)
	_layout_panel()
	show_phase("running")

func _layout_panel() -> void:
	if pause_panel == null or pause_scroll == null:
		return
	var viewport_size: Vector2 = get_viewport().get_visible_rect().size
	var width := floorf(minf(560.0, maxf(1.0, viewport_size.x - 32.0)))
	var height := floorf(minf(240.0, maxf(1.0, viewport_size.y - 32.0)))
	var padding := floorf(minf(16.0, minf(width, height) / 6.0))
	panel_style.content_margin_left = padding
	panel_style.content_margin_right = padding
	panel_style.content_margin_top = padding
	panel_style.content_margin_bottom = padding
	pause_panel.custom_minimum_size = Vector2(width, height)
	pause_scroll.custom_minimum_size = Vector2(maxf(1.0, width - padding * 2.0), maxf(1.0, height - padding * 2.0))

func configure(port, next_action: String, next_paused_text: String, next_resume_text: String) -> bool:
	if configured_port != null and configured_port.get_ref() != null:
		return configured_port.get_ref() == port and action_name == next_action and paused_text == next_paused_text and resume_text == next_resume_text
	configured_port = weakref(port)
	action_name = next_action
	paused_text = next_paused_text
	resume_text = next_resume_text
	armed = focused and not Input.is_action_pressed(action_name)
	candidate_event_id = 0
	return true

func clear_configuration() -> void:
	configured_port = null
	action_name = ""
	armed = false
	candidate_event_id = 0
	show_phase("running")

func show_phase(phase: String) -> void:
	if overlay == null:
		return
	overlay.visible = phase != "running"
	title_label.text = paused_text
	help_label.text = resume_text if phase == "waiting-for-release" else action_name.to_upper()

func configured() -> bool:
	var owner = host.get_ref()
	return owner != null and configured_port != null and configured_port.get_ref() != null and owner.pause_port_valid(configured_port.get_ref())

func focused_and_released() -> bool:
	if not focused:
		return false
	for action in InputMap.get_actions():
		if Input.is_action_pressed(action):
			return false
	return true

func _process(_delta: float) -> void:
	candidate_event_id = 0
	var owner = host.get_ref()
	if owner == null or owner.failed or owner.finished:
		return
	if focus_pause_pending and configured():
		if owner.pause_phase != "running" or owner.pause_request(configured_port.get_ref(), true):
			focus_pause_pending = false
	if owner.pause_phase == "waiting-for-release":
		if not focused:
			owner.pause_cancel_resume()
		elif focused_and_released():
			owner.pause_resume_released()
	if configured():
		armed = focused and not Input.is_action_pressed(action_name)

func _input(event: InputEvent) -> void:
	candidate_event_id = 0
	if not configured() or not focused or event.is_echo():
		return
	if event.is_action_released(action_name):
		armed = not Input.is_action_pressed(action_name)
	elif event.is_action_pressed(action_name, false):
		# Remember the edge before GUI dispatch. Even a consumed press disarms it.
		if armed:
			candidate_event_id = event.get_instance_id()
		armed = false

func _unhandled_input(event: InputEvent) -> void:
	var owner = host.get_ref()
	if owner == null or not focused or event.is_echo():
		return
	# The inherited coordinator does not process during pause, but Escape must
	# still finish the same session without temporarily unpausing gameplay.
	if owner.pause_phase != "running" and event.is_action_pressed("ui_cancel", false):
		get_viewport().set_input_as_handled()
		owner.finish_project()
		return
	if not configured() or event.get_instance_id() != candidate_event_id or not event.is_action_pressed(action_name, false):
		return
	candidate_event_id = 0
	var wants_pause: bool = owner.pause_phase == "running"
	if owner.pause_request(configured_port.get_ref(), wants_pause):
		get_viewport().set_input_as_handled()

func _on_focus_exited() -> void:
	focused = false
	armed = false
	candidate_event_id = 0
	var owner = host.get_ref()
	if owner == null:
		return
	if owner.pause_phase == "waiting-for-release":
		owner.pause_cancel_resume()
	focus_pause_pending = owner.pause_phase == "running" and configured()
	if focus_pause_pending and owner.pause_request(configured_port.get_ref(), true):
		focus_pause_pending = false

func _on_focus_entered() -> void:
	focused = true
	armed = false
	candidate_event_id = 0
	# Focus restoration never resumes the game or replays a held input edge.

func _exit_tree() -> void:
	if is_instance_valid(window):
		if window.focus_exited.is_connected(_on_focus_exited):
			window.focus_exited.disconnect(_on_focus_exited)
		if window.focus_entered.is_connected(_on_focus_entered):
			window.focus_entered.disconnect(_on_focus_entered)
