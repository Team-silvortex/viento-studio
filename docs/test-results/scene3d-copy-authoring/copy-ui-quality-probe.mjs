// Independent real-controller events with native parse and genuine brands.
// Stage only; no HTTP, document mutation, Save or browser/GPU claim.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from '../../../scripts/tests/dialog-harness.mjs';
import { initializeStudioCore, supportsStudioCoreScene3DCopyPatch } from '../../../engine/studio-core.mjs';
import { parseScene3DSource } from '../../../engine/scene3d.mjs';
import { createScene3DCopyProposal, isScene3DCopyProposal } from '../../../engine/scene3d-copy.mjs';
const root = new URL('../../../', import.meta.url), out = new URL('./', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const file = new URL('web/modules/app-scene3d-copy.js', root), beforeSha256 = sha(await fs.readFile(file));
await initializeStudioCore(() => fs.readFile(new URL('engine/studio-core.wasm', root)));
const sample = JSON.parse(await fs.readFile(new URL('examples/scene3d/scene.json', root), 'utf8'));
assert.equal(sample.objects.length, 3);
sample.objects.forEach((object, index) => { object.position = [[9, -8, 7], [-7, -7, 0], [0, 2, -6]][index]; });
sample.objects[0].name = '<img src=x onerror=unexpected()> 🦊';
const text = value => '\uFEFF' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
const content = text(sample), ids = parseScene3DSource(content).model.objects.map(object => object.instanceId);
const id = value => `${value.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const cases = []; let prohibitedApplyRequests = 0, uuidCounter = 1000;
async function fixture(sourceProvider, raw = content) {
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, sourcePath: 'documents/scene.json', sourceToken: 'copy:1' };
  let languageChanged, uuidCalls = 0;
  const h = await dialogHarness('app-scene3d-copy', { queueMicrotask, parseScene3DSource, createScene3DCopyProposal, isScene3DCopyProposal,
    supportsStudioCoreScene3DCopyPatch, crypto: { randomUUID() { uuidCalls++; return id(++uuidCounter); } },
    t: value => value, translatePage() {}, onLanguageChange(listener) { languageChanged = listener; return () => {}; } });
  h.runtime.window.confirm = () => true;
  for (const name of ['Transforms', 'Objects', 'Environment', 'Properties', 'Translation', 'Alignment', 'Distribution'])
    assert.equal(h.runtime['setupScene3D' + name], undefined, 'Sibling controller is not injected.');
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content: raw,
    baseSourceRevision: 'sha256:' + sha(raw), sourceRevision: 'sha256:' + sha(raw) });
  const controller = h.runtime.setupScene3DCopy({ getContext: () => context,
    getSource: async () => sourceProvider ? sourceProvider(snapshot()) : snapshot(),
    applyDraft: async () => { prohibitedApplyRequests++; throw Error('Read-only independent fixture grants no writer'); } });
  const el = suffix => h.element('scene3dCopy' + suffix), rows = () => el('Objects').querySelectorAll('input[type=checkbox]');
  const select = (identity, checked = true) => { const row = rows().find(node => node.dataset.instanceId === identity); assert.ok(row); row.checked = checked; row.dispatch('change'); };
  const change = (suffix, value, event = 'input') => { el(suffix).value = value; el(suffix).dispatch(event); };
  const mapping = () => Array.from(el('Mapping').children, item => ({ sourceInstanceId: item.dataset.sourceInstanceId, newInstanceId: item.dataset.newInstanceId }));
  return { h, context, controller, el, rows, select, change, mapping, snapshot, language: () => languageChanged?.(), uuidCalls: () => uuidCalls };
}
async function run(name, fn, provider) { let h; try { h = await fixture(provider); await fn(h); cases.push({ name, ok: true }); }
  catch (error) { cases.push({ name, ok: false, error: error.stack || String(error) }); }
  finally { h?.controller.dispose(); await flushDialogs(); } }
await run('explicit zero-offset hidden-global selection makes genuine structural copies with no seven sibling controller authority and capacity overflow is not silently truncated', async h => {
  assert.equal(await h.controller.open(), true); assert.ok(h.rows().every(row => !row.checked)); assert.equal(h.el('Check').disabled, true);
  assert.equal(h.uuidCalls(), 0); h.select(ids[2]); h.select(ids[0]); const pairs = h.mapping(); assert.equal(pairs.length, 2);
  assert.deepEqual(pairs.map(pair => pair.sourceInstanceId), [ids[0], ids[2]]);
  h.change('Search', ids[2]); assert.equal(h.rows().length, 1); h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
  const after = JSON.parse(h.el('Source').textContent.replace(/^\uFEFF/, ''));
  assert.equal(after.objects.length, 5); assert.deepEqual(after.objects.slice(0, 3), sample.objects);
  for (let index = 0; index < pairs.length; index++) {
    const clone = { ...after.objects[3 + index], instanceId: pairs[index].sourceInstanceId };
    assert.deepEqual(clone, sample.objects.find(object => object.instanceId === pairs[index].sourceInstanceId));
  }
  assert.equal(h.uuidCalls(), 2);
  const large = structuredClone(sample); large.objects = Array.from({ length: 100 }, (_, index) => ({ ...structuredClone(sample.objects[0]), instanceId: id(index + 1) }));
  const capacity = await fixture(undefined, text(large));
  try { await capacity.controller.open(); capacity.el('SelectResults').click(); assert.equal(capacity.mapping().length, 100);
    assert.ok(capacity.el('Capacity').textContent.endsWith('：28')); assert.equal(capacity.el('Check').disabled, true);
    assert.equal(capacity.el('Apply').disabled, true); assert.ok(capacity.el('Blocked').textContent.includes('超过')); }
  finally { capacity.controller.dispose(); await flushDialogs(); }
});
await run('UUID mapping allocates once per source session and survives deselect reselect query repaint language while reopening allocates new identities', async h => {
  await h.controller.open(); h.select(ids[1]); const first = h.mapping()[0]; assert.equal(h.uuidCalls(), 1);
  h.select(ids[1], false); h.select(ids[1]); assert.deepEqual(h.mapping(), [first]); assert.equal(h.uuidCalls(), 1);
  h.change('Search', ids[1]); h.language(); h.controller.refresh(); assert.deepEqual(h.mapping(), [first]); assert.equal(h.uuidCalls(), 1);
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, false); h.language(); assert.equal(h.el('Apply').disabled, false);
  h.controller.close(true); h.context.sourceToken = 'copy:reopen'; await h.controller.open(); h.select(ids[1]);
  assert.notEqual(h.mapping()[0].newInstanceId, first.newInstanceId); assert.equal(h.uuidCalls(), 2);
});
await run('silent checkbox UUID mapping dataset and mapping text changes cannot alter the closed source-to-new identity intent', async h => {
  await h.controller.open(); h.select(ids[0]); h.rows()[0].checked = false; h.el('Check').click(); assert.equal(h.el('Apply').disabled, true);
  assert.equal(h.rows()[0].checked, true); h.rows()[0].dataset.instanceId = id(9999); h.el('Check').click(); assert.equal(h.el('Apply').disabled, true);
  assert.equal(h.rows()[0].dataset.instanceId, ids[0]);
  h.el('Mapping').children[0].dataset.newInstanceId = id(8888); h.el('Check').click(); assert.equal(h.el('Apply').disabled, true);
  const expected = h.mapping()[0].newInstanceId; h.el('Mapping').children[0].querySelector('.scene3d-copy-new-id').textContent = id(7777);
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.mapping()[0].newInstanceId, expected);
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
});
await run('silent offset query or mapping changes after review never invoke any writer', async h => {
  await h.controller.open(); h.select(ids[0]); h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
  h.el('X').value = '2'; h.el('Apply').click(); await flushDialogs(); assert.equal(h.el('Apply').disabled, true); assert.equal(prohibitedApplyRequests, 0);
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, false); h.el('Search').value = ids[0]; h.el('Apply').click(); await flushDialogs();
  assert.equal(h.el('Apply').disabled, true); assert.equal(prohibitedApplyRequests, 0);
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, false); h.el('Mapping').children[0].dataset.sourceInstanceId = ids[1];
  h.el('Apply').click(); await flushDialogs(); assert.equal(h.el('Apply').disabled, true); assert.equal(prohibitedApplyRequests, 0);
});
await run('released session old query generation reattached rows and foreign rendered UUID changes cannot allocate or change selection', async h => {
  await h.controller.open(); const old = h.rows()[0]; h.controller.close(true); h.context.sourceToken = 'copy:2'; await h.controller.open();
  old.checked = true; old.dispatch('change'); assert.equal(h.mapping().length, 0); assert.equal(h.uuidCalls(), 0);
  const foreign = h.rows()[0]; foreign.dataset.instanceId = ids[2]; foreign.checked = true; foreign.dispatch('change');
  assert.equal(h.mapping().length, 0); assert.equal(h.uuidCalls(), 0); h.controller.refresh(); assert.ok(h.rows().every(row => !row.checked));
  h.select(ids[1]); const stale = h.rows()[1], before = h.mapping(); h.change('Search', ids[0]); stale.checked = false; stale.dispatch('change');
  assert.deepEqual(h.mapping(), before); h.el('Objects').append(stale); stale.dispatch('change'); assert.deepEqual(h.mapping(), before);
  h.change('Search', ''); assert.equal(h.rows()[1].checked, true); assert.equal(h.uuidCalls(), 1); h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
});
await run('same-path source owner replacement revokes approval and preserves raw selection UUID mapping and offset', async h => {
  await h.controller.open(); h.select(ids[0]); h.select(ids[2]); h.change('Y', '2'); h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
  const before = h.mapping(), checked = h.rows().filter(row => row.checked).map(row => row.dataset.instanceId);
  h.context.sourceToken = 'copy:reloaded'; h.controller.refresh(); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true);
  assert.deepEqual(h.mapping(), before); assert.deepEqual(h.rows().filter(row => row.checked).map(row => row.dataset.instanceId), checked); assert.equal(h.el('Y').value, '2');
});
let release, originalSnapshot;
const gate = new Promise(resolve => { release = resolve; });
await run('late source completion after cancellation cannot reopen populate allocate or approve the released owner', async h => {
  const opened = h.controller.open(); h.controller.close(true); release(originalSnapshot); assert.equal(await opened, false);
  assert.equal(h.el('Dialog').open, false); assert.equal(h.el('Fields').hidden, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.uuidCalls(), 0);
}, value => { originalSnapshot = value; return gate; });
const endSha256 = sha(await fs.readFile(file)), output = process.argv[2]; assert.ok(output && /^[a-z0-9-]+\.json$/.test(output));
const report = { format: 'viento-scene3d-copy-independent-ui-quality', schemaVersion: 1, observedAt: new Date().toISOString(), node: process.version,
  ok: cases.every(item => item.ok) && prohibitedApplyRequests === 0 && beforeSha256 === endSha256,
  passed: cases.filter(item => item.ok).length, failed: cases.filter(item => !item.ok).length, cases,
  source: { path: 'web/modules/app-scene3d-copy.js', beforeSha256, endSha256, stable: beforeSha256 === endSha256 },
  prohibitedApplyRequests, siblingControllersAbsent: 7,
  scope: 'Actual isolated-stage controller in event-capable DOM fixture with native parse and genuine private proposal. Invalid Apply and cancelled source paths only; no writer, disk Save, HTTP/browser/GPU/device/install or actual checkout apply.' };
await fs.writeFile(new URL(output, out), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ ok: report.ok, passed: report.passed, failed: report.failed, sourceStable: report.source.stable, writerRequests: prohibitedApplyRequests }) + '\n');
if (!report.ok) process.exitCode = 1;
