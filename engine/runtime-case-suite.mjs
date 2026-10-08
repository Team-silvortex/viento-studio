// Suites order existing author case documents; they introduce no run protocol
// and never simulate movement or select an execution backend.
import { parseJsonSource } from './json-source.mjs';
import { inspectRuntimeCaseDocument, validateRuntimeCaseDocument, validateRuntimeCaseDocumentPlan,
  validateRuntimeCaseDocumentDependencies, validateRuntimeCaseSceneDependencies } from './runtime-case-document.mjs';

import { RUNTIME_CASE_SUITE_FORMAT, RUNTIME_CASE_SUITE_FILE_MAX_BYTES, RUNTIME_CASE_SUITE_DOCUMENT_MAX_COUNT,
  RUNTIME_CASE_SUITE_ACTOR_STEP_LIMIT, RUNTIME_CASE_SUITE_CHECK_LIMIT, validateRuntimeCaseSuite,
  _suiteFields as fields, _suiteDense as dense, _suiteError as error, _suiteUuid as uuid } from './runtime-case-suite-contract.mjs';
export { RUNTIME_CASE_SUITE_FORMAT, RUNTIME_CASE_SUITE_FILE_MAX_BYTES, RUNTIME_CASE_SUITE_DOCUMENT_MAX_COUNT,
  RUNTIME_CASE_SUITE_ACTOR_STEP_LIMIT, RUNTIME_CASE_SUITE_CHECK_LIMIT, validateRuntimeCaseSuite,
  summarizeRuntimeCaseSuite } from './runtime-case-suite-contract.mjs';

const has = (value, key) => Object.hasOwn(value, key);
const issue = (code, message, propertyPath = '', details = {}) => ({ severity: 'error', code, message, propertyPath, ...details });

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

// Decode only bounded top-level marker tokens. Nested examples stay ordinary;
// a complete marker with an unfinished body or missing final quote fails closed.
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
        if (cursor - valueStart <= 256) {
          const token = content[cursor] === '"' ? content.slice(valueStart, cursor + 1)
            : content.slice(valueStart, cursor) + '"';
          if (JSON.parse(token) === RUNTIME_CASE_SUITE_FORMAT) return true;
        }
      } catch { /* The strict parser diagnoses incomplete declarations. */ }
    } else if (character === '{' || character === '[') { depth++; if (depth === 1) keyExpected = true; }
    else if (character === '}' || character === ']') { if (--depth <= 0) break; }
    else if (character === ',' && depth === 1) keyExpected = true;
  }
  return false;
}

export function inspectRuntimeCaseSuite(content) {
  if (typeof content !== 'string' || !hasMarker(content)) return { recognized: false, ok: true, value: null, diagnostics: [] };
  const failure = diagnostics => ({ recognized: true, ok: false, value: null, diagnostics });
  if (content.length > RUNTIME_CASE_SUITE_FILE_MAX_BYTES || utf8Length(content) > RUNTIME_CASE_SUITE_FILE_MAX_BYTES) {
    return failure([issue('runtime_suite_limit', 'A runtime case suite requires valid UTF-8 and at most 16 KiB.')]);
  }
  const parsed = parseJsonSource(content);
  if (!parsed.ok) return failure(parsed.diagnostics.map(item => issue('runtime_suite_invalid', item.message, item.propertyPath)));
  try { return { recognized: true, ok: true, value: validateRuntimeCaseSuite(parsed.value), diagnostics: [] }; }
  catch (caught) { return failure([issue(caught.errorCode || 'runtime_suite_invalid', 'Invalid finite runtime case suite.')]); }
}

export function runtimeCaseSuiteDocumentIds(input) {
  const value = validateRuntimeCaseSuite(input);
  return [value.sceneObjectId, ...value.documentIds];
}

export function validateRuntimeCaseSuitePlan(plan, input, members) {
  const value = validateRuntimeCaseSuite(input), entries = dense(members, RUNTIME_CASE_SUITE_DOCUMENT_MAX_COUNT, 1);
  if (entries.length.value !== value.documentIds.length) throw error();
  if (fields(fields(plan).scene?.value).objectId?.value !== value.sceneObjectId) throw error('runtime_suite_scene_mismatch');
  const documents = [];
  for (let index = 0; index < entries.length.value; index++) {
    const entry = fields(entries[index].value);
    if (Reflect.ownKeys(entry).length !== 2 || !has(entry, 'documentId') || !has(entry, 'document')
      || entry.documentId.value !== value.documentIds[index]) throw error();
    const document = validateRuntimeCaseDocument(entry.document.value);
    if (document.sceneObjectId !== value.sceneObjectId) throw error('runtime_suite_scene_mismatch');
    validateRuntimeCaseDocumentPlan(plan, document);
    documents.push(document);
  }
  // The old document/plan admission checks each case independently. Only this
  // aggregate workload is new; no engine movement model is duplicated here.
  const actors = dense(fields(plan).actors.value, 128, 1).length.value;
  const steps = documents.reduce((sum, document) => sum + document.case.program.steps.length, 0);
  const checks = documents.reduce((sum, document) => sum + document.case.checks.length, 0);
  if (actors * steps > RUNTIME_CASE_SUITE_ACTOR_STEP_LIMIT || checks > RUNTIME_CASE_SUITE_CHECK_LIMIT) throw error('runtime_suite_limit');
  return value;
}

export function validateRuntimeCaseSuiteDependencies(input, record = {}, source = {}) {
  try {
    const value = validateRuntimeCaseSuite(input), registered = fields(record), snapshot = fields(source);
    const ownId = registered.id?.value, sourcePath = registered.sourcePath?.value;
    if (registered.format?.value !== 'viento-document' || typeof sourcePath !== 'string' || !sourcePath.toLowerCase().endsWith('.json')
      || ownId != null && (!uuid(ownId) || ownId === value.sceneObjectId || value.documentIds.includes(ownId))) throw error();
    const entries = dense(snapshot.documents?.value || [], 200000), documents = new Map();
    for (let index = 0; index < entries.length.value; index++) {
      const item = fields(entries[index].value), registration = item.record?.value;
      if (!registration) continue;
      const registrationFields = fields(registration), id = registrationFields.id?.value;
      if (!uuid(id) || documents.has(id)) throw error();
      documents.set(id, { item, registrationFields, registration });
    }
    const requireDocument = id => {
      const result = documents.get(id), registeredPath = result?.registrationFields.sourcePath?.value;
      if (!result || result.registrationFields.format?.value !== 'viento-document' || typeof registeredPath !== 'string'
        || !registeredPath.toLowerCase().endsWith('.json') || result.item.sourcePath && result.item.sourcePath.value !== registeredPath) throw error();
      return result;
    };
    requireDocument(value.sceneObjectId);
    const scene = validateRuntimeCaseSceneDependencies(value.sceneObjectId, source);
    // Only actual absent registered bodies may defer. A malformed available
    // scene must be rejected even if every member is a declared requirement.
    if (scene.diagnostics.some(item => item.code !== 'runtime_case_dependency_unavailable')) return scene.diagnostics;
    const diagnostics = [], members = [];
    for (const [index, id] of value.documentIds.entries()) {
      const member = requireDocument(id), content = member.item.content?.value;
      if (typeof content !== 'string') {
        diagnostics.push(issue('runtime_suite_dependency_unavailable', 'The registered suite member source is unavailable.',
          `/documentIds/${index}`, { relatedObjectId: id }));
        continue;
      }
      const inspected = inspectRuntimeCaseDocument(content);
      if (!inspected.recognized || !inspected.ok) throw error();
      if (inspected.value.sceneObjectId !== value.sceneObjectId) throw error('runtime_suite_scene_mismatch');
      members.push({ documentId: id, document: inspected.value });
      diagnostics.push(...validateRuntimeCaseDocumentDependencies(inspected.value, member.registration, source)
        .map(item => ({ ...item, propertyPath: `/documentIds/${index}${item.propertyPath || ''}` })));
    }
    if (!members.length) diagnostics.push(...scene.diagnostics);
    if (members.length === value.documentIds.length && scene.plan) validateRuntimeCaseSuitePlan(scene.plan, value, members);
    return diagnostics;
  } catch (caught) {
    return [issue(caught.errorCode || 'runtime_suite_invalid', 'Invalid runtime case suite, member or scene dependency.')];
  }
}
