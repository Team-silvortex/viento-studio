import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { handleApiRequest } from '../lib/doc-server-routes.mjs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { buildHash } from '../adapters/node-build-snapshot.mjs';

const source = fileURLToPath(new URL('../../', import.meta.url));
const route = '/api/scene-preview';
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const sessionToken = 'b'.repeat(32);

async function waitFor(check, description, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function files(root) {
  try {
    return (await fs.readdir(root, { recursive: true, withFileTypes: true }))
      .filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath || entry.path, entry.name));
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function authorBytes(root) {
  const entries = await files(root), result = {};
  for (const file of entries) {
    const relative = path.relative(root, file);
    // Native startup legitimately maintains session/index state; authored
    // workspace, metadata, templates and assets must remain byte-identical.
    if (relative.split(path.sep)[0] === '.viento') continue;
    result[relative] = buildHash(await fs.readFile(file));
  }
  return result;
}

async function harness(t, { mode = 'edit', env = {} } = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-scene-preview-http-'));
  const application = path.join(temporary, 'application');
  const workspace = path.join(temporary, 'workspace');
  const cache = path.join(temporary, 'cache');
  let child, exited, output = '';
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const forced = setTimeout(() => child.kill('SIGKILL'), 4000);
      try { await exited; } finally { clearTimeout(forced); }
    }
    await fs.rm(temporary, { recursive: true, force: true });
  });
  await fs.mkdir(application);
  for (const name of ['engine', 'scripts', 'web']) {
    await fs.cp(path.join(source, name), path.join(application, name), {
      recursive: true,
      filter: file => file !== path.join(source, 'scripts/tests') && file !== path.join(source, 'web/data'),
    });
  }
  await fs.copyFile(path.join(source, 'package.json'), path.join(application, 'package.json'));
  await fs.symlink(path.join(source, 'node_modules'), path.join(application, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await fs.cp(path.join(source, 'examples/scene2d'), workspace, { recursive: true });
  const before = await authorBytes(workspace);
  const script = { edit: 'doc-site-server.mjs', browse: 'browse-server.mjs', desktop: 'desktop-server.mjs' }[mode];
  child = spawn(process.execPath, [path.join(application, 'scripts', script), '--port', '0'], {
    cwd: workspace,
    env: { ...process.env, VIENTO_APP_ROOT: application, VIENTO_WORKSPACE_ROOT: workspace,
      VIENTO_SESSION_TOKEN: mode === 'desktop' ? sessionToken : '', VIENTO_PREFERENCES_PATH: '',
      VIENTO_GODOT_BIN: '', XDG_CACHE_HOME: cache, XDG_CONFIG_HOME: path.join(temporary, 'config'),
      XDG_DATA_HOME: path.join(temporary, 'data'), PORT: '0', DOC_API_HOST: '127.0.0.1',
      DOC_API_TOKEN: '', DOC_API_WRITE_TOKEN: '', DOC_API_REQUIRE_WRITE_AUTH: '0',
      DOC_API_TRUST_PROXY: '0', DOC_API_SECURITY_AUDIT: '0', DOC_API_RATE_LIMIT_MAX_REQUESTS: '10000', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  let spawnError;
  child.once('error', error => { spawnError = error; });
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const port = await waitFor(() => {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Server exited: ${output}`);
    return output.match(/(?:Doc viewer|Read-only viewer) running at http:\/\/(?:127\.0\.0\.1|0\.0\.0\.0):(\d+)/)?.[1];
  }, `server startup (${mode})`);
  const base = `http://127.0.0.1:${port}`;
  let cookie;
  if (mode === 'desktop') {
    assert.equal((await fetch(base + route)).status, 401);
    const handshake = await fetch(`${base}/__desktop/session/${sessionToken}`, { redirect: 'manual' });
    assert.equal(handshake.status, 302);
    cookie = handshake.headers.get('set-cookie').split(';')[0];
  }
  async function request(payload, { pathname = route, headers = {}, method, rawBody } = {}) {
    // Fetch may normalize or replace Host. Send exact HTTP headers so the
    // DNS-rebinding and cross-origin regressions exercise the actual server.
    const body = payload !== undefined || rawBody !== undefined ? rawBody ?? JSON.stringify(payload) : undefined;
    return new Promise((resolve, reject) => {
      const req = httpRequest(base + pathname, {
        method: method || (payload === undefined && rawBody === undefined ? 'GET' : 'POST'),
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }),
          ...(cookie ? { Cookie: cookie } : {}), ...headers },
        signal: AbortSignal.timeout(15000),
      }, response => {
        const chunks = [];
        response.on('data', chunk => { chunks.push(chunk); });
        response.once('error', reject);
        response.once('end', () => {
          try {
            const bytes = Buffer.concat(chunks);
            if (response.headers['content-type']?.startsWith('image/')) {
              resolve({ status: response.statusCode, headers: new Headers(response.headers), bytes }); return;
            }
            const body = JSON.parse(bytes.toString());
            resolve({ status: response.statusCode, headers: new Headers(response.headers), data: body.data || body });
          } catch (error) { reject(error); }
        });
      });
      req.once('error', reject);
      req.end(body);
    });
  }
  async function stop() {
    if (mode === 'desktop') child.stdin.end(); else child.kill('SIGTERM');
    let timer;
    try {
      const result = await Promise.race([exited, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Server did not stop: ${output}`)), 5000);
      })]);
      assert.equal(result.code, 0, output);
      assert.equal(result.signal, null, output);
    } finally { clearTimeout(timer); }
  }
  return { temporary, workspace, cache, child, base, request, stop, before };
}

test('scene preview HTTP requires local write auth and strict JSON requests without starting native jobs', {
  skip: process.platform !== 'linux', timeout: 45000,
}, async t => {
  const h = await harness(t, { env: { DOC_API_TOKEN: 'preview-test-token', DOC_API_REQUIRE_WRITE_AUTH: '1' } });
  const authorized = { Authorization: 'Bearer preview-test-token' };
  const application = await fetch(h.base), policy = application.headers.get('content-security-policy');
  assert.match(policy, /(?:^|; )img-src 'self' data: blob:(?:;|$)/);
  assert.match(policy, /(?:^|; )script-src 'self'(?:;|$)/);
  assert.match(policy, /(?:^|; )connect-src 'self'(?:;|$)/);
  assert.equal((await h.request(undefined, { pathname: '/api/capabilities' })).data.scenePreview, true);
  assert.equal((await h.request({ sceneId })).status, 401);
  assert.equal((await h.request({ sceneId }, { headers: { Authorization: 'Bearer wrong' } })).status, 403);
  assert.equal((await h.request({ sceneId }, { headers: { ...authorized, 'Content-Type': 'text/plain' } })).status, 415);
  for (const payload of [null, [], {}, { sceneId, root: '/tmp' }, { sceneId: '../scene.json' }, { action: 'capture', sceneId }]) {
    const result = await h.request(payload, { headers: authorized });
    assert.equal(result.status, 400); assert.equal(result.data.errorCode, 'scene_preview_request_invalid');
  }
  for (const headers of [{ Host: 'example.org' }, { Host: '127.0.0.1:1' }, { Origin: 'https://example.org' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const result = await h.request({ sceneId }, { headers: { ...authorized, ...headers } });
    assert.equal(result.status, 403); assert.equal(result.data.errorCode, 'scene_preview_local_only');
  }
  assert.equal((await h.request(undefined, { rawBody: '{broken', headers: authorized })).status, 400);
  assert.equal((await h.request({ sceneId }, { pathname: route + '?root=/tmp', headers: authorized })).status, 400);
  assert.equal((await h.request(undefined, { method: 'PUT', headers: authorized })).status, 405);
  const captured = await h.request({ sceneId }, { headers: authorized });
  assert.equal(captured.status, 200); assert.equal(captured.data.ok, true); assert.match(captured.headers.get('cache-control'), /no-store/);
  assert.ok(!JSON.stringify(captured.data).includes(h.temporary)); assert.equal(captured.data.scene.objectId, sceneId);
  const preview = captured.data, image = preview.resources[0];
  const bytes = await h.request(undefined, { pathname: image.url });
  assert.equal(bytes.status, 200); assert.equal(bytes.headers.get('content-type'), 'image/svg+xml');
  assert.equal(bytes.headers.get('x-content-type-options'), 'nosniff');
  assert.match(bytes.headers.get('content-security-policy'), /sandbox/); assert.match(bytes.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(bytes.headers.get('cache-control'), /no-store/);
  assert.equal(buildHash(bytes.bytes), image.sha256); assert.equal(bytes.bytes.length, image.size);
  for (const headers of [{ Host: 'example.org' }, { Origin: 'https://example.org' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await h.request(undefined, { pathname: image.url, headers })).status, 403);
  }
  for (const pathname of [route, image.url + '&resourceId=' + image.id, image.url + '&path=/tmp', route + '?previewId=../bad&resourceId=' + image.id]) {
    assert.equal((await h.request(undefined, { pathname })).status, 400, pathname);
  }
  const missing = await h.request(undefined, { pathname: `${route}?previewId=${sceneId}&resourceId=${image.id}` });
  assert.equal(missing.status, 404); assert.equal(missing.data.errorCode, 'scene_preview_expired');
  const releaseUrl = `${route}?previewId=${preview.previewId}`;
  assert.equal((await h.request({}, { method: 'DELETE', pathname: releaseUrl })).status, 401);
  assert.equal((await h.request({}, { method: 'DELETE', pathname: releaseUrl, headers: { Authorization: 'Bearer wrong' } })).status, 403);
  assert.equal((await h.request({}, { method: 'DELETE', pathname: releaseUrl, headers: { ...authorized, Origin: 'https://example.org' } })).status, 403);
  assert.equal((await h.request({}, { method: 'DELETE', pathname: releaseUrl + '&root=/tmp', headers: authorized })).status, 400);
  const released = await h.request({}, { method: 'DELETE', pathname: releaseUrl, headers: authorized });
  assert.equal(released.status, 200); assert.equal(released.data.released, true);
  assert.equal((await h.request(undefined, { pathname: image.url })).status, 404);
  assert.equal((await h.request({}, { method: 'DELETE', pathname: releaseUrl, headers: authorized })).data.released, false);
  assert.equal((await h.request(undefined, { pathname: '/api/project-build' })).data.job, null);
  assert.deepEqual(await files(h.cache), []); assert.deepEqual(await authorBytes(h.workspace), h.before);
});

test('scene preview HTTP serves immutable bytes after file edits and keeps previous preview on failure', {
  skip: process.platform !== 'linux', timeout: 45000,
}, async t => {
  const h = await harness(t), captured = await h.request({ sceneId }), image = captured.data.resources[0];
  const bytes = await h.request(undefined, { pathname: image.url });
  await fs.writeFile(path.join(h.workspace, 'assets/traveler.svg'), '<svg>new live content</svg>');
  assert.deepEqual((await h.request(undefined, { pathname: image.url })).bytes, bytes.bytes);
  const mismatch = await h.request({ sceneId }); assert.equal(mismatch.status, 200); assert.equal(mismatch.data.ok, false);
  assert.equal(mismatch.data.diagnostics[0].code, 'build_resource_changed');
  assert.deepEqual((await h.request(undefined, { pathname: image.url })).bytes, bytes.bytes);
  await fs.writeFile(path.join(h.workspace, 'documents/scenes/demo.json'), '{broken');
  const invalid = await h.request({ sceneId }); assert.equal(invalid.data.ok, false);
  assert.equal(invalid.data.diagnostics[0].code, 'build_scene_json');
  assert.deepEqual(await files(h.cache), []);
});

test('scene preview HTTP is absent from browse mode and disabled for remote-bound edit hosts', {
  skip: process.platform !== 'linux', timeout: 45000,
}, async t => {
  const browse = await harness(t, { mode: 'browse' });
  assert.equal((await browse.request()).status, 404); assert.equal((await browse.request({ sceneId })).status, 405);
  const remote = await harness(t, { env: { DOC_API_HOST: '0.0.0.0' } });
  assert.equal((await remote.request(undefined, { pathname: '/api/capabilities' })).data.scenePreview, false);
  const response = await remote.request({ sceneId }); assert.equal(response.status, 403); assert.equal(response.data.errorCode, 'scene_preview_unavailable');
  assert.deepEqual(await files(remote.cache), []);
});

test('desktop scene preview requires a session and exits cleanly with frozen images retained', {
  skip: process.platform !== 'linux', timeout: 45000,
}, async t => {
  const h = await harness(t, { mode: 'desktop' }), captured = await h.request({ sceneId });
  assert.equal(captured.status, 200); assert.equal(captured.data.ok, true);
  const image = captured.data.resources[0];
  assert.equal((await fetch(h.base + image.url)).status, 401);
  assert.equal((await h.request(undefined, { pathname: image.url })).status, 200);
  await h.stop(); assert.deepEqual(await authorBytes(h.workspace), h.before);
});

test('closing the HTTP connection aborts preview capture without a late response or unhandled rejection', async t => {
  let started, aborted, requestResult, endedAfterAbort = false;
  const entered = new Promise(resolve => { started = resolve; });
  const cancelled = new Promise(resolve => { aborted = resolve; });
  const service = { scenePreview: { create: async (_payload, { signal }) => {
    started();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => {
      aborted(); reject(Object.assign(new Error('Cancelled'), { statusCode: 409, errorCode: 'scene_preview_superseded' }));
    }, { once: true }));
  } } };
  const server = createServer((request, response) => {
    const end = response.end.bind(response);
    response.end = (...args) => { endedAfterAbort ||= response.destroyed; return end(...args); };
    requestResult = handleApiRequest({ pathname: route, request, response,
      requestUrl: new URL(request.url, `http://${request.headers.host}`), service });
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const body = JSON.stringify({ sceneId });
  const request = httpRequest(`http://127.0.0.1:${server.address().port}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  const disconnected = new Promise(resolve => request.once('error', resolve));
  request.end(body); await entered; request.destroy(); await disconnected; await cancelled;
  assert.equal(await requestResult, true); assert.equal(endedAfterAbort, false);
});
