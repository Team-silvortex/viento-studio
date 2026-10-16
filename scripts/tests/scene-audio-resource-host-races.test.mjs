import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { createSceneAudioSourceHost } from '../../web/modules/app-scene-audio-source.js';
import { createSceneAudioProposal, createSceneAudioCueProposal, createSceneAudioTimelineProposal,
  createSceneAudioTrackProposal, createSceneAudioResourceProposal } from '../../engine/scene-audio-edit.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = text => createHash('sha256').update(text).digest('hex');
const rev = text => 'sha256:' + hash(text);
const model = () => ({ format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: id(1),
  tracks: [{ id: id(2), resourceId: id(3), role: 'music', volume: .5, loop: false }],
  cues: [{ id: id(6), trackId: id(2), atSeconds: 0, action: 'play' }] });
const original = JSON.stringify(model(), null, 2) + '\n';
const conflict = { errorCode: 'scene_audio_authoring_conflict' };
const ownerKeys = ['document', 'token', 'sourcePath', 'content', 'baseline', 'version', 'editable', 'creating', 'busy', 'available', 'sourceJSON', 'resourcesAvailable'];
function gate() {
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), waiting = new Promise(resolve => { release = resolve; });
  return { entered, release, wait: async () => { enter(); await waiting; } };
}
function fixture({ resourcesAvailable = true, noInspect = false } = {}) {
  const state = { document: {}, token: 'host:1', sourcePath: 'documents/audio/demo.json', content: original,
    baseline: original, version: rev(original), editable: true, creating: false, busy: false, available: true, sourceJSON: true, resourcesAvailable };
  const raw = { format: 'viento-audio-creation-context', schemaVersion: 1, status: 'ready', worldId: 'world:' + hash('world'),
    baseRevision: rev('world-state'), documentRoot: 'documents', documentTypes: [{ id: 'audio', label: 'Audio' }],
    scene: { objectId: id(1), objectRevision: rev('scene'), sourcePath: 'documents/scenes/demo.json', sourceRevision: rev('scene-content') },
    manifest: { objectId: id(8), objectRevision: rev('audio-object'), sourcePath: state.sourcePath, sourceRevision: rev(original),
      documentType: 'audio', parserProfile: 'structured', content: original, trackCount: 1,
      relations: [{ kind: 'reference', targetId: id(1), slot: '' }], assetBindings: [3, 4].map(n => ({ assetId: id(n), role: 'audio' })) },
    resources: [3, 4].map(n => ({ resourceId: id(n), resourceRevision: rev('resource-' + n), name: 'Tone ' + n,
      sourcePath: `tone-${n}.wav`, sha256: hash('wave-' + n), size: 512, availability: 'unverified' })) };
  const h = { state, raw, writes: [], digestCount: 0, inspectionCount: 0, focusCount: 0 };
  h.host = createSceneAudioSourceHost({ getState: () => ({ ...state }),
    digest: async text => { const count = ++h.digestCount; await h.beforeDigest?.(count); return h.digestResult?.(text, count) ?? hash(text); },
    ...(noInspect ? {} : { inspect: async () => { h.inspectionCount++; await h.beforeInspect?.(); return structuredClone(h.raw); } }),
    writeDraft: text => { h.writes.push(text); state.content = text; state.token += ':draft'; }, focus: () => { h.focusCount++; } });
  h.proposal = async () => {
    const source = await h.host.getSource(), resources = await h.host.getResources(source), { tracks, cues } = model();
    tracks[0].resourceId = id(4);
    return createSceneAudioResourceProposal(source, { tracks, cues }, resources);
  };
  h.blockDigest = offset => { const g = gate(), target = h.digestCount + offset; h.beforeDigest = async count => { if (count === target) await g.wait(); }; return g; };
  return h;
}
function mutate(h, key) {
  if (key === 'document') h.state.document = {};
  else if (typeof h.state[key] === 'boolean') h.state[key] = !h.state[key];
  else h.state[key] += ' ';
}

test('resource apply refuses all twelve owner changes at each of its five digest boundaries', { timeout: 10000 }, async () => {
  for (const offset of [1, 2, 3, 4, 5]) for (const key of ownerKeys) {
    const h = fixture(), p = await h.proposal(), g = h.blockDigest(offset);
    const pending = h.host.applyDraft(p); await g.entered; mutate(h, key); g.release();
    await assert.rejects(pending, conflict); assert.deepEqual(h.writes, [], `${offset}:${key}`);
  }
});
test('resource apply checks caller cancellation after all five digest boundaries', { timeout: 5000 }, async () => {
  for (const offset of [1, 2, 3, 4, 5]) {
    const h = fixture(), p = await h.proposal(), g = h.blockDigest(offset); let isCurrent = true;
    const pending = h.host.applyDraft(p, { isCurrent: () => isCurrent }); await g.entered; isCurrent = false; g.release();
    await assert.rejects(pending, conflict); assert.deepEqual(h.writes, [], String(offset));
  }
});
test('resource apply rejects false digests at each hash without writing', async () => {
  for (const offset of [1, 2, 3, 4, 5]) {
    const h = fixture(), p = await h.proposal(), target = h.digestCount + offset;
    h.digestResult = (text, count) => hash(count === target ? 'wrong' : text);
    await assert.rejects(h.host.applyDraft(p), conflict); assert.deepEqual(h.writes, [], String(offset));
  }
});
test('resource acquisition refuses owner changes across all three hashes and readonly inspection', { timeout: 10000 }, async () => {
  for (const boundary of [1, 2, 3, 'inspect']) for (const key of ownerKeys) {
    const h = fixture(), source = await h.host.getSource(), g = boundary === 'inspect' ? gate() : h.blockDigest(boundary);
    if (boundary === 'inspect') h.beforeInspect = g.wait;
    const pending = h.host.getResources(source); await g.entered; mutate(h, key); g.release();
    await assert.rejects(pending, conflict); assert.deepEqual(h.writes, [], `${boundary}:${key}`);
  }
});
test('all four existing proposal APIs still work without the optional resource API', async () => {
  for (const options of [{ resourcesAvailable: false }, { resourcesAvailable: true, noInspect: true }]) {
    for (const factory of [createSceneAudioProposal, createSceneAudioCueProposal, createSceneAudioTimelineProposal, createSceneAudioTrackProposal]) {
      const h = fixture(options), source = await h.host.getSource(), { tracks, cues } = model(); tracks[0].volume = .25;
      const rows = { tracks: factory === createSceneAudioTrackProposal ? tracks : tracks.map(({ id, role, volume, loop }) => ({ id, role, volume, loop })),
        cues: factory === createSceneAudioProposal ? cues.map(({ id, atSeconds, action }) => ({ id, atSeconds, action })) : cues };
      assert.equal(h.host.getContext().resourcesAvailable, false);
      await assert.rejects(h.host.getResources(source), conflict); assert.equal(h.inspectionCount, 0);
      const result = await h.host.applyDraft(await factory(source, rows));
      assert.equal(result.applied, true); assert.equal(h.writes.length, 1); assert.equal(h.inspectionCount, 0);
      assert.equal(JSON.parse(result.content).tracks[0].volume, .25);
    }
  }
});
test('successful resource apply uses five digests and one fresh inspection then denies stale replay and focus', async () => {
  const h = fixture(), p = await h.proposal(), beforeDigests = h.digestCount, beforeInspections = h.inspectionCount;
  const result = await h.host.applyDraft(p);
  assert.equal(h.digestCount - beforeDigests, 5); assert.equal(h.inspectionCount - beforeInspections, 1);
  assert.equal(result.applied, true); assert.equal(h.writes.length, 1); assert.equal(h.state.baseline, original);
  result.focus(); assert.equal(h.focusCount, 1);
  await assert.rejects(h.host.applyDraft(p), conflict); assert.equal(h.writes.length, 1);
  h.state.content = original; result.focus(); assert.equal(h.focusCount, 1);
  await assert.rejects(h.host.applyDraft(p), conflict); assert.equal(h.writes.length, 1);
});
