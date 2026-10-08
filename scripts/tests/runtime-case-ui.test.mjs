import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogHarness, flushDialogs } from './dialog-harness.mjs';
import { querySceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import { validateSceneControlProgram, validateSceneControlPlan } from '../../engine/scene-control-program.mjs';
import en from '../../web/i18n/en.js';
import ja from '../../web/i18n/ja.js';
import { createSceneRuntimeObservation } from '../../engine/scene-runtime-query.mjs';
import { evaluateRuntimeCase } from '../../engine/runtime-verification-case.mjs';

const sceneId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', otherSceneId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const objectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const instances = ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'];
const snapshotId = `sha256:${'c'.repeat(64)}`, backendId = 'org.viento.bevy';
const released = () => ({ left: false, right: false, up: false, down: false });
const row = (instanceId, direction) => ({ instanceId, ...released(), ...(direction ? { [direction]: true } : {}) });
const program = () => ({ format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.125,
  steps: [{ inputs: [row(instances[0], 'right'), row(instances[1], 'left')] }, { inputs: [row(instances[1], 'up')] },
    { inputs: [row(instances[0], 'left')] }, { inputs: [] }] });
function initial() {
  return { supported: true, available: true, platform: 'linux', backend: {
    format: 'viento-execution-backend', schemaVersion: 1, id: backendId, label: 'Bevy', version: '0.3.0', platforms: ['linux'],
    plans: [1, 2].map(version => ({ kind: 'scene2d', schemaVersion: version, runtimeProtocolVersion: version })),
    capabilities: ['scene2d', 'input.arrows', 'state.movement', 'runtime.control-replay', 'runtime.control-replay.instances'],
    execution: { build: true, headlessLogic: true, windowPreview: false, windowCapture: false, offscreenRender: false, embeddedViewport: false, gpuCompute: false }, extensions: [],
  }, scenes: [{ id: sceneId, title: 'Instance control sample', sourcePath: 'documents/scenes/demo.json' },
    { id: otherSceneId, title: 'Other scene', sourcePath: 'documents/scenes/other.json' }],
  latestBuild: { id: 'build-one', backendId, sceneId, snapshotId, planSchemaVersion: 2, actorCount: 2,
    controlTargets: instances.map(instanceId => ({ instanceId, objectId, name: '<Same definition>' })) }, job: null };
}
async function harness(state = initial()) {
  let payload = state, dictionary = {}; const calls = [], languages = [];
  const context = { editable: true, dirty: false, busy: false, creating: false, path: 'documents/scenes/demo.json' };
  const translated = (key, ...values) => (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? '');
  const detach = value => JSON.parse(JSON.stringify(value));
  const h = await dialogHarness('app-project-build', {
    PROJECT_BUILD_API_PATH: '/api/project-build', querySceneRuntimeObservation,
    // Browser imports share one realm; make this VM fixture match that boundary.
    validateSceneControlProgram: value => validateSceneControlProgram(detach(value)),
    validateSceneControlPlan: (plan, value) => validateSceneControlPlan(detach(plan), detach(value)),
    t: translated, onLanguageChange: callback => languages.push(callback),
    translatePage: root => { for (const item of root.querySelectorAll('[data-i18n]')) item.textContent = translated(item.dataset.i18n); },
    fetchJsonApiRequest: async (url, request) => { calls.push({ url, body: request.body ? JSON.parse(request.body) : null }); return { payload }; },
  });
  const controller = h.runtime.setupProjectBuild({ getContext: () => context });
  controller.setAvailable(true); h.element('projectBuildBtn').click(); await flushDialogs();
  return { ...h, controller, context, calls,
    async refresh(value = payload) { payload = value; h.element('projectBuildRefresh').click(); await flushDialogs(); },
    async tick(value = payload) { payload = value; const [id, callback] = [...h.timers][0] || []; assert.ok(callback); h.timers.delete(id); callback(); await flushDialogs(); },
    language(value) { dictionary = value; languages.forEach(callback => callback()); },
    input(value) { const input = h.element('projectBuildControlProgram'); input.value = value; input.dispatch('input'); return input; },
    target(value) { const target = h.element('projectBuildControlTarget'); target.value = value; target.dispatch('change'); return target; },
  };
}

function frozenPlan() {
  return { format: 'viento-build-plan', kind: 'scene2d', schemaVersion: 2,
    scene: { objectId: sceneId, sourcePath: 'documents/scenes/demo.json' },
    actors: instances.map(instanceId => ({ instanceId, objectId, name: '<Same definition>', sourcePath: 'documents/characters/traveler.md' })) };
}
function samples() {
  const positions = [[[220, 220], [490, 220]], [[220, 220], [490, 210]], [[200, 220], [490, 210]], [[200, 220], [490, 210]]];
  return positions.map((values, stepIndex) => ({ format: 'viento-runtime-trace', schemaVersion: 1, protocolVersion: 2,
    event: 'sample', stepIndex, actors: instances.map((instanceId, index) => ({ instanceId, objectId, position: values[index],
      state: stepIndex === 0 || stepIndex === 1 && index === 1 || stepIndex === 2 && index === 0 ? 'moving' : 'idle' })) }));
}
const definition = () => ({ format: 'viento-runtime-case', schemaVersion: 1, program: program(),
  checks: [{ instanceId: instances[0], stepIndex: 3, position: { value: [200, 220], tolerance: 0.0001 }, state: 'idle' }] });
function controlledState({ verification, status = 'succeeded', complete = true } = {}) {
  const state = initial(), plan = frozenPlan(), seen = complete ? samples() : samples().slice(0, 1);
  const runtime = createSceneRuntimeObservation(plan, { controlProgram: program() });
  runtime.push({ event: 'ready', protocol: 2, sceneObjectId: sceneId, actors: samples()[0].actors });
  for (const sample of seen) runtime.pushSample(sample);
  if (complete) runtime.push({ event: 'finished', protocol: 2, actors: samples().at(-1).actors, fixedDelta: 0.125 });
  state.job = { id: 'case-job', kind: 'run', backendId, buildId: state.latestBuild.id, snapshotId, sceneId, status,
    diagnostics: [], events: [], logs: '', runtime: runtime.snapshot(), control: { program: program(), samples: seen } };
  if (verification) state.job.verification = { definition: verification, sha256: `sha256:${'a'.repeat(64)}`,
    evaluation: evaluateRuntimeCase(plan, verification, seen, { complete: status === 'succeeded' && complete }) };
  return state;
}
const caseInput = (h, value) => { const input = h.element('projectBuildCaseProgram'); input.value = value; input.dispatch('input'); return input; };

test('verification starts from explicit JSON and submits only its detached case, preserving control input', async () => {
  const h = await harness(), control = h.element('projectBuildControlProgram'), text = control.value;
  assert.equal(h.element('projectBuildCaseProgram').value, ''); assert.equal(h.element('projectBuildCaseGenerate').disabled, true);
  assert.equal(h.element('projectBuildCaseRun').disabled, false);
  const expected = definition(); caseInput(h, JSON.stringify(expected)); h.element('projectBuildCaseRun').click(); await flushDialogs();
  assert.deepEqual(h.calls.at(-1).body, { action: 'run', buildId: 'build-one', mode: 'headless', runtimeCase: expected });
  assert.equal(control.value, text); assert.equal(h.calls.at(-1).body.controlProgram, undefined);
});

test('bad JSON, foreign targets and oversized text stay local without submitting a task', async () => {
  const h = await harness();
  const foreign = definition(); foreign.checks[0].instanceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  for (const text of ['{ unfinished JSON', JSON.stringify(foreign), ' '.repeat(262145)]) {
    const input = caseInput(h, text), before = h.calls.length;
    h.element('projectBuildCaseRun').click(); await flushDialogs();
    assert.equal(h.calls.length, before); assert.equal(input.value, text); assert.equal(h.document.activeElement, input);
    assert.equal(h.element('projectBuildCaseError').hidden, false); assert.equal(h.element('projectBuildCaseEditor').open, true);
  }
});

test('expectations are generated only on an explicit click from complete samples belonging to the selected frozen build', async () => {
  const h = await harness(controlledState()), edited = '{ author case draft', input = caseInput(h, edited), control = h.element('projectBuildControlProgram').value;
  input.focus(); input.selectionStart = 2; input.selectionEnd = 8; await h.refresh(controlledState());
  assert.equal(input.value, edited); assert.equal(input.selectionStart, 2); assert.equal(h.element('projectBuildCaseGenerate').disabled, false);
  h.element('projectBuildCaseGenerate').click();
  const generated = JSON.parse(input.value); assert.deepEqual(generated.program, program());
  assert.deepEqual(generated.checks.map(check => [check.instanceId, check.stepIndex, check.position.value, check.state]),
    [[instances[0], 3, [200, 220], 'idle'], [instances[1], 3, [490, 210], 'idle']]);
  assert.ok(generated.checks.every(check => check.position.tolerance === 0.0001)); assert.equal(h.element('projectBuildControlProgram').value, control);
  const current = input.value;
  for (const state of [controlledState({ status: 'cancelled', complete: false }),
    { ...controlledState(), job: { ...controlledState().job, buildId: 'another-build' } },
    { ...controlledState(), job: { ...controlledState().job, snapshotId: `sha256:${'d'.repeat(64)}` } }]) {
    await h.refresh(state); assert.equal(h.element('projectBuildCaseGenerate').disabled, true);
    h.element('projectBuildCaseGenerate').click(); assert.equal(input.value, current);
  }
});

test('passed, failed and incomplete checks expose actual versus expected and keep execution status separate in three languages', async () => {
  const correct = definition(), wrong = definition(); wrong.checks[0].position.value[0] = 999;
  const h = await harness(controlledState({ verification: correct }));
  for (const [dictionary, labels] of [[{}, ['验收通过', '验收未通过', '验收未完成']],
    [en, ['Verification passed', 'Verification failed', 'Verification incomplete']], [ja, ['検証に合格', '検証に不合格', '検証未完了']]]) {
    h.language(dictionary);
    for (const [state, label] of [[controlledState({ verification: correct }), labels[0]], [controlledState({ verification: wrong }), labels[1]],
      [controlledState({ verification: correct, status: 'cancelled', complete: false }), labels[2]]]) {
      await h.refresh(state); assert.equal(h.element('projectBuildCaseResult').hidden, false);
      assert.ok(h.element('projectBuildCaseSummary').textContent.includes(label));
      assert.equal(h.element('projectBuildCaseChecks').children.length, 1);
      const text = h.element('projectBuildCaseChecks').textContent;
      assert.ok(text.includes(instances[0])); assert.ok(text.includes('4'), 'display steps are human-readable while JSON stays zero-based');
      if (state.job.status === 'succeeded') assert.ok(text.includes('[200,220]'));
    }
  }
});

test('polling, language changes and close preserve case text/caret; author drafts and stale ownership disable verification', async () => {
  const state = controlledState(), h = await harness(state), input = caseInput(h, '{ unfinished case');
  input.focus(); input.selectionStart = 3; input.selectionEnd = 9;
  h.language(en); await h.refresh(state); h.element('projectBuildClose').click(); await flushDialogs();
  h.element('projectBuildBtn').click(); await flushDialogs();
  assert.equal(input.value, '{ unfinished case'); assert.equal(input.selectionStart, 3); assert.equal(input.selectionEnd, 9);
  h.context.dirty = true; h.controller.setAvailable(true); assert.equal(h.element('projectBuildCaseRun').disabled, true);
  h.context.dirty = false; h.controller.setAvailable(true);
  await h.refresh({ ...state, catalogDiagnostic: { code: 'build_catalog_unavailable' } });
  assert.equal(h.element('projectBuildCaseRun').disabled, false, 'owned frozen verification does not require readable author files');
  await h.refresh({ ...state, latestBuild: { ...state.latestBuild, backendId: 'other.backend' } });
  assert.equal(h.element('projectBuildCaseRun').disabled, true);
});

test('case errors and malformed evaluation cannot affect ordinary control replay or inject markup', async () => {
  const state = controlledState({ verification: definition() }), h = await harness(state), edited = '{ unfinished case'; caseInput(h, edited);
  h.element('projectBuildControl').click(); await flushDialogs();
  assert.ok(h.calls.at(-1).body.controlProgram); assert.equal(h.calls.at(-1).body.runtimeCase, undefined);
  assert.equal(h.element('projectBuildCaseProgram').value, edited);
  const bad = JSON.parse(JSON.stringify(controlledState({ verification: definition() }))); bad.job.verification.evaluation.checks[0].actual.state = '<img onerror=window.bad>';
  await h.refresh(bad); assert.equal(h.element('projectBuildCaseChecks').children.length, 0);
  assert.equal(h.element('projectBuildCaseSummary').children.length, 0); assert.match(h.element('projectBuildCaseSummary').textContent, /不可读取/);
});
