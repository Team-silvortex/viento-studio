import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { editorHarness, deferred } from './editor-harness.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { createSceneScriptReturnHost } from '../../web/modules/app-scene-script-return-host.js';
import { listScriptStarters, prepareScriptDraft, prepareAnimationStateScriptDraft, DEFAULT_ANIMATION_STATE_TABLE, supportsAnimationStateScript } from '../../engine/script-authoring.mjs';
import { setupAnimationStateScript } from '../../web/modules/app-animation-state-script.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const revision = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const origin = () => ({ worldId: 'world:' + 'a'.repeat(64), documentRoot: 'documents', scene: { objectId: id(1), objectRevision: revision('scene-record'), sourcePath: 'documents/scenes/game.json', sourceRevision: revision('scene-source') }, backendId: 'org.viento.godot4', language: 'gdscript' });
const settle = async () => { await flushDialogs(); await flushDialogs(); };
async function fixture(options = {}) {
  const writes = [], events = [], errors = [];
  const h = await editorHarness({ writeDoc: async value => { const submitted = clone(value); writes.push(submitted); events.push({ kind: 'write', sourcePath: value.pathValue, content: value.content });
    return options.write ? options.write(submitted, writes.length) : { version: revision(value.content) }; } });
  h.state.workspace = { id: id(9), version: 3, paths: { documents: 'documents' }, documentTypes: [{ id: 'notes', label: 'Notes', directory: 'notes', parserProfile: 'structured', template: 'notes.md', templateSource: 'templates/notes.md' }] };
  h.runtime.rebuildIndexForDoc = async (...args) => { events.push({ kind: 'index' }); return options.rebuild?.(...args); };
  h.runtime.logRuntimeErrorOrMessage = (_label, error) => { errors.push(error.message); return error.message; };
  const context = () => clone(h.runtime.sceneScriptReturnContext());
  const host = createSceneScriptReturnHost({ getContext: context, openSource: async () => { assert.fail('Save must never navigate to a scene'); } });
  // Browser production runs in one realm. The harness executes the complete
  // runtime in a VM: transport only its exact saved DTO into the real host's
  // realm, as existing editor ports do. No production contract is relaxed.
  h.runtime.hostForTest = { ...host, captureSave() { const value = host.captureSave(); events.push({ kind: 'capture', accepted: Boolean(value), context: context() }); return value; },
    saved(ticket, receipt) { const before = context(), accepted = host.saved(ticket, clone(receipt)); events.push({ kind: 'saved', receipt: clone(receipt), accepted, context: before }); return accepted; } };
  vm.runInContext('sceneScriptReturnHost = hostForTest', h.runtime);
  const token = host.begin(origin()); assert.ok(token);
  const prepare = (patch = {}) => { const { sourceToken, documentRoot, documentTypes } = h.runtime.scriptCreateContext(); return prepareScriptDraft(clone({ sourceToken, documentRoot, documentTypes }), { starterId: 'godot-node', documentType: 'notes', sourcePath: 'documents/scripts/behavior.txt', ...patch }); };
  function create(patch = {}) { const proposal = prepare(patch), receipt = h.runtime.createScriptDraft(proposal); assert.equal(receipt.applied, true);
    // A function receipt crosses the VM boundary without serialization; only
    // its declared data fields are copied, retaining its real focus callback.
    assert.equal(host.draftCreated(token, { applied: receipt.applied, sourcePath: receipt.sourcePath, content: receipt.content, focus: receipt.focus }), true); return { proposal, receipt }; }
  return { ...h, host, token, writes, events, errors, context, prepare, create };
}

test('actual new-document Save rejects a write without a receipt, retains creating text, and accepts only the successful retry bytes', async () => {
  const h = await fixture({ write: (value, count) => { if (count === 1) throw Error('write rejected'); return { version: revision(value.content) }; } });
  h.create(); h.source.value += '# ordinary author edit\n'; h.runtime.refreshEditSessionDirtyState(); const expected = h.runtime.getCurrentEditContent();
  assert.equal(h.host.get(h.token).savedScript, null); const first = await h.runtime.saveCurrentDoc(); assert.equal(first, undefined); assert.equal(h.state.isCreating, true); assert.equal(h.state.editHasUnsavedChanges, true); assert.equal(h.runtime.getCurrentEditContent(), expected); assert.equal(h.host.get(h.token).savedScript, null); assert.equal(h.host.get(h.token).canReturn, false);
  assert.equal(h.events.filter(value => value.kind === 'saved').length, 0); assert.equal(h.events.filter(value => value.kind === 'index').length, 0);
  const second = await h.runtime.saveCurrentDoc(); assert.equal(second, undefined); assert.equal(h.writes.length, 2); assert.deepEqual(h.writes.map(value => [value.pathValue, value.content, value.isCreate]), [['documents/scripts/behavior.txt', expected, true], ['documents/scripts/behavior.txt', expected, true]]);
  assert.deepEqual(h.host.get(h.token).savedScript, { sourcePath: 'documents/scripts/behavior.txt', sourceRevision: revision(expected) }); assert.equal(h.state.isCreating, false); assert.equal(h.state.editHasUnsavedChanges, false); assert.equal(h.host.get(h.token).canReturn, true);
  const saved = h.events.find(value => value.kind === 'saved'); assert.equal(saved.accepted, true); assert.equal(saved.context.busy, true); assert.equal(saved.context.creating, true); assert.equal(saved.context.content, expected);
  assert.deepEqual(h.events.map(value => value.kind), ['capture', 'write', 'capture', 'write', 'saved', 'index']);
});

test('actual later existing-document Save refreshes the correlated path and SHA from the successful write before the index hook', async () => {
  const h = await fixture(); const { proposal } = h.create({ starterId: 'godot-signal' }); await h.runtime.saveCurrentDoc(); const first = h.host.get(h.token).savedScript;
  h.source.value += '\n# second ordinary revision\n'; h.runtime.refreshEditSessionDirtyState(); const expected = h.runtime.getCurrentEditContent(); assert.notEqual(revision(expected), first.sourceRevision);
  await h.runtime.saveCurrentDoc(); assert.equal(h.writes.length, 2); assert.equal(h.writes[1].isCreate, undefined); assert.equal(h.writes[1].pathValue, proposal.sourcePath); assert.equal(h.writes[1].expectedVersion, revision(proposal.content));
  assert.equal(h.writes[1].content, expected); assert.deepEqual(h.host.get(h.token).savedScript, { sourcePath: proposal.sourcePath, sourceRevision: revision(expected) });
  const saved = h.events.filter(value => value.kind === 'saved'); assert.equal(saved.length, 2); assert.equal(saved[1].accepted, true); assert.equal(saved[1].context.creating, false); assert.equal(saved[1].context.busy, true); assert.equal(h.host.get(h.token).canReturn, true);
  assert.deepEqual(h.events.slice(-4).map(value => value.kind), ['capture', 'write', 'saved', 'index']);
});

test('a late actual write after a forced editor-session replacement cannot activate the old script return receipt', async () => {
  const wait = deferred(), h = await fixture({ write: () => wait.promise }); h.create(); const original = h.runtime.getCurrentEditContent(), saving = h.runtime.saveCurrentDoc(); await settle(); assert.equal(h.writes.length, 1);
  // Simulate an external workspace/editor reset during outstanding I/O. The
  // existing Save storage path is outside this change; assert only that the
  // return correlation rejects that old owner before later editor mutations.
  h.runtime.resetDocEditorState(); h.state.isSaving = false; const next = h.prepare({ sourcePath: 'documents/scripts/unrelated.txt' }); h.runtime.createScriptDraft(next); const switched = h.context();
  assert.equal(switched.creating, true); assert.equal(switched.sourcePath, next.sourcePath); wait.resolve({ version: revision(original) }); await saving;
  assert.equal(h.host.get(h.token).savedScript, null); const observed = h.events.find(value => value.kind === 'saved'); assert.ok(observed); assert.equal(observed.accepted, false); assert.equal(observed.context.editorSession, switched.editorSession); assert.equal(observed.context.sourcePath, next.sourcePath);
  assert.equal(h.writes[0].pathValue, 'documents/scripts/behavior.txt'); assert.equal(h.writes[0].content, original);
});

test('index failure cannot turn a rejected write into success; a completed write receipt remains observational until fresh directory validation', async () => {
  for (const writeFails of [true, false]) {
    const h = await fixture({ write: value => { if (writeFails) throw Error('write unavailable'); return { version: revision(value.content) }; }, rebuild: async () => { throw Error('index unavailable'); } });
    const { proposal } = h.create(); const returned = await h.runtime.saveCurrentDoc(); assert.equal(returned, undefined, 'ordinary save intentionally returns no success boolean');
    if (writeFails) { assert.equal(h.host.get(h.token).savedScript, null); assert.equal(h.state.isCreating, true); assert.equal(h.events.some(value => value.kind === 'index'), false); }
    else { assert.deepEqual(h.host.get(h.token).savedScript, { sourcePath: proposal.sourcePath, sourceRevision: revision(proposal.content) }); assert.equal(h.state.isCreating, false); assert.ok(h.errors.includes('index unavailable')); assert.deepEqual(h.events.map(value => value.kind), ['capture', 'write', 'saved', 'index']); }
  }
});

async function scriptDialog(t, options = {}) {
  const context = { editable: true, busy: false, dirty: false, creating: false, sourceToken: 'create:1', documentRoot: 'documents', documentTypes: [{ id: 'notes', label: 'Notes' }] }, calls = [];
  const h = await dialogHarness('app-script-create', { listScriptStarters, DEFAULT_ANIMATION_STATE_TABLE, supportsAnimationStateScript, setupAnimationStateScript,
    prepareScriptDraft: (owner, request) => prepareScriptDraft(clone(owner), clone(request)), prepareAnimationStateScriptDraft: (owner, request, table) => prepareAnimationStateScriptDraft(clone(owner), clone(request), clone(table)) });
  const controller = h.runtime.setupScriptCreate({ getContext: () => context, createDraft: async (proposal, ports) => { assert.equal(ports.isCurrent(), true); calls.push(proposal); return options.createDraft ? options.createDraft(proposal) : { applied: true, sourcePath: proposal.sourcePath, content: proposal.content, focus() {} }; } });
  t.after(() => controller.dispose()); const el = suffix => h.element('scriptCreate' + suffix); h.runtime.window.confirm = () => true;
  return { ...h, context, controller, calls, el, async click(suffix) { el(suffix).click(); await settle(); } };
}

test('the real script chooser optional profile selects Bevy and delivers one onCreated receipt without an onCancel callback', async t => {
  const h = await scriptDialog(t), created = [], cancelled = [];
  assert.equal(h.controller.open({ backendId: 'org.viento.bevy-rust', language: 'rust', onCreated: receipt => { created.push(receipt); throw Error('optional consumer callback'); }, onCancel: () => cancelled.push(true) }), true);
  const selected = listScriptStarters().find(value => value.id === h.el('Starter').value); assert.equal(selected.backendId, 'org.viento.bevy-rust'); assert.equal(selected.languageId, 'rust');
  await h.click('Apply'); assert.equal(created.length, 1); assert.equal(created[0].applied, true); assert.equal(created[0].content, h.calls[0].content); assert.equal(h.el('Dialog').open, false); await h.click('Apply'); await h.click('Close'); assert.equal(created.length, 1); assert.equal(cancelled.length, 0);
});

test('the real script chooser invokes optional onCancel once and reopening without options never inherits callbacks or profile', async t => {
  const h = await scriptDialog(t), created = [], cancelled = [];
  assert.equal(h.controller.open({ backendId: 'org.viento.bevy-rust', language: 'rust', onCreated: receipt => created.push(receipt), onCancel: () => cancelled.push(true) }), true);
  await h.click('Cancel'); await h.click('Cancel'); assert.equal(cancelled.length, 1); assert.equal(created.length, 0); assert.equal(h.calls.length, 0);
  assert.equal(h.controller.open(), true); assert.equal(h.el('Starter').value, listScriptStarters()[0].id); await h.click('Apply'); assert.equal(h.calls.length, 1); assert.equal(cancelled.length, 1); assert.equal(created.length, 0); assert.equal(h.el('Dialog').open, false);
});
