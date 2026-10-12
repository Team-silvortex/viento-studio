import test from 'node:test';
import assert from 'node:assert/strict';
import { identity4, multiply4, lookAt4, perspective4, objectMatrix4, rotationXYZ4, orbitCamera, color3, normalize3 } from '../../web/modules/scene3d-math.js';
import { createScene3DRenderer } from '../../web/modules/scene3d-renderer.js';

const near = (a, b) => a.forEach((value, index) => assert.ok(Math.abs(value - b[index]) < 1e-9, `${index}: ${value} != ${b[index]}`));
const camera = { position: [4, 3, 6], target: [0, 0, 0], fovDegrees: 50, near: .1, far: 100 };
const model = () => ({ background: '#142538', camera: structuredClone(camera), light: { direction: [1, -2, -1], color: '#ffffff', energy: 1 },
  objects: [{ instanceId: '00000000-0000-4000-8000-000000000001', position: [1, 2, 3], rotationDegrees: [23, -41, 67], size: [2, 3, 4], color: '#85d7bb' }] });
function fixture(options = {}) {
  const calls = [], listeners = new Map(), captures = new Set(); let observed, disconnected = 0, lost = false, next = 0;
  const constants = ['COMPILE_STATUS', 'LINK_STATUS', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'ARRAY_BUFFER', 'STATIC_DRAW', 'FLOAT', 'DEPTH_TEST', 'LEQUAL', 'CULL_FACE', 'COLOR_BUFFER_BIT', 'DEPTH_BUFFER_BIT', 'TRIANGLES'];
  const gl = Object.fromEntries(constants.map((name, i) => [name, i + 1]));
  for (const name of ['createProgram', 'createShader', 'createBuffer', 'createVertexArray']) gl[name] = () => { const value = options.failAllocation === name ? null : { name, id: ++next }; calls.push([name, value]); return value; };
  for (const name of ['attachShader', 'shaderSource', 'compileShader', 'linkProgram', 'bindVertexArray', 'bindBuffer', 'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'viewport', 'enable', 'depthFunc', 'disable', 'clearColor', 'clear', 'useProgram', 'uniformMatrix4fv', 'uniform3fv', 'uniform1f', 'uniform1i', 'drawArrays', 'deleteBuffer', 'deleteVertexArray', 'deleteProgram', 'deleteShader']) gl[name] = (...args) => calls.push([name, ...args]);
  gl.getShaderParameter = () => options.compile !== false; gl.getShaderInfoLog = () => 'compile failed';
  gl.getProgramParameter = () => options.link !== false; gl.getProgramInfoLog = () => 'link failed';
  gl.getUniformLocation = (_, name) => name; gl.isContextLost = () => lost || options.contextLost === true;
  gl.getExtension = () => ({ loseContext() { lost = true; calls.push(['loseContext']); } });
  const canvas = { width: 0, height: 0, getContext: () => options.unsupported ? null : gl,
    getBoundingClientRect: () => options.bounds || { width: 300, height: 200 },
    addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    setPointerCapture(id) { captures.add(id); }, hasPointerCapture: id => captures.has(id),
    releasePointerCapture(id) { captures.delete(id); listeners.get('lostpointercapture')?.({ pointerId: id }); } };
  const render = () => createScene3DRenderer(canvas, { pixelRatio: () => options.dpr ?? 1, onError: options.onError, onPick: options.onPick,
    observe(callback) { observed = callback; return { observe() {}, disconnect() { disconnected++; } }; } });
  return { gl, canvas, calls, listeners, render, resize: () => observed(), disconnected: () => disconnected };
}

test('matrix composition keeps column-major identity and translated scaled box positions', () => {
  const object = { position: [7, -2, 4], size: [2, 3, 4], rotationDegrees: [0, 0, 0] }, matrix = objectMatrix4(object);
  near(multiply4(identity4(), matrix), matrix); near(multiply4(matrix, identity4()), matrix);
  near(matrix, [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 7, -2, 4, 1]);
});
test('mixed-axis Euler XYZ matches Godot Rx*(Ry*Rz) analytical columns', () => {
  const [x, y, z] = [23, -41, 67].map(n => n * Math.PI / 180), sx = Math.sin(x), sy = Math.sin(y), sz = Math.sin(z), cx = Math.cos(x), cy = Math.cos(y), cz = Math.cos(z);
  near(rotationXYZ4([23, -41, 67]), [cy * cz, cz * sx * sy + cx * sz, -cx * cz * sy + sx * sz, 0,
    -cy * sz, cx * cz - sx * sy * sz, cz * sx + cx * sy * sz, 0, sy, -cy * sx, cx * cy, 0, 0, 0, 0, 1]);
});
test('lookAt puts the camera at origin and its target along negative Z', () => {
  const matrix = lookAt4([0, 0, 5], [0, 0, 0]); near(matrix, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -5, 1]);
});
test('perspective uses WebGL clipping and source near/far values', () => {
  const matrix = perspective4(90, 2, 1, 101); assert.ok(Math.abs(matrix[0] - .5) < 1e-9); assert.equal(matrix[11], -1);
  const depth = z => (matrix[10] * z + matrix[14]) / -z; assert.ok(Math.abs(depth(-1) + 1) < 1e-9); assert.ok(Math.abs(depth(-101) - 1) < 1e-9);
});
test('orbit is detached, preserves target and clamps polar and distance singularities', () => {
  const original = structuredClone(camera), next = orbitCamera(camera, 1, 1000, 0);
  assert.deepEqual(camera, original); assert.notEqual(next.target, camera.target); assert.ok(Math.hypot(...next.position.map((n, i) => n - next.target[i])) >= .009999);
  assert.ok(next.position.every(Number.isFinite)); assert.ok(Math.hypot(next.position[0], next.position[2]) > 0);
});
test('hex conversion preserves authored case and color channels', () => { near(color3('#aB00FF'), [171 / 255, 0, 1]); });
test('subnormal accepted directional light normalizes to a finite unit vector', () => {
  const light = normalize3([5e-324, 0, 5e-324]); near(light, [Math.SQRT1_2, 0, Math.SQRT1_2]); assert.ok(Math.abs(Math.hypot(...light) - 1) < 1e-12);
  const f = fixture(), renderer = f.render(), scene = model(); scene.light.direction = [5e-324, 0, 5e-324]; renderer.setModel(scene);
  near(f.calls.find(call => call[0] === 'uniform3fv' && call[1] === 'lightDirection')[2], light); renderer.dispose();
});
test('unsupported WebGL2 returns no renderer and does not allocate fake geometry', () => { const f = fixture({ unsupported: true }); assert.equal(f.render(), null); assert.deepEqual(f.calls, []); });
test('actual renderer draws each box with source matrices, light and camera uniforms', () => {
  const f = fixture(), renderer = f.render(), scene = model(); assert.equal(renderer.setModel(scene), true);
  assert.equal(f.calls.filter(call => call[0] === 'drawArrays').length, 1); assert.equal(f.calls.find(call => call[0] === 'drawArrays')[3], 36);
  assert.equal(f.calls.find(call => call[0] === 'bufferData')[2].length, 216); assert.equal(renderer.snapshot().objectCount, 1); assert.deepEqual(scene, model()); renderer.dispose();
});
test('drawing buffer bounds DPR and dimension allocations on initial render and resize', () => {
  const options = { dpr: 9, bounds: { width: 5000, height: 3000 } }, f = fixture(options), renderer = f.render(); renderer.setModel(model()); assert.equal(f.canvas.width, 2048); assert.equal(f.canvas.height, 1229);
  options.bounds = { width: 100, height: 50 }; f.resize(); assert.equal(f.canvas.width, 200); assert.equal(f.canvas.height, 100); renderer.dispose();
});
test('pointer orbit and wheel zoom never mutate the supplied model; view reset restores source camera', () => {
  const f = fixture(), renderer = f.render(), scene = model(), original = structuredClone(scene); renderer.setModel(scene);
  f.listeners.get('pointerdown')({ button: 0, pointerId: 4, clientX: 10, clientY: 10 }); f.listeners.get('pointermove')({ pointerId: 4, clientX: 60, clientY: 30 });
  assert.notDeepEqual(renderer.snapshot().camera.position, camera.position); f.listeners.get('pointerup')({ pointerId: 4 });
  let prevented = false; f.listeners.get('wheel')({ deltaY: 50, preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  assert.deepEqual(scene, original); renderer.resetView(); assert.deepEqual(renderer.snapshot().camera, camera); renderer.dispose();
});
test('unrelated pointer and right click cannot change the view', () => {
  const f = fixture(), renderer = f.render(); renderer.setModel(model()); const old = renderer.snapshot();
  f.listeners.get('pointerdown')({ button: 1, pointerId: 1, clientX: 0, clientY: 0 }); f.listeners.get('pointermove')({ pointerId: 2, clientX: 30, clientY: 40 }); assert.deepEqual(renderer.snapshot(), old); renderer.dispose();
});
test('dispose releases every shader/program/VAO/buffer, observer and interaction listener exactly once', () => {
  const f = fixture(), renderer = f.render(); renderer.setModel(model()); renderer.dispose(); renderer.dispose();
  for (const [name, count] of [['deleteShader', 2], ['deleteProgram', 1], ['deleteBuffer', 1], ['deleteVertexArray', 1], ['loseContext', 1]]) assert.equal(f.calls.filter(call => call[0] === name).length, count);
  assert.equal(f.listeners.size, 0); assert.equal(f.disconnected(), 1); assert.equal(renderer.render(), false); assert.equal(renderer.setModel(model()), false); assert.equal(renderer.resetView(), false);
});
test('shader compile failure still releases the partially allocated program and shader', () => {
  const f = fixture({ compile: false }); assert.throws(f.render, /compile failed/); assert.equal(f.calls.filter(call => call[0] === 'deleteProgram').length, 1); assert.equal(f.calls.filter(call => call[0] === 'deleteShader').length, 1);
});
test('link failure releases both shaders without leaving geometry or listeners', () => {
  const f = fixture({ link: false }); assert.throws(f.render, /link failed/); assert.equal(f.calls.filter(call => call[0] === 'deleteShader').length, 2); assert.equal(f.listeners.size, 0);
});
test('buffer allocation failure releases the VAO and all compilation resources', () => {
  const f = fixture({ failAllocation: 'createBuffer' }); assert.throws(f.render, /geometry allocation/); assert.equal(f.calls.filter(call => call[0] === 'deleteVertexArray').length, 1); assert.equal(f.calls.filter(call => call[0] === 'deleteShader').length, 2);
});
test('unexpected context loss is reported and stops further draw calls', () => {
  const errors = [], f = fixture({ onError: error => errors.push(error.message) }), renderer = f.render(); renderer.setModel(model()); let prevented = false;
  f.listeners.get('webglcontextlost')({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); assert.deepEqual(errors, ['WebGL2 context lost.']); renderer.dispose();
});

// Test the matrices actually uploaded to the GPU, including float32 rounding,
// against all eight unit-cube corners. This does not use frameCamera's sphere.
function gpuCornersFit(f) {
  const matrix = name => f.calls.findLast(call => call[0] === 'uniformMatrix4fv' && call[1] === name)[3];
  const transform = (m, v) => Array.from({ length: 4 }, (_, row) => {
    let total = Math.fround(0);
    for (let col = 0; col < 4; col++) total = Math.fround(total + Math.fround(m[col * 4 + row] * v[col]));
    return total;
  });
  const box = matrix('model'), view = matrix('viewProjection');
  for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
    const clip = transform(view, transform(box, [x, y, z, 1]));
    assert.ok(clip.every(Number.isFinite) && clip[3] > 0, `invalid clip ${clip}`);
    const ndc = clip.slice(0, 3).map(n => n / clip[3]);
    assert.ok(Math.abs(ndc[0]) <= .835 && Math.abs(ndc[1]) <= .835, `screen clipping ${ndc}`);
    assert.ok(ndc[2] > -1 && ndc[2] < 1, `depth clipping ${ndc}`);
  }
}
const direction = view => normalize3(view.position.map((n, i) => n - view.target[i]));

test('focusObject fits actual GPU corners using rotated box current heading and actual canvas aspect without author edits', () => {
  const options = { bounds: { width: 73, height: 400 }, dpr: 2 }, f = fixture(options), renderer = f.render(), scene = model();
  scene.camera.near = 10; scene.camera.far = 11;
  const original = structuredClone(scene); renderer.setModel(scene);
  const before = renderer.snapshot(), heading = direction(before.camera);
  assert.equal(renderer.focusObject(scene.objects[0].instanceId), true);
  const focused = renderer.snapshot(); assert.deepEqual(focused.camera.target, scene.objects[0].position);
  near(direction(focused.camera), heading); assert.equal(focused.camera.fovDegrees, before.camera.fovDegrees);
  assert.notEqual(focused.camera.near, before.camera.near); assert.notEqual(focused.camera.far, before.camera.far);
  assert.equal(focused.width / focused.height, 146 / 800); gpuCornersFit(f); assert.deepEqual(scene, original);
  focused.camera.position[0] = 123456; assert.notEqual(renderer.snapshot().camera.position[0], 123456);
  renderer.dispose();
});
test('focus handles minimum and maximum object extents at distant coordinates and extreme viewport FOV through actual float32 matrices', () => {
  for (const size of [[.001, .001, .001], [1000, 1000, 1000], [.001, 1000, .001]])
    for (const fovDegrees of [1, 179]) for (const bounds of [{ width: 1, height: 8192 }, { width: 8192, height: 1 }, { width: 900, height: 400 }]) {
      const f = fixture({ bounds }), renderer = f.render(), scene = model();
      scene.objects[0] = { ...scene.objects[0], position: [-100000, 100000, -100000], rotationDegrees: [173, -35999, 67], size };
      scene.camera = { ...scene.camera, fovDegrees, near: 10000, far: 100000 };
      renderer.setModel(scene); assert.equal(renderer.focusObject(scene.objects[0].instanceId), true);
      assert.equal(renderer.snapshot().width <= 2048 && renderer.snapshot().height <= 2048, true); gpuCornersFit(f); renderer.dispose();
    }
});
test('view-local floating origin makes translated large-coordinate scenes upload identical geometry light and view matrices', () => {
  const scene = model(), shifted = structuredClone(scene), offset = [100000, -100000, 100000];
  for (const key of ['position', 'target']) shifted.camera[key] = shifted.camera[key].map((n, i) => n + offset[i]);
  for (const object of shifted.objects) object.position = object.position.map((n, i) => n + offset[i]);
  const a = fixture(), b = fixture(), first = a.render(), second = b.render(); first.setModel(scene); second.setModel(shifted);
  const uniforms = f => f.calls.filter(call => call[0].startsWith('uniform')).map(call => call.map(item => item instanceof Float32Array ? [...item] : item));
  assert.deepEqual(uniforms(a), uniforms(b)); assert.deepEqual(second.snapshot().camera, shifted.camera);
  first.focusObject(scene.objects[0].instanceId); second.focusObject(shifted.objects[0].instanceId); gpuCornersFit(a); gpuCornersFit(b);
  first.dispose(); second.dispose();
});
test('focused very long or very short views retain smooth first wheel distance and safe clipping rather than author orbit limits', () => {
  for (const small of [false, true]) {
    const f = fixture({ bounds: small ? { width: 100, height: 100 } : { width: 1, height: 2048 } }), renderer = f.render(), scene = model();
    scene.camera.fovDegrees = small ? 179 : 1; scene.objects[0].size = small ? [.001, .001, .001] : [1000, 1000, 1000];
    renderer.setModel(scene); renderer.focusObject(scene.objects[0].instanceId);
    const distance = cam => Math.hypot(...cam.position.map((n, i) => n - cam.target[i]));
    const before = distance(renderer.snapshot().camera); assert.ok(small ? before < .01 : before > 200000);
    let prevented = false; f.listeners.get('wheel')({ deltaY: 1, preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.ok(Math.abs(distance(renderer.snapshot().camera) / before - Math.exp(.001)) < 1e-6);
    gpuCornersFit(f); renderer.dispose();
  }
});
test('focus after resize uses current drawing dimensions including DPR limit and not author viewport', () => {
  const options = { bounds: { width: 700, height: 200 }, dpr: 2 }, f = fixture(options), renderer = f.render(), scene = model();
  scene.viewport = [8192, 1]; renderer.setModel(scene); renderer.focusObject(scene.objects[0].instanceId); gpuCornersFit(f);
  options.bounds = { width: 2, height: 12000 }; f.resize(); assert.equal(renderer.focusObject(scene.objects[0].instanceId), true);
  assert.equal(renderer.snapshot().width, 1); assert.equal(renderer.snapshot().height, 2048); gpuCornersFit(f); renderer.dispose();
});
test('invalid missing and disposed focus requests are false no-ops and never allocate or draw', () => {
  const f = fixture(), renderer = f.render(); const empty = renderer.snapshot(); assert.equal(renderer.focusObject('missing'), false); assert.deepEqual(renderer.snapshot(), empty);
  renderer.setModel(model()); const before = renderer.snapshot(), calls = f.calls.length;
  for (const id of ['missing', '', null, undefined, 1, {}]) assert.equal(renderer.focusObject(id), false);
  assert.deepEqual(renderer.snapshot(), before); assert.equal(f.calls.length, calls);
  renderer.dispose(); const disposed = renderer.snapshot(); assert.equal(renderer.focusObject(model().objects[0].instanceId), false); assert.deepEqual(renderer.snapshot(), disposed);
});
test('lost context cannot change focus target heading clipping or draw count', () => {
  const options = {}, f = fixture(options), renderer = f.render(), scene = model(); renderer.setModel(scene);
  const before = renderer.snapshot(); options.contextLost = true;
  assert.equal(renderer.focusObject(scene.objects[0].instanceId), false); assert.deepEqual(renderer.snapshot(), before); renderer.dispose();
});
test('focus reset and model refresh stop the old pointer drag and return author camera without retaining focused range', () => {
  const f = fixture(), renderer = f.render(), scene = model(), original = structuredClone(scene); renderer.setModel(scene);
  const down = () => f.listeners.get('pointerdown')({ button: 0, pointerId: 7, clientX: 1, clientY: 1 });
  const move = () => f.listeners.get('pointermove')({ pointerId: 7, clientX: 50, clientY: 50 });
  down(); renderer.focusObject(scene.objects[0].instanceId); const focused = renderer.snapshot(); move(); assert.deepEqual(renderer.snapshot(), focused);
  down(); renderer.resetView(); const reset = renderer.snapshot(); move(); assert.deepEqual(renderer.snapshot(), reset); assert.deepEqual(reset.camera, scene.camera);
  renderer.focusObject(scene.objects[0].instanceId); down(); const next = model(); next.camera.position = [19, 11, 17]; next.objects[0].position = [88, 2, -5];
  renderer.setModel(next); const refreshed = renderer.snapshot(); move(); assert.deepEqual(renderer.snapshot(), refreshed); assert.deepEqual(refreshed.camera, next.camera);
  assert.deepEqual(scene, original); renderer.dispose();
});

const pickModel = () => {
  const scene = model(); scene.camera = { position: [0, 0, 8], target: [0, 0, 0], fovDegrees: 60, near: .1, far: 100 };
  scene.objects[0] = { ...scene.objects[0], position: [0, 0, 0], size: [2, 2, 2], rotationDegrees: [0, 0, 0] }; return scene;
};
const pointer = (extra = {}) => ({ button: 0, isPrimary: true, pointerId: 1, clientX: 150, clientY: 100, timeStamp: 100, ...extra });
const send = (f, name, extra = {}) => f.listeners.get(name)?.(pointer(extra));
function pickFixture(options = {}) {
  const picked = []; options.onPick ||= ((id, hint) => picked.push([id, hint]));
  const f = fixture(options), renderer = f.render(); renderer.setModel(pickModel());
  const click = (extra = {}) => { send(f, 'pointerdown', extra); send(f, 'pointerup', extra); };
  return { f, renderer, picked, click };
}

test('hitTest uses last actual viewport uniforms without rendering changing view or mutating the scene', () => {
  const { f, renderer } = pickFixture(), scene = pickModel(); renderer.setModel(scene); const before = renderer.snapshot(), raw = JSON.stringify(scene), calls = f.calls.length;
  assert.equal(renderer.hitTest(150, 100), scene.objects[0].instanceId); assert.equal(renderer.hitTest(0, 0), null);
  assert.deepEqual(renderer.snapshot(), before); assert.equal(f.calls.length, calls); assert.equal(JSON.stringify(scene), raw);
  renderer.focusObject(scene.objects[0].instanceId); gpuCornersFit(f); assert.equal(renderer.hitTest(150, 100), scene.objects[0].instanceId); renderer.dispose();
});
test('sub-threshold jitter is one primary tap and never rotates the camera before selection', () => {
  const { f, renderer, picked } = pickFixture(); const before = renderer.snapshot(); send(f, 'pointerdown'); send(f, 'pointermove', { clientX: 153 });
  assert.deepEqual(renderer.snapshot(), before); send(f, 'pointerup', { clientX: 153 });
  assert.deepEqual(picked, [[pickModel().objects[0].instanceId, { focus: false }]]); assert.ok(Object.isFrozen(picked[0][1]));
  assert.deepEqual(Object.keys(picked[0][1]), ['focus']); assert.deepEqual(renderer.snapshot(), before); renderer.dispose();
});
test('drag exceeding four CSS pixels and returning to start never becomes tap or double click', () => {
  const { f, renderer, picked, click } = pickFixture(); click(); picked.length = 0;
  send(f, 'pointerdown'); send(f, 'pointermove', { clientX: 159 }); send(f, 'pointermove'); send(f, 'pointerup'); send(f, 'dblclick');
  assert.deepEqual(picked, []); assert.ok(renderer.snapshot().draws >= 3); renderer.dispose();
});
test('blank clicks wrong buttons and nonprimary starts cannot select or qualify focus', () => {
  const { f, renderer, picked, click } = pickFixture();
  click({ clientX: 0, clientY: 0 }); send(f, 'dblclick', { clientX: 0, clientY: 0 }); click({ button: 1 }); click({ isPrimary: false });
  assert.deepEqual(picked, []); renderer.dispose();
});
test('a second pointer revokes both active primary tap and previously approved double click eligibility', () => {
  const { f, renderer, picked, click } = pickFixture(); send(f, 'pointerdown'); send(f, 'pointerdown', { pointerId: 2, isPrimary: false }); send(f, 'pointerup');
  assert.deepEqual(picked, []);
  click(); assert.equal(picked.length, 1); send(f, 'pointerdown', { pointerId: 2, isPrimary: false }); send(f, 'dblclick'); assert.equal(picked.length, 1);
  renderer.dispose();
});
test('normal pointerup capture release preserves genuine double click eligibility while renderer never focuses itself', () => {
  const { f, renderer, picked, click } = pickFixture(), before = renderer.snapshot();
  // The fixture dispatches lostpointercapture synchronously from release, as
  // the browser can do before its dblclick dispatch; it is an expected loss.
  click({ timeStamp: 100 }); click({ timeStamp: 200 }); send(f, 'dblclick', { timeStamp: 201 });
  assert.deepEqual(picked.map(item => item[1].focus), [false, false, true]); assert.deepEqual(renderer.snapshot(), before);
  assert.deepEqual(picked.map(item => item[0]), Array(3).fill(pickModel().objects[0].instanceId)); renderer.dispose();
});
test('synthetic standalone mismatched expired repeated or nonleft double clicks never forge focus', () => {
  const { f, renderer, picked, click } = pickFixture(); send(f, 'dblclick'); assert.deepEqual(picked, []);
  for (const extra of [{ clientX: 170 }, { timeStamp: 1200 }, { timeStamp: 50 }, { button: 1 }, { clientX: NaN }]) {
    click(); const count = picked.length; send(f, 'dblclick', extra); assert.equal(picked.length, count);
  }
  click(); send(f, 'dblclick'); const count = picked.length; send(f, 'dblclick'); assert.equal(picked.length, count); renderer.dispose();
});
test('unexpected capture loss and pointercancel clear active gestures and recent tap eligibility', () => {
  const { f, renderer, picked, click } = pickFixture(); send(f, 'pointerdown'); send(f, 'lostpointercapture'); send(f, 'pointerup'); send(f, 'dblclick'); assert.deepEqual(picked, []);
  send(f, 'pointerdown'); send(f, 'pointercancel'); send(f, 'pointerup'); assert.deepEqual(picked, []);
  click(); const count = picked.length; send(f, 'pointercancel'); send(f, 'dblclick'); assert.equal(picked.length, count); renderer.dispose();
});
test('wheel resize refresh reset focus and replacement render invalidate the old double click frame', () => {
  for (const cancel of [
    ({ f }) => send(f, 'wheel', { deltaY: 1, preventDefault() {} }), ({ f }) => f.resize(),
    ({ renderer }) => renderer.setModel(pickModel()), ({ renderer }) => renderer.resetView(),
    ({ renderer }) => renderer.focusObject(pickModel().objects[0].instanceId), ({ renderer }) => renderer.render(),
  ]) {
    const state = pickFixture(); state.click(); const count = state.picked.length; cancel(state); send(state.f, 'dblclick');
    assert.equal(state.picked.length, count); state.renderer.dispose();
  }
});
test('stale CSS size DPR or backing allocation refuses hitTest until a matching new draw', () => {
  const options = { bounds: { left: 0, top: 0, width: 300, height: 200 }, dpr: 1 }, { f, renderer, picked } = pickFixture(options);
  assert.equal(renderer.hitTest(150, 100), pickModel().objects[0].instanceId); options.bounds.width = 310; assert.equal(renderer.hitTest(155, 100), null);
  renderer.render(); assert.equal(renderer.hitTest(155, 100), pickModel().objects[0].instanceId);
  options.dpr = 2; assert.equal(renderer.hitTest(155, 100), null); renderer.render(); assert.equal(renderer.hitTest(155, 100), pickModel().objects[0].instanceId);
  f.canvas.width++; assert.equal(renderer.hitTest(155, 100), null); renderer.render();
  send(f, 'pointerdown', { clientX: 155 }); options.bounds.width = 320; send(f, 'pointerup', { clientX: 155 }); assert.deepEqual(picked, []); renderer.dispose();
});
test('position-only scrolling picks through the same drawn float32 matrices without a redraw', () => {
  const options = { bounds: { left: 0, top: 0, width: 300, height: 200 } }, { f, renderer, picked, click } = pickFixture(options);
  const before = renderer.snapshot(), calls = f.calls.length, id = pickModel().objects[0].instanceId;
  options.bounds.left = 43; options.bounds.top = -80;
  assert.equal(renderer.hitTest(193, 20), id); assert.equal(renderer.hitTest(150, 100), null);
  click({ clientX: 193, clientY: 20 }); send(f, 'dblclick', { clientX: 193, clientY: 20 });
  assert.deepEqual(picked, [[id, { focus: false }], [id, { focus: true }]]);
  assert.deepEqual(renderer.snapshot(), before); assert.equal(f.calls.length, calls); renderer.dispose();
});
test('canvas position changes during a gesture or after a tap cancel selection and double click eligibility', () => {
  const options = { bounds: { left: 0, top: 0, width: 300, height: 200 } }, { f, renderer, picked, click } = pickFixture(options);
  const before = renderer.snapshot(); send(f, 'pointerdown'); options.bounds.left = 2; send(f, 'pointerup'); send(f, 'dblclick'); assert.deepEqual(picked, []);
  options.bounds.left = 0; send(f, 'pointerdown'); options.bounds.top = 2; send(f, 'pointermove', { clientX: 159 }); send(f, 'pointerup'); assert.deepEqual(picked, []);
  options.bounds.top = 0; click(); assert.equal(picked.length, 1); options.bounds.top = 2; send(f, 'dblclick'); assert.equal(picked.length, 1);
  assert.deepEqual(renderer.snapshot(), before); renderer.dispose();
});
test('late disposed or contextlost hit requests and gestures do not callback or change camera', () => {
  const options = {}, { f, renderer, picked, click } = pickFixture(options); click(); const count = picked.length, before = renderer.snapshot();
  options.contextLost = true; assert.equal(renderer.hitTest(150, 100), null); send(f, 'dblclick'); send(f, 'pointerdown'); send(f, 'pointerup'); assert.equal(picked.length, count); assert.deepEqual(renderer.snapshot(), before);
  send(f, 'webglcontextlost', { preventDefault() {} }); renderer.dispose(); assert.equal(renderer.hitTest(150, 100), null); assert.equal(f.listeners.size, 0);
});
test('callback reentrancy cannot keep stale double click eligibility across model refresh or disposal', () => {
  for (const dispose of [false, true]) {
    let renderer, calls = 0; const f = fixture({ onPick() { calls++; if (dispose) renderer.dispose(); else renderer.setModel(pickModel()); } });
    renderer = f.render(); renderer.setModel(pickModel()); send(f, 'pointerdown'); send(f, 'pointerup'); send(f, 'dblclick'); assert.equal(calls, 1);
    if (dispose) assert.equal(f.listeners.size, 0); renderer.dispose();
  }
});
test('without a consumer or when a view callback throws the adapter keeps rendering and releasing normally', () => {
  for (const onPick of [undefined, () => { throw Error('view consumer'); }]) {
    const f = fixture({ onPick }), renderer = f.render(); renderer.setModel(pickModel()); send(f, 'pointerdown'); send(f, 'pointerup'); send(f, 'dblclick');
    assert.equal(renderer.render(), true); renderer.dispose(); assert.equal(f.listeners.size, 0); assert.equal(f.disconnected(), 1);
  }
});

test('selection setter is a view-only stable identity update and same selection is a no-draw success', () => {
  const f = fixture(), renderer = f.render(); assert.equal(renderer.setSelectedObject(null), false);
  const scene = pickModel(), original = structuredClone(scene); renderer.setModel(scene); const initial = renderer.snapshot(), hit = renderer.hitTest(150, 100);
  assert.equal(initial.selectedInstanceId, null); assert.equal(renderer.setSelectedObject(scene.objects[0].instanceId), true);
  const selected = renderer.snapshot(); assert.equal(selected.selectedInstanceId, scene.objects[0].instanceId); assert.equal(selected.draws, initial.draws + 1);
  assert.deepEqual(selected.camera, initial.camera); assert.equal(renderer.hitTest(150, 100), hit); assert.deepEqual(scene, original);
  const calls = f.calls.length; assert.equal(renderer.setSelectedObject(scene.objects[0].instanceId), true); assert.deepEqual(renderer.snapshot(), selected); assert.equal(f.calls.length, calls);
  assert.equal(renderer.setSelectedObject(null), true); assert.equal(renderer.snapshot().selectedInstanceId, null); assert.equal(renderer.snapshot().draws, selected.draws + 1);
  const cleared = renderer.snapshot(); assert.equal(renderer.setSelectedObject(null), true); assert.deepEqual(renderer.snapshot(), cleared); renderer.dispose();
});
test('selection repaint preserves the actual Float32 models and camera with a single original depth pass in source order', () => {
  const scene = pickModel(); scene.objects.push({ ...structuredClone(scene.objects[0]), instanceId: '00000000-0000-4000-8000-000000000002', color: '#ffffff' });
  const f = fixture(), renderer = f.render(); renderer.setModel(scene); const before = renderer.snapshot(), baseline = f.calls.filter(call => call[0] === 'uniformMatrix4fv').map(call => [call[1], [...call[3]]]);
  const resources = f.calls.filter(call => /^(create|bufferData)/.test(call[0])).length, start = f.calls.length;
  renderer.setSelectedObject(scene.objects[1].instanceId); const calls = f.calls.slice(start);
  assert.deepEqual(calls.filter(call => call[0] === 'uniformMatrix4fv').map(call => [call[1], [...call[3]]]), baseline);
  assert.deepEqual(calls.filter(call => call[0] === 'uniform1i').map(call => call.slice(1)), [['selected', 0], ['selected', 1]]);
  assert.deepEqual(calls.filter(call => call[0] === 'drawArrays').map(call => call.slice(1)), Array(2).fill([f.gl.TRIANGLES, 0, 36]));
  assert.deepEqual(calls.filter(call => call[0] === 'depthFunc').map(call => call[1]), [f.gl.LEQUAL]); assert.equal(calls.filter(call => call[0] === 'clear').length, 1);
  assert.equal(f.calls.filter(call => /^(create|bufferData)/.test(call[0])).length, resources); assert.deepEqual(renderer.snapshot().camera, before.camera);
  assert.equal(renderer.hitTest(150, 100), scene.objects[1].instanceId); renderer.dispose();
});
test('selection shader identifies the six flat face axes and physical box edges without triangle or outline geometry', () => {
  const f = fixture(), renderer = f.render(); renderer.setModel(model());
  const sources = f.calls.filter(call => call[0] === 'shaderSource').map(call => call[2]), vertex = sources.find(source => source.includes('gl_Position')), fragment = sources.find(source => source.includes('out vec4 pixel'));
  assert.match(vertex, /flat out vec3 localNormal/); assert.match(vertex, /localPosition=position/); assert.match(fragment, /flat in vec3 localNormal/);
  assert.match(fragment, /localPosition\.yz/); assert.match(fragment, /localPosition\.xz/); assert.match(fragment, /localPosition\.xy/);
  assert.match(fragment, /fwidth\(facePosition\)/); assert.match(fragment, /vec2\(0\.5\)-abs\(facePosition\)/);
  assert.match(fragment, /mix\(shaded,vec3\(0\.07,0\.09,0\.13\),innerEdge\)/); assert.match(fragment, /mix\(shaded,vec3\(1\.0,0\.96,0\.75\),edge\)/);
  assert.doesNotMatch(vertex + fragment, /barycentric|gl_FragDepth|discard|gl_VertexID/);
  const data = f.calls.find(call => call[0] === 'bufferData')[2], edges = new Set(), faces = new Set();
  for (let index = 0; index < data.length; index += 6) {
    const position = [...data.slice(index, index + 3)], normal = [...data.slice(index + 3, index + 6)], fixed = normal.findIndex(n => n !== 0);
    assert.equal(position[fixed], normal[fixed] / 2); faces.add(normal.join(','));
    for (let axis = 0; axis < 3; axis++) if (axis !== fixed) {
      const endpoints = [-.5, .5].map(value => position.map((n, i) => i === axis ? value : n).join(',')); edges.add(endpoints.sort().join('|'));
    }
  }
  assert.equal(faces.size, 6); assert.equal(edges.size, 12); assert.equal(data.length, 216); renderer.dispose();
});
test('reset preserves selected identity and replacement model explicitly clears feedback before UI resynchronizes', () => {
  const { renderer } = pickFixture(), scene = pickModel(); renderer.setSelectedObject(scene.objects[0].instanceId); renderer.focusObject(scene.objects[0].instanceId);
  assert.equal(renderer.snapshot().selectedInstanceId, scene.objects[0].instanceId); renderer.resetView(); assert.equal(renderer.snapshot().selectedInstanceId, scene.objects[0].instanceId);
  assert.deepEqual(renderer.snapshot().camera, scene.camera); renderer.setModel(scene); assert.equal(renderer.snapshot().selectedInstanceId, null);
  assert.equal(renderer.setSelectedObject(scene.objects[0].instanceId), true); assert.equal(renderer.snapshot().selectedInstanceId, scene.objects[0].instanceId); renderer.dispose();
});
test('unknown invalid lost-context and disposed selection setters return false without changing feedback camera or draws', () => {
  const options = {}, { f, renderer } = pickFixture(options); renderer.setSelectedObject(pickModel().objects[0].instanceId); const selected = renderer.snapshot(), calls = f.calls.length;
  for (const value of [undefined, '', false, 0, {}, [], '00000000-0000-4000-8000-000000000099']) assert.equal(renderer.setSelectedObject(value), false);
  assert.deepEqual(renderer.snapshot(), selected); assert.equal(f.calls.length, calls);
  options.contextLost = true; assert.equal(renderer.setSelectedObject(null), false); assert.equal(renderer.setSelectedObject(selected.selectedInstanceId), false); assert.deepEqual(renderer.snapshot(), selected);
  renderer.dispose(); const disposed = renderer.snapshot(); assert.equal(disposed.selectedInstanceId, null); assert.equal(renderer.setSelectedObject(null), false); assert.deepEqual(renderer.snapshot(), disposed);
});
test('selection feedback from pointerup preserves native capture-release and double-click eligibility on unchanged geometry', () => {
  let renderer; const hints = [], f = fixture({ onPick(id, hint) { hints.push([id, hint.focus]); assert.equal(renderer.setSelectedObject(id), true); } });
  renderer = f.render(); renderer.setModel(pickModel()); const camera = renderer.snapshot().camera, draws = renderer.snapshot().draws;
  const click = timeStamp => { send(f, 'pointerdown', { timeStamp }); send(f, 'pointerup', { timeStamp }); };
  click(100); assert.equal(renderer.snapshot().draws, draws + 1); click(200); send(f, 'dblclick', { timeStamp: 201 });
  assert.deepEqual(hints, Array(3).fill(null).map((_, index) => [pickModel().objects[0].instanceId, index === 2]));
  assert.deepEqual(renderer.snapshot().camera, camera); assert.equal(renderer.snapshot().draws, draws + 1); renderer.dispose();
});
test('selection feedback does not broaden public redraw or stale geometry and size approval', () => {
  for (const change of ['public', 'model', 'size', 'order', 'backing']) {
    const options = { bounds: { width: 300, height: 200 } }, { f, renderer, picked, click } = pickFixture(options), scene = pickModel();
    scene.objects.push({ ...structuredClone(scene.objects[0]), instanceId: '00000000-0000-4000-8000-000000000002' }); renderer.setModel(scene); click(); const count = picked.length;
    if (change === 'public') renderer.render();
    else { if (change === 'model') scene.objects[0].position[0] += .01;
      if (change === 'size') options.bounds.width = 300.01;
      if (change === 'order') scene.objects.reverse();
      if (change === 'backing') f.canvas.width++;
      renderer.setSelectedObject(scene.objects[0].instanceId);
    }
    send(f, 'dblclick'); assert.equal(picked.length, count, change); renderer.dispose();
  }
});
test('selection-only redraw keeps scroll mapping but cannot approve a moved pointer gesture', () => {
  const options = { bounds: { left: 0, top: 0, width: 300, height: 200 } }, { f, renderer, picked, click } = pickFixture(options);
  click(); const count = picked.length; options.bounds.left = 2; renderer.setSelectedObject(pickModel().objects[0].instanceId); send(f, 'dblclick'); assert.equal(picked.length, count);
  assert.equal(renderer.hitTest(152, 100), pickModel().objects[0].instanceId);
  send(f, 'pointerdown', { clientX: 152 }); options.bounds.top = 2; renderer.setSelectedObject(null); send(f, 'pointerup', { clientX: 152, clientY: 102 }); assert.equal(picked.length, count); renderer.dispose();
});
test('selection setter never emits picks and supports the adapter without a view callback', () => {
  const { renderer, picked } = pickFixture(); renderer.setSelectedObject(pickModel().objects[0].instanceId); renderer.setSelectedObject(null); assert.deepEqual(picked, []); renderer.dispose();
  const f = fixture(), bare = f.render(); bare.setModel(pickModel()); assert.equal(bare.setSelectedObject(pickModel().objects[0].instanceId), true); assert.equal(bare.setSelectedObject(null), true); bare.dispose(); assert.equal(f.listeners.size, 0);
});
