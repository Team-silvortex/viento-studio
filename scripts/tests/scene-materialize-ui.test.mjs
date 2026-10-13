import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { buildSceneCompositionMaterializationCommand } from '../../engine/scene-composition-materialize.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const recipeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const previewId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', instanceId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const imageId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', groupId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const revision = value => 'sha256:' + value.repeat(64), recipeText = '\ufeff{"savedRecipe":true}\r\n';
const scene = { format: 'viento-scene2d', schemaVersion: 3, title: 'Two parties', viewport: [800, 480], background: '#101010',
  groups: [{ groupId, name: 'Party' }], actors: [{ instanceId, objectId: actorId, groupId, position: [120, 180], size: [40, 50],
    color: '#ffffff', speed: 120, controls: 'arrows', imageResourceId: imageId }] };
const recordFor = request => ({ format: 'viento-document', version: 1, id: request.objectId, documentType: request.documentType,
  sourcePath: request.sourcePath, parserProfile: 'structured', relations: [{ kind: 'references', targetId: actorId, slot: '' }],
  assetBindings: [{ assetId: imageId, role: 'image' }] });
const objectFor = request => ({ id: request.objectId, revision: revision('f'), provenance: { documentType: request.documentType, descriptor: recordFor(request), identity: 'registered' },
  documentRefs: [{ sourcePath: request.sourcePath, sourceRevision: hash(request.content) }] });
const resultFor = request => {
  const input = structuredClone(request); delete input.mode;
  return { status: request.mode === 'apply' ? 'applied' : 'preview', worldId: request.worldId, baseRevision: request.baseRevision, revision: revision('e'),
    object: objectFor(request), changes: [{ kind: 'scene.create', objectId: request.objectId, sourcePath: request.sourcePath,
      beforeText: null, beforeSourceRevision: null, afterText: request.content, afterSourceRevision: hash(request.content),
      recordPath: `metadata/documents/${request.objectId}.json`, record: recordFor(request) }], proposal: { commands: [{ id: 'scene.create', input }] } };
};
async function settle(check, label) {
  for (let count = 0; count < 100; count++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
  assert.fail(label || 'Asynchronous dialog did not settle');
}
async function fixture(t, options = {}) {
  const documentRoot = options.version === 2 ? 'design-data' : 'documents', sourcePath = `${documentRoot}/recipes/parties.json`;
  const current = { editable: true, dirty: false, creating: false, busy: false, session: 'session-1', recipeId, sourceToken: 'source-1', visible: true };
  let language = 'zh', translate = () => {}, subscriptions = 0;
  let projection = { world: { id: 'world-a', revision: revision('a'), sourceWorkspaceVersion: options.version || 3 }, resources: [{ id: imageId }],
    objects: [{ id: recipeId, documentRefs: [{ sourcePath, sourceRevision: hash(recipeText) }] }] };
  const reads = [], calls = [], busy = [], completions = [], seeds = [], sources = new Map([[sourcePath, recipeText]]);
  const h = await dialogHarness('app-scene-materialize', {
    crypto: webcrypto,
    API_PATHS: { DOC: '/api/doc' },
    createSceneCompositionMaterialization: async input => {
      seeds.push(structuredClone(input));
      if (options.coreError) throw options.coreError;
      const value = { format: 'viento-scene-composition-materialization', schemaVersion: 1, worldId: input.projection.world.id,
        baseRevision: input.projection.world.revision, recipe: { objectId: recipeId, sourcePath, sourceRevision: hash(recipeText), documentType: 'notes', title: scene.title },
        content: JSON.stringify(scene, null, 2) + '\n', scene: structuredClone(scene), documentRoot, documentTypes: [{ id: 'notes', label: 'General notes' }],
        existingIdentities: [recipeId, actorId, imageId], existingPaths: [sourcePath] };
      return value;
    },
    buildSceneCompositionMaterializationCommand: (seed, input) => buildSceneCompositionMaterializationCommand(structuredClone(seed), structuredClone(input)),
    readDocSource: async value => { reads.push(['source', value.pathValue]); return { content: sources.get(value.pathValue) }; },
    fetchJsonApiRequest: async (url, request = {}) => {
      reads.push([request.method || 'GET', url, request.body]);
      if (options.fetch) { const value = await options.fetch(url, request); if (value !== undefined) return value; }
      if (url === '/api/world') return { payload: structuredClone(projection) };
      if (request.method === 'DELETE') return { payload: { ok: true } };
      return { payload: { previewId, ok: true } };
    },
    requestWorldCommand: request => {
      const pending = deferred(); calls.push({ request: structuredClone(request), ...pending }); return pending.promise;
    },
    t: (key, ...values) => String(({ en, ja }[language]?.[key] || key)).replace(/\{(\d+)\}/g, (_, index) => values[index]),
    translatePage: root => {
      for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = { en, ja }[language]?.[element.dataset.i18n] || element.dataset.i18n;
    },
    onLanguageChange(fn) { translate = fn; subscriptions++; return () => { subscriptions--; translate = () => {}; }; },
  });
  const controller = h.runtime.setupSceneMaterialize({ getContext: () => current, setBusy: value => busy.push(value),
    applied: async value => { completions.push(value); await options.applied?.(value, current); } });
  t.after(() => controller.dispose()); controller.setAvailable(true);
  const el = suffix => h.element('sceneMaterialize' + suffix);
  const open = async () => { assert.equal(controller.open(recipeId), true); await settle(() => el('Dialog').getAttribute('aria-busy') === 'false', 'initial read'); };
  if (options.open !== false) await open();
  return { ...h, controller, current, reads, calls, busy, completions, seeds, sources, sourcePath, el, open,
    projection: () => projection, setProjection(value) { projection = value; },
    language(value) { language = value; translate(); }, subscriptions: () => subscriptions,
    fill(key, value) { el(key).value = value; el(key).dispatch(key === 'Type' ? 'change' : 'input'); },
    async check() { const count = calls.length; el('Check').click(); await settle(() => calls.length > count, 'preview command'); const call = calls.at(-1); call.resolve(resultFor(call.request)); await settle(() => el('Dialog').getAttribute('aria-busy') === 'false', 'preview completion'); return call.request; },
    async save(result) { const count = calls.length; el('Save').click(); await settle(() => calls.length > count, 'apply command'); const call = calls.at(-1); call.resolve(result || resultFor(call.request)); await settle(() => el('Dialog').getAttribute('aria-busy') === 'false', 'save completion'); return call.request; },
    publish(request, mutate = () => {}) { const object = objectFor(request); mutate(object); projection.objects.push(object); projection.world.revision = revision('e'); sources.set(request.sourcePath, request.content); },
  };
}

test('opening brackets the saved recipe and preview with World reads, releases preview and performs no author command', async t => {
  const h = await fixture(t);
  assert.deepEqual(h.reads.map(item => item.slice(0, 2)), [['GET', '/api/world'], ['source', h.sourcePath], ['POST', '/api/scene-preview'], ['GET', '/api/world'], ['DELETE', `/api/scene-preview?previewId=${previewId}`]]);
  assert.deepEqual(JSON.parse(h.reads[2][2]), { sceneId: recipeId }); assert.equal(h.seeds[0].content, recipeText);
  assert.deepEqual(h.seeds[0].confirmedWorld, { id: 'world-a', revision: revision('a') }); assert.equal(h.calls.length, 0);
  assert.equal(h.el('Save').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.el('Type').value, 'notes');
  assert.match(h.el('Recipe').textContent, /recipes\/parties.json/); assert.match(h.el('Recipe').textContent, /sha256:/);
});

test('v2 and v3 destinations use existing types and require explicit preview then byte-identical apply', async t => {
  for (const version of [2, 3]) {
    const h = await fixture(t, { version }); assert.equal(h.el('Path').value, `${version === 2 ? 'design-data' : 'documents'}/scenes/materialized-scene.json`);
    h.fill('Name', 'Independent harbor'); const checked = await h.check(); assert.equal(checked.command, 'scene.create');
    assert.equal(checked.documentType, 'notes'); assert.equal(JSON.parse(checked.content).title, 'Independent harbor');
    assert.equal(h.el('Source').textContent, checked.content); assert.match(h.el('Summary').textContent, /1 个实例.*1 个分组/);
    const saved = await h.save(); assert.deepEqual({ ...saved, mode: 'preview' }, checked); assert.equal(h.completions.length, 1);
    assert.equal(h.el('Save').disabled, true); assert.equal(h.el('Cancel').hidden, true); assert.equal(h.el('Close').textContent, '返回构建');
    assert.equal(h.el('Source').textContent, checked.content); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Dialog').dataset.dirty, 'false');
  }
});

test('changing fields invalidates review, preserves draft identity and requires a fresh explicit preview', async t => {
  const h = await fixture(t), first = await h.check(); h.fill('Name', 'Updated'); assert.equal(h.el('Save').disabled, true);
  h.el('Save').dispatch('click'); assert.equal(h.calls.length, 1); const next = await h.check(); assert.equal(first.objectId, next.objectId);
  assert.equal(JSON.parse(next.content).title, 'Updated'); h.el('Path').value = 'documents/scenes/programmatic.json';
  h.el('Save').dispatch('click'); assert.equal(h.calls.length, 2); assert.equal(h.el('Save').disabled, true);
});

test('unsafe destination, wrong document type and empty title never reach author commands', async t => {
  const h = await fixture(t);
  for (const path of ['documents/../outside.json', 'documents/recipes/parties.json', 'documents/SCENES/../bad.json', 'documents/new.yaml']) {
    h.fill('Path', path); h.el('Check').click(); assert.equal(h.calls.length, 0, path);
  }
  h.fill('Path', 'documents/scenes/valid.json'); h.fill('Type', 'missing'); h.el('Check').click(); assert.equal(h.calls.length, 0);
  h.fill('Type', 'notes'); h.fill('Name', ''); h.el('Check').click(); assert.equal(h.calls.length, 0);
});

test('cancel and Escape retain dirty settings when declined and never write after confirmed discard', async t => {
  const h = await fixture(t); h.fill('Name', 'Keep'); await h.check(); h.runtime.window.confirm = () => false;
  h.el('Cancel').click(); h.el('Dialog').dispatch('cancel'); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Name').value, 'Keep');
  h.runtime.window.confirm = () => true; h.el('Close').click(); await flushDialogs();
  assert.equal(h.el('Dialog').open, false); assert.equal(h.calls.length, 1); assert.equal(h.el('Dialog').dataset.dirty, 'false');
  assert.equal(h.el('Dialog').dispatch('keydown', { key: 's', ctrlKey: true }).defaultPrevented, true);
});

test('busy operations block duplicate clicks, field mutation, cancellation and overlapping opens', async t => {
  const h = await fixture(t); h.el('Check').click(); await settle(() => h.calls.length === 1);
  h.el('Check').dispatch('click'); h.el('Save').dispatch('click'); h.el('Close').dispatch('click');
  assert.equal(h.calls.length, 1); assert.equal(h.controller.open(recipeId), false); assert.equal(h.el('Dialog').open, true);
  assert.equal(h.el('Name').disabled, true); h.calls[0].resolve(resultFor(h.calls[0].request)); await settle(() => !h.el('Save').disabled);
});

test('editor dirty, busy, unavailable and changed ownership contexts prevent save even after review', async t => {
  const changes = [h => h.current.dirty = true, h => h.current.creating = true, h => h.current.busy = true,
    h => h.current.visible = false, h => h.current.session = 'new', h => h.current.sourceToken = 'new',
    h => h.current.recipeId = actorId, h => h.controller.setAvailable(false)];
  for (const change of changes) {
    const h = await fixture(t); await h.check(); change(h); h.controller.refresh(); h.el('Save').dispatch('click');
    assert.equal(h.calls.length, 1); assert.equal(h.el('Save').disabled, true);
  }
});

test('closing the dialog externally during a late read cannot restore it or retain preview resources', async t => {
  const pending = deferred();
  const h = await fixture(t, { open: false, fetch: async (url, request) => url === '/api/scene-preview' && request.method === 'POST' ? pending.promise : undefined });
  assert.equal(h.controller.open(recipeId), true); await settle(() => h.reads.some(item => item[0] === 'POST'));
  h.el('Dialog').close(); await flushDialogs(); pending.resolve({ payload: { ok: true, previewId } });
  await settle(() => h.busy.at(-1) === false); assert.equal(h.el('Dialog').open, false); assert.equal(h.seeds.length, 0);
  assert.equal(h.reads.at(-1)[0], 'DELETE'); assert.equal(h.calls.length, 0);
});

test('late preview receipts after a session change never enable saving', async t => {
  const h = await fixture(t); h.el('Check').click(); await settle(() => h.calls.length === 1); h.current.session = 'changed'; h.controller.refresh();
  h.calls[0].resolve(resultFor(h.calls[0].request)); await settle(() => h.busy.at(-1) === false);
  assert.equal(h.el('Review').hidden, true); assert.equal(h.el('Save').disabled, true); assert.equal(h.completions.length, 0);
});

test('World conflicts preserve destination fields and re-read before reviewing with the new revision', async t => {
  const h = await fixture(t); h.fill('Name', 'Retained'); await h.check(); const id = h.calls[0].request.objectId;
  h.el('Save').click(); await settle(() => h.calls.length === 2); h.calls[1].reject(Object.assign(new Error('stale World'), { errorCode: 'world_revision_conflict' }));
  await settle(() => h.busy.at(-1) === false); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Name').value, 'Retained');
  h.projection().world.revision = revision('b'); h.el('Refresh').click(); await settle(() => !h.el('Check').disabled);
  const next = await h.check(); assert.equal(next.objectId, id); assert.equal(next.baseRevision, revision('b'));
});

test('unknown apply outcome locks duplicate writes until a read confirms no destination was published', async t => {
  const h = await fixture(t); const checked = await h.check(); h.el('Save').click(); await settle(() => h.calls.length === 2);
  h.calls[1].reject(new Error('connection lost')); await settle(() => h.busy.at(-1) === false);
  assert.equal(h.el('Check').disabled, true); h.el('Save').dispatch('click'); assert.equal(h.calls.length, 2);
  h.el('Refresh').click(); await settle(() => !h.el('Check').disabled);
  const retry = await h.check(); assert.equal(retry.objectId, checked.objectId); assert.equal(h.calls.length, 3);
});

test('unknown apply outcome reconciles exact saved bytes and dependency metadata read-only', async t => {
  const h = await fixture(t); await h.check(); h.el('Save').click(); await settle(() => h.calls.length === 2);
  const request = h.calls[1].request; h.publish(request); h.calls[1].reject(new Error('lost receipt')); await settle(() => h.busy.at(-1) === false);
  h.el('Refresh').click(); await settle(() => h.completions.length === 1 && h.busy.at(-1) === false);
  assert.equal(h.calls.length, 2); assert.equal(h.el('Save').disabled, true); assert.match(h.el('Status').textContent, /已核对/);
  assert.equal(h.el('Source').textContent, request.content);
});

test('mismatching saved source or metadata never unlocks an uncertain apply', async t => {
  for (const kind of ['source', 'metadata', 'path']) {
    const h = await fixture(t); await h.check(); h.el('Save').click(); await settle(() => h.calls.length === 2); const request = h.calls[1].request;
    h.publish(request, object => { if (kind === 'metadata') object.provenance.descriptor.relations = []; if (kind === 'path') object.documentRefs[0].sourcePath = 'documents/other.json'; });
    if (kind === 'source') h.sources.set(request.sourcePath, request.content + ' ');
    h.calls[1].reject(new Error('lost receipt')); await settle(() => h.busy.at(-1) === false); h.el('Refresh').click(); await settle(() => h.busy.at(-1) === false);
    assert.equal(h.el('Check').disabled, true); assert.equal(h.completions.length, 0); h.el('Save').dispatch('click'); assert.equal(h.calls.length, 2);
  }
});

test('closing an uncertain operation retains its identity and forces read-only reconciliation on reopening', async t => {
  const h = await fixture(t); await h.check(); h.el('Save').click(); await settle(() => h.calls.length === 2); const request = h.calls[1].request;
  h.publish(request); h.calls[1].reject(new Error('lost receipt')); await settle(() => h.busy.at(-1) === false);
  h.el('Close').click(); await flushDialogs(); h.current.recipeId = actorId; assert.equal(h.controller.open(actorId), false);
  h.current.recipeId = recipeId; await h.open(); assert.equal(h.completions.length, 1); assert.equal(h.calls.length, 2); assert.equal(h.el('Save').disabled, true);
});

test('mismatched preview or apply receipts reject source, identities and dependency changes', async t => {
  const variants = [value => value.changes[0].afterText += ' ', value => value.changes[0].record.assetBindings = [],
    value => value.object.id = actorId, value => value.proposal.commands[0].input.documentType = 'other'];
  for (const mutate of variants) {
    const h = await fixture(t); h.el('Check').click(); await settle(() => h.calls.length === 1);
    const value = resultFor(h.calls[0].request); mutate(value); h.calls[0].resolve(value); await settle(() => h.busy.at(-1) === false);
    assert.equal(h.el('Save').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.completions.length, 0);
  }
  const h = await fixture(t); await h.check(); h.el('Save').click(); await settle(() => h.calls.length === 2);
  const value = resultFor(h.calls[1].request); value.changes[0].record.relations = []; h.calls[1].resolve(value); await settle(() => h.busy.at(-1) === false);
  assert.equal(h.el('Check').disabled, true); assert.equal(h.completions.length, 0);
});

test('successful apply can change host tab and selection without invalidating saved review or causing a second write', async t => {
  const h = await fixture(t, { applied: async (_result, current) => { current.visible = false; current.recipeId = actorId; } });
  await h.check(); const request = await h.save(); h.controller.refresh();
  assert.equal(h.completions.length, 1); assert.equal(h.el('Source').textContent, request.content); assert.equal(h.el('Close').disabled, false);
  assert.equal(h.el('Close').textContent, '返回构建'); h.el('Save').dispatch('click'); assert.equal(h.calls.length, 2);
});

test('failed post-save refresh leaves the scene marked saved and cannot replay the transaction', async t => {
  const h = await fixture(t, { applied: async () => { throw new Error('catalog failed'); } }); await h.check(); await h.save();
  assert.match(h.el('Status').textContent, /已保存.*刷新失败/); assert.equal(h.el('Save').disabled, true);
  h.el('Check').dispatch('click'); h.el('Save').dispatch('click'); assert.equal(h.calls.length, 2); assert.equal(h.el('Dialog').dataset.dirty, 'false');
});

test('language changes preserve field nodes, selection, full review and submission identity', async t => {
  const h = await fixture(t); h.fill('Name', '作者场景🦊'); const request = await h.check(), field = h.el('Name');
  field.focus(); field.selectionStart = 1; field.selectionEnd = 4;
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.el('Name'), field); assert.equal(h.document.activeElement, field);
    assert.deepEqual([field.selectionStart, field.selectionEnd], [1, 4]); assert.equal(h.el('Source').textContent, request.content);
    assert.equal(h.el('Save').disabled, false); assert.equal(h.el('Name').value, '作者场景🦊');
  }
});

test('core rejection releases the preview and keeps authoring disabled without inventing a scene', async t => {
  const h = await fixture(t, { coreError: Object.assign(new Error('source changed'), { errorCode: 'scene_composition_materialize_conflict' }) });
  assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Save').disabled, true); assert.equal(h.el('Source').textContent, '');
  assert.equal(h.reads.at(-1)[0], 'DELETE'); assert.match(h.el('Status').textContent, /配方或工程已变化/); assert.equal(h.calls.length, 0);
});

test('dispose releases host busy state and ignores delayed responses without calling completion', async t => {
  const h = await fixture(t); h.el('Check').click(); await settle(() => h.calls.length === 1); h.controller.dispose();
  assert.equal(h.busy.at(-1), false); assert.equal(h.subscriptions(), 0); h.calls[0].resolve(resultFor(h.calls[0].request)); await flushDialogs();
  assert.equal(h.completions.length, 0); assert.equal(h.controller.open(recipeId), false);
});
