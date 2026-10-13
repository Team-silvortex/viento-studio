import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { SCENE_COMPOSITION_CREATE_API_PATH, SCENE_COMPOSITION_CREATE_MAX_ACTORS, validateCompositionCreateCatalog, prepareCompositionDraft, prepareCompositionDraftApply, isCompositionDraftProposal } from '../../engine/scene-composition-create.mjs';
import { planCompositionCreateLayout } from '../../engine/scene-composition-create-layout.mjs';
import { expandSceneComposition } from '../../engine/scene-composition.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const copy = value => JSON.parse(JSON.stringify(value));
const settle = async () => { await flushDialogs(); await flushDialogs(); };
const objectId = '10000000-0000-4000-8000-000000000001', projectionId = '10000000-0000-4000-8000-000000000002';
const revision = digit => 'sha256:' + digit.repeat(64);
async function fixture(t, settings = {}) {
  let language = 'zh', languageChanged = () => {}, unsubscribed = 0, allocated = 0;
  const context = { editable: true, busy: false, dirty: false, creating: false, sourceToken: 'source:1', documentRoot: 'documents',
    documentTypes: [{ id: 'note', label: 'Notes <b>' }, { id: 'scene', label: 'Scenes' }], ...settings.context };
  const catalog = { format: 'viento-scene-composition-create-context', schemaVersion: 1, worldId: 'test-world', worldRevision: revision('a'),
    documentRoot: context.documentRoot, documentTypes: copy(context.documentTypes),
    existingPaths: [`${context.documentRoot}/hero.md`, `${context.documentRoot}/game.json`], existingIdentities: [objectId, projectionId],
    objects: [{ id: objectId, name: 'Hero <img>', sourcePath: `${context.documentRoot}/hero.md`, sourceRevision: revision('b'), canInheritProjection: false },
      { id: projectionId, name: 'Game projection', sourcePath: `${context.documentRoot}/game.json`, sourceRevision: revision('c'), canInheritProjection: true }], ...settings.catalog };
  const requests = [], calls = [], proposals = [], focused = [], confirms = [];
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-composition-create', {
    SCENE_COMPOSITION_CREATE_API_PATH, SCENE_COMPOSITION_CREATE_MAX_ACTORS,
    planCompositionCreateLayout: (actors, settings) => planCompositionCreateLayout(copy(actors), copy(settings)),
    crypto: { randomUUID: () => `30000000-0000-4000-8000-${String(++allocated).padStart(12, '0')}` },
    validateCompositionCreateCatalog: input => validateCompositionCreateCatalog(copy(input)),
    prepareCompositionDraft: (owner, source, request) => {
      const proposal = prepareCompositionDraft(copy(owner), copy(source), copy(request)); proposals.push(proposal); return proposal;
    },
    prepareCompositionDraftApply: (owner, source, proposal) => prepareCompositionDraftApply(copy(owner), copy(source), proposal),
    fetchJsonApiRequest: async (...args) => {
      requests.push(args); assert.equal(args[0], SCENE_COMPOSITION_CREATE_API_PATH); assert.equal(args[1].cache, 'no-store');
      assert.equal(args[1].method, undefined); return { payload: copy(settings.fetch ? await settings.fetch(requests.length, args[1]) : catalog) };
    },
    t: translate,
    translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: listener => { languageChanged = listener; return () => { unsubscribed++; languageChanged = () => {}; }; },
  });
  h.runtime.window.confirm = message => { confirms.push(message); return settings.confirm?.() ?? true; };
  let controller;
  controller = h.runtime.setupSceneCompositionCreate({ getContext: () => context, createDraft: async (proposal, ports) => {
    calls.push({ proposal, ports });
    if (settings.createDraft) return settings.createDraft(proposal, ports, { context, refresh: () => controller.refresh() });
    assert.equal(ports.isCurrent(), true);
    const draft = prepareCompositionDraftApply(copy({ sourceToken: context.sourceToken, documentRoot: context.documentRoot, documentTypes: context.documentTypes }), copy(ports.catalog), proposal);
    assert.equal(draft.content, proposal.content);
    context.sourceToken = 'new-draft'; context.creating = true; context.dirty = true; controller.refresh();
    return { applied: true, focus: () => { assert.equal(h.element('sceneCompositionCreateDialog').open, false); focused.push(true); } };
  } });
  if (settings.available !== false) controller.setAvailable(true);
  t.after(() => controller.dispose());
  const el = suffix => h.element('sceneCompositionCreate' + suffix);
  return { ...h, controller, context, catalog, el, calls, requests, proposals, focused, confirms,
    open: async () => { const result = controller.open(); await settle(); return result; },
    click: async suffix => { el(suffix).click(); await settle(); },
    set: (suffix, value, event = 'input') => { if (suffix === 'Inherit') el(suffix).checked = value; else el(suffix).value = value; if (event) el(suffix).dispatch(event); },
    language: value => { language = value; languageChanged(); }, unsubscribed: () => unsubscribed, allocated: () => allocated };
}

test('creation entry requires the semantic host and an idle saved editable source', async t => {
  for (const patch of [{ editable: false }, { busy: true }, { dirty: true }, { creating: true }, { sourceToken: '' }, { documentTypes: [] }]) {
    const h = await fixture(t, { context: patch }); assert.equal(await h.open(), false); assert.equal(h.el('Btn').disabled, true); assert.equal(h.requests.length, 0);
  }
  const unsupported = await fixture(t, { available: false }); assert.equal(await unsupported.open(), false); assert.equal(unsupported.el('Btn').hidden, true);
  const h = await fixture(t); assert.equal(h.el('Btn').parentElement.id, 'docEditActions');
  assert.deepEqual(Object.keys(h.controller).sort(), ['dispose', 'open', 'refresh', 'setAvailable']);
  assert.equal(await h.open(), true); assert.equal(await h.open(), false);
  assert.equal(h.el('Object').value, objectId); assert.equal(h.el('Inherit').checked, false); assert.equal(h.el('Inherit').disabled, true);
  assert.equal(h.el('Type').value, 'scene'); assert.equal(h.el('Path').value, 'documents/scenes/new-composition.json');
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Preview').hidden, true); assert.equal(h.requests.length, 1); assert.equal(h.calls.length, 0);
  assert.equal(h.el('Dialog').dataset.dirty, 'false');
});

test('an existing generic or legacy project type can create a Rust-validated recipe', async t => {
  const h = await fixture(t, { context: { documentRoot: 'design-data', documentTypes: [{ id: 'character', label: '角色' }] } });
  await h.open(); assert.equal(h.el('Type').value, 'character'); assert.equal(h.el('Path').value, 'design-data/scenes/new-composition.json');
  await h.click('Review'); const proposal = h.proposals.at(-1); assert.equal(isCompositionDraftProposal(proposal), true);
  const expanded = expandSceneComposition(proposal.content); assert.ok(expanded); await h.click('Apply'); assert.equal(h.calls.length, 1);
});

test('review shows every source byte and keeps both UUIDs stable across form reviews', async t => {
  const h = await fixture(t); await h.open(); await h.click('Review'); const first = h.proposals.at(-1);
  assert.equal(h.el('Source').textContent, first.content); assert.equal(h.el('Source').tagName, 'PRE'); assert.equal(h.el('Apply').disabled, false);
  h.set('Object', projectionId, 'change'); assert.equal(h.el('Inherit').checked, true); assert.equal(h.el('Inherit').disabled, false);
  h.set('Name', '我的场景 <script>'); h.set('X', '-12.5'); await h.click('Review'); const second = h.proposals.at(-1);
  assert.equal(first.placementId, second.placementId); assert.equal(first.actors[0].instanceId, second.actors[0].instanceId); assert.notEqual(second.placementId, second.actors[0].instanceId);
  assert.equal(h.allocated(), 2); assert.equal(second.actors[0].useProjectionDefaults, true); assert.deepEqual(second.actors[0].position, [-12.5, 220]);
  assert.equal(JSON.parse(second.content).scene.title, '我的场景 <script>'); assert.equal(h.el('Source').querySelector('script'), null);
  assert.equal(h.calls.length, 0); assert.equal(h.requests.length, 1);
});

test('explicit apply refetches the catalog and hands the exact reviewed brand to the draft host once', async t => {
  const h = await fixture(t); await h.open(); h.set('Path', 'documents/scenes/我的配方.json'); await h.click('Review');
  const preview = h.el('Source').textContent; await h.click('Apply');
  assert.equal(h.requests.length, 2); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].proposal.content, preview);
  assert.equal(isCompositionDraftProposal(h.calls[0].proposal), true); assert.equal(h.calls[0].ports.isCurrent(), false);
  assert.equal(h.el('Dialog').open, false); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.deepEqual(h.focused, [true]);
});

test('invalid values or occupied paths cannot create a draft and remain available for correction', async t => {
  const h = await fixture(t); await h.open();
  for (const [field, invalid, reset] of [['Path', 'documents/../outside.json', 'documents/scenes/new.json'], ['Path', 'documents/hero.md', 'documents/scenes/new.json'],
    ['Path', 'documents/game.json', 'documents/scenes/new.json'], ['Name', '', 'New'], ['Fragment', '__proto__', 'main'], ['Actor', 'actor space', 'actor'],
    ['X', '', '200'], ['X', '0x20', '200'], ['Y', 'Infinity', '220'], ['Width', '63', '960'], ['Height', '4097', '540'], ['Background', '#badcolor', '#142233']]) {
    h.set(field, invalid); await h.click('Review'); assert.equal(h.el('Apply').disabled, true, `${field}: ${invalid}`); assert.equal(h.el('Preview').hidden, true);
    await h.click('Apply'); assert.equal(h.calls.length, 0); assert.equal(h.el(field).value, invalid); h.set(field, reset);
  }
  await h.click('Review'); assert.equal(h.el('Apply').disabled, false);
});

test('ordinary edits invalidate the review and silent edits require a new visible review before handoff', async t => {
  const h = await fixture(t); await h.open(); await h.click('Review'); h.set('Name', 'Changed');
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Preview').hidden, true); await h.click('Review');
  h.set('X', '42', null); await h.click('Apply'); assert.equal(h.calls.length, 0); assert.equal(h.proposals.at(-1).actors[0].position[0], 42);
  await h.click('Apply'); assert.equal(h.calls.length, 1);
});

test('an empty catalog gives a next step, keeps cancellation available, and never enables creation', async t => {
  const h = await fixture(t, { catalog: { objects: [] } }); await h.open();
  assert.equal(h.el('Empty').hidden, false); assert.equal(h.el('Review').disabled, true); assert.equal(h.el('Apply').disabled, true);
  assert.match(h.el('Empty').textContent, /世界与对象/); await h.click('Cancel'); assert.equal(h.el('Dialog').open, false); assert.equal(h.calls.length, 0);
});

test('catalog failures and malformed replies retain settings and can be reloaded', async t => {
  for (const invalid of [null, {}, { format: 'wrong' }]) {
    let good;
    const h = await fixture(t, { fetch: async count => { if (count === 1) return invalid; return good; } }); good = h.catalog;
    await h.open(); assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Status').textContent, /无法读取/);
    h.set('Name', 'Preserved'); await h.click('Reload'); assert.equal(h.el('Name').value, 'Preserved'); assert.equal(h.el('Review').disabled, false);
    h.set('Object', objectId, 'change'); await h.click('Review'); assert.equal(h.el('Apply').disabled, false);
  }
});

test('fresh catalog changes reject the reviewed draft and reload requires another review', async t => {
  for (const change of [h => h.catalog.worldRevision = revision('d'), h => h.catalog.objects[0].sourceRevision = revision('e'),
    h => h.catalog.existingPaths.push('documents/scenes/new-composition.json')]) {
    const h = await fixture(t); await h.open(); await h.click('Review'); change(h); await h.click('Apply');
    assert.equal(h.calls.length, 0); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Status').textContent, /已变化/);
    h.set('Path', 'documents/scenes/recovered.json'); await h.click('Reload'); assert.equal(h.el('Apply').disabled, true);
    await h.click('Review'); await h.click('Apply'); assert.equal(h.calls.length, 1);
  }
});

test('reloading keeps a disappeared object visible and allows clearing no-longer-supported inheritance', async t => {
  const h = await fixture(t); await h.open(); h.set('Object', projectionId, 'change'); assert.equal(h.el('Inherit').checked, true);
  h.catalog.objects[1].canInheritProjection = false; await h.click('Reload'); assert.equal(h.el('Inherit').checked, true); assert.equal(h.el('Inherit').disabled, false);
  await h.click('Review'); assert.equal(h.el('Apply').disabled, true); h.set('Inherit', false, 'change'); await h.click('Review'); assert.equal(h.el('Apply').disabled, false);
  h.catalog.objects.pop(); await h.click('Reload'); assert.equal(h.el('Object').value, projectionId);
  assert.match(h.el('Object').children.at(-1).textContent, /已不可用/); await h.click('Review'); assert.equal(h.el('Apply').disabled, true);
});

test('loading is cancelable and old requests cannot fill a newly opened dialog', async t => {
  const wait = deferred(); let data;
  const h = await fixture(t, { fetch: count => count === 1 ? wait.promise : data }); data = h.catalog;
  assert.equal(h.controller.open(), true); assert.equal(h.el('Dialog').getAttribute('aria-busy'), 'true'); assert.equal(h.el('Close').disabled, false);
  await h.click('Close'); assert.equal(h.el('Dialog').open, false); assert.equal(h.requests[0][1].signal.aborted, true);
  await h.open(); h.set('Name', 'New session'); wait.resolve({ ...data, objects: [] }); await settle();
  assert.equal(h.el('Name').value, 'New session'); assert.equal(h.el('Object').value, objectId); assert.equal(h.el('Empty').hidden, true);
});

test('context or capability changes invalidate the form even when the original values return', async t => {
  for (const change of [h => h.context.dirty = true, h => h.context.busy = true, h => h.context.creating = true, h => h.context.editable = false,
    h => h.context.sourceToken = 'other', h => h.context.documentRoot = 'other', h => h.context.documentTypes[0].label = 'Changed',
    h => h.controller.setAvailable(false)]) {
    const h = await fixture(t); await h.open(); h.set('Name', 'Keep'); await h.click('Review'); change(h); h.controller.refresh();
    await h.click('Apply'); assert.equal(h.calls.length, 0); assert.equal(h.el('Name').value, 'Keep'); assert.equal(h.el('Apply').disabled, true); assert.match(h.el('Status').textContent, /已变化/);
  }
  const h = await fixture(t); await h.open(); h.context.busy = true; h.controller.refresh(); h.context.busy = false; h.controller.refresh();
  assert.equal(h.el('Review').disabled, true); assert.equal(h.el('Close').disabled, false);
});

test('pending fresh reads cannot apply after the editor changes, including a silent field change', async t => {
  for (const change of [h => { h.context.sourceToken = 'other'; h.controller.refresh(); }, h => h.set('Name', 'silent', null)]) {
    const wait = deferred(); let data;
    const h = await fixture(t, { fetch: count => count === 2 ? wait.promise : data }); data = h.catalog;
    await h.open(); await h.click('Review'); h.el('Apply').click(); change(h); wait.resolve(data); await settle();
    assert.equal(h.calls.length, 0); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, true);
  }
});

test('pending handoffs exclude duplicate clicks, cancellation and editor save shortcuts', async t => {
  const wait = deferred(), h = await fixture(t, { createDraft: () => wait.promise }); await h.open(); await h.click('Review'); await h.click('Apply');
  assert.equal(h.calls.length, 1); assert.equal(h.el('Dialog').getAttribute('aria-busy'), 'true'); assert.equal(h.el('Name').disabled, true);
  h.el('Apply').click(); h.el('Close').click(); h.el('Dialog').dispatch('cancel'); assert.equal(h.calls.length, 1); assert.equal(h.el('Dialog').open, true);
  for (const event of [{ key: 's', ctrlKey: true }, { key: 's', metaKey: true }, { key: 'Enter', ctrlKey: true }]) {
    const result = h.el('Dialog').dispatch('keydown', event); assert.equal(result.defaultPrevented, true); assert.equal(result.stopped, true);
  }
  h.context.busy = true; h.controller.refresh(); h.context.busy = false; h.controller.refresh(); assert.equal(h.calls[0].ports.isCurrent(), false);
  wait.resolve(false); await settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, true);
});

test('host refusal or exceptions keep local settings and permit a guarded retry', async t => {
  for (const throwing of [false, true]) {
    let count = 0;
    const h = await fixture(t, { createDraft: async () => { if (++count === 1) { if (throwing) throw new Error('host unavailable'); return false; } return { applied: true }; } });
    await h.open(); h.set('Name', 'Keep this recipe'); await h.click('Review'); await h.click('Apply');
    assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Name').value, 'Keep this recipe'); assert.equal(h.el('Apply').disabled, false);
    assert.match(h.el('Status').textContent, /已保留/); await h.click('Apply'); assert.equal(h.calls.length, 2); assert.equal(h.el('Dialog').open, false);
  }
});

test('dirty cancellation respects confirmation, ignores IME cancellation and restores the opener', async t => {
  let allow = false; const h = await fixture(t, { confirm: () => allow }); h.el('Btn').focus(); await h.open(); h.set('Name', 'Keep'); await h.click('Review');
  h.language('ja'); await h.click('Cancel'); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Name').value, 'Keep');
  assert.equal(h.confirms[0], ja['丢弃本次配方创建设置？编辑器内容不会改变。']);
  h.el('Dialog').dispatch('cancel', { isComposing: true }); assert.equal(h.confirms.length, 1);
  allow = true; await h.click('Close'); assert.equal(h.el('Dialog').open, false); assert.equal(h.document.activeElement.id, 'sceneCompositionCreateBtn');
  assert.equal(h.calls.length, 0);
});

test('external close or disposal invalidates delayed handoffs and prevents a stolen focus', async t => {
  const wait = deferred(); let stolen = false;
  const h = await fixture(t, { createDraft: () => wait.promise }); await h.open(); await h.click('Review'); await h.click('Apply');
  h.el('Dialog').close(); await settle(); assert.equal(h.calls[0].ports.isCurrent(), false); await h.open(); h.set('Name', 'New session');
  wait.resolve({ applied: true, focus: () => { stolen = true; } }); await settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Name').value, 'New session'); assert.equal(stolen, false);
  const pending = deferred(), disposed = await fixture(t, { createDraft: () => pending.promise }); await disposed.open(); await disposed.click('Review'); await disposed.click('Apply');
  disposed.controller.dispose(); assert.equal(disposed.calls[0].ports.isCurrent(), false); pending.resolve({ applied: true, focus: () => assert.fail('late focus') }); await settle();
  assert.equal(disposed.el('Dialog'), null); assert.equal(disposed.el('Btn'), null); assert.equal(disposed.unsubscribed(), 1); disposed.controller.dispose(); assert.equal(disposed.unsubscribed(), 1);
});

test('switching language preserves authored fields, selected labels, JSON bytes and identifiers', async t => {
  const h = await fixture(t); await h.open(); h.set('Name', '我的场景'); h.set('Object', projectionId, 'change'); await h.click('Review');
  const preview = h.el('Source').textContent;
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.el('Name').value, '我的场景'); assert.equal(h.el('Object').value, projectionId);
    assert.equal(h.el('Type').children[0].textContent, 'Notes <b>'); assert.equal(h.el('Type').querySelector('b'), null);
    assert.equal(h.el('Object').children[0].textContent, 'Hero <img> · documents/hero.md'); assert.equal(h.el('Object').querySelector('img'), null);
    assert.equal(h.el('Source').textContent, preview); assert.equal(h.el('Apply').disabled, false); assert.equal(h.allocated(), 2);
  }
});

test('all scene recipe creation copy and the host success message have English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-composition-create.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/data-i18n="([^"]+)"/g)].map(match => match[1]));
  for (const match of source.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)) keys.add(match[1]);
  keys.add('场景配方草稿已准备好。可继续编辑，点击保存后才会登记到工程。');
  for (const key of keys) { assert.ok(en[key], `English: ${key}`); assert.ok(ja[key], `Japanese: ${key}`); }
});

test('multiple actors can reuse one object with independent keys, identities and starter positions', async t => {
  const h = await fixture(t); await h.open(); const firstId = h.el('ActorList').value;
  assert.equal(h.el('ActorList').children.length, 1); assert.equal(h.el('RemoveActor').disabled, true);
  await h.click('AddActor'); const secondId = h.el('ActorList').value;
  assert.equal(h.el('Actor').value, 'actor2'); assert.equal(h.el('X').value, '296'); assert.equal(h.el('Y').value, '220');
  assert.equal(h.el('Object').value, objectId); assert.equal(h.el('Inherit').checked, false);
  await h.click('AddActor'); const thirdId = h.el('ActorList').value;
  assert.equal(h.el('Actor').value, 'actor3'); assert.equal(h.el('X').value, '392');
  assert.equal(new Set([firstId, secondId, thirdId]).size, 3); assert.equal(h.allocated(), 4);
  await h.click('Review'); const proposal = h.proposals.at(-1), content = JSON.parse(proposal.content);
  assert.deepEqual(proposal.actors.map(actor => actor.objectId), [objectId, objectId, objectId]);
  assert.deepEqual(proposal.actors.map(actor => actor.instanceId), [firstId, secondId, thirdId]);
  assert.deepEqual(content.fragments[0].actors.map(actor => actor.controls), ['arrows', 'arrows', 'arrows']);
  assert.equal(content.placements.length, 1); assert.deepEqual(Object.values(content.placements[0].actorIds), [firstId, secondId, thirdId]);
  await h.click('Apply'); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].proposal.actors.length, 3);
});

test('switching actors is a view operation and retains the exact reviewed JSON and draft signature', async t => {
  const h = await fixture(t); await h.open(); const firstId = h.el('ActorList').value;
  await h.click('AddActor'); const secondId = h.el('ActorList').value; h.set('Object', projectionId, 'change');
  await h.click('Review'); const proposal = h.proposals.at(-1), source = h.el('Source').textContent;
  for (const id of [firstId, secondId, firstId, secondId]) {
    h.set('ActorList', id, 'change'); assert.equal(h.el('Source').textContent, source); assert.equal(h.el('Apply').disabled, false);
    assert.equal(h.proposals.at(-1), proposal); assert.equal(h.el('Dialog').dataset.dirty, 'true');
  }
  assert.equal(h.el('Object').value, projectionId); assert.equal(h.el('Inherit').checked, true);
  assert.equal(h.allocated(), 3); assert.equal(h.requests.length, 1); assert.equal(h.calls.length, 0);
});

test('unfinished actor fields survive switching, language changes and object reloads', async t => {
  const h = await fixture(t); await h.open(); const firstId = h.el('ActorList').value;
  h.set('Actor', ''); h.set('X', '-'); h.set('Y', '1e'); await h.click('AddActor'); const secondId = h.el('ActorList').value;
  assert.equal(h.el('X').value, '200'); assert.equal(h.el('Y').value, '220'); h.set('Object', projectionId, 'change');
  h.set('ActorList', firstId, 'change');
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.el('Actor').value, ''); assert.equal(h.el('X').value, '-'); assert.equal(h.el('Y').value, '1e');
    assert.equal(h.el('ActorList').value, firstId);
  }
  await h.click('Reload'); assert.equal(h.el('X').value, '-'); assert.equal(h.el('Y').value, '1e'); assert.equal(h.el('Actor').value, '');
  assert.equal(h.el('X').type, 'text'); assert.equal(h.el('Y').type, 'text'); assert.equal(h.allocated(), 3);
  h.set('ActorList', secondId, 'change'); assert.equal(h.el('Object').value, projectionId); assert.equal(h.el('Inherit').checked, true);
  await h.click('Review'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Preview').hidden, true);
  h.set('ActorList', firstId, 'change'); h.set('Actor', 'original'); h.set('X', '12'); h.set('Y', '34'); await h.click('Review');
  assert.equal(h.el('Apply').disabled, false); assert.deepEqual(h.proposals.at(-1).actors.map(actor => actor.instanceId), [firstId, secondId]);
});

test('actor removal selects a neighbor, preserves survivors and never reuses an instance identity', async t => {
  const h = await fixture(t); await h.open(); const firstId = h.el('ActorList').value;
  await h.click('AddActor'); const secondId = h.el('ActorList').value; await h.click('AddActor'); const thirdId = h.el('ActorList').value;
  h.set('ActorList', secondId, 'change'); await h.click('Review'); await h.click('RemoveActor');
  assert.equal(h.el('ActorList').value, thirdId); assert.equal(h.el('Actor').value, 'actor3'); assert.equal(h.el('X').value, '392');
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Preview').hidden, true);
  await h.click('AddActor'); const replacementId = h.el('ActorList').value;
  assert.equal(h.el('Actor').value, 'actor2'); assert.notEqual(replacementId, secondId);
  await h.click('RemoveActor'); assert.equal(h.el('ActorList').value, thirdId); await h.click('RemoveActor'); assert.equal(h.el('ActorList').value, firstId);
  assert.equal(h.el('X').value, '200'); assert.equal(h.el('Actor').value, 'actor'); assert.equal(h.el('RemoveActor').disabled, true);
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); await h.click('RemoveActor'); assert.equal(h.el('ActorList').children.length, 1);
});

test('adding uses the first unused actor key and falls back safely for unfinished or out-of-range positions', async t => {
  const h = await fixture(t); await h.open(); h.set('Actor', 'actor2'); h.set('X', '100000'); h.set('Y', '100000');
  await h.click('AddActor'); assert.equal(h.el('Actor').value, 'actor'); assert.equal(h.el('X').value, '200'); assert.equal(h.el('Y').value, '220');
  h.set('X', '-100000'); h.set('Y', '-100000'); await h.click('AddActor');
  assert.equal(h.el('Actor').value, 'actor3'); assert.equal(h.el('X').value, '-99904'); assert.equal(h.el('Y').value, '-100000');
  h.set('X', '0x10'); await h.click('AddActor'); assert.equal(h.el('X').value, '200'); assert.equal(h.el('Y').value, '220');
});

test('actor controls enforce one through 64 actors without allocating extra identities at the limit', async t => {
  const h = await fixture(t); await h.open();
  for (let count = 1; count < SCENE_COMPOSITION_CREATE_MAX_ACTORS; count++) await h.click('AddActor');
  assert.equal(h.el('ActorList').children.length, 64); assert.equal(h.el('AddActor').disabled, true); assert.equal(h.allocated(), 65);
  await h.click('AddActor'); assert.equal(h.el('ActorList').children.length, 64); assert.equal(h.allocated(), 65);
  await h.click('Review'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.proposals.at(-1).actors.length, 64);
  await h.click('RemoveActor'); assert.equal(h.el('ActorList').children.length, 63); assert.equal(h.el('AddActor').disabled, false);
});

test('missing objects in unselected actors remain labeled and prevent whole-recipe review', async t => {
  const h = await fixture(t); await h.open(); const firstId = h.el('ActorList').value;
  await h.click('AddActor'); const secondId = h.el('ActorList').value; h.set('Object', projectionId, 'change');
  h.set('ActorList', firstId, 'change'); h.catalog.objects.pop(); await h.click('Reload');
  assert.equal(h.el('Object').value, objectId); assert.match(h.el('ActorList').children[1].textContent, /已不可用/);
  await h.click('Review'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('ActorList').children.length, 2);
  h.set('ActorList', secondId, 'change'); assert.equal(h.el('Object').value, projectionId); assert.equal(h.el('Inherit').checked, true);
  h.set('Object', objectId, 'change'); await h.click('Review'); assert.equal(h.el('Apply').disabled, false);
  assert.deepEqual(h.proposals.at(-1).actors.map(actor => actor.instanceId), [firstId, secondId]);
});

test('duplicate keys in any actor reject review until corrected without deleting the actor', async t => {
  const h = await fixture(t); await h.open(); const firstId = h.el('ActorList').value;
  await h.click('AddActor'); const secondId = h.el('ActorList').value; h.set('Actor', 'actor'); h.set('ActorList', firstId, 'change');
  await h.click('Review'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('ActorList').children.length, 2);
  h.set('ActorList', secondId, 'change'); assert.equal(h.el('Actor').value, 'actor'); h.set('Actor', 'second');
  await h.click('Review'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.proposals.at(-1).actors[1].instanceId, secondId);
});

test('dirty cancellation protects all actors including unfinished fields on an unselected actor', async t => {
  let allow = false; const h = await fixture(t, { confirm: () => allow }); await h.open(); const firstId = h.el('ActorList').value;
  await h.click('AddActor'); const secondId = h.el('ActorList').value; h.set('X', '1e'); h.set('ActorList', firstId, 'change');
  await h.click('Cancel'); assert.equal(h.el('Dialog').open, true); assert.equal(h.confirms.length, 1);
  h.set('ActorList', secondId, 'change'); assert.equal(h.el('X').value, '1e'); assert.equal(h.el('ActorList').children.length, 2);
  allow = true; await h.click('Cancel'); assert.equal(h.el('Dialog').open, false); assert.equal(h.calls.length, 0);
});

test('pending handoff locks actor selection and topology along with source fields', async t => {
  const wait = deferred(), h = await fixture(t, { createDraft: () => wait.promise }); await h.open(); const firstId = h.el('ActorList').value;
  await h.click('AddActor'); const secondId = h.el('ActorList').value; await h.click('Review'); await h.click('Apply');
  assert.equal(h.el('ActorList').disabled, true); assert.equal(h.el('AddActor').disabled, true); assert.equal(h.el('RemoveActor').disabled, true);
  h.set('ActorList', firstId, 'change'); assert.equal(h.el('ActorList').value, secondId);
  await h.click('AddActor'); await h.click('RemoveActor'); assert.equal(h.el('ActorList').children.length, 2); assert.equal(h.allocated(), 3);
  wait.resolve(false); await settle(); assert.equal(h.el('ActorList').disabled, false); assert.equal(h.el('Apply').disabled, false);
});

async function layoutFixture(t, settings = {}) {
  const h = await fixture(t, settings); await h.open();
  h.set('X', '0140.00'); h.set('Y', '1.8e2'); await h.click('AddActor');
  h.set('Object', projectionId, 'change'); h.set('X', '340'); h.set('Y', '180'); await h.click('AddActor');
  h.set('X', '220'); h.set('Y', '360');
  const snapshot = () => {
    const selected = h.el('ActorList').value, items = h.el('ActorList').children.map(option => option.value), values = [];
    for (const instanceId of items) {
      h.set('ActorList', instanceId, 'change'); values.push({ instanceId, actorKey: h.el('Actor').value, objectId: h.el('Object').value,
        useProjectionDefaults: h.el('Inherit').checked, position: [h.el('X').value, h.el('Y').value] });
    }
    h.set('ActorList', selected, 'change'); return values;
  };
  const configure = (mode = 'grid') => {
    for (const [field, value] of Object.entries({ LayoutMode: mode, LayoutOriginX: '100', LayoutOriginY: '120', LayoutSpacingX: '150', LayoutSpacingY: '100', LayoutColumns: '2' })) h.set(field, value, field === 'LayoutMode' ? 'change' : 'input');
  };
  return { ...h, snapshot, configure };
}

test('row, column and grid previews show every old and new coordinate without changing authored content', async t => {
  const h = await layoutFixture(t), before = h.snapshot(); await h.click('Review'); const source = h.el('Source').textContent;
  for (const [mode, positions] of Object.entries({ row: [[100, 120], [250, 120], [400, 120]], column: [[100, 120], [100, 220], [100, 320]], grid: [[100, 120], [250, 120], [100, 220]] })) {
    h.configure(mode); await h.click('LayoutReview'); assert.equal(h.el('LayoutPreview').hidden, false); assert.equal(h.el('LayoutApply').disabled, false);
    const lines = h.el('LayoutSource').textContent.split('\n'); assert.equal(lines.length, 3);
    for (const [index, line] of lines.entries()) {
      assert.ok(line.includes(before[index].actorKey)); assert.ok(line.includes(`(${before[index].position.join(', ')})`)); assert.ok(line.includes(`(${positions[index].join(', ')})`));
    }
    assert.deepEqual(h.snapshot(), before); assert.equal(h.el('Source').textContent, source); assert.equal(h.el('Apply').disabled, false); assert.equal(h.calls.length, 0);
  }
  assert.equal(h.requests.length, 1); assert.equal(h.allocated(), 4);
});

test('applying a reviewed layout changes only positions and undo restores exact raw coordinate strings', async t => {
  const h = await layoutFixture(t), before = h.snapshot(), selected = h.el('ActorList').value;
  await h.click('Review'); h.configure(); await h.click('LayoutReview'); await h.click('LayoutApply');
  const after = h.snapshot(); assert.deepEqual(after.map(actor => actor.position), [['100', '120'], ['250', '120'], ['100', '220']]);
  assert.deepEqual(after.map(({ position, ...actor }) => actor), before.map(({ position, ...actor }) => actor));
  assert.equal(h.el('ActorList').value, selected); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Preview').hidden, true);
  assert.equal(h.el('LayoutUndo').disabled, false); assert.equal(h.el('LayoutApply').disabled, true); assert.equal(h.el('LayoutPreview').hidden, true);
  await h.click('Review'); assert.equal(h.el('Apply').disabled, false); await h.click('LayoutUndo');
  assert.deepEqual(h.snapshot(), before); assert.equal(h.el('X').value, '220'); assert.equal(h.el('ActorList').value, selected);
  assert.equal(h.el('LayoutUndo').disabled, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0);
  await h.click('Review'); assert.deepEqual(h.proposals.at(-1).actors.map(actor => actor.position), [[140, 180], [340, 180], [220, 360]]);
});

test('actor selection and language changes preserve layout preview and the exact undo opportunity', async t => {
  const h = await layoutFixture(t), before = h.snapshot(); h.configure(); await h.click('LayoutReview');
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); h.set('ActorList', before[0].instanceId, 'change'); assert.equal(h.el('LayoutPreview').hidden, false);
    assert.equal(h.el('LayoutApply').disabled, false); assert.equal(h.el('LayoutSource').textContent.split('\n').length, 3);
    h.set('ActorList', before[2].instanceId, 'change'); assert.equal(h.el('LayoutApply').disabled, false);
  }
  await h.click('LayoutApply');
  for (const language of ['ja', 'en', 'zh']) { h.language(language); h.set('ActorList', before[0].instanceId, 'change'); assert.equal(h.el('LayoutUndo').disabled, false); }
  await h.click('LayoutUndo'); assert.deepEqual(h.snapshot(), before); assert.equal(h.allocated(), 4);
});

test('editing layout settings clears only the layout preview and preserves source review and existing undo', async t => {
  const h = await layoutFixture(t); h.configure(); await h.click('LayoutReview'); await h.click('LayoutApply'); await h.click('Review');
  const source = h.el('Source').textContent;
  await h.click('LayoutReview'); h.set('LayoutSpacingX', '170');
  assert.equal(h.el('LayoutPreview').hidden, true); assert.equal(h.el('LayoutApply').disabled, true); assert.equal(h.el('LayoutUndo').disabled, false);
  assert.equal(h.el('Source').textContent, source); assert.equal(h.el('Apply').disabled, false);
  await h.click('LayoutUndo'); assert.equal(h.el('LayoutSpacingX').value, '170'); assert.equal(h.el('Preview').hidden, true);
});

test('unchanged layout disables apply without replacing an existing undo snapshot', async t => {
  const h = await layoutFixture(t), before = h.snapshot(); h.configure(); await h.click('LayoutReview'); await h.click('LayoutApply');
  const after = h.snapshot(); await h.click('Review'); const source = h.el('Source').textContent;
  await h.click('LayoutReview'); assert.equal(h.el('LayoutApply').disabled, true); assert.match(h.el('LayoutStatus').textContent, /无需应用/);
  assert.equal(h.el('LayoutUndo').disabled, false); await h.click('LayoutApply'); assert.deepEqual(h.snapshot(), after);
  assert.equal(h.el('Source').textContent, source); assert.equal(h.el('Apply').disabled, false);
  await h.click('LayoutUndo'); assert.deepEqual(h.snapshot(), before);
});

test('author changes including fields on other actors invalidate both layout preview and undo', async t => {
  for (const [selectFirst, change] of [[true, h => h.set('Name', 'Renamed')], [true, h => h.set('Path', 'documents/changed.json')], [false, h => h.set('Object', objectId, 'change')],
    [true, h => h.set('Actor', 'renamed')], [true, h => h.set('X', '99')], [true, async h => h.click('AddActor')], [true, async h => h.click('RemoveActor')]]) {
    const h = await layoutFixture(t); h.configure(); await h.click('LayoutReview'); await h.click('LayoutApply');
    h.set('LayoutMode', 'column', 'change'); await h.click('LayoutReview'); assert.equal(h.el('LayoutApply').disabled, false); assert.equal(h.el('LayoutUndo').disabled, false);
    const firstId = h.el('ActorList').children[0].value;
    if (selectFirst) h.set('ActorList', firstId, 'change');
    await change(h); assert.equal(h.el('LayoutPreview').hidden, true); assert.equal(h.el('LayoutApply').disabled, true); assert.equal(h.el('LayoutUndo').disabled, true);
  }
});

test('silent actor, common field or layout setting changes cannot apply stale positions', async t => {
  for (const [field, value] of [['X', '999'], ['Name', 'Silent rename'], ['LayoutOriginX', '999']]) {
    const h = await layoutFixture(t); h.configure(); await h.click('LayoutReview'); h.set(field, value, null);
    const currentX = h.el('X').value; await h.click('LayoutApply'); assert.equal(h.el('X').value, currentX);
    assert.equal(h.el('LayoutPreview').hidden, true); assert.equal(h.el('LayoutApply').disabled, true); assert.equal(h.el('LayoutUndo').disabled, true);
  }
  const h = await layoutFixture(t); h.configure(); await h.click('LayoutReview'); await h.click('LayoutApply');
  h.set('X', '777', null); await h.click('LayoutUndo'); assert.equal(h.el('X').value, '777'); assert.equal(h.el('LayoutUndo').disabled, true);
});

test('unfinished coordinates and invalid or overflowing layout settings reject the entire preview', async t => {
  const h = await layoutFixture(t); h.configure();
  for (const [field, value, reset] of [['X', '-', '220'], ['Y', '1e', '360'], ['LayoutOriginX', '100000', '100'],
    ['LayoutSpacingX', '0', '150'], ['LayoutSpacingY', '-1', '100'], ['LayoutColumns', '0', '2'], ['LayoutColumns', '1.5', '2'],
    ['LayoutColumns', '65', '2'], ['LayoutOriginY', 'NaN', '120']]) {
    h.set(field, value); const before = h.snapshot(); await h.click('LayoutReview');
    assert.equal(h.el('LayoutPreview').hidden, true, `${field}: ${value}`); assert.equal(h.el('LayoutApply').disabled, true);
    assert.match(h.el('LayoutStatus').textContent, /无法预览/); assert.deepEqual(h.snapshot(), before); h.set(field, reset);
  }
  h.set('ActorList', h.el('ActorList').children[0].value, 'change'); h.set('X', '-');
  h.set('ActorList', h.el('ActorList').children[2].value, 'change'); await h.click('LayoutReview'); assert.equal(h.el('LayoutApply').disabled, true);
});

test('layout-only settings participate in cancellation confirmation without making the source dirty', async t => {
  let allow = false; const h = await fixture(t, { confirm: () => allow }); await h.open(); await h.click('Review');
  const source = h.el('Source').textContent; h.set('LayoutOriginX', '-'); assert.equal(h.el('Dialog').dataset.dirty, 'true');
  assert.equal(h.el('Source').textContent, source); assert.equal(h.el('Apply').disabled, false);
  await h.click('Cancel'); assert.equal(h.confirms.length, 1); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('LayoutOriginX').value, '-');
  allow = true; await h.click('Cancel'); assert.equal(h.el('Dialog').open, false); assert.equal(h.calls.length, 0);
});

test('layout actions are disabled while catalog loading, handing off or after owner invalidation', async t => {
  const loading = deferred(); let catalog;
  const h = await fixture(t, { fetch: () => loading.promise }); catalog = h.catalog; h.controller.open();
  for (const field of ['LayoutMode', 'LayoutOriginX', 'LayoutColumns', 'LayoutReview', 'LayoutApply', 'LayoutUndo']) assert.equal(h.el(field).disabled, true);
  loading.resolve(catalog); await settle(); assert.equal(h.el('LayoutReview').disabled, false);
  h.context.busy = true; h.controller.refresh(); h.context.busy = false; h.controller.refresh();
  for (const field of ['LayoutMode', 'LayoutReview', 'LayoutApply', 'LayoutUndo']) assert.equal(h.el(field).disabled, true);
  const wait = deferred(), pending = await layoutFixture(t, { createDraft: () => wait.promise });
  pending.configure(); await pending.click('LayoutReview'); await pending.click('LayoutApply'); await pending.click('Review'); await pending.click('Apply');
  for (const field of ['LayoutOriginY', 'LayoutSpacingX', 'LayoutReview', 'LayoutApply', 'LayoutUndo']) assert.equal(pending.el(field).disabled, true);
  wait.resolve(false); await settle(); assert.equal(pending.el('LayoutReview').disabled, false); assert.equal(pending.el('LayoutUndo').disabled, false);
});

test('applying a second layout offers one undo to the immediately preceding coordinates', async t => {
  const h = await layoutFixture(t); h.configure('row'); await h.click('LayoutReview'); await h.click('LayoutApply'); const row = h.snapshot();
  h.configure('column'); await h.click('LayoutReview'); await h.click('LayoutApply'); const column = h.snapshot(); assert.notDeepEqual(column, row);
  await h.click('LayoutUndo'); assert.deepEqual(h.snapshot(), row); assert.equal(h.el('LayoutUndo').disabled, true);
  await h.click('LayoutUndo'); assert.deepEqual(h.snapshot(), row);
});
