// Column-major matrices, right-handed Y-up, camera forward -Z.
// Euler XYZ is Rx * Ry * Rz, matching Godot Basis.from_euler(XYZ).
export const identity4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function multiply4(a, b) {
  const out = Array(16).fill(0);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++)
    for (let n = 0; n < 4; n++) out[col * 4 + row] += a[n * 4 + row] * b[col * 4 + n];
  return out;
}
export const normalize3 = value => { const scale = Math.max(...value.map(Math.abs)), scaled = value.map(n => n / scale), length = Math.hypot(...scaled); return scaled.map(n => n / length); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
export function lookAt4(position, target) {
  const z = normalize3(position.map((value, index) => value - target[index]));
  const x = normalize3(cross([0, 1, 0], z)), y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, position), -dot(y, position), -dot(z, position), 1];
}
export function perspective4(fovDegrees, aspect, near, far) {
  const f = 1 / Math.tan(fovDegrees * Math.PI / 360), range = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * range, -1, 0, 0, 2 * far * near * range, 0];
}
export function rotationXYZ4(degrees) {
  const [x, y, z] = degrees.map(value => value * Math.PI / 180), cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  return multiply4(multiply4([1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1],
    [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1]),
  [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
export function objectMatrix4(object) {
  const scale = identity4(); [scale[0], scale[5], scale[10]] = object.size;
  const matrix = multiply4(rotationXYZ4(object.rotationDegrees), scale);
  [matrix[12], matrix[13], matrix[14]] = object.position;
  return matrix;
}
export function orbitCamera(camera, yaw, pitch, scale = 1, distanceLimit = 200000, distanceMinimum = 0.01) {
  const delta = camera.position.map((value, index) => value - camera.target[index]);
  const distance = Math.max(distanceMinimum, Math.min(distanceLimit, Math.hypot(...delta) * scale));
  const angle = Math.atan2(delta[0], delta[2]) + yaw;
  const elevation = Math.max(-Math.PI / 2 + 0.002, Math.min(Math.PI / 2 - 0.002, Math.asin(delta[1] / Math.hypot(...delta)) + pitch));
  return { ...camera, target: [...camera.target], position: camera.target.map((value, index) => value +
    [distance * Math.cos(elevation) * Math.sin(angle), distance * Math.sin(elevation), distance * Math.cos(elevation) * Math.cos(angle)][index]) };
}

// The sphere enclosing all eight box corners is rotation invariant. Frame it
// against the smaller actual viewport half-angle, keeping the current heading.
// These are temporary view values; author camera clipping remains untouched.
export function frameCamera(camera, object, aspect) {
  const triplet = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  if (!camera || !object || !triplet(camera.position) || !triplet(camera.target)
    || !triplet(object.position) || !triplet(object.size) || object.size.some(value => value <= 0)
    || !Number.isFinite(aspect) || aspect <= 0 || !Number.isFinite(camera.fovDegrees)
    || camera.fovDegrees <= 0 || camera.fovDegrees >= 180) return null;
  const delta = camera.position.map((value, index) => value - camera.target[index]);
  if (!Math.hypot(...delta) || !Math.hypot(delta[0], delta[2])) return null;
  const heading = normalize3(delta), radius = Math.hypot(...object.size) / 2;
  const vertical = camera.fovDegrees * Math.PI / 360;
  const halfAngle = Math.min(vertical, Math.atan(Math.tan(vertical) * aspect));
  const distance = radius * 1.2 / Math.sin(halfAngle);
  const target = [...object.position], position = target.map((value, index) => value + heading[index] * distance);
  const near = (distance - radius) / 2, far = distance + radius * 2;
  if (![...position, distance, near, far].every(Number.isFinite) || near <= 0 || far <= near) return null;
  return Object.freeze({ ...camera, position: Object.freeze(position), target: Object.freeze(target), near, far });
}
// Bounds use every transformed box corner. A missing or malformed object
// rejects the complete scene rather than shrinking its view by omission.
export function sceneBounds(objects) {
  const triplet = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  if (!Array.isArray(objects) || !objects.length || objects.length > 128) return null;
  const points = [], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const object of objects) {
    if (!object || !triplet(object.position) || !triplet(object.size) || !triplet(object.rotationDegrees)
      || object.size.some(value => value <= 0)) return null;
    const matrix = objectMatrix4(object);
    if (!matrix.every(Number.isFinite)) return null;
    for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
      const point = [0, 1, 2].map(axis => matrix[axis] * x + matrix[4 + axis] * y + matrix[8 + axis] * z + object.position[axis]);
      if (!point.every(Number.isFinite)) return null;
      for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
      points.push(point);
    }
  }
  // Half each bound before summing to avoid overflowing two finite limits.
  const center = min.map((value, axis) => value / 2 + max[axis] / 2);
  const radius = Math.max(...points.map(point => Math.hypot(...point.map((value, axis) => value - center[axis]))));
  if (![...center, radius].every(Number.isFinite) || radius <= 0) return null;
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max), center: Object.freeze(center), radius });
}

// This is temporary framing of the complete validated scene. The enclosing
// sphere fits the narrower drawing-buffer half-angle, preserving heading/FOV.
export function frameSceneCamera(camera, objects, aspect) {
  const triplet = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  if (!camera || !triplet(camera.position) || !triplet(camera.target)
    || !Number.isFinite(camera.fovDegrees) || camera.fovDegrees <= 0 || camera.fovDegrees >= 180
    || !Number.isFinite(aspect) || aspect <= 0) return null;
  const delta = camera.position.map((value, axis) => value - camera.target[axis]);
  if (!delta.every(Number.isFinite) || !Math.hypot(...delta) || !Math.hypot(delta[0], delta[2])) return null;
  const bounds = sceneBounds(objects); if (!bounds) return null;
  const heading = normalize3(delta), vertical = camera.fovDegrees * Math.PI / 360;
  const halfAngle = Math.min(vertical, Math.atan(Math.tan(vertical) * aspect));
  const distance = bounds.radius * 1.2 / Math.sin(halfAngle);
  const target = [...bounds.center], position = target.map((value, axis) => value + heading[axis] * distance);
  const near = (distance - bounds.radius) / 2, far = distance + bounds.radius * 2;
  if (![...position, distance, near, far].every(Number.isFinite) || near <= 0 || far <= near) return null;
  // A finite distance can still disappear when added to a huge world target.
  const actualDelta = position.map((value, axis) => value - target[axis]);
  if (!actualDelta.every(Number.isFinite) || !Math.hypot(...actualDelta) || !Math.hypot(actualDelta[0], actualDelta[2])) return null;
  return Object.freeze({ ...camera, position: Object.freeze(position), target: Object.freeze(target), near, far });
}
export const color3 = hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255);
