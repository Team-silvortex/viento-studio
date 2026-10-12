import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DTransformProposal, isScene3DTransformProposal } from '../../engine/scene3d-transform.mjs';
import { supportsStudioCoreScene3DPatch } from '../../engine/studio-core.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const one = '00000000-0000-4000-8000-000000000001', two = '00000000-0000-4000-8000-000000000002';
const author = () => ({ format: 'viento-scene3d', schemaVersion: 1, name: 'Boxes', viewport: [640, 480], background: '#112233',
  camera: { position: [4, 3, 6], target: [0, 0, 0], fovDegrees: 50, near: .1, far: 100 }, light: { direction: [1, -2, -1], color: '#ffffff', energy: 1 },
  objects: [{ instanceId: one, name: '<b>Blue box</b>', primitive: 'box', position: [0, 1, 0], rotationDegrees: [10, 20, 30], size: [1, 2, 3], color: '#556677' },
    { instanceId: two, name: 'Other box', primitive: 'box', position: [2, 0, 0], rotationDegrees: [0, 0, 0], size: [1, 1, 1], color: '#ffffff' }] });
const serialize = value => '\ufeff' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n';
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function stubProposal(snapshot, edit) {
  const model = JSON.parse(snapshot.content.replace(/^\ufeff/, '')), index = model.objects.findIndex(item => item.instanceId === edit.instanceId);
  if (index < 0) throw Error('Unknown identity');
  const beforeObject = copy(model.objects[index]), paths = [];
  for (const [field, vector] of Object.entries(edit.values)) {
    const bounds = { position: [-100000, 100000], rotationDegrees: [-36000, 36000], size: [.001, 1000] }[field];
    if (!bounds || vector.length !== 3 || vector.some(value => !Number.isFinite(value) || value < bounds[0] || value > bounds[1])) throw Error('Invalid transform bounds');
    if (vector.some((value, axis) => value !== beforeObject[field][axis])) { model.objects[index][field] = [...vector]; paths.push(`/objects/${index}/${field}`); }
  }
  if (!paths.length) throw Object.assign(Error('Unchanged transform'), { errorCode: 'scene3d_transform_unchanged' });
  return freeze({ kind: 'scene3d-transform', sourcePath: snapshot.sourcePath, sourceToken: snapshot.token,
    baseSourceRevision: snapshot.baseSourceRevision, sourceRevision: snapshot.sourceRevision, instanceId: edit.instanceId, values: copy(edit.values),
    beforeContent: snapshot.content, afterContent: serialize(model), changedPaths: paths, beforeObject, afterObject: model.objects[index] });
}
async function fixture(t, options = {}) {
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, sourcePath: 'documents/scenes/boxes.json', sourceToken: '1:0:0' };
  let content = serialize(author()), language = 'zh', supported = options.supported !== false, listener = () => {}, unsubscribed = 0;
  const original = content, calls = [], proposals = [], alerts = [], confirmations = []; let loads = 0;
  const snapshot = () => ({ content, sourcePath: context.sourcePath, token: context.sourceToken, baseSourceRevision: hash(original), sourceRevision: hash(content) });
  const translate = key => ({ en, ja }[language]?.[key] || key);
  const h = await dialogHarness('app-scene3d-transforms', { queueMicrotask,
    supportsStudioCoreScene3DPatch: () => supported,
    parseScene3DSource: options.parse || parseScene3DSource,
    createScene3DTransformProposal(source, edit) { const result = (options.propose || stubProposal)(copy(source), copy(edit)); proposals.push(result); return result; },
    t: translate, translatePage(root) { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange(fn) { listener = fn; return () => { unsubscribed++; listener = () => {}; }; },
  });
  h.runtime.window.alert = value => alerts.push(value);
  h.runtime.window.confirm = value => { confirmations.push(value); return options.confirm?.(value) ?? true; };
  const controller = h.runtime.setupScene3DTransforms({ getContext: () => context, getSource: async () => { loads++; return options.source ? options.source(snapshot()) : snapshot(); },
    applyDraft: async (proposal, ports) => {
      calls.push({ proposal, ports }); if (options.apply) return options.apply(proposal, ports, { context, snapshot, setContent(value) { content = value; } });
      assert.equal(ports.isCurrent(), true); content = proposal.afterContent; context.sourceToken += ':applied';
      return { applied: true, sourcePath: context.sourcePath, sourceToken: context.sourceToken, content, focus: options.focus };
    } });
  const el = suffix => h.element('scene3dTransforms' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const set = (suffix, value, event = true) => { el(suffix).value = String(value); if (event) el(suffix).dispatch('input'); };
  const select = (prefix, vector) => { el(prefix + 'Selected').checked = true; el(prefix + 'Selected').dispatch('change'); if (vector) ['X', 'Y', 'Z'].forEach((axis, index) => set(prefix + axis, vector[index])); };
  const check = () => el('Check').click(), apply = async () => { el('Apply').click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, context, el, settle, set, select, check, apply, calls, proposals, alerts, confirmations, original, snapshot,
    loads: () => loads, unsubscribed: () => unsubscribed, open: () => controller.open(), content: () => content,
    setContent(value) { content = value; context.sourceToken += ':changed'; }, setSupported(value) { supported = value; },
    setLanguage(value) { language = value; listener(); } };
}

test('independent authoring entry gates existing JSON source, busy state and optional native patch capability', async t => {
  const h = await fixture(t); assert.equal(h.el('Btn').hidden, false); assert.equal(h.el('Btn').disabled, false);
  for (const [key, value] of [['editable', false], ['creating', true], ['sourceJSON', false], ['sourcePath', '']]) {
    const old = h.context[key]; h.context[key] = value; h.controller.refresh(); assert.equal(h.el('Btn').hidden, true); assert.equal(await h.open(), false); h.context[key] = old;
  }
  h.context.busy = true; h.controller.refresh(); assert.equal(h.el('Btn').disabled, true); assert.equal(await h.open(), false);
  h.context.busy = false; h.setSupported(false); h.controller.refresh(); assert.equal(h.el('Unavailable').hidden, false); assert.match(h.el('Btn').title, /只读预览/);
  assert.equal(await h.open(), false); assert.equal(h.loads(), 0);
});
test('opening binds stable identities and author values with all write fields initially unselected', async t => {
  const h = await fixture(t); assert.equal(await h.open(), true); assert.equal(h.el('Object').value, one); assert.match(h.el('Identity').textContent, new RegExp(one));
  for (const prefix of ['Position', 'Rotation', 'Size']) { assert.equal(h.el(prefix + 'Selected').checked, false); assert.equal(h.el(prefix + 'X').disabled, true); }
  assert.equal(h.el('RotationY').value, '20'); assert.equal(h.el('SizeZ').value, '3'); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true);
  assert.equal(h.el('Object').children[0].textContent, '<b>Blue box</b>'); assert.equal(h.el('Object').children[0].children.length, 0);
  assert.deepEqual(Object.keys(h.controller).sort(), ['close', 'destroy', 'dispose', 'open', 'refresh']);
});
test('only explicitly selected vectors enter review; unselected raw inputs cannot overwrite other fields', async t => {
  const h = await fixture(t); await h.open(); h.set('SizeX', 999, false); h.select('Position', [4, 5, 6]); h.check();
  assert.deepEqual(h.proposals[0].values, { position: [4, 5, 6] }); assert.equal(h.el('Apply').disabled, false);
  const after = JSON.parse(h.el('Source').textContent.replace(/^\ufeff/, '')); assert.deepEqual(after.objects[0].size, [1, 2, 3]); assert.deepEqual(after.objects[1], author().objects[1]);
  assert.match(h.el('Before').textContent, /"position"/); assert.match(h.el('After').textContent, /"position"/); assert.equal(h.el('ChangedPaths').children.length, 1);
  assert.equal(h.content(), h.original);
});
test('combined position rotation and size are reviewed and applied through one draft request', async t => {
  let focuses = 0; const h = await fixture(t, { focus: () => focuses++ }); await h.open();
  h.select('Position', [4, 5, 6]); h.select('Rotation', [23, -41, 67]); h.select('Size', [2, 3, 4]); h.check(); await h.apply();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].ports.isCurrent(), false); assert.equal(h.el('Dialog').open, false); assert.equal(focuses, 1);
  assert.deepEqual(Object.keys(h.calls[0].proposal.values), ['position', 'rotationDegrees', 'size']);
});
test('net unchanged selected fields do not enable application or rewrite original source', async t => {
  const h = await fixture(t); await h.open(); h.select('Position'); h.check(); assert.match(h.el('Status').textContent, /未改变/); assert.equal(h.el('Apply').disabled, true);
  await h.apply(); assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
});
test('unfinished numeric input and nonfinite input retain raw text and cannot approve a candidate', async t => {
  const h = await fixture(t); await h.open(); h.select('Position');
  for (const raw of ['', '-', '1e', 'Infinity']) { h.set('PositionX', raw); h.check(); assert.equal(h.el('PositionX').value, raw); assert.equal(h.el('Apply').disabled, true); }
  assert.equal(h.proposals.length, 0); assert.equal(h.content(), h.original);
});
test('invalid transform ranges are rejected without consuming local inputs', async t => {
  const h = await fixture(t); await h.open();
  for (const [prefix, raw] of [['Position', '100001'], ['Rotation', '36001'], ['Size', '0']]) {
    h.select(prefix); h.set(prefix + 'X', raw); h.check(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el(prefix + 'X').value, raw);
    h.el(prefix + 'Selected').checked = false; h.el(prefix + 'Selected').dispatch('change');
  }
});
test('normal input after approval invalidates the complete candidate and retains unfinished raw text', async t => {
  const h = await fixture(t); await h.open(); h.select('Position', [4, 5, 6]); h.check(); h.set('PositionX', '-');
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true); assert.equal(h.el('PositionX').value, '-');
});
test('silent numeric changes cannot reuse previous approval', async t => {
  const h = await fixture(t); await h.open(); h.select('Position', [4, 5, 6]); h.check(); h.set('PositionX', 77, false); await h.apply();
  assert.equal(h.calls.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('PositionX').value, '77');
});
test('silent checkbox and object changes cannot reuse previous approval', async t => {
  const h = await fixture(t); await h.open(); h.select('Position', [4, 5, 6]); h.check(); h.el('SizeSelected').checked = true; await h.apply(); assert.equal(h.calls.length, 0);
  h.check(); h.el('Object').value = two; await h.apply(); assert.equal(h.calls.length, 0); assert.equal(h.el('Apply').disabled, true);
});
test('silent object selection before check cannot approve values belonging to another object', async t => {
  const h = await fixture(t); await h.open(); h.select('Position', [4, 5, 6]); h.el('Object').value = two; h.check();
  assert.equal(h.proposals.length, 0); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true);
  assert.equal(h.el('Object').value, one); assert.equal(h.el('PositionX').value, '4'); await h.apply(); assert.equal(h.calls.length, 0);
  h.el('Object').value = two; h.el('Object').dispatch('change'); h.select('Position', [7, 8, 9]); h.check();
  assert.equal(h.proposals[0].instanceId, two); assert.equal(h.el('Apply').disabled, false);
});
test('declining object switch keeps source-bound identity, inputs and approved candidate', async t => {
  const h = await fixture(t, { confirm: () => false }); await h.open(); h.select('Position', [4, 5, 6]); h.check(); const source = h.el('Source').textContent;
  h.el('Object').value = two; h.el('Object').dispatch('change'); assert.equal(h.el('Object').value, one); assert.equal(h.el('PositionX').value, '4'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Source').textContent, source);
});
test('switching objects resets local selection and loads the selected author declaration', async t => {
  const h = await fixture(t); await h.open(); h.select('Position', [4, 5, 6]); h.check(); h.el('Object').value = two; h.el('Object').dispatch('change');
  assert.equal(h.el('Object').value, two); assert.equal(h.el('PositionX').value, '2'); assert.equal(h.el('PositionSelected').checked, false); assert.equal(h.el('Review').hidden, true);
});
test('language switching translates the new form without changing raw input, selection or approval', async t => {
  const h = await fixture(t); await h.open(); h.el('Object').value = two; h.el('Object').dispatch('change'); h.select('Rotation', [23, -41, 67]); h.check(); const source = h.el('Source').textContent;
  for (const lang of ['en', 'ja', 'zh']) { h.setLanguage(lang); assert.equal(h.el('Object').value, two); assert.equal(h.el('RotationY').value, '-41'); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Source').textContent, source); }
  h.setLanguage('en'); assert.equal(h.el('Title').textContent, 'Edit 3D transforms'); h.setLanguage('ja'); assert.equal(h.el('Title').textContent, '3D変換を編集');
});
test('cancellation stays available during source read and late load cannot reopen the form', async t => {
  const wait = deferred(); const h = await fixture(t, { source: () => wait.promise }); const opened = h.open();
  assert.equal(h.el('Close').disabled, false); assert.equal(h.el('Cancel').disabled, false); h.el('Cancel').click(); wait.resolve(h.snapshot());
  assert.equal(await opened, false); await h.settle(); assert.equal(h.el('Dialog').open, false); assert.equal(h.el('Fields').hidden, true); assert.equal(h.alerts.length, 0);
});
test('late rejection from a closed source read cannot report into a fresh open', async t => {
  const wait = deferred(); let reads = 0; const h = await fixture(t, { source: snapshot => ++reads === 1 ? wait.promise : snapshot });
  const old = h.open(); h.controller.close(); assert.equal(await h.open(), true); const status = h.el('Status').textContent;
  wait.reject(Error('Old read failure')); assert.equal(await old, false); assert.equal(h.el('Status').textContent, status); assert.equal(h.el('Object').value, one); assert.deepEqual(h.alerts, []);
});
test('mismatched snapshot ownership and invalid source show errors without an application path', async t => {
  const h = await fixture(t, { source: snapshot => ({ ...snapshot, token: 'foreign' }) }); assert.equal(await h.open(), false); assert.equal(h.el('Fields').hidden, true); assert.match(h.el('Diagnostic').textContent, /snapshot/);
  const bad = await fixture(t, { source: snapshot => ({ ...snapshot, content: '{' }) }); assert.equal(await bad.open(), false); assert.equal(bad.el('Apply').disabled, true); assert.equal(bad.calls.length, 0);
});
test('opening captures primitive source fields so later caller mutation cannot replace reviewed source', async t => {
  let supplied; const h = await fixture(t, { source: snapshot => (supplied = snapshot) }); await h.open(); supplied.content = 'foreign'; supplied.token = 'foreign';
  h.select('Position', [4, 5, 6]); h.check(); assert.equal(h.proposals[0].beforeContent, h.original); assert.equal(h.proposals[0].sourceToken, '1:0:0');
});
test('source token changes invalidate approval while preserving typed values', async t => {
  const h = await fixture(t); await h.open(); h.select('Position', [4, 5, 6]); h.check(); h.context.sourceToken += ':external'; h.controller.refresh();
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('PositionX').value, '4'); assert.match(h.el('Status').textContent, /已变化/);
});
test('source navigation and leaving edit mode close the local form without writing source', async t => {
  const h = await fixture(t); await h.open(); h.select('Position', [4, 5, 6]); h.context.sourcePath = 'documents/other.json'; h.controller.refresh();
  assert.equal(h.el('Dialog').open, false); assert.equal(h.calls.length, 0); assert.equal(h.confirmations.length, 0);
  await h.open(); h.context.editable = false; h.controller.refresh(); assert.equal(h.el('Dialog').open, false);
});
test('legitimate apply token advance is accepted without requiring the obsolete pre-apply token', async t => {
  let before, after; const h = await fixture(t, { apply(proposal, ports, state) {
    before = ports.isCurrent(); state.setContent(proposal.afterContent); state.context.sourceToken = 'new-token'; after = ports.isCurrent();
    return { applied: true, sourcePath: proposal.sourcePath, sourceToken: 'new-token', content: proposal.afterContent };
  } }); await h.open(); h.select('Position', [4, 5, 6]); h.check(); await h.apply(); assert.equal(before, true); assert.equal(after, false); assert.equal(h.el('Dialog').open, false);
});
test('applied true alone and tampered path content or token cannot close an approved form', async t => {
  for (const mutation of ['only-flag', 'path', 'content', 'old-token', 'current-token', 'false']) {
    const h = await fixture(t, { apply(proposal, _ports, state) {
      const receipt = { applied: true, sourcePath: proposal.sourcePath, sourceToken: 'new-token', content: proposal.afterContent };
      state.context.sourceToken = 'new-token'; if (mutation === 'only-flag') return { applied: true };
      if (mutation === 'path') receipt.sourcePath = 'documents/other.json'; if (mutation === 'content') receipt.content = 'foreign';
      if (mutation === 'old-token') { receipt.sourceToken = proposal.sourceToken; state.context.sourceToken = proposal.sourceToken; }
      if (mutation === 'current-token') state.context.sourceToken = 'different'; if (mutation === 'false') receipt.applied = false; return receipt;
    } }); await h.open(); h.select('Position', [4, 5, 6]); h.check(); await h.apply(); assert.equal(h.el('Dialog').open, true, mutation); assert.match(h.el('Diagnostic').textContent, /receipt/, mutation);
  }
});
test('pending application locks field controls but cancellation invalidates its guard and late completion', async t => {
  const wait = deferred(); let focuses = 0; const h = await fixture(t, { apply: () => wait.promise }); await h.open(); h.select('Position', [4, 5, 6]); h.check(); h.el('Apply').click();
  assert.equal(h.calls.length, 1); assert.equal(h.el('Object').disabled, true); assert.equal(h.el('PositionSelected').disabled, true); assert.equal(h.el('PositionX').disabled, true);
  assert.equal(h.el('Close').disabled, false); assert.equal(h.el('Cancel').disabled, false); h.el('Cancel').click(); assert.equal(h.calls[0].ports.isCurrent(), false);
  wait.resolve({ applied: true, sourcePath: h.context.sourcePath, sourceToken: 'late', content: h.calls[0].proposal.afterContent, focus: () => focuses++ }); await h.settle();
  assert.equal(h.el('Dialog').open, false); assert.equal(focuses, 0); assert.equal(h.content(), h.original);
});
test('late application response cannot clear or unlock a newer source read', async t => {
  const applied = deferred(), read = deferred(); let loads = 0; const h = await fixture(t, { source: snapshot => ++loads === 1 ? snapshot : read.promise, apply: () => applied.promise });
  await h.open(); h.select('Position', [4, 5, 6]); h.check(); h.el('Apply').click(); h.controller.close(true); const opened = h.open();
  applied.resolve({ applied: true }); await h.settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Dialog').getAttribute('aria-busy'), 'true');
  read.resolve(h.snapshot()); assert.equal(await opened, true); assert.equal(h.el('PositionSelected').checked, false); assert.equal(h.el('Apply').disabled, true);
});
test('silent raw mutation across apply await breaks both host guard and receipt acceptance', async t => {
  const wait = deferred(); const h = await fixture(t, { apply: () => wait.promise }); await h.open(); h.select('Position', [4, 5, 6]); h.check(); h.el('Apply').click(); h.set('PositionX', 99, false);
  assert.equal(h.calls[0].ports.isCurrent(), false); h.context.sourceToken = 'new-token'; wait.resolve({ applied: true, sourcePath: h.context.sourcePath, sourceToken: 'new-token', content: h.calls[0].proposal.afterContent }); await h.settle();
  assert.equal(h.el('Dialog').open, true); assert.equal(h.el('PositionX').value, '99'); assert.equal(h.el('Apply').disabled, true);
});
test('duplicate application clicks share no second request and failed completion keeps inputs', async t => {
  const wait = deferred(); const h = await fixture(t, { apply: () => wait.promise }); await h.open(); h.select('Position', [4, 5, 6]); h.check(); h.el('Apply').click(); h.el('Apply').click(); assert.equal(h.calls.length, 1);
  wait.reject(Error('Draft port failed')); await h.settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('PositionX').value, '4'); assert.match(h.el('Diagnostic').textContent, /failed/);
});
test('Escape declines or accepts local discard and ignores composition or repeat keys', async t => {
  let discard = false; const h = await fixture(t, { confirm: () => discard }); await h.open(); h.select('Position', [4, 5, 6]); h.check();
  const declined = h.el('Dialog').dispatch('keydown', { key: 'Escape' }); assert.equal(declined.defaultPrevented, true); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, false);
  discard = true; for (const state of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) { h.el('Dialog').dispatch('keydown', { key: 'Escape', ...state }); assert.equal(h.el('Dialog').open, true); }
  h.el('Dialog').dispatch('keydown', { key: 'Escape' }); assert.equal(h.el('Dialog').open, false); assert.equal(h.content(), h.original);
});
test('cancel returns focus and idempotent disposal removes UI while ignoring late operations', async t => {
  const wait = deferred(); const h = await fixture(t, { source: () => wait.promise }); h.el('Btn').focus(); const opened = h.open(); h.controller.close(); await h.settle(); assert.equal(h.document.activeElement, h.el('Btn'));
  h.controller.dispose(); h.controller.dispose(); wait.resolve(h.snapshot()); assert.equal(await opened, false); assert.equal(h.el('Dialog'), null); assert.equal(h.el('Btn'), null); assert.equal(h.unsubscribed(), 1);
});
test('native patch capability loss disables only this editor and prevents previously approved application', async t => {
  const h = await fixture(t); await h.open(); h.select('Position', [4, 5, 6]); h.check(); h.setSupported(false); h.controller.refresh(); await h.apply(); assert.equal(h.calls.length, 0); assert.equal(h.el('Btn').disabled, true);
  const source = await fs.readFile(new URL('../../web/modules/app-scene3d-transforms.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /app-scene3d-preview|scene3d-renderer|app-project-build|WORLD_API|fetch\(|\.save\(/);
});
test('real portable proposal and native WASM connect to the form without losing its private brand', async t => {
  assert.equal(supportsStudioCoreScene3DPatch(), true); const h = await fixture(t, { propose: createScene3DTransformProposal }); await h.open(); h.select('Rotation', [23, -41, 67]); h.check();
  assert.equal(h.el('Apply').disabled, false); assert.equal(isScene3DTransformProposal(h.proposals[0]), true); assert.equal(h.proposals[0].beforeContent, h.original);
  assert.deepEqual(parseScene3DSource(h.proposals[0].afterContent).model.objects[0].rotationDegrees, [23, -41, 67]); await h.apply(); assert.equal(h.calls.length, 1); assert.equal(isScene3DTransformProposal(h.calls[0].proposal), true);
});
