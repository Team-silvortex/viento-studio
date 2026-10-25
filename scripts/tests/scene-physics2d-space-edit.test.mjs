import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { captureScenePhysics2DSpace, createScenePhysics2DSpaceView } from '../../engine/scene-physics2d-space.mjs';
import { createScenePhysics2DOffsetProposal, isScenePhysics2DOffsetProposal,
  scenePhysics2DOffsetProposalMatches } from '../../engine/scene-physics2d-space-edit.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const revision = value => 'sha256:' + hash(value);
const invalid = { errorCode: 'scene_physics2d_space_edit_invalid' };
const body = (n, instanceId, extra = {}) => ({ id: id(n), instanceId, kind: 'static', shape: { kind: 'box', size: [40, 20] }, offset: [0, 0], layer: 1, mask: 2, ...extra });
function fixture(extra = {}) {
  const document = { format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: id(1), bodies: [body(20, id(8), extra), body(21, id(9)), body(22, id(99))] };
  const content = JSON.stringify(document), source = { sourcePath: 'documents/physics/main.json', token: 'source:1', baseSourceRevision: revision(content), sourceRevision: revision(content), content };
  const raw = { format: 'viento-scene-physics2d-space', schemaVersion: 1, worldId: 'world:' + hash('world'), revision: revision('world revision'),
    scene: { objectId: id(1), sourcePath: 'documents/scenes/main.json', sourceRevision: revision('scene'), title: 'Scene', viewport: [640, 480], background: '#112233' },
    actors: [8, 9].map((n, index) => ({ instanceId: id(n), objectId: id(3), name: 'Actor', sourcePath: 'documents/characters/actor.md', sourceRevision: revision('actor'), position: [100 + index * 30, 200], size: [20, 40], color: '#abcdef' })) };
  const space = captureScenePhysics2DSpace(source, raw), view = createScenePhysics2DSpaceView(space, document);
  return { document, source, raw, space, view };
}
function frozenTree(value) { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozenTree); } }

test('offset proposals preserve the existing body and update only its local offset against the selected instance', () => {
  for (const kind of ['character', 'static', 'sensor']) for (const shape of [{ kind: 'box', size: [40, 20] }, { kind: 'circle', radius: 12 }]) {
    const { document, source, raw, view } = fixture({ kind, shape, offset: [3, -4], layer: 7, mask: 12 });
    const before = structuredClone({ document, source, raw, view }), delta = [5.25, -2.5];
    const proposal = createScenePhysics2DOffsetProposal(view, id(20), delta);
    assert.deepEqual(proposal, { bodyId: id(20), instanceId: id(8), fromOffset: [3, -4], offset: [8.25, -6.5], delta: [5.25, -2.5], center: [108.25, 193.5] });
    assert.equal(isScenePhysics2DOffsetProposal(proposal), true); frozenTree(proposal);
    assert.equal(scenePhysics2DOffsetProposalMatches(proposal, view, id(20), [3, -4]), true);
    assert.deepEqual({ document, source, raw, view }, before);
    delta[0] = 900; assert.equal(proposal.delta[0], 5.25);
  }
});

test('zero and fractional adjustments retain precision without rounding or snapping', () => {
  const { view } = fixture({ offset: [.1, -.2] });
  const zero = createScenePhysics2DOffsetProposal(view, id(20), [0, 0]);
  assert.deepEqual(zero.offset, [.1, -.2]); assert.deepEqual(zero.center, [100.1, 199.8]);
  const fine = createScenePhysics2DOffsetProposal(view, id(20), [.000125, -.0000625]);
  assert.deepEqual(fine.offset, [.1 + .000125, -.2 - .0000625]);
});

test('inclusive Rust offset limits accept exact edges but never clamp larger displacements', () => {
  const { view } = fixture({ offset: [8191, -8191] });
  assert.deepEqual(createScenePhysics2DOffsetProposal(view, id(20), [1, -1]).offset, [8192, -8192]);
  assert.deepEqual(createScenePhysics2DOffsetProposal(view, id(20), [-16383, 16383]).offset, [-8192, 8192]);
  for (const delta of [[1.001, 0], [0, -1.001], [-16383.001, 0], [0, 16383.001], [Number.MAX_VALUE, 0]]) {
    assert.throws(() => createScenePhysics2DOffsetProposal(view, id(20), delta), invalid);
  }
  assert.deepEqual(view.bodies[0].offset, [8191, -8191]);
});

test('missing and unrelated body identities cannot invent an adjustment target', () => {
  const { view } = fixture();
  assert.equal(view.missingBodies[0].id, id(22));
  for (const bodyId of [id(22), id(99), id(8), null, {}, '', id(20) + '\n']) {
    assert.throws(() => createScenePhysics2DOffsetProposal(view, bodyId, [1, 0]), invalid);
  }
  assert.equal(createScenePhysics2DOffsetProposal(view, id(21), [1, 0]).instanceId, id(9));
});

test('only branded current views can originate proposals and copied views cannot recover authority', () => {
  const { view, space } = fixture();
  for (const fake of [null, {}, { ...view }, structuredClone(view), Object.create(view), space, new Proxy(view, {})]) {
    assert.throws(() => createScenePhysics2DOffsetProposal(fake, id(20), [1, 0]), invalid);
  }
});

test('view replacement and selection or form changes invalidate an earlier offset proposal', () => {
  const { view, space, document } = fixture({ offset: [3, 4] });
  const proposal = createScenePhysics2DOffsetProposal(view, id(20), [1, 0]);
  const recreated = createScenePhysics2DSpaceView(space, document);
  assert.deepEqual(recreated, view);
  assert.equal(scenePhysics2DOffsetProposalMatches(proposal, recreated, id(20), [3, 4]), false);
  for (const [bodyId, offset] of [[id(21), [3, 4]], [id(22), [3, 4]], [id(20), [4, 4]], [id(20), [3, 5]], [id(20), ['3', 4]]]) {
    assert.equal(scenePhysics2DOffsetProposalMatches(proposal, view, bodyId, offset), false);
  }
  assert.equal(scenePhysics2DOffsetProposalMatches(proposal, null, id(20), [3, 4]), false);
  assert.equal(scenePhysics2DOffsetProposalMatches(proposal, view, id(20), [3, 4]), true);
});

test('proposal shape serialization prototypes and proxies cannot forge its brand', () => {
  const { view } = fixture(), proposal = createScenePhysics2DOffsetProposal(view, id(20), [1, 0]);
  for (const fake of [null, {}, { ...proposal }, structuredClone(proposal), Object.create(proposal), new Proxy(proposal, {})]) {
    assert.equal(isScenePhysics2DOffsetProposal(fake), false);
    assert.equal(scenePhysics2DOffsetProposalMatches(fake, view, id(20), [0, 0]), false);
  }
});

test('delta vectors reject coercion nonfinite values sparse arrays metadata and foreign prototypes', () => {
  const { view } = fixture();
  const sparse = [0, 0]; delete sparse[0];
  const inherited = [0, 0]; Object.setPrototypeOf(inherited, Object.create(Array.prototype));
  const extra = [0, 0]; extra.extra = true;
  const symbol = [0, 0]; symbol[Symbol('x')] = 1;
  const hidden = [0, 0]; Object.defineProperty(hidden, '0', { value: 0, enumerable: false });
  for (const delta of [null, {}, [], [0], [0, 0, 0], [NaN, 0], [0, Infinity], [-Infinity, 0], ['1', 0], [0n, 0], new Float32Array([0, 0]), sparse, inherited, extra, symbol, hidden]) {
    assert.throws(() => createScenePhysics2DOffsetProposal(view, id(20), delta), invalid);
    assert.equal(scenePhysics2DOffsetProposalMatches(createScenePhysics2DOffsetProposal(view, id(20), [1, 0]), view, id(20), delta), false);
  }
});

test('accessors and ambient serializers are rejected without evaluating authored callbacks', () => {
  const { view } = fixture(), proposal = createScenePhysics2DOffsetProposal(view, id(20), [1, 0]);
  let reads = 0;
  const accessor = [0, 0]; Object.defineProperty(accessor, '0', { enumerable: true, get() { reads++; return 0; } });
  const serialized = [0, 0]; serialized.toJSON = () => { reads++; return [0, 0]; };
  for (const delta of [accessor, serialized]) {
    assert.throws(() => createScenePhysics2DOffsetProposal(view, id(20), delta), invalid);
    assert.equal(scenePhysics2DOffsetProposalMatches(proposal, view, id(20), delta), false);
  }
  for (const proto of [Object.prototype, Array.prototype]) {
    const old = Object.getOwnPropertyDescriptor(proto, 'toJSON');
    try {
      Object.defineProperty(proto, 'toJSON', { configurable: true, get() { reads++; return () => [0, 0]; } });
      assert.throws(() => createScenePhysics2DOffsetProposal(view, id(20), [1, 0]), invalid);
      assert.equal(scenePhysics2DOffsetProposalMatches(proposal, view, id(20), [0, 0]), false);
    } finally { if (old) Object.defineProperty(proto, 'toJSON', old); else delete proto.toJSON; }
  }
  assert.equal(reads, 0);
});
