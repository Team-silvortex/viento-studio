import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { editorHarness } from './editor-harness.mjs';
const apiPath = '/api/scene-audio-usage';

test('audio usage transport uses its own read endpoint and keeps the sanitized token out of the body', async () => {
  const source = (await fs.readFile(new URL('../../web/modules/app-doc-service.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '').replaceAll('export ', '');
  const calls = [], result = { format: 'viento-scene-audio-usage' }; let token = ' secret\r\n-token ';
  const storage = { getItem(key) { assert.equal(key, 'doc-api-token'); return token; } };
  const context = vm.createContext({ window: { localStorage: storage }, localStorage: storage, SCENE_AUDIO_USAGE_API_PATH: apiPath, t: key => key,
    fetchJsonApiRequest: async (...args) => { calls.push(args); return { payload: result }; } });
  vm.runInContext(source, context);
  const payload = { sceneObjectId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
  assert.equal(await context.inspectSceneAudioUsage(payload), result);
  assert.equal(calls[0][0], apiPath); assert.equal(calls[0][1].method, 'POST'); assert.equal(calls[0][1].headers.Authorization, 'Bearer secret-token');
  assert.equal(calls[0][1].headers['Content-Type'], 'application/json'); assert.deepEqual(JSON.parse(calls[0][1].body), payload);
  assert.equal(calls[0][2], 45000); assert.equal(calls[0][3], '读取音轨使用位置'); assert.ok(!calls[0][1].body.includes('secret-token'));
  token = ''; await context.inspectSceneAudioUsage(payload); assert.equal(calls[1][1].headers.Authorization, undefined);
});

test('runtime gates usage on its explicit capability independently of resource selection and ordinary audio editing', async () => {
  let currentDetection, hostOptions, ports;
  const stop = new Error('stop after capturing runtime ports'), requests = [];
  const sourceHost = { getContext() {}, getSource() {}, getUsage() {}, getResources() {}, getAudition() {}, applyDraft() {} };
  const h = await editorHarness({
    detectEditBackendAvailability: async () => currentDetection,
    inspectSceneAudioUsage: async payload => { requests.push(payload); return { behavior: null }; },
    createSceneAudioSourceHost: options => { hostOptions = options; return sourceHost; },
    setupStudioSystem: async options => { ports = options.ports; throw stop; },
  });
  for (const [available, usage, resources, expected] of [
    [true, true, false, true], [true, true, true, true], [true, false, true, false],
    [true, undefined, true, false], [true, 'true', true, false], [false, true, true, false],
  ]) {
    currentDetection = { available, source: 'capabilities', payload: { sceneAudioUsage: usage, sceneAudioCreation: resources, sceneAudioDirectory: true } };
    await h.runtime.detectEditBackend(); await assert.rejects(h.runtime.initApp(), error => error === stop);
    assert.equal(hostOptions.getState().usageAvailable, expected);
    assert.equal(hostOptions.getState().resourcesAvailable, available && resources);
    assert.equal(hostOptions.getState().available, true, 'optional capability does not gate ordinary audio field editing');
    assert.equal(ports.sceneAudio, sourceHost);
    for (const name of ['getContext', 'getSource', 'getUsage', 'getResources', 'getAudition', 'applyDraft']) assert.equal(ports.sceneAudio[name], sourceHost[name]);
  }
  const request = { sceneObjectId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
  assert.deepEqual(await hostOptions.inspectUsage(request), { behavior: null }); assert.deepEqual(requests, [request]);
});
