import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createSceneCompositionCreateService } from '../lib/scene-composition-create-service.mjs';
import { prepareCompositionDraft, prepareCompositionDraftApply } from '../../engine/scene-composition-create.mjs';
import { getProjectionTemplates, lockProjectionTemplate } from '../../engine/object-projection.mjs';
import { createWorldCommandService } from '../adapters/node-world-commands.mjs';
import { readWorldSnapshot } from '../adapters/node-world-projection.mjs';
import { createDocumentStore } from '../../engine/document-store.mjs';
import { createNodeDocumentStorage } from '../adapters/node-document-storage.mjs';
import { resolveSceneCompositionPreview } from '../../engine/scene-composition-preview.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const coreId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id = n => `${String(n).padStart(8, '0')}-3333-4333-8333-333333333333`;
const json = value => JSON.stringify(value, null, 2) + '\n';
async function fixture(t, version = 3) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-composition-create-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = JSON.parse(await fs.readFile(new URL(`./fixtures/predecessor/v${version}.json`, import.meta.url)));
  const write = async (file, content) => { const absolute = path.join(root, file); await fs.mkdir(path.dirname(absolute), { recursive: true }); await fs.writeFile(absolute, typeof content === 'string' ? content : json(content)); };
  for (const [file, content] of Object.entries(data.files)) await write(file, content);
  const directory = version === 3 ? 'documents' : 'design-data', service = createSceneCompositionCreateService(root);
  const add = async (n, file, content, extra = {}) => {
    const sourcePath = `${directory}/${file}`; await write(sourcePath, content);
    await write(`metadata/documents/${id(n)}.json`, { format: 'viento-document', version: 1, id: id(n), sourcePath,
      documentType: 'character', parserProfile: 'structured', relations: [], assetBindings: [], ...extra });
  };
  return { root, write, add, directory, service, inspect: () => service.inspect() };
}
async function tree(root) { const output = {}; for (const item of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (item.isFile()) {
  const file = path.join(item.parentPath, item.name); output[path.relative(root, file)] = hash(await fs.readFile(file));
} return output; }
const context = cat => ({ sourceToken: 'current:1', documentRoot: cat.documentRoot, documentTypes: cat.documentTypes });
const request = cat => ({ documentType: 'character', sourcePath: `${cat.documentRoot}/recipes/new.json`, title: 'New recipe', fragmentId: 'main', actorKey: 'actor', objectId: coreId,
  useProjectionDefaults: false, position: [120, 180], viewport: [960, 640], background: '#122334', placementId: id(20), instanceId: id(21) });

test('v2 and v3 catalogs use the actual project document root and only return frozen source identities', async t => {
  for (const version of [2, 3]) {
    const f = await fixture(t, version), before = await tree(f.root), cat = await f.inspect();
    assert.equal(cat.documentRoot, f.directory); assert.ok(cat.objects.some(item => item.id === coreId));
    assert.match(cat.worldRevision, /^sha256:[a-f0-9]{64}$/); assert.ok(Object.isFrozen(cat.objects[0]));
    assert.equal(JSON.stringify(cat).includes(f.root), false); assert.equal(Object.hasOwn(cat.objects[0], 'content'), false);
    assert.deepEqual(await tree(f.root), before);
  }
});
test('catalog excludes recipes including partial recipes, missing, unregistered and invalid source while reserving their locations', async t => {
  const f = await fixture(t), cat = await f.inspect(), content = prepareCompositionDraft(context(cat), cat, request(cat)).content;
  await f.add(1, 'valid-recipe.json', content); await f.add(2, 'partial-recipe.json', '{"format":"viento-scene-composition",');
  await f.add(3, 'missing.md', '# Missing'); await fs.unlink(path.join(f.root, f.directory, 'missing.md'));
  await f.add(4, 'invalid.json', '{broken'); await f.write(`${f.directory}/unregistered.md`, '# No descriptor');
  const result = await f.inspect();
  for (const n of [1, 2, 3, 4]) assert.equal(result.objects.some(item => item.id === id(n)), false);
  assert.ok(result.existingPaths.includes(`${f.directory}/unregistered.md`)); assert.ok(result.existingPaths.includes(`${f.directory}/missing.md`));
  assert.equal(result.objects.some(item => item.sourcePath.endsWith('unregistered.md')), false);
});
test('compatible game projections can inherit while literary projections and damaged locks are absent', async t => {
  const f = await fixture(t);
  for (const [n, templateIndex] of [[5, 0], [6, 3]]) {
    const snapshot = getProjectionTemplates()[templateIndex], template = await lockProjectionTemplate(snapshot, { digest: hash });
    const value = { format: 'viento-object-projection', schemaVersion: 1, title: `Projection ${n}`, sourceObjectId: coreId,
      template, configuration: Object.fromEntries(snapshot.fields.map(field => [field.id, field.default])) };
    const cat = await f.inspect();
    await createWorldCommandService(f.root)({ command: 'projection.create', mode: 'apply', worldId: cat.worldId, baseRevision: cat.worldRevision,
      actorRef: { kind: 'tool', id: 'test' }, objectId: id(n), documentType: 'character', sourcePath: `${f.directory}/projection-${n}.json`, content: json(value) });
  }
  let cat = await f.inspect(); assert.equal(cat.objects.find(item => item.id === id(5)).canInheritProjection, true);
  assert.equal(cat.objects.some(item => item.id === id(6)), false);
  const file = `${f.directory}/projection-5.json`, value = JSON.parse(await fs.readFile(path.join(f.root, file), 'utf8'));
  value.template.snapshot.label = 'Changed lock'; await f.write(file, value);
  cat = await f.inspect(); assert.equal(cat.objects.some(item => item.id === id(5)), false);
});
test('catalog refresh changes with author bytes and invalidates an already reviewed draft without writes', async t => {
  const f = await fixture(t), cat = await f.inspect(), proposal = prepareCompositionDraft(context(cat), cat, request(cat));
  const actor = cat.objects.find(item => item.id === coreId); await f.write(actor.sourcePath, '# changed actor');
  const before = await tree(f.root), fresh = await f.inspect(); assert.notEqual(cat.worldRevision, fresh.worldRevision);
  assert.throws(() => prepareCompositionDraftApply(context(cat), fresh, proposal), e => e.errorCode === 'composition_authoring_conflict');
  assert.deepEqual(await tree(f.root), before);
});
test('review and cancellation leave files untouched; ordinary save registers the recipe and existing preview resolves it', async t => {
  const f = await fixture(t), before = await tree(f.root), cat = await f.inspect();
  const proposal = prepareCompositionDraft(context(cat), cat, request(cat)); assert.deepEqual(await tree(f.root), before);
  const prepared = prepareCompositionDraftApply(context(cat), await f.inspect(), proposal);
  const store = createDocumentStore({ editablePrefixes: [`${f.directory}/`], storage: createNodeDocumentStorage({ root: f.root,
    resolvePath: async sourcePath => ({ relativePath: sourcePath, absolutePath: path.join(f.root, sourcePath), exists: false }) }) });
  await store.writeDoc({ path: prepared.sourcePath, content: prepared.content, documentType: prepared.documentType, create: true });
  const observed = await readWorldSnapshot(f.root), record = observed.source.documents.find(item => item.sourcePath === prepared.sourcePath).record;
  assert.ok(record.id); assert.deepEqual(record.relations, []); assert.deepEqual(record.assetBindings, []);
  const preview = await resolveSceneCompositionPreview(observed, record.id, { digest: hash }); assert.equal(preview.ok, true, JSON.stringify(preview.diagnostics));
  assert.equal(preview.model.actors[0].instanceId, id(21)); assert.equal(preview.model.actors[0].objectId, coreId);
  const after = await tree(f.root); for (const [file, digest] of Object.entries(before)) assert.equal(after[file], digest, file);
  assert.deepEqual(Object.keys(after).filter(file => !Object.hasOwn(before, file)).sort(), [`metadata/documents/${record.id}.json`, prepared.sourcePath].sort());
  await assert.rejects(store.writeDoc({ path: prepared.sourcePath, content: 'overwrite', documentType: prepared.documentType, create: true }), e => e.statusCode === 409);
  assert.equal(await fs.readFile(path.join(f.root, prepared.sourcePath), 'utf8'), proposal.content);
});

test('long Unicode author titles are bounded only in display labels without losing the object or rewriting source', async t => {
  const f = await fixture(t), cat = await f.inspect(), actor = cat.objects.find(item => item.id === coreId);
  const content = '# ' + 'a'.repeat(159) + '🎮'.repeat(80) + '\n'; await f.write(actor.sourcePath, content);
  const next = await f.inspect(), label = next.objects.find(item => item.id === coreId).name;
  assert.equal(label, 'a'.repeat(159)); assert.equal(await fs.readFile(path.join(f.root, actor.sourcePath), 'utf8'), content);
});
