import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { buildHash } from '../adapters/node-build-snapshot.mjs';
import { isLocalBuildRequest } from '../lib/doc-server-routes.mjs';

const source = fileURLToPath(new URL('../../', import.meta.url));
const route = '/api/project-build';
const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const godot = process.env.VIENTO_GODOT_BIN;
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

async function linuxChildren(parentPid) {
  const found = [];
  for (const name of await fs.readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = await fs.readFile(`/proc/${name}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (Number(fields[1]) !== parentPid || fields[0] === 'Z') continue;
      found.push({ pid: Number(name), argv: (await fs.readFile(`/proc/${name}/cmdline`, 'utf8')).split('\0') });
    } catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error; }
  }
  return found;
}

async function harness(t, { mode = 'edit', env = {} } = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-build-http-'));
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
    return new Promise((resolve, reject) => {
      const req = httpRequest(base + pathname, {
        method: method || (payload === undefined && rawBody === undefined ? 'GET' : 'POST'),
        headers: { ...(payload === undefined && rawBody === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(cookie ? { Cookie: cookie } : {}), ...headers },
        signal: AbortSignal.timeout(15000),
      }, response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { text += chunk; });
        response.once('error', reject);
        response.once('end', () => {
          try {
            const body = JSON.parse(text);
            resolve({ status: response.statusCode, headers: new Headers(response.headers), data: body.data || body });
          } catch (error) { reject(error); }
        });
      });
      req.once('error', reject);
      req.end(payload !== undefined || rawBody !== undefined ? rawBody ?? JSON.stringify(payload) : undefined);
    });
  }
  async function settled(id) {
    return waitFor(async () => {
      const response = await request();
      assert.equal(response.status, 200);
      return response.data.job?.id === id && response.data.job.status !== 'running' ? response.data : null;
    }, `build job ${id}`, 60000);
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
  return { temporary, workspace, cache, child, base, request, settled, stop, before };
}

test('build HTTP local boundary uses the socket and exact local origin, never forwarded identities', () => {
  const local = { socket: { remoteAddress: '127.0.0.1', localPort: 4173 }, headers: { host: '127.0.0.1:4173' } };
  assert.equal(isLocalBuildRequest(local), true);
  for (const remoteAddress of ['::1', '::ffff:127.0.0.1']) {
    assert.equal(isLocalBuildRequest({ ...local, socket: { ...local.socket, remoteAddress } }), true);
  }
  for (const host of ['localhost:4173', '[::1]:4173']) {
    assert.equal(isLocalBuildRequest({ ...local, headers: { host, origin: `http://${host}` } }), true);
  }
  for (const request of [
    { ...local, socket: { ...local.socket, remoteAddress: '192.0.2.7' }, headers: { ...local.headers, 'x-forwarded-for': '127.0.0.1' } },
    { ...local, socket: undefined },
    ...['example.org:4173', '127.0.0.1:4174', 'localhost', 'user@127.0.0.1:4173'].map(host => ({ ...local, headers: { host } })),
    ...['https://example.org', 'null', 'http://127.0.0.1:4174'].map(origin => ({ ...local, headers: { ...local.headers, origin } })),
    { ...local, headers: { ...local.headers, 'sec-fetch-site': 'cross-site' } },
  ]) assert.equal(isLocalBuildRequest(request), false, JSON.stringify(request));
});

test('build HTTP requires write auth and JSON, rejects untrusted origins and unknown inputs without starting jobs', {
  skip: process.platform !== 'linux', timeout: 45000,
}, async t => {
  const h = await harness(t, { env: { DOC_API_TOKEN: 'build-test-token', DOC_API_REQUIRE_WRITE_AUTH: '1' } });
  const authorized = { Authorization: 'Bearer build-test-token' };
  const initial = await h.request();
  assert.equal(initial.status, 200); assert.match(initial.headers.get('cache-control'), /(?:^|,\s*)no-store(?:,|$)/);
  assert.equal(initial.data.available, false); assert.equal(initial.data.job, null);
  assert.deepEqual(initial.data.scenes.map(scene => scene.id), [sceneId]);
  assert.ok(!JSON.stringify(initial.data).includes(h.temporary), 'host paths are not exposed in discovery');
  for (const action of ['plan', 'build', 'run', 'cancel']) {
    assert.equal((await h.request({ action, sceneId })).status, 401, action);
    assert.equal((await h.request({ action, sceneId }, { headers: { Authorization: 'Bearer wrong' } })).status, 403, action);
  }
  const notJson = await h.request({ action: 'plan', sceneId }, { headers: { ...authorized, 'Content-Type': 'text/plain' } });
  assert.equal(notJson.status, 415);
  for (const headers of [
    { Host: 'example.org' }, { Host: '127.0.0.1:1' }, { Origin: 'https://example.org' },
    { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' },
  ]) {
    for (const payload of [undefined, { action: 'plan', sceneId }]) {
      const response = await h.request(payload, { headers: { ...authorized, ...headers } });
      assert.equal(response.status, 403, JSON.stringify(headers));
      assert.equal(response.data.errorCode, 'build_local_only');
    }
  }
  for (const payload of [
    null, [], {}, { action: 'execute' }, { action: 'plan', sceneId: '../scene.json' },
    { action: 'plan', sceneId, godot: '/usr/bin/false' },
    { action: 'build', sceneId, output: path.join(h.temporary, 'unwanted') },
    { action: 'run', buildId: sceneId, mode: 'headless', buildDirectory: '/tmp' },
    { action: 'cancel', jobId: sceneId, timeoutMs: 1 },
  ]) {
    const response = await h.request(payload, { headers: authorized });
    assert.equal(response.status, 400, JSON.stringify(payload));
    assert.equal(response.data.errorCode, 'build_request_invalid');
  }
  assert.equal((await h.request(undefined, { headers: authorized, rawBody: '{broken' })).status, 400);
  for (const query of ['?root=/tmp', '?refresh=0', '?refresh=1&refresh=1']) {
    assert.equal((await h.request(undefined, { pathname: route + query })).status, 400, query);
  }
  assert.equal((await h.request(undefined, { method: 'DELETE', headers: authorized })).status, 405);
  assert.equal((await h.request()).data.job, null);
  await assert.rejects(fs.stat(path.join(h.temporary, 'unwanted')), { code: 'ENOENT' });
  assert.deepEqual(await authorBytes(h.workspace), h.before);

  const plan = await h.request({ action: 'plan', sceneId }, { headers: { ...authorized, Origin: h.base } });
  assert.equal(plan.status, 200);
  const complete = await h.settled(plan.data.job.id);
  assert.equal(complete.job.status, 'succeeded', JSON.stringify(complete));
  assert.match(complete.job.plan.snapshotId, /^sha256:/);
  const missingTool = await h.request({ action: 'build', sceneId }, { headers: authorized });
  assert.equal(missingTool.status, 422); assert.equal(missingTool.data.errorCode, 'build_tool_required');
  assert.deepEqual(await files(h.cache), []);
  assert.deepEqual(await authorBytes(h.workspace), h.before);
});

test('browse service does not publish a build endpoint and a remote-bound edit host disables execution', {
  skip: process.platform !== 'linux', timeout: 45000,
}, async t => {
  const browse = await harness(t, { mode: 'browse' });
  for (const payload of [undefined, { action: 'plan', sceneId }, { action: 'build', sceneId }]) {
    assert.equal((await browse.request(payload)).status, payload === undefined ? 404 : 405);
  }
  assert.deepEqual(await files(browse.cache), []);
  const remote = await harness(t, { env: { DOC_API_HOST: '0.0.0.0', DOC_API_TRUST_PROXY: '1' } });
  const capabilities = await remote.request(undefined, { pathname: '/api/capabilities' });
  assert.equal(capabilities.data.projectBuild, false);
  const status = await remote.request();
  assert.equal(status.data.supported, false); assert.equal(status.data.available, false);
  const rejected = await remote.request({ action: 'plan', sceneId }, { headers: { 'X-Forwarded-For': '127.0.0.1' } });
  assert.equal(rejected.status, 403); assert.equal(rejected.data.errorCode, 'build_platform_unsupported');
  assert.deepEqual(await files(remote.cache), []);
});

for (const mode of ['edit', 'desktop']) test(`real Godot HTTP: ${mode === 'desktop' ? 'owner EOF' : 'SIGTERM'} cancels and reaps an active runtime before the server exits`, {
  skip: process.platform !== 'linux' || !godot ? 'Set VIENTO_GODOT_BIN on Linux to run the real HTTP lifecycle integration' : false,
  timeout: 120000,
}, async t => {
  const h = await harness(t, { mode, env: { VIENTO_GODOT_BIN: godot } });
  const planned = await h.request({ action: 'plan', sceneId });
  assert.equal(planned.status, 200);
  const plan = await h.settled(planned.data.job.id);
  assert.equal(plan.job.status, 'succeeded');
  const built = await h.request({ action: 'build', sceneId, expectedSnapshotId: plan.job.plan.snapshotId });
  assert.equal(built.status, 200);
  const complete = await h.settled(built.data.job.id);
  assert.equal(complete.job.status, 'succeeded', JSON.stringify(complete));
  assert.equal(complete.latestBuild.sceneId, sceneId);
  assert.ok(!JSON.stringify(complete.latestBuild).includes(h.temporary));
  const buildId = complete.latestBuild.id;
  const running = await h.request({ action: 'run', buildId, mode: 'headless' });
  assert.equal(running.status, 200);
  const ran = await h.settled(running.data.job.id);
  assert.equal(ran.job.status, 'succeeded', JSON.stringify(ran));
  assert.deepEqual(ran.job.events.filter(event => event.event === 'state').map(event => event.state), ['moving', 'idle']);
  for (let repeat = 0; repeat < 2; repeat++) {
    const cancelledFinished = await h.request({ action: 'cancel', jobId: ran.job.id });
    assert.equal(cancelledFinished.status, 200);
    assert.equal(cancelledFinished.data.job.status, 'succeeded', 'cancelling a finished task is harmless and idempotent');
  }
  const initialSessions = (await files(h.cache)).filter(file => path.basename(file) === 'session.json');
  assert.equal(initialSessions.length, 1);
  await assert.rejects(fs.stat(path.join(path.dirname(initialSessions[0]), 'project')), { code: 'ENOENT' });

  const second = await h.request({ action: 'run', buildId, mode: 'headless' });
  assert.equal(second.status, 200);
  const busy = await h.request({ action: 'plan', sceneId });
  assert.equal(busy.status, 409); assert.equal(busy.data.errorCode, 'build_busy');
  const wrongTask = await h.request({ action: 'cancel', jobId: sceneId });
  assert.equal(wrongTask.status, 404); assert.equal(wrongTask.data.errorCode, 'build_job_missing');
  // Observe the actual native child and session path before closing its owner.
  // The import phase is deliberately sufficient: this verifies cancellation of
  // a live engine process without needing a display or racing the short smoke.
  const native = await waitFor(async () => {
    const children = await linuxChildren(h.child.pid);
    return children.find(child => child.argv.some(arg => arg.startsWith(h.cache + path.sep) && arg.includes(`${path.sep}sessions${path.sep}`)));
  }, `active ${mode} Godot runtime process`);
  const project = native.argv.find(arg => arg.startsWith(h.cache + path.sep) && arg.endsWith(`${path.sep}project`));
  assert.ok(project, JSON.stringify(native));
  const sessionFile = path.join(path.dirname(project), 'session.json');
  assert.ok(!initialSessions.includes(sessionFile));
  const activeSession = JSON.parse(await fs.readFile(sessionFile));
  assert.equal(activeSession.status, 'starting');
  await h.stop();
  assert.throws(() => process.kill(native.pid, 0), { code: 'ESRCH' }, 'Godot must be reaped before its owning service exits');
  const stopped = JSON.parse(await fs.readFile(sessionFile));
  assert.equal(stopped.status, 'cancelled', JSON.stringify(stopped));
  assert.ok(stopped.phases.some(phase => phase.status === 'cancelled'));
  await assert.rejects(fs.stat(project), { code: 'ENOENT' });
  assert.deepEqual(await authorBytes(h.workspace), h.before);
});
