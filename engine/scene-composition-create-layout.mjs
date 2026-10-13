// Initial placement is an editor convenience. It plans positions only; the
// creation planner and Rust still validate the complete authored recipe.
import { SCENE_COMPOSITION_CREATE_MAX_ACTORS } from './scene-composition-create.mjs';

const invalid = () => { throw Object.assign(new TypeError('Invalid composition creation layout.'), { errorCode: 'composition_layout_invalid' }); };
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const coordinate = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100000;
const pair = value => Array.isArray(value) && value.length === 2 && value.every(coordinate);
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
}
// Copy data descriptors before consulting nested values. No authored accessor,
// serializer, sparse entry or unbounded collection participates in planning.
function capture(input) {
  let nodes = 0;
  const seen = new Set();
  const copy = (value, depth = 0) => {
    if (++nodes > 1024 || depth > 4) invalid();
    if (typeof value === 'string') { if (value.length > 64) invalid(); return value; }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || seen.has(value)) invalid();
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) invalid();
    const length = array ? Object.getOwnPropertyDescriptor(value, 'length')?.value : 0;
    if (array && (!Number.isSafeInteger(length) || length < 0 || length > SCENE_COMPOSITION_CREATE_MAX_ACTORS)) invalid();
    const names = Reflect.ownKeys(value);
    if (array ? names.length !== length + 1 : names.length > 4) invalid();
    const descriptors = new Map();
    for (const key of names) {
      if (typeof key !== 'string' || reserved.has(key)) invalid();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !(array && key === 'length') && !descriptor.enumerable) invalid();
      descriptors.set(key, descriptor);
    }
    seen.add(value);
    let result;
    if (array) {
      result = [];
      for (let index = 0; index < length; index++) {
        if (!descriptors.has(String(index))) invalid();
        result.push(copy(descriptors.get(String(index)).value, depth + 1));
      }
    } else {
      result = {};
      for (const key of names) result[key] = copy(descriptors.get(key).value, depth + 1);
    }
    seen.delete(value); return result;
  };
  return copy(input);
}
export function planCompositionCreateLayout(inputActors, inputSettings) {
  let actors, settings;
  try { actors = capture(inputActors); settings = capture(inputSettings); } catch { invalid(); }
  if (!Array.isArray(actors) || actors.length < 1 || actors.length > SCENE_COMPOSITION_CREATE_MAX_ACTORS) invalid();
  exact(settings, ['mode', 'origin', 'spacing', 'columns']);
  if (!['row', 'column', 'grid'].includes(settings.mode) || !pair(settings.origin) || !pair(settings.spacing)
    || settings.spacing.some(value => value <= 0) || !Number.isSafeInteger(settings.columns) || settings.columns < 1
    || settings.columns > SCENE_COMPOSITION_CREATE_MAX_ACTORS) invalid();
  const identities = new Set();
  for (const actor of actors) {
    exact(actor, ['instanceId', 'position']);
    if (!uuid(actor.instanceId) || identities.has(actor.instanceId) || !pair(actor.position)) invalid();
    identities.add(actor.instanceId);
  }
  let changedCount = 0;
  const positions = actors.map((actor, index) => {
    const column = settings.mode === 'column' ? 0 : settings.mode === 'row' ? index : index % settings.columns;
    const row = settings.mode === 'row' ? 0 : settings.mode === 'column' ? index : Math.floor(index / settings.columns);
    const position = [settings.origin[0] + column * settings.spacing[0], settings.origin[1] + row * settings.spacing[1]];
    if (!pair(position)) invalid();
    if (position.some((value, axis) => value !== actor.position[axis])) changedCount++;
    return Object.freeze({ instanceId: actor.instanceId, position: Object.freeze(position) });
  });
  return Object.freeze({ positions: Object.freeze(positions), changedCount });
}
