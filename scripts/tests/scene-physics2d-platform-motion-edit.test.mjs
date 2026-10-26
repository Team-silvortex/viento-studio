import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readScenePhysics2DDocument, createScenePhysics2DProposal, prepareScenePhysics2DApply } from '../../engine/scene-physics2d-edit.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const body = (n, kind = 'static') => ({ id: id(n), instanceId: id(1000 + n), kind, shape: { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 2 });
const motion = () => ({ kind: 'platformer', gravity: 980, jumpSpeed: 360, maxFallSpeed: 1200 });
const platform = () => ({ kind: 'horizontal', offsetX: 160, speed: 80 });
const document = (version = 5) => ({ format: 'viento-scene-physics2d', schemaVersion: version, sceneObjectId: id(900),
  bodies: [{ ...body(1), ...(version >= 5 ? { platformMotion: platform() } : {}), ...(version >= 4 ? { oneWay: { margin: 1 } } : {}) },
    { ...body(2, 'character'), ...(version >= 3 ? { collisionResponse: 'slide', characterMotion: motion() } : {}) }] });
const hash = s => createHash('sha256').update(s).digest('hex');
const encode = (value, newline = '\r\n') => '\ufeff' + JSON.stringify(value, null, '\t').replaceAll('\n', newline) + newline;
const source = content => ({ sourcePath: 'documents/physics.json', token: 'test:1', content, sourceRevision: 'sha256:' + hash(content), baseSourceRevision: 'sha256:' + hash(content) });
const edit = value => ({ bodies: structuredClone(value.bodies) });
const slice = (content, pointer) => { const range = locateJsonSource(parseJsonSource(content), pointer); return content.slice(range.start, range.end); };
const read = content => JSON.parse(content.replace(/^\ufeff/, ''));
const invalid = { errorCode: 'scene_physics2d_authoring_invalid' };


test('platform opt-in upgrades schema1–4 only upon explicit edit with exact source preservation', async () => {
  for (const version of [1, 2, 3, 4]) for (const newline of [null, '\n', '\r\n', '\r']) {
    const value = document(version), content = (newline ? encode(value, newline) : JSON.stringify(value)).replace('"layer": 1', '"layer": 1e0').replace('"layer":1,', '"layer":1e0,');
    const form = edit(value); form.bodies[0].platformMotion = platform();
    const proposal = await createScenePhysics2DProposal(source(content), form);
    assert.deepEqual(proposal.changedPaths, ['/schemaVersion', '/bodies/0/platformMotion']);
    assert.deepEqual(read(proposal.afterContent), { ...value, schemaVersion: 5, bodies: form.bodies });
    assert.equal(slice(content, '/bodies/1'), slice(proposal.afterContent, '/bodies/1'));
    for (const field of Object.keys(value.bodies[0])) assert.equal(slice(content, '/bodies/0/' + field), slice(proposal.afterContent, '/bodies/0/' + field));
    if (newline) assert.ok(proposal.afterContent.startsWith('\ufeff'));
  }
});

test('normal legacy edits never opt in; disabling preserves schema5 and other platform source', async () => {
  for (const version of [1, 2, 3, 4]) {
    const value = document(version), form = edit(value); form.bodies[0].offset[0] = 4;
    const proposal = await createScenePhysics2DProposal(source(encode(value)), form);
    assert.equal(read(proposal.afterContent).schemaVersion, version); assert.equal(Object.hasOwn(read(proposal.afterContent).bodies[0], 'platformMotion'), false);
  }
  const value = document(), content = encode(value).replace('"schemaVersion": 5', '"schemaVersion": 5e0'), form = edit(value); delete form.bodies[0].platformMotion;
  const proposal = await createScenePhysics2DProposal(source(content), form);
  assert.deepEqual(proposal.changedPaths, ['/bodies/0/platformMotion']); assert.equal(slice(proposal.afterContent, '/schemaVersion'), '5e0');
  assert.equal(slice(proposal.afterContent, '/bodies/0/oneWay'), slice(content, '/bodies/0/oneWay')); assert.equal(slice(proposal.afterContent, '/bodies/1'), slice(content, '/bodies/1'));
  await assert.rejects(createScenePhysics2DProposal(source(proposal.afterContent), form), { errorCode: 'scene_physics2d_authoring_unchanged' });
});

test('horizontal travel and speed patch only escaped leaves while retaining BOM CRLF exponents and signed zero', async () => {
  const value = document(), raw = encode(value).replace('"platformMotion"', '"platformMotio\\u006e"').replace('"offsetX": 160', '"offset\\u0058": 1.60e2').replace('"speed": 80', '"spe\\u0065d": 8.00e1').replace('"margin": 1', '"margin": 1.00e0').replace('"gravity": 980', '"gravity": 9.80e2');
  const at = locateJsonSource(parseJsonSource(raw), '/bodies/0/offset/0'), content = raw.slice(0, at.start) + '-0' + raw.slice(at.end);
  for (const [key, next, from, to] of [['offsetX', -320, '1.60e2', '-320'], ['speed', 120.5, '8.00e1', '120.5']]) {
    const form = edit(read(content)); form.bodies[0].platformMotion[key] = next;
    const proposal = await createScenePhysics2DProposal(source(content), form);
    assert.equal(proposal.afterContent, content.replace(from, to)); assert.deepEqual(proposal.changedPaths, ['/bodies/0/platformMotion/' + key]);
  }
});

test('joint platform and one-way removals compose with response and character motion additions at every key position', async () => {
  for (const newline of [null, '\r\n']) for (let platformAt = 0; platformAt < 9; platformAt++) for (let oneWayAt = 0; oneWayAt < 9; oneWayAt++) {
    if (platformAt === oneWayAt) continue;
    const value = document(), remaining = Object.entries(body(1));
    value.bodies[0] = Object.fromEntries(Array.from({ length: 9 }, (_, index) => index === platformAt ? ['platformMotion', platform()] : index === oneWayAt ? ['oneWay', { margin: 1 }] : remaining.shift()));
    const content = (newline ? encode(value, newline) : JSON.stringify(value)).replace('"platformMotion"', '"platformMotio\\u006e"').replace('"oneWay"', '"oneWa\\u0079"');
    const form = edit(value); delete form.bodies[0].platformMotion; delete form.bodies[0].oneWay; Object.assign(form.bodies[0], { kind: 'character', collisionResponse: 'slide', characterMotion: motion() });
    const proposal = await createScenePhysics2DProposal(source(content), form);
    assert.deepEqual(read(proposal.afterContent), { ...value, bodies: form.bodies });
    assert.deepEqual(new Set(proposal.changedPaths), new Set(['/bodies/0/kind', '/bodies/0/platformMotion', '/bodies/0/oneWay', '/bodies/0/collisionResponse', '/bodies/0/characterMotion']));
    for (const key of ['id', 'instanceId', 'shape', 'offset', 'layer', 'mask']) assert.equal(slice(content, '/bodies/0/' + key), slice(proposal.afterContent, '/bodies/0/' + key));
  }
});

test('response and character motion removals compose with both platform additions at every key position', async () => {
  for (const newline of [null, '\r\n']) for (let responseAt = 0; responseAt < 9; responseAt++) for (let motionAt = 0; motionAt < 9; motionAt++) {
    if (responseAt === motionAt) continue;
    const value = document(), remaining = Object.entries(body(1, 'character'));
    value.bodies[0] = Object.fromEntries(Array.from({ length: 9 }, (_, index) => index === responseAt ? ['collisionResponse', 'slide'] : index === motionAt ? ['characterMotion', motion()] : remaining.shift()));
    const content = newline ? encode(value, newline) : JSON.stringify(value), form = edit(value);
    delete form.bodies[0].collisionResponse; delete form.bodies[0].characterMotion; Object.assign(form.bodies[0], { kind: 'static', oneWay: { margin: 64 }, platformMotion: platform() });
    const proposal = await createScenePhysics2DProposal(source(content), form);
    assert.deepEqual(read(proposal.afterContent), { ...value, bodies: form.bodies });
    assert.equal(slice(content, '/bodies/1'), slice(proposal.afterContent, '/bodies/1'));
  }
});

test('platform removal permits circle and sensor switches while retained motion rejects incompatible bodies', async () => {
  for (const mode of ['circle', 'sensor', 'character']) {
    const value = document(), content = encode(value), form = edit(value); delete form.bodies[0].oneWay;
    if (mode === 'circle') form.bodies[0].shape = { kind: 'circle', radius: 16 }; else form.bodies[0].kind = mode;
    await assert.rejects(createScenePhysics2DProposal(source(content), form), invalid);
    delete form.bodies[0].platformMotion; const proposal = await createScenePhysics2DProposal(source(content), form);
    assert.deepEqual(read(proposal.afterContent), { ...value, bodies: form.bodies });
  }
});

test('platform leaf edits compose with row removal and appended complete bodies', async () => {
  const value = document(), content = encode(value), form = edit(value); form.bodies.pop(); form.bodies[0].platformMotion.speed = 99; form.bodies.push({ ...body(3), platformMotion: platform() });
  const proposal = await createScenePhysics2DProposal(source(content), form); assert.deepEqual(read(proposal.afterContent).bodies, form.bodies);
  assert.equal(slice(content, '/bodies/0/oneWay'), slice(proposal.afterContent, '/bodies/0/oneWay'));
});

test('invalid platform values and exotic input reject without getters, serializers or source writes', async () => {
  for (const replacement of [null, false, [], {}, { kind: 'linear', offsetX: 1, speed: 1 }, { kind: 'horizontal', offsetX: 0, speed: 1 }, { kind: 'horizontal', offsetX: 1, speed: 0 }, { kind: 'horizontal', offsetX: 1, speed: Infinity }]) {
    const value = document(), form = edit(value); form.bodies[0].platformMotion = replacement; await assert.rejects(createScenePhysics2DProposal(source(encode(value)), form), invalid);
  }
  let calls = 0;
  for (const field of ['platformMotion', 'offsetX', 'speed']) {
    const value = document(), form = edit(value), target = field === 'platformMotion' ? form.bodies[0] : form.bodies[0].platformMotion;
    Object.defineProperty(target, field, { enumerable: true, get() { calls++; return 1; } }); await assert.rejects(createScenePhysics2DProposal(source(encode(value)), form), invalid);
  }
  const value = document(), form = edit(value); form.bodies[0].platformMotion.toJSON = () => { calls++; return platform(); }; await assert.rejects(createScenePhysics2DProposal(source(encode(value)), form), invalid); assert.equal(calls, 0);
  for (const [from, to] of [['"offsetX": 160', '"offsetX": 0,"offset\\u0058": 160'], ['"platformMotion":', '"platformMotio\\u006e": null,"platformMotion":']]) await assert.rejects(readScenePhysics2DDocument(encode(value).replace(from, to)), invalid);
});

test('platform proposal captures edits before await and applies only to the exact source identity', async () => {
  const value = document(4), content = encode(value), form = edit(value); form.bodies[0].platformMotion = platform();
  const pending = createScenePhysics2DProposal(source(content), form); form.bodies[0].platformMotion.speed = 2000;
  const proposal = await pending; assert.equal(read(proposal.afterContent).bodies[0].platformMotion.speed, 80); assert.ok(Object.isFrozen(proposal.edit.bodies[0].platformMotion));
  await assert.rejects(prepareScenePhysics2DApply({ ...source(content), token: 'other' }, proposal, { digest: hash }), { errorCode: 'scene_physics2d_authoring_conflict' });
  await assert.rejects(prepareScenePhysics2DApply(source(content + ' '), proposal, { digest: hash }), { errorCode: 'scene_physics2d_authoring_conflict' });
  const result = await prepareScenePhysics2DApply(source(content), proposal, { digest: hash }); assert.equal(result.afterContent, proposal.afterContent);
});
for (const action of ['offset', 'resize']) test(`schema5 ${action} space proposals preserve platform motion plus oneWay and inherited motion source`, async () => {
  const { captureScenePhysics2DSpace, createScenePhysics2DSpaceView } = await import('../../engine/scene-physics2d-space.mjs');
  const { createScenePhysics2DOffsetProposal } = await import('../../engine/scene-physics2d-space-edit.mjs');
  const { createScenePhysics2DResizeProposal } = await import('../../engine/scene-physics2d-space-resize.mjs');
  const value = document(), content = encode(value).replace('"schemaVersion": 5', '"schemaVersion": 5e0')
    .replace('"oneWay"', '"oneWa\\u0079"').replace('"margin": 1', '"marg\\u0069n": 1.00e0').replace('"gravity": 980', '"gravity": 9.80e2');
  const input = source(content), revision = text => 'sha256:' + hash(text);
  const raw = { format: 'viento-scene-physics2d-space', schemaVersion: 1, worldId: 'world:' + hash('world'), revision: revision('world'),
    scene: { objectId: id(900), sourcePath: 'documents/scenes/main.json', sourceRevision: revision('scene'), title: 'Scene', viewport: [640, 480], background: '#112233' },
    actors: value.bodies.map((body, index) => ({ instanceId: body.instanceId, objectId: id(700), name: 'Actor', sourcePath: 'documents/characters/actor.md', sourceRevision: revision('actor'), position: [100 + index * 30, 200], size: [20, 40], color: '#abcdef' })) };
  const checked = await readScenePhysics2DDocument(content), view = createScenePhysics2DSpaceView(captureScenePhysics2DSpace(input, raw), checked), form = edit(checked);
  const adjustment = action === 'offset' ? createScenePhysics2DOffsetProposal(view, value.bodies[0].id, [3, 0]) : createScenePhysics2DResizeProposal(view, value.bodies[0].id, [0, 5]);
  if (action === 'offset') form.bodies[0].offset = [...adjustment.offset]; else form.bodies[0].shape = structuredClone(adjustment.shape);
  const proposal = await createScenePhysics2DProposal(input, form), result = await prepareScenePhysics2DApply(input, proposal, { digest: hash });
  assert.equal(slice(result.afterContent, '/schemaVersion'), '5e0');
  assert.equal(slice(result.afterContent, '/bodies/0/platformMotion'), slice(content, '/bodies/0/platformMotion'));
  assert.equal(slice(result.afterContent, '/bodies/0/oneWay'), slice(content, '/bodies/0/oneWay'));
  assert.equal(slice(result.afterContent, '/bodies/1'), slice(content, '/bodies/1')); assert.ok(result.afterContent.includes('"oneWa\\u0079"'));
  assert.deepEqual(result.changedPaths, [action === 'offset' ? '/bodies/0/offset/0' : '/bodies/0/shape/size/1']);
});
