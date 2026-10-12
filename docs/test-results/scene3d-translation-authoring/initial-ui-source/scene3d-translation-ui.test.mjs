import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DTranslationProposal, isScene3DTranslationProposal, prepareScene3DTranslationApply } from '../../engine/scene3d-translation.mjs';
import { supportsStudioCoreScene3DTranslationPatch } from '../../engine/studio-core.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const one = '00000000-0000-4000-8000-000000000001', two = '00000000-0000-4000-8000-000000000002', three = '00000000-0000-4000-8000-000000000003';
const author = () => ({ format: 'viento-scene3d', schemaVersion: 1, name: 'Boxes', viewport: [640, 480], background: '#112233',
  camera: { position: [4, 3, 6], target: [0, 0, 0], fovDegrees: 50, near: .1, far: 100 }, light: { direction: [1, -2, -1], color: '#ffffff', energy: 1 },
  objects: [{ instanceId: one, name: '<b>Blue box</b>', primitive: 'box', position: [0, 1, 0], rotationDegrees: [23, -41, 67], size: [1, 2, 3], color: '#556677' },
    { instanceId: two, name: ' 雪É😀 ', primitive: 'box', position: [2, 0, 0], rotationDegrees: [0, 0, 0], size: [1, 1, 1], color: '#aBCdEF' },
    { instanceId: three, name: 'Boundary box', primitive: 'box', position: [100000, 0, 0], rotationDegrees: [0, 0, 0], size: [1, 1, 1], color: '#ffffff' }] });
const serialize = value => '\ufeff' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n';
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const brands = new WeakSet();
function stubProposal(source, { instanceIds, offset }) {
  const model = JSON.parse(source.content.replace(/^\ufeff/, '')), beforeObjects = parseScene3DSource(source.content).model.objects.filter(item => instanceIds.includes(item.instanceId)).map(copy), changedPaths = [];
  for (const [index, object] of model.objects.entries()) if (instanceIds.includes(object.instanceId)) {
    const next = object.position.map((value, axis) => value + offset[axis]);
    if (next.some(value => value < -100000 || value > 100000)) throw Object.assign(Error('Atomic final position out of bounds'), { errorCode: 'scene3d_translation_invalid' });
    if (JSON.stringify(next) !== JSON.stringify(object.position)) { object.position = next; changedPaths.push(`/objects/${index}/position`); }
  }
  if (!changedPaths.length) throw Object.assign(Error('No position changed'), { errorCode: 'scene3d_translation_unchanged' });
  const afterModel = parseScene3DSource(serialize(model)).model;
  const proposal = freeze({ kind: 'scene3d-translation', sourcePath: source.sourcePath, sourceToken: source.token, baseSourceRevision: source.baseSourceRevision,
    sourceRevision: source.sourceRevision, instanceIds: beforeObjects.map(item => item.instanceId), offset: copy(offset), beforeContent: source.content,
    afterContent: serialize(model), changedPaths, beforeObjects, afterObjects: afterModel.objects.filter(item => instanceIds.includes(item.instanceId)).map(copy) });
  brands.add(proposal); return proposal;
}
async function fixture(t, options = {}) {
  let language = 'zh', listener = () => {}, supported = options.supported ?? true, loads = 0, unsubscribed = 0;
  const original = options.content || serialize(options.model || author()); let content = original;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, sourcePath: 'documents/boxes.scene3d.json', sourceToken: '1:0:0' };
  const proposals = [], calls = [], confirmations = [], alerts = [], snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, baseSourceRevision: hash(original), sourceRevision: hash(content) });
  const translate = value => ({ en, ja }[language]?.[value] || value);
  const h = await dialogHarness('app-scene3d-translation', { queueMicrotask, supportsStudioCoreScene3DTranslationPatch: () => supported, parseScene3DSource,
    createScene3DTranslationProposal(source, edit) { const proposal = (options.propose || stubProposal)(copy(source), copy(edit)); proposals.push(proposal); return proposal; },
    isScene3DTranslationProposal: value => brands.has(value) || isScene3DTranslationProposal(value),
    t: translate, translatePage(root) { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange(fn) { listener = fn; return () => { unsubscribed++; listener = () => {}; }; },
  });
  h.runtime.window.alert = value => alerts.push(value); h.runtime.window.confirm = value => { confirmations.push(value); return options.confirm?.(value) ?? true; };
  let controller;
  controller = h.runtime.setupScene3DTranslation({ getContext: () => context, getSource: async () => { loads++; return options.source ? options.source(snapshot()) : snapshot(); },
    applyDraft: async (proposal, ports) => { calls.push({ proposal, ports }); const state = { context, snapshot, refresh: () => controller.refresh(), setContent(value) { content = value; } };
      if (options.apply) return options.apply(proposal, ports, state); assert.equal(ports.isCurrent(), true); content = proposal.afterContent; context.sourceToken += ':applied';
      if (options.refreshOnApply) controller.refresh(); return { applied: true, sourcePath: context.sourcePath, sourceToken: context.sourceToken, content, focus: options.focus };
    } });
  const el = suffix => h.element('scene3dTranslation' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const choices = () => el('Objects').querySelectorAll('input[type=checkbox]'), choice = id => choices().find(item => item.dataset.instanceId === id);
  const select = (id, checked = true, emit = true) => { const node = choice(id); assert.ok(node, id); node.checked = checked; if (emit) node.dispatch('change'); };
  const set = (suffix, value, emit = true) => { el(suffix).value = String(value); if (emit) el(suffix).dispatch('input'); };
  const check = () => el('Check').click(), apply = async () => { el('Apply').click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, context, el, settle, choices, choice, select, set, check, apply, proposals, calls, confirmations, alerts, original, snapshot,
    open: () => controller.open(), content: () => content, loads: () => loads, unsubscribed: () => unsubscribed,
    setLanguage(value) { language = value; listener(); }, setSupported(value) { supported = value; } };
}
const move = h => { h.select(one); h.select(two); h.set('X', 4); h.set('Y', -2); h.set('Z', .5); h.check(); };

test('entry gates existing JSON author sessions and optional core independently', async t => {
  const h = await fixture(t); assert.equal(h.el('Btn').hidden, false);
  for (const [key, value] of [['editable', false], ['creating', true], ['sourceJSON', false], ['sourcePath', ''], ['sourceToken', '']]) { const before = h.context[key]; h.context[key] = value; h.controller.refresh(); assert.equal(h.el('Btn').hidden, true); assert.equal(await h.open(), false); h.context[key] = before; }
  h.context.busy = true; assert.equal(await h.open(), false); h.context.busy = false; h.setSupported(false); h.controller.refresh(); assert.equal(h.el('Btn').disabled, true); assert.match(h.el('Btn').title, /其他3D/); assert.equal(h.el('Unavailable').hidden, false); assert.equal(await h.open(), false); assert.equal(h.loads(), 0);
});
test('opening is empty selection with zero offsets and literal author names and IDs', async t => {
  const h = await fixture(t); await h.open(); assert.equal(h.choices().length, 3); assert.ok(h.choices().every(item => item.checked === false));
  assert.equal(h.el('Objects').querySelectorAll('span')[0].textContent, '<b>Blue box</b>'); assert.equal(h.el('Objects').querySelectorAll('b').length, 0);
  for (const axis of ['X', 'Y', 'Z']) assert.equal(h.el(axis).value, '0'); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true);
  assert.deepEqual(Object.keys(h.controller).sort(), ['close', 'destroy', 'dispose', 'open', 'refresh']); assert.equal(h.content(), h.original);
});
test('empty selection cannot produce or apply a proposal even with nonzero offset', async t => {
  const h = await fixture(t); await h.open(); h.set('X', 1); h.check(); await h.apply(); assert.equal(h.proposals.length, 0); assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
});
test('multiple selection reviews every selected full object in source order and only common offset', async t => {
  const h = await fixture(t); await h.open(); h.select(two); h.select(one); h.set('X', 4); h.set('Y', -2); h.set('Z', .5); h.check(); const p = h.proposals[0];
  assert.deepEqual(p.instanceIds, [one, two]); assert.deepEqual(p.offset, [4, -2, .5]); assert.deepEqual(p.beforeObjects, author().objects.slice(0, 2));
  assert.deepEqual(p.afterObjects.map(item => item.position), [[4, -1, .5], [6, -2, .5]]); assert.deepEqual(p.afterObjects.map(item => item.rotationDegrees), p.beforeObjects.map(item => item.rotationDegrees));
  assert.equal(h.el('Source').textContent, p.afterContent); assert.equal(h.el('Before').children.length, 0); assert.equal(h.el('After').children.length, 0); assert.equal(h.content(), h.original);
});
test('search filters names or UUIDs case-insensitively while hidden selected objects remain in the proposal', async t => {
  const h = await fixture(t); await h.open(); h.select(one); h.set('Search', ' é😀 '); assert.deepEqual(h.choices().map(item => item.dataset.instanceId), [two]); assert.match(h.el('Selection').textContent, /筛选结果外的已选对象：1/);
  h.el('SelectResults').click(); h.set('X', 1); h.check(); assert.deepEqual(h.proposals[0].instanceIds, [one, two]); h.set('Search', three.toUpperCase()); assert.deepEqual(h.choices().map(item => item.dataset.instanceId), [three]); assert.match(h.el('Selection').textContent, /筛选结果外的已选对象：2/);
});
test('select current results is explicit and clear selection removes visible and hidden UUIDs', async t => {
  const h = await fixture(t); await h.open(); h.set('Search', 'Blue'); h.el('SelectResults').click(); assert.deepEqual(h.choices().map(item => item.checked), [true]);
  h.set('Search', 'missing'); assert.equal(h.el('NoResults').hidden, false); assert.equal(h.el('SelectResults').disabled, true); assert.equal(h.el('ClearSelection').disabled, false);
  h.el('ClearSelection').click(); assert.equal(h.el('Check').disabled, true); h.set('Search', ''); assert.ok(h.choices().every(item => !item.checked));
});
test('all 128 native IDs remain independently selectable across filtering with bounded list styling', async t => {
  const model = author(); model.objects = Array.from({ length: 128 }, (_, i) => ({ ...copy(model.objects[0]), instanceId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, name: `Box ${i + 1}` }));
  const h = await fixture(t, { model }); await h.open(); h.el('SelectResults').click(); h.set('Search', 'Box 128'); h.set('Y', 1); h.check(); assert.equal(h.proposals[0].instanceIds.length, 128); assert.match(h.el('Selection').textContent, /127/);
});
test('zero offset explicitly remains unchanged and never creates application approval', async t => {
  const h = await fixture(t); await h.open(); h.select(one); h.check(); assert.match(h.el('Status').textContent, /未改变任何位置/); assert.equal(h.el('Apply').disabled, true); await h.apply(); assert.equal(h.calls.length, 0);
});
test('one out-of-bounds final position rejects the entire batch and preserves raw selection and offsets', async t => {
  const h = await fixture(t); await h.open(); h.select(one); h.select(three); h.set('X', 1); h.check(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('X').value, '1'); assert.equal(h.choice(one).checked, true); assert.equal(h.choice(three).checked, true); assert.equal(h.content(), h.original);
});
test('empty nonfinite and outside-range offsets retain raw inputs without partial approval', async t => {
  for (const raw of ['', 'NaN', 'Infinity', '200001', '-200001']) { const h = await fixture(t); await h.open(); h.select(one); h.set('X', raw); h.check(); assert.equal(h.el('X').value, raw); assert.equal(h.proposals.length, 0); assert.equal(h.el('Apply').disabled, true); }
});
test('selection offset or query input invalidates approval without changing author bytes', async t => {
  for (const change of ['offset', 'selection', 'search', 'clear']) { const h = await fixture(t); await h.open(); move(h); if (change === 'offset') h.set('X', 5); if (change === 'selection') h.select(two, false); if (change === 'search') h.set('Search', 'Blue'); if (change === 'clear') h.el('ClearSelection').click(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.content(), h.original); }
});
test('silent checkbox identity or query mutations before Check cannot mix displayed and bound selection', async t => {
  for (const change of ['checked', 'id', 'query']) { const h = await fixture(t); await h.open(); h.select(one); h.set('X', 1); if (change === 'checked') h.select(two, true, false); if (change === 'id') h.choice(one).dataset.instanceId = two; if (change === 'query') h.set('Search', 'Blue', false); h.check(); assert.equal(h.proposals.length, 0); assert.equal(h.el('Apply').disabled, true); }
});
test('silent offset checkbox identity or query mutations after approval cannot replay it', async t => {
  for (const change of ['offset', 'checked', 'id', 'query']) { const h = await fixture(t); await h.open(); move(h); if (change === 'offset') h.set('X', 9, false); if (change === 'checked') h.select(two, false, false); if (change === 'id') h.choice(one).dataset.instanceId = three; if (change === 'query') h.set('Search', 'Blue', false); await h.apply(); assert.equal(h.calls.length, 0, change); assert.equal(h.el('Apply').disabled, true, change); }
});
test('language switching preserves selection filter raw offsets and approved complete source without reloading', async t => {
  const h = await fixture(t); await h.open(); h.select(one); h.select(two); h.set('Search', 'Blue'); h.set('X', ' 4 '); h.set('Z', '.50'); h.check(); const source = h.el('Source').textContent;
  for (const language of ['en', 'ja', 'zh']) { h.setLanguage(language); assert.equal(h.el('Search').value, 'Blue'); assert.equal(h.el('X').value, ' 4 '); assert.equal(h.el('Z').value, '.50'); assert.equal(h.choice(one).checked, true); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Source').textContent, source); }
  assert.equal(h.loads(), 1);
});
test('all marked and dynamic literal messages have English and Japanese translations', async t => {
  const h = await fixture(t); await h.open(); for (const language of ['en', 'ja']) { h.setLanguage(language); const dictionary = { en, ja }[language]; for (const node of h.el('Dialog').querySelectorAll('[data-i18n]')) assert.equal(node.textContent, dictionary[node.dataset.i18n], node.dataset.i18n); }
  const source = await fs.readFile(new URL('../../web/modules/app-scene3d-translation.js', import.meta.url), 'utf8'); const keys = new Set([...source.matchAll(/data-i18n="([^"]+)"|\bt\('([^']+)'\)|message = '([^']+)'/g)].map(match => match[1] || match[2] || match[3])); for (const key of keys) for (const dictionary of [en, ja]) assert.ok(dictionary[key], key);
});
test('cancel and Escape respect local discard without implicitly applying or saving', async t => {
  let discard = false; const h = await fixture(t, { confirm: () => discard }); await h.open(); move(h); h.el('Cancel').click(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, false);
  const event = h.el('Dialog').dispatch('keydown', { key: 'Escape' }); assert.equal(event.defaultPrevented, true); assert.equal(h.el('Dialog').open, true); discard = true;
  for (const state of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) { h.el('Dialog').dispatch('keydown', { key: 'Escape', ...state }); assert.equal(h.el('Dialog').open, true); }
  h.el('Dialog').dispatch('keydown', { key: 'Escape' }); assert.equal(h.el('Dialog').open, false); assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
});
test('list checkbox keyboard focus survives rebuild while search focus is not stolen', async t => {
  const h = await fixture(t); await h.open(); h.choice(two).focus(); h.select(two); assert.equal(h.document.activeElement.dataset.instanceId, two); h.setLanguage('ja'); assert.equal(h.document.activeElement.dataset.instanceId, two); h.el('Search').focus(); h.set('Search', 'Blue'); assert.equal(h.document.activeElement, h.el('Search'));
});
test('same-path reload revokes approval but retains local fields and different-path navigation closes', async t => {
  const h = await fixture(t); await h.open(); move(h); h.context.sourceToken += ':reload'; h.controller.refresh(); assert.equal(h.el('X').value, '4'); assert.equal(h.choice(two).checked, true); assert.equal(h.el('Check').disabled, true); await h.apply(); assert.equal(h.calls.length, 0); h.context.sourcePath = 'other.json'; h.controller.refresh(); assert.equal(h.el('Dialog').open, false);
});
test('late source success or failure after close cannot reopen or alert', async t => {
  for (const reject of [false, true]) { const gate = deferred(), h = await fixture(t, { source: () => gate.promise }); const opened = h.open(); h.controller.close(true); reject ? gate.reject(Error('Late')) : gate.resolve(h.snapshot()); assert.equal(await opened, false); assert.equal(h.el('Dialog').open, false); assert.deepEqual(h.alerts, []); }
});
test('source token path and malformed snapshot checks reject stale opening before a form can approve', async t => {
  const gate = deferred(), h = await fixture(t, { source: () => gate.promise }); const snapshot = h.snapshot(), opened = h.open(); h.context.sourceToken = 'new'; gate.resolve(snapshot); assert.equal(await opened, false); assert.equal(h.el('Fields').hidden, true);
  for (const delta of [{ sourcePath: 'wrong' }, { token: 'wrong' }, { content: '{}' }]) { const bad = await fixture(t, { source: snapshot => ({ ...snapshot, ...delta }) }); assert.equal(await bad.open(), false); assert.equal(bad.el('Check').disabled, true); }
});
test('old opening completion cannot replace a new form selection or raw offset', async t => {
  const gate = deferred(); let reads = 0; const h = await fixture(t, { source: snapshot => ++reads === 1 ? gate.promise : snapshot }); const opened = h.open(); h.controller.close(true); await h.open(); h.select(two); h.set('X', 8); gate.resolve(h.snapshot()); assert.equal(await opened, false); assert.equal(h.choice(two).checked, true); assert.equal(h.el('X').value, '8');
});
test('foreign cloned or malformed candidate identity offset source and changed paths cannot gain approval', async t => {
  for (const mutation of ['brand', 'kind', 'ids', 'offset', 'path', 'token', 'before', 'after', 'paths']) { const h = await fixture(t, { propose: (source, edit) => { const p = copy(stubProposal(source, edit)); if (mutation !== 'brand') brands.add(p); if (mutation === 'kind') p.kind = 'scene3d-transform'; if (mutation === 'ids') p.instanceIds = [one]; if (mutation === 'offset') p.offset[0]++; if (mutation === 'path') p.sourcePath = 'other'; if (mutation === 'token') p.sourceToken = 'other'; if (mutation === 'before') p.beforeObjects = []; if (mutation === 'after') p.afterContent = p.beforeContent; if (mutation === 'paths') p.changedPaths = []; return p; } }); await h.open(); move(h); assert.equal(h.el('Apply').disabled, true, mutation); await h.apply(); assert.equal(h.calls.length, 0, mutation); }
});
test('branded exact proposal applies only memory and valid advanced owner receipt focuses once', async t => {
  let focused = 0; const h = await fixture(t, { focus: () => focused++ }); await h.open(); move(h); const p = h.proposals[0]; await h.apply(); assert.equal(h.calls[0].proposal, p); assert.equal(h.content(), p.afterContent); assert.notEqual(h.context.sourceToken, p.sourceToken); assert.equal(h.el('Dialog').open, false); assert.equal(focused, 1);
});
test('host refresh during legitimate token advancement does not consume the private pending approval', async t => {
  const h = await fixture(t, { refreshOnApply: true }); await h.open(); move(h); await h.apply(); assert.equal(h.el('Dialog').open, false); assert.equal(h.content(), h.proposals[0].afterContent); assert.equal(h.calls.length, 1);
});
test('false or forged receipt path content and advanced-current-token mismatch keep the form open', async t => {
  for (const mutation of ['path', 'content', 'old-token', 'empty-token', 'current-token', 'false', 'null']) { const h = await fixture(t, { apply: (p, ports, state) => { assert.equal(ports.isCurrent(), true); state.context.sourceToken = 'next'; const r = { applied: true, sourcePath: p.sourcePath, sourceToken: 'next', content: p.afterContent }; if (mutation === 'path') r.sourcePath = 'other'; if (mutation === 'content') r.content = p.beforeContent; if (mutation === 'old-token') { r.sourceToken = p.sourceToken; state.context.sourceToken = p.sourceToken; } if (mutation === 'empty-token') r.sourceToken = ''; if (mutation === 'current-token') state.context.sourceToken = 'other-current'; if (mutation === 'false') r.applied = false; return mutation === 'null' ? null : r; } }); await h.open(); move(h); await h.apply(); assert.equal(h.el('Dialog').open, true, mutation); assert.match(h.el('Diagnostic').textContent, /receipt/, mutation); }
});
test('pending application locks every author control while Cancel revokes late completion', async t => {
  const gate = deferred(); let focus = 0; const h = await fixture(t, { apply: () => gate.promise }); await h.open(); move(h); h.el('Apply').click(); for (const field of ['Search', 'SelectResults', 'ClearSelection', 'X', 'Y', 'Z', 'Check', 'Apply']) assert.equal(h.el(field).disabled, true, field); assert.ok(h.choices().every(item => item.disabled)); assert.equal(h.el('Cancel').disabled, false); h.el('Cancel').click(); assert.equal(h.calls[0].ports.isCurrent(), false); gate.resolve({ applied: true, sourcePath: h.context.sourcePath, sourceToken: 'next', content: h.proposals[0].afterContent, focus: () => focus++ }); await h.settle(); assert.equal(h.el('Dialog').open, false); assert.equal(focus, 0);
});
test('silent raw mutations across application await revoke the port guard and valid-looking receipt', async t => {
  for (const mutation of ['offset', 'checkbox', 'query']) { const gate = deferred(), h = await fixture(t, { apply: () => gate.promise }); await h.open(); move(h); h.el('Apply').click(); if (mutation === 'offset') h.set('X', 9, false); if (mutation === 'checkbox') h.select(two, false, false); if (mutation === 'query') h.set('Search', 'Blue', false); assert.equal(h.calls[0].ports.isCurrent(), false); h.context.sourceToken = 'next'; gate.resolve({ applied: true, sourcePath: h.context.sourcePath, sourceToken: 'next', content: h.proposals[0].afterContent }); await h.settle(); assert.equal(h.el('Dialog').open, true); assert.match(h.el('Diagnostic').textContent, /receipt/); }
});
test('closing and reopening while apply is pending keeps the new local form isolated from old completion', async t => {
  const gate = deferred(), h = await fixture(t, { apply: () => gate.promise }); await h.open(); move(h); h.el('Apply').click(); h.controller.close(true); await h.open(); h.select(two); h.set('X', 77); gate.resolve({ applied: true }); await h.settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('X').value, '77'); assert.equal(h.choice(two).checked, true);
});
test('duplicate apply and late failures do not add requests or destroy retained draft fields', async t => {
  const gate = deferred(), h = await fixture(t, { apply: () => gate.promise }); await h.open(); move(h); h.el('Apply').click(); h.el('Apply').click(); assert.equal(h.calls.length, 1); gate.reject(Error('Failure')); await h.settle(); assert.equal(h.el('X').value, '4'); assert.equal(h.el('Dialog').open, true);
});
test('native capability loss disables only this domain and invalidates approved application', async t => {
  const h = await fixture(t); await h.open(); move(h); h.setSupported(false); h.controller.refresh(); assert.equal(h.el('Btn').disabled, true); assert.equal(h.el('Check').disabled, true); await h.apply(); assert.equal(h.calls.length, 0); assert.ok(h.element('projectBuildBtn')); assert.equal(h.el('X').value, '4');
});
test('disposal removes only local UI and ignores late source completion idempotently', async t => {
  const gate = deferred(), h = await fixture(t, { source: () => gate.promise }); const opened = h.open(); h.controller.dispose(); h.controller.dispose(); gate.resolve(h.snapshot()); assert.equal(await opened, false); assert.equal(await h.open(), false); assert.equal(h.el('Dialog'), null); assert.equal(h.unsubscribed(), 1); assert.ok(h.element('projectBuildBtn'));
});
test('CSS hides review explicitly and controller has no sibling renderer World HTTP or Save dependencies', async () => {
  const source = await fs.readFile(new URL('../../web/modules/app-scene3d-translation.js', import.meta.url), 'utf8'), css = await fs.readFile(new URL('../../web/scene3d-translation.css', import.meta.url), 'utf8');
  assert.match(css, /\.scene3d-translation-dialog \[hidden\]\s*\{\s*display:none!important/); assert.equal(/style=|\.style\./.test(source), false); assert.equal(/import.*(renderer|app-scene3d-(transforms|objects|properties|environment)|runtime|world|build)/.test(source), false); assert.equal(/fetch\(|saveDraft|WorldCommand|\.save\(/.test(source), false);
});
test('actual native portable proposal retains its private brand through the form and strict memory application', async t => {
  assert.equal(supportsStudioCoreScene3DTranslationPatch(), true); const h = await fixture(t, { propose: createScene3DTranslationProposal, apply: async (p, ports, state) => {
    assert.equal(isScene3DTranslationProposal(p), true); assert.equal(ports.isCurrent(), true); const result = await prepareScene3DTranslationApply(state.snapshot(), p, { digest: async raw => hash(raw).slice(7) });
    assert.equal(result.afterContent, p.afterContent); state.setContent(result.afterContent); state.context.sourceToken = 'advanced-native'; return { applied: true, sourcePath: p.sourcePath, sourceToken: state.context.sourceToken, content: result.afterContent };
  } }); await h.open(); move(h); assert.equal(h.el('Apply').disabled, false); assert.equal(isScene3DTranslationProposal(h.proposals[0]), true); await h.apply(); assert.equal(h.el('Dialog').open, false); assert.deepEqual(JSON.parse(h.content().replace(/^\ufeff/, '')).objects.slice(0, 2).map(item => item.position), [[4, -1, .5], [6, -2, .5]]);
});
