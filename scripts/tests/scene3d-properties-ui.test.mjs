import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DPropertiesProposal, isScene3DPropertiesProposal } from '../../engine/scene3d-properties.mjs';
import { supportsStudioCoreScene3DPropertiesPatch } from '../../engine/studio-core.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const one = '00000000-0000-4000-8000-000000000001', two = '00000000-0000-4000-8000-000000000002';
const author = () => ({ format: 'viento-scene3d', schemaVersion: 1, name: 'Boxes', viewport: [640, 480], background: '#112233',
  camera: { position: [4, 3, 6], target: [0, 0, 0], fovDegrees: 50, near: .1, far: 100 }, light: { direction: [1, -2, -1], color: '#ffffff', energy: 1 },
  objects: [{ instanceId: one, name: '<b>Blue box</b>', primitive: 'box', position: [0, 1, 0], rotationDegrees: [23, -41, 67], size: [1, 2, 3], color: '#556677' },
    { instanceId: two, name: ' 雪😀 ', primitive: 'box', position: [2, 0, 0], rotationDegrees: [0, 0, 0], size: [1, 1, 1], color: '#aBCdEF' }] });
const serialize = value => '\ufeff' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n';
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function stubProposal(snapshot, { instanceId, values }) {
  const model = JSON.parse(snapshot.content.replace(/^\ufeff/, '')), index = model.objects.findIndex(item => item.instanceId === instanceId);
  if (index < 0) throw Error('Unknown identity'); const beforeObject = copy(model.objects[index]), changedPaths = [];
  for (const [field, value] of Object.entries(values)) if (value !== beforeObject[field]) { model.objects[index][field] = value; changedPaths.push(`/objects/${index}/${field}`); }
  if (!changedPaths.length) throw Object.assign(Error('No decoded property changed'), { errorCode: 'scene3d_properties_unchanged' });
  parseScene3DSource(serialize(model));
  return freeze({ kind: 'scene3d-properties', sourcePath: snapshot.sourcePath, sourceToken: snapshot.token, baseSourceRevision: snapshot.baseSourceRevision,
    sourceRevision: snapshot.sourceRevision, instanceId, values: copy(values), beforeContent: snapshot.content, afterContent: serialize(model), changedPaths,
    beforeObject, afterObject: copy(model.objects[index]) });
}
async function fixture(t, options = {}) {
  let language = options.language || 'zh', listener = () => {}, supported = options.supported ?? true, unsubscribed = 0, loads = 0;
  const original = options.content || serialize(options.model || author()); let content = original;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, sourcePath: 'documents/boxes.scene3d.json', sourceToken: '1:0:0' };
  const calls = [], proposals = [], confirmations = [], alerts = [];
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, baseSourceRevision: hash(original), sourceRevision: hash(content) });
  const translate = value => ({ en, ja }[language]?.[value] || value);
  const h = await dialogHarness('app-scene3d-properties', {
    queueMicrotask, supportsStudioCoreScene3DPropertiesPatch: () => supported, parseScene3DSource,
    createScene3DPropertiesProposal(source, edit) { const result = (options.propose || stubProposal)(copy(source), copy(edit)); proposals.push(result); return result; },
    t: translate, translatePage(root) { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange(fn) { listener = fn; return () => { unsubscribed++; listener = () => {}; }; },
  });
  h.runtime.window.alert = value => alerts.push(value); h.runtime.window.confirm = value => { confirmations.push(value); return options.confirm?.(value) ?? true; };
  const controller = h.runtime.setupScene3DProperties({ getContext: () => context, getSource: async () => { loads++; return options.source ? options.source(snapshot()) : snapshot(); },
    applyDraft: async (proposal, ports) => {
      calls.push({ proposal, ports }); if (options.apply) return options.apply(proposal, ports, { context, snapshot, setContent(value) { content = value; } });
      assert.equal(ports.isCurrent(), true); content = proposal.afterContent; context.sourceToken += ':applied';
      return { applied: true, sourcePath: context.sourcePath, sourceToken: context.sourceToken, content, focus: options.focus };
    } });
  const el = suffix => h.element('scene3dProperties' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); };
  if (options.normalizeName) { let visible = ''; Object.defineProperty(el('Name'), 'value', { configurable: true, get: () => visible, set: value => { visible = String(value).replace(/\r\n?/g, '\n'); } }); }
  const set = (suffix, value, event = true) => { el(suffix).value = String(value); if (event) el(suffix).dispatch('input'); };
  const select = (suffix, checked = true, event = true) => { el(suffix + 'Selected').checked = checked; if (event) el(suffix + 'Selected').dispatch('change'); };
  const target = value => { el('Instance').value = value; el('Instance').dispatch('change'); };
  const check = () => el('Check').click(), apply = async () => { el('Apply').click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, context, el, settle, set, select, target, check, apply, calls, proposals, alerts, confirmations, original, snapshot,
    loads: () => loads, unsubscribed: () => unsubscribed, open: () => controller.open(), content: () => content,
    setSupported(value) { supported = value; }, setLanguage(value) { language = value; listener(); } };
}
const rename = h => { h.select('Name'); h.set('Name', '  作者😀 <script>literal</script>  '); h.check(); };

test('independent entry gates existing JSON source and explains optional property-core support', async t => {
  const h = await fixture(t); assert.equal(h.el('Btn').hidden, false);
  for (const [key, value] of [['editable', false], ['creating', true], ['sourceJSON', false], ['sourcePath', ''], ['sourceToken', '']]) {
    const old = h.context[key]; h.context[key] = value; h.controller.refresh(); assert.equal(h.el('Btn').hidden, true); assert.equal(await h.open(), false); h.context[key] = old;
  }
  h.context.busy = true; h.controller.refresh(); assert.equal(await h.open(), false); h.context.busy = false; h.setSupported(false); h.controller.refresh();
  assert.equal(h.el('Btn').disabled, true); assert.equal(h.el('Unavailable').hidden, false); assert.match(h.el('Btn').title, /只读预览/); assert.equal(await h.open(), false); assert.equal(h.loads(), 0);
});
test('opening displays raw text properties and stable identities without preselecting any SET fields', async t => {
  const h = await fixture(t); await h.open(); assert.equal(h.el('Instance').value, one); assert.equal(h.el('Name').value, author().objects[0].name);
  assert.equal(h.el('Color').value, '#556677'); for (const field of ['Name', 'Color']) { assert.equal(h.el(field + 'Selected').checked, false); assert.equal(h.el(field).disabled, true); assert.equal(field === 'Name' ? h.el(field).tagName : h.el(field).getAttribute('type'), field === 'Name' ? 'TEXTAREA' : 'text'); }
  assert.equal(h.el('Instance').children[0].textContent, '<b>Blue box</b>'); assert.equal(h.el('Instance').children[0].children.length, 0); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true);
  assert.deepEqual(Object.keys(h.controller).sort(), ['close', 'destroy', 'dispose', 'open', 'refresh']);
});
test('empty selection cannot invoke a proposal or application port', async t => {
  const h = await fixture(t); await h.open(); h.check(); await h.apply(); assert.equal(h.proposals.length, 0); assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
});
test('name-only SET preserves exact whitespace and Unicode while reviewing the complete unchanged identity and transforms', async t => {
  const h = await fixture(t); await h.open(); rename(h); const p = h.proposals[0]; assert.deepEqual(p.values, { name: '  作者😀 <script>literal</script>  ' });
  assert.deepEqual(p.beforeObject, author().objects[0]); assert.deepEqual(p.afterObject, { ...author().objects[0], name: p.values.name }); assert.deepEqual(p.changedPaths, ['/objects/0/name']);
  assert.equal(h.el('Source').textContent, p.afterContent); assert.match(h.el('After').textContent, /<script>literal<\/script>/); assert.equal(h.el('After').children.length, 0); assert.equal(h.content(), h.original);
});
test('color-only SET preserves hexadecimal case and all other properties', async t => {
  const h = await fixture(t); await h.open(); h.select('Color'); h.set('Color', '#Ab12Cd'); h.check(); assert.deepEqual(h.proposals[0].values, { color: '#Ab12Cd' });
  assert.deepEqual(h.proposals[0].afterObject, { ...author().objects[0], color: '#Ab12Cd' }); assert.equal(h.el('Apply').disabled, false);
});
test('untouched textarea normalization preserves decoded CRLF and CR names when Color changes', async t => {
  const model = author(); model.objects[0].name = 'Line one\r\nLine two\rEnd'; const h = await fixture(t, { model, normalizeName: true, propose: createScene3DPropertiesProposal });
  await h.open(); assert.equal(h.el('Name').value, 'Line one\nLine two\nEnd'); h.select('Name'); h.select('Color'); h.set('Color', '#abcdef'); h.check();
  assert.equal(h.el('Apply').disabled, false); assert.equal(h.proposals[0].values.name, model.objects[0].name); assert.equal(h.proposals[0].afterObject.name, model.objects[0].name);
  assert.deepEqual(h.proposals[0].changedPaths, ['/objects/0/color']);
  h.set('Name', 'Changed\nName'); h.check(); assert.equal(h.proposals[1].values.name, 'Changed\nName'); assert.equal(h.proposals[1].afterObject.name, 'Changed\nName');
});
test('native-accepted LF, blank or control-character names are submitted without trimming or filtering', async t => {
  for (const name of ['\nline one\nline two\n', '   ', '\u0001literal']) {
    const h = await fixture(t, { propose: createScene3DPropertiesProposal }); await h.open(); h.select('Name'); h.set('Name', name); h.check();
    assert.equal(h.el('Apply').disabled, false); assert.equal(h.proposals[0].values.name, name); assert.equal(h.el('Name').value, name);
  }
});
test('both explicit properties form one reviewed change and silently altered unselected values are excluded', async t => {
  const h = await fixture(t); await h.open(); h.set('Color', '#ffffff', false); rename(h); assert.deepEqual(h.proposals[0].values, { name: '  作者😀 <script>literal</script>  ' });
  h.select('Color'); h.check(); assert.deepEqual(h.proposals[1].values, { name: '  作者😀 <script>literal</script>  ', color: '#ffffff' });
});
test('target selection loads the selected object declaration by UUID and clears local selection and review', async t => {
  const h = await fixture(t); await h.open(); h.target(two); assert.equal(h.el('Name').value, ' 雪😀 '); assert.equal(h.el('Color').value, '#aBCdEF'); assert.equal(h.el('NameSelected').checked, false);
  rename(h); assert.equal(h.proposals[0].instanceId, two); assert.deepEqual(h.proposals[0].changedPaths, ['/objects/1/name']);
});
test('declining a dirty target switch retains bound identity, author inputs and approval', async t => {
  const h = await fixture(t, { confirm: () => false }); await h.open(); rename(h); const source = h.el('Source').textContent; h.target(two);
  assert.equal(h.el('Instance').value, one); assert.equal(h.el('Name').value, '  作者😀 <script>literal</script>  '); assert.equal(h.el('Source').textContent, source); assert.equal(h.el('Apply').disabled, false);
});
test('silent legal or unknown target mutation before Check cannot approve the old bound object', async t => {
  for (const value of [two, '00000000-0000-4000-8000-000000000099']) {
    const h = await fixture(t); await h.open(); h.select('Name'); h.set('Name', 'Pending'); h.set('Instance', value, false); h.check(); assert.equal(h.proposals.length, 0);
    assert.equal(h.el('Instance').value, one); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Name').value, 'Pending');
  }
});
test('invalid color or native-invalid name retains raw input without an applicable review', async t => {
  for (const [field, value] of [['Color', '#fff'], ['Color', 'rgb(1,2,3)'], ['Name', ''], ['Name', 'a'.repeat(257)]]) {
    const h = await fixture(t); await h.open(); h.select(field); h.set(field, value); h.check(); assert.equal(h.el(field).value, value); assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0);
  }
});
test('valid maximum Unicode-codepoint names are not limited by a UTF-16 HTML maxlength', async t => {
  const h = await fixture(t); await h.open(); assert.equal(h.el('Name').getAttribute('maxlength'), null); h.select('Name'); h.set('Name', '😀'.repeat(256)); h.check();
  assert.equal(h.el('Apply').disabled, false); assert.equal([...h.proposals[0].values.name].length, 256);
});
test('same decoded values are a native no-op with no approval or application', async t => {
  const h = await fixture(t, { propose: createScene3DPropertiesProposal }); await h.open(); h.select('Name'); h.select('Color'); h.check();
  assert.match(h.el('Status').textContent, /未改变/); assert.equal(h.el('Review').hidden, true); await h.apply(); assert.equal(h.calls.length, 0); assert.equal(h.content(), h.original);
});
test('ordinary field or checkbox edits invalidate prior approval and retain new author values', async t => {
  const h = await fixture(t); await h.open(); rename(h); h.set('Name', 'Next'); assert.equal(h.el('Review').hidden, true); assert.equal(h.el('Apply').disabled, true); h.check(); h.select('Color'); assert.equal(h.el('Apply').disabled, true);
});
test('silent target, checkbox, name or color mutations after review cannot replay approval', async t => {
  for (const mutation of ['Instance', 'NameSelected', 'ColorSelected', 'Name', 'Color']) {
    const h = await fixture(t); await h.open(); rename(h);
    if (mutation.endsWith('Selected')) h.el(mutation).checked = !h.el(mutation).checked; else h.set(mutation, mutation === 'Instance' ? two : mutation === 'Color' ? '#ffffff' : 'Silent', false);
    await h.apply(); assert.equal(h.calls.length, 0, mutation); assert.equal(h.el('Apply').disabled, true, mutation);
  }
});
test('language changes preserve target, raw author values, checkbox selection and complete-source approval', async t => {
  const h = await fixture(t); await h.open(); h.target(two); h.select('Name'); h.set('Name', '  作者😀  '); h.select('Color'); h.set('Color', '#AbCdEf'); h.check(); const source = h.el('Source').textContent;
  for (const language of ['en', 'ja', 'zh']) { h.setLanguage(language); assert.equal(h.el('Instance').value, two); assert.equal(h.el('Name').value, '  作者😀  '); assert.equal(h.el('Color').value, '#AbCdEf');
    assert.equal(h.el('NameSelected').checked, true); assert.equal(h.el('ColorSelected').checked, true); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Source').textContent, source); }
});
test('all new dialog captions have English and Japanese translations without translating author object names', async t => {
  const h = await fixture(t); await h.open(); for (const language of ['en', 'ja']) { h.setLanguage(language); const dictionary = { en, ja }[language];
    for (const element of h.el('Dialog').querySelectorAll('[data-i18n]')) { assert.equal(typeof dictionary[element.dataset.i18n], 'string', element.dataset.i18n); assert.equal(element.textContent, dictionary[element.dataset.i18n]); }
    assert.equal(h.el('Instance').children[1].textContent, ' 雪😀 '); }
});
test('Cancel declines or discards the local form without writing author bytes', async t => {
  let discard = false; const h = await fixture(t, { confirm: () => discard }); await h.open(); rename(h); h.el('Cancel').click(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, false);
  discard = true; h.el('Cancel').click(); assert.equal(h.el('Dialog').open, false); assert.equal(h.content(), h.original); assert.equal(h.calls.length, 0);
});
test('Escape respects discard choice and ignores composition or repeat keys', async t => {
  let discard = false; const h = await fixture(t, { confirm: () => discard }); await h.open(); rename(h); const event = h.el('Dialog').dispatch('keydown', { key: 'Escape' }); assert.equal(event.defaultPrevented, true); assert.equal(h.el('Dialog').open, true);
  discard = true; for (const state of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) { h.el('Dialog').dispatch('keydown', { key: 'Escape', ...state }); assert.equal(h.el('Dialog').open, true); }
  h.el('Dialog').dispatch('keydown', { key: 'Escape' }); assert.equal(h.el('Dialog').open, false);
});
test('same-path source reload invalidates approval while retaining inputs; different paths close the form', async t => {
  const h = await fixture(t); await h.open(); rename(h); h.context.sourceToken += ':changed'; h.controller.refresh(); assert.equal(h.el('Name').value, '  作者😀 <script>literal</script>  ');
  assert.equal(h.el('Check').disabled, true); await h.apply(); assert.equal(h.calls.length, 0); h.context.sourcePath = 'other.json'; h.controller.refresh(); assert.equal(h.el('Dialog').open, false);
});
test('closing a pending read revokes late success or failure without reopening or alerting', async t => {
  for (const failed of [false, true]) { const wait = deferred(); const h = await fixture(t, { source: () => wait.promise }); const opened = h.open(); h.controller.close(true);
    failed ? wait.reject(Error('Late read')) : wait.resolve(h.snapshot()); assert.equal(await opened, false); assert.equal(h.el('Dialog').open, false); assert.equal(h.alerts.length, 0); }
});
test('source token changes across await and malformed snapshots cannot load a stale object form', async t => {
  const wait = deferred(); const h = await fixture(t, { source: () => wait.promise }); const previous = h.snapshot(), opened = h.open(); h.context.sourceToken += ':reload'; wait.resolve(previous); assert.equal(await opened, false); assert.equal(h.el('Fields').hidden, true);
  for (const change of [{ token: 'wrong' }, { sourcePath: 'wrong' }, { content: '{}' }]) { const invalid = await fixture(t, { source: snapshot => ({ ...snapshot, ...change }) }); assert.equal(await invalid.open(), false); assert.equal(invalid.el('Check').disabled, true); }
});
test('older source read cannot replace a newly opened object form or its typed input', async t => {
  const wait = deferred(); let loads = 0; const h = await fixture(t, { source: snapshot => ++loads === 1 ? wait.promise : snapshot }); const old = h.open(); h.controller.close(true); await h.open(); h.select('Name'); h.set('Name', 'New local'); wait.resolve(h.snapshot()); assert.equal(await old, false); assert.equal(h.el('Name').value, 'New local');
});
test('wrong candidate kind, UUID, owner, explicit values or unchanged source cannot be approved', async t => {
  for (const mutation of ['kind', 'identity', 'path', 'token', 'values', 'content', 'paths']) {
    const h = await fixture(t, { propose: (snapshot, edit) => { const p = copy(stubProposal(snapshot, edit)); if (mutation === 'kind') p.kind = 'scene3d-transform'; if (mutation === 'identity') p.instanceId = two;
      if (mutation === 'path') p.sourcePath = 'other'; if (mutation === 'token') p.sourceToken = 'other'; if (mutation === 'values') p.values = { name: 'Other' }; if (mutation === 'content') p.afterContent = p.beforeContent; if (mutation === 'paths') p.changedPaths = []; return p; } });
    await h.open(); rename(h); assert.equal(h.el('Apply').disabled, true, mutation); await h.apply(); assert.equal(h.calls.length, 0);
  }
});
test('exact successful receipt applies only memory, advances source owner token and focuses once', async t => {
  let focus = 0; const h = await fixture(t, { focus: () => focus++ }); await h.open(); rename(h); const p = h.proposals[0]; await h.apply(); assert.equal(h.calls[0].proposal, p);
  assert.equal(h.content(), p.afterContent); assert.notEqual(h.context.sourceToken, p.sourceToken); assert.equal(h.el('Dialog').open, false); assert.equal(focus, 1);
});
test('malformed successful-looking application receipts cannot close the current form', async t => {
  for (const mutation of ['path', 'content', 'old-token', 'empty-token', 'current-token', 'false', 'null']) {
    const h = await fixture(t, { apply: (p, ports, state) => { assert.equal(ports.isCurrent(), true); state.context.sourceToken = 'next'; const r = { applied: true, sourcePath: p.sourcePath, sourceToken: 'next', content: p.afterContent };
      if (mutation === 'path') r.sourcePath = 'other'; if (mutation === 'content') r.content = p.beforeContent; if (mutation === 'old-token') { r.sourceToken = p.sourceToken; state.context.sourceToken = p.sourceToken; }
      if (mutation === 'empty-token') r.sourceToken = ''; if (mutation === 'current-token') state.context.sourceToken = 'different'; if (mutation === 'false') r.applied = false; return mutation === 'null' ? null : r; } });
    await h.open(); rename(h); await h.apply(); assert.equal(h.el('Dialog').open, true, mutation); assert.match(h.el('Diagnostic').textContent, /receipt/, mutation);
  }
});
test('pending application locks all fields while cancellation revokes the port guard and prevents late focus', async t => {
  const wait = deferred(); let focuses = 0; const h = await fixture(t, { apply: () => wait.promise }); await h.open(); rename(h); h.el('Apply').click();
  for (const field of ['Instance', 'NameSelected', 'ColorSelected', 'Name', 'Color', 'Check', 'Apply']) assert.equal(h.el(field).disabled, true, field); assert.equal(h.el('Cancel').disabled, false); h.el('Cancel').click();
  assert.equal(h.calls[0].ports.isCurrent(), false); wait.resolve({ applied: true, sourcePath: h.context.sourcePath, sourceToken: 'late', content: h.calls[0].proposal.afterContent, focus: () => focuses++ }); await h.settle(); assert.equal(h.el('Dialog').open, false); assert.equal(focuses, 0);
});
test('silent pending target, checkbox or text changes revoke both port guard and late successful receipt', async t => {
  for (const mutation of ['Instance', 'NameSelected', 'Name', 'Color']) { const wait = deferred(); const h = await fixture(t, { apply: () => wait.promise }); await h.open(); rename(h); h.el('Apply').click();
    if (mutation.endsWith('Selected')) h.el(mutation).checked = false; else h.set(mutation, mutation === 'Instance' ? two : mutation === 'Color' ? '#ffffff' : 'Silent pending', false);
    assert.equal(h.calls[0].ports.isCurrent(), false); h.context.sourceToken = 'new-token'; wait.resolve({ applied: true, sourcePath: h.context.sourcePath, sourceToken: 'new-token', content: h.calls[0].proposal.afterContent }); await h.settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, true);
  }
});
test('older apply completion cannot clear a newer pending source read', async t => {
  const applied = deferred(), read = deferred(); let loads = 0; const h = await fixture(t, { source: snapshot => ++loads === 1 ? snapshot : read.promise, apply: () => applied.promise }); await h.open(); rename(h); h.el('Apply').click(); h.controller.close(true);
  const opened = h.open(); applied.resolve({ applied: true }); await h.settle(); assert.equal(h.el('Dialog').getAttribute('aria-busy'), 'true'); read.resolve(h.snapshot()); assert.equal(await opened, true); assert.equal(h.el('Name').value, author().objects[0].name);
});
test('duplicate Apply issues one request and rejected application preserves local author intent', async t => {
  const wait = deferred(); const h = await fixture(t, { apply: () => wait.promise }); await h.open(); rename(h); h.el('Apply').click(); h.el('Apply').click(); assert.equal(h.calls.length, 1); wait.reject(Error('Draft port failed')); await h.settle();
  assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Name').value, '  作者😀 <script>literal</script>  '); assert.match(h.el('Diagnostic').textContent, /failed/);
});
test('capability loss disables only the independent properties form without importing siblings or Save authority', async t => {
  const h = await fixture(t); await h.open(); rename(h); h.setSupported(false); h.controller.refresh(); await h.apply(); assert.equal(h.calls.length, 0);
  const source = await fs.readFile(new URL('../../web/modules/app-scene3d-properties.js', import.meta.url), 'utf8'); assert.doesNotMatch(source, /app-scene3d-preview|app-scene3d-transforms|app-scene3d-objects|app-scene3d-environment|scene3d-renderer|WORLD_API|fetch\(|\.save\(|style="/);
  const css = await fs.readFile(new URL('../../web/scene3d-properties.css', import.meta.url), 'utf8'); assert.match(css, /\[hidden\]\s*\{\s*display:none!important/);
});
test('cancel returns focus and idempotent disposal ignores late reads', async t => {
  const wait = deferred(); const h = await fixture(t, { source: () => wait.promise }); h.el('Btn').focus(); const opened = h.open(); h.controller.close(); await h.settle(); assert.equal(h.document.activeElement, h.el('Btn'));
  h.controller.dispose(); h.controller.dispose(); wait.resolve(h.snapshot()); assert.equal(await opened, false); assert.equal(h.el('Dialog'), null); assert.equal(h.el('Btn'), null); assert.equal(h.unsubscribed(), 1);
});
test('actual portable native/WASM property editing keeps the original proposal brand and preserves other source declarations', async t => {
  assert.equal(supportsStudioCoreScene3DPropertiesPatch(), true); const h = await fixture(t, { propose: createScene3DPropertiesProposal }); await h.open(); h.target(two); h.select('Name'); h.set('Name', '  snow 雪😀  '); h.select('Color'); h.set('Color', '#Ab12Cd'); h.check();
  const p = h.proposals[0]; assert.equal(h.el('Apply').disabled, false); assert.equal(isScene3DPropertiesProposal(p), true); assert.deepEqual(p.values, { name: '  snow 雪😀  ', color: '#Ab12Cd' }); assert.deepEqual(p.changedPaths, ['/objects/1/name', '/objects/1/color']);
  const after = parseScene3DSource(p.afterContent).model; assert.deepEqual(after.objects[0], author().objects[0]); assert.equal(after.objects[1].instanceId, two); assert.deepEqual(after.camera, author().camera); assert.deepEqual(after.light, author().light);
  assert.equal(p.beforeContent, h.original); assert.equal(p.afterContent.startsWith('\ufeff'), true); assert.match(p.afterContent, /\r\n/); assert.equal(h.content(), h.original); await h.apply(); assert.equal(isScene3DPropertiesProposal(h.calls[0].proposal), true); assert.equal(h.el('Dialog').open, false);
});
