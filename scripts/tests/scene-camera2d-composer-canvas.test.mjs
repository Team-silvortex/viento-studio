import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCamera2DComposerCanvas } from '../../web/modules/app-scene-camera2d-composer.js';
import { resolveSceneCamera2DFrame, fitSceneCamera2DFrame, moveSceneCamera2DFrame } from '../../engine/scene-camera2d-frame.mjs';
const id = n => `98989898-9898-4989-8989-${String(n).padStart(12, '0')}`;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const geometry = model => model.actors.map(({ instanceId, position, size }) => ({ instanceId, position, size }));
const model = (follow = false) => freeze({ camera: follow
  ? { mode: 'follow', targetInstanceId: id(2), offset: [-24, 16], zoom: 2 }
  : { mode: 'fixed', center: [400, 240], zoom: 2 }, viewport: [800, 480], designViewport: [640, 360], actors: [
  { instanceId: id(1), objectId: id(8), name: 'Shared OC first', position: [-200, -100], size: [60, 40], color: '#81d9bc' },
  { instanceId: id(2), objectId: id(8), name: 'Shared OC second', position: [1500, 900], size: [60, 40], color: '#ddaa66' },
] });
function harness(initial = model(), { applyCandidates = false } = {}) {
  let current = initial, editable = true, resized, disconnected = 0;
  const calls = [], candidates = [], listeners = new Map(), captures = [], releases = [], focus = [], pointerPositions = new Map();
  const dimensions = { left: 100, top: 50, width: 848, height: 528 };
  const context = new Proxy({}, { get(target, key) {
    if (Object.hasOwn(target, key)) return target[key];
    return (...args) => calls.push({ name: key, args, stroke: target.strokeStyle, fill: target.fillStyle });
  }, set(target, key, value) { target[key] = value; return true; } });
  const canvas = { width: 0, height: 0, dataset: {}, getContext: () => context, getBoundingClientRect: () => ({ ...dimensions }),
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
    focus: (...args) => focus.push(args), setPointerCapture: value => captures.push(value), releasePointerCapture: value => releases.push(value) };
  const old = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { constructor(fn) { resized = fn; } observe(value) { assert.equal(value, canvas); } disconnect() { disconnected++; } };
  let controller;
  try { controller = createSceneCamera2DComposerCanvas({ canvas, canEdit: () => editable, onCandidate(camera, detail) {
    candidates.push({ camera, detail });
    if (applyCandidates) { current = { ...current, camera }; controller.setModel(current); }
  } }); }
  finally { if (old === undefined) delete globalThis.ResizeObserver; else globalThis.ResizeObserver = old; }
  controller.setModel(current);
  const screen = position => { const view = controller.getView(); return [dimensions.left + view.offsetX + position[0] * view.scale, dimensions.top + view.offsetY + position[1] * view.scale]; };
  const dispatch = (name, fields = {}) => {
    const pointerId = fields.pointerId ?? 1, previous = pointerPositions.get(pointerId);
    const [clientX, clientY] = name.startsWith('pointer') && previous ? previous : screen(controller.getFrame()?.center || [0, 0]);
    const event = { pointerId, button: 0, clientX, clientY, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...fields };
    if (name === 'pointerdown' || name === 'pointermove') pointerPositions.set(pointerId, [event.clientX, event.clientY]);
    listeners.get(name)?.(event); return event;
  };
  function drag(dx = 20, dy = -12, fields = {}) {
    const view = controller.getView(), [x, y] = screen(controller.getFrame().center);
    dispatch('pointerdown', { clientX: x, clientY: y, ...fields });
    dispatch('pointermove', { clientX: x + dx, clientY: y + dy, ...fields });
    return { view, x, y, camera: moveSceneCamera2DFrame(current.camera, [dx / view.scale, dy / view.scale]) };
  }
  return { controller, canvas, dimensions, calls, candidates, captures, releases, focus, listeners, screen, dispatch, drag,
    initial, setEditable(value) { editable = value; }, setModel(value) { current = value; controller.setModel(value); },
    resize: () => resized(), disconnected: () => disconnected };
}
const orangeRects = h => h.calls.filter(row => row.name === 'strokeRect' && row.stroke === '#ffcc66');
function close(actual, expected, epsilon = 1e-8) { assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`); }
function sameCamera(actual, expected) {
  assert.equal(actual.mode, expected.mode); assert.equal(actual.zoom, expected.zoom);
  if (actual.mode === 'follow') assert.equal(actual.targetInstanceId, expected.targetInstanceId);
  const key = actual.mode === 'follow' ? 'offset' : 'center'; actual[key].forEach((number, index) => close(number, expected[key][index]));
}
function containsFrame(h) {
  const { bounds } = h.controller.getFrame(), view = h.controller.getView();
  for (const [x, y] of [[bounds.left, bounds.top], [bounds.right, bounds.bottom]]) {
    const px = view.offsetX + x * view.scale, py = view.offsetY + y * view.scale;
    assert.ok(px >= 24 - 1e-8 && px <= h.dimensions.width - 24 + 1e-8);
    assert.ok(py >= 24 - 1e-8 && py <= h.dimensions.height - 24 + 1e-8);
  }
}

test('real composer draws camera bounds and design reference without images, clipping or source mutation', t => {
  const h = harness(), before = JSON.stringify(h.initial); t.after(() => h.controller.destroy());
  assert.deepEqual(h.controller.getFrame(), resolveSceneCamera2DFrame({ camera: h.initial.camera, actors: geometry(h.initial), viewport: h.initial.viewport }));
  assert.deepEqual(orangeRects(h).at(-1).args, [200, 120, 400, 240]);
  assert.ok(h.calls.some(row => row.name === 'strokeRect' && row.stroke === '#67809a' && JSON.stringify(row.args) === '[0,0,640,360]'));
  for (const actor of h.initial.actors) assert.ok(h.calls.some(row => row.name === 'fillRect' && row.fill === actor.color && row.args[0] === actor.position[0] - actor.size[0] / 2));
  assert.equal(h.calls.some(row => ['clip', 'drawImage'].includes(row.name)), false);
  assert.equal(JSON.stringify(h.initial), before); assert.equal(h.candidates.length, 0); assert.ok(h.canvas.width > 0);
});
test('same-OC follow frame highlights only its stable instance and connects its logical position', t => {
  const h = harness(model(true)); t.after(() => h.controller.destroy());
  const frame = h.controller.getFrame(); assert.equal(frame.targetInstanceId, id(2)); assert.deepEqual(frame.targetPosition, [1500, 900]);
  assert.deepEqual(frame.center, [1476, 916]);
  const target = h.calls.filter(row => row.name === 'strokeRect' && row.stroke === '#82dbff');
  assert.ok(target.length > 0); assert.ok(target.every(row => row.args[0] === 1470 && row.args[1] === 880));
  assert.ok(h.calls.some(row => row.name === 'moveTo' && row.stroke === '#82dbff' && JSON.stringify(row.args) === '[1500,900]'));
});
test('drag previews temporary frame and pointerup emits exactly one candidate without applying it', t => {
  const h = harness(), before = JSON.stringify(h.initial), frame = h.controller.getFrame(); t.after(() => h.controller.destroy());
  const dragged = h.drag(); assert.equal(h.candidates.length, 0); assert.equal(h.canvas.dataset.dragging, 'frame');
  assert.deepEqual(h.controller.getFrame(), frame); assert.notDeepEqual(JSON.parse(h.canvas.dataset.frame), frame);
  h.dispatch('pointerup'); assert.equal(h.candidates.length, 1); sameCamera(h.candidates[0].camera, dragged.camera);
  assert.deepEqual(h.candidates[0].detail.initialCamera, h.initial.camera); assert.ok(Object.isFrozen(h.candidates[0].camera));
  assert.deepEqual(h.controller.getFrame(), frame); assert.equal(h.canvas.dataset.dragging, '');
  h.dispatch('pointerup'); assert.equal(h.candidates.length, 1); assert.deepEqual(h.captures, [1]); assert.deepEqual(h.releases, [1]);
  assert.equal(JSON.stringify(h.initial), before);
});
test('follow dragging changes only offset and an owner can synchronously publish the candidate', t => {
  const h = harness(model(true), { applyCandidates: true }); t.after(() => h.controller.destroy());
  const drag = h.drag(30, 14); h.dispatch('pointerup'); assert.equal(h.candidates.length, 1);
  sameCamera(h.candidates[0].camera, drag.camera); assert.equal(h.candidates[0].camera.targetInstanceId, id(2)); assert.equal(h.candidates[0].camera.zoom, 2);
  const frame = h.controller.getFrame(); close(frame.center[0], 1500 + drag.camera.offset[0]); close(frame.center[1], 900 + drag.camera.offset[1]);
  assert.deepEqual(h.initial.camera.offset, [-24, 16]); assert.deepEqual(h.initial.actors[1].position, [1500, 900]);
});
test('release uses the final pointer position, including when its last movement event was not delivered', t => {
  for (const follow of [false, true]) for (const sendMove of [false, true]) {
    const h = harness(model(follow)); t.after(() => h.controller.destroy());
    const view = h.controller.getView(), [x, y] = h.screen(h.controller.getFrame().center);
    h.dispatch('pointerdown', { clientX: x, clientY: y });
    if (sendMove) h.dispatch('pointermove', { clientX: x + 10, clientY: y - 5 });
    assert.equal(h.candidates.length, 0);
    h.dispatch('pointerup', { clientX: x + 40, clientY: y + 15 });
    assert.equal(h.candidates.length, 1, `${follow ? 'follow' : 'fixed'} / move=${sendMove}`);
    sameCamera(h.candidates[0].camera, moveSceneCamera2DFrame(h.initial.camera, [40 / view.scale, 15 / view.scale]));
  }
});
test('a non-finite release coordinate cancels the candidate instead of committing an older pointer sample', t => {
  const h = harness(); t.after(() => h.controller.destroy()); h.drag();
  h.dispatch('pointerup', { clientX: NaN }); assert.equal(h.candidates.length, 0); assert.equal(h.canvas.dataset.dragging, '');
});
test('click without movement does not create a candidate', t => {
  const h = harness(); t.after(() => h.controller.destroy()); h.dispatch('pointerdown'); h.dispatch('pointerup'); assert.equal(h.candidates.length, 0);
});
test('Escape, active-pointer cancellation and lost capture discard preview without committing', t => {
  for (const [type, fields] of [['keydown', { key: 'Escape' }], ['pointercancel', {}], ['lostpointercapture', {}]]) {
    const h = harness(); t.after(() => h.controller.destroy()); const frame = h.controller.getFrame(); h.drag();
    const event = h.dispatch(type, fields); h.dispatch('pointerup');
    assert.equal(h.candidates.length, 0, type); assert.deepEqual(JSON.parse(h.canvas.dataset.frame), frame, type);
    assert.equal(h.canvas.dataset.dragging, ''); assert.deepEqual(h.releases, [1]);
    if (type === 'keydown') { assert.equal(event.prevented, true); assert.equal(event.stopped, true); }
  }
});
test('foreign pointer cancellation or release cannot steal an active composition gesture', t => {
  const h = harness(); t.after(() => h.controller.destroy()); h.drag();
  h.dispatch('pointercancel', { pointerId: 2 }); h.dispatch('lostpointercapture', { pointerId: 2 }); h.dispatch('pointerup', { pointerId: 2 });
  assert.equal(h.canvas.dataset.dragging, 'frame'); assert.equal(h.candidates.length, 0);
  h.dispatch('pointerup', { pointerId: 1 }); assert.equal(h.candidates.length, 1);
});
test('owner edit permission revoked before move, release or keyboard prevents all candidates', t => {
  for (const revokeBefore of ['move', 'up', 'key']) {
    const h = harness(); t.after(() => h.controller.destroy()); const frame = h.controller.getFrame();
    if (revokeBefore === 'move') { const [x, y] = h.screen(frame.center); h.dispatch('pointerdown'); h.setEditable(false); h.dispatch('pointermove', { clientX: x + 20, clientY: y }); }
    else if (revokeBefore === 'up') { h.drag(); h.setEditable(false); }
    else h.setEditable(false);
    h.dispatch('pointerup'); h.dispatch('keydown', { key: 'ArrowRight' }); h.dispatch('pointerdown');
    assert.equal(h.candidates.length, 0, revokeBefore); assert.equal(h.canvas.dataset.dragging, ''); assert.deepEqual(h.controller.getFrame(), frame);
  }
});
test('pan, wheel zoom and both fit scopes alter only editor view and cancel pending frame movement', t => {
  const h = harness(), camera = h.initial.camera, original = h.controller.getFrame(); t.after(() => h.controller.destroy());
  const view = h.controller.getView(); h.drag(30, -10, { altKey: true }); h.dispatch('pointerup');
  assert.notDeepEqual(h.controller.getView(), view); assert.deepEqual(h.controller.getFrame(), original); assert.equal(h.candidates.length, 0);
  const beforeZoom = h.controller.getView(); h.dispatch('wheel', { deltaY: -1 }); close(h.controller.getView().scale, beforeZoom.scale * 1.1);
  for (const scope of ['camera', 'all']) {
    h.drag(); assert.equal(h.controller.fit(scope), true); h.dispatch('pointerup'); assert.equal(h.candidates.length, 0);
    assert.deepEqual(h.controller.getView(), fitSceneCamera2DFrame(original, geometry(h.initial), h.dimensions.width, h.dimensions.height, { scope }));
  }
  assert.deepEqual(h.initial.camera, camera); assert.deepEqual(h.controller.getFrame(), original);
});
test('explicit pan cancellation restores the prior editor view and never changes the camera', t => {
  const h = harness(), original = h.controller.getView(); t.after(() => h.controller.destroy());
  h.drag(80, 30, { button: 1 }); assert.notDeepEqual(h.controller.getView(), original); h.controller.cancel(); h.dispatch('pointerup');
  assert.deepEqual(h.controller.getView(), original); assert.equal(h.candidates.length, 0);
});
test('numeric invalidation and model replacement clear old frames and abandon pending candidates', t => {
  const h = harness(); t.after(() => h.controller.destroy()); h.drag();
  const invalid = structuredClone(h.initial); invalid.camera.zoom = NaN; h.setModel(invalid); h.dispatch('pointerup');
  assert.equal(h.controller.getFrame(), null); assert.equal(h.canvas.dataset.frame, ''); assert.equal(h.candidates.length, 0);
  h.dispatch('keydown', { key: 'ArrowRight' }); h.dispatch('pointerdown'); assert.equal(h.canvas.dataset.dragging, '');
  h.setModel(model(true)); assert.equal(h.controller.getFrame().targetInstanceId, id(2));
  h.drag(); h.setModel(null); h.dispatch('pointerup'); assert.equal(h.canvas.dataset.frame, ''); assert.equal(h.candidates.length, 0);
});
test('resize retains fit scope, recomputes view and cancels a temporary frame', t => {
  for (const scope of ['camera', 'all']) {
    const h = harness(model(true)); t.after(() => h.controller.destroy()); h.controller.fit(scope); h.drag();
    h.dimensions.width = 390.5; h.dimensions.height = 480.25; h.resize(); h.dispatch('pointerup');
    const frame = h.controller.getFrame(); containsFrame(h);
    assert.deepEqual(h.controller.getView(), fitSceneCamera2DFrame(frame, geometry(h.initial), 390.5, 480.25, { scope }));
    assert.equal(h.candidates.length, 0); assert.equal(h.canvas.width, Math.round(390.5)); assert.equal(h.canvas.height, Math.round(480.25));
  }
});
test('large logical surfaces and extreme DPR keep backing allocation within the pixel budget', t => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
  Object.defineProperty(globalThis, 'devicePixelRatio', { value: 8, configurable: true });
  t.after(() => { if (prior) Object.defineProperty(globalThis, 'devicePixelRatio', prior); else delete globalThis.devicePixelRatio; });
  const h = harness(); t.after(() => h.controller.destroy());
  assert.equal(h.canvas.width, 848 * 3); assert.equal(h.canvas.height, 528 * 3);
  h.dimensions.width = 65536; h.dimensions.height = 65536; h.resize();
  assert.equal(h.canvas.width, 4096); assert.equal(h.canvas.height, 4096);
  assert.ok(h.canvas.width * h.canvas.height <= 4096 ** 2);
  assert.ok(h.calls.filter(row => row.name === 'setTransform').every(row => row.args.every(Number.isFinite)));
  assert.deepEqual(h.initial.camera, model().camera); assert.equal(h.candidates.length, 0);
});
test('keyboard arrows propose one world unit or ten with Shift, keeping follow identity and zoom', t => {
  const h = harness(model(true), { applyCandidates: true }); t.after(() => h.controller.destroy());
  assert.equal(h.dispatch('keydown', { key: 'ArrowRight' }).prevented, true); assert.equal(h.candidates.length, 1);
  assert.deepEqual(h.candidates[0].camera.offset, [-23, 16]);
  h.dispatch('keydown', { key: 'ArrowUp', shiftKey: true }); assert.equal(h.candidates.length, 2); assert.deepEqual(h.candidates[1].camera.offset, [-23, 6]);
  for (const value of h.candidates) { assert.equal(value.camera.targetInstanceId, id(2)); assert.equal(value.camera.zoom, 2); }
  const before = h.candidates.length;
  for (const fields of [{ ctrlKey: true }, { metaKey: true }, { isComposing: true }]) h.dispatch('keydown', { key: 'ArrowDown', ...fields });
  for (const key of ['Home', '0', '+', '-']) h.dispatch('keydown', { key });
  assert.equal(h.candidates.length, before); assert.deepEqual(h.initial.camera.offset, [-24, 16]);
});
test('destroy is terminal, releases capture, disconnects observer and prevents late events or model resurrection', () => {
  const h = harness(); h.drag(); const lateDown = h.listeners.get('pointerdown'), lateMove = h.listeners.get('pointermove'), lateUp = h.listeners.get('pointerup');
  h.controller.destroy(); assert.equal(h.listeners.size, 0); assert.equal(h.disconnected(), 1); assert.equal(h.controller.getFrame(), null); assert.deepEqual(h.releases, [1]);
  const event = { pointerId: 1, button: 0, clientX: 150, clientY: 100, preventDefault() {} };
  const finalView = h.controller.getView(), finalCalls = h.calls.length;
  lateDown(event); lateMove(event); lateUp(event); h.setModel(model(true)); h.controller.resize(); h.resize(); h.controller.reset(); h.controller.cancel();
  assert.equal(h.controller.getFrame(), null); assert.equal(h.controller.fit('camera'), false); assert.equal(h.controller.fit('all'), false);
  assert.deepEqual(h.controller.getView(), finalView); assert.equal(h.canvas.dataset.frame, ''); assert.equal(h.canvas.dataset.dragging, '');
  assert.equal(h.calls.length, finalCalls); assert.equal(h.candidates.length, 0);
  h.controller.destroy(); assert.equal(h.disconnected(), 1); assert.deepEqual(h.releases, [1]);
});
