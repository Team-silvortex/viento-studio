import '../adapters/node-studio-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './helpers.mjs';
import { physics2DFixture, fingerprint, targetContents, sceneId, manifestId } from './helpers/world-physics2d-create-fixture.mjs';
import { createScenePhysics2DCreationRequest, captureScenePhysics2DCreationContext, confirmScenePhysics2DCreation } from '../../engine/scene-physics2d-creation-contract.mjs';
import { transactionHash } from '../lib/world-transaction-state.mjs';
const appRoot = fileURLToPath(new URL('../../', import.meta.url)), route = '/api/scene-physics2d-creation';
const token = 'physics2d-create-test-token';
async function fixture(t, mode = 'doc-site-server.mjs') {
  const f = await physics2DFixture(t);
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: f.root,
    DOC_API_TOKEN: token, DOC_API_REQUIRE_WRITE_AUTH: '1', DOC_API_MAX_BODY_BYTES: '262144' }, mode);
  const post = (value = { sceneObjectId: sceneId }, { auth = token, suffix = '', contentType = 'application/json', headers = {} } = {}) => fetch(base + route + suffix, {
    method: 'POST', headers: { 'Content-Type': contentType, ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...headers }, body: JSON.stringify(value),
  });
  const command = (value, headers = {}, auth = token) => fetch(base + '/api/world/commands', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...headers }, body: JSON.stringify(value) });
  return { ...f, base, post, command };
}
const payload = async response => { assert.equal(response.status, 200); const body = await response.json(); return body.data || body; };

test('creation context is a no-store read capability with author authentication and no resource authority', async t => {
  const f = await fixture(t), capabilities = await payload(await fetch(f.base + '/api/capabilities'));
  assert.equal(capabilities.scenePhysics2DCreation, true); assert.ok(capabilities.semanticCommands.includes('physics2d.create'));
  const before = await fingerprint(f.root);
  assert.equal((await f.post(undefined, { auth: '' })).status, 401); assert.equal((await f.post(undefined, { auth: 'wrong' })).status, 403);
  const response = await f.post(); assert.match(response.headers.get('cache-control'), /no-store/);
  const catalog = captureScenePhysics2DCreationContext(await payload(response), sceneId);
  assert.equal(catalog.status, 'empty'); assert.equal(catalog.targets.length, 2); assert.equal(catalog.manifest, null);
  assert.equal(Object.hasOwn(catalog, 'resources'), false); assert.equal(JSON.stringify(catalog).includes(f.root), false);
  assert.deepEqual(await fingerprint(f.root), before);
});

test('creation context admits only bounded authenticated JSON POST and rejects foreign origins', async t => {
  const f = await fixture(t), before = await fingerprint(f.root);
  for (const value of [{}, [], null, { sceneObjectId: sceneId, execute: true }, { sceneObjectId: '../x' }]) assert.equal((await f.post(value)).status, 400);
  assert.equal((await f.post(undefined, { suffix: '?path=x' })).status, 400);
  assert.equal((await f.post(undefined, { contentType: 'text/plain' })).status, 415);
  assert.equal((await f.post({ sceneObjectId: 'x'.repeat(262145) })).status, 413);
  assert.equal((await f.post(undefined, { headers: { Origin: 'https://foreign.invalid' } })).status, 403);
  assert.equal((await f.post(undefined, { headers: { Origin: 'null' } })).status, 403);
  assert.equal((await f.post(undefined, { headers: { Origin: f.base, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await f.post(undefined, { headers: { Origin: f.base, 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
  for (const method of ['GET', 'PUT', 'DELETE']) { const response = await fetch(f.base + route, { method }); assert.equal(response.status, 405); assert.match(response.headers.get('allow'), /POST/); }
  assert.deepEqual(await fingerprint(f.root), before);
});

test('authenticated same-origin preview/apply creates the declaration and catalog confirms exact saved content', async t => {
  const f = await fixture(t), catalog = await payload(await f.post()), request = createScenePhysics2DCreationRequest(catalog,
    Object.fromEntries(['objectId', 'documentType', 'sourcePath', 'content'].map(key => [key, f.input[key]])));
  const before = await fingerprint(f.root);
  assert.equal((await f.command(request, {}, '')).status, 401); assert.equal((await f.command(request, {}, 'wrong')).status, 403);
  for (const headers of [{ Origin: 'https://foreign.invalid' }, { Origin: f.base, 'Sec-Fetch-Site': 'cross-site' }])
    assert.equal((await f.command({ ...request, mode: 'apply' }, headers)).status, 403);
  const preview = await payload(await f.command(request, { Origin: f.base })); assert.equal(preview.status, 'preview');
  assert.deepEqual(await fingerprint(f.root), before); assert.deepEqual(await targetContents(f), [null, null, f.sceneRecord]);
  const applied = await payload(await f.command({ ...request, mode: 'apply' }, { Origin: f.base })); assert.equal(applied.status, 'applied'); assert.equal(applied.revision, preview.revision);
  const ready = await payload(await f.post()); assert.equal(ready.manifest.objectId, manifestId); assert.equal(ready.manifest.content, f.input.content);
  assert.equal(confirmScenePhysics2DCreation(ready, { ...request, mode: 'apply' }, transactionHash(f.input.content)), true);
  assert.equal((await f.command({ ...request, mode: 'apply' })).status, 409);
  const sceneSource = path.join(f.root, f.scenePath); assert.equal(transactionHash(await fs.readFile(sceneSource)), before[f.scenePath]);
});

test('browse host cannot offer creation context or execute the new author command', async t => {
  const f = await fixture(t, 'browse-server.mjs'), before = await fingerprint(f.root);
  assert.equal((await f.post()).status, 405); assert.equal((await f.command(f.input)).status, 405);
  const response = await fetch(f.base + '/api/capabilities'); if (response.ok) assert.notEqual((await payload(response)).scenePhysics2DCreation, true);
  assert.deepEqual(await fingerprint(f.root), before);
});
