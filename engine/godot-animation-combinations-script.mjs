// Versioned adapter for one-level all/any event conditions. Rust owns bounded
// groups, leaf selectors and branch admission. The fixed v1 lifecycle retains
// the p9 observer contract; conditions resolve in declared order at delivery.
import { inspectAnimationStateDeclarationWithCombinations } from './animation-state-conditions-core.mjs';
import { DEFAULT_ANIMATION_STATE_TABLE, DEFAULT_GODOT_ANIMATION_STATE_SCRIPT } from './godot-animation-state-script.mjs';
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function base64(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const second = offset + 1 < bytes.length, third = offset + 2 < bytes.length;
    const bits = bytes[offset] * 65536 + (second ? bytes[offset + 1] * 256 : 0) + (third ? bytes[offset + 2] : 0);
    result += alphabet[(bits >>> 18) & 63] + alphabet[(bits >>> 12) & 63]
      + (second ? alphabet[(bits >>> 6) & 63] : '=') + (third ? alphabet[bits & 63] : '=');
  }
  return result;
}
function scalarConstant(condition) {
  const { type, operator, value } = condition;
  if (type === 'number') {
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true);
    return { type, operator, valueBytes: [...bytes] };
  }
  if (type === 'string') return { type, operator, valueBase64: base64(new TextEncoder().encode(value)) };
  return { type, operator, value };
}
function leafConstant(condition) {
  return { ...scalarConstant(condition), ...(Object.hasOwn(condition, 'selector') ? { selector: condition.selector } : {}) };
}
function constant(condition) {
  return Object.hasOwn(condition, 'combine')
    ? { combine: condition.combine, conditions: condition.conditions.map(leafConstant) } : leafConstant(condition);
}
const EVENT_FUNCTION = `func _on_event(value, event_name: String) -> bool:
\tif not _active or not _port_valid(_project):
\t\t_deactivate()
\t\treturn false
\tfor edge in _TRANSITIONS:
\t\tvar trigger: Dictionary = edge["trigger"]
\t\tif edge["fromIndex"] == _state and trigger["kind"] == "event" and trigger["name"] == event_name:
\t\t\tif trigger.has("condition") and not _trigger_condition_matches(value, trigger["condition"]):
\t\t\t\tcontinue
\t\t\treturn _enter_state(edge["toIndex"])
\treturn true

func _trigger_condition_matches(value, condition: Dictionary) -> bool:
\tif not condition.has("combine"):
\t\treturn _leaf_condition_matches(value, condition)
\tvar all_required: bool = condition["combine"] == "all"
\tfor leaf in condition["conditions"]:
\t\tvar matched: bool = _leaf_condition_matches(value, leaf)
\t\tif all_required and not matched:
\t\t\treturn false
\t\tif not all_required and matched:
\t\t\treturn true
\treturn all_required

func _leaf_condition_matches(value, condition: Dictionary) -> bool:
\tvar actual = value
\tif condition.has("selector"):
\t\t# Resolve only reached leaves, at event delivery rather than publication.
\t\tactual = _project.read_state(condition["selector"]["key"])
\treturn _condition_matches(actual, condition)

func _condition_matches(value, condition: Dictionary) -> bool:
\tvar kind: int = typeof(value)
\tvar operator: String = condition["operator"]
\tif condition["type"] == "number":
\t\tif kind != TYPE_INT and kind != TYPE_FLOAT:
\t\t\treturn false
\t\tvar actual: float = float(value)
\t\tif not is_finite(actual) or abs(actual) > 1000000000.0:
\t\t\treturn false
\t\tvar expected: float = PackedByteArray(condition["valueBytes"]).decode_double(0)
\t\tmatch operator:
\t\t\t"eq": return actual == expected
\t\t\t"ne": return actual != expected
\t\t\t"lt": return actual < expected
\t\t\t"lte": return actual <= expected
\t\t\t"gt": return actual > expected
\t\t\t"gte": return actual >= expected
\t\treturn false
\tif condition["type"] == "boolean":
\t\tif kind != TYPE_BOOL:
\t\t\treturn false
\t\treturn value == condition["value"] if operator == "eq" else value != condition["value"]
\tif condition["type"] == "string":
\t\tif kind != TYPE_STRING or value.to_utf8_buffer().size() > 4096:
\t\t\treturn false
\t\tfor index in range(value.length()):
\t\t\tvar code: int = value.unicode_at(index)
\t\t\tif code < 0 or code > 0x10ffff or (code >= 0xd800 and code <= 0xdfff):
\t\t\t\treturn false
\t\t# Compare UTF-8 bytes without decoding the declared text: Godot String
\t\t# decoding truncates embedded NUL, which must never match its prefix.
\t\tvar encoded: String = "" if value.is_empty() else Marshalls.raw_to_base64(value.to_utf8_buffer())
\t\treturn encoded == condition["valueBase64"] if operator == "eq" else encoded != condition["valueBase64"]
\treturn false

`;
export function generateGodotAnimationCombinationsScript(table) {
  const inspected = inspectAnimationStateDeclarationWithCombinations(table);
  if (!inspected.table.transitions.some(edge => Object.hasOwn(edge.trigger.condition || {}, 'combine'))) {
    throw Object.assign(new TypeError('A combined animation script requires at least one all/any group.'), { errorCode: 'animation_state_table_invalid' });
  }
  // Use the fixed static lifecycle without dispatching an older capability.
  // Combined admission is complete and works with only the new Rust marker.
  const parameters = inspected.states.map(({ key }) => ({ stateKey: key, name: `clip_${key}`, defaultValue: '' }));
  const defaults = DEFAULT_ANIMATION_STATE_TABLE.states.map(({ key }) => `clip_${key}`);
  const exports = defaults.map(name => `@export var ${name}: String = ""`).join('\n');
  const clipLoop = `for value in [${defaults.join(', ')}]:`;
  const initial = /^const _INITIAL_STATE: int = .*$/m, events = /^const _EVENT_NAMES: Array = .*$/m;
  const scaffold = DEFAULT_GODOT_ANIMATION_STATE_SCRIPT;
  if (!scaffold.includes(exports) || !scaffold.includes(clipLoop) || !initial.test(scaffold) || !events.test(scaffold)) {
    throw new Error('The trusted static state emitter layout changed.');
  }
  const content = scaffold.replace(exports, parameters.map(row => `@export var ${row.name}: String = ""`).join('\n'))
    .replace(clipLoop, `for value in [${parameters.map(row => row.name).join(', ')}]:`)
    .replace(initial, 'const _INITIAL_STATE: int = ' + inspected.initialIndex)
    .replace(events, 'const _EVENT_NAMES: Array = ' + JSON.stringify(inspected.eventNames));
  const transitions = inspected.transitions.map(edge => ({ ...edge, trigger: Object.hasOwn(edge.trigger, 'condition')
    ? { ...edge.trigger, condition: constant(edge.trigger.condition) } : edge.trigger }));
  const needsState = inspected.transitions.some(edge => {
    const condition = edge.trigger.condition;
    return condition && (Object.hasOwn(condition, 'selector') || condition.conditions?.some(leaf => Object.hasOwn(leaf, 'selector')));
  });
  const start = content.indexOf('func _on_event('), end = content.indexOf('func _on_completed(', start);
  const declaration = /^const _TRANSITIONS: Array = .*$/m;
  const methods = '["subscribe_event", "unsubscribe_event", "subscribe_animation_completed", "unsubscribe_animation_completed", "select_animation_clip", "play_animation"]';
  // Fail closed if the fixed emitter is ever reorganized. This is not a parser
  // for arbitrary GDScript or a recovery path for modified author code.
  if (start < 0 || end < start || !declaration.test(content) || !content.includes(methods)) throw new Error('The trusted legacy state emitter layout changed.');
  const generated = (content.slice(0, start) + EVENT_FUNCTION + content.slice(end))
    .replace(declaration, 'const _TRANSITIONS: Array = ' + JSON.stringify(transitions))
    .replace(methods, needsState ? methods.slice(0, -1) + ', "read_state"]' : methods);
  return freeze({ content: generated, parameters });
}
