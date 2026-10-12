import test from 'node:test';
import assert from 'node:assert/strict';
import { pickScene3DObject } from '../../web/modules/scene3d-picking.js';
import { multiply4, perspective4, lookAt4, objectMatrix4, frameCamera } from '../../web/modules/scene3d-math.js';
const first = '00000000-0000-4000-8000-000000000001', second = '00000000-0000-4000-8000-000000000002';
const camera = { position: [0, 0, 8], target: [0, 0, 0], near: .1, far: 100, fovDegrees: 60 };
const box = (instanceId = first, position = [0, 0, 0], extra = {}) => ({ instanceId, position, size: [2, 2, 2], rotationDegrees: [0, 0, 0], ...extra });
function frame(objects = [box()], cam = camera, rect = { left: 10, top: 20, width: 400, height: 300 }, width = 800, height = 600) {
  const origin = cam.target, eye = cam.position.map((n, i) => n - origin[i]);
  return { rect, width, height, viewProjection: new Float32Array(multiply4(perspective4(cam.fovDegrees, width / height, cam.near, cam.far), lookAt4(eye, [0, 0, 0]))),
    objects: objects.map(object => ({ instanceId: object.instanceId, model: new Float32Array(objectMatrix4({ ...object, position: object.position.map((n, i) => n - origin[i]) })) })) };
}
const center = value => [value.rect.left + value.rect.width / 2, value.rect.top + value.rect.height / 2];
const multiply = (m, v) => Array.from({ length: 4 }, (_, row) => v.reduce((sum, n, col) => sum + m[col * 4 + row] * n, 0));
function project(value, world) {
  const p = multiply(value.viewProjection, [...world, 1]);
  return [value.rect.left + (p[0] / p[3] + 1) * value.rect.width / 2, value.rect.top + (1 - p[1] / p[3]) * value.rect.height / 2];
}

test('literal CSS client coordinates hit the box and leave blank border outside and invalid coordinates empty', () => {
  const f = frame(); assert.equal(pickScene3DObject(f, ...center(f)), first);
  for (const point of [[10, 20], [9, 160], [410, 160], [210, 320], [210, 19], [NaN, 10], [10, Infinity], ['210', 170]]) assert.equal(pickScene3DObject(f, ...point), null);
});
test('nearest visible surface wins independent of declaration order and occludes farther boxes', () => {
  const near = box(first, [0, 0, 3]), far = box(second, [0, 0, -3]);
  for (const items of [[near, far], [far, near]]) { const f = frame(items); assert.equal(pickScene3DObject(f, ...center(f)), first); }
});
test('exactly equal surface depth uses later declaration matching existing LEQUAL drawing', () => {
  const a = box(first), b = box(second);
  for (const [items, expected] of [[[a, b], second], [[b, a], first]]) { const f = frame(items); assert.equal(pickScene3DObject(f, ...center(f)), expected); }
});
test('mixed XYZ rotated nonuniform boxes are intersected as actual transformed boxes rather than their enclosing AABB', () => {
  const object = box(first, [2, -1, 0], { rotationDegrees: [23, -41, 67], size: [.3, 2, 4] }), f = frame([object]);
  assert.equal(pickScene3DObject(f, ...project(f, object.position)), first);
  const thin = box(first, [0, 0, 0], { rotationDegrees: [0, 45, 0], size: [.2, 1, 4] });
  const top = frame([thin], { ...camera, position: [0, 8, .008] });
  assert.equal(pickScene3DObject(top, ...project(top, [-1.3, 0, 1.3])), null);
  assert.equal(pickScene3DObject(top, ...project(top, [1, 0, 1])), first);
});
test('near and far clipped objects behind or outside the camera produce no visible surface', () => {
  const cam = { ...camera, position: [0, 0, 0], target: [0, 0, -1], near: 1, far: 10 };
  for (const object of [box(first, [0, 0, -.2], { size: [.1, .1, .1] }), box(first, [0, 0, 20]), box(first, [0, 0, -20])]) {
    const f = frame([object], cam); assert.equal(pickScene3DObject(f, ...center(f)), null);
  }
});
test('when the near plane is inside a box only the real positive exit face is visible', () => {
  const cam = { ...camera, position: [0, 0, 0], target: [0, 0, -1], near: .1, far: 10 };
  for (const object of [box(first), box(first, [0, 0, -.12], { size: [.1, .1, .1] })]) {
    const f = frame([object], cam); assert.equal(pickScene3DObject(f, ...center(f)), first);
  }
  const noFace = frame([box(first, [0, 0, 0], { size: [1000, 1000, 1000] })], cam);
  assert.equal(pickScene3DObject(noFace, ...center(noFace)), null);
});
test('a clipped entry face cannot occlude a valid foreground exit or another real visible surface', () => {
  const cam = { ...camera, position: [0, 0, 0], target: [0, 0, -1], near: .1, far: 10 };
  const enclosing = box(first, [0, 0, 0], { size: [4, 4, 4] }), inner = box(second, [0, 0, -1], { size: [.2, .2, .2] });
  const f = frame([enclosing, inner], cam); assert.equal(pickScene3DObject(f, ...center(f)), second);
});
test('legal extreme Float32 clip ratio with an infinite far unprojection still picks finite geometry', () => {
  const cam = { ...camera, position: [0, 0, 0], target: [0, 0, -1], near: .001, far: 100000 };
  const f = frame([box(first, [0, 0, -50000])], cam); assert.equal(f.viewProjection[10], -1);
  assert.equal(pickScene3DObject(f, ...center(f)), first);
});
test('actual rounded drawing allocation aspect controls projection separately from CSS or author viewport', () => {
  const rect = { left: -30, top: 12, width: 4000, height: 2999 }, f = frame([box(first, [3, 0, 0])], camera, rect, 2048, 1535);
  assert.equal(pickScene3DObject(f, ...project(f, [3, 0, 0])), first);
  const dpr = frame([box()], camera, { left: 100, top: 50, width: 200, height: 150 }, 400, 300);
  assert.equal(pickScene3DObject(dpr, ...center(dpr)), first);
});
test('focused temporary cameras and far-coordinate floating origins pick both minimum and maximum rotated boxes', () => {
  let count = 0;
  for (const size of [[.001, .001, .001], [1000, 1000, 1000], [.001, 1000, .001]]) for (const fovDegrees of [1, 179])
    for (const [width, height] of [[1, 2048], [2048, 1], [900, 400]]) {
      const object = box(first, [100000, -100000, 100000], { size, rotationDegrees: [23, -41, 67] });
      const cam = frameCamera({ ...camera, position: [9, 7, 10], target: [0, 1, 0], fovDegrees }, object, width / height);
      const f = frame([object], cam, { left: 0, top: 0, width, height }, width, height);
      assert.equal(pickScene3DObject(f, ...center(f)), first, `${size}/${fovDegrees}/${width}/${height}`); count++;
    }
  assert.equal(count, 18);
});
test('translated camera and objects preserve hits while stable IDs do not depend on their source numeric index', () => {
  const items = [box(second, [3, 0, 0]), box(first)], offset = [100000, -100000, 100000];
  const shifted = items.map(object => ({ ...object, position: object.position.map((n, i) => n + offset[i]) }));
  const shiftedCamera = { ...camera, position: camera.position.map((n, i) => n + offset[i]), target: camera.target.map((n, i) => n + offset[i]) };
  const a = frame(items), b = frame(shifted, shiftedCamera); assert.deepEqual(a.viewProjection, b.viewProjection);
  for (const point of [center(a), project(a, [3, 0, 0])]) assert.equal(pickScene3DObject(a, ...point), pickScene3DObject(b, ...point));
});
test('matrix payloads and all caller frame objects remain unchanged after successful or missing hits', () => {
  const f = frame(); Object.freeze(f.rect); Object.freeze(f.objects); Object.freeze(f);
  const before = JSON.stringify(f); pickScene3DObject(f, ...center(f)); pickScene3DObject(f, 10, 20); assert.equal(JSON.stringify(f), before);
});
test('missing empty malformed singular and nonfinite drawing frames fail closed', () => {
  for (const value of [null, undefined, {}, { rect: {} }]) assert.equal(pickScene3DObject(value, 0, 0), null);
  const original = frame();
  for (const changes of [{ viewProjection: Array(16).fill(0) }, { viewProjection: Array(16).fill(NaN) }, { viewProjection: [1] }, { width: 0 }, { height: 1.5 }, { objects: [] }, { objects: Array(129).fill(original.objects[0]) }, { rect: { ...original.rect, width: 0 } }])
    assert.equal(pickScene3DObject({ ...original, ...changes }, ...center(original)), null);
  const singular = { instanceId: first, model: Array(16).fill(0) }; const f = { ...original, objects: [singular] };
  assert.equal(pickScene3DObject(f, ...center(f)), null);
});
