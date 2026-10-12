// Independent event-capable controller quality; authorized isolated stage only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from '../../../scripts/tests/dialog-harness.mjs';
import { initializeStudioCore, supportsStudioCoreScene3DAlignmentPatch } from '../../../engine/studio-core.mjs';
import { parseScene3DSource } from '../../../engine/scene3d.mjs';
import { createScene3DAlignmentProposal, isScene3DAlignmentProposal } from '../../../engine/scene3d-alignment.mjs';
const root = new URL('../../../', import.meta.url), out = new URL('./', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const file = new URL('web/modules/app-scene3d-alignment.js', root), beforeSha256 = sha(await fs.readFile(file));
await initializeStudioCore(() => fs.readFile(new URL('engine/studio-core.wasm', root)));
const content = await fs.readFile(new URL('examples/scene3d/scene.json', root), 'utf8');
const ids = parseScene3DSource(content).model.objects.map(object => object.instanceId);
assert.ok(ids.length >= 2);
const cases = []; let prohibitedApplyRequests = 0;
async function fixture(sourceProvider) {
  const context = { editable: true, creating: false, busy: false, sourceJSON: true,
    sourcePath: 'documents/scene.json', sourceToken: 'alignment:1' };
  const h = await dialogHarness('app-scene3d-alignment', { queueMicrotask, parseScene3DSource,
    createScene3DAlignmentProposal, isScene3DAlignmentProposal, supportsStudioCoreScene3DAlignmentPatch,
    t: value => value, translatePage() {}, onLanguageChange() { return () => {}; } });
  h.runtime.window.confirm = () => true;
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content,
    baseSourceRevision: 'sha256:' + sha(content), sourceRevision: 'sha256:' + sha(content) });
  const controller = h.runtime.setupScene3DAlignment({ getContext: () => context,
    getSource: async () => sourceProvider ? sourceProvider(snapshot()) : snapshot(),
    applyDraft: async () => { prohibitedApplyRequests++; throw Error('Read-only quality does not grant draft application'); } });
  const el = suffix => h.element('scene3dAlignment' + suffix), rows = () => el('Objects').querySelectorAll('input[type=checkbox]');
  const select = (id, checked = true) => { const row = rows().find(node => node.dataset.instanceId === id); assert.ok(row); row.checked = checked; row.dispatch('change'); };
  const change = (suffix, value, event = 'change') => { el(suffix).value = value; el(suffix).dispatch(event); };
  return { h, context, controller, el, rows, select, change, snapshot };
}
async function run(name, fn, provider) { let h; try { h = await fixture(provider); await fn(h); cases.push({ name, ok: true }); }
  catch (error) { cases.push({ name, ok: false, error: error.stack || String(error) }); }
  finally { h?.controller.dispose(); await flushDialogs(); } }
await run('selection never silently chooses a reference and explicit hidden reference remains in the full proposal', async h => {
  assert.equal(await h.controller.open(), true); h.select(ids[0]); h.select(ids[1]);
  assert.equal(h.el('Anchor').value, ''); assert.equal(h.el('Check').disabled, true);
  h.change('Anchor', ids[1]); assert.equal(h.el('Check').disabled, false);
  h.change('Search', ids[0], 'input'); assert.equal(h.rows().length, 1); assert.equal(h.el('Anchor').value, ids[1]);
  assert.ok(h.el('Anchor').querySelectorAll('option').some(option => option.value === ids[1]));
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
  const after = JSON.parse(h.el('Source').textContent.replace(/^\uFEFF/, ''));
  const original = JSON.parse(content.replace(/^\uFEFF/, ''));
  assert.equal(after.objects[0].position[0], original.objects[1].position[0]);
  for (const field of ['instanceId', 'name', 'primitive', 'rotationDegrees', 'size', 'color'])
    assert.deepEqual(after.objects[0][field], original.objects[0][field]);
});
await run('unchecking a reference clears it and rechecking does not restore old reference or approval', async h => {
  await h.controller.open(); h.select(ids[0]); h.select(ids[1]); h.change('Anchor', ids[1]); h.el('Check').click();
  assert.equal(h.el('Apply').disabled, false); h.select(ids[1], false);
  assert.equal(h.el('Anchor').value, ''); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true);
  h.select(ids[1]); assert.equal(h.el('Anchor').value, ''); assert.equal(h.el('Check').disabled, true);
});
await run('silent visible reference or axis changes before Check cannot authorize a different closed intent', async h => {
  await h.controller.open(); h.select(ids[0]); h.select(ids[1]); h.change('Anchor', ids[1]);
  h.el('Anchor').value = ids[0]; h.el('Check').click(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Anchor').value, ids[1]);
  h.el('Axis').value = 'y'; h.el('Check').click(); assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Axis').value, 'x');
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
});
await run('silent reference axis or query changes after approval cannot dispatch the native branded candidate to host', async h => {
  await h.controller.open(); h.select(ids[0]); h.select(ids[1]); h.change('Anchor', ids[1]); h.el('Check').click();
  assert.equal(h.el('Apply').disabled, false); h.el('Anchor').value = ids[0]; h.el('Apply').click(); await flushDialogs();
  assert.equal(h.el('Apply').disabled, true); assert.equal(prohibitedApplyRequests, 0);
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, false); h.el('Axis').value = 'z'; h.el('Apply').click(); await flushDialogs();
  assert.equal(h.el('Apply').disabled, true); assert.equal(prohibitedApplyRequests, 0);
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, false); h.el('Search').value = ids[0]; h.el('Apply').click(); await flushDialogs();
  assert.equal(h.el('Apply').disabled, true); assert.equal(prohibitedApplyRequests, 0);
});
await run('obsolete closed-owner and rebuilt-row checkbox callbacks cannot select objects or overwrite explicit reference', async h => {
  await h.controller.open(); const old = h.rows()[0]; h.controller.close(true); h.context.sourceToken = 'alignment:2';
  await h.controller.open(); old.checked = true; old.dispatch('change'); assert.ok(h.rows().every(row => !row.checked));
  h.select(ids[0]); h.select(ids[1]); h.change('Anchor', ids[1]);
  const stale = h.rows().find(row => row.dataset.instanceId === ids[1]); h.change('Search', ids[0], 'input');
  assert.equal(h.el('Objects').contains(stale), false); const before = h.el('Selection').textContent;
  stale.checked = false; stale.dispatch('change'); assert.equal(h.el('Selection').textContent, before); assert.equal(h.el('Anchor').value, ids[1]);
});
await run('same-path source-token replacement revokes approval while keeping explicit selections reference and axis', async h => {
  const model = parseScene3DSource(content).model, chosenAxis = ['y', 'z', 'x'].find(axis => model.objects[0].position[['x', 'y', 'z'].indexOf(axis)] !== model.objects[1].position[['x', 'y', 'z'].indexOf(axis)]);
  assert.ok(chosenAxis, 'Fixture requires two objects with different centers');
  await h.controller.open(); h.select(ids[0]); h.select(ids[1]); h.change('Anchor', ids[1]); h.change('Axis', chosenAxis); h.el('Check').click();
  assert.equal(h.el('Apply').disabled, false);
  const checked = h.rows().filter(row => row.checked).map(row => row.dataset.instanceId);
  h.context.sourceToken = 'alignment:reload'; h.controller.refresh();
  assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true);
  assert.deepEqual(h.rows().filter(row => row.checked).map(row => row.dataset.instanceId), checked);
  assert.equal(h.el('Anchor').value, ids[1]); assert.equal(h.el('Axis').value, chosenAxis);
});
let release, originalSnapshot;
const gate = new Promise(resolve => { release = resolve; });
await run('late successful source read after cancellation cannot reopen or populate a released alignment owner', async h => {
  const opened = h.controller.open(); h.controller.close(true); release(originalSnapshot);
  assert.equal(await opened, false); assert.equal(h.el('Dialog').open, false);
  assert.equal(h.el('Fields').hidden, true); assert.equal(h.el('Apply').disabled, true);
}, value => { originalSnapshot = value; return gate; });
const endSha256 = sha(await fs.readFile(file)), output = process.argv[2]; assert.ok(output && /^[a-z0-9-]+\.json$/.test(output));
const report = { format: 'viento-scene3d-alignment-independent-ui-quality', schemaVersion: 1, observedAt: new Date().toISOString(),
  node: process.version, ok: cases.every(item => item.ok) && prohibitedApplyRequests === 0 && beforeSha256 === endSha256,
  passed: cases.filter(item => item.ok).length, failed: cases.filter(item => !item.ok).length, cases,
  source: { path: 'web/modules/app-scene3d-alignment.js', beforeSha256, endSha256, stable: beforeSha256 === endSha256 },
  prohibitedApplyRequests,
  scope: 'Actual isolated-stage controller in event-capable DOM fixture with native parse and real private alignment proposal. Independent reference/global selection/raw intent and obsolete row/source-owner checks. Invalid Apply attempts never invoke writer; no source/disk modification, actual browser, renderer, Save or device acceptance.' };
await fs.writeFile(new URL(output, out), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ ok: report.ok, passed: report.passed, failed: report.failed, sourceStable: report.source.stable }) + '\n');
if (!report.ok) process.exitCode = 1;
