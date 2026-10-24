// Readonly instance identities from one saved scene. Catalogs bind the exact
// physics draft, but do not grant scene, file, renderer or Save authority.
import { inspectScenePhysics2D } from './scene-physics2d-core.mjs';
import { parseJsonSource } from './json-source.mjs';
import { normalizeSourcePath } from './source-path.mjs';
import { canonicalJson } from './canonical-json.mjs';

export const SCENE_PHYSICS2D_TARGETS_API_PATH = '/api/scene-physics2d-targets';
const catalogs = new WeakMap();
const sourceKeys = ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content'];
const locationKeys = ['objectId', 'sourcePath', 'sourceRevision'];
const fail = () => { throw Object.assign(new TypeError('Invalid scene physics target directory or source.'), { errorCode: 'scene_physics2d_targets_invalid' }); };
const uuid = value => typeof value === 'string' && value.length === 36 && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && value.length === 71 && /^sha256:[a-f0-9]{64}$/.test(value);
const unicode = value => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && unicode(value);
const path = value => text(value, 4096) && normalizeSourcePath(value) === value && !/[\x00-\x1f\x7f:\\]/.test(value);
const jsonPath = value => path(value) && /\.json$/.test(value);
const content = value => text(value, 65536) && new TextEncoder().encode(value).length <= 65536;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const guarded = action => { try { return action(); } catch { fail(); } };
function record(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') || Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')) fail();
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
function list(input, max, item) {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) fail();
  const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
  if (!Number.isInteger(length) || length < 1 || length > max || Reflect.ownKeys(input).length !== length + 1) fail();
  const result = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    result.push(item(descriptor.value));
  }
  return result;
}
function describe(input, withContent = false) {
  const value = record(input, withContent ? [...locationKeys, 'content'] : locationKeys);
  if (!uuid(value.objectId) || !jsonPath(value.sourcePath) || !revision(value.sourceRevision) || withContent && !content(value.content)) fail();
  return value;
}
function model(content) {
  const parsed = parseJsonSource(content); if (!parsed.ok) fail();
  return inspectScenePhysics2D(parsed.value).document;
}
function directory(input, sceneObjectId) {
  if (!uuid(sceneObjectId)) fail();
  const value = record(input, ['format', 'schemaVersion', 'worldId', 'revision', 'scene', 'manifest', 'targets']);
  if (value.format !== 'viento-scene-physics2d-targets' || value.schemaVersion !== 1
    || typeof value.worldId !== 'string' || value.worldId.length !== 70 || !/^world:[a-f0-9]{64}$/.test(value.worldId) || !revision(value.revision)) fail();
  value.scene = describe(value.scene); value.manifest = describe(value.manifest, true);
  if (value.scene.objectId !== sceneObjectId || value.manifest.objectId === sceneObjectId || value.manifest.sourcePath === value.scene.sourcePath
    || model(value.manifest.content).sceneObjectId !== sceneObjectId) fail();
  const identities = new Set(), definitions = new Map();
  value.targets = list(value.targets, 128, input => {
    const target = record(input, ['instanceId', 'objectId', 'name', 'sourcePath']);
    if (!uuid(target.instanceId) || !uuid(target.objectId) || identities.has(target.instanceId)
      || [sceneObjectId, value.manifest.objectId].includes(target.objectId)
      || !text(target.name, 160) || !target.name.trim() || /[\x00-\x1f\x7f]/.test(target.name) || !path(target.sourcePath)
      || [value.scene.sourcePath, value.manifest.sourcePath].includes(target.sourcePath)) fail();
    const previous = definitions.get(target.objectId);
    if (previous && (previous.sourcePath !== target.sourcePath || previous.name !== target.name)) fail();
    for (const [id, definition] of definitions) if (id !== target.objectId && definition.sourcePath === target.sourcePath) fail();
    identities.add(target.instanceId); definitions.set(target.objectId, target); return target;
  });
  // Missing body targets are deliberately accepted here: the directory must
  // remain usable to repair a deleted or moved instance.
  return freeze(value);
}
export function captureScenePhysics2DTargetSource(input) {
  return guarded(() => {
    const value = record(input, sourceKeys);
    if (!jsonPath(value.sourcePath) || !text(value.token, 256) || !revision(value.baseSourceRevision) || !revision(value.sourceRevision) || !content(value.content)) fail();
    model(value.content); return Object.freeze(value);
  });
}
export function captureScenePhysics2DTargetDirectory(raw, sceneObjectId) { return guarded(() => directory(raw, sceneObjectId)); }
export function captureScenePhysics2DTargets(inputSource, raw) {
  return guarded(() => {
    const source = captureScenePhysics2DTargetSource(inputSource), data = directory(raw, model(source.content).sceneObjectId);
    if (data.manifest.sourcePath !== source.sourcePath || data.manifest.sourceRevision !== source.baseSourceRevision) fail();
    const catalog = freeze({ scene: data.scene, manifest: Object.fromEntries(locationKeys.map(key => [key, data.manifest[key]])),
      savedContent: data.manifest.content, targets: data.targets });
    catalogs.set(catalog, { source, directory: data }); return catalog;
  });
}
export function isScenePhysics2DTargets(value) { return Boolean(value && typeof value === 'object' && catalogs.has(value)); }
export function scenePhysics2DTargetsMatchSource(catalog, inputSource) {
  if (!isScenePhysics2DTargets(catalog)) return false;
  try { const source = captureScenePhysics2DTargetSource(inputSource), original = catalogs.get(catalog).source; return sourceKeys.every(key => source[key] === original[key]); }
  catch { return false; }
}
export function scenePhysics2DTargetsEqual(a, b) {
  if (!isScenePhysics2DTargets(a) || !isScenePhysics2DTargets(b)) return false;
  const left = catalogs.get(a), right = catalogs.get(b);
  return sourceKeys.every(key => left.source[key] === right.source[key]) && canonicalJson(left.directory) === canonicalJson(right.directory);
}
export function scenePhysics2DTargetValue(catalog, instanceId) {
  if (!isScenePhysics2DTargets(catalog) || !uuid(instanceId) || !catalog.targets.some(target => target.instanceId === instanceId)) fail();
  return instanceId;
}
export function validateScenePhysics2DTargets(catalog, document) {
  if (!isScenePhysics2DTargets(catalog)) fail();
  const checked = inspectScenePhysics2D(document).document;
  if (checked.sceneObjectId !== catalog.scene.objectId) fail();
  const missing = [...new Set(checked.bodies.filter(body => !catalog.targets.some(target => target.instanceId === body.instanceId)).map(body => body.instanceId))];
  if (missing.length) throw Object.assign(new TypeError('Select current instances from the saved scene.'), { errorCode: 'scene_physics2d_target_missing', instanceIds: Object.freeze(missing) });
  return true;
}
