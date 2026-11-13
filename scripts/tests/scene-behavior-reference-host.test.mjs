import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { createSceneBehaviorSourceHost } from '../../web/modules/app-behavior-source.js';
import { createSceneBehaviorProposal } from '../../engine/scene-behaviors-edit.mjs';
import { isSceneBehaviorReferences, sceneBehaviorReferencesMatchSource, sceneBehaviorReferenceValue } from '../../engine/scene-behavior-reference-directory.mjs';

const original = await fs.readFile(new URL('../../examples/scene-behaviors/documents/behaviors/demo.json', import.meta.url), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex'), revision = value => 'sha256:' + hash(value);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const model = JSON.parse(original), sceneId = model.sceneObjectId, assemblyId = id(20), otherAssemblyId = id(21), dependencyRevision = revision('ordinary behavior dependencies');
const conflict = { errorCode: 'scene_behavior_authoring_conflict' };
const rejected = error => /^scene_behavior_/.test(error.errorCode || '');
function gate() { let enter, release; const entered = new Promise(r => { enter = r; }), waiting = new Promise(r => { release = r; }); return { entered, release, wait: async () => { enter(); await waiting; } }; }
function fixture(options = {}) {
  const state = { document: {}, token: 'reference-picker', sourcePath: 'documents/behaviors/demo.json', content: original,
    baseline: original, version: revision(original), editable: true, creating: false, busy: false, available: true, sourceJSON: true,
    referencesAvailable: true, audioTracksAvailable: true, animationClipsAvailable: true, ...options.state };
  const scene = { objectId: sceneId, sourcePath: 'documents/scenes/demo.json', sourceRevision: revision('saved scene') };
  const assemblies = [assemblyId, otherAssemblyId].map((objectId, index) => ({ objectId, name: '同名 / Project', sourcePath: `documents/projects/${index}.json`, sourceRevision: revision('assembly ' + index) }));
  const instances = model.bindings.map(binding => ({ instanceId: binding.instanceId, objectId: id(2), name: 'Shared definition',
    sourcePath: 'documents/characters/shared.md', sourceRevision: revision('shared definition') }));
  const raw = { format: 'viento-scene-behavior-reference-directory', schemaVersion: 1, worldId: 'world:' + hash('world'), revision: revision('world'),
    scene, instances, assemblies, selectedAssembly: null };
  const review = { format: 'viento-behavior-authoring-context', schemaVersion: 1, sourcePath: state.sourcePath,
    scene: { ...scene, instances: instances.map(({ instanceId, objectId, name }) => ({ instanceId, objectId, name })) }, dependencyRevision };
  const audio = JSON.stringify({ format: 'viento-scene-audio', schemaVersion: 1, sceneObjectId: sceneId,
    tracks: [{ id: id(80), resourceId: id(81), role: 'effect', volume: .8, loop: false }], cues: [] });
  const audioRaw = { format: 'viento-scene-audio-directory', schemaVersion: 1, status: 'ready', worldId: raw.worldId, revision: raw.revision,
    scene, manifest: { objectId: id(82), sourcePath: 'documents/audio/demo.json', sourceRevision: revision(audio), content: audio } };
  const h = { state, scene, raw, review, writes: [], digests: 0, reviews: [], requests: [], audioRequests: [] };
  h.select = (selected = assemblyId) => {
    h.raw.selectedAssembly = selected === null ? null : { ...assemblies.find(row => row.objectId === selected),
      members: [{ ...scene, name: 'Current scene' }, { objectId: id(30), name: 'Next scene', sourcePath: 'documents/scenes/next.json', sourceRevision: revision('next scene') }],
      inputMap: { objectId: id(40), sourcePath: 'documents/input/keyboard.json', sourceRevision: revision('input map') },
      actions: [{ name: 'start_retry', keys: ['Enter', 'Space'] }, { name: 'move', keys: ['ArrowLeft', 'ArrowRight'] }] };
  };
  h.host = createSceneBehaviorSourceHost({ getState: () => ({ ...state }), digest: async value => { await h.beforeDigest?.(++h.digests); return hash(value); },
    ...(options.noInspect ? {} : { inspect: async value => { h.reviews.push(value); await h.beforeReview?.(); return structuredClone(h.review); } }),
    ...(options.noDirectory ? {} : { inspectReferenceDirectory: async value => { h.requests.push(value); await h.beforeDirectory?.(); return structuredClone(h.raw); } }),
    inspectAudioDirectory: async value => { h.audioRequests.push(value); await h.beforeAudioDirectory?.(); return structuredClone(audioRaw); },
    writeDraft: value => { h.writes.push(value); state.content = value; } });
  h.blockDigest = offset => { const g = gate(), target = h.digests + offset; h.beforeDigest = async count => { if (count === target) await g.wait(); }; return g; };
  return h;
}
const read = async (h, assemblyObjectId = null) => h.host.getReferences(await h.host.getSource(), { assemblyObjectId });
function mutate(h, key) { if (key === 'document') h.state.document = {}; else if (typeof h.state[key] === 'boolean') h.state[key] = !h.state[key]; else h.state[key] += ' '; }

test('reference reads preserve distinct local instances and never silently choose an available assembly', async () => {
  const h = fixture(), source = await h.host.getSource(), value = await h.host.getReferences(source, { assemblyObjectId: null });
  assert.equal(h.host.getContext().referencesAvailable, true); assert.equal(isSceneBehaviorReferences(value), true);
  assert.equal(sceneBehaviorReferencesMatchSource(value, source), true); assert.equal(value.selectedAssembly, null);
  assert.equal(value.assemblies.length, 2); assert.deepEqual(value.instances.map(row => row.instanceId), model.bindings.map(row => row.instanceId));
  assert.equal(value.instances[0].objectId, value.instances[1].objectId); assert.ok(Object.isFrozen(value.instances[0]));
  assert.deepEqual(h.requests, [{ sceneObjectId: sceneId, assemblyObjectId: null }]);
  assert.deepEqual(h.reviews, [{ sourcePath: source.sourcePath, content: original }]); assert.deepEqual(h.writes, []);
  assert.equal(h.state.baseline, original); assert.equal(h.state.version, revision(original));
});

test('only an explicitly requested assembly supplies member IDs and saved custom actions', async () => {
  const h = fixture(); h.select(); const value = await read(h, assemblyId);
  assert.equal(value.selectedAssembly.objectId, assemblyId); assert.deepEqual(value.selectedAssembly.actions.map(row => row.name), ['start_retry', 'move']);
  assert.equal(sceneBehaviorReferenceValue(value, { kind: 'scene', value: id(30) }), id(30));
  assert.equal(sceneBehaviorReferenceValue(value, { kind: 'action', value: 'start_retry' }), 'start_retry');
  assert.equal(sceneBehaviorReferenceValue(value, { kind: 'instance', value: model.bindings[1].instanceId }), model.bindings[1].instanceId);
  assert.equal(sceneBehaviorReferenceValue(value, { kind: 'action', value: 'ui_accept' }), null);
  assert.deepEqual(h.requests, [{ sceneObjectId: sceneId, assemblyObjectId: assemblyId }]); assert.deepEqual(h.writes, []);
});

test('no containing assembly leaves a useful immutable local instance directory', async () => {
  const h = fixture(); h.raw.assemblies = [];
  const value = await read(h); assert.deepEqual(value.assemblies, []); assert.equal(value.selectedAssembly, null);
  assert.equal(value.instances.length, 2); assert.deepEqual(h.writes, []);
});

test('reference reads reject every source owner change after both digests and both service boundaries', { timeout: 10000 }, async () => {
  for (const boundary of [1, 2, 'review', 'directory']) for (const key of ['document','token','sourcePath','content','baseline','version','editable','creating','busy','available','sourceJSON','referencesAvailable']) {
    const h = fixture(), source = await h.host.getSource(), g = typeof boundary === 'number' ? h.blockDigest(boundary) : gate();
    if (boundary === 'review') h.beforeReview = g.wait; if (boundary === 'directory') h.beforeDirectory = g.wait;
    const pending = h.host.getReferences(source, { assemblyObjectId: null }); await g.entered; mutate(h, key); g.release();
    await assert.rejects(pending, conflict); assert.deepEqual(h.writes, [], `${boundary}:${key}`);
  }
});

test('requested source fields are data-only and captured synchronously without invoking accessors', async () => {
  const h = fixture(), source = await h.host.getSource(); let getters = 0;
  const accessor = { ...source }; Object.defineProperty(accessor, 'content', { enumerable: true, get() { getters++; return source.content; } });
  for (const input of [accessor, Object.create(source), Object.assign(Object.create({ inherited: true }), source), { ...source, [Symbol('extra')]: true }, { ...source, token: 'stale' }, { ...source, sourcePath: 'documents/other.json' }, { ...source, extra: true }, null]) {
    await assert.rejects(h.host.getReferences(input, { assemblyObjectId: null }), conflict);
  }
  assert.equal(getters, 0); assert.equal(h.reviews.length, 0); assert.equal(h.requests.length, 0);
  const caller = { ...source }, g = h.blockDigest(1), pending = h.host.getReferences(caller, { assemblyObjectId: null });
  await g.entered; caller.content = '{}'; caller.token = 'new'; g.release();
  assert.equal(sceneBehaviorReferencesMatchSource(await pending, source), true); assert.deepEqual(h.writes, []);
});

test('assembly selection rejects accessors and unknown fields before reading and cannot be retargeted during await', async () => {
  const h = fixture(), source = await h.host.getSource(); let getters = 0;
  const accessor = {}; Object.defineProperty(accessor, 'assemblyObjectId', { enumerable: true, get() { getters++; return assemblyId; } });
  const inherited = Object.create({ assemblyObjectId: assemblyId });
  for (const selection of [accessor, inherited, Object.assign(Object.create({ inherited: true }), { assemblyObjectId: assemblyId }), { assemblyObjectId: assemblyId, [Symbol('extra')]: true }, {}, { assemblyObjectId: assemblyId, extra: true }, { assemblyObjectId: 'bad' }, { assemblyObjectId: 42 }, null, []]) {
    await assert.rejects(h.host.getReferences(source, selection), conflict);
  }
  assert.equal(getters, 0); assert.equal(h.reviews.length, 0); assert.equal(h.requests.length, 0);
  h.select(); const selection = { assemblyObjectId: assemblyId }, g = h.blockDigest(1), pending = h.host.getReferences(source, selection);
  await g.entered; selection.assemblyObjectId = otherAssemblyId; g.release();
  assert.equal((await pending).selectedAssembly.objectId, assemblyId);
  assert.deepEqual(h.requests, [{ sceneObjectId: sceneId, assemblyObjectId: assemblyId }]);
});

test('malformed or changed ordinary behavior review cannot reach the reference provider', async () => {
  for (const change of [r => r.format = 'wrong', r => r.schemaVersion = 2, r => r.sourcePath += '.other', r => r.dependencyRevision = '', r => r.scene.objectId = id(90)]) {
    const h = fixture(); change(h.review); await assert.rejects(read(h), conflict);
    assert.equal(h.requests.length, 0); assert.deepEqual(h.writes, []);
  }
});

test('reference directory must match the reviewed scene identity path and revision', async () => {
  for (const change of [r => r.scene.objectId = id(90), r => r.scene.sourcePath += '.other', r => r.scene.sourceRevision = revision('new scene')]) {
    const h = fixture(); change(h.raw); await assert.rejects(read(h), rejected); assert.deepEqual(h.writes, []);
  }
});

test('a valid directory for another assembly cannot answer the requested selection', async () => {
  for (const [requested, returned] of [[null, assemblyId], [assemblyId, null], [assemblyId, otherAssemblyId]]) {
    const h = fixture(); h.select(returned); await assert.rejects(read(h, requested), rejected); assert.deepEqual(h.writes, []);
  }
});

test('provider errors malformed catalogs and stale source snapshots never yield reusable references', async () => {
  for (const boundary of ['beforeReview', 'beforeDirectory']) {
    const h = fixture(); h[boundary] = () => { throw Object.assign(new Error('unavailable'), { errorCode: 'scene_behavior_reference_directory_unavailable' }); };
    await assert.rejects(read(h), rejected); assert.deepEqual(h.writes, []);
  }
  for (const change of [r => r.format = 'wrong', r => r.schemaVersion = 2, r => r.instances.push({ ...r.instances[0] })]) {
    const h = fixture(); change(h.raw); await assert.rejects(read(h), rejected); assert.deepEqual(h.writes, []);
  }
  const h = fixture(), source = await h.host.getSource(); h.state.content += '\n';
  await assert.rejects(h.host.getReferences(source, { assemblyObjectId: null }), conflict);
  assert.equal(h.reviews.length, 0); assert.equal(h.requests.length, 0); assert.deepEqual(h.writes, []);
});

test('reference capability requires explicit true and both ports without blocking ordinary old-service edits', async () => {
  for (const options of [{ state: { referencesAvailable: false } }, { state: { referencesAvailable: undefined } }, { state: { referencesAvailable: 'true' } }, { state: { referencesAvailable: 1 } }, { noDirectory: true }, { noInspect: true }]) {
    const h = fixture(options); assert.equal(h.host.getContext().referencesAvailable, false);
    await assert.rejects(read(h), conflict); assert.equal(h.requests.length, 0); assert.equal(h.reviews.length, 0);
    if (!options.noInspect) {
      const source = await h.host.getSource(), edited = JSON.parse(source.content); edited.bindings[0].parameters.amount = 65;
      await h.host.applyDraft(createSceneBehaviorProposal(source, { bindings: edited.bindings }), { dependencyRevision });
      assert.equal(h.writes.length, 1); assert.equal(JSON.parse(h.state.content).bindings[0].parameters.amount, 65); assert.equal(h.state.baseline, original);
    }
  }
});

test('observed reference capability withdrawal and return permanently revokes each pending read only', async () => {
  for (const boundary of [1, 2, 'review', 'directory']) {
    const h = fixture(), source = await h.host.getSource(), g = typeof boundary === 'number' ? h.blockDigest(boundary) : gate();
    if (boundary === 'review') h.beforeReview = g.wait; if (boundary === 'directory') h.beforeDirectory = g.wait;
    const pending = h.host.getReferences(source, { assemblyObjectId: null }); await g.entered;
    h.state.referencesAvailable = false; assert.equal(h.host.getContext().sourceToken, source.token);
    h.state.referencesAvailable = true; assert.equal(h.host.getContext().sourceToken, source.token); g.release();
    await assert.rejects(pending, conflict); assert.deepEqual(h.writes, []);
    assert.equal((await h.host.getSource()).token, source.token); assert.equal(sceneBehaviorReferencesMatchSource(await h.host.getReferences(source, { assemblyObjectId: null }), source), true);
  }
});

test('reference withdrawal keeps reviewed ordinary proposals applicable at every existing apply boundary', async () => {
  for (const boundary of ['before', 1, 2, 3, 'review']) {
    const h = fixture(), source = await h.host.getSource(), edited = JSON.parse(source.content); edited.bindings[0].parameters.amount = 65;
    const proposal = createSceneBehaviorProposal(source, { bindings: edited.bindings });
    const withdraw = () => { h.state.referencesAvailable = false; assert.equal(h.host.getContext().sourceToken, source.token); };
    if (boundary === 'before') withdraw(); else if (boundary === 'review') h.beforeReview = withdraw;
    else { const target = h.digests + boundary; h.beforeDigest = count => { if (count === target) withdraw(); }; }
    const result = await h.host.applyDraft(proposal, { dependencyRevision }); assert.equal(result.applied, true);
    assert.equal(h.writes.length, 1); assert.equal(h.requests.length, 0); assert.equal(h.state.baseline, original); assert.equal(h.state.version, revision(original));
  }
});

test('reference and audio availability generations cannot revoke the other independent read', async () => {
  const h = fixture(), source = await h.host.getSource();
  h.beforeDirectory = () => { h.state.audioTracksAvailable = false; h.state.animationClipsAvailable = false; h.host.getContext(); };
  assert.equal(sceneBehaviorReferencesMatchSource(await h.host.getReferences(source, { assemblyObjectId: null }), source), true);
  h.state.audioTracksAvailable = true; h.host.getContext();
  h.beforeAudioDirectory = () => { h.state.referencesAvailable = false; h.host.getContext(); };
  assert.equal((await h.host.getAudioTracks(source)).tracks[0].trackId, id(80)); assert.deepEqual(h.writes, []);
});

test('unsaved parameters remain exact while selected values use the existing ordinary string proposal path', async () => {
  const h = fixture(); h.state.content = original.replace('"amount": 40', '"amount": 41'); h.select();
  const source = await h.host.getSource(), value = await h.host.getReferences(source, { assemblyObjectId: assemblyId }), edited = JSON.parse(source.content);
  edited.bindings[0].parameters.arbitrary_scene_choice = sceneBehaviorReferenceValue(value, { kind: 'scene', value: id(30) });
  edited.bindings[0].parameters.arbitrary_action_choice = sceneBehaviorReferenceValue(value, { kind: 'action', value: 'start_retry' });
  edited.bindings[0].parameters.arbitrary_instance_choice = sceneBehaviorReferenceValue(value, { kind: 'instance', value: model.bindings[1].instanceId });
  h.beforeDirectory = () => assert.fail('ordinary parameter application must not reread optional reference dependencies');
  const result = await h.host.applyDraft(createSceneBehaviorProposal(source, { bindings: edited.bindings }), { dependencyRevision });
  assert.equal(result.applied, true); assert.equal(h.writes.length, 1); assert.equal(h.requests.length, 1);
  const after = JSON.parse(h.state.content); assert.equal(after.bindings[0].parameters.amount, 41); assert.equal(after.bindings[0].parameters.arbitrary_action_choice, 'start_retry');
  assert.deepEqual(after.bindings[1], model.bindings[1]); assert.equal(h.state.baseline, original); assert.equal(h.state.version, revision(original));
  await assert.rejects(h.host.getReferences(source, { assemblyObjectId: assemblyId }), conflict);
});
