// View-only picking from the renderer's uploaded matrices. No author source,
// semantic parser, scene mutations, GPU readback or host ports.
const matrix = value => value && value.length === 16 && Array.from(value).every(Number.isFinite);

function inverse4(input) {
  if (!matrix(input)) return null;
  const rows = Array.from({ length: 4 }, (_, row) => [
    ...Array.from({ length: 4 }, (_, col) => input[col * 4 + row]),
    ...Array.from({ length: 4 }, (_, col) => Number(row === col)),
  ]);
  for (let col = 0; col < 4; col++) {
    let pivot = col;
    for (let row = col + 1; row < 4; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (!rows[pivot][col]) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col]; rows[col] = rows[col].map(value => value / divisor);
    for (let row = 0; row < 4; row++) if (row !== col) {
      const factor = rows[row][col]; rows[row] = rows[row].map((value, index) => value - factor * rows[col][index]);
    }
  }
  const result = Array.from({ length: 16 }, (_, index) => rows[index % 4][4 + Math.floor(index / 4)]);
  return result.every(Number.isFinite) ? result : null;
}

const transform = (m, v) => Array.from({ length: 4 }, (_, row) => v.reduce((sum, value, col) => sum + m[col * 4 + row] * value, 0));
function point(m, x, y, z) {
  const value = transform(m, [x, y, z, 1]);
  if (!value[3]) return null;
  const result = value.slice(0, 3).map(n => n / value[3]);
  return result.every(Number.isFinite) ? result : null;
}
function surfaceTimes(origin, direction) {
  let enter = -Infinity, exit = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    if (direction[axis] === 0) { if (origin[axis] < -.5 || origin[axis] > .5) return []; continue; }
    const first = (-.5 - origin[axis]) / direction[axis], last = (.5 - origin[axis]) / direction[axis];
    enter = Math.max(enter, Math.min(first, last)); exit = Math.min(exit, Math.max(first, last));
    if (enter > exit) return [];
  }
  // A clipped entry is not a new mesh surface: if the near plane is inside
  // a box, only its positive exit face can be selected.
  return [enter, exit].filter((value, index, values) => Number.isFinite(value) && value >= 0 && values.indexOf(value) === index);
}

/** frame = {rect:{left,top,width,height},width,height,viewProjection,
 * objects:[{instanceId,model}]}. Coordinates are CSS client coordinates.
 * Matrices are the exact Float32 uniform payloads of the last successful draw. */
export function pickScene3DObject(frame, clientX, clientY) {
  const rect = frame?.rect;
  if (!rect || ![rect.left, rect.top, rect.width, rect.height, clientX, clientY].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0 || !Number.isSafeInteger(frame.width) || frame.width < 1
    || !Number.isSafeInteger(frame.height) || frame.height < 1 || !Array.isArray(frame.objects) || frame.objects.length > 128
    || clientX < rect.left || clientX >= rect.left + rect.width || clientY < rect.top || clientY >= rect.top + rect.height) return null;
  const inverseView = inverse4(frame.viewProjection); if (!inverseView) return null;
  const x = (clientX - rect.left) / rect.width * 2 - 1, y = 1 - (clientY - rect.top) / rect.height * 2;
  // The far point can have w=0 for a legal, wide clip ratio in Float32.
  // Near and middle depth provide a finite forward ray without inventing a far.
  const origin = point(inverseView, x, y, -1), middle = point(inverseView, x, y, 0);
  if (!origin || !middle) return null;
  const direction = middle.map((value, index) => value - origin[index]);
  if (!Math.hypot(...direction)) return null;
  let selected = null, nearest = Infinity;
  for (const object of frame.objects) {
    if (typeof object?.instanceId !== 'string') continue;
    const inverseModel = inverse4(object.model); if (!inverseModel) continue;
    const localOrigin = point(inverseModel, ...origin), localMiddle = point(inverseModel, ...middle);
    if (!localOrigin || !localMiddle) continue;
    const localDirection = localMiddle.map((value, index) => value - localOrigin[index]);
    for (const time of surfaceTimes(localOrigin, localDirection)) {
      const hit = origin.map((value, index) => value + direction[index] * time);
      const clip = transform(frame.viewProjection, [...hit, 1]);
      if (!clip.every(Number.isFinite) || clip[3] <= 0 || clip.slice(0, 3).some(value => value < -clip[3] || value > clip[3])) continue;
      const depth = clip[2] / clip[3];
      // LEQUAL draws later declarations over exactly equal depth.
      if (depth <= nearest) { nearest = depth; selected = object.instanceId; }
    }
  }
  return selected;
}
