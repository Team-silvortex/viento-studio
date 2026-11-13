import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { createSceneBehaviorCreationDraft } from '../../engine/scene-behavior-create-plan.mjs';
import { SCENE_BEHAVIOR_LIMITS } from '../../engine/scene-behaviors.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rev = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 3; i++) { await flushDialogs(); await new Promise(resolve => setTimeout(resolve, 2)); } };
const script = (n = 9) => ({ objectId: id(n), sourcePath: `documents/scripts/source${n}.txt`, sourceRevision: rev('script' + n), name: 'Script <b>' + n });
const catalog = (empty = false) => ({ format: 'viento-behavior-creation-context', schemaVersion: 1, worldId: 'world:original', baseRevision: rev('world'), documentRoot: 'documents',
  documentTypes: [{ id: 'document', label: 'Notes' }, { id: 'behavior', label: 'Behavior' }],
  scene: { objectId: id(1), objectRevision: rev('scene-record'), sourcePath: 'documents/scenes/game.json', sourceRevision: rev('scene-source'),
    instances: [2, 3].map(n => ({ instanceId: id(n), objectId: id(4), name: 'Actor <b>' + n })) }, sources: empty ? [] : [script()] });
function receipt(request, c) {
  const sourceRevision = rev(request.content), input = copy(request); delete input.mode;
  const relations = [...new Set([request.sceneObjectId, ...JSON.parse(request.content).bindings.map(row => row.implementation.sourceObjectId)])].sort().map(targetId => ({ kind: 'references', targetId, slot: '' }));
  const record = { id: request.objectId, sourcePath: request.sourcePath, documentType: request.documentType, relations };
  return { status: request.mode === 'apply' ? 'applied' : 'preview', worldId: request.worldId, baseRevision: request.baseRevision, revision: rev('after'),
    proposal: { commands: [{ id: 'behavior.create', input }] }, object: { id: request.objectId, documentRefs: [{ sourcePath: request.sourcePath, sourceRevision }] },
    changes: [{ kind: 'behavior.create', objectId: request.objectId, sourcePath: request.sourcePath, beforeText: null, beforeSourceRevision: null, afterText: request.content, afterSourceRevision: sourceRevision,
      recordPath: `metadata/documents/${request.objectId}.json`, record }, { kind: 'relation.add', objectId: request.sceneObjectId, sourcePath: c.scene.sourcePath, targetObjectId: request.objectId, targetSourcePath: request.sourcePath, relation: { kind: 'behavior', targetId: request.objectId, slot: '' } }] };
}
async function fixture(t, settings = {}) {
  let data = settings.catalog || catalog(), language = 'zh', serial = 50, onLanguage = () => {};
  const reads = [], commands = [], intents = [], busy = [], confirms = [];
  const context = { editable: true, dirty: false, creating: false, busy: false, visible: true, session: 'build:1', sceneId: id(1), sourceToken: 'scene:1' };
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-behavior-create', { SCENE_BEHAVIOR_LIMITS, createSceneBehaviorCreationDraft: value => createSceneBehaviorCreationDraft(copy(value)), crypto: { subtle: webcrypto.subtle, randomUUID: () => id(++serial) },
    t: translate, translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); }, onLanguageChange: fn => { onLanguage = fn; return () => { onLanguage = () => {}; }; } });
  let controller;
  h.runtime.window.confirm = text => { confirms.push(text); return settings.confirm?.() ?? true; };
  controller = h.runtime.setupSceneBehaviorCreate({ getContext: () => context, setBusy: value => busy.push(value),
    inspect: async request => { reads.push(copy(request)); return settings.inspect ? settings.inspect(request, reads.length, data) : copy(data); },
    command: async request => { commands.push(copy(request)); return settings.command ? settings.command(request, commands.length, data) : receipt(request, data); },
    ...(settings.noPort ? {} : { requestScriptCreation: async intent => { intents.push(intent); return settings.request ? settings.request(intent, controller) : false; } }) });
  controller.setAvailable(true, ['behavior.create']); t.after(() => controller.dispose());
  const el = suffix => h.element('sceneBehaviorCreate' + suffix), set = (suffix, value, event = 'input') => { el(suffix).value = value; if (event) el(suffix).dispatch(event); }, click = async suffix => { el(suffix).click(); await settle(); };
  return { ...h, context, controller, el, set, click, reads, commands, intents, busy, confirms, serial: () => serial, data: () => data, setData: value => { data = value; },
    async open() { assert.equal(controller.open(context.sceneId), true); await settle(); },
    async intent() { await click('NewScript'); assert.ok(intents.at(-1)); return intents.at(-1); },
    async suspend() { const intent = await this.intent(), ticket = controller.suspendForScript(intent); assert.ok(ticket); await settle(); return ticket; },
    returnContext() { context.visible = true; context.session = 'build:return'; context.sourceToken = 'scene:return'; },
    values() { return { profile: el('Profile').value, type: el('Type').value, path: el('Path').value, selected: el('BindingList').value,
      bindings: el('BindingList').children.map(row => row.value), instance: el('Instance').value, source: el('Source').value, identity: el('Identity').textContent.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g) }; },
    language(value) { language = value; onLanguage(); } };
}

test('optional script creation leaves the original behavior transaction and hidden entry intact', async t => {
  const h = await fixture(t, { noPort: true }); await h.open(); assert.equal(h.el('NewScript').hidden, true); await h.click('NewScript'); assert.equal(h.intents.length, 0); assert.equal(h.commands.length, 0);
  assert.deepEqual(Object.keys(h.controller).sort(), ['discardSuspended', 'dispose', 'open', 'resumeFromScript', 'setAvailable', 'suspendForScript']);
});

test('an empty catalog can request a pure intent and suspend without assigning a new script or writing behavior', async t => {
  const h = await fixture(t, { catalog: catalog(true) }); await h.open(); const initial = h.values(), locks = h.busy.length; assert.equal(h.el('NewScript').disabled, false); const intent = await h.intent();
  assert.deepEqual(copy(intent), { worldId: 'world:original', documentRoot: 'documents', scene: { objectId: id(1), objectRevision: rev('scene-record'), sourcePath: 'documents/scenes/game.json', sourceRevision: rev('scene-source') }, backendId: 'org.viento.godot4', language: 'gdscript' });
  assert.ok(Object.isFrozen(intent)); assert.ok(Object.isFrozen(intent.scene)); assert.equal(h.el('Dialog').open, true); assert.equal(h.busy.length, locks);
  const ticket = h.controller.suspendForScript(intent); assert.ok(Object.isFrozen(ticket)); assert.deepEqual(Object.keys(ticket), []); assert.equal(h.el('Dialog').open, false); assert.equal(h.el('Dialog').dataset.dirty, 'true'); assert.equal(h.el('Dialog').getAttribute('aria-busy'), 'false');
  assert.equal(h.controller.open(id(1)), false); assert.deepEqual(h.values(), initial); assert.equal(h.commands.length, 0); assert.equal(h.serial(), 52); assert.equal(h.busy.length, locks);
});

test('return re-reads the catalog, permits the new world revision, preserves the empty source choice and consumes the ticket once', async t => {
  const h = await fixture(t, { catalog: catalog(true) }); await h.open(); const initial = h.values(), ticket = await h.suspend();
  const next = catalog(); next.baseRevision = rev('saved ordinary TXT'); h.setData(next); h.returnContext(); const savedScript = { sourcePath: next.sources[0].sourcePath, sourceRevision: next.sources[0].sourceRevision };
  assert.equal(await h.controller.resumeFromScript(ticket, { savedScript }), true); assert.equal(h.reads.length, 2); assert.equal(h.el('Dialog').open, true); assert.deepEqual(h.values(), initial); assert.equal(h.el('Source').value, '');
  assert.equal(h.el('Review').hidden, true); assert.equal(h.el('Save').disabled, true); assert.equal(await h.controller.resumeFromScript(ticket), false); assert.equal(h.commands.length, 0); assert.equal(h.serial(), 52);
  await h.click('Check'); assert.equal(h.commands.length, 0); h.set('Source', next.sources[0].objectId, 'change'); await h.click('Check'); assert.equal(h.commands.length, 1); assert.equal(h.commands[0].baseRevision, next.baseRevision); assert.equal(h.el('Save').disabled, false);
});

test('multiple unsaved bindings, incomplete text, profile, selected binding and stable identities survive the trip and three languages', async t => {
  const h = await fixture(t); await h.open(); await h.click('AddBinding'); h.set('Profile', 'bevy-rust', 'change'); h.set('Type', 'behavior', 'change'); h.set('Path', 'documents/../unfinished'); h.set('Source', '', 'change'); h.set('Instance', '', 'change'); const before = h.values(), ticket = await h.suspend();
  assert.equal(h.intents[0].backendId, 'org.viento.bevy-rust'); assert.equal(h.intents[0].language, 'rust'); h.returnContext(); const next = catalog(); next.sources.push(script(10)); h.setData(next); assert.equal(await h.controller.resumeFromScript(ticket), true); assert.deepEqual(h.values(), before); assert.equal(h.serial(), 53);
  for (const locale of ['en', 'ja', 'zh']) { h.language(locale); assert.deepEqual(h.values(), before); assert.equal(h.el('Save').disabled, true); }
  h.set('BindingList', before.bindings[0], 'change'); assert.equal(h.el('Source').value, id(9)); h.set('BindingList', before.selected, 'change'); assert.equal(h.el('Source').value, ''); assert.equal(h.el('Instance').value, ''); assert.equal(h.commands.length, 0);
});

test('suspension revokes a reviewed behavior and late script completion cannot restore the prior approval', async t => {
  let pending; const h = await fixture(t, { request: async (intent, c) => { pending = defer(); const ticket = c.suspendForScript(intent); assert.ok(ticket); pending.ticket = ticket; return pending.promise; } });
  await h.open(); await h.click('Check'); assert.equal(h.el('Save').disabled, false); h.el('NewScript').click(); await settle(); assert.ok(pending); assert.equal(h.el('Review').hidden, true);
  h.returnContext(); assert.equal(await h.controller.resumeFromScript(pending.ticket), true); assert.equal(h.el('Save').disabled, true); assert.equal(h.el('Review').hidden, true); const before = h.values(); pending.resolve(false); await settle(); assert.deepEqual(h.values(), before); assert.equal(h.el('Save').disabled, true); assert.equal(h.commands.length, 1);
});

test('chooser cancellation, refusal and thrown startup preserve the form and never hold the world busy lock', async t => {
  for (const throwing of [false, true]) {
    const h = await fixture(t, { request: async () => { if (throwing) throw Error('unavailable'); return false; } }); await h.open(); h.set('Path', 'documents/behaviors/my.json'); const before = h.values(), busy = h.busy.length;
    await h.click('NewScript'); assert.deepEqual(h.values(), before); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('NewScript').disabled, false); assert.match(h.el('Status').textContent, /设置已保留/); assert.equal(h.busy.length, busy); assert.equal(h.commands.length, 0);
  }
});

test('changed world, root, scene identity or either scene revision reopens the original settings blocked, with an origin-checked retry', async t => {
  const mutations = [c => { c.worldId = 'world:other'; }, c => { c.documentRoot = 'elsewhere'; c.sources = []; }, c => { c.scene.objectId = id(99); },
    c => { c.scene.sourcePath = 'documents/scenes/other.json'; }, c => { c.scene.objectRevision = rev('external metadata'); }, c => { c.scene.sourceRevision = rev('external scene'); }];
  for (const [index, mutate] of mutations.entries()) {
    const h = await fixture(t); await h.open(); h.set('Path', 'documents/../keep'); const before = h.values(), ticket = await h.suspend(), original = catalog(), next = catalog(); mutate(next); h.setData(next); h.returnContext();
    assert.equal(await h.controller.resumeFromScript(ticket), true, String(index)); assert.deepEqual(h.values(), before, String(index)); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Save').disabled, true); assert.equal(h.el('Path').disabled, true); assert.equal(h.el('Cancel').disabled, false); assert.equal(h.commands.length, 0);
    await h.click('Refresh'); assert.equal(h.el('Check').disabled, true); h.setData(original); await h.click('Refresh'); assert.equal(h.el('Path').disabled, false); assert.deepEqual(h.values(), before); assert.equal(h.el('Save').disabled, true);
  }
});

test('missing or mismatched saved TXT receipt stays blocked until fresh catalog uniquely matches the exact bytes', async t => {
  for (const mode of ['missing', 'revision', 'duplicate']) {
    const h = await fixture(t); await h.open(); const ticket = await h.suspend(), expected = script(10), data = catalog();
    if (mode === 'revision') data.sources.push({ ...expected, sourceRevision: rev('other bytes') }); if (mode === 'duplicate') data.sources.push(expected, { ...expected, objectId: id(11) }); h.setData(data); h.returnContext();
    assert.equal(await h.controller.resumeFromScript(ticket, { savedScript: { sourcePath: expected.sourcePath, sourceRevision: expected.sourceRevision } }), true); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Source').value, id(9));
    const fixed = catalog(); fixed.sources.push(expected); h.setData(fixed); await h.click('Refresh'); assert.equal(h.el('Path').disabled, false); assert.equal(h.el('Source').value, id(9)); assert.equal(h.commands.length, 0);
  }
});

test('catalog failures preserve all bindings for read-only inspection and explicit cancellation', async t => {
  let offline = false; const h = await fixture(t, { inspect: async (_r, _n, data) => { if (offline) throw Error('offline'); return copy(data); } }); await h.open(); await h.click('AddBinding'); const before = h.values(), ticket = await h.suspend(); offline = true; h.returnContext();
  assert.equal(await h.controller.resumeFromScript(ticket), true); assert.deepEqual(h.values(), before); assert.equal(h.el('Path').disabled, true); assert.equal(h.el('BindingList').disabled, false); assert.equal(h.el('Fields').disabled, false);
  h.set('BindingList', before.bindings[0], 'change'); assert.equal(h.el('Instance').value, id(2)); assert.equal(h.el('Source').disabled, true); assert.equal(h.el('Check').disabled, true); await h.click('Cancel'); assert.equal(h.el('Dialog').open, false); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.commands.length, 0);
});

test('missing old script, instance or document type is never silently replaced by the newly saved TXT', async t => {
  const h = await fixture(t); await h.open(); h.set('Type', 'behavior', 'change'); const ticket = await h.suspend(), data = catalog(); data.sources = [script(10)]; data.scene.instances = data.scene.instances.slice(1); data.documentTypes = data.documentTypes.slice(0, 1); h.setData(data); h.returnContext();
  assert.equal(await h.controller.resumeFromScript(ticket), true); assert.equal(h.el('Source').value, id(9)); assert.equal(h.el('Instance').value, id(2)); assert.equal(h.el('Type').value, 'behavior'); assert.match(h.el('Source').children[0].textContent, /已不可用/); await h.click('Check'); assert.equal(h.commands.length, 0); assert.equal(h.el('Save').disabled, true);
});

test('wrong or forged tickets, invalid receipts and dirty return context cannot consume a recoverable suspension', async t => {
  const h = await fixture(t); await h.open(); const ticket = await h.suspend(); assert.equal(h.controller.suspendForScript(h.intents[0]), false); assert.equal(await h.controller.resumeFromScript(Object.freeze({})), false); assert.equal(h.controller.discardSuspended(Object.freeze({})), false);
  for (const options of [null, { extra: true }, { savedScript: undefined }, { savedScript: { sourcePath: 'documents/a.gd', sourceRevision: rev('a') } }, { savedScript: { sourcePath: 'documents/../a.txt', sourceRevision: rev('a') } }]) assert.equal(await h.controller.resumeFromScript(ticket, options), false);
  for (const [key, value] of [['dirty', true], ['creating', true], ['busy', true], ['visible', false], ['sceneId', id(99)]]) { const old = h.context[key]; h.context[key] = value; assert.equal(await h.controller.resumeFromScript(ticket), false); h.context[key] = old; }
  h.returnContext(); assert.equal(await h.controller.resumeFromScript(ticket), true); assert.equal(h.commands.length, 0);
});

test('opaque intent validation does not execute getters or serializers, and refuses a stale profile or scene intent', async t => {
  const h = await fixture(t); await h.open(); const intent = await h.intent(); let calls = 0;
  const getter = Object.defineProperty({}, 'worldId', { enumerable: true, get() { calls++; return intent.worldId; } });
  assert.equal(h.controller.suspendForScript(getter), false); assert.equal(h.controller.suspendForScript({ ...intent, toJSON() { calls++; return intent; } }), false); assert.equal(calls, 0);
  h.set('Profile', 'bevy-rust', 'change'); assert.equal(h.controller.suspendForScript(intent), false); assert.equal(h.el('Dialog').open, true); assert.equal(h.commands.length, 0);
});

test('read, review and apply operations exclude script suspension and duplicate startup requests', async t => {
  const wait = defer(); const h = await fixture(t, { command: () => wait.promise }); await h.open(); const intent = await h.intent(); h.el('Check').click(); await settle(); assert.equal(h.el('NewScript').disabled, true); assert.equal(h.controller.suspendForScript(intent), false); const calls = h.intents.length; await h.click('NewScript'); assert.equal(h.intents.length, calls);
  wait.resolve(receipt(h.commands[0], h.data())); await settle(); assert.equal(h.el('Save').disabled, false);
  const request = defer(), startup = await fixture(t, { request: () => request.promise }); await startup.open(); startup.el('NewScript').click(); await settle(); startup.el('NewScript').click(); assert.equal(startup.intents.length, 1); assert.equal(startup.el('Close').disabled, true); request.resolve(false); await settle(); assert.equal(startup.el('Close').disabled, false);
});

test('late resume reads cannot unlock a switched scene, closed session or disposed dialog', async t => {
  for (const mode of ['scene', 'session', 'token', 'dirty', 'close', 'dispose']) {
    const wait = defer(); const h = await fixture(t, { inspect: (_r, n, data) => n === 1 ? copy(data) : wait.promise }); await h.open(); const ticket = await h.suspend(); h.returnContext(); const pending = h.controller.resumeFromScript(ticket); await settle();
    if (mode === 'scene') h.context.sceneId = id(99); if (mode === 'session') h.context.session = 'other'; if (mode === 'token') h.context.sourceToken = 'other'; if (mode === 'dirty') h.context.dirty = true;
    if (mode === 'close') h.el('Dialog').close(); if (mode === 'dispose') h.controller.dispose(); wait.resolve(catalog()); await pending; await settle(); assert.equal(h.commands.length, 0);
    if (mode !== 'dispose') { assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Save').disabled, true); } assert.equal(h.busy.at(-1), false);
  }
});

test('explicit discard clears only the suspended local form and permanently expires its ticket', async t => {
  const h = await fixture(t); await h.open(); h.set('Path', 'documents/behaviors/keep.json'); const ticket = await h.suspend(), count = h.serial();
  assert.equal(h.controller.discardSuspended(ticket), true); assert.equal(h.el('Dialog').open, false); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.controller.discardSuspended(ticket), false); assert.equal(await h.controller.resumeFromScript(ticket), false); assert.equal(h.commands.length, 0);
  await h.open(); assert.equal(h.serial(), count + 2); assert.equal(h.el('Path').value, 'documents/behaviors/new-behavior.json');
});

test('suspend close never steals the new script focus and detached old controls cannot change the saved form', async t => {
  const h = await fixture(t); const opener = h.document.createElement('button'), editor = h.document.createElement('textarea'); h.document.body.append(opener, editor); opener.focus(); await h.open(); const intent = await h.intent(), before = h.values(), ticket = h.controller.suspendForScript(intent); editor.focus(); await settle(); assert.equal(h.document.activeElement, editor);
  await h.click('AddBinding'); await h.click('Cancel'); assert.deepEqual(h.values(), before); assert.equal(h.el('Dialog').dataset.dirty, 'true'); assert.ok(ticket); assert.equal(h.commands.length, 0);
});

test('all new fixed script-return copy has English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-behavior-create.js', import.meta.url), 'utf8');
  for (const match of source.matchAll(/(?:data-i18n="([^"]+)"|'([^'\n]*[\u3400-\u9fff][^'\n]*)')/g)) { const key = match[1] || match[2]; if (!/[\u3400-\u9fff]/.test(key)) continue; assert.equal(typeof en[key], 'string', 'en: ' + key); assert.equal(typeof ja[key], 'string', 'ja: ' + key); }
});
