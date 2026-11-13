extends "res://project-pause-runtime.gd"

# Author nodes retain ordinary processing and only configure bounded commands.
# This separate visit-bound port never exposes a callable or an activation API.
class MenuPort extends RefCounted:
	var host: WeakRef
	func _init(owner: Node) -> void:
		host = weakref(owner)
	func configure(title: String, items_json: String, display_mode: String) -> bool:
		var owner = host.get_ref()
		return owner != null and owner.menu_configure(self, title, items_json, display_mode)

var menu_ports: Dictionary = {}
var menu_controllers: Dictionary = {}
var menu_input: Node

func _ready() -> void:
	menu_input = preload("res://project-menu-input.gd").new(self)
	menu_input.name = "VientoMenuInput"
	add_child(menu_input)
	super._ready()

func make_port(visit: int, binding: Dictionary, instance: Node) -> RefCounted:
	var original = super.make_port(visit, binding, instance)
	var port := MenuPort.new(self)
	menu_ports[port.get_instance_id()] = {"port": weakref(port), "visit": visit, "binding": binding.duplicate(true), "behavior": weakref(instance),
		"scene": original, "retry": instance.get_meta("viento_project_retry"), "restart": instance.get_meta("viento_project_restart"), "pause": instance.get_meta("viento_project_pause")}
	instance.set_meta("viento_project_menu", port)
	return original

func menu_port_valid(port) -> bool:
	if not is_instance_valid(port):
		return false
	var record = menu_ports.get(port.get_instance_id())
	return record != null and record["port"].get_ref() == port and pause_port_valid(record["pause"])

func menu_id_valid(value) -> bool:
	if typeof(value) != TYPE_STRING or value.length() < 1 or value.length() > 48:
		return false
	for index in range(value.length()):
		var code: int = value.unicode_at(index)
		if not (code >= 97 and code <= 122) and (index == 0 or not (code >= 48 and code <= 57 or code == 95)):
			return false
	return true

func menu_uuid_valid(value) -> bool:
	if typeof(value) != TYPE_STRING or value.length() != 36:
		return false
	for index in range(36):
		var code: int = value.unicode_at(index)
		if index in [8, 13, 18, 23]:
			if code != 45:
				return false
		elif not (code >= 48 and code <= 57 or code >= 97 and code <= 102):
			return false
	return true

# Godot's JSON parser is intentionally permissive. Validate the strict JSON
# grammar and decoded duplicate object keys before accepting its parsed value.
# New menu text is control-free, including scalar state strings. Reject escapes
# before parsing so Godot cannot silently repair NUL or emit its non-JSON \v.
func menu_json_space(scan: Dictionary) -> void:
	while scan.position < scan.text.length() and scan.text.unicode_at(scan.position) in [9, 10, 13, 32]:
		scan.position += 1

func menu_json_hex(value: String) -> bool:
	if value.length() != 4:
		return false
	for index in range(4):
		var code := value.unicode_at(index)
		if not (code >= 48 and code <= 57 or code >= 65 and code <= 70 or code >= 97 and code <= 102):
			return false
	return true

func menu_json_string(scan: Dictionary) -> String:
	var start: int = scan.position
	scan.position += 1
	while scan.position < scan.text.length():
		var code: int = scan.text.unicode_at(scan.position)
		scan.position += 1
		if code == 34:
			return scan.text.substr(start, scan.position - start)
		if code < 32 or code >= 127 and code <= 159 or code >= 0xd800 and code <= 0xdfff:
			return ""
		if code == 92:
			if scan.position >= scan.text.length():
				return ""
			var escape: int = scan.text.unicode_at(scan.position)
			scan.position += 1
			if escape in [34, 47, 92]:
				continue
			if escape != 117 or scan.position + 4 > scan.text.length():
				return ""
			var hex: String = scan.text.substr(scan.position, 4)
			if not menu_json_hex(hex):
				return ""
			var scalar: int = hex.hex_to_int()
			if scalar < 32 or scalar >= 127 and scalar <= 159:
				return ""
			scan.position += 4
			if scalar >= 0xd800 and scalar <= 0xdbff:
				if scan.text.substr(scan.position, 2) != "\\u" or scan.position + 6 > scan.text.length():
					return ""
				var low: String = scan.text.substr(scan.position + 2, 4)
				if not menu_json_hex(low) or low.hex_to_int() < 0xdc00 or low.hex_to_int() > 0xdfff:
					return ""
				scan.position += 6
			elif scalar >= 0xdc00 and scalar <= 0xdfff:
				return ""
	return ""

func menu_json_value(scan: Dictionary, depth: int = 0) -> bool:
	menu_json_space(scan)
	if depth > 4 or scan.position >= scan.text.length():
		return false
	var code: int = scan.text.unicode_at(scan.position)
	if code == 34:
		return not menu_json_string(scan).is_empty()
	if code == 91 or code == 123:
		scan.position += 1
		menu_json_space(scan)
		var end := 93 if code == 91 else 125
		if scan.position < scan.text.length() and scan.text.unicode_at(scan.position) == end:
			scan.position += 1
			return true
		var keys: Dictionary = {}
		while scan.position < scan.text.length():
			if code == 123:
				if scan.text.unicode_at(scan.position) != 34:
					return false
				var token := menu_json_string(scan)
				if token.is_empty():
					return false
				var key = JSON.parse_string(token)
				if typeof(key) != TYPE_STRING or keys.has(key):
					return false
				keys[key] = true
				menu_json_space(scan)
				if scan.position >= scan.text.length() or scan.text.unicode_at(scan.position) != 58:
					return false
				scan.position += 1
			if not menu_json_value(scan, depth + 1):
				return false
			menu_json_space(scan)
			if scan.position >= scan.text.length():
				return false
			var separator: int = scan.text.unicode_at(scan.position)
			scan.position += 1
			if separator == end:
				return true
			if separator != 44:
				return false
			menu_json_space(scan)
		return false
	for literal in ["true", "false", "null"]:
		if scan.text.substr(scan.position, literal.length()) == literal:
			scan.position += literal.length()
			return true
	var start: int = scan.position
	if code == 45:
		scan.position += 1
	if scan.position >= scan.text.length():
		return false
	code = scan.text.unicode_at(scan.position)
	if code == 48:
		scan.position += 1
	elif code >= 49 and code <= 57:
		while scan.position < scan.text.length() and scan.text.unicode_at(scan.position) >= 48 and scan.text.unicode_at(scan.position) <= 57:
			scan.position += 1
	else:
		return false
	if scan.position < scan.text.length() and scan.text.unicode_at(scan.position) == 46:
		scan.position += 1
		var fraction: int = scan.position
		while scan.position < scan.text.length() and scan.text.unicode_at(scan.position) >= 48 and scan.text.unicode_at(scan.position) <= 57:
			scan.position += 1
		if scan.position == fraction:
			return false
	if scan.position < scan.text.length() and scan.text.unicode_at(scan.position) in [69, 101]:
		scan.position += 1
		if scan.position < scan.text.length() and scan.text.unicode_at(scan.position) in [43, 45]:
			scan.position += 1
		var exponent: int = scan.position
		while scan.position < scan.text.length() and scan.text.unicode_at(scan.position) >= 48 and scan.text.unicode_at(scan.position) <= 57:
			scan.position += 1
		if scan.position == exponent:
			return false
	if scan.position <= start:
		return false
	var token: String = scan.text.substr(start, scan.position - start)
	var mantissa := token.get_slice("e", 0).get_slice("E", 0)
	var nonzero := false
	for digit in mantissa:
		if digit in "123456789":
			nonzero = true
			break
	if nonzero:
		# godot-number-underflow: the portable Double can be valid while this
		# backend parser silently returns zero. Refuse before configuration/state
		# writes rather than repairing or erasing the author's numeric meaning.
		return token.to_float() != 0.0
	# The shared-state contract already normalizes signed zero. Parse all-zero
	# mantissas as zero, even when Godot would produce NaN for a huge exponent.
	scan.zero_numbers.push_back({"start": start, "length": token.length()})
	return true

func menu_parse(items_json: String, display_mode: String) -> Variant:
	if items_json.to_utf8_buffer().size() > 8192:
		return null
	var scan := {"text": items_json, "position": 0, "zero_numbers": []}
	if not menu_json_value(scan):
		return null
	menu_json_space(scan)
	if scan.position != items_json.length():
		return null
	var parsed_text := items_json
	for index in range(scan.zero_numbers.size() - 1, -1, -1):
		var span: Dictionary = scan.zero_numbers[index]
		parsed_text = parsed_text.substr(0, span["start"]) + "0" + parsed_text.substr(span["start"] + span["length"])
	var items = JSON.parse_string(parsed_text)
	if not items is Array or items.size() < 1 or items.size() > 8:
		return null
	var ids: Dictionary = {}
	for item in items:
		if not item is Dictionary or not menu_id_valid(item.get("id")) or ids.has(item["id"]) or typeof(item.get("label")) != TYPE_STRING or not pause_text_valid(item["label"]):
			return null
		ids[item["id"]] = true
		var command = item.get("command")
		if typeof(command) != TYPE_STRING or not command in (["scene", "retry", "restart", "finish"] if display_mode == "scene" else ["resume", "finish"]):
			return null
		var fields := ["id", "label", "command"]
		if command in ["scene", "retry"]:
			var target = item.get("targetSceneId")
			if not menu_uuid_valid(target) or not members.has(target) or target == current_scene:
				return null
			fields.push_back("targetSceneId")
		if command in ["retry", "restart"] and item.has("values"):
			var values = item["values"]
			if not values is Dictionary or values.size() > 16:
				return null
			var bytes := 0
			for key in values:
				var value_bytes := state_value_bytes(values[key])
				if not state_key_valid(key) or value_bytes < 0:
					return null
				bytes += key.length() + value_bytes
			if bytes > 4096:
				return null
			fields.push_back("values")
		if item.size() != fields.size():
			return null
		for key in item:
			if not key in fields:
				return null
	return items.duplicate(true)

func menu_configure(port, title: String, items_json: String, display_mode: String) -> bool:
	if not menu_port_valid(port) or not pause_text_valid(title) or not display_mode in ["scene", "paused"]:
		return false
	var record: Dictionary = menu_ports[port.get_instance_id()]
	if record.has("configuration"):
		var prior: Dictionary = record["configuration"]
		return prior["title"] == title and prior["items_json"] == items_json and prior["display_mode"] == display_mode
	var existing = menu_controllers.get(display_mode)
	if existing != null:
		return existing["port"].get_ref() == port and existing["title"] == title and existing["items_json"] == items_json
	if pause_phase != "running":
		return false
	var items = menu_parse(items_json, display_mode)
	if items == null:
		return false
	record["configuration"] = {"title": title, "items_json": items_json, "display_mode": display_mode}
	menu_controllers[display_mode] = {"port": weakref(port), "title": title, "items_json": items_json, "items": items}
	if menu_input != null:
		menu_input.refresh()
	return true

func menu_mode() -> String:
	return "scene" if pause_phase == "running" else "paused"

func menu_current_configuration() -> Variant:
	var configuration = menu_controllers.get(menu_mode())
	return configuration if configuration != null and menu_port_valid(configuration["port"].get_ref()) else null

func menu_dispatch(controller: Node, port, item_id: String, display_mode: String) -> bool:
	if controller != menu_input or not controller.dispatching or not controller.owns_pending(port, item_id, display_mode) or not menu_port_valid(port) or menu_mode() != display_mode:
		return false
	var configuration = menu_controllers.get(display_mode)
	if configuration == null or configuration["port"].get_ref() != port or not controller.focused_and_released() or not pause_safe_point():
		return false
	var selected: Dictionary = {}
	for item in configuration["items"]:
		if item["id"] == item_id:
			selected = item
			break
	if selected.is_empty():
		return false
	var record: Dictionary = menu_ports[port.get_instance_id()]
	var command: String = selected["command"]
	if command == "resume":
		return pause_phase == "paused" and record["pause"].request_pause(false)
	if command == "finish":
		finish_project()
		return true
	if display_mode != "scene" or pause_phase != "running" or visit_index >= 64:
		return false
	if command == "scene":
		return record["scene"].request_scene(selected["targetSceneId"])
	if command == "retry":
		return record["retry"].request_retry(selected["targetSceneId"], selected.get("values", {}))
	if command == "restart":
		return record["restart"].request_restart(selected.get("values", {}))
	return false

func menu_clear_visit() -> void:
	menu_ports.clear()
	menu_controllers.clear()
	if menu_input != null:
		menu_input.clear_configuration()

func leave_scene(reason: String, next_scene: String = "") -> void:
	accepting = false
	menu_clear_visit()
	super.leave_scene(reason, next_scene)

func abort_project() -> void:
	accepting = false
	menu_clear_visit()
	super.abort_project()

func _exit_tree() -> void:
	accepting = false
	menu_clear_visit()
	super._exit_tree()
