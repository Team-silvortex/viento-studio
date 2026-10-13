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
  const calls = [], events = new Map(), documentEvents = new Map(), captures = new Set(), picks = [], errors = [], views = []; let observer;
  const eventTarget = entries => ({ addEventListener: (name, callback, capture) => entries.set(name, { callback, capture }), removeEventListener: name => entries.delete(name) });
  const gl = Object.fromEntries(['COMPILE_STATUS', 'LINK_STATUS', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'ARRAY_BUFFER', 'STATIC_DRAW', 'FLOAT', 'DEPTH_TEST', 'LEQUAL', 'CULL_FACE', 'COLOR_BUFFER_BIT', 'DEPTH_BUFFER_BIT', 'TRIANGLES'].map((key, index) => [key, index + 1]));
  for (const name of ['createProgram', 'createShader', 'createBuffer', 'createVertexArray']) gl[name] = () => ({});
  for (const name of ['attachShader', 'shaderSource', 'compileShader', 'linkProgram', 'bindVertexArray', 'bindBuffer', 'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'viewport', 'enable', 'depthFunc', 'disable', 'clearColor', 'clear', 'useProgram', 'uniformMatrix4fv', 'uniform3fv', 'uniform1f', 'uniform1i', 'drawArrays', 'deleteBuffer', 'deleteVertexArray', 'deleteProgram', 'deleteShader']) gl[name] = (...args) => calls.push([name, ...args]);
  gl.getShaderParameter = gl.getProgramParameter = () => true; gl.getUniformLocation = (_, name) => name;
  gl.isContextLost = () => Boolean(options.lost); gl.getExtension = () => null;
  const canvas = { ...eventTarget(events), ownerDocument: eventTarget(documentEvents), width: 0, height: 0, getContext: () => gl,
    getBoundingClientRect: () => options.bounds || { left: 10, top: 20, width: 300, height: 200 },
    setPointerCapture: id => { if (options.captureFailure === id) throw Error('capture failure'); captures.add(id); }, hasPointerCapture: id => captures.has(id),
    releasePointerCapture(id) { captures.delete(id); if (options.releaseFailure === id) throw Error('release failure'); events.get('lostpointercapture')?.callback({ pointerId: id }); } };
  const renderer = createScene3DRenderer(canvas, { pixelRatio: () => options.dpr || 1,
    scheduleTouch: options.scheduleTouch, cancelTouch: options.cancelTouch,
    onViewChange: receipt => { views.push(receipt); options.onViewChange?.(receipt); },
    onError: error => { errors.push(error.message); if (options.throwConsumer) throw Error('consumer failed'); }, onPick: (...args) => picks.push(args),
    observe: callback => { observer = callback; return { observe() {}, disconnect() {} }; } });
  const send = (name, extra = {}) => events.get(name)?.callback({ button: 0, isPrimary: true, pointerId: 7, clientX: 160, clientY: 120, timeStamp: 100, preventDefault() {}, ...extra });
  return { gl, canvas, renderer, calls, events, documentEvents, captures, picks, errors, views, send, resize: () => observer() };
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
const points = [[115, 95], [205, 105]];
const touch = (f, type, index, point = points[index], extra = {}) => f.send(type, {
  pointerType: 'touch', pointerId: 41 + index, isPrimary: index === 0, buttons: type === 'pointerup' ? 0 : 1,
  clientX: point[0], clientY: point[1], ...extra });
const begin = (f, positions = points) => { touch(f, 'pointerdown', 0, positions[0]); touch(f, 'pointerdown', 1, positions[1]); };
const end = f => { touch(f, 'pointerup', 1); touch(f, 'pointerup', 0); };
function project(f, world) {
  const m = f.calls.findLast(call => call[0] === 'uniformMatrix4fv' && call[1] === 'viewProjection')[3];
  const origin = f.renderer.snapshot().camera.target, vector = [...world.map((value, axis) => value - origin[axis]), 1];
  const clip = Array.from({ length: 4 }, (_, row) => vector.reduce((sum, value, column) => sum + m[column * 4 + row] * value, 0));
  const rect = f.canvas.getBoundingClientRect();
  return [rect.left + (clip[0] / clip[3] + 1) * rect.width / 2, rect.top + (1 - clip[1] / clip[3]) * rect.height / 2];
}
function planePoint(f, screen) {
  const camera = f.renderer.snapshot().camera, rect = f.canvas.getBoundingClientRect();
  const m = f.calls.findLast(call => call[0] === 'uniformMatrix4fv' && call[1] === 'viewProjection')[3];
  const unit = value => { const length = Math.hypot(...value); return value.map(n => n / length); };
  const right = unit([m[0], m[4], m[8]]), up = unit([m[1], m[5], m[9]]);
  const height = 2 * distance(camera) * Math.tan(camera.fovDegrees * Math.PI / 360), width = height * f.canvas.width / f.canvas.height;
  return camera.target.map((value, axis) => value + right[axis] * width * ((screen[0] - rect.left) / rect.width - .5)
    - up[axis] * height * ((screen[1] - rect.top) / rect.height - .5));
}
const midpoint = pair => pair[0].map((value, axis) => value / 2 + pair[1][axis] / 2);
const span = pair => Math.hypot(pair[1][0] - pair[0][0], pair[1][1] - pair[0][1]);
const load = (f, value = model()) => { f.renderer.setModel(value); return value; };

test('touch navigation is an immutable renderer feature hint and adds no author methods', () => {
  const f = fixture(); assert.equal(f.renderer.supportsTouchNavigation, true); assert.ok(Object.isFrozen(f.renderer));
  assert.throws(() => f.renderer.supportsTouchNavigation = false, TypeError); f.renderer.dispose();
});

test('off-centre pinch and translation form one GPU frame with anchored target-plane geometry in both projections', () => {
  for (const mode of ['perspective', 'orthographic']) {
    const f = fixture(), value = load(f), source = JSON.stringify(value); f.renderer.setProjectionMode(mode); f.renderer.setSelectedObject(value.objects[0].instanceId);
    const start = [[60, 55], [140, 55]], next = [[60, 55], [170, 83]], anchor = planePoint(f, midpoint(start));
    const old = f.renderer.snapshot(), receipts = f.views.length, calls = f.calls.length; begin(f, start);
    assert.deepEqual(f.renderer.snapshot(), old); touch(f, 'pointermove', 1, next[1]); const after = f.renderer.snapshot();
    near(project(f, anchor), midpoint(next), 2e-5); near(heading(after.camera), heading(old.camera));
    assert.ok(Math.abs(distance(after.camera) / distance(old.camera) - span(start) / span(next)) < 1e-12);
    assert.equal(after.draws, old.draws + 1); assert.equal(f.calls.slice(calls).filter(call => call[0] === 'drawArrays').length, 1);
    assert.equal(f.views.length, receipts + 1); assert.deepEqual(f.views.at(-1).camera, after.camera);
    assert.equal(after.selectedInstanceId, old.selectedInstanceId); assert.equal(JSON.stringify(value), source); end(f); assert.deepEqual(f.picks, []); f.renderer.dispose();
  }
});

test('six directions and free orbit keep heading up projection selection and picking through touch navigation', () => {
  for (const mode of ['perspective', 'orthographic']) for (const direction of ['front', 'back', 'left', 'right', 'top', 'bottom', 'free']) {
    const f = fixture({ dpr: 2, bounds: { left: 10, top: 20, width: 301.3, height: 197.7 } }), value = load(f);
    f.renderer.setProjectionMode(mode); f.renderer.setViewDirection(direction === 'free' ? 'top' : direction);
    if (direction === 'free') { f.send('pointerdown'); f.send('pointermove', { clientX: 192, clientY: 137 }); f.send('pointerup'); }
    f.renderer.setSelectedObject(value.objects[0].instanceId); const before = f.renderer.snapshot(), anchor = planePoint(f, midpoint(points));
    begin(f); const next = [points[0], [221, 114]]; touch(f, 'pointermove', 1, next[1]); const after = f.renderer.snapshot();
    near(project(f, anchor), midpoint(next), 2e-5); near(heading(after.camera), heading(before.camera)); near(after.camera.up, before.camera.up);
    assert.equal(after.projectionMode, mode); assert.equal(after.selectedInstanceId, before.selectedInstanceId); end(f);
    const centre = uploadedCenter(f); assert.equal(f.renderer.hitTest(...centre), value.objects[0].instanceId); f.renderer.dispose();
  }
});

test('two fingers override either single-finger drag mode without changing its selected value', () => {
  for (const mode of ['orbit', 'pan']) {
    const f = fixture(); load(f); f.renderer.setDragMode(mode); const before = f.renderer.snapshot(); begin(f); touch(f, 'pointermove', 1, [228, 119]);
    const after = f.renderer.snapshot(); assert.equal(after.dragMode, mode); near(heading(after.camera), heading(before.camera)); assert.notDeepEqual(after.camera.target, before.camera.target); end(f); f.renderer.dispose();
  }
});

test('one finger promotes from its latest point and already rotated camera without a promotion jump', () => {
  for (const delta of [2, 30]) {
    const f = fixture(); load(f); touch(f, 'pointerdown', 0, points[0]); const first = [points[0][0] + delta, points[0][1] + 1];
    touch(f, 'pointermove', 0, first); const before = f.renderer.snapshot(); touch(f, 'pointerdown', 1, points[1]); assert.deepEqual(f.renderer.snapshot(), before);
    const anchor = planePoint(f, midpoint([first, points[1]])), next = [first, [222, 117]]; touch(f, 'pointermove', 1, next[1]);
    near(project(f, anchor), midpoint(next), 2e-5); near(heading(f.renderer.snapshot().camera), heading(before.camera)); end(f); f.renderer.dispose();
  }
});

test('pair movement waits for four CSS pixels and stationary duplicate events do not redraw', () => {
  const f = fixture(); load(f); begin(f); const before = f.renderer.snapshot();
  touch(f, 'pointermove', 0, [117, 95]); touch(f, 'pointermove', 1, [209, 105]); assert.deepEqual(f.renderer.snapshot(), before);
  touch(f, 'pointermove', 1, [210, 105]); assert.equal(f.renderer.snapshot().draws, before.draws + 1);
  const after = f.renderer.snapshot(); touch(f, 'pointermove', 1, [210, 105]); assert.deepEqual(f.renderer.snapshot(), after); end(f); assert.deepEqual(f.picks, []); f.renderer.dispose();
});

test('either lift order releases both captures and cannot continue as one finger or select on delayed events', () => {
  for (const first of [0, 1]) {
    const f = fixture(); load(f); f.send('pointerdown'); f.send('pointerup'); assert.equal(f.picks.length, 1); begin(f);
    touch(f, 'pointermove', 1, [220, 115]); touch(f, 'pointerup', first); const before = f.renderer.snapshot(); assert.equal(f.captures.size, 0);
    touch(f, 'pointermove', 1 - first, [240, 130]); touch(f, 'pointerdown', 2, [100, 100]); touch(f, 'pointermove', 2, [200, 100]);
    touch(f, 'pointerup', 1 - first); f.send('dblclick'); assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.picks.length, 1);
    begin(f); touch(f, 'pointermove', 1, [230, 120]); assert.equal(f.renderer.snapshot().draws, before.draws + 1); end(f); f.renderer.dispose();
  }
});

test('pair cancellation capture loss third pointer mixed type and button chords never leave a late gesture', () => {
  const cancellations = [f => touch(f, 'pointercancel', 0), f => touch(f, 'pointercancel', 1), f => touch(f, 'lostpointercapture', 0), f => touch(f, 'lostpointercapture', 1),
    f => touch(f, 'pointerdown', 2, [140, 130]), f => f.send('pointerdown', { pointerType: 'mouse', pointerId: 7 }),
    f => touch(f, 'pointermove', 1, [220, 110], { pointerType: 'pen' }), f => touch(f, 'pointermove', 1, [220, 110], { buttons: 3 }),
    f => touch(f, 'pointermove', 1, [NaN, 110]), f => touch(f, 'pointermove', 1, [116, 95])];
  for (const cancel of cancellations) {
    const f = fixture(); load(f); begin(f); cancel(f); const before = f.renderer.snapshot(); touch(f, 'pointermove', 0, [90, 70]); touch(f, 'pointermove', 1, [230, 120]); end(f); f.send('dblclick');
    assert.deepEqual(f.renderer.snapshot(), before); assert.deepEqual(f.picks, []); assert.equal(f.captures.size, 0); f.renderer.dispose();
  }
});

test('non-touch mixed duplicate and non-primary first contacts cannot promote the old gesture', () => {
  for (const firstType of [undefined, 'mouse', 'pen', 'touch']) for (const secondType of [undefined, 'mouse', 'pen', 'touch']) {
    if (firstType === 'touch' && secondType === 'touch') continue;
    const f = fixture(); load(f); f.send('pointerdown', { pointerType: firstType }); f.send('pointerdown', { pointerType: secondType, pointerId: 8, isPrimary: false, clientX: 240 });
    const before = f.renderer.snapshot(); f.send('pointermove', { pointerType: firstType, clientX: 220 }); f.send('pointerup'); assert.deepEqual(f.renderer.snapshot(), before); assert.deepEqual(f.picks, []); f.renderer.dispose();
  }
  for (const extra of [{ isPrimary: false }, { isPrimary: undefined }, { button: 1 }]) {
    const f = fixture(); load(f); const before = f.renderer.snapshot(); touch(f, 'pointerdown', 0, points[0], extra); touch(f, 'pointermove', 0, [170, 120]); touch(f, 'pointerup', 0); assert.deepEqual(f.renderer.snapshot(), before); assert.deepEqual(f.picks, []); f.renderer.dispose();
  }
  const f = fixture(); load(f); touch(f, 'pointerdown', 0); touch(f, 'pointerdown', 0, [150, 120]); const before = f.renderer.snapshot(); touch(f, 'pointermove', 0, [190, 130]); assert.deepEqual(f.renderer.snapshot(), before); f.renderer.dispose();
});

test('tiny coincident and invalid second contacts terminate before capture or a GPU transition', () => {
  for (const second of [[115, 95], [117, 95], [NaN, 95], [Infinity, 95], [-1e308, 1e308]]) {
    const f = fixture(); load(f); touch(f, 'pointerdown', 0, second[0] === -1e308 ? [1e308, -1e308] : points[0]); const before = f.renderer.snapshot();
    touch(f, 'pointerdown', 1, second); touch(f, 'pointermove', 0, [90, 80]); touch(f, 'pointermove', 1, [220, 115]); end(f); assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.captures.size, 0); f.renderer.dispose();
  }
});

test('capture failures during first contact promotion and release cannot escape or keep a live session', () => {
  for (const options of [{ captureFailure: 41 }, { captureFailure: 42 }, { releaseFailure: 41 }, { releaseFailure: 42 }]) {
    const f = fixture(options); load(f); const before = f.renderer.snapshot(); assert.doesNotThrow(() => begin(f)); if (options.releaseFailure) assert.doesNotThrow(() => end(f));
    touch(f, 'pointermove', 1, [225, 120]); touch(f, 'pointermove', 0, [90, 80]); assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.captures.size, 0); f.renderer.dispose();
  }
});

test('reset refresh projection drag choice framing wheel scroll resize render and disposal end both touches', () => {
  const cancellations = [f => f.renderer.resetView(), f => f.renderer.setModel(model()), f => f.renderer.setProjectionMode('orthographic'),
    f => f.renderer.setDragMode('pan'), f => f.renderer.setViewDirection('top'), f => f.renderer.focusAll(), f => f.renderer.focusObject(model().objects[0].instanceId),
    f => f.send('wheel', { deltaY: 10 }), f => f.documentEvents.get('scroll').callback({}), f => f.resize(), f => f.renderer.render(), f => f.renderer.dispose()];
  for (const cancel of cancellations) {
    const f = fixture(); load(f); begin(f); cancel(f); const before = f.renderer.snapshot(); touch(f, 'pointermove', 1, [225, 119]); end(f); f.send('dblclick');
    assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.captures.size, 0); assert.deepEqual(f.picks, []); f.renderer.dispose(); assert.equal(f.events.size, 0); assert.equal(f.documentEvents.size, 0);
  }
});

test('stale dimensions DPR canvas buffer and page position cancel before promotion or pair motion', () => {
  const changes = [(o, f) => o.bounds = { ...f.canvas.getBoundingClientRect(), left: 21 }, (o, f) => o.bounds = { ...f.canvas.getBoundingClientRect(), width: 299 },
    o => o.dpr = 2, (_, f) => f.canvas.width++];
  for (const promotion of [false, true]) for (const change of changes) {
    const options = {}, f = fixture(options); load(f); touch(f, 'pointerdown', 0); if (!promotion) touch(f, 'pointerdown', 1); change(options, f);
    const before = f.renderer.snapshot(), calls = f.calls.length; if (promotion) touch(f, 'pointerdown', 1); touch(f, 'pointermove', 1, [230, 120]); end(f);
    assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.calls.length, calls); assert.deepEqual(f.picks, []); f.renderer.dispose();
  }
});

test('a changed selection redraw retains the pair only on unchanged geometry', () => {
  const f = fixture(), value = load(f); begin(f); f.renderer.setSelectedObject(value.objects[0].instanceId); const before = f.renderer.snapshot(); touch(f, 'pointermove', 1, [220, 115]);
  assert.equal(f.renderer.snapshot().draws, before.draws + 1); assert.equal(f.renderer.snapshot().selectedInstanceId, value.objects[0].instanceId); end(f); f.renderer.dispose();
});

test('clamped pinch updates its reference immediately so reversing has no dead zone and clipping stays valid', () => {
  for (const small of [false, true]) for (const mode of ['perspective', 'orthographic']) {
    const f = fixture(), value = model(); value.objects[0].size = small ? [.001, .001, .001] : [1000, 1000, 1000]; value.camera.fovDegrees = small ? 179 : 1;
    load(f, value); f.renderer.setProjectionMode(mode); f.renderer.focusAll(); const fitted = distance(f.renderer.snapshot().camera), start = [[110, 100], [210, 100]];
    begin(f, start); touch(f, 'pointermove', 1, [120, 100]); assert.ok(Math.abs(distance(f.renderer.snapshot().camera) / fitted - 4) < 1e-5);
    touch(f, 'pointermove', 1, [119, 100]); assert.ok(Math.abs(distance(f.renderer.snapshot().camera) / fitted - 4) < 1e-5);
    touch(f, 'pointermove', 1, [120, 100]); const after = f.renderer.snapshot(); assert.ok(Math.abs(distance(after.camera) / fitted - 3.6) < 1e-5);
    assert.ok(after.camera.near > 0 && after.camera.far > after.camera.near); end(f); f.renderer.dispose();
  }
});

test('nonfinite coordinates math overflow or Float32 preflight rejection cancel without changing the valid frame', () => {
  for (const kind of ['nonfinite', 'overflow', 'upload']) {
    const f = fixture(), value = load(f); begin(f); const before = f.renderer.snapshot(), calls = f.calls.length, views = f.views.length;
    if (kind === 'upload') value.objects[0].size[0] = 1e39;
    touch(f, 'pointermove', 1, kind === 'nonfinite' ? [Infinity, 120] : kind === 'overflow' ? [1e308, 1e308] : [230, 120]);
    assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.calls.length, calls); assert.equal(f.views.length, views); assert.equal(f.renderer.hitTest(160, 120), value.objects[0].instanceId);
    touch(f, 'pointermove', 1, [220, 115]); end(f); assert.deepEqual(f.renderer.snapshot(), before); assert.deepEqual(f.errors, []); f.renderer.dispose();
  }
});

test('GPU touch failure rolls back the camera selection and draw count while revoking picking and view receipts', () => {
  for (const lostDuringDraw of [false, true]) {
    const options = { throwConsumer: true }, f = fixture(options), value = load(f); f.renderer.focusAll(); f.renderer.setSelectedObject(value.objects[0].instanceId); begin(f);
    const before = f.renderer.snapshot(), upload = f.gl.uniformMatrix4fv, draw = f.gl.drawArrays;
    if (lostDuringDraw) f.gl.drawArrays = (...args) => { draw(...args); options.lost = true; };
    else f.gl.uniformMatrix4fv = () => { throw Error('injected touch draw failure'); };
    assert.doesNotThrow(() => touch(f, 'pointermove', 1, [230, 120])); assert.deepEqual(f.renderer.snapshot(), before);
    assert.equal(f.views.at(-1), null); assert.equal(f.renderer.hitTest(160, 120), null); assert.equal(f.errors.length, 1); assert.equal(f.captures.size, 0);
    options.lost = false; f.gl.uniformMatrix4fv = upload; f.gl.drawArrays = draw; touch(f, 'pointermove', 1, [240, 130]); end(f); assert.deepEqual(f.renderer.snapshot(), before);
    assert.equal(f.renderer.render(), true); assert.deepEqual(f.views.at(-1).camera, before.camera); assert.equal(f.renderer.focusAll(), true); f.renderer.dispose();
  }
});

test('context loss without an event ends the pair and recovery cannot resume old pointers', () => {
  const options = {}, f = fixture(options); load(f); begin(f); const before = f.renderer.snapshot(); options.lost = true; touch(f, 'pointermove', 1, [230, 120]);
  assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.views.at(-1), null); assert.equal(f.captures.size, 0); options.lost = false;
  touch(f, 'pointermove', 1, [240, 130]); end(f); assert.deepEqual(f.renderer.snapshot(), before); assert.deepEqual(f.errors, []); f.renderer.dispose();
});

test('a view callback disposing the renderer cannot rebase or revive the completed touch session', () => {
  const options = {}, f = fixture(options); load(f); begin(f); options.onViewChange = receipt => { if (receipt) f.renderer.dispose(); };
  assert.doesNotThrow(() => touch(f, 'pointermove', 1, [230, 120])); assert.equal(f.renderer.snapshot().disposed, true); assert.equal(f.captures.size, 0); assert.equal(f.views.at(-1), null); assert.equal(f.events.size, 0);
});

test('disposal from a failed-frame notification cannot restore a camera into the released renderer', () => {
  const options = {}, f = fixture(options); load(f); begin(f); options.onViewChange = receipt => { if (receipt === null) f.renderer.dispose(); };
  f.gl.uniformMatrix4fv = () => { throw Error('failed frame'); };
  assert.doesNotThrow(() => touch(f, 'pointermove', 1, [230, 120])); const after = f.renderer.snapshot();
  assert.equal(after.disposed, true); assert.equal(after.camera, null); assert.equal(after.objectCount, 0); assert.equal(f.captures.size, 0); assert.equal(f.events.size, 0);
});

test('minimum focused distance also rebases during clamping and reverses immediately', () => {
  const f = fixture(); load(f); f.renderer.focusAll(); const fitted = distance(f.renderer.snapshot().camera), start = [[110, 100], [130, 100]];
  begin(f, start); touch(f, 'pointermove', 1, [210, 100]); assert.ok(Math.abs(distance(f.renderer.snapshot().camera) / fitted - .25) < 1e-10);
  touch(f, 'pointermove', 1, [220, 100]); assert.ok(Math.abs(distance(f.renderer.snapshot().camera) / fitted - .25) < 1e-10);
  touch(f, 'pointermove', 1, [210, 100]); assert.ok(Math.abs(distance(f.renderer.snapshot().camera) / fitted - .275) < 1e-10); end(f); f.renderer.dispose();
});

test('explicit primary single touch still picks or follows the selected one-finger drag mode', () => {
  const f = fixture(), value = load(f); touch(f, 'pointerdown', 0, [160, 120]); touch(f, 'pointerup', 0, [160, 120]); assert.deepEqual(f.picks, [[value.objects[0].instanceId, { focus: false }]]);
  touch(f, 'pointerdown', 0); const start = f.renderer.snapshot(); touch(f, 'pointermove', 0, [116, 95]); assert.deepEqual(f.renderer.snapshot(), start);
  touch(f, 'pointermove', 0, [145, 105]); assert.notDeepEqual(heading(f.renderer.snapshot().camera), heading(start.camera)); touch(f, 'pointerup', 0);
  f.renderer.setDragMode('pan'); touch(f, 'pointerdown', 0); const before = f.renderer.snapshot(); touch(f, 'pointermove', 0, [140, 103]); near(heading(f.renderer.snapshot().camera), heading(before.camera));
  assert.notDeepEqual(f.renderer.snapshot().camera.target, before.camera.target); touch(f, 'pointerup', 0); assert.equal(f.picks.length, 1); f.renderer.dispose();
});

test('legal distant authored cameras and near-minimum cameras pan and lightly pinch without snapping to orbit bounds', () => {
  for (const mode of ['perspective', 'orthographic']) for (const distant of [false, true]) {
    const f = fixture(), value = model(); value.camera = distant
      ? { position: [-100000, 0, -100000], target: [100000, 0, 100000], fovDegrees: 60, near: .1, far: 100000 }
      : { position: [0, 0, .02], target: [0, 0, 0], fovDegrees: 60, near: .001, far: 1000 };
    value.objects[0].position = distant ? [-50000, 0, -50000] : [0, 0, 0]; value.objects[0].size = distant ? [1000, 1000, 1000] : [.001, .001, .001];
    load(f, value); f.renderer.setProjectionMode(mode); const source = JSON.stringify(value), before = f.renderer.snapshot(), start = [[110, 90], [190, 90]], final = [[110, 106], [190, 106]];
    const anchor = planePoint(f, midpoint(start)); begin(f, start);
    // The browser emits separate moves for the two fingers. The temporary
    // separation change must not snap a distant camera into the default range.
    touch(f, 'pointermove', 0, final[0]); touch(f, 'pointermove', 1, final[1]);
    const translated = f.renderer.snapshot(); assert.ok(Math.abs(distance(translated.camera) / distance(before.camera) - 1) < 1e-9);
    near(project(f, anchor), midpoint(final), .001); near(heading(translated.camera), heading(before.camera)); end(f);
    const priorDistance = distance(translated.camera), a = [[110, 90], [210, 90]], b = [[115, 90], [210, 90]];
    begin(f, a); touch(f, 'pointermove', 0, b[0]); assert.ok(Math.abs(distance(f.renderer.snapshot().camera) / priorDistance - 100 / 95) < 1e-9); end(f);
    assert.equal(JSON.stringify(value), source); assert.deepEqual(f.errors, []); f.renderer.dispose();
  }
});

test('unfocused view distances below the ordinary minimum retain a bounded proportional gesture range', () => {
  const f = fixture(), value = model(); value.camera = { ...value.camera, position: [0, 0, .001], near: .00001 };
  load(f, value); const before = f.renderer.snapshot(), start = [[110, 90], [190, 90]], moved = [[110, 106], [190, 106]], anchor = planePoint(f, midpoint(start)); begin(f, start);
  touch(f, 'pointermove', 0, moved[0]); touch(f, 'pointermove', 1, moved[1]); assert.ok(Math.abs(distance(f.renderer.snapshot().camera) / distance(before.camera) - 1) < 1e-10);
  near(project(f, anchor), midpoint(moved), .0001); end(f);
  const initial = distance(f.renderer.snapshot().camera); begin(f, [[110, 90], [130, 90]]); touch(f, 'pointermove', 1, [210, 90]);
  assert.ok(Math.abs(distance(f.renderer.snapshot().camera) / initial - .25) < 1e-10);
  for (const x of [230, 250, 290, 330]) { touch(f, 'pointermove', 1, [x, 90]); assert.ok(Math.abs(distance(f.renderer.snapshot().camera) / initial - .25) < 1e-10); }
  touch(f, 'pointermove', 1, [310, 90]); assert.ok(distance(f.renderer.snapshot().camera) > initial / 4); end(f); f.renderer.dispose();
});

test('a distant authored session locks its enlarged upper limit instead of growing it after every frame', () => {
  const f = fixture(), value = model(); value.camera = { position: [-100000, 0, -100000], target: [100000, 0, 100000], fovDegrees: 60, near: .1, far: 100000 };
  load(f, value); const initial = distance(f.renderer.snapshot().camera); begin(f, [[110, 100], [210, 100]]);
  for (const x of [135, 130, 120, 115, 114.5, 114]) {
    touch(f, 'pointermove', 1, [x, 100]); assert.ok(Math.abs(distance(f.renderer.snapshot().camera) / initial - 4) < 1e-9);
  }
  touch(f, 'pointermove', 1, [118, 100]); assert.ok(Math.abs(distance(f.renderer.snapshot().camera) / initial - 2) < 1e-9); end(f); f.renderer.dispose();
});

function queuedFixture(extra = {}) {
  let nextId = 0; const pending = new Map(), retained = new Map(), cancelled = [];
  const options = { ...extra, scheduleTouch: callback => { const id = ++nextId; pending.set(id, callback); retained.set(id, callback); return id; },
    cancelTouch: id => { cancelled.push(id); pending.delete(id); } };
  const f = fixture(options);
  return { ...f, options, pending, retained, cancelled, flush() { const batch = [...pending.values()]; pending.clear(); for (const callback of batch) callback(); } };
}

test('same-frame dual moves pan without unintended zoom at either focused distance clamp', () => {
  for (const mode of ['perspective', 'orthographic']) for (const boundary of ['minimum', 'maximum']) {
    const f = queuedFixture(); load(f); f.renderer.setProjectionMode(mode); f.renderer.focusAll();
    for (let index = 0; index < 10; index++) f.send('wheel', { deltaY: boundary === 'minimum' ? -1000 : 1000 });
    const start = [[110, 90], [190, 90]], finish = start.map(([x, y]) => [x + 12, y + 16]);
    const before = f.renderer.snapshot(), receipts = f.views.length, anchor = planePoint(f, midpoint(start)); begin(f, start);
    touch(f, 'pointermove', 0, finish[0]); touch(f, 'pointermove', 1, finish[1]);
    assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.pending.size, 1); f.flush(); const after = f.renderer.snapshot();
    assert.equal(after.draws, before.draws + 1); assert.equal(f.views.length, receipts + 1);
    assert.ok(Math.abs(distance(after.camera) / distance(before.camera) - 1) < 1e-10); near(project(f, anchor), midpoint(finish), .0001);
    // After rebasing, an inward reversal takes effect on the very next frame.
    const reversed = boundary === 'minimum' ? [finish[1][0] - 6, finish[1][1]] : [finish[1][0] + 6, finish[1][1]];
    touch(f, 'pointermove', 1, reversed); f.flush(); const nextDistance = distance(f.renderer.snapshot().camera);
    assert.ok(boundary === 'minimum' ? nextDistance > distance(after.camera) : nextDistance < distance(after.camera)); end(f); f.renderer.dispose();
  }
});

test('a quick lift synchronously commits the last valid pair once and invalidates its queued callback', () => {
  for (const released of [0, 1]) {
    const f = queuedFixture(); load(f); const start = [[110, 90], [190, 90]], final = [[100, 104], [216, 116]], anchor = planePoint(f, midpoint(start));
    const before = f.renderer.snapshot(); begin(f, start); touch(f, 'pointermove', 0, final[0]); touch(f, 'pointermove', 1, final[1]);
    assert.equal(f.pending.size, 1); const late = [...f.retained.values()]; touch(f, 'pointerup', released, [300, 180]); const after = f.renderer.snapshot();
    assert.equal(after.draws, before.draws + 1); near(project(f, anchor), midpoint(final), .0001); assert.equal(f.pending.size, 0); assert.equal(f.cancelled.length, 1); assert.equal(f.captures.size, 0);
    for (const callback of late) callback(); touch(f, 'pointermove', 1 - released, [240, 130]); end(f); f.send('dblclick'); assert.deepEqual(f.renderer.snapshot(), after); assert.deepEqual(f.picks, []); f.renderer.dispose();
  }
});

test('all gesture cancellation routes discard pending touch frames and cannot revive on a late scheduler callback', () => {
  const routes = [f => touch(f, 'pointercancel', 0), f => touch(f, 'lostpointercapture', 1), f => touch(f, 'pointerdown', 2, [140, 130]),
    f => f.renderer.resetView(), f => f.renderer.setModel(model()), f => f.renderer.setProjectionMode('orthographic'), f => f.renderer.setDragMode('pan'),
    f => f.renderer.setViewDirection('top'), f => f.renderer.focusAll(), f => f.renderer.focusObject(model().objects[0].instanceId),
    f => f.send('wheel', { deltaY: 10 }), f => f.documentEvents.get('scroll').callback({}), f => f.resize(),
    f => f.send('webglcontextlost'), f => f.renderer.dispose()];
  for (const cancel of routes) {
    const f = queuedFixture(); load(f); begin(f); touch(f, 'pointermove', 1, [230, 120]); const callbacks = [...f.retained.values()]; assert.equal(callbacks.length, 1);
    cancel(f); const after = f.renderer.snapshot(); assert.equal(f.pending.size, 0); assert.equal(f.cancelled.length, 1); assert.equal(f.captures.size, 0);
    for (const callback of callbacks) callback(); touch(f, 'pointermove', 0, [80, 80]); end(f); assert.deepEqual(f.renderer.snapshot(), after); assert.deepEqual(f.picks, []); f.renderer.dispose();
  }
});

test('stale pending dimensions lost GPU context and replaced frames fail before a scheduled camera commit', () => {
  for (const change of [f => f.options.bounds = { ...f.canvas.getBoundingClientRect(), left: 11 },
    f => f.canvas.width++, f => f.options.lost = true, f => f.renderer.render()]) {
    const f = queuedFixture(); load(f); begin(f); touch(f, 'pointermove', 1, [230, 120]); change(f);
    const before = f.renderer.snapshot(); f.flush(); end(f); assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.captures.size, 0); assert.deepEqual(f.picks, []); f.renderer.dispose();
  }
});

test('a late frame from an older pair cannot update a newer pair using the same contact identifiers', () => {
  const f = queuedFixture(); load(f); begin(f); touch(f, 'pointermove', 1, [230, 120]); const old = [...f.retained.values()][0]; touch(f, 'pointercancel', 0);
  begin(f); touch(f, 'pointermove', 1, [215, 114]); const before = f.renderer.snapshot(); old(); assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.pending.size, 1);
  f.flush(); assert.equal(f.renderer.snapshot().draws, before.draws + 1); end(f); f.renderer.dispose();
});

test('a queued pair validates only its complete positions and coalesces a temporary near-overlap within a frame', () => {
  const f = queuedFixture(); load(f); const start = [[110, 90], [190, 90]], final = [[188, 90], [268, 90]], anchor = planePoint(f, midpoint(start)); begin(f, start);
  touch(f, 'pointermove', 0, final[0]); touch(f, 'pointermove', 1, final[1]); const before = f.renderer.snapshot(); f.flush();
  assert.equal(f.renderer.snapshot().draws, before.draws + 1); assert.equal(distance(f.renderer.snapshot().camera), distance(before.camera)); near(project(f, anchor), midpoint(final), .0001); end(f); f.renderer.dispose();
});

test('queued camera failure and reentrant disposal never publish or retain a partial pair', () => {
  const f = queuedFixture(); load(f); begin(f); touch(f, 'pointermove', 1, [230, 120]); const before = f.renderer.snapshot(); f.gl.uniformMatrix4fv = () => { throw Error('queued GPU failure'); };
  assert.doesNotThrow(() => f.flush()); assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.views.at(-1), null); assert.equal(f.captures.size, 0); assert.equal(f.pending.size, 0); assert.deepEqual(f.errors, ['queued GPU failure']); f.renderer.dispose();
  const second = queuedFixture(); load(second); begin(second); touch(second, 'pointermove', 1, [230, 120]);
  second.options.onViewChange = receipt => { if (receipt) second.renderer.dispose(); };
  assert.doesNotThrow(() => second.flush()); assert.equal(second.renderer.snapshot().disposed, true); assert.equal(second.renderer.snapshot().camera, null); assert.equal(second.captures.size, 0); assert.equal(second.pending.size, 0);
});

test('single-finger and mouse navigation stay synchronous and never request a dual-touch frame', () => {
  const f = queuedFixture(); load(f); f.send('pointerdown'); const before = f.renderer.snapshot(); f.send('pointermove', { clientX: 180 }); assert.equal(f.renderer.snapshot().draws, before.draws + 1); f.send('pointerup');
  touch(f, 'pointerdown', 0); const next = f.renderer.snapshot(); touch(f, 'pointermove', 0, [145, 105]); assert.equal(f.renderer.snapshot().draws, next.draws + 1); touch(f, 'pointerup', 0);
  assert.equal(f.pending.size, 0); assert.equal(f.retained.size, 0); f.renderer.dispose();
});

test('scheduler exceptions and failed cancellation still cannot revive a queued pair', () => {
  const f = fixture({ scheduleTouch() { throw Error('scheduler unavailable'); } }); load(f); begin(f); const before = f.renderer.snapshot();
  assert.doesNotThrow(() => touch(f, 'pointermove', 1, [230, 120])); assert.deepEqual(f.renderer.snapshot(), before); assert.equal(f.captures.size, 0); end(f); f.renderer.dispose();
  let late; const other = fixture({ scheduleTouch(callback) { late = callback; return 1; }, cancelTouch() { throw Error('already fired'); } }); load(other); begin(other); touch(other, 'pointermove', 1, [230, 120]);
  assert.doesNotThrow(() => touch(other, 'pointercancel', 0)); const after = other.renderer.snapshot(); assert.doesNotThrow(() => late()); assert.deepEqual(other.renderer.snapshot(), after); assert.equal(other.captures.size, 0); other.renderer.dispose();
});
