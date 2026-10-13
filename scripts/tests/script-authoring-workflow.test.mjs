import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { serve, request } from './helpers.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { listScriptStarters } from '../../engine/script-authoring.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const oldBehaviorId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const oldScriptId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const content = '\uFEFF' + listScriptStarters().find(starter => starter.id === 'godot-signal').content.replaceAll('\n', '\r\n');

async function authorTree(root, documents, templates) {
  const hashes = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath || entry.path, entry.name), relative = path.relative(root, absolute);
    if (relative === 'workspace.json' || [documents, templates, 'metadata', 'assets'].some(folder => relative.startsWith(folder + '/'))) {
      hashes[relative] = createHash('sha256').update(await fs.readFile(absolute)).digest('hex');
    }
  }
  return hashes;
}

async function fixture(t, version) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-script-authoring-workflow-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(appRoot, 'examples/scene-behaviors'), root, { recursive: true });
  for (const relative of ['documents/behaviors/demo.json', 'documents/scripts/checkpoint.txt',
    `metadata/documents/${oldBehaviorId}.json`, `metadata/documents/${oldScriptId}.json`]) await fs.rm(path.join(root, relative));
  const sceneMetadata = path.join(root, `metadata/documents/${sceneId}.json`);
  const scene = JSON.parse(await fs.readFile(sceneMetadata, 'utf8'));
  scene.relations = scene.relations.filter(relation => relation.kind !== 'behavior');
  await fs.writeFile(sceneMetadata, JSON.stringify(scene, null, 2).replaceAll('\n', '\r\n') + '\r\n');
  const documents = version === 2 ? 'design-data' : 'documents', templates = version === 2 ? 'data-template' : 'templates';
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'workspace.json'), 'utf8'));
  manifest.version = version;
  manifest.paths = { documents, templates, metadata: 'metadata' };
  // Keep the ordinary configured types and templates; a dedicated script type
  // is deliberately absent so discovery cannot accidentally depend on it.
  manifest.documentTypes = manifest.documentTypes.filter(type => type.id !== 'script');
  await fs.writeFile(path.join(root, 'workspace.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (version === 2) {
    await fs.rename(path.join(root, 'documents'), path.join(root, documents));
    await fs.rename(path.join(root, 'templates'), path.join(root, templates));
    for (const file of await fs.readdir(path.join(root, 'metadata/documents'))) {
      const absolute = path.join(root, 'metadata/documents', file);
      const record = JSON.parse(await fs.readFile(absolute, 'utf8'));
      record.sourcePath = record.sourcePath.replace(/^documents\//, documents + '/');
      await fs.writeFile(absolute, JSON.stringify(record, null, 2) + '\n');
    }
  }
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root });
  return { root, base, documents, templates, tree: () => authorTree(root, documents, templates),
    catalog: () => request(base, '/api/scene-behavior-creation', { sceneObjectId: sceneId }) };
}

for (const version of [2, 3]) {
  test(`script workflow v${version}: ordinary TXT creation registers any configured type and immediately appears in first-behavior sources`, async t => {
    const f = await fixture(t, version), before = await f.tree(), previousRegistry = await readRegistry(f.root);
    const empty = await f.catalog();
    assert.equal(empty.status, 200);
    assert.equal(empty.data.documentRoot, f.documents);
    assert.equal(empty.data.documentTypes.some(type => type.id === 'script'), false);
    assert.deepEqual(empty.data.sources, []);
    assert.deepEqual(await f.tree(), before, 'listing sources is read-only');

    const sourcePath = `${f.documents}/scripts/新建 Signal.txt`;
    const saved = await request(f.base, '/api/doc', { path: sourcePath, content, create: true, documentType: 'character' });
    assert.equal(saved.status, 200, JSON.stringify(saved));
    assert.equal(saved.data.path, sourcePath);
    assert.match(saved.data.version, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(await fs.readFile(path.join(f.root, sourcePath)), Buffer.from(content), 'Save retains exact TXT source bytes');
    const registry = await readRegistry(f.root), record = registry.documents.find(item => item.sourcePath === sourcePath);
    assert.ok(record, 'ordinary Save must publish a registered source');
    assert.equal(record.documentType, 'character');
    assert.equal(record.parserProfile, 'structured');
    assert.deepEqual(record.relations, []);
    assert.deepEqual(registry.documents.filter(item => item.id !== record.id), previousRegistry.documents);
    assert.deepEqual(registry.assets, previousRegistry.assets);
    const after = await f.tree();
    assert.deepEqual(Object.keys(after).filter(name => after[name] !== before[name]).sort(),
      [sourcePath, `metadata/documents/${record.id}.json`].sort());
    for (const [name, hash] of Object.entries(before)) assert.equal(after[name], hash, `Existing author bytes changed: ${name}`);

    const catalog = await f.catalog();
    assert.equal(catalog.status, 200, JSON.stringify(catalog));
    assert.deepEqual(catalog.data.sources, [{ objectId: record.id, sourcePath, sourceRevision: saved.data.version, name: '新建 Signal.txt' }]);
    assert.notEqual(catalog.data.baseRevision, empty.data.baseRevision);
    assert.equal(catalog.data.scene.sourceRevision, empty.data.scene.sourceRevision);
    assert.equal(catalog.data.scene.objectRevision, empty.data.scene.objectRevision);
    assert.deepEqual(catalog.data.scene.instances, empty.data.scene.instances);
    const reopened = await request(f.base, '/api/doc?path=' + encodeURIComponent(sourcePath));
    assert.equal(reopened.status, 200);
    assert.equal(reopened.data.content, content);
    assert.equal(reopened.data.version, saved.data.version);
    assert.deepEqual(await f.tree(), after, 'discovery and reopening do not add behavior or alter author files');
  });

  test(`script workflow v${version}: duplicate, case aliases and invalid type fail without author writes`, async t => {
    const f = await fixture(t, version), sourcePath = `${f.documents}/scripts/Signal.txt`;
    assert.equal((await request(f.base, '/api/doc', { path: sourcePath, content, create: true, documentType: 'character' })).status, 200);
    const before = await f.tree(), registry = await readRegistry(f.root);
    for (const attempt of [sourcePath, sourcePath.replace('Signal', 'signal'), sourcePath.replace('/scripts/', '/Scripts/')]) {
      const conflict = await request(f.base, '/api/doc', { path: attempt, content: 'must not overwrite', create: true, documentType: 'character' });
      assert.equal(conflict.status, 409, JSON.stringify(conflict));
      assert.deepEqual(await f.tree(), before, `Rejected path wrote author files: ${attempt}`);
      assert.deepEqual(await readRegistry(f.root), registry);
    }
    const invalid = await request(f.base, '/api/doc', { path: `${f.documents}/scripts/invalid.txt`, content, create: true, documentType: 'script' });
    assert.equal(invalid.status, 400, JSON.stringify(invalid));
    assert.deepEqual(await f.tree(), before);
    assert.equal((await f.catalog()).data.sources.length, 1);
  });
}
