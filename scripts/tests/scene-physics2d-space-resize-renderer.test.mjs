import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { dialogHarness } from './dialog-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
import { captureScenePhysics2DSpace, createScenePhysics2DSpaceView, isScenePhysics2DSpaceView } from '../../engine/scene-physics2d-space.mjs';
import { createScenePhysics2DResizeProposal, isScenePhysics2DResizeProposal, scenePhysics2DResizeProposalMatches } from '../../engine/scene-physics2d-space-resize.mjs';
import { createScenePhysics2DOffsetProposal, isScenePhysics2DOffsetProposal, scenePhysics2DOffsetProposalMatches } from '../../engine/scene-physics2d-space-edit.mjs';
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
function observation({ absent = false, offset = [7, -3], box = [32, 48], radius = 15 } = {}) {
  const document = { format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: id(1), bodies: [
    { id: id(10), instanceId: id(200), kind: 'character', shape: { kind: 'box', size: box }, offset, layer: 1, mask: 1 },
    { id: id(11), instanceId: id(201), kind: 'sensor', shape: { kind: 'circle', radius }, offset: [-5, 10], layer: 1, mask: 1 },
  ] }, content = JSON.stringify(document);
  const source = { sourcePath: 'documents/physics/demo.json', token: 'source:1', content, sourceRevision: hash(content), baseSourceRevision: hash(content) };
  const raw = { format: 'viento-scene-physics2d-space', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: hash('world'),
    scene: { objectId: id(1), sourcePath: 'documents/scenes/demo.json', sourceRevision: hash('scene'), title: 'Saved scene', viewport: [320, 240], background: '#172839' },
    actors: [200, ...(absent ? [] : [201])].map((n, i) => ({ instanceId: id(n), objectId: id(9000), name: 'Repeated actor', sourcePath: 'documents/actors/actor.json', sourceRevision: hash('actor'), position: [[80, 120], [500, -40]][i], size: [40, 60], color: '#556677' })),
  };
  return createScenePhysics2DSpaceView(captureScenePhysics2DSpace(source, raw), document);
}
function matrix(a = 2, b = 0, c = 0, d = 2, e = 120, f = 80) {
  return { a, b, c, d, e, f, inverse() { const det = a * d - b * c; return { a: d / det, b: -b / det, c: -c / det, d: a / det, e: (c * f - d * e) / det, f: (b * e - a * f) / det }; } };
}
async function fixture(options = {}) {
  let language = 'zh';
  const h = await dialogHarness('app-scene-physics2d-space', { isScenePhysics2DSpaceView,
    createScenePhysics2DResizeProposal: (view, body, delta) => createScenePhysics2DResizeProposal(view, body, copy(delta)),
    createScenePhysics2DOffsetProposal: (view, body, delta) => createScenePhysics2DOffsetProposal(view, body, copy(delta)),
    t: (key, ...args) => (({ en, ja }[language]?.[key]) || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')),
  });
  if (options.ResizeObserver) h.document.defaultView = { ResizeObserver: options.ResizeObserver };
  const root = h.document.createElement('section'); h.document.body.append(root);
  const selections = [], proposals = [], offsets = [], captures = [], releases = [], renderer = h.runtime.setupScenePhysics2DSpace({ root,
    onSelect: value => selections.push(value), onOffsetProposal: value => { offsets.push(value); return true; }, onResizeProposal: value => { proposals.push(value); return options.accept !== false; },
  });
  const view = observation(options), state = { selected: id(10), enabled: true, mode: 'resize' };
  renderer.render(view, state); const stage = root.querySelector('[data-space-stage]');
  stage.setPointerCapture = pointer => captures.push(pointer); stage.releasePointerCapture = pointer => releases.push(pointer);
  let transform = matrix(); const attach = () => { root.querySelector('svg').getScreenCTM = () => transform; }; attach();
  const shape = number => root.querySelector(`[data-space-body="${id(number)}"]`), button = action => root.querySelector(`[data-space-action="${action}"]`);
  const event = (type, x = 300, y = 300, properties = {}) => stage.dispatch(type, { pointerId: 1, clientX: x, clientY: y, button: 0, isPrimary: true, ...properties });
  const startBody = (number = 10, properties = {}) => shape(number).dispatch('pointerdown', { pointerId: 1, clientX: 300, clientY: 300, button: 0, isPrimary: true, ...properties });
  const handle = key => root.querySelector(`[data-space-resize-handle="${key}"]`);
  const start = (key = 'e', properties = {}) => handle(key).dispatch('pointerdown', { pointerId: 1, clientX: 300, clientY: 300, button: 0, isPrimary: true, ...properties });
  return { ...h, root, stage, state, view, renderer, proposals, offsets, selections, captures, releases, shape, button, event, start, startBody, handle,
    ghost: () => root.querySelector('[data-space-ghost]'), status: () => root.querySelector('.scene-physics2d-space-interaction').textContent,
    render(next = view, changes = {}) { Object.assign(state, changes); renderer.render(next, state); attach(); },
    language(value) { language = value; renderer.render(view, state); },
    transform(value) { transform = value; }, box: () => root.querySelector('svg').getAttribute('viewBox').split(' ').map(Number),
  };
}

test('resize mode exposes only selected shape handles with stable screen-space hit areas', async () => {
  const h = await fixture(); assert.equal(h.root.querySelectorAll('[data-space-resize-handle]').length, 3);
  for (const [key, x, y] of [['e', 103, 117], ['s', 87, 141], ['se', 103, 141]]) {
    const handle = h.handle(key); assert.equal(handle.dataset.bodyId, id(10)); const hit = handle.querySelector('circle');
    assert.equal(Number(hit.getAttribute('cx')), x); assert.equal(Number(hit.getAttribute('cy')), y); assert.equal(hit.getAttribute('vector-effect'), 'non-scaling-stroke');
  }
  assert.equal(h.button('width-more').hidden, false); assert.equal(h.button('height-less').hidden, false); assert.equal(h.button('radius-more').hidden, true);
  h.render(h.view, { selected: id(11) }); assert.equal(h.root.querySelectorAll('[data-space-resize-handle]').length, 1); assert.equal(h.handle('e').dataset.bodyId, id(11));
  assert.equal(h.button('width-more').hidden, true); assert.equal(h.button('radius-more').hidden, false);
});

test('box east south and corner gestures resize about the original center using twice the scene-space pointer delta', async () => {
  for (const [handle, expected] of [['e', [52, 48]], ['s', [32, 38]], ['se', [52, 38]]]) {
    const h = await fixture(), original = copy(h.view.bodies[0]); h.start(handle); h.event('pointermove', 320, 290);
    assert.equal(h.proposals.length, 0); assert.equal(h.offsets.length, 0); assert.equal(h.shape(10).getAttribute('width'), '32'); assert.equal(h.shape(10).getAttribute('height'), '48');
    assert.equal(h.ghost().dataset.operation, 'resize'); assert.equal(h.ghost().getAttribute('width'), String(expected[0])); assert.equal(h.ghost().getAttribute('height'), String(expected[1]));
    assert.equal(Number(h.ghost().getAttribute('x')) + expected[0] / 2, 87); assert.equal(Number(h.ghost().getAttribute('y')) + expected[1] / 2, 117);
    h.event('pointerup', 320, 290); const proposal = h.proposals[0]; assert.equal(isScenePhysics2DResizeProposal(proposal), true);
    assert.equal(scenePhysics2DResizeProposalMatches(proposal, h.view, id(10), original.shape), true); assert.deepEqual(proposal.shape.size, expected); assert.deepEqual(proposal.center, original.center);
    assert.deepEqual(h.view.bodies[0], original); assert.equal(h.offsets.length, 0); assert.equal(h.ghost(), null);
  }
});

test('circle east gesture changes radius by horizontal delta and preserves its center offset and repeated-definition siblings', async () => {
  const h = await fixture(); h.render(h.view, { selected: id(11) }); const before = copy(h.view); h.start('e'); h.event('pointermove', 320, 340);
  assert.equal(h.ghost().tagName, 'CIRCLE'); assert.equal(h.ghost().getAttribute('r'), '25'); assert.equal(h.ghost().getAttribute('cx'), '495'); assert.equal(h.ghost().getAttribute('cy'), '-30');
  h.event('pointerup', 320, 340); assert.deepEqual(h.proposals[0].shape, { kind: 'circle', radius: 25 }); assert.deepEqual(h.proposals[0].delta, [10]); assert.equal(h.proposals[0].instanceId, id(201));
  assert.deepEqual(copy(h.view), before); assert.equal(h.offsets.length, 0);
});

test('a handle uses grab displacement under inverse CTM and never jumps to a guessed initial edge', async () => {
  const h = await fixture(); h.transform(matrix(2, .5, .25, 3, 140, 90)); h.start('se', { clientX: 313, clientY: 287 }); h.event('pointerup', 332, 280);
  assert.ok(Math.abs(h.proposals[0].shape.size[0] - 52) < 1e-10); assert.ok(Math.abs(h.proposals[0].shape.size[1] - 40) < 1e-10);
  assert.deepEqual(h.proposals[0].center, [87, 117]);
});

test('body dragging remains selection-only in resize mode and hidden or stale handles cannot acquire editing authority', async () => {
  const h = await fixture(); h.startBody(); h.event('pointerup', 340, 300); assert.equal(h.captures.length, 0); h.shape(11).click(); assert.deepEqual(h.selections, [id(11)]);
  const old = h.handle('e'); h.render(h.view, { selected: id(11) }); old.dispatch('pointerdown', { pointerId: 1, clientX: 300, clientY: 300, button: 0 }); h.event('pointerup', 340, 300); assert.equal(h.proposals.length, 0);
  h.render(h.view, { mode: 'view' }); assert.equal(h.handle('e'), null); h.button('width-more').dispatch('click'); h.stage.dispatch('keydown', { key: 'ArrowRight' }); assert.equal(h.proposals.length, 0);
  h.render(h.view, { mode: 'offset' }); assert.equal(h.handle('e'), null); h.button('radius-more').dispatch('click'); assert.equal(h.proposals.length, 0);
});

test('size buttons use full dimension units while Shift and arrows preserve shape-specific semantics', async () => {
  const h = await fixture(); h.button('width-more').click(); assert.deepEqual(h.proposals.at(-1).shape.size, [33, 48]);
  h.button('height-less').dispatch('click', { shiftKey: true }); assert.deepEqual(h.proposals.at(-1).shape.size, [32, 38]);
  for (const [key, expected] of [['ArrowLeft', [31, 48]], ['ArrowRight', [33, 48]], ['ArrowUp', [32, 47]], ['ArrowDown', [32, 49]]]) {
    const event = h.stage.dispatch('keydown', { key }); assert.equal(event.defaultPrevented, true); assert.deepEqual(h.proposals.at(-1).shape.size, expected);
  }
  const count = h.proposals.length;
  for (const properties of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { target: h.button('width-more') }]) h.stage.dispatch('keydown', { key: 'ArrowRight', ...properties });
  assert.equal(h.proposals.length, count); h.render(h.view, { selected: id(11) });
  h.button('radius-more').dispatch('click', { shiftKey: true }); assert.equal(h.proposals.at(-1).shape.radius, 25);
  for (const [key, expected] of [['ArrowLeft', 14], ['ArrowUp', 14], ['ArrowRight', 16], ['ArrowDown', 16]]) { h.stage.dispatch('keydown', { key }); assert.equal(h.proposals.at(-1).shape.radius, expected); }
  assert.equal(h.offsets.length, 0);
});

test('range failures reject without clamping keep released feedback and allow a later valid gesture', async () => {
  for (const [options, selected, handle, x, y] of [[{}, 10, 'e', 260, 300], [{ box: [8190, 48] }, 10, 'e', 310, 300], [{ radius: 2 }, 11, 'e', 290, 300]]) {
    const h = await fixture(options); h.render(h.view, { selected: id(selected) }); h.start(handle); h.event('pointermove', x, y); assert.equal(h.ghost(), null); assert.match(h.status(), /数值范围/);
    h.event('pointerup', x, y); assert.equal(h.proposals.length, 0); assert.match(h.status(), /数值范围/); assert.equal(h.offsets.length, 0);
  }
  const h = await fixture(); h.start('e'); h.event('pointermove', 260, 300); h.event('pointermove', 310, 300); assert.ok(h.ghost()); h.event('pointerup', 310, 300); assert.deepEqual(h.proposals[0].shape.size, [42, 48]);
});

test('jitter perpendicular movement and returning to the starting point emit no shape change', async () => {
  for (const [handle, x, y] of [['e', 303, 300], ['e', 300, 350], ['s', 350, 300]]) {
    const h = await fixture(); h.start(handle); h.event('pointerup', x, y); assert.equal(h.proposals.length, 0);
  }
  const h = await fixture(); h.start('se'); h.event('pointermove', 340, 340); h.event('pointerup', 300, 300); assert.equal(h.proposals.length, 0);
});

test('every cancellation and view transition discards a resize ghost and late pointerup', async () => {
  for (const cancel of [h => h.event('pointercancel'), h => h.event('lostpointercapture'), h => h.stage.dispatch('keydown', { key: 'Escape' }), h => h.stage.dispatch('blur'),
    h => h.renderer.clear(), h => h.render(observation()), h => h.render(h.view, { selected: id(11) }), h => h.render(h.view, { enabled: false }), h => h.render(h.view, { mode: 'offset' }),
    h => h.transform(matrix(3)), h => h.button('focus').click(), h => h.button('zoom-in').click(), h => h.button('fit').click(),
    h => h.event('pointerdown', 400, 400, { pointerId: 2, isPrimary: false })]) {
    const h = await fixture(); h.start('se'); h.event('pointermove', 340, 340); assert.ok(h.ghost()); cancel(h); h.event('pointerup', 340, 340); assert.equal(h.ghost(), null); assert.equal(h.proposals.length, 0); assert.equal(h.offsets.length, 0);
  }
});

test('mode changes cancel old resize callbacks and leave the original offset interaction independent', async () => {
  const h = await fixture(); h.start('se'); h.event('pointermove', 340, 340); h.render(h.view, { mode: 'offset' }); h.event('pointerup', 340, 340); assert.equal(h.proposals.length, 0);
  h.startBody(); h.event('pointerup', 320, 300); assert.equal(h.offsets.length, 1); assert.deepEqual(h.offsets[0].offset, [17, -3]); assert.equal(isScenePhysics2DOffsetProposal(h.offsets[0]), true);
  h.render(h.view, { mode: 'resize' }); h.button('move-right').dispatch('click'); assert.equal(h.offsets.length, 1); h.button('width-more').click(); assert.equal(h.proposals.length, 1);
});

test('missing instances are selectable declarations but have no resize handles or nudge authority', async () => {
  const h = await fixture({ absent: true }); h.render(h.view, { selected: id(11) }); assert.equal(h.handle('e'), null); assert.equal(h.button('width-more').disabled, true);
  h.button('width-more').dispatch('click'); h.stage.dispatch('keydown', { key: 'ArrowRight' }); assert.equal(h.proposals.length, 0);
  h.root.querySelector(`[data-space-choice="${id(11)}"]`).click(); assert.deepEqual(h.selections, [id(11)]);
});

test('disabled or captureless gestures do not leak proposals and same-view redraw preserves live handle identity', async () => {
  const h = await fixture(), handle = h.handle('se'); h.start('se'); h.event('pointermove', 340, 340); h.render(); assert.equal(h.handle('se'), handle); assert.ok(h.ghost()); h.event('pointerup', 340, 340); assert.equal(h.proposals.length, 1);
  h.render(h.view, { enabled: false }); h.start('se'); h.event('pointerup', 340, 340); assert.equal(h.proposals.length, 1);
  h.render(h.view, { enabled: true }); h.stage.hasPointerCapture = () => false; h.start('se'); h.event('pointerup', 340, 340); assert.equal(h.proposals.length, 1);
});

test('unavailable or rejected proposal paths keep the original geometry and show feedback', async () => {
  const h = await fixture({ accept: false }); h.start('se'); h.event('pointerup', 340, 340); assert.equal(h.shape(10).getAttribute('width'), '32'); assert.match(h.status(), /字段已变化/);
  h.runtime.createScenePhysics2DResizeProposal = () => { throw Object.assign(Error('core'), { errorCode: 'studio_core_unavailable' }); };
  h.button('width-more').click(); assert.match(h.status(), /物理内核/); assert.equal(h.proposals.length, 1); assert.equal(h.offsets.length, 0);
});

test('size controls and instructions translate without replacing focus or changing geometry', async () => {
  const h = await fixture(), button = h.button('width-more'), label = button.textContent, handle = h.handle('se'), geometry = copy(h.view); button.focus();
  for (const language of ['en', 'ja']) { h.language(language); assert.equal(h.button('width-more'), button); assert.equal(h.document.activeElement, button); assert.equal(h.handle('se'), handle); assert.notEqual(button.textContent, label); }
  h.language('zh'); assert.equal(button.textContent, label); assert.deepEqual(copy(h.view), geometry); assert.equal(h.proposals.length, 0);
  for (const key of ['减小宽度', '增大宽度', '减小高度', '增大高度', '减小半径', '增大半径']) { assert.ok(en[key], 'en: ' + key); assert.ok(ja[key], 'ja: ' + key); }
});


test('handles have real filled area scaled to CSS pixels through render and navigation', async () => {
  const h = await fixture(); h.render(); const hit = () => Number(h.handle('e').children[0].getAttribute('r')), knob = () => Number(h.handle('e').children[1].getAttribute('r'));
  assert.equal(hit(), 7); assert.equal(knob(), 3);
  for (const action of ['zoom-in', 'zoom-out', 'fit', 'focus']) {
    h.transform(matrix(4, 0, 0, 4)); h.button(action).click(); assert.equal(hit(), 3.5); assert.equal(knob(), 1.5); assert.equal(hit() * 4 * 2, 28);
    h.transform(matrix(.5, 0, 0, .5)); h.render(); assert.equal(hit(), 28); assert.equal(knob(), 12); assert.equal(hit() * .5 * 2, 28);
  }
  h.transform(matrix(4, 0, 0, 2)); h.render(); assert.equal(hit(), 7); assert.equal(hit() * 2, 14);
  const css = await fs.readFile(new URL('../../web/scene-physics2d.css', import.meta.url), 'utf8');
  assert.match(css, /scene-physics2d-space-resize-hit\{fill:transparent;stroke:none;pointer-events:all/); assert.match(css, /scene-physics2d-space-resize-knob\{fill:#fff/);
});

test('container resizing updates physical handle size cancels changed CTM gestures and disconnects cleanly', async () => {
  const observers = [];
  class ResizeObserver { constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); } observe(target) { this.target = target; } disconnect() { this.disconnected = true; } }
  const h = await fixture({ ResizeObserver }); assert.equal(observers.length, 1); assert.equal(observers[0].target, h.stage);
  h.start('e'); h.event('pointermove', 320, 300); observers[0].callback(); assert.ok(h.ghost(), 'initial unchanged resize observation does not discard a valid gesture');
  h.transform(matrix(4, 0, 0, 4)); observers[0].callback(); assert.equal(h.ghost(), null); assert.equal(Number(h.handle('e').children[0].getAttribute('r')), 3.5);
  h.event('pointerup', 320, 300); assert.equal(h.proposals.length, 0);
  h.renderer.clear(); assert.equal(observers[0].disconnected, true); observers[0].callback(); assert.equal(h.root.hidden, true); assert.equal(h.proposals.length, 0);
  h.render(); assert.equal(observers.length, 2); observers[0].callback(); assert.equal(h.root.hidden, false); h.renderer.clear(); assert.equal(observers[1].disconnected, true);
});
