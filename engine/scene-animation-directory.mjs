// Saved named animation identities, independent of rendering or an execution backend.
// A chosen clip ID remains an ordinary scalar; this catalog grants no save or playback authority.
import { inspectSceneAnimation } from './scene-animation-core.mjs';
import { inspectSceneBehaviors } from './scene-behaviors.mjs';
import { parseJsonSource } from './json-source.mjs';
import { normalizeSourcePath } from './source-path.mjs';

export const SCENE_ANIMATION_DIRECTORY_API_PATH = '/api/scene-animation-directory';
const catalogs = new WeakMap();
const sourceKeys = ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content'];
const sceneKeys = ['objectId', 'sourcePath', 'sourceRevision'];
const fail = () => { throw Object.assign(new TypeError('Invalid scene animation identity directory or behavior source.'), { errorCode: 'scene_animation_directory_invalid' }); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const unicode = value => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const text = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum && unicode(value);
const sourcePath = value => text(value, 4096) && normalizeSourcePath(value) === value && !/^[A-Za-z]:/.test(value) && /\.json$/i.test(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const guard = action => { try { return action(); } catch { fail(); } };
// Exact data descriptors are inspected before values. No getters, inherited
// fields, serializers or arbitrary traversals participate in a capture.
function record(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail();
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) fail();
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    result[key] = descriptor.value;
  }
  return result;
}
function describe(input, content = false) {
  const value = record(input, content ? [...sceneKeys, 'content'] : sceneKeys);
  if (!uuid(value.objectId) || !sourcePath(value.sourcePath) || !revision(value.sourceRevision)) fail();
  if (content && (!text(value.content, 131072) || new TextEncoder().encode(value.content).length > 131072)) fail();
  return value;
}
function directory(input, sceneObjectId) {
  if (!uuid(sceneObjectId)) fail();
  const value = record(input, ['format', 'schemaVersion', 'status', 'worldId', 'revision', 'scene', 'manifest']);
  if (value.format !== 'viento-scene-animation-directory' || value.schemaVersion !== 1 || !['empty', 'ready'].includes(value.status)
    || typeof value.worldId !== 'string' || !/^world:[a-f0-9]{64}$/.test(value.worldId) || !revision(value.revision)) fail();
  value.scene = describe(value.scene);
  if (value.scene.objectId !== sceneObjectId) fail();
  if (value.status === 'empty') { if (value.manifest !== null) fail(); }
  else {
    value.manifest = describe(value.manifest, true);
    if (value.manifest.objectId === sceneObjectId || value.manifest.sourcePath === value.scene.sourcePath) fail();
    const parsed = parseJsonSource(value.manifest.content); if (!parsed.ok) fail();
    const model = inspectSceneAnimation(parsed.value).document;
    if (model.sceneObjectId !== sceneObjectId) fail();
  }
  return freeze(value);
}
function source(input) {
  const value = record(input, sourceKeys);
  if (!sourcePath(value.sourcePath) || !text(value.token, 256) || !revision(value.baseSourceRevision) || !revision(value.sourceRevision)
    || !text(value.content, 32768) || new TextEncoder().encode(value.content).length > 32768) fail();
  const parsed = inspectSceneBehaviors(value.content);
  if (!parsed.recognized || !parsed.ok || !parsed.value) fail();
  return { value: Object.freeze(value), model: parsed.value };
}
export function captureSceneAnimationDirectory(raw, sceneObjectId) {
  return guard(() => directory(raw, sceneObjectId));
}
export function captureSceneBehaviorAnimationClips(inputSource, raw, expectedScene) {
  return guard(() => {
    const captured = source(inputSource), expected = describe(expectedScene);
    const value = directory(raw, captured.model.sceneObjectId);
    if (!sceneKeys.every(key => expected[key] === value.scene[key]) || value.manifest?.sourcePath === captured.value.sourcePath) fail();
    const model = value.manifest ? inspectSceneAnimation(parseJsonSource(value.manifest.content).value).document : null;
    // Older declarations and schema3 with an empty list are valid saved
    // animations. They expose no named candidates and are never upgraded here.
    const clips = (model?.clips || []).map(clip => ({ clipId: clip.id, name: clip.name,
      startSeconds: clip.startSeconds, endSeconds: clip.endSeconds, loop: clip.loop }));
    const catalog = freeze({ status: value.status, scene: value.scene,
      manifest: value.manifest ? Object.fromEntries(sceneKeys.map(key => [key, value.manifest[key]])) : null, clips });
    catalogs.set(catalog, captured.value);
    return catalog;
  });
}
export function isSceneBehaviorAnimationClips(value) { return Boolean(value && typeof value === 'object' && catalogs.has(value)); }
export function sceneBehaviorAnimationClipsMatchSource(catalog, inputSource) {
  if (!isSceneBehaviorAnimationClips(catalog)) return false;
  try { const captured = source(inputSource).value, original = catalogs.get(catalog); return sourceKeys.every(key => original[key] === captured[key]); }
  catch { return false; }
}
export function sceneBehaviorAnimationClipValue(catalog, clipId) {
  if (!isSceneBehaviorAnimationClips(catalog) || !uuid(clipId) || !catalog.clips.some(clip => clip.clipId === clipId)) fail();
  return clipId;
}
