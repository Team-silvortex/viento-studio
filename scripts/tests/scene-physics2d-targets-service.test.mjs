import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createScenePhysics2DTargetsService } from '../lib/scene-physics2d-targets-service.mjs';
import { scenePhysics2DTargetsFixture, tree, sceneId, manifestId, definitionId, instance1, instance2,
  scenePath, manifestPath, definitionPath, recordPath, id, revision } from './helpers/scene-physics2d-targets-fixture.mjs';
const error = (kind, status) => e => e.errorCode === `scene_physics2d_targets_${kind}` && e.statusCode === status;
const unavailableOrInvalid = e => /^scene_physics2d_targets_(invalid|unavailable)$/.test(e.errorCode);
async function fixture(t) {
  const f = await scenePhysics2DTargetsFixture(t), service = createScenePhysics2DTargetsService(f.root);
  return { ...f, service, inspect: () => service.inspect({ sceneObjectId: sceneId }) };
}

test('target directory preserves original saved bytes and names with one observed World and no writes', async t => {
  const f = await fixture(t); await f.write(manifestPath, '\ufeff' + (await f.read(manifestPath)).replaceAll('\n', '\r\n'));
  const before = await tree(f.root), reads = [], original = fs.readFile;
  const mock = t.mock.method(fs, 'readFile', async function(file, ...args) { reads.push(String(file)); return original.call(fs, file, ...args); });
  const value = await f.inspect(); mock.mock.restore();
  assert.deepEqual(Object.keys(value), ['format', 'schemaVersion', 'worldId', 'revision', 'scene', 'manifest', 'targets']);
  assert.equal(value.scene.objectId, sceneId); assert.equal(value.manifest.objectId, manifestId);
  assert.equal(value.manifest.content, await f.read(manifestPath)); assert.equal(value.manifest.sourceRevision, revision(value.manifest.content));
  assert.deepEqual(value.targets, [instance1, instance2].map(instanceId => ({ instanceId, objectId: definitionId, name: 'Traveler / 旅人 / 旅人', sourcePath: definitionPath })));
  assert.equal(reads.filter(file => file === path.join(f.root, scenePath)).length, 2, 'one snapshot reads once and verifies once');
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value.targets) && Object.isFrozen(value.targets[0]));
  assert.equal(JSON.stringify(value).includes(f.root), false); assert.deepEqual(await tree(f.root), before);
});
test('unrelated broken animation, audio, behavior and unresolved movement defaults never block instance identities or read resource bytes', async t => {
  const f = await fixture(t), assetId = '99999999-9999-4999-8999-999999999999';
  for (const [kind, targetId] of [['audio', id(10)], ['behavior', id(11)], ['animation', id(12)]]) {
    await f.write(`documents/${kind}/broken.json`, '{not valid JSON');
    await f.write(recordPath(targetId), { format: 'viento-document', version: 1, id: targetId, sourcePath: `documents/${kind}/broken.json`,
      documentType: kind, parserProfile: 'structured', relations: [{ kind: 'references', targetId: sceneId }], assetBindings: [] });
    await f.edit(recordPath(sceneId), value => { value.relations.push({ kind, targetId }); });
  }
  await f.write(`metadata/assets/${assetId}.json`, await fs.readFile(new URL(`../../examples/scene-audio/metadata/assets/${assetId}.json`, import.meta.url), 'utf8'));
  await f.write('assets/tone.wav', 'not WAV bytes');
  await f.edit(scenePath, value => { value.actors[0].position = ['rendering is not consulted']; value.actors[1].useProjectionDefaults = true; delete value.actors[1].controls; delete value.actors[1].speed; });
  const before = await tree(f.root), reads = [], original = fs.readFile;
  const mock = t.mock.method(fs, 'readFile', async function(file, ...args) { reads.push(String(file)); return original.call(fs, file, ...args); });
  assert.equal((await f.inspect()).targets.length, 2); mock.mock.restore();
  assert.equal(reads.some(file => file.endsWith('.wav')), false); assert.deepEqual(await tree(f.root), before);
});
test('removed body targets remain readable so a current instance can repair them', async t => {
  const f = await fixture(t); await f.edit(scenePath, value => { value.actors = value.actors.slice(1); });
  const value = await f.inspect(); assert.deepEqual(value.targets.map(target => target.instanceId), [instance2]);
  assert.ok(JSON.parse(value.manifest.content).bodies.some(body => body.instanceId === instance1));
});
test('Scene2D v3 and multiple named definitions retain scene instance ordering', async t => {
  const f = await fixture(t), nextId = id(20), nextPath = 'documents/characters/second.md';
  await f.write(nextPath, '# 第二位 / セカンド / Second\n');
  const record = JSON.parse(await f.read(recordPath(definitionId))); record.id = nextId; record.sourcePath = nextPath; await f.write(recordPath(nextId), record);
  await f.edit(recordPath(sceneId), value => { value.relations.push({ kind: 'references', targetId: nextId }); });
  await f.edit(scenePath, value => { value.schemaVersion = 3; value.groups = []; value.actors[1].objectId = nextId; value.actors.reverse(); });
  const value = await f.inspect(); assert.deepEqual(value.targets.map(target => target.instanceId), [instance2, instance1]);
  assert.equal(value.targets[0].name, '第二位 / セカンド / Second'); assert.equal(value.targets[0].sourcePath, nextPath);
});
test('physics opt-in requires exactly one available distinct registered JSON source', async t => {
  for (const mutation of [f => f.edit(recordPath(sceneId), value => { value.relations = value.relations.filter(relation => relation.slot !== 'physics2d'); }),
    f => f.edit(recordPath(sceneId), value => { value.relations.push({ kind: 'references', targetId: definitionId, slot: 'physics2d' }); }),
    f => f.edit(recordPath(sceneId), value => { value.relations.find(relation => relation.slot === 'physics2d').targetId = sceneId; }),
    f => f.edit(recordPath(sceneId), value => { value.relations.find(relation => relation.slot === 'physics2d').targetId = definitionId; }),
    f => fs.rm(path.join(f.root, manifestPath)), f => fs.rm(path.join(f.root, recordPath(manifestId)))]) {
    const f = await fixture(t); await mutation(f); const before = await tree(f.root);
    await assert.rejects(f.inspect(), unavailableOrInvalid); assert.deepEqual(await tree(f.root), before);
  }
});
test('manifest Rust semantics, declared scene and explicit references backreference are required', async t => {
  for (const mutation of [f => f.edit(manifestPath, value => { value.sceneObjectId = id(1); }),
    f => f.edit(manifestPath, value => { value.bodies[0].shape.size[0] = 0; }),
    f => f.edit(manifestPath, value => { value.bodies[0].kind = 'unsupported'; }),
    f => f.write(manifestPath, '{broken'), f => f.edit(recordPath(manifestId), value => { value.relations = []; }),
    f => f.edit(recordPath(manifestId), value => { value.relations = [{ kind: 'part-of', targetId: sceneId }]; }),
    f => f.edit(recordPath(manifestId), value => { value.relations = [{ kind: 'reference', targetId: sceneId }]; })]) {
    const f = await fixture(t); await mutation(f); await assert.rejects(f.inspect(), error('invalid', 400));
  }
});
test('all scene definitions must be readable registered dependencies linked without ownership', async t => {
  for (const mutation of [f => fs.rm(path.join(f.root, definitionPath)), f => fs.rm(path.join(f.root, recordPath(definitionId))),
    f => f.edit(recordPath(sceneId), value => { value.relations = value.relations.filter(relation => relation.targetId !== definitionId); }),
    f => f.edit(recordPath(sceneId), value => { value.relations.find(relation => relation.targetId === definitionId).kind = 'part-of'; }),
    f => f.edit(scenePath, value => { value.actors[0].objectId = manifestId; })]) {
    const f = await fixture(t); await mutation(f); await assert.rejects(f.inspect(), unavailableOrInvalid);
  }
});
test('scene shape identity rejects old versions, invalid UUIDs, duplicate instances, empty or oversized actor lists', async t => {
  for (const mutation of [value => { value.schemaVersion = 1; }, value => { value.format = 'viento-scene3d'; },
    value => { value.actors[0].instanceId = 'bad'; }, value => { value.actors[1].instanceId = instance1; },
    value => { value.actors[0].objectId = 'bad'; }, value => { value.actors = []; },
    value => { value.actors = Array.from({ length: 129 }, (_, n) => ({ ...value.actors[0], instanceId: id(n) })); }]) {
    const f = await fixture(t); await f.edit(scenePath, mutation); await assert.rejects(f.inspect(), error('invalid', 400));
  }
});
test('malformed metadata, ambiguous identities and unsupported source paths fail closed', async t => {
  for (const mutation of [f => f.edit(recordPath(definitionId), value => { value.parserProfile = 'not-a-parser'; }),
    f => f.edit(recordPath(definitionId), value => { value.sourcePath = '../outside.md'; }),
    f => f.edit(recordPath(definitionId), value => { value.sourcePath = 'documents/characters/hidden:target.md'; }),
    f => f.write(recordPath(id(3)), '{}'),
    async f => { const value = JSON.parse(await f.read(recordPath(definitionId))); value.id = id(4); await f.write(recordPath(id(4)), value); }]) {
    const f = await fixture(t); await mutation(f); await assert.rejects(f.inspect(), unavailableOrInvalid);
  }
});
test('definition symlinks cannot escape the project read boundary', async t => {
  const f = await fixture(t); await fs.rm(path.join(f.root, definitionPath));
  await fs.symlink('/etc/hosts', path.join(f.root, definitionPath)); await assert.rejects(f.inspect(), error('unavailable', 422));
});
test('names and manifest UTF-8 size are bounded independently from executable rendering', async t => {
  for (const name of ['x'.repeat(161), 'Name\u0000Hidden', 'Name\u007fHidden']) {
    const f = await fixture(t); await f.write(definitionPath, `# ${name}\n`); await assert.rejects(f.inspect(), error('invalid', 400));
  }
  for (const padding of [' '.repeat(65537), '中'.repeat(22000)]) {
    const f = await fixture(t); await f.write(manifestPath, (await f.read(manifestPath)) + padding); await assert.rejects(f.inspect(), error('limit', 413));
  }
});
test('request identity is captured synchronously without invoking getters or accepting extra authority', async t => {
  const f = await fixture(t); let calls = 0;
  for (const input of [null, {}, [], { sceneObjectId: sceneId + '\n' }, { sceneObjectId: sceneId, execute: true }, Object.create({ sceneObjectId: sceneId }),
    Object.defineProperty({}, 'sceneObjectId', { enumerable: true, get() { calls++; return sceneId; } })])
    await assert.rejects(f.service.inspect(input), error('invalid', 400));
  assert.equal(calls, 0); const input = { sceneObjectId: sceneId }, pending = f.service.inspect(input); input.sceneObjectId = id(99);
  assert.equal((await pending).scene.objectId, sceneId);
});
test('changed scene bytes cannot return a mixed directory snapshot', async t => {
  const f = await fixture(t), original = fs.readFile, filename = path.join(f.root, scenePath); let count = 0;
  const mock = t.mock.method(fs, 'readFile', async function(file, ...args) {
    const value = await original.call(fs, file, ...args); if (String(file) === filename && ++count === 1) await fs.writeFile(filename, String(value) + '\n'); return value;
  });
  await assert.rejects(f.inspect(), error('conflict', 409)); mock.mock.restore(); assert.ok(count >= 2);
});
test('World source limits remain explicit errors rather than empty target choices', async t => {
  const f = await fixture(t); await f.write('documents/oversized.txt', 'x'.repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(f.inspect(), error('limit', 413));
});

test('the physics slot only accepts references, and cannot borrow another subsystem relation', async t => {
  for (const mutation of [relation => { relation.kind = 'animation'; }, relation => { relation.kind = 'reference'; },
    relation => { relation.slot = 'physics'; }, relation => { relation.slot = ''; }]) {
    const f = await fixture(t);
    await f.edit(recordPath(sceneId), record => mutation(record.relations.find(relation => relation.slot === 'physics2d')));
    await assert.rejects(f.inspect(), error('unavailable', 422));
  }
});
test('scene and physics paths obey the lowercase JSON declaration contract', async t => {
  for (const [oldPath, objectId] of [[scenePath, sceneId], [manifestPath, manifestId]]) {
    const f = await fixture(t), nextPath = oldPath.slice(0, -4) + 'JSON';
    await fs.rename(path.join(f.root, oldPath), path.join(f.root, nextPath));
    await f.edit(recordPath(objectId), record => { record.sourcePath = nextPath; });
    await assert.rejects(f.inspect(), error('invalid', 400));
  }
});
test('manifest and definition changes during the saved read cannot leak a mixed source directory', async t => {
  for (const sourcePath of [manifestPath, definitionPath]) {
    const f = await fixture(t), original = fs.readFile, filename = path.join(f.root, sourcePath); let count = 0;
    const mock = t.mock.method(fs, 'readFile', async function(file, ...args) {
      const value = await original.call(fs, file, ...args);
      if (String(file) === filename && ++count === 1) await fs.writeFile(filename, String(value) + '\n');
      return value;
    });
    try { await assert.rejects(f.inspect(), error('conflict', 409)); assert.ok(count >= 2); }
    finally { mock.mock.restore(); }
  }
});
