import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { dialogHarness } from './dialog-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
import { captureScenePhysics2DSpace, createScenePhysics2DSpaceView, isScenePhysics2DSpaceView } from '../../engine/scene-physics2d-space.mjs';
import { createScenePhysics2DOffsetProposal, isScenePhysics2DOffsetProposal, scenePhysics2DOffsetProposalMatches } from '../../engine/scene-physics2d-space-edit.mjs';
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
function observation({ absent = false, offset = [7, -3] } = {}) {
  const document = { format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: id(1), bodies: [
    { id: id(10), instanceId: id(200), kind: 'character', shape: { kind: 'box', size: [32, 48] }, offset, layer: 1, mask: 1 },
    { id: id(11), instanceId: id(201), kind: 'sensor', shape: { kind: 'circle', radius: 15 }, offset: [-5, 10], layer: 1, mask: 1 },
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
    createScenePhysics2DOffsetProposal: (view, body, delta) => createScenePhysics2DOffsetProposal(view, body, copy(delta)),
    t: (key, ...args) => (({ en, ja }[language]?.[key]) || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')),
  });
  const root = h.document.createElement('section'); h.document.body.append(root);
  const selections = [], proposals = [], captures = [], releases = [], renderer = h.runtime.setupScenePhysics2DSpace({ root,
    onSelect: value => selections.push(value), onOffsetProposal: value => { proposals.push(value); return options.accept !== false; },
  });
  const view = observation(options), state = { selected: id(10), enabled: true, mode: 'offset' };
  renderer.render(view, state); const stage = root.querySelector('[data-space-stage]');
  stage.setPointerCapture = pointer => captures.push(pointer); stage.releasePointerCapture = pointer => releases.push(pointer);
  let transform = matrix(); const attach = () => { root.querySelector('svg').getScreenCTM = () => transform; }; attach();
  const shape = number => root.querySelector(`[data-space-body="${id(number)}"]`), button = action => root.querySelector(`[data-space-action="${action}"]`);
  const event = (type, x = 300, y = 300, properties = {}) => stage.dispatch(type, { pointerId: 1, clientX: x, clientY: y, button: 0, isPrimary: true, ...properties });
  const start = (number = 10, properties = {}) => shape(number).dispatch('pointerdown', { pointerId: 1, clientX: 300, clientY: 300, button: 0, isPrimary: true, ...properties });
  return { ...h, root, stage, state, view, renderer, proposals, selections, captures, releases, shape, button, event, start,
    ghost: () => root.querySelector('[data-space-ghost]'), status: () => root.querySelector('.scene-physics2d-space-interaction').textContent,
    render(next = view, changes = {}) { Object.assign(state, changes); renderer.render(next, state); attach(); },
    language(value) { language = value; renderer.render(view, state); },
    transform(value) { transform = value; }, box: () => root.querySelector('svg').getAttribute('viewBox').split(' ').map(Number),
  };
}

test('offset drag displays only a ghost and emits a checked exact-view proposal on pointerup', async () => {
  const h = await fixture(), original = h.shape(10).getAttribute('x');
  h.start(); h.event('pointermove', 320, 290); assert.equal(h.proposals.length, 0); assert.equal(h.shape(10).getAttribute('x'), original);
  assert.equal(h.ghost().getAttribute('x'), '81'); assert.equal(h.ghost().getAttribute('y'), '88'); assert.match(h.status(), /X 17，Y -8/);
  h.event('pointerup', 320, 290); assert.equal(h.ghost(), null); assert.equal(h.proposals.length, 1); const proposal = h.proposals[0];
  assert.equal(isScenePhysics2DOffsetProposal(proposal), true); assert.equal(scenePhysics2DOffsetProposalMatches(proposal, h.view, id(10), [7, -3]), true);
  assert.deepEqual(proposal.offset, [17, -8]); assert.deepEqual(proposal.center, [97, 112]); assert.deepEqual(h.view.bodies[0].offset, [7, -3]);
  assert.deepEqual(h.captures, [1]); assert.deepEqual(h.releases, [1]); assert.equal(h.shape(10).getAttribute('x'), original);
});

test('inverse CTM handles translation scale skew and end-only pointer movement', async () => {
  const h = await fixture(); h.transform(matrix(2, .5, .25, 3, 140, 90)); h.start(); h.event('pointerup', 319, 293);
  for (const [axis, value] of [10, -4].entries()) assert.ok(Math.abs(h.proposals[0].delta[axis] - value) < 1e-10);
  for (const [axis, value] of [17, -7].entries()) assert.ok(Math.abs(h.proposals[0].offset[axis] - value) < 1e-10);
  assert.equal(h.ghost(), null);
});

test('circle ghost uses selected instance offset and never changes another repeated definition instance', async () => {
  const h = await fixture(); h.render(h.view, { selected: id(11) }); h.start(11); h.event('pointermove', 300, 320);
  assert.equal(h.ghost().tagName, 'CIRCLE'); assert.equal(h.ghost().getAttribute('cx'), '495'); assert.equal(h.ghost().getAttribute('cy'), '-20');
  h.event('pointerup', 300, 320); assert.deepEqual(h.proposals[0].offset, [-5, 20]); assert.equal(h.proposals[0].instanceId, id(201));
  assert.deepEqual(h.view.bodies[0].offset, [7, -3]);
});

test('view mode and unselected bodies only select while tiny pointer jitter changes no fields', async () => {
  const h = await fixture(); h.render(h.view, { mode: 'view' }); h.start(); h.event('pointerup', 340, 300); assert.equal(h.captures.length, 0); h.shape(11).click(); assert.deepEqual(h.selections, [id(11)]);
  h.render(h.view, { mode: 'offset' }); h.start(11); h.event('pointerup', 340, 300); assert.equal(h.captures.length, 0); h.shape(11).click(); assert.equal(h.selections.length, 2);
  h.start(); h.event('pointermove', 303, 300); h.event('pointerup', 303, 300); assert.equal(h.proposals.length, 0); assert.equal(h.ghost(), null);
  h.start(); h.event('pointermove', 340, 300); h.event('pointerup', 300, 300); assert.equal(h.proposals.length, 0);
});

test('pointer ownership ignores other pointers non-primary mouse buttons and modified starts', async () => {
  const h = await fixture(); for (const fields of [{ button: 1 }, { button: 2 }, { isPrimary: false }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) { h.start(10, fields); h.event('pointerup', 340, 300); }
  assert.equal(h.captures.length, 0); h.start(); h.event('pointermove', 340, 300, { pointerId: 2 }); h.event('pointerup', 340, 300, { pointerId: 2 });
  assert.equal(h.ghost(), null); assert.equal(h.proposals.length, 0); h.event('pointermove', 340, 300); assert.ok(h.ghost()); h.event('pointerup', 340, 300); assert.equal(h.proposals.length, 1);
});

test('cancel lost capture Escape blur and clear discard ghosts and every late callback', async () => {
  for (const action of [h => h.event('pointercancel'), h => h.event('lostpointercapture'), h => h.stage.dispatch('keydown', { key: 'Escape' }), h => h.stage.dispatch('blur'), h => h.renderer.clear()]) {
    const h = await fixture(); h.start(); h.event('pointermove', 340, 300); assert.ok(h.ghost()); action(h); assert.equal(h.ghost(), null); h.event('pointerup', 340, 300); assert.equal(h.proposals.length, 0);
  }
  const h = await fixture(); assert.equal(h.stage.dispatch('keydown', { key: 'Escape' }).defaultPrevented, undefined);
  h.start(); const escape = h.stage.dispatch('keydown', { key: 'Escape' }); assert.equal(escape.defaultPrevented, true); assert.equal(escape.stopped, true);
});

test('source view selection mode disable and layout changes cancel an in-progress gesture', async () => {
  for (const action of [h => h.render(observation()), h => h.render(h.view, { selected: id(11) }), h => h.render(h.view, { mode: 'view' }), h => h.render(h.view, { enabled: false }), h => h.transform(matrix(3)), h => h.transform(matrix(2, 0, 0, 2, 121, 80))]) {
    const h = await fixture(); h.start(); h.event('pointermove', 340, 300); assert.ok(h.ghost()); action(h); h.event('pointerup', 340, 300); assert.equal(h.ghost(), null); assert.equal(h.proposals.length, 0);
  }
});

test('missing singular detached or nonfinite CTM and failed pointer capture cannot start writes', async () => {
  for (const transform of [null, matrix(0, 0, 0, 0), matrix(2, 0, 0, 2, NaN, 0), { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse() { throw Error('detached'); } }]) {
    const h = await fixture(); h.transform(transform); h.start(); h.event('pointerup', 340, 300); assert.equal(h.captures.length, 0); assert.equal(h.proposals.length, 0); assert.match(h.status(), /无法读取/);
  }
  for (const capture of [undefined, () => { throw Error('lost'); }]) { const h = await fixture(); h.stage.setPointerCapture = capture; h.start(); h.event('pointerup', 340, 300); assert.equal(h.proposals.length, 0); }
  const failed = await fixture(); failed.stage.hasPointerCapture = () => false; failed.start(); failed.event('pointerup', 340, 300); assert.equal(failed.proposals.length, 0);
  const h = await fixture(); h.start(); h.event('pointermove', Infinity, 300); h.event('pointerup', 340, 300); assert.equal(h.proposals.length, 0);
});

test('out-of-range ghosts are rejected without clamping and moving back remains recoverable', async () => {
  const h = await fixture({ offset: [8190, -3] }); h.start(); h.event('pointermove', 310, 300); assert.equal(h.ghost(), null); assert.match(h.status(), /数值范围/); h.event('pointerup', 310, 300); assert.equal(h.proposals.length, 0); assert.match(h.status(), /数值范围/);
  h.start(); h.event('pointermove', 310, 300); h.event('pointermove', 296, 300); assert.ok(h.ghost()); h.event('pointerup', 296, 300); assert.deepEqual(h.proposals[0].offset, [8188, -3]);
});

test('accessible buttons and focused stage arrow keys emit exact 1 or Shift 10 proposals', async () => {
  const h = await fixture(); h.button('move-right').click(); assert.deepEqual(h.proposals.at(-1).offset, [8, -3]);
  h.button('move-up').dispatch('click', { shiftKey: true }); assert.deepEqual(h.proposals.at(-1).offset, [7, -13]);
  const key = h.stage.dispatch('keydown', { key: 'ArrowLeft', shiftKey: true }); assert.equal(key.defaultPrevented, true); assert.deepEqual(h.proposals.at(-1).offset, [-3, -3]);
  for (const options of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { target: h.button('move-right') }]) h.stage.dispatch('keydown', { key: 'ArrowRight', ...options });
  assert.equal(h.proposals.length, 3); h.render(h.view, { mode: 'view' }); h.button('move-right').dispatch('click'); h.stage.dispatch('keydown', { key: 'ArrowLeft' }); assert.equal(h.proposals.length, 3);
  h.render(h.view, { mode: 'offset', enabled: false }); h.button('move-right').dispatch('click'); h.stage.dispatch('keydown', { key: 'ArrowLeft' }); assert.equal(h.proposals.length, 3);
});

test('navigation fits all focuses known shapes and bounds zoom without editing fields', async () => {
  const h = await fixture(), initial = h.box(); h.button('zoom-in').click(); assert.ok(h.box()[2] < initial[2]); h.button('zoom-out').click(); h.box().forEach((value, index) => assert.ok(Math.abs(value - initial[index]) < 1e-10));
  h.button('focus').click(); assert.deepEqual(h.box(), [23, 21, 128, 192]);
  for (let index = 0; index < 100; index++) h.button('zoom-in').click(); assert.ok(h.box()[2] >= initial[2] / 64);
  for (let index = 0; index < 200; index++) h.button('zoom-out').click(); assert.ok(h.box()[2] <= initial[2] * 16);
  h.button('fit').click(); assert.deepEqual(h.box(), initial); assert.deepEqual(h.proposals, []); assert.deepEqual(h.selections, []);
  for (const action of ['zoom-in', 'zoom-out', 'fit', 'focus']) { h.start(); h.event('pointermove', 340, 300); h.button(action).click(); h.event('pointerup', 340, 300); assert.equal(h.proposals.length, 0); assert.equal(h.ghost(), null); }
});

test('missing targets remain selectable but cannot be focused nudged or dragged to an invented position', async () => {
  const h = await fixture({ absent: true }); h.render(h.view, { selected: id(11) }); assert.equal(h.shape(11), null); assert.equal(h.button('focus').disabled, true); assert.equal(h.button('move-right').disabled, true);
  h.button('move-right').dispatch('click'); h.stage.dispatch('keydown', { key: 'ArrowLeft' }); assert.equal(h.proposals.length, 0);
  h.root.querySelector(`[data-space-choice="${id(11)}"]`).click(); assert.deepEqual(h.selections, [id(11)]);
});

test('ordinary redraw preserves camera focus and pending gesture while completed drags suppress a synthesized click', async () => {
  const h = await fixture(); h.button('zoom-in').click(); const zoom = h.box(), button = h.button('move-right'); button.focus(); h.render(); assert.deepEqual(h.box(), zoom); assert.equal(h.document.activeElement, button);
  h.start(); h.event('pointermove', 340, 300); h.render(); assert.ok(h.ghost()); h.event('pointerup', 340, 300); h.shape(10).click(); assert.equal(h.selections.length, 0); h.shape(10).click(); assert.deepEqual(h.selections, [id(10)]);
});

test('rejected host proposal leaves geometry unchanged and reports a stale field boundary', async () => {
  const h = await fixture({ accept: false }), x = h.shape(10).getAttribute('x'); h.start(); h.event('pointerup', 340, 300); assert.equal(h.shape(10).getAttribute('x'), x); assert.match(h.status(), /字段已变化/);
});

test('renderer accepts only branded geometry and contains no source or runtime authority', async () => {
  const h = await fixture(); h.start(); h.event('pointermove', 340, 300); h.renderer.render({ ...h.view }, h.state); h.event('pointerup', 340, 300); assert.equal(h.root.hidden, true); assert.equal(h.proposals.length, 0);
  const source = await fs.readFile(new URL('../../web/modules/app-scene-physics2d-space.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|requestWorldCommand|applyDraft|Image|canvas|requestAnimationFrame)\s*\(/);
  assert.match(source, /getScreenCTM/); assert.match(source, /\.inverse\(\)/); assert.match(source, /createScenePhysics2DOffsetProposal/);
});


test('a second pointer anywhere cancels instead of retaining a stale first-pointer gesture', async () => {
  for (const second of [h => h.start(11, { pointerId: 2, isPrimary: false }), h => h.event('pointerdown', 400, 400, { pointerId: 2, isPrimary: false })]) {
    const h = await fixture(); h.start(); h.event('pointermove', 340, 300); second(h); h.event('pointerup', 340, 300); assert.equal(h.proposals.length, 0); assert.equal(h.ghost(), null);
  }
  const h = await fixture(); h.start(); h.event('pointermove', 340, 300, { buttons: 0 }); h.event('pointerup', 340, 300); assert.equal(h.proposals.length, 0);
});

test('window blur and document hiding cancel and remove gesture-only global listeners', async () => {
  for (const name of ['blur', 'visibilitychange']) {
    const h = await fixture(), listeners = new Map();
    const add = (event, callback) => listeners.set(event, callback), remove = (event, callback) => { if (listeners.get(event) === callback) listeners.delete(event); };
    h.document.defaultView = { addEventListener: add, removeEventListener: remove }; h.document.addEventListener = add; h.document.removeEventListener = remove;
    assert.equal(listeners.size, 0); h.start(); h.event('pointermove', 340, 300); assert.equal(listeners.size, 2);
    h.document.hidden = true; listeners.get(name)(); assert.equal(listeners.size, 0); assert.equal(h.ghost(), null); h.event('pointerup', 340, 300); assert.equal(h.proposals.length, 0);
    h.document.hidden = false; h.start(); h.event('pointerup', 340, 300); assert.equal(listeners.size, 0); assert.equal(h.proposals.length, 1);
  }
});

test('adjust mode raises selected geometry above overlaps while retaining every control identity', async () => {
  const h = await fixture(), selectedShape = h.shape(10), other = h.shape(11);
  assert.equal(h.root.querySelector('svg').lastElementChild, selectedShape); h.render(h.view, { selected: id(11) });
  assert.equal(h.root.querySelector('svg').lastElementChild, other); assert.equal(h.shape(10), selectedShape); assert.equal(h.root.querySelectorAll('[data-space-body]').length, 2);
});


test('navigation and offset controls translate without replacing focused controls or changing geometry', async () => {
  const h = await fixture(), button = h.button('move-right'), label = button.textContent; button.focus(); const initial = h.box();
  for (const language of ['en', 'ja']) { h.language(language); assert.equal(h.button('move-right'), button); assert.equal(h.document.activeElement, button); assert.notEqual(button.textContent, label); assert.deepEqual(h.box(), initial); }
  h.language('zh'); assert.equal(button.textContent, label); assert.equal(h.proposals.length, 0);
  for (const key of ['放大空间图', '缩小空间图', '显示全部', '聚焦选中碰撞体', '向左调整偏移', '向上调整偏移', '向下调整偏移', '向右调整偏移']) { assert.ok(en[key], 'en: ' + key); assert.ok(ja[key], 'ja: ' + key); }
});
