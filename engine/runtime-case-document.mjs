// A registered author document binds an existing finite case to one scene.
// Scene identity belongs to this envelope; run protocols and case DTOs do not change.
import { parseJsonSource } from './json-source.mjs';
import { validateSceneGroups } from './scene-groups.mjs';
import { validateRuntimeCase, validateRuntimeCasePlan } from './runtime-verification-case.mjs';

export const RUNTIME_CASE_DOCUMENT_FORMAT = 'viento-runtime-case-document';
export const RUNTIME_CASE_DOCUMENT_FILE_MAX_BYTES = 256 * 1024;
const SCENE_MAX_BYTES = 8 * 1024 * 1024;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const has = (value, key) => Object.hasOwn(value, key);
const error = (code = 'runtime_case_document_invalid') => Object.assign(new TypeError('Invalid registered runtime case document.'), { errorCode: code });
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

export function validateRuntimeCaseDocument(input) {
  const values = fields(input), keys = ['format', 'schemaVersion', 'sceneObjectId', 'case'];
  if (Reflect.ownKeys(values).length !== keys.length || !keys.every(key => has(values, key))
    || values.format.value !== RUNTIME_CASE_DOCUMENT_FORMAT || values.schemaVersion.value !== 1
    || !uuid(values.sceneObjectId.value)) throw error();
  // The existing case validator owns all nested program/check limits and cloning.
  const value = { format: RUNTIME_CASE_DOCUMENT_FORMAT, schemaVersion: 1,
    sceneObjectId: values.sceneObjectId.value, case: validateRuntimeCase(values.case.value) };
  if (utf8Length(JSON.stringify(value)) > RUNTIME_CASE_DOCUMENT_FILE_MAX_BYTES) throw error('runtime_case_document_limit');
  return Object.freeze(value);
}

// Recognize escaped or unfinished top-level markers without building a CST for
// an oversized source. Nested examples and plain runtime cases stay ordinary.
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
          && JSON.parse(content.slice(valueStart, cursor + 1)) === RUNTIME_CASE_DOCUMENT_FORMAT) return true;
      } catch { /* The strict parser diagnoses partial declarations. */ }
    } else if (character === '{' || character === '[') { depth++; if (depth === 1) keyExpected = true; }
    else if (character === '}' || character === ']') { if (--depth <= 0) break; }
    else if (character === ',' && depth === 1) keyExpected = true;
  }
  return false;
}

export function inspectRuntimeCaseDocument(content) {
  if (typeof content !== 'string' || !hasMarker(content)) return { recognized: false, ok: true, value: null, diagnostics: [] };
  const failure = diagnostics => ({ recognized: true, ok: false, value: null, diagnostics });
  if (content.length > RUNTIME_CASE_DOCUMENT_FILE_MAX_BYTES || utf8Length(content) > RUNTIME_CASE_DOCUMENT_FILE_MAX_BYTES) {
    return failure([issue('runtime_case_document_limit', 'A runtime case document requires valid UTF-8 and at most 256 KiB.')]);
  }
  const parsed = parseJsonSource(content);
  if (!parsed.ok) return failure(parsed.diagnostics.map(item => issue('runtime_case_document_invalid', item.message, item.propertyPath)));
  try { return { recognized: true, ok: true, value: validateRuntimeCaseDocument(parsed.value), diagnostics: [] }; }
  catch (caught) { return failure([issue(caught.errorCode || 'runtime_case_document_invalid', 'Invalid runtime case document or finite case.')]); }
}

export function runtimeCaseDocumentIds(input) {
  return [validateRuntimeCaseDocument(input).sceneObjectId];
}

export function validateRuntimeCaseDocumentPlan(plan, input) {
  const value = validateRuntimeCaseDocument(input), planFields = fields(plan), sceneFields = fields(planFields.scene?.value);
  if (sceneFields.objectId?.value !== value.sceneObjectId) throw error('runtime_case_scene_mismatch');
  validateRuntimeCasePlan(plan, value.case);
  return value;
}

// Author scene identity admission is shared by a case and an ordered suite.
// It checks available scene/definition bytes even when a suite member is absent.
// The returned plan contains identities only, never a second movement model.
export function validateRuntimeCaseSceneDependencies(sceneObjectId, source = {}) {
  try {
    if (!uuid(sceneObjectId)) throw error();
    const sourceFields = fields(source);
    const documentFields = fields(sourceFields.documents?.value || [], true), length = documentFields.length.value;
    if (!Number.isSafeInteger(length) || length > 200000 || Reflect.ownKeys(documentFields).length !== length + 1) throw error();
    const documents = new Map();
    for (let index = 0; index < length; index++) {
      if (!has(documentFields, String(index))) throw error();
      const item = fields(documentFields[index].value), registration = item.record?.value;
      if (!registration) continue;
      const registered = fields(registration), id = registered.id?.value;
      if (!uuid(id) || documents.has(id)) throw error();
      documents.set(id, { item, registered });
    }
    const diagnostics = [], unavailable = (id, at) => diagnostics.push(issue('runtime_case_dependency_unavailable',
      'The registered runtime case dependency source is unavailable.', at, { relatedObjectId: id }));
    const sceneDocument = documents.get(sceneObjectId);
    if (!sceneDocument || sceneDocument.registered.format?.value !== 'viento-document') throw error();
    const scenePath = sceneDocument.registered.sourcePath?.value, content = sceneDocument.item.content?.value;
    if (typeof scenePath !== 'string' || !scenePath.toLowerCase().endsWith('.json')
      || sceneDocument.item.sourcePath && sceneDocument.item.sourcePath.value !== scenePath) throw error();
    if (typeof content !== 'string') { unavailable(sceneObjectId, '/sceneObjectId'); return { plan: null, diagnostics }; }
    if (content.length > SCENE_MAX_BYTES || utf8Length(content) > SCENE_MAX_BYTES) throw error('runtime_case_document_limit');
    const parsed = parseJsonSource(content), scene = parsed.value;
    if (!parsed.ok) throw error();
    if (scene?.format !== 'viento-scene2d' || ![2, 3].includes(scene.schemaVersion)) throw error('runtime_case_unsupported');
    const relations = sceneDocument.registered.relations?.value || [], relationFields = fields(relations, true);
    if (Reflect.ownKeys(relationFields).length !== relationFields.length.value + 1) throw error();
    const targets = new Set();
    for (let index = 0; index < relationFields.length.value; index++) {
      if (!has(relationFields, String(index))) throw error();
      const relation = fields(relationFields[index].value);
      if (relation.kind?.value === 'behavior') throw error('runtime_case_unsupported');
      if (typeof relation.kind?.value !== 'string' || !uuid(relation.targetId?.value)) throw error();
      targets.add(relation.targetId.value);
    }
    if (!Array.isArray(scene.actors) || scene.actors.length < 1 || scene.actors.length > 128
      || !validateSceneGroups(scene).ok) throw error();
    const actors = [], identities = new Set();
    for (const [index, actor] of scene.actors.entries()) {
      if (!actor || typeof actor !== 'object' || !uuid(actor.instanceId) || !uuid(actor.objectId)
        || actor.objectId === sceneObjectId || identities.has(actor.instanceId)) throw error();
      identities.add(actor.instanceId); actors.push({ instanceId: actor.instanceId, objectId: actor.objectId });
      const definition = documents.get(actor.objectId), at = `/sceneObjectId/actors/${index}/objectId`;
      if (!definition || definition.registered.format?.value !== 'viento-document') throw error();
      if (typeof definition.item.content?.value !== 'string') unavailable(actor.objectId, at);
      if (!targets.has(actor.objectId)) diagnostics.push(issue('runtime_case_document_unlinked',
        'Register the scene-to-actor dependency so resource packages retain the definition.', at, { relatedObjectId: actor.objectId }));
    }
    const plan = Object.freeze({ format: 'viento-build-plan', schemaVersion: 2, kind: 'scene2d',
      scene: Object.freeze({ objectId: sceneObjectId, sourcePath: scenePath }),
      actors: Object.freeze(actors.map(actor => Object.freeze(actor))) });
    return { plan, diagnostics };
  } catch (caught) {
    return { plan: null, diagnostics: [issue(caught.errorCode || 'runtime_case_document_invalid', 'Invalid runtime case document, scene or instance dependency.')] };
  }
}

// Keep single-case admission and its diagnostics unchanged while sharing the
// scene guards. Each caller still owns its original case/program budget.
export function validateRuntimeCaseDocumentDependencies(input, record = {}, source = {}) {
  try {
    const value = validateRuntimeCaseDocument(input), recordFields = fields(record);
    const sourcePath = recordFields.sourcePath?.value, ownId = recordFields.id?.value;
    if (recordFields.format?.value !== 'viento-document' || typeof sourcePath !== 'string' || !sourcePath.toLowerCase().endsWith('.json')
      || ownId != null && (!uuid(ownId) || ownId === value.sceneObjectId)) throw error();
    const admitted = validateRuntimeCaseSceneDependencies(value.sceneObjectId, source);
    if (admitted.plan) validateRuntimeCaseDocumentPlan(admitted.plan, value);
    return admitted.diagnostics;
  } catch (caught) {
    return [issue(caught.errorCode || 'runtime_case_document_invalid', 'Invalid runtime case document, scene or instance dependency.')];
  }
}
