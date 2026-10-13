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

const uniform = (f, name) => f.calls.findLast(call => call[1] === name && call[0].startsWith('uniform'))?.[2];
test('fog GPU state is replaced per frame and absent old scenes explicitly disable it', () => {
  const f = fixture(), value = model(); value.fog = { color: '#aaccee', density: .125 }; const source = JSON.stringify(value);
  f.renderer.setModel(value); assert.equal(uniform(f, 'fogDensity'), .125); near(uniform(f, 'fogColor'), [170/255, 204/255, 238/255]);
  f.renderer.setProjectionMode('orthographic'); assert.equal(uniform(f, 'fogDensity'), .125);
  const disabled = structuredClone(value); disabled.fog.density = 0; f.renderer.setModel(disabled); assert.equal(uniform(f, 'fogDensity'), 0);
  f.renderer.setModel(model()); assert.equal(uniform(f, 'fogDensity'), 0); assert.equal(JSON.stringify(value), source); f.renderer.dispose();
});
test('fog follows current view position with a floating origin and retains hit testing in both projections', () => {
  for (const mode of ['perspective', 'orthographic']) {
    const f = fixture(), value = model(); value.fog = { color: '#ffffff', density: .05 };
    for (const vector of [value.camera.position, value.camera.target, value.objects[0].position]) for (let axis = 0; axis < 3; axis++) vector[axis] += 90000;
    const original = JSON.stringify(value); f.renderer.setModel(value); f.renderer.setProjectionMode(mode);
    for (const direction of ['front', 'right', 'top', 'bottom']) {
      f.renderer.setViewDirection(direction); const camera = f.renderer.snapshot().camera;
      near(uniform(f, 'cameraRelativePosition'), camera.position.map((v, i) => v - camera.target[i]));
      assert.ok(uniform(f, 'cameraRelativePosition').every(Number.isFinite));
      assert.equal(f.renderer.hitTest(160, 120), value.objects[0].instanceId);
    }
    assert.equal(JSON.stringify(value), original); f.renderer.dispose();
  }
});
