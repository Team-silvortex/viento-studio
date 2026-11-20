import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { editorHarness } from './editor-harness.mjs';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { PROJECT_BUILD_API_PATH } from '../../engine/project-build-contract.mjs';

const sceneId = '00000000-0000-4000-8000-000000000001';
const assemblyId = '00000000-0000-4000-8000-000000000002';
const apiPath = '/api/scene-behavior-reference-directory';
const stop = new Error('stop after capturing the actual runtime composition ports');
const copy = value => JSON.parse(JSON.stringify(value));

async function runtimeFixture(options = {}) {
  let detection = { available: true, source: 'capabilities', payload: { sceneBehaviorReferences: true } }, ports;
  const requests = [], sourceHost = { getContext() {}, getSource() {}, applyDraft() {}, getReferences() { assert.fail('First creation must not borrow the saved behavior-source host.'); } };
  const h = await editorHarness({
    detectEditBackendAvailability: async () => detection,
    inspectSceneBehaviorReferenceDirectory: async payload => { requests.push(payload); return options.inspect ? options.inspect(payload) : { status: 'saved-directory' }; },
    createSceneBehaviorSourceHost: () => sourceHost,
    setupStudioSystem: async options => { ports = options.ports; throw stop; },
    writeDoc: async () => { assert.fail('Readonly directory transport cannot save an author document.'); },
  });
  h.begin('An ordinary saved Markdown document, without any behavior manifest.\n');
  await h.runtime.detectEditBackend(); await assert.rejects(h.runtime.initApp(), error => error === stop);
  return { ...h, requests, sourceHost, ports,
    async detect(available, capability, authoring = false) {
      detection = { available, source: 'capabilities', payload: { sceneBehaviorReferences: capability, sceneBehaviorAuthoring: authoring } };
      await h.runtime.detectEditBackend();
    } };
}

test('first-creation runtime exposes a live independent strict-boolean directory capability and rejects disabled reads before transport', async () => {
  const h = await runtimeFixture(), payload = { sceneObjectId: sceneId, assemblyObjectId: null };
  const getReferences = h.ports.build.getReferences;
  assert.equal(typeof getReferences, 'function'); assert.notEqual(getReferences, h.sourceHost.getReferences);
  for (const [available, capability, expected] of [[true, false, false], [true, undefined, false], [true, 'true', false], [true, 1, false], [false, true, false], [true, true, true]]) {
    await h.detect(available, capability, false);
    assert.equal(h.ports.build.getContext().referencesAvailable, expected);
    const before = h.requests.length;
    if (expected) {
      assert.deepEqual(await getReferences(payload), { status: 'saved-directory' });
      assert.equal(h.requests.length, before + 1); assert.equal(h.requests.at(-1), payload);
    } else {
      await assert.rejects(getReferences(payload), error => error.errorCode === 'scene_behavior_reference_directory_unavailable');
      assert.equal(h.requests.length, before);
    }
  }
  // Reuse the same injected closure: later capability loss cannot keep a stale
  // callable authority, and enabling authoring alone does not enable this port.
  await h.detect(true, false, true); assert.equal(h.ports.build.getContext().referencesAvailable, false);
  const count = h.requests.length;
  await assert.rejects(getReferences(payload), error => error.errorCode === 'scene_behavior_reference_directory_unavailable');
  assert.equal(h.requests.length, count);
  await h.detect(true, true, false); await getReferences(payload); assert.equal(h.requests.length, count + 1);
});

test('creation directory failures propagate unchanged without consulting a saved-source host or any write port', async () => {
  const failure = Object.assign(new Error('The selected saved assembly has changed.'), { errorCode: 'scene_behavior_reference_directory_conflict', statusCode: 409 });
  const h = await runtimeFixture({ inspect: async () => { throw failure; } });
  const payload = Object.freeze({ sceneObjectId: sceneId, assemblyObjectId: assemblyId });
  await assert.rejects(h.ports.build.getReferences(payload), error => error === failure);
  assert.deepEqual(h.requests, [payload]); assert.equal(h.requests[0], payload);
  assert.equal(h.ports.sceneBehaviors.getReferences, h.sourceHost.getReferences, 'the existing saved-source port remains separate and unchanged');
});

test('the actual creation runtime port reaches the existing authenticated readonly HTTP transport with only scene and explicit assembly identities', async () => {
  const source = (await fs.readFile(new URL('../../web/modules/app-doc-service.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '').replaceAll('export ', '');
  const calls = [], directory = { format: 'viento-scene-behavior-reference-directory', selectedAssembly: null };
  const storage = { getItem: key => { assert.equal(key, 'doc-api-token'); return ' first-creation-token '; } };
  const transport = vm.createContext({ SCENE_BEHAVIOR_REFERENCE_DIRECTORY_API_PATH: apiPath, window: { localStorage: storage }, localStorage: storage,
    t: key => key, fetchJsonApiRequest: async (...args) => { calls.push(args); return { payload: directory }; } });
  vm.runInContext(source, transport);
  const h = await runtimeFixture({ inspect: payload => transport.inspectSceneBehaviorReferenceDirectory(payload) });
  for (const selected of [null, assemblyId]) {
    const payload = { sceneObjectId: sceneId, assemblyObjectId: selected };
    assert.equal(await h.ports.build.getReferences(payload), directory);
    const [url, request, timeout, label] = calls.at(-1);
    assert.equal(url, apiPath); assert.equal(request.method, 'POST'); assert.equal(request.headers.Authorization, 'Bearer first-creation-token');
    assert.equal(request.headers['Content-Type'], 'application/json'); assert.deepEqual(JSON.parse(request.body), payload);
    assert.equal(timeout, 45000); assert.equal(label, '读取行为参数参考');
    assert.equal(request.body.includes('first-creation-token'), false);
    assert.deepEqual(Object.keys(JSON.parse(request.body)).sort(), ['assemblyObjectId', 'sceneObjectId']);
  }
  assert.equal(calls.length, 2); assert.equal(h.requests.length, 2);
});

async function buildFixture(getReferences) {
  let creationPorts;
  const availability = [], opened = [], transportCalls = [], current = { editable: true, dirty: false, creating: false, busy: false,
    referencesAvailable: true, path: 'documents/scenes/main.json', sceneDraftToken: 'ordinary:1' };
  const backendId = 'org.viento.godot4';
  const data = { supported: true, available: true, reason: null, platform: 'linux', job: null, latestBuild: null,
    scenes: [{ id: sceneId, title: 'Main scene', sourcePath: current.path }],
    backend: { format: 'viento-execution-backend', schemaVersion: 1, id: backendId, version: '0.2.0', label: 'Godot 4', platforms: ['linux'],
      plans: [{ kind: 'scene2d', schemaVersion: 1, runtimeProtocolVersion: 1 }], capabilities: ['scene2d', 'input.arrows', 'state.movement', 'image'],
      execution: { build: true, headlessLogic: true, windowPreview: true, windowCapture: true, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] } };
  const h = await dialogHarness('app-project-build', { PROJECT_BUILD_API_PATH,
    setupSceneBehaviorCreate: options => { creationPorts = options; return { setAvailable: (...args) => availability.push(copy(args)), open: id => opened.push(id) }; },
    fetchJsonApiRequest: async (url, request = {}) => { transportCalls.push({ url, request }); return { payload: data }; },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => current, ...(getReferences ? { getReferences } : {}) });
  controller.setAvailable(true, ['behavior.create']); h.element('projectBuildBtn').click(); await flushDialogs(); await flushDialogs();
  return { ...h, controller, current, creationPorts, availability, opened, transportCalls };
}

test('the actual build controller injects the optional readonly function unchanged and forwards current ownership and capability into creation', async () => {
  const reads = [], result = Object.freeze({ status: 'directory' });
  const getReferences = async payload => { reads.push(payload); return result; };
  const h = await buildFixture(getReferences);
  assert.equal(h.creationPorts.getReferences, getReferences);
  let context = h.creationPorts.getContext();
  assert.equal(context.referencesAvailable, true); assert.equal(context.sceneId, sceneId); assert.equal(context.visible, true); assert.equal(context.sourceToken, 'ordinary:1');
  const payload = { sceneObjectId: sceneId, assemblyObjectId: null };
  assert.equal(await h.creationPorts.getReferences(payload), result); assert.equal(reads[0], payload);
  h.current.referencesAvailable = false; h.current.sceneDraftToken = 'ordinary:2'; context = h.creationPorts.getContext();
  assert.equal(context.referencesAvailable, false); assert.equal(context.sourceToken, 'ordinary:2');
  assert.equal(h.element('projectBuildCreateBehavior').disabled, false, 'the optional lookup capability cannot disable ordinary first creation');
  h.element('projectBuildCreateBehavior').click(); assert.deepEqual(h.opened, [sceneId]);
  assert.deepEqual(h.availability.at(-1), [true, ['behavior.create']]);
  assert.equal(reads.length, 1, 'opening creation never automatically reads or chooses directory entries');
  assert.equal(h.transportCalls.every(call => !call.request.method), true, 'build opening performs status reads only');
});

test('legacy build composition with no directory port still opens ordinary behavior creation and forwards absent capability unchanged', async () => {
  const h = await buildFixture(); delete h.current.referencesAvailable;
  assert.equal(h.creationPorts.getReferences, undefined); assert.equal(h.creationPorts.getContext().referencesAvailable, undefined);
  assert.equal(h.element('projectBuildCreateBehavior').disabled, false);
  h.element('projectBuildCreateBehavior').click(); assert.deepEqual(h.opened, [sceneId]);
  assert.deepEqual(h.availability.at(-1), [true, ['behavior.create']]);
});
