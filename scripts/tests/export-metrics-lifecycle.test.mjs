import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { registerWorkspace } from '../lib/workspace.mjs';
import { PROJECT_DEFAULTS } from '../lib/project-layout.mjs';
import { createExportService } from '../lib/export-service.mjs';
import { createApiMetrics } from '../lib/doc-api-metrics.mjs';
import { handleApiRequest } from '../lib/doc-server-routes.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const exportRoute = 'GET /api/export';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-export-metrics-'));
  const documentPath = path.join(root, 'documents/character.md');
  const source = '\ufeff# Character\r\n\r\nOriginal author text.\r\n';
  let server, gate, job, exports;
  const pending = new Map(), serverErrors = [];
  t.after(async () => {
    gate?.release.resolve();
    if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await Promise.all([...pending.values()].map(item => item.promise));
    if (job) await exports.release(job.id);
    await fs.rm(root, { recursive: true, force: true });
  });
  for (const directory of ['documents', 'templates', 'assets']) await fs.mkdir(path.join(root, directory));
  await fs.writeFile(path.join(root, 'workspace.json'), JSON.stringify({
    format: 'viento-workspace', version: 3, id: randomUUID(), name: 'Export metrics lifecycle', createdAt: 0,
    paths: { documents: 'documents', templates: 'templates', metadata: 'metadata' },
    assetStores: { main: { path: 'assets' } }, documentTypes: PROJECT_DEFAULTS.documentTypes,
  }));
  await fs.writeFile(documentPath, source);
  await fs.writeFile(path.join(root, 'templates/character.md'), '# Character template\n');
  await registerWorkspace(root);
  exports = createExportService(root);
  job = await exports.create({ kind: 'document', format: 'html', path: 'documents/character.md' });
  const expected = await fs.readFile(exports.get(job.id).file);
  const metrics = createApiMetrics();
  const service = {
    exports: {
      ...exports,
      download(id, consume) {
        const held = gate;
        return exports.download(id, async item => {
          const result = await consume(item);
          // Client EOF precedes the enclosing handler's completion. Hold that
          // boundary explicitly, without replacing streaming or metrics logic.
          if (held) { held.ready.resolve(); await held.release.promise; }
          return result;
        });
      },
    },
    startRequest: metrics.startRequest,
    finishRequest: metrics.finishRequest,
    getRequestMetricsSnapshot: metrics.getSnapshot,
  };
  server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    const id = requestUrl.searchParams.get('testRequest');
    try {
      assert.equal(await handleApiRequest({ pathname: requestUrl.pathname, request, response, requestUrl, service }), true);
    } catch (error) {
      serverErrors.push(error);
      if (!response.headersSent) { response.statusCode = 500; response.end(); }
      else response.destroy();
    } finally { pending.get(id)?.resolve(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  let sequence = 0;
  function begin(pathname, headers = {}) {
    const id = String(++sequence), done = deferred();
    pending.set(id, done);
    const url = new URL(pathname, base); url.searchParams.set('testRequest', id);
    return { response: fetch(url, { headers }), done: done.promise.then(() => { pending.delete(id); }) };
  }
  async function snapshot() {
    const request = begin('/api/metrics');
    try {
      const response = await request.response;
      assert.equal(response.status, 200);
      return (await response.json()).data;
    } finally { await request.done; }
  }
  return {
    expected, url: '/api/export?id=' + job.id, begin, snapshot, serverErrors,
    hold() { gate = { ready: deferred(), release: deferred() }; return gate; },
    release() { gate.release.resolve(); gate = null; },
    async assertSourcePreserved() { assert.equal(await fs.readFile(documentPath, 'utf8'), source); },
  };
}

for (const [range, status] of [['bytes=0-7', 206], ['bytes=999999999-', 416]]) {
  test(`export ${status} metrics wait for handler cleanup after client EOF and retain full-download retry`, { timeout: 15000 }, async t => {
    const f = await fixture(t), gate = f.hold();
    const request = f.begin(f.url, { Range: range });
    const response = await request.response;
    assert.equal(response.status, status);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, status === 206 ? f.expected.subarray(0, 8) : Buffer.alloc(0));
    await gate.ready.promise;
    const during = await f.snapshot();
    assert.equal(Object.hasOwn(during.routes, exportRoute), false, 'a transmitted response is not a completed handler');
    assert.equal(during.activeRequests, 2, 'the blocked export and current metrics request are still active');
    assert.equal(during.statusCodes[String(status)], undefined);

    f.release();
    await request.done;
    const completed = await f.snapshot();
    assert.equal(completed.routes[exportRoute].count, 1);
    assert.equal(completed.routes[exportRoute].lastStatusCode, status);
    assert.equal(completed.routes[exportRoute].errorCount, status >= 400 ? 1 : 0);
    assert.equal(completed.statusCodes[String(status)], 1);
    assert.equal(completed.activeRequests, 1, 'only the current metrics request remains active');

    const retry = f.begin(f.url), full = await retry.response;
    assert.equal(full.status, 200);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), f.expected, 'the same export remains completely retryable');
    await retry.done;
    const afterRetry = await f.snapshot();
    assert.equal(afterRetry.routes[exportRoute].count, 2, 'each completed export request is counted exactly once');
    assert.equal(afterRetry.routes[exportRoute].lastStatusCode, 200);
    assert.equal(afterRetry.routes[exportRoute].errorCount, status >= 400 ? 1 : 0);
    assert.equal(afterRetry.statusCodes[String(status)], 1, 'retry cannot duplicate the earlier response metric');
    assert.equal(afterRetry.activeRequests, 1);
    assert.deepEqual(f.serverErrors, []);
    await f.assertSourcePreserved();
  });
}
