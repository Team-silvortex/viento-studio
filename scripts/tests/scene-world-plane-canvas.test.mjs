import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenePreviewCanvas, sceneToCanvas, canvasToScene, fitSceneView, hitTestScene } from '../../web/modules/app-scene-preview-canvas.js';

const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const scene = () => freeze({ scene: { objectId: 'world', viewport: [800, 480], background: '#001122' }, actors: [
  { objectId: 'shared', instanceId: 'left', name: 'Left', position: [-1200.25, -600.5], size: [80, 64], color: '#aabbcc' },
  { objectId: 'shared', instanceId: 'right', name: 'Right', position: [2400.75, 1300.25], size: [60, 48], color: '#bbccdd' },
  { objectId: 'shared', instanceId: 'far', name: 'Far', position: [100000, -100000], size: [2048, 2048], color: '#ccddaa' },
] });
function harness(model = scene()) {
  const calls = [], listeners = new Map(), moves = [], selections = [], views = [], released = [];
  const dimensions = { left: 100, top: 50, width: 848, height: 528 };
  const context = new Proxy({}, { get: (target, key) => target[key] ?? ((...args) => calls.push([key, ...args])), set: (target, key, value) => { target[key] = value; return true; } });
  const canvas = { width: 0, height: 0, getContext: () => context, getBoundingClientRect: () => ({ ...dimensions }),
    addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name),
    focus() {}, setPointerCapture() {}, releasePointerCapture(id) { released.push(id); }, ownerDocument: {} };
  let resize;
  const prior = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { constructor(callback) { resize = callback; } observe() {} disconnect() {} };
  let controller;
  try { controller = createScenePreviewCanvas({ canvas, onSelect: (...args) => selections.push(args), onMove: (...args) => moves.push(args),
    onMoveMany: (...args) => moves.push(args), onViewChange: value => views.push(value) }); }
  finally { if (prior === undefined) delete globalThis.ResizeObserver; else globalThis.ResizeObserver = prior; }
  controller.setScene(model); controller.setVisible(true);
  const screen = position => { const pair = sceneToCanvas(controller.getView(), ...position); return [pair[0] + dimensions.left, pair[1] + dimensions.top]; };
  const dispatch = (name, fields = {}) => { const [clientX, clientY] = screen(model.actors[0].position); return listeners.get(name)?.({ pointerId: 1, button: 0, clientX, clientY, preventDefault() {}, stopPropagation() {}, ...fields }); };
  return { controller, model, canvas, calls, moves, selections, views, released, dimensions, resize: () => resize(), screen, dispatch };
}
function inside(h, actors, padding = 23.99) {
  for (const actor of actors) for (const x of [-1, 1]) for (const y of [-1, 1]) {
    const [px, py] = sceneToCanvas(h.controller.getView(), actor.position[0] + x * actor.size[0] / 2, actor.position[1] + y * actor.size[1] / 2);
    assert.ok(px >= padding && px <= h.dimensions.width - padding, `${actor.instanceId}: x=${px}`);
    assert.ok(py >= padding && py <= h.dimensions.height - padding, `${actor.instanceId}: y=${py}`);
  }
}

test('world actors paint and hit outside the runtime viewport while its background and border remain reference geometry', () => {
  const h = harness();
  assert.equal(h.calls.some(([name]) => name === 'clip'), false);
  assert.ok(h.calls.some(([name, x, y, w, height]) => name === 'fillRect' && x === 0 && y === 0 && w === 800 && height === 480));
  assert.ok(h.calls.some(([name, x, y, w, height]) => name === 'strokeRect' && x === 0 && y === 0 && w === 800 && height === 480));
  for (const actor of h.model.actors) {
    assert.ok(h.calls.some(([name, x, y, w, height]) => name === 'fillRect' && x === actor.position[0] - actor.size[0] / 2
      && y === actor.position[1] - actor.size[1] / 2 && w === actor.size[0] && height === actor.size[1]));
    assert.equal(hitTestScene(h.model.scene, h.model.actors, ...actor.position), actor.instanceId);
  }
  const actors = [h.model.actors[0], { ...h.model.actors[0], instanceId: 'overlap' }];
  assert.equal(hitTestScene(h.model.scene, actors, ...actors[0].position), 'overlap');
  h.controller.destroy();
});

test('fitAll includes world extents and viewport without modifying author data, selection or movement history', () => {
  const h = harness(), before = JSON.stringify(h.model); h.controller.select('right'); h.calls.length = 0;
  assert.equal(h.controller.fitAll(), true); inside(h, h.model.actors);
  const view = h.controller.getView(); assert.ok(view.scale < .02 && view.scale >= 1e-6);
  assert.equal(h.moves.length, 0); assert.equal(h.selections.length, 0); assert.equal(JSON.stringify(h.model), before);
  assert.ok(h.calls.some(([name, , , w, height]) => name === 'strokeRect' && w === 60 && height === 48), 'selection stays on right');
  h.controller.zoom(1.25); assert.ok(Math.abs(h.controller.getView().scale - view.scale * 1.25) < 1e-12, 'first zoom does not jump back to old minimum');
  h.controller.fit(); assert.deepEqual(h.controller.getView(), fitSceneView([800, 480], 848, 528));
  h.controller.fitAll(); h.dispatch('keydown', { key: 'Home' }); assert.deepEqual(h.controller.getView(), fitSceneView([800, 480], 848, 528));
  h.controller.fitAll(); h.dispatch('keydown', { key: '0' }); assert.deepEqual(h.controller.getView(), fitSceneView([800, 480], 848, 528));
  h.controller.destroy();
});

test('focusSelection frames logical selected geometry, preserves shared-definition identities and ignores distant siblings', () => {
  const h = harness(); h.controller.setMultiSelect(true); h.controller.selectMany(['left', 'right']);
  assert.equal(h.controller.focusSelection(), true); inside(h, h.model.actors.slice(0, 2));
  const view = h.controller.getView(), outside = sceneToCanvas(view, ...h.model.actors[2].position);
  assert.ok(outside[0] > h.dimensions.width || outside[1] < 0);
  assert.equal(h.selections.length + h.moves.length, 0);
  h.controller.setEditing(true); h.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(h.moves.length, 1); assert.deepEqual(h.moves[0][0].map(row => row.objectId), ['left', 'right']);
  h.controller.destroy();
});

test('focus with no selection or an unavailable canvas is an exact view no-op', () => {
  const h = harness(); const before = h.controller.getView(), draws = h.calls.length, notifications = h.views.length;
  assert.equal(h.controller.focusSelection(), false); assert.deepEqual(h.controller.getView(), before);
  assert.equal(h.calls.length, draws); assert.equal(h.views.length, notifications);
  h.controller.select('left'); h.controller.setVisible(false); const hidden = h.controller.getView();
  assert.equal(h.controller.focusSelection(), false); assert.equal(h.controller.fitAll(), false); assert.deepEqual(h.controller.getView(), hidden);
  h.controller.setVisible(true); h.controller.setScene(null); assert.equal(h.controller.fitAll(), false);
  h.controller.destroy(); assert.equal(h.controller.fitAll(), false); assert.equal(h.controller.focusSelection(), false);
});

test('new framing commands cancel pending world-object drags without committing transient geometry', () => {
  for (const method of ['fitAll', 'focusSelection']) {
    const h = harness(); h.controller.fitAll(); h.controller.setEditing(true); h.controller.select('left');
    const [x, y] = h.screen(h.model.actors[0].position);
    h.dispatch('pointerdown'); h.dispatch('pointermove', { clientX: x + 20, clientY: y + 10 });
    assert.equal(h.controller[method](), true); h.dispatch('pointerup', { clientX: x + 20, clientY: y + 10 });
    assert.equal(h.moves.length, 0); assert.ok(h.released.length > 0);
    assert.deepEqual(h.model.actors[0].position, [-1200.25, -600.5]); h.controller.destroy();
  }
});

test('world fit and selected fit retain their explicit scope on resize; manual zoom keeps the world center', () => {
  for (const method of ['fitAll', 'focusSelection']) {
    const h = harness(); h.controller.select('right'); h.controller[method]();
    h.dimensions.width = 390; h.dimensions.height = 400; h.resize();
    inside(h, method === 'fitAll' ? h.model.actors : [h.model.actors[1]]);
    assert.ok(h.controller.getView().offsetX !== fitSceneView([800, 480], 390, 400).offsetX);
    h.controller.zoom(1.25); const center = canvasToScene(h.controller.getView(), 195, 200), scale = h.controller.getView().scale;
    h.dimensions.width = 780; h.dimensions.height = 500; h.resize();
    assert.deepEqual(canvasToScene(h.controller.getView(), 390, 250), center); assert.equal(h.controller.getView().scale, scale);
    h.controller.destroy();
  }
});

test('world grid covers only the visible rectangle, includes negative coordinates and stays bounded at the smallest zoom', () => {
  const h = harness(); h.controller.zoom(1e-6); h.calls.length = 0; h.controller.setGrid(true);
  const starts = h.calls.filter(([name]) => name === 'moveTo'), ends = h.calls.filter(([name]) => name === 'lineTo');
  assert.ok(starts.length > 0 && starts.length <= 512); assert.equal(starts.length, ends.length);
  const view = h.controller.getView(), a = canvasToScene(view, 0, 0), b = canvasToScene(view, h.dimensions.width, h.dimensions.height);
  for (const [i, line] of starts.entries()) {
    const endpoint = ends[i];
    for (const point of [line.slice(1), endpoint.slice(1)]) {
      assert.ok(point[0] >= a[0] - 1e-6 && point[0] <= b[0] + 1e-6);
      assert.ok(point[1] >= a[1] - 1e-6 && point[1] <= b[1] + 1e-6);
    }
  }
  assert.ok(starts.some(([, x, y]) => x < 0 || y < 0)); h.controller.destroy();
});

test('outside-world dragging retains snap, legal coordinate clamping and immutable movement grants', () => {
  const model = scene(), h = harness(model); h.controller.fitAll(); h.controller.setEditing(true); h.controller.setSnap(32); h.controller.setMovableIds(['left']);
  const [x, y] = h.screen(model.actors[0].position); h.dispatch('pointerdown'); h.dispatch('pointermove', { clientX: x + 20, clientY: y + 10 }); h.dispatch('pointerup');
  assert.equal(h.moves.length, 1); assert.ok(h.moves[0][1].every(value => Math.abs(value) <= 100000));
  const [rx, ry] = h.screen(model.actors[1].position); h.dispatch('pointerdown', { clientX: rx, clientY: ry });
  h.dispatch('pointermove', { clientX: rx + 20, clientY: ry + 10 }); h.dispatch('pointerup');
  assert.equal(h.moves.length, 1); assert.deepEqual(model.actors[0].position, [-1200.25, -600.5]); h.controller.destroy();
});
