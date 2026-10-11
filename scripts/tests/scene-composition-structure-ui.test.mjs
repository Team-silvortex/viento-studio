import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { createSceneCompositionStructureDraft, prepareSceneCompositionStructureApply } from '../../engine/scene-composition-structure.mjs';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { scene2DModelToPlan } from '../../engine/build-plan.mjs';
import { createSceneStructure } from '../../engine/scene-structure.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const golden = JSON.parse(await fs.readFile(new URL('./fixtures/scene-model/legacy-plan-v1.json', import.meta.url), 'utf8'));
const example = JSON.parse(await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8'));
const { ids } = golden, copy = value => JSON.parse(JSON.stringify(value));
const hash = text => createHash('sha256').update(text).digest('hex'), revision = text => `sha256:${hash(text)}`;
const decode = value => JSON.parse(value.replace(/^\uFEFF/, ''));
async function fixture({ dirty = false } = {}) {
  const observed = copy(golden.observed), recipe = copy(example);
  observed.source.workspace.version = 3; observed.source.definition = { documentTypes: [{ id: 'document', label: 'Document' }] };
  recipe.fragments[0].actors.forEach(actor => { actor.objectId = ids.core; });
  recipe.placements[0].overrides = [{ actorKey: 'companion', values: { color: '#123456', speed: 33 } }];
  recipe.placements[1].overrides.push({ actorKey: 'companion', values: { position: [50, 60], imageResourceId: ids.image } });
  const explicit = { objectId: ids.core, position: [10, 20], size: [30, 40], color: '#ffffff', speed: 0, controls: 'none' };
  recipe.fragments.push({ fragmentId: 'unused', groups: [], actors: [{ key: 'first', ...explicit }, { key: 'second', ...explicit }] },
    { fragmentId: 'single', groups: [], actors: [{ key: 'sole', ...explicit }] });
  const document = observed.source.documents.find(item => item.record.id === ids.scene);
  document.record.relations = []; document.record.assetBindings = [];
  document.content = '\uFEFF' + JSON.stringify(recipe, null, '\t').replaceAll('\n', '\r\n') + '\r\n \t'; document.sourceRevision = revision(document.content);
  for (const item of observed.source.documents) item.descriptor = { ...item.record };
  observed.projection = await createWorldProjection(observed.source, { digest: hash });
  const result = await resolveSceneCompositionPreview(observed, ids.scene, { digest: hash });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const plan = scene2DModelToPlan(result.model), baseSourceRevision = dirty ? revision('saved baseline') : document.sourceRevision;
  const model = { ok: true, format: 'viento-scene-preview', schemaVersion: 2, scene: plan.scene, actors: plan.actors,
    composition: result.composition, sourceLocations: result.model.sourceLocations, sceneStructure: createSceneStructure(result.model), resources: [], diagnostics: [],
    ...(dirty ? { draft: { baseSourceRevision, sourceRevision: document.sourceRevision } } : {}) };
  return { model, recipe, source: { sourcePath: document.sourcePath, content: document.content, baseSourceRevision }, actorId: model.actors[2].instanceId,
    objects: [{ id: ids.core, name: 'Author definition', sourcePath: 'documents/oc.md' },
      { id: ids.first, name: 'Game projection', sourcePath: 'documents/projections/p1.json', projectionDefaults: { size: [64, 64], color: '#abcdef', speed: 220, controls: 'arrows', imageResourceId: ids.image } }],
    images: [{ id: ids.image, name: 'Traveler portrait', path: 'portraits/traveler.svg' }] };
}
async function settle(h) {
  for (let index = 0; index < 150; index++) { await flushDialogs(); if (!h.el('Dialog').open || h.el('Dialog').getAttribute('aria-busy') !== 'true') return;
    await new Promise(resolve => setTimeout(resolve, 1)); }
  assert.fail('Structure form remained busy');
}
async function harness(t, options = {}) {
  const value = await fixture(options), validations = [], proposals = [], applied = [], guards = [], alerts = [];
  let memory = value.source.content, live = true, confirm = true, language = 'zh-CN', languageListener = () => {}, generated = 0;
  const context = { editable: true, dirty: Boolean(options.dirty), creating: false, busy: false, compositionSourceWritable: true,
    canEditCompositionStructure: true, sceneDraftPath: value.source.sourcePath, sceneDraftToken: 1 };
  const translate = (key, ...args) => String(({ en, ja }[language] || {})[key] || key).replace(/\{(\d+)\}/g, (_, index) => args[index] ?? '');
  // The DOM controller runs in a VM; copy only at its JSON DTO boundary so the
  // real helper keeps its strict same-realm plain-data/accessor rejection.
  const factory = async (...args) => { const draft = await createSceneCompositionStructureDraft(args[0], args[1], args[2]);
    return { fragments: draft.fragments, propose(input) { return draft.propose(copy(input)); } }; };
  const h = await dialogHarness('app-scene-composition-structure', {
    crypto: { subtle: webcrypto.subtle, randomUUID: () => { generated++; return options.uuid ? options.uuid(generated) : webcrypto.randomUUID(); } }, queueMicrotask,
    createSceneCompositionStructureDraft: options.factory || factory,
    ...(options.supported === false ? { supportsStudioCoreCompositionStructure: () => false } : {}),
    t: translate, translatePage(root) { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange(callback) { languageListener = callback; return () => { languageListener = () => {}; }; },
    requestWorldCommand() { assert.fail('Structure form must not query author resources'); }, fetchJsonApiRequest() { assert.fail('Parent owns candidate dependency checks'); },
  });
  h.runtime.window.confirm = () => confirm; h.runtime.window.alert = message => alerts.push(message);
  const controller = h.runtime.setupSceneCompositionStructure({ getContext: () => context,
    validateDraft: async (proposal, guard) => { validations.push(copy(proposal)); guards.push(guard); return options.validate ? options.validate(proposal, guard) : { ok: true }; },
    applySourceDraft: async (proposal, guard) => { proposals.push(copy(proposal)); if (options.apply) return options.apply(proposal, guard, context);
      const prepared = await prepareSceneCompositionStructureApply({ ...value.source, content: memory }, copy(proposal), { digest: hash });
      if (!guard.isCurrent()) throw Object.assign(new Error('Owner changed'), { errorCode: 'scene_composition_structure_conflict' });
      memory = prepared.afterContent; context.sceneDraftToken++; context.dirty = true; return { applied: true }; },
    sourceApplied: (result, proposal) => applied.push({ result, proposal: copy(proposal) }),
  });
  const el = suffix => h.element(`sceneCompositionStructure${suffix}`), open = (extra = {}) => controller.open({ ...value, isCurrent: () => live, ...extra });
  t.after(async () => { controller.destroy(); await flushDialogs(); });
  if (!options.skipOpen) assert.equal(await open(), true);
  const input = (suffix, raw) => { if (suffix === 'Inherited') el(suffix).checked = Boolean(raw); else el(suffix).value = String(raw);
    el(suffix).dispatch(['Fragment', 'Actor', 'Object', 'Group', 'Controls', 'Image', 'Inherited'].includes(suffix) ? 'change' : 'input'); };
  const check = async () => { el('Check').click(); await settle({ el }); }, add = () => el('Add').click();
  return { ...h, el, value, context, controller, validations, proposals, applied, guards, alerts, open, input, check, add,
    memory: () => memory, setMemory: value => { memory = value; }, setLive: value => { live = value; }, setConfirm: value => { confirm = value; },
    generated: () => generated, setLanguage(value) { language = value; languageListener(); } };
}

test('whole-recipe entry selects the current fragment but no operation or identity until explicitly requested', async t => {
  const h = await harness(t), before = copy(h.value);
  assert.equal(h.el('Fragment').value, 'party'); assert.equal(h.el('Fragment').children.length, 3); assert.equal(h.el('Fields').hidden, true);
  assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.generated(), 0);
  assert.equal(h.el('Targets').children.length, 0); assert.equal(h.memory(), before.source.content); assert.deepEqual(h.value, before);
});

test('explicit actor addition binds stable identities to every placement and only applies an approved source draft', async t => {
  const h = await harness(t, { dirty: true }), before = copy(h.value); h.add(); const rows = h.el('Targets').children.map(row => row.dataset.instanceId);
  assert.equal(rows.length, 2); assert.equal(new Set(rows).size, 2); assert.equal(h.generated(), 2);
  assert.equal(h.el('X').value, '200'); assert.equal(h.el('Y').value, '220'); assert.equal(h.el('Inherited').checked, false);
  h.input('Key', 'new_actor'); h.input('Group', 'companions'); await h.check();
  const candidate = h.validations[0]; assert.deepEqual(candidate.edit.actor, { key: 'new_actor', objectId: ids.core, position: [200, 220], groupKey: 'companions', size: [80, 80], color: '#ffffff', speed: 160, controls: 'arrows' });
  assert.deepEqual(candidate.edit.instances.map(item => item.instanceId), rows); assert.deepEqual(candidate.targets.map(item => item.instanceId), rows);
  assert.ok(candidate.targets.every(item => item.overrides.length === 0)); assert.match(h.el('Targets').textContent, /560, 300/);
  assert.equal(h.el('Source').textContent, candidate.afterContent); assert.equal(h.el('Review').open, true); assert.equal(h.el('Apply').disabled, false);
  const next = decode(candidate.afterContent); assert.equal(next.fragments[0].actors.length, 3); assert.equal(next.placements[0].actorIds.new_actor, rows[0]);
  assert.deepEqual(next.fragments[0].groups, before.recipe.fragments[0].groups); assert.deepEqual(next.placements[1].overrides, before.recipe.placements[1].overrides);
  assert.ok(candidate.afterContent.startsWith('\uFEFF{\r\n')); assert.ok(candidate.afterContent.endsWith('\r\n \t')); assert.equal(h.memory(), before.source.content);
  h.el('Apply').click(); await settle(h); assert.equal(h.el('Dialog').open, false); assert.equal(h.memory(), candidate.afterContent);
  assert.equal(h.context.dirty, true); assert.equal(h.applied.length, 1); assert.deepEqual(h.applied[0].proposal, candidate); assert.deepEqual(h.value, before);
});

test('field changes and repeated checks never regenerate pending addition identities', async t => {
  const h = await harness(t); h.add(); const first = h.el('Targets').children.map(row => row.dataset.instanceId); await h.check();
  h.input('X', 123); await h.check(); await h.check();
  assert.equal(h.generated(), 2); assert.ok(h.validations.every(proposal => JSON.stringify(proposal.targets.map(item => item.instanceId)) === JSON.stringify(first)));
  assert.equal(h.el('Targets').children[0].dataset.instanceId, first[0]); assert.equal(h.el('Apply').disabled, false);
});

test('projected definitions default to inheritance while explicit raw fields survive switching inheritance off', async t => {
  const h = await harness(t); h.add(); h.input('Width', 92); h.input('Object', ids.first);
  assert.equal(h.el('Inherited').checked, true); assert.equal(h.el('Width').disabled, true); assert.equal(h.el('Width').value, '92');
  await h.check(); assert.deepEqual(h.validations[0].edit.actor, { key: 'actor1', objectId: ids.first, position: [200, 220], useProjectionDefaults: true });
  h.input('Inherited', false); await h.check(); assert.deepEqual(h.validations[1].edit.actor.size, [92, 80]);
  assert.equal(Object.hasOwn(h.validations[1].edit.actor, 'useProjectionDefaults'), false); assert.equal(h.el('Width').disabled, false);
});

test('image omission, explicit projection suppression and a concrete resource remain different declarations', async t => {
  const h = await harness(t); h.add(); h.input('Object', ids.first); await h.check(); assert.equal(Object.hasOwn(h.validations[0].edit.actor, 'imageResourceId'), false);
  h.input('Image', '__none__'); await h.check(); assert.equal(h.validations[1].edit.actor.imageResourceId, null);
  h.input('Image', ids.image); await h.check(); assert.equal(h.validations[2].edit.actor.imageResourceId, ids.image);
  h.input('Object', ids.core); h.input('Image', '__none__'); await h.check(); assert.equal(h.validations.length, 3); assert.equal(h.el('Apply').disabled, true);
  assert.equal(h.el('Image').children.find(item => item.value === '__none__').disabled, true);
});

test('removing an actor lists every removed identity and override mask while preserving groups and other declarations', async t => {
  const h = await harness(t); h.input('Actor', 'companion'); h.el('Remove').click(); await h.check();
  const candidate = h.validations[0]; assert.deepEqual(candidate.edit, { action: 'remove', fragmentId: 'party', actorKey: 'companion' });
  assert.deepEqual(candidate.targets.map(item => item.overrides), [['color', 'speed'], ['position', 'imageResourceId']]);
  assert.deepEqual(h.el('Targets').children.map(row => row.dataset.instanceId), h.value.recipe.placements.map(item => item.actorIds.companion));
  assert.match(h.el('Targets').textContent, /同时清理局部覆盖/); const next = decode(candidate.afterContent);
  assert.equal(next.fragments[0].actors.length, 1); assert.ok(next.placements.every(item => !Object.hasOwn(item.actorIds, 'companion')));
  assert.deepEqual(next.placements[0].overrides, []); assert.deepEqual(next.placements[1].overrides, h.value.recipe.placements[1].overrides.filter(item => item.actorKey !== 'companion'));
  assert.deepEqual(next.fragments[0].groups, h.value.recipe.fragments[0].groups); assert.deepEqual(next.placements.map(item => item.groupIds), h.value.recipe.placements.map(item => item.groupIds));
  h.el('Apply').click(); await settle(h); assert.equal(h.memory(), candidate.afterContent);
});

test('unused fragments support source-only additions with an empty exact instance inventory', async t => {
  const h = await harness(t); h.input('Fragment', 'unused'); h.add(); await h.check();
  assert.equal(h.generated(), 0); assert.deepEqual(h.validations[0].edit.instances, []); assert.deepEqual(h.validations[0].targets, []);
  assert.match(h.el('Impact').textContent, /尚未放置.*只修改共享声明/); assert.deepEqual(decode(h.validations[0].afterContent).placements, h.value.recipe.placements);
  assert.equal(h.el('Apply').disabled, false);
});

test('unused fragments can remove declarations while the final actor is protected even against forged clicks', async t => {
  const h = await harness(t); h.input('Fragment', 'unused'); h.el('Remove').click(); await h.check();
  assert.deepEqual(h.validations[0].targets, []); assert.equal(decode(h.validations[0].afterContent).fragments[1].actors.length, 1);
  h.input('Fragment', 'single'); assert.equal(h.el('Remove').disabled, true); assert.match(h.el('RemoveHint').textContent, /至少一个演员/);
  h.el('Remove').dispatch('click'); h.el('Check').dispatch('click'); await settle(h); assert.equal(h.validations.length, 1); assert.equal(h.el('Dialog').dataset.dirty, 'false');
});

test('changing fragments can reject discard and retain the complete raw operation and identity map', async t => {
  const h = await harness(t); h.add(); h.input('X', ''); const first = h.el('Targets').children.map(row => row.dataset.instanceId);
  h.setConfirm(false); h.input('Fragment', 'unused'); assert.equal(h.el('Fragment').value, 'party'); assert.equal(h.el('X').value, '');
  assert.deepEqual(h.el('Targets').children.map(row => row.dataset.instanceId), first); assert.equal(h.generated(), 2);
  h.setConfirm(true); h.input('Fragment', 'unused'); assert.equal(h.el('Fields').hidden, true); assert.equal(h.el('Check').disabled, true); assert.equal(h.generated(), 2);
});

test('duplicate actor keys and incomplete or out-of-range numeric fields fail before dependency validation without losing input', async t => {
  const h = await harness(t); h.add(); h.input('Key', 'leader'); await h.check(); assert.equal(h.validations.length, 0);
  h.input('Key', 'candidate'); for (const [suffix, raw] of [['X', ''], ['X', '100001'], ['Width', '0'], ['Speed', '-1']]) {
    const saved = h.el(suffix).value; h.input(suffix, raw); await h.check(); assert.equal(h.validations.length, 0); assert.equal(h.el(suffix).value, raw); h.input(suffix, suffix === 'X' ? '200' : saved);
  }
  assert.equal(h.generated(), 2); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
});

test('identity collision is rejected by the real core and never silently repaired by regenerating UUIDs', async t => {
  const h = await harness(t, { uuid: () => example.placements[0].actorIds.leader }); h.add(); await h.check();
  assert.equal(h.generated(), 2); assert.equal(h.validations.length, 0); assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Message').textContent, /修改有误/);
});

test('forged definition, group and resource selections cannot receive approval', async t => {
  const h = await harness(t); h.add(); h.input('Object', '99999999-9999-4999-8999-999999999999'); await h.check(); assert.equal(h.validations.length, 0);
  h.input('Object', ids.core); h.input('Group', 'unknown'); await h.check(); assert.equal(h.validations.length, 0);
  h.input('Group', ''); h.input('Image', 'bad-resource'); await h.check(); assert.equal(h.validations.length, 0); assert.equal(h.el('Apply').disabled, true);
});

test('ordinary cancel and Escape discard no author data and rejected cancellation retains the operation', async t => {
  const h = await harness(t); h.add(); await h.check(); h.setConfirm(false); h.el('Cancel').click(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, false);
  h.setConfirm(true); h.el('Dialog').dispatch('cancel'); await flushDialogs(); assert.equal(h.el('Dialog').open, false); assert.equal(h.memory(), h.value.source.content);
  assert.equal(h.proposals.length, 0); assert.equal(h.applied.length, 0);
});

test('pending candidate checks lock every operation and silent raw changes cannot approve their late result', async t => {
  const pending = deferred(), h = await harness(t, { validate: () => pending.promise }); h.add(); h.el('Check').click(); await flushDialogs();
  for (const suffix of ['Fragment', 'Actor', 'Add', 'Remove', 'Key', 'Object', 'Group', 'X', 'Y', 'Inherited', 'Width', 'Height', 'Color', 'Speed', 'Controls', 'Image', 'Check', 'Apply', 'Cancel', 'Close']) assert.equal(h.el(suffix).disabled, true, suffix);
  h.el('X').value = '299'; pending.resolve({ ok: true }); await settle(h); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('X').value, '299'); assert.equal(h.proposals.length, 0);
});

test('silent changes after approval invalidate application even without an input event or refresh', async t => {
  const h = await harness(t); h.add(); await h.check(); h.el('Key').value = 'quiet_change'; h.el('Apply').dispatch('click'); await settle(h);
  assert.equal(h.proposals.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.generated(), 2);
});

test('validation callbacks receive detached proposals and cannot mutate the approved identity map or source', async t => {
  const h = await harness(t, { validate(proposal) { proposal.targets[0].instanceId = ids.scene; proposal.afterContent = '{}'; return { ok: true }; } });
  h.add(); await h.check(); h.el('Apply').click(); await settle(h); assert.equal(h.applied.length, 1); assert.notEqual(h.proposals[0].targets[0].instanceId, ids.scene);
  assert.equal(decode(h.memory()).fragments[0].actors.length, 3);
});

test('stale source ownership after checking prevents all source application and leaves the candidate visible', async t => {
  const h = await harness(t); h.add(); await h.check(); h.context.sceneDraftToken++; h.controller.refresh(); h.el('Apply').dispatch('click'); await settle(h);
  assert.equal(h.proposals.length, 0); assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Message').textContent, /原文或预览已变化/); assert.equal(h.memory(), h.value.source.content);
});

test('external source edits are preserved when an otherwise approved structure patch conflicts at apply', async t => {
  const h = await harness(t); h.add(); await h.check(); const external = h.value.source.content + '\n'; h.setMemory(external); h.el('Apply').click(); await settle(h);
  assert.equal(h.applied.length, 0); assert.equal(h.el('Dialog').open, true); assert.equal(h.memory(), external); assert.match(h.el('Message').textContent, /原文或预览已变化/);
});

test('late open success and rejection after owner loss never open a form or show stale failures', async t => {
  for (const reject of [false, true]) { const wait = deferred(), h = await harness(t, { skipOpen: true, factory: () => wait.promise }); const opening = h.open(); h.setLive(false);
    if (reject) wait.reject(new Error('stale failure')); else wait.resolve({ fragments: [] });
    assert.equal(await opening, false); assert.equal(h.el('Dialog').open, false); assert.deepEqual(h.alerts, []); }
});

test('late validation after native closure cannot approve or apply a structure change', async t => {
  const wait = deferred(), h = await harness(t, { validate: () => wait.promise }); h.add(); h.el('Check').click(); await flushDialogs(); h.el('Dialog').close(); await flushDialogs();
  wait.resolve({ ok: true }); await flushDialogs(); assert.equal(h.el('Dialog').open, false); assert.equal(h.proposals.length, 0); assert.equal(h.el('Dialog').dataset.dirty, 'false');
});

test('successful owned apply may advance the token, but a detached apply completion cannot notify a new session', async t => {
  const wait = deferred(), h = await harness(t, { apply: () => wait.promise }); h.add(); await h.check(); h.el('Apply').click(); await flushDialogs();
  h.el('Dialog').close(); await flushDialogs(); wait.resolve({ applied: true }); await flushDialogs(); assert.equal(h.applied.length, 0); assert.equal(h.el('Dialog').open, false);
});

test('unsupported or ineligible contexts never create an author structure draft', async t => {
  const h = await harness(t, { skipOpen: true, factory() { assert.fail('Ineligible factory'); } });
  for (const change of [{ canEditCompositionStructure: false }, { compositionSourceWritable: false }, { editable: false }, { creating: true }, { busy: true }, { sceneDraftPath: 'other.json' }]) {
    const saved = { ...h.context }; Object.assign(h.context, change); assert.equal(await h.open(), false); Object.assign(h.context, saved); }
  const other = await harness(t, { skipOpen: true, supported: false, factory() { assert.fail('Unsupported factory'); } }); assert.equal(await other.open(), false);
});

test('live language changes translate choices without resetting authored values, selected group, approval or UUIDs', async t => {
  const h = await harness(t); h.add(); h.input('Group', 'companions'); await h.check(); const stable = h.validations[0].targets.map(item => item.instanceId);
  for (const [language, dictionary] of [['en', en], ['ja', ja]]) { h.setLanguage(language);
    assert.equal(h.el('Group').children[0].textContent, dictionary['无组织组']); assert.equal(h.el('Image').children[0].textContent, dictionary['留空：继承投影或不使用图片']);
    assert.equal(h.el('Image').children[1].textContent, dictionary['明确不使用投影图片（null）']); assert.equal(h.el('Group').value, 'companions');
    assert.equal(h.el('Apply').disabled, false); assert.deepEqual(h.el('Targets').children.map(item => item.dataset.instanceId), stable); assert.equal(h.generated(), 2);
    assert.match(h.el('Object').children[0].textContent, /Author definition.*documents\/oc.md/); }
});

test('Chinese, English and Japanese cover every structure message and retain every placeholder', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-composition-structure.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/data-i18n="([^"$]+)"/g)].map(match => match[1]));
  for (const match of source.matchAll(/(?:t\(|message = |\? |: |report\(error, |i18n = )'([^']*[\u4e00-\u9fff][^']*)'/g)) keys.add(match[1]);
  for (const key of keys) for (const dictionary of [en, ja]) { assert.equal(typeof dictionary[key], 'string', key); assert.ok(dictionary[key].length);
    assert.deepEqual(dictionary[key].match(/\{\d+\}/g) || [], key.match(/\{\d+\}/g) || [], key); }
  for (const key of ['编辑片段结构', '片段结构编辑暂不可用，请重新预览当前配方后重试。', '片段结构已应用到原文草稿；尚未保存。', '片段结构已应用；文本与已保存版本一致。']) assert.ok(en[key] && ja[key]);
});
