// Independent real-controller DOM VM using actual Rust-backed parsing and
// branded proposals. Source application is an injected guarded memory port.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import '../../../scripts/adapters/node-studio-core.mjs';
import { dialogHarness, flushDialogs } from '../../../scripts/tests/dialog-harness.mjs';
import { parseScene3DSource } from '../../../engine/scene3d.mjs';
import { createScene3DObjectsProposal, prepareScene3DObjectsApply, isScene3DObjectsProposal } from '../../../engine/scene3d-objects.mjs';
const root = new URL('../../../', import.meta.url), copy = x => JSON.parse(JSON.stringify(x)), hash = x => crypto.createHash('sha256').update(x).digest('hex');
const original = await fs.readFile(new URL('examples/scene3d/scene.json', root), 'utf8'), ids = JSON.parse(original).objects.map(x => x.instanceId);
const fresh = n => `${(0xabcdef00 + n).toString(16)}-1111-4111-8111-111111111111`;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async () => { await flushDialogs(); await flushDialogs(); }, checks = [];
async function fixture(options = {}) {
  let content = original, allocations = 0, calls = 0, focuses = 0, supported = true, listener = () => {}, proposalCalls = 0;
  const context = { editable: true, creating: false, busy: false, sourceJSON: true, sourcePath: 'documents/scenes/boxes.json', sourceToken: 'owner:1' };
  const snapshot = () => ({ content, sourcePath: context.sourcePath, token: context.sourceToken,
    baseSourceRevision: `sha256:${hash(original)}`, sourceRevision: `sha256:${hash(content)}` });
  const submitted = [], proposals = [], alerts = [];
  const harness = await dialogHarness('app-scene3d-objects', {
    queueMicrotask, crypto: { randomUUID: () => fresh(++allocations) }, supportsStudioCoreScene3DObjectsPatch: () => supported,
    parseScene3DSource, createScene3DObjectsProposal(s, e) { proposalCalls++; const real = createScene3DObjectsProposal(copy(s), copy(e)); const p = options.proposal?.(real) ?? real; proposals.push(p); return p; },
    t: x => x, translatePage() {}, onLanguageChange(fn) { listener = fn; return () => {}; },
  });
  harness.runtime.window.alert = text => alerts.push(text); harness.runtime.window.confirm = () => true;
  const controller = harness.runtime.setupScene3DObjects({ getContext: () => context,
    getSource: () => options.source ? options.source(snapshot()) : snapshot(),
    applyDraft: async (proposal, guard) => {
      calls++; submitted.push({ proposal, guard }); if (options.apply) return options.apply(proposal, guard, context);
      assert.equal(guard.isCurrent(), true); const prepared = await prepareScene3DObjectsApply(snapshot(), proposal, { digest: async x => hash(x) });
      assert.equal(guard.isCurrent(), true); content = prepared.afterContent; context.sourceToken += ':applied';
      return { applied: true, sourcePath: context.sourcePath, sourceToken: context.sourceToken, content, focus() { focuses++; } };
    } });
  const el = suffix => harness.element('scene3dObjects' + suffix);
  return { ...harness, controller, context, snapshot, submitted, proposals, alerts, el, allocations: () => allocations, calls: () => calls,
    focuses: () => focuses, proposalCalls: () => proposalCalls, content: () => content, setSupported(x) { supported = x; }, language() { listener(); },
    async review(action = 'copy') { assert.equal(await controller.open(), true); el('Action').value = action; el('Action').dispatch('change'); el('Check').click(); assert.equal(el('Apply').disabled, false); },
    async apply() { el('Apply').click(); await settle(); } };
}
async function check(id, run) { try { await run(); checks.push({ id, ok: true }); } catch (error) { checks.push({ id, ok: false, message: error.message }); } }
for (const [field, value] of [['Action', 'remove'], ['Object', ids[2]], ['NewIdentity', fresh(999)]]) await check(`silent-${field}-before-check-restores-bound-intent-without-generating-proposal`, async () => {
  const h = await fixture(); try {
    await h.controller.open(); h.el('Action').value = 'copy'; h.el('Action').dispatch('change');
    const bound = [h.el('Action').value, h.el('Object').value, h.el('NewIdentity').value], count = h.allocations();
    h.el(field).value = value; h.el('Check').click(); assert.equal(h.proposalCalls(), 0); assert.equal(h.el('Apply').disabled, true);
    assert.deepEqual([h.el('Action').value, h.el('Object').value, h.el('NewIdentity').value], bound); assert.equal(h.allocations(), count);
  } finally { h.controller.dispose(); }
});
await check('all-five-silent-raw-fields-after-review-lose-approval-before-memory-port', async () => {
  for (const [field, value] of [['Action', 'remove'], ['Object', ids[2]], ['NewIdentity', fresh(999)], ['Name', 'Silently changed'], ['Color', '#abc123']]) {
    const h = await fixture(); try { await h.review('add'); h.el(field).value = value; await h.apply(); assert.equal(h.calls(), 0, field); assert.equal(h.el('Apply').disabled, true, field); assert.equal(h.content(), original); } finally { h.controller.dispose(); }
  }
});
await check('language-and-repeated-check-retain-uuid-author-values-and-original-brand', async () => {
  const h = await fixture(); try { await h.review(); const id = h.el('NewIdentity').value, count = h.allocations(), raw = h.el('Name').value;
    for (let i = 0; i < 3; i++) { h.language(); h.el('Check').click(); assert.equal(h.el('NewIdentity').value, id); assert.equal(h.el('Name').value, raw); assert.equal(h.allocations(), count); assert(isScene3DObjectsProposal(h.proposals.at(-1))); }
    await h.apply(); assert.equal(h.focuses(), 1); assert.equal(h.el('Dialog').open, false); assert.equal(parseScene3DSource(h.content()).model.objects.length, 4);
  } finally { h.controller.dispose(); }
});
await check('late-read-after-close-and-rejection-after-new-open-do-not-reclaim-owner', async () => {
  const wait = deferred(); let reads = 0; const h = await fixture({ source: s => ++reads === 1 ? wait.promise : s });
  try { const old = h.controller.open(); h.controller.close(true); assert.equal(await h.controller.open(), true); const id = h.el('NewIdentity').value, status = h.el('Status').textContent;
    wait.reject(Error('Old source failure')); assert.equal(await old, false); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('NewIdentity').value, id); assert.equal(h.el('Status').textContent, status); assert.equal(h.allocations(), 1); assert.deepEqual(h.alerts, []);
  } finally { h.controller.dispose(); }
});
await check('late-apply-after-close-new-open-loses-write-guard-and-cannot-focus', async () => {
  const wait = deferred(), h = await fixture({ apply: () => wait.promise });
  try { await h.review(); h.el('Apply').click(); assert.equal(h.calls(), 1); const old = h.submitted[0]; h.controller.close(true); assert.equal(old.guard.isCurrent(), false);
    await h.controller.open(); const newId = h.el('NewIdentity').value; wait.resolve({ applied: true, sourcePath: h.context.sourcePath, sourceToken: 'owner:2', content: old.proposal.afterContent, focus() { throw Error('Late focus must not run'); } });
    await settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('NewIdentity').value, newId); assert.equal(h.content(), original);
  } finally { h.controller.dispose(); }
});
await check('same-path-reload-during-apply-isCurrent-false-and-receipt-cannot-confirm', async () => {
  const wait = deferred(), h = await fixture({ apply: () => wait.promise });
  try { await h.review(); h.el('Apply').click(); const old = h.submitted[0]; h.context.sourceToken = 'same-path-reloaded'; assert.equal(old.guard.isCurrent(), false);
    wait.resolve({ applied: true, sourcePath: h.context.sourcePath, sourceToken: 'owner:2', content: old.proposal.afterContent }); await settle(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('Apply').disabled, true); assert.equal(h.content(), original);
  } finally { h.controller.dispose(); }
});
for (const variant of ['path', 'content', 'old-token', 'foreign-new-token']) await check(`forged-${variant}-completion-keeps-author-form-and-never-focuses`, async () => {
  const h = await fixture({ apply(p, guard, context) { context.sourceToken = 'owner:2'; return { applied: true,
    sourcePath: variant === 'path' ? 'other.json' : context.sourcePath, content: variant === 'content' ? 'changed' : p.afterContent,
    sourceToken: variant === 'old-token' ? 'owner:1' : variant === 'foreign-new-token' ? 'other-owner:2' : 'owner:2', focus() { throw Error('Invalid focus'); } }; } });
  try { await h.review(); const id = h.el('NewIdentity').value; await h.apply(); assert.equal(h.el('Dialog').open, true); assert.equal(h.el('NewIdentity').value, id); assert.equal(h.content(), original); } finally { h.controller.dispose(); }
});
await check('mutable-lookalike-proposal-can-never-bypass-real-private-memory-apply', async () => {
  const h = await fixture({ proposal: p => ({ ...copy(p), changedPaths: ['/objects/0'] }) });
  try { await h.review(); await h.apply(); assert.equal(h.el('Dialog').open, true); assert.equal(h.content(), original); assert.equal(h.focuses(), 0); assert.equal(isScene3DObjectsProposal(h.proposals[0]), false); } finally { h.controller.dispose(); }
});
await check('unsupported-objects-capability-disables-new-entry-and-retains-existing-base-editor-button', async () => {
  const h = await fixture(); try { h.setSupported(false); h.controller.refresh(); assert.equal(h.el('Btn').disabled, true); assert.equal(await h.controller.open(), false); assert.equal(h.allocations(), 0); assert(h.element('projectBuildBtn')); assert.equal(h.calls(), 0); } finally { h.controller.dispose(); }
});
await check('all-three-real-proposals-apply-with-exact-new-token-and-no-implicit-save', async () => {
  for (const action of ['add', 'copy', 'remove']) { const h = await fixture(); try { await h.review(action); const p = h.proposals.at(-1); assert(isScene3DObjectsProposal(p)); await h.apply(); assert.equal(h.el('Dialog').open, false); assert.equal(h.content(), p.afterContent); assert.equal(h.focuses(), 1); assert.equal(h.calls(), 1); } finally { h.controller.dispose(); } }
});
const sourceHashes = {}; for (const path of ['web/modules/app-scene3d-objects.js', 'engine/scene3d-objects.mjs', 'engine/scene3d-authoring.mjs', 'scripts/tests/dialog-harness.mjs']) sourceHashes[path] = hash(await fs.readFile(new URL(path, root)));
const report = { format: 'viento-scene3d-objects-independent-ui-boundary', schemaVersion: 1, runtime: process.version, sourceHashes, checks,
  passed: checks.filter(x => x.ok).length, failed: checks.filter(x => !x.ok).length,
  scope: 'Actual controller DOM VM and actual Rust-backed parse/proposal/private prepare; injected ownership and memory application ports. Language notification preserves values, not browser translation/layout proof. No browser, rendering, application Save, engine tools, installation or device claim.' };
assert(process.argv[2], 'NEW report path required'); await fs.writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify(report, null, 2)); if (report.failed) process.exitCode = 1;
