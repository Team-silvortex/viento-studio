// Saved scene geometry is a readonly observation. It carries neither image bytes,
// simulation state nor authority to change scene or physics sources.
import { captureScenePhysics2DTargetSource } from './scene-physics2d-targets.mjs';
import { inspectScenePhysics2D } from './scene-physics2d-core.mjs';
import { parseJsonSource } from './json-source.mjs';
import { normalizeSourcePath } from './source-path.mjs';
import { canonicalJson } from './canonical-json.mjs';

export const SCENE_PHYSICS2D_SPACE_API_PATH = '/api/scene-physics2d-space';
const catalogs = new WeakMap(), views = new WeakSet();
const sourceKeys = ['sourcePath', 'token', 'baseSourceRevision', 'sourceRevision', 'content'];
const fail = () => { throw Object.assign(new TypeError('Invalid scene physics space observation or source.'), { errorCode: 'scene_physics2d_space_invalid' }); };
const guarded = fn => { try { return fn(); } catch { fail(); } };
const uuid = value => typeof value === 'string' && value.length === 36 && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision = value => typeof value === 'string' && value.length === 71 && /^sha256:[a-f0-9]{64}$/.test(value);
const unicode = value => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && unicode(value);
const label = value => text(value, 160) && value.trim() && !/[\x00-\x1f\x7f]/.test(value);
const path = value => text(value, 4096) && normalizeSourcePath(value) === value && !/[\x00-\x1f\x7f:\\]/.test(value);
const color = value => typeof value === 'string' && [7, 9].includes(value.length) && /^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
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
function list(input, min, max, item) {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) fail();
  const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
  if (!Number.isInteger(length) || length < min || length > max || Reflect.ownKeys(input).length !== length + 1) fail();
  const result = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    result.push(item(descriptor.value));
  }
  return result;
}
function vector(value, min, max, integer = false) {
  return list(value, 2, 2, number => {
    if (!Number.isFinite(number) || number < min || number > max || integer && !Number.isInteger(number)) fail();
    return number;
  });
}
function directory(input, sceneObjectId) {
  if (!uuid(sceneObjectId)) fail();
  const value = record(input, ['format', 'schemaVersion', 'worldId', 'revision', 'scene', 'actors']);
  if (value.format !== 'viento-scene-physics2d-space' || value.schemaVersion !== 1
    || typeof value.worldId !== 'string' || value.worldId.length !== 70 || !/^world:[a-f0-9]{64}$/.test(value.worldId) || !revision(value.revision)) fail();
  value.scene = record(value.scene, ['objectId', 'sourcePath', 'sourceRevision', 'title', 'viewport', 'background']);
  const scene = value.scene;
  if (scene.objectId !== sceneObjectId || !path(scene.sourcePath) || !scene.sourcePath.endsWith('.json')
    || !revision(scene.sourceRevision) || !label(scene.title) || !color(scene.background)) fail();
  scene.viewport = vector(scene.viewport, 64, 4096, true);
  const instances = new Set(), definitions = new Map(), paths = new Map();
  value.actors = list(value.actors, 1, 128, input => {
    const actor = record(input, ['instanceId', 'objectId', 'name', 'sourcePath', 'sourceRevision', 'position', 'size', 'color']);
    if (!uuid(actor.instanceId) || !uuid(actor.objectId) || instances.has(actor.instanceId) || actor.objectId === sceneObjectId
      || !label(actor.name) || !path(actor.sourcePath) || actor.sourcePath === scene.sourcePath || !revision(actor.sourceRevision) || !color(actor.color)) fail();
    actor.position = vector(actor.position, -100000, 100000); actor.size = vector(actor.size, 1, 2048);
    const previous = definitions.get(actor.objectId);
    if (previous && ['sourcePath', 'sourceRevision', 'name'].some(key => previous[key] !== actor[key])
      || paths.has(actor.sourcePath) && paths.get(actor.sourcePath) !== actor.objectId) fail();
    instances.add(actor.instanceId); definitions.set(actor.objectId, actor); paths.set(actor.sourcePath, actor.objectId); return actor;
  });
  return freeze(value);
}
export function captureScenePhysics2DSpaceDirectory(raw, sceneObjectId) { return guarded(() => directory(raw, sceneObjectId)); }
export function captureScenePhysics2DSpace(inputSource, raw) {
  return guarded(() => {
    const source = captureScenePhysics2DTargetSource(inputSource), sceneId = parseJsonSource(source.content).value.sceneObjectId;
    const data = directory(raw, sceneId);
    if (source.sourcePath === data.scene.sourcePath || data.actors.some(actor => actor.sourcePath === source.sourcePath)) fail();
    const catalog = freeze({ worldId: data.worldId, revision: data.revision, scene: data.scene, actors: data.actors });
    catalogs.set(catalog, source); return catalog;
  });
}
export function isScenePhysics2DSpace(value) { return Boolean(value && typeof value === 'object' && catalogs.has(value)); }
export function scenePhysics2DSpaceMatchSource(space, inputSource) {
  if (!isScenePhysics2DSpace(space)) return false;
  try { const source = captureScenePhysics2DTargetSource(inputSource), original = catalogs.get(space); return sourceKeys.every(key => source[key] === original[key]); }
  catch { return false; }
}
export function scenePhysics2DSpaceEqual(a, b) {
  if (!isScenePhysics2DSpace(a) || !isScenePhysics2DSpace(b)) return false;
  const left = catalogs.get(a), right = catalogs.get(b);
  return sourceKeys.every(key => left[key] === right[key]) && canonicalJson(a) === canonicalJson(b);
}
export function isScenePhysics2DSpaceView(value) { return Boolean(value && typeof value === 'object' && views.has(value)); }
export function createScenePhysics2DSpaceView(space, document) {
  return guarded(() => {
    if (!isScenePhysics2DSpace(space)) fail();
    const checked = inspectScenePhysics2D(document).document;
    if (checked.sceneObjectId !== space.scene.objectId) fail();
    const actors = new Map(space.actors.map(actor => [actor.instanceId, actor])), bodies = [], missingBodies = [];
    let left = 0, top = 0, right = space.scene.viewport[0], bottom = space.scene.viewport[1];
    const include = (center, width, height) => {
      left = Math.min(left, center[0] - width / 2); right = Math.max(right, center[0] + width / 2);
      top = Math.min(top, center[1] - height / 2); bottom = Math.max(bottom, center[1] + height / 2);
    };
    for (const actor of space.actors) include(actor.position, ...actor.size);
    for (const body of checked.bodies) {
      const shape = body.shape.kind === 'box' ? { kind: 'box', size: [...body.shape.size] } : { kind: 'circle', radius: body.shape.radius };
      const value = { id: body.id, instanceId: body.instanceId, kind: body.kind, shape, offset: [...body.offset], layer: body.layer, mask: body.mask };
      const actor = actors.get(body.instanceId);
      if (!actor) { missingBodies.push(value); continue; }
      value.center = actor.position.map((number, axis) => number + body.offset[axis]); bodies.push(value);
      const size = shape.kind === 'box' ? shape.size : [shape.radius * 2, shape.radius * 2]; include(value.center, ...size);
    }
    const view = freeze({ scene: space.scene, actors: space.actors, bodies, missingBodies,
      bounds: { left, top, right, bottom, width: right - left, height: bottom - top } });
    views.add(view); return view;
  });
}
