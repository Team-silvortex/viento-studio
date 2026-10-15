import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createSceneBehaviorDirectoryService } from '../lib/scene-behavior-directory-service.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { createSceneBehaviorAuthoringService } from '../lib/scene-behavior-authoring-service.mjs';
import { captureSceneBehaviorDirectory, createBehaviorScriptLinkRequest, validateBehaviorScriptLinkResult } from '../../engine/scene-behavior-directory.mjs';
import { workspacePaths } from '../lib/project-layout.mjs';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', manifestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const scriptId = 'ffffffff-ffff-4fff-8fff-ffffffffffff', actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const scenePath = 'documents/scenes/demo.json', manifestPath = 'documents/behaviors/demo.json', scriptPath = 'documents/scripts/checkpoint.txt';
const id = number => `${String(number).padStart(8, '0')}-3333-4333-8333-333333333333`;
const recordPath = objectId => `metadata/documents/${objectId}.json`;
const json = value => JSON.stringify(value, null, 2) + '\n';
const errorKind = (kind, status) => error => error.errorCode === `scene_behavior_directory_${kind}` && (!status || error.statusCode === status);

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-behavior-directory-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(new URL('../../examples/scene-behaviors/', import.meta.url), root, { recursive: true });
  const read = relative => fs.readFile(path.join(root, relative), 'utf8');
  const write = async (relative, value) => {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), typeof value === 'string' || Buffer.isBuffer(value) ? value : json(value));
  };
  const record = async objectId => JSON.parse(await read(recordPath(objectId)));
  const service = createSceneBehaviorDirectoryService(root);
  const add = async (objectId, sourcePath, content = '# inert', kind) => {
    await write(sourcePath, content);
    await write(recordPath(objectId), { format: 'viento-document', version: 1, id: objectId, sourcePath,
      documentType: 'script', parserProfile: 'structured', relations: [], assetBindings: [] });
    if (kind) { const value = await record(manifestId); value.relations.push({ kind, targetId: objectId, slot: '' }); await write(recordPath(manifestId), value); }
  };
  return { root, read, write, record, service, add, inspect: () => service.inspect({ sceneObjectId: sceneId }), execute: createWorldCommandService(root) };
}
async function tree(root) {
  const files = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name);
    files[path.relative(root, file)] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
  }
  return files;
}
const request = (catalog, targetObjectId, mode = 'preview') => ({ command: 'relation.add', mode,
  worldId: catalog.worldId, baseRevision: catalog.baseRevision, objectId: catalog.manifest.objectId,
  objectRevision: catalog.manifest.objectRevision, targetObjectId,
  targetRevision: catalog.sources.find(item => item.objectId === targetObjectId).objectRevision,
  kind: 'references', slot: '', actorRef: { kind: 'user', id: 'behavior-directory-test' } });

test('saved behavior directory is immutable, exact, private and read-only; same script describes every stable binding', async t => {
  const f = await fixture(t), manifest = JSON.parse(await f.read(manifestPath));
  await f.write(scriptPath, '# PRIVATE_SOURCE\nthrow new Error("must never execute");\n');
  for (const binding of manifest.bindings) { binding.implementation.backendId = 'org.example.experimental'; binding.implementation.language = 'native.experimental'; }
  manifest.bindings[1].instanceId = manifest.bindings[0].instanceId;
  await f.write(manifestPath, manifest);
  const before = await tree(f.root), value = await f.inspect();
  assert.deepEqual(Object.keys(value).sort(), ['format', 'schemaVersion', 'status', 'worldId', 'baseRevision', 'documentRoot', 'scene', 'manifest', 'sources'].sort());
  assert.equal(value.format, 'viento-scene-behavior-directory'); assert.equal(value.schemaVersion, 1); assert.equal(value.status, 'ready');
  assert.equal(value.documentRoot, 'documents'); assert.equal(value.scene.objectId, sceneId); assert.equal(value.manifest.objectId, manifestId);
  assert.equal(value.manifest.bindingCount, 2); assert.equal(value.sources.length, 1); assert.equal(value.sources[0].linked, true);
  assert.equal(value.sources[0].name, 'checkpoint.txt'); assert.equal(value.sources[0].objectId, scriptId);
  assert.deepEqual(value.sources[0].usedByBindingIds, manifest.bindings.map(binding => binding.bindingId));
  for (const entry of [value.scene, value.manifest, ...value.sources]) for (const key of ['objectRevision', 'sourceRevision']) assert.match(entry[key], /^sha256:[a-f0-9]{64}$/);
  assert.match(value.baseRevision, /^sha256:[a-f0-9]{64}$/); assert.ok(Object.isFrozen(value.sources[0].usedByBindingIds));
  assert.throws(() => { value.sources[0].linked = false; }, TypeError);
  for (const secret of [f.root, 'PRIVATE_SOURCE', 'must never execute', 'org.example.experimental', 'content', 'parameters']) assert.equal(JSON.stringify(value).includes(secret), false);
  assert.deepEqual(await tree(f.root), before);
});

test('unrelated valid manifests never imply an opt-in; empty directory has no candidates or implicit repairs', async t => {
  const f = await fixture(t), sceneRecord = await f.record(sceneId);
  sceneRecord.relations = sceneRecord.relations.filter(relation => relation.kind !== 'behavior');
  await f.write(recordPath(sceneId), sceneRecord);
  await f.add(id(1), 'documents/scripts/unlinked.txt');
  for (const version of [2, 3]) {
    const scene = JSON.parse(await f.read(scenePath)); scene.schemaVersion = version; if (version === 3) scene.groups = [];
    await f.write(scenePath, scene); const before = await tree(f.root), value = await f.inspect();
    assert.equal(value.status, 'empty'); assert.equal(value.manifest, null); assert.deepEqual(value.sources, []);
    assert.deepEqual(await tree(f.root), before);
  }
});

test('directory captures exact input before await and rejects accessors, prototypes, symbols and revoked proxies', async t => {
  const f = await fixture(t), payload = { sceneObjectId: sceneId }, pending = f.service.inspect(payload);
  payload.sceneObjectId = scriptId; assert.equal((await pending).scene.objectId, sceneId);
  let calls = 0;
  const getter = { get sceneObjectId() { calls++; return sceneId; } }, hidden = {};
  Object.defineProperty(hidden, 'sceneObjectId', { value: sceneId });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const value of [null, [], {}, getter, hidden, revoked.proxy, { sceneObjectId: sceneId, extra: true },
    { sceneObjectId: sceneId, [Symbol('extra')]: true }, Object.create({ sceneObjectId: sceneId }),
    { sceneObjectId: '../scene.json' }, { sceneObjectId: sceneId.toUpperCase() },
    { sceneObjectId: sceneId, toJSON() { calls++; return {}; } }]) await assert.rejects(f.service.inspect(value), errorKind('invalid', 400));
  assert.equal(calls, 0);
  assert.equal((await f.service.inspect(Object.assign(Object.create(null), { sceneObjectId: sceneId }))).status, 'ready');
});

test('missing, non-scene and ambiguous scene inputs fail instead of returning an empty directory', async t => {
  const f = await fixture(t), original = JSON.parse(await f.read(scenePath));
  await assert.rejects(f.service.inspect({ sceneObjectId: id(40) }), errorKind('unavailable', 422));
  await assert.rejects(f.service.inspect({ sceneObjectId: scriptId }), errorKind('invalid', 400));
  for (const mutate of [value => { value.schemaVersion = 1; }, value => { value.actors = []; },
    value => { value.actors[1].instanceId = value.actors[0].instanceId; }, value => { value.actors[0].objectId = id(44); }]) {
    const value = structuredClone(original); mutate(value); await f.write(scenePath, value);
    await assert.rejects(f.inspect(), error => errorKind('invalid')(error) || errorKind('unavailable')(error));
  }
});

test('multiple, dangling, redirected and malformed behavior relations cannot become a ready or empty directory', async t => {
  const f = await fixture(t), originalRecord = await f.record(sceneId), originalManifest = await f.read(manifestPath);
  for (const targetId of [scriptId, id(30), sceneId]) {
    await f.write(recordPath(sceneId), { ...originalRecord, relations: originalRecord.relations.map(relation => relation.kind === 'behavior' ? { ...relation, targetId } : relation) });
    const before = await tree(f.root);
    await assert.rejects(f.inspect(), error => errorKind('invalid')(error) || errorKind('unavailable')(error));
    assert.deepEqual(await tree(f.root), before);
  }
  await f.write(recordPath(sceneId), { ...originalRecord, relations: [...originalRecord.relations, { kind: 'behavior', targetId: scriptId }] });
  await assert.rejects(f.inspect(), errorKind('invalid', 400));
  await f.write(recordPath(sceneId), originalRecord);
  for (const content of ['{}', originalManifest.replace('"schemaVersion": 1', '"schemaVersion": 1,"schemaVersion": 1'),
    originalManifest.replace(sceneId, id(31)), originalManifest.replace('"schemaVersion": 1', '"schemaVersion": 99')]) {
    await f.write(manifestPath, content); await assert.rejects(f.inspect(), errorKind('invalid', 400));
  }
  await f.write(manifestPath, originalManifest); await fs.unlink(path.join(f.root, manifestPath));
  await assert.rejects(f.inspect(), errorKind('unavailable', 422));
});

test('manifest scene/source references and all scene definitions must stay available and nonownership linked', async t => {
  const f = await fixture(t), manifestRecord = await f.record(manifestId), sceneRecord = await f.record(sceneId);
  for (const targetId of [sceneId, scriptId]) {
    await f.write(recordPath(manifestId), { ...manifestRecord, relations: manifestRecord.relations.map(relation => relation.targetId === targetId ? { ...relation, kind: 'part-of' } : relation) });
    await assert.rejects(f.inspect(), errorKind('invalid', 400));
  }
  await f.write(recordPath(manifestId), manifestRecord);
  await f.write(recordPath(sceneId), { ...sceneRecord, relations: sceneRecord.relations.map(relation => relation.targetId === actorId ? { ...relation, kind: 'part-of' } : relation) });
  await assert.rejects(f.inspect(), errorKind('invalid', 400)); await f.write(recordPath(sceneId), sceneRecord);
  const manifest = JSON.parse(await f.read(manifestPath)); manifest.bindings = [manifest.bindings[0]]; await f.write(manifestPath, manifest);
  const scene = JSON.parse(await f.read(scenePath)); scene.actors[1].objectId = id(2); await f.write(scenePath, scene);
  await assert.rejects(f.inspect(), errorKind('unavailable', 422));
  await f.add(id(2), 'documents/scripts/second-definition.txt');
  await assert.rejects(f.inspect(), errorKind('invalid', 400));
  sceneRecord.relations.push({ kind: 'references', targetId: id(2) }); await f.write(recordPath(sceneId), sceneRecord);
  assert.equal((await f.inspect()).manifest.bindingCount, 1);
  await fs.unlink(path.join(f.root, scriptPath)); await assert.rejects(f.inspect(), errorKind('unavailable', 422));
});

test('candidates retain explicit reference compatibility, identity, stable path order and independent used/linked states', async t => {
  const f = await fixture(t);
  await f.add(id(1), 'documents/scripts/z-unused.TXT', '# z', 'references');
  await f.add(id(2), 'documents/scripts/a-unlinked.txt', '# a');
  await f.add(id(3), 'documents/scripts/b-owned.txt', '# b', 'part-of');
  await f.add(id(4), 'documents/scripts/notes.md', '# notes', 'references');
  await f.add(id(5), 'documents/scripts/missing.txt', '# missing'); await fs.unlink(path.join(f.root, 'documents/scripts/missing.txt'));
  await f.write('documents/scripts/unregistered.txt', '# hidden');
  const record = await f.record(manifestId); record.relations.push({ kind: 'references', targetId: scriptId }); await f.write(recordPath(manifestId), record);
  const value = await f.inspect();
  assert.deepEqual(value.sources.map(source => source.objectId), [id(2), id(3), scriptId, id(1)]);
  assert.deepEqual(value.sources.map(source => source.linked), [false, false, true, true]);
  assert.deepEqual(value.sources.map(source => source.usedByBindingIds.length), [0, 0, 2, 0]);
});

test('TXT byte bounds include Unicode; unsafe unused candidates are omitted and linked overflow blocks', async t => {
  const f = await fixture(t), exact = '中'.repeat(21845) + 'x'; assert.equal(Buffer.byteLength(exact), 65536);
  await f.add(id(1), 'documents/scripts/exact.txt', exact);
  await f.add(id(2), 'documents/scripts/overflow.txt', exact + 'x');
  assert.ok((await f.inspect()).sources.some(source => source.objectId === id(1)));
  assert.ok(!(await f.inspect()).sources.some(source => source.objectId === id(2)));
  const record = await f.record(manifestId); record.relations.push({ kind: 'references', targetId: id(2) }); await f.write(recordPath(manifestId), record);
  await assert.rejects(f.inspect(), errorKind('limit', 413));
  record.relations.pop(); await f.write(recordPath(manifestId), record); await f.write(scriptPath, exact + 'x');
  await assert.rejects(f.inspect(), errorKind('limit', 413));
});

test('malformed UTF-8, oversized manifests, unsafe paths and active recovery never produce actionable catalogs', async t => {
  const f = await fixture(t), original = await f.read(scriptPath);
  await f.write(scriptPath, Buffer.from([0xc3, 0x28])); await assert.rejects(f.inspect(), errorKind('unavailable', 422));
  await f.write(scriptPath, original);
  const manifest = await f.read(manifestPath); await f.write(manifestPath, manifest + ' '.repeat(32768));
  await assert.rejects(f.inspect(), errorKind('limit', 413)); await f.write(manifestPath, manifest);
  await fs.unlink(path.join(f.root, scriptPath)); await fs.symlink(path.join(f.root, manifestPath), path.join(f.root, scriptPath));
  await assert.rejects(f.inspect(), errorKind('unavailable', 422)); await fs.unlink(path.join(f.root, scriptPath)); await f.write(scriptPath, original);
  await fs.mkdir(path.join(f.root, '.viento/world-transactions/active'), { recursive: true });
  const before = await tree(f.root); await assert.rejects(f.inspect(), errorKind('conflict', 409)); assert.deepEqual(await tree(f.root), before);
});

test('candidate limit is 256 independently of eight used scripts and never silently truncates', async t => {
  const f = await fixture(t);
  for (let number = 1; number <= 255; number++) await f.add(id(number), `documents/scripts/candidate-${number}.txt`);
  assert.equal((await f.inspect()).sources.length, 256); await f.add(id(256), 'documents/scripts/candidate-256.txt');
  await assert.rejects(f.inspect(), errorKind('limit', 413));
});

test('one observed world pins catalog bytes and a mid-read source change maps to a conflict', async t => {
  const f = await fixture(t), originalRead = fs.readFile, scriptFile = path.join(f.root, scriptPath); let count = 0, change = false;
  const mocked = t.mock.method(fs, 'readFile', async function(file, ...args) {
    const value = await originalRead.call(fs, file, ...args);
    if (String(file) === scriptFile) { count++; if (change && count === 1) await fs.writeFile(scriptFile, '# external source changed'); }
    return value;
  });
  assert.equal((await f.inspect()).status, 'ready'); assert.equal(count, 2, 'only one snapshot, including its second consistency read');
  count = 0; change = true; await assert.rejects(f.inspect(), errorKind('conflict', 409)); mocked.mock.restore();
});

test('directory drives existing relation preview/apply and authoring refresh with exact source and metadata preservation', async t => {
  const f = await fixture(t); await f.add(id(1), 'documents/scripts/new-script.txt', '\uFEFF# 别动这个脚本\r\nprint("private")\r\n');
  const original = (await f.read(recordPath(manifestId))).replace('"relations": [', '"extension": {"n":9007199254740993,"m":1.2300e+4},\n  "relations": [').replaceAll('\n', '\r\n');
  await f.write(recordPath(manifestId), original);
  const value = await f.inspect(), input = request(value, id(1)), before = await tree(f.root);
  assert.equal(value.sources.find(source => source.objectId === id(1)).linked, false);
  const preview = await f.execute(input); assert.equal(preview.status, 'preview'); assert.deepEqual(await tree(f.root), before);
  const applied = await f.execute({ ...input, mode: 'apply' }); assert.equal(applied.revision, preview.revision);
  const next = await f.inspect(); assert.notEqual(next.baseRevision, value.baseRevision); assert.notEqual(next.manifest.objectRevision, value.manifest.objectRevision);
  assert.equal(next.manifest.sourceRevision, value.manifest.sourceRevision);
  const added = next.sources.find(source => source.objectId === id(1)); assert.equal(added.linked, true); assert.deepEqual(added.usedByBindingIds, []);
  const after = await tree(f.root); delete after['.viento/world-transactions/head.json']; delete after[recordPath(manifestId)]; delete before[recordPath(manifestId)]; assert.deepEqual(after, before);
  assert.equal((await f.read(recordPath(manifestId))).replace(', ' + JSON.stringify({ kind: 'references', targetId: id(1), slot: '' }), ''), original);
  const editor = await createSceneBehaviorAuthoringService(f.root).inspect({ sourcePath: manifestPath, content: await f.read(manifestPath) });
  assert.ok(editor.sources.some(source => source.objectId === id(1)));
  await assert.rejects(f.execute({ ...input, mode: 'apply' }), { errorCode: 'world_revision_conflict' });
  await assert.rejects(f.execute(request(next, id(1))), { errorCode: 'world_relation_exists' });
});

test('changed script or scene invalidates directory-derived relation requests without rewriting author data', async t => {
  const f = await fixture(t); await f.add(id(1), 'documents/scripts/new-script.txt');
  for (const changedPath of ['documents/scripts/new-script.txt', scenePath]) {
    const catalog = await f.inspect(), input = request(catalog, id(1)); await f.execute(input);
    await f.write(changedPath, (await f.read(changedPath)) + '\n'); const before = await tree(f.root);
    await assert.rejects(f.execute({ ...input, mode: 'apply' }), { errorCode: 'world_revision_conflict' }); assert.deepEqual(await tree(f.root), before);
    assert.notEqual((await f.inspect()).baseRevision, catalog.baseRevision);
  }
});

const sourceAtLength = (length, extension = '.txt') => {
  const prefix = `documents/${Array(4).fill('d'.repeat(200)).join('/')}/`;
  return prefix + 'n'.repeat(length - prefix.length - extension.length) + extension;
};
async function relocate(f, objectId, sourcePath) {
  const record = await f.record(objectId), content = await f.read(record.sourcePath);
  await f.write(sourcePath, content); await fs.unlink(path.join(f.root, record.sourcePath));
  await f.write(recordPath(objectId), { ...record, sourcePath });
}

test('unlinked hidden reserved-directory and overlong legacy candidates are omitted while every returned name and path passes the shared contract', async t => {
  const f = await fixture(t), unsupported = ['documents/scripts/.legacy.txt', 'documents/node_modules/legacy.txt', sourceAtLength(1025)];
  for (const [index, sourcePath] of unsupported.entries()) await f.add(id(index + 1), sourcePath);
  const exactPath = sourceAtLength(1024), unicodeName = 'a'.repeat(159) + '😀.txt';
  await f.add(id(10), exactPath); await f.add(id(11), `documents/scripts/${unicodeName}`);
  const before = await tree(f.root), value = await f.inspect();
  assert.deepEqual(captureSceneBehaviorDirectory(value, sceneId), value);
  assert.deepEqual(new Set(value.sources.map(source => source.objectId)), new Set([scriptId, id(10), id(11)]));
  assert.equal(value.sources.find(source => source.objectId === id(10)).sourcePath.length, 1024);
  assert.equal(value.sources.find(source => source.objectId === id(11)).name, 'a'.repeat(159), 'A truncated label never ends with half a surrogate pair');
  assert.deepEqual(await tree(f.root), before, 'Unsupported legacy files remain untouched');
});

test('linked unused scripts with unsupported paths fail explicitly instead of silently removing an existing dependency', async t => {
  for (const [index, sourcePath] of ['documents/scripts/.legacy.txt', 'documents/node_modules/legacy.txt', sourceAtLength(1025)].entries()) {
    const f = await fixture(t); await f.add(id(index + 1), sourcePath, '# preserved source', index === 1 ? 'reference' : 'references');
    const before = await tree(f.root);
    await assert.rejects(f.inspect(), error => errorKind('invalid', 400)(error)
      && error.payload.diagnostics.some(item => item.code === 'build_behavior_source_invalid' && item.relatedObjectId === id(index + 1)));
    assert.deepEqual(await tree(f.root), before);
  }
});

test('used scripts with unsupported paths and unavailable linked candidates never produce an incomplete ready catalog', async t => {
  const f = await fixture(t); await relocate(f, scriptId, 'documents/scripts/.used.txt');
  const before = await tree(f.root);
  await assert.rejects(f.inspect(), error => errorKind('invalid', 400)(error)
    && error.payload.diagnostics.some(item => item.relatedObjectId === scriptId));
  assert.deepEqual(await tree(f.root), before);
  const g = await fixture(t); await g.add(id(1), 'documents/scripts/missing-linked.txt', '# preserve registration', 'references');
  await fs.unlink(path.join(g.root, 'documents/scripts/missing-linked.txt'));
  const missingBefore = await tree(g.root);
  await assert.rejects(g.inspect(), error => errorKind('unavailable', 422)(error)
    && error.payload.diagnostics.some(item => item.code === 'build_behavior_dependency_unavailable' && item.relatedObjectId === id(1)));
  assert.deepEqual(await tree(g.root), missingBefore);
});

test('unsupported scene and manifest paths are explicit errors for both ready and empty behavior directories', async t => {
  for (const [objectId, sourcePath, empty] of [[sceneId, 'documents/scenes/.legacy.json', false],
    [sceneId, sourceAtLength(1025, '.json'), true], [manifestId, 'documents/node_modules/behavior.json', false],
    [manifestId, sourceAtLength(1025, '.json'), false]]) {
    const f = await fixture(t); await relocate(f, objectId, sourcePath);
    if (empty) { const record = await f.record(sceneId); record.relations = record.relations.filter(item => item.kind !== 'behavior'); await f.write(recordPath(sceneId), record); }
    const before = await tree(f.root);
    await assert.rejects(f.inspect(), error => errorKind('invalid', 400)(error)
      && error.payload.diagnostics.some(item => item.relatedObjectId === objectId));
    assert.deepEqual(await tree(f.root), before);
  }
});

test('v2 document roots produce exact shared-contract directories without exposing local workspace paths', async t => {
  const f = await fixture(t), workspace = JSON.parse(await f.read('workspace.json')), paths = workspacePaths({ version: 2 });
  workspace.version = 2; workspace.paths = paths; await f.write('workspace.json', workspace);
  await fs.rename(path.join(f.root, 'documents'), path.join(f.root, paths.documents));
  await fs.rename(path.join(f.root, 'templates'), path.join(f.root, paths.templates));
  for (const filename of await fs.readdir(path.join(f.root, 'metadata/documents'))) {
    const relative = `metadata/documents/${filename}`, record = JSON.parse(await f.read(relative));
    record.sourcePath = record.sourcePath.replace('documents/', paths.documents + '/'); await f.write(relative, record);
  }
  const before = await tree(f.root), value = await f.inspect();
  assert.equal(value.documentRoot, 'design-data'); assert.deepEqual(captureSceneBehaviorDirectory(value, sceneId), value);
  for (const item of [value.scene, value.manifest, ...value.sources]) assert.ok(item.sourcePath.startsWith('design-data/'));
  assert.equal(JSON.stringify(value).includes(f.root), false); assert.deepEqual(await tree(f.root), before);
});

test('unsupported document roots fail through the workspace boundary without returning an actionable directory', async t => {
  const f = await fixture(t), original = JSON.parse(await f.read('workspace.json'));
  for (const documents of ['../documents', 'documents/.hidden', 'd'.repeat(901)]) {
    await f.write('workspace.json', { ...original, paths: { ...original.paths, documents } });
    const before = await tree(f.root); await assert.rejects(f.inspect(), errorKind('unavailable', 422));
    assert.deepEqual(await tree(f.root), before);
  }
});

test('omitting unrelated legacy candidates preserves the real shared-request relation workflow and authoring refresh', async t => {
  const f = await fixture(t); await f.add(id(1), 'documents/scripts/.unrelated.txt'); await f.add(id(2), 'documents/scripts/usable.txt');
  const catalog = captureSceneBehaviorDirectory(await f.inspect(), sceneId), before = await tree(f.root);
  const previewRequest = createBehaviorScriptLinkRequest(catalog, id(2));
  const preview = validateBehaviorScriptLinkResult(await f.execute(previewRequest), previewRequest, catalog);
  assert.deepEqual(await tree(f.root), before);
  const applyRequest = createBehaviorScriptLinkRequest(catalog, id(2), 'apply');
  const result = validateBehaviorScriptLinkResult(await f.execute(applyRequest), applyRequest, catalog);
  assert.equal(result.revision, preview.revision); assert.equal(result.receipt.state, 'committed');
  const next = captureSceneBehaviorDirectory(await f.inspect(), sceneId);
  assert.equal(next.sources.find(source => source.objectId === id(2)).linked, true);
  assert.equal(next.sources.some(source => source.objectId === id(1)), false);
  const after = await tree(f.root); delete after['.viento/world-transactions/head.json']; delete after[recordPath(manifestId)]; delete before[recordPath(manifestId)];
  assert.deepEqual(after, before, 'Only the intended manifest registration changes');
  const editor = await createSceneBehaviorAuthoringService(f.root).inspect({ sourcePath: manifestPath, content: await f.read(manifestPath) });
  assert.ok(editor.sources.some(source => source.objectId === id(2)));
});
