import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { editorHarness } from './editor-harness.mjs';
const apiPath = '/api/scene-animation-targets';

test('animation targets transport uses its own read endpoint and keeps the sanitized token out of the body', async () => {
  const source = (await fs.readFile(new URL('../../web/modules/app-doc-service.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '').replaceAll('export ', '');
  const calls = [], result = { format: 'viento-scene-animation-targets' }; let token = ' secret\r\n-token ';
  const storage = { getItem(key) { assert.equal(key, 'doc-api-token'); return token; } };
  const context = vm.createContext({ window: { localStorage: storage }, localStorage: storage, SCENE_ANIMATION_TARGETS_API_PATH: apiPath, t: key => key,
    fetchJsonApiRequest: async (...args) => { calls.push(args); return { payload: result }; } });
  vm.runInContext(source, context);
  const payload = { sceneObjectId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
  assert.equal(await context.inspectSceneAnimationTargets(payload), result);
  assert.equal(calls[0][0], apiPath); assert.equal(calls[0][1].method, 'POST'); assert.equal(calls[0][1].headers.Authorization, 'Bearer secret-token');
  assert.equal(calls[0][1].headers['Content-Type'], 'application/json'); assert.deepEqual(JSON.parse(calls[0][1].body), payload);
  assert.equal(calls[0][2], 45000); assert.equal(calls[0][3], '读取动画目标'); assert.ok(!calls[0][1].body.includes('secret-token'));
  token = ''; await context.inspectSceneAnimationTargets(payload); assert.equal(calls[1][1].headers.Authorization, undefined);
});

test('runtime gates target selection independently from core animation field editing and other author capabilities', async () => {
  let currentDetection, hostOptions, ports, coreAvailable = true;
  const stop = new Error('stop after capturing runtime ports'), requests = [];
  const sourceHost = { getContext() {}, getSource() {}, getTargets() {}, applyDraft() {} };
  const h = await editorHarness({
    detectEditBackendAvailability: async () => currentDetection,
    supportsStudioCoreSceneAnimation: () => coreAvailable,
    inspectSceneAnimationTargets: async payload => { requests.push(payload); return { targets: [] }; },
    createSceneAnimationSourceHost: options => { hostOptions = options; return sourceHost; },
    setupStudioSystem: async options => { ports = options.ports; throw stop; },
  });
  for (const [available, targets, expected] of [
    [true, true, true], [true, false, false], [true, undefined, false], [true, 'true', false], [false, true, false],
  ]) {
    currentDetection = { available, source: 'capabilities', payload: { sceneAnimationTargets: targets, sceneAudioUsage: true } };
    await h.runtime.detectEditBackend(); await assert.rejects(h.runtime.initApp(), error => error === stop);
    assert.equal(hostOptions.getState().targetsAvailable, expected);
    assert.equal(hostOptions.getState().available, true, 'optional capability does not gate ordinary animation field editing');
    assert.equal(ports.sceneAnimation, sourceHost);
    for (const name of ['getContext', 'getSource', 'getTargets', 'applyDraft']) assert.equal(ports.sceneAnimation[name], sourceHost[name]);
  }
  coreAvailable = false; currentDetection = { available: true, source: 'capabilities', payload: { sceneAnimationTargets: true } };
  await h.runtime.detectEditBackend(); await assert.rejects(h.runtime.initApp(), error => error === stop);
  assert.equal(hostOptions.getState().available, false); assert.equal(hostOptions.getState().targetsAvailable, true);
  const request = { sceneObjectId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
  assert.deepEqual(await hostOptions.inspectTargets(request), { targets: [] }); assert.deepEqual(requests, [request]);
});
