// A registered author document binds finite physics input to one scene.
// Scene identity belongs to the author envelope, not the runtime input DTO.
import { parseJsonSource } from './json-source.mjs';
import { validateProjectPhysics2DInputReplay } from './project-physics2d-input-replay.mjs';
import { validateRuntimeCaseSceneDependencies } from './runtime-case-document.mjs';

export const PHYSICS_REPLAY_DOCUMENT_FORMAT = 'viento-physics2d-replay-document';
export const PHYSICS_REPLAY_DOCUMENT_FILE_MAX_BYTES = 256 * 1024;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const has = (value, key) => Object.hasOwn(value, key);
const error = (code = 'runtime_physics_replay_document_invalid') => Object.assign(new TypeError('Invalid registered physics replay document.'), { errorCode: code });
const issue = (code, message, propertyPath = '', details = {}) => ({ severity: 'error', code, message, propertyPath, ...details });

function fields(value, array = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) !== array) throw error();
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw error();
  const result = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(result)) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)
      || !has(result[key], 'value') || !(array && key === 'length') && !result[key].enumerable) throw error();
  }
  return result;
}

function utf8Length(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return Infinity;
      bytes += 4;
    } else if (code >= 0xdc00 && code <= 0xdfff) return Infinity;
    else bytes += 3;
  }
  return bytes;
}

export function validatePhysicsReplayDocument(input) {
  const values = fields(input), keys = ['format', 'schemaVersion', 'sceneObjectId', 'replay'];
  if (Reflect.ownKeys(values).length !== keys.length || !keys.every(key => has(values, key))
    || values.format.value !== PHYSICS_REPLAY_DOCUMENT_FORMAT || values.schemaVersion.value !== 1
    || !uuid(values.sceneObjectId.value)) throw error();
  // The replay validator owns the input limits and defensive cloning.
  const value = { format: PHYSICS_REPLAY_DOCUMENT_FORMAT, schemaVersion: 1,
    sceneObjectId: values.sceneObjectId.value, replay: validateProjectPhysics2DInputReplay(values.replay.value) };
  if (utf8Length(JSON.stringify(value)) > PHYSICS_REPLAY_DOCUMENT_FILE_MAX_BYTES) throw error('runtime_physics_replay_document_limit');
  return Object.freeze(value);
}

// Recognize escaped or unfinished top-level markers without building a CST for
// an oversized source. Nested examples and plain input programs stay ordinary.
function hasMarker(content) {
  if (!/^\uFEFF?\s*\{/.test(content)) return false;
  let depth = 0, keyExpected = false;
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (character === '"') {
      const start = index++;
      for (; index < content.length; index++) {
        if (content[index] === '\\') index++;
        else if (content[index] === '"') break;
      }
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
      for (; cursor < content.length && cursor - valueStart <= 256; cursor++) {
        if (content[cursor] === '\\') cursor++;
        else if (content[cursor] === '"') break;
      }
      try {
        if (cursor - valueStart <= 256 && content[cursor] === '"'
          && JSON.parse(content.slice(valueStart, cursor + 1)) === PHYSICS_REPLAY_DOCUMENT_FORMAT) return true;
      } catch { /* The strict parser diagnoses partial declarations. */ }
    } else if (character === '{' || character === '[') { depth++; if (depth === 1) keyExpected = true; }
    else if (character === '}' || character === ']') { if (--depth <= 0) break; }
    else if (character === ',' && depth === 1) keyExpected = true;
  }
  return false;
}

export function inspectPhysicsReplayDocument(content) {
  if (typeof content !== 'string' || !hasMarker(content)) return { recognized: false, ok: true, value: null, diagnostics: [] };
  const failure = diagnostics => ({ recognized: true, ok: false, value: null, diagnostics });
  if (content.length > PHYSICS_REPLAY_DOCUMENT_FILE_MAX_BYTES || utf8Length(content) > PHYSICS_REPLAY_DOCUMENT_FILE_MAX_BYTES) {
    return failure([issue('runtime_physics_replay_document_limit', 'A physics replay document requires valid UTF-8 and at most 256 KiB.')]);
  }
  const parsed = parseJsonSource(content);
  if (!parsed.ok) return failure(parsed.diagnostics.map(item => issue('runtime_physics_replay_document_invalid', item.message, item.propertyPath)));
  try { return { recognized: true, ok: true, value: validatePhysicsReplayDocument(parsed.value), diagnostics: [] }; }
  catch (caught) { return failure([issue(caught.errorCode || 'runtime_physics_replay_document_invalid', 'Invalid physics replay document or finite input.')]); }
}

export function physicsReplayDocumentIds(input) {
  return [validatePhysicsReplayDocument(input).sceneObjectId];
}

export function validatePhysicsReplayDocumentDependencies(input, record = {}, source = {}) {
  try {
    const value = validatePhysicsReplayDocument(input), recordFields = fields(record);
    const sourcePath = recordFields.sourcePath?.value, ownId = recordFields.id?.value;
    if (recordFields.format?.value !== 'viento-document' || typeof sourcePath !== 'string' || !sourcePath.toLowerCase().endsWith('.json')
      || ownId != null && (!uuid(ownId) || ownId === value.sceneObjectId)) throw error();
    return validateRuntimeCaseSceneDependencies(value.sceneObjectId, source).diagnostics.map(item => ({ ...item,
      code: item.code.replace(/^runtime_case/, 'runtime_physics_replay') }));
  } catch (caught) {
    return [issue(caught.errorCode || 'runtime_physics_replay_document_invalid', 'Invalid physics replay document or scene dependency.')];
  }
}
