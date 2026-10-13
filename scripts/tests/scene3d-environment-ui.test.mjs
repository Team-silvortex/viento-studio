import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DEnvironmentProposal, isScene3DEnvironmentProposal } from '../../engine/scene3d-environment.mjs';
import { supportsStudioCoreScene3DEnvironmentPatch } from '../../engine/studio-core.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const author = () => ({ format: 'viento-scene3d', schemaVersion: 1, name: '<b>Author scene</b>', viewport: [640, 480], background: '#112233',
  camera: { position: [4, 3, 6], target: [0, 0, 0], fovDegrees: 50, near: .1, far: 100 }, light: { direction: [1, -2, -1], color: '#ffffff', energy: 1 },
  objects: [{ instanceId: '00000000-0000-4000-8000-000000000001', name: '<b>Box</b>', primitive: 'box', position: [0, 1, 0], rotationDegrees: [23, -41, 67], size: [1, 2, 3], color: '#556677' }] });
const serialize = value => '\ufeff' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n';
const environment = model => ({ background: model.background, camera: model.camera, light: model.light });
const ids = ['Background', 'CameraPosition', 'CameraTarget', 'Fov', 'Clip', 'LightDirection', 'LightColor', 'LightEnergy'];
const fields = ['Background', 'CameraPositionX', 'CameraPositionY', 'CameraPositionZ', 'CameraTargetX', 'CameraTargetY', 'CameraTargetZ', 'Fov', 'Near', 'Far', 'LightDirectionX', 'LightDirectionY', 'LightDirectionZ', 'LightColor', 'LightEnergy'];
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function stubProposal(snapshot, { values }) {
  const before = JSON.parse(snapshot.content.replace(/^\ufeff/, '')), after = copy(before), changedPaths = [];
  for (const [key, value] of Object.entries(values)) {
    if (key === 'background') { if (value !== before[key]) { after[key] = value; changedPaths.push('/background'); } }
    else for (const [field, next] of Object.entries(value)) if (JSON.stringify(next) !== JSON.stringify(before[key][field])) {
      after[key][field] = copy(next); changedPaths.push('/' + key + '/' + field);
    }
  }
  if (!changedPaths.length) throw Object.assign(Error('No author environment changed'), { errorCode: 'scene3d_environment_unchanged' });
  parseScene3DSource(serialize(after));
  return freeze({ kind: 'scene3d-environment', sourcePath: snapshot.sourcePath, sourceToken: snapshot.token,
    baseSourceRevision: snapshot.baseSourceRevision, sourceRevision: snapshot.sourceRevision, values: copy(values),
    beforeContent: snapshot.content, afterContent: serialize(after), changedPaths,
    beforeEnvironment: environment(before), afterEnvironment: environment(after) });
}
async function fixture(t, options = {}) {
  let language = options.language || 'zh', listener = () => {}, supported = options.supported ?? true, fogSupported = options.fogSupported ?? true, unsubscribed = 0, loads = 0;
  const original = serialize(options.author || author()); let content = original;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, sourcePath: 'documents/boxes.scene3d.json', sourceToken: '1:0:0' };
  const calls = [], proposals = [], confirmations = [], alerts = [];
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, baseSourceRevision: hash(original), sourceRevision: hash(content) });
  const translate = value => ({ en, ja }[language]?.[value] || value);
  const h = await dialogHarness('app-scene3d-environment', {
    queueMicrotask, supportsStudioCoreScene3DParticles: () => options.particlesSupported !== false, supportsStudioCoreScene3DEnvironmentPatch: () => supported, supportsStudioCoreScene3DFog: () => fogSupported, parseScene3DSource,
    createScene3DEnvironmentProposal(source, edit) { const result = (options.propose || stubProposal)(copy(source), copy(edit)); proposals.push(result); return result; },
    t: translate, translatePage(root) { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange(fn) { listener = fn; return () => { unsubscribed++; listener = () => {}; }; },
  });
  h.runtime.window.alert = value => alerts.push(value);
  h.runtime.window.confirm = value => { confirmations.push(value); return options.confirm?.(value) ?? true; };
  const controller = h.runtime.setupScene3DEnvironment({ getContext: () => context, getSource: async () => { loads++; return options.source ? options.source(snapshot()) : snapshot(); },
    applyDraft: async (proposal, ports) => {
      calls.push({ proposal, ports }); if (options.apply) return options.apply(proposal, ports, { context, snapshot, setContent(value) { content = value; } });
      assert.equal(ports.isCurrent(), true); content = proposal.afterContent; context.sourceToken += ':applied';
      return { applied: true, sourcePath: context.sourcePath, sourceToken: context.sourceToken, content, focus: options.focus };
    } });
  const el = suffix => h.element('scene3dEnvironment' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const set = (suffix, value, event = true) => { el(suffix).value = String(value); if (event) el(suffix).dispatch('input'); };
  const select = (suffix, checked = true, event = true) => { el(suffix + 'Selected').checked = checked; if (event) el(suffix + 'Selected').dispatch('change'); };
  const check = () => el('Check').click(), apply = async () => { el('Apply').click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, context, el, settle, set, select, check, apply, calls, proposals, alerts, confirmations, original, snapshot,
    loads: () => loads, unsubscribed: () => unsubscribed, open: () => controller.open(), content: () => content,
    setSupported(value) { supported = value; }, setFogSupported(value) { fogSupported = value; }, setLanguage(value) { language = value; listener(); } };
}
const changeBackground = h => { h.select('Background'); h.set('Background', '#Ab12Cd'); h.check(); };

test('the independent entry requires an existing JSON editing source and explains an unavailable optional core', async t => {
  const h = await fixture(t); assert.equal(h.el('Btn').hidden, false); assert.equal(h.el('Btn').disabled, false);
  for (const [key, value] of [['editable', false], ['creating', true], ['sourceJSON', false], ['sourcePath', '']]) {
    const old = h.context[key]; h.context[key] = value; h.controller.refresh(); assert.equal(h.el('Btn').hidden, true); assert.equal(await h.open(), false); h.context[key] = old;
  }
  h.context.busy = true; h.controller.refresh(); assert.equal(h.el('Btn').disabled, true); assert.equal(await h.open(), false);
  h.context.busy = false; h.setSupported(false); h.controller.refresh(); assert.equal(h.el('Unavailable').hidden, false); assert.match(h.el('Btn').title, /只读预览/);
  assert.equal(await h.open(), false); assert.equal(h.loads(), 0);
});
test('opening displays raw author declarations with every change group initially unselected', async t => {
  const h = await fixture(t); assert.equal(await h.open(), true);
  for (const id of ids) assert.equal(h.el(id + 'Selected').checked, false, id);
  for (const field of fields) assert.equal(h.el(field).disabled, true, field);
  assert.equal(h.el('Background').value, '#112233'); assert.equal(h.el('CameraPositionX').value, '4'); assert.equal(h.el('Near').value, '0.1'); assert.equal(h.el('LightEnergy').value, '1');
  assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true);
  assert.deepEqual(Object.keys(h.controller).sort(), ['close', 'destroy', 'dispose', 'open', 'refresh']);
});
test('an empty selection cannot call the proposal or draft ports', async t => {
  const h = await fixture(t); await h.open(); h.check(); await h.apply(); assert.equal(h.proposals.length, 0); assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
});
test('only explicitly selected background values enter the proposal and review excludes object declarations', async t => {
  const h = await fixture(t); await h.open(); changeBackground(h); const candidate = h.proposals[0];
  assert.deepEqual(candidate.values, { background: '#Ab12Cd' }); assert.deepEqual(JSON.parse(h.el('Before').textContent), environment(author()));
  assert.deepEqual(JSON.parse(h.el('After').textContent), { ...environment(author()), background: '#Ab12Cd' }); assert.doesNotMatch(h.el('Before').textContent, /objects|instanceId/);
  assert.equal(h.el('Source').textContent, candidate.afterContent); assert.equal(h.el('ChangedPaths').children[0].textContent, '/background'); assert.equal(h.el('SourceReview').open, true);
  const after = parseScene3DSource(candidate.afterContent).model; assert.deepEqual(after.objects, author().objects); assert.deepEqual(after.camera, author().camera); assert.equal(h.content(), h.original);
});
test('camera position and target selections send independent complete XYZ vectors without implicit camera fields', async t => {
  const h = await fixture(t); await h.open(); h.select('CameraPosition'); h.set('CameraPositionX', 10); h.select('CameraTarget'); h.set('CameraTargetZ', -4); h.check();
  assert.deepEqual(h.proposals[0].values, { camera: { position: [10, 3, 6], target: [0, 0, -4] } }); assert.equal(h.el('Apply').disabled, false);
});
test('camera clipping is atomic so near can safely move past its old far when both change together', async t => {
  const h = await fixture(t); await h.open(); h.select('Clip'); h.set('Near', 120); h.set('Far', 250); h.check();
  assert.deepEqual(h.proposals[0].values, { camera: { near: 120, far: 250 } }); assert.equal(h.el('Apply').disabled, false);
  assert.deepEqual(h.proposals[0].changedPaths, ['/camera/near', '/camera/far']);
});
test('independent light selections send only chosen direction, raw color and energy including zero', async t => {
  const h = await fixture(t); await h.open(); h.select('LightDirection'); h.set('LightDirectionZ', 3); h.select('LightColor'); h.set('LightColor', '#aBcDeF'); h.select('LightEnergy'); h.set('LightEnergy', 0); h.check();
  assert.deepEqual(h.proposals[0].values, { light: { direction: [1, -2, 3], color: '#aBcDeF', energy: 0 } }); assert.equal(h.el('Apply').disabled, false);
});
test('fields silently modified while unselected are never included in explicit environment values', async t => {
  const h = await fixture(t); await h.open(); h.set('Far', 999, false); h.set('LightEnergy', 12, false); changeBackground(h);
  assert.deepEqual(h.proposals[0].values, { background: '#Ab12Cd' }); assert.equal(h.proposals[0].afterEnvironment.camera.far, 100); assert.equal(h.proposals[0].afterEnvironment.light.energy, 1);
});
test('empty, nonfinite or out-of-range selected numeric input is retained without authorizing application', async t => {
  for (const [group, field, value] of [['CameraPosition', 'CameraPositionX', ''], ['CameraTarget', 'CameraTargetZ', 'NaN'], ['Fov', 'Fov', 180], ['Clip', 'Near', 0], ['Clip', 'Far', 100001], ['LightEnergy', 'LightEnergy', -1], ['LightDirection', 'LightDirectionX', '1e309']]) {
    const h = await fixture(t); await h.open(); h.select(group); h.set(field, value); h.check(); assert.equal(h.el(field).value, String(value)); assert.equal(h.el('Apply').disabled, true, field); assert.equal(h.calls.length, 0);
  }
});
test('invalid hexadecimal colors are retained as raw text and never approve', async t => {
  for (const field of ['Background', 'LightColor']) {
    const h = await fixture(t); await h.open(); h.select(field); h.set(field, '#fff'); h.check(); assert.equal(h.el(field).value, '#fff'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.proposals.length, 0);
  }
});
test('combined invalid camera and lighting declarations are rejected without changing the source', async t => {
  for (const invalid of ['coincident-camera', 'reversed-clip', 'zero-light']) {
    const h = await fixture(t); await h.open();
    if (invalid === 'coincident-camera') { h.select('CameraTarget'); h.set('CameraTargetX', 4); h.set('CameraTargetY', 3); h.set('CameraTargetZ', 6); }
    if (invalid === 'reversed-clip') { h.select('Clip'); h.set('Near', 30); h.set('Far', 10); }
    if (invalid === 'zero-light') { h.select('LightDirection'); for (const axis of ['X', 'Y', 'Z']) h.set('LightDirection' + axis, 0); }
    h.check(); assert.equal(h.el('Apply').disabled, true, invalid); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
  }
});
test('explicitly selecting existing values reports a no-op and cannot authorize Apply', async t => {
  const h = await fixture(t); await h.open(); h.select('Clip'); h.check(); assert.match(h.el('Status').textContent, /未改变/); assert.equal(h.el('Review').hidden, true); await h.apply(); assert.equal(h.calls.length, 0);
});
test('ordinary checkbox and value edits revoke approval while preserving the new input', async t => {
  const h = await fixture(t); await h.open(); changeBackground(h); h.set('Background', '#abcdef'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true);
  h.check(); h.select('LightEnergy'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Background').value, '#abcdef');
});
test('silent checkbox, selected number, color or unselected input changes cannot replay review', async t => {
  for (const mutation of ['checkbox', 'number', 'color', 'unselected']) {
    const h = await fixture(t); await h.open(); changeBackground(h);
    if (mutation === 'checkbox') h.select('LightEnergy', true, false);
    if (mutation === 'number') { h.select('Fov'); h.set('Fov', 60); h.check(); h.set('Fov', 70, false); }
    if (mutation === 'color') h.set('Background', '#abcdef', false);
    if (mutation === 'unselected') h.set('Far', 150, false);
    await h.apply(); assert.equal(h.calls.length, 0, mutation); assert.equal(h.el('Apply').disabled, true, mutation);
  }
});
test('all three languages preserve selection, raw numbers, raw colors and approved complete source', async t => {
  const h = await fixture(t); await h.open(); h.select('Clip'); h.set('Near', '.25'); h.set('Far', '0200'); h.select('Background'); h.set('Background', '#Ab12Cd'); h.check(); const source = h.el('Source').textContent;
  for (const language of ['en', 'ja', 'zh']) {
    h.setLanguage(language); assert.equal(h.el('ClipSelected').checked, true); assert.equal(h.el('Near').value, '.25'); assert.equal(h.el('Far').value, '0200'); assert.equal(h.el('Background').value, '#Ab12Cd');
    assert.equal(h.el('Source').textContent, source); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Btn').textContent, ({ en, ja }[language]?.['编辑3D环境'] || '编辑3D环境'));
  }
});
test('translated captions and numeric accessibility labels do not leave untranslated environment labels', async t => {
  const h = await fixture(t); await h.open();
  for (const language of ['en', 'ja']) {
    h.setLanguage(language); const dictionary = { en, ja }[language];
    for (const element of h.el('Dialog').querySelectorAll('[data-i18n]')) {
      const key = element.dataset.i18n; assert.equal(typeof dictionary[key], 'string', key); assert.equal(element.textContent, dictionary[key]);
    }
    assert.equal(h.el('Near').getAttribute('aria-label'), dictionary['近裁剪面']);
  }
});
test('declining cancellation retains local inputs and approval; accepting discards only the form', async t => {
  let discard = false; const h = await fixture(t, { confirm: () => discard }); await h.open(); changeBackground(h); const source = h.el('Source').textContent;
  h.el('Cancel').click(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Source').textContent, source); assert.equal(h.el('Apply').disabled, false);
  discard = true; h.el('Cancel').click(); assert.equal(h.el('Dialog').open, false); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
});
test('Escape cancellation honors discard choice and ignores repeat or composition keys', async t => {
  let discard = false; const h = await fixture(t, { confirm: () => discard }); await h.open(); changeBackground(h);
  const event = h.el('Dialog').dispatch('keydown', { key: 'Escape' }); assert.equal(event.defaultPrevented, true); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, false);
  discard = true; for (const state of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) { h.el('Dialog').dispatch('keydown', { key: 'Escape', ...state }); assert.equal(h.el('Dialog').open, true); }
  h.el('Dialog').dispatch('keydown', { key: 'Escape' }); assert.equal(h.el('Dialog').open, false);
});
test('same-path token changes retain raw input but invalidate the source approval', async t => {
  const h = await fixture(t); await h.open(); changeBackground(h); h.context.sourceToken += ':reload'; h.controller.refresh();
  assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Background').value, '#Ab12Cd'); assert.equal(h.el('Check').disabled, true); await h.apply(); assert.equal(h.calls.length, 0);
});
test('changing path or leaving an eligible source closes the local form without writing', async t => {
  for (const [key, value] of [['sourcePath', 'other.scene3d.json'], ['editable', false], ['sourceJSON', false]]) {
    const h = await fixture(t); await h.open(); changeBackground(h); h.context[key] = value; h.controller.refresh(); assert.equal(h.el('Dialog').open, false, key); assert.equal(h.calls.length, 0);
  }
});
test('closing a pending read prevents late source completion or focus from reopening the form', async t => {
  const wait = deferred(); const h = await fixture(t, { source: () => wait.promise }); const opened = h.open(); assert.equal(h.el('Close').disabled, false); h.controller.close(true);
  wait.resolve(h.snapshot()); assert.equal(await opened, false); assert.equal(h.el('Dialog').open, false); assert.equal(h.el('Fields').hidden, true);
});
test('advancing the source token during a read cannot load a stale environment or authorize edits', async t => {
  const wait = deferred(); const h = await fixture(t, { source: () => wait.promise }); const previous = h.snapshot(), opened = h.open();
  h.context.sourceToken += ':changed'; wait.resolve(previous); assert.equal(await opened, false); assert.equal(h.el('Fields').hidden, true);
  assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0); assert.equal(h.el('Close').disabled, false);
});
test('an older source read cannot overwrite a newer opened session', async t => {
  const wait = deferred(); let reads = 0; const h = await fixture(t, { source: snapshot => ++reads === 1 ? wait.promise : snapshot });
  const old = h.open(); h.controller.close(true); assert.equal(await h.open(), true); h.select('Background'); h.set('Background', '#abcdef'); wait.resolve(h.snapshot()); assert.equal(await old, false);
  assert.equal(h.el('Background').value, '#abcdef'); assert.equal(h.el('Dialog').open, true);
});
test('late read failures after close are quiet and malformed source snapshots cannot create a session', async t => {
  const wait = deferred(); const h = await fixture(t, { source: () => wait.promise }); const opened = h.open(); h.controller.close(true); wait.reject(Error('Late failure')); assert.equal(await opened, false); assert.equal(h.alerts.length, 0);
  for (const change of [{ token: 'wrong' }, { sourcePath: 'wrong' }, { content: '{}' }]) {
    const invalid = await fixture(t, { source: snapshot => ({ ...snapshot, ...change }) }); assert.equal(await invalid.open(), false); assert.equal(invalid.el('Check').disabled, true); assert.equal(invalid.calls.length, 0);
  }
});
test('malformed candidate identity, input values or complete source is rejected before approval', async t => {
  for (const mutation of ['kind', 'path', 'token', 'values', 'content', 'paths']) {
    const h = await fixture(t, { propose: (snapshot, edit) => {
      const candidate = copy(stubProposal(snapshot, edit));
      if (mutation === 'kind') candidate.kind = 'scene3d-transform'; if (mutation === 'path') candidate.sourcePath = 'other'; if (mutation === 'token') candidate.sourceToken = 'other';
      if (mutation === 'values') candidate.values = { background: '#ffffff' }; if (mutation === 'content') candidate.afterContent = candidate.beforeContent; if (mutation === 'paths') candidate.changedPaths = [];
      return candidate;
    } }); await h.open(); changeBackground(h); assert.equal(h.el('Apply').disabled, true, mutation); await h.apply(); assert.equal(h.calls.length, 0);
  }
});
test('a successful exact receipt advances source token, applies only memory and returns focus once', async t => {
  let focuses = 0; const h = await fixture(t, { focus: () => focuses++ }); await h.open(); changeBackground(h); const approved = h.proposals[0]; await h.apply();
  assert.equal(h.calls[0].proposal, approved); assert.equal(h.content(), approved.afterContent); assert.notEqual(h.context.sourceToken, approved.sourceToken); assert.equal(h.el('Dialog').open, false); assert.equal(focuses, 1);
});
test('path, content, owner token or unconfirmed successful-looking receipts cannot close the form', async t => {
  for (const mutation of ['path', 'content', 'old-token', 'current-token', 'false', 'null']) {
    const h = await fixture(t, { apply: (proposal, ports, state) => {
      assert.equal(ports.isCurrent(), true); state.context.sourceToken = 'new-token'; const receipt = { applied: true, sourcePath: proposal.sourcePath, sourceToken: 'new-token', content: proposal.afterContent };
      if (mutation === 'path') receipt.sourcePath = 'other'; if (mutation === 'content') receipt.content = proposal.beforeContent; if (mutation === 'old-token') { receipt.sourceToken = proposal.sourceToken; state.context.sourceToken = proposal.sourceToken; }
      if (mutation === 'current-token') state.context.sourceToken = 'different'; if (mutation === 'false') receipt.applied = false; return mutation === 'null' ? null : receipt;
    } }); await h.open(); changeBackground(h); await h.apply(); assert.equal(h.el('Dialog').open, true, mutation); assert.match(h.el('Diagnostic').textContent, /receipt/, mutation);
  }
});
test('pending application locks all fields but cancellation immediately revokes the injected source guard', async t => {
  const wait = deferred(); let focuses = 0; const h = await fixture(t, { apply: () => wait.promise }); await h.open(); changeBackground(h); h.el('Apply').click();
  for (const id of ids) assert.equal(h.el(id + 'Selected').disabled, true, id); for (const field of fields) assert.equal(h.el(field).disabled, true, field);
  assert.equal(h.el('Close').disabled, false); assert.equal(h.el('Cancel').disabled, false); h.el('Cancel').click(); assert.equal(h.calls[0].ports.isCurrent(), false);
  wait.resolve({ applied: true, sourcePath: h.context.sourcePath, sourceToken: 'late', content: h.calls[0].proposal.afterContent, focus: () => focuses++ }); await h.settle(); assert.equal(h.el('Dialog').open, false); assert.equal(focuses, 0);
});
test('silent pending checkbox, color or number changes invalidate both apply guard and late receipt', async t => {
  for (const mutation of ['checkbox', 'color', 'number']) {
    const wait = deferred(); const h = await fixture(t, { apply: () => wait.promise }); await h.open(); changeBackground(h); h.el('Apply').click();
    if (mutation === 'checkbox') h.select('LightEnergy', true, false); if (mutation === 'color') h.set('Background', '#abcdef', false); if (mutation === 'number') h.set('Near', .5, false);
    assert.equal(h.calls[0].ports.isCurrent(), false, mutation); h.context.sourceToken = 'new-token'; wait.resolve({ applied: true, sourcePath: h.context.sourcePath, sourceToken: 'new-token', content: h.calls[0].proposal.afterContent }); await h.settle();
    assert.equal(h.el('Dialog').open, true, mutation); assert.equal(h.el('Apply').disabled, true, mutation);
  }
});
test('an older apply response cannot clear a new pending source read', async t => {
  const applied = deferred(), read = deferred(); let reads = 0; const h = await fixture(t, { source: snapshot => ++reads === 1 ? snapshot : read.promise, apply: () => applied.promise });
  await h.open(); changeBackground(h); h.el('Apply').click(); h.controller.close(true); const opened = h.open(); applied.resolve({ applied: true }); await h.settle();
  assert.equal(h.el('Dialog').getAttribute('aria-busy'), 'true'); read.resolve(h.snapshot()); assert.equal(await opened, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Background').value, '#112233');
});
test('duplicate apply requests issue one call and failed application retains the local author intent', async t => {
  const wait = deferred(); const h = await fixture(t, { apply: () => wait.promise }); await h.open(); changeBackground(h); h.el('Apply').click(); h.el('Apply').click(); assert.equal(h.calls.length, 1);
  wait.reject(Error('Draft port failed')); await h.settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Background').value, '#Ab12Cd'); assert.match(h.el('Diagnostic').textContent, /failed/);
});
test('capability loss affects only this independent form and never grants Save, rendering or sibling authority', async t => {
  const h = await fixture(t); await h.open(); changeBackground(h); h.setSupported(false); h.controller.refresh(); await h.apply(); assert.equal(h.calls.length, 0); assert.equal(h.el('Btn').disabled, true);
  const source = await fs.readFile(new URL('../../web/modules/app-scene3d-environment.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /app-scene3d-preview|app-scene3d-transforms|app-scene3d-objects|scene3d-renderer|app-project-build|WORLD_API|fetch\(|\.save\(/);
  const css = await fs.readFile(new URL('../../web/scene3d-environment.css', import.meta.url), 'utf8'); assert.match(css, /\[hidden\]\s*\{\s*display:none!important/);
});
test('cancel restores focus and disposal is idempotent during a late source read', async t => {
  const wait = deferred(); const h = await fixture(t, { source: () => wait.promise }); h.el('Btn').focus(); const opened = h.open(); h.controller.close(); await h.settle(); assert.equal(h.document.activeElement, h.el('Btn'));
  h.controller.dispose(); h.controller.dispose(); wait.resolve(h.snapshot()); assert.equal(await opened, false); assert.equal(h.el('Dialog'), null); assert.equal(h.el('Btn'), null); assert.equal(h.unsubscribed(), 1);
});
test('mixed background, camera clipping and light changes use real portable native WASM and preserve the proposal brand', async t => {
  assert.equal(supportsStudioCoreScene3DEnvironmentPatch(), true);
  const h = await fixture(t, { propose: createScene3DEnvironmentProposal }); await h.open(); h.select('Background'); h.set('Background', '#aBCdEF');
  h.select('CameraPosition'); h.set('CameraPositionX', 10); h.select('Clip'); h.set('Near', 120); h.set('Far', 250); h.select('LightEnergy'); h.set('LightEnergy', 2.5); h.check();
  assert.equal(h.el('Apply').disabled, false); assert.equal(isScene3DEnvironmentProposal(h.proposals[0]), true); const candidate = h.proposals[0];
  assert.deepEqual(candidate.values, { background: '#aBCdEF', camera: { position: [10, 3, 6], near: 120, far: 250 }, light: { energy: 2.5 } });
  assert.equal(candidate.beforeContent, h.original); assert.equal(candidate.afterContent.startsWith('\ufeff'), true); assert.match(candidate.afterContent, /\r\n/);
  const after = parseScene3DSource(candidate.afterContent).model; assert.deepEqual(after.objects, author().objects); assert.deepEqual(after.light.direction, author().light.direction); assert.equal(after.camera.fovDegrees, 50);
  assert.equal(h.content(), h.original); await h.apply(); assert.equal(h.calls.length, 1); assert.equal(isScene3DEnvironmentProposal(h.calls[0].proposal), true); assert.equal(h.el('Dialog').open, false);
});


test('fog is an opt-in environment component: native review, draft-only apply and reopen', async t => {
  const h = await fixture(t, { propose: createScene3DEnvironmentProposal }); await h.open();
  assert.equal(h.el('FogSelected').checked, false); assert.equal(h.el('FogDensity').disabled, true);
  changeBackground(h); assert.equal(Object.hasOwn(JSON.parse(h.el('Source').textContent.replace(/^\ufeff/, '')), 'fog'), false);
  h.select('Background', false); h.select('Fog'); h.set('FogColor', '#BaCcDd'); h.set('FogDensity', .2); h.check();
  assert.equal(h.el('Apply').disabled, false); const proposal = h.proposals.at(-1);
  assert.equal(Object.hasOwn(proposal.beforeEnvironment, 'fog'), false); assert.deepEqual(proposal.afterEnvironment.fog, { color: '#BaCcDd', density: .2 });
  assert.deepEqual(proposal.changedPaths, ['/fog']); assert.equal(h.content(), h.original);
  await h.apply(); assert.equal(h.content(), proposal.afterContent); await h.open();
  assert.equal(h.el('FogColor').value, '#BaCcDd'); assert.equal(h.el('FogDensity').value, '0.2');
  h.select('Fog'); h.set('FogDensity', 0); h.check(); assert.deepEqual(h.proposals.at(-1).changedPaths, ['/fog/density']);
  assert.equal(h.proposals.at(-1).afterEnvironment.fog.density, 0);
});

test('fog cancellation and rejected density retain original source', async t => {
  for (const value of ['', -1, 1.01, 'NaN']) {
    const h = await fixture(t, { propose: createScene3DEnvironmentProposal }); await h.open();
    h.select('Fog'); h.set('FogDensity', value); h.check(); assert.equal(h.el('Apply').disabled, true);
    assert.equal(h.content(), h.original); h.controller.close(true);
  }
  const h = await fixture(t, { propose: createScene3DEnvironmentProposal }); await h.open(); h.select('Fog'); h.check();
  assert.equal(h.el('Apply').disabled, false); h.el('Cancel').click(); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
});

test('optional fog capability loss revokes approval but old core retains other environment fields', async t => {
  const h = await fixture(t, { fogSupported: false, propose: createScene3DEnvironmentProposal }); await h.open();
  assert.equal(h.el('FogSelected').disabled, true); assert.equal(h.el('FogUnavailable').hidden, false);
  changeBackground(h); assert.equal(h.el('Apply').disabled, false); assert.equal(h.proposals.at(-1).values.fog, undefined);
  h.select('Background', false); h.setFogSupported(true); h.controller.refresh(); h.select('Fog'); h.check();
  assert.equal(h.el('Apply').disabled, false); h.setFogSupported(false); h.controller.refresh();
  assert.equal(h.el('Apply').disabled, true); await h.apply(); assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
});

test('fog labels and density survive Chinese English Japanese switching without reauthoring', async t => {
  const h = await fixture(t, { propose: createScene3DEnvironmentProposal }); await h.open(); h.select('Fog'); h.set('FogDensity', .075); h.check();
  const source = h.el('Source').textContent;
  for (const lang of ['en', 'ja', 'zh']) {
    h.setLanguage(lang); assert.equal(h.el('FogDensity').value, '0.075'); assert.equal(h.el('Source').textContent, source); assert.equal(h.el('Apply').disabled, false);
    assert.equal(h.el('FogDensity').getAttribute('aria-label'), ({ en, ja }[lang]?.['雾密度（每场景单位）'] || '雾密度（每场景单位）'));
  }
});

test('particle author form reviews a complete Rust proposal and ordinary application preserves author objects', async t => {
  const h = await fixture(t, { propose: createScene3DEnvironmentProposal }); await h.open();
  assert.equal(h.el('ParticlesSelected').checked, false); assert.equal(h.el('ParticleCount').value, '512');
  h.select('Particles'); h.check(); assert.equal(h.el('Apply').disabled, false);
  const proposal = h.proposals.at(-1); assert.deepEqual(proposal.changedPaths, ['/particleField']);
  assert.equal(proposal.values.particleField.count, 512); assert.deepEqual(JSON.parse(proposal.afterContent.replace(/^\ufeff/, '')).objects, author().objects);
  assert.equal(h.content(), h.original); await h.apply(); assert.equal(h.calls.length, 1);
  await h.open(); assert.equal(h.el('ParticleVelocityY').value, '-8'); h.select('Particles'); h.set('ParticleCount', 0); h.check();
  assert.deepEqual(h.proposals.at(-1).changedPaths, ['/particleField/count']);
});
test('particle form bounds, integers and size/extent constraints reject invalid drafts without applying', async t => {
  const h = await fixture(t, { propose: createScene3DEnvironmentProposal }); await h.open(); h.select('Particles');
  for (const [id, value] of [['ParticleCount', .5], ['ParticleCount', 4097], ['ParticleSeed', -1], ['ParticleSeed', 4294967296], ['ParticleSizeX', 20]]) {
    const old = h.el(id).value; h.set(id, value); h.check(); assert.equal(h.el('Apply').disabled, true, id); h.set(id, old);
  }
  assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
});
test('legacy core disables only particle authoring, while languages retain author values', async t => {
  const h = await fixture(t, { particlesSupported: false }); await h.open(); assert.equal(h.el('ParticlesSelected').disabled, true); assert.equal(h.el('BackgroundSelected').disabled, false);
  const next = await fixture(t, { propose: createScene3DEnvironmentProposal }); await next.open(); next.select('Particles'); next.set('ParticleSeed', 4242);
  for (const language of ['en', 'ja', 'zh']) { next.setLanguage(language); assert.equal(next.el('ParticleSeed').value, '4242'); }
});
