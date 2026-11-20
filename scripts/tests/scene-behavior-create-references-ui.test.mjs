import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { setupSceneBehaviorCreateReferences } from '../../web/modules/app-scene-behavior-create-references.js';
import { createSceneBehaviorCreationDraft } from '../../engine/scene-behavior-create-plan.mjs';
import { applySceneBehaviorCreateParameterSources } from '../../engine/scene-behavior-create-parameters.mjs';
import { listSceneBehaviorCreateStringParameters } from '../../engine/scene-behavior-create-references.mjs';
import { SCENE_BEHAVIOR_LIMITS } from '../../engine/scene-behaviors.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const revision = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const worldId = 'world:' + 'a'.repeat(64), copy = value => JSON.parse(JSON.stringify(value));
const scene = () => ({ objectId: id(1), sourcePath: 'documents/scenes/level.json', sourceRevision: revision('scene') });
const origin = () => ({ worldId, baseRevision: revision('world'), scene: { ...scene(), objectRevision: revision('scene-record') } });
const named = (n, name, sourcePath) => ({ objectId: id(n), name, sourcePath, sourceRevision: revision(sourcePath) });
function directory(assemblyObjectId = null) {
  const assemblies = [named(20, 'Main <b>', 'documents/projects/main.json'), named(21, 'Practice', 'documents/projects/practice.json')];
  return { format: 'viento-scene-behavior-reference-directory', schemaVersion: 1, worldId, revision: revision('world'), scene: scene(),
    instances: [8, 10].map(instanceId => ({ instanceId: id(instanceId), ...named(11, 'Player <b>', 'documents/definitions/player.md') })), assemblies,
    selectedAssembly: assemblyObjectId ? { ...assemblies.find(row => row.objectId === assemblyObjectId),
      members: [{ ...scene(), name: 'Current' }, named(assemblyObjectId === id(20) ? 2 : 3, 'Result <b>', `documents/scenes/result${assemblyObjectId === id(20) ? 2 : 3}.json`)],
      inputMap: { objectId: id(30), sourcePath: 'documents/inputs/keyboard.json', sourceRevision: revision('input') },
      actions: [{ name: assemblyObjectId === id(20) ? 'start_retry' : 'interact', keys: ['Enter'] }] } : null };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let index = 0; index < 3; index++) { await flushDialogs(); await new Promise(resolve => setTimeout(resolve, 2)); } };
async function helperFixture(t, options = {}) {
  const h = await dialogHarness('app-scene-behavior-create-references'), container = h.document.createElement('section'); h.document.body.append(container);
  const state = { available: true, current: true, pending: false, session: {}, catalog: {}, source: {}, bindingId: id(40), instanceId: id(8),
    backendId: 'org.viento.godot4', language: 'gdscript', epoch: 1, readEpoch: 1, origin: origin(), content: '{ "arbitrary": "old", "action": "keep", "amount": 1e2, "negative_zero": -0, "note":"first\\r\\nnext" }', ...options.context };
  let language = 'zh', reviewApproved = true; const reads = [], applied = [];
  const controller = setupSceneBehaviorCreateReferences({ container, getContext: () => state,
    ...(options.noPort ? {} : { getReferences: async request => { reads.push(copy(request)); return options.read ? options.read(request, reads.length) : directory(request.assemblyObjectId); } }),
    translate: (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? ''))),
    onUse: (proposal, { isCurrent }) => { assert.equal(isCurrent(), true); applied.push(proposal); state.content = proposal.content; reviewApproved = false; controller.refresh(); } });
  t.after(() => controller.dispose());
  const el = suffix => container.querySelector('#sceneBehaviorCreateReferences' + suffix);
  const select = (suffix, value) => { el(suffix).value = value; el(suffix).dispatch('change'); };
  return { ...h, container, state, controller, reads, applied, el, select, approved: () => reviewApproved,
    async load() { el('Load').click(); await settle(); }, async assembly(value) { select('Assembly', value); await settle(); },
    choose(kind, value, parameter = 'arbitrary') { select('Kind', kind); select('Choice', value); select('Parameter', parameter); },
    async use() { el('Use').click(); await settle(); }, language(value) { language = value; controller.refresh(); } };
}

test('creation references are optional, strictly capability gated and do not start a read or alter JSON at mount', async t => {
  for (const options of [{ noPort: true }, { context: { available: false } }, { context: { available: 1 } }, { context: { current: false } }]) {
    const h = await helperFixture(t, options), before = h.state.content;
    assert.equal(h.container.hidden, true); assert.equal(h.container.children.length, 0); assert.equal(h.reads.length, 0); assert.equal(h.state.content, before); assert.equal(h.approved(), true);
  }
});

test('all choices begin empty and loading never selects an assembly or a reference kind, even with one assembly', async t => {
  for (const count of [0, 1, 2]) {
    const h = await helperFixture(t, { read: request => { const raw = directory(request.assemblyObjectId); raw.assemblies = raw.assemblies.slice(0, count); return raw; } }), before = h.state.content;
    assert.equal(h.reads.length, 0); for (const name of ['Assembly', 'Kind', 'Choice', 'Parameter']) assert.equal(h.el(name).value, '');
    await h.load(); assert.deepEqual(h.reads, [{ sceneObjectId: id(1), assemblyObjectId: null }]);
    assert.equal(h.el('Assembly').children.length, count + 1); for (const name of ['Assembly', 'Kind', 'Choice', 'Parameter']) assert.equal(h.el(name).value, '');
    assert.equal(h.el('Choice').children.length, 1); assert.equal(h.el('Parameter').children.length, 4); assert.equal(h.el('Use').disabled, true);
    assert.equal(h.state.content, before); assert.equal(h.approved(), true);
  }
});

test('local instances retain repeated definition identities, labels and sources while selection alone changes nothing', async t => {
  const h = await helperFixture(t), before = h.state.content; await h.load(); h.select('Kind', 'instance');
  assert.ok(h.el('Choice').children[1].textContent.includes('Player <b>')); assert.equal(h.container.querySelector('b'), null);
  assert.ok(h.el('Choice').children[1].textContent.includes(id(8))); assert.ok(h.el('Choice').children[2].textContent.includes(id(10)));
  h.choose('instance', id(10)); assert.match(h.el('Detail').textContent, /documents\/definitions\/player\.md/); assert.ok(h.el('Detail').textContent.includes(id(11)));
  assert.equal(h.state.content, before); assert.equal(h.approved(), true); assert.equal(h.applied.length, 0);
});

test('only an explicitly selected assembly supplies its own member IDs and saved input actions', async t => {
  const h = await helperFixture(t); await h.load(); h.select('Kind', 'scene'); assert.equal(h.el('Choice').children.length, 1);
  await h.assembly(id(20)); h.select('Kind', 'scene'); assert.deepEqual(h.el('Choice').children.slice(1).map(row => row.value), [id(1), id(2)]);
  h.select('Kind', 'action'); assert.deepEqual(h.el('Choice').children.slice(1).map(row => row.value), ['start_retry']); assert.equal(h.el('Choice').children.some(row => row.value === 'ui_accept'), false);
  await h.assembly(id(21)); h.select('Kind', 'scene'); assert.deepEqual(h.el('Choice').children.slice(1).map(row => row.value), [id(1), id(3)]);
  h.select('Kind', 'action'); assert.deepEqual(h.el('Choice').children.slice(1).map(row => row.value), ['interact']); assert.equal(h.applied.length, 0); assert.equal(h.approved(), true);
});

test('fill rereads the same scope and changes only the selected String token while retaining raw number and escaped text bytes', async t => {
  const h = await helperFixture(t), before = h.state.content; await h.load(); h.choose('instance', id(8)); await h.use();
  assert.deepEqual(h.reads, [{ sceneObjectId: id(1), assemblyObjectId: null }, { sceneObjectId: id(1), assemblyObjectId: null }]);
  assert.equal(h.state.content, before.replace('"old"', JSON.stringify(id(8)))); assert.match(h.state.content, /1e2/); assert.match(h.state.content, /-0/); assert.match(h.state.content, /first\\r\\nnext/);
  assert.equal(h.applied.length, 1); assert.equal(h.approved(), false);
});

test('same semantic String value preserves its original escape spelling and never revokes review', async t => {
  const literal = JSON.stringify(id(8)).replace('"0', '"\\u0030');
  const h = await helperFixture(t, { context: { content: '{ "arbitrary": ' + literal + ', "number": 1e2 }' } }), before = h.state.content;
  await h.load(); h.choose('instance', id(8)); await h.use(); assert.equal(h.reads.length, 2); assert.equal(h.state.content, before); assert.equal(h.applied.length, 0); assert.equal(h.approved(), true);
  assert.match(h.el('Status').textContent, /当前参数相同/);
});

test('invalid or unfinished JSON has no target choices and remains untouched while the saved reference directory can still be read', async t => {
  for (const content of ['{"arbitrary":"old","amount":1e-', '{"arbitrary":"first","arbitrary":"second"}', '[]', '{"object":{}}']) {
    const h = await helperFixture(t, { context: { content } }); await h.load(); h.select('Kind', 'instance'); h.select('Choice', id(8));
    assert.equal(h.el('Parameter').children.length, 1); assert.equal(h.el('Use').disabled, true); h.el('Use').dispatch('click'); await settle();
    assert.equal(h.state.content, content); assert.equal(h.reads.length, 1); assert.equal(h.approved(), true); assert.equal(h.applied.length, 0);
  }
});

test('missing input map leaves actions empty without disabling local instances or ordinary parameter editing', async t => {
  const h = await helperFixture(t, { read: request => { const raw = directory(request.assemblyObjectId); if (raw.selectedAssembly) { raw.selectedAssembly.inputMap = null; raw.selectedAssembly.actions = []; } return raw; } });
  await h.load(); await h.assembly(id(20)); h.select('Kind', 'action'); assert.equal(h.el('Choice').children.length, 1); assert.match(h.el('Status').textContent, /未声明输入映射/);
  h.choose('instance', id(10)); await h.use(); assert.equal(JSON.parse(h.state.content).arbitrary, id(10));
});

test('fresh directory changes in world, scene, assembly metadata, input or full fingerprint refuse insertion without losing parameters or review', async t => {
  for (const change of [raw => { raw.revision = revision('later'); }, raw => { raw.worldId = 'world:' + 'b'.repeat(64); }, raw => { raw.scene.sourceRevision = revision('later'); },
    raw => { raw.instances[0].name = 'renamed'; }, raw => { raw.selectedAssembly.inputMap.sourceRevision = revision('changed map'); }, raw => { raw.selectedAssembly.actions[0].keys = ['Space']; },
    raw => { raw.selectedAssembly = directory(id(21)).selectedAssembly; }]) {
    const h = await helperFixture(t, { read: (request, count) => { const raw = directory(request.assemblyObjectId); if (count === 3) change(raw); return raw; } }), before = h.state.content;
    await h.load(); await h.assembly(id(20)); h.choose('action', 'start_retry'); await h.use(); assert.equal(h.state.content, before); assert.equal(h.applied.length, 0); assert.equal(h.approved(), true); assert.equal(h.el('Use').disabled, true);
  }
});

test('every owner identity change revokes late loads and detached controls cannot acquire the new form', async t => {
  for (const change of [h => { h.state.session = {}; }, h => { h.state.catalog = {}; }, h => { h.state.source = {}; }, h => { h.state.bindingId = id(41); }, h => { h.state.instanceId = id(10); },
    h => { h.state.backendId = 'org.viento.bevy-rust'; }, h => { h.state.language = 'rust'; }, h => { h.state.epoch++; }, h => { h.state.readEpoch++; }, h => { h.state.origin.scene.objectRevision = revision('record changed'); }]) {
    const pending = deferred(), h = await helperFixture(t, { read: () => pending.promise }), before = h.state.content, old = h.el('Load');
    old.click(); await settle(); change(h); h.controller.refresh(); pending.resolve(directory()); await settle(); old.dispatch('click'); await settle();
    assert.equal(h.state.content, before); assert.equal(h.applied.length, 0); assert.equal(h.el('Status').dataset.status, 'idle'); assert.equal(h.reads.length, 1);
  }
});

test('silent JSON or selector changes during fresh revalidation cannot overwrite another edit or redirect the pending fill', async t => {
  for (const change of [h => { h.state.content += ' '; }, h => { h.el('Assembly').value = id(20); }, h => { h.el('Kind').value = 'action'; }, h => { h.el('Choice').value = id(10); }, h => { h.el('Parameter').value = 'action'; }]) {
    const pending = deferred(), h = await helperFixture(t, { read: (request, count) => count === 2 ? pending.promise : directory(request.assemblyObjectId) }); await h.load(); h.choose('instance', id(8));
    h.el('Use').click(); await settle(); change(h); const before = h.state.content; pending.resolve(directory()); await settle(); assert.equal(h.state.content, before); assert.equal(h.applied.length, 0); assert.equal(h.approved(), true);
  }
});

test('an observed ordinary review or capability withdrawal permanently revokes a pending read even if it is restored before response', async t => {
  for (const key of ['pending', 'available', 'current']) {
    const pending = deferred(), h = await helperFixture(t, { read: () => pending.promise }); h.el('Load').click(); await settle();
    const original = h.state[key]; h.state[key] = key === 'pending'; h.controller.refresh(); h.state[key] = original; h.controller.refresh(); pending.resolve(directory()); await settle();
    assert.equal(h.el('Status').dataset.status, key === 'pending' ? 'error' : 'idle'); assert.equal(h.el('Use').disabled, true); assert.equal(h.applied.length, 0); assert.equal(h.approved(), true);
  }
});

test('failed refresh disables old choices and permits retry while keeping raw JSON and review', async t => {
  let fail = true; const h = await helperFixture(t, { read: (request, count) => { if (count === 2 && fail) throw Error('offline'); return directory(request.assemblyObjectId); } }), before = h.state.content;
  await h.load(); h.choose('instance', id(8)); await h.use(); assert.equal(h.el('Use').disabled, true); assert.equal(h.state.content, before); assert.equal(h.approved(), true);
  fail = false; await h.load(); h.choose('instance', id(8)); await h.use(); assert.equal(JSON.parse(h.state.content).arbitrary, id(8));
});

test('forged choices never issue a fill read and language changes preserve explicit choices, content and focus', async t => {
  const h = await helperFixture(t), before = h.state.content; await h.load(); h.choose('instance', id(8));
  const focused = h.el('Parameter'); focused.focus();
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Kind').value, 'instance'); assert.equal(h.el('Choice').value, id(8)); assert.equal(h.el('Parameter').value, 'arbitrary'); assert.equal(h.document.activeElement, focused); }
  h.el('Choice').value = id(99); h.el('Use').dispatch('click'); await settle(); assert.equal(h.reads.length, 1); assert.equal(h.state.content, before); assert.equal(h.approved(), true);
});

test('duplicate reads and disposed or reset controls never insert or issue another request', async t => {
  const pending = deferred(), h = await helperFixture(t, { read: () => pending.promise }), old = h.el('Load'); old.click(); old.dispatch('click'); await settle(); assert.equal(h.reads.length, 1);
  h.controller.dispose(); pending.resolve(directory()); await settle(); old.dispatch('click'); await settle(); assert.equal(h.reads.length, 1); assert.equal(h.applied.length, 0);
});

function transport(value) {
  if (!value || typeof value !== 'object') return value;
  const result = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype);
  for (const key of Reflect.ownKeys(value)) { const d = Object.getOwnPropertyDescriptor(value, key); Object.defineProperty(result, key, Object.hasOwn(d, 'value') ? { ...d, value: transport(d.value) } : d); }
  return result;
}
function creationCatalog() {
  return { format: 'viento-behavior-creation-context', schemaVersion: 1, worldId, baseRevision: revision('world'), documentRoot: 'documents', documentTypes: [{ id: 'document', label: 'Notes' }],
    scene: { ...origin().scene, instances: [8, 10].map(n => ({ instanceId: id(n), objectId: id(11), name: 'Player' })) },
    sources: [{ objectId: id(9), sourcePath: 'documents/scripts/retry.txt', sourceRevision: revision('script'), name: 'Retry' }] };
}
function receipt(request, data) {
  const afterSourceRevision = revision(request.content), input = copy(request); delete input.mode;
  const record = { id: request.objectId, sourcePath: request.sourcePath, documentType: request.documentType, relations: [id(1), id(9)].map(targetId => ({ kind: 'references', targetId, slot: '' })) };
  return { status: request.mode === 'apply' ? 'applied' : 'preview', worldId: request.worldId, baseRevision: request.baseRevision, revision: revision('after'), proposal: { commands: [{ id: 'behavior.create', input }] },
    object: { id: request.objectId, documentRefs: [{ sourcePath: request.sourcePath, sourceRevision: afterSourceRevision }] },
    changes: [{ kind: 'behavior.create', objectId: request.objectId, sourcePath: request.sourcePath, beforeText: null, beforeSourceRevision: null, afterText: request.content, afterSourceRevision,
      recordPath: `metadata/documents/${request.objectId}.json`, record }, { kind: 'relation.add', objectId: request.sceneObjectId, sourcePath: data.scene.sourcePath, targetObjectId: request.objectId, targetSourcePath: request.sourcePath, relation: { kind: 'behavior', targetId: request.objectId, slot: '' } }] };
}
async function parentFixture(t, options = {}) {
  let serial = 50; const data = creationCatalog(), reads = [], commands = [], intents = [], context = { editable: true, dirty: false, creating: false, busy: false, visible: true, session: 'build:1', sceneId: id(1), sourceToken: 'scene:1', referencesAvailable: options.available ?? true };
  const h = await dialogHarness('app-scene-behavior-create', { SCENE_BEHAVIOR_LIMITS,
    createSceneBehaviorCreationDraft: input => createSceneBehaviorCreationDraft(transport(input)), applySceneBehaviorCreateParameterSources: input => applySceneBehaviorCreateParameterSources(transport(input)),
    setupSceneBehaviorCreateReferences: ports => setupSceneBehaviorCreateReferences({ ...ports, getContext: () => { const context = ports.getContext(); return { ...context, origin: transport(context.origin) }; } }),
    crypto: { subtle: webcrypto.subtle, randomUUID: () => id(++serial) }, t: (key, ...args) => key.replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')) });
  const controller = h.runtime.setupSceneBehaviorCreate({ getContext: () => context, inspect: async () => copy(data), command: async request => { commands.push(copy(request)); return receipt(request, data); },
    requestScriptCreation: async intent => { intents.push(intent); return false; }, ...(options.noPort ? {} : { getReferences: async request => { reads.push(copy(request)); return options.read ? options.read(request, reads.length) : directory(request.assemblyObjectId); } }) });
  controller.setAvailable(true, ['behavior.create']); t.after(() => controller.dispose());
  const el = suffix => h.element('sceneBehaviorCreate' + suffix), ref = suffix => h.element('sceneBehaviorCreateReferences' + suffix);
  const set = (suffix, value, event = 'input') => { el(suffix).value = value; el(suffix).dispatch(event); }, select = (suffix, value) => { ref(suffix).value = value; ref(suffix).dispatch('change'); };
  assert.equal(controller.open(context.sceneId), true); await settle();
  return { ...h, controller, context, el, ref, set, select, reads, commands, intents,
    async click(suffix) { el(suffix).click(); await settle(); }, async load() { ref('Load').click(); await settle(); },
    choose(value) { select('Kind', 'instance'); select('Choice', value); select('Parameter', 'arbitrary'); }, async use() { ref('Use').click(); await settle(); } };
}

test('the actual creation dialog keeps ordinary review independent and only an effective fill revokes its approved transaction', async t => {
  const h = await parentFixture(t); h.set('Parameters', '{ "arbitrary": "old", "amount":1e2,"zero":-0 }'); await h.click('Check'); assert.equal(h.el('Save').disabled, false); const first = h.commands[0].content;
  await h.load(); h.choose(id(8)); assert.equal(h.el('Save').disabled, false); assert.equal(h.el('Parameters').value, '{ "arbitrary": "old", "amount":1e2,"zero":-0 }');
  await h.use(); assert.equal(h.el('Save').disabled, true); assert.equal(h.el('Parameters').value, '{ "arbitrary": "' + id(8) + '", "amount":1e2,"zero":-0 }');
  await h.click('Check'); assert.notEqual(h.commands[1].content, first); await h.click('Save'); assert.equal(h.commands[2].content, h.commands[1].content); assert.equal(h.reads.length, 2);
});

test('same-value insertion and failed reference reads preserve the actual parent review and its exact source', async t => {
  for (const failure of [false, true]) {
    const h = await parentFixture(t, { read: (request, count) => { if (failure && count === 2) throw Error('offline'); return directory(request.assemblyObjectId); } });
    h.set('Parameters', '{"arbitrary":' + JSON.stringify(id(8)).replace('"0', '"\\u0030') + '}'); await h.click('Check'); const reviewed = h.el('SourceText').textContent, raw = h.el('Parameters').value;
    await h.load(); h.choose(id(8)); await h.use(); assert.equal(h.el('Save').disabled, false); assert.equal(h.el('SourceText').textContent, reviewed); assert.equal(h.el('Parameters').value, raw); assert.equal(h.commands.length, 1);
  }
});

test('the real parent cancels in-flight helper reads across ordinary review and script suspend/resume without losing its JSON', async t => {
  const pending = deferred(), h = await parentFixture(t, { read: () => pending.promise }); h.set('Parameters', '{"arbitrary":"old"}'); h.ref('Load').click(); await settle();
  await h.click('Check'); assert.equal(h.el('Save').disabled, false); pending.resolve(directory()); await settle(); assert.equal(h.ref('Status').dataset.status, 'error'); assert.equal(h.ref('Use').disabled, true);
  const old = h.ref('Load'); await h.click('NewScript'); const ticket = h.controller.suspendForScript(h.intents.at(-1)); assert.ok(ticket); await settle();
  h.context.session = 'build:returned'; h.context.sourceToken = 'scene:returned'; assert.equal(await h.controller.resumeFromScript(ticket), true); old.dispatch('click'); await settle();
  assert.equal(h.el('Parameters').value, '{"arbitrary":"old"}'); assert.equal(h.ref('Kind').value, ''); assert.equal(h.ref('Assembly').value, ''); assert.equal(h.reads.length, 1);
});

test('the actual creation dialog permits manual parameter review without the optional port or exact capability', async t => {
  for (const options of [{ noPort: true }, { available: false }]) { const h = await parentFixture(t, options); assert.equal(h.el('References').hidden, true); h.set('Parameters', '{"manual":"keep"}'); await h.click('Check'); assert.equal(h.commands.length, 1); assert.equal(h.el('Save').disabled, false); assert.equal(h.reads.length, 0); }
});

test('every fixed reference-helper message has English and Japanese translations', async () => {
  const text = await fs.readFile(new URL('../../web/modules/app-scene-behavior-create-references.js', import.meta.url), 'utf8');
  const keys = [...text.matchAll(/(?:translate\(|message\s*=\s*|hint\s*=\s*|changedOriginMessage\s*=\s*)'([^']+)'/g)].map(match => match[1]).filter(key => /[\u4e00-\u9fff]/.test(key));
  for (const key of keys) { assert.ok(en[key], 'en: ' + key); assert.ok(ja[key], 'ja: ' + key); }
});


test('a saved World revision change requests a parent creation refresh instead of silently adopting a new baseline', async t => {
  const h = await helperFixture(t, { read: () => ({ ...directory(), revision: revision('external write') }) }), before = h.state.content, base = h.state.origin.baseRevision;
  await h.load(); assert.equal(h.el('Status').dataset.status, 'error'); assert.match(h.el('Status').textContent, /创建窗口重新读取工程/);
  assert.equal(h.state.origin.baseRevision, base); assert.equal(h.state.content, before); assert.equal(h.approved(), true); assert.equal(h.applied.length, 0);
});


test('a UUID insertion exceeding the source budget preserves the actual approved parent source, original JSON and valid directory', async t => {
  const fragment = length => JSON.stringify({ arbitrary: '', ...Object.fromEntries(Array.from({ length: 7 }, (_, index) => ['manual_' + index, 'x'.repeat(4096)])), padding: 'p'.repeat(length) });
  let low = 0, high = 4096;
  while (low < high) { const mid = Math.ceil((low + high) / 2); try { listSceneBehaviorCreateStringParameters(fragment(mid)); low = mid; } catch { high = mid - 1; } }
  const raw = fragment(low), h = await parentFixture(t); h.set('Parameters', raw); await h.click('Check'); assert.equal(h.el('Save').disabled, false);
  const reviewed = h.el('SourceText').textContent; await h.load(); h.choose(id(8)); await h.use();
  assert.equal(h.el('Parameters').value, raw); assert.equal(h.el('Save').disabled, false); assert.equal(h.el('SourceText').textContent, reviewed); assert.equal(h.commands.length, 1);
  assert.match(h.ref('Status').textContent, /无法填入参数.*输入已保留/); assert.equal(h.ref('Status').dataset.status, 'ready'); assert.equal(h.ref('Choice').value, id(8)); assert.equal(h.ref('Use').disabled, false);
});


test('a reviewed two-binding manifest at exactly 32768 bytes rejects aggregate overflow before changing JSON or approval and can still save its original source', async t => {
  const h = await parentFixture(t), first = h.el('BindingList').value;
  const fragment = length => JSON.stringify({ arbitrary: '', a: 'x'.repeat(4096), b: 'x'.repeat(4096), c: 'x'.repeat(4096), d: 'x'.repeat(length) });
  await h.click('AddBinding'); const second = h.el('BindingList').value; h.set('Parameters', fragment(3200)); h.set('BindingList', first, 'change'); h.set('Parameters', fragment(4068));
  await h.click('Check'); assert.equal(h.el('Save').disabled, false); const reviewed = h.el('SourceText').textContent, raw = h.el('Parameters').value;
  assert.equal(Buffer.byteLength(reviewed), 32768); assert.equal(JSON.parse(reviewed).bindings.length, 2);
  await h.load(); h.choose(id(8)); await h.use();
  assert.equal(h.el('Parameters').value, raw); assert.equal(h.el('SourceText').textContent, reviewed); assert.equal(h.el('Save').disabled, false); assert.equal(h.commands.length, 1);
  assert.match(h.ref('Status').textContent, /无法填入参数.*输入已保留/); assert.equal(h.ref('Status').dataset.status, 'ready'); assert.equal(h.ref('Use').disabled, false);
  h.set('BindingList', second, 'change'); assert.equal(h.el('Parameters').value, fragment(3200)); assert.equal(h.el('Save').disabled, false);
  await h.click('Save'); assert.equal(h.commands.length, 2); assert.equal(h.commands[1].content, reviewed); assert.equal(h.commands[1].mode, 'apply');
});

test('reviewed valid nonempty parameters in multiple bindings still accept an effective fill and a new full-source review', async t => {
  const h = await parentFixture(t), first = h.el('BindingList').value; h.set('Parameters', '{"arbitrary":"old","amount":1e2}'); await h.click('AddBinding'); const second = h.el('BindingList').value;
  h.set('Parameters', '{"sibling":"keep","zero":-0}'); h.set('BindingList', first, 'change'); await h.click('Check'); assert.equal(h.el('Save').disabled, false);
  await h.load(); h.choose(id(8)); await h.use(); assert.equal(h.el('Parameters').value, '{"arbitrary":"' + id(8) + '","amount":1e2}'); assert.equal(h.el('Save').disabled, true);
  await h.click('Check'); assert.equal(h.el('Save').disabled, false); const candidate = h.commands[1].content; assert.match(candidate, /"amount":1e2/); assert.match(candidate, /"zero":-0/);
  h.set('BindingList', second, 'change'); assert.equal(h.el('Parameters').value, '{"sibling":"keep","zero":-0}'); await h.click('Save'); assert.equal(h.commands[2].content, candidate);
});

test('an unreviewed unfinished sibling never blocks filling the current valid fragment and remains untouched for final review', async t => {
  const h = await parentFixture(t), first = h.el('BindingList').value; h.set('Parameters', '{"arbitrary":"old"}'); await h.click('AddBinding'); const second = h.el('BindingList').value;
  const unfinished = '{"amount":1e-'; h.set('Parameters', unfinished); h.set('BindingList', first, 'change'); assert.equal(h.el('Save').disabled, true);
  await h.load(); h.choose(id(8)); await h.use(); assert.equal(h.el('Parameters').value, '{"arbitrary":"' + id(8) + '"}'); assert.equal(h.commands.length, 0);
  h.set('BindingList', second, 'change'); assert.equal(h.el('Parameters').value, unfinished); await h.click('Check'); assert.equal(h.commands.length, 0); assert.equal(h.el('Parameters').value, unfinished);
});
