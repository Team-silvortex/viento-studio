import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './helpers.mjs';
const appRoot = fileURLToPath(new URL('../../', import.meta.url)), route = '/api/scene-composition-create';
async function fixture(t, script = 'doc-site-server.mjs') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viento-composition-create-http-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(new URL('../../examples/scene-behaviors/', import.meta.url), root, { recursive: true });
  const base = await serve(t, appRoot, { VIENTO_APP_ROOT: appRoot, VIENTO_WORKSPACE_ROOT: root, DOC_API_TOKEN: 'writer', DOC_API_REQUIRE_WRITE_AUTH: '1' }, script);
  return { root, base };
}
test('read-only creation catalog uses GET and no-store without a backend probe or write token', async t => {
  const f = await fixture(t), response = await fetch(f.base + route); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  const body = await response.json(), value = body.data || body; assert.equal(value.format, 'viento-scene-composition-create-context'); assert.ok(value.objects.length);
  assert.equal(JSON.stringify(value).includes(f.root), false); assert.equal(Object.hasOwn(value, 'backend'), false);
  assert.equal((await fetch(f.base + route + '?path=documents/a.md')).status, 400);
  assert.equal((await fetch(f.base + route, { method: 'POST', headers: { Authorization: 'Bearer writer' }, body: '{}' })).status, 405);
});
test('read-only browse host does not expose the author creation catalog', async t => {
  const f = await fixture(t, 'browse-server.mjs'), response = await fetch(f.base + route); assert.equal(response.status, 404);
});
