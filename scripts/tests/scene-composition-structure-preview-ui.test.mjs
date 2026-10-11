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
  const calls = [], opened = [], writes = [], paints = [], structureCalls = []; let structureAction=()=>true;
  const context = { editable: true, dirty: false, creating: false, busy: false, canEditScene: true, canPreviewDraft: true,
    compositionSourceWritable:true,canEditCompositionStructure:true,canEditCompositionFragment:true,sceneDraftPath:sourcePath,canEditDraftLayout: true, sceneDraftToken: 1, previewKind: 'composition' };
  const h = await dialogHarness('app-scene-preview', {
    SCENE_PREVIEW_API_PATH: '/api/scene-preview',
    createScenePreviewCanvas: () => Object.fromEntries(['setScene', 'setImages', 'setVisible', 'select', 'fit', 'zoom', 'setGrid', 'destroy'].map(name => [name, (...args) => paints.push({ name, args })])),
    fetchJsonApiRequest(url, request) { const wait = deferred(); calls.push({ url, request, ...wait }); if (request.method === 'DELETE') wait.resolve({ payload: { ok: true } }); return wait.promise; },
  });
  const container = h.document.createElement('section'); h.document.body.append(container);
  const controller = h.runtime.setupScenePreview({ container, getContext: () => context,
    getDraft: async () => ({ sourcePath, baseSourceRevision: base, content: '{"format":"viento-scene-composition"}' }),
    openSource: (...args) => opened.push(args), editScene: (...args) => writes.push(args), editLayout: (...args) => writes.push(args), editDraftLayout: (...args) => writes.push(args),editCompositionStructure: input=>{structureCalls.push(input);return structureAction(input);} });
  t.after(() => controller.destroy()); controller.setAvailable(true); controller.setScene(recipeId); controller.setVisible(true);
  const posts = () => calls.filter(call => call.request.method === 'POST');
  const post = () => posts().at(-1);
  const resolve = async payload => { post().resolve({ payload }); await flushDialogs(); };
  const selectActor = () => h.element('scenePreviewObjects').querySelector(`button[data-actor-id="${instanceId}"]`).click();
  const sources = () => h.element('scenePreviewProperties').querySelectorAll('button');
  return { ...h, structureCalls,setStructureAction:value=>{structureAction=value;},container, controller, context, calls, opened, writes, paints, post, posts, resolve, selectActor, sources };
}


test('structure toolbar opens the whole composition without requiring a selected actor',async t=>{
 const h=await previewHarness(t);await h.resolve(preview());assert.equal(h.element('scenePreviewCompositionStructure').hidden,false);assert.equal(h.element('scenePreviewCompositionStructure').disabled,false);
 h.element('scenePreviewCompositionStructure').click();await flushDialogs();assert.equal(h.structureCalls.length,1);assert.equal(h.structureCalls[0].actorId,null);assert.equal(h.structureCalls[0].isCurrent(),true);
 assert.equal(h.structureCalls[0].model.composition.recipeObjectId,recipeId);assert.equal(h.posts().length,1);
});
test('actor selection is a view preference and cannot invalidate an opened shared structure editor',async t=>{
 const h=await previewHarness(t),p=deferred();h.setStructureAction(()=>p.promise);await h.resolve(preview());h.element('scenePreviewCompositionStructure').click();
 assert.equal(h.element('scenePreviewCompositionBatchLayout').disabled,true);h.selectActor();assert.equal(h.structureCalls[0].isCurrent(),true);
 assert.equal(h.element('scenePreviewCompositionFragment').disabled,true);p.resolve(true);await flushDialogs();assert.equal(h.element('scenePreviewCompositionStructure').disabled,false);
});
test('dirty source requires a matching draft preview before shared structure editing',async t=>{
 const h=await previewHarness(t);h.context.dirty=true;await h.resolve(preview());assert.equal(h.element('scenePreviewCompositionStructure').disabled,true);h.element('scenePreviewCompositionStructure').dispatch('click');assert.equal(h.structureCalls.length,0);
 h.element('scenePreviewDraftRefresh').click();await flushDialogs();await h.resolve(preview({draft:true}));assert.equal(h.element('scenePreviewCompositionStructure').disabled,false);
 h.context.sceneDraftToken++;h.element('scenePreviewCompositionStructure').dispatch('click');assert.equal(h.structureCalls.length,0);
});
test('source token, hidden preview and document replacement suppress late structure failures',async t=>{
 for(const change of ['token','hide','scene']){const h=await previewHarness(t),p=deferred();h.setStructureAction(()=>p.promise);await h.resolve(preview());h.element('scenePreviewCompositionStructure').click();
 if(change==='token')h.context.sceneDraftToken++;else if(change==='hide')h.controller.setVisible(false);else h.controller.setScene(sceneId);
 assert.equal(h.structureCalls[0].isCurrent(),false);p.reject(new Error('late private error'));await flushDialogs();assert.ok(!h.container.textContent.includes('结构编辑暂不可用'));
 }
});
test('capability and source ownership are checked at click time and structure failures stay localized',async t=>{
 const h=await previewHarness(t);await h.resolve(preview());
 for(const change of [{canEditCompositionStructure:false},{compositionSourceWritable:false},{editable:false},{creating:true},{busy:true},{sceneDraftPath:'elsewhere.json'}]){const previous={...h.context};Object.assign(h.context,change);h.element('scenePreviewCompositionStructure').dispatch('click');Object.assign(h.context,previous);}
 assert.equal(h.structureCalls.length,0);h.setStructureAction(()=>false);h.element('scenePreviewCompositionStructure').click();await flushDialogs();assert.ok(h.container.textContent.includes('片段结构编辑暂不可用'));
});
