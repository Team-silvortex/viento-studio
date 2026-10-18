import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { createSceneAudioSourceHost } from '../../web/modules/app-scene-audio-source.js';
import { createSceneAudioProposal } from '../../engine/scene-audio-edit.mjs';
import { isSceneAudioUsage, sceneAudioUsageMatchSource } from '../../engine/scene-audio-usage.mjs';
const original = await fs.readFile(new URL('../../examples/scene-audio/documents/audio/demo.json', import.meta.url), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex'), revision = value => 'sha256:' + hash(value);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const edit = model => ({ tracks: model.tracks.map(({id,role,volume,loop})=>({id,role,volume,loop})), cues: model.cues.map(({id,atSeconds,action})=>({id,atSeconds,action})) });
const conflict = { errorCode: 'scene_audio_authoring_conflict' };
const rejected = error => /^(scene_audio_)/.test(error.errorCode || '');
function gate() { let enter, release; const entered = new Promise(r => { enter = r; }), waiting = new Promise(r => { release = r; }); return { entered, release, wait: async () => { enter(); await waiting; } }; }
function fixture({ usageAvailable = true, noPort = false } = {}) {
  const state = { document: {}, token: 'usage-test', sourcePath: 'documents/audio/demo.json', content: original, baseline: original,
    version: revision(original), editable: true, creating: false, busy: false, available: true, sourceJSON: true, resourcesAvailable: false, usageAvailable };
  const raw = { format: 'viento-scene-audio-usage', schemaVersion: 1, worldId: 'world:' + hash('world'), revision: revision('world'),
    scene: { objectId: JSON.parse(original).sceneObjectId, sourcePath: 'documents/scenes/demo.json', sourceRevision: revision('scene') },
    audio: { objectId: id(1), sourcePath: state.sourcePath, sourceRevision: revision(original), content: original }, behavior: null };
  const h = { state, raw, writes: [], digests: 0, requests: [] };
  h.host = createSceneAudioSourceHost({ getState: () => ({ ...state }),
    digest: async value => { await h.beforeDigest?.(++h.digests); return hash(value); },
    ...(noPort ? {} : { inspectUsage: async input => { h.requests.push(input); await h.beforeUsage?.(); return structuredClone(h.raw); } }),
    writeDraft: content => { h.writes.push(content); state.content = content; } });
  h.blockDigest = offset => { const g = gate(), target = h.digests + offset; h.beforeDigest = count => count === target ? g.wait() : undefined; return g; };
  return h;
}
function mutate(h, key) {
  const old = h.state[key];
  h.state[key] = typeof old === 'boolean' ? !old : key === 'document' ? {} : String(old) + 'changed';
}
test('usage read authenticates saved bytes, binds to the source and never writes or requests audio resources', async () => {
  const h = fixture(), source = await h.host.getSource(), usage = await h.host.getUsage(source);
  assert.equal(isSceneAudioUsage(usage), true); assert.equal(sceneAudioUsageMatchSource(usage, source), true);
  assert.equal(usage.behavior, null); assert.deepEqual(usage.matches, []);
  assert.equal(usage.savedContent, original); assert.equal(h.host.getContext().usageAvailable, true);
  assert.equal(h.host.getContext().resourcesAvailable, false); assert.equal(h.host.getContext().auditionAvailable, false);
  assert.deepEqual(h.requests, [{ sceneObjectId: JSON.parse(original).sceneObjectId }]); assert.deepEqual(h.writes, []);
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
  assert.equal(sceneAudioUsageMatchSource(await pending, source), true);
});
test('saved audio changes and dishonest revision claims cannot return matches', async () => {
  for (const change of [r => r.audio.sourceRevision = revision('other'), r => r.audio.content = original + '\n', r => r.audio.sourcePath = 'documents/audio/other.json', r => r.scene.objectId = id(8)]) {
    const h = fixture(); change(h.raw); await assert.rejects(h.host.getUsage(await h.host.getSource()), rejected); assert.deepEqual(h.writes, []);
  }
});
test('an unsaved ordinary audio draft can read saved behavior matches while preserving its baseline', async () => {
  const h = fixture(); h.state.content = original.replace('"volume": 0.3', '"volume": 0.4'); assert.notEqual(h.state.content, original);
  const source = await h.host.getSource(), usage = await h.host.getUsage(source);
  assert.equal(sceneAudioUsageMatchSource(usage, source), true); assert.equal(usage.savedContent, original);
  assert.equal(h.state.content, source.content); assert.equal(h.state.baseline, original); assert.deepEqual(h.writes, []);
});
test('unavailable or old hosts preserve ordinary leaf editing without calling the optional usage service', async () => {
  for (const options of [{ usageAvailable: false }, { noPort: true }, { usageAvailable: 'true' }, { usageAvailable: 1 }, { usageAvailable: null }]) {
    const h = fixture(options), source = await h.host.getSource(), model = JSON.parse(source.content); model.tracks[0].volume = .45;
    assert.equal(h.host.getContext().usageAvailable, false); await assert.rejects(h.host.getUsage(source), conflict);
    const applied = await h.host.applyDraft(await createSceneAudioProposal(source, edit(model)));
    assert.equal(applied.applied, true); assert.equal(JSON.parse(applied.content).tracks[0].volume, .45); assert.equal(h.requests.length, 0);
  }
});
test('a usage failure leaves a reviewed ordinary proposal applicable', async () => {
  const h = fixture(), source = await h.host.getSource(), model = JSON.parse(source.content); model.tracks[0].volume = .45;
  const proposal = await createSceneAudioProposal(source, edit(model));
  h.beforeUsage = () => { throw Object.assign(new Error('unavailable'), { errorCode: 'scene_audio_usage_unavailable' }); };
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
    assert.equal(sceneAudioUsageMatchSource(await h.host.getUsage(source), source), true); assert.deepEqual(h.writes, []);
  }
});
test('optional usage withdrawal cannot invalidate reviewed ordinary apply at any digest boundary', async () => {
  for (const boundary of [0, 1, 2, 3]) {
    const h = fixture(), source = await h.host.getSource(), model = JSON.parse(source.content); model.tracks[0].volume = .45;
    const proposal = await createSceneAudioProposal(source, edit(model));
    const withdraw = () => { h.state.usageAvailable = false; assert.equal(h.host.getContext().sourceToken, source.token); };
    if (boundary === 0) withdraw(); else { const target = h.digests + boundary; h.beforeDigest = count => { if (count === target) withdraw(); }; }
    assert.equal((await h.host.applyDraft(proposal)).applied, true); assert.equal(h.writes.length, 1); assert.equal(h.requests.length, 0);
  }
});
