import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneAnimationProposal } from '../../engine/scene-animation-edit.mjs';
import { isSceneAnimationUsage, sceneAnimationUsageMatchSource, sceneAnimationUsageSource } from '../../engine/scene-animation-usage.mjs';
import { fixture, original, parse, edit, id, revision, conflict, rejected, gate, mutate } from './helpers/scene-animation-usage-host-fixture.mjs';
test('usage read authenticates saved bytes, binds to the source and never writes or requests animation targets', async () => {
  const h = fixture(), source = await h.host.getSource(), usage = await h.host.getUsage(source);
  assert.equal(isSceneAnimationUsage(usage), true); assert.equal(sceneAnimationUsageMatchSource(usage, source), true);
  assert.equal(usage.behavior, null); assert.deepEqual(usage.matches, []);
  assert.equal(usage.savedContent, original); assert.equal(h.host.getContext().usageAvailable, true);
  assert.deepEqual(h.targetRequests, []); assert.equal(typeof h.host.getContext().usageToken, 'string');
  assert.deepEqual(h.requests, [{ sceneObjectId: parse(original).sceneObjectId }]); assert.deepEqual(h.writes, []);
});
test('every async boundary rejects source changes and optional capability withdrawal', async () => {
  const keys = ['document','token','sourcePath','content','baseline','version','editable','creating','busy','available','sourceJSON','usageAvailable'];
  for (const boundary of [1, 2, 'usage', 3]) for (const key of keys) {
    const h = fixture(), source = await h.host.getSource(), g = boundary === 'usage' ? gate() : h.blockDigest(boundary);
    if (boundary === 'usage') h.beforeUsage = g.wait;
    const pending = h.host.getUsage(source); await g.entered; mutate(h, key); g.release();
    await assert.rejects(pending, conflict); assert.deepEqual(h.writes, [], `${boundary}:${key}`);
  }
});
test('request descriptors are snapshotted before awaits without invoking caller getters', async () => {
  const h = fixture(), source = await h.host.getSource(); let reads = 0;
  const accessor = { ...source }; Object.defineProperty(accessor, 'content', { enumerable: true, get() { reads++; return source.content; } });
  for (const candidate of [accessor, { ...source, token: 'other' }, { ...source, extra: true }, { ...source, content: null }, null]) await assert.rejects(h.host.getUsage(candidate), conflict);
  assert.equal(reads, 0); assert.equal(h.requests.length, 0);
  const mutable = { ...source }, g = h.blockDigest(1), pending = h.host.getUsage(mutable);
  await g.entered; mutable.content = 'caller mutated'; mutable.token = 'different'; g.release();
  assert.equal(sceneAnimationUsageMatchSource(await pending, source), true);
});
test('saved animation changes and dishonest revision claims cannot return matches', async () => {
  for (const change of [r => r.animation.sourceRevision = revision('other'), r => r.animation.content = original + '\n', r => r.animation.sourcePath = 'documents/animations/other.json', r => r.scene.objectId = id(8)]) {
    const h = fixture(); change(h.raw); await assert.rejects(h.host.getUsage(await h.host.getSource()), rejected); assert.deepEqual(h.writes, []);
  }
});
test('an unsaved ordinary animation draft can read saved behavior matches while preserving its baseline', async () => {
  const h = fixture(); h.state.content = original.replace('"durationSeconds": 2', '"durationSeconds": 3'); assert.notEqual(h.state.content, original);
  const source = await h.host.getSource(), usage = await h.host.getUsage(source);
  assert.equal(sceneAnimationUsageMatchSource(usage, source), true); assert.equal(usage.savedContent, original);
  assert.equal(h.state.content, source.content); assert.equal(h.state.baseline, original); assert.deepEqual(h.writes, []);
});
test('unavailable or old hosts preserve ordinary leaf editing without calling the optional usage service', async () => {
  for (const options of [{ usageAvailable: false }, { noPort: true }, { usageAvailable: 'true' }, { usageAvailable: 1 }, { usageAvailable: null }]) {
    const h = fixture(options), source = await h.host.getSource(), model = parse(source.content); model.durationSeconds = 3;
    assert.equal(h.host.getContext().usageAvailable, false); await assert.rejects(h.host.getUsage(source), conflict);
    const applied = await h.host.applyDraft(await createSceneAnimationProposal(source, edit(model)));
    assert.equal(applied.applied, true); assert.equal(parse(applied.content).durationSeconds, 3); assert.equal(h.requests.length, 0);
  }
});
test('a usage failure leaves a reviewed ordinary proposal applicable', async () => {
  const h = fixture(), source = await h.host.getSource(), model = parse(source.content); model.durationSeconds = 3;
  const proposal = await createSceneAnimationProposal(source, edit(model));
  h.beforeUsage = () => { throw Object.assign(new Error('unavailable'), { errorCode: 'scene_animation_usage_unavailable' }); };
  await assert.rejects(h.host.getUsage(source), rejected); const applied = await h.host.applyDraft(proposal);
  assert.equal(applied.applied, true); assert.equal(h.writes.length, 1); assert.equal(h.state.baseline, original);
});
test('observed optional capability loss and return revokes pending usage reads without changing ordinary source ownership', async () => {
  for (const boundary of [1, 2, 'usage', 3]) {
    const h = fixture(), source = await h.host.getSource(), g = boundary === 'usage' ? gate() : h.blockDigest(boundary);
    if (boundary === 'usage') h.beforeUsage = g.wait;
    const pending = h.host.getUsage(source); await g.entered;
    h.state.usageAvailable = false; assert.equal(h.host.getContext().sourceToken, source.token);
    h.state.usageAvailable = true; assert.equal(h.host.getContext().sourceToken, source.token);
    g.release(); await assert.rejects(pending, conflict);
    assert.equal(sceneAnimationUsageMatchSource(await h.host.getUsage(source), source), true); assert.deepEqual(h.writes, []);
  }
});
test('optional usage withdrawal cannot invalidate reviewed ordinary apply at any digest boundary', async () => {
  for (const boundary of [0, 1, 2, 3]) {
    const h = fixture(), source = await h.host.getSource(), model = parse(source.content); model.durationSeconds = 3;
    const proposal = await createSceneAnimationProposal(source, edit(model));
    const withdraw = () => { h.state.usageAvailable = false; assert.equal(h.host.getContext().sourceToken, source.token); };
    if (boundary === 0) withdraw(); else { const target = h.digests + boundary; h.beforeDigest = count => { if (count === target) withdraw(); }; }
    assert.equal((await h.host.applyDraft(proposal)).applied, true); assert.equal(h.writes.length, 1); assert.equal(h.requests.length, 0);
  }
});

test('saved behavior parameter matches retain frozen source locations without gaining draft write authority', async () => {
  const h = fixture(), behavior = { format: 'viento-scene-behaviors', schemaVersion: 1, sceneObjectId: id(1), bindings: [
    { bindingId: id(20), instanceId: id(3), implementation: { backendId: 'org.viento.godot4', language: 'gdscript', sourceObjectId: id(21) },
      parameters: { clip_id: id(10), arbitrary: id(99), substring: `prefix:${id(10)}`, numeric: 42 }, events: [] }] };
  const content = '\ufeff' + JSON.stringify(behavior, null, 2).replaceAll('\n', '\r\n');
  h.raw.behavior = { objectId: id(22), sourcePath: 'documents/behaviors/demo.json', sourceRevision: revision(content), content };
  const source = await h.host.getSource(), usage = await h.host.getUsage(source);
  assert.deepEqual(usage.matches.map(row => row.clipId), [id(10), id(99)]);
  const view = sceneAnimationUsageSource(usage, usage.matches[0]);
  assert.equal(view.content, content); assert.equal(view.propertyPath, '/bindings/0/parameters/clip_id');
  assert.equal(view.content.slice(view.sourceRange.start, view.sourceRange.end), JSON.stringify(id(10)));
  h.raw.behavior.content = '{}';
  assert.equal(sceneAnimationUsageSource(usage, usage.matches[0]).content, content);
  assert.throws(() => sceneAnimationUsageSource(usage, { ...usage.matches[0] }), rejected);
  assert.deepEqual(h.writes, []); assert.deepEqual(h.targetRequests, []);
});
