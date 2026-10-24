import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { createScenePhysics2DSourceHost } from '../../web/modules/app-scene-physics2d-source.js';
import { createScenePhysics2DProposal } from '../../engine/scene-physics2d-edit.mjs';
import { isScenePhysics2DSpace, scenePhysics2DSpaceMatchSource } from '../../engine/scene-physics2d-space.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const revision = value => 'sha256:' + hash(value);
const model = () => ({ format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: id(1),
  bodies: [{ id: id(2), instanceId: id(3), kind: 'static', shape: { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 2 }] });
const conflict = error => error.errorCode === 'scene_physics2d_space_conflict';
const invalid = error => ['scene_physics2d_targets_invalid', 'scene_physics2d_space_invalid'].includes(error.errorCode);
const gate = () => { let release, entered; const promise = new Promise(r => release = r), entering = new Promise(r => entered = r); return { promise, release, entered, entering }; };
function fixture(options = {}) {
  const original = '\ufeff' + JSON.stringify(model(), null, 2).replaceAll('\n', '\r\n') + '\r\n';
  const state = { document: {}, token: 'host:1', sourcePath: 'documents/physics/demo.json', content: original, baseline: original, version: revision(original),
    editable: true, creating: false, busy: false, available: true, sourceJSON: true, targetsAvailable: true, spaceAvailable: true };
  const raw = { format: 'viento-scene-physics2d-space', schemaVersion: 1, worldId: 'world:' + 'a'.repeat(64), revision: revision('world'),
    scene: { objectId: id(1), sourcePath: 'documents/scenes/demo.json', sourceRevision: revision('scene'), title: 'Room', viewport: [640, 360], background: '#112233' },
    actors: [{ instanceId: id(3), objectId: id(5), name: 'Traveler', sourcePath: 'documents/actors/traveler.md', sourceRevision: revision('actor'), position: [100, 100], size: [32, 32], color: '#ffffff' }] };
  const targets = { format: 'viento-scene-physics2d-targets', schemaVersion: 1, worldId: raw.worldId, revision: raw.revision,
    scene: { objectId: id(1), sourcePath: raw.scene.sourcePath, sourceRevision: raw.scene.sourceRevision },
    manifest: { objectId: id(4), sourcePath: state.sourcePath, sourceRevision: revision(original), content: original },
    targets: raw.actors.map(({ instanceId, objectId, name, sourcePath }) => ({ instanceId, objectId, name, sourcePath })) };
  const writes = [], requests = [], targetRequests = [], gates = new Map(); let digests = 0;
  const ports = { getState: () => ({ ...state }),
    digest: async value => { const blocked = gates.get(++digests); if (blocked) { blocked.entered(); await blocked.promise; } return options.digest ? options.digest(value, digests) : hash(value); },
    inspectSpace: async request => { requests.push(request); return options.inspect ? options.inspect(request, raw) : structuredClone(raw); },
    inspectTargets: async request => { targetRequests.push(request); return structuredClone(targets); },
    writeDraft: content => { writes.push(content); state.content = content; state.token += ':draft'; },
  };
  const host = createScenePhysics2DSourceHost(ports);
  return { host, state, raw, writes, requests, targetRequests, original, ports,
    block(offset) { const value = gate(); gates.set(digests + offset, value); return value; },
  };
}
function mutate(h, key) {
  if (key === 'document') h.state[key] = {}; else if (typeof h.state[key] === 'boolean') h.state[key] = !h.state[key]; else h.state[key] += ' ';
}
const ownershipKeys = ['content', 'baseline', 'version', 'document', 'token', 'sourcePath', 'busy', 'editable', 'available', 'creating', 'sourceJSON', 'spaceAvailable'];
async function proposal(h) { const source = await h.host.getSource(), document = model(); document.bodies[0].layer = 3; return createScenePhysics2DProposal(source, { bodies: document.bodies }); }

test('space observation binds the dirty physics source and reads only the saved scene identity without writes', async () => {
  const h = fixture(); h.state.content = h.original.replace('"layer": 1', '"layer": 3');
  const source = await h.host.getSource(), space = await h.host.getSpace(source);
  assert.ok(isScenePhysics2DSpace(space)); assert.ok(scenePhysics2DSpaceMatchSource(space, source)); assert.ok(Object.isFrozen(space));
  assert.equal(source.baseSourceRevision, revision(h.original)); assert.notEqual(source.sourceRevision, source.baseSourceRevision);
  assert.deepEqual(h.requests, [{ sceneObjectId: id(1) }]); assert.deepEqual(h.targetRequests, []); assert.deepEqual(h.writes, []);
  assert.equal(h.state.baseline, h.original); assert.equal(h.state.content, source.content);
  assert.equal(Object.hasOwn(space, 'manifest'), false); assert.equal(Object.hasOwn(space, 'applyDraft'), false);
});

test('every source and spatial capability change rejects stale results at both digest waits', async () => {
  for (const offset of [1, 2]) for (const key of ownershipKeys) {
    const h = fixture(), source = await h.host.getSource(), blocked = h.block(offset), pending = h.host.getSpace(source);
    await blocked.entering; mutate(h, key); blocked.release(); await assert.rejects(pending, conflict, `${offset}:${key}`);
    assert.deepEqual(h.requests, []); assert.deepEqual(h.writes, []);
  }
});

test('every source and spatial capability change rejects an in-flight backend response', async () => {
  for (const key of ownershipKeys) {
    const blocked = gate(), h = fixture({ inspect: async (_request, raw) => { blocked.entered(); await blocked.promise; return raw; } });
    const source = await h.host.getSource(), pending = h.host.getSpace(source); await blocked.entering; mutate(h, key); blocked.release();
    await assert.rejects(pending, conflict, key); assert.equal(h.requests.length, 1); assert.deepEqual(h.writes, []);
  }
});

test('observed spatial capability ABA revokes reads independently of physical source ownership', async () => {
  const blocked = gate(), h = fixture({ inspect: async (_request, raw) => { blocked.entered(); await blocked.promise; return raw; } });
  const source = await h.host.getSource(), before = h.host.getContext(), pending = h.host.getSpace(source); await blocked.entering;
  h.state.spaceAvailable = false; h.host.getContext(); h.state.spaceAvailable = true;
  const after = h.host.getContext(); assert.equal(after.sourceToken, before.sourceToken); assert.equal(after.targetsToken, before.targetsToken);
  assert.notEqual(after.spaceToken, before.spaceToken); blocked.release(); await assert.rejects(pending, conflict); assert.deepEqual(h.writes, []);
});

test('target capability changes neither invalidate nor grant spatial reads', async () => {
  const blocked = gate(), h = fixture({ inspect: async (_request, raw) => { blocked.entered(); await blocked.promise; return raw; } });
  const source = await h.host.getSource(), before = h.host.getContext(), pending = h.host.getSpace(source); await blocked.entering;
  h.state.targetsAvailable = false; const after = h.host.getContext(); assert.equal(after.spaceToken, before.spaceToken); assert.equal(after.sourceToken, before.sourceToken);
  blocked.release(); assert.ok(isScenePhysics2DSpace(await pending)); assert.deepEqual(h.writes, []);
});

test('optional spatial state does not invalidate manual or catalog-backed draft application', async () => {
  for (const catalogBacked of [false, true]) {
    const h = fixture(), source = await h.host.getSource(), targets = catalogBacked ? await h.host.getTargets(source) : undefined;
    const edit = await proposal(h); h.state.spaceAvailable = false; h.host.getContext(); h.state.spaceAvailable = true; h.host.getContext();
    assert.equal((await h.host.applyDraft(edit, { targets })).applied, true); assert.deepEqual(h.writes, [edit.afterContent]);
    assert.equal(h.requests.length, 0); assert.equal(h.targetRequests.length, catalogBacked ? 2 : 0);
  }
});

test('spatial service failures leave existing directory and draft editing usable', async () => {
  const failure = Object.assign(new Error('Scene is unavailable'), { errorCode: 'scene_physics2d_space_unavailable' });
  const h = fixture({ inspect: async () => { throw failure; } }), source = await h.host.getSource();
  await assert.rejects(h.host.getSpace(source), error => error === failure); assert.deepEqual(h.writes, []);
  const targets = await h.host.getTargets(source), edit = await proposal(h);
  assert.equal((await h.host.applyDraft(edit, { targets })).applied, true); assert.equal(h.targetRequests.length, 2);
});

test('space availability requires an explicit true flag and a callable independent reader', async () => {
  for (const value of [undefined, false, 1, 'true', {}]) {
    const h = fixture(); h.state.spaceAvailable = value; const source = await h.host.getSource();
    assert.equal(h.host.getContext().spaceAvailable, false);
    await assert.rejects(h.host.getSpace(source), error => error.errorCode === 'scene_physics2d_space_unavailable'); assert.deepEqual(h.requests, []);
    assert.equal((await h.host.applyDraft(await proposal(h))).applied, true);
  }
  const h = fixture(), host = createScenePhysics2DSourceHost({ ...h.ports, inspectSpace: undefined });
  assert.equal(host.getContext().spaceAvailable, false);
  await assert.rejects(host.getSpace(await host.getSource()), error => error.errorCode === 'scene_physics2d_space_unavailable');
  assert.ok(await host.getTargets(await host.getSource())); assert.deepEqual(h.writes, []);
});

test('requested source is copied before the first await and rejects accessors without invocation', async () => {
  const h = fixture(), source = await h.host.getSource(); let calls = 0;
  for (const candidate of [{ ...source, get token() { calls++; return source.token; } }, { ...source, toJSON() { calls++; return source; } }]) {
    await assert.rejects(h.host.getSpace(candidate), invalid);
  }
  assert.equal(calls, 0); assert.deepEqual(h.requests, []);
  const requested = { ...source }, blocked = h.block(1), pending = h.host.getSpace(requested); await blocked.entering;
  requested.token = 'changed after capture'; requested.content = '{}'; blocked.release();
  assert.ok(scenePhysics2DSpaceMatchSource(await pending, source)); assert.deepEqual(h.writes, []);
});

test('each mismatched source identity is rejected before a spatial request', async () => {
  const h = fixture(), source = await h.host.getSource();
  for (const [key, replacement] of Object.entries({ sourcePath: 'documents/physics/other.json', token: 'other',
    baseSourceRevision: revision('other baseline'), sourceRevision: revision('other draft'), content: source.content + ' ' })) {
    await assert.rejects(h.host.getSpace({ ...source, [key]: replacement }), conflict, key);
  }
  assert.deepEqual(h.requests, []); assert.deepEqual(h.writes, []);
});

test('invalid physics schema or scene identity cannot issue spatial requests', async () => {
  for (const content of [JSON.stringify({ ...model(), sceneObjectId: 'not-a-uuid' }), JSON.stringify({ ...model(), bodies: [] }), '{broken']) {
    const h = fixture(); h.state.content = content; const source = await h.host.getSource();
    await assert.rejects(h.host.getSpace(source), invalid); assert.deepEqual(h.requests, []); assert.deepEqual(h.writes, []);
  }
});

test('malformed spatial payloads cannot run accessors serializers or provide an observation', async () => {
  let calls = 0;
  for (const corrupt of [raw => ({ ...raw, get scene() { calls++; return raw.scene; } }),
    raw => ({ ...raw, toJSON() { calls++; return raw; } }), raw => ({ ...raw, extra: true }),
    raw => ({ ...raw, actors: [{ ...raw.actors[0], get position() { calls++; return [1, 2]; } }] }),
    raw => ({ ...raw, scene: { ...raw.scene, objectId: id(999) } }),
    raw => ({ ...raw, actors: [{ ...raw.actors[0], position: [Infinity, 0] }] })]) {
    const h = fixture({ inspect: async (_request, raw) => corrupt(raw) });
    await assert.rejects(h.host.getSpace(await h.host.getSource()), invalid); assert.deepEqual(h.writes, []);
  }
  assert.equal(calls, 0);
});

test('ownership is rechecked after data capture even if a proxy trap replaces the source', async () => {
  let h;
  h = fixture({ inspect: async (_request, raw) => new Proxy(raw, { ownKeys(target) { h.state.document = {}; return Reflect.ownKeys(target); } }) });
  await assert.rejects(h.host.getSpace(await h.host.getSource()), conflict); assert.deepEqual(h.writes, []);
});

test('malformed source hash receipts never reach the spatial service', async () => {
  for (const offset of [3, 4]) for (const malformed of [null, 'a'.repeat(64) + '\n', 'A'.repeat(64), 'not-a-digest']) {
    const h = fixture({ digest: (value, count) => count === offset ? malformed : hash(value) }), source = await h.host.getSource();
    await assert.rejects(h.host.getSpace(source), conflict); assert.deepEqual(h.requests, []); assert.deepEqual(h.writes, []);
  }
});

const runtime = await fs.readFile(new URL('../../web/modules/app-runtime.js', import.meta.url), 'utf8');
const wiring = runtime.slice(runtime.indexOf('  const physicsSourceHost = createScenePhysics2DSourceHost({'), runtime.indexOf('  const animationStateScriptSourceHost'));
test('actual runtime wires spatial data through its own optional port without saving or touching editor state', async () => {
  const h = fixture(), requests = [], doc = { path: 'physics', _sourceCachedText: h.original };
  const state = { isEditing: true, isCreating: false, editInputMode: 'source', activeEditPath: 'physics', activeEditSource: h.state.sourcePath };
  const context = vm.createContext({ state, editorLoadToken: 1, scenePreviewDraftEpoch: 1,
    scenePhysics2DSpaceAvailable: true, inspectScenePhysics2DSpace: async payload => { requests.push({ ...payload }); return structuredClone(h.raw); },
    scenePhysics2DTargetsAvailable: false, inspectScenePhysics2DTargets: async () => assert.fail('spatial view must not require target lookup'),
    editSessionBaselineContent: h.original, editSessionVersion: revision(h.original), createScenePhysics2DSourceHost,
    getActiveDoc: () => doc, canonicalizeSourcePath: value => value, getCurrentEditContent: () => h.original,
    isEditModeActive: () => true, isEditorBusy: () => false, supportsStudioCoreScenePhysics2D: () => true,
    editEditorEl: { focus() { assert.fail('readonly observation cannot move editor focus'); } },
    setSourceEditorContent() { assert.fail('readonly observation cannot write draft'); }, refreshEditSessionDirtyState() { assert.fail('readonly observation cannot alter dirty state'); },
    refreshEditButtons() { assert.fail('readonly observation cannot change save state'); }, setEditorStatus() {}, t: value => value, crypto: webcrypto, TextEncoder });
  const host = vm.runInContext(wiring + '\nphysicsSourceHost', context), source = await host.getSource();
  assert.ok(isScenePhysics2DSpace(await host.getSpace(source))); assert.deepEqual(requests, [{ sceneObjectId: id(1) }]);
  assert.equal(context.editSessionBaselineContent, h.original); assert.equal(context.editSessionVersion, revision(h.original)); assert.equal(doc._sourceCachedText, h.original);
  context.scenePhysics2DSpaceAvailable = false; assert.equal(host.getContext().spaceAvailable, false);
  await assert.rejects(host.getSpace(source), error => error.errorCode === 'scene_physics2d_space_unavailable');
  assert.doesNotMatch(wiring, /fetch\s*\(|saveEdit|setEditSessionClean|buildProject|inspectSceneAnimation|inspectSceneAudio/);
});

test('runtime availability uses strict spatial capability and its own backend availability', () => {
  const assignment = runtime.split('\n').find(line => line.includes('scenePhysics2DSpaceAvailable = normalizedDetection.'));
  assert.ok(assignment);
  for (const available of [false, true]) for (const flag of [undefined, false, true, 1, 'true']) {
    const context = vm.createContext({ scenePhysics2DSpaceAvailable: true, normalizedDetection: { available }, detection: { payload: { scenePhysics2DSpace: flag, scenePhysics2DTargets: true } } });
    vm.runInContext(assignment, context); assert.equal(context.scenePhysics2DSpaceAvailable, available === true && flag === true);
  }
});
