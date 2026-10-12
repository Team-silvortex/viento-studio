// Independent real-controller events with native parsing/private proposals.
// Stage only; no HTTP, source write, ordinary Save or browser/GPU claim.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dialogHarness, flushDialogs } from '../../../scripts/tests/dialog-harness.mjs';
import { initializeStudioCore, supportsStudioCoreScene3DDistributionPatch } from '../../../engine/studio-core.mjs';
import { parseScene3DSource } from '../../../engine/scene3d.mjs';
import { createScene3DDistributionProposal, isScene3DDistributionProposal } from '../../../engine/scene3d-distribution.mjs';
const root = new URL('../../../', import.meta.url), out = new URL('./', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const file = new URL('web/modules/app-scene3d-distribution.js', root), beforeSha256 = sha(await fs.readFile(file));
await initializeStudioCore(() => fs.readFile(new URL('engine/studio-core.wasm', root)));
const sample = JSON.parse(await fs.readFile(new URL('examples/scene3d/scene.json', root), 'utf8'));
assert.equal(sample.objects.length, 3, 'The independent in-memory source fixture starts from the three-box sample.');
sample.objects.forEach((object, i) => { object.position = [[9, -8, 7], [-7, -7, 0], [0, 2, -6]][i]; });
const content = '\uFEFF' + JSON.stringify(sample, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
const ids = parseScene3DSource(content).model.objects.map(object => object.instanceId);
const cases = []; let prohibitedApplyRequests = 0;
async function fixture(sourceProvider) {
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, sourcePath: 'documents/scene.json', sourceToken: 'distribution:1' };
  const h = await dialogHarness('app-scene3d-distribution', { queueMicrotask, parseScene3DSource,
    createScene3DDistributionProposal, isScene3DDistributionProposal, supportsStudioCoreScene3DDistributionPatch,
    t: value => value, translatePage() {}, onLanguageChange() { return () => {}; } });
  h.runtime.window.confirm = () => true;
  for (const name of ['Transforms', 'Objects', 'Environment', 'Properties', 'Translation', 'Alignment'])
    assert.equal(h.runtime['setupScene3D' + name], undefined, 'Sibling controller must not be injected.');
  const snapshot = () => ({ sourcePath: context.sourcePath, token: context.sourceToken, content,
    baseSourceRevision: 'sha256:' + sha(content), sourceRevision: 'sha256:' + sha(content) });
  const controller = h.runtime.setupScene3DDistribution({ getContext: () => context,
    getSource: async () => sourceProvider ? sourceProvider(snapshot()) : snapshot(),
    applyDraft: async () => { prohibitedApplyRequests++; throw Error('Independent read-only quality grants no writer'); } });
  const el = suffix => h.element('scene3dDistribution' + suffix), rows = () => el('Objects').querySelectorAll('input[type=checkbox]');
  const select = (id, checked = true) => { const row = rows().find(node => node.dataset.instanceId === id); assert.ok(row); row.checked = checked; row.dispatch('change'); };
  const change = (suffix, value, event = 'change') => { el(suffix).value = value; el(suffix).dispatch(event); };
  const selectAll = () => ids.forEach(id => select(id));
  return { h, context, controller, el, rows, select, selectAll, change, snapshot };
}
async function run(name, fn, provider) { let h; try { h = await fixture(provider); await fn(h); cases.push({ name, ok: true }); }
  catch (error) { cases.push({ name, ok: false, error: error.stack || String(error) }); }
  finally { h?.controller.dispose(); await flushDialogs(); } }
await run('minimum three and hidden global selections work with the real private candidate while all six siblings are absent', async h => {
  assert.equal(await h.controller.open(), true); assert.ok(h.rows().every(row => !row.checked));
  h.select(ids[0]); h.select(ids[1]); assert.equal(h.el('Check').disabled, true); h.select(ids[2]); assert.equal(h.el('Check').disabled, false);
  h.change('Search', ids[0], 'input'); assert.equal(h.rows().length, 1); h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
  const after = JSON.parse(h.el('Source').textContent.replace(/^\uFEFF/, ''));
  assert.equal(after.objects[0].position[0], 9); assert.equal(after.objects[1].position[0], -7); assert.equal(after.objects[2].position[0], 1);
  for (let i = 0; i < sample.objects.length; i++) for (const field of ['instanceId', 'name', 'primitive', 'rotationDegrees', 'size', 'color'])
    assert.deepEqual(after.objects[i][field], sample.objects[i][field]);
});
await run('unchecking below minimum revokes approval and rechecking requires a fresh complete review', async h => {
  await h.controller.open(); h.selectAll(); h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
  h.select(ids[1], false); assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true);
  h.select(ids[1]); assert.equal(h.el('Check').disabled, false); assert.equal(h.el('Apply').disabled, true);
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
});
await run('silent axis rendered checkbox or UUID mismatches cannot create a different closed intent', async h => {
  await h.controller.open(); h.selectAll(); h.el('Axis').value = 'y'; h.el('Check').click();
  assert.equal(h.el('Apply').disabled, true); assert.equal(h.el('Axis').value, 'x');
  h.rows()[0].checked = false; h.el('Check').click(); assert.equal(h.el('Apply').disabled, true); assert.ok(h.rows().every(row => row.checked));
  h.rows()[0].dataset.instanceId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'; h.el('Check').click(); assert.equal(h.el('Apply').disabled, true);
  assert.deepEqual(h.rows().map(row => row.dataset.instanceId), ids); h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
});
await run('silent axis query or checkbox changes after approval never invoke a writer', async h => {
  await h.controller.open(); h.selectAll(); h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
  h.el('Axis').value = 'z'; h.el('Apply').click(); await flushDialogs(); assert.equal(h.el('Apply').disabled, true); assert.equal(prohibitedApplyRequests, 0);
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, false); h.el('Search').value = ids[0]; h.el('Apply').click(); await flushDialogs();
  assert.equal(h.el('Apply').disabled, true); assert.equal(prohibitedApplyRequests, 0);
  h.el('Check').click(); assert.equal(h.el('Apply').disabled, false); h.rows()[0].checked = false; h.el('Apply').click(); await flushDialogs();
  assert.equal(h.el('Apply').disabled, true); assert.equal(prohibitedApplyRequests, 0);
});
await run('released sessions old generations reattached rows and foreign rendered UUID events cannot change global selection', async h => {
  await h.controller.open(); const old = h.rows()[0]; h.controller.close(true); h.context.sourceToken = 'distribution:2'; await h.controller.open();
  old.checked = true; old.dispatch('change'); assert.ok(h.rows().every(row => !row.checked));
  const foreign = h.rows()[0]; foreign.dataset.instanceId = ids[2]; foreign.checked = true; foreign.dispatch('change');
  assert.equal(h.el('Check').disabled, true); h.controller.refresh(); assert.ok(h.rows().every(row => !row.checked));
  h.selectAll(); const stale = h.rows()[1]; h.change('Search', ids[0], 'input'); const before = h.el('Selection').textContent;
  stale.checked = false; stale.dispatch('change'); assert.equal(h.el('Selection').textContent, before);
  h.el('Objects').append(stale); stale.dispatch('change'); assert.equal(h.el('Selection').textContent, before);
  h.change('Search', '', 'input'); assert.ok(h.rows().every(row => row.checked)); h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
});
await run('same-path source replacement revokes approval while retaining raw choices and axis', async h => {
  await h.controller.open(); h.selectAll(); h.change('Axis', 'y'); h.el('Check').click(); assert.equal(h.el('Apply').disabled, false);
  const checked = h.rows().filter(row => row.checked).map(row => row.dataset.instanceId);
  h.context.sourceToken = 'distribution:reload'; h.controller.refresh();
  assert.equal(h.el('Check').disabled, true); assert.equal(h.el('Apply').disabled, true);
  assert.deepEqual(h.rows().filter(row => row.checked).map(row => row.dataset.instanceId), checked); assert.equal(h.el('Axis').value, 'y');
});
let release, originalSnapshot;
const gate = new Promise(resolve => { release = resolve; });
await run('late source completion after cancellation cannot reopen or populate the released owner', async h => {
  const opened = h.controller.open(); h.controller.close(true); release(originalSnapshot);
  assert.equal(await opened, false); assert.equal(h.el('Dialog').open, false); assert.equal(h.el('Fields').hidden, true); assert.equal(h.el('Apply').disabled, true);
}, value => { originalSnapshot = value; return gate; });
const endSha256 = sha(await fs.readFile(file)), output = process.argv[2]; assert.ok(output && /^[a-z0-9-]+\.json$/.test(output));
const report = { format: 'viento-scene3d-distribution-independent-ui-quality', schemaVersion: 1, observedAt: new Date().toISOString(), node: process.version,
  ok: cases.every(item => item.ok) && prohibitedApplyRequests === 0 && beforeSha256 === endSha256,
  passed: cases.filter(item => item.ok).length, failed: cases.filter(item => !item.ok).length, cases,
  source: { path: 'web/modules/app-scene3d-distribution.js', beforeSha256, endSha256, stable: beforeSha256 === endSha256 },
  prohibitedApplyRequests, siblingControllersAbsent: 6,
  scope: 'Actual isolated-stage controller in event-capable DOM fixture with native parse and genuine private proposal. Read-only invalid Apply paths, global target/axis/query/row/session lifecycle; no writer, source/disk Save, service, actual browser/GPU/device/install or actual checkout application.' };
await fs.writeFile(new URL(output, out), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ ok: report.ok, passed: report.passed, failed: report.failed, sourceStable: report.source.stable, writerRequests: prohibitedApplyRequests }) + '\n');
if (!report.ok) process.exitCode = 1;
