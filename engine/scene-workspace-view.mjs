// Temporary author-workspace geometry, independent of rendering and runtime
// camera/viewport semantics. No author mutation, persistence or engine solver.
export const SCENE_WORKSPACE_MIN_SCALE = 1e-6;
export const SCENE_WORKSPACE_MAX_SCALE = 16;

const PADDING = 24, MAX_ACTORS = 128, MAX_LINES = 256, BASE_GRID_STEP = 32;
const invalid = () => Object.assign(new TypeError('Invalid finite scene workspace view data.'), {
  errorCode: 'scene_workspace_view_invalid',
});
const finite = value => typeof value === 'number' && Number.isFinite(value);
const zero = value => value === 0 ? 0 : value;

// Capture only explicit plain data. Accessors, hidden keys, symbols, sparse
// arrays and serializer hooks never participate in these pure calculations.
function fields(input, keys) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))
    || keys.some(key => !Object.hasOwn(descriptors, key) || !descriptors[key].enumerable
      || !Object.hasOwn(descriptors[key], 'value'))) throw invalid();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function array(input, min, max) {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors), length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < min || length > max || keys.length !== length + 1) throw invalid();
  const values = [];
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    values.push(descriptor.value);
  }
  return values;
}
function pair(input, min, max, integer = false) {
  const values = array(input, 2, 2);
  if (values.some(value => !finite(value) || value < min || value > max || integer && !Number.isInteger(value))) throw invalid();
  return values;
}
function dimensions(width, height) {
  if (![width, height].every(value => finite(value) && value >= 1 && value <= 65536)) throw invalid();
}
function actors(input) {
  return array(input, 0, MAX_ACTORS).map(raw => {
    const actor = fields(raw, ['position', 'size']);
    return { position: pair(actor.position, -100000, 100000), size: pair(actor.size, 1, 2048) };
  });
}
function boundsOf(values, initial = null) {
  let bounds = initial ? { ...initial } : null;
  for (const { position: [x, y], size: [width, height] } of values) {
    const left = x - width / 2, right = x + width / 2, top = y - height / 2, bottom = y + height / 2;
    bounds = bounds ? { left: Math.min(bounds.left, left), top: Math.min(bounds.top, top),
      right: Math.max(bounds.right, right), bottom: Math.max(bounds.bottom, bottom) } : { left, top, right, bottom };
  }
  return bounds;
}
function fit(bounds, width, height) {
  const scale = Math.max(SCENE_WORKSPACE_MIN_SCALE, Math.min(SCENE_WORKSPACE_MAX_SCALE,
    Math.max(1, width - PADDING * 2) / (bounds.right - bounds.left),
    Math.max(1, height - PADDING * 2) / (bounds.bottom - bounds.top)));
  return Object.freeze({ scale, offsetX: zero(width / 2 - (bounds.left + bounds.right) / 2 * scale),
    offsetY: zero(height / 2 - (bounds.top + bounds.bottom) / 2 * scale) });
}

// The saved viewport contributes a default frame; it never clips actor bounds.
export function fitSceneWorldView(viewport, inputActors, width, height) {
  const [sceneWidth, sceneHeight] = pair(viewport, 64, 4096, true), geometry = actors(inputActors);
  dimensions(width, height);
  return fit(boundsOf(geometry, { left: 0, top: 0, right: sceneWidth, bottom: sceneHeight }), width, height);
}

// Selection belongs to the view owner. This function receives only its selected
// geometry, not IDs, shared selection state or permission to edit those actors.
export function focusSceneWorkspaceView(inputActors, width, height) {
  const geometry = actors(inputActors); dimensions(width, height);
  return geometry.length ? fit(boundsOf(geometry), width, height) : null;
}

export function sceneWorldGrid(inputView, width, height) {
  const view = fields(inputView, ['scale', 'offsetX', 'offsetY']); dimensions(width, height);
  if (!finite(view.scale) || view.scale < SCENE_WORKSPACE_MIN_SCALE || view.scale > SCENE_WORKSPACE_MAX_SCALE
    || !finite(view.offsetX) || !finite(view.offsetY)) throw invalid();
  const bounds = { left: zero(-view.offsetX / view.scale), top: zero(-view.offsetY / view.scale),
    right: zero((width - view.offsetX) / view.scale), bottom: zero((height - view.offsetY) / view.scale) };
  // A finite offset can still overflow inverse projection or erase an entire
  // pixel span at double precision. Reject it instead of inventing geometry.
  if (!Object.values(bounds).every(finite) || bounds.left >= bounds.right || bounds.top >= bounds.bottom) throw invalid();
  // The coarsened display grid never changes the author's separate snap
  // setting, and zooming in does not invent cells finer than the base 32.
  let step = BASE_GRID_STEP * 2 ** Math.max(0, Math.ceil(Math.log2(1 / view.scale)));
  const indices = (left, right) => [Math.ceil(left / step), Math.floor(right / step)];
  let x, y;
  for (let attempt = 0; attempt < 1024; attempt++) {
    x = indices(bounds.left, bounds.right); y = indices(bounds.top, bounds.bottom);
    if ([...x, ...y].every(Number.isSafeInteger) && x[1] - x[0] + 1 <= MAX_LINES && y[1] - y[0] + 1 <= MAX_LINES) break;
    step *= 2;
    if (!finite(step) || attempt === 1023) throw invalid();
  }
  const lines = ([first, last]) => Object.freeze(Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => zero((first + index) * step)));
  return Object.freeze({ bounds: Object.freeze(bounds), step, xs: lines(x), ys: lines(y) });
}
