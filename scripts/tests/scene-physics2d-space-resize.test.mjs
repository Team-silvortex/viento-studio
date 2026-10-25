import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { captureScenePhysics2DSpace, createScenePhysics2DSpaceView } from '../../engine/scene-physics2d-space.mjs';
import { createScenePhysics2DResizeProposal, isScenePhysics2DResizeProposal,
  scenePhysics2DResizeProposalMatches } from '../../engine/scene-physics2d-space-resize.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const revision = value => 'sha256:' + hash(value);
const invalid = { errorCode: 'scene_physics2d_space_resize_invalid' };
const body = (n, instanceId, extra = {}) => ({ id: id(n), instanceId, kind: 'static', shape: { kind: 'box', size: [40, 20] }, offset: [7, -3], layer: 1, mask: 2, ...extra });
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

test('box proposals change full width and height while preserving center kind offsets masks and every source', () => {
  for (const kind of ['character', 'static', 'sensor']) {
    const f = fixture({ kind, layer: 7, mask: 12 }), before = structuredClone({ document: f.document, source: f.source, raw: f.raw, view: f.view });
    const delta = [10, -4.5], proposal = createScenePhysics2DResizeProposal(f.view, id(20), delta);
    assert.deepEqual(proposal, { bodyId: id(20), instanceId: id(8), fromShape: { kind: 'box', size: [40, 20] },
      shape: { kind: 'box', size: [50, 15.5] }, center: [107, 197], delta: [10, -4.5] });
    assert.equal(isScenePhysics2DResizeProposal(proposal), true); frozenTree(proposal);
    assert.equal(scenePhysics2DResizeProposalMatches(proposal, f.view, id(20), { kind: 'box', size: [40, 20] }), true);
    assert.deepEqual({ document: f.document, source: f.source, raw: f.raw, view: f.view }, before);
    delta[0] = 999; assert.equal(proposal.delta[0], 10); assert.notEqual(proposal.fromShape, f.view.bodies[0].shape);
    assert.notEqual(proposal.center, f.view.bodies[0].center);
  }
});

test('circle proposals adjust radius only and retain the nonzero-offset collider center', () => {
  for (const kind of ['character', 'static', 'sensor']) {
    const { view } = fixture({ kind, shape: { kind: 'circle', radius: 12 } });
    const proposal = createScenePhysics2DResizeProposal(view, id(20), [2.25]);
    assert.deepEqual(proposal, { bodyId: id(20), instanceId: id(8), fromShape: { kind: 'circle', radius: 12 }, shape: { kind: 'circle', radius: 14.25 }, center: [107, 197], delta: [2.25] });
    frozenTree(proposal); assert.equal(scenePhysics2DResizeProposalMatches(proposal, view, id(20), { kind: 'circle', radius: 12 }), true);
    assert.deepEqual(view.bodies[0].shape, { kind: 'circle', radius: 12 }); assert.deepEqual(view.bodies[0].offset, [7, -3]);
  }
});

test('one-axis zero and fractional adjustments do not snap or silently resize the other box axis', () => {
  const { view } = fixture({ shape: { kind: 'box', size: [40.1, 20.2] } });
  const zero = createScenePhysics2DResizeProposal(view, id(20), [0, 0]); assert.deepEqual(zero.shape, view.bodies[0].shape);
  assert.deepEqual(createScenePhysics2DResizeProposal(view, id(20), [.000125, 0]).shape.size, [40.1 + .000125, 20.2]);
  assert.deepEqual(createScenePhysics2DResizeProposal(view, id(20), [0, -.0000625]).shape.size, [40.1, 20.2 - .0000625]);
  const circle = fixture({ shape: { kind: 'circle', radius: .75 } }).view;
  assert.deepEqual(createScenePhysics2DResizeProposal(circle, id(20), [0]).shape, { kind: 'circle', radius: .75 });
  assert.equal(createScenePhysics2DResizeProposal(circle, id(20), [.0000625]).shape.radius, .75 + .0000625);
});

test('Rust inclusive full-size limits accept both box edges and reject the entire proposal on either invalid axis', () => {
  const { view } = fixture();
  assert.deepEqual(createScenePhysics2DResizeProposal(view, id(20), [-39, 8172]).shape.size, [1, 8192]);
  assert.deepEqual(createScenePhysics2DResizeProposal(view, id(20), [8152, -19]).shape.size, [8192, 1]);
  for (const delta of [[-39.001, 0], [0, -19.001], [8152.001, 0], [0, 8172.001], [1, -21], [Number.MAX_VALUE, 0], [0, -Number.MAX_VALUE]]) {
    assert.throws(() => createScenePhysics2DResizeProposal(view, id(20), delta), invalid);
    assert.deepEqual(view.bodies[0].shape.size, [40, 20]);
  }
});

test('Rust inclusive radius limits accept exact edges and reject out-of-range values without clamping', () => {
  const { view } = fixture({ shape: { kind: 'circle', radius: 12 } });
  assert.equal(createScenePhysics2DResizeProposal(view, id(20), [-11.5]).shape.radius, .5);
  assert.equal(createScenePhysics2DResizeProposal(view, id(20), [4084]).shape.radius, 4096);
  for (const delta of [[-11.5001], [4084.0001], [-12], [Number.MAX_VALUE], [-Number.MAX_VALUE]]) {
    assert.throws(() => createScenePhysics2DResizeProposal(view, id(20), delta), invalid); assert.equal(view.bodies[0].shape.radius, 12);
  }
});

test('missing and unrelated body identities cannot borrow another instance of the same actor definition', () => {
  const { view } = fixture(); assert.equal(view.missingBodies[0].id, id(22));
  for (const bodyId of [id(22), id(99), id(8), null, {}, '', id(20) + '\n']) assert.throws(() => createScenePhysics2DResizeProposal(view, bodyId, [1, 0]), invalid);
  assert.equal(createScenePhysics2DResizeProposal(view, id(21), [1, 0]).instanceId, id(9));
});

test('copied views and serialized proposals cannot forge size-edit authority', () => {
  const { view, space } = fixture(), proposal = createScenePhysics2DResizeProposal(view, id(20), [1, 0]);
  for (const fake of [null, {}, { ...view }, structuredClone(view), Object.create(view), space, new Proxy(view, {})]) assert.throws(() => createScenePhysics2DResizeProposal(fake, id(20), [1, 0]), invalid);
  for (const fake of [null, {}, { ...proposal }, structuredClone(proposal), Object.create(proposal), new Proxy(proposal, {})]) {
    assert.equal(isScenePhysics2DResizeProposal(fake), false);
    assert.equal(scenePhysics2DResizeProposalMatches(fake, view, id(20), { kind: 'box', size: [40, 20] }), false);
  }
});

test('replacement views body changes kind changes and either original dimension invalidate queued proposals', () => {
  const { view, space, document } = fixture(), proposal = createScenePhysics2DResizeProposal(view, id(20), [1, 0]);
  const replacement = createScenePhysics2DSpaceView(space, document); assert.deepEqual(replacement, view);
  assert.equal(scenePhysics2DResizeProposalMatches(proposal, replacement, id(20), { kind: 'box', size: [40, 20] }), false);
  for (const [bodyId, currentShape] of [[id(21), { kind: 'box', size: [40, 20] }], [id(22), { kind: 'box', size: [40, 20] }],
    [id(20), { kind: 'box', size: [41, 20] }], [id(20), { kind: 'box', size: [40, 21] }], [id(20), { kind: 'circle', radius: 20 }]]) {
    assert.equal(scenePhysics2DResizeProposalMatches(proposal, view, bodyId, currentShape), false);
  }
  assert.equal(scenePhysics2DResizeProposalMatches(proposal, null, id(20), { kind: 'box', size: [40, 20] }), false);
  const circle = fixture({ shape: { kind: 'circle', radius: 12 } }).view, circleProposal = createScenePhysics2DResizeProposal(circle, id(20), [1]);
  assert.equal(scenePhysics2DResizeProposalMatches(circleProposal, circle, id(20), { kind: 'circle', radius: 13 }), false);
  assert.equal(scenePhysics2DResizeProposalMatches(circleProposal, circle, id(20), { kind: 'circle', radius: 12 }), true);
});

test('delta shape follows the original geometry kind and rejects coerced nonfinite sparse or decorated vectors', () => {
  const box = fixture().view, circle = fixture({ shape: { kind: 'circle', radius: 12 } }).view;
  for (const delta of [[], [1], [0, 0, 0]]) assert.throws(() => createScenePhysics2DResizeProposal(box, id(20), delta), invalid);
  for (const delta of [[], [0, 0], [0, 0, 0]]) assert.throws(() => createScenePhysics2DResizeProposal(circle, id(20), delta), invalid);
  for (const [view, length] of [[box, 2], [circle, 1]]) {
    const array = () => Array(length).fill(0), sparse = array(), inherited = array(), extra = array(), symbolic = array(), hidden = array();
    delete sparse[0]; Object.setPrototypeOf(inherited, Object.create(Array.prototype)); extra.extra = true; symbolic[Symbol('x')] = 1; Object.defineProperty(hidden, '0', { value: 0, enumerable: false });
    const replacements = [NaN, Infinity, -Infinity, '1', 0n].map(value => { const result = array(); result[0] = value; return result; });
    for (const delta of [null, {}, new Float32Array(length), sparse, inherited, extra, symbolic, hidden, ...replacements]) assert.throws(() => createScenePhysics2DResizeProposal(view, id(20), delta), invalid);
  }
});

test('current-shape matching rejects malformed records extra fields and unsafe vectors without coercion', () => {
  const { view } = fixture(), proposal = createScenePhysics2DResizeProposal(view, id(20), [1, 0]);
  const hidden = { kind: 'box', size: [40, 20] }; Object.defineProperty(hidden, 'size', { value: [40, 20], enumerable: false });
  const symbolic = { kind: 'box', size: [40, 20], [Symbol('x')]: 1 }, inherited = Object.create({ kind: 'box', size: [40, 20] });
  for (const value of [null, [], {}, { kind: 'box' }, { kind: 'box', size: [40, 20], radius: 20 }, { kind: 'box', size: ['40', 20] },
    { kind: 'box', size: [40, NaN] }, { kind: 'box', size: new Float32Array([40, 20]) }, { kind: 'circle', radius: '12' }, hidden, symbolic, inherited]) {
    assert.equal(scenePhysics2DResizeProposalMatches(proposal, view, id(20), value), false);
  }
  assert.equal(scenePhysics2DResizeProposalMatches(proposal, view, id(20), Object.assign(Object.create(null), { kind: 'box', size: [40, 20] })), true);
});

test('delta and current-shape accessors and serializers never execute during size admission', () => {
  const { view } = fixture(), proposal = createScenePhysics2DResizeProposal(view, id(20), [1, 0]); let reads = 0;
  const accessor = [0, 0]; Object.defineProperty(accessor, '0', { enumerable: true, get() { reads++; return 0; } });
  const serialized = [0, 0]; serialized.toJSON = () => { reads++; return [0, 0]; };
  for (const delta of [accessor, serialized]) assert.throws(() => createScenePhysics2DResizeProposal(view, id(20), delta), invalid);
  for (const property of ['kind', 'size']) {
    const currentShape = { kind: 'box', size: [40, 20] }; Object.defineProperty(currentShape, property, { enumerable: true, get() { reads++; return property === 'kind' ? 'box' : [40, 20]; } });
    assert.equal(scenePhysics2DResizeProposalMatches(proposal, view, id(20), currentShape), false);
  }
  const circle = fixture({ shape: { kind: 'circle', radius: 12 } }).view, circleProposal = createScenePhysics2DResizeProposal(circle, id(20), [1]);
  const currentCircle = { kind: 'circle' }; Object.defineProperty(currentCircle, 'radius', { enumerable: true, get() { reads++; return 12; } });
  assert.equal(scenePhysics2DResizeProposalMatches(circleProposal, circle, id(20), currentCircle), false);
  for (const proto of [Object.prototype, Array.prototype]) {
    const old = Object.getOwnPropertyDescriptor(proto, 'toJSON');
    try {
      Object.defineProperty(proto, 'toJSON', { configurable: true, get() { reads++; return () => ({}); } });
      assert.throws(() => createScenePhysics2DResizeProposal(view, id(20), [1, 0]), invalid);
      assert.equal(scenePhysics2DResizeProposalMatches(proposal, view, id(20), { kind: 'box', size: [40, 20] }), false);
    } finally { if (old) Object.defineProperty(proto, 'toJSON', old); else delete proto.toJSON; }
  }
  assert.equal(reads, 0);
});
