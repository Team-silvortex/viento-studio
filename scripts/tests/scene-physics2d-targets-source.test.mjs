import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { createScenePhysics2DSourceHost } from '../../web/modules/app-scene-physics2d-source.js';
import { createScenePhysics2DProposal } from '../../engine/scene-physics2d-edit.mjs';
import { captureScenePhysics2DTargets } from '../../engine/scene-physics2d-targets.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const revision = value => 'sha256:' + hash(value);
const model = () => ({ format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: id(1),
  bodies: [{ id: id(2), instanceId: id(3), kind: 'static', shape: { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 2 }] });
const conflict = error => ['scene_physics2d_targets_conflict', 'scene_physics2d_authoring_conflict'].includes(error.errorCode);
const revoked = error => conflict(error) || error.errorCode === 'scene_physics2d_targets_unavailable';
const gate = () => { let release; const promise = new Promise(r => release = r); return { promise, release }; };
function fixture(options = {}) {
  const original = '\ufeff' + JSON.stringify(options.model || model(), null, 2).replaceAll('\n', '\r\n') + '\r\n';
  const state = { document: {}, token: 'host:1', sourcePath: 'documents/physics/demo.json', content: original, baseline: original, version: revision(original),
    editable: true, creating: false, busy: false, available: true, sourceJSON: true, targetsAvailable: true };
  const raw = { format: 'viento-scene-physics2d-targets', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: revision('world'),
    scene: { objectId: id(1), sourcePath: 'documents/scenes/demo.json', sourceRevision: revision('scene') },
    manifest: { objectId: id(4), sourcePath: state.sourcePath, sourceRevision: revision(original), content: original },
    targets: [{ instanceId: id(3), objectId: id(5), name: 'Traveler', sourcePath: 'documents/characters/traveler.md' },
      { instanceId: id(6), objectId: id(5), name: 'Traveler', sourcePath: 'documents/characters/traveler.md' }] };
  const writes = [], requests = [], gates = new Map(); let digests = 0;
  const host = createScenePhysics2DSourceHost({ getState: () => ({ ...state }),
    digest: async value => { const blocked = gates.get(++digests); if (blocked) { blocked.entered = true; await blocked.promise; } return options.digest ? options.digest(value, digests) : hash(value); },
    inspectTargets: async request => { requests.push(request); if (options.inspect) await options.inspect(request, raw); return structuredClone(raw); },
    writeDraft: content => { writes.push(content); state.content = content; state.token += ':draft'; },
  });
  return { host, state, raw, writes, requests, original,
    block(offset) { const value = gate(); gates.set(digests + offset, value); return value; },
    async blocked(value) { for (let n = 0; n < 100 && !value.entered; n++) await new Promise(r => setTimeout(r, 1)); assert.ok(value.entered); },
  };
}
async function edit(h, instanceId = id(6)) {
  const source = await h.host.getSource(), targets = await h.host.getTargets(source), document = model(); document.bodies[0].instanceId = instanceId;
  return { source, targets, proposal: await createScenePhysics2DProposal(source, { bodies: document.bodies }) };
}
function mutate(h, key) {
  if (key === 'document') h.state[key] = {}; else if (typeof h.state[key] === 'boolean') h.state[key] = !h.state[key]; else h.state[key] += ' ';
}
test('physics target host reads saved identities without writes and binds an unsaved draft to the saved baseline', async () => {
  const h = fixture(); h.state.content = h.original.replace('"layer": 1', '"layer": 3');
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
  await assert.rejects(h.host.applyDraft(proposal, { targets }), error => error.errorCode === 'scene_physics2d_target_missing');
  assert.deepEqual(h.writes, []);
  h.raw.targets.shift();
  const source = await h.host.getSource(), repairedTargets = await h.host.getTargets(source);
  assert.equal(repairedTargets.targets[0].instanceId, id(6));
  const document = model(); document.bodies[0].instanceId = id(6);
  const repaired = await createScenePhysics2DProposal(source, { bodies: document.bodies });
  assert.equal((await h.host.applyDraft(repaired, { targets: repairedTargets })).applied, true);
});
test('optional directory capability does not invalidate manual editing source ownership', async () => {
  const h = fixture(), source = await h.host.getSource(), context = h.host.getContext(); h.state.targetsAvailable = false;
  assert.equal(h.host.getContext().sourceToken, context.sourceToken); assert.notEqual(h.host.getContext().targetsToken, context.targetsToken);
  await assert.rejects(h.host.getTargets(source), error => error.errorCode === 'scene_physics2d_targets_unavailable');
  const document = model(); document.bodies[0].layer = 3;
  const proposal = await createScenePhysics2DProposal(source, { bodies: document.bodies });
  assert.equal((await h.host.applyDraft(proposal)).applied, true); assert.equal(h.requests.length, 0);
});
test('catalog authority rejects forged foreign host and capability ABA receipts', async () => {
  const h = fixture(), { source, targets, proposal } = await edit(h);
  for (const candidate of [{ ...targets }, captureScenePhysics2DTargets(source, h.raw)]) {
    await assert.rejects(h.host.applyDraft(proposal, { targets: candidate }), conflict);
  }
  const other = fixture(); await assert.rejects(other.host.applyDraft(proposal, { targets }), conflict);
  h.state.targetsAvailable = false; h.host.getContext(); h.state.targetsAvailable = true; h.host.getContext();
  await assert.rejects(h.host.applyDraft(proposal, { targets }), conflict); assert.deepEqual(h.writes, []);
});
test('requested source is captured before awaits without invoking getters or serializers', async () => {
  const h = fixture(), source = await h.host.getSource(); let calls = 0;
  await assert.rejects(h.host.getTargets({ ...source, get token() { calls++; return source.token; } }), error => error.errorCode === 'scene_physics2d_targets_invalid');
  await assert.rejects(h.host.getTargets({ ...source, toJSON() { calls++; return source; } }), error => error.errorCode === 'scene_physics2d_targets_invalid');
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
  const h = fixture(), host = createScenePhysics2DSourceHost({ getState: () => h.state, digest: hash, writeDraft: content => { h.writes.push(content); h.state.content = content; } });
  assert.equal(host.getContext().targetsAvailable, false); const source = await host.getSource();
  await assert.rejects(host.getTargets(source), error => error.errorCode === 'scene_physics2d_targets_unavailable');
  const document = model(); document.bodies[0].layer = 3;
  const proposal = await createScenePhysics2DProposal(source, { bodies: document.bodies });
  assert.equal((await host.applyDraft(proposal)).applied, true);
});


test('requested catalogs reject each mismatched source identity before issuing a directory request', async () => {
  const h = fixture(), source = await h.host.getSource();
  for (const [key, replacement] of Object.entries({ sourcePath: 'documents/physics/other.json', token: 'other',
    baseSourceRevision: revision('other baseline'), sourceRevision: revision('other draft'), content: source.content + ' ' })) {
    await assert.rejects(h.host.getTargets({ ...source, [key]: replacement }), conflict, key);
  }
  assert.deepEqual(h.requests, []); assert.deepEqual(h.writes, []);
});

test('all candidate bodies must still belong to the saved scene, including unchanged bodies', async () => {
  const document = model(); document.bodies.push({ ...structuredClone(document.bodies[0]), id: id(40), instanceId: id(41) });
  const h = fixture({ model: document }), source = await h.host.getSource(), targets = await h.host.getTargets(source);
  document.bodies[0].shape.size[0] = 64;
  const proposal = await createScenePhysics2DProposal(source, { bodies: document.bodies });
  await assert.rejects(h.host.applyDraft(proposal, { targets }), error => {
    assert.equal(error.errorCode, 'scene_physics2d_target_missing'); assert.deepEqual(error.instanceIds, [id(41)]); return true;
  });
  assert.deepEqual(h.writes, []); assert.equal(h.state.content, h.original);
});

test('catalog apply rejects source ownership and directory capability changes at every digest boundary', async () => {
  for (const offset of [1, 2, 3, 4, 5, 6]) for (const key of ['content', 'baseline', 'version', 'document', 'token', 'sourcePath',
    'busy', 'editable', 'available', 'creating', 'sourceJSON', 'targetsAvailable']) {
    const h = fixture(), { targets, proposal } = await edit(h), blocked = h.block(offset);
    const pending = h.host.applyDraft(proposal, { targets }); await h.blocked(blocked);
    mutate(h, key); blocked.release(); await assert.rejects(pending, key === 'targetsAvailable' ? revoked : conflict, `${offset}:${key}`); assert.deepEqual(h.writes, []);
  }
});

test('caller guards are evaluated before the final ownership and capability capture', async () => {
  const probe = fixture(), review = await edit(probe); let checks = 0;
  await probe.host.applyDraft(review.proposal, { targets: review.targets, isCurrent() { checks++; return true; } });
  assert.ok(checks >= 4);
  for (const mutation of [h => { h.state.content += ' '; }, h => { h.state.document = {}; },
    h => { h.state.targetsAvailable = false; }, h => { h.state.targetsAvailable = false; h.host.getContext(); h.state.targetsAvailable = true; }]) {
    for (let at = 1; at <= checks; at++) {
      const h = fixture(), { targets, proposal } = await edit(h); let calls = 0;
      await assert.rejects(h.host.applyDraft(proposal, { targets, isCurrent() { if (++calls === at) mutation(h); return true; } }), revoked);
      assert.deepEqual(h.writes, [], `guard ${at}`);
    }
  }
});

test('directory read errors and a mismatched saved content digest never issue a usable catalog', async () => {
  const unavailable = Object.assign(new Error('No saved scene'), { errorCode: 'scene_physics2d_targets_unavailable' });
  const h = fixture({ inspect: async () => { throw unavailable; } }), source = await h.host.getSource();
  await assert.rejects(h.host.getTargets(source), error => error === unavailable); assert.deepEqual(h.writes, []);
  const other = fixture({ inspect: async (_request, raw) => { raw.manifest.content = raw.manifest.content.replace('"layer": 1', '"layer": 3'); } });
  await assert.rejects(other.host.getTargets(await other.host.getSource()), conflict); assert.deepEqual(other.writes, []);
});

test('directory-only changes during the reread cannot bypass apply even when source bytes are untouched', async () => {
  for (const change of [h => { h.raw.worldId = 'world:' + 'b'.repeat(64); }, h => { h.raw.targets.reverse(); },
    h => { h.raw.targets.forEach(target => { target.sourcePath = 'documents/characters/renamed.md'; }); }]) {
    const h = fixture(), { targets, proposal } = await edit(h); change(h);
    await assert.rejects(h.host.applyDraft(proposal, { targets }), conflict); assert.deepEqual(h.writes, []); assert.equal(h.state.content, h.original);
  }
});


test('saved declaration digest receipts must be exactly 64 lowercase hexadecimal characters', async () => {
  for (const malformed of [null, undefined, {}, 'not-a-digest', 'a'.repeat(64) + '\n', 'A'.repeat(64)]) {
    const h = fixture({ digest: (value, count) => count === 5 ? malformed : hash(value) });
    const source = await h.host.getSource();
    await assert.rejects(h.host.getTargets(source), conflict); assert.deepEqual(h.writes, []);
  }
});
