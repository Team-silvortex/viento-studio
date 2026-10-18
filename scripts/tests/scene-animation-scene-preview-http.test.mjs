import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { serve } from './helpers.mjs';
import { createDocumentService } from '../lib/doc-api-service.mjs';
import { animationPreviewFixture, fingerprint, sceneId, imageId, animationPath, recordPath, revision } from './helpers/scene-animation-scene-preview-fixture.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url)), route = '/api/scene-preview';
const token = 'animation-scene-preview-test-token';
const responseBody = async response => { const body = await response.json(); return body.data || body; };
const environment = f => ({ VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: f.root, VIENTO_GODOT_BIN: path.join(f.directory, 'no-native-engine'),
  VIENTO_PREFERENCES_PATH: path.join(f.directory, 'preferences.json'), XDG_CACHE_HOME: path.join(f.directory, 'cache'),
  XDG_CONFIG_HOME: path.join(f.directory, 'config'), XDG_DATA_HOME: path.join(f.directory, 'data'),
  DOC_API_TOKEN: token, DOC_API_REQUIRE_WRITE_AUTH: '1', DOC_API_MAX_BODY_BYTES: '262144' });
async function fixture(t, script = 'doc-site-server.mjs') {
  const f = await animationPreviewFixture(t), base = await serve(t, appRoot, environment(f), script);
  const post = (payload = { sceneId, includeAnimation: true }, { auth = token, suffix = '', headers = {}, raw } = {}) => fetch(base + route + suffix, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...headers },
    body: raw ?? JSON.stringify(payload),
  });
  return { ...f, base, post };
}

test('scene animation preview capability follows the host geometry-preview switch without native engine discovery', async () => {
  for (const projectBuildEnabled of [false, true]) {
    const service = createDocumentService({ projectBuildEnabled });
    try {
      const capabilities = await service.getCapabilities();
      assert.equal(capabilities.sceneAnimationPreview, projectBuildEnabled); assert.equal(capabilities.scenePreview, projectBuildEnabled);
      if (!projectBuildEnabled) await assert.rejects(service.scenePreview.create({ sceneId, includeAnimation: true }), { errorCode: 'scene_preview_unavailable' });
    } finally { await Promise.all([service.scenePreview.close(), service.projectBuild.close()]); }
  }
});

test('authenticated saved animation capture serves frozen image leases and leaves authored files unchanged', { skip: process.platform !== 'linux' }, async t => {
  const f = await fixture(t), before = await fingerprint(f.root, { authorOnly: true });
  const capabilities = await responseBody(await fetch(f.base + '/api/capabilities'));
  assert.equal(capabilities.scenePreview, true); assert.equal(capabilities.sceneAnimationPreview, true);
  const response = await f.post(); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  const result = await responseBody(response); assert.equal(result.ok, true); assert.equal(result.animationPreview.status, 'ready');
  assert.equal(result.animationPreview.snapshotId, result.snapshotId); assert.equal(result.animationPreview.manifest.sourceRevision, revision(await f.read(animationPath)));
  assert.equal(result.resources.length, 1); assert.equal(JSON.stringify(result).includes(f.directory), false);
  const image = await fetch(f.base + result.resources[0].url); assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/svg+xml'); assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  assert.match(image.headers.get('content-security-policy'), /sandbox/); assert.match(image.headers.get('cache-control'), /no-store/);
  assert.equal(revision(Buffer.from(await image.arrayBuffer())), `sha256:${result.resources[0].sha256}`);
  const deleted = await fetch(f.base + route + '?previewId=' + result.previewId, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: f.base } });
  assert.equal(deleted.status, 200); assert.deepEqual(await responseBody(deleted), { released: true });
  assert.equal((await fetch(f.base + result.resources[0].url)).status, 404);
  const old = await responseBody(await f.post({ sceneId })); assert.equal(Object.hasOwn(old, 'animationPreview'), false);
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), before);
});

test('optional animation request retains author authentication, same-origin and bounded JSON protections', { skip: process.platform !== 'linux' }, async t => {
  const f = await fixture(t), before = await fingerprint(f.root, { authorOnly: true });
  assert.equal((await f.post(undefined, { auth: '' })).status, 401); assert.equal((await f.post(undefined, { auth: 'wrong' })).status, 403);
  for (const includeAnimation of [false, null, 'true', 1, {}, []]) assert.equal((await f.post({ sceneId, includeAnimation })).status, 400);
  for (const value of [{ sceneId, includeAnimation: true, draft: {} }, { sceneId, includeAnimation: true, path: '/tmp/private' }, [], null])
    assert.equal((await f.post(value)).status, 400);
  assert.equal((await f.post(undefined, { raw: '{invalid' })).status, 400);
  assert.equal((await f.post(undefined, { suffix: '?root=/tmp' })).status, 400);
  assert.equal((await f.post(undefined, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await f.post({ sceneId: 'x'.repeat(262145), includeAnimation: true })).status, 413);
  for (const headers of [{ Origin: 'https://foreign.invalid' }, { Origin: 'null' }, { Origin: f.base, 'Sec-Fetch-Site': 'cross-site' }])
    assert.equal((await f.post(undefined, { headers })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ sceneId, includeAnimation: true });
    const request = httpRequest(f.base + route, { method: 'POST', headers: { Host: 'foreign.invalid', Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); });
    request.once('error', reject); request.end(body);
  });
  assert.equal(foreignHostStatus, 403);
  const accepted = await f.post(undefined, { headers: { Origin: f.base, 'Sec-Fetch-Site': 'same-origin' } }); assert.equal(accepted.status, 200);
  const preview = await responseBody(accepted);
  assert.equal((await fetch(f.base + preview.resources[0].url, { headers: { Origin: 'https://foreign.invalid' } })).status, 403);
  assert.equal((await fetch(f.base + route + '?previewId=' + preview.previewId, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })).status, 401);
  assert.equal((await fetch(f.base + preview.resources[0].url)).status, 200);
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), before);
});

test('HTTP exposes independent animation states while static geometry and author bytes remain available', { skip: process.platform !== 'linux' }, async t => {
  const f = await fixture(t);
  await f.write(animationPath, '{broken author animation');
  let before = await fingerprint(f.root, { authorOnly: true }), response = await f.post(); assert.equal(response.status, 200);
  const invalid = await responseBody(response); assert.equal(invalid.ok, true); assert.equal(invalid.animationPreview.status, 'invalid');
  assert.deepEqual(invalid.diagnostics, []); assert.equal(invalid.animationPreview.document, null); assert.ok(invalid.animationPreview.diagnostics.length);
  assert.equal((await fetch(f.base + invalid.resources[0].url)).status, 200); assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), before);
  await f.edit(recordPath, value => { value.relations = value.relations.filter(relation => relation.kind !== 'animation'); });
  before = await fingerprint(f.root, { authorOnly: true }); response = await f.post(); assert.equal(response.status, 200);
  const none = await responseBody(response); assert.equal(none.ok, true); assert.equal(none.animationPreview.status, 'none');
  assert.equal(none.animationPreview.document, null); assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), before);
});

test('read-only browse server cannot allocate animation preview leases', async t => {
  const f = await fixture(t, 'browse-server.mjs'), before = await fingerprint(f.root, { authorOnly: true });
  assert.equal((await f.post()).status, 405);
  const capabilities = await fetch(f.base + '/api/capabilities');
  if (capabilities.ok) assert.notEqual((await responseBody(capabilities)).sceneAnimationPreview, true);
  assert.equal((await fetch(`${f.base}${route}?previewId=${sceneId}&resourceId=${imageId}`)).status, 404);
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), before);
});

test('desktop animation capture remains behind its session cookie and same-origin boundary', { skip: process.platform !== 'linux', timeout: 30000 }, async t => {
  const f = await animationPreviewFixture(t), sessionToken = 'b'.repeat(32);
  const child = spawn(process.execPath, ['scripts/desktop-server.mjs', '--port', '0'], { cwd: appRoot,
    env: { ...process.env, ...environment(f), VIENTO_SESSION_TOKEN: sessionToken, DOC_API_TOKEN: '', DOC_API_REQUIRE_WRITE_AUTH: '0',
      DOC_API_WRITE_TOKEN: '', DOC_API_HOST: '127.0.0.1', DOC_API_SECURITY_AUDIT: '0', PORT: '0' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end(); const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(timer); }
  });
  const base = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(Error(`Desktop start timed out: ${output}`)), 15000);
    const failure = error => { clearTimeout(timer); reject(error); };
    child.once('error', failure); child.once('exit', () => failure(Error(`Desktop exited: ${output}`)));
    const read = chunk => { output += chunk; const match = output.match(/Doc viewer running at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); } };
    child.stdout.on('data', read); child.stderr.on('data', read);
  });
  const before = await fingerprint(f.root, { authorOnly: true });
  const post = headers => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ sceneId, includeAnimation: true }) });
  assert.equal((await post({})).status, 401);
  const handshake = await fetch(`${base}/__desktop/session/${sessionToken}`, { redirect: 'manual' }); assert.equal(handshake.status, 302);
  const Cookie = handshake.headers.get('set-cookie').split(';')[0];
  assert.equal((await post({ Cookie, Origin: 'https://foreign.invalid' })).status, 403);
  const response = await post({ Cookie, Origin: base }); assert.equal(response.status, 200); const result = await responseBody(response);
  assert.equal(result.animationPreview.status, 'ready'); assert.equal((await fetch(base + result.resources[0].url)).status, 401);
  assert.equal((await fetch(base + result.resources[0].url, { headers: { Cookie } })).status, 200);
  assert.deepEqual(await fingerprint(f.root, { authorOnly: true }), before);
});
