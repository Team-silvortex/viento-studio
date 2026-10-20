// Local reference assistance, never a proof that a clip is globally unused.
// Saved scalar strings remain ordinary parameters; no script is interpreted.
import { inspectSceneAnimation } from './scene-animation-core.mjs';
import { inspectSceneBehaviors } from './scene-behaviors.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { normalizeSourcePath } from './source-path.mjs';

export const SCENE_ANIMATION_USAGE_API_PATH = '/api/scene-animation-usage';
const catalogs = new WeakMap();
const behaviorSources = new WeakMap();
const sourceKeys = ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content'];
const identityKeys = ['objectId', 'sourcePath', 'sourceRevision'];
const fail = () => { throw Object.assign(new TypeError('Invalid scene animation usage snapshot or source.'), { errorCode: 'scene_animation_usage_invalid' }); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const unicode = value => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const text = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && unicode(value);
const content = (value, limit) => text(value, limit) && new TextEncoder().encode(value).length <= limit;
const sourcePath = value => text(value, 4096) && normalizeSourcePath(value) === value && !/^[A-Za-z]:/.test(value) && /\.json$/i.test(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const guard = action => { try { return action(); } catch { fail(); } };
// Capture exact data properties before values: getters, serializers, inherited
// fields and caller mutations never supply author data to the inspectors.
function record(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail();
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) fail();
  const value = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    value[key] = descriptor.value;
  }
  return value;
}
function describe(input, byteLimit = 0) {
  const value = record(input, byteLimit ? [...identityKeys, 'content'] : identityKeys);
  if (!uuid(value.objectId) || !sourcePath(value.sourcePath) || !revision(value.sourceRevision)
    || byteLimit && !content(value.content, byteLimit)) fail();
  return value;
}
function animationModel(value) {
  const parsed = parseJsonSource(value);
  if (!parsed.ok) fail();
  return inspectSceneAnimation(parsed.value).document;
}
function directory(input, sceneObjectId) {
  if (!uuid(sceneObjectId)) fail();
  const value = record(input, ['format', 'schemaVersion', 'worldId', 'revision', 'scene', 'animation', 'behavior']);
  if (value.format !== 'viento-scene-animation-usage' || value.schemaVersion !== 1
    || typeof value.worldId !== 'string' || !/^world:[a-f0-9]{64}$/.test(value.worldId) || !revision(value.revision)) fail();
  value.scene = describe(value.scene); value.animation = describe(value.animation, 131072);
  if (value.scene.objectId !== sceneObjectId || animationModel(value.animation.content).sceneObjectId !== sceneObjectId) fail();
  const documents = [value.scene, value.animation];
  if (value.behavior !== null) {
    value.behavior = describe(value.behavior, 32768);
    const checked = inspectSceneBehaviors(value.behavior.content);
    if (!checked.recognized || !checked.ok || checked.value.sceneObjectId !== sceneObjectId) fail();
    documents.push(value.behavior);
  }
  if (new Set(documents.map(item => item.objectId)).size !== documents.length
    || new Set(documents.map(item => item.sourcePath)).size !== documents.length) fail();
  return freeze(value);
}
function source(input) {
  const value = record(input, sourceKeys);
  if (!sourcePath(value.sourcePath) || !text(value.token, 256) || !revision(value.baseSourceRevision)
    || !revision(value.sourceRevision) || !content(value.content, 131072)) fail();
  return { value: Object.freeze(value), model: animationModel(value.content) };
}
export function captureSceneAnimationUsageDirectory(raw, sceneObjectId) { return guard(() => directory(raw, sceneObjectId)); }
export function captureSceneAnimationUsage(inputSource, raw) {
  return guard(() => {
    const captured = source(inputSource), value = directory(raw, captured.model.sceneObjectId);
    if (captured.value.sourcePath !== value.animation.sourcePath || captured.value.baseSourceRevision !== value.animation.sourceRevision) fail();
    const matches = [], behavior = value.behavior ? parseJsonSource(value.behavior.content) : null;
    if (value.behavior && !behavior?.ok) fail();
    if (behavior) for (const [index, binding] of behavior.value.bindings.entries()) {
      for (const [parameterName, clipId] of Object.entries(binding.parameters)) if (uuid(clipId)) matches.push({ clipId,
        bindingId: binding.bindingId, instanceId: binding.instanceId, parameterName,
        propertyPath: `/bindings/${index}/parameters/${parameterName}` });
    }
    const identity = item => Object.fromEntries(identityKeys.map(key => [key, item[key]]));
    const catalog = freeze({ scene: value.scene, animation: identity(value.animation), behavior: value.behavior ? identity(value.behavior) : null,
      savedContent: value.animation.content, matches });
    catalogs.set(catalog, captured.value);
    if (behavior) behaviorSources.set(catalog, { source: value.behavior, parsed: behavior });
    return catalog;
  });
}
export function isSceneAnimationUsage(value) { return Boolean(value && typeof value === 'object' && catalogs.has(value)); }
export function sceneAnimationUsageMatchSource(catalog, inputSource) {
  if (!isSceneAnimationUsage(catalog)) return false;
  try { const captured = source(inputSource).value, original = catalogs.get(catalog); return sourceKeys.every(key => captured[key] === original[key]); }
  catch { return false; }
}

// This is the exact saved text observed by the earlier usage read, never a new
// disk read or a navigation/edit authority. Only that catalog's own match may
// select a value; caller properties and caller-provided ranges are not read.
export function sceneAnimationUsageSource(catalog, match) {
  const saved = isSceneAnimationUsage(catalog) ? behaviorSources.get(catalog) : null;
  if (!saved || !catalog.matches.includes(match)) fail();
  const sourceRange = locateJsonSource(saved.parsed, match.propertyPath);
  if (!sourceRange?.exact) fail();
  return freeze({ sourcePath: saved.source.sourcePath, sourceRevision: saved.source.sourceRevision,
    content: saved.source.content, propertyPath: match.propertyPath, sourceRange });
}
