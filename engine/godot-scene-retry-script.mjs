import { GODOT_ACTION_SCENE_SWITCH_SCRIPT } from './godot-scene-navigation-scripts.mjs';
// Retry reuses the established input/focus state machine. These are exact
// source substitutions into an ordinary author draft, not a runtime wrapper.
const replaceOnce = (source, before, after) => {
  if (source.split(before).length !== 2) throw new Error('The action navigation source changed; review the retry author source.');
  return source.replace(before, after);
};
let source = GODOT_ACTION_SCENE_SWITCH_SCRIPT.replaceAll('viento_project', 'viento_project_retry').replaceAll('request_scene', 'request_retry');
source = replaceOnce(source, '@export var target_scene_id: String = ""\n', '@export var target_scene_id: String = ""\n@export var state_values_json: String = \'{"score":0,"health":100}\'\nvar _initial_values: Dictionary = {}\n');
source = replaceOnce(source, 'func _ready() -> void:\n\t_deactivate()\n', 'func _ready() -> void:\n\t_deactivate()\n\tvar values = _parse_initial_values(state_values_json)\n\tif values == null:\n\t\t_fail("Use a strict JSON object with at most 16 bounded scalar defaults and 4096 UTF-8 bytes.")\n\t\treturn\n\t_initial_values = values\n');
source = replaceOnce(source, '_project.request_retry(target_scene_id)', '_project.request_retry(target_scene_id, _initial_values)');
source = source.replace('Input scene navigation: ', 'Level retry: ');
// Godot JSON deliberately permits some non-JSON syntax. Parse this small flat
// scalar object explicitly so BOM, duplicate decoded keys, trailing commas,
// invalid escapes/surrogates, nested values and numbers match author preflight.
const parser = `
func _json_space(text: String, offset: int) -> int:
	while offset < text.length() and text.unicode_at(offset) in [9, 10, 13, 32]:
		offset += 1
	return offset

func _json_hex(text: String, offset: int) -> int:
	if offset + 4 > text.length():
		return -1
	for index in range(offset, offset + 4):
		var code := text.unicode_at(index)
		if not ((code >= 48 and code <= 57) or (code >= 65 and code <= 70) or (code >= 97 and code <= 102)):
			return -1
	return text.substr(offset, 4).hex_to_int()

func _json_string(text: String, offset: int) -> Variant:
	if offset >= text.length() or text.unicode_at(offset) != 34:
		return null
	var start := offset
	offset += 1
	while offset < text.length():
		var code := text.unicode_at(offset)
		if code == 34:
			var parsed := JSON.new()
			if parsed.parse(text.substr(start, offset - start + 1)) != OK or typeof(parsed.data) != TYPE_STRING:
				return null
			return [parsed.data, offset + 1]
		if code < 32 or (code >= 0xd800 and code <= 0xdfff):
			return null
		if code != 92:
			offset += 1
			continue
		if offset + 1 >= text.length():
			return null
		var escape := text.unicode_at(offset + 1)
		if escape in [34, 92, 47, 98, 102, 110, 114, 116]:
			offset += 2
			continue
		if escape != 117:
			return null
		var escaped := _json_hex(text, offset + 2)
		if escaped < 0 or (escaped >= 0xdc00 and escaped <= 0xdfff):
			return null
		if escaped >= 0xd800 and escaped <= 0xdbff:
			if offset + 12 > text.length() or text.unicode_at(offset + 6) != 92 or text.unicode_at(offset + 7) != 117:
				return null
			var low := _json_hex(text, offset + 8)
			if low < 0xdc00 or low > 0xdfff:
				return null
			offset += 12
		else:
			offset += 6
	return null

func _initial_key_valid(key: String) -> bool:
	var pattern := RegEx.new()
	pattern.compile("^[A-Za-z][A-Za-z0-9_.-]{0,63}$")
	var matched = pattern.search(key)
	return key.length() <= 64 and not key in ["constructor", "prototype", "__proto__"] and matched != null and matched.get_string() == key

func _parse_initial_values(text: String) -> Variant:
	if text.to_utf8_buffer().size() > 4096:
		return null
	var offset := _json_space(text, 0)
	if offset >= text.length() or text.unicode_at(offset) != 123:
		return null
	offset = _json_space(text, offset + 1)
	var values: Dictionary = {}
	if offset < text.length() and text.unicode_at(offset) == 125:
		return values if _json_space(text, offset + 1) == text.length() else null
	var numbers := RegEx.new()
	numbers.compile("^-?(?:0|[1-9][0-9]*)(?:\\\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")
	while offset < text.length():
		var key = _json_string(text, offset)
		if key == null or not _initial_key_valid(key[0]) or values.has(key[0]) or values.size() >= 16:
			return null
		offset = _json_space(text, key[1])
		if offset >= text.length() or text.unicode_at(offset) != 58:
			return null
		offset = _json_space(text, offset + 1)
		if offset >= text.length():
			return null
		var value
		if text.unicode_at(offset) == 34:
			var token = _json_string(text, offset)
			if token == null:
				return null
			value = token[0]
			offset = token[1]
		elif text.substr(offset, 4) == "true":
			value = true
			offset += 4
		elif text.substr(offset, 5) == "false":
			value = false
			offset += 5
		else:
			var matched = numbers.search(text.substr(offset))
			if matched == null:
				return null
			var number := JSON.new()
			if number.parse(matched.get_string()) != OK:
				return null
			value = number.data
			if not (typeof(value) in [TYPE_INT, TYPE_FLOAT]) or not is_finite(float(value)) or abs(float(value)) > 1000000000.0:
				return null
			offset += matched.get_string().length()
		values[key[0]] = value
		offset = _json_space(text, offset)
		if offset >= text.length():
			return null
		if text.unicode_at(offset) == 125:
			return values if _json_space(text, offset + 1) == text.length() else null
		if text.unicode_at(offset) != 44:
			return null
		offset = _json_space(text, offset + 1)
	return null
`;
export const GODOT_ACTION_SCENE_RETRY_SCRIPT = source + parser;
