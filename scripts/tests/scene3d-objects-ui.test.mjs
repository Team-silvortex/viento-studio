import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';
import { parseScene3DSource } from '../../engine/scene3d.mjs';
import { createScene3DObjectsProposal, isScene3DObjectsProposal } from '../../engine/scene3d-objects.mjs';
import { supportsStudioCoreScene3DObjectsPatch } from '../../engine/studio-core.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const one = '00000000-0000-4000-8000-000000000001', two = '00000000-0000-4000-8000-000000000002';
const freshId = index => '00000000-0000-4000-9000-' + String(index).padStart(12, '0');
const author = () => ({ format: 'viento-scene3d', schemaVersion: 1, name: 'Boxes', viewport: [640, 480], background: '#112233',
  camera: { position: [4, 3, 6], target: [0, 0, 0], fovDegrees: 50, near: .1, far: 100 }, light: { direction: [1, -2, -1], color: '#ffffff', energy: 1 },
  objects: [{ instanceId: one, name: '<b>Blue box</b>', primitive: 'box', position: [0, 1, 0], rotationDegrees: [23, -41, 67], size: [1, 2, 3], color: '#556677' },
    { instanceId: two, name: 'Other box', primitive: 'box', position: [2, 0, 0], rotationDegrees: [0, 0, 0], size: [1, 1, 1], color: '#ffffff' }] });
const serialize = value => '\ufeff' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n';
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function stubProposal(snapshot, edit) {
  const model = JSON.parse(snapshot.content.replace(/^\ufeff/, '')), index = model.objects.findIndex(item => item.instanceId === edit.instanceId);
  let beforeObject = null, afterObject = null, instanceId, sourceInstanceId = null;
  if (edit.action === 'remove') {
    if (index < 0 || model.objects.length <= 1) throw Error('Cannot remove this object');
    beforeObject = copy(model.objects[index]); instanceId = edit.instanceId; model.objects.splice(index, 1);
  } else {
    if (model.objects.length >= 128) throw Error('Object limit');
    if (edit.action === 'copy') {
      if (index < 0) throw Error('Unknown source object');
      beforeObject = copy(model.objects[index]); sourceInstanceId = edit.instanceId;
      afterObject = { ...copy(beforeObject), instanceId: edit.newInstanceId, name: edit.name };
    } else if (edit.action === 'add') afterObject = copy(edit.object);
    else throw Error('Unknown action');
    if (!afterObject.name.trim() || [...afterObject.name].length > 256 || /[\x00-\x1f]/.test(afterObject.name) || !/^#[a-f0-9]{6}$/i.test(afterObject.color)) throw Error('Invalid name or color');
    if (model.objects.some(item => item.instanceId === afterObject.instanceId)) throw Error('Duplicate identity');
    instanceId = afterObject.instanceId; model.objects.push(afterObject);
  }
  return freeze({ kind: 'scene3d-objects', action: edit.action, instanceId, sourceInstanceId, edit: copy(edit), sourcePath: snapshot.sourcePath,
    sourceToken: snapshot.token, baseSourceRevision: snapshot.baseSourceRevision, sourceRevision: snapshot.sourceRevision,
    beforeContent: snapshot.content, afterContent: serialize(model), changedPaths: ['/objects'], beforeObject, afterObject });
}
async function fixture(t, options = {}) {
  let language = options.language || 'zh', listener = () => {}, supported = options.supported ?? true, unsubscribed = 0, loads = 0, allocated = 0;
  const model = options.model || author(), original = serialize(model); let content = original;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, sourcePath: 'documents/boxes.scene3d.json', sourceToken: '1:0:0' };
  const calls = [], proposals = [], confirmations = [], alerts = [];
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content, baseSourceRevision: hash(original), sourceRevision: hash(content) });
  const translate = value => ({ en, ja }[language]?.[value] || value);
  const h = await dialogHarness('app-scene3d-objects', {
    queueMicrotask, crypto: { randomUUID: () => { allocated++; return options.uuid?.(allocated) || freshId(allocated); } },
    supportsStudioCoreScene3DObjectsPatch: () => supported, parseScene3DSource,
    createScene3DObjectsProposal(source, edit) { const result = (options.propose || stubProposal)(copy(source), copy(edit)); proposals.push(result); return result; },
    t: translate, translatePage(root) { for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translate(node.dataset.i18n); },
    onLanguageChange(fn) { listener = fn; return () => { unsubscribed++; listener = () => {}; }; },
  });
  h.runtime.window.alert = value => alerts.push(value);
  h.runtime.window.confirm = value => { confirmations.push(value); return options.confirm?.(value) ?? true; };
  const controller = h.runtime.setupScene3DObjects({ getContext: () => context, getSource: async () => { loads++; return options.source ? options.source(snapshot()) : snapshot(); },
    applyDraft: async (proposal, ports) => {
      calls.push({ proposal, ports }); if (options.apply) return options.apply(proposal, ports, { context, snapshot, setContent(value) { content = value; } });
      assert.equal(ports.isCurrent(), true); content = proposal.afterContent; context.sourceToken += ':applied';
      return { applied: true, sourcePath: context.sourcePath, sourceToken: context.sourceToken, content, focus: options.focus };
    } });
  const el = suffix => h.element('scene3dObjects' + suffix), settle = async () => { await flushDialogs(); await flushDialogs(); };
  const set = (suffix, value, event = true) => { el(suffix).value = String(value); if (event) el(suffix).dispatch('input'); };
  const mode = value => { el('Action').value = value; el('Action').dispatch('change'); };
  const target = value => { el('Object').value = value; el('Object').dispatch('change'); };
  const check = () => el('Check').click(), apply = async () => { el('Apply').click(); await settle(); };
  t.after(() => controller.dispose());
  return { ...h, controller, context, el, settle, set, mode, target, check, apply, calls, proposals, alerts, confirmations, original, snapshot,
    loads: () => loads, allocations: () => allocated, unsubscribed: () => unsubscribed, open: () => controller.open(), content: () => content,
    setSupported(value) { supported = value; }, setLanguage(value) { language = value; listener(); } };
}

test('independent entry gates existing JSON source and gives an optional core capability explanation', async t => {
  const h = await fixture(t); assert.equal(h.el('Btn').hidden, false); assert.equal(h.el('Btn').disabled, false);
  for (const [key, value] of [['editable', false], ['creating', true], ['sourceJSON', false], ['sourcePath', '']]) {
    const old = h.context[key]; h.context[key] = value; h.controller.refresh(); assert.equal(h.el('Btn').hidden, true); assert.equal(await h.open(), false); h.context[key] = old;
  }
  h.context.busy = true; h.controller.refresh(); assert.equal(h.el('Btn').disabled, true); assert.equal(await h.open(), false);
  h.context.busy = false; h.setSupported(false); h.controller.refresh(); assert.equal(h.el('Unavailable').hidden, false); assert.match(h.el('Btn').title, /只读预览/);
  assert.equal(await h.open(), false); assert.equal(h.loads(), 0);
});
test('opening allocates one visible readonly add UUID and treats names as plain author text', async t => {
  const h = await fixture(t); assert.equal(await h.open(), true); assert.equal(h.el('Action').value, 'add'); assert.equal(h.el('NewIdentity').value, freshId(1)); assert.equal(h.allocations(), 1);
  assert.notEqual(h.el('NewIdentity').getAttribute('readonly'), null); assert.equal(h.el('Name').value, '新建方块'); assert.equal(h.el('Color').value, '#87d8b9');
  assert.equal(h.el('Object').children[0].textContent, '<b>Blue box</b>'); assert.equal(h.el('Object').children[0].children.length, 0);
  assert.equal(h.el('ObjectField').hidden, true); assert.equal(h.el('Check').disabled, false); assert.equal(h.el('Apply').disabled, true);
  assert.deepEqual(Object.keys(h.controller).sort(), ['close', 'destroy', 'dispose', 'open', 'refresh']);
});
test('add reviews exactly a standard box with explicit name and color and leaves other declarations unchanged', async t => {
  const h = await fixture(t); await h.open(); h.set('Name', '  author box  '); h.set('Color', '#Ab12Cd'); h.check();
  assert.deepEqual(h.proposals[0].edit, { action: 'add', object: { instanceId: freshId(1), name: '  author box  ', primitive: 'box',
    position: [0, 0, 0], rotationDegrees: [0, 0, 0], size: [1, 1, 1], color: '#Ab12Cd' } });
  assert.equal(h.el('Before').textContent, 'null'); assert.match(h.el('After').textContent, /author box/); assert.match(h.el('Count').textContent, /2 → 3/);
  const after = parseScene3DSource(h.el('Source').textContent).model; assert.equal(after.objects.length, 3); assert.deepEqual(after.objects.slice(0, 2), parseScene3DSource(h.original).model.objects);
  assert.equal(h.content(), h.original); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('ChangedPaths').children[0].textContent, '/objects');
});
test('copy names are explicit, default to the exact source name and retain all source transform and color values', async t => {
  const h = await fixture(t); await h.open(); h.mode('copy'); assert.equal(h.el('Name').value, '<b>Blue box</b>'); assert.equal(h.el('ColorField').hidden, true); assert.match(h.el('Identity').textContent, new RegExp(one));
  h.set('Name', 'Copied author'); h.check(); const proposal = h.proposals[0]; assert.equal(proposal.sourceInstanceId, one); assert.equal(proposal.instanceId, freshId(2));
  assert.deepEqual(proposal.afterObject, { ...author().objects[0], instanceId: freshId(2), name: 'Copied author' }); assert.deepEqual(proposal.beforeObject, author().objects[0]);
  assert.equal(h.el('Apply').disabled, false); assert.match(h.el('Count').textContent, /2 → 3/);
});
test('copy does not add a suffix to a valid maximum-length source name', async t => {
  const model = author(); model.objects[0].name = '😀'.repeat(256); const h = await fixture(t, { model }); await h.open(); h.mode('copy'); h.check();
  assert.equal([...h.el('Name').value].length, 256); assert.equal(h.proposals[0].afterObject.name, model.objects[0].name); assert.equal(h.el('Apply').disabled, false);
});
test('remove reviews the selected stable object, a nullable after declaration and exact count reduction', async t => {
  const h = await fixture(t); await h.open(); h.mode('remove'); h.target(two); h.check();
  assert.deepEqual(h.proposals[0].edit, { action: 'remove', instanceId: two }); assert.equal(h.proposals[0].sourceInstanceId, null); assert.equal(h.proposals[0].afterObject, null);
  assert.equal(h.el('After').textContent, 'null'); assert.match(h.el('Count').textContent, /2 → 1/); assert.equal(h.el('NameField').hidden, true); assert.equal(h.el('NewIdentityField').hidden, true);
  assert.deepEqual(parseScene3DSource(h.el('Source').textContent).model.objects.map(item => item.instanceId), [one]);
});
test('last-object removal is blocked explicitly without calling the proposal or draft ports', async t => {
  const model = author(); model.objects.splice(1); const h = await fixture(t, { model }); await h.open(); h.mode('remove');
  assert.equal(h.el('Check').disabled, true); assert.match(h.el('Blocked').textContent, /最后/); h.check(); await h.apply(); assert.equal(h.proposals.length, 0); assert.equal(h.calls.length, 0);
  assert.equal(h.el('Close').disabled, false); assert.equal(h.el('Cancel').disabled, false);
});
test('128-object scenes disable additions and copies but keep explicit removal available', async t => {
  const model = author(); model.objects = Array.from({ length: 128 }, (_, i) => ({ ...copy(model.objects[0]), instanceId: freshId(1000 + i) }));
  const h = await fixture(t, { model }); await h.open(); assert.equal(h.el('Check').disabled, true); assert.match(h.el('Blocked').textContent, /128/);
  for (const option of h.el('Action').children) assert.equal(option.disabled, option.value !== 'remove');
  h.mode('copy'); assert.equal(h.el('Action').value, 'add'); h.check(); assert.equal(h.proposals.length, 0);
  h.mode('remove'); h.check(); assert.equal(h.el('Apply').disabled, false); assert.equal(parseScene3DSource(h.proposals[0].afterContent).model.objects.length, 127);
});
test('allocated identities persist through checks, language changes and failed name validation', async t => {
  const h = await fixture(t); await h.open(); const id = h.el('NewIdentity').value; h.set('Name', ''); h.check(); assert.equal(h.el('Apply').disabled, true);
  for (const language of ['en', 'ja', 'zh']) { h.setLanguage(language); assert.equal(h.el('Name').value, ''); assert.equal(h.el('NewIdentity').value, id); }
  h.set('Name', 'Author name'); h.check(); h.check(); assert.equal(h.allocations(), 1); assert.equal(h.proposals[0].instanceId, h.proposals[1].instanceId);
});
test('starting a different operation or choosing a different copy target allocates a fresh identity only once', async t => {
  const h = await fixture(t); await h.open(); h.mode('copy'); assert.equal(h.allocations(), 2); h.mode('copy'); assert.equal(h.allocations(), 2);
  h.target(two); assert.equal(h.allocations(), 3); assert.equal(h.el('NewIdentity').value, freshId(3)); assert.equal(h.el('Name').value, 'Other box');
  h.target(two); assert.equal(h.allocations(), 3); h.mode('remove'); assert.equal(h.allocations(), 3); h.mode('add'); assert.equal(h.allocations(), 4);
});
test('declining a dirty operation or target switch retains identity, input and approval', async t => {
  const h = await fixture(t, { confirm: () => false }); await h.open(); h.mode('copy'); h.set('Name', 'Pending name'); h.check(); const id = h.el('NewIdentity').value, source = h.el('Source').textContent;
  h.mode('remove'); h.target(two); assert.equal(h.el('Action').value, 'copy'); assert.equal(h.el('Object').value, one); assert.equal(h.el('Name').value, 'Pending name');
  assert.equal(h.el('NewIdentity').value, id); assert.equal(h.el('Source').textContent, source); assert.equal(h.el('Apply').disabled, false); assert.equal(h.allocations(), 2);
});
test('silent action, target or readonly identity changes before check cannot approve a different operation', async t => {
  for (const [field, value] of [['Action', 'remove'], ['Object', two], ['NewIdentity', freshId(700)]]) {
    const h = await fixture(t); await h.open(); h.mode('copy'); h.set(field, value, false); h.check();
    assert.equal(h.proposals.length, 0, field); assert.equal(h.el('Apply').disabled, true, field); assert.equal(h.el('Action').value, 'copy'); assert.equal(h.el('Object').value, one);
    assert.equal(h.el('NewIdentity').value, freshId(2)); assert.equal(h.allocations(), 2); await h.apply(); assert.equal(h.calls.length, 0);
  }
});
test('normal name or color edits invalidate prior review and retain the new author input', async t => {
  const h = await fixture(t); await h.open(); h.check(); h.set('Name', '<script>literal</script>'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Review').hidden, true);
  h.check(); h.set('Color', '#'); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Color').value, '#'); h.check(); assert.equal(h.el('Color').value, '#'); assert.equal(h.el('Apply').disabled, true);
});
test('silent raw values, selectors and generated identity changes cannot reuse an approved proposal', async t => {
  for (const [field, value] of [['Name', 'Silent name'], ['Color', '#abcdef'], ['Action', 'remove'], ['Object', two], ['NewIdentity', freshId(700)]]) {
    const h = await fixture(t); await h.open(); h.check(); h.set(field, value, false); await h.apply(); assert.equal(h.calls.length, 0, field); assert.equal(h.el('Apply').disabled, true, field);
  }
});
test('invalid names, colors and duplicate generated identities preserve raw fields without approving', async t => {
  for (const options of [{ field: 'Name', value: '' }, { field: 'Name', value: 'x'.repeat(257) }, { field: 'Color', value: 'rgb(1,2,3)' }, { uuid: () => one }]) {
    const h = await fixture(t, options); await h.open(); if (options.field) h.set(options.field, options.value); h.check();
    assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0); if (options.field) assert.equal(h.el(options.field).value, options.value);
  }
});
test('all three languages preserve author name, raw color, selection, allocated identity and approved source', async t => {
  const h = await fixture(t, { language: 'ja' }); await h.open(); assert.equal(h.el('Name').value, '新しいボックス'); h.set('Name', '作者 literal'); h.set('Color', '#aBCdEF'); h.check();
  const id = h.el('NewIdentity').value, source = h.el('Source').textContent;
  for (const language of ['en', 'ja', 'zh']) { h.setLanguage(language); assert.equal(h.el('Name').value, '作者 literal'); assert.equal(h.el('Color').value, '#aBCdEF'); assert.equal(h.el('NewIdentity').value, id); assert.equal(h.el('Apply').disabled, false); assert.equal(h.el('Source').textContent, source); }
  assert.equal(h.allocations(), 1); h.setLanguage('en'); assert.equal(h.el('Title').textContent, 'Manage 3D objects'); h.setLanguage('ja'); assert.equal(h.el('Title').textContent, '3Dオブジェクトを管理');
});
test('late source read cannot reopen a cancelled form and cancellation stays enabled while pending', async t => {
  const wait = deferred(); const h = await fixture(t, { source: () => wait.promise }); const opened = h.open();
  assert.equal(h.el('Close').disabled, false); assert.equal(h.el('Cancel').disabled, false); h.el('Cancel').click(); wait.resolve(h.snapshot());
  assert.equal(await opened, false); await h.settle(); assert.equal(h.el('Dialog').open, false); assert.equal(h.allocations(), 0); assert.deepEqual(h.alerts, []);
});
test('late read rejection cannot report into a fresh open or allocate another identity', async t => {
  const wait = deferred(); let reads = 0; const h = await fixture(t, { source: snapshot => ++reads === 1 ? wait.promise : snapshot });
  const old = h.open(); h.controller.close(); assert.equal(await h.open(), true); const status = h.el('Status').textContent; wait.reject(Error('Old source failure'));
  assert.equal(await old, false); assert.equal(h.el('Status').textContent, status); assert.equal(h.el('NewIdentity').value, freshId(1)); assert.equal(h.allocations(), 1); assert.deepEqual(h.alerts, []);
});
test('malformed or mismatched source reads show diagnostics and no application path', async t => {
  for (const source of [snapshot => ({ ...snapshot, token: 'foreign' }), snapshot => ({ ...snapshot, sourcePath: 'other.json' }), snapshot => ({ ...snapshot, content: '{' })]) {
    const h = await fixture(t, { source }); assert.equal(await h.open(), false); assert.equal(h.el('Apply').disabled, true); assert.equal(h.calls.length, 0); assert.equal(h.allocations(), 0);
  }
});
test('source fields are captured before caller mutation and reviews retain the five-field source binding', async t => {
  let supplied; const h = await fixture(t, { source: snapshot => (supplied = snapshot) }); await h.open(); supplied.content = 'foreign'; supplied.token = 'foreign'; supplied.sourceRevision = 'foreign'; h.check();
  assert.equal(h.proposals[0].beforeContent, h.original); assert.equal(h.proposals[0].sourceToken, '1:0:0'); assert.equal(h.proposals[0].sourceRevision, hash(h.original));
});
test('source token changes preserve local inputs but revoke both check and application', async t => {
  const h = await fixture(t); await h.open(); h.set('Name', 'Pending'); h.check(); h.context.sourceToken += ':external'; h.controller.refresh();
  assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Name').value, 'Pending'); assert.match(h.el('Status').textContent, /已变化/); await h.apply(); assert.equal(h.calls.length, 0);
});
test('source navigation or leaving edit mode force-closes local state without an author write', async t => {
  const h = await fixture(t); await h.open(); h.set('Name', 'Pending'); h.context.sourcePath = 'other.json'; h.controller.refresh();
  assert.equal(h.el('Dialog').open, false); assert.equal(h.calls.length, 0); assert.equal(h.confirmations.length, 0);
  await h.open(); h.context.editable = false; h.controller.refresh(); assert.equal(h.el('Dialog').open, false);
});
test('candidate mismatched action identity edit source or count cannot receive approval', async t => {
  for (const mutation of ['action', 'identity', 'sourceIdentity', 'edit', 'revision', 'beforeObject', 'afterObject', 'count']) {
    const h = await fixture(t, { propose(snapshot, edit) {
      const candidate = copy(stubProposal(snapshot, edit));
      if (mutation === 'action') candidate.action = 'remove'; if (mutation === 'identity') candidate.instanceId = one;
      if (mutation === 'sourceIdentity') candidate.sourceInstanceId = one; if (mutation === 'edit') candidate.edit.object.name = 'foreign';
      if (mutation === 'revision') candidate.sourceRevision = 'sha256:' + '0'.repeat(64); if (mutation === 'beforeObject') candidate.beforeObject = author().objects[0];
      if (mutation === 'afterObject') candidate.afterObject.instanceId = one;
      if (mutation === 'count') candidate.afterContent = snapshot.content.replace('Boxes', 'Different scene'); return candidate;
    } }); await h.open(); h.check(); assert.equal(h.el('Apply').disabled, true, mutation); await h.apply(); assert.equal(h.calls.length, 0, mutation);
  }
});
test('mutating a caller-owned candidate after approval cannot retain application rights', async t => {
  let exposed; const h = await fixture(t, { propose(snapshot, edit) { return exposed = copy(stubProposal(snapshot, edit)); } }); await h.open(); h.check();
  exposed.edit.object.color = '#ffffff'; await h.apply(); assert.equal(h.calls.length, 0); assert.equal(h.el('Apply').disabled, true);
});
test('legitimate memory application accepts exact new-token receipt and returns focus once', async t => {
  let focuses = 0, oldGuard, newGuard; const h = await fixture(t, { apply(proposal, ports, state) {
    oldGuard = ports.isCurrent(); state.setContent(proposal.afterContent); state.context.sourceToken = 'new-token'; newGuard = ports.isCurrent();
    return { applied: true, sourcePath: proposal.sourcePath, sourceToken: 'new-token', content: proposal.afterContent, focus: () => focuses++ };
  } }); await h.open(); h.check(); await h.apply(); assert.equal(oldGuard, true); assert.equal(newGuard, false); assert.equal(h.el('Dialog').open, false); assert.equal(focuses, 1); assert.equal(h.calls.length, 1);
});
test('applied true alone and forged path content or token receipts leave the form open', async t => {
  for (const mutation of ['only-flag', 'path', 'content', 'old-token', 'current-token', 'false']) {
    const h = await fixture(t, { apply(proposal, _ports, state) {
      const receipt = { applied: true, sourcePath: proposal.sourcePath, sourceToken: 'new-token', content: proposal.afterContent };
      state.context.sourceToken = 'new-token'; if (mutation === 'only-flag') return { applied: true };
      if (mutation === 'path') receipt.sourcePath = 'other.json'; if (mutation === 'content') receipt.content = 'foreign';
      if (mutation === 'old-token') { receipt.sourceToken = proposal.sourceToken; state.context.sourceToken = proposal.sourceToken; }
      if (mutation === 'current-token') state.context.sourceToken = 'different'; if (mutation === 'false') receipt.applied = false; return receipt;
    } }); await h.open(); h.check(); await h.apply(); assert.equal(h.el('Dialog').open, true, mutation); assert.match(h.el('Diagnostic').textContent, /receipt/, mutation);
  }
});
test('pending application locks all author fields while cancellation revokes the host guard', async t => {
  const wait = deferred(); let focuses = 0; const h = await fixture(t, { apply: () => wait.promise }); await h.open(); h.check(); h.el('Apply').click();
  for (const field of ['Action', 'Object', 'NewIdentity', 'Name', 'Color', 'Check', 'Apply']) assert.equal(h.el(field).disabled, true, field);
  assert.equal(h.el('Close').disabled, false); assert.equal(h.el('Cancel').disabled, false); h.el('Cancel').click(); assert.equal(h.calls[0].ports.isCurrent(), false);
  wait.resolve({ applied: true, sourcePath: h.context.sourcePath, sourceToken: 'late', content: h.calls[0].proposal.afterContent, focus: () => focuses++ }); await h.settle();
  assert.equal(h.el('Dialog').open, false); assert.equal(focuses, 0); assert.equal(h.content(), h.original);
});
test('late apply completion cannot clear or unlock a newer source read', async t => {
  const applied = deferred(), read = deferred(); let loads = 0; const h = await fixture(t, { source: snapshot => ++loads === 1 ? snapshot : read.promise, apply: () => applied.promise });
  await h.open(); h.check(); h.el('Apply').click(); h.controller.close(true); const opened = h.open(); applied.resolve({ applied: true }); await h.settle();
  assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Dialog').getAttribute('aria-busy'), 'true'); read.resolve(h.snapshot()); assert.equal(await opened, true); assert.equal(h.el('NewIdentity').value, freshId(2)); assert.equal(h.el('Apply').disabled, true);
});
test('silent raw changes across await invalidate both source port guard and completion', async t => {
  const wait = deferred(); const h = await fixture(t, { apply: () => wait.promise }); await h.open(); h.check(); h.el('Apply').click(); h.set('Name', 'Silent pending', false);
  assert.equal(h.calls[0].ports.isCurrent(), false); h.context.sourceToken = 'new-token'; wait.resolve({ applied: true, sourcePath: h.context.sourcePath, sourceToken: 'new-token', content: h.calls[0].proposal.afterContent }); await h.settle();
  assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Name').value, 'Silent pending'); assert.equal(h.el('Apply').disabled, true);
});
test('duplicate apply attempts issue one request and a rejected port preserves local author input', async t => {
  const wait = deferred(); const h = await fixture(t, { apply: () => wait.promise }); await h.open(); h.set('Name', 'Pending'); h.check(); h.el('Apply').click(); h.el('Apply').click(); assert.equal(h.calls.length, 1);
  wait.reject(Error('Draft port failed')); await h.settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Name').value, 'Pending'); assert.match(h.el('Diagnostic').textContent, /failed/);
});
test('Escape declines or accepts discard without consuming approval and ignores IME or repeat keys', async t => {
  let discard = false; const h = await fixture(t, { confirm: () => discard }); await h.open(); h.check();
  const declined = h.el('Dialog').dispatch('keydown', { key: 'Escape' }); assert.equal(declined.defaultPrevented, true); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, false);
  discard = true; for (const state of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) { h.el('Dialog').dispatch('keydown', { key: 'Escape', ...state }); assert.equal(h.el('Dialog').open, true); }
  h.el('Dialog').dispatch('keydown', { key: 'Escape' }); assert.equal(h.el('Dialog').open, false); assert.equal(h.content(), h.original);
});
test('cancel returns focus and disposal is idempotent while a late read is ignored', async t => {
  const wait = deferred(); const h = await fixture(t, { source: () => wait.promise }); h.el('Btn').focus(); const opened = h.open(); h.controller.close(); await h.settle(); assert.equal(h.document.activeElement, h.el('Btn'));
  h.controller.dispose(); h.controller.dispose(); wait.resolve(h.snapshot()); assert.equal(await opened, false); assert.equal(h.el('Dialog'), null); assert.equal(h.el('Btn'), null); assert.equal(h.unsubscribed(), 1);
});
test('optional capability loss affects only object authoring and rejects a previously approved apply', async t => {
  const h = await fixture(t); await h.open(); h.check(); h.setSupported(false); h.controller.refresh(); await h.apply(); assert.equal(h.calls.length, 0); assert.equal(h.el('Btn').disabled, true);
  const source = await fs.readFile(new URL('../../web/modules/app-scene3d-objects.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /app-scene3d-preview|app-scene3d-transforms|scene3d-renderer|app-project-build|WORLD_API|fetch\(|\.save\(/);
});
test('all structural actions connect through real portable helper and native WASM without losing proposal brand', async t => {
  assert.equal(supportsStudioCoreScene3DObjectsPatch(), true);
  for (const action of ['add', 'copy', 'remove']) {
    const h = await fixture(t, { propose: createScene3DObjectsProposal }); await h.open(); if (action !== 'add') h.mode(action); h.check();
    assert.equal(h.el('Apply').disabled, false, action); assert.equal(isScene3DObjectsProposal(h.proposals[0]), true); assert.equal(h.proposals[0].beforeContent, h.original);
    assert.equal(parseScene3DSource(h.proposals[0].afterContent).model.objects.length, action === 'remove' ? 1 : 3);
    await h.apply(); assert.equal(h.calls.length, 1); assert.equal(isScene3DObjectsProposal(h.calls[0].proposal), true); assert.equal(h.el('Dialog').open, false);
  }
});
