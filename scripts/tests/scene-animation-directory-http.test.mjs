import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { serve } from './helpers.mjs';
import { SCENE_ANIMATION_DIRECTORY_API_PATH, captureSceneAnimationDirectory } from '../../engine/scene-animation-directory.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const sceneObjectId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const manifestId = '88888888-8888-4888-8888-888888888887';
const token = 'animation-directory-test-token';
async function fixture(t, mode = 'doc-site-server.mjs') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-audio-directory-http-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  // Only the disposable copy receives named clips; checked-in examples remain unchanged.
  await fs.cp(path.join(appRoot, 'examples/scene-animation'), root, { recursive: true });
  const file = path.join(root, 'documents/animations/demo.json');
  const animation = JSON.parse(await fs.readFile(file, 'utf8')); animation.schemaVersion = 3;
  animation.clips = [{ id: '12121212-1212-4212-8212-121212121212', name: '待机 / Idle / 待機', startSeconds: .25, endSeconds: 1.5, loop: true }];
  await fs.writeFile(file, '\ufeff' + JSON.stringify(animation, null, 2).replaceAll('\n', '\r\n') + '\r\n');
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
    DOC_API_TOKEN: token, DOC_API_REQUIRE_WRITE_AUTH: '1' }, mode);
  const post = (value = { sceneObjectId }, auth = token, suffix = '', contentType = 'application/json') => fetch(base + SCENE_ANIMATION_DIRECTORY_API_PATH + suffix, {
    method: 'POST', headers: { 'Content-Type': contentType, ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(value),
  });
  return { root, base, post };
}
async function tree(root) {
  const files = {};
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(entry.parentPath, entry.name);
    files[path.relative(root, file)] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
  }
  return files;
}
const payload = async response => { const body = await response.json(); return body.data || body; };

test('directory HTTP advertises its independent capability and requires author tokens for a no-store readonly catalog', async t => {
  const f = await fixture(t), capabilitiesResponse = await fetch(f.base + '/api/capabilities');
  assert.equal(capabilitiesResponse.status, 200);
  const capabilities = await payload(capabilitiesResponse);
  assert.equal(capabilities.sceneAnimationDirectory, true);
  assert.ok(capabilities.semanticCommands.includes('relation.add'));
  const before = await tree(f.root);
  assert.equal((await f.post(undefined, '')).status, 401);
  assert.equal((await f.post(undefined, 'wrong-token')).status, 403);
  const response = await f.post(); assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /(?:^|,\s*)no-store(?:,|$)/);
  const value = captureSceneAnimationDirectory(await payload(response), sceneObjectId);
  assert.equal(value.status, 'ready'); assert.equal(value.scene.objectId, sceneObjectId);
  assert.equal(value.manifest.objectId, manifestId); assert.equal(JSON.parse(value.manifest.content.replace(/^\ufeff/, '')).clips.length, 1);
  assert.equal(JSON.stringify(value).includes(f.root), false); assert.equal(Object.hasOwn(value, 'resources'), false);
  assert.deepEqual(await tree(f.root), before, 'author inspection and rejected requests do not write project files');
});

test('directory HTTP rejects query and extra input fields and accepts only authenticated JSON POST', async t => {
  const f = await fixture(t), before = await tree(f.root);
  for (const input of [{ sceneObjectId, execute: true }, { sceneObjectId, sourcePath: 'documents/behaviors/demo.json' }, {}, null]) {
    assert.equal((await f.post(input)).status, 400);
  }
  assert.equal((await f.post(undefined, token, '?path=elsewhere')).status, 400);
  assert.equal((await f.post(undefined, token, '?sceneObjectId=' + sceneObjectId)).status, 400);
  assert.equal((await f.post(undefined, token, '', 'text/plain')).status, 415);
  const get = await fetch(f.base + SCENE_ANIMATION_DIRECTORY_API_PATH);
  assert.equal(get.status, 405); assert.match(get.headers.get('allow'), /POST/);
  assert.deepEqual(await tree(f.root), before);
});

test('browse-only host does not expose the author directory or advertise its capability', async t => {
  const f = await fixture(t, 'browse-server.mjs'), before = await tree(f.root);
  assert.equal((await f.post()).status, 405); assert.equal((await f.post(undefined, '')).status, 405);
  const response = await fetch(f.base + '/api/capabilities');
  if (response.ok) assert.notEqual((await payload(response)).sceneAnimationDirectory, true);
  assert.deepEqual(await tree(f.root), before);
});
