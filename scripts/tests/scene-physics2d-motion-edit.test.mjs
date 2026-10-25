import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readScenePhysics2DDocument, createScenePhysics2DProposal, prepareScenePhysics2DApply } from '../../engine/scene-physics2d-edit.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const body = n => ({ id: id(n), instanceId: id(1000 + n), kind: 'character', shape: { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 2 });
const motion = () => ({ kind: 'platformer', gravity: 980, jumpSpeed: 360, maxFallSpeed: 1200 });
const document = (version = 3) => ({ format: 'viento-scene-physics2d', schemaVersion: version, sceneObjectId: id(900),
  bodies: [{ ...body(1), ...(version === 3 ? { collisionResponse: 'slide', characterMotion: motion() } : {}) }, body(2)] });
const hash = s => createHash('sha256').update(s).digest('hex');
const encode = (value, newline = '\r\n') => '\ufeff' + JSON.stringify(value, null, '\t').replaceAll('\n', newline) + newline;
const source = content => ({ sourcePath: 'documents/physics.json', token: 'test:1', content, sourceRevision: 'sha256:' + hash(content), baseSourceRevision: 'sha256:' + hash(content) });
const edit = value => ({ bodies: structuredClone(value.bodies) });
const slice = (content, pointer) => { const range = locateJsonSource(parseJsonSource(content), pointer); return content.slice(range.start, range.end); };
const read = content => JSON.parse(content.replace(/^\ufeff/, ''));
const invalid = { errorCode: 'scene_physics2d_authoring_invalid' };

test('enabling motion explicitly upgrades schema1 or schema2 with two fields and preserves source style and unrelated values', async () => {
  for (const version of [1, 2]) for (const newline of [null, '\n', '\r\n', '\r']) {
    const value = document(version), content = (newline ? encode(value, newline) : JSON.stringify(value))
      .replace('"layer": 1', '"layer": 1e0').replace('"layer":1,', '"layer":1e0,');
    const form = edit(value); Object.assign(form.bodies[0], { collisionResponse: 'slide', characterMotion: motion() });
    const proposal = await createScenePhysics2DProposal(source(content), form);
    assert.deepEqual(proposal.changedPaths, ['/schemaVersion', '/bodies/0/collisionResponse', '/bodies/0/characterMotion']);
    assert.deepEqual(read(proposal.afterContent), { ...value, schemaVersion: 3, bodies: form.bodies });
    assert.equal(slice(content, '/bodies/1'), slice(proposal.afterContent, '/bodies/1'));
    for (const field of ['id', 'instanceId', 'kind', 'shape', 'offset', 'layer', 'mask']) {
      assert.equal(slice(content, '/bodies/0/' + field), slice(proposal.afterContent, '/bodies/0/' + field));
    }
    if (newline) {
      assert.ok(proposal.afterContent.startsWith('\ufeff'));
      assert.equal(proposal.afterContent.replaceAll(newline, '').includes('\n'), false);
    }
    assert.equal((await prepareScenePhysics2DApply(source(content), proposal, { digest: hash })).afterContent, proposal.afterContent);
  }
});

test('untouched legacy declarations never upgrade and schema3 removal never downgrades or discards slide', async () => {
  for (const version of [1, 2]) {
    const value = document(version), form = edit(value), content = encode(value); form.bodies[0].offset[0] = 4;
    const proposal = await createScenePhysics2DProposal(source(content), form);
    assert.equal(read(proposal.afterContent).schemaVersion, version);
    assert.equal(Object.hasOwn(read(proposal.afterContent).bodies[0], 'characterMotion'), false);
    assert.deepEqual(proposal.changedPaths, ['/bodies/0/offset/0']);
  }
  const value = document(), content = encode(value).replace('"schemaVersion": 3', '"schemaVersion": 3e0'), form = edit(value);
  delete form.bodies[0].characterMotion;
  const proposal = await createScenePhysics2DProposal(source(content), form);
  assert.deepEqual(proposal.changedPaths, ['/bodies/0/characterMotion']);
  assert.equal(slice(proposal.afterContent, '/schemaVersion'), '3e0');
  assert.equal(read(proposal.afterContent).bodies[0].collisionResponse, 'slide');
  assert.deepEqual(await readScenePhysics2DDocument(proposal.afterContent), { ...value, bodies: form.bodies });
  await assert.rejects(createScenePhysics2DProposal(source(proposal.afterContent), form), { errorCode: 'scene_physics2d_authoring_unchanged' });
});

test('motion numeric changes patch individual leaves and retain key escapes exponent lexemes signed zero and other bodies', async () => {
  const value = document(); value.bodies[0].characterMotion.jumpSpeed = 0;
  const content = encode(value).replace('"schemaVersion": 3', '"schemaVersion": 3e0')
    .replace('"characterMotion"', '"characterMotio\\u006e"').replace('"gravity": 980', '"grav\\u0069ty": 9.80e2')
    .replace('"jumpSpeed": 0', '"jumpSpeed": -0').replace('"maxFallSpeed": 1200', '"maxFallSpeed": 1.2e3');
  const form = edit(value); form.bodies[0].characterMotion.gravity = 1234.5;
  const proposal = await createScenePhysics2DProposal(source(content), form);
  assert.equal(proposal.afterContent, content.replace('9.80e2', '1234.5'));
  assert.deepEqual(proposal.changedPaths, ['/bodies/0/characterMotion/gravity']);
  const next = edit(value); next.bodies[0].characterMotion.jumpSpeed = 420; next.bodies[0].characterMotion.maxFallSpeed = 1500;
  const result = await createScenePhysics2DProposal(source(content), next);
  assert.equal(result.afterContent, content.replace('"jumpSpeed": -0', '"jumpSpeed": 420').replace('1.2e3', '1500'));
  assert.deepEqual(result.changedPaths, ['/bodies/0/characterMotion/jumpSpeed', '/bodies/0/characterMotion/maxFallSpeed']);
});

test('deleting both optional fields handles every key ordering without overlap or unrelated reserialization', async () => {
  for (const newline of [null, '\r\n']) for (let responseAt = 0; responseAt < 9; responseAt++) for (let motionAt = 0; motionAt < 9; motionAt++) {
    if (responseAt === motionAt) continue;
    const value = document(), remaining = Object.entries(body(1));
    value.bodies[0] = Object.fromEntries(Array.from({ length: 9 }, (_, index) => index === responseAt
      ? ['collisionResponse', 'slide'] : index === motionAt ? ['characterMotion', motion()] : remaining.shift()));
    const content = (newline ? encode(value, newline) : JSON.stringify(value))
      .replace('"collisionResponse"', '"collisionRespon\\u0073e"').replace('"characterMotion"', '"characterMotio\\u006e"');
    const form = edit(value); delete form.bodies[0].collisionResponse; delete form.bodies[0].characterMotion;
    form.bodies[0].kind = 'static'; form.bodies[0].mask = 7;
    const proposal = await createScenePhysics2DProposal(source(content), form);
    assert.deepEqual(read(proposal.afterContent), { ...value, bodies: form.bodies });
    assert.deepEqual(new Set(proposal.changedPaths), new Set(['/bodies/0/kind', '/bodies/0/mask', '/bodies/0/collisionResponse', '/bodies/0/characterMotion']));
    assert.equal(slice(content, '/bodies/1'), slice(proposal.afterContent, '/bodies/1'));
    for (const field of ['id', 'instanceId', 'shape', 'offset', 'layer']) {
      assert.equal(slice(content, '/bodies/0/' + field), slice(proposal.afterContent, '/bodies/0/' + field));
    }
  }
});

test('removing motion and changing its adjacent response composes without losing the new response value', async () => {
  for (const first of [true, false]) {
    const value = document(), base = body(1);
    value.bodies[0] = first ? { characterMotion: motion(), collisionResponse: 'slide', ...base }
      : { ...base, collisionResponse: 'slide', characterMotion: motion() };
    const content = encode(value), form = edit(value); delete form.bodies[0].characterMotion; form.bodies[0].collisionResponse = 'stop';
    const proposal = await createScenePhysics2DProposal(source(content), form);
    assert.deepEqual(read(proposal.afterContent), { ...value, bodies: form.bodies });
    assert.deepEqual(proposal.changedPaths, ['/bodies/0/collisionResponse', '/bodies/0/characterMotion']);
  }
});

test('motion changes compose with retained rows deletion and new rows while original source order stays authoritative', async () => {
  const value = document(1), content = encode(value), form = edit(value); form.bodies.shift();
  Object.assign(form.bodies[0], { collisionResponse: 'slide', characterMotion: motion() });
  form.bodies.push({ ...body(3), collisionResponse: 'slide', characterMotion: { ...motion(), jumpSpeed: 0 } });
  const proposal = await createScenePhysics2DProposal(source(content), form);
  assert.deepEqual(read(proposal.afterContent), { ...value, schemaVersion: 3, bodies: form.bodies });
  assert.deepEqual(proposal.changedPaths, ['/schemaVersion', '/bodies']);
});

test('motion edit capture rejects malformed nested values extra keys unsupported kinds and non-slide bodies', async () => {
  const mutations = [b => b.characterMotion = null, b => b.characterMotion = [], b => b.characterMotion.kind = 'gravity',
    b => b.characterMotion.gravity = 20001, b => b.characterMotion.jumpSpeed = -1, b => b.characterMotion.maxFallSpeed = 0,
    b => b.characterMotion.extra = true, b => delete b.characterMotion.jumpSpeed, b => b.kind = 'static', b => b.kind = 'sensor',
    b => b.collisionResponse = 'stop', b => delete b.collisionResponse, b => b.extra = true];
  for (const mutate of mutations) {
    const value = document(), form = edit(value); mutate(form.bodies[0]);
    await assert.rejects(createScenePhysics2DProposal(source(encode(value)), form), invalid);
  }
  let calls = 0;
  for (const field of ['characterMotion', 'gravity']) {
    const value = document(), form = edit(value), target = field === 'characterMotion' ? form.bodies[0] : form.bodies[0].characterMotion;
    Object.defineProperty(target, field, { enumerable: true, get() { calls++; return motion(); } });
    await assert.rejects(createScenePhysics2DProposal(source(encode(value)), form), invalid);
  }
  const value = document(), form = edit(value); form.bodies[0].characterMotion.toJSON = () => { calls++; return motion(); };
  await assert.rejects(createScenePhysics2DProposal(source(encode(value)), form), invalid); assert.equal(calls, 0);
});

test('captured nested motion is detached before async work and apply still requires exact source revision and token', async () => {
  const value = document(1), content = encode(value), form = edit(value);
  Object.assign(form.bodies[0], { collisionResponse: 'slide', characterMotion: motion() });
  const pending = createScenePhysics2DProposal(source(content), form); form.bodies[0].characterMotion.gravity = 1;
  const proposal = await pending;
  assert.equal(read(proposal.afterContent).bodies[0].characterMotion.gravity, 980);
  assert.equal(Object.isFrozen(proposal.edit.bodies[0].characterMotion), true);
  await assert.rejects(prepareScenePhysics2DApply({ ...source(content), token: 'different' }, proposal, { digest: hash }), { errorCode: 'scene_physics2d_authoring_conflict' });
  assert.equal((await prepareScenePhysics2DApply(source(content), proposal, { digest: hash })).afterContent, proposal.afterContent);
});

test('motion insertion respects original 64KiB source budget including whitespace', async () => {
  const value = document(1), raw = encode(value), content = raw + ' '.repeat(65536 - Buffer.byteLength(raw)), form = edit(value);
  Object.assign(form.bodies[0], { collisionResponse: 'slide', characterMotion: motion() });
  await assert.rejects(createScenePhysics2DProposal(source(content), form), invalid);
});

for (const action of ['offset', 'resize']) test(`schema3 ${action} space proposals retain motion, response and exact untouched source`, async () => {
  const { captureScenePhysics2DSpace, createScenePhysics2DSpaceView } = await import('../../engine/scene-physics2d-space.mjs');
  const { createScenePhysics2DOffsetProposal } = await import('../../engine/scene-physics2d-space-edit.mjs');
  const { createScenePhysics2DResizeProposal } = await import('../../engine/scene-physics2d-space-resize.mjs');
  for (const shape of [{ kind: 'box', size: [32, 48] }, { kind: 'circle', radius: 16 }]) {
    const value = document(); value.bodies[0].shape = shape;
    const content = encode(value).replace('"schemaVersion": 3', '"schemaVersion": 3e0')
      .replace('"characterMotion"', '"characterMotio\\u006e"').replace('"gravity": 980', '"grav\\u0069ty": 9.80e2');
    const input = source(content), revision = text => 'sha256:' + hash(text);
    const raw = { format: 'viento-scene-physics2d-space', schemaVersion: 1, worldId: 'world:' + hash('world'), revision: revision('world'),
      scene: { objectId: id(900), sourcePath: 'documents/scenes/main.json', sourceRevision: revision('scene'), title: 'Scene', viewport: [640, 480], background: '#112233' },
      actors: value.bodies.map((body, index) => ({ instanceId: body.instanceId, objectId: id(700), name: 'Actor', sourcePath: 'documents/characters/actor.md', sourceRevision: revision('actor'), position: [100 + index * 30, 200], size: [20, 40], color: '#abcdef' })) };
    const checked = await readScenePhysics2DDocument(content), view = createScenePhysics2DSpaceView(captureScenePhysics2DSpace(input, raw), checked);
    const form = edit(checked);
    const adjustment = action === 'offset' ? createScenePhysics2DOffsetProposal(view, value.bodies[0].id, [3, 0])
      : createScenePhysics2DResizeProposal(view, value.bodies[0].id, shape.kind === 'box' ? [0, 5] : [2]);
    if (action === 'offset') form.bodies[0].offset = [...adjustment.offset]; else form.bodies[0].shape = structuredClone(adjustment.shape);
    const proposal = await createScenePhysics2DProposal(input, form), result = await prepareScenePhysics2DApply(input, proposal, { digest: hash });
    assert.equal(slice(result.afterContent, '/schemaVersion'), '3e0');
    assert.equal(slice(result.afterContent, '/bodies/0/characterMotion'), slice(content, '/bodies/0/characterMotion'));
    assert.equal(slice(result.afterContent, '/bodies/0/collisionResponse'), slice(content, '/bodies/0/collisionResponse'));
    assert.equal(slice(result.afterContent, '/bodies/1'), slice(content, '/bodies/1'));
    assert.ok(result.afterContent.includes('"characterMotio\\u006e"'));
    assert.deepEqual(result.changedPaths, [action === 'offset' ? '/bodies/0/offset/0' : shape.kind === 'box' ? '/bodies/0/shape/size/1' : '/bodies/0/shape/radius']);
  }
});
