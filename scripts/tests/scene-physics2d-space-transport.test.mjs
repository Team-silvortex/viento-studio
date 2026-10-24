import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const apiPath = '/api/scene-physics2d-space';

test('physics2d space transport uses its own read endpoint and keeps the sanitized token out of the body', async () => {
  const source = (await fs.readFile(new URL('../../web/modules/app-doc-service.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '').replaceAll('export ', '');
  const calls = [], result = { format: 'viento-scene-physics2d-space' }; let token = ' secret\r\n-token ';
  const storage = { getItem(key) { assert.equal(key, 'doc-api-token'); return token; } };
  const context = vm.createContext({ window: { localStorage: storage }, localStorage: storage, SCENE_PHYSICS2D_SPACE_API_PATH: apiPath, t: key => key,
    fetchJsonApiRequest: async (...args) => { calls.push(args); return { payload: result }; } });
  vm.runInContext(source, context);
  const payload = { sceneObjectId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
  assert.equal(await context.inspectScenePhysics2DSpace(payload), result);
  assert.equal(calls[0][0], apiPath); assert.equal(calls[0][1].method, 'POST'); assert.equal(calls[0][1].headers.Authorization, 'Bearer secret-token');
  assert.equal(calls[0][1].headers['Content-Type'], 'application/json'); assert.deepEqual(JSON.parse(calls[0][1].body), payload);
  assert.equal(calls[0][2], 45000); assert.equal(calls[0][3], '读取场景空间'); assert.ok(!calls[0][1].body.includes('secret-token'));
  token = ''; await context.inspectScenePhysics2DSpace(payload); assert.equal(calls[1][1].headers.Authorization, undefined);
});
