import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneScriptReturnHost } from '../../web/modules/app-scene-script-return-host.js';

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const revision = letter => 'sha256:' + letter.repeat(64);
const origin = () => ({ worldId: 'world:' + 'a'.repeat(64), documentRoot: 'documents', scene: {
  objectId: id(1), objectRevision: revision('b'), sourcePath: 'documents/scenes/level.json', sourceRevision: revision('c'),
}, backendId: 'org.viento.godot4', language: 'gdscript' });
const source = 'documents/scripts/player.txt';
const state = () => ({ editable: true, busy: false, dirty: false, creating: false,
  workspaceId: id(9), editorSession: '1', sourcePath: 'documents/scenes/level.json', content: '{}' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(options = {}) {
  const context = state(), opened = [];
  const host = createSceneScriptReturnHost({ getContext: () => options.getContext?.(context) ?? { ...context }, openSource: async (...args) => {
    opened.push(args); return options.openSource ? options.openSource(...args, context) : { focus() {} };
  } });
  const begin = () => host.begin(origin());
  function draft(token, content = 'extends Node\n', path = source) {
    Object.assign(context, { editorSession: '2', creating: true, dirty: true, sourcePath: path, content });
    const receipt = { applied: true, sourcePath: path, content, focus() { assert.fail('the correlation host must not invoke a focus receipt'); } };
    assert.equal(host.draftCreated(token, receipt), true); return receipt;
  }
  function save(token, version = revision('d')) {
    context.busy = true;
    const ticket = host.captureSave(); assert.ok(ticket);
    assert.equal(host.saved(ticket, { sourcePath: context.sourcePath, sourceRevision: version }), true);
    Object.assign(context, { busy: false, dirty: false, creating: false });
    assert.equal(host.get(token).savedScript.sourceRevision, version); return ticket;
  }
  return { host, context, opened, begin, draft, save };
}
const bad = run => assert.throws(run, error => error instanceof TypeError && error.errorCode === 'scene_script_return_host_invalid');

test('begin captures one immutable origin and opaque token without exposing source text or replacing an existing request', () => {
  const h = fixture(), input = origin(), token = h.host.begin(input);
  assert.ok(Object.isFrozen(token)); assert.equal(Object.getPrototypeOf(token), null); assert.deepEqual(Reflect.ownKeys(token), []);
  assert.ok(Object.isFrozen(h.host)); assert.equal(h.host.begin(origin()), null);
  input.scene.sourcePath = 'documents/scenes/other.json'; input.backendId = 'example.changed';
  const value = h.host.get(token);
  assert.deepEqual(value, { origin: origin(), stage: 'chooser', savedScript: null, canReturn: true, editorSession: '1', sourcePath: 'documents/scenes/level.json' });
  assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.origin)); assert.ok(Object.isFrozen(value.origin.scene));
  assert.equal(Object.hasOwn(value, 'content'), false); assert.equal(Object.isFrozen(input), false); assert.equal(Object.isFrozen(input.scene), false);
  for (const fake of [null, {}, Object.freeze(Object.create(null)), 1, 'token']) { assert.equal(h.host.get(fake), null); assert.equal(h.host.clear(fake), false); }
  assert.equal(h.host.get(token).stage, 'chooser'); assert.equal(h.opened.length, 0);
});

test('begin requires a clean idle editable noncreating workspace and fails closed on context errors', () => {
  for (const change of [{ editable: false }, { busy: true }, { dirty: true }, { creating: true }, { workspaceId: '' }, { editorSession: '' }, { content: null }]) {
    const h = fixture(); Object.assign(h.context, change); assert.equal(h.begin(), null); assert.equal(h.host.captureSave(), null); assert.equal(h.opened.length, 0);
  }
  const host = createSceneScriptReturnHost({ getContext() { throw Error('unavailable'); }, openSource() { assert.fail('must not navigate'); } });
  assert.equal(host.begin(origin()), null);
});

test('origin validates exact data and portable source identities without invoking getters or coercion hooks', () => {
  let calls = 0;
  for (const field of ['worldId', 'documentRoot', 'scene', 'backendId', 'language']) {
    const input = origin(); Object.defineProperty(input, field, { enumerable: true, get() { calls++; return origin()[field]; } }); bad(() => fixture().host.begin(input));
    const missing = origin(); delete missing[field]; bad(() => fixture().host.begin(missing));
  }
  for (const field of ['objectId', 'objectRevision', 'sourcePath', 'sourceRevision']) {
    const input = origin(); Object.defineProperty(input.scene, field, { enumerable: true, get() { calls++; return origin().scene[field]; } }); bad(() => fixture().host.begin(input));
  }
  for (const name of ['extra', Symbol('extra')]) { const input = origin(); Object.defineProperty(input, name, { value: undefined }); bad(() => fixture().host.begin(input)); }
  for (const patch of [{ worldId: 'world:a' }, { documentRoot: '../escape' }, { documentRoot: 'documents/.hidden' }, { documentRoot: { toString() { calls++; return 'documents'; } } },
    { backendId: 'org.viento.godot4\n' }, { language: 'rust\n' }, { language: '' }]) bad(() => fixture().host.begin({ ...origin(), ...patch }));
  for (const patch of [{ objectId: 'unknown' }, { objectRevision: 'old' }, { sourceRevision: revision('c') + '\n' }, { sourcePath: 'documents/../escape.json' },
    { sourcePath: 'outside/scene.json' }, { sourcePath: 'documents/scenes/scene.txt' }, { sourcePath: 'documents/scenes/\ud800.json' }]) bad(() => fixture().host.begin({ ...origin(), scene: { ...origin().scene, ...patch } }));
  assert.equal(calls, 0);
  const nullOrigin = Object.assign(Object.create(null), origin()); assert.ok(fixture().host.begin(nullOrigin));
  for (const ports of [null, {}, { getContext() {}, openSource() {}, extra: true }, { getContext: null, openSource() {} }]) bad(() => createSceneScriptReturnHost(ports));
});

test('draft association requires the actual applied receipt to match the current creating editor', () => {
  const h = fixture(), token = h.begin(), receipt = { applied: true, sourcePath: source, content: 'extends Node\n' };
  assert.equal(h.host.draftCreated(token, receipt), false);
  Object.assign(h.context, { creating: true, dirty: true, editorSession: '2', sourcePath: source, content: receipt.content });
  for (const changed of [{ applied: false }, { sourcePath: 'documents/scripts/other.txt' }, { content: 'changed' }, { focus: false }, { extra: undefined }]) {
    assert.equal(h.host.draftCreated(token, { ...receipt, ...changed }), false); assert.equal(h.host.get(token).stage, 'chooser');
  }
  const fake = {}; assert.equal(h.host.draftCreated(fake, receipt), false);
  assert.equal(h.host.draftCreated(token, receipt), true); assert.equal(h.host.get(token).stage, 'draft');
  assert.equal(h.host.draftCreated(token, receipt), false); assert.equal(h.host.get(token).savedScript, null);
});

test('draft receipt capture rejects accessors, hidden fields and serializer hooks without running them', () => {
  let calls = 0;
  for (const key of ['applied', 'sourcePath', 'content', 'focus']) {
    const h = fixture(), token = h.begin(); Object.assign(h.context, { creating: true, editorSession: '2', sourcePath: source, content: 'body' });
    const receipt = { applied: true, sourcePath: source, content: 'body' }; Object.defineProperty(receipt, key, { enumerable: true, get() { calls++; return 'body'; } });
    assert.equal(h.host.draftCreated(token, receipt), false);
  }
  const h = fixture(), token = h.begin(); Object.assign(h.context, { creating: true, editorSession: '2', sourcePath: source, content: 'body' });
  assert.equal(h.host.draftCreated(token, { applied: true, sourcePath: source, content: { toJSON() { calls++; return 'body'; } } }), false);
  assert.equal(calls, 0);
});

test('ordinary busy Save captures current edited bytes and renamed TXT path in the same created editor session', () => {
  const h = fixture(), token = h.begin(); h.draft(token);
  Object.assign(h.context, { busy: true, sourcePath: 'documents/scripts/renamed.txt', content: 'extends Node\n# author edit\r\n' });
  const ticket = h.host.captureSave(); assert.ok(ticket); assert.ok(Object.isFrozen(ticket)); assert.deepEqual(Reflect.ownKeys(ticket), []);
  assert.equal(h.host.saved(ticket, { sourcePath: h.context.sourcePath, sourceRevision: revision('d') }), true);
  assert.deepEqual(h.host.get(token).savedScript, { sourcePath: 'documents/scripts/renamed.txt', sourceRevision: revision('d') });
  assert.equal(h.host.get(token).canReturn, false, 'the successful write point still owns busy/creating flags');
  Object.assign(h.context, { creating: false, dirty: false, busy: false, editorSession: '3' });
  assert.equal(h.host.get(token).canReturn, true);
});

test('captureSave ignores chooser, foreign drafts, changed sessions and sources outside the original document root', () => {
  const empty = fixture(); assert.equal(empty.host.captureSave(), null); empty.begin(); assert.equal(empty.host.captureSave(), null);
  for (const change of [{ workspaceId: id(10) }, { editorSession: 'other' }, { creating: false }, { editable: false },
    { sourcePath: 'outside/scripts/other.txt' }, { sourcePath: 'documents/scripts/other.gd' }, { sourcePath: 'documents/../escape.txt' }]) {
    const h = fixture(), token = h.begin(); h.draft(token); Object.assign(h.context, change); assert.equal(h.host.captureSave(), null);
  }
});

test('write receipts cannot attach after their exact owner, content, path, mode or active ticket changes', () => {
  for (const change of [{ workspaceId: id(10) }, { editorSession: 'other' }, { sourcePath: 'documents/scripts/other.txt' }, { content: 'late edit' }, { creating: false }, { editable: false }]) {
    const h = fixture(), token = h.begin(); h.draft(token); h.context.busy = true; const ticket = h.host.captureSave(); Object.assign(h.context, change);
    assert.equal(h.host.saved(ticket, { sourcePath: source, sourceRevision: revision('d') }), false); assert.equal(h.host.get(token).savedScript, null);
  }
  const h = fixture(), token = h.begin(); h.draft(token); const old = h.host.captureSave(); h.host.clear(token); Object.assign(h.context, state());
  const next = h.begin(); h.draft(next); assert.equal(h.host.saved(old, { sourcePath: source, sourceRevision: revision('d') }), false); assert.equal(h.host.get(next).savedScript, null);
});

test('only the latest save attempt accepts one exact, strict receipt', () => {
  const h = fixture(), token = h.begin(); h.draft(token); const old = h.host.captureSave(), ticket = h.host.captureSave();
  assert.equal(h.host.saved(old, { sourcePath: source, sourceRevision: revision('d') }), false);
  for (const input of [{ sourcePath: source, sourceRevision: 'old' }, { sourcePath: source, sourceRevision: revision('d') + '\n' }, { sourcePath: 'other.txt', sourceRevision: revision('d') },
    { sourcePath: source, sourceRevision: revision('d'), extra: undefined }, null]) assert.equal(h.host.saved(ticket, input), false);
  let calls = 0; const accessor = { sourcePath: source }; Object.defineProperty(accessor, 'sourceRevision', { enumerable: true, get() { calls++; return revision('d'); } });
  assert.equal(h.host.saved(ticket, accessor), false); assert.equal(calls, 0);
  assert.equal(h.host.saved({}, { sourcePath: source, sourceRevision: revision('d') }), false);
  assert.equal(h.host.saved(ticket, { sourcePath: source, sourceRevision: revision('d') }), true);
  assert.equal(h.host.saved(ticket, { sourcePath: source, sourceRevision: revision('e') }), false);
  assert.equal(h.host.get(token).savedScript.sourceRevision, revision('d')); assert.ok(Object.isFrozen(h.host.get(token).savedScript));
});

test('later ordinary Save of the written script updates its receipt after an index reload changes editor session', () => {
  const h = fixture(), token = h.begin(); h.draft(token); h.save(token);
  Object.assign(h.context, { editorSession: 'after-index-rebuild', busy: true, dirty: true, content: '# second revision\n' });
  const ticket = h.host.captureSave(); assert.ok(ticket);
  assert.equal(h.host.saved(ticket, { sourcePath: source, sourceRevision: revision('e') }), true);
  assert.equal(h.host.get(token).savedScript.sourceRevision, revision('e'));
  h.context.sourcePath = 'documents/scripts/unrelated.txt'; assert.equal(h.host.captureSave(), null);
  h.context.sourcePath = source; h.context.creating = true; assert.equal(h.host.captureSave(), null);
});

test('chooser cancellation and a discarded ordinary script draft may return without inventing a saved script', () => {
  const h = fixture(), token = h.begin(); assert.equal(h.host.get(token).canReturn, true);
  h.draft(token); assert.equal(h.host.get(token).canReturn, false);
  Object.assign(h.context, { creating: false, dirty: false, busy: false, editorSession: '3' });
  assert.equal(h.host.get(token).canReturn, true); assert.equal(h.host.get(token).stage, 'draft'); assert.equal(h.host.get(token).savedScript, null);
  for (const change of [{ busy: true }, { dirty: true }, { creating: true }, { editable: false }, { workspaceId: id(10) }]) {
    const previous = { ...h.context }; Object.assign(h.context, change); assert.equal(h.host.get(token).canReturn, false); Object.assign(h.context, previous);
  }
});

test('explicit return passes the frozen scene revision and survives its own source loading and session change', async () => {
  let guard;
  const h = fixture({ openSource: async (path, options, context) => {
    guard = options.isCurrent; assert.equal(path, origin().scene.sourcePath); assert.equal(options.sourceRevision, origin().scene.sourceRevision); assert.equal(guard(), true);
    Object.assign(context, { busy: true, editorSession: 'own-navigation-load', sourcePath: path }); assert.equal(guard(), true);
    Object.assign(context, { busy: false, editorSession: 'own-navigation-complete' }); assert.equal(guard(), true); return { focus() {} };
  } });
  const token = h.begin(), result = await h.host.returnSource(token, { isCurrent: () => true });
  assert.equal(typeof result.focus, 'function'); assert.equal(h.opened.length, 1); assert.equal(guard(), true); assert.equal(h.host.get(token).canReturn, true);
  assert.equal(h.host.clear(token), true); assert.equal(guard(), false); assert.equal(h.host.get(token), null);
});

test('return checks the injected guard before dispatch and cannot use it to silently change navigation owner', async () => {
  for (const change of [h => h.context.editorSession = 'unrelated', h => h.context.sourcePath = 'documents/other.md', h => h.context.dirty = true, h => h.context.workspaceId = id(10), h => h.host.clear(h.token)]) {
    const h = fixture(); h.token = h.begin();
    assert.equal(await h.host.returnSource(h.token, { isCurrent: () => { change(h); return true; } }), false); assert.equal(h.opened.length, 0);
  }
  const h = fixture(), token = h.begin(); assert.equal(await h.host.returnSource(token, { isCurrent: () => false }), false);
  for (const options of [undefined, {}, { isCurrent: true }, { isCurrent: () => true, extra: true }]) assert.equal(await h.host.returnSource(token, options), false);
  assert.equal(h.opened.length, 0);
});

test('pending return rejects duplicates and stale completion while retaining the active origin', async () => {
  for (const revoke of [h => h.host.clear(h.token), h => h.context.workspaceId = id(10), h => h.context.dirty = true, h => h.context.creating = true, h => h.context.editable = false, h => h.allowed = false]) {
    const wait = deferred(); const h = fixture({ openSource: () => wait.promise }); h.token = h.begin(); h.allowed = true;
    const result = h.host.returnSource(h.token, { isCurrent: () => h.allowed });
    assert.equal(h.opened.length, 1); assert.equal(h.host.get(h.token).canReturn, false);
    assert.equal(await h.host.returnSource(h.token, { isCurrent: () => true }), false); assert.equal(h.opened.length, 1);
    revoke(h); wait.resolve({ focus() {} }); assert.equal(await result, false);
  }
});

test('navigation failure and exceptions keep the origin available for an explicit retry', async () => {
  for (const throwing of [false, true]) {
    let attempt = 0; const h = fixture({ openSource: () => { if (++attempt === 1) { if (throwing) throw Error('offline'); return false; } return true; } });
    const token = h.begin(); assert.equal(await h.host.returnSource(token, { isCurrent: () => true }), false);
    assert.equal(h.host.get(token).canReturn, true); assert.equal(await h.host.returnSource(token, { isCurrent: () => true }), true);
    assert.equal(h.opened.length, 2); assert.equal(h.host.get(token).savedScript, null);
  }
});

test('context getters are never evaluated and a cleared old token cannot affect a replacement request', async () => {
  let calls = 0;
  const h = fixture({ getContext: value => { const input = { ...value }; Object.defineProperty(input, 'dirty', { enumerable: true, get() { calls++; return false; } }); return input; } });
  assert.equal(h.begin(), null); assert.equal(calls, 0);
  const other = fixture(), token = other.begin(); assert.equal(other.host.clear(token), true); const next = other.begin();
  assert.notEqual(next, token); assert.equal(other.host.clear(token), false); assert.equal(other.host.draftCreated(token, { applied: true, sourcePath: source, content: '' }), false);
  assert.equal(await other.host.returnSource(token, { isCurrent: () => true }), false); assert.equal(other.host.get(next).stage, 'chooser');
});
