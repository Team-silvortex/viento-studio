import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { queryWorldProjection, WORLD_API_PATH } from '../../engine/world-query.mjs';
import { canSetObjectProperty, canRelateObject, MAX_CHANGESET_COMMANDS } from '../../engine/world-command-contract.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';

async function harness(overrides = {}) {
  const content = '姓名：旅人\n生命：100\n';
  const projection = await createWorldProjection({ workspace: { id: 'ui-world', name: 'UI fixture', version: 3 },
    definition: { documentTypes: [{ id: 'character', label: '角色', directory: 'characters', parserProfile: 'structured' }] }, documents: [{ sourcePath: 'documents/hero.md', record: { id: 'object-1' }, content,
      sourceRevision: `sha256:${createHash('sha256').update(content).digest('hex')}` },
    { sourcePath: 'documents/second.md', record: { id: 'object-2' }, content,
      sourceRevision: `sha256:${createHash('sha256').update(content).digest('hex')}` }],
  }, { digest: value => createHash('sha256').update(value).digest('hex') });
  const calls = [], current = { editable: true, dirty: false, creating: false, busy: false };
  const h = await dialogHarness('app-world-browser', {
    WORLD_API_PATH, queryWorldProjection, canSetObjectProperty, canRelateObject, MAX_CHANGESET_COMMANDS, crypto: webcrypto,
    fetchJsonApiRequest: async () => ({ payload: projection }),
    requestWorldCommand: payload => { const waiting = deferred(); calls.push({ payload, ...waiting }); return waiting.promise; },
    ...overrides,
  });
  const controller = h.runtime.setupWorldBrowser({ getContext: () => ({ ...current }), setBusy: value => { current.busy = value; }, applied: overrides.applied });
  controller.setAvailable(true, ['property.set']);
  h.element('worldBrowserBtn').click(); await flushDialogs();
  const edit = () => h.element('worldInspector').querySelector('[aria-label="修改属性：生命"]')?.click();
  const type = value => { h.element('worldPropertyValue').value = value; h.element('worldPropertyValue').dispatch('input'); };
  const preview = () => { h.element('worldPropertyPreview').click(); return calls.at(-1); };
  return { ...h, controller, calls, current, edit, type, preview, projection };
}
const previewResult = { status: 'preview', change: { beforeText: '100', afterText: '125' } };

test('World GUI previews the exact draft, invalidates an edited preview and retains conflicts without retrying', async () => {
  const h = await harness(); h.edit(); h.type('125');
  assert.equal(h.element('worldBrowserDialog').dataset.dirty, 'true');
  assert.equal(h.element('worldPropertyApply').disabled, true);
  h.preview().resolve(previewResult); await flushDialogs();
  assert.equal(h.element('worldPropertyApply').disabled, false);
  assert.equal(h.document.activeElement, h.element('worldPropertyApply'));
  assert.match(h.element('worldPropertyDiff').textContent, /100.*125/);
  h.type('150'); assert.equal(h.element('worldPropertyApply').disabled, true);
  assert.equal(h.element('worldPropertyDiff').hidden, true);
  h.preview().resolve({ ...previewResult, change: { beforeText: '100', afterText: '150' } }); await flushDialogs();
  h.element('worldPropertyApply').click();
  assert.equal(h.calls[2].payload.mode, 'apply'); assert.equal(h.calls[2].payload.value, '150');
  assert.equal(h.calls[2].payload.baseRevision, h.calls[1].payload.baseRevision);
  h.calls[2].reject(Object.assign(new Error('conflict'), { status: 409, payload: { errorCode: 'world_revision_conflict' } })); await flushDialogs();
  assert.equal(h.element('worldPropertyValue').value, '150');
  assert.match(h.element('worldPropertyMessage').textContent, /版本已变化.*草稿仍保留/);
  assert.equal(h.element('worldPropertyApply').disabled, true); assert.equal(h.calls.length, 3);
  assert.equal(h.document.activeElement, h.element('worldPropertyValue'));
  h.runtime.window.confirm = () => false;
  h.element('worldRefresh').click(); h.element('worldClose').click();
  assert.equal(h.element('worldBrowserDialog').open, true); assert.equal(h.element('worldPropertyValue').value, '150');
});

test('World GUI blocks closing and overlapping writes until a command finishes', async () => {
  const h = await harness(); h.edit(); h.type('125'); const pending = h.preview();
  assert.equal(h.current.busy, true); assert.equal(h.element('worldBrowserDialog').getAttribute('aria-busy'), 'true');
  h.element('worldClose').click(); h.element('worldBrowserDialog').dispatch('cancel'); h.element('worldPropertyPreview').click();
  assert.equal(h.element('worldBrowserDialog').open, true); assert.equal(h.calls.length, 1);
  const event = h.element('worldBrowserDialog').dispatch('keydown', { key: 's', ctrlKey: true });
  assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
  pending.reject(new Error('network timeout')); await flushDialogs();
  assert.equal(h.current.busy, false); assert.equal(h.element('worldPropertyValue').value, '125');
  assert.match(h.element('worldPropertyMessage').textContent, /刷新核对已保存内容/);
});

test('World GUI reports a successful source save even if the document preview rebuild fails', async () => {
  const h = await harness({ applied: async () => { throw new Error('index build failed'); } });
  h.edit(); h.type('125'); h.preview().resolve(previewResult); await flushDialogs();
  h.element('worldPropertyApply').click(); h.calls.at(-1).resolve({ ...previewResult, status: 'applied' }); await flushDialogs();
  assert.equal(h.element('worldPropertyValue'), null);
  assert.equal(h.element('worldBrowserDialog').dataset.dirty, 'false');
  assert.match(h.element('worldCommandStatus').textContent, /属性已保存.*预览更新失败/);
});

test('World GUI does not offer property writes over a document draft or on a host without command support', async () => {
  const h = await harness();
  for (const key of ['dirty', 'creating', 'busy']) {
    h.current[key] = true; h.element('worldRefresh').click(); await flushDialogs();
    assert.equal(h.element('worldInspector').querySelector('[aria-label="修改属性：生命"]'), null, key);
    h.current[key] = false;
  }
  h.controller.setAvailable(true); h.element('worldRefresh').click(); await flushDialogs();
  assert.equal(h.element('worldInspector').querySelector('[aria-label="修改属性：生命"]'), null);
  assert.equal(h.calls.length, 0);
});

test('World GUI stages different objects, guards the queue on exit and preserves batch conflicts', async () => {
  const h = await harness(); h.controller.setAvailable(true, ['property.set', 'changeset.apply', 'world.recover']);
  h.edit(); h.type('125'); h.preview().resolve(previewResult); await flushDialogs();
  h.element('worldPropertyStage').click();
  assert.equal(h.element('worldPropertyValue'), null);
  assert.equal(h.element('worldBrowserDialog').dataset.dirty, 'true');
  h.runtime.window.confirm = () => { assert.fail('switching objects must preserve the queue without a discard prompt'); };
  h.element('worldObjects').children[1].click(); h.edit(); h.type('150');
  h.preview().resolve({ ...previewResult, change: { beforeText: '100', afterText: '150' } }); await flushDialogs();
  assert.equal(h.element('worldPropertyApply').disabled, true, 'single writes cannot invalidate a queued batch');
  h.element('worldPropertyStage').click();
  assert.equal(h.element('worldBatchApply').disabled, true);
  h.element('worldBatchPreview').click();
  const preview = h.calls.at(-1);
  assert.equal(preview.payload.command, 'changeset.apply'); assert.equal(preview.payload.commands.length, 2);
  assert.deepEqual(Array.from(preview.payload.commands, item => item.value), ['125', '150']);
  preview.resolve({ status: 'preview', changes: [] }); await flushDialogs();
  assert.equal(h.element('worldBatchApply').disabled, false);
  h.element('worldBatchApply').click();
  const pending = h.calls.at(-1);
  h.element('worldClose').click(); assert.equal(h.element('worldBrowserDialog').open, true);
  pending.reject(Object.assign(new Error('conflict'), { payload: { errorCode: 'world_revision_conflict' } })); await flushDialogs();
  assert.match(h.element('worldBatch').textContent, /125/); assert.match(h.element('worldBatch').textContent, /150/);
  assert.equal(h.element('worldBatchApply').disabled, true);
  h.runtime.window.confirm = () => false;
  h.element('worldRefresh').click(); h.element('worldClose').click();
  assert.equal(h.element('worldBrowserDialog').open, true); assert.equal(h.element('worldBrowserDialog').dataset.dirty, 'true');
  h.element('worldBatchPreview').click(); h.calls.at(-1).resolve({ status: 'preview', changes: [] }); await flushDialogs();
  h.element('worldBatchApply').click(); h.calls.at(-1).resolve({ status: 'applied', changes: [] }); await flushDialogs();
  assert.equal(h.element('worldBatch').hidden, true); assert.equal(h.element('worldBrowserDialog').dataset.dirty, 'false');
  assert.match(h.element('worldCommandStatus').textContent, /整批修改已保存/);
});

test('World GUI exposes recovery on an unfinished transaction and never resubmits staged edits automatically', async () => {
  let pending = true;
  const h = await harness({ fetchJsonApiRequest: async () => { throw Object.assign(new Error('pending'), { payload: { errorCode: pending ? 'world_recovery_required' : 'world_unavailable' } }); } });
  h.controller.setAvailable(true, ['property.set', 'changeset.apply', 'world.recover']);
  h.element('worldRefresh').click(); await flushDialogs();
  assert.equal(h.element('worldRecover').hidden, false);
  h.element('worldRecover').click();
  assert.equal(h.calls[0].payload.command, 'world.recover');
  pending = false; h.calls[0].resolve({ status: 'rolled-back' }); await flushDialogs();
  assert.equal(h.calls.length, 1); assert.equal(h.element('worldRecover').hidden, true);
});

async function creationHarness(overrides = {}) {
  const h = await harness(overrides);
  h.controller.setAvailable(true, ['property.set', 'changeset.apply', 'object.create', 'world.recover']);
  h.element('worldRefresh').click(); await flushDialogs(); h.element('worldCreate').click();
  const fill = (id, value) => { h.element(id).value = value; h.element(id).dispatch('input'); };
  const preview = () => { h.element('worldCreatePreview').click(); return h.calls.at(-1); };
  const result = () => {
    const { payload } = h.calls.at(-1);
    return { status: 'preview', changes: [{ sourcePath: payload.sourcePath, afterText: payload.content }],
      object: { ...h.projection.objects[0], id: payload.objectId, name: 'Created', documentRefs: [{ sourcePath: payload.sourcePath }] } };
  };
  return { ...h, fill, createPreview: preview, createResult: result };
}

test('World GUI creates one stable identity, requires an exact preview, guards the draft and retains path conflicts', async () => {
  const h = await creationHarness();
  h.fill('worldCreatePath', 'documents/characters/new.json'); h.fill('worldCreateContent', '{"name":"Created"}');
  assert.equal(h.element('worldBrowserDialog').dataset.dirty, 'true');
  assert.equal(h.element('worldCreateApply').disabled, true);
  h.runtime.window.confirm = () => false;
  h.element('worldClose').click(); h.element('worldRefresh').click(); h.element('worldObjects').children[1].click();
  assert.equal(h.element('worldCreateContent').value, '{"name":"Created"}');
  const pending = h.createPreview();
  assert.equal(pending.payload.command, 'object.create'); assert.match(pending.payload.objectId, /^[a-f0-9-]{36}$/);
  assert.equal(h.current.busy, true); assert.equal(h.element('worldCreateContent').disabled, true);
  h.element('worldClose').click(); h.element('worldBrowserDialog').dispatch('cancel');
  pending.resolve(h.createResult()); await flushDialogs();
  assert.equal(h.element('worldCreateApply').disabled, false);
  h.fill('worldCreateContent', '{"name":"Changed"}');
  assert.equal(h.element('worldCreateApply').disabled, true); assert.equal(h.element('worldCreateDiff').hidden, true);
  h.createPreview().resolve(h.createResult()); await flushDialogs();
  h.element('worldCreateApply').click();
  const apply = h.calls.at(-1);
  assert.equal(apply.payload.objectId, pending.payload.objectId);
  assert.equal(apply.payload.baseRevision, pending.payload.baseRevision);
  assert.equal(apply.payload.content, '{"name":"Changed"}');
  apply.reject(Object.assign(new Error('path conflict'), { payload: { errorCode: 'world_create_path_conflict' } })); await flushDialogs();
  assert.match(h.element('worldCreateMessage').textContent, /更换原文路径/);
  assert.equal(h.element('worldCreateContent').value, '{"name":"Changed"}');
  assert.equal(h.element('worldCreateApply').disabled, true); assert.equal(h.calls.length, 3);
});

test('World GUI keeps a creation receipt successful when index rebuild fails and selects the saved object', async () => {
  const h = await creationHarness({ applied: async () => { throw new Error('index unavailable'); } });
  h.fill('worldCreateContent', '# Created'); h.createPreview().resolve(h.createResult()); await flushDialogs();
  h.element('worldCreateApply').click(); const result = h.createResult();
  h.projection.objects.push(result.object); h.calls.at(-1).resolve({ ...result, status: 'applied' }); await flushDialogs();
  assert.equal(h.element('worldCreateContent'), null); assert.equal(h.element('worldBrowserDialog').dataset.dirty, 'false');
  assert.equal(h.element('worldObjectName').textContent, 'Created');
  assert.match(h.element('worldCommandStatus').textContent, /新对象已保存.*预览更新失败/);
});

test('World GUI never mixes object creation with queued edits or an editor draft, and requires host support', async () => {
  const h = await harness();
  assert.equal(h.element('worldCreate').hidden, true);
  h.controller.setAvailable(true, ['property.set', 'changeset.apply', 'object.create']);
  h.current.dirty = true; h.element('worldRefresh').click(); await flushDialogs();
  assert.equal(h.element('worldCreate').disabled, true);
  h.current.dirty = false; h.element('worldRefresh').click(); await flushDialogs();
  h.edit(); h.type('125'); h.preview().resolve(previewResult); await flushDialogs(); h.element('worldPropertyStage').click();
  assert.equal(h.element('worldCreate').disabled, true); h.element('worldCreate').click(); assert.equal(h.element('worldCreateContent'), null);
});

test('World GUI recovery retains a new object draft, invalidates preview and does not resubmit creation', async () => {
  const h = await creationHarness(); h.fill('worldCreateContent', '# Retained');
  h.createPreview().resolve(h.createResult()); await flushDialogs(); h.element('worldCreateApply').click();
  h.calls.at(-1).reject(Object.assign(new Error('pending'), { payload: { errorCode: 'world_recovery_required' } })); await flushDialogs();
  assert.equal(h.element('worldRecover').hidden, false); h.element('worldRecover').click();
  assert.equal(h.calls.at(-1).payload.command, 'world.recover');
  h.calls.at(-1).resolve({ status: 'rolled-back' }); await flushDialogs();
  assert.equal(h.element('worldCreateContent').value, '# Retained'); assert.equal(h.element('worldCreateApply').disabled, true);
  assert.equal(h.calls.length, 3); assert.equal(h.element('worldBrowserDialog').dataset.dirty, 'true');
});

async function relationHarness(overrides = {}) {
  const h = await harness(overrides);
  h.projection.objects.push({ ...h.projection.objects[1], id: 'object-3', name: 'Third', revision: `sha256:${'a'.repeat(64)}` });
  h.controller.setAvailable(true, ['property.set', 'changeset.apply', 'object.create', 'relation.add', 'world.recover']);
  h.element('worldRefresh').click(); await flushDialogs(); h.element('worldRelationAdd').click();
  const fill = (id, value) => { const el = h.element(id); el.value = value; el.dispatch(id === 'worldRelationSlot' ? 'input' : 'change'); };
  const preview = () => { h.element('worldRelationPreview').click(); return h.calls.at(-1); };
  const result = () => {
    const { payload } = h.calls.at(-1);
    return { status: 'preview', changes: [{ kind: 'relation.add' }], relation: {
      sourceObjectId: payload.objectId, targetObjectId: payload.targetObjectId,
      properties: { kind: payload.kind, targetId: payload.targetObjectId, slot: payload.slot },
    } };
  };
  return { ...h, fill, relationPreview: preview, relationResult: result };
}

test('World GUI relation drafts pin both endpoint revisions and require a fresh preview after every selection change', async () => {
  const h = await relationHarness();
  h.fill('worldRelationKind', 'part-of'); h.fill('worldRelationSlot', '共同背景');
  assert.equal(h.element('worldRelationApply').disabled, true);
  const first = h.relationPreview();
  assert.equal(first.payload.command, 'relation.add'); assert.equal(first.payload.targetObjectId, 'object-2');
  assert.equal(first.payload.targetRevision, h.projection.objects[1].revision);
  first.resolve(h.relationResult()); await flushDialogs();
  assert.equal(h.element('worldRelationApply').disabled, false);
  assert.equal(h.document.activeElement, h.element('worldRelationApply'));
  assert.match(h.element('worldRelationDiff').textContent, /归属.*共同背景/);
  for (const [id, value] of [['worldRelationTarget','object-3'], ['worldRelationKind','references'], ['worldRelationSlot','关联设定']]) {
    h.fill(id, value); assert.equal(h.element('worldRelationApply').disabled, true); assert.equal(h.element('worldRelationDiff').hidden, true);
    h.relationPreview().resolve(h.relationResult()); await flushDialogs();
  }
  h.element('worldRelationApply').click();
  const apply = h.calls.at(-1);
  assert.equal(apply.payload.baseRevision, first.payload.baseRevision); assert.equal(apply.payload.objectRevision, first.payload.objectRevision);
  assert.equal(apply.payload.targetRevision, h.projection.objects[2].revision);
  assert.equal(apply.payload.kind, 'references'); assert.equal(apply.payload.slot, '关联设定');
  apply.reject(Object.assign(new Error('conflict'), { payload: { errorCode: 'world_revision_conflict' } })); await flushDialogs();
  assert.equal(h.element('worldRelationTarget').value, 'object-3'); assert.equal(h.element('worldRelationSlot').value, '关联设定');
  assert.match(h.element('worldRelationMessage').textContent, /版本已变化.*草稿仍保留/);
  assert.equal(h.element('worldRelationApply').disabled, true); assert.equal(h.calls.length, 5);
});

test('World GUI retains invalid relation drafts and guards refresh, language changes and closing while busy', async () => {
  let languageChanged;
  const h = await relationHarness({ onLanguageChange: callback => { languageChanged = callback; } });
  h.fill('worldRelationKind', 'part-of'); h.fill('worldRelationSlot', '保留');
  languageChanged(); assert.equal(h.element('worldRelationSlot').value, '保留');
  h.runtime.window.confirm = () => false;
  for (const id of ['worldClose','worldRefresh','worldRelationCancel','worldCreate']) h.element(id).click();
  h.element('worldObjects').children[1].click();
  assert.equal(h.element('worldBrowserDialog').open, true); assert.equal(h.element('worldRelationSlot').value, '保留');
  for (const [code, message] of [['world_relation_exists', /此关系已存在/], ['world_relation_cycle', /形成循环/]]) {
    const pending = h.relationPreview(); assert.equal(h.current.busy, true);
    assert.equal(h.element('worldRelationTarget').disabled, true); assert.equal(h.element('worldRelationSlot').disabled, true);
    h.element('worldClose').click(); h.element('worldBrowserDialog').dispatch('cancel'); h.element('worldRelationPreview').click();
    assert.equal(h.element('worldBrowserDialog').open, true);
    pending.reject(Object.assign(new Error('invalid'), { payload: { errorCode: code } })); await flushDialogs();
    assert.equal(h.current.busy, false); assert.match(h.element('worldRelationMessage').textContent, message);
    assert.equal(h.element('worldRelationSlot').value, '保留'); assert.equal(h.element('worldRelationApply').disabled, true);
  }
  assert.equal(h.calls.length, 2);
});

test('World GUI relation recovery retains choices without automatically retrying the mutation', async () => {
  const h = await relationHarness(); h.fill('worldRelationSlot', '恢复后保留');
  h.relationPreview().resolve(h.relationResult()); await flushDialogs(); h.element('worldRelationApply').click();
  h.calls.at(-1).reject(Object.assign(new Error('pending'), { payload: { errorCode: 'world_recovery_required' } })); await flushDialogs();
  assert.equal(h.element('worldRecover').hidden, false); h.element('worldRecover').click();
  assert.equal(h.calls.at(-1).payload.command, 'world.recover'); h.calls.at(-1).resolve({ status: 'rolled-back' }); await flushDialogs();
  assert.equal(h.element('worldRelationSlot').value, '恢复后保留'); assert.equal(h.element('worldRelationApply').disabled, true);
  assert.equal(h.element('worldBrowserDialog').dataset.dirty, 'true'); assert.equal(h.calls.length, 3);
});

test('World GUI distinguishes a saved relation from a failed preview rebuild', async () => {
  const h = await relationHarness({ applied: async () => { throw new Error('index unavailable'); } });
  h.relationPreview().resolve(h.relationResult()); await flushDialogs(); h.element('worldRelationApply').click();
  h.calls.at(-1).resolve({ ...h.relationResult(), status: 'applied' }); await flushDialogs();
  assert.equal(h.element('worldRelationSlot'), null); assert.equal(h.element('worldBrowserDialog').dataset.dirty, 'false');
  assert.match(h.element('worldCommandStatus').textContent, /关系已保存.*预览更新失败/);
});

test('World GUI requires relation support and available endpoints, and never mixes relations with queued or document drafts', async () => {
  const h = await harness(); assert.equal(h.element('worldRelationAdd'), null);
  h.controller.setAvailable(true, ['property.set','changeset.apply','relation.add']);
  for (const key of ['dirty','creating','busy']) {
    h.current[key] = true; h.element('worldRefresh').click(); await flushDialogs();
    assert.equal(h.element('worldRelationAdd').disabled, true, key); h.current[key] = false;
  }
  h.element('worldRefresh').click(); await flushDialogs(); h.edit(); h.type('125');
  h.preview().resolve(previewResult); await flushDialogs(); h.element('worldPropertyStage').click();
  assert.equal(h.element('worldRelationAdd').disabled, true); h.element('worldRelationAdd').click(); assert.equal(h.element('worldRelationSlot'), null);
  const unavailable = await harness(); unavailable.controller.setAvailable(true, ['relation.add']);
  unavailable.projection.objects[1].documentRefs[0].sourceRevision = null;
  unavailable.element('worldRefresh').click(); await flushDialogs();
  assert.equal(unavailable.element('worldRelationAdd').disabled, true);
});
