import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { prepareSceneSourceLayoutApply, patchSceneSourcePositions } from '../../engine/scene-source-layout.mjs';
import { editorHarness, deferred } from './editor-harness.mjs';

const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const normalize = text => text.replace(/\r\n|\r/g, '\n');
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', definition = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const instance = '11111111-1111-4111-8111-111111111111', group = '22222222-2222-4222-8222-222222222222';
const sourcePath = 'documents/scenes/source.json';
const saved = '\uFEFF{\r\n  "format": "viento-scene2d", "schemaVersion": 3, "title": "原文😀",\r\n  "viewport": [640, 480], "background": "#111111",\r\n  "groups": [{"groupId":"'+group+'", "name":"归组"}],\r\n  "actors": [{"objectId":"'+definition+'", "instanceId":"'+instance+'", "groupId":"'+group+'", "position": [1e2, -0], "speed": 1.6e2, "size": [80,60], "color":"#ffffff", "controls":"none"}]\r\n}\r\n';
const input = saved.replace('原文😀', '未保存🌿😀');
function proposal(content = input) {
  const changes = [{ objectId: instance, position: [125, 0] }];
  return { sceneId, sourcePath, baseSourceRevision: hash(saved), sourceRevision: hash(content), changes,
    afterContent: patchSceneSourcePositions(content, changes).afterContent };
}
async function fixture(overrides = {}) {
  const reads = [], writes = [];
  const h = await editorHarness({ prepareSceneSourceLayoutApply,
    readDocSource: async value => { reads.push(value); throw Error('Unexpected disk read'); },
    writeDoc: async value => { writes.push(value); throw Error('Unexpected disk write'); }, ...overrides });
  h.doc.sourcePath = sourcePath; h.doc._sourceCachedText = saved; h.runtime.rebuildDocPathCaches(h.state.docs);
  h.begin(saved, hash(saved)); h.state.activeEditSource = sourcePath; h.state.activeEditPath = h.doc.path;
  h.source.value = normalize(input); h.runtime.refreshEditSessionDirtyState();
  return { ...h, reads, writes };
}
const current = h => h.runtime.getSourceEditorContent();

test('applying source layout edits only memory, preserves raw bytes, original save baseline and disk cache', async () => {
  const h = await fixture(), before = h.runtime.captureEditorDraft();
  h.source.setSelectionRange(2, 5); h.source.scrollTop = 42;
  const result = await h.runtime.applySceneSourceLayoutDraft(proposal());
  assert.equal(result.applied, true); assert.equal(current(h), input.replace('[1e2, -0]', '[125, -0]'));
  assert.equal(h.state.editHasUnsavedChanges, true); assert.equal(h.doc._sourceCachedText, saved);
  assert.equal(h.state.activeEditSourceVersion, hash(saved));
  const after = h.runtime.captureEditorDraft(); assert.equal(after.expectedVersion, before.expectedVersion); assert.equal(after.baselineContent, saved);
  assert.equal(after.content, proposal().afterContent); assert.equal(h.source.selectionStart, 2); assert.equal(h.source.scrollTop, 42);
  const preview = await h.runtime.getScenePreviewDraft(sourcePath); assert.equal(preview.content, after.content); assert.equal(preview.baseSourceRevision, hash(saved));
  assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
});

test('stale content, changed baseline, foreign path and unreviewed afterContent cannot replace current text', async () => {
  for (const alter of [value => { value.sourceRevision = hash(saved); }, value => { value.baseSourceRevision = hash('elsewhere'); },
    value => { value.sourcePath = 'documents/scenes/other.json'; }, value => { value.afterContent += ' '; },
    value => { value.changes[0].position[0] = 126; }, value => { value.changes[0].objectId = definition; }]) {
    const h = await fixture(), request = proposal(); alter(request);
    await assert.rejects(h.runtime.applySceneSourceLayoutDraft(request));
    assert.equal(current(h), input); assert.equal(h.doc._sourceCachedText, saved); assert.equal(h.state.editHasUnsavedChanges, true);
    assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
  }
});

test('only an active source-mode draft can accept layout results', async () => {
  for (const alter of [h => { h.state.editInputMode = 'blocks'; }, h => { h.state.editInputMode = 'fields'; },
    h => { h.state.isCreating = true; }, h => { h.state.isEditing = false; }, h => { h.state.mode = 'browse'; },
    h => { h.state.isMutatingWorld = true; }, h => { h.state.editHasUnsavedChanges = false; }]) {
    const h = await fixture(); alter(h);
    await assert.rejects(h.runtime.applySceneSourceLayoutDraft(proposal()), { errorCode: 'scene_source_layout_conflict' });
    assert.equal(h.source.value, normalize(input)); assert.equal(h.doc._sourceCachedText, saved);
    assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
  }
});

test('text, path, mode or save baseline changes during the baseline digest reject delayed layout results', async () => {
  for (const alter of [h => { h.source.value += ' '; h.runtime.refreshEditSessionDirtyState(); },
    h => { h.source.value += ' '; }, h => { h.state.activeEditSource = 'documents/other.json'; },
    h => { h.state.editInputMode = 'blocks'; }, h => { h.runtime.setEditSessionClean(input, hash(input)); }]) {
    const waiting = deferred();
    const h = await fixture({ crypto: { subtle: { digest: () => waiting.promise } } });
    const promise = h.runtime.applySceneSourceLayoutDraft(proposal()); alter(h); const expected = h.source.value;
    waiting.resolve(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(saved)));
    await assert.rejects(promise, { errorCode: 'scene_source_layout_conflict' }); assert.equal(h.source.value, expected);
    assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
  }
});

test('host rechecks editor ownership after portable patch preparation and before memory write', async () => {
  const waiting = deferred(), reached = deferred();
  const h = await fixture({ prepareSceneSourceLayoutApply: async (...args) => {
    const result = await prepareSceneSourceLayoutApply(...args); reached.resolve(); await waiting.promise; return result;
  } });
  const promise = h.runtime.applySceneSourceLayoutDraft(proposal()); await reached.promise;
  h.source.value = normalize(input.replace('未保存🌿😀', '更新的作者输入')); h.runtime.refreshEditSessionDirtyState();
  const expected = current(h); waiting.resolve();
  await assert.rejects(promise, { errorCode: 'scene_source_layout_conflict' }); assert.equal(current(h), expected);
  assert.equal(h.doc._sourceCachedText, saved); assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
});

test('language-only UI refresh keeps a pending source apply valid and replay of an old proposal is rejected', async () => {
  const waiting = deferred(), reached = deferred();
  const h = await fixture({ prepareSceneSourceLayoutApply: async (...args) => {
    const result = await prepareSceneSourceLayoutApply(...args); reached.resolve(); await waiting.promise; return result;
  } });
  const request = proposal(), promise = h.runtime.applySceneSourceLayoutDraft(request); await reached.promise;
  h.runtime.updateEditUnsavedUi(); h.runtime.updateEditUnsavedUi(); waiting.resolve();
  assert.equal((await promise).applied, true); assert.equal(current(h), request.afterContent);
  await assert.rejects(h.runtime.applySceneSourceLayoutDraft(request), { errorCode: 'scene_source_layout_conflict' });
  assert.equal(current(h), request.afterContent); assert.equal(h.runtime.captureEditorDraft().expectedVersion, hash(saved));
});


test('origin layout or preview owner is rechecked after each asynchronous preparation stage', async () => {
  for (const stage of ['baseline', 'proposal']) {
    const waiting = deferred(), reached = deferred(); let active = true;
    const h = await fixture(stage === 'baseline' ? { crypto: { subtle: { digest: async (...args) => {
      reached.resolve(); await waiting.promise; return webcrypto.subtle.digest(...args);
    } } } } : { prepareSceneSourceLayoutApply: async (...args) => {
      const result = await prepareSceneSourceLayoutApply(...args); reached.resolve(); await waiting.promise; return result;
    } });
    const promise = h.runtime.applySceneSourceLayoutDraft(proposal(), { isCurrent: () => active });
    await reached.promise; active = false; waiting.resolve();
    await assert.rejects(promise, { errorCode: 'scene_source_layout_conflict' });
    assert.equal(current(h), input); assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
  }
});

test('returning coordinates to the exact baseline clears dirty state without writing the saved file', async () => {
  const h = await fixture(); h.runtime.setSourceEditorContent(saved.replace('[1e2, -0]', '[125, -0]'));
  h.runtime.refreshEditSessionDirtyState();
  const content = current(h), changes = [{ objectId: instance, position: [100, 0] }];
  // A coordinate originally written as an exponent remains different bytes
  // when changed back to a decimal: only an exact baseline clears dirty state.
  const next = patchSceneSourcePositions(content, changes).afterContent;
  h.runtime.setEditSessionClean(saved.replace('1e2', '100'), hash(saved.replace('1e2', '100')));
  h.runtime.setSourceEditorContent(content); h.runtime.refreshEditSessionDirtyState();
  const request = { sceneId, sourcePath, baseSourceRevision: hash(saved.replace('1e2', '100')), sourceRevision: hash(content), changes, afterContent: next };
  assert.equal((await h.runtime.applySceneSourceLayoutDraft(request)).applied, true);
  assert.equal(h.state.editHasUnsavedChanges, false); assert.equal(current(h), next);
  assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
});
