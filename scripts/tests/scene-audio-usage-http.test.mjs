import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { serve } from './helpers.mjs';
import { SCENE_AUDIO_USAGE_API_PATH, captureSceneAudioUsageDirectory } from '../../engine/scene-audio-usage.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const sceneObjectId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const audioObjectId = '88888888-8888-4888-8888-888888888888';
const token = 'audio-usage-test-token';
async function fixture(t, mode = 'doc-site-server.mjs') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-audio-usage-http-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(appRoot, 'examples/scene-audio'), root, { recursive: true });
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
    DOC_API_TOKEN: token, DOC_API_REQUIRE_WRITE_AUTH: '1', DOC_API_MAX_BODY_BYTES: '1024' }, mode);
  const post = (value = { sceneObjectId }, auth = token, suffix = '', contentType = 'application/json') => fetch(base + SCENE_AUDIO_USAGE_API_PATH + suffix, {
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

test('audio usage HTTP advertises an independent read capability and protects no-store saved sources with the author token', async t => {
  const f = await fixture(t), capabilitiesResponse = await fetch(f.base + '/api/capabilities');
  assert.equal(capabilitiesResponse.status, 200);
  const capabilities = await payload(capabilitiesResponse);
  assert.equal(capabilities.sceneAudioUsage, true);
  assert.equal(capabilities.sceneAudioDirectory, true);
  assert.equal(capabilities.semanticCommands.some(command => /usage/i.test(command)), false, 'read capability does not add an author command');
  const before = await tree(f.root);
  assert.equal((await f.post(undefined, '')).status, 401);
  assert.equal((await f.post(undefined, 'wrong-token')).status, 403);
  const response = await f.post(); assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /(?:^|,\s*)no-store(?:,|$)/);
  const value = captureSceneAudioUsageDirectory(await payload(response), sceneObjectId);
  assert.equal(value.scene.objectId, sceneObjectId);
  assert.equal(value.audio.objectId, audioObjectId);
  assert.equal(value.audio.content, await fs.readFile(path.join(f.root, 'documents/audio/demo.json'), 'utf8'));
  assert.equal(value.behavior, null);
  assert.equal(JSON.stringify(value).includes(f.root), false);
  for (const key of ['resources', 'proposal', 'writeToken', 'commands']) assert.equal(Object.hasOwn(value, key), false);
  assert.deepEqual(await tree(f.root), before, 'read requests and authentication failures preserve all project bytes');
});

test('audio usage HTTP accepts only bounded authenticated JSON POST with one scene ID and no query', async t => {
  const f = await fixture(t), before = await tree(f.root);
  for (const input of [{ sceneObjectId, execute: true }, { sceneObjectId, sourcePath: 'documents/audio/demo.json' },
    { sceneObjectId, trackId: '77777777-7777-4777-8777-000000000001' }, { sceneObjectId: '../outside' }, {}, [], null]) {
    assert.equal((await f.post(input)).status, 400);
  }
  assert.equal((await f.post(undefined, token, '?path=elsewhere')).status, 400);
  assert.equal((await f.post(undefined, token, '?sceneObjectId=' + sceneObjectId)).status, 400);
  assert.equal((await f.post(undefined, token, '', 'text/plain')).status, 415);
  assert.equal((await f.post({ sceneObjectId: 'x'.repeat(2048) })).status, 413);
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const response = await fetch(f.base + SCENE_AUDIO_USAGE_API_PATH, { method });
    assert.equal(response.status, 405); assert.match(response.headers.get('allow'), /POST/);
  }
  assert.deepEqual(await tree(f.root), before);
});

test('browse-only host does not publish audio usage sources or advertise the editor capability', async t => {
  const f = await fixture(t, 'browse-server.mjs'), before = await tree(f.root);
  assert.equal((await f.post()).status, 405); assert.equal((await f.post(undefined, '')).status, 405);
  const response = await fetch(f.base + '/api/capabilities');
  if (response.ok) assert.notEqual((await payload(response)).sceneAudioUsage, true);
  assert.deepEqual(await tree(f.root), before);
});
