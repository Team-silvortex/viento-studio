import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { placementsFixture, ids } from './scene-composition-placements-fixture.mjs';

async function harness(t) {
  const value = await placementsFixture(), context = { editable: true, dirty: false, busy: false, creating: false, previewKind: 'composition',
    canEditCompositionPlacements: true, canEditCompositionOverride: true, canEditCompositionLayout: true, canEditCompositionBatchLayout: true,
    canEditCompositionFragment: true, canEditCompositionPlacement: true, canEditCompositionStructure: true, compositionSourceWritable: true,
    sceneDraftPath: value.source.sourcePath, sceneDraftToken: 1 }, opened = [], siblings = [], calls = [];
  let result = true;
  const h = await dialogHarness('app-scene-preview', {
    createScenePreviewCanvas: () => Object.fromEntries(['setScene', 'setImages', 'setVisible', 'select', 'fit', 'zoom', 'setGrid', 'destroy'].map(name => [name, () => {}])),
    fetchJsonApiRequest: (url, request) => { const waiting = deferred(); calls.push({ url, request, ...waiting }); if (request.method === 'DELETE') waiting.resolve({ payload: { ok: true } }); return waiting.promise; },
  });
  const container = h.document.createElement('section'); h.document.body.append(container);
  const sibling = name => input => { siblings.push({ name, input }); return result; };
  const controller = h.runtime.setupScenePreview({ container, getContext: () => context,
    editCompositionPlacements: input => { opened.push(input); return result; },
    editCompositionOverride: sibling('Override'), editCompositionLayout: sibling('Layout'), editCompositionBatchLayout: sibling('BatchLayout'),
    editCompositionFragment: sibling('Fragment'), editCompositionPlacement: sibling('Placement'), editCompositionStructure: sibling('Structure') });
  controller.setAvailable(true); controller.setScene(ids.scene); controller.setVisible(true);
  calls.filter(call => call.request.method === 'POST').at(-1).resolve({ payload: value.model }); await flushDialogs();
  t.after(() => controller.destroy()); return { ...h, value, context, controller, container, opened, siblings, setResult: value => { result = value; } };
}

test('the whole-recipe placement toolbar opens without a selected actor and needs its own capability/source ownership', async t => {
  const h = await harness(t), button = h.element('scenePreviewCompositionPlacements'); assert.equal(button.hidden, false); assert.equal(button.disabled, false);
  button.click(); await flushDialogs(); assert.equal(h.opened.length, 1); assert.equal(h.opened[0].actorId, null); assert.equal(h.opened[0].isCurrent(), true);
  for (const [key, value] of [['canEditCompositionPlacements', false], ['compositionSourceWritable', false], ['editable', false], ['creating', true], ['busy', true], ['dirty', true], ['sceneDraftPath', 'other.json']]) {
    const before = h.context[key]; h.context[key] = value; h.controller.setScene(ids.scene); assert.equal(button.disabled, true); button.dispatch('click'); await flushDialogs(); h.context[key] = before;
  }
  assert.equal(h.opened.length, 1); assert.equal(h.siblings.length, 0);
});

test('actor selection changes preserve the recipe placement owner but source token or scene changes revoke it', async t => {
  const h = await harness(t); h.element('scenePreviewCompositionPlacements').click(); await flushDialogs(); const input = h.opened[0];
  for (const actor of h.value.model.actors) { h.element('scenePreviewObjects').querySelector(`button[data-actor-id="${actor.instanceId}"]`).click(); assert.equal(input.isCurrent(), true); }
  h.context.sceneDraftToken++; assert.equal(input.isCurrent(), false); h.context.sceneDraftToken--; h.controller.setScene('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); assert.equal(input.isCurrent(), false);
});

test('a pending placement opening blocks all sibling editors and late rejection cannot revive a hidden preview', async t => {
  const h = await harness(t), waiting = deferred(); h.setResult(waiting.promise);
  h.element('scenePreviewObjects').querySelector(`button[data-actor-id="${h.value.actorId}"]`).click(); h.element('scenePreviewCompositionPlacements').click();
  h.element('scenePreviewCompositionPlacements').dispatch('click');
  for (const name of ['Override', 'Layout', 'BatchLayout', 'Fragment', 'Placement', 'Structure']) h.element(`scenePreviewComposition${name}`).dispatch('click');
  assert.equal(h.opened.length, 1); assert.equal(h.siblings.length, 0); h.controller.setVisible(false); assert.equal(h.opened[0].isCurrent(), false);
  waiting.reject(Error('Late opening')); await flushDialogs(); assert.equal(h.container.dataset.scenePreviewState, 'empty');
});

test('every sibling pending opener independently excludes placement management', async t => {
  for (const name of ['Override', 'Layout', 'BatchLayout', 'Fragment', 'Placement', 'Structure']) {
    const h = await harness(t), waiting = deferred(); h.setResult(waiting.promise); h.element('scenePreviewObjects').querySelector(`button[data-actor-id="${h.value.actorId}"]`).click();
    h.element(`scenePreviewComposition${name}`).click(); h.element('scenePreviewCompositionPlacements').dispatch('click'); assert.equal(h.opened.length, 0);
    waiting.resolve(true); await flushDialogs(); h.controller.destroy();
  }
});

test('unsupported placement management leaves earlier composition entries usable and reports a current failed opening', async t => {
  const h = await harness(t); h.context.canEditCompositionPlacements = false; h.controller.setScene(ids.scene);
  assert.equal(h.element('scenePreviewCompositionPlacements').disabled, true); assert.equal(h.element('scenePreviewCompositionStructure').disabled, false);
  h.context.canEditCompositionPlacements = true; h.controller.setScene(ids.scene); h.setResult(false); h.element('scenePreviewCompositionPlacements').click(); await flushDialogs();
  assert.ok(h.element('scenePreviewMessage').textContent.includes('放置结构编辑暂不可用')); assert.equal(h.opened.length, 1);
});
