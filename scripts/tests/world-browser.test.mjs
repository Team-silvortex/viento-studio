import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorldProjection } from '../../engine/world-projection.mjs';
import { queryWorldProjection, WORLD_API_PATH } from '../../engine/world-query.mjs';
import { canSetObjectProperty, MAX_CHANGESET_COMMANDS } from '../../engine/world-command-contract.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { deferred } from './editor-harness.mjs';

async function harness(overrides = {}) {
  const content = '姓名：旅人\n生命：100\n';
  const projection = await createWorldProjection({ workspace: { id: 'ui-world', name: 'UI fixture', version: 3 },
    definition: { documentTypes: [] }, documents: [{ sourcePath: 'documents/hero.md', record: { id: 'object-1' }, content,
      sourceRevision: `sha256:${createHash('sha256').update(content).digest('hex')}` },
    { sourcePath: 'documents/second.md', record: { id: 'object-2' }, content,
      sourceRevision: `sha256:${createHash('sha256').update(content).digest('hex')}` }],
  }, { digest: value => createHash('sha256').update(value).digest('hex') });
  const calls = [], current = { editable: true, dirty: false, creating: false, busy: false };
  const h = await dialogHarness('app-world-browser', {
    WORLD_API_PATH, queryWorldProjection, canSetObjectProperty, MAX_CHANGESET_COMMANDS,
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
  return { ...h, controller, calls, current, edit, type, preview };
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
