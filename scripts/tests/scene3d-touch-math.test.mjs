import test from 'node:test';
import assert from 'node:assert/strict';
import { touchCamera, standardViewCamera, panCamera, frameSceneCamera } from '../../web/modules/scene3d-math.js';

const camera = { position: [9, 7, 10], target: [0, 1, 0], fovDegrees: 60, near: .05, far: 1000 };
const viewport = { width: 800, height: 600, aspect: 4 / 3 };
const directions = ['front', 'back', 'left', 'right', 'top', 'bottom'];
const difference = (a, b) => a.map((value, axis) => value - b[axis]);
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = vector => { const length = Math.hypot(...vector); return vector.map(value => value / length); };
const distance = view => Math.hypot(...difference(view.position, view.target));
const midpoint = points => [0, 1].map(axis => (points[0][axis] + points[1][axis]) / 2);
const contacts = (center, radius, angle = 0) => [-1, 1].map(sign => [center[0] + sign * radius * Math.cos(angle), center[1] + sign * radius * Math.sin(angle)]);
const views = () => [...directions.map(direction => standardViewCamera(camera, direction)), camera, { ...camera, up: [1, 3, -.5] }];
function close(actual, expected, tolerance = 1e-8) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) <= tolerance, `${actual} != ${expected} at ${axis}`));
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function axes(view) {
  const back = unit(difference(view.position, view.target)), right = unit(cross(view.up || [0, 1, 0], back));
  return { back, right, up: cross(back, right) };
}
function matrixPoint(matrix, point) { return [0, 1, 2, 3].map(row => point.reduce((sum, value, column) => sum + value * matrix[column * 4 + row], 0)); }
// Build independent view and projection matrices; no production projection or
// pan implementation is used to decide where a target-plane point lands.
function pixels(view, point, size, mode) {
  const { back, right, up } = axes(view), f = 1 / Math.tan(view.fovDegrees * Math.PI / 360), range = 1 / (view.near - view.far);
  const viewMatrix = [right[0], up[0], back[0], 0, right[1], up[1], back[1], 0, right[2], up[2], back[2], 0,
    -dot(right, view.position), -dot(up, view.position), -dot(back, view.position), 1];
  const projection = mode === 'perspective'
    ? [f / size.aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (view.far + view.near) * range, -1, 0, 0, 2 * view.far * view.near * range, 0]
    : [f / (distance(view) * size.aspect), 0, 0, 0, 0, f / distance(view), 0, 0, 0, 0, 2 * range, 0, 0, 0, (view.far + view.near) * range, 1];
  const clip = matrixPoint(projection, matrixPoint(viewMatrix, [...point, 1]));
  return [(clip[0] / clip[3] + 1) * size.width / 2, (1 - clip[1] / clip[3]) * size.height / 2];
}
function worldAt(view, point, size) {
  const { right, up } = axes(view), halfHeight = distance(view) * Math.tan(view.fovDegrees * Math.PI / 360);
  const x = (point[0] * 2 / size.width - 1) * halfHeight * size.aspect, y = (1 - point[1] * 2 / size.height) * halfHeight;
  return view.target.map((value, axis) => value + right[axis] * x + up[axis] * y);
}
function assertAnchored(source, result, start, current, size, tolerance = 1e-8) {
  assert.ok(result); const a = midpoint(start), b = midpoint(current), scale = distance(source) / distance(result);
  for (const mode of ['perspective', 'orthographic']) {
    close(pixels(result, worldAt(source, a, size), size, mode), b, tolerance);
    for (const sample of [[0, 0], [size.width * .23, size.height * .67], [size.width, size.height]]) {
      const world = worldAt(source, sample, size);
      close(pixels(result, world, size, mode), sample.map((value, axis) => b[axis] + (value - a[axis]) * scale), tolerance);
    }
  }
  close(axes(result).back, axes(source).back, 1e-7);
  for (const key of ['fovDegrees', 'near', 'far']) assert.equal(result[key], source[key]);
  assert.deepEqual(result.up, source.up);
}

test('pinch and midpoint translation anchor target-plane geometry in both projections at all six views and free headings', () => {
  for (const source of views()) for (const [start, current] of [
    [contacts([263, 173], 35), contacts([307, 211], 70)],
    [contacts([563, 473], 70), contacts([491, 447], 35)],
    [contacts([121, 413], 40), contacts([199, 381], 40)],
    [contacts([400, 300], 80), contacts([400, 300], 20)],
  ]) assertAnchored(source, touchCamera(source, start, current, viewport), start, current, viewport);
});

test('CSS dimensions remain independent from extreme drawing-buffer aspects during combined gestures', () => {
  for (const source of [standardViewCamera(camera, 'top'), { ...camera, up: [1, 3, -.5] }])
    for (const size of [{ width: 390, height: 844, aspect: 1 / 8192 }, { width: 8192, height: 2, aspect: 4 / 3 }, { width: 800, height: 600, aspect: 8192 }]) {
      const start = contacts([size.width * .43, size.height * .51], 20), current = contacts([size.width * .48, size.height * .49], 31);
      assertAnchored(source, touchCamera(source, start, current, size), start, current, size, .0001);
    }
});

test('both distance clamps preserve the off-center world anchor using effective scale rather than finger scale', () => {
  const source = { ...camera, position: [0, 0, 10], target: [0, 0, 0] };
  for (const [start, current, expected] of [
    [contacts([271, 179], 10), contacts([318, 211], 200), 2],
    [contacts([571, 479], 200), contacts([518, 411], 10), 20],
  ]) {
    const result = touchCamera(source, start, current, viewport, 20, 2); assert.ok(result); assert.equal(distance(result), expected);
    assertAnchored(source, result, start, current, viewport);
  }
});

test('pure zoom preserves exact poles and nearly vertical implicit-up heading without Euler pitch clamping', () => {
  const nearPole = { ...camera, position: [.000001, 10, .000002], target: [0, 0, 0] };
  for (const source of [standardViewCamera(camera, 'top'), standardViewCamera(camera, 'bottom'), nearPole]) {
    const start = contacts([400, 300], 20), current = contacts([400, 300], 40), result = touchCamera(source, start, current, viewport);
    assert.ok(result); close(axes(result).back, axes(source).back, 1e-15); close(result.target, source.target, 0);
    assert.equal(Object.hasOwn(result, 'up'), Object.hasOwn(source, 'up'));
    if (source.up) assert.deepEqual(result.up, source.up);
    assertAnchored(source, result, start, current, viewport);
  }
});

test('rotating or swapping the two contacts does not roll the view or change its scale', () => {
  for (const source of views()) {
    const start = [[300, 300], [500, 300]];
    for (const current of [[[400, 200], [400, 400]], [...start].reverse()]) {
      const result = touchCamera(source, start, current, viewport); assert.deepEqual(result, source); assert.notEqual(result, source);
    }
  }
});

test('equal finger separation matches plain panning and tiny representable midpoint movement is retained', () => {
  const source = { ...camera, position: [0, 0, 10], target: [0, 0, 0] }, start = [[-20, 0], [20, 0]];
  const current = start.map(([x, y]) => [x + 17, y - 11]);
  assert.deepEqual(touchCamera(source, start, current, viewport), panCamera(source, 17, -11, viewport));
  const tiny = start.map(([x]) => [x, 1e-20]), result = touchCamera(source, start, tiny, viewport);
  assert.ok(result); assert.notEqual(result.target[1], 0); assert.equal(result.target[0], 0);
  assert.deepEqual(result, panCamera(source, 0, 1e-20, viewport));
});

test('rebaselining successful contacts at a zoom limit responds immediately when pinch direction reverses', () => {
  const source = { ...camera, position: [0, 0, 10], target: [0, 0, 0] }, initial = contacts([270, 170], 10);
  const limitedPoints = contacts([290, 190], 200), limited = touchCamera(source, initial, limitedPoints, viewport, 20, 2);
  assert.ok(limited); assert.equal(distance(limited), 2);
  const reversedPoints = contacts([295, 192], 190), reversed = touchCamera(limited, limitedPoints, reversedPoints, viewport, 20, 2);
  assert.ok(reversed); assert.ok(distance(reversed) > 2); assertAnchored(limited, reversed, limitedPoints, reversedPoints, viewport);
});

test('frozen inputs remain unchanged and successful or no-op results detach and freeze their view vectors', () => {
  const source = freeze({ ...structuredClone(camera), up: [1, 3, -.5] }), size = freeze({ ...viewport });
  const start = freeze(contacts([270, 170], 30)), current = freeze(contacts([300, 190], 50));
  const before = JSON.stringify([source, start, current, size]);
  for (const points of [start, current]) {
    const result = touchCamera(source, start, points, size); assert.ok(result); assert.ok(Object.isFrozen(result)); assert.notEqual(result, source);
    for (const key of ['position', 'target', 'up']) { assert.notEqual(result[key], source[key]); assert.ok(Object.isFrozen(result[key])); }
    assert.throws(() => { result.position[0] = 999; }, TypeError);
  }
  assert.equal(JSON.stringify([source, start, current, size]), before);
});

test('focused remote millimetre geometry keeps a stable target-plane anchor during touch navigation', () => {
  const objects = [{ position: [100000, -100000, 100000], size: [.001, .001, .001], rotationDegrees: [23, -41, 67] }];
  const start = contacts([170, 390], 30), current = contacts([181, 381], 43), size = { width: 390, height: 844, aspect: .5 };
  for (const direction of directions) {
    const source = frameSceneCamera(standardViewCamera(camera, direction), objects, size.aspect);
    const result = touchCamera(source, start, current, size, 200000, .00001);
    assertAnchored(source, result, start, current, size, .02);
  }
});

test('malformed contacts and sub-four-pixel separations are rejected atomically', () => {
  const start = [[10, 20], [30, 40]], before = JSON.stringify([camera, start, viewport]);
  for (const invalid of [null, {}, [], [[1, 2]], [[1, 2], [3, 4], [5, 6]], [[1, 2, 3], [4, 5]], [[1, 2], [3, NaN]],
    [[1, 2], [Infinity, 3]], [[1, 2], ['4', 5]], [[1, 2], [1, 2]], [[1, 2], [4.999, 2]], [[-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 0]]]) {
    assert.equal(touchCamera(camera, invalid, start, viewport), null);
    assert.equal(touchCamera(camera, start, invalid, viewport), null);
  }
  assert.ok(touchCamera(camera, [[0, 0], [4, 0]], [[0, 0], [4, 0]], viewport));
  assert.equal(JSON.stringify([camera, start, viewport]), before);
});

test('invalid camera basis viewport FOV and distance bounds fail without mutating inputs', () => {
  const start = contacts([400, 300], 20), current = contacts([401, 302], 30), before = JSON.stringify(camera);
  for (const source of [null, {}, { ...camera, fovDegrees: 0 }, { ...camera, fovDegrees: 180 }, { ...camera, fovDegrees: NaN },
    { ...camera, position: camera.target }, { ...camera, position: [Infinity, 0, 0] }, { ...camera, up: [0, 0, 0] },
    { ...camera, up: difference(camera.position, camera.target) }, { ...camera, position: [0, 3, 0], target: [0, 0, 0] }])
    assert.equal(touchCamera(source, start, current, viewport), null);
  for (const size of [null, {}, { ...viewport, width: 0 }, { ...viewport, height: -1 }, { ...viewport, aspect: 0 },
    { ...viewport, width: Infinity }, { ...viewport, height: NaN }, { ...viewport, aspect: Infinity }]) assert.equal(touchCamera(camera, start, current, size), null);
  for (const [maximum, minimum] of [[0, .01], [-1, .01], [1, 2], [1, 0], [NaN, .01], [Infinity, .01], [1, NaN], [1, Infinity]])
    assert.equal(touchCamera(camera, start, current, viewport, maximum, minimum), null);
  assert.equal(JSON.stringify(camera), before);
});

test('unrepresentable zoom and wholly lost or overflowing translation reject the entire gesture', () => {
  const front = { ...camera, position: [0, 0, 10], target: [0, 0, 0] }, start = contacts([400, 300], 20);
  const cases = [
    [{ ...front, position: [1e30, 0, 10], target: [1e30, 0, 0] }, start, contacts([401, 300], 20), viewport],
    [front, start, contacts([1e300, 1e300], 1e290), { width: .001, height: .001, aspect: 1e30 }],
    [{ ...front, position: [0, 0, 1e30 + 1e15], target: [0, 0, 1e30] }, start, contacts([400, 300], 40), viewport],
    [camera, start, contacts([1e20, 1e20], 20000), viewport],
  ];
  for (const [source, initial, current, size] of cases) {
    const before = JSON.stringify([source, initial, current, size]); assert.equal(touchCamera(source, initial, current, size), null);
    assert.equal(JSON.stringify([source, initial, current, size]), before);
  }
});
