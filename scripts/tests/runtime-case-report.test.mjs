import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { RUNTIME_CASE_REPORT_FORMAT, RUNTIME_CASE_REPORT_FILE_MAX_BYTES,
  createRuntimeCaseReport, validateRuntimeCaseReport } from '../../engine/runtime-case-report.mjs';

const id = number => `aaaaaaaa-aaaa-4aaa-8aaa-${number.toString(16).padStart(12, '0')}`;
const first = id(20), second = id(21), actorId = id(30);
const revision = number => `sha256:${number.toString(16).padStart(64, '0')}`;
const arrows = (right = false) => ({left: false, right, up: false, down: false});
const context = () => ({sceneSourcePath: 'documents/scenes/demo.json', sceneObjectId: id(1), buildId: id(2),
  snapshotId: revision(1), backendId: 'org.viento.godot4', suiteDocumentId: id(3), suiteSourceVersion: revision(2),
  documentId: id(4), sourceVersion: revision(3), sessionId: id(5)});
const targets = () => [{instanceId: first, objectId: actorId}, {instanceId: second, objectId: actorId}];
const definition = () => ({format: 'viento-runtime-case', schemaVersion: 1,
  program: {format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125, steps: [arrows(true), arrows()]},
  checks: [{instanceId: first, stepIndex: 0, position: {value: [10, 20], tolerance: 0}, state: 'moving'},
    {instanceId: second, stepIndex: 1, state: 'idle'}]});
const sample = stepIndex => ({format: 'viento-runtime-trace', schemaVersion: 1, protocolVersion: 2,
  event: 'sample', stepIndex, actors: targets().map((actor, index) => ({...actor,
    position: [index ? 30 : 10, 20], state: stepIndex === 0 ? 'moving' : 'idle'}))});
const input = () => ({context: context(), executionStatus: 'succeeded', targets: targets(),
  definition: definition(), samples: [sample(0), sample(1)]});
const report = () => createRuntimeCaseReport(input());
const is = code => caught => caught instanceof TypeError && caught.errorCode === code;
const invalid = is('runtime_case_report_invalid'), limit = is('runtime_case_report_limit');
const clone = value => JSON.parse(JSON.stringify(value));

test('member reports detach and deeply freeze exact output data and recompute complete checks', () => {
  const original = input(), value = createRuntimeCaseReport(original);
  assert.equal(RUNTIME_CASE_REPORT_FORMAT, 'viento-runtime-case-report');
  assert.equal(RUNTIME_CASE_REPORT_FILE_MAX_BYTES, 2 * 1024 * 1024);
  assert.deepEqual(Object.keys(value), ['format', 'schemaVersion', 'context', 'executionStatus', 'targets', 'definition', 'samples', 'evaluation']);
  assert.deepEqual([value.evaluation.status, value.evaluation.complete, value.evaluation.passedChecks], ['passed', true, 2]);
  for (const item of [value, value.context, value.targets, value.targets[0], value.definition,
    value.samples, value.samples[0], value.samples[0].actors[0].position,
    value.evaluation, value.evaluation.checks[0].actual]) assert.equal(Object.isFrozen(item), true);
  original.context.sourceVersion = revision(99); original.samples[0].actors[0].position[0] = 99;
  original.definition.checks[0].position.value[0] = 99;
  assert.equal(value.context.sourceVersion, revision(3));
  assert.deepEqual(value.evaluation.checks[0].actual.position, [10, 20]);
  assert.deepEqual(validateRuntimeCaseReport(value), value);
  assert.notEqual(validateRuntimeCaseReport(value), value);
  assert.deepEqual(createRuntimeCaseReport(Object.assign(Object.create(null), input())), report());
});

test('factory and persisted reports exclude extensions, host authority and alternate format fields', () => {
  for (const key of ['context', 'executionStatus', 'targets', 'definition', 'samples']) {
    const value = input(); delete value[key]; assert.throws(() => createRuntimeCaseReport(value), invalid);
  }
  for (const key of ['path', 'tool', 'output', 'runtime', 'events', 'receipt', 'title', 'evaluation']) {
    assert.throws(() => createRuntimeCaseReport({...input(), [key]: '/outside'}), invalid);
  }
  for (const key of ['format', 'schemaVersion', 'evaluation']) {
    const value = clone(report()); delete value[key]; assert.throws(() => validateRuntimeCaseReport(value), invalid);
  }
  for (const value of [{...report(), schemaVersion: 2}, {...report(), format: 'viento-runtime-session'},
    {...report(), authenticated: true}]) assert.throws(() => validateRuntimeCaseReport(value), invalid);
});

test('report descriptors reject hidden, symbolic, inherited, cyclic and accessor data without invoking getters', () => {
  let calls = 0;
  const getter = input(); Object.defineProperty(getter, 'definition', {enumerable: true, get() {calls++; return definition();}});
  const nested = input(); Object.defineProperty(nested.samples[0].actors[0], 'position', {enumerable: true, get() {calls++; return [10, 20];}});
  const hidden = input(); Object.defineProperty(hidden.context, 'path', {value: '/outside'});
  const symbol = input(); symbol.samples[Symbol('private')] = true;
  const inherited = input(); inherited.context = Object.assign(Object.create({path: '/outside'}), context());
  const cycle = input(); cycle.definition.program.steps[0].right = cycle;
  const sparse = input(); delete sparse.samples[0];
  const extraArray = input(); extraArray.targets.path = '/outside';
  const dangerous = input(); Object.defineProperty(dangerous.context, '__proto__', {value: {}, enumerable: true});
  for (const value of [getter, nested, hidden, symbol, inherited, cycle, sparse, extraArray, dangerous]) {
    assert.throws(() => createRuntimeCaseReport(value), invalid);
  }
  const forged = clone(report()); Object.defineProperty(forged.evaluation, 'status', {enumerable: true, get() {calls++; return 'passed';}});
  assert.throws(() => validateRuntimeCaseReport(forged), invalid);
  assert.equal(calls, 0);
});

test('exact captured context validates identities and relative navigation without accepting paths or live states', () => {
  for (const changed of [{sceneObjectId: 'scene'}, {buildId: id(2).toUpperCase()}, {suiteDocumentId: 'suite'},
    {documentId: 'document'}, {snapshotId: 'hash'}, {suiteSourceVersion: null}, {sourceVersion: 'sha256:' + 'G'.repeat(64)},
    {backendId: '/tool'}, {backendId: 'bevy'}, {sceneSourcePath: '/outside/scene.json'},
    {sceneSourcePath: '../scene.json'}, {sceneSourcePath: 'documents\\scene.json'},
    {sceneSourcePath: 'C:/outside/scene.json'}, {sessionId: 'session'}, {sessionId: null}, {path: '/outside'}]) {
    assert.throws(() => createRuntimeCaseReport({...input(), context: {...context(), ...changed}}), invalid);
  }
  for (const state of ['queued', 'running', 'not-run', 'passed', 'incomplete']) {
    assert.throws(() => createRuntimeCaseReport({...input(), executionStatus: state}), invalid);
  }
  const recorded = input(); recorded.context.backendId = 'org.viento.bevy'; recorded.context.sceneSourcePath = 'documents/场景/風景 🐈.json';
  assert.equal(createRuntimeCaseReport(recorded).context.sceneSourcePath, recorded.context.sceneSourcePath);
  // A valid captured source revision is provenance, not a digest recomputed
  // from the canonical case. It is neither overwritten nor authenticated here.
  recorded.context.sourceVersion = revision(999); assert.equal(createRuntimeCaseReport(recorded).context.sourceVersion, revision(999));
});

test('frozen instance targets are complete paired data, allowing two instances of the same definition', () => {
  assert.equal(report().targets[0].objectId, report().targets[1].objectId);
  for (const targets of [[], [{instanceId: first}], [{instanceId: first, objectId: actorId, path: '/outside'}],
    [{instanceId: first, objectId: actorId}, {instanceId: first, objectId: actorId}]]) {
    assert.throws(() => createRuntimeCaseReport({...input(), targets}), invalid);
  }
  const stale = input(); stale.definition.checks[0].instanceId = id(999);
  assert.throws(() => createRuntimeCaseReport(stale), invalid);
  const wrong = input(); wrong.samples[0].actors[0].objectId = id(999);
  assert.throws(() => createRuntimeCaseReport(wrong), invalid);
  assert.throws(() => createRuntimeCaseReport({...input(), targets: Array.from({length: 129}, (_, index) => ({instanceId: id(100 + index), objectId: actorId}))}), limit);
});

test('stored evaluation is recomputed in full and rejects forged counts, actual values and assertion flags', () => {
  const value = input(); value.definition.checks[0].position.tolerance = 0.5;
  value.samples[0].actors[0].position = [10.5, 19.5];
  assert.equal(createRuntimeCaseReport(value).evaluation.status, 'passed');
  value.samples[0].actors[0].position[0] = 10.500001;
  const failed = createRuntimeCaseReport(value);
  assert.deepEqual([failed.executionStatus, failed.evaluation.status, failed.evaluation.complete], ['succeeded', 'failed', true]);
  assert.deepEqual([failed.evaluation.checks[0].positionPassed, failed.evaluation.checks[0].statePassed], [false, true]);
  for (const mutate of [v => {v.evaluation.status = 'passed';}, v => {v.evaluation.failedChecks = 0;},
    v => {v.evaluation.checks[0].actual.position[0] = 10;}, v => {v.evaluation.checks[0].positionPassed = true;},
    v => {v.evaluation.checks[0].expected.position.tolerance = 1;}, v => {v.evaluation.extra = true;},
    v => {v.definition.checks[0].position.value[0] = 10.500001;}]) {
    const forged = clone(failed); mutate(forged); assert.throws(() => validateRuntimeCaseReport(forged), invalid);
  }
  const reordered = clone(failed); reordered.evaluation = Object.fromEntries(Object.entries(reordered.evaluation).reverse());
  assert.deepEqual(validateRuntimeCaseReport(reordered), failed);
});

test('cancelled and unsuccessful members preserve prefix checks while never claiming overall completion', () => {
  for (const executionStatus of ['cancelled', 'timeout', 'failed']) {
    const value = createRuntimeCaseReport({...input(), executionStatus, samples: [sample(0)]});
    assert.deepEqual([value.evaluation.status, value.evaluation.complete, value.evaluation.passedChecks,
      value.evaluation.unavailableChecks], ['incomplete', false, 1, 1]);
    assert.deepEqual(value.evaluation.checks[0].actual.position, [10, 20]);
    assert.equal(value.evaluation.checks[1].actual, null);
    assert.equal(validateRuntimeCaseReport(value).executionStatus, executionStatus);
    const noProcess = createRuntimeCaseReport({...input(), context: {...context(), sessionId: null}, executionStatus, samples: []});
    assert.deepEqual([noProcess.context.sessionId, noProcess.evaluation.unavailableChecks], [null, 2]);
  }
  const allSamplesCancelled = createRuntimeCaseReport({...input(), executionStatus: 'cancelled'});
  assert.deepEqual([allSamplesCancelled.evaluation.status, allSamplesCancelled.evaluation.complete,
    allSamplesCancelled.evaluation.passedChecks], ['incomplete', false, 2]);
  const missingSuccessful = createRuntimeCaseReport({...input(), samples: [sample(0)]});
  assert.equal(missingSuccessful.evaluation.status, 'incomplete');
});

test('actual trace samples retain strict contiguous step order, complete actors and finite old protocol values', () => {
  for (const mutate of [v => {v.samples.reverse();}, v => {v.samples[1].stepIndex = 0;},
    v => {v.samples[0].protocolVersion = 1;}, v => {v.samples[0].event = 'ready';},
    v => {v.samples[0].actors.pop();}, v => {v.samples[0].actors[1] = clone(v.samples[0].actors[0]);},
    v => {v.samples[0].actors[0].instanceId = id(999);}, v => {v.samples[0].actors[0].position[0] = Infinity;},
    v => {v.samples[0].actors[0].state = 'running';}, v => {v.samples[0].fixedDelta = 0.125;}]) {
    const value = input(); mutate(value); assert.throws(() => createRuntimeCaseReport(value), invalid);
  }
  const shuffledActors = input(); shuffledActors.samples[0].actors.reverse();
  assert.equal(createRuntimeCaseReport(shuffledActors).evaluation.status, 'passed');
  assert.throws(() => createRuntimeCaseReport({...input(), samples: Array.from({length: 65}, (_, index) => sample(index))}), limit);
});

test('existing sparse instance programs, final release and control budgets are reused without new simulation rules', () => {
  const value = input(); value.definition.program = {...value.definition.program, schemaVersion: 2,
    steps: [{inputs: [{instanceId: first, ...arrows(true)}]}, {inputs: []}]};
  assert.equal(createRuntimeCaseReport(value).definition.program.schemaVersion, 2);
  for (const mutate of [v => {v.definition.program.steps[0].inputs[0].instanceId = id(999);},
    v => {v.definition.program.steps[1].inputs = [{instanceId: first, ...arrows(true)}];},
    v => {v.definition.program.fixedDelta = 0.251;}, v => {v.definition.checks[0].stepIndex = 2;}]) {
    const changed = clone(value); mutate(changed); assert.throws(() => createRuntimeCaseReport(changed), invalid);
  }
});

test('maximum actor-step samples and 128 checks fit the report while one extra step breaches old admission', () => {
  const value = input(); value.targets = Array.from({length: 128}, (_, index) => ({instanceId: id(index + 100), objectId: actorId}));
  value.definition.program.steps = Array.from({length: 8}, () => arrows());
  value.definition.checks = value.targets.map(actor => ({instanceId: actor.instanceId, stepIndex: 7, state: 'idle'}));
  value.samples = Array.from({length: 8}, (_, stepIndex) => ({...sample(stepIndex), actors: value.targets.map(actor => ({...actor, position: [1, 2], state: 'idle'}))}));
  const maximal = createRuntimeCaseReport(value);
  assert.equal(maximal.samples.reduce((sum, item) => sum + item.actors.length, 0), 1024);
  assert.equal(maximal.evaluation.passedChecks, 128);
  assert.ok(Buffer.byteLength(JSON.stringify(maximal) + '\n', 'utf8') <= RUNTIME_CASE_REPORT_FILE_MAX_BYTES);
  assert.deepEqual(validateRuntimeCaseReport(maximal), maximal);
  value.definition.program.steps.push(arrows());
  assert.throws(() => createRuntimeCaseReport(value), limit);
});

test('UTF-8 output bounds reject invalid Unicode and excessive data without altering valid captured paths', () => {
  for (const character of ['\ud800', '\udfff', 'a\ud800z']) {
    const value = input(); value.context.sceneSourcePath = 'documents/' + character + '.json';
    assert.throws(() => createRuntimeCaseReport(value), invalid);
  }
  const value = input(); value.context.sceneSourcePath = 'documents/' + '🐈'.repeat(1000) + '.json';
  const unicode = createRuntimeCaseReport(value);
  assert.equal(unicode.context.sceneSourcePath, value.context.sceneSourcePath);
  assert.ok(Buffer.byteLength(JSON.stringify(unicode) + '\n', 'utf8') > JSON.stringify(unicode).length);
  assert.throws(() => createRuntimeCaseReport({...input(), context: {...context(), sceneSourcePath: 'a'.repeat(4097)}}), limit);
  const excessive = clone(report()); excessive.evaluation.checks = Array.from({length: 1025}, () => ({}));
  assert.throws(() => validateRuntimeCaseReport(excessive), limit);
});

test('portable detail construction and validation execute in an isolated browser closure with no author parser or host authority', async () => {
  const files = ['scene-control-program.mjs', 'runtime-verification-case.mjs', 'canonical-json.mjs', 'runtime-case-report.mjs'];
  const [control, runtimeCase, canonical, runtimeReport] = await Promise.all(files.map(file => fs.readFile(new URL('../../engine/' + file, import.meta.url), 'utf8')));
  assert.deepEqual([...runtimeReport.matchAll(/^import .* from '([^']+)';$/gm)].map(match => match[1]),
    ['./runtime-verification-case.mjs', './canonical-json.mjs']);
  for (const source of [control, runtimeCase, canonical, runtimeReport]) assert.ok(!/from ['"](?:node:|.*yaml|.*json-source|.*runtime-case-document)/.test(source));
  const source = `const control=(()=>{${control.replaceAll('export ', '')};return {validateSceneControlProgram,validateSceneControlPlan,SCENE_CONTROL_TRACE_FORMAT};})();
    const cases=(()=>{${runtimeCase.replace(/^import[^\n]+\n/m, 'const {validateSceneControlProgram,validateSceneControlPlan,SCENE_CONTROL_TRACE_FORMAT}=control;\n').replaceAll('export ', '')}
      return {validateRuntimeCasePlan,evaluateRuntimeCase};})();
    ${canonical.replaceAll('export ', '')}
    (()=>{${runtimeReport.replace(/^import \{ validateRuntimeCasePlan, evaluateRuntimeCase \}[^\n]+\n/m, 'const {validateRuntimeCasePlan,evaluateRuntimeCase}=cases;\n')
      .replace(/^import \{ canonicalJson \}[^\n]+\n/m, '').replaceAll('export ', '')}
      const report=createRuntimeCaseReport(${JSON.stringify(input())});
      return JSON.stringify({value:validateRuntimeCaseReport(report),frozen:Object.isFrozen(report.samples[0].actors),
        globals:[typeof process,typeof require,typeof document,typeof fetch,typeof Buffer]});})();`;
  const result = JSON.parse(new vm.Script(source).runInContext(vm.createContext({})));
  assert.deepEqual(result.value, report()); assert.equal(result.frozen, true);
  assert.deepEqual(result.globals, Array(5).fill('undefined'));
});
