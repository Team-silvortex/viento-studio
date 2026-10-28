// Portable project keyboard input. Keys name physical positions, not characters.
import { parseJsonSource } from './json-source.mjs';

export const PROJECT_INPUT_MAP_FORMAT = 'viento-input-map';
export const PROJECT_INPUT_MAP_FILE_MAX_BYTES = 32768;
export const PROJECT_INPUT_MAP_KEYS = Object.freeze([
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'Tab',
]);
const keySet = new Set(PROJECT_INPUT_MAP_KEYS);
const invalid = () => Object.assign(new TypeError('Invalid project input map.'), { errorCode: 'build_input_map_invalid' });
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || keys.some(key => !Object.hasOwn(descriptors, key)) || names.some(key => typeof key !== 'string'
    || !keys.includes(key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) throw invalid();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function array(value, min, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < min || length > max || Reflect.ownKeys(descriptors).length !== length + 1) throw invalid();
  return Array.from({ length }, (_, i) => {
    const d = descriptors[String(i)]; if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw invalid(); return d.value;
  });
}
export function validateProjectInputMap(input) {
  const dto = object(input, ['format', 'schemaVersion', 'actions']);
  if (dto.format !== PROJECT_INPUT_MAP_FORMAT || dto.schemaVersion !== 1) throw invalid();
  const names = new Set();
  const actions = array(dto.actions, 1, 64).map(raw => {
    const action = object(raw, ['name', 'keys']);
    if (typeof action.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(action.name) || action.name.startsWith('ui_') || names.has(action.name)) throw invalid();
    names.add(action.name);
    const keys = array(action.keys, 1, 16);
    if (keys.some(key => typeof key !== 'string' || !keySet.has(key)) || new Set(keys).size !== keys.length) throw invalid();
    return Object.freeze({ name: action.name, keys: Object.freeze(keys) });
  });
  return Object.freeze({ format: PROJECT_INPUT_MAP_FORMAT, schemaVersion: 1, actions: Object.freeze(actions) });
}
export function inspectProjectInputMap(content) {
  if (typeof content !== 'string' || content.length > PROJECT_INPUT_MAP_FILE_MAX_BYTES || new TextEncoder().encode(content).length > PROJECT_INPUT_MAP_FILE_MAX_BYTES) throw invalid();
  const parsed = parseJsonSource(content);
  if (!parsed.ok) throw invalid();
  return validateProjectInputMap(parsed.value);
}
