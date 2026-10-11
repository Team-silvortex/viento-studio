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
export function orbitCamera(camera, yaw, pitch, scale = 1) {
  const delta = camera.position.map((value, index) => value - camera.target[index]);
  const distance = Math.max(0.01, Math.min(200000, Math.hypot(...delta) * scale));
  const angle = Math.atan2(delta[0], delta[2]) + yaw;
  const elevation = Math.max(-Math.PI / 2 + 0.002, Math.min(Math.PI / 2 - 0.002, Math.asin(delta[1] / Math.hypot(...delta)) + pitch));
  return { ...camera, target: [...camera.target], position: camera.target.map((value, index) => value +
    [distance * Math.cos(elevation) * Math.sin(angle), distance * Math.sin(elevation), distance * Math.cos(elevation) * Math.cos(angle)][index]) };
}
export const color3 = hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255);
