// Camera composition geometry only. No author identity allocation, persistence,
// renderer, animation sampling or runtime authority belongs to this module.
import { SCENE_WORKSPACE_MIN_SCALE, SCENE_WORKSPACE_MAX_SCALE } from './scene-workspace-view.mjs';

const PADDING = 24, MAX_ACTORS = 128, COORDINATE_LIMIT = 100000;
const invalid = () => Object.assign(new TypeError('Invalid finite scene camera2d composition data.'), { errorCode: 'scene_camera2d_frame_invalid' });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function fields(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))
    || keys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) throw invalid();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function array(input, min, max) {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < min || length > max || Reflect.ownKeys(descriptors).length !== length + 1) throw invalid();
  return Array.from({ length }, (_, index) => {
    const descriptor = descriptors[index];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    return descriptor.value;
  });
}
function pair(input, min, max, integer = false) {
  const values = array(input, 2, 2);
  if (!values.every(value => finite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)))) throw invalid();
  return values;
}
function modeOf(input) {
  if (!input || typeof input !== 'object') throw invalid();
  const descriptor = Object.getOwnPropertyDescriptor(input, 'mode');
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !['fixed', 'follow'].includes(descriptor.value)) throw invalid();
  return descriptor.value;
}
// The existing author camera subsection is validated directly: no dummy scene
// UUID or synthetic document is needed to lend geometry any author authority.
function limits(input) {
  const value = fields(input, ['left', 'top', 'right', 'bottom']);
  if (!Object.values(value).every(coordinate => finite(coordinate) && Math.abs(coordinate) <= COORDINATE_LIMIT)
    || value.left >= value.right || value.top >= value.bottom) throw invalid();
  return value;
}
function clampCenter(desired, size, rectangle) {
  return desired.map((coordinate, index) => {
    const min = index === 0 ? rectangle.left : rectangle.top, max = index === 0 ? rectangle.right : rectangle.bottom;
    return max - min < size[index] ? (min + max) / 2 : Math.max(min + size[index] / 2, Math.min(max - size[index] / 2, coordinate));
  });
}
function camera(input) {
  const mode = modeOf(input), bounded = Object.hasOwn(input, 'limits');
  const keys = mode === 'fixed' ? ['mode', 'center', 'zoom'] : ['mode', 'targetInstanceId', 'offset', 'zoom'];
  const value = fields(input, [...keys, ...(bounded ? ['limits'] : [])]);
  if (!finite(value.zoom) || value.zoom < 0.125 || value.zoom > 8) throw invalid();
  const result = mode === 'fixed' ? { mode, center: pair(value.center, -COORDINATE_LIMIT, COORDINATE_LIMIT), zoom: value.zoom }
    : { mode, targetInstanceId: value.targetInstanceId, offset: pair(value.offset, -COORDINATE_LIMIT, COORDINATE_LIMIT), zoom: value.zoom };
  if (mode === 'follow' && !uuid(value.targetInstanceId)) throw invalid();
  if (bounded) result.limits = limits(value.limits);
  return result;
}
function actors(input) {
  const ids = new Set();
  return array(input, 0, MAX_ACTORS).map(raw => {
    const value = fields(raw, ['instanceId', 'position', 'size']);
    if (!uuid(value.instanceId) || ids.has(value.instanceId)) throw invalid();
    ids.add(value.instanceId);
    return { instanceId: value.instanceId, position: pair(value.position, -COORDINATE_LIMIT, COORDINATE_LIMIT), size: pair(value.size, 1, 2048) };
  });
}
function bounds(center, size) {
  return { left: center[0] - size[0] / 2, top: center[1] - size[1] / 2,
    right: center[0] + size[0] / 2, bottom: center[1] + size[1] / 2 };
}
function captureFrame(input, geometry) {
  const mode = modeOf(input), bounded = Object.hasOwn(input, 'limits');
  const keys = mode === 'fixed' ? ['mode', 'center', 'size', 'bounds']
    : ['mode', 'targetInstanceId', 'center', 'size', 'bounds', 'targetPosition'];
  const value = fields(input, [...keys, ...(bounded ? ['desiredCenter', 'limits'] : [])]);
  const extent = COORDINATE_LIMIT * (mode === 'fixed' ? 1 : 2);
  const center = pair(value.center, -extent, extent);
  // These are all possible viewport / camera-zoom dimensions, not actor sizes.
  const size = pair(value.size, 64 / 8, 4096 / 0.125), rectangle = fields(value.bounds, ['left', 'top', 'right', 'bottom']);
  const expected = bounds(center, size);
  if (Object.keys(expected).some(key => !finite(rectangle[key]) || rectangle[key] !== expected[key])) throw invalid();
  const result = { mode, center, size, bounds: expected };
  let desiredCenter = center;
  if (bounded) {
    desiredCenter = pair(value.desiredCenter, -extent, extent);
    const world = limits(value.limits), actual = clampCenter(desiredCenter, size, world);
    if (center.some((coordinate, index) => coordinate !== actual[index])) throw invalid();
    result.desiredCenter = desiredCenter; result.limits = world;
  }
  if (mode === 'fixed') return result;
  if (!uuid(value.targetInstanceId)) throw invalid();
  const targetPosition = pair(value.targetPosition, -COORDINATE_LIMIT, COORDINATE_LIMIT);
  const target = geometry.find(actor => actor.instanceId === value.targetInstanceId);
  if (!target || targetPosition.some((coordinate, index) => coordinate !== target.position[index])
    || desiredCenter.some((coordinate, index) => Math.abs(coordinate - targetPosition[index]) > COORDINATE_LIMIT + 1e-8)) throw invalid();
  return { ...result, targetInstanceId: value.targetInstanceId, targetPosition };
}

export function resolveSceneCamera2DFrame(input) {
  const value = fields(input, ['camera', 'actors', 'viewport']), declaration = camera(value.camera), geometry = actors(value.actors);
  const viewport = pair(value.viewport, 64, 4096, true), size = viewport.map(value => value / declaration.zoom);
  const target = declaration.mode === 'follow' ? geometry.find(actor => actor.instanceId === declaration.targetInstanceId) : null;
  if (declaration.mode === 'follow' && !target) throw invalid();
  const desiredCenter = declaration.mode === 'fixed' ? declaration.center
    : target.position.map((coordinate, index) => coordinate + declaration.offset[index]);
  const center = declaration.limits ? clampCenter(desiredCenter, size, declaration.limits) : desiredCenter;
  const result = declaration.mode === 'fixed' ? { mode: 'fixed', center, size, bounds: bounds(center, size) }
    : { mode: 'follow', targetInstanceId: declaration.targetInstanceId, center, size, bounds: bounds(center, size), targetPosition: target.position };
  if (declaration.limits) { result.desiredCenter = desiredCenter; result.limits = declaration.limits; }
  return freeze(result);
}

export function fitSceneCamera2DFrame(inputFrame, inputActors, width, height, options) {
  const { scope } = fields(options, ['scope']);
  if (!['camera', 'all'].includes(scope) || ![width, height].every(value => finite(value) && value >= 1 && value <= 65536)) throw invalid();
  const geometry = actors(inputActors), frame = captureFrame(inputFrame, geometry), rectangle = { ...frame.bounds };
  if (scope === 'all' && frame.limits) {
    rectangle.left = Math.min(rectangle.left, frame.limits.left); rectangle.top = Math.min(rectangle.top, frame.limits.top);
    rectangle.right = Math.max(rectangle.right, frame.limits.right); rectangle.bottom = Math.max(rectangle.bottom, frame.limits.bottom);
    // Keep an out-of-bounds author intent reachable in the all-composition view.
    // Camera fitting and the actual runtime frame still use only the clamp.
    rectangle.left = Math.min(rectangle.left, frame.desiredCenter[0]); rectangle.top = Math.min(rectangle.top, frame.desiredCenter[1]);
    rectangle.right = Math.max(rectangle.right, frame.desiredCenter[0]); rectangle.bottom = Math.max(rectangle.bottom, frame.desiredCenter[1]);
  }
  if (scope === 'all') for (const actor of geometry) {
    const item = bounds(actor.position, actor.size);
    rectangle.left = Math.min(rectangle.left, item.left); rectangle.top = Math.min(rectangle.top, item.top);
    rectangle.right = Math.max(rectangle.right, item.right); rectangle.bottom = Math.max(rectangle.bottom, item.bottom);
  }
  // The frame can be much larger than an actor. Reuse the same workspace fit
  // limits without disguising it as an actor outside that geometry contract.
  const scale = Math.max(SCENE_WORKSPACE_MIN_SCALE, Math.min(SCENE_WORKSPACE_MAX_SCALE,
    Math.max(1, width - PADDING * 2) / (rectangle.right - rectangle.left),
    Math.max(1, height - PADDING * 2) / (rectangle.bottom - rectangle.top)));
  const offsetX = width / 2 - (rectangle.left + rectangle.right) / 2 * scale;
  const offsetY = height / 2 - (rectangle.top + rectangle.bottom) / 2 * scale;
  return Object.freeze({ scale, offsetX: offsetX === 0 ? 0 : offsetX, offsetY: offsetY === 0 ? 0 : offsetY });
}

export function moveSceneCamera2DFrame(inputCamera, inputDelta) {
  const value = camera(inputCamera), delta = pair(inputDelta, -Number.MAX_VALUE, Number.MAX_VALUE);
  const key = value.mode === 'fixed' ? 'center' : 'offset';
  value[key] = value[key].map((coordinate, index) => delta[index] === 0 ? coordinate
    : Math.max(-COORDINATE_LIMIT, Math.min(COORDINATE_LIMIT, coordinate + delta[index])));
  return freeze(value);
}
