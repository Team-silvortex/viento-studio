import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './helpers.mjs';
import { SCENE_PHYSICS2D_TARGETS_API_PATH, captureScenePhysics2DTargetDirectory } from '../../engine/scene-physics2d-targets.mjs';

import { scenePhysics2DTargetsFixture, tree, sceneId as sceneObjectId, manifestId as manifestObjectId,
  manifestPath } from './helpers/scene-physics2d-targets-fixture.mjs';
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const token = 'physics-targets-test-token';
async function fixture(t, mode = 'doc-site-server.mjs') {
  const { root } = await scenePhysics2DTargetsFixture(t);
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root,
    DOC_API_TOKEN: token, DOC_API_REQUIRE_WRITE_AUTH: '1', DOC_API_MAX_BODY_BYTES: '1024' }, mode);
  const post = (value = { sceneObjectId }, auth = token, suffix = '', contentType = 'application/json') => fetch(base + SCENE_PHYSICS2D_TARGETS_API_PATH + suffix, {
    method: 'POST', headers: { 'Content-Type': contentType, ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(value),
  });
  return { root, base, post };
}
const payload = async response => { const body = await response.json(); return body.data || body; };

test('physics targets HTTP advertises an independent read capability and protects no-store saved sources with the author token', async t => {
  const f = await fixture(t), capabilitiesResponse = await fetch(f.base + '/api/capabilities');
  assert.equal(capabilitiesResponse.status, 200);
  const capabilities = await payload(capabilitiesResponse);
  assert.equal(capabilities.scenePhysics2DTargets, true);
  assert.equal(capabilities.sceneAudioDirectory, true);
  assert.deepEqual(capabilities.semanticCommands.filter(command => /physics/i.test(command)), [], 'this identity reader does not grant physics creation or write authority');
  const before = await tree(f.root);
  assert.equal((await f.post(undefined, '')).status, 401);
  assert.equal((await f.post(undefined, 'wrong-token')).status, 403);
  const response = await f.post(); assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /(?:^|,\s*)no-store(?:,|$)/);
  const value = captureScenePhysics2DTargetDirectory(await payload(response), sceneObjectId);
  assert.equal(value.scene.objectId, sceneObjectId);
  assert.equal(value.manifest.objectId, manifestObjectId);
  assert.equal(value.manifest.content, await fs.readFile(path.join(f.root, manifestPath), 'utf8'));
  assert.equal(value.targets.length, 2);
  assert.equal(value.targets[0].name, 'Traveler / 旅人 / 旅人');
  assert.equal(JSON.stringify(value).includes(f.root), false);
  for (const key of ['resources', 'proposal', 'writeToken', 'commands']) assert.equal(Object.hasOwn(value, key), false);
  assert.deepEqual(await tree(f.root), before, 'read requests and authentication failures preserve all project bytes');
});

test('physics targets HTTP accepts only bounded authenticated JSON POST with one scene ID and no query', async t => {
  const f = await fixture(t), before = await tree(f.root);
  for (const input of [{ sceneObjectId, execute: true }, { sceneObjectId, sourcePath: manifestPath },
    { sceneObjectId, bodyId: '77777777-7777-4777-8777-000000000001' }, { sceneObjectId: '../outside' }, {}, [], null]) {
    assert.equal((await f.post(input)).status, 400);
  }
  assert.equal((await f.post(undefined, token, '?path=elsewhere')).status, 400);
  assert.equal((await f.post(undefined, token, '?sceneObjectId=' + sceneObjectId)).status, 400);
  assert.equal((await f.post(undefined, token, '', 'text/plain')).status, 415);
  assert.equal((await f.post({ sceneObjectId: 'x'.repeat(2048) })).status, 413);
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const response = await fetch(f.base + SCENE_PHYSICS2D_TARGETS_API_PATH, { method });
    assert.equal(response.status, 405); assert.match(response.headers.get('allow'), /POST/);
  }
  assert.deepEqual(await tree(f.root), before);
});

test('browse-only host does not publish physics target sources or advertise the editor capability', async t => {
  const f = await fixture(t, 'browse-server.mjs'), before = await tree(f.root);
  assert.equal((await f.post()).status, 405); assert.equal((await f.post(undefined, '')).status, 405);
  const response = await fetch(f.base + '/api/capabilities');
  if (response.ok) assert.notEqual((await payload(response)).scenePhysics2DTargets, true);
  assert.deepEqual(await tree(f.root), before);
});

test('physics targets reject foreign origins and cross-site fetches even with the author token', async t => {
  const f = await fixture(t), before = await tree(f.root);
  const request = headers => fetch(f.base + SCENE_PHYSICS2D_TARGETS_API_PATH, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify({ sceneObjectId }),
  });
  assert.equal((await request({ Origin: 'https://foreign.invalid' })).status, 403);
  assert.equal((await request({ Origin: 'null' })).status, 403);
  assert.equal((await request({ Origin: f.base, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request({ Origin: f.base, 'Sec-Fetch-Site': 'same-origin' })).status, 200);
  assert.deepEqual(await tree(f.root), before);
});
