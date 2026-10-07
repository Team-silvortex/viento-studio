// Portable, declarative behavior bindings. Source bytes are observed data;
// only a trusted execution adapter may later interpret an approved source.
import { parseJsonSource, locateJsonSource } from './json-source.mjs';

export const SCENE_BEHAVIOR_LIMITS = Object.freeze({ manifestBytes: 32768, bindings: 32,
  parameters: 32, events: 8, sources: 8, sourceBytes: 65536, totalSourceBytes: 524288 });
const FORMAT = 'viento-scene-behaviors';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const LANGUAGE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const BACKEND = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;
const RESERVED = new Set(['constructor', '__proto__', 'prototype']);
const pointer = key => key.replaceAll('~', '~0').replaceAll('/', '~1');
const issue = (code, message, propertyPath = '', details = {}) => ({ severity: 'error', code, message, propertyPath, ...details });
const invalid = (message, propertyPath = '') => issue('build_behavior_invalid', message, propertyPath);
const uuid = value => typeof value === 'string' && UUID.test(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

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

// Identify partial top-level declarations without parsing an oversized body.
// Keys/values are decoded only when their bounded token can be the marker.
function hasMarker(content) {
  let depth = 0, keyExpected = false;
  if (!/^\uFEFF?\s*\{/.test(content)) return false;
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
      let key;
      try { key = JSON.parse(content.slice(start, index + 1)); } catch { continue; }
      if (key !== 'format') continue;
      let cursor = index + 1;
      while (/\s/.test(content[cursor] || '') && cursor < content.length) cursor++;
      if (content[cursor++] !== ':') continue;
      while (/\s/.test(content[cursor] || '') && cursor < content.length) cursor++;
      if (content[cursor] !== '"') continue;
      const valueStart = cursor++;
      for (; cursor < content.length && cursor - valueStart <= 256; cursor++) {
        if (content[cursor] === '\\') cursor++;
        else if (content[cursor] === '"') break;
      }
      try { if (cursor - valueStart <= 256 && content[cursor] === '"' && JSON.parse(content.slice(valueStart, cursor + 1)) === FORMAT) return true; } catch { /* Partial marker. */ }
    } else if (character === '{' || character === '[') { depth++; if (depth === 1) keyExpected = true; }
    else if (character === '}' || character === ']') { if (--depth <= 0) break; }
    else if (character === ',' && depth === 1) keyExpected = true;
  }
  return false;
}

function safeData(value, depth = 0, budget = { nodes: 0, textBytes: 0 }) {
  if (++budget.nodes > 4096 || depth > 12) throw new TypeError('Behavior declaration exceeds data limits.');
  if (typeof value === 'string' && value.length > 32768) throw new TypeError('Behavior text exceeds data limits.');
  if (typeof value === 'string' && (budget.textBytes += utf8Length(value)) > 32768) throw new TypeError('Behavior text exceeds data limits.');
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return value;
  if (!value || typeof value !== 'object') throw new TypeError('Expected serializable behavior data.');
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) throw new TypeError('Expected plain behavior data.');
  const output = array ? [] : {}, descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string')) throw new TypeError('Symbol fields are unsupported.');
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (array && key === 'length') continue;
    if (key.length > 192 || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || array && !/^(0|[1-9][0-9]*)$/.test(key)) throw new TypeError('Expected bounded enumerable data fields.');
    if ((budget.textBytes += utf8Length(key)) > 32768) throw new TypeError('Behavior text exceeds data limits.');
    Object.defineProperty(output, key, { value: safeData(descriptor.value, depth + 1, budget), enumerable: true, writable: true, configurable: true });
  }
  if (array && (output.length !== value.length || Object.keys(output).length !== value.length)) throw new TypeError('Sparse arrays are unsupported.');
  return output;
}

function validateValue(input) {
  let value;
  try { value = safeData(input); } catch (error) { return { value: null, diagnostics: [invalid(error.message)] }; }
  const diagnostics = [];
  const keys = (value, expected, at) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { diagnostics.push(invalid('Expected a behavior data object.', at)); return false; }
    for (const key of Object.keys(value)) if (!expected.includes(key)) diagnostics.push(invalid(`Unknown behavior field: ${key}`, `${at}/${pointer(key)}`));
    for (const key of expected) if (!Object.hasOwn(value, key)) diagnostics.push(invalid(`Missing behavior field: ${key}`, `${at}/${key}`));
    return true;
  };
  if (!keys(value, ['format', 'schemaVersion', 'sceneObjectId', 'bindings'], '')) return { value: null, diagnostics };
  if (value.format !== FORMAT) diagnostics.push(invalid('Expected viento-scene-behaviors.', '/format'));
  if (value.schemaVersion !== 1) diagnostics.push(invalid('Expected behavior schemaVersion 1.', '/schemaVersion'));
  if (!uuid(value.sceneObjectId)) diagnostics.push(invalid('The scene requires a registered lowercase UUID.', '/sceneObjectId'));
  if (!Array.isArray(value.bindings) || value.bindings.length < 1 || value.bindings.length > 32) {
    diagnostics.push(invalid('A behavior declaration requires 1–32 bindings.', '/bindings')); return { value: null, diagnostics };
  }
  const ids = new Set(), sourceIds = new Set(); let backend = null, language = null;
  for (const [index, binding] of value.bindings.entries()) {
    const at = `/bindings/${index}`;
    if (!keys(binding, ['bindingId', 'instanceId', 'implementation', 'parameters', 'events'], at)) continue;
    if (!uuid(binding.bindingId) || ids.has(binding.bindingId)) diagnostics.push(invalid('Binding identities must be unique lowercase UUIDs.', `${at}/bindingId`));
    ids.add(binding.bindingId);
    if (!uuid(binding.instanceId)) diagnostics.push(invalid('A binding requires a scene instance UUID.', `${at}/instanceId`));
    if (keys(binding.implementation, ['backendId', 'language', 'sourceObjectId'], `${at}/implementation`)) {
      const implementation = binding.implementation;
      if (typeof implementation.backendId !== 'string' || implementation.backendId.length > 192 || !BACKEND.test(implementation.backendId)) diagnostics.push(invalid('Use a namespaced execution backend identifier.', `${at}/implementation/backendId`));
      if (typeof implementation.language !== 'string' || implementation.language.length > 64 || !LANGUAGE.test(implementation.language)) diagnostics.push(invalid('Use a lowercase language identifier.', `${at}/implementation/language`));
      if (!uuid(implementation.sourceObjectId)) diagnostics.push(invalid('Behavior source requires a registered document UUID.', `${at}/implementation/sourceObjectId`));
      if (backend !== null && backend !== implementation.backendId || language !== null && language !== implementation.language) diagnostics.push(invalid('A manifest declares one execution backend and language.', `${at}/implementation`));
      backend ??= implementation.backendId; language ??= implementation.language; sourceIds.add(implementation.sourceObjectId);
    }
    if (!binding.parameters || typeof binding.parameters !== 'object' || Array.isArray(binding.parameters) || Object.keys(binding.parameters).length > 32) diagnostics.push(invalid('Parameters require at most 32 named scalar values.', `${at}/parameters`));
    else for (const [key, scalar] of Object.entries(binding.parameters)) {
      if (RESERVED.has(key)) { diagnostics.push(invalid('This parameter name is reserved by the behavior protocol.', `${at}/parameters/${pointer(key)}`)); continue; }
      if (!NAME.test(key) || !['boolean', 'number', 'string'].includes(typeof scalar)
        || typeof scalar === 'number' && (!Number.isFinite(scalar) || Number.isInteger(scalar) && !Number.isSafeInteger(scalar))
        || typeof scalar === 'string' && (scalar.length > 4096 || utf8Length(scalar) === Infinity)) diagnostics.push(invalid('Use an identifier and a bounded boolean, finite number or text parameter.', `${at}/parameters/${pointer(key)}`));
    }
    if (!Array.isArray(binding.events) || binding.events.length > 8) diagnostics.push(invalid('Declare at most 8 signal events per binding.', `${at}/events`));
    else { const signals = new Set(); for (const [eventIndex, event] of binding.events.entries()) {
      const eventPath = `${at}/events/${eventIndex}`;
      if (!keys(event, ['signal', 'event'], eventPath)) continue;
      for (const key of ['signal', 'event']) if (typeof event[key] !== 'string' || !NAME.test(event[key])) diagnostics.push(invalid('Use an ASCII signal/event identifier.', `${eventPath}/${key}`));
      if (signals.has(event.signal)) diagnostics.push(invalid('Each binding connects a signal only once.', `${eventPath}/signal`)); signals.add(event.signal);
    } }
  }
  if (sourceIds.size > 8) diagnostics.push(invalid('A manifest references at most 8 source documents.', '/bindings'));
  if (!diagnostics.length && utf8Length(JSON.stringify(value)) > 32768) diagnostics.push(invalid('A behavior manifest requires at most 32 KiB.'));
  return { value: diagnostics.length ? null : freeze(value), diagnostics };
}

export function inspectSceneBehaviors(content) {
  const ordinary = { recognized: false, ok: true, value: null, diagnostics: [] };
  if (typeof content !== 'string' || !hasMarker(content)) return ordinary;
  if (content.length > 32768 || utf8Length(content) > 32768) return { recognized: true, ok: false, value: null,
    diagnostics: [invalid('A behavior manifest requires valid UTF-8 and at most 32 KiB.')] };
  const parsed = parseJsonSource(content);
  if (!parsed.ok) return { recognized: true, ok: false, value: null, diagnostics: parsed.diagnostics.map(item => invalid(item.message, item.propertyPath)) };
  const validated = validateValue(parsed.value);
  return { recognized: true, ok: validated.diagnostics.length === 0, ...validated };
}

export function sceneBehaviorDocumentIds(value) {
  return [...new Set([value.sceneObjectId, ...value.bindings.map(binding => binding.implementation.sourceObjectId)])].sort();
}

export function validateSceneBehaviorDependencies(input, record = {}, { documents = [] } = {}) {
  const checked = validateValue(input);
  if (checked.diagnostics.length) return checked.diagnostics;
  const value = checked.value, diagnostics = [], byId = new Map(documents.map(document => [document.record?.id, document]));
  const link = (id, at) => {
    if (!record.relations?.some(relation => typeof relation.kind === 'string' && relation.kind !== 'part-of' && relation.targetId === id)) diagnostics.push(issue('build_behavior_unlinked',
      'Register a reference from the behavior manifest to this dependency.', at, { relatedObjectId: id }));
  };
  const scene = byId.get(value.sceneObjectId); link(value.sceneObjectId, '/sceneObjectId');
  let instances = null;
  if (value.sceneObjectId === record.id || !scene || scene.record?.format !== 'viento-document') diagnostics.push(issue('build_behavior_scene_invalid', 'Select another registered Scene2D document.', '/sceneObjectId', { relatedObjectId: value.sceneObjectId }));
  else if (typeof scene.content !== 'string') diagnostics.push(issue('build_behavior_dependency_unavailable', 'The registered scene source is unavailable.', '/sceneObjectId', { relatedObjectId: value.sceneObjectId }));
  else {
    const parsed = parseJsonSource(scene.content);
    if (typeof scene.record.sourcePath !== 'string' || !scene.record.sourcePath.toLowerCase().endsWith('.json')
      || scene.sourcePath && scene.sourcePath !== scene.record.sourcePath || !parsed.ok || parsed.value?.format !== 'viento-scene2d'
      || ![2, 3].includes(parsed.value.schemaVersion) || !Array.isArray(parsed.value.actors) || parsed.value.actors.length < 1 || parsed.value.actors.length > 128
      || parsed.value.actors.some(actor => !uuid(actor?.instanceId) || !uuid(actor?.objectId)) || new Set(parsed.value.actors.map(actor => actor.instanceId)).size !== parsed.value.actors.length) {
      diagnostics.push(issue('build_behavior_scene_invalid', 'Behaviors require an unambiguous Scene2D schemaVersion 2 or 3 with registered instances.', '/sceneObjectId', { relatedObjectId: value.sceneObjectId }));
    } else instances = new Map(parsed.value.actors.map(actor => [actor.instanceId, actor.objectId]));
  }
  let total = 0; const sources = new Set();
  for (const [index, binding] of value.bindings.entries()) {
    const id = binding.implementation.sourceObjectId, at = `/bindings/${index}`;
    if (instances && !instances.has(binding.instanceId)) diagnostics.push(issue('build_behavior_instance_missing', 'The bound instance does not belong to the declared scene.', `${at}/instanceId`, { instanceId: binding.instanceId }));
    if (instances?.has(binding.instanceId)) {
      const objectId = instances.get(binding.instanceId), definition = byId.get(objectId), details = { relatedObjectId: objectId, instanceId: binding.instanceId };
      if (!definition || definition.record?.format !== 'viento-document' || objectId === value.sceneObjectId) diagnostics.push(issue('build_behavior_instance_missing',
        'The bound instance requires another registered actor definition.', `${at}/instanceId`, details));
      else if (typeof definition.content !== 'string') diagnostics.push(issue('build_behavior_dependency_unavailable',
        'The bound actor definition is unavailable.', `${at}/instanceId`, details));
      if (!scene.record.relations?.some(relation => relation.targetId === objectId)) diagnostics.push(issue('build_behavior_unlinked',
        'Register the scene-to-actor dependency so resource packages retain the bound definition.', `${at}/instanceId`, details));
    }
    if (sources.has(id)) continue; sources.add(id); link(id, `${at}/implementation/sourceObjectId`);
    const source = byId.get(id), details = { relatedObjectId: id };
    if (id === record.id || id === value.sceneObjectId || !source || source.record?.format !== 'viento-document'
      || typeof source.record.sourcePath !== 'string' || !source.record.sourcePath.toLowerCase().endsWith('.txt')
      || source.sourcePath && source.sourcePath !== source.record.sourcePath) diagnostics.push(issue('build_behavior_source_invalid', 'Behavior source must be another registered .txt document.', `${at}/implementation/sourceObjectId`, details));
    else if (typeof source.content !== 'string') diagnostics.push(issue('build_behavior_dependency_unavailable', 'The registered behavior source is unavailable.', `${at}/implementation/sourceObjectId`, details));
    else {
      const bytes = utf8Length(source.content); total += bytes;
      if (source.content.length > 65536 || bytes > 65536) diagnostics.push(issue('build_behavior_source_invalid', 'A behavior source requires valid UTF-8 and at most 64 KiB.', `${at}/implementation/sourceObjectId`, details));
    }
  }
  if (total > 524288) diagnostics.push(issue('build_behavior_source_invalid', 'The referenced behavior sources exceed 512 KiB.', '/bindings'));
  return diagnostics;
}

export function resolveSceneBehaviors(observed, plan) {
  const documents = observed?.source?.documents || [], scene = documents.find(document => document.record?.id === plan?.scene?.objectId);
  const result = (behaviors, diagnostics = []) => ({ ok: diagnostics.length === 0, behaviors: diagnostics.length ? null : behaviors, diagnostics });
  if (!scene) return result(null, [issue('build_behavior_scene_invalid', 'Select an available registered scene.')]);
  const selected = [];
  for (const relation of scene.record.relations || []) {
    if (relation.kind !== 'behavior') continue;
    const document = documents.find(item => item.record?.id === relation.targetId), checked = inspectSceneBehaviors(document?.content);
    if (checked.recognized) selected.push({ document, checked });
    else return result(null, [issue(!document || typeof document.content !== 'string' ? 'build_behavior_dependency_unavailable' : 'build_behavior_invalid',
      'The behavior relation requires an available behavior manifest.', '',
      { objectId: scene.record.id, sourcePath: scene.sourcePath, sourceRevision: scene.sourceRevision, relatedObjectId: relation.targetId })]);
  }
  if (!selected.length) return result(null);
  const parsedSources = new Map();
  const located = (document, diagnostic) => {
    // Budget failures must not rebuild a potentially enormous CST merely to
    // decorate an error. Valid bounded declarations share one source index.
    if (!parsedSources.has(document)) parsedSources.set(document, typeof document.content === 'string' && document.content.length <= 32768
      && utf8Length(document.content) <= 32768 ? parseJsonSource(document.content) : null);
    const parsed = parsedSources.get(document), range = parsed && locateJsonSource(parsed, diagnostic.propertyPath || '', { nearest: true });
    return { ...diagnostic, objectId: document.record.id, sourcePath: document.sourcePath, sourceRevision: document.sourceRevision,
      ...(range ? { sourceRange: range } : {}) };
  };
  if (selected.length > 1) return result(null, selected.map(({ document }) => located(document, issue('build_behavior_invalid', 'A scene opts into at most one behavior manifest.'))));
  const { document, checked } = selected[0], diagnostics = [...checked.diagnostics];
  if (document.record.format !== 'viento-document' || !(document.sourcePath || '').toLowerCase().endsWith('.json')
    || document.sourcePath !== document.record.sourcePath) diagnostics.push(invalid('A behavior manifest requires a registered .json document.'));
  if (checked.ok) {
    if (checked.value.sceneObjectId !== scene.record.id) diagnostics.push(issue('build_behavior_scene_invalid', 'The manifest must declare the scene that opted into it.', '/sceneObjectId', { relatedObjectId: checked.value.sceneObjectId }));
    diagnostics.push(...validateSceneBehaviorDependencies(checked.value, document.record, observed.source));
    const sceneValue = parseJsonSource(scene.content).value;
    for (const [index, binding] of checked.value.bindings.entries()) {
      const actor = plan.actors?.find(actor => actor.instanceId === binding.instanceId), declared = Array.isArray(sceneValue?.actors)
        ? sceneValue.actors.find(actor => actor?.instanceId === binding.instanceId) : null;
      if (!actor || actor.objectId !== declared?.objectId) diagnostics.push(issue('build_behavior_instance_missing', 'The frozen plan must contain the declared scene instance and object.', `/bindings/${index}/instanceId`, { instanceId: binding.instanceId }));
    }
  }
  if (diagnostics.length) return result(null, diagnostics.map(diagnostic => located(document, diagnostic)));
  const value = checked.value, sourceIds = [...new Set(value.bindings.map(binding => binding.implementation.sourceObjectId))].sort();
  const provenance = document => ({ objectId: document.record.id, sourcePath: document.sourcePath, sourceRevision: document.sourceRevision });
  const behaviors = { format: 'viento-behavior-plan', schemaVersion: 1,
    backendId: value.bindings[0].implementation.backendId, language: value.bindings[0].implementation.language,
    manifest: provenance(document), sources: sourceIds.map(id => {
      const source = documents.find(item => item.record?.id === id);
      return { ...provenance(source), language: value.bindings[0].implementation.language, content: source.content };
    }), bindings: value.bindings.map((binding, index) => ({ ...binding,
      objectId: plan.actors.find(actor => actor.instanceId === binding.instanceId).objectId,
      declaration: { ...provenance(document), propertyPath: `/bindings/${index}` } })) };
  return result(freeze(behaviors));
}
