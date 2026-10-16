import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { createSceneBehaviorSourceHost } from '../../web/modules/app-behavior-source.js';
import { createSceneBehaviorProposal } from '../../engine/scene-behaviors-edit.mjs';
import { isSceneBehaviorAudioTracks, sceneBehaviorAudioTracksMatchSource } from '../../engine/scene-audio-directory.mjs';
const original = await fs.readFile(new URL('../../examples/scene-behaviors/documents/behaviors/demo.json', import.meta.url), 'utf8');
const hash = text => createHash('sha256').update(text).digest('hex'), revision = text => 'sha256:' + hash(text);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sceneId = JSON.parse(original).sceneObjectId, dependencyRevision = revision('behavior dependencies');
const conflict = { errorCode: 'scene_behavior_authoring_conflict' };
const rejected = error => /^(scene_behavior_|scene_audio_)/.test(error.errorCode || '');
function gate() { let enter, release; const entered = new Promise(r => { enter = r; }), waiting = new Promise(r => { release = r; }); return { entered, release, wait: async () => { enter(); await waiting; } }; }
function fixture({ audioTracksAvailable = true, noDirectory = false, noInspect = false } = {}) {
  const state = { document: {}, token: 'audio-track-picker', sourcePath: 'documents/behaviors/demo.json', content: original,
    baseline: original, version: revision(original), editable: true, creating: false, busy: false, available: true, sourceJSON: true, audioTracksAvailable };
  const scene = { objectId: sceneId, sourcePath: 'documents/scenes/demo.json', sourceRevision: revision('scene bytes') };
  const audio = JSON.stringify({ format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: sceneId,
    tracks: [{ id: id(1), resourceId: id(2), role: 'music', volume: .3, loop: true }, { id: id(3), resourceId: id(2), role: 'effect', volume: .8, loop: false }], cues: [] });
  const raw = { format: 'viento-scene-audio-directory', schemaVersion: 1, status: 'ready', worldId: 'world:' + hash('world'), revision: revision('directory'),
    scene, manifest: { objectId: id(4), sourcePath: 'documents/audio/demo.json', sourceRevision: revision(audio), content: audio } };
  const review = { format: 'viento-behavior-authoring-context', schemaVersion: 1, sourcePath: state.sourcePath,
    scene: { ...scene, instances: [] }, dependencyRevision };
  const h = { state, raw, review, writes: [], digests: 0, reviews: [], requests: [] };
  h.host = createSceneBehaviorSourceHost({ getState: () => ({ ...state }),
    digest: async content => { await h.beforeDigest?.(++h.digests); return hash(content); },
    ...(noInspect ? {} : { inspect: async input => { h.reviews.push(input); await h.beforeReview?.(); return structuredClone(h.review); } }),
    ...(noDirectory ? {} : { inspectAudioDirectory: async input => { h.requests.push(input); await h.beforeDirectory?.(); return structuredClone(h.raw); } }),
    writeDraft: content => { h.writes.push(content); state.content = content; } });
  h.blockDigest = offset => { const g = gate(), target = h.digests + offset; h.beforeDigest = async count => { if (count === target) await g.wait(); }; return g; };
  return h;
}
function mutate(h, key) { if (key === 'document') h.state.document = {}; else if (typeof h.state[key] === 'boolean') h.state[key] = !h.state[key]; else h.state[key] += ' '; }

test('behavior audio directory reads only the current scene and returns a source-bound immutable track directory', async () => {
  const h = fixture(), source = await h.host.getSource(), directory = await h.host.getAudioTracks(source);
  assert.equal(h.host.getContext().audioTracksAvailable, true); assert.equal(isSceneBehaviorAudioTracks(directory), true);
  assert.equal(sceneBehaviorAudioTracksMatchSource(directory, source), true); assert.equal(directory.status, 'ready');
  assert.deepEqual(directory.tracks, [{ trackId: id(1), resourceId: id(2), role: 'music' }, { trackId: id(3), resourceId: id(2), role: 'effect' }]);
  assert.ok(Object.isFrozen(directory.tracks[0])); assert.deepEqual(h.requests, [{ sceneObjectId: sceneId }]);
  assert.deepEqual(h.reviews, [{ sourcePath: source.sourcePath, content: original }]); assert.deepEqual(h.writes, []);
  assert.equal(h.state.baseline, original); assert.equal(h.state.version, revision(original));
});
test('a scene without an audio opt-in returns an explicit empty catalog without changing the draft', async () => {
  const h = fixture(); h.raw.status = 'empty'; h.raw.manifest = null;
  const directory = await h.host.getAudioTracks(await h.host.getSource());
  assert.equal(directory.status, 'empty'); assert.deepEqual(directory.tracks, []); assert.equal(directory.manifest, null); assert.deepEqual(h.writes, []);
});
test('audio directory read refuses every owner change after both digest and both service boundaries', { timeout: 10000 }, async () => {
  const keys = ['document','token','sourcePath','content','baseline','version','editable','creating','busy','available','sourceJSON','audioTracksAvailable'];
  for (const boundary of [1, 2, 'review', 'directory']) for (const key of keys) {
    const h = fixture(), source = await h.host.getSource(), g = typeof boundary === 'number' ? h.blockDigest(boundary) : gate();
    if (boundary === 'review') h.beforeReview = g.wait; if (boundary === 'directory') h.beforeDirectory = g.wait;
    const pending = h.host.getAudioTracks(source); await g.entered; mutate(h, key); g.release();
    await assert.rejects(pending, conflict); assert.deepEqual(h.writes, [], `${boundary}:${key}`);
  }
});
test('requested source data is captured before awaits without invoking caller accessors', async () => {
  const h = fixture(), source = await h.host.getSource(); let reads = 0;
  const accessor = { ...source }; Object.defineProperty(accessor, 'content', { enumerable: true, get() { reads++; return source.content; } });
  for (const candidate of [accessor, { ...source, token: 'other' }, { ...source, sourcePath: 'documents/other.json' }, { ...source, extra: true }, null]) {
    await assert.rejects(h.host.getAudioTracks(candidate), conflict);
  }
  assert.equal(reads, 0); assert.equal(h.reviews.length, 0); assert.equal(h.requests.length, 0);
  const mutable = { ...source }, g = h.blockDigest(1), pending = h.host.getAudioTracks(mutable);
  await g.entered; mutable.content = 'changed by caller'; mutable.token = 'another'; g.release();
  assert.equal(sceneBehaviorAudioTracksMatchSource(await pending, source), true);
});
test('changed and malformed behavior dependency reviews never request the audio directory', async () => {
  for (const change of [r => r.format = 'wrong', r => r.schemaVersion = 2, r => r.sourcePath += '.other', r => r.dependencyRevision = '', r => r.scene.objectId = id(8)]) {
    const h = fixture(); change(h.review);
    await assert.rejects(h.host.getAudioTracks(await h.host.getSource()), conflict); assert.equal(h.requests.length, 0); assert.deepEqual(h.writes, []);
  }
});
test('audio directory must match all three scene dependency fields captured by behavior review', async () => {
  for (const change of [r => r.scene.objectId = id(8), r => r.scene.sourcePath += '.other', r => r.scene.sourceRevision = revision('new scene')]) {
    const h = fixture(); change(h.raw);
    await assert.rejects(h.host.getAudioTracks(await h.host.getSource()), rejected); assert.deepEqual(h.writes, []);
  }
});
test('service failures and a stale requested source never supply a reusable directory', async () => {
  for (const boundary of ['beforeReview', 'beforeDirectory']) {
    const h = fixture(); h[boundary] = () => { throw Object.assign(new Error('offline'), { errorCode: 'scene_audio_directory_unavailable' }); };
    await assert.rejects(h.host.getAudioTracks(await h.host.getSource()), rejected); assert.deepEqual(h.writes, []);
  }
  const h = fixture(), source = await h.host.getSource(); h.state.content += '\n';
  await assert.rejects(h.host.getAudioTracks(source), conflict); assert.equal(h.requests.length, 0); assert.equal(h.reviews.length, 0);
});
test('optional capability is advertised only for explicit true with both read ports', async () => {
  for (const options of [{ audioTracksAvailable: false }, { audioTracksAvailable: undefined }, { audioTracksAvailable: 'yes' }, { audioTracksAvailable: 1 }, { noDirectory: true }, { noInspect: true }]) {
    const h = fixture(options); if (Object.hasOwn(options, 'audioTracksAvailable')) h.state.audioTracksAvailable = options.audioTracksAvailable;
    assert.equal(h.host.getContext().audioTracksAvailable, false);
    await assert.rejects(h.host.getAudioTracks(await h.host.getSource()), conflict); assert.equal(h.requests.length, 0); assert.equal(h.reviews.length, 0);
  }
});
test('old services still support ordinary behavior edits without an audio read port', async () => {
  for (const options of [{ audioTracksAvailable: false }, { noDirectory: true }]) {
    const h = fixture(options), source = await h.host.getSource(), model = JSON.parse(source.content); model.bindings[0].parameters.amount = 65;
    const result = await h.host.applyDraft(createSceneBehaviorProposal(source, { bindings: model.bindings }), { dependencyRevision });
    assert.equal(result.applied, true); assert.equal(h.writes.length, 1); assert.equal(h.requests.length, 0);
    assert.equal(JSON.parse(result.content).bindings[0].parameters.amount, 65); assert.equal(h.state.baseline, original);
  }
});
test('an unsaved behavior draft can read audio tracks and selected values use the existing string proposal path', async () => {
  const h = fixture(); h.state.content = original.replace('"amount": 40', '"amount": 41');
  const source = await h.host.getSource(), directory = await h.host.getAudioTracks(source), model = JSON.parse(source.content);
  // No parameter-name convention is involved: this is an explicit string edit.
  model.bindings[0].parameters.user_selected_value = directory.tracks[1].trackId;
  const proposal = createSceneBehaviorProposal(source, { bindings: model.bindings });
  h.beforeDirectory = () => assert.fail('ordinary behavior apply must not inspect audio dependencies');
  const result = await h.host.applyDraft(proposal, { dependencyRevision });
  assert.equal(result.applied, true); assert.equal(h.requests.length, 1); assert.equal(h.reviews.length, 2);
  const changed = JSON.parse(result.content); assert.equal(changed.bindings[0].parameters.amount, 41);
  assert.equal(changed.bindings[0].parameters.user_selected_value, id(3)); assert.equal(h.state.baseline, original); assert.equal(h.state.version, revision(original));
  await assert.rejects(h.host.getAudioTracks(source), conflict);
});
test('observed optional capability disappearance and return rejects pending directories without changing the ordinary source', async () => {
  for (const boundary of [1, 2, 'review', 'directory']) {
    const h = fixture(), source = await h.host.getSource(), g = typeof boundary === 'number' ? h.blockDigest(boundary) : gate();
    if (boundary === 'review') h.beforeReview = g.wait; if (boundary === 'directory') h.beforeDirectory = g.wait;
    const pending = h.host.getAudioTracks(source); await g.entered;
    h.state.audioTracksAvailable = false; assert.equal(h.host.getContext().sourceToken, source.token);
    h.state.audioTracksAvailable = true; assert.equal(h.host.getContext().sourceToken, source.token);
    g.release(); await assert.rejects(pending, conflict); assert.deepEqual(h.writes, []);
    assert.equal((await h.host.getSource()).token, source.token);
    assert.equal(sceneBehaviorAudioTracksMatchSource(await h.host.getAudioTracks(source), source), true);
  }
});
test('optional audio capability withdrawal leaves reviewed ordinary proposals applicable before and during each apply boundary', async () => {
  for (const boundary of ['before', 1, 2, 3, 'review']) {
    const h = fixture(), source = await h.host.getSource(), model = JSON.parse(source.content);
    model.bindings[0].parameters.amount = 65;
    const proposal = createSceneBehaviorProposal(source, { bindings: model.bindings });
    const withdraw = () => { h.state.audioTracksAvailable = false; assert.equal(h.host.getContext().sourceToken, source.token); };
    if (boundary === 'before') withdraw();
    else if (boundary === 'review') h.beforeReview = withdraw;
    else { const target = h.digests + boundary; h.beforeDigest = count => { if (count === target) withdraw(); }; }
    const result = await h.host.applyDraft(proposal, { dependencyRevision });
    assert.equal(result.applied, true); assert.equal(h.writes.length, 1); assert.equal(h.requests.length, 0);
    assert.equal(JSON.parse(result.content).bindings[0].parameters.amount, 65); assert.equal(h.state.baseline, original);
    assert.equal(h.host.getContext().audioTracksAvailable, false);
  }
});
