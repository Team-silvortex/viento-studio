import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as suiteContract from '../../engine/runtime-case-suite-contract.mjs';
import { RUNTIME_CASE_SUITE_FORMAT, RUNTIME_CASE_SUITE_FILE_MAX_BYTES,
  RUNTIME_CASE_SUITE_DOCUMENT_MAX_COUNT, RUNTIME_CASE_SUITE_ACTOR_STEP_LIMIT, RUNTIME_CASE_SUITE_CHECK_LIMIT,
  validateRuntimeCaseSuite, inspectRuntimeCaseSuite, runtimeCaseSuiteDocumentIds,
  validateRuntimeCaseSuitePlan, validateRuntimeCaseSuiteDependencies, summarizeRuntimeCaseSuite } from '../../engine/runtime-case-suite.mjs';

const id = number => `aaaaaaaa-aaaa-4aaa-8aaa-${number.toString(16).padStart(12, '0')}`;
const sceneId = id(1), suiteId = id(2), actorId = id(9), first = id(4), second = id(5);
const arrows = (right = false) => ({ left: false, right, up: false, down: false });
const suite = (count = 2) => ({ format: RUNTIME_CASE_SUITE_FORMAT, schemaVersion: 1, sceneObjectId: sceneId,
  documentIds: Array.from({ length: count }, (_, index) => id(index + 20)) });
const runtimeCase = () => ({ format: 'viento-runtime-case', schemaVersion: 1,
  program: { format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125, steps: [arrows(true), arrows()] },
  checks: [{ instanceId: first, stepIndex: 0, state: 'moving' }] });
const envelope = () => ({ format: 'viento-runtime-case-document', schemaVersion: 1, sceneObjectId: sceneId, case: runtimeCase() });
const plan = (count = 2) => ({ format: 'viento-build-plan', schemaVersion: 2, kind: 'scene2d',
  scene: { objectId: sceneId, sourcePath: 'documents/scenes/demo.json' }, actors: Array.from({ length: count }, (_, index) => ({
    objectId: actorId, instanceId: index === 0 ? first : index === 1 ? second : id(index + 100) })) });
const members = value => value.documentIds.map(documentId => ({ documentId, document: envelope() }));
const registration = (documentId, sourcePath) => ({ format: 'viento-document', version: 1, id: documentId, sourcePath, relations: [], assetBindings: [] });
function fixture(value = suite(), frozen = plan(), resolved = members(value)) {
  const scene = { record: registration(sceneId, frozen.scene.sourcePath), sourcePath: frozen.scene.sourcePath,
    content: JSON.stringify({ format: 'viento-scene2d', schemaVersion: 2, viewport: [800, 480], background: '#ffffff',
      actors: frozen.actors.map(actor => ({ ...actor, position: [0, 30], controls: 'arrows', speed: 160 })) }) };
  scene.record.relations.push({ kind: 'references', targetId: actorId });
  const actor = { record: registration(actorId, 'documents/characters/actor.md'), sourcePath: 'documents/characters/actor.md', content: '# Actor' };
  const cases = resolved.map(({ documentId, document }, index) => ({
    record: registration(documentId, `documents/cases/${index}.json`), sourcePath: `documents/cases/${index}.json`, content: JSON.stringify(document) }));
  return { scene, actor, cases, record: registration(suiteId, 'documents/cases/suite.json'), source: { documents: [scene, actor, ...cases] } };
}
const is = expected => caught => caught instanceof TypeError && caught.errorCode === expected;
const codes = (input, f) => validateRuntimeCaseSuiteDependencies(input, f.record, f.source).map(item => item.code);

test('suites detach and freeze the exact ordered author IDs while deriving scene and member dependencies', () => {
  const input = suite(); input.documentIds.reverse();
  const value = validateRuntimeCaseSuite(input);
  assert.deepEqual(value, input); assert.notEqual(value, input); assert.notEqual(value.documentIds, input.documentIds);
  assert.equal(Object.isFrozen(value), true); assert.equal(Object.isFrozen(value.documentIds), true);
  assert.deepEqual(runtimeCaseSuiteDocumentIds(value), [sceneId, id(21), id(20)]);
  input.documentIds[0] = id(99); assert.equal(value.documentIds[0], id(21));
  assert.equal(RUNTIME_CASE_SUITE_FILE_MAX_BYTES, 16384); assert.equal(RUNTIME_CASE_SUITE_DOCUMENT_MAX_COUNT, 16);
  assert.equal(RUNTIME_CASE_SUITE_ACTOR_STEP_LIMIT, 4096); assert.equal(RUNTIME_CASE_SUITE_CHECK_LIMIT, 1024);
  assert.equal(validateRuntimeCaseSuite(suite(16)).documentIds.length, 16);
  assert.deepEqual(validateRuntimeCaseSuite(Object.assign(Object.create(null), suite())), suite());
});

test('suite fields and member arrays accept only exact plain descriptors without invoking accessors', () => {
  let calls = 0;
  const getter = suite(); Object.defineProperty(getter, 'documentIds', { enumerable: true, get() { calls++; return [id(20)]; } });
  const rowGetter = suite(); Object.defineProperty(rowGetter.documentIds, '0', { enumerable: true, get() { calls++; return id(20); } });
  const hidden = suite(); Object.defineProperty(hidden, 'result', { value: 'passed' });
  const extraArray = suite(); extraArray.documentIds.path = '/outside';
  const sparse = suite(); delete sparse.documentIds[0];
  const cycle = suite(); cycle.documentIds[0] = cycle;
  for (const value of [getter, rowGetter, hidden, extraArray, sparse, cycle, { ...suite(), [Symbol('tool')]: 'tool' },
    Object.assign(Object.create({ inherited: true }), suite()), { ...suite(), documentIds: Object.assign(Object.create(Array.prototype), { 0: id(20), length: 1 }) }]) {
    assert.throws(() => validateRuntimeCaseSuite(value), is('runtime_suite_invalid'));
  }
  for (const key of ['path', 'backendId', 'result', 'title', 'cases', 'code']) {
    assert.throws(() => validateRuntimeCaseSuite({ ...suite(), [key]: 'extra' }), is('runtime_suite_invalid'));
  }
  for (const key of ['format', 'schemaVersion', 'sceneObjectId', 'documentIds']) {
    const value = suite(); delete value[key]; assert.throws(() => validateRuntimeCaseSuite(value), is('runtime_suite_invalid'));
  }
  assert.equal(calls, 0);
});

test('one to sixteen unique UUID members exclude the scene and registered suite identity', () => {
  for (const documentIds of [[], [id(20), id(20)], [sceneId], ['path.json'], [id(20).toUpperCase()]]) {
    assert.throws(() => validateRuntimeCaseSuite({ ...suite(), documentIds }), is('runtime_suite_invalid'));
  }
  assert.throws(() => validateRuntimeCaseSuite(suite(17)), is('runtime_suite_limit'));
  for (const value of [{ ...suite(), schemaVersion: 2 }, { ...suite(), sceneObjectId: 'scene' }]) {
    assert.throws(() => validateRuntimeCaseSuite(value), is('runtime_suite_invalid'));
  }
  const f = fixture(); f.record.id = id(20);
  assert.deepEqual(codes(suite(), f), ['runtime_suite_invalid']);
  f.record.id = sceneId; assert.deepEqual(codes(suite(), f), ['runtime_suite_invalid']);
});

test('source inspection preserves BOM and CRLF and recognizes escaped or unfinished top-level markers only', () => {
  const input = suite(), raw = '\uFEFF' + JSON.stringify(input, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
  assert.deepEqual(inspectRuntimeCaseSuite(raw).value, input); assert.ok(raw.startsWith('\uFEFF{\r\n'));
  assert.ok(raw.endsWith('\r\n'));
  const escaped = [...RUNTIME_CASE_SUITE_FORMAT].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  assert.equal(inspectRuntimeCaseSuite(JSON.stringify(input).replace(RUNTIME_CASE_SUITE_FORMAT, escaped)).ok, true);
  for (const content of ['{"for\\u006dat":"viento-runtime-case-suite",', '{"format":"viento-runtime-case-suite',
    '{"format":"' + escaped]) {
    const observed = inspectRuntimeCaseSuite(content); assert.equal(observed.recognized, true); assert.equal(observed.ok, false);
  }
  for (const content of [undefined, '', '# viento-runtime-case-suite', JSON.stringify(envelope()),
    JSON.stringify({ example: suite() }), JSON.stringify([suite()]), '{"example":{"format":"viento-runtime-case-suite"},"unfinished":']) {
    assert.deepEqual(inspectRuntimeCaseSuite(content), { recognized: false, ok: true, value: null, diagnostics: [] });
  }
});

test('suite source enforces UTF-8 bytes and rejects duplicate decoded keys without normalizing source', () => {
  const plain = JSON.stringify(suite()), exact = plain + ' '.repeat(RUNTIME_CASE_SUITE_FILE_MAX_BYTES - plain.length);
  assert.equal(inspectRuntimeCaseSuite(exact).ok, true);
  assert.equal(inspectRuntimeCaseSuite(exact + ' ').diagnostics[0].code, 'runtime_suite_limit');
  const wide = JSON.stringify({ ...suite(), title: '中'.repeat(6000) });
  assert.ok(wide.length < RUNTIME_CASE_SUITE_FILE_MAX_BYTES);
  assert.equal(inspectRuntimeCaseSuite(wide).diagnostics[0].code, 'runtime_suite_limit');
  assert.equal(inspectRuntimeCaseSuite(plain + '\ud800').diagnostics[0].code, 'runtime_suite_limit');
  const duplicate = plain.replace('"documentIds":', '"docu\\u006dentIds":[],"documentIds":');
  assert.equal(inspectRuntimeCaseSuite(duplicate).diagnostics[0].code, 'runtime_suite_invalid');
  assert.equal(inspectRuntimeCaseSuite(JSON.stringify(suite(17))).diagnostics[0].code, 'runtime_suite_limit');
});

test('plan admission resolves every member in declared order and reuses unchanged global and instance case guards', () => {
  const input = suite(), resolved = members(input);
  resolved[1].document.case.program = { ...runtimeCase().program, schemaVersion: 2,
    steps: [{ inputs: [{ instanceId: second, ...arrows(true) }] }, { inputs: [] }] };
  assert.deepEqual(validateRuntimeCaseSuitePlan(plan(), input, resolved), input);
  for (const wrong of [resolved.slice().reverse(), resolved.slice(0, 1), [...resolved, resolved[0]],
    [{ ...resolved[0], path: '/outside' }, resolved[1]]]) {
    assert.throws(() => validateRuntimeCaseSuitePlan(plan(), input, wrong), is('runtime_suite_invalid'));
  }
  const foreign = members(input); foreign[1].document.sceneObjectId = id(99);
  assert.throws(() => validateRuntimeCaseSuitePlan(plan(), input, foreign), is('runtime_suite_scene_mismatch'));
  assert.throws(() => validateRuntimeCaseSuitePlan({ ...plan(), scene: { ...plan().scene, objectId: id(99) } }, input, members(input)), is('runtime_suite_scene_mismatch'));
  assert.throws(() => validateRuntimeCaseSuitePlan({ ...plan(), schemaVersion: 3 }, input, members(input)), is('runtime_case_unsupported'));
  resolved[1].document.case.program.steps[0].inputs[0].instanceId = actorId;
  assert.throws(() => validateRuntimeCaseSuitePlan(plan(), input, resolved), is('runtime_case_target_missing'));
});

test('aggregate actor-step and check budgets accept their exact limits and reject individually legal excess', () => {
  const input = suite(4), frozen = plan(16), resolved = members(input);
  for (const member of resolved) member.document.case.program.steps = Array.from({ length: 64 }, () => arrows());
  assert.deepEqual(validateRuntimeCaseSuitePlan(frozen, input, resolved), input);
  const excess = suite(5), extra = [...resolved, { documentId: excess.documentIds[4], document: structuredClone(resolved[0].document) }];
  assert.throws(() => validateRuntimeCaseSuitePlan(frozen, excess, extra), is('runtime_suite_limit'));
  const checksInput = suite(8), many = plan(128), cases = members(checksInput);
  for (const member of cases) {
    member.document.case.program.steps = [arrows()];
    member.document.case.checks = many.actors.map(actor => ({ instanceId: actor.instanceId, stepIndex: 0, state: 'idle' }));
  }
  assert.equal(validateRuntimeCaseSuitePlan(many, checksInput, cases).documentIds.length, 8);
  const checksExcess = suite(9), excessCases = [...cases, { documentId: checksExcess.documentIds[8], document: structuredClone(cases[0].document) }];
  assert.throws(() => validateRuntimeCaseSuitePlan(many, checksExcess, excessCases), is('runtime_suite_limit'));
  // Admission must validate the final case too, before producing only an
  // aggregate budget result for eight earlier legal members.
  excessCases[8].document.case.checks[0].instanceId = id(999);
  assert.throws(() => validateRuntimeCaseSuitePlan(many, checksExcess, excessCases), is('runtime_case_target_missing'));
});

test('author dependencies use envelope authority without suite metadata relations and retain member order', () => {
  const input = suite(); input.documentIds.reverse(); const f = fixture(input);
  const raw = f.cases.map(item => item.content);
  assert.deepEqual(codes(input, f), []); assert.deepEqual(f.record.relations, []);
  f.record.id = null; assert.deepEqual(codes(input, f), []);
  f.scene.content = JSON.stringify({ ...JSON.parse(f.scene.content), schemaVersion: 3, groups: [] });
  assert.deepEqual(codes(input, f), []); assert.deepEqual(f.cases.map(item => item.content), raw);
});

test('only unavailable registered member bodies defer, while nested scene and actor availability keep old codes and IDs', () => {
  const input = suite(), f = fixture(); f.cases[0].content = null;
  let issues = validateRuntimeCaseSuiteDependencies(input, f.record, f.source);
  assert.deepEqual(issues.map(item => [item.code, item.relatedObjectId, item.propertyPath]),
    [['runtime_suite_dependency_unavailable', id(20), '/documentIds/0']]);
  f.cases[1].content = null; f.scene.content = null;
  issues = validateRuntimeCaseSuiteDependencies(input, f.record, f.source);
  assert.deepEqual(issues.map(item => item.relatedObjectId), [id(20), id(21), sceneId]);
  assert.equal(issues[2].code, 'runtime_case_dependency_unavailable');
  const missingActor = fixture(); missingActor.actor.content = null;
  issues = validateRuntimeCaseSuiteDependencies(input, missingActor.record, missingActor.source);
  assert.ok(issues.length && issues.every(item => item.code === 'runtime_case_dependency_unavailable' && item.relatedObjectId === actorId));
  const unknown = fixture(); unknown.source.documents.pop(); assert.deepEqual(codes(input, unknown), ['runtime_suite_invalid']);
  const noScene = fixture(); noScene.source.documents.shift(); assert.deepEqual(codes(input, noScene), ['runtime_suite_invalid']);
  const unregisteredActor = fixture(); unregisteredActor.source.documents.splice(1, 1);
  assert.deepEqual(codes(input, unregisteredActor), ['runtime_case_document_invalid']);
});

test('known scene guards cannot defer behind absent suite members or definitions', () => {
  const input = suite(), absent = () => {
    const f = fixture(); f.cases.forEach(member => { member.content = null; }); return f;
  };
  const legal = absent();
  assert.deepEqual(codes(input, legal), ['runtime_suite_dependency_unavailable', 'runtime_suite_dependency_unavailable']);
  const noDefinitionBody = absent(); noDefinitionBody.actor.content = null;
  const deferred = validateRuntimeCaseSuiteDependencies(input, noDefinitionBody.record, noDefinitionBody.source);
  assert.ok(deferred.some(item => item.code === 'runtime_case_dependency_unavailable' && item.relatedObjectId === actorId));
  for (const changed of [
    { actors: {} }, { actors: [] }, { format: 'viento-scene-recipe' }, { schemaVersion: 1 },
    { actors: [{ instanceId: first, objectId: id(999), position: [0, 0] }] },
    { actors: [{ instanceId: first, objectId: actorId }, { instanceId: first, objectId: actorId }] },
    { schemaVersion: 3, groups: [{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }] },
  ]) {
    const f = absent(); f.scene.content = JSON.stringify({ ...JSON.parse(f.scene.content), ...changed });
    const errors = codes(input, f);
    assert.ok(errors.length && errors.every(code => !['runtime_case_dependency_unavailable', 'runtime_suite_dependency_unavailable'].includes(code)));
  }
  const behavior = absent(); behavior.scene.record.relations.push({ kind: 'behavior', targetId: id(8) });
  assert.deepEqual(codes(input, behavior), ['runtime_case_unsupported']);
  const unlinked = absent(); unlinked.scene.record.relations = [];
  assert.ok(codes(input, unlinked).every(code => code === 'runtime_case_document_unlinked'));
  const unknownDefinition = absent(); unknownDefinition.source.documents.splice(1, 1);
  assert.deepEqual(codes(input, unknownDefinition), ['runtime_case_document_invalid']);
});

test('source dependency admission rejects foreign, malformed, stale or self-referential members without invoking getters', () => {
  const input = suite();
  for (const content of [JSON.stringify(runtimeCase()), JSON.stringify(input), '{"format":"viento-runtime-case-document",',
    JSON.stringify({ ...envelope(), sceneObjectId: id(99) })]) {
    const f = fixture(); f.cases[0].content = content;
    assert.ok(codes(input, f).every(code => ['runtime_suite_invalid', 'runtime_suite_scene_mismatch'].includes(code)));
  }
  const stale = fixture(), changed = envelope(); changed.case.checks[0].instanceId = id(999); stale.cases[0].content = JSON.stringify(changed);
  assert.deepEqual(codes(input, stale), ['runtime_case_target_missing']);
  const wrongPath = fixture(); wrongPath.cases[0].record.sourcePath = 'documents/cases/0.md';
  assert.deepEqual(codes(input, wrongPath), ['runtime_suite_invalid']);
  const behavior = fixture(); behavior.scene.record.relations.push({ kind: 'behavior', targetId: id(8) });
  assert.ok(codes(input, behavior).every(code => code === 'runtime_case_unsupported'));
  let calls = 0; const getter = fixture();
  Object.defineProperty(getter.cases[0], 'content', { enumerable: true, get() { calls++; return JSON.stringify(envelope()); } });
  assert.deepEqual(codes(input, getter), ['runtime_suite_invalid']);
  const source = {}; Object.defineProperty(source, 'documents', { enumerable: true, get() { calls++; return fixture().source.documents; } });
  assert.deepEqual(validateRuntimeCaseSuiteDependencies(input, fixture().record, source).map(item => item.code), ['runtime_suite_invalid']);
  assert.equal(calls, 0);
});

test('fully resolved author suites enforce aggregate budgets before packaging or persistence admission', () => {
  const input = suite(4), frozen = plan(16), resolved = members(input);
  for (const member of resolved) member.document.case.program.steps = Array.from({ length: 64 }, () => arrows());
  const valid = fixture(input, frozen, resolved); assert.deepEqual(codes(input, valid), []);
  const large = suite(5), extra = [...resolved, { documentId: large.documentIds[4], document: structuredClone(resolved[0].document) }];
  assert.deepEqual(codes(large, fixture(large, frozen, extra)), ['runtime_suite_limit']);
  const missingDefinition = fixture(large, frozen, extra); missingDefinition.actor.content = null;
  assert.deepEqual(codes(large, missingDefinition), ['runtime_suite_limit']);
});

test('suite summaries distinguish active, assertion failure and incomplete cancellation without counting unstarted cases as completed', () => {
  assert.deepEqual(summarizeRuntimeCaseSuite(['queued', 'running', 'passed', 'failed', 'incomplete', 'not-run']), {
    status: 'running', complete: false, total: 6, completed: 3, queued: 1, running: 1, passed: 1, failed: 1, incomplete: 1, notRun: 1 });
  assert.equal(summarizeRuntimeCaseSuite(['failed', 'queued']).status, 'running');
  const cancelled = summarizeRuntimeCaseSuite(['passed', 'incomplete', 'not-run']);
  assert.deepEqual([cancelled.status, cancelled.complete, cancelled.completed, cancelled.notRun], ['incomplete', false, 2, 1]);
  assert.equal(summarizeRuntimeCaseSuite(['failed', 'not-run']).status, 'incomplete');
  const failed = summarizeRuntimeCaseSuite(['passed', 'failed']);
  assert.deepEqual([failed.status, failed.complete, failed.completed], ['failed', true, 2]);
  assert.equal(Object.isFrozen(failed), true);
  assert.equal(summarizeRuntimeCaseSuite(['passed']).status, 'passed');
  for (const states of [[], ['succeeded'], ['cancelled'], [true], new Array(1)]) {
    assert.throws(() => summarizeRuntimeCaseSuite(states), is('runtime_suite_invalid'));
  }
  assert.throws(() => summarizeRuntimeCaseSuite(Array(17).fill('passed')), is('runtime_suite_limit'));
});

test('the browser suite contract has no imported graph and shares the exact validation and summary exports with the author module', async () => {
  assert.equal(suiteContract.validateRuntimeCaseSuite, validateRuntimeCaseSuite);
  assert.equal(suiteContract.summarizeRuntimeCaseSuite, summarizeRuntimeCaseSuite);
  const source = await fs.readFile(new URL('../../engine/runtime-case-suite-contract.mjs', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\b|^\s*export\s+.*\bfrom\s/m.test(source));
  const script = source.replace(/^export (?=(?:const|function)\b)/gm, '')
    .replace(/^export \{[^\n]+\};$/gm, '') + '\n({validateRuntimeCaseSuite,summarizeRuntimeCaseSuite})';
  const context = vm.createContext({});
  const portable = vm.runInContext(script, context), input = suite(); input.documentIds.reverse();
  context.inputJson = JSON.stringify(input); context.statesJson = JSON.stringify(['passed', 'incomplete', 'not-run']);
  const checked = portable.validateRuntimeCaseSuite(vm.runInContext('JSON.parse(inputJson)', context));
  const summary = portable.summarizeRuntimeCaseSuite(vm.runInContext('JSON.parse(statesJson)', context));
  assert.deepEqual(JSON.parse(JSON.stringify(checked)), validateRuntimeCaseSuite(input));
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), summarizeRuntimeCaseSuite(['passed', 'incomplete', 'not-run']));
  assert.equal(Object.isFrozen(checked), true); assert.equal(Object.isFrozen(checked.documentIds), true);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(vm.runInContext('[typeof process,typeof require,typeof document,typeof fetch,typeof Buffer].join(",")', context),
    'undefined,undefined,undefined,undefined,undefined');
});
