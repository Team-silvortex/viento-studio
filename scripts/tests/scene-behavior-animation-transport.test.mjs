import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { editorHarness } from './editor-harness.mjs';
const apiPath = '/api/scene-animation-directory';
test('animation clip directory transport uses only its read endpoint and places the API token in headers', async () => {
  const source = (await fs.readFile(new URL('../../web/modules/app-doc-service.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '').replaceAll('export ', '');
  const calls = [], result = { format: 'viento-scene-animation-directory' }; let token = ' secret\r\n-token ';
  const storage = { getItem(key) { assert.equal(key, 'doc-api-token'); return token; } };
  const context = vm.createContext({ window: { localStorage: storage }, localStorage: storage, SCENE_ANIMATION_DIRECTORY_API_PATH: apiPath, t: key => key,
    fetchJsonApiRequest: async (...args) => { calls.push(args); return { payload: result }; } });
  vm.runInContext(source, context);
  const payload = { sceneObjectId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
  assert.equal(await context.inspectSceneAnimationDirectory(payload), result);
  assert.equal(calls[0][0], apiPath); assert.equal(calls[0][1].method, 'POST'); assert.equal(calls[0][1].headers.Authorization, 'Bearer secret-token');
  assert.equal(calls[0][1].headers['Content-Type'], 'application/json'); assert.deepEqual(JSON.parse(calls[0][1].body), payload);
  assert.equal(calls[0][2], 45000); assert.equal(calls[0][3], '读取场景动画片段'); assert.ok(!calls[0][1].body.includes('secret-token'));
  token = ''; await context.inspectSceneAnimationDirectory(payload); assert.equal(calls[1][1].headers.Authorization, undefined);
});
test('runtime supplies a separate directory port and requires the explicit service capability without changing existing behavior ports', async () => {
  let currentDetection, hostOptions, ports;
  const stop = new Error('stop after capturing runtime ports'), requests = [], audioRequests = [], sourceHost = { getContext() {}, getSource() {}, getAudioTracks() {}, getAnimationClips() {}, applyDraft() {} };
  const h = await editorHarness({
    detectEditBackendAvailability: async () => currentDetection,
    inspectSceneAnimationDirectory: async payload => { requests.push(payload); return { status: 'empty' }; },
    inspectSceneAudioDirectory: async payload => { audioRequests.push(payload); return { status: 'ready' }; },
    createSceneBehaviorSourceHost: options => { hostOptions = options; return sourceHost; },
    setupStudioSystem: async options => { ports = options.ports; throw stop; },
  });
  for (const [available, field, expected] of [[true, true, true], [true, false, false], [true, undefined, false], [true, 'true', false], [false, true, false]]) {
    currentDetection = { available, source: 'capabilities', payload: { sceneBehaviorAuthoring: true, sceneAnimationDirectory: field, sceneAudioDirectory: true } };
    await h.runtime.detectEditBackend(); await assert.rejects(h.runtime.initApp(), error => error === stop);
    assert.equal(hostOptions.getState().animationClipsAvailable, expected);
    assert.equal(hostOptions.getState().audioTracksAvailable, available);
    assert.equal(hostOptions.getState().available, available);
    for (const name of ['getContext', 'getSource', 'getAudioTracks', 'getAnimationClips', 'applyDraft']) assert.equal(ports.sceneBehaviors[name], sourceHost[name]);
    assert.equal(typeof ports.sceneBehaviors.inspect, 'function');
  }
  const request = { sceneObjectId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
  assert.deepEqual(await hostOptions.inspectAnimationDirectory(request), { status: 'empty' }); assert.deepEqual(requests, [request]);
  assert.deepEqual(await hostOptions.inspectAudioDirectory(request), { status: 'ready' }); assert.deepEqual(audioRequests, [request]);
});
