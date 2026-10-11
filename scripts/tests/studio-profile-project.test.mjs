import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, write, serve, request } from './helpers.mjs';
import { nativeMobileLibrary } from './mobile-native-harness.mjs';
import { createMobilePlatform } from '../../mobile/platform.mjs';
import { createStudioModuleRegistry } from '../../engine/studio-modules.mjs';
import { WORKSPACE_LAYOUT, projectDefinition, validateProjectTypes } from '../lib/project-layout.mjs';
import { readWorkspace, registerWorkspace, readRegistry } from '../lib/workspace.mjs';
import { applyProjectDefinition } from '../lib/project-definition.mjs';
import { readProjectConfiguration, saveProjectTemplate } from '../lib/project-service.mjs';

const profile = () => ({ format: 'viento-studio-profile', schemaVersion: 1,
  required: [{ capability: 'document.edit', apiVersion: 1 }, { capability: 'scene.representation.scene3d', apiVersion: 1 }],
  optional: [{ capability: 'behavior.rust', apiVersion: 1 }] });
const types = [{ id: 'scene', label: '剧本场次', directory: 'scenes', template: 'scene.md', parserProfile: 'prose' }];
const source = '\uFEFF# 第一场\r\n\r\n人物甲：不要把我的剧本当成可执行场景。  \r\n';

async function project(t) {
  const root = await fixture(t);
  const manifest = { format: 'viento-workspace', version: 3, id: randomUUID(), name: '系统边界测试', createdAt: 0,
    ...WORKSPACE_LAYOUT, documentTypes: types };
  await write(root, 'workspace.json', JSON.stringify(manifest));
  await write(root, 'documents/scenes/第一场.md', source);
  await write(root, 'templates/scene.md', '# 场次\r\n');
  await write(root, 'assets/reference.bin', Buffer.from([0, 1, 128, 255]));
  await registerWorkspace(root);
  return { root, manifest: readWorkspace(root), registry: await readRegistry(root) };
}

test('profile adoption is previewed, journaled and preserves authors, registrations and template bytes', async t => {
  const h = await project(t), before = await fs.readFile(path.join(h.root, 'workspace.json'));
  const definition = { format: 'viento-project-definition', version: 1, documentTypes: types, studioProfile: profile() };
  const preview = await applyProjectDefinition(h.root, definition);
  assert.equal(preview.changed, true); assert.equal(preview.journal, null);
  assert.deepEqual(await fs.readFile(path.join(h.root, 'workspace.json')), before);
  const applied = await applyProjectDefinition(h.root, definition, { write: true });
  const journal = JSON.parse(await fs.readFile(path.join(h.root, applied.journal), 'utf8'));
  assert.deepEqual(journal.before, h.manifest); assert.deepEqual(journal.after.studioProfile, profile());
  assert.equal((await applyProjectDefinition(h.root, definition, { write: true })).changed, false);
  assert.deepEqual(await readRegistry(h.root), h.registry);
  assert.equal(await fs.readFile(path.join(h.root, 'documents/scenes/第一场.md'), 'utf8'), source);
  assert.equal(await fs.readFile(path.join(h.root, 'templates/scene.md'), 'utf8'), '# 场次\r\n');
  const exposed = projectDefinition(readWorkspace(h.root)); exposed.studioProfile.required[0].capability = 'changed';
  assert.deepEqual(readWorkspace(h.root).studioProfile, profile());
  const plan = createStudioModuleRegistry().plan(projectDefinition(readWorkspace(h.root)).studioProfile);
  assert.equal(plan.satisfied, true);
  assert.equal(plan.requests[1].status, 'supported'); assert.equal(plan.requests[2].status, 'missing');
  assert.equal(plan.capabilities.find(item => item.capability === 'document.edit').active, true);
  const config = await readProjectConfiguration(h.root);
  await saveProjectTemplate(h.root, { revision: config.revision, type: types[0], format: 'md', content: '# 新场次\r\n' });
  assert.deepEqual(readWorkspace(h.root).studioProfile, profile(), 'type/template edits retain the system request');
  await applyProjectDefinition(h.root, { format: 'viento-project-definition', version: 1, documentTypes: types }, { write: true });
  assert.deepEqual(readWorkspace(h.root).studioProfile, profile(), 'omitting the optional field does not erase existing requests');
  await applyProjectDefinition(h.root, { ...definition, studioProfile: { ...profile(), required: [], optional: [] } }, { write: true });
  assert.deepEqual(readWorkspace(h.root).studioProfile.required, [], 'explicit empty profile clears requirements');
});

test('invalid profile adoption fails before journal, workspace, metadata or author writes', async t => {
  const h = await project(t), before = await fs.readFile(path.join(h.root, 'workspace.json'));
  for (const invalid of [null, { ...profile(), schemaVersion: 2 }, { ...profile(), executable: 'bad' },
    { ...profile(), optional: [{ capability: 'document.edit', apiVersion: 2 }] }]) {
    for (const write of [false, true]) await assert.rejects(applyProjectDefinition(h.root,
      { format: 'viento-project-definition', version: 1, documentTypes: types, studioProfile: invalid }, { write }));
    assert.deepEqual(await fs.readFile(path.join(h.root, 'workspace.json')), before);
    assert.deepEqual(await readRegistry(h.root), h.registry);
  }
  await assert.rejects(fs.access(path.join(h.root, '.viento/migrations')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(h.root, 'documents/scenes/第一场.md'), 'utf8'), source);
});

test('profile adoption snapshots caller input before asynchronous locking or template reads', async t => {
  const h = await project(t), input = profile(), expected = structuredClone(input);
  const definition = { format: 'viento-project-definition', version: 1, documentTypes: types, studioProfile: input };
  const pending = applyProjectDefinition(h.root, definition, { write: true });
  input.required[0].apiVersion = 0;
  input.executable = 'must-never-be-persisted';
  definition.studioProfile = null;
  await pending;
  assert.deepEqual(readWorkspace(h.root).studioProfile, expected);
  assert.deepEqual(await readRegistry(h.root), h.registry);
});

test('HTTP catalog carries additive requests and keeps a drama scene as prose with ordinary editing', async t => {
  const h = await project(t);
  await applyProjectDefinition(h.root, { format: 'viento-project-definition', version: 1,
    documentTypes: types, studioProfile: profile() }, { write: true });
  const base = await serve(t, h.root);
  await request(base, '/api/rebuild', { source: 'documents/scenes/第一场.md' });
  const index = await request(base, '/api/index');
  assert.deepEqual(index.data.workspace.studioProfile, profile());
  assert.equal(index.data.workspace.documentTypes[0].parserProfile, 'prose');
  const doc = await request(base, `/api/doc?path=${encodeURIComponent('documents/scenes/第一场.md')}`);
  assert.equal(doc.status, 200); assert.equal(doc.data.content, source);
});

test('legacy projects do not acquire a system profile or an implicit 2D/3D requirement from a scene type', () => {
  const manifest = { version: 3, documentTypes: types };
  validateProjectTypes(manifest);
  assert.equal(Object.hasOwn(projectDefinition(manifest), 'studioProfile'), false);
  assert.deepEqual(createStudioModuleRegistry().plan(projectDefinition(manifest).studioProfile).requests, []);
});

test('already saved future and malformed profiles remain readable without rewriting their declarations', async t => {
  const h = await project(t);
  for (const existing of [{ ...profile(), schemaVersion: 99 }, { ...profile(), extension: 'future-data' }, null]) {
    const manifest = { ...h.manifest, studioProfile: existing };
    const bytes = JSON.stringify(manifest);
    await write(h.root, 'workspace.json', bytes);
    assert.deepEqual(readWorkspace(h.root).studioProfile, existing);
    assert.deepEqual(projectDefinition(readWorkspace(h.root)).studioProfile, existing);
    const config = await readProjectConfiguration(h.root);
    assert.equal(config.entries[0].type.parserProfile, 'prose');
    assert.equal(await fs.readFile(path.join(h.root, 'workspace.json'), 'utf8'), bytes);
    assert.equal(await fs.readFile(path.join(h.root, 'documents/scenes/第一场.md'), 'utf8'), source);
    assert.deepEqual(await readRegistry(h.root), h.registry);
  }
});

test('native archive restore and mobile catalog preserve requests and authored bytes without the template catalog', {
  skip: !process.env.VIENTO_MOBILE_STORE_BIN && 'Set VIENTO_MOBILE_STORE_BIN to the mobile-storage example',
}, async t => {
  const library = await nativeMobileLibrary(process.env.VIENTO_MOBILE_STORE_BIN); t.after(() => library.close());
  const target = await nativeMobileLibrary(process.env.VIENTO_MOBILE_STORE_BIN); t.after(() => target.close());
  const work = await library.invoke('mobile_storage', { action: 'create', payload: { name: 'Profile 原生往返', templateId: 'org.viento.oc-drama' } });
  const directories = (await fs.readdir(library.root, { withFileTypes: true })).filter(item => item.isDirectory() && !item.name.startsWith('.'));
  assert.equal(directories.length, 1);
  const root = path.join(library.root, directories[0].name), file = path.join(root, 'workspace.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8')); manifest.studioProfile = profile();
  await fs.writeFile(file, JSON.stringify(manifest));
  const platform = createMobilePlatform({ invoke: library.invoke, workspaceId: work.id });
  const created = await platform.request('/api/doc', { method: 'POST', body: JSON.stringify({ path: 'documents/scenes/第一场.md', content: source, create: true, documentType: 'scene' }) });
  assert.equal(created.status, 200, await created.text());
  const before = await platform.index();
  assert.deepEqual(before.workspace.studioProfile, profile()); assert.equal(before.docs[0].parserProfile, 'prose');
  const archive = path.join(library.root, 'profile.viento.zip');
  await library.invoke('mobile_storage', { action: 'exportArchive', workspaceId: work.id, path: archive });
  const restored = await target.invoke('mobile_storage', { action: 'importArchive', path: archive });
  const imported = createMobilePlatform({ invoke: target.invoke, workspaceId: restored.id });
  assert.deepEqual((await imported.index()).workspace.studioProfile, profile());
  assert.equal((await imported.request('/api/doc?path=documents%2Fscenes%2F%E7%AC%AC%E4%B8%80%E5%9C%BA.md')).status, 200);
  const restoredDoc = await imported.request('/api/doc?path=documents%2Fscenes%2F%E7%AC%AC%E4%B8%80%E5%9C%BA.md');
  assert.equal((await restoredDoc.json()).content, source);
  assert.equal(restored.id, work.id);
});
