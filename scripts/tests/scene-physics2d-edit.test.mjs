import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readScenePhysics2DDocument, createScenePhysics2DProposal, isScenePhysics2DProposal, prepareScenePhysics2DApply } from '../../engine/scene-physics2d-edit.mjs';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const body = (n, kind = 'static') => ({ id: id(n), instanceId: id(1000 + n), kind,
  shape: { kind: 'box', size: [32, 48] }, offset: [0, 0], layer: 1, mask: 2 });
const model = () => ({ format: 'viento-scene-physics2d', schemaVersion: 1, sceneObjectId: id(900),
  bodies: [body(1), { ...body(2, 'character'), shape: { kind: 'circle', radius: 16 } }, body(3, 'sensor')] });
const hash = value => createHash('sha256').update(value).digest('hex');
const encode = (value, newline = '\r\n') => '\ufeff' + JSON.stringify(value, null, '\t').replaceAll('\n', newline) + newline;
const source = (content = encode(model())) => ({ sourcePath: 'design-data/physics/room.json', token: 'load:7:edit:2',
  baseSourceRevision: 'sha256:' + hash(content), sourceRevision: 'sha256:' + hash(content), content });
const edit = (value = model()) => ({ bodies: structuredClone(value.bodies) });
const invalid = { errorCode: 'scene_physics2d_authoring_invalid' };
const conflict = { errorCode: 'scene_physics2d_authoring_conflict' };
const unchanged = { errorCode: 'scene_physics2d_authoring_unchanged' };
const slice = (content, pointer) => { const range = locateJsonSource(parseJsonSource(content), pointer); return content.slice(range.start, range.end); };
function replaced(content, replacements) {
  const parsed = parseJsonSource(content);
  for (const [path, text] of replacements.map(([pointer, text]) => [locateJsonSource(parsed, pointer), text]).sort((a, b) => b[0].start - a[0].start)) {
    content = content.slice(0, path.start) + text + content.slice(path.end);
  }
  return content;
}

test('physics reader preserves the exact authored model and freezes nested declarations without scene lookup', async () => {
  const value = model(); value.bodies[0].instanceId = id(9999);
  const content = encode(value).replace('"layer": 1', '"layer": 1e0').replace('"offset": [\r\n\t\t\t\t0', '"offset": [\r\n\t\t\t\t-0');
  const result = await readScenePhysics2DDocument(content);
  assert.equal(result.bodies[0].instanceId, id(9999)); assert.ok(Object.is(result.bodies[0].offset[0], -0));
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.bodies[0].shape.size));
  assert.equal(typeof result.bodies[0].shape.size[0], 'number');
});

test('leaf edits keep BOM CRLF escaped property names and every unmodified numeric token', async () => {
  const content = encode(model()).replace('"size"', '"si\\u007ae"').replace('"layer": 1', '"layer": 1e0')
    .replace('"mask": 2', '"mask": 2.000').replace('"offset": [\r\n\t\t\t\t0', '"offset": [\r\n\t\t\t\t-0');
  const value = edit(); value.bodies[0].shape.size[1] = 64; value.bodies[0].offset[1] = -5; value.bodies[2].layer = 4;
  const proposal = await createScenePhysics2DProposal(source(content), value);
  assert.equal(proposal.afterContent, replaced(content, [['/bodies/0/shape/size/1', '64'], ['/bodies/0/offset/1', '-5'], ['/bodies/2/layer', '4']]));
  assert.deepEqual(proposal.changedPaths, ['/bodies/0/shape/size/1', '/bodies/0/offset/1', '/bodies/2/layer']);
  assert.equal(proposal.beforeContent, content); assert.ok(isScenePhysics2DProposal(proposal));
});

test('kind retarget radius and masks edit only their declared value tokens', async () => {
  const content = encode(model()), value = edit();
  Object.assign(value.bodies[1], { instanceId: id(2000), kind: 'sensor', layer: 65535, mask: 0 }); value.bodies[1].shape.radius = .5;
  const proposal = await createScenePhysics2DProposal(source(content), value);
  assert.equal(proposal.afterContent, replaced(content, [['/bodies/1/instanceId', JSON.stringify(id(2000))], ['/bodies/1/kind', '"sensor"'],
    ['/bodies/1/shape/radius', '0.5'], ['/bodies/1/layer', '65535'], ['/bodies/1/mask', '0']]));
  assert.equal((await readScenePhysics2DDocument(proposal.afterContent)).sceneObjectId, model().sceneObjectId);
});

test('box and circle switches replace only shape objects while retaining row and root bytes', async () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    const content = encode(model(), newline), value = edit();
    value.bodies[0].shape = { kind: 'circle', radius: 24 }; value.bodies[1].shape = { kind: 'box', size: [1, 8192] };
    const proposal = await createScenePhysics2DProposal(source(content), value);
    assert.deepEqual(proposal.changedPaths, ['/bodies/0/shape', '/bodies/1/shape']);
    assert.equal(proposal.afterContent, replaced(content, proposal.changedPaths.map(pointer => [pointer, slice(proposal.afterContent, pointer)])));
    assert.deepEqual((await readScenePhysics2DDocument(proposal.afterContent)).bodies, value.bodies);
    assert.equal(proposal.afterContent.replaceAll(newline, '').includes('\n'), false);
  }
});

test('structural deletion retains surviving row lexemes and all bytes outside the bodies array', async () => {
  for (const removed of [0, 1, 2]) {
    const content = encode(model()).replace('"mask": 2', '"ma\\u0073k": 2e0');
    const value = edit(); value.bodies.splice(removed, 1);
    const proposal = await createScenePhysics2DProposal(source(content), value);
    assert.deepEqual(proposal.changedPaths, ['/bodies']);
    const beforeRange = locateJsonSource(parseJsonSource(content), '/bodies'), afterRange = locateJsonSource(parseJsonSource(proposal.afterContent), '/bodies');
    assert.equal(proposal.afterContent.slice(0, afterRange.start), content.slice(0, beforeRange.start));
    assert.equal(proposal.afterContent.slice(afterRange.end), content.slice(beforeRange.end));
    for (const [i, row] of value.bodies.entries()) {
      const oldIndex = model().bodies.findIndex(old => old.id === row.id);
      assert.equal(slice(proposal.afterContent, `/bodies/${i}`), slice(content, `/bodies/${oldIndex}`));
    }
  }
});

test('retained row edits and appended rows compose without reserializing other rows', async () => {
  for (const compact of [true, false]) {
    const content = compact ? '\ufeff' + JSON.stringify(model()) + ' \r\n' : encode(model());
    const value = edit(); value.bodies.splice(1, 1); value.bodies[0].shape.size[0] = 40;
    value.bodies.push({ ...body(4, 'character'), shape: { kind: 'circle', radius: 12 } });
    const proposal = await createScenePhysics2DProposal(source(content), value);
    assert.deepEqual((await readScenePhysics2DDocument(proposal.afterContent)).bodies, value.bodies);
    assert.equal(slice(proposal.afterContent, '/bodies/1'), slice(content, '/bodies/2'));
    assert.equal(slice(proposal.afterContent, '/bodies/0'), replaced(content, [['/bodies/0/shape/size/0', '40']]).slice(
      locateJsonSource(parseJsonSource(content), '/bodies/0').start, locateJsonSource(parseJsonSource(content), '/bodies/0').end));
    assert.ok(proposal.afterContent.startsWith('\ufeff')); assert.ok(proposal.afterContent.endsWith(compact ? ' \r\n' : '\r\n'));
  }
});

test('one-row compact and pretty arrays append complete bodies using the original newline style', async () => {
  for (const newline of [null, '\n', '\r\n', '\r']) {
    const original = model(); original.bodies.splice(1);
    const content = newline === null ? JSON.stringify(original) : encode(original, newline);
    const value = edit(original); value.bodies.push(body(4));
    const proposal = await createScenePhysics2DProposal(source(content), value);
    assert.deepEqual((await readScenePhysics2DDocument(proposal.afterContent)).bodies, value.bodies);
    assert.equal(slice(proposal.afterContent, '/bodies/0'), slice(content, '/bodies/0'));
    if (newline) assert.equal(proposal.afterContent.replaceAll(newline, '').includes('\n'), false);
  }
});

test('existing body order cannot change and new bodies cannot be inserted before retained rows', async () => {
  for (const bodies of [[...model().bodies].reverse(), [model().bodies[1], model().bodies[0]], [body(4), model().bodies[0]],
    [model().bodies[0], body(4), model().bodies[2]]]) await assert.rejects(createScenePhysics2DProposal(source(), { bodies }), invalid);
  const proposal = await createScenePhysics2DProposal(source(), { bodies: [model().bodies[2], body(4)] });
  assert.deepEqual((await readScenePhysics2DDocument(proposal.afterContent)).bodies.map(row => row.id), [id(3), id(4)]);
});

test('the complete form cannot edit scene identity format schema or undeclared root fields', async () => {
  for (const key of ['sceneObjectId', 'format', 'schemaVersion', 'targets', 'registration']) {
    await assert.rejects(createScenePhysics2DProposal(source(), { ...edit(), [key]: id(5) }), invalid);
  }
  await assert.rejects(createScenePhysics2DProposal(source(), {}), invalid);
});

test('unchanged semantic values never produce a proposal or normalize signed zero and exponent spelling', async () => {
  const content = encode(model()).replace('"layer": 1', '"layer": 1e0')
    .replace('"offset": [\r\n\t\t\t\t0', '"offset": [\r\n\t\t\t\t-0');
  await assert.rejects(createScenePhysics2DProposal(source(content), edit()), unchanged);
  const value = edit(); value.bodies[0].shape = { size: [32, 48], kind: 'box' };
  await assert.rejects(createScenePhysics2DProposal(source(content), value), unchanged);
});

test('native limits reject empty duplicate malformed and out of range candidate declarations atomically', async () => {
  const mutations = [v => v.bodies = [], v => v.bodies.push(structuredClone(v.bodies[0])),
    v => v.bodies[1].instanceId = v.bodies[0].instanceId, v => v.bodies[0].kind = 'rigid',
    v => v.bodies[0].shape.kind = 'rect', v => v.bodies[0].shape.size[0] = 0, v => v.bodies[0].shape.size[1] = 8193,
    v => v.bodies[1].shape.radius = .49, v => v.bodies[1].shape.radius = 4097, v => v.bodies[0].offset[0] = -8193,
    v => v.bodies[0].offset.push(0), v => v.bodies[0].layer = .5, v => v.bodies[0].mask = 65536,
    v => v.bodies[0].mask = '2', v => v.bodies[0].layer = Infinity, v => v.bodies[0].shape.extra = 1,
    v => delete v.bodies[0].mask, v => v.bodies[0].instanceId += '\n'];
  for (const mutate of mutations) { const value = edit(); mutate(value); await assert.rejects(createScenePhysics2DProposal(source(), value), invalid); }
});

test('the 128-body limit admits the complete final list and rejects one extra body', async () => {
  const value = edit(); value.bodies.push(...Array.from({ length: 125 }, (_, i) => body(i + 4)));
  const proposal = await createScenePhysics2DProposal(source(), value);
  assert.equal((await readScenePhysics2DDocument(proposal.afterContent)).bodies.length, 128);
  value.bodies.push(body(129)); await assert.rejects(createScenePhysics2DProposal(source(), value), invalid);
});

test('invalid original documents cannot be repaired implicitly through the specialized editor', async () => {
  for (const content of ['{', encode(model()).replace('"mask": 2', '"mask":2,"ma\\u0073k":2'),
    encode(model()).replace('"size": [', '"extra":0,"size": ['), encode(model()).replace('"radius": 16', '"radius": -1')]) {
    await assert.rejects(readScenePhysics2DDocument(content), invalid);
    await assert.rejects(createScenePhysics2DProposal(source(content), edit()), invalid);
  }
});

test('UTF8 source and final output budgets use exact bytes including BOM and preserve shrinking edits', async () => {
  const base = encode(model()), padded = base + ' '.repeat(65536 - Buffer.byteLength(base));
  assert.equal(Buffer.byteLength(padded), 65536); await readScenePhysics2DDocument(padded);
  const sameSize = edit(); sameSize.bodies[0].mask = 3;
  assert.equal(Buffer.byteLength((await createScenePhysics2DProposal(source(padded), sameSize)).afterContent), 65536);
  const growing = edit(); growing.bodies[0].mask = 65535;
  await assert.rejects(createScenePhysics2DProposal(source(padded), growing), invalid);
  await assert.rejects(readScenePhysics2DDocument(padded + ' '), invalid);
  const original = model(); original.bodies[0].shape.size[0] = 8192; original.bodies[0].mask = 65535;
  const raw = encode(original), full = raw + ' '.repeat(65536 - Buffer.byteLength(raw));
  const shrinking = edit(original); shrinking.bodies[0].offset[0] = 8192; shrinking.bodies[0].shape.size[0] = 1; shrinking.bodies[0].mask = 1;
  const proposal = await createScenePhysics2DProposal(source(full), shrinking);
  assert.equal(Buffer.byteLength(proposal.afterContent), 65532);
});

test('source snapshots require exactly five bounded fields with canonical project paths and revisions', async () => {
  const value = edit(); value.bodies[0].mask = 4;
  for (const change of [s => s.extra = 1, s => delete s.token, s => s.sourcePath = '/tmp/room.json',
    s => s.sourcePath = '../room.json', s => s.sourcePath = 'documents//room.json', s => s.sourcePath = 'C:room.json',
    s => s.sourcePath = 'documents/room.JSON', s => s.token = '', s => s.token = 'x'.repeat(257),
    s => s.sourceRevision += '\n', s => s.baseSourceRevision = 'sha256:bad', s => s.content += '\ud800']) {
    const input = source(); change(input); await assert.rejects(createScenePhysics2DProposal(input, value), invalid);
  }
});

test('input accessors serializers inherited objects symbols and sparse arrays are rejected without executing code', async () => {
  let calls = 0;
  const values = [Object.assign(Object.create({ inherited: true }), edit()),
    { get bodies() { calls++; return model().bodies; } }, { ...edit(), toJSON() { calls++; return edit(); } },
    { bodies: [{ ...body(1), get shape() { calls++; return body(1).shape; } }] },
    { bodies: [{ ...body(1), shape: { ...body(1).shape, toJSON() { calls++; return body(1).shape; } } }] },
    { bodies: [, body(2)] }];
  const symbol = edit(); symbol[Symbol('hidden')] = true; values.push(symbol);
  const hidden = edit(); Object.defineProperty(hidden, 'hidden', { value: true }); values.push(hidden);
  const arrayExtra = edit(); arrayExtra.bodies.extra = true; values.push(arrayExtra);
  for (const value of values) await assert.rejects(createScenePhysics2DProposal(source(), value), invalid);
  const input = source(); Object.defineProperty(input, 'content', { enumerable: true, get() { calls++; return encode(model()); } });
  await assert.rejects(createScenePhysics2DProposal(input, edit()), invalid);
  assert.equal(calls, 0);
});

test('prototype serializers fail closed without being invoked', async () => {
  let calls = 0;
  const input = source(), value = edit();
  for (const prototype of [Object.prototype, Array.prototype]) {
    Object.defineProperty(prototype, 'toJSON', { configurable: true, value() { calls++; return {}; } });
    try { await assert.rejects(createScenePhysics2DProposal(input, value), invalid); }
    finally { delete prototype.toJSON; }
  }
  assert.equal(calls, 0);
});

test('source and form are detached before the first asynchronous validation boundary', async () => {
  const input = source(), before = input.content, value = edit(); value.bodies[0].mask = 4;
  const pending = createScenePhysics2DProposal(input, value);
  input.token = 'other'; input.content = '{}'; value.bodies[0].mask = 8; value.bodies.splice(1);
  const proposal = await pending;
  assert.equal(proposal.sourceToken, 'load:7:edit:2'); assert.equal(proposal.beforeContent, before);
  assert.equal((await readScenePhysics2DDocument(proposal.afterContent)).bodies[0].mask, 4);
  assert.equal((await readScenePhysics2DDocument(proposal.afterContent)).bodies.length, 3);
  assert.ok(Object.isFrozen(proposal) && Object.isFrozen(proposal.edit.bodies[0].shape.size) && Object.isFrozen(proposal.changedPaths));
});

test('only the branded reviewed proposal can prepare an ordinary draft and returned data is frozen', async () => {
  const value = edit(); value.bodies[0].layer = 8;
  const input = source(), proposal = await createScenePhysics2DProposal(input, value);
  const result = await prepareScenePhysics2DApply(input, proposal, { digest: hash });
  assert.deepEqual(result, { sourcePath: input.sourcePath, afterContent: proposal.afterContent, changedPaths: proposal.changedPaths });
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.changedPaths));
  for (const forged of [{ ...proposal }, structuredClone(proposal), Object.freeze({ kind: 'scene-physics2d' }), null]) {
    assert.equal(isScenePhysics2DProposal(forged), false); await assert.rejects(prepareScenePhysics2DApply(input, forged, { digest: hash }), conflict);
  }
  assert.deepEqual(Object.keys(proposal).sort(), ['kind', 'sourcePath', 'sourceToken', 'baseSourceRevision', 'sourceRevision', 'beforeContent', 'afterContent', 'edit', 'changedPaths'].sort());
});

test('every source ownership field and invalid digest revoke application before returning draft text', async () => {
  const input = source(), value = edit(); value.bodies[0].mask = 4;
  const proposal = await createScenePhysics2DProposal(input, value);
  for (const key of Object.keys(input)) await assert.rejects(prepareScenePhysics2DApply({ ...input, [key]: input[key] + 'x' }, proposal, { digest: hash }), conflict);
  for (const digest of [undefined, () => 'f'.repeat(64), () => hash(input.content) + '\n', () => 'sha256:' + hash(input.content), () => 42]) {
    await assert.rejects(prepareScenePhysics2DApply(input, proposal, { digest }), conflict);
  }
});

test('unsaved ordinary drafts retain separate baseline revision and prepare only the captured current text', async () => {
  const original = source(), content = original.content.replace('"mask": 2', '"mask": 4');
  const input = { ...source(content), baseSourceRevision: original.baseSourceRevision }, value = edit(await readScenePhysics2DDocument(content));
  value.bodies[0].mask = 8; const proposal = await createScenePhysics2DProposal(input, value);
  let release; const pending = prepareScenePhysics2DApply(input, proposal, { digest: async captured => { await new Promise(resolve => { release = resolve; }); return hash(captured); } });
  input.content = original.content; input.token = 'other'; release();
  assert.equal((await pending).afterContent, proposal.afterContent);
  assert.equal(proposal.baseSourceRevision, original.baseSourceRevision); assert.notEqual(proposal.sourceRevision, proposal.baseSourceRevision);
  // The pure module prepares captured data only. The source host must recheck
  // document/token/current text after await before performing its draft write.
});
