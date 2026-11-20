import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { setupSceneBehaviorCreateAudio } from '../../web/modules/app-scene-behavior-create-audio.js';
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
const audio = () => ({ format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: id(1),
  tracks: [{ id: id(5), resourceId: id(7), role: 'effect', volume: .25, loop: false }, { id: id(4), resourceId: id(7), role: 'music', volume: .15, loop: true }], cues: [] });
const directory = () => ({ format: 'viento-scene-audio-directory', schemaVersion: 1, status: 'ready', worldId, revision: revision('world'), scene: scene(),
  manifest: { objectId: id(2), sourcePath: 'documents/audio/level.json', sourceRevision: revision('audio'), content: JSON.stringify(audio()) } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let index = 0; index < 3; index++) { await flushDialogs(); await new Promise(resolve => setTimeout(resolve, 2)); } };
async function helperFixture(t, options = {}) {
  const h = await dialogHarness('app-scene-behavior-create-audio'), container = h.document.createElement('section'); h.document.body.append(container);
  const state = { available: true, current: true, pending: false, session: {}, catalog: {}, source: {}, bindingId: id(40), instanceId: id(8),
    backendId: 'org.viento.godot4', language: 'gdscript', epoch: 1, readEpoch: 1, origin: origin(),
    content: '{ "arbitrary": "old", "other": "keep", "amount": 1e2, "negative_zero": -0, "note":"first\\r\\nnext" }', ...options.context };
  let language = 'zh', reviewApproved = true; const reads = [], applied = [];
  const controller = setupSceneBehaviorCreateAudio({ container, getContext: () => state,
    ...(options.noPort ? {} : { getAudioTracks: async request => { reads.push(copy(request)); return options.read ? options.read(request, reads.length) : directory(); } }),
    translate: (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? ''))),
    onUse: (proposal, { isCurrent }) => { assert.equal(isCurrent(), true); applied.push(proposal); state.content = proposal.content; reviewApproved = false; controller.refresh(); } });
  t.after(() => controller.dispose());
  const el = suffix => container.querySelector('#sceneBehaviorCreateAudio' + suffix);
  const select = (suffix, value) => { el(suffix).value = value; el(suffix).dispatch('change'); };
  return { ...h, container, state, controller, reads, applied, el, select, approved: () => reviewApproved,
    async load() { el('Load').click(); await settle(); }, choose(value = id(4), target = 'arbitrary') { select('Track', value); select('Parameter', target); },
    async use() { el('Use').click(); await settle(); }, language(value) { language = value; controller.refresh(); } };
}

test('first audio is optional, strictly capability gated and never reads or edits at mount', async t => {
  for (const options of [{ noPort: true }, { context: { available: false } }, { context: { available: 1 } }, { context: { current: false } }]) {
    const h = await helperFixture(t, options), before = h.state.content;
    assert.equal(h.container.hidden, true); assert.equal(h.container.children.length, 0); assert.equal(h.reads.length, 0); assert.equal(h.state.content, before); assert.equal(h.approved(), true);
  }
});

test('explicit load lists ordered track identities without auto-selecting or confusing a repeated resource with a track', async t => {
  const h = await helperFixture(t), before = h.state.content;
  assert.equal(h.el('Track').value, ''); assert.equal(h.el('Parameter').value, ''); assert.equal(h.reads.length, 0);
  await h.load(); assert.deepEqual(h.reads, [{ sceneObjectId: id(1) }]); assert.equal(h.el('Track').value, ''); assert.equal(h.el('Parameter').value, '');
  assert.deepEqual(h.el('Track').children.slice(1).map(row => row.value), [id(5), id(4)]); assert.equal(h.el('Parameter').children.length, 4); assert.equal(h.el('Use').disabled, true);
  assert.match(h.el('Track').children[1].textContent, /音效/); assert.match(h.el('Track').children[2].textContent, /音乐/);
  h.choose(id(4)); assert.match(h.el('Detail').textContent, new RegExp(id(4))); assert.match(h.el('Detail').textContent, new RegExp(id(7)));
  assert.match(h.el('Source').textContent, /documents\/scenes\/level\.json/); assert.match(h.el('Source').textContent, /documents\/audio\/level\.json/);
  assert.equal(h.state.content, before); assert.equal(h.approved(), true); assert.equal(h.applied.length, 0);
});

test('fill rereads the directory and replaces only the explicitly selected String token', async t => {
  const before = '\uFEFF{\r\n "arbitrary" : "old\\u0020value", "amount":1e2,"zero":-0,"note":"😀\\r\\n\\u0061"\r\n}\r\n';
  const h = await helperFixture(t, { context: { content: before } }); await h.load(); h.choose(id(5)); await h.use();
  assert.deepEqual(h.reads, [{ sceneObjectId: id(1) }, { sceneObjectId: id(1) }]); assert.equal(h.state.content, before.replace('"old\\u0020value"', JSON.stringify(id(5))));
  assert.equal(h.applied.length, 1); assert.equal(h.approved(), false);
});

test('an equal semantic track value preserves its escaped source and approved review', async t => {
  const content = '{ "arbitrary": ' + JSON.stringify(id(4)).replace('"0', '"\\u0030') + ', "amount":1e2 }';
  const h = await helperFixture(t, { context: { content } }); await h.load(); h.choose(); await h.use();
  assert.equal(h.reads.length, 2); assert.equal(h.state.content, content); assert.equal(h.applied.length, 0); assert.equal(h.approved(), true); assert.match(h.el('Status').textContent, /当前参数相同/);
});

test('unfinished duplicate nonscalar and nonobject JSON remain untouched and expose no target String', async t => {
  for (const content of ['{"arbitrary":"old","amount":1e-', '{"arbitrary":"a","arbitrary":"b"}', '[]', '{"nested":{}}', '{"amount":-0,"enabled":false}']) {
    const h = await helperFixture(t, { context: { content } }); await h.load(); h.select('Track', id(4)); assert.equal(h.el('Parameter').children.length, 1); assert.equal(h.el('Use').disabled, true);
    h.el('Use').dispatch('click'); await settle(); assert.equal(h.reads.length, 1); assert.equal(h.state.content, content); assert.equal(h.applied.length, 0); assert.equal(h.approved(), true);
  }
});

test('an empty saved directory is available but provides no invented track while a ready declaration with no tracks is rejected', async t => {
  for (const empty of [true, false]) {
    const h = await helperFixture(t, { read: () => { const raw = directory(); if (empty) { raw.status = 'empty'; raw.manifest = null; } else raw.manifest.content = JSON.stringify({ ...audio(), tracks: [] }); return raw; } }), before = h.state.content;
    await h.load(); assert.equal(h.container.dataset.status, empty ? 'empty' : 'error'); assert.equal(h.el('Track').children.length, 1); assert.equal(h.el('Use').disabled, true);
    assert.equal(h.state.content, before); assert.equal(h.approved(), true); assert.equal(h.applied.length, 0); if (empty) assert.match(h.el('Status').textContent, /没有已保存的音轨/);
  }
});

test('world and saved scene changes request an explicit parent refresh instead of adopting another creation baseline', async t => {
  for (const mutate of [r => { r.worldId = 'world:' + 'b'.repeat(64); }, r => { r.revision = revision('external'); }, r => { r.scene.sourcePath = 'documents/scenes/other.json'; }, r => { r.scene.sourceRevision = revision('external'); }]) {
    const h = await helperFixture(t, { read: () => { const raw = directory(); mutate(raw); return raw; } }), before = h.state.content, base = h.state.origin.baseRevision;
    await h.load(); assert.equal(h.container.dataset.status, 'error'); assert.match(h.el('Status').textContent, /创建窗口重新读取工程/); assert.equal(h.state.origin.baseRevision, base);
    assert.equal(h.state.content, before); assert.equal(h.approved(), true); assert.equal(h.applied.length, 0);
  }
});

test('fresh manifest versions, paths, identities, track order, role and resource changes refuse the pending fill', async t => {
  for (const mutate of [r => { r.manifest.sourceRevision = revision('external'); }, r => { r.manifest.sourcePath = 'documents/audio/other.json'; }, r => { r.manifest.objectId = id(20); },
    r => { r.status = 'empty'; r.manifest = null; }, r => { const a = audio(); a.tracks.reverse(); r.manifest.content = JSON.stringify(a); },
    r => { const a = audio(); a.tracks[1].resourceId = id(21); r.manifest.content = JSON.stringify(a); }, r => { const a = audio(); a.tracks[1].role = 'effect'; r.manifest.content = JSON.stringify(a); }]) {
    const h = await helperFixture(t, { read: (request, count) => { const raw = directory(); if (count === 2) mutate(raw); return raw; } }), before = h.state.content;
    await h.load(); h.choose(); await h.use(); assert.equal(h.reads.length, 2); assert.equal(h.state.content, before); assert.equal(h.applied.length, 0); assert.equal(h.approved(), true); assert.equal(h.el('Use').disabled, true);
  }
});

const ownerChanges = [h => { h.state.session = {}; }, h => { h.state.catalog = {}; }, h => { h.state.source = {}; }, h => { h.state.bindingId = id(41); }, h => { h.state.instanceId = id(10); },
  h => { h.state.backendId = 'org.viento.bevy-rust'; }, h => { h.state.language = 'rust'; }, h => { h.state.epoch++; }, h => { h.state.readEpoch++; }, h => { h.state.origin.scene.objectRevision = revision('record changed'); }];
test('each owner identity change revokes late loads and prevents detached controls from acquiring the new form', async t => {
  for (const change of ownerChanges) {
    const pending = deferred(), h = await helperFixture(t, { read: () => pending.promise }), before = h.state.content, old = h.el('Load');
    old.click(); await settle(); change(h); h.controller.refresh(); pending.resolve(directory()); await settle(); old.dispatch('click'); await settle();
    assert.equal(h.reads.length, 1); assert.equal(h.state.content, before); assert.equal(h.applied.length, 0); assert.equal(h.approved(), true); assert.equal(h.container.dataset.status, 'idle');
  }
});

test('each owner identity change also revokes an already selected track during fresh fill revalidation', async t => {
  for (const change of ownerChanges) {
    const pending = deferred(), h = await helperFixture(t, { read: (request, count) => count === 2 ? pending.promise : directory() }), before = h.state.content;
    await h.load(); h.choose(); const old = h.el('Use'); old.click(); await settle(); change(h); h.controller.refresh(); pending.resolve(directory()); await settle(); old.dispatch('click'); await settle();
    assert.equal(h.reads.length, 2); assert.equal(h.state.content, before); assert.equal(h.applied.length, 0); assert.equal(h.approved(), true); assert.equal(h.el('Track').value, '');
  }
});

test('silent JSON and selector changes cannot overwrite a concurrent edit or redirect a pending track fill', async t => {
  for (const change of [h => { h.state.content += ' '; }, h => { h.el('Track').value = id(5); }, h => { h.el('Parameter').value = 'other'; }]) {
    const pending = deferred(), h = await helperFixture(t, { read: (request, count) => count === 2 ? pending.promise : directory() }); await h.load(); h.choose(); h.el('Use').click(); await settle();
    change(h); const before = h.state.content; pending.resolve(directory()); await settle(); assert.equal(h.state.content, before); assert.equal(h.applied.length, 0); assert.equal(h.approved(), true);
  }
});

test('an observed pending phase, capability withdrawal or suspension permanently revokes a late response', async t => {
  for (const key of ['pending', 'available', 'current']) {
    const pending = deferred(), h = await helperFixture(t, { read: () => pending.promise }); h.el('Load').click(); await settle();
    const original = h.state[key]; h.state[key] = key === 'pending'; h.controller.refresh(); h.state[key] = original; h.controller.refresh(); pending.resolve(directory()); await settle();
    assert.equal(h.container.dataset.status, key === 'pending' ? 'error' : 'idle'); assert.equal(h.el('Use').disabled, true); assert.equal(h.applied.length, 0); assert.equal(h.approved(), true);
  }
});

test('failed load or revalidation clears unusable choices and allows retry without editing raw parameters or review', async t => {
  for (const failedRead of [1, 2]) {
    let fail = true; const h = await helperFixture(t, { read: (request, count) => { if (fail && count === failedRead) throw Error('offline'); return directory(); } }), before = h.state.content;
    await h.load(); if (failedRead === 2) { h.choose(); await h.use(); } assert.equal(h.el('Use').disabled, true); assert.equal(h.state.content, before); assert.equal(h.approved(), true);
    fail = false; await h.load(); h.choose(); await h.use(); assert.equal(JSON.parse(h.state.content).arbitrary, id(4)); assert.equal(h.applied.length, 1);
  }
});

test('forged resource, track or parameter choices cannot issue a fill request', async t => {
  for (const [suffix, value] of [['Track', id(7)], ['Track', id(99)], ['Parameter', 'amount'], ['Parameter', 'inferred_track_id']]) {
    const h = await helperFixture(t), before = h.state.content; await h.load(); h.choose(); h.el(suffix).value = value; h.el('Use').dispatch('click'); await settle();
    assert.equal(h.reads.length, 1); assert.equal(h.state.content, before); assert.equal(h.approved(), true); assert.equal(h.applied.length, 0);
  }
});

test('all three display languages retain explicit choices, focused controls and unmodified parameters', async t => {
  const h = await helperFixture(t), before = h.state.content; await h.load(); h.choose(); const focused = h.el('Parameter'); focused.focus();
  for (const language of ['en', 'ja', 'zh']) { h.language(language); assert.equal(h.el('Track').value, id(4)); assert.equal(h.el('Parameter').value, 'arbitrary'); assert.equal(h.document.activeElement, focused); assert.equal(h.state.content, before); }
  assert.equal(h.approved(), true); assert.equal(h.reads.length, 1);
});

test('duplicate reads and reset or disposed controls cannot issue another read or deliver a late mutation', async t => {
  for (const action of ['reset', 'dispose']) {
    const pending = deferred(), h = await helperFixture(t, { read: () => pending.promise }), old = h.el('Load'); old.click(); old.dispatch('click'); await settle(); assert.equal(h.reads.length, 1);
    h.controller[action](); h.controller.refresh(); pending.resolve(directory()); await settle(); old.dispatch('click'); await settle(); assert.equal(h.reads.length, 1); assert.equal(h.applied.length, 0); assert.equal(h.approved(), true);
  }
});

test('a malformed directory never evaluates author getters and leaves manual editing and approval intact', async t => {
  let calls = 0; const h = await helperFixture(t, { read: () => { const raw = directory(); Object.defineProperty(raw.manifest, 'content', { enumerable: true, get() { calls++; return '{}'; } }); return raw; } }), before = h.state.content;
  await h.load(); assert.equal(calls, 0); assert.equal(h.container.dataset.status, 'error'); assert.equal(h.state.content, before); assert.equal(h.approved(), true); assert.equal(h.applied.length, 0);
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
    sources: [{ objectId: id(9), sourcePath: 'documents/scripts/retry.txt', sourceRevision: revision('script'), name: 'Retry' }, { objectId: id(12), sourcePath: 'documents/scripts/other.txt', sourceRevision: revision('other script'), name: 'Other' }] };
}
function receipt(request, data) {
  const afterSourceRevision = revision(request.content), input = copy(request); delete input.mode;
  const relations = [...new Set([request.sceneObjectId, ...JSON.parse(request.content).bindings.map(row => row.implementation.sourceObjectId)])].sort().map(targetId => ({ kind: 'references', targetId, slot: '' }));
  return { status: request.mode === 'apply' ? 'applied' : 'preview', worldId: request.worldId, baseRevision: request.baseRevision, revision: revision('after'), proposal: { commands: [{ id: 'behavior.create', input }] },
    object: { id: request.objectId, documentRefs: [{ sourcePath: request.sourcePath, sourceRevision: afterSourceRevision }] },
    changes: [{ kind: 'behavior.create', objectId: request.objectId, sourcePath: request.sourcePath, beforeText: null, beforeSourceRevision: null, afterText: request.content, afterSourceRevision,
      recordPath: `metadata/documents/${request.objectId}.json`, record: { id: request.objectId, sourcePath: request.sourcePath, documentType: request.documentType, relations } },
    { kind: 'relation.add', objectId: request.sceneObjectId, sourcePath: data.scene.sourcePath, targetObjectId: request.objectId, targetSourcePath: request.sourcePath, relation: { kind: 'behavior', targetId: request.objectId, slot: '' } }] };
}
async function parentFixture(t, options = {}) {
  let serial = 50; const data = creationCatalog(), reads = [], commands = [], intents = [], context = { editable: true, dirty: false, creating: false, busy: false, visible: true, session: 'build:1', sceneId: id(1), sourceToken: 'scene:1', audioTracksAvailable: options.available ?? true };
  const h = await dialogHarness('app-scene-behavior-create', { SCENE_BEHAVIOR_LIMITS,
    createSceneBehaviorCreationDraft: input => createSceneBehaviorCreationDraft(transport(input)), applySceneBehaviorCreateParameterSources: input => applySceneBehaviorCreateParameterSources(transport(input)),
    crypto: { subtle: webcrypto.subtle, randomUUID: () => id(++serial) }, t: (key, ...args) => key.replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')) });
  const controller = h.runtime.setupSceneBehaviorCreate({ getContext: () => context, inspect: async () => copy(data), command: async request => { commands.push(copy(request)); return receipt(request, data); },
    requestScriptCreation: async intent => { intents.push(intent); return false; }, ...(options.noPort ? {} : { getAudioTracks: async request => { reads.push(copy(request)); return options.read ? options.read(request, reads.length) : directory(); } }) });
  controller.setAvailable(true, ['behavior.create']); t.after(() => controller.dispose());
  const el = suffix => h.element('sceneBehaviorCreate' + suffix), audio = suffix => h.element('sceneBehaviorCreateAudio' + suffix);
  const set = (suffix, value, event = 'input') => { el(suffix).value = value; el(suffix).dispatch(event); }, select = (suffix, value) => { audio(suffix).value = value; audio(suffix).dispatch('change'); };
  assert.equal(controller.open(context.sceneId), true); await settle();
  return { ...h, controller, context, data, el, audio, set, select, reads, commands, intents,
    async click(suffix) { el(suffix).click(); await settle(); }, async load() { audio('Load').click(); await settle(); },
    choose(value = id(4)) { select('Track', value); select('Parameter', 'arbitrary'); }, async use() { audio('Use').click(); await settle(); } };
}

test('the actual creation dialog revokes an approved transaction only after an effective track fill and saves its newly reviewed source', async t => {
  const h = await parentFixture(t); h.set('Parameters', '{ "arbitrary": "old", "amount":1e2,"zero":-0 }'); await h.click('Check'); assert.equal(h.el('Save').disabled, false); const first = h.commands[0].content;
  await h.load(); h.choose(); assert.equal(h.el('Save').disabled, false); await h.use(); assert.equal(h.el('Save').disabled, true);
  assert.equal(h.el('Parameters').value, '{ "arbitrary": "' + id(4) + '", "amount":1e2,"zero":-0 }'); await h.click('Check'); assert.notEqual(h.commands[1].content, first);
  await h.click('Save'); assert.equal(h.commands[2].content, h.commands[1].content); assert.equal(h.reads.length, 2);
});

test('same-value insertion and failed audio reads preserve the actual parent review and its exact source', async t => {
  for (const failure of [false, true]) {
    const h = await parentFixture(t, { read: (request, count) => { if (failure && count === 2) throw Error('offline'); return directory(); } });
    h.set('Parameters', '{"arbitrary":' + JSON.stringify(id(4)).replace('"0', '"\\u0030') + '}'); await h.click('Check'); const reviewed = h.el('SourceText').textContent, raw = h.el('Parameters').value;
    await h.load(); h.choose(); await h.use(); assert.equal(h.el('Save').disabled, false); assert.equal(h.el('SourceText').textContent, reviewed); assert.equal(h.el('Parameters').value, raw); assert.equal(h.commands.length, 1);
  }
});

test('actual parent review and script suspend/resume revoke a pending audio read without losing raw JSON', async t => {
  const pending = deferred(), h = await parentFixture(t, { read: () => pending.promise }); h.set('Parameters', '{"arbitrary":"old"}'); h.audio('Load').click(); await settle();
  await h.click('Check'); assert.equal(h.el('Save').disabled, false); pending.resolve(directory()); await settle(); assert.equal(h.audio('Status').dataset.status, 'error'); assert.equal(h.audio('Use').disabled, true);
  const old = h.audio('Load'); await h.click('NewScript'); const ticket = h.controller.suspendForScript(h.intents.at(-1)); assert.ok(ticket); await settle();
  h.context.session = 'build:returned'; h.context.sourceToken = 'scene:returned'; assert.equal(await h.controller.resumeFromScript(ticket), true); old.dispatch('click'); await settle();
  assert.equal(h.el('Parameters').value, '{"arbitrary":"old"}'); assert.equal(h.audio('Track').value, ''); assert.equal(h.audio('Parameter').value, ''); assert.equal(h.reads.length, 1);
});

test('the actual creation dialog keeps manual parameter review when the optional audio port or exact capability is absent', async t => {
  for (const options of [{ noPort: true }, { available: false }, { available: 1 }]) {
    const h = await parentFixture(t, options); assert.equal(h.el('Audio').hidden, true); h.set('Parameters', '{"manual":"keep"}'); await h.click('Check');
    assert.equal(h.commands.length, 1); assert.equal(h.el('Save').disabled, false); assert.equal(h.reads.length, 0);
  }
});

test('actual parent binding, source and instance switches revoke late audio fills and preserve each binding fragment', async t => {
  for (const switchField of ['BindingList', 'Source', 'Instance', 'Profile']) {
    const pending = deferred(), h = await parentFixture(t, { read: (request, count) => count === 2 ? pending.promise : directory() }); h.set('Parameters', '{"arbitrary":"first"}');
    await h.click('AddBinding'); const second = h.el('BindingList').value; h.set('Parameters', '{"arbitrary":"second"}'); await h.load(); h.choose(); h.audio('Use').click(); await settle();
    if (switchField === 'BindingList') h.set('BindingList', h.el('BindingList').children[0].value, 'change');
    else h.set(switchField, switchField === 'Source' ? id(12) : switchField === 'Instance' ? id(8) : 'bevy-rust', 'change');
    const before = h.el('Parameters').value; pending.resolve(directory()); await settle(); assert.equal(h.el('Parameters').value, before); assert.equal(h.commands.length, 0);
    h.set('BindingList', second, 'change'); assert.equal(h.el('Parameters').value, '{"arbitrary":"second"}');
  }
});

test('every fixed audio-helper message has English and Japanese translations', async () => {
  const text = await fs.readFile(new URL('../../web/modules/app-scene-behavior-create-audio.js', import.meta.url), 'utf8');
  const keys = [...text.matchAll(/(?:translate\(|message\s*=\s*|hint\s*=\s*|changedOriginMessage\s*=\s*)'([^']+)'/g)].map(match => match[1]).filter(key => /[\u4e00-\u9fff]/.test(key));
  for (const key of keys) { assert.ok(en[key], 'en: ' + key); assert.ok(ja[key], 'ja: ' + key); }
});

test('a growing UUID that exceeds the fragment source budget preserves approval, raw JSON and the valid audio directory', async t => {
  const fragment = length => JSON.stringify({ arbitrary: '', ...Object.fromEntries(Array.from({ length: 7 }, (_, index) => ['manual_' + index, 'x'.repeat(4096)])), padding: 'p'.repeat(length) });
  let low = 0, high = 4096; while (low < high) { const mid = Math.ceil((low + high) / 2); try { listSceneBehaviorCreateStringParameters(fragment(mid)); low = mid; } catch { high = mid - 1; } }
  const raw = fragment(low), h = await parentFixture(t); h.set('Parameters', raw); await h.click('Check'); assert.equal(h.el('Save').disabled, false);
  const reviewed = h.el('SourceText').textContent; await h.load(); h.choose(); await h.use(); assert.equal(h.el('Parameters').value, raw); assert.equal(h.el('SourceText').textContent, reviewed);
  assert.equal(h.el('Save').disabled, false); assert.equal(h.commands.length, 1); assert.match(h.audio('Status').textContent, /无法填入参数.*输入已保留/); assert.equal(h.audio('Status').dataset.status, 'ready'); assert.equal(h.audio('Use').disabled, false);
});

test('a two-binding reviewed source at 32768 bytes rejects aggregate overflow before editing and still saves the original approved source', async t => {
  const h = await parentFixture(t), first = h.el('BindingList').value;
  const fragment = length => JSON.stringify({ arbitrary: '', a: 'x'.repeat(4096), b: 'x'.repeat(4096), c: 'x'.repeat(4096), d: 'x'.repeat(length) });
  await h.click('AddBinding'); const second = h.el('BindingList').value; h.set('Parameters', fragment(3200)); h.set('BindingList', first, 'change'); h.set('Parameters', fragment(4068));
  await h.click('Check'); assert.equal(h.el('Save').disabled, false); const reviewed = h.el('SourceText').textContent, raw = h.el('Parameters').value;
  assert.equal(Buffer.byteLength(reviewed), 32768); await h.load(); h.choose(); await h.use(); assert.equal(h.el('Parameters').value, raw); assert.equal(h.el('SourceText').textContent, reviewed);
  assert.equal(h.el('Save').disabled, false); assert.equal(h.commands.length, 1); assert.match(h.audio('Status').textContent, /无法填入参数.*输入已保留/); assert.equal(h.audio('Use').disabled, false);
  h.set('BindingList', second, 'change'); assert.equal(h.el('Parameters').value, fragment(3200)); await h.click('Save'); assert.equal(h.commands.length, 2); assert.equal(h.commands[1].content, reviewed);
});

test('valid reviewed sibling bindings accept an effective track fill and retain all other raw parameter tokens', async t => {
  const h = await parentFixture(t), first = h.el('BindingList').value; h.set('Parameters', '{"arbitrary":"old","amount":1e2}'); await h.click('AddBinding'); const second = h.el('BindingList').value;
  h.set('Parameters', '{"sibling":"keep","zero":-0}'); h.set('BindingList', first, 'change'); await h.click('Check'); assert.equal(h.el('Save').disabled, false);
  await h.load(); h.choose(); await h.use(); assert.equal(h.el('Parameters').value, '{"arbitrary":"' + id(4) + '","amount":1e2}'); assert.equal(h.el('Save').disabled, true);
  await h.click('Check'); const candidate = h.commands[1].content; assert.match(candidate, /"amount":1e2/); assert.match(candidate, /"zero":-0/); h.set('BindingList', second, 'change');
  assert.equal(h.el('Parameters').value, '{"sibling":"keep","zero":-0}'); await h.click('Save'); assert.equal(h.commands[2].content, candidate);
});

test('unreviewed unfinished sibling parameters never block filling the selected valid fragment or get rewritten', async t => {
  const h = await parentFixture(t), first = h.el('BindingList').value; h.set('Parameters', '{"arbitrary":"old"}'); await h.click('AddBinding'); const second = h.el('BindingList').value;
  const unfinished = '{"amount":1e-'; h.set('Parameters', unfinished); h.set('BindingList', first, 'change'); await h.load(); h.choose(); await h.use();
  assert.equal(h.el('Parameters').value, '{"arbitrary":"' + id(4) + '"}'); assert.equal(h.commands.length, 0); h.set('BindingList', second, 'change'); assert.equal(h.el('Parameters').value, unfinished);
  await h.click('Check'); assert.equal(h.commands.length, 0); assert.equal(h.el('Parameters').value, unfinished);
});
