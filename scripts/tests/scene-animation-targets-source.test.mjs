import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { createSceneAnimationSourceHost } from '../../web/modules/app-scene-animation-source.js';
import { createSceneAnimationProposal } from '../../engine/scene-animation-edit.mjs';
import { captureSceneAnimationTargets } from '../../engine/scene-animation-targets.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const revision = value => 'sha256:' + hash(value);
const model = () => ({ format: 'viento-scene-animation', schemaVersion: 1, sceneObjectId: id(1), durationSeconds: 2, loop: false,
  tracks: [{ id: id(2), instanceId: id(3), property: 'offset2d', interpolation: 'linear', keyframes: [{ atSeconds: 0, value: [0, 0] }, { atSeconds: 2, value: [10, 20] }] }] });
const conflict = error => ['scene_animation_targets_conflict', 'scene_animation_authoring_conflict'].includes(error.errorCode);
const gate = () => { let release; const promise = new Promise(r => release = r); return { promise, release }; };
function fixture(options = {}) {
  const original = '\ufeff' + JSON.stringify(model(), null, 2).replaceAll('\n', '\r\n') + '\r\n';
  const state = { document: {}, token: 'host:1', sourcePath: 'documents/animations/demo.json', content: original, baseline: original, version: revision(original),
    editable: true, creating: false, busy: false, available: true, sourceJSON: true, targetsAvailable: true };
  const raw = { format: 'viento-scene-animation-targets', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: revision('world'),
    scene: { objectId: id(1), sourcePath: 'documents/scenes/demo.json', sourceRevision: revision('scene') },
    manifest: { objectId: id(4), sourcePath: state.sourcePath, sourceRevision: revision(original), content: original },
    targets: [{ instanceId: id(3), objectId: id(5), name: 'Traveler', sourcePath: 'documents/characters/traveler.md' },
      { instanceId: id(6), objectId: id(5), name: 'Traveler', sourcePath: 'documents/characters/traveler.md' }] };
  const writes = [], requests = [], gates = new Map(); let digests = 0;
  const host = createSceneAnimationSourceHost({ getState: () => ({ ...state }),
    digest: async value => { const blocked = gates.get(++digests); if (blocked) { blocked.entered = true; await blocked.promise; } return hash(value); },
    inspectTargets: async request => { requests.push(request); if (options.inspect) await options.inspect(request, raw); return structuredClone(raw); },
    writeDraft: content => { writes.push(content); state.content = content; state.token += ':draft'; },
  });
  return { host, state, raw, writes, requests, original,
    block(offset) { const value = gate(); gates.set(digests + offset, value); return value; },
    async blocked(value) { for (let n = 0; n < 100 && !value.entered; n++) await new Promise(r => setTimeout(r, 1)); assert.ok(value.entered); },
  };
}
async function edit(h, instanceId = id(6)) {
  const source = await h.host.getSource(), targets = await h.host.getTargets(source), document = model(); document.tracks[0].instanceId = instanceId;
  return { source, targets, proposal: await createSceneAnimationProposal(source, { durationSeconds: 2, loop: false, tracks: document.tracks }) };
}
function mutate(h, key) {
  if (key === 'document') h.state[key] = {}; else if (typeof h.state[key] === 'boolean') h.state[key] = !h.state[key]; else h.state[key] += ' ';
}
test('animation target host reads saved identities without writes and binds an unsaved draft to the saved baseline', async () => {
  const h = fixture(); h.state.content = h.original.replace('"durationSeconds": 2', '"durationSeconds": 3');
  const source = await h.host.getSource(), targets = await h.host.getTargets(source);
  assert.equal(targets.savedContent, h.original); assert.equal(targets.targets.length, 2); assert.deepEqual(h.requests, [{ sceneObjectId: id(1) }]);
  assert.deepEqual(h.writes, []); assert.equal(h.state.content, source.content); assert.equal(source.baseSourceRevision, revision(h.original));
});
test('catalog-backed apply rereads saved scene and writes only the reviewed ordinary draft', async () => {
  const h = fixture(), { targets, proposal } = await edit(h), result = await h.host.applyDraft(proposal, { targets });
  assert.equal(result.applied, true); assert.equal(h.requests.length, 2); assert.deepEqual(h.writes, [proposal.afterContent]);
  assert.equal(h.state.baseline, h.original); assert.equal(h.state.version, revision(h.original));
  assert.ok(h.state.content.startsWith('\ufeff')); assert.equal(h.state.content.replaceAll('\r\n', '').includes('\n'), false);
});
test('catalog-backed apply rejects stale directory or lost selection without changing the draft', async () => {
  for (const change of [h => h.raw.targets.pop(), h => h.raw.scene.sourceRevision = revision('scene changed'),
    h => h.raw.revision = revision('world changed'), h => h.raw.targets.forEach(target => target.name = 'Renamed'),
    h => h.raw.manifest.content += ' ']) {
    const h = fixture(), { targets, proposal } = await edit(h); change(h);
    await assert.rejects(h.host.applyDraft(proposal, { targets }), conflict); assert.deepEqual(h.writes, []); assert.equal(h.state.content, h.original);
  }
});
test('current missing instance is repairable but cannot be approved through a ready directory', async () => {
  const h = fixture(), { targets, proposal } = await edit(h, id(99));
  await assert.rejects(h.host.applyDraft(proposal, { targets }), error => error.errorCode === 'scene_animation_target_missing');
  assert.deepEqual(h.writes, []);
  h.raw.targets.shift();
  const source = await h.host.getSource(), repairedTargets = await h.host.getTargets(source);
  assert.equal(repairedTargets.targets[0].instanceId, id(6));
  const document = model(); document.tracks[0].instanceId = id(6);
  const repaired = await createSceneAnimationProposal(source, { durationSeconds: 2, loop: false, tracks: document.tracks });
  assert.equal((await h.host.applyDraft(repaired, { targets: repairedTargets })).applied, true);
});
test('optional directory capability does not invalidate manual editing source ownership', async () => {
  const h = fixture(), source = await h.host.getSource(), context = h.host.getContext(); h.state.targetsAvailable = false;
  assert.equal(h.host.getContext().sourceToken, context.sourceToken); assert.notEqual(h.host.getContext().targetsToken, context.targetsToken);
  await assert.rejects(h.host.getTargets(source), error => error.errorCode === 'scene_animation_targets_unavailable');
  const document = model(); document.durationSeconds = 3;
  const proposal = await createSceneAnimationProposal(source, { durationSeconds: 3, loop: false, tracks: document.tracks });
  assert.equal((await h.host.applyDraft(proposal)).applied, true); assert.equal(h.requests.length, 0);
});
test('catalog authority rejects forged foreign host and capability ABA receipts', async () => {
  const h = fixture(), { source, targets, proposal } = await edit(h);
  for (const candidate of [{ ...targets }, captureSceneAnimationTargets(source, h.raw)]) {
    await assert.rejects(h.host.applyDraft(proposal, { targets: candidate }), conflict);
  }
  const other = fixture(); await assert.rejects(other.host.applyDraft(proposal, { targets }), conflict);
  h.state.targetsAvailable = false; h.host.getContext(); h.state.targetsAvailable = true; h.host.getContext();
  await assert.rejects(h.host.applyDraft(proposal, { targets }), conflict); assert.deepEqual(h.writes, []);
});
test('requested source is captured before awaits without invoking getters or serializers', async () => {
  const h = fixture(), source = await h.host.getSource(); let calls = 0;
  await assert.rejects(h.host.getTargets({ ...source, get token() { calls++; return source.token; } }), error => error.errorCode === 'scene_animation_targets_invalid');
  await assert.rejects(h.host.getTargets({ ...source, toJSON() { calls++; return source; } }), error => error.errorCode === 'scene_animation_targets_invalid');
  assert.equal(calls, 0); assert.equal(h.requests.length, 0);
  const requested = { ...source }, blocked = h.block(1), pending = h.host.getTargets(requested); await h.blocked(blocked);
  requested.token = 'mutated'; blocked.release(); assert.equal((await pending).targets.length, 2);
});
test('directory reads reject source capability and ownership changes across every digest', async () => {
  for (const offset of [1, 2, 3]) for (const key of ['content', 'baseline', 'version', 'document', 'token', 'sourcePath', 'busy', 'editable', 'available', 'creating', 'sourceJSON', 'targetsAvailable']) {
    const h = fixture(), source = await h.host.getSource(), blocked = h.block(offset), pending = h.host.getTargets(source); await h.blocked(blocked);
    mutate(h, key); blocked.release(); await assert.rejects(pending, conflict, `${offset}:${key}`); assert.deepEqual(h.writes, []);
  }
});
test('directory replies arriving after document replacement do not gain target authority', async () => {
  const blocked = gate(), h = fixture({ inspect: async () => blocked.promise }), source = await h.host.getSource();
  const pending = h.host.getTargets(source);
  for (let n = 0; n < 100 && !h.requests.length; n++) await new Promise(r => setTimeout(r, 1));
  assert.equal(h.requests.length, 1); h.state.token += ':next'; blocked.release(); await assert.rejects(pending, conflict); assert.deepEqual(h.writes, []);
});
test('catalog apply observes cancellation and optional capability changes during final source validation', async () => {
  // apply reads baseline/current, rereads directory baseline/current/saved,
  // then verifies the proposal source hash before its sole synchronous write.
  for (const offset of [1, 2, 3, 4, 5, 6]) {
    const h = fixture(), { targets, proposal } = await edit(h), blocked = h.block(offset);
    let active = true; const pending = h.host.applyDraft(proposal, { targets, isCurrent: () => active }); await h.blocked(blocked);
    active = false; blocked.release(); await assert.rejects(pending, conflict); assert.deepEqual(h.writes, []);
  }
  const h = fixture(), { targets, proposal } = await edit(h), blocked = h.block(6), pending = h.host.applyDraft(proposal, { targets });
  await h.blocked(blocked); h.state.targetsAvailable = false; h.host.getContext(); h.state.targetsAvailable = true; h.host.getContext();
  blocked.release(); await assert.rejects(pending, conflict); assert.deepEqual(h.writes, []);
});
test('unavailable optional reader permits old host manual fields and rejects directory lookup', async () => {
  const h = fixture(), host = createSceneAnimationSourceHost({ getState: () => h.state, digest: hash, writeDraft: content => { h.writes.push(content); h.state.content = content; } });
  assert.equal(host.getContext().targetsAvailable, false); const source = await host.getSource();
  await assert.rejects(host.getTargets(source), error => error.errorCode === 'scene_animation_targets_unavailable');
  const document = model(); document.durationSeconds = 3;
  const proposal = await createSceneAnimationProposal(source, { durationSeconds: 3, loop: false, tracks: document.tracks });
  assert.equal((await host.applyDraft(proposal)).applied, true);
});
