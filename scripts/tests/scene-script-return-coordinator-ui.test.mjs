import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { createSceneScriptReturnHost } from '../../web/modules/app-scene-script-return-host.js';

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const revision = character => 'sha256:' + character.repeat(64);
const origin = () => ({ worldId: 'world:' + 'a'.repeat(64), documentRoot: 'documents', scene: {
  objectId: id(1), objectRevision: revision('b'), sourcePath: 'documents/scenes/level.json', sourceRevision: revision('c'),
}, backendId: 'org.viento.godot4', language: 'gdscript' });
const sourcePath = 'documents/scripts/new-script.txt';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const clone = value => JSON.parse(JSON.stringify(value));
const catalog = () => ({ format: 'viento-behavior-creation-context', schemaVersion: 1, worldId: origin().worldId,
  documentRoot: 'documents', scene: { ...origin().scene, instances: [] },
  sources: [{ objectId: id(2), sourcePath, sourceRevision: revision('d'), name: 'New script' }] });
const settle = async () => { for (let index = 0; index < 4; index++) await flushDialogs(); };

async function fixture(t, options = {}) {
  let languageListener, unsubscribed = 0;
  const h = await dialogHarness('app-scene-script-return', { onLanguageChange: fn => { languageListener = fn; return () => { unsubscribed++; }; } });
  const context = { editable: true, busy: false, dirty: false, creating: false, workspaceId: id(9), editorSession: '1', sourcePath: origin().scene.sourcePath, content: '{}' };
  const tokens = [], opened = [], scriptRequests = [], suspended = [], resumed = [], discarded = [], inspected = [];
  const heldDraft = { objectId: id(10), path: 'documents/../unfinished.json', selectedBindingId: id(11), bindings: [{ bindingId: id(11), instanceId: id(12), sourceObjectId: '' }] };
  const beforeDraft = clone(heldDraft), behaviorTicket = Object.freeze({}); let currentCatalog = catalog(), picker = null;
  const host = createSceneScriptReturnHost({ getContext: () => ({ ...context }), openSource: async (path, request) => {
    opened.push({ path, request });
    if (options.openSource) return options.openSource(path, request, context);
    assert.equal(request.isCurrent(), true); Object.assign(context, { busy: true, editorSession: 'return-load', sourcePath: path });
    assert.equal(request.isCurrent(), true); context.busy = false; return { focus() {} };
  } });
  // Only plain port DTOs cross this VM boundary. The production host remains
  // unmodified; its strict descriptor checks run in the same realm as its ports.
  const ports = Object.freeze({
    begin(input) { const token = host.begin(input); if (token) tokens.push(token); return token; },
    draftCreated: (token, receipt) => host.draftCreated(token, receipt), get: token => host.get(token), clear: token => host.clear(token),
    returnSource: (token, request) => host.returnSource(token, { isCurrent: request.isCurrent }),
  });
  const controller = h.runtime.setupSceneScriptReturn({ host: ports, translate: value => value,
    openScript(request) {
      scriptRequests.push(request);
      if (options.openScript) return options.openScript(request);
      picker = h.document.createElement('dialog'); picker.id = 'fixtureScriptPicker'; h.document.body.append(picker); picker.showModal(); return true;
    },
    suspendBehavior(input) { suspended.push(input); return options.suspend === false ? false : behaviorTicket; },
    async resumeBehavior(ticket, request) {
      resumed.push({ ticket, request }); assert.equal(ticket, behaviorTicket); assert.equal(request.isCurrent(), true);
      assert.deepEqual(heldDraft, beforeDraft); return options.resume ? options.resume(ticket, request) : true;
    },
    discardBehavior(ticket) { discarded.push(ticket); assert.equal(ticket, behaviorTicket); return options.discard === false ? false : true; },
    inspect: async request => { inspected.push(request); return options.inspect ? options.inspect(request, clone(currentCatalog), inspected.length) : clone(currentCatalog); },
  });
  t.after(() => controller.dispose());
  const element = suffix => h.document.getElementById('sceneBehaviorScript' + suffix);
  function closePicker() { if (picker?.open) picker.close(); }
  function cancelPicker() { closePicker(); scriptRequests.at(-1).onCancel(); controller.refresh(); }
  function createDraft(content = 'extends Node\r\n# local draft\r\n') {
    closePicker(); Object.assign(context, { editorSession: '2', creating: true, dirty: true, sourcePath, content });
    scriptRequests.at(-1).onCreated({ applied: true, sourcePath, content, focus() {} }); controller.refresh();
  }
  function save(version = revision('d')) {
    context.busy = true; const ticket = host.captureSave(); assert.ok(ticket);
    assert.equal(host.saved(ticket, { sourcePath: context.sourcePath, sourceRevision: version }), true);
    Object.assign(context, { creating: false, dirty: false, busy: false, editorSession: 'after-index' }); controller.refresh(); return ticket;
  }
  return { ...h, controller, host, context, tokens, opened, scriptRequests, suspended, resumed, discarded, inspected, heldDraft, beforeDraft,
    element, cancelPicker, createDraft, save, closePicker, setCatalog: next => { currentCatalog = next; }, language: () => languageListener?.(), unsubscribed: () => unsubscribed,
    async back() { element('Return').click(); await settle(); } };
}

test('request suspends once, forwards only starter preferences, and cannot overwrite a pending normal request', async t => {
  const h = await fixture(t), input = origin(); assert.equal(h.controller.request(input), true);
  assert.equal(h.suspended.length, 1); assert.equal(h.scriptRequests.length, 1); assert.equal(h.scriptRequests[0].backendId, input.backendId); assert.equal(h.scriptRequests[0].language, input.language);
  assert.equal(h.element('Tools').hidden, false); assert.equal(h.element('Return').disabled, true, 'the open picker owns focus');
  assert.equal(h.controller.request(origin()), false); assert.equal(h.tokens.length, 1); assert.deepEqual(h.heldDraft, h.beforeDraft);
  assert.equal(h.opened.length, 0); assert.equal(h.inspected.length, 0);
});

test('picker cancellation returns explicitly without manufacturing a saved script or changing the held behavior draft', async t => {
  const h = await fixture(t); h.controller.request(origin()); h.cancelPicker(); await settle();
  assert.equal(h.host.get(h.tokens[0]).stage, 'chooser'); assert.equal(h.element('Return').disabled, false); assert.equal(h.opened.length, 0);
  await h.back(); assert.equal(h.inspected.length, 1); assert.equal(h.opened.length, 1); assert.equal(h.opened[0].path, origin().scene.sourcePath);
  assert.equal(h.opened[0].request.sourceRevision, origin().scene.sourceRevision); assert.equal(h.resumed.length, 1); assert.equal(h.resumed[0].request.savedScript, null);
  assert.equal(h.host.get(h.tokens[0]), null); assert.equal(h.element('Tools').hidden, true); assert.deepEqual(h.heldDraft, h.beforeDraft);
});

test('actual host write receipt enables explicit return with the exact saved script after ordinary index-session replacement', async t => {
  const h = await fixture(t); h.controller.request(origin()); h.createDraft(); assert.equal(h.host.get(h.tokens[0]).stage, 'draft');
  h.save(); assert.equal(h.host.get(h.tokens[0]).stage, 'saved'); assert.equal(h.element('Return').disabled, false); assert.equal(h.opened.length, 0);
  await h.back(); assert.equal(h.resumed.length, 1); assert.deepEqual(clone(h.resumed[0].request.savedScript), { sourcePath, sourceRevision: revision('d') });
  assert.equal(h.opened.length, 1); assert.equal(h.context.editorSession, 'return-load'); assert.deepEqual(h.heldDraft, h.beforeDraft);
});

test('unsaved or failed ordinary Save keeps the script and behavior input and cannot start return inspection', async t => {
  const h = await fixture(t); h.controller.request(origin()); h.createDraft(); const text = h.context.content;
  await h.back(); assert.equal(h.inspected.length, 0); assert.equal(h.opened.length, 0); assert.equal(h.element('Return').disabled, true);
  h.context.busy = true; assert.ok(h.host.captureSave()); h.context.busy = false; h.controller.refresh();
  await h.back(); assert.equal(h.host.get(h.tokens[0]).stage, 'draft'); assert.equal(h.context.content, text); assert.equal(h.resumed.length, 0); assert.deepEqual(h.heldDraft, h.beforeDraft);
  h.save(); await h.back(); assert.equal(h.resumed.length, 1);
});

test('discarding an ordinary unsaved script through the editor can return without claiming a write', async t => {
  const h = await fixture(t); h.controller.request(origin()); h.createDraft();
  Object.assign(h.context, { creating: false, dirty: false, busy: false, editorSession: 'cancelled-draft', sourcePath: origin().scene.sourcePath, content: '{}' }); h.controller.refresh();
  await h.back(); assert.equal(h.resumed.length, 1); assert.equal(h.resumed[0].request.savedScript, null); assert.deepEqual(h.heldDraft, h.beforeDraft);
});

test('fresh world, scene, source and written-script revision mismatches preserve the held form without navigating', async t => {
  for (const alter of [value => value.worldId = 'world:' + 'f'.repeat(64), value => value.documentRoot = 'other', value => value.scene.objectId = id(99),
    value => value.scene.objectRevision = revision('e'), value => value.scene.sourcePath = 'documents/scenes/other.json', value => value.scene.sourceRevision = revision('e'),
    value => value.sources[0].sourceRevision = revision('e'), value => value.sources.push({ ...value.sources[0] }), value => value.sources = []]) {
    const h = await fixture(t); h.controller.request(origin()); h.createDraft(); h.save(); const changed = catalog(); alter(changed); h.setCatalog(changed);
    await h.back(); assert.equal(h.opened.length, 0); assert.equal(h.resumed.length, 0); assert.equal(h.host.get(h.tokens[0]).stage, 'saved');
    assert.equal(h.element('Tools').hidden, false); assert.match(h.element('Status').textContent, /已变化/); assert.deepEqual(h.heldDraft, h.beforeDraft);
  }
});

test('a failed fresh inspection allows a later explicit retry and never invokes Save or implicit binding', async t => {
  let count = 0; const h = await fixture(t, { inspect: async (_request, value) => { if (++count === 1) throw Error('offline'); return value; } });
  h.controller.request(origin()); h.cancelPicker(); await h.back(); assert.equal(h.opened.length, 0); assert.equal(h.resumed.length, 0); assert.equal(h.element('Return').disabled, false);
  await h.back(); assert.equal(h.opened.length, 1); assert.equal(h.resumed.length, 1); assert.deepEqual(h.heldDraft, h.beforeDraft);
});

test('clean editor navigation during fresh inspection prevents a late return from pulling the author back', async t => {
  for (const change of [h => h.context.editorSession = 'another-editor', h => h.context.sourcePath = 'documents/another.md',
    h => { h.context.sourcePath = 'documents/another.md'; h.context.editorSession = 'back-to-original-with-new-session'; h.context.sourcePath = origin().scene.sourcePath; }]) {
    const wait = deferred(), h = await fixture(t, { inspect: () => wait.promise }); h.controller.request(origin()); h.cancelPicker(); h.element('Return').click(); await settle();
    assert.equal(h.inspected.length, 1); assert.equal(h.element('Return').disabled, true); change(h); wait.resolve(catalog()); await settle();
    assert.equal(h.opened.length, 0); assert.equal(h.resumed.length, 0); assert.equal(h.element('Tools').hidden, false); assert.deepEqual(h.heldDraft, h.beforeDraft);
  }
});

test('dirty, busy, creating and workspace changes while inspecting reject stale completion without replacing input', async t => {
  for (const patch of [{ dirty: true }, { busy: true }, { creating: true }, { workspaceId: id(88) }, { editable: false }]) {
    const wait = deferred(), h = await fixture(t, { inspect: () => wait.promise }); h.controller.request(origin()); h.cancelPicker(); h.element('Return').click(); await settle();
    Object.assign(h.context, patch); wait.resolve(catalog()); await settle(); assert.equal(h.opened.length, 0); assert.equal(h.resumed.length, 0); assert.deepEqual(h.heldDraft, h.beforeDraft);
  }
});

test('a new successful Save during preflight cannot be mistaken for the older frozen written receipt', async t => {
  const wait = deferred(), h = await fixture(t, { inspect: () => wait.promise }); h.controller.request(origin()); h.createDraft(); h.save(); h.element('Return').click(); await settle();
  Object.assign(h.context, { busy: true, dirty: true, content: '# new ordinary revision\n' }); const ticket = h.host.captureSave(); assert.ok(ticket);
  assert.equal(h.host.saved(ticket, { sourcePath, sourceRevision: revision('e') }), true); Object.assign(h.context, { busy: false, dirty: false });
  wait.resolve(catalog()); await settle(); assert.equal(h.opened.length, 0); assert.equal(h.resumed.length, 0); assert.equal(h.host.get(h.tokens[0]).savedScript.sourceRevision, revision('e'));
});

test('navigation refusal and resume refusal keep the request available without overwriting its held settings', async t => {
  for (const which of ['navigation', 'resume']) {
    let attempt = 0; const h = await fixture(t, { ...(which === 'navigation' ? { openSource: () => ++attempt === 1 ? false : true } : { resume: () => ++attempt !== 1 }) });
    h.controller.request(origin()); h.cancelPicker(); await h.back(); assert.equal(h.element('Tools').hidden, false); assert.notEqual(h.host.get(h.tokens[0]), null); assert.deepEqual(h.heldDraft, h.beforeDraft);
    await h.back(); assert.equal(h.element('Tools').hidden, true); assert.equal(h.host.get(h.tokens[0]), null);
  }
});

test('explicit discard confirms once and affects only held behavior settings while script text stays in its editor', async t => {
  const h = await fixture(t); h.controller.request(origin()); h.createDraft(); const text = h.context.content;
  h.runtime.window.confirm = () => false; h.element('Discard').click(); assert.equal(h.discarded.length, 0); assert.notEqual(h.host.get(h.tokens[0]), null);
  h.runtime.window.confirm = () => true; h.element('Discard').click(); assert.equal(h.discarded.length, 1); assert.equal(h.host.get(h.tokens[0]), null); assert.equal(h.element('Tools').hidden, true);
  assert.equal(h.context.content, text); assert.equal(h.context.dirty, true); assert.equal(h.context.creating, true); assert.equal(h.resumed.length, 0);
});

test('failed suspension clears only its new host token; a failed picker leaves a recoverable pending request', async t => {
  const failed = await fixture(t, { suspend: false }); assert.equal(failed.controller.request(origin()), false); assert.equal(failed.scriptRequests.length, 0); assert.equal(failed.host.get(failed.tokens[0]), null);
  const h = await fixture(t, { openScript: () => false }); assert.equal(h.controller.request(origin()), true); assert.match(h.element('Status').textContent, /未打开/);
  assert.equal(h.controller.request(origin()), false); await h.back(); assert.equal(h.resumed.length, 1);
});

test('dispose revokes late inspection and chooser callbacks without changing the detached form or editor', async t => {
  const wait = deferred(), h = await fixture(t, { inspect: () => wait.promise }); h.controller.request(origin()); h.cancelPicker(); h.element('Return').click(); await settle();
  h.controller.dispose(); wait.resolve(catalog()); await settle(); assert.equal(h.opened.length, 0); assert.equal(h.resumed.length, 0); assert.equal(h.unsubscribed(), 1);
  const other = await fixture(t); other.controller.request(origin()); const token = other.tokens[0]; other.controller.dispose();
  Object.assign(other.context, { editorSession: '2', creating: true, dirty: true, sourcePath, content: 'body' });
  other.scriptRequests[0].onCreated({ applied: true, sourcePath, content: 'body' }); other.scriptRequests[0].onCancel();
  const afterDispose = other.host.get(token); assert.ok(afterDispose === null || afterDispose.stage === 'chooser', 'disposal may clear correlation, but a late callback must not advance it');
  assert.deepEqual(other.heldDraft, other.beforeDraft);
});
