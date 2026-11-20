import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { createSceneBehaviorCreationDraft } from '../../engine/scene-behavior-create-plan.mjs';
import { SCENE_BEHAVIOR_LIMITS } from '../../engine/scene-behaviors.mjs';
import { captureScriptParameterContract } from '../../engine/script-parameter-interface.mjs';
import { applySceneBehaviorCreateParameterSources } from '../../engine/scene-behavior-create-parameters.mjs';
import { setupSceneBehaviorCreateParameters } from '../../web/modules/app-scene-behavior-create-parameters.js';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const revision = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
// Preserve accessors and unknown own keys when transporting VM form data into
// the actual Node pure boundary. In particular, never stringify an interface.
function transport(value) {
  if (!value || typeof value !== 'object') return value;
  const target = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    Object.defineProperty(target, key, Object.hasOwn(descriptor, 'value') ? { ...descriptor, value: transport(descriptor.value) } : descriptor);
  }
  return target;
}
const declaration = (name, type, defaultValue) => ({ name, type, defaultValue, referenceKind: '' });
const contract = (status = 'ready', extra = {}) => ({ format: 'viento-script-parameters', schemaVersion: 1, backendId: 'org.viento.godot4', language: 'gdscript', status,
  parameters: status === 'ready' ? [declaration('amount', 'number', 4), declaration('enabled', 'boolean', false), declaration('caption', 'string', '')] : [], ...extra });
const source = (n, parameterContract = contract()) => ({ objectId: id(n), sourcePath: `documents/scripts/source${n}.txt`, sourceRevision: revision('script' + n), name: 'Script ' + n,
  ...(parameterContract === null ? {} : { parameterContract }) });
const catalog = () => ({ format: 'viento-behavior-creation-context', schemaVersion: 1, worldId: 'world:original', baseRevision: revision('world'), documentRoot: 'documents',
  documentTypes: [{ id: 'document', label: 'Notes' }], scene: { objectId: id(1), objectRevision: revision('scene-record'), sourcePath: 'documents/scenes/game.json', sourceRevision: revision('scene-source'),
    instances: [2, 3].map(n => ({ instanceId: id(n), objectId: id(4), name: 'Actor ' + n })) }, sources: [source(9), source(10)] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 3; i++) { await flushDialogs(); await new Promise(resolve => setTimeout(resolve, 2)); } };
function receipt(request, c) {
  const afterSourceRevision = revision(request.content), input = copy(request); delete input.mode;
  const relations = [...new Set([request.sceneObjectId, ...JSON.parse(request.content).bindings.map(row => row.implementation.sourceObjectId)])].sort().map(targetId => ({ kind: 'references', targetId, slot: '' }));
  return { status: request.mode === 'apply' ? 'applied' : 'preview', worldId: request.worldId, baseRevision: request.baseRevision, revision: revision('after'),
    proposal: { commands: [{ id: 'behavior.create', input }] }, object: { id: request.objectId, documentRefs: [{ sourcePath: request.sourcePath, sourceRevision: afterSourceRevision }] },
    changes: [{ kind: 'behavior.create', objectId: request.objectId, sourcePath: request.sourcePath, beforeText: null, beforeSourceRevision: null, afterText: request.content, afterSourceRevision,
      recordPath: `metadata/documents/${request.objectId}.json`, record: { id: request.objectId, sourcePath: request.sourcePath, documentType: request.documentType, relations } },
    { kind: 'relation.add', objectId: request.sceneObjectId, sourcePath: c.scene.sourcePath, targetObjectId: request.objectId, targetSourcePath: request.sourcePath, relation: { kind: 'behavior', targetId: request.objectId, slot: '' } }] };
}
async function fixture(t, options = {}) {
  let data = options.catalog || catalog(), serial = 50, language = 'zh', languageChanged = () => {};
  const commands = [], reads = [], applied = [], intents = [], context = { editable: true, dirty: false, creating: false, busy: false, visible: true, session: 'build:1', sceneId: id(1), sourceToken: 'scene:1' };
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const bridgedSources = new WeakMap();
  const h = await dialogHarness('app-scene-behavior-create', { SCENE_BEHAVIOR_LIMITS,
    createSceneBehaviorCreationDraft: value => createSceneBehaviorCreationDraft(transport(value)),
    captureScriptParameterContract: value => captureScriptParameterContract(transport(value)),
    applySceneBehaviorCreateParameterSources: value => applySceneBehaviorCreateParameterSources(transport(value)),
    setupSceneBehaviorCreateParameters: options.noHelper ? undefined : ports => setupSceneBehaviorCreateParameters({ ...ports, getContext() {
      const context = ports.getContext(); let source = context.source;
      if (source) { if (!bridgedSources.has(source)) bridgedSources.set(source, transport(source)); source = bridgedSources.get(source); }
      return { ...context, source };
    } }),
    crypto: { subtle: webcrypto.subtle, randomUUID: () => id(++serial) }, t: translate,
    translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: callback => { languageChanged = callback; return () => { languageChanged = () => {}; }; } });
  const controller = h.runtime.setupSceneBehaviorCreate({ getContext: () => context, inspect: async request => { reads.push(copy(request)); return options.inspect ? options.inspect(request, reads.length, data) : data; },
    command: async request => { commands.push(copy(request)); return options.command ? options.command(request, commands.length, data) : receipt(request, data); }, applied: async value => applied.push(value),
    requestScriptCreation: async value => { intents.push(value); return false; } });
  controller.setAvailable(true, ['behavior.create']); t.after(() => controller.dispose());
  const el = suffix => h.element('sceneBehaviorCreate' + suffix), set = (suffix, value, event = 'input') => { el(suffix).value = value; if (event) el(suffix).dispatch(event); };
  return { ...h, controller, el, set, commands, reads, applied, context, intents, data: () => data, setData: next => { data = next; },
    async open() { assert.equal(controller.open(context.sceneId), true); await settle(); },
    async click(suffix) { el(suffix).click(); await settle(); }, language(value) { language = value; languageChanged(); }, serial: () => serial };
}

const add = h => h.el('AddMissingParameters');
const status = h => h.el('ParameterInterface').dataset.status;

test('first creation exposes the saved interface without writing parameters or creating implicit bindings', async t => {
  const h = await fixture(t); await h.open();
  assert.equal(h.el('Parameters').value, '{}'); assert.equal(status(h), 'ready'); assert.match(h.el('ParameterDeclarations').textContent, /amount/);
  assert.match(h.el('ParameterStatus').textContent, /缺失 3/); assert.equal(add(h).disabled, false); assert.equal(h.commands.length, 0); assert.equal(h.serial(), 52);
  h.set('Source', id(10), 'change'); assert.equal(h.el('Parameters').value, '{}'); assert.equal(h.commands.length, 0);
  await h.click('Check'); assert.deepEqual(JSON.parse(h.commands[0].content).bindings[0].parameters, {});
});

test('explicit completion appends defaults while preserving old JSON whitespace escapes and numeric spelling through review and apply', async t => {
  const h = await fixture(t); await h.open(); const input = '{\r\n\t"amount" : 1e+0, "custom": "line\\r\\n\\u0061"\r\n}  ';
  h.set('Parameters', input); const before = h.el('Parameters').value; await h.click('AddMissingParameters'); const after = h.el('Parameters').value;
  assert.ok(after.startsWith(before.slice(0, before.indexOf('\n}')))); assert.ok(after.endsWith('\n}  ')); assert.match(after, /1e\+0/); assert.match(after, /\\u0061/);
  assert.deepEqual(JSON.parse(after), { amount: 1, custom: 'line\r\na', enabled: false, caption: '' }); assert.equal(add(h).disabled, true);
  await h.click('Check'); assert.ok(h.commands[0].content.includes(after)); assert.equal(h.el('Save').disabled, false);
  await h.click('Save'); assert.equal(h.commands.length, 2); assert.equal(h.commands[1].content, h.commands[0].content); assert.equal(h.applied.length, 1);
});

test('incomplete duplicate nonobject and nonscalar JSON stay untouched and cannot be completed or submitted', async t => {
  for (const content of ['{"amount":1e-', '{"amount":1,"amount":2}', '[]', '{"amount":{}}', '{"caption":null}', '{"__proto__":"x"}']) {
    const h = await fixture(t); await h.open(); h.set('Parameters', content);
    assert.equal(status(h), 'invalid'); assert.equal(add(h).disabled, true); add(h).dispatch('click'); assert.equal(h.el('Parameters').value, content);
    await h.click('Check'); assert.equal(h.commands.length, 0); assert.equal(h.el('Parameters').value, content); assert.equal(h.el('Dialog').open, true);
  }
});

test('each binding retains independent raw JSON and identities through switching and all three languages', async t => {
  const h = await fixture(t); await h.open(); const first = h.el('BindingList').value; h.set('Parameters', '{\r\n "amount":1e-'); const raw = h.el('Parameters').value;
  await h.click('AddBinding'); const second = h.el('BindingList').value; assert.notEqual(first, second); assert.equal(h.el('Parameters').value, '{}');
  await h.click('AddMissingParameters'); const complete = h.el('Parameters').value;
  for (const locale of ['en', 'ja', 'zh']) { h.language(locale); assert.equal(h.el('Parameters').value, complete); h.set('BindingList', first, 'change'); assert.equal(h.el('Parameters').value, raw);
    h.set('BindingList', second, 'change'); assert.equal(h.el('Parameters').value, complete); }
  assert.equal(h.serial(), 53); assert.equal(h.commands.length, 0);
});

test('unsupported modified unavailable incompatible and missing interfaces leave manual parameters and ordinary review usable', async t => {
  for (const c of [contract('modified'), contract('unsupported'), contract('unavailable'), contract('ready', { backendId: 'org.viento.bevy-rust', language: 'rust' }), null]) {
    const data = catalog(); data.sources[0] = source(9, c); const h = await fixture(t, { catalog: data }); await h.open(); h.set('Parameters', '{ "manual": -0 }');
    assert.notEqual(status(h), 'ready'); assert.equal(add(h).disabled, true); add(h).dispatch('click'); assert.equal(h.el('Parameters').value, '{ "manual": -0 }');
    await h.click('Check'); assert.equal(h.commands.length, 1); assert.match(h.commands[0].content, /"manual": -0/); assert.equal(h.el('Save').disabled, false);
  }
});

test('malformed advisory declarations neither invoke accessors or serializers nor remove manual creation', async t => {
  let calls = 0; const bad = contract(); Object.defineProperty(bad.parameters[0], 'defaultValue', { enumerable: true, get() { calls++; return 4; } });
  const hook = { ...contract(), toJSON() { calls++; return contract(); } };
  for (const c of [bad, hook, { ...contract(), unknown: undefined }]) {
    const data = catalog(); data.sources[0] = source(9, c); const h = await fixture(t, { catalog: data }); await h.open();
    assert.equal(status(h), 'unavailable'); h.set('Parameters', '{"manual":true}'); await h.click('Check'); assert.equal(h.commands.length, 1); assert.equal(calls, 0);
  }
  const data = catalog(); Object.defineProperty(data.sources[0], 'parameterContract', { enumerable: true, get() { calls++; return contract(); } });
  const h = await fixture(t, { catalog: data }); await h.open(); assert.equal(status(h), 'unavailable'); await h.click('Check'); assert.equal(h.commands.length, 1); assert.equal(calls, 0);
});

test('old completion controls cannot mutate another binding or regain authority after a source is switched away and back', async t => {
  const h = await fixture(t); await h.open(); const first = h.el('BindingList').value, old = add(h); h.set('Source', id(10), 'change'); h.set('Source', id(9), 'change');
  old.dispatch('click'); assert.equal(h.el('Parameters').value, '{}'); const current = add(h); await h.click('AddBinding'); const second = h.el('BindingList').value;
  current.dispatch('click'); assert.equal(h.el('Parameters').value, '{}'); h.set('BindingList', first, 'change'); current.dispatch('click'); assert.equal(h.el('Parameters').value, '{}');
  h.set('BindingList', second, 'change'); await h.click('AddMissingParameters'); assert.equal(JSON.parse(h.el('Parameters').value).amount, 4);
});

test('rereading disables late controls and fresh catalogs revoke old source ownership even with the same identity and interface', async t => {
  const pending = deferred(); const h = await fixture(t, { inspect: (request, count, data) => count === 2 ? pending.promise : data }); await h.open(); const old = add(h);
  h.el('Refresh').click(); await settle(); assert.equal(add(h).disabled, true); old.dispatch('click'); assert.equal(h.el('Parameters').value, '{}');
  pending.resolve(copy(h.data())); await settle(); old.dispatch('click'); assert.equal(h.el('Parameters').value, '{}'); await h.click('AddMissingParameters'); assert.equal(JSON.parse(h.el('Parameters').value).amount, 4);
});

test('a changed source revision and withdrawn interface refresh only the advisory view while preserving raw parameters', async t => {
  const h = await fixture(t); await h.open(); h.set('Parameters', '{ "manual": 1e0 }'); const old = add(h), next = copy(h.data());
  next.sources[0].sourceRevision = revision('changed'); next.sources[0].parameterContract = contract('modified'); h.setData(next); await h.click('Refresh');
  assert.equal(status(h), 'modified'); old.dispatch('click'); assert.equal(h.el('Parameters').value, '{ "manual": 1e0 }'); await h.click('Check'); assert.equal(h.commands.length, 1);
});

test('source session capability and dirty changes reject late catalogs and keep unfinished input visible', async t => {
  for (const change of [h => { h.context.sourceToken = 'other'; }, h => { h.context.session = 'other'; }, h => { h.context.dirty = true; }, h => h.controller.setAvailable(false, [])]) {
    const pending = deferred(), h = await fixture(t, { inspect: (request, count, data) => count === 2 ? pending.promise : data }); await h.open(); h.set('Parameters', '{"amount":1e-'); const old = add(h);
    h.el('Refresh').click(); await settle(); change(h); pending.resolve(copy(h.data())); await settle(); old.dispatch('click'); assert.equal(h.el('Parameters').value, '{"amount":1e-'); assert.equal(h.el('Check').disabled, true);
  }
});

test('explicit completion revokes a reviewed transaction and requires a fresh full-source review', async t => {
  const h = await fixture(t); await h.open(); await h.click('Check'); assert.equal(h.el('Save').disabled, false); const empty = h.commands[0].content;
  await h.click('AddMissingParameters'); assert.equal(h.el('Save').disabled, true); assert.equal(h.el('Review').hidden, true); await h.click('Save'); assert.equal(h.commands.length, 1);
  await h.click('Check'); assert.notEqual(h.commands[1].content, empty); assert.equal(JSON.parse(h.commands[1].content).bindings[0].parameters.amount, 4);
});

test('pending reviews and old disposed controls cannot apply parameter proposals', async t => {
  const pending = deferred(), h = await fixture(t, { command: request => pending.promise }); await h.open(); const old = add(h); h.el('Check').click(); await settle();
  old.dispatch('click'); assert.equal(h.el('Parameters').value, '{}'); pending.resolve(receipt(h.commands[0], h.data())); await settle();
  h.controller.dispose(); old.dispatch('click'); assert.equal(h.commands.length, 1);
});

test('backend selection never translates source or fills defaults and switching back requires another explicit action', async t => {
  const h = await fixture(t); await h.open(); h.set('Parameters', '{"manual":"keep"}'); h.set('Profile', 'bevy-rust', 'change');
  assert.equal(status(h), 'incompatible'); assert.equal(h.el('Parameters').value, '{"manual":"keep"}'); h.set('Profile', 'godot-gdscript', 'change'); assert.equal(status(h), 'ready');
  assert.equal(h.el('Parameters').value, '{"manual":"keep"}'); await h.click('AddMissingParameters'); assert.deepEqual(JSON.parse(h.el('Parameters').value), { manual: 'keep', amount: 4, enabled: false, caption: '' });
});

test('the parameter budget disables completion while valid manual parameters still use the existing transaction', async t => {
  const h = await fixture(t); await h.open(); const content = JSON.stringify(Object.fromEntries(Array.from({ length: 32 }, (_, n) => ['manual_' + n, n]))); h.set('Parameters', content);
  assert.equal(status(h), 'ready'); assert.equal(add(h).disabled, true); add(h).dispatch('click'); assert.equal(h.el('Parameters').value, content); await h.click('Check'); assert.equal(h.commands.length, 1);
});

test('script creation suspend and resume keep independent raw parameter fragments but invalidate the old interface control', async t => {
  const h = await fixture(t); await h.open(); h.set('Parameters', '{\r\n "amount": 1e-'); const before = h.el('Parameters').value, old = add(h);
  await h.click('NewScript'); const ticket = h.controller.suspendForScript(h.intents.at(-1)); assert.ok(ticket); await settle(); assert.equal(h.el('Dialog').dataset.dirty, 'true'); old.dispatch('click');
  h.context.session = 'build:return'; h.context.sourceToken = 'scene:return'; assert.equal(await h.controller.resumeFromScript(ticket), true); assert.equal(h.el('Parameters').value, before);
  old.dispatch('click'); assert.equal(h.el('Parameters').value, before); assert.equal(status(h), 'invalid'); assert.equal(h.commands.length, 0);
});

test('manual JSON creation remains available when the optional advisory UI is absent', async t => {
  const h = await fixture(t, { noHelper: true }); await h.open(); h.set('Parameters', '{ "manual": false }'); await h.click('Check');
  assert.equal(h.commands.length, 1); assert.deepEqual(JSON.parse(h.commands[0].content).bindings[0].parameters, { manual: false });
});


test('a completion that exceeds the source budget reports failure and preserves the complete original JSON and approved review', async t => {
  const data = catalog(); data.sources[0].parameterContract = contract('ready', { parameters: [declaration('large_one', 'string', 'x'.repeat(4096)), declaration('large_two', 'string', 'y'.repeat(4096))] });
  const h = await fixture(t, { catalog: data }); await h.open(); const raw = JSON.stringify(Object.fromEntries(Array.from({ length: 7 }, (_, n) => ['manual_' + n, 'm'.repeat(4096)])));
  h.set('Parameters', raw); await h.click('Check'); assert.equal(h.el('Save').disabled, false); const reviewed = h.el('SourceText').textContent;
  assert.equal(add(h).disabled, false); await h.click('AddMissingParameters'); assert.equal(h.el('Parameters').value, raw);
  assert.match(h.el('ParameterError').textContent, /无法补齐参数.*输入已保留/); assert.equal(h.el('Save').disabled, false); assert.equal(h.el('SourceText').textContent, reviewed); assert.equal(h.commands.length, 1);
});

test('the actual helper preserves CRLF and a BOM in an existing raw fragment when appending defaults', async t => {
  const h = await fixture(t, { noHelper: true }), container = h.document.createElement('section'); h.document.body.append(container);
  const before = '\uFEFF{\r\n\t"amount" : 1e0\r\n}\r\n';
  const state = { current: true, pending: false, session: {}, catalog: {}, source: source(9), bindingId: id(20), backendId: 'org.viento.godot4', language: 'gdscript', epoch: 1, readEpoch: 1, content: before };
  let used = 0;
  const helper = setupSceneBehaviorCreateParameters({ container, getContext: () => state, onUse: (proposal, { isCurrent }) => { assert.equal(isCurrent(), true); used++; state.content = proposal.content; helper.refresh(); } });
  t.after(() => helper.dispose()); h.element('sceneBehaviorCreateAddMissingParameters').click(); assert.equal(used, 1);
  assert.ok(state.content.startsWith('\uFEFF{\r\n\t"amount" : 1e0')); assert.ok(state.content.endsWith('\r\n}\r\n')); assert.equal(state.content.replaceAll('\r\n', '').includes('\n'), false);
});
