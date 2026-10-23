import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { editorHarness, deferred } from './editor-harness.mjs';
const apiPath = '/api/script-usage';
const revision = value => 'sha256:' + createHash('sha256').update(value).digest('hex');

test('script usage transport sends only its saved source path and sanitized authentication token', async () => {
  const source = (await fs.readFile(new URL('../../web/modules/app-doc-service.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '').replaceAll('export ', '');
  const calls = [], result = { format: 'viento-script-usage' }; let token = ' secret\r\n-token ';
  const storage = { getItem(key) { assert.equal(key, 'doc-api-token'); return token; } };
  const context = vm.createContext({ window: { localStorage: storage }, localStorage: storage, SCRIPT_USAGE_API_PATH: apiPath, t: key => key,
    fetchJsonApiRequest: async (...args) => { calls.push(args); return { payload: result }; } });
  vm.runInContext(source, context);
  const payload = { sourcePath: 'documents/scripts/plain.txt' };
  assert.equal(await context.inspectScriptUsage(payload), result);
  assert.equal(calls[0][0], apiPath); assert.equal(calls[0][1].method, 'POST'); assert.equal(calls[0][1].headers.Authorization, 'Bearer secret-token');
  assert.equal(calls[0][1].headers['Content-Type'], 'application/json'); assert.deepEqual(JSON.parse(calls[0][1].body), payload);
  assert.equal(calls[0][2], 45000); assert.equal(calls[0][3], '读取脚本使用位置'); assert.ok(!calls[0][1].body.includes('secret-token'));
  token = ''; await context.inspectScriptUsage(payload); assert.equal(calls[1][1].headers.Authorization, undefined);
});

test('runtime advertises the independent usage source port only through its explicit capability with no optional core dependency', async () => {
  let detection, hostOptions, ports; const requests = [], stop = Error('captured ports');
  const host = { getContext() {}, getSource() {}, getUsage() {}, openSource() {} };
  const h = await editorHarness({ detectEditBackendAvailability: async () => detection,
    supportsStudioCoreAnimationStateTable: () => false,
    inspectScriptUsage: async payload => { requests.push(payload); return {}; },
    createScriptUsageSourceHost: options => { hostOptions = options; return host; },
    setupStudioSystem: async options => { ports = options.ports; throw stop; } });
  for (const [available, flag, expected] of [[true, true, true], [true, false, false], [true, undefined, false], [true, 'true', false], [false, true, false]]) {
    detection = { available, source: 'capabilities', payload: { scriptUsage: flag } };
    await h.runtime.detectEditBackend(); await assert.rejects(h.runtime.initApp(), error => error === stop);
    assert.equal(hostOptions.getState().available, expected); assert.equal(ports.scripts.usage, host);
  }
  const payload = { sourcePath: 'documents/scripts/plain.txt' }; await hostOptions.inspectUsage(payload); assert.deepEqual(requests, [payload]);
});

const content = '\ufeff{\r\n "title": "旅人😀",\r\n "bindings": [{"bindingId": "one"}]\r\n}\r\n';
const located = () => { const start = content.indexOf('{"bindingId"'); return { objectId: 'binding-doc', sourcePath: 'documents/behaviors/demo.json',
  content, sourceRevision: revision(content), propertyPath: '/bindings/0', sourceRange: { start, end: content.indexOf('}', start) + 1, encoding: 'utf-16', propertyPath: '/bindings/0', exact: true } }; };
async function navigationHarness({ read, available = true } = {}) {
  const reads = [], writes = [];
  const h = await editorHarness({ readDocSource: async input => { reads.push(input); return read ? read(input) : { content, version: revision(content) }; },
    writeDoc: async input => { writes.push(input); return {}; }, detectEditBackendAvailability: async () => ({ available: true, source: 'capabilities', payload: { scriptUsage: available } }) });
  h.state.workspace = { version: 3, paths: { documents: 'documents' } };
  h.doc.sourcePath = 'documents/scripts/plain.txt'; h.doc._sourceCachedText = 'extends Node\n';
  const target = { ...h.doc, path: 'behavior/demo', sourcePath: located().sourcePath, _sourceCachedText: 'old cached' };
  h.state.docs.push(target); h.runtime.rebuildDocPathCaches(h.state.docs);
  for (const name of ['renderHeroBanner', 'renderSectionCards', 'renderGallery', 'markActiveItem', 'setModeUi']) h.runtime[name] = () => {};
  h.runtime.getHeroImagesForDisplay = () => [];
  await h.runtime.detectEditBackend(); h.begin('extends Node\n', revision('extends Node\n'));
  return { ...h, target, reads, writes };
}

test('saved usage navigation preserves a dirty script when confirmation is cancelled, then locates BOM/CRLF after explicit consent', async () => {
  const h = await navigationHarness(); h.source.value += '# unsaved\n'; h.runtime.refreshEditSessionDirtyState();
  const draft = h.runtime.getCurrentEditContent(); h.source.setSelectionRange(3, 8); let confirms = 0;
  h.runtime.window.confirm = () => { confirms++; return false; };
  assert.equal(await h.runtime.openScriptUsageSource(located()), false);
  assert.equal(confirms, 1); assert.equal(h.state.activePath, h.doc.path); assert.equal(h.runtime.getCurrentEditContent(), draft);
  assert.equal(h.source.selectionStart, 3); assert.equal(h.source.selectionEnd, 8); assert.deepEqual(h.reads, []); assert.deepEqual(h.writes, []);
  h.runtime.window.confirm = () => { confirms++; return true; };
  const result = await h.runtime.openScriptUsageSource(located()); assert.equal(typeof result.focus, 'function');
  assert.equal(confirms, 2); assert.equal(h.state.activePath, h.target.path);
  assert.equal(h.source.value.slice(h.source.selectionStart, h.source.selectionEnd), '{"bindingId": "one"}');
  assert.equal(h.runtime.getCurrentEditContent(), content); assert.equal(h.state.editHasUnsavedChanges, false); assert.equal(h.reads.length, 1); assert.deepEqual(h.writes, []);
});

test('navigation does not select stale saved offsets and revokes a pending read when caller or optional capability changes', async () => {
  const changed = content.replace('one', 'new-long-id'), stale = await navigationHarness({ read: () => ({ content: changed, version: revision(changed) }) });
  const result = await stale.runtime.openScriptUsageSource(located()); assert.equal(typeof result.focus, 'function');
  assert.equal(stale.source.selectionStart, stale.source.selectionEnd); assert.equal(stale.runtime.getCurrentEditContent(), changed);
  assert.match(stale.element('docEditStatus').textContent, /原文已变化/); assert.deepEqual(stale.writes, []);
  for (const change of ['caller', 'capability']) {
    const wait = deferred(), h = await navigationHarness({ read: () => wait.promise }); let current = true;
    const pending = h.runtime.openScriptUsageSource(located(), { isCurrent: () => current });
    await new Promise(setImmediate);
    if (change === 'caller') current = false;
    else { h.runtime.detectEditBackendAvailability = async () => ({ available: true, source: 'capabilities', payload: {} }); await h.runtime.detectEditBackend(); }
    wait.resolve({ content, version: revision(content) }); assert.equal(await pending, false); assert.deepEqual(h.writes, []);
    assert.notEqual(h.runtime.getCurrentEditContent(), content);
  }
});

test('old service absence and cancelled dialog guard prevent navigation before source reads', async () => {
  const h = await navigationHarness({ available: false }); assert.equal(await h.runtime.openScriptUsageSource(located()), false); assert.deepEqual(h.reads, []);
  const active = await navigationHarness(); assert.equal(await active.runtime.openScriptUsageSource(located(), { isCurrent: () => false }), false); assert.deepEqual(active.reads, []);
});
