import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { readScenePhysics2DDocument, createScenePhysics2DProposal, isScenePhysics2DProposal } from '../../engine/scene-physics2d-edit.mjs';
import { captureScenePhysics2DSpace, isScenePhysics2DSpace, scenePhysics2DSpaceMatchSource, createScenePhysics2DSpaceView } from '../../engine/scene-physics2d-space.mjs';
import { createScenePhysics2DOffsetProposal, isScenePhysics2DOffsetProposal, scenePhysics2DOffsetProposalMatches } from '../../engine/scene-physics2d-space-edit.mjs';
import { createScenePhysics2DResizeProposal, isScenePhysics2DResizeProposal, scenePhysics2DResizeProposalMatches } from '../../engine/scene-physics2d-space-resize.mjs';
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
    readScenePhysics2DDocument, isScenePhysics2DProposal, isScenePhysics2DSpace, isScenePhysics2DOffsetProposal, isScenePhysics2DResizeProposal,
    createScenePhysics2DProposal: async (before, edit) => { await settings.beforeProposal?.(); return createScenePhysics2DProposal(copy(before), copy(edit)); },
    scenePhysics2DSpaceMatchSource: (space, snapshot) => scenePhysics2DSpaceMatchSource(space, copy(snapshot)),
    createScenePhysics2DSpaceView: (space, document) => createScenePhysics2DSpaceView(space, copy(document)),
    scenePhysics2DOffsetProposalMatches: (proposal, view, bodyId, offset) => scenePhysics2DOffsetProposalMatches(proposal, view, bodyId, copy(offset)),
    scenePhysics2DResizeProposalMatches: (proposal, view, bodyId, currentShape) => scenePhysics2DResizeProposalMatches(proposal, view, bodyId, copy(currentShape)),
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
    propose: (delta = [1, 0], bodyId = el('Body').value, view = state.view) => createScenePhysics2DResizeProposal(view, bodyId, delta),
    offer: candidate => rendererCallbacks.onResizeProposal(candidate),
    proposeOffset: (delta = [1, 0], bodyId = el('Body').value, view = state.view) => createScenePhysics2DOffsetProposal(view, bodyId, delta),
    offerOffset: candidate => rendererCallbacks.onOffsetProposal(candidate),
    select: bodyId => rendererCallbacks.onSelect(bodyId),
    language(value) { language = value; listener(); },
  };
}

test('view offset and resize modes are explicit mutually exclusive and reject each other proposals', async t => {
  const h = await fixture(t); await h.open(); const fields = h.fields(), resize = h.propose(), offset = h.proposeOffset();
  assert.equal(h.state.options.mode, 'view'); assert.equal(h.offer(resize), false); assert.equal(h.offerOffset(offset), false);
  await h.click('SpaceResize'); assert.equal(h.state.options.mode, 'resize');
  assert.equal(h.el('SpaceResize').getAttribute('aria-pressed'), 'true'); assert.equal(h.el('SpaceEdit').getAttribute('aria-pressed'), 'false');
  assert.equal(h.el('SpaceResizeHint').hidden, false); assert.equal(h.el('SpaceEditHint').hidden, true);
  assert.equal(h.offerOffset(offset), false); assert.equal(h.offer(offset), false);
  await h.click('SpaceEdit'); assert.equal(h.state.options.mode, 'offset'); assert.equal(h.offer(resize), false); assert.equal(h.offerOffset(resize), false);
  assert.equal(h.el('SpaceResize').getAttribute('aria-pressed'), 'false'); assert.equal(h.el('SpaceEdit').getAttribute('aria-pressed'), 'true');
  await h.click('SpaceResize'); assert.equal(h.state.options.mode, 'resize'); await h.click('SpaceResize'); assert.equal(h.state.options.mode, 'view');
  assert.equal(h.offer(resize), false); assert.deepEqual(h.fields(), fields); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.writes.length, 0);
});

test('box single-axis and double-axis adjustments update only changed dimensions and focus the first changed field', async t => {
  for (const [delta, changed, focus, paths] of [
    [[2.25, 0], { Width: '34.25' }, 'Width', ['/bodies/0/shape/size/0']],
    [[0, -1.5], { Height: '46.5' }, 'Height', ['/bodies/0/shape/size/1']],
    [[2.25, -1.5], { Width: '34.25', Height: '46.5' }, 'Width', ['/bodies/0/shape/size/0', '/bodies/0/shape/size/1']],
  ]) {
    const h = await fixture(t); await h.open();
    h.set('Width', '3.2e1'); h.set('Height', '48.0'); h.set('X', '7e0'); h.set('Y', '-3.0'); h.set('Layer', '1e0'); await h.click('Check');
    h.el('Radius').value = 'unused radius'; const before = h.fields(), center = [...h.state.view.bodies[0].center]; await h.click('SpaceResize');
    assert.equal(h.offer(h.propose(delta)), true); assert.deepEqual(h.fields(), { ...before, ...changed }); assert.equal(h.document.activeElement, h.el(focus));
    assert.equal(h.el('Dialog').dataset.dirty, 'true'); assert.equal(h.state.view, null); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true);
    assert.equal(h.content(), h.original); assert.equal(h.writes.length, 0); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
    assert.deepEqual(h.state.view.bodies[0].center, center); assert.deepEqual(h.state.view.bodies[0].offset, [7, -3]);
    await h.click('Apply'); assert.equal(h.writes.length, 1); assert.deepEqual(h.calls[0].changedPaths, paths);
    const expected = model(); expected.bodies[0].shape.size = [32 + delta[0], 48 + delta[1]]; assert.deepEqual(JSON.parse(h.content()), expected);
  }
});

test('circle adjustment changes only radius through checked source review and retains every offset spelling', async t => {
  const h = await fixture(t); await h.open(); h.select(id(11)); h.set('Radius', '1.5e1'); h.set('X', '-5.0'); h.set('Y', '1e1'); await h.click('Check');
  h.el('Width').value = 'unused width'; h.el('Height').value = 'unused height'; const before = h.fields(), center = [...h.state.view.bodies[1].center]; await h.click('SpaceResize');
  assert.equal(h.offer(h.propose([2.125])), true); assert.deepEqual(h.fields(), { ...before, Radius: '17.125' }); assert.equal(h.document.activeElement, h.el('Radius'));
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.writes.length, 0); await h.click('Check');
  assert.deepEqual(h.state.view.bodies[1].center, center); assert.equal(h.state.view.bodies[1].shape.kind, 'circle');
  await h.click('Apply'); assert.deepEqual(h.calls[0].changedPaths, ['/bodies/1/shape/radius']);
  const expected = model(); expected.bodies[1].shape.radius = 17.125; assert.deepEqual(JSON.parse(h.content()), expected);
});

test('zero size adjustments preserve exact numeric spellings checked review view identity and focus', async t => {
  for (const [bodyId, delta, fields] of [[id(10), [0, 0], { Width: '3.2e1', Height: '48.0' }], [id(11), [0], { Radius: '1.5e1' }]]) {
    const h = await fixture(t); await h.open(); h.select(bodyId); for (const [name, value] of Object.entries(fields)) h.set(name, value);
    h.set('Mask', '2'); await h.click('Check'); await h.click('SpaceResize'); const before = h.fields(), review = h.el('After').textContent, view = h.state.view;
    h.el('Mask').focus(); assert.equal(h.offer(h.propose(delta)), true); assert.deepEqual(h.fields(), before);
    assert.equal(h.el('After').textContent, review); assert.equal(h.el('Apply').disabled, false); assert.equal(h.state.view, view); assert.equal(h.document.activeElement, h.el('Mask')); assert.equal(h.writes.length, 0);
  }
});

test('forged resize data foreign body proposals and previous checked views cannot alter fields', async t => {
  const h = await fixture(t); await h.open(); await h.click('SpaceResize'); const before = h.fields(), candidate = h.propose(), other = h.propose([1], id(11));
  for (const value of [other, { ...candidate }, structuredClone(candidate), Object.create(candidate), null, { bodyId: id(10), shape: { kind: 'box', size: [80, 48] } }]) {
    assert.equal(h.offer(value), false); assert.deepEqual(h.fields(), before);
  }
  await h.click('SpaceRefresh'); assert.equal(h.offer(candidate), false); assert.deepEqual(h.fields(), before);
  assert.equal(h.offer(h.propose([0, 2])), true); assert.equal(h.el('Height').value, '50'); assert.equal(h.writes.length, 0);
});

test('shape-kind edits and selection changes reject queued resize proposals while preserving the new form', async t => {
  const h = await fixture(t); await h.open(); await h.click('SpaceResize'); const oldBox = h.propose();
  h.set('Shape', 'circle'); h.set('Radius', '12'); await h.click('Check'); const circleFields = h.fields();
  assert.equal(h.offer(oldBox), false); assert.deepEqual(h.fields(), circleFields);
  const circle = h.propose([1]); h.select(id(11)); const otherFields = h.fields();
  assert.equal(h.offer(circle), false); assert.deepEqual(h.fields(), otherFields);
  assert.equal(h.offer(h.propose([1])), true); assert.equal(h.el('Radius').value, '16'); assert.equal(h.el('X').value, '-5'); assert.equal(h.writes.length, 0);
});

test('missing targets are still repairable declarations but cannot enable resize or offset mode', async t => {
  const h = await fixture(t, { read: (_source, raw) => { raw.actors = raw.actors.filter(actor => actor.instanceId !== id(201)); } }); await h.open(); h.select(id(11));
  const before = h.fields(); assert.equal(h.el('SpaceResize').disabled, true); assert.equal(h.el('SpaceEdit').disabled, true);
  h.el('SpaceResize').dispatch('click'); assert.equal(h.state.options.mode, 'view');
  assert.throws(() => h.propose([1]), { errorCode: 'scene_physics2d_space_resize_invalid' }); assert.deepEqual(h.fields(), before); assert.equal(h.writes.length, 0);
});

test('silent unchecked dimension kind or offset input changes reject a queued resize before repaint', async t => {
  for (const [name, value] of [['Width', '1e'], ['Height', '49'], ['Shape', 'circle'], ['X', '8'], ['Y', '-4'], ['Instance', id(202)], ['Mask', '3']]) {
    const h = await fixture(t); await h.open(); await h.click('SpaceResize'); const candidate = h.propose(); h.el(name).value = value; const before = h.fields();
    assert.equal(h.offer(candidate), false); assert.deepEqual(h.fields(), before); h.controller.refresh(); assert.equal(h.state.view, null); assert.equal(h.el(name).value, value); assert.equal(h.writes.length, 0);
  }
  const h = await fixture(t); await h.open(); h.select(id(11)); await h.click('SpaceResize'); const candidate = h.propose([1]); h.el('Radius').value = '1e';
  assert.equal(h.offer(candidate), false); assert.equal(h.el('Radius').value, '1e'); assert.equal(h.writes.length, 0);
});

test('source identity and authoring eligibility changes reject size proposals without waiting for UI refresh', async t => {
  for (const [key, value] of [['sourcePath', 'documents/physics/other.json'], ['sourceToken', 'host:2'], ['busy', true], ['available', false], ['editable', false]]) {
    const h = await fixture(t); await h.open(); await h.click('SpaceResize'); const candidate = h.propose(), before = h.fields(); h.context[key] = value;
    assert.equal(h.offer(candidate), false); assert.deepEqual(h.fields(), before); assert.equal(h.content(), h.original); assert.equal(h.writes.length, 0);
  }
});

test('space capability revoke-restore resets mode and rejects old size proposals after rereading geometry', async t => {
  for (const key of ['spaceAvailable', 'spaceToken']) {
    const h = await fixture(t); await h.open(); await h.click('SpaceResize'); const candidate = h.propose(), before = h.fields(), initial = h.context[key];
    h.context[key] = key === 'spaceAvailable' ? false : 'space:2'; assert.equal(h.offer(candidate), false); assert.deepEqual(h.fields(), before);
    h.controller.refresh(); assert.equal(h.state.options.mode, 'view'); h.context[key] = initial; h.controller.refresh(); assert.equal(h.offer(candidate), false);
    await h.click('SpaceRefresh'); await h.click('SpaceResize'); assert.equal(h.offer(candidate), false); assert.deepEqual(h.fields(), before);
    assert.equal(h.offer(h.propose()), true); assert.equal(h.writes.length, 0);
  }
});

test('cancel and immediate reopen reject old resize proposals and restore the default view mode', async t => {
  const h = await fixture(t); await h.open(); await h.click('SpaceResize'); const old = h.propose(); h.el('Cancel').click();
  assert.equal(h.offer(old), false); await h.open(); assert.equal(h.state.options.mode, 'view'); await h.click('SpaceResize');
  const before = h.fields(); assert.equal(h.offer(old), false); assert.deepEqual(h.fields(), before); assert.equal(h.el('Dialog').open, true);
  assert.equal(h.offer(h.propose()), true); assert.equal(h.writes.length, 0);
});

test('pending Check blocks size and mode callbacks without losing the eventual reviewed candidate', async t => {
  const gate = deferred(), h = await fixture(t, { beforeProposal: () => gate.promise }); await h.open(); await h.click('SpaceResize'); const candidate = h.propose();
  h.set('Width', '64'); h.el('Check').click(); await h.settle(); const before = h.fields();
  assert.equal(h.el('Dialog').getAttribute('aria-busy'), 'true'); assert.equal(h.offer(candidate), false); assert.deepEqual(h.fields(), before);
  h.el('SpaceEdit').dispatch('click'); assert.equal(h.state.options.mode, 'resize'); gate.resolve(); await h.settle();
  assert.equal(h.el('Apply').disabled, false); assert.equal(h.state.view.bodies[0].shape.size[0], 64); assert.equal(h.writes.length, 0);
});

test('pending Apply accepts only its original reviewed shape and rejects late otherwise-valid size proposals', async t => {
  const gate = deferred(), h = await fixture(t, { beforeApply: () => gate.promise }); await h.open(); await h.click('SpaceResize');
  h.set('Width', '64'); await h.click('Check'); const candidate = h.propose(), before = h.fields(), review = h.el('After').textContent;
  h.el('Apply').click(); await h.settle(); assert.equal(h.calls.length, 1); assert.equal(h.writes.length, 0);
  assert.equal(h.offer(candidate), false); assert.deepEqual(h.fields(), before); assert.equal(h.el('After').textContent, review);
  gate.resolve(); await h.settle(); assert.equal(h.writes.length, 1); const written = JSON.parse(h.content()); assert.deepEqual(written.bodies[0].shape.size, [64, 48]); assert.deepEqual(written.bodies[0].offset, [7, -3]);
});

test('an invalid resize cannot partially update dimensions or revoke an existing review', async t => {
  for (const [bodyId, delta] of [[id(10), [2, -48]], [id(10), [8192, 2]], [id(11), [-15]], [id(11), [4096]]]) {
    const h = await fixture(t); await h.open(); h.select(bodyId); h.set('Mask', '2'); await h.click('Check'); await h.click('SpaceResize');
    const before = h.fields(), review = h.el('After').textContent;
    assert.throws(() => h.offer(h.propose(delta)), { errorCode: 'scene_physics2d_space_resize_invalid' });
    assert.deepEqual(h.fields(), before); assert.equal(h.el('After').textContent, review); assert.equal(h.el('Apply').disabled, false); assert.equal(h.writes.length, 0);
  }
});

test('switching back to offset mode retains the previous offset pathway and its source-change scope', async t => {
  const h = await fixture(t); await h.open(); await h.click('SpaceResize'); const resize = h.propose(); await h.click('SpaceEdit');
  assert.equal(h.offer(resize), false); assert.equal(h.offerOffset(h.proposeOffset([1, 0])), true);
  assert.equal(h.el('X').value, '8'); assert.equal(h.el('Width').value, '32'); assert.equal(h.el('Height').value, '48');
  await h.click('Check'); await h.click('Apply'); assert.deepEqual(h.calls[0].changedPaths, ['/bodies/0/offset/0']);
});

test('language changes preserve size-mode view review exact raw fields and focused nodes', async t => {
  const h = await fixture(t); await h.open(); h.set('Width', '3.2e1'); h.set('Height', '48.0'); h.set('X', '7e0'); h.set('Y', '-3.0'); h.set('Mask', '2');
  await h.click('Check'); await h.click('SpaceResize'); const view = h.state.view, fields = h.fields(), review = h.el('After').textContent, field = h.el('Height'); field.focus();
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.state.view, view); assert.equal(h.state.options.mode, 'resize'); assert.deepEqual(h.fields(), fields);
    assert.equal(h.el('Height'), field); assert.equal(h.document.activeElement, field); assert.equal(h.el('After').textContent, review); assert.equal(h.el('Apply').disabled, false);
    assert.equal(h.offer(h.propose([0, 0])), true); assert.deepEqual(h.fields(), fields);
  }
  assert.equal(h.offer(h.propose([0, 1])), true); assert.equal(h.el('Width').value, '3.2e1'); assert.equal(h.el('Height').value, '49');
  assert.equal(h.el('X').value, '7e0'); assert.equal(h.el('Y').value, '-3.0'); assert.equal(h.document.activeElement, h.el('Height')); assert.equal(h.writes.length, 0);
});
