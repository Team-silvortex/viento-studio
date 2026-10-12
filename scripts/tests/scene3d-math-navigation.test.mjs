import test from 'node:test';
import assert from 'node:assert/strict';
import { frameCamera } from '../../web/modules/scene3d-math.js';

const unit = v => { const length = Math.hypot(...v); return v.map(n => n / length); };
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const camera = { position: [9, 7, 10], target: [0, 1, 0], fovDegrees: 60, near: .05, far: 1000 };
const object = { position: [2, 3, 4], rotationDegrees: [23, -41, 67], size: [2, 3, 4] };
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
// Independent geometry: rotate each corner sequentially Z, Y, X, then use
// camera basis dot products. Do not call the frame helper's sphere algorithm.
function corners(value) {
  const [x, y, z] = value.rotationDegrees.map(n => n * Math.PI / 180), result = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    let [a, b, c] = [value.size[0] * sx / 2, value.size[1] * sy / 2, value.size[2] * sz / 2];
    [a, b] = [a * Math.cos(z) - b * Math.sin(z), a * Math.sin(z) + b * Math.cos(z)];
    [a, c] = [a * Math.cos(y) + c * Math.sin(y), -a * Math.sin(y) + c * Math.cos(y)];
    [b, c] = [b * Math.cos(x) - c * Math.sin(x), b * Math.sin(x) + c * Math.cos(x)];
    result.push([a, b, c].map((n, i) => n + value.position[i]));
  }
  return result;
}
function assertContained(view, box, aspect) {
  const back = unit(view.position.map((n, i) => n - view.target[i]));
  const right = unit(cross([0, 1, 0], back)), up = cross(back, right), tangent = Math.tan(view.fovDegrees * Math.PI / 360);
  for (const corner of corners(box)) {
    const relative = corner.map((n, i) => n - view.position[i]);
    const depth = -dot(relative, back), x = dot(relative, right) / (depth * tangent * aspect), y = dot(relative, up) / (depth * tangent);
    assert.ok(depth > view.near && depth < view.far, `corner depth ${depth} outside ${view.near}..${view.far}`);
    assert.ok(Math.abs(x) <= 1 / 1.2 + 1e-5 && Math.abs(y) <= 1 / 1.2 + 1e-5, `corner clipping x=${x} y=${y} aspect=${aspect}`);
  }
}

test('framing is detached frozen view data preserving heading FOV and all author inputs', () => {
  const cam = freeze(structuredClone(camera)), box = freeze(structuredClone(object)), before = JSON.stringify([cam, box]);
  const framed = frameCamera(cam, box, .4);
  assert.ok(Object.isFrozen(framed) && Object.isFrozen(framed.position) && Object.isFrozen(framed.target));
  assert.notEqual(framed.position, cam.position); assert.notEqual(framed.target, box.position);
  assert.equal(JSON.stringify([cam, box]), before); assert.deepEqual(framed.target, box.position); assert.equal(framed.fovDegrees, cam.fovDegrees);
  const a = unit(cam.position.map((n, i) => n - cam.target[i])), b = unit(framed.position.map((n, i) => n - framed.target[i]));
  a.forEach((n, i) => assert.ok(Math.abs(n - b[i]) < 1e-12)); assertContained(framed, box, .4);
});
test('eight independently transformed corners fit extreme size position rotation FOV and narrow or wide aspect', () => {
  let cases = 0;
  for (const size of [[.001, .001, .001], [1000, 1000, 1000], [.001, 1000, .001], [17, 1, 299]])
    for (const position of [[100000, -100000, 100000], [-100000, 100000, -100000]])
      for (const rotationDegrees of [[23, -41, 67], [36000, -35999, 179]])
        for (const fovDegrees of [1, 60, 179]) for (const aspect of [1 / 8192, 1 / 2048, .2, 1, 8192]) {
          const box = { size, position, rotationDegrees }, cam = { ...camera, fovDegrees, near: 10000, far: 100000 };
          const result = frameCamera(cam, box, aspect); assert.ok(result); assertContained(result, box, aspect); cases++;
        }
  assert.equal(cases, 240);
});
test('rotating a nonuniform box never changes its enclosing sphere framing distance', () => {
  const first = frameCamera(camera, { ...object, rotationDegrees: [0, 0, 0] }, .7);
  const rotated = frameCamera(camera, { ...object, rotationDegrees: [37, -81, 129] }, .7);
  assert.deepEqual(first, rotated); assertContained(rotated, { ...object, rotationDegrees: [37, -81, 129] }, .7);
});
test('framing permits a view farther than 200000 and below author minimum near while repairing short author clipping', () => {
  const large = frameCamera({ ...camera, fovDegrees: 1, near: .001, far: 1 }, { ...object, size: [1000, 1000, 1000] }, 1 / 8192);
  assert.ok(Math.hypot(...large.position.map((n, i) => n - large.target[i])) > 200000); assertContained(large, { ...object, size: [1000, 1000, 1000] }, 1 / 8192);
  const small = frameCamera({ ...camera, fovDegrees: 179, near: 10000, far: 100000 }, { ...object, size: [.001, .001, .001] }, 1);
  assert.ok(small.near < .001); assertContained(small, { ...object, size: [.001, .001, .001] }, 1);
});
test('missing degenerate or unbounded view inputs fail without changing caller data', () => {
  const cases = [ [null, object, 1], [camera, null, 1], [camera, object, 0], [camera, object, NaN], [camera, object, Infinity],
    [{ ...camera, fovDegrees: 0 }, object, 1], [{ ...camera, fovDegrees: 180 }, object, 1],
    [{ ...camera, position: camera.target }, object, 1], [{ ...camera, position: [0, 3, 0], target: [0, 0, 0] }, object, 1],
    [camera, { ...object, size: [0, 1, 1] }, 1], [camera, { ...object, position: [Infinity, 1, 1] }, 1], [camera, object, Number.MIN_VALUE] ];
  for (const input of cases) assert.equal(frameCamera(...input), null);
  assert.deepEqual(camera.position, [9, 7, 10]); assert.deepEqual(object.position, [2, 3, 4]);
});
