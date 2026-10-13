import test from 'node:test';
import assert from 'node:assert/strict';
import { createScene3DRenderer } from '../../web/modules/scene3d-renderer.js';

const axes = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0] };
const upFor = direction => direction === 'top' ? [0, 0, -1] : direction === 'bottom' ? [0, 0, 1] : [0, 1, 0];
const near = (actual, expected, epsilon = 1e-10) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= epsilon, `${actual} != ${expected}`));
const distance = camera => Math.hypot(...camera.position.map((value, index) => value - camera.target[index]));
const heading = camera => camera.position.map((value, index) => (value - camera.target[index]) / distance(camera));
function scene(count = 5) {
  return { background: '#142538', camera: { position: [4, 3, 6], target: [0, 0, 0], fovDegrees: 50, near: .1, far: 100 },
    light: { direction: [1, -2, -1], color: '#ffffff', energy: 1 },
    objects: Array.from({ length: count }, (_, index) => ({ instanceId: index.toString().padStart(8, '0') + '-1111-4111-8111-111111111111',
      position: [index * 17 - 43, index % 3 * 23 - 19, index % 2 * 39 - 18], rotationDegrees: [index * 31 + 23, -index * 79 - 41, index * 71 + 67],
      size: [index % 9 + 1, .001 + index % 13 * 3, 17 - index % 4], color: '#85d7bb' })) };
}
function centeredScene() {
  const value = scene(1); value.objects[0] = { ...value.objects[0], position: [0, 0, 0], size: [2, 2, 2], rotationDegrees: [0, 0, 0] }; return value;
}
const pointer = extra => ({ button: 0, isPrimary: true, pointerId: 7, clientX: 150, clientY: 100, timeStamp: 100, ...extra });
const send = (f, event, extra) => f.listeners.get(event)?.(pointer(extra));
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

// Witness every actual uploaded Float32 model matrix after the last VP upload.
// Multiplication rounds each product/sum independently like the GPU shader.
function gpuSceneFits(f,count){const start=f.calls.findLastIndex(c=>c[0]==='uniformMatrix4fv'&&c[1]==='viewProjection'),view=f.calls[start][3],models=f.calls.slice(start+1).filter(c=>c[0]==='uniformMatrix4fv'&&c[1]==='model').map(c=>c[3]);assert.equal(models.length,count);assert.ok(view instanceof Float32Array&&view.every(Number.isFinite));const transform=(m,v)=>Array.from({length:4},(_,row)=>{let total=Math.fround(0);for(let col=0;col<4;col++)total=Math.fround(total+Math.fround(m[col*4+row]*v[col]));return total;});for(const matrix of models){assert.ok(matrix instanceof Float32Array&&matrix.every(Number.isFinite));for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){const clip=transform(view,transform(matrix,[x,y,z,1]));assert.ok(clip.every(Number.isFinite)&&clip[3]>0,'finite forward clip '+clip);const ndc=clip.slice(0,3).map(v=>v/clip[3]);assert.ok(Math.abs(ndc[0])<=.835&&Math.abs(ndc[1])<=.835,'viewport containment '+ndc);assert.ok(ndc[2]>-1&&ndc[2]<1,'depth containment '+ndc);}}}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('six standard views fit every object at exact axes while preserving authored data FOV and selected identity', () => {
  const f = fixture(), renderer = f.render(), value = freeze(scene(128)), source = JSON.stringify(value);
  renderer.setModel(value); renderer.setSelectedObject(value.objects[37].instanceId);
  for (const [name, axis] of Object.entries(axes)) {
    assert.equal(renderer.setViewDirection(name), true, name);
    const snapshot = renderer.snapshot(); near(heading(snapshot.camera), axis); near(snapshot.camera.up, upFor(name));
    assert.equal(snapshot.camera.fovDegrees, value.camera.fovDegrees); assert.equal(snapshot.selectedInstanceId, value.objects[37].instanceId);
    assert.equal(snapshot.objectCount, 128); gpuSceneFits(f, 128);
    for (const dimension of [0, 1, 2]) if (axis[dimension] === 0) assert.equal(snapshot.camera.position[dimension], snapshot.camera.target[dimension], `${name} has no epsilon tilt`);
  }
  assert.equal(JSON.stringify(value), source); assert.equal(Object.hasOwn(value.camera, 'up'), false); renderer.dispose();
});

test('all six preset views contain actual Float32 geometry at extreme FOV and rounded drawing aspects', () => {
  for (const fovDegrees of [1, 179]) for (const bounds of [{ width: 1, height: 8192 }, { width: 8192, height: 1 }, { width: 390, height: 844 }]) {
    const f = fixture({ bounds, dpr: 2 }), renderer = f.render(), value = scene(128);
    value.camera.fovDegrees = fovDegrees; value.viewport = [8192, 1];
    value.objects.forEach((object, index) => { object.position = [index % 2 ? 100000 : -100000, index % 3 ? 100000 : -100000, index % 5 ? 100000 : -100000]; object.size = index % 2 ? [.001, .001, .001] : [1000, .001, 1000]; });
    renderer.setModel(value);
    for (const name of Object.keys(axes)) { assert.equal(renderer.setViewDirection(name), true); gpuSceneFits(f, 128); near(heading(renderer.snapshot().camera), axes[name]); }
    assert.ok(renderer.snapshot().width <= 2048 && renderer.snapshot().height <= 2048); renderer.dispose();
  }
});

test('millimetre boxes at far coordinates stay visible with finite view-local uploads in all presets', () => {
  const f = fixture(), renderer = f.render(), value = scene(3);
  value.objects.forEach((object, index) => { object.position = [100000 - index * .003, -100000 + index * .005, 100000 - index * .004]; object.size = [.001, .002, .001]; });
  renderer.setModel(value);
  for (const name of Object.keys(axes)) { assert.equal(renderer.setViewDirection(name), true); gpuSceneFits(f, 3); }
  renderer.dispose();
});

test('top and bottom remain exact after whole-scene focus object focus and wheel and use their actual drawn picking frame', () => {
  for (const name of ['top', 'bottom']) {
    const f = fixture(), renderer = f.render(), value = centeredScene(), source = JSON.stringify(value);
    renderer.setModel(value); renderer.setSelectedObject(value.objects[0].instanceId); renderer.setViewDirection(name);
    for (const focus of [() => renderer.focusAll(), () => renderer.focusObject(value.objects[0].instanceId)]) {
      assert.equal(focus(), true); const before = renderer.snapshot().camera;
      near(heading(before), axes[name]); near(before.up, upFor(name)); gpuSceneFits(f, 1);
      assert.equal(renderer.hitTest(150, 100), value.objects[0].instanceId);
      let prevented = false; f.listeners.get('wheel')({ deltaY: 1, preventDefault() { prevented = true; } });
      const after = renderer.snapshot().camera; assert.equal(prevented, true);
      near(heading(after), axes[name]); near(after.up, upFor(name));
      assert.ok(Math.abs(distance(after) / distance(before) - Math.exp(.001)) < 1e-12); gpuSceneFits(f, 1);
      assert.equal(renderer.hitTest(150, 100), value.objects[0].instanceId);
    }
    assert.equal(JSON.stringify(value), source); renderer.dispose();
  }
});

test('pole picking chooses the physically nearest box for each direction and still supports ordinary tap and double-click notifications', () => {
  const picked = [], f = fixture({ onPick: (id, hint) => picked.push([id, hint]) }), renderer = f.render(), value = centeredScene();
  value.objects.push({ ...structuredClone(value.objects[0]), instanceId: '11111111-1111-4111-8111-111111111111', position: [0, 5, 0] });
  renderer.setModel(value);
  for (const [name, expected] of [['top', value.objects[1].instanceId], ['bottom', value.objects[0].instanceId]]) {
    assert.equal(renderer.setViewDirection(name), true); assert.equal(renderer.hitTest(150, 100), expected);
    send(f, 'pointerdown'); send(f, 'pointerup'); send(f, 'dblclick', { timeStamp: 110 });
    assert.deepEqual(picked.splice(0), [[expected, { focus: false }], [expected, { focus: true }]]);
  }
  renderer.dispose();
});

test('dragging through a pole retains a finite orthogonal camera basis and can frame or pick afterwards', () => {
  for (const name of ['top', 'bottom']) {
    const f = fixture(), renderer = f.render(), value = centeredScene(), source = JSON.stringify(value);
    renderer.setModel(value); renderer.setViewDirection(name); send(f, 'pointerdown');
    for (const point of [{ clientX: 175, clientY: 100 }, { clientX: 175, clientY: 300 }, { clientX: 180, clientY: 600 }, { clientX: 150, clientY: 900 }]) {
      send(f, 'pointermove', point); const camera = renderer.snapshot().camera, direction = heading(camera);
      assert.ok([...camera.position, ...camera.target, ...camera.up].every(Number.isFinite));
      assert.ok(Math.abs(Math.hypot(...camera.up) - 1) < 1e-10); assert.ok(Math.abs(direction.reduce((sum, n, i) => sum + n * camera.up[i], 0)) < 1e-10);
    }
    send(f, 'pointerup', { clientX: 150, clientY: 900 }); assert.equal(renderer.focusAll(), true); gpuSceneFits(f, 1);
    assert.equal(renderer.hitTest(150, 100), value.objects[0].instanceId); assert.equal(JSON.stringify(value), source); renderer.dispose();
  }
});

test('snapshots cannot mutate the retained up vector and authored reset or model refresh discards the temporary preset', () => {
  const f = fixture(), renderer = f.render(), value = centeredScene(), source = JSON.stringify(value);
  renderer.setModel(value); renderer.setViewDirection('top'); const snapshot = renderer.snapshot(); snapshot.camera.up[2] = 99; snapshot.camera.target[0] = 99; snapshot.camera.position[0] = 99;
  near(renderer.snapshot().camera.up, [0, 0, -1]); assert.notEqual(renderer.snapshot().camera.target[0], 99); assert.notEqual(renderer.snapshot().camera.position[0], 99);
  renderer.focusObject(value.objects[0].instanceId); const focused = renderer.snapshot(); focused.camera.up[2] = 99; near(renderer.snapshot().camera.up, [0, 0, -1]);
  assert.equal(renderer.resetView(), true); assert.deepEqual(renderer.snapshot().camera, value.camera); assert.equal(Object.hasOwn(renderer.snapshot().camera, 'up'), false);
  renderer.setViewDirection('bottom'); const next = centeredScene(); next.camera.position = [17, 11, 5]; assert.equal(renderer.setModel(next), true);
  assert.deepEqual(renderer.snapshot().camera, next.camera); assert.equal(Object.hasOwn(renderer.snapshot().camera, 'up'), false); assert.equal(renderer.snapshot().selectedInstanceId, null);
  assert.equal(JSON.stringify(value), source); renderer.dispose();
});

test('a supplied explicit camera up vector is detached on model and snapshot boundaries', () => {
  const f = fixture(), renderer = f.render(), value = centeredScene(); value.camera.up = [0, 1, 0]; renderer.setModel(value);
  value.camera.up[1] = 2; near(renderer.snapshot().camera.up, [0, 1, 0]);
  renderer.resetView(); near(renderer.snapshot().camera.up, [0, 2, 0]); const snapshot = renderer.snapshot(); snapshot.camera.up[1] = 77;
  near(renderer.snapshot().camera.up, [0, 2, 0]); renderer.dispose();
});

test('changing preset after resize uses the current rounded drawing dimensions', () => {
  const options = { bounds: { width: 700, height: 200 }, dpr: 2 }, f = fixture(options), renderer = f.render(), value = scene();
  renderer.setModel(value); renderer.setViewDirection('front'); const before = distance(renderer.snapshot().camera);
  options.bounds = { width: 2, height: 12000 }; f.resize(); assert.equal(renderer.setViewDirection('front'), true);
  assert.equal(renderer.snapshot().width, 1); assert.equal(renderer.snapshot().height, 2048); assert.ok(distance(renderer.snapshot().camera) > before); gpuSceneFits(f, 5); renderer.dispose();
});

test('successful and invalid preset requests revoke old drag and double-click eligibility without author or selection edits', () => {
  const picked = [], f = fixture({ onPick: (id, hint) => picked.push([id, hint]) }), renderer = f.render(), value = centeredScene(); renderer.setModel(value); renderer.setViewDirection('front');
  for (const direction of ['top', 'sideways', undefined, null]) {
    send(f, 'pointerdown'); send(f, 'pointerup'); const count = picked.length;
    renderer.setViewDirection(direction); send(f, 'dblclick', { timeStamp: 110 }); assert.equal(picked.length, count);
    send(f, 'pointerdown'); renderer.setViewDirection(direction); const snapshot = renderer.snapshot();
    send(f, 'pointermove', { clientX: 20, clientY: 20 }); send(f, 'pointerup', { clientX: 20, clientY: 20 }); assert.deepEqual(renderer.snapshot(), snapshot); assert.equal(picked.length, count);
  }
  renderer.dispose();
});

test('missing model invalid directions lost context and disposed requests cannot report a successful new view', () => {
  const options = {}, f = fixture(options), renderer = f.render(), initial = renderer.snapshot();
  assert.equal(renderer.setViewDirection('top'), false); assert.deepEqual(renderer.snapshot(), initial);
  renderer.setModel(scene()); renderer.setSelectedObject(scene().objects[2].instanceId); const before = renderer.snapshot(), calls = f.calls.length;
  for (const direction of [null, undefined, 0, {}, [], '', 'Top', ' side ', 'constructor', 'toString', '__proto__']) assert.equal(renderer.setViewDirection(direction), false);
  assert.deepEqual(renderer.snapshot(), before); assert.equal(f.calls.length, calls);
  options.contextLost = true; assert.equal(renderer.setViewDirection('top'), false); assert.deepEqual(renderer.snapshot(), before);
  renderer.dispose(); const disposed = renderer.snapshot(); assert.equal(renderer.setViewDirection('top'), false); assert.deepEqual(renderer.snapshot(), disposed);
});

test('malformed or empty geometry and finite GPU overflow are atomic refusals for preset framing', () => {
  for (const change of [value => value.objects = [], value => value.objects.push({ ...value.objects[0], size: [0, 1, 1] }), value => value.objects[0].position[0] = Infinity,
    value => value.objects[0].rotationDegrees[0] = NaN, value => value.camera.position = [...value.camera.target], value => value.objects[0].size = [1e39, 1e39, 1e39]]) {
    const errors = [], f = fixture({ onError: error => errors.push(error.message) }), renderer = f.render(), value = scene(); change(value); renderer.setModel(value);
    const before = renderer.snapshot(), calls = f.calls.length; assert.equal(renderer.setViewDirection('top'), false); assert.deepEqual(renderer.snapshot(), before);
    assert.equal(f.calls.length, calls); assert.deepEqual(errors, []); renderer.dispose();
  }
});

test('preset GPU failure rolls camera and prior fitted zoom range back and invalidates the partially drawn picking frame', () => {
  const errors = [], f = fixture({ onError: error => { errors.push(error.message); throw Error('consumer failed'); } }), renderer = f.render(), value = centeredScene();
  renderer.setModel(value); renderer.setSelectedObject(value.objects[0].instanceId); renderer.setViewDirection('top'); const before = renderer.snapshot(), upload = f.gl.uniformMatrix4fv;
  f.gl.uniformMatrix4fv = () => { throw Error('injected preset upload failure'); };
  assert.equal(renderer.setViewDirection('bottom'), false); assert.deepEqual(renderer.snapshot(), before); assert.equal(renderer.hitTest(150, 100), null);
  assert.deepEqual(errors, ['injected preset upload failure']); f.gl.uniformMatrix4fv = upload; assert.equal(renderer.render(), true);
  for (let count = 0; count < 8; count++) f.listeners.get('wheel')({ deltaY: 1000, preventDefault() {} });
  assert.ok(Math.abs(distance(renderer.snapshot().camera) / distance(before.camera) - 4) < 1e-10); near(heading(renderer.snapshot().camera), [0, 1, 0]); renderer.dispose();
});

test('context loss during upload refuses the view and cannot publish a live frame or increment successful draws', () => {
  const options = {}, errors = [], f = fixture({ ...options, onError: error => errors.push(error.message) }), renderer = f.render(); renderer.setModel(centeredScene()); const before = renderer.snapshot();
  const drawArrays = f.gl.drawArrays, oldContext = f.gl.isContextLost; let lost = false;
  f.gl.isContextLost = () => lost; f.gl.drawArrays = (...args) => { drawArrays(...args); lost = true; };
  assert.equal(renderer.setViewDirection('top'), false); assert.deepEqual(renderer.snapshot(), before); assert.deepEqual(errors, ['WebGL2 scene framing draw did not complete.']);
  f.gl.isContextLost = oldContext; assert.equal(renderer.hitTest(150, 100), null); renderer.dispose();
});

test('nonfinite wheel input cannot corrupt or redraw an explicit standard-view camera', () => {
  const f = fixture(), renderer = f.render(); renderer.setModel(centeredScene()); renderer.setViewDirection('top'); const before = renderer.snapshot();
  f.listeners.get('wheel')({ deltaY: NaN, preventDefault() {} }); assert.deepEqual(renderer.snapshot(), before); assert.equal(renderer.hitTest(150, 100), centeredScene().objects[0].instanceId); renderer.dispose();
});
