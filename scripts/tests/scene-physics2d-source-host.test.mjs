import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { createScenePhysics2DSourceHost } from '../../web/modules/app-scene-physics2d-source.js';
import { createScenePhysics2DProposal } from '../../engine/scene-physics2d-edit.mjs';
const id = n => `81818181-8181-4181-8181-${String(n).padStart(12, '0')}`;
const model = () => ({ format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: id(1), bodies: [
  { id: id(2), instanceId: id(3), kind: 'static', shape: { kind: 'box', size: [20, 30] }, offset: [0, 0], layer: 1, mask: 1 },
] });
const original = '\ufeff' + JSON.stringify(model(), null, '\t').replaceAll('\n', '\r\n') + '\r\n';
const hash = value => createHash('sha256').update(value).digest('hex');
const revision = value => `sha256:${hash(value)}`;
const conflict = error => error.errorCode === 'scene_physics2d_authoring_conflict';
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const state = { document: {}, token: 'host:1', sourcePath: 'documents/physics/room.json', content: original,
    baseline: original, version: revision(original), editable: true, creating: false, busy: false, available: true, sourceJSON: true };
  let calls = 0, at = 0, gate, entered, focuses = 0; const writes = [];
  const host = createScenePhysics2DSourceHost({ getState: () => ({ ...state }),
    digest: async value => { if (++calls === at) { entered.resolve(); await gate.promise; } return hash(value); },
    writeDraft: content => { writes.push(content); state.content = content; state.token += ':draft'; }, focus: () => focuses++ });
  return { host, state, writes, focuses: () => focuses, block(offset) { at = calls + offset; gate = deferred(); entered = deferred(); },
    blocked: () => entered.promise, release: () => gate.resolve() };
}
async function review(h) { const edit = { bodies: model().bodies }; edit.bodies[0].shape.size[0] = 22; return createScenePhysics2DProposal(await h.host.getSource(), edit); }

test('physics source host grants only source5 and ordinary draft application with separately hashed dirty source', async () => {
  const h = fixture(); h.state.content = original.replace('20,', '21,');
  const source = await h.host.getSource();
  assert.deepEqual(Object.keys(h.host).sort(), ['applyDraft', 'getContext', 'getSource']); assert.ok(Object.isFrozen(h.host));
  assert.deepEqual(Object.keys(source).sort(), ['baseSourceRevision', 'content', 'sourcePath', 'sourceRevision', 'token']);
  assert.ok(Object.isFrozen(source)); assert.equal(source.baseSourceRevision, revision(original)); assert.equal(source.sourceRevision, revision(h.state.content));
  assert.notEqual(source.sourceRevision, source.baseSourceRevision); assert.equal(h.host.getContext().physicsSource, true);
  const proposal = await review(h), result = await h.host.applyDraft(proposal);
  assert.deepEqual(h.writes, [proposal.afterContent]); assert.equal(h.state.baseline, original); assert.equal(h.state.version, revision(original));
  assert.equal(result.content, proposal.afterContent); assert.equal(result.sourceToken, h.host.getContext().sourceToken);
  result.focus(); assert.equal(h.focuses(), 1); h.state.content += ' '; result.focus(); assert.equal(h.focuses(), 1);
});

test('cloned replayed or accessor proposals never gain draft write authority', async () => {
  const h = fixture(), proposal = await review(h); let accessed = 0;
  for (const value of [structuredClone(proposal), Object.defineProperty({}, 'sourcePath', { get() { accessed++; return proposal.sourcePath; } })]) {
    await assert.rejects(h.host.applyDraft(value), conflict);
  }
  assert.equal(accessed, 0); assert.deepEqual(h.writes, []);
  await h.host.applyDraft(proposal); await assert.rejects(h.host.applyDraft(proposal), conflict); assert.equal(h.writes.length, 1);
});

test('every source ownership change revokes apply across all three digest waits', async () => {
  for (const offset of [1, 2, 3]) for (const key of ['content', 'baseline', 'version', 'document', 'token', 'sourcePath', 'busy', 'editable', 'available', 'creating', 'sourceJSON']) {
    const h = fixture(), proposal = await review(h); h.block(offset);
    const pending = h.host.applyDraft(proposal); await h.blocked();
    h.state[key] = key === 'document' ? {} : typeof h.state[key] === 'boolean' ? !h.state[key] : h.state[key] + ' ';
    h.release(); await assert.rejects(pending, conflict); assert.deepEqual(h.writes, [], `${offset}:${key}`);
  }
});

test('cancel and a reentrant caller guard cannot change source between approval and synchronous write', async () => {
  const h = fixture(); await assert.rejects(h.host.applyDraft(await review(h), { isCurrent: () => false }), conflict); assert.deepEqual(h.writes, []);
  for (const at of [1, 2, 3, 4]) {
    const f = fixture(), proposal = await review(f); let calls = 0;
    await assert.rejects(f.host.applyDraft(proposal, { isCurrent() { if (++calls === at) f.state.content += ' '; return true; } }), conflict);
    assert.deepEqual(f.writes, [], `guard ${at}`);
  }
});

test('read hashing and observed capability transitions revoke stale ownership without overwriting drafts', async () => {
  for (const offset of [1, 2]) {
    const h = fixture(); h.block(offset); const pending = h.host.getSource(); await h.blocked(); h.state.token += ':moved'; h.release();
    assert.equal(await pending, null); assert.deepEqual(h.writes, []);
  }
  const h = fixture(), proposal = await review(h); h.state.available = false; h.host.getContext(); h.state.available = true;
  await assert.rejects(h.host.applyDraft(proposal), conflict); assert.deepEqual(h.writes, []);
});

test('recognition accepts only bounded physical JSON and never asserts registration or scene membership', async () => {
  for (const patch of [{ sourceJSON: false }, { creating: true }, { editable: false }, { busy: true }, { available: false }, { document: null }]) {
    const h = fixture(); Object.assign(h.state, patch); assert.equal(await h.host.getSource(), null);
  }
  for (const content of [original.replace('viento-scene-physics2d', 'viento-scene-audio'), '{broken',
    original.replace('"schemaVersion": 1', '"schemaVersion": 1,"schemaVersion": 1'),
    JSON.stringify({ ...model(), extra: '界'.repeat(23000) })]) {
    const h = fixture(); h.state.content = content; assert.equal(h.host.getContext().physicsSource, false); assert.equal(await h.host.getSource(), null);
  }
  const h = fixture(); h.state.content = original.replace('"mask": 1', '"mask": -1');
  assert.equal(h.host.getContext().physicsSource, true, 'format recognition is distinct from Rust semantic validation');
  assert.equal(Object.hasOwn(h.host.getContext(), 'registered'), false);
  h.state.version = `sha256:${'0'.repeat(64)}`; assert.equal(await h.host.getSource(), null);
});

test('malformed digest receipts cannot be exposed as captured source identity', async () => {
  const h = fixture();
  for (const digest of [() => 'not-a-digest', () => null, () => 'A'.repeat(64)]) {
    const host = createScenePhysics2DSourceHost({ getState: () => h.state, digest, writeDraft: () => assert.fail('unexpected write') });
    assert.equal(await host.getSource(), null);
  }
});

const runtime = await fs.readFile(new URL('../../web/modules/app-runtime.js', import.meta.url), 'utf8');
const wiring = runtime.slice(runtime.indexOf('  const physicsSourceHost = createScenePhysics2DSourceHost({'), runtime.indexOf('  const animationStateScriptSourceHost'));
function runtimeFixture() {
  let content = original, core = true, busy = false;
  const doc = { path: 'physics', _sourceCachedText: original }, state = { isEditing: true, isCreating: false, editInputMode: 'source', activeEditPath: 'physics', activeEditSource: 'documents/physics/room.json', editHasUnsavedChanges: false };
  const editor = { selectionStart: 10, selectionEnd: 30, scrollTop: 80, scrollLeft: 12, focused: 0,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }, focus() { this.focused++; } };
  const statuses = [], context = vm.createContext({ state, editorLoadToken: 2, scenePreviewDraftEpoch: 3,
    editSessionBaselineContent: original, editSessionVersion: revision(original), editEditorEl: editor, createScenePhysics2DSourceHost,
    getActiveDoc: () => doc, canonicalizeSourcePath: value => value, getCurrentEditContent: () => content,
    isEditModeActive: () => true, isEditorBusy: () => busy, supportsStudioCoreScenePhysics2D: () => core,
    setSourceEditorContent(value) { content = value; }, refreshEditSessionDirtyState() { state.editHasUnsavedChanges = content !== context.editSessionBaselineContent; context.scenePreviewDraftEpoch++; },
    refreshEditButtons() {}, setEditorStatus: value => statuses.push(value), t: value => value, crypto: webcrypto, TextEncoder });
  const host = vm.runInContext(wiring + '\nphysicsSourceHost', context);
  return { host, doc, state, editor, context, statuses, content: () => content, core: value => { core = value; }, busy: value => { busy = value; } };
}

test('actual runtime wiring applies only draft bytes and preserves baseline cache caret scroll and ordinary Save', async () => {
  const h = runtimeFixture(), proposal = await review(h), receipt = await h.host.applyDraft(proposal);
  assert.equal(h.content(), proposal.afterContent); assert.equal(h.state.editHasUnsavedChanges, true);
  assert.equal(h.context.editSessionBaselineContent, original); assert.equal(h.context.editSessionVersion, revision(original)); assert.equal(h.doc._sourceCachedText, original);
  assert.equal(h.editor.selectionStart, 10); assert.equal(h.editor.selectionEnd, 30); assert.equal(h.editor.scrollTop, 80); assert.equal(h.editor.scrollLeft, 12);
  assert.match(h.statuses.at(-1), /尚未保存/); receipt.focus(); assert.equal(h.editor.focused, 1);
  assert.doesNotMatch(wiring, /fetch\s*\(|saveEdit|setEditSessionClean|buildProject|inspectSceneAnimation|inspectSceneAudio|\.request\s*\(/);
});

test('actual runtime gates physical editing on only its own core and source ownership', async () => {
  const h = runtimeFixture(); assert.ok(await h.host.getSource()); h.core(false); assert.equal(await h.host.getSource(), null);
  h.core(true); h.state.editInputMode = 'fields'; assert.equal(await h.host.getSource(), null);
  h.state.editInputMode = 'source'; h.state.isCreating = true; assert.equal(await h.host.getSource(), null);
  h.state.isCreating = false; h.state.activeEditPath = 'other'; assert.equal(await h.host.getSource(), null);
  h.state.activeEditPath = 'physics'; h.busy(true); assert.equal(await h.host.getSource(), null);
  h.busy(false); assert.ok(await h.host.getSource());
});
