import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { createScene3DObjectIndex, queryScene3DObjects } from '../../engine/scene3d-navigation.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
import { createScene3DParticlePreview } from '../../web/modules/scene3d-particle-preview.js';
import { prepareScene3DParticleField, sampleScene3DParticleField } from '../../engine/scene3d-particles.mjs';
import { createScene3DOrientationIndicator } from '../../web/modules/scene3d-orientation.js';

const copy = value => JSON.parse(JSON.stringify(value));
const one = '00000000-0000-4000-8000-000000000001', two = '00000000-0000-4000-8000-000000000002';
const parsed = () => ({ model: { format: 'viento-scene3d-model', schemaVersion: 1, name: 'Boxes', viewport: [640, 480], background: '#112233',
  camera: { position: [4, 3, 6], target: [0, 0, 0], fovDegrees: 50, near: .1, far: 100 }, light: { direction: [1, -2, -1], color: '#ffffff', energy: 1 },
  objects: [{ instanceId: one, name: '<b>Blue box</b>', primitive: 'box', position: [0, 1, 0], rotationDegrees: [10, 20, 30], size: [1, 2, 3], color: '#556677' },
    { instanceId: two, name: 'Other box', primitive: 'box', position: [2, 0, 0], rotationDegrees: [0, 0, 0], size: [1, 1, 1], color: '#ffffff' }] },
  sourceLocations: { objects: [{ instanceId: one, propertyPath: '/objects/0', sourceRange: { start: 50, end: 120, encoding: 'utf-16', exact: true } },
    { instanceId: two, propertyPath: '/objects/1', sourceRange: { start: 122, end: 192, encoding: 'utf-16', exact: true } }] } });
async function fixture(t, options = {}) {
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, sourcePath: 'documents/scenes/boxes.json', sourceToken: '1:0' };
  const renders = [], instances = [], errors = [], navigationCalls = []; let language = 'zh', supported = options.supported !== false, content = 'valid', listener = () => {}, loads = 0, parses = 0;
  const translate = key => ({ en, ja }[language]?.[key] || key);
  const h = await dialogHarness('app-scene3d-preview', { createScene3DOrientationIndicator, supportsStudioCoreScene3D: () => supported,
    createScene3DObjectIndex, queryScene3DObjects, prepareScene3DParticleField, sampleScene3DParticleField,
    supportsStudioCoreScene3DParticles: () => options.particlesSupported !== false,
    createScene3DParticlePreview(container, ports) {
      ports.document.addEventListener = (...args) => ports.document.body.addEventListener(...args);
      ports.document.removeEventListener = (...args) => ports.document.body.removeEventListener(...args);
      return createScene3DParticlePreview(container, { ...ports, requestFrame: options.requestFrame || (() => 1), cancelFrame: options.cancelFrame || (() => {}) });
    },
    parseScene3DSource(raw) { parses++; if (options.parse) return options.parse(raw); if (raw !== 'valid') throw new Error('Invalid scene at /objects/0/size'); return parsed(); },
    createScene3DRenderer(canvas, ports) { if (options.rendererError) throw Error('Shader failed'); if (options.unsupported) return null;
      const renderer = { canvas, disposed: 0, resets: 0, focuses: [], ports, setModel(model) { renders.push(copy(model)); }, dispose() { this.disposed++; }, resetView() { this.resets++; },
        focusObject(id) { this.focuses.push(id); return options.focusResult !== false; } };
      if (options.particles) { renderer.supportsParticleFields = true; renderer.offsets = []; renderer.packets = [];
        renderer.setModel = (model, packet) => { renders.push(copy(model)); renderer.packets.push(copy(packet || {})); return true; };
        renderer.setParticleFieldOffset = offset => { renderer.offsets.push(copy(offset)); return options.particleDraw !== false; };
      }
      if (options.touchNavigation !== undefined) renderer.supportsTouchNavigation = options.touchNavigation;
      if (options.projectionModes) { renderer.projections = []; renderer.projectionMode = 'perspective'; renderer.setProjectionMode = mode => { renderer.projections.push(mode); if (options.projectionThrow) throw Error('Refused projection'); if (options.projectionError) ports.onError(Error('Projection draw failed')); if (options.projectionResult === false) return false; renderer.projectionMode = mode; return true; }; }
      if (options.dragModes) { renderer.modes = []; renderer.dragMode = 'orbit'; renderer.setDragMode = mode => { renderer.modes.push(mode); if (options.dragError) ports.onError(Error('Drag mode failed')); if (options.dragResult === false) return false; renderer.dragMode = mode; return true; }; }
      if (options.standardViews) { renderer.directions = []; renderer.setViewDirection = direction => { renderer.directions.push(direction); if (options.directionError) ports.onError(Error('Direction draw failed')); return options.directionResult ?? true; }; }
      if (options.wholeScene) { renderer.focusAllCalls = 0; renderer.focusAll = () => { renderer.focusAllCalls++; return options.allResult !== false; }; }
      if (options.selectionFeedback) {
        renderer.selections = []; renderer.selectedInstanceId = null; renderer.events = [];
        renderer.setModel = model => { renders.push(copy(model)); renderer.selectedInstanceId = null; renderer.events.push('model'); };
        renderer.setSelectedObject = id => { renderer.selections.push(id); renderer.selectedInstanceId = id; renderer.events.push('selection:' + id); return true; };
      }
      if (options.modelThrow) renderer.setModel = () => { throw Error('Model draw failed'); };
      if (options.viewNotifications) { const setModel = renderer.setModel.bind(renderer); renderer.setModel = model => { setModel(model); ports.onViewChange(Object.freeze({ camera: Object.freeze(copy(model.camera)), projectionMode: renderer.projectionMode || 'perspective' })); }; }
      instances.push(renderer); return renderer; },
    t: translate, translatePage(root) { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange(fn) { listener = fn; return () => { listener = () => {}; }; },
  });
  h.document.createElementNS = (_, tag) => h.document.createElement(tag);
  h.runtime.window.alert = value => errors.push(value);
  const controller = h.runtime.setupScene3DPreview({ getContext: () => context, async getSource() { loads++; if (options.source) return options.source(context);
    return { content, sourcePath: context.sourcePath, token: context.sourceToken }; },
    ...(options.locate ? { locateSource: async (snapshot, ports) => { navigationCalls.push({ snapshot, ports }); return options.locate(snapshot, ports, h); } } : {}) });
  const el = suffix => h.element('scene3d' + suffix), open = () => controller.open();
  const settle = async () => { await flushDialogs(); await flushDialogs(); };
  t.after(() => controller.dispose());
  return { ...h, controller, context, el, open, settle, renders, instances, errors, navigationCalls, loads: () => loads, parses: () => parses,
    setContent(value) { content = value; }, setSupported(value) { supported = value; }, setLanguage(value) { language = value; listener(); } };
}

test('independent 3D entry is available only to existing editing JSON source and supported core', async t => {
  const h = await fixture(t); assert.equal(h.el('PreviewBtn').hidden, false); assert.equal(h.el('PreviewBtn').disabled, false);
  for (const [key, value] of [['editable', false], ['creating', true], ['sourceJSON', false], ['sourcePath', '']]) {
    const old = h.context[key]; h.context[key] = value; h.controller.refresh(); assert.equal(h.el('PreviewBtn').hidden, true); assert.equal(await h.open(), false); h.context[key] = old;
  }
  h.setSupported(false); h.controller.refresh(); assert.equal(h.el('PreviewBtn').disabled, true); assert.equal(await h.open(), false); assert.equal(h.loads(), 0);
  assert.match(h.el('PreviewBtn').title, /原文编辑和2D/); assert.equal(h.el('Unavailable').hidden, false);
});
test('authored viewport aspect ratio is retained responsively after each valid source refresh', async t => {
  const next = parsed(); next.model.viewport = [1280, 720]; const h = await fixture(t, { parse: () => next }); await h.open();
  assert.equal(h.el('Surface').style.aspectRatio, '1280 / 720'); next.model.viewport = [400, 800]; h.context.sourceToken = '1:1'; h.el('Refresh').click(); await h.settle(); assert.equal(h.el('Surface').style.aspectRatio, '400 / 800');
});
test('saved and unsaved snapshots share the same read-only entry without any write callback', async t => {
  const h = await fixture(t); assert.equal(await h.open(), true); assert.equal(h.renders.length, 1);
  assert.equal(h.el('Source').textContent, h.context.sourcePath); assert.match(h.el('Status').textContent, /未修改原文/);
  assert.deepEqual(Object.keys(h.controller).sort(), ['close', 'destroy', 'dispose', 'open', 'refresh']);
  h.context.sourceToken = '1:1'; h.controller.refresh(); assert.match(h.el('Status').textContent, /上一次有效/); h.el('Refresh').click(); await h.settle(); assert.equal(h.renders.length, 2);
});
test('object selection retains authored UUIDs and inspectable exact UTF-16 source pointers', async t => {
  const h = await fixture(t); await h.open(); const choices = h.el('Objects').querySelectorAll('button');
  assert.deepEqual(choices.map(node => node.dataset.instanceId), [one, two]); assert.equal(choices[0].textContent, '<b>Blue box</b>');
  assert.match(h.el('Inspector').textContent, /\/objects\/0/); assert.match(h.el('Inspector').textContent, /50–120 \(UTF-16\)/);
  choices[1].click(); assert.match(h.el('Inspector').textContent, new RegExp(two)); assert.match(h.el('Inspector').textContent, /\/objects\/1/);
});
test('invalid initial source reports a diagnostic without allocating a renderer or claiming a draw', async t => {
  const h = await fixture(t); h.setContent('bad'); assert.equal(await h.open(), false); assert.equal(h.renders.length, 0); assert.equal(h.instances.length, 0);
  assert.match(h.el('Status').textContent, /不是有效/); assert.match(h.el('Diagnostics').textContent, /\/objects\/0\/size/); assert.equal(h.el('Fallback').hidden, true);
});
test('invalid changed source retains the last valid model, GPU view, object selection and source diagnostics', async t => {
  const h = await fixture(t); await h.open(); h.el('Objects').querySelectorAll('button')[1].click(); const renderer = h.instances[0];
  h.context.sourceToken = '1:1'; h.setContent('bad'); h.controller.refresh(); h.el('Refresh').click(); await h.settle();
  assert.equal(h.instances[0], renderer); assert.equal(renderer.disposed, 0); assert.equal(h.renders.length, 1); assert.match(h.el('Status').textContent, /保留上一次有效/);
  assert.match(h.el('Inspector').textContent, new RegExp(two)); assert.match(h.el('Diagnostics').textContent, /Invalid scene/);
});
test('unsupported WebGL2 still lists verified declarations and clearly states that no image was drawn', async t => {
  const h = await fixture(t, { unsupported: true }); assert.equal(await h.open(), true);
  assert.equal(h.el('Fallback').hidden, false); assert.equal(h.el('Reset').disabled, true); assert.match(h.el('Status').textContent, /未绘制/); assert.equal(h.el('Objects').querySelectorAll('button').length, 2);
});
test('shader initialization error becomes an explicit drawing diagnostic while declarations stay readable', async t => {
  const h = await fixture(t, { rendererError: true }); await h.open(); assert.match(h.el('Diagnostics').textContent, /Shader failed/); assert.equal(h.el('Fallback').hidden, false); assert.equal(h.el('Reset').disabled, true);
});
test('close releases the canvas and renderer once, returns focus and a reopen allocates a fresh renderer', async t => {
  const h = await fixture(t), opener = h.el('PreviewBtn'); opener.focus(); await h.open(); const oldCanvas = h.el('Canvas');
  h.el('Close').click(); await h.settle(); assert.equal(h.instances[0].disposed, 1); assert.equal(h.el('Dialog').open, false); assert.equal(h.el('Canvas'), null); assert.equal(h.document.activeElement, opener);
  await h.open(); assert.notEqual(h.el('Canvas'), oldCanvas); assert.equal(h.instances.length, 2);
});
test('native modal cancellation is read-only and immediately releases resources without a discard prompt', async t => {
  const h = await fixture(t); await h.open(); h.runtime.window.confirm = () => assert.fail('Camera views are not author edits');
  const event = h.el('Dialog').dispatch('cancel'); assert.equal(event.defaultPrevented, true); assert.equal(h.el('Dialog').open, false); assert.equal(h.instances[0].disposed, 1);
});
test('reset view calls only the renderer without loading source or changing owner token', async t => {
  const h = await fixture(t); await h.open(); const token = h.context.sourceToken; h.el('Reset').click(); assert.equal(h.instances[0].resets, 1); assert.equal(h.loads(), 1); assert.equal(h.context.sourceToken, token);
});
test('source path navigation closes the old view and releases its GPU resources', async t => {
  const h = await fixture(t); await h.open(); h.context.sourcePath = 'documents/scenes/other.json'; h.controller.refresh(); assert.equal(h.el('Dialog').open, false); assert.equal(h.instances[0].disposed, 1);
});
test('leaving existing source edit mode closes the old view without touching its document', async t => {
  const h = await fixture(t); await h.open(); h.context.editable = false; h.controller.refresh(); assert.equal(h.el('Dialog').open, false); assert.equal(h.instances[0].disposed, 1); assert.equal(h.context.sourceToken, '1:0');
});
test('late source success after child close cannot reopen or allocate a canvas', async t => {
  const gate = deferred(), h = await fixture(t, { source: () => gate.promise }); const pending = h.open(); h.controller.close(); gate.resolve({ content: 'valid', sourcePath: h.context.sourcePath, token: h.context.sourceToken });
  assert.equal(await pending, false); assert.equal(h.instances.length, 0); assert.equal(h.parses(), 0); assert.equal(h.el('Dialog').open, false);
});
test('late failure after closing or switching source is silent and does not attach old diagnostics', async t => {
  const gate = deferred(), h = await fixture(t, { source: () => gate.promise }); const pending = h.open(); h.context.sourcePath = 'other.json'; h.controller.refresh(); gate.reject(Error('old failure'));
  assert.equal(await pending, false); assert.deepEqual(h.errors, []); assert.equal(h.el('Diagnostics').textContent, ''); assert.equal(h.el('Dialog').open, false);
});
test('changed draft token across source await rejects a stale model and allows a fresh refresh', async t => {
  const gate = deferred(), h = await fixture(t, { source: () => gate.promise }); const pending = h.open(); h.context.sourceToken = '1:2'; gate.resolve({ content: 'valid', sourcePath: h.context.sourcePath, token: '1:0' });
  assert.equal(await pending, false); assert.equal(h.parses(), 0); assert.match(h.el('Status').textContent, /刷新当前草稿/); assert.equal(h.el('Refresh').disabled, false);
});
test('host snapshot path or token mismatch fails closed before parsing', async t => {
  const h = await fixture(t, { source: context => ({ content: 'valid', sourcePath: context.sourcePath, token: 'other' }) }); assert.equal(await h.open(), false); assert.equal(h.parses(), 0); assert.match(h.el('Diagnostics').textContent, /重新刷新/);
});
test('pending source load blocks repeat refresh and reset but always permits close', async t => {
  const gate = deferred(), h = await fixture(t, { source: () => gate.promise }); const pending = h.open(); h.el('Refresh').click(); h.el('Reset').click(); assert.equal(h.loads(), 1); assert.equal(h.el('Refresh').disabled, true); assert.equal(h.el('Close').disabled, false);
  h.el('Close').click(); gate.resolve(null); assert.equal(await pending, false);
});
test('lost native capability disables only this independent preview and retains existing author source', async t => {
  const h = await fixture(t); await h.open(); h.setSupported(false); h.controller.refresh(); assert.equal(h.el('Refresh').disabled, true); assert.equal(h.el('Dialog').open, true); assert.equal(h.instances[0].disposed, 0);
});
test('context loss is visible, blocks camera reset and does not claim a fresh draw', async t => {
  const h = await fixture(t); await h.open(); h.instances[0].ports.onError(Error('WebGL2 context lost.')); assert.match(h.el('Status').textContent, /绘制中断/); assert.equal(h.el('Reset').disabled, true); assert.equal(h.el('Fallback').hidden, false);
});
test('language refresh preserves object identity and translates the preview, controls and inspector', async t => {
  const h = await fixture(t); await h.open(); h.el('Objects').querySelectorAll('button')[1].click();
  for (const language of ['en', 'ja', 'zh']) { h.setLanguage(language); assert.equal(h.el('Refresh').textContent, ({ en, ja }[language]?.['刷新当前草稿'] || '刷新当前草稿')); assert.match(h.el('Inspector').textContent, new RegExp(two)); assert.equal(h.el('Inspector').querySelectorAll('dt')[0].textContent, { en: 'Name', ja: '名前', zh: '名称' }[language]); }
  assert.equal(h.loads(), 1); assert.equal(h.renders.length, 1);
});
test('dispose prevents reopening and late completions, and removes only its own elements', async t => {
  const gate = deferred(), h = await fixture(t, { source: () => gate.promise }); const pending = h.open(); h.controller.dispose(); h.controller.dispose(); gate.resolve(null);
  assert.equal(await pending, false); assert.equal(await h.open(), false); assert.equal(h.el('Dialog'), null); assert.equal(h.el('PreviewBtn'), null); assert.ok(h.element('projectBuildBtn'));
});
test('every new literal GUI message has English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene3d-preview.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/data-i18n="([^"]+)"|\bt\('([^']+)'\)|message = '([^']+)'/g)].map(match => match[1] || match[2] || match[3]).filter(Boolean));
  for (const key of keys) for (const locale of [en, ja]) assert.ok(locale[key], key);
});

test('read-only search trims and matches case-insensitive Unicode names or UUIDs without changing selected declarations', async t => {
  const h = await fixture(t); await h.open();
  h.el('Search').value = '  OTHER  '; h.el('Search').dispatch('input'); assert.deepEqual(h.el('Objects').querySelectorAll('button').map(node => node.dataset.instanceId), [two]);
  assert.match(h.el('Matches').textContent, /1 \/ 2/); assert.equal(h.el('SelectionHidden').hidden, false); assert.match(h.el('Inspector').textContent, new RegExp(one));
  h.el('Search').value = two.slice(-8).toUpperCase(); h.el('Search').dispatch('input'); assert.equal(h.el('Objects').querySelectorAll('button')[0].dataset.instanceId, two);
  const scene = parsed(); scene.model.objects[1].name = '雪É😀 <script>literal</script>'; const unicode = await fixture(t, { parse: () => scene }); await unicode.open();
  unicode.el('Search').value = 'é😀'; unicode.el('Search').dispatch('input'); assert.equal(unicode.el('Objects').querySelectorAll('button')[0].textContent, scene.model.objects[1].name); assert.equal(unicode.el('Objects').querySelectorAll('script').length, 0);
  assert.equal(h.loads(), 1); assert.equal(h.renders.length, 1); assert.equal(h.context.sourceToken, '1:0');
});
test('empty results keep inspector selection and clearing search restores the same pressed UUID', async t => {
  const h = await fixture(t); await h.open(); h.el('Objects').querySelectorAll('button')[1].click();
  h.el('Search').value = 'missing'; h.el('Search').dispatch('input'); assert.equal(h.el('Objects').children.length, 0); assert.equal(h.el('NoResults').hidden, false); assert.equal(h.el('SelectionHidden').hidden, false);
  assert.match(h.el('Inspector').textContent, new RegExp(two)); h.el('ClearSearch').click(); assert.equal(h.el('Search').value, ''); assert.equal(h.el('NoResults').hidden, true); assert.equal(h.el('SelectionHidden').hidden, true);
  const selected = h.el('Objects').querySelectorAll('button').find(node => node.dataset.instanceId === two); assert.equal(selected.getAttribute('aria-pressed'), 'true'); assert.equal(h.document.activeElement, h.el('Search'));
});
test('valid refresh keeps a UUID through reorder and falls back to a remaining object after deletion without clearing the filter', async t => {
  let scene = parsed(); const h = await fixture(t, { parse: () => scene }); await h.open(); h.el('Objects').querySelectorAll('button')[1].click();
  h.el('Search').value = 'Other'; h.el('Search').dispatch('input'); scene = parsed(); scene.model.objects.reverse(); scene.sourceLocations.objects.reverse(); h.context.sourceToken = '1:1'; h.el('Refresh').click(); await h.settle();
  assert.match(h.el('Inspector').textContent, new RegExp(two)); assert.equal(h.el('Search').value, 'Other'); assert.equal(h.el('Objects').querySelectorAll('button')[0].getAttribute('aria-pressed'), 'true');
  scene = parsed(); scene.model.objects.pop(); scene.sourceLocations.objects.pop(); h.context.sourceToken = '1:2'; h.el('Refresh').click(); await h.settle(); assert.match(h.el('Inspector').textContent, new RegExp(one)); assert.equal(h.el('SelectionHidden').hidden, false);
  h.el('ClearSearch').click(); assert.equal(h.el('Objects').querySelectorAll('button')[0].dataset.instanceId, one); assert.equal(h.el('Objects').querySelectorAll('button')[0].getAttribute('aria-pressed'), 'true');
});
test('search handles all 128 declared objects with stable IDs, exact counts and a bounded visible results list', async t => {
  const scene = parsed(), base = scene.model.objects[0]; scene.model.objects = Array.from({ length: 128 }, (_, i) => ({ ...copy(base), instanceId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, name: `Box ${i + 1} 雪` }));
  scene.sourceLocations.objects = scene.model.objects.map((item, i) => ({ instanceId: item.instanceId, propertyPath: `/objects/${i}`, sourceRange: { start: 50 + i * 10, end: 59 + i * 10, encoding: 'utf-16', exact: true } }));
  const h = await fixture(t, { parse: () => scene }); await h.open(); assert.equal(h.el('Objects').querySelectorAll('button').length, 128); assert.match(h.el('Matches').textContent, /128 \/ 128/);
  h.el('Search').value = 'Box 128'; h.el('Search').dispatch('input'); const found = h.el('Objects').querySelectorAll('button'); assert.equal(found.length, 1); assert.equal(found[0].dataset.instanceId, scene.model.objects[127].instanceId);
  found[0].click(); assert.match(h.el('Inspector').textContent, /\/objects\/127/); assert.match(h.el('Matches').textContent, /1 \/ 128/);
});
test('language switching preserves raw filter and hidden selection without a new parse or renderer model', async t => {
  const h = await fixture(t); await h.open(); h.el('Objects').querySelectorAll('button')[1].click(); h.el('Search').value = '  BLUE  '; h.el('Search').dispatch('input');
  for (const language of ['en', 'ja', 'zh']) { h.setLanguage(language); assert.equal(h.el('Search').value, '  BLUE  '); assert.match(h.el('Inspector').textContent, new RegExp(two)); assert.equal(h.el('SelectionHidden').hidden, false); assert.match(h.el('Matches').textContent, /1 \/ 2/); }
  assert.equal(h.loads(), 1); assert.equal(h.parses(), 1); assert.equal(h.renders.length, 1);
});
test('focus targets the selected UUID even outside results and changes only the renderer temporary view', async t => {
  const h = await fixture(t); await h.open(); h.el('Objects').querySelectorAll('button')[1].click(); h.el('Search').value = 'Blue'; h.el('Search').dispatch('input'); h.el('Focus').click();
  assert.deepEqual(h.instances[0].focuses, [two]); assert.match(h.el('Status').textContent, /仅改变临时视角/); assert.equal(h.loads(), 1); assert.equal(h.context.sourceToken, '1:0'); assert.equal(h.navigationCalls.length, 0);
  const rejected = await fixture(t, { focusResult: false }); await rejected.open(); rejected.el('Focus').click(); assert.match(rejected.el('Status').textContent, /无法聚焦/);
  const unsupported = await fixture(t, { unsupported: true }); await unsupported.open(); assert.equal(unsupported.el('Focus').disabled, true);
  h.instances[0].ports.onError(Error('context lost')); assert.equal(h.el('Focus').disabled, true);
});
test('source navigation is optional and never exposes source write or Save ports', async t => {
  const h = await fixture(t); await h.open(); assert.equal(h.el('Locate').disabled, true); assert.match(h.el('Locate').title, /未提供/); h.el('Locate').click(); await h.settle(); assert.equal(h.navigationCalls.length, 0);
  const source = await fs.readFile(new URL('../../web/modules/app-scene3d-preview.js', import.meta.url), 'utf8'); assert.equal(/applyDraft|World|saveDraft|createScene3D.*Proposal/.test(source.replace(/\/\/[^\n]*/g, '')), false);
});
test('exact read-only navigation snapshot and UUID remain guarded until receipt then focus occurs after modal close', async t => {
  const gate = deferred(); let focused = 0; const h = await fixture(t, { locate: (snapshot, ports) => { assert.equal(Object.isFrozen(snapshot), true); assert.deepEqual(copy(snapshot), { sourcePath: 'documents/scenes/boxes.json', token: '1:0', content: 'valid' }); assert.equal(ports.instanceId, two); assert.equal(ports.isCurrent(), true); return gate.promise; } });
  h.el('PreviewBtn').focus(); await h.open(); h.el('Objects').querySelectorAll('button')[1].click(); h.el('Locate').click(); assert.equal(h.el('Locate').disabled, true); assert.equal(h.el('Refresh').disabled, true); assert.equal(h.el('Search').disabled, true); assert.equal(h.el('Focus').disabled, true); assert.equal(h.el('Close').disabled, false);
  gate.resolve(Object.freeze({ located: true, focus() { focused++; assert.equal(h.el('Dialog').open, false); h.element('projectBuildBtn').focus(); return true; } })); await h.settle(); assert.equal(focused, 1); assert.equal(h.el('Dialog').open, false); assert.equal(h.document.activeElement, h.element('projectBuildBtn')); assert.equal(h.instances[0].disposed, 1); assert.equal(h.context.sourceToken, '1:0');
});
test('false, malformed or throwing navigation receipts retain the dialog and explain that current source must be refreshed', async t => {
  for (const receipt of [false, true, {}, { located: false }, Object.freeze({ located: true }), Object.freeze({ located: true, focus: 'forged' }), { located: true, focus() {} }, Object.freeze({ located: true, focus() {}, extra: true }), Object.freeze({ get located() { throw Error('Getter must never execute'); }, focus() {} })]) { const h = await fixture(t, { locate: () => receipt }); await h.open(); h.el('Locate').click(); await h.settle(); assert.equal(h.el('Dialog').open, true); assert.match(h.el('Status').textContent, /未确认.*刷新/); assert.equal(h.el('Locate').disabled, false); }
  const rejected = await fixture(t, { locate: () => { throw Error('Current bytes changed'); } }); await rejected.open(); rejected.el('Locate').click(); await rejected.settle(); assert.match(rejected.el('Diagnostics').textContent, /Current bytes/); assert.equal(rejected.el('Dialog').open, true);
});
test('stale preview token or busy source disables navigation while declarations and focus remain read-only', async t => {
  const h = await fixture(t, { locate: () => assert.fail('Stale preview must never call host navigation') }); await h.open(); h.context.sourceToken = '1:1'; h.controller.refresh(); assert.equal(h.el('Locate').disabled, true); h.el('Locate').click(); await h.settle(); assert.equal(h.navigationCalls.length, 0); assert.equal(h.el('Focus').disabled, false);
  h.context.sourceToken = '1:0'; h.context.busy = true; h.controller.refresh(); h.el('Locate').click(); await h.settle(); assert.equal(h.navigationCalls.length, 0); assert.equal(h.el('Locate').disabled, true);
});
test('late navigation after close and reopen cannot focus or close a new owner session', async t => {
  const gate = deferred(); let focused = 0; const h = await fixture(t, { locate: () => gate.promise }); await h.open(); h.el('Locate').click(); const old = h.navigationCalls[0]; h.el('Close').click(); assert.equal(old.ports.isCurrent(), false);
  await h.open(); gate.resolve(Object.freeze({ located: true, focus() { focused++; return true; } })); await h.settle(); assert.equal(focused, 0); assert.equal(h.el('Dialog').open, true); assert.equal(h.instances.length, 2); assert.equal(h.instances[1].disposed, 0);
});
test('token, path, busy and silent query changes across navigation await revoke the host owner and late focus', async t => {
  for (const change of ['token', 'path', 'busy', 'query', 'capability']) { const gate = deferred(); let focused = 0; const h = await fixture(t, { locate: () => gate.promise }); await h.open(); h.el('Locate').click();
    if (change === 'token') h.context.sourceToken = 'new'; if (change === 'path') h.context.sourcePath = 'other.json'; if (change === 'busy') h.context.busy = true; if (change === 'query') h.el('Search').value = 'silent'; if (change === 'capability') h.setSupported(false);
    assert.equal(h.navigationCalls[0].ports.isCurrent(), false); gate.resolve(Object.freeze({ located: true, focus() { focused++; return true; } })); await h.settle(); assert.equal(focused, 0); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Locate').disabled, change !== 'query'); }
});
test('duplicate navigation, result-list clicks and language callbacks cannot consume a pending receipt or change its target', async t => {
  const gate = deferred(); const h = await fixture(t, { locate: () => gate.promise }); await h.open(); h.el('Locate').click(); h.el('Locate').click(); h.el('Objects').querySelectorAll('button')[1].click(); h.el('ClearSearch').click(); h.el('Refresh').click(); h.el('Focus').click();
  assert.equal(h.navigationCalls.length, 1); assert.equal(h.navigationCalls[0].ports.instanceId, one); h.setLanguage('ja'); assert.equal(h.navigationCalls[0].ports.isCurrent(), true); assert.match(h.el('Inspector').textContent, new RegExp(one));
  gate.resolve(false); await h.settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Locate').disabled, false); assert.equal(h.loads(), 1); assert.equal(h.instances[0].focuses.length, 0);
});
test('late navigation failures after close or disposal remain silent and resources are released exactly once', async t => {
  const gate = deferred(), h = await fixture(t, { locate: () => gate.promise }); await h.open(); h.el('Locate').click(); h.controller.dispose(); gate.reject(Error('Late navigation')); await h.settle(); assert.deepEqual(h.errors, []); assert.equal(h.instances[0].disposed, 1); assert.equal(h.el('Dialog'), null);
});

test('rebuilding the object list retains the focused stable button after selection and language changes without stealing search focus', async t => {
  const h = await fixture(t); await h.open(); const old = h.el('Objects').querySelectorAll('button')[1]; old.focus(); old.click();
  assert.notEqual(h.document.activeElement, old); assert.equal(h.document.activeElement.dataset.instanceId, two); assert.equal(h.document.activeElement.getAttribute('aria-pressed'), 'true');
  h.setLanguage('en'); assert.equal(h.document.activeElement.dataset.instanceId, two); h.el('Search').focus(); h.el('Search').value = 'Blue'; h.el('Search').dispatch('input'); assert.equal(h.document.activeElement, h.el('Search'));
});
test('owner loss while navigation is pending ends the progress message and keeps a retryable declaration view', async t => {
  for (const lose of ['token', 'silent-query']) { const gate = deferred(), h = await fixture(t, { locate: () => gate.promise }); await h.open(); h.el('Locate').click(); assert.match(h.el('Status').textContent, /正在定位/);
    if (lose === 'token') h.context.sourceToken = 'new'; else h.el('Search').value = 'new-filter'; gate.resolve(Object.freeze({ located: true, focus: () => assert.fail('Stale completion must not focus') })); await h.settle();
    assert.equal(h.el('Dialog').open, true); assert.match(h.el('Status').textContent, /未确认.*刷新/); assert.doesNotMatch(h.el('Status').textContent, /正在定位/); assert.equal(h.el('Close').disabled, false);
  }
});

test('reset status replaces focused view in all languages while retaining read-only selection and source ownership', async t => {
  const h = await fixture(t); await h.open(); h.el('Objects').querySelectorAll('button')[1].click();
  h.el('Search').value = 'Other'; h.el('Search').dispatch('input'); h.el('Focus').click();
  assert.match(h.el('Status').textContent, /已聚焦/);
  const owner = copy(h.context); h.el('Reset').click();
  const key = '视角已重置为作者相机；原文保持不变。';
  assert.equal(h.el('Status').textContent, key); assert.equal(h.instances[0].resets, 1);
  for (const [language, dictionary] of [['en', en], ['ja', ja]]) {
    h.setLanguage(language); assert.equal(h.el('Status').textContent, dictionary[key]);
    assert.equal(h.el('Search').value, 'Other'); assert.ok(h.el('Inspector').textContent.includes(two));
  }
  assert.deepEqual(h.context, owner); assert.equal(h.loads(), 1); assert.equal(h.renders.length, 1);
});

test('canvas selection shares the stable UUID inspector and filtered list without changing source or camera', async t => {
  const h = await fixture(t); await h.open(); const owner = copy(h.context), renderer = h.instances[0];
  h.el('Search').value = 'Blue'; h.el('Search').dispatch('input'); h.el('Search').focus();
  assert.equal(renderer.ports.onPick(two, { focus: false }), true);
  assert.match(h.el('Inspector').textContent, new RegExp(two)); assert.equal(h.el('SelectionHidden').hidden, false);
  assert.equal(h.el('Search').value, 'Blue'); assert.equal(h.document.activeElement, h.el('Search'));
  assert.deepEqual(h.el('Objects').querySelectorAll('button').map(node => node.dataset.instanceId), [one]);
  assert.deepEqual(renderer.focuses, []); assert.equal(h.loads(), 1); assert.equal(h.renders.length, 1);
  assert.deepEqual(h.context, owner); assert.equal(h.navigationCalls.length, 0);
  h.el('ClearSearch').click(); assert.equal(h.el('Objects').querySelectorAll('button')[1].getAttribute('aria-pressed'), 'true');
});
test('blank, missing and unknown canvas picks retain selection and do not consume source navigation', async t => {
  const h = await fixture(t); await h.open(); const renderer = h.instances[0]; renderer.ports.onPick(two, { focus: false });
  for (const id of [null, undefined, '', 'unknown', 1, {}]) assert.equal(renderer.ports.onPick(id, { focus: true }), false);
  assert.match(h.el('Inspector').textContent, new RegExp(two)); assert.deepEqual(renderer.focuses, []);
  assert.equal(h.loads(), 1); assert.equal(h.navigationCalls.length, 0);
});
test('double-click focus hints accept only an own literal true value without reading getters', async t => {
  const h = await fixture(t); await h.open(); const renderer = h.instances[0]; let getters = 0;
  for (const hint of [undefined, null, true, { focus: 'true' }, { focus: 1 }, Object.create({ focus: true }), { get focus() { getters++; return true; } }]) {
    assert.equal(renderer.ports.onPick(two, hint), true); assert.deepEqual(renderer.focuses, []);
  }
  assert.equal(getters, 0); assert.equal(renderer.ports.onPick(two, Object.freeze({ focus: true })), true);
  assert.deepEqual(renderer.focuses, [two]); assert.match(h.el('Status').textContent, /已聚焦.*仅改变临时视角/);
  assert.equal(h.context.sourceToken, '1:0'); assert.equal(h.loads(), 1);
});
test('source refresh locks canvas picks and then binds the retained renderer to the new valid model', async t => {
  const gate = deferred(); let reads = 0; const h = await fixture(t, { source: context => ++reads === 1
    ? { content: 'valid', sourcePath: context.sourcePath, token: context.sourceToken } : gate.promise });
  await h.open(); const renderer = h.instances[0]; h.el('Refresh').click();
  assert.equal(renderer.ports.onPick(two, { focus: true }), false); assert.match(h.el('Inspector').textContent, new RegExp(one));
  gate.resolve({ content: 'valid', sourcePath: h.context.sourcePath, token: h.context.sourceToken }); await h.settle();
  assert.equal(h.instances[0], renderer); assert.equal(renderer.ports.onPick(two, { focus: false }), true);
  assert.match(h.el('Inspector').textContent, new RegExp(two)); assert.deepEqual(renderer.focuses, []);
});
test('canvas picks cannot change a UUID or focus while its source locator receipt is pending', async t => {
  const gate = deferred(), h = await fixture(t, { locate: () => gate.promise }); await h.open(); h.el('Locate').click();
  assert.equal(h.instances[0].ports.onPick(two, { focus: true }), false); assert.equal(h.navigationCalls[0].ports.instanceId, one);
  assert.equal(h.navigationCalls[0].ports.isCurrent(), true); assert.deepEqual(h.instances[0].focuses, []);
  gate.resolve(false); await h.settle(); assert.match(h.el('Inspector').textContent, new RegExp(one));
});
test('closed and replaced canvas callbacks cannot select or report errors in a reopened owner', async t => {
  const h = await fixture(t); await h.open(); const old = h.instances[0]; h.el('Close').click();
  assert.equal(old.ports.onPick(two, { focus: true }), false); await h.open();
  assert.equal(old.ports.onPick(two, { focus: true }), false); old.ports.onError(Error('old context lost'));
  assert.match(h.el('Inspector').textContent, new RegExp(one)); assert.equal(h.el('Diagnostics').textContent, '');
  assert.equal(h.instances[1].ports.onPick(two, { focus: false }), true); assert.equal(h.instances[1].disposed, 0);
});
test('disposal and current drawing failure invalidate the optional canvas selection callback', async t => {
  const h = await fixture(t); await h.open(); const renderer = h.instances[0]; renderer.ports.onError(Error('context lost'));
  assert.equal(renderer.ports.onPick(two, { focus: true }), false); assert.match(h.el('Inspector').textContent, new RegExp(one));
  // A lost GPU does not remove independently inspectable author declarations.
  h.el('Objects').querySelectorAll('button')[1].click(); assert.match(h.el('Inspector').textContent, new RegExp(two));
  h.controller.dispose(); assert.equal(renderer.ports.onPick(one, { focus: true }), false); assert.equal(renderer.disposed, 1);
});
test('canvas picks require the current eligible document path and native capability without implicit source reload', async t => {
  for (const [key, value] of [['editable', false], ['creating', true], ['sourceJSON', false], ['sourcePath', 'other.json']]) {
    const h = await fixture(t); await h.open(); h.context[key] = value;
    assert.equal(h.instances[0].ports.onPick(two, { focus: true }), false); assert.match(h.el('Inspector').textContent, new RegExp(one)); assert.equal(h.loads(), 1);
  }
  const h = await fixture(t); await h.open(); h.setSupported(false);
  assert.equal(h.instances[0].ports.onPick(two, { focus: true }), false); assert.equal(h.loads(), 1);
});
test('stale source permits last-valid visual selection and focus while keeping strict source navigation disabled', async t => {
  const h = await fixture(t, { locate: () => assert.fail('Stale visual selection must never navigate source') }); await h.open();
  h.context.sourceToken = '1:1'; h.controller.refresh(); assert.equal(h.instances[0].ports.onPick(two, { focus: false }), true);
  assert.match(h.el('Status').textContent, /上一次有效/); assert.equal(h.el('Locate').disabled, true);
  assert.equal(h.instances[0].ports.onPick(two, { focus: true }), true); assert.deepEqual(h.instances[0].focuses, [two]);
  h.el('Locate').click(); await h.settle(); assert.equal(h.navigationCalls.length, 0); assert.equal(h.context.sourceToken, '1:1');
});
test('invalid newer source retains visual selection against the last admitted model and its native diagnostic', async t => {
  const h = await fixture(t, { locate: () => assert.fail('Invalid source must not use old declaration ranges') }); await h.open();
  h.context.sourceToken = '1:1'; h.setContent('bad'); h.el('Refresh').click(); await h.settle();
  assert.equal(h.instances[0].ports.onPick(two, { focus: false }), true); assert.match(h.el('Inspector').textContent, new RegExp(two));
  assert.match(h.el('Status').textContent, /保留上一次有效/); assert.match(h.el('Diagnostics').textContent, /Invalid scene/);
  assert.equal(h.el('Locate').disabled, true); assert.equal(h.renders.length, 1); assert.equal(h.navigationCalls.length, 0);
});
test('refresh removes old model identities while reset keeps selection and accepts only later current canvas taps', async t => {
  const scene = parsed(), h = await fixture(t, { parse: () => scene }); await h.open(); const renderer = h.instances[0];
  renderer.ports.onPick(two, { focus: false }); h.el('Reset').click(); assert.match(h.el('Inspector').textContent, new RegExp(two));
  assert.equal(renderer.resets, 1); assert.equal(renderer.ports.onPick(one, { focus: false }), true);
  scene.model.objects = scene.model.objects.slice(0, 1); scene.sourceLocations.objects = scene.sourceLocations.objects.slice(0, 1);
  h.context.sourceToken = '1:1'; h.el('Refresh').click(); await h.settle();
  assert.equal(renderer.ports.onPick(two, { focus: true }), false); assert.match(h.el('Inspector').textContent, new RegExp(one));
  assert.deepEqual(renderer.focuses, []); assert.equal(h.renders.length, 2);
});
test('canvas gesture help is translated and accessible while language changes retain query and picked UUID', async t => {
  const h = await fixture(t); await h.open(); h.el('Search').value = 'Blue'; h.el('Search').dispatch('input'); h.instances[0].ports.onPick(two, { focus: false });
  const key = '单击方块选择，双击聚焦；拖动旋转视角，滚轮缩放。Y轴向上，右手坐标系，欧拉旋转XYZ。';
  assert.equal(h.el('Canvas').getAttribute('aria-describedby'), 'scene3dGestures');
  for (const [language, dictionary] of [['en', en], ['ja', ja]]) {
    h.setLanguage(language); assert.equal(h.el('Gestures').textContent, dictionary[key]);
    assert.equal(h.el('Search').value, 'Blue'); assert.match(h.el('Inspector').textContent, new RegExp(two)); assert.equal(h.el('SelectionHidden').hidden, false);
  }
  assert.equal(h.loads(), 1); assert.equal(h.renders.length, 1);
});

test('initial native model synchronizes its first stable UUID to optional renderer feedback after model reset', async t => {
  const h = await fixture(t, { selectionFeedback: true }); await h.open(); const renderer = h.instances[0];
  assert.deepEqual(renderer.events, ['model', 'selection:' + one]); assert.equal(renderer.selectedInstanceId, one);
  assert.equal(h.el('Objects').querySelectorAll('button')[0].getAttribute('aria-pressed'), 'true');
  assert.match(h.el('Inspector').textContent, new RegExp(one)); assert.equal(h.loads(), 1); assert.equal(h.context.sourceToken, '1:0');
});
test('list and canvas use one selection UUID and synchronize only actual selection changes without author ports', async t => {
  const h = await fixture(t, { selectionFeedback: true }); await h.open(); const renderer = h.instances[0], owner = copy(h.context);
  h.el('Objects').querySelectorAll('button')[1].click(); assert.equal(renderer.selectedInstanceId, two);
  renderer.ports.onPick(one, { focus: false }); assert.equal(renderer.selectedInstanceId, one);
  assert.deepEqual(renderer.selections, [one, two, one]); assert.match(h.el('Inspector').textContent, new RegExp(one));
  assert.deepEqual(h.context, owner); assert.equal(h.loads(), 1); assert.equal(h.navigationCalls.length, 0); assert.deepEqual(renderer.focuses, []);
});
test('repeated selection and qualified double-click focus do not resubmit an unchanged UUID or reset the model', async t => {
  const h = await fixture(t, { selectionFeedback: true }); await h.open(); const renderer = h.instances[0];
  renderer.ports.onPick(two, { focus: false }); renderer.ports.onPick(two, { focus: false });
  renderer.ports.onPick(two, { focus: true }); h.el('Objects').querySelectorAll('button')[1].click();
  assert.deepEqual(renderer.selections, [one, two]); assert.deepEqual(renderer.focuses, [two]); assert.equal(h.renders.length, 1);
  h.el('Reset').click(); assert.equal(renderer.selectedInstanceId, two); assert.deepEqual(renderer.selections, [one, two]);
});
test('filtering out a selected object and language or view repaint retain feedback without redundant setter calls', async t => {
  const h = await fixture(t, { selectionFeedback: true }); await h.open(); const renderer = h.instances[0];
  renderer.ports.onPick(two, { focus: false }); h.el('Search').value = 'Blue'; h.el('Search').dispatch('input');
  for (const language of ['en', 'ja', 'zh']) { h.setLanguage(language); h.controller.refresh(); assert.equal(renderer.selectedInstanceId, two); assert.equal(h.el('SelectionHidden').hidden, false); }
  h.el('ClearSearch').click(); assert.deepEqual(renderer.selections, [one, two]); assert.equal(h.renders.length, 1); assert.equal(h.loads(), 1);
});
test('successful reordered and deleted models resynchronize selection once after each model replacement', async t => {
  let scene = parsed(); const h = await fixture(t, { selectionFeedback: true, parse: () => scene }); await h.open(); const renderer = h.instances[0];
  renderer.ports.onPick(two, { focus: false }); scene = parsed(); scene.model.objects.reverse(); scene.sourceLocations.objects.reverse();
  h.context.sourceToken = '1:1'; h.el('Refresh').click(); await h.settle(); assert.equal(renderer.selectedInstanceId, two);
  assert.deepEqual(renderer.events.slice(-2), ['model', 'selection:' + two]);
  scene = parsed(); scene.model.objects.pop(); scene.sourceLocations.objects.pop(); h.context.sourceToken = '1:2'; h.el('Refresh').click(); await h.settle();
  assert.equal(renderer.selectedInstanceId, one); assert.deepEqual(renderer.events.slice(-2), ['model', 'selection:' + one]);
  assert.deepEqual(renderer.selections, [one, two, two, one]); assert.equal(h.renders.length, 3);
});
test('last-valid visual feedback remains selectable after invalid or stale source without granting source navigation', async t => {
  const h = await fixture(t, { selectionFeedback: true, locate: () => assert.fail('Stale outline must not locate source') }); await h.open(); const renderer = h.instances[0];
  h.context.sourceToken = '1:1'; h.controller.refresh(); renderer.ports.onPick(two, { focus: false }); assert.equal(renderer.selectedInstanceId, two); assert.equal(h.el('Locate').disabled, true);
  h.setContent('invalid'); h.el('Refresh').click(); await h.settle(); renderer.ports.onPick(one, { focus: false });
  assert.equal(renderer.selectedInstanceId, one); assert.equal(h.renders.length, 1); assert.match(h.el('Status').textContent, /保留上一次有效/);
  h.el('Locate').click(); await h.settle(); assert.equal(h.navigationCalls.length, 0); assert.deepEqual(renderer.selections, [one, two, one]);
});
test('old canvas selection callbacks cannot change feedback after close and a new renderer starts with its own selection', async t => {
  const h = await fixture(t, { selectionFeedback: true }); await h.open(); const old = h.instances[0]; old.ports.onPick(two, { focus: false });
  h.controller.close(); await h.open(); const current = h.instances[1]; assert.equal(old.ports.onPick(one, { focus: true }), false);
  assert.deepEqual(old.selections, [one, two]); assert.deepEqual(current.selections, [one]); assert.equal(current.selectedInstanceId, one);
  h.controller.dispose(); assert.equal(current.ports.onPick(two, { focus: false }), false); assert.deepEqual(current.selections, [one]);
});
test('pending ownership and failed drawing cannot deliver an invalid feedback change while declarations remain readable', async t => {
  const gate = deferred(); let reads = 0; const h = await fixture(t, { selectionFeedback: true, source: context => ++reads === 1 ? { content: 'valid', sourcePath: context.sourcePath, token: context.sourceToken } : gate.promise });
  await h.open(); const renderer = h.instances[0]; h.el('Refresh').click(); assert.equal(renderer.ports.onPick(two, { focus: false }), false); assert.deepEqual(renderer.selections, [one]);
  gate.resolve({ content: 'valid', sourcePath: h.context.sourcePath, token: h.context.sourceToken }); await h.settle();
  renderer.ports.onError(Error('context lost')); assert.equal(renderer.ports.onPick(two, { focus: false }), false); h.el('Objects').querySelectorAll('button')[1].click();
  assert.match(h.el('Inspector').textContent, new RegExp(two)); assert.deepEqual(renderer.selections, [one, one]);
});
test('selection edge help explicitly describes occlusion and translates without changing the selected view', async t => {
  const h = await fixture(t, { selectionFeedback: true }); await h.open(); const renderer = h.instances[0];
  const key = '选中方块的可见边缘会高亮；被遮挡的部分不会透视显示。选择只影响预览，不修改原文。';
  assert.equal(h.el('SelectionNote').textContent, key);
  for (const [language, dictionary] of [['en', en], ['ja', ja]]) { h.setLanguage(language); assert.equal(h.el('SelectionNote').textContent, dictionary[key]); }
  assert.deepEqual(renderer.selections, [one]); assert.equal(h.loads(), 1); assert.equal(h.renders.length, 1);
});

test('whole-scene framing uses the complete rendered model, retaining filtered selection and source authority', async t => {
  const h = await fixture(t, { wholeScene: true, selectionFeedback: true }); await h.open();
  h.el('Objects').querySelectorAll('button')[1].click(); h.el('Search').value='Blue'; h.el('Search').dispatch('input');
  const before=copy({ context:h.context,models:h.renders,selections:h.instances[0].selections });
  assert.equal(h.el('FocusAll').disabled,false);h.el('FocusAll').click();
  assert.equal(h.instances[0].focusAllCalls,1);assert.equal(h.loads(),1);assert.equal(h.parses(),1);
  assert.equal(h.el('Search').value,'Blue');assert.equal(h.el('SelectionHidden').hidden,false);
  assert.deepEqual({ context:h.context,models:h.renders,selections:h.instances[0].selections },before);
  assert.match(h.el('Status').textContent,/当前预览的全部对象/);
});
test('optional whole-scene renderer method only gates its own control', async t => {
  const h=await fixture(t);await h.open();assert.equal(h.el('FocusAll').disabled,true);
  assert.equal(h.el('Focus').disabled,false);assert.equal(h.el('Reset').disabled,false);
  h.el('FocusAll').dispatch('click');assert.equal(h.loads(),1);
});
test('whole-scene framing checks current workspace context even before a UI refresh', async t => {
  const h=await fixture(t,{wholeScene:true});await h.open();const renderer=h.instances[0];
  for(const[key,value]of [['sourcePath','documents/other.json'],['editable',false],['creating',true],['sourceJSON',false],['busy',true]]){
    const before=h.context[key];h.context[key]=value;h.el('FocusAll').dispatch('click');assert.equal(renderer.focusAllCalls,0,key);h.context[key]=before;
  }
  h.setSupported(false);h.el('FocusAll').dispatch('click');assert.equal(renderer.focusAllCalls,0);h.setSupported(true);
  h.controller.close();h.el('FocusAll').dispatch('click');assert.equal(renderer.focusAllCalls,0);
  h.controller.dispose();h.el('FocusAll')?.dispatch('click');assert.equal(renderer.focusAllCalls,0);
});
test('whole-scene framing is disabled throughout asynchronous refresh and after renderer failure', async t => {
  const gate=deferred();let next=false;const h=await fixture(t,{wholeScene:true,source:context=>next?gate.promise:{content:'valid',sourcePath:context.sourcePath,token:context.sourceToken}});
  await h.open();next=true;h.el('Refresh').click();assert.equal(h.el('FocusAll').disabled,true);h.el('FocusAll').dispatch('click');assert.equal(h.instances[0].focusAllCalls,0);
  gate.resolve({content:'valid',sourcePath:h.context.sourcePath,token:h.context.sourceToken});await h.settle();assert.equal(h.el('FocusAll').disabled,false);
  h.instances[0].ports.onError(Error('Context lost'));assert.equal(h.el('FocusAll').disabled,true);h.el('FocusAll').dispatch('click');assert.equal(h.instances[0].focusAllCalls,0);
});
test('whole-scene framing can inspect the last valid model while a changed draft remains unlocated and unsaved', async t => {
  const h=await fixture(t,{wholeScene:true});await h.open();h.context.sourceToken='new-draft';h.setContent('bad');h.controller.refresh();h.el('Refresh').click();await h.settle();
  const loads=h.loads();h.el('FocusAll').click();assert.equal(h.instances[0].focusAllCalls,1);assert.equal(h.loads(),loads);assert.equal(h.renders.length,1);assert.equal(h.el('Locate').disabled,true);
  assert.match(h.el('Diagnostics').textContent,/Invalid scene/);assert.match(h.el('Status').textContent,/当前预览/);
});
test('whole-scene framing messages translate and refusal preserves current model without extra source reads', async t => {
  const h=await fixture(t,{wholeScene:true,allResult:false});await h.open();const modelBefore=copy(h.renders);
  for(const language of ['zh','en','ja']){
    h.setLanguage(language);h.el('FocusAll').click();const dictionary={en,ja}[language];
    assert.equal(h.el('FocusAll').textContent,dictionary?.['聚焦全部对象']||'聚焦全部对象');
    const message='无法聚焦全部对象，当前视角与原文保持不变。';assert.equal(h.el('Status').textContent,dictionary?.[message]||message);
  }
  assert.equal(h.loads(),1);assert.deepEqual(h.renders,modelBefore);
});
test('no-WebGL fallback leaves whole-scene framing disabled and declarations available', async t => {
  const h=await fixture(t,{unsupported:true,wholeScene:true});await h.open();assert.equal(h.el('FocusAll').disabled,true);assert.equal(h.el('Objects').querySelectorAll('button').length,2);assert.equal(h.el('Fallback').hidden,false);
});


test('whole-scene framing preserves a synchronous GPU error instead of reporting an ordinary refusal', async t => {
  const h=await fixture(t,{wholeScene:true});await h.open();const renderer=h.instances[0];
  renderer.focusAll=()=>{renderer.ports.onError(Error('Partial GPU draw failed'));return false;};
  h.el('FocusAll').click();assert.match(h.el('Status').textContent,/3D绘制中断/);assert.match(h.el('Diagnostics').textContent,/Partial GPU draw failed/);assert.equal(h.el('FocusAll').disabled,true);assert.equal(h.el('Fallback').hidden,false);
});


test('standard directions are explicit read-only requests independent of the whole-scene button', async t => {
  const h = await fixture(t, { standardViews: true }); await h.open(); const renderer = h.instances[0], source = copy(h.renders[0]);
  assert.equal(h.el('FocusAll').disabled, true); assert.equal(h.el('SetDirection').disabled, false);
  assert.equal(h.el('Direction').value, 'front');
  assert.deepEqual(h.el('Direction').querySelectorAll('option').map(item => item.value), ['front', 'back', 'left', 'right', 'top', 'bottom']);
  for (const direction of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
    h.el('Direction').value = direction; h.el('Direction').dispatch('change');
    const calls = renderer.directions.length; h.el('SetDirection').click(); assert.equal(renderer.directions.length, calls + 1); assert.equal(renderer.directions.at(-1), direction);
  }
  assert.equal(h.loads(), 1); assert.equal(h.renders.length, 1); assert.deepEqual(h.renders[0], source); assert.equal(h.context.sourceToken, '1:0');
  assert.match(h.el('Status').textContent, /原文保持不变/);
});
test('standard directions preserve hidden selection search and last valid model after invalid source', async t => {
  const h = await fixture(t, { standardViews: true, selectionFeedback: true }); await h.open();
  h.el('Objects').querySelectorAll('button')[1].click(); h.el('Search').value = 'no matches'; h.el('Search').dispatch('input');
  h.context.sourceToken = '1:1'; h.setContent('invalid'); h.el('Refresh').click(); await h.settle();
  const diagnostic = h.el('Diagnostics').textContent; assert.ok(diagnostic); h.el('Direction').value = 'top'; h.el('SetDirection').click();
  assert.equal(h.instances[0].selectedInstanceId, two); assert.equal(h.el('Search').value, 'no matches'); assert.equal(h.el('Direction').value, 'top');
  assert.equal(h.el('Diagnostics').textContent, diagnostic); assert.equal(h.el('Locate').disabled, true); assert.equal(h.renders.length, 1);
  assert.match(h.el('Inspector').textContent, new RegExp(two)); assert.deepEqual(h.instances[0].directions, ['top']);
});
test('older or unavailable renderers expose disabled standard directions without blocking declarations', async t => {
  for (const options of [{}, { unsupported: true }, { rendererError: true }]) {
    const h = await fixture(t, options); await h.open(); assert.equal(h.el('Direction').disabled, true); assert.equal(h.el('SetDirection').disabled, true);
    h.el('SetDirection').dispatch('click'); assert.equal(h.loads(), 1); assert.equal(h.el('Objects').querySelectorAll('button').length, 2);
  }
});
test('standard direction guard rejects busy unsupported stale-path and invalid forged values', async t => {
  const h = await fixture(t, { standardViews: true }); await h.open(); const renderer = h.instances[0];
  h.context.busy = true; h.el('SetDirection').dispatch('click'); h.context.busy = false;
  h.setSupported(false); h.el('SetDirection').dispatch('click'); h.setSupported(true);
  h.context.sourcePath = 'other'; h.el('SetDirection').dispatch('click'); h.context.sourcePath = 'documents/scenes/boxes.json';
  for (const value of ['', 'TOP', '__proto__', 'diagonal']) { h.el('Direction').value = value; h.el('SetDirection').dispatch('click'); }
  assert.deepEqual(renderer.directions, []); h.el('Direction').value = 'bottom'; h.el('SetDirection').click(); assert.deepEqual(renderer.directions, ['bottom']);
});
test('pending refreshed source blocks standard directions until its own completion', async t => {
  const gate = deferred(); let wait = false;
  const h = await fixture(t, { standardViews: true, source: context => wait ? gate.promise : { content: 'valid', sourcePath: context.sourcePath, token: context.sourceToken } });
  await h.open(); wait = true; h.el('Refresh').click(); assert.equal(h.el('Direction').disabled, true); assert.equal(h.el('SetDirection').disabled, true);
  h.el('SetDirection').dispatch('click'); assert.deepEqual(h.instances[0].directions, []);
  gate.resolve({ content: 'valid', sourcePath: h.context.sourcePath, token: h.context.sourceToken }); await h.settle(); assert.equal(h.el('SetDirection').disabled, false);
});
test('failed direction does not claim success and synchronous GPU failure preserves its diagnosis', async t => {
  const h = await fixture(t, { standardViews: true, directionResult: false }); await h.open(); h.el('SetDirection').click(); assert.match(h.el('Status').textContent, /无法切换/);
  const failed = await fixture(t, { standardViews: true, directionError: true }); await failed.open(); failed.el('SetDirection').click();
  assert.match(failed.el('Status').textContent, /绘制中断/); assert.match(failed.el('Diagnostics').textContent, /Direction draw failed/); assert.equal(failed.el('SetDirection').disabled, true);
});
test('language changes translate all six options and preserve direction without drawing', async t => {
  const h = await fixture(t, { standardViews: true }); await h.open(); h.el('Direction').value = 'bottom';
  for (const language of ['en', 'ja', 'zh']) {
    h.setLanguage(language); assert.equal(h.el('Direction').value, 'bottom');
    for (const option of h.el('Direction').querySelectorAll('option')) assert.equal(option.textContent, ({ en, ja }[language]?.[option.dataset.i18n] || option.dataset.i18n));
    assert.equal(h.el('SetDirection').textContent, ({ en, ja }[language]?.['按方向查看'] || '按方向查看'));
  }
  assert.deepEqual(h.instances[0].directions, []);
});
test('closed or disposed controls cannot invoke old renderer and reopen starts with front choice', async t => {
  const h = await fixture(t, { standardViews: true }); await h.open(); h.el('Direction').value = 'top'; const oldButton = h.el('SetDirection'), old = h.instances[0];
  h.controller.close(); oldButton.dispatch('click'); assert.deepEqual(old.directions, []); await h.open(); assert.equal(h.el('Direction').value, 'front');
  h.controller.dispose(); oldButton.dispatch('click'); assert.deepEqual(h.instances[1].directions, []);
});


test('drag mode switch is view-only and preserves mode through reset and source refresh', async t => {
  const h = await fixture(t, { dragModes: true }); await h.open(); const renderer = h.instances[0];
  assert.equal(h.el('DragMode').value, 'orbit'); assert.equal(h.el('DragMode').disabled, false);
  assert.deepEqual(h.el('DragMode').querySelectorAll('option').map(item => item.value), ['orbit', 'pan']);
  h.el('DragMode').value = 'pan'; h.el('DragMode').dispatch('change'); assert.equal(renderer.dragMode, 'pan'); assert.equal(h.el('Canvas').dataset.dragMode, 'pan');
  assert.match(h.el('Status').textContent, /仅移动临时镜头/); assert.equal(h.loads(), 1); assert.equal(h.renders.length, 1); assert.equal(h.context.sourceToken, '1:0');
  h.el('Reset').click(); assert.equal(h.el('DragMode').value, 'pan'); h.el('Refresh').click(); await h.settle(); assert.equal(h.el('DragMode').value, 'pan'); assert.equal(renderer.dragMode, 'pan');
  assert.deepEqual(renderer.modes, ['pan']); h.el('DragMode').value = 'orbit'; h.el('DragMode').dispatch('change'); assert.equal(h.el('Canvas').dataset.dragMode, 'orbit');
});
test('drag mode change preserves hidden selection query and invalid draft diagnostics', async t => {
  const h = await fixture(t, { dragModes: true, selectionFeedback: true }); await h.open(); h.el('Objects').querySelectorAll('button')[1].click();
  h.el('Search').value = 'nothing'; h.el('Search').dispatch('input'); h.setContent('invalid'); h.context.sourceToken = '1:1'; h.el('Refresh').click(); await h.settle(); const diagnostic = h.el('Diagnostics').textContent;
  h.el('DragMode').value = 'pan'; h.el('DragMode').dispatch('change'); assert.ok(diagnostic); assert.equal(h.el('Diagnostics').textContent, diagnostic); assert.equal(h.el('Search').value, 'nothing'); assert.match(h.el('Inspector').textContent, new RegExp(two)); assert.equal(h.instances[0].selectedInstanceId, two); assert.equal(h.renders.length, 1);
});
test('missing pan method or GPU disables drag choice and keeps the legacy gesture hint', async t => {
  for (const options of [{}, { unsupported: true }, { rendererError: true }]) {
    const h = await fixture(t, options); await h.open(); assert.equal(h.el('DragMode').disabled, true); assert.match(h.el('DragMode').title, /不支持切换/);
    assert.doesNotMatch(h.el('Gestures').textContent, /Shift/); h.el('DragMode').value = 'pan'; h.el('DragMode').dispatch('change'); assert.equal(h.el('DragMode').value, 'orbit'); assert.equal(h.el('Objects').querySelectorAll('button').length, 2);
  }
});
test('drag mode guard restores accepted UI choice on busy unsupported wrong-path and forged changes', async t => {
  const h = await fixture(t, { dragModes: true }); await h.open(); const change = () => { h.el('DragMode').value = 'pan'; h.el('DragMode').dispatch('change'); assert.equal(h.el('DragMode').value, 'orbit'); };
  h.context.busy = true; change(); h.context.busy = false; h.setSupported(false); change(); h.setSupported(true);
  const path = h.context.sourcePath; h.context.sourcePath = 'other'; change(); h.context.sourcePath = path;
  for (const value of ['', 'PAN', 'constructor']) { h.el('DragMode').value = value; h.el('DragMode').dispatch('change'); assert.equal(h.el('DragMode').value, 'orbit'); }
  assert.deepEqual(h.instances[0].modes, []);
});
test('pending source load prevents drag mode changes until current receipt completes', async t => {
  const gate = deferred(); let wait = false; const h = await fixture(t, { dragModes: true, source: context => wait ? gate.promise : { content: 'valid', sourcePath: context.sourcePath, token: context.sourceToken } }); await h.open(); wait = true; h.el('Refresh').click(); assert.equal(h.el('DragMode').disabled, true);
  h.el('DragMode').value = 'pan'; h.el('DragMode').dispatch('change'); assert.deepEqual(h.instances[0].modes, []); assert.equal(h.el('DragMode').value, 'orbit'); gate.resolve({ content: 'valid', sourcePath: h.context.sourcePath, token: h.context.sourceToken }); await h.settle(); assert.equal(h.el('DragMode').disabled, false);
});
test('refused drag mode restores prior choice while synchronous render failure keeps diagnosis', async t => {
  const h = await fixture(t, { dragModes: true, dragResult: false }); await h.open(); h.el('DragMode').value = 'pan'; h.el('DragMode').dispatch('change'); assert.equal(h.el('DragMode').value, 'orbit'); assert.match(h.el('Status').textContent, /无法切换拖动方式/); assert.equal(h.el('Canvas').dataset.dragMode, 'orbit');
  const failed = await fixture(t, { dragModes: true, dragError: true }); await failed.open(); failed.el('DragMode').value = 'pan'; failed.el('DragMode').dispatch('change'); assert.match(failed.el('Status').textContent, /绘制中断/); assert.match(failed.el('Diagnostics').textContent, /Drag mode failed/); assert.equal(failed.el('DragMode').disabled, true);
});
test('three languages preserve selected drag mode and translate mode-aware gesture hint without side effects', async t => {
  const h = await fixture(t, { dragModes: true }); await h.open(); h.el('DragMode').value = 'pan'; h.el('DragMode').dispatch('change');
  for (const language of ['en', 'ja', 'zh']) { h.setLanguage(language); assert.equal(h.el('DragMode').value, 'pan'); for (const option of h.el('DragMode').querySelectorAll('option')) assert.equal(option.textContent, ({ en, ja }[language]?.[option.dataset.i18n] || option.dataset.i18n)); assert.match(h.el('Gestures').textContent, /Shift/); }
  assert.deepEqual(h.instances[0].modes, ['pan']); assert.equal(h.loads(), 1);
});
test('close and disposal revoke old mode callbacks and reopening starts a new orbit gesture mode', async t => {
  const h = await fixture(t, { dragModes: true }); await h.open(); h.el('DragMode').value = 'pan'; h.el('DragMode').dispatch('change'); const select = h.el('DragMode'), old = h.instances[0]; h.controller.close(); select.dispatch('change'); assert.deepEqual(old.modes, ['pan']); await h.open(); assert.equal(h.el('DragMode').value, 'orbit'); assert.equal(h.instances[1].dragMode, 'orbit'); h.controller.dispose(); select.dispatch('change'); assert.deepEqual(h.instances[1].modes, []);
});


test('projection choices affect only preview and preserve accepted mode through reset refresh and other view operations', async t => {
  const h = await fixture(t, { projectionModes: true, dragModes: true, standardViews: true, wholeScene: true }); await h.open(); const renderer = h.instances[0];
  assert.equal(h.el('ProjectionMode').value, 'perspective'); assert.equal(h.el('ProjectionMode').disabled, false);
  assert.deepEqual(h.el('ProjectionMode').querySelectorAll('option').map(item => item.value), ['perspective', 'orthographic']);
  h.el('ProjectionMode').value = 'orthographic'; h.el('ProjectionMode').dispatch('change'); assert.equal(renderer.projectionMode, 'orthographic'); assert.match(h.el('Status').textContent, /仅影响预览/);
  h.el('DragMode').value = 'pan'; h.el('DragMode').dispatch('change'); h.el('SetDirection').click(); h.el('FocusAll').click(); h.el('Focus').click(); h.el('Reset').click();
  h.el('Refresh').click(); await h.settle(); assert.equal(h.el('ProjectionMode').value, 'orthographic'); assert.equal(h.el('DragMode').value, 'pan');
  assert.deepEqual(renderer.projections, ['orthographic']); assert.equal(h.loads(), 2); assert.equal(h.renders.length, 2); assert.equal(h.context.sourceToken, '1:0');
  h.el('ProjectionMode').value = 'perspective'; h.el('ProjectionMode').dispatch('change'); assert.equal(renderer.projectionMode, 'perspective');
});
test('orthographic mode preserves hidden selection filter last valid source diagnosis and source-location guard', async t => {
  const h = await fixture(t, { projectionModes: true, selectionFeedback: true }); await h.open(); h.el('Objects').querySelectorAll('button')[1].click();
  h.el('Search').value = 'nothing'; h.el('Search').dispatch('input'); h.setContent('invalid'); h.context.sourceToken = '1:1'; h.el('Refresh').click(); await h.settle(); const diagnostic = h.el('Diagnostics').textContent;
  h.el('ProjectionMode').value = 'orthographic'; h.el('ProjectionMode').dispatch('change'); assert.ok(diagnostic); assert.equal(h.el('Diagnostics').textContent, diagnostic); assert.equal(h.el('Search').value, 'nothing'); assert.match(h.el('Inspector').textContent, new RegExp(two)); assert.equal(h.instances[0].selectedInstanceId, two); assert.equal(h.renders.length, 1); assert.equal(h.el('Locate').disabled, true);
});
test('missing projection interface does not disable independently supported pan and standard directions', async t => {
  const h = await fixture(t, { dragModes: true, standardViews: true }); await h.open(); assert.equal(h.el('ProjectionMode').disabled, true); assert.match(h.el('ProjectionMode').title, /不支持切换/); assert.equal(h.el('DragMode').disabled, false); assert.equal(h.el('SetDirection').disabled, false);
  h.el('ProjectionMode').value = 'orthographic'; h.el('ProjectionMode').dispatch('change'); assert.equal(h.el('ProjectionMode').value, 'perspective'); assert.equal(h.el('Objects').querySelectorAll('button').length, 2);
  for (const options of [{ unsupported: true }, { rendererError: true }]) { const failed = await fixture(t, { projectionModes: true, ...options }); await failed.open(); assert.equal(failed.el('ProjectionMode').disabled, true); assert.equal(failed.el('Objects').querySelectorAll('button').length, 2); }
});
test('projection guard rejects busy unsupported wrong-path and forged choices and restores last accepted mode', async t => {
  const h = await fixture(t, { projectionModes: true }); await h.open(); h.el('ProjectionMode').value = 'orthographic'; h.el('ProjectionMode').dispatch('change');
  const change = () => { h.el('ProjectionMode').value = 'perspective'; h.el('ProjectionMode').dispatch('change'); assert.equal(h.el('ProjectionMode').value, 'orthographic'); };
  h.context.busy = true; change(); h.context.busy = false; h.setSupported(false); change(); h.setSupported(true);
  const path = h.context.sourcePath; h.context.sourcePath = 'other'; change(); h.context.sourcePath = path;
  for (const value of ['', 'Orthographic', '__proto__', 'constructor']) { h.el('ProjectionMode').value = value; h.el('ProjectionMode').dispatch('change'); assert.equal(h.el('ProjectionMode').value, 'orthographic'); }
  assert.deepEqual(h.instances[0].projections, ['orthographic']);
});
test('pending source refresh blocks projection changes until the current receipt completes', async t => {
  const gate = deferred(); let wait = false; const h = await fixture(t, { projectionModes: true, source: context => wait ? gate.promise : { content: 'valid', sourcePath: context.sourcePath, token: context.sourceToken } }); await h.open(); wait = true; h.el('Refresh').click(); assert.equal(h.el('ProjectionMode').disabled, true);
  h.el('ProjectionMode').value = 'orthographic'; h.el('ProjectionMode').dispatch('change'); assert.deepEqual(h.instances[0].projections, []); assert.equal(h.el('ProjectionMode').value, 'perspective'); gate.resolve({ content: 'valid', sourcePath: h.context.sourcePath, token: h.context.sourceToken }); await h.settle(); assert.equal(h.el('ProjectionMode').disabled, false);
});
test('projection refusals and thrown adapters restore prior UI while GPU errors preserve drawing diagnosis', async t => {
  for (const failure of [{ projectionResult: false }, { projectionThrow: true }]) { const h = await fixture(t, { projectionModes: true, ...failure }); await h.open(); h.el('ProjectionMode').value = 'orthographic'; h.el('ProjectionMode').dispatch('change'); assert.equal(h.el('ProjectionMode').value, 'perspective'); assert.match(h.el('Status').textContent, /无法切换投影方式/); }
  const failed = await fixture(t, { projectionModes: true, projectionError: true }); await failed.open(); failed.el('ProjectionMode').value = 'orthographic'; failed.el('ProjectionMode').dispatch('change'); assert.match(failed.el('Status').textContent, /绘制中断/); assert.match(failed.el('Diagnostics').textContent, /Projection draw failed/); assert.equal(failed.el('ProjectionMode').disabled, true); assert.equal(failed.el('ProjectionMode').value, 'perspective');
});
test('projection labels explanatory text and accepted mode survive all three languages without drawing or reloading', async t => {
  const h = await fixture(t, { projectionModes: true }); await h.open(); h.el('ProjectionMode').value = 'orthographic'; h.el('ProjectionMode').dispatch('change');
  for (const language of ['en', 'ja', 'zh']) { h.setLanguage(language); assert.equal(h.el('ProjectionMode').value, 'orthographic'); for (const option of h.el('ProjectionMode').querySelectorAll('option')) assert.equal(option.textContent, ({ en, ja }[language]?.[option.dataset.i18n] || option.dataset.i18n)); const note = h.el('DirectionNote'); assert.equal(note.textContent, ({ en, ja }[language]?.[note.dataset.i18n] || note.dataset.i18n)); }
  assert.deepEqual(h.instances[0].projections, ['orthographic']); assert.equal(h.loads(), 1);
});
test('close and disposal cannot revive old projection controls; reopen starts perspective', async t => {
  const h = await fixture(t, { projectionModes: true }); await h.open(); h.el('ProjectionMode').value = 'orthographic'; h.el('ProjectionMode').dispatch('change'); const select = h.el('ProjectionMode'), old = h.instances[0]; h.controller.close(); select.dispatch('change'); assert.deepEqual(old.projections, ['orthographic']); await h.open(); assert.equal(h.el('ProjectionMode').value, 'perspective'); assert.equal(h.instances[1].projectionMode, 'perspective'); h.controller.dispose(); select.dispatch('change'); assert.deepEqual(h.instances[1].projections, []);
});


test('orientation indicator waits for a real view receipt and does not infer a frame from parsed author data', async t => {
  const legacy = await fixture(t); await legacy.open(); assert.equal(legacy.el('Orientation').hidden, true);
  const h = await fixture(t, { viewNotifications: true }); await h.open(); assert.equal(h.el('Orientation').hidden, false);
  for (const axis of ['X', 'Y', 'Z']) assert.match(h.el('Orientation').textContent, new RegExp('\\+' + axis));
  assert.equal(h.loads(), 1); assert.equal(h.renders.length, 1); assert.equal(h.context.sourceToken, '1:0');
});
test('view notifications update only the coordinate indicator preserving selection filter source and draw count', async t => {
  const h = await fixture(t, { viewNotifications: true, selectionFeedback: true }); await h.open(); h.el('Objects').querySelectorAll('button')[1].click(); h.el('Search').value = 'hidden'; h.el('Search').dispatch('input'); const renderer = h.instances[0], before = h.el('Orientation').getAttribute('aria-label');
  renderer.ports.onViewChange({ camera: { position: [0, 10, 0], target: [0, 0, 0], up: [0, 0, -1] }, projectionMode: 'orthographic' });
  assert.equal(h.el('Orientation').hidden, false); assert.notEqual(h.el('Orientation').getAttribute('aria-label'), before); assert.equal(renderer.selectedInstanceId, two); assert.equal(h.el('Search').value, 'hidden'); assert.match(h.el('Inspector').textContent, new RegExp(two)); assert.equal(h.renders.length, 1); assert.equal(h.loads(), 1);
});
test('invalid new draft retains the indicator for the last successful view while source location remains disabled', async t => {
  const h = await fixture(t, { viewNotifications: true }); await h.open(); const before = h.el('Orientation').getAttribute('aria-label'); h.setContent('invalid'); h.context.sourceToken = '1:1'; h.el('Refresh').click(); await h.settle();
  assert.equal(h.el('Orientation').hidden, false); assert.equal(h.el('Orientation').getAttribute('aria-label'), before); assert.ok(h.el('Diagnostics').textContent); assert.equal(h.el('Locate').disabled, true); assert.equal(h.renders.length, 1);
});
test('null and invalid view receipts hide direction hints until a new valid frame arrives', async t => {
  const h = await fixture(t, { viewNotifications: true }); await h.open(); const emit = h.instances[0].ports.onViewChange;
  for (const receipt of [null, {}, { camera: { position: [0, 0, 0], target: [0, 0, 0] } }]) { emit(receipt); assert.equal(h.el('Orientation').hidden, true); }
  emit({ camera: parsed().model.camera }); assert.equal(h.el('Orientation').hidden, false); assert.equal(h.renders.length, 1);
});
test('GPU absence errors and unsupported core never show a misleading orientation indicator', async t => {
  for (const failure of [{ unsupported: true }, { rendererError: true }]) { const h = await fixture(t, { viewNotifications: true, ...failure }); await h.open(); assert.equal(h.el('Orientation').hidden, true); }
  const h = await fixture(t, { viewNotifications: true }); await h.open(); h.setSupported(false); h.controller.refresh(); assert.equal(h.el('Orientation').hidden, true); h.setSupported(true); h.controller.refresh(); assert.equal(h.el('Orientation').hidden, false);
  h.instances[0].ports.onError(Error('lost')); assert.equal(h.el('Orientation').hidden, true); h.instances[0].ports.onViewChange({ camera: parsed().model.camera }); assert.equal(h.el('Orientation').hidden, true); assert.match(h.el('Diagnostics').textContent, /lost/);
});
test('language refresh translates coordinate accessibility without requesting source or drawing a new frame', async t => {
  const h = await fixture(t, { viewNotifications: true }); await h.open();
  for (const language of ['en', 'ja', 'zh']) { h.setLanguage(language); const expected = ({ en, ja }[language]?.['坐标方向'] || '坐标方向'); assert.ok(h.el('Orientation').getAttribute('aria-label').includes(expected)); assert.equal(h.el('Orientation').hidden, false); }
  assert.equal(h.renders.length, 1); assert.equal(h.loads(), 1);
});
test('closed disposed and replaced renderer callbacks cannot repopulate a newer orientation indicator', async t => {
  const h = await fixture(t, { viewNotifications: true }); await h.open(); const old = h.instances[0], indicator = h.el('Orientation'); h.controller.close(); old.ports.onViewChange({ camera: parsed().model.camera }); assert.equal(indicator.hidden, true);
  await h.open(); const currentLabel = indicator.getAttribute('aria-label'); old.ports.onViewChange(null); assert.equal(indicator.hidden, false); assert.equal(indicator.getAttribute('aria-label'), currentLabel);
  old.ports.onViewChange({ camera: { position: [0, 8, 0], target: [0, 0, 0], up: [0, 0, -1] } }); assert.equal(indicator.getAttribute('aria-label'), currentLabel);
  h.controller.dispose(); h.instances[1].ports.onViewChange({ camera: parsed().model.camera }); assert.equal(indicator.hidden, true);
});
test('pending replacement source cannot use a callback to cross into a different document', async t => {
  const gate = deferred(); let wait = false; const h = await fixture(t, { viewNotifications: true, source: context => wait ? gate.promise : { content: 'valid', sourcePath: context.sourcePath, token: context.sourceToken } }); await h.open(); const old = h.instances[0]; wait = true; h.el('Refresh').click(); h.context.sourcePath = 'documents/other.json'; h.controller.refresh(); assert.equal(h.el('Orientation').hidden, true);
  old.ports.onViewChange({ camera: parsed().model.camera }); gate.resolve({ content: 'valid', sourcePath: 'documents/scenes/boxes.json', token: '1:0' }); await h.settle(); assert.equal(h.el('Orientation').hidden, true); assert.equal(h.el('Dialog').open, false);
});

test('two-finger help is localized only for an explicit supported renderer and does not touch the source', async t => {
  const h = await fixture(t, { touchNavigation: true, dragModes: true, projectionModes: true }); await h.open();
  h.el('DragMode').value = 'pan'; h.el('DragMode').dispatch('change'); h.el('ProjectionMode').value = 'orthographic'; h.el('ProjectionMode').dispatch('change');
  h.el('Objects').querySelectorAll('button')[1].click(); const token = h.context.sourceToken;
  for (const [language, expected] of [['zh', /双指拖动平移/], ['en', /Two fingers pan and pinch/], ['ja', /2本指で平行移動/]]) {
    h.setLanguage(language); assert.match(h.el('Gestures').textContent, expected);
    assert.equal(h.el('DragMode').value, 'pan'); assert.equal(h.el('ProjectionMode').value, 'orthographic');
    assert.match(h.el('Inspector').textContent, new RegExp(two)); assert.equal(h.el('Canvas').getAttribute('aria-describedby'), 'scene3dGestures');
  }
  assert.equal(h.context.sourceToken, token); assert.equal(h.loads(), 1); assert.equal(h.renders.length, 1);
});
test('legacy missing failed and non-boolean touch capabilities never advertise a two-finger gesture', async t => {
  for (const options of [{ dragModes: true }, { unsupported: true }, { rendererError: true }, { touchNavigation: false, dragModes: true }, { touchNavigation: 'true', dragModes: true }]) {
    const h = await fixture(t, options); await h.open();
    for (const language of ['zh', 'en', 'ja']) { h.setLanguage(language); assert.doesNotMatch(h.el('Gestures').textContent, /双指|Two fingers|2本指/); }
  }
});

const particleField = () => ({ center: [0, 3, 0], extent: [12, 8, 12], velocity: [0, -8, 0], size: [.03, .45, .03], color: '#c5ddff', count: 64, seed: 1 });
test('particle time controls send Rust samples to the renderer without altering author objects or source', async t => {
  const scene = parsed(); scene.model.particleField = particleField(); const h = await fixture(t, { particles: true, parse: () => scene });
  await h.open(); assert.equal(h.el('Particles').hidden, false); assert.equal(h.instances[0].packets[0].particleField.phases.length, 64);
  h.el('ParticleTime').value = '.5'; h.el('ParticleSeek').click(); assert.deepEqual(h.instances[0].offsets.at(-1), [0, .5, 0]);
  assert.equal(h.el('Objects').querySelectorAll('button').length, 2); assert.equal(h.context.sourceToken, '1:0');
  h.setLanguage('ja'); assert.equal(h.el('ParticleTime').value, '0.5'); assert.equal(h.el('ParticlePlay').textContent, ja['播放粒子']);
  h.el('ParticleReset').click(); assert.deepEqual(h.instances[0].offsets.at(-1), [0, 0, 0]);
  const count = h.instances[0].offsets.length; h.el('ParticleTime').value = ''; h.el('ParticleSeek').click(); assert.equal(h.el('ParticleError').hidden, false); assert.equal(h.instances[0].offsets.length, count);
  h.context.sourceToken = '1:1'; h.controller.refresh(); assert.equal(h.el('ParticlePlay').disabled, true); h.el('ParticleSeek').click(); assert.equal(h.instances[0].offsets.length, count);
});
test('particle callbacks stop after source becomes busy, hidden, stale, closed or disposed', async t => {
  for (const action of ['busy', 'stale', 'hidden', 'close', 'dispose']) {
    const scene = parsed(); scene.model.particleField = particleField(); const frames = [];
    const h = await fixture(t, { particles: true, parse: () => scene, requestFrame: fn => { frames.push(fn); return frames.length; } });
    await h.open(); h.el('ParticlePlay').click(); const render = h.instances[0], count = render.offsets.length;
    if (action === 'busy') h.context.busy = true;
    if (action === 'stale') h.context.sourceToken = 'other';
    if (action === 'hidden') { h.document.hidden = true; h.document.body.dispatch('visibilitychange'); }
    if (action === 'close') h.controller.close();
    if (action === 'dispose') h.controller.dispose();
    frames[0](100); assert.equal(render.offsets.length, count, action); assert.equal(frames.length, 1, action);
  }
});
test('missing or disabled particle field cannot play; a renderer without particle support reports a diagnostic', async t => {
  const old = await fixture(t); await old.open(); assert.equal(old.el('Particles').hidden, true);
  const scene = parsed(); scene.model.particleField = { ...particleField(), count: 0 };
  const off = await fixture(t, { particles: true, parse: () => scene }); await off.open(); assert.equal(off.el('ParticlePlay').disabled, true);
  const unsupported = await fixture(t, { parse: () => scene }); await unsupported.open(); assert.match(unsupported.el('Diagnostics').textContent, /不支持粒子场/); assert.equal(unsupported.el('ParticlePlay').disabled, true);
});
test('all particle control messages have English and Japanese translations', async () => {
  const source = await fs.readFile(new URL('../../web/modules/scene3d-particle-preview.js', import.meta.url), 'utf8');
  for (const [key] of [...source.matchAll(/'([^']*[\u4e00-\u9fff][^']*)'/g)].map(m => [m[1]])) for (const locale of [en, ja]) assert.ok(locale[key], key);
});

test('thrown model draw fails closed without exposing particle playback or a stale view receipt', async t => {
  const scene = parsed(); scene.model.particleField = particleField();
  const h = await fixture(t, { particles: true, modelThrow: true, parse: () => scene }); await h.open();
  assert.match(h.el('Diagnostics').textContent, /Model draw failed/); assert.equal(h.el('ParticlePlay').disabled, true);
  assert.equal(h.el('Orientation').hidden, true); assert.equal(h.el('Reset').disabled, true); assert.equal(h.el('Fallback').hidden, false);
});
