import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readScenePhysics2DDocument, createScenePhysics2DProposal, prepareScenePhysics2DApply } from '../../engine/scene-physics2d-edit.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const body = (n, kind = 'static') => ({ id: id(n), instanceId: id(1000 + n), kind, shape: { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 2 });
const motion = () => ({ kind: 'platformer', gravity: 980, jumpSpeed: 360, maxFallSpeed: 1200 });
const document = (version = 4) => ({ format: 'viento-scene-physics2d', schemaVersion: version, sceneObjectId: id(900),
  bodies: [{ ...body(1), ...(version === 4 ? { oneWay: { margin: 1 } } : {}) },
    { ...body(2, 'character'), ...(version >= 3 ? { collisionResponse: 'slide', characterMotion: motion() } : {}) }] });
const hash = s => createHash('sha256').update(s).digest('hex');
const encode = (value, newline = '\r\n') => '\ufeff' + JSON.stringify(value, null, '\t').replaceAll('\n', newline) + newline;
const source = content => ({ sourcePath: 'documents/physics.json', token: 'test:1', content, sourceRevision: 'sha256:' + hash(content), baseSourceRevision: 'sha256:' + hash(content) });
const edit = value => ({ bodies: structuredClone(value.bodies) });
const slice = (content, pointer) => { const range = locateJsonSource(parseJsonSource(content), pointer); return content.slice(range.start, range.end); };
const read = content => JSON.parse(content.replace(/^\ufeff/, ''));
const invalid = { errorCode: 'scene_physics2d_authoring_invalid' };

test('enabling one-way platforms upgrades only explicit schema1/2/3 edits and preserves original source style', async () => {
  for (const version of [1, 2, 3]) for (const newline of [null, '\n', '\r\n', '\r']) {
    const value = document(version), content = (newline ? encode(value, newline) : JSON.stringify(value))
      .replace('"layer": 1', '"layer": 1e0').replace('"layer":1,', '"layer":1e0,');
    const form = edit(value); form.bodies[0].oneWay = { margin: 1 };
    const proposal = await createScenePhysics2DProposal(source(content), form);
    assert.deepEqual(proposal.changedPaths, ['/schemaVersion', '/bodies/0/oneWay']);
    assert.deepEqual(read(proposal.afterContent), { ...value, schemaVersion: 4, bodies: form.bodies });
    assert.equal(slice(content, '/bodies/1'), slice(proposal.afterContent, '/bodies/1'));
    for (const field of ['id', 'instanceId', 'kind', 'shape', 'offset', 'layer', 'mask']) assert.equal(slice(content, '/bodies/0/' + field), slice(proposal.afterContent, '/bodies/0/' + field));
    if (newline) { assert.ok(proposal.afterContent.startsWith('\ufeff')); assert.equal(proposal.afterContent.replaceAll(newline, '').includes('\n'), false); }
  }
});

test('ordinary legacy edits never enable one-way platforms and removal preserves schema4 and existing motion', async () => {
  for (const version of [1, 2, 3]) {
    const value = document(version), form = edit(value); form.bodies[0].offset[0] = 4;
    const proposal = await createScenePhysics2DProposal(source(encode(value)), form);
    assert.equal(read(proposal.afterContent).schemaVersion, version);
    assert.equal(Object.hasOwn(read(proposal.afterContent).bodies[0], 'oneWay'), false);
    assert.deepEqual(proposal.changedPaths, ['/bodies/0/offset/0']);
  }
  const value = document(), content = encode(value).replace('"schemaVersion": 4', '"schemaVersion": 4e0'), form = edit(value);
  delete form.bodies[0].oneWay;
  const proposal = await createScenePhysics2DProposal(source(content), form);
  assert.deepEqual(proposal.changedPaths, ['/bodies/0/oneWay']); assert.equal(slice(proposal.afterContent, '/schemaVersion'), '4e0');
  assert.equal(slice(proposal.afterContent, '/bodies/1'), slice(content, '/bodies/1'));
  assert.deepEqual(await readScenePhysics2DDocument(proposal.afterContent), { ...value, bodies: form.bodies });
  await assert.rejects(createScenePhysics2DProposal(source(proposal.afterContent), form), { errorCode: 'scene_physics2d_authoring_unchanged' });
});

test('margin changes patch only the escaped leaf while retaining BOM CRLF exponents signed zero and inherited motion', async () => {
  const value = document(), content = encode(value).replace('"schemaVersion": 4', '"schemaVersion": 4e0')
    .replace('"oneWay"', '"oneWa\\u0079"').replace('"margin": 1', '"marg\\u0069n": 1.00e0').replace('"gravity": 980', '"gravity": 9.80e2');
  const form = edit(value); form.bodies[0].oneWay.margin = 1.125;
  const proposal = await createScenePhysics2DProposal(source(content), form);
  assert.equal(proposal.afterContent, content.replace('1.00e0', '1.125'));
  assert.deepEqual(proposal.changedPaths, ['/bodies/0/oneWay/margin']);
  const at = locateJsonSource(parseJsonSource(content), '/bodies/0/offset/0');
  const zero = content.slice(0, at.start) + '-0' + content.slice(at.end), zeroForm = edit(read(zero)); zeroForm.bodies[0].oneWay.margin = 2;
  const preserved = await createScenePhysics2DProposal(source(zero), zeroForm);
  assert.equal(slice(preserved.afterContent, '/bodies/0/offset/0'), '-0');
  assert.equal(slice(preserved.afterContent, '/bodies/1'), slice(content, '/bodies/1'));
});

test('replacing one-way with slide and motion composes one removal with two additions for every key position', async () => {
  for (const newline of [null, '\r\n']) for (let at = 0; at < 8; at++) {
    const value = document(), base = Object.entries(body(1));
    value.bodies[0] = Object.fromEntries(Array.from({ length: 8 }, (_, index) => index === at ? ['oneWay', { margin: 1.5 }] : base.shift()));
    const content = (newline ? encode(value, newline) : JSON.stringify(value)).replace('"oneWay"', '"oneWa\\u0079"');
    const form = edit(value); delete form.bodies[0].oneWay;
    Object.assign(form.bodies[0], { kind: 'character', collisionResponse: 'slide', characterMotion: motion() });
    const proposal = await createScenePhysics2DProposal(source(content), form);
    assert.deepEqual(read(proposal.afterContent), { ...value, bodies: form.bodies });
    assert.deepEqual(new Set(proposal.changedPaths), new Set(['/bodies/0/kind', '/bodies/0/oneWay', '/bodies/0/collisionResponse', '/bodies/0/characterMotion']));
    for (const field of ['id', 'instanceId', 'shape', 'offset', 'layer', 'mask']) assert.equal(slice(content, '/bodies/0/' + field), slice(proposal.afterContent, '/bodies/0/' + field));
    assert.equal(slice(content, '/bodies/1'), slice(proposal.afterContent, '/bodies/1'));
  }
});

test('replacing slide and motion with one-way handles adjacent and separated optional keys without overlapping patches', async () => {
  for (const newline of [null, '\r\n']) for (let responseAt = 0; responseAt < 9; responseAt++) for (let motionAt = 0; motionAt < 9; motionAt++) {
    if (responseAt === motionAt) continue;
    const value = document(), remaining = Object.entries(body(1, 'character'));
    value.bodies[0] = Object.fromEntries(Array.from({ length: 9 }, (_, index) => index === responseAt ? ['collisionResponse', 'slide']
      : index === motionAt ? ['characterMotion', motion()] : remaining.shift()));
    const content = (newline ? encode(value, newline) : JSON.stringify(value))
      .replace('"collisionResponse"', '"collisionRespon\\u0073e"').replace('"characterMotion"', '"characterMotio\\u006e"');
    const form = edit(value); delete form.bodies[0].collisionResponse; delete form.bodies[0].characterMotion;
    Object.assign(form.bodies[0], { kind: 'static', oneWay: { margin: 64 } });
    const proposal = await createScenePhysics2DProposal(source(content), form);
    assert.deepEqual(read(proposal.afterContent), { ...value, bodies: form.bodies });
    assert.deepEqual(new Set(proposal.changedPaths), new Set(['/bodies/0/kind', '/bodies/0/oneWay', '/bodies/0/collisionResponse', '/bodies/0/characterMotion']));
    for (const field of ['id', 'instanceId', 'shape', 'offset', 'layer', 'mask']) assert.equal(slice(content, '/bodies/0/' + field), slice(proposal.afterContent, '/bodies/0/' + field));
    assert.equal(slice(content, '/bodies/1'), slice(proposal.afterContent, '/bodies/1'));
  }
});

test('one-way removal composes with a same-review switch to circular or nonstatic bodies', async () => {
  for (const mode of ['circle', 'sensor', 'character']) {
    const value = document(), content = encode(value), form = edit(value); delete form.bodies[0].oneWay;
    if (mode === 'circle') form.bodies[0].shape = { kind: 'circle', radius: 16 }; else form.bodies[0].kind = mode;
    const proposal = await createScenePhysics2DProposal(source(content), form);
    assert.deepEqual(read(proposal.afterContent), { ...value, bodies: form.bodies });
    assert.equal(slice(proposal.afterContent, '/bodies/1'), slice(content, '/bodies/1'));
  }
});

test('one-way leaf edits compose with removed and newly appended bodies while retaining row source order', async () => {
  const value = document(), content = encode(value), form = edit(value); form.bodies.pop(); form.bodies[0].oneWay.margin = 8;
  form.bodies.push({ ...body(3), oneWay: { margin: 1 } });
  const proposal = await createScenePhysics2DProposal(source(content), form);
  assert.deepEqual(read(proposal.afterContent), { ...value, bodies: form.bodies }); assert.deepEqual(proposal.changedPaths, ['/bodies']);
  assert.equal(slice(content, '/bodies/0/shape'), slice(proposal.afterContent, '/bodies/0/shape'));
});

test('invalid optional objects ranges shapes and capture hooks cannot enter a source proposal', async () => {
  const mutations = [b => b.oneWay = null, b => b.oneWay = [], b => b.oneWay = true, b => b.oneWay = {}, b => b.oneWay.margin = -1, b => b.oneWay.margin = 0, b => b.oneWay.margin = .999,
    b => b.oneWay.margin = 65, b => b.oneWay.margin = Infinity, b => b.oneWay.margin = NaN, b => b.oneWay.margin = '1', b => b.oneWay.extra = true,
    b => b.kind = 'character', b => b.kind = 'sensor', b => b.shape = { kind: 'circle', radius: 16 }, b => b.extra = true];
  for (const mutate of mutations) { const value = document(), form = edit(value); mutate(form.bodies[0]); await assert.rejects(createScenePhysics2DProposal(source(encode(value)), form), invalid); }
  let calls = 0;
  for (const field of ['oneWay', 'margin']) {
    const value = document(), form = edit(value), target = field === 'oneWay' ? form.bodies[0] : form.bodies[0].oneWay;
    Object.defineProperty(target, field, { enumerable: true, get() { calls++; return 1; } });
    await assert.rejects(createScenePhysics2DProposal(source(encode(value)), form), invalid);
  }
  const value = document(), form = edit(value); form.bodies[0].oneWay.toJSON = () => { calls++; return { margin: 1 }; };
  await assert.rejects(createScenePhysics2DProposal(source(encode(value)), form), invalid); assert.equal(calls, 0);
  for (const [from, to] of [['"margin": 1', '"margin": 0,"marg\\u0069n": 1'], ['"oneWay":', '"oneWa\\u0079": null,"oneWay":']]) {
    await assert.rejects(readScenePhysics2DDocument(encode(value).replace(from, to)), invalid);
  }
});

test('captured one-way object is detached and apply requires the reviewed source token and revision', async () => {
  const value = document(3), content = encode(value), form = edit(value); form.bodies[0].oneWay = { margin: 1 };
  const pending = createScenePhysics2DProposal(source(content), form); form.bodies[0].oneWay.margin = 64;
  const proposal = await pending; assert.equal(read(proposal.afterContent).bodies[0].oneWay.margin, 1);
  assert.ok(Object.isFrozen(proposal.edit.bodies[0].oneWay));
  await assert.rejects(prepareScenePhysics2DApply({ ...source(content), token: 'other' }, proposal, { digest: hash }), { errorCode: 'scene_physics2d_authoring_conflict' });
  assert.equal((await prepareScenePhysics2DApply(source(content), proposal, { digest: hash })).afterContent, proposal.afterContent);
});

test('one-way insertion retains the exact author source byte budget including whitespace', async () => {
  const value = document(3), raw = encode(value), content = raw + ' '.repeat(65536 - Buffer.byteLength(raw)), form = edit(value);
  form.bodies[0].oneWay = { margin: 1 }; await assert.rejects(createScenePhysics2DProposal(source(content), form), invalid);
});

for (const action of ['offset', 'resize']) test(`schema4 ${action} space proposals preserve oneWay margin and inherited motion source`, async () => {
  const { captureScenePhysics2DSpace, createScenePhysics2DSpaceView } = await import('../../engine/scene-physics2d-space.mjs');
  const { createScenePhysics2DOffsetProposal } = await import('../../engine/scene-physics2d-space-edit.mjs');
  const { createScenePhysics2DResizeProposal } = await import('../../engine/scene-physics2d-space-resize.mjs');
  const value = document(), content = encode(value).replace('"schemaVersion": 4', '"schemaVersion": 4e0')
    .replace('"oneWay"', '"oneWa\\u0079"').replace('"margin": 1', '"marg\\u0069n": 1.00e0').replace('"gravity": 980', '"gravity": 9.80e2');
  const input = source(content), revision = text => 'sha256:' + hash(text);
  const raw = { format: 'viento-scene-physics2d-space', schemaVersion: 1, worldId: 'world:' + hash('world'), revision: revision('world'),
    scene: { objectId: id(900), sourcePath: 'documents/scenes/main.json', sourceRevision: revision('scene'), title: 'Scene', viewport: [640, 480], background: '#112233' },
    actors: value.bodies.map((body, index) => ({ instanceId: body.instanceId, objectId: id(700), name: 'Actor', sourcePath: 'documents/characters/actor.md', sourceRevision: revision('actor'), position: [100 + index * 30, 200], size: [20, 40], color: '#abcdef' })) };
  const checked = await readScenePhysics2DDocument(content), view = createScenePhysics2DSpaceView(captureScenePhysics2DSpace(input, raw), checked), form = edit(checked);
  const adjustment = action === 'offset' ? createScenePhysics2DOffsetProposal(view, value.bodies[0].id, [3, 0]) : createScenePhysics2DResizeProposal(view, value.bodies[0].id, [0, 5]);
  if (action === 'offset') form.bodies[0].offset = [...adjustment.offset]; else form.bodies[0].shape = structuredClone(adjustment.shape);
  const proposal = await createScenePhysics2DProposal(input, form), result = await prepareScenePhysics2DApply(input, proposal, { digest: hash });
  assert.equal(slice(result.afterContent, '/schemaVersion'), '4e0');
  assert.equal(slice(result.afterContent, '/bodies/0/oneWay'), slice(content, '/bodies/0/oneWay'));
  assert.equal(slice(result.afterContent, '/bodies/1'), slice(content, '/bodies/1')); assert.ok(result.afterContent.includes('"oneWa\\u0079"'));
  assert.deepEqual(result.changedPaths, [action === 'offset' ? '/bodies/0/offset/0' : '/bodies/0/shape/size/1']);
});
