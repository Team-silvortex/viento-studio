import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createProjectAssemblyDocumentService } from '../lib/project-assembly-documents.mjs';
import { audioFixture, fingerprint, sceneId, json } from './helpers/world-audio-create-fixture.mjs';
const content = (title = '旅程 · Journey') => '\uFEFF' + json({ format: 'viento-project-assembly', schemaVersion: 1, title, entrySceneId: sceneId, sceneIds: [sceneId] }).replaceAll('\n', '\r\n');
async function draft(service, sourcePath = 'documents/projects/game.json') {
  const catalog = await service.list();
  return { worldId: catalog.worldId, baseRevision: catalog.baseRevision, sourcePath, documentType: catalog.defaults.documentType, content: content() };
}
for (const version of [2, 3]) test(`assembly author v${version} list/load/create/update uses normal JSON and registered identity without extra references`, async t => {
  const f = await audioFixture(t, version), written = [], service = createProjectAssemblyDocumentService(f.root, { onWrite: file => written.push(file) });
  const before = await fingerprint(f.root), list = await service.list(); assert.equal(list.scenes.length, 1); assert.deepEqual(await fingerprint(f.root), before);
  const input = await draft(service, `${f.documents}/projects/game.json`), saved = await service.save(input);
  assert.equal(saved.content, input.content); assert.equal(saved.valid, true); assert.equal(saved.documentType, input.documentType); assert.equal(written.length, 1);
  const record = JSON.parse(await fs.readFile(path.join(f.root, `metadata/documents/${saved.id}.json`))); assert.deepEqual(record.relations, []); assert.deepEqual(record.assetBindings, []);
  const loaded = await service.load(saved.id); assert.deepEqual(loaded, saved);
  const updated = await service.save({ action: 'assembly-save', worldId: saved.worldId, baseRevision: saved.baseRevision, documentId: saved.id, expectedVersion: saved.version, content: content('Updated') });
  assert.equal(updated.id, saved.id); assert.notEqual(updated.version, saved.version); assert.equal((await service.list()).documents[0].title, 'Updated');
  for (const [file, value] of Object.entries(before)) assert.equal((await fingerprint(f.root))[file], value, file);
});
test('assembly request captures scalars before await, rejects accessors/force/aliases, and preserves invalid source bytes', async t => {
  const f = await audioFixture(t), service = createProjectAssemblyDocumentService(f.root), input = await draft(service), pending = service.save(input); input.content = '{}';
  const saved = await pending; assert.equal(saved.content, content());
  let reads = 0; const getter = { ...await draft(service) }; Object.defineProperty(getter, 'content', { enumerable: true, get() { reads++; return content(); } });
  for (const bad of [getter, { ...await draft(service), force: true }, { ...await draft(service), content: '{}' }, { ...await draft(service), expectedVersion: saved.version }, { ...await draft(service), sourcePath: 'documents/../bad.json' }]) await assert.rejects(service.save(bad));
  assert.equal(reads, 0); assert.equal((await service.load(saved.id)).content, content());
});
test('author-world or original-source changes reject stale saves without overwriting author changes', async t => {
  const f = await audioFixture(t), service = createProjectAssemblyDocumentService(f.root), input = await draft(service);
  await fs.appendFile(path.join(f.root, f.scenePath), '\n'); await assert.rejects(service.save(input), { errorCode: 'project_assembly_document_conflict' });
  const saved = await service.save(await draft(service));
  await fs.writeFile(path.join(f.root, saved.path), content('External author'));
  const fresh = await service.list(); await assert.rejects(service.save({ worldId: fresh.worldId, baseRevision: fresh.baseRevision, documentId: saved.id, expectedVersion: saved.version, content: content('Mine') }), { errorCode: 'project_assembly_document_conflict' });
  assert.equal(await fs.readFile(path.join(f.root, saved.path), 'utf8'), content('External author'));
});
test('member changes at final publication prevent creation and remove only the provisional registration', async t => {
  const f = await audioFixture(t), before = await fingerprint(f.root), service = createProjectAssemblyDocumentService(f.root, { beforePublish: () => fs.appendFile(path.join(f.root, f.scenePath), '\nexternal\n') });
  await assert.rejects(service.save(await draft(service)), { errorCode: 'project_assembly_document_conflict' });
  await assert.rejects(fs.stat(path.join(f.root, 'documents/projects/game.json')), { code: 'ENOENT' });
  const after = await fingerprint(f.root); assert.deepEqual(Object.keys(after), Object.keys(before));
  for (const file of Object.keys(before)) if (file !== f.scenePath) assert.equal(after[file], before[file], file);
});
test('missing and non-scene members, duplicate membership, occupied paths and symlink destinations do not write', async t => {
  const f = await audioFixture(t), service = createProjectAssemblyDocumentService(f.root), input = await draft(service), declaration = JSON.parse(content().slice(1));
  for (const value of [{ ...declaration, sceneIds: [sceneId, sceneId] }, { ...declaration, entrySceneId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sceneIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] }, { ...declaration, sceneIds: [] }]) await assert.rejects(service.save({ ...input, content: json(value) }));
  await fs.mkdir(path.join(f.root, 'documents/projects'), { recursive: true }); await fs.writeFile(path.join(f.root, input.sourcePath), 'foreign');
  await assert.rejects(service.save(input)); assert.equal(await fs.readFile(path.join(f.root, input.sourcePath), 'utf8'), 'foreign');
  const linkInput = await draft(service); await fs.symlink(path.join(f.root, 'documents/projects'), path.join(f.root, 'documents/link'));
  await assert.rejects(service.save({ ...linkInput, sourcePath: 'documents/link/new.json' }));
});
test('parallel first saves cannot overwrite or register a second identity at the same path', async t => {
  const f = await audioFixture(t), service = createProjectAssemblyDocumentService(f.root), input = await draft(service), results = await Promise.allSettled([service.save(input), service.save(input)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal((await service.list()).documents.length, 1);
});
test('malformed existing assembly is discoverable for source repair while invalid saves remain blocked', async t => {
  const f = await audioFixture(t), service = createProjectAssemblyDocumentService(f.root), saved = await service.save(await draft(service));
  const malformed = '{"format":"viento-project-assembly","title":"broken",'; await fs.writeFile(path.join(f.root, saved.path), malformed);
  assert.equal((await service.list()).documents[0].valid, false); const loaded = await service.load(saved.id); assert.equal(loaded.content, malformed); assert.equal(loaded.definition, null);
});
