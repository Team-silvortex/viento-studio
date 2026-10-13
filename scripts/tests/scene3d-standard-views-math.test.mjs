import test from 'node:test';
import assert from 'node:assert/strict';
import { standardViewCamera, lookAt4, orbitCamera, frameCamera, frameSceneCamera } from '../../web/modules/scene3d-math.js';

const camera = { position: [9, 7, 10], target: [0, 1, 0], fovDegrees: 60, near: .05, far: 1000 };
const object = { position: [2, 3, 4], rotationDegrees: [23, -41, 67], size: [2, 3, 4] };
const views = {
  front: { back: [0, 0, 1], up: [0, 1, 0], right: [1, 0, 0] },
  back: { back: [0, 0, -1], up: [0, 1, 0], right: [-1, 0, 0] },
  left: { back: [-1, 0, 0], up: [0, 1, 0], right: [0, 0, 1] },
  right: { back: [1, 0, 0], up: [0, 1, 0], right: [0, 0, -1] },
  top: { back: [0, 1, 0], up: [0, 0, -1], right: [1, 0, 0] },
  bottom: { back: [0, -1, 0], up: [0, 0, 1], right: [1, 0, 0] },
};
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = value => { const length = Math.hypot(...value); return value.map(n => n / length); };
const heading = view => unit(view.position.map((n, i) => n - view.target[i]));
function close(actual, expected, tolerance = 1e-12) {
  assert.equal(actual.length, expected.length);
  actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) <= tolerance, `${actual} != ${expected}`));
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function assertBasis(view) {
  const back = heading(view), up = view.up, right = cross(up, back);
  assert.ok([...back, ...up, ...right].every(Number.isFinite));
  for (const axis of [back, up, right]) assert.ok(Math.abs(Math.hypot(...axis) - 1) < 1e-12);
  assert.ok(Math.abs(dot(back, up)) < 1e-12);
  close(cross(right, up), back);
}
// Independent corner geometry: rotate Z, then Y, then X rather than using
// the production matrices or framing sphere calculation.
function corners(box) {
  const [x, y, z] = box.rotationDegrees.map(n => n * Math.PI / 180), result = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    let [a, b, c] = box.size.map((n, i) => n * [sx, sy, sz][i] / 2);
    [a, b] = [a * Math.cos(z) - b * Math.sin(z), a * Math.sin(z) + b * Math.cos(z)];
    [a, c] = [a * Math.cos(y) + c * Math.sin(y), -a * Math.sin(y) + c * Math.cos(y)];
    [b, c] = [b * Math.cos(x) - c * Math.sin(x), b * Math.sin(x) + c * Math.cos(x)];
    result.push([a, b, c].map((n, i) => n + box.position[i]));
  }
  return result;
}
function assertContained(view, objects, aspect) {
  const back = heading(view), right = unit(cross(view.up, back)), up = cross(back, right);
  const tangent = Math.tan(view.fovDegrees * Math.PI / 360);
  for (const point of objects.flatMap(corners)) {
    const relative = point.map((n, i) => n - view.position[i]), depth = -dot(relative, back);
    assert.ok(depth > view.near && depth < view.far);
    for (const n of [dot(relative, right) / (depth * tangent * aspect), dot(relative, up) / (depth * tangent)])
      assert.ok(Math.abs(n) < 1 / 1.2 + 1e-5, `clipped corner ${point} at ${aspect}: ${n}`);
  }
}

test('six exact standard axes preserve distance target FOV clipping and detached immutable input data', () => {
  const cam = freeze(structuredClone(camera)), before = JSON.stringify(cam);
  const distance = Math.hypot(...cam.position.map((n, i) => n - cam.target[i]));
  for (const [direction, axes] of Object.entries(views)) {
    const view = standardViewCamera(cam, direction); assert.ok(view);
    close(heading(view), axes.back, 0); assert.deepEqual(view.up, axes.up);
    assert.deepEqual(view.position, cam.target.map((n, i) => n + axes.back[i] * distance));
    assert.deepEqual(view.target, cam.target); assert.notEqual(view.target, cam.target);
    for (const key of ['fovDegrees', 'near', 'far']) assert.equal(view[key], cam[key]);
    for (const value of [view, view.position, view.target, view.up]) assert.ok(Object.isFrozen(value));
    assertBasis(view); assert.equal(JSON.stringify(cam), before);
  }
});

test('lookAt maps all six explicit right/up/back axes to a right-handed unmirrored camera space', () => {
  for (const [direction, axes] of Object.entries(views)) {
    const view = standardViewCamera(camera, direction), matrix = lookAt4(view.position, view.target, view.up);
    close([matrix[0], matrix[4], matrix[8]], axes.right, 0);
    close([matrix[1], matrix[5], matrix[9]], axes.up, 0);
    close([matrix[2], matrix[6], matrix[10]], axes.back, 0);
    assert.ok(matrix.every(Number.isFinite));
    close([0, 1, 2].map(row => dot([matrix[row], matrix[4 + row], matrix[8 + row]], view.position) + matrix[12 + row]), [0, 0, 0]);
    const targetDepth = dot(axes.back, view.target) + matrix[14]; assert.ok(targetDepth < 0);
  }
  assert.deepEqual(lookAt4(camera.position, camera.target), lookAt4(camera.position, camera.target, [0, 1, 0]));
});

test('changing between any pair of standard views keeps exact requested axes and source detached', () => {
  for (const from of Object.keys(views)) for (const to of Object.keys(views)) {
    const source = standardViewCamera(camera, from), before = JSON.stringify(source), next = standardViewCamera(source, to);
    close(heading(next), views[to].back, 0); assert.deepEqual(next.up, views[to].up);
    assert.notEqual(next.up, source.up); assert.notEqual(next.target, source.target);
    assert.equal(JSON.stringify(source), before);
  }
});

test('top and bottom focus frame all rotated box corners at extreme viewport aspects without tilting', () => {
  for (const direction of ['top', 'bottom']) for (const fovDegrees of [1, 60, 179]) for (const aspect of [1 / 8192, .3, 1, 8192]) {
    const source = standardViewCamera({ ...camera, fovDegrees }, direction), before = JSON.stringify(source);
    const view = frameCamera(source, object, aspect); assert.ok(view); close(heading(view), views[direction].back, 0);
    assert.deepEqual(view.up, source.up); assert.notEqual(view.up, source.up); assert.ok(Object.isFrozen(view.up));
    assertContained(view, [object], aspect); assert.equal(JSON.stringify(source), before);
  }
});

test('all six whole-scene views contain 128 independently rotated boxes at narrow wide and portrait aspects', () => {
  const objects = freeze(Array.from({ length: 128 }, (_, i) => ({
    position: [i % 2 ? 100000 : -100000, i % 3 ? 100000 : -100000, i % 5 ? 100000 : -100000],
    rotationDegrees: [i * 287, -35999 + i, 179 - i], size: i % 3 ? [.001, 1000, .001] : [1000, .001, 1000],
  }))), before = JSON.stringify(objects);
  for (const direction of Object.keys(views)) for (const aspect of [1 / 8192, .2, 1, 8192]) {
    const source = standardViewCamera(camera, direction), view = frameSceneCamera(source, objects, aspect); assert.ok(view);
    close(heading(view), views[direction].back, 0); assert.deepEqual(view.up, source.up); assert.notEqual(view.up, source.up);
    assertContained(view, objects, aspect);
  }
  assert.equal(JSON.stringify(objects), before);
});

test('implicit author poles still reject framing and explicit parallel or malformed up does not bypass validation', () => {
  for (const position of [[0, 3, 0], [0, -3, 0]]) {
    const pole = { ...camera, position, target: [0, 0, 0] };
    for (const up of [undefined, null, [0, 0, 0], [0, 1, 0], [0, -2, 0], [0, NaN, 1], [0, 0], [Infinity, 0, 1]]) {
      const source = { ...pole, ...(up === undefined ? {} : { up }) };
      assert.equal(frameCamera(source, object, 1), null); assert.equal(frameSceneCamera(source, [object], 1), null);
      assert.equal(standardViewCamera(source, 'front'), null);
    }
    const explicit = { ...pole, up: [0, 0, 1] };
    assert.ok(frameCamera(explicit, object, 1)); assert.ok(frameSceneCamera(explicit, [object], 1));
  }
});

test('zoom in every exact standard view preserves exact heading and up at bounded distances without a pole tilt', () => {
  for (const direction of Object.keys(views)) for (const scale of [.0000001, .7, 1, 2, 1e100]) {
    const source = standardViewCamera(camera, direction), before = JSON.stringify(source), view = orbitCamera(source, 0, 0, scale);
    close(heading(view), views[direction].back, 0); assert.deepEqual(view.up, source.up);
    assert.notEqual(view.up, source.up); assert.ok(Object.isFrozen(view.up));
    const distance = Math.hypot(...view.position.map((n, i) => n - view.target[i]));
    assert.ok(distance >= .01 - 1e-12 && distance <= 200000 + 1e-10); assert.equal(JSON.stringify(source), before);
  }
  const skewUp = { ...camera, up: [1, 3, -.5] }, zoom = orbitCamera(skewUp, 0, 0, .5);
  assert.deepEqual(zoom.up, skewUp.up); assert.notEqual(zoom.up, skewUp.up);
});

test('positive and negative drags in every exact view follow current camera right and up without mirroring', () => {
  for (const [direction, axes] of Object.entries(views)) for (const sign of [-1, 1]) {
    const source = standardViewCamera(camera, direction), amount = sign * .01;
    const yaw = orbitCamera(source, amount, 0), pitch = orbitCamera(source, 0, amount);
    close(heading(yaw), axes.back.map((n, i) => n * Math.cos(amount) + axes.right[i] * Math.sin(amount)));
    close(heading(pitch), axes.back.map((n, i) => n * Math.cos(amount) + axes.up[i] * Math.sin(amount)));
    assert.ok(sign * dot(heading(yaw), axes.right) > 0); assert.ok(sign * dot(heading(pitch), axes.up) > 0);
    assertBasis(yaw); assertBasis(pitch);
  }
});

test('explicit orbit crosses both poles continuously and never uses the implicit 0.002-radian clamp', () => {
  const source = standardViewCamera(camera, 'front'), epsilon = 1e-8;
  for (const sign of [-1, 1]) {
    const before = orbitCamera(source, 0, sign * (Math.PI / 2 - epsilon));
    const pole = orbitCamera(source, 0, sign * Math.PI / 2);
    const after = orbitCamera(source, 0, sign * (Math.PI / 2 + epsilon));
    close(heading(pole), [0, sign, 0], 1e-15);
    assert.ok(heading(before)[2] > 0 && heading(after)[2] < 0);
    assert.ok(Math.hypot(...before.up.map((n, i) => n - after.up[i])) < 3 * epsilon);
    const departed = orbitCamera(pole, .01, .01); assertBasis(departed);
    assert.ok(Math.hypot(...heading(departed).map((n, i) => n - heading(pole)[i])) < .03);
  }
});

test('many mixed explicit orbits retain an orthonormal right-handed basis and reversible pitch', () => {
  let view = standardViewCamera(camera, 'top');
  for (let i = 0; i < 2000; i++) { view = orbitCamera(view, .07 * Math.sin(i), .05 * Math.cos(i)); assertBasis(view); }
  for (const direction of Object.keys(views)) {
    const source = standardViewCamera(camera, direction), next = orbitCamera(orbitCamera(source, 0, 2.7), 0, -2.7);
    close(heading(next), heading(source)); close(next.up, source.up);
  }
});

test('authored cameras retain world-Y Euler orbit and pole clamp without gaining a temporary up field', () => {
  const source = freeze(structuredClone(camera)), yaw = .31, pitch = -.2, result = orbitCamera(source, yaw, pitch, .7);
  const delta = source.position.map((n, i) => n - source.target[i]), distance = Math.hypot(...delta) * .7;
  const angle = Math.atan2(delta[0], delta[2]) + yaw, elevation = Math.asin(delta[1] / Math.hypot(...delta)) + pitch;
  close(result.position, source.target.map((n, i) => n + [distance * Math.cos(elevation) * Math.sin(angle), distance * Math.sin(elevation), distance * Math.cos(elevation) * Math.cos(angle)][i]));
  assert.equal(Object.hasOwn(result, 'up'), false);
  for (const scale of [0, -1]) {
    const minimum = orbitCamera(source, 1, 1000, scale); assert.ok(minimum);
    assert.ok(Math.abs(Math.hypot(...minimum.position.map((n, i) => n - minimum.target[i])) - .01) < 1e-12);
    assert.equal(Object.hasOwn(minimum, 'up'), false);
  }
  const clamp = orbitCamera({ ...camera, position: [0, 0, 3], target: [0, 0, 0] }, 0, Math.PI);
  assert.ok(heading(clamp)[2] > .0019 && heading(clamp)[2] < .0021);
});

test('malformed directions cameras orbit arguments and overflow fail explicitly without source mutation', () => {
  for (const direction of ['', 'TOP', 'constructor', '__proto__', 'toString', null, {}, ['front']]) assert.equal(standardViewCamera(camera, direction), null);
  const invalid = [null, {}, { ...camera, position: camera.target }, { ...camera, position: [Infinity, 0, 0] },
    { ...camera, position: [1e308, 1e308, 1e308], target: [-1e308, -1e308, -1e308] }, { ...camera, up: [0, 0, 0] },
    { ...camera, up: camera.position.map((n, i) => n - camera.target[i]) }];
  for (const source of invalid) { assert.equal(standardViewCamera(source, 'top'), null); assert.equal(orbitCamera(source, 0, 0), null); }
  for (const fovDegrees of [0, 180, NaN, Infinity]) assert.equal(standardViewCamera({ ...camera, fovDegrees }, 'top'), null);
  const source = standardViewCamera(camera, 'top'), before = JSON.stringify(source);
  for (const args of [[NaN, 0], [0, Infinity], [0, 0, 0], [0, 0, -1], [0, 0, Infinity], [0, 0, 1, Infinity], [0, 0, 1, 1, 2], [0, 0, 1, 1, 0]])
    assert.equal(orbitCamera(source, ...args), null);
  const lost = { ...source, position: [1e300, 1, 1e300], target: [1e300, 0, 1e300] };
  assert.equal(standardViewCamera(lost, 'front'), null);
  assert.equal(JSON.stringify(source), before);
});
