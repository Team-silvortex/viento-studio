import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';

const recipeId = '11111111-1111-4111-8111-111111111111', sceneId = '22222222-2222-4222-8222-222222222222';
const definitionId = '33333333-3333-4333-8333-333333333333', instanceId = '44444444-4444-4444-8444-444444444444';
const previewId = '55555555-5555-4555-8555-555555555555', draftPreviewId = '66666666-6666-4666-8666-666666666666';
const groupId = '77777777-7777-4777-8777-777777777777', parentId = '88888888-8888-4888-8888-888888888888';
const sourcePath = 'documents/recipes/party.json', projectionPath = 'documents/projections/traveler.json';
const base = `sha256:${'a'.repeat(64)}`, revision = `sha256:${'b'.repeat(64)}`, otherRevision = `sha256:${'c'.repeat(64)}`;
const recipeEntry = { id: recipeId, title: 'Party recipe', sourcePath, kind: 'composition' };
const sceneEntry = { id: sceneId, title: 'Plain scene', sourcePath: 'documents/scenes/room.json' };
function location(propertyPath, sourceRevision = base, role) {
  return { sourcePath, objectId: recipeId, propertyPath, sourceRevision,
    sourceRange: { start: 10, end: 24, encoding: 'utf-16', exact: true, propertyPath }, ...(role ? { role } : {}) };
}
function composite(paths, hash) {
  const contributors = paths.map(([path, role]) => location(path, hash, role));
  return { ...contributors[0], sourceRange: { ...contributors[0].sourceRange, exact: false }, contributors };
}
function preview({ draft = false, writable = false } = {}) {
  const hash = draft ? revision : base;
  const actorDeclaration = composite([['/fragments/0/actors/0', 'template'], ['/placements/0/instanceIds/leader', 'identity']], hash);
  const groupDeclaration = composite([['/fragments/0/groups/1', 'template'], ['/placements/0/groupIds/children', 'identity']], hash);
  return {
    ok: true, format: 'viento-scene-preview', schemaVersion: 2, previewId: draft ? draftPreviewId : previewId,
    scene: { objectId: recipeId, sourcePath, sourceRevision: hash, title: 'Party', viewport: [800, 480], background: '#123456' },
    composition: { format: 'viento-scene-composition-preview', schemaVersion: 1, recipeObjectId: recipeId, sourcePath, sourceRevision: hash, fragmentCount: 1, placementCount: 2 },
    actors: [{ instanceId, objectId: definitionId, name: 'Traveler', sourcePath: projectionPath, position: [240, 120], size: [64, 64], color: '#ffffff', speed: 320,
      controls: 'arrows', declaration: actorDeclaration }],
    sceneStructure: { format: 'viento-scene-structure', schemaVersion: 1, sourceSchemaVersion: 3,
      groups: [{ groupId: parentId, name: 'Party' }, { groupId, name: 'Children', parentGroupId: parentId }], memberships: [{ instanceId, groupId }] },
    sourceLocations: {
      scene: location('', hash), sceneFields: Object.fromEntries(['title', 'viewport', 'background'].map(field => [field, location(`/scene/${field}`, hash)])),
      actors: [{ objectId: definitionId, instanceId, declaration: actorDeclaration, composition: { fragmentId: 'party', placementId: 'east', localKey: 'leader' },
        definition: { sourcePath: projectionPath, objectId: definitionId, sourceRevision: otherRevision, propertyPath: '' },
        fields: {
          position: composite([['/placements/0/overrides/leader/position', 'override'], ['/placements/0/offset', 'offset']], hash),
          size: location('/fragments/0/actors/0/size', hash), color: location('/fragments/0/actors/0/color', hash),
          speed: { sourcePath: projectionPath, objectId: definitionId, propertyPath: '/configuration/speed', sourceRevision: otherRevision,
            sourceRange: { start: 2, end: 5, encoding: 'utf-16', exact: true, propertyPath: '/configuration/speed' } },
          controls: location('/fragments/0/actors/0/controls', hash), imageResourceId: location('/fragments/0/actors/0/imageResourceId', hash),
        } }],
      groups: [{ groupId, declaration: groupDeclaration, composition: { fragmentId: 'party', placementId: 'east', localKey: 'children' },
        fields: { name: location('/fragments/0/groups/1/name', hash),
          parentGroupId: composite([['/fragments/0/groups/1/parentKey', 'template'], ['/placements/0/groupIds/party', 'identity']], hash) } }],
    }, resources: [], diagnostics: [],
    ...(draft ? { draft: { baseSourceRevision: base, sourceRevision: revision } } : {}),
    ...(writable ? { sceneEditing: { sourceRevision: base } } : {}),
  };
}
async function previewHarness(t) {
  const calls = [], opened = [], writes = [], paints = [];
  const context = { editable: true, dirty: false, creating: false, busy: false, canEditScene: true, canPreviewDraft: true,
    canEditDraftLayout: true, sceneDraftToken: 1, previewKind: 'composition' };
  const h = await dialogHarness('app-scene-preview', {
    SCENE_PREVIEW_API_PATH: '/api/scene-preview',
    createScenePreviewCanvas: () => Object.fromEntries(['setScene', 'setImages', 'setVisible', 'select', 'fit', 'zoom', 'setGrid', 'destroy'].map(name => [name, (...args) => paints.push({ name, args })])),
    fetchJsonApiRequest(url, request) { const wait = deferred(); calls.push({ url, request, ...wait }); if (request.method === 'DELETE') wait.resolve({ payload: { ok: true } }); return wait.promise; },
  });
  const container = h.document.createElement('section'); h.document.body.append(container);
  const controller = h.runtime.setupScenePreview({ container, getContext: () => context,
    getDraft: async () => ({ sourcePath, baseSourceRevision: base, content: '{"format":"viento-scene-composition"}' }),
    openSource: (...args) => opened.push(args), editScene: (...args) => writes.push(args), editLayout: (...args) => writes.push(args), editDraftLayout: (...args) => writes.push(args) });
  t.after(() => controller.destroy()); controller.setAvailable(true); controller.setScene(recipeId); controller.setVisible(true);
  const posts = () => calls.filter(call => call.request.method === 'POST');
  const post = () => posts().at(-1);
  const resolve = async payload => { post().resolve({ payload }); await flushDialogs(); };
  const selectActor = () => h.element('scenePreviewObjects').querySelector(`button[data-actor-id="${instanceId}"]`).click();
  const sources = () => h.element('scenePreviewProperties').querySelectorAll('button');
  return { ...h, container, controller, context, calls, opened, writes, paints, post, posts, resolve, selectActor, sources };
}

test('recipe preview identifies its read-only origin and forbids all layout writes even with a forged editing grant', async t => {
  const h = await previewHarness(t); await h.resolve(preview({ writable: true }));
  assert.equal(h.container.dataset.scenePreviewState, 'ready');
  assert.equal(h.element('scenePreviewComposition').hidden, false); assert.match(h.element('scenePreviewComposition').textContent, /只读.*配方原文/);
  assert.match(h.element('scenePreviewProvenance').textContent, /已保存配方/);
  assert.equal(h.element('scenePreviewRefresh').textContent, '预览已保存配方');
  assert.match(h.element('scenePreviewSummary').textContent, /1 个片段.*2 次放置/); assert.doesNotMatch(h.element('scenePreviewSummary').textContent, /undefined/);
  for (const id of ['scenePreviewEdit', 'scenePreviewLayoutEdit', 'scenePreviewDraftLayoutEdit']) {
    assert.equal(h.element(id).hidden, true); assert.equal(h.element(id).disabled, true); h.element(id).dispatch('click');
  }
  assert.equal(h.writes.length, 0);
  h.element('scenePreviewFit').click(); h.element('scenePreviewZoomIn').click();
  assert.ok(h.paints.some(item => item.name === 'fit')); assert.ok(h.paints.some(item => item.name === 'zoom'));
  assert.equal(h.posts().length, 1); assert.equal(h.calls.filter(call => call.request.method !== 'DELETE').length, 1);
});

test('recipe actor inspector exposes separate exact override, offset and identity sources while inherited projection fields retain their own origin', async t => {
  const h = await previewHarness(t); await h.resolve(preview()); h.selectActor();
  assert.match(h.element('scenePreviewProperties').textContent, /片段 · party.*放置 · east.*局部标识 · leader/s);
  const buttons = h.sources();
  for (const [role, path] of [['override', '/placements/0/overrides/leader/position'], ['offset', '/placements/0/offset'], ['identity', '/placements/0/instanceIds/leader']]) {
    const button = buttons.find(item => item.dataset.compositionRole === role && item.dataset.propertyPath === path);
    assert.ok(button, `${role} navigation`); button.click(); await flushDialogs();
    assert.equal(h.opened.at(-1)[1].propertyPath, path); assert.equal(h.opened.at(-1)[1].sourceRange.exact, true);
    assert.equal(h.opened.at(-1)[1].sourceRevision, base); assert.equal(h.opened.at(-1)[1].previewDraft, undefined);
  }
  buttons.find(item => item.dataset.propertyPath === '/configuration/speed').click(); await flushDialogs();
  assert.equal(h.opened.at(-1)[0], projectionPath); assert.equal(h.opened.at(-1)[1].sourceRevision, otherRevision);
  h.element('scenePreviewDeclarationSource').click(); await flushDialogs();
  assert.equal(h.opened.at(-1)[1].propertyPath, '/fragments/0/actors/0'); assert.equal(h.opened.at(-1)[1].sourceRange.exact, true);
  assert.equal(h.element('scenePreviewDeclarationSource').textContent, '打开片段声明');
});

test('scene and group recipe sources retain exact recipe locations and group composition identity', async t => {
  const h = await previewHarness(t); await h.resolve(preview());
  h.element('scenePreviewSource').click(); await flushDialogs(); assert.equal(h.opened.at(-1)[1].propertyPath, '');
  assert.equal(h.element('scenePreviewSource').textContent, '打开配方原文');
  const sceneSource = h.element('scenePreviewSceneSources').querySelector('button'); sceneSource.focus(); h.controller.setScene(recipeId);
  assert.equal(h.element('scenePreviewSceneSources').querySelector('button'), sceneSource); assert.equal(h.document.activeElement, sceneSource);
  for (const button of h.element('scenePreviewSceneSources').querySelectorAll('button')) {
    button.click(); await flushDialogs(); assert.equal(h.opened.at(-1)[1].sourceRange.exact, true); assert.match(h.opened.at(-1)[1].propertyPath, /^\/scene\/(title|viewport|background)$/);
  }
  h.element('scenePreviewObjects').querySelector(`button[data-group-source="${groupId}"]`).click();
  assert.match(h.element('scenePreviewProperties').textContent, /局部标识 · children/);
  for (const path of ['/fragments/0/groups/1/parentKey', '/placements/0/groupIds/party', '/placements/0/groupIds/children']) {
    h.sources().find(item => item.dataset.propertyPath === path).click(); await flushDialogs();
    assert.equal(h.opened.at(-1)[1].propertyPath, path); assert.equal(h.opened.at(-1)[1].sourceRange.exact, true);
  }
  h.element('scenePreviewGroupSource').click(); await flushDialogs(); assert.equal(h.opened.at(-1)[1].propertyPath, '/fragments/0/groups/1');
});

test('recipe drafts keep exact contributor navigation in the current text and cannot enter draft layout', async t => {
  const h = await previewHarness(t); await h.resolve(preview()); h.context.dirty = true;
  h.element('scenePreviewDraftRefresh').click(); await flushDialogs();
  assert.deepEqual(JSON.parse(h.post().request.body), { sceneId: recipeId, draft: { sourcePath, baseSourceRevision: base, content: '{"format":"viento-scene-composition"}' } });
  await h.resolve(preview({ draft: true })); h.selectActor();
  assert.match(h.element('scenePreviewProvenance').textContent, /未保存配方草稿/);
  assert.equal(h.element('scenePreviewDraftLayoutEdit').hidden, true); h.element('scenePreviewDraftLayoutEdit').dispatch('click');
  assert.equal(h.writes.length, 0);
  h.sources().find(item => item.dataset.compositionRole === 'offset').click(); await flushDialogs();
  assert.equal(h.opened.at(-1)[1].previewDraft, true); assert.equal(h.opened.at(-1)[1].sourceRevision, revision);
  h.sources().find(item => item.dataset.propertyPath === '/configuration/speed').click(); await flushDialogs();
  assert.equal(h.opened.at(-1)[1].previewDraft, undefined); assert.equal(h.opened.at(-1)[1].sourceRevision, otherRevision);
});

test('invalid recipe drafts preserve the last valid contributor closures and label composition diagnostics', async t => {
  const h = await previewHarness(t); await h.resolve(preview()); h.context.dirty = true;
  h.element('scenePreviewDraftRefresh').click(); await flushDialogs(); await h.resolve(preview({ draft: true })); h.selectActor();
  h.element('scenePreviewDraftRefresh').click(); await flushDialogs();
  h.post().reject(Object.assign(new Error('Invalid recipe'), { payload: { draft: { baseSourceRevision: base, sourceRevision: otherRevision },
    diagnostics: [{ code: 'composition-document-invalid', ...composite([['/placements/0/overrides/leader/position', 'override'], ['/placements/0/offset', 'offset']], otherRevision) }] } })); await flushDialogs();
  assert.equal(h.container.dataset.scenePreviewState, 'invalid'); assert.equal(h.element('scenePreviewCanvas').hidden, false);
  assert.match(h.element('scenePreviewDiagnostics').textContent, /场景配方有误.*片段、放置和局部覆盖/);
  h.sources().find(item => item.dataset.compositionRole === 'offset').click(); await flushDialogs(); assert.equal(h.opened.at(-1)[1].sourceRevision, revision);
  h.element('scenePreviewDiagnostics').querySelector('button').click(); await flushDialogs();
  assert.equal(h.opened.at(-1)[1].sourceRevision, otherRevision); assert.equal(h.opened.at(-1)[1].previewDraft, true);
  assert.equal(h.opened.at(-1)[1].sourceRange.exact, true);
  h.element('scenePreviewDiagnostics').querySelector('button[data-composition-role="offset"]').click(); await flushDialogs();
  assert.equal(h.opened.at(-1)[1].propertyPath, '/placements/0/offset'); assert.equal(h.opened.at(-1)[1].sourceRevision, otherRevision);
});

test('recipe draft responses from stale editor sessions are released without painting or granting edits', async t => {
  const h = await previewHarness(t); await h.resolve(preview()); h.context.dirty = true;
  h.element('scenePreviewDraftRefresh').click(); await flushDialogs(); h.context.sceneDraftToken++;
  await h.resolve(preview({ draft: true }));
  assert.equal(h.container.dataset.scenePreviewState, 'error');
  assert.equal(h.paints.filter(item => item.name === 'setScene' && item.args[0]).at(-1).args[0].previewId, previewId);
  assert.ok(h.calls.some(call => call.request.method === 'DELETE' && call.url.includes(draftPreviewId)));
  assert.equal(h.writes.length, 0);
});

test('untrusted recipe marker identity, revisions and composition budgets fail before rendering', async t => {
  const h = await previewHarness(t);
  const variants = [value => { delete value.composition; }, value => { value.composition.format = 'scene'; }, value => { value.composition.schemaVersion = 2; },
    value => { value.composition.recipeObjectId = sceneId; }, value => { value.composition.sourcePath = 'other.json'; },
    value => { value.composition.sourceRevision = otherRevision; }, value => { delete value.scene.sourceRevision; },
    ...[0, 33, 1.5, Number.MAX_SAFE_INTEGER + 1].map(count => value => { value.composition.fragmentCount = count; }),
    ...[0, 129, 1.5, Number.MAX_SAFE_INTEGER + 1].map(count => value => { value.composition.placementCount = count; })];
  for (const [index, mutate] of variants.entries()) {
    if (index) h.element('scenePreviewRefresh').click();
    const candidate = preview({ writable: true }); mutate(candidate); await h.resolve(candidate);
    assert.equal(h.container.dataset.scenePreviewState, 'error', `variant ${index}`); assert.equal(h.element('scenePreviewCanvas').hidden, true);
    for (const id of ['scenePreviewEdit', 'scenePreviewLayoutEdit', 'scenePreviewDraftLayoutEdit']) h.element(id).dispatch('click');
  }
  assert.equal(h.writes.length, 0); assert.equal(h.paints.filter(item => item.name === 'setScene' && item.args[0]).length, 0);
});

async function buildHarness({ onlyRecipe = false } = {}) {
  const calls = [], drafts = [], writes = [], context = { editable: true, dirty: true, path: sourcePath, sceneDraftPath: sourcePath, sceneDraftWritable: true };
  let callbacks;
  const state = { supported: true, available: true, scenes: onlyRecipe ? [] : [sceneEntry], previewDocuments: [...(onlyRecipe ? [] : [{ ...sceneEntry, kind: 'scene' }]), recipeEntry] };
  const h = await dialogHarness('app-project-build', {
    PROJECT_BUILD_API_PATH: '/api/project-build',
    setupScenePreview: options => { callbacks = options; return { setAvailable() {}, setScene() {}, setVisible() {}, invalidate() {} }; },
    setupSceneLayout: () => ({ setAvailable() {}, setSourceAvailable() {}, open: (...args) => writes.push(args), openSource: (...args) => writes.push(args) }),
    fetchJsonApiRequest: async (url, request) => { calls.push({ url, request }); return { payload: state }; },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => context, getSceneDraft: async path => { drafts.push(path); return { sourcePath: path, content: 'recipe draft', baseSourceRevision: base }; } });
  controller.setAvailable(true, ['scene.update'], { scenePreview: true }); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, controller, context, calls, drafts, writes, callbacks, state };
}

test('recipe-only projects offer current recipe previews and drafts while build selectors and jobs remain empty', async () => {
  const h = await buildHarness({ onlyRecipe: true });
  assert.equal(h.element('projectBuildScene').children.length, 0); assert.equal(h.element('projectBuildPlan').disabled, true);
  h.element('projectBuildTabPreview').click();
  assert.equal(h.element('projectBuildScene').value, recipeId); assert.equal(h.element('projectBuildSceneLabel').textContent, '预览文档');
  assert.equal(h.callbacks.getContext().previewKind, 'composition'); assert.equal(h.callbacks.getContext().canPreviewDraft, true);
  assert.equal(h.callbacks.getContext().canEditDraftLayout, false); assert.equal(h.callbacks.getContext().canEditScene, false);
  await h.callbacks.getDraft(recipeId); assert.deepEqual(h.drafts, [sourcePath]);
  h.context.dirty = false;
  for (const id of ['projectBuildPlan', 'projectBuildGenerate', 'projectBuildHeadless', 'projectBuildWindow', 'projectBuildEditScene']) h.element(id).dispatch('click');
  assert.equal(h.callbacks.editLayout({ model: preview() }), false);
  assert.equal(await h.callbacks.editDraftLayout({ model: preview({ draft: true }), isCurrent: () => true }), false);
  assert.equal(h.writes.length, 0); assert.equal(h.calls.filter(call => call.request.method === 'POST').length, 0);
  h.element('projectBuildTabBuild').click(); assert.equal(h.element('projectBuildScene').value, ''); assert.equal(h.element('projectBuildScene').children.length, 0);
  assert.equal(h.element('projectBuildPlan').disabled, true);
  h.element('projectBuildTabPreview').click(); assert.equal(h.element('projectBuildScene').value, recipeId);
});

test('mixed projects remember separate preview and build choices, filter forged picker values and preserve ordinary scene editing', async () => {
  const h = await buildHarness(); assert.equal(h.element('projectBuildScene').value, sceneId);
  h.element('projectBuildTabPreview').click(); assert.equal(h.element('projectBuildScene').value, recipeId);
  h.element('projectBuildTabBuild').click(); assert.equal(h.element('projectBuildScene').value, sceneId);
  assert.equal(h.element('projectBuildScene').children.length, 1);
  h.element('projectBuildScene').value = recipeId; h.element('projectBuildScene').dispatch('change');
  assert.equal(h.element('projectBuildScene').value, sceneId);
  h.context.dirty = false; h.controller.setAvailable(true, ['scene.update'], { scenePreview: true });
  assert.equal(h.element('projectBuildPlan').disabled, false); assert.equal(h.callbacks.getContext().canEditScene, true);
  h.element('projectBuildTabPreview').click(); assert.equal(h.element('projectBuildScene').value, recipeId);
  h.element('projectBuildPlan').dispatch('click'); await flushDialogs(); assert.equal(h.calls.filter(call => call.request.method === 'POST').length, 0);
  h.element('projectBuildScene').value = sceneId; h.element('projectBuildScene').dispatch('change');
  assert.equal(h.callbacks.getContext().previewKind, 'scene'); assert.equal(h.callbacks.getContext().canEditScene, true);
  h.callbacks.editLayout({ model: { scene: { objectId: sceneId } } }); assert.equal(h.writes.length, 1);
});
