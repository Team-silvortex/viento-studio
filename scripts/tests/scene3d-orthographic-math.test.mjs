import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraProjection4, perspective4, standardViewCamera, frameCamera, frameSceneCamera, panCamera, orbitCamera } from '../../web/modules/scene3d-math.js';

const camera = { position: [9, 7, 10], target: [0, 1, 0], fovDegrees: 60, near: .05, far: 1000 };
const object = { position: [2, 3, 4], rotationDegrees: [23, -41, 67], size: [2, 3, 4] };
const directions = ['front', 'back', 'left', 'right', 'top', 'bottom'];
const difference = (a, b) => a.map((n, i) => n - b[i]);
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = value => { const length = Math.hypot(...value); return value.map(n => n / length); };
const distance = view => Math.hypot(...difference(view.position, view.target));
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function close(actual, expected, tolerance = 1e-10) {
  assert.equal(actual.length, expected.length);
  actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) <= tolerance, `${actual} != ${expected} at ${i}`));
}
function axes(view) {
  const back = unit(difference(view.position, view.target)), right = unit(cross(view.up || [0, 1, 0], back));
  return { back, right, up: cross(back, right) };
}
function multiply(matrix, point) { return [0, 1, 2, 3].map(row => point.reduce((sum, n, column) => sum + n * matrix[column * 4 + row], 0)); }
function clip(view, point, aspect, mode) {
  const basis = axes(view), relative = difference(point, view.position);
  return multiply(cameraProjection4(view, aspect, mode), [dot(relative, basis.right), dot(relative, basis.up), dot(relative, basis.back), 1]);
}
function pixels(view, point, viewport, mode) {
  const value = clip(view, point, viewport.aspect, mode);
  return [(value[0] / value[3] + 1) * viewport.width / 2, (1 - value[1] / value[3]) * viewport.height / 2];
}
function planePoint(view, x, y, depth) {
  const basis = axes(view);
  return view.position.map((n, i) => n + basis.right[i] * x + basis.up[i] * y - basis.back[i] * depth);
}
// Rotate each independent author corner sequentially Z, Y, X. Neither this
// geometry nor camera-space dot products uses production object/lookAt math.
function corners(box) {
  const [x, y, z] = box.rotationDegrees.map(n => n * Math.PI / 180), points = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    let [a, b, c] = box.size.map((n, i) => n * [sx, sy, sz][i] / 2);
    [a, b] = [a * Math.cos(z) - b * Math.sin(z), a * Math.sin(z) + b * Math.cos(z)];
    [a, c] = [a * Math.cos(y) + c * Math.sin(y), -a * Math.sin(y) + c * Math.cos(y)];
    [b, c] = [b * Math.cos(x) - c * Math.sin(x), b * Math.sin(x) + c * Math.cos(x)];
    points.push([a, b, c].map((n, i) => n + box.position[i]));
  }
  return points;
}
function assertContained(view, objects, aspect) {
  assert.ok(view); assert.ok(cameraProjection4(view, aspect, 'orthographic'));
  for (const point of objects.flatMap(corners)) {
    const value = clip(view, point, aspect, 'orthographic');
    assert.equal(value[3], 1); assert.ok(value.every(Number.isFinite));
    assert.ok(Math.abs(value[0]) <= 1 / 1.2 + 1e-5 && Math.abs(value[1]) <= 1 / 1.2 + 1e-5, `corner outside viewport ${value}`);
    assert.ok(value[2] > -1 && value[2] < 1, `corner outside depth ${value}`);
  }
}

test('perspective helper returns the original projection values exactly and freezes a detached matrix', () => {
  const source = freeze(structuredClone(camera)), before = JSON.stringify(source);
  for (const fovDegrees of [1, 60, 179]) for (const aspect of [1 / 8192, .3, 1, 8192]) {
    const view = { ...source, fovDegrees }, expected = perspective4(fovDegrees, aspect, source.near, source.far);
    const implicit = cameraProjection4(view, aspect), explicit = cameraProjection4(view, aspect, 'perspective');
    assert.deepEqual(implicit, expected); assert.deepEqual(explicit, expected); assert.notEqual(implicit, explicit); assert.ok(Object.isFrozen(implicit));
  }
  assert.equal(JSON.stringify(source), before);
});

test('orthographic projection alone has known right-handed OpenGL scale and maps near/far to minus/plus one', () => {
  const view = { ...camera, position: [0, 0, 10], target: [0, 0, 0], fovDegrees: 90, near: 2, far: 100 };
  const projection = cameraProjection4(view, 2, 'orthographic'); assert.ok(Object.isFrozen(projection));
  close(projection, [.05, 0, 0, 0, 0, .1, 0, 0, 0, 0, -2 / 98, 0, 0, 0, -102 / 98, 1]);
  close(multiply(projection, [0, 0, -2, 1]), [0, 0, -1, 1]);
  close(multiply(projection, [0, 0, -100, 1]), [0, 0, 1, 1]);
  const upperRight = multiply(projection, [20, 10, -10, 1]); close(upperRight.slice(0, 2), [1, 1]);
  const shifted = { ...view, position: [7, 3, 10], target: [7, 3, 0] };
  assert.deepEqual(cameraProjection4(shifted, 2, 'orthographic'), projection, 'projection must not include a lookAt translation');
});

test('equal geometry keeps equal screen size at every orthographic depth while perspective retains depth scaling', () => {
  const viewport = { width: 800, height: 600, aspect: 4 / 3 };
  for (const source of [...directions.map(name => standardViewCamera(camera, name)), { ...camera, up: [1, 3, -.5] }]) {
    const sizes = [], perspectiveSizes = [];
    for (const factor of [.25, 1, 4]) {
      const depth = distance(source) * factor, a = planePoint(source, -1, -.5, depth), b = planePoint(source, 1, .5, depth);
      sizes.push(difference(pixels(source, b, viewport, 'orthographic'), pixels(source, a, viewport, 'orthographic')));
      perspectiveSizes.push(difference(pixels(source, b, viewport, 'perspective'), pixels(source, a, viewport, 'perspective')));
    }
    close(sizes[0], sizes[1]); close(sizes[1], sizes[2]);
    close(perspectiveSizes[0], perspectiveSizes[1].map(n => n * 4)); close(perspectiveSizes[2], perspectiveSizes[1].map(n => n / 4));
  }
});

test('switching projection preserves target-plane screen coordinates for six exact views and a free rolled view', () => {
  const sourceViews = [...directions.map(name => standardViewCamera(camera, name)), { ...camera, up: [1, 3, -.5] }];
  for (const source of sourceViews) for (const aspect of [1 / 8192, .4, 1, 8192]) {
    const viewport = { width: 390, height: 844, aspect }, before = JSON.stringify(source);
    for (const [x, y] of [[0, 0], [1, 2], [-.5, 3]]) {
      const point = planePoint(source, x, y, distance(source));
      close(pixels(source, point, viewport, 'orthographic'), pixels(source, point, viewport, 'perspective'), 1e-7);
    }
    assert.equal(JSON.stringify(source), before);
  }
});

test('unchanged panCamera tracks CSS drag at all orthographic depths and uses actual drawing-buffer aspect', () => {
  for (const source of [...directions.map(name => standardViewCamera(camera, name)), { ...camera, up: [1, 3, -.5] }])
    for (const aspect of [1 / 8192, 4 / 3, 8192]) {
      const viewport = { width: 390, height: 844, aspect }, moved = panCamera(source, 17, -11, viewport); assert.ok(moved);
      for (const factor of [.25, 1, 5]) {
        const point = planePoint(source, .5, -.3, distance(source) * factor);
        close(difference(pixels(moved, point, viewport, 'orthographic'), pixels(source, point, viewport, 'orthographic')), [17, -11], 1e-7);
      }
    }
});

test('orthographic wheel zoom changes size without changing axial direction or temporary up', () => {
  const viewport = { width: 800, height: 600, aspect: 4 / 3 };
  for (const direction of ['top', 'bottom']) {
    const source = standardViewCamera(camera, direction), zoomed = orbitCamera(source, 0, 0, .5);
    const points = [planePoint(source, -1, 0, distance(source)), planePoint(source, 1, 0, distance(source))];
    const initialWidth = pixels(source, points[1], viewport, 'orthographic')[0] - pixels(source, points[0], viewport, 'orthographic')[0];
    const zoomWidth = pixels(zoomed, points[1], viewport, 'orthographic')[0] - pixels(zoomed, points[0], viewport, 'orthographic')[0];
    assert.ok(Math.abs(zoomWidth - initialWidth * 2) < 1e-10); close(axes(zoomed).back, axes(source).back, 0); assert.deepEqual(zoomed.up, source.up);
  }
});

test('orthographic single-object framing contains rotated extreme boxes including remote millimetres at six axes and free views', () => {
  let cases = 0;
  for (const size of [[.001, .001, .001], [1000, .001, 1000]]) for (const fovDegrees of [1, 60, 179])
    for (const aspect of [1 / 8192, .3, 1, 8192]) for (const direction of [...directions, 'free']) {
      const box = { ...object, position: [100000, -100000, 100000], size };
      const source = direction === 'free' ? { ...camera, fovDegrees, up: [1, 3, -.5] } : standardViewCamera({ ...camera, fovDegrees }, direction);
      const before = JSON.stringify([source, box]), view = frameCamera(source, box, aspect, 'orthographic');
      assertContained(view, [box], aspect); close(axes(view).back, axes(source).back, 1e-7);
      assert.equal(view.fovDegrees, source.fovDegrees); assert.equal(JSON.stringify([source, box]), before);
      assert.ok(Object.isFrozen(view) && Object.isFrozen(view.position) && Object.isFrozen(view.target));
      if (source.up) { assert.deepEqual(view.up, source.up); assert.notEqual(view.up, source.up); assert.ok(Object.isFrozen(view.up)); }
      cases++;
    }
  assert.equal(cases, 168);
});

test('orthographic whole-scene framing includes all 128 rotated boxes and keeps temporary clipping safely beyond sphere depth', () => {
  const objects = freeze(Array.from({ length: 128 }, (_, i) => ({ position: [i % 2 ? 100000 : -100000, i % 3 ? 100000 : -100000, i % 5 ? 100000 : -100000],
    rotationDegrees: [i * 287, -35999 + i, 179 - i], size: i % 3 ? [.001, 1000, .001] : [1000, .001, 1000] })));
  const before = JSON.stringify(objects);
  for (const direction of directions) for (const aspect of [1 / 8192, .2, 1, 8192]) {
    const source = standardViewCamera({ ...camera, fovDegrees: 179 }, direction), view = frameSceneCamera(source, objects, aspect, 'orthographic');
    assertContained(view, objects, aspect); close(axes(view).back, axes(source).back, 0);
    assert.equal(view.fovDegrees, source.fovDegrees); assert.ok(view.near > 0 && view.far > distance(view));
  }
  assert.equal(JSON.stringify(objects), before);
});

test('default and explicit perspective framing preserve the exact prior sphere distance and output', () => {
  for (const aspect of [1 / 8192, .3, 1, 8192]) for (const source of [camera, standardViewCamera(camera, 'top')]) {
    const vertical = source.fovDegrees * Math.PI / 360, halfAngle = Math.min(vertical, Math.atan(Math.tan(vertical) * aspect));
    const expectedDistance = Math.hypot(...object.size) / 2 * 1.2 / Math.sin(halfAngle), heading = axes(source).back;
    const expectedPosition = object.position.map((n, i) => n + heading[i] * expectedDistance);
    const implicit = frameCamera(source, object, aspect), explicit = frameCamera(source, object, aspect, 'perspective');
    assert.deepEqual(implicit, explicit); close(explicit.position, expectedPosition, expectedDistance * 1e-14);
    assert.deepEqual(frameSceneCamera(source, [object], aspect), frameSceneCamera(source, [object], aspect, 'perspective'));
  }
});

test('invalid projection modes camera clipping and unrepresentable scales reject without changing source data', () => {
  const before = JSON.stringify(camera);
  for (const mode of [null, 'Orthographic', '', 'parallel', 1, {}, ['orthographic']]) {
    assert.equal(cameraProjection4(camera, 1, mode), null); assert.equal(frameCamera(camera, object, 1, mode), null); assert.equal(frameSceneCamera(camera, [object], 1, mode), null);
  }
  for (const source of [null, {}, { ...camera, near: 0 }, { ...camera, near: -1 }, { ...camera, near: Infinity }, { ...camera, far: camera.near },
    { ...camera, far: NaN }, { ...camera, fovDegrees: 0 }, { ...camera, fovDegrees: 180 }, { ...camera, position: camera.target },
    { ...camera, position: [0, 3, 0], target: [0, 0, 0] }, { ...camera, up: [0, 0, 0] }, { ...camera, up: difference(camera.position, camera.target) }])
    for (const mode of ['perspective', 'orthographic']) assert.equal(cameraProjection4(source, 1, mode), null);
  for (const aspect of [0, -1, NaN, Infinity, Number.MIN_VALUE]) assert.equal(cameraProjection4(camera, aspect, 'orthographic'), null);
  assert.equal(cameraProjection4({ ...camera, position: [0, 0, 1e308], target: [0, 0, 0] }, 1, 'orthographic'), null);
  assert.equal(cameraProjection4(camera, Number.MAX_VALUE, 'orthographic'), null);
  assert.equal(frameCamera(camera, { ...object, size: [1e308, 1e308, 1e308] }, 1 / 8192, 'orthographic'), null);
  assert.equal(frameSceneCamera(camera, [{ ...object, size: [1e308, 1e308, 1e308] }], 1 / 8192, 'orthographic'), null);
  assert.equal(JSON.stringify(camera), before);
});
