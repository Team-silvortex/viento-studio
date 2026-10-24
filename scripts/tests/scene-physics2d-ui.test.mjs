import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { readScenePhysics2DDocument, createScenePhysics2DProposal, isScenePhysics2DProposal } from '../../engine/scene-physics2d-edit.mjs';
import { captureScenePhysics2DTargets, isScenePhysics2DTargets, scenePhysics2DTargetsMatchSource, scenePhysics2DTargetValue, validateScenePhysics2DTargets } from '../../engine/scene-physics2d-targets.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const model = (count = 2) => ({ format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: id(1), bodies: Array.from({ length: count }, (_, n) => ({
  id: id(10 + n), instanceId: id(200 + n), kind: n ? 'static' : 'character', shape: { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 1,
})) });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, settings = {}) {
  const original = settings.original ?? '\ufeff' + JSON.stringify(settings.model ?? model(), null, 2).replace('"layer": 1', '"layer": 1e0').replaceAll('\n', '\r\n') + '\r\n';
  let content = original, language = 'zh', listener = () => {}, allocated = 1000, controller;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, physicsSource: true, available: true, sourcePath: 'documents/physics/demo.json', sourceToken: 'host:1', targetsAvailable: settings.targetsAvailable ?? Boolean(settings.targets), targetsToken: 'targets:1' };
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, sourceRevision: hash(content), baseSourceRevision: hash(original) });
  const calls = [], checked = [], writes = [], confirmations = [], focuses = [], targetCalls = [], guardsReceived = [];
  const directory = source => ({ format: 'viento-scene-physics2d-targets', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: hash('world'),
    scene: { objectId: id(1), sourcePath: 'documents/scenes/demo.json', sourceRevision: hash('scene') },
    manifest: { objectId: id(8000), sourcePath: source.sourcePath, sourceRevision: source.baseSourceRevision, content: original },
    targets: [200, 201, 202].map(instance => ({ instanceId: id(instance), objectId: id(9000), name: 'Same actor', sourcePath: 'documents/actors/actor.json' })),
  });
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-physics2d', {
    crypto: { randomUUID: settings.uuid || (() => id(++allocated)) },
    readScenePhysics2DDocument: settings.read || readScenePhysics2DDocument,
    createScenePhysics2DProposal: async (source, edit) => {
      checked.push(copy(edit)); await settings.beforeProposal?.(); const result = await createScenePhysics2DProposal(copy(source), copy(edit)); return settings.proposal ? settings.proposal(result) : result;
    }, isScenePhysics2DProposal, isScenePhysics2DTargets,
    scenePhysics2DTargetsMatchSource: (catalog, source) => scenePhysics2DTargetsMatchSource(catalog, copy(source)),
    scenePhysics2DTargetValue, validateScenePhysics2DTargets: (catalog, document) => validateScenePhysics2DTargets(catalog, copy(document)), t: translate,
    translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: callback => { listener = callback; return () => { listener = () => {}; }; },
  });
  h.runtime.window.confirm = message => { confirmations.push(message); return settings.confirm?.() ?? true; };
  const commit = (proposal, guards) => {
    if (!guards.isCurrent()) throw Object.assign(new Error('stale'), { errorCode: 'scene_physics2d_authoring_conflict' });
    writes.push(proposal.afterContent); content = proposal.afterContent; context.sourceToken += ':draft'; controller.refresh();
    return { applied: true, content, sourcePath: context.sourcePath, sourceToken: context.sourceToken, focus() { focuses.push(content); } };
  };
  controller = h.runtime.setupScenePhysics2D({ getContext: () => context,
    getSource: () => settings.source ? settings.source(snapshot()) : Promise.resolve(snapshot()),
    ...(settings.targets ? { getTargets: async source => { targetCalls.push(copy(source)); const raw = directory(source);
      const value = typeof settings.targets === 'function' ? await settings.targets(copy(source), raw) : undefined;
      return value === undefined ? captureScenePhysics2DTargets(copy(source), raw) : value; } } : {}),
    applyDraft: async (proposal, guards) => { calls.push(proposal); guardsReceived.push(guards); return settings.apply ? settings.apply(proposal, guards, commit) : commit(proposal, guards); },
  });
  const el = name => h.element('scenePhysics2D' + name), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const click = async name => { el(name).click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, el, context, calls, checked, writes, confirmations, focuses, original, content: () => content, settle, click,
    targetCalls, guardsReceived, open: () => controller.open(), set(name, value, event = ['Body', 'Kind', 'Shape', 'Target'].includes(name) ? 'change' : 'input') { el(name).value = value; el(name).dispatch(event); },
    language(value) { language = value; listener(); } };
}

test('physical declaration editor has independent source/draft ports and optional readonly targets', async t => {
  const h = await fixture(t); assert.deepEqual(Object.keys(h.controller).sort(), ['dispose', 'open', 'refresh']);
  for (const [key, value] of [['editable', false], ['creating', true], ['sourceJSON', false], ['physicsSource', false], ['sourcePath', '']]) {
    const old = h.context[key]; h.context[key] = value; h.controller.refresh(); assert.equal(h.el('Btn').hidden, true); assert.equal(await h.open(), false); h.context[key] = old;
  }
  for (const key of ['busy', 'available']) { const old = h.context[key]; h.context[key] = !old; h.controller.refresh(); assert.equal(h.el('Btn').disabled, true); assert.equal(await h.open(), false); h.context[key] = old; }
  assert.equal(await h.open(), true); assert.equal(h.el('Dialog').dataset.vientoCloseGuard, 'true'); assert.equal(h.el('Stage').hidden, false);
  assert.equal(h.el('Body').children.length, 2); assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0);
});

test('box to circle review uses verified shape and preserves BOM CRLF and unmodified numeric source bytes', async t => {
  const h = await fixture(t); await h.open(); h.set('Shape', 'circle'); h.set('Radius', '12'); h.set('X', '2');
  assert.equal(h.el('Box').hidden, true); assert.equal(h.el('Circle').hidden, false); assert.equal(h.el('Stage').hidden, true); assert.equal(h.el('Apply').disabled, true);
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Before').textContent, h.original); assert.equal(h.writes.length, 0);
  assert.equal(h.el('Stage').querySelector('[data-kind]').dataset.kind, 'circle'); assert.equal(h.el('Stage').dataset.bodyId, id(10));
  assert.match(h.el('After').textContent, /"layer": 1e0/); await h.click('Apply');
  assert.equal(h.calls.length, 1); assert.equal(h.writes.length, 1); assert.equal(h.el('Dialog').open, false); assert.equal(h.focuses.length, 1);
  assert.ok(h.content().startsWith('\ufeff')); assert.equal(h.content().replaceAll('\r\n', '').includes('\n'), false);
  const value = await readScenePhysics2DDocument(h.content()); assert.deepEqual(value.bodies[0].shape, { kind: 'circle', radius: 12 }); assert.deepEqual(value.bodies[0].offset, [2, 0]);
  assert.equal(value.bodies[0].id, id(10)); assert.equal(value.bodies[0].instanceId, id(200));
});

test('manual missing instance repair stays editable without claiming a scene identity lookup', async t => {
  const h = await fixture(t); await h.open(); h.set('Instance', id(900)); h.set('Kind', 'sensor'); h.set('Layer', '0'); h.set('Mask', '0');
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false); await h.click('Apply');
  const body = (await readScenePhysics2DDocument(h.content())).bodies[0]; assert.equal(body.instanceId, id(900)); assert.equal(body.kind, 'sensor'); assert.equal(body.layer, 0); assert.equal(body.mask, 0);
  const source = await fs.readFile(new URL('../../web/modules/app-scene-physics2d.js', import.meta.url), 'utf8');
  assert.ok(source.includes('目录核对已保存的实例身份；运动属性和构建条件仍由工程预检检查。')); assert.ok(!source.includes('fetch('));
});

test('unfinished and invalid numeric inputs remain visible and never authorize preview or source writes', async t => {
  const h = await fixture(t); await h.open();
  for (const [name, value] of [['Width', '1e'], ['Width', '0'], ['Layer', '65536'], ['Mask', '-1'], ['X', '8193']]) {
    h.set('Width', '32'); h.set('Layer', '1'); h.set('Mask', '1'); h.set('X', '0'); h.set(name, value); await h.click('Check');
    assert.equal(h.el(name).value, value); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Stage').hidden, true); assert.equal(h.writes.length, 0);
  }
});

test('selecting bodies and toggling shape preserves incomplete values and shape-specific working fields', async t => {
  const h = await fixture(t); await h.open(); h.set('Width', '1e'); h.set('Body', id(11)); h.set('Y', '-'); h.set('Body', id(10));
  assert.equal(h.el('Width').value, '1e'); h.set('Shape', 'circle'); h.set('Radius', '2e'); h.set('Shape', 'box'); assert.equal(h.el('Width').value, '1e');
  h.set('Shape', 'circle'); assert.equal(h.el('Radius').value, '2e'); h.set('Body', id(11)); assert.equal(h.el('Y').value, '-');
  h.set('Body', id(999)); assert.equal(h.el('Body').value, id(11)); assert.equal(h.el('Y').value, '-'); assert.equal(h.writes.length, 0);
});

test('checking unchanged declaration offers a static shape without creating an apply proposal', async t => {
  const h = await fixture(t); await h.open(); h.set('Shape', 'circle'); h.set('Radius', '18'); h.set('Shape', 'box');
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); await h.click('Check'); assert.equal(h.checked.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Stage').hidden, false);
  await h.click('Cancel'); assert.equal(h.confirmations.length, 0);
});

test('equivalent numeric spellings are verified without a patch or an invalid-parameter error', async t => {
  const h = await fixture(t); await h.open(); h.set('Width', '3.2e1'); h.set('Layer', '1.0'); h.set('X', '-0'); await h.click('Check');
  assert.equal(h.el('Status').textContent, '物理参数已检查；未修改原文。'); assert.equal(h.el('Diagnostic').textContent, '');
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.el('Stage').hidden, false);
  assert.equal(h.el('Width').value, '3.2e1'); assert.equal(h.el('Layer').value, '1.0'); assert.equal(h.el('X').value, '-0'); assert.equal(h.content(), h.original); assert.equal(h.writes.length, 0);
  const gate = deferred(), late = await fixture(t, { beforeProposal: () => gate.promise }); await late.open(); late.set('Width', '3.2e1'); late.el('Check').click(); await late.settle();
  late.el('Width').value = '90'; gate.resolve(); await late.settle(); assert.equal(late.el('Stage').hidden, true); assert.equal(late.el('Apply').disabled, true); assert.equal(late.writes.length, 0);
});

test('English Japanese and Chinese changes keep exact field nodes focus incomplete input and checked review', async t => {
  const h = await fixture(t); await h.open(); h.set('Width', '80'); await h.click('Check');
  const field = h.el('Width'), picker = h.el('Body'), after = h.el('After').textContent; field.focus();
  for (const [language, title] of [['en', en['编辑二维物理']], ['ja', ja['编辑二维物理']], ['zh', '编辑二维物理']]) {
    h.language(language); assert.equal(h.el('Title').textContent, title); assert.equal(h.el('Width'), field); assert.equal(h.document.activeElement, field);
    assert.equal(h.el('Body'), picker); assert.equal(h.el('After').textContent, after); assert.equal(h.el('Apply').disabled, false);
  }
  h.set('Width', '1e'); h.language('ja'); assert.equal(field.value, '1e'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Stage').hidden, true);
});

test('add and remove are explicit append operations with fresh identities and no automatic target creation', async t => {
  const h = await fixture(t); await h.open(); h.set('Width', '80'); await h.click('Add');
  assert.equal(h.el('Body').children.length, 3); assert.equal(h.el('Instance').value, ''); assert.equal(h.el('Body').value, id(1001));
  await h.click('Check'); assert.equal(h.el('Apply').disabled, true); h.set('Instance', id(700)); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  const proposed = await readScenePhysics2DDocument(h.el('After').textContent); assert.deepEqual(proposed.bodies.map(row => row.id), [id(10), id(11), id(1001)]); assert.equal(proposed.bodies[0].shape.size[0], 80);
  await h.click('Remove'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Body').value, id(11)); h.set('Body', id(10)); assert.equal(h.el('Width').value, '80');
  await h.click('Remove'); assert.equal(h.el('Remove').disabled, true); await h.click('Remove'); assert.equal(h.el('Body').children.length, 1); assert.equal(h.writes.length, 0);
});

test('add then remove restores clean state but cannot revive an old review; identities are never recycled', async t => {
  const ids = [id(10), id(1), id(200), id(1001), id(1001), id(1002)]; const h = await fixture(t, { uuid: () => ids.shift() }); await h.open();
  await h.click('Add'); assert.equal(h.el('Body').value, id(1001)); await h.click('Remove'); assert.equal(h.el('Dialog').dataset.dirty, 'false');
  h.set('Width', '80'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false); await h.click('Add'); assert.equal(h.el('Body').value, id(1002)); await h.click('Remove'); assert.equal(h.el('Apply').disabled, true);
});

test('allocation failures and body limit leave source and existing input intact', async t => {
  for (const uuid of [() => id(10), () => 'invalid', () => { throw Error('unavailable'); }]) {
    const h = await fixture(t, { uuid }); await h.open(); h.set('Width', '1e'); await h.click('Add'); assert.equal(h.el('Width').value, '1e'); assert.equal(h.el('Body').children.length, 2); assert.equal(h.writes.length, 0);
  }
  const h = await fixture(t, { model: model(128) }); await h.open(); assert.equal(h.el('Add').disabled, true); await h.click('Add'); assert.equal(h.el('Body').children.length, 128);
  await h.click('Remove'); assert.equal(h.el('Add').disabled, false);
});

test('silent edits revoke reviewed apply authority and clearing preview does not rewrite source', async t => {
  const h = await fixture(t); await h.open(); h.set('Width', '80'); await h.click('Check'); h.el('Mask').value = '3';
  await h.click('Apply'); assert.equal(h.calls.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Stage').hidden, true); assert.equal(h.el('Mask').value, '3');
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false); h.context.sourceToken += ':external'; h.controller.refresh();
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Stage').hidden, true); assert.equal(h.el('Width').value, '80'); await h.click('Apply'); assert.equal(h.writes.length, 0);
});

test('cancel and Escape guard dirty forms while header return never saves', async t => {
  let allow = false; const h = await fixture(t, { confirm: () => allow }); await h.open(); h.set('Width', '80');
  await h.click('Close'); assert.equal(h.el('Dialog').open, true); h.el('Dialog').dispatch('cancel'); await h.settle(); assert.equal(h.el('Dialog').open, true);
  allow = true; await h.click('Cancel'); assert.equal(h.el('Dialog').open, false); assert.equal(h.confirmations.length, 3); assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
});

test('late source cannot reopen a cancelled, replaced or disposed source session', async t => {
  for (const change of [h => h.click('Cancel'), h => { h.context.sourceToken += ':other'; h.controller.refresh(); }, h => h.controller.dispose()]) {
    const gate = deferred(), h = await fixture(t, { source: async value => { await gate.promise; return value; } }); const opening = h.open(); await change(h); gate.resolve(); assert.equal(await opening, false); assert.equal(h.calls.length, 0);
  }
});

test('late validation cannot approve cancelled source, silent changed input or unavailable core', async t => {
  for (const change of [h => h.click('Cancel'), h => { h.context.sourceToken += ':new'; h.controller.refresh(); }, h => { h.el('Width').value = '90'; }, h => { h.context.available = false; h.controller.refresh(); }]) {
    const gate = deferred(), h = await fixture(t, { proposal: async proposal => { await gate.promise; return proposal; } }); await h.open(); h.set('Width', '80'); h.el('Check').click(); await h.settle();
    await change(h); gate.resolve(); await h.settle(); if (h.el('Dialog').open) assert.equal(h.el('Apply').disabled, true); assert.equal(h.writes.length, 0);
  }
});

test('pending check blocks structural changes even through direct programmatic callbacks', async t => {
  const gate = deferred(), h = await fixture(t, { proposal: async proposal => { await gate.promise; return proposal; } }); await h.open(); h.set('Width', '80'); h.el('Check').click(); await h.settle();
  await h.click('Add'); await h.click('Remove'); h.set('Body', id(11)); assert.equal(h.el('Body').children.length, 2); assert.equal(h.el('Body').value, id(10));
  gate.resolve(); await h.settle(); assert.equal(h.el('Apply').disabled, false);
});

test('pending apply cancellation or source replacement revokes host write ticket', async t => {
  for (const change of [h => h.click('Cancel'), h => { h.context.sourceToken += ':new'; h.controller.refresh(); }, h => { h.el('Width').value = '90'; }]) {
    const gate = deferred(), h = await fixture(t, { apply: async (proposal, guards, commit) => { await gate.promise; return commit(proposal, guards); } });
    await h.open(); h.set('Width', '80'); await h.click('Check'); h.el('Apply').click(); await h.settle(); await change(h); gate.resolve(); await h.settle();
    assert.equal(h.calls.length, 1); assert.equal(h.writes.length, 0); assert.equal(h.content(), h.original);
  }
});

test('malformed source snapshots, invalid declarations, unavailable core and forged proposals fail closed', async t => {
  for (const settings of [{ original: '{"format":"wrong"}' }, { original: '{"format":"viento-scene-physics2d","format":"viento-scene-physics2d"}' },
    { source: source => ({ ...source, token: 'other' }) }, { read: () => { throw Object.assign(Error('core'), { errorCode: 'studio_core_unavailable' }); } }]) {
    const h = await fixture(t, settings); assert.equal(await h.open(), false); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Stage').hidden, true); assert.equal(h.writes.length, 0);
  }
  const h = await fixture(t, { proposal: proposal => ({ ...proposal }) }); await h.open(); h.set('Width', '80'); await h.click('Check'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.writes.length, 0);
});

test('all displayed physics editor keys exist in English and Japanese and layout has a mobile breakpoint', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-physics2d.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/data-i18n="([^"]+)"|\bt\('([^']+)'|(?:message|text) = '([^']*[\u4e00-\u9fff][^']*)'/g)].map(match => match[1] || match[2] || match[3]));
  for (const key of keys) { assert.ok(en[key], `en: ${key}`); assert.ok(ja[key], `ja: ${key}`); }
  const css = await fs.readFile(new URL('../../web/scene-physics2d.css', import.meta.url), 'utf8'); assert.match(css, /@media\(max-width:700px\)/); assert.match(css, /aspect-ratio:5\/3/);
  assert.match(css, /\.scene-physics2d-dialog\[open\]\{display:flex;flex-direction:column\}/);
  assert.match(css, /\.scene-physics2d-header,\.scene-physics2d-feedback,\.scene-physics2d-footer\{flex:0 0 auto\}/);
  assert.match(css, /\.scene-physics2d-body\{min-height:0;flex:1 1 auto;[^}]*overflow:auto/);
  assert.doesNotMatch(css, /100dvh - (260|290)px/);
});

test('saved scene picker distinguishes repeated names by complete instance ID and applies only the selected identity', async t => {
  const h = await fixture(t, { targets: true }); await h.open(); await h.settle();
  assert.equal(h.targetCalls.length, 1); assert.equal(h.el('Target').children.length, 4); assert.equal(h.el('Target').value, id(200));
  assert.equal(h.el('TargetsPath').textContent, 'documents/scenes/demo.json');
  assert.equal(h.el('Target').children[1].textContent, `Same actor · 实例 ${id(200)}`);
  assert.equal(h.el('Target').children[2].textContent, `Same actor · 实例 ${id(201)}`);
  h.set('Target', id(202)); assert.equal(h.el('Instance').value, id(202)); assert.equal(h.el('Body').value, id(10));
  assert.equal(h.el('Stage').hidden, true); assert.equal(h.writes.length, 0); await h.click('Check');
  assert.equal(h.el('Status').textContent, '物理参数及目录目标已检查，请审阅完整原文后应用。'); assert.equal(h.el('Apply').disabled, false);
  const reviewed = await readScenePhysics2DDocument(h.el('After').textContent); assert.equal(reviewed.bodies[0].instanceId, id(202)); assert.equal(reviewed.bodies[0].id, id(10));
  await h.click('Apply'); assert.equal(h.writes.length, 1); assert.ok(isScenePhysics2DTargets(h.guardsReceived[0].targets));
  assert.equal(h.el('Dialog').open, false); assert.equal(h.focuses.length, 1);
});

test('picker placeholder forged identity and same-value selection never clear manual input or create changes', async t => {
  const h = await fixture(t, { targets: true }); await h.open(); await h.settle();
  for (const value of ['', id(999), id(200)]) { h.set('Target', value); assert.equal(h.el('Instance').value, id(200)); assert.equal(h.el('Dialog').dataset.dirty, 'false'); }
  h.set('Width', '80'); await h.click('Check'); h.set('Target', id(200)); assert.equal(h.el('Apply').disabled, false);
  h.set('Instance', id(202)); assert.equal(h.el('Target').value, id(202)); assert.equal(h.el('Apply').disabled, true);
  h.set('Instance', 'unfinished'); assert.equal(h.el('Target').value, ''); assert.equal(h.el('TargetHint').hidden, false); assert.equal(h.el('Instance').value, 'unfinished');
  assert.equal(h.writes.length, 0);
});

test('directory checks all bodies including an unselected missing instance and never silently repairs it', async t => {
  const h = await fixture(t, { targets: (_source, raw) => { raw.targets = raw.targets.filter(row => row.instanceId !== id(201)); } });
  await h.open(); await h.settle(); h.set('Width', '80'); await h.click('Check');
  assert.equal(h.el('Diagnostic').textContent, 'scene_physics2d_target_missing'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Instance').value, id(200));
  h.set('Body', id(11)); assert.equal(h.el('Instance').value, id(201)); assert.equal(h.el('TargetHint').hidden, false);
  h.set('Target', id(202)); await h.click('Check'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.writes.length, 0);
});

test('missing targets are checked for unchanged and equivalent numeric source too', async t => {
  for (const width of ['32', '3.2e1']) {
    const h = await fixture(t, { targets: (_source, raw) => { raw.targets = raw.targets.filter(row => row.instanceId !== id(200)); } });
    await h.open(); await h.settle(); h.set('Width', width); await h.click('Check');
    assert.equal(h.el('Diagnostic').textContent, 'scene_physics2d_target_missing'); assert.equal(h.el('Stage').hidden, true); assert.equal(h.el('Apply').disabled, true);
    assert.equal(h.el('Width').value, width); assert.equal(h.el('Instance').value, id(200)); assert.equal(h.writes.length, 0);
  }
});

test('refresh revokes reviewed authority and keeps exact fields while exposing removed and renamed saved instances', async t => {
  let revision = 0; const h = await fixture(t, { targets: (_source, raw) => {
    raw.revision = hash(String(revision)); if (revision) { raw.targets = raw.targets.filter(row => row.instanceId !== id(200)); raw.targets.forEach(row => { row.name = 'Renamed actor'; }); }
  } });
  await h.open(); await h.settle(); h.set('Width', '80'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  const field = h.el('Width'); revision++; await h.click('TargetsRefresh');
  assert.equal(h.el('Width'), field); assert.equal(field.value, '80'); assert.equal(h.el('Instance').value, id(200)); assert.equal(h.el('Target').value, '');
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.el('TargetHint').hidden, false);
  assert.match(h.el('Target').children[1].textContent, /^Renamed actor/); await h.click('Check'); assert.equal(h.el('Diagnostic').textContent, 'scene_physics2d_target_missing');
  h.set('Target', id(202)); await h.click('Check'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.writes.length, 0);
});

test('directory failures and absent ports retain manual editing with explicit unverified status and no catalog authority', async t => {
  for (const settings of [{}, { targets: () => { throw Error('offline'); } }, { targets: true, targetsAvailable: false }]) {
    const h = await fixture(t, settings); await h.open(); await h.settle(); h.set('Instance', id(900)); h.set('Width', '80'); await h.click('Check');
    assert.equal(h.el('Apply').disabled, false); assert.match(h.el('TargetsStatus').textContent, /未验证/);
    assert.equal(h.el('Status').textContent, '物理参数已检查；目标尚未验证。请审阅完整原文后应用。');
    await h.click('Apply'); assert.equal(h.writes.length, 1); assert.equal(Object.hasOwn(h.guardsReceived[0], 'targets'), false);
  }
});

test('retry after failure retains raw input and revokes a manual review before catalog verification', async t => {
  let fail = true; const h = await fixture(t, { targets: () => { if (fail) throw Error('offline'); } });
  await h.open(); await h.settle(); h.set('Width', '80'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false);
  fail = false; await h.click('TargetsRefresh'); assert.equal(h.el('Width').value, '80'); assert.equal(h.el('Apply').disabled, true);
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false); assert.match(h.el('Status').textContent, /目录目标已检查/);
});

test('loading saved instances leaves raw fields editable but does not approve unchecked membership mid-request', async t => {
  const gate = deferred(), h = await fixture(t, { targets: () => gate.promise }); await h.open(); await h.settle();
  assert.equal(h.el('Instance').disabled, false); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('TargetsRefresh').disabled, true);
  h.set('Width', '1e'); h.set('Instance', id(202)); h.el('Check').dispatch('click'); await h.settle(); assert.equal(h.checked.length, 0);
  gate.resolve(); await h.settle(); assert.equal(h.el('Width').value, '1e'); assert.equal(h.el('Instance').value, id(202)); assert.equal(h.el('Target').value, id(202));
  assert.equal(h.el('Check').disabled, false); assert.equal(h.el('Apply').disabled, true);
});

test('late directory result cannot populate a cancelled replaced disposed or revoked session', async t => {
  for (const change of [h => h.click('Cancel'), h => { h.context.sourceToken += ':other'; h.controller.refresh(); }, h => h.controller.dispose(),
    h => { h.context.targetsAvailable = false; h.controller.refresh(); }, h => { h.context.targetsToken += ':new'; h.controller.refresh(); }]) {
    const gate = deferred(), h = await fixture(t, { targets: () => gate.promise }); await h.open(); await h.settle(); const picker = h.el('Target'), apply = h.el('Apply');
    await change(h); gate.resolve(); await h.settle(); assert.equal(picker.children.length, 1); assert.equal(apply.disabled, true); assert.equal(h.writes.length, 0);
  }
});

test('forged or differently bound catalogs fail closed while keeping ordinary manual editing available', async t => {
  for (const targets of [() => ({}), (source, raw) => ({ ...captureScenePhysics2DTargets(source, raw) }),
    (source, raw) => captureScenePhysics2DTargets({ ...source, token: 'different' }, raw)]) {
    const h = await fixture(t, { targets }); await h.open(); await h.settle();
    assert.match(h.el('TargetsStatus').textContent, /无法读取/); assert.equal(h.el('Target').disabled, true); assert.equal(h.el('Width').disabled, false);
    h.set('Width', '80'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false); assert.match(h.el('Status').textContent, /尚未验证/);
  }
});

test('capability generations reject a late check or a pending apply even when the raw fields remain identical', async t => {
  for (const operation of ['Check', 'Apply']) for (const key of ['targetsToken', 'targetsAvailable']) {
    const gate = deferred(), h = await fixture(t, { targets: true,
      ...(operation === 'Check' ? { beforeProposal: () => gate.promise } : { apply: async (proposal, guards, commit) => { await gate.promise; return commit(proposal, guards); } }),
    });
    await h.open(); await h.settle(); h.set('Width', '80'); if (operation === 'Apply') await h.click('Check');
    h.el(operation).click(); await h.settle(); h.context[key] = key === 'targetsToken' ? 'targets:new' : false; h.controller.refresh();
    gate.resolve(); await h.settle(); assert.equal(h.el('Width').value, '80'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.writes.length, 0);
  }
});

test('language changes preserve picker and manual field nodes focus approval and full identity labels', async t => {
  const h = await fixture(t, { targets: true }); await h.open(); await h.settle(); h.set('Target', id(202)); await h.click('Check');
  const picker = h.el('Target'), instance = h.el('Instance'); picker.focus(); const after = h.el('After').textContent;
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.el('Target'), picker); assert.equal(h.el('Instance'), instance); assert.equal(h.document.activeElement, picker);
    assert.equal(picker.value, id(202)); assert.equal(instance.value, id(202)); assert.equal(h.el('After').textContent, after); assert.equal(h.el('Apply').disabled, false);
    for (const option of picker.children.slice(1)) assert.ok(option.textContent.includes(option.value));
  }
});

test('pending checks reject programmatic target selection and refresh callbacks', async t => {
  const gate = deferred(), h = await fixture(t, { targets: true, beforeProposal: () => gate.promise }); await h.open(); await h.settle(); h.set('Width', '80');
  h.el('Check').click(); await h.settle(); h.set('Target', id(202)); h.el('TargetsRefresh').dispatch('click');
  assert.equal(h.el('Instance').value, id(200)); assert.equal(h.targetCalls.length, 1); gate.resolve(); await h.settle(); assert.equal(h.el('Apply').disabled, false);
});


test('a queued native close event from the previous dialog cannot dismiss a reopened directory session', async t => {
  const gate = deferred(); let requests = 0;
  const h = await fixture(t, { targets: () => { if (++requests === 1) return gate.promise; } });
  await h.open(); h.el('Cancel').click(); assert.equal(h.el('Dialog').open, false);
  assert.equal(await h.open(), true); await h.settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Target').disabled, false);
  h.set('Target', id(202)); h.set('Width', '80'); gate.resolve(); await h.settle();
  assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Instance').value, id(202)); assert.equal(h.el('Width').value, '80');
  await h.click('Check'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.writes.length, 0);
});
