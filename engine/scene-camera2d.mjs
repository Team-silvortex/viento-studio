// Optional, portable runtime camera intent. It owns no editor view, renderer,
// clock, author write or movement authority; native implementations may replace
// this bounded DTO admission without changing the document contract.
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { normalizeSourcePath } from './source-path.mjs';

export const SCENE_CAMERA2D_FORMAT = 'viento-scene-camera2d';
export const SCENE_CAMERA2D_FILE_MAX_BYTES = 16 * 1024;
export const SCENE_CAMERA2D_CAPABILITY = 'scene.camera2d';
export const SCENE_CAMERA2D_LIMITS_CAPABILITY = 'scene.camera2d.limits2d';
const fail = () => { throw Object.assign(new TypeError('Invalid scene camera2d declaration or frozen plan.'), { errorCode: 'build_camera2d_invalid' }); };
const issue = (message, propertyPath = '', details = {}) => ({ severity: 'error', code: 'build_camera2d_invalid', message, propertyPath, ...details });
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

export function validateSceneCamera2DDocument(input) {
  const value = record(input, ['format', 'schemaVersion', 'sceneObjectId', 'camera']);
  if (value.format !== SCENE_CAMERA2D_FORMAT || ![1, 2].includes(value.schemaVersion) || !uuid(value.sceneObjectId)) fail();
  const fields = descriptors(value.camera), mode = fields.mode?.value;
  const keys = mode === 'fixed' ? ['mode', 'center', 'zoom'] : ['mode', 'targetInstanceId', 'offset', 'zoom'];
  const camera = record(value.camera, [...keys, ...(value.schemaVersion === 2 ? ['limits'] : [])]);
  if (!['fixed', 'follow'].includes(mode) || typeof camera.zoom !== 'number' || !Number.isFinite(camera.zoom) || camera.zoom < 0.125 || camera.zoom > 8) fail();
  const checked = mode === 'fixed' ? { mode, center: pair(camera.center), zoom: camera.zoom }
    : { mode, targetInstanceId: camera.targetInstanceId, offset: pair(camera.offset), zoom: camera.zoom };
  if (mode === 'follow' && !uuid(checked.targetInstanceId)) fail();
  if (value.schemaVersion === 2) {
    const limits = record(camera.limits, ['left', 'top', 'right', 'bottom']);
    if (!Object.values(limits).every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 100000)
      || limits.left >= limits.right || limits.top >= limits.bottom) fail();
    checked.limits = limits;
  }
  return freeze({ format: SCENE_CAMERA2D_FORMAT, schemaVersion: value.schemaVersion, sceneObjectId: value.sceneObjectId, camera: checked });
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
      try { if (JSON.parse(content.slice(valueStart, cursor + 1)) === SCENE_CAMERA2D_FORMAT) return true; } catch { /* incomplete marker is not a declaration */ }
      continue;
    }
    if (character === '{' || character === '[') { depth++; if (depth === 1) keyExpected = true; }
    else if (character === '}' || character === ']') depth--;
    else if (character === ',' && depth === 1) keyExpected = true;
  }
  return false;
}
export function inspectSceneCamera2DDocument(content) {
  if (typeof content !== 'string' || !hasMarker(content)) return freeze({ recognized: false, ok: true, value: null, diagnostics: [] });
  const invalid = diagnostics => freeze({ recognized: true, ok: false, value: null, diagnostics });
  if (content.length > SCENE_CAMERA2D_FILE_MAX_BYTES || utf8Length(content) > SCENE_CAMERA2D_FILE_MAX_BYTES) {
    return invalid([issue('A camera2d declaration requires valid UTF-8 and at most 16 KiB.')]);
  }
  const parsed = parseJsonSource(content);
  if (!parsed.ok) return invalid(parsed.diagnostics.map(item => issue(item.message, item.propertyPath)));
  try { return freeze({ recognized: true, ok: true, value: validateSceneCamera2DDocument(parsed.value), diagnostics: [] }); }
  catch { return invalid([issue('Expected a complete fixed or follow camera with bounded coordinates and zoom.')]); }
}
export const sceneCamera2DDocumentIds = input => [validateSceneCamera2DDocument(input).sceneObjectId];
export const sceneCamera2DCapabilities = input => {
  const document = validateSceneCamera2DDocument(input);
  return [SCENE_CAMERA2D_CAPABILITY, ...(document.schemaVersion === 2 ? [SCENE_CAMERA2D_LIMITS_CAPABILITY] : [])];
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
  if (own.id === value.sceneObjectId || own.relations.filter(row => row.kind === 'references' && row.targetId === value.sceneObjectId).length !== 1) fail();
  const candidates = documents(source).filter(entry => entry.id === value.sceneObjectId), scene = candidates[0];
  if (candidates.length !== 1 || scene.wrapper.content?.value == null) {
    return { diagnostics: [issue('The registered camera scene source is unavailable.', '/sceneObjectId', {
      code: 'build_camera2d_dependency_unavailable', relatedObjectId: value.sceneObjectId })] };
  }
  const sceneRecord = ownRecord(scene.record), content = scene.wrapper.content?.value;
  if (sceneRecord.id !== value.sceneObjectId || typeof content !== 'string' || utf8Length(content) > 128 * 1024
    || scene.wrapper.sourcePath && scene.wrapper.sourcePath.value !== sceneRecord.sourcePath) fail();
  const selected = sceneRecord.relations.filter(row => row.kind === 'references' && row.slot === 'camera2d');
  if (selected.length !== 1 || selected[0].targetId !== own.id) fail();
  const parsed = parseJsonSource(content), declaration = parsed.value;
  if (!parsed.ok || declaration?.format !== 'viento-scene2d' || ![2, 3].includes(declaration.schemaVersion)) fail();
  const actors = list(declaration.actors, 128, 1), ids = new Set();
  for (const actor of actors) {
    const fields = descriptors(actor), instanceId = fields.instanceId?.value;
    if (!uuid(instanceId) || !uuid(fields.objectId?.value) || ids.has(instanceId)) fail();
    ids.add(instanceId);
  }
  if (value.camera.mode === 'follow' && !ids.has(value.camera.targetInstanceId)) return { diagnostics: [issue(
    'Select a stable instance from the saved camera scene.', '/camera/targetInstanceId', { relatedObjectId: value.sceneObjectId, instanceId: value.camera.targetInstanceId })] };
  return { diagnostics: [], scene };
}
export function validateSceneCamera2DDependencies(input, recordInput, source) {
  try { return freeze(savedScene(validateSceneCamera2DDocument(input), recordInput, source).diagnostics); }
  catch { return freeze([issue('The camera requires a registered Scene2D 2/3 source, one bidirectional camera reference and a valid stable target.')]); }
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
export function validateSceneCamera2DPlan(input) {
  const plan = detach(input), camera = record(plan.camera2d, ['format', 'schemaVersion', 'manifest', 'document']);
  const manifest = record(camera.manifest, ['objectId', 'sourcePath', 'sourceRevision']);
  if (plan.format !== 'viento-build-plan' || plan.kind !== 'scene2d' || ![2, 3].includes(plan.schemaVersion)
    || !uuid(plan.scene?.objectId) || camera.format !== 'viento-camera2d-plan' || camera.schemaVersion !== 1
    || !location(manifest) || manifest.objectId === plan.scene.objectId || !list(plan.requiredCapabilities, 128).includes(SCENE_CAMERA2D_CAPABILITY)) fail();
  const document = validateSceneCamera2DDocument(camera.document);
  if (document.sceneObjectId !== plan.scene.objectId || sceneCamera2DCapabilities(document).some(capability => !plan.requiredCapabilities.includes(capability))) fail();
  const actors = list(plan.actors, 128, 1), ids = new Set();
  for (const actor of actors) { if (!uuid(actor?.instanceId) || !uuid(actor.objectId) || ids.has(actor.instanceId)) fail(); ids.add(actor.instanceId); }
  if (document.camera.mode === 'follow' && !ids.has(document.camera.targetInstanceId)) fail();
  return freeze({ format: 'viento-camera2d-plan', schemaVersion: 1, manifest, document });
}
export function stripSceneCamera2DPlan(input) {
  const { camera2d, ...plan } = detach(input);
  plan.requiredCapabilities = list(plan.requiredCapabilities, 128).filter(value => ![SCENE_CAMERA2D_CAPABILITY, SCENE_CAMERA2D_LIMITS_CAPABILITY].includes(value));
  return plan;
}
// Discovery is deliberately weaker than opt-in admission: old author planners
// may carry foreign-realm or minimal registration data. Inspect only own data
// descriptors of the selected scene; do not impose camera DTO/realm rules on an
// observation which never selects this optional feature, or invoke accessors.
function hasCamera2DOptIn(observed, input) {
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
        || slot?.value === 'camera2d' && kind && !Object.hasOwn(kind, 'value')) fail();
      if (kind?.value === 'references' && slot?.value === 'camera2d') return true;
    }
  }
  return false;
}
export function resolveSceneCamera2D(observed, input) {
  const result = (camera2d, diagnostics = []) => freeze({ ok: diagnostics.length === 0, camera2d, diagnostics });
  if (!hasCamera2DOptIn(observed, input)) return result(null);

  const entries = documents(observed.source), scenes = entries.filter(entry => entry.id === input.scene.objectId), scene = scenes[0];
  const selected = scene ? relations(scene.metadata).filter(row => row.kind === 'references' && row.slot === 'camera2d') : [];
  if (!selected.length) return result(null);
  const base = { objectId: input.scene.objectId, sourcePath: input.scene.sourcePath, sourceRevision: input.scene.sourceRevision };
  const sceneIssue = message => result(null, [issue(message, '', base)]);
  if (scenes.length !== 1 || selected.length !== 1 || ![2, 3].includes(input.schemaVersion)) return sceneIssue('A stable Scene2D 2/3 may reference one camera2d declaration.');
  const sources = entries.filter(entry => entry.id === selected[0].targetId), source = sources[0];
  if (sources.length !== 1 || source.id === scene.id || typeof source.wrapper.content?.value !== 'string') return sceneIssue('Select an available registered camera2d JSON declaration.');
  const content = source.wrapper.content.value, checked = inspectSceneCamera2DDocument(content), manifest = {
    objectId: source.id, sourcePath: source.metadata.sourcePath?.value, sourceRevision: source.wrapper.sourceRevision?.value };
  if (!location(manifest) || source.wrapper.sourcePath?.value !== manifest.sourcePath) return sceneIssue('Invalid camera2d source identity.');
  const parsed = checked.ok && checked.recognized ? parseJsonSource(content) : null;
  const at = pointer => ({ ...manifest, propertyPath: pointer, ...(parsed?.ok ? { sourceRange: locateJsonSource(parsed, pointer, { nearest: true }) } : {}) });
  if (!checked.recognized || !checked.ok) return result(null, (checked.diagnostics.length ? checked.diagnostics : [issue('Expected a camera2d declaration.')])
    .map(error => ({ ...error, ...at(error.propertyPath || '') })));
  const errors = validateSceneCamera2DDependencies(checked.value, source.record, observed.source);
  if (errors.length) return result(null, errors.map(error => ({ ...error, ...at(error.propertyPath || '') })));
  const camera2d = { format: 'viento-camera2d-plan', schemaVersion: 1, manifest, document: checked.value };
  try { return result(validateSceneCamera2DPlan({ ...input, camera2d, requiredCapabilities: [...input.requiredCapabilities, ...sceneCamera2DCapabilities(checked.value)] })); }
  catch { return result(null, [issue('The camera does not match the frozen scene instances.', '', at(''))]); }
}
