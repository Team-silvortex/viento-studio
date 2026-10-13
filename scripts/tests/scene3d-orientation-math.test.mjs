import test from 'node:test';
import assert from 'node:assert/strict';
import { orientationAxes, standardViewCamera, orbitCamera, panCamera, cameraProjection4 } from '../../web/modules/scene3d-math.js';

const camera = { position: [9, 7, 10], target: [0, 1, 0], fovDegrees: 60, near: .05, far: 1000 };
const directions = {
  front: [[1, 0, 0], [0, -1, 0], [0, 0, 1]], back: [[-1, 0, 0], [0, -1, 0], [0, 0, -1]],
  left: [[0, 0, -1], [0, -1, 0], [1, 0, 0]], right: [[0, 0, 1], [0, -1, 0], [-1, 0, 0]],
  top: [[1, 0, 0], [0, 0, 1], [0, 1, 0]], bottom: [[1, 0, 0], [0, 0, -1], [0, -1, 0]],
};
const values = axes => axes.map(({ x, y, depth }) => [x, y, depth]);
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function close(actual, expected, tolerance = 1e-12) { actual.forEach((row, i) => row.forEach((n, j) => assert.ok(Math.abs(n - expected[i][j]) <= tolerance, `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`))); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('six exact views expose positive world axes with screen Y down and depth toward observer', () => {
  for (const [direction, expected] of Object.entries(directions)) {
    const axes = orientationAxes(standardViewCamera(camera, direction));
    assert.deepEqual(axes.map(value => value.axis), ['X', 'Y', 'Z']); close(values(axes), expected, 0);
  }
});

test('explicit rolled up is honored and arbitrary free orbits retain an orthonormal right-handed camera basis', () => {
  const rolled = orientationAxes({ position: [0, 0, 10], target: [0, 0, 0], up: [1, 0, 0] });
  close(values(rolled), [[0, -1, 0], [-1, 0, 0], [0, 0, 1]], 0);
  let view = standardViewCamera(camera, 'top');
  for (let i = 0; i < 128; i++) {
    view = orbitCamera(view, .37 * Math.sin(i + 1), .21 * Math.cos(i));
    const axes = orientationAxes(view), right = axes.map(value => value.x), up = axes.map(value => -value.y), back = axes.map(value => value.depth);
    for (const value of [right, up, back]) assert.ok(Math.abs(Math.hypot(...value) - 1) < 1e-12);
    assert.ok(Math.abs(dot(right, up)) < 1e-12 && Math.abs(dot(up, back)) < 1e-12);
    close([cross(right, up)], [back]);
  }
});

test('orientation ignores translation zoom projection FOV clipping and author-only data', () => {
  const source = { ...camera, up: [1, 3, -.5] }, expected = values(orientationAxes(source));
  const translated = { ...source, position: source.position.map(n => n + 100000), target: source.target.map(n => n + 100000) };
  close(values(orientationAxes(translated)), expected);
  const panned = panCamera(source, 17, -11, { width: 390, height: 844, aspect: 4 / 3 });
  close(values(orientationAxes(panned)), expected);
  for (const scale of [.01, .5, 2, 100]) close(values(orientationAxes(orbitCamera(source, 0, 0, scale))), expected);
  for (const mode of ['perspective', 'orthographic']) { assert.ok(cameraProjection4(source, 1, mode)); close(values(orientationAxes(source)), expected); }
  close(values(orientationAxes({ position: source.position, target: source.target, up: source.up, fovDegrees: NaN, near: -1, far: 'irrelevant', projectionMode: 'unrelated' })), expected);
  assert.ok(orientationAxes({ position: [1, 2, 3], target: [0, 0, 0] }), 'orientation must not require author FOV/clipping');
});

test('finite distance scale does not alter orientation, and frozen results never retain source vectors', () => {
  const source = freeze({ position: [2, 3, 5], target: [0, 0, 0], up: [1, 4, -.5] }), before = JSON.stringify(source);
  const expected = values(orientationAxes(source));
  for (const scale of [1e-100, 1e-10, 1, 1e100]) close(values(orientationAxes({ ...source, position: source.position.map(n => n * scale) })), expected);
  const axes = orientationAxes(source); assert.ok(Object.isFrozen(axes));
  for (const axis of axes) { assert.ok(Object.isFrozen(axis)); assert.deepEqual(Object.keys(axis), ['axis', 'x', 'y', 'depth']); }
  assert.throws(() => { axes[0].x = 99; }, TypeError); assert.equal(JSON.stringify(source), before);
  assert.notEqual(orientationAxes(source), axes);
});

test('invalid camera basis rejects null zero parallel poles and overflowing input while valid explicit poles remain accepted', () => {
  for (const source of [null, {}, { position: [0, 0, 0], target: [0, 0, 0] }, { position: [1, 2], target: [0, 0, 0] },
    { position: [Infinity, 0, 1], target: [0, 0, 0] }, { position: [0, NaN, 1], target: [0, 0, 0] },
    { position: [0, 3, 0], target: [0, 0, 0] }, { position: [0, 0, 3], target: [0, 0, 0], up: [0, 0, 1] },
    { position: [0, 0, 3], target: [0, 0, 0], up: [0, 0, 0] }, { ...camera, up: null },
    { position: [1e308, 1e308, 1e308], target: [-1e308, -1e308, -1e308] }]) assert.equal(orientationAxes(source), null);
  assert.ok(orientationAxes({ position: [0, 3, 0], target: [0, 0, 0], up: [0, 0, -1] }));
});
