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
export function lookAt4(position, target, up = [0, 1, 0]) {
  const z = normalize3(position.map((value, index) => value - target[index]));
  const x = normalize3(cross(normalize3(up), z)), y = cross(z, x);
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
const triplet = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
function cameraBasis(camera) {
  if (!camera || !triplet(camera.position) || !triplet(camera.target)) return null;
  const delta = camera.position.map((value, axis) => value - camera.target[axis]), distance = Math.hypot(...delta);
  if (!delta.every(Number.isFinite) || !Number.isFinite(distance) || distance <= 0) return null;
  const back = normalize3(delta), up = camera.up === undefined ? [0, 1, 0] : camera.up;
  if (!triplet(up) || !Math.hypot(...up)) return null;
  const side = cross(normalize3(up), back);
  if (!side.every(Number.isFinite) || !Math.hypot(...side)) return null;
  const right = normalize3(side);
  return { back, right, up: cross(back, right), distance };
}
function viewCamera(camera, position, target, changes = {}) {
  return Object.freeze({ ...camera, ...changes, position: Object.freeze(position), target: Object.freeze(target),
    ...(camera.up === undefined ? {} : { up: Object.freeze([...camera.up]) }) });
}

// Positive world axes expressed in the view's screen basis. Screen Y points
// downward; positive depth faces the observer. No projection or author fields
// are needed, so translation, zoom and projection choice cannot change this.
export function orientationAxes(camera) {
  const basis = cameraBasis(camera); if (!basis) return null;
  return Object.freeze(['X', 'Y', 'Z'].map((axis, index) => Object.freeze({ axis,
    x: basis.right[index], y: -basis.up[index], depth: basis.back[index] })));
}

// Projection alone, in right-handed OpenGL clip space; the caller applies
// lookAt4 separately. Orthographic scale matches perspective at target depth,
// so projection switching preserves that plane without changing author data.
export function cameraProjection4(camera, aspect, projectionMode = 'perspective') {
  if (!['perspective', 'orthographic'].includes(projectionMode) || !camera
    || ![camera.fovDegrees, camera.near, camera.far, aspect].every(Number.isFinite)
    || camera.fovDegrees <= 0 || camera.fovDegrees >= 180 || aspect <= 0
    || camera.near <= 0 || camera.far <= camera.near) return null;
  const basis = cameraBasis(camera); if (!basis) return null;
  let matrix;
  if (projectionMode === 'perspective') {
    // Preserve the original perspective values exactly, including rounding.
    matrix = perspective4(camera.fovDegrees, aspect, camera.near, camera.far);
  } else {
    const height = 2 * basis.distance * Math.tan(camera.fovDegrees * Math.PI / 360), width = height * aspect;
    if (![height, width].every(Number.isFinite) || height <= 0 || width <= 0) return null;
    const range = 1 / (camera.near - camera.far);
    matrix = [2 / width, 0, 0, 0, 0, 2 / height, 0, 0, 0, 0, 2 * range, 0,
      0, 0, (camera.far + camera.near) * range, 1];
  }
  if (!matrix.every(Number.isFinite) || !matrix[0] || !matrix[5] || !matrix[10]) return null;
  return Object.freeze(matrix);
}

// Standard views carry an explicit temporary up vector. It belongs to the view,
// never the authored camera, and makes both vertical directions unambiguous.
export function standardViewCamera(camera, direction) {
  const views = { front: [[0, 0, 1], [0, 1, 0]], back: [[0, 0, -1], [0, 1, 0]],
    left: [[-1, 0, 0], [0, 1, 0]], right: [[1, 0, 0], [0, 1, 0]],
    top: [[0, 1, 0], [0, 0, -1]], bottom: [[0, -1, 0], [0, 0, 1]] };
  if (typeof direction !== 'string' || !Object.hasOwn(views, direction)) return null;
  const basis = cameraBasis(camera);
  if (!basis || !Number.isFinite(camera.fovDegrees) || camera.fovDegrees <= 0 || camera.fovDegrees >= 180) return null;
  const [back, up] = views[direction], target = [...camera.target];
  const position = target.map((value, axis) => value + back[axis] * basis.distance);
  const next = { ...camera, position, target, up };
  if (!cameraBasis(next)) return null;
  return viewCamera(next, position, target);
}

export function orbitCamera(camera, yaw, pitch, scale = 1, distanceLimit = 200000, distanceMinimum = 0.01) {
  if (!camera || !triplet(camera.position) || !triplet(camera.target)
    || ![yaw, pitch, scale, distanceLimit, distanceMinimum].every(Number.isFinite)
    || (camera.up !== undefined && scale <= 0) || distanceMinimum <= 0 || distanceLimit < distanceMinimum) return null;
  const delta = camera.position.map((value, index) => value - camera.target[index]), initialDistance = Math.hypot(...delta);
  if (!delta.every(Number.isFinite) || !Number.isFinite(initialDistance) || initialDistance <= 0) return null;
  const distance = Math.max(distanceMinimum, Math.min(distanceLimit, initialDistance * scale));
  let heading, up;
  if (camera.up === undefined) {
    // Keep authored cameras' existing world-Y yaw and clamped Euler pitch.
    const angle = Math.atan2(delta[0], delta[2]) + yaw;
    const elevation = Math.max(-Math.PI / 2 + 0.002, Math.min(Math.PI / 2 - 0.002, Math.asin(delta[1] / initialDistance) + pitch));
    heading = [Math.cos(elevation) * Math.sin(angle), Math.sin(elevation), Math.cos(elevation) * Math.cos(angle)];
  } else {
    const basis = cameraBasis(camera); if (!basis) return null;
    if (yaw === 0 && pitch === 0) {
      // Zoom must preserve even an exact pole, with no artificial pitch tilt.
      heading = basis.back; up = [...camera.up];
    } else {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const yawBack = basis.back.map((value, axis) => value * cy + basis.right[axis] * sy);
      heading = normalize3(yawBack.map((value, axis) => value * cp + basis.up[axis] * sp));
      const pitchUp = basis.up.map((value, axis) => value * cp - yawBack[axis] * sp);
      const right = normalize3(cross(pitchUp, heading));
      up = normalize3(cross(heading, right));
    }
  }
  const target = [...camera.target], position = target.map((value, axis) => value + heading[axis] * distance);
  const next = { ...camera, position, target, ...(up ? { up } : {}) };
  if (!cameraBasis(next)) return null;
  return viewCamera(next, position, target);
}

// Translate the view in its current screen plane. CSS pointer distances and
// drawing-buffer aspect are separate: bounded GPU buffers can have a different
// aspect from the CSS canvas. Positive drag keeps target-depth geometry under
// the pointer. Authored camera limits never constrain this temporary view.
export function panCamera(camera, deltaX, deltaY, viewport) {
  if (!camera || !viewport || ![deltaX, deltaY, viewport.width, viewport.height, viewport.aspect, camera.fovDegrees].every(Number.isFinite)
    || viewport.width <= 0 || viewport.height <= 0 || viewport.aspect <= 0
    || camera.fovDegrees <= 0 || camera.fovDegrees >= 180) return null;
  const basis = cameraBasis(camera); if (!basis) return null;
  if (deltaX === 0 && deltaY === 0) return viewCamera(camera, [...camera.position], [...camera.target]);
  const span = 2 * basis.distance * Math.tan(camera.fovDegrees * Math.PI / 360);
  const horizontal = span * viewport.aspect * (deltaX / viewport.width), vertical = span * (deltaY / viewport.height);
  if (![span, horizontal, vertical].every(Number.isFinite)
    || (deltaX !== 0 && horizontal === 0) || (deltaY !== 0 && vertical === 0)) return null;
  const offset = basis.right.map((value, axis) => -value * horizontal + basis.up[axis] * vertical);
  const movement = Math.hypot(...offset);
  if (!offset.every(Number.isFinite) || !Number.isFinite(movement) || movement <= 0) return null;
  const position = camera.position.map((value, axis) => value + offset[axis]);
  const target = camera.target.map((value, axis) => value + offset[axis]);
  const next = { ...camera, position, target }, nextBasis = cameraBasis(next);
  if (!nextBasis) return null;
  // Adding the same finite offset can lose a small eye/target separation at
  // huge coordinates. Tolerate ordinary rounding (including remote millimetre
  // scenes), but reject a material heading/distance change or collapsed drag.
  const oldDelta = camera.position.map((value, axis) => value - camera.target[axis]);
  const newDelta = position.map((value, axis) => value - target[axis]);
  if (Math.hypot(...newDelta.map((value, axis) => value - oldDelta[axis])) > basis.distance * 1e-6) return null;
  const horizontalPixel = span * viewport.aspect / viewport.width, verticalPixel = span / viewport.height;
  if (![horizontalPixel, verticalPixel].every(Number.isFinite) || horizontalPixel <= 0 || verticalPixel <= 0) return null;
  for (const [before, after] of [[camera.position, position], [camera.target, target]]) {
    const actual = after.map((value, axis) => value - before[axis]);
    if (!Math.hypot(...actual) || Math.hypot(...actual.map((value, axis) => value - offset[axis])) > movement * 1e-3) return null;
    // Check each screen axis too: a large vertical move must not hide a lost
    // horizontal drag on a very narrow drawing buffer. Allow subpixel rounding.
    if (Math.abs(dot(actual, basis.right) + horizontal) > Math.max(1, Math.abs(deltaX)) * horizontalPixel * 1e-3
      || Math.abs(dot(actual, basis.up) - vertical) > Math.max(1, Math.abs(deltaY)) * verticalPixel * 1e-3) return null;
  }
  return viewCamera(camera, position, target);
}

// Two CSS contacts control scale and translation together. Keep the world
// point under the starting midpoint attached to the current midpoint on the
// target-depth plane, shared by perspective and orthographic projection.
export function touchCamera(camera, startPoints, currentPoints, viewport, distanceLimit = 200000, distanceMinimum = 0.01) {
  const pair = points => Array.isArray(points) && points.length === 2
    && points.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite));
  if (!pair(startPoints) || !pair(currentPoints) || !camera || !viewport
    || ![viewport.width, viewport.height, viewport.aspect, camera.fovDegrees, distanceLimit, distanceMinimum].every(Number.isFinite)
    || viewport.width <= 0 || viewport.height <= 0 || viewport.aspect <= 0
    || camera.fovDegrees <= 0 || camera.fovDegrees >= 180 || distanceMinimum <= 0 || distanceLimit < distanceMinimum) return null;
  const basis = cameraBasis(camera); if (!basis) return null;
  const separation = points => Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]);
  const startDistance = separation(startPoints), currentDistance = separation(currentPoints);
  if (![startDistance, currentDistance].every(Number.isFinite) || startDistance < 4 || currentDistance < 4) return null;
  const distance = Math.max(distanceMinimum, Math.min(distanceLimit, basis.distance * (startDistance / currentDistance)));
  // Construct the eye directly so a pure pinch never runs the Euler orbit
  // pitch clamp, including nearly vertical cameras without an explicit up.
  const position = distance === basis.distance ? [...camera.position]
    : camera.target.map((value, axis) => value + basis.back[axis] * distance);
  const zoomed = { ...camera, position, target: [...camera.target] }, zoomBasis = cameraBasis(zoomed);
  if (!zoomBasis) return null;
  const delta = position.map((value, axis) => value - camera.target[axis]);
  if (Math.hypot(...delta.map((value, axis) => value - basis.back[axis] * distance)) > distance * 1e-6
    || (distance !== basis.distance && position.every((value, axis) => value === camera.position[axis]))) return null;
  // Use the representable, clamped distance rather than the finger ratio so
  // reaching either zoom limit does not detach the midpoint's world anchor.
  const scale = zoomBasis.distance / basis.distance;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const midpoint = points => [0, 1].map(axis => points[0][axis] / 2 + points[1][axis] / 2);
  const start = midpoint(startPoints), current = midpoint(currentPoints);
  const correction = (scale - 1) / scale;
  const dx = current[0] - start[0] + (start[0] - viewport.width / 2) * correction;
  const dy = current[1] - start[1] + (start[1] - viewport.height / 2) * correction;
  return panCamera(zoomed, dx, dy, viewport);
}

// The sphere enclosing all eight box corners is rotation invariant. Frame it
// against the smaller actual viewport extent, keeping the current heading.
// These are temporary view values; author camera clipping remains untouched.
export function frameCamera(camera, object, aspect, projectionMode = 'perspective') {
  if (!['perspective', 'orthographic'].includes(projectionMode) || !camera || !object || !triplet(camera.position) || !triplet(camera.target)
    || !triplet(object.position) || !triplet(object.size) || object.size.some(value => value <= 0)
    || !Number.isFinite(aspect) || aspect <= 0 || !Number.isFinite(camera.fovDegrees)
    || camera.fovDegrees <= 0 || camera.fovDegrees >= 180) return null;
  const basis = cameraBasis(camera); if (!basis) return null;
  const heading = basis.back, radius = Math.hypot(...object.size) / 2;
  const vertical = camera.fovDegrees * Math.PI / 360;
  const halfAngle = Math.min(vertical, Math.atan(Math.tan(vertical) * aspect));
  const distance = projectionMode === 'orthographic'
    ? Math.max(2 * radius, 1.2 * radius / (Math.tan(vertical) * Math.min(1, aspect)))
    : radius * 1.2 / Math.sin(halfAngle);
  const target = [...object.position], position = target.map((value, index) => value + heading[index] * distance);
  const near = (distance - radius) / 2, far = distance + radius * 2;
  if (![...position, distance, near, far].every(Number.isFinite) || near <= 0 || far <= near) return null;
  if (!cameraBasis({ ...camera, position, target })) return null;
  return viewCamera(camera, position, target, { near, far });
}
// Bounds use every transformed box corner. A missing or malformed object
// rejects the complete scene rather than shrinking its view by omission.
export function sceneBounds(objects) {
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
// sphere fits the narrower drawing-buffer extent, preserving heading/FOV.
export function frameSceneCamera(camera, objects, aspect, projectionMode = 'perspective') {
  if (!['perspective', 'orthographic'].includes(projectionMode) || !camera || !triplet(camera.position) || !triplet(camera.target)
    || !Number.isFinite(camera.fovDegrees) || camera.fovDegrees <= 0 || camera.fovDegrees >= 180
    || !Number.isFinite(aspect) || aspect <= 0) return null;
  const basis = cameraBasis(camera); if (!basis) return null;
  const bounds = sceneBounds(objects); if (!bounds) return null;
  const heading = basis.back, vertical = camera.fovDegrees * Math.PI / 360;
  const halfAngle = Math.min(vertical, Math.atan(Math.tan(vertical) * aspect));
  const distance = projectionMode === 'orthographic'
    ? Math.max(2 * bounds.radius, 1.2 * bounds.radius / (Math.tan(vertical) * Math.min(1, aspect)))
    : bounds.radius * 1.2 / Math.sin(halfAngle);
  const target = [...bounds.center], position = target.map((value, axis) => value + heading[axis] * distance);
  const near = (distance - bounds.radius) / 2, far = distance + bounds.radius * 2;
  if (![...position, distance, near, far].every(Number.isFinite) || near <= 0 || far <= near) return null;
  // A finite distance can still disappear when added to a huge world target.
  if (!cameraBasis({ ...camera, position, target })) return null;
  return viewCamera(camera, position, target, { near, far });
}
export const color3 = hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255);
