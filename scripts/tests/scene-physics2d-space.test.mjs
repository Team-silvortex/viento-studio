import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../adapters/node-studio-core.mjs';
import { SCENE_PHYSICS2D_SPACE_API_PATH, captureScenePhysics2DSpaceDirectory, captureScenePhysics2DSpace,
  isScenePhysics2DSpace, scenePhysics2DSpaceMatchSource, scenePhysics2DSpaceEqual,
  createScenePhysics2DSpaceView, isScenePhysics2DSpaceView } from '../../engine/scene-physics2d-space.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const revision = value => 'sha256:' + hash(value);
const invalid = { errorCode: 'scene_physics2d_space_invalid' };
const body = (n, instanceId, extra = {}) => ({ id: id(n), instanceId, kind: 'static', shape: { kind: 'box', size: [40, 20] }, offset: [0, 0], layer: 1, mask: 2, ...extra });
const physics = () => ({ format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: id(1), bodies: [body(20, id(8))] });
const source = () => { const content = '\ufeff' + JSON.stringify(physics(), null, '\t').replaceAll('\n', '\r\n');
  return { sourcePath: 'documents/physics/main.json', token: 'source:1', baseSourceRevision: revision(content), sourceRevision: revision(content), content }; };
const raw = () => ({ format: 'viento-scene-physics2d-space', schemaVersion: 1, worldId: 'world:' + hash('world'), revision: revision('world revision'),
  scene: { objectId: id(1), sourcePath: 'documents/scenes/main.json', sourceRevision: revision('scene'), title: '场景 / Scene / シーン', viewport: [64, 64], background: '#112233' },
  actors: [{ instanceId: id(8), objectId: id(3), name: '旅行者 🦊', sourcePath: 'documents/characters/traveler.md', sourceRevision: revision('actor'), position: [10, 20], size: [20, 40], color: '#AbCdEf' },
    { instanceId: id(9), objectId: id(3), name: '旅行者 🦊', sourcePath: 'documents/characters/traveler.md', sourceRevision: revision('actor'), position: [-20, 70], size: [10, 20], color: '#11223344' }] });
const catalog = (data = raw(), s = source()) => captureScenePhysics2DSpace(s, data);
function frozenTree(value) { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozenTree); } }

test('space observations preserve scene order and repeated definitions with detached immutable geometry', () => {
  assert.equal(SCENE_PHYSICS2D_SPACE_API_PATH, '/api/scene-physics2d-space');
  const input = raw(), captured = captureScenePhysics2DSpaceDirectory(input, id(1));
  assert.deepEqual(captured, input); assert.notEqual(captured, input); frozenTree(captured);
  input.actors[0].position[0] = 900; input.actors.reverse(); input.scene.viewport[0] = 400;
  assert.deepEqual(captured.actors.map(actor => actor.instanceId), [id(8), id(9)]);
  assert.deepEqual(captured.actors[0].position, [10, 20]); assert.deepEqual(captured.scene.viewport, [64, 64]);
});
test('source-bound space exposes only saved geometry and exact observation identity', () => {
  const s = source(), value = catalog(raw(), s); frozenTree(value);
  assert.deepEqual(Object.keys(value), ['worldId', 'revision', 'scene', 'actors']);
  assert.equal(isScenePhysics2DSpace(value), true); assert.equal(scenePhysics2DSpaceMatchSource(value, source()), true);
  s.token = 'changed'; assert.equal(scenePhysics2DSpaceMatchSource(value, source()), true);
  for (const [key, replacement] of Object.entries({ sourcePath: 'documents/physics/other.json', token: 'next', baseSourceRevision: revision('base'), sourceRevision: revision('draft'), content: source().content + ' ' })) {
    assert.equal(scenePhysics2DSpaceMatchSource(value, { ...source(), [key]: replacement }), false, key);
  }
});
test('directory and source equality includes world identity source identity and every geometry field', () => {
  const original = catalog(); assert.equal(scenePhysics2DSpaceEqual(original, catalog()), true);
  for (const mutate of [d => { d.worldId = 'world:' + hash('other'); }, d => { d.revision = revision('other'); },
    d => { d.scene.sourceRevision = revision('next'); }, d => { d.scene.title = 'next'; }, d => { d.scene.viewport[0] = 65; }, d => { d.scene.background = '#ffffff'; },
    d => { d.actors.reverse(); }, d => { d.actors[0].position[0] = 1; }, d => { d.actors[0].size[0] = 1; }, d => { d.actors[0].color = '#abcdef'; },
    d => { d.actors.forEach(actor => { actor.sourceRevision = revision('new actor'); }); }, d => { d.actors.forEach(actor => { actor.name = 'new'; }); }]) {
    const input = raw(); mutate(input); assert.equal(scenePhysics2DSpaceEqual(original, catalog(input)), false);
  }
  assert.equal(scenePhysics2DSpaceEqual(original, catalog(raw(), { ...source(), token: 'next' })), false);
});
test('serialization prototypes and ordinary directory capture cannot forge space or view brands', () => {
  const space = catalog(), view = createScenePhysics2DSpaceView(space, physics());
  for (const input of [null, {}, { ...space }, structuredClone(space), Object.create(space), captureScenePhysics2DSpaceDirectory(raw(), id(1))]) {
    assert.equal(isScenePhysics2DSpace(input), false); assert.equal(scenePhysics2DSpaceMatchSource(input, source()), false);
    assert.equal(scenePhysics2DSpaceEqual(space, input), false); assert.equal(scenePhysics2DSpaceEqual(input, space), false);
    assert.throws(() => createScenePhysics2DSpaceView(input, physics()), invalid);
  }
  assert.equal(isScenePhysics2DSpaceView(view), true);
  for (const input of [null, {}, { ...view }, structuredClone(view), Object.create(view), space]) assert.equal(isScenePhysics2DSpaceView(input), false);
});
test('source must belong to the selected scene and cannot alias a geometry source', () => {
  const s = source(), input = raw(); input.scene.objectId = id(99);
  assert.throws(() => catalog(input, s), invalid);
  for (const sourcePath of [raw().scene.sourcePath, raw().actors[0].sourcePath.replace(/md$/, 'json')]) {
    const data = raw(); if (sourcePath !== data.scene.sourcePath) data.actors.forEach(actor => { actor.sourcePath = sourcePath; });
    assert.throws(() => catalog(data, { ...s, sourcePath }), invalid);
  }
  assert.equal(scenePhysics2DSpaceMatchSource(catalog(), { ...s, content: '{}' }), false);
});
test('rectangle and circle geometry use actor centers plus offsets and fit the entire scene', () => {
  const document = physics(); document.bodies[0].offset = [-20, -30];
  document.bodies.push(body(21, id(9), { kind: 'sensor', shape: { kind: 'circle', radius: 16 }, offset: [10, 10] }));
  const before = structuredClone(document), space = catalog(), view = createScenePhysics2DSpaceView(space, document);
  assert.deepEqual(view.bodies.map(body => body.center), [[-10, -10], [-10, 80]]);
  assert.deepEqual(view.bounds, { left: -30, top: -20, right: 64, bottom: 96, width: 94, height: 116 });
  assert.deepEqual(view.bodies.map(body => body.id), [id(20), id(21)]); assert.deepEqual(view.missingBodies, []);
  assert.deepEqual(view.scene, space.scene); assert.deepEqual(view.actors, space.actors); frozenTree(view); assert.deepEqual(document, before);
  document.bodies[0].shape.size[0] = 80; assert.equal(view.bodies[0].shape.size[0], 40);
});
test('missing targets remain explicit and never borrow another instance of the same definition', () => {
  const document = physics(); document.bodies = [body(21, id(99), { offset: [8192, 8192] }), body(20, id(8))];
  const view = createScenePhysics2DSpaceView(catalog(), document);
  assert.deepEqual(view.bodies.map(body => body.instanceId), [id(8)]);
  assert.deepEqual(view.missingBodies, [document.bodies[0]]); assert.equal(Object.hasOwn(view.missingBodies[0], 'center'), false);
  assert.deepEqual(view.bounds, { left: -25, top: 0, right: 64, bottom: 80, width: 89, height: 80 });
});
test('world bounds include extreme actors and collider extents without clipping or numeric overflow', () => {
  const data = raw(); data.actors[0].position = [-100000, 100000]; data.actors[0].size = [2048, 2048];
  const document = physics(); document.bodies[0].offset = [-8192, 8192]; document.bodies[0].shape = { kind: 'circle', radius: 4096 };
  const view = createScenePhysics2DSpaceView(catalog(data), document);
  assert.deepEqual(view.bodies[0].center, [-108192, 108192]);
  assert.equal(view.bounds.left, -112288); assert.equal(view.bounds.bottom, 112288);
  assert.ok(Object.values(view.bounds).every(Number.isFinite));
});
test('view validation uses full physics rules and the selected scene before returning any geometry', () => {
  for (const mutate of [d => { d.sceneObjectId = id(99); }, d => { d.bodies = []; }, d => { d.bodies[0].shape.size[0] = 0; },
    d => { d.bodies[0].offset[0] = Infinity; }, d => { d.bodies[0].layer = 65536; }, d => { d.bodies.push(body(22, id(8))); }]) {
    const document = physics(); mutate(document); assert.throws(() => createScenePhysics2DSpaceView(catalog(), document), invalid);
  }
  let reads = 0; const document = physics(); Object.defineProperty(document.bodies[0], 'offset', { enumerable: true, get() { reads++; return [0, 0]; } });
  assert.throws(() => createScenePhysics2DSpaceView(catalog(), document), invalid); assert.equal(reads, 0);
});
test('all observation record and vector boundaries reject accessors without evaluating them', () => {
  let reads = 0;
  for (const mutate of [d => Object.defineProperty(d, 'scene', { enumerable: true, get() { reads++; return raw().scene; } }),
    d => Object.defineProperty(d.scene, 'viewport', { enumerable: true, get() { reads++; return [64, 64]; } }),
    d => Object.defineProperty(d.actors, '0', { enumerable: true, get() { reads++; return raw().actors[0]; } }),
    d => Object.defineProperty(d.actors[0], 'position', { enumerable: true, get() { reads++; return [0, 0]; } }),
    d => Object.defineProperty(d.actors[0].position, '0', { enumerable: true, get() { reads++; return 0; } }),
    d => Object.defineProperty(d.actors[0].size, '1', { enumerable: true, get() { reads++; return 1; } })]) {
    const data = raw(); mutate(data); assert.throws(() => captureScenePhysics2DSpaceDirectory(data, id(1)), invalid);
  }
  assert.equal(reads, 0);
});
test('extra hidden symbolic and inherited data cannot enter observations', () => {
  for (const mutate of [d => { d.extra = true; }, d => { d.scene[Symbol('x')] = 1; }, d => { d.actors[0].extra = true; },
    d => Object.defineProperty(d.scene, 'title', { value: 'hidden', enumerable: false }),
    d => Object.setPrototypeOf(d, { extra: true }), d => Object.setPrototypeOf(d.scene, { extra: true }),
    d => Object.setPrototypeOf(d.actors[0], { extra: true }), d => Object.setPrototypeOf(d.actors, Object.create(Array.prototype)),
    d => { delete d.actors[0]; }, d => { d.actors.extra = true; }, d => { d.actors[0].position.extra = true; },
    d => { delete d.actors[0].position[0]; }, d => { d.scene.viewport = new Float32Array([64, 64]); }]) {
    const data = raw(); mutate(data); assert.throws(() => captureScenePhysics2DSpaceDirectory(data, id(1)), invalid);
  }
  const data = raw(); data.scene = Object.assign(Object.create(null), data.scene); data.actors = data.actors.map(a => Object.assign(Object.create(null), a));
  assert.deepEqual(captureScenePhysics2DSpaceDirectory(Object.assign(Object.create(null), data), id(1)), raw());
});
test('ambient serializers are rejected without calling toJSON getters', () => {
  let reads = 0;
  for (const proto of [Object.prototype, Array.prototype]) {
    const input = raw(), previous = Object.getOwnPropertyDescriptor(proto, 'toJSON');
    try { Object.defineProperty(proto, 'toJSON', { configurable: true, get() { reads++; return () => {}; } });
      assert.throws(() => captureScenePhysics2DSpaceDirectory(input, id(1)), invalid);
    } finally { if (previous) Object.defineProperty(proto, 'toJSON', previous); else delete proto.toJSON; }
  }
  assert.equal(reads, 0);
});
test('scene and observation identities reject unsupported formats invalid revisions and trailing newlines', () => {
  for (const mutate of [d => { d.format = 'other'; }, d => { d.schemaVersion = 2; }, d => { d.worldId += '\n'; }, d => { d.revision += '\n'; },
    d => { d.scene.objectId += '\n'; }, d => { d.scene.sourceRevision += '\n'; }, d => { d.actors[0].instanceId += '\n'; },
    d => { d.actors[0].objectId += '\n'; }, d => { d.actors[0].sourceRevision += '\n'; }, d => { d.actors[0].sourceRevision = 'sha256:invalid'; }]) {
    const data = raw(); mutate(data); assert.throws(() => captureScenePhysics2DSpaceDirectory(data, id(1)), invalid);
  }
  for (const sceneId of [null, id(99), id(1) + '\n']) assert.throws(() => captureScenePhysics2DSpaceDirectory(raw(), sceneId), invalid);
});
test('actor membership and repeated definition identity remain coherent without conflating geometry', () => {
  for (const mutate of [d => { d.actors[1].instanceId = id(8); }, d => { d.actors[1].name = 'different'; },
    d => { d.actors[1].sourceRevision = revision('different'); }, d => { d.actors[1].sourcePath = 'documents/other.md'; },
    d => { d.actors[1].objectId = id(4); }, d => { d.actors[1].objectId = id(1); }, d => { d.actors[1].sourcePath = d.scene.sourcePath; }]) {
    const data = raw(); mutate(data); assert.throws(() => captureScenePhysics2DSpaceDirectory(data, id(1)), invalid);
  }
  const data = raw(); data.actors[1].color = '#000000'; data.actors[1].size = [2048, 1]; data.actors[1].position = [-100000, 100000];
  assert.ok(captureScenePhysics2DSpaceDirectory(data, id(1)));
});
test('geometry bounds reject coercion nonfinite fractions and unsupported colors', () => {
  for (const mutate of [d => { d.scene.viewport = [63, 64]; }, d => { d.scene.viewport = [64, 4097]; }, d => { d.scene.viewport = [64.5, 64]; },
    d => { d.actors[0].position = [NaN, 0]; }, d => { d.actors[0].position = [0, Infinity]; }, d => { d.actors[0].position = [100001, 0]; },
    d => { d.actors[0].position = ['10', 20]; }, d => { d.actors[0].position = [10]; }, d => { d.actors[0].size = [0, 1]; },
    d => { d.actors[0].size = [2049, 1]; }, d => { d.scene.background = 'red'; }, d => { d.actors[0].color = '#ffffff\n'; }]) {
    const data = raw(); mutate(data); assert.throws(() => captureScenePhysics2DSpaceDirectory(data, id(1)), invalid);
  }
});
test('labels and paths have bounded Unicode-safe display values and normalized relative identities', () => {
  for (const mutate of [d => { d.scene.title = 'x'.repeat(161); }, d => { d.scene.title = '\ud800'; }, d => { d.scene.title = '   '; },
    d => { d.actors[0].name = 'bad\u007f'; }, d => { d.actors[0].name = '\n'; }, d => { d.actors[0].sourcePath = 'x'.repeat(4097); },
    d => { d.scene.sourcePath = '../scene.json'; }, d => { d.scene.sourcePath = 'documents/scene.JSON'; }, d => { d.scene.sourcePath = '/scene.json'; },
    d => { d.actors[0].sourcePath = 'C:actor.md'; }, d => { d.actors[0].sourcePath = 'documents\\actor.md'; },
    d => { d.actors[0].sourcePath = 'documents//actor.md'; }, d => { d.actors[0].sourcePath = 'documents/\ud800.md'; }]) {
    const data = raw(); mutate(data); assert.throws(() => captureScenePhysics2DSpaceDirectory(data, id(1)), invalid);
  }
  const data = raw(); data.scene.title = '<文字 & text>'; data.actors.forEach(a => { a.name = '名'.repeat(160); });
  assert.ok(captureScenePhysics2DSpaceDirectory(data, id(1)));
});
test('space actor budget is one through 128 with no invented candidates', () => {
  const data = raw(); data.actors = [data.actors[0]]; assert.ok(captureScenePhysics2DSpaceDirectory(data, id(1)));
  data.actors = Array.from({ length: 128 }, (_, index) => ({ ...raw().actors[0], instanceId: id(1000 + index) }));
  assert.equal(captureScenePhysics2DSpaceDirectory(data, id(1)).actors.length, 128);
  data.actors.push({ ...data.actors[0], instanceId: id(2000) }); assert.throws(() => captureScenePhysics2DSpaceDirectory(data, id(1)), invalid);
  data.actors = []; assert.throws(() => captureScenePhysics2DSpaceDirectory(data, id(1)), invalid);
});
