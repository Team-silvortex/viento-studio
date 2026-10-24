import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { readScenePhysics2DDocument, createScenePhysics2DProposal, isScenePhysics2DProposal } from '../../engine/scene-physics2d-edit.mjs';
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
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, physicsSource: true, available: true, sourcePath: 'documents/physics/demo.json', sourceToken: 'host:1' };
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, sourceRevision: hash(content), baseSourceRevision: hash(original) });
  const calls = [], checked = [], writes = [], confirmations = [], focuses = [];
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-physics2d', {
    crypto: { randomUUID: settings.uuid || (() => id(++allocated)) },
    readScenePhysics2DDocument: settings.read || readScenePhysics2DDocument,
    createScenePhysics2DProposal: async (source, edit) => {
      checked.push(copy(edit)); await settings.beforeProposal?.(); const result = await createScenePhysics2DProposal(copy(source), copy(edit)); return settings.proposal ? settings.proposal(result) : result;
    }, isScenePhysics2DProposal, t: translate,
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
    applyDraft: async (proposal, guards) => { calls.push(proposal); return settings.apply ? settings.apply(proposal, guards, commit) : commit(proposal, guards); },
  });
  const el = name => h.element('scenePhysics2D' + name), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const click = async name => { el(name).click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, el, context, calls, checked, writes, confirmations, focuses, original, content: () => content, settle, click,
    open: () => controller.open(), set(name, value, event = ['Body', 'Kind', 'Shape'].includes(name) ? 'change' : 'input') { el(name).value = value; el(name).dispatch(event); },
    language(value) { language = value; listener(); } };
}

test('physical declaration editor has only independent source/draft ports and strict eligibility', async t => {
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
  assert.ok(source.includes('这里只检查声明参数；场景成员、控制方式和登记关系由工程预检检查。')); assert.ok(!source.includes('fetch('));
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
