import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readScenePhysics2DDocument, createScenePhysics2DProposal, prepareScenePhysics2DApply } from '../../engine/scene-physics2d-edit.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const body = n => ({ id: id(n), instanceId: id(1000 + n), kind: 'character', shape: { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 2 });
const document = () => ({ format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: id(900), bodies: [body(1), body(2)] });
const hash = s => createHash('sha256').update(s).digest('hex');
const encode = (value, newline = '\r\n') => '\ufeff' + JSON.stringify(value, null, '\t').replaceAll('\n', newline) + newline;
const source = content => ({ sourcePath: 'documents/physics.json', token: 'test:1', content, sourceRevision: 'sha256:' + hash(content), baseSourceRevision: 'sha256:' + hash(content) });
const edit = value => ({ bodies: structuredClone(value.bodies) });
const slice = (content, pointer) => { const range = locateJsonSource(parseJsonSource(content), pointer); return content.slice(range.start, range.end); };
const read = content => JSON.parse(content.replace(/^\ufeff/, ''));
const invalid = { errorCode: 'scene_physics2d_authoring_invalid' };
test('only an explicit slide upgrades schema and inserts one field without changing unrelated lexemes or bodies', async () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    const value = document(), content = encode(value, newline).replace('"schemaVersion": 1', '"schemaVersion": 1e0').replace('"layer": 1', '"layer": 1e0');
    const form = edit(value); form.bodies[0].collisionResponse = 'slide';
    const proposal = await createScenePhysics2DProposal(source(content), form);
    assert.deepEqual(proposal.changedPaths, ['/schemaVersion', '/bodies/0/collisionResponse']);
    assert.equal(read(proposal.afterContent).schemaVersion, 2); assert.equal(read(proposal.afterContent).bodies[0].collisionResponse, 'slide');
    assert.equal(slice(content, '/bodies/1'), slice(proposal.afterContent, '/bodies/1'));
    assert.equal(slice(proposal.afterContent, '/bodies/0/layer'), '1e0'); assert.ok(proposal.afterContent.startsWith('\ufeff'));
    assert.equal(proposal.afterContent.replaceAll(newline, '').includes('\n'), false);
    assert.equal((await prepareScenePhysics2DApply(source(content), proposal, { digest: hash })).afterContent, proposal.afterContent);
  }
});
test('explicit stop on legacy input neither upgrades nor creates a declaration', async () => {
  const value = document(), content = encode(value), form = edit(value); form.bodies[0].collisionResponse = 'stop';
  await assert.rejects(createScenePhysics2DProposal(source(content), form), { errorCode: 'scene_physics2d_authoring_unchanged' });
  form.bodies[0].offset[1] = 8;
  const proposal = await createScenePhysics2DProposal(source(content), form);
  assert.equal(read(proposal.afterContent).schemaVersion, 1); assert.ok(!Object.hasOwn(read(proposal.afterContent).bodies[0], 'collisionResponse'));
  assert.deepEqual(proposal.changedPaths, ['/bodies/0/offset/1']);
});
test('schema2 toggles preserve explicit stop presence and do not downgrade', async () => {
  const value = document(); value.schemaVersion = 2; value.bodies[0].collisionResponse = 'slide';
  const content = encode(value).replace('"collisionResponse"', '"collisionRespon\\u0073e"'), form = edit(value); form.bodies[0].collisionResponse = 'stop';
  const proposal = await createScenePhysics2DProposal(source(content), form);
  assert.equal(proposal.afterContent, content.replace('"slide"', '"stop"'));
  assert.deepEqual(proposal.changedPaths, ['/bodies/0/collisionResponse']); assert.equal(read(proposal.afterContent).schemaVersion, 2);
  await assert.rejects(createScenePhysics2DProposal(source(proposal.afterContent), edit(read(proposal.afterContent))), { errorCode: 'scene_physics2d_authoring_unchanged' });
});
test('response deletion preserves other tokens when the optional key is first middle or last', async () => {
  for (const newline of [null, '\r\n', '\n', '\r']) for (const at of [0, 3, 7]) {
    const value = document(); value.schemaVersion = 2;
    const entries = Object.entries(value.bodies[0]); entries.splice(at, 0, ['collisionResponse', 'slide']); value.bodies[0] = Object.fromEntries(entries);
    const content = (newline ? encode(value, newline) : JSON.stringify(value)).replace('"collisionResponse"', '"collisionRespon\\u0073e"');
    const form = edit(value); delete form.bodies[0].collisionResponse; form.bodies[0].kind = 'static'; form.bodies[0].mask = 7;
    const proposal = await createScenePhysics2DProposal(source(content), form), actual = read(proposal.afterContent);
    assert.deepEqual(actual, { ...value, bodies: form.bodies });
    assert.equal(slice(content, '/bodies/1'), slice(proposal.afterContent, '/bodies/1'));
    for (const field of ['id', 'instanceId', 'shape', 'offset', 'layer']) assert.equal(slice(content, '/bodies/0/' + field), slice(proposal.afterContent, '/bodies/0/' + field));
  }
});
test('geometry edits keep response presence and lexemes unchanged', async () => {
  for (const response of ['stop', 'slide', null]) {
    const value = document(); value.schemaVersion = 2; if (response) value.bodies[0].collisionResponse = response;
    const content = encode(value).replace('"schemaVersion": 2', '"schemaVersion": 2e0'), form = edit(value);
    form.bodies[0].offset[0] = 4; form.bodies[0].shape.size[1] = 64;
    const proposal = await createScenePhysics2DProposal(source(content), form), actual = read(proposal.afterContent);
    assert.equal(actual.bodies[0].collisionResponse, response || undefined); assert.equal(slice(proposal.afterContent, '/schemaVersion'), '2e0');
    assert.deepEqual(proposal.changedPaths, ['/bodies/0/shape/size/1', '/bodies/0/offset/0']);
  }
});
test('response edits compose with row removal and appended slide characters in one schema upgrade', async () => {
  const value = document(), content = encode(value), form = edit(value);
  form.bodies.shift(); form.bodies[0].collisionResponse = 'slide'; form.bodies.push({ ...body(3), collisionResponse: 'slide' });
  const proposal = await createScenePhysics2DProposal(source(content), form);
  assert.deepEqual(read(proposal.afterContent), { ...value, schemaVersion: 2, bodies: form.bodies });
  assert.deepEqual(proposal.changedPaths, ['/schemaVersion', '/bodies']);
});
test('response capture rejects noncharacters invalid values extra fields and getters without invoking them', async () => {
  for (const response of [null, true, 0, '', 'Slide', [], {}]) {
    const form = edit(document()); form.bodies[0].collisionResponse = response;
    await assert.rejects(createScenePhysics2DProposal(source(encode(document())), form), invalid);
  }
  for (const kind of ['static', 'sensor']) {
    const form = edit(document()); Object.assign(form.bodies[0], { kind, collisionResponse: 'stop' });
    await assert.rejects(createScenePhysics2DProposal(source(encode(document())), form), invalid);
  }
  let calls = 0; const form = edit(document()); Object.defineProperty(form.bodies[0], 'collisionResponse', { enumerable: true, get() { calls++; return 'slide'; } });
  await assert.rejects(createScenePhysics2DProposal(source(encode(document())), form), invalid); assert.equal(calls, 0);
});
test('schema2 reader and upgrade retain exact source byte budgets', async () => {
  const value = document(), raw = encode(value), content = raw + ' '.repeat(65536 - Buffer.byteLength(raw)), form = edit(value);
  form.bodies[0].collisionResponse = 'slide'; await assert.rejects(createScenePhysics2DProposal(source(content), form), invalid);
  value.schemaVersion = 2; value.bodies[0].collisionResponse = 'stop';
  assert.deepEqual(await readScenePhysics2DDocument(encode(value)), value);
});

for (const action of ['offset', 'resize']) test(`schema2 ${action} space proposals apply only geometry and retain response schema and source spelling`, async () => {
  const { captureScenePhysics2DSpace, createScenePhysics2DSpaceView } = await import('../../engine/scene-physics2d-space.mjs');
  const { createScenePhysics2DOffsetProposal } = await import('../../engine/scene-physics2d-space-edit.mjs');
  const { createScenePhysics2DResizeProposal } = await import('../../engine/scene-physics2d-space-resize.mjs');
  for (const response of ['stop', 'slide', null]) for (const shape of [{ kind: 'box', size: [32, 48] }, { kind: 'circle', radius: 16 }]) {
    const value = document(); value.schemaVersion = 2; value.bodies[0].shape = shape;
    if (response) value.bodies[0].collisionResponse = response;
    const content = encode(value).replace('"schemaVersion": 2', '"schemaVersion": 2e0').replace('"collisionResponse"', '"collisionRespon\\u0073e"');
    const input = source(content), revision = text => 'sha256:' + hash(text);
    const raw = { format: 'viento-scene-physics2d-space', schemaVersion: 1, worldId: 'world:' + hash('world'), revision: revision('world'),
      scene: { objectId: id(900), sourcePath: 'documents/scenes/main.json', sourceRevision: revision('scene'), title: 'Scene', viewport: [640, 480], background: '#112233' },
      actors: value.bodies.map((body, index) => ({ instanceId: body.instanceId, objectId: id(700), name: 'Actor', sourcePath: 'documents/characters/actor.md', sourceRevision: revision('actor'), position: [100 + index * 30, 200], size: [20, 40], color: '#abcdef' })) };
    const checked = await readScenePhysics2DDocument(content), view = createScenePhysics2DSpaceView(captureScenePhysics2DSpace(input, raw), checked);
    assert.equal(Object.hasOwn(view.bodies[0], 'collisionResponse'), false);
    const form = edit(checked);
    const adjustment = action === 'offset' ? createScenePhysics2DOffsetProposal(view, value.bodies[0].id, [3, 0])
      : createScenePhysics2DResizeProposal(view, value.bodies[0].id, shape.kind === 'box' ? [0, 5] : [2]);
    if (action === 'offset') form.bodies[0].offset = [...adjustment.offset]; else form.bodies[0].shape = structuredClone(adjustment.shape);
    const proposal = await createScenePhysics2DProposal(input, form), result = await prepareScenePhysics2DApply(input, proposal, { digest: hash });
    assert.equal(read(result.afterContent).schemaVersion, 2); assert.equal(read(result.afterContent).bodies[0].collisionResponse, response || undefined);
    assert.equal(slice(result.afterContent, '/schemaVersion'), '2e0'); assert.equal(slice(result.afterContent, '/bodies/1'), slice(content, '/bodies/1'));
    if (response) assert.ok(result.afterContent.includes('"collisionRespon\\u0073e"'));
    assert.deepEqual(result.changedPaths, [action === 'offset' ? '/bodies/0/offset/0' : shape.kind === 'box' ? '/bodies/0/shape/size/1' : '/bodies/0/shape/radius']);
  }
});
