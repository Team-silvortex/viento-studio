extends CanvasLayer

# Pure presentation of bounded shared scalars; no behavior port, mutation,
# elapsed-time, actor movement or runtime-event authority is introduced here.
@export var hud_document := ""
var rows: Array[Dictionary] = []
var last_state_revision := -1
var last_viewport := Vector2.ZERO
var host_reference: WeakRef
var scene_visit := 0

func hud_fail() -> void:
	var scene := get_parent()
	if scene != null and scene.has_method("emit"):
		scene.emit("diagnostic", {"severity": "error", "code": "runtime_hud2d_invalid", "message": "Generated HUD2D declaration or current project visit is unavailable."})
	get_tree().quit(1)

func _ready() -> void:
	follow_viewport_enabled = false
	layer = 1
	process_priority = 1000
	var scene := get_parent()
	var host = scene.get("project_host")
	if host == null or host.get("current") != scene:
		hud_fail()
		return
	host_reference = weakref(host)
	scene_visit = scene.get("project_visit")
	var file := FileAccess.open(hud_document, FileAccess.READ)
	if file == null or file.get_length() > 65536:
		hud_fail()
		return
	var document = JSON.parse_string(file.get_as_text())
	if not document is Dictionary or document.get("format") != "viento-scene-hud2d" or document.get("schemaVersion") != 1 or document.get("sceneObjectId") != host.get("current_scene") or not document.get("elements") is Array or document["elements"].size() > 32:
		hud_fail()
		return
	for declaration in document["elements"]:
		if not declaration is Dictionary or not declaration.get("kind") in ["label", "bar"]:
			hud_fail()
			return
		var node: Control
		var fill: ColorRect
		var label: Label
		if declaration["kind"] == "label":
			label = Label.new()
			label.name = "Text"
			label.clip_text = true
			label.add_theme_font_size_override("font_size", int(declaration["fontSize"]))
			label.add_theme_color_override("font_color", Color(declaration["color"]))
			label.mouse_filter = Control.MOUSE_FILTER_IGNORE
			label.focus_mode = Control.FOCUS_NONE
			node = Control.new()
			node.add_child(label)
		else:
			var background := ColorRect.new()
			background.color = Color(declaration["backgroundColor"])
			fill = ColorRect.new()
			fill.name = "Fill"
			fill.color = Color(declaration["fillColor"])
			fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
			fill.focus_mode = Control.FOCUS_NONE
			background.add_child(fill)
			node = background
		node.name = "hud_" + declaration["id"].replace("-", "_")
		node.mouse_filter = Control.MOUSE_FILTER_IGNORE
		node.focus_mode = Control.FOCUS_NONE
		node.clip_contents = true
		add_child(node)
		rows.append({"declaration": declaration, "node": node, "fill": fill, "label": label})
	refresh_hud()
	# A bounded smoke capture freezes scene callbacks after its final logical
	# step. Refresh on the render boundary too, without advancing that step or
	# granting a stale visit access to the next scene's shared state.
	RenderingServer.frame_pre_draw.connect(refresh_hud)

func _exit_tree() -> void:
	if RenderingServer.frame_pre_draw.is_connected(refresh_hud):
		RenderingServer.frame_pre_draw.disconnect(refresh_hud)

func _notification(what: int) -> void:
	# The historical smoke freezes the complete scene before its one render.
	# Updating Control geometry in frame_pre_draw alone queues a redraw too late
	# for that same frame. Resolve the final state synchronously at the freeze.
	if what == NOTIFICATION_DISABLED:
		refresh_hud()

func _process(_delta: float) -> void:
	refresh_hud()

func anchor_fraction(anchor: String) -> Vector2:
	var parts := anchor.split("-")
	var horizontal := 0.5
	var vertical := 0.5
	if anchor != "center":
		vertical = 0.0 if parts[0] == "top" else 1.0 if parts[0] == "bottom" else 0.5
		horizontal = 0.0 if parts[1] == "left" else 1.0 if parts[1] == "right" else 0.5
	return Vector2(horizontal, vertical)

func display_number(value) -> String:
	var number := float(value)
	var rounded := int(floor(abs(number) * 1000.0 + 0.5))
	var whole := int(float(rounded) / 1000.0)
	var fraction := rounded % 1000
	var result := str(whole)
	if fraction != 0:
		var tail := "%03d" % fraction
		while tail.ends_with("0"):
			tail = tail.left(tail.length() - 1)
		result += "." + tail
	return "-" + result if number < 0.0 and rounded != 0 else result

func display_string(value: String) -> String:
	var result := ""
	for index in range(value.length()):
		var code := value.unicode_at(index)
		result += String.chr(0xfffd) if (code < 32 and not code in [9, 10, 13]) or code == 127 else String.chr(code)
	return result

func label_text(content: Dictionary, state: Dictionary) -> String:
	var result: String
	if content["kind"] == "literal":
		result = content["text"]
	elif not state.has(content["key"]):
		result = content["prefix"] + content["missing"] + content["suffix"]
	else:
		var value = state[content["key"]]
		var shown := ""
		if typeof(value) == TYPE_BOOL:
			shown = "true" if value else "false"
		elif typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT:
			shown = display_number(value)
		elif typeof(value) == TYPE_STRING:
			shown = display_string(value)
		else:
			return content["missing"]
		result = content["prefix"] + shown + content["suffix"]
	return result.left(256) + "…" if result.length() > 256 else result

func refresh_hud() -> void:
	var host = host_reference.get_ref() if host_reference != null else null
	if host == null or host.get("current") != get_parent() or host.get("visit_index") != scene_visit:
		return
	var viewport := get_viewport().get_visible_rect().size
	var revision: int = host.get("state_revision")
	if revision == last_state_revision and viewport == last_viewport:
		return
	var state: Dictionary = host.get("shared_state")
	for row in rows:
		var declaration: Dictionary = row["declaration"]
		var node: Control = row["node"]
		var size_value := Vector2(declaration["size"][0], declaration["size"][1])
		var anchor := anchor_fraction(declaration["anchor"])
		node.position = anchor * viewport + Vector2(declaration["offset"][0], declaration["offset"][1]) - anchor * size_value
		node.size = size_value
		if declaration["kind"] == "label":
			row["label"].size = size_value
			row["label"].text = label_text(declaration["content"], state)
		else:
			var value = state.get(declaration["key"])
			if not (typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT):
				value = declaration["fallback"]
			var ratio := clampf((float(value) - float(declaration["min"])) / (float(declaration["max"]) - float(declaration["min"])), 0.0, 1.0)
			row["fill"].size = Vector2(size_value.x * ratio, size_value.y)
	last_state_revision = revision
	last_viewport = viewport
