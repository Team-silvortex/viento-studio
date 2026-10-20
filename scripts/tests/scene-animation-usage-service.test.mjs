import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createSceneAnimationUsageService } from '../lib/scene-animation-usage-service.mjs';
import { captureSceneAnimationUsage } from '../../engine/scene-animation-usage.mjs';
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', animationId = '88888888-8888-4888-8888-888888888887';
const behaviorId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', assetId = '99999999-9999-4999-8999-999999999999';
const scenePath = 'documents/scenes/demo.json', animationPath = 'documents/animations/demo.json', behaviorPath = 'documents/behaviors/demo.json';
const clipId = '77777777-7777-4777-8777-000000000001';
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const recordPath = value => `metadata/documents/${value}.json`;
const json = value => JSON.stringify(value, null, 2) + '\n';
const revision = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const error = (kind, status) => e => e.errorCode === `scene_animation_usage_${kind}` && e.statusCode === status;
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-animation-usage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(new URL('../../examples/scene-animation/', import.meta.url), root, { recursive: true });
  const read = name => fs.readFile(path.join(root, name), 'utf8');
  const write = async (name, value) => { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : json(value)); };
  const edit = async (name, change) => { const value = JSON.parse(await read(name)); change(value); await write(name, value); };
  await write(behaviorPath, await fs.readFile(new URL('../../examples/scene-behaviors/' + behaviorPath, import.meta.url), 'utf8'));
  await write(recordPath(behaviorId), await fs.readFile(new URL('../../examples/scene-behaviors/' + recordPath(behaviorId), import.meta.url), 'utf8'));
  await edit(recordPath(behaviorId), value => { value.relations = value.relations.filter(relation => relation.targetId === sceneId); });
  await edit(recordPath(sceneId), value => { value.relations.push({ kind: 'behavior', targetId: behaviorId, slot: '' }); });
  await edit(behaviorPath, value => { value.bindings[0].parameters = { anyName: clipId, future: id(55) }; value.bindings[1].parameters = { another: clipId }; });
  await edit(animationPath, value => { value.schemaVersion = 3; value.clips = [{ id: clipId, name: '待機 / Idle', startSeconds: 0, endSeconds: 1, loop: true }]; });
  const image = Buffer.from('intentionally not decoded by a usage directory');
  await write('assets/atlas.png', image);
  await write(`metadata/assets/${assetId}.json`, { format: 'viento-asset', version: 1, id: assetId, name: 'Sprite atlas', kind: 'image', tags: [],
    location: { store: 'main', path: 'atlas.png' }, content: { size: image.length, sha256: createHash('sha256').update(image).digest('hex') }, legacyPaths: ['assets/atlas.png'] });
  const service = createSceneAnimationUsageService(root);
  return { root, read, write, edit, service, inspect: () => service.inspect({ sceneObjectId: sceneId }) };
}
async function tree(root) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name); result[path.relative(root, file)] = revision(await fs.readFile(file));
  }
  return result;
}

test('usage observes saved selected sources and original bytes without author writes image reads or script execution', async t => {
  const f = await fixture(t);
  for (const name of [animationPath, behaviorPath]) await f.write(name, '\ufeff' + (await f.read(name)).replaceAll('\n', '\r\n'));
  const before = await tree(f.root), reads = [], original = fs.readFile;
  const mock = t.mock.method(fs, 'readFile', async function(file, ...args) { reads.push(String(file)); return original.call(fs, file, ...args); });
  const value = await f.inspect(); mock.mock.restore();
  assert.equal(value.scene.objectId, sceneId); assert.equal(value.animation.objectId, animationId); assert.equal(value.behavior.objectId, behaviorId);
  assert.equal(value.animation.content, await f.read(animationPath)); assert.equal(value.behavior.content, await f.read(behaviorPath));
  assert.equal(value.animation.sourceRevision, revision(value.animation.content)); assert.equal(value.behavior.sourceRevision, revision(value.behavior.content));
  assert.ok(Object.isFrozen(value.behavior)); assert.equal(JSON.stringify(value).includes(f.root), false);
  assert.equal(reads.some(file => file.endsWith('.png')), false); assert.deepEqual(await tree(f.root), before);
  const catalog = captureSceneAnimationUsage({ sourcePath: animationPath, token: 'read:1', content: value.animation.content,
    sourceRevision: value.animation.sourceRevision, baseSourceRevision: value.animation.sourceRevision }, value);
  assert.deepEqual(catalog.matches.map(match => match.parameterName), ['anyName', 'future', 'another']);
});
test('unselected behaviors are ignored, and absence of a behavior opt-in is distinct from malformed selected content', async t => {
  const f = await fixture(t); await f.edit(recordPath(sceneId), value => { value.relations = value.relations.filter(relation => relation.kind !== 'behavior'); });
  await f.write(behaviorPath, '{broken selected nowhere');
  const before = await tree(f.root), value = await f.inspect(); assert.equal(value.behavior, null); assert.deepEqual(await tree(f.root), before);
  await f.edit(recordPath(sceneId), record => { record.relations.push({ kind: 'behavior', targetId: behaviorId, slot: '' }); });
  await assert.rejects(f.inspect(), error('invalid', 400));
});
test('source observation does not require actor rendering, missing script definitions, image bytes or resource registrations', async t => {
  const f = await fixture(t); await fs.rm(path.join(f.root, 'documents/characters/traveler.md'));
  await f.edit(scenePath, value => { value.actors[0].position = ['not a render coordinate']; });
  await f.edit(animationPath, value => { value.tracks[0].instanceId = id(62); });
  await f.edit(behaviorPath, value => { value.bindings[0].instanceId = id(60); value.bindings[0].implementation.sourceObjectId = id(61); });
  await f.edit(recordPath(behaviorId), value => { value.relations = [{ kind: 'references', targetId: sceneId, slot: '' }]; });
  await fs.rm(path.join(f.root, 'assets/atlas.png')); await fs.rm(path.join(f.root, `metadata/assets/${assetId}.json`));
  await f.edit(recordPath(animationId), value => { value.assetBindings = []; });
  assert.equal((await f.inspect()).behavior.objectId, behaviorId);
  await f.write('assets/atlas.png', 'corrupt image bytes'); assert.equal((await f.inspect()).animation.objectId, animationId);
});
test('more than 256 unrelated registered assets do not impose creation-picker limits on usage observation', async t => {
  const f = await fixture(t), original = JSON.parse(await f.read(`metadata/assets/${assetId}.json`));
  for (let n = 0; n < 257; n++) { const asset = structuredClone(original); asset.id = id(n); asset.location.path = `extra-${n}.png`; asset.legacyPaths = [];
    await f.write(`metadata/assets/${asset.id}.json`, asset); }
  const before = await tree(f.root); assert.equal((await f.inspect()).animation.objectId, animationId); assert.deepEqual(await tree(f.root), before);
});
test('selected animation and behavior registrations require unambiguous identities and available source', async t => {
  for (const target of [animationId, behaviorId]) for (const mutation of [f => f.edit(recordPath(sceneId), value => {
    value.relations.push({ kind: target === animationId ? 'animation' : 'behavior', targetId: id(1), slot: '' }); }),
    f => fs.rm(path.join(f.root, recordPath(target))), f => fs.rm(path.join(f.root, target === animationId ? animationPath : behaviorPath))]) {
    const f = await fixture(t); await mutation(f); const before = await tree(f.root);
    await assert.rejects(f.inspect(), e => /^scene_animation_usage_(invalid|unavailable)$/.test(e.errorCode)); assert.deepEqual(await tree(f.root), before);
  }
});
test('missing animation opt-in does not return a misleading successful empty usage result', async t => {
  const f = await fixture(t); await f.edit(recordPath(sceneId), value => { value.relations = value.relations.filter(relation => relation.kind !== 'animation'); });
  await assert.rejects(f.inspect(), error('unavailable', 422));
});
test('both selected documents must declare this scene and have a nonownership reverse reference', async t => {
  for (const [target, name] of [[animationId, animationPath], [behaviorId, behaviorPath]]) for (const mutation of [f => f.edit(name, value => { value.sceneObjectId = id(1); }),
    f => f.edit(recordPath(target), value => { value.relations = []; }),
    f => f.edit(recordPath(target), value => { value.relations = [{ kind: 'part-of', targetId: sceneId, slot: '' }]; }), f => f.write(name, '{}')]) {
    const f = await fixture(t); await mutation(f); await assert.rejects(f.inspect(), error('invalid', 400));
  }
});
test('scene registration and Scene2D v2 or v3 identity are validated independently from executable dependencies', async t => {
  const valid = await fixture(t); await valid.edit(scenePath, value => { value.schemaVersion = 3; value.groups = []; }); assert.equal((await valid.inspect()).scene.objectId, sceneId);
  for (const mutation of [f => f.edit(scenePath, value => { value.schemaVersion = 1; }), f => f.edit(scenePath, value => { value.format = 'other'; }),
    f => f.edit(scenePath, value => { value.actors[0].instanceId = 'invalid'; }), f => f.write(scenePath, '{broken'),
    f => f.edit(recordPath(sceneId), value => { value.relations = [{ kind: 'animation', targetId: sceneId, slot: '' }]; })]) {
    const f = await fixture(t); await mutation(f); await assert.rejects(f.inspect(), error('invalid', 400));
  }
});
test('animation and behavior sources have separate strict UTF-8 byte budgets and malformed semantics fail', async t => {
  for (const [name, limit] of [[animationPath, 131072], [behaviorPath, 32768]]) for (const trailing of [' '.repeat(limit + 1), '中'.repeat(Math.ceil(limit / 3))]) {
    const f = await fixture(t); await f.write(name, (await f.read(name)) + trailing); await assert.rejects(f.inspect(), error('limit', 413));
  }
  const duplicate = await fixture(t); await duplicate.edit(behaviorPath, value => { value.bindings.push(value.bindings[0]); });
  await assert.rejects(duplicate.inspect(), error('invalid', 400));
});
test('request identity is captured synchronously and rejects nonplain descriptors without invoking getters', async t => {
  const f = await fixture(t); let calls = 0;
  for (const input of [null, {}, [], { sceneObjectId: sceneId, execute: true }, Object.create({ sceneObjectId: sceneId }),
    Object.defineProperty({}, 'sceneObjectId', { enumerable: true, get() { calls++; return sceneId; } })])
    await assert.rejects(f.service.inspect(input), error('invalid', 400));
  assert.equal(calls, 0);
  const input = { sceneObjectId: sceneId }, pending = f.service.inspect(input); input.sceneObjectId = id(99);
  assert.equal((await pending).scene.objectId, sceneId);
});
test('changed saved behavior bytes cannot yield a mixed scene/animation/behavior snapshot', async t => {
  const f = await fixture(t), original = fs.readFile, filename = path.join(f.root, behaviorPath); let count = 0;
  const mock = t.mock.method(fs, 'readFile', async function(file, ...args) {
    const value = await original.call(fs, file, ...args);
    if (String(file) === filename && ++count === 1) await fs.writeFile(filename, String(value) + '\n');
    return value;
  });
  await assert.rejects(f.inspect(), error('conflict', 409)); mock.mock.restore(); assert.ok(count >= 2);
});
test('global World reader source limits remain unavailable observations rather than zero matches', async t => {
  const f = await fixture(t); await f.write('documents/oversized.txt', 'x'.repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(f.inspect(), error('limit', 413));
});

test('saved schema1 schema2 and empty schema3 animations remain observable without source upgrades', async t => {
  const f = await fixture(t);
  for (const schemaVersion of [1, 2, 3]) {
    await f.edit(animationPath, value => { value.schemaVersion = schemaVersion; if (schemaVersion === 3) value.clips = []; else delete value.clips; });
    const before = await tree(f.root), observed = await f.inspect();
    assert.equal(observed.animation.content, await f.read(animationPath));
    const catalog = captureSceneAnimationUsage({ sourcePath: animationPath, token: 'read:legacy', content: observed.animation.content,
      sourceRevision: observed.animation.sourceRevision, baseSourceRevision: observed.animation.sourceRevision }, observed);
    assert.equal(catalog.matches.length, 3); assert.deepEqual(await tree(f.root), before);
  }
});
test('formatted animation and behavior sources remain readable exactly at their respective UTF8 byte budgets', async t => {
  const f = await fixture(t);
  for (const [name, limit] of [[animationPath, 131072], [behaviorPath, 32768]]) {
    const original = await f.read(name); await f.write(name, original + ' '.repeat(limit - Buffer.byteLength(original)));
  }
  const before = await tree(f.root), observed = await f.inspect();
  assert.equal(Buffer.byteLength(observed.animation.content), 131072); assert.equal(Buffer.byteLength(observed.behavior.content), 32768);
  assert.deepEqual(await tree(f.root), before);
});
test('changed saved animation bytes are a conflict rather than a mixture with unchanged behavior observations', async t => {
  const f = await fixture(t), original = fs.readFile, filename = path.join(f.root, animationPath); let count = 0;
  const mock = t.mock.method(fs, 'readFile', async function(file, ...args) {
    const value = await original.call(fs, file, ...args);
    if (String(file) === filename && ++count === 1) await fs.writeFile(filename, String(value) + '\n');
    return value;
  });
  await assert.rejects(f.inspect(), error('conflict', 409)); mock.mock.restore(); assert.ok(count >= 2);
});
