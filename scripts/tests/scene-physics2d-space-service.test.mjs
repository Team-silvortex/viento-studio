import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createScenePhysics2DSpaceService } from '../lib/scene-physics2d-space-service.mjs';
import { getProjectionTemplates, lockProjectionTemplate } from '../../engine/object-projection-template.mjs';
import { scenePhysics2DTargetsFixture, tree, sceneId, manifestId, definitionId, instance1, instance2,
  scenePath, manifestPath, definitionPath, recordPath, id, revision } from './helpers/scene-physics2d-targets-fixture.mjs';
const error = (kind, status) => e => e.errorCode === `scene_physics2d_space_${kind}` && e.statusCode === status;
const unavailableOrInvalid = e => /^scene_physics2d_space_(invalid|unavailable)$/.test(e.errorCode);
const digest = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const f = await scenePhysics2DTargetsFixture(t), service = createScenePhysics2DSpaceService(f.root);
  return { ...f, service, inspect: () => service.inspect({ sceneObjectId: sceneId }) };
}
async function addProjection(f) {
  const projectedId = id(50), projectedPath = 'documents/characters/projected.json', template = getProjectionTemplates()[0];
  const configuration = Object.fromEntries(template.fields.map(field => [field.id, field.default]));
  configuration.width = 120; configuration.height = 36; configuration.color = '#fedcba';
  await f.write(projectedPath, { format: 'viento-object-projection', schemaVersion: 1, title: 'Projected actor',
    sourceObjectId: definitionId, template: await lockProjectionTemplate(template, { digest }), configuration });
  await f.write(recordPath(projectedId), { format: 'viento-document', version: 1, id: projectedId, sourcePath: projectedPath,
    documentType: 'character', parserProfile: 'structured', relations: [{ kind: 'references', targetId: definitionId, slot: 'projection-source' }], assetBindings: [] });
  await f.edit(recordPath(sceneId), record => { record.relations.push({ kind: 'references', targetId: projectedId }); });
  await f.edit(scenePath, scene => { for (const actor of scene.actors) {
    actor.objectId = projectedId; actor.useProjectionDefaults = true;
    for (const key of ['size', 'color', 'speed', 'controls']) delete actor[key];
  } scene.actors[1].size = [12, 14]; scene.actors[1].color = '#123456'; });
  return { projectedId, projectedPath };
}

test('saved space returns only frozen observed geometry in instance order without author or cache writes', async t => {
  const f = await fixture(t), before = await tree(f.root), reads = [], original = fs.readFile;
  const mock = t.mock.method(fs, 'readFile', async function(file, ...args) { reads.push(String(file)); return original.call(fs, file, ...args); });
  const value = await f.inspect(); mock.mock.restore();
  assert.deepEqual(Object.keys(value), ['format', 'schemaVersion', 'worldId', 'revision', 'scene', 'actors']);
  assert.deepEqual(value.scene, { objectId: sceneId, sourcePath: scenePath, sourceRevision: revision(await f.read(scenePath)),
    title: '2D 关键帧 / Keyframes / キーフレーム', viewport: [800, 480], background: '#0d1829' });
  assert.deepEqual(value.actors.map(actor => [actor.instanceId, actor.objectId, actor.position, actor.size, actor.color]),
    [[instance1, definitionId, [200, 220], [80, 80], '#83ddba'], [instance2, definitionId, [500, 220], [80, 80], '#af94e8']]);
  assert.equal(value.actors[0].sourceRevision, revision(await f.read(definitionPath)));
  assert.equal(reads.filter(file => file === path.join(f.root, scenePath)).length, 2, 'snapshot reads and verifies the scene');
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value.actors[0].position)); assert.equal(JSON.stringify(value).includes(f.root), false);
  assert.equal(Object.hasOwn(value, 'resources'), false); assert.deepEqual(await tree(f.root), before);
});
test('space is available before physics creation and when existing physics content is broken', async t => {
  const f = await fixture(t), initial = await f.inspect();
  await f.write(manifestPath, '{malformed physics'); assert.deepEqual((await f.inspect()).actors, initial.actors);
  await fs.rm(path.join(f.root, manifestPath)); await fs.rm(path.join(f.root, recordPath(manifestId)));
  await f.edit(recordPath(sceneId), record => { record.relations = record.relations.filter(item => item.slot !== 'physics2d'); });
  const before = await tree(f.root), value = await f.inspect(); assert.deepEqual(value.actors, initial.actors); assert.deepEqual(await tree(f.root), before);
});
test('broken animation audio and behavior declarations do not block a physical-space observation', async t => {
  const f = await fixture(t);
  for (const [kind, targetId] of [['audio', id(10)], ['behavior', id(11)], ['animation', id(12)]]) {
    await f.write(`documents/${kind}/broken.json`, '{invalid');
    await f.write(recordPath(targetId), { format: 'viento-document', version: 1, id: targetId, sourcePath: `documents/${kind}/broken.json`,
      documentType: kind, parserProfile: 'structured', relations: [{ kind: 'references', targetId: sceneId }], assetBindings: [] });
    await f.edit(recordPath(sceneId), record => { record.relations.push({ kind, targetId }); });
  }
  assert.equal((await f.inspect()).actors.length, 2);
});
test('v3 group metadata does not change centers or synthesize group offsets', async t => {
  const f = await fixture(t), original = await f.inspect(), groupId = id(40);
  await f.edit(scenePath, scene => { scene.schemaVersion = 3; scene.groups = [{ groupId, name: 'Group' }];
    scene.actors[0].groupId = groupId; scene.actors.reverse(); });
  const value = await f.inspect(); assert.deepEqual(value.actors, [...original.actors].reverse());
  assert.equal(Object.hasOwn(value, 'groups'), false); assert.equal(Object.hasOwn(value.actors[1], 'groupId'), false);
});
test('projection inheritance resolves dimensions and color while preserving per-instance scene overrides', async t => {
  const f = await fixture(t), { projectedId, projectedPath } = await addProjection(f), value = await f.inspect();
  assert.deepEqual(value.actors.map(actor => actor.objectId), [projectedId, projectedId]);
  assert.deepEqual(value.actors.map(actor => actor.size), [[120, 36], [12, 14]]); assert.deepEqual(value.actors.map(actor => actor.color), ['#fedcba', '#123456']);
  assert.deepEqual(value.actors.map(actor => actor.position), [[200, 220], [500, 220]]);
  assert.equal(value.actors[0].sourcePath, projectedPath); assert.equal(value.actors[0].sourceRevision, revision(await f.read(projectedPath)));
});
test('registered missing and corrupt images are not opened or frozen and do not require an engine', async t => {
  const f = await fixture(t), imageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await f.write(`metadata/assets/${imageId}.json`, await fs.readFile(new URL('../../examples/scene2d/metadata/assets/cccccccc-cccc-4ccc-8ccc-cccccccccccc.json', import.meta.url), 'utf8'));
  await f.edit(recordPath(sceneId), record => { record.assetBindings.push({ assetId: imageId, role: 'image' }); });
  await f.edit(scenePath, scene => { scene.actors[0].imageResourceId = imageId; });
  assert.equal((await f.inspect()).actors.length, 2, 'missing image still has registered dimensions and binding');
  await f.write('assets/traveler.svg', '<not-image>');
  const before = await tree(f.root), original = fs.readFile, reads = [];
  const mock = t.mock.method(fs, 'readFile', async function(file, ...args) {
    if (String(file).startsWith(path.join(f.root, 'assets') + path.sep)) throw new Error('Spatial query must never open asset bytes');
    reads.push(String(file)); return original.call(fs, file, ...args);
  });
  const value = await f.inspect(); mock.mock.restore(); assert.equal(value.actors.length, 2);
  assert.equal(reads.some(file => /godot|bevy|toolchain/.test(file)), false); assert.deepEqual(await tree(f.root), before);
});
test('saved scene layout requires valid v2 or v3 semantics without blocking manual physics editing elsewhere', async t => {
  for (const mutate of [scene => { scene.schemaVersion = 1; }, scene => { scene.format = 'viento-scene3d'; },
    scene => { scene.actors[0].position = ['invalid', 0]; }, scene => { scene.actors[0].size = [0, 1]; },
    scene => { scene.actors[0].instanceId = 'bad'; }, scene => { scene.actors[1].instanceId = instance1; },
    scene => { scene.actors = []; }, scene => { scene.viewport = [0, 64]; },
    scene => { scene.actors = Array.from({ length: 129 }, (_, n) => ({ ...scene.actors[0], instanceId: id(n) })); }]) {
    const f = await fixture(t); await f.edit(scenePath, mutate); await assert.rejects(f.inspect(), error('invalid', 400));
  }
});
test('missing definition dependencies invalid projection defaults and absent registration fail closed', async t => {
  for (const mutation of [f => fs.rm(path.join(f.root, definitionPath)), f => fs.rm(path.join(f.root, recordPath(definitionId))),
    f => f.edit(recordPath(sceneId), record => { record.relations = []; }), f => fs.rm(path.join(f.root, recordPath(sceneId))),
    f => f.edit(scenePath, scene => { scene.actors[0].useProjectionDefaults = true; })]) {
    const f = await fixture(t); await mutation(f); await assert.rejects(f.inspect(), unavailableOrInvalid);
  }
  const f = await fixture(t), { projectedPath } = await addProjection(f); await f.edit(projectedPath, projection => { projection.configuration.width = 0; });
  await assert.rejects(f.inspect(), error('invalid', 400));
});
test('invalid metadata paths aliases and symlinks cannot expose host data', async t => {
  for (const mutation of [f => f.edit(recordPath(definitionId), record => { record.sourcePath = '../outside.md'; }),
    f => f.edit(recordPath(definitionId), record => { record.sourcePath = 'documents/hidden:actor.md'; }),
    async f => { await fs.rm(path.join(f.root, definitionPath)); await fs.symlink('/etc/hosts', path.join(f.root, definitionPath)); },
    async f => { const record = JSON.parse(await f.read(recordPath(definitionId))); record.id = id(70); await f.write(recordPath(id(70)), record); }]) {
    const f = await fixture(t); await mutation(f); await assert.rejects(f.inspect(), unavailableOrInvalid);
  }
});
test('scene JSON path casing and bounded labels match the portable space contract', async t => {
  const f = await fixture(t), nextPath = scenePath.replace(/json$/, 'JSON'); await fs.rename(path.join(f.root, scenePath), path.join(f.root, nextPath));
  await f.edit(recordPath(sceneId), record => { record.sourcePath = nextPath; }); await assert.rejects(f.inspect(), error('invalid', 400));
  for (const name of ['x'.repeat(161), 'bad\u0000name', 'bad\u007fname']) {
    const next = await fixture(t); await next.write(definitionPath, `# ${name}\n`); await assert.rejects(next.inspect(), error('invalid', 400));
  }
});
test('request capture rejects extra authority getters symbols hidden and inherited values before awaiting', async t => {
  const f = await fixture(t); let reads = 0;
  for (const input of [null, [], {}, { sceneObjectId: sceneId + '\n' }, { sceneObjectId: sceneId, draft: {} },
    { sceneObjectId: sceneId, execute: true }, { sceneObjectId: sceneId, [Symbol('extra')]: 1 }, Object.create({ sceneObjectId: sceneId }),
    Object.defineProperty({}, 'sceneObjectId', { value: sceneId, enumerable: false }),
    Object.defineProperty({}, 'sceneObjectId', { enumerable: true, get() { reads++; return sceneId; } })]) await assert.rejects(f.service.inspect(input), error('invalid', 400));
  assert.equal(reads, 0); const request = { sceneObjectId: sceneId }, pending = f.service.inspect(request); request.sceneObjectId = id(99);
  assert.equal((await pending).scene.objectId, sceneId);
});
test('concurrent scene and definition edits cannot yield mixed observed geometry', async t => {
  for (const target of [scenePath, definitionPath]) {
    const f = await fixture(t), original = fs.readFile, filename = path.join(f.root, target); let reads = 0;
    const mock = t.mock.method(fs, 'readFile', async function(file, ...args) {
      const value = await original.call(fs, file, ...args);
      if (String(file) === filename && ++reads === 1) await fs.writeFile(filename, String(value) + '\n'); return value;
    });
    try { await assert.rejects(f.inspect(), error('conflict', 409)); assert.ok(reads >= 2); } finally { mock.mock.restore(); }
  }
});
test('pending transactions and transactions appearing during a read invalidate the observation', async t => {
  const pending = await fixture(t); await pending.write('.viento/world-transactions/active', 'pending');
  await assert.rejects(pending.inspect(), error('conflict', 409));
  const f = await fixture(t), original = fs.readFile; let changed = false;
  const mock = t.mock.method(fs, 'readFile', async function(file, ...args) {
    const value = await original.call(fs, file, ...args);
    if (!changed && String(file) === path.join(f.root, scenePath)) { changed = true; await f.write('.viento/world-transactions/active', 'pending'); } return value;
  });
  try { await assert.rejects(f.inspect(), error('conflict', 409)); } finally { mock.mock.restore(); }
});
test('oversized World sources return a bounded error with no partial scene', async t => {
  const f = await fixture(t); await f.write('documents/oversized.txt', 'x'.repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(f.inspect(), error('limit', 413));
});
