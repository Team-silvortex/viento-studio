import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { createSceneBehaviorSourceHost } from '../../web/modules/app-behavior-source.js';
import { createSceneBehaviorProposal } from '../../engine/scene-behaviors-edit.mjs';
import { isSceneBehaviorAnimationClips, sceneBehaviorAnimationClipsMatchSource } from '../../engine/scene-animation-directory.mjs';
const animationModel = JSON.parse(await fs.readFile(new URL('../../examples/scene-animation/documents/animations/demo.json', import.meta.url), 'utf8'));
const original = await fs.readFile(new URL('../../examples/scene-behaviors/documents/behaviors/demo.json', import.meta.url), 'utf8');
const hash = text => createHash('sha256').update(text).digest('hex'), revision = text => 'sha256:' + hash(text);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sceneId = JSON.parse(original).sceneObjectId, dependencyRevision = revision('behavior dependencies');
const conflict = { errorCode: 'scene_behavior_authoring_conflict' };
const rejected = error => /^(scene_behavior_|scene_animation_)/.test(error.errorCode || '');
function gate() { let enter, release; const entered = new Promise(r => { enter = r; }), waiting = new Promise(r => { release = r; }); return { entered, release, wait: async () => { enter(); await waiting; } }; }
function fixture({ animationClipsAvailable = true, noDirectory = false, noInspect = false } = {}) {
  const state = { document: {}, token: 'animation-clip-picker', sourcePath: 'documents/behaviors/demo.json', content: original,
    baseline: original, version: revision(original), editable: true, creating: false, busy: false, available: true, sourceJSON: true, animationClipsAvailable, audioTracksAvailable: true };
  const scene = { objectId: sceneId, sourcePath: 'documents/scenes/demo.json', sourceRevision: revision('scene bytes') };
  const animation = JSON.stringify({ ...animationModel, schemaVersion: 3, sceneObjectId: sceneId,
    clips: [{ id: id(1), name: '歩く / Walk', startSeconds: 0, endSeconds: 1, loop: true },
      { id: id(3), name: '跳跃 / Jump', startSeconds: 1, endSeconds: 2, loop: false }] });
  const raw = { format: 'viento-scene-animation-directory', schemaVersion: 1, status: 'ready', worldId: 'world:' + hash('world'), revision: revision('directory'),
    scene, manifest: { objectId: id(4), sourcePath: 'documents/animations/demo.json', sourceRevision: revision(animation), content: animation } };
  const review = { format: 'viento-behavior-authoring-context', schemaVersion: 1, sourcePath: state.sourcePath,
    scene: { ...scene, instances: [] }, dependencyRevision };
  const audio = JSON.stringify({ format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: sceneId,
    tracks: [{ id: id(11), resourceId: id(12), role: 'music', volume: .3, loop: true }], cues: [] });
  const audioRaw = { ...raw, format: 'viento-scene-audio-directory', manifest: { objectId: id(14),
    sourcePath: 'documents/audio/demo.json', sourceRevision: revision(audio), content: audio } };
  const h = { state, raw, audioRaw, review, writes: [], digests: 0, reviews: [], requests: [], audioRequests: [] };
  h.host = createSceneBehaviorSourceHost({ getState: () => ({ ...state }),
    digest: async content => { await h.beforeDigest?.(++h.digests); return hash(content); },
    ...(noInspect ? {} : { inspect: async input => { h.reviews.push(input); await h.beforeReview?.(); return structuredClone(h.review); } }),
    ...(noDirectory ? {} : { inspectAnimationDirectory: async input => { h.requests.push(input); await h.beforeDirectory?.(); return structuredClone(h.raw); } }),
    inspectAudioDirectory: async input => { h.audioRequests.push(input); await h.beforeAudioDirectory?.(); return structuredClone(h.audioRaw); },
    writeDraft: content => { h.writes.push(content); state.content = content; } });
  h.blockDigest = offset => { const g = gate(), target = h.digests + offset; h.beforeDigest = async count => { if (count === target) await g.wait(); }; return g; };
  return h;
}
function mutate(h, key) { if (key === 'document') h.state.document = {}; else if (typeof h.state[key] === 'boolean') h.state[key] = !h.state[key]; else h.state[key] += ' '; }

test('behavior animation directory reads only the current scene and returns a source-bound immutable clip directory', async () => {
  const h = fixture(), source = await h.host.getSource(), directory = await h.host.getAnimationClips(source);
  assert.equal(h.host.getContext().animationClipsAvailable, true); assert.equal(isSceneBehaviorAnimationClips(directory), true);
  assert.equal(sceneBehaviorAnimationClipsMatchSource(directory, source), true); assert.equal(directory.status, 'ready');
  assert.deepEqual(directory.clips, [{ clipId: id(1), name: '歩く / Walk', startSeconds: 0, endSeconds: 1, loop: true },
    { clipId: id(3), name: '跳跃 / Jump', startSeconds: 1, endSeconds: 2, loop: false }]);
  assert.ok(Object.isFrozen(directory.clips[0])); assert.deepEqual(h.requests, [{ sceneObjectId: sceneId }]);
  assert.deepEqual(h.reviews, [{ sourcePath: source.sourcePath, content: original }]); assert.deepEqual(h.writes, []);
  assert.equal(h.state.baseline, original); assert.equal(h.state.version, revision(original));
});
test('a scene without an animation opt-in returns an explicit empty catalog without changing the draft', async () => {
  const h = fixture(); h.raw.status = 'empty'; h.raw.manifest = null;
  const directory = await h.host.getAnimationClips(await h.host.getSource());
  assert.equal(directory.status, 'empty'); assert.deepEqual(directory.clips, []); assert.equal(directory.manifest, null); assert.deepEqual(h.writes, []);
});
test('animation directory read refuses every owner change after both digest and both service boundaries', { timeout: 10000 }, async () => {
  const keys = ['document','token','sourcePath','content','baseline','version','editable','creating','busy','available','sourceJSON','animationClipsAvailable'];
  for (const boundary of [1, 2, 'review', 'directory']) for (const key of keys) {
    const h = fixture(), source = await h.host.getSource(), g = typeof boundary === 'number' ? h.blockDigest(boundary) : gate();
    if (boundary === 'review') h.beforeReview = g.wait; if (boundary === 'directory') h.beforeDirectory = g.wait;
    const pending = h.host.getAnimationClips(source); await g.entered; mutate(h, key); g.release();
    await assert.rejects(pending, conflict); assert.deepEqual(h.writes, [], `${boundary}:${key}`);
  }
});
test('requested source data is captured before awaits without invoking caller accessors', async () => {
  const h = fixture(), source = await h.host.getSource(); let reads = 0;
  const accessor = { ...source }; Object.defineProperty(accessor, 'content', { enumerable: true, get() { reads++; return source.content; } });
  for (const candidate of [accessor, { ...source, token: 'other' }, { ...source, sourcePath: 'documents/other.json' }, { ...source, extra: true }, null]) {
    await assert.rejects(h.host.getAnimationClips(candidate), conflict);
  }
  assert.equal(reads, 0); assert.equal(h.reviews.length, 0); assert.equal(h.requests.length, 0);
  const mutable = { ...source }, g = h.blockDigest(1), pending = h.host.getAnimationClips(mutable);
  await g.entered; mutable.content = 'changed by caller'; mutable.token = 'another'; g.release();
  assert.equal(sceneBehaviorAnimationClipsMatchSource(await pending, source), true);
});
test('changed and malformed behavior dependency reviews never request the animation directory', async () => {
  for (const change of [r => r.format = 'wrong', r => r.schemaVersion = 2, r => r.sourcePath += '.other', r => r.dependencyRevision = '', r => r.scene.objectId = id(8)]) {
    const h = fixture(); change(h.review);
    await assert.rejects(h.host.getAnimationClips(await h.host.getSource()), conflict); assert.equal(h.requests.length, 0); assert.deepEqual(h.writes, []);
  }
});
test('animation directory must match all three scene dependency fields captured by behavior review', async () => {
  for (const change of [r => r.scene.objectId = id(8), r => r.scene.sourcePath += '.other', r => r.scene.sourceRevision = revision('new scene')]) {
    const h = fixture(); change(h.raw);
    await assert.rejects(h.host.getAnimationClips(await h.host.getSource()), rejected); assert.deepEqual(h.writes, []);
  }
});
test('service failures and a stale requested source never supply a reusable directory', async () => {
  for (const boundary of ['beforeReview', 'beforeDirectory']) {
    const h = fixture(); h[boundary] = () => { throw Object.assign(new Error('offline'), { errorCode: 'scene_animation_directory_unavailable' }); };
    await assert.rejects(h.host.getAnimationClips(await h.host.getSource()), rejected); assert.deepEqual(h.writes, []);
  }
  const h = fixture(), source = await h.host.getSource(); h.state.content += '\n';
  await assert.rejects(h.host.getAnimationClips(source), conflict); assert.equal(h.requests.length, 0); assert.equal(h.reviews.length, 0);
});
test('optional capability is advertised only for explicit true with both read ports', async () => {
  for (const options of [{ animationClipsAvailable: false }, { animationClipsAvailable: undefined }, { animationClipsAvailable: 'yes' }, { animationClipsAvailable: 1 }, { noDirectory: true }, { noInspect: true }]) {
    const h = fixture(options); if (Object.hasOwn(options, 'animationClipsAvailable')) h.state.animationClipsAvailable = options.animationClipsAvailable;
    assert.equal(h.host.getContext().animationClipsAvailable, false);
    await assert.rejects(h.host.getAnimationClips(await h.host.getSource()), conflict); assert.equal(h.requests.length, 0); assert.equal(h.reviews.length, 0);
  }
});
test('old services still support ordinary behavior edits without an animation read port', async () => {
  for (const options of [{ animationClipsAvailable: false }, { noDirectory: true }]) {
    const h = fixture(options), source = await h.host.getSource(), model = JSON.parse(source.content); model.bindings[0].parameters.amount = 65;
    const result = await h.host.applyDraft(createSceneBehaviorProposal(source, { bindings: model.bindings }), { dependencyRevision });
    assert.equal(result.applied, true); assert.equal(h.writes.length, 1); assert.equal(h.requests.length, 0);
    assert.equal(JSON.parse(result.content).bindings[0].parameters.amount, 65); assert.equal(h.state.baseline, original);
  }
});
test('an unsaved behavior draft can read animation clips and selected values use the existing string proposal path', async () => {
  const h = fixture(); h.state.content = original.replace('"amount": 40', '"amount": 41');
  const source = await h.host.getSource(), directory = await h.host.getAnimationClips(source), model = JSON.parse(source.content);
  // No parameter-name convention is involved: this is an explicit string edit.
  model.bindings[0].parameters.user_selected_value = directory.clips[1].clipId;
  const proposal = createSceneBehaviorProposal(source, { bindings: model.bindings });
  h.beforeDirectory = () => assert.fail('ordinary behavior apply must not inspect animation dependencies');
  const result = await h.host.applyDraft(proposal, { dependencyRevision });
  assert.equal(result.applied, true); assert.equal(h.requests.length, 1); assert.equal(h.reviews.length, 2);
  const changed = JSON.parse(result.content); assert.equal(changed.bindings[0].parameters.amount, 41);
  assert.equal(changed.bindings[0].parameters.user_selected_value, id(3)); assert.equal(h.state.baseline, original); assert.equal(h.state.version, revision(original));
  await assert.rejects(h.host.getAnimationClips(source), conflict);
});
test('observed optional capability disappearance and return rejects pending directories without changing the ordinary source', async () => {
  for (const boundary of [1, 2, 'review', 'directory']) {
    const h = fixture(), source = await h.host.getSource(), g = typeof boundary === 'number' ? h.blockDigest(boundary) : gate();
    if (boundary === 'review') h.beforeReview = g.wait; if (boundary === 'directory') h.beforeDirectory = g.wait;
    const pending = h.host.getAnimationClips(source); await g.entered;
    h.state.animationClipsAvailable = false; assert.equal(h.host.getContext().sourceToken, source.token);
    h.state.animationClipsAvailable = true; assert.equal(h.host.getContext().sourceToken, source.token);
    g.release(); await assert.rejects(pending, conflict); assert.deepEqual(h.writes, []);
    assert.equal((await h.host.getSource()).token, source.token);
    assert.equal(sceneBehaviorAnimationClipsMatchSource(await h.host.getAnimationClips(source), source), true);
  }
});
test('optional animation capability withdrawal leaves reviewed ordinary proposals applicable before and during each apply boundary', async () => {
  for (const boundary of ['before', 1, 2, 3, 'review']) {
    const h = fixture(), source = await h.host.getSource(), model = JSON.parse(source.content);
    model.bindings[0].parameters.amount = 65;
    const proposal = createSceneBehaviorProposal(source, { bindings: model.bindings });
    const withdraw = () => { h.state.animationClipsAvailable = false; assert.equal(h.host.getContext().sourceToken, source.token); };
    if (boundary === 'before') withdraw();
    else if (boundary === 'review') h.beforeReview = withdraw;
    else { const target = h.digests + boundary; h.beforeDigest = count => { if (count === target) withdraw(); }; }
    const result = await h.host.applyDraft(proposal, { dependencyRevision });
    assert.equal(result.applied, true); assert.equal(h.writes.length, 1); assert.equal(h.requests.length, 0);
    assert.equal(JSON.parse(result.content).bindings[0].parameters.amount, 65); assert.equal(h.state.baseline, original);
    assert.equal(h.host.getContext().animationClipsAvailable, false);
  }
});

test('legacy saved animation schemas still return ready catalogs with no named clips', async () => {
  for (const schemaVersion of [1, 2]) {
    const h = fixture(), content = JSON.stringify({ ...animationModel, schemaVersion, sceneObjectId: sceneId });
    h.raw.manifest.content = content; h.raw.manifest.sourceRevision = revision(content);
    const directory = await h.host.getAnimationClips(await h.host.getSource());
    assert.equal(directory.status, 'ready'); assert.deepEqual(directory.clips, []);
    assert.equal(directory.manifest.objectId, id(4)); assert.deepEqual(h.writes, []);
  }
});
test('animation and audio availability generations revoke their own pending reads independently', async () => {
  for (const direction of ['animation', 'audio']) {
    const h = fixture(), source = await h.host.getSource(), g = gate();
    const animation = direction === 'animation';
    h[animation ? 'beforeDirectory' : 'beforeAudioDirectory'] = g.wait;
    const pending = animation ? h.host.getAnimationClips(source) : h.host.getAudioTracks(source);
    await g.entered;
    const unrelated = animation ? 'audioTracksAvailable' : 'animationClipsAvailable';
    h.state[unrelated] = false; assert.equal(h.host.getContext().sourceToken, source.token);
    h.state[unrelated] = true; assert.equal(h.host.getContext().sourceToken, source.token);
    g.release(); assert.equal((await pending).status, 'ready'); assert.deepEqual(h.writes, []);
  }
});
test('oversized UTF-8 behavior sources and requested snapshots are rejected before service reads', async () => {
  const h = fixture(), source = await h.host.getSource(), requested = { ...source, content: source.content + ' '.repeat(32768) };
  await assert.rejects(h.host.getAnimationClips(requested), conflict);
  const model = JSON.parse(original); model.bindings[0].parameters.description = '雪'.repeat(11000);
  h.state.content = JSON.stringify(model);
  assert.equal(await h.host.getSource(), null);
  await assert.rejects(h.host.getAnimationClips(source), conflict);
  assert.equal(h.reviews.length, 0); assert.equal(h.requests.length, 0); assert.deepEqual(h.writes, []);
});
