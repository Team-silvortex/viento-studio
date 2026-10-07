import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createDocumentStore } from '../../engine/document-store.mjs';
import { createNodeDocumentStorage } from '../adapters/node-document-storage.mjs';
import { resolveContainedPath } from '../lib/contained-path.mjs';
import { readRegistry } from '../lib/workspace.mjs';
import { captureBuildSnapshot, captureScenePreviewSnapshot, captureSceneDraftPreview, buildHash } from '../adapters/node-build-snapshot.mjs';
import { createScenePreviewService } from '../lib/scene-preview-service.mjs';
import { createProjectBuildService } from '../lib/project-build-service.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const recipeExample = await fs.readFile(new URL('../../examples/scene-composition/recipe.json', import.meta.url), 'utf8');
const imageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ordinarySceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const recipePath = 'documents/scenes/recipe.json', revision = value => `sha256:${buildHash(value)}`;
const serialized = value => '\ufeff' + JSON.stringify(value, null, 2).replaceAll('\n', '\r\n') + '\r\n';

async function files(root, { authorOnly = false } = {}) {
  const result = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath || entry.path, entry.name), relative = path.relative(root, file);
    if (!authorOnly || !relative.startsWith('.viento/')) result[relative] = buildHash(await fs.readFile(file));
  }
  return result;
}
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-composition-preview-host-')), root = path.join(directory, 'workspace');
  await fs.cp(new URL('../../examples/scene2d/', import.meta.url), root, { recursive: true });
  const content = serialized(JSON.parse(recipeExample));
  const store = createDocumentStore({ editablePrefixes: ['documents/'], storage: createNodeDocumentStorage({ root,
    resolvePath: async (relativePath, { allowCreate }) => {
      const absolutePath = await resolveContainedPath(root, path.join(root, relativePath), { allowMissing: allowCreate });
      let exists = true; try { await fs.stat(absolutePath); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
      return { relativePath, absolutePath, exists };
    } }) });
  await store.writeDoc({ path: recipePath, content, create: true, documentType: 'scene' });
  const record = (await readRegistry(root)).documents.find(item => item.sourcePath === recipePath), sceneId = record.id;
  assert.deepEqual(record.relations, []); assert.deepEqual(record.assetBindings, []);
  const service = createScenePreviewService(root, { enabled: true, ...options });
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, root, content, record, sceneId, service, store, draft: { sourcePath: recipePath, baseSourceRevision: revision(content), content } };
}
const editDraft = (draft, change) => {
  const value = JSON.parse(draft.content.replace(/^\ufeff/, '')); change(value); return { ...draft, content: serialized(value) };
};

test('saved recipe preview freezes raw source identity, repeated instances and images without scene registration or a build envelope', async t => {
  const f = await fixture(t), before = await files(f.root), captured = await captureScenePreviewSnapshot(f.root, f.sceneId);
  assert.equal(captured.ok, true); assert.equal(captured.snapshot, undefined); assert.equal(captured.sceneEditing, undefined);
  assert.equal(captured.plan.scene.objectId, f.sceneId); assert.equal(captured.plan.scene.sourceRevision, revision(f.content));
  assert.equal(captured.plan.actors.length, 4); assert.equal(captured.sceneStructure.groups.length, 4);
  assert.deepEqual(captured.plan.actors[2].position, [460, 220]);
  const preview = await f.service.create({ sceneId: f.sceneId });
  assert.equal(preview.composition.format, 'viento-scene-composition-preview'); assert.equal(preview.composition.recipeObjectId, f.sceneId);
  assert.equal(preview.composition.sourceRevision, revision(f.content)); assert.equal(preview.composition.fragmentCount, 1); assert.equal(preview.composition.placementCount, 2);
  assert.equal(preview.snapshotId, captured.snapshotId); assert.equal(preview.snapshot, undefined); assert.equal(preview.sceneEditing, undefined);
  assert.equal(preview.draft, undefined); assert.equal(preview.sourceLocations.scene.sourceRevision, revision(f.content));
  assert.ok(!JSON.stringify(preview).includes(f.root));
  assert.deepEqual(f.service.resource(preview.previewId, imageId).bytes, await fs.readFile(path.join(f.root, 'assets/traveler.svg')));
  assert.deepEqual(await files(f.root), before);
  // Executable build capture keeps its existing format gate, even when callers
  // try to smuggle preview options into the public build wrapper.
  for (const options of [{}, { compositionPreview: true }, { draft: f.draft }]) {
    const build = await captureBuildSnapshot(f.root, f.sceneId, options);
    assert.equal(build.ok, false); assert.equal(build.snapshot, undefined); assert.ok(build.diagnostics.some(item => item.code === 'build_scene_format'));
  }
  const ordinary = await captureScenePreviewSnapshot(f.root, ordinarySceneId), build = await captureBuildSnapshot(f.root, ordinarySceneId);
  assert.equal(ordinary.snapshotId, build.snapshotId); assert.deepEqual(ordinary.snapshot, build.snapshot);
});

test('recipe drafts preserve exact source revisions, domain separation and stale-baseline rejection without offering scene writeback', async t => {
  const f = await fixture(t), before = await files(f.root);
  const saved = await captureScenePreviewSnapshot(f.root, f.sceneId), unchanged = await captureSceneDraftPreview(f.root, f.sceneId, f.draft);
  assert.notEqual(unchanged.snapshotId, saved.snapshotId); assert.equal(unchanged.plan.scene.sourceRevision, saved.plan.scene.sourceRevision);
  const draft = editDraft(f.draft, recipe => { recipe.scene.title = 'Unsaved recipe / 未保存'; recipe.placements[1].offset = [420, 90]; });
  const preview = await f.service.create({ sceneId: f.sceneId, draft });
  assert.equal(preview.ok, true); assert.equal(preview.scene.title, 'Unsaved recipe / 未保存'); assert.deepEqual(preview.actors[2].position, [520, 230]);
  assert.deepEqual(preview.draft, { baseSourceRevision: revision(f.content), sourceRevision: revision(draft.content) });
  assert.equal(preview.composition.sourceRevision, revision(draft.content)); assert.equal(preview.scene.sourceRevision, revision(draft.content));
  assert.equal(preview.snapshot, undefined); assert.equal(preview.sceneEditing, undefined);
  await assert.rejects(f.service.create({ sceneId: f.sceneId, draft: { ...draft, baseSourceRevision: `sha256:${'0'.repeat(64)}` } }),
    { errorCode: 'scene_preview_draft_conflict', statusCode: 409 });
  await assert.rejects(f.service.create({ sceneId: f.sceneId, draft: { ...draft, content: draft.content + '\ud800' } }), { errorCode: 'scene_preview_request_invalid' });
  assert.deepEqual(await files(f.root), before);
});

test('recipe failure retains prior frozen image bytes and reports the recipe source rather than generated scene offsets', async t => {
  const f = await fixture(t), saved = await f.service.create({ sceneId: f.sceneId }), frozen = Buffer.from(f.service.resource(saved.previewId, imageId).bytes);
  const invalid = { ...f.draft, content: '\ufeff{ "format": "viento-scene-composition", "scene":' };
  const rejected = await f.service.create({ sceneId: f.sceneId, draft: invalid });
  assert.equal(rejected.ok, false); assert.equal(rejected.previewId, null); assert.ok(rejected.diagnostics.length);
  assert.equal(rejected.draft.sourceRevision, revision(invalid.content));
  await fs.writeFile(path.join(f.root, 'assets/traveler.svg'), '<svg>external edit</svg>');
  const before = await files(f.root), changed = await f.service.create({ sceneId: f.sceneId });
  assert.equal(changed.ok, false); assert.equal(changed.diagnostics[0].code, 'build_resource_changed');
  assert.equal(changed.diagnostics[0].sourcePath, recipePath); assert.equal(changed.diagnostics[0].sourceRevision, revision(f.content));
  assert.match(changed.diagnostics[0].propertyPath, /^\/fragments\//);
  assert.deepEqual(f.service.resource(saved.previewId, imageId).bytes, frozen); assert.deepEqual(await files(f.root), before);
});

test('recipe preview validates dependencies in unplaced fragments and draft overlays without rewriting authored metadata', async t => {
  const f = await fixture(t), draft = editDraft(f.draft, recipe => {
    const actor = { ...recipe.fragments[0].actors[0], objectId: '99999999-1111-4111-8111-111111111111' }; delete actor.groupKey;
    recipe.fragments.push({ fragmentId: 'unused', groups: [], actors: [actor] });
  }), before = await files(f.root);
  const preview = await f.service.create({ sceneId: f.sceneId, draft });
  assert.equal(preview.ok, false); assert.equal(preview.previewId, null);
  assert.ok(preview.diagnostics.some(item => item.propertyPath.startsWith('/fragments/1/actors/0')));
  assert.deepEqual(await files(f.root), before);
});

test('saved and draft recipe previews reject source edits during image freezing and preserve the external change', async t => {
  for (const draftMode of [false, true]) {
    const f = await fixture(t), open = fs.open, edited = f.content.replace('Two parties', 'External during freeze'); let changed = false;
    fs.open = async (file, ...args) => {
      const handle = await open(file, ...args);
      if (!changed && file === path.join(f.root, 'assets/traveler.svg')) { changed = true; await fs.writeFile(path.join(f.root, recipePath), edited); }
      return handle;
    };
    try {
      await assert.rejects(f.service.create({ sceneId: f.sceneId, ...(draftMode ? { draft: f.draft } : {}) }),
        { errorCode: draftMode ? 'scene_preview_draft_conflict' : 'build_input_changed', statusCode: 409 });
      assert.equal(changed, true); assert.equal(await fs.readFile(path.join(f.root, recipePath), 'utf8'), edited);
    } finally { fs.open = open; }
  }
});

test('invalid saved recipe diagnostics are fenced against a repair between observations', async t => {
  const f = await fixture(t), source = path.join(f.root, recipePath), readFile = fs.readFile;
  await fs.writeFile(source, '{"format":"viento-scene-composition",');
  let reads = 0;
  fs.readFile = async (file, ...args) => {
    const bytes = await readFile(file, ...args);
    if (file === source && ++reads === 2) await fs.writeFile(source, f.content);
    return bytes;
  };
  try {
    await assert.rejects(f.service.create({ sceneId: f.sceneId }), { errorCode: 'build_input_changed', statusCode: 409 });
    assert.ok(reads >= 4); assert.equal(await readFile(source, 'utf8'), f.content);
  } finally { fs.readFile = readFile; }
});

test('build catalogue exposes recipe preview candidates separately, diagnoses invalid source and exits after removing format', { skip: process.platform !== 'linux' }, async t => {
  const f = await fixture(t), builds = createProjectBuildService(f.root, { enabled: true, godot: '', cacheRoot: path.join(f.directory, 'build-cache') });
  t.after(() => builds.close());
  const status = await builds.status();
  assert.equal(status.scenes.some(item => item.id === f.sceneId), false);
  assert.deepEqual(status.previewDocuments.find(item => item.id === ordinarySceneId), { ...status.scenes.find(item => item.id === ordinarySceneId), kind: 'scene' });
  assert.deepEqual(status.previewDocuments.find(item => item.id === f.sceneId), { id: f.sceneId, sourcePath: recipePath, title: JSON.parse(recipeExample).scene.title, kind: 'composition' });
  await assert.rejects(builds.command({ action: 'plan', sceneId: f.sceneId }), { errorCode: 'build_scene_required' });
  assert.equal((await builds.status()).job, null);
  await fs.writeFile(path.join(f.root, recipePath), '{"format":"viento-scene-composition",');
  assert.equal((await builds.status({ refresh: true })).previewDocuments.find(item => item.id === f.sceneId).kind, 'composition');
  await fs.writeFile(path.join(f.root, recipePath), '{broken source after selection');
  assert.equal((await builds.status({ refresh: true })).previewDocuments.find(item => item.id === f.sceneId).kind, 'composition');
  await fs.writeFile(path.join(f.root, recipePath), '{"title":"ordinary now"}');
  assert.equal((await builds.status({ refresh: true })).previewDocuments.some(item => item.id === f.sceneId), false);
  await assert.rejects(fs.access(path.join(f.directory, 'build-cache')), { code: 'ENOENT' });
});

test('recipe previews inherit cancellation and redact any injected scene editing capability at the service boundary', async t => {
  const f = await fixture(t, { capture: async (...args) => {
    const result = await captureScenePreviewSnapshot(...args);
    result.sceneEditing = { content: 'must not be offered', worldId: 'leak' }; result.composition.privateRoot = '/private/root'; return result;
  } });
  const result = await f.service.create({ sceneId: f.sceneId }); assert.equal(result.ok, true);
  assert.equal(result.sceneEditing, undefined); assert.equal(result.composition.privateRoot, undefined);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(captureScenePreviewSnapshot(f.root, f.sceneId, { signal: aborted.signal }), { name: 'AbortError' });
  await assert.rejects(f.service.create({ sceneId: f.sceneId }, { signal: aborted.signal }), { errorCode: 'scene_preview_superseded' });
  assert.deepEqual(f.service.release(result.previewId), { released: true });
  assert.throws(() => f.service.resource(result.previewId, imageId), { errorCode: 'scene_preview_expired' });
});

async function httpHost(t, fixture) {
  const child = spawn(process.execPath, [path.join(appRoot, 'scripts/doc-site-server.mjs'), '--port', '0'], { cwd: fixture.root,
    env: { ...process.env, VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: fixture.root, VIENTO_PREFERENCES_PATH: '', VIENTO_SESSION_TOKEN: '',
      XDG_CACHE_HOME: path.join(fixture.directory, 'cache'), XDG_DATA_HOME: path.join(fixture.directory, 'data'), XDG_CONFIG_HOME: path.join(fixture.directory, 'config'),
      VIENTO_GODOT_BIN: '', PORT: '0', DOC_API_HOST: '127.0.0.1', DOC_API_TOKEN: 'recipe-preview-test', DOC_API_WRITE_TOKEN: '',
      DOC_API_REQUIRE_WRITE_AUTH: '1', DOC_API_SECURITY_AUDIT: '0', DOC_API_RATE_LIMIT_MAX_REQUESTS: '10000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await exited; } });
  const deadline = Date.now() + 15000;
  while (!output.match(/Doc viewer running at (http:\/\/127\.0\.0\.1:\d+)/)) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error('HTTP fixture failed: ' + output); await delay(20);
  }
  const base = output.match(/Doc viewer running at (http:\/\/127\.0\.0\.1:\d+)/)[1];
  return { base, request: async (pathname, payload, options = {}) => {
    const response = await fetch(base + pathname, { ...(payload === undefined ? {} : { method: 'POST', body: JSON.stringify(payload) }), ...options,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer recipe-preview-test', ...options.headers } });
    const body = await response.json(); return { response, data: body.data || body };
  } };
}

test('actual editor HTTP serves saved/draft recipe previews with existing local authorization, frozen images and no build jobs', {
  skip: process.platform !== 'linux', timeout: 30000,
}, async t => {
  const f = await fixture(t), before = await files(f.root, { authorOnly: true }), h = await httpHost(t, f);
  const catalog = (await h.request('/api/project-build')).data;
  assert.equal(catalog.previewDocuments.find(item => item.id === f.sceneId).kind, 'composition');
  assert.equal(catalog.scenes.some(item => item.id === f.sceneId), false);
  assert.equal((await h.request('/api/scene-preview', { sceneId: f.sceneId }, { headers: { Authorization: '' } })).response.status, 401);
  assert.equal((await h.request('/api/scene-preview', { sceneId: f.sceneId }, { headers: { Origin: 'https://example.org' } })).response.status, 403);
  const saved = await h.request('/api/scene-preview', { sceneId: f.sceneId });
  assert.equal(saved.response.status, 200); assert.equal(saved.data.ok, true); assert.equal(saved.data.composition.recipeObjectId, f.sceneId);
  assert.equal(saved.data.sceneEditing, undefined); assert.equal(saved.data.snapshot, undefined);
  const image = await fetch(h.base + saved.data.resources[0].url); assert.equal(image.status, 200);
  assert.match(image.headers.get('content-security-policy'), /sandbox/); assert.match(image.headers.get('cache-control'), /no-store/);
  assert.equal(buildHash(Buffer.from(await image.arrayBuffer())), saved.data.resources[0].sha256);
  const draft = editDraft(f.draft, recipe => { recipe.placements[1].offset = [100, 20]; });
  const preview = await h.request('/api/scene-preview', { sceneId: f.sceneId, draft });
  assert.equal(preview.data.ok, true); assert.equal(preview.data.draft.sourceRevision, revision(draft.content)); assert.deepEqual(preview.data.actors[2].position, [200, 160]);
  assert.equal((await h.request('/api/project-build', { action: 'plan', sceneId: f.sceneId })).response.status, 404);
  assert.equal((await h.request('/api/project-build')).data.job, null);
  const stale = await h.request('/api/scene-preview', { sceneId: f.sceneId, draft: { ...draft, baseSourceRevision: `sha256:${'0'.repeat(64)}` } });
  assert.equal(stale.response.status, 409); assert.equal(stale.data.errorCode, 'scene_preview_draft_conflict');
  const released = await h.request('/api/scene-preview?previewId=' + preview.data.previewId, undefined, { method: 'DELETE' }); assert.equal(released.data.released, true);
  assert.equal((await fetch(h.base + preview.data.resources[0].url)).status, 404);
  assert.deepEqual(await files(f.root, { authorOnly: true }), before);
});
