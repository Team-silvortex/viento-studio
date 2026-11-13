// Read-only author composition evidence. This DTO is neither a build plan nor
// a promise that an assembly can execute; no runtime or author schema changes.
import { normalizeSourcePath } from './source-path.mjs';
export const SCENE_CAMERA2D_FRAMING_FORMAT = 'viento-camera2d-framing-context';
export const SCENE_CAMERA2D_FRAMING_ACTOR_LIMIT = 128;
export const SCENE_CAMERA2D_FRAMING_ASSEMBLY_LIMIT = 32;
export const SCENE_CAMERA2D_FRAMING_DIAGNOSTIC_LIMIT = 64;
const invalid = () => { throw Object.assign(new TypeError('Invalid camera composition context.'), { errorCode: 'scene_camera2d_framing_invalid' }); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const text = (value, max, empty = false) => typeof value === 'string' && (empty || value.length > 0) && value.length <= max
  && !/[\x00-\x1f\x7f]/.test(value) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
function properties(input, array = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input) !== array) invalid();
  const proto = Object.getPrototypeOf(input);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const key of Reflect.ownKeys(descriptors)) if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)
    || !Object.hasOwn(descriptors[key], 'value') || !(array && key === 'length') && !descriptors[key].enumerable) invalid();
  return descriptors;
}
function record(input, keys) {
  const data = properties(input);
  if (Reflect.ownKeys(data).length !== keys.length || keys.some(key => !Object.hasOwn(data, key))) invalid();
  return Object.fromEntries(keys.map(key => [key, data[key].value]));
}
function own(input, key) {
  const descriptor = properties(input)[key]; if (!descriptor) invalid(); return descriptor.value;
}
function list(input, min, max) {
  const data = properties(input, true), count = data.length.value;
  if (!Number.isSafeInteger(count) || count < min || count > max || Reflect.ownKeys(data).length !== count + 1) invalid();
  return Array.from({ length: count }, (_, index) => { if (!data[index]) invalid(); return data[index].value; });
}
function pair(input, min, max, integer = false) {
  const result = list(input, 2, 2);
  if (!result.every(value => Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)))) invalid();
  return result;
}
function source(input) {
  const value = record(input, ['objectId', 'objectRevision', 'sourcePath', 'sourceRevision']);
  if (!uuid(value.objectId) || !revision(value.objectRevision) || !revision(value.sourceRevision) || !text(value.sourcePath, 4096)
    || normalizeSourcePath(value.sourcePath) !== value.sourcePath || !value.sourcePath.toLowerCase().endsWith('.json')) invalid();
  return value;
}
const equalSource = (a, b) => ['objectId', 'objectRevision', 'sourcePath', 'sourceRevision'].every(key => a[key] === b[key]);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

// Capture data properties before reading values; a malformed optional diagram
// must never execute getters or make the ordinary numeric camera form unusable.
export function captureSceneCamera2DFramingContext(input, catalog) {
  const value = record(input, ['format', 'schemaVersion', 'worldId', 'baseRevision', 'scene', 'actors', 'viewports', 'diagnostics']);
  const worldId = own(catalog, 'worldId'), baseRevision = own(catalog, 'baseRevision'), catalogScene = own(catalog, 'scene');
  const expectedScene = source(Object.fromEntries(['objectId', 'objectRevision', 'sourcePath', 'sourceRevision'].map(key => [key, own(catalogScene, key)])));
  const scene = source(value.scene), designViewport = pair(own(catalogScene, 'viewport'), 64, 4096, true);
  if (value.format !== SCENE_CAMERA2D_FRAMING_FORMAT || value.schemaVersion !== 1 || typeof worldId !== 'string' || !/^world:[a-f0-9]{64}$/.test(worldId)
    || !revision(baseRevision) || value.worldId !== worldId || value.baseRevision !== baseRevision || !equalSource(scene, expectedScene)) invalid();
  let actors = null;
  if (value.actors !== null) {
    actors = list(value.actors, 1, SCENE_CAMERA2D_FRAMING_ACTOR_LIMIT).map(input => {
      const actor = record(input, ['instanceId', 'objectId', 'name', 'position', 'size', 'color']);
      if (!uuid(actor.instanceId) || !uuid(actor.objectId) || !text(actor.name, 512) || (typeof actor.color !== 'string' || !/^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(actor.color))) invalid();
      return { ...actor, position: pair(actor.position, -100000, 100000), size: pair(actor.size, 1, 2048) };
    });
    if (new Set(actors.map(actor => actor.instanceId)).size !== actors.length) invalid();
    const targets = list(own(catalog, 'targets'), 1, SCENE_CAMERA2D_FRAMING_ACTOR_LIMIT);
    if (targets.length !== actors.length || targets.some((target, index) => ['instanceId', 'objectId', 'name'].some(key => own(target, key) !== actors[index][key]))) invalid();
  }
  const ids = new Set(), viewports = list(value.viewports, 1, SCENE_CAMERA2D_FRAMING_ASSEMBLY_LIMIT + 1).map((input, index) => {
    const kind = own(input, 'kind'), row = record(input, ['id', 'kind', 'title', 'viewport', 'source', ...(kind === 'assembly-entry' ? ['entryScene'] : [])]);
    if (!text(row.title, 512) || !['scene', 'assembly-entry'].includes(kind)) invalid();
    const owner = source(row.source), viewport = pair(row.viewport, 64, 4096, true);
    if (ids.has(row.id)) invalid(); ids.add(row.id);
    if (index === 0) {
      if (kind !== 'scene' || row.id !== `scene:${scene.objectId}` || !equalSource(owner, scene) || viewport.some((value, n) => value !== designViewport[n])) invalid();
      return { ...row, viewport, source: owner };
    }
    if (kind !== 'assembly-entry' || row.id !== `assembly:${owner.objectId}` || owner.objectId === scene.objectId) invalid();
    const entryScene = source(row.entryScene);
    if (entryScene.objectId === owner.objectId || entryScene.objectId === scene.objectId && (!equalSource(entryScene, scene) || viewport.some((value, n) => value !== designViewport[n]))) invalid();
    return { ...row, viewport, source: owner, entryScene };
  });
  const diagnostics = list(value.diagnostics, 0, SCENE_CAMERA2D_FRAMING_DIAGNOSTIC_LIMIT).map(input => {
    const diagnostic = record(input, ['code', 'message', 'objectId', 'sourcePath', 'sourceRevision', 'propertyPath']);
    if (!text(diagnostic.code, 128) || !/^[a-z][a-z0-9_]+$/.test(diagnostic.code) || !text(diagnostic.message, 512)
      || diagnostic.objectId !== null && !uuid(diagnostic.objectId) || !text(diagnostic.sourcePath, 4096, true)
      || diagnostic.sourceRevision !== null && !revision(diagnostic.sourceRevision) || !text(diagnostic.propertyPath, 2048, true)) invalid();
    return diagnostic;
  });
  return freeze({ ...value, scene, actors, viewports, diagnostics });
}
