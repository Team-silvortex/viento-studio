import test from 'node:test';
import assert from 'node:assert/strict';
import { RUNTIME_CASE_DOCUMENT_FORMAT, RUNTIME_CASE_DOCUMENT_FILE_MAX_BYTES,
  validateRuntimeCaseDocument, inspectRuntimeCaseDocument, runtimeCaseDocumentIds,
  validateRuntimeCaseDocumentPlan, validateRuntimeCaseDocumentDependencies } from '../../engine/runtime-case-document.mjs';

const id = number => `aaaaaaaa-aaaa-4aaa-8aaa-${number.toString(16).padStart(12, '0')}`;
const sceneId = id(1), caseId = id(2), definitionId = id(9), instanceId = id(4), secondId = id(5);
const arrows = (right = false) => ({ left: false, right, up: false, down: false });
const runtimeCase = () => ({ format: 'viento-runtime-case', schemaVersion: 1,
  program: { format: 'viento-runtime-control', schemaVersion: 1, fixedDelta: 0.125, steps: [arrows(true), arrows()] },
  checks: [{ instanceId, stepIndex: 0, position: { value: [20, 30], tolerance: 0.0001 }, state: 'moving' }] });
const envelope = () => ({ format: RUNTIME_CASE_DOCUMENT_FORMAT, schemaVersion: 1, sceneObjectId: sceneId, case: runtimeCase() });
const record = (number, sourcePath) => ({ format: 'viento-document', version: 1, id: id(number), sourcePath, assetBindings: [], relations: [] });
const scene = () => ({ format: 'viento-scene2d', schemaVersion: 2, title: 'Scene', viewport: [800, 480], background: '#ffffff',
  actors: [{ instanceId, objectId: definitionId, position: [0, 30], controls: 'arrows', speed: 160 },
    { instanceId: secondId, objectId: definitionId, position: [50, 30], controls: 'none' }] });
function fixture() {
  const sceneDocument = { record: record(1, 'documents/scenes/demo.json'), sourcePath: 'documents/scenes/demo.json', content: JSON.stringify(scene()) };
  sceneDocument.record.relations.push({ kind: 'references', targetId: definitionId, slot: 'Actor' });
  const definition = { record: record(9, 'documents/characters/actor.md'), sourcePath: 'documents/characters/actor.md', content: '# Actor' };
  return { sceneDocument, definition, registration: record(2, 'documents/cases/case.json'), source: { documents: [sceneDocument, definition] } };
}
const code = expected => caught => caught instanceof TypeError && caught.errorCode === expected;
const codes = (value, registration, source) => validateRuntimeCaseDocumentDependencies(value, registration, source).map(item => item.code);

test('case envelopes detach and freeze existing global or instance cases without storing run state', () => {
  const input = envelope(), checked = validateRuntimeCaseDocument(input);
  assert.deepEqual(checked, input); assert.notEqual(checked, input); assert.notEqual(checked.case, input.case);
  for (const value of [checked, checked.case, checked.case.program, checked.case.checks[0].position.value]) assert.equal(Object.isFrozen(value), true);
  input.case.checks[0].position.value[0] = 999; assert.equal(checked.case.checks[0].position.value[0], 20);
  const instance = envelope(); instance.case.program = { ...instance.case.program, schemaVersion: 2,
    steps: [{ inputs: [{ instanceId, ...arrows(true) }] }, { inputs: [] }] };
  assert.deepEqual(validateRuntimeCaseDocument(instance).case.program, instance.case.program);
  assert.deepEqual(runtimeCaseDocumentIds(checked), [sceneId]);
  assert.equal(RUNTIME_CASE_DOCUMENT_FILE_MAX_BYTES, 262144);
});

test('envelope fields are exact data and accessors, hidden keys, polluted prototypes or cycles never gain authority', () => {
  let calls = 0;
  const getter = envelope(); Object.defineProperty(getter, 'case', { enumerable: true, get() { calls++; return runtimeCase(); } });
  const nested = envelope(); Object.defineProperty(nested.case.checks[0].position, 'tolerance', { enumerable: true, get() { calls++; return 0; } });
  const hidden = envelope(); Object.defineProperty(hidden, 'result', { value: { status: 'passed' } });
  const cycle = envelope(); cycle.case = cycle;
  for (const value of [getter, hidden, Object.assign(Object.create({ run() {} }), envelope()),
    { ...envelope(), [Symbol('path')]: '/outside' }, { ...envelope(), schemaVersion: 2 },
    { ...envelope(), sceneObjectId: sceneId.toUpperCase() }, { ...envelope(), sceneObjectId: 'scene' }]) {
    assert.throws(() => validateRuntimeCaseDocument(value), code('runtime_case_document_invalid'));
  }
  for (const key of ['title', 'result', 'path', 'provenance', 'backendId']) {
    assert.throws(() => validateRuntimeCaseDocument({ ...envelope(), [key]: 'extra' }), code('runtime_case_document_invalid'));
  }
  assert.throws(() => validateRuntimeCaseDocument(nested), code('runtime_case_invalid'));
  assert.throws(() => validateRuntimeCaseDocument(cycle), code('runtime_case_invalid'));
  assert.equal(calls, 0);
});

test('source inspection recognizes only a top-level document marker and preserves BOM/CRLF source verbatim', () => {
  for (const content of [undefined, '', '# viento-runtime-case-document', JSON.stringify(runtimeCase()),
    JSON.stringify({ example: envelope() }), JSON.stringify([envelope()]),
    '{"example":{"format":"viento-runtime-case-document"},"unfinished":']) {
    assert.deepEqual(inspectRuntimeCaseDocument(content), { recognized: false, ok: true, value: null, diagnostics: [] });
  }
  const raw = '\uFEFF' + JSON.stringify(envelope(), null, '\t').replaceAll('\n', '\r\n') + '\r\n';
  assert.deepEqual(inspectRuntimeCaseDocument(raw).value, envelope());
  assert.ok(raw.startsWith('\uFEFF{\r\n')); assert.ok(raw.endsWith('\r\n'));
  const escaped = [...RUNTIME_CASE_DOCUMENT_FORMAT].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  assert.equal(inspectRuntimeCaseDocument(JSON.stringify(envelope()).replace(RUNTIME_CASE_DOCUMENT_FORMAT, escaped)).ok, true);
  const partial = inspectRuntimeCaseDocument('{"for\\u006dat":"viento-runtime-case-document",');
  assert.equal(partial.recognized, true); assert.equal(partial.ok, false);
});

test('document text uses UTF-8 byte budgets and rejects duplicate decoded keys rather than normalizing them', () => {
  const plain = JSON.stringify(envelope());
  const exact = plain + ' '.repeat(RUNTIME_CASE_DOCUMENT_FILE_MAX_BYTES - plain.length);
  assert.equal(inspectRuntimeCaseDocument(exact).ok, true);
  assert.equal(inspectRuntimeCaseDocument(exact + ' ').diagnostics[0].code, 'runtime_case_document_limit');
  const wide = JSON.stringify({ ...envelope(), title: '中'.repeat(90000) });
  assert.ok(wide.length < RUNTIME_CASE_DOCUMENT_FILE_MAX_BYTES);
  assert.equal(inspectRuntimeCaseDocument(wide).diagnostics[0].code, 'runtime_case_document_limit');
  const duplicate = plain.replace('"sceneObjectId":', '"scene\\u004fbjectId":"' + sceneId + '","sceneObjectId":');
  const checked = inspectRuntimeCaseDocument(duplicate);
  assert.equal(checked.ok, false); assert.equal(checked.diagnostics[0].propertyPath, '/sceneObjectId');
  assert.equal(inspectRuntimeCaseDocument(plain.replace('"value":[20,30]', '"value":[1e999,30]')).ok, false);
});

test('plan binding requires the declared scene identity and retains the old plan2 case admission', () => {
  const plan = { format: 'viento-build-plan', schemaVersion: 2, kind: 'scene2d', scene: { objectId: sceneId, sourcePath: 'documents/scenes/demo.json' },
    actors: [{ instanceId, objectId: definitionId }, { instanceId: secondId, objectId: definitionId }] };
  assert.deepEqual(validateRuntimeCaseDocumentPlan(plan, envelope()), envelope());
  assert.throws(() => validateRuntimeCaseDocumentPlan({ ...plan, scene: { ...plan.scene, objectId: id(6) } }, envelope()), code('runtime_case_scene_mismatch'));
  assert.throws(() => validateRuntimeCaseDocumentPlan({ ...plan, schemaVersion: 1 }, envelope()), code('runtime_case_unsupported'));
  const stale = envelope(); stale.case.checks[0].instanceId = definitionId;
  assert.throws(() => validateRuntimeCaseDocumentPlan(plan, stale), code('runtime_case_target_missing'));
});

test('dependency admission supports scene2 and grouped scene3, both control schemas and unregistered create candidates', () => {
  const h = fixture(), before = JSON.stringify(h);
  assert.deepEqual(codes(envelope(), h.registration, h.source), []);
  assert.deepEqual(codes(envelope(), { format: 'viento-document', id: null, sourcePath: 'documents/cases/new.json' }, h.source), []);
  assert.equal(JSON.stringify(h), before); assert.deepEqual(h.registration.relations, []);
  const grouped = scene(); grouped.schemaVersion = 3; grouped.groups = [{ groupId: id(6), name: 'Group' }]; grouped.actors[0].groupId = id(6);
  h.sceneDocument.content = JSON.stringify(grouped);
  const instance = envelope(); instance.case.program = { ...instance.case.program, schemaVersion: 2,
    steps: [{ inputs: [{ instanceId, ...arrows(true) }] }, { inputs: [] }] };
  assert.deepEqual(codes(instance, h.registration, h.source), []);
  grouped.groups[0].parentGroupId = id(6); h.sceneDocument.content = JSON.stringify(grouped);
  assert.deepEqual(codes(instance, h.registration, h.source), ['runtime_case_document_invalid']);
});

test('only unavailable registered dependency bodies can be deferred, with their stable related document ID', () => {
  const h = fixture(); h.sceneDocument.content = null;
  assert.deepEqual(validateRuntimeCaseDocumentDependencies(envelope(), h.registration, h.source).map(({ code, relatedObjectId }) => ({ code, relatedObjectId })),
    [{ code: 'runtime_case_dependency_unavailable', relatedObjectId: sceneId }]);
  h.sceneDocument.content = JSON.stringify(scene()); h.definition.content = null;
  const unavailable = validateRuntimeCaseDocumentDependencies(envelope(), h.registration, h.source);
  assert.ok(unavailable.every(item => item.code === 'runtime_case_dependency_unavailable' && item.relatedObjectId === definitionId));
  h.source.documents.pop(); assert.deepEqual(codes(envelope(), h.registration, h.source), ['runtime_case_document_invalid']);
  h.source.documents = []; assert.deepEqual(codes(envelope(), h.registration, h.source), ['runtime_case_document_invalid']);
});

test('source scene relations protect the package closure without requiring a case metadata mirror', () => {
  const h = fixture(); h.sceneDocument.record.relations = [];
  assert.ok(codes(envelope(), h.registration, h.source).every(value => value === 'runtime_case_document_unlinked'));
  h.sceneDocument.record.relations = [{ kind: 'references', targetId: definitionId }];
  assert.deepEqual(codes(envelope(), h.registration, h.source), []);
  assert.deepEqual(codes(envelope(), { ...h.registration, id: sceneId }, h.source), ['runtime_case_document_invalid']);
  assert.deepEqual(codes(envelope(), { ...h.registration, sourcePath: 'documents/case.txt' }, h.source), ['runtime_case_document_invalid']);
  h.sceneDocument.sourcePath = 'documents/other.json';
  assert.deepEqual(codes(envelope(), h.registration, h.source), ['runtime_case_document_invalid']);
});

test('deleted or duplicate instance identities, authored behaviors and legacy/recipe scenes cannot become runnable saved cases', () => {
  const h = fixture();
  for (const schemaVersion of [1, 4]) {
    h.sceneDocument.content = JSON.stringify({ ...scene(), schemaVersion });
    assert.deepEqual(codes(envelope(), h.registration, h.source), ['runtime_case_unsupported']);
  }
  h.sceneDocument.content = '{"format":"viento-scene-composition","schemaVersion":1}';
  assert.deepEqual(codes(envelope(), h.registration, h.source), ['runtime_case_unsupported']);
  h.sceneDocument.content = JSON.stringify(scene()); h.sceneDocument.record.relations.push({ kind: 'behavior', targetId: id(3) });
  assert.deepEqual(codes(envelope(), h.registration, h.source), ['runtime_case_unsupported']); h.sceneDocument.record.relations.pop();
  const duplicate = scene(); duplicate.actors[1].instanceId = instanceId; h.sceneDocument.content = JSON.stringify(duplicate);
  assert.deepEqual(codes(envelope(), h.registration, h.source), ['runtime_case_document_invalid']);
  h.sceneDocument.content = JSON.stringify(scene());
  const stale = envelope(); stale.case.checks[0].instanceId = id(8);
  assert.deepEqual(codes(stale, h.registration, h.source), ['runtime_case_target_missing']);
  stale.case.checks[0].instanceId = instanceId; stale.case.program = { ...stale.case.program, schemaVersion: 2,
    steps: [{ inputs: [{ instanceId: id(8), ...arrows(true) }] }, { inputs: [] }] };
  assert.deepEqual(codes(stale, h.registration, h.source), ['runtime_case_target_missing']);
});

test('a maximum permitted case remains valid through the wrapper and author identity plan while joint overflow stays a limit', () => {
  const h = fixture(), actors = Array.from({ length: 128 }, (_, index) => ({ instanceId: id(index + 100), objectId: definitionId, position: [0, 0] }));
  h.sceneDocument.content = JSON.stringify({ ...scene(), actors });
  const maximum = { ...envelope(), case: { ...runtimeCase(), program: { format: 'viento-runtime-control', schemaVersion: 2, fixedDelta: 0.125,
    steps: Array.from({ length: 8 }, () => ({ inputs: actors.map(({ instanceId }) => ({ instanceId, ...arrows() })) })) },
    checks: actors.map(({ instanceId }) => ({ instanceId, stepIndex: 7, state: 'idle' })) } };
  assert.deepEqual(codes(maximum, h.registration, h.source), []); assert.equal(inspectRuntimeCaseDocument(JSON.stringify(maximum)).ok, true);
  const overflow = envelope(); overflow.case.program.steps = Array.from({ length: 9 }, () => arrows()); overflow.case.checks[0].instanceId = actors[0].instanceId;
  assert.deepEqual(codes(overflow, h.registration, h.source), ['runtime_case_limit']);
});

test('dependency metadata/source accessors and sparse graphs are rejected without executing them', () => {
  let calls = 0; const h = fixture();
  Object.defineProperty(h.sceneDocument, 'content', { enumerable: true, get() { calls++; return JSON.stringify(scene()); } });
  assert.deepEqual(codes(envelope(), h.registration, h.source), ['runtime_case_document_invalid']);
  const source = {}; Object.defineProperty(source, 'documents', { enumerable: true, get() { calls++; return fixture().source.documents; } });
  assert.deepEqual(codes(envelope(), h.registration, source), ['runtime_case_document_invalid']);
  const sparse = fixture(); delete sparse.source.documents[0];
  assert.deepEqual(codes(envelope(), sparse.registration, sparse.source), ['runtime_case_document_invalid']);
  assert.equal(calls, 0);
});
