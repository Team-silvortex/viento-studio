import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { readScenePhysics2DDocument, createScenePhysics2DProposal, isScenePhysics2DProposal } from '../../engine/scene-physics2d-edit.mjs';
import { captureScenePhysics2DSpace, isScenePhysics2DSpace, scenePhysics2DSpaceMatchSource, createScenePhysics2DSpaceView } from '../../engine/scene-physics2d-space.mjs';
import { createScenePhysics2DOffsetProposal, isScenePhysics2DOffsetProposal, scenePhysics2DOffsetProposalMatches } from '../../engine/scene-physics2d-space-edit.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const model = () => ({ format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: id(1), bodies: [
  { id: id(10), instanceId: id(200), kind: 'character', shape: { kind: 'box', size: [32, 48] }, offset: [7, -3], layer: 1, mask: 1 },
  { id: id(11), instanceId: id(201), kind: 'static', shape: { kind: 'circle', radius: 15 }, offset: [-5, 10], layer: 1, mask: 1 },
  { id: id(12), instanceId: id(202), kind: 'sensor', shape: { kind: 'box', size: [60, 30] }, offset: [0, 0], layer: 1, mask: 1 },
] });
const directory = () => ({ format: 'viento-scene-physics2d-space', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: hash('world'),
  scene: { objectId: id(1), sourcePath: 'documents/scenes/demo.json', sourceRevision: hash('scene'), title: 'Saved scene', viewport: [320, 240], background: '#172839' },
  actors: [200, 201, 202].map((n, index) => ({ instanceId: id(n), objectId: id(9000 + index), name: 'Same actor', sourcePath: `documents/actors/${index}.json`, sourceRevision: hash('actor' + index),
    position: [[80, 120], [500, -40], [220, 200]][index], size: [40, 60], color: '#556677' })),
});
const fieldNames = ['Instance', 'Kind', 'Shape', 'Width', 'Height', 'Radius', 'X', 'Y', 'Layer', 'Mask'];
async function fixture(t, settings = {}) {
  const original = JSON.stringify(settings.model || model(), null, 2) + '\n'; let content = original, language = 'zh', listener = () => {}, rendererCallbacks;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, physicsSource: true, available: true,
    sourcePath: 'documents/physics/demo.json', sourceToken: 'host:1', targetsAvailable: false, spaceAvailable: settings.spaceAvailable ?? true, spaceToken: 'space:1' };
  const source = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, sourceRevision: hash(content), baseSourceRevision: hash(original) });
  const calls = [], writes = [], renders = [], state = { view: null, options: null }, reads = [];
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-physics2d', {
    readScenePhysics2DDocument, isScenePhysics2DProposal, isScenePhysics2DSpace, isScenePhysics2DOffsetProposal,
    createScenePhysics2DProposal: async (before, edit) => { await settings.beforeProposal?.(); return createScenePhysics2DProposal(copy(before), copy(edit)); },
    scenePhysics2DSpaceMatchSource: (space, snapshot) => scenePhysics2DSpaceMatchSource(space, copy(snapshot)),
    createScenePhysics2DSpaceView: (space, document) => createScenePhysics2DSpaceView(space, copy(document)),
    scenePhysics2DOffsetProposalMatches: (proposal, view, bodyId, offset) => scenePhysics2DOffsetProposalMatches(proposal, view, bodyId, copy(offset)),
    setupScenePhysics2DSpace: callbacks => { rendererCallbacks = callbacks; return {
      render(view, options) { state.view = view; state.options = copy(options); renders.push({ view, options: copy(options) }); },
      clear() { state.view = null; },
    }; },
    t: translate, translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: callback => { listener = callback; return () => { listener = () => {}; }; },
  });
  const controller = h.runtime.setupScenePhysics2D({ getContext: () => context, getSource: async () => source(),
    getSpace: async snapshot => { reads.push(copy(snapshot)); const raw = directory(); await settings.read?.(copy(snapshot), raw); return captureScenePhysics2DSpace(copy(snapshot), raw); },
    applyDraft: async (proposal, guard) => { calls.push(proposal); await settings.beforeApply?.(); if (!guard.isCurrent()) throw Error('stale');
      content = proposal.afterContent; writes.push(content); context.sourceToken += ':draft'; return { applied: true, content, sourcePath: context.sourcePath, sourceToken: context.sourceToken }; },
  });
  const el = name => h.element('scenePhysics2D' + name), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const click = async name => { el(name).click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, el, controller, context, calls, writes, renders, state, reads, original, content: () => content, settle, click,
    open: async () => { const result = await controller.open(); await settle(); return result; },
    set(name, value, event = ['Body', 'Kind', 'Shape'].includes(name) ? 'change' : 'input') { el(name).value = value; el(name).dispatch(event); },
    fields: () => Object.fromEntries(fieldNames.map(name => [name, el(name).value])),
    propose: (delta = [1, 0], bodyId = el('Body').value, view = state.view) => createScenePhysics2DOffsetProposal(view, bodyId, delta),
    offer: candidate => rendererCallbacks.onOffsetProposal(candidate),
    select: bodyId => rendererCallbacks.onSelect(bodyId),
    language(value) { language = value; listener(); },
  };
}

test('offset mode is explicit and toggling it does not alter fields review or author source', async t => {
  const h = await fixture(t); await h.open(); const before = h.fields(), candidate = h.propose();
  assert.equal(h.state.options.mode, 'view'); assert.equal(h.el('SpaceEdit').getAttribute('aria-pressed'), 'false');
  assert.equal(h.offer(candidate), false); assert.deepEqual(h.fields(), before);
  await h.click('SpaceEdit'); assert.equal(h.state.options.mode, 'offset'); assert.equal(h.el('SpaceEditHint').hidden, false);
  await h.click('SpaceEdit'); assert.equal(h.state.options.mode, 'view'); assert.equal(h.offer(candidate), false);
  assert.deepEqual(h.fields(), before); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.content(), h.original); assert.equal(h.writes.length, 0);
});

test('a valid adjustment changes only the affected offset axis and requires Check before Apply', async t => {
  const h = await fixture(t); await h.open();
  h.set('X', '7e0'); h.set('Y', '-3.0'); h.set('Width', '3.2e1'); h.set('Layer', '1e0'); await h.click('Check');
  h.el('Radius').value = 'unused radius'; const before = h.fields(); await h.click('SpaceEdit');
  assert.equal(h.offer(h.propose([2.25, 0])), true);
  assert.deepEqual(h.fields(), { ...before, X: '9.25' }); assert.equal(h.el('Dialog').dataset.dirty, 'true');
  assert.equal(h.document.activeElement, h.el('X')); assert.equal(h.state.view, null); assert.equal(h.el('Apply').disabled, true);
  assert.equal(h.el('Review').hidden, true); assert.equal(h.content(), h.original); assert.equal(h.writes.length, 0);
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  assert.deepEqual(h.state.view.bodies[0].offset, [9.25, -3]); assert.match(h.el('After').textContent, /9\.25/);
  assert.equal(h.content(), h.original); await h.click('Apply');
  assert.equal(h.writes.length, 1); assert.equal(h.calls.length, 1); assert.equal(h.el('Dialog').open, false);
  const result = JSON.parse(h.content()), expected = model(); expected.bodies[0].offset[0] = 9.25; assert.deepEqual(result, expected);
});

test('zero delta preserves numeric spellings an existing review and keyboard focus', async t => {
  const h = await fixture(t); await h.open(); h.set('X', '7.0'); h.set('Y', '-3e0'); h.set('Width', '6.4e1'); await h.click('Check'); await h.click('SpaceEdit');
  const before = h.fields(), review = h.el('After').textContent, view = h.state.view; h.el('Width').focus();
  assert.equal(h.offer(h.propose([0, 0])), true); assert.deepEqual(h.fields(), before);
  assert.equal(h.el('After').textContent, review); assert.equal(h.el('Apply').disabled, false); assert.equal(h.state.view, view);
  assert.equal(h.document.activeElement, h.el('Width')); assert.equal(h.writes.length, 0);
});

test('stale views foreign body proposals and forged proposals never alter checked fields', async t => {
  const h = await fixture(t); await h.open(); await h.click('SpaceEdit');
  const before = h.fields(), old = h.propose(), other = h.propose([1, 0], id(11));
  for (const candidate of [other, { ...old }, structuredClone(old), Object.create(old), null, { bodyId: id(10), offset: [20, 30] }]) {
    assert.equal(h.offer(candidate), false); assert.deepEqual(h.fields(), before);
  }
  await h.click('SpaceRefresh'); assert.equal(h.offer(old), false); assert.deepEqual(h.fields(), before);
  assert.equal(h.offer(h.propose([0, 2])), true); assert.equal(h.el('Y').value, '-1'); assert.equal(h.writes.length, 0);
});

test('selection changes invalidate the previous body proposal without conflating repeated actor names', async t => {
  const h = await fixture(t); await h.open(); await h.click('SpaceEdit'); const previous = h.propose(); h.select(id(11));
  const before = h.fields(); assert.equal(h.el('Body').value, id(11)); assert.equal(h.el('Shape').value, 'circle');
  assert.equal(h.offer(previous), false); assert.deepEqual(h.fields(), before);
  assert.equal(h.offer(h.propose([-1, 0])), true); assert.equal(h.el('X').value, '-6');
  await h.click('Check'); assert.equal(h.state.view.bodies.find(body => body.id === id(11)).offset[0], -6);
  assert.deepEqual(h.state.view.bodies.find(body => body.id === id(10)).offset, [7, -3]); assert.equal(h.writes.length, 0);
});

test('unresolved instances remain selectable but cannot enable offset mode or originate a move', async t => {
  const h = await fixture(t, { read: (_source, raw) => { raw.actors = raw.actors.filter(actor => actor.instanceId !== id(201)); } }); await h.open();
  h.select(id(11)); const before = h.fields(); assert.equal(h.el('SpaceEdit').disabled, true);
  h.el('SpaceEdit').dispatch('click'); assert.equal(h.state.options.mode, 'view');
  assert.throws(() => h.propose([1, 0]), { errorCode: 'scene_physics2d_space_edit_invalid' });
  assert.equal(h.offer({ bodyId: id(11), instanceId: id(201), offset: [-4, 10] }), false); assert.deepEqual(h.fields(), before); assert.equal(h.writes.length, 0);
});

test('silent raw input changes reject queued gestures before refresh and never replace invalid text', async t => {
  for (const [name, value] of [['Width', '1e'], ['X', '17'], ['Y', '-4'], ['Instance', id(202)], ['Mask', '3']]) {
    const h = await fixture(t); await h.open(); await h.click('SpaceEdit'); const candidate = h.propose(); h.el(name).value = value;
    const before = h.fields(); assert.equal(h.offer(candidate), false); assert.deepEqual(h.fields(), before);
    h.controller.refresh(); assert.equal(h.state.view, null); assert.equal(h.el(name).value, value); assert.equal(h.el('Apply').disabled, true); assert.equal(h.writes.length, 0);
  }
});

test('source identity eligibility and busy changes reject a queued adjustment without requiring repaint', async t => {
  for (const [key, value] of [['sourcePath', 'documents/physics/other.json'], ['sourceToken', 'host:2'], ['busy', true], ['available', false], ['editable', false]]) {
    const h = await fixture(t); await h.open(); await h.click('SpaceEdit'); const candidate = h.propose(), before = h.fields(); h.context[key] = value;
    assert.equal(h.offer(candidate), false); assert.deepEqual(h.fields(), before); assert.equal(h.content(), h.original); assert.equal(h.writes.length, 0);
  }
});

test('capability changes and observed revoke-restore invalidate old gestures and reset adjustment mode', async t => {
  for (const key of ['spaceAvailable', 'spaceToken']) {
    const h = await fixture(t); await h.open(); await h.click('SpaceEdit'); const candidate = h.propose(), before = h.fields(), initial = h.context[key];
    h.context[key] = key === 'spaceAvailable' ? false : 'space:2'; assert.equal(h.offer(candidate), false); assert.deepEqual(h.fields(), before);
    h.controller.refresh(); assert.equal(h.state.options.mode, 'view'); h.context[key] = initial; h.controller.refresh();
    assert.equal(h.offer(candidate), false); await h.click('SpaceRefresh'); await h.click('SpaceEdit'); assert.equal(h.offer(candidate), false);
    assert.deepEqual(h.fields(), before); assert.equal(h.offer(h.propose()), true); assert.equal(h.writes.length, 0);
  }
});

test('cancel and immediate reopen keep old proposals out of the new checked session', async t => {
  const h = await fixture(t); await h.open(); await h.click('SpaceEdit'); const old = h.propose(); h.el('Cancel').click();
  assert.equal(h.offer(old), false); assert.equal(h.el('Dialog').open, false); await h.open(); await h.click('SpaceEdit');
  const before = h.fields(); assert.equal(h.offer(old), false); assert.deepEqual(h.fields(), before); assert.equal(h.el('Dialog').open, true);
  assert.equal(h.offer(h.propose()), true); assert.equal(h.writes.length, 0);
});

test('a pending Check rejects spatial callbacks and leaves the eventual review intact', async t => {
  const gate = deferred(), h = await fixture(t, { beforeProposal: () => gate.promise }); await h.open(); await h.click('SpaceEdit'); const old = h.propose();
  h.set('Width', '64'); h.el('Check').click(); await h.settle(); const before = h.fields();
  assert.equal(h.el('Dialog').getAttribute('aria-busy'), 'true'); assert.equal(h.offer(old), false); assert.deepEqual(h.fields(), before);
  h.el('SpaceEdit').dispatch('click'); assert.equal(h.state.options.mode, 'offset'); gate.resolve(); await h.settle();
  assert.equal(h.el('Apply').disabled, false); assert.equal(h.state.view.bodies[0].shape.size[0], 64); assert.equal(h.writes.length, 0);
});

test('a pending Apply rejects otherwise current spatial callbacks and commits only its checked candidate', async t => {
  const gate = deferred(), h = await fixture(t, { beforeApply: () => gate.promise }); await h.open(); await h.click('SpaceEdit');
  h.set('Width', '64'); await h.click('Check'); const candidate = h.propose(), review = h.el('After').textContent, before = h.fields();
  h.el('Apply').click(); await h.settle(); assert.equal(h.calls.length, 1); assert.equal(h.writes.length, 0);
  assert.equal(h.offer(candidate), false); assert.deepEqual(h.fields(), before); assert.equal(h.el('After').textContent, review);
  gate.resolve(); await h.settle(); assert.equal(h.writes.length, 1); const written = JSON.parse(h.content()); assert.equal(written.bodies[0].shape.size[0], 64); assert.deepEqual(written.bodies[0].offset, [7, -3]);
});

test('out-of-range displacement cannot update either field or revoke an existing review', async t => {
  const h = await fixture(t); await h.open(); h.set('Width', '64'); await h.click('Check'); await h.click('SpaceEdit');
  const before = h.fields(), review = h.el('After').textContent;
  assert.throws(() => h.offer(h.propose([1, 9000])), { errorCode: 'scene_physics2d_space_edit_invalid' });
  assert.deepEqual(h.fields(), before); assert.equal(h.el('After').textContent, review); assert.equal(h.el('Apply').disabled, false); assert.equal(h.writes.length, 0);
});

test('all three languages preserve the mode checked view raw spellings selection and focused controls', async t => {
  const h = await fixture(t); await h.open(); h.set('X', '7e0'); h.set('Y', '-3.0'); h.set('Width', '6.4e1'); await h.click('Check'); await h.click('SpaceEdit');
  const view = h.state.view, fields = h.fields(), review = h.el('After').textContent, field = h.el('Width'); field.focus();
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.state.view, view); assert.equal(h.state.options.mode, 'offset'); assert.deepEqual(h.fields(), fields);
    assert.equal(h.el('Width'), field); assert.equal(h.document.activeElement, field); assert.equal(h.el('After').textContent, review); assert.equal(h.el('Apply').disabled, false);
    assert.equal(h.offer(h.propose([0, 0])), true); assert.deepEqual(h.fields(), fields);
  }
  assert.equal(h.offer(h.propose([1, 0])), true); assert.equal(h.el('X').value, '8'); assert.equal(h.el('Y').value, '-3.0'); assert.equal(h.writes.length, 0);
});
