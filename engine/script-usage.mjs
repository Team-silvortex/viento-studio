// Saved registered references only. This directory is neither a code scanner
// nor deletion permission; snapshots and navigation intents grant no writes.
import { inspectSceneBehaviors } from './scene-behaviors.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { normalizeSourcePath } from './source-path.mjs';

export const SCRIPT_USAGE_API_PATH = '/api/script-usage';
export const SCRIPT_USAGE_LIMITS = Object.freeze({ scriptBytes: 131072, documentBytes: 131072, references: 128, relationKinds: 32, responseBytes: 2097152 });
const sourceKeys = ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content'];
const identityKeys = ['objectId', 'sourcePath', 'sourceRevision'];
const catalogs = new WeakMap(), sources = new WeakMap(), snapshots = new WeakMap(), intents = new WeakSet();
const fail = (kind = 'invalid') => { throw Object.assign(new TypeError('Invalid or oversized saved script usage data.'), { errorCode: `script_usage_${kind}` }); };
const matches = (expression, value) => typeof value === 'string' && expression.exec(value)?.[0] === value;
const uuid = value => matches(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, value);
const revision = value => matches(/^sha256:[a-f0-9]{64}$/, value);
const text = (value, maximum, empty = false) => typeof value === 'string' && (empty || value.length > 0) && value.length <= maximum
  && [...value].every(character => { const code = character.codePointAt(0); return code < 0xd800 || code > 0xdfff; });
const path = value => text(value, 4096) && !/[\u0000-\u001f\u007f]/.test(value) && normalizeSourcePath(value) === value && !/^[A-Za-z]:/.test(value);
const txt = value => path(value) && value.toLowerCase().endsWith('.txt');
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function record(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail();
  const properties = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(properties);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))
    || fields.some(key => !properties[key]?.enumerable || !Object.hasOwn(properties[key], 'value'))) fail();
  return Object.fromEntries(fields.map(key => [key, properties[key].value]));
}
function list(input, maximum) {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) fail();
  if (input.length > maximum) fail('limit');
  const properties = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(properties).length !== input.length + 1) fail();
  return Array.from({ length: input.length }, (_, index) => {
    const property = properties[index]; if (!property?.enumerable || !Object.hasOwn(property, 'value')) fail(); return property.value;
  });
}
function boundedContent(value, maximum) {
  if (typeof value !== 'string') fail();
  if (value.length > maximum) fail('limit');
  if (!text(value, maximum, true)) fail();
  if (new TextEncoder().encode(value).length > maximum) fail('limit');
}
function identity(input) {
  const value = record(input, identityKeys);
  if (!uuid(value.objectId) || !path(value.sourcePath) || !revision(value.sourceRevision)) fail();
  return value;
}
function directory(raw, expectedSourcePath) {
  if (!txt(expectedSourcePath)) fail();
  const value = record(raw, ['format', 'schemaVersion', 'worldId', 'revision', 'script', 'references']);
  if (value.format !== 'viento-script-usage' || value.schemaVersion !== 1 || !matches(/^world:[a-f0-9]{64}$/, value.worldId) || !revision(value.revision)) fail();
  value.script = identity(value.script);
  if (value.script.sourcePath !== expectedSourcePath) fail();
  const ids = new Set(), paths = new Set();
  value.references = list(value.references, SCRIPT_USAGE_LIMITS.references).map(input => {
    const row = record(input, [...identityKeys, 'relationKinds', 'content']);
    if (!uuid(row.objectId) || !path(row.sourcePath) || ids.has(row.objectId) || paths.has(row.sourcePath)) fail();
    if (row.objectId === value.script.objectId || row.sourcePath === value.script.sourcePath) {
      if (!identityKeys.every(key => row[key] === value.script[key])) fail();
    }
    ids.add(row.objectId); paths.add(row.sourcePath);
    row.relationKinds = list(row.relationKinds, SCRIPT_USAGE_LIMITS.relationKinds);
    if (!row.relationKinds.length || row.relationKinds.some(kind => !text(kind, 256) || !kind.trim() || kind === 'part-of' || /[\u0000-\u001f\u007f]/.test(kind))
      || new Set(row.relationKinds).size !== row.relationKinds.length || row.relationKinds.some((kind, index) => index > 0 && kind <= row.relationKinds[index - 1])) fail();
    if (row.content === null) { if (row.sourceRevision !== null) fail(); }
    else { if (!revision(row.sourceRevision)) fail(); boundedContent(row.content, SCRIPT_USAGE_LIMITS.documentBytes); }
    return row;
  });
  // Serialize only captured own data; inherited serializers cannot manufacture
  // a smaller transport body or execute while checking the complete budget.
  if (Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') || Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')) fail();
  if (new TextEncoder().encode(JSON.stringify(value)).length > SCRIPT_USAGE_LIMITS.responseBytes) fail('limit');
  return freeze(value);
}
function source(input) {
  const value = record(input, sourceKeys);
  if (!txt(value.sourcePath) || !text(value.token, 256) || !revision(value.baseSourceRevision) || !revision(value.sourceRevision)) fail();
  boundedContent(value.content, SCRIPT_USAGE_LIMITS.scriptBytes);
  return Object.freeze(value);
}
export function captureScriptUsageDirectory(raw, expectedSourcePath) { return directory(raw, expectedSourcePath); }
// The shared behavior inspector remains the schema authority. At this DTO
// boundary identifiers must also match in full, including final line breaks.
function exactBehaviorIdentifiers(model) {
  const name = value => matches(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, value);
  return uuid(model.sceneObjectId) && model.bindings.every(binding => uuid(binding.bindingId) && uuid(binding.instanceId)
    && uuid(binding.implementation.sourceObjectId) && matches(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/, binding.implementation.backendId)
    && matches(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/, binding.implementation.language)
    && Object.keys(binding.parameters).every(name) && binding.events.every(event => name(event.signal) && name(event.event)));
}
export function captureScriptUsage(inputSource, raw) {
  const captured = source(inputSource), value = directory(raw, captured.sourcePath);
  if (captured.baseSourceRevision !== value.script.sourceRevision) fail();
  const saved = new Map(), allMatches = [];
  const references = value.references.map(document => {
    const { content, ...row } = document;
    row.status = 'unavailable'; row.bindings = [];
    let parsed = null;
    if (content !== null) {
      const checked = inspectSceneBehaviors(content);
      if (checked.recognized) {
        const usable = checked.ok && exactBehaviorIdentifiers(checked.value);
        row.status = usable ? 'unbound' : 'invalid-behavior';
        if (usable) {
          parsed = parseJsonSource(content); if (!parsed.ok || parsed.ambiguous) fail();
          checked.value.bindings.forEach((binding, index) => {
            if (binding.implementation.sourceObjectId !== value.script.objectId) return;
            const propertyPath = `/bindings/${index}`;
            if (!locateJsonSource(parsed, propertyPath)?.exact) fail();
            const match = { documentObjectId: row.objectId, sceneObjectId: checked.value.sceneObjectId, bindingId: binding.bindingId, instanceId: binding.instanceId,
              backendId: binding.implementation.backendId, language: binding.implementation.language, parameters: binding.parameters, propertyPath };
            row.bindings.push(match); allMatches.push(match);
          });
          if (row.bindings.length) row.status = 'bound';
        }
      } else {
        // A malformed registered JSON reference is explicit, even if its partial
        // bytes no longer contain enough of the behavior marker to recognize it.
        row.status = row.sourcePath.toLowerCase().endsWith('.json') && !parseJsonSource(content).ok ? 'invalid-json' : 'non-behavior';
      }
    }
    saved.set(row, { document, parsed }); return row;
  });
  const catalog = freeze({ worldId: value.worldId, revision: value.revision, scope: 'saved-registered-references', script: value.script, references, matches: allMatches });
  catalogs.set(catalog, captured); sources.set(catalog, saved); return catalog;
}
export function isScriptUsage(value) { return Boolean(value && typeof value === 'object' && catalogs.has(value)); }
export function scriptUsageMatchSource(catalog, inputSource) {
  if (!isScriptUsage(catalog)) return false;
  try { const captured = source(inputSource), original = catalogs.get(catalog); return sourceKeys.every(key => captured[key] === original[key]); } catch { return false; }
}
export function scriptUsageSource(catalog, reference, match = null) {
  const saved = isScriptUsage(catalog) && sources.get(catalog).get(reference);
  if (!saved || saved.document.content === null || match !== null && !reference.bindings.includes(match)) fail();
  const propertyPath = match?.propertyPath || '', sourceRange = match ? locateJsonSource(saved.parsed, propertyPath)
    : { start: 0, end: saved.document.content.length, encoding: 'utf-16', propertyPath: '', exact: true };
  if (!sourceRange?.exact) fail();
  const result = freeze({ objectId: saved.document.objectId, sourcePath: saved.document.sourcePath, sourceRevision: saved.document.sourceRevision,
    content: saved.document.content, propertyPath, sourceRange });
  snapshots.set(result, catalog); return result;
}
export function isScriptUsageSource(value) { return Boolean(value && typeof value === 'object' && snapshots.has(value)); }
export function createScriptUsageOpenSourceRequest(catalog, snapshot) {
  if (!isScriptUsage(catalog) || !isScriptUsageSource(snapshot) || snapshots.get(snapshot) !== catalog) fail();
  const request = Object.freeze({ kind: 'script-usage-open-source', catalog, source: snapshot }); intents.add(request); return request;
}
export function isScriptUsageOpenSourceRequest(value) { return Boolean(value && typeof value === 'object' && intents.has(value)); }
export function scriptUsageOpenSourceMatchSource(request, inputSource) {
  return isScriptUsageOpenSourceRequest(request) && scriptUsageMatchSource(request.catalog, inputSource);
}
