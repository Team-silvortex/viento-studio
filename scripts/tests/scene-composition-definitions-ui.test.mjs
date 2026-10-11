import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { createSceneCompositionDefinitionsDraft, prepareSceneCompositionDefinitionsApply } from '../../engine/scene-composition-definitions.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { definitionsFixture, copy, decoded, hash, ids } from './scene-composition-definitions-fixture.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

async function settle(h) { for (let index = 0; index < 200; index++) { await flushDialogs();
  if (!h.el('Dialog').open || h.el('Dialog').getAttribute('aria-busy') !== 'true') return; await new Promise(resolve => setTimeout(resolve, 1)); }
  assert.fail('Definition editor remained busy'); }
async function harness(t, options = {}) {
  const value = await definitionsFixture(options), checks = [], applies = [], receipts = [], alerts = [];
  const context = { editable: true, creating: false, busy: false, compositionSourceWritable: true, canEditCompositionDefinitions: true,
    sceneDraftPath: value.source.sourcePath, sceneDraftToken: 1 };
  let live = true, confirm = true, language = 'zh-CN', languageListener = () => {}, generated = 0, memory = value.source.content;
  const factory = async (...args) => { const draft = await createSceneCompositionDefinitionsDraft(...args);
    return { fragments: draft.fragments, propose(input) { return draft.propose(copy(input)); } }; };
  const translate = (key, ...args) => String(({ en, ja }[language] || {})[key] || key).replace(/\{(\d+)\}/g, (_, index) => args[index] ?? '');
  const h = await dialogHarness('app-scene-composition-definitions', { crypto: { subtle: webcrypto.subtle, randomUUID: () => { generated++; return webcrypto.randomUUID(); } }, queueMicrotask,
    createSceneCompositionDefinitionsDraft: options.factory || factory, ...(options.supported === false ? { supportsStudioCoreCompositionDefinitions: () => false } : {}),
    t: translate, translatePage(root) { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange(listener) { languageListener = listener; return () => {}; }, fetchJsonApiRequest() { assert.fail('The parent owns dependency checks and transport'); },
  });
  h.runtime.window.confirm = () => confirm; h.runtime.window.alert = value => alerts.push(value);
  const controller = h.runtime.setupSceneCompositionDefinitions({ getContext: () => context,
    validateDraft: async (proposal, guard) => { checks.push(copy(proposal)); return options.validate ? options.validate(proposal, guard) : { ok: true }; },
    applySourceDraft: async (proposal, guard) => { applies.push(copy(proposal)); if (options.apply) return options.apply(proposal, guard, context);
      const prepared = await prepareSceneCompositionDefinitionsApply({ ...value.source, content: memory }, copy(proposal), { digest: hash });
      if (!guard.isCurrent()) throw Error('Owner changed'); memory = prepared.afterContent; context.sceneDraftToken++; return { applied: true }; },
    sourceApplied: async (result, proposal) => { receipts.push({ result, proposal: copy(proposal) }); },
  });
  const el = suffix => h.element(`sceneCompositionDefinitions${suffix}`), open = extra => controller.open({ ...value, isCurrent: () => live, ...extra });
  t.after(() => controller.destroy()); if (!options.skipOpen) assert.equal(await open(), true);
  const input = (suffix, raw) => { el(suffix).value = String(raw); el(suffix).dispatch(['Fragment', 'Object', 'Controls', 'Image'].includes(suffix) ? 'change' : 'input'); };
  const check = async () => { el('Check').click(); await settle({ el }); };
  return { ...h, value, context, controller, el, checks, applies, receipts, alerts, open, input, check, generated: () => generated,
    memory: () => memory, setLive: value => { live = value; }, setConfirm: value => { confirm = value; }, setLanguage(value) { language = value; languageListener(); } };
}
const rawFragment = (source, index) => { const range = locateJsonSource(parseJsonSource(source), `/fragments/${index}`); return source.slice(range.start, range.end); };

test('the definition directory exposes raw declarations and blocking placements without requiring a selected actor', async t => {
  const h = await harness(t); assert.deepEqual(h.el('Fragment').children.map(item => item.value), ['party', 'unused']);
  assert.deepEqual(JSON.parse(h.el('Before').textContent), h.value.recipe.fragments[0]); assert.equal(h.el('Check').disabled, true); assert.equal(h.generated(), 0);
  assert.deepEqual(h.el('Blockers').children.map(item => item.dataset.placementId), h.value.recipe.placements.map(item => item.placementId));
  assert.equal(h.el('Remove').disabled, true); h.el('Remove').dispatch('click'); assert.equal(h.el('Check').disabled, true);
});

test('ADD creates one explicit actor, no groups or placements, and no instance identities across rechecks or three languages', async t => {
  const h = await harness(t); h.el('Add').click(); h.input('FragmentId', 'chapterOne'); h.input('Key', 'hero'); h.input('Image', ids.image); await h.check();
  const p = h.checks[0]; assert.deepEqual(p.targets, []); assert.deepEqual(p.edit.fragment, { fragmentId: 'chapterOne', actors: [{ key: 'hero', objectId: ids.core,
    position: [200, 220], size: [80, 80], color: '#ffffff', speed: 160, controls: 'arrows', imageResourceId: ids.image }], groups: [] });
  assert.deepEqual(decoded(p.afterContent).placements, h.value.recipe.placements); assert.equal(h.el('Targets').children[0].dataset.fragmentId, 'chapterOne');
  h.setLanguage('en'); await h.check(); h.setLanguage('ja'); assert.equal(h.el('FragmentId').value, 'chapterOne'); assert.equal(h.el('Apply').disabled, false);
  assert.deepEqual(h.checks[1], p); assert.equal(h.generated(), 0); assert.equal(h.el('Image').children[0].textContent, ja['留空：继承投影或不使用图片']);
});

test('game projection ADD stores explicit inheritance and position without expanding defaults; absent, null and explicit images stay distinct', async t => {
  for (const image of ['', '__none__', ids.image]) {
    const h = await harness(t); h.el('Add').click(); h.input('Object', ids.first); h.input('Image', image); await h.check();
    const actor = h.checks[0].edit.fragment.actors[0]; assert.equal(actor.useProjectionDefaults, true); assert.deepEqual(actor.position, [200, 220]);
    for (const field of ['size', 'color', 'speed', 'controls']) assert.equal(Object.hasOwn(actor, field), false);
    assert.equal(Object.hasOwn(actor, 'imageResourceId'), image !== ''); assert.equal(actor.imageResourceId, image === '__none__' ? null : image || undefined);
    assert.ok(h.el('Dialog').textContent.includes('首次放置时检查有效投影和图片内容')); assert.equal(h.generated(), 0);
  }
});

test('disabling projection inheritance keeps explicit inputs and authors them only when selected', async t => {
  const h = await harness(t); h.el('Add').click(); h.input('Width', '39'); h.input('Object', ids.first);
  assert.equal(h.el('Width').disabled, true); assert.equal(h.el('Width').value, '39'); h.el('Inherited').checked = false; h.el('Inherited').dispatch('change'); await h.check();
  const actor = h.checks[0].edit.fragment.actors[0]; assert.equal(Object.hasOwn(actor, 'useProjectionDefaults'), false); assert.deepEqual(actor.size, [39, 80]);
});

test('COPY preserves the complete source CST of actors and nested groups while changing only the fragment ID', async t => {
  const h = await harness(t); h.el('Copy').click(); h.input('FragmentId', 'copiedParty'); await h.check(); const p = h.checks[0], after = decoded(p.afterContent);
  assert.deepEqual(after.fragments.at(-1), { ...h.value.recipe.fragments[0], fragmentId: 'copiedParty' });
  assert.equal(rawFragment(p.afterContent, 2), rawFragment(h.value.source.content, 0).replace('"party"', '"copiedParty"'));
  assert.deepEqual(after.placements, h.value.recipe.placements); assert.deepEqual(p.targets, []); assert.equal(h.generated(), 0);
  assert.equal(h.el('ActorFields').hidden, true); assert.equal(h.el('Targets').children[0].children.filter(item => item.dataset.groupKey).length, 3);
});

test('REMOVE deletes only an unused definition and preserves documents, resources, all placements and remaining declaration bytes', async t => {
  const h = await harness(t); h.input('Fragment', 'unused'); assert.equal(h.el('Remove').disabled, false); h.el('Remove').click(); await h.check(); const p = h.checks[0];
  assert.deepEqual(p.edit, { action: 'remove', fragmentId: 'unused' }); assert.deepEqual(p.targets, []); assert.deepEqual(decoded(p.afterContent).placements, h.value.recipe.placements);
  assert.equal(rawFragment(p.afterContent, 0), rawFragment(h.value.source.content, 0)); assert.equal(decoded(p.afterContent).fragments.length, 1); assert.equal(h.generated(), 0);
});

test('the last definition and any used definition cannot be removed even through a manually dispatched disabled button', async t => {
  const h = await harness(t, { oneFragment: true }); assert.equal(h.el('Remove').disabled, true); h.el('Remove').dispatch('click'); await h.check();
  assert.equal(h.checks.length, 0); assert.equal(h.memory(), h.value.source.content);
});

test('missing catalogs disable only ADD while raw COPY and unused REMOVE remain available', async t => {
  const h = await harness(t, { skipOpen: true }); assert.equal(await h.open({ objects: [], images: [] }), true); assert.equal(h.el('Add').disabled, true);
  h.el('Copy').click(); await h.check(); assert.equal(h.checks.length, 1); h.input('Fragment', 'unused'); h.el('Remove').click(); await h.check(); assert.equal(h.checks.length, 2);
});

test('invalid fragment IDs, duplicate IDs, unknown definitions, incomplete numbers and invalid explicit fields preserve all raw input', async t => {
  for (const alter of [h => h.input('FragmentId', 'party'), h => h.input('FragmentId', '9bad'), h => h.input('FragmentId', ''),
    h => h.input('Object', 'missing'), h => h.input('Key', ''), h => h.input('X', ''), h => h.input('X', '100001'), h => h.input('Width', '0'),
    h => h.input('Color', 'invalid'), h => h.input('Speed', '-1'), h => h.input('Controls', 'unknown'), h => h.input('Image', '__none__')]) {
    const h = await harness(t); h.el('Add').click(); alter(h); const raw = ['FragmentId', 'Object', 'Key', 'X', 'Width', 'Color', 'Speed', 'Controls', 'Image'].map(suffix => h.el(suffix).value);
    await h.check(); assert.equal(h.checks.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
    assert.deepEqual(['FragmentId', 'Object', 'Key', 'X', 'Width', 'Color', 'Speed', 'Controls', 'Image'].map(suffix => h.el(suffix).value), raw); assert.equal(h.generated(), 0);
  }
});

test('COPY cannot use an existing or unchanged ID and keeps the user input on failure', async t => {
  for (const id of ['party', 'unused']) { const h = await harness(t); h.el('Copy').click(); h.input('FragmentId', id); await h.check();
    assert.equal(h.checks.length, 0); assert.equal(h.el('FragmentId').value, id); assert.equal(h.memory(), h.value.source.content); }
});

test('ADD and COPY enforce the declared actor budget before approval without changing current instances', async t => {
  for (const operation of ['Add', 'Copy']) { const h = await harness(t, { capacity: true }); h.el(operation).click(); await h.check();
    assert.equal(h.checks.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content); assert.equal(h.generated(), 0); }
});

test('cancel and escape require explicit discard when dirty and return focus without applying or generating identity', async t => {
  const h = await harness(t), opener = h.document.createElement('button'); h.el('Dialog').close(); await flushDialogs(); opener.focus(); await h.open(); h.el('Copy').click();
  h.setConfirm(false); h.el('Cancel').click(); assert.equal(h.el('Dialog').open, true); h.el('Dialog').dispatch('cancel'); assert.equal(h.el('Dialog').open, true);
  h.setConfirm(true); h.el('Cancel').click(); await flushDialogs(); assert.equal(h.el('Dialog').open, false); assert.equal(h.document.activeElement, opener); assert.equal(h.applies.length, 0);
});

test('changing the source definition or operation honors discard and never silently consumes typed ADD input', async t => {
  const h = await harness(t); h.el('Add').click(); h.input('FragmentId', 'typed'); h.setConfirm(false); h.input('Fragment', 'unused');
  assert.equal(h.el('Fragment').value, 'party'); assert.equal(h.el('FragmentId').value, 'typed'); h.el('Copy').click(); assert.equal(h.el('ActorFields').hidden, false);
  h.setConfirm(true); h.input('Fragment', 'unused'); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Fragment').value, 'unused'); assert.equal(h.applies.length, 0);
});

test('pending review locks the full form and late completion after forced close cannot approve a new dialog', async t => {
  const waiting = deferred(), reached = deferred(), h = await harness(t, { validate: async () => { reached.resolve(); return waiting.promise; } });
  h.el('Add').click(); h.el('Check').click(); await reached.promise;
  for (const suffix of ['Fragment', 'FragmentId', 'Key', 'Object', 'Inherited', 'X', 'Y', 'Width', 'Height', 'Color', 'Speed', 'Controls', 'Image', 'Add', 'Copy', 'Remove', 'Cancel', 'Close']) assert.equal(h.el(suffix).disabled, true, suffix);
  h.el('Dialog').close(); await flushDialogs(); waiting.resolve({ ok: true }); await settle(h); assert.equal(h.el('Dialog').open, false); assert.equal(h.receipts.length, 0); assert.equal(h.applies.length, 0);
});

test('late open success and failure are suppressed after the original source owner is lost', async t => {
  for (const fail of [false, true]) { const waiting = deferred(), reached = deferred(); const h = await harness(t, { skipOpen: true,
    factory: async (...args) => { reached.resolve(); await waiting.promise; if (fail) throw Error('Late open'); return createSceneCompositionDefinitionsDraft(...args); } });
    const opening = h.open(); await reached.promise; h.setLive(false); waiting.resolve(); assert.equal(await opening, false); assert.equal(h.el('Dialog').open, false); assert.deepEqual(h.alerts, []);
  }
});

test('dependency diagnostics retain declarations without implying unplaced resources were rendered', async t => {
  const h = await harness(t, { validate: async () => ({ ok: false, diagnostics: [{ code: 'composition-document-invalid', propertyPath: '/fragments/2/actors/0/objectId' }] }) });
  h.el('Add').click(); h.input('FragmentId', 'retained'); await h.check(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('FragmentId').value, 'retained');
  assert.equal(h.el('Diagnostics').children.length, 1); assert.equal(h.el('Source').textContent, h.checks[0].afterContent); assert.equal(h.memory(), h.value.source.content);
});

test('silent raw ID, actor, image, inheritance or source selection changes revoke a checked definition before apply', async t => {
  for (const alter of [h => { h.el('FragmentId').value = 'silent'; }, h => { h.el('Key').value = 'silent'; }, h => { h.el('Image').value = ids.image; },
    h => { h.el('Inherited').checked = true; }, h => { h.el('Fragment').value = 'unused'; }]) {
    const h = await harness(t); h.el('Add').click(); await h.check(); alter(h); h.el('Apply').click(); await settle(h);
    assert.equal(h.applies.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
  }
});

test('silent declaration mutation during review prevents a delayed approval', async t => {
  const waiting = deferred(), reached = deferred(), h = await harness(t, { validate: async () => { reached.resolve(); return waiting.promise; } });
  h.el('Copy').click(); h.el('Check').click(); await reached.promise; h.el('FragmentId').value = 'mutated'; waiting.resolve({ ok: true }); await settle(h);
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.receipts.length, 0);
});

test('an unconfirmed apply receipt retains the definition and does not send a completion', async t => {
  const h = await harness(t, { apply: async () => ({ applied: false }) }); h.el('Copy').click(); await h.check(); h.el('Apply').click(); await settle(h);
  assert.equal(h.el('Dialog').open, true); assert.equal(h.receipts.length, 0); assert.equal(h.memory(), h.value.source.content);
});

test('a valid application accepts legitimate source-token advancement and keeps the ordinary saved baseline', async t => {
  const h = await harness(t, { dirty: true }); h.input('Fragment', 'unused'); h.el('Remove').click(); await h.check(); const p = h.checks[0]; h.el('Apply').click(); await settle(h);
  assert.equal(h.el('Dialog').open, false); assert.equal(h.context.sceneDraftToken, 2); assert.equal(h.receipts.length, 1); assert.equal(h.memory(), p.afterContent);
  assert.equal(h.value.saved.includes('未保存😀'), false); assert.equal(p.afterContent.includes('未保存😀'), true);
});

test('source-owner loss during apply blocks a delayed receipt and preserves the author draft', async t => {
  const waiting = deferred(), reached = deferred(), h = await harness(t, { apply: async (_p, guard) => { reached.resolve(); await waiting.promise;
    if (!guard.isCurrent()) throw Error('Owner changed'); return { applied: true }; } }); h.el('Copy').click(); await h.check(); h.el('Apply').click(); await reached.promise;
  h.setLive(false); waiting.resolve(); await settle(h); assert.equal(h.receipts.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.memory(), h.value.source.content);
});

test('missing capability and invalid source contexts fail closed without sibling work', async t => {
  const h = await harness(t, { supported: false, skipOpen: true, factory() { assert.fail('Unsupported core must not create a draft'); } }); assert.equal(await h.open(), false); assert.deepEqual(h.alerts, []);
  for (const [key, value] of [['canEditCompositionDefinitions', false], ['compositionSourceWritable', false], ['editable', false], ['busy', true], ['creating', true], ['sceneDraftPath', 'other.json']]) {
    const valid = await harness(t); valid.context[key] = value; valid.controller.refresh(); assert.equal(valid.el('Add').disabled, true); assert.equal(valid.el('Copy').disabled, true); valid.controller.destroy();
  }
});

test('every new definition UI, entry and source-application message has English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-composition-definitions.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/(?:data-i18n="([^"]+)"|'([^'\n]*[\u3400-\u9fff][^'\n]*)')/g)].map(match => match[1] || match[2]);
  for (const key of new Set(keys)) { assert.equal(typeof en[key], 'string', `English: ${key}`); assert.equal(typeof ja[key], 'string', `Japanese: ${key}`); }
  for (const key of ['片段定义已应用到原文草稿；尚未保存。', '片段定义已应用；文本与已保存版本一致。']) { assert.equal(typeof en[key], 'string'); assert.equal(typeof ja[key], 'string'); }
});
