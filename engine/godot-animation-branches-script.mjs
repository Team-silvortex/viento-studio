// Versioned adapter for explicit first-match event groups. Rust owns branch
// admission and indexing. A unique, unconditional legacy scaffold supplies the
// unchanged lifecycle; all author transitions are restored from validated IR.
import { inspectAnimationStateDeclaration } from './animation-state-conditions-core.mjs';
import { generateGodotAnimationStateScript } from './godot-animation-state-script.mjs';
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
function constant(condition) {
  const { type, operator, value } = condition;
  if (type === 'number') {
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true);
    return { type, operator, valueBytes: [...bytes] };
  }
  if (type === 'string') return { type, operator, valueBase64: base64(new TextEncoder().encode(value)) };
  return { type, operator, value };
}
const EVENT_FUNCTION = `func _on_event(value, event_name: String) -> bool:
\tif not _active or not _port_valid(_project):
\t\t_deactivate()
\t\treturn false
\tfor edge in _TRANSITIONS:
\t\tvar trigger: Dictionary = edge["trigger"]
\t\tif edge["fromIndex"] == _state and trigger["kind"] == "event" and trigger["name"] == event_name:
\t\t\tif trigger.has("condition") and not _condition_matches(value, trigger["condition"]):
\t\t\t\tcontinue
\t\t\treturn _enter_state(edge["toIndex"])
\treturn true

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
export function generateGodotAnimationBranchesScript(table) {
  const inspected = inspectAnimationStateDeclaration(table);
  if (inspected.table.eventSelection !== 'firstMatch') {
    throw Object.assign(new TypeError('A branching animation script requires explicit firstMatch event selection.'), { errorCode: 'animation_state_table_invalid' });
  }
  // Do not pass duplicate groups through the old unique-transition contract.
  // The scaffold supplies only state declarations, subscriptions and lifecycle.
  const groups = new Set();
  const transitionsForScaffold = inspected.table.transitions.filter(edge => {
    const key = JSON.stringify([edge.from, edge.trigger.kind, edge.trigger.name]);
    if (groups.has(key)) return false;
    groups.add(key); return true;
  }).map(edge => ({ from: edge.from, to: edge.to,
    trigger: edge.trigger.kind === 'event' ? { kind: 'event', name: edge.trigger.name } : { kind: 'completed' } }));
  const plain = { initialState: inspected.table.initialState, states: inspected.table.states, transitions: transitionsForScaffold };
  const legacy = generateGodotAnimationStateScript(plain);
  const transitions = inspected.transitions.map(edge => ({ ...edge, trigger: Object.hasOwn(edge.trigger, 'condition')
    ? { ...edge.trigger, condition: constant(edge.trigger.condition) } : edge.trigger }));
  const start = legacy.content.indexOf('func _on_event('), end = legacy.content.indexOf('func _on_completed(', start);
  const declaration = /^const _TRANSITIONS: Array = .*$/m;
  // Fail closed if the fixed emitter is ever reorganized. This is not a parser
  // for arbitrary GDScript or a recovery path for modified author code.
  if (start < 0 || end < start || !declaration.test(legacy.content)) throw new Error('The trusted legacy state emitter layout changed.');
  const content = (legacy.content.slice(0, start) + EVENT_FUNCTION + legacy.content.slice(end))
    .replace(declaration, 'const _TRANSITIONS: Array = ' + JSON.stringify(transitions));
  return freeze({ content, parameters: legacy.parameters });
}
