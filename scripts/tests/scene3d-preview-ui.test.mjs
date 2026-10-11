import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

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
  const renders = [], instances = [], errors = []; let language = 'zh', supported = options.supported !== false, content = 'valid', listener = () => {}, loads = 0, parses = 0;
  const translate = key => ({ en, ja }[language]?.[key] || key);
  const h = await dialogHarness('app-scene3d-preview', { supportsStudioCoreScene3D: () => supported,
    parseScene3DSource(raw) { parses++; if (options.parse) return options.parse(raw); if (raw !== 'valid') throw new Error('Invalid scene at /objects/0/size'); return parsed(); },
    createScene3DRenderer(canvas, ports) { if (options.rendererError) throw Error('Shader failed'); if (options.unsupported) return null;
      const renderer = { canvas, disposed: 0, resets: 0, ports, setModel(model) { renders.push(copy(model)); }, dispose() { this.disposed++; }, resetView() { this.resets++; } }; instances.push(renderer); return renderer; },
    t: translate, translatePage(root) { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange(fn) { listener = fn; return () => { listener = () => {}; }; },
  });
  h.runtime.window.alert = value => errors.push(value);
  const controller = h.runtime.setupScene3DPreview({ getContext: () => context, async getSource() { loads++; if (options.source) return options.source(context);
    return { content, sourcePath: context.sourcePath, token: context.sourceToken }; } });
  const el = suffix => h.element('scene3d' + suffix), open = () => controller.open();
  const settle = async () => { await flushDialogs(); await flushDialogs(); };
  t.after(() => controller.dispose());
  return { ...h, controller, context, el, open, settle, renders, instances, errors, loads: () => loads, parses: () => parses,
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
