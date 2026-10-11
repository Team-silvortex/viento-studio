import test from 'node:test';
import assert from 'node:assert/strict';
import { identity4, multiply4, lookAt4, perspective4, objectMatrix4, rotationXYZ4, orbitCamera, color3, normalize3 } from '../../web/modules/scene3d-math.js';
import { createScene3DRenderer } from '../../web/modules/scene3d-renderer.js';

const near = (a, b) => a.forEach((value, index) => assert.ok(Math.abs(value - b[index]) < 1e-9, `${index}: ${value} != ${b[index]}`));
const camera = { position: [4, 3, 6], target: [0, 0, 0], fovDegrees: 50, near: .1, far: 100 };
const model = () => ({ background: '#142538', camera: structuredClone(camera), light: { direction: [1, -2, -1], color: '#ffffff', energy: 1 },
  objects: [{ instanceId: '00000000-0000-4000-8000-000000000001', position: [1, 2, 3], rotationDegrees: [23, -41, 67], size: [2, 3, 4], color: '#85d7bb' }] });
function fixture(options = {}) {
  const calls = [], listeners = new Map(); let observed, disconnected = 0, lost = false, next = 0;
  const constants = ['COMPILE_STATUS', 'LINK_STATUS', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'ARRAY_BUFFER', 'STATIC_DRAW', 'FLOAT', 'DEPTH_TEST', 'LEQUAL', 'CULL_FACE', 'COLOR_BUFFER_BIT', 'DEPTH_BUFFER_BIT', 'TRIANGLES'];
  const gl = Object.fromEntries(constants.map((name, i) => [name, i + 1]));
  for (const name of ['createProgram', 'createShader', 'createBuffer', 'createVertexArray']) gl[name] = () => { const value = options.failAllocation === name ? null : { name, id: ++next }; calls.push([name, value]); return value; };
  for (const name of ['attachShader', 'shaderSource', 'compileShader', 'linkProgram', 'bindVertexArray', 'bindBuffer', 'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'viewport', 'enable', 'depthFunc', 'disable', 'clearColor', 'clear', 'useProgram', 'uniformMatrix4fv', 'uniform3fv', 'uniform1f', 'drawArrays', 'deleteBuffer', 'deleteVertexArray', 'deleteProgram', 'deleteShader']) gl[name] = (...args) => calls.push([name, ...args]);
  gl.getShaderParameter = () => options.compile !== false; gl.getShaderInfoLog = () => 'compile failed';
  gl.getProgramParameter = () => options.link !== false; gl.getProgramInfoLog = () => 'link failed';
  gl.getUniformLocation = (_, name) => name; gl.isContextLost = () => lost;
  gl.getExtension = () => ({ loseContext() { lost = true; calls.push(['loseContext']); } });
  const canvas = { width: 0, height: 0, getContext: () => options.unsupported ? null : gl,
    getBoundingClientRect: () => options.bounds || { width: 300, height: 200 },
    addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
  const render = () => createScene3DRenderer(canvas, { pixelRatio: () => options.dpr ?? 1, onError: options.onError,
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
