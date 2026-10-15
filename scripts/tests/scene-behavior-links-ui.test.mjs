import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { captureSceneBehaviorDirectory, createBehaviorScriptLinkRequest, validateBehaviorScriptLinkResult } from '../../engine/scene-behavior-directory.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const copy = value => JSON.parse(JSON.stringify(value));
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const hash = n => n.toString(16).padStart(64, '0');
const revision = n => `sha256:${hash(n)}`;
const endpoint = (n, sourcePath) => ({ objectId: id(n), objectRevision: revision(n), sourcePath, sourceRevision: revision(n + 100) });
const directory = () => ({ format: 'viento-scene-behavior-directory', schemaVersion: 1, status: 'ready', worldId: `world:${hash(1)}`,
  baseRevision: revision(50), documentRoot: 'documents', scene: endpoint(1, 'documents/scenes/demo.json'),
  manifest: { ...endpoint(2, 'documents/behaviors/demo.json'), bindingCount: 2 }, sources: [
    { ...endpoint(3, 'documents/scripts/used.txt'), name: 'Used script', linked: true, usedByBindingIds: [id(100), id(101)] },
    { ...endpoint(4, 'documents/scripts/new.txt'), name: 'New script', linked: false, usedByBindingIds: [] },
    { ...endpoint(5, 'documents/scripts/available.txt'), name: 'Available script', linked: true, usedByBindingIds: [] },
    { ...endpoint(6, 'documents/scripts/second.txt'), name: 'Second script', linked: false, usedByBindingIds: [] },
  ] });
const emptyDirectory = () => ({ ...directory(), status: 'empty', manifest: null, sources: [] });
function resultFor(request, catalog = directory()) {
  const target = catalog.sources.find(source => source.objectId === request.targetObjectId), { mode, ...input } = request;
  const relation = { kind: 'references', targetId: target.objectId, slot: '' };
  const value = { status: mode === 'apply' ? 'applied' : 'preview', worldId: request.worldId, baseRevision: request.baseRevision, revision: revision(51),
    proposal: { format: 'viento-changeset', schemaVersion: 1, id: `proposal:${hash(30)}`, worldId: request.worldId,
      actorRef: copy(request.actorRef), baseRevision: request.baseRevision, commands: [{ id: 'relation.add', input }],
      preconditions: [{ objectId: request.objectId, revision: request.objectRevision }, { objectId: request.targetObjectId, revision: request.targetRevision }],
      affectedObjects: [request.objectId, request.targetObjectId], state: 'proposed' },
    changes: [{ kind: 'relation.add', objectId: request.objectId, sourcePath: catalog.manifest.sourcePath, targetObjectId: target.objectId,
      targetSourcePath: target.sourcePath, recordPath: `metadata/documents/${request.objectId}.json`, relation,
      beforeRecordRevision: revision(60), afterRecordRevision: revision(61) }],
    relation: { id: `relation:${hash(40)}`, worldId: request.worldId, sourceObjectId: request.objectId,
      targetObjectId: request.targetObjectId, typeRef: 'io.viento.relation/references', properties: copy(relation) } };
  if (mode === 'apply') value.receipt = { format: 'viento-transaction-receipt', schemaVersion: 1, transactionId: id(90), worldId: request.worldId,
    proposalId: value.proposal.id, baseRevision: request.baseRevision, revision: value.revision, state: 'committed' };
  return value;
}
async function settle() { for (let i = 0; i < 3; i++) await flushDialogs(); }
async function harness(options = {}) {
  let catalog = options.catalog || directory(), locale = 'zh-CN'; const languages = [], requests = [], reads = [], applied = [], opened = [], busy = [];
  const context = { editable: true, dirty: false, creating: false, busy: false, visible: true, session: '1', sceneId: id(1), sourceToken: 'source-1', ...options.context };
  const h = await dialogHarness('app-scene-behavior-links', {
    captureSceneBehaviorDirectory: (value, sceneId) => captureSceneBehaviorDirectory(copy(value), sceneId),
    createBehaviorScriptLinkRequest: (value, sourceId, mode) => createBehaviorScriptLinkRequest(copy(value), sourceId, mode),
    validateBehaviorScriptLinkResult: (value, request, valueCatalog) => validateBehaviorScriptLinkResult(copy(value), copy(request), copy(valueCatalog)),
    t: (key, ...args) => (locale === 'en' ? en[key] || key : locale === 'ja' ? ja[key] || key : key).replace(/\{(\d+)\}/g, (_, i) => String(args[i])),
    onLanguageChange: listener => { languages.push(listener); return () => languages.splice(languages.indexOf(listener), 1); },
  });
  const controller = h.runtime.setupSceneBehaviorLinks({ getContext: () => context, setBusy: value => busy.push(value),
    inspect: payload => { reads.push(copy(payload)); return options.inspect ? options.inspect(payload, copy(catalog)) : Promise.resolve(copy(catalog)); },
    command: request => { const pending = deferred(); requests.push({ request: copy(request), ...pending }); return pending.promise; },
    applied: async (result, info) => { applied.push({ result: result && copy(result), info: info && copy(info) }); await options.applied?.(result, info); },
    openSource: async (path, info) => { opened.push({ path, info }); return options.openSource ? options.openSource(path, info) : true; },
  });
  controller.setAvailable(options.enabled !== false, options.commands || ['relation.add']);
  const el = suffix => h.element('sceneBehaviorLinks' + suffix);
  const click = suffix => el(suffix).click();
  const select = (value, event = 'change') => { el('Source').value = value; el('Source').dispatch(event); };
  const open = async () => { const result = controller.open(context.sceneId); await settle(); return result; };
  const review = async (sourceId = id(4)) => { select(sourceId); click('Check'); await settle(); const pending = requests.at(-1); assert.ok(pending); pending.resolve(resultFor(pending.request, catalog)); await settle(); };
  const markLinked = (sourceId = id(4)) => { catalog = copy(catalog); catalog.baseRevision = revision(51); catalog.sources.find(source => source.objectId === sourceId).linked = true; };
  const save = async () => { click('Save'); await settle(); const pending = requests.at(-1); assert.equal(pending.request.mode, 'apply'); markLinked(pending.request.targetObjectId); pending.resolve(resultFor(pending.request, catalog)); await settle(); };
  return { ...h, el, controller, context, requests, reads, applied, opened, busy, click, select, open, review, save, markLinked,
    setCatalog: value => { catalog = value; }, setLanguage: value => { locale = value; languages.forEach(fn => fn()); } };
}

test('capability and clean scene ownership guard initial reads, while a read-only host may view the directory', async () => {
  for (const context of [{ editable: false }, { dirty: true }, { creating: true }, { busy: true }, { visible: false }, { session: undefined }]) {
    const h = await harness({ context }); assert.equal(await h.open(), false); assert.equal(h.reads.length, 0);
  }
  const disabled = await harness({ enabled: false }); assert.equal(await disabled.open(), false);
  const h = await harness({ commands: [] }); assert.equal(h.controller.open(id(2)), false); assert.equal(await h.open(), true);
  assert.deepEqual(h.reads, [{ sceneObjectId: id(1) }]); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Open').disabled, false);
});

test('empty directory provides a creation route without changing metadata or source', async () => {
  const h = await harness({ catalog: emptyDirectory() }); await h.open(); assert.equal(h.el('Empty').hidden, false); assert.equal(h.el('Ready').hidden, true);
  for (const control of ['Check', 'Save', 'Open']) { assert.equal(h.el(control).disabled, true); h.click(control); }
  assert.equal(h.requests.length, 0); assert.equal(h.opened.length, 0); assert.equal(h.el('Dialog').dataset.dirty, 'false');
});

test('linked scripts distinguish used bindings from only available sources and are excluded from choices', async () => {
  const h = await harness(); await h.open(); assert.match(h.el('Manifest').textContent, /documents\/behaviors\/demo.json.*2/);
  assert.deepEqual(h.el('Scripts').children.map(item => item.dataset.usage), ['used', 'available']);
  assert.match(h.el('Scripts').children[0].textContent, /2/); assert.match(h.el('Scripts').children[1].textContent, /尚无绑定/);
  assert.deepEqual(h.el('Source').children.map(item => item.value), ['', id(4), id(6)]);
  assert.equal(h.el('Source').value, ''); assert.equal(h.el('Check').disabled, true);
});

test('review delegates the exact metadata-only reference and renders all endpoints without writing', async () => {
  const h = await harness(); await h.open(); await h.review();
  assert.deepEqual(h.requests[0].request, createBehaviorScriptLinkRequest(directory(), id(4)));
  assert.equal(h.el('Relations').children.length, 1); assert.match(h.el('Relations').textContent, /demo.json.*references.*new.txt/);
  assert.equal(h.el('Save').disabled, false); assert.equal(h.applied.length, 0); assert.equal(h.el('Dialog').dataset.dirty, 'true');
});

test('apply uses the reviewed endpoints, refreshes the host and directory, and marks the script available without binding it', async () => {
  let h; h = await harness({ applied: async () => { h.context.sourceToken = 'own-refresh'; } }); await h.open(); await h.review(); const request = h.requests[0].request;
  h.click('Save'); await settle(); h.click('Save'); h.click('Close'); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Dialog').getAttribute('aria-busy'), 'true');
  assert.deepEqual(h.requests[1].request, { ...request, mode: 'apply' }); h.markLinked(); h.requests[1].resolve(resultFor(h.requests[1].request)); await settle();
  assert.equal(h.applied.length, 1); assert.equal(h.applied[0].result.status, 'applied'); assert.equal(h.reads.length, 2);
  assert.equal(h.el('Scripts').children.length, 3); assert.equal(h.el('Scripts').children.find(item => item.dataset.objectId === id(4)).dataset.usage, 'available');
  assert.equal(h.el('Source').value, ''); assert.equal(h.el('Save').disabled, true); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.el('Open').disabled, false);
});

test('changing or silently changing the script invalidates approval before apply', async () => {
  const h = await harness(); await h.open(); await h.review(); h.select(id(6)); assert.equal(h.el('Save').disabled, true); await h.review();
  h.el('Source').value = id(6); h.click('Save'); await settle(); assert.equal(h.requests.length, 2); assert.equal(h.el('Save').disabled, true);
});

test('linked, nonexistent or stale selected scripts cannot be reviewed even through synthetic selection', async () => {
  const h = await harness(); await h.open();
  for (const sourceId of [id(3), id(5), id(99)]) { h.select(sourceId); h.click('Check'); await settle(); }
  assert.equal(h.requests.length, 0); h.select(id(4)); const next = directory(); next.sources = next.sources.filter(source => source.objectId !== id(4)); h.setCatalog(next); h.click('Refresh'); await settle();
  assert.equal(h.el('Source').value, id(4)); assert.match(h.el('Source').textContent, /已不可用/); assert.equal(h.el('Check').disabled, true);
});

test('directory reads reject invalid versions and mismatched manifest or source declarations', async () => {
  for (const mutate of [d => d.schemaVersion++, d => d.scene.objectId = id(99), d => d.sources[1].sourcePath = 'elsewhere/new.txt', d => d.manifest.bindingCount = 3]) {
    const catalog = directory(); mutate(catalog); const h = await harness({ catalog }); await h.open(); assert.equal(h.el('Ready').hidden, true); assert.equal(h.el('Open').disabled, true); assert.equal(h.requests.length, 0);
  }
});

test('late initial directory responses cannot cross source, session, scene, dirty or capability changes', async () => {
  for (const change of [h => h.context.sourceToken = 'next', h => h.context.session = 'next', h => h.context.sceneId = id(9), h => h.context.dirty = true, h => h.context.busy = true,
    h => { h.controller.setAvailable(false); h.controller.setAvailable(true, ['relation.add']); }]) {
    const pending = deferred(), h = await harness({ inspect: () => pending.promise }); h.controller.open(id(1)); change(h); pending.resolve(directory()); await settle();
    assert.equal(h.el('Ready').hidden, true); assert.equal(h.el('Save').disabled, true); assert.equal(h.busy.at(-1), false);
  }
});

test('late previews are discarded for changed owner or silently edited input', async () => {
  for (const change of [h => h.context.sourceToken = 'next', h => h.context.session = 'next', h => h.context.visible = false, h => h.context.dirty = true, h => h.el('Source').value = id(6)]) {
    const h = await harness(); await h.open(); h.select(id(4)); h.click('Check'); await settle(); change(h); h.requests[0].resolve(resultFor(h.requests[0].request)); await settle();
    assert.equal(h.el('Review').hidden, true); assert.equal(h.el('Save').disabled, true); assert.equal(h.applied.length, 0);
  }
});

test('pure receipt checking blocks forged relations, proposal commands, endpoints and apply receipts', async () => {
  for (const mutate of [r => r.changes[0].targetObjectId = id(6), r => r.changes[0].sourcePath = 'documents/other.json', r => r.proposal.commands[0].input.kind = 'owns', r => r.relation.properties.slot = 'secret', r => r.status = 'applied']) {
    const h = await harness(); await h.open(); h.select(id(4)); h.click('Check'); await settle(); const result = resultFor(h.requests[0].request); mutate(result); h.requests[0].resolve(result); await settle();
    assert.equal(h.el('Save').disabled, true); assert.equal(h.applied.length, 0);
  }
  const h = await harness(); await h.open(); await h.review(); h.click('Save'); await settle(); const result = resultFor(h.requests[1].request); delete result.receipt; h.requests[1].resolve(result); await settle();
  assert.equal(h.el('Check').disabled, true); assert.equal(h.applied.length, 0); assert.match(h.el('Status').textContent, /尚未确认/);
});

test('known conflict allows fresh read and review but never repeats the old approval', async () => {
  const h = await harness(); await h.open(); await h.review(); h.click('Save'); await settle(); h.requests[1].reject(Object.assign(new Error('conflict'), { errorCode: 'world_revision_conflict' })); await settle();
  assert.equal(h.el('Check').disabled, true); const next = directory(); next.baseRevision = revision(52); h.setCatalog(next); h.click('Refresh'); await settle();
  assert.equal(h.el('Source').value, id(4)); assert.equal(h.el('Save').disabled, true); await h.review(); assert.equal(h.requests[2].request.baseRevision, revision(52));
});

test('unknown apply remains locked after unconfirmed refresh; no duplicate write is issued', async () => {
  const h = await harness(); await h.open(); await h.review(); h.click('Save'); await settle(); h.requests[1].reject(new Error('connection lost')); await settle();
  assert.match(h.el('Status').textContent, /尚未确认/); h.click('Refresh'); await settle(); h.click('Check'); h.click('Save'); h.click('Open');
  assert.equal(h.requests.length, 2); assert.equal(h.opened.length, 0); assert.equal(h.el('Check').disabled, true); assert.equal(h.applied.length, 0);
});

test('unknown apply converges only by rereading a linked target and passes a read-only observed notification', async () => {
  let h; h = await harness({ applied: async () => { h.context.sourceToken = 'observed-refresh'; } }); await h.open(); await h.review(); h.click('Save'); await settle(); h.requests[1].reject(new Error('connection lost')); await settle();
  h.markLinked(); h.click('Refresh'); await settle(); assert.equal(h.requests.length, 2); assert.equal(h.applied.length, 1); assert.equal(h.applied[0].result, null);
  assert.equal(h.applied[0].info.reconciled, true); assert.equal(h.applied[0].info.catalog.sources.find(source => source.objectId === id(4)).linked, true);
  assert.equal(h.reads.length, 3); assert.equal(h.el('Source').value, ''); assert.equal(h.el('Open').disabled, false); h.select(id(6)); assert.equal(h.el('Check').disabled, false);
});

test('a linked target under another manifest or world cannot settle an unknown transaction', async () => {
  for (const mutate of [d => d.manifest.objectId = id(9), d => d.worldId = `world:${hash(9)}`]) {
    const h = await harness(); await h.open(); await h.review(); h.click('Save'); await settle(); h.requests[1].reject(new Error('connection lost')); await settle();
    const next = directory(); next.sources[1].linked = true; mutate(next); h.setCatalog(next); h.click('Refresh'); await settle();
    assert.equal(h.applied.length, 0); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Open').disabled, true);
  }
});

test('known committed writes remain locked across host refresh failure and retry only synchronization', async () => {
  let reject = true, h; h = await harness({ applied: async () => { h.context.sourceToken = 'partial-host-refresh'; if (reject) throw new Error('refresh failed'); } });
  await h.open(); await h.review(); await h.save(); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Open').disabled, true); assert.match(h.el('Status').textContent, /已保存/);
  reject = false; h.click('Refresh'); await settle(); assert.equal(h.applied.length, 2); assert.equal(h.requests.length, 2); assert.equal(h.el('Open').disabled, false);
});

test('post-save catalog failure preserves committed state until a read retry succeeds without another callback', async () => {
  let reject = false; const h = await harness({ inspect: (payload, data) => { if (reject) throw Error('read failed'); return data; } });
  await h.open(); await h.review(); reject = true; await h.save(); assert.equal(h.el('Open').disabled, true); assert.equal(h.applied.length, 1);
  reject = false; h.click('Refresh'); await settle(); assert.equal(h.applied.length, 1); assert.equal(h.requests.length, 2); assert.equal(h.el('Open').disabled, false);
});

test('owner changes during save or its refresh never synchronize a different scene or session', async () => {
  const h = await harness(); await h.open(); await h.review(); h.click('Save'); await settle(); h.context.session = 'other'; h.requests[1].resolve(resultFor(h.requests[1].request)); await settle();
  assert.equal(h.applied.length, 0); assert.equal(h.el('Save').disabled, true);
  let h2; h2 = await harness({ applied: async () => { h2.context.session = 'other'; h2.context.sourceToken = 'other'; } }); await h2.open(); await h2.review(); await h2.save();
  assert.equal(h2.reads.length, 1); assert.equal(h2.el('Open').disabled, true); h2.click('Open'); assert.equal(h2.opened.length, 0);
});

test('opening source rereads its current revision and hands off navigation without fighting host busy and token changes', async () => {
  let h; h = await harness({ openSource: async (path, options) => {
    assert.equal(h.busy.at(-1), false); assert.equal(options.isCurrent(), true); h.context.busy = true; h.context.sourceToken = 'loaded-source';
    assert.equal(options.isCurrent(), true); h.context.visible = false; assert.equal(options.isCurrent(), true); h.context.busy = false; return true;
  } }); await h.open(); const next = directory(); next.manifest.sourceRevision = revision(70); next.manifest.sourcePath = 'documents/behaviors/renamed.json'; h.setCatalog(next);
  h.click('Open'); await settle(); assert.equal(h.opened.length, 1); assert.equal(h.opened[0].path, next.manifest.sourcePath); assert.equal(h.opened[0].info.sourceRevision, revision(70));
  assert.equal(h.reads.length, 2); assert.equal(h.el('Dialog').open, false); assert.equal(h.opened[0].info.isCurrent(), false); assert.equal(h.requests.length, 0);
});

test('opening a replaced or removed behavior relation first updates the directory without navigating an old path', async () => {
  for (const removed of [true, false]) {
    const h = await harness(); await h.open(); const next = removed ? emptyDirectory() : directory(); if (!removed) { next.manifest.objectId = id(9); next.manifest.sourcePath = 'documents/behaviors/changed.json'; }
    h.setCatalog(next); h.click('Open'); await settle(); assert.equal(h.opened.length, 0); assert.match(h.el('Status').textContent, /关系已变化/);
    if (removed) assert.equal(h.el('Open').disabled, true);
    else { h.click('Open'); await settle(); assert.equal(h.opened[0].path, next.manifest.sourcePath); }
  }
});

test('navigation never accepts dirty, changed-session or replaced-source ownership during the fresh read', async () => {
  for (const change of [h => h.context.sourceToken = 'other', h => h.context.dirty = true, h => h.context.session = 'other']) {
    const pending = deferred(); let reads = 0; const h = await harness({ inspect: () => ++reads === 1 ? directory() : pending.promise }); await h.open(); h.click('Open'); change(h); pending.resolve(directory()); await settle();
    assert.equal(h.opened.length, 0); assert.equal(h.el('Dialog').open, true);
  }
});

test('navigation handoff remains invalid for a dirty editor, new scene or disposed window', async () => {
  for (const change of [h => h.context.dirty = true, h => h.context.sceneId = id(9), h => h.controller.dispose()]) {
    let h; h = await harness({ openSource: async (path, options) => { change(h); assert.equal(options.isCurrent(), false); return false; } }); await h.open(); h.click('Open'); await settle(); assert.equal(h.opened.length, 1);
  }
});

test('failed source navigation preserves the window and can be retried without issuing metadata commands', async () => {
  let success = false; const h = await harness({ openSource: async () => success }); await h.open(); h.click('Open'); await settle(); assert.equal(h.el('Dialog').open, true);
  success = true; h.click('Open'); await settle(); assert.equal(h.opened.length, 2); assert.equal(h.el('Dialog').open, false); assert.equal(h.requests.length, 0);
});

test('local selection and approval ask before close or source navigation and in-flight operations block exit', async () => {
  const h = await harness(); await h.open(); h.select(id(4)); h.runtime.window.confirm = () => false;
  h.click('Cancel'); h.el('Dialog').dispatch('cancel'); h.click('Open'); await settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.reads.length, 1);
  h.click('Check'); await settle(); h.runtime.window.confirm = () => true; h.click('Close'); h.el('Dialog').dispatch('cancel'); assert.equal(h.el('Dialog').open, true);
  const shortcut = h.el('Dialog').dispatch('keydown', { key: 's', ctrlKey: true }); assert.equal(shortcut.defaultPrevented, true); assert.equal(shortcut.stopped, true);
  h.requests[0].resolve(resultFor(h.requests[0].request)); await settle(); h.click('Cancel'); assert.equal(h.el('Dialog').open, false); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.requests.length, 1);
});

test('ordinary close restores focus after its native event, whereas source navigation preserves the destination focus', async () => {
  const h = await harness(), opener = h.document.createElement('button'); h.document.body.append(opener); opener.focus(); await h.open(); h.el('Source').focus(); h.click('Close'); await settle(); assert.equal(h.document.activeElement, opener);
  let h2; h2 = await harness({ openSource: async () => { h2.element('docTitle').focus(); return true; } }); const opener2 = h2.document.createElement('button'); h2.document.body.append(opener2); opener2.focus(); await h2.open(); h2.click('Open'); await settle(); assert.equal(h2.document.activeElement, h2.element('docTitle'));
});

test('an old close event cannot reset a reopened window or steal its current focus', async () => {
  const h = await harness(); await h.open(); h.click('Close'); assert.equal(h.controller.open(id(1)), true); h.el('Source').focus(); await settle();
  assert.equal(h.el('Dialog').open, true); assert.equal(h.document.activeElement, h.el('Source')); assert.equal(h.el('Open').disabled, false);
});

test('external native close and dispose invalidate pending requests and release the busy lock', async () => {
  for (const dispose of [true, false]) {
    const h = await harness(); await h.open(); h.select(id(4)); h.click('Check'); await settle(); if (dispose) h.controller.dispose(); else h.el('Dialog').close(); await settle();
    h.requests[0].resolve(resultFor(h.requests[0].request)); await settle(); assert.equal(h.applied.length, 0); assert.equal(h.busy.at(-1), false);
    if (dispose) { assert.equal(h.el('Dialog'), null); const length = h.busy.length; h.controller.dispose(); assert.equal(h.busy.length, length); }
    else { assert.equal(await h.open(), true); assert.equal(h.el('Save').disabled, true); }
  }
});

test('translations retain selections and review; dynamic names remain text and every fixed message has English and Japanese copy', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-behavior-links.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/data-i18n="([^"]+)"|'([^'\n]*[\u4e00-\u9fff][^'\n]*)'/g)].map(match => match[1] || match[2]));
  for (const key of keys) { assert.ok(en[key], `en: ${key}`); assert.ok(ja[key], `ja: ${key}`); }
  const data = directory(); data.sources[1].name = '<img src=x onerror=evil()>'; const h = await harness({ catalog: data }); await h.open(); await h.review();
  for (const locale of ['en', 'ja', 'zh-CN']) { h.setLanguage(locale); assert.equal(h.el('Source').value, id(4)); assert.equal(h.el('Save').disabled, false); assert.equal(h.el('Review').hidden, false); }
  assert.match(h.el('Source').textContent, /<img/); assert.equal(h.el('Source').querySelector('img'), null); assert.equal(h.requests.length, 1);
});
