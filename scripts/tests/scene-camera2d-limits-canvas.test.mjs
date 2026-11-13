import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCamera2DComposerCanvas } from '../../web/modules/app-scene-camera2d-composer.js';
const id = n => `98989898-9898-4989-8989-${String(n).padStart(12, '0')}`;
const limits = { left: 0, top: 0, right: 200, bottom: 100 };
const make = () => ({ camera: { mode: 'fixed', center: [300, 300], zoom: 1, limits }, viewport: [200, 100], designViewport: [200, 100],
  actors: [{ instanceId: id(1), objectId: id(8), name: 'Actor', position: [50, 50], size: [20, 20], color: '#20d080' }] });
function harness() {
  const listeners = new Map(), calls = [], candidates = [];
  const context = new Proxy({}, { get(target, key) { if (Object.hasOwn(target, key)) return target[key]; return (...args) => calls.push({ name: key, args, stroke: target.strokeStyle }); }, set(target, key, value) { target[key] = value; return true; } });
  const canvas = { dataset: {}, getContext: () => context, getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 480 }),
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: (key) => listeners.delete(key), focus() {}, setPointerCapture() {}, releasePointerCapture() {} };
  const controller = createSceneCamera2DComposerCanvas({ canvas, onCandidate: (camera, detail) => candidates.push({ camera, detail }) });
  const dispatch = (name, x, y) => listeners.get(name)?.({ pointerId: 1, button: 0, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} });
  return { canvas, controller, calls, candidates, dispatch };
}

test('bounded composition draws actual frame, cyan world limits and desired center independently', t => {
  const h = harness(); t.after(() => h.controller.destroy()); const source = make(), before = JSON.stringify(source); h.controller.setModel(source); h.controller.fit('all');
  const frame = h.controller.getFrame(); assert.deepEqual(frame.center, [100, 50]); assert.deepEqual(frame.desiredCenter, [300, 300]); assert.deepEqual(frame.limits, limits);
  assert.ok(h.calls.some(row => row.name === 'strokeRect' && row.stroke === '#64d9e9' && JSON.stringify(row.args) === '[0,0,200,100]'));
  assert.ok(h.calls.some(row => row.name === 'arc' && row.stroke === '#f5b7ec' && row.args[0] === 300 && row.args[1] === 300));
  assert.deepEqual(JSON.parse(h.canvas.dataset.frame), frame); assert.equal(JSON.stringify(source), before); assert.equal(h.candidates.length, 0);
});

test('drag moves declared center while clamping the visual frame and retaining bounds; invalid bounds clear the drawing', t => {
  const h = harness(); t.after(() => h.controller.destroy()); const source = make(); h.controller.setModel(source); h.controller.fit('camera');
  const view = h.controller.getView(), frame = h.controller.getFrame(), x = 100 + view.offsetX + frame.center[0] * view.scale, y = 50 + view.offsetY + frame.center[1] * view.scale;
  h.dispatch('pointerdown', x, y); h.dispatch('pointermove', x + 20, y + 10);
  assert.deepEqual(JSON.parse(h.canvas.dataset.frame).center, [100, 50]); assert.equal(h.candidates.length, 0);
  h.dispatch('pointerup', x + 20, y + 10); assert.equal(h.candidates.length, 1); const output = h.candidates[0].camera;
  assert.ok(Math.abs(output.center[0] - (300 + 20 / view.scale)) < 1e-9); assert.ok(Math.abs(output.center[1] - (300 + 10 / view.scale)) < 1e-9);
  assert.deepEqual(output.limits, limits); assert.deepEqual(h.candidates[0].detail.initialCamera, source.camera);
  const invalid = structuredClone(source); invalid.camera.limits.right = 0; h.controller.setModel(invalid); assert.equal(h.canvas.dataset.frame, ''); assert.equal(h.controller.getFrame(), null);
});
