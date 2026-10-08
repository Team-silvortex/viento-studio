import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRuntimeCaseDocumentService } from '../lib/runtime-case-documents.mjs';
import { fixture, inventory, sceneId, runtimeCase, unknown, service, builtService, settled, build, backendId, fakeTool } from './runtime-case-fixture.mjs';
import { runProjectBuild } from '../adapters/node-project-build.mjs';
import { runProjectBuildCommand } from '../project-build.mjs';

const envelope = () => ({ format: 'viento-runtime-case-document', schemaVersion: 1, sceneObjectId: sceneId, case: runtimeCase() });
const raw = () => '\uFEFF' + JSON.stringify(envelope(), null, '\t').replaceAll('\n', '\r\n') + '\r\n';
async function create(value, sourcePath = 'documents/runtime-cases/中文验收.json', content = raw()) {
  const catalog = await value.list(sceneId);
  return value.save({ sceneId, sceneVersion: catalog.sceneVersion, sourcePath, documentType: catalog.defaults.documentType, content });
}

test('case author save atomically registers, preserves exact BOM/CRLF source and reloads stable identity', async t => {
  const h = await fixture(t), before = await inventory(h.root), value = createRuntimeCaseDocumentService(h.root);
  const saved = await create(value), loaded = await value.load(saved.id), catalog = await value.list(sceneId);
  assert.equal(saved.valid, true); assert.deepEqual(loaded, saved); assert.equal(loaded.content, raw());
  assert.deepEqual(loaded.definition, runtimeCase()); assert.equal(catalog.documents[0].id, saved.id);
  assert.equal(await fs.readFile(path.join(h.root, saved.path), 'utf8'), raw());
  const after = await inventory(h.root); for (const [file, hash] of Object.entries(before)) assert.equal(after[file], hash, file);
  assert.deepEqual(Object.keys(after).filter(file => !(file in before)).sort(), [saved.path, `metadata/documents/${saved.id}.json`].sort());
  const record = JSON.parse(await fs.readFile(path.join(h.root, `metadata/documents/${saved.id}.json`)));
  assert.equal(record.id, saved.id); assert.deepEqual(record.relations, []);
});

test('case updates use source revisions and never force-overwrite an external author edit', async t => {
  const h = await fixture(t), value = createRuntimeCaseDocumentService(h.root), saved = await create(value);
  const input = { sceneId, sceneVersion: saved.sceneVersion, documentId: saved.id, expectedVersion: saved.version, content: raw() };
  const changed = envelope(); changed.case.checks[0].position.value[0] = -100;
  const content = JSON.stringify(changed) + '\n'; await fs.writeFile(path.join(h.root, saved.path), content);
  await assert.rejects(value.save(input), error => error.statusCode === 409);
  assert.equal((await value.load(saved.id)).content, content);
  const fresh = await value.load(saved.id), next = await value.save({ ...input, expectedVersion: fresh.version });
  assert.equal(next.id, saved.id); assert.equal(next.content, raw()); assert.equal(next.version, saved.version);
});

test('unknown instances, wrong scene binding, invalid types and locations leave no author source or metadata', async t => {
  const h = await fixture(t), value = createRuntimeCaseDocumentService(h.root), before = await inventory(h.root), catalog = await value.list(sceneId);
  const stale = envelope(); stale.case.checks[0].instanceId = unknown;
  const base = { sceneId, sceneVersion: catalog.sceneVersion, sourcePath: 'documents/case.json', documentType: catalog.defaults.documentType, content: raw() };
  for (const patch of [{ content: JSON.stringify(stale) }, { sceneId: unknown }, { documentType: 'absent-type' },
    { sourcePath: 'documents/../outside.json' }, { sourcePath: 'documents/case.txt' }, { sourcePath: 'metadata/case.json' },
    { content: JSON.stringify({ ...envelope(), result: { status: 'passed' } }) }]) await assert.rejects(value.save({ ...base, ...patch }));
  assert.deepEqual(await inventory(h.root), before);
});

test('saving refuses a changed author scene, while catalog retains an externally damaged case for repair', async t => {
  const h = await fixture(t), value = createRuntimeCaseDocumentService(h.root), saved = await create(value);
  const scene = JSON.parse(await fs.readFile(h.file)); scene.actors[0].position[0] += 1; await fs.writeFile(h.file, JSON.stringify(scene));
  await assert.rejects(value.save({ sceneId, sceneVersion: saved.sceneVersion, documentId: saved.id, expectedVersion: saved.version, content: raw() }),
    error => error.errorCode === 'runtime_case_scene_conflict');
  const stale = envelope(); stale.case.checks[0].instanceId = unknown; const content = JSON.stringify(stale);
  await fs.writeFile(path.join(h.root, saved.path), content);
  const loaded = await value.load(saved.id); assert.equal(loaded.valid, false); assert.equal(loaded.content, content);
  assert.equal((await value.list(sceneId)).documents[0].valid, false);
});

test('an external scene edit during publication rolls back only the new registration and temporary source', async t => {
  const h = await fixture(t), before = await inventory(h.root);
  const value = createRuntimeCaseDocumentService(h.root, { async beforePublish() {
    const scene = JSON.parse(await fs.readFile(h.file)); scene.title += ' externally changed'; await fs.writeFile(h.file, JSON.stringify(scene));
  } });
  await assert.rejects(create(value), error => error.errorCode === 'runtime_case_scene_conflict');
  const after = await inventory(h.root); assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const [file, hash] of Object.entries(before)) if (file !== 'documents/scenes/demo.json') assert.equal(after[file], hash, file);
});

test('an external case edit during publication is preserved rather than renamed over', async t => {
  const h = await fixture(t), saved = await create(createRuntimeCaseDocumentService(h.root));
  const changed = raw() + ' '; const value = createRuntimeCaseDocumentService(h.root, { beforePublish: () => fs.writeFile(path.join(h.root, saved.path), changed) });
  await assert.rejects(value.save({ sceneId, sceneVersion: saved.sceneVersion, documentId: saved.id, expectedVersion: saved.version, content: raw() }),
    error => error.errorCode === 'runtime_case_document_conflict');
  assert.equal(await fs.readFile(path.join(h.root, saved.path), 'utf8'), changed);
  assert.ok(!(await fs.readdir(path.dirname(path.join(h.root, saved.path)))).some(name => name.endsWith('.tmp')));
});

test('registered author cases are fresh reads, and loaded pure cases still run on owned frozen builds offline', async t => {
  const h = await fixture(t), value = service(t, h), catalog = await value.command({ action: 'case-list', sceneId });
  const saved = await value.command({ action: 'case-save', sceneId, sceneVersion: catalog.sceneVersion, sourcePath: 'documents/case.json', documentType: catalog.defaults.documentType, content: raw() });
  const loaded = await value.command({ action: 'case-load', documentId: saved.id }), built = await builtService(value);
  await assert.rejects(value.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless', runtimeCase: loaded.definition, runtimeCaseSceneId: unknown }),
    error => error.errorCode === 'runtime_case_scene_mismatch');
  assert.equal((await value.status()).job.id, built.job.id);
  await fs.rename(h.root, h.root + '-offline');
  await assert.rejects(value.command({ action: 'case-load', documentId: saved.id }));
  await assert.rejects(value.command({ action: 'case-list', sceneId }));
  await value.command({ action: 'run', buildId: built.latestBuild.id, mode: 'headless', runtimeCase: loaded.definition, runtimeCaseSceneId: loaded.sceneId });
  assert.equal((await settled(value)).job.verification.evaluation.status, 'passed');
  await fs.rename(h.root + '-offline', h.root);
});

test('shared host refuses a persisted case for another scene before sessions or tool identification', async t => {
  const h = await fixture(t), backendRegistry = await build(h), before = await inventory(h.output);
  const result = await runProjectBuild({ buildDirectory: h.output, tool: fakeTool.executable, backendId, backendRegistry,
    runtimeCase: runtimeCase(), runtimeCaseSceneId: unknown });
  assert.equal(result.ok, false); assert.equal(result.diagnostics[0].code, 'runtime_case_scene_mismatch');
  assert.deepEqual(await inventory(h.output), before);
});

test('CLI recognizes saved wrapper constraints before reading a nonexistent frozen build', async t => {
  const h = await fixture(t), file = path.join(h.base, 'case.json');
  await fs.writeFile(file, JSON.stringify({ ...envelope(), hostPath: '/tmp/untrusted' }));
  await assert.rejects(runProjectBuildCommand(['--command', 'run', '--build', path.join(h.base, 'absent'), '--runtime-case', file]),
    error => error.errorCode === 'runtime_case_document_invalid');
  await fs.writeFile(file, raw());
  const result = await runProjectBuildCommand(['--command', 'run', '--build', path.join(h.base, 'absent'), '--runtime-case', file]);
  assert.equal(result.ok, false); assert.notEqual(result.diagnostics[0].code, 'runtime_case_invalid');
});
