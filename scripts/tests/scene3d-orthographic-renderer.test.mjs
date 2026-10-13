import test from 'node:test';
import assert from 'node:assert/strict';
import { createScene3DRenderer } from '../../web/modules/scene3d-renderer.js';

const distance = camera => Math.hypot(...camera.position.map((value, axis) => value - camera.target[axis]));
const heading = camera => camera.position.map((value, axis) => (value - camera.target[axis]) / distance(camera));
const near = (actual, expected, epsilon = 1e-9) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= epsilon, `${actual} != ${expected}`));
const axes = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0] };
const model = () => ({ background: '#142538', camera: { position: [0, 0, 8], target: [0, 0, 0], fovDegrees: 50, near: .1, far: 100 },
  light: { direction: [1, -2, -1], color: '#ffffff', energy: 1 },
  objects: [{ instanceId: '11111111-1111-4111-8111-111111111111', position: [0, 0, 0], rotationDegrees: [0, 0, 0], size: [2, 2, 2], color: '#85d7bb' }] });
function fixture(options = {}) {
  const calls = [], events = new Map(), documentEvents = new Map(), captures = new Set(), picks = [], errors = []; let observer;
  const eventTarget = entries => ({ addEventListener: (name, callback, capture) => entries.set(name, { callback, capture }), removeEventListener: name => entries.delete(name) });
  const gl = Object.fromEntries(['COMPILE_STATUS', 'LINK_STATUS', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'ARRAY_BUFFER', 'STATIC_DRAW', 'FLOAT', 'DEPTH_TEST', 'LEQUAL', 'CULL_FACE', 'COLOR_BUFFER_BIT', 'DEPTH_BUFFER_BIT', 'TRIANGLES'].map((key, index) => [key, index + 1]));
  for (const name of ['createProgram', 'createShader', 'createBuffer', 'createVertexArray']) gl[name] = () => ({});
  for (const name of ['attachShader', 'shaderSource', 'compileShader', 'linkProgram', 'bindVertexArray', 'bindBuffer', 'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'viewport', 'enable', 'depthFunc', 'disable', 'clearColor', 'clear', 'useProgram', 'uniformMatrix4fv', 'uniform3fv', 'uniform1f', 'uniform1i', 'drawArrays', 'deleteBuffer', 'deleteVertexArray', 'deleteProgram', 'deleteShader']) gl[name] = (...args) => calls.push([name, ...args]);
  gl.getShaderParameter = gl.getProgramParameter = () => true; gl.getUniformLocation = (_, name) => name;
  gl.isContextLost = () => Boolean(options.lost); gl.getExtension = () => null;
  const canvas = { ...eventTarget(events), ownerDocument: eventTarget(documentEvents), width: 0, height: 0, getContext: () => gl,
    getBoundingClientRect: () => options.bounds || { left: 10, top: 20, width: 300, height: 200 },
    setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id),
    releasePointerCapture(id) { captures.delete(id); events.get('lostpointercapture')?.callback({ pointerId: id }); } };
  const renderer = createScene3DRenderer(canvas, { pixelRatio: () => options.dpr || 1,
    onError: error => { errors.push(error.message); if (options.throwConsumer) throw Error('consumer failed'); }, onPick: (...args) => picks.push(args),
    observe: callback => { observer = callback; return { observe() {}, disconnect() {} }; } });
  const send = (name, extra = {}) => events.get(name)?.callback({ button: 0, isPrimary: true, pointerId: 7, clientX: 160, clientY: 120, timeStamp: 100, preventDefault() {}, ...extra });
  return { gl, canvas, renderer, calls, events, documentEvents, captures, picks, errors, send, resize: () => observer() };
}
function uploaded(f) {
  const start = f.calls.findLastIndex(call => call[0] === 'uniformMatrix4fv' && call[1] === 'viewProjection');
  const view = f.calls[start][3], objects = f.calls.slice(start + 1).filter(call => call[0] === 'uniformMatrix4fv' && call[1] === 'model').map(call => call[3]);
  assert.ok(view instanceof Float32Array && view.every(Number.isFinite));
  assert.ok(objects.every(matrix => matrix instanceof Float32Array && matrix.every(Number.isFinite)));
  return { view, objects };
}
function transform(matrix, point) {
  return Array.from({ length: 4 }, (_, row) => { let sum = Math.fround(0); for (let column = 0; column < 4; column++) sum = Math.fround(sum + Math.fround(matrix[column * 4 + row] * point[column])); return sum; });
}
function project(f, index = 0, local = [0, 0, 0, 1]) {
  const { view, objects } = uploaded(f), clip = transform(view, transform(objects[index], local)), rect = f.canvas.getBoundingClientRect();
  assert.ok(clip.every(Number.isFinite) && clip[3] > 0);
  return [rect.left + (clip[0] / clip[3] + 1) * rect.width / 2, rect.top + (1 - clip[1] / clip[3]) * rect.height / 2, clip[2] / clip[3], clip[3]];
}
const projectedWidth = (f, index = 0) => Math.abs(project(f, index, [.5, 0, 0, 1])[0] - project(f, index, [-.5, 0, 0, 1])[0]);
function fit(f, count) {
  const { view, objects } = uploaded(f); assert.equal(objects.length, count);
  for (const object of objects) for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
    const clip = transform(view, transform(object, [x, y, z, 1])); assert.ok(clip.every(Number.isFinite) && clip[3] > 0);
    const ndc = clip.slice(0, 3).map(value => value / clip[3]); assert.ok(Math.abs(ndc[0]) < .835 && Math.abs(ndc[1]) < .835, `clipped viewport ${ndc}`); assert.ok(ndc[2] > -1 && ndc[2] < 1, `clipped depth ${ndc}`);
  }
}
function depthScene() {
  const value = model(); value.objects[0].position = [-2, 0, 2];
  value.objects.push({ ...structuredClone(value.objects[0]), instanceId: '22222222-2222-4222-8222-222222222222', position: [2, 0, -2] }); return value;
}
const move = (f, dx = 30, dy = -15, extra = {}) => f.send('pointermove', { clientX: 160 + dx, clientY: 120 + dy, ...extra });

test('orthographic uploads keep equal boxes equal at different depths while perspective retains depth scaling', () => {
  const f = fixture(), value = depthScene(), source = JSON.stringify(value); f.renderer.setModel(value);
  assert.ok(projectedWidth(f, 0) > projectedWidth(f, 1) * 1.5);
  assert.equal(f.renderer.setProjectionMode('orthographic'), true); near([projectedWidth(f, 0)], [projectedWidth(f, 1)], .00001);
  assert.equal(project(f, 0)[3], 1); assert.equal(project(f, 1)[3], 1);
  assert.equal(f.renderer.setProjectionMode('perspective'), true); assert.ok(projectedWidth(f, 0) > projectedWidth(f, 1) * 1.5);
  assert.equal(JSON.stringify(value), source); f.renderer.dispose();
});

test('projection switching preserves target-plane scale full camera selected identity drag mode and authored source', () => {
  const f = fixture(), renderer = f.renderer, value = model(), source = JSON.stringify(value); renderer.setModel(value); renderer.setSelectedObject(value.objects[0].instanceId); renderer.setDragMode('pan');
  const before = renderer.snapshot(), width = projectedWidth(f), originalUpload = [...uploaded(f).view];
  for (const mode of ['orthographic', 'perspective', 'orthographic']) {
    assert.equal(renderer.setProjectionMode(mode), true); const after = renderer.snapshot(); assert.equal(after.projectionMode, mode);
    assert.deepEqual(after.camera, before.camera); assert.equal(after.selectedInstanceId, before.selectedInstanceId); assert.equal(after.dragMode, 'pan'); near([projectedWidth(f)], [width], .00001);
    if (mode === 'perspective') assert.deepEqual([...uploaded(f).view], originalUpload);
  }
  assert.equal(Object.hasOwn(renderer.snapshot().camera, 'projectionMode'), false); assert.equal(JSON.stringify(value), source); renderer.dispose();
});

test('six exact directions and whole-scene framing enclose actual rotated Float32 corners in orthographic mode', () => {
  for (const fovDegrees of [1, 179]) for (const bounds of [{ left: 0, top: 0, width: 1, height: 8192 }, { left: 0, top: 0, width: 8192, height: 1 }, { left: 0, top: 0, width: 390, height: 844 }]) {
    const f = fixture({ bounds, dpr: 2 }), renderer = f.renderer, value = model(); value.camera.fovDegrees = fovDegrees;
    value.objects = Array.from({ length: 128 }, (_, index) => ({ ...structuredClone(value.objects[0]), instanceId: index.toString().padStart(8, '0') + '-1111-4111-8111-111111111111',
      position: [index % 2 ? 100000 : -100000, index % 3 ? 100000 : -100000, index % 5 ? 100000 : -100000], rotationDegrees: [index * 31 + 23, -index * 79 - 41, index * 71 + 67], size: index % 2 ? [.001, .001, .001] : [1000, .001, 1000] }));
    renderer.setModel(value); assert.equal(renderer.setProjectionMode('orthographic'), true);
    for (const [name, axis] of Object.entries(axes)) { assert.equal(renderer.setViewDirection(name), true); near(heading(renderer.snapshot().camera), axis); fit(f, 128); assert.equal(renderer.focusAll(), true); fit(f, 128); }
    renderer.dispose();
  }
});

test('object focus uses orthographic framing for tiny remote objects and all exact views without changing the projection mode', () => {
  const f = fixture({ bounds: { left: 0, top: 0, width: 390, height: 844 } }), renderer = f.renderer, value = model(); value.objects[0].position = [100000, -100000, 100000]; value.objects[0].size = [.001, .002, .001]; value.objects[0].rotationDegrees = [23, -41, 67];
  renderer.setModel(value); renderer.setProjectionMode('orthographic');
  for (const name of Object.keys(axes)) { renderer.setViewDirection(name); assert.equal(renderer.focusObject(value.objects[0].instanceId), true); assert.equal(renderer.snapshot().projectionMode, 'orthographic'); near(heading(renderer.snapshot().camera), axes[name]); fit(f, 1); }
  renderer.dispose();
});

test('orthographic pan moves every depth by the same CSS displacement and picking follows the uploaded frames', () => {
  const f = fixture(), renderer = f.renderer, value = depthScene(); renderer.setModel(value); renderer.setProjectionMode('orthographic'); renderer.focusAll(); renderer.setDragMode('pan');
  const points = [project(f, 0), project(f, 1)], before = renderer.snapshot().camera; f.send('pointerdown'); move(f); f.send('pointerup', { clientX: 190, clientY: 105 });
  for (let index = 0; index < 2; index++) { const next = project(f, index); near(next.slice(0, 2), [points[index][0] + 30, points[index][1] - 15], .00004); assert.equal(renderer.hitTest(...next.slice(0, 2)), value.objects[index].instanceId); }
  assert.equal(f.picks.length, 0); near(heading(renderer.snapshot().camera), heading(before)); assert.equal(renderer.snapshot().camera.near, before.near); assert.equal(renderer.snapshot().camera.far, before.far); renderer.dispose();
});

test('orthographic wheel changes magnification and retains fitted zoom bounds while orbit remains finite at poles', () => {
  for (const direction of ['front', 'top', 'bottom']) {
    const f = fixture(), renderer = f.renderer; renderer.setModel(model()); renderer.setProjectionMode('orthographic'); renderer.setViewDirection(direction);
    const before = renderer.snapshot().camera, point = project(f, 0, [.5, 0, 0, 1]), center = project(f), radius = Math.hypot(point[0] - center[0], point[1] - center[1]);
    f.send('wheel', { deltaY: 100 }); const next = project(f, 0, [.5, 0, 0, 1]), nextCenter = project(f), nextRadius = Math.hypot(next[0] - nextCenter[0], next[1] - nextCenter[1]);
    near([nextRadius / radius], [Math.exp(-.1)], .00001); near(heading(renderer.snapshot().camera), heading(before));
    for (let index = 0; index < 8; index++) f.send('wheel', { deltaY: 1000 }); near([distance(renderer.snapshot().camera) / distance(before)], [4], 1e-8);
    f.send('pointerdown'); move(f, 40, 200); f.send('pointerup', { clientX: 200, clientY: 320 }); assert.ok(renderer.snapshot().camera.position.every(Number.isFinite));
    assert.equal(renderer.focusAll(), true); fit(f, 1); assert.equal(renderer.hitTest(...project(f).slice(0, 2)), model().objects[0].instanceId); renderer.dispose();
  }
});

test('orthographic picking uses nearest visible surfaces and declaration order for exactly equal depth', () => {
  const f = fixture(), renderer = f.renderer, value = model(); value.objects[0].position = [0, 0, -2]; value.objects.push({ ...structuredClone(value.objects[0]), instanceId: '22222222-2222-4222-8222-222222222222', position: [0, 0, 2] });
  renderer.setModel(value); renderer.setProjectionMode('orthographic'); assert.equal(renderer.hitTest(160, 120), value.objects[1].instanceId);
  const next = structuredClone(value); next.objects.reverse(); renderer.setModel(next); assert.equal(renderer.hitTest(160, 120), value.objects[1].instanceId);
  next.objects[1].position = [...next.objects[0].position]; renderer.setModel(next); assert.equal(renderer.hitTest(160, 120), next.objects[1].instanceId); renderer.dispose();
});

test('orthographic near and far clipping never turn the clip plane into a selectable box surface', () => {
  for (const [far, expected] of [[3, true], [1.5, false]]) {
    const f = fixture(), value = model(); value.camera.near = 1; value.camera.far = far; value.objects[0].position = [0, 0, 7];
    f.renderer.setModel(value); f.renderer.setProjectionMode('orthographic'); assert.equal(f.renderer.hitTest(160, 120), expected ? value.objects[0].instanceId : null); f.renderer.dispose();
  }
  const f = fixture(), value = model(); value.objects[0].position = [0, 0, 10]; f.renderer.setModel(value); f.renderer.setProjectionMode('orthographic'); assert.equal(f.renderer.hitTest(160, 120), null); f.renderer.dispose();
});

test('reset and model refresh preserve selected projection mode while fresh renderer defaults to perspective', () => {
  const f = fixture(), renderer = f.renderer; assert.equal(renderer.snapshot().projectionMode, 'perspective'); assert.equal(renderer.setProjectionMode('orthographic'), false);
  const value = model(); renderer.setModel(value); renderer.setProjectionMode('orthographic'); renderer.setViewDirection('top'); renderer.setDragMode('pan'); renderer.resetView();
  assert.deepEqual(renderer.snapshot().camera, value.camera); assert.equal(renderer.snapshot().projectionMode, 'orthographic'); assert.equal(renderer.snapshot().dragMode, 'pan');
  const next = model(); next.camera.position = [12, 3, 7]; next.camera.fovDegrees = 75; renderer.setModel(next); assert.deepEqual(renderer.snapshot().camera, next.camera); assert.equal(renderer.snapshot().projectionMode, 'orthographic');
  renderer.dispose(); const snapshot = renderer.snapshot(); assert.equal(renderer.setProjectionMode('perspective'), false); assert.deepEqual(renderer.snapshot(), snapshot);
  const fresh = fixture(); assert.equal(fresh.renderer.snapshot().projectionMode, 'perspective'); fresh.renderer.dispose();
});

test('switching modes cancels old orbit pan and qualified double-click gestures including valid same-mode requests', () => {
  const f = fixture(), renderer = f.renderer; renderer.setModel(model());
  for (const mode of ['orthographic', 'orthographic', 'perspective', 'bad']) {
    f.send('pointerdown'); f.send('pointerup'); const count = f.picks.length; renderer.setProjectionMode(mode); f.send('dblclick', { timeStamp: 110 }); assert.equal(f.picks.length, count);
    for (const shiftKey of [false, true]) { f.send('pointerdown', { shiftKey }); renderer.setProjectionMode(mode); const before = renderer.snapshot(); move(f); f.send('pointerup'); assert.deepEqual(renderer.snapshot(), before); }
  }
  renderer.dispose();
});

test('same-mode requests do not redraw and malformed modes empty scene or lost context cannot change camera selection or mode', () => {
  const options = {}, f = fixture(options), renderer = f.renderer; const initial = renderer.snapshot(); assert.equal(renderer.setProjectionMode('orthographic'), false); assert.deepEqual(renderer.snapshot(), initial);
  renderer.setModel(model()); renderer.setSelectedObject(model().objects[0].instanceId); const before = renderer.snapshot(), calls = f.calls.length;
  assert.equal(renderer.setProjectionMode('perspective'), true); for (const mode of [null, undefined, '', 'Orthographic', 1, {}, [], 'constructor']) assert.equal(renderer.setProjectionMode(mode), false);
  assert.deepEqual(renderer.snapshot(), before); assert.equal(f.calls.length, calls); options.lost = true; assert.equal(renderer.setProjectionMode('orthographic'), false); assert.deepEqual(renderer.snapshot(), before); renderer.dispose();
});

test('invalid numeric camera and Float32 geometry refuse projection changes before upload', () => {
  for (const change of [value => value.camera.position = [...value.camera.target], value => value.camera.near = value.camera.far, value => value.camera.fovDegrees = Infinity, value => value.objects[0].size[0] = 1e39]) {
    const f = fixture(), value = model(); change(value); f.renderer.setModel(value); const before = f.renderer.snapshot(), calls = f.calls.length;
    assert.equal(f.renderer.setProjectionMode('orthographic'), false); assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.calls.length, calls); assert.deepEqual(f.errors, []); f.renderer.dispose();
  }
});

test('GPU projection failure rolls mode back preserves camera and focus range and invalidates partially drawn picking even if diagnostics throw', () => {
  const f = fixture({ throwConsumer: true }), renderer = f.renderer; renderer.setModel(model()); renderer.focusAll(); renderer.setSelectedObject(model().objects[0].instanceId); renderer.setDragMode('pan');
  const before = renderer.snapshot(), old = f.gl.uniformMatrix4fv; f.gl.uniformMatrix4fv = () => { throw Error('injected projection upload failure'); };
  assert.equal(renderer.setProjectionMode('orthographic'), false); assert.deepEqual(renderer.snapshot(), before); assert.equal(renderer.hitTest(160, 120), null); assert.deepEqual(f.errors, ['injected projection upload failure']);
  f.gl.uniformMatrix4fv = old; renderer.render(); for (let index = 0; index < 8; index++) f.send('wheel', { deltaY: 1000 }); near([distance(renderer.snapshot().camera) / distance(before.camera)], [4], 1e-8); renderer.dispose();
});

test('context loss during projection upload does not publish mode frame or a successful draw', () => {
  const options = {}, f = fixture(options), renderer = f.renderer; renderer.setModel(model()); const before = renderer.snapshot(), old = f.gl.drawArrays;
  f.gl.drawArrays = (...args) => { old(...args); options.lost = true; }; assert.equal(renderer.setProjectionMode('orthographic'), false); assert.deepEqual(renderer.snapshot(), before);
  assert.deepEqual(f.errors, ['WebGL2 projection change draw did not complete.']); options.lost = false; assert.equal(renderer.hitTest(160, 120), null); renderer.dispose();
});
