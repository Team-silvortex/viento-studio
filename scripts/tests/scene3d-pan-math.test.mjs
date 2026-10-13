import test from 'node:test';
import assert from 'node:assert/strict';
import { panCamera, standardViewCamera, frameCamera, frameSceneCamera, orbitCamera } from '../../web/modules/scene3d-math.js';

const camera = { position: [9, 7, 10], target: [0, 1, 0], fovDegrees: 60, near: .05, far: 1000 };
const viewport = { width: 800, height: 600, aspect: 4 / 3 };
const directions = ['front', 'back', 'left', 'right', 'top', 'bottom'];
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = value => { const length = Math.hypot(...value); return value.map(n => n / length); };
const difference = (a, b) => a.map((n, i) => n - b[i]);
const distance = view => Math.hypot(...difference(view.position, view.target));
function close(actual, expected, tolerance = 1e-10) {
  assert.equal(actual.length, expected.length);
  actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) <= tolerance, `${actual} != ${expected} at ${i}`));
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function axes(view) {
  const back = unit(difference(view.position, view.target)), right = unit(cross(view.up || [0, 1, 0], back));
  return { back, right, up: cross(back, right) };
}
// Independent perspective reprojection onto CSS pixels, using the supplied GPU
// aspect rather than assuming the CSS box and drawing buffer have equal ratios.
function project(view, point, size) {
  const basis = axes(view), relative = difference(point, view.position), depth = -dot(relative, basis.back);
  const tangent = Math.tan(view.fovDegrees * Math.PI / 360);
  return [(dot(relative, basis.right) / (depth * tangent * size.aspect) + 1) * size.width / 2,
    (1 - dot(relative, basis.up) / (depth * tangent)) * size.height / 2];
}
function targetPlane(view) {
  const basis = axes(view), radius = distance(view) * .03;
  return [[0, 0], [-1, 1], [2, -3]].map(([x, y]) => view.target.map((n, i) => n + radius * (basis.right[i] * x + basis.up[i] * y)));
}
function assertPosePreserved(before, after, tolerance = 1e-10) {
  assert.ok(after); close(difference(after.position, after.target), difference(before.position, before.target), tolerance);
  for (const key of ['fovDegrees', 'near', 'far']) assert.equal(after[key], before[key]);
  if (before.up === undefined) assert.equal(Object.hasOwn(after, 'up'), Object.hasOwn(before, 'up'));
  else { assert.deepEqual(after.up, before.up); assert.notEqual(after.up, before.up); assert.ok(Object.isFrozen(after.up)); }
}

test('all six standard views and free author/rolled views reproject target-plane points by the exact CSS drag', () => {
  const cameras = [...directions.map(direction => standardViewCamera(camera, direction)), camera,
    { ...camera, up: [1, 3, -.5] }, orbitCamera(standardViewCamera(camera, 'top'), .37, -.62)];
  for (const source of cameras) for (const [dx, dy] of [[17, 0], [-13, 0], [0, 19], [0, -11], [37, -21]]) {
    const view = panCamera(source, dx, dy, viewport); assertPosePreserved(source, view);
    for (const point of targetPlane(source)) close(difference(project(view, point, viewport), project(source, point, viewport)), [dx, dy]);
  }
});

test('drawing-buffer aspect remains independent from CSS width/height and device pixel density', () => {
  const source = standardViewCamera(camera, 'top');
  for (const size of [{ width: 390, height: 844, aspect: 2 / 8192 }, { width: 8192, height: 2, aspect: 4 / 3 }, { width: 800, height: 600, aspect: 8192 }]) {
    const view = panCamera(source, 11, -7, size); assertPosePreserved(source, view);
    for (const point of targetPlane(source)) close(difference(project(view, point, size), project(source, point, size)), [11, -7], 1e-7);
  }
});

test('frozen input vectors and custom explicit up remain detached and immutable after pan', () => {
  const source = freeze({ ...structuredClone(camera), up: [1, 3, -.5] }), size = freeze({ ...viewport });
  const before = JSON.stringify([source, size]), result = panCamera(source, -12, 27, size);
  assertPosePreserved(source, result);
  for (const key of ['position', 'target', 'up']) { assert.notEqual(result[key], source[key]); assert.ok(Object.isFrozen(result[key])); }
  assert.ok(Object.isFrozen(result)); assert.equal(JSON.stringify([source, size]), before);
  assert.throws(() => { result.target[0] = 99; }, TypeError);
});

test('zero pan is a detached immutable no-op without altering explicit or implicit camera orientation', () => {
  for (const source of [camera, standardViewCamera(camera, 'top'), standardViewCamera(camera, 'bottom')]) {
    const result = panCamera(source, 0, 0, viewport); assert.deepEqual(result, source); assert.notEqual(result, source);
    assert.notEqual(result.position, source.position); assert.notEqual(result.target, source.target); assert.ok(Object.isFrozen(result));
    if (source.up) assert.notEqual(result.up, source.up);
  }
});

test('pan magnitude tracks perspective depth and viewport height instead of a fixed world-unit step', () => {
  const first = { ...camera, position: [0, 0, 10], target: [0, 0, 0] };
  const second = { ...first, position: [0, 0, 100] };
  const near = panCamera(first, 20, 30, viewport), far = panCamera(second, 20, 30, viewport);
  close(far.target, near.target.map(n => n * 10));
  const doubledCSS = panCamera(first, 20, 30, { ...viewport, width: 1600, height: 1200 });
  close(doubledCSS.target, near.target.map(n => n / 2));
  const resizedFov = panCamera({ ...first, fovDegrees: 90 }, 20, 30, viewport);
  close(resizedFov.target, near.target.map(n => n * Math.tan(Math.PI / 4) / Math.tan(Math.PI / 6)));
});

test('exact top and bottom keep their axial heading through repeated pans zoom and object/scene focus', () => {
  const object = { position: [17, -3, 4], size: [3, 7, 9], rotationDegrees: [19, 23, 41] };
  for (const direction of ['top', 'bottom']) {
    let source = standardViewCamera(camera, direction); const expected = difference(source.position, source.target);
    for (let i = 0; i < 100; i++) { source = panCamera(source, i % 2 ? -.8 : 1.1, .7, viewport); close(difference(source.position, source.target), expected); }
    for (const next of [orbitCamera(source, 0, 0, .7), frameCamera(source, object, viewport.aspect), frameSceneCamera(source, [object], viewport.aspect)]) {
      const moved = panCamera(next, 21, -13, viewport); assertPosePreserved(next, moved);
      close(axes(moved).back, direction === 'top' ? [0, 1, 0] : [0, -1, 0], 0);
      assert.deepEqual(moved.up, source.up);
    }
  }
});

test('focused remote millimetre scenes and large scenes pan across extreme FOVs and drawing aspects', () => {
  let cases = 0;
  for (const size of [[.001, .001, .001], [1000, .001, 1000]]) for (const fovDegrees of [1, 60, 179])
    for (const aspect of [1 / 8192, .3, 1, 8192]) for (const direction of ['front', 'top', 'bottom', 'free']) {
      const objects = [{ position: [100000, -100000, 100000], size, rotationDegrees: [23, -41, 67] }];
      const orientation = direction === 'free' ? { ...camera, fovDegrees, up: [1, 3, -.5] } : standardViewCamera({ ...camera, fovDegrees }, direction);
      const source = frameSceneCamera(orientation, objects, aspect);
      assert.ok(source); const sizeCSS = { width: 390, height: 844, aspect }, result = panCamera(source, 11, -9, sizeCSS);
      assert.ok(result, JSON.stringify({ size, fovDegrees, aspect, direction }));
      assertPosePreserved(source, result, distance(source) * 1e-6);
      close(difference(project(result, source.target, sizeCSS), project(source, source.target, sizeCSS)), [11, -9], .002);
      cases++;
    }
  assert.equal(cases, 96);
});

test('temporary panning is not clamped to authored coordinates or ordinary orbit distance limits', () => {
  const source = standardViewCamera({ ...camera, position: [0, 0, 300000], target: [0, 0, 0] }, 'front');
  const view = panCamera(source, 5000, -7000, viewport); assertPosePreserved(source, view);
  assert.ok(Math.abs(view.target[0]) > 100000 && Math.abs(view.target[1]) > 100000); assert.equal(distance(view), 300000);
});

test('malformed camera FOV deltas and viewport inputs reject the whole pan without mutation', () => {
  const before = JSON.stringify(camera);
  for (const source of [null, {}, { ...camera, fovDegrees: 0 }, { ...camera, fovDegrees: 180 }, { ...camera, fovDegrees: NaN },
    { ...camera, position: camera.target }, { ...camera, position: [Infinity, 0, 0] }, { ...camera, up: [0, 0, 0] },
    { ...camera, up: difference(camera.position, camera.target) }, { ...camera, position: [0, 3, 0], target: [0, 0, 0] }])
    assert.equal(panCamera(source, 1, 2, viewport), null);
  for (const size of [null, {}, { ...viewport, width: 0 }, { ...viewport, height: -1 }, { ...viewport, aspect: 0 },
    { ...viewport, width: Infinity }, { ...viewport, height: NaN }, { ...viewport, aspect: Infinity }]) assert.equal(panCamera(camera, 1, 2, size), null);
  for (const [dx, dy] of [[NaN, 1], [1, Infinity], ['1', 2], [1, undefined]]) assert.equal(panCamera(camera, dx, dy, viewport), null);
  assert.equal(JSON.stringify(camera), before);
});

test('overflow underflow wholly lost movement and material eye-target collapse fail atomically', () => {
  const front = { ...camera, position: [0, 0, 10], target: [0, 0, 0] };
  const cases = [
    [front, Number.MAX_VALUE, 1, { width: .001, height: 600, aspect: 8192 }],
    [front, Number.MIN_VALUE, 0, { width: Number.MAX_VALUE, height: 1, aspect: 1 }],
    [{ ...front, position: [1e30, 0, 10], target: [1e30, 0, 0] }, 1, 0, viewport],
    [{ ...front, position: [100000, 100000, 100000.001], target: [100000, 100000, 100000] }, 1, 100, { width: 390, height: 844, aspect: 1e-8 }],
    [camera, 1e20, 1e20, viewport],
    [{ ...front, position: [Number.MAX_VALUE, 0, 10], target: [Number.MAX_VALUE, 0, 0] }, -Number.MAX_VALUE, 0, viewport],
    [{ ...front, position: [0, 0, 1e308] }, 1, 2, viewport],
  ];
  for (const [source, dx, dy, size] of cases) { const before = JSON.stringify(source); assert.equal(panCamera(source, dx, dy, size), null); assert.equal(JSON.stringify(source), before); }
});
