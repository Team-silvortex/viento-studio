// Author-source envelope only. A marker is not authority to replace a script:
// reopening requires exact regeneration by this version's fixed body emitter.
import { parseJsonSource } from './json-source.mjs';
import { inspectAnimationStateTable } from './animation-state-table-core.mjs';
import { inspectAnimationStateDeclaration } from './animation-state-conditions-core.mjs';
import { generateGodotAnimationStateConditionsScript } from './godot-animation-state-conditions-script.mjs';
import { generateGodotAnimationStateScript, DEFAULT_ANIMATION_STATE_TABLE, DEFAULT_GODOT_ANIMATION_STATE_SCRIPT } from './godot-animation-state-script.mjs';
const TITLE = '# Viento animation state script';
const MARKER = '#@viento-animation-state-script';
const PREFIX = TITLE + '\n' + MARKER + ' ';
const FORMAT = 'viento-animation-state-script';
const GENERATOR = 'godot-gdscript-v1';
const CONDITIONAL_GENERATOR = 'godot-gdscript-v2';
const CONDITIONAL_LIMIT = 64 * 1024;
const conditional = table => table.transitions.some(edge => Object.hasOwn(edge.trigger, 'condition'));
const LIMIT = 128 * 1024;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function failure(kind) {
  const errorCode = 'animation_state_script_source_' + kind;
  const message = kind === 'limit' ? 'The conditional animation script exceeds the 64 KiB behavior source limit. Reduce condition text or transitions.'
    : kind === 'modified' ? 'The script differs from its declared generated source. Keep editing it as ordinary source.'
    : kind === 'unsupported' ? 'This animation state script uses an unsupported declaration or generator version.'
      : 'Expected a bounded, complete animation state script declaration.';
  return Object.assign(new Error(message), { code: errorCode, errorCode });
}
function checkText(content) {
  if (typeof content !== 'string' || content.length > LIMIT) throw failure('invalid');
  let bytes = 0;
  for (let index = 0; index < content.length; index++) {
    const code = content.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = content.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw failure('invalid');
      bytes += 4;
    } else {
      if (code >= 0xdc00 && code <= 0xdfff) throw failure('invalid');
      bytes += 3;
    }
    if (bytes > LIMIT) throw failure('invalid');
  }
}
function header(table, generator = GENERATOR) {
  return PREFIX + JSON.stringify({ format: FORMAT, schemaVersion: 1, generator, table }) + '\n';
}
function emit(table) {
  const isConditional = conditional(table);
  const generated = isConditional ? generateGodotAnimationStateConditionsScript(table) : generateGodotAnimationStateScript(table);
  const content = header(table, isConditional ? CONDITIONAL_GENERATOR : GENERATOR) + generated.content;
  checkText(content);
  if (isConditional && new TextEncoder().encode(content).length > CONDITIONAL_LIMIT) throw failure('limit');
  return freeze({ content, parameters: generated.parameters });
}
export const DEFAULT_EDITABLE_GODOT_ANIMATION_STATE_SCRIPT = header(DEFAULT_ANIMATION_STATE_TABLE) + DEFAULT_GODOT_ANIMATION_STATE_SCRIPT;
export function generateEditableGodotAnimationStateScript(table) {
  return emit(inspectAnimationStateDeclaration(table).table);
}
// Deliberately cheap candidate detection, including malformed marker suffixes.
// Never use this alone to approve a table edit or to replace source bytes.
export function hasAnimationStateScriptMarker(content) {
  if (typeof content !== 'string') return false;
  const source = content.startsWith('\uFEFF') ? content.slice(1) : content;
  return source.startsWith(TITLE + '\n' + MARKER) || source.startsWith(TITLE + '\r\n' + MARKER);
}
export function readAnimationStateScriptSource(content) {
  checkText(content);
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  let normalized = bom ? content.slice(1) : content;
  let newline = '\n';
  if (normalized.includes('\r')) {
    const withoutPairs = normalized.replaceAll('\r\n', '');
    if (withoutPairs.includes('\r') || withoutPairs.includes('\n')) throw failure('invalid');
    newline = '\r\n'; normalized = normalized.replaceAll('\r\n', '\n');
  }
  const firstEnd = normalized.indexOf('\n', PREFIX.length);
  if (!normalized.startsWith(PREFIX) || firstEnd < 0) throw failure('invalid');
  const parsed = parseJsonSource(normalized.slice(PREFIX.length, firstEnd));
  if (!parsed.ok || parsed.ambiguous) throw failure('invalid');
  const envelope = parsed.value;
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
    || Object.keys(envelope).length !== 4 || !['format', 'schemaVersion', 'generator', 'table'].every(key => Object.hasOwn(envelope, key))
    || envelope.format !== FORMAT) throw failure('invalid');
  if (envelope.schemaVersion !== 1 || ![GENERATOR, CONDITIONAL_GENERATOR].includes(envelope.generator)) throw failure('unsupported');
  if (envelope.generator === CONDITIONAL_GENERATOR && new TextEncoder().encode(content).length > CONDITIONAL_LIMIT) throw failure('limit');
  let inspected;
  try { inspected = envelope.generator === GENERATOR ? inspectAnimationStateTable(envelope.table) : inspectAnimationStateDeclaration(envelope.table); }
  catch (error) {
    if (error?.errorCode === 'animation_state_table_invalid' || error?.code === 'animation_state_table_invalid') throw failure('invalid');
    throw error; // Optional core absence and protocol failures stay observable.
  }
  if ((envelope.generator === CONDITIONAL_GENERATOR) !== conditional(inspected.table)) throw failure('invalid');
  const generated = emit(inspected.table);
  // Comparing the entire representation rejects changed code, alternate JSON,
  // extra markers and appended code. BOM/newlines are the only reversible forms.
  if (bom + generated.content.replaceAll('\n', newline) !== content) throw failure('modified');
  return freeze({ table: inspected.table, parameters: generated.parameters, bom, newline });
}
