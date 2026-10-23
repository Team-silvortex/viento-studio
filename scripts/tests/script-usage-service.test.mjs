import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createScriptUsageService } from '../lib/script-usage-service.mjs';
import { captureScriptUsage, SCRIPT_USAGE_LIMITS } from '../../engine/script-usage.mjs';
const scriptId = 'ffffffff-ffff-4fff-8fff-ffffffffffff', behaviorId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const scriptPath = 'documents/scripts/checkpoint.txt', behaviorPath = 'documents/behaviors/demo.json';
const recordPath = objectId => `metadata/documents/${objectId}.json`, json = value => JSON.stringify(value, null, 2) + '\n';
const id = value => `aaaaaaaa-0000-4000-8000-${String(value).padStart(12, '0')}`;
const revision = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const failure = (kind, statusCode) => error => error.errorCode === `script_usage_${kind}` && error.statusCode === statusCode;
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-script-usage-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(new URL('../../examples/scene-behaviors/', import.meta.url), root, { recursive: true });
  const read = file => fs.readFile(path.join(root, file), 'utf8');
  const write = async (file, value) => { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), typeof value === 'string' || Buffer.isBuffer(value) ? value : json(value)); };
  const edit = async (file, update) => { const value = JSON.parse(await read(file)); update(value); await write(file, value); };
  const add = async (number, content, relations = [{ kind: 'reference', targetId: scriptId }], extension = 'json') => {
    const sourcePath = `documents/references/${number}.${extension}`;
    if (content !== null) await write(sourcePath, content);
    await write(recordPath(id(number)), { format: 'viento-document', version: 1, id: id(number), sourcePath, documentType: 'document', parserProfile: 'structured', assetBindings: [], relations }); return sourcePath;
  };
  const service = createScriptUsageService(root), inspect = () => service.inspect({ sourcePath: scriptPath });
  const catalog = async () => { const value = await inspect(), content = await read(scriptPath); return captureScriptUsage({ sourcePath: scriptPath, token: 'test', content, sourceRevision: revision(content), baseSourceRevision: value.script.sourceRevision }, value); };
  return { root, read, write, edit, add, service, inspect, catalog };
}
async function tree(root) {
  const files = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) { const file = path.join(entry.parentPath || entry.path, entry.name); files[path.relative(root, file)] = revision(await fs.readFile(file)); }
  return files;
}

test('saved script usage observes every registered nonownership reference without reading media or writing files', async t => {
  const f = await fixture(t); await f.write(scriptPath, '# must never execute\nthrow new Error("secret");\n');
  await f.edit(recordPath(behaviorId), value => value.relations.push({ kind: 'references', targetId: scriptId }));
  const other = JSON.parse(await f.read(behaviorPath)); other.sceneObjectId = id(50); other.bindings[0].implementation.backendId = other.bindings[1].implementation.backendId = 'org.example.other';
  await f.add(3, other); await f.add(4, '# notes', undefined, 'md'); await f.add(5, '# owner only', [{ kind: 'part-of', targetId: scriptId }], 'md');
  await f.add(6, other, []); await f.write('documents/unregistered.json', other);
  const before = await tree(f.root), reads = [], original = fs.readFile;
  const spy = t.mock.method(fs, 'readFile', async function(file, ...args) { reads.push(String(file)); return original.call(fs, file, ...args); });
  const raw = await f.inspect(); spy.mock.restore(); const catalog = await f.catalog();
  assert.equal(raw.references.length, 3); assert.equal(catalog.matches.length, 4);
  assert.deepEqual(raw.references.find(row => row.objectId === behaviorId).relationKinds, ['reference', 'references']);
  assert.equal(catalog.references.find(row => row.objectId === id(4)).status, 'non-behavior');
  assert.equal(catalog.matches.filter(row => row.documentObjectId === id(3)).every(row => row.sceneObjectId === id(50) && row.backendId === 'org.example.other'), true);
  assert.equal(reads.some(file => /\.(?:png|wav|mp4)$/.test(file)), false); assert.equal(JSON.stringify(raw).includes(f.root), false);
  assert.equal(JSON.stringify(raw).includes('must never execute'), false); assert.deepEqual(await tree(f.root), before);
});
test('unused malformed unavailable and nonbehavior references remain explicit even when execution dependencies are broken', async t => {
  const f = await fixture(t), other = JSON.parse(await f.read(behaviorPath)); other.bindings.forEach(binding => binding.implementation.sourceObjectId = id(55));
  await f.add(3, other); await f.add(4, '{"format":"viento-scene-behaviors",'); await f.add(5, '{broken'); await f.add(6, null); await f.add(7, '# note', undefined, 'md');
  await f.write('documents/scenes/demo.json', '{broken scene'); await fs.rm(path.join(f.root, 'documents/characters/traveler.md'));
  const catalog = await f.catalog(); assert.equal(catalog.references.find(row => row.objectId === behaviorId).status, 'bound');
  assert.deepEqual([3,4,5,6,7].map(n => catalog.references.find(row => row.objectId === id(n)).status), ['unbound', 'invalid-behavior', 'invalid-json', 'unavailable', 'non-behavior']);
  assert.equal(catalog.references.find(row => row.objectId === id(6)).sourceRevision, null);
});
test('changed reference content registrations and script bytes revoke the observed world revision', async t => {
  const f = await fixture(t), before = await f.inspect(); await f.write(behaviorPath, (await f.read(behaviorPath)) + '\n'); const content = await f.inspect(); assert.notEqual(content.revision, before.revision);
  await f.edit(recordPath(behaviorId), value => value.relations.push({ kind: 'another', targetId: scriptId })); const metadata = await f.inspect(); assert.notEqual(metadata.revision, content.revision);
  await f.write(scriptPath, (await f.read(scriptPath)) + '\n'); const script = await f.inspect(); assert.notEqual(script.revision, metadata.revision); assert.notEqual(script.script.sourceRevision, before.script.sourceRevision);
});
test('missing unregistered non-TXT and accessor requests cannot silently report no usage', async t => {
  const f = await fixture(t); let calls = 0; const getter = {}; Object.defineProperty(getter, 'sourcePath', { enumerable: true, get() { calls++; return scriptPath; } });
  for (const input of [getter, null, [], {}, { sourcePath: scriptPath, execute: true }, { sourcePath: '../script.txt' }, { sourcePath: scriptPath + '\n' }, { sourcePath: behaviorPath }]) await assert.rejects(f.service.inspect(input), failure('invalid', 400));
  assert.equal(calls, 0); await assert.rejects(f.service.inspect({ sourcePath: 'documents/missing.txt' }), failure('unavailable', 422));
  await f.write('documents/unregistered.txt', '# source'); await assert.rejects(f.service.inspect({ sourcePath: 'documents/unregistered.txt' }), failure('unavailable', 422));
  await fs.rm(path.join(f.root, scriptPath)); await assert.rejects(f.inspect(), failure('unavailable', 422));
});
test('request is captured before asynchronous read and same-size external edits reject a mixed observation', async t => {
  const f = await fixture(t), input = { sourcePath: scriptPath }, pending = f.service.inspect(input); input.sourcePath = behaviorPath; assert.equal((await pending).script.sourcePath, scriptPath);
  const original = fs.readFile; let changed = false;
  const spy = t.mock.method(fs, 'readFile', async function(file, ...args) {
    const content = await original.call(fs, file, ...args);
    if (!changed && String(file) === path.join(f.root, behaviorPath)) { changed = true; const bytes = Buffer.from(content), stat = await fs.stat(file); bytes[bytes.length - 2] ^= 1; await fs.writeFile(file, bytes); await fs.utimes(file, stat.atime, stat.mtime); }
    return content;
  });
  await assert.rejects(f.inspect(), failure('conflict', 409)); spy.mock.restore(); assert.equal(changed, true);
});
test('script and individual reference UTF8 limits reject the whole result without truncation', async t => {
  for (const target of ['script', 'reference']) {
    const f = await fixture(t), content = '中'.repeat(50000); if (target === 'script') await f.write(scriptPath, content); else await f.add(3, content, undefined, 'txt');
    const before = await tree(f.root); await assert.rejects(f.inspect(), failure('limit', 413)); assert.deepEqual(await tree(f.root), before);
  }
});
test('reference count relationship kind count and encoded total response limits reject complete results', async t => {
  const count = await fixture(t); for (let n = 0; n < SCRIPT_USAGE_LIMITS.references; n++) await count.add(1000 + n, '# note', undefined, 'md');
  await assert.rejects(count.inspect(), failure('limit', 413));
  const kinds = await fixture(t); await kinds.edit(recordPath(behaviorId), value => { value.relations = Array.from({ length: 33 }, (_, n) => ({ kind: 'reference-' + n, targetId: scriptId })); });
  await assert.rejects(kinds.inspect(), failure('limit', 413));
  const total = await fixture(t); for (let n = 0; n < 16; n++) await total.add(1000 + n, '\n'.repeat(70000), undefined, 'md');
  await assert.rejects(total.inspect(), failure('limit', 413));
});
test('ownership-only and unrelated registries produce an explicitly scoped empty result', async t => {
  const f = await fixture(t); await f.edit(recordPath(behaviorId), value => { value.relations = [{ kind: 'part-of', targetId: scriptId }]; });
  const result = await f.catalog(); assert.deepEqual(result.references, []); assert.deepEqual(result.matches, []); assert.equal(result.scope, 'saved-registered-references');
});

test('invalid duplicate metadata relationships fail the entire observation instead of implying completeness', async t => {
  const f = await fixture(t); await f.edit(recordPath(behaviorId), value => value.relations.push({ kind: 'reference', targetId: scriptId }));
  const before = await tree(f.root); await assert.rejects(f.inspect(), failure('unavailable', 422)); assert.deepEqual(await tree(f.root), before);
});
