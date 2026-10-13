import test from 'node:test';
import assert from 'node:assert/strict';
import { createScene3DRenderer } from '../../web/modules/scene3d-renderer.js';

const distance = camera => Math.hypot(...camera.position.map((value, axis) => value - camera.target[axis]));
const heading = camera => camera.position.map((value, axis) => (value - camera.target[axis]) / distance(camera));
const near = (actual, expected, epsilon = 1e-9) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= epsilon, `${actual} != ${expected}`));
const model = () => ({ background: '#142538', camera: { position: [0, 0, 8], target: [0, 0, 0], fovDegrees: 50, near: .1, far: 100 },
  light: { direction: [1, -2, -1], color: '#ffffff', energy: 1 },
  objects: [{ instanceId: '11111111-1111-4111-8111-111111111111', position: [0, 0, 0], rotationDegrees: [23, -41, 67], size: [2, 2, 2], color: '#85d7bb' }] });
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
function uploadedCenter(f) {
  const matrix = name => f.calls.findLast(call => call[0] === 'uniformMatrix4fv' && call[1] === name)[3];
  const transform = (m, v) => Array.from({ length: 4 }, (_, row) => { let sum = Math.fround(0); for (let column = 0; column < 4; column++) sum = Math.fround(sum + Math.fround(m[column * 4 + row] * v[column])); return sum; });
  const view = matrix('viewProjection'), object = matrix('model');
  assert.ok(view instanceof Float32Array && object instanceof Float32Array); assert.ok([...view, ...object].every(Number.isFinite));
  const clip = transform(view, transform(object, [0, 0, 0, 1])), rect = f.canvas.getBoundingClientRect();
  assert.ok(clip.every(Number.isFinite) && clip[3] > 0);
  return [rect.left + (clip[0] / clip[3] + 1) * rect.width / 2, rect.top + (1 - clip[1] / clip[3]) * rect.height / 2];
}
const beginPan = (f, extra = {}) => { f.renderer.setDragMode('pan'); f.send('pointerdown', extra); };
const move = (f, dx = 30, dy = -15, extra = {}) => f.send('pointermove', { clientX: 160 + dx, clientY: 120 + dy, ...extra });
const click = (f, extra = {}) => { f.send('pointerdown', extra); f.send('pointerup', extra); };

test('drag mode is local state without redraw and survives model refresh and reset while fresh renderers default to orbit', () => {
  const f = fixture(), renderer = f.renderer; assert.equal(renderer.snapshot().dragMode, 'orbit');
  assert.equal(renderer.setDragMode('pan'), true); renderer.setModel(model()); renderer.setSelectedObject(model().objects[0].instanceId);
  const before = renderer.snapshot(), calls = f.calls.length; assert.equal(renderer.setDragMode('orbit'), true); assert.equal(renderer.setDragMode('pan'), true);
  assert.deepEqual(renderer.snapshot(), before); assert.equal(f.calls.length, calls);
  for (const value of [null, undefined, '', 'Pan', 'slide', 0, {}]) assert.equal(renderer.setDragMode(value), false);
  assert.deepEqual(renderer.snapshot(), before); renderer.resetView(); assert.equal(renderer.snapshot().dragMode, 'pan');
  renderer.setModel(model()); assert.equal(renderer.snapshot().dragMode, 'pan'); renderer.dispose(); const disposed = renderer.snapshot();
  assert.equal(renderer.setDragMode('orbit'), false); assert.deepEqual(renderer.snapshot(), disposed);
  const fresh = fixture(); assert.equal(fresh.renderer.snapshot().dragMode, 'orbit'); fresh.renderer.dispose();
});

test('selected pan Shift-left and middle-button gestures move target-plane GPU geometry by CSS displacement without author writes', () => {
  for (const gesture of [{ mode: 'pan', button: 0 }, { mode: 'orbit', button: 0, shiftKey: true }, { mode: 'orbit', button: 1 }]) {
    const f = fixture(), renderer = f.renderer, value = model(), source = JSON.stringify(value); renderer.setModel(value); renderer.setSelectedObject(value.objects[0].instanceId); renderer.setDragMode(gesture.mode);
    const before = renderer.snapshot(), center = uploadedCenter(f); let prevented = false;
    f.send('pointerdown', { ...gesture, preventDefault() { prevented = true; } }); move(f, 30, -15, { shiftKey: false, buttons: gesture.button === 1 ? 4 : 1 });
    const after = renderer.snapshot(); near(uploadedCenter(f), [center[0] + 30, center[1] - 15], .00003);
    near(heading(after.camera), heading(before.camera)); assert.equal(distance(after.camera), distance(before.camera));
    for (const key of ['fovDegrees', 'near', 'far']) assert.equal(after.camera[key], before.camera[key]);
    assert.equal(prevented, true); assert.equal(after.selectedInstanceId, before.selectedInstanceId); assert.equal(after.dragMode, gesture.mode);
    f.send('pointerup', { button: gesture.button, clientX: 190, clientY: 105 }); f.send('dblclick', { clientX: 190, clientY: 105 }); assert.deepEqual(f.picks, []);
    assert.equal(JSON.stringify(value), source); renderer.dispose();
  }
});

test('six standard views use current CSS dimensions and rounded buffer aspect for actual Float32 pan displacement', () => {
  for (const bounds of [{ left: 7, top: 11, width: 390, height: 844 }, { left: 7, top: 11, width: 2000, height: 4999 }, { left: 7, top: 11, width: 8192, height: 1 }]) {
    const f = fixture({ bounds, dpr: 2 }), renderer = f.renderer; renderer.setModel(model()); renderer.setDragMode('pan');
    for (const name of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
      assert.equal(renderer.setViewDirection(name), true); const before = renderer.snapshot().camera, center = uploadedCenter(f);
      f.send('pointerdown'); move(f, 19, -7); f.send('pointerup', { clientX: 179, clientY: 113 });
      near(uploadedCenter(f), [center[0] + 19, center[1] - 7], .001); near(heading(renderer.snapshot().camera), heading(before));
      assert.deepEqual(renderer.snapshot().camera.up, before.up); assert.equal(renderer.snapshot().camera.fovDegrees, before.fovDegrees);
    }
    renderer.dispose();
  }
});

test('picking after pan uses the newly drawn frame and orbit-mode click and double-click remain intact', () => {
  const f = fixture(), renderer = f.renderer, value = model(); renderer.setModel(value); renderer.setViewDirection('top'); beginPan(f); move(f, 50, 20); f.send('pointerup', { clientX: 210, clientY: 140 });
  const point = uploadedCenter(f); assert.equal(renderer.hitTest(...point), value.objects[0].instanceId); renderer.setDragMode('orbit');
  click(f, { clientX: point[0], clientY: point[1] }); f.send('dblclick', { clientX: point[0], clientY: point[1], timeStamp: 110 });
  assert.deepEqual(f.picks, [[value.objects[0].instanceId, { focus: false }], [value.objects[0].instanceId, { focus: true }]]); renderer.dispose();
});

test('pan has the existing four-pixel threshold and a tiny pan cannot select or reuse a qualified double click', () => {
  for (const extra of [{ mode: 'pan' }, { mode: 'orbit', shiftKey: true }, { mode: 'orbit', button: 1 }]) {
    const f = fixture(), renderer = f.renderer; renderer.setModel(model()); click(f); assert.equal(f.picks.length, 1); renderer.setDragMode(extra.mode); const before = renderer.snapshot();
    f.send('pointerdown', extra); move(f, 3, 0, extra); assert.deepEqual(renderer.snapshot(), before);
    f.send('pointerup', { ...extra, clientX: 163 }); f.send('dblclick', { clientX: 163, timeStamp: 110 }); assert.equal(f.picks.length, 1);
    f.send('pointerdown', extra); move(f, 5, 0, extra); assert.equal(renderer.snapshot().draws, before.draws + 1); renderer.dispose();
  }
});

test('gesture mode and button are latched at pointerdown while an added button chord cancels the gesture', () => {
  const f = fixture(), renderer = f.renderer; renderer.setModel(model()); const initial = renderer.snapshot().camera;
  f.send('pointerdown'); move(f, 30, -15, { shiftKey: true }); assert.deepEqual(renderer.snapshot().camera.target, initial.target); assert.notDeepEqual(renderer.snapshot().camera.position, initial.position);
  f.send('pointerup', { clientX: 190, clientY: 105 }); renderer.resetView(); f.send('pointerdown', { shiftKey: true }); move(f, 30, -15, { shiftKey: false });
  near(heading(renderer.snapshot().camera), heading(initial)); assert.notDeepEqual(renderer.snapshot().camera.target, initial.target);
  const before = renderer.snapshot(); move(f, 60, 0, { buttons: 3 }); move(f, 80, 0); f.send('pointerup'); assert.deepEqual(renderer.snapshot(), before); assert.deepEqual(f.picks, []); renderer.dispose();
});

test('mode changes extra pointers buttons cancellation and capture loss end a pending pan without a late pick', () => {
  for (const cancel of [f => f.renderer.setDragMode('orbit'), f => f.send('pointerdown', { pointerId: 8, isPrimary: false }), f => f.send('pointerdown', { button: 2 }),
    f => f.send('pointercancel'), f => f.send('lostpointercapture'), f => f.send('pointermove', { clientX: NaN }), f => f.send('pointermove', { isPrimary: false })]) {
    const f = fixture(); f.renderer.setModel(model()); beginPan(f); cancel(f); const before = f.renderer.snapshot(); move(f); f.send('pointerup'); f.send('dblclick');
    assert.deepEqual(f.renderer.snapshot(), before); assert.deepEqual(f.picks, []); assert.equal(f.captures.size, 0); f.renderer.dispose();
  }
});

test('scroll is captured at the owning document and reset focus refresh resize and dispose cancel pending gestures', () => {
  for (const cancel of [f => f.documentEvents.get('scroll').callback({}), f => f.renderer.resetView(), f => f.renderer.focusAll(),
    f => f.renderer.focusObject(model().objects[0].instanceId), f => f.renderer.setViewDirection('bottom'), f => f.renderer.setModel(model()), f => f.resize(), f => f.renderer.dispose()]) {
    const f = fixture(); f.renderer.setModel(model()); assert.equal(f.documentEvents.get('scroll').capture, true); beginPan(f); cancel(f); const before = f.renderer.snapshot();
    move(f); f.send('pointerup'); assert.deepEqual(f.renderer.snapshot(), before); assert.deepEqual(f.picks, []); f.renderer.dispose();
    assert.equal(f.documentEvents.size, 0); assert.equal(f.events.size, 0); assert.equal(f.captures.size, 0);
  }
});

test('stale CSS position size DPR and drawing buffer changes cancel pan before camera or GPU mutation', () => {
  for (const change of [(options, f) => options.bounds = { ...f.canvas.getBoundingClientRect(), left: 11 },
    (options, f) => options.bounds = { ...f.canvas.getBoundingClientRect(), width: 301 }, options => options.dpr = 2, (_, f) => f.canvas.width++]) {
    const options = {}, f = fixture(options); f.renderer.setModel(model()); beginPan(f); change(options, f); const before = f.renderer.snapshot(), calls = f.calls.length;
    move(f); f.send('pointerup'); assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.calls.length, calls); assert.deepEqual(f.picks, []); f.renderer.dispose();
  }
});

test('pan retains fitted zoom bounds clipping and selection while reset restores author camera without resetting drag mode', () => {
  const f = fixture(), renderer = f.renderer, value = model(); value.camera.fovDegrees = 179; value.objects[0].size = [.001, .001, .001]; renderer.setModel(value); renderer.setViewDirection('top'); renderer.setSelectedObject(value.objects[0].instanceId);
  const before = renderer.snapshot(); beginPan(f); move(f, 9, 13); f.send('pointerup', { clientX: 169, clientY: 133 }); const after = renderer.snapshot();
  assert.equal(after.camera.near, before.camera.near); assert.equal(after.camera.far, before.camera.far); assert.equal(after.selectedInstanceId, before.selectedInstanceId);
  for (let index = 0; index < 8; index++) f.send('wheel', { deltaY: 1000 }); assert.ok(Math.abs(distance(renderer.snapshot().camera) / distance(before.camera) - 4) < 1e-8);
  for (let index = 0; index < 16; index++) f.send('wheel', { deltaY: -1000 }); assert.ok(Math.abs(distance(renderer.snapshot().camera) / distance(before.camera) - .25) < 1e-8);
  renderer.resetView(); assert.deepEqual(renderer.snapshot().camera, value.camera); assert.equal(renderer.snapshot().dragMode, 'pan'); renderer.dispose();
});

test('GPU pan failure restores the entire camera and selection and clears stale picking and the failed gesture even if its consumer throws', () => {
  const f = fixture({ throwConsumer: true }), renderer = f.renderer; renderer.setModel(model()); renderer.setViewDirection('top'); renderer.setSelectedObject(model().objects[0].instanceId); beginPan(f);
  const before = renderer.snapshot(), upload = f.gl.uniformMatrix4fv; f.gl.uniformMatrix4fv = () => { throw Error('injected pan upload failure'); };
  assert.doesNotThrow(() => move(f)); assert.deepEqual(renderer.snapshot(), before); assert.deepEqual(f.errors, ['injected pan upload failure']); assert.equal(renderer.hitTest(160, 120), null);
  f.gl.uniformMatrix4fv = upload; move(f, 60, 30); f.send('pointerup'); assert.deepEqual(renderer.snapshot(), before); assert.deepEqual(f.picks, []); assert.equal(renderer.render(), true); renderer.dispose();
});

test('context loss during pan draw cannot publish the camera frame or successful draw count', () => {
  const options = {}, f = fixture(options), renderer = f.renderer; renderer.setModel(model()); beginPan(f); const before = renderer.snapshot(), draw = f.gl.drawArrays;
  f.gl.drawArrays = (...args) => { draw(...args); options.lost = true; }; move(f); assert.deepEqual(renderer.snapshot(), before); assert.deepEqual(f.errors, ['WebGL2 camera pan draw did not complete.']);
  options.lost = false; assert.equal(renderer.hitTest(160, 120), null); move(f, 60, 30); assert.deepEqual(renderer.snapshot(), before); renderer.dispose();
});

test('already lost context cancels pan even without a loss event and cannot resume it after recovery', () => {
  const options = {}, f = fixture(options); f.renderer.setModel(model()); beginPan(f); const before = f.renderer.snapshot(); options.lost = true; move(f); options.lost = false;
  move(f, 60, 30); f.send('pointerup'); assert.deepEqual(f.renderer.snapshot(), before); assert.deepEqual(f.picks, []); assert.deepEqual(f.errors, []); f.renderer.dispose();
});

test('nonfinite uploads and camera numeric overflow refuse pan before drawing or author mutation', () => {
  for (const malformed of [true, false]) {
    const f = fixture(), value = model(); f.renderer.setModel(value); if (malformed) value.objects[0].size[0] = 1e39;
    beginPan(f); const before = f.renderer.snapshot(), calls = f.calls.length, source = JSON.stringify(value); move(f, malformed ? 30 : 1e308, 0);
    assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.calls.length, calls); assert.deepEqual(f.errors, []); assert.equal(JSON.stringify(value), source);
    move(f); assert.deepEqual(f.renderer.snapshot(), before); f.renderer.dispose();
  }
});

test('panned camera snapshots remain detached and later standard view focus and author reset remain usable', () => {
  const f = fixture(), renderer = f.renderer, value = model(), source = JSON.stringify(value); renderer.setModel(value); renderer.setViewDirection('bottom'); beginPan(f); move(f); f.send('pointerup');
  const snapshot = renderer.snapshot(), retained = renderer.snapshot(); snapshot.camera.position[0] = 99; snapshot.camera.target[0] = 99; snapshot.camera.up[0] = 99;
  assert.deepEqual(renderer.snapshot(), retained); assert.equal(renderer.focusAll(), true); assert.equal(renderer.focusObject(value.objects[0].instanceId), true); assert.equal(renderer.setViewDirection('front'), true);
  renderer.resetView(); assert.deepEqual(renderer.snapshot().camera, value.camera); assert.equal(JSON.stringify(value), source); renderer.dispose();
});
