// Data-only parameter interfaces. Providers recognize source formats; this
// boundary captures their scalar declarations and reviews unsaved form rows.
// No source discovery, code execution, persistence or automatic migration.
const FORMAT = 'viento-script-parameters';
const TYPES = ['string', 'number', 'boolean'];
const STATUSES = ['ready', 'modified', 'unsupported', 'unavailable'];
const name = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.exec(value)?.[0] === value
  && !['constructor', 'prototype', '__proto__'].includes(value);
const backend = value => typeof value === 'string' && value.length <= 128 && /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.exec(value)?.[0] === value;
const language = value => typeof value === 'string' && value.length <= 64 && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.exec(value)?.[0] === value;
const clip = value => value === '' || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.exec(value)?.[0] === value;
const text = value => typeof value === 'string' && value.length <= 4096
  && [...value].every(character => { const code = character.codePointAt(0); return code < 0xd800 || code > 0xdfff; });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function invalid() { throw Object.assign(new TypeError('Expected a bounded script parameter interface or form.'), { errorCode: 'script_parameter_interface_invalid' }); }
function record(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) invalid();
  const properties = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(properties);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))
    || fields.some(key => !properties[key]?.enumerable || !Object.hasOwn(properties[key], 'value'))) invalid();
  return Object.fromEntries(fields.map(key => [key, properties[key].value]));
}
function array(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 32) invalid();
  const properties = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(properties).length !== value.length + 1) invalid();
  return Array.from({ length: value.length }, (_, index) => {
    const property = properties[index];
    if (!property?.enumerable || !Object.hasOwn(property, 'value')) invalid();
    return property.value;
  });
}
export function captureScriptParameterContract(value) {
  const result = record(value, ['format', 'schemaVersion', 'backendId', 'language', 'status', 'parameters']);
  if (result.format !== FORMAT || result.schemaVersion !== 1 || !backend(result.backendId) || !language(result.language) || !STATUSES.includes(result.status)) invalid();
  const names = new Set();
  result.parameters = array(result.parameters).map(input => {
    const row = record(input, ['name', 'type', 'defaultValue', 'referenceKind']);
    if (!name(row.name) || names.has(row.name) || !TYPES.includes(row.type) || typeof row.defaultValue !== row.type
      || row.type === 'string' && !text(row.defaultValue)
      || row.type === 'number' && (!Number.isFinite(row.defaultValue) || Number.isInteger(row.defaultValue) && !Number.isSafeInteger(row.defaultValue))
      || !['', 'animation-clip'].includes(row.referenceKind)
      || row.referenceKind === 'animation-clip' && (row.type !== 'string' || !clip(row.defaultValue))) invalid();
    names.add(row.name); return row;
  });
  if (result.status !== 'ready' && result.parameters.length) invalid();
  return freeze(result);
}
export function reviewScriptParameterRows(contract, form) {
  const captured = captureScriptParameterContract(contract), input = record(form, ['backendId', 'language', 'parameters']);
  if (!backend(input.backendId) || !language(input.language)) invalid();
  // Values retain the form's raw text, including unfinished numeric input.
  // Ordinary behavior validation remains the authority for scalar conversion.
  const parameters = array(input.parameters).map(value => {
    const row = record(value, ['name', 'type', 'value']);
    if (!text(row.name) || !TYPES.includes(row.type) || !text(row.value)) invalid();
    return row;
  });
  const result = { status: captured.status, missing: [], unknown: [], typeMismatches: [], invalidValues: [], duplicateNames: [], canAddMissing: false };
  if (input.backendId !== captured.backendId || input.language !== captured.language) result.status = 'incompatible';
  if (result.status !== 'ready') return freeze(result);
  const declarations = new Map(captured.parameters.map(row => [row.name, row])), indexes = new Map();
  parameters.forEach((row, index) => {
    const same = indexes.get(row.name) || []; same.push(index); indexes.set(row.name, same);
    const expected = declarations.get(row.name);
    if (!expected) result.unknown.push({ index, name: row.name });
    else if (row.type !== expected.type) result.typeMismatches.push({ index, name: row.name, expectedType: expected.type, actualType: row.type });
    else if (expected.referenceKind === 'animation-clip' && !clip(row.value)) result.invalidValues.push({ index, name: row.name, referenceKind: expected.referenceKind });
  });
  result.missing = captured.parameters.filter(row => !indexes.has(row.name));
  result.duplicateNames = [...indexes].filter(([, positions]) => positions.length > 1).map(([name, indexes]) => ({ name, indexes }));
  result.canAddMissing = result.missing.length > 0 && result.duplicateNames.length === 0 && parameters.length + result.missing.length <= 32;
  return freeze(result);
}
