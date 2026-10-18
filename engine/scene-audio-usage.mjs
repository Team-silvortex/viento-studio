// Local reference assistance, never a proof that a track is globally unused.
// Saved scalar strings remain ordinary parameters; no script is interpreted.
import { inspectSceneAudio } from './scene-audio-core.mjs';
import { inspectSceneBehaviors } from './scene-behaviors.mjs';
import { parseJsonSource, locateJsonSource } from './json-source.mjs';
import { normalizeSourcePath } from './source-path.mjs';

export const SCENE_AUDIO_USAGE_API_PATH = '/api/scene-audio-usage';
const catalogs = new WeakMap();
const behaviorSources = new WeakMap();
const sourceKeys = ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content'];
const identityKeys = ['objectId', 'sourcePath', 'sourceRevision'];
const fail = () => { throw Object.assign(new TypeError('Invalid scene audio usage snapshot or source.'), { errorCode: 'scene_audio_usage_invalid' }); };
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
function describe(input, withContent = false) {
  const value = record(input, withContent ? [...identityKeys, 'content'] : identityKeys);
  if (!uuid(value.objectId) || !sourcePath(value.sourcePath) || !revision(value.sourceRevision)
    || withContent && !content(value.content, 32768)) fail();
  return value;
}
function audioModel(value) {
  const parsed = parseJsonSource(value);
  if (!parsed.ok) fail();
  return inspectSceneAudio(parsed.value).document;
}
function directory(input, sceneObjectId) {
  if (!uuid(sceneObjectId)) fail();
  const value = record(input, ['format', 'schemaVersion', 'worldId', 'revision', 'scene', 'audio', 'behavior']);
  if (value.format !== 'viento-scene-audio-usage' || value.schemaVersion !== 1
    || typeof value.worldId !== 'string' || !/^world:[a-f0-9]{64}$/.test(value.worldId) || !revision(value.revision)) fail();
  value.scene = describe(value.scene); value.audio = describe(value.audio, true);
  if (value.scene.objectId !== sceneObjectId || audioModel(value.audio.content).sceneObjectId !== sceneObjectId) fail();
  const documents = [value.scene, value.audio];
  if (value.behavior !== null) {
    value.behavior = describe(value.behavior, true);
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
    || !revision(value.sourceRevision) || !content(value.content, 65536)) fail();
  return { value: Object.freeze(value), model: audioModel(value.content) };
}
export function captureSceneAudioUsageDirectory(raw, sceneObjectId) { return guard(() => directory(raw, sceneObjectId)); }
export function captureSceneAudioUsage(inputSource, raw) {
  return guard(() => {
    const captured = source(inputSource), value = directory(raw, captured.model.sceneObjectId);
    if (captured.value.sourcePath !== value.audio.sourcePath || captured.value.baseSourceRevision !== value.audio.sourceRevision) fail();
    const matches = [], behavior = value.behavior ? parseJsonSource(value.behavior.content) : null;
    if (value.behavior && !behavior?.ok) fail();
    if (behavior) for (const [index, binding] of behavior.value.bindings.entries()) {
      for (const [parameterName, trackId] of Object.entries(binding.parameters)) if (uuid(trackId)) matches.push({ trackId,
        bindingId: binding.bindingId, instanceId: binding.instanceId, parameterName,
        propertyPath: `/bindings/${index}/parameters/${parameterName}` });
    }
    const identity = item => Object.fromEntries(identityKeys.map(key => [key, item[key]]));
    const catalog = freeze({ scene: value.scene, audio: identity(value.audio), behavior: value.behavior ? identity(value.behavior) : null,
      savedContent: value.audio.content, matches });
    catalogs.set(catalog, captured.value);
    if (behavior) behaviorSources.set(catalog, { source: value.behavior, parsed: behavior });
    return catalog;
  });
}
export function isSceneAudioUsage(value) { return Boolean(value && typeof value === 'object' && catalogs.has(value)); }
export function sceneAudioUsageMatchSource(catalog, inputSource) {
  if (!isSceneAudioUsage(catalog)) return false;
  try { const captured = source(inputSource).value, original = catalogs.get(catalog); return sourceKeys.every(key => captured[key] === original[key]); }
  catch { return false; }
}

// This is the exact saved text observed by the earlier usage read, never a new
// disk read or a navigation/edit authority. Only that catalog's own match may
// select a value; caller properties and caller-provided ranges are not read.
export function sceneAudioUsageSource(catalog, match) {
  const saved = isSceneAudioUsage(catalog) ? behaviorSources.get(catalog) : null;
  if (!saved || !catalog.matches.includes(match)) fail();
  const sourceRange = locateJsonSource(saved.parsed, match.propertyPath);
  if (!sourceRange?.exact) fail();
  return freeze({ sourcePath: saved.source.sourcePath, sourceRevision: saved.source.sourceRevision,
    content: saved.source.content, propertyPath: match.propertyPath, sourceRange });
}
