import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { validateSceneControlProgram, validateSceneControlPlan } from '../../engine/scene-control-program.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const projectId = id(1), entryId = id(2), actor = id(3), instance = id(4), backendId = 'org.viento.bevy';
const snapshotId = 'sha256:' + 'b'.repeat(64), copy = value => JSON.parse(JSON.stringify(value));
const program = target => ({ format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.25, steps: [
  { inputs: [{ instanceId: target, left: false, right: true, up: false, down: false }] }, { inputs: [] },
] });
function initial() {
  return { supported: true, available: true, platform: 'linux', backend: { format: 'viento-execution-backend', schemaVersion: 1,
    id: backendId, label: 'Bevy', version: '0.3.0', platforms: ['linux'], plans: [{ kind: 'scene2d', schemaVersion: 2, runtimeProtocolVersion: 2 }, { kind: 'project', schemaVersion: 1, runtimeProtocolVersion: 1 }],
    capabilities: ['scene2d', 'project.scenes', 'runtime.control-replay', 'runtime.control-replay.instances', 'project.control-replay'],
    execution: { build: true, headlessLogic: true, windowPreview: false, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [] },
    scenes: [{ id: projectId, title: 'Assembly', sourcePath: 'documents/project.json', kind: 'project' }],
    latestBuild: { id: 'build-one', sceneId: projectId, targetKind: 'project', backendId, snapshotId, planSchemaVersion: 1,
      actorCount: 4, entrySceneId: entryId, controlReplayAvailable: true, controlSceneId: entryId,
      controlSourcePath: 'documents/scenes/entry.json', controlPlanSchemaVersion: 2, controlActorCount: 1,
      controlTargets: [{ instanceId: instance, objectId: actor, name: 'Entry actor' }] }, job: null };
}
async function harness(state = initial()) {
  const calls = [], languages = []; let dictionary = {};
  const translate = (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? '');
  const h = await dialogHarness('app-project-build', { PROJECT_BUILD_API_PATH: '/api/project-build',
    validateSceneControlProgram: input => validateSceneControlProgram(copy(input)),
    validateSceneControlPlan: (plan, input) => validateSceneControlPlan(copy(plan), copy(input)),
    t: translate, onLanguageChange: callback => languages.push(callback),
    translatePage: root => { for (const item of root.querySelectorAll('[data-i18n]')) item.textContent = translate(item.dataset.i18n); },
    fetchJsonApiRequest: async (url, request) => { calls.push({ url, body: request.body ? JSON.parse(request.body) : null }); return { payload: state }; },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => ({ editable: true, dirty: false, busy: false, creating: false, path: 'documents/project.json' }) });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, calls, language(value) { dictionary = value; languages.forEach(callback => callback()); } };
}

test('project replay uses frozen entry targets and preserves ordinary headless execution and case isolation', async () => {
  const h = await harness();
  assert.equal(h.element('projectBuildControl').hidden, false); assert.equal(h.element('projectBuildControl').disabled, false);
  assert.equal(h.element('projectBuildControlProjectHint').hidden, false);
  assert.equal(h.element('projectBuildCaseRun').hidden, true); assert.equal(h.element('projectBuildCaseEditor').hidden, true);
  assert.equal(h.element('projectBuildSuites').hidden, true);
  assert.equal(h.element('projectBuildControlTarget').children.length, 2);
  h.element('projectBuildControlProgram').value = JSON.stringify(program(instance)); h.element('projectBuildControl').click(); await flushDialogs();
  assert.deepEqual(h.calls.at(-1).body, { action: 'run', buildId: 'build-one', mode: 'headless', controlProgram: program(instance) });
  h.element('projectBuildHeadless').click(); await flushDialogs();
  assert.deepEqual(h.calls.at(-1).body, { action: 'run', buildId: 'build-one', mode: 'headless' });
});

test('missing capability or frozen support hides project replay; foreign instance is rejected locally', async () => {
  for (const missing of ['project.control-replay', 'runtime.control-replay']) {
    const value = initial(); value.backend.capabilities = value.backend.capabilities.filter(key => key !== missing);
    const h = await harness(value); assert.equal(h.element('projectBuildControl').hidden, true); assert.equal(h.element('projectBuildControlEditor').hidden, true);
  }
  for (const change of [build => { build.controlReplayAvailable = false; }, build => { build.controlSceneId = id(99); },
    build => { build.controlSourcePath = '../other.json'; }, build => { build.controlActorCount = 0; }]) {
    const value = initial(); change(value.latestBuild);
    const denied = await harness(value); assert.equal(denied.element('projectBuildControl').hidden, true);
  }
  const h = await harness(), before = h.calls.length;
  h.element('projectBuildControlProgram').value = JSON.stringify(program(id(99))); h.element('projectBuildControl').click(); await flushDialogs();
  assert.equal(h.calls.length, before); assert.match(h.element('projectBuildControlError').textContent, /实例不属于这份构建/);
});

test('entry-only hint supports Chinese, English and Japanese', async () => {
  const h = await harness(), key = '项目回放仅作用于冻结工程的启动场景，不切换场景，也不使用项目键盘输入映射。';
  for (const dictionary of [{}, en, ja]) { h.language(dictionary); assert.equal(h.element('projectBuildControlProjectHint').textContent, dictionary[key] || key); }
  assert.ok(en[key]); assert.ok(ja[key]);
});
