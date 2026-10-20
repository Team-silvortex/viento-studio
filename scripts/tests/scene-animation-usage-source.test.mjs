import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneAnimationProposal } from '../../engine/scene-animation-edit.mjs';
import { sceneAnimationUsageMatchSource } from '../../engine/scene-animation-usage.mjs';
import { sceneAnimationTargetsMatchSource } from '../../engine/scene-animation-targets.mjs';
import { fixture, original, parse, edit, revision, gate, conflict } from './helpers/scene-animation-usage-host-fixture.mjs';

test('usage and targets have independent capability tokens and do not change ordinary source identity', async () => {
  const h = fixture(), source = await h.host.getSource(), initial = h.host.getContext();
  h.state.usageAvailable = false; const usageLost = h.host.getContext();
  assert.equal(usageLost.sourceToken, source.token); assert.equal(usageLost.targetsToken, initial.targetsToken);
  assert.notEqual(usageLost.usageToken, initial.usageToken);
  h.state.usageAvailable = true; const usageBack = h.host.getContext();
  assert.equal(usageBack.sourceToken, source.token); assert.equal(usageBack.targetsToken, initial.targetsToken);
  assert.notEqual(usageBack.usageToken, usageLost.usageToken);
  h.state.targetsAvailable = false; const targetsLost = h.host.getContext();
  assert.equal(targetsLost.sourceToken, source.token); assert.equal(targetsLost.usageToken, usageBack.usageToken);
  assert.notEqual(targetsLost.targetsToken, usageBack.targetsToken);
});

test('target capability loss and recovery cannot revoke an otherwise current usage read', async () => {
  for (const boundary of [1, 2, 'usage', 3]) {
    const h = fixture(), source = await h.host.getSource(), g = boundary === 'usage' ? gate() : h.blockDigest(boundary);
    if (boundary === 'usage') h.beforeUsage = g.wait;
    const pending = h.host.getUsage(source); await g.entered;
    const before = h.host.getContext(); h.state.targetsAvailable = false; h.host.getContext(); h.state.targetsAvailable = true;
    assert.equal(h.host.getContext().usageToken, before.usageToken);
    g.release(); assert.equal(sceneAnimationUsageMatchSource(await pending, source), true);
    assert.deepEqual(h.targetRequests, []); assert.deepEqual(h.writes, []);
  }
});

test('usage capability loss and recovery cannot revoke an otherwise current target directory read', async () => {
  for (const boundary of [1, 2, 'targets', 3]) {
    const h = fixture(), source = await h.host.getSource(), g = boundary === 'targets' ? gate() : h.blockDigest(boundary);
    if (boundary === 'targets') h.beforeTargets = g.wait;
    const pending = h.host.getTargets(source); await g.entered;
    const before = h.host.getContext(); h.state.usageAvailable = false; h.host.getContext(); h.state.usageAvailable = true;
    assert.equal(h.host.getContext().targetsToken, before.targetsToken);
    g.release(); assert.equal(sceneAnimationTargetsMatchSource(await pending, source), true);
    assert.deepEqual(h.requests, []); assert.deepEqual(h.writes, []);
  }
});

test('reviewed target-backed edits remain valid when optional usage is revoked at each apply boundary', async () => {
  for (const boundary of [0, 1, 2, 3, 4, 5, 6]) {
    const h = fixture(), source = await h.host.getSource(), targets = await h.host.getTargets(source), model = parse(original);
    model.durationSeconds = 3; const proposal = await createSceneAnimationProposal(source, edit(model));
    const withdraw = () => { h.state.usageAvailable = false; assert.equal(h.host.getContext().sourceToken, source.token); };
    if (boundary === 0) withdraw();
    else { const target = h.digests + boundary; h.beforeDigest = count => { if (count === target) withdraw(); }; }
    const applied = await h.host.applyDraft(proposal, { targets });
    assert.equal(applied.applied, true); assert.equal(parse(applied.content).durationSeconds, 3);
    assert.equal(h.writes.length, 1); assert.equal(h.targetRequests.length, 2); assert.deepEqual(h.requests, []);
    assert.equal(h.state.baseline, original); assert.equal(h.state.version, revision(original));
  }
});

test('an ordinary draft application revokes a pending usage read and cannot be overwritten by its response', async () => {
  const h = fixture(), source = await h.host.getSource(), g = gate(), model = parse(original);
  model.durationSeconds = 3; const proposal = await createSceneAnimationProposal(source, edit(model));
  h.beforeUsage = g.wait; const pending = h.host.getUsage(source); await g.entered;
  const applied = await h.host.applyDraft(proposal); g.release(); await assert.rejects(pending, conflict);
  assert.deepEqual(h.writes, [applied.content]); assert.equal(h.state.content, applied.content); assert.equal(h.state.baseline, original);
});

test('usage is available without a target reader and a ready usage catalog grants no target-backed apply authority', async () => {
  const h = fixture({ noTargets: true }), source = await h.host.getSource(), usage = await h.host.getUsage(source), model = parse(original);
  assert.equal(h.host.getContext().usageAvailable, true); assert.equal(h.host.getContext().targetsAvailable, false);
  model.durationSeconds = 3; const proposal = await createSceneAnimationProposal(source, edit(model));
  await assert.rejects(h.host.applyDraft(proposal, { targets: usage }), { errorCode: 'scene_animation_targets_conflict' });
  assert.deepEqual(h.writes, []); assert.equal((await h.host.applyDraft(proposal)).applied, true);
});

test('legacy animation source schemas produce a read-only usage snapshot without upgrading or requiring clips', async () => {
  for (const schemaVersion of [1, 2]) {
    const h = fixture(), model = parse(original); model.schemaVersion = schemaVersion; delete model.clips;
    const content = JSON.stringify(model); h.state.content = content; h.state.baseline = content; h.state.version = revision(content);
    h.raw.animation.content = content; h.raw.animation.sourceRevision = revision(content);
    const source = await h.host.getSource(), usage = await h.host.getUsage(source);
    assert.equal(usage.savedContent, content); assert.deepEqual(usage.matches, []); assert.deepEqual(h.writes, []);
    assert.equal(parse(h.state.content).schemaVersion, schemaVersion);
  }
});
