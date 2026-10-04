import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenePreviewCanvas, moveScenePosition, sceneToCanvas } from '../../web/modules/app-scene-preview-canvas.js';

function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
function fixture(overrides = {}) {
  return deepFreeze({ scene: { objectId: 'scene', viewport: [800, 480], background: '#000000' }, actors: [
    { objectId: 'actor', name: 'Actor', position: [160.25, 220.75], size: [80, 64], color: '#abcdef', ...overrides },
  ] });
}
function groupFixture(overrides = {}) {
  const single = fixture();
  return deepFreeze({ ...single, actors: [single.actors[0],
    { ...single.actors[0], objectId: 'second', name: 'Second', position: [380.75, 240.25], size: [60, 48], ...overrides },
    { ...single.actors[0], objectId: 'third', name: 'Third', position: [600.5, 360.5], size: [40, 32] },
  ] });
}
function harness(model = fixture()) {
  const calls = [], listeners = new Map(), selected = [], selections = [], moves = [], groups = [], focus = [], captured = [], released = [];
  const context = new Proxy({}, { get: (target, key) => target[key] ?? ((...args) => calls.push([key, ...args])),
    set: (target, key, value) => { target[key] = value; return true; } });
  const canvas = { width: 0, height: 0, getContext: () => context,
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 848, height: 528 }),
    addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name),
    focus: options => focus.push(options), setPointerCapture: id => captured.push(id), releasePointerCapture: id => released.push(id), ownerDocument: {} };
  let applyMoves = false, syncSelection = false;
  const controller = createScenePreviewCanvas({ canvas, onSelect: (id, details) => {
    selected.push(id); selections.push(details.ids); if (syncSelection) controller.selectMany(details.ids);
  }, onMove(id, position, options) {
    moves.push({ id, position, options });
    if (applyMoves) { model = { ...model, actors: model.actors.map(actor => actor.objectId === id ? { ...actor, position } : actor) }; controller.setScene(model); }
  }, onMoveMany(changes, options) {
    groups.push({ changes, options });
    if (applyMoves) { const positions = new Map(changes.map(change => [change.objectId, change.position])); model = { ...model, actors: model.actors.map(actor => positions.has(actor.objectId) ? { ...actor, position: positions.get(actor.objectId) } : actor) }; controller.setScene(model); }
  } });
  controller.setScene(model); controller.setVisible(true);
  const screen = (position = model.actors[0].position) => { const [x, y] = sceneToCanvas(controller.getView(), ...position); return [x + 100, y + 50]; };
  function dispatch(name, args = {}) {
    const [clientX, clientY] = screen();
    const event = { pointerId: 1, button: 0, clientX, clientY, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...args };
    listeners.get(name)?.(event); return event;
  }
  return { controller, model, calls, selected, selections, moves, groups, focus, captured, released, listeners, dispatch, screen,
    applyMoves() { applyMoves = true; }, syncSelection() { syncSelection = true; },
    lastActorRect() { return calls.filter(([name, , , w, h]) => name === 'fillRect' && w === 80 && h === 64).at(-1)?.slice(1); } };
}

test('free movement preserves imported fractions and snapping aligns absolute centers within legal coordinates', () => {
  assert.deepEqual(moveScenePosition([160.25, 220.75], [10.4, 0]), [170.25, 220.75]);
  assert.deepEqual(moveScenePosition([160.25, 220.75], [12, 6], 32), [160, 224]);
  assert.deepEqual(moveScenePosition([99999.5, -99999.25], [2, -2]), [100000, -100000]);
  assert.deepEqual(moveScenePosition([99999, -99999], [100, -100], 32), [100000, -100000]);
});

test('dragging an actor previews a copy and commits once without mutating the saved model or view', () => {
  const h = harness(), view = h.controller.getView(), [x, y] = h.screen(); h.controller.setEditing(true);
  h.dispatch('pointerdown'); assert.deepEqual(h.selected, ['actor']);
  h.dispatch('pointermove', { clientX: x + 20, clientY: y + 10 });
  assert.deepEqual(h.lastActorRect(), [140.25, 198.75, 80, 64]);
  assert.deepEqual(h.model.actors[0].position, [160.25, 220.75]); assert.equal(h.moves.length, 0);
  h.dispatch('pointermove', { clientX: x + 30, clientY: y + 12 });
  h.dispatch('pointerup', { clientX: x + 30, clientY: y + 12 });
  assert.deepEqual(h.moves, [{ id: 'actor', position: [190.25, 232.75], options: { commit: true } }]);
  assert.deepEqual(h.controller.getView(), view); assert.deepEqual(h.focus, [{ preventScroll: true }]);
  assert.deepEqual(h.captured, [1]); assert.deepEqual(h.released, [1]);
  assert.deepEqual(h.lastActorRect(), [120.25, 188.75, 80, 64]);
});

test('screen movement converts through current zoom and an owner can publish the committed model synchronously', () => {
  const h = harness(); h.controller.zoom(2); h.controller.setEditing(true); h.applyMoves(); const [x, y] = h.screen();
  h.dispatch('pointerdown'); h.dispatch('pointermove', { clientX: x + 20, clientY: y - 10 }); h.dispatch('pointerup');
  assert.deepEqual(h.moves[0].position, [170.25, 215.75]);
  assert.deepEqual(h.lastActorRect(), [130.25, 183.75, 80, 64]);
  assert.equal(h.moves.length, 1);
});

test('clicks and motion inside the four screen-pixel threshold never change an off-grid position', () => {
  const h = harness(); h.controller.setEditing(true); h.controller.setSnap(32); const [x, y] = h.screen();
  h.dispatch('pointerdown'); h.dispatch('pointermove', { clientX: x + 4, clientY: y }); h.dispatch('pointerup');
  assert.equal(h.moves.length, 0); assert.deepEqual(h.lastActorRect(), [120.25, 188.75, 80, 64]);
  h.dispatch('pointerdown'); h.dispatch('pointermove', { clientX: x + 5, clientY: y }); h.dispatch('pointerup');
  assert.deepEqual(h.moves[0].position, [160, 224]);
});

test('Escape, pointer cancellation and lost capture revert only temporary actor movement', () => {
  for (const name of ['keydown', 'pointercancel', 'lostpointercapture']) {
    const h = harness(); h.controller.setEditing(true); const [x, y] = h.screen();
    h.dispatch('pointerdown'); h.dispatch('pointermove', { clientX: x + 10, clientY: y });
    const event = h.dispatch(name, { key: 'Escape' });
    h.dispatch('pointerup'); assert.equal(h.moves.length, 0, name);
    assert.deepEqual(h.lastActorRect(), [120.25, 188.75, 80, 64], name);
    if (name === 'keydown') { assert.equal(event.prevented, true); assert.equal(event.stopped, true); }
  }
});

test('cancelling another pointer never cancels the active actor gesture', () => {
  const h = harness(); h.controller.setEditing(true); const [x, y] = h.screen();
  h.dispatch('pointerdown'); h.dispatch('pointermove', { clientX: x + 10, clientY: y });
  h.dispatch('pointercancel', { pointerId: 2 }); h.dispatch('lostpointercapture', { pointerId: 2 }); h.dispatch('pointerup');
  assert.equal(h.moves.length, 1);
});

test('model, mode, visibility, snap and selection changes safely abandon pending movement', () => {
  const changes = [h => h.controller.setScene({ ...h.model }), h => h.controller.setEditing(false), h => h.controller.setVisible(false),
    h => h.controller.setSnap(32), h => h.controller.select('other'), h => h.dispatch('blur'), h => h.controller.fit(), h => h.controller.zoom(2)];
  for (const change of changes) {
    const h = harness(); h.controller.setEditing(true); const [x, y] = h.screen();
    h.dispatch('pointerdown'); h.dispatch('pointermove', { clientX: x + 10, clientY: y });
    change(h); h.dispatch('pointerup'); assert.equal(h.moves.length, 0);
  }
});

test('idempotent renders preserve a drag but destruction removes listeners and pending work', () => {
  const h = harness(); h.controller.setEditing(true); const [x, y] = h.screen();
  h.dispatch('pointerdown'); h.dispatch('pointermove', { clientX: x + 10, clientY: y });
  h.controller.setScene(h.model); h.controller.setVisible(true); h.controller.setEditing(true); h.controller.setSnap(0); h.controller.select('actor');
  h.dispatch('pointerup'); assert.equal(h.moves.length, 1);
  h.dispatch('pointerdown'); h.dispatch('pointermove', { clientX: x + 20, clientY: y }); h.controller.destroy();
  h.dispatch('pointerup'); assert.equal(h.moves.length, 1); assert.equal(h.listeners.size, 0);
});

test('dragging empty space, middle button and space-modified actors pans without moving or selecting objects', () => {
  for (const mode of ['blank', 'middle', 'space']) {
    const h = harness(); h.controller.setEditing(true); const initial = h.controller.getView();
    const [x, y] = mode === 'blank' ? h.screen([20, 20]) : h.screen();
    if (mode === 'space') h.dispatch('keydown', { key: ' ' });
    const event = { clientX: x, clientY: y, button: mode === 'middle' ? 1 : 0 };
    h.dispatch('pointerdown', event); h.dispatch('pointermove', { ...event, clientX: x + 2 });
    h.dispatch('pointermove', { ...event, clientX: x + 12 }); h.dispatch('pointerup', { ...event, clientX: x + 12 });
    assert.equal(h.controller.getView().offsetX, initial.offsetX + 12, mode);
    assert.equal(h.moves.length, 0, mode); assert.equal(h.selected.length, 0, mode);
  }
});

test('space release restores actor movement while readonly actor drags and arrows still pan', () => {
  const h = harness(), initial = h.controller.getView(), [x, y] = h.screen();
  h.dispatch('pointerdown'); h.dispatch('pointermove', { clientX: x + 12, clientY: y }); h.dispatch('pointerup');
  h.dispatch('keydown', { key: 'ArrowLeft' }); assert.equal(h.controller.getView().offsetX, initial.offsetX + 44); assert.equal(h.moves.length, 0);
  h.controller.setEditing(true); h.dispatch('keydown', { key: ' ' }); h.dispatch('keyup', { key: ' ' });
  const [nextX, nextY] = h.screen(); h.dispatch('pointerdown'); h.dispatch('pointermove', { clientX: nextX + 12, clientY: nextY }); h.dispatch('pointerup');
  assert.equal(h.moves.length, 1);
});

test('keyboard editing nudges by one or ten scene units regardless of zoom or grid and leaves undo modifiers alone', () => {
  const h = harness(); h.controller.setEditing(true); h.controller.select('actor'); h.controller.setSnap(32); h.controller.zoom(2); h.applyMoves();
  const view = h.controller.getView();
  const arrow = h.dispatch('keydown', { key: 'ArrowRight' }); h.dispatch('keydown', { key: 'ArrowUp', shiftKey: true });
  assert.deepEqual(h.moves.map(move => move.position), [[161.25, 220.75], [161.25, 210.75]]);
  assert.equal(arrow.prevented, true); assert.equal(arrow.stopped, true); assert.deepEqual(h.controller.getView(), view);
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    const event = h.dispatch('keydown', { key: 'ArrowLeft', [modifier]: true }); assert.equal(event.prevented, undefined);
  }
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const event = h.dispatch('keydown', { key: 'z', [modifier]: true }); assert.equal(event.prevented, undefined); assert.equal(event.stopped, undefined);
  }
  assert.equal(h.moves.length, 2);
});

test('arrow nudges do not emit no-op history at the coordinate boundary', () => {
  const h = harness(fixture({ position: [100000, -100000] })); h.controller.setEditing(true); h.controller.select('actor');
  h.dispatch('keydown', { key: 'ArrowRight' }); h.dispatch('keydown', { key: 'ArrowUp', shiftKey: true }); assert.equal(h.moves.length, 0);
  h.dispatch('keydown', { key: 'ArrowLeft', shiftKey: true }); assert.deepEqual(h.moves[0].position, [99990, -100000]);
});

test('editing uses reverse draw order and refuses to grab actor pixels outside the scene viewport', () => {
  const original = fixture({ position: [5, 10] }), overlapping = { ...original, actors: [...original.actors, { ...original.actors[0], objectId: 'top' }] };
  const h = harness(overlapping); h.controller.setEditing(true); h.dispatch('pointerdown'); h.dispatch('pointerup'); assert.deepEqual(h.selected, ['top']);
  const [x, y] = h.screen([-1, 10]); h.dispatch('pointerdown', { clientX: x, clientY: y }); h.dispatch('pointermove', { clientX: x + 12, clientY: y }); h.dispatch('pointerup');
  assert.equal(h.moves.length, 0); assert.deepEqual(h.selected, ['top']);
});

test('missing textures retain their placeholder while the actor is dragged', () => {
  const h = harness(fixture({ imageResourceId: 'missing-image' })); h.controller.setEditing(true); const [x, y] = h.screen();
  h.dispatch('pointerdown'); h.dispatch('pointermove', { clientX: x + 12, clientY: y });
  assert.deepEqual(h.lastActorRect(), [132.25, 188.75, 80, 64]);
  assert.ok(h.calls.some(([name, ...args]) => name === 'moveTo' && JSON.stringify(args) === JSON.stringify([132.25, 188.75])));
  h.dispatch('pointercancel'); assert.deepEqual(h.lastActorRect(), [120.25, 188.75, 80, 64]);
});

test('modifier clicks toggle multi-selection while ordinary selected clicks retain the group', () => {
  for (const modifier of ['shiftKey', 'ctrlKey', 'metaKey']) {
    const h = harness(groupFixture()); h.controller.setEditing(true); h.controller.setMultiSelect(true);
    h.dispatch('pointerdown'); h.dispatch('pointerup');
    const [clientX, clientY] = h.screen(h.model.actors[1].position), second = { clientX, clientY, [modifier]: true };
    h.dispatch('pointerdown', second); h.dispatch('pointerup', second);
    assert.deepEqual(h.selections.at(-1), ['actor', 'second']); assert.equal(h.selected.at(-1), 'second');
    h.dispatch('pointerdown'); h.dispatch('pointerup'); assert.deepEqual(h.selections.at(-1), ['actor', 'second']);
    h.dispatch('pointerdown', second); h.dispatch('pointerup', second); assert.deepEqual(h.selections.at(-1), ['actor']);
    const [thirdX, thirdY] = h.screen(h.model.actors[2].position);
    h.dispatch('pointerdown', { clientX: thirdX, clientY: thirdY }); h.dispatch('pointerup', { clientX: thirdX, clientY: thirdY });
    assert.deepEqual(h.selections.at(-1), ['third']); assert.equal(h.moves.length + h.groups.length, 0);
  }
});

test('unselecting the last actor and clicking blank canvas both publish an empty selection', () => {
  const h = harness(groupFixture()); h.controller.setEditing(true); h.controller.setMultiSelect(true);
  h.dispatch('pointerdown'); h.dispatch('pointerup'); h.dispatch('pointerdown', { shiftKey: true }); h.dispatch('pointerup', { shiftKey: true });
  assert.deepEqual(h.selections.at(-1), []); assert.equal(h.selected.at(-1), null);
  h.controller.selectMany(['actor', 'second']); const [clientX, clientY] = h.screen([20, 20]);
  h.dispatch('pointerdown', { clientX, clientY }); h.dispatch('pointerup', { clientX, clientY });
  assert.deepEqual(h.selections.at(-1), []); assert.equal(h.selected.at(-1), null);
});

test('a group drag keeps relative positions, highlights every actor and sends one batch commit', () => {
  const h = harness(groupFixture()); h.controller.setEditing(true); h.controller.setMultiSelect(true); h.controller.selectMany(['actor', 'second']);
  h.applyMoves(); h.controller.zoom(2); const [x, y] = h.screen();
  const original = JSON.stringify(h.model); h.dispatch('pointerdown'); h.calls.length = 0;
  h.dispatch('pointermove', { clientX: x + 24, clientY: y + 20 });
  assert.equal(h.moves.length + h.groups.length, 0); assert.equal(JSON.stringify(h.model), original);
  assert.ok(h.calls.some(([name, ...args]) => name === 'strokeRect' && JSON.stringify(args) === JSON.stringify([132.25, 198.75, 80, 64])));
  assert.ok(h.calls.some(([name, ...args]) => name === 'strokeRect' && JSON.stringify(args) === JSON.stringify([362.75, 226.25, 60, 48])));
  h.dispatch('pointermove', { clientX: x + 40, clientY: y + 20 }); h.dispatch('pointerup');
  assert.equal(h.moves.length, 0); assert.equal(h.groups.length, 1);
  assert.deepEqual(h.groups[0], { changes: [{ objectId: 'actor', position: [180.25, 230.75] }, { objectId: 'second', position: [400.75, 250.25] }], options: { commit: true } });
  assert.deepEqual(h.lastActorRect(), [140.25, 198.75, 80, 64]);
});

test('snapped group movement anchors the grabbed actor and preserves fractional spacing', () => {
  const h = harness(groupFixture()); h.controller.setEditing(true); h.controller.setMultiSelect(true); h.controller.setSnap(32); h.controller.selectMany(['actor', 'second']);
  const [x, y] = h.screen(h.model.actors[1].position); h.dispatch('pointerdown', { clientX: x, clientY: y });
  h.dispatch('pointermove', { clientX: x + 15, clientY: y + 13 }); h.dispatch('pointerup');
  assert.deepEqual(h.groups[0].changes, [{ objectId: 'second', position: [384, 256] }, { objectId: 'actor', position: [163.5, 236.5] }]);
  const [second, first] = h.groups[0].changes; assert.deepEqual([second.position[0] - first.position[0], second.position[1] - first.position[1]], [220.5, 19.5]);
  assert.deepEqual(h.selections.at(-1), ['actor', 'second']); assert.equal(h.selected.at(-1), 'second');
});

test('groups stop together at a coordinate boundary instead of squeezing their spacing', () => {
  const h = harness(groupFixture({ position: [99998.75, -99995.25] }));
  h.controller.setEditing(true); h.controller.setMultiSelect(true); h.controller.selectMany(['actor', 'second']);
  const [x, y] = h.screen(); h.dispatch('pointerdown'); h.dispatch('pointermove', { clientX: x + 40, clientY: y - 40 }); h.dispatch('pointerup');
  assert.deepEqual(h.groups[0].changes, [{ objectId: 'actor', position: [161.5, 216] }, { objectId: 'second', position: [100000, -100000] }]);
  assert.equal(h.moves.length, 0);
});

test('group arrow nudges emit a batch even with grid enabled and suppress fully clamped no-ops', () => {
  const h = harness(groupFixture()); h.controller.setEditing(true); h.controller.setMultiSelect(true); h.controller.selectMany(['actor', 'second']); h.controller.setSnap(32); h.applyMoves();
  h.dispatch('keydown', { key: 'ArrowRight' }); h.dispatch('keydown', { key: 'ArrowUp', shiftKey: true });
  assert.equal(h.moves.length, 0); assert.equal(h.groups.length, 2);
  assert.deepEqual(h.groups[1].changes, [{ objectId: 'actor', position: [161.25, 210.75] }, { objectId: 'second', position: [381.75, 230.25] }]);
  const edge = harness(groupFixture({ position: [100000, -100000] })); edge.controller.setEditing(true); edge.controller.setMultiSelect(true); edge.controller.selectMany(['actor', 'second']);
  edge.dispatch('keydown', { key: 'ArrowRight' }); edge.dispatch('keydown', { key: 'ArrowUp' }); assert.equal(edge.moves.length + edge.groups.length, 0);
});

test('all-selection shortcut belongs only to multi-selection canvases and leaves undo shortcuts alone', () => {
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const h = harness(groupFixture());
    assert.equal(h.dispatch('keydown', { key: 'a', [modifier]: true }).prevented, undefined); assert.equal(h.selected.length, 0);
    h.controller.setMultiSelect(true); const event = h.dispatch('keydown', { key: 'a', [modifier]: true });
    assert.equal(event.prevented, true); assert.equal(event.stopped, true); assert.deepEqual(h.selections.at(-1), ['actor', 'second', 'third']);
    assert.equal(h.dispatch('keydown', { key: 'z', [modifier]: true }).prevented, undefined);
    h.controller.setVisible(false); assert.equal(h.dispatch('keydown', { key: 'a', [modifier]: true }).prevented, undefined);
  }
});

test('readonly previews preserve single selection even with modifiers or selectMany calls', () => {
  const h = harness(groupFixture());
  h.dispatch('pointerdown'); h.dispatch('pointerup');
  const [clientX, clientY] = h.screen(h.model.actors[1].position);
  h.dispatch('pointerdown', { clientX, clientY, shiftKey: true }); h.dispatch('pointerup', { clientX, clientY, shiftKey: true });
  assert.deepEqual(h.selections.at(-1), ['second']);
  h.controller.selectMany(['actor', 'second']); h.calls.length = 0; h.controller.setGrid(false);
  assert.equal(h.calls.filter(([name, , , w]) => name === 'strokeRect' && w !== 800).length, 1);
});

test('group cancellation never commits and an idempotent selection refresh keeps an active drag', () => {
  const cancellations = [h => h.dispatch('keydown', { key: 'Escape' }), h => h.dispatch('blur'), h => h.dispatch('pointercancel'),
    h => h.dispatch('lostpointercapture'), h => h.controller.selectMany(['actor']), h => h.controller.setScene({ ...h.model }), h => h.controller.setMultiSelect(false)];
  for (const cancel of cancellations) {
    const h = harness(groupFixture()); h.controller.setEditing(true); h.controller.setMultiSelect(true); h.controller.selectMany(['actor', 'second']);
    const [x, y] = h.screen(); h.dispatch('pointerdown'); h.dispatch('pointermove', { clientX: x + 12, clientY: y });
    cancel(h); h.dispatch('pointerup'); assert.equal(h.moves.length + h.groups.length, 0); assert.deepEqual(h.lastActorRect(), [120.25, 188.75, 80, 64]);
  }
  const h = harness(groupFixture()); h.controller.setEditing(true); h.controller.setMultiSelect(true); h.controller.selectMany(['actor', 'second']);
  const [x, y] = h.screen(); h.dispatch('pointerdown'); h.dispatch('pointermove', { clientX: x + 12, clientY: y });
  h.controller.selectMany(['actor', 'second']); h.controller.setMultiSelect(true); h.controller.setScene(h.model); h.dispatch('pointerup');
  assert.equal(h.groups.length, 1);
});

test('middle, space and empty-area drags preserve the group while panning', () => {
  for (const mode of ['middle', 'space', 'blank']) {
    const h = harness(groupFixture()); h.controller.setEditing(true); h.controller.setMultiSelect(true); h.controller.selectMany(['actor', 'second']);
    const [x, y] = h.screen(mode === 'blank' ? [20, 20] : undefined), initial = h.controller.getView();
    if (mode === 'space') h.dispatch('keydown', { key: ' ' });
    const event = { clientX: x, clientY: y, button: mode === 'middle' ? 1 : 0 };
    h.dispatch('pointerdown', event); h.dispatch('pointermove', { ...event, clientX: x + 12 }); h.dispatch('pointerup', event);
    assert.equal(h.controller.getView().offsetX, initial.offsetX + 12); assert.equal(h.moves.length + h.groups.length, 0); assert.equal(h.selected.length, 0);
    h.dispatch('keyup', { key: ' ' }); h.dispatch('keydown', { key: 'ArrowRight' }); assert.equal(h.groups.length, 1);
  }
});

test('synchronous owner selection updates preserve group dragging and its independent primary actor', () => {
  const h = harness(groupFixture()); h.controller.setEditing(true); h.controller.setMultiSelect(true); h.controller.selectMany(['actor', 'second']); h.syncSelection();
  const [x, y] = h.screen(h.model.actors[1].position); h.dispatch('pointerdown', { clientX: x, clientY: y });
  h.dispatch('pointermove', { clientX: x + 12, clientY: y }); h.controller.selectMany(['actor', 'second']); h.dispatch('pointerup');
  assert.equal(h.groups.length, 1); assert.deepEqual(h.groups[0].changes.map(change => change.objectId), ['second', 'actor']);
  assert.deepEqual(h.selections.at(-1), ['actor', 'second']); assert.equal(h.selected.at(-1), 'second');
  h.dispatch('keydown', { key: 'a', ctrlKey: true }); assert.equal(h.selected.at(-1), 'second');
});

test('canvas hit tests, keyboard and group drags distinguish instances sharing one definition', () => {
  const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const original = fixture(), value = { ...original, actors: [{ ...original.actors[0], instanceId: first },
    { ...original.actors[0], instanceId: second, position: [380.75, 240.25] }] };
  const h = harness(value); h.controller.setEditing(true); h.controller.setMultiSelect(true);
  const [x, y] = h.screen(value.actors[1].position);
  h.dispatch('pointerdown', { clientX: x, clientY: y }); h.dispatch('pointerup', { clientX: x, clientY: y });
  assert.equal(h.selected.at(-1), second); h.dispatch('keydown', { key: 'ArrowRight' });
  assert.deepEqual(h.moves.at(-1), { id: second, position: [381.75, 240.25], options: { commit: true } });
  h.controller.selectMany([first, second]); h.dispatch('pointerdown', { clientX: x, clientY: y });
  h.dispatch('pointermove', { clientX: x + 20, clientY: y + 10 }); h.dispatch('pointerup', { clientX: x + 20, clientY: y + 10 });
  assert.deepEqual(h.groups.at(-1).changes, [{ objectId: second, position: [400.75, 250.25] }, { objectId: first, position: [180.25, 230.75] }]);
  assert.deepEqual(value.actors.map(actor => actor.position), [[160.25, 220.75], [380.75, 240.25]]);
});
