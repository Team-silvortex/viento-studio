import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseJsonSource, locateJsonSource } from '../../engine/json-source.mjs';
import { createScene3DPropertiesProposal, prepareScene3DPropertiesApply, isScene3DPropertiesProposal } from '../../engine/scene3d-properties.mjs';

const model = JSON.parse(await fs.readFile(new URL('../../examples/scene3d/scene.json', import.meta.url), 'utf8'));
const serialize = value => '\ufeff' + JSON.stringify(value, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
const original = serialize(model), hash = value => createHash('sha256').update(value).digest('hex');
const source = (content = original) => ({ sourcePath: 'documents/scene.json', token: '3:7:1:1', content,
  baseSourceRevision: `sha256:${hash(original)}`, sourceRevision: `sha256:${hash(content)}` });
const id = model.objects[0].instanceId;
const propose = (values, content = original, instanceId = id) => createScene3DPropertiesProposal(source(content), { instanceId, values });
const raw = (content, path) => { const range = locateJsonSource(parseJsonSource(content), path); assert.equal(range.exact, true); return content.slice(range.start, range.end); };
const conflict = error => error?.errorCode === 'scene3d_properties_conflict';

test('property review changes only selected name and color values in canonical order while retaining geometry and environment bytes', async () => {
  const p = propose({ color: '#012ABC', name: ' Scene \n object 🎭 ' });
  assert.equal(p.kind, 'scene3d-properties'); assert.equal(p.instanceId, id);
  assert.deepEqual(p.beforeObject, model.objects[0]);
  assert.deepEqual(p.afterObject, { ...model.objects[0], name: ' Scene \n object 🎭 ', color: '#012ABC' });
  assert.deepEqual(p.changedPaths, ['/objects/0/name', '/objects/0/color']);
  for (const field of ['format', 'schemaVersion', 'name', 'viewport', 'background', 'camera', 'light']) assert.equal(raw(p.afterContent, `/${field}`), raw(original, `/${field}`));
  for (const field of ['instanceId', 'primitive', 'position', 'rotationDegrees', 'size']) assert.equal(raw(p.afterContent, `/objects/0/${field}`), raw(original, `/objects/0/${field}`));
  for (let i = 1; i < model.objects.length; i++) assert.equal(raw(p.afterContent, `/objects/${i}`), raw(original, `/objects/${i}`));
  assert.ok(p.afterContent.startsWith('\ufeff')); assert.ok(p.afterContent.endsWith('\r\n'));
  const applied = await prepareScene3DPropertiesApply(source(), p, { digest: hash });
  assert.equal(applied.afterContent, p.afterContent); assert.equal(Object.isFrozen(applied.changedPaths), true);
});
test('UUID chooses its current object after author order changes without touching another object', () => {
  const reversed = { ...model, objects: [...model.objects].reverse() }, text = serialize(reversed);
  const i = reversed.objects.findIndex(object => object.instanceId === id), p = propose({ name: 'renamed' }, text);
  assert.deepEqual(p.changedPaths, [`/objects/${i}/name`]); assert.equal(p.afterObject.instanceId, id);
  for (let j = 0; j < reversed.objects.length; j++) if (j !== i) assert.equal(raw(p.afterContent, `/objects/${j}`), raw(text, `/objects/${j}`));
});
test('same decoded names and colors preserve escaped author tokens while an explicit color case change is reviewed', () => {
  const text = original.replace(JSON.stringify(model.objects[0].name), JSON.stringify(model.objects[0].name).replace(/.$/, '\\u0020"'));
  const authored = JSON.parse(text.slice(1)).objects[0].name;
  assert.throws(() => propose({ name: authored, color: model.objects[0].color }, text), error => error.errorCode === 'scene3d_properties_unchanged');
  const upper = model.objects[0].color.toUpperCase(), candidate = upper === model.objects[0].color ? '#abcdef' : upper;
  const p = propose({ name: authored, color: candidate }, text);
  assert.equal(raw(p.afterContent, '/objects/0/name'), raw(text, '/objects/0/name')); assert.deepEqual(p.changedPaths, ['/objects/0/color']);
});
test('legacy names retain whitespace newlines and Unicode codepoints without trimming or UTF16 limits', () => {
  for (const name of [' ', '\r\n\r\n', 'a\u0000b', '🎭'.repeat(256)]) assert.equal(propose({ name }).afterObject.name, name);
  for (const name of ['', '🎭'.repeat(257)]) assert.throws(() => propose({ name }));
});
test('property intent refuses implicit geometry unknown fields null empty malformed color and absent instances', () => {
  for (const values of [{}, { name: null }, { color: null }, { position: [1, 2, 3] }, { size: [1, 1, 1] },
    { instanceId: id }, { name: 'a', metadata: {} }, { color: '#fff' }, { color: '#xyzxyz' }, { name: 1 }]) assert.throws(() => propose(values));
  assert.throws(() => propose({ name: 'x' }, original, '60000000-1111-4111-8111-111111111111'));
  assert.deepEqual(JSON.parse(original.slice(1)), model);
});
test('review detaches and deeply freezes raw intent and both complete selected object models', () => {
  const values = { name: 'frozen', color: '#123456' }, p = propose(values); values.name = 'late';
  assert.equal(p.values.name, 'frozen'); assert.equal(Object.isFrozen(p.beforeObject.position), true); assert.equal(Object.isFrozen(p.afterObject.size), true);
  assert.equal(Object.isFrozen(p.values), true); assert.equal(isScene3DPropertiesProposal(structuredClone(p)), false);
  let reads = 0; const bad = Object.defineProperty({ instanceId: id }, 'values', { enumerable: true, get() { reads++; return values; } });
  assert.throws(() => createScene3DPropertiesProposal(source(), bad)); assert.equal(reads, 0);
});
test('apply binds path owner every source byte saved base current revision and a verified digest', async () => {
  const s = source(), p = propose({ color: '#123456' });
  for (const field of ['sourcePath', 'token', 'content', 'baseSourceRevision', 'sourceRevision']) {
    const changed = { ...s, [field]: field.includes('Revision') ? `sha256:${'0'.repeat(64)}` : field === 'sourcePath' ? 'documents/other.json' : s[field] + ' ' };
    await assert.rejects(prepareScene3DPropertiesApply(changed, p, { digest: hash }), conflict);
  }
  for (const digest of [() => '0'.repeat(64), () => 'ABC', null]) await assert.rejects(prepareScene3DPropertiesApply(s, p, { digest }), conflict);
  for (const fake of [structuredClone(p), null, {}]) await assert.rejects(prepareScene3DPropertiesApply(s, fake, { digest: hash }), conflict);
});
test('source snapshot is captured before the digest await and later caller mutation cannot alter admitted bytes', async () => {
  const s = source(), p = propose({ name: 'captured' }); let release;
  const pending = prepareScene3DPropertiesApply(s, p, { digest: async text => { await new Promise(resolve => { release = resolve; }); return hash(text); } });
  s.content = 'late replacement'; s.token = 'late owner'; release();
  assert.equal((await pending).afterContent, p.afterContent);
});
