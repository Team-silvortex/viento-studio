import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { readScenePhysics2DDocument, createScenePhysics2DProposal, isScenePhysics2DProposal } from '../../engine/scene-physics2d-edit.mjs';
import { captureScenePhysics2DSpace, isScenePhysics2DSpace, scenePhysics2DSpaceMatchSource, createScenePhysics2DSpaceView, isScenePhysics2DSpaceView } from '../../engine/scene-physics2d-space.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const model = () => ({ format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: id(1), bodies: [
  { id: id(10), instanceId: id(200), kind: 'character', shape: { kind: 'box', size: [32, 48] }, offset: [7, -3], layer: 1, mask: 1 },
  { id: id(11), instanceId: id(201), kind: 'static', shape: { kind: 'circle', radius: 15 }, offset: [-5, 10], layer: 1, mask: 1 },
  { id: id(12), instanceId: id(202), kind: 'sensor', shape: { kind: 'box', size: [60, 30] }, offset: [0, 0], layer: 1, mask: 1 },
] });
const directory = () => ({ format: 'viento-scene-physics2d-space', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: hash('world'),
  scene: { objectId: id(1), sourcePath: 'documents/scenes/demo.json', sourceRevision: hash('scene'), title: 'Saved scene', viewport: [320, 240], background: '#172839' },
  actors: [200, 201, 202].map((n, i) => ({ instanceId: id(n), objectId: id(9000 + i), name: 'Same actor', sourcePath: `documents/actors/${i}.json`, sourceRevision: hash('actor' + i),
    position: [[80, 120], [500, -40], [220, 200]][i], size: [[40, 60], [70, 50], [20, 20]][i], color: '#556677' })),
});
async function fixture(t, settings = {}) {
  const original = JSON.stringify(settings.model || model(), null, 2) + '\n'; let content = original, language = 'zh', listener = () => {};
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, physicsSource: true, available: true, sourcePath: 'documents/physics/demo.json', sourceToken: 'host:1',
    targetsAvailable: false, spaceAvailable: settings.available ?? settings.port !== false, spaceToken: 'space:1' };
  const source = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, sourceRevision: hash(content), baseSourceRevision: hash(original) });
  const calls = [], writes = [], snapshots = [], readCalls = [];
  const translate = (key, ...args) => (({ en, ja }[language]?.[key] || key).replace(/\{(\d+)\}/g, (_, n) => String(args[n] ?? '')));
  const h = await dialogHarness('app-scene-physics2d', { readScenePhysics2DDocument, isScenePhysics2DProposal,
    createScenePhysics2DProposal: async (before, edit) => { await settings.beforeProposal?.(); return createScenePhysics2DProposal(copy(before), copy(edit)); },
    isScenePhysics2DSpace, isScenePhysics2DSpaceView, scenePhysics2DSpaceMatchSource: (space, snapshot) => scenePhysics2DSpaceMatchSource(space, copy(snapshot)),
    createScenePhysics2DSpaceView: (space, document) => { snapshots.push({ space, document }); return createScenePhysics2DSpaceView(space, copy(document)); },
    t: translate, translatePage: root => { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange: callback => { listener = callback; return () => { listener = () => {}; }; },
  });
  const renderer = (await fs.readFile(new URL('../../web/modules/app-scene-physics2d-space.js', import.meta.url), 'utf8')).replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '').replaceAll('export ', '');
  vm.runInContext(renderer, h.runtime);
  const controller = h.runtime.setupScenePhysics2D({ getContext: () => context, getSource: async () => source(),
    ...(settings.port === false ? {} : { getSpace: async snapshot => { readCalls.push(copy(snapshot)); const raw = directory();
      const result = await settings.read?.(copy(snapshot), raw); return result === undefined ? captureScenePhysics2DSpace(copy(snapshot), raw) : result; } }),
    applyDraft: async (proposal, guard) => { calls.push(proposal); if (!guard.isCurrent()) throw Error('stale'); content = proposal.afterContent; writes.push(content); context.sourceToken += ':draft';
      return { applied: true, content, sourcePath: context.sourcePath, sourceToken: context.sourceToken }; },
  });
  const el = name => h.element('scenePhysics2D' + name), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const click = async name => { el(name).click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, el, controller, context, calls, writes, snapshots, readCalls, original, content: () => content, settle, click,
    open: async () => { const result = await controller.open(); await settle(); return result; },
    set(name, value, event = ['Body', 'Kind', 'Shape'].includes(name) ? 'change' : 'input') { el(name).value = value; el(name).dispatch(event); },
    choice: value => el('SpaceView').querySelector(`[data-space-choice="${id(value)}"]`), shape: value => el('SpaceView').querySelector(`[data-space-body="${id(value)}"]`),
    language(value) { language = value; listener(); },
  };
}

test('space renderer draws saved viewport logical actors and offset shapes in a uniform fitted SVG', async t => {
  const h = await fixture(t); assert.equal(await h.open(), true); assert.equal(h.readCalls.length, 1); assert.equal(h.snapshots.length, 1);
  assert.equal(h.el('SpaceView').hidden, false); assert.equal(h.el('SpacePath').textContent, 'documents/scenes/demo.json');
  const svg = h.el('SpaceView').querySelector('svg'), viewport = h.el('SpaceView').querySelector('[data-space-viewport]');
  assert.equal(svg.getAttribute('preserveAspectRatio'), 'xMidYMid meet');
  const bounds = svg.getAttribute('viewBox').split(' ').map(Number); assert.ok(bounds[0] < 0 && bounds[1] < -65 && bounds[0] + bounds[2] > 535);
  assert.equal(viewport.getAttribute('width'), '320'); assert.equal(viewport.getAttribute('height'), '240'); assert.equal(viewport.getAttribute('fill'), '#172839');
  assert.equal(h.el('SpaceView').querySelectorAll('[data-space-actor]').length, 3);
  assert.equal(h.shape(10).getAttribute('x'), '71'); assert.equal(h.shape(10).getAttribute('y'), '93'); assert.equal(h.shape(10).getAttribute('width'), '32');
  assert.equal(h.shape(11).tagName, 'CIRCLE'); assert.equal(h.shape(11).getAttribute('cx'), '495'); assert.equal(h.shape(11).getAttribute('cy'), '-30');
  assert.equal(h.shape(12).dataset.kind, 'sensor'); assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0);
});

test('SVG and accessible body buttons select existing fields without making a draft dirty or losing review', async t => {
  const h = await fixture(t); await h.open(); h.shape(11).click(); assert.equal(h.el('Body').value, id(11)); assert.equal(h.el('Shape').value, 'circle');
  assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.shape(11).dataset.selected, 'true'); assert.equal(h.choice(11).getAttribute('aria-pressed'), 'true');
  h.choice(12).focus(); h.choice(12).click(); assert.equal(h.el('Body').value, id(12)); assert.equal(h.el('Kind').value, 'sensor'); assert.equal(h.el('Dialog').dataset.dirty, 'false');
  h.set('Width', '80'); await h.click('Check'); const review = h.el('After').textContent; assert.equal(h.el('Apply').disabled, false);
  h.shape(10).click(); assert.equal(h.el('Body').value, id(10)); assert.equal(h.el('After').textContent, review); assert.equal(h.el('Apply').disabled, false);
  assert.equal(h.writes.length, 0); assert.equal(h.snapshots.length, 2);
});

test('unfinished edits hide every scene shape and a successful check restores the checked candidate only', async t => {
  const h = await fixture(t); await h.open(); const oldShape = h.shape(11); h.set('Width', '1e');
  assert.equal(h.el('SpaceView').hidden, true); assert.match(h.el('SpaceStatus').textContent, /未检查/); oldShape.click(); assert.equal(h.el('Body').value, id(10));
  await h.click('Check'); assert.equal(h.el('SpaceView').hidden, true); assert.equal(h.el('Width').value, '1e');
  h.set('Width', '80'); await h.click('Check'); assert.equal(h.el('SpaceView').hidden, false); assert.equal(h.shape(10).getAttribute('width'), '80');
  assert.equal(h.el('Apply').disabled, false); h.el('Mask').value = '3'; h.controller.refresh(); assert.equal(h.el('SpaceView').hidden, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.writes.length, 0);
});

test('missing targets remain explicit selectable declarations and are never positioned at an invented origin', async t => {
  const h = await fixture(t, { read: (_snapshot, raw) => { raw.actors = raw.actors.filter(actor => actor.instanceId !== id(201)); } }); await h.open();
  assert.equal(h.shape(11), null); assert.equal(h.el('SpaceView').querySelectorAll('[data-space-body]').length, 2); assert.equal(h.choice(11).dataset.missing, 'true');
  assert.match(h.choice(11).textContent, /目标缺失/); assert.ok(h.choice(11).textContent.includes(id(201))); h.choice(11).click();
  assert.equal(h.el('Body').value, id(11)); assert.equal(h.el('Instance').value, id(201)); assert.equal(h.el('Dialog').dataset.dirty, 'false'); assert.equal(h.writes.length, 0);
});

test('refresh observes changed saved geometry but retains exact field nodes selection and checked review', async t => {
  let moved = false; const h = await fixture(t, { read: (_snapshot, raw) => { if (moved) raw.actors[0].position = [-400, 600]; } }); await h.open();
  h.set('Width', '80'); await h.click('Check'); const input = h.el('Width'), review = h.el('After').textContent; input.focus(); moved = true; await h.click('SpaceRefresh');
  assert.equal(h.el('Width'), input); assert.equal(input.value, '80'); assert.equal(h.el('After').textContent, review); assert.equal(h.el('Apply').disabled, false);
  assert.equal(h.document.activeElement, input); assert.equal(h.shape(10).getAttribute('x'), '-433'); assert.equal(h.shape(10).getAttribute('y'), '573');
  assert.equal(h.el('Body').value, id(10)); assert.equal(h.readCalls.length, 2); assert.equal(h.writes.length, 0);
});

test('failed refresh keeps a checked review and manual fields and a retry does not replace unfinished input', async t => {
  let fail = false; const h = await fixture(t, { read: () => { if (fail) throw Error('offline'); } }); await h.open(); h.set('Width', '80'); await h.click('Check');
  const review = h.el('After').textContent; fail = true; await h.click('SpaceRefresh'); assert.equal(h.el('SpaceView').hidden, true); assert.match(h.el('SpaceStatus').textContent, /无法显示/);
  assert.equal(h.el('After').textContent, review); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Width').value, '80');
  h.set('Width', '1e'); fail = false; await h.click('SpaceRefresh'); assert.equal(h.el('Width').value, '1e'); assert.equal(h.el('SpaceView').hidden, true); assert.match(h.el('SpaceStatus').textContent, /未检查/);
});

test('missing or unavailable geometry port leaves ordinary local preview checks and draft writes available', async t => {
  for (const options of [{ port: false }, { available: false }, { read: () => { throw Error('offline'); } }]) {
    const h = await fixture(t, options); await h.open(); assert.equal(h.el('SpaceView').hidden, true); assert.equal(h.el('Stage').hidden, false);
    h.set('Width', '80'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false); await h.click('Apply'); assert.equal(h.writes.length, 1);
  }
});

test('late geometry cannot populate a cancelled replaced disposed or revoked session', async t => {
  for (const change of [h => h.click('Cancel'), h => { h.context.sourceToken += ':other'; h.controller.refresh(); }, h => h.controller.dispose(),
    h => { h.context.spaceAvailable = false; h.controller.refresh(); }, h => { h.context.spaceToken += ':other'; h.controller.refresh(); }]) {
    const gate = deferred(), h = await fixture(t, { read: () => gate.promise }); await h.open(); const view = h.el('SpaceView');
    await change(h); gate.resolve(); await h.settle(); assert.equal(view.hidden, true); assert.equal(view.querySelectorAll('[data-space-body]').length, 0); assert.equal(h.writes.length, 0);
  }
});

test('close then immediate reopen rejects the old geometry result and queued native close event', async t => {
  const gate = deferred(); let count = 0; const h = await fixture(t, { read: async (_snapshot, raw) => { if (++count === 1) { await gate.promise; raw.actors[0].position = [-900, 900]; } } });
  await h.open(); h.el('Cancel').click(); assert.equal(h.el('Dialog').open, false); await h.open(); h.set('Width', '80'); await h.click('Check'); gate.resolve(); await h.settle();
  assert.equal(h.el('Dialog').open, true); assert.equal(h.shape(10).getAttribute('x'), '47'); assert.equal(h.el('Width').value, '80'); assert.equal(h.el('Apply').disabled, false);
});

test('geometry capability revocation clears old shape callbacks without revoking an unrelated reviewed draft', async t => {
  for (const key of ['spaceAvailable', 'spaceToken']) {
    const h = await fixture(t); await h.open(); h.set('Width', '80'); await h.click('Check'); const shape = h.shape(11), choice = h.choice(11), review = h.el('After').textContent;
    h.context[key] = key === 'spaceAvailable' ? false : 'space:new'; h.controller.refresh(); shape.dispatch('click'); choice.dispatch('click');
    assert.equal(h.el('SpaceView').hidden, true); assert.equal(h.el('Body').value, id(10)); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('After').textContent, review); assert.equal(h.writes.length, 0);
  }
});

test('pending check blocks geometry callbacks and refresh without losing the eventual checked draft', async t => {
  const gate = deferred(), h = await fixture(t, { beforeProposal: () => gate.promise }); await h.open(); const shape = h.shape(11), choice = h.choice(11);
  h.set('Width', '80'); h.el('Check').click(); await h.settle(); shape.dispatch('click'); choice.dispatch('click'); h.el('SpaceRefresh').dispatch('click');
  assert.equal(h.el('Body').value, id(10)); assert.equal(h.readCalls.length, 1); gate.resolve(); await h.settle(); assert.equal(h.el('Apply').disabled, false); assert.equal(h.shape(10).getAttribute('width'), '80');
});

test('geometry loading stays independent of editable fields and checked Apply authority', async t => {
  const gate = deferred(), h = await fixture(t, { read: () => gate.promise }); await h.open();
  assert.equal(h.el('Width').disabled, false); assert.equal(h.el('Check').disabled, false); assert.equal(h.el('SpaceRefresh').disabled, true);
  h.set('Width', '80'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false); gate.resolve(); await h.settle(); assert.equal(h.el('Apply').disabled, false); assert.equal(h.shape(10).getAttribute('width'), '80');
});

test('forged or differently bound catalogs cannot render even while the source form stays usable', async t => {
  for (const read of [() => ({}), (snapshot, raw) => ({ ...captureScenePhysics2DSpace(snapshot, raw) }),
    (snapshot, raw) => captureScenePhysics2DSpace({ ...snapshot, token: 'different' }, raw)]) {
    const h = await fixture(t, { read }); await h.open(); assert.match(h.el('SpaceStatus').textContent, /无法显示/); assert.equal(h.el('SpaceView').hidden, true);
    h.set('Width', '80'); await h.click('Check'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.writes.length, 0);
  }
});

test('renderer rejects unbranded views and old shapes cannot select after a newer saved observation', async t => {
  const h = await fixture(t); await h.open(); const oldShape = h.shape(11); await h.click('SpaceRefresh'); oldShape.dispatch('click'); assert.equal(h.el('Body').value, id(10));
  const root = h.document.createElement('section'); h.document.body.append(root); const selections = [];
  const renderer = h.runtime.setupScenePhysics2DSpace({ root, onSelect: value => selections.push(value) });
  renderer.render({ scene: {}, actors: [], bodies: [], missingBodies: [], bounds: {} }, { enabled: true }); assert.equal(root.hidden, true); assert.deepEqual(selections, []);
});

test('language changes preserve geometry buttons keyboard focus field selection and reviewed content', async t => {
  const h = await fixture(t); await h.open(); h.set('Width', '80'); await h.click('Check'); const button = h.choice(11), field = h.el('Width'), reviewed = h.el('After').textContent; button.focus();
  for (const language of ['en', 'ja', 'zh']) {
    h.language(language); assert.equal(h.choice(11), button); assert.equal(h.document.activeElement, button); assert.equal(h.el('Width'), field); assert.equal(field.value, '80');
    assert.equal(h.el('After').textContent, reviewed); assert.equal(h.el('Apply').disabled, false); assert.ok(button.textContent.includes(id(11))); assert.ok(button.textContent.includes(id(201)));
  }
});

test('renderer owns no source requests source writes images or simulation and has accessible responsive controls', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene-physics2d-space.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|requestWorldCommand|applyDraft|Image|img|canvas|requestAnimationFrame)\s*\(/);
  assert.match(source, /createElementNS/); assert.match(source, /preserveAspectRatio/); assert.match(source, /aria-pressed/);
  const css = await fs.readFile(new URL('../../web/scene-physics2d.css', import.meta.url), 'utf8'); assert.match(css, /scene-physics2d-space-choices/); assert.match(css, /@media\(max-width:700px\)/);
  for (const match of source.matchAll(/\bt\('([^']+)'/g)) { assert.ok(en[match[1]], 'en: ' + match[1]); assert.ok(ja[match[1]], 'ja: ' + match[1]); }
});
