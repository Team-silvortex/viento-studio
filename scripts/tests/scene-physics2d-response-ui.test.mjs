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
  const original = JSON.stringify(settings.model || model(), null, 2) + '\n'; let capability = settings.capability !== false; let content = original, language = 'zh', listener = () => {}, rendererCallbacks;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, physicsSource: true, available: true,
    sourcePath: 'documents/physics/demo.json', sourceToken: 'host:1', targetsAvailable: false, spaceAvailable: settings.spaceAvailable ?? true, spaceToken: 'space:1' };
  const source = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, sourceRevision: hash(content), baseSourceRevision: hash(original) });
  const calls = [], writes = [], renders = [], state = { view: null, options: null }, reads = [];
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-physics2d', {
    supportsStudioCoreScenePhysics2DResponse: () => capability,
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
    set(name, value, event = ['Body', 'Kind', 'Shape', 'Response'].includes(name) ? 'change' : 'input') { el(name).value = value; el(name).dispatch(event); },
    fields: () => Object.fromEntries(fieldNames.map(name => [name, el(name).value])),
    propose: (delta = [1, 0], bodyId = el('Body').value, view = state.view) => createScenePhysics2DResizeProposal(view, bodyId, delta),
    offer: candidate => rendererCallbacks.onResizeProposal(candidate),
    proposeOffset: (delta = [1, 0], bodyId = el('Body').value, view = state.view) => createScenePhysics2DOffsetProposal(view, bodyId, delta),
    offerOffset: candidate => rendererCallbacks.onOffsetProposal(candidate),
    select: bodyId => rendererCallbacks.onSelect(bodyId),
    language(value) { language = value; listener(); }, capability(value) { capability = value; controller.refresh(); },
  };
}


test('legacy response is displayed as stop and unchanged checks preserve schema and author bytes', async t => {
  const h = await fixture(t); await h.open(); assert.equal(h.el('Response').value, 'stop'); assert.equal(h.el('ResponseField').hidden, false);
  await h.click('Check'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.content(), h.original); assert.equal(h.el('Dialog').dataset.dirty, 'false');
  h.set('Response', 'slide'); h.set('Response', 'stop'); await h.click('Check'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.content(), h.original);
});
test('explicit slide reviews a schema upgrade then applies only the ordinary unsaved draft', async t => {
  const h = await fixture(t); await h.open(); h.set('Response', 'slide'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('SpaceView').hidden, true);
  await h.click('Check'); const next = JSON.parse(h.el('After').textContent); assert.equal(next.schemaVersion, 2); assert.equal(next.bodies[0].collisionResponse, 'slide');
  assert.equal(next.bodies[1].collisionResponse, undefined); assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
  await h.click('Apply'); assert.equal(h.writes.length, 1); assert.deepEqual(JSON.parse(h.content()), next);
});
test('schema2 explicit stop retains its field and schema while unrelated values are edited', async t => {
  const value = model(); value.schemaVersion = 2; value.bodies[0].collisionResponse = 'stop';
  const h = await fixture(t, { model: value }); await h.open(); h.set('Width', '40'); await h.click('Check'); await h.click('Apply');
  const after = JSON.parse(h.content()); assert.equal(after.schemaVersion, 2); assert.equal(after.bodies[0].collisionResponse, 'stop'); assert.equal(after.bodies[0].shape.size[0], 40);
});
test('switching slide to stop does not downgrade an already upgraded document', async t => {
  const value = model(); value.schemaVersion = 2; value.bodies[0].collisionResponse = 'slide';
  const h = await fixture(t, { model: value }); await h.open(); h.set('Response', 'stop'); await h.click('Check');
  const after = JSON.parse(h.el('After').textContent); assert.equal(after.schemaVersion, 2); assert.equal(after.bodies[0].collisionResponse, 'stop');
});
test('body-kind changes omit forbidden response while keeping the character choice available on return', async t => {
  const value = model(); value.schemaVersion = 2; value.bodies[0].collisionResponse = 'slide';
  const h = await fixture(t, { model: value }); await h.open(); h.set('Kind', 'static');
  assert.equal(h.el('ResponseField').hidden, true); assert.equal(h.el('Response').disabled, true); await h.click('Check');
  assert.equal(JSON.parse(h.el('After').textContent).bodies[0].collisionResponse, undefined);
  h.set('Kind', 'character'); assert.equal(h.el('Response').value, 'slide'); await h.click('Check'); assert.equal(h.el('Apply').disabled, true);
});
test('hidden response changes are semantically inert and do not dirty a static body', async t => {
  const h = await fixture(t); await h.open(); h.set('Body', id(11)); assert.equal(h.el('ResponseField').hidden, true);
  h.set('Response', 'slide'); assert.equal(h.el('Dialog').dataset.dirty, 'false'); await h.click('Check'); assert.equal(h.el('Apply').disabled, true);
  h.set('Kind', 'character'); await h.click('Check'); assert.equal(JSON.parse(h.el('After').textContent).bodies[1].collisionResponse, 'slide');
});
test('selecting another body preserves each response without sharing its choice', async t => {
  const h = await fixture(t); await h.open(); h.set('Response', 'slide'); h.set('Body', id(11)); assert.equal(h.el('Response').value, 'stop');
  h.set('Body', id(10)); assert.equal(h.el('Response').value, 'slide'); await h.click('Check'); assert.equal(JSON.parse(h.el('After').textContent).bodies[1].collisionResponse, undefined);
});
test('missing response capability disables only the new control and forged choices cannot create review', async t => {
  const h = await fixture(t, { capability: false }); await h.open(); assert.equal(h.el('Response').disabled, true); assert.equal(h.el('Width').disabled, false); assert.equal(h.el('ResponseUnavailable').hidden, false);
  h.set('Response', 'slide'); await h.click('Check'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.writes.length, 0);
  h.set('Response', 'stop'); h.set('Width', '45'); await h.click('Check'); assert.equal(JSON.parse(h.el('After').textContent).schemaVersion, 1);
});
test('invalid response tokens and silent changes cannot authorize a reviewed application', async t => {
  const h = await fixture(t); await h.open(); h.set('Response', 'bounce'); await h.click('Check'); assert.equal(h.el('Apply').disabled, true);
  h.set('Response', 'slide'); await h.click('Check'); h.el('Response').value = 'stop'; await h.click('Apply'); assert.equal(h.writes.length, 0);
});
test('late checks and pending applications cannot ignore response changes or capability loss', async t => {
  const gate = deferred(), h = await fixture(t, { beforeProposal: () => gate.promise }); await h.open(); h.set('Response', 'slide'); h.el('Check').click(); await h.settle(); h.el('Response').value = 'stop'; gate.resolve(); await h.settle(); assert.equal(h.el('Apply').disabled, true);
  const apply = deferred(), n = await fixture(t, { beforeApply: () => apply.promise }); await n.open(); n.set('Response', 'slide'); await n.click('Check'); n.el('Apply').click(); await n.settle(); n.capability(false); apply.resolve(); await n.settle(); assert.equal(n.writes.length, 0);
});
test('slide declarations retain response through independent offset and size proposals', async t => {
  for (const mode of ['offset', 'resize']) {
    const value = model(); value.schemaVersion = 2; value.bodies[0].collisionResponse = 'slide';
    const h = await fixture(t, { model: value }); await h.open(); await h.click(mode === 'offset' ? 'SpaceEdit' : 'SpaceResize');
    assert.equal(mode === 'offset' ? h.offerOffset(h.proposeOffset([2, 0])) : h.offer(h.propose([2, 0])), true);
    await h.click('Check'); const after = JSON.parse(h.el('After').textContent); assert.equal(after.schemaVersion, 2); assert.equal(after.bodies[0].collisionResponse, 'slide');
  }
});
test('three languages preserve response node selection review and focused incomplete dimensions', async t => {
  const h = await fixture(t); await h.open(); h.set('Response', 'slide'); await h.click('Check'); const select = h.el('Response'), reviewed = h.el('After').textContent; select.focus();
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Response'), select); assert.equal(select.value, 'slide'); assert.equal(h.document.activeElement, select); assert.equal(h.el('After').textContent, reviewed); assert.equal(h.el('Apply').disabled, false); }
  h.set('Width', '1e-'); const width = h.el('Width'); width.focus(); h.language('ja'); assert.equal(width.value, '1e-'); assert.equal(h.document.activeElement, width); assert.equal(select.value, 'slide');
});
