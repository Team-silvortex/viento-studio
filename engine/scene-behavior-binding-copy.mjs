// Portable form-draft copying only. The owner supplies identities and catalogs;
// ordinary behavior inspection, review, draft application and Save stay separate.
import { SCENE_BEHAVIOR_LIMITS } from './scene-behaviors.mjs';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const TYPES = new Set(['string', 'number', 'boolean']);
const invalid = () => { throw Object.assign(new TypeError('Expected an existing behavior draft and an explicit, available copy target.'), {
  errorCode: 'scene_behavior_binding_copy_invalid',
}); };
const uuid = value => typeof value === 'string' && UUID.test(value);
function record(input, expected) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== expected.length || keys.some(key => typeof key !== 'string' || !expected.includes(key))) invalid();
  const output = {};
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    Object.defineProperty(output, key, { value: descriptor.value, enumerable: true });
  }
  return output;
}
function list(input, maximum, minimum = 0) {
  if (!Array.isArray(input) || ![Array.prototype, null].includes(Object.getPrototypeOf(input))) invalid();
  const size = Object.getOwnPropertyDescriptor(input, 'length')?.value;
  if (!Number.isSafeInteger(size) || size < minimum || size > maximum) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== size + 1) invalid();
  const output = [];
  for (let index = 0; index < size; index++) {
    const descriptor = descriptors[index];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    output.push(descriptor.value);
  }
  return output;
}
function text(input, maximum = 4096) {
  // Invalid and unfinished field values remain editable. Bound their structure
  // without treating this convenience action as semantic validation.
  if (typeof input !== 'string' || input.length > maximum) invalid();
  for (const character of input) {
    const code = character.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) invalid();
  }
  return input;
}
function draft(input) {
  const value = record(input, ['bindingId', 'instanceId', 'sourceObjectId', 'parameters', 'events']);
  if (!uuid(value.bindingId) || !uuid(value.instanceId) || !uuid(value.sourceObjectId)) invalid();
  const parameters = list(value.parameters, SCENE_BEHAVIOR_LIMITS.parameters).map(item => {
    const parameter = record(item, ['key', 'type', 'value']);
    if (!TYPES.has(parameter.type)) invalid();
    return { key: text(parameter.key), type: parameter.type, value: text(parameter.value, SCENE_BEHAVIOR_LIMITS.manifestBytes) };
  });
  const events = list(value.events, SCENE_BEHAVIOR_LIMITS.events).map(item => {
    const event = record(item, ['signal', 'event']);
    return { signal: text(event.signal), event: text(event.event) };
  });
  return { bindingId: value.bindingId, instanceId: value.instanceId, sourceObjectId: value.sourceObjectId, parameters, events };
}

export function proposeSceneBehaviorBindingCopy(input) {
  const value = record(input, ['bindings', 'sourceBindingId', 'targetInstanceId', 'bindingId', 'instances', 'sourceObjectIds']);
  if (!uuid(value.sourceBindingId) || !uuid(value.targetInstanceId) || !uuid(value.bindingId)) invalid();
  const bindings = list(value.bindings, SCENE_BEHAVIOR_LIMITS.bindings, 1).map(draft);
  if (bindings.length >= SCENE_BEHAVIOR_LIMITS.bindings) invalid();
  const bindingIds = new Set(bindings.map(item => item.bindingId));
  if (bindingIds.size !== bindings.length || bindingIds.has(value.bindingId)) invalid();
  const source = bindings.find(item => item.bindingId === value.sourceBindingId);
  if (!source) invalid();
  const instances = list(value.instances, 128, 1).map(item => {
    const instance = record(item, ['instanceId', 'objectId', 'name']);
    if (!uuid(instance.instanceId) || !uuid(instance.objectId)) invalid();
    text(instance.name); return instance.instanceId;
  });
  if (new Set(instances).size !== instances.length || !instances.includes(value.targetInstanceId)
    || !instances.includes(source.instanceId)) invalid();
  const sources = list(value.sourceObjectIds, 256, 1);
  if (sources.some(item => !uuid(item)) || new Set(sources).size !== sources.length || !sources.includes(source.sourceObjectId)) invalid();
  // IDs inside parameters are ordinary authored text, never guessed references.
  return { ...source, bindingId: value.bindingId, instanceId: value.targetInstanceId };
}
