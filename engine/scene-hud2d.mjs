// Optional, portable screen HUD intent. It owns no editor view, renderer,
// clock, author write or movement authority; native implementations may replace
// this bounded DTO admission without changing the document contract.
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { normalizeSourcePath } from './source-path.mjs';
import { projectSharedStateKey } from './project-shared-state.mjs';

export const SCENE_HUD2D_FORMAT = 'viento-scene-hud2d';
export const SCENE_HUD2D_FILE_MAX_BYTES = 64 * 1024;
export const SCENE_HUD2D_CAPABILITY = 'scene.hud2d';
const fail = () => { throw Object.assign(new TypeError('Invalid scene hud2d declaration or frozen plan.'), { errorCode: 'build_hud2d_invalid' }); };
const issue = (message, propertyPath = '', details = {}) => ({ severity: 'error', code: 'build_hud2d_invalid', message, propertyPath, ...details });
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function descriptors(value, array = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) !== array
    || !(array ? Object.getPrototypeOf(value) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(value)))) fail();
  const result = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(result)) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)
      || !Object.hasOwn(result[key], 'value') || !(array && key === 'length') && !result[key].enumerable) fail();
  }
  return result;
}
function record(value, keys) {
  const fields = descriptors(value);
  if (Reflect.ownKeys(fields).length !== keys.length || !keys.every(key => Object.hasOwn(fields, key))) fail();
  return Object.fromEntries(keys.map(key => [key, fields[key].value]));
}
function list(value, max, min = 0) {
  const fields = descriptors(value, true), length = fields.length?.value;
  if (!Number.isSafeInteger(length) || length < min || length > max || Reflect.ownKeys(fields).length !== length + 1) fail();
  return Array.from({ length }, (_, index) => { if (!fields[index]) fail(); return fields[index].value; });
}
function utf8Length(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return Infinity; bytes += 4;
    } else if (code >= 0xdc00 && code <= 0xdfff) return Infinity;
    else bytes += 3;
  }
  return bytes;
}
const pair = value => {
  const result = list(value, 2, 2);
  if (!result.every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 100000)) fail();
  return result;
};
const path = value => typeof value === 'string' && value.length <= 4096 && value.endsWith('.json')
  && normalizeSourcePath(value) === value && !/[\x00-\x1f\x7f:]/.test(value) && utf8Length(value) < Infinity;
const location = value => uuid(value.objectId) && path(value.sourcePath) && revision(value.sourceRevision);

export const SCENE_HUD2D_ANCHORS = Object.freeze(['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right']);
const numeric = (value, min, max, integer = false) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
const text = (value, maximum) => typeof value === 'string' && value.length <= maximum * 2 && utf8Length(value) < Infinity && [...value].length <= maximum && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const color = value => typeof value === 'string' && /^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(value);
export function validateSceneHUD2DDocument(input) {
  const value = record(input, ['format', 'schemaVersion', 'sceneObjectId', 'elements']);
  if (value.format !== SCENE_HUD2D_FORMAT || value.schemaVersion !== 1 || !uuid(value.sceneObjectId)) fail();
  const ids = new Set(), elements = list(value.elements, 32).map(raw => {
    const mode = descriptors(raw).kind?.value, keys = ['id', 'kind', 'anchor', 'offset', 'size'];
    const element = record(raw, [...keys, ...(mode === 'label' ? ['fontSize', 'color', 'content'] : ['key', 'min', 'max', 'fallback', 'fillColor', 'backgroundColor'])]);
    if (!uuid(element.id) || ids.has(element.id) || !['label', 'bar'].includes(mode) || !SCENE_HUD2D_ANCHORS.includes(element.anchor)) fail();
    ids.add(element.id);
    const vector = (raw, low, high) => { const values = list(raw, 2, 2); if (!values.every(item => numeric(item, low, high, true))) fail(); return values; };
    const result = { id: element.id, kind: mode, anchor: element.anchor, offset: vector(element.offset, -8192, 8192), size: vector(element.size, 1, 2048) };
    if (mode === 'label') {
      if (!numeric(element.fontSize, 8, 72, true) || !color(element.color)) fail();
      const kind = descriptors(element.content).kind?.value;
      const content = record(element.content, kind === 'literal' ? ['kind', 'text'] : ['kind', 'key', 'prefix', 'suffix', 'missing']);
      if (kind === 'literal' ? !text(content.text, 256) : kind !== 'state' || !projectSharedStateKey(content.key)
        || !text(content.prefix, 64) || !text(content.suffix, 64) || !text(content.missing, 256)) fail();
      return { ...result, fontSize: element.fontSize, color: element.color, content };
    }
    if (!projectSharedStateKey(element.key) || ![element.min, element.max, element.fallback].every(number => numeric(number, -1e9, 1e9))
      || element.min >= element.max || !color(element.fillColor) || !color(element.backgroundColor)) fail();
    return { ...result, key: element.key, min: element.min, max: element.max, fallback: element.fallback, fillColor: element.fillColor, backgroundColor: element.backgroundColor };
  });
  const checked = { format: SCENE_HUD2D_FORMAT, schemaVersion: 1, sceneObjectId: value.sceneObjectId, elements };
  if (utf8Length(JSON.stringify(checked)) > SCENE_HUD2D_FILE_MAX_BYTES) fail();
  return freeze(checked);
}

// Recognize a top-level marker even in incomplete or duplicate-key JSON. Nested
// examples remain ordinary documents, and source parsing retains exact ranges.
function hasMarker(content) {
  if (!/^\uFEFF?\s*\{/.test(content)) return false;
  let depth = 0, keyExpected = false;
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (character === '"') {
      const start = index++;
      for (; index < content.length; index++) { if (content[index] === '\\') index++; else if (content[index] === '"') break; }
      if (index >= content.length) break;
      if (depth !== 1 || !keyExpected) continue;
      keyExpected = false;
      if (index - start > 64) continue;
      let key; try { key = JSON.parse(content.slice(start, index + 1)); } catch { continue; }
      if (key !== 'format') continue;
      let cursor = index + 1;
      while (cursor < content.length && /\s/.test(content[cursor])) cursor++;
      if (content[cursor++] !== ':') continue;
      while (cursor < content.length && /\s/.test(content[cursor])) cursor++;
      if (content[cursor] !== '"') continue;
      const valueStart = cursor++;
      for (; cursor < content.length && cursor - valueStart <= 256; cursor++) { if (content[cursor] === '\\') cursor++; else if (content[cursor] === '"') break; }
      try { if (JSON.parse(content.slice(valueStart, cursor + 1)) === SCENE_HUD2D_FORMAT) return true; } catch { /* incomplete marker is not a declaration */ }
      continue;
    }
    if (character === '{' || character === '[') { depth++; if (depth === 1) keyExpected = true; }
    else if (character === '}' || character === ']') depth--;
    else if (character === ',' && depth === 1) keyExpected = true;
  }
  return false;
}
export function inspectSceneHUD2DDocument(content) {
  if (typeof content !== 'string' || !hasMarker(content)) return freeze({ recognized: false, ok: true, value: null, diagnostics: [] });
  const invalid = diagnostics => freeze({ recognized: true, ok: false, value: null, diagnostics });
  if (content.length > SCENE_HUD2D_FILE_MAX_BYTES || utf8Length(content) > SCENE_HUD2D_FILE_MAX_BYTES) {
    return invalid([issue('A hud2d declaration requires valid UTF-8 and at most 64 KiB.')]);
  }
  const parsed = parseJsonSource(content);
  if (!parsed.ok) return invalid(parsed.diagnostics.map(item => issue(item.message, item.propertyPath)));
  try { return freeze({ recognized: true, ok: true, value: validateSceneHUD2DDocument(parsed.value), diagnostics: [] }); }
  catch { return invalid([issue('Expected bounded HUD label or bar elements with explicit screen anchors and state keys.')]); }
}
export const sceneHUD2DDocumentIds = input => [validateSceneHUD2DDocument(input).sceneObjectId];
export const sceneHUD2DCapabilities = input => {
  validateSceneHUD2DDocument(input); return [SCENE_HUD2D_CAPABILITY];
};

function documents(source) {
  const fields = descriptors(source);
  if (!fields.documents) fail();
  return list(fields.documents.value, 200000).map(entry => {
    const wrapper = descriptors(entry), rawRecord = wrapper.record?.value;
    if (rawRecord == null) return null;
    const metadata = descriptors(rawRecord);
    return { wrapper, metadata, record: rawRecord, id: metadata.id?.value };
  }).filter(Boolean);
}
function relations(metadata) {
  return list(metadata.relations?.value, 10000).map(raw => {
    const fields = descriptors(raw);
    return Object.fromEntries(['kind', 'targetId', 'slot'].map(key => [key, fields[key]?.value]));
  });
}
function ownRecord(input) {
  const fields = descriptors(input);
  if (fields.format?.value !== 'viento-document' || fields.version?.value !== 1 || !uuid(fields.id?.value) || !path(fields.sourcePath?.value)) fail();
  return { id: fields.id.value, sourcePath: fields.sourcePath.value, relations: relations(fields) };
}
function savedScene(value, recordInput, source) {
  const own = ownRecord(recordInput);
  if (own.id === value.sceneObjectId || own.relations.filter(row => row.kind === 'references' && row.targetId === value.sceneObjectId).length !== 1
    || !own.relations.some(row => row.kind === 'references' && row.targetId === value.sceneObjectId && row.slot === 'scene')) fail();
  const candidates = documents(source).filter(entry => entry.id === value.sceneObjectId), scene = candidates[0];
  if (candidates.length !== 1 || scene.wrapper.content?.value == null) {
    return { diagnostics: [issue('The registered hud scene source is unavailable.', '/sceneObjectId', {
      code: 'build_hud2d_dependency_unavailable', relatedObjectId: value.sceneObjectId })] };
  }
  const sceneRecord = ownRecord(scene.record), content = scene.wrapper.content?.value;
  if (sceneRecord.id !== value.sceneObjectId || typeof content !== 'string' || utf8Length(content) > 128 * 1024
    || scene.wrapper.sourcePath && scene.wrapper.sourcePath.value !== sceneRecord.sourcePath) fail();
  const selected = sceneRecord.relations.filter(row => row.kind === 'references' && row.slot === 'hud2d');
  if (selected.length !== 1 || selected[0].targetId !== own.id) fail();
  const parsed = parseJsonSource(content), declaration = parsed.value;
  if (!parsed.ok || declaration?.format !== 'viento-scene2d' || ![1, 2, 3].includes(declaration.schemaVersion)) fail();
  const actors = list(declaration.actors, 128, 1), ids = new Set();
  for (const actor of actors) {
    const fields = descriptors(actor), instanceId = fields.instanceId?.value;
    const identity = declaration.schemaVersion === 1 ? fields.objectId?.value : instanceId;
    if (!uuid(identity) || !uuid(fields.objectId?.value) || ids.has(identity)) fail();
    ids.add(identity);
  }
  return { diagnostics: [], scene };
}
export function validateSceneHUD2DDependencies(input, recordInput, source) {
  try { return freeze(savedScene(validateSceneHUD2DDocument(input), recordInput, source).diagnostics); }
  catch { return freeze([issue('The hud requires a registered Scene2D 1/2/3 source, one bidirectional hud reference.')]); }
}

// Bounded descriptor capture before any asynchronous host work. Other scene
// extensions retain their own validators and are copied without interpretation.
function detach(input) {
  const active = new Set(); let nodes = 0, chars = 0;
  function copy(value, depth = 0) {
    if (++nodes > 1000000 || depth > 32) fail();
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') { if (value.length > 131072 || (chars += value.length) > 8 * 1024 * 1024) fail(); return value; }
    if (!value || typeof value !== 'object' || active.has(value)) fail();
    const array = Array.isArray(value), fields = descriptors(value, array), length = fields.length?.value;
    if (array ? !Number.isSafeInteger(length) || length > 8192 || Reflect.ownKeys(fields).length !== length + 1 : Reflect.ownKeys(fields).length > 128) fail();
    active.add(value); const output = array ? [] : {};
    for (const key of array ? Array.from({ length }, (_, index) => String(index)) : Reflect.ownKeys(fields)) {
      if (!fields[key]) fail(); output[key] = copy(fields[key].value, depth + 1);
    }
    active.delete(value); return output;
  }
  return copy(input);
}
export function validateSceneHUD2DPlan(input) {
  const plan = detach(input), hud = record(plan.hud2d, ['format', 'schemaVersion', 'manifest', 'document']);
  const manifest = record(hud.manifest, ['objectId', 'sourcePath', 'sourceRevision']);
  if (plan.format !== 'viento-build-plan' || plan.kind !== 'scene2d' || ![1, 2, 3].includes(plan.schemaVersion)
    || !uuid(plan.scene?.objectId) || hud.format !== 'viento-hud2d-plan' || hud.schemaVersion !== 1
    || !location(manifest) || manifest.objectId === plan.scene.objectId || !list(plan.requiredCapabilities, 128).includes(SCENE_HUD2D_CAPABILITY)) fail();
  const document = validateSceneHUD2DDocument(hud.document);
  if (document.sceneObjectId !== plan.scene.objectId || sceneHUD2DCapabilities(document).some(capability => !plan.requiredCapabilities.includes(capability))) fail();
  return freeze({ format: 'viento-hud2d-plan', schemaVersion: 1, manifest, document });
}
export function stripSceneHUD2DPlan(input) {
  const { hud2d, ...plan } = detach(input);
  plan.requiredCapabilities = list(plan.requiredCapabilities, 128).filter(value => value !== SCENE_HUD2D_CAPABILITY);
  return plan;
}
// Discovery is deliberately weaker than opt-in admission: old author planners
// may carry foreign-realm or minimal registration data. Inspect only own data
// descriptors of the selected scene; do not impose hud DTO/realm rules on an
// observation which never selects this optional feature, or invoke accessors.
function hasHUD2DOptIn(observed, input) {
  const data = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
  const sceneId = data(data(input, 'scene'), 'objectId'), source = data(observed, 'source'), entries = data(source, 'documents');
  if (!Array.isArray(entries)) return false;
  const length = data(entries, 'length');
  if (!Number.isSafeInteger(length) || length < 0 || length > 200000) fail();
  for (let index = 0; index < length; index++) {
    const metadata = data(data(entries, String(index)), 'record');
    if (data(metadata, 'id') !== sceneId) continue;
    const relationField = Object.getOwnPropertyDescriptor(metadata, 'relations');
    if (!relationField) continue;
    if (!Object.hasOwn(relationField, 'value')) fail();
    const rows = relationField.value;
    if (!Array.isArray(rows)) continue;
    const count = data(rows, 'length');
    if (!Number.isSafeInteger(count) || count < 0 || count > 10000) fail();
    for (let row = 0; row < count; row++) {
      const relation = data(rows, String(row));
      if (!relation || typeof relation !== 'object') continue;
      const kind = Object.getOwnPropertyDescriptor(relation, 'kind'), slot = Object.getOwnPropertyDescriptor(relation, 'slot');
      if (kind?.value === 'references' && slot && !Object.hasOwn(slot, 'value')
        || slot?.value === 'hud2d' && kind && !Object.hasOwn(kind, 'value')) fail();
      if (kind?.value === 'references' && slot?.value === 'hud2d') return true;
    }
  }
  return false;
}
export function resolveSceneHUD2D(observed, input) {
  const result = (hud2d, diagnostics = []) => freeze({ ok: diagnostics.length === 0, hud2d, diagnostics });
  if (!hasHUD2DOptIn(observed, input)) return result(null);

  const entries = documents(observed.source), scenes = entries.filter(entry => entry.id === input.scene.objectId), scene = scenes[0];
  const selected = scene ? relations(scene.metadata).filter(row => row.kind === 'references' && row.slot === 'hud2d') : [];
  if (!selected.length) return result(null);
  const base = { objectId: input.scene.objectId, sourcePath: input.scene.sourcePath, sourceRevision: input.scene.sourceRevision };
  const sceneIssue = message => result(null, [issue(message, '', base)]);
  if (scenes.length !== 1 || selected.length !== 1 || ![1, 2, 3].includes(input.schemaVersion)) return sceneIssue('A Scene2D 1/2/3 may reference one hud2d declaration.');
  const sources = entries.filter(entry => entry.id === selected[0].targetId), source = sources[0];
  if (sources.length !== 1 || source.id === scene.id || typeof source.wrapper.content?.value !== 'string') return sceneIssue('Select an available registered hud2d JSON declaration.');
  const content = source.wrapper.content.value, checked = inspectSceneHUD2DDocument(content), manifest = {
    objectId: source.id, sourcePath: source.metadata.sourcePath?.value, sourceRevision: source.wrapper.sourceRevision?.value };
  if (!location(manifest) || source.wrapper.sourcePath?.value !== manifest.sourcePath) return sceneIssue('Invalid hud2d source identity.');
  const parsed = checked.ok && checked.recognized ? parseJsonSource(content) : null;
  const at = pointer => ({ ...manifest, propertyPath: pointer, ...(parsed?.ok ? { sourceRange: locateJsonSource(parsed, pointer, { nearest: true }) } : {}) });
  if (!checked.recognized || !checked.ok) return result(null, (checked.diagnostics.length ? checked.diagnostics : [issue('Expected a hud2d declaration.')])
    .map(error => ({ ...error, ...at(error.propertyPath || '') })));
  const errors = validateSceneHUD2DDependencies(checked.value, source.record, observed.source);
  if (errors.length) return result(null, errors.map(error => ({ ...error, ...at(error.propertyPath || '') })));
  const hud2d = { format: 'viento-hud2d-plan', schemaVersion: 1, manifest, document: checked.value };
  try { return result(validateSceneHUD2DPlan({ ...input, hud2d, requiredCapabilities: [...input.requiredCapabilities, ...sceneHUD2DCapabilities(checked.value)] })); }
  catch { return result(null, [issue('The HUD does not match the frozen scene identity.', '', at(''))]); }
}
