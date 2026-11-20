import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { dialogHarness, flushDialogs } from '/home/chiharukiryu/cdev/viento-studio/scripts/tests/dialog-harness.mjs';
import { setupSceneBehaviorCreateReferences } from '/home/chiharukiryu/cdev/viento-studio/web/modules/app-scene-behavior-create-references.js';
import { createSceneBehaviorCreationDraft } from '/home/chiharukiryu/cdev/viento-studio/engine/scene-behavior-create-plan.mjs';
import { applySceneBehaviorCreateParameterSources } from '/home/chiharukiryu/cdev/viento-studio/engine/scene-behavior-create-parameters.mjs';
import { listSceneBehaviorCreateStringParameters } from '/home/chiharukiryu/cdev/viento-studio/engine/scene-behavior-create-references.mjs';
import { SCENE_BEHAVIOR_LIMITS } from '/home/chiharukiryu/cdev/viento-studio/engine/scene-behaviors.mjs';
import en from '/home/chiharukiryu/cdev/viento-studio/web/i18n/en.js';
import ja from '/home/chiharukiryu/cdev/viento-studio/web/i18n/ja.js';

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


test('readonly-review: pending fill cannot cross an actual binding switch or revive its detached controls', async t => {
  const pending = deferred(), h = await parentFixture(t, { read: (request, count) => count === 2 ? pending.promise : directory(request.assemblyObjectId) });
  const first = h.el('BindingList').value, firstRaw = '{ "arbitrary": "first", "amount": 1e2 }', secondRaw = '{ "arbitrary": "second", "amount": -0 }';
  h.set('Parameters', firstRaw); await h.click('AddBinding'); const second = h.el('BindingList').value;
  h.set('Parameters', secondRaw); h.set('BindingList', first, 'change'); await h.click('Check'); const reviewed = h.el('SourceText').textContent;
  assert.equal(h.el('Save').disabled, false); await h.load(); h.choose(id(8)); const oldUse = h.ref('Use'); oldUse.click(); await settle();
  h.set('BindingList', second, 'change'); assert.equal(h.el('Parameters').value, secondRaw); assert.equal(h.el('Save').disabled, false);
  h.set('BindingList', first, 'change'); pending.resolve(directory()); await settle(); oldUse.dispatch('click'); await settle();
  assert.equal(h.el('Parameters').value, firstRaw); assert.equal(h.el('Save').disabled, false); assert.equal(h.el('SourceText').textContent, reviewed);
  h.set('BindingList', second, 'change'); assert.equal(h.el('Parameters').value, secondRaw); assert.equal(h.reads.length, 2); assert.equal(h.commands.length, 1);
});
test('readonly-review: closing and reopening the real creator cannot revive a pending fill or detached owner', async t => {
  const pending = deferred(), h = await parentFixture(t, { read: (request, count) => count === 2 ? pending.promise : directory(request.assemblyObjectId) });
  h.set('Parameters', '{ "arbitrary": "old" }'); await h.load(); h.choose(id(8)); const oldUse = h.ref('Use'); oldUse.click(); await settle();
  await h.click('Cancel'); assert.equal(h.el('Dialog').open, false); assert.equal(h.controller.open(h.context.sceneId), true); await settle();
  h.set('Parameters', '{ "arbitrary": "new owner" }'); await h.click('Check'); const reviewed = h.el('SourceText').textContent;
  pending.resolve(directory()); await settle(); oldUse.dispatch('click'); await settle();
  assert.equal(h.el('Parameters').value, '{ "arbitrary": "new owner" }'); assert.equal(h.el('Save').disabled, false); assert.equal(h.el('SourceText').textContent, reviewed);
  assert.equal(h.commands.length, 1); assert.equal(h.reads.length, 2);
});
test('readonly-review: observed profile switch away and back permanently revokes an in-flight fill', async t => {
  const pending = deferred(), h = await parentFixture(t, { read: (request, count) => count === 2 ? pending.promise : directory(request.assemblyObjectId) });
  const raw = '{ "arbitrary": "old", "zero": -0 }'; h.set('Parameters', raw); await h.load(); h.choose(id(8)); const oldUse = h.ref('Use'); oldUse.click(); await settle();
  h.set('Profile', 'bevy-rust', 'change'); h.set('Profile', 'godot-gdscript', 'change'); await h.click('Check'); const reviewed = h.el('SourceText').textContent;
  pending.resolve(directory()); await settle(); oldUse.dispatch('click'); await settle();
  assert.equal(h.el('Parameters').value, raw); assert.equal(h.el('Save').disabled, false); assert.equal(h.el('SourceText').textContent, reviewed); assert.equal(h.reads.length, 2); assert.equal(h.commands.length, 1);
});
test('readonly-review: observe final combined budget after a small valid String replacement', async t => {
  const h = await parentFixture(t), first = h.el('BindingList').value;
  const fragment = length => JSON.stringify({ arbitrary: '', a: 'x'.repeat(4096), b: 'x'.repeat(4096), c: 'x'.repeat(4096), d: 'x'.repeat(length) });
  await h.click('AddBinding'); const second = h.el('BindingList').value; h.set('Parameters', fragment(3000)); h.set('BindingList', first, 'change');
  let low = 0, high = 4096;
  while (low < high) { const mid = Math.ceil((low + high) / 2); h.set('Parameters', fragment(mid)); await h.click('Check'); if (h.el('Save').disabled) high = mid - 1; else low = mid; }
  h.set('Parameters', fragment(low)); await h.click('Check'); assert.equal(h.el('Save').disabled, false); const before = h.el('Parameters').value, reviewed = h.el('SourceText').textContent, beforeCommands = h.commands.length;
  await h.load(); h.choose(id(8)); await h.use();
  const after = h.el('Parameters').value, disabled = h.el('Save').disabled; await h.click('Check');
  const observation = { first, second, lastValidPadding: low, originalManifestBytes: Buffer.byteLength(reviewed), changed: after !== before, reviewRevoked: disabled, nextReviewRejectedBeforeCommand: h.commands.length === beforeCommands, status: h.el('Status').textContent };
  await fs.writeFile('/tmp/viento-create-references-combined-budget-observation.json', JSON.stringify(observation, null, 2)+'\n');
  assert.equal(h.commands.length, beforeCommands, 'ordinary final review must reject the aggregate overflow before a command');
});
